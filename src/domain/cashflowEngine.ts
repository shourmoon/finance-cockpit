// src/domain/cashflowEngine.ts
import type {
    AppState,
AdhocTransaction,
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
BiweeklySchedule,
} from "./types";

import { addDays, toISODate, parseISODate, isValidISODate } from "./dateUtils";
import { adjustToPreviousUSBusinessDay } from "./businessDayUS";
import { latestCheckpoint } from "./reconciliation";

// ------------------------
// Helpers
// ------------------------

function compareISO(a: ISODate, b: ISODate): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function makeEventKey(ruleId: UUID, date: ISODate): string {
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

  // The start date can transiently be invalid while the user edits the
  // date input; produce no events rather than throwing mid-render.
  if (!isValidISODate(settings.startDate)) return events;

  const start = parseISODate(settings.startDate);
  const end = addDays(start, settings.horizonDays);

  switch (rule.schedule.type) {
    case "monthly":
      generateMonthlyEvents(rule, rule.schedule, start, end, overrides, events);
      break;
    case "twiceMonth":
      generateTwiceMonthEvents(rule, rule.schedule, start, end, overrides, events);
      break;
    case "biweekly":
      generateBiweeklyEvents(rule, rule.schedule, start, end, overrides, events);
      break;
  }

  return events;
}

function generateMonthlyEvents(
  rule: RecurringRule,
  sched: MonthlySchedule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
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
  sched: TwiceMonthSchedule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
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
  sched: BiweeklySchedule,
  start: Date,
  end: Date,
  overrides: EventOverridesMap,
  out: FutureEvent[]
) {
  if (!isValidISODate(sched.anchorDate)) return;

  const anchor = parseISODate(sched.anchorDate);
  let current = anchor;

  while (current.getTime() < start.getTime()) {
    current = addDays(current, 14);
  }

  while (current.getTime() <= end.getTime()) {
    pushEventForDate(rule, current, overrides, out);
    current = addDays(current, 14);
  }
}

/**
 * Expand ad-hoc one-time transactions into FutureEvents. Each
 * transaction contributes at most one event: its own date, when that
 * falls inside the projection window. Overrides apply through the same
 * `${id}__${date}` key used for rule events, so the dashboard's
 * override flow works unchanged.
 */
export function expandAdhocTransactions(
  txns: AdhocTransaction[],
  settings: CashflowSettings,
  overrides: EventOverridesMap
): FutureEvent[] {
  const events: FutureEvent[] = [];
  if (!isValidISODate(settings.startDate)) return events;

  const start = parseISODate(settings.startDate);
  const end = addDays(start, settings.horizonDays);

  for (const txn of txns) {
    if (!isValidISODate(txn.date)) continue;
    const date = parseISODate(txn.date);
    if (date.getTime() < start.getTime() || date.getTime() > end.getTime()) {
      continue;
    }

    const eventKey = makeEventKey(txn.id, txn.date);
    const override = overrides[eventKey];
    const effectiveAmount =
      override && typeof override.overrideAmount === "number"
        ? override.overrideAmount
        : txn.amount;

    events.push({
      id: eventKey,
      ruleId: txn.id,
      ruleName: txn.name,
      date: txn.date,
      defaultAmount: txn.amount,
      effectiveAmount,
      isVariable: false,
      isOverridden: !!override,
    });
  }

  return events;
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

/**
 * How far apart two valid ISO dates are, in whole days. Positive when `b`
 * is the later of the two.
 */
function daysApart(a: ISODate, b: ISODate): number {
  const ms = parseISODate(b).getTime() - parseISODate(a).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * A roll longer than this is refused rather than attempted.
 *
 * Storage is untrusted, and a checkpoint dated in year 0001 against a start
 * date in 2026 asks for a 700,000-day event expansion — which does not
 * produce a wrong number so much as hang the tab. Beyond a century the
 * honest answer is that the figure cannot be rolled at all.
 */
const MAX_ROLL_DAYS = 36_500;

/**
 * The opening balance at `settings.startDate`.
 *
 * `account.startingBalance` is a figure confirmed against a bank statement on
 * a particular day — the latest checkpoint's. `settings.startDate` is where
 * the forecast window opens. They are two different dates, and the engine
 * used to treat them as one: it seeded the running balance with the confirmed
 * figure and started walking at startDate regardless of the gap.
 *
 * That meant moving the window forward did not roll the balance forward, it
 * dropped everything in between — a salary paid after the last reality check
 * but before the window opens was too late to be in the balance and too early
 * to be an event, so it simply disappeared. And since `advanceStartDate`
 * moves startDate to today on every load, the gap opened by itself, one day
 * at a time, between one reality check and the next.
 *
 * So the confirmed figure is rolled across the gap. The convention, which the
 * whole app shares: a balance is the opening balance **at the start of** its
 * date, before that day's own events. That is what makes recording a check
 * today a no-op on the figures — the common case, since the check is locked
 * to today and startDate follows today — and it is what lets the first
 * timeline point go on applying its own day's events, as it always has.
 *
 * With no checkpoint there is no date to roll from, so nothing is rolled.
 * Inventing an anchor would be worse than the gap it closes.
 */
export function openingBalanceAtStart(state: AppState): Money {
  const { account, settings, rules, overrides, checkpoints } = state;
  if (!isValidISODate(settings.startDate)) return account.startingBalance;

  // `latestCheckpoint` sanitizes as it goes, so a date it hands back has
  // already passed `isValidISODate` — no second guard here, and no
  // `checkpoints ?? []` either, since `AppState.checkpoints` is not
  // optional. Defensive code that cannot be reached is worse than none: it
  // reads as though it were protecting something.
  const anchor = latestCheckpoint(checkpoints)?.date;
  if (!anchor) return account.startingBalance;
  if (anchor === settings.startDate) return account.startingBalance;

  // Rolling backwards is as legitimate as forwards: pinning the window to a
  // day before the last reality check asks what the balance was then, and
  // the answer is the confirmed figure less what happened since.
  const forward = anchor < settings.startDate;
  const from = forward ? anchor : settings.startDate;
  const to = forward ? settings.startDate : anchor;

  const span = daysApart(from, to);
  if (!Number.isFinite(span) || span <= 0 || span > MAX_ROLL_DAYS) {
    return account.startingBalance;
  }

  // Same expansion the projection itself uses, over the gap instead of the
  // horizon, so overrides and business-day adjustment apply identically. The
  // window is half-open: `to`'s own events belong to the day the balance is
  // being rolled TO, and are applied by whoever owns that day.
  const bridge = buildFutureEvents(
    rules,
    { ...settings, startDate: from, horizonDays: span },
    overrides,
    state.adhocTransactions
  );
  let net = 0;
  for (const evt of bridge) {
    if (evt.date >= from && evt.date < to) net += evt.effectiveAmount;
  }

  return forward
    ? account.startingBalance + net
    : account.startingBalance - net;
}

export function runCashflowProjection(state: AppState): CashflowEngineResult {
  const { account, settings, rules, overrides } = state;

  const events = buildFutureEvents(
    rules,
    settings,
    overrides,
    state.adhocTransactions
  );
  const { timeline, metrics } = buildTimelineAndMetrics(
    { ...account, startingBalance: openingBalanceAtStart(state) },
    settings,
    events
  );

  return { events, timeline, metrics };
}

export function buildFutureEvents(
  rules: RecurringRule[],
  settings: CashflowSettings,
  overrides: EventOverridesMap,
  adhocTransactions: AdhocTransaction[] = []
): FutureEvent[] {
  const all: FutureEvent[] = [];

  for (const rule of rules) {
    const evts = expandRuleToEvents(rule, settings, overrides);
    all.push(...evts);
  }

  all.push(...expandAdhocTransactions(adhocTransactions, settings, overrides));

  all.sort((a, b) => compareISO(a.date, b.date));

  // Enforce event-id uniqueness across the whole merged stream. Repeat
  // ids can arise from business-day adjustment pulling a rule's event
  // into the previous month onto that month's own payday (both payments
  // are real and both are kept), or from duplicate ad-hoc transaction
  // ids in corrupt/synced data. Suffix repeats so event identity and
  // React keys stay unique; overrides are keyed by rule+date and
  // intentionally apply to every occurrence on that date.
  const seen = new Map<string, number>();
  for (const evt of all) {
    const n = seen.get(evt.id) ?? 0;
    seen.set(evt.id, n + 1);
    if (n > 0) evt.id = `${evt.id}__${n + 1}`;
  }

  return all;
}

export function buildTimelineAndMetrics(
  account: CashAccount,
  settings: CashflowSettings,
  events: FutureEvent[]
): { timeline: TimelinePoint[]; metrics: CashflowMetrics } {
  if (!isValidISODate(settings.startDate)) {
    // Transiently-invalid start date (e.g. cleared date input): return an
    // empty timeline and neutral metrics instead of throwing mid-render.
    return {
      timeline: [],
      metrics: {
        balanceToday: account.startingBalance,
        minBalance: account.startingBalance,
        minBalanceDate: null,
        status:
          account.startingBalance < 0
            ? "alert"
            : account.startingBalance < settings.minSafeBalance
              ? "warning"
              : "ok",
        safeToSpendThisMonth: 0,
        firstNegativeDate: null,
      },
    };
  }

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

  // Seeded from the timeline, not from the pre-timeline balance.
  //
  // The first timeline point is startDate WITH that day's events applied, so
  // the balance before them is a moment the timeline never holds. Offering it
  // as a candidate minimum made the dashboard read "lowest $4,090 on 1 Mar"
  // beside a ledger whose running balance for 1 Mar was $9,330 — one
  // quantity, two numbers, on one screen.
  //
  // Note this is deliberately NOT the same question computeSafeToSpend asks.
  // That one keeps the pre-event balance as a candidate on purpose: you
  // cannot spend a salary that has not landed yet, so the conservative
  // reading is the correct one there. Here the job is to describe the curve
  // the timeline actually traces, and it must describe it accurately.
  let minBalance = Number.POSITIVE_INFINITY;
  let minBalanceDate: ISODate | null = null;
  let firstNegativeDate: ISODate | null = null;

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
  // Guard only: callers pass a non-empty timeline (the invalid-startDate
  // path short-circuits before reaching here).
  /* v8 ignore next 1 */
  if (timeline.length === 0) return 0;

  const minBalance = timeline.reduce(
    (min, p) => (p.balance < min ? p.balance : min),
    account.startingBalance
  );

  if (minBalance <= settings.minSafeBalance) {
    return 0;
  }

  return minBalance - settings.minSafeBalance;
}
