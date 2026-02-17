
import unittest
import shutil
import tempfile
import json
from pathlib import Path
from services.storage_service import StorageService

class TestStorageServiceDelete(unittest.TestCase):
    def setUp(self):
        # Create a temporary directory
        self.test_dir = tempfile.mkdtemp()
        self.data_dir = Path(self.test_dir)
        self.modules_dir = self.data_dir / "modules"
        self.modules_dir.mkdir(parents=True)
        
        self.storage = StorageService(self.data_dir)

    def tearDown(self):
        # Remove the directory after the test
        shutil.rmtree(self.test_dir)

    def _create_module(self, module_id):
        module_path = self.modules_dir / module_id
        module_path.mkdir(parents=True)
        
        # Create module.json
        with open(module_path / "module.json", "w", encoding="utf-8") as f:
            json.dump({"id": module_id, "name": "Test Module", "topics": []}, f)
        return module_path

    def _create_topic(self, module_id, topic_id):
        topic_path = self.modules_dir / module_id / "topics" / topic_id
        topic_path.mkdir(parents=True)
        
        # Update module.json
        module_json = self.modules_dir / module_id / "module.json"
        with open(module_json, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        data["topics"].append({"id": topic_id, "name": "Test Topic"})
        
        with open(module_json, "w", encoding="utf-8") as f:
            json.dump(data, f)
            
        return topic_path

    def test_delete_module(self):
        module_id = "test_module_delete"
        self._create_module(module_id)
        
        self.assertTrue((self.modules_dir / module_id).exists())
        
        result = self.storage.delete_module(module_id)
        self.assertTrue(result)
        self.assertFalse((self.modules_dir / module_id).exists())

    def test_delete_module_not_found(self):
        result = self.storage.delete_module("non_existent")
        self.assertFalse(result)

    def test_delete_topic(self):
        module_id = "test_module_topic"
        topic_id = "test_topic"
        self._create_module(module_id)
        self._create_topic(module_id, topic_id)
        
        self.assertTrue((self.modules_dir / module_id / "topics" / topic_id).exists())
        
        result = self.storage.delete_topic(module_id, topic_id)
        self.assertTrue(result)
        self.assertFalse((self.modules_dir / module_id / "topics" / topic_id).exists())
        
        # Verify removed from module.json
        with open(self.modules_dir / module_id / "module.json", "r", encoding="utf-8") as f:
            data = json.load(f)
            topics = [t["id"] for t in data["topics"]]
            self.assertNotIn(topic_id, topics)

    def test_delete_topic_file_only(self):
        # Scenario where topic exists specificially as folder but not in json (implicit structure)
        module_id = "test_implicit"
        topic_id = "topic_implicit"
        
        module_path = self.modules_dir / module_id
        module_path.mkdir()
        (module_path / "topics" / topic_id).mkdir(parents=True)
        
        result = self.storage.delete_topic(module_id, topic_id)
        self.assertTrue(result)
        self.assertFalse((module_path / "topics" / topic_id).exists())
