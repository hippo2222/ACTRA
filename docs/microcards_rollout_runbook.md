# Runbook: Microcards Productization Rollout (M14)

## 1. Обзор

Микрокарточки управляются **двумя независимыми** слоями rollout:

| Слой | Env-переменная | Назначение |
|---|---|---|
| **Theory rollout (P13)** | `RP_THEORY_ROLLOUT_STAGE` | Включает/выключает `microcards_mode` и `microcards_pair_match` как часть editor/analysis pipeline |
| **Microcards productization (M14)** | `RP_MICROCARDS_ROLLOUT_STAGE` | Управляет runtime UI, home entry, calendar/statistics integration, manual editor, text import |

Оба слоя должны быть включены для полной функциональности.  
P13 `microcards_mode` — prerequisite для работы API.  
M14 — управляет пользовательскими поверхностями и интеграциями.

## 2. Stages (этапы rollout)

### 2.1. Доступные этапы (M14)

| Stage | Описание |
|---|---|
| `disabled` | Все prod-флаги выключены. Backend live, но все интеграции скрыты. |
| `runtime_hidden` | Аналогично `disabled`. Backend live, UI скрыт. |
| `calendar_stats_only` | Только calendar + statistics integration включены. Runtime/home/editor скрыты. |
| `runtime_ui` | + Runtime UI `/microcards` включён. Home entry скрыт. |
| `home_entry` | + Microcards card на главном экране. |
| `manual_editor` | + Manual deck/card CRUD в editor. |
| `text_import` | + Текстовый импорт `@MICROCARD`. |
| `full` | Все флаги включены. **Default при отсутствии env-переменной.** |

### 2.2. Aliases

| Alias | → Stage |
|---|---|
| `off`, `none` | `disabled` |
| `backend_only`, `hidden` | `runtime_hidden` |
| `cal_stats`, `calendar` | `calendar_stats_only` |
| `runtime` | `runtime_ui` |
| `home` | `home_entry` |
| `manual` | `manual_editor` |
| `import` | `text_import` |
| `all`, `complete`, `enabled` | `full` |

## 3. Операции

### 3.1. Проверка текущего состояния

```bash
# HTTP запрос (приложение должно быть запущено)
curl http://localhost:5000/api/microcards/rollout/status | python -m json.tool

# С telemetry
curl "http://localhost:5000/api/microcards/rollout/status?include_telemetry=1" | python -m json.tool

# Только telemetry summary
curl "http://localhost:5000/api/microcards/rollout/telemetry?limit=5000" | python -m json.tool
```

### 3.2. Включение по этапам (рекомендуемый порядок)

```bash
# Шаг 1: Backend live, UI скрыт — проверяем backfill
set RP_MICROCARDS_ROLLOUT_STAGE=runtime_hidden

# Шаг 2: Запускаем backfill
python scripts/microcards_backfill.py --data-root data --mode dry-run rebuild-all-users
python scripts/microcards_backfill.py --data-root data --mode apply rebuild-all-users
python scripts/microcards_backfill.py --data-root data --mode verify rebuild-all-users

# Шаг 3: Включаем calendar/statistics
set RP_MICROCARDS_ROLLOUT_STAGE=calendar_stats_only

# Шаг 4: Включаем runtime UI
set RP_MICROCARDS_ROLLOUT_STAGE=runtime_ui

# Шаг 5: Включаем home entry
set RP_MICROCARDS_ROLLOUT_STAGE=home_entry

# Шаг 6: Включаем manual editor
set RP_MICROCARDS_ROLLOUT_STAGE=manual_editor

# Шаг 7: Включаем text import
set RP_MICROCARDS_ROLLOUT_STAGE=text_import

# Шаг 8: Полный rollout
set RP_MICROCARDS_ROLLOUT_STAGE=full
# Или удалить переменную (default = full)
```

### 3.3. Откат (rollback)

```bash
# Откатить до calendar-only
set RP_MICROCARDS_ROLLOUT_STAGE=calendar_stats_only

# Полное отключение
set RP_MICROCARDS_ROLLOUT_STAGE=disabled
```

**Гарантии при откате:**

- Файлы колод (`microcards/decks/*.json`) **не удаляются**.
- Review events (`users/*/microcards/review_events.json`) **не удаляются**.
- Calendar activity.json (`user_calendar/*/activity.json`) **не изменяется**.
- Settings/streak данные **не изменяются**.
- Повторное включение восстанавливает полную функциональность.

### 3.4. Override отдельных флагов

Каждый флаг можно переопределить через env-переменную:

```bash
# Формат: RP_MICROCARDS_FF_<FLAG_NAME_UPPERCASE>
set RP_MICROCARDS_FF_MICROCARDS_MANUAL_EDITOR=0
set RP_MICROCARDS_FF_MICROCARDS_TEXT_IMPORT=0
set RP_MICROCARDS_FF_MICROCARDS_PAIR_MATCH_RUNTIME=0
```

Stage caps имеют приоритет: если stage не разрешает флаг, env-override не может его включить.

## 4. Backfill

### 4.1. Запуск

```bash
# Dry-run (только расчёт, без записи)
python scripts/microcards_backfill.py --data-root data --mode dry-run rebuild-all-users

# Apply (запись в activity.json и settings)
python scripts/microcards_backfill.py --data-root data --mode apply rebuild-all-users

# Verify (проверка консистентности после apply)
python scripts/microcards_backfill.py --data-root data --mode verify rebuild-all-users

# Один пользователь
python scripts/microcards_backfill.py --data-root data --mode apply rebuild-user default_user
```

### 4.2. Идемпотентность

- Повторный `apply` без новых событий **не меняет** итоговые числа.
- `verify` после `apply` должен проходить без mismatches.
- Backfill пишет `backfill_status.json` в директорию пользователя.

### 4.3. Порядок относительно rollout

1. Сначала `RP_MICROCARDS_ROLLOUT_STAGE=runtime_hidden` (backend live, UI скрыт)
2. Запуск backfill (`dry-run` → `apply` → `verify`)
3. Включение `calendar_stats_only` (после успешного verify)
4. Далее по этапам

## 5. Telemetry

### 5.1. Файл событий

```
data/telemetry/microcards_prod_rollout_events.jsonl
```

### 5.2. Отслеживаемые события

| Event | Источник | Описание |
|---|---|---|
| `microcards_runtime_opened` | Frontend → POST `/api/microcards/runtime/telemetry` | Открытие `/microcards` |
| `microcards_runtime_session_started` | Frontend → POST `/api/microcards/runtime/telemetry` | Начало review session |
| `microcards_runtime_session_completed` | Frontend → POST `/api/microcards/runtime/telemetry` | Завершение review session |
| `microcards_manual_deck_created` | Backend (server.py) | Ручное создание колоды |
| `microcards_manual_card_created` | Backend (server.py) | Ручное создание карточки |
| `microcards_text_import_parsed` | Backend (server.py) | Парсинг текстового импорта |
| `microcards_text_import_executed` | Backend (server.py) | Выполнение текстового импорта |
| `microcards_text_import_parse_error` | Backend (server.py) | Ошибка парсинга |
| `microcards_backfill_run` | Backfill script | Запуск backfill |
| `microcards_backfill_verify_failed` | Backfill script | Провал verify |
| `microcards_prod_feature_blocked` | Backend (server.py) | Запрос заблокирован prod-флагом |

### 5.3. Ключевые метрики (из telemetry summary)

- `runtime_opens` — adoption
- `runtime_sessions_started` / `runtime_sessions_completed` — retention / completion rate
- `manual_deck_creates` / `manual_card_creates` — manual authoring usage
- `text_import_parses` / `text_import_executes` / `text_import_errors` — import usage + error rate
- `backfill_runs` / `backfill_verify_failures` — backfill health
- `feature_blocks` — blocked requests (rollout enforcement)

## 6. Smoke Test

```bash
python scripts/microcards_m14_rollout_smoke.py --verbose
```

Проверяет:

- Flag caps для всех этапов
- Gating manual editor / text import при разных stages
- Runtime telemetry endpoint (valid/invalid events)
- Rollback safety (данные сохраняются)
- Telemetry summary aggregation

## 7. Regression Checks

### 7.1. Выключение `microcards_calendar_integration` не ломает календарь

```bash
set RP_MICROCARDS_ROLLOUT_STAGE=disabled
# Проверить: GET /api/calendar/activity → ok, legacy поля на месте
```

### 7.2. Выключение `microcards_statistics_integration` не ломает статистику

```bash
set RP_MICROCARDS_ROLLOUT_STAGE=disabled
# Проверить: GET /api/statistics/overall → ok, legacy поля на месте
```

### 7.3. Выключение `microcards_runtime_ui` не ломает editor microcards

```bash
set RP_MICROCARDS_ROLLOUT_STAGE=disabled
# Editor microcards (через theory rollout microcards_mode) работают независимо
# Проверить: GET /api/editor/microcards/decks → ok (при RP_THEORY_ROLLOUT_STAGE=full)
```

### 7.4. Rollback после backfill

```bash
set RP_MICROCARDS_ROLLOUT_STAGE=disabled
# Проверить: activity.json не удалён, backfill_status.json на месте
# Проверить: повторный apply + verify при re-enable проходит
```

## 8. Troubleshooting

| Симптом | Возможная причина | Действие |
|---|---|---|
| Все prod-флаги `false` | `RP_MICROCARDS_ROLLOUT_STAGE=disabled` | Проверить env: `echo %RP_MICROCARDS_ROLLOUT_STAGE%` |
| Manual editor 404 | Stage < `manual_editor` | Повысить stage |
| Text import 404 | Stage < `text_import` | Повысить stage |
| `microcards_mode_disabled` | Theory rollout не на microcards/pair_match/full | Проверить `RP_THEORY_ROLLOUT_STAGE` |
| Backfill verify failed | Рассинхрон activity.json | Перезапустить `apply` + `verify` |
| Telemetry пусто | Файл не создан | Проверить права на `data/telemetry/` |
