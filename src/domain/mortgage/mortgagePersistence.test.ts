// src/domain/mortgage/mortgagePersistence.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadMortgageUIState,
  saveMortgageUIState,
  createDefaultMortgageUIState,
  sanitizeMortgageUIState,
  type MortgageUIState,
} from "./persistence";

const validTerms = {
  principal: 300_000,
  annualRate: 0.05,
  termMonths: 360,
  startDate: "2025-01-01",
};

describe("sanitizeMortgageUIState (validator branches)", () => {
  it("rejects non-object and missing/invalid terms", () => {
    expect(sanitizeMortgageUIState(null)).toBeNull();
    expect(sanitizeMortgageUIState("nope")).toBeNull();
    expect(sanitizeMortgageUIState({})).toBeNull(); // terms undefined
    expect(sanitizeMortgageUIState({ terms: "x" })).toBeNull(); // terms not object
    expect(sanitizeMortgageUIState({ terms: { principal: -1 } })).toBeNull();
  });

  it("drops falsy/invalid prepayment entries", () => {
    const s = sanitizeMortgageUIState({
      terms: validTerms,
      prepayments: [null, { date: "2025-02-01", amount: 0 }, "x"],
    });
    expect(s!.prepayments).toEqual([]);
  });

  it("drops a non-array scenarios value and falsy scenario entries", () => {
    expect(
      sanitizeMortgageUIState({ terms: validTerms, scenarios: "nope" })!.scenarios
    ).toEqual([]);
    expect(
      sanitizeMortgageUIState({ terms: validTerms, scenarios: [null, { id: 1 }] })!
        .scenarios
    ).toEqual([]);
  });

  it("keeps valid prepayments and scenarios", () => {
    const s = sanitizeMortgageUIState({
      terms: validTerms,
      prepayments: [{ date: "2025-02-01", amount: 500 }],
      scenarios: [{ id: "a", name: "A", active: true, patterns: [] }],
    });
    expect(s!.prepayments).toHaveLength(1);
    expect(s!.scenarios).toHaveLength(1);
  });
});

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

  it("sanitizes invalid nested fields when loading v2 (keeps valid terms)", () => {
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({
        terms: { principal: 400_000, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" },
        prepayments: [{ date: "2025-06-01", amount: -50 }], // invalid amount => dropped
        asOfDate: "   ", // blank => falls back to startDate
        scenarios: [{ id: 1, name: "bad" }], // invalid id type => empty
      })
    );
    const state = loadMortgageUIState();
    expect(state.terms.principal).toBe(400_000);
    expect(state.prepayments).toEqual([]);
    expect(state.asOfDate).toBe("2025-01-01");
    expect(state.scenarios).toEqual([]);
  });

  it("treats a literal 'null' payload as empty and returns defaults", () => {
    window.localStorage.setItem("finance-cockpit-mortgage-v2", "null");
    expect(loadMortgageUIState()).toEqual(createDefaultMortgageUIState());
  });

  it("returns defaults when v2 terms are invalid", () => {
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({ terms: { principal: -1 }, prepayments: [] })
    );
    const state = loadMortgageUIState();
    expect(state).toEqual(createDefaultMortgageUIState());
  });

  it("saveMortgageUIState repairs invalid fields before persisting", () => {
    const dirty = {
      terms: { principal: -1, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" },
      prepayments: "nope",
      asOfDate: "",
      scenarios: "nope",
    } as any;
    saveMortgageUIState(dirty);

    const raw = JSON.parse(
      window.localStorage.getItem("finance-cockpit-mortgage-v2")!
    );
    // Invalid terms are replaced with the default terms.
    expect(raw.terms).toEqual(createDefaultMortgageUIState().terms);
    expect(raw.prepayments).toEqual([]);
    expect(raw.scenarios).toEqual([]);
    // asOfDate falls back to the (dirty) state's terms.startDate.
    expect(raw.asOfDate).toBe("2025-01-01");
  });

  it("saveMortgageUIState persists a fully valid state unchanged", () => {
    const clean = createDefaultMortgageUIState();
    clean.terms.principal = 250_000;
    saveMortgageUIState(clean);
    expect(loadMortgageUIState().terms.principal).toBe(250_000);
  });

  it("ignores a legacy v1 payload with invalid terms", () => {
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v1",
      JSON.stringify({ terms: { principal: 0 }, prepayments: [] })
    );
    expect(loadMortgageUIState()).toEqual(createDefaultMortgageUIState());
  });

  it("migrates a v1 payload dropping invalid prepayments", () => {
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v1",
      JSON.stringify({
        terms: { principal: 500_000, annualRate: 0.04, termMonths: 360, startDate: "2020-01-01" },
        prepayments: "not an array",
      })
    );
    const state = loadMortgageUIState();
    expect(state.terms.principal).toBe(500_000);
    expect(state.prepayments).toEqual([]);
  });

  it("still migrates v1 even if persisting the upgrade throws", () => {
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v1",
      JSON.stringify({
        terms: { principal: 500_000, annualRate: 0.049, termMonths: 360, startDate: "2020-02-01" },
        prepayments: [],
      })
    );
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    const state = loadMortgageUIState();
    expect(state.terms.principal).toBe(500_000);
    spy.mockRestore();
  });

  it("saveMortgageUIState swallows storage write failures", () => {
    const spy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("quota");
      });
    expect(() => saveMortgageUIState(createDefaultMortgageUIState())).not.toThrow();
    spy.mockRestore();
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
