// src/domain/safeToSpendEngine.test.ts
import {
  computeSafeToSpendFromEvents,
  computeSafeToSpend,
  computeTopUpHint,
  computeTopUpSchedule,
  transferDepositToTransaction,
} from "./safeToSpendEngine";
import { createInitialAppState } from "./appState";
import type { AppState, Money, TimelinePoint } from "./types";

function tp(date: string, balance: number): TimelinePoint {
  return { date, balance, inflow: 0, outflow: 0 };
}

describe("computeTopUpHint", () => {
  it("returns null when the balance never dips below the floor", () => {
    const timeline = [tp("2025-01-01", 500), tp("2025-01-02", 300), tp("2025-01-03", 400)];
    expect(computeTopUpHint(timeline, 100)).toBeNull();
  });

  it("returns null for an empty timeline", () => {
    expect(computeTopUpHint([], 100)).toBeNull();
  });

  it("reports the shortfall and the first breach date", () => {
    const timeline = [
      tp("2025-01-01", 500),
      tp("2025-01-02", 50), // first below floor of 100
      tp("2025-01-03", -30), // deeper minimum
      tp("2025-01-04", 200),
    ];
    // Need floor(100) - min(-30) = 130 deposited, before the first breach.
    // Deadline is the first breach (01-02); the amount is sized to the
    // deeper low that follows (01-03).
    expect(computeTopUpHint(timeline, 100)).toEqual({
      amountNeeded: 130,
      neededBy: "2025-01-02",
      lowestBalance: -30,
      lowestDate: "2025-01-03",
    });
  });

  it("treats a balance exactly at the floor as safe (no top-up)", () => {
    const timeline = [tp("2025-01-01", 100), tp("2025-01-02", 100)];
    expect(computeTopUpHint(timeline, 100)).toBeNull();
  });

  it("works with a zero floor (top up to avoid going negative)", () => {
    const timeline = [tp("2025-01-01", 200), tp("2025-01-02", -75)];
    expect(computeTopUpHint(timeline, 0)).toEqual({
      amountNeeded: 75,
      neededBy: "2025-01-02",
      lowestBalance: -75,
      lowestDate: "2025-01-02",
    });
  });

  it("gives no hint when the floor itself is unusable", () => {
    const timeline = [tp("2025-01-01", 200), tp("2025-01-02", -75)];
    expect(computeTopUpHint(timeline, NaN)).toBeNull();
    expect(computeTopUpHint(timeline, Infinity)).toBeNull();
  });

  it("passes over days with an unusable balance rather than sizing off them", () => {
    const timeline = [
      tp("2025-01-01", NaN),
      tp("2025-01-02", -Infinity),
      tp("2025-01-03", -75),
    ];
    expect(computeTopUpHint(timeline, 0)).toEqual({
      amountNeeded: 75,
      neededBy: "2025-01-03",
      lowestBalance: -75,
      lowestDate: "2025-01-03",
    });
  });
});

describe("computeTopUpSchedule", () => {
  it("returns an empty plan when the balance never dips below the floor", () => {
    const timeline = [tp("2025-01-01", 500), tp("2025-01-02", 300), tp("2025-01-03", 400)];
    expect(computeTopUpSchedule(timeline, 100)).toEqual([]);
  });

  it("returns an empty plan for an empty timeline", () => {
    expect(computeTopUpSchedule([], 100)).toEqual([]);
  });

  it("makes one deposit per stretch, at the first breach, sized to its deepest point", () => {
    const timeline = [
      tp("2025-01-01", 500),
      tp("2025-01-02", 50), // first below floor of 100
      tp("2025-01-03", -30), // deeper — same stretch
      tp("2025-01-04", 200), // recovers
    ];
    // A single below-floor stretch: deposit lands on the first breach (01-02)
    // but is sized to the stretch's deepest adjusted point (-30 → 130), so we
    // never top up twice in the same dip. Matches the single-hint amount/date.
    const plan = computeTopUpSchedule(timeline, 100);
    expect(plan).toEqual([{ date: "2025-01-02", amount: 130, balanceBefore: 50 }]);
    const hint = computeTopUpHint(timeline, 100)!;
    expect(plan[0].date).toBe(hint.neededBy);
    expect(plan[0].amount).toBe(hint.amountNeeded);
  });

  it("splits separate dips into their own just-in-time deposits", () => {
    const timeline = [
      tp("2025-01-01", 500),
      tp("2025-01-02", -100), // first stretch below floor of 0
      tp("2025-01-03", 400), // recovers (with the first deposit carried forward)
      tp("2025-01-04", -300), // second, deeper stretch
    ];
    const plan = computeTopUpSchedule(timeline, 0);
    // First deposit lifts 01-02 to 0. It carries forward, so on 01-04 the raw
    // -300 is already -200 and only 200 more is needed.
    expect(plan).toEqual([
      { date: "2025-01-02", amount: 100, balanceBefore: -100 },
      { date: "2025-01-04", amount: 200, balanceBefore: -200 },
    ]);
    // Total matches the single-hint amount (floor - deepest raw low).
    const total = plan.reduce((s, d) => s + d.amount, 0);
    expect(total).toBe(computeTopUpHint(timeline, 0)!.amountNeeded);
  });

  it("does not deposit again once carried-forward top-ups keep later days safe", () => {
    const timeline = [
      tp("2025-01-01", 500),
      tp("2025-01-02", -100), // deposit 100 (its own stretch, recovers next)
      tp("2025-01-03", 40), // above floor of 0 → ends the stretch
      tp("2025-01-04", -50), // -50 + 100 carried = 50 >= 0, no new deposit
    ];
    expect(computeTopUpSchedule(timeline, 0)).toEqual([
      { date: "2025-01-02", amount: 100, balanceBefore: -100 },
    ]);
  });

  it("treats a balance exactly at the floor as safe", () => {
    const timeline = [tp("2025-01-01", 100), tp("2025-01-02", 100)];
    expect(computeTopUpSchedule(timeline, 100)).toEqual([]);
  });

  describe("non-finite inputs cannot wedge the loop", () => {
    // Every comparison against NaN is false, so a NaN balance used to
    // satisfy neither "already safe" nor "below the floor": the scan index
    // never advanced and the loop pushed deposits until the heap died
    // (measured: 150s and 8.1 GB before V8 aborted). It runs on a render
    // path, so it has to terminate on any input.
    it("skips a NaN balance instead of looping forever", () => {
      const timeline = [
        tp("2025-01-01", NaN),
        tp("2025-01-02", -500),
        tp("2025-01-03", 900),
      ];
      const deposits = computeTopUpSchedule(timeline, 0);
      // The unusable day contributes nothing; the real dip still does.
      expect(deposits).toEqual([
        { date: "2025-01-02", amount: 500, balanceBefore: -500 },
      ]);
    });

    it("skips infinite balances instead of emitting infinite deposits", () => {
      const timeline = [
        tp("2025-01-01", -Infinity),
        tp("2025-01-02", Infinity),
        tp("2025-01-03", -200),
      ];
      const deposits = computeTopUpSchedule(timeline, 0);
      expect(deposits).toEqual([
        { date: "2025-01-03", amount: 200, balanceBefore: -200 },
      ]);
      expect(deposits.every((d) => Number.isFinite(d.amount))).toBe(true);
    });

    it("returns no deposits when the floor itself is unusable", () => {
      const timeline = [tp("2025-01-01", -500), tp("2025-01-02", 100)];
      expect(computeTopUpSchedule(timeline, NaN)).toEqual([]);
      expect(computeTopUpSchedule(timeline, Infinity)).toEqual([]);
    });
  });
});

describe("transferDepositToTransaction", () => {
  it("maps a deposit to a positive-amount ad-hoc inflow on the same date", () => {
    const txn = transferDepositToTransaction({
      date: "2025-03-10",
      amount: 250,
      balanceBefore: -50,
    });
    expect(txn).toEqual({
      name: "Top Up",
      amount: 250,
      date: "2025-03-10",
      kind: "topUp",
    });
  });

  it("marks the transaction so coverage can find it without matching on name", () => {
    // `name` is user-editable, so the marker is the only reliable handle.
    // There is one kind of top-up, so nothing else is recorded alongside it.
    const txn = transferDepositToTransaction({
      date: "2025-03-10",
      amount: 250,
      balanceBefore: -50,
    });
    expect(txn.kind).toBe("topUp");
    expect(Object.keys(txn).sort()).toEqual(["amount", "date", "kind", "name"]);
  });

  it("rounds sub-cent amounts to the nearest cent", () => {
    const txn = transferDepositToTransaction({
      date: "2025-03-10",
      amount: 130.00000000000003,
      balanceBefore: -30,
    });
    expect(txn.amount).toBe(130);
  });
});

function evt(date: string, amount: Money) {
  return { date, effectiveAmount: amount };
}

describe("computeSafeToSpend with ad-hoc transactions", () => {
  it("an ad-hoc outflow inside the horizon lowers safe-to-spend", () => {
    const base: AppState = {
      ...createInitialAppState(),
      account: { startingBalance: 1000 },
      settings: { startDate: "2025-01-01", horizonDays: 30, minSafeBalance: 0 },
      rules: [],
      adhocTransactions: [],
      overrides: {},
    };
    const without = computeSafeToSpend(base);
    const withTxn = computeSafeToSpend({
      ...base,
      adhocTransactions: [
        { id: "t1", name: "Repair", amount: -400, date: "2025-01-15" },
      ],
    });
    expect(without.safeToSpendToday).toBe(1000);
    expect(withTxn.safeToSpendToday).toBe(600);
  });
});

describe("computeSafeToSpend (state wrapper)", () => {
  it("runs the projection and returns a non-negative safe-to-spend", () => {
    const state: AppState = {
      ...createInitialAppState(),
      account: { startingBalance: 10_000 },
      settings: { startDate: "2025-01-01", horizonDays: 30, minSafeBalance: 0 },
      rules: [],
      overrides: {},
    };
    const result = computeSafeToSpend(state);
    expect(result.projectedMinBalance).toBe(10_000);
    expect(result.safeToSpendToday).toBe(10_000);
  });

  it("defaults minSafeBalance to 0 when it is missing", () => {
    const state = {
      ...createInitialAppState(),
      account: { startingBalance: 500 },
      settings: { startDate: "2025-01-01", horizonDays: 10 },
      rules: [],
      overrides: {},
    } as unknown as AppState;
    const result = computeSafeToSpend(state);
    expect(result.safeToSpendToday).toBe(500);
  });
});

describe("computeSafeToSpendFromEvents", () => {
  it("returns zero safe-to-spend when min balance is below safe threshold", () => {
    const starting = 1_000;
    const minSafe = 900;

    const events = [
      evt("2025-01-02", -50),
      evt("2025-01-03", -100),
    ];

    const result = computeSafeToSpendFromEvents(starting, minSafe, events);

    // Starting 1000, events -50, -100 → min balance = 850
    expect(result.projectedMinBalance).toBe(850);
    // 850 - 900 = -50 → no safe-to-spend
    expect(result.safeToSpendToday).toBe(0);
  });

  it("allows spending equal to the margin above minSafeBalance", () => {
    const starting = 1_000;
    const minSafe = 700;

    const events = [
      evt("2025-01-02", -50),
      evt("2025-01-03", -100),
      evt("2025-01-04", -150),
    ];

    const result = computeSafeToSpendFromEvents(starting, minSafe, events);
    // Starting 1000, cumulative -300 at worst → min balance = 700
    expect(result.projectedMinBalance).toBe(700);
    // 700 - 700 = 0 → exactly at threshold, no headroom
    expect(result.safeToSpendToday).toBe(0);
  });

  it("computes positive safe-to-spend when min balance stays above threshold", () => {
    const starting = 2_000;
    const minSafe = 1_200;

    const events = [
      evt("2025-01-02", -100),
      evt("2025-01-03", -150),
      evt("2025-01-04", -200),
      evt("2025-01-05", +50),
    ];

    const result = computeSafeToSpendFromEvents(starting, minSafe, events);
    // Worst cumulative drop: -450 → min balance = 1550
    expect(result.projectedMinBalance).toBe(1_550);
    // Margin = 1550 - 1200 = 350
    expect(result.safeToSpendToday).toBe(350);
  });

  it("handles empty event list correctly", () => {
    const starting = 1_500;
    const minSafe = 1_000;

    const result = computeSafeToSpendFromEvents(starting, minSafe, []);

    expect(result.projectedMinBalance).toBe(1_500);
    // 1500 - 1000 = 500 safe to spend
    expect(result.safeToSpendToday).toBe(500);
  });

  it("handles events out of order by date", () => {
    const starting = 1_000;
    const minSafe = 600;

    const events = [
      evt("2025-01-05", -300),
      evt("2025-01-02", -50),
      evt("2025-01-03", -100),
    ];

    const result = computeSafeToSpendFromEvents(starting, minSafe, events);
    // Sorted: -50, -100, -300 → cumulative -450 → min balance = 550
    expect(result.projectedMinBalance).toBe(550);
    // 550 - 600 = -50 → no safe-to-spend
    expect(result.safeToSpendToday).toBe(0);
  });
});
