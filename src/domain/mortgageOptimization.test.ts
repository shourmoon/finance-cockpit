// src/domain/mortgageOptimization.test.ts
import type { MortgageConfig } from "./types";
import { summarizeMortgageOptimization } from "./mortgageEngine";

describe("summarizeMortgageOptimization", () => {
  it("reports no savings when extra payment is zero", () => {
    const config: MortgageConfig = {
      principal: 300_000,
      annualRate: 0.05,
      termMonths: 360,
      startDate: "2025-01-01",
      monthlyPayment: 0, // will be computed
    };

    const result = summarizeMortgageOptimization(config, 0);

    expect(result.interestSaved).toBeCloseTo(0, 2);
    expect(result.monthsSaved).toBe(0);
    expect(result.newTermMonths).toBe(result.baselineTermMonths);
  });

  it("shows lower interest and shorter term with positive extra payment", () => {
    const config: MortgageConfig = {
      principal: 300_000,
      annualRate: 0.05,
      termMonths: 360,
      startDate: "2025-01-01",
      monthlyPayment: 0,
    };

    const result = summarizeMortgageOptimization(config, 200);

    // Sanity checks: new term & interest must be lower than baseline
    expect(result.newTermMonths).toBeLessThan(result.baselineTermMonths);
    expect(result.newTotalInterest).toBeLessThan(
      result.baselineTotalInterest
    );
    expect(result.interestSaved).toBeGreaterThan(0);
    expect(result.monthsSaved).toBeGreaterThan(0);
  });
});
