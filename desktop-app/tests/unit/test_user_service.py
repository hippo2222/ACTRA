"""
РўРµСЃС‚С‹ РґР»СЏ UserService.

РџСЂРѕРІРµСЂСЏРµС‚:
- РЎРѕР·РґР°РЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
- РџРѕР»СѓС‡РµРЅРёРµ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
- РџРѕР»СѓС‡РµРЅРёРµ СЃРїРёСЃРєР° РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
- Р’Р°Р»РёРґР°С†РёСЋ РґР°РЅРЅС‹С…
"""

import unittest
import tempfile
import json
import shutil
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.user_service import UserService, User
from services.schemas.user_schemas import ProfileSchema, ProgressSchema, StatisticsSchema


class TestUserService(unittest.TestCase):
    """РўРµСЃС‚С‹ РґР»СЏ UserService"""
    
    def setUp(self):
        """РќР°СЃС‚СЂРѕР№РєР° С‚РµСЃС‚РѕРІРѕРіРѕ РѕРєСЂСѓР¶РµРЅРёСЏ"""
        self.temp_dir = tempfile.mkdtemp()
        self.service = UserService(data_dir=self.temp_dir)
    
    def tearDown(self):
        """РћС‡РёСЃС‚РєР° РїРѕСЃР»Рµ С‚РµСЃС‚РѕРІ"""
        shutil.rmtree(self.temp_dir, ignore_errors=True)
    
    def test_create_user(self):
        """РўРµСЃС‚ СЃРѕР·РґР°РЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"""
        user = self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕР·РґР°РЅ
        self.assertIsNotNone(user)
        self.assertIsInstance(user, User)
        self.assertEqual(user.name, "РРІР°РЅ РРІР°РЅРѕРІ")
        self.assertTrue(user.user_id.startswith("user_"))
        self.assertIsNotNone(user.created_at)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ СЃРѕР·РґР°РЅР° РґРёСЂРµРєС‚РѕСЂРёСЏ
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        self.assertTrue(user_dir.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ СЃРѕР·РґР°РЅ profile.json
        profile_file = user_dir / "profile.json"
        self.assertTrue(profile_file.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј СЃРѕРґРµСЂР¶РёРјРѕРµ profile.json
        with open(profile_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        errors = ProfileSchema.validate(data)
        self.assertEqual(len(errors), 0, f"РћС€РёР±РєРё РІР°Р»РёРґР°С†РёРё: {errors}")
        self.assertEqual(data["user_id"], user.user_id)
        self.assertEqual(data["profile"]["name"], "РРІР°РЅ РРІР°РЅРѕРІ")
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ СЃРѕР·РґР°РЅС‹ progress.json Рё statistics.json
        progress_file = user_dir / "progress.json"
        statistics_file = user_dir / "statistics.json"
        
        self.assertTrue(progress_file.exists())
        self.assertTrue(statistics_file.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј РІР°Р»РёРґРЅРѕСЃС‚СЊ progress.json
        with open(progress_file, 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        errors = ProgressSchema.validate(progress_data)
        self.assertEqual(len(errors), 0, f"РћС€РёР±РєРё РІР°Р»РёРґР°С†РёРё progress.json: {errors}")
        
        # РџСЂРѕРІРµСЂСЏРµРј РІР°Р»РёРґРЅРѕСЃС‚СЊ statistics.json
        with open(statistics_file, 'r', encoding='utf-8') as f:
            statistics_data = json.load(f)
        errors = StatisticsSchema.validate(statistics_data)
        self.assertEqual(len(errors), 0, f"РћС€РёР±РєРё РІР°Р»РёРґР°С†РёРё statistics.json: {errors}")
    
    def test_create_user_with_settings(self):
        """РўРµСЃС‚ СЃРѕР·РґР°РЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ (settings РїСѓСЃС‚РѕР№ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ)"""
        user = self.service.create_user("РџРµС‚СЂ РџРµС‚СЂРѕРІ")
        
        # Settings РґРѕР»Р¶РµРЅ Р±С‹С‚СЊ РїСѓСЃС‚С‹Рј СЃР»РѕРІР°СЂРµРј
        self.assertEqual(user.settings, {})
        
        # РџСЂРѕРІРµСЂСЏРµРј РІ С„Р°Р№Р»Рµ
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        profile_file = user_dir / "profile.json"
        
        with open(profile_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        self.assertEqual(data["profile"]["settings"], {})
    
    def test_create_user_empty_name(self):
        """РўРµСЃС‚ СЃРѕР·РґР°РЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ РїСѓСЃС‚С‹Рј РёРјРµРЅРµРј"""
        with self.assertRaises(ValueError) as context:
            self.service.create_user("")
        
        msg = str(context.exception).lower()
        self.assertIn("пустым", msg)
    
    
    def test_get_user(self):
        """РўРµСЃС‚ РїРѕР»СѓС‡РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"""
        # РЎРѕР·РґР°РµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        created_user = self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
        
        # РџРѕР»СѓС‡Р°РµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        retrieved_user = self.service.get_user(created_user.user_id)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅР°Р№РґРµРЅ
        self.assertIsNotNone(retrieved_user)
        self.assertEqual(retrieved_user.user_id, created_user.user_id)
        self.assertEqual(retrieved_user.name, created_user.name)
        self.assertEqual(retrieved_user.created_at, created_user.created_at)
    
    def test_get_user_not_found(self):
        """РўРµСЃС‚ РїРѕР»СѓС‡РµРЅРёСЏ РЅРµСЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"""
        user = self.service.get_user("nonexistent_user")
        self.assertIsNone(user)
    
    def test_get_user_empty_id(self):
        """РўРµСЃС‚ РїРѕР»СѓС‡РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ РїСѓСЃС‚С‹Рј ID"""
        user = self.service.get_user("")
        self.assertIsNone(user)
    
    def test_get_all_users(self):
        """РўРµСЃС‚ РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№"""
        # РЎРѕР·РґР°РµРј РЅРµСЃРєРѕР»СЊРєРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
        user1 = self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
        user2 = self.service.create_user("РџРµС‚СЂ РџРµС‚СЂРѕРІ")
        user3 = self.service.create_user("РњР°СЂРёСЏ РЎРёРґРѕСЂРѕРІР°")
        
        # РџРѕР»СѓС‡Р°РµРј РІСЃРµС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
        users = self.service.get_all_users()
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РІСЃРµ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РЅР°Р№РґРµРЅС‹
        self.assertEqual(len(users), 3)
        
        user_ids = {user.user_id for user in users}
        self.assertIn(user1.user_id, user_ids)
        self.assertIn(user2.user_id, user_ids)
        self.assertIn(user3.user_id, user_ids)
        
        names = {user.name for user in users}
        self.assertIn("РРІР°РЅ РРІР°РЅРѕРІ", names)
        self.assertIn("РџРµС‚СЂ РџРµС‚СЂРѕРІ", names)
        self.assertIn("РњР°СЂРёСЏ РЎРёРґРѕСЂРѕРІР°", names)
    
    def test_get_all_users_empty(self):
        """РўРµСЃС‚ РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№, РєРѕРіРґР° РёС… РЅРµС‚"""
        users = self.service.get_all_users()
        self.assertEqual(len(users), 0)
    
    def test_user_to_dict(self):
        """РўРµСЃС‚ РїСЂРµРѕР±СЂР°Р·РѕРІР°РЅРёСЏ User РІ СЃР»РѕРІР°СЂСЊ"""
        user = User(
            user_id="user_123",
            name="РРІР°РЅ РРІР°РЅРѕРІ",
            created_at="2024-01-01T00:00:00",
            settings={}
        )
        
        data = user.to_dict()
        
        self.assertEqual(data["user_id"], "user_123")
        self.assertEqual(data["profile"]["name"], "РРІР°РЅ РРІР°РЅРѕРІ")
        self.assertEqual(data["profile"]["created_at"], "2024-01-01T00:00:00")
        self.assertEqual(data["profile"]["settings"], {})
        
        # РџСЂРѕРІРµСЂСЏРµРј РІР°Р»РёРґРЅРѕСЃС‚СЊ
        errors = ProfileSchema.validate(data)
        self.assertEqual(len(errors), 0, f"РћС€РёР±РєРё РІР°Р»РёРґР°С†РёРё: {errors}")
    
    def test_user_from_dict(self):
        """РўРµСЃС‚ СЃРѕР·РґР°РЅРёСЏ User РёР· СЃР»РѕРІР°СЂСЏ"""
        data = {
            "user_id": "user_123",
            "profile": {
                "name": "РРІР°РЅ РРІР°РЅРѕРІ",
                "created_at": "2024-01-01T00:00:00",
                "settings": {}
            }
        }
        
        user = User.from_dict(data)
        
        self.assertEqual(user.user_id, "user_123")
        self.assertEqual(user.name, "РРІР°РЅ РРІР°РЅРѕРІ")
        self.assertEqual(user.created_at, "2024-01-01T00:00:00")
        self.assertEqual(user.settings, {})
    
    def test_unique_user_ids(self):
        """РўРµСЃС‚ СѓРЅРёРєР°Р»СЊРЅРѕСЃС‚Рё user_id"""
        user1 = self.service.create_user("РРІР°РЅ")
        user2 = self.service.create_user("РџРµС‚СЂ")
        user3 = self.service.create_user("РњР°СЂРёСЏ")
        
        user_ids = {user1.user_id, user2.user_id, user3.user_id}
        self.assertEqual(len(user_ids), 3)  # Р’СЃРµ ID РґРѕР»Р¶РЅС‹ Р±С‹С‚СЊ СѓРЅРёРєР°Р»СЊРЅС‹РјРё
    
    def test_user_directory_structure(self):
        """РўРµСЃС‚ СЃС‚СЂСѓРєС‚СѓСЂС‹ РґРёСЂРµРєС‚РѕСЂРёР№ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"""
        user = self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РІСЃРµ РЅРµРѕР±С…РѕРґРёРјС‹Рµ С„Р°Р№Р»С‹ СЃРѕР·РґР°РЅС‹
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "statistics.json").exists())
    
    def test_create_user_duplicate_name(self):
        """РўРµСЃС‚ СЃРѕР·РґР°РЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃ РѕРґРёРЅР°РєРѕРІС‹РјРё РёРјРµРЅР°РјРё (РґРѕР»Р¶РЅРѕ Р±С‹С‚СЊ Р·Р°РїСЂРµС‰РµРЅРѕ)"""
        # РЎРѕР·РґР°РµРј РїРµСЂРІРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        user1 = self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
        self.assertIsNotNone(user1)
        
        # РџРѕРїС‹С‚РєР° СЃРѕР·РґР°С‚СЊ РІС‚РѕСЂРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ С‚РµРј Р¶Рµ РёРјРµРЅРµРј РґРѕР»Р¶РЅР° РІС‹Р±СЂРѕСЃРёС‚СЊ РѕС€РёР±РєСѓ
        with self.assertRaises(ValueError):
            self.service.create_user("РРІР°РЅ РРІР°РЅРѕРІ")
    
    def test_user_isolation(self):
        """РўРµСЃС‚ РёР·РѕР»СЏС†РёРё РґР°РЅРЅС‹С… РјРµР¶РґСѓ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏРјРё"""
        # РЎРѕР·РґР°РµРј РґРІСѓС… РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№
        user1 = self.service.create_user("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ 1")
        user2 = self.service.create_user("РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ 2")
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ Сѓ РєР°Р¶РґРѕРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃРІРѕСЏ РґРёСЂРµРєС‚РѕСЂРёСЏ
        user1_dir = Path(self.temp_dir) / "users" / user1.user_id
        user2_dir = Path(self.temp_dir) / "users" / user2.user_id
        
        self.assertTrue(user1_dir.exists())
        self.assertTrue(user2_dir.exists())
        self.assertNotEqual(user1_dir, user2_dir)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ Сѓ РєР°Р¶РґРѕРіРѕ СЃРІРѕР№ profile.json
        profile1 = user1_dir / "profile.json"
        profile2 = user2_dir / "profile.json"
        
        self.assertTrue(profile1.exists())
        self.assertTrue(profile2.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј СЃРѕРґРµСЂР¶РёРјРѕРµ profile.json
        with open(profile1, 'r', encoding='utf-8') as f:
            data1 = json.load(f)
        with open(profile2, 'r', encoding='utf-8') as f:
            data2 = json.load(f)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ user_id СЂР°Р·РЅС‹Рµ
        self.assertNotEqual(data1["user_id"], data2["user_id"])
        self.assertEqual(data1["user_id"], user1.user_id)
        self.assertEqual(data2["user_id"], user2.user_id)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РёРјРµРЅР° СЂР°Р·РЅС‹Рµ
        self.assertEqual(data1["profile"]["name"], "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ 1")
        self.assertEqual(data2["profile"]["name"], "РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ 2")
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ Сѓ РєР°Р¶РґРѕРіРѕ СЃРІРѕР№ progress.json Рё statistics.json
        progress1 = user1_dir / "progress.json"
        progress2 = user2_dir / "progress.json"
        stats1 = user1_dir / "statistics.json"
        stats2 = user2_dir / "statistics.json"
        
        self.assertTrue(progress1.exists())
        self.assertTrue(progress2.exists())
        self.assertTrue(stats1.exists())
        self.assertTrue(stats2.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј СЃРѕРґРµСЂР¶РёРјРѕРµ progress.json
        with open(progress1, 'r', encoding='utf-8') as f:
            progress_data1 = json.load(f)
        with open(progress2, 'r', encoding='utf-8') as f:
            progress_data2 = json.load(f)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ user_id РІ progress.json СЃРѕРѕС‚РІРµС‚СЃС‚РІСѓСЋС‚
        self.assertEqual(progress_data1["user_id"], user1.user_id)
        self.assertEqual(progress_data2["user_id"], user2.user_id)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РґР°РЅРЅС‹Рµ РёР·РѕР»РёСЂРѕРІР°РЅС‹ (task_history РїСѓСЃС‚С‹Рµ)
        self.assertEqual(progress_data1["task_history"], {})
        self.assertEqual(progress_data2["task_history"], {})
    
    def test_delete_user_with_progress(self):
        """РўРµСЃС‚ СѓРґР°Р»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ СЃРѕС…СЂР°РЅРµРЅРёРµРј РґР°РЅРЅС‹С…"""
        # РЎРѕР·РґР°РµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        user = self.service.create_user("РўРµСЃС‚РѕРІС‹Р№ РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ")
        user_dir = Path(self.temp_dir) / "users" / user.user_id
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ СЃРѕР·РґР°РЅ
        self.assertTrue(user_dir.exists())
        self.assertTrue((user_dir / "profile.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        self.assertTrue((user_dir / "progress.json").exists())
        
        # Р”РѕР±Р°РІР»СЏРµРј РЅРµРєРѕС‚РѕСЂС‹Рµ РґР°РЅРЅС‹Рµ РІ progress.json (СЃРёРјСѓР»СЏС†РёСЏ РїСЂРѕРіСЂРµСЃСЃР°)
        from services.progress_service import ProgressService
        progress_service = ProgressService(
            data_dir=str(self.temp_dir),
            user_id=user.user_id
        )
        
        # РЎРѕС…СЂР°РЅСЏРµРј С‚РµСЃС‚РѕРІСѓСЋ РїРѕРїС‹С‚РєСѓ
        from services.task_evaluator_service import EvaluationResult
        result = EvaluationResult(
            success=True,
            score=85.0,
            message="РўРµСЃС‚",
            metric="percent",
            details={}
        )
        progress_service.save_evaluation_result(
            "module_01", "topic_01", "task_001", result
        )
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РґР°РЅРЅС‹Рµ СЃРѕС…СЂР°РЅРµРЅС‹
        progress_file = user_dir / "progress.json"
        with open(progress_file, 'r', encoding='utf-8') as f:
            progress_data = json.load(f)
        self.assertGreater(len(progress_data.get("task_history", {})), 0)
        
        # РЈРґР°Р»СЏРµРј РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ
        deleted = self.service.delete_user(user.user_id)
        self.assertTrue(deleted)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РґРёСЂРµРєС‚РѕСЂРёСЏ СѓРґР°Р»РµРЅР°
        self.assertFalse(user_dir.exists())
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ
        retrieved_user = self.service.get_user(user.user_id)
        self.assertIsNone(retrieved_user)
        
        # РџСЂРѕРІРµСЂСЏРµРј, С‡С‚Рѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РІ СЃРїРёСЃРєРµ
        all_users = self.service.get_all_users()
        user_ids = {u.user_id for u in all_users}
        self.assertNotIn(user.user_id, user_ids)
    
    def test_delete_user_not_found(self):
        """РўРµСЃС‚ СѓРґР°Р»РµРЅРёСЏ РЅРµСЃСѓС‰РµСЃС‚РІСѓСЋС‰РµРіРѕ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ"""
        deleted = self.service.delete_user("nonexistent_user")
        self.assertFalse(deleted)
    
    def test_delete_user_empty_id(self):
        """РўРµСЃС‚ СѓРґР°Р»РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ СЃ РїСѓСЃС‚С‹Рј ID"""
        with self.assertRaises(ValueError):
            self.service.delete_user("")
    
    def test_get_user_guest_returns_none(self):
        """Guest profile is deprecated and must not be returned."""
        user = self.service.get_user("guest")
        self.assertIsNone(user)

    def test_get_all_users_skips_guest_directory(self):
        """Legacy guest directory must be ignored in user listing."""
        regular = self.service.create_user("Regular User")

        guest_dir = Path(self.temp_dir) / "users" / "guest"
        guest_dir.mkdir(parents=True, exist_ok=True)
        guest_profile = {
            "user_id": "guest",
            "profile": {
                "name": "Guest",
                "created_at": "2026-02-15T00:00:00",
                "avatar_seed": "1.png",
                "password_hash": None,
                "security_settings": {
                    "require_password_on_login": False,
                    "require_password_on_edit": False
                },
                "settings": {}
            }
        }
        with open(guest_dir / "profile.json", "w", encoding="utf-8") as f:
            json.dump(guest_profile, f, ensure_ascii=False, indent=2)

        users = self.service.get_all_users()
        user_ids = {u.user_id for u in users}
        self.assertIn(regular.user_id, user_ids)
        self.assertNotIn("guest", user_ids)

    def test_save_last_user_id_guest_is_cleared(self):
        """Guest must never persist as last active user in app_state."""
        self.service.save_last_user_id("guest")
        saved = self.service.get_last_user_id()
        self.assertEqual(saved, "")

if __name__ == '__main__':
    unittest.main()


