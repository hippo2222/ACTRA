import pytest
from task_system.core.schemas.complex_schema import ComplexSchema
from task_system.core.models.complex_models import Complex, ComplexSettings
from task_system.core.exceptions import TaskValidationError

def test_complex_schema_valid():
    data = {
        "id": "complex_1",
        "name": "Test Complex",
        "tasks": ["module1/topic1/task1", "module1/topic1/task2"],
        "settings": {
            "adaptive_difficulty": True
        }
    }
    errors = ComplexSchema.validate(data)
    assert len(errors) == 0

def test_complex_schema_invalid():
    data = {
        "name": "Test Complex"
        # Missing id and tasks
    }
    errors = ComplexSchema.validate(data)
    assert len(errors) > 0
    assert "Отсутствует обязательное поле: id" in errors
    assert "Отсутствует обязательное поле: tasks" in errors

def test_complex_schema_invalid_types():
    data = {
        "id": 123, # Should be str
        "name": "Test",
        "tasks": "not a list" # Should be list
    }
    errors = ComplexSchema.validate(data)
    assert "Поле 'id' должно быть строкой" in errors
    assert "Поле 'tasks' должно быть списком" in errors

def test_complex_model_creation():
    complex_data = {
        "id": "complex_1",
        "name": "Test Complex",
        "tasks": ["t1", "t2"]
    }
    complex_obj = Complex(**complex_data)
    assert complex_obj.id == "complex_1"
    assert complex_obj.name == "Test Complex"
    assert len(complex_obj.tasks) == 2
    assert complex_obj.settings.adaptive_difficulty is True # Default value

def test_complex_model_settings():
    complex_data = {
        "id": "complex_1",
        "name": "Test Complex",
        "tasks": ["t1"],
        "settings": {
            "adaptive_difficulty": False,
            "escalation_on_success": False
        }
    }
    complex_obj = Complex(**complex_data)
    assert complex_obj.settings.adaptive_difficulty is False
    assert complex_obj.settings.escalation_on_success is False
