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
