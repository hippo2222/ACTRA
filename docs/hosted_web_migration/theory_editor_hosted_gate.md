# Theory Editor Hosted Gate

Дата обновления: `2026-04-19`

Для contour `theory editor + theory center` официальный strict hosted gate теперь запускается одной командой:

```bash
npm run smoke:theory-editor:hosted
```

## Что подтверждает этот gate

- hosted `HostedTheoryService` использует repository-backed theory metadata/content/history как source of truth;
- hosted `theories` и `theory center` routes возвращают canonical degraded `503 hosted_shadow_*_blocked` вместо generic `500`, когда hosted read/write заблокированы;
- authoring contour проходит как единый hosted flow:
  - `create`;
  - `list/open`;
  - `update`;
  - `upload-image`;
  - `history`;
  - `restore`;
  - `theory center overview`;
  - `delete`;
- ownership visibility закреплена в gate: чужие theory items не протекают в editable list/get/overview;
- frontend regressions для `theory center` и hosted asset refs в `theory editor` остаются частью официальной проверки.

## Состав официального набора

```bash
pytest tests/test_hosted_theory_service.py tests/test_theory_editor_hosted_gate.py -q --cov-fail-under=0
npx vitest run tests/theory_center_regressions.test.mjs
npx vitest run tests/theory_editor_regressions.test.mjs -t "preserves hosted asset image refs through render and delta serialization"
```

## Expected Result

- все команды завершаются зелёно;
- theory CRUD/history/restore работают без shadow bootstrap из filesystem;
- blocked hosted reads/writes отдают canonical degraded payload;
- theory center остаётся visibility-aware hosted surface;
- asset-backed theory images сохраняют canonical hosted refs через render/save/reopen.

## Сознательные границы этого gate

- этот gate не пытается заменить широкий browser/product smoke вокруг всего theory authoring UX;
- полный `tests/theory_editor_regressions.test.mjs` сейчас содержит старый static-markup regression, не связанный с hosted source of truth;
- пока этот layout-regression не разобран отдельно, official hosted gate закрепляет только те theory scenarios, которые действительно подтверждают hosted truth и degraded contract.
