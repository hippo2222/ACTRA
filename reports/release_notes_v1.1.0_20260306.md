# Release Notes v1.1.0

- Date: 2026-03-06
- Commit: `22ddb42`
- Status: release-ready

## Highlights

- Delivered the theory-driven workspace loop: `Theory Hub`, topic-theory links, impact/conflict views, and roundtrip navigation from theory into training and back.
- Hardened import/export and editor workflows: richer archive preview, confirm idempotency, ownership metadata, improved recovery behavior, and cross-screen state consistency.
- Added a real browser smoke release gate for the critical product surface, including theory-flow, complexes, sessions, statistics, microcards, and editor archive roundtrip.

## Verification

- `npm run smoke:release:gate` -> `20 passed, 0 failed`
- Release candidate branch pushed at `22ddb42`

## Release Discipline

- Run `npm run smoke:release:gate` before each release build.
- Generated local artifacts under `data/` and raw smoke reports are intentionally excluded from git history.
