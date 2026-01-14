const STATUS_URL = "http://localhost:51736/status";
const CONFIG_URL = "http://localhost:51736/config";
const CHECK_INTERVAL_MINUTES = 5 / 60; // 5 seconds in minutes
const CONFIG_CHECK_INTERVAL_MINUTES = 5; // 5 minutes
const BLOCK_RULE_ID = 1;

let lastStatus = null;
let blockingEnabled = false;
let blockedSites = ["x.com", "twitter.com"]; // Default fallback

// Restore state from storage on startup
chrome.storage.local.get(["lastStatus", "blockedSites"], (data) => {
  if (data.lastStatus) lastStatus = data.lastStatus;
  if (data.blockedSites && Array.isArray(data.blockedSites)) {
    blockedSites = data.blockedSites;
  }
});

// Save state to storage
function saveState() {
  chrome.storage.local.set({ lastStatus, blockedSites });
}

// Badge colors
const BADGE_COLORS = {
  working: "#22c55e", // Green - allowed
  idle: "#ef4444", // Red - blocked
  error: "#6b7280", // Gray - server down
};

// Generate block rules from site list
function generateBlockRules(sites) {
  const domains = [];
  sites.forEach(site => {
    domains.push(site, `www.${site}`, `mobile.${site}`, `m.${site}`);
  });

  return [{
    id: BLOCK_RULE_ID,
    priority: 1,
    action: { type: "block" },
    condition: {
      requestDomains: domains,
      resourceTypes: ["main_frame"],
    },
  }];
}

async function updateBadge(status, text) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[status] });
  await chrome.action.setBadgeText({ text });

  const titles = {
    working: "Lock X: Working - sites allowed",
    idle: "Lock X: Idle - sites blocked",
    error: "Lock X: Server offline - sites allowed",
  };
  await chrome.action.setTitle({ title: titles[status] });
}

async function setBlockingEnabled(enabled) {
  try {
    const rules = enabled ? generateBlockRules(blockedSites) : [];
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [BLOCK_RULE_ID],
      addRules: rules,
    });
    console.log(`Lock X: Blocking ${enabled ? "enabled" : "disabled"}`);
    blockingEnabled = enabled;
  } catch (e) {
    console.error("Lock X: Failed to update rules:", e);
  }
}

async function fetchConfig() {
  try {
    const response = await fetch(CONFIG_URL);
    const config = await response.json();
    if (config.blockedSites && Array.isArray(config.blockedSites)) {
      blockedSites = config.blockedSites;
      saveState();
      console.log("Lock X: Config loaded, blocking:", blockedSites);

      // If currently blocking, update rules with new config
      if (blockingEnabled) {
        await setBlockingEnabled(true);
      }
    }
  } catch (e) {
    console.log("Lock X: Could not fetch config, using defaults");
  }
}

async function checkStatus() {
  try {
    const response = await fetch(STATUS_URL);
    const data = await response.json();

    const shouldBlock = data.status === "idle";

    // Only update if status changed
    if (lastStatus !== data.status) {
      console.log(`Lock X: Status changed from ${lastStatus} to ${data.status}`);
      lastStatus = data.status;
      saveState();
      await setBlockingEnabled(shouldBlock);

      if (shouldBlock) {
        await updateBadge("idle", "!");
      } else {
        await updateBadge("working", "");
      }
    }
  } catch (e) {
    // Server unreachable = Claude Code not running = allow
    if (lastStatus !== "error") {
      console.log("Lock X: Server unreachable, disabling blocking");
      lastStatus = "error";
      saveState();
      await setBlockingEnabled(false);
      await updateBadge("error", "?");
    }
  }
}

// Set up periodic checking using alarms
chrome.alarms.create("checkStatus", { periodInMinutes: CHECK_INTERVAL_MINUTES });
chrome.alarms.create("checkConfig", { periodInMinutes: CONFIG_CHECK_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkStatus") {
    checkStatus();
  } else if (alarm.name === "checkConfig") {
    fetchConfig();
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "checkBlock") {
    sendResponse({ shouldBlock: lastStatus === "idle" });
  } else if (message.type === "checkSite") {
    const hostname = message.hostname.replace(/^(www\.|m\.|mobile\.)/, "");
    const isBlocked = blockedSites.some(site => hostname === site || hostname.endsWith("." + site));
    sendResponse({ isBlocked });
  }
  return true;
});

// Initial checks on service worker startup
checkStatus();
fetchConfig();

// Also check when the service worker wakes up
chrome.runtime.onStartup.addListener(() => {
  checkStatus();
  fetchConfig();
});

chrome.runtime.onInstalled.addListener(() => {
  checkStatus();
  fetchConfig();
});
