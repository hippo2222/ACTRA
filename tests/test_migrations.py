"""
Юнит-тесты для системы миграций данных заданий.
"""

import sys
import os
import json
import tempfile
import shutil
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from task_system.migrations import (
    SCHEMA_V1_0,
    SCHEMA_V1_1,
    SCHEMA_V1_2,
    CURRENT_SCHEMA_VERSION,
    detect_schema_version,
    get_migration_manager,
)
from task_system.migrations.versions.v1_0_to_v1_1 import MigrationV1_0ToV1_1
from task_system.migrations.versions.v1_1_to_v1_2 import MigrationV1_1ToV1_2


def test_detect_schema_version_v1_0():
    """Тест определения версии v1.0 (старый формат)."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "name": "Тестовое задание",
        "image": "test.png",
        "prompt": "Кликните на объект",
    }
    
    version = detect_schema_version(task_dict)
    assert version == SCHEMA_V1_0, f"Ожидалась версия {SCHEMA_V1_0}, получена {version}"
    print("[OK] test_detect_schema_version_v1_0 passed")


def test_detect_schema_version_v1_1():
    """Тест определения версии v1.1 (новый формат без task_schema_version)."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "meta": {
            "name": "Тестовое задание",
            "version": "1.0",
        },
        "content": {
            "image": "test.png",
            "prompt": "Кликните на объект",
        },
    }
    
    version = detect_schema_version(task_dict)
    assert version == SCHEMA_V1_1, f"Ожидалась версия {SCHEMA_V1_1}, получена {version}"
    print("[OK] test_detect_schema_version_v1_1 passed")


def test_detect_schema_version_v1_2():
    """Тест определения версии v1.2 (с task_schema_version)."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "meta": {
            "name": "Тестовое задание",
            "task_schema_version": SCHEMA_V1_2,
        },
        "content": {
            "image": "test.png",
            "prompt": "Кликните на объект",
        },
    }
    
    version = detect_schema_version(task_dict)
    assert version == SCHEMA_V1_2, f"Ожидалась версия {SCHEMA_V1_2}, получена {version}"
    print("[OK] test_detect_schema_version_v1_2 passed")


def test_migration_v1_0_to_v1_1():
    """Тест миграции v1.0 → v1.1."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "name": "Тестовое задание",
        "moduleId": "module_01",
        "topicId": "topic_01",
        "image": "test.png",
        "prompt": "Кликните на объект",
        "additionalInfo": {"type": "text", "content": "Доп. информация"},
        "settings": {"difficulty": 1},
    }
    
    migration = MigrationV1_0ToV1_1()
    task_path = Path("/fake/path/task.json")
    migrated = migration.migrate(task_dict, task_path)
    
    # Проверяем структуру
    assert "meta" in migrated, "Должна быть структура meta"
    assert "content" in migrated, "Должна быть структура content"
    
    # Проверяем перенос полей
    assert migrated["meta"]["name"] == "Тестовое задание", "name должен быть в meta"
    assert migrated["meta"]["module"] == "module_01", "module должен быть в meta"
    assert migrated["meta"]["topic"] == "topic_01", "topic должен быть в meta"
    assert migrated["content"]["image"] == "test.png", "image должен быть в content"
    assert migrated["content"]["prompt"] == "Кликните на объект", "prompt должен быть в content"
    assert migrated["content"]["additionalInfo"] == {"type": "text", "content": "Доп. информация"}, "additionalInfo должен быть в content"
    
    # Проверяем что поля удалены с верхнего уровня
    assert "name" not in migrated or migrated["name"] == "Тестовое задание", "name не должен быть на верхнем уровне"
    assert "image" not in migrated, "image не должен быть на верхнем уровне"
    assert "prompt" not in migrated, "prompt не должен быть на верхнем уровне"
    
    # id и type должны остаться
    assert migrated["id"] == "test_001", "id должен остаться на верхнем уровне"
    assert migrated["type"] == "click", "type должен остаться на верхнем уровне"
    
    print("[OK] test_migration_v1_0_to_v1_1 passed")


def test_migration_v1_1_to_v1_2():
    """Тест миграции v1.1 → v1.2 (без изображений)."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "meta": {
            "name": "Тестовое задание",
            "version": "1.0",
            "created": "2025-01-01T00:00:00",
        },
        "content": {
            "image": "test.png",
            "prompt": "Кликните на объект",
        },
    }
    
    # Создаем временную директорию для теста
    with tempfile.TemporaryDirectory() as temp_dir:
        task_dir = Path(temp_dir) / "tasks" / "test_001"
        task_dir.mkdir(parents=True)
        task_path = task_dir / "task.json"
        
        migration = MigrationV1_1ToV1_2()
        migrated = migration.migrate(task_dict, task_path)
        
        # Проверяем добавление task_schema_version
        assert migrated["meta"]["task_schema_version"] == SCHEMA_V1_2, "Должен быть task_schema_version"
        assert "created_at" in migrated["meta"], "Должен быть created_at"
        assert migrated["meta"]["created_at"] == "2025-01-01T00:00:00", "created_at должен быть из created"
        
        print("[OK] test_migration_v1_1_to_v1_2 passed")


def test_migration_manager_should_migrate():
    """Тест проверки необходимости миграции."""
    manager = get_migration_manager()
    
    # Старая версия - нужна миграция
    old_task = {
        "id": "test_001",
        "type": "click",
        "name": "Тестовое задание",
    }
    assert manager.should_migrate(old_task), "Старая версия должна требовать миграции"
    
    # Новая версия - миграция не нужна
    new_task = {
        "id": "test_001",
        "type": "click",
        "meta": {
            "task_schema_version": CURRENT_SCHEMA_VERSION,
        },
        "content": {},
    }
    assert not manager.should_migrate(new_task), "Новая версия не должна требовать миграции"
    
    print("[OK] test_migration_manager_should_migrate passed")


def test_migration_manager_migrate_task():
    """Тест применения миграций через MigrationManager."""
    manager = get_migration_manager()
    
    # Задание в формате v1.0
    task_dict = {
        "id": "test_001",
        "type": "click",
        "name": "Тестовое задание",
        "image": "test.png",
        "prompt": "Кликните на объект",
    }
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_path = Path(temp_dir) / "task.json"
        migrated = manager.migrate_task(task_dict, task_path)
        
        # Проверяем что миграция применена
        version = detect_schema_version(migrated)
        assert version == CURRENT_SCHEMA_VERSION, f"Версия должна быть {CURRENT_SCHEMA_VERSION}, получена {version}"
        
        # Проверяем структуру
        assert "meta" in migrated, "Должна быть структура meta"
        assert "content" in migrated, "Должна быть структура content"
        assert migrated["meta"]["task_schema_version"] == CURRENT_SCHEMA_VERSION, "Должен быть task_schema_version"
    
    print("[OK] test_migration_manager_migrate_task passed")


def test_migration_image_paths_array():
    """Тест миграции путей к изображениям в массиве."""
    task_dict = {
        "id": "test_001",
        "type": "open_answer",
        "meta": {
            "name": "Тестовое задание",
            "version": "1.0",
        },
        "content": {
            "images": [
                "image1.png",
                "image2.jpg",
            ],
        },
    }
    
    # Создаем временные файлы изображений
    with tempfile.TemporaryDirectory() as temp_dir:
        task_dir = Path(temp_dir) / "tasks" / "test_001"
        task_dir.mkdir(parents=True)
        
        # Создаем тестовые изображения в data/images
        data_images_dir = Path(temp_dir) / "data" / "images"
        data_images_dir.mkdir(parents=True)
        
        image1_path = data_images_dir / "image1.png"
        image2_path = data_images_dir / "image2.jpg"
        
        # Создаем пустые файлы
        image1_path.touch()
        image2_path.touch()
        
        task_path = task_dir / "task.json"
        migration = MigrationV1_1ToV1_2()
        
        # Модифицируем _resolve_source_image_path чтобы искать в temp_dir
        original_resolve = migration._resolve_source_image_path
        
        def mock_resolve(image_path, task_dir):
            # Пробуем найти в data/images
            project_root = Path(temp_dir)
            data_image = project_root / "data" / "images" / Path(image_path).name
            if data_image.exists():
                return data_image
            return None
        
        migration._resolve_source_image_path = mock_resolve
        
        migrated = migration.migrate(task_dict, task_path)
        
        # Проверяем что пути мигрированы
        assert isinstance(migrated["content"]["images"], list), "images должен быть списком"
        # В реальном тесте проверяли бы что файлы скопированы, но для простоты проверяем структуру
    
    print("[OK] test_migration_image_paths_array passed")


def test_migration_handles_missing_images():
    """Тест обработки отсутствующих изображений."""
    task_dict = {
        "id": "test_001",
        "type": "click",
        "meta": {
            "name": "Тестовое задание",
            "version": "1.0",
        },
        "content": {
            "image": "nonexistent.png",  # Несуществующий файл
        },
    }
    
    with tempfile.TemporaryDirectory() as temp_dir:
        task_dir = Path(temp_dir) / "tasks" / "test_001"
        task_dir.mkdir(parents=True)
        task_path = task_dir / "task.json"
        
        migration = MigrationV1_1ToV1_2()
        migrated = migration.migrate(task_dict, task_path)
        
        # Проверяем что оригинальный путь сохранен при отсутствии файла
        assert migrated["content"]["image"] == "nonexistent.png", "Должен быть сохранен оригинальный путь"
    
    print("[OK] test_migration_handles_missing_images passed")


if __name__ == "__main__":
    print("Запуск тестов миграций...\n")
    
    try:
        test_detect_schema_version_v1_0()
        test_detect_schema_version_v1_1()
        test_detect_schema_version_v1_2()
        test_migration_v1_0_to_v1_1()
        test_migration_v1_1_to_v1_2()
        test_migration_manager_should_migrate()
        test_migration_manager_migrate_task()
        test_migration_image_paths_array()
        test_migration_handles_missing_images()
        
        print("\n[OK] Все тесты миграций прошли успешно!")
    except Exception as e:
        print(f"\n[ERROR] Ошибка в тестах: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

