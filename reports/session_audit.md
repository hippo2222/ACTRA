# Аудит сессионной инфраструктуры

## Файлы под аудитом
- `desktop-app/services/adaptive_session_manager.py` — ядро сессий
- `desktop-app/logic/complex_session_controller.py` — контроллер UI↔Manager
- `desktop-app/api/session_api.py` — HTTP-фасад
- `desktop-app/server.py` — Flask-маршруты
- `frontend/S1/session-controls.js` — фронтенд-логика сессии
- `frontend/S1/api-client.js` — API-клиент
- `task_system/core/models/complex_models.py` — Pydantic-модели

---

## Категория A: Баги (ломают поведение)

### A-1. Двойной confirm при отмене сессии (frontend)
**Файл:** `frontend/S1/session-controls.js:688-717`  
**Серьёзность:** Medium  
**Описание:** `handleCancelSession` показывает два `window.confirm()` подряд. Пользователь видит два одинаковых диалога.  
**Корневая причина:** Вложенный `if (window.confirm(...))` внутри `try` после первого `if (!confirmed) return;`.  
**Исправление:** Удалить второй `window.confirm` (строка 701), оставить только первый (строка 694).

### A-2. `getIterationResults` возвращает несовместимый формат (frontend)
**Файл:** `frontend/S1/api-client.js:74-81`  
**Серьёзность:** High  
**Описание:** `getIterationResults` возвращает `res.json()` напрямую (не `{status, data}`), в отличие от всех остальных методов. Вызывающий код в `session-controls.js:201` делает `const { status, data } = await SessionAPI.getIterationResults(...)` — деструктуризация ломается, `status` и `data` будут `undefined`.  
**Исправление:** Привести к единому формату `{ status: res.status, data: await res.json() }`.

### A-3. `getFinalResults` — та же проблема с форматом
**Файл:** `frontend/S1/api-client.js:83-90`  
**Серьёзность:** Medium  
**Описание:** Аналогично A-2, `getFinalResults` возвращает `res.json()` вместо `{status, data}`.

### A-4. `cancelSession` возвращает raw Response
**Файл:** `frontend/S1/api-client.js:92-97`  
**Серьёзность:** Low  
**Описание:** `cancelSession` возвращает сырой `fetch()` Promise (Response), не парсит JSON. В `session-controls.js` это вызывается через `handleDiscardSession` (строка 318), который сам делает `fetch`, а `handleCancelSession` (строка 703) тоже делает отдельный `fetch`. Метод `cancelSession` из API-клиента вообще не используется — мёртвый код.

### A-5. `setCanGoNext(wasSuccessful)` блокирует кнопку Next при ошибке
**Файл:** `frontend/S1/session-controls.js:578-579`  
**Серьёзность:** Medium  
**Описание:** После submit, `setCanGoNext(wasSuccessful)` — если ответ неверный (`success=false`), кнопка «Далее» остаётся заблокированной. Пользователь не может перейти к следующему заданию после ошибочного ответа.  
**Ожидаемое поведение:** Кнопка «Далее» должна быть активна после ЛЮБОГО submit (как верного, так и ошибочного). Пользователь должен иметь возможность двигаться дальше.  
**Исправление:** Заменить `setCanGoNext(wasSuccessful)` на `setCanGoNext(true)`.

### A-6. `_load_current_task` — `else: raise` на неправильном уровне вложенности
**Файл:** `desktop-app/logic/complex_session_controller.py:295-296`  
**Серьёзность:** Medium  
**Описание:** `else: raise ValueError(...)` стоит на уровне `if not session.ui_state...`, а не на уровне `if len(parts) >= 3`. Это значит, что если `ui_state` содержит `task_results`, то вместо пропуска сохранения UI будет выброшено исключение.  
**Исправление:** Перенести `else` на правильный уровень вложенности (к `if len(parts) >= 3`).

---

## Категория B: Проблемы поведения (не ломают, но неожиданны)

### B-1. `cancel_session` удаляет файл по complex_id, а не по session_id
**Файл:** `desktop-app/services/adaptive_session_manager.py:473-476`  
**Серьёзность:** Medium  
**Описание:** `cancel_session` вызывает `session_repository.delete_session(complex_id, user_id)`. Если у пользователя несколько сессий одного комплекса (маловероятно, но возможно), удалится не та сессия.

### B-2. `_check_task_file_exists` загружает ВЕСЬ task.json для проверки наличия
**Файл:** `desktop-app/services/adaptive_session_manager.py:1933-1940`  
**Серьёзность:** Low (Performance)  
**Описание:** Для проверки наличия файла загружается весь JSON через `storage_service.load_task()`. Это избыточно — достаточно проверить `Path.exists()`.

### B-3. `_generate_session_summary` использует переменную `duration_seconds` дважды
**Файл:** `desktop-app/services/adaptive_session_manager.py:2134-2162`  
**Серьёзность:** Low  
**Описание:** Переменная `duration_seconds` сначала вычисляется как общая длительность (строка 2134), затем перезаписывается внутри цикла (строка 2161) длительностью отдельных итераций. Общая длительность теряется перед передачей в `ExtendedSessionResultSummary`.

### B-4. `resume_session` не проверяет `is_active` при загрузке из файла
**Файл:** `desktop-app/services/adaptive_session_manager.py:444-449`  
**Серьёзность:** Low  
**Описание:** Если сессия была завершена (`is_active=False`), но файл сохранился, `resume_session` всё равно загрузит её, снимет `paused` и вернёт. Это может привести к работе с завершённой сессией.

### B-5. `daily_mix` early block в `_load_next_task` дублирует логику загрузки задания
**Файл:** `desktop-app/logic/complex_session_controller.py:323-384`  
**Серьёзность:** Low (Architecture)  
**Описание:** Вся логика загрузки task, parse task_ref, load_task, load into TaskController, notify UI — продублирована в блоке `daily_mix` вместо переиспользования общего пути.

### B-6. `_get_task_type` использует два несвязанных кэша
**Файл:** `desktop-app/services/adaptive_session_manager.py:1965 vs 97-100`  
**Серьёзность:** Low  
**Описание:** `_get_task_type` пишет в `self.task_meta_cache[task_ref] = task_type` (строка 2057), а `_load_task_metadata` пишет в `self.task_meta_cache[f"metadata:{task_ref}"]` (строка 165). Это два разных ключа в одном dict, что путает. Также `submit_result` пишет в `self.task_meta_cache[task_ref]` (строка 793).

---

## Категория C: Архитектурные проблемы

### C-1. SessionAPI обходит контроллер и напрямую манипулирует сессией
**Файлы:** `desktop-app/api/session_api.py:163, 277-278, 284-286`  
**Описание:** `SessionAPI` напрямую пишет в `session_manager._active_sessions`, `session.paused`, `controller.current_session_id` — обходя инкапсуляцию.

### C-2. Дублирование fallback-логики восстановления task_ref
**Файлы:** `session_api.py:288-316` (get_current_task), `session_api.py:1197-1216` (next_task), `session_api.py:1020-1064` (submit_answer)  
**Описание:** Логика "восстановить task_ref из очереди по current_task_index" дублируется в 3+ методах с небольшими вариациями.

### C-3. `_load_next_task` — 300 строк в одном методе
**Файл:** `desktop-app/logic/complex_session_controller.py:303-589`  
**Описание:** Метод смешивает: early return для daily_mix, проверку завершения итерации, генерацию следующей итерации, очистку UI, показ результатов, загрузку задания. Сложно читать и тестировать.

### C-4. `submit_answer` в SessionAPI — 200 строк с множеством fallback'ов
**Файл:** `desktop-app/api/session_api.py:980-1179`  
**Описание:** Метод содержит 5+ fallback-стратегий для восстановления task_ref, каждая с try/except. Это говорит о нестабильности контракта между SessionAPI и Controller.

---

## Приоритеты исправления

| ID  | Серьёзность | Усилия | Рекомендация |
|-----|------------|--------|-------------|
| A-1 | Medium | Tiny | Исправить немедленно |
| A-2 | High | Tiny | Исправить немедленно |
| A-3 | Medium | Tiny | Исправить вместе с A-2 |
| A-4 | Low | Tiny | Удалить мёртвый код |
| A-5 | Medium | Tiny | Исправить немедленно |
| A-6 | Medium | Small | Исправить отступ |
| B-1 | Medium | Small | Планировать |
| B-3 | Low | Tiny | Исправить при случае |
| B-5 | Low | Medium | Рефакторинг позже |
| C-1..C-4 | — | Large | Архитектурный долг |
