// src/domain/mortgage/baseline.ts
import type {
  MortgageOriginalTerms,
  AmortizationEntry,
  MortgageBaselineResult,
  Money,
  ISODate,
  PaymentFrequency,
} from "./types";

/**
 * Interest accrues at annualRate / periodsPerYear. For monthly that is
 * exactly the r/12 this module has always used, so existing loans are
 * unaffected; for biweekly it is r/26.
 *
 * Servicers more often accrue daily (actual/365), which over a 30-year loan
 * paid biweekly works out roughly $3,000 cheaper and four weeks sooner than
 * r/26 on a $680k balance. The periodic convention is kept because it leaves
 * monthly results bit-identical and errs slightly against the borrower.
 */
export function periodsPerYear(frequency?: PaymentFrequency): number {
  return frequency === "biweekly" ? 26 : 12;
}

/**
 * Convert a count of payment periods into calendar months.
 *
 * Schedule lengths are counts of *periods*, but every "time saved" figure the
 * UI shows is phrased in years and months. On a monthly loan the two coincide;
 * on a biweekly one a period is 14 days, so an unconverted count overstates
 * the saving by 26/12 — a year of shaved term would read as "2 yrs 2 mos".
 * Monthly stays exact identity (x 12/12), so no existing number moves.
 */
export function periodsToMonths(
  periods: number,
  frequency?: PaymentFrequency
): number {
  return periods * (12 / periodsPerYear(frequency));
}

/** Advance a date by whole payment periods. */
export function addPeriods(
  base: ISODate,
  count: number,
  frequency?: PaymentFrequency
): ISODate {
  if (frequency === "biweekly") return addDays(base, count * 14);
  return addMonths(base, count);
}

export function addDays(base: ISODate, days: number): ISODate {
  const [y, m, d] = base.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Compute the fixed contractual monthly payment for a standard amortizing loan.
 * This is the contractual figure regardless of how often it is actually paid.
 */
export function computeMonthlyPayment(terms: MortgageOriginalTerms): Money {
  const { principal, annualRate, termMonths } = terms;

  if (principal <= 0) {
    throw new Error("principal must be positive");
  }
  if (termMonths <= 0) {
    throw new Error("termMonths must be positive");
  }

  const monthlyRate = annualRate / 12;

  if (monthlyRate === 0) {
    // No interest: simple division.
    return principal / termMonths;
  }

  const r = monthlyRate;
  const n = termMonths;
  const numerator = principal * r * Math.pow(1 + r, n);
  const denominator = Math.pow(1 + r, n) - 1;

  return numerator / denominator;
}

export function addMonths(base: ISODate, offset: number): ISODate {
  const [yearStr, monthStr, dayStr] = base.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr) - 1; // 0-indexed
  const day = Number(dayStr);

  // Compute the target year/month with integer arithmetic rather than
  // Date.setUTCMonth, which silently rolls an out-of-range day into a
  // later month (Jan 31 + 1 month would become Mar 3, not Feb 28).
  const totalMonths = year * 12 + month + offset;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths - targetYear * 12; // 0-indexed

  // Clamp the day to the last valid day of the target month instead.
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfTargetMonth);

  const m = String(targetMonth + 1).padStart(2, "0");
  const dd = String(clampedDay).padStart(2, "0");

  return `${targetYear}-${m}-${dd}`;
}

/**
 * What is actually handed over each payment period: the full monthly amount,
 * or half of it every fortnight. Paying half every 14 days means 26 payments
 * a year rather than 24, i.e. one extra monthly payment annually.
 */
export function computePeriodPayment(terms: MortgageOriginalTerms): Money {
  const monthly = computeMonthlyPayment(terms);
  return terms.paymentFrequency === "biweekly" ? monthly / 2 : monthly;
}

/**
 * How many periods to simulate before giving up. Monthly loans are capped at
 * the contractual term. Biweekly loans always finish sooner than the same
 * number of years' worth of periods, so that bound is safe there too.
 */
function maxPeriods(terms: MortgageOriginalTerms): number {
  const perYear = periodsPerYear(terms.paymentFrequency);
  return Math.ceil((terms.termMonths / 12) * perYear);
}

/**
 * Build the baseline amortization schedule assuming no prepayments.
 *
 * With biweekly payments the schedule length is an OUTPUT rather than
 * termMonths: the loan simply runs until the balance clears, which happens
 * years before the contractual term.
 */
export function computeBaselineMortgage(
  terms: MortgageOriginalTerms
): MortgageBaselineResult {
  const payment = computePeriodPayment(terms);
  const schedule: AmortizationEntry[] = [];

  let remaining = terms.principal;
  const r = terms.annualRate / periodsPerYear(terms.paymentFrequency);
  const epsilon = 1e-6;
  const limit = maxPeriods(terms);
  let payoffDate: ISODate = terms.startDate;

  for (let i = 0; i < limit && remaining > epsilon; i++) {
    const date = addPeriods(terms.startDate, i, terms.paymentFrequency);
    const interest = r > 0 ? remaining * r : 0;
    // The final period only collects what is still owed.
    const principal = Math.min(payment - interest, remaining);
    remaining = Math.max(0, remaining - principal);

    schedule.push({
      date,
      payment: interest + principal,
      interest,
      principal,
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
