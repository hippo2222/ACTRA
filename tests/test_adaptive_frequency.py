"""
Tests for adaptive frequency scheduling system.
"""

import pytest
from datetime import datetime, date, timedelta
from services.calendar.models import (
    ComplexProgress,
    ComplexStatus,
    MasteryCategory,
    MASTERY_INTERVALS,
)
from services.calendar.scheduler_service import SchedulerService


class TestMasteryCategory:
    """Test mastery category classification."""
    
    def test_critical_category(self):
        """Health score < 0.5 should be CRITICAL."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.3,
            status=ComplexStatus.IN_PROGRESS,
        )
        assert progress.get_mastery_category() == MasteryCategory.CRITICAL
        assert progress.get_required_interval_days() == 1
    
    def test_needs_practice_category(self):
        """Health score 0.5-0.7 should be NEEDS_PRACTICE."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.6,
            status=ComplexStatus.IN_PROGRESS,
        )
        assert progress.get_mastery_category() == MasteryCategory.NEEDS_PRACTICE
        assert progress.get_required_interval_days() == 2
    
    def test_good_category(self):
        """Health score 0.7-0.85 should be GOOD."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.75,
            status=ComplexStatus.IN_PROGRESS,
        )
        assert progress.get_mastery_category() == MasteryCategory.GOOD
        assert progress.get_required_interval_days() == 3
    
    def test_mastered_category(self):
        """Health score 0.85-0.95 should be MASTERED."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.9,
            status=ComplexStatus.MASTERED,
        )
        assert progress.get_mastery_category() == MasteryCategory.MASTERED
        assert progress.get_required_interval_days() == 7
    
    def test_maintained_category(self):
        """Health score > 0.95 should be MAINTAINED."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.98,
            status=ComplexStatus.MASTERED,
        )
        assert progress.get_mastery_category() == MasteryCategory.MAINTAINED
        assert progress.get_required_interval_days() == 14


class TestNextReviewDate:
    """Test next review date calculation."""
    
    def test_never_reviewed_needs_today(self):
        """Complex never reviewed should need review today."""
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.7,
            status=ComplexStatus.IN_PROGRESS,
            last_reviewed_at=None,
        )
        today = date.today()
        assert progress.get_next_review_date() == today
        assert progress.needs_review_on_date(today) is True
    
    def test_critical_needs_daily_review(self):
        """CRITICAL complex needs review every day."""
        yesterday = datetime.now() - timedelta(days=1)
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.3,  # CRITICAL
            status=ComplexStatus.IN_PROGRESS,
            last_reviewed_at=yesterday,
        )
        today = date.today()
        assert progress.needs_review_on_date(today) is True
    
    def test_good_needs_review_after_interval(self):
        """GOOD complex needs review after 3 days."""
        two_days_ago = datetime.now() - timedelta(days=2)
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.75,  # GOOD (interval=3)
            status=ComplexStatus.IN_PROGRESS,
            last_reviewed_at=two_days_ago,
        )
        today = date.today()
        tomorrow = today + timedelta(days=1)
        
        # Should not need review today (only 2 days passed)
        assert progress.needs_review_on_date(today) is False
        # Should need review tomorrow (3 days will have passed)
        assert progress.needs_review_on_date(tomorrow) is True
    
    def test_mastered_weekly_review(self):
        """MASTERED complex needs review once a week."""
        five_days_ago = datetime.now() - timedelta(days=5)
        progress = ComplexProgress(
            complex_id="test_1",
            user_id="user_1",
            health_score=0.9,  # MASTERED (interval=7)
            status=ComplexStatus.MASTERED,
            last_reviewed_at=five_days_ago,
        )
        today = date.today()
        in_two_days = today + timedelta(days=2)
        
        # Should not need review today (only 5 days passed)
        assert progress.needs_review_on_date(today) is False
        # Should need review in 2 days (7 days will have passed)
        assert progress.needs_review_on_date(in_two_days) is True


class TestAdaptiveScheduling:
    """Test adaptive frequency in schedule building."""
    
    @pytest.fixture
    def scheduler(self):
        return SchedulerService()
    
    @pytest.fixture
    def sample_progress(self):
        """Create sample progress with different mastery levels."""
        today = datetime.now()
        return [
            # CRITICAL - needs daily review
            ComplexProgress(
                complex_id="critical_1",
                user_id="user_1",
                health_score=0.4,
                status=ComplexStatus.IN_PROGRESS,
                last_reviewed_at=today - timedelta(days=1),
            ),
            # NEEDS_PRACTICE - reviewed yesterday, interval=2
            ComplexProgress(
                complex_id="practice_1",
                user_id="user_1",
                health_score=0.6,
                status=ComplexStatus.IN_PROGRESS,
                last_reviewed_at=today - timedelta(days=1),
            ),
            # GOOD - reviewed 2 days ago, interval=3
            ComplexProgress(
                complex_id="good_1",
                user_id="user_1",
                health_score=0.75,
                status=ComplexStatus.IN_PROGRESS,
                last_reviewed_at=today - timedelta(days=2),
            ),
            # MASTERED - reviewed 5 days ago, interval=7
            ComplexProgress(
                complex_id="mastered_1",
                user_id="user_1",
                health_score=0.9,
                status=ComplexStatus.MASTERED,
                last_reviewed_at=today - timedelta(days=5),
            ),
        ]
    
    def test_critical_always_included(self, scheduler, sample_progress):
        """CRITICAL complexes should always be included in daily plan."""
        task_pool = {
            "critical_1": [{"task_id": "t1", "complex_name": "Critical"}],
            "practice_1": [{"task_id": "t2", "complex_name": "Practice"}],
            "good_1": [{"task_id": "t3", "complex_name": "Good"}],
            "mastered_1": [{"task_id": "t4", "complex_name": "Mastered"}],
        }
        complex_names = {
            "critical_1": "Critical",
            "practice_1": "Practice",
            "good_1": "Good",
            "mastered_1": "Mastered",
        }
        
        schedule = scheduler.build_schedule_strip(
            user_id="user_1",
            days_count=1,
            schedule_mode="daily",
            activity_history={},
            available_minutes=30,
            all_progress=sample_progress,
            task_pool=task_pool,
            rest_days={},
            complex_names=complex_names,
        )
        
        today_plan = next(d for d in schedule if d.is_today)
        task_names = [t for t in today_plan.tasks if t]
        
        # CRITICAL should always be in plan
        assert "Critical" in task_names
    
    def test_respects_review_intervals(self, scheduler, sample_progress):
        """Schedule should respect required intervals for each category."""
        task_pool = {
            "critical_1": [{"task_id": "t1", "complex_name": "Critical"}],
            "practice_1": [{"task_id": "t2", "complex_name": "Practice"}],
            "good_1": [{"task_id": "t3", "complex_name": "Good"}],
            "mastered_1": [{"task_id": "t4", "complex_name": "Mastered"}],
        }
        complex_names = {
            "critical_1": "Critical",
            "practice_1": "Practice",
            "good_1": "Good",
            "mastered_1": "Mastered",
        }
        
        schedule = scheduler.build_schedule_strip(
            user_id="user_1",
            days_count=1,
            schedule_mode="daily",
            activity_history={},
            available_minutes=30,
            all_progress=sample_progress,
            task_pool=task_pool,
            rest_days={},
            complex_names=complex_names,
        )
        
        today_plan = next(d for d in schedule if d.is_today)
        task_names = [t for t in today_plan.tasks if t]
        
        # CRITICAL (interval=1, reviewed yesterday) - should be included
        assert "Critical" in task_names
        
        # NEEDS_PRACTICE (interval=2, reviewed yesterday) - should NOT be included yet
        assert "Practice" not in task_names
        
        # GOOD (interval=3, reviewed 2 days ago) - should NOT be included yet
        assert "Good" not in task_names
        
        # MASTERED (interval=7, reviewed 5 days ago) - should NOT be included yet
        assert "Mastered" not in task_names
    
    def test_limits_complexes_per_day(self, scheduler):
        """Should limit to max 4 complexes per day."""
        # Create 6 critical complexes (all need daily review)
        many_critical = [
            ComplexProgress(
                complex_id=f"critical_{i}",
                user_id="user_1",
                health_score=0.3,
                status=ComplexStatus.IN_PROGRESS,
                last_reviewed_at=datetime.now() - timedelta(days=1),
            )
            for i in range(6)
        ]
        
        task_pool = {f"critical_{i}": [{"task_id": f"t{i}", "complex_name": f"C{i}"}] for i in range(6)}
        complex_names = {f"critical_{i}": f"C{i}" for i in range(6)}
        
        schedule = scheduler.build_schedule_strip(
            user_id="user_1",
            days_count=1,
            schedule_mode="daily",
            activity_history={},
            available_minutes=30,
            all_progress=many_critical,
            task_pool=task_pool,
            rest_days={},
            complex_names=complex_names,
        )
        
        today_plan = next(d for d in schedule if d.is_today)
        # Should have at most 4 complexes
        assert len([t for t in today_plan.tasks if t]) <= 4


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
