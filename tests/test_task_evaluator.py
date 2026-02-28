"""
Unit tests for TaskEvaluatorService — T1 coverage plan.

Covers:
- EvaluationResult dataclass validation
- Static helpers (_normalize_required_correct, _is_error_detection_click, etc.)
- evaluate_task dispatcher
- Click evaluation: point, polygon, text_choice, error_detection, multiple clicks
- Open answer evaluation
- Label evaluation helpers
- Geometry helpers (_point_to_line_segment_distance, _check_point_target, etc.)
- Draw task evaluation basics
- Sequence task helpers (_normalize_text_for_comparison, _evaluate_level_names, etc.)
- _evaluate_text_answer
- calculate_line_coverage
"""

import sys
import os
import math
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult
from task_system.core.exceptions import EvaluationError


# ─── Fixtures ──────────────────────────────────────────────────────


@pytest.fixture
def svc():
    return TaskEvaluatorService()


# ═══════════════════════════════════════════════════════════════════
# EvaluationResult
# ═══════════════════════════════════════════════════════════════════


class TestEvaluationResult:
    def test_basic_creation(self):
        r = EvaluationResult(success=True, message="ok", score=80.0, metric="percent")
        assert r.success is True
        assert r.score == 80.0
        assert r.metric == "percent"

    def test_default_fields(self):
        r = EvaluationResult(success=False, message="fail")
        assert r.score is None
        assert r.metric is None
        assert r.details == {}
        assert r.timestamp is not None

    def test_invalid_score_raises(self):
        with pytest.raises(EvaluationError):
            EvaluationResult(success=True, message="x", score=150.0)

    def test_negative_score_raises(self):
        with pytest.raises(EvaluationError):
            EvaluationResult(success=True, message="x", score=-1.0)

    def test_invalid_metric_raises(self):
        with pytest.raises(EvaluationError):
            EvaluationResult(success=True, message="x", metric="invalid")

    def test_valid_metrics(self):
        for m in ("IoU", "distance", "percent"):
            r = EvaluationResult(success=True, message="ok", metric=m)
            assert r.metric == m

    def test_infer_metric(self):
        assert EvaluationResult.infer_metric_from_task_type("click") == "distance"
        assert EvaluationResult.infer_metric_from_task_type("draw") == "IoU"
        assert EvaluationResult.infer_metric_from_task_type("open_answer") == "percent"
        assert EvaluationResult.infer_metric_from_task_type("sequence_assembly") == "percent"
        assert EvaluationResult.infer_metric_from_task_type("test") == "percent"
        assert EvaluationResult.infer_metric_from_task_type("unknown") == "percent"


# ═══════════════════════════════════════════════════════════════════
# Static helpers
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeRequiredCorrect:
    def test_valid_int(self):
        assert TaskEvaluatorService._normalize_required_correct(3) == 3

    def test_string_int(self):
        assert TaskEvaluatorService._normalize_required_correct("5") == 5

    def test_zero_becomes_one(self):
        assert TaskEvaluatorService._normalize_required_correct(0) == 1

    def test_negative_becomes_one(self):
        assert TaskEvaluatorService._normalize_required_correct(-2) == 1

    def test_invalid_uses_default(self):
        assert TaskEvaluatorService._normalize_required_correct("abc", 4) == 4

    def test_none_uses_default(self):
        assert TaskEvaluatorService._normalize_required_correct(None, 2) == 2


class TestIsErrorDetectionClick:
    def test_subtype_error_detection(self):
        assert TaskEvaluatorService._is_error_detection_click({}, "error_detection", None) is True

    def test_content_subtype_error_detection(self):
        assert TaskEvaluatorService._is_error_detection_click({}, None, "error_detection") is True

    def test_mode_text_errors(self):
        assert TaskEvaluatorService._is_error_detection_click({"mode": "text_errors"}, None, None) is True

    def test_mode_text_choice(self):
        assert TaskEvaluatorService._is_error_detection_click({"mode": "text_choice"}, None, None) is True

    def test_error_spans_list(self):
        assert TaskEvaluatorService._is_error_detection_click({"error_spans": []}, None, None) is True

    def test_errorSpans_camelCase(self):
        assert TaskEvaluatorService._is_error_detection_click({"errorSpans": []}, None, None) is True

    def test_none_returns_false(self):
        assert TaskEvaluatorService._is_error_detection_click({}, None, None) is False


class TestNormalizeSelectedIndices:
    def test_valid_list(self):
        norm, inv = TaskEvaluatorService._normalize_selected_indices([0, 1, 2])
        assert norm == [0, 1, 2]
        assert inv == []

    def test_dedup(self):
        norm, inv = TaskEvaluatorService._normalize_selected_indices([1, 1, 2])
        assert norm == [1, 2]

    def test_negative_filtered(self):
        norm, inv = TaskEvaluatorService._normalize_selected_indices([-1, 0])
        assert norm == [0]
        assert inv == [-1]

    def test_non_int_filtered(self):
        norm, inv = TaskEvaluatorService._normalize_selected_indices(["a", 1])
        assert norm == [1]
        assert inv == ["a"]

    def test_not_list(self):
        norm, inv = TaskEvaluatorService._normalize_selected_indices("bad")
        assert norm == []
        assert inv == []


class TestSplitTextIntoWordsWithSpans:
    def test_simple(self):
        words = TaskEvaluatorService._split_text_into_words_with_spans("hello world")
        assert len(words) == 2
        assert words[0]["index"] == 0
        assert words[1]["index"] == 1

    def test_multiple_spaces(self):
        words = TaskEvaluatorService._split_text_into_words_with_spans("a  b   c")
        assert len(words) == 3

    def test_empty(self):
        words = TaskEvaluatorService._split_text_into_words_with_spans("")
        assert words == []

    def test_spans_correct(self):
        words = TaskEvaluatorService._split_text_into_words_with_spans("ab cd")
        assert words[0]["start"] == 0
        assert words[0]["end"] == 2
        assert words[1]["start"] == 3
        assert words[1]["end"] == 5


class TestExtractErrorWordIndices:
    def test_basic(self):
        content = {
            "text": "one two three",
            "error_spans": [{"start": 4, "end": 7, "is_correct": False}],
        }
        indices, word_count = TaskEvaluatorService._extract_error_word_indices_from_content(content)
        assert 1 in indices  # "two" is at index 1
        assert word_count == 3

    def test_no_text(self):
        indices, wc = TaskEvaluatorService._extract_error_word_indices_from_content({})
        assert indices is None
        assert wc is None

    def test_no_spans(self):
        content = {"text": "hello"}
        indices, wc = TaskEvaluatorService._extract_error_word_indices_from_content(content)
        assert indices is None
        assert wc == 1

    def test_is_correct_true_skipped(self):
        content = {
            "text": "word1 word2",
            "error_spans": [{"start": 0, "end": 5, "is_correct": True}],
        }
        indices, _ = TaskEvaluatorService._extract_error_word_indices_from_content(content)
        assert len(indices) == 0


class TestComputeErrorRequiredCount:
    def test_require_all(self):
        assert TaskEvaluatorService._compute_error_required_count(1, True, 3) == 3

    def test_normal_with_expected(self):
        assert TaskEvaluatorService._compute_error_required_count(2, False, 5) == 2

    def test_required_larger_than_expected(self):
        assert TaskEvaluatorService._compute_error_required_count(10, False, 3) == 3

    def test_no_expected(self):
        assert TaskEvaluatorService._compute_error_required_count(2, False, None) == 2


# ═══════════════════════════════════════════════════════════════════
# evaluate_task dispatcher
# ═══════════════════════════════════════════════════════════════════


class TestEvaluateTaskDispatcher:
    def test_unknown_type_raises(self, svc):
        with pytest.raises(EvaluationError):
            svc.evaluate_task("unknown_type", {}, {})

    def test_click_dispatches(self, svc):
        answer_key = {
            "targets": [{"shape": "point", "point": [100, 100], "tolerance_px": 50}]
        }
        result = svc.evaluate_task(
            "click",
            {"x": 100, "y": 100},
            answer_key,
            task_data={"content": {}, "settings": {}},
        )
        assert isinstance(result, EvaluationResult)
        assert result.success is True

    def test_metric_inferred_for_click(self, svc):
        answer_key = {
            "targets": [{"shape": "point", "point": [100, 100], "tolerance_px": 50}]
        }
        result = svc.evaluate_task(
            "click",
            {"x": 100, "y": 100},
            answer_key,
            task_data={"content": {}, "settings": {}},
        )
        assert result.metric == "distance"


# ═══════════════════════════════════════════════════════════════════
# Click task: point target
# ═══════════════════════════════════════════════════════════════════


class TestClickPointTarget:
    def test_hit_within_tolerance(self, svc):
        result = svc.evaluate_click_task(
            {"x": 102, "y": 98},
            {"targets": [{"shape": "point", "point": [100, 100], "tolerance_px": 10}]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is True
        assert result.score == 100.0

    def test_miss_outside_tolerance(self, svc):
        result = svc.evaluate_click_task(
            {"x": 200, "y": 200},
            {"targets": [{"shape": "point", "point": [100, 100], "tolerance_px": 10}]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False
        assert result.score == 0.0

    def test_coordinates_format(self, svc):
        """Legacy format: 'coordinates' instead of 'point'."""
        result = svc.evaluate_click_task(
            {"x": 50, "y": 50},
            {"targets": [{"shape": "point", "coordinates": [50, 50], "tolerance_px": 5}]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is True

    def test_no_targets_returns_fail(self, svc):
        result = svc.evaluate_click_task(
            {"x": 50, "y": 50},
            {"targets": []},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False
        assert result.details.get("error") == "no_targets"


# ═══════════════════════════════════════════════════════════════════
# Click task: polygon target
# ═══════════════════════════════════════════════════════════════════


class TestClickPolygonTarget:
    SQUARE = {"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]], "label": "Square"}

    def test_inside_polygon(self, svc):
        result = svc.evaluate_click_task(
            {"x": 50, "y": 50},
            {"targets": [self.SQUARE]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is True

    def test_outside_polygon(self, svc):
        result = svc.evaluate_click_task(
            {"x": 200, "y": 200},
            {"targets": [self.SQUARE]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False


# ═══════════════════════════════════════════════════════════════════
# Click task: text_choice mode
# ═══════════════════════════════════════════════════════════════════


class TestClickTextChoice:
    def test_correct_choice(self, svc):
        answer_key = {
            "targets": [],
            "options": [
                {"id": "a", "text": "Alpha", "is_correct": True},
                {"id": "b", "text": "Beta", "is_correct": False},
            ],
        }
        result = svc.evaluate_click_task(
            {"selected_option_id": "a"},
            answer_key,
            task_data={"content": {"mode": "text_choice"}, "settings": {}},
        )
        assert result.success is True
        assert result.score == 100.0
        assert result.details["mode"] == "text_choice"

    def test_wrong_choice(self, svc):
        answer_key = {
            "targets": [],
            "options": [
                {"id": "a", "text": "Alpha", "is_correct": True},
                {"id": "b", "text": "Beta", "is_correct": False},
            ],
        }
        result = svc.evaluate_click_task(
            {"selected_option_id": "b"},
            answer_key,
            task_data={"content": {"mode": "text_choice"}, "settings": {}},
        )
        assert result.success is False
        assert result.score == 0.0


# ═══════════════════════════════════════════════════════════════════
# Click task: error detection by indices
# ═══════════════════════════════════════════════════════════════════


class TestClickErrorDetection:
    def test_correct_error_indices(self, svc):
        content = {
            "mode": "text_errors",
            "text": "one two three",
            "error_spans": [{"start": 4, "end": 7, "is_correct": False}],
        }
        result = svc.evaluate_click_task(
            {"selected_indices": [1]},
            {"targets": []},
            task_data={"content": content, "settings": {}},
        )
        assert result.success is True
        assert result.details["mode"] == "text_errors"

    def test_wrong_error_indices(self, svc):
        content = {
            "mode": "text_errors",
            "text": "one two three",
            "error_spans": [{"start": 4, "end": 7, "is_correct": False}],
        }
        result = svc.evaluate_click_task(
            {"selected_indices": [0]},
            {"targets": []},
            task_data={"content": content, "settings": {}},
        )
        assert result.success is False

    def test_error_detection_spans(self, svc):
        content = {
            "subtype": "error_detection",
            "reference_spans": [{"start": 0, "end": 5}],
        }
        result = svc.evaluate_click_task(
            {"spans": [{"start": 0, "end": 5}]},
            {"targets": []},
            task_data={"content": content, "settings": {}},
        )
        assert result.success is True


# ═══════════════════════════════════════════════════════════════════
# Click task: multiple clicks
# ═══════════════════════════════════════════════════════════════════


class TestMultipleClicks:
    def test_all_found(self, svc):
        targets = [
            {"shape": "point", "point": [10, 10], "tolerance_px": 5, "label": "A"},
            {"shape": "point", "point": [50, 50], "tolerance_px": 5, "label": "B"},
        ]
        result = svc.evaluate_click_task(
            {"clicks": [{"x": 10, "y": 10}, {"x": 50, "y": 50}]},
            {"targets": targets},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is True
        assert result.details["found_count"] == 2

    def test_partial_found(self, svc):
        targets = [
            {"shape": "point", "point": [10, 10], "tolerance_px": 5, "label": "A"},
            {"shape": "point", "point": [50, 50], "tolerance_px": 5, "label": "B"},
        ]
        result = svc.evaluate_click_task(
            {"clicks": [{"x": 10, "y": 10}]},
            {"targets": targets},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False
        assert result.details["found_count"] == 1

    def test_success_threshold(self, svc):
        targets = [
            {"shape": "point", "point": [10, 10], "tolerance_px": 5, "label": "A"},
            {"shape": "point", "point": [50, 50], "tolerance_px": 5, "label": "B"},
            {"shape": "point", "point": [90, 90], "tolerance_px": 5, "label": "C"},
        ]
        result = svc.evaluate_click_task(
            {"clicks": [{"x": 10, "y": 10}, {"x": 50, "y": 50}]},
            {"targets": targets},
            task_data={"content": {}, "settings": {"success_threshold": 2}},
        )
        assert result.success is True
        assert result.details["threshold_mode"] is True


# ═══════════════════════════════════════════════════════════════════
# Geometry helpers
# ═══════════════════════════════════════════════════════════════════


class TestPointToLineSegmentDistance:
    def test_point_on_line(self, svc):
        dist = svc._point_to_line_segment_distance(5, 0, (0, 0), (10, 0))
        assert dist == pytest.approx(0.0, abs=1e-9)

    def test_point_above_midpoint(self, svc):
        dist = svc._point_to_line_segment_distance(5, 3, (0, 0), (10, 0))
        assert dist == pytest.approx(3.0, abs=1e-9)

    def test_point_beyond_end(self, svc):
        dist = svc._point_to_line_segment_distance(15, 0, (0, 0), (10, 0))
        assert dist == pytest.approx(5.0, abs=1e-9)

    def test_point_before_start(self, svc):
        dist = svc._point_to_line_segment_distance(-3, 4, (0, 0), (10, 0))
        assert dist == pytest.approx(5.0, abs=1e-9)

    def test_zero_length_segment(self, svc):
        dist = svc._point_to_line_segment_distance(3, 4, (0, 0), (0, 0))
        assert dist == pytest.approx(5.0, abs=1e-9)


class TestCheckPointTarget:
    def test_exact_match(self, svc):
        assert svc._check_point_target(10, 10, {"point": [10, 10]}, 1.0, 0, 0, 5) is True

    def test_within_tolerance(self, svc):
        assert svc._check_point_target(13, 14, {"point": [10, 10]}, 1.0, 0, 0, 10) is True

    def test_outside_tolerance(self, svc):
        assert svc._check_point_target(100, 100, {"point": [10, 10]}, 1.0, 0, 0, 5) is False

    def test_no_coordinates(self, svc):
        assert svc._check_point_target(0, 0, {}, 1.0, 0, 0, 5) is False


class TestCheckPolygonTarget:
    def test_inside(self, svc):
        target = {"points": [[0, 0], [100, 0], [100, 100], [0, 100]]}
        assert svc._check_polygon_target(50, 50, target, 1.0, 0, 0) is True

    def test_outside(self, svc):
        target = {"points": [[0, 0], [100, 0], [100, 100], [0, 100]]}
        assert svc._check_polygon_target(200, 200, target, 1.0, 0, 0) is False

    def test_too_few_points(self, svc):
        target = {"points": [[0, 0], [100, 0]]}
        assert svc._check_polygon_target(50, 50, target, 1.0, 0, 0) is False


class TestCheckFreehandTarget:
    def test_on_line(self, svc):
        target = {"points": [(0, 0), (100, 0)], "tolerance_px": 10}
        # Click at (50, 0) with scale_factor=1 and no offset -> img coords = (50, 0)
        assert svc._check_freehand_target(50, 0, target, 1.0, 0, 0, 10) is True

    def test_near_line(self, svc):
        target = {"points": [(0, 0), (100, 0)]}
        assert svc._check_freehand_target(50, 5, target, 1.0, 0, 0, 10) is True

    def test_far_from_line(self, svc):
        target = {"points": [(0, 0), (100, 0)]}
        assert svc._check_freehand_target(50, 50, target, 1.0, 0, 0, 10) is False

    def test_too_few_points(self, svc):
        target = {"points": [(0, 0)]}
        assert svc._check_freehand_target(0, 0, target, 1.0, 0, 0, 10) is False


# ═══════════════════════════════════════════════════════════════════
# _evaluate_labels
# ═══════════════════════════════════════════════════════════════════


class TestEvaluateLabels:
    def test_all_correct(self, svc):
        result = svc._evaluate_labels(["Heart", "Lung"], ["Heart", "Lung"])
        assert result["success"] is True
        assert result["score"] == 100.0

    def test_one_wrong(self, svc):
        result = svc._evaluate_labels(["Heart", "Wrong"], ["Heart", "Lung"])
        assert result["success"] is False
        assert result["score"] == 50.0

    def test_empty_user_labels(self, svc):
        result = svc._evaluate_labels([], ["Heart"])
        assert result["success"] is False
        assert result["score"] == 0.0

    def test_empty_correct_labels(self, svc):
        result = svc._evaluate_labels(["Heart"], [])
        assert result["success"] is False


class TestEvaluateLabel:
    def test_exact_match(self, svc):
        result = svc._evaluate_label("Heart", "Heart")
        assert result["success"] is True

    def test_empty_user(self, svc):
        result = svc._evaluate_label("", "Heart")
        assert result["success"] is False

    def test_no_correct(self, svc):
        result = svc._evaluate_label("Heart", "")
        assert result["success"] is False


# ═══════════════════════════════════════════════════════════════════
# _normalize_text_for_comparison
# ═══════════════════════════════════════════════════════════════════


class TestNormalizeText:
    def test_lowercase(self, svc):
        assert svc._normalize_text_for_comparison("Hello") == "hello"

    def test_yo_replaced(self, svc):
        assert svc._normalize_text_for_comparison("ёлка") == "елка"

    def test_strip_spaces(self, svc):
        assert svc._normalize_text_for_comparison("  hello  world  ") == "hello world"

    def test_empty(self, svc):
        assert svc._normalize_text_for_comparison("") == ""

    def test_none_safe(self, svc):
        assert svc._normalize_text_for_comparison(None) == ""


# ═══════════════════════════════════════════════════════════════════
# _evaluate_text_answer
# ═══════════════════════════════════════════════════════════════════


class TestEvaluateTextAnswer:
    def test_all_keywords_found(self, svc):
        result = svc._evaluate_text_answer("The heart pumps blood", ["heart", "blood"])
        assert result["success"] is True

    def test_missing_keyword(self, svc):
        result = svc._evaluate_text_answer("The heart is strong", ["heart", "blood"])
        assert result["success"] is False
        assert "blood" in result["missing_keywords"]

    def test_no_keywords(self, svc):
        result = svc._evaluate_text_answer("answer", [])
        assert result["success"] is False

    def test_empty_answer(self, svc):
        result = svc._evaluate_text_answer("", ["heart"])
        assert result["success"] is False


# ═══════════════════════════════════════════════════════════════════
# Open answer task evaluation
# ═══════════════════════════════════════════════════════════════════


class TestOpenAnswerTask:
    def test_correct_answer(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "The mitochondria produces energy"},
            {"keywords": ["mitochondria", "energy"]},
        )
        assert result.success is True
        assert result.metric == "percent"

    def test_missing_keywords(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "The cell is big"},
            {"keywords": ["mitochondria", "energy"]},
        )
        assert result.success is False

    def test_empty_answer(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": ""},
            {"keywords": ["mitochondria"]},
        )
        assert result.success is False
        assert result.details.get("error") == "empty_answer"

    def test_no_keywords(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "something"},
            {"keywords": []},
        )
        assert result.success is False
        assert result.details.get("error") == "no_keywords"

    def test_partial_keywords(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "The heart is large"},
            {"keywords": ["heart", "blood", "pumps"]},
        )
        assert result.success is False
        assert result.score == pytest.approx(100.0 / 3, abs=0.1)

    def test_sequence_matters_correct_order(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "The heart pumps blood"},
            {"keywords": ["heart", "pumps", "blood"], "sequence_matters": True},
        )
        assert result.success is True

    def test_min_keywords_partial(self, svc):
        result = svc.evaluate_open_answer_task(
            {"answer": "heart and lungs"},
            {"keywords": ["heart", "lungs", "brain"], "require_all_keywords": False, "min_keywords": 2},
        )
        assert result.success is True


# ═══════════════════════════════════════════════════════════════════
# Draw task helpers
# ═══════════════════════════════════════════════════════════════════


class TestDrawHelpers:
    def test_is_point_covered_by_strokes(self, svc):
        strokes = [{"type": "brush_stroke", "points": [[10, 10], [20, 20]]}]
        assert svc._is_point_covered_by_strokes(10, 10, strokes) is True
        assert svc._is_point_covered_by_strokes(100, 100, strokes) is False

    def test_calculate_accuracy_bonus_no_strokes(self, svc):
        assert svc._calculate_accuracy_bonus([(0, 0), (100, 0), (100, 100), (0, 100)], []) == 0.5

    def test_calculate_outside_penalty_no_strokes(self, svc):
        assert svc._calculate_outside_penalty([(0, 0), (100, 0), (100, 100), (0, 100)], []) == 0.0

    def test_calculate_accuracy_bonus_all_inside(self, svc):
        poly = [(0, 0), (100, 0), (100, 100), (0, 100)]
        strokes = [{"type": "brush_stroke", "points": [[50, 50], [25, 25], [75, 75]]}]
        bonus = svc._calculate_accuracy_bonus(poly, strokes)
        assert bonus >= 0.5
        assert bonus <= 1.0

    def test_calculate_outside_penalty_all_outside(self, svc):
        poly = [(0, 0), (10, 0), (10, 10), (0, 10)]
        strokes = [{"type": "brush_stroke", "points": [[500, 500], [600, 600]]}]
        penalty = svc._calculate_outside_penalty(poly, strokes)
        assert penalty > 0

    def test_is_point_near_strokes(self, svc):
        strokes = [{"type": "brush_stroke", "points": [[10, 10]]}]
        assert svc._is_point_near_strokes(10, 10, strokes, 5.0) is True
        assert svc._is_point_near_strokes(10, 14, strokes, 5.0) is True
        assert svc._is_point_near_strokes(10, 20, strokes, 5.0) is False


# ═══════════════════════════════════════════════════════════════════
# calculate_line_coverage
# ═══════════════════════════════════════════════════════════════════


class TestLineCoverage:
    def test_perfect_coverage(self, svc):
        line_pts = [(0, 0), (100, 0)]
        strokes = [{"type": "brush_stroke", "points": [[i, 0] for i in range(0, 101, 2)]}]
        coverage = svc.calculate_line_coverage(line_pts, strokes, tolerance_px=5.0, use_improved_evaluation=False)
        assert coverage >= 90.0

    def test_no_coverage(self, svc):
        line_pts = [(0, 0), (100, 0)]
        strokes = [{"type": "brush_stroke", "points": [[0, 500], [100, 500]]}]
        coverage = svc.calculate_line_coverage(line_pts, strokes, tolerance_px=5.0, use_improved_evaluation=False)
        assert coverage < 10.0

    def test_too_few_points(self, svc):
        assert svc.calculate_line_coverage([(0, 0)], [], 5.0) == 0.0

    def test_dict_input(self, svc):
        line_pts = [(0, 0), (100, 0)]
        drawing_dict = {"drawing": [{"type": "brush_stroke", "points": [[i, 0] for i in range(0, 101, 2)]}]}
        coverage = svc.calculate_line_coverage(line_pts, drawing_dict, tolerance_px=5.0, use_improved_evaluation=False)
        assert coverage >= 90.0


# ═══════════════════════════════════════════════════════════════════
# _calculate_bidirectional_coverage
# ═══════════════════════════════════════════════════════════════════


class TestBidirectionalCoverage:
    def test_perfect_overlap(self, svc):
        line_pts = [(0, 0), (100, 0)]
        strokes = [{"type": "brush_stroke", "points": [[i, 0] for i in range(0, 101, 2)]}]
        result = svc._calculate_bidirectional_coverage(line_pts, strokes, 5.0)
        assert result["reference_coverage"] >= 90.0
        assert result["user_coverage"] >= 90.0

    def test_no_user_points(self, svc):
        line_pts = [(0, 0), (100, 0)]
        result = svc._calculate_bidirectional_coverage(line_pts, [], 5.0)
        assert result["user_coverage"] == 0.0


# ═══════════════════════════════════════════════════════════════════
# _calculate_shape_similarity
# ═══════════════════════════════════════════════════════════════════


class TestShapeSimilarity:
    def test_identical_returns_100(self, svc):
        pts = [(0, 0), (100, 0)]
        strokes = [{"type": "brush_stroke", "points": [[0, 0], [50, 0], [100, 0]]}]
        score = svc._calculate_shape_similarity(pts, strokes, 10.0)
        assert score >= 90.0

    def test_no_drawing_returns_0(self, svc):
        score = svc._calculate_shape_similarity([(0, 0), (100, 0)], [], 10.0)
        assert score == 0.0


# ═══════════════════════════════════════════════════════════════════
# Draw task: basic evaluation
# ═══════════════════════════════════════════════════════════════════


class TestDrawTaskBasic:
    def test_no_drawing(self, svc):
        result = svc.evaluate_draw_task(
            {"drawing": []},
            {"targets": [{"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]}]},
        )
        assert result.success is False
        assert result.details.get("error") == "no_drawing"

    def test_no_targets(self, svc):
        result = svc.evaluate_draw_task(
            {"drawing": [{"type": "brush_stroke", "points": [[50, 50]]}]},
            {"targets": []},
        )
        assert result.success is False
        assert result.details.get("error") == "no_targets"


# ═══════════════════════════════════════════════════════════════════
# _evaluate_level_names (sequence task helpers)
# ═══════════════════════════════════════════════════════════════════


class TestEvaluateLevelNames:
    def test_all_correct(self, svc):
        user_levels = [
            {"level_id": "u1", "level_name": "Level A", "blocks": ["b1", "b2"]},
        ]
        correct_levels = [
            {"level_id": "c1", "level_name": "Level A", "blocks": ["b1", "b2"]},
        ]
        result = svc._evaluate_level_names(user_levels, correct_levels)
        assert result["success"] is True
        assert result["score"] == 100.0

    def test_wrong_name(self, svc):
        """When blocks match but name is wrong, matched by blocks but name check fails."""
        user_levels = [
            {"level_id": "u1", "level_name": "Wrong", "blocks": ["b1"]},
        ]
        correct_levels = [
            {"level_id": "c1", "level_name": "Correct", "blocks": ["b1"]},
        ]
        result = svc._evaluate_level_names(user_levels, correct_levels)
        # _evaluate_level_names uses a scoring system: blocks match = score 1,
        # blocks+name match = score 2. Score >= 1 counts as matched.
        # So blocks matching alone counts as a match.
        assert result["score"] == 100.0

    def test_no_match_at_all(self, svc):
        """Different blocks and different names -> no match."""
        user_levels = [
            {"level_id": "u1", "level_name": "Wrong", "blocks": ["x1"]},
        ]
        correct_levels = [
            {"level_id": "c1", "level_name": "Correct", "blocks": ["b1"]},
        ]
        result = svc._evaluate_level_names(user_levels, correct_levels)
        assert result["success"] is False

    def test_empty_correct(self, svc):
        result = svc._evaluate_level_names([], [])
        assert result["success"] is False


class TestEvaluateBlockNames:
    def test_all_correct(self, svc):
        user_levels = [
            {"level_id": "l1", "level_name": "A", "block_names": {"b1": "Heart", "b2": "Lung"}},
        ]
        correct_levels = [
            {"level_id": "l1", "level_name": "A", "block_names": {"b1": "Heart", "b2": "Lung"}},
        ]
        result = svc._evaluate_block_names(user_levels, correct_levels)
        assert result["success"] is True

    def test_wrong_block_name(self, svc):
        user_levels = [
            {"level_id": "l1", "level_name": "A", "block_names": {"b1": "Wrong"}},
        ]
        correct_levels = [
            {"level_id": "l1", "level_name": "A", "block_names": {"b1": "Heart"}},
        ]
        result = svc._evaluate_block_names(user_levels, correct_levels)
        assert result["success"] is False

    def test_empty_correct(self, svc):
        result = svc._evaluate_block_names([], [])
        assert result["success"] is False


# ═══════════════════════════════════════════════════════════════════
# _find_closest_annotation
# ═══════════════════════════════════════════════════════════════════


class TestFindClosestAnnotation:
    def test_inside_polygon_distance_zero(self, svc):
        targets = [{"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]}]
        drawing = [{"type": "brush_stroke", "points": [[50, 50]]}]
        result = svc._find_closest_annotation(drawing, targets)
        assert result is not None
        assert result[0] == 0
        assert result[1] == 0

    def test_empty_drawing(self, svc):
        assert svc._find_closest_annotation([], [{"shape": "polygon", "points": [[0, 0], [1, 0], [1, 1]]}]) is None

    def test_empty_targets(self, svc):
        assert svc._find_closest_annotation([{"type": "brush_stroke", "points": [[0, 0]]}], []) is None

    def test_dict_drawing(self, svc):
        targets = [{"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]}]
        drawing = {"drawing": [{"type": "brush_stroke", "points": [[50, 50]]}]}
        result = svc._find_closest_annotation(drawing, targets)
        assert result is not None


# ═══════════════════════════════════════════════════════════════════
# _evaluate_draw_task_new_format
# ═══════════════════════════════════════════════════════════════════


class TestDrawTaskNewFormat:
    def test_polygons_missing(self, svc):
        result = svc.evaluate_draw_task(
            {"polygons": [], "lines": []},
            {"targets": [{"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]}]},
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False
        assert result.details.get("error") == "polygons_missing"

    def test_lines_missing_after_polygons(self, svc):
        result = svc.evaluate_draw_task(
            {
                "polygons": [{"points": [[10, 10], [90, 10], [90, 90], [10, 90]]}],
                "lines": [],
            },
            {
                "targets": [
                    {"shape": "polygon", "points": [[0, 0], [100, 0], [100, 100], [0, 100]]},
                    {"shape": "freehand", "points": [[0, 0], [100, 100]]},
                ]
            },
            task_data={"content": {}, "settings": {}},
        )
        assert result.success is False
        assert result.details.get("error") == "lines_missing"


# ═══════════════════════════════════════════════════════════════════
# _evaluate_draw_task_multiple_polygons
# ═══════════════════════════════════════════════════════════════════


class TestDrawMultiplePolygons:
    def test_threshold_mode(self, svc):
        # Create a simple draw task with multiple polygon targets and a success threshold
        targets = [
            {"shape": "polygon", "points": [[0, 0], [50, 0], [50, 50], [0, 50]], "label": "A"},
            {"shape": "polygon", "points": [[200, 200], [250, 200], [250, 250], [200, 250]], "label": "B"},
        ]
        # Drawing covers only the first polygon area
        drawing = [{"type": "brush_stroke", "points": [[i, j] for i in range(0, 51, 2) for j in range(0, 51, 5)]}]
        result = svc.evaluate_draw_task(
            {"drawing": drawing},
            {"targets": targets},
            task_data={"content": {}, "settings": {"success_threshold": 1}},
        )
        # Should succeed since threshold is 1 and first polygon may be covered
        assert isinstance(result, EvaluationResult)
        assert result.details.get("threshold_mode") is True
