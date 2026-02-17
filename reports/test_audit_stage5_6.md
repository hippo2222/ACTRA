# Аудит типа задания «Тест» — Стадии 5–6: Editor/Storage

**Дата**: 2026-02-09  
**Аудитор**: Cascade

---

## Стадия 5: Аудит создания/редактирования/сохранения

### 5.1 Editor-flow

| Этап | Файл:строка | Статус | Примечания |
|------|------------|--------|-----------|
| **Создание** `TaskIO.new_task("test")` | task_io.py:68-71 | 🟡 | Не инициализирует test_type и settings (E2) |
| **Загрузка** `onTaskLoaded()` | test_editor.js:210-222 | ✅ | Десериализует questions, гарантирует ≥1 вопрос |
| **Десериализация** `deserializeQuestions()` | test_editor.js:122-130 | ✅ | Детектирует backend/editor формат, нормализует |
| **Редактирование** CRUD вопросов/опций | test_editor.js:450-650 | ✅ | addQuestion, addOption, deleteOption, deleteQuestion |
| **Сборка для сохранения** `buildBackendContent()` | test_editor.js:151-187 | ✅ | options→answers, is_correct→correct, image→image_path |
| **Сохранение** `buildTaskData()` → API POST | test_editor.js:1023-1027 | ✅ | |
| **Повторное открытие** roundtrip | test_editor.js:93-120 | ✅ | ensureQuestionShape handles both answers/options |
| **Undo/Redo capture** | test_editor.js:1150-1154 | 🟡 | Дубликат, перезаписывает первый captureState (E1) |
| **Undo/Redo restore** | test_editor.js:1161-1171 | 🟡 | Не восстанавливает settings, не десериализует (E1) |
| **Import** confirmImport() | test_editor.js:734-754 | ✅ | deserializeQuestions, append/replace modes |
| **Export** exportTasks() | test_editor.js:642-679 | ✅ | Отправляет backend format |

### 5.2 Персистентность task.json и схемы

| Аспект | Статус | Примечания |
|--------|--------|-----------|
| Atomic write | ✅ | TaskIO.save использует temp file + rename |
| Schema version stamp | ✅ | meta.task_schema_version присваивается при сохранении |
| Pydantic validation | ✅ | TestTaskContent валидирует при сохранении, fallback при ошибке |
| Backward compat `answers`↔`options` | ✅ | convert_questions в Pydantic, ensureQuestionShape в editor |
| Bloat: двойные поля `answers`+`options` | ⚪ | После Pydantic validation оба поля в JSON (E3, cosmetic) |
| Cleanup `content.type`, `content.image` | ✅ | TaskIO.save удаляет лишние поля |

### 5.3 Медиа (изображения)

| Аспект | Статус | Файл:строка |
|--------|--------|-------------|
| Upload question image | ✅ | test_editor.js:890-925 |
| Upload option image | ✅ | test_editor.js:930-962 |
| Copy on save (`image_path`) | ✅ | storage_service.py:1242-1244 |
| Copy on save (`images[]`) | ✅ | storage_service.py:1246-1256 (Fixed in Stage 3, O4) |
| Copy on save (answer `image_path`) | ✅ | storage_service.py:1258-1264 |
| Preview in editor | ✅ | test_editor.js renders img from image/image_path |
| Delete image | ⚪ | Нет explicit delete — при удалении вопроса файл остаётся на диске |

### 5.4 Найденные дефекты

#### E1 🟡 MEDIUM — Дублирующие captureState/restoreState

Два набора методов в одном классе. Второй (строки 1150-1171) перезаписывает первый (274-304).

**Второй набор** (действующий): захватывает editor-формат questions + currentQuestionIndex, восстанавливает прямым присвоением БЕЗ deserializeQuestions и БЕЗ восстановления settings.

**Первый набор** (мёртвый код): захватывает backend-формат + settings, восстанавливает через deserializeQuestions + settings merge.

**Последствия**: Изменения settings (shuffle, passing_score, time_limit) НЕ откатываются через Undo. Если в draft попадёт backend-формат, restoreState не конвертирует его.

#### E2 ⚪ MINOR — TaskIO.new_task("test") не инициализирует test_type/settings

`task_io.py:68-71` создаёт `content: { questions: [] }` без `test_type` и `settings`. Начальный task.json не проходит Pydantic-валидацию `TestTaskContent` (test_type required). Сохранение fallback'ит на raw dict.

#### E3 ⚪ MINOR — Pydantic добавляет options рядом с answers

После `TestTaskContent` → `.dict()` вопросы содержат оба поля:
- `options: [{text, is_correct}]` (Pydantic model)
- `answers: [{text, correct}]` (extra field, preserved)

Bloat ~30% на вопрос. Не ломает ничего, но засоряет JSON.

---

## Стадия 6: Исправления (ниже)

### Fix E1 — Объединить captureState/restoreState

Удалить второй набор (1150-1171), обогатить первый `captureState` полем `currentQuestionIndex`.

### Fix E2 — Инициализация test_type/settings в TaskIO.new_task

Добавить `test_type: "multiple_choice"` и `settings` в начальный content.

### Integration-тесты

Тест save→load roundtrip для test task через StorageService.
