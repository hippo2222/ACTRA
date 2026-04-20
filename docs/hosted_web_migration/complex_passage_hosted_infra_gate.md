# Complex Passage Hosted Infra Gate

Дата обновления: `2026-04-18`

Этот документ фиксирует отдельный stricter contour для `Complex Passage`, который должен идти не через local dev fallback, а через `desktop-app/hosted_entrypoint.py` + реальный Postgres/MinIO stack.

## Команда

```bash
npm run smoke:complex-passage:hosted:infra
```

## Что делает contour

- поднимает isolated `docker compose` stack из `docker-compose.hosted.yml`;
- стартует приложение через `desktop-app/hosted_entrypoint.py`, а не через прямой `python desktop-app/server.py`;
- использует `ACTRA_HOSTED_PERSISTENCE_STRICT=1`;
- поднимает Postgres как session/statistics/catalog source of truth;
- поднимает MinIO + bucket init как production-like S3 substitute;
- не включает `ACTRA_HOSTED_DEV_AUTH_BRIDGE`;
- не включает `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK`;
- bootstrap'ит hosted auth user через `/api/auth/register`, а не через legacy profile routes.

## Что уже реализовано в harness

- `tests/complex_audit/helpers/runtime_server.mjs` умеет backend `docker_compose`;
- compose runtime получает стабильный `ACTRA_SECRET_KEY`, чтобы auth-cookie переживал `restart`;
- browser и node-side API используют одну и ту же hosted auth session;
- fixture asset-paths переводятся из host path в container-visible `/app/data/...`;
- `complex_wave1_smoke.test.mjs` не требует legacy shadow-file assertions в strict infra contour.

## Текущий factual статус

Статус: `Amber`

Причина:

- кодовый contour и команда запуска уже добавлены;
- но в текущей рабочей среде Docker недоступен, поэтому end-to-end прогон `npm run smoke:complex-passage:hosted:infra` здесь не был подтвержден реальным compose-run.

## Ожидаемый next verification

На машине с Docker нужно прогнать:

```bash
npm run smoke:complex-passage:hosted:infra
```

Если contour проходит, после этого можно:

- перевести статус infra gate в `Green`;
- зафиксировать фактический `passed` count и runtime notes в `smoke_matrix.md`, `current_state.md` и `progress.md`.
