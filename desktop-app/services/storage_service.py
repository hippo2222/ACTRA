"""
Storage Service - Работа с хранилищем данных (модули, задания, ключи ответов).

Отвечает за:
- Загрузку модулей, тем, заданий из файловой системы
- Загрузку ключей ответов
- Независимая работа с JSON файлами

НЕДЕЛЯ 2, Services Layer - Блок D: Storage Service
ОБНОВЛЕНО: Удалена зависимость от NavigationManager
"""

import json
import logging
import os
import time
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Any, Optional

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

                # Polygon / Region
                is_polygon = item_type == 'polygon' or (isinstance(points, list) and len(points) >= 3)
                if is_polygon:
                     targets.append({
                        'shape': 'polygon',
                        'points': points,
                        'label': label,
                    })
                # Freehand
                elif item_type == 'freehand' or (isinstance(points, list) and len(points) >= 2):
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
            if 'keywords' not in base and 'keywords' in content:
                base['keywords'] = content['keywords']
            
            # Sequence matters
            if 'sequence_matters' not in base:
                if 'sequence_matters' in content:
                    base['sequence_matters'] = content['sequence_matters']
                elif 'settings' in task_data and 'sequence_matters' in task_data['settings']:
                    base['sequence_matters'] = task_data['settings']['sequence_matters']
            
            # Reference answer (D-2 fix)
            if 'reference_answer' not in base and 'reference_answer' in content:
                base['reference_answer'] = content['reference_answer']
            
            # min_keywords / require_all_keywords (D-1 fix)
            if 'min_keywords' not in base and 'min_keywords' in content:
                base['min_keywords'] = content['min_keywords']
            if 'require_all_keywords' not in base and 'require_all_keywords' in content:
                base['require_all_keywords'] = content['require_all_keywords']
            
            return base

        # 4. SEQUENCE ASSEMBLY
        elif task_type == 'sequence_assembly' or task_type == 'sequence':
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
                        for topic in module_data.get('topics', []):
                            topic_id = topic.get('id')
                            topic_path = module_path / "topics" / topic_id if topic_id else None
                            topic['tasks'] = self._enrich_tasks_with_metadata(topic.get('tasks', []), topic_path)
                    
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
                    tasks = self._load_tasks_metadata(topic_path)
                    topic_data['tasks'] = tasks
                    
                    topics.append(topic_data)
                    
                except Exception as e:
                    self.logger.error(f"Error loading topic from {topic_json}: {e}")
            else:
                # Implicit topic from directory
                try:
                    tasks = self._load_tasks_metadata(topic_path)
                    if tasks: # Only add if we found tasks (or if we want to show empty modules?)
                        self.logger.info(f"Found implicit topic: {topic_path.name} with {len(tasks)} tasks")
                        topic_data = {
                            "id": topic_path.name,
                            "name": topic_path.name,
                            "tasks": tasks
                        }
                        topics.append(topic_data)
                    else:
                        self.logger.info(f"Implicit topic {topic_path.name} has no tasks, skipping.")
                except Exception as e:
                    self.logger.error(f"Error loading implicit topic from {topic_path}: {e}")
        
        return topics
    
    def _load_tasks_metadata(self, topic_path: Path) -> List[Dict[str, Any]]:
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
                meta = task_data.get('meta', {}) or {}
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

                metadata = {
                    'id': task_data.get('id', task_path.name),
                    'name': task_data.get('name', task_path.name),
                    'type': task_data.get('type', 'unknown'),
                    'subtype': task_data.get('subtype'),
                    'description': task_data.get('description', ''),
                    'created_at': created_at,
                    'path': path_str,
                }
                
                tasks.append(metadata)
                
            except Exception as e:
                self.logger.error(f"Error loading task metadata from {task_json}: {e}")
        
        self.logger.info(f"Found {len(tasks)} tasks in {topic_path.name}")
        return tasks
    
    def _enrich_tasks_with_metadata(
        self,
        tasks: Optional[List[Dict[str, Any]]],
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
                    meta = task_data.get('meta', {}) if isinstance(task_data, dict) else {}
                    created_at = (
                        meta.get('created_at')
                        or meta.get('created')
                        or datetime.fromtimestamp(task_json_path.stat().st_ctime).isoformat()
                    )
                    metadata.update({
                        'name': task_data.get('name', metadata.get('name')),
                        'type': task_data.get('type', metadata.get('type', 'unknown')),
                        'subtype': task_data.get('subtype', metadata.get('subtype')),
                        'description': task_data.get('description', metadata.get('description', '')),
                        'created_at': created_at,
                        'author': task_data.get('author', metadata.get('author')),
                    })
                except Exception as exc:
                    self.logger.warning(f"Failed to enrich task metadata from {task_json_path}: {exc}")
            enriched.append(metadata)
        
        return enriched
    
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
                return module
        
        return None
    
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
        return module.get('topics', [])
    
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
                return topic
        
        return None
    
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
        return topic.get('tasks', [])
    
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
                    result['metadata'].update({
                        k: v for k, v in metadata.items()
                        if k not in ['id'] or result['metadata'].get('id') != v
                    })
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

            # 4. Update module.json (ensure registered)
            self._ensure_task_registered_in_module(module_id, topic_id, task_id, task_data)

            # 5. Invalidate cache
            self._modules_cache = None
            self.logger.info(f"Task saved successfully: {module_id}/{topic_id}/{task_id}")
            return True

        except Exception as e:
            self.logger.exception(f"Failed to save task {module_id}/{topic_id}/{task_id}: {e}")
            return False

    def create_task(
        self,
        module_id: str,
        topic_id: str,
        task_name: str,
        task_type: str
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
            import uuid
            import time
            from werkzeug.utils import secure_filename
            from task_system.core.io.task_io import TaskIO
            
            # Generate ID
            safe_name = secure_filename(task_name.lower().replace(' ', '_'))
            task_id = safe_name if safe_name else str(uuid.uuid4())[:8]
            
            # Ensure uniqueness
            task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            if task_dir.exists():
                task_id = f"{task_id}_{int(time.time()) % 1000}"
                task_dir = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
            
            task_dir.mkdir(parents=True, exist_ok=True)
            
            # Create initial data
            task_data_obj = TaskIO.new_task(task_type, name=task_name, module=module_id, topic=topic_id)
            task_json_path = task_dir / "task.json"
            
            TaskIO.save(task_data_obj, str(task_json_path), validate=True)
            
            # Update catalog
            # We pass a minimal dict to register
            meta = {"name": task_name}
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
                task_name = payload.get("meta", {}).get("name") or payload.get("id", task_id)
                new_entry = {"id": task_id, "name": task_name}
                
                # Add type if known
                if "type" in payload:
                    new_entry["type"] = payload["type"]
                elif "task_type" in payload:
                    new_entry["type"] = payload["task_type"]
                    
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
            import shutil
            
            images_dir = task_dir / "images"
            if not images_dir.exists():
                images_dir.mkdir(exist_ok=True)
                
            content = task_data.get("content", {})
            if not isinstance(content, dict):
                return # Should handle raw structure too if needed, but task_data usually has content
                
            # Helper logic similar to server.py
            def copy_image(src_path: str) -> Optional[str]:
                if not src_path: return None
                if src_path.startswith("modules/"): return src_path # Already good
                
                # Resolve absolute path
                abs_path = Path(src_path)
                if not abs_path.is_absolute():
                     abs_path = (self.data_dir / src_path).resolve()
                
                if not abs_path.exists():
                    return src_path # Can't find it, leave as is
                    
                filename = secure_filename(abs_path.name)
                dst = images_dir / filename
                
                # Avoid collisions
                counter = 1
                while dst.exists():
                    # Check if it's the same file? optional optimization.
                    # For now just rename
                    stem = abs_path.stem
                    suffix = abs_path.suffix
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
            if "image" in content and isinstance(content["image"], str):
                 new_path = copy_image(content["image"])
                 if new_path: content["image"] = new_path

            # 1.5 Additional info images (click/draw editor)
            additional = content.get("additionalInfo")
            if isinstance(additional, dict):
                if isinstance(additional.get("image"), str):
                    new_path = copy_image(additional.get("image"))
                    if new_path:
                        additional["image"] = new_path
                if isinstance(additional.get("images"), list):
                    normalized_images = []
                    for raw_image in additional.get("images", []):
                        if not isinstance(raw_image, str):
                            continue
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
