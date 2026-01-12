#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_FILE="lock-x.service"

echo "=== Lock X Installer ==="
echo ""

# Check for bun
if ! command -v bun &> /dev/null; then
    echo "Error: bun is not installed."
    echo "Install it with: curl -fsSL https://bun.sh/install | bash"
    exit 1
fi
echo "[OK] bun found: $(bun --version)"

# Check for jq (needed for JSON manipulation)
if ! command -v jq &> /dev/null; then
    echo "Error: jq is not installed."
    echo "Install it with: sudo apt install jq"
    exit 1
fi
echo "[OK] jq found"

# Install dependencies
echo ""
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
bun install

# Configure Claude Code hooks
echo ""
echo "Configuring Claude Code hooks..."

mkdir -p "$(dirname "$CLAUDE_SETTINGS")"

# Define the hooks we want to add (new format with matcher string and typed hooks)
LOCK_X_HOOKS=$(cat <<'EOF'
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
EOF
)

if [ -f "$CLAUDE_SETTINGS" ]; then
    # Merge with existing settings
    echo "  Found existing settings, merging hooks..."

    # Create a backup
    cp "$CLAUDE_SETTINGS" "$CLAUDE_SETTINGS.backup"
    echo "  Backup created: $CLAUDE_SETTINGS.backup"

    # Merge hooks using jq
    # This adds our hooks to the existing hooks array for each event type
    MERGED=$(jq -s '
        def merge_hook_arrays($existing; $new):
            if $existing == null then $new
            elif $new == null then $existing
            else $existing + $new
            end;

        .[0] as $existing | .[1] as $new |
        $existing * {
            hooks: {
                PreToolUse: merge_hook_arrays($existing.hooks.PreToolUse; $new.hooks.PreToolUse),
                Stop: merge_hook_arrays($existing.hooks.Stop; $new.hooks.Stop)
            }
        }
    ' "$CLAUDE_SETTINGS" <(echo "$LOCK_X_HOOKS"))

    echo "$MERGED" > "$CLAUDE_SETTINGS"
else
    # Create new settings file
    echo "  Creating new settings file..."
    echo "$LOCK_X_HOOKS" > "$CLAUDE_SETTINGS"
fi
echo "[OK] Claude Code hooks configured"

# Install systemd service
echo ""
echo "Installing systemd service..."

mkdir -p "$SERVICE_DIR"

# Copy service file, replacing %h with actual home directory for compatibility
sed "s|%h|$HOME|g" "$SCRIPT_DIR/$SERVICE_FILE" > "$SERVICE_DIR/$SERVICE_FILE"

# Reload systemd and enable service
systemctl --user daemon-reload
systemctl --user enable lock-x.service
systemctl --user start lock-x.service

echo "[OK] systemd service installed and started"

# Verify server is running
echo ""
echo "Verifying server..."
sleep 1
if curl -s http://localhost:51736/status > /dev/null 2>&1; then
    echo "[OK] Server is running on http://localhost:51736"
else
    echo "[WARN] Server may not be running. Check with: systemctl --user status lock-x"
fi

# Print Chrome extension instructions
echo ""
echo "=== Installation Complete ==="
echo ""
echo "Final step: Load the Chrome extension"
echo ""
echo "1. Open Chrome and go to: chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked'"
echo "4. Select this folder: $SCRIPT_DIR/extension"
echo ""
echo "The extension badge will show:"
echo "  - Green (empty): X allowed (Claude working or not running)"
echo "  - Red (!): X blocked (Claude idle)"
echo "  - Gray (?): Server offline"
echo ""
echo "Escape hatch commands:"
echo "  curl -X POST 'localhost:51736/override?minutes=5'  # Allow X for 5 min"
echo "  curl localhost:51736/status                        # Check status"
echo ""
