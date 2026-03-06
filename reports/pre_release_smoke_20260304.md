# Предрелизный smoke-аудит

- Дата: 2026-03-04
- Режим: локальный интеграционный smoke-прогон
- Цель: быстро проверить, что основной релизный контур не сломан, и отловить явные блокеры до ручного UI-обхода

## Что прогонялось

Тесты запускались из `desktop-app` с `--no-cov`, потому что точечные одиночные прогоны изолированно валятся об глобальный порог покрытия `--cov-fail-under=10`, что мешает увидеть именно функциональный результат.

Запущено:

- `tests/integration/test_server_smoke.py`
- `tests/integration/test_profile_selection_logic.py`
- `tests/integration/test_statistics_screen_logic.py`
- `tests/integration/test_editor_api.py`
- `tests/integration/test_session_api_http.py`
- `tests/integration/test_microcards_api.py`
- `tests/integration/test_phase1_e2e.py`
- `tests/integration/test_phase2_e2e.py`
- `tests/integration/test_phase6_e2e.py`
- `npm run lint:frontend`
- `npm test`
- `python scripts/validate_release_catalog.py --data-dir data --require-non-demo`
- `python scripts/check_mojibake.py`

## Найденный дефект

### DEFECT-1 [HIGH] `GET /api/statistics/overall` падал `500` без активного профиля

Симптом:

- `test_server_smoke.py::test_statistics_overall` возвращал `500` вместо `200`

Корневая причина:

- Маршрут брал `request.args.get("user_id") or ctx.user_id`
- В headless-контексте `ctx.user_id` может быть пустой строкой, если активный профиль ещё не выбран
- Дальше `StatisticsService` вызывал `ProgressService.switch_user("")`
- Это приводило к валидационной ошибке `user_id: должно быть непустой строкой`

Побочный риск:

- Аналогичная логика была в quick-access и UI settings
- Это могло вести к работе с пустым `user_id` и потенциально к некорректному пути внутри `data/users`

## Что исправлено

Вынесен общий helper `routes._helpers._resolve_effective_user_id(...)`, который:

- принимает `user_id` из запроса, если он валиден;
- иначе берёт текущий `ctx.user_id`, если он непустой;
- иначе использует безопасный fallback `default_user`

Helper подключён в:

- `desktop-app/routes/statistics_routes.py`
- `desktop-app/routes/quick_access_routes.py`

Это закрывает падение статистики и стабилизирует “пассивные” UI-маршруты, которые должны жить даже при отсутствии активного профиля.

### DEFECT-2 [MEDIUM] Resume в `S1` был жёстко завязан на `window.loadInitialTask`

Симптом:

- Логика возобновления в `frontend/S1/session-controls.js` перезагружала задачу только через глобальный `window.loadInitialTask`

Риск:

- Если глобальный alias не успевает выставиться или меняется порядок инициализации, resume уходит в лишний `window.location.reload()`

Что сделано:

- Логика усилена: теперь resume сначала использует `window.Main.loadInitialTask`, затем fallback на `window.loadInitialTask`, и только потом делает полный reload

Это не был подтверждённый текущий production-crash, но это была хрупкая точка в самом важном пользовательском контуре.

## Результат после фикса

Все перечисленные smoke-тесты прошли.

Итог:

- Основной API-контур жив
- Editor API жив
- Session API жив
- Microcards API жив
- Сквозные E2E по фазам 1/2/6 живы
- Frontend lint зелёный
- Vitest зелёный (`15` файлов, `73` теста passed, `2` skipped)
- Release catalog validation зелёная
- Mojibake guard зелёный

## Вывод

На момент этого smoke-прогона найден один реальный релизный дефект в обработке пустого `user_id`; он исправлен и подтверждён повторным прогоном.

Следующий разумный шаг:

1. Перейти к фактическому ручному обходу критического пользовательского контура по `docs/pre_release_manual_audit_plan.md`
2. Начать с цепочки `Welcome -> Главная -> Комплексы -> S1 -> S2 -> S3`
