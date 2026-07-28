// src/domain/resilience.ts
//
// Coverage metrics: how often one salary covered the household unaided.
//
// Every applied top-up is a recorded event ({ kind: "topUp", reason }), and
// these functions roll them into monthly buckets and the six metrics the
// dashboard card shows. Two lenses:
//   - "all"       counts every top-up (the default; a one-off is still a
//                 real draw on savings)
//   - "recurring" counts only reason === "shortfall", isolating months the
//                 income genuinely did not cover from months that merely
//                 absorbed a shock
//
// Months are calendar months. The current month is always excluded — it is
// still in progress and would drag every average down. Months before
// `trackingSince` are *unknown* rather than clean: the app wasn't recording
// then, and absence of data is not evidence of coverage.

import type { AdhocTransaction, CoverageLens, ISODate, Money } from "./types";
import { isValidISODate } from "./dateUtils";
import { monthKey } from "../utils/dates";

export interface MonthBucket {
  /** "YYYY-MM". */
  monthKey: string;
  /** Top-ups tagged as one-off shocks. */
  oneOff: Money;
  /** Top-ups tagged as recurring shortfalls. */
  shortfall: Money;
  /** Total counted under the active lens. */
  total: Money;
  /** False for months before tracking began — unknown, not clean. */
  known: boolean;
}

export interface CoverageMetrics {
  /** Complete months in the window, oldest first. */
  months: MonthBucket[];
  /** Months we actually have data for (excludes pre-tracking months). */
  knownMonths: number;
  /** Known months that needed no top-up at all. */
  cleanMonths: number;
  /** Sum of counted top-ups across the window. */
  totalToppedUp: Money;
  /** totalToppedUp spread across known months (0 when nothing is known). */
  averageMonthlyGap: Money;
  /** Median top-up among months that needed one; null when none did. */
  typicalTopUp: Money | null;
  /** Clean months trailing from the most recent complete month. */
  streakCurrent: number;
  /** Longest clean run anywhere in the window. */
  streakBest: number;
  /** Percent of the second salary that stayed in savings; null when unset. */
  secondSalaryKept: number | null;
  /**
   * The current, in-progress month — live so a top-up entered today is
   * visible immediately, but excluded from every rate above (streaks,
   * averages, knownMonths) since the month isn't over yet.
   */
  currentMonth: MonthBucket;
}

export interface CoverageOptions {
  lens: CoverageLens;
  /** Today. The month containing this date is excluded as incomplete. */
  asOf: ISODate;
  /** When top-up tracking began. Omitted means every month counts as known. */
  trackingSince?: ISODate;
  /** How many complete months to look back over. Default 12. */
  windowMonths?: number;
  /** Net monthly income of the second earner; omitted hides that metric. */
  secondSalaryMonthly?: Money;
}

/** Shift a "YYYY-MM" key by a number of months (negative shifts back). */
function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  // Convert to a zero-based absolute month index, shift, convert back.
  const abs = y * 12 + (m - 1) + delta;
  const year = Math.floor(abs / 12);
  const month = abs - year * 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Roll recorded top-ups into monthly buckets and the six coverage metrics.
 * Pure: same inputs always give the same result, no clock access.
 */
export function computeCoverageMetrics(
  transactions: readonly AdhocTransaction[],
  options: CoverageOptions
): CoverageMetrics {
  const { lens, asOf, trackingSince, secondSalaryMonthly } = options;
  const windowMonths = options.windowMonths ?? 12;

  // The window ends at the last *complete* month before asOf.
  const lastComplete = shiftMonth(monthKey(asOf), -1);
  const firstMonth = shiftMonth(lastComplete, -(windowMonths - 1));
  const trackingMonth =
    trackingSince && isValidISODate(trackingSince) ? monthKey(trackingSince) : null;

  const emptyBucket = (key: string): MonthBucket => ({
    monthKey: key,
    oneOff: 0,
    shortfall: 0,
    total: 0,
    // No tracking date means we have no reason to distrust any month.
    known: trackingMonth === null || key >= trackingMonth,
  });

  const buckets = new Map<string, MonthBucket>();
  for (let i = 0; i < windowMonths; i++) {
    const key = shiftMonth(firstMonth, i);
    buckets.set(key, emptyBucket(key));
  }
  const currentMonthKey = monthKey(asOf);
  const currentMonth = emptyBucket(currentMonthKey);

  for (const txn of transactions) {
    // Only explicitly-marked top-ups count. `name` is user-editable, so it
    // is never used to identify one.
    if (txn.kind !== "topUp") continue;
    if (!isValidISODate(txn.date)) continue;
    if (!(txn.amount > 0)) continue; // a zero or negative "top-up" isn't one

    const txnMonth = monthKey(txn.date);
    const bucket = txnMonth === currentMonthKey ? currentMonth : buckets.get(txnMonth);
    if (!bucket || !bucket.known) continue;

    // Reason defaults to one-off, matching the Apply flow's default.
    if (txn.reason === "shortfall") bucket.shortfall += txn.amount;
    else bucket.oneOff += txn.amount;
  }

  const months = [...buckets.values()];
  for (const b of [...months, currentMonth]) {
    b.total = lens === "recurring" ? b.shortfall : b.oneOff + b.shortfall;
  }

  const known = months.filter((b) => b.known);
  const knownMonths = known.length;
  const cleanMonths = known.filter((b) => b.total === 0).length;
  const totalToppedUp = known.reduce((sum, b) => sum + b.total, 0);
  const assisted = known.filter((b) => b.total > 0).map((b) => b.total);

  // Streaks run over known months only — an unknown month breaks a run
  // rather than silently extending it.
  let run = 0;
  let streakBest = 0;
  for (const b of months) {
    if (b.known && b.total === 0) {
      run += 1;
      streakBest = Math.max(streakBest, run);
    } else {
      run = 0;
    }
  }
  let streakCurrent = 0;
  for (let i = months.length - 1; i >= 0; i--) {
    const b = months[i];
    if (!b.known || b.total !== 0) break;
    streakCurrent += 1;
  }

  const secondSalaryKept =
    secondSalaryMonthly !== undefined && secondSalaryMonthly > 0 && knownMonths > 0
      ? ((secondSalaryMonthly * knownMonths - totalToppedUp) /
          (secondSalaryMonthly * knownMonths)) *
        100
      : null;

  return {
    months,
    knownMonths,
    cleanMonths,
    totalToppedUp,
    averageMonthlyGap: knownMonths > 0 ? totalToppedUp / knownMonths : 0,
    typicalTopUp: assisted.length > 0 ? median(assisted) : null,
    streakCurrent,
    streakBest,
    secondSalaryKept,
    currentMonth,
  };
}
