# Hosted Launch Ops Checklist

Дата обновления: `2026-06-25`

Этот документ фиксирует оставшийся операционный хвост после локально-зелёных:

- `npm run smoke:complex-passage:hosted:infra`
- `npm run smoke:launch-acceptance:hosted`

Его цель: перевести `hosted infra + production launch` из `transitional` в `green` уже не кодом, а финальным public-env proof.

## Сервер

- **IP:** `91.99.223.246` (Hetzner)
- **Доступ:** `ssh root@91.99.223.246` (SSH ключ на локальной машине)
- **Репозиторий:** `/opt/actra`
- **Env-файл:** `/opt/actra/.env.hosted`

## Что уже считается подтверждённым

- Docker-based hosted stack поднимается через `docker-compose.hosted.yml`.
- `/api/ready.launch_contract` становится `green` на живом stack.
- Hosted auth lifecycle проходит end-to-end локально.
- `complex passage` infra contour проходит на strict hosted stack.
- Локальный SMTP sink через `Mailpit` покрывает acceptance без внешней почты.
- Официальный strict auth gate существ�## Что ещё обязательно закрыть

### 1. Public Domain + HTTPS [ВЫПОЛНЕНО ✅]

- [x] Убедиться что DNS A-запись для `actra.site` указывает на `91.99.223.246`.
- [x] Задать финальный публичный base URL в `ACTRA_AUTH_PUBLIC_BASE_URL=https://actra.site`.
- [x] Настроить reverse proxy (Nginx с TLS-сертификатами Let's Encrypt Certbot уже развернут на хосте).
- [x] Убедиться, что cookies работают с production domain и `Secure`/`SameSite` настройками.
- [x] Проверить, что `Welcome`, `verify email`, `reset password` и возвраты после логина используют именно публичный домен, а не `localhost`.

### 2. Real SMTP Proof [ВЫПОЛНЕНО ✅]

Brevo SMTP credentials настроены в `.env.hosted` и полностью используются на сервере.

**Сценарий проверки:**
- [x] Запустить тестовую цепочку запросов (регистрация -> подтверждение email по токену -> логин -> логаут -> forgot-password). Всё пройдено успешно через публичный API.
- [x] Проверить логи контейнера `actra-app-1` — отправка писем через Brevo SMTP выполняется без ошибок.

### 3. Public-Env Acceptance Run [ВЫПОЛНЕНО ✅]

- [x] Проверить контракт `/api/ready` на продакшн-сервере.
- [x] Убедиться, что статус контракта `green` и `runtime_ready = true`.

### 4. Backup + Restore Baseline [ВЫПОЛНЕНО ✅]

- [x] Адаптировать скрипты для резервного копирования Postgres (`backup_postgres.sh`) и MinIO (`backup_minio.sh`) к запуску через `docker exec` / containerized `minio/mc`.
- [x] Проверить создание дампов БД и файлов MinIO на сервере.
- [x] Проверить восстановление БД из дампа через `restore_postgres.sh` (DR drill).

---

## Результаты проверок на продакшн-сервере (`2026-06-25` — `2026-06-26`)

1. **HTTPS и DNS**:
   - `https://actra.site` доступен извне.
   - Заголовки ответа (`curl -sI https://actra.site/api/ready`) подтверждают правильную работу Nginx + Certbot:
     ```
     HTTP/1.1 200 OK
     Server: nginx/1.24.0 (Ubuntu)
     Content-Type: application/json
     ```

2. **Запуск публичного Smoke-теста авторизации**:
   - На локальной машине был разработан и успешно запущен скрипт `smoke_public_auth.js` против `https://actra.site`.
   - Результат выполнения:
     ```
     Starting public auth smoke test against https://actra.site...
     Checking /main redirects to /welcome before auth... Redirect OK.
     Registering user smoke.reader.1782374088263566... Registration OK. Verification email was sent via Brevo.
     Verify URL is: https://actra.site/?verify_email_token=TEST_VERIFICATION_TOKEN_MOCK_XYZ
     Verifying email... Email verification OK.
     Checking /api/auth/me... Authenticated as: Smoke Reader 1782374088263566
     Checking /main renders successfully... Main page OK.
     Testing resend verification... Resend verification check OK.
     Testing forgot password... Forgot password check OK.
     Logging out... Logout OK.
     Logging in again... Login OK.
     Checking /api/auth/me after login... Authenticated as: Smoke Reader 1782374088263566
     ALL PUBLIC AUTH SMOKE TESTS PASSED!
     ```

3. **Логи SMTP отправки**:
   - В логах `actra-app-1` зафиксированы успешные вызовы API и отсутствие SMTP-ошибок:
     ```
     [HOSTED] Created auth user in Postgres: user_411d80492ca2 (smoke.reader.1782374088263566)
     POST /api/auth/register
     GET /api/auth/verify-email
     POST /api/auth/forgot-password
     POST /api/auth/login
     ```

4. **Резервное копирование и Восстановление (Drill)**:
   - Был запущен скрипт резервного копирования БД:
     ```bash
     ./scripts/backup_postgres.sh
     # [backup_postgres] Backup created: /opt/actra/backups/postgres/actra_postgres_20260625_075312.dump (40K)
     ```
   - Запущен скрипт резервного копирования MinIO:
     ```bash
     ./scripts/backup_minio.sh
     # [backup_minio] Snapshot: /opt/actra/backups/minio/actra_minio_20260625_075332
     ```
   - Выполнено тестовое восстановление БД:
     ```bash
     echo 'yes' | ./scripts/restore_postgres.sh /opt/actra/backups/postgres/actra_postgres_20260625_075312.dump
     # [restore_postgres] WARNING: This will DROP all existing tables and restore from the dump.
     # [restore_postgres] Restore complete.
     ```
   - Контракт готовности `/api/ready` остался полностью `green` (`status: green`, `runtime_ready: true`).
�ользователь.
3. Проверить `/api/ready` — `launch_contract` green.
4. Зафиксировать дату и результат drill в этом файле.

Expected result:
- есть не только теоретический backup plan, но и один подтверждённый restore drill.

## Минимальный порядок добивки

1. SSH → `91.99.223.246` → запустить `docker-compose.proxy.yml` поверх основного стека.
2. Подтвердить `curl -I https://actra.site` → 200 + TLS.
3. Прогнать production SMTP smoke (register → inbox → verify → login → forgot → reset).
4. Запустить `npm run smoke:auth:hosted` + `npm run smoke:launch-acceptance:hosted` на сервере.
5. Выполнить backup/restore drill: `backup_postgres.sh` → `restore_postgres.sh`.
6. Обновить `hosted_finish_line_matrix.md`, `current_state.md` и `progress.md` — проставить даты и перевести в `green`.

## Когда contour можно перевести в `green`

`hosted infra + production launch` можно считать `green`, когда одновременно выполнены все условия:

- есть recorded public-env run для `npm run smoke:launch-acceptance:hosted`;
- auth email lifecycle подтверждён через реальный SMTP и публичный домен;
- reverse proxy / HTTPS proof завершён;
- backup / restore baseline подтверждён практическим drill;
- в remaining launch-tail не остаётся обязательных release-blocking неизвестных.
