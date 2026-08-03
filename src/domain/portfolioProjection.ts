// src/domain/portfolioProjection.ts
//
// Given a lump of surplus cash, simulate splitting it between the market and
// the mortgage, and report both sides of the trade: how much sooner the loan
// is gone, and how much long-run wealth that costs.
//
// The comparison is cashflow-equalised. Every path spends exactly the same
// out of pocket each period — the mortgage payment — and the moment a path's
// loan is retired, that payment is redirected into the market. Without this,
// prepaying looks strictly worse than it is, because its whole point is that
// it frees up cashflow years early.
//
// Everything is measured at a single horizon, after tax, net of any debt
// still outstanding. That gives one number per path that can honestly be
// compared with another: what the household is actually worth.

import type { Money, ISODate } from "./types";
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  AmortizationEntry,
} from "./mortgage/types";
import { computeMortgageWithPrepayments } from "./mortgage/history";
import { monthsBetween } from "./mortgage/comparison";
import {
  addMonths,
  addPeriods,
  computePeriodPayment,
} from "./mortgage/baseline";
import {
  expandContributionPlan,
  type DatedContribution,
} from "./contributionPlan";

/** Splits the card offers by default: none, a quarter, half, most, all. */
export const DEFAULT_SPLITS = [0, 0.25, 0.5, 0.75, 1];

export interface AllocationInput {
  terms: MortgageOriginalTerms;
  /** Prepayments already made. Present in every path — they are history. */
  prepayments: PastPrepaymentLog;
  /** "Now": the date the new money would be deployed. */
  asOfDate: ISODate;
  /** Cash free to allocate right now, from computeSurplus(). */
  surplus: Money;
  /**
   * Ongoing money the household can direct each month from asOfDate onward,
   * split between the two destinations on the same fraction as the lump.
   * Optional; absent or unusable means none.
   */
  monthlyContribution?: Money;
  /** An amount once a year, e.g. a bonus. Split on the same fraction. */
  yearlyContribution?: Money;
  /** Calendar month (1-12) the yearly amount lands in. */
  yearlyMonth?: number;
  /** Both recurring streams stop after this date. The lump is unaffected. */
  contributionsUntil?: ISODate;
  /** Expected pre-tax annual market return, e.g. 0.07. */
  annualReturn: number;
  /** Combined marginal rate on long-term capital gains. */
  capitalGainsRate: number;
  /** How far out to measure. */
  horizonYears: number;
  /** Fractions of the surplus sent to the mortgage. Defaults to DEFAULT_SPLITS. */
  splits?: number[];
}

export interface AllocationOutcome {
  fractionToPrepayment: number;
  toPrepayment: Money;
  toMarket: Money;
  /** Of the monthly contribution, what goes to extra principal. */
  monthlyToPrepayment: Money;
  /** Of the monthly contribution, what is invested. */
  monthlyToMarket: Money;
  /** Of the yearly contribution, what goes to extra principal. */
  yearlyToPrepayment: Money;
  /** Of the yearly contribution, what is invested. */
  yearlyToMarket: Money;
  /** When the mortgage is retired under this split. */
  payoffDate: ISODate;
  /** Months earlier than the all-market path. Zero for the reference. */
  monthsShaved: number;
  /** Mortgage interest avoided versus the all-market path. */
  interestSaved: Money;
  /** Everything paid into the market over the horizon, surplus included. */
  contributions: Money;
  /** Market value at the horizon, after capital gains tax on the gain. */
  portfolioAfterTax: Money;
  /** Mortgage balance still owed when the clock stops. */
  remainingDebtAtHorizon: Money;
  /** portfolioAfterTax - remainingDebtAtHorizon. The comparable number. */
  netWorthAtHorizon: Money;
  /** Years spent mortgage-free before the horizon. */
  debtFreeYears: number;
  /** Net worth foregone versus the all-market path. Zero for the reference. */
  wealthGivenUp: Money;
  /** wealthGivenUp / monthsShaved. Null when nothing was shaved. */
  costPerMonthShaved: Money | null;
}

export interface AllocationComparison {
  horizonYears: number;
  expectedReturn: number;
  capitalGainsRate: number;
  /** The all-market path every other outcome is measured against. */
  reference: AllocationOutcome;
  outcomes: AllocationOutcome[];
  /** True when the all-market path ends up worth the most. */
  marketFavoured: boolean;
}

/** Days in a year, averaged over the leap cycle. */
const DAYS_PER_YEAR = 365.25;

/** Exact year fraction between two dates. Negative when `to` precedes `from`. */
function yearsBetween(from: ISODate, to: ISODate): number {
  return (
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
    (DAYS_PER_YEAR * 86_400_000)
  );
}

/** Clamp to a usable number, falling back to `fallback`. */
function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * The mortgage balance owed on `date`, given a schedule.
 *
 * A schedule that has run out means the loan is gone, so nothing is owed —
 * which is the case that matters, since the whole point of prepaying is to
 * reach it sooner.
 */
function balanceOn(schedule: AmortizationEntry[], date: ISODate): Money {
  let owed = 0;
  for (const entry of schedule) {
    if (entry.date > date) break;
    owed = entry.remaining;
  }
  // Before the first payment the original principal is still outstanding.
  if (schedule.length > 0 && date < schedule[0].date) {
    return schedule[0].remaining + schedule[0].principal;
  }
  return owed;
}

interface PathResult {
  payoffDate: ISODate;
  totalInterest: Money;
  contributions: Money;
  portfolioAfterTax: Money;
  remainingDebtAtHorizon: Money;
  debtFreeYears: number;
}

/**
 * Value one path at the horizon.
 *
 * If the loan is retired before then, the payment that would have gone to the
 * servicer goes into the market instead. Contributions are tracked separately
 * from value so capital gains land on the gain alone.
 *
 * Every contribution compounds from its own calendar date to the horizon, so
 * the result is exact rather than discretised onto the payment grid.
 */
function simulatePath(
  schedule: AmortizationEntry[],
  payoffDate: ISODate,
  totalInterest: Money,
  lumpToMarket: Money,
  periodPayment: Money,
  frequency: MortgageOriginalTerms["paymentFrequency"],
  asOfDate: ISODate,
  horizonDate: ISODate,
  capitalGainsRate: number,
  annualReturn: number,
  toMarketDated: DatedContribution[],
  unappliedPrepayments: DatedContribution[]
): PathResult {
  // Everything the household puts into the market, on the day it goes in.
  const invested: DatedContribution[] = [];
  if (lumpToMarket > 0) invested.push({ date: asOfDate, amount: lumpToMarket });
  for (const c of toMarketDated) invested.push(c);

  // Once the loan is retired, everything that was going to the servicer is
  // investable instead: the scheduled payment, and any mortgage-directed
  // contributions dated after payoff, which have nothing left to pay down.
  // The freed payment keeps the loan's own cadence, so its dates continue
  // from the final payment rather than from the as-of date — those two grids
  // only coincide when the as-of date happens to fall on a payment day.
  if (payoffDate <= horizonDate) {
    // The final instalment is only what was still owed, which is usually less
    // than a full payment. The difference is freed on that very day, and not
    // crediting it left the two paths spending unequal amounts in their last
    // month — enough that prepaying could lose at a zero return.
    const last = schedule.at(-1);
    if (last && last.payment < periodPayment) {
      invested.push({ date: payoffDate, amount: periodPayment - last.payment });
    }
    for (let k = 1; ; k++) {
      const date = addPeriods(payoffDate, k, frequency);
      if (date > horizonDate) break;
      invested.push({ date, amount: periodPayment });
    }
  }
  // Whatever the loan could not absorb comes back to the household, on the
  // date it became unusable — money committed to a mortgage smaller than the
  // payment, or already retired. Without this a plan that overshoots a
  // nearly-paid-off loan appears to destroy money, and the mortgage path
  // could lose to the market even at a zero return.
  for (const c of unappliedPrepayments) invested.push(c);

  // Each contribution compounds from its own date to the horizon. No
  // bucketing into payment periods: that shifted every contribution up to a
  // period late, which understated the market by a small but systematic
  // margin and made the two arms of the comparison unequally funded.
  let value = 0;
  let basis = 0;
  for (const c of invested) {
    if (c.date > horizonDate) continue;
    value += c.amount * Math.pow(1 + annualReturn, yearsBetween(c.date, horizonDate));
    basis += c.amount;
  }

  const gain = Math.max(0, value - basis);
  const portfolioAfterTax = value - gain * capitalGainsRate;

  // What is still owed when the clock stops, read off the schedule by date
  // rather than by counting periods from the as-of date.
  const remainingDebtAtHorizon =
    payoffDate <= horizonDate ? 0 : Math.max(0, balanceOn(schedule, horizonDate));

  return {
    payoffDate,
    totalInterest,
    contributions: basis,
    portfolioAfterTax,
    remainingDebtAtHorizon,
    debtFreeYears: Math.max(0, yearsBetween(payoffDate, horizonDate)),
  };
}

/**
 * Compare several splits of the same surplus between market and mortgage.
 *
 * The all-market split (fraction 0) is always simulated and used as the
 * reference, whether or not the caller asked for it, so "months shaved" and
 * "wealth given up" always have something to be measured against.
 */
/**
 * Everything about a comparison that does NOT depend on the market return:
 * the fractions, how much money goes where, and each split's amortization
 * schedule. Building this is the expensive part — an amortization per split
 * — and the break-even solver varies only the return, so it prepares once
 * and re-walks the cheap portfolio loop per iteration instead of rebuilding
 * schedules on all fifty of them.
 */
interface PreparedComparison {
  periodPayment: Money;
  frequency: MortgageOriginalTerms["paymentFrequency"];
  horizonYears: number;
  horizonDate: ISODate;
  capitalGainsRate: number;
  asOfDate: ISODate;
  fractions: number[];
  runs: {
    fraction: number;
    toPrepayment: Money;
    toMarket: Money;
    monthlyToPrepayment: Money;
    monthlyToMarket: Money;
    yearlyToPrepayment: Money;
    yearlyToMarket: Money;
    toMarketDated: DatedContribution[];
    unappliedPrepayments: DatedContribution[];
    schedule: AmortizationEntry[];
    payoffDate: ISODate;
    totalInterest: Money;
  }[];
}

function prepareComparison(
  input: Omit<AllocationInput, "annualReturn">
): PreparedComparison {
  const periodPayment = computePeriodPayment(input.terms);

  const surplus = Math.max(0, num(input.surplus, 0));
  const horizonYears = Math.max(0, num(input.horizonYears, 0));
  // A calendar date, not a count of payment periods: 78 biweekly periods is
  // 1,092 days, which is three weeks short of three years, and deriving the
  // horizon from the payment grid quietly imported that error into every
  // figure measured at it.
  const horizonDate = addMonths(
    input.asOfDate,
    Math.max(0, Math.round(horizonYears * 12))
  );
  const capitalGainsRate = Math.min(1, Math.max(0, num(input.capitalGainsRate, 0)));
  const monthlyContribution = Math.max(0, num(input.monthlyContribution, 0));
  const yearlyContribution = Math.max(0, num(input.yearlyContribution, 0));
  const asOfDate = input.asOfDate;

  const requested = Array.isArray(input.splits) ? input.splits : DEFAULT_SPLITS;
  // Clamp each fraction into [0, 1] and make sure the reference is present.
  const fractions = requested
    .filter((f) => Number.isFinite(f))
    .map((f) => Math.min(1, Math.max(0, f)));
  const withReference = fractions.includes(0) ? fractions : [0, ...fractions];

  // What is owed today does not vary by split, so build it once.
  const owedNow = balanceOn(
    computeMortgageWithPrepayments(input.terms, input.prepayments).schedule,
    asOfDate
  );

  const runs = withReference.map((fraction) => {
    // Never send more to the servicer than is actually owed; the excess would
    // simply be refunded, so it stays invested here.
    const toPrepayment = Math.min(surplus * fraction, owedNow);
    const toMarket = surplus - toPrepayment;

    const monthlyToPrepayment = monthlyContribution * fraction;
    const monthlyToMarket = monthlyContribution - monthlyToPrepayment;
    const yearlyToPrepayment = yearlyContribution * fraction;
    const yearlyToMarket = yearlyContribution - yearlyToPrepayment;

    // One expansion per destination, from the same plan shape, so the two
    // arms of the comparison see the same money on the same days.
    const planFor = (lumpSum: Money, monthly: Money, yearly: Money) =>
      expandContributionPlan(
        {
          asOfDate,
          lumpSum,
          monthly,
          yearly,
          yearlyMonth: input.yearlyMonth,
          until: input.contributionsUntil,
        },
        input.terms.termMonths
      );

    // Neither lump goes through the plan expansion. The mortgage-bound lump
    // is clamped to what is actually owed, which the expansion knows nothing
    // about; the market-bound lump is money in hand on the as-of date and is
    // seeded into the portfolio before the walk starts, so it compounds for
    // the whole horizon. Routing it through the buckets instead cost it a
    // period of growth, because the walk grows the balance before adding
    // that period's contributions.
    const toPrepaymentDated = planFor(0, monthlyToPrepayment, yearlyToPrepayment);
    const toMarketDated = planFor(0, monthlyToMarket, yearlyToMarket);

    const prepayments = [
      ...input.prepayments,
      ...(toPrepayment > 0 ? [{ date: asOfDate, amount: toPrepayment }] : []),
      ...toPrepaymentDated,
    ];

    const { schedule, payoffDate, totalInterest, unappliedPrepayments } =
      computeMortgageWithPrepayments(input.terms, prepayments);

    return {
      fraction,
      toPrepayment,
      toMarket,
      monthlyToPrepayment,
      monthlyToMarket,
      yearlyToPrepayment,
      yearlyToMarket,
      toMarketDated,
      unappliedPrepayments,
      schedule,
      payoffDate,
      totalInterest,
    };
  });

  return {
    periodPayment,
    frequency: input.terms.paymentFrequency,
    horizonYears,
    horizonDate,
    capitalGainsRate,
    asOfDate,
    fractions,
    runs,
  };
}

/** Walk every prepared path at one market return and assemble the outcomes. */
function evaluateComparison(
  ctx: PreparedComparison,
  rawAnnualReturn: number
): AllocationComparison {
  const annualReturn = Math.max(-0.999, num(rawAnnualReturn, 0));

  const runs = ctx.runs.map((r) => ({
    ...r,
    path: simulatePath(
      r.schedule,
      r.payoffDate,
      r.totalInterest,
      r.toMarket,
      ctx.periodPayment,
      ctx.frequency,
      ctx.asOfDate,
      ctx.horizonDate,
      ctx.capitalGainsRate,
      annualReturn,
      r.toMarketDated,
      r.unappliedPrepayments
    ),
  }));

  const referenceRun = runs.find((r) => r.fraction === 0)!;

  const toOutcome = (r: (typeof runs)[number]): AllocationOutcome => {
    const netWorthAtHorizon =
      r.path.portfolioAfterTax - r.path.remainingDebtAtHorizon;
    const referenceNet =
      referenceRun.path.portfolioAfterTax -
      referenceRun.path.remainingDebtAtHorizon;

    // Measured between payoff dates, deliberately NOT clipped to the
    // horizon. The horizon governs how far out wealth is measured; it must
    // not silently rewrite how much time was bought, or a short horizon
    // would report "no time saved" beside two payoff dates years apart —
    // and beside an attribution breakdown that is never clipped.
    const monthsShaved = monthsBetween(
      r.path.payoffDate,
      referenceRun.path.payoffDate
    );
    const wealthGivenUp = referenceNet - netWorthAtHorizon;

    return {
      fractionToPrepayment: r.fraction,
      toPrepayment: r.toPrepayment,
      toMarket: r.toMarket,
      monthlyToPrepayment: r.monthlyToPrepayment,
      monthlyToMarket: r.monthlyToMarket,
      yearlyToPrepayment: r.yearlyToPrepayment,
      yearlyToMarket: r.yearlyToMarket,
      payoffDate: r.path.payoffDate,
      monthsShaved,
      interestSaved: referenceRun.path.totalInterest - r.path.totalInterest,
      contributions: r.path.contributions,
      portfolioAfterTax: r.path.portfolioAfterTax,
      remainingDebtAtHorizon: r.path.remainingDebtAtHorizon,
      netWorthAtHorizon,
      debtFreeYears: r.path.debtFreeYears,
      wealthGivenUp,
      costPerMonthShaved: monthsShaved > 0 ? wealthGivenUp / monthsShaved : null,
    };
  };

  const allOutcomes = runs.map(toOutcome);
  const reference = allOutcomes.find((o) => o.fractionToPrepayment === 0)!;

  // Report only what the caller asked for, but keep the reference available.
  const outcomes = ctx.fractions.length
    ? allOutcomes.filter((o) => ctx.fractions.includes(o.fractionToPrepayment))
    : [];

  const best = allOutcomes.reduce((a, b) =>
    b.netWorthAtHorizon > a.netWorthAtHorizon ? b : a
  );

  return {
    horizonYears: ctx.horizonYears,
    expectedReturn: annualReturn,
    capitalGainsRate: ctx.capitalGainsRate,
    reference,
    outcomes,
    marketFavoured: best.fractionToPrepayment === 0,
  };
}

export function compareSurplusAllocations(
  input: AllocationInput
): AllocationComparison {
  return evaluateComparison(prepareComparison(input), input.annualReturn);
}


/** Widest market return the solver will consider before giving up. */
const MAX_SEARCH_RETURN = 0.5;

/**
 * The pre-tax annual market return at which putting the whole surplus into
 * the market and putting it all into the mortgage end up worth exactly the
 * same. Below it, prepaying wins; above it, investing does.
 *
 * This — not the closed form in surplusAllocation.ts — is the number to show
 * the user, because the two do not agree and the simulation is the honest
 * one. The closed form assumes the comparison ends when the loan does, so a
 * dollar of avoided interest compounds at the mortgage rate for the whole
 * period. In reality the household keeps going after payoff, and the freed
 * payment compounds in the MARKET instead. That reinvestment window works in
 * the market's favour, so the real break-even sits BELOW the closed form and
 * falls further the longer the horizon runs past payoff:
 *
 *     horizon = remaining term (20.5y)   5.76%   (closed form: 5.71%)
 *     horizon 30y                        5.46%
 *     horizon 50y                        5.11%
 *
 * The two agree only where the closed form's assumption holds, which is the
 * first row. Note this also reverses the direction with loan age: the closed
 * form has the bar rising as the loan shortens, the simulation has it falling.
 *
 * Returns null when the question is meaningless — nothing to allocate, no
 * horizon, or a mortgage that is already paid off.
 */
export function solveBreakEvenReturn(
  input: Omit<AllocationInput, "annualReturn" | "splits">
): number | null {
  const lump = Number.isFinite(input.surplus) ? input.surplus : 0;
  const stream =
    (Number.isFinite(input.monthlyContribution)
      ? (input.monthlyContribution as number)
      : 0) +
    (Number.isFinite(input.yearlyContribution)
      ? (input.yearlyContribution as number)
      : 0);
  // Nothing to allocate either way means there is no question to answer.
  if (lump <= 0 && stream <= 0) return null;
  if (!Number.isFinite(input.horizonYears) || input.horizonYears <= 0) {
    return null;
  }

  // Schedules do not depend on the return, so build them once and re-walk
  // only the portfolio loop per iteration.
  const ctx = prepareComparison({ ...input, splits: [0, 1] });
  const advantage = (annualReturn: number) => {
    const c = evaluateComparison(ctx, annualReturn);
    return c.outcomes[1].netWorthAtHorizon - c.outcomes[0].netWorthAtHorizon;
  };

  // A loan with nothing left to prepay makes both paths effectively
  // identical. Requiring a materially positive advantage rather than merely
  // a positive one keeps floating-point noise on an indistinguishable pair
  // from being solved into a confident-looking rate.
  const MATERIAL = 0.01;
  if (advantage(0) <= MATERIAL) return null;
  // No sane return lets the market catch up; treat as out of range rather
  // than reporting a bogus edge value.
  if (advantage(MAX_SEARCH_RETURN) > 0) return null;

  let lo = 0;
  let hi = MAX_SEARCH_RETURN;
  // Stop once the bracket is far tighter than anything that could matter:
  // the card renders one decimal place of a percent, and 1e-9 on the rate is
  // pennies on the net-worth difference. The iteration cap is a guard, not
  // the normal exit — bisection reaches the tolerance in about 29 steps.
  for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    if (advantage(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
