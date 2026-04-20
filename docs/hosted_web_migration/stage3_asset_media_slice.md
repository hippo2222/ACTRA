# Stage 3 Asset/Media Slice

Дата фиксации: `2026-04-08`

## Что сделано

Внутри `Stage 3` начат отдельный production slice для `asset/media contracts`.

Добавлены:
- [hosted_asset_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_asset_repository.py)
- [hosted_asset_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_asset_service.py)
- [assets_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/assets_routes.py)

Также обновлены:
- [server.py](D:/Ai Ai/radioproject_git/desktop-app/server.py)
- [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py)
- [theories_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/theories_routes.py)
- [session_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/session_routes.py)

## Новая hosted семантика

- В hosted runtime появился server-backed asset identity:
  - `asset_id`
  - `asset_url`
  - `owner_user_id`
  - `visibility_scope`
  - `asset_kind`
  - `storage_root`
  - `storage_rel_path`
- Source of truth для asset metadata теперь может жить в Postgres.
- Blob-файл пока остаётся в filesystem compatibility backend.
- То есть мы отделили identity/metadata ресурса от прямого публичного `path`-контракта, но ещё не вынесли сам blob storage в object storage.

## Что уже умеет код

- Hosted runtime поднимает `HostedAssetService`.
- Readiness теперь отражает `asset_service_storage_ready`.
- `AppContextHeadless.ensure_hosted_persistence_ready()` включает hosted asset adapter.
- Новый route [assets_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/assets_routes.py) отдаёт медиа по `/api/assets/<asset_id>/content`.
- Editor upload и theory image upload теперь в hosted path возвращают не только legacy `path`, но и:
  - `asset_id`
  - `asset_url`
- Старые endpoints [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py) `/api/editor/image` и [session_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/session_routes.py) `/api/local-image` уже умеют принимать `asset_id` как compatibility bridge.

## Важное transitional правило

Если asset registry временно недоступен, upload не должен ломать legacy flow.

Поэтому текущая реализация сделана мягкой:
- upload сначала сохраняет файл как раньше;
- затем best-effort регистрирует asset metadata;
- если asset registration не удалась, legacy `path` всё равно возвращается.

Это сознательно временное поведение для `Stage 3`.

## Что это ещё не делает

- Не переводит blobs в S3/object storage.
- Не убирает legacy `path` из payload-ов frontend/API.
- Не переписывает существующий frontend на `asset_url`.
- Не делает public/shared asset policy для каталога.
- Не вводит lineage/version model для asset-ов.

## Первые payload/UI migration points

Внутри этого же `Stage 3` уже начат первый осторожный перевод UI с legacy `path` на `asset_url/asset_id` без смены domain model:

- [test_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/test_editor.js)
  - теперь читает и сохраняет `image_asset_id` / `image_asset_url` рядом с legacy `image_path`;
  - question/option rendering теперь предпочитает `asset_url`, затем `asset_id`, и только потом legacy `path`;
  - backend payload для test questions теперь несёт и legacy `answers`, и canonical `options`, чтобы validated save не съедал image metadata.
- [theory_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_editor.js)
  - upload preview теперь использует `asset_url` / `asset_id` для `img.src`, если они уже есть;
  - при этом сохранение delta не меняет Stage 3 semantics: если есть legacy `data-path`, именно он остаётся основным serializable ref.

Это важное transitional правило:

- в `Stage 3` UI может уже отображать asset-backed URL;
- но payload/storage контракт ещё сознательно остаётся dual-format, пока мы не дошли до отдельного cleanup этапа для viewers/runtime consumers.

## Первые runtime/viewer bridges

Следующим подэтапом внутри того же `asset/media` slice начат перенос compatibility logic уже в runtime consumers:

- [TestUI.question.js](D:/Ai Ai/radioproject_git/frontend/TestUI/TestUI.question.js)
  - получил единый `resolveImageUrlForWeb(...)`, который понимает:
    - legacy `image_path`
    - legacy `image_url`
    - new `image_asset_url`
    - new `image_asset_id`
    - nested `image.{asset_url,asset_id,url,path}`
  - question image, image-only option detection, image-option cards и review collections теперь опираются на этот resolver, а не на path-only checks.
- [testui-core.js](D:/Ai Ai/radioproject_git/frontend/TestUI/testui-core.js)
  - image-only question detection теперь считает asset-backed options полноценными image answers.
- [TestUI.web.js](D:/Ai Ai/radioproject_git/frontend/TestUI/TestUI.web.js)
  - fallback image-only detector синхронизирован с новой semantics.
- [session_api.py](D:/Ai Ai/radioproject_git/desktop-app/api/session_api.py)
  - review/meta helper-слой теперь распознаёт `image_asset_url/image_asset_id`;
  - при подготовке web task payload для runtime backend теперь best-effort достраивает привычный `image_url` из asset-backed fields для click/test consumers, чтобы старые viewers не ждали только filesystem path.

Следующим проходом те же bridges уже перенесены в остальные основные runtime/viewer consumers:

- [ClickUI.web.js](D:/Ai Ai/radioproject_git/frontend/ClickUI/ClickUI.web.js)
  - runtime image resolver теперь понимает `image_asset_url/image_asset_id` рядом с legacy `image_url/image_path`;
  - fallback metadata resolver тоже принимает nested image objects и `asset_id`, а не только raw path.
- [DrawUI.web.js](D:/Ai Ai/radioproject_git/frontend/DrawUI/DrawUI.web.js)
  - основной image resolver для draw viewer теперь поддерживает `asset_url/asset_id` и nested image payloads.
- [OpenAnswerUI.web.js](D:/Ai Ai/radioproject_git/frontend/OpenAnswerUI/OpenAnswerUI.web.js)
  - viewer теперь корректно читает `asset_url/asset_id` в top-level, nested `image` object и `content.images[0]`, а не только legacy path fields.
- [TaskMetadataPanel.js](D:/Ai Ai/radioproject_git/frontend/ClickUI/TaskMetadataPanel.js)
  - shared metadata panel теперь умеет показывать additional images по `asset_url/asset_id` и по nested image objects.
- [s2-results.js](D:/Ai Ai/radioproject_git/frontend/assets/s2-results.js)
  - shared results/review panel теперь собирает image preview из `image_asset_url/image_asset_id` и nested image objects, не завязываясь только на `image_path`.
- [task-renderer.js](D:/Ai Ai/radioproject_git/frontend/S1/task-renderer.js)
  - session-level summary/details surface теперь тоже поднимает task image из `asset_url/asset_id`, nested `image` objects и `content.images`, а не только из готового legacy `image_url`.
- [SequenceUI.web.js](D:/Ai Ai/radioproject_git/frontend/SequenceUI/SequenceUI.web.js)
  - sequence runtime consumer тоже получил asset-aware normalization для element image refs, чтобы даже grouping/model-layer не зависел только от raw path/string image field.
- [session_api.py](D:/Ai Ai/radioproject_git/desktop-app/api/session_api.py)
  - runtime payload enrichment расширен с `click/test` до `click/draw/open_answer/test`, чтобы viewer-слой чаще получал готовый `image_url` даже из asset-backed source fields.

Это тоже transitional bridge, а не финальная модель:

- viewer всё ещё может читать старый `image_url`;
- но теперь этот `image_url` уже может быть собран из `asset_url/asset_id`, а не только из raw path на диске.

## Итог финального runtime audit

После дополнительного прохода по remaining viewer/runtime surfaces:

- основные runtime consumers и summary/details surfaces Stage 3 покрыты:
  - `TestUI`
  - `ClickUI`
  - `DrawUI`
  - `OpenAnswerUI`
  - `SequenceUI`
  - `S1/task-renderer`
  - shared `TaskMetadataPanel`
  - shared `s2-results`
- в оставшейся выборке path-only места сейчас находятся уже только в editor-only preview/upload flows:
  - [click_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/click_editor.js)
  - [draw_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/draw_editor.js)
  - [open_answer_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/open_answer_editor.js)

Это важная фиксация для handoff:

- для основных runtime-путей Stage 3 path-only ожидания больше не являются главным долгом;
- оставшийся долг сместился в editor-only surfaces и их upload/preview contracts.

## Editor-only preview/upload bridges

Следующим подэтапом внутри того же `Stage 3` добраны editor-only surfaces, которые всё ещё жили на path-first preview contract:

- [click_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/click_editor.js)
  - основной task image preview теперь использует dual-contract resolver и умеет работать с `asset_url/asset_id`;
  - upload основного изображения больше не требует только `path` и сохраняет asset metadata рядом с legacy ref;
  - additional info images теперь тоже могут храниться и preview-иться как asset-backed refs, а не только как строки-path.
- [draw_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/draw_editor.js)
  - preview основного изображения и upload flow переведены на dual-contract `path + asset_id/asset_url`.
- [open_answer_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/open_answer_editor.js)
  - `content.images` теперь нормализуется как dual-contract image refs;
  - preview, upload, delete/restore и save path умеют работать с asset-backed refs, а не только со строковым `path`.

После этого editor-only surfaces больше не являются отдельным asset/media blocker внутри `Stage 3`.

## Почему это правильный следующий шаг

- Главный hosted-risk после metadata migration был именно в raw filesystem media contract.
- Новый asset layer уменьшает зависимость от `send_file(path)` как публичной модели.
- При этом мы не залезаем в `Stage 4` и не смешиваем asset cleanup с catalog/workspace semantics.

## Следующий разумный шаг внутри этого slice

- Определить, какие payload-ы и UI-поверхности первыми переключать с `path` на `asset_url/asset_id`.
- Начать вынос server-backed asset references из theory/editor/task payload builders.
- После этого уже можно будет готовить отдельный переход от filesystem blob backend к object storage backend.

Следующий конкретный шаг после текущего подэтапа:

- продолжить такие же compatibility bridges уже в более мелких runtime consumers и secondary panels, которые всё ещё локально читают только legacy `path`;
- следующим уже разумно считать не новые UI bridges, а Stage 3 exit-check: свести, что именно ещё осталось незавершённым в persistence/asset migration помимо live infra verification.
