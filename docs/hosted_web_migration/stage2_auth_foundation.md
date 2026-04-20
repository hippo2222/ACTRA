# Stage 2 Auth Foundation

Дата фиксации: `2026-04-07`

## Что уже сделано

- Добавлен отдельный hosted auth API:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- В hosted runtime введён request-aware `ctx.user_id`:
  - `desktop-app/routes/_context.py` больше не отдаёт process-wide `user_id` напрямую внутри HTTP request;
  - в hosted режиме `ctx.user_id` читается из auth session cookie;
  - при отсутствии auth session `ctx.user_id` для request-кода считается `guest`, чтобы legacy guest-checks не открывали доступ “последнему активному пользователю”.
- В `desktop-app/server.py` добавлен session cookie contract:
  - `ACTRA_SESSION_COOKIE_NAME`
  - `ACTRA_SESSION_COOKIE_SAMESITE`
  - `ACTRA_SESSION_COOKIE_SECURE`
  - `ACTRA_AUTH_SESSION_TTL_DAYS`
- В `desktop-app/server.py` добавлен временный hosted middleware:
  - первоначально hosted baseline удерживал process lock и временно переводил shared user-bound services на пользователя запроса;
  - дальше внутри Stage 2 это было сужено до AI-only синхронизации, потому что остальные user-bound flows начали переводиться на request-bound resolution.
- В hosted runtime legacy profile endpoints начали отделяться от auth:
  - `GET /api/users` отключён;
  - `POST /api/users` перенаправляется на `use_auth_register`;
  - `POST /api/users/select` перенаправляется на `use_auth_login`;
  - `GET /api/users/current`, `POST /api/users/update`, `POST /api/users/delete`, AI-keys routes используют current authenticated user.
- В `desktop-app/routes/misc_routes.py` user-bound misc flows переведены на hosted auth user:
  - `should-welcome` теперь возвращает hosted auth mode вместо списка локальных профилей;
  - consent/feedback routes в hosted режиме используют только current authenticated user.
- `frontend/Welcome/welcome.html` и `frontend/Welcome/welcome.js` больше не требуют отдельного hosted auth-экрана:
  - в `hosted_web` тот же `Welcome` работает как auth surface;
  - `modeSelect` используется как выбор между `Войти` и `Создать аккаунт`;
  - `modeLogin` принимает `login или email + password`;
  - `modeOnboarding` используется как hosted registration с `display name + login + email + password`.
- Hosted identity-модель расширена до явных полей:
  - `login`
  - `email`
  - `name` остаётся display name
  - `password_hash`
- Hosted user storage и auth contract приведены к web-семантике:
  - `POST /api/auth/register` принимает `name`, `login`, `email`, `password`, `avatar_seed`, `consent`;
  - `POST /api/auth/login` принимает `identifier` (`login` или `email`) и `password`;
  - `GET /api/auth/me` возвращает `authenticated`, `auth_source`, `login`, `email`, `name`.
- Для уже существующих hosted users добавлена автоматическая migration-подготовка:
  - при отсутствии `login/email` они синтетически достраиваются;
  - при отсутствии пароля создаётся временный synthetic password;
  - migration report сохраняется как локальный артефакт для разработчика/администратора.
- `desktop-app/routes/_helpers.py::_resolve_effective_user_id` теперь в hosted runtime игнорирует чужой `user_id` из query/body и берёт текущего authenticated user.
- `desktop-app/services/statistics_service.py` перестал делать `progress_service.switch_user(...)` для чтения статистики:
  - статистика читает progress через user-scoped reader;
  - hosted запрос к statistics больше не должен переключать process-wide progress context.
- `desktop-app/routes/_context.py` и `desktop-app/server.py` получили request-bound calendar wiring:
  - `calendar_service` для HTTP routes теперь резолвится как request-scoped service на текущего пользователя;
  - calendar/session-linked hosted запросы больше не обязаны опираться на глобальный mutable calendar user.
- server helper-слой для microcards и rollout telemetry перестал читать пользователя из `_headless_app_ctx.user_id` и переключён на request-aware user resolution.
- `desktop-app/api/session_api.py` получил hosted-safe ownership resolution для сессий:
  - `SessionAPI.get_session(..., user_id=...)` теперь не возвращает активную сессию другого пользователя даже если `session_id` известен;
  - `get_current_task`, `submit_answer`, `next_task`, `save_task_ui_state`, `get_iteration_results`, `get_final_results` приняли `user_id` и больше не обязаны опираться на `default_user_id` в hosted flow.
- `desktop-app/routes/session_routes.py` теперь пробрасывает current authenticated user в session-layer для task/final-results/iteration-results/save-ui-state/submit/next.
- `desktop-app/routes/ai_routes.py` убрал hosted fallback на `default_user` для `ai/status` и `ai/upload`: guest больше не может попасть в эти потоки через process default.
- `desktop-app/routes/microcards_routes.py` больше не использует hosted fallback на `default_user`:
  - summary/cache invalidation flows теперь берут только current request user;
  - mutating routes (`from-analysis`, `append-from-analysis`, `create-manual`, `archive`, `delete`, card CRUD, text import execute) больше не инвалидируют cache через legacy `default_user`.
- microcards helper-слой в `desktop-app/server.py` больше не падает в `default_user`:
  - `_microcards_service()`
  - `_invalidate_microcards_analytics_cache()`
  - `_microcards_review_live_integration_state_path()`
  - `_orchestrate_microcards_review_post_submit()`
  теперь резолвят request user или `guest`, но не legacy `default_user`.
- `desktop-app/api/session_api.py` получил единый runtime-aware resolver пользователя:
  - hosted runtime больше не использует `self._default_user_id` молча;
  - `default_user_id` оставлен как legacy compatibility accessor для desktop/test flows;
  - hosted path теперь требует explicit user resolution или контролируемо отказывается от операции.
- `desktop-app/services/microcards_service.py` и `desktop-app/services/microcards_analytics_service.py` переведены на ту же семантику:
  - в hosted runtime пустой `user_id` теперь приводит к `user_id_required_in_hosted_runtime`;
  - в legacy/desktop runtime `default_user` ещё остаётся совместимым fallback.

## Что проверено

- `python -m py_compile` для:
  - `desktop-app/routes/_context.py`
  - `desktop-app/routes/auth_routes.py`
  - `desktop-app/routes/users_routes.py`
  - `desktop-app/routes/misc_routes.py`
  - `desktop-app/server.py`
- Дополнительный regression-check по новому hosted auth/welcome flow:
  - `pytest -q tests/test_hosted_auth_http.py tests/test_main_screen_http.py tests/test_user_service.py`
  - `npx vitest run tests/welcome_hosted_auth.test.mjs`
  - `node --check frontend/Welcome/welcome.js`
- Hosted smoke-check на `register -> me -> users/current -> logout -> me`.
- Дополнительный hosted smoke-check:
  - `register -> statistics/overall -> calendar/schedule -> ui/quick-access -> me`;
  - при этом `_headless_app_ctx.user_id` до и после запроса остался одинаковым, то есть эти hosted routes больше не меняют process-wide current user сами по себе.
- Hosted ownership smoke-check:
  - `user1 register -> start session -> own /task = 200`;
  - `user2 /api/session/<foreign>/task = 404`;
  - `user2 /api/session/<foreign>/task/next = 404`;
  - `user2 /api/session/<foreign>/task/submit = 404`;
  - `user2 /api/session/<foreign>/final-results = 404`;
  - после этого `user1` всё ещё получает свой `/task = 200`, то есть чужой запрос больше не завершает активную сессию другого пользователя.
- AI hosted smoke-check:
  - guest `GET /api/editor/ai/status = 403`;
  - authenticated user `GET /api/editor/ai/status = 200`.
- Microcards hosted smoke-check:
  - guest `GET /api/microcards/summary = 403`;
  - authenticated user `GET /api/microcards/summary = 200`;
  - helper-level проверка показала, что `_microcards_service().user_id` и live-integration path резолвятся в authenticated user, а без auth — в `guest`, без fallback в `default_user`.
- Service-level strictness check:
  - `MicrocardsService(...)` без `user_id` в hosted runtime теперь падает с `user_id_required_in_hosted_runtime`;
  - `MicrocardsAnalyticsService.get_summary(user_id="")` в hosted runtime тоже больше не подставляет `default_user`;
  - в desktop runtime оба сервиса сохраняют legacy compatibility и продолжают резолвить `default_user`.
- Hosted end-to-end smoke-check после service-level changes:
  - authenticated `GET /api/microcards/summary = 200`;
  - authenticated `POST /api/session/<complex>/start = 200`;
  - authenticated `GET /api/session/<id>/task = 200`.

## Что сознательно ещё не считается завершённым

- Stage 2 ещё не закрыт по критерию выхода.
- Shared services всё ещё живут внутри одного `AppContextHeadless`.
- AI service всё ещё глобальный и для hosted runtime пока синхронизируется отдельным AI-only lock/refresh слоем.
- Route/helper-слой Stage 2 существенно дочищен, а ключевые service internals уже разделены на hosted strictness и legacy compatibility.
- Password recovery больше не UI-stub на `Welcome`; полноценный email reset flow уже реализован через reset token и письмо.
- Dev bridge всё ещё существует для локальной hosted-разработки, но не должен считаться нормальным multi-user UX.

## Главный технический долг внутри Stage 2

- Нужно дальше вынимать user-dependent поведение из process-wide singleton-сервисов, чтобы hosted runtime не зависел от request-time `switch_user`.
- Следующий долг внутри Stage 2 теперь уже уже точечный:
  - добрать оставшиеся singleton-dependent зоны вне route/helper cleanup (например calendar/progress bootstrap defaults и desktop-oriented compatibility paths);
  - решить, достаточно ли текущего hosted strictness для закрытия Stage 2, или ещё нужно убрать последние process-wide переключения из глубины сервисов.
- После этого только можно переводить Stage 2 из `in_progress` в `done`.

## Auth Follow-up: 2026-04-17

- Hosted auth slice функционально дозрел до нормального account lifecycle:
  - email verification status и token storage добавлены в hosted identity;
  - `POST /api/auth/resend-verification` и `GET|POST /api/auth/verify-email` реализованы;
  - `Welcome` обрабатывает verification link и показывает post-registration verification state;
  - `POST /api/auth/forgot-password` и `POST /api/auth/reset-password` реализованы;
  - `Settings` переводит смену email в pending-confirmation flow, а не в мгновенный swap active email.
- Security hardening auth-среза уже есть в коде:
  - anti-enumeration для публичного auth;
  - rate limiting на register/login/resend/verify/forgot/reset;
  - storage-backed shared limiter;
  - auth sender больше не fallback-ится на feedback SMTP.
- Что ещё остаётся operationally:
  - выставить production `ACTRA_AUTH_SMTP_*` и `ACTRA_AUTH_PUBLIC_BASE_URL`;
  - прогнать реальный доменный sender smoke;
  - при желании заменить plain-text auth-письма на HTML-шаблоны.
