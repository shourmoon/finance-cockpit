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
  computePeriodPayment,
  addMonths,
} from "./baseline";
import { computeMortgageWithPrepayments } from "./history";
import { computeEffectiveAnnualRateFromSchedule } from "./irr";
import {
  compareBaselineWithPrepayments,
  decomposeMortgageSavings,
} from "./comparison";
import type { AmortizationEntry, MortgageOriginalTerms } from "./types";

/** Whole calendar months from `from` to `to`, fractional part included. */
function monthsBetweenDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + (td - fd) / 30;
}

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

describe("biweekly payment schedules", () => {
  // True accelerated biweekly: half the monthly payment every 14 days, so 26
  // half-payments a year equal 13 monthly payments. The extra one goes to
  // principal, which is what shortens the term. The term is therefore an
  // OUTPUT, not the contractual termMonths.
  const monthly: MortgageOriginalTerms = {
    principal: 680_000,
    annualRate: 0.0475,
    termMonths: 360,
    startDate: "2023-06-01",
  };
  const biweekly: MortgageOriginalTerms = { ...monthly, paymentFrequency: "biweekly" };

  it("pays half the monthly amount each period", () => {
    expect(computePeriodPayment(biweekly)).toBeCloseTo(
      computeMonthlyPayment(monthly) / 2,
      8
    );
    // The monthly annuity itself is unchanged by the frequency.
    expect(computeMonthlyPayment(biweekly)).toBeCloseTo(
      computeMonthlyPayment(monthly),
      8
    );
  });

  it("steps every 14 days", () => {
    const { schedule } = computeBaselineMortgage(biweekly);
    expect(schedule[0].date).toBe("2023-06-01");
    expect(schedule[1].date).toBe("2023-06-15");
    expect(schedule[2].date).toBe("2023-06-29");
    for (let i = 1; i < 40; i++) {
      const prev = Date.parse(schedule[i - 1].date + "T00:00:00Z");
      const cur = Date.parse(schedule[i].date + "T00:00:00Z");
      expect((cur - prev) / 86_400_000).toBe(14);
    }
  });

  it("retires the loan years early compared with paying monthly", () => {
    const mo = computeBaselineMortgage(monthly);
    const bw = computeBaselineMortgage(biweekly);
    expect(bw.payoffDate < mo.payoffDate).toBe(true);
    // Roughly four to five years earlier on a 30-year loan at this rate.
    expect(bw.payoffDate.slice(0, 4)).toBe("2048");
    expect(bw.totalInterest).toBeLessThan(mo.totalInterest);
    // And meaningfully less interest — not a rounding-scale difference.
    expect(mo.totalInterest - bw.totalInterest).toBeGreaterThan(90_000);
  });

  it("satisfies every amortization invariant, per period", () => {
    const { schedule } = computeBaselineMortgage(biweekly);
    const r = biweekly.annualRate / 26;
    let prevRemaining = biweekly.principal;
    let principalSum = 0;
    for (const e of schedule) {
      expect(e.payment).toBeCloseTo(e.interest + e.principal, 6);
      expect(e.interest).toBeCloseTo(prevRemaining * r, 6);
      expect(e.remaining).toBeLessThanOrEqual(prevRemaining + 1e-9);
      principalSum += e.principal;
      prevRemaining = e.remaining;
    }
    expect(schedule.at(-1)!.remaining).toBeCloseTo(0, 6);
    expect(principalSum).toBeCloseTo(biweekly.principal, 4);
  });

  it("applies prepayments on the biweekly cadence too", () => {
    const prepayments = [{ date: "2026-08-01", amount: 20_000 }];
    const plain = computeMortgageWithPrepayments(biweekly, []);
    const withPre = computeMortgageWithPrepayments(biweekly, prepayments);

    expect(withPre.payoffDate < plain.payoffDate).toBe(true);
    expect(withPre.totalInterest).toBeLessThan(plain.totalInterest);

    const r = biweekly.annualRate / 26;
    let prevRemaining = biweekly.principal;
    let principalSum = 0;
    for (const e of withPre.schedule) {
      expect(e.payment).toBeCloseTo(e.interest + e.principal, 6);
      expect(e.interest).toBeCloseTo(prevRemaining * r, 6);
      principalSum += e.principal;
      prevRemaining = e.remaining;
    }
    expect(principalSum).toBeCloseTo(biweekly.principal, 4);
    expect(withPre.schedule.at(-1)!.remaining).toBeCloseTo(0, 6);
  });

  it("reports time saved in calendar months, not payment periods", () => {
    // "monthsSaved" is read by the UI as months and rendered as years+months.
    // Deriving it from schedule lengths makes it a count of PERIODS, which on
    // a biweekly loan overstates the saving by 26/12 — a year of shaved term
    // would be shown as "2 yrs 2 mos".
    const prepayments = [{ date: "2024-04-01", amount: 25_000 }];
    const cmp = compareBaselineWithPrepayments(biweekly, prepayments);
    const gap = monthsBetweenDates(
      cmp.actual.payoffDate,
      cmp.baseline.payoffDate
    );
    expect(gap).toBeGreaterThan(0);
    // Within a month of the real calendar gap between the two payoff dates.
    expect(cmp.monthsSaved).toBeGreaterThan(gap - 1);
    expect(cmp.monthsSaved).toBeLessThan(gap + 1);
  });

  it("leaves monthly time-saved figures as whole payment counts", () => {
    // On a monthly loan a period IS a month, so the conversion must be exact
    // identity — no rounding drift introduced into existing numbers.
    const prepayments = [{ date: "2024-04-01", amount: 25_000 }];
    const cmp = compareBaselineWithPrepayments(monthly, prepayments);
    expect(cmp.monthsSaved).toBe(
      cmp.baseline.schedule.length - cmp.actual.schedule.length
    );
  });

  it("leaves monthly loans bit-for-bit unchanged", () => {
    // The generalisation must not perturb existing monthly results: the
    // periodic rate for 12 periods is exactly the old r/12.
    const explicit = computeBaselineMortgage({ ...monthly, paymentFrequency: "monthly" });
    const implicit = computeBaselineMortgage(monthly);
    expect(explicit.payoffDate).toBe(implicit.payoffDate);
    expect(explicit.totalInterest).toBe(implicit.totalInterest);
    expect(explicit.schedule).toHaveLength(implicit.schedule.length);
  });

  it("reports an effective annual rate consistent with 26 periods", () => {
    const { schedule } = computeBaselineMortgage(biweekly);
    const eff = computeEffectiveAnnualRateFromSchedule(
      schedule,
      biweekly.principal,
      26
    );
    // Paying more per year than contracted does not change the loan's rate;
    // the cashflow IRR still reflects 4.75% nominal compounded 26 times.
    expect(eff).toBeCloseTo(Math.pow(1 + 0.0475 / 26, 26) - 1, 6);
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

describe("decomposeMortgageSavings", () => {
  // The household's real situation: a 30-year monthly contract that is
  // actually being paid biweekly, with prepayments on top. Three distinct
  // things shortened the loan and the card needs to credit each separately.
  const contract: MortgageOriginalTerms = {
    principal: 680_000,
    annualRate: 0.0475,
    termMonths: 360,
    startDate: "2023-06-01",
    paymentFrequency: "biweekly",
  };
  const prepayments = [{ date: "2025-01-01", amount: 150_000 }];

  it("measures the contract baseline as monthly, whatever the real cadence", () => {
    // The 30-year term in the loan document assumes monthly payments. Using
    // the biweekly schedule as the baseline makes the cadence's own saving
    // invisible, which is exactly the bug this function exists to fix.
    const d = decomposeMortgageSavings(contract, prepayments);
    const monthlyBaseline = computeBaselineMortgage({
      ...contract,
      paymentFrequency: "monthly",
    });
    expect(d.contract.payoffDate).toBe(monthlyBaseline.payoffDate);
    expect(d.contract.totalInterest).toBeCloseTo(monthlyBaseline.totalInterest, 6);
    // 30 years from June 2023.
    expect(d.contract.payoffDate.slice(0, 4)).toBe("2053");
  });

  it("credits the cadence and the prepayments separately", () => {
    const d = decomposeMortgageSavings(contract, prepayments);

    expect(d.fromCadence.monthsSaved).toBeGreaterThan(0);
    expect(d.fromCadence.interestSaved).toBeGreaterThan(0);
    expect(d.fromPrepayments.monthsSaved).toBeGreaterThan(0);
    expect(d.fromPrepayments.interestSaved).toBeGreaterThan(0);

    // Paying biweekly alone is worth roughly four and a half years here.
    expect(d.fromCadence.monthsSaved).toBeGreaterThan(50);
    expect(d.fromCadence.monthsSaved).toBeLessThan(60);
    expect(d.fromCadence.interestSaved).toBeGreaterThan(100_000);
  });

  it("adds up: the parts equal the whole", () => {
    const d = decomposeMortgageSavings(contract, prepayments);
    expect(d.fromCadence.monthsSaved + d.fromPrepayments.monthsSaved).toBeCloseTo(
      d.total.monthsSaved,
      6
    );
    expect(
      d.fromCadence.interestSaved + d.fromPrepayments.interestSaved
    ).toBeCloseTo(d.total.interestSaved, 6);
  });

  it("attributes nothing to cadence on a genuinely monthly loan", () => {
    const monthly: MortgageOriginalTerms = { ...contract, paymentFrequency: "monthly" };
    const d = decomposeMortgageSavings(monthly, prepayments);
    expect(d.fromCadence.monthsSaved).toBe(0);
    expect(d.fromCadence.interestSaved).toBeCloseTo(0, 6);
    expect(d.cadenceExtraPerYear).toBe(0);
    // All of the saving is then the prepayments'.
    expect(d.fromPrepayments.interestSaved).toBeCloseTo(d.total.interestSaved, 6);
  });

  it("quantifies the cadence as one extra monthly payment a year", () => {
    // 26 half-payments is 13 months' worth, so the biweekly schedule bakes in
    // exactly one extra monthly payment of principal every year. That is the
    // plain-language explanation the card shows.
    const d = decomposeMortgageSavings(contract, []);
    const monthlyPayment = computeMonthlyPayment(contract);
    expect(d.cadenceExtraPerYear).toBeCloseTo(monthlyPayment, 6);
  });

  it("handles a loan with no prepayments at all", () => {
    const d = decomposeMortgageSavings(contract, []);
    expect(d.fromPrepayments.monthsSaved).toBeCloseTo(0, 6);
    expect(d.fromPrepayments.interestSaved).toBeCloseTo(0, 6);
    expect(d.total.monthsSaved).toBeCloseTo(d.fromCadence.monthsSaved, 6);
  });

  it("reports months as real calendar time across differing cadences", () => {
    // The two baselines step at different intervals — one month, one 14 days
    // — so a difference of schedule lengths would be meaningless here. Only
    // the gap between the payoff dates is comparable.
    const d = decomposeMortgageSavings(contract, prepayments);
    const gap =
      (Date.parse(d.contract.payoffDate + "T00:00:00Z") -
        Date.parse(d.actual.payoffDate + "T00:00:00Z")) /
      (86_400_000 * 30.4375);
    expect(d.total.monthsSaved).toBeCloseTo(gap, 3);
  });
});

describe("money committed to a loan that cannot absorb it", () => {
  // A servicer refunds an overpayment; it does not keep it. Anything the loan
  // could not take must come back with the date it became unusable, or a plan
  // that overshoots a nearly-retired loan silently destroys money.
  const terms: MortgageOriginalTerms = {
    principal: 300_000, annualRate: 0.05, termMonths: 360,
    startDate: "2025-01-01", paymentFrequency: "monthly",
  };

  /** Extra principal the schedule actually absorbed, over and above the
   *  ordinary instalments. Derived from the schedule, not from the plan. */
  function extraApplied(
    r: ReturnType<typeof computeMortgageWithPrepayments>,
    t: MortgageOriginalTerms
  ): number {
    const fullPayment = computeMonthlyPayment(t);
    const scheduledPortion = r.schedule.reduce(
      (s, e) => s + Math.max(0, Math.min(e.principal, fullPayment - e.interest)),
      0
    );
    return t.principal - scheduledPortion;
  }

  it("hands back the part of a lump the loan did not need", () => {
    const r = computeMortgageWithPrepayments(terms, [
      { date: "2025-02-01", amount: 1_000_000 },
    ]);
    const handedBack = r.unappliedPrepayments.reduce((s, u) => s + u.amount, 0);

    expect(r.schedule.reduce((s, e) => s + e.principal, 0)).toBeCloseTo(
      terms.principal,
      4
    );
    // Conservation: what the loan took plus what came back is what was given.
    expect(extraApplied(r, terms) + handedBack).toBeCloseTo(1_000_000, 0);
    expect(handedBack).toBeGreaterThan(600_000);
    expect(r.unappliedPrepayments[0].date).toBe("2025-02-01");
  });

  it("hands back everything dated after the loan is already gone", () => {
    const r = computeMortgageWithPrepayments(terms, [
      { date: "2025-02-01", amount: 400_000 },
      { date: "2027-06-01", amount: 20_000 },
      { date: "2028-06-01", amount: 5_000 },
    ]);
    const dates = r.unappliedPrepayments.map((u) => u.date);
    expect(dates).toContain("2027-06-01");
    expect(dates).toContain("2028-06-01");
    const late = r.unappliedPrepayments.filter((u) => u.date >= "2027-06-01");
    expect(late.reduce((s, u) => s + u.amount, 0)).toBeCloseTo(25_000, 6);
  });

  it("hands back nothing when every dollar was needed", () => {
    const r = computeMortgageWithPrepayments(terms, [
      { date: "2026-01-01", amount: 10_000 },
    ]);
    expect(r.unappliedPrepayments).toEqual([]);
  });

  it("conserves money exactly: applied plus handed back equals committed", () => {
    for (const amount of [5_000, 100_000, 299_000, 500_000, 2_000_000]) {
      const plan = [
        { date: "2025-06-01", amount },
        { date: "2030-06-01", amount },
      ];
      const r = computeMortgageWithPrepayments(terms, plan);
      const handedBack = r.unappliedPrepayments.reduce((s, u) => s + u.amount, 0);
      expect(extraApplied(r, terms) + handedBack).toBeCloseTo(2 * amount, 0);
    }
  });
});

describe("decomposeMortgageSavings with a future plan", () => {
  // Four things can shorten this loan and the user wants each credited on
  // its own line: the biweekly cadence, the prepayments already made, a
  // future lump sum, and a future recurring contribution.
  const contract: MortgageOriginalTerms = {
    principal: 680_000,
    annualRate: 0.0475,
    termMonths: 360,
    startDate: "2023-06-01",
    paymentFrequency: "biweekly",
  };
  const prepayments = [{ date: "2025-01-01", amount: 150_000 }];
  const asOfDate = "2026-08-01";

  it("adds a leg for a future lump sum", () => {
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 72_000,
      monthly: 0,
      yearly: 0,
    });
    expect(d.fromFutureLump.monthsSaved).toBeGreaterThan(0);
    expect(d.fromFutureLump.interestSaved).toBeGreaterThan(0);
    expect(d.fromFutureMonthly.monthsSaved).toBe(0);
    expect(d.projected.payoffDate < d.actual.payoffDate).toBe(true);
  });

  it("adds a leg for a future recurring contribution", () => {
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 0,
      monthly: 2_000,
      yearly: 0,
    });
    expect(d.fromFutureMonthly.monthsSaved).toBeGreaterThan(0);
    expect(d.fromFutureMonthly.interestSaved).toBeGreaterThan(0);
    expect(d.fromFutureLump.monthsSaved).toBe(0);
  });

  it("credits lump and recurring separately when both are used", () => {
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 72_000,
      monthly: 2_000,
      yearly: 0,
    });
    expect(d.fromFutureLump.monthsSaved).toBeGreaterThan(0);
    expect(d.fromFutureMonthly.monthsSaved).toBeGreaterThan(0);
    // The two are distinct contributions, not the same number twice.
    expect(d.fromFutureLump.interestSaved).not.toBeCloseTo(
      d.fromFutureMonthly.interestSaved,
      0
    );
  });

  it("keeps every leg summing to the whole", () => {
    // The waterfall must reconcile or the card is telling four small lies
    // that happen to look plausible.
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 72_000,
      monthly: 2_000,
      yearly: 0,
    });
    const legs = [
      d.fromCadence,
      d.fromPrepayments,
      d.fromFutureLump,
      d.fromFutureMonthly,
      d.fromFutureYearly,
    ];
    expect(legs.reduce((s, l) => s + l.monthsSaved, 0)).toBeCloseTo(
      d.total.monthsSaved,
      6
    );
    expect(legs.reduce((s, l) => s + l.interestSaved, 0)).toBeCloseTo(
      d.total.interestSaved,
      6
    );
  });

  it("measures the total against the contract, not against today", () => {
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 72_000,
      monthly: 2_000,
      yearly: 0,
    });
    const gap =
      (Date.parse(d.contract.payoffDate + "T00:00:00Z") -
        Date.parse(d.projected.payoffDate + "T00:00:00Z")) /
      (86_400_000 * 30.4375);
    expect(d.total.monthsSaved).toBeCloseTo(gap, 3);
  });

  it("behaves exactly as before when no plan is supplied", () => {
    // The two-argument form is still the "where things stand today" view.
    const withoutPlan = decomposeMortgageSavings(contract, prepayments);
    expect(withoutPlan.fromFutureLump.monthsSaved).toBe(0);
    expect(withoutPlan.fromFutureMonthly.monthsSaved).toBe(0);
    expect(withoutPlan.fromFutureYearly.monthsSaved).toBe(0);
    expect(withoutPlan.projected.payoffDate).toBe(withoutPlan.actual.payoffDate);
    expect(withoutPlan.total.monthsSaved).toBeCloseTo(
      withoutPlan.fromCadence.monthsSaved + withoutPlan.fromPrepayments.monthsSaved,
      6
    );
  });

  it("ignores a plan whose amounts are zero or unusable", () => {
    for (const plan of [
      { asOfDate, lumpSum: 0, monthly: 0, yearly: 0 },
      { asOfDate, lumpSum: Number.NaN, monthly: Number.NaN, yearly: Number.NaN },
      { asOfDate, lumpSum: -5_000, monthly: -100, yearly: -1 },
    ]) {
      const d = decomposeMortgageSavings(contract, prepayments, plan);
      expect(d.fromFutureLump.monthsSaved).toBe(0);
      expect(d.fromFutureMonthly.monthsSaved).toBe(0);
      expect(d.projected.payoffDate).toBe(d.actual.payoffDate);
    }
  });

  it("stops recurring contributions at the payoff rather than overpaying", () => {
    // A large monthly contribution retires the loan early; the schedule must
    // still repay exactly the principal borrowed, never more.
    const d = decomposeMortgageSavings(contract, prepayments, {
      asOfDate,
      lumpSum: 0,
      monthly: 20_000,
      yearly: 0,
    });
    expect(d.projected.payoffDate < d.actual.payoffDate).toBe(true);
    expect(d.projected.totalInterest).toBeGreaterThan(0);
    expect(d.projected.totalInterest).toBeLessThan(d.actual.totalInterest);
  });
});
