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


  it("keeps a biweekly payment frequency", () => {
    const s = sanitizeMortgageUIState({
      terms: { ...validTerms, paymentFrequency: "biweekly" },
    });
    expect(s!.terms.paymentFrequency).toBe("biweekly");
  });

  it("treats an absent or unrecognised frequency as monthly", () => {
    expect(sanitizeMortgageUIState({ terms: validTerms })!.terms.paymentFrequency)
      .toBe("monthly");
    expect(
      sanitizeMortgageUIState({
        terms: { ...validTerms, paymentFrequency: "fortnightly" },
      })!.terms.paymentFrequency
    ).toBe("monthly");
  });

  it("round-trips the frequency through save and load", () => {
    const state = createDefaultMortgageUIState();
    state.terms = { ...state.terms, paymentFrequency: "biweekly" };
    saveMortgageUIState(state);
    expect(loadMortgageUIState().terms.paymentFrequency).toBe("biweekly");
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
      })
    );
    const state = loadMortgageUIState();
    expect(state.terms.principal).toBe(400_000);
    expect(state.prepayments).toEqual([]);
    expect(state.asOfDate).toBe("2025-01-01");
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

  it("never overwrites a valid persisted loan with defaults when asked to save invalid terms", () => {
    // A real loan the user has been using.
    const real: MortgageUIState = {
      terms: {
        principal: 680_000,
        annualRate: 0.0475,
        termMonths: 360,
        startDate: "2023-06-01",
        paymentFrequency: "monthly",
      },
      prepayments: [{ date: "2024-01-15", amount: 10_000, note: "bonus" }],
      asOfDate: "2025-06-01",
    };
    saveMortgageUIState(real);

    // Something hands us unusable terms (a mid-edit value, a bad sync
    // payload). Substituting the hard-coded defaults here would destroy
    // the user's actual mortgage, so the previous terms must survive.
    saveMortgageUIState({
      ...real,
      terms: { ...real.terms, principal: -1 },
    });

    const reloaded = loadMortgageUIState();
    expect(reloaded.terms).toEqual(real.terms);
    expect(reloaded.prepayments).toEqual(real.prepayments);
  });

  it("falls back to defaults for invalid terms only when nothing valid was ever stored", () => {
    saveMortgageUIState({
      terms: { principal: -1, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" },
      prepayments: [],
      asOfDate: "2025-01-01",
    } as MortgageUIState);
    expect(loadMortgageUIState().terms).toEqual(createDefaultMortgageUIState().terms);
  });

  it("saveMortgageUIState repairs invalid fields before persisting", () => {
    const dirty = {
      terms: { principal: -1, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" },
      prepayments: "nope",
      asOfDate: "",
    } as any;
    saveMortgageUIState(dirty);

    const raw = JSON.parse(
      window.localStorage.getItem("finance-cockpit-mortgage-v2")!
    );
    // Invalid terms are replaced with the default terms.
    expect(raw.terms).toEqual(createDefaultMortgageUIState().terms);
    expect(raw.prepayments).toEqual([]);
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

  it("still loads a payload carrying the retired scenarios field", () => {
    // What-if scenarios were removed, but stored localStorage values and
    // in-flight sync snapshots still carry the field. Parsing must ignore it
    // rather than reject the payload — otherwise retiring the feature would
    // wipe a user's real loan on their next load.
    window.localStorage.setItem(
      "finance-cockpit-mortgage-v2",
      JSON.stringify({
        terms: {
          principal: 680000, annualRate: 0.0475, termMonths: 360,
          startDate: "2023-06-01",
        },
        prepayments: [{ date: "2025-01-01", amount: 150000 }],
        asOfDate: "2026-08-01",
        scenarios: [
          { id: "s1", name: "Aggressive", patterns: [{ id: "p1", kind: "monthly", amount: 1000 }] },
        ],
      })
    );

    const state = loadMortgageUIState();
    expect(state.terms.principal).toBe(680000);
    expect(state.prepayments).toHaveLength(1);
    expect(state.asOfDate).toBe("2026-08-01");
    expect((state as Record<string, unknown>).scenarios).toBeUndefined();
  });

  it("drops the retired scenarios field on the next save", () => {
    saveMortgageUIState({
      terms: {
        principal: 680000, annualRate: 0.0475, termMonths: 360,
        startDate: "2023-06-01",
      },
      prepayments: [],
      asOfDate: "2026-08-01",
      ...({ scenarios: [{ id: "s1", name: "stale" }] } as object),
    });
    const raw = JSON.parse(
      window.localStorage.getItem("finance-cockpit-mortgage-v2")!
    );
    expect(raw.scenarios).toBeUndefined();
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
  });
});
