// src/domain/contributionPlan.test.ts
//
// The plan is expanded into dated amounts exactly once, and both destinations
// consume that same expansion — the mortgage as extra principal, the market as
// investments. That is the whole point of the module: if the two sides built
// their own schedules they could drift, and a comparison whose two arms are
// funded differently is worthless however carefully the rest is computed.

import { describe, it, expect } from "vitest";
import { expandContributionPlan, type ContributionPlan } from "./contributionPlan";

const plan = (over: Partial<ContributionPlan> = {}): ContributionPlan => ({
  asOfDate: "2026-08-01",
  lumpSum: 0,
  monthly: 0,
  yearly: 0,
  ...over,
});

const total = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);

describe("expandContributionPlan", () => {
  it("is empty when nothing is committed", () => {
    expect(expandContributionPlan(plan(), 360)).toEqual([]);
  });

  it("places a lump sum on the as-of date", () => {
    const out = expandContributionPlan(plan({ lumpSum: 72_000 }), 360);
    expect(out).toEqual([{ date: "2026-08-01", amount: 72_000 }]);
  });

  it("repeats a monthly amount on the same day each month", () => {
    const out = expandContributionPlan(plan({ monthly: 2_000 }), 6);
    expect(out.map((c) => c.date)).toEqual([
      "2026-08-01", "2026-09-01", "2026-10-01",
      "2026-11-01", "2026-12-01", "2027-01-01",
    ]);
    expect(out.every((c) => c.amount === 2_000)).toBe(true);
  });

  it("repeats a yearly amount in the chosen month", () => {
    const out = expandContributionPlan(
      plan({ yearly: 15_000, yearlyMonth: 3 }),
      36
    );
    expect(out.map((c) => c.date)).toEqual([
      "2027-03-01", "2028-03-01", "2029-03-01",
    ]);
    expect(total(out)).toBe(45_000);
  });

  it("includes a yearly month that is still ahead in the current year", () => {
    // As-of August, a December bonus lands this year, not next.
    const out = expandContributionPlan(
      plan({ yearly: 10_000, yearlyMonth: 12 }),
      18
    );
    expect(out[0].date).toBe("2026-12-01");
  });

  it("defaults the yearly month to the as-of month", () => {
    const out = expandContributionPlan(plan({ yearly: 5_000 }), 30);
    expect(out[0].date).toBe("2026-08-01");
    expect(out[1].date).toBe("2027-08-01");
  });

  it("stops both recurring streams after the until date", () => {
    // "I can keep this up until the end of 2028."
    const out = expandContributionPlan(
      plan({ monthly: 1_000, yearly: 10_000, yearlyMonth: 3, until: "2028-12-31" }),
      360
    );
    expect(out.every((c) => c.date <= "2028-12-31")).toBe(true);
    // 29 months (Aug '26 through Dec '28), of which two also carry a March
    // bonus and so merge into a single larger entry.
    expect(out).toHaveLength(29);
    expect(total(out)).toBe(29 * 1_000 + 2 * 10_000);
    expect(out.filter((c) => c.amount === 11_000).map((c) => c.date)).toEqual([
      "2027-03-01",
      "2028-03-01",
    ]);
  });

  it("leaves a lump sum alone even when the until date precedes it", () => {
    // The lump is committed now; an end date bounds only the streams.
    const out = expandContributionPlan(
      plan({ lumpSum: 50_000, monthly: 1_000, until: "2020-01-01" }),
      360
    );
    expect(out).toEqual([{ date: "2026-08-01", amount: 50_000 }]);
  });

  it("merges same-day amounts into one entry", () => {
    // A lump, a monthly instalment and a bonus can all land on the as-of
    // date. Emitting three entries would still be applied correctly by the
    // amortizer, but the market walk buckets by date and duplicates are a
    // needless source of ordering bugs.
    const out = expandContributionPlan(
      plan({ lumpSum: 10_000, monthly: 2_000, yearly: 5_000, yearlyMonth: 8 }),
      1
    );
    expect(out).toEqual([{ date: "2026-08-01", amount: 17_000 }]);
  });

  it("returns entries in date order", () => {
    const out = expandContributionPlan(
      plan({ lumpSum: 1_000, monthly: 100, yearly: 500, yearlyMonth: 1 }),
      40
    );
    const dates = out.map((c) => c.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("ignores amounts that are zero, negative or not numbers", () => {
    for (const bad of [0, -100, Number.NaN, Number.POSITIVE_INFINITY]) {
      const out = expandContributionPlan(
        plan({ lumpSum: bad, monthly: bad, yearly: bad }),
        24
      );
      expect(out).toEqual([]);
    }
  });

  it("ignores an unusable yearly month rather than guessing", () => {
    for (const yearlyMonth of [0, 13, -1, 1.5, Number.NaN]) {
      const out = expandContributionPlan(plan({ yearly: 5_000, yearlyMonth }), 30);
      // Falls back to the as-of month rather than emitting a bad date.
      expect(out[0].date).toBe("2026-08-01");
    }
  });

  it("ignores an unusable until date rather than stopping everything", () => {
    // A corrupt end date must not silently cancel the plan.
    const out = expandContributionPlan(
      plan({ monthly: 1_000, until: "not-a-date" }),
      12
    );
    expect(out).toHaveLength(12);
  });

  it("emits only real calendar days", () => {
    // Month-end arithmetic is where date bugs hide: a 31st rolls to the 30th
    // and the 28th, never to an impossible day.
    const out = expandContributionPlan(
      { asOfDate: "2026-01-31", lumpSum: 0, monthly: 500, yearly: 0 },
      26
    );
    for (const c of out) {
      const [y, m, d] = c.date.split("-").map(Number);
      const back = new Date(Date.UTC(y, m - 1, d));
      expect(back.getUTCFullYear()).toBe(y);
      expect(back.getUTCMonth()).toBe(m - 1);
      expect(back.getUTCDate()).toBe(d);
    }
  });

  it("generates nothing for a zero or unusable horizon", () => {
    for (const months of [0, -12, Number.NaN, Number.POSITIVE_INFINITY]) {
      // The lump is committed at asOfDate regardless of horizon; only the
      // streams need months to run over.
      expect(expandContributionPlan(plan({ monthly: 1_000 }), months)).toEqual([]);
      expect(expandContributionPlan(plan({ lumpSum: 500 }), months)).toEqual([
        { date: "2026-08-01", amount: 500 },
      ]);
    }
  });

  it("never generates beyond the requested number of months", () => {
    const out = expandContributionPlan(plan({ monthly: 100, yearly: 100 }), 12);
    expect(out.every((c) => c.date < "2027-08-02")).toBe(true);
  });
});
