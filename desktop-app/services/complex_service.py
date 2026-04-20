# desktop-app/services/complex_service.py
"""
Complex Service - Сервис для управления комплексами заданий.

Отвечает за:
- CRUD операции для комплексов (создание, чтение, обновление, удаление)
- Загрузку и сохранение комплексов в JSON
- Валидацию комплексов
"""

import json
import logging
import os
from pathlib import Path
from typing import List, Dict, Optional, Any
from datetime import datetime
from uuid import uuid4

from werkzeug.utils import secure_filename

from task_system.core.schemas.complex_schema import ComplexSchema
from task_system.core.models.complex_models import Complex
from task_system.core.exceptions import TaskValidationError
from services.workspace_lineage import (
    build_source_lineage_key,
    find_first_by_source_lineage,
    normalize_workspace_lineage_fields,
)

logger = logging.getLogger(__name__)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_complex_ownership_fields(
    payload: Dict[str, Any],
    *,
    fallback_source: str = "legacy_unknown",
    existing: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    existing_payload = existing if isinstance(existing, dict) else {}

    created_by_user_id = _normalize_optional_text(payload.get("created_by_user_id"))
    if created_by_user_id is None:
        created_by_user_id = _normalize_optional_text(existing_payload.get("created_by_user_id"))

    updated_by_user_id = _normalize_optional_text(payload.get("updated_by_user_id"))
    if updated_by_user_id is None:
        updated_by_user_id = _normalize_optional_text(existing_payload.get("updated_by_user_id"))
    if updated_by_user_id is None:
        updated_by_user_id = created_by_user_id

    created_via = _normalize_optional_text(payload.get("created_via"))
    if created_via is None:
        created_via = _normalize_optional_text(existing_payload.get("created_via"))
    if created_via is None:
        created_via = fallback_source

    content_scope = _normalize_optional_text(payload.get("content_scope"))
    if content_scope is None:
        content_scope = _normalize_optional_text(existing_payload.get("content_scope"))
    if content_scope is None:
        content_scope = "shared_local"

    payload["created_by_user_id"] = created_by_user_id
    payload["updated_by_user_id"] = updated_by_user_id
    payload["created_via"] = created_via
    payload["content_scope"] = content_scope
    return normalize_workspace_lineage_fields(
        payload,
        entity_kind="complex",
        entity_id=payload.get("id"),
        entity_ref=payload.get("id"),
        existing=existing_payload,
    )


class ConflictError(Exception):
    """Raised when version conflict detected during update"""

    def __init__(self, message: str, current_version: str, expected_version: str):
        super().__init__(message)
        self.current_version = current_version
        self.expected_version = expected_version


class ComplexService:
    """
    Сервис для управления комплексами.
    """

    def __init__(self, data_dir: str):
        """
        Инициализация ComplexService.

        Args:
            data_dir: Путь к директории с данными
        """
        self.data_dir = Path(data_dir)
        self.complexes_dir = self.data_dir / "complexes"
        self.complexes_file = self.complexes_dir / "complexes.json"

        # Создаем директорию если не существует
        self.complexes_dir.mkdir(parents=True, exist_ok=True)

        # Кэш комплексов
        self._complexes_cache: Dict[str, Complex] = {}
        self._initialized = False

    def _ensure_initialized(self):
        """Загружает комплексы при первом обращении."""
        if not self._initialized:
            self.load_complexes()
            self._initialized = True

    def load_complexes(self) -> List[Complex]:
        """
        Загружает все комплексы из файла.

        Returns:
            Список объектов Complex
        """
        self._complexes_cache = {}

        if not self.complexes_file.exists():
            logger.info(f"Complexes file not found: {self.complexes_file}. Creating empty.")
            self._save_all_complexes([])
            return []

        try:
            with open(self.complexes_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            if not isinstance(data, list):
                logger.error(f"Invalid format in {self.complexes_file}: expected list")
                return []

            loaded_complexes = []
            for item in data:
                try:
                    # Валидация схемы
                    normalized_item = _normalize_complex_ownership_fields(
                        dict(item), fallback_source="legacy_unknown"
                    )
                    ComplexSchema.validate_or_raise(normalized_item)
                    # Создание модели
                    complex_obj = Complex(**normalized_item)
                    self._complexes_cache[complex_obj.id] = complex_obj
                    loaded_complexes.append(complex_obj)
                except Exception as e:
                    logger.error(f"Error loading complex {item.get('id', 'unknown')}: {e}")

            return loaded_complexes

        except json.JSONDecodeError as e:
            logger.error(f"Corrupted JSON in {self.complexes_file}: {e}. Returning empty list.")
            return []
        except Exception as e:
            logger.error(f"Error loading complexes from {self.complexes_file}: {e}")
            return []

    def _save_all_complexes(self, complexes: List[Complex]):
        """
        Сохраняет список комплексов в файл.
        """
        try:
            data = [c.dict() for c in complexes]
            # Преобразуем datetime в ISO формат для JSON
            for item in data:
                if item.get("created_at"):
                    item["created_at"] = item["created_at"].isoformat()
                if item.get("updated_at"):
                    item["updated_at"] = item["updated_at"].isoformat()

            with open(self.complexes_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Error saving complexes to {self.complexes_file}: {e}")
            raise

    def get_all_complexes(self) -> List[Complex]:
        """Возвращает все комплексы."""
        self._ensure_initialized()
        return list(self._complexes_cache.values())

    def get_complex(self, complex_id: str) -> Optional[Complex]:
        """Возвращает комплекс по ID."""
        self._ensure_initialized()
        return self._complexes_cache.get(complex_id)

    def _reserve_complex_id(
        self,
        preferred_complex_id: Any = None,
        *,
        complex_name: Any = None,
    ) -> str:
        explicit_id = _normalize_optional_text(preferred_complex_id)
        if explicit_id is not None:
            base_id = secure_filename(explicit_id).strip().lower()
        else:
            base_id = secure_filename(str(complex_name or "").strip().lower().replace(" ", "_"))
        if not base_id:
            base_id = f"complex_{uuid4().hex[:8]}"

        candidate = base_id
        suffix = 1
        while candidate in self._complexes_cache:
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def find_complex_by_source_lineage(
        self,
        *,
        source_catalog_item_id: Any = None,
        source_catalog_version_id: Any = None,
        source_entity_kind: Any = "complex",
        source_entity_id: Any = None,
    ) -> Optional[Complex]:
        self._ensure_initialized()
        return find_first_by_source_lineage(
            self._complexes_cache.values(),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind=source_entity_kind,
            source_entity_id=source_entity_id,
        )

    def ensure_workspace_complex_copy(
        self,
        complex_data: Dict[str, Any],
        *,
        prefer_existing_by_lineage: bool = True,
    ) -> Dict[str, Any]:
        self._ensure_initialized()
        normalized_payload = _normalize_complex_ownership_fields(
            dict(complex_data or {}),
            fallback_source="workspace_copy",
        )

        if prefer_existing_by_lineage and build_source_lineage_key(normalized_payload):
            existing = self.find_complex_by_source_lineage(
                source_catalog_item_id=normalized_payload.get("source_catalog_item_id"),
                source_catalog_version_id=normalized_payload.get("source_catalog_version_id"),
                source_entity_kind=normalized_payload.get("source_entity_kind") or "complex",
                source_entity_id=normalized_payload.get("source_entity_id"),
            )
            if existing is not None:
                return {
                    "created": False,
                    "reused": True,
                    "complex_id": existing.id,
                    "item": existing,
                }

        preferred_complex_id = normalized_payload.get("id")
        if not _normalize_optional_text(preferred_complex_id) or self.get_complex(str(preferred_complex_id)):
            normalized_payload["id"] = self._reserve_complex_id(
                preferred_complex_id,
                complex_name=normalized_payload.get("name"),
            )
            normalized_payload = _normalize_complex_ownership_fields(
                normalized_payload,
                fallback_source="workspace_copy",
            )

        created = self.create_complex(normalized_payload)
        return {
            "created": True,
            "reused": False,
            "complex_id": created.id,
            "item": created,
        }

    def create_complex(self, complex_data: Dict[str, Any]) -> Complex:
        """
        Создает новый комплекс.

        Args:
            complex_data: Данные комплекса (словарь)

        Returns:
            Созданный объект Complex

        Raises:
            ValueError: Если комплекс с таким ID уже существует
            TaskValidationError: Если данные невалидны
        """
        self._ensure_initialized()

        # Валидация
        complex_data = _normalize_complex_ownership_fields(
            dict(complex_data),
            fallback_source="manual_editor",
        )
        ComplexSchema.validate_or_raise(complex_data)

        complex_id = complex_data["id"]
        if complex_id in self._complexes_cache:
            raise ValueError(f"Complex with ID '{complex_id}' already exists")

        # Ensure timestamps
        now = datetime.utcnow()
        if "created_at" not in complex_data or not complex_data["created_at"]:
            complex_data["created_at"] = now
        if "updated_at" not in complex_data or not complex_data["updated_at"]:
            complex_data["updated_at"] = now

        # Создание объекта
        new_complex = Complex(**complex_data)

        # Сохранение
        self._complexes_cache[complex_id] = new_complex
        self._save_all_complexes(list(self._complexes_cache.values()))

        logger.info(f"Created new complex: {complex_id}")
        return new_complex

    def _save_history_snapshot(
        self,
        complex_id: str,
        complex_data: Dict[str, Any],
        *,
        snapshot_kind: str = "manual",
        snapshot_label: Optional[str] = None,
        max_versions: int = 20,
    ) -> str:
        """
        Сохраняет snapshot комплекса в историю.
        """
        try:
            # Папка для истории конкретного комплекса
            history_dir = self.complexes_dir / "history" / complex_id
            history_dir.mkdir(parents=True, exist_ok=True)

            # Имя файла с timestamp (включая микросекунды для избежания коллизий)
            timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S_%f")
            history_file = history_dir / f"{timestamp}.json"
            suffix = 1
            while history_file.exists():
                history_file = history_dir / f"{timestamp}_{suffix:03d}.json"
                suffix += 1

            # Prepare data for JSON serialization (convert datetimes)
            snapshot_data = complex_data.copy()
            if snapshot_data.get("created_at") and isinstance(
                snapshot_data["created_at"], datetime
            ):
                snapshot_data["created_at"] = snapshot_data["created_at"].isoformat()
            if snapshot_data.get("updated_at") and isinstance(
                snapshot_data["updated_at"], datetime
            ):
                snapshot_data["updated_at"] = snapshot_data["updated_at"].isoformat()
            snapshot_data["_history_kind"] = str(snapshot_kind or "manual").strip() or "manual"
            snapshot_data["_history_saved_at"] = datetime.utcnow().isoformat()
            if snapshot_label:
                snapshot_data["_history_label"] = str(snapshot_label).strip()

            # Сохраняем snapshot
            with open(history_file, "w", encoding="utf-8") as f:
                json.dump(snapshot_data, f, indent=2, ensure_ascii=False)

            logger.info(f"Saved history snapshot: {history_file}")

            # Ограничиваем количество версий
            history_files = sorted(history_dir.glob("*.json"))
            if len(history_files) > max_versions:
                for old_file in history_files[:-max_versions]:
                    old_file.unlink()
                    logger.info(f"Deleted old history snapshot: {old_file}")
            return history_file.stem
        except Exception as e:
            logger.error(f"Failed to save history snapshot for {complex_id}: {e}")
            raise

    def save_autosave_snapshot(self, complex_id: str, snapshot_payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Сохраняет автосохранённое состояние как историю изменений, не меняя текущую сохранённую версию комплекса.
        """
        self._ensure_initialized()

        if complex_id not in self._complexes_cache:
            raise ValueError(f"Complex with ID '{complex_id}' not found")

        current_complex = self._complexes_cache[complex_id]
        current_data = current_complex.dict()
        payload = snapshot_payload.copy() if isinstance(snapshot_payload, dict) else {}

        snapshot_data = current_data.copy()
        snapshot_data.update(payload)
        snapshot_data["id"] = complex_id
        snapshot_data["created_at"] = current_data.get("created_at")
        snapshot_data["updated_at"] = current_data.get("updated_at")
        snapshot_data = _normalize_complex_ownership_fields(
            snapshot_data,
            fallback_source="manual_editor",
            existing=current_data,
        )
        self._save_history_snapshot(
            complex_id,
            snapshot_data,
            snapshot_kind="autosave",
            snapshot_label="Автосохранение",
        )
        return snapshot_data

    def get_latest_autosave_snapshot(self, complex_id: str) -> Optional[Dict[str, Any]]:
        """
        Возвращает последний autosave-snapshot из истории комплекса.
        """
        history_dir = self.complexes_dir / "history" / complex_id
        if not history_dir.exists():
            return None

        history_files = sorted(history_dir.glob("*.json"), reverse=True)
        for file in history_files:
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if str(data.get("_history_kind") or "").strip().lower() != "autosave":
                    continue
                data["_snapshot_timestamp"] = file.stem
                return data
            except Exception as e:
                logger.error(f"Error reading autosave history file {file}: {e}")
        return None

    def delete_autosave_snapshots(self, complex_id: str) -> int:
        """
        Удаляет autosave-snapshots для комплекса из истории изменений.
        """
        history_dir = self.complexes_dir / "history" / complex_id
        if not history_dir.exists():
            return 0

        deleted = 0
        for file in history_dir.glob("*.json"):
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if str(data.get("_history_kind") or "").strip().lower() != "autosave":
                    continue
                file.unlink()
                deleted += 1
            except Exception as e:
                logger.error(f"Error deleting autosave history file {file}: {e}")
        return deleted

    def update_complex(
        self, complex_id: str, updates: Dict[str, Any], expected_version: Optional[str] = None
    ) -> Complex:
        """
        Обновляет существующий комплекс с optimistic locking.

        Args:
            complex_id: ID комплекса
            updates: Поля для обновления
            expected_version: ISO timestamp версии, которую редактировали (для проверки конфликтов)

        Returns:
            Обновленный объект Complex

        Raises:
            ValueError: Если комплекс не найден
            ConflictError: Если версия не совпадает (concurrent edit)
        """
        self._ensure_initialized()

        if complex_id not in self._complexes_cache:
            raise ValueError(f"Complex with ID '{complex_id}' not found")

        current_complex = self._complexes_cache[complex_id]

        # Optimistic locking check
        if expected_version is not None:
            current_version = (
                current_complex.updated_at.isoformat() if current_complex.updated_at else None
            )

            if current_version != expected_version:
                raise ConflictError(
                    f"Complex has been modified by another user",
                    current_version=current_version,
                    expected_version=expected_version,
                )

        current_data = current_complex.dict()

        # Save snapshot BEFORE applying updates
        self._save_history_snapshot(complex_id, current_data, snapshot_kind="manual")

        # Обновляем поля
        current_data.update(updates)
        current_data["updated_at"] = datetime.utcnow()
        current_data = _normalize_complex_ownership_fields(
            current_data,
            fallback_source="manual_editor",
            existing=current_complex.dict(),
        )

        # Валидация обновленных данных
        # Конвертируем datetime обратно в строки для валидации схемы (если нужно),
        # но ComplexSchema проверяет типы JSON, а Pydantic сам разберется.
        # Лучше создать новый объект через Pydantic, он проверит типы.

        try:
            updated_complex = Complex(**current_data)
        except Exception as e:
            raise TaskValidationError(f"Invalid update data: {e}")

        # Сохранение
        self._complexes_cache[complex_id] = updated_complex
        self._save_all_complexes(list(self._complexes_cache.values()))

        logger.info(f"Updated complex: {complex_id}")
        return updated_complex

    def delete_complex(self, complex_id: str) -> bool:
        """
        Удаляет комплекс.

        Args:
            complex_id: ID комплекса

        Returns:
            True если удален, False если не найден
        """
        self._ensure_initialized()

        if complex_id not in self._complexes_cache:
            return False

        del self._complexes_cache[complex_id]
        self._save_all_complexes(list(self._complexes_cache.values()))

        logger.info(f"Deleted complex: {complex_id}")
        return True

    def get_complex_history(self, complex_id: str) -> List[Dict[str, Any]]:
        """
        Получить историю изменений комплекса.
        """
        history_dir = self.complexes_dir / "history" / complex_id

        if not history_dir.exists():
            return []

        history_files = sorted(history_dir.glob("*.json"), reverse=True)

        history = []
        for file in history_files:
            try:
                with open(file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    data["_snapshot_timestamp"] = file.stem
                    history.append(data)
            except Exception as e:
                logger.error(f"Error reading history file {file}: {e}")

        return history

    def restore_from_history(self, complex_id: str, snapshot_timestamp: str) -> Complex:
        """
        Восстановить комплекс из исторического snapshot.
        """
        self._ensure_initialized()

        history_dir = self.complexes_dir / "history" / complex_id
        snapshot_file = history_dir / f"{snapshot_timestamp}.json"

        if not snapshot_file.exists():
            raise ValueError(f"Snapshot not found: {snapshot_timestamp}")

        try:
            # Загружаем snapshot
            with open(snapshot_file, "r", encoding="utf-8") as f:
                snapshot_data = json.load(f)

            # Обновляем timestamp
            snapshot_data["updated_at"] = datetime.utcnow()

            # Удаляем служебные поля если есть
            snapshot_data.pop("_snapshot_timestamp", None)
            snapshot_data.pop("_history_kind", None)
            snapshot_data.pop("_history_label", None)
            snapshot_data.pop("_history_saved_at", None)

            # Валидация и сохранение
            # Используем update_complex чтобы сохранить историю ПЕРЕД восстановлением (безопасность)
            # Но update_complex принимает updates, а не полный объект.
            # Поэтому проще создать объект и заменить в кэше, но нужно сохранить текущее состояние в историю.

            # 1. Сохраняем текущее состояние (которое затрется)
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

            # 2. Восстанавливаем
            restored_complex = Complex(**snapshot_data)
            self._complexes_cache[complex_id] = restored_complex
            self._save_all_complexes(list(self._complexes_cache.values()))

            logger.info(f"Restored complex {complex_id} from snapshot {snapshot_timestamp}")
            return restored_complex

        except Exception as e:
            logger.error(f"Error restoring complex {complex_id} from {snapshot_timestamp}: {e}")
            raise TaskValidationError(f"Restore failed: {e}")
