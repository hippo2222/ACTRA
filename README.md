# Radioproject (ACTRA) — EdTech-платформа активного обучения

Radioproject (ACTRA) — инструмент для преобразования пассивного учебного контента (текстов и изображений) в интерактивные задания для активного запоминания.

Платформа решает проблему низкой эффективности традиционного чтения в условиях «клипового мышления» и строится вокруг методологии «сразу применять знания на практике»: пользователь не просто читает материал, а сразу отрабатывает его через задания, сессии и систему повторений.

Проект доменно-агностичен: может применяться в медицине, техническом обучении и других образовательных сценариях, где важны понимание, закрепление и перенос знаний в практику.

## Ключевые возможности

- Редактор контента и заданий (включая `click`, `draw`, `test`, `open_answer`, `sequence_assembly`, `error_detection`).
- Тренажёр с сессионным прохождением задач и адаптивной логикой повторов (включая `daily_mix`).
- Календарное планирование обучения: план на день, расписание, health score памяти, heatmap активности, rest days.
- Конструктор комплексов/цепочек заданий с автосохранением, историей версий и восстановлением.
- Импорт/экспорт заданий и комплексов через API и встроенные сервисы.
- Статистика прогресса по попыткам, сессиям и освоению материала.
- Два режима запуска: web (через Flask) и desktop (через `pywebview`).
- Инфраструктурные функции для продакшена: логирование, crash dump, email-уведомления feedback, тесты `pytest` + `vitest`.

## Системные требования

- **Python** 3.10+
- **Node.js** 18+ (только для сборки CSS, не требуется в runtime)
- **ОС:** Windows 10/11

## Быстрый старт (разработка)

```bash
# 1. Клонировать репозиторий
git clone <url> radioproject
cd radioproject

# 2. Создать виртуальное окружение
python -m venv .venv
.venv\Scripts\activate

# 3. Установить зависимости
pip install -e ".[dev]"

# 4. Собрать CSS (если ещё не собран)
npm install
npm run build:css

# 5. Запустить приложение (веб-режим для разработки)
cd desktop-app
python server.py
# Откройте http://127.0.0.1:8000/ui/main в браузере

# 6. Запустить приложение (оконный режим)
cd desktop-app
python webview_launcher.py
```

## Сборка релиза (Windows .exe)

```bash
# Установить PyInstaller
pip install pyinstaller

# Собрать
python scripts/build_release.py

# Результат: dist/Radioproject/
```

Подробнее — см. `scripts/build_release.py`.

## Запуск тестов

```bash
# Python-тесты
pytest

# JS-тесты (vitest)
npm test
```

## Структура проекта

```
radioproject/
├── desktop-app/          # HTTP-сервер (Flask) + webview-лаунчер
│   ├── server.py         # Основной сервер с API
│   ├── webview_launcher.py  # GUI-обёртка (pywebview)
│   ├── api/              # Модули API
│   ├── logic/            # Бизнес-логика (контроллеры, сессии)
│   └── services/         # Сервисы (оценка, прогресс, хранение)
├── frontend/             # HTML/JS/CSS интерфейс
│   ├── S1/               # Экран сессии (прохождение заданий)
│   ├── MainScreen/       # Главная страница
│   ├── Editor/           # Редактор заданий
│   ├── Complexes/        # Управление комплексами
│   ├── Calendar/         # Календарь занятий
│   ├── statistics/       # Статистика
│   └── assets/           # CSS, JS-утилиты, темы
├── task_system/          # Ядро системы заданий (модели, типы, миграции)
│   ├── core/             # Базовые классы, IO, менеджеры
│   ├── models/           # Модели данных и парсеры
│   ├── types/            # Реестр типов заданий
│   └── migrations/       # Миграции данных
├── common/               # Общие утилиты (конфиг, watchdog)
├── data/                 # Данные приложения (модули, пользователи)
├── tests/                # Тесты (pytest + vitest)
├── scripts/              # Вспомогательные скрипты
└── pyproject.toml        # Конфигурация проекта и зависимости
```

## Типы заданий

| Тип | Описание |
|-----|----------|
| `click` | Клик по области на изображении (точки, полигоны) |
| `draw` | Рисование на изображении |
| `test` | Тестовые вопросы с вариантами ответов |
| `open_answer` | Открытый текстовый ответ с оценкой по ключевым словам |
| `sequence_assembly` | Сборка последовательности элементов |
| `error_detection` | Поиск ошибок в тексте |

## Переменные окружения

| Переменная | Описание | По умолчанию |
|---|---|---|
| `TRAINER_HTTP_PORT` | Порт HTTP-сервера | `8000` |
| `TRAINER_SHOW_CONSOLE` | Показать консоль при запуске webview | `0` |
| `FLASK_DEBUG` | Включить отладочный режим Flask | `0` |
| `TRAINER_SESSION_ID` | ID сессии для прямого открытия | — |
| `TRAINER_CRASH_DUMP_INTERVAL` | Интервал crash-дампов (сек) | — |
| `ACTRA_FEEDBACK_EMAIL_ENABLED` | Включить email-уведомления о feedback | `1` |
| `ACTRA_FEEDBACK_EMAIL_TO` | Получатели уведомлений (через запятую) | `actrafb@proton.me` |
| `ACTRA_FEEDBACK_SMTP_HOST` | SMTP host для отправки уведомлений | — |
| `ACTRA_FEEDBACK_SMTP_PORT` | SMTP порт | `587` |
| `ACTRA_FEEDBACK_SMTP_USER` | SMTP логин (если нужен) | — |
| `ACTRA_FEEDBACK_SMTP_PASSWORD` | SMTP пароль (если нужен) | — |
| `ACTRA_FEEDBACK_SMTP_FROM` | Email отправителя (если не задан, берётся `SMTP_USER`) | — |
| `ACTRA_FEEDBACK_SMTP_USE_TLS` | Использовать STARTTLS | `1` |
| `ACTRA_FEEDBACK_SMTP_USE_SSL` | Использовать SMTP SSL (вместо STARTTLS) | `0` |
| `ACTRA_FEEDBACK_SMTP_TIMEOUT_SEC` | Таймаут SMTP-запроса (сек) | `15` |
| `ACTRA_UPDATE_CHECK_ENABLED` | Включить проверку обновлений | `1` |
| `ACTRA_UPDATE_MANIFEST_URL` | URL JSON-манифеста обновлений (перекрывает `config.json`) | берётся из `config.json:update_manifest_url` |
| `ACTRA_UPDATE_CHECK_INTERVAL_SEC` | TTL кэша проверки обновлений (сек) | `86400` |
| `ACTRA_UPDATE_REQUEST_TIMEOUT_SEC` | Таймаут запроса манифеста (сек) | `3` |

Примечание для Proton: для SMTP обычно используется Proton Mail Bridge (локальный SMTP host/port и bridge-учётные данные).

### Манифест обновлений в config.json

В `config.json` поддерживается ключ:

```json
{
  "update_manifest_url": "data/system/update_manifest.json"
}
```

Можно указать `http(s)://...`, `file://...` или путь к локальному JSON-файлу (относительный путь считается от директории `config.json`).

### Автоканал через GitHub Releases

В репозитории есть workflow `.github/workflows/release-manifest.yml`:

- срабатывает на `release.published`;
- читает данные релиза и публикует `latest.json` в ветку `gh-pages`.

После включения GitHub Pages (Source: `Deploy from a branch`, Branch: `gh-pages`), можно использовать:

```json
{
  "update_manifest_url": "https://<owner>.github.io/<repo>/latest.json"
}
```

Опциональные repository variables для workflow:

- `ACTRA_UPDATE_ASSET_NAME` — имя ассета релиза (по умолчанию `ACTRA-Setup.exe`);
- `ACTRA_MIN_SUPPORTED_VERSION` — значение `min_supported_version` в манифесте.

Workflow также можно запустить вручную (`workflow_dispatch`) для принудительного обновления `latest.json`.

### Проверка email-канала feedback

Тестовая отправка через API:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:8000/api/feedback/test-email" `
  -ContentType "application/json" `
  -Body '{"to_email":"actrafb@proton.me"}'
```

Основной endpoint обратной связи (`POST /api/feedback`) также отправляет email-уведомление и возвращает поле `email_notification`.

## Лицензия

Apache License 2.0 — см. [LICENSE](LICENSE).

## Windows Packaging Notes

See `docs/windows_release_build.md` for portable+installer build commands, icon generation (`actra_white.ico`), and installer path selection behavior.
