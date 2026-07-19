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

  it("handles a monthly nth-weekday pattern (e.g. first Monday)", () => {
    const scenarios = [
      {
        id: "s-nth-weekday",
        name: "First Monday 100",
        description: "",
        active: true,
        patterns: [
          {
            id: "p1",
            label: "100 on first Monday",
            kind: "monthly" as const,
            amount: 100,
            startDate: baseContext.asOfDate,
            dayOfMonthStrategy: "nth-weekday" as const,
            nthWeekday: 1,
            weekday: 1, // Monday
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
});

describe("mortgage scenarios - branch coverage", () => {
  const terms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-15",
  } as const;
  const ctx = { terms, pastPrepayments: [], asOfDate: "2027-01-15" };

  function scenarioWith(patterns: any[]) {
    return [
      { id: "s", name: "S", description: "", active: true, patterns },
    ];
  }

  it("skips inactive scenarios and scenarios without patterns", () => {
    const result = runMortgageScenarios(ctx, [
      { id: "off", name: "Off", description: "", active: false, patterns: [
        { id: "p", label: "x", kind: "oneTime" as const, amount: 1000, date: "2028-01-15" },
      ] },
      { id: "empty", name: "Empty", description: "", active: true, patterns: [] },
    ]);
    expect(result.scenarios).toHaveLength(0);
  });

  it("ignores patterns with non-positive amounts", () => {
    const result = runMortgageScenarios(
      ctx,
      scenarioWith([
        { id: "p", label: "zero", kind: "oneTime", amount: 0, date: "2028-01-15" },
      ])
    );
    expect(result.scenarios[0].totalInterest).toBeCloseTo(
      result.actual.totalInterest,
      5
    );
  });

  it("ignores one-time payments before as-of or after payoff", () => {
    const result = runMortgageScenarios(
      ctx,
      scenarioWith([
        { id: "p1", label: "past", kind: "oneTime", amount: 5000, date: "2026-01-15" },
        { id: "p2", label: "late", kind: "oneTime", amount: 5000, date: "2090-01-15" },
      ])
    );
    expect(result.scenarios[0].totalInterest).toBeCloseTo(
      result.actual.totalInterest,
      5
    );
  });

  it("monthly specific-day strategy applies on the requested day and falls back to due day", () => {
    const withDay = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "specific", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "specific-day", specificDayOfMonth: 5,
        },
      ])
    );
    const s = withDay.scenarios[0];
    expect(s.totalInterest).toBeLessThan(withDay.actual.totalInterest);
    expect(s.schedule.length).toBeGreaterThan(0);

    const fallback = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "fallback", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "specific-day",
        },
      ])
    );
    expect(fallback.scenarios[0].totalInterest).toBeLessThan(
      fallback.actual.totalInterest
    );
  });

  it("monthly nth-weekday strategy handles months without the nth occurrence and defaults", () => {
    const nth5 = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "5th monday", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "nth-weekday",
          nthWeekday: 5, weekday: 1,
        },
      ])
    );
    expect(nth5.scenarios[0].totalInterest).toBeLessThan(
      nth5.actual.totalInterest
    );

    // Omit nthWeekday/weekday to exercise the ?? defaults, including Sunday (7 % 7 = 0).
    const defaults = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "defaults", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "nth-weekday",
        },
      ])
    );
    expect(defaults.scenarios[0].totalInterest).toBeLessThan(
      defaults.actual.totalInterest
    );
  });

  it("monthly with an unrecognised strategy falls back to the due date", () => {
    const result = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "bogus", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "bogus",
        },
      ])
    );
    expect(result.scenarios[0].totalInterest).toBeLessThan(
      result.actual.totalInterest
    );
  });

  it("monthly untilDate stops the extra payments", () => {
    const bounded = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "bounded", kind: "monthly", amount: 200,
          startDate: "2027-01-15", untilDate: "2027-06-15",
          dayOfMonthStrategy: "same-as-due-date",
        },
      ])
    );
    const unbounded = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "unbounded", kind: "monthly", amount: 200,
          startDate: "2027-01-15", dayOfMonthStrategy: "same-as-due-date",
        },
      ])
    );
    expect(bounded.scenarios[0].totalInterest).toBeGreaterThan(
      unbounded.scenarios[0].totalInterest
    );
  });

  it("monthly startDate in the past clamps to as-of", () => {
    const result = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "past-start", kind: "monthly", amount: 200,
          startDate: "2020-01-15", dayOfMonthStrategy: "same-as-due-date",
        },
      ])
    );
    expect(result.scenarios[0].totalInterest).toBeLessThan(
      result.actual.totalInterest
    );
  });

  it("yearly pattern clamps invalid days, respects lastYear and defaults to payoff", () => {
    const feb = runMortgageScenarios(
      ctx,
      scenarioWith([
        { id: "p", label: "feb-31", kind: "yearly", amount: 3000, month: 2, day: 31, firstYear: 2020, lastYear: 2030 },
      ])
    );
    expect(feb.scenarios[0].totalInterest).toBeLessThan(feb.actual.totalInterest);

    const openEnded = runMortgageScenarios(
      ctx,
      scenarioWith([
        { id: "p", label: "open", kind: "yearly", amount: 3000, month: 4, day: 1, firstYear: 2027 },
      ])
    );
    expect(openEnded.scenarios[0].totalInterest).toBeLessThan(
      openEnded.actual.totalInterest
    );
  });

  it("biweekly pattern honours untilDate and future startDate bounds", () => {
    const bounded = runMortgageScenarios(
      ctx,
      scenarioWith([
        {
          id: "p", label: "biweekly", kind: "biweekly", amount: 150,
          anchorDate: "2027-01-01", startDate: "2028-01-01", untilDate: "2029-01-01",
        },
      ])
    );
    const unbounded = runMortgageScenarios(
      ctx,
      scenarioWith([
        { id: "p", label: "biweekly", kind: "biweekly", amount: 150, anchorDate: "2027-01-01" },
      ])
    );
    expect(bounded.scenarios[0].totalInterest).toBeGreaterThan(
      unbounded.scenarios[0].totalInterest
    );
    expect(unbounded.scenarios[0].totalInterest).toBeLessThan(
      unbounded.actual.totalInterest
    );
  });

  it("throws on an invalid biweekly anchor date", () => {
    expect(() =>
      runMortgageScenarios(
        ctx,
        scenarioWith([
          { id: "p", label: "bad", kind: "biweekly", amount: 150, anchorDate: "garbage" },
        ])
      )
    ).toThrow("Invalid ISO date");
  });

  it("handles an as-of date before the first payment", () => {
    const result = runMortgageScenarios(
      { terms, pastPrepayments: [], asOfDate: "2024-06-01" },
      []
    );
    expect(result.actualMonthsSoFar).toBe(0);
    expect(result.actualInterestSoFar).toBe(0);
    expect(result.effectiveAsOfDate).toBe(terms.startDate);
  });

  it("falls back to baseline payoff and null rate when nothing amortizes", () => {
    // A principal below the 1-cent simulation threshold produces an empty
    // combined schedule, exercising the fallback branches.
    const tinyTerms = { ...terms, principal: 0.005 };
    const result = runMortgageScenarios(
      { terms: tinyTerms, pastPrepayments: [], asOfDate: "2024-06-01" },
      scenarioWith([
        { id: "p", label: "x", kind: "oneTime", amount: 1000, date: "2026-01-15" },
      ])
    );
    expect(result.actual.schedule).toHaveLength(0);
    expect(result.actual.payoffDate).toBe(result.baseline.payoffDate);
    expect(result.scenarios[0].effectiveAnnualRate).toBeNull();
    expect(result.scenarios[0].payoffDate).toBe(result.baseline.payoffDate);
  });

  it("throws when the actual schedule is empty (unamortizable principal)", () => {
    const microTerms = { ...terms, principal: 1e-7 };
    expect(() =>
      runMortgageScenarios(
        { terms: microTerms, pastPrepayments: [], asOfDate: "2027-01-15" },
        []
      )
    ).toThrow("Schedule is empty");
  });
});

describe("mortgage scenarios - extra dates need not align to the due day", () => {
  // Regression: extras used to apply only when their date fell exactly on
  // the loan's monthly payment day. Now an extra applies on the first
  // payment date on or after its date (mirroring past-prepayment logic).
  const terms = {
    principal: 300_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2025-01-15", // due day = 15th
  } as const;
  const ctx = { terms, pastPrepayments: [], asOfDate: "2027-01-15" };
  const mk = (patterns: any[]) => [
    { id: "s", name: "S", description: "", active: true, patterns },
  ];

  it("yearly extra on the 1st (not the due day) now reduces interest", () => {
    const r = runMortgageScenarios(
      ctx,
      mk([
        { id: "p", label: "apr-1", kind: "yearly", amount: 5000, month: 4, day: 1, firstYear: 2027, lastYear: 2032 },
      ])
    );
    expect(r.scenarios[0].totalInterest).toBeLessThan(r.actual.totalInterest);
    expect(r.scenarios[0].monthsSavedVsActual).toBeGreaterThan(0);
  });

  it("a one-time extra on a non-due day still applies", () => {
    const r = runMortgageScenarios(
      ctx,
      mk([{ id: "p", label: "lump", kind: "oneTime", amount: 25_000, date: "2028-06-03" }])
    );
    expect(r.scenarios[0].totalInterest).toBeLessThan(r.actual.totalInterest);
  });

  it("runs scenarios on a zero-interest loan", () => {
    const terms0 = { principal: 120_000, annualRate: 0, termMonths: 120, startDate: "2025-01-15" };
    const ctx0 = { terms: terms0, pastPrepayments: [], asOfDate: "2027-01-15" };
    const r = runMortgageScenarios(
      ctx0,
      mk([{ id: "p", label: "lump", kind: "oneTime", amount: 12_000, date: "2028-01-15" }])
    );
    expect(r.baseline.totalInterest).toBeCloseTo(0, 6);
    expect(r.scenarios[0].schedule.length).toBeLessThan(r.actual.schedule.length);
  });

  it("skips yearly extras whose clamped date falls on or before as-of", () => {
    const ctxMid = { terms, pastPrepayments: [], asOfDate: "2027-06-15" };
    // firstYear 2027, month Jan -> 2027-01-15 is before as-of and is skipped;
    // 2028-01-15 onward applies.
    const r = runMortgageScenarios(
      ctxMid,
      mk([
        { id: "p", label: "jan", kind: "yearly", amount: 4000, month: 1, day: 15, firstYear: 2027, lastYear: 2030 },
      ])
    );
    expect(r.scenarios[0].totalInterest).toBeLessThan(r.actual.totalInterest);
  });
});
