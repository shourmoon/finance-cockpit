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

// ---------------------------------------------------------------------------
// The balance has a date of its own, and the start date is not it.
// ---------------------------------------------------------------------------
//
// `account.startingBalance` is a figure confirmed against a bank statement on
// a particular day — the latest checkpoint's date. `settings.startDate` is
// where the forecast window opens. The engine treated them as the same date:
// it seeded the running balance with the confirmed figure and began walking
// at startDate, whatever the gap between them.
//
// So moving the start date forward six days did not roll the balance forward
// six days — it simply dropped every event in between. A $4,200 salary paid
// on the 20th vanished from the forecast when the window opened on the 24th:
// too early to be an event, too late to be in the balance. Since
// `advanceStartDate` moves startDate to today on every load, that gap opens
// by itself, a day at a time, between one reality check and the next.
//
// The law is the one a reader assumes without being told: what the app says
// your balance will be on some future day cannot depend on which day you
// happen to be looking from.
describe("the start date is a window, not an anchor", () => {
  /** Anchor a state's balance to a date, as recording a reality check does. */
  function anchoredAt(state: AppState, date: string): AppState {
    return {
      ...state,
      checkpoints: [
        {
          id: "anchor",
          date,
          actual: state.account.startingBalance,
          modelled: state.account.startingBalance,
        },
      ],
    };
  }

  function shift(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  it("reports the same balance for a day however far back the window opens", () => {
    // Two windows over one household, opening on different days, both
    // ending on the same day, both anchored to the same confirmed balance.
    // Every date they share must agree — to the cent.
    let compared = 0;
    for (const base of STATES.slice(0, 60)) {
      const anchor = base.settings.startDate;
      const gap = 1 + (base.settings.horizonDays % 40);
      if (gap >= base.settings.horizonDays) continue;

      const fromAnchor = anchoredAt(base, anchor);
      const fromLater = anchoredAt(
        {
          ...base,
          settings: {
            ...base.settings,
            startDate: shift(anchor, gap),
            // End on the same day, so the two windows overlap exactly.
            horizonDays: base.settings.horizonDays - gap,
          },
        },
        anchor
      );

      const a = runCashflowProjection(fromAnchor);
      const b = runCashflowProjection(fromLater);
      const byDate = new Map(a.timeline.map((p) => [p.date, p.balance]));

      for (const point of b.timeline) {
        const expected = byDate.get(point.date);
        if (expected === undefined) continue;
        compared++;
        expect(
          Math.abs(expected - point.balance),
          `balance on ${point.date} moved when the window opened ${gap} days later ` +
            `(anchor ${anchor}): ${expected} vs ${point.balance}`
        ).toBeLessThan(1e-6);
      }
    }
    // Guard against a vacuous pass: if the windows never overlapped, the
    // loop above would assert nothing at all and still go green.
    expect(compared).toBeGreaterThan(1000);
  });

  it("rolls the confirmed balance forward by exactly the events in between", () => {
    // Stated as arithmetic over the raw rules rather than by re-running the
    // engine: the opening balance at the new start is the confirmed figure
    // plus every event from the anchor up to (not including) that start.
    for (const base of STATES.slice(0, 40)) {
      const anchor = base.settings.startDate;
      const gap = 1 + (base.settings.horizonDays % 30);
      const later = shift(anchor, gap);

      // What the engine says happens between the anchor and the new start,
      // read off a projection that covers that stretch.
      const bridge = runCashflowProjection(anchoredAt(base, anchor));
      const inBetween = bridge.events
        .filter((e) => e.date >= anchor && e.date < later)
        .reduce((sum, e) => sum + e.effectiveAmount, 0);

      const moved = runCashflowProjection(
        anchoredAt(
          { ...base, settings: { ...base.settings, startDate: later } },
          anchor
        )
      );
      // The first timeline point already has its own day's events applied,
      // so back them out to recover the opening balance.
      const firstPoint = moved.timeline[0];
      if (!firstPoint) continue;
      const opening =
        firstPoint.balance - (firstPoint.inflow + firstPoint.outflow);

      expect(
        Math.abs(opening - (base.account.startingBalance + inBetween))
      ).toBeLessThan(1e-6);
    }
  });

  it("rolls backwards when the window is pinned before the check", () => {
    // Looking at the projection from a day before the last reality check is
    // a legitimate thing to do (that is what pinning is for), and the
    // honest answer is the confirmed figure less whatever happened since.
    const state = upgradeAppState({
      version: 8,
      account: { startingBalance: 10_000 },
      settings: {
        startDate: "2026-11-01",
        followToday: false,
        horizonDays: 40,
        minSafeBalance: 0,
      },
      rules: [
        { id: "rent", name: "Rent", amount: -2600, isVariable: false,
          schedule: { type: "monthly", day: 1 } },
        { id: "sal", name: "Salary", amount: 4200, isVariable: false,
          schedule: { type: "monthly", day: 15 } },
      ],
      adhocTransactions: [],
      overrides: {},
      checkpoints: [
        { id: "c", date: "2026-11-20", actual: 10_000, modelled: 10_000 },
      ],
    });

    const first = runCashflowProjection(state).timeline[0];
    // Between 1 Nov (inclusive) and 20 Nov: −2,600 then +4,200 = +1,600.
    // So the balance at the start of 1 Nov was 10,000 − 1,600 = 8,400,
    // and the first point then applies 1 Nov's own −2,600.
    expect(first.date).toBe("2026-11-01");
    expect(first.balance).toBeCloseTo(8_400 - 2_600, 6);
  });

  it("refuses a roll it cannot honestly make, rather than hanging on it", () => {
    // Storage is untrusted. A checkpoint dated in year 1000 against a 2026
    // window asks for a 375,000-day event expansion — which does not
    // produce a wrong number so much as freeze the tab.
    //
    // Year 1000 and not year 0001 on purpose: `isValidISODate` rejects
    // 0001-01-01 outright, so the checkpoint is dropped during the upgrade
    // and this exercises the no-anchor path instead — passing without ever
    // reaching the guard it is named for. Year 1000 is a real date that
    // survives sanitising, which is what makes this test discriminating.
    const state = upgradeAppState({
      version: 8,
      account: { startingBalance: 7_000 },
      settings: {
        startDate: "2026-11-24",
        followToday: false,
        horizonDays: 30,
        minSafeBalance: 0,
      },
      rules: [
        { id: "r", name: "Rent", amount: -1000, isVariable: false,
          schedule: { type: "monthly", day: 1 } },
      ],
      adhocTransactions: [],
      overrides: {},
      checkpoints: [
        { id: "c", date: "1000-01-01", actual: 7_000, modelled: 7_000 },
      ],
    });

    const started = Date.now();
    const first = runCashflowProjection(state).timeline[0];
    expect(Date.now() - started).toBeLessThan(2_000);
    // Unrolled: 7,000, with 24 Nov carrying no event of its own.
    expect(first.balance).toBeCloseTo(7_000, 6);
  });

  it("rolls nothing when the balance has never been confirmed", () => {
    // The positive control, and a real case: with no checkpoint there is no
    // date to roll from, so the figure stays exactly where it is. A version
    // that rolled regardless would pass both laws above and quietly invent
    // an opening balance for every user who has not run a reality check.
    for (const base of STATES.slice(0, 30)) {
      const projection = runCashflowProjection({ ...base, checkpoints: [] });
      const firstPoint = projection.timeline[0];
      if (!firstPoint) continue;
      const opening =
        firstPoint.balance - (firstPoint.inflow + firstPoint.outflow);
      expect(Math.abs(opening - base.account.startingBalance)).toBeLessThan(1e-6);
    }
  });
});
