# Import/Export Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует один явный automated gate для hosted-контура `import/export`.

## Команда

```bash
npm run smoke:import-export:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted-contract, а не legacy fallback behavior.

## Состав Gate

- `tests/test_import_export_route_contracts.py`
- `tests/test_import_export_service.py`
- `tests/test_complex_import_export_service.py`

## Что именно подтверждает gate

- public text `export` использует hosted-backed `load_task`;
- public text `import execute` использует hosted-backed `save_task`;
- public task archive `export` идёт через hosted payload export;
- public task archive `confirm` идёт через hosted-backed transaction и стримит canonical result/degraded;
- public complex archive `export` идёт через hosted-backed complex/task/theory payload export;
- public complex archive `confirm` идёт через hosted-backed rollback actions вместо full filesystem backup/restore;
- blocked shadow read/write в hosted-контуре превращаются в явный degraded payload, а не в silent fallback.

## Что не входит в этот gate

- browser-level editor smoke;
- import/export UX polish;
- production-like infra verification с реальным Postgres/S3 stack;
- cleanup всех compatibility bridges вокруг portable archive paths.

## Текущий статус

С `2026-04-19` этот gate считается официальным strict hosted gate для surface `import/export`.

Локальная верификация этого gate зафиксирована прогоном `npm run smoke:import-export:hosted` от `2026-04-19`.

На текущий момент это означает:

- у `import/export` есть один канонический запуск для release-check;
- release-ready hosted truth проверяется повторяемо одной командой;
- сам surface всё ещё остаётся `transitional`, пока рядом живут compatibility path/package bridges и не закрыт более широкий product smoke.
