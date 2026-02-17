"""
Миграция v1.0 → v1.1

Переносит поля верхнего уровня в структуру meta/content.
"""

import logging
from pathlib import Path
from typing import Dict, Any
from copy import deepcopy

from ..migration_base import BaseMigration
from ..schema import SCHEMA_V1_0, SCHEMA_V1_1

logger = logging.getLogger(__name__)


class MigrationV1_0ToV1_1(BaseMigration):
    """
    Миграция из версии 1.0 в версию 1.1.
    
    Преобразует старый формат (поля на верхнем уровне) в новый формат
    (структура meta/content).
    """
    
    from_version = SCHEMA_V1_0
    to_version = SCHEMA_V1_1
    
    def migrate(self, task_dict: Dict[str, Any], task_path: Path) -> Dict[str, Any]:
        """
        Применяет миграцию v1.0 → v1.1.
        
        Переносит поля верхнего уровня в content:
        - image → content.image
        - prompt → content.prompt
        - additionalInfo → content.additionalInfo
        - questions → content.questions
        - settings (верхний уровень) → content.settings
        
        Создает структуру meta если отсутствует:
        - name из верхнего уровня
        - moduleId → meta.module
        - topicId → meta.topic
        - author, created, modified (если есть)
        - version = "1.0"
        """
        logger.info(
            f"Migrating task {task_path} from {self.from_version} to {self.to_version}"
        )
        
        # Создаем копию для безопасной модификации
        result = deepcopy(task_dict)
        
        # Убеждаемся что есть content
        if "content" not in result:
            result["content"] = {}
        
        # Сохраняем тип в content для совместимости (если есть на верхнем уровне)
        if "type" in result and "type" not in result["content"]:
            result["content"]["type"] = result["type"]
            logger.debug(f"Set content.type to {result['type']}")
        
        # Переносим поля верхнего уровня в content
        fields_to_move = ["image", "prompt", "additionalInfo", "questions"]
        
        for field in fields_to_move:
            if field in result and field not in result["content"]:
                result["content"][field] = result.pop(field)
                logger.debug(f"Moved field '{field}' to content")
        
        # Переносим settings верхнего уровня в content.settings
        if "settings" in result:
            if "settings" not in result["content"]:
                result["content"]["settings"] = result.pop("settings")
                logger.debug("Moved 'settings' to content.settings")
            else:
                # Если settings уже есть в content, удаляем верхний уровень
                result.pop("settings")
                logger.debug("Removed duplicate 'settings' from top level")
        
        # Создаем структуру meta если отсутствует
        if "meta" not in result:
            result["meta"] = {}
            logger.debug("Created 'meta' structure")
        
        # Переносим метаданные в meta
        meta_mapping = {
            "name": "name",
            "moduleId": "module",
            "topicId": "topic",
        }
        
        for old_key, new_key in meta_mapping.items():
            if old_key in result and new_key not in result["meta"]:
                result["meta"][new_key] = result.pop(old_key)
                logger.debug(f"Moved '{old_key}' → meta.{new_key}")
        
        # Переносим дополнительные метаданные если есть
        for field in ["author", "created", "modified"]:
            if field in result and field not in result["meta"]:
                result["meta"][field] = result.pop(field)
                logger.debug(f"Moved '{field}' to meta")
        
        # Устанавливаем версию в meta если отсутствует
        if "version" not in result["meta"]:
            result["meta"]["version"] = "1.0"
            logger.debug("Set meta.version to '1.0'")
        
        # Сохраняем id в meta для совместимости (если есть на верхнем уровне)
        if "id" in result and "id" not in result["meta"]:
            result["meta"]["id"] = result["id"]
            logger.debug(f"Moved 'id' → meta.id ({result['id']})")
        
        # Сохраняем id и type на верхнем уровне
        # Они должны остаться как есть
        
        logger.info(
            f"Successfully migrated task {task_path} from {self.from_version} "
            f"to {self.to_version}"
        )
        
        return result
    
    def validate(self, task_dict: Dict[str, Any]) -> bool:
        """
        Проверяет корректность данных для миграции v1.0 → v1.1.
        
        Для v1.0 должны отсутствовать структуры meta и content,
        либо они должны быть пустыми.
        """
        # Базовая проверка - должна быть структура верхнего уровня
        if not isinstance(task_dict, dict):
            return False
        
        # Должны быть обязательные поля
        if "id" not in task_dict or "type" not in task_dict:
            logger.warning("Task missing required fields: id or type")
            return False
        
        return True























