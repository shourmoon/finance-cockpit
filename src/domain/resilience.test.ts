// src/domain/resilience.test.ts
import { describe, it, expect } from "vitest";
import { computeCoverageMetrics } from "./resilience";
import type { AdhocTransaction } from "./types";

/** Terse helper: a recorded top-up. */
function topUp(
  date: string,
  amount: number,
  reason: "oneOff" | "shortfall" = "oneOff"
): AdhocTransaction {
  return { id: `t-${date}-${amount}`, name: "Top Up", amount, date, kind: "topUp", reason };
}

/** A transaction the user created themselves — never a top-up. */
function plain(date: string, amount: number, name = "Groceries"): AdhocTransaction {
  return { id: `p-${date}-${amount}`, name, amount, date };
}

const BASE = { asOf: "2026-08-15", trackingSince: "2025-08-01", windowMonths: 12 } as const;

describe("computeCoverageMetrics", () => {
  it("returns an empty, honest shape when nothing has been recorded", () => {
    const m = computeCoverageMetrics([], { ...BASE, lens: "all" });
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
    const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    expect(m.totalToppedUp).toBe(500);
    expect(m.cleanMonths).toBe(11);
  });

  it("excludes the current, incomplete month from every metric", () => {
    // A large top-up dated in the asOf month must not count yet.
    const m = computeCoverageMetrics([topUp("2026-08-05", 5000)], { ...BASE, lens: "all" });
    expect(m.totalToppedUp).toBe(0);
    expect(m.cleanMonths).toBe(12);
    expect(m.months.some((b) => b.monthKey === "2026-08")).toBe(false);
  });

  it("treats months before tracking began as unknown, not clean", () => {
    const m = computeCoverageMetrics([], {
      ...BASE,
      lens: "all",
      trackingSince: "2026-05-01",
    });
    // Complete months in window: 2025-08 .. 2026-07. Known: May, Jun, Jul '26.
    expect(m.knownMonths).toBe(3);
    expect(m.cleanMonths).toBe(3);
    expect(m.months.filter((b) => !b.known)).toHaveLength(9);
  });

  it("defaults to a 12-month window and treats every month as known when no tracking date is set", () => {
    // No windowMonths and no trackingSince — both defaults exercised.
    const m = computeCoverageMetrics([topUp("2025-09-10", 400)], {
      asOf: "2026-08-15",
      lens: "all",
    });
    expect(m.months).toHaveLength(12);
    expect(m.knownMonths).toBe(12);
    expect(m.cleanMonths).toBe(11);
  });

  it("ignores a malformed tracking date rather than hiding every month", () => {
    const m = computeCoverageMetrics([topUp("2026-03-10", 400)], {
      ...BASE,
      lens: "all",
      trackingSince: "garbage",
    });
    expect(m.knownMonths).toBe(12);
    expect(m.totalToppedUp).toBe(400);
  });

  it("filters by lens: recurring-only counts shortfalls, not one-offs", () => {
    const txns = [
      topUp("2026-02-10", 1800, "oneOff"),
      topUp("2026-03-10", 400, "shortfall"),
    ];
    const all = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    const rec = computeCoverageMetrics(txns, { ...BASE, lens: "recurring" });

    expect(all.totalToppedUp).toBe(2200);
    expect(all.cleanMonths).toBe(10);
    expect(rec.totalToppedUp).toBe(400);
    expect(rec.cleanMonths).toBe(11);
  });

  it("defaults a top-up with no recorded reason to one-off", () => {
    const untagged: AdhocTransaction = {
      id: "u1", name: "Top Up", amount: 300, date: "2026-03-10", kind: "topUp",
    };
    expect(computeCoverageMetrics([untagged], { ...BASE, lens: "all" }).totalToppedUp).toBe(300);
    expect(computeCoverageMetrics([untagged], { ...BASE, lens: "recurring" }).totalToppedUp).toBe(0);
  });

  it("sums several top-ups landing in the same month", () => {
    const txns = [topUp("2026-03-02", 200), topUp("2026-03-20", 450, "shortfall")];
    const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    expect(m.totalToppedUp).toBe(650);
    const march = m.months.find((b) => b.monthKey === "2026-03")!;
    expect(march.oneOff).toBe(200);
    expect(march.shortfall).toBe(450);
    expect(march.total).toBe(650);
  });

  it("ignores non-positive amounts, which are not top-ups", () => {
    const txns = [topUp("2026-03-10", 0), topUp("2026-04-10", -250)];
    const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    expect(m.totalToppedUp).toBe(0);
    expect(m.cleanMonths).toBe(12);
  });

  it("averages the gap over known months only, not a hardcoded 12", () => {
    // Only 3 known months, $600 drawn -> $200/mo, not $50.
    const m = computeCoverageMetrics([topUp("2026-06-10", 600)], {
      ...BASE,
      lens: "all",
      trackingSince: "2026-05-01",
    });
    expect(m.knownMonths).toBe(3);
    expect(m.averageMonthlyGap).toBe(200);
  });

  it("reports the typical top-up as the median of assisted months", () => {
    const txns = [
      topUp("2025-10-10", 300),
      topUp("2025-12-10", 500),
      topUp("2026-02-10", 1000),
    ];
    const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    expect(m.typicalTopUp).toBe(500); // median of 300, 500, 1000
  });

  it("averages the two middle months when the assisted count is even", () => {
    const txns = [topUp("2026-01-10", 300), topUp("2026-02-10", 500)];
    const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
    expect(m.typicalTopUp).toBe(400);
  });

  describe("streaks (clean months, the positive framing)", () => {
    it("reports the current streak trailing from the most recent complete month", () => {
      // Window ends 2026-07. A top-up in 2026-04 leaves May, Jun, Jul clean.
      const m = computeCoverageMetrics([topUp("2026-04-10", 500)], { ...BASE, lens: "all" });
      expect(m.streakCurrent).toBe(3);
    });

    it("reports zero current streak when the latest complete month needed a top-up", () => {
      const m = computeCoverageMetrics([topUp("2026-07-10", 500)], { ...BASE, lens: "all" });
      expect(m.streakCurrent).toBe(0);
    });

    it("reports the best streak from anywhere in the window", () => {
      // Top-ups in 2025-09 and 2026-06 leave Oct'25..May'26 = 8 clean months.
      const txns = [topUp("2025-09-10", 400), topUp("2026-06-10", 400)];
      const m = computeCoverageMetrics(txns, { ...BASE, lens: "all" });
      expect(m.streakBest).toBe(8);
      expect(m.streakCurrent).toBe(1); // only 2026-07
    });

    it("does not let unknown months extend a streak", () => {
      // Tracking starts 2026-06; only Jun and Jul are known and clean.
      const m = computeCoverageMetrics([], {
        ...BASE,
        lens: "all",
        trackingSince: "2026-06-01",
      });
      expect(m.streakBest).toBe(2);
      expect(m.streakCurrent).toBe(2);
    });
  });

  describe("second salary kept", () => {
    it("is null when the second salary is not configured", () => {
      const m = computeCoverageMetrics([topUp("2026-03-10", 500)], { ...BASE, lens: "all" });
      expect(m.secondSalaryKept).toBeNull();
    });

    it("is the share of the second salary that stayed in savings", () => {
      // 12 known months x $6,000 = $72,000; $2,220 drawn -> 96.9% kept.
      const txns = [topUp("2025-10-10", 1800), topUp("2026-04-10", 420)];
      const m = computeCoverageMetrics(txns, {
        ...BASE,
        lens: "all",
        secondSalaryMonthly: 6000,
      });
      expect(m.secondSalaryKept).toBeCloseTo(96.917, 2);
    });

    it("prorates to known months rather than assuming a full window", () => {
      // 3 known months x $2,000 = $6,000; $600 drawn -> 90% kept.
      const m = computeCoverageMetrics([topUp("2026-06-10", 600)], {
        ...BASE,
        lens: "all",
        trackingSince: "2026-05-01",
        secondSalaryMonthly: 2000,
      });
      expect(m.secondSalaryKept).toBeCloseTo(90, 6);
    });

    it("is null when the configured second salary is zero", () => {
      const m = computeCoverageMetrics([topUp("2026-03-10", 500)], {
        ...BASE,
        lens: "all",
        secondSalaryMonthly: 0,
      });
      expect(m.secondSalaryKept).toBeNull();
    });

    it("is null when nothing is known yet, rather than dividing by zero", () => {
      const m = computeCoverageMetrics([], {
        ...BASE,
        lens: "all",
        trackingSince: "2026-08-01", // tracking starts in the current month
        secondSalaryMonthly: 6000,
      });
      expect(m.knownMonths).toBe(0);
      expect(m.secondSalaryKept).toBeNull();
      expect(m.averageMonthlyGap).toBe(0);
    });
  });

  it("returns months oldest-first and honours the window length", () => {
    const m = computeCoverageMetrics([], { ...BASE, lens: "all", windowMonths: 6 });
    expect(m.months).toHaveLength(6);
    expect(m.months[0].monthKey).toBe("2026-02");
    expect(m.months[5].monthKey).toBe("2026-07");
  });

  it("reproduces the worked 'Household A' example under both lenses", () => {
    // The scenario from the design explainer: two shocks plus a four-month
    // structural episode (Dec-Mar), over Aug'25 - Jul'26.
    const txns = [
      topUp("2025-10-15", 1800, "oneOff"),
      topUp("2025-12-15", 2400, "oneOff"),
      topUp("2025-12-20", 300, "shortfall"),
      topUp("2026-01-15", 350, "shortfall"),
      topUp("2026-02-15", 420, "shortfall"),
      topUp("2026-03-15", 380, "shortfall"),
      topUp("2026-06-15", 900, "oneOff"),
    ];
    const all = computeCoverageMetrics(txns, { ...BASE, lens: "all", secondSalaryMonthly: 6000 });
    expect(all.cleanMonths).toBe(6);
    expect(all.totalToppedUp).toBe(6550);
    expect(all.averageMonthlyGap).toBeCloseTo(545.83, 1);
    expect(all.typicalTopUp).toBe(660);
    expect(all.streakCurrent).toBe(1);
    expect(all.streakBest).toBe(2);
    expect(all.secondSalaryKept).toBeCloseTo(90.9, 1);

    const rec = computeCoverageMetrics(txns, {
      ...BASE, lens: "recurring", secondSalaryMonthly: 6000,
    });
    expect(rec.cleanMonths).toBe(8);
    expect(rec.totalToppedUp).toBe(1450);
    expect(rec.averageMonthlyGap).toBeCloseTo(120.83, 1);
    expect(rec.typicalTopUp).toBe(365);
    expect(rec.streakCurrent).toBe(4);
    expect(rec.streakBest).toBe(4);
    expect(rec.secondSalaryKept).toBeCloseTo(97.98, 1);
  });

  it("tolerates a malformed date without throwing", () => {
    const bad: AdhocTransaction = {
      id: "b1", name: "Top Up", amount: 500, date: "not-a-date", kind: "topUp", reason: "oneOff",
    };
    const m = computeCoverageMetrics([bad], { ...BASE, lens: "all" });
    expect(m.totalToppedUp).toBe(0);
  });
});
