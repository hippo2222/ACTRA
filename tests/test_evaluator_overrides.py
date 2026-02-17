import sys
from pathlib import Path

from task_system.core.hooks.hook_registry import hook_registry

DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.task_evaluator_service import TaskEvaluatorService, EvaluationResult


def test_override_draw_returns_immediate_result():
    # Arrange: register an override for draw
    def override_eval(task_type, user_input, answer_key, task_data):
        return {
            'success': True,
            'score': 100.0,
            'message': 'Overridden OK',
            'metric': 'IoU',
            'details': {'source': 'test'}
        }

    hook_registry.register(
        'evaluator.hooks.override.draw', override_eval, plugin_id='tests', priority=100
    )

    try:
        svc = TaskEvaluatorService(config={'evaluators': {'enabled': True, 'allow_override': True}})
        result = svc.evaluate_task('draw', {'drawing': [{'type': 'brush_stroke', 'points': [[0, 0]]}]}, {'targets': []})
        assert isinstance(result, EvaluationResult)
        assert result.success is True
        assert result.score == 100.0
        assert 'Overridden' in result.message
        assert result.metric == 'IoU'
    finally:
        # Cleanup: unregister all handlers for plugin 'tests'
        hook_registry.unregister_all_for_plugin('tests')


def test_override_ignored_when_disabled():
    def override_eval(task_type, user_input, answer_key, task_data):
        return {'success': True, 'score': 100.0, 'message': 'Should not be used'}

    hook_registry.register(
        'evaluator.hooks.override.open_answer', override_eval, plugin_id='tests', priority=100
    )

    try:
        svc = TaskEvaluatorService(config={'evaluators': {'enabled': True, 'allow_override': False}})
        # Without answer -> should not be success
        result = svc.evaluate_task('open_answer', {'answer': ''}, {'keywords': ['a']})
        assert result.success is False
    finally:
        hook_registry.unregister_all_for_plugin('tests')






