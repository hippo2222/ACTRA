# Analysis-Driven Generation Session Plan

## Summary

Цель: перестроить режим `Анализ материала` из тупикового консультационного шага в управляющий слой для всей последующей генерации заданий.

Вместо текущего сценария:

`анализ -> пользователь читает отчёт -> вручную выбирает тип -> начинает новую генерацию почти с нуля`

нужен сценарий:

`analysis session -> карта покрытия -> генерация выбранного типа с контекстом анализа -> preview/import -> возврат в карту покрытия -> следующий тип`

Главный принцип: результат анализа должен не просто отображаться пользователю, а активно влиять на prompt-ы, парсинг, метаданные импорта и навигацию между экранами.

## Problem Statement

Текущий manual/external AI flow даёт пользователю полезный отчёт, но почти не использует его дальше:

- анализ показывает рекомендации по типам;
- пользователь выбирает один тип;
- дальше система переключает prompt на генерацию этого типа;
- сам отчёт не влияет на следующий prompt достаточно глубоко;
- после импорта первого batch не возникает устойчивой сессии покрытия материала;
- пользователь не видит, что уже покрыто, что импортировано, и что ещё осталось.

Итог: analysis mode ощущается как отдельный, но не встроенный в продукт шаг.

## Product Goal

Сделать единый пользовательский сценарий, где:

- анализ создаёт карту покрытия материала;
- рекомендации становятся рабочим планом генерации;
- каждый следующий batch заданий строится на основе уже выделенных `educational_units`;
- после каждого импорта система сохраняет прогресс покрытия;
- пользователь может пройти по нескольким типам заданий в одной сессии, не теряя контекст.

## Target User Flow

### Screen 1. Material Input

Пользователь:

- выбирает модуль и тему;
- вставляет материал или загружает файл;
- запускает анализ.

Система:

- создаёт `analysis session`;
- получает `analysis_result`;
- сохраняет исходный материал и fingerprint;
- переводит пользователя на экран карты покрытия.

### Screen 2. Coverage Map

Экран должен показывать:

- краткое summary материала;
- образовательные единицы;
- рекомендации по типам заданий;
- для каждого типа:
  - `priority`
  - `count`
  - `covers_units`
  - `coverage_role`
  - `count_rationale`
  - статус:
    - `not_started`
    - `draft_generated`
    - `imported`
    - `manual_only`
    - `skipped`

Действия пользователя:

- `Сгенерировать этот тип`
- `Открыть черновик`
- `Пропустить`
- `Пометить как ручной`

После каждого успешного импорта пользователь возвращается именно на этот экран.

### Screen 3. Generation Workspace For One Type

Экран генерации конкретного типа должен показывать:

- выбранный тип;
- count;
- какие `educational_units` входят в текущий batch;
- что уже покрыто предыдущими batch-ами;
- чего желательно избежать, чтобы не было дублирования;
- prompt для внешнего ИИ или кнопку запуска внутреннего ИИ.

Важно: этот экран уже не должен быть “нулевым стартом”. Он обязан строиться на `analysis session`.

### Screen 4. Parse Preview And Import

Пользователь:

- вставляет ответ ИИ;
- запускает parse;
- смотрит preview;
- импортирует.

Система:

- сохраняет импортированные задачи в тему;
- фиксирует batch в `analysis session`;
- обновляет coverage;
- возвращает пользователя на `Coverage Map`.

### End State

Когда покрытие достаточно полное, пользователь:

- завершает сессию;
- либо продолжает добавлять новые типы вручную;
- либо возвращается к уже сгенерированным batch-ам.

## Analysis Session Model

Нужна отдельная сущность состояния: `analysis_session`.

Минимальный состав:

```json
{
  "analysis_session_id": "uuid",
  "module_id": "string",
  "topic_id": "string",
  "material_fingerprint": "string",
  "material_stats": {
    "word_count": 0,
    "char_count": 0,
    "language": "ru"
  },
  "analysis_result": {},
  "recommendation_states": [
    {
      "task_type": "TEST",
      "status": "not_started|draft_generated|imported|manual_only|skipped",
      "requested_count": 4,
      "generated_count": 0,
      "imported_count": 0,
      "covers_units": [1, 2, 3]
    }
  ],
  "generated_batches": [
    {
      "batch_id": "uuid",
      "task_type": "TEST",
      "status": "generated|imported|discarded",
      "educational_unit_ids": [1, 2, 3],
      "generated_count": 4,
      "imported_count": 4,
      "created_at": "iso-datetime"
    }
  ],
  "coverage_state": {
    "covered_unit_ids": [1, 2],
    "overcovered_unit_ids": [2],
    "uncovered_unit_ids": [3, 4],
    "coverage_by_type": {
      "TEST": [1, 2],
      "OPEN_ANSWER": [2]
    }
  }
}
```

## Storage Strategy

### Phase 1

Хранить в:

- frontend state внутри `ImportManager`;
- `localStorage` для восстановления после перезагрузки.

### Phase 2

Вынести в backend persistence:

- отдельный session artifact по аналогии с `ai_run_id`;
- возможность reopen существующей `analysis session`;
- возможность получать coverage по уже импортированным batch-ам.

Предпочтительный долгосрочный путь: backend-backed session, а не только local state.

## Prompt Strategy

## Analysis Prompt

Analysis prompt уже достаточно силён, но для downstream generation его стоит расширить дополнительными полями.

### Hard Requirements From Product Feedback

Следующие требования обязательны, иначе analysis снова будет давать “красивый, но бесполезный” отчёт:

- analysis не должен ограничиваться абстрактными формулировками вроде `подходит для unit #4 и #6`;
- если рекомендуется тип, analysis должен давать пользователю понятный мост к реальному заданию в редакторе;
- если рекомендуются визуальные типы, они должны быть привязаны к конкретным изображениям, их номерам, подписям и упоминаниям в тексте;
- analysis должен использовать названия типов так, как их увидит пользователь в редакторе, а не только внутренние технические labels;
- analysis обязан явно рассмотреть каждый доступный тип задания;
- тип можно отклонить только если модель не может предложить хотя бы 2 конкретных, правдоподобных и привязанных к материалу design candidates;
- counts должны определяться по числу проверяемых опор, ловушек, критериев, contrast pairs и figure-grounded anchors, а не чрезмерно консервативным “не раздуть набор”.

### Evaluate Every Task Type, But Do Not Blindly Recommend Every Task Type

Нужна не логика `обязательно рекомендовать все типы`, а логика:

- каждый тип обязан быть рассмотрен отдельно;
- для каждого типа модель должна попытаться найти конкретные сценарии применения;
- отклонение типа допускается только после явной попытки подобрать для него минимум 2 жизнеспособных задания;
- если тип отклонён, причина должна быть конкретной и предметной, а не общей формулой вида `материал не подходит`.

Практически это значит:

- `OPEN_ANSWER`, `SEQUENCE`, `TEST`, `CLICK_TEXT`, `CLICK_WORDS`, `CLICK`, `DRAW` всегда проходят через обязательную suitability-check;
- в output должен появляться явный статус каждого типа:
  - `recommended_auto`
  - `recommended_manual`
  - `conditionally_recommended`
  - `not_recommended`

## Exact Editor-Facing Naming

Analysis должен оперировать не только внутренними кодами типов, но и editor-facing названиями.

Минимально:

- `OPEN_ANSWER` -> `Открытый ответ`
- `SEQUENCE` -> `Последовательность`
- `TEST` -> `Тест (вопросы с вариантами ответов)`
- `CLICK_TEXT` -> `Клик/Ошибки (текстовый выбор)`
- `CLICK_WORDS` -> `Клик/Ошибки (поиск ошибок в тексте)`
- `CLICK` -> `Клик по изображению`
- `DRAW` -> `Рисование на изображении`

Это особенно важно для `CLICK_TEXT` и `CLICK_WORDS`: пользователю нужно сразу понимать, что это один общий family `Клик/Ошибки`, но с разными режимами.

## Visual Task Grounding Requirements

Для `CLICK` и `DRAW` нельзя оставлять рекомендации на уровне:

- `подходит unit #4`
- `можно проверить распознавание`

Если visual type рекомендован, analysis обязан дать конкретный authoring blueprint.

### Required Fields For Visual Recommendations

Для каждой visual recommendation нужны:

- `figure_refs`: номера рисунков / схем / фотографий
- `figure_caption_anchor`: краткая привязка к подписи
- `text_anchor`: где этот рисунок обсуждается в тексте
- `target_objects`: что именно пользователь должен распознать
- `polygon_hint`: что станет полигоном или зоной клика
- `task_stem_example`: пример формулировки задания
- `why_visual`: почему именно без visual format покрытие будет неполным

### Example Of Good Visual Recommendation

Не так:

- `Ротация: выявление искажения анатомии`

А так:

- `Рис. 2.6 и 2.7: задание CLICK — "Кликните на остистый отросток и медиальные концы ключиц, по которым оценивается ротация". Полигон: соответствующие анатомические ориентиры.`
- `Рис. 2.3: задание DRAW — "Обведите область, где при недостаточном проникновении должен просматриваться позвоночник через тень сердца". Полигон: ретрокардиальная зона / ориентир visibility check.`

Только такая степень конкретики превращает analysis в полезную инструкцию для автора задания.

## Count Calibration By Assessable Anchors

Недостаточно считать задания по “объёму материала” или чрезмерно ужимать их ради краткости.

Counts должны строиться по числу assessable anchors:

- диагностические критерии;
- пороговые значения;
- contrast pairs;
- типичные ошибки интерпретации;
- признаки артефакта;
- сопоставления `артефакт vs патология`;
- элементы структуры, пригодные для классификации / иерархии / ранжирования;
- подписи и рисунки, дающие figure-grounded opportunities.

### Implication For This Family Of Materials

На плотном медицинском материале уровня “технические факторы оценки рентгенограммы” analysis не должен схлопываться до:

- `4 TEST на весь параграф`
- `3 CLICK_TEXT`
- `2 OPEN_ANSWER`

Если материал содержит несколько самостоятельных критериев, ловушек и contrast pairs, модель должна смещаться в сторону более богатого покрытия.

## Type-Specific Suitability Corrections

### OPEN_ANSWER

Analysis не должен трактовать `OPEN_ANSWER` как “эссе, которое потом проверит человек”.

Нужно учитывать реальную механику продукта:

- короткий или средний ответ;
- опора на `reference_answer`;
- опора на keywords;
- проверяемые смысловые anchors;
- без свободной интерпретации в формате сочинения.

Следствие:

- `OPEN_ANSWER` подходит для короткого объяснения механизма, различия или диагностической логики;
- analysis должен рекомендовать не “развёрнутые рассуждения”, а конкретные, проверяемые short-answer prompts.

### SEQUENCE

`SEQUENCE` нельзя занижать до “только хронология или алгоритм”.

Для suitability-check нужно активно искать:

- классификацию;
- группировку по допустимым/недопустимым признакам;
- распределение по уровням;
- иерархию ориентиров;
- ранжирование;
- диагностическую логику чтения изображения;
- разбиение факторов по типу искажений.

Если в материале есть таблицы, наборы критериев, противопоставления или image-reading workflow, `SEQUENCE` по умолчанию должен считаться сильным кандидатом.

### TEST

`TEST` не должен сжиматься до нескольких широких вопросов “обо всём”.

Analysis должен стремиться к:

- одному или нескольким вопросам на каждый крупный критерий;
- отдельным вопросам на contrast pairs;
- отдельным вопросам на количественные и визуальные признаки;
- отдельным вопросам на ловушки интерпретации.

### CLICK_TEXT

Analysis должен описывать этот тип не абстрактно, а как:

- `Клик/Ошибки (текстовый выбор)`
- набор конкретных clusters заблуждений;
- какие утверждения будут спутываться;
- за счёт каких формулировок получится правдоподобная ошибка.

### CLICK_WORDS

`CLICK_WORDS` нельзя отбрасывать только потому, что материал не похож на “словарик с датами”.

Если есть:

- точные термины;
- количественные критерии;
- названия проекций;
- анатомические ориентиры;
- фактические подписи к рисункам;
- короткие критерии правильности/неправильности,

то analysis должен как минимум попытаться построить `CLICK_WORDS` на этих anchors.

## Recommendation Output Must Be Actionable

Для каждого рекомендованного типа analysis должен выдавать не только count, но и concrete design candidates.

### Required Per-Type Output Additions

Для каждой рекомендации нужно добавить:

- `editor_label`
- `why_this_type`
- `assessable_anchors`
- `design_candidates`

Где `design_candidates` — это минимум 2 коротких, но конкретных blueprint-а заданий.

### Example Structure

```json
{
  "task_type": "CLICK_TEXT",
  "editor_label": "Клик/Ошибки (текстовый выбор)",
  "count": 6,
  "covers_units": [2, 3, 4],
  "assessable_anchors": [
    "критерий проникновения",
    "критерий вдоха",
    "ошибка интерпретации ротации"
  ],
  "design_candidates": [
    "Набор утверждений о признаках недостаточного вдоха и ложной кардиомегалии",
    "Набор утверждений о том, какие контуры искажает ротация"
  ]
}
```

### New Recommended Fields In Analysis JSON

Для `educational_units`:

- `importance`: `high|medium|low`

Для `recommendations`:

- `generation_focus`: короткая downstream-инструкция для генератора этого типа
- `coverage_strategy`: `breadth_first|high_risk_first|misconception_first|visual_first`
- `recommended_order`: integer

### Why

Эти поля позволят не только отображать отчёт, но и строить следующий шаг генерации более осмысленно:

- что брать раньше;
- на каких unit делать акцент;
- как избегать дублирования;
- какой когнитивный угол важнее именно для этого типа.

## Type-Specific Generation Prompts

Текущие generation prompt-ы уже умеют получать:

- `task_type`
- `count`
- `educational_units`
- `evidence`

Это хорошая база, но для полноценного analysis-driven flow нужно пробрасывать больше контекста.

### Required Additional Context For Generation

В downstream prompt для каждого типа надо передавать:

- `analysis_session_id`
- выбранный `task_type`
- `requested_count`
- выбранные `educational_units`
- `coverage_role`
- `rationale`
- `count_rationale`
- `generation_focus`
- `coverage_strategy`
- `already_imported_batches`
- `already_covered_unit_ids`
- `remaining_uncovered_unit_ids`

### Prompt Intent

Промпт должен говорить не просто:

`Сгенерируй N заданий типа TEST по этому материалу`

а примерно:

`Сгенерируй N заданий типа TEST, используя только перечисленные образовательные единицы и их evidence. Этот batch нужен для проверки точных критериев и различения похожих признаков. Не дублируй уже покрытые OPEN_ANSWER аспекты. Приоритет — breadth по unit, которые ещё не покрыты.`

### Type-Specific Reinforcement

Для каждого типа стоит добавить analysis-aware правила.

#### OPEN_ANSWER

- усиливать explanation-heavy units;
- избегать unit, уже плотно закрытых TEST;
- приоритет сложным и high-risk unit.

#### TEST

- приоритет точным критериям, классификациям, количественным порогам;
- не дублировать conceptual explanation, уже покрытую OPEN_ANSWER.

#### SEQUENCE

- использовать только unit, где analysis явно подтверждает однозначную структуру;
- учитывать `generation_focus` для structure-building, а не просто order.

#### CLICK_TEXT

- усиливать misconception-prone и high-risk unit;
- строить контрасты на основе `assessment_risk` и evidence.

#### CLICK_WORDS

- брать только fact-dense unit;
- опираться на точные anchors из evidence.

## Parser And Metadata Strategy

После генерации и parse нельзя терять связь batch-а с анализом.

Каждому preview/importable task нужно добавлять `ai_meta`:

```json
{
  "analysis_session_id": "uuid",
  "generation_source": "manual_external_ai|internal_ai",
  "task_type": "TEST",
  "educational_unit_ids": [1, 2],
  "coverage_role": "Проверка точных критериев и различений",
  "recommendation_priority": "high",
  "recommendation_order": 2
}
```

Это нужно для:

- построения карты покрытия после импорта;
- определения, какие unit уже реально закрыты задачами;
- избежания бессмысленного повторного покрытия;
- future reopen analysis session.

## Coverage Tracking

Coverage должен считаться не по рекомендациям, а по реально импортированным batch-ам.

### Coverage Rules

- unit считается `covered`, если импортирован хотя бы один task с этим `educational_unit_id`;
- unit считается `well_covered`, если покрыт двумя и более разными task types;
- unit считается `overcovered`, если получил слишком много batch-ов одного и того же когнитивного угла;
- unit остаётся `uncovered`, если был в analysis result, но не попал ни в один импортированный batch.

### UI Signals

На `Coverage Map` нужно показывать:

- покрытые unit;
- непокрытые unit;
- риск дублирования;
- сколько ещё batch-ов стоит сделать.

## Current Codebase Reality

### What Already Exists

В коде уже есть важные строительные блоки:

- `STRUCTURED_ANALYSIS_PROMPT` в `desktop-app/services/ai_generation_service.py`
- type-specific prompts для `OPEN_ANSWER`, `SEQUENCE`, `TEST`, `CLICK_TEXT`, `CLICK_WORDS`
- `_build_generation_prompt(...)`, который уже умеет включать `educational_units` и `evidence`
- internal AI flow в `frontend/Editor/import_manager.js`, где:
  - есть `analysisResult`
  - есть `aiSelectedRecs`
  - generation уже идёт через `tasks_to_generate` + `educational_units`
- `import_execute`, который уже сохраняет сами задачи в тему

### What Is Missing

- единая `analysis session` для manual flow;
- возврат в `Coverage Map` после batch import;
- устойчивые статусы рекомендаций;
- coverage tracking на основе импортированных batch-ов;
- richer downstream prompt context;
- metadata bridge между analysis и imported tasks.

## Frontend Changes

Файл: `frontend/Editor/import_manager.js`

### New State

Добавить:

- `analysisSession`
- `analysisSessionId`
- `analysisRecommendationStates`
- `analysisGeneratedBatches`
- `analysisCoverageState`
- `activeRecommendationTaskType`
- `activeRecommendationUnitIds`

### New Flow

Для manual analysis mode:

- после parse analysis не просто показывать отчёт;
- создавать / восстанавливать `analysis session`;
- переходить в `Coverage Map`;
- при выборе типа открывать generation workspace внутри этой же сессии;
- после import возвращаться в coverage map.

### New Screens Or Substates

Внутри текущей modal step-модели можно добавить submodes:

- `analysis_material_input`
- `analysis_coverage_map`
- `analysis_type_generation`
- `analysis_type_preview`

### Import History Extension

Текущая история импорта в `localStorage` слишком плоская. Её стоит расширить:

- `analysis_session_id`
- `task_type`
- `educational_unit_ids`
- `batch_id`

## Backend Changes

### File: `desktop-app/services/ai_generation_service.py`

Нужно:

- расширить schema анализа новыми optional fields;
- обновить sanitization/normalization;
- расширить `_build_generation_prompt()` дополнительным analysis context;
- добавить unified helper для подготовки generation context из recommendation + session coverage.

### File: `desktop-app/routes/import_routes.py`

Нужно:

- добавить API для создания/обновления/чтения `manual analysis session`;
- поддержать сохранение/import metadata по batch-ам;
- возвращать summary покрытия после успешного import.

### File: `desktop-app/routes/ai_routes.py`

Нужно:

- выровнять manual/external flow с internal AI flow по контракту `tasks_to_generate`;
- разрешить generation context richer than plain `educational_units`;
- сохранять session-aware generation artifact.

## Recommended API Additions

### Parse Analysis

Можно сохранить текущий endpoint, но дополнить response:

- `analysis_session_id`
- `recommendation_states`
- `coverage_state`

### Generate From Recommendation

Новый endpoint или новый payload contract:

```json
{
  "analysis_session_id": "uuid",
  "task_type": "TEST",
  "count": 4,
  "educational_unit_ids": [1, 2, 3],
  "generation_mode": "manual_external_ai|internal_ai"
}
```

### Register Imported Batch

После `import_execute`:

- либо расширить `import_context`;
- либо добавить post-import session update.

`import_context` должен содержать:

```json
{
  "source": "analysis_session",
  "analysis_session_id": "uuid",
  "task_type": "TEST",
  "educational_unit_ids": [1, 2, 3],
  "batch_id": "uuid"
}
```

## Transition Strategy

### Phase 1. Session In Frontend

Сделать быстрый рабочий вариант:

- session живёт во frontend state;
- восстанавливается из `localStorage`;
- coverage считается на клиенте;
- prompt уже обогащается analysis context.

### Phase 2. Persistent Session In Backend

После стабилизации UI:

- вынести session в backend;
- сохранять batch history;
- добавить reopen coverage map по `analysis_session_id`.

### Phase 3. Full Analysis-Driven UX

- несколько batch-ов в одной сессии;
- уверенная coverage visualization;
- suggestions based on uncovered units;
- possible “generate next best type” CTA.

## Acceptance Criteria

Сценарий считается реализованным, когда:

- после анализа пользователь попадает в `Coverage Map`, а не в тупиковый отчёт;
- выбор типа открывает generation flow с analysis-aware context;
- первый импорт не завершает сценарий, а возвращает в coverage map;
- система помнит, что уже импортировано по этой analysis session;
- следующий тип получает prompt с учётом уже покрытых unit;
- imported tasks содержат metadata, связывающую их с analysis session;
- пользователь может пройти по нескольким типам подряд без потери контекста.
- visual recommendations always reference concrete figures and authoring targets;
- analysis output uses editor-facing task names;
- every task type is explicitly evaluated before rejection;
- rejected types are rejected only with concrete insufficiency reasons;
- recommended types contain actionable design candidates, not only abstract unit references.

## Recommended Implementation Order

1. Ввести `analysis session` state в `ImportManager`.
2. Перестроить manual analysis UI в `Coverage Map -> type generation -> import -> back`.
3. Пробросить richer recommendation context в `_build_generation_prompt()`.
4. Добавить import metadata и coverage tracking.
5. Перенести session persistence в backend.
6. Доработать reopen/resume flow.

## Non-Goals For First Iteration

Не обязательно делать в первой версии:

- полноценную серверную аналитику качества покрытия;
- авто-предложение “следующего лучшего типа” на основе сложной эвристики;
- batch merge между manual и internal AI generation;
- сложные отчёты по визуальным типам `CLICK` и `DRAW`.

Главное в первой итерации: analysis должен реально управлять следующими шагами, а не просто красиво отображаться.
