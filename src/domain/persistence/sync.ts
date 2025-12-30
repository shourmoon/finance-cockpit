// src/domain/persistence/sync.ts
//
// Sync helpers: pull/push based on remote vs local updated_at,
// and store last-sync metadata in localStorage.
//
// IMPORTANT: This module should NEVER treat remote failures as success.
// - Network / auth failures should throw.
// - Only a real remoteUpdatedAt should produce "success".

import { loadAppState, saveAppState } from "../persistence";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  type MortgageUIState,
} from "../mortgage/persistence";
import type { AppState } from "../types";
import type { RemotePersistenceAdapter } from "./remote";
import { createSnapshot } from "./snapshot";
import type { Snapshot } from "./snapshot";

const LAST_SYNC_KEY = "finance-cockpit:last-sync";

export type SyncDirection = "push" | "pull" | "initialise";

export interface SyncResult {
  direction: SyncDirection;
  remoteUpdatedAt: string; // always present on success
}

type LastSyncMeta = {
  shared_key: string;
  remote_updated_at: string;
};

function safeNowIso(): string {
  return new Date().toISOString();
}

function readLastSync(sharedKey: string): LastSyncMeta | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.shared_key === sharedKey &&
      typeof parsed.remote_updated_at === "string"
    ) {
      return parsed as LastSyncMeta;
    }
    return null;
  } catch {
    return null;
  }
}

function writeLastSync(sharedKey: string, remoteUpdatedAt: string): void {
  if (typeof window === "undefined") return;
  const meta: LastSyncMeta = { shared_key: sharedKey, remote_updated_at: remoteUpdatedAt };
  window.localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(meta));
}

export function getLocalSnapshot(): Snapshot {
  const app = loadAppState();
  const mortgage = loadMortgageUIState();

  // If something is missing, still snapshot sane defaults
  const appState: AppState = app ?? ({} as any);
  const mortgageState: MortgageUIState = mortgage ?? ({} as any);

  return createSnapshot(appState, mortgageState, {
    updatedAt: safeNowIso(),
  });
}

export function applySnapshot(snapshot: Snapshot): void {
  saveAppState(snapshot.app_state);
  saveMortgageUIState(snapshot.mortgage_ui);
}

/**
 * Sync algorithm:
 * 1) Load remote state (may be null if no state exists for key)
 * 2) If no remote -> push local (initialise)
 * 3) If remote exists:
 *    - If we have lastSync for this key:
 *        - if remote.updated_at !== lastSync.remote_updated_at -> pull remote
 *        - else -> push local (we assume local changes since last sync)
 *    - else (first time on this device):
 *        - pull remote (remote wins)
 *
 * Any remote load/save failure MUST throw.
 */
export async function syncNow(
  sharedKey: string,
  remote: RemotePersistenceAdapter
): Promise<SyncResult> {
  const key = sharedKey.trim();
  if (!key) throw new Error("Missing shared key");

  // 1) Load remote (throws on 401/500/network)
  const remoteState = await remote.loadState(key);

  // 2) If no remote exists -> initialise by pushing local
  if (!remoteState) {
    const local = getLocalSnapshot();
    const updated = await remote.saveState(key, {
      app_state: local.app_state,
      mortgage_ui: local.mortgage_ui,
      prev_updated_at: null,
    });
    writeLastSync(key, updated);
    return { direction: "initialise", remoteUpdatedAt: updated };
  }

  // 3) Remote exists
  const lastSync = readLastSync(key);

  // First time on this device: pull remote
  if (!lastSync) {
    applySnapshot({
      schemaVersion: 1,
      app_state: remoteState.app_state,
      mortgage_ui: remoteState.mortgage_ui,
      updated_at: remoteState.updated_at,
      device_id: "remote",
    });
    writeLastSync(key, remoteState.updated_at);
    return { direction: "pull", remoteUpdatedAt: remoteState.updated_at };
  }

  // If remote changed since last sync, pull
  if (remoteState.updated_at !== lastSync.remote_updated_at) {
    applySnapshot({
      schemaVersion: 1,
      app_state: remoteState.app_state,
      mortgage_ui: remoteState.mortgage_ui,
      updated_at: remoteState.updated_at,
      device_id: "remote",
    });
    writeLastSync(key, remoteState.updated_at);
    return { direction: "pull", remoteUpdatedAt: remoteState.updated_at };
  }

  // Otherwise push local changes (optimistic concurrency using prev_updated_at)
  const local = getLocalSnapshot();
  const updated = await remote.saveState(key, {
    app_state: local.app_state,
    mortgage_ui: local.mortgage_ui,
    prev_updated_at: remoteState.updated_at,
  });
  writeLastSync(key, updated);
  return { direction: "push", remoteUpdatedAt: updated };
}
