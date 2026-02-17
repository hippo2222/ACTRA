# Аудит системы учётных записей пользователей

**Дата:** 2026-02-10
**Статус:** Анализ завершён, ожидание решений по исправлениям

## Архитектура системы

### Компоненты
| Компонент | Файл | Роль |
|---|---|---|
| **User** (dataclass) | `desktop-app/services/user_service.py` | Модель пользователя |
| **UserService** | `desktop-app/services/user_service.py` | CRUD профилей |
| **ProfileController** | `desktop-app/logic/profile_controller.py` | Координация UI ↔ сервисы |
| **UserProgressManager** | `desktop-app/services/user_progress_manager.py` | Прогресс + mistake_bank |
| **ProgressService** | `desktop-app/services/progress_service.py` | Wrapper над UPM |
| **StatisticsService** | `desktop-app/services/statistics_service.py` | Агрегированная статистика |
| **CalendarService** | `desktop-app/services/calendar/calendar_service.py` | Календарь обучения |
| **Схемы валидации** | `desktop-app/services/schemas/user_schemas.py` | Profile/Progress/Statistics |
| **HTTP API** | `desktop-app/server.py` (строки 1860-2205) | REST-эндпоинты |
| **Frontend (Main)** | `frontend/assets/MainLogic.js` | UI профилей на главном экране |
| **Frontend (Stats)** | `frontend/statistics/statistics.js` | UI профилей на странице статистики |

### Потоки данных
- Создание: `Frontend → POST /api/users → UserService.create_user → profile.json + progress.json + statistics.json + complex_statistics.json`
- Авторизация: `Frontend → POST /api/users/select → AppContextHeadless.switch_user → ProgressService/CalendarService/StatisticsService/SessionAPI`
- Пароли: bcrypt (новые) + SHA-256 (legacy, автомиграция при верификации)

---

## БАГИ (требуют исправления)

### BUG-1: Мёртвый код после `return` в `delete_user` [КРИТИЧНОСТЬ: Низкая]
**Файл:** `desktop-app/services/user_service.py:442`
```python
        except Exception as e:
            self.logger.error(f"Error deleting user {user_id}: {e}")
            return False
    
        return self.get_user(user_id)  # ← МЁРТВЫЙ КОД — никогда не выполняется
```
Строка 442 недостижима — находится после `return False` в блоке `except` и `return True` в блоке `try`. Не влияет на функционал, но это мусор в коде.

### BUG-2: Frontend `confirmDeleteProfile` не передаёт `verification_password` [КРИТИЧНОСТЬ: Высокая]
**Файл:** `frontend/assets/MainLogic.js:277-298`
```javascript
window.confirmDeleteProfile = async function () {
    // ... password prompt вызывается ...
    let verificationPassword = null;  // ← объявляется но НИКОГДА не присваивается

    if (user && user.has_password) {
        const verified = await showPasswordPrompt(...);
        if (!verified) return;
        // ← verificationPassword всё ещё null!
    }

    const { ok } = await apiFetch('/api/users/delete', {
        body: JSON.stringify({ user_id: editingUserId })
        // ← verification_password НЕ ПЕРЕДАЁТСЯ!
    });
```
**Последствие:** Сервер требует `verification_password` для удаления пользователя с паролем (`server.py:2152-2155`), но фронтенд его не передаёт. Удаление защищённых профилей **всегда** завершится ошибкой 401.

### BUG-3: Статистика использует несуществующий API-эндпоинт для смены профиля [КРИТИЧНОСТЬ: Высокая]
**Файл:** `frontend/statistics/statistics.js:496`
```javascript
const res = await fetch(`/api/users/${userId}/select`, { method: 'POST' });
```
Правильный эндпоинт: `POST /api/users/select` с `{ user_id: userId }` в body (как в `MainLogic.js:187`).
**Последствие:** Смена профиля на странице статистики **не работает** — всегда 404.

### BUG-4: Мусорная директория в `data/users/` из-за неэкранированного шаблонного литерала [КРИТИЧНОСТЬ: Средняя]
**Путь:** `data/users/$ {                        encodeURIComponent(currentUser.user_id)                    }/`
Это директория, созданная в результате того, что JS-шаблонный литерал был обработан как простая строка (скорее всего при использовании кавычек вместо обратных кавычек). Директория пуста, но засоряет список пользователей в `get_all_users()` (выдаёт warning в логе, не ломает работу).

### BUG-5: При удалении пользователя не удаляются данные календаря [КРИТИЧНОСТЬ: Средняя]
**Файл:** `desktop-app/server.py:2168`
```python
success = user_service.delete_user(user_id)
```
`UserService.delete_user()` удаляет только `data/users/{user_id}/`. Но данные календаря хранятся в `data/user_calendar/{user_id}/` — они **остаются** после удаления профиля.

### BUG-6: Обновление профиля не проверяет дубликат имени [КРИТИЧНОСТЬ: Средняя]
**Файл:** `desktop-app/server.py:2066-2077`
При создании пользователя `_check_duplicate_name()` вызывается. Но при обновлении имени через `POST /api/users/update` проверка дубликатов **не выполняется**. Можно переименовать профиль и получить двух пользователей с одинаковым именем.

### BUG-7: `save_detailed_attempt` и `save_task_result` не проверяют guest-режим [КРИТИЧНОСТЬ: Средняя]
**Файл:** `desktop-app/services/progress_service.py`
- `save_evaluation_result` (строка 104) — **проверяет** `self.user_id == "guest"` → return False
- `save_detailed_attempt` (строка 154) — **НЕ проверяет** guest-режим
- `save_task_result` (строка 226) — **НЕ проверяет** guest-режим

Если гостевой пользователь каким-то образом вызовет `save_detailed_attempt`, прогресс будет записан в `data/users/guest/progress.json`.

### BUG-8: Дублирование логики верификации паролей (DRY violation) [КРИТИЧНОСТЬ: Низкая / Архитектурная]
Один и тот же код верификации bcrypt/SHA-256 скопирован в 3 местах `server.py`:
- `update_user_profile` (строки 2051-2063)
- `verify_user_password` (строки 2119-2129)  
- `delete_user_profile` (строки 2157-2163)

Любое изменение логики хеширования потребует обновления в 3 местах. Кроме того, в `delete_user_profile` при успешной верификации SHA-256 **не выполняется** автомиграция на bcrypt (в отличие от `verify_user_password` и `update_user_profile`).

### BUG-9: `password_hash` хранится в `to_api_dict()` response через `has_password` но `security_settings` утекают полностью [КРИТИЧНОСТЬ: Низкая]
**Файл:** `desktop-app/services/user_service.py:63-73`
```python
def to_api_dict(self) -> Dict[str, Any]:
    return {
        ...
        "has_password": bool(self.password_hash),
        "security_settings": self.security_settings,  # полностью
        ...
    }
```
Сейчас `security_settings` содержит только `require_password_on_login` и `require_password_on_edit` — безопасно. Но если в будущем туда добавятся чувствительные настройки, они утекут в API-ответ. Рекомендуется отдавать только нужные поля.

---

## АРХИТЕКТУРНЫЕ ПРОБЛЕМЫ

### ARCH-1: Данные пользователя разбросаны по двум деревьям директорий
- `data/users/{user_id}/` — профиль, прогресс, статистика, ui_state
- `data/user_calendar/{user_id}/` — данные календаря

Это нарушает принцип единой ответственности за пользовательские данные и приводит к BUG-5 (удаление не очищает calendar). Рекомендуется хранить всё под `data/users/{user_id}/calendar/`.

### ARCH-2: `AppContextHeadless.switch_user` — процедурная координация без транзакционности
**Файл:** `desktop-app/server.py:196-230`
`switch_user` обновляет 5 компонентов последовательно. Если один из них падает, система остаётся в несогласованном состоянии (часть сервисов работает с новым пользователем, часть — со старым).

### ARCH-3: `StatisticsService` дублирует логику `switch_user`
**Файл:** `desktop-app/services/statistics_service.py` (строки 133-136, 441-444, 579-582)
В трёх разных методах `StatisticsService` самостоятельно вызывает `progress_service.progress_manager.switch_user()` — защитный код на случай, если `switch_user` не был вызван ранее. Это дублирование и признак ненадёжности координации.

### ARCH-4: `ProgressService` не имеет собственного `switch_user()` метода
Вместо этого `server.py` напрямую изменяет поля:
```python
self.progress_service.user_id = user_id
self.progress_service.progress_manager.switch_user(user_id)
```
Нарушение инкапсуляции — вызывающий код должен знать внутреннюю структуру `ProgressService`.

### ARCH-5: Инициализация `UserService` создаёт progress.json v2.0, а `UserProgressManager` мигрирует его на v3.0
**Файл:** `user_service.py:362-377` — создаёт `progress.json` с `version: "2.0"`.
Затем при первом обращении `UserProgressManager._load_or_create_progress()` обнаруживает v2.0 и мигрирует на v3.0.
Лишний цикл записи. Можно сразу создавать v3.0 в `_initialize_user_data()`.

---

## ДАННЫЕ — МУСОР

| Путь | Проблема |
|---|---|
| `data/users/$ { encodeURIComponent(currentUser.user_id) }/` | JS-шаблон как имя папки (BUG-4) |
| `data/users/default_user/` | Предположительно legacy, если не используется |
| `data/users/guest/` | Должен создаваться только при необходимости |
| `data/users/u1/`, `data/users/user1/` | Вероятно тестовые/legacy пользователи без profile.json |
| `data/user_calendar/default_user/` | Calendar-данные для default_user, но реальный пользователь — `user_bcfd2787d56d` |

---

## ПРЕДЛАГАЕМЫЕ ИСПРАВЛЕНИЯ

### Исправление BUG-1 (мёртвый код)
Удалить строку 442 из `user_service.py`.

### Исправление BUG-2 (delete не передаёт пароль)
В `MainLogic.js:confirmDeleteProfile` — сохранять пароль из `showPasswordPrompt` и передавать его в запрос удаления:
```javascript
// Собираем пароль (из последнего промпта)
const { ok } = await apiFetch('/api/users/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: editingUserId, verification_password: lastVerifiedPassword })
});
```

### Исправление BUG-3 (wrong endpoint in statistics)
В `statistics.js:496` заменить:
```javascript
// БЫЛО:
const res = await fetch(`/api/users/${userId}/select`, { method: 'POST' });
// СТАЛО:
const res = await fetch('/api/users/select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId })
});
```

### Исправление BUG-5 (удаление не чистит calendar)
В `UserService.delete_user()` или в `server.py:delete_user_profile` — дополнительно удалять `data/user_calendar/{user_id}/`.

### Исправление BUG-6 (дубликат имени при update)
В `server.py:update_user_profile` — перед `user.name = name` добавить проверку:
```python
if name.lower() != user.name.lower():
    if user_service._check_duplicate_name(name):
        return jsonify({"ok": False, "error": "duplicate_name"}), 400
```

### Исправление BUG-7 (guest в save_detailed_attempt/save_task_result)
Добавить guest-проверку в оба метода `ProgressService`.

### Исправление BUG-8 (дублирование верификации)
Вынести в `UserService.verify_password(user_id, password) -> bool` и вызывать из всех трёх мест.

### Исправление ARCH-4+5 (ProgressService.switch_user + v3.0 init)
Добавить `ProgressService.switch_user(user_id)` и создавать progress.json сразу как v3.0.

---

## ПОТЕНЦИАЛЬНЫЕ УЛУЧШЕНИЯ

1. **Ограничение попыток ввода пароля** — сейчас нет rate-limiting на `/api/users/verify-password`. Можно добавить задержку или счётчик неудачных попыток.

2. **Экран выбора профиля при запуске** — если `last_user_id` указывает на несуществующего пользователя, система молча работает от `default_user`. Лучше показывать экран выбора.

3. **Очистка мусорных директорий** — добавить утилиту/одноразовую миграцию для удаления невалидных директорий из `data/users/`.

4. **Показывать дату создания и статистику на карточке профиля** — сейчас карточка показывает только имя и иконку замка.

5. **Подтверждение при смене профиля, если есть активная сессия** — сейчас `switch_user` не проверяет, есть ли незавершённая сессия.
