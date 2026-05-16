# Hosted Web Migration Progress

Hosted infra + production launch contour now has a recorded local green acceptance run on `2026-04-20`:

- `npm run smoke:launch-acceptance:hosted` now has a recorded local green run on the Docker stack, including live `register -> verify -> me -> logout -> login -> forgot-password request -> /main`;
- the companion contour `npm run smoke:complex-passage:hosted:infra` also passed in the same story with recorded result `60 passed`;
- the new runner in `scripts/run_hosted_launch_acceptance.js` still supports `--dry-run`, `--keep-stack` and `--skip-companion-passage` so the launch contour can be checked and rehearsed explicitly;
- the hosted Docker stack now includes a local `Mailpit` SMTP sink by default, so launch acceptance can exercise auth email lifecycle without requiring external SMTP;
- the contour still remains `transitional`, because the remaining tail is now public domain/real SMTP/proxy/backup proof rather than a missing local acceptance run.
- that remaining ops tail is now fixed as one canonical checklist in `hosted_launch_ops_checklist.md`.

Hosted infra + production launch contour got an explicit launch contract on `2026-04-20`:

- `/api/ready` now exports a separate `launch_contract` for production env/cookie/storage baseline, instead of forcing launch readiness to be inferred from generic service booleans;
- the contract now verifies stable `ACTRA_SECRET_KEY`, hosted storage mode, hosted persistence contract, auth base URL + SMTP baseline, secure cookie setup, and disabled dev/shadow fallback toggles;
- `hosted_infra_launch` no longer depends on the wrong `storage_mode == "postgres"` assumption and now recognizes the real `hosted_split` runtime as hosted storage mode;
- one official strict hosted command now exists: `npm run smoke:launch-contract:hosted`;
- the contour still remains `transitional`, because public domain/SMTP/proxy/backup acceptance remains a separate production-like proof.

Readiness + degraded signaling contour is now finish-line green on `2026-04-19`:

- `/api/ready` now exports a canonical `finish_line.subsystems` matrix instead of forcing release state to be inferred from raw service booleans alone;
- each hosted contour is now visible there with `finish_line_status`, `runtime_status`, `runtime_ready`, `official_gate`, `source_of_truth`, `runtime_signals` and `degraded_signals`;
- remaining release blockers are now explicit in one place: `auth + email lifecycle`, `import/export` and `hosted infra + production launch`;
- one official strict hosted command now exists: `npm run smoke:readiness:hosted`.

AI placeholder contour is now finish-line green on `2026-04-19`:

- `ai_mode` is now the master editor feature flag and defaults to `false`, so hosted product flows no longer expose partially-live AI behavior by default;
- `/api/editor/ai/*` plus AI-driven microcards generation now return one explicit placeholder contract: `404 ai_mode_in_progress`;
- the editor `theory analysis` modal now renders one honest `Функционал в разработке` state and skips live AI fetches when the contour is intentionally closed;
- one official strict hosted command now exists: `npm run smoke:ai-placeholder:hosted`.

Linked theory / open flows contour is now finish-line green on `2026-04-19`:

- hosted linked-library theory snapshots no longer silently fall back to workspace theory when linked publication enrichment is unresolved, blocked, or unavailable in `hosted_web`;
- embedded theory snapshot now stays primary only for embedded-only linked publications without a separate `catalog_item_id` binding, instead of acting as a universal stale-link fallback;
- one official strict hosted command now exists: `npm run smoke:linked-theory-open:hosted`;
- this closes the old matrix debt item about stale-link and embedded-fallback ambiguity in consumer open flows and moves `linked theory / open flows` into the green baseline.

Catalog + library + publication contour is now finish-line green on `2026-04-19`:

- catalog/library now has one official strict hosted command: `npm run smoke:catalog-library:hosted`;
- `HostedCatalogService` no longer bootstrap'ит hosted catalog state from shadow `catalog.json`, and successful hosted publish/library mutations no longer mirror themselves back into silent shadow state;
- the new hosted gate verifies `publish -> list -> detail/version -> add to library -> library-status -> visibility/access-code transition`, plus canonical degraded behavior for blocked hosted reads/writes;
- this closes the old matrix debt item about the missing strict hosted catalog/library gate and moves `catalog + library + publication` into the green baseline.

Theory editor + theory center contour is now finish-line green on `2026-04-19`:

- theory authoring now has one official strict hosted command: `npm run smoke:theory-editor:hosted`;
- `HostedTheoryService` no longer bootstrap'ит metadata/content/history from filesystem shadow and no longer mirrors successful hosted writes back into silent shadow state;
- theory routes plus `theory center` overview now return canonical degraded `503` payloads for blocked hosted reads/writes instead of generic `500`;
- the new hosted gate verifies `create -> list/open -> update -> upload-image -> history -> restore -> theory center overview -> delete`, plus ownership visibility and degraded behavior;
- this closes the old matrix debt item about the missing strict hosted theory-authoring gate and moves `theory editor + theory center` into the green baseline.

Complex editor CRUD contour is now finish-line green on `2026-04-19`:

- complex editor now has one official strict hosted command: `npm run smoke:complex-editor:hosted`;
- hosted complex metadata no longer bootstrap'ится from shadow `complexes.json`, and successful hosted writes no longer mirror themselves into silent filesystem shadow state;
- hosted `autosave/history/restore` now use explicit hosted persistence instead of file-backed history as runtime truth;
- the new hosted gate verifies `create -> open -> update -> sync-theory-from-topics -> autosave -> history -> restore -> publish -> delete`, plus ownership visibility and canonical degraded behavior;
- this closes the old matrix debt item about file-backed autosave/history and moves `complex editor CRUD` into the green baseline.

Task editor CRUD contour is now finish-line green on `2026-04-19`:

- task editor now has one official strict hosted command: `npm run smoke:task-editor:hosted`;
- hosted `editor catalog`, task load and draft bootstrap routes now return canonical degraded `503` payloads for blocked hosted shadow reads/writes instead of generic `500`;
- the new hosted gate verifies one full CRUD contour: `create module -> create topic -> bootstrap task -> save -> reopen -> catalog -> delete`;
- ownership filtering is now part of the release-proof, so foreign-owned tasks stay out of the current user's editable catalog/load surface;
- this closes the old matrix debt item about the missing strict hosted task-editor gate and moves `task editor CRUD` into the green baseline.

Assets + media contour is now finish-line green on `2026-04-19`:

- `SessionAPI` now refuses to synthesize `/api/local-image?path=...` for path-only task/question/answer media in `hosted_web`; those refs are stripped from hosted payloads instead of silently becoming product truth;
- review option payloads now prefer canonical `image_url` / `asset_id` refs and only keep raw `image_path` as local-runtime compatibility data;
- `SequenceUI`, `TestUI`, `ClickUI`, `DrawUI`, `OpenAnswerUI` and the shared `S1` task renderer now prioritize `asset_url` / `asset_id` over legacy `image_path`, so canonical hosted refs win even when old fields are still present;
- `click_editor`, `draw_editor`, `open_answer_editor` and `test_editor` now also preserve nested hosted `asset_id` / `asset_url` refs while keeping legacy `path` only as a compatibility bridge, so editor-side previews stop downgrading mixed payloads back to path-first behavior;
- one official strict hosted command now exists: `npm run smoke:assets-media:hosted`;
- this closes the old matrix debt item about the missing asset/media gate and moves `assets + media payloads` into the green baseline.

Calendar + schedule + memory health contour is now finish-line green on `2026-04-19`:

- calendar/settings/progress/activity now have one official strict hosted command: `npm run smoke:calendar:hosted`;
- `CalendarService` no longer treats calendar JSON docs as normal hosted truth and keeps repository-backed read/write behavior under explicit hosted policy;
- `calendar_api` today/schedule/health/activity/settings routes are now закреплены route-level hosted proof plus canonical degraded `503` behavior for blocked hosted reads;
- this closes the old matrix debt item about missing strict hosted calendar gate and moves `calendar + schedule + memory health` into the green baseline.

Statistics + progress contour is now finish-line green on `2026-04-19`:

- hosted progress/statistics now have one official strict hosted command: `npm run smoke:statistics:hosted`;
- `UserProgressManager` no longer bootstrap'ится из `progress.json` in hosted runtime and no longer shadow-writes after successful repository-backed save;
- `StatisticsService` overall/time-dynamics reads are now закреплены route-level hosted proof plus service-level degraded coverage;
- this closes the old matrix debt item about file-backed hosted progress truth and moves `statistics + progress` into the green baseline.

Main + quick access contour is now finish-line green on `2026-04-19`:

- `main` auth-gated UI serve and `quick access` hosted read/write flows now have one official strict hosted command: `npm run smoke:main-quick-access:hosted`;
- hosted `quick access` persists pinned/recent/settings through `user.settings["web_ui_state"]` instead of `data/users/<user>/ui_state.json`;
- paused-session metadata is verified through the hosted session repository contract, and blocked identity/session reads now fail with explicit degraded payloads;
- this closes the old matrix debt item about file-backed `ui_state` as hosted truth and moves `main + quick access` into the green baseline.

Microcards contour is now finish-line green on `2026-04-19`:

- hosted `microcards` deck library, manual CRUD, text import, queue, review submit, summary and dynamics all run through explicit Postgres-backed deck/review documents;
- empty hosted storage no longer bootstrap'ится из filesystem shadow for deck/review documents, so the remaining compatibility debt is no longer in the core runtime path;
- `microcards` now has one canonical strict hosted verification command: `npm run smoke:microcards:hosted`;
- AI-driven deck generation remains explicitly blocked in hosted runtime and is tracked under the separate `AI` contour instead of holding microcards in `transitional`.

Microcards hosted review/runtime gate landed on `2026-04-19`:

- hosted `microcards` summary, queue and review submit now use Postgres-backed review/session/event documents instead of staying explicitly blocked in hosted mode;
- `HostedMicrocardsReviewRepository` plus `HostedMicrocardsAnalyticsService` now own review-state and analytics truth for hosted runtime, while blocked hosted reads still fail explicitly instead of reusing filesystem analytics;
- `microcards` now has one official strict hosted gate: `npm run smoke:microcards:hosted`;
- that strict gate now belongs to the green baseline instead of a partial transitional step.

Microcards hosted deck-documents landed on `2026-04-19`:

- public hosted `microcards` deck-library and manual/text-editor routes now use a real hosted-backed source of truth for deck documents instead of being universally pre-blocked;
- hosted `MicrocardsService` now persists deck payloads through Postgres-backed `HostedMicrocardsRepository`, while refusing shadow reads when that storage is unavailable;
- `summary`, `queue` and `review submit` no longer sit outside the contour: they now run through hosted review/session state instead of legacy file truth;
- this slice is now part of the green contour rather than a remaining transitional debt item.

Microcards strictness baseline landed on `2026-04-19`:

- public hosted `microcards` routes no longer quietly operate against `data/microcards` / `data/users/.../microcards` in hosted runtime;
- storage-backed public `microcards` read/write paths now either use hosted-backed deck/review documents or return explicit hosted degraded payloads with `public_microcards` route contracts;
- stateless `microcards` text parse remains available in hosted runtime as a non-persistence helper;
- `MicrocardsAnalyticsService` legacy shadow-read block remains in place, while the hosted runtime now uses `HostedMicrocardsAnalyticsService` for real review analytics truth.

Import/export contract slice landed on `2026-04-19`:

- public task/complex import routes no longer self-report as `legacy_editor_import`;
- canonical public namespace is now `public_editor_import_export`;
- public hosted routes explicitly reject workspace-import markers instead of looking like an internal bridge;
- task and complex import services now attach matching `service_contract` payloads for hosted verification/gates.
- public hosted archive paths no longer silently read/write shadow-filesystem state; remaining legacy-dependent paths now fail explicitly instead of masking fallback behavior.
- public text `export` and text `import execute` now use hosted-backed `load_task` / `save_task` storage APIs instead of direct `modules_dir` shadow access.
- public task archive `export` now also runs through hosted-backed `load_task` payload export with asset resolution, instead of requiring a live local task directory.
- public task archive `confirm` now also runs through a hosted-backed storage transaction instead of moving extracted task directories into `modules_dir`.
- public task archive `confirm` route no longer hard-blocks in hosted mode and now streams either canonical result or explicit hosted degraded payload for blocked shadow writes.
- public complex archive `export` now also runs through hosted-backed `get_complex` / `load_task` / `get_theory` payload export, with filesystem walk left only as compatibility fallback for files that still exist locally.
- public complex archive `confirm` now also runs through hosted-backed rollback actions for task/module/topic, theory and complex mutations instead of full state backup/restore.
- public complex archive `confirm` route no longer hard-blocks in hosted mode and now streams either canonical result or explicit hosted degraded payload for blocked hosted writes.
- import/export contour now has one official strict hosted gate: `npm run smoke:import-export:hosted`.
- new gate was verified green by a local run on `2026-04-19`.

## Current Finish-Line Tracker

С `2026-04-19` единый cross-product tracker для hosted finish-line зафиксирован в:

- `hosted_finish_line_matrix.md`
- `hosted_scope_decision_ai_import_microcards_2026-04-19.md`

Там теперь сведены не только `complex passage`, но и `auth`, `main`, `statistics`, `calendar`, `catalog/library`, editor contours, asset/media layer, extras и launch-layer.

Отдельное scope-решение от `2026-04-19`:

- `import/export` не де-скоупится и остаётся обязательной частью hosted finish-line;
- `AI` допускается временно закрыть только единым explicit placeholder `in progress`, без partially-live поведения.

## Complex Passage

Отдельный factual contract по workstream'у "прохождение комплексов" теперь зафиксирован в:

- `complex_passage_spec.md`
- `complex_passage_definition_of_done.md`

Эти два файла считаются source of truth перед этапами hosted session persistence, hosted statistics persistence и runtime isolation.

Phase 6 завершен:

- добавлен отдельный release-blocking hosted gate: `complex_passage_hosted_gate.md`;
- `package.json` теперь содержит явную команду `npm run smoke:complex-passage:hosted`;
- gate вынесен в отдельный `playwright.complex-passage-hosted.config.js` с `headless: true` и `workers: 1`, чтобы не смешивать его с широким exploratory `complex_audit`;
- добавлен отдельный e2e regression на restart runtime и восстановление active session;
- S2 result surface приведен к читаемому UTF-8 состоянию без mojibake.

Phase 3 завершен:

- добавлен `HostedSessionRepository` с postgres-backed session source of truth;
- `server.py` подключает session repository через persistence runtime settings;
- session readiness/degraded telemetry теперь включает отдельный session repository слой;
- session-start/write paths в hosted runtime отдают явный degraded response вместо silent filesystem fallback.

Phase 4 завершен:

- `complex_statistics` вынесен в hosted-backed storage;
- `StatisticsService` теперь hosted-aware и использует policy-controlled shadow fallback;
- final-results flow поднимает blocked hosted stats write до explicit degraded response;
- readiness/degraded telemetry теперь включает statistics persistence как отдельный hosted слой.

Phase 5 завершен:

- `SessionAPI` в `hosted_web` переведен с одного shared controller/lock на session-scoped controller isolation;
- hosted runtime теперь создает отдельные `ComplexSessionController` / `TaskController` на session context, а не сериализует все browser sessions через один in-process экземпляр;
- controller cleanup встроен в session completion / cancel flow;
- retry semantics для shuffled TEST нормализована вокруг shuffled indices и покрыта отдельными regression tests.

Phase 7 завершен:

- `smoke_matrix.md` расширен отдельным разделом `Complex Passage`, а не оставляет readiness только на catalog/library flows;
- readiness теперь зафиксирован по подпотокам: session lifecycle, S1 runtime, retry/iteration engine, S2/S3 result surfaces, propagation, hosted persistence, runtime isolation и hosted gate;
- `README.md`, `current_state.md` и `progress.md` синхронизированы как единая входная точка по factual состоянию complex passage;
- boot-path ambiguity закрыт: текущий Playwright harness для curated gate теперь явно поднимает `ACTRA_RUNTIME_MODE=hosted_web`, проверяет `runtime_mode` через `/api/health` и проходит curated gate в реальном hosted runtime.
- новый residual risk уже: локальный gate все еще использует dev-auth bridge и `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1`, а не production-like Postgres/S3-backed entrypoint.

Follow-up по production-like infra contour подготовлен:

- `tests/complex_audit/helpers/runtime_server.mjs` теперь умеет отдельный backend `docker_compose`;
- `docker-compose.hosted.yml` параметризован под isolated run-root, strict hosted env и MinIO bucket init;
- `desktop-app/hosted_entrypoint.py` теперь выставляет `ACTRA_RUNTIME_MODE=hosted_web` до импорта `server`;
- отдельная команда `npm run smoke:complex-passage:hosted:infra` запускает тот же gate через `hosted_entrypoint.py` + Postgres/MinIO + hosted auth без dev bridge и shadow-write fallback;
- factual status этого contour теперь `green`: recorded run от `2026-04-20` прошёл зелёно (`60 passed`) на Docker stack.

Дата обновления: `2026-04-20`

## Где смотреть правду

- Операционный snapshot текущего состояния: `current_state.md`
- Операционный QA-checklist: `smoke_matrix.md`
- Пошаговый ручной прогон: `qa_runbook.md`
- Зафиксированные архитектурные принципы: `implementation_memory.md`
- Смысл и границы этапов: `implementation_stages.md`
- `stage5_kickoff.md` и `stage5_linked_library_plan.md` теперь являются историческими planning-документами и читаются только вместе с этим файлом и `current_state.md`

## Stage Status

- `Stage 0` — done
- `Stage 1` — done
- `Stage 2` — done
- `Stage 3` — done (with transitional shadow/bootstrap debt)
- `Stage 4` — done as foundation
- `Stage 5` — done
  - formal exit-check зафиксирован;
  - linked-library backend считается закрытым baseline для hosted catalog/library.
- `Stage 6` — done
  - formal exit-check зафиксирован по текущей read-only hosted-модели;
  - `Catalog`, `Комплексы`, `Центр теории` и theory author publish flow считаются достаточным product surface baseline.
- `Stage 7` — done
  - baseline для hardening зафиксирован;
  - read-only linked-library модель подтверждена как текущая hosted product direction;
  - собран initial inventory для legacy copy-based debt;
  - финальный degraded smoke по fallback/readiness/error signaling подтвержден автоматизированным прогоном `2026-04-16`;
  - финальный handoff зафиксирован в `stage7_handoff.md`.

## Locked Decisions

- Эта ветка остается `hosted_web-only`; desktop compatibility не является целью миграции.
- В hosted runtime целевая identity-семантика определяется через request-scoped auth session; dev bridge остается только временным local/dev исключением.
- hosted `Welcome` остается основным login/register surface для web runtime.
- Filesystem в hosted migration допустим только как compatibility shadow, а не как source of truth.
- `CatalogItem` и immutable `CatalogVersion` остаются базовой publish-моделью.
- Модель `personal copy / update_available` больше не считается целевым Stage 5 направлением.
- Для `complex` и `theory` библиотека пользователя строится на read-only linked-publication semantics:
  - `Add to Library` создает linked library entry на source publication;
  - `Open` открывает linked content;
  - library/catalog flow не создает editable copy пользователя.
- User-facing `fork from library` исключен из текущего hosted_web roadmap.
- Visibility change у source publication должна влиять и на уже существующие linked entries у non-owner пользователей.
- Если старые stage-доки расходятся с `implementation_memory.md`, `current_state.md` и этим файлом, приоритет у последних.

## Что реально завершено

- `Stage 0`-`Stage 4` остаются завершенной основой.
- Hosted auth и request-scoped user context работают на реальном `Welcome`.
- Hosted runtime уже поднимает server-side сервисы для storage/assets/users/complexes/theories/catalog.
- Catalog backend уже включает:
  - publish для `complex` и `theory`;
  - list/detail/version endpoints;
  - add-to-library;
  - library-status;
  - visibility update;
  - access-code resolve.
- Linked-library backend уже включает:
  - `complex library` list/detail/access-code/delete;
  - `theory library` list/detail/access-code/delete;
  - access states `active`, `requires_access_code`, `revoked`, `deleted_source`;
  - `resolved_version_id` и optional `pinned_version_id` в service contract;
  - safe cascade semantics для auto-added linked theory при удалении linked complex.
- Живые product surfaces уже существуют:
  - `Catalog`;
  - author-side publication management на `Комплексах`;
  - linked-library-aware `Комплексы`;
  - visibility-aware `Центр теории`.

## Что приземлилось за `2026-04-14` - `2026-04-16`

- `Каталог` теперь показывает владельцу его собственные публикации, включая `По коду` и `Приватно`, а не только `Публично`.
- На странице `Комплексы` живет добавление комплекса по access code без похода на экран каталога.
- Linked theory у комплекса, добавленного по коду, теперь резолвится по записи текущего пользователя, а если отдельная library-entry отсутствует, открывается через embedded snapshot fallback.
- Для автора добавлен fallback: если у его комплекса stale `linked_library` ссылка на theory уже невалидна, открытие возвращается к доступной source workspace theory.
- `Центр теории` больше не должен показывать hosted-пользователю чужие неимпортированные комплексы и теории.
- На странице `Комплексы` у non-author комплексов скрыта кнопка `Редактировать`.
- Добавлен симметричный `DELETE /api/theory-library/<library_entry_id>`.
- Удаление linked complex теперь detaches или удаляет связанную linked theory по safe-cascade правилам вместо слепого каскада.
- User-facing fork flow из library снят из runtime, roadmap и smoke baseline.

## Что приземлилось `2026-04-17` по hosted auth/email

- Hosted registration/login flow доведён до нормальной email-semantic:
  - `verification status + token storage` добавлены в hosted user model и persistence;
  - `resend/verify email` живут как backend routes и как `Welcome` flow;
  - статусы email на `Welcome` и `Settings` больше не называют неподтверждённый адрес подтверждённым.
- Email change в `Settings` переведён на staged-contract:
  - новый адрес pending;
  - активный email не меняется до подтверждения;
  - resend и verify работают отдельным purpose-потоком.
- `forgot/reset password` реализован end-to-end через email token flow.
- Security polish закрыт на основном контуре:
  - public auth ошибки стали более нейтральными;
  - rate limiting покрывает register/login/verify/resend/forgot/reset и email-change flow;
  - shared limiter использует storage-backed state, а не только память процесса;
  - auth mailer больше не fallback-ится на feedback sender.

## Что сейчас transitional, а не целевое состояние

- Fallback при недоступном Postgres все еще использует filesystem shadows и legacy local state как совместимый слой, но уже не для `catalog/library` hosted reads.
- Shadow writes в hosted runtime теперь не считаются нормальным fallback:
  - без `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1` legacy shadow write-paths блокируются;
  - readiness payload показывает это как явный degraded-state, а не скрытое поведение.
- Hosted catalog/library read-paths теперь тоже сужены:
  - при `PostgresUnavailableError` они fail-fast'ят как `503 hosted_shadow_read_blocked`;
  - readiness payload показывает это через `degraded.shadow_read_fallback_blocked`.
- Restricted `workspace_import_routes` остаются внутренним bridge-слоем и не являются частью hosted catalog/library UX.
- В hosted runtime route теперь закрыт по умолчанию и требует явного internal bridge opt-in для ops/dev использования.
- Legacy imported copies и новые linked entries пока сосуществуют в одном дереве.
- Для ряда edge-cases все еще нужны compatibility fallbacks на stale snapshots и missing library entries.

## Что еще не считается завершенным

- Legacy compatibility layers физически остаются в коде и данных как сознательно сохраненный operational debt.
- Новый migration workstream должен открываться только при non-zero inventory, а не автоматически.
- По auth/email остался уже не feature-gap, а operational completion:
  - завести production `ACTRA_AUTH_SMTP_*`;
  - задать `ACTRA_AUTH_PUBLIC_BASE_URL`;
  - прогнать реальный smoke по боевому sender/domain;
  - по желанию оформить auth-письма HTML-шаблонами.

## Что уже сделано для Stage 7.1

- Добавлена dry-run inventory utility:
  - `scripts/hosted_stage7_inventory.py`
  - `desktop-app/services/stage7_legacy_inventory_service.py`
- Utility умеет проходить по `complex/theory/module/topic/task` и раскладывать legacy records по bucket'ам:
  - `safe_read_only_candidate`
  - `keep_legacy_draft`
  - `needs_manual_review`
- Есть focused test coverage для classification logic:
  - `tests/test_stage7_legacy_inventory_service.py`
- Текущий baseline-прогон по репозиторному `data/` на `2026-04-16` дал `0` legacy imported-copy records в данных.
- На этом baseline принято явное Stage 7 решение:
  - отдельный `apply-migration path` не нужен как exit-blocker;
  - dry-run inventory остается обязательным gate;
  - targeted apply utility открывается только если будущий inventory станет non-zero.
- Formal exit-check для `Stage 5` и `Stage 6` зафиксирован:
  - [stage5_exit_check.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage5_exit_check.md)
  - [stage6_exit_check.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage6_exit_check.md)
- Финальный degraded smoke по Stage 7 уже подтвержден:
  - `pytest tests/test_hosted_shadow_write_policy.py tests/test_workspace_import_bridge_http.py tests/test_hosted_auth_http.py tests/test_complexes_theory_link_fallback.py -q`
  - результат: `15 passed`
- Cleanup-проход по shadow/fallback уже сузил transitional semantics:
  - `workspace_import` закрыт как internal bridge only;
  - hosted services отмечают `shadow_fallback_active` / `shadow_read_fallback_blocked` / `shadow_write_fallback_blocked`;
  - `/api/ready` экспортирует policy и деградацию наружу.
  - catalog/library read-routes отдают явный `hosted_shadow_read_blocked` вместо generic `500`, когда shadow-read policy для них заблокирован.
  - write-routes на hosted surfaces отдают явный `hosted_shadow_write_blocked` вместо generic `500`, когда legacy shadow write заблокирован policy.

## Текущие риски и долги

- Основной риск сейчас не в отсутствии backend contract, а в рассинхроне между уже реализованным linked-library кодом, transitional fallback-ветками и legacy imported-copy поведением.
- Fallback-режим при `postgres_dsn_missing` остается отдельным классом риска: UI может быть уже выправлен, а filesystem shadow все еще хранит устаревшие или неполные записи.
- Главный риск уже не в route-contract и не в Stage 5/6 semantics, а в будущем drift'е между целевой hosted-моделью и сохраненными compatibility layers.
- `workspace_import` и imported-copy lineage пока остаются в codepaths, которые Stage 7 должен инвентаризировать и сузить до внутренних или legacy-only сценариев.

## Следующий главный фокус

Не перепланирование `Stage 5/6` и не возврат к уже зелёным product contours, а добивание оставшегося launch-layer вокруг `hosted infra + launch`.

## Следующий практический шаг

1. Использовать `stage7_handoff.md` как основную точку входа по remaining compatibility debt.
2. Следующим большим contour брать уже только `hosted infra + launch`.
3. Если будущий inventory станет non-zero, открывать отдельный targeted migration workstream.

## Handoff Template

При передаче этапа следующему исполнителю обязательно ответить на 4 вопроса:

1. Что реально работает в коде и UI?
2. Какие fallback/transitional ветки все еще активны?
3. Что сейчас главный migration risk или operational debt?
4. Какой следующий конкретный сценарий, utility или файл является правильной точкой входа?
