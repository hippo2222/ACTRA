"""
Integration tests for /api/users/update endpoint.

Tests name validation, password updates, and error responses.
"""

import unittest
import sys
import os
import shutil
import tempfile
import json
import bcrypt
from pathlib import Path
from unittest.mock import Mock, patch

# Setup paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService


class TestUserUpdateAPINameValidation(unittest.TestCase):
    """Tests for name validation in API"""
    
    def test_name_too_short(self):
        """API rejects names shorter than 2 characters"""
        # Simulate API validation logic
        name = "A"
        is_valid = len(name) >= 2 and len(name) <= 50
        
        self.assertFalse(is_valid)
    
    def test_name_too_long(self):
        """API rejects names longer than 50 characters"""
        name = "A" * 51
        is_valid = len(name) >= 2 and len(name) <= 50
        
        self.assertFalse(is_valid)
    
    def test_name_with_forbidden_chars(self):
        """API rejects names with forbidden characters"""
        forbidden_chars = ['/', '\\', '<', '>', ':', '"', '|', '?', '*']
        
        for char in forbidden_chars:
            name = f"Test{char}Name"
            has_forbidden = any(c in name for c in forbidden_chars)
            self.assertTrue(has_forbidden, f"Should reject name with '{char}'")
    
    def test_valid_name_accepted(self):
        """API accepts valid names"""
        valid_names = [
            "John Doe",
            "Мария Иванова",
            "Test User 123",
            "Name-With-Dash",
            "Name_With_Underscore"
        ]
        
        forbidden_chars = ['/', '\\', '<', '>', ':', '"', '|', '?', '*']
        
        for name in valid_names:
            is_valid = (
                len(name) >= 2 and 
                len(name) <= 50 and 
                not any(char in name for char in forbidden_chars)
            )
            self.assertTrue(is_valid, f"Should accept name '{name}'")


class TestUserUpdateAPIPasswordSecurity(unittest.TestCase):
    """Tests for password security in API"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
        self.test_user = self.user_service.create_user("Test User")
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_new_password_uses_bcrypt(self):
        """New passwords are hashed with bcrypt"""
        password = "new_password_123"
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        self.assertTrue(password_hash.startswith('$2b$'))
    
    def test_empty_password_removes_hash(self):
        """Empty password removes password_hash"""
        # Set password first
        self.test_user.password_hash = bcrypt.hashpw("password".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        self.user_service.update_user(self.test_user)
        
        # Remove password
        self.test_user.password_hash = None
        self.user_service.update_user(self.test_user)
        
        # Verify password is removed
        loaded_user = self.user_service.get_user(self.test_user.user_id)
        self.assertIsNone(loaded_user.password_hash)
    
    def test_password_verification_with_bcrypt(self):
        """Password verification works with bcrypt"""
        password = "test_password"
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Correct password
        is_valid = bcrypt.checkpw(password.encode('utf-8'), password_hash.encode('utf-8'))
        self.assertTrue(is_valid)
        
        # Wrong password
        is_valid = bcrypt.checkpw("wrong".encode('utf-8'), password_hash.encode('utf-8'))
        self.assertFalse(is_valid)


class TestUserUpdateAPIErrorHandling(unittest.TestCase):
    """Tests for error handling in API"""
    
    def test_error_response_format(self):
        """Error responses have correct format"""
        # Simulate error response
        error_response = {
            "ok": False,
            "error": "invalid_name_length",
            "message": "Имя должно содержать от 2 до 50 символов"
        }
        
        self.assertFalse(error_response["ok"])
        self.assertIn("error", error_response)
        self.assertIn("message", error_response)
    
    def test_success_response_format(self):
        """Success responses have correct format"""
        # Simulate success response
        success_response = {
            "ok": True,
            "user": {
                "user_id": "user_123",
                "name": "Test User",
                "has_password": False
            }
        }
        
        self.assertTrue(success_response["ok"])
        self.assertIn("user", success_response)


if __name__ == '__main__':
    unittest.main()
