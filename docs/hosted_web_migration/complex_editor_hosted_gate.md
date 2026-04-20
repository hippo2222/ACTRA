# Complex Editor Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `complex editor CRUD`.

## Strict Hosted Gate

```bash
npm run smoke:complex-editor:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` и `vitest` проходят без failed/error;
- набор подтверждает hosted truth для `complex editor`, а не filesystem-first fallback behavior.

## Состав Gate

- `tests/test_hosted_complex_service.py`
- `tests/test_complex_editor_hosted_gate.py`
- `tests/complex_autosave_manager.test.mjs`

## Что именно подтверждает strict gate

- hosted `complexes` read-path (`list/open`) больше не bootstrap'ится из shadow `complexes.json` и не скрывает blocked hosted read за generic `500`;
- hosted complex write-path больше не делает silent shadow-write в `complexes.json` после успешной hosted persistence;
- hosted `autosave/history/restore` теперь живут в explicit hosted persistence contract и не используют filesystem history как product truth;
- editor flow проходит через `create -> open -> update -> sync-theory-from-topics -> autosave -> history -> restore -> publish -> delete`;
- ownership visibility входит в proof: чужой complex не появляется в editable current-user surface;
- blocked hosted read/write behavior по `complex editor` route'ам возвращает canonical degraded `503 hosted_shadow_*_blocked`;
- frontend autosave manager остается зелёным как editor-side contract для draft UX поверх hosted contour.

## Что не входит в этот gate

- соседний contour `import/export`, который закреплён отдельным hosted gate;
- широкий browser/product smoke вокруг полного `Complexes/create.html` UX;
- contour `theory editor + theory center`, который требует отдельного strict hosted gate.

## Текущий статус

С `2026-04-19` `npm run smoke:complex-editor:hosted` считается официальным strict hosted gate
для surface `complex editor CRUD`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:complex-editor:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `complex editor CRUD` есть один канонический запуск для release-check;
- hosted truth по `create/save/reopen/autosave/history/restore/publish/delete` и degraded behavior проверяется повторяемо одной командой;
- `complex editor CRUD` больше не держится в `transitional` из-за shadow bootstrap, silent shadow write или file-backed autosave/history.
