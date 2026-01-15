const PORT = 51736;
const STALE_TIMEOUT_MS = 60_000; // 60 seconds
const DEBUG = process.env.DEBUG === "1";
const CONFIG_FILE = import.meta.dir + "/config.json";

interface Config {
  blockedSites: string[];
}

interface InstanceState {
  status: "working" | "idle";
  lastUpdate: number;
}

const instances = new Map<string, InstanceState>();
let overrideUntil: number | null = null;
let lastOverrideTime = 0;
const OVERRIDE_COOLDOWN_MS = 60_000; // 1 minute between overrides
const CLEANUP_INTERVAL_MS = 30_000; // 30 seconds
const MAX_INSTANCES = 100;
const MIN_OVERRIDE_MINUTES = 1;
const MAX_OVERRIDE_MINUTES = 60;

function log(message: string) {
  if (DEBUG) {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${message}`);
  }
}

async function loadConfig(): Promise<Config> {
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
    return { blockedSites: ["x.com", "twitter.com"] };
  }
}

function cleanupStaleInstances() {
  const now = Date.now();
  for (const [id, state] of instances) {
    if (now - state.lastUpdate > STALE_TIMEOUT_MS) {
      log(`Removing stale instance: ${id}`);
      instances.delete(id);
    }
  }
}

function getAggregatedStatus(): "working" | "idle" {
  // Check override first
  if (overrideUntil && Date.now() < overrideUntil) {
    return "working";
  }

  // No instances = Claude Code not running = allow
  if (instances.size === 0) {
    return "working";
  }

  // Block if ANY instance is idle
  for (const state of instances.values()) {
    if (state.status === "idle") {
      return "idle";
    }
  }

  return "working";
}

function getInstancesSnapshot(): Record<string, { status: string; age: number }> {
  const now = Date.now();
  const snapshot: Record<string, { status: string; age: number }> = {};
  for (const [id, state] of instances) {
    snapshot[id] = {
      status: state.status,
      age: Math.round((now - state.lastUpdate) / 1000),
    };
  }
  return snapshot;
}

function getCorsHeaders(request: Request): Record<string, string> {
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

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const headers = getCorsHeaders(req);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    // GET /status - Get current aggregated status
    if (req.method === "GET" && url.pathname === "/status") {
      const status = getAggregatedStatus();
      const response = {
        status,
        instances: getInstancesSnapshot(),
        override: overrideUntil ? Math.round((overrideUntil - Date.now()) / 1000) : null,
      };
      return new Response(JSON.stringify(response), { headers });
    }

    // GET /config - Get blocked sites configuration
    if (req.method === "GET" && url.pathname === "/config") {
      const config = await loadConfig();
      return new Response(JSON.stringify(config), { headers });
    }

    // POST /working?instance=ID - Set instance to working
    if (req.method === "POST" && url.pathname === "/working") {
      const instanceId = url.searchParams.get("instance") || "default";
      // Check instance limit for new instances
      if (!instances.has(instanceId) && instances.size >= MAX_INSTANCES) {
        return new Response(
          JSON.stringify({ error: "Too many instances" }),
          { status: 429, headers }
        );
      }
      const previous = instances.get(instanceId)?.status;
      instances.set(instanceId, { status: "working", lastUpdate: Date.now() });
      if (previous !== "working") {
        log(`${instanceId}: ${previous ?? "new"} → working`);
      }
      return new Response(JSON.stringify({ ok: true, instance: instanceId, status: "working" }), {
        headers,
      });
    }

    // POST /idle?instance=ID - Set instance to idle
    if (req.method === "POST" && url.pathname === "/idle") {
      const instanceId = url.searchParams.get("instance") || "default";
      // Check instance limit for new instances
      if (!instances.has(instanceId) && instances.size >= MAX_INSTANCES) {
        return new Response(
          JSON.stringify({ error: "Too many instances" }),
          { status: 429, headers }
        );
      }
      const previous = instances.get(instanceId)?.status;
      instances.set(instanceId, { status: "idle", lastUpdate: Date.now() });
      if (previous !== "idle") {
        log(`${instanceId}: ${previous ?? "new"} → idle`);
      }
      return new Response(JSON.stringify({ ok: true, instance: instanceId, status: "idle" }), {
        headers,
      });
    }

    // POST /override?minutes=N - Temporarily force working status
    if (req.method === "POST" && url.pathname === "/override") {
      // Rate limiting: prevent spam
      if (Date.now() - lastOverrideTime < OVERRIDE_COOLDOWN_MS) {
        const remainingSecs = Math.ceil((OVERRIDE_COOLDOWN_MS - (Date.now() - lastOverrideTime)) / 1000);
        return new Response(
          JSON.stringify({ error: "Override cooldown active", retryAfterSeconds: remainingSecs }),
          { status: 429, headers }
        );
      }

      // Validate minutes parameter
      const minutesParam = url.searchParams.get("minutes") || "5";
      const minutes = parseInt(minutesParam, 10);
      if (isNaN(minutes)) {
        return new Response(
          JSON.stringify({ error: "Invalid minutes parameter" }),
          { status: 400, headers }
        );
      }

      const clampedMinutes = Math.max(MIN_OVERRIDE_MINUTES, Math.min(MAX_OVERRIDE_MINUTES, minutes));
      overrideUntil = Date.now() + clampedMinutes * 60 * 1000;
      lastOverrideTime = Date.now();
      log(`Override activated for ${clampedMinutes} minutes`);
      return new Response(
        JSON.stringify({ ok: true, override: true, minutes: clampedMinutes, until: overrideUntil }),
        { headers }
      );
    }

    // POST /clear-override - Clear the override
    if (req.method === "POST" && url.pathname === "/clear-override") {
      overrideUntil = null;
      log("Override cleared");
      return new Response(JSON.stringify({ ok: true, override: false }), { headers });
    }

    // 404 for unknown routes
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers,
    });
  },
});

console.log(`Lock X server running on http://localhost:${server.port}`);
if (DEBUG) {
  console.log("Debug mode enabled - state changes will be logged");
}

// Periodic cleanup of stale instances
setInterval(cleanupStaleInstances, CLEANUP_INTERVAL_MS);

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  server.stop();
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
