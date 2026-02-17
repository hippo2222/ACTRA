# Фаза 5 — Сквозные механизмы (cross-cutting)

**Дата:** 2026-02-11  
**Область:** Темы, картинки, целостность JSON, многовкладочность, первый запуск, обработка ошибок

---

## Сводка

| Категория | Кол-во |
|-----------|--------|
| BUG       | 4      |
| WEAK      | 7      |
| MISSING   | 3      |

---

## 5.1 Темы оформления (light/dark)

### Результат: ✅ Хорошо

- **ThemeManager.js** загружается **первым** в `<head>` на всех 13 HTML-страницах — нет FOUC.
- **ThemeSwitcherUI.js** подключена на всех 13 страницах — переключатель доступен везде.
- `ThemeManager.init()` читает `localStorage('app-theme')`, применяет `data-theme` на `<html>`, управляет `dark` классом Tailwind.
- `pageshow` обработчик восстанавливает тему из bfcache.
- 6 тем: `light-a`, `light-b`, `neutral-a`, `neutral-b`, `dark-a`, `dark-b`.

### WEAK-1: Некоторые `<html>` имеют hardcoded `class="light"` ⚠️
**Файлы:** `S1/index.html`, `MainScreen/Main.html`, `statistics/statistics.html`, `Complexes/index.html`  
**Суть:** `<html class="light">` — ThemeManager.init() перезапишет класс, но на момент парсинга CSS `dark:` утилиты Tailwind не применятся для тёмных тем. Возможен кратковременный flash (белый фон → тёмный). Остальные страницы (Editor, S2, S3) не имеют этого класса и полагаются только на ThemeManager — это правильнее.  
**Исправление:** Убрать `class="light"` из `<html>` — ThemeManager сам установит нужный класс.

---

## 5.2 Картинки: pipeline

### Результат: ⚠️ Есть проблемы

Два эндпоинта: `/api/local-image` и `/api/editor/image`.

### BUG-1: `/api/local-image` — абсолютные пути без проверки data_dir ❌
**Файл:** `server.py:3260-3262`  
**Суть:** Для абсолютных путей `target = p.resolve()` без `_is_within_data_dir()` проверки. Любой локальный процесс может запросить `/api/local-image?path=C:/Windows/System32/config/SAM` и получить файл. В отличие от `/api/editor/image`, который использует `_is_within_data_dir()`.  
**Контекст:** Это localhost-приложение, не интернет-сервер. Риск низкий, но это архитектурный антипаттерн.  
**Исправление:** Добавить `_is_within_data_dir(target)` проверку для абсолютных путей, аналогично `_resolve_editor_image_path`.

### WEAK-2: `/api/local-image` — rglob fallback может быть медленным ⚠️
**Файл:** `server.py:3271-3277` и `3292-3298`  
**Суть:** Если файл не найден по прямому пути, вызывается `data_dir.rglob(basename)` — рекурсивный поиск по всему дереву данных. При большом количестве файлов это может занять секунды. Лимит `max_matches=20` ограничивает только количество нефайловых совпадений, не файловых.  
**Исправление:** Кэшировать индекс файлов или использовать ограниченный поиск.

### WEAK-3: `/api/editor/image` — отсутствие кэширования ⚠️
**Файл:** `server.py:1636`  
**Суть:** `send_file()` вызывается без `Cache-Control` заголовков. Картинки перезагружаются при каждом рендере задания. Для десктоп-приложения это не критично, но при работе с большими изображениями может замедлять UI.  
**Исправление:** Добавить `Cache-Control: max-age=3600` или ETag.

---

## 5.3 Целостность данных: повреждённый JSON

### Результат: ✅ В основном хорошо

Проверены все основные JSON-загрузчики:

| Файл | JSONDecodeError обработка | Graceful degradation |
|------|---------------------------|---------------------|
| `session_repository.py:load_session` | ✅ Удаляет повреждённый файл, возвращает None | ✅ |
| `user_service.py:get_user` | ✅ Логирует, возвращает None | ✅ |
| `user_service.py:get_all_users` | ✅ Пропускает повреждённый профиль | ✅ |
| `user_progress_manager.py` | ✅ Пересоздаёт default structure | ✅ |
| `difficulty_config_loader.py` | ✅ Возвращает DEFAULT_CONFIG | ✅ |
| `complex_service.py:load_complexes` | ✅ Возвращает пустой список | ✅ |
| `storage_service.py:load_task` | ✅ Поднимает TaskLoadError | ✅ |
| `server.py:_read_ui_state` | ✅ Возвращает пустой state | ✅ |

### BUG-2: `session_repository.save_session` — неатомарная запись ❌
**Файл:** `session_repository.py:153-155`  
**Суть:** `open(session_file, 'w') + f.write(json_content)` — если процесс падает во время записи, файл будет повреждён (пустой или частичный JSON). В отличие от `_write_ui_state` в `server.py`, который использует `tempfile + os.replace` — атомарный паттерн.  
**Исправление:** Использовать write-to-temp + atomic-rename, как в `_write_ui_state`.

### WEAK-4: `complex_service.py:load_complexes` — нет JSONDecodeError обработки ⚠️
**Файл:** `complex_service.py:75-99`  
**Суть:** Внешний `except Exception` ловит всё, но нет специфичного `except json.JSONDecodeError` — повреждённый `complexes.json` будет залогирован с общим сообщением. Не критично функционально (возвращает пустой список), но затрудняет диагностику.  
**Исправление:** Добавить `except json.JSONDecodeError` с явным сообщением.

---

## 5.4 Многовкладочность: два таба — одна сессия

### Результат: ❌ Проблема

### BUG-3: Два таба с одной сессией → двойной submit/next ❌
**Файлы:** `session-controls.js`, `api-client.js`, `server.py`  
**Суть:** Нет механизма координации между вкладками. Если пользователь открывает `/ui/session/X` в двух табах:
1. Оба таба загружают одно и то же задание.
2. Пользователь отвечает в Tab A → ответ записывается, `current_task_index` продвигается.
3. Пользователь отвечает в Tab B → submit тоже проходит, но `task_id` уже не текущий → непредсказуемое поведение.
4. Оба таба вызывают `next_task` → индекс может продвинуться дважды, пропуская задание.

**Бэкенд:** `session_api.submit_answer()` не проверяет, что `task_id` совпадает с текущим `session.queue[current_task_index]`.  
**Фронтенд:** Нет `BroadcastChannel`, `localStorage` событий или серверных блокировок.  
**Исправление (минимальное):** Добавить проверку `task_id == current_task.task_id` на бэкенде при submit. Вернуть ошибку `task_id_mismatch` если не совпадает.

### WEAK-5: DraftStorage в localStorage — конфликт между табами ⚠️
**Файл:** `draft-storage.js`  
**Суть:** Оба таба пишут в один ключ localStorage. Последний записавший побеждает. Не критично, но может привести к потере черновика.  

---

## 5.5 Первый запуск: пустая программа

### Результат: ✅ В основном хорошо

| Экран | Пустое состояние | Обработка |
|-------|-----------------|-----------|
| MainScreen | Нет данных календаря | ✅ `calendarEmptyState` показывает «Начните обучение» |
| Complexes/index | Нет комплексов | ✅ `empty-state` div с сообщением |
| Editor Dashboard | Нет заданий | ✅ `createEmptyStateCard` с «Задания не найдены» |
| Statistics | Нет данных | ✅ Проверяет наличие данных перед рендером |
| Calendar | Нет активности | ✅ Показывает пустой календарь |

### WEAK-6: Editor Dashboard — `loadCatalog` без обработки пустого ответа ⚠️
**Файл:** `dashboard.js:92`  
**Суть:** `loadCatalog()` вызывается без `await` — если API вернёт пустой каталог, сайдбар будет пустой без объяснения. `renderGrid()` покажет «Задания не найдены», но сайдбар модулей/тем будет просто пуст — пользователь может не понять, что нужно создать модуль.  
**Исправление:** Показать подсказку «Создайте первый модуль» в сайдбаре, когда каталог пуст.

---

## 5.6 Обработка ошибок: сетевые сбои, таймауты, 500-ки

### Результат: ⚠️ Частично

### BUG-4: Flask — нет глобального error handler ❌
**Файл:** `server.py`  
**Суть:** Нет `@app.errorhandler(500)` или `@app.errorhandler(Exception)`. Если route-функция выбросит необработанное исключение, Flask вернёт HTML-страницу с traceback (в debug-режиме) или голый `500 Internal Server Error` (в production). Фронтенд вызывает `res.json()` — парсинг HTML как JSON вызовет дополнительный `SyntaxError` в catch.  
**Исправление:** Добавить глобальный error handler, возвращающий `{"ok": false, "error": "internal_server_error"}`.

### WEAK-7: `api-client.js` — нет таймаута на fetch ⚠️
**Файл:** `api-client.js`  
**Суть:** Все `fetch()` вызовы не имеют `AbortController` с таймаутом. Если сервер зависает (например, rglob на большой FS), UI остаётся в состоянии «Загружаем...» бесконечно.  
**Исправление:** Добавить `AbortController` с 30s таймаутом.

### Фронтенд — обработка ошибок по экранам:

| Экран | catch на fetch | UI-уведомление | Retry |
|-------|---------------|----------------|-------|
| S1 loadInitialTask | ✅ | ✅ showStatus | ❌ Нет retry |
| S1 submitAnswer | ✅ | ✅ showRetryOption | ✅ Есть |
| S1 nextTask | ✅ | ✅ showStatus | ❌ Нет retry |
| S1 pause | ✅ | ✅ showStatus | ❌ |
| S1 resume | ✅ | ✅ showStatus | ❌ |
| S2 loadIterationResults | ✅ | ✅ toast (исправлено Ф4) | ❌ |
| S3 loadSessionResults | ✅ | ✅ toast (исправлено Ф4) | ❌ |
| Complexes fetchComplexes | ✅ | ✅ error-state div | ❌ |
| Editor loadCatalog | ✅ | ⚠️ console.error | ❌ |

### MISSING-1: Editor `loadCatalog` — нет UI-ошибки при сетевом сбое ❓
**Файл:** `dashboard.js`  
**Суть:** Если `/api/editor/catalog` не отвечает, только `console.error`. Пользователь видит пустую страницу без объяснения.  
**Исправление:** Показать баннер ошибки в основной области.

### MISSING-2: Нет глобального offline-детектора ❓
**Файлы:** Все экраны  
**Суть:** Для десктоп-приложения сетевой сбой = сервер упал. Нет механизма обнаружения этого и показа единого «Потеряна связь с сервером» баннера. Каждый экран обрабатывает ошибки по-своему.  
**Исправление:** Глобальный heartbeat или `navigator.onLine` + periodic ping.

### MISSING-3: S1 `loadInitialTask` — нет retry при сетевом сбое ❓
**Файл:** `main.js:148-152`  
**Суть:** При ошибке загрузки задания показывается «Неожиданная ошибка», но нет кнопки «Повторить». Пользователь должен обновлять страницу вручную.  
**Исправление:** Добавить кнопку retry, аналогично `showRetryOption` в submitAnswer.

---

## Статус

| ID       | Описание                                              | Приоритет | Статус    |
|----------|-------------------------------------------------------|-----------|-----------|
| BUG-1    | /api/local-image абсолютные пути без проверки         | 🔴 Высок  | ✅ Исправлен |
| BUG-2    | session_repository неатомарная запись                  | 🔴 Высок  | ✅ Исправлен |
| BUG-3    | Два таба → двойной submit                             | 🟡 Средн  | ✅ Исправлен (task_id проверка + 409) |
| BUG-4    | Flask нет глобального error handler                   | 🔴 Высок  | ✅ Исправлен |
| WEAK-1   | HTML class="light" hardcoded                          | 🟢 Низк   | ✅ Исправлен (6 файлов) |
| WEAK-2   | rglob fallback медленный                              | 🟢 Низк   | ✅ Исправлен (_find_image_in_data_dir) |
| WEAK-3   | Нет кэширования картинок                              | 🟢 Низк   | ✅ Исправлен (Cache-Control: max-age=3600) |
| WEAK-4   | complex_service нет JSONDecodeError                   | 🟢 Низк   | ✅ Исправлен |
| WEAK-5   | DraftStorage конфликт между табами                    | 🟢 Низк   | ✅ Исправлен (TAB_ID изоляция) |
| WEAK-6   | Editor пустой сайдбар без подсказки                   | 🟢 Низк   | ✅ Исправлен (hint «Создайте модуль») |
| WEAK-7   | api-client нет таймаута                               | 🟡 Средн  | ✅ Исправлен |
| MISSING-1| Editor loadCatalog нет UI ошибки                      | 🟡 Средн  | ✅ Уже есть (NotificationUI.toast) |
| MISSING-2| Нет глобального offline-детектора                     | 🟢 Низк   | ✅ Исправлен (ConnectionMonitor.js, 13 стр.) |
| MISSING-3| S1 loadInitialTask нет retry                          | 🟡 Средн  | ✅ Исправлен |
