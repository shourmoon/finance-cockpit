import { useEffect, useState } from "react";
import { syncNow } from "../domain/persistence/sync";
import { createCloudflareAdapter } from "../domain/persistence/remoteCloudflare";

const SYNC_BASE_URL: string | undefined = (import.meta as any).env?.VITE_SYNC_BASE_URL;

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

async function sha256Hex(input: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(input);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = Array.from(new Uint8Array(digest));
    return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  throw new Error("WebCrypto not available; cannot hash PIN.");
}

export default function SyncSection() {
  const [sharedKey, setSharedKey] = useState("");
  const [pin, setPin] = useState("");

  const [lastSynced, setLastSynced] = useState<string | null>(getLastSyncTime());
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLastSynced(getLastSyncTime());
  }, []);

  async function handleSync() {
    setError(null);
    setMessage(null);

    const key = sharedKey.trim();
    const pinVal = pin.trim();

    if (!key) return setError("Please enter a sync key.");
    if (!pinVal) return setError("Please enter a sync PIN.");
    if (!SYNC_BASE_URL) return setError("VITE_SYNC_BASE_URL is not set. Remote sync is not configured.");

    setLoading(true);
    try {
      const pinHash = await sha256Hex(pinVal);
      const remote = createCloudflareAdapter(SYNC_BASE_URL, { pinHash });

      const res = await syncNow(key, remote);

      const actionWord =
        res.direction === "push" ? "pushed" : res.direction === "pull" ? "pulled" : "initialised";

      setMessage(`Sync OK — ${actionWord}. Updated at ${res.remoteUpdatedAt}.`);
      setLastSynced(res.remoteUpdatedAt);
    } catch (e: any) {
      const msg = String(e?.message ?? "Sync failed");

      if (msg.includes(": 401")) {
        setError("Unauthorized: wrong Sync PIN for this key (or missing PIN).");
      } else if (msg.includes(": 409")) {
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
      <h3 style={styles.cardTitle}>Sync &amp; Multi-Device</h3>

      <div style={{ marginBottom: 12, fontSize: 13, color: "#a1a1aa" }}>
        Use a shared key + PIN to sync your data across devices. Use the same values everywhere.
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
        <span style={{ marginBottom: 4 }}>Sync PIN</span>
        <input
          style={styles.input}
          type="password"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN (same across devices)"
        />
        <span style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>
          PIN is SHA-256 hashed in your browser; only the hash is sent.
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
      {message && <div style={{ marginTop: 8, fontSize: 12, color: "#4ade80" }}>{message}</div>}
      {error && <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>{error}</div>}
    </div>
  );
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
  cardTitle: { marginTop: 0, marginBottom: 12, fontSize: 16, fontWeight: 600, color: "#f4f4f5" },
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
  editButton: {
    padding: "4px 8px",
    fontSize: 13,
    borderRadius: 999,
    border: "none",
    background: "#3b82f6",
    color: "#f9fafb",
  },
};
