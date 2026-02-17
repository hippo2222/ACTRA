"""
Difficulty Config Loader.

Загрузчик конфигурации уровней сложности из difficulty_config.json.
Создает файл с дефолтными значениями при отсутствии.
Интегрирован с common.config_loader для получения data_root.
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

# Импортируем загрузчик конфигурации для получения data_root
from common.config_loader import load_config as load_main_config

logger = logging.getLogger(__name__)


# Дефолтная конфигурация уровней сложности
DEFAULT_CONFIG: Dict[str, Any] = {
    "version": "1.0",
    "default_levels": {
        "click": [1, 2, 3],
        "draw": [1, 2],  # Убрали уровень 3 для заданий типа рисование
        "test": [1, 2],  # 2 уровня вместо 3
        "sequence_assembly": [1, 2, 3],
        "open_answer": [1]  # Только уровень 1
    },
    "task_overrides": {},
    "type_overrides": {},
    "smart_retry_defaults": {
        "near_offset": 2,
        "near_jitter_max": 2,
        "max_copies": 5,
        "training_control_enabled": True
    }
}


class DifficultyConfigLoader:
    """
    Загрузчик конфигурации уровней сложности.
    
    Загружает difficulty_config.json из data/ директории.
    Создает файл с дефолтными значениями при отсутствии.
    """
    
    @staticmethod
    def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Загружает конфигурацию уровней сложности.
        
        Args:
            config_path: Путь к файлу конфигурации (если None, используется data/difficulty_config.json)
        
        Returns:
            dict: Конфигурация уровней сложности
        """
        # Определяем путь к файлу конфигурации
        if config_path is None:
            # Используем data_dir из config.json через common.config_loader
            main_config = load_main_config()
            data_dir = Path(main_config.get("data_root", "data"))
            config_path = data_dir / "difficulty_config.json"
        else:
            config_path = Path(config_path)
        
        # Если файл не существует - создать с дефолтными значениями
        if not config_path.exists():
            try:
                DifficultyConfigLoader._create_default_config(config_path)
            except Exception as e:
                logger.warning(
                    f"Не удалось создать difficulty_config.json по пути {config_path}: {e}. "
                    "Используем дефолтные значения в памяти."
                )
                return DEFAULT_CONFIG.copy()
        
        # Загрузить конфигурацию
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            # Валидация структуры конфигурации
            DifficultyConfigLoader._validate_config(config)
            
            logger.info(f"Конфигурация уровней сложности загружена из {config_path}")
            return config
            
        except json.JSONDecodeError as e:
            logger.warning(f"Ошибка парсинга difficulty_config.json: {e}, используем дефолтные значения")
            return DEFAULT_CONFIG.copy()
        except Exception as e:
            logger.warning(f"Ошибка загрузки difficulty_config.json: {e}, используем дефолтные значения")
            return DEFAULT_CONFIG.copy()
    
    @staticmethod
    def _create_default_config(config_path: Path) -> None:
        """
        Создает файл конфигурации с дефолтными значениями.
        
        Args:
            config_path: Путь к файлу конфигурации
        """
        # Создаем директорию, если не существует
        config_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Записываем дефолтную конфигурацию
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(
                    DEFAULT_CONFIG,
                    f,
                    ensure_ascii=False,
                    indent=2
                )
            logger.info(f"Создан файл конфигурации уровней сложности: {config_path}")
        except Exception as e:
            logger.error(f"Ошибка создания файла конфигурации {config_path}: {e}")
            raise
    
    @staticmethod
    def _validate_config(config: Dict[str, Any]) -> None:
        """
        Валидирует структуру конфигурации.
        
        Проверяет наличие обязательных полей и выдает предупреждения,
        если структура некорректна.
        
        Args:
            config: Словарь с конфигурацией
        """
        # Проверяем наличие обязательных полей
        if "version" not in config:
            logger.warning("В конфигурации отсутствует поле 'version', используется версия по умолчанию")
        
        if "default_levels" not in config:
            logger.warning("В конфигурации отсутствует поле 'default_levels', будут использованы значения по умолчанию")
            config["default_levels"] = DEFAULT_CONFIG["default_levels"].copy()
        
        if "task_overrides" not in config:
            logger.warning("В конфигурации отсутствует поле 'task_overrides', используется пустой словарь")
            config["task_overrides"] = {}
        
        if "type_overrides" not in config:
            logger.warning("В конфигурации отсутствует поле 'type_overrides', используется пустой словарь")
            config["type_overrides"] = {}
        
        if "smart_retry_defaults" not in config:
            logger.warning("В конфигурации отсутствует поле 'smart_retry_defaults', будут использованы значения по умолчанию")
            config["smart_retry_defaults"] = DEFAULT_CONFIG["smart_retry_defaults"].copy()
        
        # Проверяем структуру default_levels
        default_levels = config.get("default_levels", {})
        if not isinstance(default_levels, dict):
            logger.warning("Поле 'default_levels' должно быть словарем, используются значения по умолчанию")
            config["default_levels"] = DEFAULT_CONFIG["default_levels"].copy()
        else:
            # Проверяем, что все значения - списки целых чисел
            for task_type, levels in default_levels.items():
                if not isinstance(levels, list):
                    logger.warning(f"Уровни для типа '{task_type}' должны быть списком, используется значение по умолчанию")
                    default_levels[task_type] = DEFAULT_CONFIG["default_levels"].get(task_type, [1])
                elif not all(isinstance(level, int) for level in levels):
                    logger.warning(f"Уровни для типа '{task_type}' должны содержать только целые числа, используется значение по умолчанию")
                    default_levels[task_type] = DEFAULT_CONFIG["default_levels"].get(task_type, [1])


# Удобная функция для загрузки конфигурации
def load_difficulty_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Удобная функция для загрузки конфигурации уровней сложности.
    
    Args:
        config_path: Путь к файлу конфигурации (если None, используется data/difficulty_config.json)
    
    Returns:
        dict: Конфигурация уровней сложности
    
    Example:
        >>> config = load_difficulty_config()
        >>> click_levels = config['default_levels']['click']
    """
    return DifficultyConfigLoader.load_config(config_path)


__all__ = ["DifficultyConfigLoader", "load_difficulty_config", "DEFAULT_CONFIG"]

