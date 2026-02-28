# План повышения тестового покрытия до 40%

> Текущее покрытие: **27.0%** (8 471 из 31 355 строк)
> Целевое покрытие: **40%** (12 542 строки)
> Дефицит: **~4 071 строка** для покрытия

---

## Принципы

1. **ROI-first** — тестируем крупные критичные модули с низким покрытием.
2. **Unit-first** — чистые unit-тесты без запуска сервера; интеграционные — через fixtures.
3. **Критичность** — приоритет бизнес-логике (оценка, сессии, хранение, прогресс), а не утилитам.
4. **Не гонимся за числом** — покрытие ≥ 40% должно возникать из осмысленных тестов, а не из mock-прогонов ради строк.

---

## Текущие метрики по модулям (отсортировано по дефициту)

| Модуль | Строк | Покрыто | Некрыто | Критичность |
|--------|------:|--------:|--------:|:-----------:|
| `server.py` | 7 173 | 13.1% | 6 237 | ★★★ |
| `services/task_evaluator_service.py` | 2 429 | 16.8% | 2 022 | ★★★ |
| `services/analysis_schema_v2.py` | 1 290 | 4.3% | 1 234 | ★★ |
| `services/ai_generation_service.py` | 1 360 | 16.5% | 1 136 | ★★ |
| `services/microcards_service.py` | 1 033 | 31.9% | 704 | ★★★ |
| `services/adaptive_session_manager.py` | 1 053 | 34.9% | 685 | ★★★ |
| `api/session_api.py` | 1 042 | 37.4% | 652 | ★★ |
| `services/storage_service.py` | 755 | 14.0% | 649 | ★★★ |
| `services/statistics_service.py` | 648 | 9.7% | 585 | ★★★ |
| `services/complex_import_export_service.py` | 607 | 8.7% | 554 | ★★ |
| `logic/complex_session_controller.py` | 549 | 8.4% | 503 | ★★ |
| `models/test_ui.py` | 430 | 0.0% | 430 | ★ |
| `services/theory_service.py` | 429 | 11.7% | 379 | ★★ |
| `services/import_export_service.py` | 399 | 10.5% | 357 | ★★ |
| `core/logic/annotation_manager.py` | 751 | 53.9% | 346 | ★★ |
| `services/calendar/microcards_backfill.py` | 309 | 0.0% | 309 | ★★ |
| `services/user_progress_manager.py` | 388 | 22.2% | 302 | ★★★ |
| `services/microcards_analytics_service.py` | 282 | 11.7% | 249 | ★★ |
| `services/difficulty_manager.py` | 211 | 15.6% | 178 | ★★ |
| `utils/geometry.py` | 379 | 53.6% | 176 | ★ |

---

## Фазы

### Фаза 1 — Core Services (~2 400 строк покрытия, цель: ≥ 32%)

Самые критичные сервисы с высоким дефицитом.

| # | Модуль | Цель покрытия | Ожид. прирост | Описание |
|---|--------|:------------:|:-------------:|----------|
| T1 | `services/task_evaluator_service.py` | 50% | +800 строк | Ядро оценки: scoring, penalties, normalisation, overrides. |
| T2 | `services/storage_service.py` | 60% | +350 строк | Персистенция данных: read/write/list/delete, миграции файлов. |
| T3 | `services/statistics_service.py` | 55% | +290 строк | Агрегация статистики: session summaries, streaks, progress. |
| T4 | `services/microcards_service.py` | 60% | +290 строк | Микрокарточки: оставшиеся CRUD (deck lifecycle, analysis cards). |
| T5 | `services/adaptive_session_manager.py` | 55% | +210 строк | Адаптивные сессии: выбор заданий, difficulty adaptation. |
| T6 | `services/user_progress_manager.py` | 55% | +130 строк | Прогресс: XP, levels, achievements, completion tracking. |
| T7 | `services/difficulty_manager.py` | 55% | +80 строк | Сложность: calibration, dynamic adjustment. |

**Сумма прироста фазы 1: ~2 150 строк → покрытие ~34%**

### Фаза 2 — Import/Export + Calendar + Theory (~1 200 строк, цель: ≥ 37%)

Вспомогательные сервисы с бизнес-значимостью.

| # | Модуль | Цель покрытия | Ожид. прирост | Описание |
|---|--------|:------------:|:-------------:|----------|
| T8 | `services/complex_import_export_service.py` | 45% | +220 строк | Экспорт/импорт комплексов: packaging, validation, round-trip. |
| T9 | `services/import_export_service.py` | 45% | +140 строк | Import JSON/package, export, compat checks. |
| T10 | `services/theory_service.py` | 45% | +140 строк | Теория: CRUD, analysis orchestration. |
| T11 | `services/calendar/microcards_backfill.py` | 50% | +155 строк | Backfill: dry-run, apply, verify. |
| T12 | `services/microcards_analytics_service.py` | 50% | +110 строк | Аналитика микрокарточек: aggregation, trends. |
| T13 | `services/analysis_schema_v2.py` | 25% | +260 строк | Схемы анализа: validation, builder, defaults. |
| T14 | `logic/complex_session_controller.py` | 30% | +115 строк | Session flow: next task, completion, state machine. |

**Сумма прироста фазы 2: ~1 140 строк → покрытие ~37%**

### Фаза 3 — Server + Edge modules (~1 200 строк, цель: ≥ 40%)

Дотягиваем до цели через самые крупные оставшиеся модули.

| # | Модуль | Цель покрытия | Ожид. прирост | Описание |
|---|--------|:------------:|:-------------:|----------|
| T15 | `server.py` (выборочно) | 20% | +500 строк | Ключевые endpoints: auth, sessions, microcards, statistics. Через Flask test client. |
| T16 | `services/ai_generation_service.py` | 30% | +180 строк | Генерация: prompt building, response parsing (mock LLM). |
| T17 | `logic/task_controller.py` | 45% | +60 строк | Управление заданиями: load, validate, submit. |
| T18 | `services/user_service.py` | 50% | +70 строк | Пользователи: auth, profile, settings. |
| T19 | `services/session_repository.py` | 50% | +80 строк | Хранение сессий: save/load/list/delete. |
| T20 | `services/progress_service.py` | 45% | +50 строк | Прогресс: completion, mastery. |
| T21 | `core/models/task_models.py` | 80% | +100 строк | Модели данных: construction, validation, serialization. |

**Сумма прироста фазы 3: ~1 040 строк → покрытие ~40%**

---

## Структура тестовых файлов (предлагаемая)

```
tests/
├── test_task_evaluator.py          # T1
├── test_storage_service.py         # T2
├── test_statistics_service.py      # T3
├── test_microcards_pair_match.py   # T4 (уже есть)
├── test_microcard_parser.py        # T4 (уже есть)
├── test_microcard_import_integration.py  # T4 (уже есть)
├── test_adaptive_session.py        # T5 (расширить существующий)
├── test_user_progress.py           # T6
├── test_difficulty_manager.py      # T7
├── test_complex_import_export.py   # T8
├── test_import_export_service.py   # T9
├── test_theory_service.py          # T10
├── test_microcards_backfill.py     # T11
├── test_microcards_analytics.py    # T12
├── test_analysis_schema_v2.py      # T13
├── test_complex_session_ctrl.py    # T14
├── test_server_endpoints.py        # T15 (Flask test client)
├── test_ai_generation.py           # T16
├── test_task_controller.py         # T17
├── test_user_service.py            # T18
├── test_session_repository.py      # T19
├── test_progress_service.py        # T20
└── test_task_models.py             # T21
```

---

## Подход к тестированию по категориям

### Сервисы с filesystem I/O (storage, microcards, session_repository)
- `tempfile.mkdtemp` + fixture с cleanup
- Тестировать read/write/delete round-trip
- Edge cases: missing files, corrupt JSON, concurrent access

### Сервисы с бизнес-логикой (evaluator, statistics, progress)
- Чистые unit-тесты с подготовленными данными
- Параметризованные тесты для разных сценариев (pytest.mark.parametrize)
- Проверка граничных условий и error paths

### Server endpoints (server.py)
- Flask `test_client()` — не нужен реальный запуск сервера
- Mock сервисов для изоляции
- Проверка status codes, response schema, error handling

### AI-зависимые модули (ai_generation_service)
- Mock LLM responses
- Тестировать prompt construction и response parsing отдельно
- Не тестировать качество LLM-ответов

---

## Ограничения и исключения

Не тестируем (низкий ROI / невозможно без UI):
- `models/test_ui.py` (430L, UI rendering)
- `webview_launcher.py` (255L, desktop launcher)
- `services/calendar/tests/` (231L, уже тестовый код)
- `services/image_service.py` (97L, зависит от внешних библиотек)

---

## Конфигурация pytest

После достижения 40% обновить `pyproject.toml`:

```toml
[tool.pytest.ini_options]
addopts = "... --cov-fail-under=40"
```

---

## Порядок выполнения

1. Фаза 1 (T1–T7) — core services → **~34%**
2. Фаза 2 (T8–T14) — вспомогательные сервисы → **~37%**
3. Фаза 3 (T15–T21) — server + edge → **≥ 40%**

Каждая фаза — отдельный PR с прогоном `pytest --cov-fail-under=<milestone>`.
