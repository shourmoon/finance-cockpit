// src/domain/resilienceInvariants.test.ts
//
// The fourth invariant suite, over the last money-adjacent module without
// one. Coverage metrics do not move money, but they are the card the user
// reads to answer "did one salary actually cover us?" — so a wrong number
// here is a wrong belief about the household's resilience, which is the
// thing this app exists to inform.
//
// See CLAUDE.md, "The checklist for money code". The rule that matters most
// here is the second one: every expectation below is derived from the raw
// generated transactions and the raw options, never from the output of
// computeCoverageMetrics. The window is even recomputed by a deliberately
// different method (Date.UTC month rollover) than the integer month
// arithmetic the implementation uses, so the two cannot drift together.

import { describe, it, expect } from "vitest";
import { computeCoverageMetrics } from "./resilience";
import type { CoverageOptions } from "./resilience";
import type { AdhocTransaction } from "./types";

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
 * The months the window must cover, computed independently of the
 * implementation: Date.UTC rolls a negative month index into the previous
 * year, where `resilience.ts` does the same job with integer division. If
 * both are right they agree; if either drifts, they diverge.
 */
function windowKeys(asOf: string, windowMonths: number): string[] {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const keys: string[] = [];
  for (let i = windowMonths - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
    );
  }
  return keys;
}

/** Sum the raw transactions that belong to a month, straight from the input. */
function rawSum(txns: readonly AdhocTransaction[], key: string): number {
  let sum = 0;
  for (const t of txns) {
    if (t.kind !== "topUp") continue;
    if (typeof t.date !== "string" || t.date.slice(0, 7) !== key) continue;
    if (!Number.isFinite(t.amount) || t.amount <= 0) continue;
    sum += t.amount;
  }
  return sum;
}

/** A stored transaction, possibly still carrying a retired `reason`. */
type StoredTransaction = AdhocTransaction & { reason?: string };

interface Case {
  txns: StoredTransaction[];
  options: CoverageOptions;
  /** windowMonths with the default applied — the raw intent, not an output. */
  window: number;
  /** The tracking month key, or null when there is no usable tracking date. */
  trackingMonth: string | null;
}

function generateCase(r: () => number): Case {
  const asOfY = 2025 + Math.floor(r() * 3);
  const asOfM = 1 + Math.floor(r() * 12);
  const asOf = iso(asOfY, asOfM, 1 + Math.floor(r() * 28));

  // A window that sometimes takes the default and sometimes does not.
  const window = r() < 0.3 ? 12 : 1 + Math.floor(r() * 24);

  // Tracking sometimes absent, sometimes well before the window, sometimes
  // inside it (the interesting case), sometimes after asOf entirely.
  const roll = r();
  let trackingSince: string | undefined;
  if (roll < 0.15) trackingSince = undefined;
  else {
    const shift = Math.floor(r() * 30) - 24; // -24..+5 months from asOf
    const abs = asOfY * 12 + (asOfM - 1) + shift;
    trackingSince = iso(
      Math.floor(abs / 12),
      (abs % 12) + 1,
      1 + Math.floor(r() * 28)
    );
  }

  const txns: StoredTransaction[] = [];
  const count = Math.floor(r() * 14);
  for (let i = 0; i < count; i++) {
    // Dates spread well past the window in both directions, so the law that
    // out-of-window money is ignored has something to bite on.
    const shift = Math.floor(r() * 40) - 32;
    const abs = asOfY * 12 + (asOfM - 1) + shift;
    const kindRoll = r();
    const amountRoll = r();
    txns.push({
      id: `t${i}`,
      name: r() < 0.5 ? "Top Up" : "Transfer from savings",
      // Zero, negative and ordinary positive amounts all appear.
      amount:
        amountRoll < 0.1
          ? 0
          : amountRoll < 0.2
            ? -Math.floor(r() * 3000)
            : Math.floor(r() * 4000) + 1,
      date: iso(
        Math.floor(abs / 12),
        (abs % 12) + 1,
        1 + Math.floor(r() * 28)
      ),
      // A quarter carry no top-up marker at all: ordinary spending that
      // happens to be named like a transfer. Of the rest, most carry a
      // retired `reason` from a state written before the two kinds were
      // merged — exactly what upgraded data looks like, and none of it may
      // move a figure.
      ...(kindRoll < 0.25
        ? {}
        : {
            kind: "topUp" as const,
            ...(kindRoll < 0.6
              ? { reason: "shortfall" }
              : kindRoll < 0.85
                ? { reason: "oneOff" }
                : {}),
          }),
    });
  }

  const salaryRoll = r();
  const options: CoverageOptions = {
    asOf,
    trackingSince,
    windowMonths: window,
    secondSalaryMonthly:
      salaryRoll < 0.3
        ? undefined
        : salaryRoll < 0.4
          ? 0
          : Math.floor(r() * 9000) + 500,
  };

  return {
    txns,
    options,
    window,
    trackingMonth: trackingSince ? trackingSince.slice(0, 7) : null,
  };
}

const CASES = (() => {
  const r = rng(20260806);
  return Array.from({ length: 140 }, () => generateCase(r));
})();

/** Is this month key inside the window and after tracking began? */
function counted(c: Case, key: string): boolean {
  return (
    windowKeys(c.options.asOf, c.window).includes(key) &&
    (c.trackingMonth === null || key >= c.trackingMonth)
  );
}

describe("coverage invariants (property-based)", () => {
  it("covers exactly the months asked for, contiguous and ending at asOf", () => {
    for (const c of CASES) {
      const { months } = computeCoverageMetrics(c.txns, c.options);
      const expected = windowKeys(c.options.asOf, c.window);

      expect(months.map((b) => b.monthKey)).toEqual(expected);
      expect(months).toHaveLength(c.window);
      expect(months[months.length - 1].monthKey).toBe(c.options.asOf.slice(0, 7));

      // Contiguous, ascending, one month apart — checked in absolute month
      // index so a year boundary cannot hide a gap.
      const idx = months.map((b) => {
        const [y, m] = b.monthKey.split("-").map(Number);
        return y * 12 + (m - 1);
      });
      for (let i = 1; i < idx.length; i++) expect(idx[i] - idx[i - 1]).toBe(1);
    }
  });

  it("marks exactly one month in progress: the one asOf falls in", () => {
    for (const c of CASES) {
      const { months } = computeCoverageMetrics(c.txns, c.options);
      const open = months.filter((b) => !b.complete);
      expect(open).toHaveLength(1);
      expect(open[0].monthKey).toBe(c.options.asOf.slice(0, 7));
    }
  });

  it("buckets every counted top-up, and only counted top-ups", () => {
    // Conservation, against the raw input. Each bucket must equal the sum of
    // the generated transactions that belong in it — not a re-derivation from
    // anything the function returned.
    for (const c of CASES) {
      const { months } = computeCoverageMetrics(c.txns, c.options);
      for (const b of months) {
        const drawn = b.known ? rawSum(c.txns, b.monthKey) : 0;
        expect(b.total, `${b.monthKey} total`).toBeCloseTo(drawn, 6);
      }
    }
  });

  it("treats pre-tracking months as unknown, never as clean", () => {
    // The whole point of trackingSince: the app was not recording then, so a
    // month with no data must not be counted as a month that needed nothing.
    for (const c of CASES) {
      const { months, knownMonths } = computeCoverageMetrics(c.txns, c.options);
      let known = 0;
      for (const b of months) {
        const shouldKnow =
          c.trackingMonth === null || b.monthKey >= c.trackingMonth;
        expect(b.known, `${b.monthKey} known`).toBe(shouldKnow);
        if (shouldKnow) known += 1;
        else expect(b.total).toBe(0);
      }
      expect(knownMonths).toBe(known);
    }
  });

  it("ignores money outside the window entirely", () => {
    // Differential: drop every transaction the window cannot see and the
    // answer must be identical. Catches an off-by-one at either edge.
    for (const c of CASES) {
      const keys = new Set(windowKeys(c.options.asOf, c.window));
      const inside = c.txns.filter((t) => keys.has(t.date.slice(0, 7)));
      expect(JSON.stringify(computeCoverageMetrics(inside, c.options))).toBe(
        JSON.stringify(computeCoverageMetrics(c.txns, c.options))
      );
    }
  });

  it("counts nothing that is not an explicitly marked top-up", () => {
    // v3 deliberately does not backfill by name (CLAUDE.md). A transaction
    // called "Top Up" with no marker is ordinary money and must stay
    // invisible here, no matter how large or where it lands.
    for (const c of CASES) {
      const base = computeCoverageMetrics(c.txns, c.options);
      const decoys: AdhocTransaction[] = windowKeys(
        c.options.asOf,
        c.window
      ).map((key, i) => ({
        id: `decoy${i}`,
        name: i % 2 ? "Top Up" : "Transfer from savings",
        amount: 25_000,
        date: `${key}-15`,
      }));
      expect(
        JSON.stringify(computeCoverageMetrics([...c.txns, ...decoys], c.options))
      ).toBe(JSON.stringify(base));
    }
  });

  it("ignores top-ups that are not positive amounts of money", () => {
    for (const c of CASES) {
      const base = computeCoverageMetrics(c.txns, c.options);
      const key = c.options.asOf.slice(0, 7);
      const junk = [0, -1, -5000, NaN, Infinity, -Infinity].map((amount, i) => ({
        id: `junk${i}`,
        name: "Top Up",
        amount,
        date: `${key}-10`,
        kind: "topUp" as const,
      }));
      expect(
        JSON.stringify(computeCoverageMetrics([...c.txns, ...junk], c.options))
      ).toBe(JSON.stringify(base));
    }
  });

  it("adds a new top-up to exactly one month, and nowhere else", () => {
    for (const c of CASES) {
      const keys = windowKeys(c.options.asOf, c.window);
      const key = keys[Math.floor(keys.length / 2)];
      const before = computeCoverageMetrics(c.txns, c.options);
      const extra: AdhocTransaction = {
        id: "extra",
        name: "Top Up",
        amount: 1234.56,
        date: `${key}-12`,
        kind: "topUp",
      };
      const after = computeCoverageMetrics([...c.txns, extra], c.options);

      const lands = counted(c, key);
      expect(after.totalToppedUp - before.totalToppedUp).toBeCloseTo(
        lands ? 1234.56 : 0,
        6
      );
      expect(after.months).toHaveLength(before.months.length);
      for (let i = 0; i < after.months.length; i++) {
        const delta = after.months[i].total - before.months[i].total;
        expect(delta).toBeCloseTo(
          lands && after.months[i].monthKey === key ? 1234.56 : 0,
          6
        );
      }
    }
  });

  it("splits every known month into clean or assisted, with nothing left over", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);
      const known = m.months.filter((b) => b.known);
      const assisted = known.filter((b) => b.total > 0).length;
      expect(m.cleanMonths + assisted).toBe(m.knownMonths);
      expect(m.knownMonths).toBeLessThanOrEqual(m.months.length);
      expect(m.totalToppedUp).toBeCloseTo(
        known.reduce((s, b) => s + b.total, 0),
        6
      );
      expect(m.totalToppedUp).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports streaks that are real runs of clean known months", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);

      // Recomputed by brute force over the buckets: longest run, and the
      // run trailing the end. An unknown month breaks a run — it is not
      // evidence of coverage, so it cannot extend one.
      let run = 0;
      let best = 0;
      for (const b of m.months) {
        run = b.known && b.total === 0 ? run + 1 : 0;
        best = Math.max(best, run);
      }
      let current = 0;
      for (let i = m.months.length - 1; i >= 0; i--) {
        const b = m.months[i];
        if (!b.known || b.total !== 0) break;
        current += 1;
      }

      expect(m.streakBest).toBe(best);
      expect(m.streakCurrent).toBe(current);
      expect(m.streakCurrent).toBeLessThanOrEqual(m.streakBest);
      expect(m.streakBest).toBeLessThanOrEqual(m.cleanMonths);
      expect(m.cleanMonths).toBeLessThanOrEqual(m.knownMonths);
    }
  });

  it("averages the gap over the months it actually knows about", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);
      if (m.knownMonths === 0) {
        expect(m.averageMonthlyGap).toBe(0);
        expect(m.totalToppedUp).toBe(0);
      } else {
        expect(m.averageMonthlyGap * m.knownMonths).toBeCloseTo(
          m.totalToppedUp,
          6
        );
      }
      expect(m.averageMonthlyGap).toBeGreaterThanOrEqual(0);
    }
  });

  it("reports a typical top-up only when some month needed one", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);
      const assisted = m.months
        .filter((b) => b.known && b.total > 0)
        .map((b) => b.total);

      if (assisted.length === 0) {
        expect(m.typicalTopUp).toBeNull();
        expect(m.totalToppedUp).toBe(0);
        continue;
      }
      expect(m.typicalTopUp).not.toBeNull();
      const typical = m.typicalTopUp as number;
      expect(typical).toBeGreaterThan(0);
      expect(typical).toBeGreaterThanOrEqual(Math.min(...assisted));
      expect(typical).toBeLessThanOrEqual(Math.max(...assisted));
      // A median splits the sample: at least half sit on either side of it.
      expect(assisted.filter((v) => v <= typical).length * 2).toBeGreaterThanOrEqual(
        assisted.length
      );
      expect(assisted.filter((v) => v >= typical).length * 2).toBeGreaterThanOrEqual(
        assisted.length
      );
    }
  });

  it("reports a typical top-up that mirrors when the sample is mirrored", () => {
    // The middle of the sample, not merely one of the two middle values.
    // Reflect every month's draw about the sample's own centre and the
    // typical draw must reflect with it. An "upper median" convention
    // satisfies every bound and split check above and fails this one — and
    // on an even number of assisted months it would quietly overstate what
    // a typical top-up costs.
    const r = rng(424242);
    for (let n = 1; n <= 8; n++) {
      const amounts = Array.from(
        { length: n },
        () => Math.floor(r() * 4000) + 100
      );
      const centre = Math.min(...amounts) + Math.max(...amounts);
      const build = (xs: number[]): AdhocTransaction[] =>
        xs.map((amount, i) => ({
          id: `m${i}`,
          name: "Top Up",
          amount,
          date: `2026-${String(i + 1).padStart(2, "0")}-15`,
          kind: "topUp" as const,
          }));
      const options: CoverageOptions = {
        asOf: `2026-${String(n).padStart(2, "0")}-20`,
        windowMonths: n,
        trackingSince: "2026-01-01",
      };

      const straight = computeCoverageMetrics(build(amounts), options);
      const mirrored = computeCoverageMetrics(
        build(amounts.map((a) => centre - a)),
        options
      );
      expect(straight.typicalTopUp).not.toBeNull();
      expect(mirrored.typicalTopUp as number).toBeCloseTo(
        centre - (straight.typicalTopUp as number),
        6
      );
    }
  });

  it("reports the second salary preserved only when it can be computed", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);
      const salary = c.options.secondSalaryMonthly;
      const computable =
        salary !== undefined &&
        Number.isFinite(salary) &&
        salary > 0 &&
        m.knownMonths > 0;

      if (!computable) {
        expect(m.secondSalaryKept).toBeNull();
        continue;
      }
      const exposure = (salary as number) * m.knownMonths;
      expect(m.secondSalaryKept).not.toBeNull();
      expect(Number.isFinite(m.secondSalaryKept as number)).toBe(true);
      expect(m.secondSalaryKept as number).toBeCloseTo(
        ((exposure - m.totalToppedUp) / exposure) * 100,
        6
      );
      // Cannot keep more than all of it, and keeps all of it exactly when
      // nothing was drawn.
      expect(m.secondSalaryKept as number).toBeLessThanOrEqual(100 + 1e-9);
      expect((m.secondSalaryKept as number) === 100).toBe(m.totalToppedUp === 0);
    }
  });

  it("produces finite, non-negative numbers throughout", () => {
    for (const c of CASES) {
      const m = computeCoverageMetrics(c.txns, c.options);
      for (const b of m.months) {
        expect(Number.isFinite(b.total)).toBe(true);
        expect(b.total).toBeGreaterThanOrEqual(0);
      }
      for (const v of [
        m.knownMonths,
        m.cleanMonths,
        m.totalToppedUp,
        m.averageMonthlyGap,
        m.streakCurrent,
        m.streakBest,
      ]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("does not depend on the order of the transactions, or mutate them", () => {
    for (const c of CASES) {
      const snapshot = JSON.stringify(c.txns);
      const straight = computeCoverageMetrics(c.txns, c.options);
      const shuffled = [...c.txns].reverse();
      expect(JSON.stringify(computeCoverageMetrics(shuffled, c.options))).toBe(
        JSON.stringify(straight)
      );
      // Called twice, same answer; input untouched.
      expect(JSON.stringify(computeCoverageMetrics(c.txns, c.options))).toBe(
        JSON.stringify(straight)
      );
      expect(JSON.stringify(c.txns)).toBe(snapshot);
    }
  });
});

describe("coverage invariants — degenerate and hostile inputs", () => {
  const REAL: AdhocTransaction[] = [
    {
      id: "t1",
      name: "Top Up",
      amount: 900,
      date: "2026-07-02",
      kind: "topUp",
    },
  ];

  /**
   * A result that claims nothing. Reporting no months is honest when the
   * inputs cannot say anything; reporting a clean month is not.
   */
  function expectEmpty(m: ReturnType<typeof computeCoverageMetrics>) {
    expect(m.months).toEqual([]);
    expect(m.knownMonths).toBe(0);
    expect(m.cleanMonths).toBe(0);
    expect(m.totalToppedUp).toBe(0);
    expect(m.averageMonthlyGap).toBe(0);
    expect(m.typicalTopUp).toBeNull();
    expect(m.streakCurrent).toBe(0);
    expect(m.streakBest).toBe(0);
    expect(m.secondSalaryKept).toBeNull();
  }

  it("claims no coverage at all when it does not know what today is", () => {
    // Reachable: clearing the Start date input leaves settings.startDate as
    // "", and the dashboard passes it straight through as asOf. Inventing a
    // clean month there would tell the user one salary covered a month that
    // was never measured — the exact opposite of the card's purpose.
    for (const asOf of ["", "garbage", "2026-13-01", "2026-02-30", "not-a-date"]) {
      expectEmpty(
        computeCoverageMetrics(REAL, {
          asOf,
          trackingSince: "2025-09-01",
          secondSalaryMonthly: 4000,
        })
      );
    }
  });

  it("claims no coverage when the window is empty or nonsensical", () => {
    for (const windowMonths of [0, -3, NaN, 0.4, Infinity]) {
      expectEmpty(
        computeCoverageMetrics(REAL, {
          asOf: "2026-08-06",
          windowMonths,
          secondSalaryMonthly: 4000,
        })
      );
    }
  });

  it("treats an unusable tracking date as no tracking date", () => {
    const withNone = computeCoverageMetrics(REAL, { asOf: "2026-08-06" });
    for (const trackingSince of ["", "garbage", "2026-02-30"]) {
      expect(
        JSON.stringify(
          computeCoverageMetrics(REAL, {
              asOf: "2026-08-06",
            trackingSince,
          })
        )
      ).toBe(JSON.stringify(withNone));
    }
  });

  it("knows nothing when tracking has not started yet", () => {
    const m = computeCoverageMetrics(REAL, {
      asOf: "2026-08-06",
      trackingSince: "2027-01-01",
      secondSalaryMonthly: 4000,
    });
    expect(m.months).toHaveLength(12);
    expect(m.months.every((b) => !b.known)).toBe(true);
    expect(m.knownMonths).toBe(0);
    expect(m.cleanMonths).toBe(0);
    expect(m.totalToppedUp).toBe(0);
    expect(m.averageMonthlyGap).toBe(0);
    expect(m.typicalTopUp).toBeNull();
    expect(m.streakCurrent).toBe(0);
    expect(m.streakBest).toBe(0);
    // No known exposure, so no share of a salary can be claimed as kept.
    expect(m.secondSalaryKept).toBeNull();
  });

  it("survives transactions of the wrong shape entirely", () => {
    const GARBAGE = [
      null,
      undefined,
      42,
      "top up",
      [],
      {},
      { id: "x" },
      { kind: "topUp" },
      { kind: "topUp", amount: 100 },
      { kind: "topUp", amount: 100, date: null },
      { kind: "topUp", amount: 100, date: 20260701 },
      { kind: "topUp", amount: "100", date: "2026-07-01" },
      { kind: "topUp", amount: 100, date: "2026-07-01", reason: 7 },
    ] as unknown as AdhocTransaction[];

    const m = computeCoverageMetrics(GARBAGE, {
      asOf: "2026-08-06",
      trackingSince: "2025-09-01",
      secondSalaryMonthly: 4000,
    });
    expect(m.months).toHaveLength(12);
    for (const b of m.months) {
      expect(Number.isFinite(b.total)).toBe(true);
      expect(b.total).toBeGreaterThanOrEqual(0);
    }
    expect(Number.isFinite(m.totalToppedUp)).toBe(true);
    expect(Number.isFinite(m.averageMonthlyGap)).toBe(true);
    expect(Number.isFinite(m.secondSalaryKept as number)).toBe(true);
  });

  it("ignores a second salary that is not a real amount", () => {
    for (const secondSalaryMonthly of [0, -100, NaN, Infinity]) {
      const m = computeCoverageMetrics(REAL, {
        asOf: "2026-08-06",
        trackingSince: "2025-09-01",
        secondSalaryMonthly,
      });
      expect(m.secondSalaryKept).toBeNull();
    }
  });

  it("handles a window that crosses a year boundary", () => {
    const m = computeCoverageMetrics(
      [
        { id: "a", name: "Top Up", amount: 500, date: "2025-12-20", kind: "topUp" },
        { id: "b", name: "Top Up", amount: 700, date: "2026-01-03", kind: "topUp" },
      ],
      { asOf: "2026-02-10", windowMonths: 4, trackingSince: "2025-01-01" }
    );
    expect(m.months.map((b) => b.monthKey)).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    // Adjacent days either side of the boundary land in different months.
    expect(m.months[1].total).toBe(500);
    expect(m.months[2].total).toBe(700);
    expect(m.totalToppedUp).toBe(1200);
  });
});
