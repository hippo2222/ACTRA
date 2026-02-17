"""
Unit tests for ComplexService version conflict detection.

Tests the optimistic locking functionality added in Phase 1.
"""

import pytest
import json
import tempfile
import shutil
from pathlib import Path
from datetime import datetime
from services.complex_service import ComplexService, ConflictError


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
        "id": "test-complex-1",
        "name": "Test Complex",
        "description": "Test description",
        "tasks": ["module1/topic1/task1", "module1/topic1/task2"],
        "chains": [["module1/topic1/task1", "module1/topic1/task2"]],
        "settings": {}
    }


class TestConflictError:
    """Tests for ConflictError exception."""
    
    def test_conflict_error_creation(self):
        """Test that ConflictError can be created with proper attributes."""
        error = ConflictError(
            "Test conflict",
            current_version="2026-01-21T10:00:00",
            expected_version="2026-01-21T09:00:00"
        )
        
        assert str(error) == "Test conflict"
        assert error.current_version == "2026-01-21T10:00:00"
        assert error.expected_version == "2026-01-21T09:00:00"
    
    def test_conflict_error_is_exception(self):
        """Test that ConflictError is a proper Exception."""
        error = ConflictError("Test", "v1", "v2")
        assert isinstance(error, Exception)


class TestOptimisticLocking:
    """Tests for optimistic locking in ComplexService."""
    
    def test_update_without_version_check(self, complex_service, sample_complex_data):
        """Test that update works without version check (backward compatibility)."""
        # Create complex
        created = complex_service.create_complex(sample_complex_data)
        assert created.id == "test-complex-1"
        
        # Update without expected_version
        updated = complex_service.update_complex(
            "test-complex-1",
            {"name": "Updated Name"}
        )
        
        assert updated.name == "Updated Name"
        assert updated.description == "Test description"
    
    def test_update_with_matching_version(self, complex_service, sample_complex_data):
        """Test that update succeeds when version matches."""
        # Create complex
        created = complex_service.create_complex(sample_complex_data)
        current_version = created.updated_at.isoformat()
        
        # Update with correct version
        updated = complex_service.update_complex(
            "test-complex-1",
            {"name": "Updated Name"},
            expected_version=current_version
        )
        
        assert updated.name == "Updated Name"
    
    def test_update_with_mismatched_version_raises_conflict(
        self, complex_service, sample_complex_data
    ):
        """Test that update raises ConflictError when version doesn't match."""
        import time
        # Create complex
        created = complex_service.create_complex(sample_complex_data)
        old_version = created.updated_at.isoformat()
        
        # Small delay to ensure timestamp changes
        time.sleep(0.05)
        
        # Update complex (version changes)
        complex_service.update_complex(
            "test-complex-1",
            {"name": "First Update"}
        )
        
        # Try to update with old version - should raise ConflictError
        with pytest.raises(ConflictError) as exc_info:
            complex_service.update_complex(
                "test-complex-1",
                {"name": "Second Update"},
                expected_version=old_version
            )
        
        error = exc_info.value
        assert error.expected_version == old_version
        assert error.current_version != old_version
        assert "modified by another user" in str(error)
    
    def test_concurrent_edit_scenario(self, complex_service, sample_complex_data):
        """Test realistic concurrent edit scenario."""
        import time
        # User A opens complex for editing
        created = complex_service.create_complex(sample_complex_data)
        user_a_version = created.updated_at.isoformat()
        
        # User B also opens the same complex
        user_b_version = created.updated_at.isoformat()
        assert user_a_version == user_b_version
        
        # Small delay to ensure timestamp changes on update
        time.sleep(0.05)
        
        # User B saves first
        updated_by_b = complex_service.update_complex(
            "test-complex-1",
            {"description": "Updated by User B"},
            expected_version=user_b_version
        )
        
        # User A tries to save - should get conflict
        with pytest.raises(ConflictError):
            complex_service.update_complex(
                "test-complex-1",
                {"name": "Updated by User A"},
                expected_version=user_a_version
            )
        
        # Verify User B's changes are preserved
        final = complex_service.get_complex("test-complex-1")
        assert final.description == "Updated by User B"
        assert final.name == "Test Complex"  # User A's change was rejected
    
    def test_force_update_without_version_check(self, complex_service, sample_complex_data):
        """Test that omitting expected_version allows force update."""
        # Create and update complex
        created = complex_service.create_complex(sample_complex_data)
        old_version = created.updated_at.isoformat()
        
        # First update
        complex_service.update_complex(
            "test-complex-1",
            {"name": "First Update"}
        )
        
        # Force update without version check (simulates user choosing "overwrite")
        force_updated = complex_service.update_complex(
            "test-complex-1",
            {"name": "Force Updated"},
            expected_version=None  # No version check
        )
        
        assert force_updated.name == "Force Updated"
    
    def test_version_updates_after_save(self, complex_service, sample_complex_data):
        """Test that updated_at changes after each save."""
        created = complex_service.create_complex(sample_complex_data)
        version1 = created.updated_at.isoformat()
        
        # Small delay to ensure timestamp changes
        import time
        time.sleep(0.01)
        
        updated = complex_service.update_complex(
            "test-complex-1",
            {"name": "Updated"}
        )
        version2 = updated.updated_at.isoformat()
        
        assert version2 > version1


class TestComplexServiceIntegration:
    """Integration tests for ComplexService with optimistic locking."""
    
    def test_create_update_delete_workflow(self, complex_service, sample_complex_data):
        """Test complete workflow with version tracking."""
        import time
        # Create
        created = complex_service.create_complex(sample_complex_data)
        assert created.id == "test-complex-1"
        version1 = created.updated_at.isoformat()
        
        # Small delay to ensure timestamp changes
        time.sleep(0.05)
        
        # Update with version check
        updated = complex_service.update_complex(
            "test-complex-1",
            {"name": "Updated Name"},
            expected_version=version1
        )
        assert updated.name == "Updated Name"
        version2 = updated.updated_at.isoformat()
        assert version2 != version1
        
        # Delete
        deleted = complex_service.delete_complex("test-complex-1")
        assert deleted is True
        
        # Verify deleted
        result = complex_service.get_complex("test-complex-1")
        assert result is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
