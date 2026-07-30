// src/domain/surplusAllocation.ts
//
// "I have cash sitting in the high-yield account. How much of it is actually
// free, and where should it go — the market, or the mortgage?"
//
// This module answers the first half and sets the bar for the second.
// It deliberately does no projecting: turning an allocation into a payoff
// date and a portfolio value is portfolioProjection.ts's job.

import type { Money, RecurringRule } from "./types";

/** Six months of expenses is the conventional emergency-fund target. */
export const DEFAULT_RESERVE_MONTHS = 6;

/** How many times a year each schedule type fires. */
const OCCURRENCES_PER_YEAR: Record<RecurringRule["schedule"]["type"], number> = {
  monthly: 12,
  twiceMonth: 24,
  biweekly: 26,
};

/**
 * Average monthly outflow implied by the recurring rules.
 *
 * Inflows are excluded: the reserve exists to cover spending when income
 * stops, so counting income against it would defeat the purpose. Schedules
 * are normalised to a monthly rate — a biweekly bill fires 26 times a year,
 * not 24, and sizing a reserve off the un-normalised figure would understate
 * it by roughly 8%.
 */
export function deriveMonthlyExpenses(rules: RecurringRule[]): Money {
  let annual = 0;
  for (const r of rules) {
    if (!Number.isFinite(r.amount) || r.amount >= 0) continue;
    annual += Math.abs(r.amount) * OCCURRENCES_PER_YEAR[r.schedule.type];
  }
  return annual / 12;
}

/**
 * The reserve to hold back before any of the balance counts as surplus.
 * Returns 0 rather than a bad number for unusable inputs, and callers treat
 * 0 as "cannot size a reserve", never as "no reserve needed".
 */
export function computeReserveTarget(
  monthlyExpenses: Money,
  months: number = DEFAULT_RESERVE_MONTHS
): Money {
  if (!Number.isFinite(monthlyExpenses) || monthlyExpenses <= 0) return 0;
  if (!Number.isFinite(months) || months <= 0) return 0;
  return monthlyExpenses * months;
}

export interface SurplusInputs {
  /** Cash parked in the high-yield account. */
  parkedCash: Money;
  /** Average monthly outflow, normally from deriveMonthlyExpenses(). */
  monthlyExpenses: Money;
  /** Months of expenses to hold back. Defaults to six. */
  reserveMonths?: number;
  /** An explicit reserve amount, used in place of the months calculation. */
  reserveOverride?: Money;
}

export interface SurplusBreakdown {
  parkedCash: Money;
  monthlyExpenses: Money;
  reserveMonths: number;
  reserveTarget: Money;
  /** Cash above the reserve. Never negative. */
  surplus: Money;
  /** How far short of the reserve the balance is. Never negative. */
  reserveShortfall: Money;
}

/**
 * Split parked cash into "reserve" and "free to allocate".
 *
 * The asymmetry is deliberate: when the reserve is underfunded the surplus is
 * clamped to zero and the gap is reported instead. An under-reserved household
 * has nothing to allocate, and a card that suggested otherwise would be
 * recommending the single worst move available.
 */
export function computeSurplus(inputs: SurplusInputs): SurplusBreakdown {
  const parkedCash =
    Number.isFinite(inputs.parkedCash) && inputs.parkedCash > 0
      ? inputs.parkedCash
      : 0;
  const monthlyExpenses =
    Number.isFinite(inputs.monthlyExpenses) && inputs.monthlyExpenses > 0
      ? inputs.monthlyExpenses
      : 0;
  const reserveMonths =
    Number.isFinite(inputs.reserveMonths) && (inputs.reserveMonths as number) > 0
      ? (inputs.reserveMonths as number)
      : DEFAULT_RESERVE_MONTHS;

  // An override only counts when it is a usable amount. Anything else falls
  // back to the months calculation — never to "no reserve", which would show
  // the whole balance as investable.
  const hasOverride =
    inputs.reserveOverride !== undefined &&
    Number.isFinite(inputs.reserveOverride) &&
    (inputs.reserveOverride as number) >= 0;

  const reserveTarget = hasOverride
    ? (inputs.reserveOverride as number)
    : computeReserveTarget(monthlyExpenses, reserveMonths);

  return {
    parkedCash,
    monthlyExpenses,
    reserveMonths,
    reserveTarget,
    surplus: Math.max(0, parkedCash - reserveTarget),
    reserveShortfall: Math.max(0, reserveTarget - parkedCash),
  };
}

/**
 * The pre-tax annual return the market must average for investing to finish
 * ahead of prepaying the mortgage, over a holding period of `years`.
 *
 * Prepaying earns the mortgage rate `p`, guaranteed and untaxed, and that
 * saving compounds: a dollar of interest avoided this year is a dollar that
 * is not borrowed against next year either. So the prepay path ends at
 * (1 + p)^T per dollar.
 *
 * Investing earns `r` pre-tax, but tax is paid only when the position is
 * sold, so the whole gain compounds untaxed and is clipped once at the end:
 * 1 + ((1 + r)^T - 1)(1 - d). This deferral is the crux — taxing the return
 * every year instead (r(1 - d)) overstates the hurdle by roughly half a
 * point on a 20-year horizon, which is enough to flip the recommendation.
 *
 * Setting the two equal and solving for r:
 *
 *     r = [1 + ((1 + p)^T - 1) / (1 - d)]^(1/T) - 1
 *
 * IMPORTANT — what this does and does not answer. The derivation above stops
 * the clock when the loan does, so it implicitly assumes a dollar of avoided
 * interest compounds at the mortgage rate for the whole period. Real
 * households keep going after payoff, and the payment freed by prepaying then
 * compounds in the MARKET. That reinvestment window pushes the true
 * break-even BELOW this figure, and reverses how it moves with loan age:
 * within this formula the bar rises as the term shortens, but in the full
 * simulation it falls. Use solveBreakEvenReturn() in portfolioProjection.ts
 * for anything shown to a user; this function is the analytic reference the
 * simulation is checked against at a payoff-length horizon.
 *
 * Deliberately excluded: any deduction for mortgage interest. Standard
 * deduction is assumed, which makes the prepay side's return fully untaxed
 * and the estimate conservative — an itemising household's real hurdle is
 * slightly lower than this.
 *
 * @param mortgageRate  nominal annual mortgage rate, e.g. 0.0475
 * @param years         remaining holding period
 * @param capitalGainsRate  combined marginal rate on long-term gains
 */
export function computePrepaymentHurdleRate(
  mortgageRate: number,
  years: number,
  capitalGainsRate: number
): number {
  if (!Number.isFinite(years) || years <= 0) return mortgageRate;
  if (!Number.isFinite(capitalGainsRate) || capitalGainsRate <= 0) {
    return mortgageRate;
  }
  // A 100% (or higher) tax on gains makes investing unable to win at any
  // return. Infinity is the honest answer and renders as "never worth it".
  if (capitalGainsRate >= 1) return Number.POSITIVE_INFINITY;

  const prepayGrowth = Math.pow(1 + mortgageRate, years);
  const required = 1 + (prepayGrowth - 1) / (1 - capitalGainsRate);
  return Math.pow(required, 1 / years) - 1;
}
