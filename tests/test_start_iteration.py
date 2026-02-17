
import sys
import os
import shutil
import logging
from pathlib import Path
import json
import uuid

# Add desktop-app to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'desktop-app')))

from services.storage_service import StorageService
from services.difficulty_manager import DifficultyManager
from services.user_progress_manager import UserProgressManager
from services.complex_service import ComplexService
from services.adaptive_session_manager import AdaptiveSessionManager
from task_system.core.models.complex_models import ComplexSettings

# Setup logging
logging.basicConfig(level=logging.DEBUG, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def setup_test_env():
    """Creates a temp data directory for testing."""
    test_dir = Path("temp_test_iteration_data")
    if test_dir.exists():
        shutil.rmtree(test_dir)
    test_dir.mkdir()
    
    # Create necessary subdirs
    (test_dir / "complexes").mkdir()
    (test_dir / "users" / "test_user").mkdir(parents=True)
    (test_dir / "config").mkdir()
    
    # Create dummy difficulty config
    diff_config = {
        "levels": {
            "1": {"name": "Easy"},
            "2": {"name": "Medium"},
            "3": {"name": "Hard"}
        }
    }
    with open(test_dir / "config" / "difficulty_config.json", "w") as f:
        json.dump(diff_config, f)
        
    # We don't need to create task files because we mock load_task
    
    # Create module.json and topic.json just in case
    module = "mod1"
    topic = "topic1"
    (test_dir / "modules" / module / "topics" / topic).mkdir(parents=True, exist_ok=True)
    
    with open(test_dir / "modules" / module / "module.json", "w") as f:
        json.dump({"id": module, "name": "Test Module"}, f)
    with open(test_dir / "modules" / module / "topics" / topic / "topic.json", "w") as f:
        json.dump({"id": topic, "name": "Test Topic"}, f)
            
    return test_dir

def run_verification():
    logger.info("Starting verification for Start Iteration...")
    
    data_dir = setup_test_env()
    user_id = "test_user"
    
    try:
        # 1. Initialize Services
        logger.info("Initializing services...")
        storage_service = StorageService(str(data_dir))
        
        # MOCK load_task to avoid file system and validation issues
        original_load_task = storage_service.load_task
        def mock_load_task(module_id, topic_id, task_id):
            # Return dummy data for our test tasks
            if task_id in ["task1", "task2", "task3"]:
                return {
                    "task_data": {
                        "id": task_id,
                        "difficulty": 1,
                        "type": "theory"
                    }, 
                    "answer_key": {},
                    "metadata": {}
                }
            return None
        storage_service.load_task = mock_load_task
        
        difficulty_manager = DifficultyManager(config_path=str(data_dir / "config" / "difficulty_config.json"))
        progress_manager = UserProgressManager(str(data_dir), user_id, difficulty_manager)
        complex_service = ComplexService(str(data_dir))
        
        session_manager = AdaptiveSessionManager(
            complex_service=complex_service,
            user_progress_manager=progress_manager,
            difficulty_manager=difficulty_manager,
            storage_service=storage_service # Includes mock
        )
        
        # 2. Create a Complex
        logger.info("Creating a test complex...")
        complex_data = {
            "id": str(uuid.uuid4()),
            "name": "Test Complex",
            "description": "A test complex",
            "tasks": ["mod1/topic1/task1", "mod1/topic1/task2", "mod1/topic1/task3"],
            "settings": {
                "adaptive_difficulty": True,
                "escalation_on_success": True
            }
        }
        complex_obj = complex_service.create_complex(complex_data)
        logger.info(f"Complex created: {complex_obj.name}")
        
        # 3. TEST 1: Start Session with Default Iteration (1)
        logger.info("TEST 1: Start Session with Default Iteration (should be 1)")
        session1 = session_manager.start_session(complex_obj.id, user_id)
        logger.info(f"Session 1 Iteration: {session1.iteration}")
        
        if session1.iteration != 1:
            logger.error(f"FAILED: Expected iteration 1, got {session1.iteration}")
            sys.exit(1)
            
        # Check tasks difficulty (should be 1)
        if not session1.queue:
             logger.error(f"FAILED: Queue is empty for session 1. Broken tasks: {session1.broken_tasks}")
             sys.exit(1)
             
        for task in session1.queue:
            if task.difficulty != 1:
                 logger.error(f"FAILED: Task difficulty should be 1, got {task.difficulty}")
                 sys.exit(1)
        logger.info("PASSED: Default iteration is 1 and tasks have difficulty 1")
        
        # 4. TEST 2: Start Session with Iteration 2
        logger.info("TEST 2: Start Session with Iteration 2")
        session2 = session_manager.start_session(complex_obj.id, user_id, start_iteration=2)
        logger.info(f"Session 2 Iteration: {session2.iteration}")
        
        if session2.iteration != 2:
            logger.error(f"FAILED: Expected iteration 2, got {session2.iteration}")
            sys.exit(1)
            
        if not session2.queue:
             logger.error("FAILED: Queue is empty for session 2")
             sys.exit(1)
             
        for task in session2.queue:
            if task.difficulty != 2:
                 logger.error(f"FAILED: Task difficulty should be 2, got {task.difficulty}")
                 sys.exit(1)
        logger.info("PASSED: Iteration is 2 and tasks have difficulty 2")

        logger.info("ALL TESTS PASSED")
        
    except Exception as e:
        logger.error(f"Verification FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        # Cleanup
        if data_dir.exists():
            shutil.rmtree(data_dir)

if __name__ == "__main__":
    run_verification()
