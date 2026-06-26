<div align="center">

# ACTRA

**Эффективное активное обучение**: перевод пассивных учебных материалов в прочную практику через интерактивные сессии, планирование повторений и наглядную аналитику прогресса.

[![Python 3.10+](https://img.shields.io/badge/Python-3.10%2B-blue?logo=python&logoColor=white)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-green?logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![License](https://img.shields.io/badge/License-Apache_2.0-orange)](LICENSE)
[![CI](https://github.com/hippo2222/ACTRA/actions/workflows/ci.yml/badge.svg)](https://github.com/hippo2222/ACTRA/actions/workflows/ci.yml)

</div>

---

## О проекте

**ACTRA** помогает студентам, преподавателям и специалистам превратить пассивное чтение теории в активное усвоение знаний:

*   **Активное закрепление материала** — прохождение интерактивных тренировок и мгновенная проверка ответов.
*   **Борьба с забыванием** — интеграция интервального повторения на базе умных карточек (microcards) и календаря здоровья памяти.
*   **Удобная публикация** — единый каталог, позволяющий авторам делиться комплексами заданий, а читателям — добавлять их в личную библиотеку.

> [!IMPORTANT]
> **Hosted-First продукт**: основной контур проекта сейчас полностью ориентирован на hosted web-версию. Desktop/webview и Windows release-сборка в кодовой базе сохранены как legacy, но весь актуальный функционал, биллинг и автодеплой спроектированы под веб-платформу.

---

## Текущее состояние hosted-перехода

Канонические источники детального статуса:
*   [docs/hosted_web_migration/current_state.md](docs/hosted_web_migration/current_state.md) — сводный статус внедрения.
*   [docs/hosted_web_migration/hosted_finish_line_matrix.md](docs/hosted_web_migration/hosted_finish_line_matrix.md) — детальная матрица готовности компонентов.

### Готовность компонентов:

*   `green` (Полностью готовы):
    *   **Main & Quick Access** — главный экран, панель быстрого доступа и состояние UI.
    *   **Statistics & Progress** — отслеживание динамики прохождений и прогресса.
    *   **Calendar & Memory Health** — планирование занятий и аналитика удержания знаний.
    *   **Catalog & Library** — публикация материалов, добавление в библиотеку, разграничение прав.
    *   **Complex Passage** — прохождение комплексов с серверным сохранением состояния сессии.
    *   **Task & Complex & Theory Editors** — редакторы интерактивных заданий, комплексов и теории.
    *   **Assets & Media** — загрузка и оптимизация медиафайлов (хранилище S3).
    *   **Microcards** — заучивание и аналитика ответов по карточкам.
    *   **Readiness Signaling** — API проверки готовности и деградации сервисов (`/api/ready`).
    *   **Auth & Email Lifecycle** — авторизация, регистрация, подтверждение почты и сброс паролей. Интеграция с Brevo SMTP и Google OAuth, strict release-gate (`smoke:auth:hosted`) и production-like smoke на публичном домене успешно подтверждены.
    *   **Hosted Infra & Production Launch** — деплой на VPS (Hetzner), reverse proxy (Nginx + Let's Encrypt), резервное копирование и восстановление (Postgres + MinIO) подтверждены на живом окружении `https://actra.site`.
    *   **Import/Export** — импорт и экспорт архивов заданий/комплексов. Логика полностью унифицирована, устранены локальные filesystem fallbacks в hosted-окружении, безопасность распаковки ZIP-архивов от Zip Slip/Bomb гарантирована с помощью PackageIO и проверена через `smoke:import-export:hosted`.
*   `AI editor extras` (Намеренно отключено):
    *   AI-генерация заданий, анализ теории и авто-генерация карточек в hosted-версии скрыты под честным placeholder-состоянием «Функционал в разработке».

---

## Ключевые возможности

### 1. Прохождение тренировок (Practice Loop)
*   **5 интерактивных типов заданий**:
    *   *Click* — выбор областей на изображениях;
    *   *Draw* — рисование контуров и траекторий;
    *   *Test* — классические тесты с выбором одного или нескольких вариантов;
    *   *Open Answer* — ввод текстового ответа с гибким оцениванием;
    *   *Sequence* — сборка логических цепочек и блоков.
*   **Session Persistence** — автоматическое сохранение прогресса. Можно приостановить тренировку на одном устройстве и продолжить с того же места на другом.
*   **Связь с теорией** — возможность открыть прикреплённые теоретические материалы прямо во время решения задач.

### 2. Создание и публикация (Authoring & Publishing)
*   **Редакторы контента** — CRUD-инструменты для создания отдельных заданий (Task Editor), комплексов (Complex Editor) с поддержкой автосохранения и истории изменений, а также статей (Theory Editor).
*   **Управление доступом** — публикация комплексов в каталоге с гибкими уровнями видимости: *Публично*, *По коду доступа* или *Приватно*.
*   **Модель связанных библиотек** — добавление публикации из каталога создает ссылку в библиотеке пользователя (linked entry), предотвращая неконтролируемое дублирование и форканье исходного авторского контента.

### 3. Тарифы и ограничения (Free & Premium Limits)
Для пользователей бесплатного тарифа действуют автоматические лимиты на объем хранимого контента:
*   *Теории*: до 5 личных статей и до 10 статей в библиотеке суммарно.
*   *Комплексы*: до 5 личных комплексов и до 10 комплексов в библиотеке суммарно.
*   *Задания*: до 20 личных заданий.
*   *Колоды карточек*: до 4 личных колод и до 8 колод в библиотеке суммарно.

При превышении лимитов (или при истечении Premium-подписки) избыточные материалы автоматически переходят в статус **`premium_archived`**: они остаются доступными для чтения и удаления, но блокируются для редактирования, прохождения или публикации до перехода на Premium или удаления лишнего контента.

### 4. Мультиязычность и UX
*   **Локализация (i18n)** — динамическое переключение интерфейса на русский, английский или украинский языки.
*   **Умное открытие документов** — лицензионные соглашения и политики конфиденциальности автоматически открываются на текущем языке пользователя.
*   **Интерактивный онбординг** — встроенные пошаговые туры для быстрого знакомства новых пользователей с интерфейсом (например, при первом открытии Microcards).

---

## Архитектура системы

ACTRA спроектирована как современное hosted web-приложение:

```text
Frontend (HTML5 / Vanilla JS / TailwindCSS)
        |
        v  (REST API / JSON)
Flask Application (`desktop-app/server.py`)
        |
        +-- Точка входа для хостинга (`desktop-app/hosted_entrypoint.py`)
        +-- Сервисы и репозитории бизнес-логики
        |
        +-- База данных PostgreSQL (Пользователи, сессии, прогресс, метаданные)
        +-- Облачное хранилище S3-compatible (Изображения, вложения, медиа)
        +-- readiness / degraded signaling (Контроль работоспособности)
```

---

## Быстрый запуск в Docker (Hosted Stack)

Основной способ развертывания и проверки hosted-версии приложения — использование Docker Compose стека.

### 1. Подготовка конфигурации
Скопируйте шаблон переменных окружения:
```bash
cp .env.hosted.example .env.hosted
```
Замените значения по умолчанию на реальные секреты и настройки. Важные параметры:
*   `ACTRA_SECRET_KEY` — стойкий случайный ключ для шифрования сессий.
*   `ACTRA_AUTH_PUBLIC_BASE_URL` — публичный домен приложения (например, `https://actra.site`).
*   `ACTRA_AUTH_SMTP_*` — данные SMTP-сервера (например, Brevo) для отправки писем подтверждения.
*   `POSTGRES_PASSWORD` и DSN для подключения к базе данных.
*   `ACTRA_S3_*` — настройки подключения к S3-совместимому облаку для медиафайлов.

### 2. Запуск стека
Запустите контейнеры в фоновом режиме со сборкой:
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml up -d --build
```
Доступные адреса после успешного запуска:
*   Приложение: `http://localhost:8000`
*   Тестовый SMTP-клиент Mailpit (для локальной отладки писем): `http://localhost:8025`

### 3. Остановка стека
```bash
docker compose --env-file .env.hosted -f docker-compose.hosted.yml down
```

---

## Запуск авто-тестов инфраструктуры (Smoke & Acceptance)

В репозитории подготовлены команды для сквозной проверки работоспособности всех модулей в hosted-окружении:

```bash
# Проверка интеграции компонентов и готовности к запуску
npm run smoke:launch-contract:hosted

# Запуск полного Docker-сценария локальной приемки (включая регистрацию и прохождение)
npm run smoke:launch-acceptance:hosted

# Точечные проверки отдельных модулей
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
```

---

## Локальная разработка без Docker

Используется для быстрой разработки и отладки отдельных компонентов интерфейса или логики.

### 1. Настройка окружения
```bash
# Создание и активация виртуального окружения Python
python -m venv .venv
.venv\Scripts\activate  # Для Windows
source .venv/bin/activate  # Для Linux/macOS

# Установка зависимостей проекта в режиме разработки
pip install -e ".[dev]"

# Установка зависимостей фронтенда
npm ci

# Сборка Tailwind CSS стилей
npm run build:css
```

### 2. Запуск базовых тестов
```bash
pytest                                  # Тесты Python (бэкенд)
npm test                                # Тесты Vitest (фронтенд)
npm run validate:themes                 # Проверка валидности CSS-переменных тем
python -m pre_commit run --all-files   # Статический анализ кода и проверка секретов
```

---

## Технологический стек

| Слой | Используемые технологии |
| --- | --- |
| **Backend** | Python 3.10+, Flask 3.x, Pydantic 2.x, PyMuPDF |
| **Hosted Runtime** | Waitress WSGI, Docker, Docker Compose |
| **Frontend** | Vanilla JS, TailwindCSS 3.4, PostCSS, JSDom |
| **База данных** | PostgreSQL |
| **Файловое хранилище** | S3-compatible Object Storage (MinIO / AWS S3) |
| **Тестирование** | pytest, vitest, Playwright |
| **CI/CD** | GitHub Actions (деплой по SSH при пуше в `online-hosting`) |
| **Безопасность** | pre-commit, gitleaks, bcrypt |

---

## Структура репозитория

*   `desktop-app/` — Flask-приложение: API-маршруты, сервисы интеграции, модели баз данных.
*   `frontend/` — клиентская часть: HTML-страницы, JS-модули интерфейса, стили и шрифты.
*   `task_system/` — ядро обработки заданий, валидаторы схем, парсеры и логика оценки ответов.
*   `common/` — вспомогательные утилиты, конфигурации и общие хелперы.
*   `docs/hosted_web_migration/` — подробная проектная документация по этапам миграции в web.
*   `tests/` — тесты интеграции, регрессий фронтенда и бэкенда.
*   `scripts/` — скрипты сборки релизов, аудита контрастности интерфейса и проверки базы данных.
*   `.github/workflows/` — автоматизированные сценарии CI и релизные гейты.

---

## Выпуск релизов и совместимость

Сборка и автоматическая проверка hosted-релизов (теги `v2.*`) осуществляются через GitHub Actions workflow [hosted-release-gate.yml](.github/workflows/hosted-release-gate.yml).

Исторические теги `v1.0.0` и `v1.1.0` относятся к legacy-линейке Windows Desktop приложения. Переход к hosted-модели подробно описан в документе [docs/hosted_web_migration/hosted_release_v2.md](docs/hosted_web_migration/hosted_release_v2.md).

---

## Лицензия

Распространяется под лицензией [Apache License 2.0](LICENSE).
