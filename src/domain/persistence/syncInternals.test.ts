// src/domain/persistence/syncInternals.test.ts
//
// Covers the defensive branches in sync.ts: device-id generation and
// fallbacks, malformed last-sync metadata, storage write failures, and
// the corrupt-mortgage fallback inside applySnapshot.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getLocalSnapshot,
  applySnapshot,
  loadPrePullBackup,
  syncNow,
} from "./sync";
import { loadMortgageUIState, createDefaultMortgageUIState } from "../mortgage/persistence";
import { saveAppState } from "../persistence";
import { createInitialAppState } from "../appState";
import type { RemotePersistenceAdapter } from "./remote";

const DEVICE_ID_KEY = "finance-cockpit:device-id";
const LAST_SYNC_KEY = "finance-cockpit:last-sync";
const BACKUP_KEY = "finance-cockpit:backup-before-pull";

describe("sync internals - device id", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.unstubAllGlobals());

  it("reuses an existing device id from localStorage", () => {
    window.localStorage.setItem(DEVICE_ID_KEY, "fixed-device");
    saveAppState(createInitialAppState());
    expect(getLocalSnapshot().device_id).toBe("fixed-device");
  });

  it("generates via crypto.randomUUID when available and persists it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-123" });
    saveAppState(createInitialAppState());
    expect(getLocalSnapshot().device_id).toBe("uuid-123");
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe("uuid-123");
  });

  it("falls back to a random string when crypto.randomUUID is missing", () => {
    vi.stubGlobal("crypto", {});
    saveAppState(createInitialAppState());
    const id = getLocalSnapshot().device_id;
    expect(id).toMatch(/^device-/);
  });
});

describe("sync internals - last-sync metadata parsing", () => {
  beforeEach(() => window.localStorage.clear());

  async function pushWith(remoteEmpty: boolean) {
    saveAppState(createInitialAppState());
    const adapter: RemotePersistenceAdapter = {
      async loadState() {
        return remoteEmpty
          ? null
          : {
              app_state: createInitialAppState(),
              mortgage_ui: createDefaultMortgageUIState(),
              updated_at: "2025-01-01T00:00:00Z",
            };
      },
      async saveState() {
        return "2025-01-02T00:00:00Z";
      },
    };
    return syncNow("k", adapter);
  }

  it("treats malformed last-sync JSON as never-synced", async () => {
    window.localStorage.setItem(LAST_SYNC_KEY, "{not json");
    // never-synced => pull when remote has data
    const res = await pushWith(false);
    expect(res.direction).toBe("pull");
  });

  it("treats a wrong-typed remote_updated_at as never-synced", async () => {
    window.localStorage.setItem(
      LAST_SYNC_KEY,
      JSON.stringify({ remote_updated_at: 12345 })
    );
    const res = await pushWith(false);
    expect(res.direction).toBe("pull");
  });
});

describe("sync internals - resilience to storage failures", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("still returns a device id when persisting it throws", () => {
    window.localStorage.clear();
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === "finance-cockpit:device-id") throw new Error("quota");
      return realSetItem.call(this, key, value);
    });
    saveAppState(createInitialAppState());
    expect(typeof getLocalSnapshot().device_id).toBe("string");
  });

  it("completes init even if writing last-sync metadata throws", async () => {
    saveAppState(createInitialAppState());
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (key === LAST_SYNC_KEY) throw new Error("quota");
      return realSetItem.call(this, key, value);
    });

    const adapter: RemotePersistenceAdapter = {
      async loadState() {
        return null;
      },
      async saveState() {
        return "2025-03-01T00:00:00Z";
      },
    };
    const res = await syncNow("k", adapter);
    expect(res.direction).toBe("init");
  });
});

describe("sync internals - applySnapshot and backups", () => {
  beforeEach(() => window.localStorage.clear());

  it("falls back to default mortgage state when the snapshot's mortgage_ui is corrupt", () => {
    applySnapshot({
      schemaVersion: 1,
      app_state: createInitialAppState(),
      mortgage_ui: { terms: { principal: -1 } } as any,
      updated_at: "2025-01-01T00:00:00Z",
      device_id: "d",
    });
    expect(loadMortgageUIState()).toEqual(createDefaultMortgageUIState());
  });

  it("loadPrePullBackup returns null on corrupt backup JSON", () => {
    window.localStorage.setItem(BACKUP_KEY, "{not json");
    expect(loadPrePullBackup()).toBeNull();
  });
});
