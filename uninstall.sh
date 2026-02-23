#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"
SERVICE_PATH="$HOME/.config/systemd/user/lock-x.service"

echo "=== Lock X Uninstaller ==="

if command -v systemctl >/dev/null 2>&1; then
  systemctl --user stop lock-x.service 2>/dev/null || true
  systemctl --user disable lock-x.service 2>/dev/null || true
  rm -f "$SERVICE_PATH"
  systemctl --user daemon-reload
  echo "[OK] Removed systemd user service"
fi

if [ -f "$CLAUDE_SETTINGS" ] && command -v jq >/dev/null 2>&1; then
  TMP_FILE="$(mktemp)"
  jq '
    if .hooks then
      .hooks.PreToolUse = ((.hooks.PreToolUse // [])
        | map(select(((.hooks // [])
          | map(select(.type == "command" and .command == "curl -s -X POST \\\"http://localhost:51736/working?instance=$PPID\\\""))
          | length) == 0))) |
      .hooks.Stop = ((.hooks.Stop // [])
        | map(select(((.hooks // [])
          | map(select(.type == "command" and .command == "curl -s -X POST \\\"http://localhost:51736/idle?instance=$PPID\\\""))
          | length) == 0)))
    else
      .
    end
  ' "$CLAUDE_SETTINGS" > "$TMP_FILE"
  mv "$TMP_FILE" "$CLAUDE_SETTINGS"
  echo "[OK] Removed Lock X hooks from $CLAUDE_SETTINGS"
else
  echo "[WARN] Could not modify $CLAUDE_SETTINGS (missing file or jq)"
fi

echo ""
echo "Next step: remove the Chrome extension at chrome://extensions/"
echo "Uninstall complete."
