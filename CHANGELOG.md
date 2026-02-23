# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-02-23

### Added
- `GET /health` endpoint with version and uptime.
- Structured API error codes and payloads.
- Instance ID input validation for `/working` and `/idle`.
- Bun test suite for server logic and extension blocking decision logic.
- GitHub Actions CI for install + test checks.
- `uninstall.sh` script.
- `CONTRIBUTING.md`, issue templates, and pull request template.

### Changed
- Extension background polling now uses timeouts and retry backoff.
- Blocked-page redirect handling now validates return URLs.
- Installer performs idempotent hook merge with JSON validation.
- Service metadata now points to the correct repository documentation.

### Security
- Retained strict fail-closed policy for blocked domains when status is uncertain.
