# Комплексный аудит механизмов прохождения комплексов

**Дата:** 2026-02-10  
**Область:** Очередь, итерации, ретраи, submit flow, UI state, фронтенд  
**Файлы:**
- `desktop-app/services/adaptive_session_manager.py` (2209 строк)
- `desktop-app/logic/complex_session_controller.py` (1177 строк)
- `desktop-app/api/session_api.py` (1750 строк)
- `desktop-app/server.py` (роуты сессии)
- `frontend/S1/session-controls.js`, `api-client.js`, `session_flow.js`, `session-state.js`
- `task_system/core/models/complex_models.py`

---

## Архитектурная схема потока

```
Frontend (S1)
  └── SessionAPI (api-client.js) ──HTTP──► server.py routes
                                              └── SessionAPI (session_api.py) — фасад
                                                    ├── ComplexSessionController
                                                    │     ├── TaskController (оценка ответа)
                                                    │     └── AdaptiveSessionManager
                                                    │           ├── ComplexService (загрузка комплекса)
                                                    │           ├── DifficultyManager (уровни)
                                                    │           ├── UserProgressManager (прогресс)
                                                    │           └── SessionRepository (файл)
                                                    └── StorageService (загрузка заданий)
```

---

## КАТЕГОРИЯ 1: БАГИ (требуют исправления)

### BUG-1: `broken_tasks` — безграничное накопление дубликатов
**Файл:** `adaptive_session_manager.py:567`, `adaptive_session_manager.py:1370`  
**Серьёзность:** Средняя  

`session.broken_tasks.append(task_ref)` вызывается без проверки на дубликаты. Если одно и то же задание встречается в очереди несколько раз (ретраи), оно добавится в `broken_tasks` многократно. Далее проверка `if task_ref in session.broken_tasks` всё равно работает (list `in` ищет первое вхождение), но список растёт бесконечно, засоряя JSON сессии.

**Исправление:** Заменить `.append()` на проверку `if task_ref not in session.broken_tasks:`.

---

### BUG-2: `_check_task_file_exists` загружает ВЕСЬ task.json для проверки существования
**Файл:** `adaptive_session_manager.py:1881-1888`  
**Серьёзность:** Средняя (производительность)  

Метод вызывает `self.storage_service.load_task(...)` для проверки существования файла. Это парсит весь JSON, загружает answer_key и metadata. При очереди из 20 заданий × 3 итерации = 60 вызовов полной загрузки только для проверки "файл есть?".

**Исправление:** Добавить лёгкий метод `storage_service.task_exists(module_id, topic_id, task_id)`, который делает только `Path.exists()`.

---

### BUG-3: Двойная генерация следующей итерации — race condition между Controller и Manager
**Файл:** `complex_session_controller.py:531-604`  
**Серьёзность:** Высокая  

В `_load_next_task()` контроллер вызывает `_generate_next_iteration()` напрямую (строка 534), сбрасывает `current_task_index = 0` (строка 538), а затем, если итерация не была "показана", ПАДАЕТ в нижнюю ветку и вызывает `get_next_task()` (строка 604). Но `get_next_task()` внутри ТОЖЕ вызывает `_generate_next_iteration()`, если `current_task_index >= len(queue)`.

**Сценарий проблемы:**
1. Контроллер генерирует итерацию, `queue = [A, B, C]`, `index = 0`
2. Итерация "уже показана" (`_last_shown_iteration == completed_iteration`)
3. Контроллер сбрасывает `_last_shown_iteration = None` и падает в `get_next_task()`
4. `get_next_task()` видит `index=0 < len(queue)=3` — OK, возвращает задание A
5. **НО** если между шагами 1-3 произошла ошибка и `queue` осталась пустой, `get_next_task()` сгенерирует ЕЩНЁ одну итерацию

Это дублирование логики генерации итераций между Controller и Manager — архитектурный долг.

---

### BUG-4: `save_ui_state` синхронизирует `current_task_index` назад при повторяющихся task_ref
**Файл:** `complex_session_controller.py:966-988`  
**Серьёзность:** Средняя  

Метод `save_ui_state("task", task_ref=X)` ищет task_ref X в очереди и может найти его на индексе РАНЬШЕ текущего (если это ретрай-копия). Защита `if found_idx >= current_idx` существует, но цикл `for idx, queued_task in enumerate(session.queue)` ищет ПЕРВОЕ вхождение с начала очереди, а не от `current_idx`. Поэтому если ретрай-копия задания стоит в позиции 2, а оригинал стоял на позиции 5 (уже пройден), мы можем попасть в ситуацию, где `found_idx=2 < current_idx=6`, и цикл НЕ прерывается по `break`, а продолжает искать. Но он может не найти следующего вхождения и оставить `found_idx=2`.

Фактически `found_idx` перезаписывается на каждой итерации цикла, и `break` срабатывает только если `found_idx >= current_idx`. Если ни одно вхождение >= current_idx, `found_idx` остаётся от последнего найденного (любого). Проверка `if found_idx is None or found_idx < current_idx` на строке 987 корректно это ловит, но сама логика поиска неоптимальна.

---

### BUG-5: `cancel_session` удаляет файл по `complex_id`, а не по `session_id`
**Файл:** `adaptive_session_manager.py:425`  
**Серьёзность:** Средняя  

`self.session_repository.delete_session(complex_id, user_id)` удаляет файл по ID комплекса. Если пользователь имеет несколько сессий одного комплекса (что технически возможно), cancel одной удалит файл для ВСЕХ.

---

### BUG-6: `handleCancelSession` показывает ДВА confirm-диалога
**Файл:** `frontend/S1/session-controls.js:694-711`  
**Серьёзность:** Низкая (UX)  

```javascript
const confirmed = window.confirm("Вы уверены...?");
if (!confirmed) return;
// ...
if (window.confirm("Вы уверены, что хотите прервать сессию?")) {
```

Пользователь видит два одинаковых confirm подряд.

---

### BUG-7: `getIterationResults` в api-client.js не возвращает `{status, data}`
**Файл:** `frontend/S1/api-client.js:74-81`  
**Серьёзность:** Средняя  

```javascript
async getIterationResults(sessionId) {
    const res = await fetch(...);
    return res.json(); // ← возвращает Promise<data>, а не {status, data}
}
```

В то время как `submitAnswer`, `nextTask`, `getCurrentTask` возвращают `{ status, data }`, `getIterationResults` возвращает только `data`. Это несовместимо. В `session-controls.js:201` вызов:
```javascript
const { status, data } = await SessionAPI.getIterationResults(SessionState.sessionId);
```
`status` будет `undefined`, `data` тоже может быть неправильно деструктурирован.

---

### BUG-8: `duration_seconds` переменная перезаписывается внутри цикла `_generate_session_summary`
**Файл:** `adaptive_session_manager.py:2082-2109`  
**Серьёзность:** Низкая  

Переменная `duration_seconds` вычисляется на строке 2082 как общая длительность сессии, а затем ПЕРЕЗАПИСЫВАЕТСЯ на строке 2109 внутри цикла итераций:
```python
duration_seconds = (ts['end'] - ts['start']).total_seconds()
```
К моменту создания `ExtendedSessionResultSummary` (строка 2118) `duration_seconds` содержит длительность ПОСЛЕДНЕЙ итерации, а не всей сессии. Однако поле `duration_seconds` не используется в конструкторе `ExtendedSessionResultSummary`, поэтому баг не проявляется, но переменная вводит в заблуждение при отладке.

---

## КАТЕГОРИЯ 2: НЕЗАПЛАНИРОВАННОЕ ПОВЕДЕНИЕ

### UB-1: Пропущенные задания (`skip_task`) не учитываются в `IterationSummary`
**Файл:** `adaptive_session_manager.py:2170-2173`  

`get_iteration_summary` считает только `completed_tasks`. Пропущенные задания (из `skipped_tasks`) не попадают в `total_tasks`, `failed_tasks` и `success_rate`. Это означает, что если пользователь пропустил 3 из 5 заданий, `IterationSummary` покажет "2/2, 100% успех", хотя реально пройдено только 2 из 5.

---

### UB-2: `daily_mix` логика раздвоена между контроллером и менеджером
**Файл:** `complex_session_controller.py:324-384` + `session_api.py:99-220`  

`daily_mix` имеет совершенно отдельную ветку в `_load_next_task()` (строка 324), которая обходит `get_next_task()` менеджера. При этом `start_custom_session` в SessionAPI напрямую манипулирует `_active_sessions` менеджера, что нарушает инкапсуляцию. Также `daily_mix` не поддерживает итерации — очередь линейная, завершение = конец.

---

### UB-3: `_should_show_final_results` — приватный атрибут, не персистируется
**Файл:** `adaptive_session_manager.py:1791`  

`session._should_show_final_results = True` устанавливается как динамический атрибут. Он не описан в Pydantic-модели `ComplexSession`, поэтому:
- Не сохраняется в JSON при `save_session`
- Теряется при перезагрузке приложения
- Если пользователь закроет приложение между генерацией пустой очереди и показом результатов, при восстановлении сессии финальные результаты не будут показаны

Аналогично для `_final_summary`, `_completed_iteration_before_end`.

---

### UB-4: `canGoNext` устанавливается ТОЛЬКО при успешном ответе
**Файл:** `frontend/S1/session-controls.js:578-579`  

```javascript
const wasSuccessful = response.result && response.result.success === true;
setCanGoNext(wasSuccessful);
```

Если ответ НЕПРАВИЛЬНЫЙ, кнопка "Далее" остаётся disabled. Пользователь не может перейти к следующему заданию после неправильного ответа. Это может быть задумано (заставить исправить), но в UI нет никакого механизма повторной попытки кроме повторного нажатия "Проверить".

**Важно:** Скорее всего, `showEvaluationResult` где-то включает кнопку "Далее" через другой путь, но из кода `session-controls.js` это не очевидно.

---

### UB-5: `iteration_completed` fallback требует минимум 4 задания
**Файл:** `complex_session_controller.py:463-466`  

```python
iteration_completed = (
    total_tasks_in_queue > 0 and
    processed_tasks_count >= 4 and  # Минимум 4 задания
    session.current_task_index >= total_tasks_in_queue
)
```

Если комплекс содержит менее 4 заданий (например, 2-3), fallback-логика НИКОГДА не сочтёт итерацию завершённой. Это касается только старых сессий без `origin_iteration`, но порог магический и не задокументирован.

---

### UB-6: Difficulty при `start_iteration > 1` устанавливается некорректно
**Файл:** `adaptive_session_manager.py:1427-1440`  

```python
if target_iteration > 1:
    pass
    difficulty = target_iteration
```

Если `start_iteration = 5`, все задания получают `difficulty = 5`, даже если максимальный доступный уровень = 3. Дальше нет кэппинга по `max_available_level` (в отличие от `_generate_next_iteration`, где есть `min(new_difficulty, max_available_level)`). Задание с `difficulty=5` при `max_level=3` может привести к ошибке в рендеринге.

---

## КАТЕГОРИЯ 3: АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ

### ARCH-1: Тройной fallback для `current_task_ref` в `submit_answer`
**Файл:** `session_api.py:1019-1084`  

При `submit_answer` SessionAPI последовательно пробует:
1. `self._controller.current_task_ref` (может быть None из-за race condition)
2. Поиск по `task_id` в очереди сессии
3. `get_current_task(session_id, auto_resume=True)` + `_load_current_task()`

Каждый fallback — это компенсация за десинхронизацию состояния между Controller и Manager. Три уровня fallback говорят о проблеме: **единый источник истины отсутствует**.

---

### ARCH-2: `current_task_index` семантика неоднозначна
**Файлы:** множество  

`current_task_index` в разных местах означает разное:
- В `get_next_task()`: увеличивается ПЕРЕД возвратом задания (строка 573) → указывает на СЛЕДУЮЩЕЕ
- В `_load_current_task()`: используется как индекс ТЕКУЩЕГО задания
- В `get_current_session_stats()`: описан как "уже увеличен" (строка 850)
- В `daily_mix` ветке: увеличивается ПОСЛЕ текущего (`next_index = idx + 1`, строка 334)

Эта семантическая неоднозначность — источник off-by-one ошибок.

---

### ARCH-3: UI state debouncing мёртвый код
**Файл:** `complex_session_controller.py:1031-1048`  

Debouncing реализован, но фактически не работает:
```python
if time_since_last_save < self._save_debounce_delay:
    # ...
    if screen_type in ("iteration_results", "task_results"):
        logger.debug("Критическое изменение, сохраняем немедленно")
    else:
        logger.debug("Сохраняем несмотря на debounce")
```

В обоих ветках сохранение выполняется. Debounce ничего не откладывает.

---

### ARCH-4: `_active_sessions` не очищается после завершения
**Файл:** `adaptive_session_manager.py:462-463`  

`end_session()` помечает сессию как `is_active = False`, но не удаляет из `_active_sessions`. Это означает, что при долгой работе приложения словарь растёт бесконечно (memory leak). Каждая сессия содержит полную историю `completed_tasks`.

---

## КАТЕГОРИЯ 4: ПРЕДЛОЖЕНИЯ ПО УЛУЧШЕНИЮ

### IMP-1: Единый источник истины для текущего задания
Вместо синхронизации `Controller.current_task_ref` ↔ `Session.current_task_index` ↔ `Session.queue[idx]`, ввести один авторитетный источник: `session.current_task_ref`. Все остальные должны читать из него.

### IMP-2: Типизированные события вместо callback-ов
Заменить `on_task_changed`, `on_iteration_completed`, `on_session_completed`, `on_complex_completed`, `on_error` на event bus / typed event system. Это уберёт проверки `if hasattr(self, 'on_X') and self.on_X`.

### IMP-3: Лёгкая проверка существования файла задания
Добавить `StorageService.task_exists()` вместо полной загрузки.

### IMP-4: Метрики и мониторинг
- Счётчик `iteration_mismatch_count` уже есть, но не экспортируется
- Добавить метрику "среднее время генерации итерации"
- Добавить метрику "количество broken_tasks за сессию"

### IMP-5: Пропущенные задания в статистике
Включить `skipped_tasks` в `IterationSummary` как отдельную категорию, чтобы UI мог показать "2 пройдено, 1 пропущено, 2 с ошибками".

### IMP-6: Очистка `_active_sessions` после завершения
Добавить TTL или явную очистку завершённых сессий из `_active_sessions` (например, через 5 минут после `end_session`).

### IMP-7: Валидация `difficulty` при генерации начальной очереди
Ограничить `difficulty` значением `min(target_iteration, max_available_level)` в `_generate_initial_queue`.

---

## СВОДНАЯ ТАБЛИЦА

| ID | Тип | Серьёзность | Файл | Краткое описание |
|----|-----|-------------|------|-----------------|
| BUG-1 | Баг | Средняя | adaptive_session_manager.py | broken_tasks дубликаты |
| BUG-2 | Баг | Средняя | adaptive_session_manager.py | Полная загрузка для проверки существования |
| BUG-3 | Баг | Высокая | complex_session_controller.py | Двойная генерация итерации |
| BUG-4 | Баг | Средняя | complex_session_controller.py | save_ui_state поиск task_ref |
| BUG-5 | Баг | Средняя | adaptive_session_manager.py | cancel удаляет по complex_id |
| BUG-6 | Баг | Низкая | session-controls.js | Двойной confirm |
| BUG-7 | Баг | Средняя | api-client.js | getIterationResults формат ответа |
| BUG-8 | Баг | Низкая | adaptive_session_manager.py | duration_seconds перезапись |
| UB-1 | Поведение | Средняя | adaptive_session_manager.py | Пропуски не в IterationSummary |
| UB-2 | Поведение | Средняя | complex_session_controller.py | daily_mix раздвоение логики |
| UB-3 | Поведение | Средняя | adaptive_session_manager.py | Приватные атрибуты не персистируются |
| UB-4 | Поведение | Средняя | session-controls.js | canGoNext только при success |
| UB-5 | Поведение | Низкая | complex_session_controller.py | Fallback требует >= 4 задания |
| UB-6 | Поведение | Средняя | adaptive_session_manager.py | difficulty не кэппится при start_iteration>1 |
| ARCH-1 | Архитектура | — | session_api.py | Тройной fallback task_ref |
| ARCH-2 | Архитектура | — | множество | current_task_index семантика |
| ARCH-3 | Архитектура | — | complex_session_controller.py | Мёртвый debouncing |
| ARCH-4 | Архитектура | — | adaptive_session_manager.py | Memory leak _active_sessions |

**Итого:** 8 багов, 6 незапланированных поведений, 4 архитектурных проблемы, 7 предложений по улучшению.
