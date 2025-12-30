// src/domain/persistence/snapshot.test.ts
// Unit tests for the snapshot helpers. These tests exercise the
// createSnapshot and parseSnapshot functions to ensure that the
// snapshot format round-trips correctly and fails gracefully when
// given invalid input.

import { describe, it, expect } from "vitest";
import {
  createSnapshot,
  parseSnapshot,
  CURRENT_SCHEMA_VERSION,
} from "./snapshot";
import { createInitialAppState } from "../appState";
import { createDefaultMortgageUIState } from "../mortgage/persistence";

describe("snapshot helpers", () => {
  it("createSnapshot returns a well-formed object", () => {
    const app = createInitialAppState();
    const mortgage = createDefaultMortgageUIState();

    const snap = createSnapshot(app, mortgage, {
      deviceId: "device-1",
      updatedAt: "2025-01-01T00:00:00Z",
    });

    expect(snap.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(snap.app_state).toBe(app);
    expect(snap.mortgage_ui).toBe(mortgage);
    expect(snap.device_id).toBe("device-1");
    expect(snap.updated_at).toBe("2025-01-01T00:00:00Z");
  });

  it("parseSnapshot returns null for invalid inputs", () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot(undefined as any)).toBeNull();
    expect(parseSnapshot("nope" as any)).toBeNull();

    // missing required fields
    expect(parseSnapshot({ schemaVersion: 1 })).toBeNull();
    expect(parseSnapshot({ schemaVersion: 1, app_state: {}, mortgage_ui: {} })).toBeNull();

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

  it("parseSnapshot round-trips a snapshot", () => {
    const app = createInitialAppState();
    const mortgage = createDefaultMortgageUIState();

    const original = createSnapshot(app, mortgage, {
      deviceId: "dev-123",
    });

    const parsed = parseSnapshot(original);
    expect(parsed).not.toBeNull();
    expect(parsed!.schemaVersion).toBe(original.schemaVersion);
    expect(parsed!.device_id).toBe(original.device_id);
    expect(parsed!.app_state).toBe(original.app_state);
    expect(parsed!.mortgage_ui).toBe(original.mortgage_ui);
    expect(parsed!.updated_at).toBe(original.updated_at);
  });
});
