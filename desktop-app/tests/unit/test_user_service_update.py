"""
Unit tests for user_service.py update_user method.

Tests validation and atomic write functionality.
"""

import unittest
import sys
import os
import shutil
import tempfile
import json
from pathlib import Path
from unittest.mock import patch, mock_open

# Setup paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from task_system.core.exceptions import TaskValidationError


class TestUpdateUserValidation(unittest.TestCase):
    """Tests for validation in update_user method"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_update_user_validates_data(self):
        """update_user validates profile data before saving"""
        # Modify user with valid data
        self.test_user.name = "Updated Name"
        result = self.user_service.update_user(self.test_user)
        
        self.assertTrue(result)
        
        # Verify data was saved
        loaded_user = self.user_service.get_user(self.test_user.user_id)
        self.assertEqual(loaded_user.name, "Updated Name")
    
    def test_update_user_rejects_invalid_data(self):
        """update_user rejects invalid profile data"""
        # Create a user with invalid data structure
        self.test_user.name = ""  # Empty name should fail validation
        
        # Mock ProfileSchema.validate_or_raise to raise exception
        with patch('services.user_service.ProfileSchema.validate_or_raise') as mock_validate:
            mock_validate.side_effect = TaskValidationError("Invalid profile data")
            
            result = self.user_service.update_user(self.test_user)
            
            self.assertFalse(result)
            mock_validate.assert_called_once()


class TestUpdateUserAtomicWrite(unittest.TestCase):
    """Tests for atomic write functionality"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_update_user_uses_temp_file(self):
        """update_user uses temporary file for atomic write"""
        self.test_user.name = "Updated Name"
        
        # Track tempfile creation
        with patch('tempfile.NamedTemporaryFile', wraps=tempfile.NamedTemporaryFile) as mock_temp:
            result = self.user_service.update_user(self.test_user)
            
            self.assertTrue(result)
            # Verify tempfile was created
            mock_temp.assert_called_once()
    
    def test_update_user_cleans_up_temp_on_error(self):
        """update_user cleans up temporary file on error"""
        self.test_user.name = "Updated Name"
        
        # Simulate error during os.replace
        with patch('os.replace', side_effect=OSError("Simulated error")):
            result = self.user_service.update_user(self.test_user)
            
            self.assertFalse(result)
            
            # Verify no .tmp files left behind
            user_dir = self.user_service.users_dir / self.test_user.user_id
            tmp_files = list(user_dir.glob("*.tmp"))
            self.assertEqual(len(tmp_files), 0)
    
    def test_update_user_preserves_data_on_failure(self):
        """update_user preserves original data if update fails"""
        original_name = self.test_user.name
        self.test_user.name = "New Name"
        
        # Simulate failure
        with patch('os.replace', side_effect=OSError("Simulated error")):
            result = self.user_service.update_user(self.test_user)
            
            self.assertFalse(result)
            
            # Verify original data is intact
            loaded_user = self.user_service.get_user(self.test_user.user_id)
            self.assertEqual(loaded_user.name, original_name)


class TestUpdateUserIntegration(unittest.TestCase):
    """Integration tests for update_user"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_update_user_full_workflow(self):
        """Full workflow: create, update, verify"""
        # Update user
        self.test_user.name = "Updated Name"
        self.test_user.avatar_seed = "new_seed"
        
        result = self.user_service.update_user(self.test_user)
        self.assertTrue(result)
        
        # Reload and verify
        loaded_user = self.user_service.get_user(self.test_user.user_id)
        self.assertEqual(loaded_user.name, "Updated Name")
        self.assertEqual(loaded_user.avatar_seed, "new_seed")
    
    def test_update_user_returns_false_for_nonexistent_user(self):
        """update_user returns False for non-existent user"""
        fake_user = User(
            user_id="nonexistent_user",
            name="Fake User",
            created_at="2024-01-01T00:00:00"
        )
        
        result = self.user_service.update_user(fake_user)
        self.assertFalse(result)


if __name__ == '__main__':
    unittest.main()
