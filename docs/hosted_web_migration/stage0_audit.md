# Stage 0 Audit

Дата фиксации: `2026-04-07`

Этот документ фиксирует фактические блокеры и stop-the-bleed действия для `Stage 0`. Он не описывает весь migration plan заново, а только текущее security/runtime состояние репозитория.

## Что проверено

- runtime config и path resolution;
- глобальный application context и user switching;
- локальное хранение секретов;
- desktop/update coupling внутри server runtime;
- текущий env contract, который уже существует в коде.

## Главные блокеры hosted web

### 1. Секреты хранились в repo runtime-данных

Факт:
- `data/ai_config.json` содержал реальные-looking provider keys для OpenRouter, Gemini и Groq;
- `desktop-app/services/ai_generation_service.py` напрямую читает этот файл как источник глобальной AI-конфигурации.

Риск:
- ключи считаются скомпрометированными;
- hosted web нельзя строить на секретах из файловой структуры `data/`.

Что сделано в Stage 0:
- реальные значения удалены из `data/ai_config.json`;
- внешние провайдеры в этом файле переведены в disabled/empty-key состояние;
- `mock` оставлен как безопасный fallback без production secrets;
- AI-конфиг теперь принимает env overrides, даже если `ai_config.json` пустой или отсутствует;
- при чтении file-based ключей сервис пишет warning, что для hosted режима они недопустимы как источник истины.

Что остаётся обязательным после этого:
- перевыпустить ранее использованные ключи вне репозитория;
- перевести production AI secrets на env/secret manager;
- не возвращать реальные ключи в tracked runtime-файлы.

### 2. Сервер всё ещё держит process-wide current user

Факт:
- `desktop-app/server.py` хранит mutable `AppContextHeadless.user_id`;
- тот же объект пробрасывается глобально через `desktop-app/routes/_context.py`;
- переключение пользователя происходит методом `switch_user()` и меняет состояние сервисов внутри всего процесса;
- `desktop-app/routes/users_routes.py` использует `ctx.switch_user(user_id)`.

Риск:
- модель небезопасна для публичного web и параллельных браузерных сессий;
- один запрос может менять активного пользователя для всего backend-процесса.

Статус Stage 0:
- проблема подтверждена и зафиксирована;
- исправление отложено на `Stage 2`, потому что это уже auth/context refactor.

### 3. Identity и startup flow завязаны на локальный app state

Факт:
- `desktop-app/services/user_service.py` хранит `last_user_id` в `data/app_state.json`;
- `AppContextHeadless` использует это для определения стартового активного пользователя.

Риск:
- hosted runtime не должен восстанавливать identity из локального файла процесса;
- это чисто desktop/local pattern.

Статус Stage 0:
- зафиксировано как legacy dependency;
- удаление из web-auth flow остаётся задачей `Stage 2`.

### 4. Runtime и hosted concerns смешаны с desktop/update behavior

Факт:
- `config.json` содержит `update_manifest_url`;
- `desktop-app/server.py` имеет update-manifest logic и feedback email logic в том же runtime;
- серверный entrypoint по умолчанию поднимает приложение на `127.0.0.1` и ориентирован на локальный запуск.

Риск:
- web-runtime смешан с desktop/update сценариями;
- hosted baseline нельзя считать чистым до отделения legacy behavior.

Статус Stage 0:
- подтверждено и включено в список legacy boundaries для дальнейшего отсечения на `Stage 1`.

### 5. Session secret не был стабильно конфигурируемым

Факт:
- Flask secret key генерировался случайно на каждом старте процесса.

Риск:
- в hosted web это рвёт cookie sessions при каждом рестарте и не даёт нормального секретного контура.

Что сделано в Stage 0:
- `desktop-app/server.py` теперь использует `ACTRA_SECRET_KEY`, если он задан;
- если переменная не задана, сервер явно пишет warning и продолжает с ephemeral key только как fallback.

## Current Env Contract

### Уже поддерживается кодом

- `ACTRA_SECRET_KEY` — стабильный secret key для Flask session cookies.
- `ACTRA_AI_TIMEOUT_SECONDS` — timeout AI provider chain.
- `ACTRA_AI_FALLBACK_ORDER` — порядок AI providers через запятую.
- `ACTRA_AI_OPENROUTER_ENABLED`
- `ACTRA_AI_OPENROUTER_API_KEY`
- `ACTRA_AI_OPENROUTER_MODEL`
- `ACTRA_AI_OPENROUTER_FALLBACK_MODELS`
- `ACTRA_AI_GEMINI_ENABLED`
- `ACTRA_AI_GEMINI_API_KEY`
- `ACTRA_AI_GEMINI_MODEL`
- `ACTRA_AI_GROQ_ENABLED`
- `ACTRA_AI_GROQ_API_KEY`
- `ACTRA_AI_GROQ_MODEL`
- `ACTRA_AI_MOCK_ENABLED`
- `ACTRA_AI_MOCK_API_KEY`
- `ACTRA_AI_MOCK_MODEL`
- `TRAINER_DATA_ROOT` — override для `data_root`.
- `TRAINER_TASK_SYSTEM_ROOT` — override для `task_system_root`.
- `TRAINER_HTTP_PORT` — порт Flask runtime.
- `FLASK_DEBUG` — debug mode toggle.
- `ACTRA_UPDATE_MANIFEST_URL` — override update manifest URL.
- `ACTRA_FEEDBACK_EMAIL_ENABLED`
- `ACTRA_FEEDBACK_EMAIL_TO`
- `ACTRA_FEEDBACK_SMTP_HOST`
- `ACTRA_FEEDBACK_SMTP_PORT`
- `ACTRA_FEEDBACK_SMTP_USER`
- `ACTRA_FEEDBACK_SMTP_FROM`
- `ACTRA_FEEDBACK_SMTP_PASSWORD`
- `ACTRA_FEEDBACK_SMTP_USE_TLS`
- `ACTRA_FEEDBACK_SMTP_USE_SSL`
- `ACTRA_FEEDBACK_SMTP_TIMEOUT_SEC`

### Ещё не поддерживается, но обязательно понадобится позже

- Postgres connection envs для hosted persistence.
- Object storage envs для assets и bundle-артефактов.
- Hosted auth/session config поверх request-scoped user model.

## Legacy Boundaries, зафиксированные на Stage 0

Для web-only ветки legacy считаются:
- `app_state.json` как источник identity;
- process-wide `switch_user`;
- локальные profile-selection flows;
- desktop/update coupling внутри runtime;
- filesystem-first secret/config storage для hosted deployment.

## Что входит в Stage 0 дальше

- завершить inventory env/runtime точек, если найдутся дополнительные hard blockers;
- не начинать auth refactor и catalog work до закрытия Stage 0 в `progress.md`.
