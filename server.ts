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

function log(message: string) {
  if (DEBUG) {
    const timestamp = new Date().toISOString().slice(11, 19);
    console.log(`[${timestamp}] ${message}`);
  }
}

function loadConfig(): Config {
  try {
    const file = Bun.file(CONFIG_FILE);
    const text = require("fs").readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(text);
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

  // Clean up stale instances
  cleanupStaleInstances();

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
  cleanupStaleInstances();
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /status - Get current aggregated status
    if (req.method === "GET" && url.pathname === "/status") {
      const status = getAggregatedStatus();
      const response = {
        status,
        instances: getInstancesSnapshot(),
        override: overrideUntil ? Math.round((overrideUntil - Date.now()) / 1000) : null,
      };
      return new Response(JSON.stringify(response), { headers: corsHeaders });
    }

    // GET /config - Get blocked sites configuration
    if (req.method === "GET" && url.pathname === "/config") {
      const config = loadConfig();
      return new Response(JSON.stringify(config), { headers: corsHeaders });
    }

    // POST /working?instance=ID - Set instance to working
    if (req.method === "POST" && url.pathname === "/working") {
      const instanceId = url.searchParams.get("instance") || "default";
      const previous = instances.get(instanceId)?.status;
      instances.set(instanceId, { status: "working", lastUpdate: Date.now() });
      if (previous !== "working") {
        log(`${instanceId}: ${previous ?? "new"} → working`);
      }
      return new Response(JSON.stringify({ ok: true, instance: instanceId, status: "working" }), {
        headers: corsHeaders,
      });
    }

    // POST /idle?instance=ID - Set instance to idle
    if (req.method === "POST" && url.pathname === "/idle") {
      const instanceId = url.searchParams.get("instance") || "default";
      const previous = instances.get(instanceId)?.status;
      instances.set(instanceId, { status: "idle", lastUpdate: Date.now() });
      if (previous !== "idle") {
        log(`${instanceId}: ${previous ?? "new"} → idle`);
      }
      return new Response(JSON.stringify({ ok: true, instance: instanceId, status: "idle" }), {
        headers: corsHeaders,
      });
    }

    // POST /override?minutes=N - Temporarily force working status
    if (req.method === "POST" && url.pathname === "/override") {
      const minutes = parseInt(url.searchParams.get("minutes") || "5", 10);
      const clampedMinutes = Math.max(1, Math.min(60, minutes)); // 1-60 minutes
      overrideUntil = Date.now() + clampedMinutes * 60 * 1000;
      log(`Override activated for ${clampedMinutes} minutes`);
      return new Response(
        JSON.stringify({ ok: true, override: true, minutes: clampedMinutes, until: overrideUntil }),
        { headers: corsHeaders }
      );
    }

    // POST /clear-override - Clear the override
    if (req.method === "POST" && url.pathname === "/clear-override") {
      overrideUntil = null;
      log("Override cleared");
      return new Response(JSON.stringify({ ok: true, override: false }), { headers: corsHeaders });
    }

    // 404 for unknown routes
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: corsHeaders,
    });
  },
});

console.log(`Lock X server running on http://localhost:${server.port}`);
if (DEBUG) {
  console.log("Debug mode enabled - state changes will be logged");
}
