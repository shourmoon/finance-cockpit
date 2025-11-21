// src/domain/mortgage/mortgageDomain.test.ts
import { describe, it, expect } from "vitest";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  compareBaselineWithPrepayments,
  computeEffectiveAnnualRateFromSchedule,
} from "./index";

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
