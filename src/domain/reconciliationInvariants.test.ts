// src/domain/reconciliationInvariants.test.ts
//
// Laws for the one module whose whole job is to compare the app against
// something outside it. See CLAUDE.md, "The checklist for money code".
//
// The classes that bite hardest here are *direction* and *degenerate
// inputs*. A drift figure with the sign read the wrong way round is worse
// than no figure at all: it would tell someone their loan is smaller than
// the servicer says, or their account fuller than the bank says, in the
// calm voice of a verified number. So the direction laws below are phrased
// in terms of the household rather than the arithmetic — "reality is worse
// than the model said" — and checked for both targets, whose raw signs
// point opposite ways.

import { describe, it, expect } from "vitest";
import {
  assessDrift,
  assessFreshness,
  latestCheckpoint,
  summarizeCheckpoints,
  modelledMortgageOn,
  sanitizeCheckpoint,
  sanitizeCheckpoints,
  DEFAULT_TOLERANCE,
  DEFAULT_FRESHNESS,
} from "./reconciliation";
import type { Checkpoint, CheckpointTarget, DriftTolerance } from "./reconciliation";

/** Deterministic PRNG so any failure is reproducible from the seed. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const DAY = 86_400_000;
const isoFromEpochDay = (day: number): string =>
  new Date(day * DAY).toISOString().slice(0, 10);
const epochDayOf = (iso: string): number =>
  Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY);

const TARGETS: CheckpointTarget[] = ["cash", "mortgage"];

interface Case {
  target: CheckpointTarget;
  /** The raw figures each checkpoint was built from, kept alongside it. */
  raw: { date: string; actual: number; modelled: number }[];
  checkpoints: Checkpoint[];
  asOf: string;
  tolerance: DriftTolerance;
}

function generateCase(r: () => number): Case {
  const target = TARGETS[r() < 0.5 ? 0 : 1];
  // A window of real calendar days around a fixed anchor (2026-01-01).
  const anchor = epochDayOf("2026-01-01");
  const asOfDay = anchor + Math.floor(r() * 720);

  const raw: Case["raw"] = [];
  const count = Math.floor(r() * 9);
  for (let i = 0; i < count; i++) {
    // Statement dates land before, on and (rarely) after asOf.
    const day = asOfDay - Math.floor(r() * 400) + (r() < 0.08 ? 30 : 0);
    const modelled =
      target === "cash"
        ? Math.floor(r() * 40_000) - 5_000
        : Math.floor(r() * 700_000) + 1;
    // Most checks are close; some miss badly, in both directions.
    const miss =
      r() < 0.35 ? 0 : (r() < 0.5 ? -1 : 1) * Math.floor(r() * 9_000);
    raw.push({
      date: isoFromEpochDay(day),
      actual: modelled + miss,
      modelled,
    });
  }

  return {
    target,
    raw,
    checkpoints: raw.map((v, i) => ({ id: `c${i}`, ...v })),
    asOf: isoFromEpochDay(asOfDay),
    tolerance:
      r() < 0.5
        ? DEFAULT_TOLERANCE[target]
        : { absolute: Math.floor(r() * 400), relative: r() * 0.02 },
  };
}

const CASES = (() => {
  const r = rng(20260806);
  return Array.from({ length: 160 }, () => generateCase(r));
})();

describe("drift invariants (property-based)", () => {
  it("decomposes the difference exactly, from the raw figures", () => {
    for (const c of CASES) {
      for (const v of c.raw) {
        const d = assessDrift(c.target, v.actual, v.modelled, c.tolerance);
        expect(d.delta).toBeCloseTo(v.actual - v.modelled, 6);
        expect(d.magnitude).toBeCloseTo(Math.abs(v.actual - v.modelled), 6);
        expect(d.magnitude).toBeGreaterThanOrEqual(0);
        expect(d.relative).toBeCloseTo(
          v.modelled === 0 ? 0 : Math.abs(v.actual - v.modelled) / Math.abs(v.modelled),
          6
        );
        expect(Number.isFinite(d.relative)).toBe(true);
      }
    }
  });

  it("calls it optimistic exactly when reality is worse than the model", () => {
    // The law that stops a sign error from telling someone their loan is
    // smaller than it is. Stated about the household, not the subtraction.
    for (const c of CASES) {
      for (const v of c.raw) {
        const d = assessDrift(c.target, v.actual, v.modelled, c.tolerance);
        if (d.verdict === "match" || d.verdict === "unknown") continue;

        const realityIsWorse =
          c.target === "cash"
            ? v.actual < v.modelled // less money in the account than modelled
            : v.actual > v.modelled; // more debt outstanding than modelled
        expect(d.verdict).toBe(
          realityIsWorse ? "modelOptimistic" : "modelPessimistic"
        );
      }
    }
  });

  it("agrees with itself when nothing differs", () => {
    for (const c of CASES) {
      for (const v of c.raw) {
        const d = assessDrift(c.target, v.modelled, v.modelled, c.tolerance);
        expect(d.verdict).toBe("match");
        expect(d.delta).toBe(0);
        expect(d.magnitude).toBe(0);
        expect(d.relative).toBe(0);
      }
    }
  });

  it("flips direction when the two figures swap places", () => {
    for (const c of CASES) {
      for (const v of c.raw) {
        const forward = assessDrift(c.target, v.actual, v.modelled, c.tolerance);
        const back = assessDrift(c.target, v.modelled, v.actual, c.tolerance);
        expect(back.delta).toBeCloseTo(-forward.delta, 6);
        expect(back.magnitude).toBeCloseTo(forward.magnitude, 6);
        if (forward.verdict === "modelOptimistic") {
          expect(back.verdict).toBe("modelPessimistic");
        } else if (forward.verdict === "modelPessimistic") {
          expect(back.verdict).toBe("modelOptimistic");
        }
      }
    }
  });

  it("never turns agreement into a mismatch by loosening the tolerance", () => {
    for (const c of CASES) {
      for (const v of c.raw) {
        const tight = assessDrift(c.target, v.actual, v.modelled, {
          absolute: 0,
          relative: 0,
        });
        const loose = assessDrift(c.target, v.actual, v.modelled, {
          absolute: 1e9,
          relative: 1,
        });
        // Everything matches under an enormous tolerance...
        expect(loose.verdict).toBe("match");
        // ...and a mismatch under the loosest setting is impossible, so any
        // mismatch at all must already be one at zero tolerance.
        const mid = assessDrift(c.target, v.actual, v.modelled, c.tolerance);
        if (mid.verdict !== "match") expect(tight.verdict).not.toBe("match");
      }
    }
  });

  it("measures relative drift as a pure ratio, free of scale", () => {
    // Units: `relative` is a share, so multiplying both sides by a factor
    // must leave it alone. Only the absolute tolerance knows about scale.
    for (const c of CASES) {
      for (const v of c.raw) {
        if (v.modelled === 0) continue;
        for (const k of [0.5, 3, 1000]) {
          const base = assessDrift(c.target, v.actual, v.modelled, {
            absolute: 0,
            relative: 0.001,
          });
          const scaled = assessDrift(c.target, v.actual * k, v.modelled * k, {
            absolute: 0,
            relative: 0.001,
          });
          expect(scaled.relative).toBeCloseTo(base.relative, 9);
          expect(scaled.verdict).toBe(base.verdict);
        }
      }
    }
  });

  it("refuses to compare figures that are not numbers", () => {
    // "match" would read as "the model agrees". Anything unusable has to say
    // so, and must not leave NaN anywhere for the UI to render.
    for (const target of TARGETS) {
      for (const bad of [NaN, Infinity, -Infinity]) {
        for (const d of [
          assessDrift(target, bad, 1000),
          assessDrift(target, 1000, bad),
          assessDrift(target, bad, bad),
        ]) {
          expect(d.verdict).toBe("unknown");
          expect(Number.isFinite(d.delta)).toBe(true);
          expect(Number.isFinite(d.magnitude)).toBe(true);
          expect(Number.isFinite(d.relative)).toBe(true);
        }
      }
    }
  });

  it("forgives a difference of exactly the tolerance, and nothing beyond", () => {
    // "At or below" is the stated contract, and the boundary is where a
    // tolerance is most often wrong by one. Checked on both arms, since the
    // wider of the two is what decides.
    for (const target of TARGETS) {
      const absolute = { absolute: 50, relative: 0 };
      expect(assessDrift(target, 1_050, 1_000, absolute).verdict).toBe("match");
      expect(assessDrift(target, 1_050.01, 1_000, absolute).verdict).not.toBe(
        "match"
      );
      expect(assessDrift(target, 950, 1_000, absolute).verdict).toBe("match");
      expect(assessDrift(target, 949.99, 1_000, absolute).verdict).not.toBe(
        "match"
      );

      // 1% of 1,000 is 10, and the absolute arm is narrower, so the relative
      // one is what applies.
      const relative = { absolute: 1, relative: 0.01 };
      expect(assessDrift(target, 1_010, 1_000, relative).verdict).toBe("match");
      expect(assessDrift(target, 1_010.01, 1_000, relative).verdict).not.toBe(
        "match"
      );
    }
  });

  it("reports no ratio against a model that said zero", () => {
    // A share of nothing is not a number. It must not come back as Infinity
    // or NaN, and it must not be silently treated as a perfect match either
    // — the absolute difference is still real and still decides the verdict.
    for (const target of TARGETS) {
      const zeroed = assessDrift(target, 0, 0);
      expect(zeroed.relative).toBe(0);
      expect(zeroed.verdict).toBe("match");

      for (const actual of [500, -500]) {
        const d = assessDrift(target, actual, 0, { absolute: 1, relative: 0.5 });
        expect(d.relative).toBe(0);
        expect(Number.isFinite(d.relative)).toBe(true);
        expect(d.delta).toBe(actual);
        // A relative tolerance of half of nothing forgives nothing, so the
        // absolute one is all that is left and $500 clears it easily.
        expect(d.verdict).not.toBe("match");
      }
    }
  });

  it("survives a nonsensical staleness threshold rather than trusting it", () => {
    const checks = [{ id: "a", date: "2026-01-01", actual: 1, modelled: 1 }];
    for (const target of TARGETS) {
      for (const thresholds of [
        { aging: NaN, stale: NaN },
        { aging: Infinity, stale: Infinity },
      ]) {
        const f = assessFreshness(checks, target, "2029-01-01", thresholds);
        // With no usable threshold nothing can be declared stale, but the
        // age itself is still known and still true.
        expect(f.level).toBe("fresh");
        expect(f.ageDays).toBe(
          epochDayOf("2029-01-01") - epochDayOf("2026-01-01")
        );
      }
    }
  });

  it("survives a nonsensical tolerance rather than trusting it", () => {
    for (const target of TARGETS) {
      for (const tolerance of [
        { absolute: NaN, relative: NaN },
        { absolute: -100, relative: -1 },
        { absolute: Infinity, relative: Infinity },
      ] as DriftTolerance[]) {
        const d = assessDrift(target, 1000, 900, tolerance);
        expect(["match", "modelOptimistic", "modelPessimistic"]).toContain(
          d.verdict
        );
        expect(d.delta).toBe(100);
        expect(Number.isFinite(d.magnitude)).toBe(true);
      }
      // A tolerance of nothing means every difference counts.
      expect(
        assessDrift(target, 1000.01, 1000, { absolute: 0, relative: 0 }).verdict
      ).not.toBe("match");
    }
  });
});

describe("freshness invariants (property-based)", () => {
  it("ages from the most recent statement date, never the oldest", () => {
    for (const c of CASES) {
      const f = assessFreshness(c.checkpoints, c.target, c.asOf);
      if (c.raw.length === 0) {
        expect(f.level).toBe("unconfirmed");
        expect(f.ageDays).toBeNull();
        expect(f.lastConfirmed).toBeNull();
        continue;
      }
      // Computed straight from the raw dates.
      const newest = c.raw.map((v) => v.date).sort().pop() as string;
      expect(f.lastConfirmed).toBe(newest);
      expect(f.ageDays).toBe(
        Math.max(0, epochDayOf(c.asOf) - epochDayOf(newest))
      );
      expect(f.ageDays).toBeGreaterThanOrEqual(0);
    }
  });

  it("only ever gets staler as time passes", () => {
    // Timing: with the checkpoints fixed, moving "today" forward can never
    // make a figure fresher.
    const order = { fresh: 0, aging: 1, stale: 2, unconfirmed: -1 };
    for (const c of CASES) {
      if (c.raw.length === 0) continue;
      let prevAge = -1;
      let prevLevel = -1;
      for (const offset of [0, 1, 10, 30, 100, 400]) {
        const asOf = isoFromEpochDay(epochDayOf(c.asOf) + offset);
        const f = assessFreshness(c.checkpoints, c.target, asOf);
        expect(f.ageDays as number).toBeGreaterThanOrEqual(prevAge);
        expect(order[f.level]).toBeGreaterThanOrEqual(prevLevel);
        prevAge = f.ageDays as number;
        prevLevel = order[f.level];
      }
    }
  });

  it("crosses each threshold on the day the threshold says", () => {
    for (const target of TARGETS) {
      const { aging, stale } = DEFAULT_FRESHNESS[target];
      const confirmed = "2026-03-01";
      const at = (days: number) =>
        assessFreshness(
          [{ id: "a", date: confirmed, actual: 1, modelled: 1 }],
          target,
          isoFromEpochDay(epochDayOf(confirmed) + days)
        ).level;

      expect(at(0)).toBe("fresh");
      expect(at(aging)).toBe("fresh");
      expect(at(aging + 1)).toBe("aging");
      expect(at(stale)).toBe("aging");
      expect(at(stale + 1)).toBe("stale");
    }
  });

  it("cannot be freshened by an older check, or by an unusable one", () => {
    for (const c of CASES) {
      const base = assessFreshness(c.checkpoints, c.target, c.asOf);

      // An older statement adds no news.
      const older: Checkpoint = {
        id: "older",
        date: isoFromEpochDay(epochDayOf(c.asOf) - 5_000),
        actual: 1,
        modelled: 1,
      };
      const withOlder = assessFreshness(
        [...c.checkpoints, older],
        c.target,
        c.asOf
      );
      if (c.raw.length > 0) {
        expect(withOlder.ageDays).toBe(base.ageDays);
        expect(withOlder.lastConfirmed).toBe(base.lastConfirmed);
      }

      // Junk cannot reset the clock either.
      const junk = [
        { id: "j1", date: "not-a-date", actual: 1, modelled: 1 },
        { id: "j2", date: "2026-02-30", actual: 1, modelled: 1 },
      ] as Checkpoint[];
      const withJunk = summarizeCheckpoints(
        [...c.checkpoints, ...junk],
        c.target,
        c.asOf,
        c.tolerance
      );
      expect(withJunk.freshness).toEqual(base);
      expect(withJunk.count).toBe(c.raw.length);
    }
  });

  it("treats a statement dated ahead of today as confirmed now", () => {
    for (const target of TARGETS) {
      const f = assessFreshness(
        [{ id: "a", date: "2026-09-01", actual: 1, modelled: 1 }],
        target,
        "2026-08-06"
      );
      expect(f.ageDays).toBe(0);
      expect(f.level).toBe("fresh");
    }
  });
});

describe("summary invariants (property-based)", () => {
  it("counts, averages and worst-cases straight from the raw figures", () => {
    for (const c of CASES) {
      const s = summarizeCheckpoints(
        c.checkpoints,
        c.target,
        c.asOf,
        c.tolerance
      );
      const deltas = c.raw.map((v) => v.actual - v.modelled);

      expect(s.count).toBe(c.raw.length);
      expect(s.meanDelta * s.count).toBeCloseTo(
        deltas.reduce((a, b) => a + b, 0),
        4
      );
      expect(s.worstMagnitude).toBeCloseTo(
        deltas.reduce((m, d) => Math.max(m, Math.abs(d)), 0),
        6
      );
      expect(Number.isFinite(s.meanDelta)).toBe(true);
      expect(s.worstMagnitude).toBeGreaterThanOrEqual(0);

      if (c.raw.length === 0) {
        expect(s.latest).toBeNull();
        expect(s.latestDrift).toBeNull();
        expect(s.meanDelta).toBe(0);
        expect(s.systematic).toBe(false);
      } else {
        expect(s.latest).not.toBeNull();
        expect(s.worstMagnitude).toBeGreaterThanOrEqual(
          (s.latestDrift as { magnitude: number }).magnitude - 1e-9
        );
      }
    }
  });

  it("reports the latest check as the one with the newest statement date", () => {
    for (const c of CASES) {
      if (c.raw.length === 0) continue;
      const s = summarizeCheckpoints(c.checkpoints, c.target, c.asOf, c.tolerance);
      const newest = c.raw.map((v) => v.date).sort().pop() as string;
      expect((s.latest as Checkpoint).date).toBe(newest);
      // And its drift is that record's drift, not some other one's.
      const latest = s.latest as Checkpoint;
      expect((s.latestDrift as { delta: number }).delta).toBeCloseTo(
        latest.actual - latest.modelled,
        6
      );
    }
  });

  it("calls a pattern systematic only when every miss went the same way", () => {
    for (const c of CASES) {
      const s = summarizeCheckpoints(c.checkpoints, c.target, c.asOf, c.tolerance);
      const verdicts = c.raw
        .map((v) => assessDrift(c.target, v.actual, v.modelled, c.tolerance).verdict)
        .filter((v) => v !== "match");

      const expected =
        verdicts.length >= 3 && verdicts.every((v) => v === verdicts[0]);
      expect(s.systematic).toBe(expected);

      // A miss the other way is decisive evidence it was not systematic.
      if (s.systematic) {
        // The raw sign that means "worse" is the opposite for the two
        // targets, so the counter-example is built from the direction it
        // must have, not from a sign picked by hand.
        const want =
          verdicts[0] === "modelOptimistic" ? "modelPessimistic" : "modelOptimistic";
        const realityWorse = want === "modelOptimistic";
        const sign = (c.target === "mortgage") === realityWorse ? 1 : -1;
        const opposite: Checkpoint = {
          id: "opposite",
          date: c.asOf,
          modelled: 500_000,
          actual: 500_000 + sign * 1_000_000,
        };
        // The counter-example is only worth anything if it really points the
        // other way; assert that before drawing a conclusion from it.
        expect(
          assessDrift(c.target, opposite.actual, opposite.modelled, c.tolerance)
            .verdict
        ).toBe(want);

        const flipped = summarizeCheckpoints(
          [...c.checkpoints, opposite],
          c.target,
          c.asOf,
          c.tolerance
        );
        expect(flipped.systematic).toBe(false);
      }
    }
  });

  it("does not depend on the order the checks were recorded in", () => {
    for (const c of CASES) {
      const straight = summarizeCheckpoints(
        c.checkpoints,
        c.target,
        c.asOf,
        c.tolerance
      );
      const reversed = summarizeCheckpoints(
        [...c.checkpoints].reverse(),
        c.target,
        c.asOf,
        c.tolerance
      );
      expect(reversed.count).toBe(straight.count);
      expect(reversed.meanDelta).toBeCloseTo(straight.meanDelta, 6);
      expect(reversed.worstMagnitude).toBeCloseTo(straight.worstMagnitude, 6);
      expect(reversed.systematic).toBe(straight.systematic);
      expect(reversed.freshness.ageDays).toBe(straight.freshness.ageDays);
    }
  });

  it("survives checks of the wrong shape entirely", () => {
    const GARBAGE = [
      null,
      undefined,
      7,
      "checkpoint",
      [],
      {},
      { id: "a" },
      { id: "a", date: "2026-01-01" },
      { id: "a", date: "2026-01-01", actual: NaN, modelled: 1 },
      { id: "a", date: "2026-01-01", actual: 1, modelled: Infinity },
      { id: "", date: "2026-01-01", actual: 1, modelled: 1 },
    ] as unknown as Checkpoint[];

    for (const target of TARGETS) {
      const s = summarizeCheckpoints(GARBAGE, target, "2026-08-06");
      expect(s.count).toBe(0);
      expect(s.latest).toBeNull();
      expect(s.latestDrift).toBeNull();
      expect(s.meanDelta).toBe(0);
      expect(s.worstMagnitude).toBe(0);
      expect(s.systematic).toBe(false);
      expect(s.freshness.level).toBe("unconfirmed");
      expect(latestCheckpoint(GARBAGE)).toBeNull();
    }
  });

  it("says nothing when it does not know what today is", () => {
    for (const target of TARGETS) {
      for (const asOf of ["", "garbage", "2026-02-30"]) {
        const s = summarizeCheckpoints(
          [{ id: "a", date: "2026-01-01", actual: 100, modelled: 90 }],
          target,
          asOf
        );
        // The drift is still knowable — it needs no clock — but how old the
        // check is is not, and it must not be guessed.
        expect(s.count).toBe(1);
        expect(s.freshness.level).toBe("unconfirmed");
        expect(s.freshness.ageDays).toBeNull();
      }
    }
  });
});

describe("model lookup invariants (property-based)", () => {
  it("reads the loan balance left by the last payment on or before a date", () => {
    const r = rng(1234);
    for (let i = 0; i < 60; i++) {
      const principal = Math.floor(r() * 800_000) + 1_000;
      const first = epochDayOf("2026-01-01") + Math.floor(r() * 200);
      const n = 1 + Math.floor(r() * 40);

      // A real amortization shape: non-increasing, ending at zero.
      let remaining = principal;
      const schedule = Array.from({ length: n }, (_, k) => {
        remaining = k === n - 1 ? 0 : remaining * (0.9 + r() * 0.09);
        return { date: isoFromEpochDay(first + k * 30), remaining };
      });

      // Before the first payment nothing has been paid.
      expect(modelledMortgageOn(schedule, principal, isoFromEpochDay(first - 1)))
        .toBe(principal);

      // On and between payment dates, the last entry that has fallen due —
      // recomputed here by filtering rather than by walking.
      for (const offset of [0, 1, 15, 29, 30, 31, 400, 5_000]) {
        for (let k = 0; k < n; k++) {
          const date = isoFromEpochDay(first + k * 30 + offset);
          const due = schedule.filter((e) => e.date <= date);
          const expected = due.length ? due[due.length - 1].remaining : principal;
          expect(modelledMortgageOn(schedule, principal, date)).toBeCloseTo(
            expected,
            9
          );
        }
      }

      // Impossibility: a balance that never grows as time moves forward.
      let prev = Infinity;
      for (let d = -5; d < n * 30 + 60; d += 7) {
        const value = modelledMortgageOn(
          schedule,
          principal,
          isoFromEpochDay(first + d)
        ) as number;
        expect(value).toBeLessThanOrEqual(prev + 1e-9);
        expect(value).toBeGreaterThanOrEqual(0);
        prev = value;
      }

      // Long after payoff the loan is gone, not merely small.
      expect(
        modelledMortgageOn(schedule, principal, isoFromEpochDay(first + n * 30 + 9_000))
      ).toBe(0);
      expect(modelledMortgageOn(schedule, principal, "garbage")).toBeNull();
      expect(modelledMortgageOn(schedule, NaN, "2026-06-01")).toBeNull();
      // No schedule at all means nothing has been paid.
      expect(modelledMortgageOn([], principal, "2026-06-01")).toBe(principal);
    }
  });
});

describe("checkpoint persistence invariants", () => {
  it("keeps exactly what was stored, or nothing", () => {
    for (const c of CASES) {
      for (const v of c.raw) {
        const stored = { id: "x", ...v, extra: "ignored" };
        const parsed = sanitizeCheckpoint(stored);
        expect(parsed).not.toBeNull();
        // Compared against the raw stored object, never against a re-parse.
        expect(parsed?.id).toBe("x");
        expect(parsed?.date).toBe(v.date);
        expect(parsed?.actual).toBe(v.actual);
        expect(parsed?.modelled).toBe(v.modelled);
        expect(parsed).not.toHaveProperty("extra");
      }
    }
  });

  it("drops a check it cannot trust rather than defaulting it to zero", () => {
    // A zero here would read as "the bank said you have nothing" — a claim
    // about reality that nobody made.
    const REJECTED = [
      null,
      undefined,
      42,
      "checkpoint",
      {},
      { id: "", date: "2026-01-01", actual: 1, modelled: 1 },
      { id: 7, date: "2026-01-01", actual: 1, modelled: 1 },
      { id: "a", date: "2026-13-01", actual: 1, modelled: 1 },
      { id: "a", date: "2026-02-30", actual: 1, modelled: 1 },
      { id: "a", date: "", actual: 1, modelled: 1 },
      { id: "a", date: "2026-01-01", modelled: 1 },
      { id: "a", date: "2026-01-01", actual: 1 },
      { id: "a", date: "2026-01-01", actual: "1", modelled: 1 },
      { id: "a", date: "2026-01-01", actual: NaN, modelled: 1 },
      { id: "a", date: "2026-01-01", actual: 1, modelled: Infinity },
    ];
    for (const bad of REJECTED) expect(sanitizeCheckpoint(bad)).toBeNull();

    // Zero itself is a real answer and must survive.
    expect(
      sanitizeCheckpoint({ id: "a", date: "2026-01-01", actual: 0, modelled: 0 })
    ).toEqual({ id: "a", date: "2026-01-01", actual: 0, modelled: 0 });

    // A list keeps the good and drops only the bad.
    expect(sanitizeCheckpoints([...REJECTED, { id: "ok", date: "2026-01-01", actual: 5, modelled: 4 }]))
      .toEqual([{ id: "ok", date: "2026-01-01", actual: 5, modelled: 4 }]);
    for (const notAList of [null, undefined, {}, "[]", 3]) {
      expect(sanitizeCheckpoints(notAList)).toEqual([]);
    }
  });

  it("round-trips through storage without changing any answer", () => {
    // Agreement: what comes back out of JSON must summarize identically to
    // what went in, or a reload silently changes the verdict.
    for (const c of CASES) {
      const revived = sanitizeCheckpoints(
        JSON.parse(JSON.stringify(c.checkpoints))
      );
      expect(revived).toEqual(c.checkpoints);
      expect(
        JSON.stringify(summarizeCheckpoints(revived, c.target, c.asOf, c.tolerance))
      ).toBe(
        JSON.stringify(
          summarizeCheckpoints(c.checkpoints, c.target, c.asOf, c.tolerance)
        )
      );
    }
  });
});
