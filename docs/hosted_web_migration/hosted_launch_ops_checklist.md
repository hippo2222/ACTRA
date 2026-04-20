# Hosted Launch Ops Checklist

Дата обновления: `2026-04-20`

Этот документ фиксирует оставшийся операционный хвост после локально-зелёных:

- `npm run smoke:complex-passage:hosted:infra`
- `npm run smoke:launch-acceptance:hosted`

Его цель: перевести `hosted infra + production launch` из `transitional` в `green` уже не кодом, а финальным public-env proof.

## Что уже считается подтверждённым

- Docker-based hosted stack поднимается через `docker-compose.hosted.yml`.
- `/api/ready.launch_contract` становится `green` на живом stack.
- Hosted auth lifecycle проходит end-to-end локально.
- `complex passage` infra contour проходит на strict hosted stack.
- Локальный SMTP sink через `Mailpit` покрывает acceptance без внешней почты.

## Что ещё обязательно закрыть

### 1. Public Domain + HTTPS

- Задать финальный публичный base URL в `ACTRA_AUTH_PUBLIC_BASE_URL`.
- Поднять reverse proxy перед приложением.
- Включить и проверить HTTPS termination.
- Убедиться, что cookies работают с production domain и `Secure`/`SameSite` настройками.
- Проверить, что `Welcome`, `verify email`, `reset password` и возвраты после логина используют именно публичный домен, а не `localhost`.

Expected result:
- все auth links и browser redirects ведут на публичный HTTPS-домен;
- cookies/session поведение не ломается между `Welcome` и основным web UI.

### 2. Real SMTP Proof

- Подставить реальные production `ACTRA_AUTH_SMTP_*` секреты вместо `Mailpit`.
- Зафиксировать production sender/from address.
- Прогнать `register -> verify email -> login -> forgot-password`.
- Подтвердить получение писем в реальный inbox, а не только наличие `verify_url` в test sink.
- Отдельно проверить, что auth mailer не fallback'ится на feedback sender.

Expected result:
- письма регистрации/подтверждения/reset реально доставляются;
- ссылки из писем открывают публичный HTTPS-hosted flow;
- sender/from и SMTP path соответствуют целевому launch-контуру.

### 3. Public-Env Acceptance Run

- Повторно прогнать:
  - `npm run smoke:launch-contract:hosted`
  - `npm run smoke:launch-acceptance:hosted`
- Если для production-like окружения нужен отдельный env-file или секретный набор переменных, зафиксировать это как официальный launch способ.
- Сохранить один recorded run с датой, окружением и результатом.

Expected result:
- оба launch-gate проходят не только локально, но и на публично-похожем окружении;
- remaining blocker больше не формулируется как “нужно ещё проверить на реальном env”.

### 4. Backup + Restore Baseline

- Зафиксировать, как снимается backup для Postgres.
- Зафиксировать, как снимается backup для S3/MinIO-compatible asset storage.
- Один раз проверить restore на отдельном test stack.
- Убедиться, что после restore поднимаются:
  - auth users/sessions;
  - catalog/library;
  - editor data;
  - assets/media.

Expected result:
- есть не только теоретический backup plan, но и один подтверждённый restore drill;
- launch-layer больше не зависит от непроверенной recovery-гипотезы.

## Минимальный порядок добивки

1. Настроить публичный домен и HTTPS.
2. Подключить реальные `ACTRA_AUTH_SMTP_*`.
3. Повторить `npm run smoke:launch-acceptance:hosted` на этом окружении.
4. Выполнить один backup/restore drill.
5. Обновить `hosted_finish_line_matrix.md`, `current_state.md` и `progress.md`.

## Когда contour можно перевести в `green`

`hosted infra + production launch` можно считать `green`, когда одновременно выполнены все условия:

- есть recorded public-env run для `npm run smoke:launch-acceptance:hosted`;
- auth email lifecycle подтверждён через реальный SMTP и публичный домен;
- reverse proxy / HTTPS proof завершён;
- backup / restore baseline подтверждён практическим drill;
- в remaining launch-tail не остаётся обязательных release-blocking неизвестных.
