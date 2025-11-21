// src/domain/appStateAndPersistence.test.ts
import { createInitialAppState, upgradeAppState } from "./appState";
import { saveAppState, loadAppState, clearAppState } from "./persistence";
import type { AppState } from "./types";

describe("appState & persistence", () => {
  beforeEach(() => {
    // jsdom provides localStorage; we just clear it
    window.localStorage.clear();
  });

  test("createInitialAppState returns sane defaults", () => {
    const state = createInitialAppState();
    expect(state.version).toBeGreaterThanOrEqual(1);
    expect(typeof state.account.startingBalance).toBe("number");
    expect(typeof state.settings.startDate).toBe("string");
    expect(state.settings.horizonDays).toBeGreaterThan(0);
    expect(Array.isArray(state.rules)).toBe(true);
    expect(typeof state.overrides).toBe("object");
  });

  test("upgradeAppState handles completely invalid input by returning fresh state", () => {
    const upgraded = upgradeAppState(null as any);
    const fresh = createInitialAppState();
    expect(upgraded.version).toBe(fresh.version);
    expect(upgraded.settings.horizonDays).toBe(fresh.settings.horizonDays);
  });

  test("upgradeAppState keeps startingBalance when migrating", () => {
    const raw: any = {
      version: 0,
      account: { startingBalance: 1234 },
    };
    const upgraded = upgradeAppState(raw);
    expect(upgraded.account.startingBalance).toBe(1234);
  });

  test("saveAppState / loadAppState round-trips through localStorage", () => {
    const initial = createInitialAppState();
    // tweak a few things
    const modified: AppState = {
      ...initial,
      account: { startingBalance: 999 },
      settings: {
        ...initial.settings,
        horizonDays: 45,
      },
    };

    saveAppState(modified);
    const loaded = loadAppState();

    expect(loaded).not.toBeNull();
    expect(loaded!.account.startingBalance).toBe(999);
    expect(loaded!.settings.horizonDays).toBe(45);
  });

  test("clearAppState removes data from localStorage", () => {
    const state = createInitialAppState();
    saveAppState(state);

    expect(loadAppState()).not.toBeNull();
    clearAppState();
    const afterClear = loadAppState();
    // loadAppState returns null if no data; or a fresh state if parse fails.
    // Because we remove the key, it returns null.
    expect(afterClear).toBeNull();
  });
});
