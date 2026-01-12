// Content script that runs on x.com/twitter.com pages
// Checks with background script if blocking is enabled, then redirects

chrome.runtime.sendMessage({ type: "checkBlock" }, (response) => {
  if (response && response.shouldBlock) {
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = chrome.runtime.getURL(`blocked.html?returnUrl=${returnUrl}`);
  }
});
