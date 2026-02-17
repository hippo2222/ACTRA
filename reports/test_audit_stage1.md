# Аудит типа задания «Тест» — Стадия 1: Введение в домен и контракт

**Дата**: 2026-02-09
**Аудитор**: Независимый инженер-аудитор (Cascade)
**Тип задания**: `test` (Тест)

---

## 1. Пользовательская цель задания типа «Тест»

Тип задания «Тест» предоставляет квиз-подобный опыт: пользователю показывается набор вопросов с вариантами ответов. Для каждого вопроса пользователь выбирает один или несколько правильных вариантов (Level 1 — multiple choice) либо вводит текстовый ответ (Level 2 — open mode при difficulty ≥ 2). После ответа на все вопросы пользователь отправляет тест на проверку и получает детальную обратную связь по каждому вопросу.

---

## 2. Карта потока данных

### 2.1 Editor UI → API сохранения → storage/task.json

```
TestEditor (frontend/Editor/test_editor.js)
  │  Внутренний формат: questions[].options[].is_correct
  │
  ├─ buildBackendContent()  — конвертирует options→answers, is_correct→correct
  ├─ buildTaskData()        — оборачивает в task.task_data.content
  │
  ▼
POST /api/editor/task/{module}/{topic}/{task}   (server.py:1171)
  │
  ▼
StorageService.save_task()                       (storage_service.py:837)
  ├─ _copy_images_to_task_dir()                  — копирует изображения вопросов/ответов
  ├─ TaskData.from_dict(payload)                 — валидация через Pydantic (TestTaskContent)
  ├─ TaskIO.save(task_data_obj, path)            — атомарная запись task.json
  │    └─ Удаляет лишние поля из content: 'type', 'image' (task_io.py:159-168)
  └─ _ensure_task_registered_in_module()         — обновляет module.json
```

### 2.2 Runtime UI payload → TaskEvaluatorService → result/message/details

```
TestUI.web.js → createRoot(container, task)
  ├─ TestUICore.createInitialState(task)         — парсит task_data.content.questions
  ├─ TestUIQuestion.createQuestionRenderer()     — рендер вопроса + варианты
  ├─ TestUISidebar.renderSidebar()               — навигация по вопросам
  │
  ▼  getUserAnswerPayload()
  { type: "test", demo: true, questions: [...], answers: {qid: [idx,...]}, text_answers: {qid: "..."} }
  │
  ▼
session-controls.js → handleSubmitAnswer()
  ├─ Валидация: все вопросы должны быть отвечены (блокировка кнопки «Проверить»)
  ├─ POST /api/session/{id}/task/submit
  │
  ▼
SessionAPI.submit_answer()                       (session_api.py:998)
  ├─ _normalize_test_answers_from_shuffle()      — обратный маппинг shuffled→original индексов
  ├─ ComplexSessionController.submit_answer()
  │    └─ TaskEvaluatorService.evaluate_task(type="test", user_input, answer_key, task_data)
  │         └─ evaluate_test_task()               (task_evaluator_service.py:5381)
  │              ├─ Level 2 (text): если requires_text_input || !show_options
  │              │    └─ _evaluate_text_answer() по keywords
  │              └─ Level 1 (choice): сравнение selected indices vs correct indices
  │
  ├─ _attach_test_per_question_ui_from_shuffle() — per_question_ui в shuffled координатах
  ▼
EvaluationResult → JSON → frontend
  │
  ▼
TestUI.applyCheckFeedback(result)                — переход в review mode
  ├─ state.mode = "review"
  ├─ state.questionResults = per_question_ui
  └─ перерисовка sidebar + question с цветовой индикацией
```

---

## 3. Контракт полей (вход/выход)

### 3.1 Формат хранения — task.json

```jsonc
{
  "id": "task_005",
  "type": "test",                              // ← обязательно
  "subtype": null,                             // ← опционально (task_009 имеет)
  "meta": {
    "task_schema_version": "1.2",
    "created_at": "ISO datetime",
    "author": "",
    "name": "Название",
    "module": "module_01",
    "topic": "topic_01",
    "modified": null,
    "version": "1.0",
    "id": "task_005"
  },
  "content": {
    "questions": [                             // ← обязательно, min 1
      {
        "id": 0,                               // ← int, уникальный в рамках теста
        "text": "Текст вопроса",               // ← обязательно
        "answers": [                           // ← обязательно, min 2
          {
            "text": "Вариант A",               // ← текст варианта
            "correct": true,                   // ← bool: правильный ли
            "image_path": null                 // ← опционально: изображение варианта
          }
        ],
        "image_path": null,                    // ← опционально: legacy единичное изображение вопроса
        "images": ["file.jpg"],                // ← опционально: массив изображений (до 3)
        // Легаси-поля (task_009):
        "options": [...],                      // ← дубликат answers в формате is_correct
        "image": null                          // ← альтернативное имя image_path
      }
    ],
    "test_type": "single_choice" | "multiple_choice",  // ← обязательно
    "settings": {
      "shuffle_questions": true,               // ← перемешивать вопросы
      "shuffle_answers": true,                 // ← перемешивать варианты
      "time_limit": null,                      // ← секунды или null
      "passing_score": 70                      // ← порог прохождения (%)
    }
  },
  "settings": {                                // ← глобальные настройки задания
    "difficulty": 1,
    "time_limit": null,
    "allow_hints": false,
    "tolerancePx": null,                       // ← нерелевантно для test
    "overlapThreshold": null                   // ← нерелевантно для test
  }
}
```

### 3.2 Формат ответа пользователя (frontend → backend)

```jsonc
{
  "type": "test",
  "demo": true,
  "questions": [/* raw questions from task_data */],
  "answers": {                                 // Level 1: question_id → [option_index, ...]
    "0": [1],
    "1": [0, 2]
  },
  "text_answers": {                            // Level 2: question_id → text
    "0": "текстовый ответ"
  }
}
```

### 3.3 Формат результата оценки (backend → frontend)

```jsonc
{
  "success": true,
  "message": "✅ Правильно! 3/3 ответов",
  "score": 100.0,
  "metric": "percent",
  "details": {
    "correct_count": 3,
    "total_count": 3,
    "question_results": [                      // внутренние результаты (original indices)
      { "question_id": "0", "correct": true, "user_answer": 1 },
      { "question_id": "1", "correct": false, "user_answer": [0,2], "correct_answer": 0 }
    ],
    "per_question": {                          // Level 1: UI feedback (original indices)
      "0": { "status": "correct", "correct_option_ids": [1], "user_option_ids": [1] },
      "1": { "status": "incorrect", "correct_option_ids": [0], "user_option_ids": [0,2] }
    },
    "per_question_ui": {                       // если shuffle: то же, но в shuffled координатах
      "0": { "status": "correct", ... }
    },
    "level": 1,                                // 1 = choice, 2 = text
    "failed_subtests": [                       // для partial retry
      { "question_id": "1", "index": 1 }
    ]
  }
}
```

### 3.4 Pydantic-модели (task_system/core/models/)

| Модель | Файл | Назначение |
|--------|-------|-----------|
| `TestTaskContent` | task_models.py:548 | Валидация content при сохранении |
| `TestQuestion` | task_models.py:523 | Валидация отдельного вопроса |
| `TestOption` | task_models.py:513 | Валидация варианта ответа |
| `TestTaskAnswerKey` | answer_key_models.py:182 | Модель answer_key (correct_answers: Dict[str,int]) |
| `TestTask` | models/test_task.py:38 | Runtime-модель (dataclasses) |
| `TestEvaluator` | models/test_evaluation.py:22 | Standalone evaluator (не используется в web path) |

---

## 4. Подтипы и режимы

### 4.1 По test_type (хранится в content.test_type)

| test_type | Описание | Кол-во правильных ответов |
|-----------|----------|--------------------------|
| `single_choice` | Один правильный ответ на вопрос | Ровно 1 |
| `multiple_choice` | Несколько правильных ответов | ≥ 1 |

**Важно**: `TestEvaluator` (models/test_evaluation.py) также поддерживает `image_choice` (строка 101), но основной `TaskEvaluatorService.evaluate_test_task()` этот подтип не обрабатывает — он работает одинаково для single/multiple choice, сравнивая наборы индексов.

### 4.2 По уровню сложности (runtime)

| Уровень | Условие активации | Режим UI | Оценка |
|---------|-------------------|----------|--------|
| Level 1 | difficulty=1 (default), show_options=true | Варианты ответов (кнопки) | Сравнение индексов |
| Level 2 | difficulty≥2 OR requires_text_input OR show_options=false | Текстовое поле | Keyword matching с толерантностью |

### 4.3 Shuffle (перемешивание)

- **shuffle_questions**: перемешивает порядок вопросов
- **shuffle_answers**: перемешивает порядок вариантов внутри каждого вопроса
- Permutation сохраняется в `session.test_shuffle[task_ref@iteration]` для стабильности в рамках итерации
- При submit: `_normalize_test_answers_from_shuffle()` маппит shuffled indices → original
- При feedback: `_attach_test_per_question_ui_from_shuffle()` добавляет `per_question_ui` в shuffled координатах

---

## 5. Предварительные наблюдения (потенциальные дефекты для проверки на следующих стадиях)

| # | Наблюдение | Файл | Риск |
|---|-----------|------|------|
| O1 | `_normalize_answer_key` не имеет ветки для type="test" — answer_key возвращается as-is | storage_service.py:120-246 | Низкий — evaluator читает из task_data напрямую |
| O2 | `TestTaskAnswerKey` (correct_answers: Dict[str,int]) не используется evaluator'ом | answer_key_models.py:182 | Средний — мёртвый контракт |
| O3 | task_009 содержит дубликат `options` + `answers` в каждом вопросе | task_009/task.json | Низкий — лишний вес, evaluator использует answers |
| O4 | `_copy_images_to_task_dir` не обрабатывает `questions[].images[]` (массив) | storage_service.py:1237-1252 | **Высокий** — изображения в images[] не копируются |
| O5 | Frontend payload всегда содержит `demo: true` | TestUI.web.js:479 | Средний — может мешать аналитике |
| O6 | `TestTaskContent.test_type` validator отклоняет всё кроме single/multiple_choice | task_models.py:593-598 | Низкий — `image_choice` не может быть сохранён |
| O7 | Два дублирующих `captureState()` метода в test_editor.js (строки 274 и 1150) | test_editor.js | **Средний** — второй перезаписывает первый, разное поведение |
| O8 | Два дублирующих `restoreState()` метода в test_editor.js (строки 283 и 1161) | test_editor.js | **Средний** — второй перезаписывает первый |

---

**Стадия 1 завершена.** Переходим к Стадии 2: Аудит прохождения (runtime frontend + backend evaluator).
