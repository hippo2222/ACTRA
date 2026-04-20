# Hosted Launch Contract Gate

Дата обновления: `2026-04-19`

Этот gate фиксирует кодовый `launch contract` для hosted-окружения до отдельного production-like Docker/domain/SMTP acceptance run.

## Команда

```bash
npm run smoke:launch-contract:hosted
```

## Что проверяет gate

- `/api/ready` экспортирует отдельный `launch_contract`, а не заставляет собирать production baseline по разрозненным полям;
- hosted launch baseline больше не считает storage ready только по `storage_mode == "postgres"`: реальный `hosted_split` runtime тоже считается hosted storage mode;
- для launch-контракта явно проверяются:
  - `ACTRA_RUNTIME_MODE=hosted_web`;
  - hosted storage mode;
  - hosted persistence contract ready;
  - стабильный `ACTRA_SECRET_KEY` без placeholder `change-me-before-production`;
  - `ACTRA_AUTH_PUBLIC_BASE_URL`;
  - `ACTRA_AUTH_EMAIL_ENABLED` + `ACTRA_AUTH_SMTP_*` baseline;
  - secure session cookie;
  - выключенные `ACTRA_HOSTED_DEV_AUTH_BRIDGE` и `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK`.

## Что gate пока не заменяет

- реальный `docker-compose.hosted.yml` прогон;
- reverse proxy / HTTPS termination;
- production SMTP delivery;
- backup / restore operational drill.

Для этого соседним production-like acceptance run остаётся:

```bash
npm run smoke:launch-acceptance:hosted
```

Внутри этого acceptance run companion contour для passage остаётся:

```bash
npm run smoke:complex-passage:hosted:infra
```

## Expected Result

- `pytest` зелёный;
- `/api/ready` содержит `launch_contract.status`, `launch_contract.runtime_ready`, `launch_contract.runtime_signals` и `launch_contract.degraded_signals`;
- `hosted_infra_launch` в `finish_line.subsystems` использует тот же launch baseline и перестаёт врать о hosted storage mode.
