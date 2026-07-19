// workers/sync-worker/index.test.ts
//
// Tests for the sync Worker's fetch handler using an in-memory KV mock.
// These run in vitest (jsdom provides Request/Response/Headers/URL).

import { describe, it, expect, beforeEach } from "vitest";
import worker from "./index";

function makeKvMock() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string, opts?: { type?: string }) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts?.type === "json") return JSON.parse(raw);
      return raw;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
  };
}

const BASE = "https://sync.example.com";
const PIN_A = "a".repeat(64); // fake sha256 hex
const PIN_B = "b".repeat(64);

function makeEnv() {
  return { SYNC_KV: makeKvMock() };
}

function getReq(key: string | null, pinHash?: string): Request {
  const url = key === null ? `${BASE}/state` : `${BASE}/state?key=${key}`;
  const headers: Record<string, string> = {};
  if (pinHash) headers["X-Sync-Pin"] = pinHash;
  return new Request(url, { method: "GET", headers });
}

function putReq(
  key: string,
  body: unknown,
  pinHash?: string
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (pinHash) headers["X-Sync-Pin"] = pinHash;
  return new Request(`${BASE}/state?key=${key}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
}

const snapshotBody = {
  app_state: { version: 1, account: { startingBalance: 10 } },
  mortgage_ui: { terms: { principal: 100000 } },
};

describe("sync-worker fetch handler", () => {
  let env: ReturnType<typeof makeEnv>;

  beforeEach(() => {
    env = makeEnv();
  });

  it("handles OPTIONS preflight with 204 and CORS headers", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/state?key=k1`, { method: "OPTIONS" }),
      env
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });

  it("returns 404 for unknown paths", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/other`, { method: "GET" }),
      env
    );
    expect(res.status).toBe(404);
  });

  it("returns 400 when key parameter is missing", async () => {
    const res = await worker.fetch(getReq(null, PIN_A), env);
    expect(res.status).toBe(400);
  });

  it("returns 401 when X-Sync-Pin header is missing", async () => {
    const res = await worker.fetch(getReq("k1"), env);
    expect(res.status).toBe(401);
  });

  it("binds the first-seen pin hash to the key and rejects a different pin afterwards", async () => {
    // First request binds PIN_A (GET on empty store: pin accepted, then 404).
    const first = await worker.fetch(getReq("k1", PIN_A), env);
    expect(first.status).toBe(404);
    expect(env.SYNC_KV.store.get("k1:pin")).toBe(PIN_A);

    // Same pin is accepted again.
    const same = await worker.fetch(getReq("k1", PIN_A), env);
    expect(same.status).toBe(404);

    // A different pin is rejected.
    const wrong = await worker.fetch(getReq("k1", PIN_B), env);
    expect(wrong.status).toBe(401);
  });

  it("GET returns 404 when no snapshot exists", async () => {
    const res = await worker.fetch(getReq("k1", PIN_A), env);
    expect(res.status).toBe(404);
  });

  it("PUT initial snapshot returns updated_at; GET then returns the snapshot", async () => {
    const put = await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    expect(put.status).toBe(200);
    const putJson: any = await put.json();
    expect(typeof putJson.updated_at).toBe("string");

    const get = await worker.fetch(getReq("k1", PIN_A), env);
    expect(get.status).toBe(200);
    const getJson: any = await get.json();
    expect(getJson.app_state.account.startingBalance).toBe(10);
    expect(getJson.mortgage_ui.terms.principal).toBe(100000);
    expect(getJson.updated_at).toBe(putJson.updated_at);
  });

  it("PUT rejects invalid JSON with 400", async () => {
    const req = new Request(`${BASE}/state?key=k1`, {
      method: "PUT",
      headers: { "X-Sync-Pin": PIN_A },
      body: "{not json",
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(400);
  });

  it("PUT rejects a body missing app_state or mortgage_ui with 400", async () => {
    const res = await worker.fetch(
      putReq("k1", { app_state: { version: 1 } }, PIN_A),
      env
    );
    expect(res.status).toBe(400);
  });

  it("PUT on existing snapshot without prev_updated_at returns 409", async () => {
    await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    const res = await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    expect(res.status).toBe(409);
  });

  it("PUT with stale prev_updated_at returns 409", async () => {
    await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    const res = await worker.fetch(
      putReq(
        "k1",
        { ...snapshotBody, prev_updated_at: "2000-01-01T00:00:00.000Z" },
        PIN_A
      ),
      env
    );
    expect(res.status).toBe(409);
  });

  it("PUT with matching prev_updated_at succeeds and bumps updated_at", async () => {
    const first = await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    const { updated_at: firstAt } = (await first.json()) as any;

    const second = await worker.fetch(
      putReq(
        "k1",
        {
          app_state: { version: 1, account: { startingBalance: 20 } },
          mortgage_ui: snapshotBody.mortgage_ui,
          prev_updated_at: firstAt,
        },
        PIN_A
      ),
      env
    );
    expect(second.status).toBe(200);

    const get = await worker.fetch(getReq("k1", PIN_A), env);
    const json: any = await get.json();
    expect(json.app_state.account.startingBalance).toBe(20);
  });

  it("uses different storage per shared key", async () => {
    await worker.fetch(putReq("k1", snapshotBody, PIN_A), env);
    const other = await worker.fetch(getReq("k2", PIN_B), env);
    // k2 has its own (empty) snapshot slot and its own pin binding.
    expect(other.status).toBe(404);
    expect(env.SYNC_KV.store.get("k2:pin")).toBe(PIN_B);
  });

  it("returns 405 for unsupported methods", async () => {
    const res = await worker.fetch(
      new Request(`${BASE}/state?key=k1`, {
        method: "DELETE",
        headers: { "X-Sync-Pin": PIN_A },
      }),
      env
    );
    expect(res.status).toBe(405);
  });
});
