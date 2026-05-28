import pytest
import unittest
from unittest.mock import MagicMock, patch
import json
import logging
import sys
import os

# Ensure desktop-app is in path (it should be via conftest logic, but let's be safe for direct run)
# Ensure desktop-app is in path (it should be via conftest logic, but let's be safe for direct run)
sys.path.append(os.path.join(os.getcwd(), 'desktop-app'))
# Ensure root is in path for task_system
sys.path.append(os.getcwd())

from services.adaptive_session_manager import AdaptiveSessionManager
from services.difficulty_manager import DifficultyManager
from services.complex_service import ComplexService
from services.user_progress_manager import UserProgressManager
from task_system.core.models.complex_models import Complex, ComplexSession, SessionTaskResult, QueuedTask

# Config for testing
TEST_CONFIG = {
    "version": "1.0",
    "smart_retry_defaults": {
        "near_offset": 3,
        "near_jitter_max": 0,
        "max_copies": 2,
        "training_control_enabled": True
    },
    "default_levels": {
        "test": [1, 2]
    }
}

class TestSmartRetry(unittest.TestCase):
    def setUp(self):
        # Mock dependencies
        self.complex_service = MagicMock(spec=ComplexService)
        self.user_progress_manager = MagicMock(spec=UserProgressManager)
        self.difficulty_manager = MagicMock(spec=DifficultyManager)
        
        # Setup DifficultyManager mock to return our test config
        self.difficulty_manager.config = TEST_CONFIG
        self.difficulty_manager.get_smart_retry_config.return_value = TEST_CONFIG["smart_retry_defaults"]
        self.difficulty_manager.get_available_levels.return_value = [1, 2]
        
        # Initialize Manager
        self.manager = AdaptiveSessionManager(
            complex_service=self.complex_service,
            user_progress_manager=self.user_progress_manager,
            difficulty_manager=self.difficulty_manager
        )
        
        # Create a dummy session
        self.session = MagicMock(spec=ComplexSession)
        self.session.id = "test_session"
        self.session.user_id = "test_user"
        self.session.complex_id = "test_complex"
        self.session.iteration = 1
        self.session.queue = []
        self.session.current_task_index = 0
        self.session.test_failed_subtests = {}
        self.session.deferred_retry_tasks = []
        self.session.broken_tasks = []
        self.session.error_detection_tasks = []
        self.session.completed_tasks = []
        self.session.skip_counts = {}
        self.session.iteration_timestamps = {}
        self.complex_service.get_complex.return_value = Complex(
            id="test_complex",
            name="Complex",
            tasks=[],
            settings={
                "smart_retry_near_offset": TEST_CONFIG["smart_retry_defaults"]["near_offset"],
                "smart_retry_near_jitter_max": TEST_CONFIG["smart_retry_defaults"]["near_jitter_max"],
                "smart_retry_max_copies_per_task": TEST_CONFIG["smart_retry_defaults"]["max_copies"],
                "smart_retry_training_control_enabled": TEST_CONFIG["smart_retry_defaults"]["training_control_enabled"],
            },
        )

    def test_smart_retry_config_usage(self):
        """Test that _add_failed_task_to_current_queue uses values from difficulty_manager."""
        
        # Mock methods to avoid external calls
        self.manager._get_task_type = MagicMock(return_value="click")
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.manager._rebalance_queue_tail = MagicMock()
        
        # Add 10 dummy tasks to queue so we have space to insert
        self.session.queue = [
            QueuedTask(task_ref=f"task_{i}", difficulty=1) for i in range(10)
        ]
        self.session.current_task_index = 0
        
        # Execute retry
        # Config has near_offset=3, max_copies=2
        task_ref = "failed_task"
        self.manager._add_failed_task_to_current_queue(self.session, task_ref, difficulty=2)
        
        # Verify get_smart_retry_config was called
        self.difficulty_manager.get_smart_retry_config.assert_called_once()
        
        # Check that tasks were added
        # Since difficulty=2 and training_enabled=True, we expect 2 tasks:
        # 1. lvl-1 (offset 3)
        # 2. lvl-2 (end of phase)
        
        # Find added tasks
        added_tasks = [t for t in self.session.queue if t.task_ref == task_ref and t.is_retry]
        self.assertEqual(len(added_tasks), 2)
        
        # Verify Lvl-1 is inserted near (index 0 + 3 = around 3)
        # Note: jitter is 0 in test config, so index should be exactly 3 (if no shift) or close.
        # queue was 10. +2 tasks. index 3 must be the retry task?
        # Let's check the task at index 3
        task_at_3 = self.session.queue[3]
        self.assertEqual(task_at_3.task_ref, task_ref)
        self.assertEqual(task_at_3.difficulty, 1) # Training level (2-1)

    def test_max_copies_limit(self):
        """Test that max_copies limit from config is respected."""
        
        self.manager._get_task_type = MagicMock(return_value="click")
        self.manager._get_task_phase = MagicMock(return_value=1)
        
        task_ref = "spam_task"
        
        # Simulate queue with already 2 retry copies (limit is 2)
        self.session.queue = [
            QueuedTask(task_ref="other", difficulty=1),
            QueuedTask(task_ref=task_ref, difficulty=1, is_retry=True),
            QueuedTask(task_ref=task_ref, difficulty=1, is_retry=True)
        ]
        
        initial_len = len(self.session.queue)
        
        # Try to add again
        self.manager._add_failed_task_to_current_queue(self.session, task_ref, difficulty=1)
        
        # Should not change queue length
        self.assertEqual(len(self.session.queue), initial_len)

    def test_process_test_partial_retry_success(self):
        """Test _process_test_partial_retry logic: successful partial retry."""
        
        task_ref = "test/task/1"
        
        # Scenario: User failed indices [0, 2] previously
        self.session.test_failed_subtests = {
            task_ref: [0, 2]
        }
        
        # Current result: User answered corrected [0, 2] correctly, so failed_subtests is empty in details
        # But wait, input to function is failed_subtests_raw. 
        # If user answered everything correctly in this attempt, failed_subtests_raw is empty.
        
        result = SessionTaskResult(
            task_ref=task_ref,
            success=True,
            difficulty=1,
            iteration_index=1,
            time_spent=10
        )
        
        failed_subtests_raw = [] # No failures this time
        
        returned_success = self.manager._process_test_partial_retry(
            self.session, task_ref, result, failed_subtests_raw
        )
        
        # Expectation:
        # normalized list is empty.
        # original indices exist.
        # -> All previously failed subtests are now correct.
        # -> success becomes True.
        
        self.assertTrue(returned_success)
        self.assertTrue(result.success)
        self.assertEqual(result.details["failed_subtests"], [])

    def test_process_test_partial_retry_still_failing(self):
        """Test _process_test_partial_retry logic: partial failure persists."""
        
        task_ref = "test/task/1"
        
        # Scenario: User failed [0, 2] previously.
        self.session.test_failed_subtests = {
            task_ref: [0, 2]
        }
        
        # This time, user fixed 0 but still failed 2.
        failed_subtests_raw = [{"index": 2}] 
        
        result = SessionTaskResult(
            task_ref=task_ref,
            success=False,
            difficulty=1,
            iteration_index=1,
            time_spent=10
        )
        
        returned_success = self.manager._process_test_partial_retry(
            self.session, task_ref, result, failed_subtests_raw
        )
        
        # Expectation:
        # Normalized list contains [2].
        # success remains False (or whatever passed in).
        
        self.assertFalse(returned_success)
        self.assertEqual(len(result.details["failed_subtests"]), 1)
        self.assertEqual(result.details["failed_subtests"][0]["index"], 2)

    def test_process_test_partial_retry_new_errors_ignored_in_normalization(self):
        """Test that errors NOT in original list are ignored during normalization for partial retry."""
        
        task_ref = "test/task/1"
        
        # Scenario: User failed [0] previously.
        self.session.test_failed_subtests = {
            task_ref: [0]
        }
        
        # This time, user fixed 0 but accidentally broke 5 (which was correct before).
        # Smart retry typically only asks to fix specifically failed ones. 
        # But if the UI shows all, user might break others.
        # Logic says: "normalized... - учитываем только индексы из исходного списка".
        
        failed_subtests_raw = [{"index": 5}]
        
        result = SessionTaskResult(
            task_ref=task_ref,
            success=False,
            difficulty=1,
            iteration_index=1,
            time_spent=10
        )
        
        returned_success = self.manager._process_test_partial_retry(
            self.session, task_ref, result, failed_subtests_raw
        )
        
        # Expectation:
        # Normalized list is empty (5 is not in [0]).
        # success becomes True (because original [0] is fixed, i.e. not in current failed).
        
        self.assertTrue(returned_success)
        self.assertEqual(result.details["failed_subtests"], [])

    def test_scattered_test_queue_expands_to_one_slot_per_question(self):
        task_ref = "module_01/topic_01/test_001"
        self.manager._get_task_type = MagicMock(return_value="test")
        self.manager.storage_service = MagicMock()
        self.manager.storage_service.load_task.return_value = {
            "task_data": {
                "type": "test",
                "content": {
                    "questions": [
                        {"id": "q1", "answers": []},
                        {"id": "q2", "answers": []},
                        {"id": "q3", "answers": []},
                    ]
                },
            }
        }
        complex_obj = Complex(
            id="c1",
            name="Complex",
            tasks=[task_ref],
            settings={"test_question_display_modes": {task_ref: "scattered"}},
        )

        queued = self.manager._build_queued_tasks_for_complex_task(
            complex_obj,
            task_ref,
            difficulty=1,
        )

        self.assertEqual(len(queued), 3)
        self.assertEqual([task.test_question_index for task in queued], [0, 1, 2])
        self.assertTrue(all(task.display_mode == "scattered" for task in queued))
        self.assertTrue(all(task.source_task_ref == task_ref for task in queued))

    def test_scattered_test_mode_is_forced_together_inside_chain(self):
        task_ref = "module_01/topic_01/test_001"
        self.manager._get_task_type = MagicMock(return_value="test")
        complex_obj = Complex(
            id="c1",
            name="Complex",
            tasks=[task_ref, "module_01/topic_01/task_002"],
            chains=[[task_ref, "module_01/topic_01/task_002"]],
            settings={"test_question_display_modes": {task_ref: "scattered"}},
        )

        queued = self.manager._build_queued_tasks_for_complex_task(
            complex_obj,
            task_ref,
            difficulty=1,
        )

        self.assertEqual(len(queued), 1)
        self.assertEqual(queued[0].display_mode, "together")
        self.assertIsNone(queued[0].test_question_index)

    def test_scattered_test_retry_adds_only_failed_questions(self):
        task_ref = "module_01/topic_01/test_001"
        self.complex_service.get_complex.return_value = Complex(
            id="test_complex",
            name="Complex",
            tasks=[task_ref],
            settings={
                "smart_retry_near_offset": 1,
                "smart_retry_near_jitter_max": 0,
                "smart_retry_max_copies_per_task": 10,
                "smart_retry_training_control_enabled": True,
                "test_question_display_modes": {task_ref: "scattered"},
            },
        )
        self.difficulty_manager.get_smart_retry_config.return_value = {
            "near_offset": 1,
            "near_jitter_max": 0,
            "max_copies": 10,
            "training_control_enabled": True,
        }
        self.manager._get_task_type = MagicMock(return_value="test")
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.session.queue = [QueuedTask(task_ref="other", difficulty=1)]
        self.session.current_task_index = 0

        self.manager._add_failed_task_to_current_queue(
            self.session,
            task_ref,
            difficulty=2,
            failed_question_indices=[1, 3],
            display_mode="scattered",
        )

        retry_slots = [task for task in self.session.queue if task.task_ref == task_ref]
        deferred_slots = [task for task in self.session.deferred_retry_tasks if task.task_ref == task_ref]
        self.assertEqual(len(retry_slots), 2)
        self.assertEqual(len(deferred_slots), 2)
        self.assertEqual(sorted({task.test_question_index for task in retry_slots}), [1, 3])
        self.assertEqual(sorted({task.test_question_index for task in deferred_slots}), [1, 3])
        self.assertTrue(all(task.display_mode == "scattered" for task in retry_slots + deferred_slots))

    def test_scattered_near_retry_counts_other_source_tasks_instead_of_raw_slots(self):
        task_ref = "module_01/topic_01/test_failed"
        other_scattered_ref = "module_01/topic_01/test_neighbor"
        self.complex_service.get_complex.return_value = Complex(
            id="test_complex",
            name="Complex",
            tasks=[task_ref, other_scattered_ref],
            settings={
                "smart_retry_near_offset": 2,
                "smart_retry_near_jitter_max": 0,
                "smart_retry_max_copies_per_task": 1,
                "smart_retry_training_control_enabled": False,
                "test_question_display_modes": {task_ref: "scattered", other_scattered_ref: "scattered"},
            },
        )
        self.difficulty_manager.get_smart_retry_config.return_value = {
            "near_offset": 2,
            "near_jitter_max": 0,
            "max_copies": 1,
            "training_control_enabled": False,
        }
        self.manager._get_task_type = MagicMock(return_value="test")
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.manager._rebalance_queue_tail = MagicMock()
        self.session.queue = [
            QueuedTask(
                task_ref=task_ref,
                difficulty=1,
                display_mode="scattered",
                source_task_ref=task_ref,
                test_question_index=1,
            ),
            QueuedTask(task_ref="module_01/topic_01/click_a", difficulty=1),
            QueuedTask(task_ref="module_01/topic_01/click_b", difficulty=1),
            QueuedTask(task_ref="module_01/topic_01/click_c", difficulty=1),
        ]
        self.session.current_task_index = 0

        self.manager._add_failed_task_to_current_queue(
            self.session,
            task_ref,
            difficulty=1,
            failed_question_indices=[0],
            display_mode="scattered",
        )

        inserted_index = next(
            idx for idx, task in enumerate(self.session.queue)
            if task.task_ref == task_ref and task.test_question_index == 0
        )
        self.assertEqual(inserted_index, 3)

    def test_test_retry_control_copy_moves_to_next_iteration(self):
        task_ref = "module_01/topic_01/test_001"
        self.complex_service.get_complex.return_value = Complex(
            id="test_complex",
            name="Complex",
            tasks=[task_ref],
            settings={
                "smart_retry_near_offset": 1,
                "smart_retry_near_jitter_max": 0,
                "smart_retry_max_copies_per_task": 10,
                "smart_retry_training_control_enabled": True,
                "test_question_display_modes": {task_ref: "scattered"},
            },
        )
        self.difficulty_manager.get_smart_retry_config.return_value = {
            "near_offset": 1,
            "near_jitter_max": 0,
            "max_copies": 10,
            "training_control_enabled": True,
        }
        self.manager._get_task_type = MagicMock(return_value="test")
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.manager._rebalance_queue_tail = MagicMock()
        self.session.queue = [QueuedTask(task_ref="other", difficulty=1)]
        self.session.current_task_index = 0

        self.manager._add_failed_task_to_current_queue(
            self.session,
            task_ref,
            difficulty=2,
            failed_question_indices=[1],
            display_mode="scattered",
        )

        retry_slots = [task for task in self.session.queue if task.task_ref == task_ref]
        deferred_slots = [task for task in self.session.deferred_retry_tasks if task.task_ref == task_ref]
        self.assertEqual(len(retry_slots), 1)
        self.assertEqual(retry_slots[0].difficulty, 1)
        self.assertEqual(retry_slots[0].test_question_index, 1)
        self.assertEqual(len(deferred_slots), 1)
        self.assertEqual(deferred_slots[0].difficulty, 2)
        self.assertEqual(deferred_slots[0].test_question_index, 1)

    def test_retry_insertion_rebalances_pending_tail(self):
        failed_ref = "module_01/topic_01/test_failed"
        other_ref = "module_01/topic_01/test_neighbor"
        self.difficulty_manager.get_smart_retry_config.return_value = {
            "near_offset": 0,
            "near_jitter_max": 0,
            "max_copies": 1,
            "training_control_enabled": False,
        }
        self.complex_service.get_complex.return_value = Complex(
            id="test_complex",
            name="Complex",
            tasks=[failed_ref, other_ref, "module_01/topic_01/click_a", "module_01/topic_01/click_b"],
            settings={
                "max_same_type_run": 1,
                "smart_retry_near_offset": 0,
                "smart_retry_near_jitter_max": 0,
                "smart_retry_max_copies_per_task": 1,
                "smart_retry_training_control_enabled": False,
                "test_question_display_modes": {failed_ref: "scattered", other_ref: "scattered"},
            },
        )

        def task_type(task_ref):
            return "test" if "test_" in task_ref else "click"

        self.manager._get_task_type = MagicMock(side_effect=task_type)
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.session.queue = [
            QueuedTask(
                task_ref=other_ref,
                difficulty=1,
                display_mode="scattered",
                source_task_ref=other_ref,
                test_question_index=0,
            ),
            QueuedTask(
                task_ref=other_ref,
                difficulty=1,
                display_mode="scattered",
                source_task_ref=other_ref,
                test_question_index=1,
            ),
            QueuedTask(task_ref="module_01/topic_01/click_a", difficulty=1),
            QueuedTask(task_ref="module_01/topic_01/click_b", difficulty=1),
        ]
        self.session.current_task_index = 0

        self.manager._add_failed_task_to_current_queue(
            self.session,
            failed_ref,
            difficulty=1,
            failed_question_indices=[0],
            display_mode="scattered",
        )

        tail_keys = [
            self.manager._chunk_variety_key([task])
            for task in self.session.queue[self.session.current_task_index:]
        ]
        max_run = 1
        run = 1
        max_seen_run = 1
        for prev_key, key in zip(tail_keys, tail_keys[1:]):
            if key == prev_key:
                run += 1
            else:
                run = 1
            max_seen_run = max(max_seen_run, run)
        self.assertLessEqual(max_seen_run, max_run)

    def test_rebalance_queue_tail_keeps_distant_suffix_untouched(self):
        self.manager._get_task_type = MagicMock(
            side_effect=lambda ref: "test" if ref.startswith("test_") else "click"
        )
        self.manager._get_task_phase = MagicMock(return_value=1)
        complex_obj = Complex(
            id="test_complex",
            name="Complex",
            tasks=[],
            settings={"max_same_type_run": 1},
        )
        queue = [
            QueuedTask(task_ref="test_a", difficulty=1),
            QueuedTask(task_ref="test_b", difficulty=1),
            QueuedTask(task_ref="click_a", difficulty=1),
            QueuedTask(task_ref="click_b", difficulty=1),
            QueuedTask(task_ref="suffix_1", difficulty=1),
            QueuedTask(task_ref="suffix_2", difficulty=1),
            QueuedTask(task_ref="suffix_3", difficulty=1),
        ]
        session = ComplexSession(
            id="session_suffix_scope",
            complex_id="complex_1",
            user_id="user_1",
            queue=list(queue),
        )

        original_suffix = [task.task_ref for task in session.queue[4:]]
        self.manager._rebalance_queue_tail(
            session,
            complex_obj,
            start_idx=0,
            window_size=4,
        )

        self.assertEqual([task.task_ref for task in session.queue[4:]], original_suffix)

    def test_generate_next_iteration_consumes_deferred_retry_tasks(self):
        task_ref = "module_01/topic_01/click_001"
        retry_ref = "module_01/topic_01/test_001"
        self.manager._load_task_metadata = MagicMock(return_value={})
        self.manager._is_error_detection_metadata = MagicMock(return_value=False)
        self.manager._get_task_type = MagicMock(side_effect=lambda ref: "test" if ref == retry_ref else "click")
        self.manager._get_task_phase = MagicMock(return_value=1)
        self.manager._get_task_max_level = MagicMock(return_value=1)
        self.manager._normalize_level_for_available = MagicMock(side_effect=lambda level, _levels: level)
        self.manager._next_level_for_available = MagicMock(side_effect=lambda level, _levels: level)
        self.manager._get_planned_final_iteration = MagicMock(return_value=1)
        self.manager._get_absolute_iteration_level = MagicMock(return_value=1)
        self.manager._get_error_detection_finisher_level = MagicMock(return_value=3)
        self.manager._task_participates_in_absolute_level = MagicMock(return_value=True)
        self.manager._get_iteration_target_difficulty = MagicMock(return_value=1)
        self.difficulty_manager.get_available_levels.return_value = [1]

        session = ComplexSession(
            id="session_1",
            complex_id="complex_1",
            user_id="user_1",
            iteration=1,
            current_task_index=1,
            queue=[QueuedTask(task_ref=task_ref, difficulty=1)],
            completed_tasks=[
                SessionTaskResult(
                    task_ref=task_ref,
                    success=True,
                    difficulty=1,
                    iteration_index=1,
                    time_spent=5,
                )
            ],
            deferred_retry_tasks=[
                QueuedTask(
                    task_ref=retry_ref,
                    difficulty=2,
                    is_retry=True,
                    origin_iteration=1,
                    display_mode="scattered",
                    source_task_ref=retry_ref,
                    test_question_index=2,
                )
            ],
        )
        complex_obj = Complex(
            id="complex_1",
            name="Complex",
            tasks=[task_ref],
            settings={},
        )

        self.manager._generate_next_iteration(session, complex_obj)

        self.assertEqual(session.iteration, 2)
        self.assertEqual([task.task_ref for task in session.queue], [retry_ref])
        self.assertEqual(session.queue[0].test_question_index, 2)
        self.assertEqual(session.deferred_retry_tasks, [])

    def test_place_deferred_retry_tasks_in_next_queue_uses_late_window(self):
        retry_ref = "module_01/topic_01/test_001"
        complex_obj = Complex(
            id="complex_1",
            name="Complex",
            tasks=[],
            settings={
                "smart_retry_near_offset": 2,
                "smart_retry_near_jitter_max": 0,
            },
        )
        base_queue = [
            QueuedTask(task_ref=f"click_{idx}", difficulty=1)
            for idx in range(10)
        ]
        deferred_retry = QueuedTask(
            task_ref=retry_ref,
            difficulty=2,
            is_retry=True,
            origin_iteration=1,
            display_mode="scattered",
            source_task_ref=retry_ref,
            test_question_index=3,
        )
        session = ComplexSession(
            id="session_late_window",
            complex_id="complex_1",
            user_id="user_1",
        )

        positioned = self.manager._place_deferred_retry_tasks_in_next_queue(
            list(base_queue),
            [deferred_retry],
            session,
            complex_obj,
            upcoming_iteration=2,
        )

        retry_index = next(
            idx for idx, task in enumerate(positioned)
            if task.task_ref == retry_ref and task.is_retry
        )
        self.assertGreaterEqual(retry_index, 8)
        self.assertLess(retry_index, len(positioned))

if __name__ == '__main__':
    unittest.main()
