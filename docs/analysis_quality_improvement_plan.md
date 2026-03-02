# План улучшения качества AI-анализа

## Контекст

Документ основан на:

- спецификации `analysis_theory_v2_spec.md` (sections 2-8, 10);
- результатах живого тестирования на 3 файлах (25-343.pdf, Nephr.pdf, VMleuko.docx);
- текущем состоянии промпта (`ANALYSIS_V2_ROUTES_ADDENDUM`) и нормализатора (`analysis_schema_v2.py`).

Провайдеры тестирования: Gemini 2.5 Flash (основной), OpenRouter Trinity Large Preview (fallback).

---

## A. Критические проблемы (блокеры качества)

### A1. Определение языка: украинский определяется как русский

**Файл**: `ai_generation_service.py`, функция `_guess_target_language` (строка ~1125)

**Проблема**: Функция считает все кириллические символы русскими. Украинский текст (VMleuko.docx) получает `target_language="ru"`. При генерации заданий промпт попросит AI писать на русском вместо украинского.

**Текущая логика**:
```python
cyr = sum(1 for ch in material if "а" <= ch.lower() <= "я" or ch.lower() == "ё")
if cyr > lat * 1.3:
    return "ru"
```

**Решение**: Добавить эвристику различения `uk` / `ru` по характерным буквам:
- Украинские уникальные: `і`, `ї`, `є`, `ґ`
- Русские уникальные: `ы`, `э`, `ё`, `ъ`

```python
ua_chars = sum(1 for ch in material if ch.lower() in "іїєґ")
ru_chars = sum(1 for ch in material if ch.lower() in "ыэёъ")
if cyr > lat * 1.3:
    if ua_chars > ru_chars * 1.5:
        return "uk"
    return "ru"
```

**Также**: Добавить `uk` в документацию промпта — сейчас `target_language` описан как `"usually ru, en, or mixed"`, нужно добавить `uk`.

**Приоритет**: 🔴 Критический — задания генерируются на неправильном языке.

---

### A2. Промпт не содержит Capability Matrix

**Файл**: `ai_generation_service.py`, `ANALYSIS_V2_ROUTES_ADDENDUM` (строка ~566)

**Проблема**: Спецификация (раздел 5) определяет каноническую Capability Matrix с точными ролями уровней, статусами реализации и complex_role для каждого типа. Однако промпт не передаёт эту матрицу AI — модель вынуждена "угадывать" структуру системы из разрозненных инструкций.

**Следствия** (наблюдаемые в тестах):
- Gemini правильно угадал `progression_is_fixed=true` для core типов, но OpenRouter не всегда
- `level_role_map` иногда содержит неточные описания ролей уровней
- `complex_role` для CLICK_TEXT/CLICK_WORDS иногда неверный
- `CLICK` (обычный) и `DRAW` вообще не упоминаются в промпте, хотя есть в матрице

**Решение**: Встроить в промпт компактную версию Capability Matrix как JSON-блок внутри `<capability_matrix_v1>` тега. AI должен использовать его как нормативный справочник, а не пытаться вывести структуру из инструкций.

```
<capability_matrix_v1>
[
  {"task_type":"TEST","implementation_status":"implemented_complex_type","progression_is_fixed":true,
   "supported_levels":[1,2],"complex_role":"core",
   "level_roles":{"1":"Multiple choice: распознавание/проверка фактов","2":"Text answer: воспроизведение/извлечение ответа"}},
  {"task_type":"OPEN_ANSWER","implementation_status":"implemented_complex_type","progression_is_fixed":true,
   "supported_levels":[1],"complex_role":"core",
   "level_roles":{"1":"Развернутый ответ: объяснение, причинно-следственные связи"}},
  {"task_type":"SEQUENCE","implementation_status":"implemented_complex_type","progression_is_fixed":true,
   "supported_levels":[1,2,3],"complex_role":"core",
   "intents":["ordering","classification","hierarchy","ranking","grouping"],
   "level_roles":{"1":"Сборка структуры/распределение элементов","2":"Сборка + называние уровней","3":"Сборка + называние уровней и блоков"}},
  {"task_type":"CLICK","implementation_status":"implemented_complex_type","progression_is_fixed":true,
   "supported_levels":[1,2,3],"complex_role":"core",
   "level_roles":{"1":"Распознавание/нахождение","2":"Распознавание + называние","3":"Обводка + называние"}},
  {"task_type":"DRAW","implementation_status":"implemented_complex_type","progression_is_fixed":true,
   "supported_levels":[1,2],"complex_role":"core",
   "level_roles":{"1":"Обводка/пространственное распознавание","2":"Обводка + называние"}},
  {"task_type":"CLICK_TEXT","subtype":"error_detection","implementation_status":"implemented_complex_type",
   "complex_role":"finisher_special","modes":["text_choice"]},
  {"task_type":"CLICK_WORDS","subtype":"error_detection","implementation_status":"implemented_complex_type",
   "complex_role":"finisher_special","modes":["text_errors"]},
  {"capability_id":"pair_matching","task_type":null,"implementation_status":"planned",
   "first_target":"microcards.pair_match","complex_role":"none"}
]
</capability_matrix_v1>
```

**Инструкция для AI**: "Используй `capability_matrix_v1` как единственный нормативный источник для `type_progression_suitability`. Не придумывай типы, уровни или роли, которых нет в матрице."

**Приоритет**: 🔴 Критический — без матрицы AI гадает о структуре системы.

---

### A3. Chunked fallback теряет v2-поля

**Файл**: `ai_generation_service.py`, функция `_merge_chunk_analysis_payloads` (строка ~1697)

**Проблема**: При chunked analysis fallback мержер объединяет только legacy-поля (`educational_units`, `recommendations`, `not_recommended`, `warnings`, `illustrations_*`). Все v2-поля (`learning_chunks`, `type_progression_suitability`, `authoring_routes`, `coverage_plan`, `future_capabilities`, `microcards_candidates`, `report_blocks`) **полностью теряются**.

**Наблюдаемые последствия**:
- Nephr.pdf (chunked): TPS содержит только данные, восстановленные нормализатором из recommendations — без `level_role_map`, с `progression_is_fixed=false`
- learning_chunks восстанавливаются эвристикой нормализатора, но без `common_confusions`, `notes_for_author`, `route_ids`

**Решение** (двухэтапное):

**Этап 1 — мерж v2-полей из чанков**:
- Мержить `learning_chunks` с ремаппингом `unit_ids` через `chunk_local_to_global`
- Мержить `type_progression_suitability` с дедупликацией по `task_type` (брать entry с наивысшим `suitability`)
- Мержить `future_capabilities` с дедупликацией по `capability_id`
- Мержить `microcards_candidates` с ремаппингом `unit_id`/`chunk_id`
- НЕ мержить `report_blocks` и `authoring_routes` — они будут достроены нормализатором после мержа

**Этап 2 — оптимизация промпта для chunk mode**:
- В `ANALYSIS_CHUNK_FALLBACK_ADDENDUM` явно попросить генерировать `type_progression_suitability` и `microcards_candidates` даже для чанков
- Не просить `report_blocks` и `authoring_routes` в chunk mode (они бессмысленны для фрагмента)

**Приоритет**: 🔴 Критический — 30-50% материалов попадают в chunked mode, теряя основные v2-данные.

---

## B. Важные улучшения промпта

### B1. Промпт для `report_blocks` слишком абстрактный

**Файл**: `ai_generation_service.py`, `ANALYSIS_V2_ROUTES_ADDENDUM`, строки 585-593

**Проблема**: Инструкции по `report_blocks` описывают типы блоков списком, но не дают пример структуры. AI-модели (особенно слабые) не генерируют `toc` блок и путают формат `body`.

**Наблюдаемые последствия**:
- 2/3 файлов — нет `toc` блока
- VMleuko.docx (OpenRouter) — нет `report_blocks` вообще
- body-формат не соответствует спеке (спека: `summary`, AI пишет `prose`)

**Решение**: Заменить текстовое описание на компактный JSON-пример с 3-4 блоками, включая обязательный `toc`. Также добавить правило: "Если не можешь сгенерировать полные report_blocks — верни хотя бы `toc` + 1 `section`. Backend достроит остальное."

**Приоритет**: 🟡 Важно — report_blocks нужны для P7 (renderer), но fallback-render работает.

---

### B2. Нет инструкции про `common_confusions` в learning_chunks

**Файл**: `ai_generation_service.py`, `ANALYSIS_V2_ROUTES_ADDENDUM`

**Проблема**: Спецификация (раздел 6.4) требует `common_confusions` и `notes_for_author` в learning_chunks. Промпт не упоминает эти поля. Все тестовые файлы вернули пустые массивы.

**Следствие**: Теряется одна из самых ценных для автора функций — подсказки о типичных ошибках студентов.

**Решение**: Добавить в промпт инструкцию:
```
- In `learning_chunks`, populate `common_confusions` (what students typically mix up) 
  and `notes_for_author` (practical tips for task creation) when inferable from the material.
```

**Приоритет**: 🟡 Важно — повышает практическую ценность для автора.

---

### B3. `microcards_candidates` генерируются непоследовательно

**Файл**: `ai_generation_service.py`, `ANALYSIS_V2_ROUTES_ADDENDUM`

**Проблема**: Промпт упоминает `microcards_candidates` в общем списке v2-полей (строка 570), но не описывает формат и ожидаемое содержание. Результат:
- 25-343.pdf (Gemini): есть, но битые refs (нормализатор их дропнул)
- Nephr.pdf (Gemini, chunked): нет
- VMleuko.docx (OpenRouter): есть 10 кандидатов — модель случайно угадала формат

**Решение**: Добавить конкретную инструкцию с примером:
```
- Include `microcards_candidates` (array) — seeds for flashcard generation.
  Each candidate: { "candidate_id": "mc_1", "unit_id": <int>, "chunk_id": "chunk_N",
    "card_type": "fact_recall|term_definition|cloze|pair_match|numeric_anchor|contrast_pair",
    "priority": "high|medium|low", "prompt_seed": "short question/stimulus",
    "answer_seed": "short answer", "anchors": ["key term/number"],
    "why": "why this card is useful" }
  Prioritize: pair_match for classification/contrast chunks, numeric_anchor for factual data,
  cloze for definitions, term_definition for terminology-heavy chunks.
  Aim for 5-15 candidates depending on material richness.
```

**Приоритет**: 🟡 Важно — блокер для P9 (microcards mode).

---

### B4. `coverage_plan` не описан в промпте

**Файл**: `ai_generation_service.py`, `ANALYSIS_V2_ROUTES_ADDENDUM`

**Проблема**: `coverage_plan` упомянут в списке (строка 570), но формат не описан. Нормализатор (`analysis_schema_v2.py`) строит его эвристически, но без данных от AI он не может определить `avoid_overtesting_with` и `preferred_task_types` per unit.

**Решение**: Не требовать `coverage_plan` от AI — он хорошо строится нормализатором. Но добавить инструкцию:
```
- `coverage_plan` is built by backend; you do not need to generate it. 
  Instead ensure `covers_unit_ids` and `covers_chunk_ids` are populated in 
  `type_progression_suitability` — this is the coverage input.
```

**Приоритет**: 🟢 Низкий — нормализатор справляется.

---

### B5. Промпт не упоминает `CLICK` (обычный) и `DRAW`

**Файл**: `ai_generation_service.py`, `STRUCTURED_ANALYSIS_PROMPT` (строка 327), `<available_task_types>`

**Проблема**: В блоке `<available_task_types>` перечислены только: OPEN_ANSWER, SEQUENCE, TEST, CLICK_TEXT, CLICK_WORDS. Типы `CLICK` (обычный, для визуального распознавания) и `DRAW` (обводка) не упомянуты. Они есть в Capability Matrix (спецификация 5.2), но AI о них не знает.

**Следствие**: AI никогда не рекомендует CLICK и DRAW, даже когда `illustrations_detected=true` и материал содержит визуальный контент (25-343.pdf с 16 маммографическими снимками).

**Решение**: Добавить CLICK и DRAW в `<available_task_types>` с пометкой что эти типы требуют ручного авторинга с изображениями:
```
CLICK — нахождение элементов на изображении. Студент кликает по нужным элементам.
  Подходит для: визуального распознавания, нахождения анатомических структур, указания на элементы схем.
  Внимание: задания этого типа создаются ТОЛЬКО вручную в редакторе (требуются изображения).
  В recommendations не рекомендуй, но в type_progression_suitability укажи пригодность.

DRAW — обводка элементов на изображении. Студент обводит нужные области.
  Подходит для: пространственного распознавания, выделения зон, обводки анатомических структур.
  Внимание: задания этого типа создаются ТОЛЬКО вручную в редакторе (требуются изображения).
  В recommendations не рекомендуй, но в type_progression_suitability укажи пригодность.
```

**Приоритет**: 🟡 Важно — материалы с visual content (как 25-343.pdf) не получают полную карту пригодности типов.

---

## C. Улучшения нормализатора

### C1. Нормализатор не строит `report_blocks` при их отсутствии

**Файл**: `analysis_schema_v2.py`

**Проблема**: Если AI не вернул `report_blocks` (OpenRouter) или вернул неполные (без `toc`), нормализатор валидирует и чистит то что есть, но не генерирует минимальный набор блоков из данных анализа.

**Решение**: Добавить fallback-генерацию `report_blocks` в нормализатор:
1. Если `report_blocks` пусты — построить полный набор из `analysis_json`
2. Если нет `toc` — сгенерировать из существующих секций
3. Минимальный набор: `toc` → `section`(units overview) → `progression_matrix` → `section`(routes)

Это соответствует спецификации раздел 8.1: "При ошибках в report_blocks UI обязан иметь fallback-render из analysis_json" — нормализатор может подготовить данные для fallback.

**Приоритет**: 🟡 Важно — обеспечивает работу renderer'а (P7) независимо от провайдера.

---

### C2. `authoring_routes` generation в нормализаторе — не привязаны к матрице

**Файл**: `analysis_schema_v2.py`, функция автогенерации supplementary routes

**Проблема**: Нормализатор генерирует fallback authoring_routes, но использует hardcoded logic без учёта реальных данных TPS. Маршруты часто содержат generic описания.

**Решение**: Улучшить логику генерации fallback routes — использовать TPS entries с `suitability=high` для построения конкретных маршрутов с конкретными `sequence_intent`, `chunk_ids`, и `progression_policy`.

**Приоритет**: 🟢 Низкий — текущие fallback routes функциональны.

---

## D. Улучшения chunked analysis

### D1. Task count inflation при мерже чанков

**Файл**: `ai_generation_service.py`, `_merge_chunk_analysis_payloads`

**Проблема**: Каждый чанк рекомендует свои задания, и мержер суммирует `count` по типам без нормализации. Nephr.pdf (1595 слов, 2 чанка) получил 50 заданий при рамках ~10-15 для такого объёма.

**Решение**:
1. После мержа рекомендаций — нормализовать общий count по calibration таблице из промпта
2. Формула: `target_tasks = calibrate(total_words, total_units)`
3. Если суммарный count > target * 1.3 — пропорционально сократить

**Приоритет**: 🟡 Важно — 50 заданий для маленького текста смущает пользователя.

---

### D2. Chunk prompt не запрашивает v2-поля

**Файл**: `ai_generation_service.py`, строки 2226-2231

**Проблема**: Chunk fallback prompt включает `ANALYSIS_CHUNK_FALLBACK_ADDENDUM` + `COMPACT_RECOVERY` + `FORMAT_RECOVERY`, но **не включает** `ANALYSIS_V2_ROUTES_ADDENDUM`. Чанки возвращают только legacy-поля.

**Решение**: Создать `ANALYSIS_V2_CHUNK_ADDENDUM` — облегчённую версию v2-промпта, которая запрашивает:
- `type_progression_suitability` (компактно, без authoring_routes)
- `microcards_candidates` (если есть подходящий контент)
- `learning_chunks` (локальные для чанка)
- НЕ запрашивает: `report_blocks`, `authoring_routes`, `coverage_plan` (строятся после мержа)

**Приоритет**: 🟡 Важно — связано с A3.

---

## E. Улучшения для конкретных провайдеров

### E1. OpenRouter: слабые модели пропускают v2-поля

**Проблема**: Бесплатные модели OpenRouter (Trinity Large Preview, Step 3.5 Flash) генерируют меньше educational_units (14 vs 17-22 у Gemini) и чаще пропускают `report_blocks`, `microcards_candidates`.

**Решение**:
1. Для OpenRouter — использовать `ANALYSIS_COMPACT_RECOVERY_ADDENDUM` по умолчанию (меньше полей = выше качество каждого)
2. В fallback chain: если OpenRouter не вернул TPS/chunks — нормализатор должен надёжно восстановить из legacy-данных (уже работает, но нужно проверить edge cases)
3. Не требовать `report_blocks` от OpenRouter — нормализатор построит fallback (см. C1)

**Приоритет**: 🟢 Низкий — OpenRouter используется как fallback.

---

## F. Порядок реализации и статус

### Фаза 1: Критические исправления (блокеры) — ✅ ВЫПОЛНЕНО

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| A1 | Определение uk/ru языка | `ai_generation_service.py` | ✅ Готово |
| A2 | Capability Matrix в промпт | `ai_generation_service.py` | ✅ Готово |
| A3 + D2 | Мерж v2-полей в chunked mode + chunk v2 prompt | `ai_generation_service.py` | ✅ Готово |

### Фаза 2: Важные улучшения промпта — ✅ ВЫПОЛНЕНО

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| B1 | report_blocks пример в промпте | `ai_generation_service.py` | ✅ Готово (в составе A2) |
| B2 | common_confusions инструкция | `ai_generation_service.py` | ✅ Готово (в составе A2) |
| B3 | microcards_candidates формат | `ai_generation_service.py` | ✅ Готово (в составе A2) |
| B4 | coverage_plan инструкция | `ai_generation_service.py` | ✅ Готово (в составе A2) |
| B5 | CLICK и DRAW в available_task_types | `ai_generation_service.py` | ✅ Готово |
| D1 | Task count normalization после мержа | `ai_generation_service.py` | ✅ Готово |

### Фаза 3: Улучшения нормализатора — ✅ ВЫПОЛНЕНО

| # | Задача | Файл | Статус |
|---|--------|------|--------|
| C1 | Fallback report_blocks генерация | `analysis_schema_v2.py` | ✅ Готово |
| C2 | Улучшение fallback authoring_routes | `analysis_schema_v2.py` | ✅ Готово |

### E1. OpenRouter fallback — отложено

Не требует изменений кода: C1 (fallback report_blocks) автоматически закрывает основную проблему OpenRouter.

---

## G. Метрики успеха (проверка после реализации)

Перезапустить `scripts/test_analysis_live.py` на тех же 3 файлах и проверить:

| Метрика | Текущее | Целевое |
|---------|---------|---------|
| target_language VMleuko.docx | `ru` | `uk` |
| TPS progression_is_fixed=true для core типов | 2/3 файлов | 3/3 |
| TPS level_role_map заполнен для core типов | 2/3 | 3/3 |
| microcards_candidates присутствуют | 1/3 | 3/3 |
| report_blocks с toc | 1/3 | 3/3 |
| common_confusions непустые | 0/3 | 2/3+ |
| CLICK/DRAW в TPS при illustrations_detected | 0/1 | 1/1 |
| Task count Nephr.pdf (chunked) | 50 | 10-20 |
| v2 completeness среднее | 88.9% | 95%+ |

## H. Сводка изменений

### `ai_generation_service.py`
- `_guess_target_language`: добавлено различение uk/ru по характерным буквам (і,ї,є,ґ vs ы,э,ё,ъ)
- `ANALYSIS_PROMPT_ADDENDUM`: `target_language` теперь включает `uk`
- `ANALYSIS_V2_ROUTES_ADDENDUM`: полностью переработан — встроена Capability Matrix v1, добавлены форматы microcards_candidates, common_confusions, report_blocks JSON-пример, инструкция по coverage_plan
- `<available_task_types>`: добавлены CLICK и DRAW (visual, manual-only)
- `ANALYSIS_CHUNK_FALLBACK_ADDENDUM`: явно указано какие v2-поля включать/исключать в chunk mode
- `_merge_chunk_analysis_payloads`: добавлен мерж learning_chunks, type_progression_suitability, future_capabilities, microcards_candidates с ремаппингом unit_ids; добавлена нормализация task count после мержа

### `analysis_schema_v2.py`
- `_normalize_report_blocks`: добавлена fallback-генерация report_blocks (toc, sections, progression_matrix, chunk_cards, route_cards) из данных анализа
- `_derive_routes`: использует unit_ids/chunk_ids для заполнения route refs когда type entries не предоставляют covers_unit_ids/covers_chunk_ids
