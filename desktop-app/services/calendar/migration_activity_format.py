"""
Скрипт миграции для activity.json из старого формата в новый.

Старый формат: {"2025-01-24": 80}
Новый формат: {"2025-01-24": {...словарь...}}

Использование:
    python migration_activity_format.py --data-root /path/to/data
    
    или
    
    from migration_activity_format import migrate_all_users
    migrate_all_users(data_root_path)
"""

import json
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime

logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


def create_empty_activity_record() -> Dict[str, Any]:
    """Создать пустую запись активности в новом формате."""
    return {
        "tasks_attempted": 0,
        "tasks_solved": 0,
        "seconds_spent": 0,
        "completion_percent": 0,
        "session_ids": [],
        "streak_active": False,
        "rest_day": False,
    }


def migrate_activity_file(activity_path: Path) -> Optional[Dict[str, Any]]:
    """
    Мигрировать одиночный activity.json файл.
    
    Args:
        activity_path: Путь к файлу activity.json
        
    Returns:
        Мигрированные данные или None если ошибка
    """
    if not activity_path.exists():
        logger.debug(f"Файл не существует: {activity_path}")
        return None
    
    try:
        # Читаем текущий файл
        with open(activity_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        if not data:
            logger.debug(f"Файл пуст: {activity_path}")
            return data
        
        # Проверяем нужна ли миграция
        needs_migration = False
        for date_str, value in data.items():
            if not isinstance(value, dict):
                needs_migration = True
                break
        
        if not needs_migration:
            logger.debug(f"Миграция не требуется: {activity_path}")
            return data
        
        # Мигрируем данные
        migrated_data = {}
        for date_str, value in data.items():
            if isinstance(value, dict):
                # Уже в новом формате
                migrated_data[date_str] = value
            else:
                # Старый формат (число) → новый (словарь)
                migrated_data[date_str] = {
                    "tasks_attempted": 0,
                    "tasks_solved": 0,
                    "seconds_spent": 0,
                    "completion_percent": int(value) if isinstance(value, (int, float)) else 0,
                    "session_ids": [],
                    "streak_active": False,
                    "rest_day": False,
                }
                logger.info(
                    f"Мигрировано значение",
                    extra={
                        "file": activity_path.name,
                        "date": date_str,
                        "old_value": value,
                        "new_completion_percent": migrated_data[date_str]["completion_percent"]
                    }
                )
        
        # Сохраняем мигрированные данные
        with open(activity_path, "w", encoding="utf-8") as f:
            json.dump(migrated_data, f, ensure_ascii=False, indent=2)
        
        logger.info(
            f"Успешно мигрирован файл",
            extra={
                "file": activity_path,
                "items_count": len(migrated_data)
            }
        )
        
        return migrated_data
        
    except Exception as e:
        logger.error(
            f"Ошибка при миграции файла",
            extra={
                "file": activity_path,
                "error": str(e)
            }
        )
        return None


def migrate_user_calendar(user_calendar_dir: Path) -> Dict[str, Any]:
    """
    Мигрировать всё данные пользователя (activity.json).
    
    Args:
        user_calendar_dir: Путь к папке user_calendar/{user_id}
        
    Returns:
        Dict с результатами миграции
    """
    activity_path = user_calendar_dir / "activity.json"
    user_id = user_calendar_dir.name
    
    result = {
        "user_id": user_id,
        "success": False,
        "migrated": False,
        "error": None,
        "file_path": str(activity_path),
    }
    
    if not activity_path.exists():
        result["error"] = "File not found"
        return result
    
    migrated_data = migrate_activity_file(activity_path)
    
    if migrated_data is None:
        result["error"] = "Migration failed"
        return result
    
    result["success"] = True
    
    # Проверяем была ли миграция нужна
    needs_migration = False
    for value in migrated_data.values():
        if not isinstance(value, dict):
            needs_migration = True
            break
    
    result["migrated"] = needs_migration
    
    return result


def migrate_all_users(data_root: Path) -> Dict[str, Any]:
    """
    Мигрировать activity.json для всех пользователей.
    
    Args:
        data_root: Корневая папка данных
        
    Returns:
        Dict с результатами для всех пользователей
    """
    user_calendar_dir = data_root / "user_calendar"
    
    if not user_calendar_dir.exists():
        logger.warning(f"Директория не найдена: {user_calendar_dir}")
        return {
            "success": False,
            "error": "user_calendar directory not found",
            "total_users": 0,
            "migrated_users": 0,
            "users": []
        }
    
    results = []
    migrated_count = 0
    error_count = 0
    
    logger.info(f"Начало миграции пользователей из {user_calendar_dir}")
    
    # Итерируем по всем пользователям
    for user_dir in user_calendar_dir.iterdir():
        if not user_dir.is_dir():
            continue
        
        result = migrate_user_calendar(user_dir)
        results.append(result)
        
        if result["success"]:
            if result["migrated"]:
                migrated_count += 1
                logger.info(f"✓ Мигрирован пользователь: {result['user_id']}")
            else:
                logger.debug(f"✓ Уже в новом формате: {result['user_id']}")
        else:
            error_count += 1
            logger.error(f"✗ Ошибка для {result['user_id']}: {result['error']}")
    
    logger.info(
        f"Миграция завершена",
        extra={
            "total_users": len(results),
            "migrated": migrated_count,
            "errors": error_count
        }
    )
    
    return {
        "success": error_count == 0,
        "error": None if error_count == 0 else f"{error_count} errors during migration",
        "total_users": len(results),
        "migrated_users": migrated_count,
        "error_users": error_count,
        "timestamp": datetime.now().isoformat(),
        "users": results,
    }


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(
        description="Мигрировать activity.json из старого формата в новый"
    )
    parser.add_argument(
        "--data-root",
        type=str,
        default="data",
        help="Путь к корневой папке данных (по умолчанию: data)"
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Подробный вывод"
    )
    
    args = parser.parse_args()
    
    if args.verbose:
        logging.getLogger().setLevel(logging.DEBUG)
    
    data_root = Path(args.data_root).resolve()
    
    if not data_root.exists():
        logger.error(f"Папка не найдена: {data_root}")
        exit(1)
    
    # Запускаем миграцию
    result = migrate_all_users(data_root)
    
    # Выводим результаты
    print(f"\n{'='*60}")
    print(f"Результаты миграции")
    print(f"{'='*60}")
    print(f"Всего пользователей: {result['total_users']}")
    print(f"Мигрировано: {result['migrated_users']}")
    print(f"Ошибки: {result['error_users']}")
    print(f"Успех: {'✓ ДА' if result['success'] else '✗ НЕТ'}")
    print(f"{'='*60}\n")
    
    if result["users"]:
        print("Результаты по пользователям:")
        for user_result in result["users"]:
            status = "✓" if user_result["success"] else "✗"
            migrated = " (МИГРИРОВАНО)" if user_result["migrated"] else ""
            print(f"{status} {user_result['user_id']}{migrated}")
    
    exit(0 if result["success"] else 1)
