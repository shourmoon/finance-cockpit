// src/domain/mortgage/mortgageScenarios.test.ts
import { describe, it, expect } from "vitest";
import {
  runMortgageScenarios,
} from "./scenarios";

describe("mortgage scenarios engine", () => {
  const baseTerms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-01",
  } as const;

  const emptyPrepayments: { date: string; amount: number }[] = [];

  const baseContext = {
    terms: baseTerms,
    pastPrepayments: emptyPrepayments,
    asOfDate: "2027-01-01",
  };

  it("returns baseline and actual with no scenarios", () => {
    const result = runMortgageScenarios(baseContext, []);
    expect(result.baseline.totalInterest).toBeGreaterThan(0);
    expect(result.actual.totalInterest).toBeGreaterThan(0);
    // With no prepayments, actual path should match baseline closely.
    expect(result.actual.totalInterest).toBeCloseTo(
      result.baseline.totalInterest,
      5
    );
    expect(result.scenarios.length).toBe(0);
  });

  it("monthly extra prepayment improves outcome vs baseline and actual", () => {
    const scenarios = [
      {
        id: "s-monthly-200",
        name: "Extra 200 monthly",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "200 extra every month",
            kind: "monthly",
            amount: 200,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "same-as-due-date",
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    expect(result.scenarios.length).toBe(1);
    const s = result.scenarios[0];

    // Scenario must reduce total interest vs baseline.
    expect(s.totalInterest).toBeLessThan(result.baseline.totalInterest);
    // Scenario must be at least as good as continuing with no extra prepayments.
    expect(s.totalInterest).toBeLessThanOrEqual(result.actual.totalInterest);

    expect(s.monthsSavedVsBaseline).toBeGreaterThan(0);
    // It should not be worse than the actual no-future-extra path.
    expect(s.monthsSavedVsActual).toBeGreaterThanOrEqual(0);
  });

  it("one-time prepayment in the future has a positive benefit", () => {
    const oneTimeDate = "2028-01-01";
    const scenarios = [
      {
        id: "s-lump-10k",
        name: "One-time 10k",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "Lump 10k",
            kind: "oneTime",
            amount: 10_000,
            date: oneTimeDate,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.baseline.totalInterest);
    expect(s.totalInterest).toBeLessThanOrEqual(result.actual.totalInterest);
    expect(s.monthsSavedVsBaseline).toBeGreaterThan(0);
  });

  it("biweekly extra pattern improves outcome vs baseline", () => {
    const scenarios = [
      {
        id: "s-biweekly-100",
        name: "Biweekly 100",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "100 every 2 weeks",
            kind: "biweekly",
            amount: 100,
            anchorDate: "2025-01-01",
            startDate: baseContext.asOfDate,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.baseline.totalInterest);
    expect(s.monthsSavedVsBaseline).toBeGreaterThan(0);
  });

  it("yearly extra pattern improves outcome vs baseline", () => {
    const scenarios = [
      {
        id: "s-yearly-5k",
        name: "Every April 1st 5k",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "5k yearly",
            kind: "yearly",
            amount: 5_000,
            month: 4,
            day: 1,
            firstYear: 2027,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.baseline.totalInterest);
    expect(s.monthsSavedVsBaseline).toBeGreaterThan(0);
  });
});
