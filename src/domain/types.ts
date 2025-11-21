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

export interface CashflowSettings {
  startDate: ISODate;
  horizonDays: number;
  minSafeBalance: Money;
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
  overrides: EventOverridesMap;
}

// ------------------------
// Mortgage types
// ------------------------

export interface MortgageConfig {
  principal: Money;
  annualRate: number; // e.g. 0.04 for 4%
  termMonths: number;
  startDate: ISODate;
  monthlyPayment: Money; // contractual monthly payment
}

export interface MortgageScheduleEntry {
  date: ISODate;
  interest: Money;
  principal: Money;
  remainingBalance: Money;
}

export interface MortgageSimulationResult {
  schedule: MortgageScheduleEntry[];
  totalInterestPaid: Money;
  payoffDate: ISODate;
  interestSaved: Money;
  baselineInterest: Money;
}
