#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="lock-x.service"
LOCK_X_WORKING_CMD='curl -s -X POST "http://localhost:51736/working?instance=$PPID"'
LOCK_X_IDLE_CMD='curl -s -X POST "http://localhost:51736/idle?instance=$PPID"'

echo "=== Lock X Installer ==="
echo ""

if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed."
    echo "Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi
echo "[OK] bun found: $(bun --version)"

if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed."
    echo "Install it with: sudo apt install jq"
    exit 1
fi
echo "[OK] jq found"

if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed."
    echo "Install it with: sudo apt install curl"
    exit 1
fi
echo "[OK] curl found"

if ! command -v systemctl &> /dev/null; then
    echo "Error: systemctl not found (systemd required)."
    echo "This installer requires a Linux system with systemd."
    exit 1
fi
echo "[OK] systemctl found"

echo ""
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

echo ""
echo "Configuring Claude Code hooks..."
mkdir -p "$(dirname "$CLAUDE_SETTINGS")"

LOCK_X_HOOKS=$(cat <<'JSON'
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
JSON
)

if [ -f "$CLAUDE_SETTINGS" ]; then
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.backup"
    echo "  Backup created: $CLAUDE_SETTINGS.backup"

    if ! jq empty "$CLAUDE_SETTINGS" >/dev/null 2>&1; then
      echo "Error: existing $CLAUDE_SETTINGS is not valid JSON"
      echo "Restore from backup and fix JSON before re-running installer."
      exit 1
    fi

    MERGED=$(jq -s '
      .[0] as $existing | .[1] as $new |
      $existing * {
        hooks: {
          PreToolUse: ((($existing.hooks.PreToolUse // [])
            | map(select(((.hooks // [])
              | map(select(.type == "command" and .command == "curl -s -X POST \\\"http://localhost:51736/working?instance=$PPID\\\""))
              | length) == 0))) + ($new.hooks.PreToolUse // [])),
          Stop: ((($existing.hooks.Stop // [])
            | map(select(((.hooks // [])
              | map(select(.type == "command" and .command == "curl -s -X POST \\\"http://localhost:51736/idle?instance=$PPID\\\""))
              | length) == 0))) + ($new.hooks.Stop // []))
        }
      }
    ' "$CLAUDE_SETTINGS" <(echo "$LOCK_X_HOOKS"))

    if ! echo "$MERGED" | jq empty >/dev/null 2>&1; then
      echo "Error: merged Claude settings JSON is invalid; install aborted."
      exit 1
    fi

    echo "$MERGED" > "$CLAUDE_SETTINGS"
else
    echo "$LOCK_X_HOOKS" > "$CLAUDE_SETTINGS"
fi

echo "[OK] Claude Code hooks configured (idempotent merge)"

echo ""
echo "Installing systemd service..."
mkdir -p "$SERVICE_DIR"
BUN_PATH="$(which bun)"

sed -e "s|%h/code/lock-x|$SCRIPT_DIR|g" \
    -e "s|%h/.bun/bin/bun|$BUN_PATH|g" \
    -e "s|%h|$HOME|g" \
    "$SCRIPT_DIR/$SERVICE_FILE" > "$SERVICE_DIR/$SERVICE_FILE"

systemctl --user daemon-reload
systemctl --user enable lock-x.service
systemctl --user restart lock-x.service

echo "[OK] systemd service installed and started"

echo ""
echo "Verifying server..."
sleep 1
if curl -s http://localhost:51736/health > /dev/null 2>&1; then
    echo "[OK] Server is running on http://localhost:51736"
else
    echo "[WARN] Server may not be running. Check with: systemctl --user status lock-x"
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Final step: Load the Chrome extension"
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select this folder: $SCRIPT_DIR/extension"
echo ""
echo "Post-install verification checklist:"
echo "  1) curl -s localhost:51736/health"
echo "  2) curl -s localhost:51736/status"
echo "  3) systemctl --user status lock-x"
echo ""
echo "Escape hatch commands:"
echo "  curl -X POST 'localhost:51736/override?minutes=5'"
echo "  curl -X POST localhost:51736/clear-override"
