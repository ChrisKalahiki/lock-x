const params = new URLSearchParams(window.location.search);
const returnUrl = params.get("returnUrl");
const statusEl = document.getElementById("status");

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

async function checkAndRedirect() {
  try {
    // Check server status directly for override countdown
    const response = await fetch('http://localhost:51736/status');
    const data = await response.json();

    if (data.status === 'working') {
      // Override active or Claude working - redirect
      if (returnUrl) {
        statusEl.textContent = "Unblocked! Redirecting...";
        window.location.href = decodeURIComponent(returnUrl);
      }
    } else if (data.override && data.override > 0) {
      // Show countdown for active override
      statusEl.textContent = `Break active! ${formatTime(data.override)} remaining`;
      statusEl.style.color = '#22c55e';
    }
  } catch (err) {
    // Fallback to extension message if server unreachable
    chrome.runtime.sendMessage({ type: "checkBlock" }, (response) => {
      if (response && !response.shouldBlock && returnUrl) {
        statusEl.textContent = "Unblocked! Redirecting...";
        window.location.href = decodeURIComponent(returnUrl);
      }
    });
  }
}

// Poll every 2 seconds
setInterval(checkAndRedirect, 2000);
// Also check immediately
checkAndRedirect();

// Handle break button clicks
document.querySelectorAll('.break-btn').forEach(btn => {
  btn.addEventListener('click', async (e) => {
    const minutes = e.target.dataset.minutes;
    document.querySelectorAll('.break-btn').forEach(b => b.disabled = true);
    statusEl.textContent = `Taking a ${minutes} minute break...`;

    try {
      const response = await fetch(`http://localhost:51736/override?minutes=${minutes}`, {
        method: 'POST'
      });
      if (response.ok) {
        statusEl.textContent = 'Break activated! Redirecting...';
        // Notify background to refresh status before redirecting
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ type: "refreshStatus" }, resolve);
        });
        if (returnUrl) {
          window.location.href = decodeURIComponent(returnUrl);
        }
      } else {
        const data = await response.json();
        throw new Error(data.error || 'Server error');
      }
    } catch (err) {
      statusEl.textContent = err.message === 'Override cooldown active'
        ? 'Cooldown active. Please wait before requesting another break.'
        : 'Failed to activate break. Is the server running?';
      statusEl.style.color = '#ef4444';
      document.querySelectorAll('.break-btn').forEach(b => b.disabled = false);
    }
  });
});
