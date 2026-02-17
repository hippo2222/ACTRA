"""
Regression tests for open_answer audit fixes (D-1 through D-10).

Covers:
  D-1:  min_keywords / require_all_keywords support in evaluator
  D-2:  reference_answer copied by _normalize_answer_key
  D-7:  sequence_matters regex allows non-adjacent keywords
  D-8:  score reflects sequence failure (50% instead of 100%)
  D-9:  TaskIO.new_task initializes 'question' field
  D-1+: _normalize_answer_key copies min_keywords, require_all_keywords
"""
import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'desktop-app'))


class TestNormalizeAnswerKeyOpenAnswer(unittest.TestCase):
    """D-1, D-2: _normalize_answer_key copies new fields for open_answer."""

    def _get_service(self):
        from desktop_app_services import StorageService
        return StorageService.__new__(StorageService)

    def _normalize(self, task_data, answer_key):
        """Try to import StorageService and call _normalize_answer_key."""
        from services.storage_service import StorageService
        svc = StorageService.__new__(StorageService)
        return svc._normalize_answer_key(task_data, answer_key)

    def test_copies_reference_answer(self):
        """D-2: reference_answer must be copied from content to answer_key."""
        task_data = {
            'type': 'open_answer',
            'content': {
                'keywords': ['a', 'b'],
                'reference_answer': 'Reference text here',
                'sequence_matters': False,
            }
        }
        result = self._normalize(task_data, {})
        self.assertEqual(result.get('reference_answer'), 'Reference text here')

    def test_copies_min_keywords(self):
        """D-1: min_keywords must be copied from content to answer_key."""
        task_data = {
            'type': 'open_answer',
            'content': {
                'keywords': ['a', 'b', 'c'],
                'min_keywords': 2,
                'require_all_keywords': False,
            }
        }
        result = self._normalize(task_data, {})
        self.assertEqual(result.get('min_keywords'), 2)
        self.assertFalse(result.get('require_all_keywords'))

    def test_copies_require_all_keywords(self):
        """D-1: require_all_keywords must be copied."""
        task_data = {
            'type': 'open_answer',
            'content': {
                'keywords': ['x'],
                'require_all_keywords': True,
            }
        }
        result = self._normalize(task_data, {})
        self.assertTrue(result.get('require_all_keywords'))

    def test_does_not_overwrite_existing(self):
        """Fields already in answer_key must not be overwritten."""
        task_data = {
            'type': 'open_answer',
            'content': {
                'keywords': ['content_kw'],
                'reference_answer': 'content_ref',
                'min_keywords': 5,
            }
        }
        existing = {
            'keywords': ['existing_kw'],
            'reference_answer': 'existing_ref',
            'min_keywords': 1,
        }
        result = self._normalize(task_data, existing)
        self.assertEqual(result['keywords'], ['existing_kw'])
        self.assertEqual(result['reference_answer'], 'existing_ref')
        self.assertEqual(result['min_keywords'], 1)


class TestEvaluatorMinKeywords(unittest.TestCase):
    """D-1: Evaluator respects min_keywords / require_all_keywords."""

    def setUp(self):
        from services.task_evaluator_service import TaskEvaluatorService
        self.service = TaskEvaluatorService()

    def test_require_all_keywords_default(self):
        """Default behavior: all keywords required."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень', 'детоксикация'],
            'sequence_matters': False,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)

    def test_min_keywords_partial_success(self):
        """D-1: With require_all_keywords=False and min_keywords=1, 1/2 is enough."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень', 'детоксикация'],
            'sequence_matters': False,
            'require_all_keywords': False,
            'min_keywords': 1,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertTrue(result.success)

    def test_min_keywords_not_met(self):
        """D-1: With min_keywords=2 and only 1 found, should fail."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень', 'детоксикация', 'орган'],
            'sequence_matters': False,
            'require_all_keywords': False,
            'min_keywords': 2,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)

    def test_min_keywords_exactly_met(self):
        """D-1: With min_keywords=2 and exactly 2 found, should pass."""
        user_input = {'answer': 'печень и детоксикация'}
        answer_key = {
            'keywords': ['печень', 'детоксикация', 'орган'],
            'sequence_matters': False,
            'require_all_keywords': False,
            'min_keywords': 2,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertTrue(result.success)

    def test_require_all_true_overrides_min_keywords(self):
        """When require_all_keywords=True (default), min_keywords is ignored."""
        user_input = {'answer': 'печень и детоксикация'}
        answer_key = {
            'keywords': ['печень', 'детоксикация', 'орган'],
            'sequence_matters': False,
            'require_all_keywords': True,
            'min_keywords': 1,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)


class TestSequenceNonAdjacent(unittest.TestCase):
    """D-7: sequence_matters allows non-adjacent keywords."""

    def setUp(self):
        from services.task_evaluator_service import TaskEvaluatorService
        self.service = TaskEvaluatorService()

    def test_adjacent_keywords_pass(self):
        """Keywords directly adjacent should still pass."""
        user_input = {'answer': 'вдох выдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertTrue(result.success)

    def test_non_adjacent_keywords_pass(self):
        """D-7: Keywords with other words between them should pass."""
        user_input = {'answer': 'сначала вдох а потом выдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertTrue(result.success)

    def test_wrong_order_fails(self):
        """Keywords in wrong order should still fail."""
        user_input = {'answer': 'сначала выдох а потом вдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)


class TestScoreSequenceFailure(unittest.TestCase):
    """D-8: Score reflects sequence failure."""

    def setUp(self):
        from services.task_evaluator_service import TaskEvaluatorService
        self.service = TaskEvaluatorService()

    def test_wrong_order_score_zero(self):
        """D-8: All keywords found but wrong order -> score = 0 (binary pass/fail)."""
        user_input = {'answer': 'выдох и вдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)
        self.assertEqual(result.score, 0.0)

    def test_correct_order_score_100(self):
        """Correct order -> score = 100."""
        user_input = {'answer': 'вдох и выдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertTrue(result.success)
        self.assertEqual(result.score, 100.0)

    def test_partial_keywords_score_proportional(self):
        """Only some keywords found -> score is proportional."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень', 'детоксикация'],
            'sequence_matters': False,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertFalse(result.success)
        self.assertAlmostEqual(result.score, 50.0)


class TestEvaluatorReferenceAnswer(unittest.TestCase):
    """D-2: reference_answer is included in evaluation result details."""

    def setUp(self):
        from services.task_evaluator_service import TaskEvaluatorService
        self.service = TaskEvaluatorService()

    def test_reference_answer_in_details(self):
        """D-2: reference_answer from answer_key should appear in details."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень', 'детоксикация'],
            'sequence_matters': False,
            'reference_answer': 'Печень выполняет детоксикацию',
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertEqual(
            result.details.get('reference_answer'),
            'Печень выполняет детоксикацию'
        )

    def test_no_reference_answer_when_absent(self):
        """When no reference_answer, details should not have it."""
        user_input = {'answer': 'печень'}
        answer_key = {
            'keywords': ['печень'],
            'sequence_matters': False,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertNotIn('reference_answer', result.details)


class TestTaskIONewTask(unittest.TestCase):
    """D-9: TaskIO.new_task('open_answer') initializes 'question' field."""

    def test_new_task_has_question(self):
        """D-9: new open_answer task must have 'question' in content."""
        from task_system.core.io.task_io import TaskIO
        task = TaskIO.new_task('open_answer')
        self.assertIn('question', task.content)

    def test_new_task_has_prompt(self):
        """Legacy: new open_answer task must also have 'prompt'."""
        from task_system.core.io.task_io import TaskIO
        task = TaskIO.new_task('open_answer')
        self.assertIn('prompt', task.content)


class TestEvaluatorDetailsPayload(unittest.TestCase):
    """Verify the details payload structure for frontend consumption."""

    def setUp(self):
        from services.task_evaluator_service import TaskEvaluatorService
        self.service = TaskEvaluatorService()

    def test_details_has_required_fields(self):
        """Details payload must have all expected fields."""
        user_input = {'answer': 'печень детоксикация'}
        answer_key = {
            'keywords': ['печень', 'детоксикация'],
            'sequence_matters': False,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        d = result.details
        self.assertIn('found_keywords', d)
        self.assertIn('missing_keywords', d)
        self.assertIn('total_keywords', d)
        self.assertIn('sequence_matters', d)
        self.assertIn('keywords', d)
        self.assertIn('tolerance_matches', d)
        self.assertIn('user_answer', d)

    def test_details_correct_sequence_when_sequence_matters(self):
        """When sequence_matters, details must include correct_sequence."""
        user_input = {'answer': 'вдох выдох'}
        answer_key = {
            'keywords': ['вдох', 'выдох'],
            'sequence_matters': True,
        }
        result = self.service.evaluate_open_answer_task(user_input, answer_key)
        self.assertIn('correct_sequence', result.details)
        self.assertEqual(result.details['correct_sequence'], ['вдох', 'выдох'])


if __name__ == '__main__':
    unittest.main()
