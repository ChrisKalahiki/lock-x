// Content script that runs on potentially blocked pages
// Checks with background script if blocking is enabled AND if this site is blocked

const MESSAGE_TIMEOUT_MS = 5000;

// Send message with timeout to prevent indefinite hangs
function sendMessageWithTimeout(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return Promise.race([
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve)),
    new Promise((resolve) => setTimeout(() => resolve({ error: "timeout" }), timeoutMs)),
  ]);
}

async function checkAndBlock() {
  try {
    // First check if blocking is enabled
    const blockResponse = await sendMessageWithTimeout({ type: "checkBlock" });

    if (!blockResponse || blockResponse.error || !blockResponse.shouldBlock) {
      return; // Not blocking right now (or timeout)
    }

    // Check if this specific site is in the blocked list
    const siteResponse = await sendMessageWithTimeout({
      type: "checkSite",
      hostname: window.location.hostname
    });

    if (siteResponse && !siteResponse.error && siteResponse.isBlocked) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = chrome.runtime.getURL(`blocked.html?returnUrl=${returnUrl}`);
    }
  } catch (e) {
    console.error("Lock X: Error checking block status", e);
  }
}

checkAndBlock();
