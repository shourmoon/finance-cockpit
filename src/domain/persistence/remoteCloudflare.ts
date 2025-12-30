// src/domain/persistence/remoteCloudflare.ts
//
// Concrete implementation of RemotePersistenceAdapter backed by a
// Cloudflare Worker + KV store. The worker exposes a simple JSON
// API for loading and saving snapshots. See the workers/sync-worker
// directory for the reference implementation. To use this adapter
// provide the base URL of your deployed worker when constructing
// the adapter (e.g. "https://finance-sync.example.com").

import type {
  RemotePersistenceAdapter,
  RemoteStatePayload,
  RemoteStateResponse,
} from "./remote";

/**
 * Construct a RemotePersistenceAdapter that talks to a Cloudflare
 * Worker. The worker must implement two endpoints:
 *  - GET `/state?key=SHARED_KEY` which returns { app_state, mortgage_ui, updated_at }
 *  - PUT `/state?key=SHARED_KEY` with JSON { app_state, mortgage_ui, prev_updated_at }
 *    and returns { updated_at } if successful. If prev_updated_at does not
 *    match the current stored updated_at the worker should reject with
 *    a 409 Conflict status.
 */
export function createCloudflareAdapter(
  baseUrl: string,
  opts?: { pinHash?: string | null }
): RemotePersistenceAdapter {
  const pinHash = opts?.pinHash ?? null;
  const authHeaders: Record<string, string> = {};
  if (pinHash) authHeaders["X-Sync-Pin"] = pinHash;

  return {
    async loadState(sharedKey: string): Promise<RemoteStateResponse | null> {
      const url = `${baseUrl.replace(/\/$/, "")}/state?key=${encodeURIComponent(sharedKey)}`;
      const res = await fetch(url, { method: "GET", headers: authHeaders });
      if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`Remote load failed: ${res.status}`);
      }
      const json = await res.json();
      return json as RemoteStateResponse;
    },
    async saveState(
      sharedKey: string,
      payload: RemoteStatePayload
    ): Promise<string> {
      const url = `${baseUrl.replace(/\/$/, "")}/state?key=${encodeURIComponent(sharedKey)}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Remote save failed: ${res.status}`);
      }
      const json: any = await res.json();
      if (!json || typeof json.updated_at !== "string") {
        throw new Error("Remote save response missing updated_at");
      }
      return json.updated_at as string;
    },
  };
}