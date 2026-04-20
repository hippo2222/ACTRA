# Readiness + Degraded Hosted Gate

Дата фиксации: `2026-04-19`

## Официальный запуск

```bash
npm run smoke:readiness:hosted
```

## Expected Result

- команда завершается зелёно;
- `/api/ready` остаётся совместимым по старым полям `checks`, `persistence`, `degraded`;
- `/api/ready` дополнительно экспортирует `finish_line.subsystems`, где каждая значимая hosted-подсистема описана отдельно;
- для каждой подсистемы есть:
  - `finish_line_status`;
  - `runtime_status`;
  - `runtime_ready`;
  - `official_gate`;
  - `source_of_truth`;
  - `runtime_signals`;
  - `degraded_signals`.

## Что именно покрывает gate

- readiness endpoint больше не сводит состояние hosted-продукта к одному общему `ok/degraded`;
- `auth + email lifecycle` честно остаётся `transitional` в finish-line слое, пока не закреплены production `ACTRA_AUTH_*` и отдельный hosted gate;
- `main`, `statistics`, `calendar`, editor contours, `assets/media`, `AI placeholder`, `microcards` и другие уже доведённые поверхности отображаются как отдельные subsystem entries с официальными gate-командами;
- `import/export` и `hosted infra + production launch` остаются явно видимыми `transitional` release-blockers;
- blocked shadow fallback policy продолжает экспортироваться отдельно и не теряется за новым subsystem-слоем.

## Почему это release-blocking

Этот gate закрепляет ровно то, что требовалось в finish-line плане:

- readiness surfaces отражают hosted-подсистемы по отдельности;
- release-blocking remaining contours больше нельзя скрыть за общим `200 ok`;
- у релизного и production-like smoke появляется один канонический источник правды о состоянии hosted-контуров.
