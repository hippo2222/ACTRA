# task_system/ui/editor/task_io.py
import json
import os
import logging
from pathlib import Path
from typing import Optional, Any
from datetime import datetime
from task_system.core.models.task_data import TaskData

logger = logging.getLogger(__name__)

# Try to import TaskLoader for validation
try:
    from task_system.core.loaders.task_loader import TaskLoader
    from task_system.core.models.path_resolver import PathResolver
    from task_system.core.models.task_models import is_direct_image_url, normalize_image_ref_to_string
    # Импортируем исключения из единой системы
    from task_system.core.exceptions import TaskValidationError, TaskLoadError
    TASK_LOADER_AVAILABLE = True
except ImportError:
    TASK_LOADER_AVAILABLE = False
    TaskLoader = None
    TaskValidationError = None
    TaskLoadError = None
    PathResolver = None
    is_direct_image_url = None
    normalize_image_ref_to_string = None


class TaskIO:
    """Унифицированный ввод/вывод заданий."""

    @staticmethod
    def _convert_datetime_to_str(obj: Any) -> Any:
        """
        Рекурсивно конвертирует datetime объекты в строки ISO формата.
        
        Args:
            obj: Объект для конвертации (может быть dict, list, datetime или другой тип)
            
        Returns:
            Объект с конвертированными datetime в строки
        """
        if isinstance(obj, datetime):
            return obj.isoformat()
        elif isinstance(obj, dict):
            return {key: TaskIO._convert_datetime_to_str(value) for key, value in obj.items()}
        elif isinstance(obj, list):
            return [TaskIO._convert_datetime_to_str(item) for item in obj]
        else:
            return obj

    @classmethod
    def new_task(cls, task_type, name="", module="", topic=""):
        task = TaskData()
        task.type = task_type
        task.set_meta(name=name, module=module, topic=topic)
        
        # Добавляем обязательные поля для разных типов заданий
        # Это необходимо для прохождения валидации Pydantic
        if task_type in ["click", "draw"]:
            # Для click и draw заданий требуются image и prompt
            if "image" not in task.content:
                task.content["image"] = ""
            if "prompt" not in task.content:
                task.content["prompt"] = ""
        elif task_type == "open_answer":
            # Для open_answer требуется question (Pydantic) и prompt (legacy)
            if "question" not in task.content:
                task.content["question"] = ""
            if "prompt" not in task.content:
                task.content["prompt"] = ""
        elif task_type == "test":
            # Для test заданий требуются questions, test_type и settings
            if "questions" not in task.content:
                task.content["questions"] = []
            if "test_type" not in task.content:
                task.content["test_type"] = "multiple_choice"
            if "settings" not in task.content:
                task.content["settings"] = {
                    "shuffle_questions": True,
                    "shuffle_answers": True,
                    "time_limit": None,
                    "passing_score": 70,
                }
        elif task_type == "sequence_assembly":
            # Для sequence_assembly требуются elements и prompt
            if "elements" not in task.content:
                task.content["elements"] = [
                    {"id": "elem_1", "text": "Элемент 1"},
                    {"id": "elem_2", "text": "Элемент 2"},
                ]
            if "prompt" not in task.content:
                task.content["prompt"] = ""
            if "levels" not in task.content:
                task.content["levels"] = [
                    {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]}
                ]
            if "level_order_matters" not in task.content:
                task.content["level_order_matters"] = False
            if "sequence_within_level_matters" not in task.content:
                task.content["sequence_within_level_matters"] = False
        
        return task

    @classmethod
    def save(cls, task: TaskData, path, validate: bool = True):
        """
        Сохранить задание в файл.
        
        Args:
            task: TaskData для сохранения
            path: Путь к файлу для сохранения
            validate: Если True, валидировать перед сохранением
        """
        logger.debug(f"TaskIO.save: task type = {type(task)}")
        data = task.to_dict()
        logger.debug(f"TaskIO.save: data type = {type(data)}")
        
        # Убеждаемся что task_schema_version установлен
        try:
            from task_system.migrations import CURRENT_SCHEMA_VERSION
            from datetime import datetime
            
            if "meta" not in data:
                data["meta"] = {}
            
            # Устанавливаем task_schema_version если отсутствует
            if "task_schema_version" not in data["meta"]:
                data["meta"]["task_schema_version"] = CURRENT_SCHEMA_VERSION
                logger.debug(
                    f"Set task_schema_version to {CURRENT_SCHEMA_VERSION} for {path}"
                )
            
            # Устанавливаем created_at если отсутствует
            if "created_at" not in data["meta"]:
                if "created" in data["meta"]:
                    data["meta"]["created_at"] = data["meta"]["created"]
                else:
                    data["meta"]["created_at"] = datetime.now().isoformat()
                logger.debug(f"Set created_at for {path}")
            
            # Убеждаемся, что ID сохранен в meta для совместимости
            if "id" in data and "id" not in data["meta"]:
                data["meta"]["id"] = data["id"]
                logger.debug(f"Set meta.id to {data['id']} for {path}")
        
        except Exception as e:
            logger.warning(
                f"Error setting schema version for {path}: {e}. "
                f"Continuing with save.",
                exc_info=True,
            )
        
        # Validate before saving if requested and TaskLoader is available
        if validate and TASK_LOADER_AVAILABLE and TaskLoader:
            try:
                # Try to convert to ValidatedTask for validation
                validated_task = task.to_validated()
                if validated_task:
                    # Use validated data
                    data = validated_task.dict(exclude_none=False)
                    # Конвертируем datetime объекты в строки для JSON сериализации
                    data = cls._convert_datetime_to_str(data)
                    logger.debug("Task validated before save")
            except Exception as e:
                logger.warning(
                    f"Validation failed before save for {path}: {e}. "
                    f"Continuing with save without validation.",
                    exc_info=True,
                )
        
        # КРИТИЧЕСКИ ВАЖНО: Для test заданий удаляем лишние поля из content
        # В content должны быть только: test_type, questions, settings
        # НЕ должно быть: type, image
        if data.get('type') == 'test' and 'content' in data and isinstance(data['content'], dict):
            if 'type' in data['content']:
                del data['content']['type']
                logger.debug("Removed 'type' from test task content")
            if 'image' in data['content']:
                del data['content']['image']
                logger.debug("Removed 'image' from test task content")
        
        # Конвертируем datetime объекты в строки перед сериализацией
        # (на случай если они появились в data из других источников)
        data = cls._convert_datetime_to_str(data)
        
        # Normalize paths before saving (make them relative to task.json)
        if PathResolver and path:
            try:
                task_json_path = Path(path)
                # Normalize image path if exists
                if 'content' in data and 'image' in data['content']:
                    image_path = data['content']['image']
                    if normalize_image_ref_to_string:
                        image_path = normalize_image_ref_to_string(image_path)
                        data['content']['image'] = image_path
                    if not isinstance(image_path, str) or not image_path:
                        pass
                    elif is_direct_image_url and is_direct_image_url(image_path):
                        pass
                    elif not Path(image_path).is_absolute():
                        # Already relative, keep as is
                        pass
                    else:
                        # Convert absolute to relative
                        normalized = PathResolver.normalize_path(
                            Path(image_path),
                            task_json_path
                        )
                        data['content']['image'] = normalized
                        logger.debug(f"Normalized image path: {image_path} -> {normalized}")
            except Exception as e:
                logger.warning(f"Error normalizing paths for {path}: {e}")
        
        # Atomic write pattern
        import tempfile
        import shutil
        
        dir_path = os.path.dirname(path)
        os.makedirs(dir_path, exist_ok=True)
        
        try:
            # Create temp file in the same directory to ensure atomic move is possible
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=dir_path,
                delete=False,
                encoding="utf-8",
                suffix=".tmp"
            ) as tf:
                json.dump(data, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            
            # Atomic replacement
            shutil.move(temp_name, path)
            logger.debug(f"TaskIO.save: Task saved atomically to {path}")
            
        except Exception as e:
            logger.error(f"Failed to save task atomically to {path}: {e}")
            # Clean up temp file if it exists
            if 'temp_name' in locals() and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass
            raise
        return path

    @classmethod
    def load(cls, path, use_validation: bool = True):
        """
        Загрузить задание из файла.
        
        Args:
            path: Путь к файлу task.json
            use_validation: Если True, использовать TaskLoader для валидации
        
        Returns:
            TaskData или None если ошибка
        """
        task_path = Path(path)
        
        # Try to use TaskLoader for validation if available
        if use_validation and TASK_LOADER_AVAILABLE and TaskLoader:
            try:
                # Determine data_dir from path
                # Find modules directory by going up from path
                data_dir = task_path.parent
                while data_dir.name != 'modules' and data_dir.parent != data_dir:
                    data_dir = data_dir.parent
                
                # If we found modules, go up one more to get data_dir
                if data_dir.name == 'modules':
                    data_dir = data_dir.parent
                
                task_loader = TaskLoader(data_dir=data_dir, strict_mode=False)
                result = task_loader.load_task(task_path)
                
                # Convert validated result to TaskData
                task_data_dict = result.get('task_data', {})
                # Логируем для отладки test-заданий
                if task_data_dict.get('type') == 'test':
                    content_from_loader = task_data_dict.get('content', {})
                    logger.info(f"TaskIO.load: TaskLoader вернул task_data с content keys: {list(content_from_loader.keys()) if isinstance(content_from_loader, dict) else 'not dict'}, questions: {len(content_from_loader.get('questions', [])) if isinstance(content_from_loader, dict) else 0}")
                
                task_data = TaskData.from_dict(task_data_dict)
                
                # Логируем после создания TaskData из TaskLoader
                if task_data_dict.get('type') == 'test':
                    content_after = task_data.content if isinstance(task_data.content, dict) else {}
                    logger.info(f"TaskIO.load: TaskData из TaskLoader, content keys: {list(content_after.keys())}, questions: {len(content_after.get('questions', []))}")
                
                return task_data
            except TaskValidationError as e:
                logger.warning(
                    f"Validation failed for {path}: {e}. "
                    f"Falling back to old load method.",
                    exc_info=True,
                )
            except Exception as e:
                logger.warning(
                    f"TaskLoader failed for {path}: {e}. "
                    f"Falling back to old load method.",
                    exc_info=True,
                )
        
        # Fallback to old method (without validation)
        try:
            with open(path, "r", encoding="utf-8") as f:
                raw = json.load(f)
        except Exception as e:
            logger.error(f"Ошибка чтения файла {path}: {e}", exc_info=True)
            return None

        # Базовые преобразования для обратной совместимости (старый формат)
        if "type" not in raw and "task_type" in raw:
            raw["type"] = raw.pop("task_type")
        
        # Убеждаемся, что тип также в content для совместимости
        if "type" in raw and "content" in raw:
            if "type" not in raw["content"]:
                raw["content"]["type"] = raw["type"]

        if "content" not in raw:
            raw["content"] = {}

        if "annotations" in raw and "annotations" not in raw["content"]:
            raw["content"]["annotations"] = raw.pop("annotations")

        if "image" in raw and "image" not in raw["content"]:
            raw["content"]["image"] = raw.pop("image")
        if "prompt" in raw and "prompt" not in raw["content"]:
            raw["content"]["prompt"] = raw.pop("prompt")
        if "additionalInfo" in raw and "additionalInfo" not in raw["content"]:
            raw["content"]["additionalInfo"] = raw.pop("additionalInfo")
        
        if "questions" in raw and "questions" not in raw["content"]:
            raw["content"]["questions"] = raw.pop("questions")
        
        # Для test-заданий перемещаем test_type в content
        if raw.get("type") == "test" and "test_type" in raw and "test_type" not in raw["content"]:
            raw["content"]["test_type"] = raw.pop("test_type")
        
        if "settings" in raw and "settings" not in raw["content"]:
            raw["content"]["settings"] = raw.pop("settings")

        if "meta" not in raw:
            from datetime import datetime
            # Создаем базовую структуру meta
            raw["meta"] = {
                "name": raw.get("name", ""),
                "module": raw.get("moduleId", ""),
                "topic": raw.get("topicId", ""),
                "author": raw.get("author", ""),
                "created": raw.get("created", ""),
                "modified": raw.get("modified", ""),
                "version": "1.0",  # Для обратной совместимости
                "task_schema_version": "1.2",  # Добавляем обязательное поле
                "created_at": raw.get("created", datetime.now().isoformat())  # Добавляем обязательное поле
            }
        
        # Убеждаемся, что обязательные поля присутствуют в meta
        if "meta" in raw:
            if "task_schema_version" not in raw["meta"]:
                raw["meta"]["task_schema_version"] = "1.2"
            if "created_at" not in raw["meta"]:
                from datetime import datetime
                raw["meta"]["created_at"] = raw["meta"].get("created", datetime.now().isoformat())
            if "version" not in raw["meta"]:
                raw["meta"]["version"] = "1.0"

        # Применяем миграции через MigrationManager
        try:
            from task_system.migrations import get_migration_manager
            
            migration_manager = get_migration_manager()
            task_path = Path(path)
            
            # Проверяем нужна ли миграция
            if migration_manager.should_migrate(raw):
                logger.info(f"Task {path} needs migration, applying...")
                raw = migration_manager.migrate_task(raw, task_path)
                logger.info(f"Migration completed for {path}")
        except Exception as e:
            logger.warning(
                f"Error during migration for {path}: {e}. "
                f"Continuing with original data.",
                exc_info=True,
            )
            # Продолжаем с оригинальными данными при ошибке миграции

        try:
            # Логируем raw перед созданием TaskData для отладки
            if raw.get("type") == "test":
                raw_content = raw.get("content", {})
                logger.info(f"TaskIO.load: raw content keys перед TaskData.from_dict: {list(raw_content.keys()) if isinstance(raw_content, dict) else 'not dict'}, questions: {len(raw_content.get('questions', [])) if isinstance(raw_content, dict) else 0}")
            
            task = TaskData.from_dict(raw)
            
            # Логируем для отладки test-заданий после создания TaskData
            if raw.get("type") == "test":
                content_questions = task.content.get("questions", []) if hasattr(task, 'content') and isinstance(task.content, dict) else []
                logger.info(f"TaskIO.load: test-задание загружено, questions в content после TaskData.from_dict: {len(content_questions)}, test_type: {task.content.get('test_type', 'unknown') if hasattr(task, 'content') and isinstance(task.content, dict) else 'unknown'}")
                logger.info(f"TaskIO.load: task.data['content'] keys: {list(task.data.get('content', {}).keys()) if isinstance(task.data.get('content'), dict) else 'not dict'}")
            return task
        except Exception as e:
            logger.error(f"Ошибка преобразования TaskData: {e}", exc_info=True)
            # При ошибке создаем TaskData с минимальными данными
            fallback_task = TaskData(content=raw.get("content", {}), meta=raw.get("meta", {}), type=raw.get("type", ""))
            if raw.get("type") == "test":
                logger.warning(f"TaskIO.load: fallback для test-задания, content keys: {list(fallback_task.content.keys())}")
            return fallback_task

    @staticmethod
    def get_pretty_name(task):
        if isinstance(task, TaskData):
            meta = task.meta
            return f"{meta.get('name', '(без названия)')} — {task.type}"
        else:
            meta = task.get("meta", {})
            return f"{meta.get('name', '(без названия)')} — {task.get('type', '')}"

    @staticmethod
    def is_task_file(path):
        return path.endswith(".json") and os.path.exists(path)
