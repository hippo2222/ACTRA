"""
Миграция v1.1 → v1.2

Добавляет task_schema_version и мигрирует изображения в относительные пути.
"""

import logging
import os
import shutil
from pathlib import Path
from typing import Dict, Any, Optional, List, Union
from copy import deepcopy
import hashlib

from ..migration_base import BaseMigration
from ..schema import SCHEMA_V1_1, SCHEMA_V1_2

logger = logging.getLogger(__name__)


class MigrationV1_1ToV1_2(BaseMigration):
    """
    Миграция из версии 1.1 в версию 1.2.
    
    Добавляет task_schema_version в meta и мигрирует все пути к изображениям
    в относительные от папки задания.
    """
    
    from_version = SCHEMA_V1_1
    to_version = SCHEMA_V1_2
    
    def migrate(self, task_dict: Dict[str, Any], task_path: Path) -> Dict[str, Any]:
        """
        Применяет миграцию v1.1 → v1.2.
        
        - Добавляет meta.task_schema_version = "1.2"
        - Добавляет meta.created_at если отсутствует
        - Мигрирует все пути к изображениям
        """
        logger.info(
            f"Migrating task {task_path} from {self.from_version} to {self.to_version}"
        )
        
        # Создаем копию для безопасной модификации
        result = deepcopy(task_dict)
        
        # Убеждаемся что есть meta
        if "meta" not in result:
            result["meta"] = {}
        
        # Убеждаемся что есть content
        if "content" not in result:
            result["content"] = {}
        
        # Добавляем task_schema_version
        result["meta"]["task_schema_version"] = self.to_version
        logger.debug(f"Added meta.task_schema_version = {self.to_version}")
        
        # Добавляем created_at если отсутствует
        if "created_at" not in result["meta"]:
            # Пробуем взять из created
            if "created" in result["meta"]:
                result["meta"]["created_at"] = result["meta"]["created"]
            else:
                # Используем текущее время
                from datetime import datetime
                result["meta"]["created_at"] = datetime.now().isoformat()
            logger.debug("Added meta.created_at")
        
        # Добавляем author если отсутствует
        if "author" not in result["meta"]:
            result["meta"]["author"] = ""
            logger.debug("Added meta.author (empty)")
        
        # Мигрируем изображения
        task_dir = task_path.parent
        result = self._migrate_image_paths(result, task_dir)
        
        logger.info(
            f"Successfully migrated task {task_path} from {self.from_version} "
            f"to {self.to_version}"
        )
        
        return result
    
    def _migrate_image_paths(
        self, task_dict: Dict[str, Any], task_dir: Path
    ) -> Dict[str, Any]:
        """
        Мигрирует все пути к изображениям в задании.
        
        Обрабатывает:
        - content.image (основное изображение)
        - content.additionalInfo.image (дополнительное изображение)
        - content.images[] (массив изображений для open_answer)
        - content.questions[].answers[].image_path (изображения в тестах)
        
        Args:
            task_dict: Словарь с данными задания
            task_dir: Директория задания
            
        Returns:
            Обновленный словарь с мигрированными путями
        """
        result = deepcopy(task_dict)
        content = result.get("content", {})
        
        # Мигрируем основное изображение
        if "image" in content and content["image"]:
            content["image"] = self._migrate_single_image_path(
                content["image"], task_dir
            )
        
        # Мигрируем additionalInfo.image
        if "additionalInfo" in content and isinstance(content["additionalInfo"], dict):
            if "image" in content["additionalInfo"] and content["additionalInfo"]["image"]:
                content["additionalInfo"]["image"] = self._migrate_single_image_path(
                    content["additionalInfo"]["image"], task_dir
                )
            # Также обрабатываем content (для типа "image")
            if "content" in content["additionalInfo"] and isinstance(
                content["additionalInfo"]["content"], str
            ):
                # Проверяем если это путь к изображению
                content_path = content["additionalInfo"]["content"]
                if self._is_image_path(content_path):
                    content["additionalInfo"]["content"] = self._migrate_single_image_path(
                        content_path, task_dir
                    )
        
        # Мигрируем массив изображений (для open_answer)
        if "images" in content and isinstance(content["images"], list):
            content["images"] = [
                self._migrate_single_image_path(img, task_dir)
                if isinstance(img, str) and img
                else img
                for img in content["images"]
            ]
        
        # Мигрируем изображения в вопросах теста
        if "questions" in content and isinstance(content["questions"], list):
            for question in content["questions"]:
                if not isinstance(question, dict):
                    continue
                
                # Обрабатываем answers
                if "answers" in question and isinstance(question["answers"], list):
                    for answer in question["answers"]:
                        if not isinstance(answer, dict):
                            continue
                        
                        if "image_path" in answer and answer["image_path"]:
                            answer["image_path"] = self._migrate_single_image_path(
                                answer["image_path"], task_dir
                            )
        
        result["content"] = content
        return result
    
    def _migrate_single_image_path(
        self, image_path: str, task_dir: Path
    ) -> str:
        """
        Мигрирует один путь к изображению.
        
        - Если путь уже относительный от task_dir и файл существует → оставляет как есть
        - Иначе пытается найти исходный файл и скопировать в task_dir
        - Возвращает относительный путь от task_dir
        
        Args:
            image_path: Путь к изображению (может быть абсолютным, относительным и т.д.)
            task_dir: Директория задания
            
        Returns:
            Новый относительный путь к изображению
        """
        if not image_path or not isinstance(image_path, str):
            return image_path
        
        # Если путь уже относительный от task_dir и файл существует
        task_image_path = task_dir / image_path
        if task_image_path.exists() and not os.path.isabs(image_path):
            logger.debug(
                f"Image path already relative to task directory: {image_path}"
            )
            return image_path
        
        # Пытаемся разрешить исходный путь
        resolved_path = self._resolve_source_image_path(image_path, task_dir)
        
        if resolved_path is None or not resolved_path.exists():
            logger.warning(
                f"Source image not found: {image_path}. "
                f"Keeping original path for manual review."
            )
            return image_path
        
        # Определяем имя файла
        filename = resolved_path.name
        dest_path = task_dir / filename
        
        # Проверяем, не дубликат ли это
        if dest_path.exists():
            if self._files_are_same(resolved_path, dest_path):
                logger.debug(
                    f"Image already exists in task directory: {filename}. "
                    f"Using existing file."
                )
                return filename
            else:
                # Файлы разные - создаем уникальное имя
                filename = self._generate_unique_filename(dest_path, filename)
                dest_path = task_dir / filename
        
        try:
            # Копируем файл
            shutil.copy2(resolved_path, dest_path)
            logger.info(
                f"Copied image: {resolved_path} → {dest_path}"
            )
            return filename
        except Exception as e:
            logger.error(
                f"Error copying image {resolved_path} to {dest_path}: {e}",
                exc_info=True,
            )
            # Возвращаем оригинальный путь при ошибке
            return image_path
    
    def _resolve_source_image_path(
        self, image_path: str, task_dir: Path
    ) -> Optional[Path]:
        """
        Разрешает исходный путь к изображению.
        
        Проверяет в следующем порядке:
        1. Абсолютный путь (если файл существует)
        2. Путь относительно task_dir
        3. Относительный путь к data/images/
        4. Файл в data/images/ по имени
        
        Args:
            image_path: Путь к изображению
            task_dir: Директория задания
            
        Returns:
            Path к исходному файлу или None если не найден
        """
        if not image_path:
            return None
        
        # 1. Проверяем абсолютный путь
        if os.path.isabs(image_path):
            path = Path(image_path)
            if path.exists():
                return path
        
        # 2. Проверяем путь относительно task_dir
        task_relative_path = task_dir / image_path
        if task_relative_path.exists():
            return task_relative_path
        
        # 3. Проверяем относительный путь к data/images/
        # Определяем корень проекта (предполагаем что data/ находится на 3 уровня выше task_dir)
        # task_dir обычно: data/modules/.../topics/.../tasks/.../
        project_root = task_dir
        for _ in range(5):  # Пробуем подняться на 5 уровней
            project_root = project_root.parent
            data_images = project_root / "data" / "images"
            if data_images.exists():
                break
        
        # Если путь начинается с ../data/images/ или data/images/
        normalized_path = image_path.replace("\\", "/")
        if normalized_path.startswith("../data/images/") or normalized_path.startswith(
            "data/images/"
        ):
            # Убираем ../data/images/ или data/images/
            rel_path = normalized_path.replace("../data/images/", "").replace(
                "data/images/", ""
            )
            data_image_path = project_root / "data" / "images" / rel_path
            if data_image_path.exists():
                return data_image_path
        
        # 4. Проверяем в data/images/ по имени файла
        filename = Path(image_path).name
        data_image_by_name = project_root / "data" / "images" / filename
        if data_image_by_name.exists():
            return data_image_by_name
        
        # Не найдено
        return None
    
    def _files_are_same(self, path1: Path, path2: Path) -> bool:
        """
        Проверяет, являются ли два файла одинаковыми.
        
        Сравнивает размеры файлов и опционально MD5 хеши.
        
        Args:
            path1: Путь к первому файлу
            path2: Путь ко второму файлу
            
        Returns:
            True если файлы одинаковые
        """
        if not path1.exists() or not path2.exists():
            return False
        
        # Сравниваем размеры
        if path1.stat().st_size != path2.stat().st_size:
            return False
        
        # Для надежности сравниваем MD5 хеши
        try:
            hash1 = self._file_hash(path1)
            hash2 = self._file_hash(path2)
            return hash1 == hash2
        except Exception as e:
            logger.warning(
                f"Error comparing file hashes: {e}. Assuming files are same based on size."
            )
            # Если не удалось сравнить хеши, считаем файлы одинаковыми
            # если размеры совпадают
            return True
    
    def _file_hash(self, path: Path) -> str:
        """
        Вычисляет MD5 хеш файла.
        
        Args:
            path: Путь к файлу
            
        Returns:
            MD5 хеш в виде строки
        """
        hash_md5 = hashlib.md5()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_md5.update(chunk)
        return hash_md5.hexdigest()
    
    def _generate_unique_filename(self, existing_path: Path, base_filename: str) -> str:
        """
        Генерирует уникальное имя файла если файл уже существует.
        
        Args:
            existing_path: Путь к существующему файлу
            base_filename: Базовое имя файла
            
        Returns:
            Уникальное имя файла
        """
        stem = existing_path.stem
        suffix = existing_path.suffix
        parent = existing_path.parent
        
        counter = 1
        while True:
            new_filename = f"{stem}_{counter}{suffix}"
            new_path = parent / new_filename
            if not new_path.exists():
                return new_filename
            counter += 1
            
            # Защита от бесконечного цикла
            if counter > 1000:
                raise RuntimeError(
                    f"Cannot generate unique filename for {base_filename}"
                )
    
    def _is_image_path(self, path: str) -> bool:
        """
        Проверяет, является ли строка путем к изображению.
        
        Args:
            path: Строка для проверки
            
        Returns:
            True если это похоже на путь к изображению
        """
        if not isinstance(path, str):
            return False
        
        # Проверяем расширения изображений
        image_extensions = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp"}
        path_lower = path.lower()
        
        # Проверяем расширение
        if any(path_lower.endswith(ext) for ext in image_extensions):
            return True
        
        # Проверяем если содержит путь (/, \, C:)
        if "/" in path or "\\" in path or (len(path) > 1 and path[1] == ":"):
            return True
        
        return False
    
    def validate(self, task_dict: Dict[str, Any]) -> bool:
        """
        Проверяет корректность данных для миграции v1.1 → v1.2.
        
        Для v1.1 должны присутствовать структуры meta и content.
        """
        if not isinstance(task_dict, dict):
            return False
        
        if "meta" not in task_dict or "content" not in task_dict:
            logger.warning("Task missing required structures: meta or content")
            return False
        
        if "id" not in task_dict or "type" not in task_dict:
            logger.warning("Task missing required fields: id or type")
            return False
        
        return True


















































