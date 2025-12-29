// src/domain/persistence/snapshot.ts
//
// This module defines the unified snapshot format used when
// persisting state locally and when syncing with a remote backend.
// A snapshot captures the entire user‑visible application state in a
// single object, along with metadata about when it was last updated
// and which device produced it. Having a single canonical shape makes
// migrations and synchronisation across devices much easier.

import type { AppState } from "../types";
import type { MortgageUIState } from "../mortgage/persistence";

/**
 * The current schema version for snapshots. Increment this number if
 * the shape of `Snapshot` changes in backwards‑incompatible ways.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * A complete snapshot of the application's persisted state. The
 * snapshot combines the cashflow AppState and the Mortgage UI state
 * together with metadata used for synchronisation. When syncing with
 * a backend the `updated_at` timestamp and `device_id` are used to
 * detect conflicts and decide which version should win.
 */
export interface Snapshot {
  /** The version of the snapshot schema. */
  schemaVersion: number;
  /** The primary cashflow application state. */
  app_state: AppState;
  /** The mortgage UI state (terms, prepayments, scenarios, etc.). */
  mortgage_ui: MortgageUIState;
  /** ISO8601 timestamp of the last update to this snapshot. */
  updated_at: string;
  /** A stable identifier for the device that produced the snapshot. */
  device_id: string;
}

/**
 * Create a new snapshot object. Callers should provide the current
 * AppState and MortgageUIState. If no `updated_at` value is
 * supplied the current time will be used. A device ID must always be
 * provided so that remote backends can distinguish between devices.
 */
export function createSnapshot(
  app_state: AppState,
  mortgage_ui: MortgageUIState,
  device_id: string,
  updated_at?: string
): Snapshot {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    app_state,
    mortgage_ui,
    updated_at: updated_at ?? new Date().toISOString(),
    device_id,
  };
}

/**
 * Best effort parsing of an arbitrary value into a Snapshot. Returns
 * null if the input does not resemble a snapshot. We deliberately
 * avoid throwing to ensure sync errors don't crash the app.
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