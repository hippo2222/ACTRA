# ТЗ: Feedback + Consent (API/UI)

## 1. Цель
Добавить в приложение:
- систему обратной связи от пользователей (баги, идеи, предложения);
- обязательное согласие с актуальными версиями `Terms` и `Privacy` при создании профиля;
- контролируемый сбор технических данных (только при явном opt-in пользователя).

## 2. Область работ
- Backend API для feedback и consent.
- UI для отправки feedback и принятия consent.
- Хранение версий юридических документов и фактов согласия.
- Логика повторного согласия при смене версии документов.

## 3. Вне рамок
- Админ-панель обработки тикетов.
- Полная legal-экспертиза текстов (используются шаблоны).
- Push-уведомления по статусу тикетов.

## 4. Бизнес-правила
- Профиль нельзя создать без согласия с обязательными документами.
- При изменении версии `Terms` или `Privacy` пользователь должен пере-принять согласие.
- Feedback можно отправлять только от существующего профиля.
- В feedback запрещено автоматически включать персональные/чувствительные данные без явного флага.

## 5. API контракты

### 5.1 GET `/api/legal/current`
Назначение: вернуть текущие версии документов.

Response `200`:
```json
{
  "ok": true,
  "documents": {
    "terms": {
      "version": "2026-02-15.1",
      "title": "Условия пользования",
      "effective_at": "2026-02-15T00:00:00Z"
    },
    "privacy": {
      "version": "2026-02-15.1",
      "title": "Политика приватности",
      "effective_at": "2026-02-15T00:00:00Z"
    }
  }
}
```

### 5.2 GET `/api/consent/status?user_id=<id>`
Назначение: проверить, актуально ли согласие пользователя.

Response `200`:
```json
{
  "ok": true,
  "status": "up_to_date",
  "required": {
    "terms_version": "2026-02-15.1",
    "privacy_version": "2026-02-15.1"
  },
  "accepted": {
    "terms_version": "2026-02-15.1",
    "privacy_version": "2026-02-15.1",
    "accepted_at": "2026-02-16T12:10:00Z"
  }
}
```

`status`:
- `up_to_date`
- `missing`
- `outdated`

### 5.3 POST `/api/consent/accept`
Назначение: зафиксировать согласие пользователя.

Request:
```json
{
  "user_id": "user_xxx",
  "terms_version": "2026-02-15.1",
  "privacy_version": "2026-02-15.1",
  "accepted": true
}
```

Response `200`:
```json
{
  "ok": true,
  "consent_id": "consent_abc123",
  "accepted_at": "2026-02-16T12:10:00Z"
}
```

Errors:
- `400` `consent_required`
- `409` `version_mismatch` (клиент согласился с устаревшей версией)

### 5.4 POST `/api/feedback`
Назначение: отправка сообщения обратной связи.

Request:
```json
{
  "user_id": "user_xxx",
  "type": "bug",
  "title": "Календарь не открывается",
  "description": "Шаги воспроизведения ...",
  "severity": "high",
  "include_technical_data": true,
  "technical": {
    "app_version": "1.0.0",
    "platform": "win32",
    "locale": "ru-RU"
  }
}
```

Response `201`:
```json
{
  "ok": true,
  "ticket_id": "fb_20260216_0001"
}
```

Errors:
- `400` `invalid_payload`
- `404` `user_not_found`
- `413` `payload_too_large`

### 5.5 GET `/api/feedback/options`
Назначение: отдать справочники для UI.

Response `200`:
```json
{
  "ok": true,
  "types": ["bug", "idea", "improvement", "question"],
  "severity": ["low", "medium", "high", "critical"]
}
```

## 6. Модель данных (минимум)

### `legal_documents`
- `doc_type` (`terms`|`privacy`)
- `version` (string)
- `effective_at` (datetime)
- `content_path` (string)
- `checksum_sha256` (string)

### `user_consents`
- `consent_id`
- `user_id`
- `terms_version`
- `privacy_version`
- `accepted_at`
- `source` (`onboarding`|`settings`)

### `feedback_tickets`
- `ticket_id`
- `user_id`
- `type`
- `title`
- `description`
- `severity`
- `status` (`new` default)
- `technical_payload` (json/null)
- `created_at`

## 7. UI требования

### 7.1 Onboarding/Create Profile
- Под полями профиля: два чекбокса:
  - `Я принимаю Условия пользования`
  - `Я ознакомился(ась) с Политикой приватности`
- Кнопка создания профиля заблокирована до обоих чекбоксов.
- Ссылки открывают модальное окно/экран с полным текстом документа.
- При `version_mismatch` UI обязан перезагрузить актуальные версии и повторить flow.

### 7.2 Re-consent при обновлении документов
- При входе пользователя проверить `/api/consent/status`.
- Если `outdated` или `missing`, показать блокирующий экран согласия.
- До принятия согласия навигация в основной функционал запрещена.

### 7.3 Feedback UI
- Точка входа: `Настройки` -> `Обратная связь`.
- Поля:
  - тип (dropdown)
  - заголовок (обязательно)
  - описание (обязательно)
  - severity (для `bug`)
  - чекбокс `Приложить технические данные`
- Успех: toast + выдать `ticket_id`.
- Ошибка: показать код/сообщение, сохранить черновик локально до повтора.

## 8. Сбор данных и приватность
- По умолчанию сбор телеметрии выключен.
- Технические данные прикладываются к feedback только при `include_technical_data=true`.
- Нельзя автоматически отправлять пароли, токены, содержимое закрытых полей.
- Рекомендуется хешировать/маскировать IP на сервере.

## 9. Коды ошибок (единый набор)
- `consent_required`
- `version_mismatch`
- `user_not_found`
- `invalid_payload`
- `payload_too_large`
- `feedback_submit_failed`

## 10. Критерии приемки
- Новый пользователь не может создать профиль без согласия с двумя документами.
- При изменении версии документа старое согласие считается неактуальным.
- Feedback успешно сохраняется и возвращает `ticket_id`.
- При выключенном флаге `include_technical_data` сервер не сохраняет `technical_payload`.
- API и UI корректно работают при отсутствии интернета (деградация: локальный черновик feedback).

## 11. План внедрения
- Этап 1: backend модели + API (`/legal`, `/consent`, `/feedback`).
- Этап 2: onboarding consent UI.
- Этап 3: feedback UI + локальный черновик.
- Этап 4: миграция и smoke-тесты.
