// src/domain/mortgage/mortgageDomain.test.ts
import { describe, it, expect } from "vitest";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
  compareBaselineWithPrepayments,
} from "./index";

describe("mortgage domain baseline and prepayments", () => {
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
});
