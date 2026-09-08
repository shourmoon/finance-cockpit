// src/domain/mortgage/prepaymentImpact.ts
//
// Attribution for prepayments already made: what did each one actually buy?
//
// The table this feeds shows two figures per prepayment side by side — the
// cumulative saving against the no-prepayment baseline, and the incremental
// saving over the prepayments that came before it. That pairing is the whole
// point (was the third prepayment still worth making?) and it is also the
// hazard: the increments must telescope into the cumulative total, or the
// screen holds two answers to one question.
//
// This lived in MortgageTab.tsx as a useMemo, which is why it had no laws —
// the invariant discipline covers `src/domain`, and logic in a component sits
// outside it by construction. See prepaymentImpactInvariants.test.ts.

import type {
  AmortizationEntry,
  ISODate,
  Money,
  MortgageOriginalTerms,
  PastPrepaymentLog,
} from "./types";
import { computeMortgageWithPrepayments } from "./history";
import { periodsPerYear, periodsToMonths } from "./baseline";
import { effectiveAnnualRateOrNull } from "./irr";

/** One row of the past-prepayment impact table. */
export interface PrepaymentImpact {
  date: ISODate;
  amount: Money;
  note?: string;
  /** Cumulative interest saved compared with the baseline (no prepayments). */
  interestSaved: Money;
  /** Cumulative calendar months saved compared with the baseline. */
  monthsSaved: number;
  /** Effective annual rate after this prepayment and all previous ones. */
  effectiveRate: number | null;
  /** Interest saved by this prepayment alone, beyond the earlier ones. */
  interestSavedIncremental: Money;
  /** Calendar months saved by this prepayment alone, beyond the earlier ones. */
  monthsSavedIncremental: number;
}

/**
 * The part of a schedule result these comparisons need. The baseline and the
 * with-prepayments result are different types that share this shape, and the
 * running comparison walks from one to the other.
 */
interface SchedulePath {
  schedule: AmortizationEntry[];
  totalInterest: Money;
}

/**
 * Attribute savings to each past prepayment, chronologically.
 *
 * Pure. `baseline` is passed in rather than recomputed so the caller's other
 * figures and this table are derived from one and the same baseline — two
 * baselines for one loan would be two numbers for one quantity.
 */
export function computePrepaymentImpacts(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog,
  baseline: SchedulePath
): PrepaymentImpact[] {
  if (!prepayments.length) return [];

  // Chronological, because the attribution is "what did this one add to the
  // ones before it" and that question only means anything in date order.
  const sorted = [...prepayments].sort((a, b) => a.date.localeCompare(b.date));
  const perYear = periodsPerYear(terms.paymentFrequency);

  // Walks forward one prepayment at a time; each row is measured against the
  // path as it stood before that prepayment existed.
  let previous: SchedulePath = baseline;

  return sorted.map((prepayment, index) => {
    const actual = computeMortgageWithPrepayments(
      terms,
      sorted.slice(0, index + 1)
    );

    // Schedule lengths are counts of payment *periods*, not months — on a
    // biweekly loan the two differ by 26/12, and every figure here is
    // rendered as years and months.
    const monthsSaved = periodsToMonths(
      baseline.schedule.length - actual.schedule.length,
      terms.paymentFrequency
    );
    const monthsSavedIncremental = periodsToMonths(
      previous.schedule.length - actual.schedule.length,
      terms.paymentFrequency
    );

    const row: PrepaymentImpact = {
      date: prepayment.date,
      amount: prepayment.amount,
      ...(prepayment.note !== undefined ? { note: prepayment.note } : {}),
      interestSaved: baseline.totalInterest - actual.totalInterest,
      monthsSaved,
      effectiveRate: effectiveAnnualRateOrNull(
        actual.schedule,
        terms.principal,
        perYear
      ),
      interestSavedIncremental: previous.totalInterest - actual.totalInterest,
      monthsSavedIncremental,
    };

    previous = actual;
    return row;
  });
}
