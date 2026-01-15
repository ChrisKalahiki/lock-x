# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lock X is a Claude Code plugin that blocks distracting sites (configurable via `config.json`) when Claude Code is idle. It consists of three components:

1. **Bun Status Server** (`server.ts`) - HTTP server tracking instance states
2. **Chrome Extension** (`extension/`) - Polls server, blocks sites via content script
3. **Claude Code Hooks** - Configured in `~/.claude/settings.json`

## Commands

```bash
# Development
bun run server.ts          # Start server
DEBUG=1 bun run server.ts  # Start with logging

# Testing endpoints
curl localhost:51736/status
curl -X POST "localhost:51736/working?instance=test"
curl -X POST "localhost:51736/idle?instance=test"
curl -X POST "localhost:51736/override?minutes=5"
curl -X POST localhost:51736/clear-override

# Installation
./install.sh               # Full install (hooks, systemd, deps)

# Service management
systemctl --user start lock-x
systemctl --user stop lock-x
systemctl --user status lock-x
```

## Architecture

- Multi-instance tracking: Each Claude Code instance identified by TTY
- Aggregated status: Returns "idle" if ANY instance is idle
- Stale cleanup: Instances removed after 60s without update
- Override: Temporarily force "working" status

## Key Files

- `server.ts` - Main server with all endpoint handlers
- `config.json` - Blocked sites configuration
- `extension/background.js` - Service worker with polling and badge updates
- `extension/content.js` - Content script that redirects blocked pages
- `extension/manifest.json` - Chrome extension configuration
- `install.sh` - Handles hook merging and systemd setup
