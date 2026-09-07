import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
import unittest

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from api.session_api import SessionAPI


def _build_session(*, current_task_index=0, queue=None, ui_state=None, complex_id="complex_1"):
    return SimpleNamespace(
        id="sess_1",
        user_id="u1",
        complex_id=complex_id,
        current_task_index=current_task_index,
        queue=queue or [],
        ui_state=ui_state or {"screen_type": "iteration_results", "iteration_number": 1},
        paused=False,
        paused_at=None,
        is_active=True,
        iteration=1,
        completed_tasks=[],
    )


def _queued_task(task_ref, *, difficulty=1):
    return SimpleNamespace(
        task_ref=task_ref,
        difficulty=difficulty,
        is_retry=False,
        origin_iteration=None,
        retry_variant=None,
    )


def _build_api(session, *, load_task_result=None):
    controller = MagicMock()
    controller.current_session_id = "sess_1"
    controller.current_task_ref = "module/topic/task_click_001"
    controller.task_controller = MagicMock()
    controller.task_controller.current_task = None
    controller.task_controller.difficulty_manager = None
    controller.get_current_session_stats.return_value = {}

    session_manager = MagicMock()
    session_manager.get_session.return_value = session
    session_manager.resume_session.return_value = session
    session_manager.session_repository = MagicMock()

    storage_service = MagicMock()
    storage_service.load_task.return_value = load_task_result

    api = SessionAPI(
        session_controller=controller,
        adaptive_session_manager=session_manager,
        complex_service=MagicMock(),
        storage_service=storage_service,
        statistics_service=MagicMock(),
    )
    api._build_iterations_for_web = MagicMock(return_value=[])
    api._build_problem_tasks_for_web = MagicMock(return_value=[])
    return api, controller, session_manager, storage_service


class TestSessionAPIClickReview(unittest.TestCase):
    def test_get_iteration_results_click_generates_click_comparison(self):
        task_ref = "module/topic/task_click_001"
        session = _build_session(
            current_task_index=0,
            queue=[_queued_task(task_ref, difficulty=2)],
        )

        load_task_result = {
            "task_dir": "D:/tmp/task",
            "task_data": {
                "type": "click",
                "name": "Click Task 1",
                "content": {
                    "prompt": "Find anatomical structures",
                    "image_url": "/api/assets/heart-1/content",
                },
                "answer_key": {
                    "targets": [
                        {"shape": "polygon", "points": [[100, 100], [200, 100], [200, 200], [100, 200]], "label": "Right Ventricle"},
                        {"shape": "point", "point": [300, 300], "label": "Ascending Aorta"},
                    ]
                }
            },
            "answer_key": {},
        }

        api, _, session_manager, _ = _build_api(session, load_task_result=load_task_result)

        summary = SimpleNamespace(
            iteration=1,
            total_tasks=1,
            successful_tasks=0,
            failed_tasks=1,
            success_rate=0.0,
            iteration_results=[
                {
                    "task_ref": task_ref,
                    "success": False,
                    "details": {
                        "task_type": "click",
                        "clicks": [{"x": 120, "y": 140}, {"x": 50, "y": 50}],
                        "targets_info": [
                            {"index": 0, "label": "Right Ventricle", "found": True, "matched_click_idx": 0},
                            {"index": 1, "label": "Ascending Aorta", "found": False, "matched_click_idx": None},
                        ],
                        "found_targets": [0],
                    },
                }
            ],
        )
        session_manager.get_iteration_summary.return_value = summary

        result = api.get_iteration_results("sess_1")
        self.assertIsNotNone(result)
        self.assertIn("iteration_results", result)
        review = result["iteration_results"][0]["review"]

        self.assertIn("user_items", review)
        self.assertIn("reference_items", review)

        user_items = review["user_items"]
        self.assertEqual(len(user_items), 1)
        self.assertEqual(user_items[0]["type"], "click_comparison")
        self.assertEqual(user_items[0]["image_url"], "/api/assets/heart-1/content")
        self.assertEqual(len(user_items[0]["clicks"]), 2)
        self.assertTrue(user_items[0]["is_user"])

        ref_items = review["reference_items"]
        self.assertEqual(len(ref_items), 1)
        self.assertEqual(ref_items[0]["type"], "click_comparison")
        self.assertEqual(ref_items[0]["image_url"], "/api/assets/heart-1/content")
        self.assertEqual(len(ref_items[0]["targets"]), 2)
        self.assertFalse(ref_items[0]["is_user"])

    def test_get_iteration_results_click_fallback_when_no_image(self):
        task_ref = "module/topic/task_click_no_img"
        session = _build_session(
            current_task_index=0,
            queue=[_queued_task(task_ref, difficulty=1)],
        )

        load_task_result = {
            "task_dir": "D:/tmp/task",
            "task_data": {
                "type": "click",
                "name": "Click Task No Img",
                "content": {
                    "prompt": "Find Target",
                },
                "answer_key": {
                    "targets": [
                        {"shape": "point", "point": [10, 10], "label": "Target A"},
                    ]
                }
            },
            "answer_key": {},
        }

        api, _, session_manager, _ = _build_api(session, load_task_result=load_task_result)

        summary = SimpleNamespace(
            iteration=1,
            total_tasks=1,
            successful_tasks=0,
            failed_tasks=1,
            success_rate=0.0,
            iteration_results=[
                {
                    "task_ref": task_ref,
                    "success": False,
                    "details": {
                        "task_type": "click",
                        "clicks": [{"x": 10, "y": 10}],
                        "targets_info": [
                            {"index": 0, "label": "Target A", "found": False, "matched_click_idx": None},
                        ],
                    },
                }
            ],
        )
        session_manager.get_iteration_summary.return_value = summary

        result = api.get_iteration_results("sess_1")
        self.assertIsNotNone(result)
        review = result["iteration_results"][0]["review"]
        self.assertNotIn("user_items", review)
        self.assertIn("user_lines", review)
        self.assertIn("reference_lines", review)


if __name__ == "__main__":
    unittest.main()
