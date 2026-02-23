const PORT = 51736;
const STALE_TIMEOUT_MS = 60_000; // 60 seconds
const CLEANUP_INTERVAL_MS = 30_000; // 30 seconds
const DEBUG = process.env.DEBUG === "1";
const CONFIG_FILE = import.meta.dir + "/config.json";
const MAX_INSTANCES = 100;
const MIN_OVERRIDE_MINUTES = 1;
const MAX_OVERRIDE_MINUTES = 60;
const OVERRIDE_COOLDOWN_MS = 60_000; // 1 minute between overrides
const INSTANCE_ID_MAX_LENGTH = 64;
const INSTANCE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const DEFAULT_BLOCKED_SITES = [
  "x.com",
  "twitter.com",
  "reddit.com",
  "youtube.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "discord.com",
];
const APP_VERSION = process.env.npm_package_version || "1.0.0";

export interface Config {
  blockedSites: string[];
}

export interface InstanceState {
  status: "working" | "idle";
  lastUpdate: number;
}

export interface LockXState {
  instances: Map<string, InstanceState>;
  overrideUntil: number | null;
  lastOverrideTime: number;
  startedAt: number;
}

export const state: LockXState = {
  instances: new Map<string, InstanceState>(),
  overrideUntil: null,
  lastOverrideTime: 0,
  startedAt: Date.now(),
};

function log(message: string) {
  if (DEBUG) {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${message}`);
  }
}

function json(request: Request, body: unknown, status = 200): Response {
  const headers = getCorsHeaders(request);
  return new Response(JSON.stringify(body), { status, headers });
}

function errorJson(
  request: Request,
  status: number,
  code: string,
  error: string,
  extra: Record<string, unknown> = {}
): Response {
  return json(request, { error, code, ...extra }, status);
}

export async function loadConfig(): Promise<Config> {
  try {
    const text = await Bun.file(CONFIG_FILE).text();
    const config = JSON.parse(text);

    if (!Array.isArray(config.blockedSites)) {
      throw new Error("blockedSites must be an array");
    }

    if (!config.blockedSites.every((s: unknown) => typeof s === "string")) {
      throw new Error("blockedSites must contain only strings");
    }

    return config;
  } catch (e) {
    log(`Config load error: ${e}`);
    return { blockedSites: DEFAULT_BLOCKED_SITES };
  }
}

export function cleanupStaleInstances(currentState: LockXState = state): void {
  const now = Date.now();
  for (const [id, instanceState] of currentState.instances) {
    if (now - instanceState.lastUpdate > STALE_TIMEOUT_MS) {
      log(`Removing stale instance: ${id}`);
      currentState.instances.delete(id);
    }
  }
}

export function getAggregatedStatus(currentState: LockXState = state): "working" | "idle" {
  if (currentState.overrideUntil && Date.now() < currentState.overrideUntil) {
    return "working";
  }

  if (currentState.instances.size === 0) {
    return "working";
  }

  for (const instanceState of currentState.instances.values()) {
    if (instanceState.status === "idle") {
      return "idle";
    }
  }

  return "working";
}

export function getInstancesSnapshot(
  currentState: LockXState = state
): Record<string, { status: string; age: number }> {
  const now = Date.now();
  const snapshot: Record<string, { status: string; age: number }> = {};

  for (const [id, instanceState] of currentState.instances) {
    snapshot[id] = {
      status: instanceState.status,
      age: Math.round((now - instanceState.lastUpdate) / 1000),
    };
  }

  return snapshot;
}

function parseInstanceId(raw: string | null):
  | { ok: true; value: string }
  | { ok: false; code: string; error: string } {
  const instanceId = raw || "default";

  if (instanceId.length > INSTANCE_ID_MAX_LENGTH) {
    return {
      ok: false,
      code: "INVALID_INSTANCE",
      error: `Instance ID too long (max ${INSTANCE_ID_MAX_LENGTH} chars)`,
    };
  }

  if (!INSTANCE_ID_PATTERN.test(instanceId)) {
    return {
      ok: false,
      code: "INVALID_INSTANCE",
      error: "Instance ID must match [a-zA-Z0-9_-]",
    };
  }

  return { ok: true, value: instanceId };
}

function parseOverrideMinutes(raw: string | null):
  | { ok: true; value: number; clamped: boolean }
  | { ok: false; code: string; error: string } {
  const minutesParam = raw || "5";
  const parsed = parseInt(minutesParam, 10);

  if (Number.isNaN(parsed)) {
    return {
      ok: false,
      code: "INVALID_MINUTES",
      error: "Invalid minutes parameter",
    };
  }

  const clamped = parsed < MIN_OVERRIDE_MINUTES || parsed > MAX_OVERRIDE_MINUTES;
  const value = Math.max(MIN_OVERRIDE_MINUTES, Math.min(MAX_OVERRIDE_MINUTES, parsed));
  return { ok: true, value, clamped };
}

export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowedPrefixes = ["http://localhost", "chrome-extension://"];
  const corsOrigin = allowedPrefixes.some((p) => origin.startsWith(p)) ? origin : "";

  return {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

export async function handleRequest(req: Request, currentState: LockXState = state): Promise<Response> {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(req, {
      ok: true,
      version: APP_VERSION,
      uptimeSec: Math.floor((Date.now() - currentState.startedAt) / 1000),
    });
  }

  if (req.method === "GET" && url.pathname === "/status") {
    return json(req, {
      status: getAggregatedStatus(currentState),
      instances: getInstancesSnapshot(currentState),
      override: currentState.overrideUntil
        ? Math.max(0, Math.round((currentState.overrideUntil - Date.now()) / 1000))
        : null,
    });
  }

  if (req.method === "GET" && url.pathname === "/config") {
    const config = await loadConfig();
    return json(req, config);
  }

  if (req.method === "POST" && (url.pathname === "/working" || url.pathname === "/idle")) {
    const parsedInstance = parseInstanceId(url.searchParams.get("instance"));
    if (!parsedInstance.ok) {
      return errorJson(req, 400, parsedInstance.code, parsedInstance.error);
    }

    if (!currentState.instances.has(parsedInstance.value) && currentState.instances.size >= MAX_INSTANCES) {
      return errorJson(req, 429, "TOO_MANY_INSTANCES", "Too many instances", {
        maxInstances: MAX_INSTANCES,
      });
    }

    const nextStatus: "working" | "idle" = url.pathname === "/working" ? "working" : "idle";
    const previous = currentState.instances.get(parsedInstance.value)?.status;
    currentState.instances.set(parsedInstance.value, { status: nextStatus, lastUpdate: Date.now() });

    if (previous !== nextStatus) {
      log(`${parsedInstance.value}: ${previous ?? "new"} → ${nextStatus}`);
    }

    return json(req, {
      ok: true,
      instance: parsedInstance.value,
      status: nextStatus,
    });
  }

  if (req.method === "POST" && url.pathname === "/override") {
    const now = Date.now();
    if (now - currentState.lastOverrideTime < OVERRIDE_COOLDOWN_MS) {
      const remainingSecs = Math.ceil((OVERRIDE_COOLDOWN_MS - (now - currentState.lastOverrideTime)) / 1000);
      return errorJson(req, 429, "OVERRIDE_COOLDOWN", "Override cooldown active", {
        retryAfterSeconds: remainingSecs,
      });
    }

    const parsedMinutes = parseOverrideMinutes(url.searchParams.get("minutes"));
    if (!parsedMinutes.ok) {
      return errorJson(req, 400, parsedMinutes.code, parsedMinutes.error);
    }

    currentState.overrideUntil = now + parsedMinutes.value * 60 * 1000;
    currentState.lastOverrideTime = now;
    log(`Override activated for ${parsedMinutes.value} minutes`);

    return json(req, {
      ok: true,
      override: true,
      minutes: parsedMinutes.value,
      until: currentState.overrideUntil,
      clamped: parsedMinutes.clamped,
    });
  }

  if (req.method === "POST" && url.pathname === "/clear-override") {
    currentState.overrideUntil = null;
    log("Override cleared");
    return json(req, { ok: true, override: false });
  }

  return errorJson(req, 404, "NOT_FOUND", "Not found");
}

if (import.meta.main) {
  const server = Bun.serve({
    port: PORT,
    fetch: (req) => handleRequest(req, state),
  });

  console.log(`Lock X server running on http://localhost:${server.port}`);
  if (DEBUG) {
    console.log("Debug mode enabled - state changes will be logged");
  }

  setInterval(() => cleanupStaleInstances(state), CLEANUP_INTERVAL_MS);

  function shutdown(signal: string) {
    console.log(`Received ${signal}, shutting down...`);
    server.stop();
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
