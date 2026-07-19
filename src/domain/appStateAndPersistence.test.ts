// src/domain/appStateAndPersistence.test.ts
import { createInitialAppState, upgradeAppState, sanitizeSchedule } from "./appState";
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

  test("upgradeAppState coerces junk rule fields to defaults", () => {
    const raw: any = {
      version: 1,
      account: { startingBalance: 100 },
      settings: { startDate: "2025-01-01", horizonDays: 30, minSafeBalance: 0 },
      rules: [
        { id: "r1", name: 42, amount: "oops", isVariable: "yes", schedule: { type: "monthly", day: 5 } },
        { name: "no id, dropped" },
        null,
      ],
      overrides: {},
    };
    const upgraded = upgradeAppState(raw);
    expect(upgraded.rules).toHaveLength(1);
    expect(upgraded.rules[0].name).toBe("Rule");
    expect(upgraded.rules[0].amount).toBe(0);
    expect(upgraded.rules[0].isVariable).toBe(true);
  });

  test("upgradeAppState drops rules with corrupt schedules", () => {
    const raw: any = {
      version: 1,
      account: { startingBalance: 0 },
      settings: { startDate: "2025-01-01", horizonDays: 30, minSafeBalance: 0 },
      rules: [
        { id: "r1", name: "Bad", amount: 1, isVariable: false, schedule: null },
        { id: "r2", name: "Unknown type", amount: 1, isVariable: false, schedule: { type: "weekly", day: 3 } },
        { id: "r3", name: "Bad day", amount: 1, isVariable: false, schedule: { type: "monthly", day: 42 } },
        { id: "r4", name: "Bad anchor", amount: 1, isVariable: false, schedule: { type: "biweekly", anchorDate: "not-a-date" } },
        { id: "r5", name: "Good", amount: 1, isVariable: false, schedule: { type: "monthly", day: 15 } },
      ],
      overrides: {},
    };
    const upgraded = upgradeAppState(raw);
    expect(upgraded.rules.map((r) => r.id)).toEqual(["r5"]);
  });

  test("upgradeAppState replaces a malformed startDate with today", () => {
    const raw: any = {
      version: 1,
      account: { startingBalance: 0 },
      settings: { startDate: "garbage", horizonDays: 30, minSafeBalance: 0 },
      rules: [],
      overrides: {},
    };
    const upgraded = upgradeAppState(raw);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(upgraded.settings.startDate)).toBe(true);
    expect(upgraded.settings.startDate).not.toBe("garbage");
  });
});

describe("sanitizeSchedule", () => {
  test("accepts the three valid schedule shapes", () => {
    expect(sanitizeSchedule({ type: "monthly", day: 1 })).toEqual({ type: "monthly", day: 1 });
    expect(
      sanitizeSchedule({ type: "twiceMonth", day1: 15, day2: 31, businessDayConvention: "previousBusinessDayUS" })
    ).toEqual({ type: "twiceMonth", day1: 15, day2: 31, businessDayConvention: "previousBusinessDayUS" });
    expect(sanitizeSchedule({ type: "biweekly", anchorDate: "2025-06-01" })).toEqual({
      type: "biweekly",
      anchorDate: "2025-06-01",
    });
  });

  test("drops unknown business day conventions but keeps the schedule", () => {
    expect(
      sanitizeSchedule({ type: "twiceMonth", day1: 1, day2: 15, businessDayConvention: "nextBusinessDay" })
    ).toEqual({ type: "twiceMonth", day1: 1, day2: 15 });
  });

  test("rejects malformed schedules", () => {
    expect(sanitizeSchedule(null)).toBeNull();
    expect(sanitizeSchedule("monthly")).toBeNull();
    expect(sanitizeSchedule({ type: "monthly" })).toBeNull();
    expect(sanitizeSchedule({ type: "monthly", day: 0 })).toBeNull();
    expect(sanitizeSchedule({ type: "monthly", day: 1.5 })).toBeNull();
    expect(sanitizeSchedule({ type: "twiceMonth", day1: 15 })).toBeNull();
    expect(sanitizeSchedule({ type: "biweekly", anchorDate: "2025-13-99" })).toBeNull();
    expect(sanitizeSchedule({ type: "weekly", day: 3 })).toBeNull();
  });
});
