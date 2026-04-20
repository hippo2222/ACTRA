# Assets + Media Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует официальный strict hosted gate для surface `assets + media payloads`.

## Strict Hosted Gate

```bash
npm run smoke:assets-media:hosted
```

## Ожидаемый результат

- команда завершается с `exit code 0`;
- `pytest` и `vitest` проходят без failed/error;
- набор подтверждает canonical hosted media contract на backend, runtime и core editor surfaces, а не path-first legacy behavior.

## Состав Gate

- `tests/test_session_api_metadata.py`
- `tests/sequenceui_render_stability.test.mjs`
- `tests/testui_question_image_lightbox.test.mjs`
- `tests/clickui_runtime_panel.test.mjs`
- `tests/drawui_metadata_sync.test.mjs`
- `tests/open_answer_ui_restore_input.test.mjs`
- `tests/task_metadata_panel.normalize_additional_info.test.mjs`
- `tests/task_renderer_ui_state.test.mjs`
- `tests/click_editor_asset_refs.test.mjs`
- `tests/draw_editor_semantic_warnings.test.mjs`
- `tests/open_answer_editor.test.mjs`
- `tests/test_editor_url_context.test.mjs`

## Что именно подтверждает strict gate

- hosted `SessionAPI` не продвигает path-only task/question/answer refs как нормальный media contract inside current-task payloads;
- runtime UIs `SequenceUI`, `TestUI`, `ClickUI`, `DrawUI`, `OpenAnswerUI` and shared `S1` task renderer выбирают `asset_url` / `asset_id` раньше legacy `image_path`;
- core editors `click`, `draw`, `open answer` и `test editor` сохраняют nested hosted `asset_id` / `asset_url` refs и используют `path` только как compatibility bridge;
- mixed payloads с asset refs больше не downgrade'ятся обратно в path-first preview/source resolution;
- hosted media contour проверяется одной канонической командой и больше не держится на разрозненных ad-hoc regressions.

## Что не входит в этот gate

- production-like infra verification с реальным Postgres/S3 stack;
- более широкий browser smoke вокруг upload UI и cross-surface reopen flows;
- соседние contours `theory editor`, `import/export` и launch-layer beyond the core media contract.

## Текущий статус

С `2026-04-19` `npm run smoke:assets-media:hosted` считается официальным strict hosted gate
для surface `assets + media payloads`.

Локальная верификация strict gate зафиксирована прогоном `npm run smoke:assets-media:hosted`
от `2026-04-19`.

На текущий момент это означает:

- у `assets + media payloads` есть один канонический запуск для release-check;
- hosted truth по runtime/editor media refs проверяется повторяемо одной командой;
- legacy `path` остаётся только как compatibility bridge и больше не считается продуктовым source of truth в hosted runtime.
