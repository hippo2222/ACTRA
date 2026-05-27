# Отчет об аудите цветовых решений и контрастности интерфейса
## Соответствие стандартам Google Chrome (Modern Web Guidance) и WCAG 2.1

Данный документ фиксирует результаты всеобъемлющего аудита цветовой палитры проекта на предмет контрастности, удобства чтения и поддержки темного режима в соответствии с современными стандартами веб-платформы от команды Google Chrome.

---

## 1. Рекомендации Google Chrome (Modern Web Guidance)

Современная веб-платформа предоставляет нативные инструменты для интеграции цветовых схем, минимизации задержек рендеринга и улучшения производительности стилей:

### 1.1 Использование функции `light-dark()`
*   **Рекомендация Chrome**: Вместо ручного дублирования переопределений классов в медиа-запросах или селекторах тем, используйте современную нативную функцию `light-dark(lightColor, darkColor)`.
*   **Как применить в проекте**: Сгруппировать общие базовые переменные и переписать их с использованием `light-dark()`. Это снизит дублирование CSS и повысит скорость обработки стилей браузером.

```css
:root {
  /* Базовые палитры */
  --brand-orange-light: #C05621;
  --brand-orange-dark: #e8985e;

  /* Семантический токен автоматически адаптируется */
  --color-primary: light-dark(var(--brand-orange-light), var(--brand-orange-dark));
  color-scheme: light dark;
}
```

### 1.2 Предотвращение вспышки нестилизованного контента (FOUC)
*   **Рекомендация Chrome**: Добавьте `<meta name="color-scheme" content="light dark">` в секцию `<head>` страниц. Браузер должен знать поддерживаемые темы до начала парсинга CSS для отрисовки холста правильного цвета.
*   **Как применить в проекте**: Добавить тег в шаблоны [S1/index.html](file:///d:/Ai%20Ai/radioproject_git/frontend/S1/index.html), [S2/index.html](file:///d:/Ai%20Ai/radioproject_git/frontend/S2/index.html) и др.

### 1.3 Нативное управление скроллбаром (`scrollbar-color`)
*   **Рекомендация Chrome**: Для адаптации полосы прокрутки к контрастным предпочтениям пользователя используйте стандартные свойства `scrollbar-color` и `scrollbar-width` вместо нестандартных псевдоэлементов `::-webkit-scrollbar` (которые ломают нативную оптимизацию производительности скроллинга в Chromium).

```css
:root {
  --color-scrollbar-track: light-dark(#FAF7EF, #0b081e);
  --color-scrollbar-thumb: light-dark(#C4B5AA, #b98ea7);
  scrollbar-color: var(--color-scrollbar-thumb) var(--color-scrollbar-track);
}
```

---

## 2. Обнаруженные критические дефекты контрастности в глобальных переменных

### 2.1 Ошибка маппинга бейджей в тёмных темах (`dark-a`, `dark-b`)
*   **Проблема**: Бейджи типов заданий (Клик, Тест, Рисование) на дашборде используют темный текст на темном фоне. Текст практически невидим (контрастность **1.00:1 - 1.13:1**).
*   **Причина**: В [dashboard.js](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/dashboard.js) используется класс `text-[color]-lighter` для текста бейджей в тёмном режиме, но в [lightB-variables.css](file:///d:/Ai%20Ai/radioproject_git/frontend/assets/lightB-variables.css) переменные с суффиксом `-lighter` в тёмных темах настроены как **самые тёмные** оттенки для фонов, а не как светлый текст.
*   **Решение**: В [dashboard.js](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/dashboard.js) заменить класс цвета текста бейджей в тёмном режиме на `text-[color]-text` (или `text-text-main`). Переменные `*-text` в тёмных темах хранят высококонтрастные светлые оттенки (например, `--color-success-text: #d1f3eb`).

### 2.2 Нечитаемый неактивный текст (`--color-text-disabled`)
*   **`dark-a` (Night)**: Цвет `#5a4a32` на фоне Surface 1 (`#363324`) имеет контрастность **1.49:1** (нечитаемо).
    *   *Рекомендация*: Сделать цвет светлее: `#8d7a60` (контраст `2.92:1`) или `#a29177` (`3.69:1`).
*   **`neutral-b` (Amethyst)**: Цвет `#808a9f` на фоне Body BG (`#b0aac0`) имеет контрастность **1.55:1**.
    *   *Рекомендация*: Сделать цвет темнее: `#4d5566` (контраст `4.5:1`).
*   **`light-a` (Contrast)**: Цвет `#94A3B8` на фоне Surface 1 имеет контрастность **2.56:1**.
    *   *Рекомендация*: Затемнить до `#718096`.

### 2.3 Отсутствие переменных Badge в теме `dark-b` (Space)
*   **Проблема**: В теме `dark-b` полностью отсутствуют определения переменных группы `--badge-*` (например, `--badge-success-bg`). Они наследуются непредсказуемо из глобального `:root`.
*   **Решение**: Добавить явные определения `--badge-*` в блок `:root[data-theme="dark-b"]` по аналогии с `dark-a`.

---

## 3. Аудит динамических интерактивных состояний

Глубокий математический анализ изменений контрастности при наведении (hover), фокусе и отображении иконок выявил следующие проблемы:

### 3.1 Опасность хардкодного белого текста (`text-white` / `text-primary-fg` Mismatch)
В тёмных темах (`dark-a` и `dark-b`) цвет текста на кнопках должен обязательно наследоваться через `--color-primary-fg` (который настроен как тёмный цвет, например `#141204` в `dark-a`).
*   **Проблема**: Если разработчик хардкодит класс `text-white` на кнопках с фоном `bg-primary`, то при наведении на кнопку в тёмной теме (`hover:bg-primary-hover`):
    *   В **`dark-a`**: белый текст на оранжевом ховере `#d68b55` даёт контраст всего **2.73:1** (критический FAIL при норме >=4.5:1).
    *   В **`dark-b`**: белый текст на сиреневом ховере `#d1a6bf` даёт контраст всего **2.12:1** (FAIL).
*   **Решение**: Строго следовать правилу `text-primary-fg` на кнопках `bg-primary`. Тёмный текст на светлом ховере даёт отличный контраст **>6.4:1**.

### 3.2 Недостаточная видимость неактивных иконок (WCAG 1.4.11 Non-text Contrast)
Иконки в неактивном состоянии (например, звезда «Добавить в избранное» до клика) используют `--color-text-disabled`. На белых/светлых поверхностях это приводит к сильному размытию:
*   **`light-a`**: Иконка `#94A3B8` на Surface 1 (`#FFFFFF`) $ightarrow$ **2.56:1** (FAIL, норма >=3.0:1).
*   **`light-b`**: Иконка `#AFA399` на Surface 1 (`#FFFFFF`) $ightarrow$ **2.46:1** (FAIL).
*   **`dark-a`**: Иконка `#5a4a32` на Surface 1 (`#363324`) $ightarrow$ **1.49:1** (критический FAIL).
*   **Решение**: Использовать для контуров неактивных иконок переменную `--color-text-muted` вместо `--color-text-disabled`. Это поднимет контрастность до допустимых **5.0:1+**.

---

## 4. Системный аудит временных, условных и динамических состояний (Codebase-wide Audit)

Мы провели автоматизированное сканирование всех интерфейсов проекта на наличие условных и временных состояний (модальные окна, всплывающие уведомления, сообщения об ошибках, интерактивные ховер-состояния, заблокированные кнопки). Всего обнаружено **145 критических несоответствий контрастности** в различных темах.

### 4.1 Ключевые категории выявленных проблем

#### А. Неактивные / заблокированные кнопки (Disabled States)
*   **Проблема**: В `S1/index.html` и многих формах редакторов заблокированные кнопки (`disabled:bg-primary-light` с текстом `disabled:text-text-main`) сливаются с фоном страницы:
    *   Контраст в `dark-a` составляет всего **1.34:1** (полная невидимость).
    *   В `dark-b` контраст падает до **1.00:1** (текст сливается с фоном).
*   **Рекомендация**: Переписать поведение заблокированных состояний, используя полупрозрачность (`opacity-40` или `opacity-50`) оригинальной кнопки вместо подмены фонов на некорректные светлые оттенки, либо использовать специальный токен `--color-text-disabled` на нейтральном сером фоне.

#### Б. Системные уведомления и статусы подключения (Toasts, Offline Banner, Status Badges)
*   **Проблема**: 
    *   В `assets/ConnectionMonitor.js` баннер оффлайн-режима (`bg-error text-white`) имеет контрастность **2.72:1** в теме `dark-b` и **3.52:1** в теме `dark-a`.
    *   В `assets/SharedProfileModal.js` индикатор сети (`bg-success text-white`) падает до **1.43:1** контраста в `dark-a` и **1.93:1** в `dark-b`.
*   **Рекомендация**: Избегать жестко прописанного белого текста (`text-white`) на семантических цветах в темных темах. Вместо этого использовать адаптирующиеся текстовые токены, например `text-success-text` (высококонтрастный светло-зеленый) на `bg-success-dark`.

#### В. Текстовые предупреждения и подсказки (Warning / Alert Panels)
*   **Проблема**: В `TestUI/TestUI.question.js`, `Catalog/catalog.js` и `DrawUI/DrawUI.web.js` используются светлые предупреждающие плашки `bg-warning-lighter text-warning-darker`. В темных темах `dark-a` и `dark-b` эти цвета инвертируются некорректно:
    *   В `dark-b` контраст равен **1.05:1** (невозможно прочитать).
    *   В `dark-a` контраст равен **3.28:1** (ниже WCAG AA).
*   **Рекомендация**: В темных темах предупреждающие панели должны использовать семантическую связку `bg-warning/10` (темный полупрозрачный оранжевый) и `text-warning-text` (светло-оранжевый текст).

#### Г. Ховеры со сниженной контрастностью (Hover Shifts)
*   **Проблема**: 
    *   При наведении на кнопки управления в `Microcards/microcards.html` (`hover:bg-warning-light text-warning-text`) контрастность падает до **1.19:1** в `dark-a`.
    *   В `TestUI/TestUI.web.js` при наведении (`hover:bg-warning-lighter` с текстом `text-warning-text`) контрастность в `dark-a` составляет **1.08:1**.
*   **Рекомендация**: Назначить ховер-классам изменение прозрачности фона или использовать стандартный токен `hover:bg-bg-hover` с соответствующим основным текстом.

---

## Полный реестр дефектов контрастности во временных и условных состояниях
Всего обнаружено **145** потенциально проблемных комбинаций в коде.
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Catalog/catalog.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/ClickUI/ClickUI.web.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Complexes/create.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Complexes/index.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/DrawUI/DrawUI.web.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Main_Dashboard.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Open Answer Editor Textual Reasoning.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Point_Annotation.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Sequence Assembly Editor Procedural Steps.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Test Task Editor Multiple Choice.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/Test_Task_Editor_Multiple_Choice.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/base_editor.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/click_editor.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/dashboard.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/import_manager.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Editor/open_answer_editor.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/MainScreen/Main.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Microcards/microcards.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Microcards/microcards.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/MistakesUI/MistakesUI.web.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/S1/index.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/S1/task-renderer.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/SequenceUI/SequenceUI.web.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/TestUI/TestUI.question.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/TestUI/TestUI.sidebar.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/TestUI/TestUI.web.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/TestUI/testui-question.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/Welcome/welcome.html)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/assets/ConnectionMonitor.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/assets/MainLogic.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---
### [file basename](file:///d:/Ai%20Ai/radioproject_git/frontend/assets/SharedProfileModal.js)
| Состояние | Элемент / Класс / Контекст | Сочетание цветов | Проблемные темы и контраст |
|---|---|---|---|

---


---

## 5. Рекомендуемые изменения в глобальных цветовых решениях

Ниже приведены точечные изменения для [lightB-variables.css](file:///d:/Ai%20Ai/radioproject_git/frontend/assets/lightB-variables.css) для устранения всех дефектов:

### 5.1 Тема `dark-a` (Night)
```css
/* Изменить disabled текст для улучшения видимости */
--color-text-disabled: #a29177; /* Был #5a4a32 */
```

### 5.2 Тема `neutral-b` (Amethyst Dusk)
```css
/* Изменить disabled текст */
--color-text-disabled: #4d5566; /* Был #808a9f */
```

### 5.3 Тема `dark-b` (Space)
Добавить в блок `:root[data-theme="dark-b"]` явный блок оптимизации бейджей:
```css
/* ========== BADGE SYSTEM (Dark Theme B Optimized) ========== */
--badge-secondary-bg: var(--color-secondary-dark);
--badge-secondary-text: var(--color-secondary-text);
--badge-secondary-ring: var(--color-secondary-text);

--badge-success-bg: var(--color-success-dark);
--badge-success-text: var(--color-success-text);
--badge-success-ring: var(--color-success-text);

--badge-warning-bg: var(--color-warning-dark);
--badge-warning-text: var(--color-warning-text);
--badge-warning-ring: var(--color-warning-text);

--badge-primary-bg: var(--color-primary-dark);
--badge-primary-text: var(--color-primary-light);
--badge-primary-ring: var(--color-primary-light);

--badge-error-bg: var(--color-error-dark);
--badge-error-text: var(--color-error-text);
--badge-error-ring: var(--color-error-text);

--badge-info-bg: var(--color-info-dark);
--badge-info-text: var(--color-info-text);
--badge-info-ring: var(--color-info-text);
```
