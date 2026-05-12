import json
import os
import sys
import logging
from pathlib import Path

# Add project root to sys.path
sys.path.append('/app/desktop-app')
sys.path.append('/app')

from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import Complex, ComplexSession, QueuedTask
from services.hosted_complex_service import HostedComplexService
from services.hosted_storage_service import HostedStorageService
from persistence.runtime import resolve_persistence_runtime_settings

# Mock dependencies
class MockUserProgressManager:
    def __init__(self):
        self.user_id = "debug_user"
        self.data_dir = "/app/data"
        self.difficulty_manager = None
        self.event_bus = None
        self.persistence_settings = None
    def get_mastery(self, task_ref): return 0.5
    def get_all_masteries(self): return {}

class MockDifficultyManager:
    def get_difficulty(self, task_ref): return 1 # INT
    def get_available_levels(self, task_type, task_ref): return [1, 2, 3]

def main():
    logging.basicConfig(level=logging.INFO)
    
    settings = resolve_persistence_runtime_settings(
        data_root=Path("/app/data"),
        project_root=Path("/app")
    )
    
    complex_service = HostedComplexService(data_dir="/app/data", persistence_settings=settings)
    storage_service = HostedStorageService(data_dir="/app/data", persistence_settings=settings)
    
    asm = AdaptiveSessionManager(
        complex_service=complex_service,
        user_progress_manager=MockUserProgressManager(),
        difficulty_manager=MockDifficultyManager(),
        storage_service=storage_service,
        session_repository=None
    )
    
    complex_id = 'd91ad43f-98be-4a7d-8e16-e43cfbf371c0'
    complex_obj = complex_service.get_complex(complex_id)
    if not complex_obj:
        print(f"Complex {complex_id} not found")
        return

    print(f"Testing FULL queue generation for: {complex_obj.name}")
    
    # Create a dummy session
    session = ComplexSession(
        id="debug_session",
        complex_id=complex_id,
        user_id="debug_user",
        iterations=[]
    )
    
    # Generate queue (modifies session.queue in place)
    asm._generate_initial_queue(session, complex_obj, target_iteration=1)
    
    queue = session.queue
    print(f"Total queue length: {len(queue)}")
    
    # Check first 100 tasks (to see interleaving)
    print("First 100 tasks in queue:")
    for i, qt in enumerate(queue[:100]):
        q_idx = getattr(qt, 'test_question_index', None)
        mode = qt.display_mode
        print(f"{i+1:3d}. {qt.task_ref} | Mode: {mode:9s} | Q_idx: {q_idx}")

    # Verify if we have consecutive tasks from the same scattered task
    duplicates = 0
    for i in range(len(queue) - 1):
        if queue[i].task_ref == queue[i+1].task_ref and queue[i].display_mode == "scattered":
            duplicates += 1
    
    print(f"Consecutive scattered task duplicates: {duplicates}")

if __name__ == "__main__":
    main()
