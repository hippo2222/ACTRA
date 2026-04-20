# AI Placeholder Hosted Gate

Дата обновления: `2026-04-19`

Этот gate фиксирует не "живой AI", а честный launch-контракт для текущего scope:

- public hosted AI routes не остаются partially-live по умолчанию;
- editor AI entrypoint показывает один явный placeholder `Функционал в разработке`;
- AI-driven `microcards from-analysis` paths follow the same placeholder contract.

## Official Command

```bash
npm run smoke:ai-placeholder:hosted
```

## Expected Result

- `pytest` passes for explicit backend placeholder contract checks;
- `vitest` passes for the editor modal placeholder regression;
- direct AI routes return `404 ai_mode_in_progress` with attached feature flags when `ai_mode` is disabled;
- the editor modal does not issue live AI fetches while the placeholder state is active.

## Coverage

- `desktop-app/tests/integration/test_ai_placeholder_contract.py`
- `desktop-app/tests/integration/test_server_smoke.py`
- `tests/import_manager_ai_placeholder.test.mjs`

## Notes

- This gate intentionally does not prove a real AI rollout.
- Reopening AI as a product contour requires a new scope decision, a new hosted source-of-truth contract, and a different gate.
