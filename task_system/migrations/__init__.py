"""
Система миграций данных заданий.

Предоставляет механизм версионирования и миграции форматов task.json.
"""

import logging

from .schema import (
    SCHEMA_V1_0,
    SCHEMA_V1_1,
    SCHEMA_V1_2,
    CURRENT_SCHEMA_VERSION,
    detect_schema_version,
)
from .migration_base import BaseMigration

from .migration_manager import MigrationManager

# Глобальный экземпляр менеджера миграций
_migration_manager = None


def get_migration_manager() -> MigrationManager:
    """
    Получить глобальный экземпляр MigrationManager.
    
    Returns:
        MigrationManager: Экземпляр менеджера миграций
    """
    global _migration_manager
    if _migration_manager is None:
        _migration_manager = MigrationManager()
        # Автоматическая регистрация всех миграций при первом использовании
        _register_all_migrations()
    return _migration_manager


def _register_all_migrations():
    """Регистрирует все миграции в менеджере."""
    # Импортируем миграции для их автоматической регистрации
    try:
        from .versions import v1_0_to_v1_1, v1_1_to_v1_2
        
        # Создаем экземпляры миграций и регистрируем
        # Используем _migration_manager напрямую, чтобы избежать рекурсии
        global _migration_manager
        if _migration_manager is None:
            _migration_manager = MigrationManager()
        
        _migration_manager.register_migration(v1_0_to_v1_1.MigrationV1_0ToV1_1())
        _migration_manager.register_migration(v1_1_to_v1_2.MigrationV1_1ToV1_2())
        
        logger = logging.getLogger(__name__)
        logger.info("All migrations registered successfully")
    except ImportError as e:
        # Миграции еще не созданы - это нормально при первой загрузке
        logger = logging.getLogger(__name__)
        logger.debug(f"Migrations not yet available: {e}")


# Экспорт для удобства использования
__all__ = [
    "SCHEMA_V1_0",
    "SCHEMA_V1_1",
    "SCHEMA_V1_2",
    "CURRENT_SCHEMA_VERSION",
    "detect_schema_version",
    "BaseMigration",
    "MigrationManager",
    "get_migration_manager",
]

