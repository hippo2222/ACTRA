import json
import os
import sys
from pathlib import Path
from typing import Any, Dict

import pytest


_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if _PROJECT_ROOT.exists() and str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

_DESKTOP_APP_PATH = _PROJECT_ROOT / "desktop-app"
if _DESKTOP_APP_PATH.exists() and str(_DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(_DESKTOP_APP_PATH))


@pytest.fixture(scope="session", autouse=True)
def _stable_tmp_path_base(tmp_path_factory):
    """
    Force pytest tmp_path/tmpdir fixtures to use a workspace-local directory.

    The default Windows temp root (C:\\Users\\...\\Temp\\pytest-of-*)
    can be locked down by corporate policies, so we relocate it into the repo.
    """
    base = _PROJECT_ROOT / ".pytest_tmp"
    base.mkdir(parents=True, exist_ok=True)
    tmp_path_factory._basetemp = base  # type: ignore[attr-defined]
    return base


@pytest.fixture
def tmp_tasks_dir(tmp_path: Path) -> Path:
    tasks_dir = tmp_path / "sample_tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    return tasks_dir


@pytest.fixture
def make_task_file(tmp_tasks_dir: Path):
    def _make(name: str, data: Dict[str, Any]) -> Path:
        path = tmp_tasks_dir / name
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    return _make


@pytest.fixture
def sample_image_path(tmp_tasks_dir: Path) -> Path:
    # Создаём минимальную заглушку изображения (пустой файл с расширением)
    img = tmp_tasks_dir / "stub.png"
    if not img.exists():
        img.write_bytes(b"")
    return img


@pytest.fixture
def new_user_progress_structure(tmp_path: Path) -> Path:
    """
    Фикстура для создания новой структуры прогресса пользователя.
    
    Создает структуру:
    data/
      users/
        {user_id}/
          profile.json
          progress.json
          statistics.json
    
    Args:
        tmp_path: Временная директория от pytest
    
    Returns:
        Path к директории пользователя
    """
    user_id = "test_user"
    user_dir = tmp_path / "data" / "users" / user_id
    user_dir.mkdir(parents=True, exist_ok=True)
    
    # Создаём profile.json
    profile_file = user_dir / "profile.json"
    profile_data = {
        "user_id": user_id,
        "profile": {
            "name": "Test User",
            "created_at": "2024-01-01T00:00:00",
            "settings": {
            }
        }
    }
    with open(profile_file, "w", encoding="utf-8") as f:
        json.dump(profile_data, f, ensure_ascii=False, indent=2)
    
    # Создаём progress.json
    progress_file = user_dir / "progress.json"
    progress_data = {
        "version": "2.0",
        "user_id": user_id,
        "task_history": {},
        "mistake_bank": []
    }
    with open(progress_file, "w", encoding="utf-8") as f:
        json.dump(progress_data, f, ensure_ascii=False, indent=2)
    
    # Создаём statistics.json
    statistics_file = user_dir / "statistics.json"
    statistics_data = {
        "total_tasks_attempted": 0,
        "total_tasks_completed": 0,
        "success_rate": 0.0,
        "by_task_type": {},
        "weak_areas": []
    }
    with open(statistics_file, "w", encoding="utf-8") as f:
        json.dump(statistics_data, f, ensure_ascii=False, indent=2)
    
    return user_dir


@pytest.fixture
def difficulty_manager(tmp_path: Path):
    """
    Фикстура для создания DifficultyManager в тестах.
    
    Args:
        tmp_path: Временная директория от pytest
    
    Returns:
        DifficultyManager экземпляр
    """
    try:
        import sys
        from pathlib import Path
        # Добавляем путь к desktop-app для импорта
        desktop_app_path = Path(__file__).parent.parent / "desktop-app"
        if str(desktop_app_path) not in sys.path:
            sys.path.insert(0, str(desktop_app_path))
        
        from services.difficulty_manager import DifficultyManager
        manager = DifficultyManager(config_path=None)
        return manager
    except ImportError as e:
        # Если DifficultyManager еще не создан, создаем заглушку
        pytest.skip(f"DifficultyManager не найден: {e}, будет создан в Фазе 2")


@pytest.fixture
def enhanced_task_data():
    """
    Фикстура для тестирования модифицированных заданий из DifficultyManager.
    
    Returns:
        Dict с примерами модифицированных заданий для разных типов и уровней
    """
    return {
        "click_level_1": {
            "type": "click",
            "content": {
                "type": "click",
                "mode": "click",
                "requires_labels": False,
                "requires_drawing": False,
                "prompt": "Кликните на область"
            },
            "_difficulty_enhanced": True,
            "_original_type": "click",
            "_difficulty_level": 1
        },
        "click_level_2": {
            "type": "click",
            "content": {
                "type": "click",
                "mode": "click_and_label",
                "requires_labels": True,
                "requires_drawing": False,
                "prompt": "Кликните на область и назовите её"
            },
            "_difficulty_enhanced": True,
            "_original_type": "click",
            "_difficulty_level": 2
        },
        "click_level_3": {
            "type": "click",
            "content": {
                "type": "click",
                "mode": "draw_and_label",
                "requires_labels": True,
                "requires_drawing": True,
                "prompt": "Обведите контур и назовите: Кликните на область"
            },
            "_difficulty_enhanced": True,
            "_original_type": "click",
            "_difficulty_level": 3
        },
        "draw_level_1": {
            "type": "draw",
            "content": {
                "type": "draw",
                "mode": "draw",
                "requires_labels": False,
                "requires_explanation": False,
                "prompt": "Обведите контур"
            },
            "_difficulty_enhanced": True,
            "_original_type": "draw",
            "_difficulty_level": 1
        },
        "test_level_1": {
            "type": "test",
            "content": {
                "type": "test",
                "mode": "multiple_choice",
                "show_options": True,
                "requires_text_input": False
            },
            "_difficulty_enhanced": True,
            "_original_type": "test",
            "_difficulty_level": 1
        },
        "test_level_2": {
            "type": "test",
            "content": {
                "type": "test",
                "mode": "open_question",
                "show_options": False,
                "requires_text_input": True
            },
            "_difficulty_enhanced": True,
            "_original_type": "test",
            "_difficulty_level": 2
        },
        "sequence_level_1": {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "show_level_labels": True,
                "show_block_labels": True,
                "requires_level_names": False,
                "requires_block_names": False
            },
            "_difficulty_enhanced": True,
            "_original_type": "sequence_assembly",
            "_difficulty_level": 1
        },
        "sequence_level_2": {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "show_level_labels": False,
                "show_block_labels": True,
                "requires_level_names": True,
                "requires_block_names": False
            },
            "_difficulty_enhanced": True,
            "_original_type": "sequence_assembly",
            "_difficulty_level": 2
        },
        "sequence_level_3": {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "show_level_labels": False,
                "show_block_labels": False,
                "requires_level_names": True,
                "requires_block_names": True
            },
            "_difficulty_enhanced": True,
            "_original_type": "sequence_assembly",
            "_difficulty_level": 3
        }
    }


@pytest.fixture
def base_task_data():
    """
    Фикстура для базовых данных заданий (до модификации DifficultyManager).
    
    Returns:
        Dict с примерами исходных заданий разных типов
    """
    return {
        "click": {
            "type": "click",
            "content": {
                "type": "click",
                "prompt": "Кликните на область",
                "image": "image.jpg"
            },
            "settings": {
                "difficulty": 1
            }
        },
        "draw": {
            "type": "draw",
            "content": {
                "type": "draw",
                "prompt": "Обведите контур",
                "image": "image.jpg",
                "annotations": [
                    {
                        "type": "polygon",
                        "points": [[100, 100], [200, 100], [200, 200], [100, 200]],
                        "label": "Область 1"
                    }
                ]
            },
            "settings": {
                "difficulty": 1
            }
        },
        "test": {
            "type": "test",
            "content": {
                "type": "test",
                "question": "Вопрос?",
                "options": ["Вариант 1", "Вариант 2", "Вариант 3", "Вариант 4"],
                "correct_answer": 0
            },
            "settings": {
                "difficulty": 1
            }
        },
        "sequence_assembly": {
            "type": "sequence_assembly",
            "content": {
                "type": "sequence_assembly",
                "levels": [
                    {
                        "level_id": "level_1",
                        "level_name": "Уровень 1",
                        "blocks": [
                            {"block_id": "block_1", "block_name": "Блок 1"},
                            {"block_id": "block_2", "block_name": "Блок 2"}
                        ]
                    }
                ]
            },
            "settings": {
                "difficulty": 1,
                "level_order_matters": True,
                "sequence_within_level_matters": True
            }
        },
        "open_answer": {
            "type": "open_answer",
            "content": {
                "type": "open_answer",
                "question": "Вопрос?",
                "keywords": ["ключевое", "слово"]
            },
            "settings": {
                "difficulty": 1
            }
        }
    }



































