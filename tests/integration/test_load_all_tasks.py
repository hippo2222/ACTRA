import sys
import os
import pytest
from pathlib import Path

# Add desktop-app to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
desktop_app_dir = os.path.join(project_root, 'desktop-app')
sys.path.insert(0, desktop_app_dir)
sys.path.insert(0, project_root)

try:
    from services.storage_service import StorageService
except ImportError:
    StorageService = None

@pytest.mark.integration
def test_load_all_tasks():
    if not StorageService:
        pytest.fail("Could not import StorageService")

    data_dir = os.path.join(project_root, "data")
    
    # Enable strict validation to ensure data integrity
    try:
        storage = StorageService(data_dir=data_dir, strict_validation=True)
    except Exception as e:
        pytest.fail(f"Failed to init StorageService: {e}")
    
    try:
        modules = storage.load_modules()
    except Exception as e:
        pytest.fail(f"Failed to load modules: {e}")
    
    failures = []
    total = 0
    
    for module in modules:
        module_id = module['id']
        try:
            topics = storage.get_topics(module_id)
        except Exception as e:
            failures.append(f"Failed to get topics for {module_id}: {e}")
            continue

        for topic in topics:
            topic_id = topic['id']
            try:
                tasks = storage.get_tasks(module_id, topic_id)
            except Exception as e:
                failures.append(f"Failed to get tasks for {module_id}/{topic_id}: {e}")
                continue
                
            for task_meta in tasks:
                total += 1
                task_id = task_meta['id']
                
                try:
                    task = storage.load_task(module_id, topic_id, task_id)
                    if not task or not task.get('task_data'):
                        failures.append(f"{module_id}/{topic_id}/{task_id}: Returned None or empty task_data")
                except Exception as e:
                    failures.append(f"{module_id}/{topic_id}/{task_id}: Exception {e}")

    if failures:
        pytest.fail(f"Failed to load {len(failures)} tasks out of {total}:\n" + "\n".join(failures[:20]))
    else:
        print(f"Successfully loaded {total} tasks.")
