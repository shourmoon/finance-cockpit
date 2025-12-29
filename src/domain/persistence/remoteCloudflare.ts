// src/domain/persistence/remoteCloudflare.ts
//
// Cloudflare Worker + KV remote adapter with optional PIN-hash header support.

import type {
  RemotePersistenceAdapter,
  RemoteStatePayload,
  RemoteStateResponse,
} from "./remote";

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

      return (await res.json()) as RemoteStateResponse;
    },

    async saveState(sharedKey: string, payload: RemoteStatePayload): Promise<string> {
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
