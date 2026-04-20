# Catalog + Library + Publication Hosted Gate

Дата обновления: `2026-04-19`

Этот документ фиксирует один канонический strict hosted gate для контура `catalog + library + publication`.

## Официальный запуск

```bash
npm run smoke:catalog-library:hosted
```

Ожидаемый результат:

- все тесты зелёные;
- hosted catalog использует repository-backed source of truth;
- `catalog.json` больше не bootstrap'ит hosted read-path и не получает silent shadow-write после успешного hosted publish/library mutation;
- public hosted routes подтверждают `publish -> list -> detail/version -> add to library -> library status -> visibility/access-code transition`;
- blocked hosted read/write paths возвращают canonical degraded `503`, а не generic `500`.

## Что именно покрывает gate

- service-level hosted strictness для `HostedCatalogService`;
- отсутствие bootstrap из shadow `catalog.json` при пустом Postgres-backed storage;
- отсутствие silent shadow-write после hosted `publish`, `add/remove theory library entry` и `add/remove complex library entry`;
- route-level hosted contract для:
  - publish theory;
  - publish complex;
  - list public items;
  - open item detail и version;
  - add to library;
  - item/version library-status;
  - visibility switch на `access_code`;
  - access-code resolve;
  - canonical degraded behavior.

## Источники истины

- `HostedCatalogService`
- `HostedCatalogRepository`
- hosted complex/theory services как upstream content source

## Честные границы этого gate

- `GET /api/catalog/items/<item_id>/versions/<version_id>/library-status` пока остаётся preview/import-style surface и не является канонической linked-library access surface;
- broader `linked theory / open flows` остаётся отдельным соседним contour и проверяется отдельно;
- этот gate не заменяет более широкий browser/product smoke вокруг полного consumer UX каталога и библиотеки.

## Основные файлы

- `desktop-app/services/hosted_catalog_service.py`
- `desktop-app/persistence/hosted_catalog_repository.py`
- `tests/test_hosted_catalog_service.py`
- `tests/test_catalog_hosted_gate.py`
- `tests/test_catalog_theory_linked_library.py`
- `tests/test_catalog_complex_linked_library.py`
