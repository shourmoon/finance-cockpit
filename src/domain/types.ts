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

/**
 * Why a top-up was needed. Recorded at Apply time so coverage metrics can
 * separate the two by measurement rather than inference:
 * - "oneOff":    a shock (car repair, medical bill). Savings doing its job;
 *                does not indicate the household is short on income.
 * - "shortfall": the month simply did not cover. This is the one-salary
 *                thesis failing, and it's what the recurring-only lens isolates.
 * Defaults to "oneOff" so a hurried Apply never silently indicts the thesis.
 */
export type TopUpReason = "oneOff" | "shortfall";

export interface AdhocTransaction {
  id: UUID;
  name: string;
  amount: Money; // positive for inflow, negative for outflow
  date: ISODate;
  /**
   * Marks a transaction created by applying a suggested top-up. Set
   * explicitly (never inferred from `name`, which the user can edit) so
   * coverage metrics only ever count real top-ups.
   */
  kind?: "topUp";
  /** Only meaningful when `kind === "topUp"`. */
  reason?: TopUpReason;
}

/** Which top-ups the coverage metrics count. */
export type CoverageLens = "all" | "recurring";

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
  /** Persisted coverage-card lens, so the choice survives reloads and sync. */
  coverageLens?: CoverageLens;
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
}
