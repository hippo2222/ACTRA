# Фаза 6 — Интеграционный сквозной тест (E2E)

**Дата:** 2026-02-11  
**Файл теста:** `desktop-app/tests/integration/test_phase6_e2e.py`  
**Результат:** ✅ 18/18 тестов пройдено

---

## Покрытый путь

| Шаг | Эндпоинт | Результат |
|-----|----------|-----------|
| 1. Создать пользователя | `POST /api/users` | ✅ |
| 2. Выбрать пользователя | `POST /api/users/select` | ✅ |
| 3a. Создать модуль | `POST /api/editor/module/new` | ✅ |
| 3b. Создать топик | `POST /api/editor/topic/new` | ✅ |
| 3c. Создать задачу (test) | `POST /api/editor/task/new` | ✅ |
| 4. Сохранить данные задачи | `POST /api/editor/task/:m/:t/:id` | ✅ |
| 5. Собрать комплекс | `POST /api/complexes` | ✅ |
| 6a. Запустить сессию | `POST /api/session/:cid/start` | ✅ |
| 6b. Получить текущую задачу | `GET /api/session/:sid/task` | ✅ |
| 6c. Отправить ответ | `POST /api/session/:sid/task/submit` | ✅ |
| 6d. Продвинуть / завершить | `POST /api/session/:sid/task/next` | ✅ |
| 7. Проверить итоги сессии | `GET /api/session/:sid/iteration-results` | ✅ |
| 8. Проверить статистику | `GET /api/statistics/overall`, `/time-dynamics` | ✅ |
| 9. Проверить календарь | `GET /api/calendar/today`, `/activity` | ✅ |
| 9b. Записать попытку | `POST /api/calendar/attempt` | ✅ |
| 10. Заморозить комплекс | `POST /api/calendar/complex/:cid/freeze` | ✅ |
| 11. Разморозить комплекс | `POST /api/calendar/complex/:cid/unfreeze` | ✅ |
| 12. Очистка | DELETE complex, task, module dir, user | ✅ |

---

## Затронутые подсистемы

- **User Service** — создание, выбор, удаление профиля
- **Editor (StorageService)** — модуль → топик → задача → сохранение
- **ComplexService** — создание комплекса с валидацией task_ref
- **SessionAPI / ComplexSessionController** — старт, get_task, submit, next, results
- **TaskEvaluatorService** — оценка test-type задания (single_choice)
- **StatisticsService** — overall stats, time dynamics
- **CalendarService** — today plan, activity heatmap, record_attempt, freeze/unfreeze
- **ProgressService** — запись результата, прогресс комплекса

## Найденные проблемы

Ни одного блокирующего дефекта не обнаружено. Все 18 шагов прошли с первой попытки после добавления `record_attempt` перед freeze (необходимо для создания записи прогресса со статусом `IN_PROGRESS`).

### Примечание

Freeze требует предварительной записи хотя бы одной попытки через `/api/calendar/attempt` с `user_grading=1` — иначе комплекс не имеет записи прогресса в календаре и freeze возвращает `complex_not_active`. Это **корректное поведение** — нельзя заморозить комплекс, который ещё не начат.

---

## Как запустить

```bash
cd desktop-app
python -m pytest tests/integration/test_phase6_e2e.py -v
```

Тест создаёт уникальные данные (UUID-суффикс) и полностью очищает за собой.
