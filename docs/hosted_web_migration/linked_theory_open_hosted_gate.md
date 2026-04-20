# Linked Theory / Open Flows Hosted Gate

Date: `2026-04-19`

This document fixes one canonical strict hosted gate for the consumer contour around linked theory open flows.

## Official Command

```bash
npm run smoke:linked-theory-open:hosted
```

Expected result:

- all `pytest` checks pass;
- all `vitest` checks pass;
- hosted linked-theory open semantics stay strict and do not silently downgrade into workspace truth.

## What This Gate Proves

- linked complex runtime resolves attached theory through the current user's theory-library binding when that binding exists;
- hosted linked-library snapshots no longer fall back to workspace theory when the linked publication is unresolved, blocked, or missing hosted enrichment;
- embedded theory snapshot can stay primary only for embedded-only linked publications that do not have a separate `catalog_item_id` binding;
- theory center linked visibility semantics stay aligned with hosted linked-library access behavior.

## Included Coverage

Backend:

- `tests/test_session_api_linked_complex.py`
- `tests/test_theory_center_visibility.py`
- `tests/test_complexes_theory_link_fallback.py`

Frontend:

- `tests/complexes_linked_theory_resolution.test.mjs`
- `tests/theory_center_regressions.test.mjs`

## Main Evidence In Code

- `desktop-app/routes/_helpers.py`
- `desktop-app/api/session_api.py`
- `desktop-app/routes/theory_center_routes.py`
- `frontend/Complexes/index.html`

## Boundaries

This gate is intentionally narrower than a full browser acceptance run for all `Complexes` consumer UX.

It does not replace:

- broader browser smoke around full `Complexes` page layout and interaction details;
- production-like infra validation with real Postgres/S3/domain/auth stack;
- access-code dialog/browser interaction smoke outside the linked-theory source-of-truth contract.
