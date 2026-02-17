
import unittest
import tempfile
import shutil
import time
import sys
from pathlib import Path
from datetime import datetime, timedelta

# Add desktop-app to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.progress_service import ProgressService
from services.statistics_service import StatisticsService

class TestStatisticsAnchor(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.user_id = "test_user_anchor"
        self.progress_service = ProgressService(data_dir=self.test_dir, user_id=self.user_id)
        self.statistics_service = StatisticsService(progress_service=self.progress_service)

    def tearDown(self):
        shutil.rmtree(self.test_dir)


    def test_anchor_to_today_with_past_data(self):
        """Test that get_time_dynamics anchors to today even if data is old."""
        # Add attempt
        self.progress_service.save_detailed_attempt(
            module_id="mod1", topic_id="top1", task_id="t1",
            difficulty=1, success=True, score=100, time_spent=10
        )
        # Manually overwrite timestamp to 5 days ago
        past_date = (datetime.now() - timedelta(days=5)).isoformat()
        
        # Access internal data to modify timestamp
        ph = self.progress_service.progress_manager.progress_data["task_history"]
        task_ref = "mod1/top1/t1"
        ph[task_ref]["attempts"][-1]["timestamp"] = past_date
        
        # Request 1 day
        dynamics = self.statistics_service.get_time_dynamics(self.user_id, days=1, force_refresh=True)
        
        # Should return 1 entry for TODAY
        self.assertEqual(len(dynamics), 1, "Should return 1 day of dynamics")
        
        expected_date = datetime.now().strftime("%Y-%m-%d")
        self.assertEqual(dynamics[0]["date"], expected_date, f"Date should be today ({expected_date})")
        # Attempts are filtered out because they are old
        self.assertEqual(dynamics[0]["attempts"], 0, "Should have 0 attempts for today")


    def test_anchor_to_today_with_no_data(self):
        """Test that get_time_dynamics anchors to today with NO data."""
        # Request 1 day
        dynamics = self.statistics_service.get_time_dynamics("user_no_data", days=1, force_refresh=True)
        
        # Now with gap filling, we expect 1 entry for Today (0 attempts)
        self.assertEqual(len(dynamics), 1, "Should return 1 day (today) even with no data")
        self.assertEqual(dynamics[0]["date"], datetime.now().strftime("%Y-%m-%d"))
        self.assertEqual(dynamics[0]["attempts"], 0)

    def test_anchor_to_today_with_future_data(self):
        """Test that get_time_dynamics anchors to future if clock skew exists?"""
        # Add attempt
        self.progress_service.save_detailed_attempt(
            module_id="mod1", topic_id="top1", task_id="t1",
            difficulty=1, success=True, score=100, time_spent=10
        )
        # Manually overwrite timestamp to future
        future_date = (datetime.now() + timedelta(days=2)).isoformat()
        
        ph = self.progress_service.progress_manager.progress_data["task_history"]
        task_ref = "mod1/top1/t1"
        ph[task_ref]["attempts"][-1]["timestamp"] = future_date
        
        dynamics = self.statistics_service.get_time_dynamics(self.user_id, days=1, force_refresh=True)
        # Should anchor to future date
        expected_date = datetime.fromisoformat(future_date).strftime("%Y-%m-%d")
        
        self.assertEqual(len(dynamics), 1)
        self.assertEqual(dynamics[0]["date"], expected_date)

if __name__ == '__main__':
    with open("test_result_log.txt", "w", encoding="utf-8") as f:
        runner = unittest.TextTestRunner(stream=f, verbosity=2)
        unittest.main(testRunner=runner, exit=False)

