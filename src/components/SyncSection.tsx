// src/components/SyncSection.tsx
//
// Sync & Multi-device UI.
//
// Goals for this component:
// - Make sync status obvious (connected URL, last sync, remote updated_at)
// - Offer explicit actions (Sync now, Pull latest, Push local, Reset metadata)
// - Provide an in-app conflict resolver for real optimistic-concurrency conflicts (HTTP 409)
// - Keep the contract robust: wrong PIN => 401, true conflict => 409, network/CORS => Failed to fetch

import { useEffect, useMemo, useState } from "react";
import type { RemoteStateResponse } from "../domain/persistence/remote";
import { createCloudflareAdapter } from "../domain/persistence/remoteCloudflare";
import { stubRemoteAdapter } from "../domain/persistence/remote";
import { applySnapshot, getLocalSnapshot, syncNow } from "../domain/persistence/sync";
import type { Snapshot } from "../domain/persistence/snapshot";

const SYNC_BASE_URL: string | undefined = (import.meta as any).env?.VITE_SYNC_BASE_URL;

const SYNC_KEY_STORAGE = "finance-cockpit:sync-key";
const LAST_SYNC_STORAGE = "finance-cockpit:last-sync";

type ConflictState = {
  sharedKey: string;
  remote: RemoteStateResponse;
  local: Snapshot;
};

function readLastSyncRemoteUpdatedAt(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.remote_updated_at === "string" ? parsed.remote_updated_at : null;
  } catch {
    return null;
  }
}

function writeLastSyncRemoteUpdatedAt(updatedAt: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SYNC_STORAGE, JSON.stringify({ remote_updated_at: updatedAt }));
  } catch {
    // ignore
  }
}

function clearLastSyncMetadata(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_SYNC_STORAGE);
  } catch {
    // ignore
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
  if (typeof crypto !== "undefined" && (crypto as any).subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await (crypto as any).subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("WebCrypto not available; cannot hash PIN.");
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function SyncSection() {
  const [sharedKey, setSharedKey] = useState<string>(getRememberedSyncKey());
  const [pin, setPin] = useState<string>("");

  const [lastSynced, setLastSynced] = useState<string | null>(readLastSyncRemoteUpdatedAt());
  const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ConflictState | null>(null);

  const hasRemote = !!SYNC_BASE_URL;

  const baseAdapter = useMemo(() => {
    return hasRemote ? createCloudflareAdapter(SYNC_BASE_URL!) : stubRemoteAdapter;
  }, [hasRemote]);

  useEffect(() => {
    setLastSynced(readLastSyncRemoteUpdatedAt());
  }, []);

  async function buildRemoteAdapter() {
    if (!hasRemote) return baseAdapter;
    const p = pin.trim();
    const pinHash = p ? await sha256Hex(p) : null;
    return createCloudflareAdapter(SYNC_BASE_URL!, { pinHash });
  }

  function resetUiState() {
    setMessage(null);
    setError(null);
    setConflict(null);
  }

  function requireInputsOrSetError(): { key: string } | null {
    const key = sharedKey.trim();
    if (!key) {
      setError("Please enter a Sync Key.");
      return null;
    }
    if (hasRemote && !pin.trim()) {
      setError("Please enter a Sync PIN (required for remote sync).");
      return null;
    }
    // Remember key for convenience.
    setRememberedSyncKey(key);
    return { key };
  }

  async function refreshRemoteStatus() {
    resetUiState();
    const req = requireInputsOrSetError();
    if (!req) return;
    setLoading(true);
    try {
      const adapter = await buildRemoteAdapter();
      const remote = await (adapter as any).loadState(req.key);
      setRemoteUpdatedAt(remote?.updated_at ?? null);
      if (!remote) setMessage("No remote snapshot found for this key yet (first sync will initialise it).");
      else setMessage("Remote snapshot loaded.");
    } catch (e: any) {
      setError(mapSyncError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncNow() {
    resetUiState();
    const req = requireInputsOrSetError();
    if (!req) return;

    setLoading(true);
    try {
      const adapter = await buildRemoteAdapter();
      const res = await syncNow(req.key, adapter as any);

      const direction = (res as any).direction as "push" | "pull" | "init";
      const remoteAt = (res as any).remoteUpdatedAt as string | null;
      const actionWord = direction === "push" ? "Pushed" : direction === "pull" ? "Pulled" : "Initialised";

      if (remoteAt) {
        writeLastSyncRemoteUpdatedAt(remoteAt);
        setLastSynced(remoteAt);
        setRemoteUpdatedAt(remoteAt);
      }

      setMessage(`${actionWord} successfully.`);
    } catch (e: any) {
      setError(mapSyncError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePullLatest() {
    resetUiState();
    const req = requireInputsOrSetError();
    if (!req) return;

    setLoading(true);
    try {
      const adapter = await buildRemoteAdapter();
      const remote = await (adapter as any).loadState(req.key);
      if (!remote) {
        setRemoteUpdatedAt(null);
        setMessage("No remote snapshot found for this key yet.");
        return;
      }

      applySnapshot({
        schemaVersion: 1,
        app_state: remote.app_state,
        mortgage_ui: remote.mortgage_ui,
        updated_at: remote.updated_at,
        // device_id is local-only; snapshot persistence keeps its own.
        device_id: "remote",
      } as any);

      writeLastSyncRemoteUpdatedAt(remote.updated_at);
      setLastSynced(remote.updated_at);
      setRemoteUpdatedAt(remote.updated_at);
      setMessage("Pulled latest remote snapshot into this device.");
    } catch (e: any) {
      setError(mapSyncError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handlePushLocal() {
    resetUiState();
    const req = requireInputsOrSetError();
    if (!req) return;

    setLoading(true);
    try {
      const adapter = await buildRemoteAdapter();
      const key = req.key;

      // Fetch current remote state so we can provide prev_updated_at.
      const remote = (await (adapter as any).loadState(key)) as RemoteStateResponse | null;
      const localSnap = getLocalSnapshot();

      try {
        const updatedAt = await (adapter as any).saveState(key, {
          app_state: localSnap.app_state,
          mortgage_ui: localSnap.mortgage_ui,
          prev_updated_at: remote ? remote.updated_at : null,
        });
        writeLastSyncRemoteUpdatedAt(updatedAt);
        setLastSynced(updatedAt);
        setRemoteUpdatedAt(updatedAt);
        setMessage("Pushed local snapshot to remote.");
      } catch (e: any) {
        const msg = String(e?.message ?? "");
        if (msg.includes("Remote save failed: 409")) {
          // Real conflict: remote changed between load and save.
          const latest = (await (adapter as any).loadState(key)) as RemoteStateResponse;
          setRemoteUpdatedAt(latest?.updated_at ?? null);
          setConflict({ sharedKey: key, remote: latest, local: localSnap });
          setError("Conflict detected: remote changed. Choose Keep Local or Keep Remote.");
          return;
        }
        throw e;
      }
    } catch (e: any) {
      setError(mapSyncError(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleKeepRemote() {
    if (!conflict) return;
    resetUiState();
    setLoading(true);
    try {
      applySnapshot({
        schemaVersion: 1,
        app_state: conflict.remote.app_state,
        mortgage_ui: conflict.remote.mortgage_ui,
        updated_at: conflict.remote.updated_at,
        device_id: "remote",
      } as any);
      writeLastSyncRemoteUpdatedAt(conflict.remote.updated_at);
      setLastSynced(conflict.remote.updated_at);
      setRemoteUpdatedAt(conflict.remote.updated_at);
      setMessage("Resolved conflict by keeping Remote (pulled remote snapshot)." );
      setConflict(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleKeepLocal() {
    if (!conflict) return;
    resetUiState();
    const req = requireInputsOrSetError();
    if (!req) return;
    setLoading(true);
    try {
      const adapter = await buildRemoteAdapter();
      const updatedAt = await (adapter as any).saveState(conflict.sharedKey, {
        app_state: conflict.local.app_state,
        mortgage_ui: conflict.local.mortgage_ui,
        // Overwrite using the latest remote updated_at as the concurrency token.
        prev_updated_at: conflict.remote.updated_at,
      });
      writeLastSyncRemoteUpdatedAt(updatedAt);
      setLastSynced(updatedAt);
      setRemoteUpdatedAt(updatedAt);
      setMessage("Resolved conflict by keeping Local (overwrote remote)." );
      setConflict(null);
    } catch (e: any) {
      setError(mapSyncError(e));
    } finally {
      setLoading(false);
    }
  }

  function handleResetMetadata() {
    resetUiState();
    clearLastSyncMetadata();
    setLastSynced(null);
    setMessage("This device's last-sync metadata was cleared.");
  }

  function handleForgetKey() {
    resetUiState();
    setRememberedSyncKey("");
    setSharedKey("");
    setPin("");
    setRemoteUpdatedAt(null);
    setLastSynced(null);
    clearLastSyncMetadata();
    setMessage("Sync key was cleared from this device.");
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Sync &amp; Multi‑Device</h3>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#a1a1aa" }}>
        Enter the same <b>Sync Key</b> and <b>PIN</b> on every device. Use “Sync now” for automatic behaviour,
        or use Pull/Push for explicit control.
      </div>

      <div style={{ ...styles.kvRow, marginBottom: 10 }}>
        <div style={{ color: "#a1a1aa" }}>Remote:</div>
        <div style={{ color: "#e4e4e7" }}>{hasRemote ? SYNC_BASE_URL : "Not configured"}</div>
      </div>
      <div style={{ ...styles.kvRow, marginBottom: 10 }}>
        <div style={{ color: "#a1a1aa" }}>Remote updated_at:</div>
        <div style={{ color: "#e4e4e7" }}>{formatTs(remoteUpdatedAt)}</div>
      </div>
      <div style={{ ...styles.kvRow, marginBottom: 14 }}>
        <div style={{ color: "#a1a1aa" }}>Last synced (this device):</div>
        <div style={{ color: "#e4e4e7" }}>{formatTs(lastSynced)}</div>
      </div>

      <label style={{ ...styles.label, flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ marginBottom: 4 }}>Sync Key</span>
        <input
          style={styles.input}
          type="text"
          value={sharedKey}
          onChange={(e) => setSharedKey(e.target.value)}
          placeholder="e.g. moona-home"
        />
      </label>

      <label style={{ ...styles.label, flexDirection: "column", alignItems: "flex-start" }}>
        <span style={{ marginBottom: 4 }}>Sync PIN {hasRemote ? "(required)" : "(optional)"}</span>
        <input
          style={styles.input}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN (never stored)"
        />
        <span style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          PIN is SHA‑256 hashed in your browser; only the hash is sent.
        </span>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
        <button style={styles.primaryButton(loading)} onClick={handleSyncNow} disabled={loading}>
          {loading ? "Working…" : "Sync now"}
        </button>
        <button style={styles.secondaryButton(loading)} onClick={refreshRemoteStatus} disabled={loading}>
          Refresh status
        </button>

        <button style={styles.secondaryButton(loading)} onClick={handlePullLatest} disabled={loading}>
          Pull latest
        </button>
        <button style={styles.secondaryButton(loading)} onClick={handlePushLocal} disabled={loading}>
          Push local
        </button>

        <button style={styles.tertiaryButton(loading)} onClick={handleResetMetadata} disabled={loading}>
          Reset metadata
        </button>
        <button style={styles.dangerButton(loading)} onClick={handleForgetKey} disabled={loading}>
          Forget key
        </button>
      </div>

      {conflict && (
        <div style={styles.conflictBox}>
          <div style={{ fontWeight: 600, color: "#fbbf24", marginBottom: 6 }}>
            Conflict detected
          </div>
          <div style={{ fontSize: 12, color: "#a1a1aa", marginBottom: 10 }}>
            Remote changed while pushing. Choose which version to keep.
          </div>
          <div style={{ ...styles.kvRow, marginBottom: 6 }}>
            <div style={{ color: "#a1a1aa" }}>Remote updated_at:</div>
            <div style={{ color: "#e4e4e7" }}>{formatTs(conflict.remote.updated_at)}</div>
          </div>
          <div style={{ ...styles.kvRow, marginBottom: 12 }}>
            <div style={{ color: "#a1a1aa" }}>Local captured at:</div>
            <div style={{ color: "#e4e4e7" }}>{formatTs(conflict.local.updated_at)}</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button style={styles.secondaryButton(loading)} onClick={handleKeepRemote} disabled={loading}>
              Keep Remote
            </button>
            <button style={styles.primaryButton(loading)} onClick={handleKeepLocal} disabled={loading}>
              Keep Local
            </button>
          </div>
        </div>
      )}

      {message && <div style={{ marginTop: 10, fontSize: 12, color: "#4ade80" }}>{message}</div>}
      {error && <div style={{ marginTop: 10, fontSize: 12, color: "#f87171" }}>{error}</div>}
    </div>
  );
}

function mapSyncError(e: any): string {
  const msg = String(e?.message ?? "Sync failed");

  if (msg === "Failed to fetch" || msg.toLowerCase().includes("failed to fetch")) {
    return (
      "Failed to reach the sync server. Check: (1) VITE_SYNC_BASE_URL is correct, " +
      "(2) the Worker is deployed, and (3) the Worker returns CORS headers (OPTIONS + Access-Control-Allow-Origin)."
    );
  }
  if (msg.includes("Remote load failed: 401") || msg.includes("Remote save failed: 401")) {
    return "Unauthorized: wrong Sync PIN for this key (or missing PIN).";
  }
  if (msg.includes("Remote save failed: 409")) {
    return "Conflict: another device updated the remote state.";
  }
  return msg;
}

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
  kvRow: {
    display: "grid",
    gridTemplateColumns: "170px 1fr",
    gap: 10,
    fontSize: 12,
  },
  primaryButton: (disabled: boolean) => ({
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 10,
    border: "none",
    background: "#3b82f6",
    color: "#f9fafb",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  secondaryButton: (disabled: boolean) => ({
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 10,
    border: "1px solid #3f3f46",
    background: "#111827",
    color: "#e5e7eb",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  tertiaryButton: (disabled: boolean) => ({
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 10,
    border: "1px solid #3f3f46",
    background: "#0b1220",
    color: "#a1a1aa",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  dangerButton: (disabled: boolean) => ({
    padding: "8px 12px",
    fontSize: 13,
    borderRadius: 10,
    border: "1px solid #7f1d1d",
    background: "#1f0b0b",
    color: "#fecaca",
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? "not-allowed" : "pointer",
  }),
  conflictBox: {
    marginTop: 12,
    borderRadius: 12,
    padding: 12,
    border: "1px solid #92400e",
    background: "rgba(146, 64, 14, 0.15)",
  },
};
