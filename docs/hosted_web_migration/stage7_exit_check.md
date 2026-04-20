# Stage 7 Exit Check

Дата: `2026-04-16`

## Решение

`Stage 7` можно доводить до formal exit-check без отдельного `apply-migration path` для текущего repo baseline.

Это не означает, что migration-тема исчезла навсегда. Это означает более узкое и безопасное решение:
- `dry-run inventory/report` остается обязательным gate;
- для baseline, где inventory уже дал `0`, отдельный apply-step не нужен;
- если в реальной среде появятся non-zero legacy imported-copy records, targeted apply utility проектируется только после нового dry-run отчета.

## Почему это решение корректно

Ключевая фактическая опора сейчас такая:

1. Репозиторный baseline по данным уже пустой.
- [hosted_stage7_inventory.json](D:/Ai Ai/radioproject_git/reports/hosted_stage7_inventory.json) на `2026-04-16` показывает:
  - `legacy_record_count = 0`
  - `safe_read_only_candidate = 0`
  - `keep_legacy_draft = 0`
  - `needs_manual_review = 0`

2. Основной Stage 7 debt сейчас не в миграции данных, а в operational semantics.
- `workspace_import` уже сужен до internal bridge only.
- hosted shadow writes уже blocked-by-default.
- readiness уже экспортирует degraded-state наружу.
- write-routes уже отдают явный `hosted_shadow_write_blocked` вместо generic `500`.

3. Отдельный apply-path при пустом inventory сейчас добавил бы больше поверхности риска, чем пользы.
- некого мигрировать в текущем `data/`;
- появится дополнительный код и contract, который нельзя проверить на реальном baseline;
- это отвлекает от более ценного финального шага: formal exit-check и degraded smoke.

## Что уже считается закрытым к этому решению

- есть dry-run inventory utility:
  - [hosted_stage7_inventory.py](D:/Ai Ai/radioproject_git/scripts/hosted_stage7_inventory.py)
  - [stage7_legacy_inventory_service.py](D:/Ai Ai/radioproject_git/desktop-app/services/stage7_legacy_inventory_service.py)
- есть явная inventory-классификация:
  - `safe_read_only_candidate`
  - `keep_legacy_draft`
  - `needs_manual_review`
- `workspace_import` не считается частью hosted product UX и закрыт как internal bridge по умолчанию
- shadow fallback уже не маскируется под нормальный hosted write-path
- route-level degraded responses уже формализованы и покрыты тестами

## Что остается operational debt

Это не blocker для отказа от apply-path, но это еще нужно добить перед полным закрытием Stage 7:

1. Финальный handoff.
- Зафиксирован в [stage7_handoff.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage7_handoff.md).

## Что уже дополнительно подтверждено

1. Formal exit-check для `Stage 5` и `Stage 6` уже зафиксирован.
- Текущая read-only linked-library модель уже синхронизирована с `implementation_memory`, `current_state` и живым кодом.

2. Финальный degraded smoke уже подтвержден автоматизированным прогоном `2026-04-16`.
- Прогон:
  - `pytest tests/test_hosted_shadow_write_policy.py tests/test_workspace_import_bridge_http.py tests/test_hosted_auth_http.py tests/test_complexes_theory_link_fallback.py -q`
- Результат:
  - `15 passed`
- Чем именно подтвержден baseline:
  - `/api/ready` экспортирует degraded-state для shadow fallback;
  - blocked shadow write возвращает явный `503 hosted_shadow_write_blocked`, а не generic `500`;
  - `workspace_import` bridge в hosted runtime остается blocked-by-default и открывается только явным internal opt-in;
  - hosted auth baseline не регрессировал;
  - linked complex -> attached theory fallback остается рабочим в деградированном окружении.

## Явное правило на будущее

Если позже появится environment, где inventory уже не `0`, действуем так:

1. Снова прогоняем dry-run inventory.
2. Сохраняем новый отчет.
3. Смотрим bucket-раскладку.
4. Только после этого решаем, нужен ли targeted apply utility.

То есть apply-path больше не считается обязательной частью Stage 7 "по умолчанию". Он считается conditional follow-up, который открывается только non-zero inventory.

## Следующий правильный шаг

После этого решения следующий шаг уже не в migration coding, а в финализации Stage 7:

1. использовать [stage7_handoff.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/stage7_handoff.md) как release-readiness baseline для `Stage 7`
2. открывать новый migration workstream только если будущий inventory станет non-zero
