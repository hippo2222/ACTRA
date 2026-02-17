import pytest
import time
import json
import shutil
from pathlib import Path
from server import app, _headless_app_ctx

@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client

def test_path_traversal_validation(client):
    """Test that path traversal attempts are blocked by validation."""
    storage = _headless_app_ctx.storage_service
    
    # Unsafe IDs that should be rejected
    unsafe_ids = ["../parent", "foo/bar", "back\\slash"] # _validate_id checks for .., / and \ only
    
    # We strictly check for separators and ..
    
    for unsafe_id in unsafe_ids:
        # load_task
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.load_task("mod", "topic", unsafe_id)
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.load_task("mod", unsafe_id, "task")
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.load_task(unsafe_id, "topic", "task")
            
        # get_module/topic
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.get_module(unsafe_id)
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.get_topics(unsafe_id)
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.get_topic("mod", unsafe_id)
            
        # Validation works for create/save/delete too
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.delete_task("mod", "topic", unsafe_id)
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.save_task("mod", "topic", unsafe_id, {})
        with pytest.raises(ValueError, match="Invalid ID"):
            storage.create_task(unsafe_id, "topic", "Task", "click") # validated mod/topic

def test_valid_ids_pass(client):
    """Test that normal IDs are allowed."""
    storage = _headless_app_ctx.storage_service
    safe_id = "safe_id_123-TEST"
    
    # Should not raise ValueError (might raise other errors like NotFound, but that's fine)
    # mod not found -> returns None
    assert storage.get_module(safe_id) is None 

def test_cache_invalidation_ttl(client):
    """Test that modules cache invalidates after TTL."""
    storage = _headless_app_ctx.storage_service
    modules_dir = storage.modules_dir
    
    # 1. Create a temp module
    test_mod_id = "ttl_test_module"
    test_mod_dir = modules_dir / test_mod_id
    if test_mod_dir.exists():
        shutil.rmtree(test_mod_dir)
    test_mod_dir.mkdir()
    
    try:
        (test_mod_dir / "module.json").write_text(
            json.dumps({"id": test_mod_id, "name": "Initial Name", "topics": []}), 
            encoding="utf-8"
        )
        
        # Force reload to ensure we start clean
        storage.reload_modules()
        
        from unittest.mock import patch
        
        # We need to mock time.time in storage_service
        # But storage_service imports time, so we patch 'services.storage_service.time.time' 
        # OR since we imported time in storage_service, we patch 'time.time' globally if possible or specific module.
        # Let's try to control the timestamp manually.
        
        # Initial load
        modules = storage.load_modules()
        mod = next((m for m in modules if m["id"] == test_mod_id), None)
        assert mod is not None
        assert mod["name"] == "Initial Name"
        
        # 3. Modify file EXTERNALLY
        (test_mod_dir / "module.json").write_text(
            json.dumps({"id": test_mod_id, "name": "Changed Name", "topics": []}), 
            encoding="utf-8"
        )
        
        # 4. Immediate reload -> should be cached (Old Name)
        # We assume time hasn't advanced 5s
        modules_cached = storage.load_modules()
        mod_cached = next((m for m in modules_cached if m["id"] == test_mod_id), None)
        assert mod_cached["name"] == "Initial Name"
        
        # 5. Artificially age the cache
        # storage._modules_cache_timestamp is set to time.time() on load.
        # We can just decrease the timestamp to simulate expiry.
        storage._modules_cache_timestamp -= 6.0 
        
        # 6. Reload -> should be fresh (New Name)
        modules_fresh = storage.load_modules()
        mod_fresh = next((m for m in modules_fresh if m["id"] == test_mod_id), None)
        assert mod_fresh["name"] == "Changed Name"
        
    finally:
        if test_mod_dir.exists():
            try:
                shutil.rmtree(test_mod_dir)
            except Exception:
                pass
        storage.reload_modules()
