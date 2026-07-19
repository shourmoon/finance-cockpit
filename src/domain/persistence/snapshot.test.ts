// src/domain/persistence/snapshot.test.ts
// Unit tests for the snapshot helpers. These tests exercise the
// createSnapshot and parseSnapshot functions to ensure that the
// snapshot format round‑trips correctly and fails gracefully when
// given invalid input. The AppState and MortgageUIState factories
// from the existing modules are used to generate realistic state.

import { describe, it, expect } from "vitest";
import { createSnapshot, parseSnapshot } from "./snapshot";
import { createInitialAppState } from "../appState";
import { createDefaultMortgageUIState } from "../mortgage/persistence";

describe("snapshot helpers", () => {
  it("createSnapshot returns a well‑formed object", () => {
    const app = createInitialAppState();
    const mortgage = createDefaultMortgageUIState();
    const snap = createSnapshot(app, mortgage, "device-1", "2025-01-01T00:00:00Z");
    expect(snap.schemaVersion).toBeGreaterThan(0);
    expect(snap.app_state).toBe(app);
    expect(snap.mortgage_ui).toBe(mortgage);
    expect(snap.device_id).toBe("device-1");
    expect(snap.updated_at).toBe("2025-01-01T00:00:00Z");
  });

  it("parseSnapshot returns null for invalid inputs", () => {
    // null and undefined are invalid
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(undefined as any)).toBeNull();
    // missing required fields
    expect(parseSnapshot({ schemaVersion: 1 })).toBeNull();
    expect(
      parseSnapshot({ schemaVersion: 1, app_state: {}, mortgage_ui: {} })
    ).toBeNull();
    // wrong types
    expect(
      parseSnapshot({
        schemaVersion: "1",
        app_state: {},
        mortgage_ui: {},
        updated_at: 123,
        device_id: 456,
      })
    ).toBeNull();
  });

  it("parseSnapshot rejects each individually malformed field", () => {
    const base = {
      schemaVersion: 1,
      app_state: { version: 1 },
      mortgage_ui: { terms: {} },
      updated_at: "2025-01-01T00:00:00Z",
      device_id: "d",
    };
    expect(parseSnapshot({ ...base, app_state: null })).toBeNull();
    expect(parseSnapshot({ ...base, mortgage_ui: null })).toBeNull();
    expect(parseSnapshot({ ...base, updated_at: "" })).toBeNull();
    expect(parseSnapshot({ ...base, device_id: "" })).toBeNull();
  });

  it("parseSnapshot round‑trips a snapshot", () => {
    const app = createInitialAppState();
    const mortgage = createDefaultMortgageUIState();
    const original = createSnapshot(app, mortgage, "dev-123");
    const parsed = parseSnapshot(original);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(original.schemaVersion);
    expect(parsed!.device_id).toBe(original.device_id);
    // Nested states are sanitized copies, equal by value.
    expect(parsed!.app_state).toEqual(original.app_state);
    expect(parsed!.mortgage_ui).toEqual(original.mortgage_ui);
    expect(parsed!.updated_at).toBe(original.updated_at);
  });

  it("parseSnapshot sanitizes a corrupt app_state instead of trusting it", () => {
    const corruptApp: any = {
      version: 1,
      account: { startingBalance: 50 },
      settings: { startDate: "garbage", horizonDays: 30, minSafeBalance: 0 },
      rules: [
        { id: "bad", name: "Bad", amount: 1, isVariable: false, schedule: null },
        { id: "good", name: "Good", amount: 1, isVariable: false, schedule: { type: "monthly", day: 1 } },
      ],
      overrides: {},
    };
    const parsed = parseSnapshot({
      schemaVersion: 1,
      app_state: corruptApp,
      mortgage_ui: createDefaultMortgageUIState(),
      updated_at: "2025-01-01T00:00:00Z",
      device_id: "dev",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.app_state.account.startingBalance).toBe(50);
    expect(parsed!.app_state.rules.map((r) => r.id)).toEqual(["good"]);
    expect(parsed!.app_state.settings.startDate).not.toBe("garbage");
  });

  it("parseSnapshot falls back to default mortgage state when mortgage_ui is corrupt", () => {
    const parsed = parseSnapshot({
      schemaVersion: 1,
      app_state: createInitialAppState(),
      mortgage_ui: { terms: { principal: "not a number" } },
      updated_at: "2025-01-01T00:00:00Z",
      device_id: "dev",
    });
    expect(parsed).not.toBeNull();
    expect(parsed!.mortgage_ui).toEqual(createDefaultMortgageUIState());
  });
});