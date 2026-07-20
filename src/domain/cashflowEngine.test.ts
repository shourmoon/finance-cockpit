// src/domain/cashflowEngine.test.ts
import {
    runCashflowProjection,
buildFutureEvents,
buildTimelineAndMetrics,
} from "./cashflowEngine";
import { createInitialAppState } from "./appState";
import { toISODate, parseISODate, addDays } from "./dateUtils";
import type {
AppState,
RecurringRule,
CashflowSettings,
EventOverridesMap,
CashAccount,
FutureEvent,
} from "./types";

function makeBaseState(): AppState {
  const base = createInitialAppState();
  return {
    ...base,
    account: { startingBalance: 1000 },
    settings: {
      ...base.settings,
      horizonDays: 30,
    },
    rules: [],
    overrides: {},
  };
}

describe("cashflowEngine - basic schedules", () => {
  test("monthly schedule generates one event per month in horizon", () => {
    const state = makeBaseState();
    const today = toISODate(new Date());

    const monthlyRule: RecurringRule = {
      id: "rule-monthly",
      name: "Rent",
      amount: -500,
      isVariable: false,
      schedule: { type: "monthly", day: 1 },
    };

    const settings: CashflowSettings = {
      ...state.settings,
      startDate: today,
      horizonDays: 60, // ~2 months
    };

    const events = buildFutureEvents([monthlyRule], settings, {});
    // Expect 2 or 3 events depending on current date – but at least 1
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.every((e) => e.ruleId === "rule-monthly")).toBe(true);
  });

  test("biweekly schedule repeats every 14 days from anchor", () => {
    const state = makeBaseState();

    const anchor = "2025-01-01";
    const biweeklyRule: RecurringRule = {
      id: "rule-biweekly",
      name: "Groceries",
      amount: -100,
      isVariable: true,
      schedule: { type: "biweekly", anchorDate: anchor },
    };

    const settings: CashflowSettings = {
      ...state.settings,
      startDate: "2025-01-01",
      horizonDays: 60,
    };

    const events = buildFutureEvents([biweeklyRule], settings, {});
    expect(events.length).toBeGreaterThan(2);

    // Check differences between consecutive dates are multiples of 14 days
    for (let i = 1; i < events.length; i++) {
      const prev = parseISODate(events[i - 1].date);
      const curr = parseISODate(events[i].date);
      const diffDays =
        (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays % 14).toBe(0);
    }
  });

  test("twice-monthly with previousBusinessDayUS adjusts for weekend/holiday", () => {
    const state = makeBaseState();

    const rule: RecurringRule = {
      id: "rule-twice",
      name: "Paycheck",
      amount: 2000,
      isVariable: false,
      schedule: {
        type: "twiceMonth",
        day1: 15,
        day2: 31,
        businessDayConvention: "previousBusinessDayUS",
      },
    };

    const settings: CashflowSettings = {
      ...state.settings,
      startDate: "2025-01-01",
      horizonDays: 40,
    };

    const events = buildFutureEvents([rule], settings, {});

    // Find January events
    const janEvents = events.filter((e) => e.date.startsWith("2025-01-"));
    // Expect two paydays in Jan
    expect(janEvents.length).toBe(2);

    // Check that they are business days
    for (const e of janEvents) {
      const d = parseISODate(e.date);
      expect(d.getUTCDay()).not.toBe(0); // not Sunday
      expect(d.getUTCDay()).not.toBe(6); // not Saturday
    }
  });
});

describe("cashflowEngine - timeline & metrics", () => {
  test("timeline length equals horizonDays + 1", () => {
    const state = makeBaseState();
    const settings: CashflowSettings = {
      ...state.settings,
      startDate: "2025-01-01",
      horizonDays: 10,
    };

    const rule: RecurringRule = {
      id: "rule-once",
      name: "One-time",
      amount: 100,
      isVariable: false,
      schedule: {
        type: "monthly",
        day: 1,
      },
    };

    const events = buildFutureEvents([rule], settings, {});
    const { timeline } = buildTimelineAndMetrics(
      state.account,
      settings,
      events
    );

    // 10 days horizon => 11 points including start
    expect(timeline.length).toBe(11);
    expect(timeline[0].date).toBe("2025-01-01");
    expect(timeline[10].date).toBe("2025-01-11");
  });

  test("metrics detect negative balance and firstNegativeDate", () => {
    const account: CashAccount = { startingBalance: 0 };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 5,
      minSafeBalance: 0,
    };

    const rule: RecurringRule = {
      id: "rule-negative",
      name: "Big bill",
      amount: -100,
      isVariable: false,
      schedule: { type: "monthly", day: 1 },
    };

    const events = buildFutureEvents([rule], settings, {});
    const { metrics } = buildTimelineAndMetrics(account, settings, events);

    expect(metrics.status).toBe("alert");
    expect(metrics.firstNegativeDate).toBe("2025-01-01");
    expect(metrics.minBalance).toBeLessThan(0);
  });

  test("safeToSpendThisMonth is zero when minBalance <= minSafeBalance", () => {
    const account: CashAccount = { startingBalance: 100 };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 5,
      minSafeBalance: 50,
    };

    const rule: RecurringRule = {
      id: "rule-spend",
      name: "Expense",
      amount: -60,
      isVariable: false,
      schedule: { type: "monthly", day: 1 },
    };

    const events = buildFutureEvents([rule], settings, {});
    const { metrics } = buildTimelineAndMetrics(account, settings, events);

    expect(metrics.safeToSpendThisMonth).toBe(0);
  });

  test("safeToSpendThisMonth is positive when minBalance stays above minSafeBalance", () => {
    const account: CashAccount = { startingBalance: 1000 };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 5,
      minSafeBalance: 100,
    };

    const rule: RecurringRule = {
      id: "rule-small",
      name: "Small expense",
      amount: -50,
      isVariable: false,
      schedule: { type: "monthly", day: 1 },
    };

    const events = buildFutureEvents([rule], settings, {});
    const { metrics } = buildTimelineAndMetrics(account, settings, events);

    expect(metrics.safeToSpendThisMonth).toBeGreaterThan(0);
  });

  test("runCashflowProjection uses state and returns events, timeline, metrics", () => {
    const base = makeBaseState();
    const state: AppState = {
      ...base,
      rules: [
        {
          id: "r1",
          name: "Test inflow",
          amount: 500,
          isVariable: false,
          schedule: { type: "monthly", day: 1 },
        },
      ],
    };

    const result = runCashflowProjection(state);
    expect(Array.isArray(result.events)).toBe(true);
    expect(Array.isArray(result.timeline)).toBe(true);
    expect(typeof result.metrics.balanceToday).toBe("number");
  });
});

describe("cashflowEngine - edge cases", () => {
  test("monthly day 31 clamps to end of shorter months", () => {
    const rule: RecurringRule = {
      id: "rule-eom",
      name: "End of month",
      amount: 100,
      isVariable: false,
      schedule: { type: "monthly", day: 31 },
    };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 120,
      minSafeBalance: 0,
    };

    const events = buildFutureEvents([rule], settings, {});
    const dates = events.map((e) => e.date);
    expect(dates).toContain("2025-01-31");
    expect(dates).toContain("2025-02-28"); // 2025 is not a leap year
    expect(dates).toContain("2025-03-31");
    expect(dates).toContain("2025-04-30");
  });

  test("twiceMonth emits a single event when both days clamp to the same date", () => {
    const rule: RecurringRule = {
      id: "rule-collapse",
      name: "Collapsing",
      amount: 100,
      isVariable: false,
      schedule: { type: "twiceMonth", day1: 30, day2: 31 },
    };
    const settings: CashflowSettings = {
      startDate: "2025-02-01",
      horizonDays: 27, // February 2025 only
      minSafeBalance: 0,
    };

    const events = buildFutureEvents([rule], settings, {});
    // Both day 30 and day 31 clamp to Feb 28; only one event should be emitted.
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2025-02-28");
  });

  test("biweekly anchor beyond the horizon yields no events", () => {
    const rule: RecurringRule = {
      id: "rule-future",
      name: "Future anchor",
      amount: 100,
      isVariable: false,
      schedule: { type: "biweekly", anchorDate: "2026-06-01" },
    };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 30,
      minSafeBalance: 0,
    };

    expect(buildFutureEvents([rule], settings, {})).toHaveLength(0);
  });

  test("biweekly anchor far in the past lands on the 14-day grid inside the horizon", () => {
    const rule: RecurringRule = {
      id: "rule-past",
      name: "Old anchor",
      amount: 100,
      isVariable: false,
      schedule: { type: "biweekly", anchorDate: "2020-01-01" },
    };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 30,
      minSafeBalance: 0,
    };

    const events = buildFutureEvents([rule], settings, {});
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      const diffDays =
        (parseISODate(e.date).getTime() - parseISODate("2020-01-01").getTime()) /
        (1000 * 60 * 60 * 24);
      expect(diffDays % 14).toBe(0);
      expect(e.date >= "2025-01-01").toBe(true);
      expect(e.date <= "2025-01-31").toBe(true);
    }
  });

  test("an invalid startDate yields an empty projection instead of throwing", () => {
    const base = makeBaseState();
    const state: AppState = {
      ...base,
      settings: { ...base.settings, startDate: "" }, // e.g. cleared date input
      rules: [
        {
          id: "r1",
          name: "Rent",
          amount: -500,
          isVariable: false,
          schedule: { type: "monthly", day: 1 },
        },
      ],
    };

    const result = runCashflowProjection(state);
    expect(result.events).toHaveLength(0);
    expect(result.timeline).toHaveLength(0);
    expect(result.metrics.balanceToday).toBe(state.account.startingBalance);
    expect(result.metrics.firstNegativeDate).toBeNull();
  });

  test("invalid startDate metrics reflect the starting balance status", () => {
    const bad: CashflowSettings = { startDate: "", horizonDays: 30, minSafeBalance: 100 };

    const negative = buildTimelineAndMetrics({ startingBalance: -5 }, bad, []);
    expect(negative.metrics.status).toBe("alert");

    const belowSafe = buildTimelineAndMetrics({ startingBalance: 50 }, bad, []);
    expect(belowSafe.metrics.status).toBe("warning");

    const ok = buildTimelineAndMetrics({ startingBalance: 500 }, bad, []);
    expect(ok.metrics.status).toBe("ok");
    expect(ok.timeline).toHaveLength(0);
  });

  test("a negative starting balance marks the start date as first-negative", () => {
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 5,
      minSafeBalance: 0,
    };
    const { metrics } = buildTimelineAndMetrics({ startingBalance: -100 }, settings, []);
    expect(metrics.firstNegativeDate).toBe("2025-01-01");
    expect(metrics.status).toBe("alert");
  });

  test("two rules landing on the same date both contribute (compareISO equality)", () => {
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 40,
      minSafeBalance: 0,
    };
    const a: RecurringRule = {
      id: "a", name: "A", amount: 100, isVariable: false,
      schedule: { type: "monthly", day: 10 },
    };
    const b: RecurringRule = {
      id: "b", name: "B", amount: 200, isVariable: false,
      schedule: { type: "monthly", day: 10 },
    };
    const events = buildFutureEvents([a, b], settings, {});
    const jan10 = events.filter((e) => e.date === "2025-01-10");
    expect(jan10).toHaveLength(2);
  });

  test("business-day adjustment pulling an event across months keeps both payments with unique ids", () => {
    // Regression: day2=31 clamps to Fri 2025-02-28, and Mar 1 (Saturday)
    // also adjusts back to 2025-02-28. Both paydays are real; they used to
    // be emitted with identical ids.
    const rule: RecurringRule = {
      id: "pay",
      name: "Paycheck",
      amount: 1000,
      isVariable: false,
      schedule: {
        type: "twiceMonth",
        day1: 1,
        day2: 31,
        businessDayConvention: "previousBusinessDayUS",
      },
    };
    const settings: CashflowSettings = {
      startDate: "2025-02-01",
      horizonDays: 40,
      minSafeBalance: 0,
    };

    const events = buildFutureEvents([rule], settings, {});
    const feb28 = events.filter((e) => e.date === "2025-02-28");
    expect(feb28).toHaveLength(2); // both payments kept
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length); // ids unique

    // The timeline counts both payments.
    const { timeline } = buildTimelineAndMetrics(
      { startingBalance: 0 },
      settings,
      events
    );
    const day = timeline.find((p) => p.date === "2025-02-28")!;
    expect(day.inflow).toBe(2000);

    // A date-keyed override intentionally applies to every occurrence.
    const overridden = buildFutureEvents([rule], settings, {
      "pay__2025-02-28": { eventKey: "pay__2025-02-28", overrideAmount: 500 },
    });
    const both = overridden.filter((e) => e.date === "2025-02-28");
    expect(both.every((e) => e.isOverridden && e.effectiveAmount === 500)).toBe(true);
  });

  test("a biweekly rule with an invalid anchor date is skipped, not fatal", () => {
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 30,
      minSafeBalance: 0,
    };
    const badRule: RecurringRule = {
      id: "rule-bad-anchor",
      name: "Bad anchor",
      amount: 100,
      isVariable: false,
      schedule: { type: "biweekly", anchorDate: "garbage" },
    };
    const goodRule: RecurringRule = {
      id: "rule-good",
      name: "Good",
      amount: 100,
      isVariable: false,
      schedule: { type: "monthly", day: 15 },
    };

    const events = buildFutureEvents([badRule, goodRule], settings, {});
    expect(events.every((e) => e.ruleId === "rule-good")).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  test("an override changes effectiveAmount for that occurrence only", () => {
    const rule: RecurringRule = {
      id: "rule-var",
      name: "Variable bill",
      amount: -100,
      isVariable: true,
      schedule: { type: "monthly", day: 15 },
    };
    const settings: CashflowSettings = {
      startDate: "2025-01-01",
      horizonDays: 60,
      minSafeBalance: 0,
    };
    const overrides: EventOverridesMap = {
      "rule-var__2025-01-15": {
        eventKey: "rule-var__2025-01-15",
        overrideAmount: -250,
      },
    };

    const events = buildFutureEvents([rule], settings, overrides);
    const jan = events.find((e) => e.date === "2025-01-15")!;
    const feb = events.find((e) => e.date === "2025-02-15")!;

    expect(jan.isOverridden).toBe(true);
    expect(jan.effectiveAmount).toBe(-250);
    expect(jan.defaultAmount).toBe(-100);
    expect(feb.isOverridden).toBe(false);
    expect(feb.effectiveAmount).toBe(-100);
  });
});
