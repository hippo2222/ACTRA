# Topic Theory Sync Rollout Plan (2026-03-05)

## Goal

Build a stable two-way mechanism between:

- topic-level theory (`module -> topic -> theory`)
- complex-level theory context (`complex -> tasks from topics`)

Without breaking existing content, existing complexes, or current training flows.

## Product Rules (Canonical)

1. Canonical source for learning theory is `topic.theory_link`.
2. Complex may keep its own theory context, but with explicit mode:
   - `inherit`: effective theory comes from referenced topics.
   - `override`: complex keeps explicitly selected theory.
3. Task-level theory remains optional (AI grounding / diagnostics only), not mandatory.

## Compatibility Rules (Legacy Safety)

1. Existing complexes with `theory_link` and no `theory_mode` are treated as `override` (legacy-safe).
2. Existing complexes without `theory_link` and no `theory_mode` are treated as `inherit`.
3. No destructive mass rewrite is allowed by default.
4. Any propagation supports `dry_run` first.

## Data Model Additions

### Topic (`topic.json`)

- Add optional field:
  - `theory_link: { theory_id, relation?, title_cache?, updated_at? } | null`

### Complex (`complexes.json` entry)

- Keep existing `theory_link`.
- Add optional fields:
  - `theory_mode: "inherit" | "override"`
  - `theory_sync_status: "ok" | "none" | "conflict"`
  - `theory_sync_meta` (diagnostic metadata, optional)

## API Surface (Backend)

### Topic Theory API

- `GET /api/editor/topic/<module_id>/<topic_id>/theory-link`
  - Returns current topic theory link and computed usage summary.
- `PUT /api/editor/topic/<module_id>/<topic_id>/theory-link`
  - Updates topic theory link.
  - Supports propagation payload:
    - `dry_run: bool`
    - `apply_to_complexes: bool`
    - `propagation_mode: "safe" | "inherit_only_force" | "all_force"`

### Optional Follow-up API

- `POST /api/complexes/<id>/sync-theory-from-topics`
  - Recompute effective theory for one complex only.

## Propagation Semantics (Topic -> Complexes)

For each complex that includes at least one task from changed topic:

1. Collect all referenced topics from complex tasks.
2. Resolve each topic theory.
3. Compute inherited result:
   - no topic theories -> `none`
   - one unique theory -> `ok`
   - multiple theories -> `conflict`
4. Apply by mode:
   - `safe`: update only `inherit` complexes; never override `override`.
   - `inherit_only_force`: same target set as `safe`, but force metadata refresh even if unchanged.
   - `all_force`: can update both modes, but still never auto-pick in `conflict`.

## Conflict Policy

If inherited set contains multiple theory ids:

- do not auto-select one;
- mark `theory_sync_status = "conflict"`;
- keep existing `theory_link` untouched;
- return actionable diagnostics in API response.

## Visual/UX Strategy (AAA-Level Quality Guard)

No broad UI rewrite in this batch. Add only small, theme-safe controls with existing tokens:

1. Topic-level action: "Привязать теорию".
2. Topic-level action: "Применить к связанным комплексам" with preview count.
3. Complex-level badge:
   - `Inherited`
   - `Override`
   - `Conflict`

### Theme & Contrast Requirements

1. Use existing design tokens (`bg-surface-*`, `text-*`, `border-*`, `warning-*`, `info-*`).
2. No hardcoded colors for new controls.
3. Ensure visible focus state in all themes.
4. Ensure status badges meet AA contrast for text and border/background pairs.
5. Reuse `NotificationUI` variants (`success/warning/error/info`) for consistency.

## Test Plan

### Backend

1. Topic theory link set/get round-trip.
2. Invalid theory id validation.
3. Propagation `dry_run` reports correct impacted complexes.
4. `safe` mode does not mutate legacy `override`.
5. Inherited multi-topic conflict is detected and not auto-overwritten.
6. Single-topic inherited complex gets synchronized correctly.

### Regression

1. Existing complex CRUD remains valid.
2. Existing session start/resume unaffected.
3. Existing theory CRUD unaffected.

## Rollout Sequence

1. Backend data + API + tests (this batch).
2. Minimal UI integration in Editor/Complexes (next batch).
3. Visual QA pass across theme presets and contrast checks.
4. Update product audit docs and release readiness snapshot.

## Execution Snapshot (2026-03-05, batch 2)

- Done: single-complex sync endpoint `POST /api/complexes/<id>/sync-theory-from-topics` with `dry_run` and mode controls (`safe`, `inherit_only_force`, `all_force`).
- Done: Complexes UI action for inherit-mode cards (`Синхрониз.`) with consistent voice feedback for `updated/unchanged/override/conflict`.
- Done: Complex Builder payload consistency fix (`theory_mode` now sent explicitly; inherit complexes no longer silently drift to override on save).
- Done: backend integration coverage for new endpoint behavior (`dry_run`, mode guard, `all_force` path).
- Done: automated contrast gate remains green (`scripts/contrast_audit.js` with current config).

## Execution Snapshot (2026-03-05, batch 3)

- Done: Complex Builder adds inherit-sync panel with in-place action `Синхронизировать из тем` for edit-mode inherit complexes.
- Done: Builder quality/readiness now treats inherited theory as valid context and flags conflict state from topic-level theory.
- Done: Builder save payload preserves inherited `theory_link` when theory editor is not used, preventing accidental theory context loss.

## Rollback Plan

1. New topic field is optional, so old data remains valid.
2. Propagation is explicit; default behavior is non-destructive.
3. `dry_run` support allows operator verification before writes.
4. In emergency, disable propagation calls in UI while keeping topic theory storage intact.
