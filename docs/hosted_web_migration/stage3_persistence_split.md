# Stage 3 Persistence Split

Дата фиксации: `2026-04-08`

## Что уже сделано

- Добавлен runtime-aware persistence contract в [runtime.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/runtime.py).
- Hosted startup валидирует `ACTRA_POSTGRES_DSN` и `ACTRA_S3_*` через [hosted_entrypoint.py](D:/Ai Ai/radioproject_git/desktop-app/hosted_entrypoint.py).
- Runtime write-points `ai_runs`, theory rollout telemetry и microcards live integration state уже вынесены из legacy `data/` в `runtime_state_root`.
- Hosted `users + consent` уже живут как `Postgres source of truth + filesystem compatibility shadow` через:
  - [postgres.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/postgres.py)
  - [hosted_identity_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_identity_repository.py)
  - [hosted_user_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_user_service.py)
- Hosted `progress + calendar metadata` уже начали жить в Postgres как source of truth через:
  - [hosted_progress_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_progress_repository.py)
  - [hosted_calendar_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_calendar_repository.py)

## Новый production data-slice: Library/Workspace Metadata

Внутри Stage 3 следующим production data-slice взяты верхнеуровневые workspace entities:
- `complexes metadata`
- `theories metadata`

Для этого добавлены:
- [hosted_complex_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_complex_repository.py)
- [hosted_theory_metadata_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_theory_metadata_repository.py)
- [hosted_complex_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_complex_service.py)
- [hosted_theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_theory_service.py)

## Новая hosted семантика

- В hosted runtime `complexes metadata` теперь идут через Postgres как source of truth.
- В hosted runtime `theories metadata` теперь идут через Postgres как source of truth.
- Файловые `data/complexes/complexes.json` и `data/complexes/theories/*/theory.json` остаются compatibility shadows.
- На исходной точке этого среза theory delta/history/images ещё оставались filesystem-backed.
- То есть сначала был вынесен именно metadata-слой библиотек/workspace, но не content blobs и не lineage model.

## Server Wiring

- [server.py](D:/Ai Ai/radioproject_git/desktop-app/server.py) теперь поднимает `HostedComplexService` и `HostedTheoryService` в `hosted_web`.
- Readiness теперь отдельно показывает:
  - `complex_service_storage_ready`
  - `theory_service_storage_ready`
- `AppContextHeadless.ensure_hosted_persistence_ready()` теперь включает complex/theory persistence adapters вместе с user/progress/calendar.

## Что это сознательно ещё не делает

- Не переносит `library/workspace lineage` и catalog semantics.
- Не переносит task/module/topic graph в Postgres.
- Не переносит theory delta blobs, images и complex autosave/history в object storage.
- Не вводит publish/add-to-library contracts из следующих этапов.

## Почему этот срез выбран сейчас

- Он закрывает реальную hosted дыру: верхнеуровневая личная библиотека всё ещё жила в filesystem-only сервисах.
- Он не затрагивает раньше времени Stage 4 с lineage/workspace model.
- Он позволяет двигаться production slices по слоям: identity -> progress/calendar -> library/workspace metadata.

## Что дальше внутри Stage 3

- Следующий разумный кандидат: `workspace/library metadata` глубже по graph-слою, если решим выносить `modules/topics/tasks` metadata до Stage 4.
- Альтернатива: server-backed asset references и дальнейший вынос filesystem-first media/content контрактов.
- До Stage 4 не смешивать этот persistence cleanup с lineage/catalog semantics.

## Решение по следующему slice

После дополнительного аудита принято решение:

- `workspace graph metadata` **не дробим дальше** внутри `Stage 3`;
- текущий `HostedStorageService` + `HostedWorkspaceCatalogRepository` считаем достаточной hosted persistence-моделью для `modules/topics/tasks metadata` на этой стадии;
- следующим отдельным slice берём `server-backed asset references` и cleanup `filesystem-first media contracts`.

Почему:
- главный незакрытый hosted-risk уже сместился в media/path contracts;
- в коде всё ещё живут `/api/local-image`, `/api/editor/image`, path-based editor image resolution и filesystem-backed theory images;
- более глубокая нормализация graph-а уже тянет нас в `Stage 4` semantics, а не в persistence split.

Подробная фиксация решения вынесена в [stage3_next_slice_decision.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage3_next_slice_decision.md).

## Текущий статус asset/media slice

Решение уже переведено в код первым подэтапом:

- добавлены [hosted_asset_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_asset_repository.py), [hosted_asset_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_asset_service.py) и [assets_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/assets_routes.py);
- hosted runtime получил `HostedAssetService` и readiness-флаг `asset_service_storage_ready`;
- editor/theory uploads начали возвращать `asset_id` и `asset_url`, сохраняя legacy `path`;
- `/api/assets/<asset_id>/content` стал новым server-backed media endpoint;
- `/api/editor/image` и `/api/local-image` получили compatibility bridge через `asset_id`.
- Начаты первые frontend payload/UI bridges:
  - [test_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/test_editor.js) уже хранит `image_asset_id/image_asset_url` рядом с legacy `image_path` и предпочитает asset-backed rendering;
  - [theory_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_editor.js) уже использует `asset_url/asset_id` для свежезагруженного image preview, но не меняет format of persisted delta.
- Начаты первые runtime/viewer bridges:
  - [TestUI.question.js](D:/Ai Ai/radioproject_git/frontend/TestUI/TestUI.question.js) теперь централизованно резолвит `image_asset_url/image_asset_id` наряду с `image_url/image_path`;
  - [testui-core.js](D:/Ai Ai/radioproject_git/frontend/TestUI/testui-core.js) и [TestUI.web.js](D:/Ai Ai/radioproject_git/frontend/TestUI/TestUI.web.js) считают asset-backed answers полноценными image-only options;
  - [ClickUI.web.js](D:/Ai Ai/radioproject_git/frontend/ClickUI/ClickUI.web.js), [DrawUI.web.js](D:/Ai Ai/radioproject_git/frontend/DrawUI/DrawUI.web.js) и [OpenAnswerUI.web.js](D:/Ai Ai/radioproject_git/frontend/OpenAnswerUI/OpenAnswerUI.web.js) теперь понимают asset-backed image refs alongside legacy path fields;
  - [SequenceUI.web.js](D:/Ai Ai/radioproject_git/frontend/SequenceUI/SequenceUI.web.js) теперь тоже нормализует element image refs через `asset_url/asset_id` compatibility bridge;
  - shared panels [TaskMetadataPanel.js](D:/Ai Ai/radioproject_git/frontend/ClickUI/TaskMetadataPanel.js) и [s2-results.js](D:/Ai Ai/radioproject_git/frontend/assets/s2-results.js) тоже переведены на dual-contract image resolution;
  - [task-renderer.js](D:/Ai Ai/radioproject_git/frontend/S1/task-renderer.js) теперь тоже использует asset-aware image resolution для session-level summary/details header;
  - [session_api.py](D:/Ai Ai/radioproject_git/desktop-app/api/session_api.py) теперь best-effort собирает `image_url` из asset-backed fields уже для `click/draw/open_answer/test` runtime payload consumers.

Финальный аудит внутри этого подэтапа показал:

- в основных runtime/viewer paths path-only image expectations больше не являются системным blocker;
- editor-only preview/upload flows тоже переведены на dual-contract bridges:
  - [click_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/click_editor.js)
  - [draw_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/draw_editor.js)
  - [open_answer_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/open_answer_editor.js)

То есть asset/media debt внутри `Stage 3` теперь сместился уже не в UI bridges, а в infra/verification и последующий object storage cutover.

Подробности вынесены в [stage3_asset_media_slice.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage3_asset_media_slice.md).

## Зафиксированное правило

Если данные в hosted runtime уже переведены в Postgres как source of truth, filesystem может оставаться только как compatibility projection и не должен тихо становиться основным источником правды.

## Exit Check

Отдельный `Stage 3 exit-check` проведён и зафиксирован в [stage3_exit_check.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage3_exit_check.md).

Результат:

- `Stage 3` ещё не закрывается как `done`;
- UI/runtime asset bridges уже не являются главным blocker;
- после theory content slice и task content slice главным remaining blocker в storage substrate остаётся уже прежде всего `asset blobs`.

То есть следующий шаг внутри `Stage 3` — не новые UI bridges и не Stage 4 semantics, а добор hosted source of truth для blob-backed content.

## Следующий storage slice: Theory Content Blobs

Следующим подэтапом внутри `Stage 3` theory body/history были вынесены из filesystem-only режима в hosted content repository:

- добавлен [hosted_theory_content_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_theory_content_repository.py)
- расширен [hosted_theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_theory_service.py)

Новая hosted семантика для theories теперь такая:

- theory metadata живут в Postgres-backed metadata repository;
- theory `delta + images list + history snapshots` живут в Postgres-backed content repository;
- filesystem `data/complexes/theories/<id>/...` остаётся shadow/compatibility projection.

Что это меняет practically:

- `get_theory()` в hosted runtime больше не обязан читать body delta из `body.delta.json` как из source of truth;
- `get_history()` и `restore_from_history()` теперь тоже могут опираться на hosted content repository;
- shadow filesystem всё ещё поддерживается и синхронизируется для compatibility/import flows.

Что это ещё не закрывает:

- theory image blobs всё ещё остаются частью общего asset blob долга;
- на той точке task content ещё оставались filesystem-backed, поэтому следующим отдельным slice был взят именно task content.

## Следующий storage slice: Task Content Blobs

Следующим подэтапом внутри `Stage 3` task payloads тоже были вынесены из filesystem-only режима в hosted content repository:

- добавлен [hosted_task_content_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_task_content_repository.py)
- расширен [hosted_storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_storage_service.py)

Новая hosted семантика для task content теперь такая:

- `modules/topics/tasks metadata` продолжают жить в Postgres-backed workspace catalog;
- сами task payload blobs `task_data + answer_key` теперь живут в отдельном Postgres-backed content repository;
- filesystem `data/modules/**` остаётся shadow/compatibility projection для bootstrap, legacy import/editor flows и текущего task-local image copy path.

Что это меняет practically:

- `load_task()` в hosted runtime больше не обязан читать `task.json` и `answer_key.json` как source of truth;
- missing repo rows лениво добираются из shadow и сразу импортируются в hosted content storage;
- `save_task()` и `create_task()` после shadow-write теперь синхронизируют Postgres-backed task content;
- `delete_task()` удаляет hosted task content row, а `delete_topic()`/`delete_module()` дополнительно prune-ят orphaned task content.

Что это ещё не закрывает:

- task image blobs всё ещё относятся к общему `asset blobs` долгу;
- mutation path пока transitional, потому что shadow filesystem всё ещё участвует в write flow до полного object-storage cutover.

## Финальный storage slice: Asset Blob Cutover

Последним подэтапом внутри `Stage 3` asset blobs тоже были выведены из зависимости на legacy `data/`:

- обновлены [hosted_asset_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_asset_service.py) и [hosted_asset_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_asset_repository.py)
- расширен [runtime.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/runtime.py) helper-ом `asset_blobs_root()`

Новая hosted семантика для asset blobs теперь такая:

- asset metadata живут в Postgres-backed repository;
- asset blobs живут в managed server-side blob store под `runtime_state_root/asset_blobs/...`;
- старые rows, указывающие на filesystem shadow, лениво мигрируются в managed store с сохранением `asset_id`;
- hosted upload routes больше не должны тихо деградировать в `path-only`, если asset registration не удалась.

Практический итог:

- `data/` и task/theory-local image directories больше не считаются основным production blob store hosted runtime;
- filesystem shadow остаётся только compatibility layer.

## Следующий production data-slice: Workspace Graph Metadata

После верхнеуровневых `complexes + theories metadata` в Stage 3 начат следующий hosted slice:
- `modules metadata`
- `topics metadata`
- `tasks metadata`

Для этого добавлены:
- [hosted_workspace_catalog_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_workspace_catalog_repository.py)
- [hosted_storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_storage_service.py)

### Новая hosted семантика для graph metadata

- В hosted runtime `StorageService` заменён на `HostedStorageService`.
- `modules/topics/tasks` metadata теперь читаются из Postgres-backed workspace catalog.
- Filesystem `data/modules/**` пока остаётся compatibility shadow для `task.json`, `answer_key.json`, images и editor/import legacy flows.
- Hosted `save/create/delete/rename` для graph metadata после shadow-операции синхронизируют Postgres catalog, чтобы editor catalog перестал быть filesystem-only.
- Создание module/topic через editor routes теперь идёт через service-layer, а не прямой файловый write bypass.

### Server wiring для нового среза

- [server.py](D:/Ai Ai/radioproject_git/desktop-app/server.py) теперь поднимает `HostedStorageService` в `hosted_web`.
- Readiness теперь отдельно показывает `storage_service_storage_ready`.
- `AppContextHeadless.ensure_hosted_persistence_ready()` теперь валидирует и hosted storage catalog adapter.

### Что этот срез ещё не делает

- На исходной точке этого среза он ещё не переносил сами task content blobs в Postgres; это закрыто следующим task-content slice.
- Не переносит task assets в object storage.
- Не делает user-scoped workspace graph model из Stage 4.
- Не убирает filesystem compatibility shadow для editor/import flows.
