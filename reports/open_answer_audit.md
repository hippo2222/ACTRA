# Аудит задания «Открытый ответ» (open_answer)

**Дата:** 2026-02-09  
**Стадии:** 1 (домен/контракт) → 2 (runtime-аудит) → 3 (фиксы + тесты)

---

## Стадия 1 — Домен и контракт

- Тип задания: `open_answer`
- Уровней сложности: **1** (только level 1)
- Модель Pydantic: `OpenAnswerTaskContent` — поля `question`, `keywords`, `sample_answers`, `min_length`, `max_length`, `case_sensitive`
- Evaluator: `TaskEvaluatorService.evaluate_open_answer_task`
- Frontend UI: `OpenAnswerUI.web.js`
- Editor: `open_answer_editor.js`
- Нормализация: `_normalize_answer_key` в `storage_service.py`
- Толерантность: `find_keyword_with_tolerance` в `text_tolerance.py`

---

## Стадия 2 — Найденные дефекты (10 шт.)

| #     | Описание                                                                                     | Серьёзность | Файл(ы)                                      |
|-------|----------------------------------------------------------------------------------------------|:-----------:|-----------------------------------------------|
| **D-1**  | `min_keywords` / `require_all_keywords` полностью игнорируются — всегда требуются ВСЕ keywords | 🔴 High     | `task_evaluator_service.py`, `storage_service.py` |
| **D-2**  | `reference_answer` не копируется в answer_key → никогда не возвращается студенту              | 🔴 High     | `storage_service.py`                           |
| **D-3**  | `OpenAnswerUI.restoreInput` не существует → draft-restore тихо падает                        | 🟡 Medium   | `OpenAnswerUI.web.js`, `task-renderer.js`      |
| **D-4**  | Рендеринг keywords/reference/user_answer в `showEvaluationResult` **отсутствует** (заглушка)  | 🔴 Critical | `task-renderer.js`                             |
| **D-5**  | `case_sensitive` игнорируется (всегда `.lower()`) — feature gap, не баг                       | ⚪ Low      | `task_evaluator_service.py`                    |
| **D-6**  | `max_length` не применяется: UI читает из `settings`, данные в `content`                      | 🟡 Medium   | `OpenAnswerUI.web.js`                          |
| **D-7**  | `sequence_matters` regex `\s+` требует СМЕЖНЫХ слов — "kw1 и потом kw2" не пройдёт            | 🔴 High     | `task_evaluator_service.py`                    |
| **D-8**  | Score = 100% при нарушенной последовательности (все слова найдены, порядок неверный)           | 🟡 Medium   | `task_evaluator_service.py`                    |
| **D-9**  | `TaskIO.new_task('open_answer')` не инициализирует `question` (обязательное поле Pydantic)     | 🟡 Medium   | `task_io.py`                                   |
| **D-10** | Check button может остаться `hidden` для open_answer после error_detection                    | 🔴 High     | `task-renderer.js`                             |

**D-5 отложен** — требует дизайн-решения и не влияет на текущие задания (все используют case_sensitive=false).

---

## Стадия 3 — Реализованные фиксы

### Fix D-1: min_keywords / require_all_keywords
**Файлы:** `storage_service.py`, `task_evaluator_service.py`

- `_normalize_answer_key` теперь копирует `min_keywords` и `require_all_keywords` из content в answer_key
- Evaluator: если `require_all_keywords=False` и `min_keywords >= 1`, успех определяется по `found >= min_keywords`
- При `require_all_keywords=True` (по умолчанию) поведение не меняется

### Fix D-2: reference_answer
**Файл:** `storage_service.py`

- `_normalize_answer_key` копирует `reference_answer` из content в answer_key
- Evaluator уже читал `answer_key.get('reference_answer')` — теперь оно там есть

### Fix D-3: restoreInput
**Файл:** `OpenAnswerUI.web.js`

- Добавлен метод `OpenAnswerUI.restoreInput(draft)` — восстанавливает `draft.answer` в textarea и синхронизирует кнопку

### Fix D-4: Рендеринг keywords/reference/user_answer
**Файл:** `task-renderer.js` → `showEvaluationResult()`

- Для `open_answer` рендерятся: список keywords (зелёные/красные теги ✓/✗), «Ваш ответ», «Эталонный ответ»
- Использует DOM-элементы `result-keywords`, `result-user-answer`, `result-reference`

### Fix D-6: max_length
**Файл:** `OpenAnswerUI.web.js`

- `maxLen` теперь читается из `content.max_length` (приоритет) с fallback на `settings.max_length`

### Fix D-7: sequence_matters regex
**Файл:** `task_evaluator_service.py`

- Regex изменён с `\b kw1 \s+ kw2 \b` на `\b kw1 \b.*?\b kw2 \b`
- Ключевые слова могут быть разделены любыми словами, а не только пробелами

### Fix D-8: Score при нарушенной последовательности
**Файл:** `task_evaluator_service.py`

- Если `sequence_matters=True`, все keywords найдены, но порядок неверный → `score = 0.0` (вместо 100.0). Система комплексов бинарная (правильно/неправильно), частичный балл не поддерживается.

### Fix D-9: TaskIO.new_task
**Файл:** `task_io.py`

- `new_task('open_answer')` теперь инициализирует `question: ""` (обязательное поле Pydantic) наряду с `prompt`

### Fix D-10: Check button visibility
**Файл:** `task-renderer.js` → `renderTask()`

- Добавлена ветка `else if (taskType === "open_answer")` → `checkBtn.classList.remove("hidden")`
- OpenAnswerUI._syncCheckButtonState управляет disabled-состоянием

---

## Тесты

**Файл:** `tests/test_open_answer_audit.py` — **21 новый тест**

| Класс                           | Кол-во | Покрывает     |
|---------------------------------|:------:|---------------|
| TestNormalizeAnswerKeyOpenAnswer | 4      | D-1, D-2      |
| TestEvaluatorMinKeywords         | 5      | D-1           |
| TestSequenceNonAdjacent          | 3      | D-7           |
| TestScoreSequenceFailure         | 3      | D-8           |
| TestEvaluatorReferenceAnswer     | 2      | D-2           |
| TestTaskIONewTask                | 2      | D-9           |
| TestEvaluatorDetailsPayload      | 2      | Payload shape |

**Результат:** 34/34 open_answer-тестов проходят (6 существующих + 7 evaluator + 21 новых). 0 регрессий.

**Предсуществующие сбои** (не связаны с open_answer):
- `test_evaluation_result_score_validation` — EvaluationResult не валидирует score range
- `test_sequence_level_2_with_level_names_correct` — KeyError 'score' в sequence evaluator

---

---

## Стадия 5 — Аудит editor/storage

### Найденные дефекты (4 шт.)

| #       | Описание                                                                                     | Серьёзность | Файл(ы)                        |
|---------|----------------------------------------------------------------------------------------------|:-----------:|--------------------------------|
| **ED-1** | `_copy_images_to_task_dir` не обрабатывает `content.images[]` (массив изображений open_answer) | 🔴 Major    | `storage_service.py`           |
| **ED-2** | Pydantic `OpenAnswerTaskContent` не содержит полей, используемых editor/runtime: `images`, `prompt`, `reference_answer`, `hint`, `min_keywords`, `require_all_keywords`, `sequence_matters` | 🔴 Major    | `task_models.py`               |
| **ED-3** | `buildTaskData()` сохраняет дублирующий `check_sequence` наряду с `sequence_matters`          | ⚪ Minor    | `open_answer_editor.js`        |
| **ED-4** | Import `_save_task_to_storage` создаёт open_answer только с `question` — без keywords/reference | ⚪ Minor    | `server.py`                    |

---

## Стадия 6 — Фиксы editor/storage

### Fix ED-1: `content.images[]` handler
**Файл:** `storage_service.py` → `_copy_images_to_task_dir()`

- Добавлен блок #4: обработка `content.images` (list) — нормализация путей, копирование файлов, формирование `modules/...` путей

### Fix ED-2: Pydantic модель
**Файл:** `task_models.py` → `OpenAnswerTaskContent`

Добавлены поля:
- `images: Optional[List[str]]`
- `prompt: Optional[str]`
- `reference_answer: Optional[str]`
- `hint: Optional[str]`
- `min_keywords: Optional[int]` (ge=1)
- `require_all_keywords: Optional[bool]`
- `sequence_matters: Optional[bool]`

### Fix ED-3: Удаление `check_sequence`
**Файл:** `open_answer_editor.js` → `buildTaskData()`

- Убрана строка `content.check_sequence = this.sequenceMatters;`, оставлен только `content.sequence_matters`

---

## Интеграционные тесты (Stage 6)

**Файл:** `desktop-app/tests/integration/test_editor_api.py` — **3 новых теста**

| Тест                                          | Покрывает |
|-----------------------------------------------|-----------|
| `test_open_answer_save_load_roundtrip`        | ED-2: все поля сохраняются и читаются обратно |
| `test_open_answer_save_copies_images`         | ED-1: `content.images[]` нормализуется на save |
| `test_open_answer_evaluator_reads_saved_data` | Цепочка: save → load → normalize → evaluate |

**Результат:** 34/34 unit-тестов + 10/10 integration-тестов проходят. 0 регрессий.

---

### Fix ED-4: Расширение парсера + import/execute
**Файл:** `task_system/models/parsers/open_answer_parser.py`

Новый формат (обратно совместим):
```
@OPEN_ANSWER
# Текст вопроса
= Эталонный ответ (опционально)
* ключевое_слово_1 (опционально)
* ключевое_слово_2
```

- `=` → `reference_answer` в `data`
- `*` → `keywords[]` в `data`
- Старый формат (только `#`) продолжает работать

**Файл:** `desktop-app/server.py` → `_save_task_to_storage()`

- open_answer теперь сохраняет `question`, `prompt`, `keywords`, `reference_answer`, `max_length`

**Новые тесты:**
- `tests/unit/test_task_import_parsers.py` — 4 теста (keywords, reference, full format, backward compat)
- `desktop-app/tests/integration/test_editor_api.py` — `test_open_answer_import_execute_with_keywords`

---

## Итоги

| Метрика | Значение |
|---------|----------|
| Runtime дефектов (D-1..D-10) | 10 найдено, 9 исправлено, 1 отложен (D-5) |
| Editor дефектов (ED-1..ED-4) | 4 найдено, 4 исправлено |
| Unit-тесты | 34/34 pass |
| Integration-тесты | 11/11 pass |
| Parser-тесты | 8/8 pass |
| Регрессии | 0 |

## Что отложено

| Пункт | Описание | Статус |
|-------|----------|--------|
| D-5   | case_sensitive поддержка в evaluator | Закрыто: решено НЕ реализовывать (deprecated). Все задания используют false, tolerance несовместим с case-sensitive |
