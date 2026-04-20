# Stage 2 Follow-up - 2026-04-08

## Что зафиксировано

- `ProgressService`, `UserProgressManager` и `CalendarService` переведены на ту же runtime-aware семантику, что и microcards:
  - в `hosted_web` пустой `user_id` больше не уходит в молчаливый `default_user`;
  - в legacy/desktop `default_user` остаётся как compatibility fallback.
- `desktop-app/routes/session_routes.py::_resolve_active_sessions_user_id(...)` больше не использует `default_user` в hosted runtime.
- `desktop-app/api/calendar_api.py::register_calendar_api(...)` больше не выставляет `default_user` как часть публичного сигнатурного контракта.
- `desktop-app/server.py::AppContextHeadless.__init__(...)` теперь принимает optional startup user, чтобы bootstrap не выглядел как обязательный `default_user` path.
- `desktop-app/api/session_api.py` получил hosted-only serialization layer для controller-bound методов:
  - используется общий `RLock`;
  - lock охватывает `start_session`, `start_custom_session`, `pause_session`, `save_task_ui_state`, `resume_session`, `get_current_task`, `submit_answer`, `next_task`, `skip_task`, `cancel_session`, `get_iteration_results`;
  - nested вызовы внутри `SessionAPI` остаются безопасными за счёт reentrant semantics.

## Что проверено

- `python -m py_compile` прошёл для:
  - `desktop-app/services/progress_service.py`
  - `desktop-app/services/user_progress_manager.py`
  - `desktop-app/services/calendar/calendar_service.py`
  - `desktop-app/routes/session_routes.py`
  - `desktop-app/api/calendar_api.py`
  - `desktop-app/server.py`
- Strictness-check подтвердил:
  - hosted `ProgressService(...)` без `user_id` -> `user_id_required_in_hosted_runtime`
  - hosted `UserProgressManager(...)` без `user_id` -> `user_id_required_in_hosted_runtime`
  - hosted `CalendarService(...)` без `user_id` -> `user_id_required_in_hosted_runtime`
  - legacy desktop для всех трёх сервисов по-прежнему резолвит `default_user`
- Hosted session/controller check подтвердил:
  - `SessionAPI` поднимает `RLock` и guard context корректно создаётся;
  - два hosted пользователя на реальном `head_ct_demo_complex` успешно проходят `register -> session/start -> /task`;
  - controller state всё ещё остаётся общим и после запросов указывает на последнюю активную сессию, но теперь controller-bound flows не могут interleave-иться параллельно.

## Главный незакрытый blocker Stage 2

- Route/helper fallback-и теперь почти дочищены, а session flow временно защищён hosted serialization layer, но всё ещё опирается на process-wide mutable controller state:
  - `ComplexSessionController`
  - `TaskController`
  - `SessionAPI._controller.current_session_id`
  - `SessionAPI._controller.current_task_ref`
- Для текущего критерия выхода `Stage 2` этого достаточно: hosted multi-user baseline больше не допускает silent current-user drift и controller-bound request interleaving.
- При этом это сознательно не считается финальной архитектурой session layer; более глубокое вынимание общего controller state переносится в отдельное последующее решение, если оно понадобится до релиза.

## Следующий практический шаг

- Следующий шаг уже вне `Stage 2`:
  - переходить к `Stage 3` и выносить hosted persistence;
  - не ломать при этом зафиксированные Stage 2 инварианты: request-scoped identity, hosted strict user resolution, ownership checks и controller serialization layer.

## Postscript: 2026-04-13

- User-facing hosted auth surface больше не остаётся только API-базой:
  - `Welcome` в `hosted_web` работает как login/register экран;
  - вход поддерживает `login` или `email`;
  - hosted user model расширена до `login + email + password`, где `name` остаётся display name.
- Для legacy hosted users добавлен synthetic migration-path с локальным migration report.
- Dev bridge остаётся только локальным fallback и больше не считается основным способом проверки hosted auth UX.
