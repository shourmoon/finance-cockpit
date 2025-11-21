// src/domain/mortgage/scenarios.ts
import type {
  MortgageOriginalTerms,
  PastPrepaymentLog,
  MortgageBaselineResult,
  MortgageHistoryResult,
  AmortizationEntry,
  Money,
  ISODate,
} from "./types";
import {
  computeBaselineMortgage,
  computeMonthlyPayment,
  addMonths,
} from "./baseline";
import { computeMortgageWithPrepayments } from "./history";
import { computeEffectiveAnnualRateFromSchedule } from "./irr";

/**
 * Scenario engine for forward-looking mortgage optimisation.
 *
 * It takes:
 *  - Original mortgage terms
 *  - Past prepayments (historical extra principal you've already made)
 *  - An "as-of" date (usually a recent payment date)
 *  - One or more scenarios describing future extra prepayments
 *
 * and returns:
 *  - Baseline path (no prepayments at all)
 *  - Actual path (including past prepayments, no future extras)
 *  - Scenario paths (past actual + future extras)
 *  - Interest / months saved vs both baseline and actual
 */

// ---------- Scenario types ----------

export type ScenarioId = string;

export type ScenarioPatternKind = "oneTime" | "monthly" | "yearly" | "biweekly";

export interface BaseScenarioPattern {
  id: string;
  label: string;
  kind: ScenarioPatternKind;
  amount: Money;
}

/**
 * A single one-time extra payment on a given date.
 */
export interface OneTimeScenarioPattern extends BaseScenarioPattern {
  kind: "oneTime";
  date: ISODate; // when the lump-sum prepayment happens
}

/**
 * Monthly extra prepayment pattern.
 *
 * You can either:
 *  - apply on the same day-of-month as the contractual due date, or
 *  - choose a specific day-of-month (1–28) independent of the due date.
 */
export interface MonthlyScenarioPattern extends BaseScenarioPattern {
  kind: "monthly";
  startDate: ISODate; // first month to apply
  untilDate?: ISODate; // last month (inclusive), optional
  dayOfMonthStrategy: "same-as-due-date" | "specific-day";
  specificDayOfMonth?: number; // 1–28 when using "specific-day"
}

/**
 * Yearly extra prepayment pattern.
 *
 * For example: $5k every April 1st from 2027 to 2032.
 */
export interface YearlyScenarioPattern extends BaseScenarioPattern {
  kind: "yearly";
  month: number;       // 1–12
  day: number;         // 1–31 (clamped by calendar)
  firstYear: number;   // e.g. 2027
  lastYear?: number;   // optional; if omitted, apply until payoff
}

/**
 * Biweekly extra prepayment pattern aligned to some anchor date
 * (often a paycheck cycle).
 *
 * Implementation detail: we expand it to concrete dates by stepping
 * 14 days at a time from the anchor.
 */
export interface BiweeklyScenarioPattern extends BaseScenarioPattern {
  kind: "biweekly";
  anchorDate: ISODate; // defines the 14-day cadence
  startDate?: ISODate; // first date where this is allowed to apply
  untilDate?: ISODate; // last date (inclusive) where this may apply
}

export type ScenarioPattern =
  | OneTimeScenarioPattern
  | MonthlyScenarioPattern
  | YearlyScenarioPattern
  | BiweeklyScenarioPattern;

export interface MortgageScenarioConfig {
  id: ScenarioId;
  name: string;
  description?: string;
  active: boolean;
  patterns: ScenarioPattern[];
}

/**
 * Inputs needed to run scenarios.
 */
export interface MortgageScenarioContext {
  terms: MortgageOriginalTerms;
  pastPrepayments: PastPrepaymentLog;
  /**
   * As-of date, typically a recent payment date.
   * We treat everything before this date as "actual history"
   * and everything after as "future" for simulation.
   */
  asOfDate: ISODate;
}

/**
 * Summary of a scenario path.
 *
 * We combine:
 *  - the actual schedule up to as-of
 *  - plus simulated future schedule with extra prepayments
 */
export interface MortgageScenarioSummary {
  scenarioId: ScenarioId;
  scenarioName: string;

  // Full schedule including past + future under this scenario
  schedule: AmortizationEntry[];

  totalInterest: Money;
  payoffDate: ISODate;
  effectiveAnnualRate: number | null;

  interestSavedVsBaseline: Money;
  monthsSavedVsBaseline: number;

  interestSavedVsActual: Money;
  monthsSavedVsActual: number;
}

export interface MortgageScenarioRunResult {
  asOfDate: ISODate;
  effectiveAsOfDate: ISODate; // if we snap to nearest schedule date
  baseline: MortgageBaselineResult;
  actual: MortgageHistoryResult;
  actualInterestSoFar: Money;
  actualMonthsSoFar: number;
  scenarios: MortgageScenarioSummary[];
}

// ---------- Date helpers ----------

function parseIsoToDate(iso: ISODate): Date {
  const [yearStr, monthStr, dayStr] = iso.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error(`Invalid ISO date: ${iso}`);
  }
  // Use UTC to avoid timezone drift
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateToIso(d: Date): ISODate {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Compare ISO dates lexicographically (YYYY-MM-DD).
 */
function compareIsoDates(a: ISODate, b: ISODate): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Clamp a day-of-month to the last valid day in that month/year.
 * For example: (2025, 2, 31) -> 2025-02-28 or 29 (depending on leap year).
 */
function clampDay(year: number, month: number, day: number): ISODate {
  const base = new Date(Date.UTC(year, month - 1, day));
  // If the requested day overflows the month, JS will roll to the next month.
  // We want the last day of the target month instead.
  if (base.getUTCMonth() !== month - 1) {
    // Overflowed; move back to last day of previous month.
    const lastDay = new Date(Date.UTC(year, month, 0)); // day=0 => last day of previous month
    return formatDateToIso(lastDay);
  }
  return formatDateToIso(base);
}

/**
 * Filter schedule entries up to and including a given as-of date.
 * Returns the slice and the index of the last included entry.
 */
function sliceScheduleUpTo(
  schedule: AmortizationEntry[],
  asOfDate: ISODate
): { slice: AmortizationEntry[]; lastIndex: number; effectiveAsOf: ISODate } {
  if (schedule.length === 0) {
    throw new Error("Schedule is empty");
  }

  let lastIndex = -1;
  for (let i = 0; i < schedule.length; i++) {
    const e = schedule[i];
    if (compareIsoDates(e.date, asOfDate) <= 0) {
      lastIndex = i;
    } else {
      break;
    }
  }

  if (lastIndex === -1) {
    // As-of is before the first scheduled payment: treat first entry as the pivot.
    return { slice: [], lastIndex: -1, effectiveAsOf: schedule[0].date };
  }

  const slice = schedule.slice(0, lastIndex + 1);
  const effectiveAsOf = schedule[lastIndex].date;
  return { slice, lastIndex, effectiveAsOf };
}

// ---------- Pattern expansion ----------

/**
 * Build a map of extra principal amounts keyed by ISO date.
 * Only includes dates strictly *after* the as-of date.
 */
function buildExtraByDateMap(
  baseline: MortgageBaselineResult,
  context: MortgageScenarioContext,
  patterns: ScenarioPattern[]
): Map<ISODate, Money> {
  const extraByDate = new Map<ISODate, Money>();
  const { asOfDate, terms } = context;
  const baselineSchedule = baseline.schedule;
  const payoffDate = baseline.payoffDate;

  const dueDay = Number(terms.startDate.split("-")[2]);

  function addExtra(date: ISODate, amount: Money) {
    if (amount <= 0) return;
    if (compareIsoDates(date, asOfDate) <= 0) return;
    if (compareIsoDates(date, payoffDate) > 0) return;
    const current = extraByDate.get(date) ?? 0;
    extraByDate.set(date, current + amount);
  }

  for (const pattern of patterns) {
    if (pattern.amount <= 0) continue;

    switch (pattern.kind) {
      case "oneTime": {
        const p = pattern as OneTimeScenarioPattern;
        addExtra(p.date, p.amount);
        break;
      }

      case "monthly": {
        const p = pattern as MonthlyScenarioPattern;
        const start = p.startDate && compareIsoDates(p.startDate, asOfDate) > 0
          ? p.startDate
          : asOfDate;

        // Use baseline dates to know which months exist.
        for (const entry of baselineSchedule) {
          if (compareIsoDates(entry.date, start) <= 0) continue;
          if (compareIsoDates(entry.date, payoffDate) > 0) break;

          let targetDate: ISODate;
          if (p.dayOfMonthStrategy === "same-as-due-date") {
            targetDate = entry.date;
          } else {
            const [yStr, mStr] = entry.date.split("-");
            const y = Number(yStr);
            const m = Number(mStr);
            const day = p.specificDayOfMonth ?? dueDay;
            targetDate = clampDay(y, m, day);
          }

          if (p.untilDate && compareIsoDates(targetDate, p.untilDate) > 0) {
            continue;
          }

          addExtra(targetDate, p.amount);
        }
        break;
      }

      case "yearly": {
        const p = pattern as YearlyScenarioPattern;
        const [startYearStr] = asOfDate.split("-");
        const asOfYear = Number(startYearStr);
        const firstYear = Math.max(p.firstYear, asOfYear);
        const lastYear = p.lastYear ?? Number(payoffDate.split("-")[0]) + 1;

        for (let year = firstYear; year <= lastYear; year++) {
          const date = clampDay(year, p.month, p.day);
          if (compareIsoDates(date, asOfDate) <= 0) continue;
          if (compareIsoDates(date, payoffDate) > 0) break;
          addExtra(date, p.amount);
        }
        break;
      }

      case "biweekly": {
        const p = pattern as BiweeklyScenarioPattern;
        // Start stepping from anchorDate; apply only within [startDate, untilDate, payoffDate].
        const anchor = parseIsoToDate(p.anchorDate);
        const limit = parseIsoToDate(
          p.untilDate && compareIsoDates(p.untilDate, payoffDate) < 0
            ? p.untilDate
            : payoffDate
        );
        const startBoundary =
          p.startDate && compareIsoDates(p.startDate, asOfDate) > 0
            ? parseIsoToDate(p.startDate)
            : parseIsoToDate(asOfDate);

        let current = new Date(anchor.getTime());
        while (current <= limit) {
          const iso = formatDateToIso(current);
          if (current >= startBoundary && compareIsoDates(iso, asOfDate) > 0) {
            addExtra(iso, p.amount);
          }
          // Step 14 days.
          current = new Date(current.getTime() + 14 * 24 * 60 * 60 * 1000);
        }
        break;
      }
    }
  }

  return extraByDate;
}

// ---------- Future simulation from as-of ----------

interface FutureSimulationResult {
  futureSchedule: AmortizationEntry[];
  totalInterestFuture: Money;
}

/**
 * Continue the mortgage from a given as-of point with:
 *  - remaining principal at as-of
 *  - original annualRate
 *  - original contractual monthly payment
 *  - optional extra principal map keyed by date
 *
 * We treat the first future payment date as addMonths(effectiveAsOf, 1).
 */
function simulateFutureFromAsOf(
  terms: MortgageOriginalTerms,
  remainingAtAsOf: Money,
  effectiveAsOf: ISODate,
  extraByDate: Map<ISODate, Money>
): FutureSimulationResult {
  const monthlyPayment = computeMonthlyPayment(terms);
  const futureSchedule: AmortizationEntry[] = [];

  let remaining = remainingAtAsOf;
  const r = terms.annualRate / 12;
  let totalInterestFuture = 0;
  let step = 1;

  // Safety cap: don't simulate more than original term + 600 months.
  const maxSteps = terms.termMonths + 600;

  while (remaining > 0.01 && step <= maxSteps) {
    const date = addMonths(effectiveAsOf, step);
    const interest = r > 0 ? remaining * r : 0;
    let principal = monthlyPayment - interest;
    if (principal <= 0) {
      throw new Error("Monthly payment is too small to amortize the loan.");
    }

    const extra = extraByDate.get(date) ?? 0;
    let totalPrincipal = principal + extra;

    if (totalPrincipal > remaining) {
      totalPrincipal = remaining;
    }

    const payment = interest + totalPrincipal;
    remaining = Math.max(0, remaining - totalPrincipal);
    totalInterestFuture += interest;

    futureSchedule.push({
      date,
      payment,
      interest,
      principal: totalPrincipal,
      remaining,
    });

    if (remaining <= 0.01) {
      break;
    }

    step++;
  }

  if (step > maxSteps && remaining > 0.01) {
    throw new Error("Future simulation did not converge.");
  }

  return {
    futureSchedule,
    totalInterestFuture,
  };
}

// ---------- Public API ----------

export function runMortgageScenarios(
  context: MortgageScenarioContext,
  scenarioConfigs: MortgageScenarioConfig[]
): MortgageScenarioRunResult {
  const { terms, pastPrepayments, asOfDate } = context;

  // 1) Baseline: no prepayments at all.
  const baseline: MortgageBaselineResult = computeBaselineMortgage(terms);

  // 2) Actual: include past prepayments (log), no future extras.
  const actual: MortgageHistoryResult = computeMortgageWithPrepayments(
    terms,
    pastPrepayments
  );

  // 3) Slice the actual schedule up to as-of.
  const { slice: pastSchedule, lastIndex, effectiveAsOf } = sliceScheduleUpTo(
    actual.schedule,
    asOfDate
  );

  let remainingAtAsOf: Money;
  let interestSoFar = 0;
  let monthsSoFar = 0;

  if (lastIndex === -1) {
    // As-of before first payment: nothing has happened yet.
    remainingAtAsOf = terms.principal;
    interestSoFar = 0;
    monthsSoFar = 0;
  } else {
    const lastEntry = pastSchedule[pastSchedule.length - 1];
    remainingAtAsOf = lastEntry.remaining;
    interestSoFar = pastSchedule.reduce((sum, e) => sum + e.interest, 0);
    monthsSoFar = pastSchedule.length;
  }

  // 4) Actual with no future extras: future simulation with no extra map.
  const actualFuture = simulateFutureFromAsOf(
    terms,
    remainingAtAsOf,
    effectiveAsOf,
    new Map()
  );
  const actualFullSchedule: AmortizationEntry[] = [
    ...pastSchedule,
    ...actualFuture.futureSchedule,
  ];
  const actualTotalInterest =
    interestSoFar + actualFuture.totalInterestFuture;

  const actualPayoffDate =
    actualFullSchedule.length > 0
      ? actualFullSchedule[actualFullSchedule.length - 1].date
      : baseline.payoffDate;

  const actualEffectiveRate =
    actualFullSchedule.length > 0
      ? computeEffectiveAnnualRateFromSchedule(
          actualFullSchedule,
          terms.principal
        )
      : null;

  // 5) Baseline totals for comparison.
  const baselineTotalInterest = baseline.totalInterest;
  const baselineMonths = baseline.schedule.length;

  // 6) Scenarios.
  const scenarioSummaries: MortgageScenarioSummary[] = [];

  for (const config of scenarioConfigs) {
    if (!config.active) continue;
    if (!config.patterns || config.patterns.length === 0) continue;

    const extraByDate = buildExtraByDateMap(baseline, context, config.patterns);

    const future = simulateFutureFromAsOf(
      terms,
      remainingAtAsOf,
      effectiveAsOf,
      extraByDate
    );

    const scenarioSchedule: AmortizationEntry[] = [
      ...pastSchedule,
      ...future.futureSchedule,
    ];
    const scenarioTotalInterest =
      interestSoFar + future.totalInterestFuture;

    const payoffDate =
      scenarioSchedule.length > 0
        ? scenarioSchedule[scenarioSchedule.length - 1].date
        : baseline.payoffDate;

    const effectiveRate =
      scenarioSchedule.length > 0
        ? computeEffectiveAnnualRateFromSchedule(
            scenarioSchedule,
            terms.principal
          )
        : null;

    const scenarioMonths = scenarioSchedule.length;

    const interestSavedVsBaseline =
      baselineTotalInterest - scenarioTotalInterest;
    const monthsSavedVsBaseline = baselineMonths - scenarioMonths;

    const interestSavedVsActual =
      actualTotalInterest - scenarioTotalInterest;
    const monthsSavedVsActual =
      actualFullSchedule.length - scenarioMonths;

    scenarioSummaries.push({
      scenarioId: config.id,
      scenarioName: config.name,
      schedule: scenarioSchedule,
      totalInterest: scenarioTotalInterest,
      payoffDate,
      effectiveAnnualRate: effectiveRate,
      interestSavedVsBaseline,
      monthsSavedVsBaseline,
      interestSavedVsActual,
      monthsSavedVsActual,
    });
  }

  return {
    asOfDate,
    effectiveAsOfDate: effectiveAsOf,
    baseline,
    actual: {
      schedule: actualFullSchedule,
      totalInterest: actualTotalInterest,
      payoffDate: actualPayoffDate,
    },
    actualInterestSoFar: interestSoFar,
    actualMonthsSoFar: monthsSoFar,
    scenarios: scenarioSummaries,
  };
}
