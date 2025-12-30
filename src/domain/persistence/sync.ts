// src/domain/persistence/sync.ts
//
// This module provides helper functions to synchronise the user's
// local data with a remote backend via the RemotePersistenceAdapter
// interface. It is intentionally decoupled from the UI; callers
// decide when to invoke sync operations. Synchronisation is
// optimistic and uses simple timestamp comparison to decide whether
// to push local changes or pull remote updates. Conflict detection
// can be extended in future versions.

import { createSnapshot } from "./snapshot";
import type { Snapshot } from "./snapshot";
import { loadAppState, saveAppState } from "../persistence";
import {
  loadMortgageUIState,
  saveMortgageUIState,
} from "../mortgage/persistence";
import type {
  RemotePersistenceAdapter,
  RemoteStatePayload,
  RemoteStateResponse,
} from "./remote";

// Key names used in localStorage for device and sync metadata. If
// these keys change they should be migrated appropriately.
const DEVICE_ID_KEY = "finance-cockpit:device-id";
const LAST_SYNC_KEY = "finance-cockpit:last-sync";

interface LastSyncInfo {
  /** The updated_at timestamp returned by the backend on the last sync. */
  remote_updated_at: string | null;
}

/**
 * Retrieve (or generate) a stable device identifier for this browser.
 * When synchronising snapshots across devices the backend uses
 * device_id to detect which device last wrote a snapshot. If
 * crypto.randomUUID is unavailable a simple random string fallback is
 * used instead.
 */
function getDeviceId(): string {
  if (typeof window === "undefined") {
    // For tests we can just return a constant.
    return "test-device";
  }
  let existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing && typeof existing === "string") {
    return existing;
  }
  // Generate a new identifier. Prefer crypto.randomUUID if present.
  let newId: string;
  if (typeof crypto !== "undefined" && typeof (crypto as any).randomUUID === "function") {
    newId = (crypto as any).randomUUID();
  } else {
    newId = `device-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
  try {
    window.localStorage.setItem(DEVICE_ID_KEY, newId);
  } catch {
    // Ignore failures; the ID will be regenerated next time.
  }
  return newId;
}

/**
 * Load the last sync information from localStorage. If none exists,
 * returns a default object where remote_updated_at is null.
 */
function getLastSyncInfo(): LastSyncInfo {
  if (typeof window === "undefined") {
    return { remote_updated_at: null };
  }
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return { remote_updated_at: null };
    const parsed = JSON.parse(raw) as LastSyncInfo;
    if (parsed && typeof parsed.remote_updated_at === "string") {
      return parsed;
    }
    return { remote_updated_at: null };
  } catch {
    return { remote_updated_at: null };
  }
}

/**
 * Persist the last sync information to localStorage. Callers should
 * update this after successfully pushing or pulling from the backend.
 */
function setLastSyncInfo(info: LastSyncInfo): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(info));
  } catch {
    // Non‑fatal if we can't persist sync metadata.
  }
}

/**
 * Build a snapshot from the current in‑memory application state. The
 * returned snapshot uses the device_id from localStorage (or
 * generates a new one if absent) and a fresh updated_at timestamp.
 */
export function getLocalSnapshot(): Snapshot {
  const appState = loadAppState() ?? (() => {
    throw new Error("AppState is unavailable");
  })();
  const mortgageState = loadMortgageUIState();
  const deviceId = getDeviceId();
  return createSnapshot(appState, mortgageState, deviceId);
}

/**
 * Apply a snapshot to the local state stores. The internal
 * persistence functions update localStorage and trigger the
 * appropriate migrations. A new updated_at timestamp is NOT
 * generated here; the snapshot's timestamp is preserved.
 */
export function applySnapshot(snapshot: Snapshot): void {
  // Persist app state and mortgage UI using the existing helpers.
  saveAppState(snapshot.app_state);
  saveMortgageUIState(snapshot.mortgage_ui);
}

/**
 * Synchronise with the remote backend. Given a shared key and an
 * adapter implementation this helper decides whether to push the
 * current local snapshot or pull the remote snapshot. The logic is:
 *  - If no remote state exists, push local state to the backend.
 *  - If the remote has never been synced locally (remote_updated_at
 *    in last sync info is null), pull remote state if it exists or
 *    push local state if remote is empty.
 *  - If the remote's updated_at differs from the last sync value,
 *    prefer pulling the remote snapshot over local changes. This is
 *    a conservative conflict strategy; it always prefers remote
 *    changes to avoid overwriting someone else's edits. A more
 *    sophisticated implementation could expose UI to resolve
 *    conflicts, but that's beyond the scope of this phase.
 *  - Otherwise push the local snapshot to the backend, passing
 *    prev_updated_at for optimistic concurrency control.
 *
 * Returns an object describing what happened: the direction
 * ("init", "pull" or "push"), the remote updated_at timestamp (if any)
 * and a boolean flag indicating whether a conflict was detected.
 */
export async function syncNow(
  sharedKey: string,
  remoteAdapter: RemotePersistenceAdapter
): Promise<{
  direction: "init" | "pull" | "push";
  remoteUpdatedAt: string | null;
}> {
  // Load the last sync metadata. This may be null on first run.
  const lastSync = getLastSyncInfo();
  // Fetch remote state. IMPORTANT: do NOT convert transport/auth errors into
  // "conflict". Surface them so the UI can show the real cause (401/CORS/etc.).
  const remoteState: RemoteStateResponse | null = await remoteAdapter.loadState(sharedKey);

  // If the backend has no data for this key, push our local snapshot.
  if (!remoteState) {
    const local = getLocalSnapshot();
    const payload: RemoteStatePayload = {
      app_state: local.app_state,
      mortgage_ui: local.mortgage_ui,
      prev_updated_at: null,
    };
    const updated = await remoteAdapter.saveState(sharedKey, payload);
    setLastSyncInfo({ remote_updated_at: updated });
    return { direction: "init", remoteUpdatedAt: updated };
  }

  const remoteUpdatedAt = remoteState.updated_at;
  const lastRemote = lastSync.remote_updated_at;

  // Case: never synced before locally (no lastRemote) => pull remote.
  if (!lastRemote) {
    applySnapshot({
      schemaVersion: 1,
      app_state: remoteState.app_state,
      mortgage_ui: remoteState.mortgage_ui,
      updated_at: remoteUpdatedAt,
      device_id: getDeviceId(),
    });
    setLastSyncInfo({ remote_updated_at: remoteUpdatedAt });
    return { direction: "pull", remoteUpdatedAt };
  }

  // If the remote has changed since last sync, prefer pulling the
  // remote snapshot to avoid clobbering someone else's changes. A more
  // sophisticated implementation could compare local modifications,
  // detect conflicts and surface them to the user.
  if (remoteUpdatedAt !== lastRemote) {
    applySnapshot({
      schemaVersion: 1,
      app_state: remoteState.app_state,
      mortgage_ui: remoteState.mortgage_ui,
      updated_at: remoteUpdatedAt,
      device_id: getDeviceId(),
    });
    setLastSyncInfo({ remote_updated_at: remoteUpdatedAt });
    return { direction: "pull", remoteUpdatedAt };
  }

  // Otherwise push our local state. Use prev_updated_at for optimistic
  // concurrency: the backend should reject if the remote has been
  // updated since we fetched it. We ignore the error here and
  // delegate to the UI.
  const local = getLocalSnapshot();
  const payload: RemoteStatePayload = {
    app_state: local.app_state,
    mortgage_ui: local.mortgage_ui,
    prev_updated_at: remoteUpdatedAt,
  };
  const newUpdated = await remoteAdapter.saveState(sharedKey, payload);
  setLastSyncInfo({ remote_updated_at: newUpdated });
  return { direction: "push", remoteUpdatedAt: newUpdated };
}