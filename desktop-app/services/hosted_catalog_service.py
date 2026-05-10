from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from persistence.hosted_catalog_repository import HostedCatalogRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV, PersistenceRuntimeSettings
from services.catalog_service import CatalogService
from services.hosted_shadow_fallback import (
    HostedShadowFallbackMixin,
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)


class HostedCatalogService(HostedShadowFallbackMixin, CatalogService):
    """Hosted catalog service with repository-backed source of truth."""

    def __init__(
        self,
        *,
        data_dir: str,
        complex_service: Any,
        theory_service: Any,
        storage_service: Any,
        persistence_settings: PersistenceRuntimeSettings,
    ) -> None:
        super().__init__(
            data_dir=data_dir,
            complex_service=complex_service,
            theory_service=theory_service,
            storage_service=storage_service,
        )
        self.persistence_settings = persistence_settings
        self.repository = HostedCatalogRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def _guard_shadow_read_fallback(self, operation: str, exc: Exception) -> None:
        self._shadow_fallback_active = True
        self._shadow_read_fallback_blocked = True
        self.logger.error(
            "[HOSTED][DEGRADED] Blocked legacy catalog shadow read for %s because Postgres is unavailable: %s",
            operation,
            exc,
        )
        raise HostedShadowReadFallbackDisabledError(operation, reason=str(exc))

    def _guard_shadow_write_fallback(self, operation: str, exc: Exception) -> None:
        self._shadow_fallback_active = True
        if self.hosted_shadow_write_fallback_enabled:
            self.logger.warning(
                "[HOSTED][DEV-FALLBACK] %s is using legacy catalog shadow write because Postgres is unavailable: %s",
                operation,
                exc,
            )
            return
        self._shadow_write_fallback_blocked = True

        self.logger.error(
            "[HOSTED][DEGRADED] Blocked legacy catalog shadow write for %s because Postgres is unavailable and %s is not enabled: %s",
            operation,
            HOSTED_SHADOW_WRITE_FALLBACK_ENV,
            exc,
        )
        raise HostedShadowWriteFallbackDisabledError(operation, reason=str(exc))

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.repository.ensure_schema()
        self._storage_ready = True

    def _list_item_payloads(self) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.list_items()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_list_item_payloads", exc)

    def _get_item_payload(self, item_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_item(item_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_item_payload", exc)

    def _get_item_by_source_workspace_key(self, source_workspace_key: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_item_by_source_workspace_key(source_workspace_key)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_item_by_source_workspace_key", exc)

    def _get_item_by_access_code(self, access_code: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_item_by_access_code(access_code)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_item_by_access_code", exc)

    def _list_version_payloads(self, item_id: str) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.list_versions(item_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_list_version_payloads", exc)

    def _get_version_payload(self, item_id: str, version_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_version(item_id, version_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_version_payload", exc)

    def _persist_publish_records(self, item_payload: Dict[str, Any], version_payload: Dict[str, Any]) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.upsert_item(item_payload)
            self.repository.insert_version(version_payload)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_persist_publish_records", exc)
            CatalogService._persist_publish_records(self, item_payload, version_payload)

    def _upsert_item_payload(self, item_payload: Dict[str, Any]) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.upsert_item(item_payload)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_upsert_item_payload", exc)
            CatalogService._upsert_item_payload(self, item_payload)

    def _list_theory_library_entry_payloads_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.list_theory_library_entries(user_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_list_theory_library_entry_payloads_for_user", exc)

    def _get_theory_library_entry_payload(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_theory_library_entry(library_entry_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_theory_library_entry_payload", exc)

    def _get_theory_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_theory_library_entry_by_user_item(user_id, catalog_item_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_theory_library_entry_by_user_item", exc)

    def _upsert_theory_library_entry_payload(self, entry_payload: Dict[str, Any]) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.upsert_theory_library_entry(entry_payload)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_upsert_theory_library_entry_payload", exc)
            CatalogService._upsert_theory_library_entry_payload(self, entry_payload)

    def _list_complex_library_entry_payloads_for_user(self, user_id: str) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.list_complex_library_entries(user_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_list_complex_library_entry_payloads_for_user", exc)

    def _get_complex_library_entry_payload(self, library_entry_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_complex_library_entry(library_entry_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_complex_library_entry_payload", exc)

    def _get_complex_library_entry_by_user_item(self, user_id: str, catalog_item_id: str) -> Optional[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.get_complex_library_entry_by_user_item(user_id, catalog_item_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_get_complex_library_entry_by_user_item", exc)

    def _list_complex_library_entry_payloads_for_item(self, catalog_item_id: Optional[str]) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
            return self.repository.list_complex_library_entries_for_item(str(catalog_item_id or "").strip())
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("_list_complex_library_entry_payloads_for_item", exc)

    def _upsert_complex_library_entry_payload(self, entry_payload: Dict[str, Any]) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.upsert_complex_library_entry(entry_payload)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_upsert_complex_library_entry_payload", exc)
            CatalogService._upsert_complex_library_entry_payload(self, entry_payload)

    def _delete_theory_library_entry_payload(self, library_entry_id: str) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.delete_theory_library_entry(library_entry_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_delete_theory_library_entry_payload", exc)
            CatalogService._delete_theory_library_entry_payload(self, library_entry_id)

    def _delete_complex_library_entry_payload(self, library_entry_id: str) -> None:
        try:
            self.ensure_persistence_ready()
            self.repository.delete_complex_library_entry(library_entry_id)
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("_delete_complex_library_entry_payload", exc)
            CatalogService._delete_complex_library_entry_payload(self, library_entry_id)
