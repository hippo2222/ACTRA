import pytest

from task_system.models.test_task import TestTask


def test_testtask_validate_ok_single_choice():
    data = {
        "type": "test",
        "test_type": "single_choice",
        "questions": [
            {
                "id": 0,
                "text": "Q1",
                "answers": [
                    {"text": "A", "correct": True},
                    {"text": "B", "correct": False},
                ],
            }
        ],
        "settings": {"passing_score": 50},
    }
    t = TestTask(data)
    assert t.validate_test() == []


def test_testtask_validate_errors():
    data = {
        "type": "test",
        "test_type": "single_choice",
        "questions": [
            {"id": 0, "text": "", "answers": []},
        ],
        "settings": {},
    }
    t = TestTask(data)
    errs = t.validate_test()
    assert any("пустой текст вопроса" in e for e in errs)
    assert any("нет вариантов ответов" in e for e in errs)







































