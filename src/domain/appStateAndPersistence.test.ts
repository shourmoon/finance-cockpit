// src/domain/appStateAndPersistence.test.ts
import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  createInitialAppState,
  upgradeAppState,
  sanitizeSchedule,
  sanitizeAdhocTransaction,
  sanitizeHorizonDays,
  sanitizeOverrides,
  APP_STATE_VERSION,
  DEFAULT_RESERVE_MONTHS,
  DEFAULT_EXPECTED_RETURN,
  DEFAULT_CAPITAL_GAINS_RATE,
  DEFAULT_COMPARISON_YEARS,
  MAX_HORIZON_DAYS,
  DEFAULT_HORIZON_DAYS,
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

  describe("v2 -> v3 migration (top-up tracking)", () => {
    test("preserves kind and reason on ad-hoc transactions", () => {
      const txn = sanitizeAdhocTransaction({
        id: "t1", name: "Top Up", amount: 500, date: "2026-03-10",
        kind: "topUp", reason: "shortfall",
      });
      expect(txn).toMatchObject({ kind: "topUp", reason: "shortfall" });
    });

    test("leaves an ordinary transaction unmarked", () => {
      const txn = sanitizeAdhocTransaction({
        id: "t2", name: "Groceries", amount: -80, date: "2026-03-10",
      });
      expect(txn!.kind).toBeUndefined();
      expect(txn!.reason).toBeUndefined();
    });

    test("drops a bogus kind or reason rather than trusting stored JSON", () => {
      const txn = sanitizeAdhocTransaction({
        id: "t3", name: "X", amount: 10, date: "2026-03-10",
        kind: "nonsense", reason: "alsoNonsense",
      });
      expect(txn!.kind).toBeUndefined();
      expect(txn!.reason).toBeUndefined();
    });

    test("does NOT backfill old transactions named 'Top Up'", () => {
      // Past top-ups were never recorded reliably, so name-matching them
      // would invent history that isn't trustworthy.
      const upgraded = upgradeAppState({
        version: 2,
        account: { startingBalance: 100 },
        settings: { startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0 },
        rules: [],
        adhocTransactions: [
          { id: "old1", name: "Top Up", amount: 500, date: "2025-06-01" },
          { id: "old2", name: "Transfer from savings", amount: 300, date: "2025-07-01" },
        ],
        overrides: {},
      });
      expect(upgraded.adhocTransactions).toHaveLength(2);
      expect(upgraded.adhocTransactions.every((t) => t.kind === undefined)).toBe(true);
    });

    test("stamps trackingSince when upgrading a state that lacks it", () => {
      const upgraded = upgradeAppState({
        version: 2,
        account: { startingBalance: 0 },
        settings: { startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0 },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.trackingSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(upgraded.version).toBe(APP_STATE_VERSION);
    });

    test("keeps an existing trackingSince instead of resetting the clock", () => {
      const upgraded = upgradeAppState({
        version: 3,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          trackingSince: "2025-09-01",
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.trackingSince).toBe("2025-09-01");
    });

    test("v3 -> v4 adds surplus settings without touching anything else", () => {
      // Additive, like every migration before it: a v3 state keeps its
      // rules, transactions and settings and simply gains defaults.
      const upgraded = upgradeAppState({
        version: 3,
        account: { startingBalance: 4200 },
        settings: {
          startDate: "2026-01-01", horizonDays: 120, minSafeBalance: 500,
          trackingSince: "2025-09-01", coverageLens: "recurring",
        },
        rules: [
          {
            id: "r1", name: "Rent", amount: -2400, isVariable: false,
            schedule: { type: "monthly", day: 1 },
          },
        ],
        adhocTransactions: [
          { id: "a1", name: "Top Up", amount: 500, date: "2026-02-01", kind: "topUp" },
        ],
        overrides: {},
      });

      expect(upgraded.version).toBe(APP_STATE_VERSION);
      expect(upgraded.rules).toHaveLength(1);
      expect(upgraded.adhocTransactions).toHaveLength(1);
      expect(upgraded.settings.trackingSince).toBe("2025-09-01");
      expect(upgraded.settings.coverageLens).toBe("recurring");
      expect(upgraded.account.startingBalance).toBe(4200);

      expect(upgraded.settings.surplus).toEqual({
        monthlyContribution: 0,
        reserveMonths: DEFAULT_RESERVE_MONTHS,
        expectedReturn: DEFAULT_EXPECTED_RETURN,
        capitalGainsRate: DEFAULT_CAPITAL_GAINS_RATE,
        horizonYears: DEFAULT_COMPARISON_YEARS,
      });
      // Parked cash has no sensible default — the card stays dormant until
      // the user says what is actually in the account.
      expect(upgraded.settings.surplus.parkedCash).toBeUndefined();
    });

    test("round-trips stored surplus settings", () => {
      const upgraded = upgradeAppState({
        version: 4,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          surplus: {
            parkedCash: 180000, monthlyContribution: 2500, reserveMonths: 9,
            expectedReturn: 0.065, capitalGainsRate: 0.238, horizonYears: 25,
          },
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.surplus).toEqual({
        parkedCash: 180000, monthlyContribution: 2500, reserveMonths: 9,
        expectedReturn: 0.065, capitalGainsRate: 0.238, horizonYears: 25,
      });
    });

    test("falls back to defaults for unusable surplus values, never to zero", () => {
      // A zero reserve would present the entire balance as investable, and a
      // zero return would make prepaying win every time. Both are far more
      // dangerous than simply reverting to the default.
      const upgraded = upgradeAppState({
        version: 4,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          surplus: {
            parkedCash: "loads", monthlyContribution: -400,
            reserveMonths: -3, expectedReturn: "7%",
            capitalGainsRate: 2, horizonYears: 0,
          },
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.surplus.reserveMonths).toBe(DEFAULT_RESERVE_MONTHS);
      expect(upgraded.settings.surplus.expectedReturn).toBe(DEFAULT_EXPECTED_RETURN);
      expect(upgraded.settings.surplus.capitalGainsRate).toBe(
        DEFAULT_CAPITAL_GAINS_RATE
      );
      expect(upgraded.settings.surplus.horizonYears).toBe(DEFAULT_COMPARISON_YEARS);
      expect(upgraded.settings.surplus.parkedCash).toBeUndefined();
      // A negative stream is nonsense; zero is the safe reading.
      expect(upgraded.settings.surplus.monthlyContribution).toBe(0);
    });

    test("accepts a zero parked balance as a real answer", () => {
      // "I have nothing parked" is information, not a missing value.
      const upgraded = upgradeAppState({
        version: 4,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          surplus: { parkedCash: 0 },
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.surplus.parkedCash).toBe(0);
    });

    test("survives a v3 state with no settings object at all", () => {
      const upgraded = upgradeAppState({
        version: 3, account: { startingBalance: 0 },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.surplus.reserveMonths).toBe(DEFAULT_RESERVE_MONTHS);
    });

    test("round-trips the persisted lens and second salary", () => {
      const upgraded = upgradeAppState({
        version: 3,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          coverageLens: "recurring", secondSalaryMonthly: 6000,
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.coverageLens).toBe("recurring");
      expect(upgraded.settings.secondSalaryMonthly).toBe(6000);
    });

    test("falls back to the default lens when the stored value is bogus", () => {
      const upgraded = upgradeAppState({
        version: 3,
        account: { startingBalance: 0 },
        settings: {
          startDate: "2026-01-01", horizonDays: 90, minSafeBalance: 0,
          coverageLens: "sideways", secondSalaryMonthly: "lots",
        },
        rules: [], adhocTransactions: [], overrides: {},
      });
      expect(upgraded.settings.coverageLens).toBe("all");
      expect(upgraded.settings.secondSalaryMonthly).toBeUndefined();
    });
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

describe("sanitizeHorizonDays", () => {
  // The engine builds one timeline point per day and the chart holds them
  // all, so an unbounded horizon is a hang/crash, not just a big number.
  test("falls back to the default for values that are not usable numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined, null, "90", {}]) {
      expect(sanitizeHorizonDays(bad)).toBe(DEFAULT_HORIZON_DAYS);
    }
  });

  test("clamps out-of-range values into the supported window", () => {
    expect(sanitizeHorizonDays(0)).toBe(1);
    expect(sanitizeHorizonDays(-30)).toBe(1);
    expect(sanitizeHorizonDays(200_000)).toBe(MAX_HORIZON_DAYS);
  });

  test("floors a fractional horizon and passes ordinary values through", () => {
    expect(sanitizeHorizonDays(90.7)).toBe(90);
    expect(sanitizeHorizonDays(365)).toBe(365);
  });

  test("upgradeAppState applies it to stored state", () => {
    const state = upgradeAppState({
      version: 3,
      account: { startingBalance: 0 },
      settings: { startDate: "2026-07-28", horizonDays: 1e9, minSafeBalance: 0 },
      rules: [],
      adhocTransactions: [],
      overrides: {},
    });
    expect(state.settings.horizonDays).toBe(MAX_HORIZON_DAYS);
  });
});

describe("sanitizeOverrides", () => {
  test("drops entries whose amount is missing or not a finite number", () => {
    expect(
      sanitizeOverrides({
        a: { overrideAmount: 100 },
        b: { overrideAmount: Infinity },
        c: { overrideAmount: NaN },
        d: { overrideAmount: "50" },
        e: {},
        f: null,
        g: "nope",
      })
    ).toEqual({ a: { eventKey: "a", overrideAmount: 100 } });
  });

  test("rejects a non-object or array override map", () => {
    expect(sanitizeOverrides(["nope"])).toEqual({});
    expect(sanitizeOverrides("nope")).toEqual({});
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides(undefined)).toEqual({});
  });

  test("upgradeAppState no longer copies the override map wholesale", () => {
    const state = upgradeAppState({
      version: 3,
      account: { startingBalance: 0 },
      settings: { startDate: "2026-07-28", horizonDays: 90, minSafeBalance: 0 },
      rules: [],
      adhocTransactions: [],
      overrides: ["nope"],
    });
    expect(state.overrides).toEqual({});
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
