# План рефакторинга server.py (v2 — детальный)

> **Бэкап перед рефакторингом:** коммит `c85aab1` → `origin/main`
> **Дата анализа:** 2026-03-01

## Текущее состояние

- **Файл:** `desktop-app/server.py` — **12 478 строк**, **~100 `@app.route`**, **519 KB**
- **Проблема:** God Object — один файл совмещает DI-контейнер, все HTTP-маршруты, UI-раздачу, AI-пайплайн (генерация, валидация, grounding, дубликаты), middleware и точку входа.
- **Уже вынесено:** `calendar_api.py` (671 строк, через `create_calendar_routes()`), `complexes_api.py` (186 строк, утилиты), `session_api.py` (87KB, фасад бизнес-логики).
- **Тесты, зависящие от `server.py`:** 14 интеграционных тестов в `desktop-app/tests/integration/`, 3 теста в `tests/` — все импортируют `app` из `server`.

## Точная карта монолита

| Строки        | Блок                              | ~Строк  | Зависимости                              |
|---------------|-----------------------------------|---------|------------------------------------------|
| 1–200         | Imports + `_make_safe_id`         | 200     | stdlib, Flask, task_system               |
| 200–300       | Service imports                   | 100     | services/*, logic/*, api/*, parsers      |
| 302–555       | `AppContextHeadless`              | 253     | Все сервисы, EventBus                    |
| 556–607       | Global wiring + UI dirs           | 52      | `_headless_app_ctx`, AI service, paths   |
| 609–810       | Flask app + middleware            | 200     | watchdog, request logging, error handler |
| 810–870       | UI state helpers                  | 60      | `_read_ui_state`, `_write_ui_state`      |
| 870–2593      | **UI serving routes (13 экранов)**| **1723**| `send_from_directory`, UI dir constants  |
| 2595–2710     | Calendar/Stats/Microcards UI      | 115     | UI dir constants                         |
| 2713–2785     | Editor CRUD                       | 72      | `storage_service`                        |
| 2786–2967     | Editor helpers + import confirm   | 181     | `_headless_app_ctx`, parsers             |
| 2967–3460     | Editor import/export endpoints    | 493     | import/export services, parsers          |
| 3461–3570     | Editor images                     | 109     | `_resolve_editor_image_path`             |
| 3572–3668     | Session UI routes                 | 96      | UI dir constants                         |
| 3669–3905     | Quick-access + UI settings        | 236     | `_read_ui_state`, `_write_ui_state`      |
| 3907–3943     | Complexes list API                | 36      | `complex_service`                        |
| 3944–4398     | **Users & Profiles API**          | **454** | `user_service`, `bcrypt`, avatars        |
| 4400–4512     | Statistics API                    | 112     | `statistics_service`                     |
| 4515–4675     | Theories API                      | 160     | `theory_service`                         |
| 4675–4984     | Complexes CRUD API                | 309     | `complex_service`, `theory_service`      |
| 4985–5645     | **Session API routes**            | **660** | `session_api`, `_json_safe`              |
| 5645–5738     | Local image serving               | 93      | filesystem paths                         |
| 5739–5960     | AI status + analyze               | 221     | `_ai_service`, feature flags             |
| 5961–6115     | AI analyses listing/detail        | 154     | `_ai_service`, AI run artifacts          |
| 6115–6195     | Rollout status/telemetry          | 80      | rollout helpers                          |
| 6195–6928     | **Microcards editor API**         | **733** | `MicrocardsService`, analytics           |
| 6929–8390     | **AI generate + upload**          |**1461** | parsers, AI service, task validation     |
| 8391–9920     | **AI/import helpers**             |**1529** | parsers, canonicalization, idempotency   |
| 9920–11506    | **AI validation/planning**        |**1586** | semantic dups, grounding, subrequests    |
| 11507–11810   | Task storage helpers              | 303     | TaskIO, TaskData, `_make_safe_id`        |
| 11809–12095   | Editor delete/rename/export       | 286     | `storage_service`                        |
| 12085–12465   | Import parse + execute            | 380     | parsers, `_save_task_to_storage`         |
| 12467–12478   | Main entry point                  | 12      | watchdog                                 |

## Принцип рефакторинга

**Flask Blueprints + shared app context module.** Каждый домен → Blueprint в `desktop-app/routes/`. Файл `server.py` остаётся оркестратором: создаёт Flask app, инициализирует `AppContextHeadless`, регистрирует Blueprints, запускает сервер.

### Почему `routes/`, а не `api/`

Папка `api/` уже содержит `session_api.py` (фасад бизнес-логики, не HTTP-маршруты), `complexes_api.py` (утилиты валидации) и `calendar_api.py` (маршруты через `create_calendar_routes()`). Чтобы не смешивать назначения, HTTP-маршруты выносим в новую папку `routes/`.

### Shared context: `routes/_context.py`

Модуль, который предоставляет доступ к глобальному состоянию приложения:

```python
"""Shared application context for all route modules."""
from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from server import AppContextHeadless

_app_ctx = None          # type: AppContextHeadless | None
_ai_service = None       # type: Any
_file_processor = None   # type: Any

def init_context(app_ctx, ai_service=None, file_processor=None):
    global _app_ctx, _ai_service, _file_processor
    _app_ctx = app_ctx
    _ai_service = ai_service
    _file_processor = file_processor

def get_ctx():          return _app_ctx
def get_ai_service():   return _ai_service
def get_file_processor(): return _file_processor
```

Вызов `init_context()` происходит в `server.py` **после** создания `_headless_app_ctx`.

---

## Фазы (порядок по убыванию безопасности)

### ФАЗА 0 — Подготовка (без изменения поведения)

**Цель:** Создать safety net и инфраструктуру.

1. Создать ветку `refactor/split-server` от текущего `main`.
2. Создать `desktop-app/routes/__init__.py` (пустой пакет).
3. Создать `desktop-app/routes/_context.py` (shared context, см. выше).
4. Написать **smoke-тест** `tests/integration/test_server_smoke.py`:
   - Импорт `app` из `server` → проверить, что Flask app создаётся.
   - Тест-клиент: `GET /api/health` → 200.
   - `GET /api/users` → 200 (список пользователей).
   - `GET /api/complexes` → 200.
   - `GET /api/statistics/overall` → 200.
   - `GET /api/editor/catalog` → 200.
   - `GET /api/theories` → 200.
   - `GET /api/editor/ai/status` → 200.
5. Запустить ВСЕ существующие 17 тестов — зафиксировать baseline.
6. **Коммит:** `refactor: phase 0 — smoke test + routes package skeleton`

### ФАЗА 1 — UI-раздача (самый безопасный вынос, ~1838 строк)

**Файл:** `routes/static_routes.py`

**Что переносим:**
- Все маршруты `/*` для 13 экранов (строки 870–2593): MainScreen, Welcome, Complexes, S1, S2, S3, TestUI, SequenceUI, ClickUI, DrawUI, OpenAnswerUI, MistakesUI, Editor
- Calendar/Statistics/Microcards UI (строки 2595–2710)
- Assets + favicon (строки 2690–2710)
- Session UI routes (строки 3572–3668)
- Константы UI dir (`FRONTEND_ROOT`, `S1_UI_DIR`, ... , `ASSETS_DIR`)

**Зависимости:** Только `send_from_directory`, UI dir constants, `logger`.

**Почему безопасно:** Нет бизнес-логики. Чисто статическая раздача файлов. Единственная зависимость — пути к директориям.

**Шаблон Blueprint:**
```python
static_bp = Blueprint("static", __name__)
# Нет url_prefix — пути разнородные (/*, /assets/*, /favicon.ico)
```

**Верификация:** Открыть каждый UI-экран в браузере, проверить загрузку CSS/JS.

**Коммит:** `refactor: phase 1 — extract static/UI routes (~1838 lines)`

### ФАЗА 2 — Users & Profiles API (~454 строк)

**Файл:** `routes/users_routes.py`

**Что переносим (строки 3944–4398):**
- `GET/POST /api/users`
- `GET /api/users/current`, `POST /api/users/select`
- `POST /api/users/update`, `POST /api/users/verify-password`, `POST /api/users/delete`
- `GET /api/assets/avatars`, `GET /api/assets/avatars/<path>`
- Хелперы: `_is_within_data_dir`, `_resolve_editor_image_path` (используется в нескольких местах — перенести в `routes/_helpers.py`)

**Зависимости:** `user_service`, `bcrypt`, `_headless_app_ctx.data_dir`.

**Коммит:** `refactor: phase 2 — extract users/profiles routes (~454 lines)`

### ФАЗА 3 — Statistics API (~112 строк)

**Файл:** `routes/statistics_routes.py`

**Что переносим (строки 4400–4512):**
- `GET /api/statistics/overall`
- `GET /api/statistics/time-dynamics`
- `GET /api/statistics/complexes`
- `GET /api/statistics/sessions`
- `GET /api/task-catalog`

**Зависимости:** `statistics_service`, `storage_service`.

**Коммит:** `refactor: phase 3 — extract statistics routes (~112 lines)`

### ФАЗА 4 — Theories API (~160 строк)

**Файл:** `routes/theories_routes.py`

**Что переносим (строки 4515–4675):**
- `GET/POST /api/theories`
- `GET/PUT /api/theories/<id>`
- `POST /api/theories/<id>/copy`
- `POST /api/theories/<id>/upload-image`
- `GET /api/theories/<id>/history`
- `POST /api/theories/<id>/restore/<timestamp>`

**Зависимости:** `theory_service`, `TheoryConflictError`, `TheoryNotFoundError`, `TheoryValidationError`.

**Коммит:** `refactor: phase 4 — extract theories routes (~160 lines)`

### ФАЗА 5 — Complexes CRUD API (~345 строк)

**Файл:** `routes/complexes_routes.py`

**Что переносим (строки 3907–3943 + 4675–4984):**
- `GET /api/complexes`, `GET /api/complexes/<id>`
- `POST /api/complexes` (create)
- `PUT /api/complexes/<id>` (update)
- `DELETE /api/complexes/<id>`
- `GET/POST/DELETE /api/complexes/<id>/autosave`
- `GET /api/complexes/<id>/history`
- `POST /api/complexes/<id>/restore/<timestamp>`

**Зависимости:** `complex_service`, `theory_service`, `validate_and_normalize_create_payload`.

**Коммит:** `refactor: phase 5 — extract complexes CRUD routes (~345 lines)`

### ФАЗА 6 — Session API routes (~660 строк)

**Файл:** `routes/session_routes.py`

**Что переносим (строки 4985–5645):**
- `GET /api/session/<id>/task`
- `GET /api/sessions/active`
- `POST /api/session/<id>/task/submit` (самый сложный — ~380 строк)
- `POST /api/session/<id>/task/next`
- `POST /api/session/<id>/pause`, `/resume`, `/cancel`
- `GET /api/session/<id>/iteration-results`, `/final-results`
- `GET /api/local-image`
- Хелпер `_json_safe`

**Зависимости:** `session_api`, `_json_safe`, `_headless_app_ctx`.

**⚠️ Риск:** `submit_task` — самый критичный эндпоинт. Обязательно прогнать все тесты `test_session_api_http.py` и `test_http_submit_daily_mix.py`.

**Коммит:** `refactor: phase 6 — extract session routes (~660 lines)`

### ФАЗА 7 — Editor routes (~857 строк)

**Файл:** `routes/editor_routes.py`

**Что переносим (строки 2713–3570):**
- `GET /api/editor/catalog`
- `GET/POST/DELETE /api/editor/task/<module>/<topic>/<task>`
- `POST /api/editor/import/confirm`
- `POST /api/complexes/export`, `/api/complexes/import/check`, `/api/complexes/import/confirm`
- `POST /api/editor/test/import`, `/api/editor/test/export`
- `POST /api/editor/logs/scale`
- `POST /api/editor/task/new`, `/api/editor/module/new`, `/api/editor/topic/new`
- `POST /api/editor/upload-image`, `GET /api/editor/image`
- Хелперы: `_format_task_for_editor`, `_resolve_editor_image_path` (shared)

**Зависимости:** `storage_service`, `import_export_service`, `complex_import_export_service`, parsers.

**Коммит:** `refactor: phase 7 — extract editor routes (~857 lines)`

### ФАЗА 8 — Quick-access + UI settings (~236 строк)

**Файл:** `routes/quick_access_routes.py`

**Что переносим (строки 3669–3905 + 810–870):**
- `GET /api/ui/quick-access`
- `POST /api/ui/quick-access/pin`, `/unpin`, `/remove`, `/recent`
- `GET/POST /api/ui/settings`
- Хелперы: `_read_ui_state`, `_write_ui_state`, `_get_user_dir`, `_ui_state_path`

**Коммит:** `refactor: phase 8 — extract quick-access/settings routes (~236 lines)`

### ФАЗА 9 — Microcards editor API (~733 строк)

**Файл:** `routes/microcards_routes.py`

**Что переносим (строки 6115–6928):**
- Rollout status/telemetry (theory + microcards)
- `GET /api/microcards/summary`
- Все `/api/editor/microcards/*` (decks CRUD, cards CRUD, review, import)
- Хелперы: `_microcards_service()`, `_microcards_analytics_service()`, etc.

**Зависимости:** `MicrocardsService`, `MicrocardsAnalyticsService`, rollout helpers, `_ai_service`.

**Коммит:** `refactor: phase 9 — extract microcards routes (~733 lines)`

### ФАЗА 10 — AI Generation API (~2650 строк) ⚠️ Самая сложная фаза

**Файлы:**
- `routes/ai_routes.py` — HTTP-эндпоинты (~600 строк)
- `routes/_ai_helpers.py` — AI-специфичные хелперы (~2050 строк)

**Что переносим:**
- **Эндпоинты (строки 5739–5960, 5961–6115, 6929–8390):**
  - `GET /api/editor/ai/status`
  - `POST /api/editor/ai/analyze`
  - `GET /api/editor/ai/analyses`, `GET .../analyses/<run_id>`, `GET .../coverage`
  - `POST /api/editor/ai/generate` (самый большой — строки 6929–8321, ~1390 строк!)
  - `POST /api/editor/ai/upload`
- **Хелперы (строки 8391–11506):**
  - `_get_parser_for_marker`, `_word_ranges`, `_canonicalize_test_questions`
  - Idempotency: `_IMPORT_EXECUTE_IDEMPOTENCY_*`, `_utc_now_iso`
  - AI run artifacts: `_ai_run_merge_manifest`, `_ai_run_write_artifact`, `_ai_run_build_reopen_analysis_response`
  - Microcards rollout: `_get_microcards_rollout_stage*`, `_emit_microcards_prod_telemetry`
  - Review integration: `_apply_microcards_review_calendar_integration`, `_orchestrate_microcards_review_post_submit`
  - Validation: `_normalize_int_id_list`, `_normalize_str_id_list`, `_sanitize_source_grounding_meta`
  - Source grounding: `_grounding_token_set`, `_grounding_number_set`, `_evaluate_task_source_grounding` и 15+ связанных функций
  - Semantic duplicates: `_char_ngrams`, `_semantic_duplicate_*`, `_annotate_semantic_duplicate_candidates`
  - Generation planning: `_plan_ai_generation_subrequests`, `_postprocess_ai_generate_results`
  - Feature flags: `_attach_editor_feature_flags`, `_sanitize_*_for_client`

**⚠️ Особые сложности:**
1. `ai_generate` (строки 6929–8321) содержит вложенные функции и замыкания — нужно аккуратно передать зависимости.
2. Множество хелперов связаны друг с другом — нужно переносить группами.
3. Rollout/telemetry хелперы используются и Microcards-маршрутами — вынести в общий `routes/_rollout_helpers.py`.

**Стратегия:** Разбить на 2 подфазы:
- **10a:** Перенос хелперов (`_ai_helpers.py`, `_rollout_helpers.py`) — без изменения маршрутов.
- **10b:** Перенос маршрутов, импортирующих хелперы из новых модулей.

**Коммиты:**
- `refactor: phase 10a — extract AI/rollout helpers (~3100 lines)`
- `refactor: phase 10b — extract AI routes (~600 lines)`

### ФАЗА 11 — Import parse + execute (~666 строк)

**Файл:** `routes/import_routes.py`

**Что переносим (строки 11507–12465):**
- `_format_task_preview`, `_generate_unique_task_ids`, `_save_task_to_storage`
- `POST /api/editor/tasks/delete`
- `POST /api/editor/export/text`
- `POST /api/editor/modules/delete`, `/api/editor/topics/delete`
- `POST /api/editor/module/rename`, `/api/editor/topic/rename`
- `POST /api/editor/import/parse`, `/api/editor/import/execute`

**Зависимости:** `storage_service`, `TaskIO`, `TaskData`, `_make_safe_id`, parsers, idempotency helpers.

**Коммит:** `refactor: phase 11 — extract import/storage routes (~666 lines)`

### ФАЗА 12 — Финализация

1. **server.py** остаётся тонким оркестратором (~300–400 строк):
   - Imports + path setup (~30 строк)
   - `AppContextHeadless` class (~253 строк) — **оставляем в server.py** (DI-контейнер — это ответственность точки входа)
   - Global wiring + `init_context()` (~30 строк)
   - Flask app creation + middleware (~80 строк)
   - Blueprint registration (~20 строк)
   - `if __name__ == "__main__"` (~12 строк)
2. Полный прогон ВСЕХ 17 тестов.
3. Ручная проверка каждого UI-экрана в браузере.
4. Merge `refactor/split-server` → `main`.

**Коммит:** `refactor: phase 12 — finalize server.py orchestrator (~400 lines)`

---

## Текущий статус рефакторинга (2026-03-02)

**Ветка:** `refactor/split-server` (15 коммитов)
**server.py:** 5 314 строк (было 12 478) — **сокращение на 57%**

### Выполненные фазы

| Фаза | Коммит | Blueprint | Строк |
|------|--------|-----------|-------|
| 0 | `befdf34` | routes/ skeleton + smoke test | — |
| 1 | `8c91d6c` | `static_routes.py` | 468 |
| 2 | `3a6e342` | `users_routes.py` + `_helpers.py` | 445 + 245 |
| 3 | `4a1318f` | `statistics_routes.py` | 134 |
| 4 | `4a475ba` | `theories_routes.py` | 194 |
| 5 | `b78f265` | `complexes_routes.py` | 346 |
| 6 | `e6a07b0` | `session_routes.py` | 790 |
| 7 | `452db2f` | `editor_routes.py` | 928 |
| 8 | `1f854a5` | `quick_access_routes.py` | 454 |
| 9 | `3063acd` | `microcards_routes.py` | 902 |
| 10a | `77db0e1` | `ai_routes.py` (smaller endpoints) | 501 |
| 10b | `3d980dc` | `ai_routes.py` + `ai_generate` route | 1 934 |
| 11 | `6d0528f` | `import_routes.py` | 1 176 |
| 12a | `ef6d907` | `misc_routes.py` | 342 |

**Итого в Blueprint-модулях:** ~8 359 строк (12 Blueprint-файлов + `_context.py` + `_helpers.py`)

### Оставшееся в server.py

| Блок | ~Строк | Статус |
|------|--------|--------|
| Imports + path setup | ~200 | ✅ Останется (orchestrator) |
| `AppContextHeadless` | ~253 | ✅ Останется (DI-контейнер) |
| Helper functions (shared across blueprints via `set_extra`) | ~3 100 | ⚠️ Функции-хелперы остаются, передаются через `set_extra` |
| Flask app + middleware + health/debug routes | ~100 | ✅ Останется (orchestrator) |
| Blueprint registration + `set_extra` calls | ~80 | ✅ Останется |
| `if __name__` | ~12 | ✅ Останется |

### Phase 10b — Completed ✅

Маршрут `POST /api/editor/ai/generate` (~1 390 строк, ~10 вложенных closures) успешно перенесён в `routes/ai_routes.py`.
Подход: зависимости (`_ai_service`, parser-классы, ~20 helper-функций) переданы через `set_extra("ai_generate_helpers", ...)` и привязаны к локальным переменным в начале функции, что сохраняет замыкания без изменений.

### Следующие шаги

Все маршруты извлечены в Blueprint-модули. `server.py` (~5 314 строк) теперь содержит только:
- DI-контейнер (`AppContextHeadless`)
- Helper-функции, используемые несколькими Blueprint-ами через `set_extra`
- Flask-приложение, middleware, регистрацию Blueprint-ов

Для дальнейшего уменьшения `server.py` можно:
- Вынести helper-функции в отдельные модули по группам (source grounding, semantic duplicates, feature flags, telemetry, etc.)
- Вынести `AppContextHeadless` в `app_context.py`

---

## Целевая структура `desktop-app/`

```
desktop-app/
├── api/
│   ├── calendar_api.py          (уже есть, 671 строк)
│   ├── complexes_api.py         (уже есть, 186 строк — утилиты)
│   ├── session_api.py           (уже есть, 87KB — бизнес-фасад)
│   └── web_models/
├── routes/                      ← НОВАЯ ПАПКА
│   ├── __init__.py
│   ├── _context.py              (~30 строк — shared app context)
│   ├── _helpers.py              (~200 строк — общие хелперы)
│   ├── _ai_helpers.py           (~2050 строк — AI validation/planning)
│   ├── _rollout_helpers.py      (~400 строк — rollout/telemetry)
│   ├── static_routes.py         (~1838 строк → Blueprint)
│   ├── users_routes.py          (~454 строк → Blueprint)
│   ├── statistics_routes.py     (~112 строк → Blueprint)
│   ├── theories_routes.py       (~160 строк → Blueprint)
│   ├── complexes_routes.py      (~345 строк → Blueprint)
│   ├── session_routes.py        (~660 строк → Blueprint)
│   ├── editor_routes.py         (~857 строк → Blueprint)
│   ├── quick_access_routes.py   (~236 строк → Blueprint)
│   ├── microcards_routes.py     (~733 строк → Blueprint)
│   ├── ai_routes.py             (~600 строк → Blueprint)
│   └── import_routes.py         (~666 строк → Blueprint)
├── server.py                    (~400 строк — оркестратор)
└── ...
```

## Правила выполнения

1. **Одна фаза = один коммит** — не объединять фазы. При проблемах — `git revert` конкретного коммита.
2. **Smoke-тест после каждой фазы** — запуск полного набора тестов.
3. **Никакого изменения логики** — чистый перенос кода. Ни одна строка бизнес-логики не меняется.
4. **Обратная совместимость URL** — все пути остаются идентичными. Blueprints используют `url_prefix` только когда все маршруты в модуле имеют общий префикс.
5. **Ветка `refactor/split-server`** — вся работа в отдельной ветке. Merge в main только после полного прогона.
6. **Порядок по безопасности:** сначала самые простые выносы (UI-раздача, статистика), потом сложные (AI, sessions).
7. **Shared state через `_context.py`** — никаких глобальных переменных уровня модуля в route-файлах. Все зависимости через `get_ctx()`.

## Оценка рисков

| Фаза | Риск | Причина |
|------|------|---------|
| 1 (UI) | 🟢 Низкий | Только `send_from_directory`, нет логики |
| 2 (Users) | 🟢 Низкий | Изолированный домен |
| 3 (Statistics) | 🟢 Низкий | 4 простых endpoint-а |
| 4 (Theories) | 🟢 Низкий | Изолированный домен |
| 5 (Complexes) | 🟡 Средний | Связан с theories через `theory_link` |
| 6 (Sessions) | 🟡 Средний | Критичный `submit_task`, много debug-логов |
| 7 (Editor) | 🟡 Средний | Связан с import/export и image resolution |
| 8 (Quick-access) | 🟢 Низкий | Изолированный UI state |
| 9 (Microcards) | 🟡 Средний | Связан с rollout и analytics |
| 10 (AI) | 🔴 Высокий | 3100+ строк хелперов с перекрёстными зависимостями |
| 11 (Import) | 🟡 Средний | Idempotency, rollback, AI run artifacts |
| 12 (Финал) | 🟢 Низкий | Только проверки |

## Шаблон Blueprint-модуля

```python
"""Users & Profiles API routes."""
import logging
from flask import Blueprint, jsonify, request
from routes._context import get_ctx

logger = logging.getLogger(__name__)

users_bp = Blueprint("users", __name__)


@users_bp.route("/api/users", methods=["GET"])
def list_users():
    """List all available user profiles."""
    try:
        ctx = get_ctx()
        users = ctx.user_service.get_all_users()
        items = [u.to_api_dict() for u in users]
        return jsonify({"ok": True, "items": items})
    except Exception as exc:
        logger.exception("[HTTP] Failed to list users: %s", exc)
        return jsonify({"ok": False, "error": "list_users_failed"}), 500
```

## Регистрация в server.py

```python
from routes._context import init_context
from routes.static_routes import static_bp
from routes.users_routes import users_bp
from routes.statistics_routes import statistics_bp
from routes.theories_routes import theories_bp
from routes.complexes_routes import complexes_bp
from routes.session_routes import session_bp
from routes.editor_routes import editor_bp
from routes.quick_access_routes import quick_access_bp
from routes.microcards_routes import microcards_bp
from routes.ai_routes import ai_bp
from routes.import_routes import import_bp

# Initialize shared context
init_context(_headless_app_ctx, ai_service=_ai_service, file_processor=_file_processor)

# Register all blueprints
for bp in [static_bp, users_bp, statistics_bp, theories_bp, complexes_bp,
           session_bp, editor_bp, quick_access_bp, microcards_bp, ai_bp, import_bp]:
    app.register_blueprint(bp)
```
