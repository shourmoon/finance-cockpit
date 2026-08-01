// src/domain/mortgage/comparison.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  MortgageBaselineResult,
  MortgageHistoryResult,
  MortgageComparisonResult,
  Money,
  ISODate,
} from "./types";
import {
  computeBaselineMortgage,
  computeMonthlyPayment,
  computePeriodPayment,
  periodsPerYear,
  periodsToMonths,
} from "./baseline";
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

/** Mean days in a calendar month, for expressing gaps between payoff dates. */
const DAYS_PER_MONTH = 30.4375;

/** Calendar months between two ISO dates. Positive when `to` is later. */
function monthsBetween(from: ISODate, to: ISODate): number {
  const ms =
    Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z");
  return ms / (86_400_000 * DAYS_PER_MONTH);
}

/** One leg of the decomposition. */
export interface SavingsLeg {
  monthsSaved: number;
  interestSaved: Money;
}

export interface MortgageSavingsBreakdown {
  /** The loan as written: termMonths of monthly payments, no prepayments. */
  contract: { payoffDate: ISODate; totalInterest: Money };
  /** Contract terms paid on the real cadence, still with no prepayments. */
  cadence: { payoffDate: ISODate; totalInterest: Money };
  /** Where the loan actually stands: real cadence plus recorded prepayments. */
  actual: { payoffDate: ISODate; totalInterest: Money };

  /** Bought by paying more often than monthly. Zero on a monthly loan. */
  fromCadence: SavingsLeg;
  /** Bought by the recorded prepayments. */
  fromPrepayments: SavingsLeg;
  /** Both legs together, against the original contract. */
  total: SavingsLeg;

  /**
   * Extra principal the cadence contributes each year, over and above twelve
   * monthly payments. For biweekly this is exactly one monthly payment.
   */
  cadenceExtraPerYear: Money;
}

/**
 * Separate the three things that shortened a mortgage.
 *
 * The loan document says thirty years of MONTHLY payments; that is the only
 * honest baseline. Paying biweekly is itself an acceleration — 26 half
 * payments is 13 months' worth, so the cadence quietly prepays one extra
 * monthly payment every year — and on a $680k loan that alone is worth
 * several years and six figures of interest.
 *
 * compareBaselineWithPrepayments() cannot show this, because it baselines
 * against the loan's own stored cadence: with biweekly terms, its "baseline"
 * is already the accelerated schedule, so the cadence's saving nets to zero
 * and is silently omitted from the total. This function baselines against the
 * contract instead and attributes the difference to the right cause.
 *
 * Months are measured as the calendar gap between payoff dates, never as a
 * difference of schedule lengths: the contract steps monthly and the actual
 * schedule may step every 14 days, so their lengths are not comparable
 * quantities at all.
 */
export function decomposeMortgageSavings(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog
): MortgageSavingsBreakdown {
  // The contract is monthly by definition, whatever cadence is being paid.
  const contract = computeBaselineMortgage({
    ...terms,
    paymentFrequency: "monthly",
  });
  // The same loan on the real cadence, isolating the cadence's contribution.
  const cadence = computeBaselineMortgage(terms);
  const actual = computeMortgageWithPrepayments(terms, prepayments);

  const fromCadence: SavingsLeg = {
    monthsSaved: monthsBetween(cadence.payoffDate, contract.payoffDate),
    interestSaved: contract.totalInterest - cadence.totalInterest,
  };
  const fromPrepayments: SavingsLeg = {
    monthsSaved: monthsBetween(actual.payoffDate, cadence.payoffDate),
    interestSaved: cadence.totalInterest - actual.totalInterest,
  };

  // Paid per year on the real cadence, less twelve monthly payments.
  const perYearOnCadence =
    computePeriodPayment(terms) * periodsPerYear(terms.paymentFrequency);
  const perYearMonthly = computeMonthlyPayment(terms) * 12;

  return {
    contract: {
      payoffDate: contract.payoffDate,
      totalInterest: contract.totalInterest,
    },
    cadence: {
      payoffDate: cadence.payoffDate,
      totalInterest: cadence.totalInterest,
    },
    actual: {
      payoffDate: actual.payoffDate,
      totalInterest: actual.totalInterest,
    },
    fromCadence,
    fromPrepayments,
    total: {
      monthsSaved: monthsBetween(actual.payoffDate, contract.payoffDate),
      interestSaved: contract.totalInterest - actual.totalInterest,
    },
    cadenceExtraPerYear: perYearOnCadence - perYearMonthly,
  };
}
