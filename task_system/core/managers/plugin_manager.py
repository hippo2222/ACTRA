"""
Менеджер плагинов для расширения системы типов заданий

Поддерживает формальный Plugin API с lifecycle методами,
версионированием, метаданными и системой hooks.
"""

import os
import sys
import json
import logging
import importlib
import importlib.util
from pathlib import Path
from typing import Dict, List, Any, Optional, Type
from ..base.plugin_base import PluginBase
from ..base.app_context import AppContext
from ..base.task_type import BaseTaskType
from ..hooks.hook_registry import hook_registry
from ..exceptions import PluginError
from .version_checker import VersionChecker
from ...types.registry import TaskTypeRegistry

logger = logging.getLogger(__name__)


class PluginManager:
    """
    Менеджер для загрузки и управления плагинами.
    
    Поддерживает:
    - Загрузку плагинов из plugin.json
    - Проверку совместимости версий
    - Управление lifecycle (setup/teardown)
    - Автоматическую регистрацию task types через hooks
    - Поддержку permissions
    """
    
    def __init__(self, registry: Optional[TaskTypeRegistry] = None, 
                 core_version: str = "1.0.0"):
        """
        Инициализация менеджера плагинов.
        
        Args:
            registry: Реестр типов заданий
            core_version: Версия ядра системы
        """
        self.registry = registry or TaskTypeRegistry()
        self.core_version = core_version
        self.loaded_plugins: Dict[str, Dict[str, Any]] = {}
        self.plugin_directories: List[str] = []
        self.version_checker = VersionChecker()
        self.app_context: Optional[AppContext] = None
    
    def set_app_context(self, app_context: AppContext) -> None:
        """
        Устанавливает контекст приложения.
        
        Args:
            app_context: Контекст приложения
        """
        self.app_context = app_context
    
    def add_plugin_directory(self, directory: str) -> None:
        """
        Добавляет директорию для поиска плагинов.
        
        Args:
            directory: Путь к директории с плагинами
        """
        directory_path = Path(directory)
        if directory_path.exists() and directory_path.is_dir():
            if str(directory_path.absolute()) not in self.plugin_directories:
                self.plugin_directories.append(str(directory_path.absolute()))
        else:
            logger.warning(f"Plugin directory does not exist: {directory}")
    
    def load_plugin_from_json(self, plugin_json_path: str) -> bool:
        """
        Загружает плагин из plugin.json файла.
        
        Args:
            plugin_json_path: Путь к plugin.json файлу
        
        Returns:
            True, если плагин успешно загружен
        """
        try:
            plugin_dir = Path(plugin_json_path).parent
            
            # Загружаем метаданные плагина
            with open(plugin_json_path, 'r', encoding='utf-8') as f:
                plugin_metadata = json.load(f)
            
            plugin_id = plugin_metadata.get('id')
            if not plugin_id:
                logger.error(f"Plugin metadata missing 'id' field in {plugin_json_path}")
                return False
            
            # Проверяем, не загружен ли уже плагин
            if plugin_id in self.loaded_plugins:
                logger.warning(f"Plugin {plugin_id} is already loaded")
                return False
            
            # Проверяем совместимость версий
            compatible_core = plugin_metadata.get('compatible_core', '>=1.0.0')
            if not self.version_checker.is_compatible(compatible_core, self.core_version):
                logger.error(
                    f"Plugin {plugin_id} version {plugin_metadata.get('version')} "
                    f"is not compatible with core version {self.core_version}. "
                    f"Required: {compatible_core}, Got: {self.core_version}"
                )
                return False
            
            # Проверяем permissions (пока только логируем)
            permissions = plugin_metadata.get('permissions', [])
            if permissions:
                logger.info(f"Plugin {plugin_id} requests permissions: {permissions}")
            
            # Загружаем entry point
            entry_point = plugin_metadata.get('entry_point')
            if not entry_point:
                logger.error(f"Plugin {plugin_id} missing 'entry_point' field")
                return False
            
            # Парсим entry point (формат: "module:ClassName")
            if ':' not in entry_point:
                logger.error(f"Invalid entry_point format for {plugin_id}: {entry_point}")
                return False
            
            module_name, class_name = entry_point.split(':', 1)
            
            # Загружаем модуль плагина
            plugin_module_path = plugin_dir / f"{module_name}.py"
            if not plugin_module_path.exists():
                # Пробуем как пакет
                plugin_module_path = plugin_dir / module_name / "__init__.py"
                if not plugin_module_path.exists():
                    logger.error(f"Cannot find plugin module for {plugin_id}: {module_name}")
                    return False
            
            # Добавляем путь плагина в sys.path
            if str(plugin_dir.absolute()) not in sys.path:
                sys.path.insert(0, str(plugin_dir.absolute()))
            
            # Импортируем модуль
            spec = importlib.util.spec_from_file_location(module_name, plugin_module_path)
            if spec is None or spec.loader is None:
                logger.error(f"Cannot load module {module_name} for plugin {plugin_id}")
                return False
            
            plugin_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(plugin_module)
            
            # Получаем класс плагина
            if not hasattr(plugin_module, class_name):
                logger.error(f"Class {class_name} not found in module {module_name}")
                return False
            
            plugin_class = getattr(plugin_module, class_name)
            
            # Проверяем, что это PluginBase
            if not issubclass(plugin_class, PluginBase):
                logger.error(f"{class_name} is not a subclass of PluginBase")
                return False
            
            # Создаём экземпляр плагина
            plugin_instance = plugin_class()
            
            # Убеждаемся, что plugin_id совпадает
            if plugin_instance.plugin_id != plugin_id:
                logger.warning(f"Plugin ID mismatch: metadata={plugin_id}, class={plugin_instance.plugin_id}")
            
            # Проверяем версию
            plugin_version = plugin_metadata.get('version')
            if plugin_version and plugin_instance.version != plugin_version:
                logger.warning(f"Plugin version mismatch: metadata={plugin_version}, class={plugin_instance.version}")
            
            # Подготавливаем AppContext
            if not self.app_context:
                # Создаём минимальный контекст по умолчанию
                self.app_context = AppContext(
                    app_type="trainer",
                    core_version=self.core_version,
                    services={}
                )
            
            # Вызываем setup
            try:
                plugin_instance.setup(self.app_context)
            except Exception as e:
                logger.exception(f"Plugin {plugin_id} setup failed")
                raise PluginError(
                    f"Plugin {plugin_id} setup failed: {e}",
                    details={'plugin_id': plugin_id, 'path': str(plugin_json_path), 'version': plugin_version}
                ) from e
            
            # Регистрируем task types через get_task_types
            task_type_classes = plugin_instance.get_task_types()
            registered_task_types = []
            for task_type_class in task_type_classes:
                if issubclass(task_type_class, BaseTaskType):
                    task_type_instance = task_type_class()
                    self.registry.register(task_type_instance)
                    plugin_instance.on_task_type_registered(task_type_instance)
                    registered_task_types.append(task_type_instance.task_id)
            
            # Сохраняем информацию о плагине
            self.loaded_plugins[plugin_id] = {
                'id': plugin_id,
                'version': plugin_instance.version,
                'metadata': plugin_metadata,
                'instance': plugin_instance,
                'module': plugin_module,
                'path': str(plugin_dir.absolute()),
                'entry_point': entry_point,
                'permissions': permissions,
                'task_types': registered_task_types
            }
            
            logger.info(f"Plugin {plugin_id} v{plugin_instance.version} loaded successfully")
            return True
            
        except PluginError:
            # Re-raise PluginError as is (already wrapped)
            raise
        except Exception as e:
            logger.exception(f"Error loading plugin from {plugin_json_path}")
            raise PluginError(
                f"Error loading plugin from {plugin_json_path}: {e}",
                details={'plugin_json_path': str(plugin_json_path), 'error_type': type(e).__name__}
            ) from e
    
    def load_plugins_from_directory(self, directory: str) -> int:
        """
        Загружает все плагины из директории.
        
        Ищет поддиректории с plugin.json файлами.
        
        Args:
            directory: Путь к директории с плагинами
        
        Returns:
            Количество успешно загруженных плагинов
        """
        loaded_count = 0
        directory_path = Path(directory)
        
        if not directory_path.exists():
            return loaded_count
        
        # Проходим по всем поддиректориям
        for item in directory_path.iterdir():
            if item.is_dir():
                plugin_json_path = item / "plugin.json"
                if plugin_json_path.exists():
                    if self.load_plugin_from_json(str(plugin_json_path)):
                        loaded_count += 1
        
        return loaded_count
    
    def unload_plugin(self, plugin_id: str) -> bool:
        """
        Выгружает плагин.
        
        Args:
            plugin_id: ID плагина
        
        Returns:
            True, если плагин успешно выгружен
        """
        if plugin_id not in self.loaded_plugins:
            return False
        
        try:
            plugin_info = self.loaded_plugins[plugin_id]
            plugin_instance = plugin_info['instance']
            
            # Вызываем teardown
            try:
                plugin_instance.teardown()
            except Exception as e:
                logger.exception(f"Plugin {plugin_id} teardown failed")
                # Не выбрасываем исключение для teardown, только логируем
            
            # Отменяем регистрацию hooks плагина
            hook_registry.unregister_all_for_plugin(plugin_id)
            
            # Отменяем регистрацию task types
            task_types = plugin_info.get('task_types', [])
            for task_id in task_types:
                self.registry.unregister(task_id)
                plugin_instance.on_task_type_unregistered(task_id)
            
            # Удаляем из загруженных
            del self.loaded_plugins[plugin_id]
            
            logger.info(f"Plugin {plugin_id} unloaded")
            return True
            
        except Exception as e:
            logger.exception(f"Error unloading plugin {plugin_id}")
            raise PluginError(
                f"Error unloading plugin {plugin_id}: {e}",
                details={'plugin_id': plugin_id, 'error_type': type(e).__name__}
            ) from e
    
    def reload_plugin(self, plugin_id: str) -> bool:
        """
        Перезагружает плагин.
        
        Args:
            plugin_id: ID плагина
        
        Returns:
            True, если плагин успешно перезагружен
        """
        if plugin_id not in self.loaded_plugins:
            return False
        
        plugin_info = self.loaded_plugins[plugin_id]
        plugin_json_path = Path(plugin_info['path']) / "plugin.json"
        
        # Выгружаем
        self.unload_plugin(plugin_id)
        
        # Загружаем заново
        return self.load_plugin_from_json(str(plugin_json_path))
    
    def get_loaded_plugins(self) -> List[str]:
        """
        Получает список загруженных плагинов.
        
        Returns:
            Список ID плагинов
        """
        return list(self.loaded_plugins.keys())
    
    def get_plugin_info(self, plugin_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает информацию о плагине.
        
        Args:
            plugin_id: ID плагина
        
        Returns:
            Словарь с информацией о плагине или None
        """
        if plugin_id in self.loaded_plugins:
            plugin_info = self.loaded_plugins[plugin_id].copy()
            # Удаляем ссылку на экземпляр и модуль для безопасности
            plugin_info.pop('instance', None)
            plugin_info.pop('module', None)
            return plugin_info
        return None
    
    def load_all_plugins(self) -> int:
        """
        Загружает все плагины из всех добавленных директорий.
        
        Returns:
            Количество успешно загруженных плагинов
        """
        total_loaded = 0
        for directory in self.plugin_directories:
            loaded = self.load_plugins_from_directory(directory)
            total_loaded += loaded
        return total_loaded
    
    def shutdown(self) -> None:
        """
        Выгружает все плагины (вызывается при завершении работы).
        """
        plugin_ids = list(self.loaded_plugins.keys())
        for plugin_id in plugin_ids:
            self.unload_plugin(plugin_id)
