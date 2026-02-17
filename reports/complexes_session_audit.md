# Фаза 3 — Аудит: Комплексы и Сессии

**Дата:** 2026-02-11
**Область:** `frontend/Complexes/`, `frontend/S1/`, `frontend/S2/`, `frontend/S3/`, `desktop-app/server.py` (complexes API)

---

## Баги (BUG)

### BUG-1: `error-state` вложен внутрь `empty-state` — ошибка загрузки никогда не видна ✅ ИСПРАВЛЕНО
**Файл:** `Complexes/index.html:52-81`
**Описание:** `<div id="error-state">` находится внутри `<div id="empty-state" hidden>`. Когда `empty-state` скрыт (а он скрыт по умолчанию), `error-state` тоже невидим даже при `hidden=false`. При ошибке загрузки пользователь видит пустую страницу без объяснения.
**Исправление:** `error-state` вынесен как sibling `empty-state`.
**Приоритет:** Высокий

### BUG-2: S2 `finish-complex-btn` — кнопка без обработчика ✅ ИСПРАВЛЕНО
**Файл:** `S2/index.html:126-133`
**Описание:** Кнопка «Завершить комплекс» в header S2 не имеет click-обработчика. Нажатие ничего не делает. Должна либо завершать сессию, либо вести назад к списку комплексов.
**Исправление:** Добавлен обработчик с `NotificationUI.confirm()` → редирект на `/ui/complexes`.
**Приоритет:** Высокий

### BUG-3: S2 `to-complex-list-btn` использует `window.history.back()` вместо прямого URL ✅ ИСПРАВЛЕНО
**Файл:** `S2/index.html:1037`
**Описание:** `window.history.back()` ненадёжен — если пользователь попал на страницу напрямую (по ссылке/закладке), back() уведёт на случайную страницу или вообще не сработает. Должен быть `/ui/complexes`.
**Исправление:** Заменено на `window.location.href = '/ui/complexes'`.
**Приоритет:** Средний

### BUG-4: S1 `handleCancelSession` использует нативный `window.confirm()` ✅ ИСПРАВЛЕНО
**Файл:** `S1/session-controls.js:693`
**Описание:** `window.confirm()` вместо стилизованного `NotificationUI.confirm()`. Визуально выбивается из общего UI.
**Исправление:** Заменено на `NotificationUI.confirm()`.
**Приоритет:** Низкий (UX)

---

## Слабые места (WEAK)

### WEAK-1: Нет guest-защиты на API комплексов (POST/PUT/DELETE) ✅ ИСПРАВЛЕНО
**Файл:** `desktop-app/server.py` — `create_complex`, `update_complex`, `delete_complex_endpoint`, autosave endpoints
**Описание:** В отличие от editor API (где мы добавили `guest_cannot_edit`), endpoints комплексов не проверяют `_headless_app_ctx.user_id == "guest"`. Гость может создавать, редактировать и удалять комплексы.
**Исправление:** Добавлена проверка `guest_cannot_edit` на 6 endpoint-ов: create, update, delete, autosave POST/DELETE, restore.
**Приоритет:** Высокий

### WEAK-2: `alert()`/`confirm()` в 10+ местах (Фаза 3) ✅ ИСПРАВЛЕНО
**Файлы:**
- `Complexes/index.html` — 2 × `confirm()`, 2 × `alert()`
- `Complexes/create.html` — 1 × `confirm()` (автосохранение), 1 × `alert()` (пустая история), 1 × `confirm()` (восстановление), 1 × `alert()` (успех восстановления), 3 × `confirm()` (удаление сцепки)
- `S1/session-controls.js` — 1 × `window.confirm()`
- `S2/index.html` — 1 × `alert()`
**Описание:** Нативные браузерные диалоги — визуальная несогласованность с UI. Нужно заменить на `NotificationUI`.
**Исправление:** Все 12 вызовов заменены на `NotificationUI.toast()` / `NotificationUI.confirm()`.
**Приоритет:** Средний

### WEAK-3: Dev-placeholder title на Complexes/index.html ✅ ИСПРАВЛЕНО
**Файл:** `Complexes/index.html:8`
**Описание:** `<title>Task Complexes List Page</title>` — англоязычный dev placeholder.
**Исправление:** Заменён на `Радиопроект — Комплексы заданий`.
**Приоритет:** Низкий

### WEAK-4: S2 скрытая карточка «Сложность» с хардкодом
**Файл:** `S2/index.html:178`
**Описание:** `<div class="hidden flex flex-col...">` — карточка «Сложность» скрыта с `class="hidden"` и содержит хардкод «2». Либо убрать, либо реализовать.
**Приоритет:** Низкий

---

## Нереализованный функционал (MISSING)

### MISSING-1: NotificationUI не подключён на страницах Фазы 3 ✅ ИСПРАВЛЕНО
**Файлы:** `Complexes/index.html`, `Complexes/create.html`, `S1/index.html`, `S2/index.html`, `S3/index.html`
**Описание:** `NotificationUI.js` не подключён ни на одной странице Фазы 3.
**Исправление:** `<script src="../assets/NotificationUI.js">` добавлен на все 5 страниц.
**Приоритет:** Высокий (блокирует WEAK-2)

### MISSING-2: Нет ESC-обработчика для модалок на S2/S3
**Описание:** На S2 и S3 нет модалок для обработки, но на S1 ESC уже обрабатывается через UIHelpers. Низкий приоритет.
**Приоритет:** Низкий

---

## План исправлений (все выполнены ✅)

| # | Находка | Действие | Файл(ы) | Статус |  
|---|---------|----------|---------|--------|
| 1 | BUG-1 | Вынести `error-state` из `empty-state` | `Complexes/index.html` | ✅ |
| 2 | BUG-2 | Добавить обработчик `finish-complex-btn` на S2 | `S2/index.html` | ✅ |
| 3 | BUG-3 | Заменить `history.back()` на `/ui/complexes` | `S2/index.html` | ✅ |
| 4 | BUG-4 + WEAK-2 | Заменить все alert/confirm на NotificationUI | Все файлы Фазы 3 | ✅ |
| 5 | WEAK-1 | Добавить guest-защиту на complexes API | `server.py` | ✅ |
| 6 | WEAK-3 | Исправить title | `Complexes/index.html` | ✅ |
| 7 | MISSING-1 | Подключить NotificationUI.js | 5 HTML файлов | ✅ |

**Не исправлены (низкий приоритет):**
- WEAK-4: Скрытая карточка «Сложность» на S2 — оставлена как есть (требует бэкенд-данных)
- MISSING-2: ESC-обработчик для модалок S2/S3 — не требуется (нет кастомных модалок)
