// src/domain/cashflowInvariants.test.ts
//
// The same treatment as allocationInvariants.test.ts, applied to the app's
// other money engine. Properties that must hold of ANY correct projection,
// checked over generated households rather than hand-picked ones — so what
// nobody thought to write a test for still has to obey the laws.
//
// See CLAUDE.md, "The checklist for money code". The classes below are:
// conservation, units, timing, impossibilities, agreement, degenerate inputs.

import { describe, it, expect } from "vitest";
import { runCashflowProjection } from "./cashflowEngine";
import {
  computeSafeToSpend,
  computeTopUpSchedule,
  computeTopUpHint,
} from "./safeToSpendEngine";
import type { AppState, RecurringRule, AdhocTransaction } from "./types";
import { upgradeAppState } from "./appState";

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

function generateState(r: () => number): AppState {
  const startDate = iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28));

  const rules: RecurringRule[] = [];
  const ruleCount = Math.floor(r() * 6);
  for (let i = 0; i < ruleCount; i++) {
    const inflow = r() < 0.4;
    const amount = (inflow ? 1 : -1) * Math.floor(r() * 6000 + 1);
    const kind = r();
    rules.push({
      id: `r${i}`,
      name: `rule ${i}`,
      amount,
      isVariable: r() < 0.2,
      schedule:
        kind < 0.45
          ? { type: "monthly", day: 1 + Math.floor(r() * 31) }
          : kind < 0.8
            ? {
                type: "twiceMonth",
                day1: 1 + Math.floor(r() * 28),
                day2: 1 + Math.floor(r() * 31),
                businessDayConvention:
                  r() < 0.5 ? "previousBusinessDayUS" : "none",
              }
            : {
                type: "biweekly",
                anchorDate: iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
              },
    });
  }

  const adhocTransactions: AdhocTransaction[] = [];
  const adhocCount = Math.floor(r() * 4);
  for (let i = 0; i < adhocCount; i++) {
    adhocTransactions.push({
      id: `a${i}`,
      name: `one-off ${i}`,
      amount: (r() < 0.5 ? 1 : -1) * Math.floor(r() * 5000 + 1),
      date: iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
    });
  }

  // upgradeAppState is the only supported way to build a state, so the
  // generator goes through it rather than around it.
  return upgradeAppState({
    version: 4,
    account: { startingBalance: Math.floor(r() * 30_000) - 5_000 },
    settings: {
      startDate,
      horizonDays: 30 + Math.floor(r() * 400),
      minSafeBalance: Math.floor(r() * 8_000),
    },
    rules,
    adhocTransactions,
    overrides: {},
  });
}

const STATES = (() => {
  const r = rng(20260804);
  return Array.from({ length: 120 }, () => generateState(r));
})();

describe("cashflow invariants (property-based)", () => {
  it("conserves money: every balance is the starting balance plus the flows to date", () => {
    // The single most important law in the engine. If it holds, no event can
    // be dropped, double-counted, or applied on the wrong day.
    for (const state of STATES) {
      const { timeline, events } = runCashflowProjection(state);
      for (const point of timeline) {
        const flows = events
          .filter((e) => e.date <= point.date)
          .reduce((s, e) => s + e.effectiveAmount, 0);
        expect(point.balance).toBeCloseTo(
          state.account.startingBalance + flows,
          6
        );
      }
    }
  });

  it("lands every event inside the horizon, on a real day, exactly once", () => {
    for (const state of STATES) {
      const { events, timeline } = runCashflowProjection(state);
      const ids = new Set<string>();
      for (const e of events) {
        expect(e.id, `duplicate event id ${e.id}`).not.toBe(
          ids.has(e.id) ? e.id : Symbol() as unknown as string
        );
        ids.add(e.id);
        expect(e.date >= state.settings.startDate).toBe(true);
        if (timeline.length) {
          expect(e.date <= timeline[timeline.length - 1].date).toBe(true);
        }
        // A real calendar day, not merely a well-shaped string.
        const [y, m, d] = e.date.split("-").map(Number);
        const back = new Date(Date.UTC(y, m - 1, d));
        expect(back.getUTCMonth()).toBe(m - 1);
        expect(back.getUTCDate()).toBe(d);
      }
      expect(ids.size).toBe(events.length);
    }
  });

  it("uses each ad-hoc transaction at most once", () => {
    for (const state of STATES) {
      const { events } = runCashflowProjection(state);
      for (const txn of state.adhocTransactions) {
        const matches = events.filter((e) => e.ruleId === txn.id);
        expect(matches.length).toBeLessThanOrEqual(1);
        if (matches.length === 1) {
          expect(matches[0].defaultAmount).toBeCloseTo(txn.amount, 6);
        }
      }
    }
  });

  it("walks one contiguous day per point, in order", () => {
    for (const state of STATES) {
      const { timeline } = runCashflowProjection(state);
      if (timeline.length === 0) continue;
      expect(timeline[0].date).toBe(state.settings.startDate);
      expect(timeline).toHaveLength(state.settings.horizonDays + 1);
      for (let i = 1; i < timeline.length; i++) {
        const prev = Date.parse(timeline[i - 1].date + "T00:00:00Z");
        const cur = Date.parse(timeline[i].date + "T00:00:00Z");
        expect((cur - prev) / 86_400_000).toBe(1);
      }
    }
  });

  it("reports the minimum it actually walked", () => {
    for (const state of STATES) {
      const { timeline, metrics } = runCashflowProjection(state);
      if (timeline.length === 0) continue;
      const min = timeline.reduce((lo, p) => Math.min(lo, p.balance), Infinity);
      expect(metrics.minBalance).toBeCloseTo(min, 6);
      const at = timeline.find((p) => p.balance === metrics.minBalance);
      expect(at?.date).toBe(metrics.minBalanceDate);
    }
  });

  it("never reports safe-to-spend that would breach the floor", () => {
    // Spending X today shifts the whole curve down by X, so the claim is
    // falsifiable: subtract it and the minimum must still clear the floor.
    for (const state of STATES) {
      const { safeToSpendToday, projectedMinBalance } = computeSafeToSpend(state);
      expect(safeToSpendToday).toBeGreaterThanOrEqual(0);
      // When the projection is already under the floor there is nothing safe
      // to spend, and the minimum stays under it — that is correct, not a
      // breach. The law only bites when a positive amount is offered.
      if (safeToSpendToday > 0) {
        expect(
          projectedMinBalance - safeToSpendToday
        ).toBeGreaterThanOrEqual(state.settings.minSafeBalance - 1e-6);
      }
    }
  });

  it("plans top-ups that actually clear every breach", () => {
    // The end-to-end law: apply the schedule to the timeline and no day may
    // sit below the floor. A plan that leaves a dip is worse than none, since
    // the user believes they are covered.
    for (const state of STATES) {
      const { timeline } = runCashflowProjection(state);
      const floor = state.settings.minSafeBalance;
      const deposits = computeTopUpSchedule(timeline, floor);

      for (const point of timeline) {
        const toppedUp = deposits
          .filter((d) => d.date <= point.date)
          .reduce((s, d) => s + d.amount, 0);
        expect(
          point.balance + toppedUp,
          `${point.date} still below the floor`
        ).toBeGreaterThanOrEqual(floor - 1e-6);
      }
    }
  });

  it("never plans a top-up larger than the shortfall it covers", () => {
    for (const state of STATES) {
      const { timeline } = runCashflowProjection(state);
      const floor = state.settings.minSafeBalance;
      const deposits = computeTopUpSchedule(timeline, floor);
      const worst = timeline.reduce(
        (lo, p) => Math.min(lo, p.balance),
        Infinity
      );
      if (deposits.length === 0) continue;
      const total = deposits.reduce((s, d) => s + d.amount, 0);
      // Never more than lifting the deepest point to the floor.
      expect(total).toBeLessThanOrEqual(Math.max(0, floor - worst) + 1e-6);
      for (const d of deposits) {
        expect(d.amount).toBeGreaterThan(0);
        expect(Number.isFinite(d.amount)).toBe(true);
        expect(d.balanceBefore).toBeLessThan(floor);
      }
    }
  });

  it("agrees with the single-deposit hint on the total required", () => {
    // Two functions computing the same quantity, checked against each other
    // rather than each against itself.
    for (const state of STATES) {
      const { timeline } = runCashflowProjection(state);
      const floor = state.settings.minSafeBalance;
      const schedule = computeTopUpSchedule(timeline, floor);
      const hint = computeTopUpHint(timeline, floor);

      if (schedule.length === 0) {
        expect(hint).toBeNull();
        continue;
      }
      expect(hint).not.toBeNull();
      const total = schedule.reduce((s, d) => s + d.amount, 0);
      expect(total).toBeCloseTo(hint!.amountNeeded, 6);
      // Both mark the first moment the floor is breached.
      expect(schedule[0].date).toBe(hint!.neededBy);
    }
  });

  it("produces finite numbers throughout", () => {
    for (const state of STATES) {
      const { timeline, metrics, events } = runCashflowProjection(state);
      for (const p of timeline) {
        expect(Number.isFinite(p.balance)).toBe(true);
        expect(Number.isFinite(p.inflow)).toBe(true);
        expect(Number.isFinite(p.outflow)).toBe(true);
        // Inflow is positive and outflow is signed negative; the pair sums
        // to the day's net movement.
        expect(p.inflow).toBeGreaterThanOrEqual(0);
        expect(p.outflow).toBeLessThanOrEqual(0);
      }
      for (const e of events) expect(Number.isFinite(e.effectiveAmount)).toBe(true);
      expect(Number.isFinite(metrics.minBalance)).toBe(true);
      expect(Number.isFinite(metrics.balanceToday)).toBe(true);
    }
  });

  it("gives the same answer twice", () => {
    for (const state of STATES) {
      expect(JSON.stringify(runCashflowProjection(state))).toBe(
        JSON.stringify(runCashflowProjection(state))
      );
    }
  });
});
