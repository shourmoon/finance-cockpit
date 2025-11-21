// src/domain/cashflowEngine.ts
import type {
    AppState,
CashAccount,
CashflowSettings,
RecurringRule,
FutureEvent,
TimelinePoint,
CashflowMetrics,
EventOverridesMap,
ISODate,
Money,
UUID,
MonthlySchedule,
TwiceMonthSchedule,
} from "./types";

import { addDays, toISODate, parseISODate } from "./dateUtils";
import { adjustToPreviousUSBusinessDay } from "./businessDayUS";

// ------------------------
// Helpers
// ------------------------

function compareISO(a: ISODate, b: ISODate): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function makeEventKey(ruleId: UUID, date: ISODate): string {
  return `${ruleId}__${date}`;
}

/**
 * Clamp a (year, month, day) tuple to a valid calendar day in UTC.
 */
function clampDay(year: number, monthIndex: number, day: number): Date {
  const lastDayOfMonth = new Date(
    Date.UTC(year, monthIndex + 1, 0)
  ).getUTCDate();
  const safeDay = Math.min(day, lastDayOfMonth);
  return new Date(Date.UTC(year, monthIndex, safeDay));
}

// ------------------------
// Schedule expansion
// ------------------------

function expandRuleToEvents(
  rule: RecurringRule,
  settings: CashflowSettings,
  overrides: EventOverridesMap
): FutureEvent[] {
  const events: FutureEvent[] = [];

  const start = parseISODate(settings.startDate);
  const end = addDays(start, settings.horizonDays);

  switch (rule.schedule.type) {
    case "monthly":
      generateMonthlyEvents(rule, start, end, overrides, events);
      break;
    case "twiceMonth":
      generateTwiceMonthEvents(rule, start, end, overrides, events);
      break;
    case "biweekly":
      generateBiweeklyEvents(rule, start, end, overrides, events);
      break;
  }

  return events;
}

function generateMonthlyEvents(
  rule: RecurringRule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
  const sched = rule.schedule as MonthlySchedule;
  const day = sched.day;

  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );

  while (cursor.getTime() <= end.getTime()) {
    const candidate = clampDay(
      cursor.getUTCFullYear(),
      cursor.getUTCMonth(),
      day
    );
    if (candidate.getTime() >= start.getTime() && candidate.getTime() <= end.getTime()) {
      pushEventForDate(rule, candidate, overrides, out);
    }
    cursor = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1)
    );
  }
}

function applyTwiceMonthBusinessConvention(
  sched: TwiceMonthSchedule,
  date: Date
): Date {
  const convention = sched.businessDayConvention ?? "none";
  if (convention === "previousBusinessDayUS") {
    return adjustToPreviousUSBusinessDay(date);
  }
  return date;
}

function generateTwiceMonthEvents(
  rule: RecurringRule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
  const sched = rule.schedule as TwiceMonthSchedule;

  let cursor = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)
  );

  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth();

    let d1 = clampDay(year, month, sched.day1);
    d1 = applyTwiceMonthBusinessConvention(sched, d1);

    if (d1.getTime() >= start.getTime() && d1.getTime() <= end.getTime()) {
      pushEventForDate(rule, d1, overrides, out);
    }

    let d2 = clampDay(year, month, sched.day2);
    d2 = applyTwiceMonthBusinessConvention(sched, d2);

    if (d2.getTime() >= start.getTime() && d2.getTime() <= end.getTime()) {
      if (d2.getTime() !== d1.getTime()) {
        pushEventForDate(rule, d2, overrides, out);
      }
    }

    cursor = new Date(Date.UTC(year, month + 1, 1));
  }
}

function generateBiweeklyEvents(
  rule: RecurringRule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
  if (rule.schedule.type !== "biweekly") {
    // Type guard to appease TS; other schedule types handled elsewhere.
    return;
  }

  const anchor = parseISODate(rule.schedule.anchorDate);
  let current = anchor;

  while (current.getTime() < start.getTime()) {
    current = addDays(current, 14);
  }

  while (current.getTime() <= end.getTime()) {
    pushEventForDate(rule, current, overrides, out);
    current = addDays(current, 14);
  }
}

function pushEventForDate(
  rule: RecurringRule,
  date: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
  const iso = toISODate(date);
  const eventKey = makeEventKey(rule.id, iso);
  const override = overrides[eventKey];

  const defaultAmount = rule.amount;
  const effectiveAmount =
    override && typeof override.overrideAmount === "number"
      ? override.overrideAmount
      : defaultAmount;

  out.push({
    id: eventKey,
    ruleId: rule.id,
    ruleName: rule.name,
    date: iso,
    defaultAmount,
    effectiveAmount,
    isVariable: rule.isVariable,
    isOverridden: !!override,
  });
}

// ------------------------
// Timeline & metrics
// ------------------------

export interface CashflowEngineResult {
  events: FutureEvent[];
  timeline: TimelinePoint[];
  metrics: CashflowMetrics;
}

export function runCashflowProjection(state: AppState): CashflowEngineResult {
  const { account, settings, rules, overrides } = state;

  const events = buildFutureEvents(rules, settings, overrides);
  const { timeline, metrics } = buildTimelineAndMetrics(
    account,
    settings,
    events
  );

  return { events, timeline, metrics };
}

export function buildFutureEvents(
  rules: RecurringRule[],
  settings: CashflowSettings,
  overrides: EventOverridesMap
): FutureEvent[] {
  const all: FutureEvent[] = [];

  for (const rule of rules) {
    const evts = expandRuleToEvents(rule, settings, overrides);
    all.push(...evts);
  }

  all.sort((a, b) => compareISO(a.date, b.date));
  return all;
}

export function buildTimelineAndMetrics(
  account: CashAccount,
  settings: CashflowSettings,
  events: FutureEvent[]
): { timeline: TimelinePoint[]; metrics: CashflowMetrics } {
  const start = parseISODate(settings.startDate);
  const end = addDays(start, settings.horizonDays);

  const byDate = new Map<ISODate, { inflow: Money; outflow: Money }>();

  for (const evt of events) {
    const entry = byDate.get(evt.date) ?? { inflow: 0, outflow: 0 };
    if (evt.effectiveAmount >= 0) {
      entry.inflow += evt.effectiveAmount;
    } else {
      entry.outflow += evt.effectiveAmount;
    }
    byDate.set(evt.date, entry);
  }

  const timeline: TimelinePoint[] = [];
  let currentBalance = account.startingBalance;

  let minBalance = currentBalance;
  let minBalanceDate: ISODate | null = settings.startDate;
  let firstNegativeDate: ISODate | null =
    currentBalance < 0 ? settings.startDate : null;

  let cursor = start;
  while (cursor.getTime() <= end.getTime()) {
    const iso = toISODate(cursor);
    const eventAmounts = byDate.get(iso) ?? { inflow: 0, outflow: 0 };

    const net = eventAmounts.inflow + eventAmounts.outflow;
    currentBalance += net;

    timeline.push({
      date: iso,
      balance: currentBalance,
      inflow: eventAmounts.inflow,
      outflow: eventAmounts.outflow,
    });

    if (currentBalance < minBalance) {
      minBalance = currentBalance;
      minBalanceDate = iso;
    }
    if (currentBalance < 0 && firstNegativeDate === null) {
      firstNegativeDate = iso;
    }

    cursor = addDays(cursor, 1);
  }

  let status: CashflowMetrics["status"];
  if (minBalance < 0) {
    status = "alert";
  } else if (minBalance < settings.minSafeBalance) {
    status = "warning";
  } else {
    status = "ok";
  }

  const safeToSpendThisMonth = computeSafeToSpendThisMonth(
    account,
    settings,
    timeline
  );

  const metrics: CashflowMetrics = {
    balanceToday: account.startingBalance,
    minBalance,
    minBalanceDate,
    status,
    safeToSpendThisMonth,
    firstNegativeDate,
  };

  return { timeline, metrics };
}

function computeSafeToSpendThisMonth(
  account: CashAccount,
  settings: CashflowSettings,
  timeline: TimelinePoint[]
): Money {
  if (timeline.length === 0) return 0;

  const minBalance = timeline.reduce(
    (min, p) => (p.balance < min ? p.balance : min),
    account.startingBalance
  );

  if (minBalance <= settings.minSafeBalance) {
    return 0;
  }

  const headroom = minBalance - settings.minSafeBalance;
  return headroom > 0 ? headroom : 0;
}
