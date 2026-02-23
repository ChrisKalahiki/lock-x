# Lock X

A local productivity tool that blocks distracting sites while Claude Code is idle.

## What It Does

Lock X combines Claude Code hooks, a local Bun server, and a Chrome extension:

- Claude Code hooks report per-instance status (`working`/`idle`) to the local server.
- The server computes aggregate state across instances.
- The extension polls that state and blocks configured sites when appropriate.

Blocking rule:

- If any Claude instance is idle, configured distracting sites are blocked.
- If all tracked instances are working (or none are running), sites are allowed.
- Temporary override can force `working` for a short break.

## Supported Platforms

- Linux with systemd user services
- Chrome/Chromium (Manifest V3 extension)

Not currently supported:

- macOS launchd setup
- Windows services
- Firefox extension packaging

## Privacy And Security

- Local-only by design. No telemetry or external analytics.
- Server listens on `localhost` only.
- Extension uses strict fail-closed behavior on configured blocked domains when status is uncertain.
- State is kept in-memory on the server; extension stores last known status and blocked site list in local browser storage.

## Installation

```bash
git clone https://github.com/ChrisKalahiki/lock-x.git
cd lock-x
./install.sh
```

Installer actions:

1. Installs Bun dependencies
2. Merges Claude hooks into `~/.claude/settings.json` (idempotent)
3. Installs/restarts `lock-x.service` in user systemd
4. Prints extension setup and verification commands

### Load Extension

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click **Load unpacked**
4. Select `extension/`

## API Endpoints

- `GET /health` -> service metadata
- `GET /status` -> aggregate status and instance snapshot
- `GET /config` -> blocked sites
- `POST /working?instance=ID` -> mark instance working
- `POST /idle?instance=ID` -> mark instance idle
- `POST /override?minutes=N` -> temporary break override
- `POST /clear-override` -> clear override

### Example

```bash
curl -s localhost:51736/health
curl -s localhost:51736/status
curl -X POST "localhost:51736/working?instance=$PPID"
curl -X POST "localhost:51736/override?minutes=10"
```

## Configuration

Edit `config.json`:

```json
{
  "blockedSites": [
    "x.com",
    "twitter.com",
    "reddit.com"
  ]
}
```

Site matching includes root and subdomains (`www`, `m`, `mobile`, etc.).

## Dev Commands

```bash
bun run dev     # debug server logs
bun run start   # normal server
bun test        # run test suite
```

## Troubleshooting Matrix

| Symptom | Check | Fix |
|---|---|---|
| Extension shows `?` badge | `curl -s localhost:51736/health` | Restart service: `systemctl --user restart lock-x` |
| Sites not blocking when expected | `curl -s localhost:51736/status` | Confirm at least one instance is `idle`; restart extension |
| Override fails | `curl -s localhost:51736/status` | Wait for cooldown (`retryAfterSeconds`) then retry |
| Hooks not updating status | inspect `~/.claude/settings.json` | Re-run `./install.sh` and restart Claude Code |
| Service fails on boot | `systemctl --user status lock-x` | Check Bun path and service environment |

## Uninstall

```bash
./uninstall.sh
```

Then remove the extension from `chrome://extensions/`.

## Contributing

See `CONTRIBUTING.md`.

## License

MIT
