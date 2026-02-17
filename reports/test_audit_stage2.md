# Аудит типа задания «Тест» — Стадия 2: Аудит прохождения задания

**Дата**: 2026-02-09  
**Аудитор**: Cascade

---

## 1. Поведение на уровнях сложности

### Какие уровни существуют

| Уровень | Frontend-условие | Backend-условие | Режим UI | Режим оценки |
|---------|-----------------|-----------------|----------|-------------|
| Level 1 | `difficulty < 2` И `!requires_text_input` И `show_options` | `requires_text_input=false` И `show_options=true` | Варианты-кнопки | Сравнение наборов индексов |
| Level 2 | `difficulty >= 2` ИЛИ `requires_text_input` ИЛИ `!show_options` | `requires_text_input=true` ИЛИ `show_options=false` | Текстовое поле | Keyword matching + tolerance |

### Файлы-источники

- **Frontend L2 activation**: `TestUI.web.js:110-118` — `if (difficultyFromTask >= 2) state.isOpenMode = true`
- **Frontend L2 base**: `testui-core.js:44` — `const isOpenMode = requiresTextInput || !showOptions`
- **Backend L2 gate**: `task_evaluator_service.py:5429` — `if requires_text_input or not show_options:`

### 🔴 ДЕФЕКТ D1 — Рассинхронизация Level-2 по difficulty

**Сценарий**: задание с `settings.difficulty = 2`, но `content.requires_text_input = false` и `content.show_options = true` (оба — значения по умолчанию).

| Шаг | Frontend | Backend |
|-----|----------|---------|
| Определение режима | `difficultyFromTask >= 2` → `isOpenMode = true` | `requires_text_input=false, show_options=true` → **Level 1** |
| Пользователь видит | Текстовое поле ввода | — |
| Payload | `{ answers: {}, text_answers: {"0": "Стегновий"} }` | — |
| Оценка | — | Идёт в ветку Level 1, `answers = {}`, возвращает `"❌ Не выбраны ответы"` |

**Текущий риск**: Низкий — все существующие задания имеют `difficulty: 1`. Но это **latent bug**, который сработает при любом повышении сложности в будущем.

**Минимальный фикс**: В backend добавить проверку difficulty из task_data:
```python
# task_evaluator_service.py, строка ~5397
difficulty = 1
if task_data:
    difficulty = task_data.get("settings", {}).get("difficulty", 1)
    if not difficulty:
        difficulty = task_data.get("content", {}).get("difficulty", 1)

if requires_text_input or not show_options or (isinstance(difficulty, (int, float)) and difficulty >= 2):
    # Level 2 path
```

---

## 2. Корректность условий успеха/провала, score, сообщений

### 2.1 Условие успеха

**Оба уровня** (L1 и L2) используют одинаковую формулу:

```python
# task_evaluator_service.py:5506 (L2), :5715 (L1)
success = correct_count == total_count
```

Т.е. **успех = 100% правильных ответов**. Частичный успех НЕ поддерживается.

### 🟡 ДЕФЕКТ D2 — `passing_score` полностью игнорируется

Все задания хранят `content.settings.passing_score: 70` (по умолчанию), но evaluator **никогда не читает это поле**. Grep по `passing_score` в `task_evaluator_service.py` — 0 совпадений.

- **Файл**: `task_evaluator_service.py:5506,5715`
- **Последствие**: Даже при 2 из 3 правильных (66.7%) — задание считается проваленным, хотя порог в task.json = 70%.
- **Влияние на пользователя**: Задание с 5 вопросами и `passing_score: 70` потребует 5/5 вместо ожидаемых 4/5.
- **Минимальный фикс**:
```python
passing_score = content.get("settings", {}).get("passing_score", 100)
success = score >= passing_score  # вместо correct_count == total_count
```

### 2.2 Расчёт score

```python
score = (correct_count / total_count * 100.0) if total_count > 0 else 0.0
```

| Кейс | correct | total | score | success | Корректно? |
|------|---------|-------|-------|---------|-----------|
| Все правильно | 3 | 3 | 100.0 | ✅ | ✅ |
| Частично правильно | 2 | 3 | 66.67 | ❌ | ✅ (по текущей логике) |
| Все неправильно | 0 | 3 | 0.0 | ❌ | ✅ |
| Один вопрос, верно | 1 | 1 | 100.0 | ✅ | ✅ |
| Один вопрос, неверно | 0 | 1 | 0.0 | ❌ | ✅ |
| Нет вопросов | — | 0 | 0.0 | ❌ (early return) | ✅ |

Score рассчитывается **корректно**.

### 2.3 Сообщения пользователю

| Ситуация | Сообщение | Файл:строка | Корректно? |
|----------|----------|-------------|-----------|
| L1 все правильно | `✅ Правильно! 3/3 ответов` | :5717-5718 | ✅ |
| L1 частично | `❌ Проверьте ответы: 2/3 правильных` | :5720 | ✅ |
| L1 нет ответов | `❌ Не выбраны ответы` | :5544 | ✅ |
| L2 все правильно | `✅ Правильно! 3/3 ответов` | :5509 | ✅ |
| L2 частично | `❌ Проверьте ответы: 2/3 правильных` | :5511 | ✅ |
| L2 нет текста | `❌ Введите текстовые ответы` | :5463 | ✅ |
| Нет вопросов | `❌ Нет вопросов в тесте` | :5415 | ✅ |

Сообщения **корректны и информативны**.

### 2.4 Частичные успехи / повторы

**Partial retry** реализован через `failed_subtests`:

1. Evaluator возвращает `details.failed_subtests` — список `{question_id, index}` для неправильных вопросов
   - L1: `task_evaluator_service.py:5724-5731`
   - L2: `task_evaluator_service.py:5514-5522`

2. `AdaptiveSessionManager._handle_test_partial_retry()` сохраняет `session.test_failed_subtests[task_ref] = indices`
   - `adaptive_session_manager.py:773-886`

3. На ретрае `SessionAPI.get_current_task()` фильтрует questions до только проваленных
   - `session_api.py:720-747`
   - `complex_session_controller.py:239-260`

4. С каждой попыткой набор ошибок сужается (перезаписывается текущими ошибками)
   - `adaptive_session_manager.py:886`

**Оценка**: Механизм partial retry **корректен и протестирован** (test_session_api_test_shuffle_submit.py).

### 2.5 Граничные кейсы

| Граничный кейс | Результат | Файл:строка | Корректно? |
|---------------|----------|-------------|-----------|
| Индекс ответа вне диапазона | Фильтруется в `valid_user_indices`, если пусто → `unanswered` | :5639-5662 | ✅ |
| Ответ как строка-число `"2"` | Парсится через `isdigit()` | :5595 | ✅ |
| Ответ как `answer_0` prefix | Парсится через split | :5599-5605 | ✅ |
| Ответ как текст варианта | Fuzzy match по `text.strip().lower()` | :5607-5616 | ✅ |
| Multiple choice: лишний выбор | `set(user) != set(correct)` → incorrect | :5668-5671 | ✅ |
| Multiple choice: неполный выбор | `set(user) != set(correct)` → incorrect | :5668-5671 | ✅ |
| Single choice: два клика | Frontend хранит только один число-индекс | question.js:544-549 | ✅ |
| Пустой text_answer (L2) | `user_text.strip()` → `not_answered` | :5480-5488 | ✅ |
| qid как int vs str | Нормализация через `str(k)` + fallback по int | :5560-5568 | ✅ |
| Shuffle + submit | Обратный маппинг в `_normalize_test_answers_from_shuffle` | session_api.py:767-880 | ✅ |
| Shuffle + feedback | `per_question_ui` ремаппится в shuffled координаты | session_api.py:882-996 | ✅ |

---

## 3. Расхождения frontend payload vs backend ожидания

### 3.1 🔴 D1 — Level-2 gate mismatch (описан выше)

### 3.2 🟡 D2 — `passing_score` игнорируется (описан выше)

### 3.3 ⚪ D3 — `demo: true` в payload

**Frontend** (`TestUI.web.js:479`):
```js
return { type: "test", demo: true, questions: questionsList, answers, text_answers: textAnswers };
```

Backend **не читает** поле `demo`. Безвредно, но лишнее.

### 3.4 ⚪ D4 — `questions` в payload избыточны

Frontend отправляет полный массив `questions` в payload. Backend **не использует** его для оценки — берёт questions из `answer_key` или `task_data`. Payload-questions используются только для подсчёта `totalQuestions` во frontend-валидации (`session-controls.js:454`).

### 3.5 ⚪ D5 — `type: "test"` в payload не используется backend

Поле `type` из payload нигде не читается evaluator'ом — тип задания определяется из task_data через session flow.

### Сводная таблица расхождений

| # | Поле | Frontend отправляет | Backend ожидает | Критичность |
|---|------|-------------------|-----------------|-------------|
| D1 | text_answers (при difficulty≥2) | Заполнен | Не читает (идёт в L1) | 🔴 Critical |
| D2 | passing_score | Хранит 70 | Не читает, требует 100% | 🟡 Medium |
| D3 | demo | `true` | Игнорирует | ⚪ Low |
| D4 | questions | Полный массив | Игнорирует | ⚪ Low |
| D5 | type | `"test"` | Игнорирует | ⚪ Low |

---

## 4. Список потенциальных улучшений

### UX

| # | Улучшение | Обоснование | Приоритет |
|---|----------|-------------|-----------|
| U1 | Показывать порог прохождения | Пользователь не знает, сколько нужно ответить правильно для success | Medium |
| U2 | В review mode L2 показывать правильный ответ | Сейчас L2 fallback показывает только correct/incorrect, без эталона | Medium |
| U3 | Индикатор прогресса «X/Y ответов» в header | Есть в sidebar-кнопках, но нет числового итога | Low |

### Контракты

| # | Улучшение | Обоснование | Приоритет |
|---|----------|-------------|-----------|
| C1 | Синхронизировать Level-2 gate frontend↔backend (D1) | Предотвратить broken flow при difficulty bump | High |
| C2 | Имплементировать `passing_score` в evaluator (D2) | Задания уже хранят порог, но он не работает | High |
| C3 | Убрать `demo: true` из payload (D3) | Чистота контракта | Low |
| C4 | Не отправлять `questions` в payload (D4) | Уменьшить размер запроса | Low |

### Устойчивость

| # | Улучшение | Обоснование | Приоритет |
|---|----------|-------------|-----------|
| R1 | Добавить unit-тест: difficulty=2 + L2 evaluation | Покрыть D1 после фикса | High |
| R2 | Добавить unit-тест: passing_score < 100% | Покрыть D2 после фикса | High |
| R3 | Добавить contract-тест: payload schema validation | Ловить будущие расхождения | Medium |

---

## Итог Стадии 2

**Общая оценка**: Runtime-прохождение теста работает **корректно для текущих данных** (все задания — difficulty 1, passing_score не задействован). Однако обнаружены **2 значимых дефекта** (D1, D2) и **3 косметических** (D3-D5), которые станут проблемами при расширении функциональности.

| Дефект | Критичность | Текущее влияние | Будущее влияние |
|--------|-------------|-----------------|-----------------|
| D1: L2 gate mismatch | 🔴 Critical | Нет (difficulty=1) | Broken flow |
| D2: passing_score ignored | 🟡 Medium | Требует 100% вместо 70% | Некорректная оценка |
| D3: demo:true | ⚪ Low | Нет | Шум в данных |
| D4: questions в payload | ⚪ Low | Нет | Лишний трафик |
| D5: type в payload | ⚪ Low | Нет | Нет |
