// src/domain/persistence/remote.ts
//
// Remote persistence contracts for Finance Cockpit. This module
// defines the types and adapter interface that the UI will use to
// synchronise state with a backend once one is available.
//
// For now the default implementation is a no‑op stub that always
// falls back to local data. It is intentionally lightweight so it does
// not impact current behaviour or tests.

import type { AppState } from "../types";
import type { MortgageUIState } from "../mortgage/persistence";

export interface RemoteStateResponse {
  app_state: AppState;
  mortgage_ui: MortgageUIState;
  updated_at: string;
}

export interface RemoteStatePayload {
  app_state: AppState;
  mortgage_ui: MortgageUIState;
  prev_updated_at?: string | null;
}

export interface RemotePersistenceAdapter {
  loadState(sharedKey: string): Promise<RemoteStateResponse | null>;
  saveState(
    sharedKey: string,
    payload: RemoteStatePayload
  ): Promise<string /* updated_at */>;
}

/**
 * No‑op stub adapter. This can be replaced with a real HTTP adapter
 * that talks to /api/bootstrap and /api/state on your backend. Keeping
 * this here means the rest of the app can be wired to the interface
 * without breaking when no server is configured yet.
 */
export const stubRemoteAdapter: RemotePersistenceAdapter = {
  async loadState(_sharedKey: string): Promise<RemoteStateResponse | null> {
    return null;
  },

  async saveState(
    _sharedKey: string,
    _payload: RemoteStatePayload
  ): Promise<string> {
    // Return a synthetic timestamp so callers that expect an
    // updated_at string still have something to work with.
    return new Date().toISOString();
  },
};

