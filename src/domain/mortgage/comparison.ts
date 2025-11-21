// src/domain/mortgage/comparison.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  MortgageBaselineResult,
  MortgageHistoryResult,
  MortgageComparisonResult,
} from "./types";
import { computeBaselineMortgage } from "./baseline";
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
  const monthsSaved = baseline.schedule.length - actual.schedule.length;

  return {
    baseline,
    actual,
    interestSaved,
    monthsSaved,
  };
}
