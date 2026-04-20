# Stage 3 Task Content Slice

Дата фиксации: `2026-04-08`

## Что сделано

- Добавлен новый Postgres-backed repository для task payload blobs:
  - [hosted_task_content_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_task_content_repository.py)
- Расширен hosted storage layer:
  - [hosted_storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_storage_service.py)

## Новая hosted семантика

- В `hosted_web` `HostedStorageService` теперь держит не только Postgres-backed catalog metadata, но и отдельный Postgres-backed source of truth для:
  - `task_data`
  - `answer_key`
- Shadow filesystem `data/modules/**` остаётся compatibility projection:
  - bootstrap source для существующих локальных задач
  - fallback carrier для legacy import/editor flows
  - carrier для task-local image copy на текущем этапе

## Как это работает

- При `ensure_persistence_ready()` hosted storage теперь:
  - поднимает schema для metadata catalog
  - поднимает schema для task content repo
  - bootstrap-ит metadata catalog из shadow, если catalog ещё пуст
  - bootstrap-ит task content из shadow по всем задачам текущего catalog
- `load_task()` в hosted path теперь:
  - сначала ищет task content в Postgres
  - если записи нет, лениво добирает её из shadow
  - возвращает payload в прежнем контракте `task_data + answer_key + metadata + task_dir`
- `save_task()` и `create_task()` теперь после shadow-save синхронизируют task content в Postgres
- `delete_task()` удаляет task content row
- `delete_topic()` и `delete_module()` дополнительно prune-ят orphaned task content rows по текущему catalog snapshot

## Что это закрывает

- `task.json` и derived `answer_key` больше не считаются filesystem-only production source в hosted runtime
- `HostedStorageService` перестаёт быть только metadata adapter и начинает держать реальный hosted source of truth для task payload blobs

## Что это сознательно ещё не закрывает

- task image files всё ещё остаются частью общего `asset blobs` долга
- save path по-прежнему transitional:
  - shadow filesystem участвует в mutation flow
  - затем состояние синхронизируется в hosted repositories
- это всё ещё `Stage 3`, а не `Stage 4`:
  - без lineage
  - без user-scoped workspace semantics
  - без publish/add-to-library contracts

## Практический вывод

После этого среза главным незакрытым storage-blocker внутри `Stage 3` остаётся уже не `task content blobs`, а `asset blobs` и будущий object-storage cutover.
