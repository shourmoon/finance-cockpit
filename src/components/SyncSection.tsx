// src/components/SyncSection.tsx
//
// A UI section that allows the user to configure and trigger
// synchronisation of their Finance Cockpit data across devices. Users
// enter a shared key, then press the "Sync now" button to either
// upload their local state to the backend or pull down state from
// another device. Advanced controls for forcing a push or pull could
// be added in the future.

import { useState, useEffect } from "react";
import { syncNow } from "../domain/persistence/sync";
import { stubRemoteAdapter } from "../domain/persistence/remote";
import { createCloudflareAdapter } from "../domain/persistence/remoteCloudflare";

// Optional: allow configuring the remote base URL via environment
// variable. When undefined, falls back to the stub adapter which
// performs no remote IO. Set VITE_SYNC_BASE_URL in your vite
// environment to the deployed Cloudflare Worker endpoint.
const SYNC_BASE_URL: string | undefined = (import.meta as any).env
  ?.VITE_SYNC_BASE_URL;

function getLastSyncTime(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("finance-cockpit:last-sync");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.remote_updated_at === "string"
      ? parsed.remote_updated_at
      : null;
  } catch {
    return null;
  }
}

export default function SyncSection() {
  const [sharedKey, setSharedKey] = useState<string>("");
  const [lastSynced, setLastSynced] = useState<string | null>(
    getLastSyncTime()
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Determine which adapter to use based on the presence of a
  // configured base URL. If none is provided, the stub adapter is used.
  const remoteAdapter = SYNC_BASE_URL
    ? createCloudflareAdapter(SYNC_BASE_URL)
    : stubRemoteAdapter;

  useEffect(() => {
    setLastSynced(getLastSyncTime());
  }, []);

  async function handleSync() {
    setError(null);
    setMessage(null);
    if (!sharedKey || sharedKey.trim().length === 0) {
      setError("Please enter a sync key");
      return;
    }
    setLoading(true);
    try {
      const res = await syncNow(sharedKey.trim(), remoteAdapter);
      if (res.conflict) {
        setError(
          "Sync conflict detected. Please try again or resolve via another device."
        );
      } else {
        const actionWord = res.direction === "push" ? "pushed" : res.direction === "pull" ? "pulled" : "initialised";
        setMessage(
          `Successfully ${actionWord} data. Updated at ${res.remoteUpdatedAt ?? "n/a"}.`
        );
        setLastSynced(res.remoteUpdatedAt ?? null);
      }
    } catch (e: any) {
      setError(e?.message ?? "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.card}>
      <h3 style={styles.cardTitle}>Sync &amp; Multi‑Device</h3>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#a1a1aa" }}>
        Use a shared key to synchronise your Finance Cockpit state
        across multiple devices. Enter the same key on each device,
        then click “Sync now”.
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
        <div style={{ marginTop: 8, fontSize: 12, color: "#4ade80" }}>
          {message}
        </div>
      )}
      {error && (
        <div style={{ marginTop: 8, fontSize: 12, color: "#f87171" }}>
          {error}
        </div>
      )}
    </div>
  );
}

// These inline styles are a thin wrapper over the global styles
// defined in App.tsx. They are duplicated here to avoid a direct
// import from the App component (which would create a circular
// dependency). If you modify card styling in App.tsx you may want
// to update these as well.
const styles: Record<string, any> = {
  card: {
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    background:
      "linear-gradient(145deg, rgba(24,24,27,0.98), rgba(9,9,11,0.98))",
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