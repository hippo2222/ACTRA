# План рефакторинга server.py

## Текущее состояние

- **Файл:** `desktop-app/server.py` — 12 478 строк, 154 маршрута (`@app.route`)
- **Проблема:** God Object — один файл совмещает инициализацию приложения, все HTTP-маршруты, бизнес-хелперы, middleware и точку входа.
- **Существующие модули API:** `calendar_api.py`, `complexes_api.py`, `session_api.py` — уже вынесены через Flask Blueprint/функции регистрации.

## Принцип рефакторинга

**Декомпозиция по доменам через Flask Blueprints** — каждый смысловой блок маршрутов выносится в отдельный Blueprint-модуль в `desktop-app/api/`. Файл `server.py` остаётся точкой сборки: создаёт Flask app, регистрирует Blueprints, настраивает middleware и запускает сервер.

## Фазы

### Фаза 0 — Подготовка (без изменения поведения)

1. Написать интеграционный smoke-тест, который проверяет HTTP-ответы ключевых эндпоинтов (health, main UI, session start, calendar, editor catalog). Это регрессионная сеть для всех последующих шагов.
2. Выделить общий контекст приложения (`_headless_app_ctx`, логгер, пути к директориям) в отдельный модуль `desktop-app/api/app_context.py`, который импортируется всеми Blueprint-ами.

### Фаза 1 — Вынос UI-маршрутов

**Файл:** `desktop-app/api/ui_routes.py`

Переносимые маршруты (~30):
- `/ui/main`, `/ui/complexes`, `/ui/complexes/create`
- `/ui/calendar`, `/ui/statistics`, `/ui/microcards`
- `/ui/editor`, `/ui/editor/<path>`
- `/ui/welcome`, `/Welcome/<path>`
- Все `/ui/<ModuleName>/<path>` (TestUI, SequenceUI, ClickUI, DrawUI, OpenAnswerUI, MistakesUI)
- `/assets/<path>`, `/ui/assets/<path>`, `/favicon.ico`

**Обоснование:** Чисто механические маршруты `send_from_directory` без бизнес-логики. Минимальный риск, максимальное сокращение строк (~400 строк).

### Фаза 2 — Вынос Editor API

**Файл:** `desktop-app/api/editor_api.py`

Переносимые маршруты (~15):
- `/api/editor/catalog`, `/api/editor/task/...` (GET/POST/DELETE)
- `/api/editor/export/tasks`, `/api/editor/export/bulk`
- `/api/editor/import/check`, `/api/editor/import/confirm`
- `/api/editor/images/...`

**Включая:** `_import_archive_cache` и `_cleanup_import_cache()`.

### Фаза 3 — Вынос User/Auth API

**Файл:** `desktop-app/api/user_api.py`

Переносимые маршруты (~20):
- `/api/users/...` (регистрация, логин, профиль, аватар, should-welcome)
- `/api/legal/...`, `/api/consent/...`

### Фаза 4 — Вынос Feedback/System API

**Файл:** `desktop-app/api/system_api.py`

Переносимые маршруты (~10):
- `/api/feedback`, `/api/feedback/options`, `/api/feedback/test-email`, `/api/feedback/retry-pending`
- `/api/network/status`, `/api/update/check`
- `/api/health`, `/health`

### Фаза 5 — Вынос Microcards API

**Файл:** `desktop-app/api/microcards_api.py`

Переносимые маршруты (~15):
- `/api/microcards/...` (decks, cards, review, analytics)
- `/api/ai/analysis/...` (runs, coverage, generation)

### Фаза 6 — Вынос Statistics/Progress API

**Файл:** `desktop-app/api/statistics_api.py`

Переносимые маршруты (~10):
- `/api/statistics/...`, `/api/progress/...`

### Фаза 7 — Финальная очистка server.py

После всех выносов `server.py` должен содержать только:
1. Создание Flask app и конфигурацию (~50 строк)
2. Инициализацию `_headless_app_ctx` (~100 строк)
3. Регистрацию всех Blueprints (~20 строк)
4. Middleware (CORS, error handlers, logging) (~50 строк)
5. Точку входа `if __name__ == "__main__"` (~20 строк)

**Целевой размер server.py: ~300–400 строк.**

## Шаблон Blueprint-модуля

```python
"""Editor API routes."""
from flask import Blueprint, jsonify, request
from api.app_context import get_app_ctx

editor_bp = Blueprint("editor", __name__, url_prefix="/api/editor")

@editor_bp.route("/catalog", methods=["GET"])
def get_editor_catalog():
    ctx = get_app_ctx()
    modules = ctx.storage_service.load_modules()
    return jsonify({"ok": True, "modules": modules})
```

## Регистрация в server.py

```python
from api.ui_routes import ui_bp
from api.editor_api import editor_bp
# ...
app.register_blueprint(ui_bp)
app.register_blueprint(editor_bp)
```

## Правила выполнения

1. **Один Blueprint за PR** — каждая фаза = отдельный коммит/PR. Не объединять фазы.
2. **Тесты перед выносом** — smoke-тест из Фазы 0 запускается после каждой фазы.
3. **Никакого изменения логики** — чистый перенос кода. Рефакторинг бизнес-логики внутри маршрутов — отдельная задача.
4. **Обратная совместимость URL** — все пути остаются идентичными.
