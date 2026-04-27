import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, call


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from api.session_api import SessionAPI


def _build_api(session, *, controller=None, load_task_result=None):
    controller = controller or MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = None
    controller.task_controller.difficulty_manager = None
    controller.get_current_session_stats.return_value = {}

    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.resume_session.return_value = session
    session_manager.session_repository = MagicMock()

    storage_service = MagicMock()
    storage_service.load_task.return_value = load_task_result or {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "content": {
                "question": "Q",
                "answers": [],
            },
        },
        "answer_key": {},
    }

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage_service,
        statistics_service=MagicMock(),
    )
    return api, controller, session_manager, storage_service


def _build_session(*, current_task_index=0, queue=None, ui_state=None, complex_id="complex_1"):
    return SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id=complex_id,
        current_task_index=current_task_index,
        queue=queue or [],
        ui_state=ui_state or {},
        paused=False,
        paused_at=None,
        is_active=True,
        iteration=1,
        completed_tasks=[],
    )


def _queued_task(task_ref, *, difficulty=1, is_retry=False):
    return SimpleNamespace(
        task_ref=task_ref,
        difficulty=difficulty,
        is_retry=is_retry,
        origin_iteration=None,
        retry_variant=None,
    )


def test_resume_session_prefers_ui_state_task_ref_for_paused_restore():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001"},
    )
    api, controller, session_manager, _ = _build_api(session)

    resumed = api.resume_session("sess_1")

    assert resumed is session
    session_manager.resume_session.assert_called_once_with("sess_1", "u1", source="unknown")
    assert controller.current_session_id == "sess_1"
    assert controller.current_task_ref == "module/topic/task_001"


def test_resume_session_falls_back_to_user_inferred_from_session_id_after_restart():
    session_id = "session_real_user_1774290344.441573"
    session = _build_session(
        current_task_index=1,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001"},
    )
    session.id = session_id
    session.user_id = "real_user"

    api, controller, session_manager, _ = _build_api(session)
    api.default_user_id = "wrong_user"
    session_manager.get_session.return_value = None
    session_manager.resume_session.return_value = session
    session_manager.session_repository.load_session_by_session_id.side_effect = (
        lambda user_id, session_id: session if user_id == "real_user" else None
    )

    resumed = api.resume_session(session_id)

    assert resumed is session
    session_manager.resume_session.assert_called_once_with(
        session_id,
        "real_user",
        source="unknown",
    )
    assert controller.current_session_id == session_id
    assert controller.current_task_ref == "module/topic/task_001"


def test_get_session_marks_repository_restored_active_session_as_paused_after_restart():
    session = _build_session(
        current_task_index=1,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "last_updated": "2026-04-01T10:15:00",
        },
    )

    api, _, session_manager, _ = _build_api(session)
    session_manager._active_sessions = {}
    session_manager.get_session.return_value = None
    session_manager.session_repository.load_session_by_session_id.return_value = session

    restored = api.get_session("sess_1", user_id="u1")

    assert restored is session
    assert session.paused is True
    assert session.paused_at.isoformat() == "2026-04-01T10:15:00"
    assert session.paused_resume_target == {
        "screen_type": "task",
        "url": "/ui/session/sess_1",
        "task_ref": "module/topic/task_001",
        "task_index": 0,
    }
    session_manager.session_repository.save_session.assert_called_once_with(session, "u1")


def test_get_iteration_results_restores_session_from_repository_after_restart():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )
    session.iteration = 2

    api, controller, session_manager, _ = _build_api(session)
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])
    session_manager.get_session.return_value = None
    session_manager.session_repository.load_session_by_session_id.return_value = session

    summary = SimpleNamespace(
        iteration=1,
        total_tasks=1,
        successful_tasks=1,
        failed_tasks=0,
        success_rate=1.0,
        iteration_results=[],
    )
    session_manager.get_iteration_summary.return_value = summary

    result = api.get_iteration_results("sess_1")

    assert result is not None
    assert result["iteration"] == 1
    session_manager.restore_session.assert_called_once_with(session)
    session_manager.get_iteration_summary.assert_called_once_with("sess_1", 1)
    assert controller.current_session_id == "sess_1"
    assert controller.current_task_ref is None


def test_get_iteration_results_prefers_explicit_requested_iteration():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )
    session.iteration = 2

    api, _, session_manager, _ = _build_api(session)
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])

    summary = SimpleNamespace(
        iteration=1,
        total_tasks=1,
        successful_tasks=1,
        failed_tasks=0,
        success_rate=1.0,
        iteration_results=[],
    )
    session_manager.get_iteration_summary.return_value = summary

    result = api.get_iteration_results("sess_1", iteration_number=1)

    assert result is not None
    assert result["iteration"] == 1
    session_manager.get_iteration_summary.assert_called_once_with("sess_1", 1)


def test_get_iteration_results_enriches_image_only_test_review_with_media_items():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )

    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "meta": {"name": "Image question"},
            "content": {
                "questions": [
                    {
                        "id": "q_img",
                        "text": "Pick the wombat",
                        "answers": [
                            {"text": "", "correct": False, "image_path": "images/tiger.png"},
                            {"text": "", "correct": False, "image_path": "images/seal.png"},
                            {"text": "", "correct": False, "image_path": "images/rat.png"},
                            {"text": "", "correct": True, "image_path": "images/wombat.png"},
                        ],
                    }
                ],
            },
        },
        "answer_key": {},
    }

    api, _, session_manager, _ = _build_api(session, load_task_result=load_task_result)
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])

    summary = SimpleNamespace(
        iteration=1,
        total_tasks=1,
        successful_tasks=0,
        failed_tasks=1,
        success_rate=0.0,
        iteration_results=[
            {
                "task_ref": "module/topic/task_001",
                "success": False,
                "details": {
                    "task_type": "test",
                    "question_results": [
                        {
                            "question_id": "q_img",
                            "correct": False,
                            "user_answer": 1,
                            "correct_answer": 3,
                        }
                    ],
                    "per_question": {
                        "q_img": {
                            "status": "incorrect",
                            "correct_option_ids": [3],
                            "user_option_ids": [1],
                        }
                    },
                    "failed_subtests": [{"question_id": "q_img", "index": 0}],
                },
            }
        ],
    )
    session_manager.get_iteration_summary.return_value = summary

    result = api.get_iteration_results("sess_1")

    assert result is not None
    review = result["iteration_results"][0]["review"]
    assert review["reference_items"][0]["image_path"] == "images/wombat.png"
    assert review["user_items"][0]["image_path"] == "images/seal.png"


def test_get_iteration_results_keeps_all_failed_test_questions_in_review_entries():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )

    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "meta": {"name": "Mixed review task"},
            "content": {
                "questions": [
                    {
                        "id": "q_text",
                        "text": "Pick the correct text answer",
                        "answers": [
                            {"text": "Wrong text option", "correct": False},
                            {"text": "Correct text option", "correct": True},
                        ],
                    },
                    {
                        "id": "q_img",
                        "text": "Pick the wombat",
                        "answers": [
                            {"text": "", "correct": False, "image_path": "images/tiger.png"},
                            {"text": "", "correct": True, "image_path": "images/wombat.png"},
                        ],
                    },
                ],
            },
        },
        "answer_key": {},
    }

    api, _, session_manager, _ = _build_api(session, load_task_result=load_task_result)
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])

    summary = SimpleNamespace(
        iteration=1,
        total_tasks=1,
        successful_tasks=0,
        failed_tasks=1,
        success_rate=0.0,
        iteration_results=[
            {
                "task_ref": "module/topic/task_001",
                "success": False,
                "details": {
                    "task_type": "test",
                    "question_results": [
                        {
                            "question_id": "q_text",
                            "correct": False,
                            "user_answer": 0,
                            "correct_answer": 1,
                        },
                        {
                            "question_id": "q_img",
                            "correct": False,
                            "user_answer": 0,
                            "correct_answer": 1,
                        },
                    ],
                    "per_question": {
                        "q_text": {
                            "status": "incorrect",
                            "correct_option_ids": [1],
                            "user_option_ids": [0],
                        },
                        "q_img": {
                            "status": "incorrect",
                            "correct_option_ids": [1],
                            "user_option_ids": [0],
                        },
                    },
                    "failed_subtests": [
                        {"question_id": "q_text", "index": 0},
                        {"question_id": "q_img", "index": 1},
                    ],
                },
            }
        ],
    )
    session_manager.get_iteration_summary.return_value = summary

    result = api.get_iteration_results("sess_1")

    assert result is not None
    review = result["iteration_results"][0]["review"]
    entries = review["entries"]

    assert len(entries) == 2
    assert entries[0]["prompt"] == "Pick the correct text answer"
    assert entries[0]["user_lines"] == ["Wrong text option"]
    assert entries[0]["reference_lines"] == ["Correct text option"]
    assert entries[1]["prompt"] == "Pick the wombat"
    assert entries[1]["user_items"][0]["image_path"] == "images/tiger.png"
    assert entries[1]["reference_items"][0]["image_path"] == "images/wombat.png"


def test_get_iteration_results_scattered_test_returns_full_source_review():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )

    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "meta": {"name": "Source test"},
            "content": {
                "questions": [
                    {
                        "id": "q0",
                        "text": "Question zero",
                        "answers": [
                            {"text": "Wrong", "correct": False},
                            {"text": "Right", "correct": True},
                        ],
                    },
                    {
                        "id": "q1",
                        "text": "Question one",
                        "answers": [
                            {"text": "Right", "correct": True},
                            {"text": "Wrong", "correct": False},
                        ],
                    },
                    {
                        "id": "q2",
                        "text": "Question two",
                        "answers": [
                            {"text": "Right", "correct": True},
                            {"text": "Wrong", "correct": False},
                        ],
                    },
                ]
            },
        },
        "answer_key": {},
    }

    api, _, session_manager, _ = _build_api(session, load_task_result=load_task_result)
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])

    summary = SimpleNamespace(
        iteration=1,
        total_tasks=1,
        successful_tasks=0,
        failed_tasks=1,
        success_rate=0.0,
        iteration_results=[
            {
                "task_ref": "module/topic/task_001",
                "success": False,
                "details": {
                    "task_type": "test",
                    "test_display_mode": "scattered",
                    "show_full_source_review": True,
                    "source_task_ref": "module/topic/task_001",
                    "question_results": [
                        {
                            "question_id": "q0",
                            "index": 0,
                            "correct": False,
                            "user_answer": 0,
                            "correct_answer": 1,
                        },
                        {
                            "question_id": "q1",
                            "index": 1,
                            "correct": True,
                            "user_answer": 0,
                        },
                    ],
                    "per_question": {
                        "q0": {
                            "status": "incorrect",
                            "correct_option_ids": [1],
                            "user_option_ids": [0],
                        },
                        "q1": {
                            "status": "correct",
                            "correct_option_ids": [0],
                            "user_option_ids": [0],
                        },
                    },
                    "failed_subtests": [{"question_id": "q0", "index": 0}],
                    "shown_question_indices": [0, 1],
                },
            }
        ],
    )
    session_manager.get_iteration_summary.return_value = summary

    result = api.get_iteration_results("sess_1")

    assert result is not None
    review = result["iteration_results"][0]["review"]
    assert review["kind"] == "full_test"
    entries = review["entries"]
    assert [entry["prompt"] for entry in entries] == [
        "Question zero",
        "Question one",
        "Question two",
    ]
    assert [entry["status"] for entry in entries] == ["incorrect", "correct", "neutral"]
    assert entries[2]["user_lines"] == ["Не показывался в этой попытке."]


def test_get_resume_target_returns_iteration_results_url():
    session = _build_session(
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )
    api, _, _, _ = _build_api(session)

    target = api.get_resume_target(session)

    assert target == {
        "screen_type": "iteration_results",
        "iteration_number": 1,
        "url": "/ui/session/sess_1/iteration/1",
    }


def test_get_resume_target_prefers_explicit_paused_resume_target_snapshot():
    session = _build_session(
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_002", "task_index": 1},
    )
    session.paused_resume_target = {
        "screen_type": "iteration_results",
        "iteration_number": 1,
        "url": "/ui/session/sess_1/iteration/1",
    }
    api, _, _, _ = _build_api(session)

    target = api.get_resume_target(session)

    assert target == {
        "screen_type": "iteration_results",
        "iteration_number": 1,
        "url": "/ui/session/sess_1/iteration/1",
    }


def test_pause_session_restores_session_from_repository_before_pausing_after_restart():
    session = _build_session(
        current_task_index=1,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001", "task_index": 0},
    )
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock(return_value=True)
    session_manager.get_session.return_value = None
    session_manager.session_repository.load_session_by_session_id.return_value = session

    api.pause_session(
        "sess_1",
        user_input={"answer": "draft"},
        task_ref="module/topic/task_001",
        task_index=0,
    )

    session_manager.restore_session.assert_called_once_with(session)
    session_manager.pause_session.assert_called_once_with("sess_1")
    controller.save_ui_state.assert_called_once_with(
        "task",
        force=True,
        task_ref="module/topic/task_001",
        task_index=0,
        user_input={"answer": "draft"},
    )


def test_pause_session_keeps_iteration_results_ui_state_without_overwriting():
    session = _build_session(
        current_task_index=0,
        queue=[_queued_task("module/topic/task_002")],
        ui_state={"screen_type": "iteration_results", "iteration_number": 1},
    )
    session.iteration = 2
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock(return_value=True)

    api.pause_session("sess_1")

    controller.save_ui_state.assert_not_called()
    assert session.ui_state == {"screen_type": "iteration_results", "iteration_number": 1}
    assert session.paused_resume_target == {
        "screen_type": "iteration_results",
        "iteration_number": 1,
        "url": "/ui/session/sess_1/iteration/1",
    }
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_pause_session_replaces_stale_iteration_resume_target_with_latest_task_snapshot():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=2,
        queue=queue,
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_002", "task_index": 1},
    )
    session.paused_resume_target = {
        "screen_type": "iteration_results",
        "iteration_number": 1,
        "url": "/ui/session/sess_1/iteration/1",
    }
    api, controller, session_manager, _ = _build_api(session)

    def _save_ui_state(screen_type, **kwargs):
        session.ui_state = {
            "screen_type": screen_type,
            "task_ref": kwargs.get("task_ref"),
            "task_index": kwargs.get("task_index"),
        }
        if isinstance(kwargs.get("user_input"), dict):
            session.ui_state["user_input"] = kwargs.get("user_input")

    controller.save_ui_state = MagicMock(side_effect=_save_ui_state)

    api.pause_session(
        "sess_1",
        user_input={"answer": "draft-2"},
        task_ref="module/topic/task_002",
        task_index=1,
    )

    assert session.paused_resume_target == {
        "screen_type": "task",
        "url": "/ui/session/sess_1",
        "task_ref": "module/topic/task_002",
        "task_index": 1,
    }
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_get_current_task_restores_active_session_from_repository_after_restart():
    session = _build_session(
        current_task_index=1,
        queue=[_queued_task("module/topic/task_001")],
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001", "task_index": 0},
    )
    api, controller, session_manager, storage_service = _build_api(session)
    controller.current_session_id = None
    controller.current_task_ref = None
    session_manager.get_session.return_value = None
    session_manager.session_repository.load_session_by_session_id.return_value = session

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["queue"]["index"] == 0
    session_manager.restore_session.assert_called_once_with(session)
    assert controller.current_session_id == "sess_1"
    assert controller.current_task_ref == "module/topic/task_001"
    storage_service.load_task.assert_called_once_with("module", "topic", "task_001")


def test_get_current_task_uses_ui_state_task_ref_when_controller_is_empty():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={"screen_type": "task", "task_ref": "module/topic/task_001"},
    )
    api, controller, _, storage_service = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["task_id"] == "task_001"
    assert controller.current_task_ref == "module/topic/task_001"
    storage_service.load_task.assert_called_once_with("module", "topic", "task_001")


def test_get_current_task_falls_back_to_effective_queue_index_without_ui_state():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=2,
        queue=queue,
        ui_state={},
    )
    api, controller, _, storage_service = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_002"
    assert result["task_id"] == "task_002"
    assert controller.current_task_ref == "module/topic/task_002"
    storage_service.load_task.assert_called_once_with("module", "topic", "task_002")


def test_get_current_task_prefers_ui_state_task_index_for_duplicate_retry_slots():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
        _queued_task("module/topic/task_001", is_retry=True),
    ]
    session = _build_session(
        current_task_index=3,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 2,
        },
    )
    api, controller, _, storage_service = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["queue"]["index"] == 2
    assert result["is_retry"] is True
    assert getattr(controller, "_current_queue_index", None) == 2
    storage_service.load_task.assert_called_once_with("module", "topic", "task_001")


def test_get_current_task_returns_restored_evaluation_result_for_task_results_state():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task_results",
            "task_ref": "module/topic/task_001",
            "evaluation_result": {
                "success": True,
                "message": "Correct",
                "details": {"source": "ui_state"},
            },
            "user_input": {
                "levels": [
                    {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
                ]
            },
        },
    )
    api, controller, _, _ = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["restored_evaluation_result"]["success"] is True
    assert result["restored_evaluation_result"]["details"]["source"] == "ui_state"
    assert result["restored_user_input"] == {
        "levels": [
            {"level_id": "level_1", "blocks": ["elem_1", "elem_2"]},
        ]
    }


def test_get_current_task_prefers_session_ui_state_over_stale_controller_task_ref():
    queue = [
        _queued_task("module/topic/task_click"),
        _queued_task("module/topic/task_other"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task_results",
            "task_ref": "module/topic/task_click",
            "task_index": 0,
            "evaluation_result": {
                "success": True,
                "message": "Correct",
                "details": {"source": "ui_state"},
            },
            "user_input": {
                "clicks": [{"x": 10, "y": 12}],
                "found_targets": [0],
                "total_targets": 1,
            },
        },
    )
    api, controller, _, storage_service = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_other"

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_click"
    assert result["task_id"] == "task_click"
    assert result["restored_evaluation_result"]["success"] is True
    assert result["restored_evaluation_result"]["details"]["source"] == "ui_state"
    assert result["restored_user_input"] == {
        "clicks": [{"x": 10, "y": 12}],
        "found_targets": [0],
        "total_targets": 1,
    }
    assert controller.current_task_ref == "module/topic/task_click"
    assert getattr(controller, "_current_queue_index", None) == 0
    storage_service.load_task.assert_called_once_with("module", "topic", "task_click")


def test_get_current_task_enhances_storage_task_data_for_queue_difficulty_when_controller_is_cold():
    queue = [_queued_task("module/topic/task_click", difficulty=2)]
    session = _build_session(
        current_task_index=0,
        queue=queue,
        ui_state={},
    )
    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Find the region",
                "annotations": [],
            },
            "settings": {
                "difficulty": 1,
            },
        },
        "answer_key": {},
    }
    api, controller, _, _ = _build_api(session, load_task_result=load_task_result)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None
    controller.task_controller.current_task = None

    enhanced_task_data = {
        "type": "click",
        "_difficulty_level": 2,
        "_difficulty_enhanced": True,
        "content": {
            "prompt": "Find the region and name it",
            "annotations": [],
            "mode": "click_and_label",
            "requires_labels": True,
        },
        "settings": {
            "difficulty": 1,
        },
    }
    controller.task_controller.difficulty_manager = MagicMock()
    controller.task_controller.difficulty_manager.enhance_task_for_level.return_value = enhanced_task_data

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_click"
    assert result["difficulty"] == 2
    assert result["task_data"]["_difficulty_level"] == 2
    assert result["task_data"]["content"]["mode"] == "click_and_label"
    assert result["task_data"]["content"]["requires_labels"] is True
    controller.task_controller.difficulty_manager.enhance_task_for_level.assert_called_once_with(
        load_task_result["task_data"],
        level=2,
        task_ref="module/topic/task_click",
    )


def test_get_current_task_exposes_resolved_available_levels_and_difficulty_meta():
    queue = [_queued_task("module/topic/task_click", difficulty=3)]
    session = _build_session(
        current_task_index=0,
        queue=queue,
        ui_state={},
    )
    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "click",
            "content": {
                "prompt": "Find the region",
                "annotations": [],
            },
            "settings": {
                "allowed_difficulties": [1, 3],
            },
        },
        "answer_key": {},
    }
    api, controller, _, _ = _build_api(session, load_task_result=load_task_result)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_click"

    difficulty_meta = {
        "supported_levels": [1, 2, 3],
        "available_levels": [1, 3],
        "level_role_map": {
            "1": "basic_click",
            "2": "click_with_decoys",
            "3": "click_and_label",
        },
        "level_descriptions": {
            "1": "Find the correct region",
            "2": "Ignore distractors",
            "3": "Find and name the region",
        },
        "authoring_enabled": True,
        "progression_is_fixed": False,
    }
    controller.task_controller.difficulty_manager = MagicMock()
    controller.task_controller.difficulty_manager.enhance_task_for_level.return_value = {
        "type": "click",
        "_difficulty_level": 3,
        "_difficulty_enhanced": True,
        "content": {
            "prompt": "Find the region and name it",
            "annotations": [],
            "mode": "click_and_label",
            "requires_labels": True,
        },
        "settings": {
            "allowed_difficulties": [1, 3],
        },
    }
    controller.task_controller.difficulty_manager.get_available_levels.return_value = [1, 3]
    controller.task_controller.difficulty_manager.get_task_difficulty_metadata.return_value = difficulty_meta

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_click"
    assert result["difficulty"] == 3
    assert result["available_levels"] == [1, 3]
    assert result["difficulty_meta"] == difficulty_meta
    controller.task_controller.difficulty_manager.get_available_levels.assert_called_once()
    available_levels_call = controller.task_controller.difficulty_manager.get_available_levels.call_args
    assert available_levels_call.args == ("click",)
    assert available_levels_call.kwargs["task_ref"] == "module/topic/task_click"
    assert available_levels_call.kwargs["subtype"] is None
    assert available_levels_call.kwargs["task_data"]["type"] == "click"
    assert available_levels_call.kwargs["task_data"]["settings"]["allowed_difficulties"] == [1, 3]
    assert available_levels_call.kwargs["task_data"]["_difficulty_level"] == 3
    controller.task_controller.difficulty_manager.get_task_difficulty_metadata.assert_called_once_with(
        "click",
        None,
    )


def test_get_current_task_returns_restored_user_input_for_task_state():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    restored_user_input = {
        "levels": [
            {"level_id": "level_1", "blocks": ["elem_1"]},
            {"level_id": "level_2", "blocks": ["elem_2"]},
        ]
    }
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": restored_user_input,
        },
    )
    api, controller, _, _ = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["restored_evaluation_result"] is None
    assert result["restored_user_input"] == restored_user_input


def test_get_current_task_falls_back_to_completed_task_result_when_ui_state_has_no_evaluation():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": {
                "clicks": [{"x": 10, "y": 10}],
                "found_targets": [0],
            },
        },
    )
    session.completed_tasks = [
        SimpleNamespace(
            task_ref="module/topic/task_001",
            success=True,
            message="Correct",
            details={"found_targets": [0], "source": "completed_tasks"},
            iteration_index=1,
        )
    ]
    api, controller, _, _ = _build_api(session)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["task_ref"] == "module/topic/task_001"
    assert result["restored_evaluation_result"]["success"] is True
    assert result["restored_evaluation_result"]["details"]["source"] == "completed_tasks"
    assert result["restored_user_input"] == {
        "clicks": [{"x": 10, "y": 10}],
        "found_targets": [0],
    }


def test_pause_session_persists_current_task_input_before_pausing():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
    )
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock()

    user_input = {
        "levels": [
            {"level_id": "level_1", "blocks": ["elem_1"]},
        ]
    }

    api.pause_session("sess_1", user_input=user_input)

    controller.save_ui_state.assert_called_once_with(
        "task",
        force=True,
        task_ref="module/topic/task_001",
        task_index=0,
        user_input=user_input,
    )
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_pause_session_does_not_preserve_stale_results_without_explicit_evaluation_result():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    evaluation_result = {
        "success": False,
        "message": "Wrong",
        "details": {"found_targets": [0]},
    }
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task_results",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "evaluation_result": evaluation_result,
            "user_input": {"clicks": [{"x": 10, "y": 10}]},
        },
    )
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock()

    paused_user_input = {
        "clicks": [{"x": 10, "y": 10}],
        "found_targets": [0],
    }

    api.pause_session("sess_1", user_input=paused_user_input)

    controller.save_ui_state.assert_called_once_with(
        "task",
        force=True,
        task_ref="module/topic/task_001",
        task_index=0,
        user_input=paused_user_input,
    )
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_pause_session_uses_explicit_evaluation_result_to_preserve_checked_screen():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    explicit_evaluation_result = {
        "success": True,
        "message": "Correct",
        "details": {"found_targets": [0], "source": "pause_payload"},
    }
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": {"clicks": [{"x": 10, "y": 10}]},
        },
    )
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock()

    paused_user_input = {
        "clicks": [{"x": 10, "y": 10}],
        "found_targets": [0],
    }

    api.pause_session(
        "sess_1",
        user_input=paused_user_input,
        evaluation_result=explicit_evaluation_result,
    )

    controller.save_ui_state.assert_called_once_with(
        "task_results",
        force=True,
        task_ref="module/topic/task_001",
        task_index=0,
        user_input=paused_user_input,
        evaluation_result=explicit_evaluation_result,
    )
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_pause_session_prefers_explicit_task_slot_over_stale_ui_state():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=2,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
    )
    api, controller, session_manager, _ = _build_api(session)
    controller.save_ui_state = MagicMock()

    paused_user_input = {
        "answer": "draft",
    }

    api.pause_session(
        "sess_1",
        user_input=paused_user_input,
        task_ref="module/topic/task_002",
        task_index=1,
    )

    controller.save_ui_state.assert_called_once_with(
        "task",
        force=True,
        task_ref="module/topic/task_002",
        task_index=1,
        user_input=paused_user_input,
    )
    session_manager.pause_session.assert_called_once_with("sess_1")


def test_pause_resume_get_current_task_keeps_explicit_slot_snapshot():
    queue = [
        _queued_task("module/topic/task_001"),
        _queued_task("module/topic/task_002"),
    ]
    session = _build_session(
        current_task_index=2,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": {"answer": "stale"},
        },
    )
    api, controller, session_manager, storage_service = _build_api(session)

    def _save_ui_state(screen_type, **kwargs):
        next_ui_state = {
            "screen_type": screen_type,
            "task_ref": kwargs.get("task_ref"),
            "task_index": kwargs.get("task_index"),
        }
        if "user_input" in kwargs:
            next_ui_state["user_input"] = kwargs.get("user_input")
        if "evaluation_result" in kwargs:
            next_ui_state["evaluation_result"] = kwargs.get("evaluation_result")
        if "view_state" in kwargs:
            next_ui_state["view_state"] = kwargs.get("view_state")
        session.ui_state = next_ui_state
        return True

    controller.save_ui_state = MagicMock(side_effect=_save_ui_state)

    def _pause_session(_session_id):
        session.paused = True

    def _resume_session(_session_id, _user_id, source=None):
        session.paused = False
        return session

    session_manager.pause_session.side_effect = _pause_session
    session_manager.resume_session.side_effect = _resume_session

    paused_user_input = {
        "answer": "fresh draft",
    }

    api.pause_session(
        "sess_1",
        user_input=paused_user_input,
        task_ref="module/topic/task_002",
        task_index=1,
    )

    resumed = api.resume_session("sess_1")
    result = api.get_current_task("sess_1")

    assert resumed is session
    assert session.ui_state["task_ref"] == "module/topic/task_002"
    assert session.ui_state["task_index"] == 1
    assert session.ui_state["user_input"] == paused_user_input
    assert result is not None
    assert result["task_ref"] == "module/topic/task_002"
    assert result["queue"]["index"] == 1
    assert result["restored_user_input"] == paused_user_input
    assert controller.current_task_ref == "module/topic/task_002"
    assert getattr(controller, "_current_queue_index", None) == 1
    storage_service.load_task.assert_called_once_with("module", "topic", "task_002")


def test_pause_resume_get_current_task_clears_stale_results_for_in_progress_task():
    queue = [
        _queued_task("module/topic/task_001"),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task_results",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": {"answer": "old checked answer"},
            "view_state": {"comparison_view": "reference"},
            "evaluation_result": {
                "success": False,
                "message": "Old result",
            },
        },
    )
    api, controller, session_manager, storage_service = _build_api(session)

    def _save_ui_state(screen_type, **kwargs):
        next_ui_state = {
            "screen_type": screen_type,
            "task_ref": kwargs.get("task_ref"),
            "task_index": kwargs.get("task_index"),
        }
        if "user_input" in kwargs:
            next_ui_state["user_input"] = kwargs.get("user_input")
        if "evaluation_result" in kwargs:
            next_ui_state["evaluation_result"] = kwargs.get("evaluation_result")
        if "view_state" in kwargs:
            next_ui_state["view_state"] = kwargs.get("view_state")
        session.ui_state = next_ui_state
        return True

    controller.save_ui_state = MagicMock(side_effect=_save_ui_state)

    def _pause_session(_session_id):
        session.paused = True

    def _resume_session(_session_id, _user_id, source=None):
        session.paused = False
        return session

    session_manager.pause_session.side_effect = _pause_session
    session_manager.resume_session.side_effect = _resume_session

    paused_user_input = {
        "answer": "fresh draft",
    }
    paused_view_state = {
        "scrollTop": 72,
    }

    api.pause_session(
        "sess_1",
        user_input=paused_user_input,
        view_state=paused_view_state,
    )

    resumed = api.resume_session("sess_1")
    result = api.get_current_task("sess_1")

    assert resumed is session
    assert session.ui_state["screen_type"] == "task"
    assert session.ui_state["task_ref"] == "module/topic/task_001"
    assert session.ui_state["task_index"] == 0
    assert session.ui_state["user_input"] == paused_user_input
    assert session.ui_state["view_state"] == paused_view_state
    assert "evaluation_result" not in session.ui_state
    assert result is not None
    assert result["restored_user_input"] == paused_user_input
    assert result["restored_view_state"] == paused_view_state
    assert result["restored_evaluation_result"] is None
    storage_service.load_task.assert_called_once_with("module", "topic", "task_001")


def test_get_current_task_partial_retry_uses_shuffled_failed_question_after_shuffle():
    queue = [
        _queued_task("module/topic/task_001", is_retry=True),
    ]
    session = _build_session(
        current_task_index=1,
        queue=queue,
        ui_state={
            "screen_type": "task",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
        },
    )
    session.test_failed_subtests = {"module/topic/task_001": [1]}
    session.test_shuffle = {
        "module/topic/task_001@1": {
            "question_order": [1, 0],
            "answer_order_by_question": {},
        }
    }

    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {"id": 0, "text": "First original question", "answers": [{"text": "A"}]},
                    {"id": 1, "text": "Second original question", "answers": [{"text": "B"}]},
                ],
            },
        },
        "answer_key": {},
    }

    api, controller, _, _ = _build_api(session, load_task_result=load_task_result)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    questions = result["task_data"]["content"]["questions"]
    assert len(questions) == 1
    assert questions[0]["id"] == 0
    assert questions[0]["text"] == "First original question"


def test_get_current_task_remaps_restored_test_answers_and_feedback_for_shuffle():
    queue = [
        _queued_task("module/topic/task_001"),
    ]
    session = _build_session(
        current_task_index=0,
        queue=queue,
        ui_state={
            "screen_type": "task_results",
            "task_ref": "module/topic/task_001",
            "task_index": 0,
            "user_input": {
                "answers": {"q_img": 0},
                "text_answers": {},
            },
            "evaluation_result": {
                "success": False,
                "message": "❌ Есть ошибки: 1 из 1 с ошибкой, верно 0",
                "details": {
                    "per_question": {
                        "q_img": {
                            "status": "incorrect",
                            "correct_option_ids": [1],
                            "user_option_ids": [0],
                        }
                    }
                },
            },
        },
    )
    session.test_shuffle = {
        "module/topic/task_001@1": {
            "question_order": [0],
            "answer_order_by_question": {
                "0": [1, 0],
            },
        }
    }

    load_task_result = {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "content": {
                "questions": [
                    {
                        "id": "q_img",
                        "text": "Pick the image",
                        "answers": [
                            {"text": "Correct", "correct": True, "image_path": "img/correct.png"},
                            {"text": "Wrong", "correct": False, "image_path": "img/wrong.png"},
                        ],
                    }
                ],
                "settings": {
                    "shuffle_answers": True,
                    "shuffle_questions": True,
                },
            },
        },
        "answer_key": {},
    }

    api, controller, _, _ = _build_api(session, load_task_result=load_task_result)
    controller.current_session_id = "sess_1"
    controller.current_task_ref = None

    result = api.get_current_task("sess_1")

    assert result is not None
    assert result["restored_user_input"]["answers"]["q_img"] == 1
    per_question_ui = result["restored_evaluation_result"]["details"]["per_question_ui"]["q_img"]
    assert per_question_ui["user_option_ids"] == [1]
    assert per_question_ui["correct_option_ids"] == [0]


def test_get_final_results_includes_problem_tasks_payload():
    failed_result = SimpleNamespace(
        task_ref="module/topic/task_002",
        success=False,
        details={},
        timestamp=None,
        iteration_index=1,
        difficulty=1,
    )
    successful_result = SimpleNamespace(
        task_ref="module/topic/task_001",
        success=True,
        details={},
        timestamp=None,
        iteration_index=1,
        difficulty=1,
    )
    session = _build_session(
        current_task_index=0,
        queue=[],
        ui_state={},
    )
    session.completed_tasks = [successful_result, failed_result]

    controller = MagicMock()
    controller.current_session_id = None
    controller.current_task_ref = None
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = None
    controller.get_current_session_stats.return_value = {}

    summary = SimpleNamespace(
        session_id="sess_1",
        complex_id="complex_1",
        user_id="u1",
        total_iterations=1,
        tasks_mastered_count=1,
        tasks_failed_count=1,
        difficulty_progression=[1.0],
        total_tasks=2,
        successful_tasks_count=1,
        iteration_durations=[],
    )

    session_manager = MagicMock()
    session_manager.end_session.return_value = summary
    session_manager.get_session.return_value = session
    session_manager.session_repository = MagicMock()

    storage_service = MagicMock()
    storage_service.load_task.side_effect = lambda module_id, topic_id, task_id: {
        "task_dir": "D:/tmp/task",
        "task_data": {
            "type": "test",
            "meta": {
                "name": f"Name for {task_id}",
            },
        },
        "answer_key": {},
    }

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage_service,
        statistics_service=MagicMock(),
    )

    result = api.get_final_results("sess_1")

    assert result is not None
    assert result["tasks_failed_count"] == 1
    assert len(result["problem_tasks"]) == 1
    assert result["problem_tasks"][0]["task_ref"] == "module/topic/task_002"
    assert result["problem_tasks"][0]["task_name"] == "Name for task_002"
    assert result["problem_tasks"][0]["errors"] == 1
