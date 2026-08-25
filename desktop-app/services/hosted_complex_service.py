from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List

from persistence.hosted_complex_repository import HostedComplexRepository
from persistence.postgres import PostgresUnavailableError
from persistence.runtime import PersistenceRuntimeSettings
from services.complex_service import ComplexService, ConflictError, _normalize_complex_ownership_fields
from services.hosted_shadow_fallback import HostedShadowFallbackMixin
from task_system.core.exceptions import TaskValidationError
from task_system.core.models.complex_models import Complex
from task_system.core.schemas.complex_schema import ComplexSchema


class HostedComplexService(HostedShadowFallbackMixin, ComplexService):
    """Hosted complex service with Postgres source of truth."""

    def __init__(self, data_dir: str, persistence_settings: PersistenceRuntimeSettings):
        super().__init__(data_dir=data_dir)
        self.persistence_settings = persistence_settings
        self.repository = HostedComplexRepository(self.persistence_settings.postgres_dsn)
        self._storage_ready = False
        self.logger = logging.getLogger(self.__class__.__name__)
        self._init_hosted_shadow_fallback_state()

    @property
    def hosted_storage_ready(self) -> bool:
        return bool(self._storage_ready)

    def ensure_persistence_ready(self) -> None:
        if self._storage_ready:
            return
        self.repository.ensure_schema()
        self._storage_ready = True
        self._initialized = False
        try:
            self._bootstrap_from_shadow_if_empty()
        except Exception as exc:
            self.logger.warning("[HOSTED] Failed to bootstrap complex shadow: %s", exc)

    def _bootstrap_from_shadow_if_empty(self) -> None:
        try:
            legacy_complexes = ComplexService.load_complexes(self)
            if not legacy_complexes:
                return
            self.logger.info("[HOSTED] Bootstrapping missing legacy complexes into Postgres")
            payloads = self._complex_payloads_from_models(legacy_complexes)
            for payload in payloads:
                self.repository.import_complex_if_absent(payload)
        except Exception as exc:
            self.logger.warning("[HOSTED] Failed to bootstrap legacy complexes: %s", exc)

    def _payload_to_complex(self, payload: Dict[str, Any]) -> Complex:
        normalized = _normalize_complex_ownership_fields(dict(payload), fallback_source="legacy_unknown")
        ComplexSchema.validate_or_raise(normalized)
        return Complex(**normalized)

    def _complex_payloads_from_models(self, complexes: List[Complex]) -> List[Dict[str, Any]]:
        payloads: List[Dict[str, Any]] = []
        for complex_obj in complexes:
            item = complex_obj.dict()
            if item.get("created_at") and hasattr(item["created_at"], "isoformat"):
                item["created_at"] = item["created_at"].isoformat()
            if item.get("updated_at") and hasattr(item["updated_at"], "isoformat"):
                item["updated_at"] = item["updated_at"].isoformat()
            payloads.append(item)
        return payloads

    def _serialize_snapshot_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(payload if isinstance(payload, dict) else {})
        for key in ("created_at", "updated_at"):
            value = normalized.get(key)
            if hasattr(value, "isoformat"):
                normalized[key] = value.isoformat()
        return normalized

    def load_complexes(self) -> List[Complex]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("complexes.load", exc)
            return ComplexService.load_complexes(self)
        self._complexes_cache = {}
        payloads = self.repository.list_complexes()
        loaded_complexes: List[Complex] = []
        for item in payloads:
            try:
                complex_obj = self._payload_to_complex(item)
            except Exception as exc:
                self.logger.warning("[HOSTED] Failed to load hosted complex %s: %s", item.get("id"), exc)
                continue
            self._complexes_cache[complex_obj.id] = complex_obj
            loaded_complexes.append(complex_obj)
        return loaded_complexes

    def _save_complex(self, complex_obj: Complex) -> None:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.write", exc)
            super()._save_all_complexes(list(self._complexes_cache.values()))
            return
        payloads = self._complex_payloads_from_models([complex_obj])
        if payloads:
            self.repository.upsert_complex(payloads[0])

    def create_complex(self, complex_data: Dict[str, Any]) -> Complex:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.write", exc)
            return super().create_complex(complex_data)

        self._ensure_initialized()
        normalized_data = _normalize_complex_ownership_fields(
            dict(complex_data),
            fallback_source="manual_editor",
        )
        ComplexSchema.validate_or_raise(normalized_data)

        complex_id = normalized_data["id"]
        if complex_id in self._complexes_cache:
            raise ValueError(f"Complex with ID '{complex_id}' already exists")

        now = datetime.utcnow()
        if "created_at" not in normalized_data or not normalized_data["created_at"]:
            normalized_data["created_at"] = now
        if "updated_at" not in normalized_data or not normalized_data["updated_at"]:
            normalized_data["updated_at"] = now

        new_complex = Complex(**normalized_data)
        self._complexes_cache[complex_id] = new_complex
        self._save_complex(new_complex)
        self.logger.info(f"[HOSTED] Created new complex: {complex_id}")
        return new_complex

    def _save_all_complexes(self, complexes: List[Complex]):
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.write", exc)
            return super()._save_all_complexes(complexes)
        for c in complexes:
            payloads = self._complex_payloads_from_models([c])
            if payloads:
                self.repository.upsert_complex(payloads[0])

    def _save_history_snapshot(
        self,
        complex_id: str,
        complex_data: Dict[str, Any],
        *,
        snapshot_kind: str = "manual",
        snapshot_label: str | None = None,
        max_versions: int = 20,
    ) -> str:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.history.write", exc)
            return super()._save_history_snapshot(
                complex_id,
                complex_data,
                snapshot_kind=snapshot_kind,
                snapshot_label=snapshot_label,
                max_versions=max_versions,
            )

        timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        while self.repository.get_history_snapshot(complex_id, timestamp) is not None:
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
        saved_at = datetime.utcnow().isoformat()
        snapshot_data = self._serialize_snapshot_payload(complex_data)
        snapshot_data["_history_kind"] = str(snapshot_kind or "manual").strip() or "manual"
        snapshot_data["_history_saved_at"] = saved_at
        if snapshot_label:
            snapshot_data["_history_label"] = str(snapshot_label).strip()

        self.repository.upsert_history_snapshot(
            complex_id,
            timestamp,
            snapshot_data,
            updated_at=saved_at,
            history_kind=snapshot_data["_history_kind"],
        )

        history_items = self.repository.list_history(complex_id)
        if len(history_items) > max_versions:
            for stale in history_items[max_versions:]:
                stale_timestamp = str(stale.get("_snapshot_timestamp") or "").strip()
                if stale_timestamp:
                    self.repository.delete_history_snapshot(complex_id, stale_timestamp)
        return timestamp

    def update_complex(
        self,
        complex_id: str,
        updates: Dict[str, Any],
        expected_version: str | None = None,
    ) -> Complex:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.write", exc)
            return super().update_complex(complex_id, updates, expected_version=expected_version)

        self._ensure_initialized()
        if complex_id not in self._complexes_cache:
            db_payload = self.repository.get_complex(complex_id)
            if db_payload:
                try:
                    c_obj = self._payload_to_complex(db_payload)
                    self._complexes_cache[c_obj.id] = c_obj
                except Exception:
                    pass
        if complex_id not in self._complexes_cache:
            raise ValueError(f"Complex with ID '{complex_id}' not found")

        current_complex = self._complexes_cache[complex_id]

        if expected_version is not None:
            current_version = (
                current_complex.updated_at.isoformat() if current_complex.updated_at else None
            )
            if current_version != expected_version:
                raise ConflictError(
                    "Complex has been modified by another user",
                    current_version=current_version,
                    expected_version=expected_version,
                )

        current_data = current_complex.dict()
        self._save_history_snapshot(complex_id, current_data, snapshot_kind="manual")

        current_data.update(updates)
        current_data["updated_at"] = datetime.utcnow()
        current_data = _normalize_complex_ownership_fields(
            current_data,
            fallback_source="manual_editor",
            existing=current_complex.dict(),
        )

        try:
            updated_complex = Complex(**current_data)
        except Exception as e:
            raise TaskValidationError(f"Invalid update data: {e}")

        self._complexes_cache[complex_id] = updated_complex
        self._save_complex(updated_complex)
        self.logger.info(f"[HOSTED] Updated complex: {complex_id}")
        return updated_complex

    def delete_complex(self, complex_id: str) -> bool:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.write", exc)
            return super().delete_complex(complex_id)

        self._ensure_initialized()
        self._complexes_cache.pop(complex_id, None)
        deleted = self.repository.delete_complex(complex_id)
        if deleted:
            self.repository.delete_history(complex_id)
        self.logger.info(f"[HOSTED] Deleted complex: {complex_id}, deleted_db={deleted}")
        return deleted

    def save_autosave_snapshot(self, complex_id: str, snapshot_payload: Dict[str, Any]) -> Dict[str, Any]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.autosave.write", exc)
            return ComplexService.save_autosave_snapshot(self, complex_id, snapshot_payload)
        return ComplexService.save_autosave_snapshot(self, complex_id, snapshot_payload)

    def get_latest_autosave_snapshot(self, complex_id: str) -> Dict[str, Any] | None:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("complexes.autosave.read", exc)
            return ComplexService.get_latest_autosave_snapshot(self, complex_id)
        snapshots = self.repository.list_history(complex_id, history_kind="autosave")
        return snapshots[0] if snapshots else None

    def delete_autosave_snapshots(self, complex_id: str) -> int:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.autosave.delete", exc)
            return ComplexService.delete_autosave_snapshots(self, complex_id)
        return self.repository.delete_autosave_snapshots(complex_id)

    def get_complex_history(self, complex_id: str) -> List[Dict[str, Any]]:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_read_fallback("complexes.history.read", exc)
            return ComplexService.get_complex_history(self, complex_id)
        return self.repository.list_history(complex_id)

    def restore_from_history(self, complex_id: str, snapshot_timestamp: str) -> Complex:
        try:
            self.ensure_persistence_ready()
        except PostgresUnavailableError as exc:
            self._guard_shadow_write_fallback("complexes.history.restore", exc)
            return ComplexService.restore_from_history(self, complex_id, snapshot_timestamp)

        self._ensure_initialized()
        snapshot = self.repository.get_history_snapshot(complex_id, snapshot_timestamp)
        if snapshot is None:
            raise ValueError(f"Snapshot not found: {snapshot_timestamp}")

        snapshot_data = dict(snapshot)
        snapshot_data["updated_at"] = datetime.utcnow()
        snapshot_data.pop("_snapshot_timestamp", None)
        snapshot_data.pop("_history_kind", None)
        snapshot_data.pop("_history_label", None)
        snapshot_data.pop("_history_saved_at", None)

        current_complex = self.get_complex(complex_id)
        if current_complex:
            self._save_history_snapshot(complex_id, current_complex.dict(), snapshot_kind="manual")
            snapshot_data = _normalize_complex_ownership_fields(
                snapshot_data,
                fallback_source="legacy_unknown",
                existing=current_complex.dict(),
            )
        else:
            snapshot_data = _normalize_complex_ownership_fields(
                snapshot_data,
                fallback_source="legacy_unknown",
            )

        restored_complex = Complex(**snapshot_data)
        self._complexes_cache[complex_id] = restored_complex
        self._save_all_complexes(list(self._complexes_cache.values()))
        return restored_complex
