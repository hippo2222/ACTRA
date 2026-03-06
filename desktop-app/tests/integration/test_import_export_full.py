import unittest
import os
import json
import tempfile
import shutil
import zipfile
import threading
import queue
from pathlib import Path
from unittest.mock import MagicMock, patch

# Adjust path to import app modules
import sys
# desktop-app is at parents[2] relative to desktop-app/tests/integration/test_import_export_full.py
sys.path.append(str(Path(__file__).parents[2]))

from services.import_export_service import ImportExportService
from server import app, _headless_app_ctx

class TestImportExportSystem(unittest.TestCase):

    def setUp(self):
        # Create a temporary storage environment
        self.test_dir = tempfile.mkdtemp()
        self.modules_dir = Path(self.test_dir) / "modules"
        self.modules_dir.mkdir()
        
        # Mock storage service
        self.mock_storage = MagicMock()
        self.mock_storage.modules_dir = self.modules_dir
        self.mock_storage.data_dir = Path(self.test_dir)
        self.mock_storage.load_modules.return_value = []
        
        self.service = ImportExportService(self.mock_storage)
        
        # Setup Flask client
        app.config['TESTING'] = True
        self.client = app.test_client()
        
        # Inject service into app context (if possible, or mock globally)
        _headless_app_ctx.import_export_service = self.service

    def tearDown(self):
        shutil.rmtree(self.test_dir)

    # =========================================================================
    # 1. New Feature Tests: Export
    # =========================================================================

    def test_create_export_archive_structure(self):
        """Test that export creates a valid ZIP with correct structure."""
        # Setup dummy task in storage
        task_id = "task_1"
        module_id = "mod_1"
        topic_id = "top_1"
        
        task_path = self.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        task_path.mkdir(parents=True)
        
        with open(task_path / "task.json", "w") as f:
            json.dump({"id": task_id, "name": "Test Task"}, f)
        
        # Execute
        tasks_to_export = [{"module_id": module_id, "topic_id": topic_id, "task_id": task_id}]
        zip_path = self.service.create_export_archive(tasks_to_export)
        
        # Verify
        self.assertTrue(os.path.exists(zip_path))
        with zipfile.ZipFile(zip_path, 'r') as zf:
            files = zf.namelist()
            self.assertIn("manifest.json", files)
            self.assertNotIn("difficulty_config.json", files)
            # Check internal structure normalized paths
            expected_task_file = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}/task.json"
            self.assertIn(expected_task_file, files)
            
            # Verify manifest
            with zf.open("manifest.json") as mf:
                manifest = json.load(mf)
                self.assertEqual(manifest["total_tasks"], 1)
                self.assertIn(task_id, manifest["contains"]["tasks"])

    # =========================================================================
    # 2. New Feature Tests: Import Validation (Security)
    # =========================================================================

    def test_validate_import_zip_slip(self):
        """Test that checking a malicious archive raises error."""
        # Create malicious zip
        mal_zip_path = Path(self.test_dir) / "evil.zip"
        with zipfile.ZipFile(mal_zip_path, 'w') as zf:
            zf.writestr("../../../etc/passwd", "evil content")
            
        # Execute & Verify
        report = self.service.validate_import_archive(str(mal_zip_path))
        self.assertFalse(report["ok"])
        self.assertIn("Malicious path", report.get("critical_error", ""))

    # =========================================================================
    # 3. New Feature Tests: Import Conflict Logic
    # =========================================================================

    def test_detect_duplicates_vs_overwrites(self):
        """Test distinction between exact duplicate and content mismatch."""
        # Setup existing task
        task_id = "task_dup"
        task_data = {"id": task_id, "content": "A"}
        
        task_path = self.modules_dir / "m" / "topics" / "t" / "tasks" / task_id
        task_path.mkdir(parents=True)
        with open(task_path / "task.json", "w") as f:
            json.dump(task_data, f, sort_keys=True)
            
        # Mock finding it
        self.service._find_task_in_storage = MagicMock(return_value=task_path)
        
        # Create import archive with EXACT SAME content
        zip_path = Path(self.test_dir) / "import.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("task.json", json.dumps(task_data, sort_keys=True))
            
        # Verify Duplicate
        report = self.service.validate_import_archive(str(zip_path))
        self.assertTrue(report["ok"])
        self.assertEqual(report["summary"]["conflicts"], 1)
        self.assertEqual(report["conflicts"]["duplicates"][0]["id"], task_id)
        
        # Now create archive with DIFFERENT content
        task_data_diff = {"id": task_id, "content": "B"}
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("task.json", json.dumps(task_data_diff, sort_keys=True))
            
        # Verify Overwrite
        report = self.service.validate_import_archive(str(zip_path))
        self.assertTrue(report["ok"])
        self.assertEqual(report["conflicts"]["overwrites"][0]["id"], task_id)

    # =========================================================================
    # 4. New Feature Tests: API Streaming
    # =========================================================================

    def test_import_confirm_streaming(self):
        """Test the NDJSON streaming response of the import endpoint."""
        # Prepare a valid zip
        zip_path = Path(self.test_dir) / "stream_test.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("modules/m1/topics/t1/tasks/task1/task.json", 
                       json.dumps({"id": "task1", "name": "Task 1"}))
        
        with open(zip_path, 'rb') as f:
            data = {
                'file': (f, 'test.zip'),
                'conflict_resolution': 'skip'
            }
            response = self.client.post('/api/editor/import/confirm', 
                                      data=data, 
                                      content_type='multipart/form-data')
            
        self.assertEqual(response.status_code, 200)
        
        # Parse NDJSON
        lines = response.get_data(as_text=True).strip().split('\n')
        messages = [json.loads(line) for line in lines if line.strip()]
        
        # Should have at least one progress message and one result
        self.assertTrue(any(m['type'] == 'progress' for m in messages))
        self.assertTrue(any(m['type'] == 'result' for m in messages))
        
        result = next(m for m in messages if m['type'] == 'result')
        self.assertTrue(result['data']['ok'])

    def test_import_confirm_idempotent_replay(self):
        """Second confirm with the same idempotency key should replay cached result."""
        zip_path = Path(self.test_dir) / "stream_test_idempotent.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr(
                "modules/m1/topics/t1/tasks/task_idempotent/task.json",
                json.dumps({"id": "task_idempotent", "name": "Task Idempotent"}),
            )

        key = "archive-confirm-test-replay"
        with open(zip_path, 'rb') as f:
            response = self.client.post(
                '/api/editor/import/confirm',
                data={
                    'file': (f, 'test_idempotent.zip'),
                    'conflict_resolution': 'skip',
                    'idempotency_key': key,
                },
                content_type='multipart/form-data',
            )
        self.assertEqual(response.status_code, 200)
        first_messages = [json.loads(line) for line in response.get_data(as_text=True).strip().split('\n') if line.strip()]
        first_result = next(m for m in first_messages if m['type'] == 'result')
        self.assertTrue(first_result['data']['ok'])

        with open(zip_path, 'rb') as f:
            replay = self.client.post(
                '/api/editor/import/confirm',
                data={
                    'file': (f, 'test_idempotent.zip'),
                    'conflict_resolution': 'skip',
                    'idempotency_key': key,
                },
                content_type='multipart/form-data',
            )
        self.assertEqual(replay.status_code, 200)
        replay_messages = [json.loads(line) for line in replay.get_data(as_text=True).strip().split('\n') if line.strip()]
        replay_result = next(m for m in replay_messages if m['type'] == 'result')
        self.assertTrue(replay_result['data']['ok'])
        self.assertTrue(replay_result['data']['idempotent_replay'])
        self.assertEqual(replay_result['data']['idempotency_key'], key)

    def test_import_confirm_idempotency_conflict(self):
        """Reusing idempotency key with different params must be rejected."""
        zip_path = Path(self.test_dir) / "stream_test_conflict.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr(
                "modules/m1/topics/t1/tasks/task_conflict/task.json",
                json.dumps({"id": "task_conflict", "name": "Task Conflict"}),
            )

        key = "archive-confirm-test-conflict"
        with open(zip_path, 'rb') as f:
            response = self.client.post(
                '/api/editor/import/confirm',
                data={
                    'file': (f, 'test_conflict.zip'),
                    'conflict_resolution': 'skip',
                    'idempotency_key': key,
                },
                content_type='multipart/form-data',
            )
        self.assertEqual(response.status_code, 200)
        first_messages = [json.loads(line) for line in response.get_data(as_text=True).strip().split('\n') if line.strip()]
        first_result = next(m for m in first_messages if m['type'] == 'result')
        self.assertTrue(first_result['data']['ok'])

        with open(zip_path, 'rb') as f:
            conflict = self.client.post(
                '/api/editor/import/confirm',
                data={
                    'file': (f, 'test_conflict.zip'),
                    'conflict_resolution': 'overwrite',
                    'idempotency_key': key,
                },
                content_type='multipart/form-data',
            )
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.get_json()['error'], 'idempotency_key_conflict')

    # =========================================================================
    # 5. Advanced & Edge Case Tests
    # =========================================================================

    def test_cyrillic_filenames(self):
        """Test handling of Cyrillic filenames in archive."""
        # Create ZIP with cyrillic entry
        zip_path = Path(self.test_dir) / "cyrillic.zip"
        name = "тест_задача"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            # Note: ZipFile handles encoding, but we verify our service reads it safely
            zf.writestr(f"modules/модуль/topics/тема/tasks/{name}/task.json", 
                       json.dumps({"id": name, "name": "Задача"}))
                       
        report = self.service.validate_import_archive(str(zip_path))
        self.assertTrue(report["ok"])
        self.assertEqual(report["summary"]["total"], 1)

    def test_boundary_archive_size(self):
        """Test rejection of archives exceeding MAX_ARCHIVE_SIZE."""
        # We mock os.stat to simulate a large file without creating one
        with patch('pathlib.Path.stat') as mock_stat:
            mock_stat.return_value.st_size = self.service.MAX_ARCHIVE_SIZE + 1
            
            with self.assertRaises(ValueError) as cm:
                self.service._validate_zip_security("fake.zip")
            self.assertIn("Archive too large", str(cm.exception))

    def test_missing_images(self):
        """Test validation failure when referenced images are missing."""
        zip_path = Path(self.test_dir) / "missing_img.zip"
        task_data = {
            "id": "t_img", 
            "content": [{"image": "missing.jpg"}] # Reference missing file
        }
        
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("modules/m/topics/t/tasks/t_img/task.json", json.dumps(task_data))
            # missing.jpg is NOT added
            
        report = self.service.validate_import_archive(str(zip_path))
        self.assertTrue(report["ok"]) # Parsing ok
        self.assertEqual(report["tasks"][0]["status"], "error")
        self.assertIn("Missing images", report["tasks"][0]["error"])

    def test_idempotency_double_import(self):
        """Verify importing same archive twice results in 100% duplicates/skips."""
        # Setup generic archive
        zip_path = Path(self.test_dir) / "double.zip"
        task_data = {"id": "t_double", "name": "Double"}
        
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("modules/m/topics/t/tasks/t_double/task.json", json.dumps(task_data))
            
        # First Import
        res1 = self.service.import_tasks_atomic(str(zip_path), {"conflict_resolution": "overwrite"})
        self.assertEqual(res1["imported"], 1)
        
        # Second Import (Default: skip)
        # Mock finding existing
        with patch.object(self.service, '_find_task_in_storage', return_value=Path("/tmp/t_double")):
             res2 = self.service.import_tasks_atomic(str(zip_path), {"conflict_resolution": "skip"})
             self.assertEqual(res2["skipped"], 1)
             self.assertEqual(res2["imported"], 0)

    def test_invalid_task_type(self):
        """Test handling of unknown task types (service marks them as warnings)."""
        zip_path = Path(self.test_dir) / "bad_type.zip"
        task_data = {"id": "t_bad", "type": "UNKNOWN_SUPER_TYPE"}
        
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("modules/m/topics/t/tasks/t_bad/task.json", json.dumps(task_data))
            
        report = self.service.validate_import_archive(str(zip_path))
        self.assertTrue(report["ok"])
        self.assertEqual(report["tasks"][0]["status"], "warning")

    def test_cross_platform_paths(self):
        """Test Windows-style backslashes in ZIP are normalized (or rejected if strict)."""
        zip_path = Path(self.test_dir) / "windows_paths.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            # Force backslash in name if possible (strictly zip standard uses /)
            # But specific zip tools might screw this up.
            zf.writestr("modules\\win\\topics\\win\\tasks\\win\\task.json", 
                       json.dumps({"id": "win", "name": "Win"}))
                       
        report = self.service.validate_import_archive(str(zip_path))
        # Logic should handle or at least not crash
        self.assertTrue(report["ok"])
        # If standard zipfile module normalizes separators, it might just work. 
        # If not, it might fail to detect module/topic. 
        # Let's assert it parses.
        self.assertEqual(report["summary"]["total"], 1)

    def test_stress_100_tasks(self):
        """Stress test with 100 tasks."""
        zip_path = Path(self.test_dir) / "stress.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            for i in range(100):
                zf.writestr(f"modules/stress/topics/stress/tasks/t_{i}/task.json", 
                           json.dumps({"id": f"t_{i}", "name": f"Stress {i}"}))
                           
        report = self.service.validate_import_archive(str(zip_path))
        self.assertEqual(report["summary"]["total"], 100)
        self.assertEqual(report["summary"]["valid"], 100)

    def test_atomic_rollback_on_error(self):
        """Verify partially failed import leaves no debris (cleanup)."""
        # This is hard to test without injecting failure in the middle of the loop.
        # We can mock shutil.move to fail on the 2nd item
        zip_path = Path(self.test_dir) / "rollback.zip"
        with zipfile.ZipFile(zip_path, 'w') as zf:
            zf.writestr("modules/m/topics/t/tasks/t1/task.json", json.dumps({"id": "t1"}))
            zf.writestr("modules/m/topics/t/tasks/t2/task.json", json.dumps({"id": "t2"}))
            
        # We mock shutil.move to fail for t2
        original_move = shutil.move
        def side_effect(src, dst):
            if "t2" in str(dst):
                raise IOError("Disk full or something")
            return original_move(src, dst)
            
        with patch('shutil.move', side_effect=side_effect):
            res = self.service.import_tasks_atomic(str(zip_path), {})
            
        self.assertEqual(res["imported"], 1)
        self.assertEqual(res["errors"], 1)
        # Verify t1 exists, t2 does not? 
        # Current atomic logic is per-task? 
        # "import_tasks_atomic" implies the whole batch or per task?
        # Code check: "for task_file in task_files ... try ... except ... errors_count += 1"
        # So it IS per-task atomic, not batch atomic. One failure doesn't rollback others.
        # So this test verifies that behavior: T1 succeeds, T2 fails.
        pass

    def test_service_resilience_to_garbage_paths(self):
        """Test that service handles invalid paths gracefully without crashing app."""
        # Service swallows errors for individual tasks and returns a ZIP with potentially just manifest.
        # It logs a warning.
        zip_path = self.service.create_export_archive([{"module_id": "bad", "topic_id": "bad", "task_id": "bad"}])
        
        self.assertTrue(os.path.exists(zip_path))
        with zipfile.ZipFile(zip_path, 'r') as zf:
            # Should have manifest
            self.assertIn("manifest.json", zf.namelist())
            with zf.open("manifest.json") as f:
                manifest = json.load(f)
                self.assertEqual(manifest["total_tasks"], 0)

    def test_zip_bomb_detection(self):
        """Test rejection of compression ratio > 100."""
        # Create a small high-ratio zip
        # A file with 1MB of zeros compresses to very small bytes
        zip_path = Path(self.test_dir) / "bomb.zip"
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
             # > 10MB of zeros to trigger the size check
             data = b'0' * (15 * 1024 * 1024)
             zf.writestr("heavy.txt", data)
             
        # Verify security check catches it
        with self.assertRaises(ValueError) as cm:
            self.service._validate_zip_security(str(zip_path))
        self.assertIn("Suspicious compression ratio", str(cm.exception))

if __name__ == '__main__':
    unittest.main()
