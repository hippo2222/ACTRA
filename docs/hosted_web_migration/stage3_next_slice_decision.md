# Stage 3 Next Slice Decision

Дата фиксации: `2026-04-08`

## Принятое решение

Внутри `Stage 3` мы **не продолжаем дробить `workspace graph metadata` на новые persistence-slices**.

Для оставшейся части `Stage 3` считаем достаточным уже введённый подход:
- `modules/topics/tasks metadata` живут как один Postgres-backed workspace catalog snapshot;
- filesystem `data/modules/**` остаётся compatibility shadow для content blobs и legacy flows.

Следующий отдельный production data-slice берём такой:
- `server-backed asset references`
- `filesystem-first media contracts cleanup`

## Почему принято именно это решение

### 1. Главный hosted-risk сейчас уже не metadata

Metadata-слой для:
- `users`
- `progress`
- `calendar`
- `complexes`
- `theories`
- `modules/topics/tasks`

уже получил Postgres-backed source of truth или близкий к нему переходный слой.

То есть следующий самый опасный технический долг находится не в каталогах metadata, а в том, что media/content по-прежнему сильно завязаны на raw filesystem paths.

### 2. В коде уже есть прямые filesystem-first media contracts

На текущий момент hosted runtime всё ещё зависит от path-based media flow:
- [session_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/session_routes.py) `/api/local-image`
- [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py) `/api/editor/image`
- [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py) `/api/editor/upload-image`
- [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) filesystem-backed theory images
- [routes/_helpers.py](D:/Ai Ai/radioproject_git/desktop-app/routes/_helpers.py) `_resolve_editor_image_path(...)`

Это хуже для hosted web, чем текущая snapshot-модель graph metadata, потому что:
- сервер принимает или восстанавливает путь к файлу;
- UI и backend по-прежнему думают в терминах `path`, `task_dir`, `images/...`;
- object storage contract ещё не стал частью пользовательского пути.

### 3. Дальнейшее дробление graph metadata раньше времени тянет нас в Stage 4

Если сейчас пойти глубже и нормализовывать отдельно:
- `modules`
- `topics`
- `tasks`
- их связи
- ownership/lineage правила

то мы почти неизбежно начнём принимать решения уже не про persistence cleanup, а про:
- workspace model
- conflict semantics
- source lineage
- add-to-library behavior

Это уже граница `Stage 4`, и туда раньше времени заходить не нужно.

### 4. Snapshot-модель для graph metadata сейчас достаточно хороша

Для `Stage 3` нам не нужна идеальная финальная SQL-модель graph-а.

Нам нужна управляемая hosted семантика:
- metadata не должны быть filesystem-only source of truth;
- readiness должен уметь валидировать hosted storage adapter;
- editor catalog не должен зависеть только от локального JSON;
- при этом content blobs пока могут жить в shadow-слое.

Эта цель уже достигнута текущим `HostedStorageService`.

## Что это означает practically

До конца `Stage 3` принимаем такие правила:

- `HostedStorageService` и `HostedWorkspaceCatalogRepository` остаются текущей формой hosted persistence для `modules/topics/tasks metadata`.
- Не вводим новые таблицы под отдельные `module/topic/task` entities в рамках этой стадии.
- Не перепроектируем сейчас graph semantics и не добавляем lineage на уровне task graph.
- Следующий рабочий фокус переносим на asset/media contract.

## Следующий отдельный slice внутри Stage 3

Следующий slice должен решить такие задачи:

- убрать публичный контракт, в котором клиент оперирует raw filesystem path;
- ввести server-backed identity для media-ресурса: `asset_id`, `owner`, `scope`, `storage_key`, `mime_type`;
- подготовить переход от `send_file(path)` к storage-backed resolver;
- отделить metadata о ресурсе от фактического blob storage;
- оставить filesystem только как temporary compatibility backend, а не как публичный API contract.

## Что именно НЕ делать в следующем slice

- не начинать catalog publish/add-to-library semantics;
- не нормализовывать весь task graph в SQL;
- не переписывать весь editor import/export pipeline;
- не вводить live sync или version lineage для workspace graph.

## Короткая формула решения

`workspace graph metadata` на `Stage 3` достаточно оставить как один Postgres-backed catalog snapshot.

Следующий правильный шаг по качеству: **идти в asset/media contract cleanup, а не глубже в graph normalization**.
