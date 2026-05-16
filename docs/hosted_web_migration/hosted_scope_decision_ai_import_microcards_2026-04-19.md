# Hosted Scope Decision: AI / Import-Export / Microcards

Дата: `2026-04-19`

Назначение: принять явное scope-решение по трём спорным зонам финального hosted finish-line:

- `AI editor extras`
- `import/export`
- `microcards`

Этот документ не заменяет [hosted_finish_line_matrix.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/hosted_finish_line_matrix.md), а уточняет, какие из этих зон входят в launch-blocking hosted scope, а какие нет.

## Executive Summary

Зафиксированное решение на текущий момент:

1. `AI editor extras` — временно не считать launch-blocking функциональным контуром; допустимое launch-состояние: только полное прикрытие AI-поверхности явной заглушкой `in progress`.
2. `import/export` — оставить внутри launch-blocking hosted finish-line как обязательный workstream.
3. `microcards` — оставить внутри launch-blocking hosted finish-line как полноценный hosted product surface.

Причина такой асимметрии простая:

- `AI` по проектным аудитам и rollout-логике уже выглядит как полезный, но не обязательный внешний/authoring-adjacent слой, поэтому его допустимо временно закрыть честной заглушкой.
- `import/export` в коде и контрактах всё ещё живёт как legacy/editor import family, но теперь это осознанно не повод выталкивать его из finish-line: его надо довести.
- `microcards` по продуктовым документам уже рассматриваются как отдельный пользовательский режим с `main/calendar/statistics` интеграцией и ежедневной ценностью.

## 1. AI Editor Extras

### Рекомендуемое scope-решение

`AI editor extras` временно не считать launch-blocking функциональной частью hosted finish-line, но считать обязательным отдельный честный placeholder-state без partially-live AI поведения.

Практическая классификация:

- `scope_status = explicit_placeholder_only_for_launch`
- `product_role = editor-adjacent / post-release enhancement`

### Почему это разумно

1. В продуктовом аудите AI не описывается как core loop для релиза.
2. В [docs/product_surface_audit_matrix_20260304.md](D:/Ai Ai/radioproject_git/docs/product_surface_audit_matrix_20260304.md) прямо зафиксировано:
   - `Settings` для AI-ключей имеют статус `post-release`;
   - внешнее AI не должно определять судьбу основного релиза, если core loop не зависит критически от него.
3. В [docs/product_audit_prioritized_backlog_20260304.md](D:/Ai Ai/radioproject_git/docs/product_audit_prioritized_backlog_20260304.md) отдельно сказано:
   - не строить тяжёлый AI/recommendation слой до появления реальных пользовательских сигналов.
4. В коде AI живёт через feature-rollout и provider-config слой:
   - `desktop-app/routes/ai_routes.py`
   - `desktop-app/services/ai_generation_service.py`
   - `frontend/Editor/import_manager.js`
   Это больше похоже на развиваемый authoring/extras контур, чем на уже зафиксированный hosted launch contract.

### Что это означает practically

- AI routes и UI не удаляются.
- В launch-версии допустимо только полное прикрытие AI-поверхности явным состоянием `in progress`.
- Частично живой AI-поток в launch-версии больше не считается допустимым transitional состоянием.
- AI не должен ломать hosted launch, если:
  - provider keys не настроены;
  - внешний провайдер недоступен;
  - analysis rollout не включён;
  - сам AI-контур временно закрыт placeholder-режимом.
- Для launch-finish-line достаточно единого честного disabled/in-progress/error поведения без требования довести AI до полноценного `green`.

### Что остаётся обязательным даже при de-scope

- Никаких silent lies в UI.
- Честный feature-disabled/error state.
- AI не должен ломать editor/task/theory baseline.

## 2. Import / Export

### Рекомендуемое scope-решение

`import/export` считать launch-blocking частью strict hosted finish-line.

Практическая классификация:

- `scope_status = in_launch_finish_line`
- `product_role = required hosted product/editor contour`

### Почему это разумно

1. В текущем коде import/export контракты сами себя маркируют как legacy-family:
   - `namespace = legacy_editor_import`
   - `workspace_import = false`
   Это видно в:
   - `desktop-app/routes/import_routes.py`
   - `desktop-app/routes/editor_routes.py`
   - `desktop-app/services/import_export_service.py`
   - `desktop-app/services/complex_import_export_service.py`
2. `workspace_import` уже явно выведен из user-facing hosted UX и оставлен internal-only bridge:
   - `desktop-app/routes/workspace_import_routes.py`
   - `docs/hosted_web_migration/stage7_handoff.md`
3. В продуктовом backlog import/export описаны как зрелость/discipline workstream, а не как абсолютный launch blocker:
   - `task archive` — weaker layer;
   - `complex package import/export` — release-safe, но требует дальнейшего усиления;
   - унификация import layers вынесена в `P1 / Early Post-release`.
4. По microcards отдельно зафиксировано, что полноценный export/archive roundtrip вообще `P2`, то есть не релизный блокер.

### Что это означает practically

- Мы не удаляем текущие import/export flows.
- Мы считаем hosted transition незавершённым, пока import/export не получит явный hosted-контур без архитектурной двусмысленности.
- Значит, впереди нужен отдельный workstream на:
  - hosted source of truth;
  - strict route contract;
  - create/preview/confirm/degraded semantics;
  - официальный gate для import/export contour.

### Что остаётся обязательным даже при de-scope

- Не врать пользователю насчёт route contract.
- Не открывать `workspace_import` обратно как публичный hosted flow.
- Не допускать silent shadow write/read under the hood на hosted write-path'ах.
- Не ломать уже рабочие release-safe complex archive flows.

### Последствие этого решения

Теперь `import/export` больше не трактуется как optional compatibility debt.

Это означает:

- hosted finish-line включает и import flows, и export flows в той мере, в какой они реально присутствуют в web-продукте;
- следующий planning-этап должен рассматривать import/export как обязательную remaining surface;
- release больше нельзя будет считать завершённым только на основании `complex passage + catalog/library + auth`, если import/export ещё живёт в legacy-semantics.

## 3. Microcards

### Рекомендуемое scope-решение

`microcards` оставить внутри launch-blocking hosted finish-line.

Практическая классификация:

- `scope_status = in_launch_finish_line`
- `product_role = first-class user-facing hosted surface`

### Почему это разумно

1. В [docs/microcards_productization_v1_spec.md](D:/Ai Ai/radioproject_git/docs/microcards_productization_v1_spec.md) microcards описаны как полноценный продуктовый режим, а не как эксперимент:
   - отдельный `/microcards`;
   - интеграция в `main`;
   - интеграция в `calendar`;
   - интеграция в `statistics`;
   - manual editor;
   - text import.
2. В [docs/product_surface_audit_matrix_20260304.md](D:/Ai Ai/radioproject_git/docs/product_surface_audit_matrix_20260304.md) microcards имеют статус `must-have`.
3. В [docs/pre_release_manual_audit_plan.md](D:/Ai Ai/radioproject_git/docs/pre_release_manual_audit_plan.md) есть отдельный раздел по экрану `Микрокарточки` и отдельный минимальный smoke `test_microcards_api.py`.
4. В [docs/product_audit_prioritized_backlog_20260304.md](D:/Ai Ai/radioproject_git/docs/product_audit_prioritized_backlog_20260304.md) microcards фигурируют как одна из самых перспективных ежедневных петель продукта, а не как служебная утилита.

### Что это означает practically

Microcards нельзя просто de-scope'нуть ради удобства finish-line.

Значит, для hosted launch придётся довести:

1. hosted source of truth для deck/runtime/review state;
2. согласованную hosted readiness/degraded policy;
3. strict gate хотя бы на:
   - open deck;
   - review loop;
   - repeat-on-error;
   - summary;
   - propagation в `calendar/statistics/main`;
   - reopen/resume behavior.

### Что сейчас мешает

Сейчас microcards ещё не выглядят как hosted-green contour:

- `MicrocardsService` и `MicrocardsAnalyticsService` по факту остаются file/data-dir oriented;
- rollout всё ещё завязан на `RP_THEORY_ROLLOUT_STAGE` и `RP_MICROCARDS_ROLLOUT_STAGE`;
- hosted persistence contract ещё не выровнен с остальными hosted services.

Именно поэтому microcards сейчас должны считаться не de-scoped, а отдельным remaining hosted workstream.

## Итоговое решение

Если фиксировать решение сейчас, то рабочая рамка такая:

| Zone | Recommendation | Launch effect |
| --- | --- | --- |
| `AI editor extras` | `explicit in-progress placeholder only` | не блокирует launch как функциональный contour, но требует полного прикрытия AI-поверхности честным placeholder-state |
| `import/export` | `keep in scope` | блокирует hosted launch до явного hosted contour |
| `microcards` | `keep in scope` | блокирует hosted launch до явного hosted contour |

От пользователя зафиксировано:

- `import/export` считается обязательной частью hosted finish-line;
- `AI` допустимо временно полноценно прикрыть заглушкой `in progress`.
