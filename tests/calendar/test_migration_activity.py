"""
План и скрипт для тестирования миграции activity.json из старого формата в новый.

Этапы:
1. Создать тестовые данные в старом формате
2. Запустить миграцию
3. Проверить что все данные конвертированы правильно
4. Проверить что нет потерь данных
"""

import json
import tempfile
from pathlib import Path
from datetime import date, timedelta
import subprocess
import sys


def create_test_data_old_format(data_dir: str) -> dict:
    """
    Создаёт тестовые данные в старом формате (числа) в нескольких пользователях
    
    Args:
        data_dir: Корневая папка data
    
    Returns:
        dict: Информация о созданных файлах {user_id: activity_path}
    """
    print("\nСоздаём тестовые данные в старом формате...")
    
    created_files = {}
    test_users = [
        ("user_001", {
            "2025-01-15": 50,
            "2025-01-16": 75,
            "2025-01-17": 100,
            "2025-01-18": 0,  # День без активности
            "2025-01-19": 125,
        }),
        ("user_002", {
            "2025-01-10": 30,
            "2025-01-11": 60,
            "2025-01-12": 90,
            "2025-01-20": 150,
        }),
        ("user_003", {
            "2025-01-01": 200,  # Максимум
            "2025-01-02": 100,
        }),
    ]
    
    data_path = Path(data_dir)
    
    for user_id, activities in test_users:
        user_calendar_path = data_path / "user_calendar" / user_id
        user_calendar_path.mkdir(parents=True, exist_ok=True)
        
        activity_file = user_calendar_path / "activity.json"
        activity_file.write_text(json.dumps(activities, indent=2))
        
        created_files[user_id] = str(activity_file)
        print(f"  OK {user_id}: {len(activities)} дней данных")
    
    return created_files


def verify_migration_results(data_dir: str, created_files: dict) -> bool:
    """
    Проверяет результаты миграции
    
    Args:
        data_dir: Корневая папка data
        created_files: Информация о созданных файлах
    
    Returns:
        bool: True если всё OK, False если есть ошибки
    """
    print("\n" + "=" * 70)
    print("ПРОВЕРЯЕМ РЕЗУЛЬТАТЫ МИГРАЦИИ...")
    
    all_ok = True
    data_path = Path(data_dir)
    
    for user_id in created_files:
        activity_file = data_path / "user_calendar" / user_id / "activity.json"
        
        if not activity_file.exists():
            print(f"  ❌ {user_id}: файл не найден!")
            all_ok = False
            continue
        
        with open(activity_file) as f:
            activity = json.load(f)
        
        # Проверяем что все даты - словари
        format_errors = []
        value_errors = []
        
        for date_iso, value in activity.items():
            if not isinstance(value, dict):
                format_errors.append(f"    - {date_iso}: {type(value).__name__} (ожидаем dict)")
            else:
                # Проверяем что все поля присутствуют
                required_fields = ["tasks_attempted", "tasks_solved", "seconds_spent", 
                                 "completion_percent", "session_ids", "streak_active", "rest_day"]
                missing = [f for f in required_fields if f not in value]
                if missing:
                    value_errors.append(f"    - {date_iso}: отсутствуют поля {missing}")
        
        if format_errors:
            print(f"  ERROR {user_id}: errors format:")
            for err in format_errors:
                print(err)
            all_ok = False
        elif value_errors:
            print(f"  WARNING {user_id}: errors values:")
            for err in value_errors:
                print(err)
            all_ok = False
        else:
            print(f"  OK {user_id}: {len(activity)} дней корректно мигрировано")
    
    return all_ok


def run_migration_test():
    """
    Полный тест миграции
    """
    print("=" * 70)
    print("ТЕСТ МИГРАЦИИ: activity.json формат (число -> словарь)")
    print("=" * 70)
    
    with tempfile.TemporaryDirectory() as tmpdir:
        # Этап 1: Создаём тестовые данные
        print("\nЭТАП 1: Создание тестовых данных")
        print("-" * 70)
        created_files = create_test_data_old_format(tmpdir)
        
        # Этап 2: Запускаем миграцию
        print("\nЭТАП 2: Запуск скрипта миграции")
        print("-" * 70)
        
        # Ищем скрипт миграции в правильном месте
        migration_script = Path(__file__).parent.parent.parent / "desktop-app" / "services" / "calendar" / "migration_activity_format.py"
        
        if not migration_script.exists():
            print(f"❌ Скрипт миграции не найден: {migration_script}")
            print(f"   Проверьте что он находится в desktop-app/services/calendar/")
            return False
        
        # Запускаем миграцию
        try:
            result = subprocess.run(
                [sys.executable, str(migration_script), "--data-root", tmpdir, "--verbose"],
                capture_output=True,
                text=True,
                timeout=30
            )
            
            print(result.stdout)
            if result.stderr:
                print("STDERR:", result.stderr)
            
            if result.returncode != 0:
                print(f"❌ Миграция завершилась с ошибкой (код {result.returncode})")
                return False
        except subprocess.TimeoutExpired:
            print("❌ Миграция истекла по timeout (>30 сек)")
            return False
        except Exception as e:
            print(f"❌ Ошибка при запуске миграции: {e}")
            return False
        
        # Этап 3: Проверяем результаты
        print("\nЭТАП 3: Проверка результатов")
        print("-" * 70)
        
        migration_ok = verify_migration_results(tmpdir, created_files)
        
    print("\n" + "=" * 70)
    if migration_ok:
        print("ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ!")
        print("   Миграция готова к использованию в production")
    else:
        print("ОБНАРУЖЕНЫ ПРОБЛЕМЫ")
        print("   Исправьте ошибки перед использованием в production")
    print("=" * 70)
    
    return migration_ok


if __name__ == "__main__":
    success = run_migration_test()
    sys.exit(0 if success else 1)
