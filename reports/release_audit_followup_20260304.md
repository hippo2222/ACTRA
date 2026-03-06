# Release Audit Follow-up (2026-03-04)

## Scope

- Static frontend audit after the initial smoke pass
- Focused on `Welcome`, `Main`, `Calendar`, `Complexes/create`, `Microcards`

## Fixes In This Batch

### 1. `Main`: cleaner statistics error state

- `showStatsError()` now removes the stale `statsWelcomeMessage` block before showing the statistics error panel.
- This prevents a mixed UI state where the user could see the "start your first complex" welcome copy together with a loading/error failure.

Files:

- `frontend/assets/MainLogic.js`

### 2. `Calendar`: no stale data after failed refetch

- Added `resetFetchedCalendarState()` and call it at the start of `fetchTodayPlan()`.
- A failed calendar refresh no longer leaves stale `daily_plan`, `schedule`, `notifications`, `activity`, `restDays`, `microcardsSummary`, or stale streak data visible from the previous successful load.
- This is especially important after retry flows and after updating time limits.

Files:

- `frontend/Calendar/calendar.html`

### 3. `Calendar`: safer time-limit failure behavior

- `setTimeLimit()` no longer blindly rolls back the local limit in the unexpected-exception path.
- If the saved value path was already taken, the UI now keeps the intended limit and shows a warning that the plan could not be refreshed immediately.
- This avoids lying about a value that may already be persisted on the backend.

Files:

- `frontend/Calendar/calendar.html`

## Relevant Earlier Fixes (same release-audit stream)

- `Welcome`: fixed password verification flow and blocked silent redirect when welcome is skipped but no active profile can be resolved.
- `Complexes/create`: sanitized catalog/history/theory-derived template strings, encoded path segments, and made the autosave indicator show real status text.
- `Microcards`: summary/streak strip now resets on `/api/microcards/summary` failure to avoid stale counters.
- `S2` / `S3`: result screens now show explicit errors instead of silent console-only failures.
- `Statistics`: partial-load failures now clear stale state and show warnings instead of pretending the screen is fresh.

## Verification

- `npm test`
  - Result: `16` test files passed, `79` tests passed, `2` skipped
- `npm run lint:frontend`
  - Result: passed

## Residual Risk

- `Calendar` and `Complexes/create` remain inline-script heavy screens.
- The fixes are validated by static audit plus the global Vitest/lint smoke pass, but there is still no dedicated test coverage for every new branch in those pages.

## Current Read

- The project still looks viable.
- The remaining risk is no longer "core mechanics are obviously broken", but "there may still be edge-case UX/state bugs in large inline-script screens".
- The release contour is materially safer now than at the start of this audit stream.
