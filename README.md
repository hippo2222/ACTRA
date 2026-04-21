<div align="center">

# ACTRA

Веб-платформа активного обучения с инструментами для работы с интерактивными заданиями, контентом, тренировочными сессиями, статистикой, календарем и microcards.

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-green?logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/License-Apache_2.0-orange)](LICENSE)
[![CI](https://github.com/hippo2222/ACTRA/actions/workflows/ci.yml/badge.svg)](https://github.com/hippo2222/ACTRA/actions/workflows/ci.yml)

</div>

---

## О проекте

ACTRA предоставляет инструменты для перевода пассивного учебного контента в практику: интерактивные задания, теории, связанные комплексы, повторение, календарь и аналитику прогресса в hosted web-runtime.

Текущий фокус проекта - hosted web-версия. Репозиторий уже не стоит воспринимать как desktop-first приложение для локальной установки на отдельные компьютеры. Desktop/webview и Windows release-сборка в кодовой базе еще присутствуют, но основной продуктовый и инфраструктурный контур сейчас hosted-first.

## Текущее состояние

Канонический источник статуса hosted-перехода:

- [docs/hosted_web_migration/current_state.md](docs/hosted_web_migration/current_state.md)
- [docs/hosted_web_migration/hosted_finish_line_matrix.md](docs/hosted_web_migration/hosted_finish_line_matrix.md)

На текущем срезе:

- `green`: `main + quick access`, `statistics + progress`, `calendar + memory health`, `catalog + library + publication`, `complex passage`, `linked theory / open flows`, `task editor`, `complex editor`, `theory editor + theory center`, `assets + media`, `microcards`, `readiness + degraded signaling`
- `transitional`: `auth + email lifecycle`, `import/export`, `hosted infra + production launch`
- `AI editor extras`: в hosted-продукте намеренно закрыты честным placeholder-состоянием `in progress`, а не считаются живым rollout-контуром

Важно: AI-генерация заданий, AI-анализ теории и AI-driven microcards сейчас не должны описываться как доступная hosted-функция. Для публичного hosted runtime они переведены в явный placeholder-контракт.

## Что уже работает в hosted

- Интерактивные типы заданий: click, draw, test, open answer, sequence и связанные runtime/UI-контракты.
- Главный экран, quick access, статистика, календарь, schedule block и memory health.
- Каталог публикаций, пользовательская библиотека и linked-theory/open flows.
- Hosted CRUD для task editor, complex editor и theory editor.
- Hosted assets/media-контур с `asset_id` / `asset_url` как каноническим источником.
- Тренировочный complex passage flow.
- Microcards как отдельный пользовательский режим с hosted persistence и аналитикой.
- `/api/ready` как канонический readiness/degraded-сигнал для hosted контуров.

## Что еще в переходном статусе

- `Auth + email lifecycle`: базовый hosted auth flow уже работает, включая `register -> verify -> me -> logout -> login -> forgot-password`, но production proof для реального домена, SMTP и публичного env еще не закрыт.
- `Import/export`: strict hosted gate уже есть, но контур еще остается transitional и требует дальнейшей зачистки compatibility-мостов.
- `Hosted infra + production launch`: локальный Docker acceptance run уже зеленый, но финальный production proof по public domain / reverse proxy / real SMTP / backup drill еще не завершен.

## Что намеренно отключено

- AI-генерация заданий в редакторе
- AI-анализ теории
- AI-driven microcards generation

В hosted-продукте эти поверхности сейчас должны показывать честное состояние "Функционал в разработке", а не частично работающий функционал.

## Архитектура

ACTRA сейчас стоит воспринимать как hosted web-систему с таким основным контуром:

```text
Frontend (HTML / JS / Tailwind)
        |
        v
Flask application (`desktop-app/server.py`)
        |
        +-- hosted entrypoint (`desktop-app/hosted_entrypoint.py`)
        +-- routes / services / hosted repositories
        |
        +-- Postgres-backed hosted persistence
        +-- S3-compatible asset storage
        +-- readiness / degraded signaling
```

Локальный production-like запуск строится вокруг:

- [`desktop-app/hosted_entrypoint.py`](desktop-app/hosted_entrypoint.py)
- [`docker-compose.hosted.yml`](docker-compose.hosted.yml)
- [`Dockerfile.hosted`](Dockerfile.hosted)
- [`.env.hosted.example`](.env.hosted.example)

## Ключевые возможности

### Контент и прохождение

- Интерактивные задания нескольких типов: click, draw, test, open answer, sequence.
- Complex passage runtime с hosted session persistence.
- Связка complex -> theory -> library/open flows.
- Assets/media pipeline для изображений и контента в runtime и редакторах.

### Авторинг

- Task editor CRUD.
- Complex editor CRUD, autosave, history, restore.
- Theory editor и theory center.
- Каталог и публикация контента в hosted-модели.

### Обучающий цикл

- Main dashboard и quick access.
- Statistics + progress.
- Calendar + schedule + memory health.
- Microcards с hosted review/runtime/analytics.

### Надежность и качество

- Hosted readiness/degraded matrix через `/api/ready`.
- GitHub Actions CI.
- Secret scanning через `gitleaks` в pre-commit и CI.
- Набор strict hosted smoke/gate-команд для ключевых контуров.

## Hosted quickstart

Основной локальный путь для проверки hosted-контура - через Docker stack.

### 1. Подготовить env

```bash
cp .env.hosted.example .env.hosted
```

Заполни реальные значения там, где это нужно. Для локального verification-run важны как минимум:

- `ACTRA_SECRET_KEY`
- `ACTRA_AUTH_PUBLIC_BASE_URL`
- `ACTRA_AUTH_SMTP_*`
- `POSTGRES_PASSWORD`
- `ACTRA_POSTGRES_DSN`
- `ACTRA_S3_*`

В [.env.hosted.example](.env.hosted.example) уже зафиксирован hosted baseline:

- `ACTRA_RUNTIME_MODE=hosted_web`
- `ACTRA_HOSTED_PERSISTENCE_STRICT=1`
- `ACTRA_HOSTED_DEV_AUTH_BRIDGE=0`
- `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=0`

### 2. Поднять локальный hosted stack

```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml up --build
```

После старта основные точки:

- приложение: `http://localhost:8000`
- Mailpit UI: `http://localhost:8025`

Остановить стек:

```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml down
```

## Hosted smoke и acceptance

Канонические команды из текущего hosted-контура:

```bash
npm run smoke:main-quick-access:hosted
npm run smoke:statistics:hosted
npm run smoke:calendar:hosted
npm run smoke:complex-passage:hosted
npm run smoke:task-editor:hosted
npm run smoke:complex-editor:hosted
npm run smoke:theory-editor:hosted
npm run smoke:catalog-library:hosted
npm run smoke:linked-theory-open:hosted
npm run smoke:assets-media:hosted
npm run smoke:microcards:hosted
npm run smoke:ai-placeholder:hosted
npm run smoke:import-export:hosted
npm run smoke:readiness:hosted
npm run smoke:launch-contract:hosted
npm run smoke:launch-acceptance:hosted
```

Полезные ориентиры:

- [docs/hosted_web_migration/hosted_launch_acceptance.md](docs/hosted_web_migration/hosted_launch_acceptance.md)
- [docs/hosted_web_migration/qa_runbook.md](docs/hosted_web_migration/qa_runbook.md)
- [docs/hosted_web_migration/smoke_matrix.md](docs/hosted_web_migration/smoke_matrix.md)

## Разработка без Docker

Этот путь полезен для локальной разработки отдельных частей, но он уже не является главным способом верификации hosted runtime.

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e ".[dev]"

npm ci
npm run build:css
```

Локальные базовые проверки:

```bash
pytest
npm test
npm run validate:themes
python -m pre_commit run --all-files
```

Если нужен именно production-like hosted proof, ориентироваться нужно не на `python desktop-app/server.py`, а на Docker stack и hosted smoke-команды.

## Технологический стек

| Слой | Технологии |
| --- | --- |
| Backend | Python 3.10+, Flask 3.x, Pydantic 2.x |
| Hosted runtime | Waitress / Flask app entrypoint, Docker Compose |
| Frontend | Vanilla JS, TailwindCSS 3.4 |
| Persistence | Postgres-backed hosted repositories |
| Assets | S3-compatible storage |
| Testing | pytest, vitest, Playwright |
| CI | GitHub Actions |
| Security | pre-commit + gitleaks |

## Структура репозитория

```text
desktop-app/                    Flask app, routes, services, hosted entrypoint
frontend/                       Клиентский UI
task_system/                    Ядро моделей и task system
common/                         Общие утилиты и конфигурация
data/                           Локальные data/artifact каталоги для dev/runtime сценариев
docs/hosted_web_migration/      Каноническая документация hosted transition
tests/                          Python и frontend тесты
scripts/                        Smoke, acceptance, audit и service scripts
.github/workflows/              CI и release workflows
docker-compose.hosted.yml       Локальный hosted stack
Dockerfile.hosted               Hosted container image
.env.hosted.example             Пример hosted env
pyproject.toml                  Python dependencies и tooling
package.json                    Frontend tooling и smoke scripts
```

## Legacy desktop / Windows notes

В кодовой базе все еще есть legacy desktop/webview и Windows release tooling:

- `desktop-app/webview_launcher.py`
- `scripts/build_release.py`
- [docs/windows_release_build.md](docs/windows_release_build.md)

Исторические GitHub releases `v1.0.0` и `v1.1.0` относятся именно к этой legacy desktop-линейке.

Будущий hosted release line стоит вести отдельно: без `latest.json`/`.exe` как основного канала поставки и с опорой на hosted smoke + launch acceptance. Для этого контура см. [docs/hosted_web_migration/hosted_release_v2.md](docs/hosted_web_migration/hosted_release_v2.md).

Но это уже не лучший entry point для понимания проекта. Если README читается впервые, ориентироваться нужно на hosted runtime, а desktop/webview воспринимать как вторичный или legacy-контур.

## Лицензия

[Apache License 2.0](LICENSE)
