import pytest
import shutil
import tempfile
from pathlib import Path
from services.complex_service import ComplexService
from task_system.core.models.complex_models import Complex

@pytest.fixture
def complex_service():
    """Fixture to create a ComplexService with a temporary directory."""
    base = tempfile.mkdtemp()
    data_dir = Path(base) / "data"
    data_dir.mkdir()
    yield ComplexService(str(data_dir))
    shutil.rmtree(base, ignore_errors=True)

def test_create_complex(complex_service):
    complex_data = {
        "id": "c1",
        "name": "Test Complex",
        "tasks": ["t1", "t2"]
    }
    created = complex_service.create_complex(complex_data)
    assert created.id == "c1"
    assert created.name == "Test Complex"
    
    # Verify it's in the list
    all_complexes = complex_service.get_all_complexes()
    assert len(all_complexes) == 1
    assert all_complexes[0].id == "c1"

def test_get_complex(complex_service):
    complex_data = {
        "id": "c1",
        "name": "Test Complex",
        "tasks": ["t1"]
    }
    complex_service.create_complex(complex_data)
    
    fetched = complex_service.get_complex("c1")
    assert fetched is not None
    assert fetched.id == "c1"
    
    assert complex_service.get_complex("non_existent") is None

def test_update_complex(complex_service):
    complex_data = {
        "id": "c1",
        "name": "Old Name",
        "tasks": ["t1"]
    }
    complex_service.create_complex(complex_data)
    
    updated = complex_service.update_complex("c1", {"name": "New Name"})
    assert updated.name == "New Name"
    assert updated.tasks == ["t1"] # Should remain unchanged
    
    fetched = complex_service.get_complex("c1")
    assert fetched.name == "New Name"

def test_delete_complex(complex_service):
    complex_data = {
        "id": "c1",
        "name": "To Delete",
        "tasks": ["t1"]
    }
    complex_service.create_complex(complex_data)
    
    assert complex_service.delete_complex("c1") is True
    assert complex_service.get_complex("c1") is None
    assert len(complex_service.get_all_complexes()) == 0
    
    assert complex_service.delete_complex("c1") is False # Already deleted

def test_persistence():
    """Test that data persists across service instances."""
    base = tempfile.mkdtemp()
    data_dir = Path(base) / "data"
    data_dir.mkdir()
    
    # Create in first instance
    service1 = ComplexService(str(data_dir))
    service1.create_complex({
        "id": "p1",
        "name": "Persistent",
        "tasks": ["t1"]
    })
    
    # Read in second instance
    service2 = ComplexService(str(data_dir))
    loaded = service2.get_all_complexes()
    assert len(loaded) == 1
    assert loaded[0].id == "p1"
