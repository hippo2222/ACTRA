# Stage 5 Kickoff

Дата обновления: `2026-04-15`

> Этот файл больше не является основной точкой входа.
> По состоянию на `2026-04-15` linked-library backend и первые product surfaces уже реализованы.
> Актуальный операционный срез теперь находится в `current_state.md` и `progress.md`.

## Цель фазы

`Stage 5` больше не трактуется как развитие `personal copy / update_available` модели.

Новый целевой срез:
- `CatalogItem`
- immutable `CatalogVersion`
- `UserLibraryEntry` как linked source reference
- visibility-aware publication model
- explicit `fork to workspace` вместо неявного deep-copy по умолчанию

## Что уже сделано

- Поднят backend foundation каталога:
  - [hosted_catalog_repository.py](D:/Ai Ai/radioproject_git/desktop-app/persistence/hosted_catalog_repository.py)
  - [catalog_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/catalog_service.py)
  - [hosted_catalog_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/hosted_catalog_service.py)
  - [catalog_routes.py](D:/Ai Ai/radioproject_git/desktop-app/routes/catalog_routes.py)
- Работают publish endpoints для комплекса и теории.
- Работают public read endpoints item/version.
- Visibility backend slice уже существует.
- Работают linked-library routes для complex/theory library.
- Access-state contract уже живёт в service layer.
- Живая страница каталога уже существует:
  - [index.html](D:/Ai Ai/radioproject_git/frontend/Catalog/index.html)
  - [catalog.js](D:/Ai Ai/radioproject_git/frontend/Catalog/catalog.js)
- Поверх linked-library semantics уже работают:
  - `Каталог`
  - `Комплексы`
  - `Центр теории`

## Что считаем устаревшим решением

Ниже перечислено то, что больше не надо развивать как целевую архитектуру:

- `Add to Library` как создание личной рабочей копии по умолчанию;
- `already_in_library` по конкретной `catalog version` как главную библиотечную семантику;
- `update_available` как обязательный следующий продуктовый слой поверх imported copies;
- предположение, что снятие публикации с доступа не влияет на уже добавленные сущности у пользователя.

Это можно терпеть как transitional код, но не как дальнейший курс проекта.

## Новый зафиксированный вектор

- Пользовательская библиотека по умолчанию хранит linked entries на source publication.
- `CatalogVersion` остаётся immutable историей публикаций.
- Library entry по умолчанию смотрит на latest accessible version своего `CatalogItem`, если не введён отдельный pinning contract.
- Если автор переводит публикацию в `private` или делает её недоступной без кода, уже существующие library entries у других пользователей не превращаются в вечные автономные копии:
  - запись в библиотеке может остаться как reference;
  - но контент должен либо закрываться, либо требовать повторной авторизации/кода по новой visibility-semantics.
- Если пользователю нужна самостоятельная редактируемая версия, он делает это через явный `Fork / Создать свою версию`.
- Именно explicit fork использует уже существующий workspace/materialization foundation из `Stage 4`.

## Что ещё не входит в этот срез

- полная миграция старых imported copies;
- UX merge/update между старым copy-based state и новой linked-library моделью;
- финальный user-facing explicit `fork` contract;
- полный UI polish библиотечных экранов после смены backend semantics;
- formal exit-check для `Stage 5` / `Stage 6`.

## Следующий правильный шаг

Следующий крупный шаг больше не в greenfield-проектировании linked-library backend.

Правильный следующий шаг теперь такой:

1. Зафиксировать текущий implementation snapshot в docs и не возвращаться к предположению, что routes/UI ещё не начаты.
2. Пройти QA-стабилизацию `Каталога`, `Комплексов` и `Центра теории` как уже живых linked-library surfaces.
3. Отдельно принять решение по финальному user-facing explicit `fork` flow.
4. После этого переходить к migration utilities и hardening.

## Практический план следующего подэтапа

- `Step A`: smoke-матрица по уже существующим catalog/library flows.
- `Step B`: закрыть оставшиеся deletion/access-revocation gaps и fallback-edge-cases.
- `Step C`: зафиксировать финальный explicit `fork` contract.
- `Step D`: вернуться к migration plan для legacy copies и lineages.
