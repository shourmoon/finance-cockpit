// src/domain/mortgage/comparison.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  MortgageBaselineResult,
  MortgageHistoryResult,
  MortgageComparisonResult,
} from "./types";
import { computeBaselineMortgage, periodsToMonths } from "./baseline";
import { computeMortgageWithPrepayments } from "./history";

/**
 * Compare a baseline (no-prepayment) path with an actual path that includes past prepayments.
 */
export function compareBaselineWithPrepayments(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog
): MortgageComparisonResult {
  const baseline: MortgageBaselineResult = computeBaselineMortgage(terms);
  const actual: MortgageHistoryResult = computeMortgageWithPrepayments(terms, prepayments);

  const interestSaved = baseline.totalInterest - actual.totalInterest;
  // Schedule lengths count payment periods; the caller renders this as
  // years and months, so convert before it leaves the domain.
  const monthsSaved = periodsToMonths(
    baseline.schedule.length - actual.schedule.length,
    terms.paymentFrequency
  );

  return {
    baseline,
    actual,
    interestSaved,
    monthsSaved,
  };
}
