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
import { addMonths } from "./mortgage/baseline";
import {
  computePeriodPayment,
  periodsPerYear,
  periodsToMonths,
} from "./mortgage/baseline";

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

/**
 * One extra payment a month from `from`. Generated out to the full term so
 * the stream always outlasts the schedule; entries falling after payoff are
 * simply never applied by the amortization loop.
 */
function monthlyPrepayments(
  from: ISODate,
  amount: Money,
  termMonths: number
): { date: ISODate; amount: Money }[] {
  const out: { date: ISODate; amount: Money }[] = [];
  for (let i = 0; i < termMonths; i++) {
    out.push({ date: addMonths(from, i), amount });
  }
  return out;
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
  periodsToPayoff: number;
}

/**
 * Walk one path from `asOfDate` to the horizon.
 *
 * Per period: if the loan is already retired, the payment that would have
 * gone to the servicer goes into the market instead. Contributions are
 * tracked separately from value so capital gains land on the gain alone.
 */
function simulatePath(
  schedule: AmortizationEntry[],
  payoffDate: ISODate,
  totalInterest: Money,
  initialInvestment: Money,
  perYear: number,
  periodPayment: Money,
  horizonPeriods: number,
  asOfDate: ISODate,
  capitalGainsRate: number,
  periodReturn: number,
  monthlyToMarket: Money,
  monthlyToPrepayment: Money
): PathResult {
  let value = initialInvestment;
  let basis = initialInvestment;
  let periodsToPayoff = horizonPeriods;
  let sawPayoff = false;

  // Only the part of the schedule still ahead of us is relevant.
  const future = schedule.filter((e) => e.date > asOfDate);

  // Recurring money is quoted per month but the walk steps in payment
  // periods, so spread each stream across the periods in a year.
  const perPeriodToMarket = (monthlyToMarket * 12) / perYear;
  const perPeriodToPrepayment = (monthlyToPrepayment * 12) / perYear;

  for (let i = 0; i < horizonPeriods; i++) {
    value *= 1 + periodReturn;

    let contribution = perPeriodToMarket;

    // The loan is gone once we run past the end of its remaining schedule.
    const stillPaying = i < future.length;
    if (!stillPaying) {
      if (!sawPayoff) {
        periodsToPayoff = i;
        sawPayoff = true;
      }
      // Everything that was going to the servicer is now investable: the
      // scheduled payment AND the recurring extra principal, which has
      // nothing left to pay down. Dropping the latter would understate the
      // prepay path badly — enough to make the market "win" at a 0% return,
      // which is how this was caught.
      contribution += periodPayment + perPeriodToPrepayment;
    }

    if (contribution > 0) {
      value += contribution;
      basis += contribution;
    }
  }

  const gain = Math.max(0, value - basis);
  const portfolioAfterTax = value - gain * capitalGainsRate;

  // Debt left when the clock stops: the balance after the last payment that
  // fell inside the horizon, or zero if the loan finished first.
  const remainingDebtAtHorizon =
    future.length > horizonPeriods
      ? future[horizonPeriods - 1]?.remaining ?? 0
      : 0;

  const debtFreePeriods = Math.max(0, horizonPeriods - future.length);

  return {
    payoffDate,
    totalInterest,
    contributions: basis,
    portfolioAfterTax,
    remainingDebtAtHorizon: Math.max(0, remainingDebtAtHorizon),
    debtFreeYears: debtFreePeriods / perYear,
    periodsToPayoff,
  };
}

/**
 * Compare several splits of the same surplus between market and mortgage.
 *
 * The all-market split (fraction 0) is always simulated and used as the
 * reference, whether or not the caller asked for it, so "months shaved" and
 * "wealth given up" always have something to be measured against.
 */
export function compareSurplusAllocations(
  input: AllocationInput
): AllocationComparison {
  const perYear = periodsPerYear(input.terms.paymentFrequency);
  const periodPayment = computePeriodPayment(input.terms);

  const surplus = Math.max(0, num(input.surplus, 0));
  const horizonYears = Math.max(0, num(input.horizonYears, 0));
  const horizonPeriods = Math.max(0, Math.round(horizonYears * perYear));
  const capitalGainsRate = Math.min(1, Math.max(0, num(input.capitalGainsRate, 0)));
  const annualReturn = Math.max(-0.999, num(input.annualReturn, 0));
  const monthlyContribution = Math.max(0, num(input.monthlyContribution, 0));
  const periodReturn = Math.pow(1 + annualReturn, 1 / perYear) - 1;
  const asOfDate = input.asOfDate;

  const requested = Array.isArray(input.splits) ? input.splits : DEFAULT_SPLITS;
  // Clamp each fraction into [0, 1] and make sure the reference is present.
  const fractions = requested
    .filter((f) => Number.isFinite(f))
    .map((f) => Math.min(1, Math.max(0, f)));
  const withReference = fractions.includes(0) ? fractions : [0, ...fractions];

  const run = (fraction: number) => {
    const requestedPrepay = surplus * fraction;
    // Never send more to the servicer than is actually owed; the excess would
    // simply be refunded, so it stays invested here.
    const owedNow = balanceOn(
      computeMortgageWithPrepayments(input.terms, input.prepayments).schedule,
      asOfDate
    );
    const toPrepayment = Math.min(requestedPrepay, owedNow);
    const toMarket = surplus - toPrepayment;

    const monthlyToPrepayment = monthlyContribution * fraction;
    const monthlyToMarket = monthlyContribution - monthlyToPrepayment;

    // Recurring extra principal is expressed as one prepayment a month.
    // Entries past payoff are never applied, so over-generating is safe.
    const recurring =
      monthlyToPrepayment > 0
        ? monthlyPrepayments(asOfDate, monthlyToPrepayment, input.terms.termMonths)
        : [];

    const prepayments = [
      ...input.prepayments,
      ...(toPrepayment > 0 ? [{ date: asOfDate, amount: toPrepayment }] : []),
      ...recurring,
    ];

    const { schedule, payoffDate, totalInterest } = computeMortgageWithPrepayments(
      input.terms,
      prepayments
    );

    return {
      fraction,
      toPrepayment,
      toMarket,
      monthlyToPrepayment,
      monthlyToMarket,
      path: simulatePath(
        schedule,
        payoffDate,
        totalInterest,
        toMarket,
        perYear,
        periodPayment,
        horizonPeriods,
        asOfDate,
        capitalGainsRate,
        periodReturn,
        monthlyToMarket,
        monthlyToPrepayment
      ),
    };
  };

  const runs = withReference.map(run);
  const referenceRun = runs.find((r) => r.fraction === 0)!;

  const toOutcome = (r: (typeof runs)[number]): AllocationOutcome => {
    const netWorthAtHorizon =
      r.path.portfolioAfterTax - r.path.remainingDebtAtHorizon;
    const referenceNet =
      referenceRun.path.portfolioAfterTax -
      referenceRun.path.remainingDebtAtHorizon;

    const monthsShaved = periodsToMonths(
      referenceRun.path.periodsToPayoff - r.path.periodsToPayoff,
      input.terms.paymentFrequency
    );
    const wealthGivenUp = referenceNet - netWorthAtHorizon;

    return {
      fractionToPrepayment: r.fraction,
      toPrepayment: r.toPrepayment,
      toMarket: r.toMarket,
      monthlyToPrepayment: r.monthlyToPrepayment,
      monthlyToMarket: r.monthlyToMarket,
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
  const outcomes = fractions.length
    ? allOutcomes.filter((o) => fractions.includes(o.fractionToPrepayment))
    : [];

  const best = allOutcomes.reduce((a, b) =>
    b.netWorthAtHorizon > a.netWorthAtHorizon ? b : a
  );

  return {
    horizonYears,
    expectedReturn: annualReturn,
    capitalGainsRate,
    reference,
    outcomes,
    marketFavoured: best.fractionToPrepayment === 0,
  };
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
  const stream = Number.isFinite(input.monthlyContribution)
    ? (input.monthlyContribution as number)
    : 0;
  // Nothing to allocate either way means there is no question to answer.
  if (lump <= 0 && stream <= 0) return null;
  if (!Number.isFinite(input.horizonYears) || input.horizonYears <= 0) {
    return null;
  }

  const advantage = (annualReturn: number) => {
    const c = compareSurplusAllocations({ ...input, annualReturn, splits: [0, 1] });
    return c.outcomes[1].netWorthAtHorizon - c.outcomes[0].netWorthAtHorizon;
  };

  // A loan with nothing left to prepay makes both paths identical, so there
  // is no crossing to find.
  if (advantage(0) <= 0) return null;
  // No sane return lets the market catch up; treat as out of range rather
  // than reporting a bogus edge value.
  if (advantage(MAX_SEARCH_RETURN) > 0) return null;

  let lo = 0;
  let hi = MAX_SEARCH_RETURN;
  // 50 halvings takes the bracket well below floating-point relevance.
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (advantage(mid) > 0) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
