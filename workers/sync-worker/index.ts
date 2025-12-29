// workers/sync-worker/index.ts
//
// Cloudflare Worker implementing a simple state synchronisation API for
// Finance Cockpit. This worker exposes two endpoints:
//   GET  /state?key=<sharedKey> → returns the current snapshot
//   PUT  /state?key=<sharedKey> with JSON body { app_state, mortgage_ui, prev_updated_at? }
//       → writes a new snapshot and returns { updated_at }
//
// The snapshot is stored in a KV namespace bound to this worker.
// The binding name must match KV_BINDING_NAME below.
//
// This worker implements optimistic concurrency for PUT when
// prev_updated_at is provided. If the stored updated_at does not match,
// the worker responds with HTTP 409 (Conflict).
//
// CORS: This worker is intended to be called from a browser-hosted SPA,
// so it includes permissive CORS headers and handles OPTIONS preflight.

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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders())) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

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

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!url.pathname.startsWith("/state")) {
      return withCors(new Response("Not Found", { status: 404 }));
    }

    const sharedKey = url.searchParams.get("key");
    if (!sharedKey) {
      return withCors(new Response("Missing key parameter", { status: 400 }));
    }

    if (request.method === "GET") {
      const current = await loadSnapshot(env, sharedKey);
      if (!current) {
        return withCors(new Response("Not Found", { status: 404 }));
      }

      return json({
        app_state: current.app_state,
        mortgage_ui: current.mortgage_ui,
        updated_at: current.updated_at,
      });
    }

    if (request.method === "PUT") {
      let payload: SnapshotPayload;
      try {
        payload = await request.json();
      } catch {
        return withCors(new Response("Invalid JSON", { status: 400 }));
      }

      if (!payload.app_state || !payload.mortgage_ui) {
        return withCors(new Response("Missing app_state or mortgage_ui", { status: 400 }));
      }

      const current = await loadSnapshot(env, sharedKey);

      // Optimistic concurrency: if current exists and prev_updated_at was supplied,
      // require it to match or reject with 409.
      if (current && payload.prev_updated_at && current.updated_at !== payload.prev_updated_at) {
        return withCors(new Response("Conflict", { status: 409 }));
      }

      const now = new Date().toISOString();
      const toStore: StoredSnapshot = {
        app_state: payload.app_state,
        mortgage_ui: payload.mortgage_ui,
        updated_at: now,
      };

      await saveSnapshot(env, sharedKey, toStore);

      return json({ updated_at: now }, 200);
    }

    return withCors(new Response("Method Not Allowed", { status: 405 }));
  },
};
