"""
Unit-тесты для ImageService.

Тестирует загрузку и обработку изображений:
- Загрузка и валидация
- Изменение размера с сохранением пропорций
- Получение метаданных
- Комбинированный метод load_and_prepare

НЕДЕЛЯ 2, Блок C: Image Service
"""

import unittest
import sys
import os
import tempfile
from pathlib import Path
from PIL import Image

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.image_service import ImageService, ImageInfo, PreparedImage


class TestImageServiceBasic(unittest.TestCase):
    """Базовые тесты для ImageService"""
    
    def test_service_initialization(self):
        """Проверка инициализации сервиса"""
        service = ImageService()
        self.assertEqual(service.max_size, (800, 600))
        
        service = ImageService(max_size=(1024, 768))
        self.assertEqual(service.max_size, (1024, 768))
    
    def test_supported_formats(self):
        """Проверка поддерживаемых форматов"""
        service = ImageService()
        
        self.assertIn('PNG', service.SUPPORTED_FORMATS)
        self.assertIn('JPEG', service.SUPPORTED_FORMATS)
        self.assertIn('JPG', service.SUPPORTED_FORMATS)


class TestImageInfo(unittest.TestCase):
    """Тесты для ImageInfo dataclass"""
    
    def test_image_info_creation(self):
        """Создание ImageInfo"""
        info = ImageInfo(
            width=1920,
            height=1080,
            format='JPEG',
            mode='RGB'
        )
        
        self.assertEqual(info.width, 1920)
        self.assertEqual(info.height, 1080)
        self.assertEqual(info.format, 'JPEG')
        self.assertEqual(info.mode, 'RGB')
    
    def test_aspect_ratio(self):
        """Вычисление соотношения сторон"""
        info = ImageInfo(width=1920, height=1080, format='PNG', mode='RGB')
        self.assertAlmostEqual(info.aspect_ratio, 1920/1080, places=2)
        
        # Квадратное изображение
        info = ImageInfo(width=1000, height=1000, format='PNG', mode='RGB')
        self.assertEqual(info.aspect_ratio, 1.0)
    
    def test_megapixels(self):
        """Вычисление мегапикселей"""
        info = ImageInfo(width=1920, height=1080, format='PNG', mode='RGB')
        expected_mp = (1920 * 1080) / 1_000_000
        self.assertAlmostEqual(info.megapixels, expected_mp, places=2)


class TestLoadImage(unittest.TestCase):
    """Тесты для загрузки изображений"""
    
    def setUp(self):
        """Создаём временные тестовые изображения"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ImageService()
        
        # Создаём тестовое изображение PNG
        self.test_image_path = os.path.join(self.test_dir, "test.png")
        img = Image.new('RGB', (800, 600), color='red')
        img.save(self.test_image_path, 'PNG')
        
        # Создаём тестовое изображение JPEG
        self.test_jpeg_path = os.path.join(self.test_dir, "test.jpg")
        img_jpeg = Image.new('RGB', (1920, 1080), color='blue')
        img_jpeg.save(self.test_jpeg_path, 'JPEG')
    
    def tearDown(self):
        """Удаляем временные файлы"""
        import shutil
        shutil.rmtree(self.test_dir)
    
    def test_load_image_success(self):
        """Успешная загрузка изображения"""
        image = self.service.load_image(self.test_image_path)
        
        self.assertIsNotNone(image)
        self.assertEqual(image.size, (800, 600))
        self.assertEqual(image.mode, 'RGB')
    
    def test_load_image_jpeg(self):
        """Загрузка JPEG изображения"""
        image = self.service.load_image(self.test_jpeg_path)
        
        self.assertIsNotNone(image)
        self.assertEqual(image.size, (1920, 1080))
    
    def test_load_image_file_not_found(self):
        """Ошибка при отсутствии файла"""
        with self.assertRaises(FileNotFoundError):
            self.service.load_image("/nonexistent/path/image.png")
    
    def test_load_image_invalid_file(self):
        """Ошибка при невалидном файле"""
        # Создаём текстовый файл вместо изображения
        invalid_path = os.path.join(self.test_dir, "invalid.png")
        with open(invalid_path, 'w') as f:
            f.write("This is not an image")
        
        with self.assertRaises((IOError, ValueError)):
            self.service.load_image(invalid_path)


class TestPrepareForDisplay(unittest.TestCase):
    """Тесты для подготовки изображений к отображению"""
    
    def setUp(self):
        """Создаём сервис и тестовые изображения"""
        self.service = ImageService(max_size=(800, 600))
        
        # Большое изображение
        self.large_image = Image.new('RGB', (2000, 1500), color='green')
        
        # Маленькое изображение
        self.small_image = Image.new('RGB', (400, 300), color='yellow')
        
        # Вертикальное изображение
        self.tall_image = Image.new('RGB', (600, 1200), color='purple')
    
    def test_prepare_large_image(self):
        """Уменьшение большого изображения"""
        display = self.service.prepare_for_display(self.large_image)
        
        # Должно быть уменьшено
        self.assertLessEqual(display.size[0], 800)
        self.assertLessEqual(display.size[1], 600)
        
        # Пропорции должны сохраниться
        original_ratio = 2000 / 1500
        display_ratio = display.size[0] / display.size[1]
        self.assertAlmostEqual(original_ratio, display_ratio, places=2)
    
    def test_prepare_small_image(self):
        """Маленькое изображение не должно увеличиваться"""
        display = self.service.prepare_for_display(self.small_image)
        
        # Размер должен остаться прежним или меньше
        self.assertLessEqual(display.size[0], self.small_image.size[0])
        self.assertLessEqual(display.size[1], self.small_image.size[1])
    
    def test_prepare_tall_image(self):
        """Подготовка вертикального изображения"""
        display = self.service.prepare_for_display(self.tall_image)
        
        # Высота должна быть ограничена
        self.assertLessEqual(display.size[1], 600)
        
        # Пропорции сохранены
        original_ratio = 600 / 1200
        display_ratio = display.size[0] / display.size[1]
        self.assertAlmostEqual(original_ratio, display_ratio, places=2)
    
    def test_prepare_with_custom_max_size(self):
        """Подготовка с кастомным размером"""
        custom_size = (400, 300)
        display = self.service.prepare_for_display(self.large_image, max_size=custom_size)
        
        self.assertLessEqual(display.size[0], 400)
        self.assertLessEqual(display.size[1], 300)
    
    def test_original_not_modified(self):
        """Оригинальное изображение не должно изменяться"""
        original_size = self.large_image.size
        display = self.service.prepare_for_display(self.large_image)
        
        # Оригинал не изменился
        self.assertEqual(self.large_image.size, original_size)
        # Display изменился
        self.assertNotEqual(display.size, original_size)


class TestCalculateScaleFactor(unittest.TestCase):
    """Тесты для расчёта коэффициента масштабирования"""
    
    def setUp(self):
        self.service = ImageService()
    
    def test_scale_factor_half(self):
        """Уменьшение в 2 раза"""
        scale = self.service.calculate_scale_factor(
            original_size=(2000, 1000),
            display_size=(1000, 500)
        )
        self.assertEqual(scale, 0.5)
    
    def test_scale_factor_no_change(self):
        """Без изменений"""
        scale = self.service.calculate_scale_factor(
            original_size=(800, 600),
            display_size=(800, 600)
        )
        self.assertEqual(scale, 1.0)
    
    def test_scale_factor_quarter(self):
        """Уменьшение в 4 раза"""
        scale = self.service.calculate_scale_factor(
            original_size=(1600, 1200),
            display_size=(400, 300)
        )
        self.assertEqual(scale, 0.25)


class TestGetImageInfo(unittest.TestCase):
    """Тесты для получения метаданных"""
    
    def setUp(self):
        """Создаём временное изображение"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ImageService()
        
        self.test_path = os.path.join(self.test_dir, "metadata.png")
        img = Image.new('RGB', (1920, 1080), color='white')
        img.save(self.test_path, 'PNG')
    
    def tearDown(self):
        import shutil
        shutil.rmtree(self.test_dir)
    
    def test_get_image_info_basic(self):
        """Получение базовых метаданных"""
        image = Image.open(self.test_path)
        info = self.service.get_image_info(image)
        
        self.assertEqual(info.width, 1920)
        self.assertEqual(info.height, 1080)
        self.assertIn(info.format, ['PNG', 'Unknown'])  # После open() может быть PNG
        self.assertEqual(info.mode, 'RGB')
    
    def test_get_image_info_with_file_size(self):
        """Получение метаданных с размером файла"""
        image = Image.open(self.test_path)
        info = self.service.get_image_info(image, self.test_path)
        
        self.assertIsNotNone(info.size_bytes)
        self.assertGreater(info.size_bytes, 0)
    
    def test_get_image_info_without_file(self):
        """Метаданные без файла (в памяти)"""
        image = Image.new('RGB', (640, 480))
        info = self.service.get_image_info(image)
        
        self.assertEqual(info.width, 640)
        self.assertEqual(info.height, 480)
        self.assertIsNone(info.size_bytes)


class TestLoadAndPrepare(unittest.TestCase):
    """Тесты для комбинированного метода load_and_prepare"""
    
    def setUp(self):
        """Создаём временное большое изображение"""
        self.test_dir = tempfile.mkdtemp()
        self.service = ImageService(max_size=(800, 600))
        
        self.test_path = os.path.join(self.test_dir, "large.png")
        img = Image.new('RGB', (2400, 1800), color='cyan')
        img.save(self.test_path, 'PNG')
    
    def tearDown(self):
        import shutil
        shutil.rmtree(self.test_dir)
    
    def test_load_and_prepare_success(self):
        """Полный цикл загрузки и подготовки"""
        prepared = self.service.load_and_prepare(self.test_path)
        
        self.assertIsInstance(prepared, PreparedImage)
        
        # Проверяем оригинал
        self.assertEqual(prepared.original.size, (2400, 1800))
        
        # Проверяем display
        self.assertLessEqual(prepared.display.size[0], 800)
        self.assertLessEqual(prepared.display.size[1], 600)
        
        # Проверяем метаданные
        self.assertEqual(prepared.info.width, 2400)
        self.assertEqual(prepared.info.height, 1800)
        
        # Проверяем scale_factor
        self.assertLess(prepared.scale_factor, 1.0)  # Уменьшено
        self.assertAlmostEqual(
            prepared.scale_factor,
            prepared.display.size[0] / prepared.original.size[0],
            places=3
        )
    
    def test_load_and_prepare_small_image(self):
        """Загрузка маленького изображения"""
        small_path = os.path.join(self.test_dir, "small.png")
        img = Image.new('RGB', (400, 300), color='magenta')
        img.save(small_path, 'PNG')
        
        prepared = self.service.load_and_prepare(small_path)
        
        # Маленькое изображение не увеличивается
        self.assertEqual(prepared.display.size, (400, 300))
        self.assertLessEqual(prepared.scale_factor, 1.0)
    
    def test_load_and_prepare_custom_size(self):
        """Загрузка с кастомным размером"""
        prepared = self.service.load_and_prepare(self.test_path, max_size=(400, 300))
        
        self.assertLessEqual(prepared.display.size[0], 400)
        self.assertLessEqual(prepared.display.size[1], 300)
    
    def test_load_and_prepare_file_not_found(self):
        """Ошибка при отсутствии файла"""
        with self.assertRaises(FileNotFoundError):
            self.service.load_and_prepare("/nonexistent/image.png")


class TestPreparedImage(unittest.TestCase):
    """Тесты для PreparedImage dataclass"""
    
    def test_prepared_image_properties(self):
        """Проверка свойств PreparedImage"""
        original = Image.new('RGB', (1920, 1080))
        display = Image.new('RGB', (960, 540))
        info = ImageInfo(width=1920, height=1080, format='PNG', mode='RGB')
        
        prepared = PreparedImage(
            original=original,
            display=display,
            info=info,
            scale_factor=0.5
        )
        
        self.assertEqual(prepared.display_size, (960, 540))
        self.assertEqual(prepared.original_size, (1920, 1080))
        self.assertEqual(prepared.scale_factor, 0.5)


class TestUtilityMethods(unittest.TestCase):
    """Тесты для утилитных методов"""
    
    def setUp(self):
        self.service = ImageService()
    
    def test_is_supported_format(self):
        """Проверка поддерживаемых форматов"""
        self.assertTrue(self.service.is_supported_format("image.png"))
        self.assertTrue(self.service.is_supported_format("image.jpg"))
        self.assertTrue(self.service.is_supported_format("image.jpeg"))
        self.assertTrue(self.service.is_supported_format("IMAGE.PNG"))
        
        self.assertFalse(self.service.is_supported_format("document.pdf"))
        self.assertFalse(self.service.is_supported_format("video.mp4"))
    
    def test_get_optimal_display_size(self):
        """Вычисление оптимального размера"""
        # Большое изображение должно уменьшиться
        size = self.service.get_optimal_display_size(
            original_size=(2000, 1500),
            max_size=(800, 600)
        )
        self.assertLessEqual(size[0], 800)
        self.assertLessEqual(size[1], 600)
        
        # Маленькое изображение не увеличивается
        size = self.service.get_optimal_display_size(
            original_size=(400, 300),
            max_size=(800, 600)
        )
        self.assertEqual(size, (400, 300))
        
        # Сохранение пропорций
        size = self.service.get_optimal_display_size(
            original_size=(1600, 1200),  # 4:3
            max_size=(800, 600)
        )
        ratio = size[0] / size[1]
        self.assertAlmostEqual(ratio, 1600/1200, places=2)


if __name__ == '__main__':
    # Запуск всех тестов
    unittest.main(verbosity=2)

