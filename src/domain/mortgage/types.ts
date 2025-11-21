// src/domain/mortgage/types.ts

export type Money = number;
export type ISODate = string; // YYYY-MM-DD

export interface MortgageOriginalTerms {
  principal: Money;
  annualRate: number;   // e.g. 0.065 for 6.5%
  termMonths: number;   // e.g. 360
  startDate: ISODate;   // first payment date or loan start date
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
