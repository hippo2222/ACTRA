
"""
Integration tests for Complex History API endpoints.
"""

import pytest
import json
import time

TEST_COMPLEX_PREFIX = "history-api-test"


@pytest.fixture
def client(clean_context):
    import sys
    import os
    # Add root dir to path to import server
    sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '../../')))
    from server import app
    app.config['TESTING'] = True
    return app.test_client()

@pytest.fixture
def clean_context():
    """Ensure test environment is clean."""
    from pathlib import Path
    import shutil
    
    # Define paths (assuming standard data layout)
    # We need to find the data dir relative to this test file or from the app config if possible
    # But since we don't have easy access to app object here (client is separate fixture),
    # let's assume relative path to data dir as used in client fixture.
    
    data_dir = Path(__file__).parent.parent.parent.parent / "data"
    complex_file = data_dir / "complexes" / "history-api-test.json" # Not used by ComplexService!
    # ComplexService uses a SINGLE complexes.json file!
    
    # Wait, ComplexService implementation:
    # self.complexes_file = self.complexes_dir / "complexes.json"
    # It stores ALL complexes in ONE file!
    
    complexes_json = data_dir / "complexes" / "complexes.json"
    history_root = data_dir / "complexes" / "history"
    
    # Cleanup before test
    if complexes_json.exists():
        try:
             with open(complexes_json, 'r', encoding='utf-8') as f:
                data = json.load(f)
             
             # Filter out any history-api-test* complexes
             original_len = len(data)
             data = [c for c in data if not str(c.get('id', '')).startswith(TEST_COMPLEX_PREFIX)]
             
             if len(data) < original_len:
                 with open(complexes_json, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
        except Exception:
            pass

    if history_root.exists():
        for candidate in history_root.glob(f"{TEST_COMPLEX_PREFIX}*"):
            if candidate.is_dir():
                shutil.rmtree(candidate)

    
    yield
    
    # Cleanup after test
    # (Same logic)
    if complexes_json.exists():
        try:
             with open(complexes_json, 'r', encoding='utf-8') as f:
                data = json.load(f)
             data = [c for c in data if not str(c.get('id', '')).startswith(TEST_COMPLEX_PREFIX)]
             with open(complexes_json, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
        except Exception:
            pass

    if history_root.exists():
        for candidate in history_root.glob(f"{TEST_COMPLEX_PREFIX}*"):
            if candidate.is_dir():
                shutil.rmtree(candidate)

def test_history_workflow(client, clean_context):
    """Test full history workflow via API."""
    complex_id = f"{TEST_COMPLEX_PREFIX}-{int(time.time() * 1000)}"
    
    # 1. Create Complex
    create_payload = {
        "id": complex_id,
        "name": "Version 1",
        "description": "Desc 1",
        "tasks": ["module_01/topic_01/task_001"],
        "chains": []
    }
    resp = client.post("/api/complexes", json=create_payload)
    assert resp.status_code == 200
    
    # 2. Update Complex (creates snapshot of V1)
    update_payload_1 = {
        "name": "Version 2",
        "description": "Desc 2",
        "tasks": ["module_01/topic_01/task_001"]
    }
    # Need to get current version for optimistic locking if enabled, 
    # but here we can just update if we don't send expected_version (force update)
    # or we can send it. Let's send it to be proper.
    
    # Get current version
    get_resp = client.get(f"/api/complexes/{complex_id}")
    v1_timestamp = get_resp.json["item"]["updated_at"]
    
    update_payload_1["expected_version"] = v1_timestamp
    
    resp = client.put(f"/api/complexes/{complex_id}", json=update_payload_1)
    assert resp.status_code == 200
    assert resp.json["item"]["name"] == "Version 2"
    
    # 3. Update Again (creates snapshot of V2)
    v2_timestamp = resp.json["item"]["updated_at"]
    update_payload_2 = {
        "name": "Version 3",
        "tasks": ["module_01/topic_01/task_001"]
    }
    update_payload_2["expected_version"] = v2_timestamp
    
    resp = client.put(f"/api/complexes/{complex_id}", json=update_payload_2)
    assert resp.status_code == 200
    
    # 4. Get History
    resp = client.get(f"/api/complexes/{complex_id}/history")
    assert resp.status_code == 200
    history = resp.json["history"]
    
    # Should have 2 snapshots: V2 and V1
    assert len(history) == 2
    assert history[0]["name"] == "Version 2"
    assert history[1]["name"] == "Version 1"
    
    # 5. Restore V1
    snapshot_v1 = history[1]
    ts_v1 = snapshot_v1["_snapshot_timestamp"]
    
    resp = client.post(f"/api/complexes/{complex_id}/restore/{ts_v1}")
    assert resp.status_code == 200
    assert resp.json["item"]["name"] == "Version 1"
    
    # 6. Verify restoration
    get_resp = client.get(f"/api/complexes/{complex_id}")
    assert get_resp.json["item"]["name"] == "Version 1"
    
    # 7. Check history again (should now include V3 snapshot before restore)
    resp = client.get(f"/api/complexes/{complex_id}/history")
    history = resp.json["history"]
    assert len(history) == 3
    assert history[0]["name"] == "Version 3"

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
