# Calendar + Schedule + Memory Health Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `calendar + schedule + memory health`.

## Strict Hosted Gate

```bash
npm run smoke:calendar:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted source of truth для calendar/settings/progress/activity reads and writes, а не legacy file-backed поведение.

## Состав Gate

- `tests/test_calendar_service.py`
- `tests/test_calendar_schedule_block.py`
- `tests/test_calendar_hosted_gate.py`

## Что именно подтверждает strict gate

- hosted `CalendarService` не читает `settings.json`, `progress.json`, `activity.json` и другие calendar-docs как нормальный hosted source of truth;
- hosted `CalendarService` не делает silent shadow-write в calendar JSON после успешной repository-backed записи;
- публичные hosted routes `/api/calendar/today`, `/api/calendar/schedule`, `/api/calendar/health`, `/api/calendar/activity` и `/api/calendar/settings` работают через `HostedCalendarRepository`-style contract;
- blocked hosted reads по calendar storage превращаются в явный degraded payload `503 hosted_shadow_read_blocked`, а не в generic `500` или тихий shadow-read;
- schedule/activity/health route-level contract закреплён поверх существующих service-level regressions.

## Что не входит в этот gate

- широкий browser/product smoke вокруг полного календарного UI;
- production-like infra verification с реальным Postgres/S3 stack;
- соседние contours `statistics + progress`, `main + quick access` и launch-layer beyond the calendar contract.

## Текущий статус

С `2026-04-19` `npm run smoke:calendar:hosted` считается официальным strict hosted gate
для surface `calendar + schedule + memory health`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:calendar:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `calendar + schedule + memory health` есть один канонический запуск для release-check;
- hosted truth по `today`, `schedule`, `health`, `activity` и `settings` проверяется повторяемо одной командой;
- legacy calendar JSON остаются только в `legacy_local` runtime и больше не держат этот contour в `transitional`.
