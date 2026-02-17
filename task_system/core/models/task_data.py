# task_system/ui/editor/task_data.py
import uuid
from datetime import datetime
from copy import deepcopy
from typing import Optional

# Try to import ValidatedTask for conversion
try:
    from task_system.core.models.task_models import (
        ValidatedTask,
        TaskMetadata,
        ClickTaskContent,
        ErrorDetectionContent,
        DrawTaskContent,
        OpenAnswerTaskContent,
        TestTaskContent,
        SequenceAssemblyTaskContent,
        TaskSettings,
    )
    VALIDATED_TASK_AVAILABLE = True
except ImportError:
    VALIDATED_TASK_AVAILABLE = False
    ValidatedTask = None


class TaskData:
    """Унифицированная структура задания."""

    DEFAULT = {
        "id": None,
        "type": None,
        "meta": {
            "name": "",
            "module": "",
            "topic": "",
            "author": "",
            "created": "",
            "created_at": "",  # Новое поле для версионирования
            "modified": "",
            "version": "1.0",  # Сохраняем для обратной совместимости
            "task_schema_version": "1.2",  # Версия схемы
        },
        "content": {},
        "settings": {
            "difficulty": 1,
            "time_limit": None,
            "allow_hints": False,
        },
    }

    def __init__(self, data=None, **kwargs):
        if data is None:
            data = deepcopy(self.DEFAULT)
        if kwargs:
            data = deepcopy(self.DEFAULT)
            if 'content' in kwargs:
                data['content'] = deepcopy(kwargs['content'])
            if 'meta' in kwargs:
                data['meta'].update(deepcopy(kwargs['meta']))
            if 'type' in kwargs:
                data['type'] = kwargs['type']
            if 'id' in kwargs:
                data['id'] = kwargs['id']
            if 'settings' in kwargs:
                data['settings'].update(deepcopy(kwargs['settings']))
        # Делаем deepcopy данных, чтобы избежать расшаривания ссылок
        self.data = self._validate(deepcopy(data) if data is not None else deepcopy(self.DEFAULT))

    @property
    def id(self):
        return self.data["id"]
    
    @id.setter
    def id(self, value):
        self.data["id"] = value
        # Также сохраняем в meta для совместимости
        if "meta" in self.data and self.data["meta"] is not None:
            self.data["meta"]["id"] = value

    @property
    def type(self):
        return self.data["type"]

    @type.setter
    def type(self, t):
        self.data["type"] = t

    @property
    def meta(self):
        return self.data["meta"]

    def set_meta(self, **kwargs):
        for k, v in kwargs.items():
            if k == "id":
                # Если устанавливается id через set_meta, также устанавливаем на верхнем уровне
                self.data["id"] = v
            if k in self.data["meta"]:
                self.data["meta"][k] = v
            else:
                # Если ключа нет в meta, добавляем его
                self.data["meta"][k] = v

    @property
    def content(self):
        return self.data["content"]

    def update_content(self, **kwargs):
        self.data["content"].update(kwargs)

    def to_dict(self):
        return deepcopy(self.data)

    @classmethod
    def from_dict(cls, d):
        return cls(d)

    def touch_modified(self):
        self.data["meta"]["modified"] = datetime.now().isoformat()
    
    def to_validated(self) -> Optional[ValidatedTask]:
        """
        Преобразовать TaskData в ValidatedTask для валидации.
        
        Returns:
            ValidatedTask или None если валидация недоступна
        """
        if not VALIDATED_TASK_AVAILABLE or not ValidatedTask:
            return None
        
        try:
            # Prepare metadata
            meta_data = self.data.get('meta', {})
            
            # Ensure created_at exists
            if 'created_at' not in meta_data or not meta_data['created_at']:
                if 'created' in meta_data and meta_data['created']:
                    meta_data['created_at'] = meta_data['created']
                else:
                    meta_data['created_at'] = datetime.now().isoformat()
            
            # Ensure task_schema_version exists
            if 'task_schema_version' not in meta_data:
                from task_system.migrations import CURRENT_SCHEMA_VERSION
                meta_data['task_schema_version'] = CURRENT_SCHEMA_VERSION
            
            metadata = TaskMetadata(**meta_data)
            
            # Prepare content based on task type
            task_type = self.data.get('type', 'click')
            subtype = self.data.get('subtype')
            content_data = self.data.get('content', {})
            
            # Handle legacy format where fields are at top level
            if not content_data or (task_type == 'click' and 'image' not in content_data):
                # Try to extract from top level
                legacy_content = {}
                if 'image' in self.data:
                    legacy_content['image'] = self.data['image']
                if 'prompt' in self.data:
                    legacy_content['prompt'] = self.data['prompt']
                if 'question' in self.data:
                    legacy_content['question'] = self.data['question']
                if 'additionalInfo' in self.data:
                    legacy_content['additionalInfo'] = self.data['additionalInfo']
                if legacy_content:
                    content_data = {**content_data, **legacy_content}
            
            # For open_answer, handle both 'prompt' and 'question'
            if task_type == 'open_answer' and 'prompt' in content_data and 'question' not in content_data:
                content_data['question'] = content_data['prompt']
            
            # Create content model based on task type
            content_model_map = {
                ('click', 'error_detection'): ErrorDetectionContent,
                ('click', None): ClickTaskContent,
                'draw': DrawTaskContent,
                'open_answer': OpenAnswerTaskContent,
                'test': TestTaskContent,
                'sequence_assembly': SequenceAssemblyTaskContent,
            }
            
            content_model = content_model_map.get((task_type, subtype)) or content_model_map.get((task_type, None)) or content_model_map.get(task_type)
            if not content_model:
                return None
            
            validated_content = content_model(**content_data)
            
            # Prepare settings
            settings_data = self.data.get('settings', {})
            settings = TaskSettings(**settings_data) if settings_data else None
            
            # Create ValidatedTask
            validated_task = ValidatedTask(
                id=self.data.get('id', str(uuid.uuid4())),
                type=task_type,
                subtype=subtype,
                meta=metadata,
                content=validated_content,
                settings=settings
            )
            
            return validated_task
        except Exception as e:
            # Return None on validation error (caller should handle fallback)
            return None
    
    @classmethod
    def from_validated(cls, validated: ValidatedTask):
        """
        Создать TaskData из ValidatedTask.
        
        Args:
            validated: ValidatedTask instance
        
        Returns:
            TaskData instance
        """
        # Convert ValidatedTask to dict
        data = validated.dict(exclude_none=False)
        
        # Convert content back to dict format
        if hasattr(validated.content, 'dict'):
            data['content'] = validated.content.dict(exclude_none=False)
        else:
            data['content'] = validated.content
        
        # Convert metadata back to dict format
        if hasattr(validated.meta, 'dict'):
            data['meta'] = validated.meta.dict(exclude_none=False)
        else:
            data['meta'] = validated.meta

        # Persist subtype if present
        data['subtype'] = getattr(validated, 'subtype', None)
        
        # Convert settings back to dict format
        if validated.settings:
            if hasattr(validated.settings, 'dict'):
                data['settings'] = validated.settings.dict(exclude_none=False)
            else:
                data['settings'] = validated.settings
        else:
            data['settings'] = {}
        
        return cls(data)

    def _validate(self, data):
        base = deepcopy(self.DEFAULT)
        # Важно: сохраняем content ДО применения setdefault, чтобы не потерять данные
        original_content = data.get("content", {})
        if not isinstance(original_content, dict):
            original_content = {}
        
        for k, v in base.items():
            if k == "content":
                # Для content НЕ используем setdefault, чтобы не потерять данные
                # Если content отсутствует или не является словарем, создаем новый
                if k not in data or not isinstance(data[k], dict):
                    # Если есть оригинальный content, используем его, иначе пустой словарь
                    data[k] = deepcopy(original_content) if original_content else deepcopy(v)
                else:
                    # Content существует и является словарем - сохраняем его как есть
                    # НЕ перезаписываем, только добавляем недостающие ключи из DEFAULT если нужно
                    pass  # Оставляем data[k] как есть
            else:
                data.setdefault(k, deepcopy(v))
        
        for section in ("meta", "settings"):
            if section not in data or data[section] is None:
                data[section] = deepcopy(base[section])
            else:
                for k, v in base[section].items():
                    data[section].setdefault(k, deepcopy(v))
        
        # Восстанавливаем оригинальный content, если он был потерян или пустой
        if original_content and isinstance(original_content, dict) and len(original_content) > 0:
            # Объединяем оригинальный content с тем, что есть сейчас (оригинальный имеет приоритет)
            if "content" in data and isinstance(data["content"], dict):
                # Объединяем: сначала текущий, потом оригинальный (оригинальный перезаписывает)
                merged = data["content"].copy()
                merged.update(original_content)
                data["content"] = merged
            else:
                data["content"] = original_content
        
        if not data["id"]:
            data["id"] = str(uuid.uuid4())
        if not data["meta"]["created"]:
            data["meta"]["created"] = datetime.now().isoformat()
        # Устанавливаем created_at если отсутствует
        if not data["meta"]["created_at"]:
            data["meta"]["created_at"] = data["meta"]["created"]
        # Устанавливаем task_schema_version если отсутствует
        if "task_schema_version" not in data["meta"]:
            try:
                from task_system.migrations import CURRENT_SCHEMA_VERSION
                data["meta"]["task_schema_version"] = CURRENT_SCHEMA_VERSION
            except ImportError:
                # Если migrations недоступен, используем значение по умолчанию
                data["meta"]["task_schema_version"] = base["meta"]["task_schema_version"]
        return data

