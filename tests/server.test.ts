import { describe, expect, test } from "bun:test";
import {
  cleanupStaleInstances,
  getAggregatedStatus,
  handleRequest,
  type LockXState,
} from "../server";

function createState(): LockXState {
  return {
    instances: new Map(),
    overrideUntil: null,
    lastOverrideTime: 0,
    startedAt: Date.now() - 10_000,
  };
}

describe("aggregation logic", () => {
  test("no instances => working", () => {
    const state = createState();
    expect(getAggregatedStatus(state)).toBe("working");
  });

  test("any idle instance => idle", () => {
    const state = createState();
    state.instances.set("a", { status: "working", lastUpdate: Date.now() });
    state.instances.set("b", { status: "idle", lastUpdate: Date.now() });
    expect(getAggregatedStatus(state)).toBe("idle");
  });

  test("override active => working", () => {
    const state = createState();
    state.instances.set("a", { status: "idle", lastUpdate: Date.now() });
    state.overrideUntil = Date.now() + 60_000;
    expect(getAggregatedStatus(state)).toBe("working");
  });
});

describe("cleanup", () => {
  test("removes stale instances", () => {
    const state = createState();
    state.instances.set("old", { status: "idle", lastUpdate: Date.now() - 120_000 });
    state.instances.set("new", { status: "working", lastUpdate: Date.now() });

    cleanupStaleInstances(state);

    expect(state.instances.has("old")).toBe(false);
    expect(state.instances.has("new")).toBe(true);
  });
});

describe("http handlers", () => {
  test("health endpoint returns uptime/version", async () => {
    const state = createState();
    const req = new Request("http://localhost:51736/health");
    const res = await handleRequest(req, state);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptimeSec).toBe("number");
  });

  test("rejects invalid instance id", async () => {
    const state = createState();
    const req = new Request("http://localhost:51736/working?instance=bad$id", { method: "POST" });
    const res = await handleRequest(req, state);
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe("INVALID_INSTANCE");
  });

  test("override cooldown is enforced", async () => {
    const state = createState();

    const req1 = new Request("http://localhost:51736/override?minutes=5", { method: "POST" });
    const res1 = await handleRequest(req1, state);
    expect(res1.status).toBe(200);

    const req2 = new Request("http://localhost:51736/override?minutes=5", { method: "POST" });
    const res2 = await handleRequest(req2, state);
    const body2 = await res2.json();
    expect(res2.status).toBe(429);
    expect(body2.code).toBe("OVERRIDE_COOLDOWN");
    expect(typeof body2.retryAfterSeconds).toBe("number");
  });

  test("minutes are clamped", async () => {
    const state = createState();
    const req = new Request("http://localhost:51736/override?minutes=999", { method: "POST" });
    const res = await handleRequest(req, state);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.minutes).toBe(60);
    expect(body.clamped).toBe(true);
  });
});
