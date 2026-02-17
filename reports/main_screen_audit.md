# Аудит: Главный экран и навигация (Фаза 1)

**Файлы:** `frontend/MainScreen/Main.html`, `frontend/assets/MainLogic.js`, `frontend/assets/ThemeManager.js`, `frontend/assets/ThemeSwitcherUI.js`, `desktop-app/server.py` (маршруты quick-access, settings, users, stats)

**Дата:** 2026-02-11

---

## Баги (BUG)

### BUG-1: Карточка календаря навигирует гостя на /ui/calendar мимо блокировки
**Файл:** `Main.html:211`, `MainLogic.js:945-948`
**Описание:** Карточка календаря имеет `data-nav="/ui/calendar"`. Глобальный click-handler (`document.addEventListener("click", ...)`) ловит клики на любом `[data-nav]` элементе. Guest-overlay (`guest-lock-overlay`) является дочерним элементом карточки — клик по оверлею всплывает до карточки, и навигация срабатывает. Аналогичная блокировка для карточки статистики сделана правильно (`initStatsCardNavigation()`), но для календаря — пропущена.
**Серьёзность:** Высокая — гость обходит блокировку одним кликом.

### BUG-2: Кнопка "Открыть календарь" внутри карточки не защищена для гостя
**Файл:** `Main.html:265`
**Описание:** `onclick="event.stopPropagation(); window.location.href='/ui/calendar';"` — прямая навигация без проверки гостевого режима.
**Серьёзность:** Высокая — то же, что BUG-1, но через кнопку.

### BUG-3: Enter не отправляет форму пароля
**Файл:** `Main.html:475`, `MainLogic.js:344-353`
**Описание:** `<form onsubmit="return false;">` блокирует submit, но не вызывает `submitPasswordPrompt()`. Пользователь вынужден кликать мышкой по "Подтвердить".
**Серьёзность:** Средняя — UX сломан, все ожидают Enter.

### BUG-4: Enter не создаёт профиль
**Файл:** `Main.html:394`
**Описание:** Поле ввода имени `#newUserName` не обёрнуто в form и не имеет обработчика keydown. Enter ничего не делает.
**Серьёзность:** Средняя — аналогично BUG-3.

### BUG-5: `_read_ui_state("guest")` создаёт директорию `data/users/guest/` на диске
**Файл:** `server.py:580-581`
**Описание:** `user_dir.mkdir(parents=True, exist_ok=True)` вызывается безусловно, даже для гостя. Создаёт мусорную директорию.
**Серьёзность:** Низкая — не влияет на функциональность, но засоряет ФС.

---

## Слабые места (WEAK)

### WEAK-1: Дублирование вызова `/api/statistics/overall`
**Файл:** `MainLogic.js:493,615`
**Описание:** `loadStatistics()` вызывает `/api/statistics/overall?days=30`, а `loadCalendarWidget()` — `/api/statistics/overall` (без days, т.е. all-time). Два запроса к одному тяжёлому эндпоинту.

### WEAK-2: Для гостя загружаются все виджеты (wasteful API calls)
**Файл:** `MainLogic.js:44-53`
**Описание:** `initialize()` вызывает `loadQuickAccess()`, `loadStatistics()`, `loadCalendarWidget()` для гостя. Все данные скрыты оверлеем, но 5+ API запросов всё равно уходят на сервер.

### WEAK-3: `alert()` / `confirm()` вместо стилизованных модалок
**Файлы:** `MainLogic.js:139,145,151,163,179,279,281,302,340,370,901,919,929,934`
**Описание:** 14+ мест используют нативные диалоги. Несогласованно с остальным UI.

### WEAK-4: Нет индикатора загрузки при запуске сессии из Quick Access
**Файл:** `MainLogic.js:878`
**Описание:** `handleStartSession()` не показывает спиннер/disabled state. AbortController защищает от дублей, но визуально пользователь не получает обратную связь.

### WEAK-5: Нет закрытия модалок по ESC
**Файл:** `Main.html` — все 4 модалки (profile, editProfile, passwordPrompt, devModal)
**Описание:** Только клик по кнопке "Закрыть/Отмена". Нет обработки `keydown: Escape`.

---

## Нереализованный функционал (MISSING)

### MISSING-1: "Показать все" → заглушка (devModal)
**Файл:** `Main.html:191-193`
**Описание:** Кнопка "Показать все" рядом с "Быстрый доступ" открывает модалку "Раздел в разработке" вместо навигации на `/ui/complexes`.

### MISSING-2: Кнопка настроек → заглушка (devModal)
**Файл:** `Main.html:118`
**Описание:** Gear icon в хедере открывает ту же заглушку. Настройки вообще не реализованы как страница; есть только `/api/ui/settings` для хранения периода статистики.

### MISSING-3: Нет кнопки "Открепить" в Quick Access
**Файл:** `MainLogic.js:796-862`
**Описание:** Quick Access карточки не имеют кнопки unpin. API `/api/ui/quick-access/unpin` существует, но UI не предоставляет доступ.

### MISSING-4: Нет error-state для Quick Access виджета
**Файл:** `MainLogic.js:736-863`
**Описание:** Если API `/api/ui/quick-access` падает, контейнер пуст без сообщения об ошибке. У статистики есть retry — у Quick Access нет.

### MISSING-5: Заголовок страницы — dev-placeholder
**Файл:** `Main.html:8`
**Описание:** `<title>Radioproject Main Entry Screen (Variant 1)</title>` — не для пользователя.

---

## План исправлений

| # | Тип | Исправление | Файл |
|---|-----|-------------|------|
| BUG-1 | fix | Добавить guest-check на click для calendarCard (аналог statsCard) | MainLogic.js |
| BUG-2 | fix | Проверять guest перед навигацией в onclick кнопки календаря | Main.html |
| BUG-3 | fix | Форма пароля: onsubmit → submitPasswordPrompt() | Main.html |
| BUG-4 | fix | Input имени: onkeydown Enter → createNewProfile() | Main.html |
| BUG-5 | fix | Не создавать директорию для guest в _read_ui_state | server.py |
| WEAK-1 | fix | Убрать дублирующий вызов /api/statistics/overall из loadCalendarWidget | MainLogic.js |
| WEAK-2 | fix | Пропускать загрузку виджетов для гостя | MainLogic.js |
| WEAK-4 | fix | Добавить loading state на кнопку quick-access при запуске сессии | MainLogic.js |
| WEAK-5 | fix | Добавить ESC-обработчик для всех модалок | MainLogic.js |
| MISSING-1 | fix | "Показать все" → навигация на /ui/complexes | Main.html |
| MISSING-3 | fix | Добавить кнопку unpin в quick-access карточки | MainLogic.js |
| MISSING-4 | fix | Добавить error+retry state для quick-access | MainLogic.js |
| MISSING-5 | fix | Заменить title на "Радиопроект — Главная" | Main.html |
