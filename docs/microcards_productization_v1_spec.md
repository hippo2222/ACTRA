# Спецификация-план: Продуктизация режима микрокарточек (runtime + calendar/statistics/main + manual/import)

## Статус

- Статус: `draft-confirmed-user-decisions`
- Дата: `2026-02-26`
- Назначение: исполнительский план следующей инициативы после завершения roadmap `P0–P13` из `docs/analysis_theory_v2_spec.md`

## 1. Цель

Зафиксировать детализированный план, который доводит микрокарточки до полноценного режима продукта, а не только editor-MVP внутри анализа теории.

План покрывает:

- отдельный пользовательский экран микрокарточек (`/microcards`);
- интеграцию микрокарточек в календарь (`/calendar`);
- интеграцию микрокарточек в статистику (`/statistics`);
- интеграцию entry-point и summary на главном экране (`/main`);
- ручной режим создания/редактирования колод и карточек;
- текстовый импорт/парсер микрокарточек + шаблоны промптов для внешних LLM;
- immediate backfill истории (сразу, а не “потом”);
- безопасный rollout, telemetry, тестовую защиту, обратимость.

## 2. Подтверждённые решения (зафиксировано)

### 2.1. Отдельный пользовательский экран микрокарточек обязателен

Решение:

- создаётся отдельный runtime-экран `/microcards`;
- editor-режим микрокарточек остаётся для authoring/analysis workflow;
- runtime и authoring не смешиваются в одну страницу.

### 2.2. Микрокарточки считаются полноценной учебной активностью

Решение:

- review микрокарточек влияет на `streak`;
- review микрокарточек учитывается в дневной активности/цели;
- календарь и статистика обязаны отображать microcards-only дни как активные, а не пустые.

### 2.3. Исторический backfill делается сразу

Решение:

- сразу проектируем и реализуем backfill по существующим `microcards review events`;
- UI календаря/статистики не выкатывается как “полноценный mixed UX” до готовности backfill;
- backfill должен быть идемпотентным и проверяемым.

### 2.4. Делается ручной режим authoring + текстовый импорт микрокарточек

Решение:

- создание карточек не ограничивается только “из анализа теории”;
- добавляется manual editor для микрокарточек;
- добавляется текстовый импорт/парсер + preview/execute;
- добавляются шаблоны промптов (аналогично текстовому импорту заданий).

## 3. Контекст текущей реализации (точка старта)

Сейчас в проекте уже есть работающий microcards MVP.

### 3.1. Что уже есть (backend)

- API microcards уже реализованы в `desktop-app/server.py`:
- list decks: `/api/editor/microcards/decks`
- get deck: `/api/editor/microcards/decks/<deck_id>`
- create deck from analysis
- append from analysis
- queue
- review submit
- Хранилище и review-логика реализованы в `desktop-app/services/microcards_service.py`.
- Контент колод общий, progress/review state пользовательский.

### 3.2. Что уже есть (frontend)

- Microcards UI сейчас встроен в модалку анализа теории в editor (`frontend/Editor/import_manager.js`).
- Есть review loop, deck list, resume/restart, `Again/Hard/Good/Easy`, `pair_match`.
- Нет полноценного manual CRUD редактора карточек/колод.
- Есть rough UX места (например, append через `window.prompt`).

### 3.3. Что уже есть (calendar/statistics/main)

- Календарь отдельным модулем: `desktop-app/services/calendar/calendar_service.py`, `desktop-app/api/calendar_api.py`, `frontend/Calendar/*`.
- Статистика отдельным модулем: `desktop-app/services/statistics_service.py`, `frontend/statistics/*`.
- Главный экран `/main` существует и уже содержит карточки календаря/статистики: `frontend/MainScreen/Main.html`.
- Текстовый импорт заданий и parser stack уже есть:
- parser registry в `desktop-app/server.py`
- parsers в `task_system/models/parsers/*`
- UI шаблонов промпта в `frontend/Editor/import_manager.js`.

## 4. Подтверждённые инварианты (обязательные для новой инициативы)

### 4.1. Не ломаем текущие API-контракты календаря и статистики

Решение:

- расширения только аддитивные;
- существующие поля сохраняются;
- старые страницы должны продолжить работать даже без новых UI-изменений.

### 4.2. Источник истины по microcards review history

Решение:

- source-of-truth для истории microcards активности: `review_events.json` в пользовательских данных microcards;
- backfill и часть аналитики строятся от этих событий.

### 4.3. `streak` в UI должен стать канонически “activity-based”

Решение:

- пользовательский `streak` на главном экране/календаре/статистике отражает любую учебную активность, включая microcards;
- отдельный completion-based streak как новая самостоятельная пользовательская сущность/отдельное хранилище не вводится;
- legacy completion-based streak поля в старых endpoints могут временно сохраняться только как compatibility output (без развития как отдельной механики).

### 4.4. Runtime microcards и authoring microcards разделяются по UX

Решение:

- `/microcards` это learning runtime;
- authoring (manual/import/from-analysis deck construction) живёт в editor-поверхности;
- допускаются мосты между ними (`Открыть в редакторе` / `Открыть в микрокарточках`).

### 4.5. Backfill должен быть обратимым и повторяемым

Решение:

- предпочтителен deterministic rebuild из review events;
- повторный запуск не должен удваивать дневные значения;
- должен существовать `dry-run` и `verify` режим.

### 4.6. Ошибки в microcards должны вести к повторному показу (work-on-errors)

Решение:

- ошибочные ответы в микрокарточках не считаются “закрытыми” для учебного процесса текущей сессии без повторного показа карточки;
- для `pair_match` non-perfect результат считается ошибкой для session-loop semantics (карточка должна вернуться в очередь/повтор);
- runtime обязан показывать корректный результат сразу после ошибки; отдельные текстовые “объяснения” в v1 не обязательны;
- допускается визуальная пометка карточек, требующих повторного прохождения в текущей сессии.

Нормативная политика v1 (очередь повтора в сессии):

- при ошибке карточка не показывается немедленно повторно на следующем шаге (чтобы избежать механического “тыкания” по памяти экрана);
- ошибочная карточка добавляется в хвост текущей session-очереди (requeue-to-tail);
- если карточка ошибочно отвечена повторно, она снова уходит в хвост до успешного прохождения;
- сессия считается завершённой только когда исходная очередь и все requeued-ошибки пройдены;
- для `pair_match` “успешным прохождением” в рамках этого правила считается только perfect result.

## 5. Целевая продуктовая модель (каноника)

## 5.1. Поверхности продукта (surfaces)

Нормативно выделяются 5 поверхностей:

- `main`: вход и краткие summary (`/main`)
- `calendar`: план/heatmap/streak (`/calendar`)
- `statistics`: агрегированная аналитика (`/statistics`)
- `microcards_runtime`: прохождение колод (`/microcards`)
- `editor_microcards`: authoring/import/from-analysis (в editor)

## 5.2. Источники карточек (после реализации плана)

Режим микрокарточек перестаёт быть только analysis-driven.

Допустимые источники карточек:

- `analysis_auto` (из анализа теории)
- `manual_editor` (ручной ввод)
- `text_import` (парсерный импорт из текста/внешнего LLM)
- `future_import` (JSON/CSV/etc., не блокирует текущий план)

## 5.3. Источники аналитики (learning sources)

В системе фиксируются 3 источника активности:

- `tasks` (существующие задания/комплексы)
- `microcards` (review sessions / review events)
- `combined` (агрегат для пользовательских экранов)

## 5.4. Каноническая семантика streak

Решение:

- `activity_streak_days`: канонический пользовательский streak
- completion-based streak не является обязательной отдельной продуктовой сущностью v1; если legacy поле (`streak_days`) ещё присутствует в старом statistics output, оно трактуется только как совместимость/техническая аналитика
- UI должен явно не смешивать эти понятия

## 6. Канонические контракты данных (расширение модели)

Принцип M0 (unified model + compatibility bridge):

- для новых mixed-aware UI (main/calendar/statistics/microcards runtime summary) канонической считается unified/mixed модель с breakdown по источникам;
- legacy task-centric поля сохраняются как мост совместимости для старых endpoints/виджетов;
- новые UI должны использовать компактные combined metrics + source breakdown (с учётом ограниченного места на экране), а не дублировать рядом старые и новые показатели без необходимости.

## 6.1. Расширение daily activity в календаре (аддитивно)

Текущая модель дня активности в календаре должна быть расширена, но не сломана.

Нормативная форма (расширенный day payload):

```json
{
  "date": "2026-02-26",
  "completion_percent": 80,
  "is_missed": false,
  "is_today": true,
  "is_future": false,
  "is_rest_day": false,

  "tasks_solved": 4,
  "tasks_attempted": 5,
  "seconds_spent": 780,
  "target_minutes": 30,

  "microcards_reviews": 18,
  "microcards_correct": 14,
  "microcards_seconds_spent": 540,
  "microcards_pair_match_reviews": 3,
  "microcards_pair_match_perfect": 1,

  "activity_attempts_total": 23,
  "activity_success_total": 18,
  "activity_seconds_spent_total": 1320,

  "activity_sources": {
    "tasks": {
      "attempts": 5,
      "successes": 4,
      "seconds_spent": 780
    },
    "microcards": {
      "attempts": 18,
      "successes": 14,
      "seconds_spent": 540
    }
  }
}
```

Правила совместимости:

- существующие поля `tasks_*`, `seconds_spent`, `completion_percent` сохраняются;
- новые поля nullable/optional при чтении старых данных;
- нормализатор activity обязан заполнять отсутствующие поля нулями.

Нормативная трактовка полей (M0 фиксация):

- ключ дня (`date` и ключи в `activity.json`) — это локальная календарная дата (`YYYY-MM-DD`) в той же семантике, что и текущий `CalendarService` (`date.today()`); live-запись и backfill обязаны использовать один и тот же rule bucketing;
- `seconds_spent` сохраняет legacy-семантику времени по tasks (не mixed total);
- `completion_percent` сохраняется как legacy-compatible поле для текущего календарного UX; mixed UI не должен трактовать его как единственный источник активности;
- `microcards_reviews` = количество `review_events`;
- `microcards_correct` = количество `review_events`, где `was_correct=true`; для `pair_match` это означает только perfect-result (`details.is_perfect=true`), а partial score остаётся в event details/analytics;
- `activity_attempts_total`, `activity_success_total`, `activity_seconds_spent_total` — это только аддитивные mixed totals (`tasks + microcards`) и они не подменяют legacy `tasks_*`/`seconds_spent`;
- `activity_sources.tasks` и `activity_sources.microcards` нормализуются с обязательными ключами (`attempts`, `successes`, `seconds_spent`) и нулями при отсутствии данных.

## 6.2. Канонический контракт microcards analytics summary (backend)

Новый агрегированный payload для runtime/home/stats:

```json
{
  "user_id": "default_user",
  "generated_at": "2026-02-26T12:34:56Z",
  "totals": {
    "reviews": 1240,
    "correct_reviews": 982,
    "correct_rate": 0.792,
    "time_spent_seconds": 18340,
    "decks_active": 12
  },
  "today": {
    "reviews": 18,
    "correct_reviews": 14,
    "correct_rate": 0.778,
    "time_spent_seconds": 540
  },
  "queue_summary": {
    "decks_with_due": 4,
    "cards_due_total": 63,
    "cards_new_total": 21
  },
  "by_card_type": {
    "fact_recall": {
      "reviews": 1100,
      "correct_rate": 0.81
    },
    "pair_match": {
      "reviews": 140,
      "correct_rate": 0.64,
      "perfect_rate": 0.37
    }
  },
  "ratings_distribution": {
    "again": 201,
    "hard": 312,
    "good": 581,
    "easy": 146
  }
}
```

## 6.3. Расширение `/api/statistics/overall` (аддитивно)

Нормативно добавляются mixed-learning поля.

Пример:

```json
{
  "ok": true,
  "stats": {
    "total_tasks_attempted": 580,
    "tasks_mastered": 143,
    "total_tasks_available": 912,
    "success_rate": 0.78,
    "total_time_spent": 42000,
    "by_task_type": { },

    "activity_streak_days": 12,
    "activity_streak_best": 21,

    "microcards": {
      "reviews_total": 1240,
      "correct_rate": 0.792,
      "time_spent_seconds": 18340,
      "decks_active": 12,
      "by_card_type": { },
      "ratings_distribution": { }
    },

    "learning_sources": {
      "tasks": {
        "attempts": 580,
        "time_spent_seconds": 42000
      },
      "microcards": {
        "attempts": 1240,
        "time_spent_seconds": 18340
      },
      "combined": {
        "attempts": 1820,
        "time_spent_seconds": 60340
      }
    }
  }
}
```

Нормативная семантика совместимости (M0 фиксация):

- `total_tasks_attempted`, `total_time_spent`, `success_rate`, `by_task_type` сохраняют legacy task-centric семантику для старых клиентов;
- legacy completion-based streak поля (`streak_days`, `streak_best`, `streak_gap`), если endpoint их уже отдаёт, допускаются только как compatibility output старого statistics UI и не переопределяются mixed-логикой;
- `activity_streak_days` и `activity_streak_best` — канонический user-facing streak для mixed activity;
- `microcards.reviews_total` считает review events (не уникальные карточки);
- `learning_sources.combined` — канонический mixed aggregate для новых UI/дашбордов.

## 6.4. Расширение `/api/statistics/time-dynamics` (аддитивно)

Нормативно для каждого дня добавляются microcards и combined поля.

Пример элемента массива:

```json
{
  "date": "2026-02-26",
  "attempts": 5,
  "total_attempts": 7,
  "success_rate": 0.8,
  "study_minutes": 13,

  "microcards_reviews": 18,
  "microcards_correct_rate": 0.778,
  "microcards_study_minutes": 9,

  "combined_study_minutes": 22,
  "activity_attempts_total": 25,

  "source_breakdown": {
    "tasks": {
      "attempts": 7,
      "study_minutes": 13
    },
    "microcards": {
      "attempts": 18,
      "study_minutes": 9
    }
  },

  "streak_gap": 0,
  "streak_break": false,
  "events": []
}
```

Нормативная трактовка counters (M0 фиксация):

- `attempts` в `time-dynamics` сохраняет legacy-семантику: число уникальных task-единиц, затронутых в день (last-attempt view);
- `total_attempts` — все task attempts за день (включая повторы);
- `source_breakdown.tasks.attempts` и `activity_attempts_total` используют attempt-level семантику (то есть опираются на `total_attempts`, а не на `attempts`);
- `study_minutes` остаётся task-only legacy полем, `microcards_study_minutes` — microcards-only, `combined_study_minutes` — mixed total;
- `streak_gap` / `streak_break` в `time-dynamics` сохраняют completion-based semantics текущей статистики; UI streak badge должен брать канонический `activity_streak_*` из mixed-aware summary/overall payload.

## 6.5. Канонический summary endpoint для runtime/home (новый)

Рекомендуется ввести отдельный endpoint summary, чтобы не перегружать UI множеством запросов.

Вариант v1:

- `GET /api/microcards/summary`

Назначение:

- home card
- `/microcards` header
- быстрые due/new counters
- сегодня/недавно активная колода

## 7. Спецификация ручного режима микрокарточек (v1)

## 7.1. Цель v1 ручного режима

Сделать микрокарточки универсальным режимом, позволяющим создавать и использовать карточки без анализа теории.

## 7.2. Scope manual editor v1 (обязательный)

В v1 входят:

- create empty deck
- rename deck
- archive/delete deck
- create simple card (front/back)
- edit simple card
- delete simple card
- reorder cards (минимум)
- preview card in review-like rendering
- basic tags/metadata
- dedup checks при import/append

В v1 не обязателен:

- продвинутый визуальный `pair_match` composer
- bulk operations с таблицей на сотни карточек
- rich media в карточках

## 7.3. Доменные поля ручной карточки v1 (минимум)

Ручная карточка должна поддерживать:

- `card_type` (`fact_recall` по умолчанию)
- `front.text`
- `back.text`
- `tags`
- `difficulty_hint` (опционально)
- `status` (`active|archived|suspended`)
- `source` / `created_by` (`manual_editor`)

## 7.4. Authoring surfaces

Рекомендация для v1:

- authoring живёт в editor-поверхности (не в runtime `/microcards`);
- runtime `/microcards` остаётся review-first;
- между ними есть явные CTA.

## 7.5. Граница `pair_match` authoring v1 / v1.1 (M0 фиксация)

Нормативно фиксируем scope:

- `v1` (обязательный для инициативы): runtime review `pair_match` поддерживается (по feature flag), но visual composer/drag-and-drop authoring не входит в scope;
- `v1` manual editor гарантирует CRUD для simple cards; появление `pair_match` карточек в колоде не означает обязательный полноценный редактор их структуры;
- `v1.1` (следующий подэтап): добавляется текстовый import/parse/preview/execute для `@PAIR_MATCH`;
- `v1.1` не расширяет scope до visual `pair_match` composer автоматически (он остаётся отложенной задачей из раздела 18).

Важно для roadmap:

- pair_match editor/import/runtime рассматриваются как одна связанная область продукта; если часть функциональности откладывается после v1, она должна оставаться явно зафиксированной в roadmap как follow-up, а не “теряться”.

## 8. Спецификация текстового импорта микрокарточек (новый parser flow)

## 8.1. Принцип

Текстовый импорт микрокарточек должен повторять успешную архитектуру task text import:

- parser markers
- parse -> preview -> execute
- warnings/errors
- шаблоны промптов для LLM
- возможность вставить ответ внешнего LLM без ручного форматирования UI JSON

Опора на существующий паттерн:

- `task_system/models/task_import_parser.py`
- `task_system/models/parsers/*`
- registry в `desktop-app/server.py`
- prompt template UX в `frontend/Editor/import_manager.js`

## 8.2. Разделение потоков импорта

Решение:

- не смешивать task import и microcards import в один endpoint;
- вводятся отдельные endpoints для microcards import.

Рекомендуемые endpoints:

- `POST /api/editor/microcards/import/parse-text`
- `POST /api/editor/microcards/import/execute-text`

## 8.3. Формат v1: `@MICROCARD` (simple card)

Нормативный формат:

```text
@MICROCARD
@ deck: Кардиология / Базовые
@ tags: кардиология, ритм
@ difficulty: 2
# Что такое синусовый ритм?
= Ритм сердца, при котором импульсы исходят из синусового узла.

@MICROCARD
@ deck: Кардиология / Базовые
# Норма ЧСС у взрослого в покое
= Обычно 60–100 уд/мин.
```

Правила:

- каждый блок начинается с `@MICROCARD`;
- `#` это `front` (одна строка в v1);
- `=` это `back` (одна строка в v1);
- поддерживаются `@ key: value` metadata-строки (по аналогии с текущими parser'ами);
- metadata действует в рамках одного блока `@MICROCARD` (без неявного наследования между блоками);
- при повторе одного metadata-ключа внутри блока используется правило `last write wins` + warning в preview (рекомендуемо);
- ответ LLM не должен содержать Markdown и комментарии вне блоков.

## 8.4. Формат v1.1: `@PAIR_MATCH` (следующий подэтап, но включён в план)

Рекомендуемый формат (зарезервировать сразу):

```text
@PAIR_MATCH
@ deck: Кардиология / Сопоставления
# Сопоставьте термин и определение
L: Систола
L: Диастола
R: Фаза расслабления миокарда
R: Фаза сокращения миокарда
P: Систола => Фаза сокращения миокарда
P: Диастола => Фаза расслабления миокарда
```

Решение по внедрению:

- спецификацию формата фиксируем в этом roadmap сразу;
- parser и execute support можно вынести в отдельный subphase после simple-card import.
- до включения v1.1 parser/executor `@PAIR_MATCH` может присутствовать в parse-notes/UX как `planned`, но не должен silently импортировать такие блоки как simple cards.

## 8.5. Parse response contract (preview)

Пример ответа `parse-text`:

```json
{
  "ok": true,
  "summary": {
    "total": 12,
    "valid": 10,
    "warnings": 2,
    "errors": 0,
    "by_type": {
      "fact_recall": 10
    }
  },
  "items": [
    {
      "index": 0,
      "status": "valid",
      "card_preview": {
        "card_type": "fact_recall",
        "front": "Что такое синусовый ритм?",
        "back": "Ритм сердца..."
      },
      "metadata": {
        "deck": "Кардиология / Базовые",
        "tags": ["кардиология", "ритм"]
      },
      "validation_issues": []
    }
  ],
  "parsing_errors": [],
  "notes": [
    "Поддерживаются маркеры: @MICROCARD (v1), @PAIR_MATCH (v1.1/planned)."
  ]
}
```

## 8.6. Execute contract (create/append)

`execute-text` должен поддерживать:

- `mode=create_deck`
- `mode=append_to_deck`
- target deck selection без `window.prompt`
- dedup summary:
- `added_cards`
- `skipped_duplicates`
- `invalid_items_skipped`

Нормативно (M0 фиксация приоритетов):

- в `mode=append_to_deck` выбранная в request target-колода является источником истины; `@ deck:` внутри блоков используется только как hint/preview/warning;
- в `mode=create_deck` `@ deck:` может использоваться как suggested name/source metadata, но UI/execute должны уметь явный override без переписывания текста.

## 8.7. Prompt templates для внешних LLM (обязательные)

По аналогии с task import prompt templates, UI должен предоставлять шаблоны минимум для:

- `Q/A короткие` (`@MICROCARD`)
- `Термин -> определение` (`@MICROCARD`)
- `Определение -> термин` (`@MICROCARD`)
- `Карточки по тезисам материала` (`@MICROCARD`)

Шаблоны должны содержать:

- контекст формата
- quality criteria (фактологичность, краткость, отсутствие дублей)
- strict output format
- примеры блоков
- запрет Markdown/пояснений

## 9. Спецификация интеграции с календарём

## 9.1. Уровни интеграции

Интеграция выполняется в 2 уровнях.

Уровень L1 (обязательный v1):

- heatmap/streak/activity учитывают microcards;
- calendar UI показывает microcards activity в tooltip/summary;
- есть CTA в `/microcards`.

Уровень L2 (после стабилизации):

- today plan/schedule strip получает microcards summary как планируемый блок активности;
- возможна более глубокая интеграция в scheduler.

## 9.2. Обновление streak

Решение:

- streak обновляется при microcards review submit;
- логика обновления streak должна быть общей для tasks и microcards;
- нельзя полагаться только на `complete_session(...)` из calendar service.

## 9.3. Heatmap UI правила (после mixed integration)

Нормативно:

- день с microcards-only активностью не считается `is_missed`;
- цвет heatmap может использовать combined activity;
- tooltip показывает breakdown:
- задачи
- микрокарточки
- минуты
- точность (если доступно)

## 10. Спецификация интеграции со статистикой

## 10.1. Принцип mixed dashboard

Статистика должна уметь отображать:

- только tasks
- только microcards
- mixed activity

Без ложных пустых состояний.

## 10.2. Канонические пользовательские метрики (UI)

Верхний уровень UI статистики должен показывать минимум:

- учебная активность (attempts/reviews или combined count)
- время
- серия (`activity_streak`)
- прогресс/мастерство (task-centric метрика сохраняется как отдельная)

## 10.3. Совместимость со старым statistics UI

Решение:

- старые поля сохраняются;
- новые UI блоки читают новые поля;
- старые графики не ломаются при отсутствии microcards history.

## 11. Спецификация интеграции с главным экраном (`/main`)

## 11.1. Цель

Сделать микрокарточки видимым и доступным режимом с главного экрана за один клик.

## 11.2. Обязательные изменения main screen

- Добавить отдельную microcards card.
- Показать due/new summary.
- Добавить CTA `Продолжить повторение` / `Открыть микрокарточки`.
- Обновить подписи существующих календарь/статистика карточек, чтобы пользователь понимал mixed nature данных.
- Не перегружать правую колонку визуально.

## 11.3. Данные для main screen

Рекомендуется унифицировать данные через backend summary endpoint, чтобы избежать рассинхрона и гонок нескольких fetch.

Вариант:

- `GET /api/main/dashboard-summary` (агрегирует calendar + stats + microcards short summary)

Если не делать агрегатор в первой итерации:

- разрешается несколько запросов, но потребуется строгая синхронизация полей и fallback states.

## 12. Миграция и backfill (детализировано)

## 12.1. Что мигрируется

Мигрируются/дополняются:

- calendar activity дневные записи (`activity.json`)
- microcards analytics derived data (если будет precomputed cache/aggregate)
- служебные метаданные backfill status

Не мигрируются:

- content колод
- review states
- review events (source-of-truth не переписываем, кроме repair scripts по отдельному решению)

## 12.2. Стратегия backfill

Решение:

- deterministic rebuild от review events;
- merge в calendar activity через новые microcards-поля;
- verify mode обязателен.
- `review_events.json` остаётся source-of-truth; `activity.json` и statistics-derived mixed поля считаются производными проекциями, которые можно пересобрать;
- bucketing review events по дням в backfill должен совпадать с live integration rule (локальная календарная дата пользователя/инстанса, не "сырой UTC date" строки `reviewed_at`).

Рекомендуемые режимы скрипта:

- `dry-run`
- `apply`
- `verify`
- `rebuild-user <user_id>`
- `rebuild-all-users`

## 12.3. Идемпотентность и консистентность

Нормативно:

- повторный `apply/rebuild` без новых событий не меняет итоговые числа;
- результаты backfill и live-инкремента должны совпадать при пересчёте;
- backfill пишет отчёт с контрольными числами (events processed, days touched, totals).
- для детерминизма reducer фиксирует порядок обработки событий (рекомендуемо: сортировка по `reviewed_at`, затем `id`).

## 12.4. Порядок выполнения backfill относительно rollout

Правило:

- сначала релиз backend с поддержкой новых полей и safe readers;
- затем backfill;
- затем включение mixed UI и runtime entry;
- только потом массовый rollout flags.

## 13. Feature flags, rollout и telemetry (новая инициатива)

## 13.1. Feature flags (обязательные)

Рекомендуемый набор:

- `microcards_runtime_ui`
- `microcards_home_entry`
- `microcards_calendar_integration`
- `microcards_statistics_integration`
- `microcards_manual_editor`
- `microcards_text_import`
- `microcards_review_fx`
- `microcards_pair_match_runtime` (если хотим отдельно от общего runtime)

## 13.2. Rollout стратегия (отдельная от theory rollout P13)

Решение:

- не перегружать `RP_THEORY_ROLLOUT_STAGE` новой продуктовой логикой;
- ввести независимый rollout для продуктизации микрокарточек (например, flags-first или отдельный stage env).

Пример stage sequence:

- `disabled`
- `runtime_hidden` (backend live, UI hidden)
- `calendar_stats_only`
- `runtime_ui`
- `home_entry`
- `manual_editor`
- `text_import`
- `full`

## 13.3. Telemetry (минимум)

Обязательные события:

- `microcards_runtime_opened`
- `microcards_runtime_session_started`
- `microcards_runtime_session_completed`
- `microcards_manual_deck_created`
- `microcards_manual_card_created`
- `microcards_text_import_parsed`
- `microcards_text_import_executed`
- `microcards_text_import_parse_error`
- `microcards_backfill_run`
- `microcards_backfill_verify_failed`

Ключевые метрики:

- adoption
- retention (возврат в runtime)
- review completion rate
- parser error rate
- manual authoring usage
- due backlog trend

## 14. Типы тестов (обязательные для инициативы)

## 14.1. Unit tests

Покрыть:

- calendar activity normalization с новыми полями
- record microcards activity
- streak update helper
- microcards analytics aggregates
- backfill reducer logic
- microcards parser (`@MICROCARD`)
- parser validation/dedup signatures

## 14.2. Integration tests

Покрыть:

- review submit -> calendar activity updated
- review submit -> stats cache invalidated
- `/api/calendar/activity` mixed payload
- `/api/statistics/overall` expanded payload
- `/api/statistics/time-dynamics` mixed fields
- microcards text import parse/execute create/append
- backfill apply/verify on fixture data

## 14.3. UI/UX tests

Покрыть:

- `/main` microcards card states
- `/calendar` heatmap mixed activity
- `/statistics` microcards-only and mixed states
- `/microcards` review flow
- editor manual microcards authoring flow
- editor microcards text import flow

## 14.4. Regression / rollback tests

Покрыть:

- выключение `microcards_calendar_integration` не ломает календарь
- выключение `microcards_statistics_integration` не ломает статистику
- выключение `microcards_runtime_ui` не ломает editor microcards
- rollback после backfill не удаляет данные и не портит старые поля

## 15. Детализированный phased roadmap (M0–M15)

## M0. Спецификация контрактов и инвариантов (blocker)

Цель:

- зафиксировать канонику mixed activity, streak, источников данных, backfill semantics.

Основные действия:

- оформить addendum/spec для этой инициативы;
- зафиксировать поля activity day и stats contracts;
- зафиксировать формат `@MICROCARD` parser import;
- зафиксировать v1/v1.1 scope для pair_match authoring/import.

Точки кода (контекст):

- `desktop-app/services/calendar/calendar_service.py`
- `desktop-app/services/statistics_service.py`
- `desktop-app/services/microcards_service.py`
- `frontend/Calendar/*`
- `frontend/statistics/*`
- `frontend/MainScreen/Main.html`
- `task_system/models/parsers/*`

Критерий готовности:

- документ утверждён, спорных трактовок streak/source semantics не осталось.

## M1. Backend orchestration: microcards review -> calendar/statistics

Цель:

- после review submit синхронно обновлять учебную активность и invalidate stats.

Основные действия:

- добавить orchestration layer в `desktop-app/server.py` вокруг microcards review submit;
- вызвать calendar integration method после успешного review;
- очищать кеши статистики пользователя;
- добавить idempotency guard для live integration.

Критерий готовности:

- один review submit отражается в активности и статистике один раз.

## M2. Расширение calendar activity schema (additive)

Цель:

- сделать календарную модель способной хранить tasks + microcards без поломки текущих данных.

Основные действия:

- расширить `_normalize_activity_entry(...)`;
- расширить сериализацию/формирование day payload;
- добавить новые поля microcards и combined totals;
- обеспечить безопасное чтение старых activity.json.

Критерий готовности:

- календарные endpoints отдают mixed-compatible payload, старые UI не ломаются.

## M3. CalendarService microcards activity API + общий streak helper

Цель:

- внедрить API записи microcards-активности и унифицировать streak updates.

Основные действия:

- добавить `record_microcards_review(...)` или generic `record_learning_activity(...)`;
- вынести обновление streak в общий helper;
- интегрировать вызов helper из tasks и microcards flows;
- обновить `get_activity_for_heatmap(...)` под mixed activity.

Критерий готовности:

- microcards-only день считается активным и поддерживает рост серии.

## M4. Backfill v1 (сразу, как обязательная часть инициативы)

Цель:

- пересчитать историю microcards за прошлые периоды и записать её в календарь/аналитику.

Основные действия:

- реализовать backfill script/tooling;
- сделать `dry-run`, `apply`, `verify`;
- реализовать deterministic rebuild reducer по `review_events`;
- добавить отчётность по backfill run;
- подготовить integration fixtures для проверки.

Критерий готовности:

- на тестовых данных backfill повторяемый, verify проходит, удвоения нет.

## M5. Microcards analytics service (backend)

Цель:

- выделить агрегирование microcards-метрик в отдельный сервис.

Основные действия:

- реализовать `microcards_analytics_service`;
- агрегировать totals/today/by_card_type/ratings/queue summary;
- добавить кеш + invalidate hooks;
- подготовить summary payload для runtime/home/stats.

Критерий готовности:

- backend умеет быстро отдавать стабильные microcards summary и dynamics.

## M6. Расширение statistics backend contracts (`/api/statistics/*`)

Цель:

- сделать statistics API mixed-aware при сохранении обратной совместимости.

Основные действия:

- расширить `aggregate_statistics(...)`;
- расширить `get_time_dynamics(...)`;
- добавить `activity_streak_days` и microcards fields;
- сохранить существующие поля для старого UI.

Критерий готовности:

- старые clients работают, новые поля доступны и корректны.

## M7. UI календаря (`/calendar`) под mixed activity

Цель:

- визуально корректно показать microcards activity в календаре и heatmap.

Основные действия:

- обновить heatmap coloring/tooltip logic;
- не считать microcards-only дни пропусками;
- добавить microcards summary/CTA в today section;
- скорректировать merge logic данных календаря и статистики.

Критерий готовности:

- календарь правдиво отображает mixed activity без ложных пустых дней.

## M8. UI статистики (`/statistics`) как mixed dashboard

Цель:

- отобразить microcards в общей статистике и графиках.

Основные действия:

- обновить верхние метрики;
- добавить chart metrics для microcards/combined;
- добавить performance breakdown by source / by microcard type;
- привести empty states к mixed semantics.

Критерий готовности:

- пользователь с microcards-only данными видит полезную статистику.

## M9. Главный экран (`/main`) и продуктовый entry-point microcards

Цель:

- сделать microcards видимым первым классом на главном экране.

Основные действия:

- добавить microcards card в `frontend/MainScreen/Main.html`;
- подключить due/new/continue summary;
- скорректировать формулировки мини-карточек календаря и статистики;
- при необходимости добавить `dashboard-summary` API endpoint.

Критерий готовности:

- с `/main` есть 1-click entry в микрокарточки и понятный статус “что делать дальше”.

## M10. Новый runtime UI `/microcards` (review-first)

Цель:

- дать полноценный пользовательский экран прохождения микрокарточек.

Основные действия:

- добавить route и frontend page;
- реализовать deck list, queue open/resume/restart;
- реализовать review flow;
- подключить pair_match runtime support (по флагу);
- реализовать work-on-errors loop (ошибочные карточки, включая non-perfect `pair_match`, возвращаются в хвост очереди текущей сессии до повторного прохождения);
- показать корректный результат после ошибки без обязательного explain-блока;
- добавить session summary.

Критерий готовности:

- пользователь проходит microcards без editor workflow.
- ошибки в review не “теряются”: карточки с ошибками повторно показываются в рамках сессии/повторного цикла, а сессия не завершается до прохождения requeued-ошибок.

## M11. Manual editor микрокарточек v1 (deck/card CRUD)

Цель:

- разрешить ручное создание и правку колод/карточек.

Основные действия:

- backend deck/card CRUD endpoints;
- frontend authoring UI в editor surface;
- валидация полей и базовый preview;
- dedup awareness при create/import/append.

Критерий готовности:

- пользователь создаёт колоду и простые карточки вручную без анализа.

## M12. Текстовый импорт микрокарточек + parser + preview/execute + prompt templates

Цель:

- дать внешний канал наполнения колод из текста и LLM output.

Основные действия:

- parser `@MICROCARD` в `task_system/models/parsers/`;
- parser/execute support для `@PAIR_MATCH` как отдельный подэтап (`v1.1`) внутри `M12` (после стабилизации simple-card import);
- registry и server endpoints parse/execute;
- preview/validation/execute contracts;
- editor UI для microcards text import;
- prompt templates UI по аналогии с task import;
- create/append mode без `window.prompt`.

Критерий готовности:

- пользователь может вставить ответ внешнего LLM в parser format и создать/дополнить колоду.

## M13. UX-polish и игровые эффекты review (минимум, но качественно)

Цель:

- поднять комфортность runtime review без тяжёлой анимационной “перегрузки”.

Основные действия:

- keyboard shortcuts;
- focus/accessibility/reduced-motion;
- success/failure glow;
- streak badge;
- pair_match result highlighting.

Критерий готовности:

- review UX ощущается быстрым, понятным и приятным.

## M14. Rollout, telemetry, regression shield, эксплуатационная готовность

Цель:

- безопасно включать инициативу по частям и быстро откатывать UI/интеграции.

Основные действия:

- ввести flags и rollout policy;
- добавить telemetry событий и метрик;
- подготовить smoke scripts и regression checks;
- оформить эксплуатационный runbook (enable/disable/backfill/verify).

Критерий готовности:

- можно включать по волнам без потери данных и без “сюрпризов” в календаре/статистике.

## M15. Pair_match authoring/editor (post-v1 follow-up, tracked)

Цель:

- закрыть pair_match как полноценную область продукта: не только runtime/import, но и ручное создание/редактирование.

Основные действия:

- добавить editor authoring UX для `pair_match` (структурированный form/composer или эквивалентный guided editor);
- поддержать редактирование уже импортированных/analysis-generated `pair_match` карточек;
- обеспечить preview/validation с проверкой пар и ограничений (2-5 пар, без many-to-many в v1.x);
- синхронизировать UX с runtime semantics (ошибки/повтор/покрытие всех пар).

Критерий готовности:

- пользователь может создать и отредактировать `pair_match` карточку без ручного редактирования сырого текстового parser-формата.

## 16. Исполнительский порядок (рекомендуемый, “чтобы работать легко”)

### Шаг 1 (архитектурная фиксация)

- Утвердить этот план как addendum.
- Зафиксировать канонику streak/activity/source fields.
- Зафиксировать форматы `@MICROCARD` и резерв `@PAIR_MATCH`.

### Шаг 2 (данные и совместимость до UI)

- Выполнить `M1`, `M2`, `M3`.
- Подготовить backend расширения и safe readers.
- Не включать mixed UI, пока нет backfill.

### Шаг 3 (backfill и проверка консистентности)

- Выполнить `M4`.
- Прогнать `dry-run` и `verify`.
- Прогнать на тестовых данных, затем на реальных.
- Зафиксировать отчёты backfill.

### Шаг 4 (analytics/statistics backend)

- Выполнить `M5`, `M6`.
- Подготовить summary endpoints и expanded statistics contracts.
- Прогнать integration tests mixed payload.

### Шаг 5 (UI интеграции существующих экранов)

- Выполнить `M7`, `M8`, `M9`.
- Календарь, статистика, главный экран становятся mixed-aware.
- Включать по flags.

### Шаг 6 (runtime microcards page)

- Выполнить `M10`.
- Добавить `/microcards`.
- Подключить runtime telemetry.

### Шаг 7 (authoring + import)

- Выполнить `M11`, `M12`.
- Manual editor.
- Text import parser + prompt templates.

### Шаг 8 (полировка и rollout)

- Выполнить `M13`, `M14`.
- UX-polish, игровые эффекты, rollout scripts, runbook.

### Шаг 9 (post-v1 закрытие pair_match authoring)

- Выполнить `M15`.
- Довести pair_match до полноты по трём аспектам: прохождение + импорт + редактор.

## 17. Критерий успеха инициативы

Инициатива считается успешной, если одновременно выполняются все условия:

- микрокарточки доступны с главного экрана и имеют отдельный runtime UI;
- microcards-only активность отображается в календаре как активность и влияет на серию;
- статистика показывает microcards и mixed-learning без ложных пустых состояний;
- исторические microcards review учтены через immediate backfill;
- есть ручное создание карточек и колод;
- есть текстовый import parser + preview/execute + prompt templates;
- rollout управляется флагами и может быть откатан без потери данных;
- автотесты покрывают data-contracts, backfill и основные интеграционные цепочки.

## 18. Что можно осознанно отложить (не блокируя запуск v1)

- ручной визуальный `pair_match` composer в рамках v1 (зафиксировать как post-v1 `M15`, а не забытый долг)
- drag-and-drop pair_match UI
- полноценный import/export форматов сверх текстового parser format (`CSV/Anki-like/etc.`)
- сложные игровые эффекты уровня `S1`, если базовый UX и a11y уже закрыты
