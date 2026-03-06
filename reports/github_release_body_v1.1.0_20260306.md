# GitHub Release Body: v1.1.0

ACTRA `v1.1.0` is the first release-ready build of the current theory-driven workspace.

## What Changed

- Added a full theory workflow: `Theory Hub`, topic-theory links, impact/conflict views, and return navigation from training results back into theory context.
- Hardened the editor, complexes, settings, import/export, and recovery flows around real release scenarios.
- Introduced ownership-aware shared workspace behavior for complexes, theories, and microcards.
- Added a browser-level release smoke gate for the critical user surface.

## Verification

- `npm run smoke:release:gate` -> `20 passed, 0 failed`
- Release branch: `refactor/split-server`
- Release tag: `v1.1.0`

## Notes

- Shared content and personal progress now follow the `hybrid workspace + ownership` model.
- Generated local artifacts from smoke/data flows are intentionally excluded from git history.

## Recommended Release Text

Release-ready build with theory-driven workspace flow, hardened editor/import/runtime behavior, ownership-aware shared content model, and a real browser smoke gate across the critical product surface.
