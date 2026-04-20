# Implementation Stages

Документ разбивает web-миграцию на этапы, которые можно брать в работу последовательно, не ломая зафиксированные принципы.

Актуальный статус прохождения этапов надо смотреть в `progress.md` и `current_state.md`.
Этот файл фиксирует смысл и границы этапов, а не заменяет собой оперативный статус.

## Порядок этапов

0. Security baseline and branch framing
1. Hosted runtime baseline
2. Request-scoped auth and user context
3. Hosted persistence split
4. Workspace identity and source linkage foundation
5. Catalog publish and linked-library backend
6. Product surfaces and UX wiring
7. Hardening, migration utilities and release readiness

## Stage 0 — Security baseline and branch framing

Цель:
- убрать критические blockers, которые нельзя тащить дальше в публичный web.

Что входит:
- инвентаризация секретов и локальных конфигов, которые сейчас нельзя оставлять в hosted runtime;
- перевод обязательных production-конфигов на env contract;
- фиксация, какие desktop-only части считаются legacy и не участвуют в новой архитектуре;
- список process-wide state points: глобальный app context, shared mutable user state, local profile switching.

Результат этапа:
- понятный env contract для hosted runtime;
- явная маркировка dev/demo значений по умолчанию, которые ещё не считаются production-ready секретами или deploy-настройками;
- список legacy-узлов, которые должны быть вырезаны или изолированы;
- подтверждённый список критических secret/data risks.

Критерий выхода:
- можно поднимать hosted runtime без опоры на локальные секреты и без неявной desktop-логики;
- если sample compose или локальный bootstrap ещё содержат demo/dev defaults, это явно задокументировано как временный локальный слой, а не production-конфигурация.

## Stage 1 — Hosted runtime baseline

Цель:
- сделать сервер и фронтенд запускаемыми как web-приложение, а не как локальную desktop-обвязку.

Что входит:
- production entrypoint для сервера;
- health/readiness contract;
- базовая dev/demo deploy-конфигурация для `app + postgres + object storage`;
- изоляция или отключение desktop-only bootstrap и update flow.

Что не входит:
- полноценная auth;
- каталог;
- перенос пользовательских данных.

Критерий выхода:
- приложение поднимается как hosted web service и не требует desktop bootstrap для базовой работы;
- при этом допустим dev/demo deploy skeleton, если он явно не выдаётся за production-ready hardening.

## Stage 2 — Request-scoped auth and user context

Цель:
- убрать глобальное переключение пользователя и перейти на нормальный web-auth фундамент.

Что входит:
- `register/login/logout/me`;
- hosted-версия `Welcome` как основной auth surface вместо legacy profile picker;
- identity-модель `login + email + password`, где `name` остаётся display name;
- hosted user migration для legacy-аккаунтов без `login/email`;
- session cookie и request-scoped current user;
- удаление зависимости серверных сервисов от глобального mutable `user_id`;
- перевод user-bound API на `current authenticated user`.

Критерий выхода:
- два браузерных пользователя могут работать параллельно без пересечения состояний.
- unauthenticated hosted user проходит `Welcome -> login/register -> session -> main` без опоры на legacy profile-switching UI;
- dev auth bridge, если ещё существует, считается только local/dev fallback, а не основным продуктовым сценарием входа.

## Stage 3 — Hosted persistence split

Цель:
- вынести данные из локального режима в серверные хранилища.

Что входит:
- Postgres для users, auth sessions, library/workspace metadata, progress и catalog metadata;
- object storage для изображений, theory assets и bundle-артефактов;
- отказ от filesystem-first public contracts;
- перевод `data/` в compatibility shadow, который может временно оставаться только как явно задокументированный dev/QA bootstrap или fallback, а не как молчаливый production carrier.

Критерий выхода:
- web-runtime не зависит от `data/` как от primary production path;
- если shadow bootstrap/fallback ещё существует, он ограничен transitional dev/QA-сценариями, включается явно и описан как временный долг, а не как нормальная hosted semantics.

## Stage 4 — Workspace identity and source linkage foundation

Цель:
- ввести личное пространство пользователя и единый source-aware контракт, который нужен и для linked-library entries, и для явных fork/copy flows.

Что входит:
- сущности `WorkspaceComplex`, `WorkspaceTheory`, `WorkspaceModule`, `WorkspaceTopic`, `WorkspaceTask`;
- обязательные lineage-поля и source metadata;
- стабильная workspace identity даже для локального draft;
- явное разделение между:
  - linked source reference;
  - editable workspace copy;
  - manual fork без source lineage inheritance.

Критерий выхода:
- система умеет различать source publication, user library entry и editable workspace fork без name-based merge и без потери авторства/владения.

## Stage 5 — Catalog publish and linked-library backend

Цель:
- реализовать публичный каталог и server-side flow публикации и добавления в библиотеку без deep-copy semantics по умолчанию.

Что входит:
- `CatalogItem` и immutable `CatalogVersion`;
- `UserLibraryEntry` или эквивалентный linked-library контракт;
- publish flow для комплекса и теории;
- `Add to Library` как создание пользовательской ссылки на source publication;
- resolve latest accessible version для library entry;
- read-only linked-library baseline без неявной materialized personal copy;
- access-revocation semantics для уже добавленных library entries;
- раздельность catalog flow, linked-library flow и legacy editor import.

Что не входит:
- глубокий UI polish;
- silent auto-merge пользовательских fork с источником;
- скрытая подмена linked-library flow старым snapshot-import.

Критерий выхода:
- опубликованный комплекс или теория находятся в каталоге, добавляются в библиотеку как linked entry, открываются через source publication и не требуют создания личной копии по умолчанию.

## Stage 6 — Product surfaces and UX wiring

Цель:
- довести новую linked-library модель до пользовательских экранов.

Что входит:
- новый `Catalog`;
- обновление экранов `Комплексы`, `Центр теории`, `Редактор теории`, `Dashboard редактора`;
- статусы `в библиотеке`, `доступ отозван`, `нужен код`, `моя публикация`;
- отсутствие ложного edit/fork affordance для non-owner linked content;
- единая логика того, что видит пользователь, если автор снял публикацию с доступа;
- отделение linked-library consumption от authoring surfaces и internal legacy/import bridges.

Критерий выхода:
- пользовательский flow publish -> find -> add to library -> open linked content проходит полностью через UI, не маскируется под old copy semantics и не обещает editable copy там, где в текущем hosted roadmap ее нет.

## Stage 7 — Hardening, migration utilities and release readiness

Цель:
- подготовить решение к реальному хостингу и передаче между исполнителями.

Что входит:
- smoke tests и regression checks для multi-user web flow;
- миграционные утилиты для перехода от старых imported copies к linked-library model;
- cleanup legacy contracts и transitional fallbacks, которые больше не должны использоваться в hosted web;
- финальная проверка, что `implementation_memory.md` и реальная система не расходятся.

Критерий выхода:
- система готова к онлайн-развёртыванию и к handoff без потери архитектурных принципов.

## Рекомендуемая ближайшая очередь

1. Зафиксировать уже реализованный linked-library state в `current_state.md` и `progress.md` как новую baseline.
2. Считать `Stage 5` backend уже приземлённой основой и не возвращаться к его перепланированию как к "следующему шагу".
3. Стабилизировать `Stage 6` surfaces: `Catalog`, `Комплексы`, `Центр теории`, `Редактор теории`, visibility и access-code сценарии.
4. После read-only linked-library baseline переходить в `Stage 7` hardening, migration utilities и degraded/fallback cleanup.

## Правило перехода между этапами

Нельзя считать этап завершённым только потому, что “код уже написан”.
Этап закрывается только тогда, когда:
- выполнен его критерий выхода;
- обновлён `progress.md`;
- не нарушены пункты из `implementation_memory.md`.
