# Microcards Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для hosted-контура `microcards`.

## Strict Hosted Gate

```bash
npm run smoke:microcards:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted source of truth для deck documents, review/session state и analytics, а не legacy filesystem behavior.

## Состав Gate

- `tests/test_microcards_hosted_route_contracts.py`
- `tests/test_hosted_microcards_service.py`
- `tests/test_hosted_microcards_analytics_service.py`

## Что именно подтверждает strict gate

- hosted `summary` использует `HostedMicrocardsAnalyticsService` и Postgres-backed review/event documents;
- hosted deck library, manual create/open и text import работают через `HostedMicrocardsService` и `HostedMicrocardsRepository`;
- hosted `queue` и `review submit` используют hosted review/session state вместо file-backed runtime;
- blocked hosted read/write превращаются в явный degraded payload, а не в silent fallback;
- hosted analytics агрегируют queue/dynamics по deck + review truth, а не по локальным JSON;
- empty hosted storage больше не bootstrap'ится из shadow deck/review files на критическом пути.

## Что не входит в этот gate

- AI-driven deck generation surfaces;
- production-like infra verification с реальным Postgres/S3 stack.

## Текущий статус

С `2026-04-19` `npm run smoke:microcards:hosted` считается официальным strict hosted gate
для surface `microcards`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:microcards:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `microcards` есть один канонический запуск для release-check;
- hosted truth по `create/open/review/summary` проверяется повторяемо одной командой;
- AI-driven deck generation остаётся отдельным AI surface и не входит в current hosted microcards finish-line;
- browser/product smoke и production-like infra остаются соседним launch-layer вопросом и не меняют hosted source of truth для core microcards contour.
