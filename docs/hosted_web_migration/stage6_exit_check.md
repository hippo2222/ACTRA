# Stage 6 Exit Check

Дата: `2026-04-16`

## Решение

`Stage 6` можно считать `done` по текущей read-only hosted-модели.

Это решение сознательно опирается на текущий product direction:
- `Catalog/Library` в hosted web остаются read-only linked-publication surfaces;
- user-facing `fork from library` не входит в active roadmap;
- значит `Stage 6` закрывается не по наличию fork-CTA, а по тому, что UI не маскирует linked consumption под old copy semantics.

## Критерий выхода

Синхронизированный критерий `Stage 6`:

- пользовательский flow `publish -> find -> add to library -> open linked content` проходит полностью через UI, не маскируется под old copy semantics и не обещает editable copy там, где в текущем hosted roadmap ее нет.

## Почему критерий выполнен

1. `Catalog` уже является живой user-facing поверхностью.
- Есть list/detail flow.
- Работают visibility, access-code и library-status.
- Автор видит и свои `public/access_code/private` публикации.

2. `Комплексы` уже читаются как linked-library surface, а не как скрытый copy/import flow.
- Есть author-side publication management.
- Есть add-by-code.
- У non-owner скрыт `Редактировать`.
- Linked complex открывается как linked content, а не как materialized personal copy.
- Attached theory резолвится через current-user library entry или embedded fallback.

3. `Центр теории` уже выровнен под hosted visibility semantics.
- Не показывает чужие неимпортированные материалы.
- Показывает linked/imported provenance отдельно от authoring semantics.
- Позволяет удалить linked theory из personal library без воздействия на source publication.

4. `Редактор теории` уже участвует в author-side publication UX.
- Publish-management для теории живет не только в `Theory Center`, но и в `theory_editor.js`.
- Visibility contract для теории выровнен с комплексом.

5. Legacy/internal flows больше не протекают в основной hosted UX.
- `workspace_import` убран из user-facing hosted surfaces.
- `Dashboard` больше не открывает workspace-import preview из hosted surfaces.
- UI не обещает `Fork / Создать свою версию` как стандартный library сценарий.

## На что опирается решение

- [current_state.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/current_state.md)
- [progress.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/progress.md)
- [implementation_memory.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/implementation_memory.md)
- [smoke_matrix.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/smoke_matrix.md)

Покрытие и сигналы из тестов:
- [catalog_visibility_merge.test.mjs](D:/Ai Ai/radioproject_git/tests/catalog_visibility_merge.test.mjs)
- [complexes_add_by_code_helpers.test.mjs](D:/Ai Ai/radioproject_git/tests/complexes_add_by_code_helpers.test.mjs)
- [complexes_linked_theory_resolution.test.mjs](D:/Ai Ai/radioproject_git/tests/complexes_linked_theory_resolution.test.mjs)
- [theory_center_regressions.test.mjs](D:/Ai Ai/radioproject_git/tests/theory_center_regressions.test.mjs)
- [test_theory_center_visibility.py](D:/Ai Ai/radioproject_git/tests/test_theory_center_visibility.py)
- [editor_dashboard_workspace_import_history.test.mjs](D:/Ai Ai/radioproject_git/tests/editor_dashboard_workspace_import_history.test.mjs)

## Что не является blocker-ом для Stage 6

- отсутствие user-facing fork из library не блокирует Stage 6, потому что это больше не часть active hosted scope;
- full degraded/fallback hardening относится уже к `Stage 7`;
- migration utilities для legacy copies тоже относятся уже к `Stage 7`.

## Что остается после закрытия

После признания `Stage 6` завершенным остается уже не product-surface wiring, а hardening:

1. финальный degraded smoke;
2. remaining fallback/shadow debt;
3. final Stage 7 handoff.
