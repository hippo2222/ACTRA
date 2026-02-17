# tests/test_annotation_manager.py
"""
Тесты для AnnotationManager.
"""

import sys
import os

# Добавляем путь к корню проекта
project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

try:
    from task_system.core.logic.annotation_manager import AnnotationManager
except ImportError as e:
    print(f"Ошибка импорта: {e}")
    print(f"Путь поиска: {project_root}")
    print(f"sys.path: {sys.path[:3]}")
    raise


def test_add_point():
    """Тест добавления точки."""
    manager = AnnotationManager()
    
    # Добавляем точку
    manager.add_point(100, 200, "Тестовая точка")
    
    assert len(manager.annotations) == 1
    ann = manager.annotations[0]
    assert ann['type'] == 'point'
    assert ann['x'] == 100
    assert ann['y'] == 200
    assert ann['label'] == 'Тестовая точка'
    print("[OK] test_add_point passed")


def test_add_point_without_label():
    """Тест добавления точки без метки."""
    manager = AnnotationManager()
    
    # Добавляем точку без метки
    manager.add_point(50, 75)
    
    assert len(manager.annotations) == 1
    ann = manager.annotations[0]
    assert ann['label'] == ''
    print("[OK] test_add_point_without_label passed")


def test_start_polygon():
    """Тест начала рисования полигона."""
    manager = AnnotationManager()
    
    # Начинаем полигон с координатами
    manager.start_polygon(10, 20)
    
    assert manager.drawing == True
    assert len(manager.current_polygon) == 1
    assert manager.current_polygon[0] == (10.0, 20.0)
    print("[OK] test_start_polygon passed")


def test_start_polygon_without_coords():
    """Тест начала полигона без координат."""
    manager = AnnotationManager()
    
    # Начинаем полигон без координат
    manager.start_polygon()
    
    assert manager.drawing == True
    assert len(manager.current_polygon) == 0
    print("[OK] test_start_polygon_without_coords passed")


def test_add_polygon_points():
    """Тест добавления точек к полигону."""
    manager = AnnotationManager()
    
    manager.start_polygon(10, 20)
    manager.add_polygon_point(30, 40)
    manager.add_polygon_point(50, 60)
    
    assert len(manager.current_polygon) == 3
    assert manager.current_polygon[1] == (30.0, 40.0)
    assert manager.current_polygon[2] == (50.0, 60.0)
    print("[OK] test_add_polygon_points passed")


def test_finish_polygon():
    """Тест завершения полигона."""
    manager = AnnotationManager()
    
    # Создаем полигон с 3 точками
    manager.start_polygon(10, 20)
    manager.add_polygon_point(30, 40)
    manager.add_polygon_point(50, 60)
    
    # Завершаем
    result = manager.finish_polygon("Тестовый полигон")
    
    assert result == True
    assert manager.drawing == False
    assert len(manager.current_polygon) == 0
    assert len(manager.annotations) == 1
    
    ann = manager.annotations[0]
    assert ann['type'] == 'polygon'
    assert ann['label'] == 'Тестовый полигон'
    assert len(ann['points']) == 3
    print("[OK] test_finish_polygon passed")


def test_finish_polygon_insufficient_points():
    """Тест завершения полигона с недостаточным количеством точек."""
    manager = AnnotationManager()
    
    # Создаем полигон с 2 точками (недостаточно)
    manager.start_polygon(10, 20)
    manager.add_polygon_point(30, 40)
    
    # Пытаемся завершить
    result = manager.finish_polygon("Неполный полигон")
    
    assert result == False
    assert manager.drawing == False
    assert len(manager.annotations) == 0
    print("[OK] test_finish_polygon_insufficient_points passed")


def test_undo_add_point():
    """Тест отмены добавления точки."""
    manager = AnnotationManager()
    
    manager.add_point(100, 200, "Точка 1")
    manager.add_point(150, 250, "Точка 2")
    
    assert len(manager.annotations) == 2
    
    # Отменяем последнее добавление
    manager.undo()
    
    assert len(manager.annotations) == 1
    assert manager.annotations[0]['label'] == 'Точка 1'
    print("[OK] test_undo_add_point passed")


def test_redo_add_point():
    """Тест повтора добавления точки."""
    manager = AnnotationManager()
    
    manager.add_point(100, 200, "Точка 1")
    manager.undo()
    
    assert len(manager.annotations) == 0
    
    # Повторяем
    manager.redo()
    
    assert len(manager.annotations) == 1
    assert manager.annotations[0]['label'] == 'Точка 1'
    print("[OK] test_redo_add_point passed")


def test_delete_annotation():
    """Тест удаления аннотации."""
    manager = AnnotationManager()
    
    manager.add_point(100, 200, "Точка 1")
    manager.add_point(150, 250, "Точка 2")
    
    # Удаляем первую аннотацию
    manager.delete_annotation(0)
    
    assert len(manager.annotations) == 1
    assert manager.annotations[0]['label'] == 'Точка 2'
    print("[OK] test_delete_annotation passed")


def test_to_dict():
    """Тест сериализации в словарь."""
    manager = AnnotationManager()
    
    manager.add_point(100, 200, "Точка")
    
    data = manager.to_dict()
    
    assert 'annotations' in data
    assert len(data['annotations']) == 1
    assert data['annotations'][0]['type'] == 'point'
    print("[OK] test_to_dict passed")


def test_load_from_dict():
    """Тест загрузки из словаря."""
    manager = AnnotationManager()
    
    data = {
        'annotations': [
            {'type': 'point', 'label': 'Точка 1', 'x': 100, 'y': 200},
            {'type': 'point', 'label': 'Точка 2', 'x': 150, 'y': 250}
        ]
    }
    
    manager.load_from_dict(data)
    
    assert len(manager.annotations) == 2
    assert manager.annotations[0]['label'] == 'Точка 1'
    assert manager.annotations[1]['label'] == 'Точка 2'
    print("[OK] test_load_from_dict passed")


def test_select_annotation_at():
    """Тест выбора аннотации по клику."""
    manager = AnnotationManager()
    
    # Добавляем несколько аннотаций
    manager.add_point(100, 200, "Точка 1")
    manager.add_point(300, 400, "Точка 2")
    
    # Создаем полигон
    manager.start_polygon(50, 50)
    manager.add_polygon_point(150, 50)
    manager.add_polygon_point(150, 150)
    manager.add_polygon_point(50, 150)
    manager.finish_polygon("Полигон 1")
    
    # Тест 1: Выбор точки-аннотации
    result = manager.select_annotation_at(100, 200, threshold=10)
    assert result == (0, None)
    assert manager.selected_annotation_index == 0
    assert manager.selected_point_index is None
    
    # Тест 2: Выбор другой точки
    result = manager.select_annotation_at(300, 400, threshold=10)
    assert result == (1, None)
    assert manager.selected_annotation_index == 1
    
    # Тест 3: Выбор точки полигона (приоритет над выбором внутри полигона)
    result = manager.select_annotation_at(50, 50, threshold=10)
    assert result == (2, 0)  # Индекс аннотации 2, индекс точки 0
    assert manager.selected_annotation_index == 2
    assert manager.selected_point_index == 0
    
    # Тест 4: Выбор внутри полигона (не на точку)
    result = manager.select_annotation_at(100, 100, threshold=10)
    assert result == (2, None)  # Выбрана аннотация, но не конкретная точка
    assert manager.selected_annotation_index == 2
    assert manager.selected_point_index is None
    
    # Тест 5: Клик вне всех аннотаций
    result = manager.select_annotation_at(500, 500, threshold=10)
    assert result is None
    assert manager.selected_annotation_index is None
    
    print("[OK] test_select_annotation_at passed")


def test_point_in_polygon():
    """Тест проверки точки внутри полигона (геометрия)."""
    manager = AnnotationManager()
    
    # Создаем простой квадратный полигон
    square_points = [(0, 0), (100, 0), (100, 100), (0, 100)]
    
    # Точка внутри полигона
    assert manager._point_in_polygon(50, 50, square_points) == True
    
    # Точка снаружи полигона
    assert manager._point_in_polygon(150, 50, square_points) == False
    assert manager._point_in_polygon(50, 150, square_points) == False
    assert manager._point_in_polygon(-10, 50, square_points) == False
    
    # Точка на границе (может быть True или False в зависимости от алгоритма)
    # Обычно ray casting считает границу как "внутри"
    result_on_edge = manager._point_in_polygon(0, 50, square_points)
    assert result_on_edge in [True, False]  # Принимаем оба варианта
    
    # Создаем более сложный полигон (треугольник)
    triangle_points = [(0, 0), (100, 0), (50, 100)]
    
    # Точка внутри треугольника
    assert manager._point_in_polygon(50, 30, triangle_points) == True
    
    # Точка снаружи треугольника
    assert manager._point_in_polygon(10, 80, triangle_points) == False
    assert manager._point_in_polygon(90, 80, triangle_points) == False
    
    # Полигон с менее чем 3 точками должен возвращать False
    assert manager._point_in_polygon(50, 50, [(0, 0), (100, 0)]) == False
    assert manager._point_in_polygon(50, 50, []) == False
    
    print("[OK] test_point_in_polygon passed")


def test_rdp_simplify():
    """Тест упрощения линий через алгоритм Ramer-Douglas-Peucker."""
    manager = AnnotationManager()
    
    # Тест 1: Простая линия (должна остаться без изменений при малом epsilon)
    simple_line = [(0, 0), (100, 0)]
    result = manager.rdp_simplify(simple_line, epsilon=1.0)
    assert len(result) == 2
    assert result == simple_line
    
    # Тест 2: Линия с избыточными точками (должна упроститься)
    redundant_line = [
        (0, 0),
        (10, 1),   # Почти на прямой
        (20, 2),   # Почти на прямой
        (30, 3),   # Почти на прямой
        (100, 0)
    ]
    result = manager.rdp_simplify(redundant_line, epsilon=5.0)
    # Должна остаться только начальная и конечная точки
    assert len(result) == 2
    assert result[0] == (0, 0)
    assert result[1] == (100, 0)
    
    # Тест 3: Линия с важными точками (не должна упроститься слишком сильно)
    important_line = [
        (0, 0),
        (50, 50),   # Важная точка (отклонение от прямой)
        (100, 0)
    ]
    result = manager.rdp_simplify(important_line, epsilon=1.0)
    # При малом epsilon все точки должны остаться
    assert len(result) == 3
    
    # Тест 4: Линия с менее чем 3 точками (должна вернуться без изменений)
    short_line = [(0, 0), (10, 10)]
    result = manager.rdp_simplify(short_line, epsilon=1.0)
    assert result == short_line
    
    single_point = [(0, 0)]
    result = manager.rdp_simplify(single_point, epsilon=1.0)
    assert result == single_point
    
    # Тест 5: Более сложная линия с изгибом
    curved_line = [
        (0, 0),
        (25, 5),
        (50, 20),   # Значительное отклонение
        (75, 5),
        (100, 0)
    ]
    result = manager.rdp_simplify(curved_line, epsilon=10.0)
    # Должна остаться начальная, средняя (с отклонением) и конечная
    assert len(result) >= 3
    assert result[0] == (0, 0)
    assert result[-1] == (100, 0)
    # Средняя точка с отклонением должна остаться
    assert (50, 20) in result
    
    print("[OK] test_rdp_simplify passed")


def test_drag_point():
    """Тест перетаскивания точки с undo."""
    manager = AnnotationManager()
    
    # Тест 1: Перетаскивание точки-аннотации
    manager.add_point(100, 200, "Точка")
    assert manager.annotations[0]['x'] == 100
    assert manager.annotations[0]['y'] == 200
    
    # Начинаем перетаскивание
    manager.start_drag_point(0, None, 100, 200)
    assert manager.dragging_point == True
    assert manager.drag_ann_index == 0
    assert manager.drag_point_index is None
    
    # Обновляем позицию
    manager.update_drag_point(150, 250)
    assert manager.annotations[0]['x'] == 150
    assert manager.annotations[0]['y'] == 250
    
    # Завершаем перетаскивание
    result = manager.finish_drag_point()
    assert result == True
    assert manager.dragging_point == False
    assert manager.annotations[0]['x'] == 150
    assert manager.annotations[0]['y'] == 250
    
    # Проверяем, что операция добавлена в undo
    assert len(manager.undo_stack) == 2  # add_point + modify_point
    undo_op = manager.undo_stack[-1]
    assert undo_op['op'] == 'modify_point'
    assert undo_op['old_position'] == (100, 200)
    assert undo_op['new_position'] == (150, 250)
    
    # Тест 2: Undo перетаскивания
    manager.undo()
    assert manager.annotations[0]['x'] == 100
    assert manager.annotations[0]['y'] == 200
    
    # Тест 3: Redo перетаскивания
    manager.redo()
    assert manager.annotations[0]['x'] == 150
    assert manager.annotations[0]['y'] == 250
    
    # Тест 4: Перетаскивание точки полигона
    manager.start_polygon(10, 10)
    manager.add_polygon_point(50, 10)
    manager.add_polygon_point(50, 50)
    manager.add_polygon_point(10, 50)
    manager.finish_polygon("Полигон")
    
    polygon_ann_index = 1  # Индекс полигона (после точки)
    
    # Начинаем перетаскивание первой точки полигона
    manager.start_drag_point(polygon_ann_index, 0, 10, 10)
    assert manager.dragging_point == True
    assert manager.drag_ann_index == polygon_ann_index
    assert manager.drag_point_index == 0
    
    # Обновляем позицию
    manager.update_drag_point(20, 20)
    points = manager.annotations[polygon_ann_index]['points']
    assert points[0] == (20.0, 20.0)
    
    # Завершаем перетаскивание
    result = manager.finish_drag_point()
    assert result == True
    assert manager.dragging_point == False
    
    # Проверяем undo
    undo_op = manager.undo_stack[-1]
    assert undo_op['op'] == 'modify_point'
    assert undo_op['annotation_index'] == polygon_ann_index
    assert undo_op['point_index'] == 0
    assert undo_op['old_position'] == (10.0, 10.0)
    assert undo_op['new_position'] == (20.0, 20.0)
    
    # Undo перетаскивания точки полигона
    manager.undo()
    points = manager.annotations[polygon_ann_index]['points']
    assert points[0] == (10.0, 10.0)
    
    # Тест 5: Перетаскивание без изменения позиции (не должно создавать undo)
    manager.start_drag_point(polygon_ann_index, 0, 10, 10)
    manager.update_drag_point(10, 10)  # Та же позиция
    result = manager.finish_drag_point()
    assert result == False  # Не создана операция undo, так как позиция не изменилась
    
    print("[OK] test_drag_point passed")


def test_integration_create_select_edit_save_load():
    """
    Интеграционный тест: Создание → Выбор → Редактирование → Сохранение → Загрузка.
    
    Проверяет полный цикл работы с аннотациями:
    1. Создание аннотаций (точка и полигон)
    2. Выбор аннотации
    3. Редактирование (перетаскивание точки)
    4. Сохранение в словарь
    5. Загрузка из словаря
    6. Проверка целостности данных
    """
    manager = AnnotationManager()
    
    # Шаг 1: Создание аннотаций
    manager.add_point(100, 200, "Точка 1")
    manager.add_point(300, 400, "Точка 2")
    
    manager.start_polygon(50, 50)
    manager.add_polygon_point(150, 50)
    manager.add_polygon_point(150, 150)
    manager.add_polygon_point(50, 150)
    manager.finish_polygon("Полигон 1")
    
    # Проверяем, что созданы 3 аннотации
    assert len(manager.annotations) == 3
    assert manager.annotations[0]['type'] == 'point'
    assert manager.annotations[0]['label'] == 'Точка 1'
    assert manager.annotations[2]['type'] == 'polygon'
    assert manager.annotations[2]['label'] == 'Полигон 1'
    
    # Шаг 2: Выбор аннотации
    result = manager.select_annotation_at(100, 200, threshold=10)
    assert result == (0, None)
    assert manager.selected_annotation_index == 0
    assert manager.is_selected(0) == True
    
    # Выбираем полигон
    result = manager.select_annotation_at(100, 100, threshold=10)
    assert result == (2, None)
    assert manager.selected_annotation_index == 2
    
    # Шаг 3: Редактирование (перетаскивание точки полигона)
    # Выбираем точку полигона
    result = manager.select_annotation_at(50, 50, threshold=10)
    assert result == (2, 0)  # Полигон 2, точка 0
    
    # Начинаем перетаскивание
    manager.start_drag_point(2, 0, 50, 50)
    assert manager.dragging_point == True
    
    # Обновляем позицию
    manager.update_drag_point(60, 60)
    points = manager.annotations[2]['points']
    assert points[0] == (60.0, 60.0)
    
    # Завершаем перетаскивание
    manager.finish_drag_point()
    assert manager.dragging_point == False
    assert points[0] == (60.0, 60.0)
    
    # Шаг 4: Сохранение в словарь
    saved_data = manager.to_dict()
    assert 'annotations' in saved_data
    assert len(saved_data['annotations']) == 3
    
    # Проверяем, что данные сохранены правильно
    saved_point = saved_data['annotations'][0]
    assert saved_point['type'] == 'point'
    assert saved_point['x'] == 100
    assert saved_point['y'] == 200
    assert saved_point['label'] == 'Точка 1'
    
    saved_polygon = saved_data['annotations'][2]
    assert saved_polygon['type'] == 'polygon'
    assert saved_polygon['label'] == 'Полигон 1'
    assert len(saved_polygon['points']) == 4
    assert saved_polygon['points'][0] == (60.0, 60.0)  # Отредактированная точка
    
    # Шаг 5: Загрузка из словаря в новый менеджер
    new_manager = AnnotationManager()
    new_manager.load_from_dict(saved_data)
    
    # Проверяем целостность данных
    assert len(new_manager.annotations) == 3
    assert new_manager.annotations[0]['type'] == 'point'
    assert new_manager.annotations[0]['x'] == 100
    assert new_manager.annotations[0]['y'] == 200
    assert new_manager.annotations[0]['label'] == 'Точка 1'
    
    assert new_manager.annotations[2]['type'] == 'polygon'
    assert new_manager.annotations[2]['label'] == 'Полигон 1'
    assert len(new_manager.annotations[2]['points']) == 4
    assert new_manager.annotations[2]['points'][0] == (60.0, 60.0)  # Отредактированная точка сохранена
    
    # Проверяем, что состояние сброшено после загрузки
    assert new_manager.selected_annotation_index is None
    assert new_manager.drawing == False
    assert new_manager.dragging_point == False
    
    print("[OK] test_integration_create_select_edit_save_load passed")


def test_integration_freehand_simplify_save_load():
    """
    Интеграционный тест: Freehand → Упрощение → Сохранение → Загрузка.
    
    Проверяет полный цикл работы с freehand аннотациями:
    1. Создание freehand линии с множеством точек
    2. Упрощение через RDP алгоритм
    3. Сохранение в словарь
    4. Загрузка из словаря
    5. Проверка, что упрощение сохранилось
    """
    manager = AnnotationManager()
    
    # Шаг 1: Создание freehand линии с множеством точек
    # Создаем линию с избыточными точками (почти прямая)
    manager.start_freehand(0, 0)
    
    # Добавляем много точек, которые почти на прямой линии
    for i in range(1, 20):
        x = i * 5
        y = i * 0.1  # Почти прямая линия
        manager.add_freehand_point(x, y)
    
    # Добавляем точку с отклонением
    manager.add_freehand_point(50, 20)  # Значительное отклонение
    
    # Завершаем с упрощением
    result = manager.finish_freehand(label="Freehand линия", simplify=True)
    assert result == True
    assert len(manager.annotations) == 1
    
    freehand_ann = manager.annotations[0]
    assert freehand_ann['type'] == 'freehand'
    assert freehand_ann['label'] == 'Freehand линия'
    assert freehand_ann['smoothed'] == True
    
    # Проверяем, что линия была упрощена (должно быть меньше точек, чем было добавлено)
    simplified_points = freehand_ann['points']
    assert len(simplified_points) < 20  # Упрощение должно уменьшить количество точек
    assert len(simplified_points) >= 2  # Но должно остаться минимум 2 точки
    
    # Проверяем, что начальная и конечная точки сохранены
    assert simplified_points[0] == (0.0, 0.0)
    # Конечная точка должна быть близка к последней добавленной
    last_point = simplified_points[-1]
    assert abs(last_point[0] - 50) < 1.0  # Допускаем небольшую погрешность
    assert abs(last_point[1] - 20) < 1.0
    
    # Шаг 2: Сохранение в словарь
    saved_data = manager.to_dict()
    assert 'annotations' in saved_data
    assert len(saved_data['annotations']) == 1
    
    saved_freehand = saved_data['annotations'][0]
    assert saved_freehand['type'] == 'freehand'
    assert saved_freehand['smoothed'] == True
    assert len(saved_freehand['points']) == len(simplified_points)
    
    # Шаг 3: Загрузка из словаря
    new_manager = AnnotationManager()
    new_manager.load_from_dict(saved_data)
    
    # Проверяем целостность данных
    assert len(new_manager.annotations) == 1
    loaded_freehand = new_manager.annotations[0]
    assert loaded_freehand['type'] == 'freehand'
    assert loaded_freehand['label'] == 'Freehand линия'
    assert loaded_freehand['smoothed'] == True
    assert len(loaded_freehand['points']) == len(simplified_points)
    
    # Проверяем, что точки совпадают
    for i, (original, loaded) in enumerate(zip(simplified_points, loaded_freehand['points'])):
        assert abs(original[0] - loaded[0]) < 0.001
        assert abs(original[1] - loaded[1]) < 0.001
    
    # Шаг 4: Проверяем, что freehand без упрощения тоже работает
    manager2 = AnnotationManager()
    manager2.start_freehand(0, 0)
    manager2.add_freehand_point(10, 10)
    manager2.add_freehand_point(20, 20)
    result = manager2.finish_freehand(label="Без упрощения", simplify=False)
    assert result == True
    
    freehand_no_simplify = manager2.annotations[0]
    assert freehand_no_simplify['smoothed'] == False
    assert len(freehand_no_simplify['points']) == 3  # Все точки должны остаться
    
    # Сохраняем и загружаем
    saved_data2 = manager2.to_dict()
    new_manager2 = AnnotationManager()
    new_manager2.load_from_dict(saved_data2)
    
    loaded_no_simplify = new_manager2.annotations[0]
    assert loaded_no_simplify['smoothed'] == False
    assert len(loaded_no_simplify['points']) == 3
    
    print("[OK] test_integration_freehand_simplify_save_load passed")


def test_integration_multiple_annotations_delete_undo_redo():
    """
    Интеграционный тест: Множественные аннотации → Удаление → Undo → Redo.
    
    Проверяет работу с множественными аннотациями и операциями undo/redo:
    1. Создание множественных аннотаций разных типов
    2. Удаление выбранной аннотации
    3. Undo удаления
    4. Redo удаления
    5. Множественные операции undo/redo
    """
    manager = AnnotationManager()
    
    # Шаг 1: Создание множественных аннотаций
    manager.add_point(100, 200, "Точка 1")
    manager.add_point(300, 400, "Точка 2")
    
    manager.start_polygon(50, 50)
    manager.add_polygon_point(150, 50)
    manager.add_polygon_point(150, 150)
    manager.add_polygon_point(50, 150)
    manager.finish_polygon("Полигон 1")
    
    manager.start_freehand(200, 200)
    manager.add_freehand_point(250, 250)
    manager.add_freehand_point(300, 300)
    manager.finish_freehand("Freehand 1")
    
    manager.add_point(400, 500, "Точка 3")
    
    # Проверяем, что созданы 5 аннотаций
    assert len(manager.annotations) == 5
    assert manager.annotations[0]['type'] == 'point'
    assert manager.annotations[2]['type'] == 'polygon'
    assert manager.annotations[3]['type'] == 'freehand'
    assert manager.annotations[4]['type'] == 'point'
    
    # Шаг 2: Удаление выбранной аннотации
    # Выбираем полигон (индекс 2)
    manager.select_annotation_at(100, 100, threshold=10)
    assert manager.selected_annotation_index == 2
    
    # Удаляем выбранную аннотацию
    result = manager.delete_selected()
    assert result == True
    assert len(manager.annotations) == 4
    assert manager.annotations[2]['type'] == 'freehand'  # Индексы сдвинулись
    assert manager.selected_annotation_index is None  # Выбор сброшен
    
    # Проверяем, что операция добавлена в undo
    # Создано 5 аннотаций (2 точки + 1 полигон + 1 freehand + 1 точка) = 5 операций add
    # + 1 операция delete = 6 операций всего
    assert len(manager.undo_stack) == 6  # 5 add + 1 delete
    undo_op = manager.undo_stack[-1]
    assert undo_op['op'] == 'delete_annotation'
    assert undo_op['annotation_index'] == 2
    assert undo_op['annotation']['type'] == 'polygon'
    assert undo_op['annotation']['label'] == 'Полигон 1'
    
    # Шаг 3: Undo удаления
    manager.undo()
    assert len(manager.annotations) == 5
    # Проверяем, что полигон восстановлен на правильной позиции
    assert manager.annotations[2]['type'] == 'polygon'
    assert manager.annotations[2]['label'] == 'Полигон 1'
    assert manager.annotations[3]['type'] == 'freehand'
    
    # Шаг 4: Redo удаления
    manager.redo()
    assert len(manager.annotations) == 4
    assert manager.annotations[2]['type'] == 'freehand'
    
    # Шаг 5: Множественные операции
    # Удаляем еще одну аннотацию (точку)
    manager.select_annotation_at(100, 200, threshold=10)
    assert manager.selected_annotation_index == 0
    manager.delete_selected()
    assert len(manager.annotations) == 3
    
    # Undo последнего удаления
    manager.undo()
    assert len(manager.annotations) == 4
    
    # Undo первого удаления (полигона)
    manager.undo()
    assert len(manager.annotations) == 5
    
    # Redo первого удаления
    manager.redo()
    assert len(manager.annotations) == 4
    
    # Redo второго удаления
    manager.redo()
    assert len(manager.annotations) == 3
    
    # Шаг 6: Проверяем clear_all с undo/redo
    initial_count = len(manager.annotations)
    manager.clear_all()
    assert len(manager.annotations) == 0
    
    # Undo clear_all
    manager.undo()
    assert len(manager.annotations) == initial_count
    
    # Redo clear_all
    manager.redo()
    assert len(manager.annotations) == 0
    
    print("[OK] test_integration_multiple_annotations_delete_undo_redo passed")


def run_all_tests():
    """Запускает все тесты."""
    print("\n" + "="*60)
    print("Запуск тестов AnnotationManager")
    print("="*60 + "\n")
    
    tests = [
        test_add_point,
        test_add_point_without_label,
        test_start_polygon,
        test_start_polygon_without_coords,
        test_add_polygon_points,
        test_finish_polygon,
        test_finish_polygon_insufficient_points,
        test_undo_add_point,
        test_redo_add_point,
        test_delete_annotation,
        test_to_dict,
        test_load_from_dict,
        # Фаза 10.1: Unit тесты
        test_select_annotation_at,
        test_point_in_polygon,
        test_rdp_simplify,
        test_drag_point,
        # Фаза 10.2: Интеграционные тесты
        test_integration_create_select_edit_save_load,
        test_integration_freehand_simplify_save_load,
        test_integration_multiple_annotations_delete_undo_redo,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"[FAIL] {test.__name__} failed: {e}")
            failed += 1
        except Exception as e:
            print(f"[ERROR] {test.__name__} error: {e}")
            failed += 1
    
    print("\n" + "="*60)
    print(f"Результаты: {passed} passed, {failed} failed")
    print("="*60 + "\n")
    
    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)
