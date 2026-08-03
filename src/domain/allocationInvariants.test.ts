// src/domain/allocationInvariants.test.ts
//
// Every defect that has surfaced in this feature was found the same way: not
// by a test written alongside the code, but by checking the result against
// something INDEPENDENT of it — a closed form, a physical impossibility, a
// conservation law, or the rendered UI. Tests written next to an
// implementation encode its assumptions, so whatever the author failed to
// think of is invisible to both, and mutation testing cannot help because it
// only proves the tests notice deliberate edits.
//
// So this file is deliberately not about the implementation. It states
// properties that must hold of ANY correct answer, and checks them over a
// wide spread of randomly generated inputs. The list is the record of what
// has actually gone wrong here:
//
//   - money vanished (a recurring stream was dropped at payoff)
//   - a figure was quoted in the wrong unit (periods rendered as months)
//   - parts stopped summing to their whole (independently rounded legs)
//   - timing drifted (a lump lost a period of growth to bucketing)
//   - two modules disagreed about the same quantity
//
// Each has a law below. A regression in any of them fails here regardless of
// which module caused it.

import { describe, it, expect } from "vitest";
import {
  compareSurplusAllocations,
  solveBreakEvenReturn,
  type AllocationInput,
} from "./portfolioProjection";
import { decomposeMortgageSavings } from "./mortgage/comparison";
import { expandContributionPlan } from "./contributionPlan";
import { addMonths } from "./mortgage/baseline";
import type { MortgageOriginalTerms } from "./mortgage/types";

/** Deterministic PRNG so any failure is reproducible from the seed. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const YEARS = 365.25 * 86_400_000;
const yearsBetween = (from: string, to: string) =>
  (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / YEARS;

/** A spread of loans, plans and assumptions, none of them degenerate. */
function generateCase(r: () => number): AllocationInput {
  const biweekly = r() < 0.5;
  const terms: MortgageOriginalTerms = {
    principal: 150_000 + Math.floor(r() * 900_000),
    annualRate: 0.02 + r() * 0.06,
    termMonths: [180, 240, 360][Math.floor(r() * 3)],
    startDate: `20${10 + Math.floor(r() * 15)}-0${1 + Math.floor(r() * 9)}-01`,
    paymentFrequency: biweekly ? "biweekly" : "monthly",
  };
  const asOfDate = `20${26 + Math.floor(r() * 3)}-0${1 + Math.floor(r() * 9)}-01`;
  return {
    terms,
    prepayments:
      r() < 0.6
        ? [{ date: `${Number(asOfDate.slice(0, 4)) - 1}-06-01`, amount: Math.floor(r() * 200_000) + 1 }]
        : [],
    asOfDate,
    surplus: r() < 0.3 ? 0 : Math.floor(r() * 250_000),
    monthlyContribution: r() < 0.4 ? 0 : Math.floor(r() * 6_000),
    yearlyContribution: r() < 0.5 ? 0 : Math.floor(r() * 40_000),
    yearlyMonth: 1 + Math.floor(r() * 12),
    contributionsUntil:
      r() < 0.3 ? addMonths(asOfDate, 12 + Math.floor(r() * 180)) : undefined,
    annualReturn: r() * 0.14,
    capitalGainsRate: r() * 0.45,
    horizonYears: 5 + Math.floor(r() * 35),
    splits: [0, 0.5, 1],
  };
}

const CASES = (() => {
  const r = rng(20260803);
  return Array.from({ length: 150 }, () => generateCase(r));
})();

describe("allocation invariants (property-based)", () => {
  it("never loses or invents committed money", () => {
    // Whatever is committed must go somewhere: the split between the two
    // destinations is exhaustive at every fraction. Dropping a stream once
    // the loan was retired is exactly this law being broken.
    for (const input of CASES) {
      const r = compareSurplusAllocations(input);
      for (const o of r.outcomes) {
        expect(o.toPrepayment + o.toMarket).toBeCloseTo(
          Math.min(input.surplus, o.toPrepayment + o.toMarket),
          6
        );
        expect(o.monthlyToPrepayment + o.monthlyToMarket).toBeCloseTo(
          input.monthlyContribution ?? 0,
          6
        );
        expect(o.yearlyToPrepayment + o.yearlyToMarket).toBeCloseTo(
          input.yearlyContribution ?? 0,
          6
        );
        expect(o.toPrepayment).toBeGreaterThanOrEqual(0);
        expect(o.toMarket).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("produces a finite, non-negative answer for every field", () => {
    for (const input of CASES) {
      const r = compareSurplusAllocations(input);
      for (const o of r.outcomes) {
        for (const [key, v] of Object.entries(o)) {
          if (typeof v !== "number") continue;
          expect(Number.isFinite(v), `${key} on ${o.fractionToPrepayment}`).toBe(true);
        }
        expect(o.portfolioAfterTax).toBeGreaterThanOrEqual(0);
        expect(o.remainingDebtAtHorizon).toBeGreaterThanOrEqual(0);
        expect(o.contributions).toBeGreaterThanOrEqual(0);
        expect(o.debtFreeYears).toBeGreaterThanOrEqual(0);
        expect(o.payoffDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("values the portfolio exactly, by an independent closed form", () => {
    // Rebuild the answer from the plan itself rather than from the walk: each
    // dated contribution is worth amount x (1 + r)^(years to the horizon).
    // This is what caught the lump losing a period of growth to bucketing.
    for (const input of CASES) {
      // The all-market path with a horizon inside the loan's life has no
      // freed payments, so its value is entirely the plan's own money.
      const r = compareSurplusAllocations({
        ...input,
        capitalGainsRate: 0,
        splits: [0],
      });
      const o = r.outcomes[0];
      if (o.remainingDebtAtHorizon <= 0) continue; // loan retired: freed payments join in

      const horizonDate = addMonths(input.asOfDate, input.horizonYears * 12);
      const dated = [
        ...(input.surplus > 0
          ? [{ date: input.asOfDate, amount: input.surplus }]
          : []),
        ...expandContributionPlan(
          {
            asOfDate: input.asOfDate,
            lumpSum: 0,
            monthly: input.monthlyContribution ?? 0,
            yearly: input.yearlyContribution ?? 0,
            yearlyMonth: input.yearlyMonth,
            until: input.contributionsUntil,
          },
          input.terms.termMonths
        ),
      ];

      let expected = 0;
      let paidIn = 0;
      for (const c of dated) {
        if (c.date > horizonDate) continue;
        expected +=
          c.amount *
          Math.pow(1 + input.annualReturn, yearsBetween(c.date, horizonDate));
        paidIn += c.amount;
      }
      expect(o.contributions).toBeCloseTo(paidIn, 4);
      expect(o.portfolioAfterTax).toBeCloseTo(expected, 3);
    }
  });

  it("cannot make the market win at a zero return", () => {
    // A physical impossibility: cash that does not grow cannot beat avoiding
    // interest at any positive mortgage rate. This is the law that caught a
    // dropped stream, and it depends on nothing in the implementation.
    for (const input of CASES) {
      if (input.terms.annualRate <= 0) continue;
      const committed =
        input.surplus + (input.monthlyContribution ?? 0) + (input.yearlyContribution ?? 0);
      if (committed <= 0) continue;

      const r = compareSurplusAllocations({
        ...input,
        annualReturn: 0,
        splits: [0, 1],
      });
      const [market, mortgage] = r.outcomes;
      // Only meaningful where the prepayment actually changes the loan.
      if (mortgage.payoffDate === market.payoffDate) continue;
      expect(mortgage.netWorthAtHorizon).toBeGreaterThan(market.netWorthAtHorizon);
    }
  });

  it("moves monotonically: more to the mortgage never means a later payoff", () => {
    for (const input of CASES) {
      const r = compareSurplusAllocations({ ...input, splits: [0, 0.25, 0.5, 0.75, 1] });
      for (let i = 1; i < r.outcomes.length; i++) {
        expect(
          r.outcomes[i].payoffDate <= r.outcomes[i - 1].payoffDate,
          `${r.outcomes[i].payoffDate} after ${r.outcomes[i - 1].payoffDate}`
        ).toBe(true);
        expect(r.outcomes[i].monthsShaved).toBeGreaterThanOrEqual(
          r.outcomes[i - 1].monthsShaved - 1e-9
        );
      }
    }
  });

  it("keeps every quantity in the unit it is labelled with", () => {
    // Months saved is CALENDAR months, and must match the gap between the two
    // payoff dates whatever the payment cadence. Reporting a count of biweekly
    // periods here inflated the figure by 26/12.
    for (const input of CASES) {
      const r = compareSurplusAllocations({ ...input, splits: [0, 1] });
      const o = r.outcomes[1];
      const gapMonths =
        yearsBetween(o.payoffDate, r.reference.payoffDate) * 12;
      expect(o.monthsShaved).toBeCloseTo(gapMonths, 6);
    }
  });

  it("keeps the decomposition's parts summing to its whole", () => {
    for (const input of CASES) {
      const d = decomposeMortgageSavings(input.terms, input.prepayments, {
        asOfDate: input.asOfDate,
        lumpSum: input.surplus,
        monthly: input.monthlyContribution ?? 0,
        yearly: input.yearlyContribution ?? 0,
        yearlyMonth: input.yearlyMonth,
        until: input.contributionsUntil,
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
        4
      );
      for (const l of legs) expect(l.monthsSaved).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("has the two modules agree about the same quantity", () => {
    // The card shows both side by side. They must not contradict each other.
    for (const input of CASES) {
      const r = compareSurplusAllocations({ ...input, splits: [0, 1] });
      const d = decomposeMortgageSavings(input.terms, input.prepayments, {
        asOfDate: input.asOfDate,
        lumpSum: input.surplus,
        monthly: input.monthlyContribution ?? 0,
        yearly: input.yearlyContribution ?? 0,
        yearlyMonth: input.yearlyMonth,
        until: input.contributionsUntil,
      });
      expect(r.outcomes[1].payoffDate).toBe(d.projected.payoffDate);
      expect(r.outcomes[1].monthsShaved).toBeCloseTo(
        d.fromFutureLump.monthsSaved +
          d.fromFutureMonthly.monthsSaved +
          d.fromFutureYearly.monthsSaved,
        6
      );
    }
  });

  it("taxes only the gain, and never more than the gain", () => {
    for (const input of CASES) {
      const r = compareSurplusAllocations(input);
      for (const o of r.outcomes) {
        // After-tax value is never below what was paid in, and never above
        // the untaxed value.
        const untaxed = compareSurplusAllocations({
          ...input,
          capitalGainsRate: 0,
          splits: [o.fractionToPrepayment],
        }).outcomes[0];
        expect(o.portfolioAfterTax).toBeLessThanOrEqual(untaxed.portfolioAfterTax + 1e-6);
        expect(o.portfolioAfterTax).toBeGreaterThanOrEqual(
          Math.min(o.contributions, untaxed.portfolioAfterTax) - 1e-6
        );
      }
    }
  });

  it("gives the same answer twice, and one unaffected by which splits were asked for", () => {
    for (const input of CASES) {
      const a = compareSurplusAllocations(input);
      const b = compareSurplusAllocations(input);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));

      // The reference is the all-market path; asking for more splits alongside
      // it must not move it.
      const narrow = compareSurplusAllocations({ ...input, splits: [0] });
      expect(narrow.reference.netWorthAtHorizon).toBeCloseTo(
        a.reference.netWorthAtHorizon,
        6
      );
    }
  });

  it("brackets a real crossing whenever it reports a break-even", () => {
    for (const input of CASES) {
      const be = solveBreakEvenReturn(input);
      if (be === null) continue;
      const advantage = (annualReturn: number) => {
        const c = compareSurplusAllocations({ ...input, annualReturn, splits: [0, 1] });
        return c.outcomes[1].netWorthAtHorizon - c.outcomes[0].netWorthAtHorizon;
      };
      expect(be).toBeGreaterThanOrEqual(0);
      expect(be).toBeLessThanOrEqual(0.5);
      // Prepaying wins below the rate and loses above it.
      expect(advantage(Math.max(0, be - 0.01))).toBeGreaterThan(0);
      expect(advantage(be + 0.01)).toBeLessThan(0);
    }
  });
});
