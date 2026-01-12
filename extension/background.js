const STATUS_URL = "http://localhost:51736/status";
const CHECK_INTERVAL_MINUTES = 0.05; // ~3 seconds

let lastStatus = null;
let blockingEnabled = false;

// Badge colors
const BADGE_COLORS = {
  working: "#22c55e", // Green - allowed
  idle: "#ef4444", // Red - blocked
  error: "#6b7280", // Gray - server down
};

// Dynamic rules to block X/Twitter
const BLOCK_RULES = [
  {
    id: 1,
    priority: 1,
    action: { type: "block" },
    condition: {
      requestDomains: ["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"],
      resourceTypes: ["main_frame"],
    },
  },
];

async function updateBadge(status, text) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLORS[status] });
  await chrome.action.setBadgeText({ text });

  const titles = {
    working: "Lock X: Working - X allowed",
    idle: "Lock X: Idle - X blocked",
    error: "Lock X: Server offline - X allowed",
  };
  await chrome.action.setTitle({ title: titles[status] });
}

async function setBlockingEnabled(enabled) {
  try {
    // Always remove existing rules first, then add if needed
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1, 2, 3, 4, 5, 6], // Clear any stale rules
      addRules: enabled ? BLOCK_RULES : [],
    });
    console.log(`Lock X: Blocking ${enabled ? "enabled" : "disabled"}`);

    // Debug: log active rules
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    console.log("Lock X: Active rules:", JSON.stringify(rules));
    blockingEnabled = enabled;
  } catch (e) {
    console.error("Lock X: Failed to update rules:", e);
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
      await setBlockingEnabled(shouldBlock);

      if (shouldBlock) {
        await updateBadge("idle", "!");
      } else {
        await updateBadge("working", "");
      }
    }
  } catch (e) {
    // Server unreachable = Claude Code not running = allow X
    if (lastStatus !== "error") {
      console.log("Lock X: Server unreachable, disabling blocking");
      lastStatus = "error";
      await setBlockingEnabled(false);
      await updateBadge("error", "?");
    }
  }
}

// Set up periodic checking using alarms
chrome.alarms.create("checkStatus", { periodInMinutes: CHECK_INTERVAL_MINUTES });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "checkStatus") {
    checkStatus();
  }
});

// Handle messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "checkBlock") {
    sendResponse({ shouldBlock: lastStatus === "idle" });
  }
  return true;
});

// Initial check on service worker startup
checkStatus();

// Also check when the service worker wakes up
chrome.runtime.onStartup.addListener(checkStatus);
chrome.runtime.onInstalled.addListener(checkStatus);
