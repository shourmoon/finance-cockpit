// src/domain/persistence/remoteCloudflare.test.ts
//
// Tests for the fetch-based Cloudflare adapter using a mocked global
// fetch. These lock in the adapter's URL construction, header
// handling, and error behaviour.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCloudflareAdapter } from "./remoteCloudflare";
import type { RemoteStatePayload } from "./remote";
import { RemoteSyncError } from "./remote";
import { createInitialAppState } from "../appState";
import { createDefaultMortgageUIState } from "../mortgage/persistence";

const BASE = "https://sync.example.com";

function makePayload(): RemoteStatePayload {
  return {
    app_state: createInitialAppState(),
    mortgage_ui: createDefaultMortgageUIState(),
    prev_updated_at: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createCloudflareAdapter", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loadState GETs /state with the encoded shared key", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ app_state: {}, mortgage_ui: {}, updated_at: "t1" })
    );
    const adapter = createCloudflareAdapter(BASE);
    await adapter.loadState("key with spaces");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/state?key=key%20with%20spaces`);
    expect(init.method).toBe("GET");
  });

  it("strips a trailing slash from the base URL", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ app_state: {}, mortgage_ui: {}, updated_at: "t1" })
    );
    const adapter = createCloudflareAdapter(`${BASE}/`);
    await adapter.loadState("k");
    expect(fetchMock.mock.calls[0][0]).toBe(`${BASE}/state?key=k`);
  });

  it("sends the X-Sync-Pin header when a pinHash is provided", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ app_state: {}, mortgage_ui: {}, updated_at: "t1" })
    );
    const adapter = createCloudflareAdapter(BASE, { pinHash: "deadbeef" });
    await adapter.loadState("k");
    expect(fetchMock.mock.calls[0][1].headers["X-Sync-Pin"]).toBe("deadbeef");
  });

  it("omits the X-Sync-Pin header when no pinHash is provided", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ app_state: {}, mortgage_ui: {}, updated_at: "t1" })
    );
    const adapter = createCloudflareAdapter(BASE);
    await adapter.loadState("k");
    expect(fetchMock.mock.calls[0][1].headers["X-Sync-Pin"]).toBeUndefined();
  });

  it("loadState returns null on 404", async () => {
    fetchMock.mockResolvedValue(new Response("Not Found", { status: 404 }));
    const adapter = createCloudflareAdapter(BASE);
    const result = await adapter.loadState("k");
    expect(result).toBeNull();
  });

  it("loadState throws with the status on non-404 errors", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.loadState("k")).rejects.toThrow("401");
  });

  it("saveState PUTs the payload and returns updated_at", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ updated_at: "t2" }));
    const adapter = createCloudflareAdapter(BASE);
    const payload = makePayload();
    const updatedAt = await adapter.saveState("k", payload);

    expect(updatedAt).toBe("t2");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${BASE}/state?key=k`);
    expect(init.method).toBe("PUT");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual(JSON.parse(JSON.stringify(payload)));
  });

  it("saveState throws with the status on 409 conflict", async () => {
    fetchMock.mockResolvedValue(new Response("Conflict", { status: 409 }));
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.saveState("k", makePayload())).rejects.toThrow("409");
  });

  it("saveState throws with the status on 401 unauthorized", async () => {
    fetchMock.mockResolvedValue(new Response("Unauthorized", { status: 401 }));
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.saveState("k", makePayload())).rejects.toThrow("401");
  });

  it("saveState throws when the response is missing updated_at", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.saveState("k", makePayload())).rejects.toThrow(
      "updated_at"
    );
  });

  it("errors are RemoteSyncError instances with the right kind", async () => {
    const adapter = createCloudflareAdapter(BASE);

    fetchMock.mockResolvedValueOnce(new Response("", { status: 401 }));
    await expect(adapter.loadState("k")).rejects.toMatchObject({
      name: "RemoteSyncError",
      kind: "unauthorized",
      status: 401,
    });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 409 }));
    await expect(adapter.saveState("k", makePayload())).rejects.toMatchObject({
      kind: "conflict",
      status: 409,
    });

    fetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));
    await expect(adapter.saveState("k", makePayload())).rejects.toMatchObject({
      kind: "server",
      status: 500,
    });
  });

  it("wraps transport-level fetch failures as kind 'network'", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.loadState("k")).rejects.toMatchObject({
      kind: "network",
    });
    await expect(adapter.saveState("k", makePayload())).rejects.toBeInstanceOf(
      RemoteSyncError
    );
  });

  it("uses a default message when the rejected value has none", async () => {
    fetchMock.mockRejectedValue({}); // no .message
    const adapter = createCloudflareAdapter(BASE);
    await expect(adapter.loadState("k")).rejects.toMatchObject({
      kind: "network",
      message: "Network request failed",
    });
  });
});
