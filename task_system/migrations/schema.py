"""
Определение версий схемы task.json и функции определения версий.
"""

# Константы версий схемы
SCHEMA_V1_0 = "1.0"
SCHEMA_V1_1 = "1.1"
SCHEMA_V1_2 = "1.2"

# Текущая версия схемы
CURRENT_SCHEMA_VERSION = SCHEMA_V1_2


def detect_schema_version(task_dict: dict) -> str:
    """
    Определяет версию схемы task.json на основе структуры данных.
    
    Правила определения:
    - v1.0: нет 'meta' или 'content', поля на верхнем уровне
    - v1.1: есть 'meta' и 'content', но нет 'meta.task_schema_version'
    - v1.2: есть 'meta.task_schema_version'
    
    Args:
        task_dict: Словарь с данными задания
        
    Returns:
        Версия схемы (строка)
    """
    # Проверка наличия task_schema_version (v1.2+)
    meta = task_dict.get("meta", {})
    if isinstance(meta, dict) and meta.get("task_schema_version"):
        return meta.get("task_schema_version")
    
    # Проверка наличия meta и content структур (v1.1+)
    if "meta" in task_dict and "content" in task_dict:
        # Если есть meta и content, но нет task_schema_version - это v1.1
        return SCHEMA_V1_1
    
    # Если нет meta или content - это старая версия v1.0
    return SCHEMA_V1_0


















































