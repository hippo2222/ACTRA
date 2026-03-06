
import json
import logging
import os
import shutil
import tempfile
import uuid
import hashlib
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Tuple

# Type definitions
TaskConflict = Dict[str, Any]
ImportReport = Dict[str, Any]

class ImportExportService:
    """
    Service for safe Import/Export of tasks via ZIP archives.
    
    Features:
    - Secure ZIP extraction (Zip Slip protection)
    - Manifest generation/validation
    - Atomic import transactions
    - Task conflict detection via MD5
    """
    
    MAX_ARCHIVE_SIZE = 200 * 1024 * 1024  # 200MB
    MAX_UNCOMPRESSED_RATIO = 100
    MAX_NESTING_LEVEL = 10
    ALLOWED_EXTENSIONS = {'.json', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
    IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'}
    
    def __init__(self, storage_service):
        self.storage = storage_service
        self.logger = logging.getLogger(self.__class__.__name__)
        self._app_version = self._read_app_version()

    def _read_app_version(self) -> str:
        """Read app version from the shared task_system version source."""
        try:
            from task_system import __version__ as task_system_version
            if isinstance(task_system_version, str) and task_system_version.strip():
                return task_system_version.strip()
        except Exception:
            pass
        try:
            version_file = Path(__file__).resolve().parents[2] / "task_system" / "VERSION"
            if version_file.exists():
                return version_file.read_text(encoding="utf-8").strip()
        except Exception:
            pass
        return "0.0.0"
        
    # =========================================================================
    # EXPORT
    # =========================================================================
    
    def create_export_archive(self, tasks_list: List[Dict[str, str]]) -> str:
        """
        Create a ZIP archive containing the specified tasks.
        
        Args:
            tasks_list: List of dicts with keys 'module_id', 'topic_id', 'task_id'
            
        Returns:
            Path to the created temporary ZIP file
        """
        try:
            temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix='.zip', prefix='export_')
            temp_zip_path = temp_zip.name
            temp_zip.close()
            
            manifest_tasks = []
            manifest_modules = set()
            manifest_topics = set()
            
            with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for item in tasks_list:
                    module_id = item['module_id']
                    topic_id = item['topic_id']
                    task_id = item['task_id']
                    
                    # Resolve task directory
                    # Note: Using private method _resolve_task_dir indirectly via storage if possible,
                    # or creating a helper here. Since we are in the same package context usually,
                    # we can reconstruct the path if storage doesn't expose it publically.
                    # Best approach: Use storage.load_task to get metadata/path, but we need raw files.
                    
                    # Assuming standard structure for now based on project rules
                    task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
                    
                    if not task_dir.exists():
                        self.logger.warning(f"Task not found for export: {task_id}")
                        continue
                        
                    # Add to manifest tracking
                    manifest_tasks.append(task_id)
                    manifest_modules.add(module_id)
                    manifest_topics.add(topic_id)
                    
                    # Add task directory to ZIP
                    # Structure in ZIP: modules/{module_id}/topics/{topic_id}/tasks/{task_id}/...
                    arc_root = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}"
                    
                    for root, _, files in os.walk(task_dir):
                        for file in files:
                            file_path = Path(root) / file
                            # Calculate relative path inside the task directory
                            rel_path = file_path.relative_to(task_dir)
                            # Full path in archive
                            arc_name = f"{arc_root}/{rel_path}".replace('\\', '/')
                            zf.write(file_path, arc_name)
                            
                # Create and add manifest
                manifest = {
                    "export_date": datetime.utcnow().isoformat() + "Z",
                    "app_version": self._app_version,
                    "export_type": "tasks",
                    "total_tasks": len(manifest_tasks),
                    "contains": {
                        "modules": list(manifest_modules),
                        "topics": list(manifest_topics),
                        "tasks": manifest_tasks
                    }
                }
                zf.writestr("manifest.json", json.dumps(manifest, indent=2))
                
            self.logger.info(f"Exported {len(manifest_tasks)} tasks to {temp_zip_path}")
            return temp_zip_path
            
        except Exception as e:
            self.logger.error(f"Export failed: {e}")
            if 'temp_zip_path' in locals() and os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
            raise

    # =========================================================================
    # IMPORT: VALIDATION
    # =========================================================================

    def validate_import_archive(self, archive_path: str) -> ImportReport:
        """
        Validate ZIP archive for security and content.
        
        Returns a detailed report.
        """
        report = {
            "ok": False,
            "summary": {"total": 0, "valid": 0, "conflicts": 0, "errors": 0},
            "conflicts": {"duplicates": [], "overwrites": [], "broken_deps": []},
            "errors": [],
            "tasks": []
        }
        
        try:
            # 1. Security Checks
            self._validate_zip_security(archive_path)
            
            # 2. Structure Analysis
            with zipfile.ZipFile(archive_path, 'r') as zf:
                # Version compatibility check
                try:
                    manifest_raw = zf.read("manifest.json")
                    manifest_data = json.loads(manifest_raw)
                    archive_version = manifest_data.get("app_version", "")
                    report["archive_version"] = archive_version
                    if archive_version:
                        cur_major = self._app_version.split(".")[0]
                        arc_major = archive_version.split(".")[0]
                        if cur_major != arc_major:
                            report.setdefault("warnings", []).append(
                                f"Архив создан версией {archive_version}, "
                                f"текущая версия {self._app_version}. "
                                "Возможны проблемы совместимости."
                            )
                except (KeyError, json.JSONDecodeError):
                    report.setdefault("warnings", []).append(
                        "Архив не содержит manifest.json — невозможно проверить совместимость"
                    )

                # Find all task.json files
                task_files = [f for f in zf.namelist() if f.endswith('task.json')]
                report["summary"]["total"] = len(task_files)
                
                for task_file in task_files:
                    try:
                        task_report = self._analyze_task_in_archive(zf, task_file)
                        report["tasks"].append(task_report)
                        
                        if task_report['status'] == 'error':
                            report["summary"]["errors"] += 1
                            report["errors"].append({
                                "id": task_report['id'],
                                "name": task_report.get('name', 'Unknown'),
                                "error": task_report.get('error', 'Unknown error')
                            })
                        elif task_report['status'] == 'conflict':
                            report["summary"]["conflicts"] += 1
                            if task_report['conflict_type'] == 'duplicate':
                                report["conflicts"]["duplicates"].append(task_report)
                            else:
                                report["conflicts"]["overwrites"].append(task_report)
                        else:
                            report["summary"]["valid"] += 1
                            
                    except Exception as te:
                        self.logger.error(f"Error analyzing task {task_file}: {te}")
                        report["summary"]["errors"] += 1
                        
            report["ok"] = True
            return report
            
        except Exception as e:
            self.logger.error(f"Validation failed: {e}")
            report["critical_error"] = str(e)
            return report

    def _validate_zip_security(self, archive_path: str):
        """Perform security checks on the ZIP file."""
        path_obj = Path(archive_path)
        
        # Check size
        if path_obj.stat().st_size > self.MAX_ARCHIVE_SIZE:
            raise ValueError(f"Archive too large: {path_obj.stat().st_size} bytes")
            
        with zipfile.ZipFile(archive_path, 'r') as zf:
            total_size = 0
            for info in zf.infolist():
                # Zip Slip check
                if '..' in info.filename or os.path.isabs(info.filename):
                    raise ValueError(f"Malicious path detected: {info.filename}")
                
                # Nesting check
                if info.filename.count('/') > self.MAX_NESTING_LEVEL:
                    raise ValueError(f"Directory nesting too deep: {info.filename}")
                    
                # Compression ratio check (Zip Bomb)
                if info.file_size > 0: # Avoid division by zero
                    ratio = info.file_size / (info.compress_size if info.compress_size > 0 else 1)
                    if ratio > self.MAX_UNCOMPRESSED_RATIO and info.file_size > 10 * 1024 * 1024:
                        raise ValueError(f"Suspicious compression ratio for {info.filename}")
                
                total_size += info.file_size
                
            if total_size > self.MAX_ARCHIVE_SIZE * 2: # Limit unpacked size too
                 raise ValueError(f"Unpacked size too large: {total_size} bytes")

    def _analyze_task_in_archive(self, zf: zipfile.ZipFile, task_file_path: str) -> Dict[str, Any]:
        """Analyze a single task within the archive."""
        res = {"status": "valid"}
        
        try:
            with zf.open(task_file_path) as f:
                data = json.load(f)
                
            task_id = data.get('id') or data.get('meta', {}).get('id')
            if not task_id:
                return {"status": "error", "error": "Missing task ID in task.json"}
                
            res["id"] = task_id
            res["name"] = data.get('name') or data.get('meta', {}).get('name') or task_id
            res["path"] = task_file_path
            
            # Identify intended module/topic from path if possible
            # Accepted path format: modules/{module}/topics/{topic}/tasks/{task}/task.json
            parts = task_file_path.split('/')
            if len(parts) >= 6 and parts[0] == 'modules' and parts[2] == 'topics':
                res["target_module"] = parts[1]
                res["target_topic"] = parts[3]
            
            # Validate task type and basic structure
            task_type = data.get('type', '')
            res["type"] = task_type
            known_types = {'open_answer', 'sequence_assembly', 'click', 'test'}
            if task_type and task_type not in known_types:
                res["status"] = "warning"
                res.setdefault("warnings", []).append(
                    f"Неизвестный тип задания: {task_type}"
                )
            if not data.get('content') and not data.get('data'):
                res.setdefault("warnings", []).append("Задание не содержит content/data")

            # Check dependencies (images)
            missing_images = self._check_task_dependencies(data, zf, Path(task_file_path).parent)
            if missing_images:
                res["status"] = "error"
                res["error"] = f"Missing images: {', '.join(missing_images)}"
                return res
            
            # Check for existence/conflict
            # We need to scan all existing modules to see if this task ID exists
            existing_path = self._find_task_in_storage(task_id)
            if existing_path:
                res["exists"] = True
                res["existing_path"] = str(existing_path.relative_to(self.storage.data_dir))
                
                # Check for content match (duplicate)
                # Parse existing file
                try:
                    with open(existing_path / "task.json", 'r', encoding='utf-8') as ef:
                        existing_data = json.load(ef)
                    
                    # Compute hashes (normalized)
                    hash_new = self._compute_json_hash(data)
                    hash_old = self._compute_json_hash(existing_data)
                    
                    if hash_new == hash_old:
                        res["status"] = "conflict"
                        res["conflict_type"] = "duplicate"
                        res["content_match"] = True
                    else:
                        res["status"] = "conflict"
                        res["conflict_type"] = "overwrite"
                        res["content_match"] = False
                        # Diff summary: list top-level keys that differ
                        changed_keys = []
                        all_keys = set(data.keys()) | set(existing_data.keys())
                        for k in sorted(all_keys):
                            if k in self._HASH_EXCLUDE_KEYS:
                                continue
                            old_val = existing_data.get(k)
                            new_val = data.get(k)
                            if old_val != new_val:
                                changed_keys.append(k)
                        res["diff_keys"] = changed_keys
                except Exception:
                    # If we can't read existing, assume overwrite conflict
                    res["status"] = "conflict"
                    res["conflict_type"] = "overwrite"
                    res["content_match"] = False
            else:
                res["exists"] = False
                
            return res
            
        except json.JSONDecodeError:
            return {"status": "error", "error": "Invalid JSON in task.json"}
        except Exception as e:
            return {"status": "error", "error": str(e)}

    # Keys that may hold image file references
    _IMAGE_REF_KEYS = frozenset({
        'image', 'src', 'url', 'background_image', 'icon',
        'thumbnail', 'avatar', 'photo', 'picture', 'file',
    })

    def _check_task_dependencies(self, task_data: Dict, zf: zipfile.ZipFile, task_root: str) -> List[str]:
        """Check if all referenced images exist in the archive."""
        missing = []
        
        def scan_for_images(obj, parent_key: str = ""):
            if isinstance(obj, dict):
                for k, v in obj.items():
                    scan_for_images(v, k)
            elif isinstance(obj, list):
                for item in obj:
                    scan_for_images(item, parent_key)
            elif isinstance(obj, str) and parent_key.lower() in self._IMAGE_REF_KEYS:
                lower = obj.lower()
                if any(lower.endswith(ext) for ext in self.IMAGE_EXTENSIONS):
                    if not obj.startswith('http') and not obj.startswith('data:'):
                        target_path = (Path(task_root) / obj).as_posix()
                        try:
                            zf.getinfo(target_path)
                        except KeyError:
                            missing.append(obj)
                            
        scan_for_images(task_data)
        return missing

    def _build_task_index(self) -> Dict[str, Path]:
        """Build a task_id → path index from storage (called once per import)."""
        index: Dict[str, Path] = {}
        modules = self.storage.load_modules()
        for module in modules:
            for topic in module.get('topics', []):
                for task in topic.get('tasks', []):
                    tid = task.get('id')
                    if tid:
                        index[tid] = (
                            self.storage.modules_dir / module['id']
                            / "topics" / topic['id'] / "tasks" / tid
                        )
        return index

    def _find_task_in_storage(self, task_id: str, index: Optional[Dict[str, Path]] = None) -> Optional[Path]:
        """Find path to existing task directory by ID.
        
        If an index dict is provided, O(1) lookup. Otherwise falls back to full scan.
        """
        if index is not None:
            return index.get(task_id)
        # Fallback: full scan (used outside batch context)
        modules = self.storage.load_modules()
        for module in modules:
            for topic in module.get('topics', []):
                for task in topic.get('tasks', []):
                    if task.get('id') == task_id:
                        return (
                            self.storage.modules_dir / module['id']
                            / "topics" / topic['id'] / "tasks" / task_id
                        )
        return None

    # Keys excluded from hash comparison (volatile metadata)
    _HASH_EXCLUDE_KEYS = frozenset({
        'created_at', 'updated_at', 'import_date', 'import_source',
        'last_modified', 'modified_at',
    })

    def _compute_json_hash(self, data: Dict) -> str:
        """Compute stable MD5 hash of JSON data, ignoring volatile metadata."""
        cleaned = self._strip_volatile_keys(data)
        text = json.dumps(cleaned, sort_keys=True, ensure_ascii=False)
        return hashlib.md5(text.encode('utf-8')).hexdigest()

    def _strip_volatile_keys(self, obj):
        """Recursively remove volatile keys from data for stable comparison."""
        if isinstance(obj, dict):
            return {k: self._strip_volatile_keys(v) for k, v in obj.items()
                    if k not in self._HASH_EXCLUDE_KEYS}
        elif isinstance(obj, list):
            return [self._strip_volatile_keys(item) for item in obj]
        return obj

    # =========================================================================
    # IMPORT: EXECUTION
    # =========================================================================
    
    def import_tasks_atomic(
        self, 
        archive_path: str, 
        params: Dict[str, Any],
        progress_callback: Optional[Any] = None
    ) -> ImportReport:
        """
        Execute import of tasks from archive.

        Args:
            archive_path: Path to validated ZIP
            params: {
                'conflict_resolution': 'overwrite' | 'new_id' | 'skip',
                'target_module_id': str (optional),
                'target_topic_id': str (optional),
                'skip_errors': bool
            }
            progress_callback: Optional function (current, total, status) -> None
            
        Returns:
            Dict with results
        """
        temp_extract_dir = Path(tempfile.mkdtemp(prefix="import_extract_"))
        
        try:
            imported_count = 0
            skipped_count = 0
            errors_count = 0
            skip_errors = bool(params.get('skip_errors', True))
            # Track successfully imported paths for rollback
            imported_paths: List[Path] = []
            # Track overwritten originals for rollback restoration
            overwrite_backups: List[Tuple[Path, Path]] = []  # (backup_dir, original_dest)
            
            if progress_callback:
                progress_callback(0, 0, "Extracting archive...")

            # 1. Extract only allowed files (BUG-2 fix: filter by ALLOWED_EXTENSIONS)
            archive_manifest = None
            with zipfile.ZipFile(archive_path, 'r') as zf:
                # Read manifest before extraction for later saving
                try:
                    archive_manifest = json.loads(zf.read("manifest.json"))
                except (KeyError, json.JSONDecodeError):
                    pass

                for member in zf.infolist():
                    if member.is_dir():
                        continue
                    ext = Path(member.filename).suffix.lower()
                    if ext not in self.ALLOWED_EXTENSIONS:
                        self.logger.warning(f"Skipping disallowed file in archive: {member.filename}")
                        continue
                    zf.extract(member, temp_extract_dir)
                
            # 2. Process extracted files
            # Scan for all task.json files in extracted structure
            task_files = list(temp_extract_dir.rglob("task.json"))
            total_tasks = len(task_files)
            
            # Build task index once for O(1) conflict lookups (WEAK-7 fix)
            task_index = self._build_task_index()
            
            for i, task_file in enumerate(task_files):
                task_dir = task_file.parent
                
                try:
                    with open(task_file, 'r', encoding='utf-8') as f:
                        task_data = json.load(f)
                        
                    task_id = task_data.get('id')
                    task_name = task_data.get('name', task_id)

                    if progress_callback:
                        progress_callback(i + 1, total_tasks, f"Importing {task_name}...")

                    target_module = params.get('target_module_id')
                    target_topic = params.get('target_topic_id')
                    # Per-task conflict override (index → resolution)
                    per_task = params.get('per_task_conflict', {})
                    conflict_res = per_task.get(str(i), params.get('conflict_resolution', 'skip'))
                    
                    # If target module/topic not specified in params, try to infer from structure
                    # Structure: modules/{MOD}/topics/{TOP}/tasks/{TASK}
                    rel_parts = task_file.relative_to(temp_extract_dir).parts
                    if not target_module and len(rel_parts) >= 5 and rel_parts[0] == 'modules':
                         target_module = rel_parts[1]
                    if not target_topic and len(rel_parts) >= 5 and rel_parts[2] == 'topics':
                         target_topic = rel_parts[3]
                         
                    if not target_module or not target_topic:
                        target_module = target_module or "imported_tasks"
                        target_topic = target_topic or datetime.now().strftime("import_%Y%m%d")
                    
                    # Ensure targets exist
                    self._ensure_module_topic_exists(target_module, target_topic)
                    
                    # Prepare destination
                    dest_path = self.storage.modules_dir / target_module / "topics" / target_topic / "tasks" / task_id
                    
                    # Handle conflict
                    existing_path = self._find_task_in_storage(task_id, index=task_index)
                    
                    if existing_path:
                        # If existing, dest_path should point to where it ACTUALLY is
                        dest_path = existing_path
                        
                        if conflict_res == 'skip':
                            skipped_count += 1
                            continue
                        elif conflict_res == 'new_id':
                            # Generate new ID
                            new_id = str(uuid.uuid4())
                            task_data['id'] = new_id
                            task_data['name'] = f"{task_data.get('name', 'Task')} (Copy)"
                            # Update JSON
                            with open(task_file, 'w', encoding='utf-8') as f:
                                json.dump(task_data, f, indent=2, ensure_ascii=False)
                            
                            # Adjust destination
                            task_id = new_id
                            dest_path = self.storage.modules_dir / target_module / "topics" / target_topic / "tasks" / task_id
                        elif conflict_res == 'overwrite':
                            # Backup original before overwriting for rollback
                            if dest_path.exists():
                                backup_dir = Path(tempfile.mkdtemp(prefix="import_backup_"))
                                backup_task = backup_dir / dest_path.name
                                shutil.copytree(str(dest_path), str(backup_task))
                                overwrite_backups.append((backup_task, dest_path))
                            
                    # Move logic
                    if dest_path.exists():
                        shutil.rmtree(dest_path)
                    
                    shutil.move(str(task_dir), str(dest_path))
                    imported_paths.append(dest_path)
                    imported_count += 1
                    
                except Exception as e:
                    self.logger.error(f"Failed to import task {task_file}: {e}")
                    errors_count += 1
                    
                    if not skip_errors:
                        # Rollback all previously imported tasks
                        self.logger.warning(f"Rollback triggered: reverting {len(imported_paths)} imported tasks")
                        for imp_path in imported_paths:
                            try:
                                if imp_path.exists():
                                    shutil.rmtree(imp_path)
                            except Exception as rb_err:
                                self.logger.error(f"Rollback failed for {imp_path}: {rb_err}")
                        # Restore overwritten originals
                        for backup_task, original_dest in overwrite_backups:
                            try:
                                if not original_dest.exists() and backup_task.exists():
                                    shutil.move(str(backup_task), str(original_dest))
                            except Exception as rb_err:
                                self.logger.error(f"Rollback restore failed for {original_dest}: {rb_err}")
                        
                        self.storage.reload_modules()
                        return {
                            "ok": False,
                            "imported": 0,
                            "skipped": skipped_count,
                            "errors": errors_count,
                            "rollback": True,
                            "error_message": str(e)
                        }
            
            # Reload storage cache
            self.storage.reload_modules()
            
            if progress_callback:
                progress_callback(total_tasks, total_tasks, "Done")

            result = {
                "ok": True,
                "imported": imported_count,
                "skipped": skipped_count,
                "errors": errors_count
            }
            # Save archive manifest for provenance tracking (MISSING-7)
            if archive_manifest and imported_count > 0:
                try:
                    manifests_dir = self.storage.modules_dir.parent / "import_manifests"
                    manifests_dir.mkdir(exist_ok=True)
                    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                    manifest_file = manifests_dir / f"manifest_{ts}.json"
                    archive_manifest["import_date"] = datetime.now().isoformat()
                    archive_manifest["imported_count"] = imported_count
                    manifest_file.write_text(
                        json.dumps(archive_manifest, indent=2, ensure_ascii=False),
                        encoding="utf-8"
                    )
                except Exception as e:
                    self.logger.warning(f"Failed to save import manifest: {e}")

            self._log_import(archive_path, result)
            return result
            
        finally:
            # Cleanup temp
            if temp_extract_dir.exists():
                shutil.rmtree(temp_extract_dir)
            # Cleanup overwrite backups
            for backup_task, _ in overwrite_backups:
                try:
                    backup_root = backup_task.parent
                    if backup_root.exists():
                        shutil.rmtree(backup_root)
                except Exception:
                    pass

    def _log_import(self, archive_path: str, result: Dict[str, Any]):
        """Append import event to import_journal.json."""
        try:
            journal_path = self.storage.modules_dir.parent / "import_journal.json"
            entries = []
            if journal_path.exists():
                try:
                    entries = json.loads(journal_path.read_text(encoding="utf-8"))
                except (json.JSONDecodeError, Exception):
                    entries = []
            entries.append({
                "timestamp": datetime.now().isoformat(),
                "archive": Path(archive_path).name,
                "imported": result.get("imported", 0),
                "skipped": result.get("skipped", 0),
                "errors": result.get("errors", 0),
                "rollback": result.get("rollback", False),
            })
            # Keep last 200 entries
            if len(entries) > 200:
                entries = entries[-200:]
            journal_path.write_text(
                json.dumps(entries, indent=2, ensure_ascii=False), encoding="utf-8"
            )
        except Exception as e:
            self.logger.warning(f"Failed to write import journal: {e}")

    def _ensure_module_topic_exists(self, module_id: str, topic_id: str):
        """Create module/topic directories if they don't exist."""
        mod_dir = self.storage.modules_dir / module_id
        if not mod_dir.exists():
            mod_dir.mkdir(parents=True)
            with open(mod_dir / "module.json", 'w', encoding='utf-8') as f:
                json.dump({"id": module_id, "name": module_id}, f)
                
        topic_dir = mod_dir / "topics" / topic_id
        if not topic_dir.exists():
            topic_dir.mkdir(parents=True)
            with open(topic_dir / "topic.json", 'w', encoding='utf-8') as f:
                json.dump({"id": topic_id, "name": topic_id}, f)
        
        (topic_dir / "tasks").mkdir(exist_ok=True)
