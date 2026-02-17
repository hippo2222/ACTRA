"""
Image Service - Централизованная загрузка и обработка изображений.

Предоставляет чистую логику работы с изображениями без привязки к UI:
- Загрузка и валидация изображений
- Изменение размера с сохранением пропорций
- Получение метаданных
- Подготовка изображений для отображения

НЕДЕЛЯ 2, Блок C: Image Service
"""

import os
from pathlib import Path
from typing import Tuple, Optional, Dict, Any
from dataclasses import dataclass
import logging

try:
    from PIL import Image
except ImportError:
    import Image  # fallback


@dataclass
class ImageInfo:
    """
    Метаданные изображения.
    
    Attributes:
        width: Ширина изображения в пикселях
        height: Высота изображения в пикселях
        format: Формат изображения (PNG, JPEG и т.д.)
        mode: Цветовой режим (RGB, RGBA, L и т.д.)
        size_bytes: Размер файла в байтах (опционально)
    """
    width: int
    height: int
    format: str
    mode: str
    size_bytes: Optional[int] = None
    
    @property
    def aspect_ratio(self) -> float:
        """Соотношение сторон (width/height)"""
        return self.width / self.height if self.height > 0 else 1.0
    
    @property
    def megapixels(self) -> float:
        """Количество мегапикселей"""
        return (self.width * self.height) / 1_000_000


@dataclass
class PreparedImage:
    """
    Подготовленное изображение с метаданными.
    
    Содержит оригинальное изображение, изменённое для отображения,
    и все необходимые метаданные.
    
    Attributes:
        original: Оригинальное изображение PIL Image
        display: Изображение для отображения (resized)
        info: Метаданные оригинального изображения
        scale_factor: Коэффициент масштабирования (display/original)
    """
    original: Image.Image
    display: Image.Image
    info: ImageInfo
    scale_factor: float
    
    @property
    def display_size(self) -> Tuple[int, int]:
        """Размер display изображения"""
        return self.display.size
    
    @property
    def original_size(self) -> Tuple[int, int]:
        """Размер оригинального изображения"""
        return self.original.size


class ImageService:
    """
    Сервис для загрузки и обработки изображений.
    
    Предоставляет централизованную логику работы с изображениями:
    - Загрузка с валидацией
    - Изменение размера
    - Получение метаданных
    
    Использование:
        service = ImageService(max_size=(800, 600))
        prepared = service.load_and_prepare("path/to/image.jpg")
        
        # Оригинал и display версия
        original = prepared.original
        display = prepared.display
    """
    
    # Поддерживаемые форматы изображений
    SUPPORTED_FORMATS = {'PNG', 'JPEG', 'JPG', 'BMP', 'GIF', 'TIFF'}
    
    def __init__(self, max_size: Optional[Tuple[int, int]] = None):
        """
        Инициализация ImageService.
        
        Args:
            max_size: Максимальный размер для display изображений (width, height)
                     По умолчанию (800, 600)
        """
        self.max_size = max_size or (800, 600)
        self.logger = logging.getLogger(self.__class__.__name__)
    
    # =========================================================================
    # ЗАГРУЗКА ИЗОБРАЖЕНИЙ
    # =========================================================================
    
    def load_image(self, image_path: str) -> Image.Image:
        """
        Загружает и валидирует изображение.
        
        Args:
            image_path: Путь к файлу изображения
        
        Returns:
            PIL Image object
        
        Raises:
            FileNotFoundError: Если файл не существует
            ValueError: Если формат изображения не поддерживается
            IOError: Если не удалось загрузить изображение
        
        Example:
            >>> service = ImageService()
            >>> image = service.load_image("photo.jpg")
            >>> print(image.size)
            (1920, 1080)
        """
        # Проверка существования файла
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"Image file not found: {image_path}")
        
        # Проверка что это файл, а не директория
        if not os.path.isfile(image_path):
            raise ValueError(f"Path is not a file: {image_path}")
        
        try:
            # Загрузка изображения
            image = Image.open(image_path)
            
            # Валидация формата
            if image.format and image.format.upper() not in self.SUPPORTED_FORMATS:
                self.logger.warning(
                    f"Image format {image.format} may not be fully supported"
                )
            
            # Проверка что изображение валидное (пытаемся загрузить данные)
            image.verify()
            
            # После verify нужно перезагрузить изображение
            image = Image.open(image_path)
            
            self.logger.info(
                f"Loaded image: {Path(image_path).name} "
                f"({image.size[0]}x{image.size[1]}, {image.format})"
            )
            
            return image
            
        except IOError as e:
            raise IOError(f"Failed to load image: {e}")
        except Exception as e:
            raise ValueError(f"Invalid image file: {e}")
    
    # =========================================================================
    # ОБРАБОТКА ИЗОБРАЖЕНИЙ
    # =========================================================================
    
    def prepare_for_display(self, image: Image.Image, 
                           max_size: Optional[Tuple[int, int]] = None) -> Image.Image:
        """
        Изменяет размер изображения с сохранением пропорций.
        
        Использует PIL thumbnail для эффективного изменения размера.
        Оригинальное изображение не изменяется.
        
        Args:
            image: PIL Image для обработки
            max_size: Максимальный размер (width, height).
                     Если None, использует self.max_size
        
        Returns:
            PIL Image - новое изображение с изменённым размером
        
        Example:
            >>> service = ImageService(max_size=(800, 600))
            >>> original = service.load_image("large.jpg")  # 4000x3000
            >>> display = service.prepare_for_display(original)
            >>> print(display.size)  # будет ~800x600 с сохранением пропорций
            (800, 600)
        """
        target_size = max_size or self.max_size
        
        # Создаём копию чтобы не изменять оригинал
        display_image = image.copy()
        
        # thumbnail изменяет изображение in-place, сохраняя пропорции
        display_image.thumbnail(target_size, Image.Resampling.LANCZOS)
        
        self.logger.debug(
            f"Resized image: {image.size} → {display_image.size}"
        )
        
        return display_image
    
    def calculate_scale_factor(self, original_size: Tuple[int, int],
                               display_size: Tuple[int, int]) -> float:
        """
        Вычисляет коэффициент масштабирования.
        
        Args:
            original_size: Размер оригинала (width, height)
            display_size: Размер display версии (width, height)
        
        Returns:
            float: Коэффициент масштабирования (display / original)
        """
        # Используем ширину для расчёта (пропорции сохранены)
        if original_size[0] > 0:
            return display_size[0] / original_size[0]
        return 1.0
    
    # =========================================================================
    # МЕТАДАННЫЕ
    # =========================================================================
    
    def get_image_info(self, image: Image.Image, 
                      file_path: Optional[str] = None) -> ImageInfo:
        """
        Получает метаданные изображения.
        
        Args:
            image: PIL Image
            file_path: Опциональный путь к файлу (для получения размера)
        
        Returns:
            ImageInfo с метаданными
        
        Example:
            >>> service = ImageService()
            >>> image = service.load_image("photo.jpg")
            >>> info = service.get_image_info(image, "photo.jpg")
            >>> print(f"{info.width}x{info.height}, {info.format}")
            1920x1080, JPEG
        """
        width, height = image.size
        format_name = image.format or "Unknown"
        mode = image.mode
        
        # Получаем размер файла если путь предоставлен
        size_bytes = None
        if file_path and os.path.exists(file_path):
            try:
                size_bytes = os.path.getsize(file_path)
            except OSError:
                pass
        
        return ImageInfo(
            width=width,
            height=height,
            format=format_name,
            mode=mode,
            size_bytes=size_bytes
        )
    
    # =========================================================================
    # КОМБИНИРОВАННЫЕ МЕТОДЫ
    # =========================================================================
    
    def load_and_prepare(self, image_path: str,
                        max_size: Optional[Tuple[int, int]] = None) -> PreparedImage:
        """
        One-stop метод: загружает и подготавливает изображение.
        
        Выполняет полный цикл:
        1. Загрузка изображения
        2. Получение метаданных
        3. Подготовка display версии
        4. Расчёт scale_factor
        
        Args:
            image_path: Путь к файлу изображения
            max_size: Максимальный размер для display (опционально)
        
        Returns:
            PreparedImage со всеми данными
        
        Raises:
            FileNotFoundError: Если файл не найден
            ValueError: Если формат не поддерживается
            IOError: Если не удалось загрузить
        
        Example:
            >>> service = ImageService(max_size=(800, 600))
            >>> prepared = service.load_and_prepare("large_image.jpg")
            >>> 
            >>> # Используем оригинал для высококачественной обработки
            >>> original = prepared.original
            >>> 
            >>> # Используем display для показа в UI
            >>> display = prepared.display
            >>> 
            >>> # Метаданные
            >>> print(f"Original: {prepared.info.width}x{prepared.info.height}")
            >>> print(f"Display: {prepared.display_size}")
            >>> print(f"Scale: {prepared.scale_factor:.2f}")
        """
        # 1. Загрузка
        original = self.load_image(image_path)
        
        # 2. Метаданные
        info = self.get_image_info(original, image_path)
        
        # 3. Подготовка display версии
        display = self.prepare_for_display(original, max_size)
        
        # 4. Расчёт scale_factor
        scale_factor = self.calculate_scale_factor(
            original.size,
            display.size
        )
        
        prepared = PreparedImage(
            original=original,
            display=display,
            info=info,
            scale_factor=scale_factor
        )
        
        self.logger.info(
            f"Prepared image: {Path(image_path).name} | "
            f"Original: {info.width}x{info.height} | "
            f"Display: {display.size[0]}x{display.size[1]} | "
            f"Scale: {scale_factor:.3f}"
        )
        
        return prepared
    
    # =========================================================================
    # УТИЛИТЫ
    # =========================================================================
    
    def is_supported_format(self, file_path: str) -> bool:
        """
        Проверяет, поддерживается ли формат файла.
        
        Args:
            file_path: Путь к файлу
        
        Returns:
            bool: True если формат поддерживается
        """
        ext = Path(file_path).suffix.upper().lstrip('.')
        return ext in self.SUPPORTED_FORMATS or ext == 'JPG'
    
    def get_optimal_display_size(self, original_size: Tuple[int, int],
                                 max_size: Optional[Tuple[int, int]] = None) -> Tuple[int, int]:
        """
        Вычисляет оптимальный размер для отображения с сохранением пропорций.
        
        Args:
            original_size: Размер оригинала (width, height)
            max_size: Максимальный размер (опционально)
        
        Returns:
            Tuple[int, int]: Оптимальный размер (width, height)
        """
        target_size = max_size or self.max_size
        orig_width, orig_height = original_size
        max_width, max_height = target_size
        
        # Вычисляем коэффициенты масштабирования
        scale_width = max_width / orig_width if orig_width > 0 else 1.0
        scale_height = max_height / orig_height if orig_height > 0 else 1.0
        
        # Выбираем меньший коэффициент чтобы вписаться в ограничения
        scale = min(scale_width, scale_height, 1.0)  # не увеличиваем
        
        return (
            int(orig_width * scale),
            int(orig_height * scale)
        )


# Экспортируемые классы
__all__ = ['ImageService', 'ImageInfo', 'PreparedImage']

