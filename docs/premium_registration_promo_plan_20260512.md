# Registration premium promo plan

Дата фиксации: 2026-05-12

## Исходная цель

Реализовать промо-механику для новых пользователей:

- все пользователи, которые регистрируются с 13 мая 2026 по 1 июня 2026 включительно, получают премиум бесплатно;
- премиум выдается сразу после регистрации;
- срок бесплатного премиума: 21 день;
- промо должно работать для hosted-регистрации, а не зависеть от фронтенда.

## Принятые технические решения

- Окно промо зафиксировано как 2026-05-13 - 2026-06-01 включительно.
- Границы окна считаются в локальной зоне продукта `UTC+3`, чтобы дата 13 мая/1 июня соответствовала календарному дню для текущего запуска.
- Срок премиума считается от фактического времени создания аккаунта: `registered_at + 21 days`.
- Премиум хранится в существующих полях профиля:
  - `plan = "premium"`;
  - `premium_expires_at = <UTC ISO timestamp>`.
- Отдельная миграция БД не нужна: поле `premium_expires_at` уже есть в hosted identity schema.

## Связь с ручной админской выдачей premium

Регистрационное промо всегда выдаёт срочный premium:

- у пользователя выставляется `plan = "premium"`;
- `premium_expires_at` заполняется датой окончания через 21 день после регистрации;
- после истечения `premium_expires_at` effective plan снова становится `free`, если нет другого основания для premium.

Бессрочный premium является отдельной админской операцией для конкретного пользователя. Он хранится как:

- `plan = "premium"`;
- `premium_expires_at = null`.

В настройках администратора список пользователей должен показывать срок premium: оставшиеся дни и дату окончания для срочного доступа, либо `без ограничения` для бессрочного доступа. Администратор также может перевести конкретного пользователя на бессрочный premium, очистив `premium_expires_at`.

## Уже сделано локально

### Общая промо-логика

Файл: `desktop-app/services/user_service.py`

Добавлены:

- константы промо:
  - `REGISTRATION_PREMIUM_PROMO_DAYS = 21`;
  - `REGISTRATION_PREMIUM_PROMO_START_DATE = date(2026, 5, 13)`;
  - `REGISTRATION_PREMIUM_PROMO_END_DATE = date(2026, 6, 1)`;
  - `REGISTRATION_PREMIUM_PROMO_LOCAL_TZ = timezone(timedelta(hours=3))`;
- `registration_premium_promo_expires_at(registered_at)`;
- `apply_registration_premium_promo(user, registered_at)`.

### Подключение к созданию hosted-пользователей

Файл: `desktop-app/services/hosted_user_service.py`

Промо применяется перед сохранением пользователя в Postgres и legacy projection в трех путях создания:

- legacy hosted `create_user`;
- обычная hosted auth-регистрация `create_auth_user`;
- external auth/Google-регистрация `create_external_auth_user`.

### Тесты

Файл: `desktop-app/tests/unit/test_user_account_axes.py`

Добавлены проверки:

- 13 мая 2026 входит в промо-окно;
- 1 июня 2026 входит в промо-окно;
- 12 мая 2026 не входит;
- 2 июня 2026 не входит;
- применение промо выставляет `plan = "premium"`, `premium_expires_at` и дает effective premium.

### Пользовательская видимость промо

Файлы:

- `frontend/Welcome/welcome.html`;
- `frontend/Welcome/welcome.js`;
- `tests/welcome_hosted_auth.test.mjs`.

Добавлено:

- промо-блок на hosted registration форме: `21 день Premium бесплатно`;
- промо-пометка на карточке `Создать аккаунт`;
- сообщение на экране подтверждения почты, если backend вернул `effective_plan = "premium"` и `premium_expires_at`;
- frontend-регрессия на наличие промо-текста и отображение активированного premium после регистрации.

## Проверено

Успешно:

```powershell
python -m py_compile desktop-app/services/user_service.py desktop-app/services/hosted_user_service.py
```

Успешно:

```powershell
python -m pytest desktop-app/tests/unit/test_user_account_axes.py --basetemp=.pytest_tmp_registration_promo -q --no-cov
```

Результат: `10 passed`.

Примечание: запуск того же одиночного тестового файла без `--no-cov` прошел сами тесты, но упал на глобальном coverage-gate проекта, потому что одиночный прогон покрывает меньше 10% всего репозитория. Это не связано с промо-изменением.

Дополнительно после добавления UI-сообщения и админской индикации premium успешно:

```powershell
npx vitest run tests/welcome_hosted_auth.test.mjs tests/settings_theme_preferences.test.mjs
```

Результат: `19 passed`.

Успешно:

```powershell
pytest desktop-app/tests/unit/test_user_account_axes.py desktop-app/tests/unit/test_admin_routes_account_roles.py desktop-app/tests/unit/test_billing_routes.py desktop-app/tests/test_billing_service.py tests/test_hosted_auth_http.py -q --basetemp=.pytest_tmp_registration_promo_full --cov-fail-under=0
```

Результат: `49 passed`.

Успешно:

```powershell
python -m py_compile desktop-app/services/user_service.py desktop-app/services/hosted_user_service.py desktop-app/routes/admin_routes.py
```

## Еще не сделано

- Не сделан коммит.
- Не создан PR.
- Не выполнена выкатка на прод.
- Не проведена проверка на проде после выкатки.
- Не проведен полный регрессионный прогон всего проекта.

## Рекомендуемый следующий план

1. Просмотреть локальный diff и убедиться, что формулировка дат/таймзоны устраивает.
2. Запустить более широкий backend-набор тестов вокруг auth/billing/hosted users.
3. Сделать коммит.
4. Создать PR или подготовить прямую выкатку по текущему релиз-процессу.
5. Выкатить на прод.
6. Проверить на проде регистрацию тестового аккаунта в промо-окне и наличие:
   - `plan = "premium"`;
   - `effective_plan = "premium"`;
   - `premium_expires_at` примерно через 21 день после регистрации.
