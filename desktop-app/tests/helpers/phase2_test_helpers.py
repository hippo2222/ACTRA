"""
Вспомогательные функции для тестов Фазы 2 (Уровни сложности).
"""

from typing import Dict, Any, Optional
from pathlib import Path


def create_enhanced_task_data(
    task_type: str,
    level: int,
    original_prompt: str = "Тестовое задание"
) -> Dict[str, Any]:
    """
    Создает модифицированное задание для тестов.
    
    Args:
        task_type: Тип задания (click, draw, test, sequence_assembly)
        level: Уровень сложности (1, 2, 3)
        original_prompt: Исходный промпт задания
    
    Returns:
        Модифицированное задание с флагами валидации
    """
    base_task = {
        "type": task_type,
        "content": {
            "type": task_type,
            "prompt": original_prompt
        },
        "settings": {
            "difficulty": level
        }
    }
    
    # Добавляем флаги валидации
    base_task["_difficulty_enhanced"] = True
    base_task["_original_type"] = task_type
    base_task["_difficulty_level"] = level
    
    # Модифицируем контент в зависимости от типа и уровня
    if task_type == "click":
        if level == 1:
            base_task["content"]["mode"] = "click"
            base_task["content"]["requires_labels"] = False
            base_task["content"]["requires_drawing"] = False
        elif level == 2:
            base_task["content"]["mode"] = "click_and_label"
            base_task["content"]["requires_labels"] = True
            base_task["content"]["requires_drawing"] = False
            base_task["content"]["prompt"] = f"{original_prompt} и назовите её"
        elif level == 3:
            base_task["content"]["mode"] = "draw_and_label"
            base_task["content"]["requires_labels"] = True
            base_task["content"]["requires_drawing"] = True
            base_task["content"]["prompt"] = f"Обведите контур и назовите: {original_prompt}"
    
    elif task_type == "draw":
        if level == 1:
            base_task["content"]["mode"] = "draw"
            base_task["content"]["requires_labels"] = False
            base_task["content"]["requires_explanation"] = False
        elif level == 2:
            base_task["content"]["mode"] = "draw_and_label"
            base_task["content"]["requires_labels"] = True
            base_task["content"]["requires_explanation"] = False
            base_task["content"]["prompt"] = f"{original_prompt} и назовите структуру"
        elif level == 3:
            base_task["content"]["mode"] = "draw_multiple_and_explain"
            base_task["content"]["requires_labels"] = True
            base_task["content"]["requires_explanation"] = True
            base_task["content"]["prompt"] = f"Обведите несколько связанных структур и опишите связь между ними: {original_prompt}"
    
    elif task_type == "test":
        if level == 1:
            base_task["content"]["mode"] = "multiple_choice"
            base_task["content"]["show_options"] = True
            base_task["content"]["requires_text_input"] = False
        elif level == 2:
            base_task["content"]["mode"] = "open_question"
            base_task["content"]["show_options"] = False
            base_task["content"]["requires_text_input"] = True
    
    elif task_type == "sequence_assembly":
        if level == 1:
            base_task["content"]["show_level_labels"] = True
            base_task["content"]["show_block_labels"] = True
            base_task["content"]["requires_level_names"] = False
            base_task["content"]["requires_block_names"] = False
        elif level == 2:
            base_task["content"]["show_level_labels"] = False
            base_task["content"]["show_block_labels"] = True
            base_task["content"]["requires_level_names"] = True
            base_task["content"]["requires_block_names"] = False
        elif level == 3:
            base_task["content"]["show_level_labels"] = False
            base_task["content"]["show_block_labels"] = False
            base_task["content"]["requires_level_names"] = True
            base_task["content"]["requires_block_names"] = True
    
    return base_task


def create_task_with_difficulty(
    task_type: str,
    level: int,
    module_id: str = "module_01",
    topic_id: str = "topic_01",
    task_id: str = "task_001"
) -> Dict[str, Any]:
    """
    Создает задание с уровнем сложности для тестов.
    
    Args:
        task_type: Тип задания
        level: Уровень сложности
        module_id: ID модуля
        topic_id: ID темы
        task_id: ID задания
    
    Returns:
        Задание с полной структурой
    """
    task_data = create_enhanced_task_data(task_type, level)
    task_data["module_id"] = module_id
    task_data["topic_id"] = topic_id
    task_data["task_id"] = task_id
    return task_data


def simulate_task_execution_with_level(
    task_type: str,
    level: int,
    success: bool = True,
    score: float = 85.0
) -> Dict[str, Any]:
    """
    Симулирует выполнение задания на уровне сложности.
    
    Args:
        task_type: Тип задания
        level: Уровень сложности
        success: Успешность выполнения
        score: Оценка (0.0-100.0)
    
    Returns:
        Результат выполнения задания
    """
    result = {
        "success": success,
        "score": score,
        "difficulty": level,
        "task_type": task_type,
        "details": {
            "level": level,
            "task_type": task_type
        }
    }
    
    # Добавляем детали в зависимости от типа и уровня
    if task_type == "click":
        if level >= 2:
            result["details"]["labels"] = {
                "success": success,
                "score": score if success else 0.0
            }
        if level >= 3:
            result["details"]["drawing"] = {
                "success": success,
                "score": score if success else 0.0,
                "coverage": score if success else 0.0
            }
    
    return result


def assert_difficulty_enhancement(
    enhanced_task: Dict[str, Any],
    expected_level: int,
    expected_type: str
) -> None:
    """
    Проверяет корректность модификации задания.
    
    Args:
        enhanced_task: Модифицированное задание
        expected_level: Ожидаемый уровень сложности
        expected_type: Ожидаемый исходный тип задания
    """
    assert enhanced_task.get("_difficulty_enhanced") == True, "Задание должно быть помечено как модифицированное"
    assert enhanced_task.get("_original_type") == expected_type, f"Исходный тип должен быть {expected_type}"
    assert enhanced_task.get("_difficulty_level") == expected_level, f"Уровень должен быть {expected_level}"
    
    content = enhanced_task.get("content", {})
    if expected_type == "click":
        if expected_level == 1:
            assert content.get("mode") == "click"
            assert content.get("requires_labels") == False
        elif expected_level == 2:
            assert content.get("mode") == "click_and_label"
            assert content.get("requires_labels") == True
        elif expected_level == 3:
            assert content.get("mode") == "draw_and_label"
            assert content.get("requires_labels") == True
            assert content.get("requires_drawing") == True


def assert_difficulty_escalation(
    old_level: int,
    new_level: int,
    success: bool,
    score: float
) -> None:
    """
    Проверяет корректность эскалации уровня.
    
    Args:
        old_level: Старый уровень
        new_level: Новый уровень
        success: Успешность выполнения
        score: Оценка
    """
    if success and score >= 80.0:
        # При успехе с хорошим результатом уровень должен повыситься
        assert new_level >= old_level, "Уровень должен повыситься при успехе"
        assert new_level <= old_level + 1, "Уровень не должен повыситься больше чем на 1"
    elif not success and score < 50.0:
        # При неудаче с низким результатом уровень должен понизиться
        assert new_level <= old_level, "Уровень должен понизиться при неудаче"
        assert new_level >= old_level - 1, "Уровень не должен понизиться больше чем на 1"
    else:
        # При среднем результате уровень должен остаться тем же
        assert new_level == old_level, "Уровень должен остаться тем же при среднем результате"


def create_difficulty_config(
    task_overrides: Optional[Dict[str, Any]] = None,
    type_overrides: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    """
    Создает тестовую конфигурацию уровней сложности.
    
    Args:
        task_overrides: Переопределения для конкретных заданий
        type_overrides: Переопределения для типов заданий
    
    Returns:
        Конфигурация уровней сложности
    """
    config = {
        "version": "1.0",
        "default_levels": {
            "click": [1, 2, 3],
            "draw": [1, 2, 3],
            "test": [1, 2],
            "sequence_assembly": [1, 2, 3],
            "open_answer": [1]
        },
        "task_overrides": task_overrides or {},
        "type_overrides": type_overrides or {}
    }
    return config

