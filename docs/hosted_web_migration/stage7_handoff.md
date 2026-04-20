# Stage 7 Handoff

Дата: `2026-04-16`

## Что готово

- `Stage 5` и `Stage 6` закрыты по текущей read-only hosted-модели.
- Hosted catalog/library baseline работает как `publish -> find -> add -> open`.
- `complex library` и `theory library` живут как linked-publication surfaces, а не как editable personal copies.
- Visibility/access semantics уже доведены до рабочего состояния:
  - `active`
  - `requires_access_code`
  - `revoked`
  - `deleted_source`
- Добавлен симметричный `DELETE /api/theory-library/<library_entry_id>`.
- Удаление linked complex использует safe cascade для auto-added linked theory entries.
- `workspace_import` больше не является частью user-facing hosted UX и закрыт как internal bridge only.
- Hosted shadow writes blocked-by-default и больше не маскируются под нормальный write-path.
- Hosted catalog/library read-routes больше не обслуживаются из shadow и отдают явный `503 hosted_shadow_read_blocked`, если Postgres недоступен.
- Hosted write-routes отдают явный `503 hosted_shadow_write_blocked` вместо generic `500`.
- Финальный degraded smoke подтвержден `2026-04-16`:
  - `pytest tests/test_hosted_shadow_write_policy.py tests/test_workspace_import_bridge_http.py tests/test_hosted_auth_http.py tests/test_complexes_theory_link_fallback.py -q`
  - результат: `15 passed`

## Что остается compatibility layer

- Filesystem shadow при недоступном Postgres все еще остается совместимым read/degraded слоем, но уже не для `catalog/library` hosted reads.
- Shadow write fallback не удален физически, а только закрыт policy по умолчанию и включается явным ops/dev opt-in через `ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK=1`.
- `workspace_import_routes.py` и `workspace_import_service.py` остаются внутренним bridge-слоем для legacy/internal materialization сценариев.
- В UI еще видны только нейтральные следы legacy provenance:
- `created_via = workspace_import`
- `created_via = archive_import`
- user-facing `preview/execute` actions для legacy import из hosted surfaces уже сняты; остались только defensive no-op guards.
- Legacy imported copies и linked entries все еще сосуществуют в одном дереве данных и read-model helpers.
- Для части edge-cases остаются compatibility fallbacks на stale snapshots и missing library entries.

## Главный operational debt

- Основной риск уже не в publish/catalog contract и не в linked-library semantics.
- Основной риск теперь в том, что degraded/fallback codepaths все еще существуют рядом с целевой hosted-моделью.
- Самый чувствительный класс риска:
  - окружение без Postgres;
  - старые filesystem-shadow данные;
  - legacy imported-copy lineage, если оно появится в реальной среде, отличной от текущего repo baseline.

## Когда снова нужен migration apply tooling

Возвращаемся к targeted apply utility только при явном сигнале, что dry-run inventory больше не пустой.

Триггеры:
- новый прогон `python scripts/hosted_stage7_inventory.py --json-out reports/hosted_stage7_inventory.json` показывает `legacy_record_count > 0`;
- в bucket'ах появляются записи `safe_read_only_candidate`, `keep_legacy_draft` или `needs_manual_review`;
- появляется реальная среда, где legacy imported-copy объекты присутствуют в данных, а не только в codepaths;
- возникает операционная необходимость массово перевести read-only legacy copies в linked entries без ручного разбора.

Что делать в этом случае:
1. Сначала сохранить новый dry-run отчет.
2. Разобрать bucket-раскладку.
3. Только потом проектировать targeted apply utility под конкретный набор данных.
4. Не трогать автоматически edited user drafts.

## Что считается правильной точкой входа после Stage 7

- Для текущего состояния правду смотреть в:
  - `current_state.md`
  - `progress.md`
  - `stage7_exit_check.md`
- Для проверки, не открылся ли migration-workstream заново:
  - `reports/hosted_stage7_inventory.json`
  - `scripts/hosted_stage7_inventory.py`
- Для operational/degraded поведения:
  - `tests/test_hosted_shadow_write_policy.py`
  - `tests/test_workspace_import_bridge_http.py`
  - `tests/test_hosted_auth_http.py`
  - `tests/test_complexes_theory_link_fallback.py`

## Итог

`Stage 7` считается закрытым как release-readiness baseline для текущего repo state на `2026-04-16`.

Это не означает, что legacy debt исчез физически. Это означает, что:
- целевая hosted-модель уже стабилизирована;
- transitional compatibility layers уже сужены и задокументированы;
- отдельный migration apply path не нужен, пока inventory остается `0`;
- при non-zero inventory открывается отдельный targeted migration workstream, а не тихое продолжение Stage 7 "по инерции".
