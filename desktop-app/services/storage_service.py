"""
Storage Service - Работа с хранилищем данных (модули, задания, ключи ответов).

Отвечает за:
- Загрузку модулей, тем, заданий из файловой системы
- Загрузку ключей ответов
- Независимая работа с JSON файлами

НЕДЕЛЯ 2, Services Layer - Блок D: Storage Service
ОБНОВЛЕНО: Удалена зависимость от NavigationManager
"""

import copy
import hashlib
import json
import logging
import os
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Dict, Any, Optional
from werkzeug.utils import secure_filename
from services.workspace_lineage import (
    build_source_lineage_key,
    find_first_by_source_lineage,
    normalize_workspace_graph_entity_fields,
    normalize_workspace_lineage_fields,
)

_SOURCE_LINEAGE_FIELD_NAMES = (
    "source_catalog_item_id",
    "source_catalog_version_id",
    "source_entity_kind",
    "source_entity_id",
)

_GRAPH_OWNERSHIP_FIELD_NAMES = (
    "created_by_user_id",
    "updated_by_user_id",
    "created_via",
    "content_scope",
)


def _normalize_optional_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None

# Import TaskLoader and exceptions
try:
    from task_system.core.loaders.task_loader import TaskLoader
    from task_system.core.exceptions import TaskLoadError, TaskValidationError
    TASK_LOADER_AVAILABLE = True
except ImportError:
    TASK_LOADER_AVAILABLE = False
    TaskLoader = None
    TaskLoadError = None
    TaskValidationError = None


class StorageService:
    """
    Сервис для работы с хранилищем данных.
    
    Самостоятельно загружает модули/темы/задания из файловой системы,
    предоставляет упрощённый API для Logic Layer.
    
    Использование:
        storage = StorageService(data_dir="./data")
        
        # Загрузка модулей
        modules = storage.load_modules()
        
        # Загрузка тем модуля
        topics = storage.get_topics(module_id="anatomy")
        
        # Загрузка заданий темы
        tasks = storage.get_tasks(module_id="anatomy", topic_id="liver")
        
        # Загрузка конкретного задания
        task = storage.load_task("anatomy", "liver", "liver_click_01")
    """
    
    def __init__(self, data_dir: str, strict_validation: bool = False):
        """
        Инициализация StorageService.
        
        Args:
            data_dir: Путь к директории с данными
            strict_validation: Если True, использовать строгую валидацию (выбрасывать исключения)
        """
        self.data_dir = Path(data_dir)
        self.modules_dir = self.data_dir / "modules"
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Кэш загруженных модулей
        self._modules_cache: Optional[List[Dict[str, Any]]] = None
        self._modules_cache_timestamp: float = 0
        
        # Initialize TaskLoader if available
        self.task_loader: Optional[TaskLoader] = None
        if TASK_LOADER_AVAILABLE and TaskLoader:
            try:
                self.task_loader = TaskLoader(
                    data_dir=self.data_dir,
                    strict_mode=strict_validation
                )
                self.logger.info("TaskLoader initialized with Pydantic validation")
            except Exception as e:
                self.logger.warning(f"Failed to initialize TaskLoader: {e}. Using fallback mode.")
                self.task_loader = None

    def _validate_id(self, id_str: str, context: str = "") -> None:
        """
        Validate that an ID is safe (no path traversal).
        
        Args:
            id_str: The ID to validate
            context: Context for error message (e.g. "module_id")
            
        Raises:
            ValueError: If ID contains unsafe characters
        """
        if not id_str:
            raise ValueError(f"ID cannot be empty: {context}")
            
        # Check for path traversal attempts and separators
        if ".." in id_str or "/" in id_str or "\\" in id_str:
            raise ValueError(f"Invalid ID format (unsafe characters detected): {id_str} in {context}")

    def _convert_datetime_to_str(self, obj: Any) -> Any:
        """
        Recursively convert datetime objects to ISO strings.

        Args:
            obj: Arbitrary Python object

        Returns:
            Same structure with datetime instances converted to ISO strings
        """
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, dict):
            return {key: self._convert_datetime_to_str(value) for key, value in obj.items()}
        if isinstance(obj, list):
            return [self._convert_datetime_to_str(item) for item in obj]
        return obj

    def _apply_workspace_meta_fields(
        self,
        payload: Dict[str, Any],
        workspace_meta: Optional[Dict[str, Any]],
        *,
        field_names: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        normalized = dict(payload or {})
        if not isinstance(workspace_meta, dict):
            return normalized
        fields = tuple(field_names or (_SOURCE_LINEAGE_FIELD_NAMES + _GRAPH_OWNERSHIP_FIELD_NAMES))
        for field_name in fields:
            if workspace_meta.get(field_name) is not None:
                normalized[field_name] = workspace_meta.get(field_name)
        return normalized

    def _normalize_graph_ownership_fields(
        self,
        payload: Dict[str, Any],
        *,
        existing: Optional[Dict[str, Any]] = None,
        fallback_source: str = "legacy_unknown",
        fallback_scope: str = "shared_local",
    ) -> Dict[str, Any]:
        normalized = dict(payload or {})
        existing_payload = existing if isinstance(existing, dict) else {}

        created_by_user_id = _normalize_optional_text(normalized.get("created_by_user_id"))
        if created_by_user_id is None:
            created_by_user_id = _normalize_optional_text(existing_payload.get("created_by_user_id"))

        updated_by_user_id = _normalize_optional_text(normalized.get("updated_by_user_id"))
        if updated_by_user_id is None:
            updated_by_user_id = _normalize_optional_text(existing_payload.get("updated_by_user_id"))
        if updated_by_user_id is None:
            updated_by_user_id = created_by_user_id

        created_via = _normalize_optional_text(normalized.get("created_via"))
        if created_via is None:
            created_via = _normalize_optional_text(existing_payload.get("created_via"))
        if created_via is None:
            imported_flag = bool(normalized.get("imported") or existing_payload.get("imported"))
            import_source = _normalize_optional_text(normalized.get("import_source"))
            if import_source is None:
                import_source = _normalize_optional_text(existing_payload.get("import_source"))
            if imported_flag:
                source_seed = secure_filename(str(import_source or "").strip().lower().replace(" ", "_"))
                created_via = f"{source_seed}_import" if source_seed else "legacy_import"
            else:
                created_via = fallback_source

        content_scope = _normalize_optional_text(normalized.get("content_scope"))
        if content_scope is None:
            content_scope = _normalize_optional_text(existing_payload.get("content_scope"))
        if content_scope is None:
            content_scope = fallback_scope

        normalized["created_by_user_id"] = created_by_user_id
        normalized["updated_by_user_id"] = updated_by_user_id
        normalized["created_via"] = created_via
        normalized["content_scope"] = content_scope
        return normalized

    def _normalize_module_payload(self, module_payload: Dict[str, Any]) -> Dict[str, Any]:
        payload = self._normalize_graph_ownership_fields(
            dict(module_payload or {}),
            existing=module_payload if isinstance(module_payload, dict) else None,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        module_id = str(payload.get("id") or "").strip()
        if not module_id:
            return payload

        normalized = normalize_workspace_graph_entity_fields(
            payload,
            entity_kind="module",
            module_id=module_id,
        )
        normalized_topics: List[Dict[str, Any]] = []
        for topic in normalized.get("topics") or []:
            if not isinstance(topic, dict):
                continue
            normalized_topics.append(self._normalize_topic_payload(module_id, topic))
        normalized["topics"] = normalized_topics
        return normalized

    def _normalize_topic_payload(
        self,
        module_id: str,
        topic_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        payload = self._normalize_graph_ownership_fields(
            dict(topic_payload or {}),
            existing=topic_payload if isinstance(topic_payload, dict) else None,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        topic_id = str(payload.get("id") or "").strip()
        if not topic_id:
            return payload

        normalized = normalize_workspace_graph_entity_fields(
            payload,
            entity_kind="topic",
            module_id=module_id,
            topic_id=topic_id,
        )
        normalized["module_id"] = module_id
        normalized["module"] = module_id
        normalized_tasks: List[Dict[str, Any]] = []
        for task in normalized.get("tasks") or []:
            if not isinstance(task, dict):
                continue
            normalized_tasks.append(self._normalize_task_metadata(module_id, topic_id, task))
        normalized["tasks"] = normalized_tasks
        return normalized

    def _normalize_task_metadata(
        self,
        module_id: str,
        topic_id: str,
        task_payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        payload = self._normalize_graph_ownership_fields(
            dict(task_payload or {}),
            existing=task_payload if isinstance(task_payload, dict) else None,
            fallback_source="legacy_unknown",
            fallback_scope="shared_local",
        )
        task_id = str(payload.get("id") or "").strip()
        if not task_id:
            return payload
        normalized = normalize_workspace_graph_entity_fields(
            payload,
            entity_kind="task",
            module_id=module_id,
            topic_id=topic_id,
            task_id=task_id,
        )
        normalized["module_id"] = module_id
        normalized["module"] = module_id
        normalized["topic_id"] = topic_id
        normalized["topic"] = topic_id
        return normalized

    def reserve_module_id(
        self,
        module_name: str,
        preferred_module_id: Optional[str] = None,
    ) -> str:
        if preferred_module_id:
            self._validate_id(preferred_module_id, "module_id")
            base_id = preferred_module_id
        else:
            base_id = secure_filename((module_name or "").lower().replace(" ", "_"))
            if not base_id:
                base_id = f"module_{uuid.uuid4().hex[:8]}"

        candidate = base_id
        suffix = 1
        while (self.modules_dir / candidate).exists():
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def reserve_topic_id(
        self,
        module_id: str,
        topic_name: str,
        preferred_topic_id: Optional[str] = None,
    ) -> str:
        self._validate_id(module_id, "module_id")
        if preferred_topic_id:
            self._validate_id(preferred_topic_id, "topic_id")
            base_id = preferred_topic_id
        else:
            base_id = secure_filename((topic_name or "").lower().replace(" ", "_"))
            if not base_id:
                base_id = f"topic_{uuid.uuid4().hex[:8]}"

        candidate = base_id
        suffix = 1
        while (self.modules_dir / module_id / "topics" / candidate).exists():
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1
        return candidate

    def _normalize_answer_key(self, task_data: Dict[str, Any], answer_key: Dict[str, Any]) -> Dict[str, Any]:
        """
        Normalize answer key for all task types.
        Extracts answer data from task_data['content'] if answer_key is empty.
        """
        task_type = task_data.get('type') or task_data.get('task_type')
        content = task_data.get('content', {}) if isinstance(task_data, dict) else {}
        base = answer_key if isinstance(answer_key, dict) else {}
        base = dict(base)

        # 1. CLICK & 2. DRAW / SEGMENTATION
        if task_type == 'click' or task_type == 'draw' or task_type == 'region_segmentation':
            # Existing answer key already has targets? Keep them.
            if isinstance(base.get('targets'), list) and base.get('targets'):
                return base

            targets = []
            
            # Source 1: 'annotations' (Click Editor)
            annotations = content.get('annotations')
            # Source 2: 'regions' (Draw Editor)
            regions = content.get('regions')

            source_list = annotations if isinstance(annotations, list) else (regions if isinstance(regions, list) else [])

            if not source_list:
                return base

            for item in source_list:
                if not isinstance(item, dict):
                    continue

                item_type = item.get('type') or item.get('shape') or item.get('target_type')
                points = item.get('points')
                point = item.get('point') or item.get('coordinates')
                label = item.get('label', '')

                # Freehand must win over generic "3+ points" fallback, otherwise
                # long freehand traces degrade into polygons in runtime/UI.
                if item_type == 'freehand' and isinstance(points, list) and len(points) >= 2:
                    t = {
                        'shape': 'freehand',
                        'points': points,
                        'label': label,
                    }
                    if 'tolerance_px' in item: t['tolerance_px'] = item['tolerance_px']
                    elif 'tolerancePx' in item: t['tolerancePx'] = item['tolerancePx']
                    targets.append(t)
                # Polygon / Region
                elif item_type == 'polygon' or (not item_type and isinstance(points, list) and len(points) >= 3):
                     targets.append({
                        'shape': 'polygon',
                        'points': points,
                        'label': label,
                    })
                # Freehand fallback for legacy shapes without explicit type
                elif isinstance(points, list) and len(points) >= 2:
                    t = {
                        'shape': 'freehand',
                        'points': points,
                        'label': label,
                    }
                    if 'tolerance_px' in item: t['tolerance_px'] = item['tolerance_px']
                    elif 'tolerancePx' in item: t['tolerancePx'] = item['tolerancePx']
                    targets.append(t)
                # Point
                elif item_type == 'point' or (isinstance(point, (list, tuple)) and len(point) >= 2):
                     t = {
                        'shape': 'point',
                        'point': [point[0], point[1]],
                        'label': label,
                    }
                     if 'tolerance_px' in item: t['tolerance_px'] = item['tolerance_px']
                     elif 'tolerancePx' in item: t['tolerancePx'] = item['tolerancePx']
                     targets.append(t)
            
            if targets:
                base['targets'] = targets
            return base

        # 3. OPEN ANSWER
        elif task_type == 'open_answer':
            # Keywords
            if 'keywords' not in base and 'keywords' in content and content.get('keywords') is not None:
                base['keywords'] = content['keywords']
            
            # Sequence matters
            if 'sequence_matters' not in base:
                if 'sequence_matters' in content and content.get('sequence_matters') is not None:
                    base['sequence_matters'] = content['sequence_matters']
                elif 'settings' in task_data and isinstance(task_data['settings'], dict) and 'sequence_matters' in task_data['settings'] and task_data['settings'].get('sequence_matters') is not None:
                    base['sequence_matters'] = task_data['settings']['sequence_matters']
            
            # Reference answer (D-2 fix)
            if 'reference_answer' not in base and 'reference_answer' in content and content.get('reference_answer') is not None:
                base['reference_answer'] = content['reference_answer']

            # max_length (D-11 fix)
            if 'max_length' not in base:
                if 'max_length' in content and content.get('max_length') is not None:
                    base['max_length'] = content['max_length']
                elif 'settings' in task_data and isinstance(task_data['settings'], dict) and 'max_length' in task_data['settings'] and task_data['settings'].get('max_length') is not None:
                    base['max_length'] = task_data['settings']['max_length']
            
            # min_keywords / require_all_keywords (D-1 fix)
            if 'min_keywords' not in base and 'min_keywords' in content and content.get('min_keywords') is not None:
                base['min_keywords'] = content['min_keywords']
            if 'require_all_keywords' not in base and 'require_all_keywords' in content and content.get('require_all_keywords') is not None:
                base['require_all_keywords'] = content['require_all_keywords']
            
            return base

        # 4. SEQUENCE ASSEMBLY
        elif task_type == 'sequence_assembly' or task_type == 'sequence':
            if 'elements' not in base and isinstance(content.get('elements'), list):
                base['elements'] = content['elements']

            # Editor saves 'sequence' list in content
            # Evaluator expects 'levels' list in answer_key
            if 'levels' not in base and 'sequence' in content:
                editor_sequence = content['sequence']
                levels = []
                if isinstance(editor_sequence, list):
                    for idx, level in enumerate(editor_sequence):
                        if not isinstance(level, dict): continue
                        
                        # Extract items/blocks
                        items = level.get('items', [])
                        blocks = []
                        if isinstance(items, list):
                            for item in items:
                                if isinstance(item, dict):
                                    # Use label as ID if no explicit ID
                                    # Ideally Editor should assign IDs, but for now we create a workable structure
                                    blocks.append(item.get('id') or item.get('label'))
                                elif isinstance(item, str):
                                    blocks.append(item)
                        
                        levels.append({
                            'level_id': level.get('level_id') or level.get('id') or str(idx),
                            'level_name': level.get('title', ''),
                            'blocks': blocks
                        })
                
                if levels:
                    base['levels'] = levels
            
            # Map booleans
            if 'sequence_within_level_matters' not in base and 'order_inside_matters' in content:
                base['sequence_within_level_matters'] = content['order_inside_matters']
            
            if 'level_order_matters' not in base and 'level_order_matters' in content:
                base['level_order_matters'] = content['level_order_matters']

            return base
            
        return base
    
    # =========================================================================
    # МОДУЛИ
    # =========================================================================
    
    def load_modules(self) -> List[Dict[str, Any]]:
        """
        Загрузить все доступные модули.
        
        Returns:
            List[Dict]: Список модулей
        
        Example:
            >>> modules = storage.load_modules()
            >>> for module in modules:
            ...     print(module['id'], module['name'])
        """
        # Если есть кэш и он свежий (TTL 5 секунд), возвращаем его
        TTL_SECONDS = 5.0
        if self._modules_cache is not None and (time.time() - self._modules_cache_timestamp < TTL_SECONDS):
            return self._modules_cache
        
        modules = []
        
        if not self.modules_dir.exists():
            self.logger.warning(f"Modules directory not found: {self.modules_dir}")
            return modules
        
        # Проходим по всем директориям в modules
        self.logger.info(f"Scanning for modules in: {self.modules_dir}")
        for module_path in self.modules_dir.iterdir():
            if not module_path.is_dir():
                continue
            
            # Загружаем module.json
            module_json = module_path / "module.json"
            
            if module_json.exists():
                try:
                    with open(module_json, 'r', encoding='utf-8') as f:
                        module_data = json.load(f)
                    
                    self.logger.info(f"Found explicit module: {module_path.name}")
                    # Проверяем, есть ли уже темы в module.json (старый формат)
                    if 'topics' not in module_data or not module_data['topics']:
                        # Если нет, загружаем темы из отдельных файлов (новый формат)
                        topics = self._load_topics(module_path)
                        module_data['topics'] = topics
                    else:
                        # Дополнительно обогащаем задания метаданными (created_at и др.)
                        # и подтягиваем topic-level theory_link из topic.json (если есть).
                        for topic in module_data.get('topics', []):
                            topic_id = topic.get('id')
                            topic_path = module_path / "topics" / topic_id if topic_id else None
                            topic['tasks'] = self._enrich_tasks_with_metadata(
                                topic.get('tasks', []),
                                module_path.name,
                                topic_path,
                            )
                            file_theory_link = self._read_topic_theory_link_from_file(topic_path)
                            if file_theory_link is not None:
                                topic['theory_link'] = file_theory_link
                            elif 'theory_link' in topic and topic.get('theory_link') is not None:
                                # Keep module.json value if topic.json is missing.
                                pass
                            else:
                                topic.pop('theory_link', None)
                    module_data = self._normalize_module_payload(module_data)
                    modules.append(module_data)
                    
                except Exception as e:
                    self.logger.error(f"Error loading module from {module_json}: {e}")
            else:
                 # Implicit module from directory
                 try:
                     self.logger.info(f"Checking implicit module: {module_path.name}")
                     topics = self._load_topics(module_path)
                     if topics: # Only add if we found topics (or if we want to show empty modules?)
                         self.logger.info(f"Found implicit module with {len(topics)} topics: {module_path.name}")
                         module_data = {
                             "id": module_path.name,
                             "name": module_path.name,
                             "topics": topics
                         }
                         module_data = self._normalize_module_payload(module_data)
                         modules.append(module_data)
                     else:
                         self.logger.info(f"Implicit module {module_path.name} has no topics, skipping.")
                 except Exception as e:
                     self.logger.error(f"Error loading implicit module from {module_path}: {e}")
        
        # Сохраняем в кэш
        self.logger.info(f"Total modules loaded: {len(modules)}")
        self._modules_cache = modules
        self._modules_cache_timestamp = time.time()
        return modules
    
    def _load_topics(self, module_path: Path) -> List[Dict[str, Any]]:
        """
        Загрузить темы из модуля.
        
        Args:
            module_path: Путь к директории модуля
        
        Returns:
            List[Dict]: Список тем
        """
        topics = []
        topics_dir = module_path / "topics"
        topic_dirs: List[Path] = []

        if topics_dir.exists():
            topic_dirs = [p for p in topics_dir.iterdir() if p.is_dir()]
        else:
            self.logger.info(f"Topics dir not found: {topics_dir}. Trying legacy layout in {module_path}")
            exclusions = {"images", "assets", "static", "__pycache__", "tasks"}
            for candidate in module_path.iterdir():
                if not candidate.is_dir():
                    continue
                if candidate.name in exclusions:
                    continue
                topic_dirs.append(candidate)
        
        for topic_path in topic_dirs:
            if not topic_path.is_dir():
                continue
            
            # Загружаем topic.json
            topic_json = topic_path / "topic.json"
            
            if topic_json.exists():
                try:
                    with open(topic_json, 'r', encoding='utf-8') as f:
                        topic_data = json.load(f)
                    
                    # Загружаем задания темы
                    tasks = self._load_tasks_metadata(module_path.name, topic_path)
                    topic_data['tasks'] = tasks
                    topic_data = self._normalize_topic_payload(module_path.name, topic_data)
                    topics.append(topic_data)
                    
                except Exception as e:
                    self.logger.error(f"Error loading topic from {topic_json}: {e}")
            else:
                # Implicit topic from directory
                try:
                    tasks = self._load_tasks_metadata(module_path.name, topic_path)
                    if tasks: # Only add if we found tasks (or if we want to show empty modules?)
                        self.logger.info(f"Found implicit topic: {topic_path.name} with {len(tasks)} tasks")
                        topic_data = {
                            "id": topic_path.name,
                            "name": topic_path.name,
                            "tasks": tasks
                        }
                        topic_data = self._normalize_topic_payload(module_path.name, topic_data)
                        topics.append(topic_data)
                    else:
                        self.logger.info(f"Implicit topic {topic_path.name} has no tasks, skipping.")
                except Exception as e:
                    self.logger.error(f"Error loading implicit topic from {topic_path}: {e}")
        
        return topics
    
    def _load_tasks_metadata(self, module_id: str, topic_path: Path) -> List[Dict[str, Any]]:
        """
        Загрузить метаданные заданий темы.
        
        Args:
            topic_path: Путь к директории темы
        
        Returns:
            List[Dict]: Список метаданных заданий
        """
        tasks = []
        tasks_dir = topic_path / "tasks"
        task_dirs: List[Path] = []

        if tasks_dir.exists():
            task_dirs = [p for p in tasks_dir.iterdir() if p.is_dir()]
            self.logger.info(f"Scanning tasks in: {tasks_dir}")
        else:
            self.logger.info(f"Tasks dir not found: {tasks_dir}. Trying legacy layout in {topic_path}")
            task_dirs = [p for p in topic_path.iterdir() if p.is_dir()]
        
        for task_path in task_dirs:
            if not task_path.is_dir():
                continue
            
            # Загружаем task.json для получения метаданных
            task_json = task_path / "task.json"
            if not task_json.exists():
                # Try finding any .json that looks like a task if we want to be super robust for legacy?
                # For now just skip if no task.json
                self.logger.info(f"Skipping task {task_path.name}: no task.json")
                continue
            
            try:
                with open(task_json, 'r', encoding='utf-8') as f:
                    try:
                        task_data = json.load(f)
                    except json.JSONDecodeError:
                        self.logger.warning(f"Invalid JSON in {task_json}")
                        continue
                
                # Извлекаем метаданные (id, name, type и т.д.)
                meta = {**task_data.get('meta', {}), **task_data.get('metadata', {})}
                created_at = (
                    meta.get('created_at')
                    or meta.get('created')
                    or datetime.fromtimestamp(task_json.stat().st_ctime).isoformat()
                )

                # Calculate relative path for reliable loading
                try:
                    rel_path = task_json.relative_to(self.data_dir)
                    path_str = str(rel_path).replace('\\', '/')
                except ValueError:
                    # Fallback if not relative (shouldn't happen usually)
                    path_str = str(task_json)

                canonical_task_id = str(meta.get('id') or task_path.name)
                canonical_task_name = meta.get('name') or task_data.get('name') or task_path.name

                legacy_task_id = str(task_data.get('id') or '').strip()

                metadata = {
                    'id': canonical_task_id,
                    'name': canonical_task_name,
                    'type': task_data.get('type', meta.get('type', 'unknown')),
                    'subtype': task_data.get('subtype'),
                    'description': task_data.get('description', ''),
                    'created_at': created_at,
                    'path': path_str,
                }
                for field_name in (
                    "source_catalog_item_id",
                    "source_catalog_version_id",
                    "source_entity_kind",
                    "source_entity_id",
                ):
                    if meta.get(field_name) is not None:
                        metadata[field_name] = meta.get(field_name)
                for field_name in (
                    "created_by_user_id",
                    "updated_by_user_id",
                    "created_via",
                    "content_scope",
                ):
                    if meta.get(field_name) is not None:
                        metadata[field_name] = meta.get(field_name)
                if legacy_task_id and legacy_task_id != canonical_task_id:
                    metadata['legacy_id'] = legacy_task_id
                metadata = self._normalize_task_metadata(module_id, topic_path.name, metadata)
                tasks.append(metadata)
                
            except Exception as e:
                self.logger.error(f"Error loading task metadata from {task_json}: {e}")
        
        self.logger.info(f"Found {len(tasks)} tasks in {topic_path.name}")
        return tasks
    
    def _enrich_tasks_with_metadata(
        self,
        tasks: Optional[List[Dict[str, Any]]],
        module_id: str,
        topic_path: Optional[Path]
    ) -> List[Dict[str, Any]]:
        """
        Обогатить задачи из module.json актуальными метаданными из task.json.
        """
        if not tasks:
            return []
        
        enriched: List[Dict[str, Any]] = []
        for task in tasks:
            metadata = dict(task) if isinstance(task, dict) else {}
            task_json_path: Optional[Path] = None
            
            path_value = metadata.get('path')
            if path_value:
                try:
                    task_json_path = self._resolve_task_path(path_value)
                except Exception:
                    task_json_path = None
            elif topic_path and metadata.get('id'):
                task_json_path = topic_path / "tasks" / metadata['id'] / "task.json"
            
            if task_json_path and task_json_path.exists():
                try:
                    with open(task_json_path, 'r', encoding='utf-8') as f:
                        task_data = json.load(f)
                    meta = {**task_data.get('meta', {}), **task_data.get('metadata', {})} if isinstance(task_data, dict) else {}
                    created_at = (
                        meta.get('created_at')
                        or meta.get('created')
                        or datetime.fromtimestamp(task_json_path.stat().st_ctime).isoformat()
                    )
                    metadata.update({
                        'id': meta.get('id') or task_json_path.parent.name or metadata.get('id'),
                        'name': meta.get('name') or task_data.get('name') or metadata.get('name'),
                        'type': task_data.get('type', metadata.get('type', 'unknown')),
                        'subtype': task_data.get('subtype', metadata.get('subtype')),
                        'description': task_data.get('description', metadata.get('description', '')),
                        'created_at': created_at,
                        'author': task_data.get('author', metadata.get('author')),
                    })
                    for field_name in (
                        "source_catalog_item_id",
                        "source_catalog_version_id",
                        "source_entity_kind",
                        "source_entity_id",
                    ):
                        if meta.get(field_name) is not None:
                            metadata[field_name] = meta.get(field_name)
                    for field_name in (
                        "created_by_user_id",
                        "updated_by_user_id",
                        "created_via",
                        "content_scope",
                    ):
                        if meta.get(field_name) is not None:
                            metadata[field_name] = meta.get(field_name)
                    legacy_task_id = str(task_data.get('id') or '').strip()
                    if legacy_task_id and legacy_task_id != metadata.get('id'):
                        metadata['legacy_id'] = legacy_task_id
                except Exception as exc:
                    self.logger.warning(f"Failed to enrich task metadata from {task_json_path}: {exc}")
            resolved_module_id = str(module_id or metadata.get("module") or "").strip()
            topic_id = topic_path.name if topic_path else str(metadata.get("topic") or "").strip()
            if resolved_module_id and topic_id:
                metadata = self._normalize_task_metadata(resolved_module_id, topic_id, metadata)
            enriched.append(metadata)
        
        return enriched

    def _read_topic_theory_link_from_file(self, topic_path: Optional[Path]) -> Optional[Dict[str, Any]]:
        """
        Read topic-level theory link from topic.json if available.
        Returns None when there is no link or file is absent.
        """
        if not topic_path:
            return None
        topic_json_path = topic_path / "topic.json"
        if not topic_json_path.exists():
            return None
        try:
            with open(topic_json_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            theory_link = data.get("theory_link")
            if isinstance(theory_link, dict):
                return dict(theory_link)
            return None
        except Exception as exc:
            self.logger.warning(f"Failed to read topic theory_link from {topic_json_path}: {exc}")
            return None
    
    def get_module(self, module_id: str) -> Optional[Dict[str, Any]]:
        """
        Получить модуль по ID.
        
        Args:
            module_id: ID модуля
        
        Returns:
            Dict или None если не найден
        """
        self._validate_id(module_id, "module_id")
        modules = self.load_modules()
        
        for module in modules:
            if module.get('id') == module_id:
                return self._normalize_module_payload(module)

        return None

    def create_module(
        self,
        module_id: str,
        name: str,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        self._validate_id(module_id, "module_id")
        clean_name = str(name or "").strip()
        if not clean_name:
            return False

        module_dir = self.modules_dir / module_id
        if module_dir.exists():
            return False

        module_dir.mkdir(parents=True, exist_ok=False)
        payload: Dict[str, Any] = {"id": module_id, "name": clean_name, "topics": []}
        payload = self._apply_workspace_meta_fields(payload, workspace_meta)
        payload = self._normalize_graph_ownership_fields(
            payload,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        payload = self._normalize_module_payload(payload)
        with open(module_dir / "module.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        self.reload_modules()
        return True

    def ensure_module_workspace_copy(
        self,
        *,
        module_name: str,
        preferred_module_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
        prefer_existing_by_lineage: bool = True,
    ) -> Dict[str, Any]:
        if prefer_existing_by_lineage and build_source_lineage_key(workspace_meta or {}):
            existing = self.find_module_by_source_lineage(
                source_catalog_item_id=(workspace_meta or {}).get("source_catalog_item_id"),
                source_catalog_version_id=(workspace_meta or {}).get("source_catalog_version_id"),
                source_entity_kind=(workspace_meta or {}).get("source_entity_kind") or "module",
                source_entity_id=(workspace_meta or {}).get("source_entity_id"),
            )
            if isinstance(existing, dict):
                return {
                    "created": False,
                    "reused": True,
                    "module_id": existing.get("id"),
                    "item": existing,
                }

        module_id = self.reserve_module_id(module_name, preferred_module_id=preferred_module_id)
        created = self.create_module(module_id, module_name, workspace_meta=workspace_meta)
        if not created:
            raise ValueError("module_create_failed")
        return {
            "created": True,
            "reused": False,
            "module_id": module_id,
            "item": self.get_module(module_id),
        }
    
    # =========================================================================
    # ТЕМЫ
    # =========================================================================
    
    def get_topics(self, module_id: str) -> List[Dict[str, Any]]:
        """
        Получить темы модуля.
        
        Args:
            module_id: ID модуля
        
        Returns:
            List[Dict]: Список тем
        
        Example:
            >>> topics = storage.get_topics("anatomy")
            >>> for topic in topics:
            ...     print(topic['id'], topic['name'])
        """
        self._validate_id(module_id, "module_id")
        module = self.get_module(module_id)
        if not module:
            return []
        
        # NavigationManager хранит темы в module['topics']
        return [
            self._normalize_topic_payload(module_id, topic)
            for topic in module.get('topics', [])
            if isinstance(topic, dict)
        ]

    def create_topic(
        self,
        module_id: str,
        topic_id: str,
        name: str,
        theory_link: Optional[Dict[str, Any]] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> bool:
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        clean_name = str(name or "").strip()
        if not clean_name:
            return False

        module_dir = self.modules_dir / module_id
        if not module_dir.exists():
            return False

        topic_dir = module_dir / "topics" / topic_id
        if topic_dir.exists():
            return False

        topic_dir.mkdir(parents=True, exist_ok=False)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)
        payload: Dict[str, Any] = {"id": topic_id, "name": clean_name, "tasks": []}
        if isinstance(theory_link, dict):
            payload["theory_link"] = dict(theory_link)
        payload = self._apply_workspace_meta_fields(payload, workspace_meta)
        payload = self._normalize_graph_ownership_fields(
            payload,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        payload = self._normalize_topic_payload(module_id, payload)
        with open(topic_dir / "topic.json", "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
        self.reload_modules()
        return True
    
    def get_topic(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        """
        Получить тему по ID.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            Dict или None если не найдена
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        topics = self.get_topics(module_id)
        
        for topic in topics:
            if topic['id'] == topic_id:
                return self._normalize_topic_payload(module_id, topic)
        
        return None

    def find_module_by_source_lineage(
        self,
        *,
        source_catalog_item_id: Any = None,
        source_catalog_version_id: Any = None,
        source_entity_kind: Any = "module",
        source_entity_id: Any = None,
    ) -> Optional[Dict[str, Any]]:
        return find_first_by_source_lineage(
            self.load_modules(),
            source_catalog_item_id=source_catalog_item_id,
            source_catalog_version_id=source_catalog_version_id,
            source_entity_kind=source_entity_kind,
            source_entity_id=source_entity_id,
        )

    def _topic_json_path(self, module_id: str, topic_id: str) -> Path:
        return self.modules_dir / module_id / "topics" / topic_id / "topic.json"

    def get_topic_theory_link(self, module_id: str, topic_id: str) -> Optional[Dict[str, Any]]:
        """
        Return topic-level theory_link if set.
        Prefers topic.json as source of truth, falls back to cached topic payload.
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")

        topic_json_path = self._topic_json_path(module_id, topic_id)
        if topic_json_path.exists():
            try:
                with open(topic_json_path, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                theory_link = data.get("theory_link")
                if isinstance(theory_link, dict):
                    return dict(theory_link)
                return None
            except Exception as exc:
                self.logger.warning(f"Failed to read topic theory link from {topic_json_path}: {exc}")

        topic = self.get_topic(module_id, topic_id)
        if isinstance(topic, dict) and isinstance(topic.get("theory_link"), dict):
            return dict(topic.get("theory_link"))
        return None

    def set_topic_theory_link(
        self,
        module_id: str,
        topic_id: str,
        theory_link: Optional[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        Set or clear topic-level theory_link in topic.json (source of truth).
        Also mirrors value into module.json topic entry when present.
        """
        import shutil
        import tempfile

        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")

        topic = self.get_topic(module_id, topic_id)
        if not topic:
            raise ValueError("topic_not_found")

        topic_json_path = self._topic_json_path(module_id, topic_id)
        topic_json_path.parent.mkdir(parents=True, exist_ok=True)

        payload: Dict[str, Any] = {}
        if topic_json_path.exists():
            try:
                with open(topic_json_path, "r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    payload = loaded
            except Exception:
                payload = {}

        if not isinstance(payload, dict):
            payload = {}

        # Keep core fields stable even for partially broken legacy files.
        payload["id"] = payload.get("id") or topic_id
        payload["name"] = payload.get("name") or topic.get("name") or topic_id
        if not isinstance(payload.get("tasks"), list):
            payload["tasks"] = topic.get("tasks") if isinstance(topic.get("tasks"), list) else []

        if isinstance(theory_link, dict):
            payload["theory_link"] = dict(theory_link)
        else:
            payload.pop("theory_link", None)
        payload = self._normalize_topic_payload(module_id, payload)

        with tempfile.NamedTemporaryFile(
            mode="w",
            dir=topic_json_path.parent,
            delete=False,
            encoding="utf-8",
            suffix=".tmp",
        ) as tf:
            json.dump(payload, tf, ensure_ascii=False, indent=2)
            temp_name = tf.name
        shutil.move(temp_name, str(topic_json_path))

        # Mirror theory_link into module.json topic entry (best-effort).
        module_json_path = self.modules_dir / module_id / "module.json"
        if module_json_path.exists():
            try:
                with open(module_json_path, "r", encoding="utf-8") as fh:
                    module_data = json.load(fh)
                topics = module_data.get("topics")
                changed = False
                if isinstance(topics, list):
                    for index, row in enumerate(topics):
                        if not isinstance(row, dict):
                            continue
                        if row.get("id") != topic_id:
                            continue
                        if isinstance(theory_link, dict):
                            row["theory_link"] = dict(theory_link)
                        else:
                            row.pop("theory_link", None)
                        topics[index] = self._normalize_topic_payload(module_id, row)
                        changed = True
                        break
                if changed:
                    with tempfile.NamedTemporaryFile(
                        mode="w",
                        dir=module_json_path.parent,
                        delete=False,
                        encoding="utf-8",
                        suffix=".tmp",
                    ) as tf:
                        json.dump(module_data, tf, ensure_ascii=False, indent=2)
                        temp_name = tf.name
                    shutil.move(temp_name, str(module_json_path))
            except Exception as exc:
                self.logger.warning(f"Failed to mirror topic theory_link into module.json: {exc}")

        self._modules_cache = None
        return payload
    
    # =========================================================================
    # ЗАДАНИЯ
    # =========================================================================
    
    def get_tasks(self, module_id: str, topic_id: str) -> List[Dict[str, Any]]:
        """
        Получить задания темы.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
        
        Returns:
            List[Dict]: Список заданий (метаданные)
        
        Example:
            >>> tasks = storage.get_tasks("anatomy", "liver")
            >>> for task in tasks:
            ...     print(task['id'], task.get('name', 'Unnamed'))
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        topic = self.get_topic(module_id, topic_id)
        if not topic:
            return []
        
        # Темы хранят задания в topic['tasks']
        tasks = topic.get('tasks', [])
        return [
            self._normalize_task_metadata(module_id, topic_id, task)
            for task in tasks
            if isinstance(task, dict)
        ]

    def find_topic_by_source_lineage(
        self,
        *,
        source_catalog_item_id: Any = None,
        source_catalog_version_id: Any = None,
        source_entity_kind: Any = "topic",
        source_entity_id: Any = None,
    ) -> Optional[Dict[str, Any]]:
        for module in self.load_modules():
            if not isinstance(module, dict):
                continue
            topics = module.get("topics") or []
            match = find_first_by_source_lineage(
                topics,
                source_catalog_item_id=source_catalog_item_id,
                source_catalog_version_id=source_catalog_version_id,
                source_entity_kind=source_entity_kind,
                source_entity_id=source_entity_id,
            )
            if isinstance(match, dict):
                module_id = str(module.get("id") or "").strip()
                if module_id:
                    return self._normalize_topic_payload(module_id, match)
        return None

    def ensure_topic_workspace_copy(
        self,
        *,
        module_id: str,
        topic_name: str,
        preferred_topic_id: Optional[str] = None,
        theory_link: Optional[Dict[str, Any]] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
        prefer_existing_by_lineage: bool = True,
    ) -> Dict[str, Any]:
        if prefer_existing_by_lineage and build_source_lineage_key(workspace_meta or {}):
            existing = self.find_topic_by_source_lineage(
                source_catalog_item_id=(workspace_meta or {}).get("source_catalog_item_id"),
                source_catalog_version_id=(workspace_meta or {}).get("source_catalog_version_id"),
                source_entity_kind=(workspace_meta or {}).get("source_entity_kind") or "topic",
                source_entity_id=(workspace_meta or {}).get("source_entity_id"),
            )
            if isinstance(existing, dict):
                existing_module_id = str(existing.get("module_id") or existing.get("module") or "").strip() or module_id
                return {
                    "created": False,
                    "reused": True,
                    "module_id": existing_module_id,
                    "topic_id": existing.get("id"),
                    "item": existing,
                }

        topic_id = self.reserve_topic_id(
            module_id,
            topic_name,
            preferred_topic_id=preferred_topic_id,
        )
        created = self.create_topic(
            module_id,
            topic_id,
            topic_name,
            theory_link=theory_link,
            workspace_meta=workspace_meta,
        )
        if not created:
            raise ValueError("topic_create_failed")
        return {
            "created": True,
            "reused": False,
            "module_id": module_id,
            "topic_id": topic_id,
            "item": self.get_topic(module_id, topic_id),
        }

    def find_task_by_source_lineage(
        self,
        *,
        source_catalog_item_id: Any = None,
        source_catalog_version_id: Any = None,
        source_entity_kind: Any = "task",
        source_entity_id: Any = None,
    ) -> Optional[Dict[str, Any]]:
        for module in self.load_modules():
            if not isinstance(module, dict):
                continue
            module_id = str(module.get("id") or "").strip()
            if not module_id:
                continue
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = str(topic.get("id") or "").strip()
                if not topic_id:
                    continue
                match = find_first_by_source_lineage(
                    topic.get("tasks") or [],
                    source_catalog_item_id=source_catalog_item_id,
                    source_catalog_version_id=source_catalog_version_id,
                    source_entity_kind=source_entity_kind,
                    source_entity_id=source_entity_id,
                )
                if isinstance(match, dict):
                    return self._normalize_task_metadata(module_id, topic_id, match)
        return None

    def ensure_task_workspace_copy(
        self,
        *,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str,
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
        bootstrap_only: bool = False,
        prefer_existing_by_lineage: bool = True,
    ) -> Dict[str, Any]:
        if prefer_existing_by_lineage and build_source_lineage_key(workspace_meta or {}):
            existing = self.find_task_by_source_lineage(
                source_catalog_item_id=(workspace_meta or {}).get("source_catalog_item_id"),
                source_catalog_version_id=(workspace_meta or {}).get("source_catalog_version_id"),
                source_entity_kind=(workspace_meta or {}).get("source_entity_kind") or "task",
                source_entity_id=(workspace_meta or {}).get("source_entity_id"),
            )
            if isinstance(existing, dict):
                existing_task_id = str(existing.get("id") or "").strip()
                existing_module_id = str(existing.get("module_id") or existing.get("module") or "").strip() or module_id
                existing_topic_id = str(existing.get("topic_id") or existing.get("topic") or "").strip() or topic_id
                return {
                    "created": False,
                    "reused": True,
                    "task_id": existing_task_id,
                    "module_id": existing_module_id,
                    "topic_id": existing_topic_id,
                    "item": existing,
                    "task": self.load_task(existing_module_id, existing_topic_id, existing_task_id)
                    if existing_task_id
                    else None,
                }

        reserved_task_id = self.reserve_task_id(
            module_id,
            topic_id,
            task_name,
            preferred_task_id=preferred_task_id,
        )
        if bootstrap_only:
            bootstrap = self.build_task_draft_bootstrap(
                module_id,
                topic_id,
                task_name,
                task_type,
                preferred_task_id=reserved_task_id,
                workspace_meta=workspace_meta,
            )
            return {
                "created": True,
                "reused": False,
                "task_id": bootstrap.get("task_id"),
                "module_id": module_id,
                "topic_id": topic_id,
                "item": bootstrap.get("task", {}).get("metadata") if isinstance(bootstrap.get("task"), dict) else None,
                "bootstrap": bootstrap,
            }

        task_id = self.create_task(
            module_id,
            topic_id,
            task_name,
            task_type,
            preferred_task_id=reserved_task_id,
            workspace_meta=workspace_meta,
        )
        if not task_id:
            raise ValueError("task_create_failed")
        return {
            "created": True,
            "reused": False,
            "task_id": task_id,
            "module_id": module_id,
            "topic_id": topic_id,
            "item": self.find_task_by_source_lineage(
                source_catalog_item_id=(workspace_meta or {}).get("source_catalog_item_id"),
                source_catalog_version_id=(workspace_meta or {}).get("source_catalog_version_id"),
                source_entity_kind=(workspace_meta or {}).get("source_entity_kind") or "task",
                source_entity_id=(workspace_meta or {}).get("source_entity_id"),
            )
            if build_source_lineage_key(workspace_meta or {})
            else next(
                (task for task in self.get_tasks(module_id, topic_id) if str(task.get("id") or "") == task_id),
                None,
            ),
            "task": self.load_task(module_id, topic_id, task_id),
        }

    def _write_task_answer_key(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        answer_key: Dict[str, Any],
    ) -> None:
        task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_dir.mkdir(parents=True, exist_ok=True)
        answer_key_path = task_dir / "answer_key.json"
        payload = self._convert_datetime_to_str(answer_key if isinstance(answer_key, dict) else {})
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                dir=str(task_dir),
                delete=False,
                encoding="utf-8",
                suffix=".tmp",
            ) as tf:
                json.dump(payload, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, str(answer_key_path))
        finally:
            if temp_name and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass

    def _sync_task_content_after_materialization(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
    ) -> None:
        sync_method = getattr(self, "_sync_task_content_from_shadow", None)
        if not callable(sync_method):
            return
        try:
            sync_method(module_id, topic_id, task_id, import_only=False)
        except TypeError:
            sync_method(module_id, topic_id, task_id)

    def _prepare_materialized_task_payload(
        self,
        source_task: Dict[str, Any],
        *,
        module_id: str,
        topic_id: str,
        task_id: str,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        task_data = copy.deepcopy(source_task.get("task_data") or {})
        if not isinstance(task_data, dict):
            raise ValueError("source_task_data_missing")

        meta = task_data.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            task_data["meta"] = meta

        source_metadata = source_task.get("metadata")
        task_name = (
            meta.get("name")
            or task_data.get("name")
            or (source_metadata.get("name") if isinstance(source_metadata, dict) else None)
            or task_id
        )

        task_data["id"] = task_id
        task_data["name"] = task_name
        meta["id"] = task_id
        meta["module"] = module_id
        meta["topic"] = topic_id
        meta["name"] = task_name

        meta = self._apply_workspace_meta_fields(meta, workspace_meta)
        meta = self._normalize_graph_ownership_fields(
            meta,
            fallback_source="workspace_import",
            fallback_scope="workspace_private",
        )

        task_data["meta"] = normalize_workspace_lineage_fields(
            meta,
            entity_kind="task",
            entity_id=task_id,
            entity_ref=f"{module_id}/{topic_id}/{task_id}",
        )
        return task_data

    def materialize_task_workspace_copy(
        self,
        *,
        module_id: str,
        topic_id: str,
        source_task: Dict[str, Any],
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
        prefer_existing_by_lineage: bool = True,
        validate: bool = True,
    ) -> Dict[str, Any]:
        if not isinstance(source_task, dict):
            raise ValueError("source_task_payload_required")

        source_task_data = source_task.get("task_data")
        if not isinstance(source_task_data, dict):
            raise ValueError("source_task_data_missing")

        source_meta = source_task_data.get("meta") if isinstance(source_task_data.get("meta"), dict) else {}
        source_metadata = source_task.get("metadata")
        task_name = (
            source_meta.get("name")
            or source_task_data.get("name")
            or (source_metadata.get("name") if isinstance(source_metadata, dict) else None)
            or preferred_task_id
            or "Imported task"
        )
        task_type = str(source_task_data.get("type") or source_task_data.get("task_type") or "").strip()
        if not task_type:
            raise ValueError("source_task_type_missing")

        ensure_result = self.ensure_task_workspace_copy(
            module_id=module_id,
            topic_id=topic_id,
            task_name=task_name,
            task_type=task_type,
            preferred_task_id=preferred_task_id,
            workspace_meta=workspace_meta,
            bootstrap_only=True,
            prefer_existing_by_lineage=prefer_existing_by_lineage,
        )
        if ensure_result.get("reused"):
            return ensure_result

        target_task_id = str(ensure_result.get("task_id") or "").strip()
        if not target_task_id:
            raise ValueError("task_id_reservation_failed")

        prepared_task_data = self._prepare_materialized_task_payload(
            source_task,
            module_id=module_id,
            topic_id=topic_id,
            task_id=target_task_id,
            workspace_meta=workspace_meta,
        )
        if not self.save_task(module_id, topic_id, target_task_id, prepared_task_data, validate=validate):
            raise ValueError("task_materialization_save_failed")

        source_answer_key = source_task.get("answer_key")
        normalized_answer_key = self._normalize_answer_key(
            prepared_task_data,
            source_answer_key if isinstance(source_answer_key, dict) else {},
        )
        self._write_task_answer_key(module_id, topic_id, target_task_id, normalized_answer_key)
        self._sync_task_content_after_materialization(module_id, topic_id, target_task_id)

        return {
            "created": True,
            "reused": False,
            "task_id": target_task_id,
            "module_id": module_id,
            "topic_id": topic_id,
            "item": next(
                (task for task in self.get_tasks(module_id, topic_id) if str(task.get("id") or "") == target_task_id),
                None,
            ),
            "task": self.load_task(module_id, topic_id, target_task_id),
        }
    
    def load_task(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Загрузить полные данные задания (task.json + answer_key.json).
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            Dict с ключами: 'task_data', 'answer_key', 'metadata'
            Или None если не найдено
        
        Example:
            >>> task = storage.load_task("anatomy", "liver", "liver_click_01")
            >>> task_data = task['task_data']
            >>> answer_key = task['answer_key']
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")

        def _ensure_route_context(payload: Dict[str, Any]) -> Dict[str, Any]:
            if not isinstance(payload, dict):
                return payload

            metadata_obj = payload.get("metadata")
            if not isinstance(metadata_obj, dict):
                metadata_obj = {}
                payload["metadata"] = metadata_obj
            if not metadata_obj.get("id"):
                metadata_obj["id"] = task_id
            if not metadata_obj.get("module"):
                metadata_obj["module"] = module_id
            if not metadata_obj.get("topic"):
                metadata_obj["topic"] = topic_id

            task_data_obj = payload.get("task_data")
            if isinstance(task_data_obj, dict):
                meta_obj = task_data_obj.get("meta")
                if not isinstance(meta_obj, dict):
                    meta_obj = {}
                    task_data_obj["meta"] = meta_obj
                if not meta_obj.get("id"):
                    meta_obj["id"] = task_id
                if not meta_obj.get("module"):
                    meta_obj["module"] = module_id
                if not meta_obj.get("topic"):
                    meta_obj["topic"] = topic_id
                if task_data_obj.get("name") and not meta_obj.get("name"):
                    meta_obj["name"] = task_data_obj.get("name")
                meta_obj = self._normalize_graph_ownership_fields(
                    meta_obj,
                    existing=metadata_obj,
                    fallback_source="legacy_unknown",
                    fallback_scope="shared_local",
                )
                task_data_obj["meta"] = normalize_workspace_lineage_fields(
                    meta_obj,
                    entity_kind="task",
                    entity_id=task_id,
                    entity_ref=f"{module_id}/{topic_id}/{task_id}",
                )

            metadata_obj = self._normalize_graph_ownership_fields(
                metadata_obj,
                existing=(
                    task_data_obj.get("meta")
                    if isinstance(task_data_obj, dict) and isinstance(task_data_obj.get("meta"), dict)
                    else None
                ),
                fallback_source="legacy_unknown",
                fallback_scope="shared_local",
            )
            payload["metadata"] = normalize_workspace_lineage_fields(
                metadata_obj,
                entity_kind="task",
                entity_id=task_id,
                entity_ref=f"{module_id}/{topic_id}/{task_id}",
            )

            return payload

        # Сначала пробуем стандартный путь
        task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        
        # Получаем метаданные задания для поиска альтернативного пути
        tasks = self.get_tasks(module_id, topic_id)
        metadata = None
        for task in tasks:
            if task['id'] == task_id:
                metadata = task
                break
        
        # Если в метаданных есть путь, используем его
        if metadata and 'path' in metadata:
            task_json_path = self._resolve_task_path(metadata['path'])
            task_dir = task_json_path.parent
        else:
            task_json_path = task_dir / "task.json"
        
        if not task_dir.exists():
            self.logger.warning(f"Task directory not found: {task_dir}")
            return None
        
        # Загружаем task.json
        if not task_json_path.exists():
            self.logger.warning(f"task.json not found: {task_json_path}")
            return None
        
        # Use TaskLoader if available for validation
        if self.task_loader:
            try:
                result = self.task_loader.load_task(task_json_path)
                # Merge metadata from module.json with validated metadata
                if metadata:
                    for k, v in metadata.items():
                        if k == 'id' and result['metadata'].get('id') == v:
                            continue
                        if v is None and result['metadata'].get(k) is not None:
                            continue
                        result['metadata'][k] = v
                # Добавляем task_dir, чтобы web-слой мог формировать пути к ресурсам (картинкам)
                result['task_dir'] = str(task_dir)

                try:
                    td = result.get('task_data')
                    ak = result.get('answer_key')
                    if isinstance(td, dict) and isinstance(ak, dict):
                        result['answer_key'] = self._normalize_answer_key(td, ak)
                except Exception:
                    self.logger.exception("Failed to normalize answer_key")
                result = _ensure_route_context(result)
                return self._convert_datetime_to_str(result)
            except TaskValidationError as e:
                self.logger.error(f"Task validation failed for {task_json_path}: {e}")
                # Fallback to old method in lenient mode
                if self.task_loader.strict_mode:
                    raise
            except TaskLoadError:
                # Re-raise TaskLoadError as is
                raise
            except Exception as e:
                self.logger.warning(f"TaskLoader failed for {task_json_path}: {e}. Using fallback.")
                # Обертываем неожиданные ошибки в TaskLoadError
                if TASK_LOADER_AVAILABLE and TaskLoadError:
                    raise TaskLoadError(
                        f"Error loading task: {e}",
                        details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id, 'path': str(task_json_path), 'error_type': type(e).__name__}
                    ) from e
        
        # Fallback to old method (without validation)
        try:
            with open(task_json_path, 'r', encoding='utf-8') as f:
                task_data = json.load(f)
        except FileNotFoundError as e:
            self.logger.error(f"Task file not found: {task_json_path}")
            if TASK_LOADER_AVAILABLE and TaskLoadError:
                raise TaskLoadError(
                    f"Task file not found: {task_json_path}",
                    details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id, 'path': str(task_json_path)}
                ) from e
            return None
        except json.JSONDecodeError as e:
            self.logger.error(f"Invalid JSON in {task_json_path}: {e}")
            if TASK_LOADER_AVAILABLE and TaskLoadError:
                raise TaskLoadError(
                    f"Invalid JSON in {task_json_path}: {e}",
                    details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id, 'path': str(task_json_path), 'json_error': str(e)}
                ) from e
            return None
        except Exception as e:
            self.logger.exception(f"Error loading task.json from {task_json_path}")
            if TASK_LOADER_AVAILABLE and TaskLoadError:
                raise TaskLoadError(
                    f"Error loading task.json from {task_json_path}: {e}",
                    details={'module_id': module_id, 'topic_id': topic_id, 'task_id': task_id, 'path': str(task_json_path), 'error_type': type(e).__name__}
                ) from e
            return None
        
        # Загружаем answer_key.json (опционально)
        answer_key_path = task_dir / "answer_key.json"
        answer_key = {}
        
        if answer_key_path.exists():
            try:
                with open(answer_key_path, 'r', encoding='utf-8') as f:
                    answer_key = json.load(f)
            except json.JSONDecodeError as e:
                self.logger.warning(f"Invalid JSON in answer_key.json: {answer_key_path}: {e}")
                # Не выбрасываем исключение для answer_key, т.к. это опциональный файл
            except Exception as e:
                self.logger.warning(f"Error loading answer_key.json from {answer_key_path}: {e}")
                # Не выбрасываем исключение для answer_key, т.к. это опциональный файл

        try:
            if isinstance(task_data, dict) and isinstance(answer_key, dict):
                answer_key = self._normalize_answer_key(task_data, answer_key)
        except Exception:
            self.logger.exception("Failed to normalize answer_key")
        
        result = {
            'task_data': task_data,
            'answer_key': answer_key,
            'metadata': metadata or {'id': task_id},
            'task_dir': str(task_dir),
        }
        result = _ensure_route_context(result)
        return self._convert_datetime_to_str(result)

    def task_exists(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """Return True if task.json is present on disk — without loading its contents."""
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")
        task_json = (
            self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"
        )
        return task_json.exists()

    def _resolve_task_path(self, path: str) -> Path:
        """
        Преобразовать относительный путь к заданию в абсолютный.
        
        Поддерживает различные форматы путей:
        - "../data/modules/..." - старый формат (обратная совместимость)
        - "data/modules/..." - формат от корня проекта (обратная совместимость)
        - "modules/..." - новый нормализованный формат (относительно data_dir)
        - Относительные пути без префиксов
        - Абсолютные пути
        
        Args:
            path: Относительный путь (может начинаться с ../, data/, или быть без префикса)
        
        Returns:
            Path: Абсолютный путь к task.json
        """
        # Нормализуем разделители
        path = path.replace('\\', '/')
        
        # Если путь абсолютный, возвращаем как есть
        if os.path.isabs(path):
            return Path(path)
        
        # Обработка различных форматов путей для обратной совместимости
        if path.startswith('../data/'):
            # Старый формат: "../data/modules/..."
            # Убираем префикс и строим путь от self.data_dir
            normalized_path = path.replace('../data/', '', 1)
            return self.data_dir / normalized_path
        elif path.startswith('data/'):
            # Формат от корня проекта: "data/modules/..."
            # Убираем префикс и строим путь от self.data_dir
            normalized_path = path.replace('data/', '', 1)
            return self.data_dir / normalized_path
        elif path.startswith('modules/'):
            # Новый нормализованный формат: "modules/..."
            # Путь относительно self.data_dir
            return self.data_dir / path
        else:
            # Путь без префиксов или относительный путь
            # Пробуем разрешить относительно self.data_dir
            return self.data_dir / path
    
    # =========================================================================
    # УТИЛИТЫ
    # =========================================================================
    
    def get_image_path(self, relative_path: str) -> Path:
        """
        Получить полный путь к изображению.
        
        Args:
            relative_path: Относительный путь от data_dir
        
        Returns:
            Path: Абсолютный путь
        
        Example:
            >>> path = storage.get_image_path("modules/anatomy/topics/liver/images/liver.jpg")
            >>> print(path)
        """
        return self.data_dir / relative_path
    
    def reload_modules(self) -> None:
        """
        Перезагрузить модули из файловой системы.
        
        Полезно если модули были изменены во время работы приложения.
        """
        self._modules_cache = None
        self.load_modules()
        self.logger.info("Modules reloaded")

    # =========================================================================
    # СОХРАНЕНИЕ / ИЗМЕНЕНИЕ ДАННЫХ
    # =========================================================================

    def save_task(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
        task_data: Dict[str, Any],
        validate: bool = True
    ) -> bool:
        """
        Сохранить задание (атомарно).
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            task_data: Данные задания (словарь)
            validate: Использовать валидацию перед сохранением
            
        Returns:
            bool: Успех сохранения
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")

        try:
            if isinstance(task_data, dict):
                task_data = copy.deepcopy(task_data)
                meta = task_data.get("meta")
                if not isinstance(meta, dict):
                    meta = {}
                    task_data["meta"] = meta

                task_data["id"] = task_id
                meta["id"] = task_id
                meta["module"] = module_id
                meta["topic"] = topic_id

                task_name = meta.get("name") or task_data.get("name") or task_id
                meta["name"] = task_name
                task_data["name"] = task_name
                self._normalize_task_metadata_for_save(task_data)
                self._synchronize_click_threshold_fields(task_data)
                self._sanitize_open_answer_payload_for_save(task_data)
                task_data["meta"] = normalize_workspace_lineage_fields(
                    task_data.get("meta") if isinstance(task_data.get("meta"), dict) else {},
                    entity_kind="task",
                    entity_id=task_id,
                    entity_ref=f"{module_id}/{topic_id}/{task_id}",
                )

            # 1. Resolve path
            task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            
            if not task_dir.exists():
                self.logger.warning(f"Task directory not found for save: {task_dir}")
                # Optional: create if not exists? For update, we expect it to exist usually.
                # If it's a new task save, create_task should be used first or we allow creation here.
                # Let's fallback to creating dirs if missing
                task_dir.mkdir(parents=True, exist_ok=True)

            # 2. Copy/Normalize images
            self._copy_images_to_task_dir(task_dir, task_data)

            # 3. Save task.json using TaskIO (atomic)
            task_json_path = task_dir / "task.json"
            
            # Helper to convert dict to TaskData object if possible, or just pass dict if TaskIO supports it.
            # TaskIO.save expects TaskData object.
            try:
                from task_system.core.models.task_data import TaskData
                if isinstance(task_data, dict):
                    task_data_obj = TaskData.from_dict(task_data)
                else:
                    task_data_obj = task_data
            except Exception as e:
                self.logger.warning(f"Failed to convert dict to TaskData: {e}. Saving as raw dict if possible.")
                # TaskIO might not support raw dicts if it relies on .dict() or .model_dump()
                # Assuming TaskIO needs strict TaskData
                raise ValueError(f"Invalid task data structure: {e}")

            from task_system.core.io.task_io import TaskIO
            TaskIO.save(task_data_obj, str(task_json_path), validate=validate)
            self._postprocess_saved_open_answer_task(task_json_path)

            # 4. Update module.json (ensure registered)
            self._ensure_task_registered_in_module(module_id, topic_id, task_id, task_data)

            # 5. Invalidate cache
            self._modules_cache = None
            self.logger.info(f"Task saved successfully: {module_id}/{topic_id}/{task_id}")
            return True

        except Exception as e:
            self.logger.exception(f"Failed to save task {module_id}/{topic_id}/{task_id}: {e}")
            return False

    def _normalize_task_metadata_for_save(self, task_data: Dict[str, Any]) -> None:
        """Fill and normalize task metadata without dropping legacy keys."""
        if not isinstance(task_data, dict):
            return

        meta = task_data.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            task_data["meta"] = meta

        now_iso = datetime.now(timezone.utc).isoformat()
        created_at = meta.get("created_at") or meta.get("created") or now_iso
        created = meta.get("created") or created_at

        meta["created_at"] = created_at
        meta["created"] = created
        meta["modified"] = now_iso
        meta.setdefault("version", "1.0")
        meta.setdefault("task_schema_version", "1.2")

    def _synchronize_click_threshold_fields(self, task_data: Dict[str, Any]) -> None:
        """Keep click threshold in both legacy content.required_correct and canonical settings.success_threshold."""
        if not isinstance(task_data, dict):
            return
        if task_data.get("type") != "click":
            return

        content = task_data.get("content")
        if not isinstance(content, dict):
            content = {}
            task_data["content"] = content

        settings = task_data.get("settings")
        if not isinstance(settings, dict):
            settings = {}
            task_data["settings"] = settings

        if task_data.get("subtype") == "error_detection" or content.get("subtype") == "error_detection":
            settings.pop("success_threshold", None)
            return

        raw_candidates = [settings.get("success_threshold"), content.get("required_correct")]
        canonical_value = None
        for raw in raw_candidates:
            try:
                parsed = int(raw)
            except Exception:
                continue
            if parsed >= 1:
                canonical_value = parsed
                break

        if canonical_value is None:
            settings.pop("success_threshold", None)
            return

        settings["success_threshold"] = canonical_value
        content["required_correct"] = canonical_value

    def _sanitize_open_answer_payload_for_save(self, task_data: Dict[str, Any]) -> None:
        """Strip removed legacy fields and obvious null-only noise from new open_answer saves."""
        if not isinstance(task_data, dict):
            return
        if task_data.get("type") != "open_answer":
            return

        content = task_data.get("content")
        if not isinstance(content, dict):
            content = {}
            task_data["content"] = content

        settings = task_data.get("settings")
        if not isinstance(settings, dict):
            settings = {}
            task_data["settings"] = settings

        # Legacy partial-keyword threshold is no longer authored in the editor.
        content.pop("min_keywords", None)
        content.pop("require_all_keywords", None)

        # Remove null-only open_answer noise while preserving any meaningful values.
        for key in ("image", "hint", "sample_answers", "min_length", "max_length"):
            if key in content and content.get(key) is None:
                content.pop(key, None)

        # These settings belong to other task types; keep only if they carry a real value.
        for key in ("tolerancePx", "overlapThreshold", "success_threshold"):
            if key in settings and settings.get(key) is None:
                settings.pop(key, None)

    def _postprocess_saved_open_answer_task(self, task_json_path: Path) -> None:
        """Reapply open_answer cleanup to the serialized file because TaskIO writes optional null fields."""
        try:
            if not task_json_path.exists():
                return

            raw = json.loads(task_json_path.read_text(encoding="utf-8"))
            if not isinstance(raw, dict) or raw.get("type") != "open_answer":
                return

            before = json.dumps(raw, ensure_ascii=False, sort_keys=True)
            self._sanitize_open_answer_payload_for_save(raw)
            after = json.dumps(raw, ensure_ascii=False, sort_keys=True)
            if after == before:
                return

            task_json_path.write_text(
                json.dumps(raw, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            self.logger.warning("Failed to postprocess saved open_answer task %s: %s", task_json_path, exc)

    def reserve_task_id(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        preferred_task_id: Optional[str] = None,
    ) -> str:
        """Reserve a stable task id without creating task.json or registering it in catalog."""
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")

        if preferred_task_id:
            self._validate_id(preferred_task_id, "task_id")
            base_id = preferred_task_id
        else:
            base_id = secure_filename((task_name or "").lower().replace(" ", "_"))
            if not base_id:
                base_id = f"task_{uuid.uuid4().hex[:8]}"

        candidate = base_id
        suffix = 1
        while (self.modules_dir / module_id / "topics" / topic_id / "tasks" / candidate / "task.json").exists():
            candidate = f"{base_id}_{suffix:02d}"
            suffix += 1

        return candidate

    def build_task_draft_bootstrap(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str,
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build an unsaved task payload for draft-first editor flow."""
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")

        from task_system.core.io.task_io import TaskIO

        task_id = self.reserve_task_id(
            module_id,
            topic_id,
            task_name,
            preferred_task_id=preferred_task_id,
        )
        now_iso = datetime.now().isoformat()

        task_data_obj = TaskIO.new_task(task_type, name=task_name, module=module_id, topic=topic_id)
        task_data_obj.id = task_id
        task_meta_payload = {
            "id": task_id,
            "name": task_name,
            "module": module_id,
            "topic": topic_id,
            "created": now_iso,
            "created_at": now_iso,
            "modified": now_iso,
        }
        task_meta_payload = self._apply_workspace_meta_fields(task_meta_payload, workspace_meta)
        task_meta_payload = self._normalize_graph_ownership_fields(
            task_meta_payload,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        task_data_obj.set_meta(
            id=task_id,
            name=task_name,
            module=module_id,
            topic=topic_id,
            created=now_iso,
            created_at=now_iso,
            modified=now_iso,
        )
        task_data_obj.set_meta(
            **{
                key: value
                for key, value in task_meta_payload.items()
                if key
                in (
                    "created_via",
                    "content_scope",
                    "source_catalog_item_id",
                    "source_catalog_version_id",
                    "source_entity_kind",
                    "source_entity_id",
                )
            }
        )

        task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        bootstrap_payload = {
            "task_id": task_id,
            "task": {
                "task_data": task_data_obj.to_dict(),
                "answer_key": {},
                "metadata": {
                    "id": task_id,
                    "name": task_name,
                    "module": module_id,
                    "topic": topic_id,
                },
                "task_dir": str(task_dir),
                "is_new": True,
            },
        }
        task_block = bootstrap_payload["task"]
        task_data_payload = task_block.get("task_data") if isinstance(task_block, dict) else None
        if isinstance(task_data_payload, dict):
            meta_payload = task_data_payload.get("meta") if isinstance(task_data_payload.get("meta"), dict) else {}
            meta_payload = self._apply_workspace_meta_fields(meta_payload, workspace_meta)
            meta_payload = self._normalize_graph_ownership_fields(
                meta_payload,
                fallback_source="manual_editor",
                fallback_scope="shared_local",
            )
            task_data_payload["meta"] = normalize_workspace_lineage_fields(
                meta_payload,
                entity_kind="task",
                entity_id=task_id,
                entity_ref=f"{module_id}/{topic_id}/{task_id}",
            )
        metadata_payload = task_block.get("metadata") if isinstance(task_block.get("metadata"), dict) else {}
        metadata_payload = self._apply_workspace_meta_fields(metadata_payload, workspace_meta)
        metadata_payload = self._normalize_graph_ownership_fields(
            metadata_payload,
            fallback_source="manual_editor",
            fallback_scope="shared_local",
        )
        task_block["metadata"] = normalize_workspace_lineage_fields(
            metadata_payload,
            entity_kind="task",
            entity_id=task_id,
            entity_ref=f"{module_id}/{topic_id}/{task_id}",
        )
        return bootstrap_payload

    def create_task(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str,
        preferred_task_id: Optional[str] = None,
        workspace_meta: Optional[Dict[str, Any]] = None,
    ) -> Optional[str]:
        """
        Создать новое задание.
        
        Returns:
            str: ID созданного задания или None при ошибке
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        # task_name can be anything, it will be sanitized to generate ID

        try:
            from task_system.core.io.task_io import TaskIO
            
            task_id = self.reserve_task_id(
                module_id,
                topic_id,
                task_name,
                preferred_task_id=preferred_task_id,
            )
            task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            
            task_dir.mkdir(parents=True, exist_ok=True)
            
            # Create initial data
            task_data_obj = TaskIO.new_task(task_type, name=task_name, module=module_id, topic=topic_id)
            now_iso = datetime.now().isoformat()
            task_data_obj.id = task_id
            task_meta_payload = {
                "id": task_id,
                "name": task_name,
                "module": module_id,
                "topic": topic_id,
                "created": now_iso,
                "created_at": now_iso,
                "modified": now_iso,
            }
            task_meta_payload = self._apply_workspace_meta_fields(task_meta_payload, workspace_meta)
            task_meta_payload = self._normalize_graph_ownership_fields(
                task_meta_payload,
                fallback_source="manual_editor",
                fallback_scope="shared_local",
            )
            task_data_obj.set_meta(
                id=task_id,
                name=task_name,
                module=module_id,
                topic=topic_id,
                created=now_iso,
                created_at=now_iso,
                modified=now_iso,
            )
            task_data_obj.set_meta(
                **{
                    key: value
                    for key, value in task_meta_payload.items()
                    if key
                    in (
                        "created_via",
                        "content_scope",
                        "source_catalog_item_id",
                        "source_catalog_version_id",
                        "source_entity_kind",
                        "source_entity_id",
                    )
                }
            )
            task_json_path = task_dir / "task.json"
            
            TaskIO.save(task_data_obj, str(task_json_path), validate=True)
            
            # Update catalog
            # We pass a minimal dict to register
            meta = {"name": task_name}
            meta = self._apply_workspace_meta_fields(meta, workspace_meta)
            meta = self._normalize_graph_ownership_fields(
                meta,
                fallback_source="manual_editor",
                fallback_scope="shared_local",
            )
            self._ensure_task_registered_in_module(module_id, topic_id, task_id, {"meta": meta})
            
            self._modules_cache = None
            self.logger.info(f"Task created: {module_id}/{topic_id}/{task_id}")
            return task_id

        except Exception as e:
            self.logger.exception(f"Failed to create task {task_name}: {e}")
            return None

    def delete_task(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """
        Удалить задание.
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")

        try:
            import shutil
            task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            
            if not task_dir.exists():
                self.logger.info(f"Task not found at standard path: {task_dir}. Searching metadata...")
                # Попробуем найти через метаданные (для задач с нестандартными путями)
                try:
                    tasks = self.get_tasks(module_id, topic_id)
                    found_meta = next((t for t in tasks if t.get('id') == task_id), None)
                    
                    if found_meta and 'path' in found_meta:
                        resolved_path = self._resolve_task_path(found_meta['path'])
                        # resolved_path points to task.json, take parent
                        task_dir = resolved_path.parent
                        self.logger.info(f"Resolved custom task path: {task_dir}")
                except Exception as lookup_err:
                     self.logger.warning(f"Failed to lookup task metadata for {task_id}: {lookup_err}")

            if not task_dir.exists():
                self.logger.warning(f"Task delete requested but not found: {task_dir}")
                # Если папки нет, но задача есть в module.json, возможно стоит её удалить из json?
                # Но пока вернем ошибку, как раньше.
                return False
                
            shutil.rmtree(task_dir)
            
            # Also remove from module.json if present
            try:
                module_json_path = self.modules_dir / module_id / "module.json"
                if module_json_path.exists():
                     with open(module_json_path, "r", encoding="utf-8") as fh:
                        module = json.load(fh)
                     
                     changed = False
                     topics = module.get("topics", [])
                     topic = next((t for t in topics if t.get("id") == topic_id), None)
                     
                     if topic:
                         tasks = topic.get("tasks", [])
                         original_len = len(tasks)
                         # Filter out the deleted task
                         topic["tasks"] = [t for t in tasks if t.get("id") != task_id]
                         if len(topic["tasks"]) != original_len:
                             changed = True
                     
                     if changed:
                         import tempfile
                         with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                             json.dump(module, tf, ensure_ascii=False, indent=2)
                             temp_name = tf.name
                         shutil.move(temp_name, module_json_path)
                         self.logger.info(f"Removed task {task_id} from module.json")
            except Exception as e:
                self.logger.error(f"Failed to update module.json after delete: {e}")
            
            self._modules_cache = None
            self.logger.info(f"Task deleted: {module_id}/{topic_id}/{task_id}")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to delete task {task_id}: {e}")
            return False

    def delete_module(self, module_id: str) -> bool:
        """
        Удалить модуль целиком.
        """
        self._validate_id(module_id, "module_id")

        try:
            import shutil
            module_dir = self.modules_dir / module_id
            
            if not module_dir.exists():
                self.logger.warning(f"Module delete requested but not found: {module_dir}")
                return False

            shutil.rmtree(module_dir)
            
            self._modules_cache = None
            self.logger.info(f"Module deleted: {module_id}")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to delete module {module_id}: {e}")
            return False

    def delete_topic(self, module_id: str, topic_id: str) -> bool:
        """
        Удалить тему.
        """
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")

        try:
            import shutil
            
            # 1. Удаление папки темы
            # Путь зависит от структуры. Обычно modules/{module_id}/topics/{topic_id}
            topic_dir = self.modules_dir / module_id / "topics" / topic_id
            
            deleted_fs = False
            if topic_dir.exists():
                shutil.rmtree(topic_dir)
                deleted_fs = True
                self.logger.info(f"Topic directory deleted: {topic_dir}")
            
            # 2. Удаление из module.json (если используется явный список тем)
            updated_json = False
            try:
                module_json_path = self.modules_dir / module_id / "module.json"
                if module_json_path.exists():
                    with open(module_json_path, "r", encoding="utf-8") as fh:
                        module = json.load(fh)
                    
                    topics = module.get("topics", [])
                    original_len = len(topics)
                    # Filter out the deleted topic
                    new_topics = [t for t in topics if t.get("id") != topic_id]
                    
                    if len(new_topics) != original_len:
                        module["topics"] = new_topics
                        import tempfile
                        with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                            json.dump(module, tf, ensure_ascii=False, indent=2)
                            temp_name = tf.name
                        shutil.move(temp_name, module_json_path)
                        updated_json = True
                        self.logger.info(f"Removed topic {topic_id} from module.json")
            except Exception as e:
                self.logger.error(f"Failed to update module.json after topic delete: {e}")
            
            if not deleted_fs and not updated_json:
                 self.logger.warning(f"Topic not found for deletion: {module_id}/{topic_id}")
                 return False

            self._modules_cache = None
            self.logger.info(f"Topic deleted: {module_id}/{topic_id}")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to delete topic {topic_id}: {e}")
            return False

    def rename_module(self, module_id: str, new_name: str) -> bool:
        """Rename a module (update name in module.json, keep folder ID)."""
        self._validate_id(module_id, "module_id")
        if not new_name or not new_name.strip():
            return False

        try:
            module_json_path = self.modules_dir / module_id / "module.json"
            if not module_json_path.exists():
                self.logger.warning(f"Module json not found for rename: {module_json_path}")
                return False

            with open(module_json_path, "r", encoding="utf-8") as fh:
                module = json.load(fh)

            module["name"] = new_name.strip()

            import tempfile, shutil
            with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                json.dump(module, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            shutil.move(temp_name, str(module_json_path))

            self._modules_cache = None
            self.logger.info(f"Module renamed: {module_id} -> '{new_name.strip()}'")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to rename module {module_id}: {e}")
            return False

    def rename_topic(self, module_id: str, topic_id: str, new_name: str) -> bool:
        """Rename a topic (update name in topic.json and module.json, keep folder ID)."""
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        if not new_name or not new_name.strip():
            return False

        try:
            import tempfile, shutil
            new_name = new_name.strip()

            # 1. Update topic.json
            topic_json_path = self.modules_dir / module_id / "topics" / topic_id / "topic.json"
            if topic_json_path.exists():
                with open(topic_json_path, "r", encoding="utf-8") as fh:
                    topic = json.load(fh)
                topic["name"] = new_name
                with tempfile.NamedTemporaryFile(mode="w", dir=topic_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                    json.dump(topic, tf, ensure_ascii=False, indent=2)
                    temp_name = tf.name
                shutil.move(temp_name, str(topic_json_path))

            # 2. Update module.json entry
            module_json_path = self.modules_dir / module_id / "module.json"
            if module_json_path.exists():
                with open(module_json_path, "r", encoding="utf-8") as fh:
                    module = json.load(fh)
                for t in module.get("topics", []):
                    if t.get("id") == topic_id:
                        t["name"] = new_name
                        break
                with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                    json.dump(module, tf, ensure_ascii=False, indent=2)
                    temp_name = tf.name
                shutil.move(temp_name, str(module_json_path))

            self._modules_cache = None
            self.logger.info(f"Topic renamed: {module_id}/{topic_id} -> '{new_name}'")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to rename topic {topic_id}: {e}")
            return False

    def rename_task(self, module_id: str, topic_id: str, task_id: str, new_name: str) -> bool:
        """Rename a task (update name in task.json and module.json, keep folder ID)."""
        self._validate_id(module_id, "module_id")
        self._validate_id(topic_id, "topic_id")
        self._validate_id(task_id, "task_id")
        clean_name = str(new_name or "").strip()
        if not clean_name:
            return False

        try:
            import tempfile, shutil
            # 1. Update task.json
            task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            task_json_path = task_dir / "task.json"
            if task_json_path.exists():
                with open(task_json_path, "r", encoding="utf-8") as fh:
                    task_data = json.load(fh)

                task_data["name"] = clean_name
                meta = task_data.get("meta")
                if isinstance(meta, dict):
                    meta["name"] = clean_name
                    meta["modified"] = datetime.now(timezone.utc).isoformat()
                metadata = task_data.get("metadata")
                if isinstance(metadata, dict):
                    metadata["name"] = clean_name

                with tempfile.NamedTemporaryFile(mode="w", dir=task_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                    json.dump(task_data, tf, ensure_ascii=False, indent=2)
                    temp_name = tf.name
                shutil.move(temp_name, str(task_json_path))

            # 2. Update module.json entry
            module_json_path = self.modules_dir / module_id / "module.json"
            if module_json_path.exists():
                with open(module_json_path, "r", encoding="utf-8") as fh:
                    module = json.load(fh)

                for t in module.get("topics", []):
                    if t.get("id") == topic_id:
                        for task in t.get("tasks", []):
                            if task.get("id") == task_id:
                                task["name"] = clean_name
                                break
                        break

                with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                    json.dump(module, tf, ensure_ascii=False, indent=2)
                    temp_name = tf.name
                shutil.move(temp_name, str(module_json_path))

            self._modules_cache = None
            self.logger.info(f"Task renamed: {module_id}/{topic_id}/{task_id} -> '{clean_name}'")
            return True
        except Exception as e:
            self.logger.exception(f"Failed to rename task {task_id}: {e}")
            return False

    def _ensure_task_registered_in_module(self, module_id: str, topic_id: str, task_id: str, payload: Dict) -> None:
        """
        Убедиться, что задание записано в module.json (если используется явная схема).
        """
        try:
            module_json_path = self.modules_dir / module_id / "module.json"
            if not module_json_path.exists():
                return
                
            # Use a lock if concurrency is high? 
            # For desktop app, likelihood of collision is low, but better use atomic write if possible.
            # We will read, modify, atomic write.
            
            with open(module_json_path, "r", encoding="utf-8") as fh:
                module = json.load(fh)
                
            topics = module.get("topics", [])
            topic = next((t for t in topics if t.get("id") == topic_id), None)
            
            if topic is None:
                return # Topic not in json?
                
            tasks = topic.get("tasks", [])
            if not any(t.get("id") == task_id for t in tasks):
                # Add it
                payload_meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
                task_name = payload_meta.get("name") or payload.get("id", task_id)
                new_entry = {"id": task_id, "name": task_name}
                
                # Add type if known
                if "type" in payload:
                    new_entry["type"] = payload["type"]
                elif "task_type" in payload:
                    new_entry["type"] = payload["task_type"]
                if isinstance(payload_meta, dict):
                    for field_name in (_SOURCE_LINEAGE_FIELD_NAMES + _GRAPH_OWNERSHIP_FIELD_NAMES):
                        if payload_meta.get(field_name) is not None:
                            new_entry[field_name] = payload_meta.get(field_name)
                    for field_name in ("imported", "import_source"):
                        if payload_meta.get(field_name) is not None:
                            new_entry[field_name] = payload_meta.get(field_name)
                new_entry = self._normalize_graph_ownership_fields(
                    new_entry,
                    fallback_source="manual_editor",
                    fallback_scope="shared_local",
                )
                new_entry = normalize_workspace_lineage_fields(
                    new_entry,
                    entity_kind="task",
                    entity_id=task_id,
                    entity_ref=f"{module_id}/{topic_id}/{task_id}",
                )
                    
                tasks.append(new_entry)
                topic["tasks"] = tasks
                
                # Atomic write
                import tempfile
                import shutil
                
                with tempfile.NamedTemporaryFile(mode="w", dir=module_json_path.parent, delete=False, encoding="utf-8", suffix=".tmp") as tf:
                    json.dump(module, tf, ensure_ascii=False, indent=2)
                    temp_name = tf.name
                
                shutil.move(temp_name, module_json_path)
                self.logger.debug(f"Added task {task_id} to module.json atomically")

        except Exception as e:
            self.logger.error(f"Failed to update module.json for task {task_id}: {e}")

    def _copy_images_to_task_dir(self, task_dir: Path, task_data: Dict[str, Any]) -> None:
        """
        Копирует изображения в папку задания и обновляет пути в task_data.
        """
        try:
            from werkzeug.utils import secure_filename
            from task_system.core.models.task_models import is_direct_image_url, normalize_image_ref_to_string
            import shutil
            
            images_dir = task_dir / "images"
            if not images_dir.exists():
                images_dir.mkdir(exist_ok=True)
                
            content = task_data.get("content", {})
            if not isinstance(content, dict):
                return # Should handle raw structure too if needed, but task_data usually has content

            def hash_file(path: Path) -> Optional[str]:
                try:
                    hasher = hashlib.sha256()
                    with open(path, "rb") as fh:
                        while True:
                            chunk = fh.read(8192)
                            if not chunk:
                                break
                            hasher.update(chunk)
                    return hasher.hexdigest()
                except Exception:
                    return None

            # Helper logic similar to server.py
            def copy_image(src_path: Any) -> Optional[str]:
                src_path = normalize_image_ref_to_string(src_path)
                if not isinstance(src_path, str):
                    return None
                if not src_path: return None
                if is_direct_image_url(src_path): return src_path
                if src_path.startswith("modules/"): return src_path # Already good
                
                # Resolve absolute path
                abs_path = Path(src_path)
                if not abs_path.is_absolute():
                     abs_path = (self.data_dir / src_path).resolve()
                
                if not abs_path.exists():
                    return src_path # Can't find it, leave as is

                filename = secure_filename(abs_path.name)
                dst = images_dir / filename

                source_hash = hash_file(abs_path)
                stem = abs_path.stem
                suffix = abs_path.suffix
                candidate_paths = [dst]
                candidate_paths.extend(sorted(images_dir.glob(f"{stem}_*{suffix}")))
                if source_hash:
                    for candidate in candidate_paths:
                        if not candidate.exists():
                            continue
                        if hash_file(candidate) == source_hash:
                            try:
                                return candidate.relative_to(self.data_dir).as_posix()
                            except ValueError:
                                return src_path

                # Avoid collisions for different content
                counter = 1
                while dst.exists():
                    dst = images_dir / f"{stem}_{counter:02d}{suffix}"
                    counter += 1

                shutil.copy2(str(abs_path), str(dst))
                
                # Return relative path from data_dir
                try:
                    rel = dst.relative_to(self.data_dir).as_posix()
                    return rel
                except ValueError:
                    # Should not happen given logic above
                    return src_path

            # Process known fields
            # 1. Main image in content (e.g. click task)
            if "image" in content:
                 new_path = copy_image(content["image"])
                 if new_path: content["image"] = new_path

            # 1.5 Additional info images (click/draw editor)
            additional = content.get("additionalInfo")
            if isinstance(additional, dict):
                if additional.get("image"):
                    new_path = copy_image(additional.get("image"))
                    if new_path:
                        additional["image"] = new_path
                if isinstance(additional.get("images"), list):
                    normalized_images = []
                    for raw_image in additional.get("images", []):
                        new_path = copy_image(raw_image)
                        normalized_images.append(new_path or raw_image)
                    additional["images"] = normalized_images

            # 2. Questions array (Test task)
            questions = content.get("questions", [])
            if isinstance(questions, list):
                for q in questions:
                    if isinstance(q, dict):
                        if "image_path" in q:
                             np = copy_image(q["image_path"])
                             if np: q["image_path"] = np
                        
                        # Multi-image array (up to 3 images per question)
                        q_images = q.get("images")
                        if isinstance(q_images, list):
                            normalized = []
                            for img_item in q_images:
                                if isinstance(img_item, str) and img_item:
                                    np = copy_image(img_item)
                                    normalized.append(np or img_item)
                                else:
                                    normalized.append(img_item)
                            q["images"] = normalized

                        # Answers
                        answers = q.get("answers", [])
                        if isinstance(answers, list):
                            for a in answers:
                                if isinstance(a, dict) and "image_path" in a:
                                     np = copy_image(a["image_path"])
                                     if np: a["image_path"] = np

            # 3. Sequence assembly elements with images
            elements = content.get("elements", [])
            if isinstance(elements, list):
                for elem in elements:
                    if isinstance(elem, dict) and "image" in elem and isinstance(elem["image"], str) and elem["image"]:
                        np = copy_image(elem["image"])
                        if np: elem["image"] = np

            # 4. Open answer images array (content.images)
            oa_images = content.get("images")
            if isinstance(oa_images, list):
                normalized_oa = []
                for img_item in oa_images:
                    if isinstance(img_item, str) and img_item:
                        np = copy_image(img_item)
                        normalized_oa.append(np or img_item)
                    else:
                        normalized_oa.append(img_item)
                content["images"] = normalized_oa

            # Update task_data with modified content
            # (task_data is passed by reference/is a dict, so modifications persist)
            
        except Exception as e:
            self.logger.error(f"Image copy failed: {e}")


# Экспортируемые классы
__all__ = ['StorageService']
