# Auth + Email Lifecycle Hosted Gate

Дата обновления: `2026-06-25`

Этот документ фиксирует официальный strict hosted gate для surface `auth + email lifecycle`.

## Команда

```bash
npm run smoke:auth:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` проходит без failed/error;
- набор подтверждает hosted-contract для полного auth/email flow, а не legacy dev-bridge behaviour.

## Состав Gate

- `tests/test_hosted_auth_http.py`
- `tests/welcome_hosted_auth.test.mjs`
- `tests/test_hosted_user_service_shadow_auth.py`

## Что именно подтверждает gate

- `POST /api/auth/register` создаёт hosted user через `HostedUserService`, возвращает verification email payload;
- `GET|POST /api/auth/verify-email` потребляет email token через `HostedIdentityRepository`;
- `POST /api/auth/login` верифицирует bcrypt hash через `HostedUserService`, создаёт request-scoped auth session;
- `GET /api/auth/me` возвращает hosted user identity из session;
- `POST /api/auth/logout` корректно завершает hosted auth session;
- `POST /api/auth/forgot-password` отправляет reset token через email flow без fallback на feedback sender;
- `POST /api/auth/reset-password` потребляет reset token и обновляет bcrypt hash;
- `POST /api/users/update` — staged email change через pending email + verification flow;
- anti-enumeration и rate limiting покрыты в каждом ветке;
- `ACTRA_HOSTED_DEV_AUTH_BRIDGE=0` — dev-мост выключен, auth идёт через hosted user service;
- auth mailer читает только `ACTRA_AUTH_SMTP_*`, без fallback на `ACTRA_FEEDBACK_SMTP_*`.

## Что не входит в этот gate

- browser-level UX smoke для Welcome page (это задача `smoke:release:gate` или ручного QA);
- production SMTP proof с реальным inbox (это задача `hosted_launch_ops_checklist.md` → раздел «Real SMTP Proof»);
- Google OAuth flow (требует live OAuth callback, не может быть автоматизирован без браузера и внешнего Google endpoint);
- reverse proxy / HTTPS termination;
- backup/restore drill.

## Текущий статус

С `2026-06-25` этот gate считается официальным strict hosted gate для surface `auth + email lifecycle`.

Прогон охватывает полный auth/email lifecycle через HTTP-level test client с fake SMTP, без реального внешнего SMTP-провайдера.

На текущий момент это означает:

- у `auth + email lifecycle` есть один канонический запуск для release-check;
- release-ready hosted auth truth проверяется повторяемо одной командой;
- сам surface всё ещё остаётся `transitional` по finish-line матрице, пока не закрыт production SMTP + public domain proof из `hosted_launch_ops_checklist.md`.

## Путь до `green`

Для перевода `auth + email lifecycle` из `transitional` в `green` нужно дополнительно:

1. Прогнать `register → (реальный Brevo SMTP) → inbox → verify link → login` на публичном домене `https://actra.site`.
2. Зафиксировать дату и результат как «production smoke» в `hosted_launch_ops_checklist.md`.
3. Обновить `hosted_finish_line_matrix.md` — строка `auth + email lifecycle`.
