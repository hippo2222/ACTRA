"""
Unit тесты на контракт TaskEvaluatorService для заданий типа DRAWING.

Проверяет:
1. details["found_targets"] — список индексов эталонных целей, которые пользователь успешно обвел/провел.
2. details["unmatched_actions"] — лишние действия пользователя (полигоны/линии), не совпавшие ни с одной целью.
3. details["message_key"] и details["message_params"] — декуплированная локализация (Rule 6 AGENTS.md).
4. details["polygon_results"] и details["line_results"] — детальные результаты по каждому действию.
"""

import pytest
from .helpers import load_task_evaluator_service


TaskEvaluatorService = load_task_evaluator_service()


class TestDrawEvaluatorContract:
    @pytest.fixture
    def evaluator(self):
        return TaskEvaluatorService()

    def test_single_polygon_found(self, evaluator):
        """Успешное обведение одного полигона."""
        task_data = {
            "type": "draw",
            "content": {
                "prompt": "Обведите очаг",
                "settings": {"coverage_threshold": 70},
            },
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                }
            ]
        }
        user_input = {
            "polygons": [
                {
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                }
            ],
            "lines": [],
        }

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.success is True
        assert result.score > 70.0
        assert result.details["found_targets"] == [0]
        assert result.details["unmatched_actions"] == []
        assert result.details["message_key"] == "draw_control_success"
        assert result.details["message_params"]["successes"] == 1
        assert result.details["message_params"]["total_targets"] == 1
        assert len(result.details["polygon_results"]) == 1
        assert result.details["polygon_results"][0]["polygon_success"] is True
        assert result.details["polygon_results"][0]["target_index"] == 0

    def test_unmatched_extra_polygon(self, evaluator):
        """Пользователь обвел целевой полигон и нарисовал лишний сторонний полигон."""
        task_data = {
            "type": "draw",
            "content": {
                "prompt": "Обведите очаг",
                "settings": {"coverage_threshold": 70},
            },
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                }
            ]
        }
        user_input = {
            "polygons": [
                # Правильный полигон
                {
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                },
                # Лишний сторонний полигон далеко от цели
                {
                    "points": [[300, 300], [350, 300], [350, 350], [300, 350]],
                    "label": "Случайный контур",
                },
            ],
            "lines": [],
        }

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.details["found_targets"] == [0]
        assert len(result.details["unmatched_actions"]) == 1
        extra = result.details["unmatched_actions"][0]
        assert extra["kind"] == "polygon"
        assert extra["type"] == "polygon"
        assert extra["off_target"] is True
        assert extra["duplicate"] is False
        assert extra["index"] == 1
        assert extra["key"] == "polygon:1"

    def test_lines_and_polygons_combined(self, evaluator):
        """Задание с полигоном и контрольной линией."""
        task_data = {
            "type": "draw",
            "content": {
                "prompt": "Обведите контур и проведите ось",
                "settings": {"coverage_threshold": 70},
            },
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Контур",
                },
                {
                    "shape": "line",
                    "points": [[10, 10], [50, 50]],
                    "label": "Ось",
                },
            ]
        }
        user_input = {
            "polygons": [
                {
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Контур",
                }
            ],
            "lines": [
                {
                    "points": [[10, 10], [50, 50]],
                    "label": "Ось",
                }
            ],
        }

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.success is True
        assert result.details["found_targets"] == [0, 1]
        assert result.details["unmatched_actions"] == []
        assert result.details["message_key"] == "draw_control_success"
        assert len(result.details["polygon_results"]) == 1
        assert len(result.details["line_results"]) == 1

    def test_unmatched_extra_line(self, evaluator):
        """Лишняя линия регистрируется в unmatched_actions."""
        task_data = {
            "type": "draw",
            "content": {
                "prompt": "Обведите контур",
                "settings": {"coverage_threshold": 70},
            },
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Контур",
                }
            ]
        }
        user_input = {
            "polygons": [
                {
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Контур",
                }
            ],
            "lines": [
                {
                    "points": [[200, 200], [250, 250]],
                    "label": "Лишняя линия",
                }
            ],
        }

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.details["found_targets"] == [0]
        assert len(result.details["unmatched_actions"]) == 1
        extra_line = result.details["unmatched_actions"][0]
        assert extra_line["kind"] == "line"
        assert extra_line["type"] == "line"
        assert extra_line["off_target"] is True
        assert extra_line["index"] == 0
        assert extra_line["key"] == "line:0"

    def test_no_drawings_submitted(self, evaluator):
        """Пользователь нажал 'Проверить' ничего не нарисовав."""
        task_data = {
            "type": "draw",
            "content": {"prompt": "Обведите очаг"},
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг",
                }
            ]
        }
        user_input = {"polygons": [], "lines": []}

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.success is False
        assert result.details["found_targets"] == []
        assert result.details["unmatched_actions"] == []
        assert result.details["message_key"] == "draw_no_polygons"

    def test_no_reference_targets(self, evaluator):
        """В эталоне нет целей."""
        task_data = {
            "type": "draw",
            "content": {"prompt": "Обведите очаг"},
        }
        answer_key = {"targets": []}
        user_input = {"polygons": [], "lines": []}

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.success is False
        assert result.details["found_targets"] == []
        assert result.details["unmatched_actions"] == []
        assert result.details["message_key"] == "draw_no_targets"

    def test_partial_success(self, evaluator):
        """Пользователь правильно нарисовал 1 из 2 полигонов."""
        task_data = {
            "type": "draw",
            "content": {
                "prompt": "Обведите оба очага",
                "settings": {"coverage_threshold": 70},
            },
        }
        answer_key = {
            "targets": [
                {
                    "shape": "polygon",
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                },
                {
                    "shape": "polygon",
                    "points": [[100, 100], [150, 100], [150, 150], [100, 150]],
                    "label": "Очаг 2",
                },
            ]
        }
        user_input = {
            "polygons": [
                {
                    "points": [[10, 10], [50, 10], [50, 50], [10, 50]],
                    "label": "Очаг 1",
                },
                {
                    "points": [[500, 500], [550, 500], [550, 550], [500, 550]],
                    "label": "Мимо",
                },
            ],
            "lines": [],
        }

        result = evaluator.evaluate_draw_task(user_input, answer_key, task_data)

        assert result.success is False
        assert result.details["found_targets"] == [0]
        assert result.details["message_key"] == "draw_control_fail"
        assert result.details["message_params"]["successes"] == 1
        assert result.details["message_params"]["total_targets"] == 2
