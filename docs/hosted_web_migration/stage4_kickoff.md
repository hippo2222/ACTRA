# Stage 4 Kickoff

Дата: `2026-04-08`

## Что начато

`Stage 4` стартовал не с catalog/publish flow, а с foundation-layer для workspace и lineage.

В коде зафиксирован единый baseline-контракт для сущностей workspace:
- `complex`
- `theory`
- `module`
- `topic`
- `task`

## Что уже сделано

- Добавлен общий helper-слой в [workspace_lineage.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_lineage.py):
  - `normalize_workspace_lineage_fields(...)`
  - `build_workspace_entity_ref(...)`
  - `normalize_workspace_graph_entity_fields(...)`
  - `build_source_entity_id(...)`
  - `build_source_lineage_fields(...)`
- Для workspace-сущностей стабилизированы поля:
  - `workspace_entity_kind`
  - `workspace_entity_id`
  - `workspace_entity_ref`
  - `workspace_entity`
  - `workspace_copy_kind`
  - `workspace_copy`
  - `source_catalog_item_id`
  - `source_catalog_version_id`
  - `source_entity_kind`
  - `source_entity_id`
  - `has_source_lineage`
  - `source_lineage`
  - `source_lineage_key`
- [complex_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/complex_service.py), [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) и [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) уже используют Stage 4 normalization на read/write путях.
- Добавлены lineage-based lookup helpers для будущего reuse/idempotency:
  - [complex_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/complex_service.py) умеет `find_complex_by_source_lineage(...)`
  - [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) умеет `find_theory_by_source_lineage(...)`
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) умеет `find_module/topic/task_by_source_lineage(...)`
- Добавлен write-time reuse layer для workspace copies:
  - [complex_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/complex_service.py) умеет `ensure_workspace_complex_copy(...)`
  - [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) умеет `ensure_workspace_theory_copy(...)`
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) умеет `ensure_module/topic/task_workspace_copy(...)`
  - reuse происходит только по source lineage
  - если конфликт только по `id`, но lineage другой или отсутствует, создаётся новая copy с уникальным суффиксом вместо merge/overwrite
- Create-paths начали принимать source lineage как часть workspace metadata foundation:
  - [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) сохраняет source lineage, если он пришёл в payload создания
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) протягивает lineage в task draft bootstrap и `create_task(...)`
  - [hosted_storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_storage_service.py) принимает optional lineage metadata при создании module/topic
- Зафиксирована copy-semantics для manual clone:
  - clone imported theory больше не наследует source lineage
  - manual clone превращается в `local_draft`, а не остаётся `imported_copy`
- Добавлен отдельный graph materialization layer для import semantics:
  - [workspace_graph_materialization_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_graph_materialization_service.py) materialize-ит imported complex graph в workspace copies
  - materialization идёт через `ensure_workspace_complex_copy(...)`, `ensure_workspace_theory_copy(...)`, `ensure_module/topic/task_workspace_copy(...)`
  - `topic.source_entity_id` и `task.source_entity_id` строятся от полного source graph path, а не от одного local id
  - повторный import той же `source_catalog_item/version` не создаёт дубль, а возвращает existing workspace graph
  - result materialization возвращает `created/reused` nodes и `task_ref_map`
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) теперь умеет `materialize_task_workspace_copy(...)`, то есть импортировать полный `task_data + answer_key`
- Добавлен use-case слой над materializer:
  - [workspace_import_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_import_service.py) даёт стабильный внешний import contract без catalog/publish API
  - сервис возвращает `source`, `summary`, `workspace`, `result`, `created_counts`, `reused_counts`, `task_ref_map`
  - [server.py](D:/Ai Ai/radioproject_git/desktop-app/server.py) теперь инициализирует `workspace_import_service` в `AppContextHeadless`
- Добавлен первый restricted route поверх use-case слоя:
  - [workspace_import_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/workspace_import_routes.py)
  - endpoint `POST /api/internal/workspace/import/complex-copy`
  - доступ только для authenticated non-guest user
  - маршрут сознательно остаётся internal namespace и не смешивается с будущим public catalog API
- Рядом добавлен read-only preview/preflight route:
  - [workspace_import_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/workspace_import_routes.py)
  - endpoint `POST /api/internal/workspace/import/complex-copy/preview`
  - использует тот же source-aware import contract, но возвращает `preview_only = true`
  - preview не имеет права ничего создавать в workspace и нужен только как internal preflight
- Boundary internal route усилен:
  - route-level response теперь помечается явным `route_contract`
  - `route_contract` теперь возвращается и в error/reject paths этого internal flow
  - payload shape с legacy editor-import markers (`cache_id`, `archive`, `module_id`, `topic_id`, `tasks` и т.д.) больше не принимается этим flow
  - это нужно, чтобы новый workspace import не стал "случайной второй формой" старого editor import API
- Legacy import surfaces тоже начали разводиться явно:
  - [import_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/import_routes.py) и архивные import endpoints в [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py) теперь тоже помечают свои ответы через `route_contract`
  - старые text/archive import routes теперь отвергают workspace-import markers вместо того, чтобы неявно интерпретировать чужой payload shape
  - это закрепляет двустороннюю границу: workspace import не притворяется editor import, а editor import не притворяется workspace import
- Граница опущена и на service-layer:
  - [import_export_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/import_export_service.py) и [complex_import_export_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/complex_import_export_service.py) теперь тоже контролируемо отвергают workspace-import params
  - [workspace_import_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_import_service.py) получил явный `SERVICE_CONTRACT`, чтобы его нельзя было трактовать как вариацию старого archive/text import helper
  - это нужно, чтобы даже прямой вызов services не размыл границу между двумя import families
- Payload-level graph semantics тоже начали выравниваться:
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) теперь нормализует `created_via/content_scope` для `module/topic/task`
  - manual editor graph получает `manual_editor/shared_local`
  - legacy text import пишет `text_import/shared_local`
  - legacy archive-created containers получают `archive_import/shared_local`
  - workspace graph materialization пишет `workspace_import/workspace_private`
  - это фиксирует различие уже на уровне сохранённых payload-ов, а не только routes/services
- Theory read-model и ownership semantics тоже начали выравниваться:
  - [theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/theory_service.py) теперь нормализует `created_by_user_id`, `updated_by_user_id`, `created_via`, `content_scope` вместе с workspace/source lineage
  - manual theory draft получает `manual_editor/shared_local`
  - workspace-imported theory copy получает `workspace_import/workspace_private`
  - manual `clone_theory(...)` теперь остаётся `local_draft` без source lineage и получает `manual_copy/shared_local`
  - [hosted_theory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_theory_service.py) теперь держит те же ownership fields и в hosted list/get path
  - [theories_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/theories_routes.py) теперь сериализует `list/get/create/update/copy/restore` через единый theory helper, чтобы API shape не расходился между route paths
  - theory write-path тоже перестал быть "ownership без owner-а":
    - create route проставляет `created_by_user_id/updated_by_user_id` из authenticated user
    - copy route создаёт новую theory copy с owner id текущего пользователя
    - update и restore paths обновляют `updated_by_user_id`
- Editor/workspace read-model surfaces тоже начали выравниваться:
  - [routes/_helpers.py](D:/Ai Ai/radioproject_git/desktop-app/routes/_helpers.py) теперь умеет сериализовать `module/topic/task` и editor task payload через единый ownership-aware helper layer
  - [editor_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/editor_routes.py) теперь сериализует `GET /api/editor/catalog` и `GET /api/editor/task/...` так, чтобы ownership/source semantics не терялись на route-слое
  - [theory_center_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/theory_center_routes.py) теперь использует тот же theory serializer для theory catalog, а не raw `list_theories()` payload
  - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) теперь подтягивает `created_by_user_id`, `updated_by_user_id`, `created_via`, `content_scope` из `task.json -> meta` при сборке task metadata для catalog tree
  - это закрыло разрыв, где `task_data.meta` уже знала про `manual_editor`, а task row в editor catalog всё ещё выглядел как `legacy_unknown`
- Internal workspace import result тоже начал выравниваться как полноценный Stage 4 read-model:
  - [workspace_import_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_import_service.py) теперь добавляет `service_contract` в normalized result
  - node summaries для `complex/module/topic/task/theory` теперь несут `ownership`, `workspace_copy`, `source_lineage`, `created_via`, `content_scope`
  - preview и execute paths теперь одинаково показывают ownership/source semantics в result shape
  - route-level HTTP smoke уже подтвердил, что `preview` и `execute` ответы несут:
    - `route_contract.namespace = internal_workspace_import`
    - `service_contract.namespace = internal_workspace_import`
    - owner imported workspace copy = authenticated importing user
    - `workspace_copy.kind = imported_copy`
    - корректный `source_lineage` для imported task nodes
  - imported workspace copies теперь принадлежат импортёру, а не автору source object:
    - [workspace_graph_materialization_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/workspace_graph_materialization_service.py) передаёт owner id в workspace copy meta
    - [storage_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/storage_service.py) теперь реально протягивает `created_by_user_id/updated_by_user_id` через graph workspace meta в `module/topic/task`
  - это закрывает важный semantic gap: source author остаётся только в lineage/source metadata, а owner личной library/workspace copy — текущий пользователь
  - прямого UI-клиента у internal workspace import route пока нет, поэтому consumer-side groundwork вынесен заранее в [import_manager.js](D:/Ai Ai/radioproject_git/frontend/Editor/import_manager.js):
    - `isWorkspaceImportContractPayload(...)`
    - `normalizeWorkspaceImportNode(...)`
    - `normalizeWorkspaceImportResponse(...)`
  - это нужно, чтобы будущая интеграция editor/library surfaces не читала raw backend shape напрямую и не размазывала parsing `ownership/workspace_copy/source_lineage` по UI
  - следующий шаг этого groundwork тоже уже сделан в том же consumer-layer:
    - [import_manager.js](D:/Ai Ai/radioproject_git/frontend/Editor/import_manager.js) теперь умеет открывать restricted internal flow через:
      - `openWorkspaceImportPreviewFlow(...)`
      - `renderWorkspaceImportPreviewStep()`
      - `renderWorkspaceImportConfirmStep()`
      - `executeWorkspaceImportFlow()`
    - [dashboard.js](D:/Ai Ai/radioproject_git/frontend/Editor/dashboard.js) получил internal entry-point `showWorkspaceImportPreviewModal(...)`
    - этот flow уже получил первый реальный trigger в existing editor/library-adjacent UI:
      - `Theory Hub` queue cards в [dashboard.js](D:/Ai Ai/radioproject_git/frontend/Editor/dashboard.js) теперь имеют кнопку `Preview copy`
      - кнопка открывает restricted internal workspace import modal для выбранного complex row, не создавая нового публичного экрана
    - после следующего шага trigger больше не живёт в одном месте:
      - `renderTheoryHubComplexPreview(...)` в [dashboard.js](D:/Ai Ai/radioproject_git/frontend/Editor/dashboard.js) теперь тоже показывает `Preview copy`
      - это автоматически расширило internal consumer на `Theory Hub` map и impact surfaces, где уже рендерятся complex preview badges
      - binding для `hub-preview-workspace-copy` теперь есть в `mapHost`, `queueHost` и `impactHost`
    - existing import modal теперь может работать не только как `text/archive/ai` import wizard, но и как отдельный internal `workspace_import` consumer, не делая этот маршрут публичным
    - stepper и кнопки для этого flow тоже разведены отдельно: скрываются нерелевантные шаги и меняются CTA для preview/confirm path
    - success-path этого internal flow тоже уже завершён до usable loop:
      - [import_manager.js](D:/Ai Ai/radioproject_git/frontend/Editor/import_manager.js) после успешного execute больше не закрывает modal автоматически
      - confirm-step показывает явный action `Открыть copy`
      - success CTA открывает созданную workspace copy напрямую из `workspace/result`
      - это оставляет flow internal, но уже делает его законченным use-case внутри Stage 4
    - пока у complex row нет реального catalog lineage, dashboard строит временный internal request с synthetic ids:
      - `source_catalog_item_id = internal_workspace_complex:<complex_id>`
      - `source_catalog_version_id = draft`
    - это сознательно временный bridge Stage 4, а не финальная semantics будущего catalog publish/import
- Исправлен важный ref-bug Stage 4:
  - при collision и создании copy с новым `id` явный target `workspace_entity_id/workspace_entity_ref` теперь всегда побеждает stale source payload
  - это гарантирует, что imported copy не сохранит старый `workspace_entity_ref` от исходного объекта

## Что это означает

После этого шага workspace-bearing entities уже не должны возвращаться как "безродные" payloads.
Даже если объект пока не импортирован из каталога и не имеет source lineage, он всё равно имеет стабильную workspace identity.

А для imported complex graph теперь уже есть:
- reuse по lineage;
- idempotent add-to-library foundation;
- import graph dependencies без merge по имени;
- отдельный service-layer materialization;
- use-case контракт выше materializer, готовый для будущего route wiring.

## Что сознательно ещё не начато

Это всё ещё не `Stage 5`.

Пока не реализуются:
- `CatalogItem` / `CatalogVersion`
- publish flow
- публичные `Add to Library` endpoints
- catalog API и bundle contracts
- UI wiring к `workspace_import_service`
- полноценный public `Add to Library` route namespace

## Следующий правильный шаг внутри Stage 4

Следующим шагом нужно развивать уже не сам первый route, а его boundaries и контракты:
- аккуратно отделить новые internal workspace import routes от legacy editor import flows;
- подготовить почву для будущего public `Add to Library`, не переименовывая current internal route в catalog API раньше времени.
## Stage 4 Note 2026-04-08

- internal preview/execute flow уже умеет post-execute open-copy navigation;
- этот finished internal flow уже посажен и на страницу `Комплексы`, не только на `Theory Hub`;
- на `Комплексах` action `Preview copy` показывается для не-своих карточек и использует тот же internal preview/execute contract;
- тот же internal flow теперь подключён и в [create.html](D:/Ai Ai/radioproject_git/frontend/Complexes/create.html):
  - список комплексов внутри конструктора теперь показывает ownership/source-aware badges
  - для не-своих карточек доступен `Preview copy`
  - flow использует тот же internal `preview -> execute -> open copy` и уже сведён к shared preview/confirm helper, а не к browser/default или page-specific dialog path
- этот же flow теперь подключён и в [theory_center.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_center.js) для complex-scope карточек `Theory Center`;
- `Theory Center` теперь тоже показывает ownership/source-aware complex badges и `Preview copy` без выхода в public catalog namespace;
- consumer-layer тоже начал выравниваться через общий helper:
  - добавлен [WorkspaceImportClient.js](D:/Ai Ai/radioproject_git/frontend/assets/WorkspaceImportClient.js)
  - `Комплексы`, `Конструктор комплекса` и `Theory Center` теперь берут из него ownership normalization, request building, execute result extraction и preview-dialog/confirm behavior
  - из `Stage 4` flow убран browser-default `confirm`; fallback теперь тоже идёт через shared project-style modal behavior
  - в [index.html](D:/Ai Ai/radioproject_git/frontend/Complexes/index.html), [create.html](D:/Ai Ai/radioproject_git/frontend/Complexes/create.html) и [theory_center.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_center.js) локальные preview-dialog paths больше не используются; рабочий route сведён к shared helper
  - старый dead fallback cleanup для `Комплексов` и `Конструктора комплекса` уже добран, так что interaction/UI contract между этими экранами больше не держится на скрытых локальных ветках
- milestone по основным editor/library-adjacent complex-reading surfaces теперь закрыт:
  - `Theory Hub`
  - `Комплексы`
  - `Конструктор комплекса`
  - `Theory Center`
- `Calendar` и runtime review surfaces сознательно не включаются в этот milestone, потому что они относятся к start/review flow, а не к import/copy semantics;
- следующий шаг после этого документа уже не внутри `Stage 4`, а в `Stage 5`: public catalog backend поверх этого internal workspace import foundation;
- это всё ещё не означает, что internal route превращается в public catalog API сам по себе.

## Stage 4 Closure

- `Stage 4` можно считать закрытым как `done`.
- Основание: критерий выхода выполнен; импорт чужого контента уже идёт через lineage-aware personal workspace copies без merge по имени и без разрушения локальной библиотеки пользователя.
- Остаточный долг:
  - возможен дальнейший visual polish shared modal-contract, но старые local preview-dialog paths из `Комплексов` и `Конструктора комплекса` уже удалены из рабочего кода;
  - это не blocker закрытия фазы и уже не влияет на import semantics.
