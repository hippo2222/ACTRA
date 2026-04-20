# Stage 5 Linked Library Plan

Дата фиксации: `2026-04-13`

> Исторический planning-док.
> Часть контрактов из этого файла уже реализована в коде по состоянию на `2026-04-15`.
> Перед использованием этого файла обязательно смотреть `current_state.md` и `progress.md`.

## Что из этого плана уже приземлилось

- `CatalogItem` / `CatalogVersion` и linked-library service contract уже живут в backend.
- Уже существуют:
  - `POST /api/catalog/items/<item_id>/library`
  - `GET /api/catalog/items/<item_id>/library-status`
  - `POST /api/catalog/access-code/resolve`
  - `GET /api/complex-library`
  - `GET /api/complex-library/<library_entry_id>`
  - `POST /api/complex-library/<library_entry_id>/access-code`
  - `DELETE /api/complex-library/<library_entry_id>`
  - `GET /api/theory-library`
  - `GET /api/theory-library/<library_entry_id>`
  - `POST /api/theory-library/<library_entry_id>/access-code`
- Access states `active`, `requires_access_code`, `revoked`, `deleted_source` уже используются на service layer.
- `Каталог`, `Комплексы` и `Центр теории` уже частично работают поверх linked-library semantics.
- Но materialized copy-based следы всё ещё живут как в `Add to Library`, так и в migration story и cleanup legacy copy-based данных.

## Цель

Перевести `Stage 5` с copy-based `Add to Library` на linked-library model для:
- `complex`
- `theory`

## Целевой контракт

### 1. Source layer

- `CatalogItem`
- immutable `CatalogVersion`

### 2. User library layer

- `UserLibraryEntry`
  - `library_entry_id`
  - `user_id`
  - `catalog_item_id`
  - optional `pinned_version_id`
  - `access_state`
  - `created_at`
  - `updated_at`

### 3. Editable layer

- explicit `fork to workspace`
  - для `theory`
  - для `complex`

## Базовая продуктовая семантика

- `Add to Library` не создаёт личную копию по умолчанию.
- Пользователь открывает source publication через linked library entry.
- Если автор публикует новую версию, linked entry видит её автоматически как latest accessible version.
- Если автор отзывает доступ:
  - linked entry не исчезает бесследно;
  - но становится `locked` / `requires_code` / `unavailable` по текущей visibility semantics.
- Если пользователю нужна своя независимая версия, он делает `Fork`.

## Что надо определить на backend

### Шаг 1. Модель данных

- Где хранится `UserLibraryEntry`.
- Какой индекс делает `Add to Library` идемпотентным.
- Нужен ли `pinned_version_id` уже в v1 или достаточно `resolved latest`.

### Шаг 2. Access semantics

- Какие состояния есть у library entry:
  - `active`
  - `requires_access_code`
  - `revoked`
  - `deleted_source`
- Что считается `deleted_source`, а что просто сменой visibility.

### Шаг 3. Route contract

- `POST /api/catalog/items/:item_id/library`
  - create or reuse linked entry
- `GET /api/library`
  - список library entries
- `GET /api/library/:entry_id`
  - detail + resolved source/version state

## Что надо определить на UI

### Каталог

- CTA:
  - `Добавить в библиотеку`
  - `Открыть в библиотеке`
- Не использовать тексты про личную копию как default semantics.

### Комплексы / Theory Center

- Библиотечные статусы:
  - `В библиотеке`
  - `Доступ отозван`
  - `Нужен код`
  - `Есть fork`
- Отдельный action:
  - `Создать свою версию`

### Редакторы

- Автор редактирует source publication.
- Потребитель не редактирует linked entry напрямую.
- Редактирование для не-owner начинается только после fork.

## Migration Plan

### Legacy objects

- уже существующие imported copies нельзя молча выбросить;
- нужно разделить:
  - legacy copies, которые уже редактировались;
  - legacy copies, которые по сути были только кэшированным чтением.

### Предпочтительная стратегия

1. Не трогать отредактированные legacy copies.
2. Для неотредактированных copy-based entries добавить migration bridge к linked entry.
3. Явно маркировать legacy copies в UI, пока миграция не завершена.

## Порядок выполнения

1. Зафиксировать backend data contract.
2. Реализовать server-side `UserLibraryEntry`.
3. Перевести catalog actions на linked entries.
4. Перевести `Комплексы` и `Theory Center` на новый read-model.
5. Добавить explicit fork flow.
6. Только потом разбирать legacy copy migration.

По состоянию на `2026-04-15` шаги `1`-`4` уже частично или в основном реализованы, поэтому этот порядок больше нельзя читать как "что ещё не начинали".
