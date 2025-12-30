// src/components/SyncSection.tsx
//
// UI section for multi-device sync.
//
// This repo's sync engine (syncNow) is optimistic and returns a result object.
// The Cloudflare worker can additionally enforce a PIN (sent as SHA-256 hex).
// We intentionally do NOT persist the PIN; only the sync key is remembered.

import { useEffect, useMemo, useState } from "react";
import { syncNow } from "../domain/persistence/sync";
import { stubRemoteAdapter } from "../domain/persistence/remote";
import { createCloudflareAdapter } from "../domain/persistence/remoteCloudflare";

// Optional: configure the remote base URL via env var.
// When undefined, falls back to the stub adapter (no remote IO).
const SYNC_BASE_URL: string | undefined = (import.meta as any).env?.VITE_SYNC_BASE_URL;

const SYNC_KEY_STORAGE = "finance-cockpit:sync-key";

function getLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("finance-cockpit:last-sync");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.remote_updated_at === "string" ? parsed.remote_updated_at : null;
  } catch {
    return null;
  }
}

function getRememberedSyncKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(SYNC_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

function setRememberedSyncKey(v: string): void {
  if (typeof window === "undefined") return;
  try {
    if (!v) window.localStorage.removeItem(SYNC_KEY_STORAGE);
    else window.localStorage.setItem(SYNC_KEY_STORAGE, v);
  } catch {
    // ignore
  }
}

async function sha256Hex(input: string): Promise<string> {
  // Browser crypto
  if (typeof crypto !== "undefined" && (crypto as any).subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await (crypto as any).subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("WebCrypto not available; cannot hash PIN.");
}

export default function SyncSection() {
  const [sharedKey, setSharedKey] = useState<string>(getRememberedSyncKey());
  const [pin, setPin] = useState<string>("");

  const [lastSynced, setLastSynced] = useState<string | null>(getLastSyncTime());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLastSynced(getLastSyncTime());
  }, []);

  const hasRemote = !!SYNC_BASE_URL;

  // Base adapter when remote isn't configured.
  const baseAdapter = useMemo(() => {
    return hasRemote ? createCloudflareAdapter(SYNC_BASE_URL!) : stubRemoteAdapter;
  }, [hasRemote]);

  async function buildRemoteAdapter() {
    if (!hasRemote) return baseAdapter;
    const key = sharedKey.trim();
    const p = pin.trim();
    // If user supplies a PIN, we use it; otherwise we still allow sync (worker may not require PIN).
    const pinHash = p ? await sha256Hex(p) : null;
    return createCloudflareAdapter(SYNC_BASE_URL!, { pinHash });
  }

  async function handleSync() {
    setError(null);
    setMessage(null);

    const key = sharedKey.trim();
    if (!key) {
      setError("Please enter a sync key");
      return;
    }
    if (hasRemote && !pin.trim()) {
      setError("Please enter a Sync PIN (required for remote sync).");
      return;
    }

    // Remember key for convenience (PIN is never persisted).
    setRememberedSyncKey(key);

    setLoading(true);
    try {
      const remoteAdapter = await buildRemoteAdapter();

      // If remote is configured, do a quick auth check so wrong PIN shows a clear message.
      if (hasRemote) {
        try {
          await remoteAdapter.loadState(key);
        } catch (e: any) {
          const msg = String(e?.message ?? "");
          if (msg.includes("Remote load failed: 401")) {
            setError("Unauthorized: wrong Sync PIN for this key (or missing PIN).");
            return;
          }
          // 404 is fine (first sync). Any other errors fall through to syncNow.
        }
      }

      const res = await syncNow(key, remoteAdapter as any);

      if ((res as any).conflict) {
        setError(
          "Sync conflict detected. Please try again or resolve via another device."
        );
        return;
      }

      const direction = (res as any).direction as "push" | "pull" | "init";
      const remoteUpdatedAt = (res as any).remoteUpdatedAt as string | null;
      const actionWord = direction === "push" ? "pushed" : direction === "pull" ? "pulled" : "initialised";
      setMessage(`Successfully ${actionWord} data. Updated at ${remoteUpdatedAt ?? "n/a"}.`);
      setLastSynced(remoteUpdatedAt ?? null);
    } catch (e: any) {
      const msg = String(e?.message ?? "Sync failed");
      // Browsers often surface CORS / DNS / TLS / offline issues as a generic "Failed to fetch".
      if (msg === "Failed to fetch" || msg.toLowerCase().includes("failed to fetch")) {
        setError(
          "Failed to reach the sync server. Check: (1) worker URL in VITE_SYNC_BASE_URL, (2) worker is deployed, and (3) CORS headers are enabled on the worker. Then hard refresh and try again."
        );
        return;
      }
      if (msg.includes("Remote load failed: 401") || msg.includes("Remote save failed: 401")) {
        setError("Unauthorized: wrong Sync PIN for this key (or missing PIN).");
      } else if (msg.includes("Remote save failed: 409")) {
        setError("Conflict: another device updated the data. Sync again to pull latest.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Sync &amp; Multi‑Device</h3>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#a1a1aa" }}>
        Use a shared key + PIN to synchronise your Finance Cockpit state across devices.
        Enter the same key and PIN on each device, then click “Sync now”.
      </div>

      <label style={{ ...styles.label, flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ marginBottom: 4 }}>Sync Key</span>
        <input
          style={styles.input}
          type="text"
          value={sharedKey}
          onChange={(e) => setSharedKey(e.target.value)}
          placeholder="Enter a sync key"
        />
      </label>

      <label style={{ ...styles.label, flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ marginBottom: 4 }}>Sync PIN {hasRemote ? "(required)" : "(optional)"}</span>
        <input
          style={styles.input}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN (not stored; used to unlock this key)"
        />
        <span style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          PIN is SHA‑256 hashed in your browser; only the hash is sent.
        </span>
      </label>

      <button
        style={{
          ...styles.editButton,
          padding: "6px 12px",
          width: "100%",
          marginTop: 8,
          opacity: loading ? 0.6 : 1,
        }}
        onClick={handleSync}
        disabled={loading}
      >
        {loading ? "Syncing…" : "Sync now"}
      </button>

      {lastSynced && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#6b7280" }}>
          Last synced: {new Date(lastSynced).toLocaleString()}
        </div>
      )}
      {message && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#4ade80" }}>{message}</div>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{error}</div>
      )}
    </div>
  );
}

// Styles duplicated from App.tsx to avoid a circular dependency.
const styles: Record<string, any> = {
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    background: "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
    border: "1px solid #27272a",
    boxShadow: "0 18px 40px rgba(0,0,0,0.6)",
  },
  cardTitle: {
    marginTop: 0,
    marginBottom: 12,
    fontSize: 16,
    fontWeight: 600,
    color: "#f4f4f5",
  },
  label: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 12,
    fontSize: 13,
    color: "#a1a1aa",
  },
  input: {
    padding: 8,
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #3f3f46",
    background: "#18181b",
    color: "#e4e4e7",
    width: "100%",
  },
  editButton: {
    padding: "4px 8px",
    fontSize: 13,
    borderRadius: 999,
    border: "none",
    background: "#3b82f6",
    color: "#f9fafb",
  },
};
