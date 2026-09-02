// src/domain/types.ts

// Primitive aliases
export type ISODate = string; // "YYYY-MM-DD"
export type Money = number;
export type UUID = string;

// ------------------------
// Recurring schedules
// ------------------------

export interface MonthlySchedule {
  type: "monthly";
  day: number; // 1-31, clamped to end-of-month
}

export interface TwiceMonthSchedule {
  type: "twiceMonth";
  day1: number; // e.g. 15
  day2: number; // e.g. 31, clamped to end-of-month
  /**
   * Optional business-day adjustment:
   * - "none" (default): use clamped calendar day
   * - "previousBusinessDayUS": move to previous US Fed business day
   */
  businessDayConvention?: "none" | "previousBusinessDayUS";
}

export interface BiweeklySchedule {
  type: "biweekly";
  /**
   * Anchor date in ISO format; events repeat every 14 days from here.
   */
  anchorDate: ISODate;
}

export type RecurringSchedule =
  | MonthlySchedule
  | TwiceMonthSchedule
  | BiweeklySchedule;

// ------------------------
// Recurring rule
// ------------------------

export interface RecurringRule {
  id: UUID;
  name: string;
  amount: Money; // positive for inflow, negative for outflow
  isVariable: boolean; // true = amount often overridden
  schedule: RecurringSchedule;
}

// ------------------------
// Overrides for specific events
// ------------------------

export interface EventOverride {
  eventKey: string; // `${ruleId}__${date}`
  overrideAmount: Money;
}

export type EventOverridesMap = Record<string, EventOverride>;

// ------------------------
// Ad-hoc one-time transactions
// ------------------------

export interface AdhocTransaction {
  id: UUID;
  name: string;
  amount: Money; // positive for inflow, negative for outflow
  date: ISODate;
  /**
   * Marks money moved in from savings to keep this account above its floor.
   * Set explicitly (never inferred from `name`, which the user can edit) so
   * coverage metrics only ever count real top-ups.
   *
   * There is one kind. Earlier versions also recorded *why* — a one-off
   * shock against a recurring shortfall — and offered a lens to view each
   * alone. Splitting them asked the user to classify every draw at the
   * moment they were moving money, and every draw is a draw: what coverage
   * measures is whether one salary covered the month unaided, and it did
   * not either way.
   */
  kind?: "topUp";
}

/**
 * One recorded comparison between a figure this app maintains by hand and
 * what the bank or servicer actually said. See `domain/reconciliation.ts`
 * for what is done with these; the shape lives here because it is persisted
 * alongside the rest of the state.
 */
export interface Checkpoint {
  id: UUID;
  /**
   * The statement date: what the figure was true *of*, never when it was
   * typed in.
   */
  date: ISODate;
  /** What the bank or servicer actually said. */
  actual: Money;
  /** What the model said for that date, captured when the check was made. */
  modelled: Money;
}

// ------------------------
// Expanded future events
// ------------------------

export interface FutureEvent {
  id: string;
  ruleId: UUID;
  ruleName: string;
  date: ISODate;
  defaultAmount: Money;
  effectiveAmount: Money;
  isVariable: boolean;
  isOverridden: boolean;
}

// ------------------------
// Timeline & metrics
// ------------------------

export interface TimelinePoint {
  date: ISODate;
  balance: Money;
  inflow: Money;
  outflow: Money;
}

export type CashflowStatus = "ok" | "warning" | "alert";

export interface CashflowMetrics {
  balanceToday: Money;
  minBalance: Money;
  minBalanceDate: ISODate | null;
  status: CashflowStatus;
  safeToSpendThisMonth: Money;
  firstNegativeDate: ISODate | null;
}

// ------------------------
// Settings & account
// ------------------------

/**
 * Inputs for the surplus allocation card: how much cash is parked, how much
 * of it must stay untouched, and the assumptions the market-vs-mortgage
 * comparison runs on.
 */
export interface SurplusSettings {
  /**
   * Cash parked in the high-yield account. Deliberately optional and with no
   * default — the card stays dormant until the user says what is actually in
   * there, rather than guessing and presenting a number as if it were theirs.
   */
  parkedCash?: Money;
  /**
   * Ongoing money the household can direct each month, alongside (or instead
   * of) the lump. Optional and defaulted to zero: most people start with a
   * balance and add a stream later.
   */
  monthlyContribution: Money;
  /** An amount once a year, e.g. a bonus. Zero means none. */
  yearlyContribution: Money;
  /** Calendar month (1-12) the yearly amount lands in. */
  yearlyMonth: number;
  /**
   * Both recurring streams stop after this date; the lump is unaffected.
   * Unset means "for as long as the loan lasts".
   */
  contributionsUntil?: ISODate;
  /** Months of expenses held back before anything counts as surplus. */
  reserveMonths: number;
  /** Expected pre-tax annual market return. */
  expectedReturn: number;
  /** Combined marginal rate on long-term capital gains. */
  capitalGainsRate: number;
  /** Years over which the two paths are compared. */
  horizonYears: number;
}

export interface CashflowSettings {
  startDate: ISODate;
  horizonDays: number;
  minSafeBalance: Money;
  /**
   * When top-up tracking began — stamped on the first v3 load. Months
   * before this are unknown (the app wasn't recording yet), never counted
   * as clean.
   */
  trackingSince?: ISODate;
  /**
   * Optional net monthly income of the second earner, used only for the
   * "second salary kept" metric. Unset means that metric is hidden.
   */
  secondSalaryMonthly?: Money;
  /** Surplus-allocation inputs. Always present from v4 onward. */
  surplus: SurplusSettings;
}

export interface CashAccount {
  startingBalance: Money;
}

// ------------------------
// App state
// ------------------------

export interface AppState {
  version: number;
  account: CashAccount;
  settings: CashflowSettings;
  rules: RecurringRule[];
  adhocTransactions: AdhocTransaction[];
  overrides: EventOverridesMap;
  /**
   * Times the starting balance was checked against an actual bank
   * statement. Always present from v5 onward; an empty list means the
   * figure has never been confirmed, which is itself worth saying.
   */
  checkpoints: Checkpoint[];
}
