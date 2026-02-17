# task_system/ui/editor/annotation_manager.py
from copy import deepcopy
from enum import Enum

try:
    from task_system.ui.constants import ANNOTATION_STYLES, POINT_STYLES, LABEL_STYLE, FONTS
except ImportError:
    # Headless/test fallback for environments without task_system.ui package.
    ANNOTATION_STYLES = {
        "normal": {"fill": "", "outline": "#4CAF50", "width": 2},
        "selected": {"fill": "", "outline": "#2196F3", "width": 3},
        "hover": {"fill": "", "outline": "#FFC107", "width": 3},
        "drawing": {"fill": "", "outline": "#FF9800", "width": 2, "dash": (4, 2)},
    }
    POINT_STYLES = {
        "normal": {"radius": 5, "fill": "#4CAF50", "outline": "#FFFFFF", "outline_width": 1},
        "selected": {"radius": 6, "fill": "#2196F3", "outline": "#FFFFFF", "outline_width": 2},
        "hover": {"radius": 6, "fill": "#FFC107", "outline": "#FFFFFF", "outline_width": 2},
    }
    LABEL_STYLE = {
        "fill": "#FFFFFF",
        "font": ("Arial", 10, "bold"),
        "padding": 4,
        "bg_fill": "#000000",
        "bg_outline": "#FFFFFF",
    }
    FONTS = {
        "point_number": ("Arial", 8, "normal"),
    }


class AnnotationType(str, Enum):
    """Типы аннотаций."""
    POINT = "point"
    POLYGON = "polygon"
    FREEHAND = "freehand"


class AnnotationManager:
    """
    Управляет аннотациями (point, polygon), хранит undo/redo.
    Все координаты — в координатах изображения (не canvas).
    """
    
    # Цветовая схема
    COLORS = {
        "normal": "#4CAF50",      # Зелёный
        "selected": "#2196F3",    # Синий
        "drawing": "#FF9800",     # Оранжевый
        "hover": "#FFC107",       # Янтарный (опционально)
        "point_border": "#FFFFFF", # Белый
        "label_bg": "#FFFFFF",  # Белый (Tkinter не поддерживает альфа-канал)
        "selected_point": "#F44336", # Красный (для выбранных точек)
    }
    
    # Палитра из 25 цветов для разных линий
    COLOR_PALETTE = [
        "#4CAF50",  # Зелёный
        "#2196F3",  # Синий
        "#FF9800",  # Оранжевый
        "#9C27B0",  # Фиолетовый
        "#F44336",  # Красный
        "#00BCD4",  # Голубой
        "#FFEB3B",  # Жёлтый
        "#795548",  # Коричневый
        "#607D8B",  # Сине-серый
        "#E91E63",  # Розовый
        "#3F51B5",  # Индиго
        "#009688",  # Бирюзовый
        "#FF5722",  # Глубокий оранжевый
        "#8BC34A",  # Светло-зелёный
        "#FFC107",  # Янтарный
        "#673AB7",  # Глубокий фиолетовый
        "#CDDC39",  # Лайм
        "#00ACC1",  # Циан
        "#FF6F00",  # Янтарный (тёмный)
        "#5C6BC0",  # Индиго (светлый)
        "#26A69A",  # Бирюзовый (светлый)
        "#EF5350",  # Красный (светлый)
        "#42A5F5",  # Синий (светлый)
        "#66BB6A",  # Зелёный (светлый)
        "#AB47BC",  # Фиолетовый (светлый)
    ]
    
    # Размеры и стили
    SIZES = {
        "point_radius": 7,  # Увеличен для лучшей видимости
        "point_border": 2,
        "selected_point_radius": 9,  # Увеличен для лучшей видимости
        "line_width": 3,
        "selected_line_width": 4,
    }
    
    # Шрифты
    FONTS = {
        "label": ("Arial", 10, "bold"),
        "point_number": ("Arial", 8, "normal"),
    }

    def __init__(self):
        self.annotations = []
        self.drawing = False
        self.current_polygon = []
        self.selected_annotation_index = None
        self.selected_point_index = None
        self.undo_stack = []
        self.redo_stack = []
        # Freehand рисование (Фаза 2: пункт 2.3)
        self.freehand_points = []  # Временные точки во время рисования
        self.drawing_freehand = False
        # Перетаскивание точек (Фаза 2: пункт 1)
        self.dragging_point = False
        self.drag_start_pos = None
        self.drag_ann_index = None
        self.drag_point_index = None
        # Кэш bounding box для оптимизации point-in-polygon (Фаза 9: пункт 9.2)
        self._annotation_bbox_cache = {}  # {index: (min_x, min_y, max_x, max_y)}
    
    def _get_next_color(self):
        """Получает следующий цвет из палитры для новой аннотации."""
        # Подсчитываем количество аннотаций типа polygon и freehand
        line_count = sum(1 for ann in self.annotations if ann.get("type") in ("polygon", "freehand"))
        # Используем цвет из палитры по кругу
        return self.COLOR_PALETTE[line_count % len(self.COLOR_PALETTE)]

    def add_point(self, x, y, label=""):
        """Добавляет точку-аннотацию."""
        ann = {"type": "point", "label": label or "", "x": int(x), "y": int(y)}
        self.annotations.append(ann)
        # Кэш bbox не нужно инвалидировать при добавлении - он будет вычислен при первом запросе
        self._push_undo({"op": "add_annotation", "annotation": deepcopy(ann)})
        self._clear_redo()

    def start_polygon(self, x=None, y=None):
        """Начинает рисование полигона."""
        self.drawing = True
        if x is not None and y is not None:
            self.current_polygon = [(float(x), float(y))]
        else:
            self.current_polygon = []

    def add_polygon_point(self, x, y):
        """Добавляет точку к текущему полигону."""
        if not self.drawing:
            self.start_polygon(x, y)
        else:
            self.current_polygon.append((float(x), float(y)))

    def finish_polygon(self, label=""):
        """Завершает рисование полигона."""
        if not self.drawing or len(self.current_polygon) < 3:
            self.cancel_polygon()
            return False
        # Получаем цвет для новой аннотации
        color = self._get_next_color()
        ann = {
            "type": "polygon", 
            "label": label or "", 
            "points": [tuple(p) for p in self.current_polygon],
            "color": color  # Сохраняем цвет в аннотации
        }
        self.annotations.append(ann)
        # Кэш bbox не нужно инвалидировать при добавлении - он будет вычислен при первом запросе
        self._push_undo({"op": "add_annotation", "annotation": deepcopy(ann)})
        self._clear_redo()
        self.drawing = False
        self.current_polygon = []
        return True

    def cancel_polygon(self):
        self.drawing = False
        self.current_polygon = []
    
    def start_freehand(self, x, y):
        """
        Начинает freehand рисование (Фаза 2: пункт 2.3).
        
        Args:
            x, y: Начальные координаты точки (в координатах изображения)
        """
        self.drawing_freehand = True
        self.freehand_points = [(float(x), float(y))]
    
    def add_freehand_point(self, x, y):
        """
        Добавляет точку к freehand (каждое mouse move) (Фаза 2: пункт 2.3).
        
        Args:
            x, y: Координаты новой точки (в координатах изображения)
        """
        if not self.drawing_freehand:
            self.start_freehand(x, y)
        else:
            self.freehand_points.append((float(x), float(y)))
    
    def finish_freehand(self, label="", simplify=True):
        """
        Завершает freehand, упрощает линию, создаёт аннотацию.
        
        Args:
            label: Метка для аннотации
            simplify: Упрощать линию через RDP алгоритм (по умолчанию True, epsilon=2.0)
        
        Returns:
            bool: True если аннотация была создана, False иначе
        """
        if not self.drawing_freehand or len(self.freehand_points) < 2:
            self.drawing_freehand = False
            self.freehand_points = []
            return False
        
        # Упрощаем линию если нужно (Фаза 2: пункт 2.3)
        points = self.freehand_points
        if simplify and len(points) > 2:
            epsilon = 2.0  # Порог упрощения согласно плану
            points = self.rdp_simplify(points, epsilon)
        
        # Создаём аннотацию типа freehand
        # Хранится как polygon, но с флагом типа "freehand"
        # Получаем цвет для новой аннотации
        color = self._get_next_color()
        ann = {
            "type": "freehand",
            "label": label or "",
            "points": points,
            "smoothed": simplify,
            "color": color  # Сохраняем цвет в аннотации
        }
        self.annotations.append(ann)
        self._push_undo({"op": "add_annotation", "annotation": deepcopy(ann)})
        self._clear_redo()
        
        # Сбрасываем состояние
        self.drawing_freehand = False
        self.freehand_points = []
        return True
    
    def cancel_freehand(self):
        """Отменяет freehand рисование."""
        self.drawing_freehand = False
        self.freehand_points = []
    
    def rdp_simplify(self, points, epsilon):
        """
        Ramer-Douglas-Peucker упрощение линии (Фаза 2: пункт 2.3).
        
        Стандартная реализация алгоритма Ramer-Douglas-Peucker для упрощения полилиний.
        
        Args:
            points: Список точек [(x1, y1), (x2, y2), ...]
            epsilon: Порог упрощения (в пикселях)
        
        Returns:
            Упрощённый список точек
        """
        if len(points) < 3:
            return points
        
        def perpendicular_distance(point, line_start, line_end):
            """Вычисляет перпендикулярное расстояние от точки до линии."""
            x0, y0 = point
            x1, y1 = line_start
            x2, y2 = line_end
            
            # Вектор линии
            dx = x2 - x1
            dy = y2 - y1
            
            # Если линия - точка, возвращаем расстояние до неё
            if dx == 0 and dy == 0:
                return ((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5
            
            # Параметр проекции
            t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
            t = max(0, min(1, t))
            
            # Точка проекции
            proj_x = x1 + t * dx
            proj_y = y1 + t * dy
            
            # Расстояние
            return ((x0 - proj_x) ** 2 + (y0 - proj_y) ** 2) ** 0.5
        
        def rdp_recursive(points, epsilon):
            """Рекурсивная часть RDP алгоритма."""
            if len(points) < 3:
                return points
            
            # Находим точку с максимальным расстоянием
            max_dist = 0
            max_index = 0
            start = points[0]
            end = points[-1]
            
            for i in range(1, len(points) - 1):
                dist = perpendicular_distance(points[i], start, end)
                if dist > max_dist:
                    max_dist = dist
                    max_index = i
            
            # Если максимальное расстояние меньше epsilon, возвращаем только начальную и конечную точки
            if max_dist < epsilon:
                return [start, end]
            
            # Рекурсивно упрощаем левую и правую части
            left = rdp_recursive(points[:max_index + 1], epsilon)
            right = rdp_recursive(points[max_index:], epsilon)
            
            # Объединяем результаты (убираем дубликат точки max_index)
            return left[:-1] + right
        
        return rdp_recursive(points, epsilon)

    def select_annotation(self, index):
        if index is None:
            self.selected_annotation_index = None
            self.selected_point_index = None
            return
        if 0 <= index < len(self.annotations):
            self.selected_annotation_index = index
            self.selected_point_index = None
    
    def deselect(self):
        """Снимает выбор с аннотации."""
        self.selected_annotation_index = None
        self.selected_point_index = None
        # Сбрасываем состояние перетаскивания при снятии выбора (Фаза 2: пункт 1)
        self.dragging_point = False
        self.drag_start_pos = None
        self.drag_ann_index = None
        self.drag_point_index = None
    
    def is_selected(self, ann_index):
        """Проверяет, выбрана ли аннотация."""
        return self.selected_annotation_index == ann_index
    
    def select_annotation_at(self, x, y, threshold=10):
        """
        Выбирает аннотацию по клику. Возвращает (ann_index, point_index или None).
        
        Приоритет проверки:
        1. Клик на точки полигонов (приоритет)
        2. Клик внутри полигона (point-in-polygon algorithm)
        3. Клик на точки-аннотации
        4. Клик близко к freehand линиям
        
        Args:
            x, y: Координаты клика в координатах изображения
            threshold: Порог для проверки близости к точкам и линиям (в пикселях)
        
        Returns:
            tuple: (ann_index, point_index) где point_index - индекс точки или None
                   или None если ничего не выбрано
        """
        # 1. Проверяем клик на точки полигонов (приоритет)
        for i, ann in enumerate(self.annotations):
            # Пропускаем скрытые аннотации
            if ann.get('hidden', False):
                continue
                
            if ann.get("type") in ["polygon", "freehand"]:
                points = ann.get("points", [])
                for j, (px, py) in enumerate(points):
                    distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
                    if distance <= threshold:
                        self.selected_annotation_index = i
                        self.selected_point_index = j
                        return (i, j)
        
        # 2. Проверяем клик внутри полигона (point-in-polygon с оптимизацией bbox) (Фаза 9: пункт 9.2)
        for i, ann in enumerate(self.annotations):
            # Пропускаем скрытые аннотации
            if ann.get('hidden', False):
                continue
                
            if ann.get("type") == "polygon":
                points = ann.get("points", [])
                if len(points) >= 3:
                    # Сначала проверяем bounding box для быстрой фильтрации
                    bbox = self._get_annotation_bbox(i)
                    if bbox is not None:
                        min_x, min_y, max_x, max_y = bbox
                        # Проверяем, находится ли точка в bbox
                        if min_x <= x <= max_x and min_y <= y <= max_y:
                            # Точка в bbox, проверяем point-in-polygon
                            if self._point_in_polygon(x, y, points):
                                self.selected_annotation_index = i
                                self.selected_point_index = None
                                return (i, None)
        
        # 3. Проверяем клик на точки-аннотации
        for i, ann in enumerate(self.annotations):
            # Пропускаем скрытые аннотации
            if ann.get('hidden', False):
                continue
                
            if ann.get("type") == "point":
                px = ann.get("x")
                py = ann.get("y")
                if px is not None and py is not None:
                    distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
                    if distance <= threshold:
                        self.selected_annotation_index = i
                        self.selected_point_index = None
                        return (i, None)
        
        # 4. Проверяем близость к freehand линиям
        for i, ann in enumerate(self.annotations):
            # Пропускаем скрытые аннотации
            if ann.get('hidden', False):
                continue
                
            if ann.get("type") == "freehand":
                points = ann.get("points", [])
                if len(points) >= 2:
                    # Проверяем расстояние до каждого сегмента линии
                    for j in range(len(points) - 1):
                        p1 = points[j]
                        p2 = points[j + 1]
                        distance = self._point_to_line_distance(x, y, p1, p2)
                        if distance <= threshold:
                            self.selected_annotation_index = i
                            self.selected_point_index = None
                            return (i, None)
        
        # Ничего не найдено
        self.deselect()
        return None
    
    def _get_annotation_bbox(self, ann_index):
        """
        Получает bounding box аннотации (с кэшированием) (Фаза 9: пункт 9.2).
        
        Args:
            ann_index: Индекс аннотации
        
        Returns:
            tuple: (min_x, min_y, max_x, max_y) или None если аннотация не имеет точек
        """
        # Проверяем кэш
        if ann_index in self._annotation_bbox_cache:
            return self._annotation_bbox_cache[ann_index]
        
        # Вычисляем bbox
        if ann_index >= len(self.annotations):
            return None
        
        ann = self.annotations[ann_index]
        ann_type = ann.get("type")
        
        if ann_type == "point":
            x = ann.get("x")
            y = ann.get("y")
            if x is not None and y is not None:
                bbox = (x, y, x, y)  # Точка - это bbox размером 0
                self._annotation_bbox_cache[ann_index] = bbox
                return bbox
        
        elif ann_type in ["polygon", "freehand"]:
            points = ann.get("points", [])
            if len(points) == 0:
                return None
            
            min_x = min(p[0] for p in points)
            min_y = min(p[1] for p in points)
            max_x = max(p[0] for p in points)
            max_y = max(p[1] for p in points)
            
            bbox = (min_x, min_y, max_x, max_y)
            self._annotation_bbox_cache[ann_index] = bbox
            return bbox
        
        return None
    
    def _invalidate_bbox_cache(self, ann_index=None):
        """
        Инвалидирует кэш bounding box (Фаза 9: пункт 9.2).
        
        Args:
            ann_index: Индекс аннотации для инвалидации, или None для очистки всего кэша
        """
        if ann_index is not None:
            # Удаляем конкретную запись из кэша
            self._annotation_bbox_cache.pop(ann_index, None)
            # Также нужно удалить все записи с индексом >= ann_index, так как индексы сдвинулись
            if ann_index < len(self.annotations):
                keys_to_remove = [k for k in self._annotation_bbox_cache.keys() if k >= ann_index]
                for k in keys_to_remove:
                    del self._annotation_bbox_cache[k]
        else:
            # Очищаем весь кэш
            self._annotation_bbox_cache.clear()
    
    def _point_in_polygon(self, x, y, points):
        """
        Проверяет, находится ли точка внутри полигона (ray casting algorithm).
        
        Args:
            x, y: Координаты точки
            points: Список точек полигона [(x1, y1), (x2, y2), ...]
        
        Returns:
            bool: True если точка внутри полигона
        """
        if len(points) < 3:
            return False
        
        n = len(points)
        inside = False
        
        j = n - 1
        for i in range(n):
            xi, yi = points[i]
            xj, yj = points[j]
            
            # Проверяем пересечение горизонтального луча от точки (x, y) вправо с ребром (xi, yi) -> (xj, yj)
            if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi) + xi):
                inside = not inside
            
            j = i
        
        return inside
    
    def _point_to_line_distance(self, x, y, line_start, line_end):
        """
        Вычисляет расстояние от точки до отрезка линии.
        
        Args:
            x, y: Координаты точки
            line_start: Начало линии (x, y)
            line_end: Конец линии (x, y)
        
        Returns:
            float: Расстояние от точки до отрезка
        """
        x0, y0 = x, y
        x1, y1 = line_start
        x2, y2 = line_end
        
        # Вектор линии
        dx = x2 - x1
        dy = y2 - y1
        
        # Если линия - точка, возвращаем расстояние до неё
        if dx == 0 and dy == 0:
            return ((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5
        
        # Параметр проекции
        t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
        t = max(0, min(1, t))
        
        # Точка проекции
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy
        
        # Расстояние
        return ((x0 - proj_x) ** 2 + (y0 - proj_y) ** 2) ** 0.5

    def select_point(self, point_index):
        """Выбирает точку в текущем полигоне."""
        if self.selected_annotation_index is None:
            raise RuntimeError("Сначала выберите аннотацию-полигон")
        ann = self.annotations[self.selected_annotation_index]
        if ann.get("type") != "polygon":
            raise RuntimeError("Выбранная аннотация не является полигоном")
        if 0 <= point_index < len(ann.get("points", [])):
            self.selected_point_index = point_index
        else:
            raise RuntimeError(f"Недопустимый индекс точки: {point_index}")

    def delete_selected_point(self):
        """Удаляет выбранную точку из полигона."""
        if self.selected_annotation_index is None:
            raise RuntimeError("Сначала выберите аннотацию-полигон")
        if self.selected_point_index is None:
            raise RuntimeError("Сначала выберите точку для удаления")
        
        ann = self.annotations[self.selected_annotation_index]
        if ann.get("type") != "polygon":
            raise RuntimeError("Выбранная аннотация не является полигоном")
        
        points = ann.get("points", [])
        if len(points) <= 3:
            raise RuntimeError("Полигон должен иметь минимум 3 точки")
        
        # Сохраняем состояние для undo
        old_annotation = deepcopy(ann)
        
        # Удаляем точку
        points.pop(self.selected_point_index)
        ann["points"] = points
        
        # Сохраняем в стек undo
        self._push_undo({
            "op": "modify_annotation",
            "annotation_index": self.selected_annotation_index,
            "old_annotation": old_annotation,
            "new_annotation": deepcopy(ann)
        })
        self._clear_redo()
        
        # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
        self._invalidate_bbox_cache(self.selected_annotation_index)
        
        # Сбрасываем выбор точки
        self.selected_point_index = None

    def delete_annotation(self, index=None):
        """
        Удаляет аннотацию по индексу, пушит в undo (Фаза 2: пункт 2.5).
        
        Args:
            index: Индекс аннотации для удаления. Если None, удаляет выбранную аннотацию.
        
        Returns:
            bool: True если аннотация была удалена, False иначе
        """
        if index is None:
            index = self.selected_annotation_index
        if index is None or not (0 <= index < len(self.annotations)):
            return False
        
        # Сохраняем аннотацию для undo
        ann = deepcopy(self.annotations[index])
        
        # Удаляем аннотацию
        self.annotations.pop(index)
        
        # Инвалидируем кэш bbox для удаленной аннотации и всех после нее (Фаза 9: пункт 9.2)
        self._invalidate_bbox_cache(index)
        
        # Пушим в undo
        self._push_undo({"op": "delete_annotation", "annotation_index": index, "annotation": ann})
        self._clear_redo()
        
        # Обновляем выбор: если удалена выбранная аннотация или аннотация перед ней
        if self.selected_annotation_index is not None:
            if self.selected_annotation_index == index:
                # Удалена выбранная аннотация
                self.selected_annotation_index = None
                self.selected_point_index = None
            elif self.selected_annotation_index > index:
                # Удалена аннотация перед выбранной - нужно уменьшить индекс
                self.selected_annotation_index -= 1
        
        return True
    
    def delete_selected(self):
        """
        Удаляет выбранную аннотацию (Фаза 2: пункт 2.5).
        
        Returns:
            bool: True если аннотация была удалена, False иначе
        """
        if self.selected_annotation_index is None:
            return False
        return self.delete_annotation(self.selected_annotation_index)
    
    def update_annotation_label(self, ann_index, new_label):
        """Обновляет название (label) аннотации."""
        if 0 <= ann_index < len(self.annotations):
            self.annotations[ann_index]['label'] = new_label
            # TODO: Добавить в undo/redo стек

    def toggle_annotation_visibility(self, index):
        """
        Переключает видимость аннотации.
        
        Args:
            index: Индекс аннотации
        
        Returns:
            bool: True если видимость была изменена, False иначе
        """
        if not (0 <= index < len(self.annotations)):
            return False
        
        ann = self.annotations[index]
        # По умолчанию аннотация видима (если поле hidden отсутствует, считаем что False)
        current_state = ann.get('hidden', False)
        ann['hidden'] = not current_state
        
        # Инвалидируем кэш bbox (хотя это не обязательно, но для консистентности)
        self._invalidate_bbox_cache(index)
        
        return True

    def is_annotation_visible(self, index):
        """
        Проверяет, видима ли аннотация.
        
        Args:
            index: Индекс аннотации
        
        Returns:
            bool: True если аннотация видима, False если скрыта
        """
        if not (0 <= index < len(self.annotations)):
            return False
        ann = self.annotations[index]
        return not ann.get('hidden', False)

    def delete_point(self, ann_index, point_index):
        """Удаляет точку из аннотации."""
        if not (0 <= ann_index < len(self.annotations)):
            return False
            
        ann = self.annotations[ann_index]
        if ann['type'] == 'polygon':
            if len(ann['points']) <= 3:
                return False  # Нельзя удалять, если точек 3 или меньше
        elif ann['type'] == 'freehand':
            if len(ann['points']) <= 2:
                return False  # Линия должна иметь хотя бы 2 точки
        
        if 0 <= point_index < len(ann['points']):
            del ann['points'][point_index]
            # TODO: Добавить в undo/redo стек
            return True
        return False

    def clear_all(self):
        """
        Очищает все аннотации, пушит в undo (Фаза 2: пункт 2.5).
        """
        if not self.annotations:
            return
        
        # Сохраняем все аннотации для undo
        all_annotations = deepcopy(self.annotations)
        
        # Очищаем список
        self.annotations.clear()
        
        # Очищаем весь кэш bbox (Фаза 9: пункт 9.2)
        self._invalidate_bbox_cache()
        
        # Пушим в undo (одна операция для всех)
        self._push_undo({"op": "clear_all", "annotations": all_annotations})
        self._clear_redo()
        
        # Сбрасываем выбор
        self.selected_annotation_index = None
        self.selected_point_index = None
        
        # Сбрасываем состояние рисования
        self.drawing = False
        self.current_polygon = []
        self.drawing_freehand = False
        self.freehand_points = []

    def start_drag_point(self, ann_index, point_index, x, y):
        """
        Начинает перетаскивание точки.
        
        Args:
            ann_index: Индекс аннотации
            point_index: Индекс точки в аннотации (None для точки-аннотации)
            x, y: Начальные координаты перетаскивания (в координатах изображения)
        """
        if not (0 <= ann_index < len(self.annotations)):
            raise RuntimeError(f"Недопустимый индекс аннотации: {ann_index}")
        
        ann = self.annotations[ann_index]
        ann_type = ann.get("type")
        
        # Проверяем тип аннотации
        if ann_type == "point":
            # Для точки-аннотации point_index должен быть None
            if point_index is not None:
                raise RuntimeError("Для точки-аннотации point_index должен быть None")
            
            # Сохраняем начальную позицию
            old_x = ann.get("x")
            old_y = ann.get("y")
            self.drag_start_pos = (old_x, old_y)
            
        elif ann_type in ["polygon", "freehand"]:
            # Для полигона и freehand point_index должен быть указан
            if point_index is None:
                raise RuntimeError(f"Для {ann_type} point_index должен быть указан")
            
            points = ann.get("points", [])
            if not (0 <= point_index < len(points)):
                raise RuntimeError(f"Недопустимый индекс точки: {point_index}")
            
            # Сохраняем начальную позицию
            old_pos = points[point_index]
            self.drag_start_pos = tuple(old_pos)
        else:
            raise RuntimeError(f"Неподдерживаемый тип аннотации для перетаскивания: {ann_type}")
        
        # Устанавливаем состояние перетаскивания
        self.dragging_point = True
        self.drag_ann_index = ann_index
        self.drag_point_index = point_index
        
        # Обновляем выбранную аннотацию и точку
        self.selected_annotation_index = ann_index
        self.selected_point_index = point_index

    def update_drag_point(self, x, y):
        """
        Обновляет позицию перетаскиваемой точки.
        
        Args:
            x, y: Новые координаты точки (в координатах изображения)
        """
        if not self.dragging_point:
            return False
        
        if self.drag_ann_index is None or not (0 <= self.drag_ann_index < len(self.annotations)):
            # Сбрасываем состояние перетаскивания при ошибке
            self.dragging_point = False
            self.drag_start_pos = None
            self.drag_ann_index = None
            self.drag_point_index = None
            return False
        
        ann = self.annotations[self.drag_ann_index]
        ann_type = ann.get("type")
        
        # Обновляем координаты точки
        if ann_type == "point":
            # Для точки-аннотации обновляем x, y
            ann["x"] = float(x)
            ann["y"] = float(y)
            
        elif ann_type in ["polygon", "freehand"]:
            # Для полигона и freehand обновляем точку в массиве points
            if self.drag_point_index is None:
                return False
            
            points = ann.get("points", [])
            if not (0 <= self.drag_point_index < len(points)):
                return False
            
            # Обновляем координаты точки
            points[self.drag_point_index] = (float(x), float(y))
            ann["points"] = points
            
            # Инвалидируем кэш bbox для измененной аннотации
            self._invalidate_bbox_cache(self.drag_ann_index)
        else:
            return False
        
        return True

    def finish_drag_point(self):
        """
        Завершает перетаскивание, пушит в undo.
        
        Returns:
            bool: True если перетаскивание было успешно завершено, False иначе
        """
        if not self.dragging_point:
            return False
        
        if self.drag_ann_index is None or self.drag_start_pos is None:
            # Сбрасываем состояние перетаскивания при ошибке
            self.dragging_point = False
            self.drag_start_pos = None
            self.drag_ann_index = None
            self.drag_point_index = None
            return False
        
        if not (0 <= self.drag_ann_index < len(self.annotations)):
            # Сбрасываем состояние перетаскивания при ошибке
            self.dragging_point = False
            self.drag_start_pos = None
            self.drag_ann_index = None
            self.drag_point_index = None
            return False
        
        ann = self.annotations[self.drag_ann_index]
        ann_type = ann.get("type")
        
        # Получаем новую позицию
        if ann_type == "point":
            new_pos = (ann.get("x"), ann.get("y"))
        elif ann_type in ["polygon", "freehand"]:
            if self.drag_point_index is None or not (0 <= self.drag_point_index < len(ann.get("points", []))):
                # Сбрасываем состояние перетаскивания при ошибке
                self.dragging_point = False
                self.drag_start_pos = None
                self.drag_ann_index = None
                self.drag_point_index = None
                return False
            new_pos = tuple(ann.get("points", [])[self.drag_point_index])
        else:
            # Сбрасываем состояние перетаскивания при ошибке
            self.dragging_point = False
            self.drag_start_pos = None
            self.drag_ann_index = None
            self.drag_point_index = None
            return False
        
        # Проверяем, изменилась ли позиция
        old_pos = self.drag_start_pos
        if old_pos == new_pos:
            # Позиция не изменилась, просто сбрасываем состояние
            self.dragging_point = False
            self.drag_start_pos = None
            self.drag_ann_index = None
            self.drag_point_index = None
            return False
        
        # Сохраняем операцию в undo stack
        undo_op = {
            "op": "modify_point",
            "annotation_index": self.drag_ann_index,
            "point_index": self.drag_point_index,
            "old_position": old_pos,
            "new_position": new_pos
        }
        self._push_undo(undo_op)
        self._clear_redo()
        
        # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
        self._invalidate_bbox_cache(self.drag_ann_index)
        
        # Сбрасываем состояние перетаскивания
        self.dragging_point = False
        self.drag_start_pos = None
        self.drag_ann_index = None
        self.drag_point_index = None
        
        return True

    def _push_undo(self, op):
        self.undo_stack.append(op)
        if len(self.undo_stack) > 200:
            self.undo_stack.pop(0)

    def _clear_redo(self):
        self.redo_stack.clear()

    def undo(self):
        if not self.undo_stack:
            return False
        op = self.undo_stack.pop()
        self.redo_stack.append(deepcopy(op))
        if op["op"] == "add_annotation":
            ann = op["annotation"]
            for i in range(len(self.annotations)-1, -1, -1):
                if self.annotations[i] == ann:
                    self.annotations.pop(i)
                    # Инвалидируем кэш bbox для удаленной аннотации (Фаза 9: пункт 9.2)
                    self._invalidate_bbox_cache(i)
                    break
        elif op["op"] == "delete_annotation":
            idx = op.get("annotation_index", len(self.annotations))
            ann = op["annotation"]
            if idx < 0:
                idx = 0
            if idx > len(self.annotations):
                idx = len(self.annotations)
            self.annotations.insert(idx, ann)
            # Инвалидируем кэш bbox для вставленной аннотации и всех после нее (Фаза 9: пункт 9.2)
            self._invalidate_bbox_cache(idx)
        elif op["op"] == "modify_annotation":
            idx = op.get("annotation_index")
            if idx is not None and 0 <= idx < len(self.annotations):
                self.annotations[idx] = deepcopy(op["old_annotation"])
                # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
                self._invalidate_bbox_cache(idx)
        elif op["op"] == "modify_point":
            # Отменяем перетаскивание точки (Фаза 2: пункт 2)
            idx = op.get("annotation_index")
            point_idx = op.get("point_index")
            old_pos = op.get("old_position")
            
            if idx is not None and 0 <= idx < len(self.annotations) and old_pos is not None:
                ann = self.annotations[idx]
                ann_type = ann.get("type")
                
                if ann_type == "point":
                    # Для точки-аннотации восстанавливаем x, y
                    ann["x"] = old_pos[0]
                    ann["y"] = old_pos[1]
                elif ann_type in ["polygon", "freehand"]:
                    # Для полигона и freehand восстанавливаем точку в массиве points
                    if point_idx is not None:
                        points = ann.get("points", [])
                        if 0 <= point_idx < len(points):
                            points[point_idx] = tuple(old_pos)
                            ann["points"] = points
                
                # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
                self._invalidate_bbox_cache(idx)
        elif op["op"] == "clear_all":
            # Отменяем очистку всех аннотаций (Фаза 2: пункт 2.5)
            annotations = op.get("annotations", [])
            if annotations:
                self.annotations = deepcopy(annotations)
            # Очищаем весь кэш bbox (Фаза 9: пункт 9.2)
            self._invalidate_bbox_cache()
        return True

    def redo(self):
        if not self.redo_stack:
            return False
        op = self.redo_stack.pop()
        self.undo_stack.append(deepcopy(op))
        if op["op"] == "add_annotation":
            self.annotations.append(op["annotation"])
            # Кэш bbox не нужно инвалидировать при добавлении - он будет вычислен при первом запросе
        elif op["op"] == "delete_annotation":
            idx = op.get("annotation_index")
            if idx is None:
                try:
                    # Находим индекс перед удалением
                    found_idx = self.annotations.index(op["annotation"])
                    self.annotations.remove(op["annotation"])
                    # Инвалидируем кэш bbox для удаленной аннотации (Фаза 9: пункт 9.2)
                    self._invalidate_bbox_cache(found_idx)
                except ValueError:
                    pass
            else:
                if 0 <= idx < len(self.annotations):
                    self.annotations.pop(idx)
                    # Инвалидируем кэш bbox для удаленной аннотации и всех после нее (Фаза 9: пункт 9.2)
                    self._invalidate_bbox_cache(idx)
        elif op["op"] == "modify_annotation":
            idx = op.get("annotation_index")
            if idx is not None and 0 <= idx < len(self.annotations):
                self.annotations[idx] = deepcopy(op["new_annotation"])
                # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
                self._invalidate_bbox_cache(idx)
        elif op["op"] == "modify_point":
            # Возвращаем перетаскивание точки (Фаза 2: пункт 2)
            idx = op.get("annotation_index")
            point_idx = op.get("point_index")
            new_pos = op.get("new_position")
            
            if idx is not None and 0 <= idx < len(self.annotations) and new_pos is not None:
                ann = self.annotations[idx]
                ann_type = ann.get("type")
                
                if ann_type == "point":
                    # Для точки-аннотации применяем новые x, y
                    ann["x"] = new_pos[0]
                    ann["y"] = new_pos[1]
                elif ann_type in ["polygon", "freehand"]:
                    # Для полигона и freehand применяем новую точку в массиве points
                    if point_idx is not None:
                        points = ann.get("points", [])
                        if 0 <= point_idx < len(points):
                            points[point_idx] = tuple(new_pos)
                            ann["points"] = points
                
                # Инвалидируем кэш bbox для измененной аннотации (Фаза 9: пункт 9.2)
                self._invalidate_bbox_cache(idx)
        elif op["op"] == "clear_all":
            # Повторяем очистку всех аннотаций (Фаза 2: пункт 2.5)
            self.annotations.clear()
            # Очищаем весь кэш bbox (Фаза 9: пункт 9.2)
            self._invalidate_bbox_cache()
            # Сбрасываем выбор
            self.selected_annotation_index = None
            self.selected_point_index = None
            # Сбрасываем состояние рисования
            self.drawing = False
            self.current_polygon = []
            self.drawing_freehand = False
            self.freehand_points = []
        return True

    def redraw(self, canvas, scale, offset_x, offset_y, show_labels=True, hovered_indices=None):
        """
        Перерисовывает аннотации на canvas с использованием стилей.
        
        Args:
            canvas: Canvas для отрисовки
            scale: Масштаб отображения
            offset_x: Смещение по X
            offset_y: Смещение по Y
            show_labels: Показывать ли метки
            hovered_indices: Кортеж (ann_index, point_index) для hover-эффекта, или None
        """
        if canvas is None:
            return
        try:
            canvas.delete("annotation")
        except:
            pass

        # Отрисовываем существующие аннотации только если НЕ идет создание новой
        if not (self.drawing or self.drawing_freehand):
            for i, ann in enumerate(self.annotations):
                # Пропускаем скрытые аннотации
                if ann.get('hidden', False):
                    continue
                    
                is_selected = (i == self.selected_annotation_index)
                is_hovered = hovered_indices and hovered_indices[0] == i and hovered_indices[1] is None

                # Определяем стиль линии/полигона
                if is_selected:
                    style = ANNOTATION_STYLES["selected"]
                elif is_hovered:
                    style = ANNOTATION_STYLES["hover"]
                else:
                    style = ANNOTATION_STYLES["normal"]
                
                # Используем цвет из аннотации, если он есть, иначе цвет из стиля
                color = ann.get("color", style["outline"])
                line_width = style["width"]
                
                if ann["type"] == "point":
                    x = ann["x"] * scale + offset_x
                    y = ann["y"] * scale + offset_y
                    
                    # Определяем стиль точки
                    point_is_hovered = hovered_indices and hovered_indices[0] == i and hovered_indices[1] is None
                    if is_selected:
                        p_style = POINT_STYLES["selected"]
                    elif point_is_hovered:
                        p_style = POINT_STYLES["hover"]
                    else:
                        p_style = POINT_STYLES["normal"]
                    
                    # Рисуем точку
                    canvas.create_oval(
                        x - p_style["radius"], y - p_style["radius"],
                        x + p_style["radius"], y + p_style["radius"],
                        fill=p_style["fill"], outline=p_style["outline"], width=p_style["outline_width"],
                        tags="annotation"
                    )
                    
                    # Рисуем метку с фоном
                    if show_labels:
                        label = ann.get("label", "")
                        if label:
                            label_y = y - p_style["radius"] - 8
                            # 1. Создаём текст
                            label_item = canvas.create_text(
                                x, label_y,
                                text=label,
                                fill=LABEL_STYLE["fill"],
                                font=LABEL_STYLE["font"],
                                tags="annotation"
                            )
                            # 2. Вычислить bbox текста
                            bbox = canvas.bbox(label_item)
                            if bbox:
                                # 3. Создать прямоугольник-фон
                                bg_rect = canvas.create_rectangle(
                                    bbox[0] - LABEL_STYLE["padding"], bbox[1] - LABEL_STYLE["padding"],
                                    bbox[2] + LABEL_STYLE["padding"], bbox[3] + LABEL_STYLE["padding"],
                                    fill=LABEL_STYLE["bg_fill"], outline=LABEL_STYLE["bg_outline"],
                                    tags="annotation"
                                )
                                # 4. Поднять текст наверх
                                canvas.tag_raise(label_item)
                
                elif ann["type"] == "polygon":
                    pts = []
                    # Собираем все координаты точек
                    for j, p in enumerate(ann["points"]):
                        px = p[0] * scale + offset_x
                        py = p[1] * scale + offset_y
                        pts.extend([px, py])
                    
                    if pts:
                        # Рисуем полигон (линия контура) только если есть минимум 2 точки
                        if len(pts) >= 4:
                            canvas.create_polygon(
                                pts, fill=style.get("fill", ""), outline=style["outline"], width=style["width"],
                                tags="annotation"
                            )
                        
                        # Рисуем точки поверх линии
                        for j, p in enumerate(ann["points"]):
                            px = p[0] * scale + offset_x
                            py = p[1] * scale + offset_y
                            
                            # Определяем стиль точки
                            point_is_selected = is_selected and j == self.selected_point_index
                            point_is_hovered = hovered_indices and hovered_indices[0] == i and hovered_indices[1] == j
                            
                            if point_is_selected:
                                p_style = POINT_STYLES["selected"]
                            elif point_is_hovered:
                                p_style = POINT_STYLES["hover"]
                            else:
                                p_style = POINT_STYLES["normal"]
                            
                            # Рисуем круг для точки
                            point_item = canvas.create_oval(
                                px - p_style["radius"], py - p_style["radius"],
                                px + p_style["radius"], py + p_style["radius"],
                                fill=p_style["fill"], outline=p_style["outline"],
                                width=p_style["outline_width"], tags="annotation"
                            )
                            # Поднимаем точку поверх линии
                            canvas.tag_raise(point_item)
                            
                            # Рисуем номер точки
                            number_text = str(j + 1)  # Номер начинается с 1
                            number_item = canvas.create_text(
                                px, py,
                                text=number_text,
                                fill=p_style["outline"],  # Белый цвет для контраста
                                font=FONTS["point_number"],
                                tags="annotation"
                            )
                            # Поднимаем номер поверх точки
                            canvas.tag_raise(number_item)
                        
                        # Показываем метку в центре полигона
                        if show_labels:
                            label = ann.get("label", "")
                            if label:
                                # Вычисляем центр масс полигона
                                center_x = sum(pts[::2]) / len(pts[::2])
                                center_y = sum(pts[1::2]) / len(pts[1::2])
                                label_y = center_y - 5  # Offset 5px выше центра
                                
                                # 1. Создаём текст
                                label_item = canvas.create_text(
                                    center_x, label_y,
                                    text=label,
                                    fill=LABEL_STYLE["fill"],
                                    font=LABEL_STYLE["font"],
                                    tags="annotation"
                                )
                                # 2. Вычислить bbox текста
                                bbox = canvas.bbox(label_item)
                                if bbox:
                                    # 3. Создать прямоугольник-фон
                                    bg_rect = canvas.create_rectangle(
                                        bbox[0] - LABEL_STYLE["padding"], bbox[1] - LABEL_STYLE["padding"],
                                        bbox[2] + LABEL_STYLE["padding"], bbox[3] + LABEL_STYLE["padding"],
                                        fill=LABEL_STYLE["bg_fill"], outline=LABEL_STYLE["bg_outline"],
                                        tags="annotation"
                                    )
                                    # 4. Поднять текст наверх
                                    canvas.tag_raise(label_item)
                
                elif ann["type"] == "freehand":
                    points = ann.get("points", [])
                    if len(points) >= 2:
                        # Преобразуем точки в координаты canvas
                        canvas_pts = []
                        for p in points:
                            px = p[0] * scale + offset_x
                            py = p[1] * scale + offset_y
                            canvas_pts.extend([px, py])
                        
                        # Рисуем как polyline (линия, не замыкая)
                        canvas.create_line(
                            canvas_pts, fill=style["outline"], width=style["width"],
                            tags="annotation", smooth=False
                        )
                        
                        # Рисуем только первую и последнюю точки
                        if len(points) >= 1:
                            # Первая точка
                            first_p = points[0]
                            px = first_p[0] * scale + offset_x
                            py = first_p[1] * scale + offset_y
                            point_is_selected = is_selected and self.selected_point_index == 0
                            point_is_hovered = hovered_indices and hovered_indices[0] == i and hovered_indices[1] == 0
                            
                            if point_is_selected:
                                p_style = POINT_STYLES["selected"]
                            elif point_is_hovered:
                                p_style = POINT_STYLES["hover"]
                            else:
                                p_style = POINT_STYLES["normal"]
                            
                            canvas.create_oval(
                                px - p_style["radius"], py - p_style["radius"],
                                px + p_style["radius"], py + p_style["radius"],
                                fill=p_style["fill"], outline=p_style["outline"],
                                width=p_style["outline_width"], tags="annotation"
                            )
                        
                        if len(points) >= 2:
                            # Последняя точка
                            last_p = points[-1]
                            px = last_p[0] * scale + offset_x
                            py = last_p[1] * scale + offset_y
                            point_is_selected = is_selected and self.selected_point_index == len(points) - 1
                            point_is_hovered = hovered_indices and hovered_indices[0] == i and hovered_indices[1] == len(points) - 1
                            
                            if point_is_selected:
                                p_style = POINT_STYLES["selected"]
                            elif point_is_hovered:
                                p_style = POINT_STYLES["hover"]
                            else:
                                p_style = POINT_STYLES["normal"]
                            
                            canvas.create_oval(
                                px - p_style["radius"], py - p_style["radius"],
                                px + p_style["radius"], py + p_style["radius"],
                                fill=p_style["fill"], outline=p_style["outline"],
                                width=p_style["outline_width"], tags="annotation"
                            )
                        
                        # Показываем метку в середине линии
                        if show_labels:
                            label = ann.get("label", "")
                            if label and len(canvas_pts) >= 4:
                                # Вычисляем реальную середину линии по длине
                                # Сначала вычисляем общую длину линии
                                total_length = 0
                                segment_lengths = []
                                for i in range(0, len(canvas_pts) - 2, 2):
                                    x1, y1 = canvas_pts[i], canvas_pts[i + 1]
                                    x2, y2 = canvas_pts[i + 2], canvas_pts[i + 3]
                                    seg_len = ((x2 - x1) ** 2 + (y2 - y1) ** 2) ** 0.5
                                    segment_lengths.append(seg_len)
                                    total_length += seg_len
                                
                                # Находим сегмент, в котором находится середина
                                if total_length > 0:
                                    target_length = total_length / 2
                                    accumulated = 0
                                    center_x, center_y = canvas_pts[0], canvas_pts[1]  # По умолчанию начало
                                    
                                    for i, seg_len in enumerate(segment_lengths):
                                        if accumulated + seg_len >= target_length:
                                            # Середина находится в этом сегменте
                                            t = (target_length - accumulated) / seg_len if seg_len > 0 else 0
                                            x1, y1 = canvas_pts[i * 2], canvas_pts[i * 2 + 1]
                                            x2, y2 = canvas_pts[i * 2 + 2], canvas_pts[i * 2 + 3]
                                            center_x = x1 + t * (x2 - x1)
                                            center_y = y1 + t * (y2 - y1)
                                            break
                                        accumulated += seg_len
                                else:
                                    # Если линия нулевой длины, берем первую точку
                                    center_x = canvas_pts[0]
                                    center_y = canvas_pts[1]
                                
                                label_y = center_y - 5  # Offset 5px выше центра
                                
                                # 1. Создаём текст
                                label_item = canvas.create_text(
                                    center_x, label_y,
                                    text=label,
                                    fill=LABEL_STYLE["fill"],
                                    font=LABEL_STYLE["font"],
                                    tags="annotation"
                                )
                                # 2. Вычислить bbox текста
                                bbox = canvas.bbox(label_item)
                                if bbox:
                                    # 3. Создать прямоугольник-фон
                                    bg_rect = canvas.create_rectangle(
                                        bbox[0] - LABEL_STYLE["padding"], bbox[1] - LABEL_STYLE["padding"],
                                        bbox[2] + LABEL_STYLE["padding"], bbox[3] + LABEL_STYLE["padding"],
                                        fill=LABEL_STYLE["bg_fill"], outline=LABEL_STYLE["bg_outline"],
                                        tags="annotation"
                                    )
                                    # 4. Поднять текст наверх
                                    canvas.tag_raise(label_item)

        # Рисуем текущий полигон (если рисуется)
        if self.drawing and self.current_polygon:
            drawing_style = ANNOTATION_STYLES["drawing"]
            pts = []
            for j, p in enumerate(self.current_polygon):
                px = p[0] * scale + offset_x
                py = p[1] * scale + offset_y
                pts.extend([px, py])
            
            # Рисуем полигон пунктирной линией (оранжевый цвет для рисуемого) только если есть минимум 2 точки
            if len(pts) >= 4:
                canvas.create_polygon(
                    pts, fill=drawing_style.get("fill", ""), outline=drawing_style["outline"],
                    width=drawing_style["width"], dash=drawing_style.get("dash", ()),
                    tags="annotation"
                )
            
            # Рисуем точки (даже если есть только одна точка)
            p_style = POINT_STYLES["normal"]  # Для рисуемых точек используем normal стиль
            for j, p in enumerate(self.current_polygon):
                px = p[0] * scale + offset_x
                py = p[1] * scale + offset_y
                
                point_item = canvas.create_oval(
                    px - p_style["radius"], py - p_style["radius"],
                    px + p_style["radius"], py + p_style["radius"],
                    fill=drawing_style["outline"], outline=p_style["outline"],
                    width=p_style["outline_width"], tags="annotation"
                )
                # Поднимаем точку поверх линии
                canvas.tag_raise(point_item)
                
                # Рисуем номер точки
                number_text = str(j + 1)  # Номер начинается с 1
                number_item = canvas.create_text(
                    px, py,
                    text=number_text,
                    fill=p_style["outline"],  # Белый цвет для контраста
                    font=FONTS["point_number"],
                    tags="annotation"
                )
                # Поднимаем номер поверх точки
                canvas.tag_raise(number_item)
        
        # Рисуем текущий freehand (если рисуется)
        if self.drawing_freehand and self.freehand_points:
            drawing_style = ANNOTATION_STYLES["drawing"]
            if len(self.freehand_points) >= 2:
                canvas_pts = []
                for p in self.freehand_points:
                    px = p[0] * scale + offset_x
                    py = p[1] * scale + offset_y
                    canvas_pts.extend([px, py])
                
                # Рисуем как polyline (оранжевый пунктир)
                canvas.create_line(
                    canvas_pts, fill=drawing_style["outline"], width=drawing_style["width"],
                    dash=drawing_style.get("dash", ()), tags="annotation", smooth=False
                )
            
            # Рисуем только первую и последнюю точки
            p_style = POINT_STYLES["normal"]  # Для рисуемых точек используем normal стиль
            if len(self.freehand_points) >= 1:
                # Первая точка
                first_p = self.freehand_points[0]
                px = first_p[0] * scale + offset_x
                py = first_p[1] * scale + offset_y
                canvas.create_oval(
                    px - p_style["radius"], py - p_style["radius"],
                    px + p_style["radius"], py + p_style["radius"],
                    fill=drawing_style["outline"], outline=p_style["outline"],
                    width=p_style["outline_width"], tags="annotation"
                )
            
            if len(self.freehand_points) >= 2:
                # Последняя точка
                last_p = self.freehand_points[-1]
                px = last_p[0] * scale + offset_x
                py = last_p[1] * scale + offset_y
                canvas.create_oval(
                    px - p_style["radius"], py - p_style["radius"],
                    px + p_style["radius"], py + p_style["radius"],
                    fill=drawing_style["outline"], outline=p_style["outline"],
                    width=p_style["outline_width"], tags="annotation"
                )

    def to_dict(self):
        return {"annotations": deepcopy(self.annotations)}

    def load_from_dict(self, data):
        annotations_data = data.get("annotations", [])
        # Гарантируем, что annotations это список, а не None
        if annotations_data is None:
            annotations_data = []
        self.annotations = deepcopy(annotations_data)
        self.drawing = False
        self.current_polygon = []
        self.selected_annotation_index = None
        self.selected_point_index = None
        self.undo_stack.clear()
        self.redo_stack.clear()
        # Сбрасываем freehand состояние
        self.drawing_freehand = False
        self.freehand_points = []
        # Сбрасываем состояние перетаскивания (Фаза 2: пункт 1)
        self.dragging_point = False
        self.drag_start_pos = None
        self.drag_ann_index = None
        self.drag_point_index = None

    def listbox_items(self):
        return [f"{i+1}. {ann.get('label', '(без названия)')} ({ann.get('type')})" for i, ann in enumerate(self.annotations)]
