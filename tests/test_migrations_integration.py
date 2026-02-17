"""
Интеграционные тесты для системы миграций.

Тестируют взаимодействие миграций с TaskIO и TaskData.
"""

import sys
import os
import json
import tempfile
import shutil
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from task_system.core.io.task_io import TaskIO
from task_system.core.models.task_data import TaskData
from task_system.migrations import CURRENT_SCHEMA_VERSION, detect_schema_version


def test_taskio_loads_old_format():
    """Тест загрузки задания старого формата через TaskIO."""
    # Создаем задание в формате v1.0
    old_task_data = {
        "id": "test_001",
        "type": "click",
        "name": "Тестовое задание",
        "moduleId": "module_01",
        "topicId": "topic_01",
        "image": "test.png",
        "prompt": "Кликните на объект",
        "settings": {"difficulty": 1},
    }
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        
        # Сохраняем задание старого формата
        with open(task_path, "w", encoding="utf-8") as f:
            json.dump(old_task_data, f, ensure_ascii=False, indent=2)
        
        # Загружаем через TaskIO
        task = TaskIO.load(str(task_path))
        
        assert task is not None, "Задание должно быть загружено"
        assert task.id == "test_001", "ID должен быть сохранен"
        assert task.type == "click", "Тип должен быть сохранен"
        
        # Проверяем что структура мигрирована
        assert "meta" in task.data, "Должна быть структура meta"
        assert "content" in task.data, "Должна быть структура content"
        
        # Проверяем что поля перенесены
        assert task.data["meta"]["name"] == "Тестовое задание", "name должен быть в meta"
        assert task.data["content"]["image"] == "test.png", "image должен быть в content"
        assert task.data["content"]["prompt"] == "Кликните на объект", "prompt должен быть в content"
        
        print("[OK] test_taskio_loads_old_format passed")


def test_taskio_saves_new_format():
    """Тест сохранения задания с автоматической установкой task_schema_version."""
    # Создаем новое задание
    task = TaskData()
    task.type = "click"
    task.set_meta(name="Тестовое задание", module="module_01", topic="topic_01")
    task.update_content(image="test.png", prompt="Кликните на объект")
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        
        # Сохраняем задание
        TaskIO.save(task, str(task_path))
        
        # Загружаем обратно и проверяем
        with open(task_path, "r", encoding="utf-8") as f:
            saved_data = json.load(f)
        
        # Проверяем что task_schema_version установлен
        assert "meta" in saved_data, "Должна быть структура meta"
        assert "task_schema_version" in saved_data["meta"], "Должен быть task_schema_version"
        assert saved_data["meta"]["task_schema_version"] == CURRENT_SCHEMA_VERSION, \
            f"task_schema_version должен быть {CURRENT_SCHEMA_VERSION}"
        
        # Проверяем created_at
        assert "created_at" in saved_data["meta"], "Должен быть created_at"
        
        print("[OK] test_taskio_saves_new_format passed")


def test_taskio_auto_migration():
    """Тест автоматической миграции при загрузке старого задания."""
    # Создаем задание в формате v1.0
    old_task_data = {
        "id": "test_002",
        "type": "draw",
        "name": "Задание v1.0",
        "image": "draw.png",
        "prompt": "Нарисуйте контур",
    }
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        
        # Сохраняем старое задание
        with open(task_path, "w", encoding="utf-8") as f:
            json.dump(old_task_data, f, ensure_ascii=False, indent=2)
        
        # Загружаем через TaskIO (должна произойти автоматическая миграция)
        task = TaskIO.load(str(task_path))
        
        assert task is not None, "Задание должно быть загружено"
        
        # Проверяем что миграция применена
        version = detect_schema_version(task.data)
        assert version == CURRENT_SCHEMA_VERSION, \
            f"Версия должна быть {CURRENT_SCHEMA_VERSION} после миграции, получена {version}"
        
        # Проверяем структуру
        assert task.data["meta"]["task_schema_version"] == CURRENT_SCHEMA_VERSION, \
            "Должен быть task_schema_version после миграции"
        
        print("[OK] test_taskio_auto_migration passed")


def test_taskdata_default_fields():
    """Тест что TaskData создает задания с правильными полями по умолчанию."""
    task = TaskData()
    
    # Проверяем что новые поля есть в DEFAULT
    assert "task_schema_version" in task.meta, "Должен быть task_schema_version в meta"
    assert "created_at" in task.meta, "Должен быть created_at в meta"
    
    # Проверяем значения
    assert task.meta["task_schema_version"] == CURRENT_SCHEMA_VERSION, \
        f"task_schema_version должен быть {CURRENT_SCHEMA_VERSION}"
    
    print("[OK] test_taskdata_default_fields passed")


def test_taskdata_validation():
    """Тест валидации TaskData с установкой полей по умолчанию."""
    # Создаем задание без новых полей
    task_dict = {
        "id": "test_003",
        "type": "click",
        "meta": {
            "name": "Тестовое задание",
        },
        "content": {
            "image": "test.png",
        },
    }
    
    task = TaskData.from_dict(task_dict)
    
    # Проверяем что валидация добавила недостающие поля
    assert "task_schema_version" in task.meta, "Должен быть task_schema_version после валидации"
    assert "created_at" in task.meta, "Должен быть created_at после валидации"
    assert task.meta["task_schema_version"] == CURRENT_SCHEMA_VERSION, \
        "task_schema_version должен быть установлен при валидации"
    
    print("[OK] test_taskdata_validation passed")


def test_round_trip_migration():
    """Тест полного цикла: сохранение старого формата -> загрузка -> сохранение нового."""
    # Создаем задание в старом формате
    old_task_data = {
        "id": "test_004",
        "type": "test",
        "name": "Тестовое задание",
        "questions": [
            {
                "id": 1,
                "text": "Вопрос?",
                "answers": [
                    {"text": "Ответ 1", "correct": False},
                    {"text": "Ответ 2", "correct": True},
                ],
            },
        ],
    }
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        
        # Сохраняем старое задание
        with open(task_path, "w", encoding="utf-8") as f:
            json.dump(old_task_data, f, ensure_ascii=False, indent=2)
        
        # Загружаем (миграция)
        task = TaskIO.load(str(task_path))
        assert task is not None, "Задание должно быть загружено"
        
        # Проверяем что данные сохранены
        assert task.data["content"]["questions"] == old_task_data["questions"], \
            "Вопросы должны быть сохранены в content"
        
        # Сохраняем обратно
        new_task_path = Path(temp_dir) / "task_new.json"
        TaskIO.save(task, str(new_task_path))
        
        # Загружаем новое задание
        with open(new_task_path, "r", encoding="utf-8") as f:
            new_task_data = json.load(f)
        
        # Проверяем что структура новая
        assert new_task_data["meta"]["task_schema_version"] == CURRENT_SCHEMA_VERSION, \
            "Должен быть task_schema_version в новом файле"
        assert "content" in new_task_data, "Должна быть структура content"
        assert new_task_data["content"]["questions"] == old_task_data["questions"], \
            "Вопросы должны быть сохранены"
        
        print("[OK] test_round_trip_migration passed")


if __name__ == "__main__":
    print("Запуск интеграционных тестов миграций...\n")
    
    try:
        test_taskdata_default_fields()
        test_taskdata_validation()
        test_taskio_loads_old_format()
        test_taskio_saves_new_format()
        test_taskio_auto_migration()
        test_round_trip_migration()
        
        print("\n[OK] Все интеграционные тесты миграций прошли успешно!")
    except Exception as e:
        print(f"\n[ERROR] Ошибка в тестах: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


















































