// src/domain/surplusAllocation.test.ts
//
// Two separable questions live in this module, and the tests keep them apart:
//
//   1. How much money is actually free to allocate? (reserve sizing)
//   2. What return would the market have to clear for investing it to beat
//      prepaying the mortgage? (the hurdle rate)
//
// The hurdle is the piece worth pinning hardest, because it is the number a
// real allocation decision turns on and it is easy to get subtly wrong — the
// naive form taxes the market return every year, when a buy-and-hold taxable
// account defers tax until the gain is realised. Deferral materially lowers
// the bar, so the tests check the closed form against a direct simulation.

import { describe, it, expect } from "vitest";
import {
  deriveMonthlyExpenses,
  computeReserveTarget,
  computeSurplus,
  computePrepaymentHurdleRate,
  DEFAULT_RESERVE_MONTHS,
} from "./surplusAllocation";
import type { RecurringRule } from "./types";

const rule = (
  id: string,
  amount: number,
  schedule: RecurringRule["schedule"]
): RecurringRule => ({ id, name: id, amount, isVariable: false, schedule });

describe("deriveMonthlyExpenses", () => {
  it("ignores inflows and counts only what leaves the account", () => {
    const rules = [
      rule("salary", 6_000, { type: "monthly", day: 1 }),
      rule("rent", -2_400, { type: "monthly", day: 1 }),
    ];
    expect(deriveMonthlyExpenses(rules)).toBeCloseTo(2_400, 6);
  });

  it("normalises every schedule type to a monthly rate", () => {
    // A twice-monthly outflow hits 24 times a year; a biweekly one 26. Both
    // have to be expressed per month or the reserve is sized off a number
    // that means nothing.
    expect(
      deriveMonthlyExpenses([rule("groceries", -300, { type: "twiceMonth", day1: 1, day2: 15 })])
    ).toBeCloseTo(600, 6);

    expect(
      deriveMonthlyExpenses([
        rule("car", -200, { type: "biweekly", anchorDate: "2026-01-02" }),
      ])
    ).toBeCloseTo(200 * (26 / 12), 6);
  });

  it("sums a realistic mixed household", () => {
    const rules = [
      rule("salary", 8_000, { type: "twiceMonth", day1: 15, day2: 31 }),
      rule("mortgage", -3_500, { type: "monthly", day: 1 }),
      rule("utilities", -280, { type: "monthly", day: 12 }),
      rule("groceries", -350, { type: "biweekly", anchorDate: "2026-01-02" }),
    ];
    expect(deriveMonthlyExpenses(rules)).toBeCloseTo(
      3_500 + 280 + 350 * (26 / 12),
      6
    );
  });

  it("is zero, not negative or NaN, for degenerate inputs", () => {
    expect(deriveMonthlyExpenses([])).toBe(0);
    expect(
      deriveMonthlyExpenses([rule("bonus", 500, { type: "monthly", day: 1 })])
    ).toBe(0);
    // Corrupt data must not poison the reserve figure.
    expect(
      deriveMonthlyExpenses([rule("bad", Number.NaN, { type: "monthly", day: 1 })])
    ).toBe(0);
  });
});

describe("computeReserveTarget", () => {
  it("defaults to six months of expenses", () => {
    expect(DEFAULT_RESERVE_MONTHS).toBe(6);
    expect(computeReserveTarget(4_000)).toBeCloseTo(24_000, 6);
  });

  it("honours a custom number of months", () => {
    expect(computeReserveTarget(4_000, 3)).toBeCloseTo(12_000, 6);
    expect(computeReserveTarget(4_000, 12)).toBeCloseTo(48_000, 6);
  });

  it("never returns a negative or non-finite target", () => {
    expect(computeReserveTarget(-100)).toBe(0);
    expect(computeReserveTarget(Number.NaN)).toBe(0);
    expect(computeReserveTarget(4_000, -2)).toBe(0);
    expect(computeReserveTarget(4_000, Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("computeSurplus", () => {
  it("is what remains after the reserve is fully funded", () => {
    const s = computeSurplus({ parkedCash: 120_000, monthlyExpenses: 8_000 });
    expect(s.reserveTarget).toBeCloseTo(48_000, 6);
    expect(s.surplus).toBeCloseTo(72_000, 6);
    expect(s.reserveShortfall).toBe(0);
    expect(s.reserveMonths).toBe(6);
  });

  it("reports a shortfall and zero surplus when the reserve is underfunded", () => {
    // The card must never suggest allocating money that is still holding the
    // roof up. Under-reserved means surplus is exactly zero, not negative.
    const s = computeSurplus({ parkedCash: 20_000, monthlyExpenses: 8_000 });
    expect(s.reserveTarget).toBeCloseTo(48_000, 6);
    expect(s.surplus).toBe(0);
    expect(s.reserveShortfall).toBeCloseTo(28_000, 6);
  });

  it("honours a custom number of months", () => {
    const s = computeSurplus({
      parkedCash: 120_000,
      monthlyExpenses: 8_000,
      reserveMonths: 3,
    });
    expect(s.reserveMonths).toBe(3);
    expect(s.reserveTarget).toBeCloseTo(24_000, 6);
    expect(s.surplus).toBeCloseTo(96_000, 6);
  });

  it("falls back to six months when the month count is unusable", () => {
    for (const reserveMonths of [0, -3, Number.NaN, Number.POSITIVE_INFINITY]) {
      const s = computeSurplus({
        parkedCash: 120_000,
        monthlyExpenses: 8_000,
        reserveMonths,
      });
      expect(s.reserveMonths).toBe(6);
      expect(s.reserveTarget).toBeCloseTo(48_000, 6);
    }
  });

  it("lets the reserve be set as an explicit amount instead of months", () => {
    const s = computeSurplus({
      parkedCash: 120_000,
      monthlyExpenses: 8_000,
      reserveOverride: 30_000,
    });
    expect(s.reserveTarget).toBeCloseTo(30_000, 6);
    expect(s.surplus).toBeCloseTo(90_000, 6);
  });

  it("treats an unusable override as absent rather than as zero reserve", () => {
    // Falling back to "no reserve at all" would show the entire balance as
    // free to invest, which is the most dangerous possible failure mode.
    const s = computeSurplus({
      parkedCash: 120_000,
      monthlyExpenses: 8_000,
      reserveOverride: Number.NaN,
    });
    expect(s.reserveTarget).toBeCloseTo(48_000, 6);
  });

  it("clamps a nonsensical parked balance to zero", () => {
    for (const parkedCash of [-5_000, 0, Number.NaN]) {
      const s = computeSurplus({ parkedCash, monthlyExpenses: 1_000 });
      expect(s.parkedCash).toBe(0);
      expect(s.surplus).toBe(0);
    }
  });

  it("cannot size a reserve from unusable expenses, and says so with zero", () => {
    // No expense figure means no reserve can be derived. Reporting a zero
    // target is honest; the UI treats it as "unknown", not "none needed".
    for (const monthlyExpenses of [0, -100, Number.NaN]) {
      const s = computeSurplus({ parkedCash: 50_000, monthlyExpenses });
      expect(s.monthlyExpenses).toBe(0);
      expect(s.reserveTarget).toBe(0);
    }
  });

  it("accepts an explicit reserve of exactly zero", () => {
    const s = computeSurplus({
      parkedCash: 50_000,
      monthlyExpenses: 4_000,
      reserveOverride: 0,
    });
    expect(s.reserveTarget).toBe(0);
    expect(s.surplus).toBeCloseTo(50_000, 6);
  });

  it("treats a negative override as absent", () => {
    const s = computeSurplus({
      parkedCash: 120_000,
      monthlyExpenses: 8_000,
      reserveOverride: -1,
    });
    expect(s.reserveTarget).toBeCloseTo(48_000, 6);
  });
});

describe("computePrepaymentHurdleRate", () => {
  const rate = 0.0475;

  it("equals the mortgage rate exactly when gains are untaxed", () => {
    // With no tax drag the two paths compound identically, so the bar to
    // clear is simply the mortgage rate. This is the formula's anchor.
    for (const years of [1, 5, 20, 30]) {
      expect(computePrepaymentHurdleRate(rate, years, 0)).toBeCloseTo(rate, 10);
    }
  });

  it("matches a direct simulation of both paths", () => {
    // Independent check: grow a dollar in each path for T years and confirm
    // that investing at the hurdle rate lands exactly where prepaying does.
    const years = 20.5;
    const tax = 0.2517;
    const hurdle = computePrepaymentHurdleRate(rate, years, tax);

    const prepayEndsAt = Math.pow(1 + rate, years);
    const grossInvested = Math.pow(1 + hurdle, years);
    const investEndsAt = 1 + (grossInvested - 1) * (1 - tax);

    expect(investEndsAt).toBeCloseTo(prepayEndsAt, 10);
  });

  it("gives the household's own numbers", () => {
    // 4.75% loan, ~20.5 years left after biweekly payments, long-term gains
    // taxed at 18.8% federal (15% + 3.8% NIIT) plus 6.37% NJ.
    expect(computePrepaymentHurdleRate(rate, 20.5, 0.2517)).toBeCloseTo(
      0.05714,
      4
    );
  });

  it("rises as the loan gets closer to payoff", () => {
    // Less time left means less time for tax deferral to work, so the market
    // has to clear a HIGHER bar late in the loan than early. Getting the
    // direction backwards here would invert the advice the card gives.
    const tax = 0.2517;
    const long = computePrepaymentHurdleRate(rate, 20.5, tax);
    const short = computePrepaymentHurdleRate(rate, 5, tax);
    expect(short).toBeGreaterThan(long);
    expect(short).toBeCloseTo(0.06170, 4);
  });

  it("rises with the tax rate", () => {
    const low = computePrepaymentHurdleRate(rate, 20, 0.15);
    const high = computePrepaymentHurdleRate(rate, 20, 0.35);
    expect(high).toBeGreaterThan(low);
    expect(low).toBeGreaterThan(rate);
  });

  it("stays finite for degenerate horizons and rates", () => {
    // A zero-length horizon has no meaningful hurdle; return the mortgage
    // rate rather than dividing by zero and rendering "NaN%" to the user.
    expect(computePrepaymentHurdleRate(rate, 0, 0.25)).toBe(rate);
    expect(computePrepaymentHurdleRate(rate, -3, 0.25)).toBe(rate);
    expect(computePrepaymentHurdleRate(rate, 20, 1)).toBe(
      Number.POSITIVE_INFINITY
    );
    expect(Number.isFinite(computePrepaymentHurdleRate(0, 20, 0.25))).toBe(true);
  });
});
