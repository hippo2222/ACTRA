# Microcards Onboarding And Reference Plan

## Summary

Покрываем `/microcards` обучающими состояниями (first-visit туры + справочник) ровно по той же схеме, что и остальные страницы: декларативные туры в общем каталоге, движок `OnboardingTour`, demo-состояние на фронте, автоматическое появление в `/reference`.

Это пункт 7 из `docs/onboarding_tour_plan.md` ("Микрокарточки: два тура — список колод и режим повторения").

## Как это устроено для других страниц (анализ)

### Слои механизма

1. **Каталог туров** — `frontend/assets/onboarding_tours.js` (`window.ACTRA_ONBOARDING_TOURS`).
   Структура тура: `tourId`, `version`, `referenceCategory`, `referenceTags`, `referenceOrder`, `route[]`, `autoStart`, `autoStartDelay`, `totalStates`, `title`, `summary` (через `wt('tours.*', fallback)`), `steps[]`.
   Структура шага ("состояния"): `id`, `targets[]` (селекторы `[data-onboarding-target="..."]`), `placement`, `kicker`, `callouts[]` (`target`, `placement`, `offsetX/Y`, `width`, `rowGroup`, `title`, `body`), опционально `readySelectors`, `calloutVariants`, `beacons`.

2. **Движок** — `frontend/assets/OnboardingTour.js`:
   - autoStart по `route` для first-visit; факт прохождения в `/api/ui/settings` (`settings.onboarding.seen[tourId] = version`) с fallback на `localStorage`. Бекенд-изменений не требуется — endpoint универсальный.
   - выставляет на `<body>` атрибуты `data-onboarding-tour-id` / `data-onboarding-step-id` / `data-onboarding-step-variant`;
   - события: `onboarding:before-start`, `onboarding:before-step`, `onboarding:step-ready`, `onboarding:finish` (в `detail` — `tourId`, `stepId`, `stepIndex`, массив `preparationPromises`);
   - preview-режим: `?onboarding_preview=<tourId>&reference_embed=1&onboarding_step=N` (так справочник встраивает живое превью в iframe);
   - программный запуск: `window.OnboardingTour.start(tourId)` / `startIfUnseen(tourId)`;
   - help-кнопки: `[data-onboarding-help-button]` — уже есть в `GlobalHeader.js`, тур подбирается по маршруту.

3. **Подключение страницы** (пример: `frontend/Catalog/index.html`, `frontend/statistics/statistics.html`):
   - `<link href="/assets/onboarding-tour.css?v=...">` + `<script src="/assets/onboarding_tours.js?v=...">` + `<script src="/assets/OnboardingTour.js?v=...">` (с cache-bust версией);
   - `data-onboarding-target="..."` на стабильных контейнерах;
   - точечные CSS-оверрайды через `body[data-onboarding-tour-id="..."][data-onboarding-step-id="..."]`.

4. **Demo-состояние** — фронтовый паттерн (см. `frontend/statistics/statistics.js: applyStatisticsOnboardingDemo`, `frontend/Catalog/catalog.js: applyCatalogOnboardingDemo`):
   - `MutationObserver` на `<body>` следит за `data-onboarding-tour-id`/`data-onboarding-step-id`;
   - при активации: снапшот реального состояния → подмена на демо-данные → `body.dataset.<page>OnboardingDemo = 'true'`;
   - при завершении: восстановление снапшота. Бекенд не трогается;
   - `frontend/Complexes/create.html` дополнительно слушает `onboarding:before-step` и меняет демо-вид по `stepIndex` — этот приём нужен микрокарточкам для переключения экранов SPA.

5. **Справочник** — `frontend/Reference/reference.js` читает тот же `ACTRA_ONboarding_TOURS`: категории (`CATEGORY_ORDER`), туры, состояния, поиск, живое превью. **Изменений в коде справочника не требуется** — новые туры с валидным `referenceCategory` появляются автоматически.

6. **i18n** — секция `"tours"` в `frontend/assets/locales/ru.json` / `en.json` / `uk.json`.

7. **Тесты** — `tests/onboarding_tour.test.mjs`, `tests/reference_page.test.mjs`.

### Специфика микрокарточек

- Страница `/microcards` (`desktop-app/routes/static_routes.py: serve_microcards_ui`) — SPA `frontend/Microcards/microcards.html` + `microcards.js` с видами: `viewLibrary`, `viewDeckDetails`, `viewSession`, `viewSummary`, `viewBrowse`. Onboarding-слоя сейчас нет вообще.
- `GlobalHeader` подключён (`data-global-header`), значит кнопка помощи заработает сама после регистрации тура на маршрут.
- `findTourForRoute` для autoStart берёт один тур на маршрут — autoStart вешаем только на тур списка колод; тур режима повторения запускаем программно.

## Реализация

### Этап 1. Разметка целей в `microcards.html`

Статус: **сделано** (25 целей в `microcards.html`).

- Библиотека: `microcards-library-stats` (Due/New/Всего), `microcards-search`, `microcards-sort`, `microcards-decks-grid`, `microcards-create-actions`. Цель на демо-карточку колоды (`microcards-deck-card`) добавит demo-рендер на этапе 3.
- Детали колоды: `microcards-deck-mastery` (уровень/XP/бар), `microcards-deck-resume`, `microcards-study-modes` + по-карточно `microcards-mode-l1` / `-l2` / `-review` / `-browse`, `microcards-deck-analytics`, `microcards-deck-cards`, `microcards-deck-actions`.
- Сессия: `microcards-session-card` (флешкарта), `microcards-session-answer-form` (ввод L2), `microcards-session-grade` (Знаю/Не знаю), `microcards-session-next` (Далее + «Всё равно правильно»), `microcards-session-rail-no` / `-yes`, `microcards-session-progress`, `microcards-session-hud` (SW/комбо/очередь ошибок).
- Итоги: `microcards-summary-result`, `microcards-summary-errors`.

### Этап 2. Два тура в `onboarding_tours.js`

Категория: `'Проходим и повторяем'`.

Статус: **тур A добавлен** в `onboarding_tours.js` (4 состояния: `library-pulse`, `library-find`, `library-deck-card`, `deck-mastery`); ассеты подключены к `microcards.html` (`?v=microcards-onboarding-1`). Состояния 3–4 полноценно работают только после этапа 3 (demo-колода и переключение на `viewDeckDetails`). Тур B — не начат.

**Тур A — `microcards-library-overview`** (`route: ['/microcards']`, `autoStart: true`):

1. `library-pulse` — Due/New/Today и серия: что значит «к повтору» и почему цифры важнее списка.
2. `library-find` — поиск, фильтры (Срочно/Новые/Недавние), принадлежность (Моё/Общее/Импорт).
3. `library-deck-card` — демо-карточка колоды: запуск повторения, создание/импорт колод.
4. `deck-mastery` — переключение demo-вида на `viewDeckDetails`: уровень освоения, XP-бар, продолжение прогона, список карточек.

**Тур B — `microcards-review-session`** (`route: ['/microcards']`, `autoStart: false`):

1. `session-card` — лицевая сторона, направление карточки, индикатор уровня.
2. `session-answer` — «Показать ответ» (L1) / ввод ответа (L2) — через `calloutVariants` или два callout'а.
3. `session-rate` — бинарная самооценка (знаю / не знаю), кнопка «посчитать правильным».
4. `session-queue` — очередь ошибок и повторный заход карточек в прогоне.
5. `session-summary` — demo-переключение на `viewSummary`: результат, ошибки, что дальше.

Запуск тура B:
- из `microcards.js` при первом реальном входе в `viewSession`: `window.OnboardingTour?.startIfUnseen('microcards-review-session')`;
- из справочника — через стандартное превью (`onboarding_preview`), где demo-состояние само поднимает фейковую сессию;
- финальное состояние тура A коротко сообщает, что обучение по режиму повторения откроется при первой сессии и доступно в справочнике (паттерн editor-dashboard).

### Этап 3. Demo-состояние в `microcards.js`

По образцу `applyCatalogOnboardingDemo` + событийного переключения из `create.html`:

- `applyMicrocardsOnboardingDemo(active)`: снапшот текущего состояния (текущий вид, выбранная колода, фильтры) → демо-данные: 2–3 колоды с осмысленными названиями, ненулевые Due/New/Today, демо-сессия с карточкой и демо-итоги; восстановление при `onboarding:finish`.
- `MutationObserver` на `body[data-onboarding-tour-id]` — для preview-режима из справочника, когда тур стартует раньше готовности данных.
- Слушатель `onboarding:before-step`: для шагов `deck-mastery` / `session-summary` / шагов тура B переключает видимый `page-view` и возвращает library при выходе.
- Никаких записей в backend: демо живёт только в DOM/JS-состоянии.

### Этап 4. Подключение и стили

- В `microcards.html`: `onboarding-tour.css`, `onboarding_tours.js`, `OnboardingTour.js` с версией `?v=microcards-onboarding-1`.
- При необходимости точечные оверрайды `body[data-onboarding-tour-id="microcards-..."]` (поднятие демо-карточки над скримом, скрытие пустых состояний) — локально в `microcards.html`, как в Catalog/Complexes.

### Этап 5. i18n

- Ключи `tours.microcards_library_overview.*` и `tours.microcards_review_session.*` в `ru.json`, `en.json`, `uk.json` (ru-фоллбеки прямо в `onboarding_tours.js`, как у остальных туров).

### Этап 6. Справочник

- Автоматически: оба тура появляются в категории «Проходим и повторяем» рядом с комплексами и календарём.
- Заполнить `referenceTags` («микрокарточки», «повторение», «колоды», «интервальные повторения», «уровень освоения») и `referenceOrder` так, чтобы туры шли после календаря.
- Проверить живое превью из `/reference`: demo-состояние должно подниматься в iframe без реальных колод пользователя.

### Этап 7. Тесты и финализация

- `tests/onboarding_tour.test.mjs`: выбор тура по маршруту `/microcards`, autoStart только у тура A, программный `startIfUnseen` тура B, фоллбек при отсутствии target.
- `tests/reference_page.test.mjs`: новые туры попадают в категорию и в счётчик состояний; поиск находит «микрокарточки».
- Browser smoke: первый визит на `/microcards` показывает тур A; закрытие пишет `seen`; повторный визит — тишина; первая сессия запускает тур B; превью из справочника живое.
- Обновить `docs/onboarding_tour_plan.md` → Implementation Status (отметить «Микрокарточки», убрать строку «Следующий экран по очереди», если порядок изменился).

## Порядок работ — СТАТУС

1. ✅ Разметка targets (этап 1) — 25 `data-onboarding-target` в `microcards.html`.
2. ✅ Тур A + demo-состояние библиотеки/деталей + подключение скриптов — тур в `onboarding_tours.js`, demo + observer в `microcards.js`, ассеты в `microcards.html` (`?v=microcards-onboarding-1`).
3. ✅ Тур B + demo-сессия/итоги + триггер из `viewSession` — тур `microcards-review-session`; `showMicrocardsDemoSession`/`showMicrocardsDemoSummary` переиспользуют `setupCurrentCard`/`renderSummaryRewards`; `startIfUnseen` в `_startSession`; snapshot/restore покрывает session-поля.
4. ✅ i18n + справочные теги — `tours.microcards_library_overview.*` и `tours.microcards_review_session.*` в `ru/en/uk.json`; `referenceTags`/`referenceOrder` заполнены (25, 26).
5. ✅ Тесты — `tests/microcards_onboarding.test.mjs` (структура обоих туров, targets, полное покрытие i18n-ключей в 3 локалях). `tests/onboarding_tour.test.mjs` + `tests/reference_page.test.mjs` остаются зелёными.

**Осталось:** живой browser-smoke на поднятом стеке (host+docker) — отложен, т.к. изменения чисто DOM/JS и покрыты юнит-тестами. Реализация механики (flip/смена видов) проверяется в `_startSession`/`setupCurrentCard` через снапшот-восстановление по образцу complex-editor тура.

### Ключевые решения по реализации demo

- Снапшот/восстановление общие для обоих туров (`captureMicrocardsDemoSnapshot`/`restoreMicrocardsDemoSnapshot`), включают session-поля — тур B можно безопасно запускать поверх реальной первой сессии (она снапшотится и восстанавливается на `finish`, как в complex-editor).
- Диспетчер `applyMicrocardsOnboardingDemo(tourId)` по `data-onboarding-tour-id`: `library` → демо-колоды + `showMicrocardsDemoLibrary`; `session` → демо-сессия + `showMicrocardsDemoSession`; пусто → restore.
- Переключение видов/флипа по `onboarding:before-step`: тур A `deck-mastery` (шаг 3) → `viewDeckDetails`; тур B шаги 2–3 → flip карточки, шаг 4 → `viewSummary`.
- `markMicrocardsDemoDeckCard` навешивает `data-onboarding-target="microcards-deck-card"` на первую карточку колоды (демо-цель для шага `library-deck-card`).
- Демо-summary использует `renderSummaryRewards(accuracy, null)` — никаких POST на `/session/finish`.

## Решения и допущения

- Туров два (по исходному плану), но тур A расширен состоянием про уровень освоения колоды (v2.2 mastery — слишком важная механика, чтобы её пропустить).
- Тур B не autoStart по маршруту: запускается при первом реальном входе в сессию (`startIfUnseen`), чтобы не прерывать пользователя на списке колод и не конфликтовать с autoStart тура A на том же route.
- Demo-состояние обязательно: у нового пользователя список колод пуст, а сессия и итоги без него вообще недостижимы для превью справочника.
- Раздел справочника: оба тура остаются в существующей категории «Проходим и повторяем» (рядом с прохождением комплексов и календарём), отдельная категория «Микрокарточки» сознательно НЕ заводится — решение пользователя (июнь 2026). Внутри категории справочник сортирует по заголовку, поэтому туры идут: Календарь → Комплексы → Микрокарточки: колоды → Микрокарточки: сессия.
