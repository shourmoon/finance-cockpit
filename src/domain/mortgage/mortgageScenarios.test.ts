// src/domain/mortgage/mortgageScenarios.test.ts
import { describe, it, expect } from "vitest";
import { runMortgageScenarios } from "./scenarios";

describe("mortgage scenarios engine", () => {
  const baseTerms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-01",
  } as const;

  const emptyPrepayments: { date: string; amount: number; note?: string }[] = [];

  const baseContext = {
    terms: baseTerms,
    pastPrepayments: emptyPrepayments,
    asOfDate: "2027-01-01",
  };

  it("returns baseline and actual paths when there are no scenarios", () => {
    const result = runMortgageScenarios(baseContext, []);

    // With no past prepayments, actual should match baseline
    expect(result.scenarios.length).toBe(0);
    expect(result.actual.totalInterest).toBeCloseTo(
      result.baseline.totalInterest,
      5
    );
    expect(result.actual.payoffDate).toBe(result.baseline.payoffDate);
  });

  it("uses as-of date within the schedule range and computes interest-so-far", () => {
    const result = runMortgageScenarios(baseContext, []);
    // We at least expect some months and interest to have accrued.
    expect(result.actualMonthsSoFar).toBeGreaterThan(0);
    expect(result.actualInterestSoFar).toBeGreaterThan(0);
  });

  it("reduces interest and term with a simple monthly extra scenario", () => {
    const scenarios = [
      {
        id: "s-monthly-200",
        name: "Monthly extra 200",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "200 every month",
            kind: "monthly" as const,
            amount: 200,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "same-as-due-date" as const,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.actual.totalInterest);
    expect(s.monthsSavedVsActual).toBeGreaterThan(0);
    expect(s.interestSavedVsActual).toBeGreaterThan(0);
  });

  it("handles a one-time lump-sum payment scenario", () => {
    const scenarios = [
      {
        id: "s-onetime",
        name: "One-time 10k",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "10k lump sum",
            kind: "oneTime" as const,
            amount: 10_000,
            date: "2027-06-01",
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.actual.totalInterest);
    expect(s.monthsSavedVsActual).toBeGreaterThan(0);
  });

  it("handles a biweekly extra pattern aligned to an anchor date", () => {
    const scenarios = [
      {
        id: "s-biweekly",
        name: "Biweekly extra 50",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "50 every paycheque",
            kind: "biweekly" as const,
            amount: 50,
            anchorDate: "2025-01-15",
            startDate: baseContext.asOfDate,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeLessThan(result.actual.totalInterest);
    expect(s.monthsSavedVsActual).toBeGreaterThan(0);
  });

  it("handles a yearly lump-sum pattern", () => {
    const scenarios = [
      {
        id: "s-yearly",
        name: "Yearly bonus 5k",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "5k every April",
            kind: "yearly" as const,
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

    expect(s.totalInterest).toBeLessThan(result.actual.totalInterest);
    expect(s.monthsSavedVsBaseline).toBeGreaterThan(0);
  });

  it("ignores inactive scenarios", () => {
    const scenarios = [
      {
        id: "active-scenario",
        name: "Active extra",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "200 every month",
            kind: "monthly" as const,
            amount: 200,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "same-as-due-date" as const,
          },
        ],
      },
      {
        id: "inactive-scenario",
        name: "Should be ignored",
        description: "",
        active: false,
        patterns: [
          {
            id: "p2",
            label: "Also 200 every month",
            kind: "monthly" as const,
            amount: 200,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "same-as-due-date" as const,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);

    expect(result.scenarios.length).toBe(1);
    expect(result.scenarios[0].scenarioId).toBe("active-scenario");
  });

  it("treats zero-amount patterns effectively as no-ops", () => {
    const scenarios = [
      {
        id: "zero-monthly",
        name: "Zero monthly",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "0 every month",
            kind: "monthly" as const,
            amount: 0,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "same-as-due-date" as const,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(baseContext, scenarios);
    const s = result.scenarios[0];

    // No meaningful change expected vs actual
    expect(s.totalInterest).toBeCloseTo(result.actual.totalInterest, 5);
    expect(s.interestSavedVsActual).toBeCloseTo(0, 5);
    expect(s.monthsSavedVsActual).toBe(0);
  });

  it("gives no benefit if the first extra payment would start after payoff", () => {
    // Use a shorter term so payoff is relatively early
    const shortTerms = {
      principal: 50_000,
      annualRate: 0.05,
      termMonths: 60,
      startDate: "2025-01-01",
    } as const;

    const shortContext = {
      terms: shortTerms,
      pastPrepayments: emptyPrepayments,
      // As-of also early, but pattern start is far in the future.
      asOfDate: "2026-01-01",
    };

    const scenarios = [
      {
        id: "too-late",
        name: "Too-late extra",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "Extra 500 but starting very late",
            kind: "monthly" as const,
            amount: 500,
            startDate: "2040-01-01", // after loan is long gone
            dayOfMonthStrategy: "same-as-due-date" as const,
          },
        ],
      },
    ];

    const result = runMortgageScenarios(shortContext, scenarios);
    const s = result.scenarios[0];

    expect(s.totalInterest).toBeCloseTo(result.actual.totalInterest, 5);
    expect(s.interestSavedVsActual).toBeCloseTo(0, 5);
    expect(s.monthsSavedVsActual).toBe(0);
  });

  it("combining monthly and yearly patterns is at least as good as monthly-only", () => {
    const monthlyOnly = {
      id: "monthly-only",
      name: "200 monthly",
      description: "",
      active: true,
      patterns: [
        {
          id: "m1",
          label: "200 every month",
          kind: "monthly" as const,
          amount: 200,
          startDate: baseContext.asOfDate,
          dayOfMonthStrategy: "same-as-due-date" as const,
        },
      ],
    };

    const monthlyPlusYearly = {
      id: "monthly-yearly",
      name: "200 monthly + 2k yearly",
      description: "",
      active: true,
      patterns: [
        {
          id: "m1",
          label: "200 every month",
          kind: "monthly" as const,
          amount: 200,
          startDate: baseContext.asOfDate,
          dayOfMonthStrategy: "same-as-due-date" as const,
        },
        {
          id: "y1",
          label: "2k every April",
          kind: "yearly" as const,
          amount: 2_000,
          month: 4,
          day: 1,
          firstYear: 2027,
        },
      ],
    };

    const result = runMortgageScenarios(baseContext, [
      monthlyOnly,
      monthlyPlusYearly,
    ]);

    const m = result.scenarios.find((s) => s.scenarioId === "monthly-only")!;
    const my = result.scenarios.find(
      (s) => s.scenarioId === "monthly-yearly"
    )!;

    // Combined pattern should never be worse than monthly-only.
    expect(my.totalInterest).toBeLessThanOrEqual(m.totalInterest);
    expect(my.interestSavedVsBaseline).toBeGreaterThanOrEqual(
      m.interestSavedVsBaseline
    );
  });
});
