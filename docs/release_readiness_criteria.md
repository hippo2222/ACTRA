# Release Readiness Criteria

This document defines minimum criteria for shipping a production release.

## Non-Demo Content Gate

Release catalog validation for build must pass with `--require-non-demo`.

Current enforced minimums:

- `modules >= 2`
- `topics >= 2`
- `tasks >= 6`
- `complexes >= 2`
- `theories >= 2`

Command:

```bash
python scripts/validate_release_catalog.py --data-dir data --require-non-demo
```

`scripts/build_release.py` runs this check before packaging and fails fast if any criterion is not met.

## Coverage Gate

Backend tests must meet the release coverage threshold:

- `coverage >= 10%` (enforced by `pytest --cov-fail-under=10` in `pyproject.toml`)

This threshold is intentionally conservative and should be raised in future releases.

## Frontend Lint Gate

Frontend lint must pass in CI:

```bash
npm run lint:frontend
```

The lint command performs JavaScript syntax validation across frontend/tooling scripts.

## Backend Quality Baseline

The backend quality baseline must pass in CI:

```bash
black --check .
mypy .
flake8 .
```

These commands are intentionally scoped in tool configuration to release/runtime-critical Python paths.
This keeps the gate green while the wider legacy/test codebase is migrated in phases.

## Mojibake Guard

Critical user-facing screens must pass mojibake detection:

```bash
python scripts/check_mojibake.py
```

Default guarded files:

- `frontend/MainScreen/Main.html`
- `frontend/Welcome/welcome.html`
- `frontend/S3/index.html`
- `desktop-app/webview_launcher.py`
