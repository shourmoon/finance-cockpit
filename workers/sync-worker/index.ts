// workers/sync-worker/index.ts
//
// Cloudflare Worker implementing a simple state synchronisation API for
// Finance Cockpit.
//
// Endpoints:
//   GET  /state?key=<sharedKey> → returns the current snapshot
//   PUT  /state?key=<sharedKey> with JSON body { app_state, mortgage_ui, prev_updated_at? }
//       → writes a new snapshot and returns { updated_at }
//
// CORS: permissive (SPA usage). Handles OPTIONS preflight.
//
// Security (PIN-gated):
//   - Client must send header: X-Sync-Pin = sha256(pin) (hex string)
//   - The worker stores the first-seen pin hash per sharedKey and enforces it for all future requests.
//   - Without correct pin, responds 401.

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

const KV_BINDING_NAME = "SYNC_KV";
const PIN_HEADER = "x-sync-pin";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Pin",
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

function getKv(env: any): any {
  const kv = (env as any)[KV_BINDING_NAME];
  if (!kv) throw new Error(`KV namespace '${KV_BINDING_NAME}' not bound`);
  return kv;
}

async function loadSnapshot(env: any, key: string): Promise<StoredSnapshot | null> {
  const kv = getKv(env);
  const raw = await kv.get(key, { type: "json" });
  return raw as StoredSnapshot | null;
}

async function saveSnapshot(env: any, key: string, value: StoredSnapshot): Promise<void> {
  const kv = getKv(env);
  await kv.put(key, JSON.stringify(value));
}

function pinKey(sharedKey: string): string {
  return `${sharedKey}:pin`;
}

async function getStoredPinHash(env: any, sharedKey: string): Promise<string | null> {
  const kv = getKv(env);
  const val = await kv.get(pinKey(sharedKey));
  return typeof val === "string" && val.length > 0 ? val : null;
}

async function setStoredPinHash(env: any, sharedKey: string, pinHash: string): Promise<void> {
  const kv = getKv(env);
  await kv.put(pinKey(sharedKey), pinHash);
}

function readPinHashFromRequest(request: Request): string | null {
  const v = request.headers.get(PIN_HEADER) ?? request.headers.get("X-Sync-Pin");
  if (!v) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function requirePin(env: any, sharedKey: string, request: Request): Promise<Response | null> {
  const provided = readPinHashFromRequest(request);
  if (!provided) {
    return withCors(new Response("Missing X-Sync-Pin", { status: 401 }));
  }

  const stored = await getStoredPinHash(env, sharedKey);
  if (!stored) {
    // First use: bind this sharedKey to the provided pin hash.
    await setStoredPinHash(env, sharedKey, provided);
    return null;
  }

  if (stored !== provided) {
    return withCors(new Response("Unauthorized", { status: 401 }));
  }

  return null;
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

    // PIN gate
    const pinCheck = await requirePin(env, sharedKey, request);
    if (pinCheck) return pinCheck;

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

      // Optimistic concurrency: if current exists and prev_updated_at was supplied, require match.
      if (current && payload.prev_updated_at && current.updated_at !== payload.prev_updated_at) {
        return withCors(new Response("Conflict", { status: 409 }));
      }

      const now = new Date().toISOString();
      await saveSnapshot(env, sharedKey, {
        app_state: payload.app_state,
        mortgage_ui: payload.mortgage_ui,
        updated_at: now,
      });

      return json({ updated_at: now }, 200);
    }

    return withCors(new Response("Method Not Allowed", { status: 405 }));
  },
};
