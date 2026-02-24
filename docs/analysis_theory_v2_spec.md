# Спецификация: Анализ Теоретических Данных v2

## Статус

- Статус: `draft-confirmed`
- Дата: `2026-02-24`
- Назначение: техническая спецификация для реализации отдельного режима анализа теории, красивого отчёта и режима микрокарточек.

## 1. Цель

Зафиксировать согласованные решения и задать формальную основу для реализации:

- отдельной функции анализа теоретического материала;
- практико-ориентированного отчёта (без графоманства и повторов);
- связки анализа с ручным созданием заданий;
- отдельного режима микрокарточек (включая `pair_match` как первую реализацию capability `MATCH`);
- безопасного rollout без поломки почти готового проекта.

Документ учитывает реальные ограничения проекта:

- уровни сложности у типов заданий фиксированы и являются частью итерационной системы комплексов;
- `SEQUENCE` уже является универсальным типом структурирования (не только порядок);
- `click/error_detection` имеет особую логику в адаптивной системе и не должен переименовываться в `MATCH`.

## 2. Подтверждённые инварианты (обязательные)

### 2.1. Уровни сложности не являются ручной опцией выбора

Уровни сложности трактуются как:

- фиксированная механика типа задания;
- часть итерационной системы комплексов;
- предопределённая progression (если тип включён в комплекс).

Следствие для анализа:

- анализ не предлагает «выбрать уровень N»;
- анализ оценивает пригодность типа как полной фиксированной progression;
- отчёт объясняет педагогическую роль каждого уровня внутри progression.

### 2.2. `SEQUENCE` считается универсальным типом структурирования

`SEQUENCE` используется для:

- порядка / хронологии;
- классификации;
- группировки;
- иерархии;
- ранжирования.

Следствие:

- новый тип `CLASSIFY` не вводится на текущем этапе;
- анализ использует поле `sequence_intent` (`ordering|classification|hierarchy|ranking|grouping`).

### 2.3. `MATCH` не приравнивается к `click/error_detection`

Решение:

- `MATCH` фиксируется как отдельная capability сопоставления пар;
- первая реализация: режим микрокарточек `pair_match`;
- `click/error_detection` (включая `text_choice`) может дать UI-идеи, но не объявляется `MATCH`.

### 2.4. Красивый отчёт строится из структурной разметки

Решение:

- AI не является источником свободного Markdown-оформления;
- источник истины: `analysis_json` (+ структурные `report_blocks`);
- renderer строит красивый отчёт детерминированно;
- при невалидном оформлении используется fallback-render из данных анализа.

## 3. P0 prerequisite (блокер до P1)

До запуска анализа v2 нужно исправить рассинхрон в системе сложности.

### 3.1. Проблема

В `DifficultyManager`:

- вызывается `_enhance_sequence_task`, но метод отсутствует;
- `_enhance_test_task` содержит поля, относящиеся к `sequence_assembly`.

### 3.2. Обязательные действия P0

- реализовать `_enhance_sequence_task`;
- вернуть корректную логику `TEST` в `_enhance_test_task`;
- синхронизировать `DifficultyManager` и `TaskEvaluatorService`;
- обновить тесты `DifficultyManager`;
- добавить контракт-тесты `DifficultyManager -> evaluator -> UI`.

## 4. Каноническая модель анализа: Capability vs Реализация

Анализ v2 работает в двух слоях.

### 4.1. Слой capability (учебная способность)

Примеры capability:

- `classification`
- `ordering`
- `hierarchy_building`
- `error_detection`
- `fact_recall`
- `explanation`
- `pair_matching` (будущий `MATCH`)

### 4.2. Слой реализации (что реально есть в продукте)

Статусы:

- `implemented_complex_type`
- `implemented_microcards_mode`
- `planned`
- `unsupported`

Следствие:

- анализ может уже сейчас выделять `pair_matching`;
- маппинг на реализацию может указывать `planned` или `microcards_only`.

## 5. Capability Matrix v1 (основа для анализа)

Это канонический реестр педагогических возможностей системы, на который опирается анализ.

### 5.1. Нормативный формат записи

```json
{
  "capability_matrix_version": "1.0",
  "entries": [
    {
      "id": "sequence_structuring",
      "task_type": "SEQUENCE",
      "implementation_status": "implemented_complex_type",
      "progression_is_fixed": true,
      "supported_levels": [1, 2, 3],
      "complex_role": "core",
      "intents": ["ordering", "classification", "hierarchy", "ranking", "grouping"],
      "level_roles": {
        "1": "Сборка структуры",
        "2": "Сборка + называние уровней",
        "3": "Сборка + называние уровней и блоков"
      }
    }
  ]
}
```

### 5.2. Канонические entries v1 (семантика)

#### `TEST`

- `implementation_status`: `implemented_complex_type`
- `progression_is_fixed`: `true`
- `supported_levels`: `[1, 2]`
- `complex_role`: `core`
- роль progression:
  - L1: multiple choice (распознавание/объективная проверка фактов)
  - L2: text answers (воспроизведение/извлечение ответа)

#### `OPEN_ANSWER`

- `implementation_status`: `implemented_complex_type`
- `progression_is_fixed`: `true`
- `supported_levels`: `[1]`
- `complex_role`: `core`
- роль: объяснение, причинно-следственные связи, развернутый ответ

#### `SEQUENCE`

- `implementation_status`: `implemented_complex_type`
- `progression_is_fixed`: `true`
- `supported_levels`: `[1, 2, 3]`
- `complex_role`: `core`
- `intents`: `ordering`, `classification`, `hierarchy`, `ranking`, `grouping`
- роль progression:
  - L1: сборка структуры/распределение элементов
  - L2: сборка + называние уровней
  - L3: сборка + называние уровней и блоков
- семантика зависит от флагов:
  - `level_order_matters`
  - `sequence_within_level_matters`

#### `CLICK` (обычный)

- `implementation_status`: `implemented_complex_type`
- `progression_is_fixed`: `true`
- `supported_levels`: `[1, 2, 3]`
- `complex_role`: `core`
- роль progression:
  - L1: распознавание/нахождение
  - L2: распознавание + называние
  - L3: обводка + называние

#### `DRAW`

- `implementation_status`: `implemented_complex_type`
- `progression_is_fixed`: `true`
- `supported_levels`: `[1, 2]`
- `complex_role`: `core`
- роль progression:
  - L1: обводка/пространственное распознавание
  - L2: обводка + называние

#### `CLICK_ERROR_DETECTION` (`click` + `subtype=error_detection`)

- `implementation_status`: `implemented_complex_type`
- `complex_role`: `finisher_special`
- modes: `text_errors`, `text_choice`
- capability: error detection / discrimination
- не считать эквивалентом `MATCH`
- в адаптивной системе обрабатывается отдельно (финализатор)

#### `pair_matching` (capability `MATCH`, пока без task type)

- `task_type`: `null`
- `implementation_status`: `planned`
- `first_target_implementation`: `microcards.pair_match`
- `complex_role`: `none`
- capability: сопоставление пар (термин-определение, признак-категория, причина-следствие)

## 6. Спецификация `analysis_json v2`

### 6.1. Принципы

- `analysis_json v2` расширяет текущий формат без поломки совместимости.
- Старые поля (`educational_units`, `recommendations`, `not_recommended`) сохраняются.
- Новые поля добавляются для практической полезности, красивого отчёта и режима микрокарточек.

### 6.2. Top-level schema (нормативная форма)

```json
{
  "analysis_schema_version": "2.0",
  "material_volume": "small|medium|large",
  "target_language": "ru|en|mixed|unknown|...",
  "educational_units": [],
  "learning_chunks": [],
  "recommendations": [],
  "not_recommended": [],
  "type_progression_suitability": [],
  "authoring_routes": [],
  "coverage_plan": {},
  "future_capabilities": [],
  "microcards_candidates": [],
  "illustrations_detected": false,
  "illustrations_note": null,
  "warnings": [],
  "report_blocks_version": "1.0",
  "report_blocks": [],
  "report_lint": {
    "verbosity_risk": "low|medium|high",
    "duplicate_content_signals": 0,
    "fallback_renderer_recommended": false
  }
}
```

### 6.3. `educational_units` (расширенная каноническая форма)

```json
{
  "id": 1,
  "title": "Короткое название единицы",
  "type": "concept|process|fact|term|classification",
  "description": "Краткое описание (1 предложение)",
  "explicitness": "explicit|inferred",
  "evidence": "Короткая опора из текста/сигнал",
  "modality": "text|visual|mixed",
  "assessment_risk": "low|medium|high",
  "chunk_ids": ["chunk_1"],
  "prerequisite_unit_ids": [2, 3],
  "cognitive_ops": ["recognize", "recall", "explain"],
  "factual_anchors": [
    { "kind": "number|term|date|threshold|name", "value": "..." }
  ]
}
```

#### Нормализация `educational_units` (backend)

- `chunk_ids` может быть достроен эвристически;
- `prerequisite_unit_ids` может быть пустым списком;
- `cognitive_ops` нормализуется к enum;
- `factual_anchors` может извлекаться эвристически, если AI не добавил их явно.

### 6.4. `learning_chunks`

Назначение: связать unit-уровень с практическим авторингом без перегруза.

```json
{
  "id": "chunk_1",
  "title": "Классификация форм X",
  "chunk_type": "classification|process|mechanism|contrast|hierarchy|factual_set|other",
  "goal": "Что студент должен научиться делать/понимать",
  "unit_ids": [1, 2, 3],
  "common_confusions": ["Что обычно путают"],
  "factual_anchors": [
    { "kind": "term", "value": "..." },
    { "kind": "number", "value": "..." }
  ],
  "route_ids": ["route_1", "route_2"],
  "notes_for_author": ["Не смешивать с ..."]
}
```

### 6.5. `recommendations` (legacy-compatible summary)

`recommendations` остаётся как слой совместимости для текущего UI импорта/генерации.

Правило:

- `recommendations` больше не является единственным источником практических рекомендаций.
- Для работы пользователя приоритетны `type_progression_suitability` и `authoring_routes`.

### 6.6. `type_progression_suitability` (ключевой v2-блок)

Учитывает fixed progression уровней и реальные роли типов в системе.

```json
{
  "task_type": "SEQUENCE|TEST|OPEN_ANSWER|CLICK_TEXT|CLICK_WORDS|CLICK|DRAW",
  "subtype": "error_detection|null",
  "availability": "implemented|planned|microcards_only|unsupported",
  "progression_is_fixed": true,
  "complex_role": "core|finisher_special|none",
  "suitability": "high|medium|low|not_recommended",
  "priority": "high|medium|low",
  "covers_chunk_ids": ["chunk_1"],
  "covers_unit_ids": [1, 2, 3],
  "why": "Короткое практическое обоснование",
  "level_role_map": [
    {
      "level": 1,
      "role": "Что делает уровень в progression этого типа",
      "value_for_material": "Почему это полезно для данного материала"
    }
  ],
  "sequence_intents": ["classification"],
  "constraints": ["Условия применимости"],
  "authoring_risks": ["Типичные ошибки автора"],
  "iterative_system_notes": ["Особенности поведения в комплексах"]
}
```

#### Нормативное правило fixed progression

Если `progression_is_fixed=true`, отчёт и маршруты:

- не формулируют уровни как произвольный выбор пользователя;
- описывают их как части обязательной progression типа (в рамках комплексов).

### 6.7. `authoring_routes`

Маршруты для ручного автора с учётом fixed progression и разных поверхностей использования.

```json
{
  "id": "route_1",
  "title": "Быстрый путь через SEQUENCE (классификация)",
  "route_kind": "complex_progression|manual_practice|microcards_support|hybrid",
  "target_surface": "complexes|editor_manual|microcards|mixed",
  "chunk_ids": ["chunk_1"],
  "unit_ids": [1, 2, 3],
  "steps": [
    {
      "step_id": "route_1_step_1",
      "action_type": "use_task_type_progression",
      "task_type": "SEQUENCE",
      "subtype": null,
      "progression_policy": "full_fixed_progression",
      "sequence_intent": "classification",
      "purpose": "Сначала собрать и структурировать материал",
      "authoring_checklist": [
        "Не добавлять лишние элементы",
        "Не включать порядок уровней, если он не задан в теории"
      ]
    },
    {
      "step_id": "route_1_step_2",
      "action_type": "add_microcards",
      "microcard_mode": "pair_match",
      "purpose": "Добить ассоциативные связи"
    }
  ],
  "effort_estimate": "low|medium|high",
  "expected_effect": "Что именно усилит маршрут",
  "anti_patterns": ["Чего не делать"]
}
```

#### Правила валидации `authoring_routes`

- Нельзя предлагать несуществующие типы/уровни как реализованные.
- До реализации `MATCH` допустим только путь через `microcards` (`pair_match`).
- Для `progression_is_fixed=true` нельзя создавать шаги вида `pick_only_level`.

### 6.8. `coverage_plan`

Назначение: управлять пробелами и дублями покрытия.

```json
{
  "coverage_plan_version": "1.0",
  "target_coverage": {
    "all_units_min_once": true,
    "high_risk_units_priority": true
  },
  "unit_targets": [
    {
      "unit_id": 1,
      "must_cover": true,
      "recommended_surfaces": ["complexes", "microcards"],
      "preferred_task_types": ["TEST", "SEQUENCE"],
      "avoid_overtesting_with": ["CLICK_WORDS"]
    }
  ],
  "chunk_targets": [
    {
      "chunk_id": "chunk_1",
      "route_ids": ["route_1"],
      "max_primary_tasks_recommended": 3
    }
  ]
}
```

### 6.9. `future_capabilities`

Позволяет анализу учитывать будущие режимы без ложной презентации их как уже реализованных.

```json
{
  "capability_id": "pair_matching",
  "display_name": "MATCH (сопоставление пар)",
  "status": "planned|microcards_mvp|implemented",
  "recommended_surface": "microcards",
  "suitability": "high|medium|low",
  "covers_chunk_ids": ["chunk_2"],
  "why": "Почему материал хорошо подходит для pair matching",
  "fallback_now": ["SEQUENCE", "TEST", "OPEN_ANSWER"]
}
```

### 6.10. `microcards_candidates`

Это мост к режиму повторения, а не дубликат `educational_units`.

```json
{
  "candidate_id": "mc_cand_1",
  "unit_id": 3,
  "chunk_id": "chunk_2",
  "card_type": "fact_recall|term_definition|cloze|pair_match|numeric_anchor|contrast_pair",
  "priority": "high|medium|low",
  "prompt_seed": "Короткая заготовка",
  "answer_seed": "Короткая заготовка ответа",
  "anchors": ["...", "..."],
  "author_review_required": true,
  "why": "Почему эта карточка полезна"
}
```

### 6.11. Контракт backend post-processing (обязательный)

Backend обязан:

- валидировать и нормализовать все ids/refs (`unit`, `chunk`, `route`);
- отбрасывать битые ссылки и невалидные enum;
- дедуплицировать повторяющиеся narrative-сигналы;
- запрещать рекомендации, противоречащие fixed progression инварианту;
- преобразовывать некорректные формулировки AI в корректные (или добавлять warning);
- выставлять флаги fallback для renderer-а (`report_lint`).

## 7. Пример `analysis_json v2` (сокращённый)

```json
{
  "analysis_schema_version": "2.0",
  "material_volume": "medium",
  "target_language": "ru",
  "educational_units": [
    {
      "id": 1,
      "title": "Классификация форм X",
      "type": "classification",
      "description": "Студент должен различать 3 группы по признакам.",
      "explicitness": "explicit",
      "evidence": "Три группы перечислены в разделе 2",
      "modality": "text",
      "assessment_risk": "medium",
      "chunk_ids": ["chunk_1"],
      "prerequisite_unit_ids": [],
      "cognitive_ops": ["recognize", "classify"],
      "factual_anchors": [
        { "kind": "term", "value": "Группа A" },
        { "kind": "term", "value": "Группа B" }
      ]
    }
  ],
  "learning_chunks": [
    {
      "id": "chunk_1",
      "title": "Группы и признаки",
      "chunk_type": "classification",
      "goal": "Различать группы по ключевым признакам",
      "unit_ids": [1],
      "common_confusions": ["Путают группы A и B"],
      "factual_anchors": [{ "kind": "term", "value": "признак Y" }],
      "route_ids": ["route_1"],
      "notes_for_author": ["Не смешивать классификацию с лечением"]
    }
  ],
  "future_capabilities": [
    {
      "capability_id": "pair_matching",
      "display_name": "MATCH (сопоставление пар)",
      "status": "planned",
      "recommended_surface": "microcards",
      "suitability": "high",
      "covers_chunk_ids": ["chunk_1"],
      "why": "Группы и признаки хорошо подходят для pair matching",
      "fallback_now": ["SEQUENCE", "TEST"]
    }
  ]
}
```

## 8. Спецификация `report_blocks v1` (структурная "красивая обёртка")

### 8.1. Принцип

`report_blocks` это AST-подобная структура для renderer-а отчёта.

Источник истины:

- факты анализа = `analysis_json`;
- компоновка / навигация / подсветка = `report_blocks`.

При ошибках в `report_blocks` UI обязан иметь fallback-render из `analysis_json`.

### 8.2. Общая форма блока

```json
{
  "id": "rb_001",
  "type": "section|callout|chunk_card|progression_matrix|route_card|coverage_table|microcards_preview|toc|divider|list",
  "anchor": "materials-map",
  "title": "Карта материала",
  "priority": 10,
  "collapsible": false,
  "collapsed_by_default": false,
  "tone": "neutral|info|success|warning|risk",
  "refs": {
    "unit_ids": [1, 2],
    "chunk_ids": ["chunk_1"],
    "route_ids": ["route_1"]
  },
  "body": {},
  "lint": {
    "dedupe_key": "materials-map",
    "max_chars": 600
  }
}
```

### 8.3. Поддерживаемые типы блоков (v1)

#### `toc`

Назначение:

- оглавление;
- быстрый переход по якорям;
- компактный вход в длинный отчёт.

Body:

```json
{
  "items": [
    { "label": "Карта материала", "anchor": "materials-map" },
    { "label": "Типы заданий как прогрессии", "anchor": "type-progressions" }
  ]
}
```

#### `section`

Назначение: секция отчёта с коротким intro.

Body:

```json
{
  "summary": "1-3 коротких предложения",
  "subanchors": ["chunk-cards", "routes"]
}
```

#### `callout`

Назначение: подсветка важного места без визуального перегруза.

Body:

```json
{
  "variant": "tip|warning|risk|note",
  "text": "Короткий сигнал",
  "bullets": ["Опционально, до 3 пунктов"]
}
```

#### `chunk_card`

Назначение: рабочая карточка одного `learning_chunk`.

Body:

```json
{
  "chunk_id": "chunk_1",
  "show_units": true,
  "show_confusions": true,
  "show_route_links": true
}
```

#### `progression_matrix`

Назначение: показать типы как fixed progression, а не как произвольный выбор уровней.

Body:

```json
{
  "rows": [
    {
      "task_type": "SEQUENCE",
      "suitability": "high",
      "show_level_roles": true,
      "show_iterative_notes": true
    }
  ]
}
```

#### `route_card`

Назначение: показать практический маршрут авторинга.

Body:

```json
{
  "route_id": "route_1",
  "show_checklists": true,
  "show_anti_patterns": true
}
```

#### `coverage_table`

Назначение: показать пробелы и дубли покрытия.

Body:

```json
{
  "mode": "units|chunks|mixed",
  "highlight_gaps": true,
  "highlight_overlaps": true
}
```

#### `microcards_preview`

Назначение: показать кандидатов в микрокарточки (включая `pair_match`).

Body:

```json
{
  "max_items": 8,
  "group_by": "card_type|chunk",
  "show_pair_match_candidates": true
}
```

### 8.4. Анти-графомания (обязательные lint-правила)

Цель: жёстко ограничить повторы и "воду".

#### Лимиты v1

- максимум `3` предложения в `section.summary`;
- максимум `3` bullet в `callout.bullets`;
- максимум `600` символов на narrative-блок (кроме таблиц/структурных списков);
- максимум `2` повторных упоминания одного `unit_id` в narrative без новой информации;
- максимум `1` `route_card` на `route_id`;
- максимум `1` `chunk_card` на `chunk_id` в основном теле отчёта.

#### Проверки `report_lint`

Backend считает и пишет в `report_lint`:

- `verbosity_risk`
- `duplicate_content_signals`
- `fallback_renderer_recommended`

Если риск высокий, renderer может включать compact-mode и скрывать лишние narrative-блоки.

### 8.5. Требования к renderer (v1)

- Оглавление с jump по якорям.
- Сворачиваемые секции.
- Сдержанная цветовая система (`info`, `warning`, `risk`, `success`).
- Чёткое разделение секций:
  - факты анализа,
  - типы как progressions,
  - маршруты,
  - coverage,
  - микрокарточки,
  - future capabilities.
- Fallback-render при невалидном `report_blocks`.

## 9. Спецификация режима микрокарточек (MVP+)

### 9.1. Общий принцип

Микрокарточки это отдельный режим повторения, не тип задания комплекса (на стартовом этапе).

### 9.2. Доменные сущности

#### `Microcard`

```json
{
  "id": "mc_001",
  "schema_version": "1.0",
  "deck_id": "deck_001",
  "analysis_id": "ai_run_...",
  "unit_ids": [3],
  "chunk_ids": ["chunk_2"],
  "card_type": "fact_recall|term_definition|cloze|pair_match|numeric_anchor|contrast_pair",
  "front": { "text": "Вопрос/стимул", "payload": {} },
  "back": { "text": "Ответ/объяснение", "payload": {} },
  "anchors": [
    { "kind": "term|number|date|threshold|name", "value": "..." }
  ],
  "difficulty_hint": "low|medium|high",
  "source_evidence": ["короткие опоры"],
  "created_by": "analysis_auto|user_manual|hybrid",
  "status": "draft|active|suspended|archived"
}
```

#### `Microdeck`

```json
{
  "id": "deck_001",
  "schema_version": "1.0",
  "name": "Название колоды",
  "analysis_id": "ai_run_...",
  "source_material_fingerprint": "sha256:...",
  "target_language": "ru",
  "card_ids": ["mc_001", "mc_002"],
  "settings": {
    "scheduler": "sm2_mvp",
    "new_cards_per_day": 20,
    "max_reviews_per_day": 100
  },
  "meta": {
    "created_at": "2026-02-24T12:00:00Z",
    "updated_at": "2026-02-24T12:00:00Z"
  }
}
```

#### `MicrocardReviewState`

```json
{
  "card_id": "mc_001",
  "schema_version": "1.0",
  "status": "new|learning|review|relearning|suspended",
  "ease": 2.5,
  "interval_days": 0,
  "repetitions": 0,
  "lapses": 0,
  "due_at": "2026-02-24T12:00:00Z",
  "last_reviewed_at": null,
  "last_rating": null,
  "stability_hint": "low|medium|high"
}
```

#### `MicrocardReviewEvent`

```json
{
  "id": "mcrev_001",
  "card_id": "mc_001",
  "session_id": "mcsess_001",
  "reviewed_at": "2026-02-24T12:00:00Z",
  "rating": "again|hard|good|easy",
  "response_time_ms": 4300,
  "was_correct": true,
  "details": {
    "card_type": "pair_match",
    "partial_score": 100.0
  }
}
```

### 9.3. `pair_match` (первая реализация capability `MATCH`)

`pair_match` реализуется как тип микрокарточки.

#### `pair_match` payload

```json
{
  "front": {
    "text": "Сопоставьте элементы",
    "payload": {
      "mode": "pair_match",
      "left_items": [
        { "id": "l1", "text": "Термин A" },
        { "id": "l2", "text": "Термин B" }
      ],
      "right_items": [
        { "id": "r1", "text": "Определение B" },
        { "id": "r2", "text": "Определение A" }
      ],
      "shuffle_right": true
    }
  },
  "back": {
    "text": "Правильные соответствия",
    "payload": {
      "mode": "pair_match_solution",
      "pairs": [
        { "left_id": "l1", "right_id": "r2" },
        { "left_id": "l2", "right_id": "r1" }
      ],
      "explanations": [
        { "left_id": "l1", "text": "Короткое пояснение" }
      ]
    }
  }
}
```

#### Ограничения `pair_match` (MVP)

- 2-5 пар на карточку;
- без many-to-many;
- без мультимодальности на MVP;
- без альтернативных эквивалентных ключей на MVP.

### 9.4. Источники карточек

Кандидаты создаются из:

- `microcards_candidates` (`analysis_json v2`);
- ручного выбора unit/chunk;
- гибридного режима (AI seed + правка пользователя).

### 9.5. Интеграция с отчётом анализа

Отчёт должен позволять:

- создать колоду из всего анализа;
- создать колоду по `chunk`;
- добавить отдельный `unit`;
- отдельно создать `pair_match` карточки для `pair_matching` capability.

## 10. Обновлённая логика анализа (fixed progression)

### 10.1. Что анализ рекомендует теперь

Анализ рекомендует не "тип + выбранный уровень", а:

- пригодность типа как fixed progression;
- роль уровней внутри progression;
- практические маршруты по поверхностям:
  - `complexes`
  - `editor_manual`
  - `microcards`

### 10.2. Что выбирает пользователь

Пользователь выбирает:

- включать ли тип в рабочую стратегию;
- какие chunks/units приоритетны;
- идти ли через комплексы, ручной редактор, микрокарточки или гибридно.

Пользователь не выбирает произвольную progression уровней в рамках логики комплексов.

### 10.3. Как учитывать `MATCH` до реализации как типа заданий

Если chunk подходит для matching:

- анализ добавляет `future_capabilities` entry с `capability_id=pair_matching`;
- отчёт показывает fallback-путь на текущих типах;
- после внедрения микрокарточек добавляет прямой путь `pair_match`.

## 11. Обновлённый phased roadmap (P0-P13)

### P0. Починка и стабилизация системы сложности (blocker)

**Цель**: привести `DifficultyManager` в соответствие с реальной логикой типов.

**Acceptance criteria**:

- `sequence_assembly` не уходит в fallback при enhancement;
- `TEST` уровни соответствуют логике evaluator;
- контракт `DifficultyManager -> evaluator -> UI` покрыт тестами.

### P1. Capability Matrix + каноника fixed progression

**Цель**: создать единый реестр возможностей и ролей типов.

**Acceptance criteria**:

- backend валидирует рекомендации анализа против matrix;
- отчёт показывает роли уровней как fixed progression;
- `pair_matching` присутствует как `planned` capability.

### P2. `analysis_json v2` schema + normalizer

**Цель**: расширить анализ до practically useful структуры.

**Acceptance criteria**:

- backward compatibility с текущим UI сохранена;
- новые поля валидируются и нормализуются;
- broken refs не ломают анализ.

### P3. Prompt update (анализ как практические маршруты)

**Цель**: перестроить анализ с "голых типов" на маршруты и progression semantics.

**Acceptance criteria**:

- AI не предлагает несуществующие типы/уровни как реализованные;
- `SEQUENCE` чаще получает корректный `sequence_intent`;
- `pair_matching` отражается в `future_capabilities`.

### P4. Backend post-processing v2 + anti-grafomania lint

**Цель**: сделать результат устойчивым, компактным, пригодным для renderer-а.

**Acceptance criteria**:

- невалидные `report_blocks` не ломают ответ;
- повторы снижаются (lint);
- fallback renderer flags выставляются корректно.

### P5. Отдельный режим "Анализ теории"

**Цель**: вынести анализ из импортёра в самостоятельную ценность.

**Acceptance criteria**:

- анализ запускается без генерации/импорта;
- есть список/повторное открытие анализов (`ai_run_id`);
- текущий импортёр продолжает работать как раньше.

### P6. UX "Открыть/Свернуть отчёт" (вместо pin-панели)

**Цель**: удобный доступ к отчёту без постоянного перекрытия редактора.

**Acceptance criteria**:

- быстрый open/collapse;
- сохраняется состояние редактора и позиция в отчёте;
- нет UI-перегруза.

### P7. Красивый renderer отчёта (`report_blocks v1`)

**Цель**: функционально удобный и сдержанно красивый отчёт.

**Acceptance criteria**:

- TOC / anchors / collapse работают;
- mobile/desktop читаемость соблюдена;
- fallback-render работает при битом layout.

### P8. Связка отчёта с ручным редактором (coverage / grounding)

**Цель**: сделать отчёт рабочим инструментом автора.

**Acceptance criteria**:

- можно привязать задание к `unit/chunk`;
- видны пробелы и дубли покрытия;
- показываются мягкие warnings по слабому grounding.

### P9. Микрокарточки (отдельный режим) + `pair_match`

**Цель**: реализовать режим повторения и первую реализацию capability `MATCH`.

**Acceptance criteria**:

- можно создать колоду из анализа;
- `pair_match` работает;
- состояние повторения сохраняется;
- отчёт умеет создавать колоды/поднаборы.

### P10. Секция "Типы как progressions" (переформулированный)

**Цель**: явно показать fixed progression уровней типов.

**Acceptance criteria**:

- отчёт не формулирует уровни как произвольный выбор;
- пользователь понимает роль уровней в комплексах.

### P11. Практические маршруты авторинга (complexes/manual/microcards)

**Цель**: дать пользователю конкретные действия, а не абстрактные советы.

**Acceptance criteria**:

- по отчёту можно реально действовать без додумывания;
- маршруты содержат чеклисты, anti-patterns и оценку усилий.

### P12. Quality gates, safety, regression shield (расширенный)

**Цель**: защитить почти готовый проект от регрессий.

**Acceptance criteria**:

- feature flags закрывают фичи по отдельности;
- схемы версионированы;
- старые сценарии анализа/импорта не ломаются;
- ошибка renderer-а не ломает базовый анализ.

### P13. Rollout поэтапно + миграционная стратегия

**Цель**: безопасно включать функциональность и иметь путь отката.

**Acceptance criteria**:

- каждый этап можно откатить без потери данных;
- telemetry позволяет оценивать качество rollout.

## 12. P12+ Детализированная стратегия качества и защиты

### 12.1. Feature Flags (обязательные)

Рекомендуемые флаги:

- `analysis_v2_schema`
- `analysis_report_blocks_v1`
- `analysis_report_renderer_v1`
- `editor_analysis_report_link`
- `analysis_coverage_in_editor`
- `microcards_mode`
- `microcards_pair_match`

Требование:

- отключение флага не ломает базовый анализ и текущий импортёр.

### 12.2. Версионирование схем

Обязательные поля версий:

- `analysis_schema_version`
- `report_blocks_version`
- `schema_version` у сущностей микрокарточек

Требование:

- backend читает legacy анализ и v2 анализ с отсутствующими необязательными полями.

### 12.3. Типы тестов (обязательные)

#### Unit tests

- normalizer `analysis_json v2`;
- validator `report_blocks`;
- anti-grafomania lint;
- capability matrix validator;
- route validator;
- scheduler переходы;
- `pair_match` scoring.

#### Integration tests

- `ai/analyze -> normalize -> persist -> reopen`;
- `analysis -> report renderer -> TOC navigation`;
- `analysis -> editor link -> attach unit/chunk`;
- `analysis -> microcards deck -> review session`.

#### Regression tests

- длинные материалы (chunked fallback);
- невалидный `report_blocks`;
- раздутый/повторяющийся AI output;
- mixed language;
- материалы с visual content.

#### UI/UX tests

- mobile layout отчёта;
- collapse/expand секций;
- anchor jumps;
- quick open/close из редактора;
- восстановление состояния.

#### Performance tests

- рендер длинного отчёта (50+ blocks);
- открытие отчёта из редактора без заметного лага;
- создание колоды из большого набора кандидатов.

### 12.4. Контрактные гарантии (must not break)

Новые фичи не должны ломать:

- текущий AI-import flow;
- генерацию заданий из анализа;
- существующие типы заданий и их рендеры;
- адаптивную логику комплексов;
- `error_detection` как финализатор.

### 12.5. Observability / telemetry (минимум)

Рекомендуемые метрики:

- доля валидных `analysis_json v2`;
- доля fallback renderer usage;
- средний размер `report_blocks`;
- `duplicate_content_signals` distribution;
- доля анализов с `future_capabilities.pair_matching`;
- создание колод из анализа;
- использование `pair_match`.

## 13. Миграция и совместимость

### 13.1. Совместимость с текущим `analysisResult` UI

Пока новый UI не внедрён:

- текущий импортёр продолжает использовать `educational_units`, `recommendations`, `warnings`;
- v2-поля игнорируются без ошибок.

### 13.2. Совместимость с сохранёнными `ai_run` артефактами

- старые артефакты анализа остаются валидными как legacy;
- при открытии старого анализа UI строит fallback-report;
- апгрейд derived-данных не должен переписывать raw результат анализа.

### 13.3. Обратимость изменений

- `report_blocks` и микрокарточки должны быть отключаемы флагами;
- базовая функция анализа обязана работать без них.

## 14. Немедленные следующие шаги (исполнительский порядок)

### Шаг 1

- P0: исправить `DifficultyManager` и тесты.

### Шаг 2

- Ввести capability matrix v1 и подключить его в post-processing анализа.

### Шаг 3

- Ввести `analysis_json v2` schema + normalizer (backward compatible).

### Шаг 4

- Ввести validator `report_blocks v1` + auto-fallback renderer model.

### Шаг 5

- Реализовать отдельный режим "Анализ теории" (базовый UI), затем красивый renderer, затем связку с редактором, затем микрокарточки.

## 15. Критерий успеха инициативы

Функция считается успешной, если пользователь может:

- загрузить/вставить теоретический материал;
- получить сжатый, структурный, неграфоманский отчёт;
- понять, какие типы подходят как fixed progression;
- использовать отчёт при ручном создании заданий;
- создать пакет микрокарточек (включая `pair_match`) для повторения;
- сделать всё это даже без автогенерации заданий, если захочет.
