// src/domain/mortgage/mortgageDomain.test.ts
import { describe, it, expect } from "vitest";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  compareBaselineWithPrepayments,
  computeEffectiveAnnualRateFromSchedule,
} from "./index";
import { computeMonthlyPayment, addMonths } from "./baseline";

describe("mortgage domain baseline, prepayments, and effective rate", () => {
  const terms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-01",
  };

  it("computes a reasonable baseline mortgage path", () => {
    const baseline = computeBaselineMortgage(terms);

    expect(baseline.schedule.length).toBeGreaterThan(300);
    expect(baseline.schedule.length).toBeLessThanOrEqual(360);
    expect(baseline.totalInterest).toBeGreaterThan(0);
  });

  it("reduces interest and term when prepayments are applied", () => {
    const prepayments = [
      { date: "2026-01-01", amount: 5_000 },
      { date: "2027-01-01", amount: 5_000 },
    ];

    const withPrepay = computeMortgageWithPrepayments(terms, prepayments);
    const baseline = computeBaselineMortgage(terms);

    expect(withPrepay.totalInterest).toBeLessThan(baseline.totalInterest);
    expect(withPrepay.schedule.length).toBeLessThanOrEqual(baseline.schedule.length);

    const comparison = compareBaselineWithPrepayments(terms, prepayments);

    expect(comparison.interestSaved).toBeGreaterThan(0);
    expect(comparison.monthsSaved).toBeGreaterThanOrEqual(0);
  });

  it("computes effective annual rate close to nominal for baseline", () => {
    const baseline = computeBaselineMortgage(terms);
    const eff = computeEffectiveAnnualRateFromSchedule(
      baseline.schedule,
      terms.principal
    );

    // For a standard fixed-rate mortgage, the cashflow IRR should be close
    // to the contractual nominal APR (allowing for numerical tolerance).
    expect(eff).toBeGreaterThan(0.04);
    expect(eff).toBeLessThan(0.06);
  });

  it("computes a valid effective annual rate when prepayments are applied", () => {
    const prepayments = [
      { date: "2026-01-01", amount: 10_000 },
      { date: "2027-01-01", amount: 10_000 },
    ];

    const withPrepay = computeMortgageWithPrepayments(terms, prepayments);
    const effWithPrepay = computeEffectiveAnnualRateFromSchedule(
      withPrepay.schedule,
      terms.principal
    );

    // We don't assert direction here because cash-flow IRR is sensitive to
    // perspective and timing conventions; we only require that it is a
    // reasonable, finite annual rate.
    expect(Number.isFinite(effWithPrepay)).toBe(true);
    expect(effWithPrepay).toBeGreaterThan(0);
    expect(effWithPrepay).toBeLessThan(0.2);
  });
});

describe("addMonths (day-of-month clamping)", () => {
  it("clamps to the last day of the target month instead of overflowing into the next", () => {
    // Jan 31 + 1 month must land on Feb 28 (2025 is not a leap year),
    // not roll forward into March.
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2025-01-31", 2)).toBe("2025-03-31");
  });

  it("clamps to Feb 29 on a leap year", () => {
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29");
  });

  it("produces exactly one date per month for a day-31 start, with no repeats or gaps", () => {
    const dates = Array.from({ length: 12 }, (_, i) => addMonths("2025-01-31", i));
    const months = dates.map((d) => d.slice(0, 7));
    expect(new Set(months).size).toBe(12);
    expect(months).toEqual([
      "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06",
      "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12",
    ]);
  });

  it("leaves an offset of 0 unchanged", () => {
    expect(addMonths("2025-01-31", 0)).toBe("2025-01-31");
  });

  it("is unaffected for start dates that never overflow", () => {
    expect(addMonths("2025-01-15", 1)).toBe("2025-02-15");
    expect(addMonths("2025-01-15", 13)).toBe("2026-02-15");
  });
});

describe("computeMonthlyPayment / baseline edge cases", () => {
  it("throws on a non-positive principal", () => {
    expect(() =>
      computeMonthlyPayment({ principal: 0, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" })
    ).toThrow("principal must be positive");
  });

  it("throws on a non-positive term", () => {
    expect(() =>
      computeMonthlyPayment({ principal: 1000, annualRate: 0.05, termMonths: 0, startDate: "2025-01-01" })
    ).toThrow("termMonths must be positive");
  });

  it("handles a zero-interest loan as simple division", () => {
    const terms0 = { principal: 12_000, annualRate: 0, termMonths: 12, startDate: "2025-01-01" };
    expect(computeMonthlyPayment(terms0)).toBeCloseTo(1000, 6);

    const baseline = computeBaselineMortgage(terms0);
    expect(baseline.totalInterest).toBeCloseTo(0, 6);
    expect(baseline.schedule).toHaveLength(12);
    expect(baseline.schedule[11].remaining).toBeCloseTo(0, 6);
  });

  it("applies prepayments on a zero-interest loan", () => {
    const terms0 = { principal: 12_000, annualRate: 0, termMonths: 12, startDate: "2025-01-01" };
    const withPrepay = computeMortgageWithPrepayments(terms0, [
      { date: "2025-03-01", amount: 3_000 },
    ]);
    expect(withPrepay.totalInterest).toBeCloseTo(0, 6);
    expect(withPrepay.schedule.length).toBeLessThan(12);
  });

  it("clamps the recorded payment to what was actually needed when a prepayment overshoots the remaining balance", () => {
    const smallTerms = {
      principal: 10_000,
      annualRate: 0.06,
      termMonths: 12,
      startDate: "2025-01-01",
    };
    // Sized far beyond what's owed by the second payment.
    const withPrepay = computeMortgageWithPrepayments(smallTerms, [
      { date: "2025-02-01", amount: 50_000 },
    ]);
    const last = withPrepay.schedule[withPrepay.schedule.length - 1];

    expect(last.remaining).toBe(0);
    // The accounting identity must hold: payment is what was actually paid.
    expect(last.payment).toBeCloseTo(last.interest + last.principal, 6);
    // principal reflects the actual amount applied (the whole remaining
    // balance), not the un-clamped extra.
    expect(last.principal).toBeLessThan(10_000);
    expect(last.principal).toBeGreaterThan(9_000);
    // Not the full requested $50k extra plus the contractual payment.
    expect(last.payment).toBeLessThan(10_000);
  });
});

describe("computeEffectiveAnnualRateFromSchedule edge cases", () => {
  it("throws on an empty schedule", () => {
    expect(() => computeEffectiveAnnualRateFromSchedule([], 1000)).toThrow(
      "Schedule is empty"
    );
  });

  it("throws on a non-positive principal", () => {
    const sched = [{ date: "2025-02-01", payment: 100, interest: 0, principal: 100, remaining: 0 }];
    expect(() => computeEffectiveAnnualRateFromSchedule(sched, 0)).toThrow(
      "principal must be positive"
    );
  });

  it("returns 0 when NPV does not change sign over the search range", () => {
    // Payments far smaller than principal => NPV positive across [0, hi],
    // so the IRR is not well-defined and the function returns 0.
    const sched = [
      { date: "2025-02-01", payment: 1, interest: 0, principal: 1, remaining: 0 },
    ];
    expect(computeEffectiveAnnualRateFromSchedule(sched, 1_000_000)).toBe(0);
  });
});
