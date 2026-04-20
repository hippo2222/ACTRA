# Stage 5 Exit Check

Дата: `2026-04-16`

## Решение

`Stage 5` можно считать `done`.

## Критерий выхода

Критерий `Stage 5` из [implementation_stages.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/implementation_stages.md):

- опубликованный комплекс или теория находятся в каталоге, добавляются в библиотеку как linked entry, открываются через source publication и не требуют создания личной копии по умолчанию.

## Почему критерий выполнен

1. Publish backend уже живой.
- В коде уже есть publish routes для `complex` и `theory`.
- Базовая publish-модель уже живет на `CatalogItem` и immutable `CatalogVersion`.

2. Linked-library contract уже живой.
- Есть catalog add-to-library routes.
- Есть `complex-library` и `theory-library` list/detail/access-code/delete contract.
- В service layer уже живут `resolved_version_id`, optional `pinned_version_id` и access states:
  - `active`
  - `requires_access_code`
  - `revoked`
  - `deleted_source`

3. Семантика `Add to Library` уже read-only linked, а не copy-by-default.
- Библиотека создает или переиспользует linked entry.
- Открытие идет через source publication.
- Текущий hosted baseline явно не создает editable personal copy как побочный эффект library add.

4. Access/visibility semantics уже встроены в backend, а не оставлены только на UI-уровне.
- Есть `public / access_code / private`.
- Visibility change влияет и на уже существующие linked entries у non-owner пользователей.
- Есть access-code resolve и access-state transitions для library entries.

## На что опирается решение

- [current_state.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/current_state.md)
- [progress.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/progress.md)
- [implementation_memory.md](D:/Ai Ai/radioproject_git/docs/hosted_web_migration/implementation_memory.md)

Автотесты, которые уже подтверждают Stage 5 baseline:
- [test_catalog_complex_linked_library.py](D:/Ai Ai/radioproject_git/tests/test_catalog_complex_linked_library.py)
- [test_catalog_theory_linked_library.py](D:/Ai Ai/radioproject_git/tests/test_catalog_theory_linked_library.py)
- [test_session_api_linked_complex.py](D:/Ai Ai/radioproject_git/tests/test_session_api_linked_complex.py)

## Что не является blocker-ом для Stage 5

Это важно, чтобы не смешивать следующий долг с критерием выхода этапа:

- user-facing `fork from library` не нужен для текущего Stage 5 exit, потому что он исключен из active hosted roadmap;
- UI polish и surface consistency относятся уже к `Stage 6`;
- shadow/fallback cleanup и migration debt относятся уже к `Stage 7`.

## Что остается после закрытия

После признания `Stage 5` завершенным остаются уже не backend-foundation blockers этого этапа, а follow-up темы:

1. `Stage 6` UI/UX alignment.
2. `Stage 7` degraded/fallback hardening.
3. final smoke и handoff.
