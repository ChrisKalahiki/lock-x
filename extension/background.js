const STATUS_URL = "http://localhost:51736/status";
const CONFIG_URL = "http://localhost:51736/config";
const CHECK_INTERVAL_MINUTES = 5 / 60; // 5 seconds in minutes
const CONFIG_CHECK_INTERVAL_MINUTES = 5; // 5 minutes
const FETCH_TIMEOUT_MS = 2000;
const MAX_BACKOFF_FACTOR = 12;

let lastStatus = null;
let blockedSites = ["x.com", "twitter.com", "reddit.com", "youtube.com", "facebook.com", "instagram.com", "tiktok.com", "discord.com"]; // Default fallback
let consecutiveStatusErrors = 0;

function normalizeHostname(hostname) {
  return hostname.replace(/^(www\.|m\.|mobile\.)/, "");
}

function isBlockedHostname(hostname, sites) {
  const normalized = normalizeHostname(hostname);
  return sites.some((site) => normalized === site || normalized.endsWith("." + site));
}

function shouldBlockPage(statusResponse, siteResponse) {
  // fail-closed: block unless we can explicitly prove this page should be allowed
  const shouldBlockGlobally = !(statusResponse && !statusResponse.error && statusResponse.shouldBlock === false);
  if (!shouldBlockGlobally) {
    return false;
  }

  return !siteResponse || Boolean(siteResponse.error) || Boolean(siteResponse.isBlocked);
}

async function fetchJsonWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Restore state from storage on startup
if (typeof chrome !== "undefined" && chrome.storage?.local) {
  chrome.storage.local.get(["lastStatus", "blockedSites"], (data) => {
    if (data.lastStatus) {
      lastStatus = data.lastStatus;
    }
    if (data.blockedSites && Array.isArray(data.blockedSites)) {
      blockedSites = data.blockedSites;
    }
  });
}

function saveState() {
  if (typeof chrome !== "undefined" && chrome.storage?.local) {
    chrome.storage.local.set({ lastStatus, blockedSites });
  }
}

const BADGE_COLORS = {
  working: "#22c55e", // Green - allowed
  idle: "#ef4444", // Red - blocked
  error: "#6b7280", // Gray - server down
};

async function updateBadge(status, text) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[status] });
  await chrome.action.setBadgeText({ text });

  const titles = {
    working: "Lock X: Working - sites allowed",
    idle: "Lock X: Idle - sites blocked",
    error: "Lock X: Server offline - sites blocked on known domains",
  };
  await chrome.action.setTitle({ title: titles[status] });
}

async function fetchConfig() {
  try {
    const config = await fetchJsonWithTimeout(CONFIG_URL);
    if (config.blockedSites && Array.isArray(config.blockedSites)) {
      blockedSites = config.blockedSites;
      saveState();
      console.log("Lock X: Config loaded, blocking:", blockedSites);
    }
  } catch (_e) {
    console.log("Lock X: Could not fetch config, using cached/default list");
  }
}

function computeBackoffFactor() {
  return Math.min(MAX_BACKOFF_FACTOR, 2 ** consecutiveStatusErrors);
}

async function checkStatus() {
  try {
    const data = await fetchJsonWithTimeout(STATUS_URL);
    consecutiveStatusErrors = 0;

    if (lastStatus !== data.status) {
      console.log(`Lock X: Status changed from ${lastStatus} to ${data.status}`);
      lastStatus = data.status;
      saveState();

      if (data.status === "idle") {
        await updateBadge("idle", "!");
      } else {
        await updateBadge("working", "");
      }
    }
  } catch (_e) {
    consecutiveStatusErrors += 1;

    if (lastStatus !== "error") {
      console.log("Lock X: Status endpoint unreachable, fail-closed for known blocked sites");
      lastStatus = "error";
      saveState();
      await updateBadge("error", "?");
    }
  }
}

if (typeof chrome !== "undefined" && chrome.alarms) {
  chrome.alarms.create("checkStatus", { periodInMinutes: CHECK_INTERVAL_MINUTES });
  chrome.alarms.create("checkConfig", { periodInMinutes: CONFIG_CHECK_INTERVAL_MINUTES });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "checkStatus") {
      const skipFactor = computeBackoffFactor();
      const randomGate = Math.floor(Math.random() * skipFactor);
      if (randomGate === 0) {
        checkStatus();
      }
    } else if (alarm.name === "checkConfig") {
      fetchConfig();
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === "checkBlock") {
      // error is treated as block-enabled for known blocked domains
      sendResponse({ shouldBlock: lastStatus !== "working" });
    } else if (message.type === "checkSite") {
      sendResponse({ isBlocked: isBlockedHostname(message.hostname, blockedSites) });
    } else if (message.type === "refreshStatus") {
      checkStatus().then(() => {
        sendResponse({ ok: true, status: lastStatus });
      });
      return true;
    }
    return true;
  });

  (async () => {
    checkStatus();
    fetchConfig();
  })();

  chrome.runtime.onStartup.addListener(() => {
    checkStatus();
    fetchConfig();
  });

  chrome.runtime.onInstalled.addListener(() => {
    checkStatus();
    fetchConfig();
  });
}

globalThis.__lockXBackgroundTest = {
  normalizeHostname,
  isBlockedHostname,
  shouldBlockPage,
};
