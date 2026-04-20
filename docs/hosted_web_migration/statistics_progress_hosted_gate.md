# Statistics + Progress Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `statistics + progress`.

## Strict Hosted Gate

```bash
npm run smoke:statistics:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted source of truth для progress/statistics reads and writes, а не legacy file-backed behavior.

## Состав Gate

- `tests/test_statistics_service.py`
- `tests/test_user_progress_manager.py`
- `tests/test_statistics_hosted_gate.py`

## Что именно подтверждает strict gate

- hosted `UserProgressManager` не bootstrap'ится из `progress.json`, когда Postgres-backed progress storage пуст или только что инициализирован;
- hosted `UserProgressManager` не делает silent shadow-write в `progress.json` после успешной repository write;
- hosted `StatisticsService` использует `HostedProgressRepository` и `HostedComplexStatisticsRepository` как source of truth;
- hosted `overall` и `time-dynamics` читают progress/calendar truth без скрытого fallback на `progress.json` и `activity.json`;
- blocked hosted reads по progress/calendar storage превращаются в явный degraded payload или `HostedShadowReadFallbackDisabledError`, а не в stale statistics.

## Что не входит в этот gate

- отдельный contour `calendar + schedule + memory health` beyond statistics-driven reads;
- browser/product smoke вокруг full statistics UI;
- production-like infra verification с реальным Postgres/S3 stack.

## Текущий статус

С `2026-04-19` `npm run smoke:statistics:hosted` считается официальным strict hosted gate
для surface `statistics + progress`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:statistics:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `statistics + progress` есть один канонический запуск для release-check;
- hosted truth по `overall`, `time-dynamics` и progress persistence проверяется повторяемо одной командой;
- compatibility file paths остаются только как legacy-local bridge и больше не держат этот contour в `transitional`.
