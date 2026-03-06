# Release Browser Smoke Plan - 2026-03-05

## Goal

Create a small, release-oriented browser smoke suite that answers one practical question:

`Does the product still work as a connected application in a real browser?`

This suite is not meant to replace:

- backend `pytest`
- frontend `vitest`
- contrast/theme audits

It is a top-level integration guard for the main release-critical user flows.

## Why This Is Needed

The project already has strong lower-level coverage, but the current release risk is no longer isolated logic.

The real risk is:

- broken navigation between pages
- lost `sessionStorage` / URL / query param context
- inline-script regressions on HTML screens
- state drift between `Editor`, `Complexes`, `S1`, `S3`, `Calendar`, `Statistics`
- page loads that are individually valid but broken as a flow

## Existing Infrastructure

Relevant current state:

- `playwright` is already installed in `package.json`
- there is already a browser-oriented smoke script: [theory_p10_smoke.js](d:/Ai Ai/radioproject_git/scripts/theory_p10_smoke.js)
- the project already uses local script-style tooling (`node scripts/...`) instead of a heavy dedicated E2E layer

Recommended near-term direction:

- stay with `Node + Playwright` script-style smoke tests first
- avoid introducing a big test framework migration before release
- keep scenarios deterministic and short

## Scope Strategy

Release smoke should cover:

- primary learner flow
- primary author flow
- theory ecosystem flow
- high-visibility product screens

Release smoke should **not** try to cover:

- every edge case
- every modal
- every task subtype permutation
- every authoring branch
- visual pixel-perfect validation

That would create slow and fragile tests before release.

## Recommended Suite Shape

### P0: Must Exist Before/At Release

#### 1. Welcome -> Profile -> Main

Purpose:

- ensure app entry is not broken

Checks:

- `Welcome` loads
- profile selection/creation path is available
- transition to `Main` succeeds
- no blocking error banner appears

#### 2. Main -> Complexes -> Start Session

Purpose:

- ensure core training flow is alive

Checks:

- `Main` loads actionable CTA area
- navigation to `Complexes` works
- at least one complex card renders
- start/resume action opens `S1`

#### 3. S1 Core Session Smoke

Purpose:

- ensure active training screen is functional in real browser

Checks:

- `S1` loads current task
- progress/header UI appears
- check/next buttons are present and not permanently blocked
- no fatal task-render fallback is shown for seeded smoke task

#### 4. S3 Final Results Smoke

Purpose:

- ensure training completion still lands on usable results

Checks:

- `S3` loads final summary
- key result cards render
- primary navigation buttons are visible
- return out of results works

#### 5. Theory Hub Roundtrip

Purpose:

- protect the new theory ecosystem end-to-end

Checks:

- open `Theory Hub`
- focus a theory
- start training from theory
- `S1` shows theory context banner
- complete/land on `S3`
- `S3` shows return to `Theory Hub`
- return link opens focused theory context again

#### 6. Topic Theory Modal Navigation

Purpose:

- protect topic-level theory linking and its reverse navigation

Checks:

- open topic theory modal from `Editor`
- current theory loads
- buttons `к комплексам` and `Theory Hub` are visible when theory exists
- both transitions work

#### 7. Complexes Theory Modal / Complex Builder Context

Purpose:

- protect theory access from complex-centered surfaces

Checks:

- open theory modal from `Complexes`
- modal renders theory content
- modal can jump to `Complexes?theory_id=...`
- modal can jump to `Theory Hub`
- `Complex Builder` shows theory context actions for linked/inherited theory

#### 8. Statistics Smoke

Purpose:

- ensure analytics page still works and exposes actionability

Checks:

- `Statistics` loads without fatal empty shell
- primary insight blocks render
- `Theory Flow` block renders when linked data exists
- links to `Complexes` / `Theory Hub` are clickable

### P1: Strongly Recommended Right After P0

#### 9. Calendar Daily Mix / Recommended Action

Purpose:

- protect scheduling surface as a live user entry point

Checks:

- `Calendar` loads
- recommendation/explainability block renders
- `Daily Mix` or equivalent recommended action starts session correctly

#### 10. Microcards Basic Review

Purpose:

- protect second daily practice loop

Checks:

- `Microcards` page loads
- deck/review surface renders
- basic review action starts and progresses

#### 11. Settings / Theme Persistence Smoke

Purpose:

- protect release-visible UX integrity

Checks:

- `Settings` loads
- changing theme or UI preference persists after refresh/navigation

### P2: Post-Release Structural Layer

These are useful, but should not block the current release batch:

- import flow browser smoke
- complex creation full browser e2e
- multi-iteration session behavior in browser
- heavy AI-assisted editor flows
- large matrix of task subtype/browser interactions

## Recommended Data Strategy

Browser smoke must not depend on random production-like content.

Preferred strategy:

1. Use a dedicated local smoke profile / smoke user.
2. Seed a minimal deterministic dataset:
   - one runnable complex
   - one theory-linked complex
   - one theory with topic linkage
   - one calendar-recommended item
   - one microcards-ready item
3. Keep smoke fixtures small and explicit.

If a scenario requires too much setup, it should be downgraded or split.

## Execution Principles

Each smoke scenario should:

- stay under roughly `20-60s`
- verify only critical visible outcomes
- avoid brittle selectors tied to cosmetic markup
- prefer IDs, stable `data-role`, stable button texts, stable URLs
- stop on first real breakage with useful error output

Each scenario should answer:

- did the page open?
- did the primary action exist?
- did the action complete?
- did the next screen/context appear?

## Suggested First Batch to Implement

If implementation starts now, the best first batch is:

1. `Welcome -> Main`
2. `Main -> Complexes -> S1`
3. `S3 basic results`
4. `Theory Hub roundtrip`
5. `Statistics theory flow`

Why this batch:

- highest release value
- broadest screen coverage
- least wasted effort on secondary branches
- directly catches ecosystem regressions

## Suggested File Layout

To stay consistent with the current repo style:

- `scripts/browser_smoke_release_core.js`
- `scripts/browser_smoke_theory_roundtrip.js`
- `scripts/browser_smoke_statistics.js`
- optional runner: `scripts/run_browser_smoke_release.js`

And then npm scripts such as:

```json
"smoke:browser:release": "node scripts/run_browser_smoke_release.js"
```

## Release Decision Rule

Before release, the browser smoke suite should be used as a hard gate only for P0 scenarios.

Interpretation:

- `all P0 pass` -> release-safe from browser-flow perspective
- `one P0 fails` -> release is not flow-safe
- `P1 fails` -> release may proceed only by explicit decision, with known risk logged

## Final Recommendation

Do **not** start with “full e2e coverage of the whole product”.

Do this instead:

- build one small release smoke layer
- keep it deterministic
- keep it centered on real flows
- use it as the final integration guard above the existing test pyramid

That is the right level of investment for the current release stage.
