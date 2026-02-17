"""
Геометрические утилиты для работы с полигонами и точками

Этот модуль содержит функции для:
- Проверки нахождения точки внутри полигона
- Вычисления площади полигона
- И других геометрических операций

Используется в:
- desktop-app/trainer.py (RadiologyTrainer)
- Других модулях для обработки геометрии
"""

import logging
from typing import List, Tuple, Dict, Any, Optional

try:
    import numpy as np
    NUMPY_AVAILABLE = True
except ImportError:
    NUMPY_AVAILABLE = False

try:
    from PIL import Image, ImageDraw
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

logger = logging.getLogger(__name__)


def point_in_polygon(x, y, polygon):
    """
    Проверяет, находится ли точка внутри полигона (алгоритм ray casting)
    
    Args:
        x (float): X-координата точки
        y (float): Y-координата точки
        polygon (list): Список точек полигона [(x1,y1), (x2,y2), ...]
    
    Returns:
        bool: True если точка внутри полигона, False если снаружи
    
    Example:
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> point_in_polygon(5, 5, polygon)
        True
        >>> point_in_polygon(15, 15, polygon)
        False
    """
    n = len(polygon)
    inside = False
    
    p1x, p1y = polygon[0]
    for i in range(1, n + 1):
        p2x, p2y = polygon[i % n]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    
    return inside


def calculate_polygon_area(points):
    """
    Рассчитывает площадь полигона используя формулу Shoelace (метод трапеций)
    
    Args:
        points (list): Список точек полигона [(x1,y1), (x2,y2), ...]
    
    Returns:
        float: Площадь полигона (всегда положительная)
    
    Example:
        >>> square = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> calculate_polygon_area(square)
        100.0
    """
    if len(points) < 3:
        return 0
    
    area = 0
    n = len(points)
    for i in range(n):
        j = (i + 1) % n
        area += points[i][0] * points[j][1]
        area -= points[j][0] * points[i][1]
    return abs(area) / 2


def stroke_polygon_intersection(stroke, polygon_points):
    """
    Проверяет пересечение штриха с полигоном
    
    Args:
        stroke (dict): Словарь штриха с ключом 'points' - список точек [(x,y), ...]
        polygon_points (list): Список точек полигона [(x,y), ...]
    
    Returns:
        bool: True если хотя бы одна точка штриха внутри полигона
    
    Example:
        >>> stroke = {'points': [(5, 5), (15, 15)]}
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> stroke_polygon_intersection(stroke, polygon)
        True
    """
    # Проверяем, есть ли хотя бы одна точка штриха внутри полигона
    for point in stroke['points']:
        x, y = point
        if point_in_polygon(x, y, polygon_points):
            return True
    return False


def circle_polygon_intersection(circle, polygon_points):
    """
    Проверяет пересечение круга с полигоном
    
    Упрощенная проверка: если центр круга внутри полигона, считается пересечением.
    
    Args:
        circle (dict): Словарь с кругом {'x': ..., 'y': ..., 'radius': ...}
        polygon_points (list): Список точек полигона [(x,y), ...]
    
    Returns:
        bool: True если центр круга внутри полигона
    
    Example:
        >>> circle = {'x': 5, 'y': 5, 'radius': 2}
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> circle_polygon_intersection(circle, polygon)
        True
    """
    # Упрощенная проверка: если центр круга внутри полигона
    return point_in_polygon(circle['x'], circle['y'], polygon_points)


def calculate_circle_polygon_overlap(circle, polygon_points):
    """
    Рассчитывает площадь пересечения круга с полигоном
    
    Упрощенный расчет: если центр круга в полигоне, возвращает площадь всего круга.
    
    Args:
        circle (dict): Словарь с кругом {'x': ..., 'y': ..., 'radius': ...}
        polygon_points (list): Список точек полигона [(x,y), ...]
    
    Returns:
        float: Площадь пересечения (0 если не пересекаются)
    
    Example:
        >>> circle = {'x': 5, 'y': 5, 'radius': 3}
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> overlap = calculate_circle_polygon_overlap(circle, polygon)
        >>> overlap > 0
        True
    """
    # Упрощенный расчет: если центр круга в полигоне, считаем всю площадь круга
    if point_in_polygon(circle['x'], circle['y'], polygon_points):
        return 3.14159 * circle['radius'] ** 2
    return 0


def is_point_covered_by_stroke(x, y, stroke, radius=6):
    """
    Проверяет, покрыта ли точка конкретным штрихом
    
    Args:
        x (float): X-координата точки
        y (float): Y-координата точки
        stroke (dict): Словарь штриха с ключом 'points' - список точек
        radius (int): Радиус покрытия в пикселях (по умолчанию 6)
    
    Returns:
        bool: True если точка находится в пределах radius от любой точки штриха
    
    Example:
        >>> stroke = {'points': [(5, 5), (10, 10)]}
        >>> is_point_covered_by_stroke(6, 6, stroke, radius=2)
        True
        >>> is_point_covered_by_stroke(20, 20, stroke, radius=2)
        False
    """
    for point in stroke['points']:
        px, py = point
        distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
        if distance <= radius:
            return True
    return False


def calculate_stroke_coverage_in_polygon(stroke, polygon_points):
    """
    Рассчитывает площадь покрытия штриха внутри полигона
    
    Args:
        stroke (dict): Словарь штриха с ключом 'points' - список точек
        polygon_points (list): Список точек полигона [(x,y), ...]
    
    Returns:
        float: Площадь покрытия штриха внутри полигона
    
    Example:
        >>> stroke = {'points': [(5, 5), (6, 6), (7, 7)]}
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> coverage = calculate_stroke_coverage_in_polygon(stroke, polygon)
        >>> coverage >= 0
        True
    """
    if len(stroke['points']) < 2:
        return 0
    
    # Создаем сетку точек внутри полигона
    min_x = min(point[0] for point in polygon_points)
    max_x = max(point[0] for point in polygon_points)
    min_y = min(point[1] for point in polygon_points)
    max_y = max(point[1] for point in polygon_points)
    
    # Размер шага сетки
    step = 4  # Пиксели
    
    covered_points = 0
    total_points = 0
    
    # Проверяем каждую точку сетки
    for x in range(int(min_x), int(max_x), step):
        for y in range(int(min_y), int(max_y), step):
            if point_in_polygon(x, y, polygon_points):
                total_points += 1
                
                # Проверяем, покрыта ли эта точка штрихом
                if is_point_covered_by_stroke(x, y, stroke):
                    covered_points += 1
    
    if total_points > 0:
        # Возвращаем площадь покрытия
        return (covered_points / total_points) * calculate_polygon_area(polygon_points)
    return 0


def _get_image_dimensions(
    polygon_points: List[Tuple[float, float]],
    user_drawing: List[Dict],
    task_data: Optional[Dict[str, Any]] = None,
    answer_key: Optional[Dict[str, Any]] = None,
    margin: int = 50
) -> Tuple[int, int]:
    """
    Определяет размеры изображения для растровых масок.
    
    Приоритет источников:
    1. task_data.meta.image_size или task_data.content.image_size
    2. answer_key.meta.image_size
    3. user_input.image_width и user_input.image_height (если переданы через user_drawing)
    4. Вычисление из bounding box всех точек
    5. Дефолтные значения (800, 600)
    
    Args:
        polygon_points: Список точек эталонного полигона [(x,y), ...]
        user_drawing: Список штрихов пользователя или словарь с полями image_width/image_height
        task_data: Данные задания (опционально)
        answer_key: Правильные ответы (опционально)
        margin: Отступ в пикселях для безопасности
    
    Returns:
        tuple: (width, height) - размеры изображения
    """
    # Приоритет 1: task_data.meta.image_size или task_data.content.image_size
    if task_data:
        if isinstance(task_data, dict):
            # Проверяем meta.image_size
            meta = task_data.get('meta', {})
            if isinstance(meta, dict):
                image_size = meta.get('image_size') or meta.get('imageSize')
                if image_size and isinstance(image_size, (list, tuple)) and len(image_size) >= 2:
                    logger.debug(f"Using image dimensions from task_data.meta: {image_size[0]}x{image_size[1]}")
                    return (int(image_size[0]), int(image_size[1]))
            
            # Проверяем content.image_size
            content = task_data.get('content', {})
            if isinstance(content, dict):
                image_size = content.get('image_size') or content.get('imageSize')
                if image_size and isinstance(image_size, (list, tuple)) and len(image_size) >= 2:
                    logger.debug(f"Using image dimensions from task_data.content: {image_size[0]}x{image_size[1]}")
                    return (int(image_size[0]), int(image_size[1]))
    
    # Приоритет 2: answer_key.meta.image_size
    if answer_key:
        if isinstance(answer_key, dict):
            meta = answer_key.get('meta', {})
            if isinstance(meta, dict):
                image_size = meta.get('image_size') or meta.get('imageSize')
                if image_size and isinstance(image_size, (list, tuple)) and len(image_size) >= 2:
                    logger.debug(f"Using image dimensions from answer_key.meta: {image_size[0]}x{image_size[1]}")
                    return (int(image_size[0]), int(image_size[1]))
    
    # Приоритет 3: user_input.image_width и user_input.image_height
    # Проверяем, если user_drawing это словарь с полями image_width/image_height
    if isinstance(user_drawing, dict):
        img_w = user_drawing.get('image_width') or user_drawing.get('imageWidth')
        img_h = user_drawing.get('image_height') or user_drawing.get('imageHeight')
        if img_w is not None and img_h is not None:
            logger.debug(f"Using image dimensions from user_input: {img_w}x{img_h}")
            return (int(img_w), int(img_h))
        
        # Если это словарь с полем 'drawing', извлекаем список штрихов
        drawing_list = user_drawing.get('drawing', [])
        if drawing_list and isinstance(drawing_list, list):
            user_drawing = drawing_list
    
    # Приоритет 4: Вычисление из bounding box всех точек
    all_points = list(polygon_points) if polygon_points else []
    
    # Собираем точки из user_drawing
    if isinstance(user_drawing, list):
        for stroke in user_drawing:
            if isinstance(stroke, dict):
                stroke_type = stroke.get('type', '')
                if stroke_type == 'brush_stroke':
                    points = stroke.get('points', [])
                    if points:
                        all_points.extend(points)
    
    if all_points:
        try:
            min_x = min(p[0] for p in all_points if len(p) >= 2)
            max_x = max(p[0] for p in all_points if len(p) >= 2)
            min_y = min(p[1] for p in all_points if len(p) >= 2)
            max_y = max(p[1] for p in all_points if len(p) >= 2)
            
            width = int(max_x - min_x + 2 * margin)
            height = int(max_y - min_y + 2 * margin)
            
            # Убеждаемся что размеры разумные
            if width > 0 and height > 0:
                final_size = (max(width, 100), max(height, 100))
                logger.debug(f"Using image dimensions from bounding box: {final_size[0]}x{final_size[1]} (calculated from {len(all_points)} points)")
                return final_size
        except (ValueError, TypeError) as e:
            logger.warning(f"Failed to compute bounding box: {e}")
    
    # Приоритет 5: Дефолтные значения
    logger.debug("Using default image dimensions (800, 600)")
    return (800, 600)


def _calculate_polygon_coverage_legacy(polygon_points, user_drawing):
    """
    Старая версия calculate_polygon_coverage для совместимости и fallback.
    
    Использует алгоритм с сеткой точек (O(N*M) сложность).
    
    Args:
        polygon_points (list): Список точек эталонного полигона [(x,y), ...]
        user_drawing (list): Список штрихов пользователя, каждый со структурой:
                            {'type': 'brush_stroke', 'points': [(x,y), ...]}
    
    Returns:
        float: IoU в процентах (0-100), ограниченное 100.0
    """
    if len(polygon_points) < 3:
        return 0
    
    # Собираем все точки из рисунка пользователя
    user_points = []
    for stroke in user_drawing:
        if stroke.get('type') == 'brush_stroke':
            user_points.extend(stroke.get('points', []))
    
    if len(user_points) < 3:
        logger.debug(f"Insufficient points for polygon: {len(user_points)}")
        return 0
    
    logger.debug(f"Total points in user drawing: {len(user_points)}")
    
    # Находим границы для сетки
    all_points = polygon_points + user_points
    min_x = min(p[0] for p in all_points)
    max_x = max(p[0] for p in all_points)
    min_y = min(p[1] for p in all_points)
    max_y = max(p[1] for p in all_points)
    
    # Создаем сетку для вычисления площадей
    # Шаг сетки - чем меньше, тем точнее, но медленнее
    # Увеличен шаг до 5 пикселей для улучшения производительности
    step = 5  # пикселей
    
    intersection_count = 0  # Точек в пересечении
    union_count = 0  # Точек в объединении
    
    # Проходим по сетке
    x = min_x
    while x <= max_x:
        y = min_y
        while y <= max_y:
            in_reference = point_in_polygon(x, y, polygon_points)
            in_user = point_in_polygon(x, y, user_points)
            
            if in_reference and in_user:
                intersection_count += 1
                union_count += 1
            elif in_reference or in_user:
                union_count += 1
            
            y += step
        x += step
    
    # Вычисляем IoU
    if union_count == 0:
        iou = 0
    else:
        iou = (intersection_count / union_count) * 100
    
    logger.debug(f"Intersection points: {intersection_count}, Union points: {union_count}, IoU: {iou:.2f}%")
    
    return min(iou, 100.0)


def calculate_polygon_coverage_rasterized(
    polygon_points: List[Tuple[float, float]],
    user_drawing: List[Dict],
    image_width: int,
    image_height: int,
    brush_radius: int = 8,
    downscale_for_large_images: bool = True,
    max_mask_size: int = 4096
) -> float:
    """
    Оптимизированная версия calculate_polygon_coverage с использованием растровых масок.
    
    Алгоритм:
    1. При необходимости downscale для очень больших изображений
    2. Растеризация reference полигона в маску (PIL Image mode 'L') - заполненная область
    3. Растеризация user штрихов в маску:
       - Собирает все точки из всех штрихов пользователя
       - Создает полигон из точек (проверяет замкнутость контура)
       - Заполняет полигон (для сравнения с reference заполненной областью)
       - Fallback: рисует линии если полигон нельзя создать
    4. Вычисление IoU через numpy bitwise операции
    
    Логика: Сравнивает заполненные полигоны (reference и user), что соответствует
    цели задания "распознать и обвести объект", где важно распознать объект,
    а не точно обвести его контур.
    
    Args:
        polygon_points: Список точек эталонного полигона [(x,y), ...]
        user_drawing: Список штрихов пользователя
        image_width: Ширина изображения в пикселях
        image_height: Высота изображения в пикселях
        brush_radius: Радиус кисти в пикселях
        downscale_for_large_images: Использовать downscale для больших изображений
        max_mask_size: Максимальный размер маски для downscale
    
    Returns:
        float: IoU в процентах (0-100)
    
    Raises:
        ImportError: если numpy или PIL недоступны
    """
    if not NUMPY_AVAILABLE:
        raise ImportError("numpy is required for rasterized evaluation")
    if not PIL_AVAILABLE:
        raise ImportError("PIL/Pillow is required for rasterized evaluation")
    
    # Edge case 1: Пустые данные
    if len(polygon_points) < 3:
        return 0.0
    
    # Проверяем наличие точек в штрихах
    has_points = False
    for stroke in user_drawing:
        if isinstance(stroke, dict) and stroke.get('type') == 'brush_stroke':
            points = stroke.get('points', [])
            if points:
                has_points = True
                break
    
    if not has_points:
        return 0.0
    
    # Шаг 1: Downscaling для больших изображений
    downscale_used = False
    scale = 1.0
    mask_width = image_width
    mask_height = image_height
    
    if downscale_for_large_images and (image_width > max_mask_size or image_height > max_mask_size):
        scale = min(max_mask_size / image_width, max_mask_size / image_height)
        mask_width = int(image_width * scale)
        mask_height = int(image_height * scale)
        downscale_used = True
        logger.debug(f"Downscaling image {image_width}x{image_height} to {mask_width}x{mask_height} (scale: {scale:.3f})")
    
    # Масштабируем координаты полигона если нужно
    if downscale_used:
        scaled_polygon_points = [(x * scale, y * scale) for x, y in polygon_points]
    else:
        scaled_polygon_points = list(polygon_points)
    
    # Шаг 2: Создание маски для reference полигона
    ref_mask = Image.new('L', (mask_width, mask_height), 0)
    draw_ref = ImageDraw.Draw(ref_mask)
    
    # Преобразуем координаты в tuple и обрезаем до границ маски
    ref_coords = []
    for x, y in scaled_polygon_points:
        # Обрезаем координаты до границ маски для безопасности
        x_clipped = max(0, min(mask_width - 1, int(x)))
        y_clipped = max(0, min(mask_height - 1, int(y)))
        ref_coords.append((x_clipped, y_clipped))
    
    # Логируем границы reference полигона для диагностики
    if ref_coords:
        ref_x_min = min(c[0] for c in ref_coords)
        ref_x_max = max(c[0] for c in ref_coords)
        ref_y_min = min(c[1] for c in ref_coords)
        ref_y_max = max(c[1] for c in ref_coords)
        logger.debug(f"Reference polygon bounds: X=[{ref_x_min}, {ref_x_max}], Y=[{ref_y_min}, {ref_y_max}]")
    
    if len(ref_coords) >= 3:
        try:
            draw_ref.polygon(ref_coords, fill=255)
        except Exception as e:
            logger.warning(f"Failed to draw reference polygon: {e}")
            return 0.0
    
    ref_mask_array = np.array(ref_mask, dtype=np.uint8)
    ref_area = np.sum(ref_mask_array > 0)
    logger.debug(f"Reference polygon mask area: {ref_area} pixels")
    
    # Шаг 3: Создание маски для user штрихов
    stroke_mask = Image.new('L', (mask_width, mask_height), 0)
    draw_stroke = ImageDraw.Draw(stroke_mask)
    
    scaled_radius = int(brush_radius * scale) if downscale_used else brush_radius
    # Минимальный радиус 1 пиксель
    if scaled_radius < 1:
        scaled_radius = 1
    
    # Собираем все точки из всех штрихов пользователя
    all_user_points = []
    first_stroke_coords_logged = False
    
    for stroke in user_drawing:
        if isinstance(stroke, dict) and stroke.get('type') == 'brush_stroke':
            points = stroke.get('points', [])
            if not points:
                continue
            
            # Логируем координаты первого штриха для диагностики
            if not first_stroke_coords_logged and points:
                first_point = points[0]
                last_point = points[-1]
                # Вычисляем диапазон координат
                x_coords = [p[0] for p in points]
                y_coords = [p[1] for p in points]
                logger.debug(f"First user stroke: X range=[{min(x_coords):.1f}, {max(x_coords):.1f}], Y range=[{min(y_coords):.1f}, {max(y_coords):.1f}], total_points={len(points)}")
                logger.debug(f"First user stroke: first point={first_point}, last point={last_point}")
                first_stroke_coords_logged = True
            
            # Применить downscale если нужно
            if downscale_used:
                scaled_points = [(x * scale, y * scale) for x, y in points]
            else:
                scaled_points = points
            
            # Добавляем точки к общему списку
            all_user_points.extend(scaled_points)
    
    # Пытаемся создать полигон из всех точек пользователя
    user_polygon_created = False
    
    if len(all_user_points) >= 3:
        # Проверяем, замкнут ли контур (первая и последняя точки близки)
        first_point = all_user_points[0]
        last_point = all_user_points[-1]
        distance = ((first_point[0] - last_point[0])**2 + 
                   (first_point[1] - last_point[1])**2)**0.5
        
        # Если контур не замкнут, замыкаем его (если расстояние приемлемо)
        # Порог: если расстояние меньше 2 * brush_radius, считаем контур замкнутым
        close_threshold = scaled_radius * 2 if scaled_radius > 0 else 10
        
        if distance > close_threshold:
            # Контур не замкнут - добавляем первую точку в конец
            all_user_points.append(first_point)
            logger.debug(f"User contour not closed, distance={distance:.1f}, threshold={close_threshold:.1f}, closing polygon")
        else:
            logger.debug(f"User contour appears closed, distance={distance:.1f}, threshold={close_threshold:.1f}")
        
        # Преобразуем координаты в tuple и обрезаем до границ маски
        user_polygon_coords = []
        for x, y in all_user_points:
            x_clipped = max(0, min(mask_width - 1, int(x)))
            y_clipped = max(0, min(mask_height - 1, int(y)))
            user_polygon_coords.append((x_clipped, y_clipped))
        
        # Удаляем дубликаты соседних точек (если есть)
        cleaned_coords = []
        for i, coord in enumerate(user_polygon_coords):
            if i == 0 or coord != user_polygon_coords[i-1]:
                cleaned_coords.append(coord)
        
        # Проверяем что после очистки осталось достаточно точек
        if len(cleaned_coords) >= 3:
            try:
                # Рисуем заполненный полигон пользователя
                draw_stroke.polygon(cleaned_coords, fill=255)
                user_polygon_created = True
                logger.debug(f"Created user polygon from {len(cleaned_coords)} points (original: {len(all_user_points)} points)")
                
                # Логируем границы user полигона
                if cleaned_coords:
                    user_x_coords = [c[0] for c in cleaned_coords]
                    user_y_coords = [c[1] for c in cleaned_coords]
                    logger.debug(f"User polygon bounds: X=[{min(user_x_coords)}, {max(user_x_coords)}], Y=[{min(user_y_coords)}, {max(user_y_coords)}]")
            except Exception as e:
                logger.warning(f"Failed to create user polygon, falling back to line drawing: {e}")
                user_polygon_created = False
    
    # Fallback: если не удалось создать полигон, рисуем линии (старый подход)
    if not user_polygon_created:
        logger.debug("Falling back to line-based drawing (polygon creation failed)")
        
        for stroke in user_drawing:
            if isinstance(stroke, dict) and stroke.get('type') == 'brush_stroke':
                points = stroke.get('points', [])
                if not points:
                    continue
                
                # Применить downscale если нужно
                if downscale_used:
                    scaled_points = [(x * scale, y * scale) for x, y in points]
                else:
                    scaled_points = points
                
                if len(scaled_points) >= 2:
                    # Рисуем линии с толщиной кисти
                    for i in range(len(scaled_points) - 1):
                        p1_raw = scaled_points[i]
                        p2_raw = scaled_points[i + 1]
                        
                        # Обрезаем координаты
                        p1 = (max(0, min(mask_width - 1, int(p1_raw[0]))),
                              max(0, min(mask_height - 1, int(p1_raw[1]))))
                        p2 = (max(0, min(mask_width - 1, int(p2_raw[0]))),
                              max(0, min(mask_height - 1, int(p2_raw[1]))))
                        
                        # Эллипсы в начале и конце
                        draw_stroke.ellipse(
                            [p1[0] - scaled_radius, p1[1] - scaled_radius,
                             p1[0] + scaled_radius, p1[1] + scaled_radius],
                            fill=255
                        )
                        draw_stroke.ellipse(
                            [p2[0] - scaled_radius, p2[1] - scaled_radius,
                             p2[0] + scaled_radius, p2[1] + scaled_radius],
                            fill=255
                        )
                        # Линия с толщиной
                        if scaled_radius * 2 >= 1:
                            draw_stroke.line([p1, p2], fill=255, width=scaled_radius * 2)
                elif len(scaled_points) == 1:
                    # Одна точка - круг
                    p_raw = scaled_points[0]
                    p = (max(0, min(mask_width - 1, int(p_raw[0]))),
                         max(0, min(mask_height - 1, int(p_raw[1]))))
                    draw_stroke.ellipse(
                        [p[0] - scaled_radius, p[1] - scaled_radius,
                         p[0] + scaled_radius, p[1] + scaled_radius],
                        fill=255
                    )
    
    stroke_mask_array = np.array(stroke_mask, dtype=np.uint8)
    stroke_area = np.sum(stroke_mask_array > 0)
    logger.debug(f"User stroke mask area: {stroke_area} pixels")
    
    # Логируем границы user штрихов для диагностики
    if stroke_area > 0:
        # Находим индексы всех ненулевых пикселей
        nonzero_indices = np.nonzero(stroke_mask_array)
        if len(nonzero_indices[0]) > 0:
            stroke_y_min, stroke_y_max = int(nonzero_indices[0].min()), int(nonzero_indices[0].max())
            stroke_x_min, stroke_x_max = int(nonzero_indices[1].min()), int(nonzero_indices[1].max())
            logger.debug(f"User stroke bounds: X=[{stroke_x_min}, {stroke_x_max}], Y=[{stroke_y_min}, {stroke_y_max}]")
    
    # Шаг 4: Вычисление IoU через numpy
    # Пересечение: ref_mask & stroke_mask
    intersection = np.sum((ref_mask_array & stroke_mask_array) > 0)
    
    # Объединение: ref_mask | stroke_mask
    union = np.sum((ref_mask_array | stroke_mask_array) > 0)
    
    # Edge case 4: Нулевая площадь
    if union == 0:
        return 0.0
    
    # IoU = intersection / union
    iou = (intersection / union) * 100.0
    
    # Исправляем проверку scaled_radius
    actual_scaled_radius = scaled_radius if downscale_used else brush_radius
    logger.debug(f"Rasterized IoU calculation: intersection={intersection}, union={union}, iou={iou:.2f}%")
    logger.debug(f"Mask size: {mask_width}x{mask_height}, original image: {image_width}x{image_height}")
    logger.debug(f"Brush radius: {brush_radius}px, scaled radius: {actual_scaled_radius}px, downscale_used: {downscale_used}")
    
    return min(iou, 100.0)


def calculate_polygon_coverage(
    polygon_points,
    user_drawing,
    task_data=None,
    answer_key=None,
    use_rasterized=True
):
    """
    Рассчитывает IoU (Intersection over Union) между эталонной и нарисованной областями.
    
    Поддерживает два режима:
    - Растровые маски (по умолчанию, быстрее и точнее)
    - Legacy метод с сеткой точек (fallback)
    
    Args:
        polygon_points: Список точек эталонного полигона [(x,y), ...]
        user_drawing: Список штрихов пользователя, каждый со структурой:
                      {'type': 'brush_stroke', 'points': [(x,y), ...]}
                      Или словарь с полями image_width/image_height
        task_data: Данные задания (для получения размеров изображения и brush_radius)
        answer_key: Правильные ответы (для получения размеров изображения)
        use_rasterized: Использовать растровые маски (True) или legacy метод (False)
    
    Returns:
        float: IoU в процентах (0-100), ограниченное 100.0
    
    Example:
        >>> polygon = [(0, 0), (10, 0), (10, 10), (0, 10)]
        >>> user_drawing = [{'type': 'brush_stroke', 'points': [(5, 5), (6, 6)]}]
        >>> iou = calculate_polygon_coverage(polygon, user_drawing)
        >>> 0 <= iou <= 100
        True
    """
    if use_rasterized:
        try:
            # Получаем размеры изображения
            image_width, image_height = _get_image_dimensions(
                polygon_points, user_drawing, task_data, answer_key
            )
            
            logger.debug(f"Image dimensions: {image_width}x{image_height}")
            logger.debug(f"Reference polygon points: {len(polygon_points)}")
            
            # Извлекаем список штрихов если user_drawing это словарь (для логирования)
            drawing_list_for_log = user_drawing
            if isinstance(user_drawing, dict):
                drawing_list_for_log = user_drawing.get('drawing', [])
            
            if isinstance(drawing_list_for_log, list):
                total_strokes = len(drawing_list_for_log)
                total_points = sum(len(s.get('points', [])) for s in drawing_list_for_log if isinstance(s, dict))
                logger.debug(f"User drawing: {total_strokes} strokes, {total_points} total points")
            
            # Получаем brush_radius из настроек или user_input
            brush_radius = 8  # default
            brush_radius_source = "default"
            
            # Сначала проверяем user_input (если user_drawing это словарь)
            if isinstance(user_drawing, dict):
                # Проверяем brush_radius в user_input
                user_brush_radius = user_drawing.get('brush_radius') or user_drawing.get('brushRadius')
                if user_brush_radius is not None:
                    brush_radius = int(user_brush_radius)
                    brush_radius_source = "user_input"
                    logger.debug(f"Using brush_radius from user_input: {brush_radius}")
            
            # Затем проверяем task_data (только если не нашли в user_input)
            if brush_radius_source == "default" and task_data and isinstance(task_data, dict):
                settings = task_data.get('settings', {})
                if isinstance(settings, dict):
                    task_brush_radius = settings.get('brush_radius') or settings.get('brushRadius')
                    if task_brush_radius is not None:
                        brush_radius = int(task_brush_radius)
                        brush_radius_source = "task_data.settings"
                        logger.debug(f"Using brush_radius from task_data.settings: {brush_radius}")
            
            # И наконец answer_key (только если не нашли ранее)
            if brush_radius_source == "default" and answer_key and isinstance(answer_key, dict):
                settings = answer_key.get('settings', {})
                if isinstance(settings, dict):
                    answer_brush_radius = settings.get('brush_radius') or settings.get('brushRadius')
                    if answer_brush_radius is not None:
                        brush_radius = int(answer_brush_radius)
                        brush_radius_source = "answer_key.settings"
                        logger.debug(f"Using brush_radius from answer_key.settings: {brush_radius}")
            
            logger.debug(f"Final brush_radius: {brush_radius}px (source: {brush_radius_source})")
            
            # Логируем координаты reference полигона для диагностики
            if polygon_points:
                ref_x_coords = [p[0] for p in polygon_points]
                ref_y_coords = [p[1] for p in polygon_points]
                logger.debug(f"Reference polygon coordinates: X range=[{min(ref_x_coords):.1f}, {max(ref_x_coords):.1f}], Y range=[{min(ref_y_coords):.1f}, {max(ref_y_coords):.1f}]")
                logger.debug(f"Reference polygon first point: {polygon_points[0]}, last point: {polygon_points[-1]}")
            
            # Извлекаем список штрихов если user_drawing это словарь
            drawing_list = user_drawing
            if isinstance(user_drawing, dict):
                drawing_list = user_drawing.get('drawing', user_drawing)
                if not isinstance(drawing_list, list):
                    drawing_list = user_drawing
            
            # Используем растровую версию
            return calculate_polygon_coverage_rasterized(
                polygon_points, drawing_list,
                image_width, image_height, brush_radius
            )
        except Exception as e:
            # Fallback на legacy метод при ошибке
            logger.warning(f"Rasterized evaluation failed, using legacy: {e}")
            # Извлекаем список штрихов если user_drawing это словарь
            drawing_list = user_drawing
            if isinstance(user_drawing, dict):
                drawing_list = user_drawing.get('drawing', user_drawing)
                if not isinstance(drawing_list, list):
                    drawing_list = user_drawing
            return _calculate_polygon_coverage_legacy(polygon_points, drawing_list)
    else:
        # Извлекаем список штрихов если user_drawing это словарь
        drawing_list = user_drawing
        if isinstance(user_drawing, dict):
            drawing_list = user_drawing.get('drawing', user_drawing)
            if not isinstance(drawing_list, list):
                drawing_list = user_drawing
        return _calculate_polygon_coverage_legacy(polygon_points, drawing_list)