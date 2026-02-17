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

from task_system.core.schemas.complex_schema import ComplexSchema
from task_system.core.models.complex_models import Complex
from task_system.core.exceptions import TaskValidationError

logger = logging.getLogger(__name__)


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
                    ComplexSchema.validate_or_raise(item)
                    # Создание модели
                    complex_obj = Complex(**item)
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

    def _save_history_snapshot(self, complex_id: str, complex_data: Dict[str, Any]) -> None:
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

            # Сохраняем snapshot
            with open(history_file, "w", encoding="utf-8") as f:
                json.dump(snapshot_data, f, indent=2, ensure_ascii=False)

            logger.info(f"Saved history snapshot: {history_file}")

            # Ограничиваем количество версий (последние 10)
            history_files = sorted(history_dir.glob("*.json"))
            if len(history_files) > 10:
                for old_file in history_files[:-10]:
                    old_file.unlink()
                    logger.info(f"Deleted old history snapshot: {old_file}")
        except Exception as e:
            logger.error(f"Failed to save history snapshot for {complex_id}: {e}")

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
        self._save_history_snapshot(complex_id, current_data)

        # Обновляем поля
        current_data.update(updates)
        current_data["updated_at"] = datetime.utcnow()

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

            # Валидация и сохранение
            # Используем update_complex чтобы сохранить историю ПЕРЕД восстановлением (безопасность)
            # Но update_complex принимает updates, а не полный объект.
            # Поэтому проще создать объект и заменить в кэше, но нужно сохранить текущее состояние в историю.

            # 1. Сохраняем текущее состояние (которое затрется)
            current_complex = self.get_complex(complex_id)
            if current_complex:
                self._save_history_snapshot(complex_id, current_complex.dict())

            # 2. Восстанавливаем
            restored_complex = Complex(**snapshot_data)
            self._complexes_cache[complex_id] = restored_complex
            self._save_all_complexes(list(self._complexes_cache.values()))

            logger.info(f"Restored complex {complex_id} from snapshot {snapshot_timestamp}")
            return restored_complex

        except Exception as e:
            logger.error(f"Error restoring complex {complex_id} from {snapshot_timestamp}: {e}")
            raise TaskValidationError(f"Restore failed: {e}")
