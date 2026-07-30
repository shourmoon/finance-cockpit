// src/domain/mortgage/types.ts

export type Money = number;
export type ISODate = string; // YYYY-MM-DD

/**
 * How often a payment is actually made.
 *
 * "biweekly" means TRUE accelerated biweekly: half the monthly payment every
 * 14 days. That is 26 half-payments a year — the equivalent of 13 monthly
 * payments — and the extra one goes to principal, which is what retires the
 * loan early. It is not the same as a servicer drafting fortnightly but
 * applying one monthly payment, which accelerates nothing.
 */
export type PaymentFrequency = "monthly" | "biweekly";

export interface MortgageOriginalTerms {
  principal: Money;
  annualRate: number;   // e.g. 0.065 for 6.5%
  termMonths: number;   // contractual term; with biweekly the loan ends sooner
  startDate: ISODate;   // first payment date or loan start date
  /** Absent means monthly, so existing stored loans keep their behaviour. */
  paymentFrequency?: PaymentFrequency;
}

// A single amortization entry in the schedule.
export interface AmortizationEntry {
  date: ISODate;
  payment: Money;
  interest: Money;
  principal: Money;
  remaining: Money;
}

// Past prepayments that have already been made.
export interface PastPrepayment {
  date: ISODate;
  amount: Money;
  note?: string;
}

export type PastPrepaymentLog = PastPrepayment[];

// Baseline (no-prepayment) path.
export interface MortgageBaselineResult {
  schedule: AmortizationEntry[];
  totalInterest: Money;
  payoffDate: ISODate;
}

// Actual path including past prepayments.
export interface MortgageHistoryResult {
  schedule: AmortizationEntry[];
  totalInterest: Money;
  payoffDate: ISODate;
}

// Comparison between baseline and actual.
export interface MortgageComparisonResult {
  baseline: MortgageBaselineResult;
  actual: MortgageHistoryResult;
  interestSaved: Money;
  monthsSaved: number;
}
