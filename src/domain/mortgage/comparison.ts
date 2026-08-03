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
import {
  expandContributionPlan,
  type ContributionPlan,
  type DatedContribution,
} from "../contributionPlan";

export type { ContributionPlan };

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

/**
 * Calendar months between two ISO dates. Positive when `to` is later.
 *
 * Exported so every "months saved" figure in the app derives from one
 * definition. Schedule-length differences are not usable for this: a monthly
 * schedule and a biweekly one step at different intervals, so only the gap
 * between payoff dates is comparable across them.
 */
export function monthsBetween(from: ISODate, to: ISODate): number {
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
  /** Bought by a planned future lump sum. Zero without a plan. */
  fromFutureLump: SavingsLeg;
  /** Bought by planned future monthly contributions. Zero without a plan. */
  fromFutureMonthly: SavingsLeg;
  /** Bought by a planned future yearly contribution. Zero without a plan. */
  fromFutureYearly: SavingsLeg;
  /** Where the loan lands once the whole plan is applied. */
  projected: { payoffDate: ISODate; totalInterest: Money };
  /** Every leg together, against the original contract. */
  total: SavingsLeg;

  /**
   * Extra principal the cadence contributes each year, over and above twelve
   * monthly payments. For biweekly this is exactly one monthly payment.
   */
  cadenceExtraPerYear: Money;
}

/**
 * Separate everything that shortened — or would shorten — a mortgage, into
 * legs that reconcile: the payment cadence, the prepayments already made,
 * and optionally a planned future lump sum and monthly contribution.
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
 *
 * Called with two arguments this is the "where things stand today" view and
 * the two future legs are zero. Pass a plan to project forward.
 */
export function decomposeMortgageSavings(
  terms: MortgageOriginalTerms,
  prepayments: PastPrepaymentLog,
  plan?: ContributionPlan
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

  // Layer the plan on one piece at a time so each gets its own leg. The
  // order — lump, then monthly, then yearly — is a presentational choice:
  // the three are simultaneous in reality, so how the joint effect is split
  // between them is an attribution convention rather than a fact. What has
  // to be true is that the legs reconcile to the total, which they do by
  // construction, since each is the gap between two successive stages.
  const expand = (over: Partial<ContributionPlan>) =>
    plan
      ? expandContributionPlan(
          { ...plan, lumpSum: 0, monthly: 0, yearly: 0, ...over },
          terms.termMonths
        )
      : [];

  const lumpOnly = expand({ lumpSum: plan?.lumpSum ?? 0 });
  const plusMonthly = [...lumpOnly, ...expand({ monthly: plan?.monthly ?? 0 })];
  const plusYearly = [...plusMonthly, ...expand({ yearly: plan?.yearly ?? 0 })];

  // Only ever called with a non-empty `extra`; the callers below fall back to
  // the previous stage when a plan component contributes nothing.
  const stage = (extra: DatedContribution[]) =>
    computeMortgageWithPrepayments(terms, [...prepayments, ...extra]);

  const withLump = lumpOnly.length ? stage(lumpOnly) : actual;
  const withMonthly = plusMonthly.length > lumpOnly.length ? stage(plusMonthly) : withLump;
  const withAll = plusYearly.length > plusMonthly.length ? stage(plusYearly) : withMonthly;

  const fromFutureLump: SavingsLeg = {
    monthsSaved: monthsBetween(withLump.payoffDate, actual.payoffDate),
    interestSaved: actual.totalInterest - withLump.totalInterest,
  };
  const fromFutureMonthly: SavingsLeg = {
    monthsSaved: monthsBetween(withMonthly.payoffDate, withLump.payoffDate),
    interestSaved: withLump.totalInterest - withMonthly.totalInterest,
  };
  const fromFutureYearly: SavingsLeg = {
    monthsSaved: monthsBetween(withAll.payoffDate, withMonthly.payoffDate),
    interestSaved: withMonthly.totalInterest - withAll.totalInterest,
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
    fromFutureLump,
    fromFutureMonthly,
    fromFutureYearly,
    projected: {
      payoffDate: withAll.payoffDate,
      totalInterest: withAll.totalInterest,
    },
    total: {
      monthsSaved: monthsBetween(withAll.payoffDate, contract.payoffDate),
      interestSaved: contract.totalInterest - withAll.totalInterest,
    },
    cadenceExtraPerYear: perYearOnCadence - perYearMonthly,
  };
}
