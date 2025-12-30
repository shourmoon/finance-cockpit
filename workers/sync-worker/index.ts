// workers/sync-worker/index.ts
//
// Cloudflare Worker implementing a simple state synchronisation API for
// Finance Cockpit. This worker exposes two endpoints:
//   GET  /state?key=<sharedKey> → returns the current snapshot
//   PUT  /state?key=<sharedKey> with JSON body { app_state, mortgage_ui, prev_updated_at? }
//       → writes a new snapshot and returns { updated_at }
//
// The snapshot is stored in a KV namespace bound to this worker. The
// binding name must be configured in wrangler.toml as `KV_NAME` (or
// updated below). The worker implements optimistic concurrency: when
// saving callers should include the `prev_updated_at` value they got
// from a prior GET or PUT. If the stored updated_at does not match
// the provided value the worker responds with HTTP 409 to signal
// conflict.

export interface SnapshotPayload {
  app_state: any;
  mortgage_ui: any;
  prev_updated_at?: string | null;
}

export interface StoredSnapshot {
  app_state: any;
  mortgage_ui: any;
  updated_at: string;
}

// Change this if you bind a different KV namespace name in your
// wrangler.toml. For example: [[kv_namespaces]] binding = "SYNC_KV".
const KV_BINDING_NAME = "SYNC_KV";

async function loadSnapshot(env: any, key: string): Promise<StoredSnapshot | null> {
  const kv = (env as any)[KV_BINDING_NAME];
  if (!kv) throw new Error(`KV namespace '${KV_BINDING_NAME}' not bound`);
  const raw = await kv.get(key, { type: "json" });
  return raw as StoredSnapshot | null;
}

async function saveSnapshot(env: any, key: string, value: StoredSnapshot): Promise<void> {
  const kv = (env as any)[KV_BINDING_NAME];
  if (!kv) throw new Error(`KV namespace '${KV_BINDING_NAME}' not bound`);
  await kv.put(key, JSON.stringify(value));
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/state")) {
      return new Response("Not Found", { status: 404 });
    }
    const sharedKey = url.searchParams.get("key");
    if (!sharedKey) {
      return new Response("Missing key parameter", { status: 400 });
    }
    if (request.method === "GET") {
      const current = await loadSnapshot(env, sharedKey);
      if (!current) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response(
        JSON.stringify({
          app_state: current.app_state,
          mortgage_ui: current.mortgage_ui,
          updated_at: current.updated_at,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    if (request.method === "PUT") {
      let payload: SnapshotPayload;
      try {
        payload = await request.json();
      } catch {
        return new Response("Invalid JSON", { status: 400 });
      }
      if (!payload.app_state || !payload.mortgage_ui) {
        return new Response("Missing app_state or mortgage_ui", { status: 400 });
      }
      const current = await loadSnapshot(env, sharedKey);
      // Check optimistic concurrency: if current exists and prev_updated_at
      // does not match, reject.
      if (
        current &&
        payload.prev_updated_at &&
        current.updated_at !== payload.prev_updated_at
      ) {
        return new Response("Conflict", { status: 409 });
      }
      const now = new Date().toISOString();
      const toStore: StoredSnapshot = {
        app_state: payload.app_state,
        mortgage_ui: payload.mortgage_ui,
        updated_at: now,
      };
      await saveSnapshot(env, sharedKey, toStore);
      return new Response(
        JSON.stringify({ updated_at: now }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }
    return new Response("Method Not Allowed", { status: 405 });
  },
};