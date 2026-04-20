# Stage 4 Exit Check

Дата: `2026-04-08`

## Решение

`Stage 4` можно закрывать как `done`.

## Почему критерий выхода выполнен

Критерий `Stage 4` из [implementation_stages.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/implementation_stages.md):

> можно безопасно импортировать чужой контент без name-based merge и без разрушения локальной библиотеки пользователя

На текущем состоянии это уже выполнено:

- workspace-bearing сущности (`complex/theory/module/topic/task`) получили стабильную workspace identity и source lineage;
- reuse/import идёт по lineage, а не по совпадению имени;
- manual clone imported content сбрасывает lineage и не притворяется imported copy;
- graph materialization уже создаёт personal workspace copy с owner = importing user;
- internal workspace import route и preview route изолированы от legacy editor import на route/service/payload boundaries;
- internal import result уже стабилизирован как read-model с `ownership`, `workspace_copy`, `source_lineage`, `created_counts`, `reused_counts`, `task_ref_map`;
- flow уже потребляется несколькими editor/library-adjacent surfaces:
  - `Theory Hub`
  - `Комплексы`
  - `Конструктор комплекса`
  - `Theory Center`
- active UI path для этого flow больше не использует browser-default dialogs; confirm/preview идут через shared project-style helper в [WorkspaceImportClient.js](D:/Ai Ai/radioproject_git/frontend/assets/WorkspaceImportClient.js).

## Что ещё не начато и почему это не блокирует Stage 4

Следующие вещи остаются за рамками `Stage 4`:

- public catalog API;
- publish flow;
- `CatalogItem` / `CatalogVersion`;
- public `Add to Library` endpoints;
- Stage 5 backend для каталога.

Это не blocker для `Stage 4`, потому что сама фаза была про workspace/lineage model и safe copy semantics, а не про публичный каталог.

## Остаточные долги после закрытия

Остаются только non-blocking долги уровня cleanup/polish:

- возможен дальнейший visual polish shared modal-contract;
- возможна дополнительная чистка consumer-side helper duplication вне критического Stage 4 flow.

Это уже не влияет на выполнение критерия выхода фазы и может добираться как follow-up cleanup без удержания `Stage 4` в `in_progress`.
