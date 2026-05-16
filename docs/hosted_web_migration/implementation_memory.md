# Implementation Memory

Этот документ фиксирует решения, которые считаются обязательными для текущей web-миграции. Если один из пунктов нужно пересмотреть, это должно быть явным изменением документа, а не побочным эффектом реализации.

## Зафиксированные принципы

1. Эта ветка является `web-only`.
Desktop-совместимость, `pywebview`, локальные профили и desktop update flow не сохраняются как цель текущей реализации.

2. Идентичность пользователя должна быть request-scoped.
Нельзя сохранять одного глобального `current user` на весь серверный процесс. Logout/login остаются, но работают через auth session конкретного браузера.

3. Публичный каталог v1 поддерживает только `Комплексы` и `Теории`.
`Задания`, `Темы` и `Модули` не становятся самостоятельными объектами каталога и не получают отдельного публичного поиска.

4. Главная единица обмена в проекте — `Комплекс`.
Именно `Комплекс` считается основным shareable learning unit, потому что он связывает теорию с практическим применением знаний. `Теория` остаётся отдельным publishable объектом, но играет вторичную роль: её можно публиковать и добавлять отдельно, однако она не заменяет комплекс как основной формат обмена учебным контентом.

5. `Add to Library` для комплекса и теории по умолчанию создаёт linked library entry, а не личную deep-copy.
Пользователь сохраняет ссылку на source publication и читает latest accessible version через library/read-only surfaces. Импорт в workspace или editable fork допустим только как отдельное явное действие и не является базовой library-семантикой.

6. Совпадение по названию не является основанием для автоматического слияния.
Одинаковые имена модулей, тем и заданий сами по себе ничего не значат. Основание для переиспользования объекта — только source lineage.

7. Для library-linked content обязателен source linkage.
И library entry, и явный fork должны хранить ссылки на источник публикации и исходные сущности, чтобы поведение не зависело от случайных `name` или локальных `id`.

8. `Add to Library` идемпотентен на уровне `CatalogItem`, а не личной копии.
Повторное добавление того же источника не должно плодить дубли; пользователь открывает уже существующую library entry.

9. Публикация должна быть versioned и immutable, а библиотека по умолчанию должна быть linked.
После publish создаётся отдельная версия каталога; библиотека пользователя по умолчанию ссылается на публикацию, а не получает самостоятельную deep-copy без явного fork.

10. Legacy import не смешивается с публичным каталогом.
Существующий импорт отдельных задач, тем и модулей остаётся editor-only инструментом и не определяет семантику catalog/library flow.

11. Hosted web не должен зависеть от raw filesystem contracts.
Файлы, изображения и bundle-артефакты должны жить в серверном storage, а не раздаваться по локальным путям из `data/`.

12. Секреты не хранятся в repo и локальных JSON runtime-файлах.
AI keys, SMTP, storage и DB credentials должны идти через env или secret manager.

13. Любой hosted dev-bridge должен быть явно временным.
Если для локальной разработки вводится мост между hosted request identity и legacy local current user, он обязан:
- включаться только явным env-флагом;
- быть ограничен dev/local use-case;
- маркироваться в docs как временный transitional layer;
- удаляться после того, как нормальный hosted auth flow станет достаточным для разработки и QA.

14. Hosted `Welcome` является основным auth surface, а не отдельным временным экраном.
В `hosted_web` используется тот же shell `Welcome`, но с web-auth семантикой:
- `modeSelect` = выбор `Войти` / `Создать аккаунт`;
- `modeLogin` = вход по `login или email + password`;
- `modeOnboarding` = регистрация с `display name + login + email + password`;
- после регистрации `Welcome` показывает состояние подтверждения почты, а не считает email подтверждённым по факту ввода;
- email verification и password reset работают через письма со ссылкой и возвращают пользователя обратно на `Welcome`.

15. Hosted identity-модель опирается на `login + email + password`, а `name` остаётся display name.
Legacy hosted users могут временно получать synthetic credentials через migration-path, но это не меняет целевой identity contract.

16. Auth email-канал изолирован от feedback-канала.
Письма подтверждения почты, смены email и сброса пароля используют только явные `ACTRA_AUTH_*` настройки и не имеют права тихо fallback-иться на личный или feedback sender.

## Рабочие определения

- `CatalogItem` — публичная сущность верхнего уровня: комплекс или теория.
- `CatalogVersion` — конкретная опубликованная immutable-версия объекта каталога.
- `Workspace` — личное пространство пользователя с редактируемыми draft/fork объектами.
- `UserLibraryEntry` — пользовательская библиотечная запись, которая по умолчанию является ссылкой на source publication.
- `Explicit fork` — самостоятельный редактируемый workspace-объект, созданный по явному действию пользователя из library entry или author source.
- `Source lineage` — набор ссылок на `source_catalog_item_id`, `source_catalog_version_id`, `source_entity_kind`, `source_entity_id`.
- `Shareable learning unit` — каноническая единица, которой имеет смысл делиться ради учебного результата. Для v1 это прежде всего `Комплекс`; `Теория` — вспомогательная, но тоже publishable единица.

## Stage 4 Data Contract

До начала publish/catalog backend workspace-bearing entities должны использовать единый baseline:

- Flat workspace fields:
  - `workspace_entity_kind`
  - `workspace_entity_id`
  - `workspace_entity_ref`
- Convenience workspace object:
  - `workspace_entity = { kind, id, ref }`
- Flat source-lineage fields:
  - `source_catalog_item_id`
  - `source_catalog_version_id`
  - `source_entity_kind`
  - `source_entity_id`
- Lineage state fields:
  - `has_source_lineage`
  - `source_lineage`

Правила ref-формата для graph entities:

- `module.workspace_entity_ref = <module_id>`
- `topic.workspace_entity_ref = <module_id>/<topic_id>`
- `task.workspace_entity_ref = <module_id>/<topic_id>/<task_id>`

Правила `source_entity_id` для imported graph copies:

- `module.source_entity_id = <source_module_id>`
- `topic.source_entity_id = <source_module_id>/<source_topic_id>`
- `task.source_entity_id = <source_module_id>/<source_topic_id>/<source_task_id>`
- Для `topic` и `task` нельзя использовать только локальный `topic_id` или `task_id`, потому что они не являются глобально уникальными вне своего graph path.

Правила copy-semantics:

- `workspace_copy_kind = local_draft`, если source lineage отсутствует
- `workspace_copy_kind = imported_copy`, если source lineage присутствует
- `source_lineage_key` используется как стабильный lookup key для будущего reuse/idempotency
- manual clone imported content не должен сохранять source lineage; результат такого clone снова считается `local_draft`
- write-time reuse разрешён только по source lineage, а не по `name` и не по совпадению локального `id`
- если requested `id` уже занят другим workspace object без совпадающего lineage, новая copy получает новый уникальный `id` с суффиксом, а не merge или overwrite
- materialization imported complex graph не должна перезаписывать уже существующую reused copy; повторный import той же source version только возвращает существующие nodes
- imported `task` materialize-ится не как пустой draft, а как полная workspace copy исходного `task_data + answer_key`
- результат graph materialization обязан возвращать `task_ref_map` и раздельно показывать `created`/`reused` nodes, чтобы следующий слой мог собрать idempotent `Add to Library`
- явный target `entity_id/entity_ref` всегда должен побеждать stale payload fields при normalization; imported copy не должна сохранять старый `workspace_entity_ref` от source object после id-collision и suffix rename
- imported workspace copy принадлежит импортёру, а не автору source object:
  - `created_by_user_id/updated_by_user_id` у `complex/theory/module/topic/task` workspace copies должны ставиться в authenticated importing user
  - автор источника остаётся доступен только через `source_lineage` и будущие catalog/source metadata, но не как owner личной workspace-копии

Правила integration-слоя над materialization:

- service выше materializer должен отдавать стабильный внешний import contract даже до появления public catalog API
- этот контракт должен включать минимум:
  - `source`
  - `summary`
  - `workspace`
  - `result`
  - `created_counts`
  - `reused_counts`
  - `task_ref_map`
- рядом с execute-path допустим отдельный read-only preview/preflight contract, но только как internal route/use-case слой
- node summaries внутри этого import contract должны уже нести:
  - `workspace_copy`
  - `source_lineage`
  - `ownership`
  - `created_via/content_scope`
- сам import result тоже может нести явный `service_contract`, чтобы consumer не путал internal workspace-import use-case с legacy import family или будущим public catalog API
- editor/library-adjacent consumers должны читать этот import contract через один UI-side normalizer, а не разбирать raw backend payload по месту
- первый реальный UI-consumer этого internal contract может жить в editor-side modal flow, но только как restricted/internal integration:
  - допустимо использовать существующий editor modal, если он явно переключается в отдельный `workspace_import` flow
  - preview и execute этого flow должны читать один и тот же normalized contract
  - этот UI-consumer не делает route публичным и не превращает internal flow в `Stage 5` catalog API
  - если у локального source complex ещё нет реального `source_catalog_item_id/source_catalog_version_id`, временно допустим internal synthetic lineage:
    - `source_catalog_item_id = internal_workspace_complex:<complex_id>`
    - `source_catalog_version_id = draft`
  - это разрешено только для restricted Stage 4 preview/execute trigger внутри editor UI и не должно считаться финальной catalog semantics
- preview/preflight не имеет права мутировать workspace storage, резервировать ids в реальном хранилище или скрыто запускать import side effects
- preview/preflight должен возвращать тот же shape результата, что и execute-path, но с явными маркерами `preview_only = true` и `planned_action`
- route/use-case wiring для этого контракта допустим в `Stage 4`, но только если он не превращается в `Stage 5` publish/catalog API
- первый route поверх этого слоя должен жить в явном restricted/internal namespace, а не под будущими public catalog endpoints
- preview route тоже должен жить в restricted/internal namespace рядом с execute route, а не под будущими public catalog endpoints
- internal workspace import routes должны явно отличаться от legacy editor import не только URL-ом, но и payload boundary:
  - legacy archive/editor import payload shape нельзя тихо принимать в новый workspace import flow
  - route-level contract может добавлять явный `route_contract`, чтобы consumers не путали internal workspace import с будущим public catalog API
  - `route_contract` должен присутствовать и в reject/error paths, а не только в success-ответах
- обратная граница тоже обязательна:
  - legacy editor/text/archive import routes не должны тихо принимать workspace-import markers (`source_catalog_*`, `source_complex_id`, `prefer_existing_by_lineage` и т.д.)
  - у legacy import families тоже допустим явный `route_contract`, чтобы их нельзя было принять за workspace import или за будущий public catalog API
- boundary не должен жить только на HTTP:
  - legacy import services тоже не должны принимать workspace-import params даже при прямом вызове
  - если старый service получает workspace-import markers, он должен падать контролируемо, а не интерпретировать их как "просто лишние поля"
  - у service families допустим явный `SERVICE_CONTRACT`, чтобы различие между `legacy_editor_import` и `internal_workspace_import` было видно и в коде, и в handoff
- internal workspace import consumer не должен автоматически закрываться сразу после успешного execute:
  - success-state должен оставаться видимым до явного действия пользователя
  - confirm-step может открывать созданную workspace copy напрямую из `workspace/result`
  - это остаётся internal Stage 4 flow и не означает запуск public catalog API
- один и тот же internal workspace import contract должен жить минимум на нескольких reading surfaces:
  - нельзя оставлять flow привязанным только к одному экрану вроде `Theory Hub`
  - допустимо подключать его к editor/library-adjacent surfaces вроде страницы `Комплексы` или `Theory Center`, если route namespace остаётся internal
  - synthetic fallback ids Stage 4 допустимы только как bridge до настоящего catalog lineage
- когда internal workspace import начинает жить на нескольких frontend surfaces, его semantics нельзя дублировать произвольно:
  - request building, ownership normalization, node summary normalization и execute result extraction должны сходиться через общий helper
  - confirm/modal behavior тоже должен сходиться через общий helper или существующий project UI layer; browser-default dialogs недопустимы
  - page-specific preview UI не должен оставаться отдельной hand-made реализацией, если flow уже живёт на нескольких экранах
  - это нужно, чтобы `Комплексы`, `Конструктор комплекса`, `Theory Center` и будущие surfaces не разъехались по Stage 4 semantics
- editor/library-adjacent complex-reading surfaces считаются закрытыми для Stage 4 только когда internal workspace import подключён не к одному экрану, а минимум к:
  - `Theory Hub`
  - `Комплексы`
  - `Конструктор комплекса`
  - `Theory Center`
- `Calendar` и runtime review/start-session surfaces не считаются частью этого Stage 4 consumer milestone:
  - они читают complex state для запуска и планирования, а не для import/copy semantics
  - их нельзя смешивать с library/workspace preview contract до отдельного решения

Правила payload-semantics для graph entities (`module/topic/task`):

- `module/topic/task` не должны оставаться без явного origin/scope, если они созданы через import/materialization flow
- manual editor graph должен нормализоваться как:
  - `created_via = manual_editor`
  - `content_scope = shared_local`
- legacy text import должен нормализоваться как:
  - `created_via = <import_source>_import` (например `text_import`)
  - `content_scope = shared_local`
- legacy archive import должен нормализоваться как:
  - `created_via = archive_import`
  - `content_scope = shared_local`
- workspace import / library-copy graph должен нормализоваться как:
  - `created_via = workspace_import`
  - `content_scope = workspace_private`
- эти поля должны попадать не только в catalog entry (`module.json`, `topic.json`), но и в сам task payload (`task.json -> meta`), иначе runtime/editor начинают видеть разные semantics для одного и того же объекта

Правила payload/read-model semantics для `theory`:

- `theory` не должна оставаться "особым случаем" без явных ownership/source semantics только потому, что у неё нет graph path как у `task`
- manual theory draft должен нормализоваться как:
  - `created_via = manual_editor`
  - `content_scope = shared_local`
- workspace-imported theory copy должна нормализоваться как:
  - `created_via = workspace_import`
  - `content_scope = workspace_private`
- manual clone theory должен сбрасывать source lineage и нормализоваться как:
  - `created_via = manual_copy`
  - `content_scope = shared_local`
- `theory` read-model обязан отдавать не только `workspace_entity_*` и `source_*`, но и:
  - `created_by_user_id`
  - `updated_by_user_id`
  - `created_via`
  - `content_scope`
- routes, которые возвращают theory payload, должны сериализовать его через единый helper, чтобы `list/get/create/update/copy/restore` не расходились по shape и ownership semantics
- theory write-path тоже обязан заполнять ownership не пустыми заглушками:
  - `POST /api/theories` должен проставлять `created_by_user_id` и `updated_by_user_id` из authenticated user
  - `POST /api/theories/<id>/copy` должен создавать новую theory copy с owner id текущего пользователя
- `PUT /api/theories/<id>` и restore-path должны обновлять `updated_by_user_id`

## Stage 5 Foundation Contract

До начала linked-library flow catalog backend обязан пройти через отдельный publish/read foundation:

- сначала `CatalogItem` и immutable `CatalogVersion`;
- затем publish endpoints для `complex` и `theory`;
- затем public read API каталога;
- затем `UserLibraryEntry` поверх этого слоя;
- и только потом explicit `fork to workspace`.

Правила этого foundation:

- `CatalogItem` идентифицируется по:
  - `owner_user_id`
  - `content_type`
  - `source_workspace_kind`
  - `source_workspace_id`
  - `source_workspace_ref`
- повторный publish того же workspace-объекта не создаёт новый item, а добавляет новую version к существующему item;
- `CatalogVersion` immutable: publish никогда не переписывает старую version;
- item-detail может отдавать список versions, но не должен тащить полный snapshot каждой version;
- полный immutable snapshot должен отдаваться только отдельным version endpoint;
- public catalog routes и publish routes должны жить в отдельной route family `public_catalog`;
- publish backend не должен использовать legacy import services как скрытую реализацию;
- старт `Stage 5` не должен требовать готового public catalog UI.
- `complex publish` обязан фиксировать immutable dependency bundle, достаточный для linked consumption и, при необходимости, последующего explicit fork без чтения live source workspace:
  - `modules`
  - `topics`
  - `tasks`
  - `topic_theory_links`
  - `theories`
- `Add to Library` больше не является синонимом deep import.
- `Add to Library` должен создавать или переиспользовать `UserLibraryEntry`, который ссылается на `CatalogItem` и резолвит доступную version по отдельному правилу.
- `UserLibraryEntry` должен поддерживать минимум:
  - `user_id`
  - `catalog_item_id`
  - optional `pinned_version_id`
  - `access_state`
  - timestamps
- `library status` должен сообщать минимум:
  - `already_in_library`
  - `action` (`create_link` или `open_existing`)
  - `library_entry_id`
  - `access_state`
  - `resolved_version_id`
- отдельный `fork to workspace` может использовать существующий `WorkspaceImportService`, но это уже не базовая библиотечная семантика, а явный вторичный flow.
- `preview` не имеет права мутировать библиотеку и должен сходиться по source/version semantics с `execute`.

## Catalog UI Decisions

Эти решения считаются зафиксированными для первой живой версии экрана каталога:

- главная shareable learning unit каталога — `Комплекс`;
- `Теория` остаётся publishable и searchable, но подаётся как вторичный тип с меньшим визуальным весом;
- в публичных catalog cards и detail panel не показываются `модули` и `темы`;
- канонический public summary для `Комплекса` строится вокруг:
  - количества заданий;
  - наличия теории;
  - количества теорий, но только если связанных теорий больше двух;
  - краткого описания комплекса, если оно есть;
- для `Теории` не используется декоративная метрика вроде `подробная / средняя / насыщенная`, пока под неё нет реального backend contract;
- author-side publication management для `Теории` использует ту же visibility-model, что и для `Комплекса`:
  - `public`
  - `access_code`
  - `private`
- первый UI-consumer theory publication допустимо вводить с `Центра теории`, если он использует тот же catalog backend и project-style modal behavior;

## Theory Author Publish Flow

- theory-side author flow не считается завершённым, пока publish-management не доступен в двух местах:
  - [theory_center.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_center.js)
  - [theory_editor.js](D:/Ai Ai/radioproject_git/frontend/Editor/theory_editor.js)
- для теории действует тот же visibility contract, что и для комплекса:
  - `public`
  - `access_code`
  - `private`
- в редакторе теории `Сохранить` и `Публикация` остаются разными действиями:
  - `Сохранить` фиксирует текущую рабочую версию теории;
  - `Публикация` управляет visibility и выпуском новой catalog version;
- если в редакторе есть несохранённые изменения, publish modal обязан явно сообщать, что в публикацию попадёт последняя сохранённая версия.

## Complex Editor UX Decisions

Для страницы конструктора комплекса действуют такие правила:

- flow `Черновиков / Autosave / Recovery` не считается активной пользовательской семантикой;
- для пользователя остаётся только явное `Сохранение` и `История изменений`;
- автосохранение допустимо, но только как тихие промежуточные версии внутри `Истории изменений`, а не как отдельный draft/recovery-режим;
- `Сохранение` и `Публикация` — разные действия:
  - `Сохранить` быстро фиксирует локальные правки текущей версии комплекса;
  - `Публикация` управляет visibility и выпуском новой catalog version;
- состояние "не сохранено" допускается показывать через status badge (`Новый комплекс`, `Есть несохранённые`), но не через recovery/draft UX;
- в блоке `Теория` для режима наследования и привязки нужно объяснять причину выбора человеческим языком:
  - почему взята именно эта теория;
  - что переход в редактор нужен для просмотра или редактирования самого источника;
- режим `Привязать существующую` остаётся read-only внутри конструктора комплекса:
  - разрешён предпросмотр;
  - прямое редактирование привязанной теории из этого блока недопустимо.
- detail panel каталога остаётся неглубокой:
  - описание;
  - количество заданий;
  - свежесть публикации;
  - связанные теории без показа `модулей/тем`;
- `Preview Add to Library` может показывать внутренний import-состав (`комплексы/модули/темы/задания/теории`), потому что это уже не public presentation, а объяснение последствий импорта;
- живая catalog UI должна использовать только public catalog endpoints и не должна ходить в internal workspace-import routes;
- на catalog UI недопустимы browser-default `alert/prompt/confirm`; preview/success/confirm поведение идёт только через project-style modal/toast layer.
- в первой версии catalog UI не нужен отдельный фильтр авторства `Все / Чужие / Мои публикации`;
- detail panel комплекса не должна раскрывать глубокую внутреннюю структуру graph-а:
  - достаточно описания;
  - количества заданий;
  - и, при необходимости, количества связанных теорий;
- пользователю показывается только свежесть публикации, а не явная version-метка.
- страница `Комплексы` должна давать явную точку входа в каталог:
  - header action `Каталог`
  - переход на `/catalog`
  - каталог не должен оставаться "скрытой" UI-surface без явной навигации из библиотеки
- живая страница каталога не должна перегружать карточки и detail-panel техническими действиями:
  - карточка публикации кликабельна целиком и не требует отдельной кнопки `Подробнее`
  - action `Открыть источник` не считается обязательным и не должен быть primary CTA для своей публикации
  - detail-panel не должен содержать лишний подблок `Публикация` для теории; там нужен контентный summary, а не дублирование publication semantics

## Current Position: 2026-04-13

Ниже зафиксировано именно текущее положение реализации, а не только конечные принципы.

### Что уже реально живо в Stage 5

- backend public catalog foundation существует и уже используется живым UI
- author-side publish-management для `complex` и `theory` уже подключён на рабочих экранах
- visibility model `public / access_code / private` уже работает как единая модель и для комплекса, и для теории
- первая живая страница каталога уже существует и подключена к серверу через `/catalog`
- страница `Комплексы` уже содержит явный navigation entry в каталог

### Что сейчас ещё transitional

- локальная hosted dev-проверка всё ещё держится на временных мостах:
  - `ACTRA_HOSTED_DEV_AUTH_BRIDGE`
  - shadow-read fallback без Postgres
  - shadow-write fallback для local catalog state
- эти мосты допустимы только как временная QA-поддержка и не являются целевой hosted architecture

### Что уже считается продуктово выровненным

- `Комплексы` читаются как библиотека пользователя, а не как "всё локально лежащее"
- `Каталог` считается единственным местом поиска чужих публикаций и входа в библиотеку
- `Комплекс` остаётся главной shareable learning unit
- `Теория` остаётся publishable, но вторичной единицей
- copy-based `Add to Library` больше не считается правильным конечным состоянием

### Что ещё остаётся на ближайший горизонт

- не перепланировать linked-library foundation заново, а считать её текущим baseline
- держать product surfaces в read-only linked-library semantics без user-facing fork из library
- выровнять formal exit-check для `Stage 5` и `Stage 6`
- после этого идти в `Stage 7` hardening, degraded smoke и handoff

## Catalog Publication Model

Для `Stage 5+` публикация должна поддерживать три режима видимости:

- `public`
  - публикация видна в общем каталоге;
  - находится поиском;
  - может быть добавлена в библиотеку обычным способом.
- `access_code`
  - публикация не видна в общем каталоге;
  - не находится обычным поиском каталога;
  - может быть открыта и добавлена в библиотеку только через специальный код доступа.
- `private`
  - публикация не видна никому, кроме автора;
  - не доступна ни через общий каталог, ни через код доступа для других пользователей.

Правила этой модели:

- `access_code` предпочтительнее простой "прямой ссылки".
  - Для пользователя это должен быть понятный код доступа, который можно ввести в отдельное поле.
  - Внутри backend допустим отдельный `share_code` / `access_code`, но UI-модель для пользователя строится вокруг "ввода кода", а не вокруг копирования длинного raw URL.
- visibility меняется на уровне `CatalogItem`, а не через создание новой library semantics.
  - Автор может переключать `public <-> access_code <-> private`.
  - Уже существующие `CatalogVersion` остаются immutable.
  - Меняется доступность item для новых и уже существующих linked-library entries у не-owner пользователей.
- library entry по умолчанию является linked reference, а не автономной copy.
  - Пользовательская библиотека открывает source publication через `CatalogItem`.
  - Для linked entry по умолчанию резолвится latest accessible version.
- если visibility уходит в `private` или в режим, который пользователь больше не удовлетворяет, library entry не должна притворяться вечной самостоятельной копией.
  - Запись может оставаться в библиотеке как reference.
  - Но контент должен становиться locked / gated по текущей visibility semantics.
- explicit `fork to workspace` — отдельное действие.
  - Только fork создаёт самостоятельный редактируемый объект пользователя.
  - Именно fork может сохранять snapshot source version внутри workspace semantics.
- автоматического фонового merge/update не делаем.
  - linked entry и так смотрит на source publication;
  - fork не должен тихо перезаписываться обновлениями source publication.
- backend contract для visibility-aware публикаций фиксируется так:
  - publish routes принимают `catalog_visibility`
  - общий catalog list не показывает `access_code/private` item-ы
  - owner может читать свои `access_code/private` item-ы напрямую
  - `access_code` может использоваться для detail/version/library-entry resolve
  - смена visibility делается отдельным owner-only action на уровне `CatalogItem`
  - backend должен уметь resolve по коду доступа без участия общего каталога

Правило разделения `Каталог` и `Комплексы`:

- `Каталог` — единственное место, где пользователь находит чужие публикации и запускает `Добавить в библиотеку`.
- `Комплексы` — это уже библиотека пользователя, а не второй каталог источников.
- После `Add to Library` на странице `Комплексы` по умолчанию живёт linked library entry пользователя.
- Отдельная deep-copy source publication рядом с этим entry не создаётся.
- Связь с источником хранится в самой library entry как первая сущность модели, а не как скрытая metadata внутри copy.
- Read-only source visibility/access badges на странице `Комплексы` обязательны, потому что библиотека показывает состояние живой публикации.
- Если пользователю нужна самостоятельная редактируемая версия, это должен быть явный `Fork`, а не побочный эффект обычного library add.

Правила read-model semantics для editor/workspace graph surfaces:

- editor routes не должны отдавать raw `module/topic/task` payload без `ownership` block, если ownership/source semantics уже есть в storage
- `GET /api/editor/catalog` должен сериализовать:
  - `module.ownership`
  - `topic.ownership`
  - `task.ownership`
- `GET /api/editor/task/...` должен сериализовать:
  - верхнеуровневый `ownership`
  - `metadata.ownership`
  - `task_data.meta.ownership`
- task catalog metadata не должна терять `created_via/content_scope` при обогащении из `task.json`; read-model обязан подтягивать ownership fields из `task_data.meta`, а не оставлять `legacy_unknown` только потому, что они не были продублированы в старом catalog entry

Отсутствие source lineage не означает "legacy object without identity".
Даже локальный draft обязан иметь стабильную workspace identity.

## Что нельзя делать без явного пересмотра решения

- возвращать desktop-режим в план как обязательную поддержку;
- auto-merge модулей или тем только по одинаковому имени;
- использовать текущий глобальный `ctx.user_id` как основу web-auth;
- публиковать отдельные задачи, темы или модули в v1 без отдельного пересмотра scope;
- делать `Add to Library` неявным deep-copy/import flow по умолчанию;
- делать linked library entry вечной автономной копией после отзыва доступа у source publication;
- оставлять legacy import и public catalog как один и тот же backend flow.

## Правило handoff

Если новый исполнитель не уверен, как трактовать спорную ситуацию, приоритет такой:
1. `implementation_memory.md`
2. `implementation_stages.md`
3. `progress.md`

Если ответа нет даже после этого, решение нужно сначала дописать в память реализации, а потом реализовывать в коде.

## Temporary Step 1 Rule

Для `Step 1` допустим временный read-time ownership bridge на editor graph surfaces:

- `/api/editor/catalog` и `/api/editor/task` могут трактовать ownerless `shared_local/local_draft` graph entries как workspace текущего dev-пользователя;
- этот bridge не считается финальной persistent ownership migration для `module/topic/task`;
- массовая запись owner в graph metadata должна решаться отдельным write-path/data-model срезом, а не прятаться внутри `Step 1`.
