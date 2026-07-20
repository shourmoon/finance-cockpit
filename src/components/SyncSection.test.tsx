// src/components/SyncSection.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { saveAppState } from "../domain/persistence";
import { saveMortgageUIState, createDefaultMortgageUIState } from "../domain/mortgage/persistence";
import { createInitialAppState } from "../domain/appState";

// SYNC_BASE_URL is read through ../config so we can control it per test.
const cfg = vi.hoisted(() => ({ base: undefined as string | undefined }));
vi.mock("../config", () => ({
  get SYNC_BASE_URL() {
    return cfg.base;
  },
}));

beforeEach(() => {
  window.localStorage.clear();
  cfg.base = undefined;
  // getLocalSnapshot requires a persisted AppState to exist.
  saveAppState(createInitialAppState());
  saveMortgageUIState(createDefaultMortgageUIState());
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderSync() {
  const { default: SyncSection } = await import("./SyncSection");
  return render(<SyncSection />);
}

describe("SyncSection - no remote configured (stub adapter)", () => {
  it("shows 'Not configured' and an optional PIN", async () => {
    await renderSync();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    expect(screen.getByText(/Sync PIN \(optional\)/)).toBeInTheDocument();
  });

  it("requires a sync key before syncing", async () => {
    await renderSync();
    fireEvent.click(screen.getByText("Sync now"));
    expect(await screen.findByText("Please enter a Sync Key.")).toBeInTheDocument();
  });

  it("remembers the sync key and reports an init/sync result", async () => {
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), {
      target: { value: "my-key" },
    });
    fireEvent.click(screen.getByText("Sync now"));
    // Stub adapter has no remote => init push path.
    expect(await screen.findByText(/successfully/)).toBeInTheDocument();
    expect(window.localStorage.getItem("finance-cockpit:sync-key")).toBe("my-key");
  });

  it("reports that no remote snapshot exists on refresh/pull", async () => {
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByText("Refresh status"));
    expect(await screen.findByText(/No remote snapshot found/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Pull latest"));
    expect(await screen.findByText(/No remote snapshot found for this key yet\./)).toBeInTheDocument();
  });

  it("pushes local state via the stub adapter", async () => {
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByText("Push local"));
    expect(await screen.findByText(/Pushed local snapshot/)).toBeInTheDocument();
  });

  it("resets metadata and forgets the key", async () => {
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByText("Reset metadata"));
    expect(await screen.findByText(/last-sync metadata was cleared/)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Forget key"));
    expect(await screen.findByText(/Sync key was cleared/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/moona-home/)).toHaveValue("");
  });
});

describe("SyncSection - remote configured", () => {
  const BASE = "https://sync.example.com";

  function setupRemote() {
    cfg.base = BASE;
    // Deterministic PIN hashing.
    vi.stubGlobal("crypto", {
      subtle: {
        digest: async () => new Uint8Array([0xab, 0xcd]).buffer,
      },
    });
  }

  it("requires a PIN when a remote is configured", async () => {
    setupRemote();
    await renderSync();
    expect(screen.getByText(BASE)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), {
      target: { value: "k" },
    });
    fireEvent.click(screen.getByText("Sync now"));
    expect(
      await screen.findByText(/Please enter a Sync PIN/)
    ).toBeInTheDocument();
  });

  it("maps a 401 response to an unauthorized message", async () => {
    setupRemote();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 401 })));
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), { target: { value: "k" } });
    fireEvent.change(screen.getByPlaceholderText(/never stored/), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Refresh status"));
    expect(await screen.findByText(/Unauthorized: wrong Sync PIN/)).toBeInTheDocument();
  });

  it("maps a network failure to a reachability message", async () => {
    setupRemote();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), { target: { value: "k" } });
    fireEvent.change(screen.getByPlaceholderText(/never stored/), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Refresh status"));
    expect(await screen.findByText(/Failed to reach the sync server/)).toBeInTheDocument();
  });

  it("Sync now opens the conflict resolver on a 409 during push", async () => {
    setupRemote();
    const remoteSnap = {
      app_state: createInitialAppState(),
      mortgage_ui: createDefaultMortgageUIState(),
      updated_at: "2025-05-01T00:00:00Z",
    };
    // Last-sync matches the remote, so syncNow chooses the push path.
    window.localStorage.setItem(
      "finance-cockpit:last-sync",
      JSON.stringify({ remote_updated_at: remoteSnap.updated_at })
    );
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify(remoteSnap), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return Promise.resolve(new Response("Conflict", { status: 409 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), { target: { value: "k" } });
    fireEvent.change(screen.getByPlaceholderText(/never stored/), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Sync now"));

    expect(await screen.findByText("Conflict detected")).toBeInTheDocument();
    expect(screen.getByText("Keep Local")).toBeInTheDocument();
    expect(screen.getByText("Keep Remote")).toBeInTheDocument();
  });

  it("Pull latest saves a pre-pull backup before overwriting local state", async () => {
    setupRemote();
    // Give local state a distinctive balance to find in the backup.
    const local = createInitialAppState();
    local.account.startingBalance = 4242;
    saveAppState(local);

    const remoteSnap = {
      app_state: { ...createInitialAppState(), account: { startingBalance: 7 } },
      mortgage_ui: createDefaultMortgageUIState(),
      updated_at: "2025-05-01T00:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(remoteSnap), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), { target: { value: "k" } });
    fireEvent.change(screen.getByPlaceholderText(/never stored/), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Pull latest"));
    await screen.findByText(/Pulled latest remote snapshot/);

    const backup = JSON.parse(
      window.localStorage.getItem("finance-cockpit:backup-before-pull")!
    );
    expect(backup.app_state.account.startingBalance).toBe(4242);
  });

  it("surfaces a conflict resolver when pushing over a changed remote", async () => {
    setupRemote();
    const remoteSnap = {
      app_state: { version: 1, account: { startingBalance: 1 }, settings: { startDate: "2025-01-01", horizonDays: 30, minSafeBalance: 0 }, rules: [], overrides: {} },
      mortgage_ui: { terms: { principal: 100000, annualRate: 0.05, termMonths: 360, startDate: "2025-01-01" }, prepayments: [], asOfDate: "2025-01-01", scenarios: [] },
      updated_at: "2025-05-01T00:00:00Z",
    };
    const fetchMock = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET") {
        return Promise.resolve(
          new Response(JSON.stringify(remoteSnap), { status: 200, headers: { "Content-Type": "application/json" } })
        );
      }
      // PUT => conflict
      return Promise.resolve(new Response("Conflict", { status: 409 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    await renderSync();
    fireEvent.change(screen.getByPlaceholderText(/moona-home/), { target: { value: "k" } });
    fireEvent.change(screen.getByPlaceholderText(/never stored/), { target: { value: "1234" } });
    fireEvent.click(screen.getByText("Push local"));

    expect(await screen.findByText("Conflict detected")).toBeInTheDocument();
    expect(screen.getByText("Keep Remote")).toBeInTheDocument();
    expect(screen.getByText("Keep Local")).toBeInTheDocument();

    // Resolve by keeping remote (pulls the remote snapshot locally).
    fireEvent.click(screen.getByText("Keep Remote"));
    await waitFor(() =>
      expect(screen.getByText(/keeping Remote/)).toBeInTheDocument()
    );
    // The discarded local state is recoverable from the backup slot.
    expect(
      window.localStorage.getItem("finance-cockpit:backup-before-pull")
    ).not.toBeNull();
  });
});
