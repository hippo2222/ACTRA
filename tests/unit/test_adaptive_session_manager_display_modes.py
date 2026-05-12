from unittest.mock import Mock

from services.adaptive_session_manager import AdaptiveSessionManager


def test_display_mode_falls_back_to_source_task_ref_for_reused_imported_copies():
    storage_service = Mock()
    storage_service.load_task.return_value = {
        "metadata": {
            "source_entity_id": "src_module/src_topic/test_1",
        },
    }
    manager = AdaptiveSessionManager(
        complex_service=Mock(),
        user_progress_manager=Mock(),
        difficulty_manager=Mock(),
        storage_service=storage_service,
    )

    mode = manager._get_test_question_display_mode(
        {
            "chains": [],
            "settings": {
                "test_question_display_modes": {
                    "src_module/src_topic/test_1": "scattered",
                },
            },
        },
        "dst_module/dst_topic/copy_test_1",
    )

    assert mode == "scattered"
