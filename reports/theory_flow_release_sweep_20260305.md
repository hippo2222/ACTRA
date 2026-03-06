# Theory Flow Release Sweep - 2026-03-05

## Scope

Final code-oriented release sweep for the theory-centered flow:

`Topic theory -> Theory Hub -> Complexes -> S1 session -> S3 results -> back to Theory Hub`

## Surfaces Checked

- `Editor / topic theory modal`
- `Editor / Theory Hub`
- `Complexes / list`
- `Complexes / builder`
- `S1 / active session`
- `S3 / final results`
- `Statistics / theory flow analytics`

## Release Outcome

- `ready`: theory roundtrip is implemented end-to-end
- `ready`: bulk conflict actions remain available in Theory Hub
- `ready`: bidirectional navigation theory <-> topics <-> complexes is present on primary theory-flow surfaces
- `ready`: runtime screens now expose theory context instead of hiding it completely
- `ready`: result screen can recover theory context from final results even without explicit bridge storage

## Concrete Checks

### Editor

- Topic theory modal exposes direct exits to `Complexes` and `Theory Hub`.
- Theory Hub can:
  - focus theory
  - batch-sync queue items
  - force-resolve selected conflicts
  - start training from selected theory

### Complexes

- Complex list theory modal now links back to `Complexes?theory_id=...` and `Theory Hub`.
- Complex Builder exposes theory-context actions for inherited and explicit theory links.

### Runtime

- `S1` shows theory context banner when session has bridge-context or complex-level theory context.
- `S3` shows return-to-Theory-Hub CTA both for explicit Theory Hub launches and for recoverable complex-linked sessions.

### Analytics

- `Statistics` renders `Theory Flow` insight block from linked complexes/theories.

## Automated Evidence

Executed and passed:

```bash
npx vitest run tests/editor_dashboard_theory_hub.test.mjs tests/editor_dashboard_topic_theory_modal.test.mjs tests/statistics_progress_block.test.mjs tests/s1_main_load_state.test.mjs
```

Result:

- `4 files`
- `19 tests`
- `19 passed`

Additional syntax checks passed:

```bash
node --check frontend/S1/main.js
node --check frontend/Editor/dashboard.js
python -m py_compile desktop-app/api/session_api.py
```

Inline script syntax verified for:

- `frontend/S3/index.html`
- `frontend/Complexes/index.html`
- `frontend/Complexes/create.html`

## Residual Risk

Residual risk is no longer in missing product wiring, but in future regressions from unrelated UI edits.

Current state is acceptable for release within the present theory-flow scope.
