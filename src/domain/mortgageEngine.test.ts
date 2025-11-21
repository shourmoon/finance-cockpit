// src/domain/mortgageEngine.test.ts
import { computeMonthlyPayment, simulateMortgage } from "./mortgageEngine";
import type { MortgageConfig } from "./types";

describe("mortgageEngine - computeMonthlyPayment", () => {
  test("zero interest spreads principal evenly over term", () => {
    const cfg: MortgageConfig = {
      principal: 120000,
      annualRate: 0,
      termMonths: 120,
      startDate: "2025-01-01",
      monthlyPayment: 0, // ignored when annualRate = 0
    };

    const payment = computeMonthlyPayment(cfg);
    expect(payment).toBeCloseTo(1000, 5);
  });

  test("positive interest returns payment greater than principal/term", () => {
    const cfg: MortgageConfig = {
      principal: 300000,
      annualRate: 0.04,
      termMonths: 360,
      startDate: "2025-01-01",
      monthlyPayment: 0,
    };
    const payment = computeMonthlyPayment(cfg);

    const naive = 300000 / 360;
    expect(payment).toBeGreaterThan(naive);
    expect(payment).toBeCloseTo(1432, -1); // rough magnitude check
  });
});

describe("mortgageEngine - simulateMortgage", () => {
  function makeConfig(): MortgageConfig {
    const base: MortgageConfig = {
      principal: 300000,
      annualRate: 0.04,
      termMonths: 360,
      startDate: "2025-01-01",
      monthlyPayment: 0, // we will fill this in
    };
    const payment = computeMonthlyPayment(base);
    return { ...base, monthlyPayment: payment };
  }

  test("baseline simulation produces decreasing balance and payoff", () => {
    const cfg = makeConfig();
    const result = simulateMortgage(cfg, 0);

    expect(result.schedule.length).toBeGreaterThan(0);
    const last = result.schedule[result.schedule.length - 1];
    expect(last.remainingBalance).toBeCloseTo(0, 2);
    expect(typeof result.totalInterestPaid).toBe("number");
    expect(typeof result.payoffDate).toBe("string");
  });

  test("extra monthly payment reduces total interest and payoff date", () => {
    const cfg = makeConfig();

    const baseline = simulateMortgage(cfg, 0);
    const extra = simulateMortgage(cfg, 200); // extra $200/month

    expect(extra.totalInterestPaid).toBeLessThan(
      baseline.totalInterestPaid
    );
    expect(extra.interestSaved).toBeGreaterThan(0);

    // payoffDate should be earlier (lexicographically smaller ISO)
    expect(extra.payoffDate < baseline.payoffDate).toBe(true);
  });

  test("simulateMortgage with zero interest behaves like straight-line payoff", () => {
    const cfg: MortgageConfig = {
      principal: 120000,
      annualRate: 0,
      termMonths: 120,
      startDate: "2025-01-01",
      monthlyPayment: 1000,
    };

    const result = simulateMortgage(cfg, 0);

    const last = result.schedule[result.schedule.length - 1];
    expect(last.remainingBalance).toBeCloseTo(0, 5);
    expect(result.totalInterestPaid).toBeCloseTo(0, 5);
    expect(result.interestSaved).toBe(0);
  });
});
