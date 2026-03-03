"""
Configuration loader for the project.
Loads configuration from config.json and provides default values.
"""

import json
import logging
import sys
from pathlib import Path
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


def _get_application_dir() -> Path:
    """
    Определяет корневую директорию приложения.
    
    - В режиме разработки: возвращает корень проекта (parent parent от __file__)
    - В PyInstaller: возвращает директорию, где находится .exe
    
    Returns:
        Path: Корневая директория приложения
    """
    # Проверяем, запущено ли через PyInstaller
    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        # PyInstaller: sys.executable указывает на ACTRA.exe
        # Возвращаем директорию, где находится .exe
        return Path(sys.executable).parent
    else:
        # Режим разработки: common/config_loader.py -> common/ -> project_root/
        return Path(__file__).parent.parent


def _resolve_path_with_packaged_data_fallback(base_dir: Path, raw_path: str) -> Path:
    """Resolve config path, preferring sibling app data in packaged (_internal) runtime."""
    path = Path(raw_path)
    if path.is_absolute():
        return path

    # In PyInstaller one-folder builds runtime modules live under "_internal",
    # while mutable app data is placed next to it (../data).
    if base_dir.name == "_internal" and path.parts and path.parts[0].lower() == "data":
        sibling_candidate = base_dir.parent / path
        internal_candidate = base_dir / path
        if sibling_candidate.exists() or not internal_candidate.exists():
            return sibling_candidate

    return base_dir / path


def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Загружает конфигурацию из config.json.
    
    Если config.json не найден, возвращает значения по умолчанию.
    Пути нормализуются относительно корня проекта.
    
    Args:
        config_path: Путь к config.json (если None, ищет в корне проекта)
    
    Returns:
        Dict с конфигурацией:
        - data_root: путь к папке данных (абсолютный путь)
        - task_system_root: путь к task_system (абсолютный путь)
    
    Example:
        >>> config = load_config()
        >>> data_dir = Path(config['data_root'])
    """
    # Определяем корневую директорию приложения (работает и в dev, и в PyInstaller)
    app_dir = _get_application_dir()
    
    # Определяем путь к config.json и базовую директорию для относительных путей
    if config_path is None:
        config_file = app_dir / "config.json"
        base_dir = app_dir
    else:
        config_file = Path(config_path)
        if not config_file.is_absolute():
            config_file = (app_dir / config_file).resolve()
        base_dir = config_file.parent
    
    # Значения по умолчанию
    default_config = {
        "data_root": str(_resolve_path_with_packaged_data_fallback(base_dir, "data").resolve()),
        "task_system_root": str((base_dir / "task_system").resolve())
    }
    
    # Пытаемся загрузить config.json
    if not config_file.exists():
        logger.warning(f"config.json не найден в {config_file}. Использую значения по умолчанию.")
        return default_config
    
    try:
        with open(config_file, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        # Нормализуем пути относительно корня проекта
        if "data_root" in config:
            data_root = _resolve_path_with_packaged_data_fallback(
                base_dir, str(config["data_root"])
            )
            config["data_root"] = str(data_root.resolve())
        else:
            config["data_root"] = default_config["data_root"]

        if "task_system_root" in config:
            task_system_root = _resolve_path_with_packaged_data_fallback(
                base_dir, str(config["task_system_root"])
            )
            config["task_system_root"] = str(task_system_root.resolve())
        else:
            config["task_system_root"] = default_config["task_system_root"]
        
        # Валидация конфигурации
        validate_config(config)
        
        logger.info(f"Конфигурация загружена из {config_file}")
        return config
    
    except json.JSONDecodeError as e:
        logger.error(f"Ошибка парсинга config.json: {e}. Использую значения по умолчанию.")
        return default_config
    except Exception as e:
        logger.error(f"Ошибка загрузки config.json: {e}. Использую значения по умолчанию.")
        return default_config


def validate_config(config: Dict[str, Any]) -> None:
    """
    Валидирует загруженную конфигурацию.
    
    Проверяет существование директорий и выдает предупреждения,
    если они не найдены.
    
    Args:
        config: Словарь с конфигурацией
    
    Raises:
        None, но логирует предупреждения
    """
    # Проверяем data_root
    data_root = Path(config.get("data_root", ""))
    if not data_root.exists():
        logger.warning(f"Директория data_root не существует: {data_root}")
    elif not data_root.is_dir():
        logger.warning(f"data_root не является директорией: {data_root}")
    
    # Проверяем task_system_root
    task_system_root = Path(config.get("task_system_root", ""))
    if not task_system_root.exists():
        logger.warning(f"Директория task_system_root не существует: {task_system_root}")
    elif not task_system_root.is_dir():
        logger.warning(f"task_system_root не является директорией: {task_system_root}")


def get_data_root() -> Path:
    """
    Удобная функция для получения пути к data_root.
    
    Returns:
        Path к директории данных
    """
    config = load_config()
    return Path(config["data_root"])


def get_task_system_root() -> Path:
    """
    Удобная функция для получения пути к task_system_root.
    
    Returns:
        Path к директории task_system
    """
    config = load_config()
    return Path(config["task_system_root"])

