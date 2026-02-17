"""
Integration tests for Event-Driven Cache Invalidation.

Tests that StatisticsService cache is automatically invalidated
when UserProgressManager publishes progress_updated events.
"""
import pytest
import tempfile
import shutil
from pathlib import Path

from services.event_bus import EventBus
from services.user_progress_manager import UserProgressManager
from services.progress_service import ProgressService
from services.statistics_service import StatisticsService


class TestEventDrivenCache:
    """Test suite for event-driven cache invalidation."""
    
    @pytest.fixture
    def temp_data_dir(self):
        """Create temporary data directory for tests."""
        temp_dir = tempfile.mkdtemp()
        yield temp_dir
        shutil.rmtree(temp_dir)
    
    @pytest.fixture
    def event_bus(self):
        """Create EventBus instance."""
        return EventBus()
    
    @pytest.fixture
    def progress_service(self, temp_data_dir, event_bus):
        """Create ProgressService with EventBus."""
        return ProgressService(
            data_dir=temp_data_dir,
            user_id="test_user",
            event_bus=event_bus
        )
    
    @pytest.fixture
    def statistics_service(self, progress_service, event_bus):
        """Create StatisticsService with EventBus."""
        return StatisticsService(
            progress_service=progress_service,
            data_dir=progress_service.data_dir,
            event_bus=event_bus
        )
    
    def test_cache_invalidation_on_save_attempt(
        self, progress_service, statistics_service
    ):
        """Test that cache is invalidated when save_attempt is called."""
        user_id = "test_user"
        
        # 1. Save first attempt
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            time_spent=100
        )
        
        # 2. Get statistics (populates cache)
        stats1 = statistics_service.aggregate_statistics(user_id)
        assert stats1["total_tasks_attempted"] == 1
        
        # 3. Verify cache is populated (cache key format: stats_{user_id}_{days})
        cache_keys = [key for key in statistics_service._cache.keys() if key.startswith(f"stats_{user_id}_")]
        assert len(cache_keys) > 0, f"Expected cache entries for {user_id}, got: {list(statistics_service._cache.keys())}"
        
        # 4. Save another attempt (should trigger cache invalidation)
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_002",
            difficulty=1,
            success=True,
            time_spent=120
        )
        
        # 5. Verify cache was cleared (no cache entries for this user)
        cache_keys_after = [key for key in statistics_service._cache.keys() if key.startswith(f"stats_{user_id}_")]
        assert len(cache_keys_after) == 0, f"Expected no cache entries for {user_id}, got: {cache_keys_after}"
        
        # 6. Get statistics again (should reflect new attempt)
        stats2 = statistics_service.aggregate_statistics(user_id)
        assert stats2["total_tasks_attempted"] == 2
    
    def test_statistics_update_immediately_after_save(
        self, progress_service, statistics_service
    ):
        """Test that statistics update immediately after save_attempt via events."""
        user_id = "test_user"
        
        # 1. Get initial statistics
        stats_initial = statistics_service.aggregate_statistics(user_id)
        initial_attempts = stats_initial["total_tasks_attempted"]
        
        # 2. Save attempt via ProgressService
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=2,
            success=True,
            time_spent=150
        )
        
        # 3. Get statistics again (should reflect new attempt immediately)
        stats_after = statistics_service.aggregate_statistics(user_id, force_refresh=True)
        assert stats_after["total_tasks_attempted"] == initial_attempts + 1
        assert stats_after["success_rate"] == 1.0
    
    def test_multiple_saves_invalidate_cache_each_time(
        self, progress_service, statistics_service
    ):
        """Test that each save_attempt invalidates cache."""
        user_id = "test_user"
        
        # Save multiple attempts
        for i in range(5):
            # Get statistics (populates cache if not present)
            stats = statistics_service.aggregate_statistics(user_id)
            expected_attempts = i
            assert stats["total_tasks_attempted"] == expected_attempts
            
            # Verify cache is populated
            cache_keys = [key for key in statistics_service._cache.keys() if key.startswith(f"stats_{user_id}_")]
            assert len(cache_keys) > 0
            
            # Save attempt (should clear cache)
            progress_service.save_detailed_attempt(
                module_id="module_01",
                topic_id="topic_01",
                task_id=f"task_{i:03d}",
                difficulty=1,
                success=True,
                time_spent=100
            )
            
            # Verify cache was cleared
            cache_keys_after = [key for key in statistics_service._cache.keys() if key.startswith(f"stats_{user_id}_")]
            assert len(cache_keys_after) == 0
    
    def test_event_bus_without_subscribers(self, temp_data_dir):
        """Test that EventBus works even without subscribers."""
        event_bus = EventBus()
        
        # Create ProgressService with EventBus but no StatisticsService
        progress_service = ProgressService(
            data_dir=temp_data_dir,
            user_id="test_user",
            event_bus=event_bus
        )
        
        # Should not raise exception
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            time_spent=100
        )
    
    def test_services_without_event_bus(self, temp_data_dir):
        """Test backward compatibility - services work without EventBus."""
        # Create services without EventBus
        progress_service = ProgressService(
            data_dir=temp_data_dir,
            user_id="test_user"
        )
        
        statistics_service = StatisticsService(
            progress_service=progress_service,
            data_dir=temp_data_dir
        )
        
        # Should work normally (cache won't be auto-invalidated, but that's expected)
        progress_service.save_detailed_attempt(
            module_id="module_01",
            topic_id="topic_01",
            task_id="task_001",
            difficulty=1,
            success=True,
            time_spent=100
        )
        
        # Statistics should work (with force_refresh)
        stats = statistics_service.aggregate_statistics("test_user", force_refresh=True)
        assert stats["total_tasks_attempted"] == 1
    

