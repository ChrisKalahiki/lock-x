// Content script that runs on potentially blocked pages
// Checks with background script if blocking is enabled AND if this site is blocked

async function checkAndBlock() {
  try {
    // First check if blocking is enabled
    const blockResponse = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "checkBlock" }, resolve);
    });

    if (!blockResponse || !blockResponse.shouldBlock) {
      return; // Not blocking right now
    }

    // Check if this specific site is in the blocked list
    const siteResponse = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: "checkSite",
        hostname: window.location.hostname
      }, resolve);
    });

    if (siteResponse && siteResponse.isBlocked) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = chrome.runtime.getURL(`blocked.html?returnUrl=${returnUrl}`);
    }
  } catch (e) {
    console.error("Lock X: Error checking block status", e);
  }
}

checkAndBlock();
