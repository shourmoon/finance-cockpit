// src/domain/contributionPlan.ts
//
// What the household is considering committing from today onward, and the
// dated amounts that follow from it.
//
// Both destinations consume this one expansion — the mortgage applies the
// entries as extra principal, the market invests the same entries on the same
// days. Keeping a single source for that schedule is what makes the head-to-
// head honest: two arms funded from separately-built schedules could drift
// apart, and then no amount of care elsewhere would save the comparison.

import type { Money, ISODate } from "./types";
import { isValidISODate } from "./dateUtils";
import { addMonths } from "./mortgage/baseline";

export interface ContributionPlan {
  /** The date the plan starts — "now". */
  asOfDate: ISODate;
  /** A single amount committed at asOfDate. */
  lumpSum: Money;
  /** An amount every month from asOfDate. */
  monthly: Money;
  /** An amount once a year, e.g. a bonus. */
  yearly: Money;
  /**
   * Calendar month (1-12) the yearly amount lands in. Defaults to the
   * as-of month when absent or unusable.
   */
  yearlyMonth?: number;
  /**
   * Both recurring streams stop after this date; the lump is unaffected
   * because it is committed immediately. Absent means "keep going until the
   * loan is retired" — the amortizer ignores entries past payoff, so the
   * streams simply run out of anything to pay.
   *
   * One shared end date rather than one per stream: it represents how long
   * the household can keep this up, which is a single fact about them, and
   * it keeps the card to one input instead of two.
   */
  until?: ISODate;
}

export interface DatedContribution {
  date: ISODate;
  amount: Money;
}

/** Only positive, finite amounts represent a real commitment. */
function usable(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

/**
 * Expand a plan into dated amounts over the next `months` months.
 *
 * Entries falling after the loan is retired are harmless — the amortizer
 * stops applying them once the balance is clear — so callers pass a generous
 * horizon rather than having to know the payoff date in advance.
 */
export function expandContributionPlan(
  plan: ContributionPlan,
  months: number
): DatedContribution[] {
  const horizon = Number.isFinite(months) && months > 0 ? Math.floor(months) : 0;
  // An unusable end date must not silently cancel the plan, so it is treated
  // as absent rather than as "stop immediately".
  const until = isValidISODate(plan.until) ? (plan.until as ISODate) : undefined;

  const byDate = new Map<ISODate, number>();
  const add = (date: ISODate, amount: Money) => {
    byDate.set(date, (byDate.get(date) ?? 0) + amount);
  };

  const lumpSum = usable(plan.lumpSum);
  if (lumpSum > 0) add(plan.asOfDate, lumpSum);

  const monthly = usable(plan.monthly);
  const yearly = usable(plan.yearly);

  if (monthly > 0 || yearly > 0) {
    const asOfMonth = Number(plan.asOfDate.slice(5, 7));
    const rawMonth = plan.yearlyMonth;
    const yearlyMonth =
      typeof rawMonth === "number" &&
      Number.isInteger(rawMonth) &&
      rawMonth >= 1 &&
      rawMonth <= 12
        ? rawMonth
        : asOfMonth;

    for (let i = 0; i < horizon; i++) {
      const date = addMonths(plan.asOfDate, i);
      if (until && date > until) break;

      if (monthly > 0) add(date, monthly);
      if (yearly > 0 && Number(date.slice(5, 7)) === yearlyMonth) {
        add(date, yearly);
      }
    }
  }

  return [...byDate.entries()]
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
