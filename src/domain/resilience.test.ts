// src/domain/resilience.test.ts
import { describe, it, expect } from "vitest";
import { computeCoverageMetrics } from "./resilience";
import type { AdhocTransaction } from "./types";

/** Terse helper: a recorded top-up. */
function topUp(date: string, amount: number): AdhocTransaction {
  return { id: `t-${date}-${amount}`, name: "Top Up", amount, date, kind: "topUp" };
}

/** A transaction the user created themselves — never a top-up. */
function plain(date: string, amount: number, name = "Groceries"): AdhocTransaction {
  return { id: `p-${date}-${amount}`, name, amount, date };
}

const BASE = { asOf: "2026-08-15", trackingSince: "2025-08-01", windowMonths: 12 } as const;

describe("computeCoverageMetrics", () => {
  it("returns an empty, honest shape when nothing has been recorded", () => {
    const m = computeCoverageMetrics([], BASE);
    expect(m.totalToppedUp).toBe(0);
    expect(m.cleanMonths).toBe(12);
    expect(m.knownMonths).toBe(12);
    expect(m.typicalTopUp).toBeNull();
    expect(m.streakCurrent).toBe(12);
    expect(m.streakBest).toBe(12);
    expect(m.secondSalaryKept).toBeNull();
  });

  it("counts only transactions marked as top-ups, ignoring the user's own", () => {
    const txns = [
      topUp("2026-03-10", 500),
      plain("2026-04-10", 900, "Top Up"), // same name, but not kind: "topUp"
      plain("2026-05-10", -300),
    ];
    const m = computeCoverageMetrics(txns, BASE);
    expect(m.totalToppedUp).toBe(500);
    expect(m.cleanMonths).toBe(11);
  });

  it("includes the current, in-progress month — flagged incomplete, not excluded", () => {
    // A top-up dated in the asOf month counts immediately: the app forecasts
    // ahead, so a real draw already happened and there's no reason to hide it.
    const m = computeCoverageMetrics([topUp("2026-08-05", 5000)], BASE);
    expect(m.totalToppedUp).toBe(5000);
    expect(m.cleanMonths).toBe(11);
    const current = m.months.find((b) => b.monthKey === "2026-08")!;
    expect(current).toBeDefined();
    expect(current.complete).toBe(false);
    expect(current.total).toBe(5000);
    // Every other month is complete.
    expect(m.months.filter((b) => b.monthKey !== "2026-08").every((b) => b.complete)).toBe(
      true
    );
  });

  it("treats months before tracking began as unknown, not clean", () => {
    const m = computeCoverageMetrics([], {
        ...BASE,
      trackingSince: "2026-05-01",
    });
    // Window: 2025-09 .. 2026-08. Known: May, Jun, Jul, Aug '26 (Aug in progress).
    expect(m.knownMonths).toBe(4);
    expect(m.cleanMonths).toBe(4);
    expect(m.months.filter((b) => !b.known)).toHaveLength(8);
  });

  it("defaults to a 12-month window and treats every month as known when no tracking date is set", () => {
    // No windowMonths and no trackingSince — both defaults exercised.
    const m = computeCoverageMetrics([topUp("2025-09-10", 400)], {
      asOf: "2026-08-15",
    });
    expect(m.months).toHaveLength(12);
    expect(m.knownMonths).toBe(12);
    expect(m.cleanMonths).toBe(11);
  });

  it("ignores a malformed tracking date rather than hiding every month", () => {
    const m = computeCoverageMetrics([topUp("2026-03-10", 400)], {
        ...BASE,
      trackingSince: "garbage",
    });
    expect(m.knownMonths).toBe(12);
    expect(m.totalToppedUp).toBe(400);
  });

  it("counts every top-up the same, however old data labelled it", () => {
    // States written before the two kinds were merged still carry a
    // `reason`. It is not read: a month that needed money moved in did not
    // run on one salary, whatever prompted the transfer.
    const labelled = [
      { ...topUp("2026-02-10", 1800), reason: "oneOff" },
      { ...topUp("2026-03-10", 400), reason: "shortfall" },
    ] as AdhocTransaction[];
    const m = computeCoverageMetrics(labelled, BASE);

    expect(m.totalToppedUp).toBe(2200);
    expect(m.cleanMonths).toBe(10);
    // And identical to the same transactions with no label at all.
    const bare = [topUp("2026-02-10", 1800), topUp("2026-03-10", 400)];
    expect(computeCoverageMetrics(bare, BASE)).toEqual(m);
  });

  it("sums several top-ups landing in the same month", () => {
    const txns = [topUp("2026-03-02", 200), topUp("2026-03-20", 450)];
    const m = computeCoverageMetrics(txns, BASE);
    expect(m.totalToppedUp).toBe(650);
    const march = m.months.find((b) => b.monthKey === "2026-03")!;
    expect(march.total).toBe(650);
  });

  it("ignores non-positive amounts, which are not top-ups", () => {
    const txns = [topUp("2026-03-10", 0), topUp("2026-04-10", -250)];
    const m = computeCoverageMetrics(txns, BASE);
    expect(m.totalToppedUp).toBe(0);
    expect(m.cleanMonths).toBe(12);
  });

  it("averages the gap over known months only, not a hardcoded 12", () => {
    // 4 known months (May-Aug, Aug in progress), $600 drawn -> $150/mo.
    const m = computeCoverageMetrics([topUp("2026-06-10", 600)], {
        ...BASE,
      trackingSince: "2026-05-01",
    });
    expect(m.knownMonths).toBe(4);
    expect(m.averageMonthlyGap).toBe(150);
  });

  it("reports the typical top-up as the median of assisted months", () => {
    const txns = [
      topUp("2025-10-10", 300),
      topUp("2025-12-10", 500),
      topUp("2026-02-10", 1000),
    ];
    const m = computeCoverageMetrics(txns, BASE);
    expect(m.typicalTopUp).toBe(500); // median of 300, 500, 1000
  });

  it("averages the two middle months when the assisted count is even", () => {
    const txns = [topUp("2026-01-10", 300), topUp("2026-02-10", 500)];
    const m = computeCoverageMetrics(txns, BASE);
    expect(m.typicalTopUp).toBe(400);
  });

  describe("streaks (clean months, the positive framing)", () => {
    it("reports the current streak trailing from the most recent month, including the one in progress", () => {
      // Window ends 2026-08. A top-up in 2026-04 leaves May-Aug clean (Aug in progress).
      const m = computeCoverageMetrics([topUp("2026-04-10", 500)], BASE);
      expect(m.streakCurrent).toBe(4);
    });

    it("reports zero current streak when a top-up has already landed this month", () => {
      const m = computeCoverageMetrics([topUp("2026-08-05", 500)], BASE);
      expect(m.streakCurrent).toBe(0);
    });

    it("reports the best streak from anywhere in the window", () => {
      // Top-ups in 2025-09 and 2026-06 leave Oct'25..May'26 = 8 clean months,
      // and Jul-Aug'26 (Aug in progress) is a shorter trailing run of 2.
      const txns = [topUp("2025-09-10", 400), topUp("2026-06-10", 400)];
      const m = computeCoverageMetrics(txns, BASE);
      expect(m.streakBest).toBe(8);
      expect(m.streakCurrent).toBe(2); // Jul and the in-progress Aug
    });

    it("does not let unknown months extend a streak", () => {
      // Tracking starts 2026-06; Jun, Jul, Aug (in progress) are known and clean.
      const m = computeCoverageMetrics([], {
        ...BASE,
        trackingSince: "2026-06-01",
      });
      expect(m.streakBest).toBe(3);
      expect(m.streakCurrent).toBe(3);
    });
  });

  describe("second salary kept", () => {
    it("is null when the second salary is not configured", () => {
      const m = computeCoverageMetrics([topUp("2026-03-10", 500)], BASE);
      expect(m.secondSalaryKept).toBeNull();
    });

    it("is the share of the second salary that stayed in savings", () => {
      // 12 known months x $6,000 = $72,000; $2,220 drawn -> 96.9% kept.
      const txns = [topUp("2025-10-10", 1800), topUp("2026-04-10", 420)];
      const m = computeCoverageMetrics(txns, {
        ...BASE,
        secondSalaryMonthly: 6000,
      });
      expect(m.secondSalaryKept).toBeCloseTo(96.917, 2);
    });

    it("prorates to known months rather than assuming a full window", () => {
      // 4 known months (May-Aug, Aug in progress) x $2,000 = $8,000;
      // $600 drawn -> 92.5% kept.
      const m = computeCoverageMetrics([topUp("2026-06-10", 600)], {
        ...BASE,
        trackingSince: "2026-05-01",
        secondSalaryMonthly: 2000,
      });
      expect(m.secondSalaryKept).toBeCloseTo(92.5, 6);
    });

    it("is null when the configured second salary is zero", () => {
      const m = computeCoverageMetrics([topUp("2026-03-10", 500)], {
        ...BASE,
        secondSalaryMonthly: 0,
      });
      expect(m.secondSalaryKept).toBeNull();
    });

    it("is null when nothing is known yet, rather than dividing by zero", () => {
      const m = computeCoverageMetrics([], {
        ...BASE,
        trackingSince: "2026-09-01", // tracking starts after the current month
        secondSalaryMonthly: 6000,
      });
      expect(m.knownMonths).toBe(0);
      expect(m.secondSalaryKept).toBeNull();
      expect(m.averageMonthlyGap).toBe(0);
    });
  });

  it("returns months oldest-first and honours the window length", () => {
    const m = computeCoverageMetrics([], { ...BASE, windowMonths: 6 });
    expect(m.months).toHaveLength(6);
    expect(m.months[0].monthKey).toBe("2026-03");
    expect(m.months[5].monthKey).toBe("2026-08");
  });

  it("reproduces the worked 'Household A' example", () => {
    // The scenario from the design explainer: two shocks plus a four-month
    // structural episode (Dec-Mar), over Aug'25 - Jul'26.
    const txns = [
      topUp("2025-10-15", 1800),
      topUp("2025-12-15", 2400),
      topUp("2025-12-20", 300),
      topUp("2026-01-15", 350),
      topUp("2026-02-15", 420),
      topUp("2026-03-15", 380),
      topUp("2026-06-15", 900),
    ];
    const m = computeCoverageMetrics(txns, { ...BASE, secondSalaryMonthly: 6000 });
    expect(m.cleanMonths).toBe(6);
    expect(m.totalToppedUp).toBe(6550);
    expect(m.averageMonthlyGap).toBeCloseTo(545.83, 1);
    expect(m.typicalTopUp).toBe(660);
    expect(m.streakCurrent).toBe(2); // Jul and the in-progress Aug
    expect(m.streakBest).toBe(2);
    expect(m.secondSalaryKept).toBeCloseTo(90.9, 1);
  });

  it("tolerates a malformed date without throwing", () => {
    const bad: AdhocTransaction = {
      id: "b1", name: "Top Up", amount: 500, date: "not-a-date", kind: "topUp",
    };
    const m = computeCoverageMetrics([bad], BASE);
    expect(m.totalToppedUp).toBe(0);
  });

  describe("the current, in-progress month", () => {
    it("is the last bucket in the window, flagged incomplete", () => {
      const m = computeCoverageMetrics([], BASE);
      const current = m.months[m.months.length - 1];
      expect(current.monthKey).toBe("2026-08");
      expect(current.complete).toBe(false);
      expect(current.total).toBe(0);
    });

    it("folds a top-up dated this month into totals, clean count, and streaks immediately", () => {
      const m = computeCoverageMetrics([topUp("2026-08-05", 900)], BASE);
      expect(m.totalToppedUp).toBe(900);
      expect(m.cleanMonths).toBe(11);
      expect(m.streakCurrent).toBe(0);
    });

    it("can itself be unknown, when tracking hasn't started yet", () => {
      const m = computeCoverageMetrics([topUp("2026-08-05", 900)], {
        ...BASE,
        trackingSince: "2026-09-01",
      });
      const current = m.months.find((b) => b.monthKey === "2026-08")!;
      expect(current.known).toBe(false);
      expect(m.totalToppedUp).toBe(0);
    });
  });
});
