
"""
Unit tests for ComplexService history feature.
"""

import pytest
import json
import time
import tempfile
import shutil
from pathlib import Path
from services.complex_service import ComplexService

@pytest.fixture
def temp_data_dir():
    """Create a temporary data directory for testing."""
    base = tempfile.mkdtemp()
    data_dir = Path(base) / "data"
    data_dir.mkdir()
    yield str(data_dir)
    shutil.rmtree(base, ignore_errors=True)

@pytest.fixture
def complex_service(temp_data_dir):
    """Create a ComplexService instance for testing."""
    return ComplexService(temp_data_dir)

@pytest.fixture
def sample_complex_data():
    """Sample complex data for testing."""
    return {
        "id": "test-complex-history",
        "name": "Original Name",
        "description": "Original Description",
        "tasks": ["module1/topic1/task1"],
        "chains": [],
        "settings": {}
    }

class TestComplexHistory:
    """Tests for complex history and rollback."""

    def test_snapshot_creation_on_update(self, complex_service, sample_complex_data):
        """Test that a snapshot is created when a complex is updated."""
        # Create
        created = complex_service.create_complex(sample_complex_data)
        complex_id = created.id
        
        # Verify no history initially
        history = complex_service.get_complex_history(complex_id)
        assert len(history) == 0
        
        # Update
        complex_service.update_complex(complex_id, {"name": "Updated Name"})
        
        # Verify history has 1 entry
        history = complex_service.get_complex_history(complex_id)
        assert len(history) == 1
        assert history[0]["name"] == "Original Name"  # Snapshot stores PREVIOUS state
        
        # Update again
        complex_service.update_complex(complex_id, {"name": "Updated Name 2"})
        
        # Verify history has 2 entries
        history = complex_service.get_complex_history(complex_id)
        assert len(history) == 2
        assert history[0]["name"] == "Updated Name"  # Most recent snapshot first
        assert history[1]["name"] == "Original Name"

    def test_history_rotation(self, complex_service, sample_complex_data):
        """Test that history keeps only the last 20 versions."""
        created = complex_service.create_complex(sample_complex_data)
        complex_id = created.id
        
        # Create 22 updates
        for i in range(22):
            complex_service.update_complex(complex_id, {"name": f"Update {i}"})
            # Add small delay to ensure unique timestamps if OS is fast
            time.sleep(0.01) 
            
        history = complex_service.get_complex_history(complex_id)
        assert len(history) == 20
        
        # Check that the most recent update's snapshot
        # Detailed flow:
        # Create -> State: Original
        # Update 0 -> Snapshot: Original. State: Update 0
        # Update 1 -> Snapshot: Update 0. State: Update 1
        # ...
        # Update 21 -> Snapshot: Update 20. State: Update 21
        
        # Latest snapshot should be "Update 20"
        assert history[0]["name"] == "Update 20"
        
    def test_restore_from_history(self, complex_service, sample_complex_data):
        """Test restoring a complex from history."""
        import time
        # 1. Create -> State: Original
        created = complex_service.create_complex(sample_complex_data)
        complex_id = created.id
        
        # Small delays to ensure timestamp-based versions change
        time.sleep(0.05)
        
        # 2. Update -> Snapshot 1: Original. State: V1
        complex_service.update_complex(complex_id, {"name": "Version 1"})
        
        time.sleep(0.05)
        
        # 3. Update -> Snapshot 2: V1. State: V2
        complex_service.update_complex(complex_id, {"name": "Version 2"})
        
        # Get history
        history = complex_service.get_complex_history(complex_id)
        assert len(history) == 2
        
        # Snapshot 2 (latest) is "Version 1"
        snapshot_v1 = history[0]
        assert snapshot_v1["name"] == "Version 1"
        
        # Snapshot 1 (older) is "Original Name"
        snapshot_original = history[1]
        assert snapshot_original["name"] == "Original Name"
        
        # 4. Restore "Original Name"
        restored = complex_service.restore_from_history(complex_id, snapshot_original["_snapshot_timestamp"])
        
        # Verify restored state
        assert restored.name == "Original Name"
        
        # Verify that restore triggered a NEW snapshot of the state "Version 2" before overwriting it
        history_after = complex_service.get_complex_history(complex_id)
        assert len(history_after) == 3
        # The snapshot created just before restore should contain "Version 2"
        assert history_after[0]["name"] == "Version 2"

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
