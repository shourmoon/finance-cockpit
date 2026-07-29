// src/domain/mortgage/mortgageMath.test.ts
//
// Numerical correctness of the mortgage engine, as opposed to its
// behaviour. The other suites assert directional things ("prepaying
// reduces interest"); those stay green even if the arithmetic drifts. These
// pin the arithmetic itself, three ways:
//
//   1. against independently-derived formulas (a different algebraic form
//      of the annuity payment, and the analytic IRR of a level-payment loan),
//   2. against published reference values a mortgage calculator would give,
//   3. against invariants that must hold for every row of every schedule
//      (payment = interest + principal, interest = prior balance x rate,
//      principal sums to exactly the amount borrowed, balance reaches zero).
//
// The invariant checks run over several loans rather than one, so a
// regression has nowhere to hide.

import { describe, it, expect } from "vitest";
import {
  computeBaselineMortgage,
  computeMonthlyPayment,
  addMonths,
} from "./baseline";
import { computeMortgageWithPrepayments } from "./history";
import { computeEffectiveAnnualRateFromSchedule } from "./irr";
import { compareBaselineWithPrepayments } from "./comparison";
import { runMortgageScenarios } from "./scenarios";
import type { AmortizationEntry, MortgageOriginalTerms } from "./types";

/** A spread of loans: conventional, jumbo, short-term, and high-rate. */
const LOANS: MortgageOriginalTerms[] = [
  { principal: 300_000, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" },
  { principal: 680_000, annualRate: 0.0475, termMonths: 360, startDate: "2023-06-01" },
  { principal: 250_000, annualRate: 0.065, termMonths: 180, startDate: "2024-03-15" },
  { principal: 95_000, annualRate: 0.0325, termMonths: 120, startDate: "2022-11-01" },
];

/**
 * Assert the invariants that must hold for any amortization schedule,
 * whatever produced it.
 */
function expectScheduleIsSound(
  schedule: AmortizationEntry[],
  terms: MortgageOriginalTerms
) {
  const r = terms.annualRate / 12;
  let prevRemaining = terms.principal;
  let principalSum = 0;
  let paidSum = 0;

  for (const e of schedule) {
    // The row's own numbers agree with each other.
    expect(e.payment).toBeCloseTo(e.interest + e.principal, 6);
    // Interest is charged on the balance carried into the period.
    expect(e.interest).toBeCloseTo(prevRemaining * r, 6);
    // Nothing is negative, and the balance never grows.
    expect(e.interest).toBeGreaterThanOrEqual(0);
    expect(e.principal).toBeGreaterThanOrEqual(0);
    expect(e.remaining).toBeLessThanOrEqual(prevRemaining + 1e-9);
    expect(e.remaining).toBeGreaterThanOrEqual(0);

    principalSum += e.principal;
    paidSum += e.payment;
    prevRemaining = e.remaining;
  }

  // The loan is actually repaid, and repaid exactly once.
  expect(schedule.at(-1)!.remaining).toBeCloseTo(0, 6);
  expect(principalSum).toBeCloseTo(terms.principal, 4);
  // Interest is the whole of what was paid beyond the amount borrowed.
  const totalInterest = schedule.reduce((s, e) => s + e.interest, 0);
  expect(totalInterest).toBeCloseTo(paidSum - terms.principal, 4);
}

describe("monthly payment formula", () => {
  it.each(LOANS)("matches an independently-derived form for $principal", (terms) => {
    const r = terms.annualRate / 12;
    // computeMonthlyPayment uses P*r*(1+r)^n / ((1+r)^n - 1). This is the
    // algebraically equivalent discount form — same answer by a different
    // route, so a typo in either would show up here.
    const independent =
      (terms.principal * r) / (1 - Math.pow(1 + r, -terms.termMonths));
    expect(computeMonthlyPayment(terms)).toBeCloseTo(independent, 8);
  });

  it("reproduces published reference figures", () => {
    // $300k at 5% over 30 years is a standard worked example: $1,610.46.
    expect(
      computeMonthlyPayment({
        principal: 300_000,
        annualRate: 0.05,
        termMonths: 360,
        startDate: "2025-01-01",
      })
    ).toBeCloseTo(1610.46, 2);

    // $250k at 6.5% over 15 years: $2,177.77.
    expect(
      computeMonthlyPayment({
        principal: 250_000,
        annualRate: 0.065,
        termMonths: 180,
        startDate: "2025-01-01",
      })
    ).toBeCloseTo(2177.77, 2);
  });

  it("is exactly principal / term when there is no interest", () => {
    expect(
      computeMonthlyPayment({
        principal: 12_000,
        annualRate: 0,
        termMonths: 12,
        startDate: "2025-01-01",
      })
    ).toBe(1000);
  });

  it("scales linearly with principal at a fixed rate and term", () => {
    const base = { annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" };
    const one = computeMonthlyPayment({ ...base, principal: 100_000 });
    const three = computeMonthlyPayment({ ...base, principal: 300_000 });
    expect(three).toBeCloseTo(one * 3, 6);
  });
});

describe("baseline schedule arithmetic", () => {
  it.each(LOANS)("satisfies every amortization invariant for $principal", (terms) => {
    const { schedule } = computeBaselineMortgage(terms);
    expect(schedule).toHaveLength(terms.termMonths);
    expectScheduleIsSound(schedule, terms);
  });

  it.each(LOANS)("pays a level payment throughout for $principal", (terms) => {
    const { schedule } = computeBaselineMortgage(terms);
    const first = schedule[0].payment;
    for (const e of schedule) expect(e.payment).toBeCloseTo(first, 6);
  });

  it("shifts from interest toward principal over the life of the loan", () => {
    const { schedule } = computeBaselineMortgage(LOANS[1]);
    const first = schedule[0];
    const last = schedule.at(-1)!;
    expect(first.interest).toBeGreaterThan(first.principal);
    expect(last.principal).toBeGreaterThan(last.interest);
  });

  it("reports payoffDate as the final scheduled payment", () => {
    for (const terms of LOANS) {
      const b = computeBaselineMortgage(terms);
      expect(b.payoffDate).toBe(b.schedule.at(-1)!.date);
    }
  });
});

describe("effective annual rate", () => {
  // For a level-payment loan with no prepayments the cashflow IRR is exactly
  // the nominal monthly rate, so the effective annual rate is analytic. This
  // is the sharpest available check on the solver.
  it.each(LOANS)("equals (1 + r/12)^12 - 1 for $principal", (terms) => {
    const { schedule } = computeBaselineMortgage(terms);
    const eff = computeEffectiveAnnualRateFromSchedule(schedule, terms.principal);
    const analytic = Math.pow(1 + terms.annualRate / 12, 12) - 1;
    expect(eff).toBeCloseTo(analytic, 7);
  });

  it("exceeds the nominal APR, because interest compounds monthly", () => {
    const terms = LOANS[0]; // 5.00% nominal
    const { schedule } = computeBaselineMortgage(terms);
    const eff = computeEffectiveAnnualRateFromSchedule(schedule, terms.principal);
    expect(eff).toBeGreaterThan(terms.annualRate);
    expect(eff).toBeCloseTo(0.0511619, 6);
  });
});

describe("schedules including prepayments", () => {
  const terms = LOANS[1];
  const prepayments = [
    { date: "2026-08-01", amount: 25_000 },
    { date: "2028-02-01", amount: 15_000 },
  ];

  it("keeps every amortization invariant", () => {
    const { schedule } = computeMortgageWithPrepayments(terms, prepayments);
    expectScheduleIsSound(schedule, terms);
  });

  it("still repays exactly the amount borrowed, just sooner", () => {
    const { schedule } = computeMortgageWithPrepayments(terms, prepayments);
    const principalSum = schedule.reduce((s, e) => s + e.principal, 0);
    expect(principalSum).toBeCloseTo(terms.principal, 4);
    expect(schedule.length).toBeLessThan(terms.termMonths);
  });

  it("charges interest only on what is still owed after each prepayment", () => {
    const { schedule } = computeMortgageWithPrepayments(terms, prepayments);
    const i = schedule.findIndex((e) => e.date === "2026-08-01");
    expect(i).toBeGreaterThan(0);
    // The month after a $25k prepayment charges interest on the reduced balance.
    const next = schedule[i + 1];
    expect(next.interest).toBeCloseTo(
      schedule[i].remaining * (terms.annualRate / 12),
      6
    );
  });

  it("reconciles savings against the baseline exactly", () => {
    const baseline = computeBaselineMortgage(terms);
    const actual = computeMortgageWithPrepayments(terms, prepayments);
    const cmp = compareBaselineWithPrepayments(terms, prepayments);
    expect(cmp.interestSaved).toBeCloseTo(
      baseline.totalInterest - actual.totalInterest,
      6
    );
    expect(cmp.monthsSaved).toBe(
      baseline.schedule.length - actual.schedule.length
    );
    expect(cmp.interestSaved).toBeGreaterThan(0);
  });

  it("applies prepayments in date order regardless of input order", () => {
    const forwards = computeMortgageWithPrepayments(terms, prepayments);
    const backwards = computeMortgageWithPrepayments(terms, [...prepayments].reverse());
    expect(backwards.totalInterest).toBeCloseTo(forwards.totalInterest, 6);
    expect(backwards.schedule.length).toBe(forwards.schedule.length);
  });

  it("treats one large prepayment as at least as good as the same sum split later", () => {
    const lump = computeMortgageWithPrepayments(terms, [
      { date: "2026-08-01", amount: 40_000 },
    ]);
    const split = computeMortgageWithPrepayments(terms, [
      { date: "2026-08-01", amount: 25_000 },
      { date: "2028-02-01", amount: 15_000 },
    ]);
    // Paying the same money sooner cannot cost more interest.
    expect(lump.totalInterest).toBeLessThanOrEqual(split.totalInterest + 1e-6);
  });
});

describe("scenario engine schedule integrity", () => {
  const terms = LOANS[1];

  function monthsBetween(a: string, b: string): number {
    const [ay, am] = a.split("-").map(Number);
    const [by, bm] = b.split("-").map(Number);
    return (by - ay) * 12 + (bm - am);
  }

  it("splices past and simulated future into one continuous monthly series", () => {
    const res = runMortgageScenarios(
      { terms, pastPrepayments: [], asOfDate: "2026-07-01" },
      [
        {
          id: "s",
          name: "S",
          description: "",
          active: true,
          patterns: [
            { id: "p", label: "lump", kind: "oneTime", amount: 25_000, date: "2026-09-15" },
          ],
        },
      ]
    );
    const schedule = res.scenarios[0].schedule;

    for (let i = 1; i < schedule.length; i++) {
      // No duplicated, missing, or out-of-order months across the seam.
      expect(monthsBetween(schedule[i - 1].date, schedule[i].date)).toBe(1);
      // The balance falls by exactly the principal applied that month.
      expect(schedule[i - 1].remaining - schedule[i].remaining).toBeCloseTo(
        schedule[i].principal,
        5
      );
    }
    expect(schedule.at(-1)!.remaining).toBeCloseTo(0, 1);
  });

  it("matches the plain baseline when no scenario and no prepayments exist", () => {
    const res = runMortgageScenarios(
      { terms, pastPrepayments: [], asOfDate: "2026-07-01" },
      []
    );
    const baseline = computeBaselineMortgage(terms);
    expect(res.actual.schedule).toHaveLength(baseline.schedule.length);
    expect(res.actual.totalInterest).toBeCloseTo(baseline.totalInterest, 2);
    expect(res.actual.payoffDate).toBe(baseline.payoffDate);
  });

  it("reports interest-so-far consistent with the spliced schedule", () => {
    const res = runMortgageScenarios(
      { terms, pastPrepayments: [], asOfDate: "2026-07-01" },
      []
    );
    const upToAsOf = res.actual.schedule.filter((e) => e.date <= "2026-07-01");
    expect(res.actualMonthsSoFar).toBe(upToAsOf.length);
    expect(res.actualInterestSoFar).toBeCloseTo(
      upToAsOf.reduce((s, e) => s + e.interest, 0),
      4
    );
  });
});

describe("addMonths calendar arithmetic", () => {
  it("clamps a month-end start to the last valid day of each target month", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonths("2025-01-31", 3)).toBe("2025-04-30");
    expect(addMonths("2025-08-31", 1)).toBe("2025-09-30");
  });

  it("rolls across year boundaries in both directions", () => {
    expect(addMonths("2025-12-15", 1)).toBe("2026-01-15");
    expect(addMonths("2025-01-15", -1)).toBe("2024-12-15");
    expect(addMonths("2025-03-15", -3)).toBe("2024-12-15");
    expect(addMonths("2025-06-10", 24)).toBe("2027-06-10");
  });

  it("advances exactly one calendar month per step over a full loan term", () => {
    let prev = "2023-06-30";
    for (let i = 1; i <= 360; i++) {
      const next = addMonths("2023-06-30", i);
      const [py, pm] = prev.split("-").map(Number);
      const [ny, nm] = next.split("-").map(Number);
      expect((ny - py) * 12 + (nm - pm)).toBe(1);
      prev = next;
    }
  });

  it("only ever emits real calendar days", () => {
    // Month arithmetic and day clamping are separate steps, so a broken
    // clamp can still produce correctly-spaced months while emitting an
    // impossible date like 2024-02-30 — which then compares as a string
    // against schedule dates and silently misorders them.
    for (const start of ["2023-01-31", "2023-03-30", "2024-01-29", "2023-08-31"]) {
      for (let i = 0; i <= 360; i++) {
        const iso = addMonths(start, i);
        const [y, m, d] = iso.split("-").map(Number);
        const roundTrip = new Date(Date.UTC(y, m - 1, d));
        expect(roundTrip.getUTCFullYear()).toBe(y);
        expect(roundTrip.getUTCMonth()).toBe(m - 1);
        expect(roundTrip.getUTCDate()).toBe(d);
      }
    }
  });
});
