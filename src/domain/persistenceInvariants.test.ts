// src/domain/persistenceInvariants.test.ts
//
// The third money-adjacent surface, given the same treatment as
// allocationInvariants and cashflowInvariants. See CLAUDE.md, "The checklist
// for money code".
//
// This layer is where the worst failures live, because they are silent and
// permanent. A projection that computes the wrong number is visibly wrong the
// next time you look; a save that quietly drops a rule, or an upgrade that
// re-stamps the coverage clock, destroys history that cannot be recovered.
// Two such defects have already shipped here — saveMortgageUIState replacing
// a real $680k loan with the hard-coded defaults, and a spread carrying a
// retired field back into storage forever.
//
// So the laws below are mostly about LOSS: what goes in must come out, an
// upgrade must never take data away, and no input, however corrupt, may
// throw or invent numbers.

import { describe, it, expect, beforeEach } from "vitest";
import { upgradeAppState, APP_STATE_VERSION, createInitialAppState } from "./appState";
import { saveAppState, loadAppState } from "./persistence";
import {
  sanitizeMortgageUIState,
  saveMortgageUIState,
  loadMortgageUIState,
  createDefaultMortgageUIState,
} from "./mortgage/persistence";
import { createSnapshot, parseSnapshot } from "./persistence/snapshot";
import type { AppState } from "./types";
import type { MortgageUIState } from "./mortgage/persistence";

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

/**
 * Returns the RAW stored shape alongside the upgraded state.
 *
 * The laws below compare against `raw`, never against the upgraded value.
 * Generating the expectation by running the same function under test makes
 * the pair move together: a mutation that drops a field drops it from both
 * sides and the test still passes. Two mutations survived this suite for
 * exactly that reason before it was written this way.
 */
function generateAppState(r: () => number): { raw: any; state: AppState } {
  const raw = {
    version: 4,
    account: { startingBalance: Math.floor(r() * 40_000) - 8_000 },
    settings: {
      startDate: iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      horizonDays: 1 + Math.floor(r() * 3000),
      minSafeBalance: Math.floor(r() * 9_000),
      trackingSince: iso(2024 + Math.floor(r() * 2), 1 + Math.floor(r() * 12), 1),
      coverageLens: r() < 0.5 ? "recurring" : "all",
      ...(r() < 0.5 ? { secondSalaryMonthly: Math.floor(r() * 9000) } : {}),
      surplus: {
        ...(r() < 0.7 ? { parkedCash: Math.floor(r() * 400_000) } : {}),
        monthlyContribution: r() < 0.5 ? 0 : Math.floor(r() * 8_000),
        yearlyContribution: r() < 0.5 ? 0 : Math.floor(r() * 50_000),
        yearlyMonth: 1 + Math.floor(r() * 12),
        ...(r() < 0.4
          ? { contributionsUntil: iso(2030 + Math.floor(r() * 5), 6, 30) }
          : {}),
        reserveMonths: 1 + Math.floor(r() * 18),
        expectedReturn: r() * 0.2 + 0.001,
        capitalGainsRate: r() * 0.5 + 0.001,
        horizonYears: 1 + Math.floor(r() * 50),
      },
    },
    rules: Array.from({ length: Math.floor(r() * 7) }, (_, i) => ({
      id: `r${i}`,
      name: `rule ${i}`,
      amount: (r() < 0.5 ? 1 : -1) * Math.floor(r() * 9000 + 1),
      isVariable: r() < 0.3,
      schedule:
        r() < 0.5
          ? { type: "monthly", day: 1 + Math.floor(r() * 31) }
          : { type: "biweekly", anchorDate: iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)) },
    })),
    adhocTransactions: Array.from({ length: Math.floor(r() * 5) }, (_, i) => ({
      id: `a${i}`,
      name: `txn ${i}`,
      amount: (r() < 0.5 ? 1 : -1) * Math.floor(r() * 6000 + 1),
      date: iso(2026, 1 + Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
      ...(r() < 0.4 ? { kind: "topUp", reason: r() < 0.5 ? "shortfall" : "oneOff" } : {}),
    })),
    overrides: {},
  };
  return { raw, state: upgradeAppState(raw) };
}

function generateMortgageState(r: () => number): MortgageUIState {
  return sanitizeMortgageUIState({
    terms: {
      principal: 50_000 + Math.floor(r() * 1_500_000),
      annualRate: r() * 0.1,
      termMonths: [120, 180, 240, 360][Math.floor(r() * 4)],
      startDate: iso(2010 + Math.floor(r() * 16), 1 + Math.floor(r() * 12), 1),
      paymentFrequency: r() < 0.5 ? "biweekly" : "monthly",
    },
    prepayments: Array.from({ length: Math.floor(r() * 5) }, () => ({
      date: iso(2020 + Math.floor(r() * 7), 1 + Math.floor(r() * 12), 1),
      amount: Math.floor(r() * 200_000) + 1,
    })),
    asOfDate: iso(2026, 1 + Math.floor(r() * 12), 1),
  })!;
}

const R = rng(20260805);
const GENERATED = Array.from({ length: 100 }, () => generateAppState(R));
const APP_STATES = GENERATED.map((g) => g.state);
const MORTGAGE_STATES = Array.from({ length: 100 }, () => generateMortgageState(R));

/** Structurally hostile values, for the "must never throw" laws. */
const GARBAGE: unknown[] = [
  null, undefined, 0, -1, NaN, Infinity, "", "nope", true, false,
  [], [1, 2, 3], {}, { version: "x" }, { version: 99 },
  { version: 4, account: null, settings: null, rules: null },
  { version: 4, rules: "not an array", adhocTransactions: 7, overrides: [] },
  { version: 4, settings: { startDate: "hello", horizonDays: -1, minSafeBalance: NaN } },
  { terms: null }, { terms: { principal: "lots" } },
  { terms: { principal: 1, annualRate: 0, termMonths: 0, startDate: "2026-13-45" } },
  { schemaVersion: "x", app_state: 1, mortgage_ui: 2 },
];

describe("persistence invariants (property-based)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("round-trips app state through storage without loss", () => {
    // The most basic promise the app makes: what you entered is what comes
    // back. Anything dropped here is dropped permanently.
    for (const state of APP_STATES) {
      window.localStorage.clear();
      saveAppState(state);
      const back = loadAppState();
      expect(back).not.toBeNull();
      expect(back).toEqual(state);
    }
  });

  it("round-trips mortgage state through storage without loss", () => {
    for (const state of MORTGAGE_STATES) {
      window.localStorage.clear();
      saveMortgageUIState(state);
      expect(loadMortgageUIState()).toEqual(state);
    }
  });

  it("round-trips a snapshot through the wire without loss", () => {
    // Sync serialises to JSON and back. A field that does not survive that
    // trip is a field that silently differs between the user's devices.
    for (let i = 0; i < APP_STATES.length; i++) {
      const snap = createSnapshot(
        APP_STATES[i],
        MORTGAGE_STATES[i],
        `device-${i}`,
        "2026-08-04T00:00:00.000Z"
      );
      const back = parseSnapshot(JSON.parse(JSON.stringify(snap)));
      expect(back).not.toBeNull();
      expect(back!.app_state).toEqual(snap.app_state);
      expect(back!.mortgage_ui).toEqual(snap.mortgage_ui);
      expect(back!.updated_at).toBe(snap.updated_at);
      expect(back!.device_id).toBe(snap.device_id);
    }
  });

  it("upgrades idempotently", () => {
    // Loading twice must not differ from loading once. An upgrade that is not
    // idempotent drifts a little further from the truth on every launch —
    // which is exactly how a re-stamped trackingSince would erase history.
    for (const state of APP_STATES) {
      const once = upgradeAppState(state);
      const twice = upgradeAppState(once);
      expect(twice).toEqual(once);
      expect(once.version).toBe(APP_STATE_VERSION);
    }
    for (const state of MORTGAGE_STATES) {
      expect(sanitizeMortgageUIState(sanitizeMortgageUIState(state))).toEqual(
        sanitizeMortgageUIState(state)
      );
    }
  });

  it("never loses a valid rule or transaction on upgrade", () => {
    for (const state of APP_STATES) {
      const up = upgradeAppState(state);
      expect(up.rules).toHaveLength(state.rules.length);
      expect(up.adhocTransactions).toHaveLength(state.adhocTransactions.length);
      // Amounts are money and must survive exactly, not approximately.
      for (let i = 0; i < state.rules.length; i++) {
        expect(up.rules[i].amount).toBe(state.rules[i].amount);
        expect(up.rules[i].id).toBe(state.rules[i].id);
      }
      for (let i = 0; i < state.adhocTransactions.length; i++) {
        expect(up.adhocTransactions[i].amount).toBe(
          state.adhocTransactions[i].amount
        );
      }
    }
  });

  it("never re-stamps the coverage clock", () => {
    // trackingSince is the boundary between "we were not recording" and "this
    // month was genuinely clean". Moving it forward silently rewrites the
    // household's history as better than it was. Compared against the STORED
    // value, not against a previous upgrade's output.
    for (const { raw, state } of GENERATED) {
      expect(state.settings.trackingSince).toBe(raw.settings.trackingSince);
      let current = state;
      for (let i = 0; i < 5; i++) current = upgradeAppState(current);
      expect(current.settings.trackingSince).toBe(raw.settings.trackingSince);
    }
  });

  it("preserves every stored setting through an upgrade", () => {
    // Each assumption the surplus card runs on is a number the user chose.
    // Silently swapping any of them for a default changes the advice given.
    for (const { raw, state } of GENERATED) {
      expect(state.account.startingBalance).toBe(raw.account.startingBalance);
      expect(state.settings.startDate).toBe(raw.settings.startDate);
      expect(state.settings.horizonDays).toBe(raw.settings.horizonDays);
      expect(state.settings.minSafeBalance).toBe(raw.settings.minSafeBalance);
      expect(state.settings.surplus).toEqual(raw.settings.surplus);
      // The generator still writes the retired coverage lens, as old stored
      // states do. A retired field is the one thing that must NOT survive:
      // carried forward, the app would keep writing it back forever.
      expect("coverageLens" in state.settings).toBe(false);
    }
  });

  it("carries an old top-up forward as a top-up, whatever reason it recorded", () => {
    // There is one kind of top-up now. States written before that carry a
    // `reason` of "oneOff" or "shortfall" on each one, and the risk on the
    // way through is the usual one for this layer: dropping the distinction
    // by dropping the transaction. The draw itself is real money the
    // household actually moved, so it must survive intact and still be
    // recognisable as a top-up; only the label goes. Compared against the
    // RAW stored shape, never against another upgrade's output.
    const stored = {
      version: 5,
      account: { startingBalance: 4210.55 },
      settings: {
        startDate: "2026-09-02",
        horizonDays: 90,
        minSafeBalance: 1500,
        trackingSince: "2026-01-01",
        coverageLens: "recurring",
        surplus: {},
      },
      rules: [],
      adhocTransactions: [
        { id: "a", name: "Top Up", amount: 1800, date: "2026-03-10", kind: "topUp", reason: "oneOff" },
        { id: "b", name: "Top Up", amount: 420.5, date: "2026-04-12", kind: "topUp", reason: "shortfall" },
        { id: "c", name: "Top Up", amount: 300, date: "2026-05-01", kind: "topUp" },
        { id: "d", name: "Car repair", amount: -640, date: "2026-05-04" },
      ],
      overrides: {},
      checkpoints: [],
    };

    const up = upgradeAppState(stored);

    expect(up.adhocTransactions).toHaveLength(stored.adhocTransactions.length);
    for (let i = 0; i < stored.adhocTransactions.length; i++) {
      const raw = stored.adhocTransactions[i] as Record<string, unknown>;
      const txn = up.adhocTransactions[i];
      expect(txn.id).toBe(raw.id);
      expect(txn.name).toBe(raw.name);
      expect(txn.amount).toBe(raw.amount);
      expect(txn.date).toBe(raw.date);
      // A top-up stays a top-up; an ordinary transaction stays ordinary.
      expect(txn.kind).toBe(raw.kind);
      // ...but no transaction carries a reason any more, whatever storage
      // said. A retired field left in place is one the app would keep
      // writing back forever.
      expect("reason" in txn).toBe(false);
    }
    // The lens the card used to offer goes the same way: one kind of
    // top-up leaves nothing to switch between.
    expect("coverageLens" in up.settings).toBe(false);
  });

  it("never replaces real mortgage terms with defaults", () => {
    // This one shipped: a save with any unusable field swapped the user's
    // real loan for the hard-coded $300k demo.
    const defaults = createDefaultMortgageUIState().terms;
    for (const state of MORTGAGE_STATES) {
      window.localStorage.clear();
      saveMortgageUIState(state);
      // Now save something damaged on top of it.
      saveMortgageUIState({
        ...state,
        terms: { ...state.terms, principal: Number.NaN },
      });
      const back = loadMortgageUIState();
      expect(back.terms.principal).toBe(state.terms.principal);
      if (state.terms.principal !== defaults.principal) {
        expect(back.terms.principal).not.toBe(defaults.principal);
      }
    }
  });

  it("writes only the fields it knows about", () => {
    // A spread carried a retired `scenarios` array back into storage forever.
    // Stored payloads must contain exactly the current shape.
    for (const state of MORTGAGE_STATES) {
      window.localStorage.clear();
      saveMortgageUIState({
        ...state,
        ...({ scenarios: [{ id: "x" }], somethingElse: 1 } as object),
      });
      const raw = JSON.parse(
        window.localStorage.getItem("finance-cockpit-mortgage-v2")!
      );
      expect(Object.keys(raw).sort()).toEqual(
        ["asOfDate", "checkpoints", "prepayments", "terms"].sort()
      );
    }
  });

  it("never throws on any input, however corrupt", () => {
    for (const g of GARBAGE) {
      expect(() => upgradeAppState(g)).not.toThrow();
      expect(() => sanitizeMortgageUIState(g)).not.toThrow();
      expect(() => parseSnapshot(g)).not.toThrow();
    }
  });

  it("returns a usable state for any input, however corrupt", () => {
    // Falling back is only safe if the fallback is itself valid: the app
    // renders whatever comes out of here without re-checking it.
    for (const g of GARBAGE) {
      const up = upgradeAppState(g);
      expect(up.version).toBe(APP_STATE_VERSION);
      expect(Array.isArray(up.rules)).toBe(true);
      expect(Array.isArray(up.adhocTransactions)).toBe(true);
      expect(Number.isFinite(up.account.startingBalance)).toBe(true);
      expect(Number.isFinite(up.settings.horizonDays)).toBe(true);
      expect(up.settings.horizonDays).toBeGreaterThan(0);
      expect(Number.isFinite(up.settings.minSafeBalance)).toBe(true);
      expect(up.settings.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      // Every surplus assumption must be a usable number, and none may fall
      // back to zero: a zero reserve offers the whole balance for investing
      // and a zero return makes prepaying win automatically.
      const s = up.settings.surplus;
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined) continue;
        expect(Number.isFinite(v as number), `surplus.${k}`).toBe(true);
      }
      expect(s.reserveMonths).toBeGreaterThan(0);
      expect(s.expectedReturn).toBeGreaterThan(0);
      expect(s.capitalGainsRate).toBeGreaterThan(0);
      expect(s.horizonYears).toBeGreaterThan(0);
    }
  });

  it("either parses a snapshot into a valid one, or refuses it", () => {
    for (const g of GARBAGE) {
      const snap = parseSnapshot(g);
      if (snap === null) continue;
      expect(snap.app_state.version).toBe(APP_STATE_VERSION);
      expect(Number.isFinite(snap.mortgage_ui.terms.principal)).toBe(true);
      expect(snap.mortgage_ui.terms.principal).toBeGreaterThan(0);
      expect(typeof snap.updated_at).toBe("string");
    }
  });

  it("distinguishes an empty store from an unreadable one, and never returns junk", () => {
    // Nothing stored is null, so the caller knows to seed a first-run state.
    window.localStorage.clear();
    expect(loadAppState()).toBeNull();

    // Unreadable JSON is different: something WAS stored, so returning a
    // usable state keeps the app rendering rather than treating a corrupt
    // blob as a fresh install. Either way the caller gets something valid.
    window.localStorage.setItem("finance-cockpit-app-state-v1", "{{{not json");
    const recovered = loadAppState();
    expect(recovered).not.toBeNull();
    expect(recovered!.version).toBe(APP_STATE_VERSION);
    expect(Number.isFinite(recovered!.account.startingBalance)).toBe(true);

    // And an initial state is itself round-trippable.
    window.localStorage.clear();
    const initial = createInitialAppState();
    saveAppState(initial);
    expect(loadAppState()).toEqual(initial);
  });
});
