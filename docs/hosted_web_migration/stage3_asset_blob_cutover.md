# Stage 3 Asset Blob Cutover

Дата фиксации: `2026-04-08`

## Что сделано

- Обновлён [hosted_asset_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_asset_service.py)
- Обновлён [hosted_asset_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_asset_repository.py)
- Расширен runtime contract в [runtime.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/runtime.py)
- Ужесточены hosted upload contracts в:
  - [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py)
  - [theories_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/theories_routes.py)

## Новая hosted семантика

- Asset metadata по-прежнему живут в Postgres-backed repository.
- Но теперь и сами blob-файлы в hosted runtime больше не считаются `data/`-backed source of truth.
- Новый source of truth для asset blobs:
  - `runtime_state_root/asset_blobs/...`

## Как это работает

- При регистрации asset-а backend:
  - считает `sha256`
  - создаёт deterministic blob path внутри `asset_blobs/<sha-prefix>/<sha>.ext`
  - копирует blob в managed server-side store под `state_root`
  - сохраняет metadata row уже с `storage_backend = managed_state_blobs`
- Если в базе уже есть старый asset row, указывающий на `data_root` или другой filesystem shadow:
  - `HostedAssetService.get_asset()` и `resolve_asset_file()` теперь лениво мигрируют его в managed blob store
  - `asset_id` при этом сохраняется тем же

## Почему это закрывает blocker

- Hosted runtime больше не зависит от `data/` как от основного production blob storage для asset-backed media.
- `data/` и task/theory-local image folders остаются compatibility shadows, а не основной carrier для asset URLs.
- Viewer/runtime и editor upload flows теперь сходятся на одном server-managed storage substrate.

## Ужесточение hosted contract

- В hosted runtime asset registration больше не должна тихо деградировать в `path-only`.
- Если registration blob-а не удалась в hosted upload flow, backend теперь возвращает `asset_registration_failed`, а не делает вид, что всё нормально.

## Что это ещё не означает

- Это не live S3 SDK cutover.
- Это не Stage 4.
- Это не publish/catalog semantics.

Практически это означает следующее:

- `Stage 3` закрывает архитектурную зависимость hosted runtime от legacy `data/` как production storage substrate;
- будущий live S3/MinIO transport остаётся отдельным operational hardening шагом, а не незакрытым blocker этой фазы.
