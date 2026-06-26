# Current State

Hosted infra + production launch contour has been fully verified on the production VPS root@91.99.223.246 (Hetzner) on 2026-06-25 / 2026-06-26:

- live Nginx reverse proxy with SSL (Let's Encrypt) is fully operational;
- live `/api/ready.launch_contract` is `green` with `runtime_ready = true` on the production server;
- live hosted auth lifecycle (`register -> verify -> me -> logout -> login -> forgot-password request`) is fully verified on the public domain via Brevo SMTP;
- backup/restore scripts for Postgres and MinIO are adapted for containerized run and successfully verified via DR drill.
- the operational ops checklist is closed (see `hosted_launch_ops_checklist.md`).

Hosted infra + production launch contour is green on 2026-06-25 / 2026-06-26:

- `/api/ready` exports a green `launch_contract` verifying the overall production baseline;
- all operational steps (proxy, SSL, SMTP, backup drill) have been executed and verified on the live site `https://actra.site`.

Readiness + degraded signaling contour is now finish-line green on 2026-04-19:

- `/api/ready` now exports a canonical `finish_line.subsystems` matrix by hosted product contour;
- each subsystem carries status details;
- this keeps only `import/export` as transitional, while `auth` and `hosted infra` are now fully `green`;
- one canonical strict hosted command exists: `npm run smoke:readiness:hosted`.

AI editor extras contour is now finish-line green on `2026-04-19`:

- public hosted AI routes now return one explicit placeholder contract: `404 ai_mode_in_progress` with attached feature flags, instead of staying partially live by default;
- editor `theory analysis` modal now renders one honest `Функционал в разработке` state and skips live AI fetches when `ai_mode` is disabled;
- AI-driven `microcards from-analysis` routes now follow the same placeholder contract, so the AI contour is no longer leaking through adjacent microcards surfaces;
- one canonical strict hosted command now exists for this placeholder contour: `npm run smoke:ai-placeholder:hosted`.

Linked theory / open flows contour is now finish-line `green` on `2026-04-19`:

- hosted linked-library theory snapshots no longer silently fall back to workspace theory when linked publication enrichment is unresolved, blocked, or unavailable in `hosted_web`;
- embedded theory snapshot now stays primary only for embedded-only linked publications without a separate `catalog_item_id` binding, instead of acting as a universal stale-link fallback;
- hosted `complex -> attached theory -> reopen -> theory center visibility` now has one canonical strict hosted gate: `npm run smoke:linked-theory-open:hosted`;
- broader `Complexes` browser/product smoke still lives outside this gate, but it no longer represents a hosted source-of-truth gap for linked theory opening.

Catalog + library + publication contour is now finish-line `green` on `2026-04-19`:

- hosted `HostedCatalogService` no longer bootstrap'ит catalog state from shadow `catalog.json` when Postgres-backed storage is empty;
- hosted catalog publish/library mutations no longer perform silent shadow-write back into `catalog.json` after successful repository-backed persistence;
- hosted `publish -> list -> detail/version -> add to library -> library status -> visibility/access-code transition` now has one canonical strict hosted gate: `npm run smoke:catalog-library:hosted`;
- blocked hosted catalog reads and writes now surface canonical degraded `503 hosted_shadow_*_blocked` payloads instead of collapsing into generic `500`;
- broader `linked theory / open flows` remains a separate neighboring contour, but it no longer keeps `catalog + library + publication` in transitional status.

Theory editor + theory center contour is now finish-line `green` on `2026-04-19`:

- hosted `HostedTheoryService` no longer bootstrap'ит theory metadata/content/history from shadow `theory.json` files when Postgres-backed storage is empty;
- hosted theory write-path no longer performs silent filesystem shadow-write after successful repository-backed persistence;
- hosted `create/list/open/update/upload-image/history/restore/delete` and `theory center overview` now have one canonical strict hosted gate: `npm run smoke:theory-editor:hosted`;
- blocked hosted reads and writes for theory routes now return canonical degraded `503 hosted_shadow_*_blocked` payloads instead of generic `500`;
- broader browser/layout smoke for the theory workspace still lives outside this gate, but it no longer represents a hosted source-of-truth gap.

Complex editor CRUD contour is now finish-line `green` on `2026-04-19`:

- hosted complex metadata no longer bootstrap'ится from `complexes.json` when Postgres-backed storage is empty;
- hosted complex write-path no longer performs silent shadow-write to `complexes.json` after successful hosted persistence;
- hosted `autosave`, `history` and `restore` now run through explicit hosted persistence instead of filesystem history as product truth;
- hosted `list/open/create/update/sync/autosave/history/restore/publish/delete` now have one canonical strict hosted gate: `npm run smoke:complex-editor:hosted`;
- blocked hosted reads and writes for complex-editor surfaces now return canonical degraded `503 hosted_shadow_*_blocked` payloads instead of generic `500`.

Task editor CRUD contour is now finish-line `green` on `2026-04-19`:

- hosted `editor catalog`, `GET /api/editor/task/...`, `bootstrap`, `save` and `delete` now have one canonical strict hosted gate: `npm run smoke:task-editor:hosted`;
- blocked hosted reads and writes on task-editor routes now surface canonical degraded `503 hosted_shadow_read_blocked` / `503 hosted_shadow_write_blocked` payloads instead of collapsing into generic `500`;
- hosted CRUD truth is verified through one end-to-end authoring contour: `module -> topic -> draft bootstrap -> save -> reopen -> catalog -> delete`;
- ownership visibility is now explicitly part of the hosted proof, so foreign-owned tasks do not leak into the current user's editable catalog/load surface;
- broader editor browser smoke still belongs to the wider release suite, but it no longer keeps `task editor CRUD` in transitional status.

Assets + media contour is now finish-line `green` on `2026-04-19`:

- hosted `SessionAPI` no longer turns path-only task/question/answer media into `/api/local-image?path=...` URLs inside current-task payloads;
- path-only hosted media refs are now stripped from those payloads instead of silently surviving as normal runtime truth;
- `SequenceUI`, `TestUI`, `ClickUI`, `DrawUI`, `OpenAnswerUI` and the shared `S1` task renderer now explicitly choose canonical `asset_url` / `asset_id` refs before any legacy `image_path` field, so mixed payloads stop preferring the wrong source;
- `click_editor`, `draw_editor`, `open_answer_editor` and `test_editor` now follow the same asset-first normalization rule for nested `image` payloads, so editor previews and normalized question/answer payloads stop discarding hosted asset refs;
- one canonical strict hosted gate now exists: `npm run smoke:assets-media:hosted`;
- legacy `path` remains only as a compatibility bridge and no longer keeps this contour in transitional status.

Calendar + schedule + memory health contour is now finish-line green on `2026-04-19`:

- hosted calendar/settings/progress/activity now have one canonical strict hosted gate: `npm run smoke:calendar:hosted`;
- hosted `CalendarService` reads `today`, `schedule`, `health` and `activity` through `HostedCalendarRepository`-style docs instead of treating calendar JSON as normal hosted truth;
- public `calendar_api` routes now surface canonical hosted degraded payloads for blocked hosted reads instead of collapsing them into generic `500`;
- local `settings.json`, `progress.json`, `activity.json` and соседние calendar docs remain only as `legacy_local` compatibility paths and no longer keep this contour in transitional status.

Statistics + progress contour is now finish-line green on `2026-04-19`:

- hosted progress and statistics persistence now have one canonical strict hosted gate: `npm run smoke:statistics:hosted`;
- hosted `UserProgressManager` no longer bootstrap'ится из `progress.json` and no longer performs silent shadow-write after repository-backed save;
- hosted `StatisticsService` reads `overall` and `time-dynamics` through hosted progress/calendar repositories and fails explicitly when those storages are unavailable;
- local `progress.json` and `complex_statistics.json` remain only as `legacy_local` compatibility paths and no longer keep this contour in transitional status.

Main + quick access contour is now finish-line green on `2026-04-19`:

- hosted `main` auth gating plus `quick access` read/write flows now have one canonical strict hosted gate: `npm run smoke:main-quick-access:hosted`;
- hosted `quick access` uses `user.settings["web_ui_state"]` as the source of truth for pinned/recent/settings, while paused-session metadata comes through the hosted session repository contract;
- blocked hosted reads for identity/session storage now surface explicit degraded payloads inside that gate instead of silently falling back to `ui_state.json`;
- local `ui_state.json` remains only as a `legacy_local` runtime path and no longer keeps `main + quick access` in transitional status.

Microcards contour is now finish-line green on `2026-04-19`:

- hosted deck documents, review/session state and analytics all run through explicit Postgres-backed source of truth;
- hosted empty-storage path no longer bootstrap'ится из shadow deck/review files, so file-backed state stopped being silent hosted truth even on first read;
- one canonical strict hosted gate exists: `npm run smoke:microcards:hosted`;
- AI-driven deck generation remains explicitly blocked in hosted runtime and is classified under the separate `AI` contour instead of keeping core microcards transitional.

Microcards hosted review/runtime gate landed on `2026-04-19`:

- hosted `summary`, `queue` and `review submit` now run through a real hosted-backed review/session/event source of truth instead of staying intentionally blocked;
- `HostedMicrocardsReviewRepository` + `HostedMicrocardsAnalyticsService` now back review-state persistence and analytics in hosted runtime, with explicit degraded behavior when Postgres-backed storage is unavailable;
- one canonical strict hosted gate now exists for this contour: `npm run smoke:microcards:hosted`;
- this gate is now part of the green baseline rather than a partial transitional step.

Microcards hosted deck-documents landed on `2026-04-19`:

- hosted `microcards` deck library, manual deck/card editing and text import now run through a real hosted-backed deck-document source of truth instead of being universally pre-blocked;
- `HostedMicrocardsService` + `HostedMicrocardsRepository` now own deck payload persistence in hosted runtime, with explicit degraded behavior when Postgres-backed storage is unavailable;
- `summary`, `queue` and `review submit` are no longer intentionally blocked: they now use hosted review/session documents instead of filesystem truth;
- this slice is now fully absorbed into the green hosted contour.

Microcards strictness baseline landed on `2026-04-19`:

- hosted public `microcards` routes now fail explicitly instead of reading/writing file-backed deck/review state under `data/microcards` and `data/users/.../microcards`;
- the new degraded payload advertises a canonical `public_microcards` route contract plus hosted/runtime service contracts, so hosted blockers are no longer ambiguous;
- stateless `microcards` text parse remains available in hosted runtime, while storage-backed summary/editor/review flows now either use hosted-backed truth or return explicit degraded/error behavior;
- `MicrocardsAnalyticsService` still raises explicit hosted shadow-read blocked errors, while `HostedMicrocardsAnalyticsService` now supplies the real hosted analytics path.

Import/export contract slice landed on `2026-04-19`:

- public task/complex import routes now advertise `public_editor_import_export` instead of `legacy_editor_import`;
- workspace-import marker payloads are explicitly rejected on public hosted routes;
- task and complex import services now expose matching `service_contract` metadata for hosted verification.
- public hosted archive flows no longer silently use shadow-filesystem state; legacy-dependent paths now surface explicit degraded/error behavior instead.
- public text `export` and text `import execute` now run through hosted-backed `load_task` / `save_task` storage APIs instead of direct `modules_dir` reads/writes.
- public task archive `export` now also works through hosted-backed task payload export plus asset resolution, without requiring a local task directory as source of truth.
- public task archive `confirm` now executes through hosted-backed `save_task/delete_task/create_module/create_topic` storage APIs and no longer depends on filesystem move/rollback transactions.
- public hosted `task archive confirm` now streams either success or explicit hosted degraded payload instead of being pre-blocked at the route layer.
- public complex archive `export` now also works through hosted-backed complex/task/theory payload export, with local directory walking kept only as compatibility fallback where a shadow file still exists.
- public complex archive `confirm` now executes through hosted-backed rollback actions for task/module/topic, theory and complex mutations instead of full filesystem state backup/restore.
- public hosted `complex archive confirm` now streams either success or explicit hosted degraded payload instead of being pre-blocked at the route layer.
- import/export contour now has one canonical strict hosted gate: `npm run smoke:import-export:hosted`.
- that gate was verified green by a local run on `2026-04-19`.

## Canonical Finish-Line Matrix

С `2026-04-19` cross-product hosted finish-line больше не описывается кусочно только через `smoke_matrix.md` и readiness по `complex passage`.

Каноническая матрица `green/transitional/blocked` теперь живёт в:

- `hosted_finish_line_matrix.md`
- `hosted_scope_decision_ai_import_microcards_2026-04-19.md`

Именно она считается entry point для вопроса "что еще осталось до `Product + Launch` по hosted-версии сайта".

С `2026-04-19` по scope отдельно зафиксировано:

- `import/export` остаётся обязательной частью finish-line;
- `AI` допустимо временно закрыть только полной явной заглушкой `in progress`, без partially-live поведения.

## Complex Passage

Для домена "прохождение комплексов" canonical contract теперь вынесен в:

- `complex_passage_spec.md`
- `complex_passage_definition_of_done.md`

Именно эти документы нужно читать первыми перед любыми изменениями в session lifecycle, `ui_state`, pause/resume, iteration flow и final results.

С `2026-04-18` phase 7 по documentation/readiness layer тоже закрыт:

- `smoke_matrix.md` теперь содержит отдельный раздел `Complex Passage` с readiness-статусами по подпотокам;
- `README.md`, `progress.md` и этот snapshot синхронизированы по текущему factual статусу complex passage;
- boot-path ambiguity для Playwright hosted gate снят: harness теперь поднимает реальный `hosted_web`, а residual risk сузился до локального dev-bridge/fallback слоя без production infra.
- отдельный strict infra contour через `hosted_entrypoint.py` + Postgres/MinIO + hosted auth тоже собран в коде, но его green-status еще не подтвержден в этой среде из-за отсутствия Docker.

С `2026-04-17` phase 6 по hosted test contour тоже закрыт:

- зафиксирован один явный automated gate: `complex_passage_hosted_gate.md`;
- release-команда для него: `npm run smoke:complex-passage:hosted`;
- gate намеренно отделен от полного exploratory `tests/complex_audit` прогона и идет в `headless + workers=1`;
- в gate добавлен отдельный restart-сценарий на восстановление active complex session после перезапуска runtime;
- `frontend/S2/index.html` выровнен под текущий UI-контракт без mojibake в complex passage result surfaces.

С `2026-04-17` phase 3 по session persistence закрыт в runtime:

- source of truth для complex sessions в `hosted_web` переключен на `HostedSessionRepository`;
- `data/users/.../sessions/*.json` больше не является обязательным runtime-хранилищем для hosted flow;
- readiness/health теперь явно отражают `session_repository_storage_ready` и session-level degraded state.

С `2026-04-17` phase 4 по complex statistics persistence тоже закрыт в runtime:

- source of truth для `complex_statistics` в `hosted_web` переключен на hosted-backed repository;
- legacy `complex_statistics.json` используется только как shadow fallback / bootstrap-источник;
- финальная запись результатов больше не должна молча деградировать до локального файла без explicit hosted policy.

С `2026-04-17` phase 5 по runtime isolation / concurrency закрыт в hosted runtime:

- `SessionAPI` больше не держит correctness на одном глобальном `ComplexSessionController` / `TaskController`;
- в `hosted_web` controller-bound flow теперь работает через session-scoped controller pool и per-session lock вместо одного process-wide `RLock`;
- стартовые операции получают отдельный isolated controller-context, после чего runtime закрепляет controller за конкретной session;
- отмена и завершение сессии очищают hosted controller pool, чтобы не держать stale in-process state;
- partial retry для shuffled TEST теперь трактует `test_failed_subtests` как shuffled-position contract с legacy fallback для старых данных.

### Readiness по подпотокам

- Session lifecycle — `green`
  start / pause / resume / cancel / `resume_target` зафиксированы canonical spec и целевыми wave1 regressions.
- S1 task runtime — `green`
  task families, submit/check validation, reload restore и checked-state подтверждены automated gate.
- Retry / skip / difficulty / iteration engine — `green`
  очередь, retry semantics, shuffled TEST partial retry и progression между итерациями покрыты wave1/wave2 suite.
- S2 / S3 result surfaces — `green`
  flow/results contracts выровнены, а `frontend/S2/index.html` больше не является known mojibake surface внутри complex passage.
- Results propagation — `green`
  финал комплекса подтвержденно доходит до statistics и calendar контура.
- Hosted persistence — `green`
  session persistence и complex statistics persistence переведены на hosted-backed source of truth.
- Runtime isolation / concurrency — `green`
  correctness больше не держится на одном global controller/lock.
- Curated hosted gate — `green`
  `npm run smoke:complex-passage:hosted` является одним явным release-blocking automated contour.
- True hosted runtime boot inside gate harness — `green`
  `tests/complex_audit/helpers/runtime_server.mjs` теперь поднимает `desktop-app/server.py` c явным `ACTRA_RUNTIME_MODE=hosted_web`, проверяет `runtime_mode` через `/api/health` и проходит curated gate в реальном hosted runtime; оставшийся локальный риск ограничен dev-auth bridge и shadow-write fallback вместо production Postgres/S3 entrypoint.
- Production-like hosted infra contour — `green`
  Отдельный contour `npm run smoke:complex-passage:hosted:infra` теперь подтвержден recorded green run от `2026-04-20` (`60 passed`) на `docker-compose.hosted.yml` + `desktop-app/hosted_entrypoint.py` без dev bridge и shadow-write fallback.

Дата обновления: `2026-04-20`

Этот документ является текущей операционной точкой входа по hosted web migration.
Он нужен как короткий factual snapshot: что уже реализовано, что еще transitional и что делать дальше.

## Где мы находимся по этапам

- `Stage 5` закрыт как backend baseline:
  - publish model живет на `CatalogItem` / immutable `CatalogVersion`;
  - linked-library contract уже реализован в backend;
  - access-state semantics уже живут в service layer.
- `Stage 6` закрыт по текущей read-only hosted-модели:
  - `Catalog` живой;
  - `Комплексы` уже знают про linked-library, visibility и add-by-code;
  - `Центр теории` уже фильтрует видимость под hosted user;
  - `Редактор теории` уже ведет author-side publication management;
  - hosted surfaces больше не притворяются, что library add создает editable copy.
- `Stage 7` закрыт как hardening/release-readiness baseline:
  - зафиксирована read-only linked-library модель;
  - собран legacy inventory для migration utilities;
  - финальный handoff оформлен и operational debt зафиксирован отдельно.

## Что реально есть в backend

### Hosted auth и email lifecycle

Высокосигнальные файлы:
- `desktop-app/routes/auth_routes.py`
- `desktop-app/routes/users_routes.py`
- `desktop-app/services/hosted_user_service.py`
- `desktop-app/persistence/hosted_identity_repository.py`
- `desktop-app/server.py`

Реально существующий auth/email contract:
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `POST /api/auth/resend-verification`
- `GET|POST /api/auth/verify-email`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/users/update`
- `POST /api/users/resend-email-change`

Что важно по semantics:
- регистрация больше не считается завершённой по одному только вводу email: у hosted user есть `email_verified_at` и verification token storage;
- подтверждение почты и смена email работают по ссылке из письма, а не по одноразовому коду;
- смена email в `Settings` staged: новый адрес становится `pending`, а активный email не меняется до подтверждения;
- password recovery больше не является UI-заглушкой и работает через reset token + письмо;
- публичные auth-flow и email-flow уже прошли rate limiting и anti-enumeration hardening;
- shared limiter больше не только process-local: при наличии Postgres лимиты живут в общем storage, а shadow/file fallback остаётся только совместимым fallback;
- auth mailer больше не fallback-ится на feedback sender: без явных `ACTRA_AUTH_*` переменных auth-письма считаются `not_configured`.

Высокосигнальные файлы:
- `desktop-app/services/catalog_service.py`
- `desktop-app/routes/catalog_routes.py`
- `desktop-app/routes/complexes_routes.py`
- `desktop-app/routes/theories_routes.py`
- `desktop-app/routes/theory_center_routes.py`

Реально существующий catalog contract:
- `GET /api/catalog/items`
- `GET /api/catalog/items/<item_id>`
- `GET /api/catalog/items/<item_id>/versions/<version_id>`
- `POST /api/catalog/items/<item_id>/library`
- `GET /api/catalog/items/<item_id>/library-status`
- `POST /api/catalog/items/<item_id>/versions/<version_id>/add-to-library`
- `POST /api/catalog/items/<item_id>/versions/<version_id>/add-to-library/preview`
- `GET /api/catalog/items/<item_id>/versions/<version_id>/library-status`
- `POST /api/catalog/items/<item_id>/visibility`
- `POST /api/catalog/access-code/resolve`
- `POST /api/catalog/complexes/<workspace_complex_id>/publish`
- `POST /api/catalog/theories/<theory_id>/publish`

Реально существующий library contract:
- `GET /api/complex-library`
- `GET /api/complex-library/<library_entry_id>`
- `POST /api/complex-library/<library_entry_id>/access-code`
- `DELETE /api/complex-library/<library_entry_id>`
- `GET /api/theory-library`
- `GET /api/theory-library/<library_entry_id>`
- `POST /api/theory-library/<library_entry_id>/access-code`
- `DELETE /api/theory-library/<library_entry_id>`

Что важно по semantics:
- `Add to Library` создает или переиспользует linked entry, а не личную deep-copy.
- Catalog/library в hosted web зафиксированы как read-only surfaces:
  - пользователь находит публикацию;
  - добавляет ссылку в библиотеку;
  - открывает linked content;
  - не получает editable copy как побочный эффект.
- Access states уже живут в коде:
  - `active`
  - `requires_access_code`
  - `revoked`
  - `deleted_source`
- В service contract уже используются:
  - `pinned_version_id`
  - `resolved_version_id`

## Что реально есть в UI

Высокосигнальные файлы:
- `frontend/Catalog/index.html`
- `frontend/Catalog/catalog.js`
- `frontend/Complexes/index.html`
- `frontend/Editor/theory_center.js`

`Catalog`:
- живая страница каталога уже существует;
- поддерживает list/detail flow;
- умеет работать с visibility, access-code и library-status;
- уже не является только макетом или design spike.

`Комплексы`:
- author-side publication management уже живет на странице;
- есть переход в каталог;
- работает add-by-code flow для комплексов;
- карточки понимают ownership, source lineage и linked-library origin;
- у non-author комплексов скрыт `Редактировать`;
- linked theory для добавленного комплекса открывается через library entry текущего пользователя или через embedded fallback, если отдельной entry нет;
- удаление linked complex из библиотеки теперь может безопасно снять auto-added linked theory, но не удаляет вручную добавленные или все еще разделяемые theory entries.

`Центр теории`:
- в hosted runtime не должен показывать пользователю чужие неимпортированные комплексы и теории;
- уже использует visibility-aware filtering поверх library/workspace semantics;
- умеет удалять linked theory из personal library без воздействия на source publication.

## Что было стабилизировано `2026-04-14` - `2026-04-16`

- `Каталог` начал показывать владельцу его собственные публикации, включая `По коду` и `Приватно`.
- На `Комплексах` появился рабочий сценарий добавления комплекса по коду.
- Исправлено открытие theory у комплекса, добавленного по коду:
  - сначала через library entry текущего пользователя;
  - затем через embedded snapshot fallback, если отдельной theory-library entry нет.
- Исправлено открытие привязанной theory у автора комплекса при stale `linked_library` ссылке.
- `Центр теории` перестал светить чужие неимпортированные материалы.
- У неавтора комплекса скрыт action `Редактировать`.
- Добавлен симметричный `DELETE /api/theory-library/<library_entry_id>`.
- Удаление linked complex теперь использует safe cascade для auto-added linked theory entries:
  - orphaned auto-added theory удаляется;
  - вручную добавленная или разделяемая theory остается в библиотеке.

## Что стабилизировано `2026-04-17` по hosted auth/email

- `Welcome` больше не пускает регистрацию в приложение как “уже подтверждённый email”:
  - после `register` появляется verification state;
  - письмо ведёт обратно на `Welcome` с `verify_email_token`;
  - `resend verification` работает из того же flow.
- `Settings` больше не меняет active email мгновенно:
  - новый email сохраняется как `pending`;
  - подтверждение по ссылке переводит его в active;
  - duplicate email change больше не раскрывает, что адрес занят другим аккаунтом.
- `forgot password` стал рабочим flow:
  - запрос письма живёт на `Welcome`;
  - reset link возвращает на `Welcome`;
  - пароль меняется только по валидному reset token.
- Security polish для auth-flow зафиксирован в коде:
  - neutralized public conflict/errors;
  - added shared/distributed rate limiting over storage;
  - removed auth-email fallback на feedback SMTP sender.

## Что сейчас еще не финально

- Fallback при недоступном Postgres все еще остается отдельным operational risk, но degraded smoke на `2026-04-16` уже подтвердил текущий policy/ready/error baseline.
- Hosted auth email delivery has been fully verified and completed on 2026-06-25 / 2026-06-26:
  - `ACTRA_AUTH_PUBLIC_BASE_URL=https://actra.site` is configured and verified.
  - SMTP credentials for Brevo are verified and operational.
  - End-to-end public smoke test is verified and passing.

## Что сейчас transitional

- Если Postgres недоступен, runtime все еще может использовать filesystem shadow / legacy fallback, но уже не для всех hosted surfaces.
- Для `catalog/library` hosted read-path'ов shadow reads больше не считаются допустимым fallback: эти routes теперь fail-fast'ят как degraded `503 hosted_shadow_read_blocked`, а `catalog.json` больше не bootstrap'ит hosted catalog state как нормальный source of truth.
- Для остальных hosted services shadow reads пока остаются compatibility-слоем, а shadow writes blocked-by-default и разрешаются только явным ops/dev opt-in через `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1`.
- `/api/ready` теперь явно показывает degraded-state по shadow fallback:
  - `persistence.hosted_shadow_write_fallback_enabled`
  - `degraded.shadow_fallback_active`
  - `degraded.shadow_read_fallback_blocked`
  - `degraded.shadow_write_fallback_blocked`
- Hosted catalog/library read-routes больше не маскируют blocked shadow read под generic `500` и возвращают явный operational/degraded ответ `hosted_shadow_read_blocked`.
- Hosted write-routes для `editor/import/theories/complexes/catalog` больше не маскируют blocked shadow write под generic `500` и возвращают явный operational/degraded ответ `hosted_shadow_write_blocked`.
- Restricted `workspace_import_routes` остаются внутренним bridge-слоем и не являются частью целевого hosted catalog/library UX.
- В hosted runtime этот HTTP bridge теперь заблокирован по умолчанию и может быть включен только явным ops/dev opt-in через env + internal header.
- Legacy imported copies и новые linked entries пока сосуществуют в одном дереве.
- Compatibility codepaths around linked-library metadata still exist in code, but they no longer act as hosted product truth for linked theory open flows.

## Legacy Copy-Based Inventory

Что еще живет в данных и сервисах:
- `created_via = workspace_import` остается валидным lineage-маркером в workspace-объектах и read-model helpers.
- `created_via = archive_import` остается рядом как отдельная legacy import-ветка.
- `workspace_import_routes.py` и `workspace_import_service.py` все еще живут как internal bridge для materialization/import, даже после отказа от user-facing fork.
- Hosted services все еще поддерживают filesystem shadow при недоступном Postgres:
  - `hosted_user_service.py`
  - `hosted_storage_service.py`
  - `hosted_theory_service.py`
  - `hosted_complex_service.py`
- `hosted_catalog_service.py` больше не bootstrap'ит hosted catalog state из `catalog.json` и не использует его как live shadow-read fallback для catalog/library requests.
- После Stage 7 cleanup это уже не симметричный fallback:
  - non-catalog read-paths могут деградировать в shadow для compat/dev;
  - catalog/library read-paths должны fail-fast'ить, а не возвращать stale shadow state;
  - write-paths не должны тихо писать в shadow без explicit opt-in.

Что еще живет в UI:
- `frontend/Complexes/index.html` различает linked-library и legacy imported content через `created_via` и ownership badges.
- `frontend/Complexes/create.html` больше не показывает hosted-пользователю workspace-import preview/execute actions; осталась только defensive no-op защита для legacy вызова.
- `frontend/Editor/theory_center.js` показывает imported / archive-import provenance рядом с linked-library semantics.
- `frontend/Editor/import_manager.js` больше не открывает user-facing workspace-import flow и fail-fast'ит legacy вызов как internal-only.
- `frontend/Editor/dashboard.js` больше не открывает workspace-import preview из hosted surfaces и удаляет такие кнопки из Theory Hub рендера.

Практическая граница Stage 7:
- linked-library entries считаются целевой hosted-моделью;
- legacy imported copies считаются migration debt;
- user-facing fork из library не входит в текущий roadmap и не является целью hardening.

Что уже появилось для Stage 7.1:
- есть dry-run inventory utility: `python scripts/hosted_stage7_inventory.py --json-out reports/hosted_stage7_inventory.json`;
- utility раскладывает legacy записи по bucket'ам:
  - `safe_read_only_candidate`
  - `keep_legacy_draft`
  - `needs_manual_review`
- текущий baseline по репозиторному `data/` на `2026-04-16`: найдено `0` legacy imported-copy records.
- отдельный apply-migration path для текущего repo baseline на `2026-04-16` не считается обязательным:
  - dry-run inventory уже дает `0` records;
  - значит сейчас нет фактического набора данных, который нужно массово переводить автоматически;
  - если non-zero inventory появится в реальной среде, решение по targeted apply utility принимается заново поверх нового отчета.

## Exit-критерии Stage 7

Stage 7 можно считать завершенным только если одновременно выполнено все ниже:

1. Документация и код согласованы:
   - `current_state.md`, `progress.md`, `smoke_matrix.md` и `implementation_memory.md` не расходятся по базовой hosted semantics.
2. Legacy inventory закрыт по статусам:
   - для каждого legacy copy-based surface есть решение `migrate`, `keep as legacy draft` или `remove`.
3. Есть зафиксированное migration-решение:
   - минимум dry-run inventory/report как обязательный gate;
   - для repo baseline с `0` legacy records отдельный apply-механизм не обязателен;
   - если в реальных данных появятся non-zero legacy records, apply-path проектируется только как targeted utility поверх нового dry-run отчета;
   - edited user drafts не трогаются автоматически.
4. Transitional fallback debt сужен и задокументирован:
   - filesystem shadow не маскируется под нормальный hosted source of truth;
   - internal `workspace_import` не протекает в catalog/library UX.
5. Ручной и автоматический smoke подтверждают baseline:
   - publish -> find -> add -> open -> visibility change -> reopen;
   - deletion/access scenarios;
   - fallback smoke при `postgres_dsn_missing`;
   - blocked shadow read/write не маскируется под generic `500`.
6. Есть финальный handoff:
   - что готово;
   - что осталось операционным долгом;
   - какие ограничения еще сознательно сохраняются.

## Что делать сейчас

1. Использовать этот файл и `progress.md` как новую baseline для handoff и QA.
2. Пройти [smoke_matrix.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/smoke_matrix.md) по уже живым surfaces вместо перепланирования Stage 5 с нуля.
3. Для ручного прогона идти по [qa_runbook.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/qa_runbook.md).
4. Использовать `reports/hosted_stage7_inventory.json` как baseline-решение:
   - если inventory остается `0`, не открывать отдельный apply-migration workstream;
   - если inventory становится non-zero, сначала обновить отчет, а потом решать targeted migration utility.
5. Использовать финальный degraded smoke от `2026-04-16` как подтвержденный baseline:
   - `pytest tests/test_hosted_shadow_write_policy.py tests/test_workspace_import_bridge_http.py tests/test_hosted_auth_http.py tests/test_complexes_theory_link_fallback.py -q`
   - результат: `15 passed`
6. Использовать [stage7_handoff.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage7_handoff.md) как финальную точку входа по Stage 7.
