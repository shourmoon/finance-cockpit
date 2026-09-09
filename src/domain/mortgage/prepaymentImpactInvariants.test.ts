// src/domain/mortgage/prepaymentImpactInvariants.test.ts
//
// The last money-adjacent surface without laws. Until now this computation
// lived inside MortgageTab.tsx as a useMemo, which is why it escaped: the
// invariant discipline is applied to `src/domain`, and logic sitting in a
// component is outside it by construction.
//
// What it computes is an attribution: given a list of prepayments already
// made, how much did EACH one save, both cumulatively against the
// no-prepayment baseline and incrementally over the prepayments before it.
// The table renders both figures side by side, which makes the central law
// a conservation one — the increments must telescope into the total, or the
// screen shows two numbers for one quantity.
//
// See CLAUDE.md, "The checklist for money code". Every expectation below is
// derived from the raw terms and the raw prepayment list, never from another
// call to the function under test, and the months laws recompute the
// period->month conversion from the frequency by hand rather than reusing
// `periodsToMonths`.

import { describe, it, expect } from "vitest";
import {
  computeBaselineMortgage,
  computeMortgageWithPrepayments,
} from "./index";
import type {
  MortgageOriginalTerms,
  PastPrepayment,
  PastPrepaymentLog,
} from "./types";
import { computePrepaymentImpacts } from "./prepaymentImpact";

/** Deterministic PRNG so any failure is reproducible from the seed. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * Months per payment period, worked out from the frequency by hand. The
 * implementation reaches for `periodsToMonths`; deriving it independently
 * here is what makes the units law able to disagree with it.
 */
function monthsPerPeriod(terms: MortgageOriginalTerms): number {
  return terms.paymentFrequency === "biweekly" ? 12 / 26 : 1;
}

interface Case {
  terms: MortgageOriginalTerms;
  prepayments: PastPrepaymentLog;
}

function generateCase(r: () => number): Case {
  const biweekly = r() < 0.4;
  const startY = 2015 + Math.floor(r() * 10);
  const terms: MortgageOriginalTerms = {
    principal: 50_000 + Math.floor(r() * 1_200_000),
    annualRate: r() * 0.09 + 0.005,
    termMonths: [120, 180, 240, 360][Math.floor(r() * 4)],
    startDate: iso(startY, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
    ...(biweekly ? { paymentFrequency: "biweekly" as const } : {}),
  };

  // Prepayments spread across (and sometimes past) the life of the loan, in
  // deliberately unsorted order so the ordering law has something to bite on.
  const count = Math.floor(r() * 6);
  const prepayments: PastPrepayment[] = Array.from({ length: count }, (_, i) => {
    const yearOffset = Math.floor(r() * (terms.termMonths / 12 + 3));
    return {
      date: iso(
        startY + yearOffset,
        1 + Math.floor(r() * 12),
        1 + Math.floor(r() * 28)
      ),
      // Mostly ordinary amounts, occasionally one large enough to overshoot
      // what is left owing.
      amount: r() < 0.15 ? terms.principal * (1 + r()) : Math.floor(r() * 90_000) + 1,
      ...(r() < 0.5 ? { note: `p${i}` } : {}),
    };
  });

  return { terms, prepayments };
}

const CASES = (() => {
  const r = rng(20260908);
  return Array.from({ length: 90 }, () => generateCase(r));
})();

/** The baseline for a case, computed here so laws can compare against it. */
function baselineOf(c: Case) {
  return computeBaselineMortgage(c.terms);
}

const MONEY_TOLERANCE = 1e-6;

describe("prepayment impact invariants (property-based)", () => {
  it("reports one row per prepayment, in date order, losing none of them", () => {
    // Conservation of the input itself. A row silently dropped is a
    // prepayment the household made that the table never credits.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));

      expect(rows).toHaveLength(c.prepayments.length);

      // Ascending by date, sorted independently of the implementation.
      const dates = rows.map((r) => r.date);
      expect(dates).toEqual([...dates].sort((a, b) => a.localeCompare(b)));

      // Same multiset of (date, amount, note) as went in.
      const key = (p: { date: string; amount: number; note?: string }) =>
        `${p.date}|${p.amount}|${p.note ?? ""}`;
      expect(rows.map(key).sort()).toEqual(c.prepayments.map(key).sort());
    }
  });

  it("telescopes: the increments sum to the final cumulative saving", () => {
    // THE law for this table. Both columns are rendered together, so if the
    // per-prepayment increments do not add up to the last row's total, the
    // screen is showing two different answers to one question.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      if (rows.length === 0) continue;

      const interestIncrements = rows.reduce(
        (s, r) => s + r.interestSavedIncremental,
        0
      );
      const monthsIncrements = rows.reduce(
        (s, r) => s + r.monthsSavedIncremental,
        0
      );

      expect(interestIncrements).toBeCloseTo(
        rows[rows.length - 1].interestSaved,
        6
      );
      expect(monthsIncrements).toBeCloseTo(
        rows[rows.length - 1].monthsSaved,
        6
      );
    }
  });

  it("credits the first prepayment with exactly what it saved on its own", () => {
    // The first row has no predecessor, so its incremental saving IS its
    // cumulative saving. An off-by-one in the running comparison shows up
    // here before it shows up anywhere else.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      if (rows.length === 0) continue;
      expect(rows[0].interestSavedIncremental).toBeCloseTo(rows[0].interestSaved, 6);
      expect(rows[0].monthsSavedIncremental).toBeCloseTo(rows[0].monthsSaved, 6);
    }
  });

  it("never reports a prepayment as costing money, or as saving more than exists", () => {
    // Impossibilities, independent of the implementation: paying down
    // principal early cannot increase the interest paid, and cannot save
    // more interest than the loan would ever have charged.
    for (const c of CASES) {
      const baseline = baselineOf(c);
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      const baselineMonths = baseline.schedule.length * monthsPerPeriod(c.terms);

      for (const row of rows) {
        expect(row.interestSaved).toBeGreaterThanOrEqual(-MONEY_TOLERANCE);
        expect(row.interestSaved).toBeLessThanOrEqual(
          baseline.totalInterest + MONEY_TOLERANCE
        );
        expect(row.monthsSaved).toBeGreaterThanOrEqual(-MONEY_TOLERANCE);
        expect(row.monthsSaved).toBeLessThanOrEqual(baselineMonths + MONEY_TOLERANCE);
        expect(Number.isFinite(row.interestSaved)).toBe(true);
        expect(Number.isFinite(row.monthsSaved)).toBe(true);
        expect(Number.isFinite(row.interestSavedIncremental)).toBe(true);
        expect(Number.isFinite(row.monthsSavedIncremental)).toBe(true);
      }
    }
  });

  it("never lets a later prepayment un-save what an earlier one saved", () => {
    // Cumulative savings run down the table, so they can only grow. A
    // prepayment that lands after payoff adds nothing and leaves them equal,
    // which is why this is non-decreasing rather than strictly increasing.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      for (let i = 1; i < rows.length; i++) {
        expect(rows[i].interestSaved).toBeGreaterThanOrEqual(
          rows[i - 1].interestSaved - MONEY_TOLERANCE
        );
        expect(rows[i].monthsSaved).toBeGreaterThanOrEqual(
          rows[i - 1].monthsSaved - MONEY_TOLERANCE
        );
        // ...which is the same as saying no increment is negative.
        expect(rows[i].interestSavedIncremental).toBeGreaterThanOrEqual(
          -MONEY_TOLERANCE
        );
        expect(rows[i].monthsSavedIncremental).toBeGreaterThanOrEqual(
          -MONEY_TOLERANCE
        );
      }
    }
  });

  it("measures the cumulative saving against the real no-prepayment path", () => {
    // Agreement between two modules: the cumulative figure on row i must be
    // what you get by running the prepayment engine over the first i+1
    // prepayments and differencing against the baseline. Derived from the
    // raw prepayment list, not from another row of the output.
    for (const c of CASES) {
      const baseline = baselineOf(c);
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      const sorted = [...c.prepayments].sort((a, b) => a.date.localeCompare(b.date));
      const perMonth = monthsPerPeriod(c.terms);

      for (let i = 0; i < rows.length; i++) {
        const actual = computeMortgageWithPrepayments(c.terms, sorted.slice(0, i + 1));
        expect(rows[i].interestSaved).toBeCloseTo(
          baseline.totalInterest - actual.totalInterest,
          6
        );
        expect(rows[i].monthsSaved).toBeCloseTo(
          (baseline.schedule.length - actual.schedule.length) * perMonth,
          6
        );
      }
    }
  });

  it("reports time saved in calendar months, not payment periods", () => {
    // Units. On a biweekly loan a period is 14 days, so a raw period count
    // overstates the saving by 26/12 — a year of shaved term would read as
    // "2 yrs 2 mos". This compares against the period count computed here.
    for (const c of CASES) {
      if (c.terms.paymentFrequency !== "biweekly") continue;
      const baseline = baselineOf(c);
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      const sorted = [...c.prepayments].sort((a, b) => a.date.localeCompare(b.date));

      for (let i = 0; i < rows.length; i++) {
        const actual = computeMortgageWithPrepayments(c.terms, sorted.slice(0, i + 1));
        const periodsSaved = baseline.schedule.length - actual.schedule.length;
        expect(rows[i].monthsSaved).toBeCloseTo(periodsSaved * (12 / 26), 6);
        // And an unconverted period count would be a different number
        // whenever anything was actually saved.
        if (periodsSaved > 0) {
          expect(rows[i].monthsSaved).not.toBeCloseTo(periodsSaved, 6);
        }
      }
    }
  });

  it("hands back every dollar the loan could not absorb, and no more", () => {
    // Conservation, the first line of the checklist. A prepayment larger than
    // what is still owed is refunded by the servicer, not kept — so the money
    // has to end up somewhere the table can show. Summed across the rows it
    // must equal what the engine reports for the whole log, computed here
    // from the raw prepayment list rather than from another row.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      if (rows.length === 0) continue;

      const sorted = [...c.prepayments].sort((a, b) => a.date.localeCompare(b.date));
      const wholeLog = computeMortgageWithPrepayments(c.terms, sorted);
      const totalUnapplied = wholeLog.unappliedPrepayments.reduce(
        (sum, u) => sum + u.amount,
        0
      );

      expect(rows.reduce((sum, r) => sum + r.unapplied, 0)).toBeCloseTo(
        totalUnapplied,
        6
      );
    }
  });

  it("never bounces back more than the prepayment itself was", () => {
    // You cannot get back more than you put in. Also: unapplied money is
    // never negative, which would read as the loan absorbing money that was
    // never offered.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      for (const row of rows) {
        expect(row.unapplied).toBeGreaterThanOrEqual(-MONEY_TOLERANCE);
        expect(row.unapplied).toBeLessThanOrEqual(
          Math.max(0, row.amount) + MONEY_TOLERANCE
        );
        expect(Number.isFinite(row.unapplied)).toBe(true);
      }
    }
  });

  it("credits a prepayment that saved nothing with having been absorbed by nothing", () => {
    // The pair that matters on screen: a row showing no saving must explain
    // itself. Either the loan took the money and it bought nothing (a
    // zero-amount prepayment), or the loan could not take it at all — in
    // which case the whole amount comes back. A row with a positive amount,
    // no saving, and no money returned would be money that vanished.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      for (const row of rows) {
        if (row.amount <= 0) continue;
        const boughtNothing =
          Math.abs(row.interestSavedIncremental) < 1e-9 &&
          Math.abs(row.monthsSavedIncremental) < 1e-9;
        if (!boughtNothing) continue;
        expect(row.unapplied).toBeCloseTo(row.amount, 6);
      }
    }
  });

  it("does not depend on the order the prepayments were entered", () => {
    // The table is chronological regardless of entry order, so shuffling the
    // input must not move a single figure.
    for (const c of CASES) {
      const baseline = baselineOf(c);
      const straight = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      const reversed = computePrepaymentImpacts(
        c.terms,
        [...c.prepayments].reverse(),
        baseline
      );
      expect(JSON.stringify(reversed)).toBe(JSON.stringify(straight));
    }
  });

  it("is pure: same answer twice, and the caller's list is untouched", () => {
    for (const c of CASES) {
      const snapshot = JSON.stringify(c.prepayments);
      const baseline = baselineOf(c);
      const once = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      const twice = computePrepaymentImpacts(c.terms, c.prepayments, baseline);
      expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      expect(JSON.stringify(c.prepayments)).toBe(snapshot);
    }
  });

  it("reports an effective rate that is a real rate, or none at all", () => {
    // The rate is rendered as a percentage next to the savings. A NaN or a
    // wild value there is a number the user may act on, and the IRR solver
    // returns 0 when it cannot bracket a root rather than throwing.
    for (const c of CASES) {
      const rows = computePrepaymentImpacts(c.terms, c.prepayments, baselineOf(c));
      for (const row of rows) {
        if (row.effectiveRate === null) continue;
        expect(Number.isFinite(row.effectiveRate)).toBe(true);
        expect(row.effectiveRate).toBeGreaterThanOrEqual(0);
        expect(row.effectiveRate).toBeLessThan(1);
      }
    }
  });
});

describe("prepayment impact — degenerate and hostile inputs", () => {
  const TERMS: MortgageOriginalTerms = {
    principal: 400_000,
    annualRate: 0.05,
    termMonths: 360,
    startDate: "2020-01-01",
  };

  it("reports nothing when nothing was prepaid", () => {
    expect(
      computePrepaymentImpacts(TERMS, [], computeBaselineMortgage(TERMS))
    ).toEqual([]);
  });

  it("credits a prepayment made after the loan is gone with nothing", () => {
    // The money was never owed, so it saved nothing. Reporting a saving
    // here would credit the household for a payment the loan never took.
    const payoff: PastPrepaymentLog = [
      { date: "2020-02-01", amount: 400_000 },
      { date: "2035-01-01", amount: 50_000 },
    ];
    const rows = computePrepaymentImpacts(
      TERMS,
      payoff,
      computeBaselineMortgage(TERMS)
    );
    expect(rows).toHaveLength(2);
    expect(rows[1].interestSavedIncremental).toBeCloseTo(0, 6);
    expect(rows[1].monthsSavedIncremental).toBeCloseTo(0, 6);
    // And the cumulative figure does not move either.
    expect(rows[1].interestSaved).toBeCloseTo(rows[0].interestSaved, 6);
    // The whole $50,000 comes back: the loan was already gone, so none of it
    // was ever owed. Showing the row as a no-op without saying where the
    // money went is how a table loses $50,000 in plain sight.
    expect(rows[1].unapplied).toBeCloseTo(50_000, 6);

    // The payoff prepayment overshoots too, by a little. This assertion was
    // written as "0" from memory and was wrong — the engine was right. By
    // 1 Feb one payment has already landed, so only $399,519.38 is owed, and
    // the scheduled principal ($482.62) has first claim on it; the extra can
    // only reach $399,036.76 of what is left. Hand-computed from the annuity
    // formula rather than from the engine:
    //   payment  = 400000 * (r / (1 - (1+r)^-360)),  r = 0.05/12  -> 2,147.29
    //   owing    = 400000 - (2147.29 - 400000*r)                  -> 399,519.38
    //   absorbed = owing - (2147.29 - owing*r)                    -> 399,036.76
    //   leftover = 400000 - absorbed                              ->     963.24
    expect(rows[0].unapplied).toBeCloseTo(963.24, 2);

    // And the two rows together account for every dollar the loan refused.
    const wholeLog = computeMortgageWithPrepayments(
      TERMS,
      [...payoff].sort((a, b) => a.date.localeCompare(b.date))
    );
    expect(rows[0].unapplied + rows[1].unapplied).toBeCloseTo(
      wholeLog.unappliedPrepayments.reduce((sum, u) => sum + u.amount, 0),
      6
    );
  });

  it("credits a zero-amount prepayment with nothing", () => {
    const rows = computePrepaymentImpacts(
      TERMS,
      [{ date: "2021-06-01", amount: 0 }],
      computeBaselineMortgage(TERMS)
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].interestSaved).toBeCloseTo(0, 6);
    expect(rows[0].monthsSaved).toBeCloseTo(0, 6);
  });

  it("handles several prepayments landing on the same date", () => {
    const sameDay: PastPrepaymentLog = [
      { date: "2021-06-01", amount: 10_000 },
      { date: "2021-06-01", amount: 15_000 },
    ];
    const rows = computePrepaymentImpacts(
      TERMS,
      sameDay,
      computeBaselineMortgage(TERMS)
    );
    expect(rows).toHaveLength(2);
    // Together they must account for the whole saving.
    expect(
      rows[0].interestSavedIncremental + rows[1].interestSavedIncremental
    ).toBeCloseTo(rows[1].interestSaved, 6);
  });

  it("never throws on a loan too small to have a schedule", () => {
    // Reachable from the UI: the principal field can be typed down to
    // nothing. The IRR solver throws on an empty schedule, and an
    // exception here takes the whole Mortgage tab down rather than
    // degrading one figure.
    const tiny: MortgageOriginalTerms = { ...TERMS, principal: 1e-9 };
    expect(() =>
      computePrepaymentImpacts(
        tiny,
        [{ date: "2020-06-01", amount: 500 }],
        computeBaselineMortgage(tiny)
      )
    ).not.toThrow();
  });

  it("never throws on a zero-rate loan", () => {
    const free: MortgageOriginalTerms = { ...TERMS, annualRate: 0 };
    const rows = computePrepaymentImpacts(
      free,
      [{ date: "2021-01-01", amount: 25_000 }],
      computeBaselineMortgage(free)
    );
    expect(rows).toHaveLength(1);
    // No interest exists, so none can be saved — but months still can be.
    expect(rows[0].interestSaved).toBeCloseTo(0, 6);
    expect(rows[0].monthsSaved).toBeGreaterThan(0);
  });
});
