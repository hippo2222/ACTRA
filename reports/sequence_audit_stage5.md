# Стадия 5 — Аудит создания/редактирования/сохранения sequence_assembly

**Дата:** 2025-02-09  
**Статус:** Аудит завершён, найдено 10 дефектов

---

## 1. Обследованные файлы

| Слой | Файл | Назначение |
|------|-------|-----------|
| Editor UI | `frontend/Editor/sequence_editor.js` | Форма редактирования (create/edit) |
| Editor HTML | `frontend/Editor/Sequence Assembly Editor Procedural Steps.html` | Шаблон страницы |
| Base Editor | `frontend/Editor/base_editor.js` | Загрузка/сохранение, undo/redo |
| HTTP Route | `desktop-app/server.py` :1158-1190 | GET/POST `/api/editor/task/...` |
| Storage | `desktop-app/services/storage_service.py` | `save_task`, `load_task`, `_normalize_answer_key` |
| TaskIO | `task_system/core/io/task_io.py` | Атомарная запись task.json |
| TaskData | `task_system/core/models/task_data.py` | Обёртка данных задания |
| Pydantic | `task_system/core/models/task_models.py` :604-651 | `SequenceElement`, `SequenceAssemblyTaskContent` |
| Schema | `task_system/core/schemas/sequence_assembly_schema.py` | Валидация контента |
| Runtime UI | `frontend/SequenceUI/SequenceUI.web.js` | Рантайм отображение + payload |
| Real data | `data/modules/module_01/.../task_004/task.json` | Эталонный task.json |

---

## 2. Data Flow (полный цикл)

```
 ┌─────────────────── EDITOR ───────────────────┐
 │ sequence_editor.js                            │
 │   buildTaskData() → task_data dict            │
 │     ├─ content.elements  [{id, text}]         │
 │     ├─ content.levels    [{level_id, blocks}] │
 │     ├─ content.sequence  [{level_id, title,   │
 │     │                      items:[{id,label}]}]│
 │     ├─ content.prompt                         │
 │     ├─ content.level_order_matters            │
 │     └─ content.sequence_within_level_matters  │
 └────────────────────┬─────────────────────────┘
                      │ POST /api/editor/task/:m/:t/:id
                      ▼
 ┌────────────── SERVER (server.py) ────────────┐
 │ save_editor_task()                            │
 │   → storage_service.save_task(payload)        │
 └────────────────────┬─────────────────────────┘
                      ▼
 ┌──────── STORAGE SERVICE ─────────────────────┐
 │ save_task()                                   │
 │   1. TaskData.from_dict(payload)              │
 │   2. TaskIO.save(task_data_obj, path)         │
 │      ├─ task.to_validated() → FAILS silently  │  ← DEFECT #1
 │      └─ json.dump(data) → task.json           │
 │   3. _ensure_task_registered_in_module()      │
 └───────────────────────────────────────────────┘

 ┌──────── LOAD (для runtime) ──────────────────┐
 │ load_task()                                   │
 │   1. Read task.json                           │
 │   2. Read answer_key.json (usually empty)     │
 │   3. _normalize_answer_key()                  │  ← DEFECT #4
 │   4. Return {task_data, answer_key, metadata} │
 └───────────────────────────────────────────────┘
```

---

## 3. Найденные дефекты

### DEFECT #1 — `SequenceElement` Pydantic model требует `order`, Editor его не создаёт
- **Severity: 🔴 HIGH (silent data corruption)**
- **Файл:** `task_models.py:610`
- **Суть:** `SequenceElement.order` — required field (`Field(...)`), но Editor (`sequence_editor.js:466`) создаёт элементы `{id, text}` без `order`. Реальные task.json (`task_004`) тоже не содержат `order`.
- **Эффект:** При сохранении `TaskData.to_validated()` пытается создать `SequenceAssemblyTaskContent`, конвертация элемента в `SequenceElement` падает, и элемент сохраняется как сырой `Dict` (fallback в `convert_elements`, строка 643). **Вся Pydantic валидация для элементов молча обходится.**
- **Фикс:** Сделать `order` опциональным (`Optional[int] = None`) или убрать поле.

### DEFECT #2 — `SequenceAssemblyTaskContent` не содержит `levels`, `sequence`, флаги
- **Severity: 🔴 HIGH (schema gap)**
- **Файл:** `task_models.py:618-651`
- **Суть:** Pydantic-модель содержит только `elements`, `prompt`, `settings`. В реальности content содержит критически важные поля: `levels`, `sequence`, `level_order_matters`, `sequence_within_level_matters`. Они проходят только благодаря `extra = "allow"` — **без какой-либо типовой валидации.**
- **Эффект:** Corrupt `levels` (например, `blocks: [123]` вместо строки) будет молча сохранён.
- **Фикс:** Добавить поля `levels`, `level_order_matters`, `sequence_within_level_matters` в модель.

### DEFECT #3 — Валидация на save молча падает и пропускается
- **Severity: 🟡 MEDIUM (silent validation bypass)**
- **Файл:** `task_io.py:128-140`
- **Суть:** `task.to_validated()` возвращает `None` из-за DEFECT #1. Код продолжает сохранение без валидации:
  ```python
  validated_task = task.to_validated()
  if validated_task:  # None → skip
      ...
  ```
- **Эффект:** Все сохранения sequence_assembly проходят БЕЗ Pydantic валидации.
- **Фикс:** После исправления DEFECT #1 и #2 валидация начнёт работать автоматически.

### DEFECT #4 — `_normalize_answer_key` читает `level.get('id')` вместо `level.get('level_id')`
- **Severity: 🔴 HIGH (data mismatch → evaluation failure)**
- **Файл:** `storage_service.py:229`
- **Суть:**
  ```python
  'level_id': level.get('id') or str(idx),  # ← BUG: should be 'level_id'
  ```
  Legacy-формат `sequence` использует `level_id`, а не `id`. В результате `level.get('id')` → `None` → fallback `str(idx)` → answer_key получает `level_id: "0"` вместо `"level_1"`.
- **Эффект:** Если evaluation использует answer_key вместо content.levels, сравнение по level_id провалится. На практике это не срабатывает потому что content.levels уже содержит нормализованные данные, но при отсутствии content.levels (legacy tasks) — поломка гарантирована.
- **Фикс:** `level.get('level_id') or level.get('id') or str(idx)`

### DEFECT #5 — `TaskIO.new_task()` не инициализирует sequence_assembly
- **Severity: 🟡 MEDIUM (creation fails validation)**
- **Файл:** `task_io.py:57-73`
- **Суть:** `new_task()` обрабатывает click, draw, open_answer, test — но **нет ветки для sequence_assembly**. Новое задание создаётся с `content: {}`, что не пройдёт валидацию (required: `elements`, `prompt`).
- **Эффект:** При создании нового sequence_assembly через dashboard, валидация `TaskIO.save(..., validate=True)` может упасть или создать невалидный файл.
- **Фикс:** Добавить ветку `elif task_type == "sequence_assembly"` с минимальным content.

### DEFECT #6 — Дублированные `settings` vs `content` флаги без синхронизации
- **Severity: 🟡 MEDIUM (data inconsistency)**
- **Файл:** `sequence_editor.js:566-576` + реальный `task_004/task.json:178-187`
- **Суть:** `level_order_matters` и `sequence_within_level_matters` хранятся в двух местах:
  - `content.level_order_matters` (Editor пишет сюда)
  - `settings.level_order_matters` (Editor НЕ обновляет)
  
  Runtime UI (`SequenceUI.web.js:94-110`) ищет флаг по 6+ путям, но это fragile.
- **Эффект:** После изменения чекбоксов в Editor, `settings.*` содержит устаревшие значения.
- **Фикс:** Editor `buildTaskData()` должен синхронизировать `settings.level_order_matters` и `settings.sequence_within_level_matters`.

### DEFECT #7 — Stale `content.annotations: []` и `content.task_name`
- **Severity: 🟢 LOW (cosmetic/clutter)**
- **Файл:** Реальный `task_004/task.json:66,176`
- **Суть:** `annotations: []` — артефакт от click-шаблона, не относится к sequence. `task_name: "4"` — дублирует `meta.name` и никогда не обновляется Editor'ом.
- **Эффект:** Засорение task.json, потенциальная путаница при чтении.
- **Фикс:** При save удалять `content.annotations` для sequence_assembly; не записывать `content.task_name`.

### DEFECT #8 — HTML: лишние закрывающие `</label>`
- **Severity: 🟢 LOW (broken HTML)**
- **Файл:** `Sequence Assembly Editor Procedural Steps.html:137-138`
- **Суть:** Два orphaned `</label>` — невалидный HTML.
- **Фикс:** Удалить строки 137-138.

### DEFECT #9 — Editor не вызывает `saveStateToHistory()` для всех мутаций
- **Severity: 🟢 LOW (undo incomplete)**
- **Файл:** `sequence_editor.js:359-365,379-396`
- **Суть:** `addBlock()` и `moveBlock()` вызывают `markUnsaved()` но НЕ вызывают `saveStateToHistory()`. В то время как `deleteLevel()` и `addLevel()` — вызывают. Undo/redo не покрывает добавление блоков и перемещение блоков.
- **Фикс:** Добавить `this.saveStateToHistory()` в `addBlock()` и `moveBlock()`.

### DEFECT #10 — `_copy_images_to_task_dir` не обрабатывает sequence-элементы с image
- **Severity: 🟢 LOW (future-proofing)**
- **Файл:** `storage_service.py:1163-1258`
- **Суть:** Метод копирует изображения для click/draw (`content.image`) и test (`questions[].image_path`), но не обрабатывает `content.elements[].image` для sequence_assembly. Сейчас Editor не поддерживает изображения в элементах, но `SequenceElement` модель и `SequenceUI.web.js` их поддерживают (поле `image`).
- **Эффект:** Когда элементы с изображениями появятся, пути не будут нормализованы.
- **Фикс:** Добавить обработку `content.elements[].image` в `_copy_images_to_task_dir`.

---

## 4. Сводная таблица дефектов

| # | Severity | Компонент | Краткое описание | Влияние |
|---|----------|-----------|------------------|---------|
| 1 | 🔴 HIGH | Pydantic Model | `SequenceElement.order` required но не создаётся | Валидация молча обходится |
| 2 | 🔴 HIGH | Pydantic Model | Content model не содержит levels/flags | Нет типовой проверки levels |
| 3 | 🟡 MED | TaskIO.save | Валидация пропускается при ошибке | Невалидные данные сохраняются |
| 4 | 🔴 HIGH | StorageService | `level.get('id')` вместо `level.get('level_id')` | Evaluation failure для legacy |
| 5 | 🟡 MED | TaskIO.new_task | Нет init для sequence_assembly | Создание новых заданий ломается |
| 6 | 🟡 MED | Editor JS | settings не синхронизируются с content | Stale flags |
| 7 | 🟢 LOW | Editor JS | Stale annotations/task_name | Мусор в JSON |
| 8 | 🟢 LOW | Editor HTML | Orphaned `</label>` tags | Невалидный HTML |
| 9 | 🟢 LOW | Editor JS | Неполный undo для addBlock/moveBlock | Undo пропускает действия |
| 10 | 🟢 LOW | StorageService | Image copy не обрабатывает elements[].image | Будущие проблемы с путями |

---

## 5. Медиа и пути

- **Текущее состояние:** Editor не поддерживает добавление изображений к элементам sequence. Поле `image` есть в модели `SequenceElement` и в runtime `SequenceUI.web.js`, но UI в Editor'е его не отображает.
- **Путь к task.json:** Корректно разрешается через `storage_service._resolve_task_path()`.
- **Atomic write:** task.json записывается атомарно через `tempfile + shutil.move` — OK.

---

## 6. Совместимость версий

- **Schema version:** `1.2` — корректно устанавливается при сохранении.
- **Legacy `correct_sequence`:** Backend evaluator поддерживает, Editor не генерирует (OK).
- **Legacy `sequence` (editor format):** Editor записывает параллельно с `levels` — обеспечивает обратную совместимость.
- **Dual format в task.json:** `content.levels` (canonical) + `content.sequence` (legacy) — **OK, но только content.levels валидируется schema**.

---

## 7. Рекомендованный порядок фиксов (Стадия 6)

1. **DEFECT #1** → сделать `SequenceElement.order` Optional
2. **DEFECT #2** → добавить `levels`, `level_order_matters`, `sequence_within_level_matters` в `SequenceAssemblyTaskContent`
3. **DEFECT #4** → исправить `level.get('id')` на `level.get('level_id')`
4. **DEFECT #5** → добавить ветку sequence_assembly в `TaskIO.new_task()`
5. **DEFECT #6** → синхронизировать settings в Editor `buildTaskData()`
6. **DEFECT #8** → удалить orphaned `</label>`
7. **DEFECT #9** → добавить `saveStateToHistory()` в `addBlock/moveBlock`
8. **DEFECT #7** → cleanup stale fields при save
9. **DEFECT #10** → добавить image copy для elements
10. Написать integration-тесты на save/load cycle
