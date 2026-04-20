# Catalog Mockup Implementation Notes

> Historical note (`2026-04-13`): заметки ниже выросли из copy-based mockup каталога. Текущий целевой вектор уже другой: linked-library entries по умолчанию и explicit fork вместо неявной личной копии. Использовать только как reference по UI-паттернам, а не как источник актуальной продуктовой семантики.

Дата обновления: `2026-04-09`

## Зачем нужен этот документ

Этот документ отвечает на практический вопрос:

- что из [catalog-mockup.html](D:/Ai%20Ai/radioproject_git/frontend/Catalog/catalog-mockup.html) можно переносить в живую реализацию почти напрямую;
- что нужно собирать из уже существующих UI-блоков проекта;
- что в макете является только демонстрационным оформлением и не должно переходить в production UI как есть.

Он нужен, чтобы не путать:

- `сценарный HTML-макет`;
- и `реальную сборку экрана` из существующих проектных паттернов.

## Общий вывод

Макет полезен как:

- сценарная карта состояний;
- ориентир по иерархии контента;
- ориентир по тому, какие сценарии обязательно должны быть видимы на одном экране.

Макет **не должен** переноситься в production как единая самостоятельная страница со своими локальными паттернами.

Живая реализация должна опираться прежде всего на уже существующие project building blocks:

- фоновые surface/panel паттерны из [Theory_Center.html](D:/Ai%20Ai/radioproject_git/frontend/Editor/Theory_Center.html);
- карточные и filter-паттерны из [frontend/Complexes/index.html](D:/Ai%20Ai/radioproject_git/frontend/Complexes/index.html);
- modal/confirm/preview flow из [WorkspaceImportClient.js](D:/Ai%20Ai/radioproject_git/frontend/assets/WorkspaceImportClient.js);
- проектные токены из:
  - [fonts.css](D:/Ai%20Ai/radioproject_git/frontend/assets/fonts.css)
  - [lightB-variables.css](D:/Ai%20Ai/radioproject_git/frontend/assets/lightB-variables.css)
  - [lightB-components.css](D:/Ai%20Ai/radioproject_git/frontend/assets/lightB-components.css)
  - [animations.css](D:/Ai%20Ai/radioproject_git/frontend/assets/animations.css)

## Что можно переносить почти напрямую

### 1. Набор состояний

Почти напрямую переносится сам список обязательных состояний:

- основной каталог;
- detail panel;
- preview комплекса;
- preview теории;
- success;
- already in library;
- empty state.

Именно это и есть самая сильная сторона макета.

### 2. Информационная иерархия каталога

Можно сохранять:

- сверху заголовок и короткое пояснение;
- ниже поиск;
- затем фильтры;
- затем сетку карточек;
- затем вторичные состояния вроде detail/preview/success.

Это соответствует и brief, и уже существующим страницам проекта.

### 3. Базовая форма card-state семантики

Можно сохранять сами состояния карточек:

- `Можно добавить`
- `В библиотеке`
- `Открыть копию`
- `Моя публикация`
- `hover`

Но визуально их лучше собирать через существующие badge/button patterns проекта, а не через локальную `cat-*` систему как источник истины.

### 4. Базовая форма detail/preview/success narrative

Можно переносить как сценарий:

- detail не импортирует сразу, а ведёт в preview;
- preview объясняет последствия действия;
- success даёт `Открыть копию`;
- already-in-library ведёт в existing copy.

Это полностью совпадает с текущим backend и нашим Stage 5 contract.

## Что нужно собирать из существующих блоков проекта

### 1. Модальные окна

Нельзя переносить локальную разметку `cat-modal` как production-source.

Нужно собирать из:

- modal overlay pattern;
- confirm flow;
- project button hierarchy;
- toast/notification semantics;

которые уже живут в [WorkspaceImportClient.js](D:/Ai%20Ai/radioproject_git/frontend/assets/WorkspaceImportClient.js) и `NotificationUI`.

Причина:

- эти слои уже выровнены под проект;
- там уже убраны browser-default dialogs;
- там уже есть правильные interaction contracts.

### 2. Preview / confirm / success flow

Нужно строить поверх уже существующих route contracts и shared helper-ов:

- `preview add to library`
- `library status`
- `execute add to library`

Макет здесь полезен как визуальный ориентир, но не как исходник поведения.

### 3. Поиск и фильтры

Нужно собирать на базе текущих controls-паттернов из [frontend/Complexes/index.html](D:/Ai%20Ai/radioproject_git/frontend/Complexes/index.html), а не копировать локальную `cat-filters` систему один в один.

Причина:

- в `Complexes` уже есть зрелые toolbar/filter blocks;
- они лучше соответствуют текущей visual системе проекта;
- это уменьшит разъезд между экраном каталога и остальными поверхностями.

### 4. Карточки каталога

Карточки нужно не копировать как есть, а пересобрать из:

- card shell;
- pills/badges;
- action buttons;
- text hierarchy;
- hover/raise motion;

уже знакомых проекту.

Из макета стоит брать:

- набор полей;
- порядок информации;
- логику CTA;

но не обязательно локальные отступы, радиусы и именование классов.

### 5. Detail panel

Её стоит собирать как вариацию уже существующих project panels, а не как новый isolated pattern.

Лучший ориентир:

- surface treatment и layering из [Theory_Center.html](D:/Ai%20Ai/radioproject_git/frontend/Editor/Theory_Center.html);
- card/panel language из [frontend/Complexes/index.html](D:/Ai%20Ai/radioproject_git/frontend/Complexes/index.html).

## Что не нужно переносить в production как есть

### 1. Локальную `cat-*` дизайн-систему как отдельный источник истины

В макете она допустима как demo-обвязка, но в production её нельзя считать отдельной новой UI-системой.

Нельзя:

- переносить страницу как “новый автономный island дизайна”;
- строить рядом с существующей системой ещё одну локальную.

### 2. Quick-nav по секциям

Блок навигации по секциям в правом верхнем углу полезен только для демонстрации макета.

В production UI он не нужен.

### 3. Демонстрационный forced-hover

`hover demo` в карточке — это полезная макетная подсказка, но не production-сущность.

Нужно оставить только сам hover behavior, а не отдельную карточку-секцию, которая объясняет hover.

### 4. Сценарное размещение всех состояний на одной странице

В живом UI все состояния не будут одновременно видны как сейчас в mockup.

То есть в production нельзя механически переносить:

- success modal;
- already in library modal;
- empty state;
- detail panel;
- preview modal;

как одновременно существующие static blocks.

Макет здесь нужен только как “лист всех состояний”.

### 5. Локальный JS демо-интерактивности

Встроенный JS в mockup нужен только для демонстрации:

- переключения фильтров;
- визуальной смены selected-state.

Production реализация должна питаться от реальных catalog routes и реального state management страницы.

## Разбор по секциям

### Основной каталог

Переносим:

- структуру шапки;
- поиск;
- фильтры по типу и статусу;
- сетку карточек;
- общую плотность информации.

Собираем из существующих блоков:

- toolbar/search/filter shell;
- card shell;
- pills/badges;
- actions.

Не переносим как есть:

- page-specific class system;
- локальный demo JS.

### Detail panel

Переносим:

- сам паттерн раскрытия;
- порядок информации:
  - title
  - author/freshness
  - description
  - summary
  - CTA в preview

Собираем из существующих блоков:

- surface shell;
- rows/meta blocks;
- primary/secondary actions.

Не переносим как есть:

- локальную реализацию panel layout;
- любые числовые summary, которые мы уже исключили продуктовым решением.

### Preview: Комплекс

Переносим:

- сам факт отдельного preview;
- таблицу/summary created vs reused;
- явное объяснение последствий add-to-library;
- блок пояснения про idempotency/reuse.

Собираем из существующих блоков:

- modal shell;
- confirm footer;
- badges/summary cards;
- route-driven preview data.

Не переносим как есть:

- локальную `cat-preview-table` как канонический UI-компонент;
- произвольные demo-числа без связи с backend response.

### Preview: Теория

Переносим:

- упрощённый preview;
- отдельность от complex preview;
- короткое объяснение про личную копию.

Собираем из существующих блоков:

- те же modal/confirm patterns, что и у complex preview.

### Success

Переносим:

- success toast;
- success modal;
- CTA `Открыть копию`;
- secondary CTA возврата.

Собираем из существующих блоков:

- notification/toast layer;
- modal shell;
- primary/secondary action layout.

Не переносим как есть:

- success markup как isolated custom component;
- SVG-checkmark как обязательный уникальный артефакт, если уже есть проектный success language.

### Already in library

Переносим:

- отдельное идемпотентное состояние;
- переход к existing copy.

Собираем из существующих блоков:

- status/read-model from backend;
- modal shell;
- action buttons.

### Empty state

Переносим:

- сам сценарий;
- спокойную тональность;
- CTA сброса фильтров.

Собираем из существующих блоков:

- existing empty-state visuals проекта;
- project typography and spacing.

## Практическое правило для живой реализации

Если коротко:

- из макета берём `сценарии`, `информационную иерархию` и `состав состояний`;
- из проекта берём `реальные UI-блоки`, `поведение`, `токены` и `interaction layer`.

То есть:

- `mockup = что должно быть показано`
- `existing project UI = как это реально должно быть собрано`

## Следующий правильный шаг

Перед началом живой сборки catalog UI стоит сделать ещё один документ или короткий implementation checklist:

- `Catalog page shell`
- `Catalog cards`
- `Catalog detail panel`
- `Catalog add-to-library preview`
- `Catalog success/already-in-library states`

И для каждого пункта отметить:

- какие existing files/components переиспользуем;
- какие новые thin wrappers нужны;
- какие куски вообще не пишем заново, а только адаптируем.
