// src/domain/mortgage/history.ts
import type {
  MortgageOriginalTerms,
  AmortizationEntry,
  MortgageHistoryResult,
  PastPrepaymentLog,
} from "./types";
import { computeMonthlyPayment, addMonths } from "./baseline";

/**
 * Build an amortization schedule that includes past prepayments.
 *
 * Assumptions:
 * - Payments are monthly, on the same day-of-month as startDate.
 * - Prepayments can occur on arbitrary calendar dates (not necessarily
 *   aligned to the exact payment dates).
 * - Each prepayment is applied as extra principal on the first payment
 *   date on or after the prepayment date.
 */
export function computeMortgageWithPrepayments(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog
): MortgageHistoryResult {
  const payment = computeMonthlyPayment(terms);
  const schedule: AmortizationEntry[] = [];

  // Sort prepayments by date so we can stream them in a single pass.
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
    const scheduledPrincipal = payment - interest;

    // Unreachable: the annuity payment from computeMonthlyPayment always
    // exceeds the first month's interest, and interest only shrinks.
    /* v8 ignore next 3 */
    if (scheduledPrincipal < 0) {
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

    // Clamp to what's actually owed so a prepayment can never pay down more
    // than the remaining balance. `principal`/`payment` below are derived
    // from this clamped total so the entry's own numbers always agree with
    // each other (payment === interest + principal), whether or not this
    // period's total overshot what was owed.
    const totalPrincipal = Math.min(scheduledPrincipal + extra, remaining);

    remaining = Math.max(0, remaining - totalPrincipal);

    schedule.push({
      date,
      payment: interest + totalPrincipal,
      interest,
      principal: totalPrincipal,
      remaining,
    });

    payoffDate = date;
  }

  const totalInterest = schedule.reduce((sum, e) => sum + e.interest, 0);

  return {
    schedule,
    totalInterest,
    payoffDate,
  };
}
