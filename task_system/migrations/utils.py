"""
Утилиты для анализа версий заданий и миграций.
"""

import json
import logging
from pathlib import Path
from typing import Dict, List, Tuple, Any
from collections import defaultdict

from .schema import detect_schema_version, CURRENT_SCHEMA_VERSION
from .migration_manager import MigrationManager

logger = logging.getLogger(__name__)


def analyze_task_versions(data_dir: Path) -> Dict[str, Any]:
    """
    Анализирует версии всех заданий в директории данных.
    
    Args:
        data_dir: Путь к директории с данными (обычно data/)
        
    Returns:
        Словарь со статистикой:
        - versions: распределение по версиям
        - tasks_by_version: список заданий по версиям
        - tasks_with_absolute_paths: задания с абсолютными путями
        - tasks_with_missing_images: задания с отсутствующими изображениями
    """
    stats = {
        "versions": defaultdict(int),
        "tasks_by_version": defaultdict(list),
        "tasks_with_absolute_paths": [],
        "tasks_with_missing_images": [],
        "total_tasks": 0,
    }
    
    # Находим все task.json файлы
    tasks_dir = data_dir / "modules"
    if not tasks_dir.exists():
        logger.warning(f"Directory not found: {tasks_dir}")
        return stats
    
    task_files = list(tasks_dir.rglob("task.json"))
    stats["total_tasks"] = len(task_files)
    
    for task_file in task_files:
        try:
            with open(task_file, "r", encoding="utf-8") as f:
                task_data = json.load(f)
            
            # Определяем версию
            version = detect_schema_version(task_data)
            stats["versions"][version] += 1
            stats["tasks_by_version"][version].append(str(task_file))
            
            # Проверяем абсолютные пути
            if _has_absolute_paths(task_data):
                stats["tasks_with_absolute_paths"].append(str(task_file))
            
            # Проверяем отсутствующие изображения
            missing = _check_missing_images(task_data, task_file.parent)
            if missing:
                stats["tasks_with_missing_images"].append({
                    "task": str(task_file),
                    "missing_images": missing,
                })
        
        except Exception as e:
            logger.error(f"Error analyzing {task_file}: {e}")
    
    return stats


def _has_absolute_paths(task_data: Dict[str, Any]) -> bool:
    """Проверяет наличие абсолютных путей к изображениям."""
    import os
    
    content = task_data.get("content", {})
    
    # Проверяем основное изображение
    if "image" in content and content["image"]:
        if isinstance(content["image"], str) and os.path.isabs(content["image"]):
            return True
    
    # Проверяем additionalInfo.image
    if "additionalInfo" in content and isinstance(content["additionalInfo"], dict):
        if "image" in content["additionalInfo"] and content["additionalInfo"]["image"]:
            if isinstance(content["additionalInfo"]["image"], str) and os.path.isabs(
                content["additionalInfo"]["image"]
            ):
                return True
    
    # Проверяем массив изображений
    if "images" in content and isinstance(content["images"], list):
        for img in content["images"]:
            if isinstance(img, str) and os.path.isabs(img):
                return True
    
    # Проверяем изображения в вопросах
    if "questions" in content and isinstance(content["questions"], list):
        for question in content["questions"]:
            if not isinstance(question, dict):
                continue
            if "answers" in question and isinstance(question["answers"], list):
                for answer in question["answers"]:
                    if not isinstance(answer, dict):
                        continue
                    if "image_path" in answer and answer["image_path"]:
                        if isinstance(answer["image_path"], str) and os.path.isabs(
                            answer["image_path"]
                        ):
                            return True
    
    return False


def _check_missing_images(
    task_data: Dict[str, Any], task_dir: Path
) -> List[str]:
    """Проверяет отсутствующие изображения в задании."""
    missing = []
    content = task_data.get("content", {})
    
    # Проверяем основное изображение
    if "image" in content and content["image"]:
        if not _image_exists(content["image"], task_dir):
            missing.append(content["image"])
    
    # Проверяем additionalInfo.image
    if "additionalInfo" in content and isinstance(content["additionalInfo"], dict):
        if "image" in content["additionalInfo"] and content["additionalInfo"]["image"]:
            if not _image_exists(
                content["additionalInfo"]["image"], task_dir
            ):
                missing.append(content["additionalInfo"]["image"])
    
    # Проверяем массив изображений
    if "images" in content and isinstance(content["images"], list):
        for img in content["images"]:
            if isinstance(img, str) and not _image_exists(img, task_dir):
                missing.append(img)
    
    # Проверяем изображения в вопросах
    if "questions" in content and isinstance(content["questions"], list):
        for question in content["questions"]:
            if not isinstance(question, dict):
                continue
            if "answers" in question and isinstance(question["answers"], list):
                for answer in question["answers"]:
                    if not isinstance(answer, dict):
                        continue
                    if "image_path" in answer and answer["image_path"]:
                        if not _image_exists(answer["image_path"], task_dir):
                            missing.append(answer["image_path"])
    
    return missing


def _image_exists(image_path: str, task_dir: Path) -> bool:
    """Проверяет существование изображения."""
    import os
    
    if not image_path:
        return True
    
    # Проверяем абсолютный путь
    if os.path.isabs(image_path):
        return os.path.exists(image_path)
    
    # Проверяем путь относительно task_dir
    task_image = task_dir / image_path
    if task_image.exists():
        return True
    
    # Проверяем путь относительно data/images
    # Предполагаем что data/images находится на 5 уровней выше
    project_root = task_dir
    for _ in range(5):
        project_root = project_root.parent
        data_image = project_root / "data" / "images" / Path(image_path).name
        if data_image.exists():
            return True
    
    # Проверяем относительный путь к data/images
    normalized = image_path.replace("\\", "/")
    if normalized.startswith("../data/images/") or normalized.startswith("data/images/"):
        rel_path = normalized.replace("../data/images/", "").replace("data/images/", "")
        data_image = project_root / "data" / "images" / rel_path
        if data_image.exists():
            return True
    
    return False


def report_migration_readiness(data_dir: Path) -> str:
    """
    Формирует отчет о готовности к миграции.
    
    Args:
        data_dir: Путь к директории с данными
        
    Returns:
        Текст отчета
    """
    stats = analyze_task_versions(data_dir)
    
    report_lines = []
    report_lines.append("=" * 60)
    report_lines.append("ОТЧЕТ О ГОТОВНОСТИ К МИГРАЦИИ")
    report_lines.append("=" * 60)
    report_lines.append("")
    
    report_lines.append(f"Всего заданий: {stats['total_tasks']}")
    report_lines.append("")
    
    # Распределение по версиям
    report_lines.append("Распределение по версиям:")
    for version in sorted(stats["versions"].keys()):
        count = stats["versions"][version]
        percentage = (count / stats["total_tasks"] * 100) if stats["total_tasks"] > 0 else 0
        marker = " [OK]" if version == CURRENT_SCHEMA_VERSION else " [NEEDS MIGRATION]"
        report_lines.append(f"  v{version}: {count} ({percentage:.1f}%){marker}")
    report_lines.append("")
    
    # Задания с абсолютными путями
    if stats["tasks_with_absolute_paths"]:
        report_lines.append(
            f"Задания с абсолютными путями ({len(stats['tasks_with_absolute_paths'])}):"
        )
        for task in stats["tasks_with_absolute_paths"][:10]:  # Первые 10
            report_lines.append(f"  - {task}")
        if len(stats["tasks_with_absolute_paths"]) > 10:
            report_lines.append(
                f"  ... и еще {len(stats['tasks_with_absolute_paths']) - 10} заданий"
            )
        report_lines.append("")
    
    # Задания с отсутствующими изображениями
    if stats["tasks_with_missing_images"]:
        report_lines.append(
            f"Задания с отсутствующими изображениями ({len(stats['tasks_with_missing_images'])}):"
        )
        for item in stats["tasks_with_missing_images"][:10]:  # Первые 10
            report_lines.append(f"  - {item['task']}")
            for img in item["missing_images"]:
                report_lines.append(f"    Отсутствует: {img}")
        if len(stats["tasks_with_missing_images"]) > 10:
            report_lines.append(
                f"  ... и еще {len(stats['tasks_with_missing_images']) - 10} заданий"
            )
        report_lines.append("")
    
    # Рекомендации
    report_lines.append("РЕКОМЕНДАЦИИ:")
    needs_migration = stats["versions"].get("1.0", 0) + stats["versions"].get("1.1", 0)
    if needs_migration > 0:
        report_lines.append(
            f"  - Требуется миграция для {needs_migration} заданий"
        )
    if stats["tasks_with_absolute_paths"]:
        report_lines.append(
            f"  - Необходимо исправить {len(stats['tasks_with_absolute_paths'])} заданий с абсолютными путями"
        )
    if stats["tasks_with_missing_images"]:
        report_lines.append(
            f"  - Проверить {len(stats['tasks_with_missing_images'])} заданий с отсутствующими изображениями"
        )
    if needs_migration == 0 and not stats["tasks_with_absolute_paths"]:
        report_lines.append("  - Все задания готовы к использованию!")
    
    report_lines.append("")
    report_lines.append("=" * 60)
    
    return "\n".join(report_lines)


















































