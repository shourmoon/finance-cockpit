// src/domain/persistence/snapshot.ts
//
// Unified snapshot format for local persistence and remote sync.

import type { AppState } from "../types";
import type { MortgageUIState } from "../mortgage/persistence";

/**
 * The current schema version for snapshots.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * A complete snapshot of the application's persisted state.
 */
export interface Snapshot {
  schemaVersion: number;
  app_state: AppState;
  mortgage_ui: MortgageUIState;
  updated_at: string;
  device_id: string;
}

/**
 * Local storage key used to persist a stable device id.
 */
const DEVICE_ID_KEY = "finance-cockpit:device-id";

/**
 * Returns a stable, per-browser device id.
 */
function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "server";

  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `device-${Math.random().toString(16).slice(2)}-${Date.now()}`;

  window.localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}

/**
 * Create a new snapshot.
 *
 * IMPORTANT:
 * - device_id is always generated internally and is always a string
 * - callers cannot accidentally pass the wrong type
 */
export function createSnapshot(
  app_state: AppState,
  mortgage_ui: MortgageUIState,
  opts?: {
    updatedAt?: string;
    deviceId?: string;
  }
): Snapshot {
  const updated_at = opts?.updatedAt ?? new Date().toISOString();
  const device_id = opts?.deviceId ?? getOrCreateDeviceId();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app_state,
    mortgage_ui,
    updated_at: String(updated_at),
    device_id: String(device_id),
  };
}

/**
 * Best-effort parsing of an arbitrary value into a Snapshot.
 */
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as any;

  const { schemaVersion, app_state, mortgage_ui, updated_at, device_id } = obj;

  if (typeof schemaVersion !== "number") return null;
  if (!app_state || typeof app_state !== "object") return null;
  if (!mortgage_ui || typeof mortgage_ui !== "object") return null;
  if (typeof updated_at !== "string" || !updated_at) return null;
  if (typeof device_id !== "string" || !device_id) return null;

  return {
    schemaVersion,
    app_state: app_state as AppState,
    mortgage_ui: mortgage_ui as MortgageUIState,
    updated_at,
    device_id,
  };
}
