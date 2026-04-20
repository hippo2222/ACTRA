# Task Editor Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `task editor CRUD`.

## Strict Hosted Gate

```bash
npm run smoke:task-editor:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` и `vitest` проходят без failed/error;
- набор подтверждает hosted CRUD truth для `task editor`, а не legacy-local fallback behavior.

## Состав Gate

- `tests/test_task_editor_hosted_gate.py`
- `tests/editor_test_contract_audit.test.mjs`

## Что именно подтверждает strict gate

- hosted `editor catalog` и `GET /api/editor/task/...` возвращают canonical degraded `503 hosted_shadow_read_blocked`, а не generic `500`, когда hosted read-path заблокирован;
- hosted `bootstrap`, `save`, `delete` и соседние write-paths возвращают explicit degraded `503 hosted_shadow_write_blocked`, а не silent fallback;
- editor create-flow проходит через `module -> topic -> draft bootstrap -> save -> reopen -> catalog -> delete`;
- hosted catalog/load route respects ownership visibility and does not expose foreign-owned workspace tasks as editable current-user entities;
- frontend contract audit для `TestEditor` остаётся зелёным и подтверждает draft/hydration/destructive-flow invariants на editor surface.

## Что не входит в этот gate

- contour `import/export`, который закреплён отдельным hosted gate;
- browser-level release smoke вокруг полного editor UX;
- contours `complex editor` и `theory editor`, которые требуют отдельных strict hosted gates.

## Текущий статус

С `2026-04-19` `npm run smoke:task-editor:hosted` считается официальным strict hosted gate
для surface `task editor CRUD`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:task-editor:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `task editor CRUD` есть один канонический запуск для release-check;
- hosted truth по `create/save/reload/reopen/delete` и degraded behavior проверяется повторяемо одной командой;
- `import/export` остаётся соседним отдельным contour и больше не держит `task editor CRUD` в `transitional`.
