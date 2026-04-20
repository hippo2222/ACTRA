# Complex Passage Hosted Gate

Дата обновления: `2026-04-18`

Этот документ фиксирует один явный automated gate для workstream'а "прохождение комплексов" в `hosted_web`.

## Команда

```bash
npm run smoke:complex-passage:hosted
```

Для stricter infra contour теперь есть отдельная команда:

```bash
npm run smoke:complex-passage:hosted:infra
```

Её состав и factual status зафиксированы в `complex_passage_hosted_infra_gate.md`.

Запуск идет через `playwright.complex-passage-hosted.config.js` и намеренно отличается от общего `complex_audit` прогона:

- `headless: true`, чтобы gate не зависел от headed UI-сессии и не выглядел "зависшим" на длинном прогоне;
- `workers: 1`, чтобы избежать лишнего шума от параллельного браузерного/fixture runtime и держать сценарии воспроизводимыми;
- в набор включены только contract-bearing complex passage тесты, а не snapshot/visual-аудит и не экспериментальные проверки.

## Состав Hosted Gate

- `complex_wave1_smoke.test.mjs`
- `complex_wave1_active_sessions.test.mjs`
- `complex_wave1_queue_pause_difficulty.test.mjs`
- `complex_wave1_queue_retry.test.mjs`
- `complex_wave1_reload.test.mjs`
- `complex_wave1_restart.test.mjs`
- `complex_wave1_flow_results.test.mjs`
- `complex_wave1_types.test.mjs`
- `complex_wave1_validation.test.mjs`
- `complex_wave1_propagation.test.mjs`
- `complex_wave2_types_levels.test.mjs`
- `complex_wave2_validation.test.mjs`
- `complex_wave2_adaptive.test.mjs`
- `complex_wave2_mechanics.test.mjs`
- `complex_wave2_main_entry.test.mjs`
- `complex_wave2_reload.test.mjs`
- `complex_wave2_flow_results.test.mjs`
- `complex_wave2_propagation.test.mjs`
- `complex_wave2_reentry_cancel.test.mjs`

## Что именно подтверждает gate

- старт нового комплекса из hosted web flow;
- обнаружение и resume paused session;
- pause/resume и restore с того же места;
- submit/check для основных типов заданий и уровней;
- retry / partial retry / queue semantics;
- переходы между S1, S2 и S3;
- iteration results и final results;
- propagation в статистику и календарь;
- reload/re-entry контракт;
- restart runtime между шагами без потери active session state.

## Известный residual risk

Текущий curated gate остается release-blocking и теперь уже поднимает реальный `hosted_web`, но его все равно важно трактовать честно:

- `tests/complex_audit/helpers/runtime_server.mjs` поднимает `desktop-app/server.py` напрямую c явным `ACTRA_RUNTIME_MODE=hosted_web`;
- helper дополнительно включает `ACTRA_HOSTED_DEV_AUTH_BRIDGE=1` и `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1`, чтобы локальный smoke мог пройти без production Postgres/S3;
- readiness проверяется через `/api/health` c явной валидацией `runtime_mode`, поэтому boot-path ambiguity больше нет.

Практический смысл:

- зеленый `npm run smoke:complex-passage:hosted` теперь подтверждает реальный hosted runtime contract, а не только hosted-compatible contour;
- но это все еще локальный hosted/dev contour, а не окончательное доказательство fully provisioned production-like entrypoint через реальный Postgres/S3 stack.

## Что не входит в этот gate

- `complex_ui_*` snapshot-тесты;
- широкий exploratory-прогон всего `tests/complex_audit`;
- отдельный cleanup legacy/mojibake поверхностей вне complex passage;
- ручной multi-user smoke.

Полный `tests/complex_audit` по-прежнему полезен как широкий аудит, но релизным blocking-набором для complex passage считается именно этот curated hosted gate.
