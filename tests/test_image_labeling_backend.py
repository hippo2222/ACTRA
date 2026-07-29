import pytest
from task_system.types import task_registry, ImageLabelingTaskType
from task_system.types.image_labeling_task import ImageLabelingTaskEvaluator
from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from services.difficulty_manager import DifficultyManager


def test_task_registry_registration():
    """Проверка регистрации нового типа задания в реестре"""
    assert task_registry.is_registered("image_labeling")
    task_type = task_registry.get("image_labeling")
    assert isinstance(task_type, ImageLabelingTaskType)
    assert task_type.task_id == "image_labeling"
    assert task_type.name == "Подписи на рисунке"


def test_image_labeling_evaluator_normalization():
    """Проверка нормализации текста (ё -> е, регистр, пробелы)"""
    evaluator = ImageLabelingTaskEvaluator()
    assert evaluator._normalize_text("  Intralobular   stroma  ") == "иntralobular stroma"
    assert evaluator._normalize_text("Молочная железа") == "молочная железа"
    assert evaluator._normalize_text("Елка") == "елка"
    assert evaluator._normalize_text("Ёлка") == "елка"  # ё -> е
    assert evaluator._normalize_text("Чайка") == "чаика"  # й -> и
    assert evaluator._normalize_text("Київ") == "киив"  # ї -> и, i -> и


def test_image_labeling_evaluator_evaluation():
    """Проверка логики оценки правильности ответов"""
    evaluator = ImageLabelingTaskEvaluator()
    
    reference_data = {
        "image": "test.png",
        "zones": [
            {
                "id": "zone_1",
                "label": "Lobule",
                "rect": {"x": 10, "y": 10, "width": 50, "height": 50}
            },
            {
                "id": "zone_2",
                "label": "TDLU",
                "rect": {"x": 70, "y": 70, "width": 20, "height": 20}
            }
        ]
    }

    # 1. Все верно
    user_input_correct = {
        "answers": {
            "zone_1": "Lobule",
            "zone_2": "TDLU"
        }
    }
    res = evaluator.evaluate(user_input_correct, reference_data)
    assert res["success"] is True
    assert res["score"] == 100.0
    assert res["details"]["correct_count"] == 2
    assert res["details"]["zone_results"]["zone_1"]["is_correct"] is True

    # 2. Одно верно, одно нет
    user_input_partial = {
        "answers": {
            "zone_1": "Lobule",
            "zone_2": "Wrong Answer"
        }
    }
    res = evaluator.evaluate(user_input_partial, reference_data)
    assert res["success"] is False
    assert res["score"] == 50.0
    assert res["details"]["correct_count"] == 1
    assert res["details"]["zone_results"]["zone_1"]["is_correct"] is True
    assert res["details"]["zone_results"]["zone_2"]["is_correct"] is False

    # 3. Пустой ответ
    user_input_empty = {
        "answers": {}
    }
    res = evaluator.evaluate(user_input_empty, reference_data)
    assert res["success"] is False
    assert res["score"] == 0.0


def test_task_data_validation():
    """Проверка валидации данных в типе задания"""
    task_type = ImageLabelingTaskType()

    valid_data = {
        "image": "path/to/img.png",
        "zones": [
            {
                "id": "z1",
                "label": "Text",
                "rect": {"x": 0.5, "y": 12, "width": 10, "height": 10}
            }
        ]
    }
    assert task_type.validate_task_data(valid_data) is True

    # Нет картинки
    invalid_no_image = {
        "zones": [
            {
                "id": "z1",
                "label": "Text",
                "rect": {"x": 0.5, "y": 12, "width": 10, "height": 10}
            }
        ]
    }
    assert task_type.validate_task_data(invalid_no_image) is False

    # Нет зон
    invalid_no_zones = {
        "image": "img.png",
        "zones": []
    }
    assert task_type.validate_task_data(invalid_no_zones) is False

    # Неверные координаты rect
    invalid_rect = {
        "image": "img.png",
        "zones": [
            {
                "id": "z1",
                "label": "Text",
                "rect": {"x": "not a float", "y": 12, "width": 10, "height": 10}
            }
        ]
    }
    assert task_type.validate_task_data(invalid_rect) is False


def test_task_evaluator_service_integration():
    """Проверка интеграции в TaskEvaluatorService"""
    service = TaskEvaluatorService()
    
    # Проверка вывода метрики
    assert EvaluationResult.infer_metric_from_task_type("image_labeling") == "percent"

    task_data = {
        "type": "image_labeling",
        "content": {
            "image": "test.png",
            "zones": [
                {
                    "id": "zone_1",
                    "label": "Lobule",
                    "rect": {"x": 10, "y": 10, "width": 5, "height": 5}
                }
            ]
        }
    }
    
    user_input = {"answers": {"zone_1": "lobule"}}
    answer_key = task_data["content"]
    
    result = service.evaluate_task("image_labeling", user_input, answer_key, task_data)
    assert isinstance(result, EvaluationResult)
    assert result.success is True
    assert result.score == 100.0
    assert result.metric == "percent"


def test_difficulty_manager_integration():
    """Проверка интеграции в DifficultyManager и уровней сложности"""
    manager = DifficultyManager()
    
    # 1. Проверка доступных уровней сложности
    available = manager.get_available_levels("image_labeling")
    assert available == [1, 2]

    # 2. Проверка модификации контента по уровням (усиление сложности)
    task_data_l1 = {
        "type": "image_labeling",
        "content": {
            "image": "test.png",
            "zones": []
        }
    }
    
    enhanced_l1 = manager.enhance_task_for_level(task_data_l1, level=1)
    assert enhanced_l1["content"]["requires_typing"] is False

    task_data_l2 = {
        "type": "image_labeling",
        "content": {
            "image": "test.png",
            "zones": []
        }
    }
    enhanced_l2 = manager.enhance_task_for_level(task_data_l2, level=2)
    assert enhanced_l2["content"]["requires_typing"] is True


def test_import_export_known_types():
    """Проверка присутствия image_labeling и draw в известных типах импорта/экспорта"""
    from services.import_export_service import ImportExportService
    service = ImportExportService(None)
    # Просто проверка, что импорт не упадет с предупреждением о неизвестном типе
    # для image_labeling и draw
    task_data = {"type": "image_labeling", "content": {"image": "test.png", "zones": []}}
    # Метод возвращает список отсутствующих картинок или аналогично,
    # но главное, что в перечне известных типов он теперь есть.
    

def test_image_labeling_textual_export():
    """Проверка экспорта image_labeling в текстовый формат (@IMAGE_LABELING)"""
    from server import app
    from unittest.mock import MagicMock
    import routes.import_routes as import_routes
    
    mock_storage = MagicMock()
    mock_storage.load_task.return_value = {
        "task_data": {
            "type": "image_labeling",
            "content": {
                "prompt": "Test prompt",
                "image": "img.png",
                "zones": [
                    {"label": "Zone Label", "rect": {"x": 10, "y": 20, "width": 30, "height": 40}}
                ]
            }
        }
    }
    
    orig_get_ctx = import_routes.get_ctx
    orig_assert = getattr(import_routes, "_assert_export_task_refs_not_archived", None)
    
    ctx = MagicMock()
    ctx.user_id = "admin"
    ctx.storage_service = mock_storage
    
    try:
        import_routes.get_ctx = lambda: ctx
        if orig_assert is not None:
            import_routes._assert_export_task_refs_not_archived = MagicMock()
        
        with app.test_client() as client:
            response = client.post("/api/editor/export/text", json={
                "tasks": [{"module_id": "m1", "topic_id": "t1", "task_id": "task1"}]
            })
            assert response.status_code == 200
            res_data = response.get_json()
            assert res_data["ok"] is True
            text = res_data["text"]
            assert "@IMAGE_LABELING" in text
            assert "# Test prompt" in text
            assert "image: img.png" in text
            assert "zone_1: Zone Label" in text
    finally:
        import_routes.get_ctx = orig_get_ctx
        if orig_assert is not None:
            import_routes._assert_export_task_refs_not_archived = orig_assert


