// Content script that runs on potentially blocked pages
// Checks with background script if blocking is enabled and if this site is blocked

const MESSAGE_TIMEOUT_MS = 5000;

function sendMessageWithTimeout(message, timeoutMs = MESSAGE_TIMEOUT_MS) {
  return Promise.race([
    new Promise((resolve) => chrome.runtime.sendMessage(message, resolve)),
    new Promise((resolve) => setTimeout(() => resolve({ error: "timeout" }), timeoutMs)),
  ]);
}

function shouldBlockPage(statusResponse, siteResponse) {
  const shouldBlockGlobally = !(statusResponse && !statusResponse.error && statusResponse.shouldBlock === false);
  if (!shouldBlockGlobally) {
    return false;
  }

  return !siteResponse || Boolean(siteResponse.error) || Boolean(siteResponse.isBlocked);
}

function redirectToBlockedPage() {
  const returnUrl = encodeURIComponent(window.location.href);
  window.location.href = chrome.runtime.getURL(`blocked.html?returnUrl=${returnUrl}`);
}

async function checkAndBlock() {
  try {
    const blockResponse = await sendMessageWithTimeout({ type: "checkBlock" });
    const siteResponse = await sendMessageWithTimeout({
      type: "checkSite",
      hostname: window.location.hostname,
    });

    if (shouldBlockPage(blockResponse, siteResponse)) {
      redirectToBlockedPage();
    }
  } catch (e) {
    console.error("Lock X: Error checking block status, blocking by default", e);
    redirectToBlockedPage();
  }
}

if (typeof window !== "undefined" && typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
  checkAndBlock();
}

globalThis.__lockXContentTest = {
  shouldBlockPage,
};
