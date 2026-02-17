"""
Менеджер миграций данных заданий.

Управляет регистрацией миграций и их применением к данным заданий.
"""

import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from collections import defaultdict

from .schema import detect_schema_version, CURRENT_SCHEMA_VERSION
from .migration_base import BaseMigration

logger = logging.getLogger(__name__)


class MigrationManager:
    """
    Менеджер миграций данных заданий.
    
    Управляет регистрацией миграций и их применением к данным заданий.
    Поддерживает цепочки миграций (например, v1.0 → v1.1 → v1.2).
    """
    
    def __init__(self):
        """Инициализация менеджера миграций."""
        self._migrations: Dict[str, Dict[str, BaseMigration]] = defaultdict(dict)
        logger.info("MigrationManager initialized")
    
    def register_migration(self, migration: BaseMigration):
        """
        Регистрирует миграцию.
        
        Args:
            migration: Экземпляр миграции, наследующий BaseMigration
        """
        from_version = migration.from_version
        to_version = migration.to_version
        
        if from_version in self._migrations and to_version in self._migrations[from_version]:
            logger.warning(
                f"Migration {from_version} → {to_version} already registered. "
                f"Overwriting with {migration.__class__.__name__}"
            )
        
        self._migrations[from_version][to_version] = migration
        logger.debug(
            f"Registered migration: {from_version} → {to_version} "
            f"({migration.__class__.__name__})"
        )
    
    def get_migration_path(
        self, from_version: str, to_version: str
    ) -> List[BaseMigration]:
        """
        Находит цепочку миграций от from_version до to_version.
        
        Использует простой поиск в глубину (DFS) для построения пути.
        
        Args:
            from_version: Исходная версия
            to_version: Целевая версия
            
        Returns:
            Список миграций для последовательного применения
            
        Raises:
            ValueError: Если путь миграции не найден
        """
        if from_version == to_version:
            return []
        
        # Используем DFS для поиска пути
        visited = set()
        path = []
        
        def dfs(current_version: str) -> bool:
            if current_version == to_version:
                return True
            
            if current_version in visited:
                return False
            
            visited.add(current_version)
            
            # Проверяем прямую миграцию
            if current_version in self._migrations:
                for next_version, migration in self._migrations[current_version].items():
                    if next_version not in visited:
                        path.append(migration)
                        if dfs(next_version):
                            return True
                        path.pop()
            
            return False
        
        if dfs(from_version):
            return path
        
        raise ValueError(
            f"No migration path found from {from_version} to {to_version}"
        )
    
    def should_migrate(self, task_dict: Dict[str, Any]) -> bool:
        """
        Проверяет, нужна ли миграция для данных задания.
        
        Args:
            task_dict: Словарь с данными задания
            
        Returns:
            True если нужна миграция
        """
        current_version = detect_schema_version(task_dict)
        return current_version != CURRENT_SCHEMA_VERSION
    
    def migrate_task(
        self,
        task_dict: Dict[str, Any],
        task_path: Path,
        target_version: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Применяет миграции к данным задания.
        
        Args:
            task_dict: Словарь с данными задания
            task_path: Путь к файлу task.json
            target_version: Целевая версия (по умолчанию CURRENT_SCHEMA_VERSION)
            
        Returns:
            Мигрированный словарь с данными задания
        """
        if target_version is None:
            target_version = CURRENT_SCHEMA_VERSION
        
        current_version = detect_schema_version(task_dict)
        
        if current_version == target_version:
            logger.debug(
                f"Task {task_path} already at target version {target_version}"
            )
            return task_dict
        
        logger.info(
            f"Migrating task {task_path} from {current_version} to {target_version}"
        )
        
        try:
            # Находим цепочку миграций
            migration_path = self.get_migration_path(current_version, target_version)
            
            if not migration_path:
                logger.debug(f"No migrations needed for {task_path}")
                return task_dict
            
            # Применяем миграции последовательно
            migrated_data = task_dict.copy()
            
            for migration in migration_path:
                logger.info(
                    f"Applying migration {migration.from_version} → "
                    f"{migration.to_version} to {task_path}"
                )
                
                try:
                    # Проверяем корректность данных
                    if not migration.validate(migrated_data):
                        logger.warning(
                            f"Validation failed for migration "
                            f"{migration.from_version} → {migration.to_version} "
                            f"on {task_path}, skipping"
                        )
                        continue
                    
                    # Применяем миграцию
                    migrated_data = migration.migrate(migrated_data, task_path)
                    
                    logger.info(
                        f"Successfully applied migration "
                        f"{migration.from_version} → {migration.to_version} "
                        f"to {task_path}"
                    )
                
                except Exception as e:
                    logger.error(
                        f"Error applying migration "
                        f"{migration.from_version} → {migration.to_version} "
                        f"to {task_path}: {e}",
                        exc_info=True,
                    )
                    # Возвращаем оригинальные данные при ошибке
                    logger.warning(
                        f"Returning original data for {task_path} due to migration error"
                    )
                    return task_dict
            
            logger.info(
                f"Successfully migrated task {task_path} "
                f"from {current_version} to {target_version}"
            )
            
            return migrated_data
        
        except ValueError as e:
            logger.error(
                f"Cannot migrate task {task_path}: {e}",
                exc_info=True,
            )
            # Возвращаем оригинальные данные
            return task_dict
        except Exception as e:
            logger.error(
                f"Unexpected error during migration of {task_path}: {e}",
                exc_info=True,
            )
            # Возвращаем оригинальные данные
            return task_dict


















































