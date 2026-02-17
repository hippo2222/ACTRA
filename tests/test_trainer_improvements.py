
import unittest
import sys
import os
from pathlib import Path

# Add project root to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../desktop-app')))

from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import QueuedTask, Complex, ComplexSession

class TestTrainerImprovements(unittest.TestCase):
    def setUp(self):
        # Mock dependencies
        self.manager = AdaptiveSessionManager(
            complex_service=MagicMock(),
            user_progress_manager=MagicMock(),
            difficulty_manager=MagicMock()
        )
        # Mock _get_task_type to control phase logic without files
        self.manager._get_task_type = MagicMock()
        
    def test_chains(self):
        print("\nTesting Chains...")
        # Create tasks
        tasks = [
            QueuedTask(task_ref="t1", difficulty=1),
            QueuedTask(task_ref="t2", difficulty=1),
            QueuedTask(task_ref="t3", difficulty=1),
            QueuedTask(task_ref="t4", difficulty=1),
        ]
        
        # Chain t2 and t3
        chains = [["t2", "t3"]]
        
        chunks = self.manager._group_tasks_into_chunks(tasks, chains)
        
        # Expect 3 chunks: [t1], [t2, t3], [t4] (order might vary except chain)
        self.assertEqual(len(chunks), 3)
        
        chain_chunk = None
        for c in chunks:
            if len(c) == 2:
                chain_chunk = c
                break
        
        self.assertIsNotNone(chain_chunk)
        self.assertEqual(chain_chunk[0].task_ref, "t2")
        self.assertEqual(chain_chunk[1].task_ref, "t3")
        print("Chains verified.")

    def test_phases(self):
        print("\nTesting Phases...")
        # Define tasks with different expected phases
        # Warmup: Lvl 1 Click
        # Main: Lvl 2 Click
        # Finisher: Open Answer
        
        t_warmup = QueuedTask(task_ref="warmup", difficulty=1)
        t_main = QueuedTask(task_ref="main", difficulty=2)
        t_finisher = QueuedTask(task_ref="finisher", difficulty=1)
        
        self.manager._get_task_type.side_effect = lambda ref: {
            "warmup": "click",
            "main": "click",
            "finisher": "open_answer"
        }[ref]
        
        # Create chunks
        chunks = [[t_finisher], [t_warmup], [t_main]]
        
        sorted_queue = self.manager._sort_chunks_by_phase(chunks)
        
        # Expect order: Warmup -> Main -> Finisher
        self.assertEqual(sorted_queue[0].task_ref, "warmup")
        self.assertEqual(sorted_queue[1].task_ref, "main")
        self.assertEqual(sorted_queue[2].task_ref, "finisher")
        print("Phases verified.")

    def test_smart_retry(self):
        print("\nTesting Smart Retry...")
        # Setup session with a queue of phases: [Warmup, Main, Main, Finisher]
        # Queue: [W1, M1, M2, F1]
        session = ComplexSession(id="test", complex_id="test", user_id="test")
        
        w1 = QueuedTask(task_ref="w1", difficulty=1) # Phase 0
        m1 = QueuedTask(task_ref="m1", difficulty=2) # Phase 1
        m2 = QueuedTask(task_ref="m2", difficulty=2) # Phase 1
        f1 = QueuedTask(task_ref="f1", difficulty=1) # Phase 2 (open_answer)
        
        session.queue = [w1, m1, m2, f1]
        
        self.manager._get_task_type.side_effect = lambda ref: {
            "w1": "click",
            "m1": "click",
            "m2": "click",
            "f1": "open_answer"
        }.get(ref, "click") # default click
        
        # Simulate User is at index 1 (m1) and fails it
        session.current_task_index = 1
        
        # Fail m1 (Lvl 2)
        # Expect:
        # - Lvl 1 copy at index + 2 => 1 + 2 = 3. 
        #   Current queue: 0:w1, 1:m1, 2:m2, 3:f1
        #   Insert at 3 => Before f1.
        # - Lvl 2 copy at End of Phase 1.
        #   Phase 1 ends after m2 (index 2). Next task f1 starts Phase 2 at index 3.
        #   So insertion point is 3.
        #   Since we inserted Lvl 1 copy at 3, indices shift.
        #   New Queue state after step 1: 0:w1, 1:m1, 2:m2, 3:m1_lvl1, 4:f1
        #   End of Phase 1 was at original index 3 (start of f1).
        #   But scanning logic runs fresh inside the method.
        
        self.manager._add_failed_task_to_current_queue(session, "m1", 2)
        
        # Let's verify positions
        # Expected Queue:
        # 0: w1
        # 1: m1 (failed one)
        # 2: m2
        # 3: m1 (lvl 1 - training)
        # 4: m1 (lvl 2 - control)
        # 5: f1
        
        refs = [t.task_ref for t in session.queue]
        diffs = [t.difficulty for t in session.queue]
        
        print(f"Resulting queue: {list(zip(refs, diffs))}")
        
        self.assertEqual(refs[3], "m1")
        self.assertEqual(diffs[3], 1) # Training
        
        self.assertEqual(refs[4], "m1") 
        self.assertEqual(diffs[4], 2) # Control
        
        self.assertEqual(refs[5], "f1") # Finisher pushed back
        print("Smart Retry verified.")

from unittest.mock import MagicMock
if __name__ == '__main__':
    unittest.main()
