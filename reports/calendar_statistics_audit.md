# Комплексный аудит: Статистика и Календарь

**Дата:** 2026-02-10
**Область:** Calendar Service, Statistics Service, Activity Heatmap, Streak, HealthScore
**Файлы проанализированы:**
- `desktop-app/services/calendar/calendar_service.py`
- `desktop-app/services/calendar/models.py`
- `desktop-app/services/calendar/scheduler_service.py`
- `desktop-app/services/calendar/health_score_service.py`
- `desktop-app/services/calendar/notification_service.py`
- `desktop-app/services/calendar/migration_activity_format.py`
- `desktop-app/services/statistics_service.py`
- `desktop-app/api/calendar_api.py`
- `desktop-app/api/session_api.py`
- `desktop-app/server.py`
- `frontend/Calendar/calendar.js`
- `frontend/Calendar/calendar.html`
- `tests/calendar/*.py`

---

## Сводка найденных дефектов

| # | Серьёзность | Категория | Краткое описание |
|---|-------------|-----------|------------------|
| D-1 | 🔴 CRITICAL | Архитектура | Дублирование маршрутов Calendar API в server.py → непредсказуемое поведение |
| D-2 | 🔴 CRITICAL | Данные | CalendarService не переключается при смене пользователя |
| D-3 | 🔴 CRITICAL | Логика | Streak сбрасывается при каждом открытии страницы (до начала занятий) |
| D-4 | 🟠 HIGH | Данные | Heatmap игнорирует сохранённый completion_percent, пересчитывает неверно |
| D-5 | 🟠 HIGH | Логика | `structure_daily_mix` — ошибка среза массива после extend |
| D-6 | 🟠 HIGH | Данные | `complete_session` не обновляет tasks_attempted/solved/seconds_spent |
| D-7 | 🟠 HIGH | Архитектура | Две независимые системы стриков (Calendar vs Statistics), не синхронизированы |
| D-8 | 🟡 MEDIUM | Данные | `record_task_attempt` создаёт фантомные ComplexProgress для несуществующих комплексов |
| D-9 | 🟡 MEDIUM | Производительность | `get_today_plan` сохраняет весь прогресс на диск при каждом открытии |
| D-10 | 🟡 MEDIUM | Потокобезопасность | `_activity_cache` — мутабельный модульный синглтон без инвалидации и thread-safety |
| D-11 | 🟡 MEDIUM | Логика | `complete_session` не проверяет существование сессии — обновляет статистику для фантомных сессий |
| D-12 | 🟡 MEDIUM | Архитектура | Нормализация комплексов (`_normalize_complex_obj`) скопирована в 3+ местах |
| D-13 | 🟡 MEDIUM | UI/UX | Frontend предлагает «гибкий режим», который удалён из бэкенда |
| D-14 | 🟡 MEDIUM | UI/UX | `handleReviewComplex` — заглушка, кнопка «Исправить» ничего не делает |
| D-15 | 🟢 LOW | Данные | `get_recent_sessions` сортирует по несуществующему полю `completed_at` |
| D-16 | 🟢 LOW | Стиль | Inconsistent Enum comparison (`.value` vs прямое сравнение со строкой) |

---

## Детальное описание дефектов

### D-1 🔴 CRITICAL — Дублирование маршрутов Calendar API

**Файлы:** `server.py:398-408` + `server.py:1015-1145` + `calendar_api.py:35-651`

**Суть:** Calendar-маршруты регистрируются **дважды**:
1. Через `create_calendar_routes()` (calendar_api.py) — полноценная логика с определением `in_progress`-комплекса, дедупликацией daily_mix, проксированием через SessionAPI.
2. Через standalone-определения в server.py (`get_calendar_today`, `start_calendar_session`, и т.д.) — упрощённая логика (берёт первый комплекс, не проксирует через SessionAPI).

**Последствия:**
- Flask берёт **последний** зарегистрированный обработчик. Маршруты в server.py переопределяют маршруты из `create_calendar_routes`.
- `start_calendar_session` в server.py вызывает `calendar_service.start_session()`, которая лишь создаёт запись Session, **не создавая реальную очередь задач** через SessionAPI → Daily Mix нажимает «Начать» и ничего не происходит.
- `get_calendar_today` в server.py берёт `current_complex = первый комплекс`, а не комплекс в статусе `in_progress`.

**Исправление:** Удалить standalone-маршруты из server.py (строки 1010-1145), оставив только регистрацию через `create_calendar_routes()`.

---

### D-2 🔴 CRITICAL — CalendarService не переключается при смене пользователя

**Файл:** `server.py:196-226`

**Суть:** При вызове `switch_user()` обновляются:
- `progress_service.user_id`
- `statistics_service` (очистка кэша)
- `session_api.default_user_id`

НО **`calendar_service`** не обновляется. Его `user_id` и `calendar_dir` остаются от предыдущего пользователя.

**Последствия:** После переключения пользователя Calendar API читает/пишет файлы старого пользователя (`settings.json`, `progress.json`, `activity.json`, и т.д.).

**Исправление:** Добавить в `switch_user()`:
```python
if self.calendar_service:
    self.calendar_service.user_id = user_id
    self.calendar_service.calendar_dir = self.calendar_service.data_dir / "user_calendar" / user_id
    self.calendar_service.calendar_dir.mkdir(parents=True, exist_ok=True)
    self.calendar_service.settings_path = self.calendar_service.calendar_dir / "settings.json"
    self.calendar_service.progress_path = self.calendar_service.calendar_dir / "progress.json"
    self.calendar_service.sessions_path = self.calendar_service.calendar_dir / "sessions.json"
    self.calendar_service.activity_path = self.calendar_service.calendar_dir / "activity.json"
    self.calendar_service.notifications_path = self.calendar_service.calendar_dir / "notifications.json"
    self.calendar_service.rest_days_path = self.calendar_service.calendar_dir / "rest_days.json"
```
Или лучше: добавить метод `CalendarService.switch_user(user_id)`.

---

### D-3 🔴 CRITICAL — Streak сбрасывается при каждом открытии страницы

**Файл:** `calendar_service.py:296-309`

**Суть:**
```python
yesterday = (date.today() - timedelta(days=1)).isoformat()
is_adapted = yesterday not in activity and settings.last_activity_date is not None

if is_adapted:
    settings.streak_days = 0
    self.save_settings(settings)
```

`get_today_plan()` вызывается **при каждом открытии** страницы календаря. Если пользователь:
1. Занимался вчера (streak = 5)
2. Открывает страницу сегодня утром **до начала занятий**
3. `yesterday not in activity` = False (вчера есть) — ОК.

**Но** если пользователь:
1. Занимался 2 дня назад (streak = 5)
2. Пропустил вчера
3. Открывает страницу сегодня → `yesterday not in activity` = True → **streak = 0**
4. Это правильно в данном случае. Но если открывает второй раз → всё равно сбрасывает (уже сброшено, но `is_adapted=True` снова вызывает `recalculate_on_miss` каждый раз).

**Реальная проблема:** `is_adapted` = True на **каждый** запрос, пока пользователь не позанимается сегодня. Каждый вызов:
- Пересчитывает план через `recalculate_on_miss` (лишние вычисления)
- Вставляет `missed_notification` (дублирование уведомлений)
- Сохраняет `streak_days = 0` повторно

**Исправление:** Кэшировать факт адаптации в настройках или проверять `settings.streak_days == 0` перед повторным сбросом. Добавить поле `last_adapted_date` в settings, чтобы не адаптировать план повторно для того же пропуска.

---

### D-4 🟠 HIGH — Heatmap пересчитывает completion_percent неверно

**Файл:** `calendar_service.py:781`

**Суть:**
```python
completion_percent = min(tasks_solved * 20, 200)
```

Это игнорирует `completion_percent`, сохранённый в `activity[date]["completion_percent"]` (который рассчитывается по времени: `active_time_seconds / target_seconds * 100`).

Формула `tasks_solved * 20` означает: 5 решённых задач = 100%. Но `complete_session` считает: 30 мин / 30 мин лимит = 100%.

**Последствия:** Если пользователь решил 2 задачи за 30 минут (100% по времени), heatmap покажет 40%. Две несовместимые метрики.

**Исправление:** Использовать сохранённый `completion_percent` из activity data:
```python
if isinstance(day_data, dict):
    completion_percent = day_data.get("completion_percent", 0)
```

---

### D-5 🟠 HIGH — `structure_daily_mix`: ошибка среза после extend

**Файл:** `scheduler_service.py:352-360`

**Суть:**
```python
if len(warmup) < warmup_target and main:
    warmup.extend(main[:warmup_target - len(warmup)])
    main = main[warmup_target - len(warmup):]  # ← BUG
```

После `warmup.extend(...)`, `len(warmup)` **уже изменился**. Поэтому выражение `warmup_target - len(warmup)` даёт 0, и `main = main[0:]` = весь main (ничего не отрезается).

**Пример:** warmup_target=2, warmup=[], main=[A,B,C,D]
- `warmup.extend(main[:2])` → warmup=[A,B], len(warmup)=2
- `main = main[2-2:]` = `main[0:]` = [A,B,C,D] — задачи A,B остаются и в warmup, и в main

Тот же баг ниже для consolidation (строки 357-360).

**Исправление:** Сохранить количество до extend:
```python
n_to_move = warmup_target - len(warmup)
warmup.extend(main[:n_to_move])
main = main[n_to_move:]
```

---

### D-6 🟠 HIGH — `complete_session` не обновляет tasks_attempted/solved/seconds_spent

**Файл:** `calendar_service.py:544-659`

**Суть:** `complete_session` обновляет только `completion_percent` и `session_ids`. Поля `tasks_attempted`, `tasks_solved`, `seconds_spent` обновляются **только** через `record_task_attempt`.

Если задачи выполняются через основной session flow (SessionAPI → submit_answer) без явного вызова `record_task_attempt` через Calendar API, то `tasks_solved` и `tasks_attempted` остаются 0, а `completion_percent` основан на времени.

**Последствия:** Heatmap видит `tasks_solved=0` даже если пользователь решил задачи через Daily Mix session.

**Исправление (два варианта):**
1. **Минимальный:** При `complete_session` обновлять `tasks_attempted += tasks_completed` и `tasks_solved += tasks_completed`.
2. **Архитектурный:** Подписаться на events от SessionAPI/ProgressService для автоматического обновления calendar activity при каждом submit.

---

### D-7 🟠 HIGH — Два независимых механизма стриков

**Файлы:** `calendar_service.py` (streak в settings) vs `statistics_service.py` (streak из complex_completions)

**Суть:**
1. **Calendar streak:** `UserCalendarSettings.streak_days` — обновляется в `complete_session()`, сбрасывается в `get_today_plan()`.
2. **Statistics streak:** Вычисляется в `aggregate_statistics()` из `complex_completions` дат.

Эти два стрика:
- Используют разные источники данных
- Применяют разные правила gap (calendar: gap > 1 день = сброс; statistics: gap ≤ 1 = продолжение)
- Не синхронизируются

**Исправление:** Выбрать один источник истины для streak. Рекомендация: Statistics streak как primary (он уже основан на реальных completions), Calendar streak — делегирует к нему или удаляется.

---

### D-8 🟡 MEDIUM — Фантомные ComplexProgress

**Файл:** `calendar_service.py:873-878`

**Суть:** Если `record_task_attempt` вызывается с `complex_id`, которого нет в `complex_service`, создаётся `ComplexProgress` для несуществующего комплекса.

**Последствия:** Health dashboard показывает комплексы-фантомы (с complex_id вместо имени). `_build_health_summary` выводит их в UI.

**Исправление:** Проверять существование комплекса перед созданием нового ComplexProgress.

---

### D-9 🟡 MEDIUM — `get_today_plan` выполняет запись на каждый GET-запрос

**Файл:** `calendar_service.py:291-293`

**Суть:**
```python
for progress in all_progress:
    self.health_service.update_progress_health(progress)
self.save_all_progress(all_progress)
```

Каждый `GET /api/calendar/today` пересчитывает health scores и **записывает** весь progress на диск.

**Последствия:** Ненужная нагрузка I/O. При 10 комплексах это 10 пересчётов + 1 запись JSON при каждом открытии страницы.

**Исправление:** Пересчитывать health scores, но сохранять на диск только если значение реально изменилось (или по TTL).

---

### D-10 🟡 MEDIUM — `_activity_cache` не инвалидируется при изменениях

**Файл:** `calendar_api.py:28-32`

**Суть:** Модульный кэш с TTL=60с:
```python
_activity_cache = {"data": None, "timestamp": None, "ttl_seconds": 60}
```
Не инвалидируется при `record_task_attempt` или `complete_session`. Не thread-safe.

**Последствия:** После записи попытки heatmap может показывать устаревшие данные до 60с.

**Исправление:** Инвалидировать кэш при мутирующих операциях или использовать service-level кэш с подпиской на события.

---

### D-11 🟡 MEDIUM — `complete_session` обновляет статистику для фантомных сессий

**Файл:** `calendar_service.py:564-573`

**Суть:** Если `session_id` не найден в `sessions.json`, `session` остаётся `None`, но метод продолжает обновлять activity и streak.

**Исправление:** Возвращать ошибку если сессия не найдена:
```python
if session is None:
    return {"success": False, "error": "session_not_found"}
```

---

### D-12 🟡 MEDIUM — Копипаста нормализации комплексов

**Файлы:** `calendar_api.py:48-64`, `calendar_api.py:250-261`, `calendar_api.py:478-488`

**Суть:** Логика `_normalize_complex_obj` скопирована как минимум в 3 места с незначительными различиями.

**Исправление:** Использовать единый `_normalize_complex_obj()` во всех местах.

---

### D-13 🟡 MEDIUM — UI предлагает несуществующий «гибкий режим»

**Файлы:** `calendar.js:309-344`, `calendar_service.py:498-503`

**Суть:** Frontend содержит баннер "Перейти на гибкий режим" (line 334), но бэкенд принудительно устанавливает `ScheduleMode.DAILY`:
```python
def switch_schedule_mode(self, mode: str):
    settings.schedule_mode = ScheduleMode.DAILY  # Always daily
```

**Исправление:** Удалить UI элементы гибкого режима или реализовать его.

---

### D-14 🟡 MEDIUM — `handleReviewComplex` — заглушка

**Файл:** `calendar.js:522-525`

**Суть:** Клик по комплексу в Health Indicator или кнопка «Исправить» в уведомлении вызывает:
```javascript
handleReviewComplex(complexId) {
    console.log('Starting unplanned review:', complexId);
}
```
Никакого реального действия.

**Исправление:** Реализовать навигацию к сессии повторения (через `/api/calendar/session/start` с `session_type=unplanned`).

---

### D-15 🟢 LOW — `get_recent_sessions` сортирует по несуществующему полю

**Файл:** `statistics_service.py:1173`

**Суть:**
```python
all_sessions.sort(key=lambda x: x.get("completed_at", ""), reverse=True)
```
Сессии хранятся с полем `end_time`, не `completed_at`. Все записи получают fallback `""`, сортировка бесполезна.

**Исправление:** Заменить `"completed_at"` на `"end_time"`.

---

### D-16 🟢 LOW — Непоследовательное сравнение Enum со строками

**Файлы:** `notification_service.py:203,292`, `calendar_service.py` (various)

**Суть:** Иногда `settings.schedule_mode.value` (строка), иногда `settings.schedule_mode != "daily"` (прямое сравнение Enum). Работает из-за `str` Enum, но непоследовательно.

**Исправление:** Везде использовать `settings.schedule_mode == ScheduleMode.DAILY`.

---

## Архитектурные рекомендации

### R-1: Единый источник истины для Activity Data

Сейчас activity данные записываются из двух потоков:
- `record_task_attempt` (Calendar API) → инкрементирует tasks_attempted/solved/seconds_spent
- `complete_session` (Calendar API) → обновляет completion_percent, session_ids
- Submit answer (SessionAPI) → обновляет ProgressService, **но не** Calendar activity

**Рекомендация:** Подписать Calendar на события ProgressService (через EventBus), чтобы при каждом submit_answer автоматически обновлялась calendar activity. Это устранит D-6 и обеспечит консистентность.

### R-2: Консолидация streak-механизма

Два стрика (Calendar и Statistics) — источник путаницы. **Рекомендация:** Один сервис отвечает за streak. Calendar читает streak из statistics или наоборот, но не считает параллельно.

### R-3: Вынести CalendarService в сервис-синглтон с поддержкой switch_user

Аналогично ProgressService, CalendarService должен поддерживать `switch_user(user_id)` и корректно обновлять все пути файлов.

### R-4: Удалить дублирование маршрутов

Маршруты Calendar API в `server.py` (1010-1145) должны быть удалены. Единственный регистрация — через `create_calendar_routes()`.

### R-5: Lazy Health Score Update

Вместо пересчёта и сохранения всех health scores при каждом GET, использовать ленивый подход: пересчитывать health score только при чтении и помечать «грязный» флаг при мутации (запись попытки, завершение сессии).

---

## Порядок исправления (по приоритету)

1. **D-1** (дублирование маршрутов) — удалить standalone маршруты из server.py
2. **D-2** (switch_user) — добавить переключение CalendarService
3. **D-3** (streak reset) — добавить `last_adapted_date` guard
4. **D-5** (structure_daily_mix slice) — сохранить `n_to_move` перед extend
5. **D-6** (complete_session) — обновлять tasks_attempted/solved
6. **D-4** (heatmap completion_percent) — использовать сохранённое значение
7. **D-15** (recent_sessions sort) — исправить ключ сортировки
8. **D-11** (phantom session) — проверка существования
9. **D-8** (phantom complex) — проверка существования
10. **D-10** (cache invalidation) — инвалидация после мутации
11. Остальные — по мере возможности
