"""
Task loader with Pydantic validation.

This module provides TaskLoader for loading and validating tasks
with automatic path resolution relative to task.json.
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Type, List
from pydantic import BaseModel, ValidationError as PydanticValidationError

from task_system.core.models.task_models import (
    TaskMetadata,
    ValidatedTask,
    ClickTaskContent,
    DrawTaskContent,
    OpenAnswerTaskContent,
    TestTaskContent,
    SequenceAssemblyTaskContent,
)
from task_system.core.models.answer_key_models import (
    ClickTaskAnswerKey,
    DrawTaskAnswerKey,
    OpenAnswerTaskAnswerKey,
    SequenceAssemblyAnswerKey,
    TestTaskAnswerKey,
)
from task_system.core.models.path_resolver import PathResolver
from task_system.core.exceptions import TaskLoadError, TaskValidationError
from task_system.migrations import get_migration_manager, CURRENT_SCHEMA_VERSION

logger = logging.getLogger(__name__)


class TaskLoader:
    """
    Task loader with Pydantic validation.
    
    Loads tasks from JSON files, applies migrations, validates data structure,
    and resolves all paths relative to task.json.
    """
    
    def __init__(self, data_dir: Path, strict_mode: bool = False):
        """
        Initialize TaskLoader.
        
        Args:
            data_dir: Root directory for data files
            strict_mode: If True, raise exceptions on validation errors.
                         If False, log warnings and continue.
        """
        self.data_dir = Path(data_dir)
        self.strict_mode = strict_mode
        self._schema_cache: Dict[str, Type[BaseModel]] = {}
        self.migration_manager = get_migration_manager()
        
        # Register content models by task type
        self._content_models = {
            'click': ClickTaskContent,
            'draw': DrawTaskContent,
            'open_answer': OpenAnswerTaskContent,
            'test': TestTaskContent,
            'sequence_assembly': SequenceAssemblyTaskContent,
        }
        
        # Register answer key models by task type
        self._answer_key_models = {
            'click': ClickTaskAnswerKey,
            'draw': DrawTaskAnswerKey,
            'open_answer': OpenAnswerTaskAnswerKey,
            'test': TestTaskAnswerKey,
            'sequence_assembly': SequenceAssemblyAnswerKey,
        }
    
    def load_task(self, task_path: Path) -> Dict[str, Any]:
        """
        Load and validate task from JSON file.
        
        Args:
            task_path: Path to task.json (relative or absolute)
        
        Returns:
            Dict with keys: 'task_data', 'answer_key', 'metadata'
        
        Raises:
            TaskLoadError: If task file not found or JSON decode error in strict mode
            TaskValidationError: If validation fails in strict mode
        """
        task_json_path = self._resolve_path(task_path)
        
        if not task_json_path.exists():
            raise TaskLoadError(
                f"Task file not found: {task_json_path}",
                details={'task_path': str(task_path), 'resolved_path': str(task_json_path)}
            )
        
        # Load raw JSON
        try:
            with open(task_json_path, 'r', encoding='utf-8') as f:
                raw_data = json.load(f)
        except json.JSONDecodeError as e:
            error_msg = f"Invalid JSON in {task_json_path}: {e}"
            logger.error(error_msg)
            if self.strict_mode:
                raise TaskLoadError(
                    error_msg,
                    details={'task_path': str(task_json_path), 'json_error': str(e)}
                )
            # Return minimal structure in lenient mode
            return {
                'task_data': raw_data if 'raw_data' in locals() else {},
                'answer_key': {},
                'metadata': {'id': task_json_path.parent.name}
            }
        
        # Apply migrations
        try:
            if self.migration_manager.should_migrate(raw_data):
                logger.info(f"Migrating task {task_json_path}...")
                raw_data = self.migration_manager.migrate_task(raw_data, task_json_path)
                logger.info(f"Migration completed for {task_json_path}")
        except Exception as e:
            logger.warning(f"Migration failed for {task_json_path}: {e}")
            # Continue with original data
        
        # Validate metadata
        meta_data = raw_data.get('meta', {})
        try:
            metadata = TaskMetadata(**meta_data)
        except PydanticValidationError as e:
            error_msg = f"Metadata validation failed for {task_json_path}"
            logger.error(f"{error_msg}: {e}")
            if self.strict_mode:
                raise TaskValidationError(
                    error_msg,
                    errors=e.errors(),
                    details={'task_path': str(task_json_path), 'metadata': meta_data}
                )
            # Use default metadata in lenient mode
            # Ensure created_at is set to avoid validation error
            created_at_value = meta_data.get('created_at') or meta_data.get('created')
            if created_at_value is None:
                from datetime import datetime
                created_at_value = datetime.now()
            metadata = TaskMetadata(
                task_schema_version=CURRENT_SCHEMA_VERSION,
                created_at=created_at_value,
                author=meta_data.get('author', ''),
                name=meta_data.get('name'),
                module=meta_data.get('module'),
                topic=meta_data.get('topic'),
            )
        
        # Validate task structure based on type
        task_type = raw_data.get('type', 'unknown')
        
        try:
            validated_task = self._validate_task(raw_data, task_type, task_json_path)
        except PydanticValidationError as e:
            error_msg = f"Task validation failed for {task_json_path}"
            logger.error(f"{error_msg}: {e}")
            if self.strict_mode:
                raise TaskValidationError(
                    error_msg,
                    errors=e.errors(),
                    details={'task_path': str(task_json_path), 'task_type': task_type}
                )
            # Return raw data in lenient mode
            validated_task = None
        
        # Load answer_key if exists
        answer_key_path = task_json_path.parent / "answer_key.json"
        answer_key = None
        if answer_key_path.exists():
            answer_key = self.load_answer_key(
                answer_key_path,
                task_type,
                validated_task.dict() if validated_task else raw_data
            )
        
        # Resolve paths relative to task.json
        if validated_task:
            validated_task.resolve_paths(task_json_path)
            task_data = validated_task.dict()
        else:
            # Resolve paths manually in lenient mode
            # Важно: преобразуем старый формат в новый перед вызовом _resolve_paths_manual
            normalized_data = self._normalize_legacy_format(raw_data.copy())
            task_data = self._resolve_paths_manual(normalized_data, task_json_path)
        
        return {
            'task_data': task_data,
            'answer_key': answer_key or {},
            'metadata': metadata.dict()
        }
    
    def _validate_task(
        self,
        raw_data: Dict[str, Any],
        task_type: str,
        task_json_path: Path
    ) -> ValidatedTask:
        """
        Validate task data structure.
        
        Args:
            raw_data: Raw task data from JSON
            task_type: Task type
            task_json_path: Path to task.json
        
        Returns:
            ValidatedTask instance
        
        Raises:
            PydanticValidationError: If validation fails
            ValueError: If task type is unknown
        """
        # Get content model for task type
        content_model = self._content_models.get(task_type)
        
        if not content_model:
            raise ValueError(f"Unknown task type: {task_type}")
        
        # Extract and validate content
        content_data = raw_data.get('content', {})
        # Handle legacy format where fields are at top level
        if not content_data or (task_type == 'click' and 'image' not in content_data) or (task_type == 'test' and 'questions' not in content_data):
            # Try to extract from top level
            legacy_content = {}
            if 'image' in raw_data:
                legacy_content['image'] = raw_data['image']
            if 'prompt' in raw_data:
                legacy_content['prompt'] = raw_data['prompt']
            if 'question' in raw_data:
                legacy_content['question'] = raw_data['question']
            if 'additionalInfo' in raw_data:
                legacy_content['additionalInfo'] = raw_data['additionalInfo']
            # For test tasks, extract questions, test_type, and settings from top level
            if task_type == 'test':
                if 'questions' in raw_data:
                    legacy_content['questions'] = raw_data['questions']
                if 'test_type' in raw_data:
                    legacy_content['test_type'] = raw_data['test_type']
                if 'settings' in raw_data:
                    legacy_content['settings'] = raw_data['settings']
            if legacy_content:
                content_data = {**content_data, **legacy_content}
        
        # For open_answer, handle both 'prompt' and 'question'
        if task_type == 'open_answer' and 'prompt' in content_data and 'question' not in content_data:
            content_data['question'] = content_data['prompt']
        
        validated_content = content_model(**content_data)
        
        # Create ValidatedTask
        validated_task = ValidatedTask(
            id=raw_data.get('id', task_json_path.parent.name),
            type=task_type,
            meta=TaskMetadata(**raw_data.get('meta', {})),
            content=validated_content,
            settings=raw_data.get('settings')
        )
        
        return validated_task
    
    def load_answer_key(
        self,
        answer_key_path: Path,
        task_type: str,
        task_data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Load and validate answer_key.
        
        Args:
            answer_key_path: Path to answer_key.json
            task_type: Task type
            task_data: Task data (for accessing settings)
        
        Returns:
            Validated answer_key dict or None if validation fails
        """
        try:
            with open(answer_key_path, 'r', encoding='utf-8') as f:
                raw_key = json.load(f)
        except json.JSONDecodeError as e:
            error_msg = f"Invalid JSON in {answer_key_path}: {e}"
            logger.error(error_msg)
            if self.strict_mode:
                raise TaskLoadError(
                    error_msg,
                    details={'answer_key_path': str(answer_key_path), 'json_error': str(e)}
                )
            return None
        
        # Get answer key model for task type
        answer_key_model = self._answer_key_models.get(task_type)
        
        if not answer_key_model:
            logger.warning(f"No answer key model for task type: {task_type}")
            return raw_key
        
        try:
            validated_key = answer_key_model(**raw_key)
            
            # Apply tolerance_px from settings for ClickTask
            if task_type == 'click' and isinstance(validated_key, ClickTaskAnswerKey):
                settings = task_data.get('settings', {})
                tolerance_px = settings.get('tolerancePx', 10)
                validated_key.apply_tolerance_from_settings(tolerance_px)
            
            return validated_key.dict()
        except PydanticValidationError as e:
            error_msg = f"Answer key validation failed for {answer_key_path}"
            logger.error(f"{error_msg}: {e}")
            if self.strict_mode:
                raise TaskValidationError(
                    error_msg,
                    errors=e.errors(),
                    details={'answer_key_path': str(answer_key_path), 'task_type': task_type}
                )
            # Return raw data in lenient mode
            return raw_key
    
    def _normalize_legacy_format(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Преобразует старый формат задания в новый формат (с meta и content).
        
        Args:
            data: Словарь с данными задания (может быть в старом формате)
        
        Returns:
            Нормализованный словарь с meta и content
        """
        from datetime import datetime
        
        # Если уже есть meta и content, возвращаем как есть
        if 'meta' in data and 'content' in data:
            return data
        
        # Создаем content если его нет
        if 'content' not in data:
            data['content'] = {}
        
        # Для test-заданий перемещаем questions, test_type, settings в content
        if data.get('type') == 'test':
            if 'questions' in data and 'questions' not in data['content']:
                data['content']['questions'] = data.pop('questions')
            if 'test_type' in data and 'test_type' not in data['content']:
                data['content']['test_type'] = data.pop('test_type')
            if 'settings' in data and 'settings' not in data['content']:
                data['content']['settings'] = data.pop('settings')
        
        # Для других типов заданий перемещаем поля в content
        for field in ['image', 'prompt', 'question', 'additionalInfo', 'annotations']:
            if field in data and field not in data['content']:
                data['content'][field] = data.pop(field)
        
        # Создаем meta если его нет
        if 'meta' not in data:
            data['meta'] = {
                'name': data.get('name', ''),
                'module': data.get('moduleId', ''),
                'topic': data.get('topicId', ''),
                'author': data.get('author', ''),
                'created': data.get('created', ''),
                'modified': data.get('modified', ''),
                'version': '1.0',
                'task_schema_version': CURRENT_SCHEMA_VERSION,
                'created_at': data.get('created', datetime.now().isoformat())
            }
        
        # Убеждаемся, что обязательные поля присутствуют в meta
        if 'task_schema_version' not in data['meta']:
            data['meta']['task_schema_version'] = CURRENT_SCHEMA_VERSION
        if 'created_at' not in data['meta']:
            data['meta']['created_at'] = data['meta'].get('created', datetime.now().isoformat())
        if 'version' not in data['meta']:
            data['meta']['version'] = '1.0'
        
        return data
    
    def _resolve_paths_manual(self, data: Dict[str, Any], task_json_path: Path):
        """
        Manually resolve paths in data (for lenient mode).
        
        Args:
            data: Task data dict
            task_json_path: Path to task.json
        """
        task_dir = task_json_path.parent
        
        # Resolve image path
        if 'image' in data:
            data['image'] = str(PathResolver.resolve_image_path(data['image'], task_json_path))
        elif 'content' in data and 'image' in data['content']:
            data['content']['image'] = str(
                PathResolver.resolve_image_path(data['content']['image'], task_json_path)
            )
        
        return data
    
    def _resolve_path(self, path: Path) -> Path:
        """
        Resolve path to task.json.
        
        Args:
            path: Relative or absolute path
        
        Returns:
            Absolute Path
        """
        if path.is_absolute():
            return path
        return self.data_dir / path





