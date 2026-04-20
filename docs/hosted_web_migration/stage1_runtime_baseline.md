# Stage 1 Runtime Baseline

Дата фиксации: `2026-04-07`

Этот документ фиксирует, что именно было сделано в `Stage 1`, чтобы проект можно было поднимать как hosted web runtime без desktop bootstrap.

## Что добавлено

### 1. Hosted entrypoint

Добавлен [hosted_entrypoint.py](D:/Ai Ai/radioproject_git/desktop-app/hosted_entrypoint.py).

Назначение:
- запускать ACTRA как hosted web service;
- не использовать `pywebview` и `webview_launcher.py`;
- по умолчанию выставлять `ACTRA_RUNTIME_MODE=hosted_web`;
- слушать `0.0.0.0`, а не только `127.0.0.1`;
- предпочитать `waitress`, но уметь падать обратно на builtin Flask server для локальной проверки.

Поддерживаемые env:
- `ACTRA_BIND_HOST`
- `TRAINER_HTTP_PORT` или `PORT`
- `ACTRA_HOSTED_USE_WAITRESS`
- `ACTRA_WAITRESS_THREADS`

### 2. Readiness contract

Добавлены readiness endpoints:
- `/api/ready`
- `/ready`

Они проверяют:
- существует ли `data_dir`;
- существует ли `frontend_root`;
- инициализирован ли shared route context;
- подняты ли `storage_service` и `session_api`.

Лёгкие liveness endpoints оставлены:
- `/api/health`
- `/health`

Теперь они также возвращают `runtime_mode`.

### 3. WSGI loader

Добавлен [wsgi.py](D:/Ai Ai/radioproject_git/wsgi.py) для hosted WSGI/serve сценариев.

Это даёт отдельную web-точку входа, не завязанную на legacy desktop launcher.

### 4. Deploy skeleton

Добавлены:
- [Dockerfile.hosted](D:/Ai Ai/radioproject_git/Dockerfile.hosted)
- [docker-compose.hosted.yml](D:/Ai Ai/radioproject_git/docker-compose.hosted.yml)
- [requirements-hosted.txt](D:/Ai Ai/radioproject_git/requirements-hosted.txt)
- [.dockerignore](D:/Ai Ai/radioproject_git/.dockerignore)

Назначение deploy skeleton:
- дать repeatable hosted запуск;
- развести app runtime и legacy desktop launch;
- заранее зафиксировать support-services (`postgres`, `minio`) как следующий слой, не включая их пока в бизнес-логику приложения.

## Что Stage 1 сознательно не делает

- не переписывает auth;
- не убирает глобальный `switch_user`;
- не переводит persistence на Postgres;
- не подключает object storage в коде;
- не запускает каталог и library semantics.

Это уже следующие этапы.

## Hosted baseline env defaults

Для hosted запуска по умолчанию в deploy skeleton зафиксированы:
- `ACTRA_RUNTIME_MODE=hosted_web`
- `ACTRA_BIND_HOST=0.0.0.0`
- `ACTRA_UPDATE_CHECK_ENABLED=0`
- `ACTRA_FEEDBACK_EMAIL_ENABLED=0`

Смысл:
- hosted runtime не должен зависеть от desktop launcher;
- update/feedback legacy concerns не должны мешать первому web baseline.

## Критерий выхода Stage 1

Стадия считается закрытой, если:
- приложение можно поднять через hosted entrypoint;
- есть отдельный readiness contract;
- есть deploy skeleton для hosted запуска;
- базовая web-подготовка не требует `webview_launcher.py`.

## Проверка, выполненная в рамках Stage 1

- `python -m py_compile desktop-app/server.py desktop-app/hosted_entrypoint.py wsgi.py`
- runtime import check подтвердил наличие маршрутов:
  - `/api/health`
  - `/api/ready`
  - `/health`
  - `/ready`
