// src/domain/portfolioProjection.test.ts
//
// The head-to-head: put a dollar of surplus into the market, or into the
// mortgage? Everything here is about making that comparison FAIR, which is
// harder than it looks. Two traps:
//
//   1. Cashflow. Prepaying makes the loan end sooner, which frees the payment
//      years earlier. A comparison that ignores the freed payment flatters
//      the market badly. Both paths must spend the same out of pocket every
//      period, with whatever is freed going into the market.
//   2. Tax. The market path owes capital gains at the end; the mortgage path
//      owes nothing. Comparing pre-tax portfolio values to a debt balance is
//      comparing two different currencies.
//
// The load-bearing tests are the solveBreakEvenReturn ones at the bottom.
// The closed-form hurdle in surplusAllocation.ts and this simulation do NOT
// agree in general, and the tests pin exactly where they diverge: they match
// when the horizon stops at payoff, and separate once it runs past, because
// only the simulation models the freed mortgage payment being reinvested.
// The simulation is the one the UI quotes.

import { describe, it, expect } from "vitest";
import {
  compareSurplusAllocations,
  solveBreakEvenReturn,
} from "./portfolioProjection";
import { computePrepaymentHurdleRate } from "./surplusAllocation";
import { decomposeMortgageSavings } from "./mortgage/comparison";
import { expandContributionPlan } from "./contributionPlan";
import { addMonths } from "./mortgage/baseline";
import type { MortgageOriginalTerms } from "./mortgage/types";

/** Whole calendar months from `from` to `to`, fractional part included. */
function monthsBetweenDates(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) + (td - fd) / 30;
}

const terms: MortgageOriginalTerms = {
  principal: 680_000,
  annualRate: 0.0475,
  termMonths: 360,
  startDate: "2023-06-01",
  paymentFrequency: "biweekly",
};

const base = {
  terms,
  prepayments: [{ date: "2024-04-01", amount: 25_000 }],
  asOfDate: "2026-08-01",
  surplus: 100_000,
  annualReturn: 0.07,
  capitalGainsRate: 0.2517,
  horizonYears: 25,
};

describe("compareSurplusAllocations", () => {
  it("returns one outcome per requested split, in order", () => {
    const r = compareSurplusAllocations({ ...base, splits: [0, 0.5, 1] });
    expect(r.outcomes.map((o) => o.fractionToPrepayment)).toEqual([0, 0.5, 1]);
    expect(r.outcomes.map((o) => o.toPrepayment)).toEqual([0, 50_000, 100_000]);
    expect(r.outcomes.map((o) => o.toMarket)).toEqual([100_000, 50_000, 0]);
  });

  it("uses the all-market split as the reference point", () => {
    const r = compareSurplusAllocations(base);
    expect(r.reference.fractionToPrepayment).toBe(0);
    expect(r.reference.monthsShaved).toBe(0);
    expect(r.reference.wealthGivenUp).toBe(0);
    // Nothing was shaved, so there is no per-month price to quote.
    expect(r.reference.costPerMonthShaved).toBeNull();
  });

  it("shortens the loan and saves interest in proportion to the prepayment", () => {
    const r = compareSurplusAllocations({ ...base, splits: [0, 0.5, 1] });
    const [none, half, all] = r.outcomes;

    expect(half.monthsShaved).toBeGreaterThan(0);
    expect(all.monthsShaved).toBeGreaterThan(half.monthsShaved);
    expect(half.interestSaved).toBeGreaterThan(0);
    expect(all.interestSaved).toBeGreaterThan(half.interestSaved);

    expect(all.payoffDate < half.payoffDate).toBe(true);
    expect(half.payoffDate < none.payoffDate).toBe(true);
  });

  it("keeps the recorded prepayments in every path", () => {
    // The comparison is about the NEW money. Past prepayments are history and
    // must sit under all splits alike, or the all-market path would look like
    // the loan had never been prepaid at all.
    const withHistory = compareSurplusAllocations(base);
    const withoutHistory = compareSurplusAllocations({ ...base, prepayments: [] });
    expect(withHistory.reference.payoffDate < withoutHistory.reference.payoffDate).toBe(
      true
    );
  });

  it("measures months shaved on the calendar, not in payment periods", () => {
    // A biweekly period is 14 days, so a raw period count overstates the
    // saving by 26/12. This is the headline number on the card — "you'd be
    // debt-free N months sooner" — so it has to be real calendar time.
    const r = compareSurplusAllocations({ ...base, splits: [0, 1] });
    const o = r.outcomes[1];
    const gap = monthsBetweenDates(o.payoffDate, r.reference.payoffDate);
    expect(gap).toBeGreaterThan(1);
    expect(o.monthsShaved).toBeGreaterThan(gap - 1.5);
    expect(o.monthsShaved).toBeLessThan(gap + 1.5);
  });

  it("prices the trade as wealth given up per month shaved", () => {
    const r = compareSurplusAllocations(base);
    for (const o of r.outcomes) {
      if (o.monthsShaved <= 0) continue;
      expect(o.wealthGivenUp).toBeCloseTo(
        r.reference.netWorthAtHorizon - o.netWorthAtHorizon,
        6
      );
      expect(o.costPerMonthShaved).toBeCloseTo(
        o.wealthGivenUp / o.monthsShaved,
        6
      );
    }
  });

  it("flips the winner either side of the closed-form hurdle", () => {
    // The closed form lands within a few tenths of a point of the simulation
    // at this horizon, so a 2-point band around it still brackets the real
    // crossing. Tight agreement is asserted in the solveBreakEvenReturn
    // suite, where the horizon is set to make the two comparable.
    const yearsLeft = 20.5;
    const hurdle = computePrepaymentHurdleRate(
      terms.annualRate,
      yearsLeft,
      base.capitalGainsRate
    );

    const below = compareSurplusAllocations({
      ...base,
      annualReturn: hurdle - 0.02,
      splits: [0, 1],
    });
    expect(below.outcomes[1].netWorthAtHorizon).toBeGreaterThan(
      below.outcomes[0].netWorthAtHorizon
    );
    expect(below.marketFavoured).toBe(false);

    const above = compareSurplusAllocations({
      ...base,
      annualReturn: hurdle + 0.02,
      splits: [0, 1],
    });
    expect(above.outcomes[1].netWorthAtHorizon).toBeLessThan(
      above.outcomes[0].netWorthAtHorizon
    );
    expect(above.marketFavoured).toBe(true);
  });

  it("charges capital gains only on the gain, never on the contributions", () => {
    // A zero return means zero gain, so the after-tax portfolio must equal
    // the money put in — no phantom tax on principal.
    const r = compareSurplusAllocations({
      ...base,
      annualReturn: 0,
      splits: [0],
      horizonYears: 10,
    });
    const o = r.outcomes[0];
    expect(o.portfolioAfterTax).toBeCloseTo(o.contributions, 4);
  });

  it("compounds a lump from the as-of date to the horizon date", () => {
    // The lump is money in hand on the as-of date, and the mortgage side
    // applies it at the very next payment, so it must compound over the whole
    // span. Growth is measured in actual days over 365.25, and the horizon is
    // a calendar date three years out — 1,096 days here, not the 1,092 that a
    // count of 78 biweekly periods would have given.
    const horizonYears = 3;
    const horizonDate = addMonths(base.asOfDate, horizonYears * 12);
    const span =
      (Date.parse(horizonDate + "T00:00:00Z") -
        Date.parse(base.asOfDate + "T00:00:00Z")) /
      (365.25 * 86_400_000);

    for (const annualReturn of [0.07, 0.1]) {
      const o = compareSurplusAllocations({
        ...base,
        surplus: 100_000,
        monthlyContribution: 0,
        annualReturn,
        capitalGainsRate: 0,
        // Well before payoff, so no freed payments enter the total.
        horizonYears,
        splits: [0],
      }).outcomes[0];
      expect(o.portfolioAfterTax).toBeCloseTo(
        100_000 * Math.pow(1 + annualReturn, span),
        6
      );
    }
  });

  it("compounds every contribution from its own date, exactly", () => {
    // Closed form, independent of the implementation: each dated contribution
    // is worth amount x (1 + r)^(years from its date to the horizon). This is
    // the check that bucketing into payment periods could never pass, because
    // bucketing shifts each contribution up to a period late.
    const annualReturn = 0.07;
    const horizonYears = 6;
    const monthlyContribution = 2_000;
    const yearlyContribution = 15_000;

    const o = compareSurplusAllocations({
      ...base,
      surplus: 0,
      monthlyContribution,
      yearlyContribution,
      yearlyMonth: 3,
      annualReturn,
      capitalGainsRate: 0,
      horizonYears,
      splits: [0],
    }).outcomes[0];

    // Rebuild the expected value from the plan itself.
    const contributions = expandContributionPlan(
      {
        asOfDate: base.asOfDate,
        lumpSum: 0,
        monthly: monthlyContribution,
        yearly: yearlyContribution,
        yearlyMonth: 3,
      },
      base.terms.termMonths
    );
    const horizonDate = addMonths(base.asOfDate, horizonYears * 12);
    const years = (from: string, to: string) =>
      (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      (365.25 * 86_400_000);

    let expected = 0;
    let paidIn = 0;
    for (const c of contributions) {
      if (c.date > horizonDate) continue;
      expected += c.amount * Math.pow(1 + annualReturn, years(c.date, horizonDate));
      paidIn += c.amount;
    }

    // The loan outlives this horizon, so no freed payments enter the total.
    expect(o.remainingDebtAtHorizon).toBeGreaterThan(0);
    expect(o.contributions).toBeCloseTo(paidIn, 6);
    expect(o.portfolioAfterTax).toBeCloseTo(expected, 4);
  });

  it("counts the freed mortgage payment as invested once the loan ends", () => {
    // With no surplus at all, a horizon past payoff must still accumulate
    // wealth, because the payment stops leaving the household.
    const r = compareSurplusAllocations({
      ...base,
      surplus: 0,
      splits: [0],
      horizonYears: 30,
    });
    expect(r.outcomes[0].portfolioAfterTax).toBeGreaterThan(0);
    expect(r.outcomes[0].contributions).toBeGreaterThan(0);
  });

  it("reports months sooner from the payoff dates, not clipped by the horizon", () => {
    // A horizon shorter than either payoff must not silently report "no time
    // saved". The card shows the payoff dates alongside this figure and an
    // attribution breakdown that is never clipped, so a clipped value here
    // would put two contradictory claims on the same screen.
    for (const horizonYears of [1, 3, 5, 30]) {
      const r = compareSurplusAllocations({
        ...base,
        monthlyContribution: 2_000,
        horizonYears,
        splits: [0, 1],
      });
      const o = r.outcomes[1];
      const gap = monthsBetweenDates(o.payoffDate, r.reference.payoffDate);
      expect(gap).toBeGreaterThan(1);
      expect(o.monthsShaved).toBeGreaterThan(gap - 1.5);
      expect(o.monthsShaved).toBeLessThan(gap + 1.5);
    }
  });

  it("subtracts debt still outstanding at a short horizon", () => {
    // Stopping the clock before payoff leaves a mortgage on the books. Net
    // worth has to carry it, or a short horizon would make prepaying look
    // free.
    const r = compareSurplusAllocations({ ...base, horizonYears: 3, splits: [0, 1] });
    expect(r.outcomes[0].remainingDebtAtHorizon).toBeGreaterThan(0);
    expect(r.outcomes[1].remainingDebtAtHorizon).toBeLessThan(
      r.outcomes[0].remainingDebtAtHorizon
    );
    expect(r.outcomes[0].netWorthAtHorizon).toBeLessThan(
      r.outcomes[0].portfolioAfterTax
    );
  });

  it("reports how long the household lives mortgage-free", () => {
    const r = compareSurplusAllocations({ ...base, splits: [0, 1] });
    expect(r.outcomes[1].debtFreeYears).toBeGreaterThan(
      r.outcomes[0].debtFreeYears
    );
    expect(r.outcomes[0].debtFreeYears).toBeGreaterThanOrEqual(0);
  });

  it("handles a monthly loan as readily as a biweekly one", () => {
    const r = compareSurplusAllocations({
      ...base,
      terms: { ...terms, paymentFrequency: "monthly" },
      splits: [0, 1],
    });
    expect(r.outcomes[1].monthsShaved).toBeGreaterThan(0);
    expect(Number.isFinite(r.outcomes[1].netWorthAtHorizon)).toBe(true);
  });

  it("survives degenerate inputs without emitting NaN", () => {
    const degenerate = [
      { ...base, surplus: 0 },
      { ...base, surplus: -5_000 },
      { ...base, horizonYears: 0 },
      { ...base, annualReturn: -1 },
      { ...base, capitalGainsRate: 0 },
      { ...base, splits: [] },
      { ...base, splits: [-1, 2] },
    ];
    for (const input of degenerate) {
      const r = compareSurplusAllocations(input);
      for (const o of r.outcomes) {
        expect(Number.isFinite(o.netWorthAtHorizon)).toBe(true);
        expect(Number.isFinite(o.portfolioAfterTax)).toBe(true);
        expect(Number.isFinite(o.monthsShaved)).toBe(true);
        expect(o.fractionToPrepayment).toBeGreaterThanOrEqual(0);
        expect(o.fractionToPrepayment).toBeLessThanOrEqual(1);
      }
    }
  });

  it("counts the full principal as owed before the first payment lands", () => {
    // An as-of date earlier than the loan itself must not read the balance as
    // zero, which would clamp every prepayment away to nothing.
    const r = compareSurplusAllocations({
      ...base,
      asOfDate: "2023-01-01",
      prepayments: [],
      splits: [1],
    });
    expect(r.outcomes[0].toPrepayment).toBe(base.surplus);
  });

  it("coerces non-numeric inputs rather than propagating NaN", () => {
    const r = compareSurplusAllocations({
      ...base,
      surplus: Number.NaN,
      horizonYears: Number.NaN,
      annualReturn: Number.NaN,
      capitalGainsRate: Number.NaN,
      splits: [0, Number.NaN, 1],
    });
    for (const o of r.outcomes) {
      expect(Number.isFinite(o.netWorthAtHorizon)).toBe(true);
      expect(Number.isFinite(o.portfolioAfterTax)).toBe(true);
    }
  });

  it("never lets the prepayment exceed what is actually owed", () => {
    // A surplus larger than the balance pays the loan off and the remainder
    // stays invested; it must not vanish into the mortgage.
    const r = compareSurplusAllocations({
      ...base,
      surplus: 2_000_000,
      splits: [1],
    });
    const o = r.outcomes[0];
    expect(o.toPrepayment).toBeLessThan(2_000_000);
    expect(o.remainingDebtAtHorizon).toBe(0);
    expect(o.portfolioAfterTax).toBeGreaterThan(0);
  });
});

describe("solveBreakEvenReturn", () => {
  it("finds the return at which the two paths are worth the same", () => {
    const r = solveBreakEvenReturn(base)!;
    expect(r).not.toBeNull();

    const at = (annualReturn: number) => {
      const c = compareSurplusAllocations({ ...base, annualReturn, splits: [0, 1] });
      return c.outcomes[1].netWorthAtHorizon - c.outcomes[0].netWorthAtHorizon;
    };
    // Within a dollar of a tie at the solved rate.
    expect(Math.abs(at(r))).toBeLessThan(1);
    // And the sign flips cleanly either side of it.
    expect(at(r - 0.01)).toBeGreaterThan(0);
    expect(at(r + 0.01)).toBeLessThan(0);
  });

  it("agrees with the closed form when the clock stops at payoff", () => {
    // The analytic hurdle assumes the comparison ends when the loan does. Set
    // the horizon to the remaining term and the two line up closely; this is
    // what licenses computePrepaymentHurdleRate as a sanity reference at all.
    //
    // They do not agree exactly, and should not be made to. The closed form
    // idealises: it treats avoided interest as compounding smoothly at the
    // mortgage rate, whereas the real loan retires on a discrete payment date
    // with a partial final instalment, and the market receives the lump on the
    // as-of date while the servicer applies it at the next payment. The
    // residual sits at 0.07-0.11 of a point across horizons either side of
    // payoff, stable rather than drifting — which is the signature of a
    // modelling difference, not an error.
    const yearsLeft = 20.5;
    const simulated = solveBreakEvenReturn({ ...base, horizonYears: yearsLeft })!;
    const closed = computePrepaymentHurdleRate(
      terms.annualRate,
      yearsLeft,
      base.capitalGainsRate
    );
    expect(Math.abs(simulated - closed)).toBeLessThan(0.002);
  });

  it("falls as the horizon extends past payoff", () => {
    // Once the loan is gone the freed payment compounds in the MARKET, not at
    // the mortgage rate, so a longer horizon works in the market's favour and
    // lowers the bar. The closed form, which has no reinvestment window, moves
    // the opposite way — hence this module, not the formula, drives the card.
    const short = solveBreakEvenReturn({ ...base, horizonYears: 20.5 })!;
    const long = solveBreakEvenReturn({ ...base, horizonYears: 40 })!;
    expect(long).toBeLessThan(short);
  });

  it("has no answer when there is nothing to allocate", () => {
    expect(solveBreakEvenReturn({ ...base, surplus: 0 })).toBeNull();
    expect(solveBreakEvenReturn({ ...base, horizonYears: 0 })).toBeNull();
    // A non-numeric amount is "nothing", not "some unknown quantity".
    expect(
      solveBreakEvenReturn({ ...base, surplus: Number.NaN })
    ).toBeNull();
    expect(
      solveBreakEvenReturn({
        ...base,
        surplus: Number.NaN,
        monthlyContribution: Number.NaN,
      })
    ).toBeNull();
  });

  it("has no answer when the market can never catch up", () => {
    // Taxing the entire gain leaves the market path worth exactly what was
    // paid in, so prepaying wins at any return whatsoever. Reporting the top
    // of the search range as if it were a real crossing would be a lie.
    expect(
      solveBreakEvenReturn({ ...base, capitalGainsRate: 1 })
    ).toBeNull();
  });

  it("has no answer once the mortgage is already paid off", () => {
    const paidOff = solveBreakEvenReturn({
      ...base,
      prepayments: [{ date: "2026-07-01", amount: 700_000 }],
    });
    expect(paidOff).toBeNull();
  });
});

describe("recurring contributions", () => {
  // The surplus is not always a lump. A household that can put $2,000 a month
  // toward either destination faces the same question, and the comparison has
  // to stay fair: the same monthly amount goes somewhere in every path.
  const recurring = { ...base, surplus: 0, monthlyContribution: 2_000 };

  it("shortens the loan when the recurring money goes to the mortgage", () => {
    const r = compareSurplusAllocations({ ...recurring, splits: [0, 1] });
    expect(r.outcomes[1].monthsShaved).toBeGreaterThan(0);
    expect(r.outcomes[1].payoffDate < r.outcomes[0].payoffDate).toBe(true);
  });

  it("splits the monthly amount the same way as the lump", () => {
    const r = compareSurplusAllocations({ ...recurring, splits: [0, 0.5, 1] });
    expect(r.outcomes.map((o) => o.monthlyToPrepayment)).toEqual([0, 1_000, 2_000]);
    expect(r.outcomes.map((o) => o.monthlyToMarket)).toEqual([2_000, 1_000, 0]);
  });

  it("invests the market share every month rather than dropping it", () => {
    // The all-market path must accumulate the recurring money too, or the
    // mortgage side would win by default.
    const r = compareSurplusAllocations({ ...recurring, splits: [0], horizonYears: 10 });
    // 10 years x 12 x $2,000 of contributions, plus freed payments.
    expect(r.outcomes[0].contributions).toBeGreaterThan(200_000);
  });

  it("handles a lump and a recurring stream together", () => {
    const both = {
      ...base,
      surplus: 72_000,
      monthlyContribution: 2_000,
      splits: [0, 1],
    };
    const r = compareSurplusAllocations(both);
    const lumpOnly = compareSurplusAllocations({ ...both, monthlyContribution: 0 });
    // Adding a recurring stream on top of the lump shaves strictly more.
    expect(r.outcomes[1].monthsShaved).toBeGreaterThan(
      lumpOnly.outcomes[1].monthsShaved
    );
  });

  it("never lets the market win at a zero return", () => {
    // The sharpest available sanity check on cashflow equalisation. At a 0%
    // market return, cash put in the market just sits there while the same
    // cash put on the mortgage avoids 4.75% interest, so prepaying MUST win.
    // It didn't, until the recurring stream was made investable at payoff:
    // in the all-to-mortgage path the monthly extra principal has nothing
    // left to pay down once the loan is retired, and was being dropped.
    for (const input of [
      { ...recurring, splits: [0, 1] },
      { ...base, surplus: 72_000, monthlyContribution: 2_000, splits: [0, 1] },
      { ...base, monthlyContribution: 0, splits: [0, 1] },
    ]) {
      const r = compareSurplusAllocations({ ...input, annualReturn: 0 });
      expect(r.outcomes[1].netWorthAtHorizon).toBeGreaterThan(
        r.outcomes[0].netWorthAtHorizon
      );
      expect(r.marketFavoured).toBe(false);
    }
  });

  it("keeps the same total going out of the household in every split", () => {
    // Cashflow equalisation, stated directly: before payoff each path spends
    // the mortgage payment plus the whole recurring amount, wherever it goes.
    const r = compareSurplusAllocations({ ...recurring, splits: [0, 0.5, 1] });
    for (const o of r.outcomes) {
      expect(o.monthlyToPrepayment + o.monthlyToMarket).toBeCloseTo(2_000, 6);
    }
  });

  it("still finds a break-even with only recurring money", () => {
    const be = solveBreakEvenReturn(recurring);
    expect(be).not.toBeNull();
    expect(be!).toBeGreaterThan(0.03);
    expect(be!).toBeLessThan(0.09);
  });

  it("treats an unusable monthly amount as none", () => {
    for (const monthlyContribution of [Number.NaN, -500, undefined]) {
      const r = compareSurplusAllocations({
        ...base,
        monthlyContribution,
        splits: [0, 1],
      });
      for (const o of r.outcomes) {
        expect(Number.isFinite(o.netWorthAtHorizon)).toBe(true);
        expect(o.monthlyToPrepayment).toBe(0);
      }
    }
  });

  it("has no break-even when there is neither a lump nor a stream", () => {
    expect(
      solveBreakEvenReturn({ ...base, surplus: 0, monthlyContribution: 0 })
    ).toBeNull();
  });
});

describe("consistency with the attribution breakdown", () => {
  // The card shows both, side by side. The time the all-to-mortgage split
  // buys (measured against all-to-market) is exactly the time the future
  // money buys in the waterfall (its lump leg plus its recurring leg). If
  // these two ever disagree the card contradicts itself on screen.
  const cases = [
    { surplus: 72_000, monthlyContribution: 0, yearlyContribution: 0 },
    { surplus: 0, monthlyContribution: 2_000, yearlyContribution: 0 },
    { surplus: 72_000, monthlyContribution: 2_000, yearlyContribution: 0 },
    { surplus: 250_000, monthlyContribution: 5_000, yearlyContribution: 0 },
    { surplus: 0, monthlyContribution: 0, yearlyContribution: 15_000 },
    { surplus: 72_000, monthlyContribution: 2_000, yearlyContribution: 15_000 },
    {
      surplus: 72_000, monthlyContribution: 2_000, yearlyContribution: 15_000,
      contributionsUntil: "2031-12-31",
    },
  ];

  it.each(cases)(
    "agrees on months bought for $surplus + $monthlyContribution/mo + $yearlyContribution/yr",
    ({ surplus, monthlyContribution, yearlyContribution, contributionsUntil }) => {
      const r = compareSurplusAllocations({
        ...base,
        surplus,
        monthlyContribution,
        yearlyContribution,
        contributionsUntil,
        splits: [0, 1],
      });
      const d = decomposeMortgageSavings(base.terms, base.prepayments, {
        asOfDate: base.asOfDate,
        lumpSum: surplus,
        monthly: monthlyContribution,
        yearly: yearlyContribution,
        until: contributionsUntil,
      });
      const fromFutureMoney =
        d.fromFutureLump.monthsSaved +
        d.fromFutureMonthly.monthsSaved +
        d.fromFutureYearly.monthsSaved;
      expect(r.outcomes[1].monthsShaved).toBeCloseTo(fromFutureMoney, 6);
    }
  );

  it.each(cases)(
    "agrees on the projected payoff date for $surplus + $monthlyContribution/mo + $yearlyContribution/yr",
    ({ surplus, monthlyContribution, yearlyContribution, contributionsUntil }) => {
      const r = compareSurplusAllocations({
        ...base,
        surplus,
        monthlyContribution,
        yearlyContribution,
        contributionsUntil,
        splits: [1],
      });
      const d = decomposeMortgageSavings(base.terms, base.prepayments, {
        asOfDate: base.asOfDate,
        lumpSum: surplus,
        monthly: monthlyContribution,
        yearly: yearlyContribution,
        until: contributionsUntil,
      });
      expect(r.outcomes[0].payoffDate).toBe(d.projected.payoffDate);
    }
  );
});

describe("yearly contributions and bounded streams", () => {
  const bonus = {
    ...base,
    surplus: 0,
    monthlyContribution: 0,
    yearlyContribution: 15_000,
    yearlyMonth: 3,
  };

  it("shortens the loan when a yearly bonus goes to the mortgage", () => {
    const r = compareSurplusAllocations({ ...bonus, splits: [0, 1] });
    expect(r.outcomes[1].monthsShaved).toBeGreaterThan(0);
    expect(r.outcomes[1].payoffDate < r.outcomes[0].payoffDate).toBe(true);
  });

  it("splits the yearly amount like every other stream", () => {
    const r = compareSurplusAllocations({ ...bonus, splits: [0, 0.5, 1] });
    expect(r.outcomes.map((o) => o.yearlyToPrepayment)).toEqual([0, 7_500, 15_000]);
    expect(r.outcomes.map((o) => o.yearlyToMarket)).toEqual([15_000, 7_500, 0]);
  });

  it("never lets the market win at a zero return, with a bonus too", () => {
    // The same impossibility check that caught the dropped monthly stream.
    for (const input of [
      bonus,
      { ...bonus, monthlyContribution: 2_000 },
      { ...base, yearlyContribution: 15_000, yearlyMonth: 3 },
    ]) {
      const r = compareSurplusAllocations({
        ...input,
        annualReturn: 0,
        splits: [0, 1],
      });
      expect(r.outcomes[1].netWorthAtHorizon).toBeGreaterThan(
        r.outcomes[0].netWorthAtHorizon
      );
    }
  });

  it("stops contributing after the end date", () => {
    const bounded = compareSurplusAllocations({
      ...base,
      surplus: 0,
      monthlyContribution: 2_000,
      contributionsUntil: "2029-12-31",
      splits: [0, 1],
    });
    const openEnded = compareSurplusAllocations({
      ...base,
      surplus: 0,
      monthlyContribution: 2_000,
      splits: [0, 1],
    });
    // A stream that stops early buys less time and gives up less wealth.
    expect(bounded.outcomes[1].monthsShaved).toBeLessThan(
      openEnded.outcomes[1].monthsShaved
    );
    expect(bounded.outcomes[1].monthsShaved).toBeGreaterThan(0);
  });

  it("leaves the lump untouched by the end date", () => {
    // The lump is committed now, so bounding the streams must not cancel it.
    const r = compareSurplusAllocations({
      ...base,
      monthlyContribution: 0,
      contributionsUntil: "2020-01-01",
      splits: [0, 1],
    });
    expect(r.outcomes[1].toPrepayment).toBe(base.surplus);
    expect(r.outcomes[1].monthsShaved).toBeGreaterThan(0);
  });

  it("invests a bonus on its own date rather than smearing it", () => {
    // Bucketing by period, not spreading, is what keeps the two arms funded
    // identically. A March bonus invested in March compounds for longer than
    // the same money dripped through the year, so the market path must not
    // be quietly penalised by an averaging shortcut.
    const r = compareSurplusAllocations({
      ...bonus,
      annualReturn: 0,
      splits: [0],
      horizonYears: 10,
    });
    // Ten years of $15k bonuses, all of it basis at a zero return, plus the
    // freed mortgage payment once the loan ends.
    expect(r.outcomes[0].contributions).toBeGreaterThanOrEqual(10 * 15_000);
  });

  it("keeps the whole committed amount in play across every split", () => {
    const r = compareSurplusAllocations({
      ...base,
      monthlyContribution: 2_000,
      yearlyContribution: 15_000,
      splits: [0, 0.25, 0.5, 0.75, 1],
    });
    for (const o of r.outcomes) {
      expect(o.toPrepayment + o.toMarket).toBeCloseTo(base.surplus, 6);
      expect(o.monthlyToPrepayment + o.monthlyToMarket).toBeCloseTo(2_000, 6);
      expect(o.yearlyToPrepayment + o.yearlyToMarket).toBeCloseTo(15_000, 6);
    }
  });

  it("finds a break-even from a bonus alone", () => {
    const be = solveBreakEvenReturn(bonus);
    expect(be).not.toBeNull();
    expect(be!).toBeGreaterThan(0.03);
    expect(be!).toBeLessThan(0.09);
  });

  it("survives unusable yearly settings", () => {
    for (const over of [
      { yearlyContribution: Number.NaN },
      { yearlyContribution: -5_000 },
      { yearlyMonth: 99 },
      { yearlyMonth: Number.NaN },
      { contributionsUntil: "not-a-date" },
      { contributionsUntil: "1990-01-01" },
    ]) {
      const r = compareSurplusAllocations({ ...bonus, ...over, splits: [0, 1] });
      for (const o of r.outcomes) {
        expect(Number.isFinite(o.netWorthAtHorizon)).toBe(true);
        expect(Number.isFinite(o.monthsShaved)).toBe(true);
        expect(o.yearlyToPrepayment).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
