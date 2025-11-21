// src/domain/safeToSpendEngine.test.ts
import { computeSafeToSpendFromEvents } from "./safeToSpendEngine";
import type { Money } from "./types";

function evt(date: string, amount: Money) {
  return { date, effectiveAmount: amount };
}

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
