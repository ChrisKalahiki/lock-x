const params = new URLSearchParams(window.location.search);
const returnUrl = params.get("returnUrl");
const statusEl = document.getElementById("status");

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function parseSafeReturnUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(decodeURIComponent(url));
    if (!/^https?:$/.test(parsed.protocol)) {
      return null;
    }
    if (!parsed.hostname) {
      return null;
    }
    return parsed.toString();
  } catch (_e) {
    return null;
  }
}

function redirectBackIfSafe() {
  const safeUrl = parseSafeReturnUrl(returnUrl);
  if (safeUrl) {
    window.location.href = safeUrl;
    return true;
  }
  statusEl.textContent = "Unblocked. You can close this tab.";
  return false;
}

async function checkAndRedirect() {
  try {
    const response = await fetch("http://localhost:51736/status");
    const data = await response.json();

    if (data.override && data.override > 0) {
      statusEl.textContent = `Break active! ${formatTime(data.override)} remaining`;
      statusEl.style.color = "#22c55e";
    }

    if (data.status === "working") {
      statusEl.textContent = "Unblocked. Redirecting...";
      redirectBackIfSafe();
    }
  } catch (_err) {
    chrome.runtime.sendMessage({ type: "checkBlock" }, (response) => {
      if (response && response.shouldBlock === false) {
        statusEl.textContent = "Unblocked. Redirecting...";
        redirectBackIfSafe();
      }
    });
  }
}

setInterval(checkAndRedirect, 2000);
checkAndRedirect();

document.querySelectorAll(".break-btn").forEach((btn) => {
  btn.addEventListener("click", async (e) => {
    const minutes = e.currentTarget.dataset.minutes;
    document.querySelectorAll(".break-btn").forEach((b) => (b.disabled = true));
    statusEl.textContent = `Taking a ${minutes} minute break...`;

    try {
      const response = await fetch(`http://localhost:51736/override?minutes=${minutes}`, {
        method: "POST",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.code || data.error || "SERVER_ERROR");
      }

      statusEl.textContent = "Break activated! Redirecting...";
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "refreshStatus" }, resolve);
      });
      redirectBackIfSafe();
    } catch (err) {
      const message = String(err.message || "");
      if (message.includes("OVERRIDE_COOLDOWN") || message.includes("Override cooldown")) {
        statusEl.textContent = "Cooldown active. Wait before requesting another break.";
      } else {
        statusEl.textContent = "Failed to activate break. Check lock-x server status.";
      }
      statusEl.style.color = "#ef4444";
      document.querySelectorAll(".break-btn").forEach((b) => (b.disabled = false));
    }
  });
});
