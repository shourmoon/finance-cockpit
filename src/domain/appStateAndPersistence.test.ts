// src/domain/appStateAndPersistence.test.ts
import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createInitialAppState,
  upgradeAppState,
  sanitizeSchedule,
  sanitizeAdhocTransaction,
  APP_STATE_VERSION,
} from "./appState";
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

  test("preserves an explicit 'none' business-day convention", () => {
    expect(
      sanitizeSchedule({ type: "twiceMonth", day1: 1, day2: 15, businessDayConvention: "none" })
    ).toEqual({ type: "twiceMonth", day1: 1, day2: 15, businessDayConvention: "none" });
  });
});

describe("upgradeAppState - defaults for a current-version state with missing fields", () => {
  test("fills account, settings, rules and overrides defaults", () => {
    const upgraded = upgradeAppState({ version: 1 });
    expect(upgraded.account.startingBalance).toBe(0);
    expect(upgraded.settings.horizonDays).toBe(90);
    expect(upgraded.settings.minSafeBalance).toBe(0);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(upgraded.settings.startDate)).toBe(true);
    // rules missing (not an array) => default rule set
    expect(upgraded.rules.length).toBeGreaterThan(0);
    expect(upgraded.overrides).toEqual({});
  });

  test("discards a non-object overrides map", () => {
    const upgraded = upgradeAppState({
      version: 1,
      rules: [],
      overrides: "nope",
    });
    expect(upgraded.overrides).toEqual({});
  });

  test("treats a missing version as legacy and resets to fresh state", () => {
    const upgraded = upgradeAppState({ account: { startingBalance: 500 } });
    expect(upgraded.account.startingBalance).toBe(500);
    expect(upgraded.version).toBeGreaterThanOrEqual(1);
  });
});

describe("sanitizeAdhocTransaction", () => {
  test("accepts a valid transaction and coerces junk name/amount", () => {
    expect(
      sanitizeAdhocTransaction({ id: "t1", name: "Bonus", amount: 5000, date: "2026-08-15" })
    ).toEqual({ id: "t1", name: "Bonus", amount: 5000, date: "2026-08-15" });
    expect(
      sanitizeAdhocTransaction({ id: "t2", name: 42, amount: "x", date: "2026-08-15" })
    ).toEqual({ id: "t2", name: "Transaction", amount: 0, date: "2026-08-15" });
  });

  test("rejects malformed transactions", () => {
    expect(sanitizeAdhocTransaction(null)).toBeNull();
    expect(sanitizeAdhocTransaction("txn")).toBeNull();
    expect(sanitizeAdhocTransaction({ name: "no id", amount: 1, date: "2026-08-15" })).toBeNull();
    expect(sanitizeAdhocTransaction({ id: "", amount: 1, date: "2026-08-15" })).toBeNull();
    expect(sanitizeAdhocTransaction({ id: "t", amount: 1, date: "garbage" })).toBeNull();
  });
});

describe("upgradeAppState - v1 to v2 migration (adhocTransactions)", () => {
  test("a v1 state keeps its rules, settings and overrides, gaining an empty list", () => {
    const v1: any = {
      version: 1,
      account: { startingBalance: 777 },
      settings: { startDate: "2026-01-01", horizonDays: 45, minSafeBalance: 50 },
      rules: [
        { id: "r1", name: "Rent", amount: -1500, isVariable: false, schedule: { type: "monthly", day: 1 } },
      ],
      overrides: { "r1__2026-02-01": { eventKey: "r1__2026-02-01", overrideAmount: -1600 } },
    };
    const upgraded = upgradeAppState(v1);
    expect(upgraded.version).toBe(APP_STATE_VERSION);
    expect(upgraded.account.startingBalance).toBe(777);
    expect(upgraded.settings.horizonDays).toBe(45);
    expect(upgraded.rules).toHaveLength(1);
    expect(upgraded.overrides["r1__2026-02-01"].overrideAmount).toBe(-1600);
    expect(upgraded.adhocTransactions).toEqual([]);
  });

  test("a legacy pre-v1 state still resets but keeps the balance", () => {
    const upgraded = upgradeAppState({ version: 0, account: { startingBalance: 42 } });
    expect(upgraded.version).toBe(APP_STATE_VERSION);
    expect(upgraded.account.startingBalance).toBe(42);
    expect(upgraded.adhocTransactions).toEqual([]);
  });

  test("sanitizes stored adhocTransactions, dropping corrupt entries", () => {
    const upgraded = upgradeAppState({
      version: 2,
      rules: [],
      adhocTransactions: [
        { id: "good", name: "Bonus", amount: 100, date: "2026-09-01" },
        { id: "bad-date", name: "X", amount: 1, date: "nope" },
        null,
      ],
      overrides: {},
    });
    expect(upgraded.adhocTransactions.map((t) => t.id)).toEqual(["good"]);
  });

  test("a non-array adhocTransactions becomes an empty list", () => {
    const upgraded = upgradeAppState({ version: 2, rules: [], adhocTransactions: "nope", overrides: {} });
    expect(upgraded.adhocTransactions).toEqual([]);
  });
});

describe("persistence error paths", () => {
  beforeEach(() => window.localStorage.clear());

  test("loadAppState recovers with a fresh state on malformed JSON", () => {
    window.localStorage.setItem("finance-cockpit-app-state-v1", "{not json");
    const loaded = loadAppState();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(createInitialAppState().version);
  });

  test("saveAppState swallows serialization failures", () => {
    const circular: any = { version: 1 };
    circular.self = circular; // JSON.stringify throws on this
    expect(() => saveAppState(circular)).not.toThrow();
  });

  test("clearAppState swallows storage failures", () => {
    const spy = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    expect(() => clearAppState()).not.toThrow();
    spy.mockRestore();
  });
});
