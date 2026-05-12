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

## Еще не сделано

- Не сделан коммит.
- Не создан PR.
- Не выполнена выкатка на прод.
- Не проведена проверка на проде после выкатки.
- Не добавлен пользовательский текст/баннер о промо на фронтенде. Изначальная техническая цель была именно в автоматической выдаче премиума, но для маркетинговой видимости можно отдельно добавить UI-сообщение.
- Не проведен полный регрессионный прогон всего проекта.

## Рекомендуемый следующий план

1. Просмотреть локальный diff и убедиться, что формулировка дат/таймзоны устраивает.
2. При необходимости добавить UI-уведомление на welcome/register экране о бесплатных 21 днях премиума.
3. Запустить более широкий backend-набор тестов вокруг auth/billing/hosted users.
4. Сделать коммит.
5. Создать PR или подготовить прямую выкатку по текущему релиз-процессу.
6. Выкатить на прод.
7. Проверить на проде регистрацию тестового аккаунта в промо-окне и наличие:
   - `plan = "premium"`;
   - `effective_plan = "premium"`;
   - `premium_expires_at` примерно через 21 день после регистрации.

