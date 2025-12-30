// src/domain/persistence/sync.test.ts
// Tests for the synchronisation helper functions. These tests
// simulate a remote backend using an in‑memory object and verify
// that syncNow decides whether to push or pull based on the local
// last‑sync metadata. We also verify that applySnapshot and
// getLocalSnapshot correctly read and write to localStorage.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getLocalSnapshot,
  applySnapshot,
  syncNow,
} from "./sync";
import {
  loadAppState,
  saveAppState,
} from "../persistence";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
} from "../mortgage/persistence";
import { createInitialAppState } from "../appState";
import type {
  RemotePersistenceAdapter,
  RemoteStateResponse,
  RemoteStatePayload,
} from "./remote";

describe("sync helpers", () => {
  beforeEach(() => {
    // Clear any persisted data before each test. jsdom provides
    // window.localStorage.
    window.localStorage.clear();
  });

  it("getLocalSnapshot captures the current persisted state", () => {
    const app = createInitialAppState();
    app.account.startingBalance = 500;
    saveAppState(app);
    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 200000;
    saveMortgageUIState(mortgage);
    const snap = getLocalSnapshot();
    expect(snap.app_state.account.startingBalance).toBe(500);
    expect(snap.mortgage_ui.terms.principal).toBe(200000);
    expect(typeof snap.device_id).toBe("string");
    expect(typeof snap.updated_at).toBe("string");
  });

  it("applySnapshot writes state to local persistence", () => {
    const app = createInitialAppState();
    const mortgage = createDefaultMortgageUIState();
    app.account.startingBalance = 123;
    mortgage.terms.principal = 789000;
    const snap = {
      schemaVersion: 1,
      app_state: app,
      mortgage_ui: mortgage,
      updated_at: "2025-01-01T00:00:00Z",
      device_id: "x",
    } as const;
    applySnapshot(snap);
    const reloadedApp = loadAppState();
    const reloadedMortgage = loadMortgageUIState();
    expect(reloadedApp!.account.startingBalance).toBe(123);
    expect(reloadedMortgage.terms.principal).toBe(789000);
  });

  it("syncNow pushes local state when remote is empty", async () => {
    // Setup local state
    const app = createInitialAppState();
    app.account.startingBalance = 999;
    saveAppState(app);
    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 333333;
    saveMortgageUIState(mortgage);
    // In‑memory remote storage
    let remote: RemoteStateResponse | null = null;
    const fakeAdapter: RemotePersistenceAdapter = {
      async loadState() {
        return remote;
      },
      async saveState(_key: string, payload: RemoteStatePayload) {
        // When saving we create a remote snapshot
        remote = {
          app_state: payload.app_state,
          mortgage_ui: payload.mortgage_ui,
          updated_at: new Date().toISOString(),
        };
        return remote.updated_at;
      },
    };
    const result = await syncNow("abc", fakeAdapter);
    expect(result.direction).toBe("init");
    // syncNow throws on transport/auth errors; success does not include a conflict flag.
    expect(remote).not.toBeNull();
    expect(remote!.app_state.account.startingBalance).toBe(999);
    expect(remote!.mortgage_ui.terms.principal).toBe(333333);
  });

  it("syncNow pulls remote state when last sync is null", async () => {
    // Preload remote data
    const remoteApp = createInitialAppState();
    remoteApp.account.startingBalance = 777;
    const remoteMortgage = createDefaultMortgageUIState();
    remoteMortgage.terms.principal = 888888;
    let remote: RemoteStateResponse | null = {
      app_state: remoteApp,
      mortgage_ui: remoteMortgage,
      updated_at: "2025-02-01T00:00:00Z",
    };
    // Fake adapter
    const fakeAdapter: RemotePersistenceAdapter = {
      async loadState() {
        return remote;
      },
      async saveState(_key: string, payload: RemoteStatePayload) {
        remote = {
          app_state: payload.app_state,
          mortgage_ui: payload.mortgage_ui,
          updated_at: new Date().toISOString(),
        };
        return remote.updated_at;
      },
    };
    // Ensure no last sync metadata exists (localStorage cleared in beforeEach)
    const result = await syncNow("abc", fakeAdapter);
    expect(result.direction).toBe("pull");
    // syncNow throws on transport/auth errors; success does not include a conflict flag.
    // Local state should now match remote
    const localApp = loadAppState();
    const localMortgage = loadMortgageUIState();
    expect(localApp!.account.startingBalance).toBe(777);
    expect(localMortgage.terms.principal).toBe(888888);
  });

  it("syncNow prefers pulling when remote updated_at differs", async () => {
    // Seed last sync info to indicate we've synced remote v1
    window.localStorage.setItem(
      "finance-cockpit:last-sync",
      JSON.stringify({ remote_updated_at: "2025-02-01T00:00:00Z" })
    );
    // Local state is different from remote
    const app = createInitialAppState();
    app.account.startingBalance = 100;
    saveAppState(app);
    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 100000;
    saveMortgageUIState(mortgage);
    // Remote has been updated since last sync
    let remote: RemoteStateResponse | null = {
      app_state: { ...app, account: { ...app.account, startingBalance: 200 } },
      mortgage_ui: { ...mortgage, terms: { ...mortgage.terms, principal: 250000 } },
      updated_at: "2025-03-01T00:00:00Z",
    };
    const fakeAdapter: RemotePersistenceAdapter = {
      async loadState() {
        return remote;
      },
      async saveState(_key: string, payload: RemoteStatePayload) {
        remote = {
          app_state: payload.app_state,
          mortgage_ui: payload.mortgage_ui,
          updated_at: new Date().toISOString(),
        };
        return remote.updated_at;
      },
    };
    const res = await syncNow("abc", fakeAdapter);
    expect(res.direction).toBe("pull");
    const localApp = loadAppState();
    const localMortgage = loadMortgageUIState();
    expect(localApp!.account.startingBalance).toBe(200);
    expect(localMortgage.terms.principal).toBe(250000);
  });

  it("syncNow pushes when remote unchanged since last sync", async () => {
    // Persist last sync timestamp
    window.localStorage.setItem(
      "finance-cockpit:last-sync",
      JSON.stringify({ remote_updated_at: "2025-05-01T00:00:00Z" })
    );
    // Local state to push
    const app = createInitialAppState();
    app.account.startingBalance = 555;
    saveAppState(app);
    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 444444;
    saveMortgageUIState(mortgage);
    // Remote matches last sync timestamp
    let remote: RemoteStateResponse | null = {
      app_state: createInitialAppState(),
      mortgage_ui: createDefaultMortgageUIState(),
      updated_at: "2025-05-01T00:00:00Z",
    };
    const fakeAdapter: RemotePersistenceAdapter = {
      async loadState() {
        return remote;
      },
      async saveState(_key: string, payload: RemoteStatePayload) {
        remote = {
          app_state: payload.app_state,
          mortgage_ui: payload.mortgage_ui,
          updated_at: new Date().toISOString(),
        };
        return remote.updated_at;
      },
    };
    const res = await syncNow("abc", fakeAdapter);
    expect(res.direction).toBe("push");
    // Remote should now contain pushed local state
    expect(remote!.app_state.account.startingBalance).toBe(555);
    expect(remote!.mortgage_ui.terms.principal).toBe(444444);
  });
});