# Lock X

A Claude Code plugin that blocks x.com (Twitter) when Claude Code is open but idle. Stay productive!

## How It Works

When you have Claude Code open but it's waiting for your input (idle), you should be thinking about your code—not scrolling Twitter. Lock X enforces this by blocking x.com until Claude is actively working again.

```
┌─────────────────┐     hooks (curl)    ┌──────────────────┐
│ Claude Code (1) │ ──────────────────> │  Bun Status      │
├─────────────────┤   /working, /idle   │  Server (:51736) │
│ Claude Code (2) │ ────────────────────│  (multi-instance)│
└─────────────────┘                     └────────┬─────────┘
                                                 │ polls /status
                                        ┌────────▼─────────┐
                                        │ Chrome Extension │
                                        │ (content script) │
                                        └──────────────────┘
```

### State Logic

| Claude Code State | x.com |
|-------------------|-------|
| Not running | ✅ Allowed |
| All instances working | ✅ Allowed |
| **Any instance idle** | 🔒 **Blocked** |

If you have multiple Claude Code sessions open, x.com is blocked if *any* of them are idle.

## Prerequisites

- [Bun](https://bun.sh/) - `curl -fsSL https://bun.sh/install | bash`
- [jq](https://stedolan.github.io/jq/) - `sudo apt install jq` (Debian/Ubuntu) or `brew install jq` (macOS)
- Google Chrome or Chromium
- Linux with systemd (for auto-start)

## Installation

### Quick Install

```bash
git clone https://github.com/YOUR_USERNAME/lock-x.git
cd lock-x
./install.sh
```

The install script will:
1. Install Bun dependencies
2. Configure Claude Code hooks (merges with existing hooks)
3. Install and start the systemd user service
4. Print instructions for loading the Chrome extension

### Manual Chrome Extension Setup

After running the install script:

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `extension` folder from this repository

### Verify Installation

```bash
# Check server is running
curl localhost:51736/status

# Check systemd service
systemctl --user status lock-x
```

## Usage

Once installed, Lock X runs automatically in the background.

### Extension Badge

The extension icon shows the current status:

| Badge | Meaning |
|-------|---------|
| 🟢 (empty) | Working - x.com allowed |
| 🔴 `!` | Idle - x.com blocked |
| ⚫ `?` | Server offline - x.com allowed |

### Escape Hatch

Need a quick break? Temporarily allow x.com:

```bash
# Allow x.com for 5 minutes
curl -X POST "localhost:51736/override?minutes=5"

# Allow for custom duration (1-60 minutes)
curl -X POST "localhost:51736/override?minutes=15"

# Check current status and override time remaining
curl localhost:51736/status

# Clear override early
curl -X POST localhost:51736/clear-override
```

## Configuration

### Server Port

The default port is `51736`. To change it:

1. Edit `server.ts` and change the `PORT` constant
2. Update the hooks in `~/.claude/settings.json`
3. Update `STATUS_URL` in `extension/background.js`
4. Restart the service: `systemctl --user restart lock-x`

### Debug Mode

Run the server with logging to see state changes:

```bash
# Stop the service
systemctl --user stop lock-x

# Run manually with debug output
DEBUG=1 bun run server.ts
```

### Blocked Domains

The extension blocks:
- x.com, www.x.com, mobile.x.com
- twitter.com, www.twitter.com, mobile.twitter.com

To modify, edit the `content_scripts.matches` array in `extension/manifest.json`.

## How the Hooks Work

Lock X uses Claude Code's hook system to track activity:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "*",
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST \"http://localhost:51736/working?instance=$PPID\""
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "curl -s -X POST \"http://localhost:51736/idle?instance=$PPID\""
      }]
    }]
  }
}
```

- **PreToolUse**: Fires before Claude uses any tool → marks instance as "working"
- **Stop**: Fires when Claude finishes responding → marks instance as "idle"

Each Claude Code session is identified by its parent process ID (`$PPID`), allowing multi-instance tracking.

## Uninstallation

```bash
# Stop and disable the service
systemctl --user stop lock-x
systemctl --user disable lock-x
rm ~/.config/systemd/user/lock-x.service
systemctl --user daemon-reload

# Remove hooks from Claude settings
# Edit ~/.claude/settings.json and remove the PreToolUse and Stop hooks

# Remove the Chrome extension
# Go to chrome://extensions/ and remove "Lock X"

# Remove the project folder
rm -rf /path/to/lock-x
```

## Project Structure

```
lock-x/
├── server.ts              # Bun HTTP server for status tracking
├── package.json           # Bun project configuration
├── extension/
│   ├── manifest.json      # Chrome extension manifest (MV3)
│   ├── background.js      # Service worker for polling & badge
│   ├── content.js         # Content script for blocking
│   ├── blocked.html       # "Get back to work!" page
│   └── icons/             # Extension icons
├── lock-x.service         # systemd user service file
├── install.sh             # Installation script
├── CLAUDE.md              # Claude Code assistant guidance
└── README.md              # This file
```

## Troubleshooting

### Server not running

```bash
# Check service status
systemctl --user status lock-x

# View logs
journalctl --user -u lock-x -f

# Restart service
systemctl --user restart lock-x
```

### Hooks not firing

1. Verify hooks are in `~/.claude/settings.json`
2. Restart Claude Code after modifying settings
3. Check server logs: `DEBUG=1 bun run server.ts`

### Extension not blocking

1. Check badge color (should be red when idle)
2. Verify status is "idle": `curl localhost:51736/status`
3. Check extension console at `chrome://extensions/` → Lock X → "service worker"
4. Try removing and re-adding the extension

### x.com still accessible when badge is red

1. Hard refresh x.com (Ctrl+Shift+R)
2. Clear browser cache for x.com
3. Check content script is running (DevTools → Console on x.com)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
