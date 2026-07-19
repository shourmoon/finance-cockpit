// src/domain/persistence/windowless.test.ts
//
// Exercises the `typeof window === "undefined"` guards throughout the
// persistence/sync stack. We stub `window` to undefined within the jsdom
// environment (rather than a separate node environment) so coverage
// merges cleanly. Every call must degrade gracefully.

import { describe, it, expect, afterEach, vi } from "vitest";
import { getLocalSnapshot, applySnapshot, loadPrePullBackup, syncNow } from "./sync";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
} from "../mortgage/persistence";
import { createInitialAppState } from "../appState";
import type { RemotePersistenceAdapter } from "./remote";

describe("persistence without a window", () => {
  afterEach(() => vi.unstubAllGlobals());

  function removeWindow() {
    vi.stubGlobal("window", undefined);
  }

  it("loadMortgageUIState falls back to defaults (v2 and v1 guards)", () => {
    removeWindow();
    expect(loadMortgageUIState()).toEqual(createDefaultMortgageUIState());
  });

  it("saveMortgageUIState is a no-op instead of throwing", () => {
    removeWindow();
    expect(() =>
      saveMortgageUIState(createDefaultMortgageUIState())
    ).not.toThrow();
  });

  it("loadPrePullBackup returns null", () => {
    removeWindow();
    expect(loadPrePullBackup()).toBeNull();
  });

  it("getLocalSnapshot uses the test device id and recovered app state", () => {
    removeWindow();
    const snap = getLocalSnapshot();
    expect(snap.device_id).toBe("test-device");
    expect(snap.app_state.version).toBe(createInitialAppState().version);
  });

  it("applySnapshot does not throw", () => {
    removeWindow();
    expect(() =>
      applySnapshot({
        schemaVersion: 1,
        app_state: createInitialAppState(),
        mortgage_ui: createDefaultMortgageUIState(),
        updated_at: "2025-01-01T00:00:00Z",
        device_id: "x",
      })
    ).not.toThrow();
  });

  it("syncNow completes a pull without any storage available", async () => {
    removeWindow();
    const adapter: RemotePersistenceAdapter = {
      async loadState() {
        return {
          app_state: createInitialAppState(),
          mortgage_ui: createDefaultMortgageUIState(),
          updated_at: "2025-06-01T00:00:00Z",
        };
      },
      async saveState() {
        return "2025-06-02T00:00:00Z";
      },
    };
    // No last-sync metadata can exist without localStorage => pull.
    expect((await syncNow("k", adapter)).direction).toBe("pull");
  });
});
