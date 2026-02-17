# Аудит: Редактор — Дашборд и CRUD задач (Фаза 2)

**Файлы:** `frontend/Editor/Main_Dashboard.html`, `frontend/Editor/dashboard.js`, `frontend/Editor/base_editor.js`, `desktop-app/server.py` (маршруты /api/editor/*)

**Дата:** 2026-02-11

---

## Баги (BUG)

### BUG-1: `secure_filename()` уничтожает кириллические имена модулей/тем → пустой ID
**Файл:** `server.py:1428,1450`
**Описание:** `secure_filename("анатомия_грудной_клетки")` возвращает `""`. В результате: `module_dir = modules_dir / ""` — модуль создаётся прямо в корне `modules_dir`, перезаписывая всё. Аналогично для тем.
**Серьёзность:** **Критическая** — потеря данных, коллизии, невозможность создать модуль с кириллическим именем.

### BUG-2: `goBack()` в base_editor.js навигирует на несуществующий `/dashboard.html`
**Файл:** `base_editor.js:448`
**Описание:** Правильный путь — `/ui/editor` (или `Main_Dashboard.html`). Текущий код ведёт на 404.
**Серьёзность:** Высокая — кнопка "Назад" не работает ни в одном редакторе.

### BUG-3: `exportSelectedTasks()` находит не ту кнопку для loading state
**Файл:** `dashboard.js:1147`
**Описание:** `document.querySelector('#selection-action-bar button')` — это кнопка "Все" (первая в action bar), а не "Экспорт". Loading state отображается не на той кнопке.
**Серьёзность:** Низкая — визуальный глюк.

### BUG-4: `closeModals()` закрывает ВСЕ элементы с id `*-modal`, включая import modal
**Файл:** `dashboard.js:446`
**Описание:** `document.querySelectorAll('[id$="-modal"]')` ловит `import-modal`, `sidebar-delete-modal` и любые будущие модалки. Закрытие create-task-modal может побочно закрыть открытый import workflow.
**Серьёзность:** Средняя — может сбросить прогресс импорта.

### BUG-5: Нет проверки на пустой `module_id` после `secure_filename` для кириллицы
**Файл:** `server.py:1428,1450`
**Описание:** Даже после фикса BUG-1 нужна валидация — если ID оказался пустым, надо вернуть 400.
**Серьёзность:** Связана с BUG-1.

---

## Слабые места (WEAK)

### WEAK-1: Нет гостевой защиты на editor API endpoints
**Файлы:** `server.py:1034-1091, 1390-1461, 3654-3815`
**Описание:** Все editor endpoints (create/save/delete task/module/topic) не проверяют `user_id == "guest"`. Гость может создавать, редактировать и удалять задания.

### WEAK-2: Дублирование логики URL редактора в двух местах
**Файл:** `dashboard.js:614-624` и `dashboard.js:1513-1532`
**Описание:** `getEditorUrl()` и `switchEditor()` содержат одну и ту же маппинг-таблицу type→page. Расхождение при добавлении нового типа.

### WEAK-3: `alert()` / `confirm()` в 12+ местах
**Файлы:** `dashboard.js:225,229,464-473,497,518,522,531,554,576,580,607,1174,1530,1640,1668,1671,1675`
**Описание:** Нативные диалоги не соответствуют стилю приложения. `base_editor.js` имеет `showConfirmModal()` и `showToast()`, но dashboard их не использует.

### WEAK-4: Кнопка "Настройки" в sidebar не имеет обработчика
**Файл:** `Main_Dashboard.html:84-89`
**Описание:** Кнопка отрисована, но ни одного event listener не привязано. Клик ничего не делает.

### WEAK-5: `createTaskElement` не имеет иконки для `open_answer`
**Файл:** `dashboard.js:1399-1404`
**Описание:** Для open_answer используется дефолтная иконка `description` вместо специфичной.

---

## Нереализованный функционал (MISSING)

### MISSING-1: Title — dev placeholder
**Файл:** `Main_Dashboard.html:8`
**Описание:** `<title>RadManager Content Editor</title>` — не для пользователя.

### MISSING-2: `lang="en"` вместо `lang="ru"`
**Файл:** `Main_Dashboard.html:2`
**Описание:** Весь UI на русском, но `<html lang="en">`.

### MISSING-3: Нет переименования модулей/тем ✅ РЕАЛИЗОВАНО
**Описание:** Можно только создать и удалить. Нет rename API и UI.
**Реализовано:** Backend (`StorageService.rename_module/rename_topic`, API `/api/editor/module/rename`, `/api/editor/topic/rename`), UI (inline edit по кнопке ✏️ в sidebar, Enter подтверждает, Escape отменяет).

### MISSING-4: Нет ESC-обработчика для модалок
**Файл:** `dashboard.js`
**Описание:** Ни одна модалка (create task, create module, create topic, import, sidebar delete) не закрывается по ESC.

### MISSING-5: Нет Ctrl+S для сохранения на дашборде (но есть в редакторах через base_editor)
**Описание:** На уровне дашборда нет горячих клавиш вообще.

---

## План исправлений

| # | Тип | Исправление | Файл |
|---|-----|-------------|------|
| BUG-1 | fix | Заменить `secure_filename` на кириллице-совместимую транслитерацию + fallback UUID | server.py |
| BUG-2 | fix | `goBack()` → `/ui/editor` | base_editor.js |
| BUG-3 | fix | Правильный selector для кнопки "Экспорт" | dashboard.js |
| BUG-4 | fix | `closeModals()` → закрывать только create-* модалки | dashboard.js |
| WEAK-1 | fix | Добавить guest check на editor create/save/delete endpoints | server.py |
| WEAK-2 | fix | Вынести маппинг type→page в единую функцию | dashboard.js |
| WEAK-5 | fix | Добавить иконку для open_answer в sidebar | dashboard.js |
| MISSING-1 | fix | Title → "Радиопроект — Редактор" | Main_Dashboard.html |
| MISSING-2 | fix | lang="ru" | Main_Dashboard.html |
| MISSING-4 | fix | ESC закрывает модалки | dashboard.js |
