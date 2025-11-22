// src/domain/mortgage/history.ts
import type {
  MortgageOriginalTerms,
  AmortizationEntry,
  MortgageHistoryResult,
  PastPrepaymentLog,
  Money,
} from "./types";
import { computeMonthlyPayment, addMonths } from "./baseline";

/**
 * Build an amortization schedule that includes past prepayments.
 *
 * Assumptions:
 * - Payments are monthly, on the same day-of-month as startDate.
 * - Each prepayment is applied as extra principal on the period whose date matches the prepayment date.
 */
export function computeMortgageWithPrepayments(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog
): MortgageHistoryResult {
  const payment = computeMonthlyPayment(terms);
  const schedule: AmortizationEntry[] = [];

  // Defensive copy & sort prepayments by date (ascending). This ensures
  // that changing the prepayment dates in the UI always changes the
  // simulation result, even if the dates are not perfectly aligned
  // with the contractual payment dates.
  const sortedPrepayments = [...prepayments].sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  let prepayIndex = 0;
  let remaining = terms.principal;
  const r = terms.annualRate / 12;
  const epsilon = 1e-6;
  let payoffDate = terms.startDate;

  for (let i = 0; i < terms.termMonths && remaining > epsilon; i++) {
    const date = addMonths(terms.startDate, i);
    const interest = r > 0 ? remaining * r : 0;
    let principal = payment - interest;

    if (principal < 0) {
      throw new Error("Monthly payment too low to amortize the loan.");
    }

    // Apply any extra principal for all prepayments whose date is on or
    // before the current payment date and that have not yet been applied.
    let extra = 0;
    while (
      prepayIndex < sortedPrepayments.length &&
      sortedPrepayments[prepayIndex].date <= date
    ) {
      extra += sortedPrepayments[prepayIndex].amount;
      prepayIndex++;
    }

    let totalPrincipal = principal + extra;

    if (totalPrincipal > remaining) {
      totalPrincipal = remaining;
      principal = Math.max(0, totalPrincipal - extra);
    }

    remaining = Math.max(0, remaining - totalPrincipal);

    schedule.push({
      date,
      payment: payment + extra,
      interest,
      principal,
      remaining,
    });

    payoffDate = date;
  }

  const totalInterest = schedule.reduce(
    (sum, e) => sum + e.interest,
    0
  );

  return {
    schedule,
    totalInterest,
    payoffDate,
  };
}
