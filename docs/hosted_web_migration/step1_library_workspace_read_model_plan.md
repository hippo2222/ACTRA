# Step 1: Library/Workspace Read Model

Дата обновления: `2026-04-10`

## Зачем нужен этот шаг

Сейчас web-режим уже частично переведён на server-backed хранилища, но часть read-path по-прежнему может вести себя как legacy-local desktop:

- пользователь видит объекты, потому что они лежат в локальном `data/`
- ownership и library semantics иногда выводятся из shared-local payload, а не из user-scoped workspace model
- UI начинает спорить с продуктовой моделью `Каталог -> Add to Library -> личная copy`

Цель `Step 1`:

- перевести основные list/read surfaces на user-scoped server-side semantics
- убрать зависимость web-режима от "всё, что лежит рядом на диске"
- закрепить правило:
  - `Комплексы` = только мои комплексы + мои импортированные copy
  - `Теории` = только мои теории + мои импортированные copy
  - editor catalog = только workspace graph, который разрешён текущему пользователю

## Что уже вынесено в server-backed модель

Эти слои уже не должны считаться "чисто локальными", хотя часть из них всё ещё держит filesystem как compatibility shadow:

- `users + consent`
- `progress + calendar metadata`
- `complexes + theories metadata`
- `modules/topics/tasks metadata`
- `task payload blobs`
- `theory body/history`
- `asset/media`
- `catalog publish/read/add-to-library backend`

## Что ещё остаётся transitional / незавершённым

- list/read routes всё ещё не везде используют жёсткую user-scoped web semantics
- legacy-local shared objects могут просачиваться в web UI
- `microcards` не доведены до полноценного hosted source of truth
- filesystem всё ещё местами влияет на read-model сильнее, чем должен в web-режиме

## Принцип для web-режима

В web-режиме filesystem допускается только как:

- compatibility shadow
- migration source
- dev/transitional fallback

Но не как место правды для пользовательского library/workspace listing.

## Объекты, которые в итоге должны храниться server-side

- пользователи и auth/session state
- статистика, прогресс и календарь
- комплексы и теории
- модули, темы и задания
- task/theory content blobs
- assets/media
- microcards decks/content
- microcards review/progress/events
- catalog items/versions/access metadata
- source lineage и update-detection metadata

## Очередность после `Step 1`

1. `Library/Workspace Read Model`
2. `Workspace Write Paths`
3. `Microcards Hosted Slice`
4. `Runtime/User State Cleanup`
5. `Legacy Filesystem Isolation`

## Границы именно `Step 1`

Этот шаг не занимается:

- publish visibility UI
- access-code entry UI
- update-available flow
- полной очисткой legacy filesystem
- write-path migration для всех CRUD действий

Он занимается только read/list/detail semantics.

## Микроэтапы `Step 1`

### 1.1 Audit read routes

Проверить и задокументировать все основные read surfaces:

- `/api/complexes`
- `/api/theories`
- `/api/editor/catalog`
- editor/detail routes, завязанные на graph read-path

Для каждого route нужно зафиксировать:

- current source of truth
- hosted-vs-legacy behavior
- может ли route отдать shared-local чужой объект в web-режиме

### 1.2 Complex library listing

Перевести `/api/complexes` на web-only library semantics:

- авторские комплексы текущего пользователя
- imported copies текущего пользователя
- без legacy shared-local foreign objects

Важно:

- UI-фильтрации недостаточно
- правило должно жить в backend read-path

### 1.3 Theory library listing

Перевести `/api/theories` на ту же модель:

- авторские теории текущего пользователя
- imported theory copies текущего пользователя
- без shared-local foreign theories в web-режиме

### 1.4 Editor catalog read model

Проверить и ограничить `/api/editor/catalog`:

- web-режим не должен видеть graph только потому, что он лежит в shared-local filesystem
- editor catalog должен читать только доступный workspace graph текущего пользователя

### 1.5 Detail/read routes alignment

После list routes добрать detail surfaces:

- complex detail payload
- theory detail payload
- editor task load path

Цель:

- если объект не принадлежит пользователю и не является его imported copy, detail route не должен quietly вести себя как допустимый web object

### 1.6 Exit check for Step 1

`Step 1` можно считать завершённым, когда:

- `Комплексы` не показывают shared-local чужие объекты
- `Теории` не показывают shared-local чужие объекты
- editor catalog не тащит чужой graph просто по факту локального файла
- UI больше не вынужден чинить library semantics поверх неправильного backend listing

## Что делать прямо сейчас

Первый реальный подшаг:

- начать с backend route `/api/complexes`
- зафиксировать его web-only user-scoped semantics
- затем тем же шаблоном пройти `/api/theories`
- после этого добрать `/api/editor/catalog`

