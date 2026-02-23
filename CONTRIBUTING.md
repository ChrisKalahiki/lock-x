# Contributing

## Development Setup

1. Install Bun and jq.
2. Clone the repository.
3. Run `bun install`.
4. Run `bun run dev` for a debug server.

## Testing

Run all tests:

```bash
bun test
```

## Pull Requests

1. Keep changes focused and small.
2. Add or update tests for behavior changes.
3. Update docs (`README.md`, `CHANGELOG.md`) when user behavior changes.
4. Ensure CI passes before requesting review.

## Reporting Bugs

Use the bug report issue template and include:
- Exact commands run
- `curl localhost:51736/health` and `curl localhost:51736/status` output
- Browser and OS details
