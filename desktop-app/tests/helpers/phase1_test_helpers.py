"""
Вспомогательные функции для тестов Фазы 1.

Предоставляет утилиты для:
- Создания тестовых пользователей с прогрессом
- Создания тестовых данных заданий
- Симуляции выполнения заданий
- Создания TrainerApp без UI
- Проверки структуры данных
"""

import sys
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService
from services.task_evaluator_service import EvaluationResult
from logic.profile_controller import ProfileController


def create_test_user_with_progress(
    data_dir: str,
    user_name: str = "Test User",
    num_attempts: int = 5,
    success_rate: float = 0.8
) -> tuple[User, ProgressService, StatisticsService]:
    """
    Создает тестового пользователя с прогрессом.
    
    Args:
        data_dir: Директория для данных
        user_name: Имя пользователя
        num_attempts: Количество попыток для создания
        success_rate: Процент успешных попыток (0.0-1.0)
    
    Returns:
        tuple: (User, ProgressService, StatisticsService)
    """
    user_service = UserService(data_dir=data_dir)
    user = user_service.create_user(user_name)
    
    progress_service = ProgressService(data_dir=data_dir, user_id=user.user_id)
    statistics_service = StatisticsService(progress_service=progress_service)
    
    # Создаем попытки
    successful_count = int(num_attempts * success_rate)
    failed_count = num_attempts - successful_count
    
    for i in range(successful_count):
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id=f"task_{i:03d}",
            difficulty=1,
            success=True,
            score=80.0 + (i * 2),
            time_spent=60 + i
        )
    
    for i in range(failed_count):
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_02",
            task_id=f"task_{i+successful_count:03d}",
            difficulty=1,
            success=False,
            score=40.0 + (i * 2),
            time_spent=120 + i
        )
    
    return user, progress_service, statistics_service


def create_test_task_data(
    task_type: str = "click",
    module_id: str = "module_01",
    topic_id: str = "topic_01",
    task_id: str = "task_001"
) -> Dict[str, Any]:
    """
    Создает тестовые данные задания.
    
    Args:
        task_type: Тип задания (click, draw, test, sequence_assembly, open_answer)
        module_id: ID модуля
        topic_id: ID темы
        task_id: ID задания
    
    Returns:
        dict: Данные задания в формате task.json
    """
    base_data = {
        "meta": {
            "task_schema_version": "1.2",
            "name": f"Тестовое задание {task_id}"
        },
        "content": {
            "type": task_type,
            "image": "test_image.jpg",
            "prompt": f"Выполните задание {task_id}"
        },
        "settings": {
            "difficulty": 1
        }
    }
    
    # Добавляем специфичные данные для разных типов
    if task_type == "click":
        base_data["content"]["annotations"] = [
            {
                "type": "target",
                "shape": "polygon",
                "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                "name": "Область 1"
            }
        ]
    elif task_type == "draw":
        base_data["content"]["annotations"] = [
            {
                "type": "target",
                "shape": "polygon",
                "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                "name": "Контур 1"
            }
        ]
    elif task_type == "test":
        base_data["content"]["question"] = "Тестовый вопрос?"
        base_data["content"]["options"] = ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"]
        base_data["content"]["correct_answer"] = 0
    
    return base_data


def create_test_answer_key(
    task_type: str = "click"
) -> Dict[str, Any]:
    """
    Создает тестовый answer_key для задания.
    
    Args:
        task_type: Тип задания
    
    Returns:
        dict: Answer key для задания
    """
    if task_type == "click":
        return {
            "targets": [
                {
                    "type": "polygon",
                    "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                    "name": "Область 1"
                }
            ]
        }
    elif task_type == "draw":
        return {
            "targets": [
                {
                    "type": "polygon",
                    "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                    "name": "Контур 1"
                }
            ]
        }
    elif task_type == "test":
        return {
            "correct_answer": 0
        }
    else:
        return {}


def simulate_task_execution(
    progress_service: ProgressService,
    module_id: str,
    topic_id: str,
    task_id: str,
    success: bool = True,
    score: float = 85.0,
    difficulty: int = 1,
    time_spent: int = 60
) -> bool:
    """
    Симулирует выполнение задания.
    
    Args:
        progress_service: ProgressService для сохранения
        module_id: ID модуля
        topic_id: ID темы
        task_id: ID задания
        success: Успешность попытки
        score: Оценка (0.0-100.0)
        difficulty: Уровень сложности (1-3)
        time_spent: Время выполнения в секундах
    
    Returns:
        bool: True если сохранение успешно
    """
    return progress_service.save_detailed_attempt(
        module_id=module_id,
        topic_id=topic_id,
        task_id=task_id,
        difficulty=difficulty,
        success=success,
        score=score,
        time_spent=time_spent
    )


def create_trainer_app_without_ui(
    data_dir: Optional[str] = None,
    user_id: str = "test_user"
) -> Any:
    """
    Создает TrainerApp без инициализации UI.
    
    Args:
        data_dir: Директория для данных (если None, создается временная)
        user_id: ID пользователя
    
    Returns:
        TrainerApp: Экземпляр приложения без UI
    
    Note:
        Этот метод создает TrainerApp, но пропускает _init_ui().
        Используется для headless тестирования.
    """
    if data_dir is None:
        data_dir = tempfile.mkdtemp()
    
    # Импортируем TrainerApp
    from app import TrainerApp, AppState
    
    # Создаем app без вызова __init__
    app = TrainerApp.__new__(TrainerApp)
    
    # Инициализируем только необходимые части
    app.data_dir = Path(data_dir)
    app.user_id = user_id
    app.state = AppState()
    app.state.current_user_id = user_id
    
    # Инициализируем DI контейнер
    from core.container import Container
    app.container = Container()
    
    # Регистрируем и инициализируем сервисы
    app._register_services()
    app._init_services()
    app._init_logic()
    
    # Пропускаем _init_plugins() и _init_ui()
    
    return app


def assert_progress_structure(
    progress_data: Dict[str, Any],
    user_id: str,
    expected_version: str = "2.0"
) -> None:
    """
    Проверяет структуру данных прогресса.
    
    Args:
        progress_data: Данные прогресса для проверки
        user_id: Ожидаемый user_id
        expected_version: Ожидаемая версия (по умолчанию "2.0")
    
    Raises:
        AssertionError: Если структура не соответствует ожиданиям
    """
    assert "version" in progress_data, "progress_data должен содержать 'version'"
    assert progress_data["version"] == expected_version, f"version должен быть '{expected_version}'"
    
    assert "user_id" in progress_data, "progress_data должен содержать 'user_id'"
    assert progress_data["user_id"] == user_id, f"user_id должен быть '{user_id}'"
    
    assert "task_history" in progress_data, "progress_data должен содержать 'task_history'"
    assert isinstance(progress_data["task_history"], dict), "task_history должен быть словарем"
    
    assert "mistake_bank" in progress_data, "progress_data должен содержать 'mistake_bank'"
    assert isinstance(progress_data["mistake_bank"], list), "mistake_bank должен быть списком"


def assert_statistics_structure(
    statistics_data: Dict[str, Any]
) -> None:
    """
    Проверяет структуру данных статистики.
    
    Args:
        statistics_data: Данные статистики для проверки
    
    Raises:
        AssertionError: Если структура не соответствует ожиданиям
    """
    required_fields = [
        "total_tasks_attempted",
        "total_tasks_completed",
        "success_rate",
        "average_score",
        "total_time_spent",
        "by_task_type",
        "last_updated"
    ]
    
    for field in required_fields:
        assert field in statistics_data, f"statistics_data должен содержать '{field}'"
    
    assert isinstance(statistics_data["total_tasks_attempted"], int), "total_tasks_attempted должен быть int"
    assert isinstance(statistics_data["total_tasks_completed"], int), "total_tasks_completed должен быть int"
    assert isinstance(statistics_data["success_rate"], (int, float)), "success_rate должен быть числом"
    assert 0.0 <= statistics_data["success_rate"] <= 1.0, "success_rate должен быть в диапазоне 0.0-1.0"
    assert isinstance(statistics_data["by_task_type"], dict), "by_task_type должен быть словарем"


def create_mock_evaluation_result(
    success: bool = True,
    score: float = 85.0,
    difficulty: int = 1,
    time_spent: int = 60
) -> EvaluationResult:
    """
    Создает мок EvaluationResult для тестов.
    
    Args:
        success: Успешность попытки
        score: Оценка (0.0-100.0)
        difficulty: Уровень сложности
        time_spent: Время выполнения в секундах
    
    Returns:
        EvaluationResult: Мок результата оценки
    """
    return EvaluationResult(
        success=success,
        score=score,
        message="Тестовое сообщение",
        metric="percent",
        details={
            "difficulty": difficulty,
            "time_spent": time_spent
        }
    )


def create_test_user_with_mistakes(
    data_dir: str,
    user_name: str = "Test User with Mistakes",
    num_mistakes: int = 3
) -> tuple[User, ProgressService, List[Dict[str, Any]]]:
    """
    Создает тестового пользователя с ошибками в mistake_bank.
    
    Args:
        data_dir: Директория для данных
        user_name: Имя пользователя
        num_mistakes: Количество заданий с ошибками
    
    Returns:
        tuple: (User, ProgressService, List[Dict] - mistake_bank)
    """
    user_service = UserService(data_dir=data_dir)
    user = user_service.create_user(user_name)
    
    progress_service = ProgressService(data_dir=data_dir, user_id=user.user_id)
    
    # Создаем несколько неудачных попыток для разных заданий
    for i in range(num_mistakes):
        # Несколько неудачных попыток для каждого задания
        for j in range(2 + i):  # 2, 3, 4 неудачных попыток
            progress_service.save_detailed_attempt(
                module_id="module_01",
                topic_id="topic_01",
                task_id=f"task_{i:03d}",
                difficulty=1,
                success=False,
                score=40.0 + (j * 2),
                time_spent=120 + j
            )
    
    # Получаем mistake_bank
    mistake_bank = progress_service.get_mistake_bank()
    
    return user, progress_service, mistake_bank

