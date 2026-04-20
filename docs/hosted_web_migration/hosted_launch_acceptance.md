# Hosted Launch Acceptance

Дата обновления: `2026-04-20`

Этот документ фиксирует production-like acceptance run для launch-layer поверх уже существующего code-level gate `hosted_launch_contract_gate.md`.

## Официальная команда

```bash
npm run smoke:launch-acceptance:hosted
```

## Что делает acceptance run

- валидирует launch env contract до старта Docker stack:
  - стабильный `ACTRA_SECRET_KEY`;
  - включённый `ACTRA_AUTH_EMAIL_ENABLED`;
  - настроенные `ACTRA_AUTH_PUBLIC_BASE_URL` и `ACTRA_AUTH_SMTP_*`;
  - `ACTRA_SESSION_COOKIE_SECURE=1`;
  - выключенные `ACTRA_HOSTED_DEV_AUTH_BRIDGE` и `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK`;
- прогоняет companion contour `npm run smoke:complex-passage:hosted:infra`;
- поднимает `docker-compose.hosted.yml`;
- ждёт `hosted_web` readiness через `/api/health` и `/api/ready`;
- проверяет, что `/api/ready.launch_contract` уже `green` на живом compose stack;
- выполняет live hosted auth lifecycle:
  - `/ui/main` redirect до логина;
  - `register`;
  - `verify email` через `verify_url`;
  - `me`;
  - `logout`;
  - `login`;
  - `forgot-password` request;
  - `/ui/main` render после логина.

Для локального прогона без боевого SMTP stack теперь по умолчанию использует встроенный `Mailpit` sink:

- `ACTRA_AUTH_SMTP_HOST=mailpit`
- `ACTRA_AUTH_SMTP_PORT=1025`
- `ACTRA_AUTH_SMTP_FROM=noreply@localhost.test`
- `ACTRA_AUTH_SMTP_USE_TLS=0`
- web UI sink по умолчанию доступен на `http://localhost:8025`

Во внутренних audit/docker-compose runtime'ах `Mailpit` host port может назначаться динамически, чтобы параллельные hosted stack'и не конфликтовали друг с другом. Это не меняет launch acceptance contract: SMTP sink остаётся `mailpit:1025` внутри compose-сети.

Эти значения подходят только для локального acceptance run и не считаются финальным production proof.

## Recorded Result

Локальный recorded run от `2026-04-20` завершился зелёно:

- `npm run smoke:launch-acceptance:hosted` прошёл end-to-end на Docker stack;
- companion contour `npm run smoke:complex-passage:hosted:infra` тоже прошёл рядом с recorded result `60 passed`;
- `/api/ready.launch_contract` стал `green` на живом compose stack;
- hosted auth lifecycle (`register -> verify -> me -> logout -> login -> forgot-password request -> /ui/main`) прошёл полностью;
- локальные `localhost` + `Mailpit` warnings при этом остались ожидаемой частью local proof, а не failure signal.

## Что acceptance run пока не заменяет

- ручное подтверждение доставки писем в реальный inbox и перехода по письму reset-password;
- финальный публичный domain/proxy/HTTPS proof;
- backup / restore operational drill;
- широкий author/consumer browser smoke вокруг publish/add/open/editor save-open.

## Полезные флаги

```bash
node scripts/run_hosted_launch_acceptance.js --dry-run
node scripts/run_hosted_launch_acceptance.js --keep-stack
node scripts/run_hosted_launch_acceptance.js --skip-companion-passage
```

`--dry-run` нужен для проверки env-contract и шагов без Docker.

## Expected Result

- команда завершается зелёно;
- `launch_contract.status == "green"` на живом hosted stack;
- hosted auth lifecycle проходит без dev bridge;
- companion infra contour для `complex passage` проходит рядом как часть того же launch acceptance story.
