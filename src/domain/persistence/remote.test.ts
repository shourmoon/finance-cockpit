// src/domain/persistence/remote.test.ts
import { describe, it, expect } from "vitest";
import {
  RemoteSyncError,
  remoteSyncErrorFromStatus,
  stubRemoteAdapter,
} from "./remote";
import { createInitialAppState } from "../appState";
import { createDefaultMortgageUIState } from "../mortgage/persistence";

describe("remoteSyncErrorFromStatus", () => {
  it("maps HTTP statuses to error kinds", () => {
    expect(remoteSyncErrorFromStatus(401, "Remote load").kind).toBe("unauthorized");
    expect(remoteSyncErrorFromStatus(409, "Remote save").kind).toBe("conflict");
    expect(remoteSyncErrorFromStatus(404, "Remote load").kind).toBe("notFound");
    expect(remoteSyncErrorFromStatus(500, "Remote save").kind).toBe("server");
    expect(remoteSyncErrorFromStatus(418, "Remote save").kind).toBe("server");
  });

  it("carries status and a contextual message", () => {
    const err = remoteSyncErrorFromStatus(409, "Remote save");
    expect(err).toBeInstanceOf(RemoteSyncError);
    expect(err.status).toBe(409);
    expect(err.message).toContain("Remote save");
    expect(err.message).toContain("409");
  });

  it("defaults status to null when constructed directly", () => {
    const err = new RemoteSyncError("network", "offline");
    expect(err.status).toBeNull();
    expect(err.name).toBe("RemoteSyncError");
  });
});

describe("stubRemoteAdapter", () => {
  it("loadState always resolves to null", async () => {
    expect(await stubRemoteAdapter.loadState("k")).toBeNull();
  });

  it("saveState returns a synthetic ISO timestamp", async () => {
    const ts = await stubRemoteAdapter.saveState("k", {
      app_state: createInitialAppState(),
      mortgage_ui: createDefaultMortgageUIState(),
      prev_updated_at: null,
    });
    expect(typeof ts).toBe("string");
    expect(Number.isNaN(Date.parse(ts))).toBe(false);
  });
});
