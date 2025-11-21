// src/domain/mortgage/mortgagePersistence.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
  type MortgageUIState,
} from "./persistence";

describe("mortgage persistence v2", () => {
  beforeEach(() => {
    // jsdom gives us window.localStorage
    window.localStorage.clear();
  });

  it("returns defaults when nothing is in storage", () => {
    const state = loadMortgageUIState();
    const defaults = createDefaultMortgageUIState();

    expect(state.terms.principal).toBe(defaults.terms.principal);
    expect(state.terms.annualRate).toBe(defaults.terms.annualRate);
    expect(state.terms.termMonths).toBe(defaults.terms.termMonths);
    expect(state.prepayments.length).toBe(0);
    expect(state.asOfDate).toBe(defaults.asOfDate);
    expect(Array.isArray(state.scenarios)).toBe(true);
  });

  it("round-trips a customised state through save/load", () => {
    const custom: MortgageUIState = {
      terms: {
        principal: 450_000,
        annualRate: 0.0475,
        termMonths: 300,
        startDate: "2023-04-01",
      },
      prepayments: [
        { date: "2024-01-01", amount: 1_000, note: "New year extra" },
        { date: "2024-06-01", amount: 2_500, note: "Bonus" },
      ],
      asOfDate: "2024-07-01",
      scenarios: [
        {
          id: "s1",
          name: "Extra 200 monthly",
          description: "",
          active: true,
          patterns: [
            {
              id: "p1",
              label: "200 every month",
              kind: "monthly",
              amount: 200,
              startDate: "2024-07-01",
              dayOfMonthStrategy: "same-as-due-date",
            },
          ],
        },
      ],
    };

    saveMortgageUIState(custom);
    const reloaded = loadMortgageUIState();

    expect(reloaded.terms).toEqual(custom.terms);
    expect(reloaded.prepayments).toEqual(custom.prepayments);
    expect(reloaded.asOfDate).toBe(custom.asOfDate);
    expect(reloaded.scenarios.length).toBe(1);
    expect(reloaded.scenarios[0].name).toBe("Extra 200 monthly");
    expect(reloaded.scenarios[0].patterns[0].kind).toBe("monthly");
  });

  it("treats malformed JSON as missing and falls back to defaults", () => {
    // Simulate corrupted storage for v2
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      "{ not valid json"
    );

    const state = loadMortgageUIState();
    const defaults = createDefaultMortgageUIState();

    expect(state.terms.principal).toBe(defaults.terms.principal);
    expect(state.prepayments.length).toBe(0);
  });

  it("migrates legacy v1 shape if present", () => {
    const legacyPayload = {
      terms: {
        principal: 500_000,
        annualRate: 0.049,
        termMonths: 360,
        startDate: "2020-02-01",
      },
      prepayments: [
        { date: "2021-12-01", amount: 5_000, note: "bonus" },
      ],
    };

    window.localStorage.setItem(
      "finance-cockpit-mortgage-v1",
      JSON.stringify(legacyPayload)
    );

    const state = loadMortgageUIState();

    expect(state.terms).toEqual(legacyPayload.terms);
    expect(state.prepayments).toEqual(legacyPayload.prepayments);
    // asOfDate should default to startDate on migration
    expect(state.asOfDate).toBe(legacyPayload.terms.startDate);
    // legacy didn't have scenarios; we should get an empty array
    expect(Array.isArray(state.scenarios)).toBe(true);
    expect(state.scenarios.length).toBe(0);
  });
});
