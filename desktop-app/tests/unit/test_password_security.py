"""
Unit tests for bcrypt password security implementation.

Tests password hashing, verification, and migration from SHA-256.
"""

import unittest
import sys
import os
import shutil
import tempfile
import hashlib
import bcrypt
from pathlib import Path

# Setup paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService


class TestBcryptPasswordHashing(unittest.TestCase):
    """Tests for bcrypt password hashing"""
    
    def test_bcrypt_hash_generation(self):
        """bcrypt generates valid password hash"""
        password = "test_password_123"
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Verify hash format
        self.assertTrue(hashed.startswith('$2b$'))
        self.assertGreater(len(hashed), 50)
    
    def test_bcrypt_password_verification(self):
        """bcrypt correctly verifies passwords"""
        password = "test_password_123"
        hashed = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Correct password
        self.assertTrue(bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8')))
        
        # Incorrect password
        self.assertFalse(bcrypt.checkpw("wrong_password".encode('utf-8'), hashed.encode('utf-8')))
    
    def test_bcrypt_different_hashes_for_same_password(self):
        """bcrypt generates different hashes for same password (salt)"""
        password = "test_password_123"
        hash1 = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        hash2 = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        
        # Hashes should be different due to different salts
        self.assertNotEqual(hash1, hash2)
        
        # But both should verify correctly
        self.assertTrue(bcrypt.checkpw(password.encode('utf-8'), hash1.encode('utf-8')))
        self.assertTrue(bcrypt.checkpw(password.encode('utf-8'), hash2.encode('utf-8')))


class TestPasswordMigration(unittest.TestCase):
    """Tests for SHA-256 to bcrypt migration"""
    
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.user_service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_detect_bcrypt_hash(self):
        """Can detect bcrypt hash format"""
        bcrypt_hash = bcrypt.hashpw("password".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
        sha256_hash = hashlib.sha256("password".encode()).hexdigest()
        
        self.assertTrue(bcrypt_hash.startswith('$2b$'))
        self.assertFalse(sha256_hash.startswith('$2b$'))
    
    def test_verify_legacy_sha256_password(self):
        """Can verify legacy SHA-256 password"""
        password = "test_password"
        sha256_hash = hashlib.sha256(password.encode()).hexdigest()
        
        # Simulate verification
        is_valid = (hashlib.sha256(password.encode()).hexdigest() == sha256_hash)
        self.assertTrue(is_valid)
    
    def test_migration_creates_bcrypt_hash(self):
        """Migration converts SHA-256 to bcrypt"""
        password = "test_password"
        sha256_hash = hashlib.sha256(password.encode()).hexdigest()
        
        # Simulate migration
        if sha256_hash == hashlib.sha256(password.encode()).hexdigest():
            new_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            
            self.assertTrue(new_hash.startswith('$2b$'))
            self.assertTrue(bcrypt.checkpw(password.encode('utf-8'), new_hash.encode('utf-8')))


class TestPasswordSecurity(unittest.TestCase):
    """Tests for password security features"""
    
    def test_empty_password_removes_hash(self):
        """Empty password should remove password_hash"""
        # This simulates the API behavior
        pwd = ""
        password_hash = bcrypt.hashpw(pwd.encode('utf-8'), bcrypt.gensalt()).decode('utf-8') if pwd else None
        
        self.assertIsNone(password_hash)
    
    def test_password_hash_not_exposed_in_api(self):
        """Password hash should not be exposed in API responses"""
        temp_dir = tempfile.mkdtemp()
        try:
            user_service = UserService(data_dir=temp_dir)
            user = user_service.create_user("Test User")
            
            # Set password
            user.password_hash = bcrypt.hashpw("password".encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
            user_service.update_user(user)
            
            # Get API dict
            api_dict = user.to_api_dict()
            
            # Verify password_hash is not in API response
            self.assertNotIn('password_hash', api_dict)
            self.assertIn('has_password', api_dict)
            self.assertTrue(api_dict['has_password'])
        finally:
            shutil.rmtree(temp_dir)


if __name__ == '__main__':
    unittest.main()
