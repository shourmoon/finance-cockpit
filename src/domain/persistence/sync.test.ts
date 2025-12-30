// src/domain/persistence/sync.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { getLocalSnapshot, applySnapshot, syncNow } from "./sync";
import { saveAppState, loadAppState } from "../persistence";
import {
  saveMortgageUIState,
  loadMortgageUIState,
  createDefaultMortgageUIState,
} from "../mortgage/persistence";
import type { RemotePersistenceAdapter, RemoteStatePayload, RemoteStateResponse } from "./remote";

type RemoteMem = RemoteStateResponse | null;

function makeFakeAdapter(remoteRef: { current: RemoteMem }): RemotePersistenceAdapter {
  return {
    async loadState(_sharedKey: string) {
      return remoteRef.current;
    },
    async saveState(_sharedKey: string, payload: RemoteStatePayload) {
      // simulate optimistic concurrency
      if (
        remoteRef.current &&
        payload.prev_updated_at &&
        remoteRef.current.updated_at !== payload.prev_updated_at
      ) {
        // match worker semantics: 409 conflict
        throw new Error("Remote save failed: 409");
      }
      const now = new Date().toISOString();
      remoteRef.current = {
        app_state: payload.app_state,
        mortgage_ui: payload.mortgage_ui,
        updated_at: now,
      };
      return now;
    },
  };
}

describe("sync helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("getLocalSnapshot captures the current persisted state", () => {
    saveAppState({
      account: { startingBalance: 500 },
      horizonDays: 365,
      recurringBills: [],
      upcomingBills: [],
      oneTimeBills: [],
      rules: [],
    } as any);

    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 200000;
    saveMortgageUIState(mortgage);

    const snap = getLocalSnapshot();
    expect(snap.app_state.account.startingBalance).toBe(500);
    expect(snap.mortgage_ui.terms.principal).toBe(200000);

    // snapshot guarantees these are strings
    expect(typeof snap.device_id).toBe("string");
    expect(typeof snap.updated_at).toBe("string");
  });

  it("applySnapshot writes local state", () => {
    const snap = {
      schemaVersion: 1,
      app_state: {
        account: { startingBalance: 111 },
        horizonDays: 100,
        recurringBills: [],
        upcomingBills: [],
        oneTimeBills: [],
        rules: [],
      },
      mortgage_ui: (() => {
        const m = createDefaultMortgageUIState();
        m.terms.principal = 333333;
        return m;
      })(),
      updated_at: new Date().toISOString(),
      device_id: "test-device",
    };

    applySnapshot(snap as any);

    const a = loadAppState();
    const m = loadMortgageUIState();
    expect(a?.account.startingBalance).toBe(111);
    expect(m?.terms.principal).toBe(333333);
  });

  it("syncNow initialises (pushes) local state when remote is empty", async () => {
    saveAppState({
      account: { startingBalance: 999 },
      horizonDays: 365,
      recurringBills: [],
      upcomingBills: [],
      oneTimeBills: [],
      rules: [],
    } as any);

    const mortgage = createDefaultMortgageUIState();
    mortgage.terms.principal = 123456;
    saveMortgageUIState(mortgage);

    const remoteRef = { current: null as RemoteMem };
    const adapter = makeFakeAdapter(remoteRef);

    const result = await syncNow("abc", adapter);
    expect(result.direction).toBe("initialise");
    expect(typeof result.remoteUpdatedAt).toBe("string");

    expect(remoteRef.current).not.toBeNull();
    expect(remoteRef.current!.app_state.account.startingBalance).toBe(999);
    expect(remoteRef.current!.mortgage_ui.terms.principal).toBe(123456);
  });

  it("syncNow pulls remote state when last sync is null", async () => {
    // remote exists
    const remoteRef = {
      current: {
        app_state: {
          account: { startingBalance: 321 },
          horizonDays: 365,
          recurringBills: [],
          upcomingBills: [],
          oneTimeBills: [],
          rules: [],
        },
        mortgage_ui: (() => {
          const m = createDefaultMortgageUIState();
          m.terms.principal = 777777;
          return m;
        })(),
        updated_at: new Date().toISOString(),
      } as RemoteStateResponse,
    };
    const adapter = makeFakeAdapter(remoteRef);

    const result = await syncNow("abc", adapter);
    expect(result.direction).toBe("pull");
    expect(result.remoteUpdatedAt).toBe(remoteRef.current!.updated_at);

    const localApp = loadAppState();
    const localMort = loadMortgageUIState();
    expect(localApp?.account.startingBalance).toBe(321);
    expect(localMort?.terms.principal).toBe(777777);
  });

  it("syncNow pushes when remote unchanged since last sync", async () => {
    // remote exists
    const remoteRef = {
      current: {
        app_state: {
          account: { startingBalance: 1 },
          horizonDays: 365,
          recurringBills: [],
          upcomingBills: [],
          oneTimeBills: [],
          rules: [],
        },
        mortgage_ui: createDefaultMortgageUIState(),
        updated_at: new Date().toISOString(),
      } as RemoteStateResponse,
    };
    const adapter = makeFakeAdapter(remoteRef);

    // set last sync meta to match remote.updated_at
    localStorage.setItem(
      "finance-cockpit:last-sync",
      JSON.stringify({ shared_key: "abc", remote_updated_at: remoteRef.current.updated_at })
    );

    // local state changed
    saveAppState({
      account: { startingBalance: 555 },
      horizonDays: 365,
      recurringBills: [],
      upcomingBills: [],
      oneTimeBills: [],
      rules: [],
    } as any);

    const res = await syncNow("abc", adapter);
    expect(res.direction).toBe("push");

    expect(remoteRef.current!.app_state.account.startingBalance).toBe(555);
    expect(typeof res.remoteUpdatedAt).toBe("string");
  });
});
