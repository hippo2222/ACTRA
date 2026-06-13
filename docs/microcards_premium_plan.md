# Microcards Premium Plan (2026-06-13)

## Цель

Внедрить разделение free / premium в **Микрокарточки** с полным паритетом
механики и «мелочей», уже реализованных для комплексов / заданий / теорий:

1. Free-пользователь ограничен по числу колод; Premium — без ограничений.
2. Когда Premium истекает и колод больше лимита — лишние уходят в **Архив
   Premium** (read-only: открыть/удалить можно, редактировать/проходить/
   импортировать/публиковать — нельзя), не удаляясь.
3. Все «мелочи»: архив-фильтр на странице, бейджи на карточках архивных колод,
   баннер-уведомление на странице микрокарточек, сегмент микрокарточек в
   баннере «Архив Premium» на главной, корректные 409-ответы и upsell-модалка.
4. Обновить welcome-страницу, premium-секцию настроек и общий
   `PremiumPromoModal`, чтобы микрокарточки упоминались везде, где упоминается
   премиум-план.

## Решения владельца (зафиксированы 2026-06-13)

| Решение | Значение |
| --- | --- |
| Лимит колод (free) | **8 всего (свои + каталог), из них максимум 4 свои** — одна общая корзина, как у комплексов |
| Кап карточек в колоде | **Нет.** Считаем только сущности (колоды), не их содержимое |
| Импорт / AI-из-анализа / публикация | **В рамках лимита колод**, без отдельных premium-гейтов (паритет с комплексами) |

> ✅ Лимит колод — **та же форма, что у комплексов/теорий**: `personal_limit`
> (только свои) + `library_limit` (свои **+** каталог общим числом), просто другие
> числа — `personal_limit=4`, `library_limit=8`. Новый вид лимита НЕ нужен: всё
> разбиение / summary / capacity-проверки `WorkspaceLimitsService`
> переиспользуются без изменений алгоритма.

## Текущее состояние (ground truth)

### Премиум-ядро
- `resolve_effective_plan(user)` (`desktop-app/services/user_service.py:75`):
  admin → premium; активный `premium_expires_at` → premium; иначе `plan`. После
  истечения срока — снова `free`. **Микрокарточек это уже касается «бесплатно»** —
  план резолвится одинаково для всех фич.
- `WorkspaceLimitsService` (`desktop-app/services/workspace_limits_service.py`):
  единый сервис лимитов/архива. Знает только `theory` / `complex` / `task`
  (`_ENTITY_KEY_BY_KIND`, `_LIMIT_SPECS`). Отдаёт:
  - `get_summary(user_id)` → пер-сущностные счётчики + архив-сводка
    (`active_count`, `archived_count`, `archived_items`, `has_premium_archived_items`).
  - `assert_can_create_workspace_entity(user_id, kind)` → `WorkspaceLimitError`
    (HTTP 409 `workspace_limit_reached`) при превышении.
  - `assert_entity_not_archived(user_id, kind, ref, action, scope)` →
    `PremiumArchivedContentError` (HTTP 409 `premium_archived_content`) если
    конкретная сущность попала в архивный «хвост».
  - Архив-разбиение `_partition_archive_items`: сортировка по `created_at ASC`,
    первые `limit` активны, остальные — архив.
  - Инстанцируется в `desktop-app/server.py:1317` (передаются user/theory/
    complex/storage/catalog сервисы — **microcards сервиса там сейчас нет**).
- Гард-паттерн в роутах комплексов (`desktop-app/routes/complexes_routes.py`):
  хелперы `_premium_archive_response`, `_assert_complex_not_archived`,
  `_assert_task_refs_not_archived`; create-роут зовёт
  `assert_can_create_workspace_entity`, edit/start/publish — `_assert_*_not_archived`.

### Микрокарточки (что есть)
- Роуты: `desktop-app/routes/microcards_routes_v2.py` (префикс
  `/api/v2/microcards`). Все требуют не-гостя (`_check_guest` → 403
  `guest_cannot_use_microcards`). **Лимитов/плановых проверок сейчас нет.**
- Сервис: `desktop-app/services/microcards_service_v2.py`. Модель колоды:
  `id`, `name`, `created_by_user_id`, `created_at`, `linked` (bool),
  `catalog_item_id`. `create_deck` → своя колода (`linked` не выставлен);
  `create_linked_deck` → `linked=True` (read-only ссылка из каталога).
  `list_decks` возвращает обе с полями `linked` / `created_at` / `catalog_item_id`.
- Фронт: `frontend/Microcards/microcards.js` + `microcards.html`. Грид колод из
  `/api/v2/microcards/decks`; создание через модалку (`createDeckName`); общий
  `apiCall()` (`microcards.js:841`) на `!data.ok` кидает ошибку и показывает
  тост с сырым кодом. **Linked-колоды уже рендерятся read-only** (скрыты
  edit/import/publish, `microcards.js:1307`) — готовый паттерн для архивных.

### Премиум-UI (что переиспользуем)
- `frontend/assets/PremiumPromoModal.js` — общий upsell-модал
  (`window.PremiumPromo.open`). `FEATURES` сейчас: «Без лимитов: Больше личных
  заданий и комплексов» (микрокарточек **нет**). `getTriggerOptions` имеет
  варианты `calendar` / `statistics` / `tasks-limit` / `complexes-limit`
  (`microcards-limit` **нет**).
- Баннер «Архив Premium» на главной (`frontend/assets/MainLogic.js:278`):
  `MAIN_PREMIUM_ARCHIVE_KINDS` — фиксированный список (complexes/tasks/theories).
  Тянет `/api/workspace-limits/summary`, считает `archived_count` по каждому
  ключу. **Добавление 4-го элемента + ключа `decks` в summary → баннер заработает
  автоматически.**
- Страница комплексов (`frontend/Complexes/index.html`) — эталон архив-UI:
  чип-фильтр `data-filter="archived"` («Архив Premium»), баннер
  `#complex-premium-archive-notice`, CSS `.cx-card-shell--premium-archived`
  (grayscale), обработка `premium_archived_content`.
- Welcome (`frontend/Welcome/welcome.html`): секция `#premium` (ключи
  `wl.k075/k084/k086/k088/k090/k092/k094`). `wl.k088` уже упоминает
  микрокарточки в контексте статистики; лимиты описаны обобщённо («своих
  материалов»).
- Настройки (`frontend/Settings/settings.html` `#premium` +
  `frontend/Settings/settings.js`): `settings.premium_description` и список фич.

---

## Backend

### B1. `WorkspaceLimitsService`: новый вид сущности `deck` (как комплекс)

Файл: `desktop-app/services/workspace_limits_service.py`. Колода — 4-й тип с той
же формой лимита, что у комплекса. **Алгоритм разбиения / summary /
capacity НЕ меняем** — только регистрируем сущность и учим листать колоды.

1. Регистрация сущности:
   - `_ENTITY_KEY_BY_KIND`: `+ "deck": "decks"`.
   - `_ENTITY_LABELS`: `+ "deck": "колод"`.
   - `_LIMIT_SPECS`: `+ "deck": {"personal_limit": 4, "library_limit": 8}`
     (та же пара кнопок, что у `complex`/`theory`; всего 8, своих максимум 4).
2. Источник данных по колодам (см. B2):
   - `_list_workspace_items(user, "deck")` → свои колоды (`linked` falsy).
   - `_list_linked_library_entries(user, "deck")` → linked-колоды (`linked`
     truthy). Поля `id` / `created_at` уже есть в `list_decks`;
     `_archive_sort_key` отработает по `created_at`.
   - `_is_personal_workspace_item` для своих колод вернёт `True` (нет
     `created_via`/lineage import) — то есть свои = personal, linked = library.
   Партиция (`library_limit=8` сначала, затем `personal_limit=4`), summary
   (`personal_count` / `library_total_count` / archive-поля), `evaluate_capacity`
   — работают как для комплексов, без правок.
3. Хелперы под роуты:
   - **Создание своей колоды:** добавить `"deck"` в множество
     `{"theory", "complex"}` внутри `assert_can_create_workspace_entity`, чтобы
     запрашивались и `personal`, и `library_total` слоты. Тогда роут зовёт
     `assert_can_create_workspace_entity(user_id, "deck")` — проверит «свои ≤ 4»
     И «всего ≤ 8».
   - **Импорт linked-колоды из каталога:** `assert_can_add_linked_deck(user_id)`
     — тонкая обёртка над `evaluate_capacity` с запросом
     `{"entity_kind":"deck","limit_kind":"library_total","slots":1}` (проверяет
     только «всего ≤ 8»). Или расширить `assert_can_add_library_entries`
     параметром `deck_slots` — на выбор.
   - `assert_entity_not_archived(user_id, "deck", deck_id, action=..., scope=...)`
     — уже generic, заработает после регистрации сущности.

### B2. Внедрить листер колод в сервис

Файл: `desktop-app/server.py:1317`.

- `WorkspaceLimitsService` сейчас не получает microcards-сервис. Колоды живут в
  `MicrocardsServiceV2` (файлы / Postgres в hosted), резолв — пер-юзер.
- Решение: передать в конструктор **callable-листер** (не сам сервис, чтобы не
  тащить per-user стейт): `microcards_decks_provider=lambda user_id:
  MicrocardsServiceV2(data_dir, user_id).list_decks(limit=500)` — или фабрику
  сервиса. В `_list_workspace_items` / `_list_linked_library_entries` для
  `deck` дернуть листер и отфильтровать по `linked`.
- Учесть: листер не должен падать, если microcards-хранилище пустое; обернуть в
  try/except → `[]` (как `_resolve_plan`).

### B3. Гарды в роутах микрокарточек

Файл: `desktop-app/routes/microcards_routes_v2.py`. Завести локальные хелперы
по образцу комплексов: `_premium_archive_response(exc)`,
`_workspace_limit_response(exc)`, `_assert_deck_not_archived(ctx, deck_id, action)`,
плюс достать `workspace_limits_service` из `ctx`.

**Лимит на создание** (→ 409 `workspace_limit_reached`):
- `POST /decks` (create_deck) → `assert_can_create_workspace_entity(uid,"deck")`.
- `POST /decks/import/csv` (import_csv_to_new_deck) →
  `assert_can_create_workspace_entity(uid,"deck")`.
- `POST /decks/from-analysis` (create_deck_from_analysis_v2) →
  `assert_can_create_workspace_entity(uid,"deck")` (до создания колоды).
- `POST /catalog/<id>/import` и `POST /catalog/import-by-code` (создают linked
  колоду) → `assert_can_add_linked_deck` (проверяет только «всего ≤ 8»).
  *(Тот же гард — и на стороне каталога, см. F6.)*

**Архив-гард** (→ 409 `premium_archived_content`), action описывает попытку:
- Редактирование колоды/карт: `PATCH /decks/<id>`, `POST/PATCH/DELETE
  .../cards*`, `.../cards/bulk-delete|bulk-restore|reorder`, `.../image-import`.
- Наполнение из импорта: `.../import/{csv,json,txt_full,txt_simplified,auto,
  test,file}`, `.../append-from-analysis`.
- Тренировка: `.../session/start` (start). *(answer/pause/resume/finish/abandon
  по `session_id` не трогаем — если start заблокирован, сессия не начнётся;
  уже идущая сессия доигрывается.)*
- Публикация: `.../publish` (publish) — как у комплексов.

**Разрешено всегда** (даже для архивных): `GET /decks`, `GET /decks/<id>`,
`GET .../cards`, `GET /records*`, `DELETE /decks/<id>`, `GET .../export/*`,
`GET /settings`, `GET /analytics`, `GET /summary`, `*/import/analyze` (сухой
прогон, ничего не создаёт), `image-search` / `image-proxy`.

> Read/preview-роуты (`import/analyze`, deckless `import/analyze`) НЕ гейтим —
> это предпросмотр без записи; импорт зарежется на самом write-роуте.

### B4. Паритет публикации/удаления (проверить, вторично)

- Цель — как у комплексов: удаление **опубликованной** своей колоды должно
  ревокать/снимать catalog-публикацию, а подписчики (linked) получают
  «source deleted». Проверить, есть ли это уже в `delete_deck` / catalog-сервисе
  для `flashcard_deck`; если нет — вынести отдельной мелкой задачей (не блокер
  основного премиум-разделения).
- Архивная семантика публикации (как у комплексов): из архивной колоды нельзя
  публиковать новую версию / расширять видимость; существующая публикация
  остаётся; сузить видимость можно. Покрывается архив-гардом на `publish`
  (новую версию выпустить нельзя). Расширение/сужение видимости у колод сейчас —
  только через повторный `publish`; отметить как уточнение при реализации.

---

## Frontend

### F1. Страница микрокарточек (`frontend/Microcards/microcards.js` + `.html`)

1. **Обработка 409 в `apiCall`/вызовах.** Сейчас `apiCall` кидает сырой код.
   Ввести разбор структурированных ошибок:
   - `workspace_limit_reached` → открыть `window.PremiumPromo.open` с вариантом
     микрокарточек (см. F3), тост не нужен.
   - `premium_archived_content` → дружелюбный тост/модалка («Колода в архиве
     Premium: продлите Premium или удалите лишние колоды») + CTA в Premium.
   - `guest_cannot_use_microcards` — оставить как есть.
   Реализовать через возврат тела ошибки (не только `data.error`) — расширить
   `apiCall`, чтобы пробрасывать `data` (code + details) в catch на местах
   создания/старта/импорта/публикации.
2. **Грид колод:** добавить бейдж «Архив Premium» на карточки архивных колод
   (флаг придёт из summary/деки — см. ниже) + класс серого вида (перенести
   паттерн `.cx-card-shell--premium-archived`). Переиспользовать существующий
   read-only рендер linked-колод для блокировки действий (старт/редактор/
   импорт/публикация скрыты/выключены; «открыть»/«удалить» доступны).
3. **Архив-фильтр:** чип-фильтр `Все / … / Архив Premium` над гридом (как
   `data-filter="archived"`), поддержать deep-link `/microcards?filter=archived`
   (его открывают баннеры с главной).
4. **Баннер-уведомление** на странице (аналог `#complex-premium-archive-notice`):
   «Часть колод перенесена в архив Premium» + счётчик + объяснение. Показывать,
   когда `summary.decks.has_premium_archived_items`.
5. **Лимит-бейдж** у заголовка библиотеки: «свои X/4 · всего Y/8» (active/limit).
   Источник — `/api/workspace-limits/summary` (ключ `decks`:
   `personal_count`/`personal_limit`, `library_total_count`/`library_limit`).
6. **Источник флага архивности на колоде:** проще всего — на загрузке библиотеки
   тянуть `/api/workspace-limits/summary`, взять `decks.archived_items` (refs) и
   помечать колоды в гриде. (Бэкенд `list_decks` менять не обязательно.)
7. Подключить `PremiumPromoModal.js` на странице микрокарточек (проверить, что
   скрипт уже подключён в `microcards.html`; если нет — добавить).

### F2. Баннер «Архив Premium» на главной (`frontend/assets/MainLogic.js`)

- В `MAIN_PREMIUM_ARCHIVE_KINDS` добавить 4-й элемент:
  `{ key: 'decks', icon: 'style', forms: [main.form_deck_1/2/5],
  target: '/microcards?filter=archived', actionLabel: main.qa_open_microcards }`.
- Больше ничего: агрегатор `getMainArchiveSegments/Total` и рендер — generic,
  подхватят `decks` из summary автоматически. (Иконку согласовать с иконкой
  микрокарточек в проекте.)

### F3. `PremiumPromoModal.js`

- В `FEATURES` обновить текст про лимиты: «Больше личных заданий, комплексов **и
  колод микрокарточек**» (или отдельная фича-карточка про микрокарточки).
- В `getTriggerOptions` добавить вариант `microcards-limit`:
  title «Больше колод микрокарточек в Premium», lead про снятие лимита 4+4.
- Точки вызова с главной/настроек уже работают; на странице микрокарточек
  открывать через `window.PremiumPromo.open({ … })` или через
  `data-premium-promo-trigger` + `data-premium-promo-feature="microcards-limit"`.

### F4. Welcome (`frontend/Welcome/welcome.html`)

- Секция `#premium`: в блоке про лимиты (`wl.k084`) и/или архив (`wl.k090`)
  явно упомянуть **колоды микрокарточек** среди ограничиваемых материалов
  («задания, комплексы, теории и колоды микрокарточек»).
- При желании — добавить отдельный пункт «Микрокарточки без лимита колод»
  (новый ключ `wl.k0xx`), но минимально достаточно расширить формулировки
  существующих пунктов. Прайс-грид (14/30/90) не трогаем.

### F5. Premium-секция настроек (`frontend/Settings/settings.html` + `settings.js`)

- `settings.premium_description` и список фич: добавить упоминание колод
  микрокарточек к «больше места в библиотеке».
- Проверить `settings.js` — где строится список premium-фич; добавить пункт про
  микрокарточки, чтобы статус/выгоды совпадали с welcome и модалкой.

### F6. Каталог (`frontend/Catalog/catalog.js`)

- Если импорт `flashcard_deck` в библиотеку идёт через страницу каталога —
  добавить обработку 409 `workspace_limit_reached` (linked-лимит) с открытием
  `PremiumPromo` (`microcards-limit`), как уже сделано для комплексов/теорий.
  Проверить фактический путь импорта деки из каталога (catalog.js vs
  microcards.js import-by-code) и покрыть оба.

---

## i18n (ru / en / uk) — `frontend/assets/locales/*.json`

Новые ключи (значения — в 3 локалях):
- `main.form_deck_1/2/5` — «колода/колоды/колод» (для баннера на главной).
- `main.qa_open_microcards` — «Открыть микрокарточки».
- `microcards.archive_notice_title` / `…_copy` / `…_detail` — баннер на странице.
- `microcards.filter_archived` (+ при необходимости остальные чипы фильтра).
- `microcards.limit_badge` — «свои {own}/4 · всего {total}/8».
- `microcards.premium_limit_*` — тексты тоста/модалки для лимита и архива.
- Тексты `PremiumPromoModal` для `microcards-limit` (если выносим в i18n; сейчас
  модалка хранит строки инлайн — следовать текущему подходу файла).
- Правки существующих welcome/settings ключей (см. F4/F5).

> Тесты i18n (структурные) проверяют покрытие ключей в ru/en/uk — добавлять во
> все три сразу.

---

## Тесты

### Backend (`desktop-app/tests/`)
- `test_workspace_limits_service.py`: расширить под `deck` —
  - свои > 4 → лишние свои в архив; всего > 8 → лишние (по `created_at`) в архив;
  - premium → лимитов нет, архив пуст;
  - `assert_can_create_workspace_entity(uid,"deck")` кидает 409 при «свои > 4»
    ИЛИ «всего > 8»; `assert_can_add_linked_deck` — при «всего > 8»;
  - `assert_entity_not_archived("deck", …)` кидает на архивной, не кидает на
    активной; восстановление Premium снимает архив; удаление лишней колоды
    пересчитывает архив.
- `tests/unit/test_premium_archive_route_guards.py` (или новый
  `test_microcards_route_guards.py`): гарды на create / start / edit / import /
  publish микрокарточек возвращают правильные 409 и не трогают сервис.
- Прогонять точечно (в репо ~55 пред-существующих падений vitest, не связаны —
  см. memory). Backend pytest по затронутым файлам с `--no-cov` / `--cov-fail-under=0`.

### Frontend / static (`tests/*.test.mjs`)
- Микрокарточки: наличие архив-фильтра, баннера, бейджа лимита; обработка
  `workspace_limit_reached` / `premium_archived_content` открывает PromoModal /
  тост.
- Главная: сегмент `decks` в баннере архива (структурный тест MainLogic).
- `PremiumPromoModal`: вариант `microcards-limit`, упоминание колод в `FEATURES`.
- Welcome / Settings: премиум-секция упоминает микрокарточки (как
  `tests/welcome_hosted_auth.test.mjs`).

---

## Порядок выкатки

1. **B1+B2** — read-model: `deck` в `WorkspaceLimitsService` + листер в server.py
   (+ backend-тесты). Ничего не блокирует, summary начинает отдавать `decks`.
2. **B3** — гарды в роутах микрокарточек (+ тесты гардов).
3. **F1** — UI страницы микрокарточек (лимит/архив/фильтр/баннер/обработка 409).
4. **F2** — сегмент микрокарточек в баннере на главной.
5. **F3 + F4 + F5 + F6** — модалка, welcome, настройки, каталог (все упоминания
   премиума) + i18n в ru/en/uk.
6. **B4** — проверить/добить публикацию-удаление деки (если есть гэп).
7. Точечные тесты backend + затронутые `*.test.mjs`; ручной смоук на поднятом
   стеке: free превышает лимит → создание режется и открывает промо; истечение
   Premium → лишние колоды в архив, баннеры на главной и странице, действия
   заблокированы, удаление/просмотр доступны; восстановление Premium снимает
   архив.

## Открытые / уточнить при реализации
- Точная иконка микрокарточек для баннера/сегмента (согласовать с проектом).
- B4: реальное состояние каскада удаления опубликованной деки.
- F6: фактический путь импорта деки из каталога (одна или две поверхности).
- Расширение/сужение видимости публикации деки из архива (у комплексов —
  отдельная семантика; у деки видимость меняется через `publish`).
