# Hosted Web Smoke Matrix

Дата обновления: `2026-04-20`

Этот документ фиксирует короткую smoke-матрицу для текущего hosted web состояния.
Цель: не покрыть все подряд, а быстро ответить на три вопроса:
- что обязательно должно работать прямо сейчас;
- что уже прикрыто автоматикой;
- что все еще требует ручной проверки или отдельного Stage 7 hardening.

## Обозначения

- `P0` — критический поток, без которого catalog/library сценарий фактически сломан.
- `P1` — важный поток, который не блокирует всю систему, но делает UX противоречивым.
- `Auto` — уже есть релевантное автоматическое покрытие.
- `Manual` — нужен ручной smoke или multi-user прогон.
- `Gap` — осознанно не закрыто или требует отдельного решения.

## Роли

- `Автор` — пользователь, который создает и публикует комплекс или теорию.
- `Потребитель` — другой пользователь, который ищет и добавляет публикацию в библиотеку.
- `Hosted fallback` — тот же сценарий, но при недоступном Postgres и уходе в filesystem shadow.

## Матрица

| ID | Приоритет | Сценарий | Роли | Ожидаемый результат | Покрытие | Источники |
| --- | --- | --- | --- | --- | --- | --- |
| `AUTH-01` | `P0` | Hosted login/register через `Welcome` | Автор, Потребитель | Пользователь может войти или зарегистрироваться без legacy profile switching | `Auto` + `Manual` | `tests/test_hosted_auth_http.py`, `tests/welcome_hosted_auth.test.mjs` |
| `AUTH-02` | `P0` | Hosted email verification / resend / forgot-reset flow через `Welcome` | Автор, Потребитель | После регистрации пользователь видит unverified state, получает письмо со ссылкой, может подтвердить email и при необходимости запросить reset password без legacy flow | `Auto` + `Manual` | `tests/test_hosted_auth_http.py`, `tests/welcome_hosted_auth.test.mjs` |
| `AUTH-03` | `P1` | Смена email в `Settings` требует подтверждения нового адреса | Автор, Потребитель | Новый email остаётся pending до подтверждения, active email не меняется преждевременно, resend работает, duplicate email change не раскрывает лишнее | `Auto` + `Manual` | `tests/test_hosted_auth_http.py`, `tests/settings_account_email_verification.test.mjs` |
| `CAT-01` | `P0` | Каталог показывает публичные публикации | Потребитель | В `Catalog` видны публичные items, доступные текущему пользователю | `Manual` | `frontend/Catalog/catalog.js`, `desktop-app/routes/catalog_routes.py` |
| `CAT-02` | `P0` | Автор видит в каталоге свои `public/access_code/private` публикации | Автор | Автор видит собственные публикации, даже если они не публичные | `Auto` + `Manual` | `tests/catalog_visibility_merge.test.mjs` |
| `PUB-01` | `P0` | Публикация комплекса в каталог | Автор | Для workspace-комплекса создаются или обновляются `CatalogItem` и immutable `CatalogVersion` | `Auto` | `tests/test_catalog_complex_linked_library.py` |
| `PUB-02` | `P1` | Публикация теории отдельно в каталог | Автор | Теория публикуется как отдельный catalog item и открывается как linked publication | `Auto` | `tests/test_catalog_theory_linked_library.py` |
| `PUB-03` | `P0` | Публикация комплекса с прикрепленной теорией | Автор | Публикация комплекса сохраняет связанную теорию и при нужной visibility публикует ее как dependency | `Auto` | `tests/test_catalog_complex_linked_library.py` |
| `VIS-01` | `P0` | Переключение visibility у публикации комплекса | Автор | `public/access_code/private` меняют доступ и отражаются в author surfaces | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `frontend/Complexes/index.html` |
| `VIS-02` | `P1` | Авторизованный пользователь не видит чужие private/code-only публикации без доступа, но автор видит свои | Автор, Потребитель | Каталог и related surfaces не прячут автора от его own items и не раскрывают лишнее другим | `Auto` + `Manual` | `tests/catalog_visibility_merge.test.mjs` |
| `ADD-01` | `P0` | Добавление комплекса из каталога в библиотеку | Потребитель | `Add to Library` создает или переиспользует linked entry, а не deep-copy по умолчанию | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `frontend/Catalog/catalog.js` |
| `ADD-02` | `P0` | Добавление комплекса по access code со страницы `Комплексы` | Потребитель | Комплекс добавляется в библиотеку по коду без обязательного захода в каталог | `Auto` + `Manual` | `tests/complexes_add_by_code_helpers.test.mjs`, `frontend/Complexes/index.html` |
| `ADD-03` | `P0` | При добавлении комплекса в библиотеку подтягивается связанная теория | Потребитель | В theory library появляется linked theory или доступный embedded fallback для attached theory | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `tests/complexes_linked_theory_resolution.test.mjs` |
| `OPEN-01` | `P0` | Потребитель открывает linked complex из своей библиотеки | Потребитель | Комплекс открывается как linked content без скрытой materialized personal copy | `Auto` + `Manual` | `tests/test_session_api_linked_complex.py`, `desktop-app/routes/complexes_routes.py` |
| `OPEN-02` | `P0` | Потребитель открывает attached theory у linked-комплекса | Потребитель | Теория открывается через theory-library entry текущего пользователя или через embedded fallback, без 404 на чужой entry | `Auto` + `Manual` | `tests/complexes_linked_theory_resolution.test.mjs`, `tests/test_catalog_complex_linked_library.py` |
| `OPEN-03` | `P1` | Автор открывает attached theory у собственного опубликованного комплекса | Автор | Stale `linked_library` ссылка не ломает открытие, используется fallback к source workspace theory | `Auto` + `Manual` | `tests/test_complexes_theory_link_fallback.py` |
| `TC-01` | `P0` | `Центр теории` не показывает пользователю чужие неимпортированные материалы | Потребитель | В hosted runtime пользователь видит только свои или импортированные комплексы и теории | `Auto` + `Manual` | `tests/test_theory_center_visibility.py`, `desktop-app/routes/theory_center_routes.py` |
| `TC-02` | `P1` | Linked theory публикации отображаются отдельно и не выглядят как редактируемые локальные сущности | Потребитель | Read-only linked content визуально отделен от authoring surfaces | `Auto` | `tests/theory_center_regressions.test.mjs` |
| `OWN-01` | `P1` | У non-author комплекса нет action `Редактировать` | Потребитель | На странице `Комплексы` для чужого linked или imported content не показывается edit-action | `Manual` | `frontend/Complexes/index.html` |
| `DEL-01` | `P1` | Удаление linked-комплекса из своей библиотеки | Потребитель | Комплекс удаляется из `complex-library`, runtime-linked state очищается | `Manual` | `desktop-app/routes/complexes_routes.py` |
| `DEL-02` | `P1` | Удаление linked-комплекса безопасно обрабатывает связанную linked-theory | Потребитель | Auto-added linked-theory удаляется только как safe cascade; вручную добавленная или разделяемая theory остается | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `current_state.md` |
| `DEL-03` | `P1` | Удаление linked-theory из personal library entry | Потребитель | Теория удаляется из personal library без воздействия на source publication и без удаления чужого доступа | `Auto` + `Manual` | `tests/test_catalog_theory_linked_library.py`, `tests/theory_center_regressions.test.mjs` |
| `ACC-01` | `P1` | После смены visibility на `access_code` existing linked entry требует код | Автор, Потребитель | linked entry не исчезает, но закрывается и переводится в `requires_access_code` | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `tests/test_catalog_theory_linked_library.py` |
| `ACC-02` | `P1` | После `private` или revoke existing linked entry перестает открываться | Автор, Потребитель | linked entry остается reference, но контент не открывается как вечная автономная копия | `Auto` + `Manual` | `tests/test_catalog_complex_linked_library.py`, `tests/test_catalog_theory_linked_library.py` |
| `FB-01` | `P0` | Fallback-режим при `postgres_dsn_missing` не ломает базовый catalog/library flow | Hosted fallback | Критические сценарии не должны деградировать до 404/пустых экранов без объяснимой причины | `Manual` | `current_state.md`, runtime logs |
| `FB-02` | `P1` | В fallback-режиме attached theory у linked-комплекса открывается корректно | Hosted fallback | Используется current-user binding или embedded fallback вместо ссылки на чужую theory entry | `Manual` | `current_state.md`, `tests/test_complexes_theory_link_fallback.py` |
| `FB-03` | `P1` | Blocked shadow write возвращает явный degraded-ответ, а не generic `500` | Hosted fallback | Hosted write-route отвечает `503` + `hosted_shadow_write_blocked`, readiness показывает degraded-state, opt-in env виден в payload | `Auto` + `Manual` | `tests/test_hosted_shadow_write_policy.py`, `desktop-app/routes/_helpers.py` |
| `BRG-01` | `P1` | `workspace_import` в hosted runtime остается internal bridge only | Hosted fallback, Ops/dev | Route по умолчанию закрыт, без internal header не открывается даже при opt-in env, с env+header проходит только как explicit internal bridge | `Auto` | `tests/test_workspace_import_bridge_http.py`, `desktop-app/routes/workspace_import_routes.py` |

## Complex Passage

Для workstream'а `Complex Passage` отдельным release-blocking сигналом считается:

```bash
npm run smoke:complex-passage:hosted
```

Подробный состав набора и его границы зафиксированы в `complex_passage_hosted_gate.md`.

### Readiness по подпотокам

| Срез | Статус | Чем подтверждено | Комментарий |
| --- | --- | --- | --- |
| Session lifecycle | `Green` | `complex_passage_spec.md`, `complex_wave1_active_sessions.test.mjs`, `complex_wave1_restart.test.mjs` | Старт, pause, resume, cancel и `resume_target` зафиксированы как основной контракт. |
| S1 task runtime | `Green` | `complex_wave1_types.test.mjs`, `complex_wave1_validation.test.mjs`, `complex_wave1_reload.test.mjs`, `complex_wave2_types_levels.test.mjs` | Все основные task families и submit/check flow подтверждены в S1. |
| Retry / skip / difficulty / iteration engine | `Green` | `complex_wave1_queue_pause_difficulty.test.mjs`, `complex_wave1_queue_retry.test.mjs`, `complex_wave2_adaptive.test.mjs`, `complex_wave2_mechanics.test.mjs` | Очередь, retry semantics, shuffled TEST partial retry и progression между итерациями синхронизированы. |
| S2 / S3 result surfaces | `Green` | `complex_wave1_flow_results.test.mjs`, `complex_wave1_reload.test.mjs`, `complex_wave2_flow_results.test.mjs`, `frontend/S2/index.html` | Контракты S2/S3 выровнены, а S2 result surface приведен к читаемому UTF-8. |
| Results propagation | `Green` | `complex_wave1_propagation.test.mjs`, `complex_wave2_propagation.test.mjs` | Финал комплекса подтвержденно попадает в статистику и календарный контур. |
| Hosted persistence | `Green` | `current_state.md`, hosted session persistence, hosted complex statistics persistence | Session/state/statistics source of truth больше не держится на локальных JSON как обязательной live-базе. |
| Runtime isolation / concurrency | `Green` | `desktop-app/tests/unit/test_session_api_hosted_isolation.py`, `current_state.md` | Hosted runtime больше не опирается на один global controller/lock. |
| Curated hosted gate | `Green` | `playwright.complex-passage-hosted.config.js`, `complex_passage_hosted_gate.md`, прогон `60 passed` от `2026-04-18` | Есть один явный обязательный gate перед релизом workstream'а. |
| True hosted runtime boot inside gate harness | `Green` | `tests/complex_audit/helpers/runtime_server.mjs`, `desktop-app/server.py`, прогон `npm run smoke:complex-passage:hosted` от `2026-04-18` | Harness теперь явно поднимает `desktop-app/server.py` с `ACTRA_RUNTIME_MODE=hosted_web`, проверяет `runtime_mode` через `/api/health` и проходит curated gate в реальном `hosted_web`; remaining local-only risk сузился до dev-auth bridge и shadow-write fallback без production Postgres/S3 entrypoint. |
| Production-like hosted infra contour | `Green` | `complex_passage_hosted_infra_gate.md`, `docker-compose.hosted.yml`, `desktop-app/hosted_entrypoint.py`, `tests/complex_audit/helpers/runtime_server.mjs`, `package.json` | Отдельный strict contour через `hosted_entrypoint.py` + Postgres/MinIO + hosted auth подтвержден recorded green run'ом `npm run smoke:complex-passage:hosted:infra` от `2026-04-20` (`60 passed`). |

### Минимальный smoke-набор для Complex Passage

Если времени мало, для этого workstream'а достаточно двух обязательных сигналов:

1. Прогнать `npm run smoke:complex-passage:hosted`.
2. Если нужен production-like proof, прогнать `npm run smoke:complex-passage:hosted:infra` на машине с Docker.
3. Отдельно помнить про residual risk: green `hosted` gate подтверждает реальный `hosted_web` boot path, но локально он все еще использует dev-auth bridge и `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1`, а не production-like Postgres/S3-backed entrypoint.

## Main + Quick Access

Для workstream'а `Main + Quick Access` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:main-quick-access:hosted
```

Подробный состав набора и его границы зафиксированы в `main_quick_access_hosted_gate.md`.

## Statistics + Progress

Для workstream'а `Statistics + Progress` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:statistics:hosted
```

Подробный состав набора и его границы зафиксированы в `statistics_progress_hosted_gate.md`.

## Calendar + Schedule + Memory Health

Для workstream'а `Calendar + Schedule + Memory Health` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:calendar:hosted
```

Подробный состав набора и его границы зафиксированы в `calendar_memory_health_hosted_gate.md`.

## Import/Export

Для workstream'а `Import/Export` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:import-export:hosted
```

Подробный состав набора и его границы зафиксированы в `import_export_hosted_gate.md`.

## Microcards

Для workstream'а `Microcards` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:microcards:hosted
```

Подробный состав набора и его границы зафиксированы в `microcards_hosted_gate.md`.

## Assets + Media

Для workstream'а `Assets + Media` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:assets-media:hosted
```

Подробный состав набора и его границы зафиксированы в `assets_media_hosted_gate.md`.

## Task Editor CRUD

Для workstream'а `Task Editor CRUD` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:task-editor:hosted
```

Подробный состав набора и его границы зафиксированы в `task_editor_hosted_gate.md`.

## Complex Editor CRUD

Для workstream'а `Complex Editor CRUD` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:complex-editor:hosted
```

Подробный состав набора и его границы зафиксированы в `complex_editor_hosted_gate.md`.

## Theory Editor + Theory Center

Для workstream'а `Theory Editor + Theory Center` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:theory-editor:hosted
```

Подробный состав набора и его границы зафиксированы в `theory_editor_hosted_gate.md`.

## Catalog + Library + Publication

Для workstream'а `Catalog + Library + Publication` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:catalog-library:hosted
```

Подробный состав набора и его границы зафиксированы в `catalog_library_hosted_gate.md`.

## Linked Theory / Open Flows

Для workstream'а `Linked Theory / Open Flows` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:linked-theory-open:hosted
```

Подробный состав набора и его границы зафиксированы в `linked_theory_open_hosted_gate.md`.

## AI Placeholder

Для workstream'а `AI Placeholder` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:ai-placeholder:hosted
```

Подробный состав набора и его границы зафиксированы в `ai_placeholder_hosted_gate.md`.

## Readiness + Degraded Signaling

Для workstream'а `readiness + degraded signaling` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:readiness:hosted
```

Этот набор подтверждает:

- `/api/ready` остаётся совместимым по raw `checks`, `persistence` и `degraded`;
- `/api/ready` больше не ограничивается service-level bool'ами и экспортирует `finish_line.subsystems`;
- каждая hosted-подсистема имеет отдельные `finish_line_status`, `runtime_status`, `runtime_ready`, `official_gate`, `source_of_truth`, `runtime_signals` и `degraded_signals`;
- remaining release blockers (`auth + email lifecycle`, `import/export`, `hosted infra + production launch`) остаются явно видимыми.

## Hosted Launch Contract

Для workstream'а `hosted infra + production launch` отдельным strict hosted сигналом теперь считается:

```bash
npm run smoke:launch-contract:hosted
```

Этот набор подтверждает:

- `/api/ready` экспортирует отдельный `launch_contract`;
- launch baseline явно проверяет stable `ACTRA_SECRET_KEY`, hosted storage mode, hosted persistence contract, auth base URL + SMTP env, secure cookie setup и выключенные dev/shadow fallback toggles;
- `hosted_infra_launch` в subsystem matrix использует тот же launch baseline и больше не путает реальный `hosted_split` runtime с non-hosted storage mode.

Что он не заменяет:

- `npm run smoke:complex-passage:hosted:infra`;
- реальный Docker/domain/SMTP acceptance run;
- reverse proxy / HTTPS / backup drill.

## Hosted Launch Acceptance

Для workstream'а `hosted infra + production launch` production-like acceptance run теперь считается таким:

```bash
npm run smoke:launch-acceptance:hosted
```

Этот набор подтверждает:

- launch env contract валиден ещё до старта Docker stack;
- companion contour `npm run smoke:complex-passage:hosted:infra` проходит рядом как часть launch story;
- live `docker-compose.hosted.yml` stack поднимается и экспортирует `green` `launch_contract` через `/api/ready`;
- hosted auth lifecycle проходит на живом stack без dev bridge: `register -> verify -> me -> logout -> login -> forgot-password request -> /ui/main`.

Recorded local result от `2026-04-20`:

- `npm run smoke:launch-acceptance:hosted` завершился зелёно;
- companion contour `npm run smoke:complex-passage:hosted:infra` прошёл с recorded result `60 passed`;
- remaining tail после этого уже операционный: public domain/real SMTP/proxy/backup proof.

Для локального acceptance run stack теперь по умолчанию использует встроенный `Mailpit` SMTP sink, чтобы auth mail flow можно было проверить без внешнего SMTP.

Что он всё ещё не заменяет:

- ручную проверку реальной доставки писем verify/reset в inbox;
- финальный public-domain / reverse-proxy / HTTPS proof;
- backup / restore drill;
- широкий author/consumer browser smoke вокруг publish/add/open/editor save-open.

## Минимальный ручной smoke-набор

Если времени мало, руками обязательно пройти эти сценарии:

1. `AUTH-01`
2. `AUTH-02`
3. `AUTH-03`
4. `CAT-02`
5. `PUB-01`
6. `ADD-02`
7. `ADD-03`
8. `OPEN-02`
9. `OPEN-03`
10. `TC-01`
11. `ACC-01`
12. `FB-01`

## Что уже можно считать прикрытым автоматикой

Сильнее всего автоматикой уже прикрыты:
- publish/add/open flows для linked complex/theory;
- visibility transitions;
- author vs consumer theory-link resolution;
- theory center visibility;
- theory-library delete и safe cascade на complex delete;
- hosted auth baseline.

Главные неприкрытые зоны:
- multi-user ручной e2e smoke через реальные UI поверхности;
- fallback-поведение при недоступном Postgres;
- degraded/error behavior для blocked shadow writes;
- hardening-проверка read-only linked-library baseline в смешанных legacy данных.
- production-like hosted infra path для complex passage gate: текущий Playwright harness уже стартует в `hosted_web`, но локально делает это через dev-only bridge/fallback слой, а не через fully provisioned Postgres/S3 environment.

## Stage 7 baseline notes

Legacy surfaces, которые еще нужно держать в голове при smoke и migration design:
- `workspace_import` / `archive_import` объекты в workspace-данных;
- internal `workspace_import_routes` и `workspace_import_service`;
- UI-слои, которые все еще различают imported и linked content по `created_via`;
- filesystem shadow fallback при недоступном Postgres.
- explicit degraded policy для shadow writes и internal-only policy для `workspace_import`.

Что эта матрица больше не предполагает:
- user-facing `fork from library`;
- editable copy как стандартный результат `Add to Library`.

## Следующий шаг после этой матрицы

Не расширять список бесконечно, а использовать матрицу как baseline для Stage 7:
- сначала зафиксировать `pass/fail/blocked` по ручному smoke;
- затем подтвердить degraded smoke и internal-bridge policy;
- потом идти уже только в `hosted infra + launch` как в последний remaining contour этого плана.
