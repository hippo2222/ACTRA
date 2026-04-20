# Hosted Web Migration

## Complex Passage

Для workstream'а "прохождение комплексов" отдельные source-of-truth документы теперь живут рядом с общим migration-пакетом:

- `complex_passage_spec.md` — canonical contract по lifecycle, `ui_state`, `resume_target`, task/iteration/retry/skip semantics
- `complex_passage_definition_of_done.md` — practical checklist и release gate для complex passage
- `complex_passage_hosted_gate.md` — явный automated hosted gate и curated Playwright-набор для release-check
- `complex_passage_hosted_infra_gate.md` — stricter infra contour через `hosted_entrypoint.py` + Postgres/MinIO без dev bridge и shadow-write fallback
- `main_quick_access_hosted_gate.md` — официальный strict hosted gate для `main + quick access`
- `statistics_progress_hosted_gate.md` — официальный strict hosted gate для `statistics + progress`
- `calendar_memory_health_hosted_gate.md` — официальный strict hosted gate для `calendar + schedule + memory health`
- `assets_media_hosted_gate.md` — официальный strict hosted gate для `assets + media payloads`
- `task_editor_hosted_gate.md` — официальный strict hosted gate для `task editor CRUD`
- `complex_editor_hosted_gate.md` — официальный strict hosted gate для `complex editor CRUD`
- `theory_editor_hosted_gate.md` — официальный strict hosted gate для `theory editor + theory center`
- `catalog_library_hosted_gate.md` — официальный strict hosted gate для `catalog + library + publication`
- `linked_theory_open_hosted_gate.md` — официальный strict hosted gate для `linked theory / open flows`
- `ai_placeholder_hosted_gate.md` — официальный strict hosted gate для explicit AI placeholder contract
- `import_export_hosted_gate.md` — официальный strict hosted gate для text/task/complex import-export contour
- `microcards_hosted_gate.md` — официальный strict hosted gate для hosted microcards contour
- `readiness_degraded_hosted_gate.md` — официальный strict hosted gate для `/api/ready` и explicit degraded signaling
- `hosted_launch_contract_gate.md` — официальный strict hosted gate для production env/cookie/storage launch contract
- `hosted_launch_acceptance.md` — production-like acceptance run для launch-layer через Docker stack + live hosted auth lifecycle
- `hosted_launch_ops_checklist.md` — финальный operations-checklist для перевода `hosted infra + production launch` из `transitional` в `green`

С `2026-04-20` readiness-слой для этого workstream'а считается отдельной точкой входа:

- `smoke_matrix.md` теперь включает не только catalog/library, но и отдельный раздел `Complex Passage`;
- `current_state.md` и `progress.md` фиксируют статусы по подпотокам complex passage, а не только общий факт “phase 6 green”;
- boot-path nuance по Playwright harness теперь снят на уровне `runtime_mode`, а оставшийся residual risk честно описан как local hosted/dev fallback contour;
- parallel к этому отдельный `hosted:infra` contour через `hosted_entrypoint.py` и `docker-compose.hosted.yml` уже имеет recorded green run на Docker-enabled среде, а `launch-acceptance:hosted` тоже подтверждён локально; remaining tail теперь сузился до public domain/real SMTP/proxy/backup proof.

Эта папка хранит рабочую документацию по переводу проекта в публичный web-режим с каталогом контента и пользовательскими библиотеками, которые по умолчанию строятся на linked-publication модели, а не на личных копиях.

Актуальная точка входа по состоянию на `2026-04-20`:
- `hosted_finish_line_matrix.md` — каноническая cross-product матрица `green/transitional/blocked` для финального hosted finish-line уровня `Product + Launch`;
- `current_state.md` — фактический срез того, что уже работает, что ещё transitional и что делать дальше;
- `smoke_matrix.md` — короткая QA-матрица по текущим hosted surfaces, включая catalog/library gate и readiness-раздел для `Complex Passage`;
- `qa_runbook.md` — пошаговый ручной прогон-лист для smoke QA;
- `progress.md` — краткий статус этапов и текущий фокус;
- `complex_passage_hosted_gate.md` — release-blocking automated gate для complex passage;
- `complex_passage_hosted_infra_gate.md` — отдельный stricter infra gate для проверки production-like hosted boot path;
- `main_quick_access_hosted_gate.md` — канонический strict gate для hosted `main + quick access`;
- `statistics_progress_hosted_gate.md` — канонический strict gate для hosted `statistics + progress`;
- `calendar_memory_health_hosted_gate.md` — канонический strict gate для hosted `calendar + schedule + memory health`;
- `assets_media_hosted_gate.md` — канонический strict gate для hosted `assets + media payloads`;
- `task_editor_hosted_gate.md` — канонический strict gate для hosted `task editor CRUD`;
- `complex_editor_hosted_gate.md` — канонический strict gate для hosted `complex editor CRUD`;
- `theory_editor_hosted_gate.md` — канонический strict gate для hosted `theory editor + theory center`;
- `catalog_library_hosted_gate.md` — канонический strict gate для hosted `catalog + library + publication`;
- `linked_theory_open_hosted_gate.md` — канонический strict gate для hosted `linked theory / open flows`;
- `ai_placeholder_hosted_gate.md` — канонический strict gate для hosted AI placeholder contour;
- `import_export_hosted_gate.md` — один канонический pytest gate для hosted import/export contract;
- `microcards_hosted_gate.md` — канонический strict gate для hosted microcards runtime contract;
- `readiness_degraded_hosted_gate.md` — канонический strict gate для hosted readiness/degraded subsystem matrix;
- `hosted_launch_contract_gate.md` — канонический strict gate для launch env/storage/cookie baseline перед production-like infra acceptance run;
- `hosted_launch_acceptance.md` — канонический production-like acceptance run для hosted launch contour;
- `hosted_launch_ops_checklist.md` — канонический remaining ops tail после локально-зелёного launch acceptance;
- `implementation_memory.md` — зафиксированные принципы, которые нельзя тихо менять.

Цель папки:
- фиксировать неизменяемые принципы реализации;
- держать поэтапный план в виде, готовом к исполнению;
- вести короткий журнал прогресса и handoff между исполнителями;
- не допускать дрейфа решений при смене контекста или команды.

Состав папки:
- `implementation_memory.md` — зафиксированные принципы и решения, которые нельзя тихо менять по ходу работы;
- `implementation_stages.md` — разбивка реализации на этапы с целями, составом работ и критериями выхода;
- `current_state.md` — текущий операционный snapshot, включая подпотоки complex passage и их фактический readiness-статус;
- `hosted_finish_line_matrix.md` — единая матрица finish-line по всем hosted-поверхностям, включая product surfaces, editor contours, extras и launch-layer;
- `smoke_matrix.md` — рабочая smoke-матрица для hosted auth/catalog/library flows, официальных strict gates и отдельного complex passage gate;
- `qa_runbook.md` — конкретный порядок ручного QA-прогона по шагам;
- `stage0_audit.md` — результаты security/runtime аудита для Stage 0;
- `stage1_runtime_baseline.md` — что именно было сделано в hosted runtime baseline;
- `stage2_auth_foundation.md` — auth/request-context baseline для hosted runtime, включая hosted `Welcome` как login/register surface;
- `stage3_persistence_split.md` — первый зафиксированный срез hosted persistence split;
- `stage5_kickoff.md` — исторический kickoff-док после смены вектора на linked-library semantics; читать вместе с `current_state.md`;
- `stage5_linked_library_plan.md` — исторический planning-док для Stage 5; часть контрактов из него уже реализована, поэтому читать вместе с `current_state.md` и `progress.md`;
- `stage5_exit_check.md` — formal решение, почему Stage 5 считается закрытым;
- `stage6_exit_check.md` — formal решение, почему Stage 6 считается закрытым по текущей read-only hosted-модели;
- `stage7_handoff.md` — финальный handoff по Stage 7: что готово, что оставлено как compatibility layer и когда снова нужен migration apply tooling;
- `complex_passage_hosted_gate.md` — curated hosted Playwright gate для full complex passage flow;
- `step1_library_workspace_read_model_plan.md` — мини-план первого server-side шага после catalog foundation: как перевести web read-model с legacy-local listing на user-scoped library/workspace semantics;
- `step1_hosted_dev_auth_bridge.md` — временный dev-only мост для локальной hosted-разработки без полноценной auth session; не является целевой архитектурой и должен быть удалён после завершения transitional need;
- `catalog_screen_design_brief.md` — ТЗ для дизайнера на единый HTML-макет будущего экрана каталога;
- `catalog_mockup_audit.md` и `catalog_mockup_implementation_notes.md` — исторические материалы по первому catalog UI; читать вместе с `progress.md`, потому что часть copy-based допущений в них уже superseded;
- `progress.md` — оперативный трекер статуса, ближайшего шага и handoff-заметок.
- `stage7_exit_check.md` — решение по Stage 7 hardening: когда apply-migration path не нужен и что считается финальным operational debt.

Правила ведения:
- перед началом нового этапа обновлять `progress.md`;
- если меняется архитектурное решение, сначала обновлять `implementation_memory.md`, потом код;
- если меняется фактическое состояние маршрутов, UI и QA-рисков, обновлять `current_state.md` и `progress.md` в одном проходе;
- после завершения заметного куска работ писать в `progress.md`, что сделано, что осталось и какие риски открыты;
- не смешивать сюда случайные заметки, временные мысли и черновые идеи без статуса.

Стартовая точка:
- актуальный вектор теперь зафиксирован в `implementation_memory.md`;
- актуальный статус исполнения и операционная точка входа живут в `current_state.md` и `progress.md`;
- если старые stage-доки расходятся с `implementation_memory.md`, `current_state.md` и `progress.md`, приоритет у последних.
