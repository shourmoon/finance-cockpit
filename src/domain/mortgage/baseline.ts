// src/domain/mortgage/baseline.ts
import type {
  MortgageOriginalTerms,
  AmortizationEntry,
  MortgageBaselineResult,
  Money,
  ISODate,
} from "./types";

/**
 * Compute the fixed contractual monthly payment for a standard amortizing loan.
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
  const month = Number(monthStr) - 1;
  const day = Number(dayStr);

  const d = new Date(Date.UTC(year, month, day));
  d.setUTCMonth(d.getUTCMonth() + offset);

  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).toString().padStart(2, "0");

  return `${y}-${m}-${dd}`;
}

/**
 * Build the baseline amortization schedule assuming no prepayments.
 */
export function computeBaselineMortgage(
  terms: MortgageOriginalTerms
): MortgageBaselineResult {
  const payment = computeMonthlyPayment(terms);
  const schedule: AmortizationEntry[] = [];

  let remaining = terms.principal;
  const r = terms.annualRate / 12;
  const epsilon = 1e-6;
  let payoffDate: ISODate = terms.startDate;

  for (let i = 0; i < terms.termMonths && remaining > epsilon; i++) {
    const date = addMonths(terms.startDate, i);
    const interest = r > 0 ? remaining * r : 0;
    const principal = payment - interest;
    remaining = Math.max(0, remaining - principal);

    schedule.push({
      date,
      payment,
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
