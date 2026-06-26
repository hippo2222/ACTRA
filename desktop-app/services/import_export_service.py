
import json
import logging
import os
import shutil
import tempfile
import uuid
import hashlib
import zipfile
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Set, Tuple
from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV
from services.hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from services.package_io import PackageIO

# Type definitions
TaskConflict = Dict[str, Any]
ImportReport = Dict[str, Any]

_WORKSPACE_IMPORT_MARKER_KEYS = (
    "source_complex_id",
    "source_catalog_item_id",
    "source_catalog_version_id",
    "prefer_existing_by_lineage",
    "requested_by_user_id",
)

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
    SERVICE_CONTRACT = {
        "namespace": "public_editor_import_export",
        "import_family": "text_or_archive_task_import",
        "workspace_import": False,
        "public_api": True,
    }
    _IMAGE_REF_PATH_KEYS = ("path", "image_path", "src", "image")
    _IMAGE_REF_ASSET_ID_KEYS = ("asset_id", "image_asset_id")
    _IMAGE_REF_ASSET_URL_KEYS = ("asset_url", "image_asset_url", "image_url")
    _IMAGE_REF_PARENT_KEYS = frozenset({
        "image", "images", "background_image", "thumbnail", "avatar", "photo", "picture", "icon", "file"
    })
    
    def __init__(self, storage_service, asset_service=None):
        self.storage = storage_service
        self.asset_service = asset_service
        self.logger = logging.getLogger(self.__class__.__name__)
        self._app_version = self._read_app_version()
        self.package_io = PackageIO()

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

    @classmethod
    def _with_service_contract(cls, payload: Any) -> Any:
        if not isinstance(payload, dict):
            return payload
        normalized = dict(payload)
        normalized["service_contract"] = dict(cls.SERVICE_CONTRACT)
        return normalized

    def _reject_workspace_import_params(self, params: Any, *, context: str) -> None:
        if not isinstance(params, dict):
            return
        markers = [key for key in _WORKSPACE_IMPORT_MARKER_KEYS if key in params]
        if markers:
            raise ValueError(
                f"workspace_import_params_not_supported:{context}:{','.join(markers)}"
            )
        
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
            module_names = {}
            topic_names = {}
            
            with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                for item in tasks_list:
                    module_id = item['module_id']
                    topic_id = item['topic_id']
                    task_id = item['task_id']

                    if module_id not in module_names:
                        try:
                            mod = self.storage.get_module(module_id)
                            if isinstance(mod, dict) and isinstance(mod.get("name"), str):
                                module_names[module_id] = mod["name"]
                        except Exception as e:
                            self.logger.warning(f"Could not retrieve module name for {module_id}: {e}")

                    if module_id not in topic_names:
                        topic_names[module_id] = {}
                    if topic_id not in topic_names[module_id]:
                        try:
                            top = self.storage.get_topic(module_id, topic_id)
                            if isinstance(top, dict) and isinstance(top.get("name"), str):
                                topic_names[module_id][topic_id] = top["name"]
                        except Exception as e:
                            self.logger.warning(f"Could not retrieve topic name for {module_id}/{topic_id}: {e}")

                    loaded_task = None
                    if hasattr(self.storage, "load_task"):
                        loaded_task = self.storage.load_task(module_id, topic_id, task_id)

                    arc_root = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}"
                    if isinstance(loaded_task, dict) and isinstance(loaded_task.get("task_data"), dict):
                        manifest_tasks.append(task_id)
                        manifest_modules.add(module_id)
                        manifest_topics.add(topic_id)
                        task_payload = json.loads(
                            json.dumps(loaded_task.get("task_data"), ensure_ascii=False)
                        )
                        task_dir_value = loaded_task.get("task_dir")
                        if isinstance(task_dir_value, str) and task_dir_value.strip():
                            task_dir = Path(task_dir_value)
                        else:
                            task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id

                        staged_assets: Dict[str, Path] = {}
                        task_payload, _ = self._rewrite_task_payload_image_refs(
                            task_payload,
                            task_dir,
                            staged_assets=staged_assets,
                            allow_stage_external=True,
                            allow_asset_resolution=True,
                        )
                        zf.writestr(
                            f"{arc_root}/task.json",
                            json.dumps(
                                task_payload,
                                indent=2,
                                ensure_ascii=False,
                            ).encode("utf-8"),
                        )
                        for portable_rel_path, source_path in staged_assets.items():
                            arc_name = f"{arc_root}/{portable_rel_path}".replace("\\", "/")
                            zf.write(source_path, arc_name)
                        continue

                    from routes._context import is_hosted_web_runtime
                    if is_hosted_web_runtime():
                        self.logger.warning(f"Task not found in hosted storage for export: {task_id}")
                        continue

                    task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
                    if not task_dir.exists():
                        self.logger.warning(f"Task not found for export: {task_id}")
                        continue
                    manifest_tasks.append(task_id)
                    manifest_modules.add(module_id)
                    manifest_topics.add(topic_id)

                    staged_assets: Dict[str, Path] = {}
                    for root, _, files in os.walk(task_dir):
                        for file in files:
                            file_path = Path(root) / file
                            rel_path = file_path.relative_to(task_dir)
                            arc_name = f"{arc_root}/{rel_path}".replace('\\', '/')
                            if file_path.name == "task.json":
                                try:
                                    task_payload = json.loads(file_path.read_text(encoding="utf-8"))
                                    task_payload, _ = self._rewrite_task_payload_image_refs(
                                        task_payload,
                                        task_dir,
                                        staged_assets=staged_assets,
                                        allow_stage_external=True,
                                        allow_asset_resolution=True,
                                    )
                                    zf.writestr(
                                        arc_name,
                                        json.dumps(
                                            task_payload,
                                            indent=2,
                                            ensure_ascii=False,
                                        ).encode("utf-8"),
                                    )
                                    continue
                                except Exception as exc:
                                    self.logger.warning(
                                        "Failed to sanitize exported task.json %s: %s",
                                        file_path,
                                        exc,
                                    )
                            zf.write(file_path, arc_name)

                    for portable_rel_path, source_path in staged_assets.items():
                        arc_name = f"{arc_root}/{portable_rel_path}".replace("\\", "/")
                        zf.write(source_path, arc_name)
                            
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
                    },
                    "module_names": module_names,
                    "topic_names": topic_names
                }
                zf.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))
                
            self.logger.info(f"Exported {len(manifest_tasks)} tasks to {temp_zip_path}")
            return temp_zip_path
            
        except Exception as e:
            self.logger.error(f"Export failed: {e}")
            if 'temp_zip_path' in locals() and os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
            raise

    def _first_text(self, *values: Any) -> Optional[str]:
        for value in values:
            if isinstance(value, str):
                clean = value.strip()
                if clean:
                    return clean
        return None

    def _resolve_task_image_source(self, task_dir: Path, raw_path: Optional[str]) -> Optional[Path]:
        if not isinstance(raw_path, str) or not raw_path.strip():
            return None

        clean = raw_path.strip()
        raw = Path(clean)
        data_dir = getattr(self.storage, "data_dir", None)
        candidates: List[Path] = []

        if raw.is_absolute():
            candidates.append(raw)

        candidates.append(task_dir / raw)
        if isinstance(data_dir, Path):
            candidates.append(data_dir / raw)

        basename = raw.name.strip()
        if basename:
            candidates.append(task_dir / basename)
            candidates.append(task_dir / "images" / basename)
            normalized = clean.replace("\\", "/")
            if "/images/" in normalized:
                image_suffix = normalized.split("/images/", 1)[-1]
                candidates.append(task_dir / "images" / image_suffix)

        seen: Set[str] = set()
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except FileNotFoundError:
                resolved = candidate
            key = resolved.as_posix().lower()
            if key in seen:
                continue
            seen.add(key)
            if resolved.exists() and resolved.is_file():
                return resolved
        return None

    def _make_staged_archive_asset_path(
        self,
        source_path: Path,
        staged_assets: Dict[str, Path],
    ) -> str:
        resolved = source_path.resolve()
        for rel_path, staged_source in staged_assets.items():
            try:
                if staged_source.resolve() == resolved:
                    return rel_path
            except Exception:
                continue

        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", source_path.stem).strip("._") or "image"
        safe_suffix = source_path.suffix.lower() or ".bin"
        rel_path = f"images/_archive_assets/{safe_stem}{safe_suffix}"
        used_paths = {path.lower() for path in staged_assets.keys()}
        counter = 1
        while rel_path.lower() in used_paths:
            rel_path = f"images/_archive_assets/{safe_stem}_{counter:02d}{safe_suffix}"
            counter += 1
        staged_assets[rel_path] = resolved
        return rel_path

    def _rewrite_task_payload_image_refs(
        self,
        payload: Any,
        task_dir: Path,
        *,
        staged_assets: Optional[Dict[str, Path]] = None,
        allow_stage_external: bool = False,
        allow_asset_resolution: bool = False,
    ) -> Tuple[Any, bool]:
        changed = False

        def _portable_rel_path(raw_path: Optional[str], asset_id: Optional[str]) -> Optional[str]:
            source_path = self._resolve_task_image_source(task_dir, raw_path)
            if source_path is None and allow_asset_resolution and asset_id and self.asset_service is not None:
                try:
                    resolved = self.asset_service.resolve_asset_file(asset_id)
                except Exception:
                    resolved = None
                if isinstance(resolved, Path) and resolved.exists() and resolved.is_file():
                    source_path = resolved.resolve()
            if source_path is None:
                return None
            try:
                return source_path.resolve().relative_to(task_dir.resolve()).as_posix()
            except ValueError:
                if allow_stage_external and staged_assets is not None:
                    return self._make_staged_archive_asset_path(source_path, staged_assets)
                return None

        def _walk(node: Any, parent_key: str = "") -> Any:
            nonlocal changed
            if isinstance(node, list):
                return [_walk(item, parent_key) for item in node]

            if isinstance(node, dict):
                updated = {key: _walk(value, key) for key, value in node.items()}

                path_value = self._first_text(*(updated.get(key) for key in self._IMAGE_REF_PATH_KEYS))
                asset_id = self._first_text(*(updated.get(key) for key in self._IMAGE_REF_ASSET_ID_KEYS))
                portable_path = _portable_rel_path(path_value, asset_id)

                if portable_path:
                    for path_key in self._IMAGE_REF_PATH_KEYS:
                        if isinstance(updated.get(path_key), str):
                            if updated[path_key] != portable_path:
                                changed = True
                            updated[path_key] = portable_path
                    if not any(isinstance(updated.get(key), str) for key in self._IMAGE_REF_PATH_KEYS):
                        target_key = "image_path" if any(
                            key.startswith("image_") for key in updated.keys()
                        ) else "path"
                        updated[target_key] = portable_path
                        changed = True

                    for asset_key in self._IMAGE_REF_ASSET_ID_KEYS + self._IMAGE_REF_ASSET_URL_KEYS:
                        if asset_key in updated:
                            updated.pop(asset_key, None)
                            changed = True

                return updated

            if isinstance(node, str) and parent_key in self._IMAGE_REF_PARENT_KEYS:
                portable_path = _portable_rel_path(node, None)
                if portable_path and portable_path != node:
                    changed = True
                    return portable_path
            return node

        return _walk(payload), changed

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
                    report["module_names"] = manifest_data.get("module_names", {})
                    report["topic_names"] = manifest_data.get("topic_names", {})
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
            return self._with_service_contract(report)
            
        except Exception as e:
            self.logger.error(f"Validation failed: {e}")
            report["critical_error"] = str(e)
            return self._with_service_contract(report)

    def _validate_zip_security(self, archive_path: str):
        """Perform security checks on the ZIP file."""
        try:
            self.package_io.validate_zip_security(archive_path)
        except ValueError as e:
            msg = str(e)
            if "Path traversal" in msg or "Absolute path" in msg:
                raise ValueError(f"Malicious path: {msg}")
            if "too deep" in msg:
                raise ValueError(f"nesting too deep: {msg}")
            raise

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
                
                try:
                    existing_data = None
                    existing_ref = self._extract_task_ref_from_storage_path(existing_path)
                    if existing_ref:
                        existing_module_id, existing_topic_id, _ = existing_ref
                        try:
                            existing_payload = self.storage.load_task(existing_module_id, existing_topic_id, task_id)
                            if existing_payload and isinstance(existing_payload, dict):
                                existing_data = existing_payload.get("task_data")
                        except Exception:
                            pass

                    if not existing_data:
                        with open(existing_path / "task.json", 'r', encoding='utf-8') as ef:
                            existing_data = json.load(ef)

                    if not existing_data:
                        raise ValueError("No existing task data found")
                    
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
        'image', 'image_path', 'path', 'src', 'url', 'background_image', 'icon',
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

    def _resolve_archive_image_source(self, task_dir: Path, raw_path: Optional[str]) -> Optional[Path]:
        if not isinstance(raw_path, str) or not raw_path.strip():
            return None

        clean = raw_path.strip()
        raw = Path(clean)
        candidates: List[Path] = []
        if raw.is_absolute():
            candidates.append(raw)
        candidates.append(task_dir / raw)

        basename = raw.name.strip()
        if basename:
            candidates.append(task_dir / basename)
            candidates.append(task_dir / "images" / basename)
            normalized = clean.replace("\\", "/")
            if "/images/" in normalized:
                image_suffix = normalized.split("/images/", 1)[-1]
                candidates.append(task_dir / "images" / image_suffix)

        seen: Set[str] = set()
        for candidate in candidates:
            try:
                resolved = candidate.resolve()
            except FileNotFoundError:
                resolved = candidate
            key = resolved.as_posix().lower()
            if key in seen:
                continue
            seen.add(key)
            if resolved.exists() and resolved.is_file():
                return resolved
        return None

    def _check_extracted_task_dependencies(self, task_data: Dict[str, Any], task_dir: Path) -> List[str]:
        """Check referenced images against extracted task files only."""
        missing: List[str] = []

        def scan_for_images(obj: Any, parent_key: str = "") -> None:
            if isinstance(obj, dict):
                for k, v in obj.items():
                    scan_for_images(v, k)
            elif isinstance(obj, list):
                for item in obj:
                    scan_for_images(item, parent_key)
            elif isinstance(obj, str) and parent_key.lower() in self._IMAGE_REF_KEYS:
                lower = obj.lower()
                if any(lower.endswith(ext) for ext in self.IMAGE_EXTENSIONS):
                    if obj.startswith("http") or obj.startswith("data:"):
                        return
                    if self._resolve_archive_image_source(task_dir, obj) is None and obj not in missing:
                        missing.append(obj)

        scan_for_images(task_data)
        return missing

    def _absolutize_extracted_task_image_refs(
        self,
        task_data: Dict[str, Any],
        task_dir: Path,
    ) -> Dict[str, Any]:
        """Rewrite archive-relative image refs to absolute extracted-file paths for save_task."""

        def scan(obj: Any, parent_key: str = "") -> Any:
            if isinstance(obj, dict):
                return {key: scan(value, key) for key, value in obj.items()}
            if isinstance(obj, list):
                return [scan(item, parent_key) for item in obj]
            if isinstance(obj, str) and parent_key.lower() in self._IMAGE_REF_KEYS:
                if obj.startswith("http") or obj.startswith("data:"):
                    return obj
                resolved = self._resolve_archive_image_source(task_dir, obj)
                if resolved is not None:
                    return str(resolved)
            return obj

        normalized = scan(task_data)
        return normalized if isinstance(normalized, dict) else dict(task_data)

    def _extract_task_ref_from_storage_path(self, task_path: Path) -> Optional[Tuple[str, str, str]]:
        try:
            rel_parts = task_path.resolve().relative_to(self.storage.modules_dir.resolve()).parts
        except Exception:
            return None
        if len(rel_parts) < 5:
            return None
        if rel_parts[1] != "topics" or rel_parts[3] != "tasks":
            return None
        module_id = str(rel_parts[0]).strip()
        topic_id = str(rel_parts[2]).strip()
        task_id = str(rel_parts[4]).strip()
        if not module_id or not topic_id or not task_id:
            return None
        return module_id, topic_id, task_id

    def _backup_existing_task_payload(
        self,
        module_id: str,
        topic_id: str,
        task_id: str,
    ) -> Optional[Dict[str, Any]]:
        try:
            existing_payload = self.storage.load_task(module_id, topic_id, task_id)
        except Exception:
            existing_payload = None
        if not isinstance(existing_payload, dict):
            return None
        task_data = existing_payload.get("task_data")
        if not isinstance(task_data, dict):
            return None
        return json.loads(json.dumps(task_data, ensure_ascii=False))

    def _hosted_shadow_error_payload(self, exc: Exception) -> Optional[Dict[str, Any]]:
        if isinstance(exc, HostedShadowReadFallbackDisabledError):
            return self._with_service_contract(
                {
                    "ok": False,
                    "error": "hosted_shadow_read_blocked",
                    "degraded": True,
                    "details": {
                        "operation": str(exc.operation or "").strip() or None,
                        "reason": str(exc.reason or "").strip() or None,
                        "runtime_mode": "hosted_web",
                        "source_of_truth": "postgres",
                    },
                }
            )
        if isinstance(exc, HostedShadowWriteFallbackDisabledError):
            return self._with_service_contract(
                {
                    "ok": False,
                    "error": "hosted_shadow_write_blocked",
                    "degraded": True,
                    "details": {
                        "operation": str(exc.operation or "").strip() or None,
                        "reason": str(exc.reason or "").strip() or None,
                        "runtime_mode": "hosted_web",
                        "env_opt_in": HOSTED_SHADOW_WRITE_FALLBACK_ENV,
                    },
                }
            )
        return None

    def _build_task_index(self) -> Dict[str, Path]:
        """Build a task_id → task_dir path index from storage."""
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
        # Fallback: full scan
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
        self._reject_workspace_import_params(params, context="import_tasks_atomic")
        temp_extract_dir = Path(tempfile.mkdtemp(prefix="import_extract_"))
        
        try:
            imported_count = 0
            skipped_count = 0
            errors_count = 0
            skip_errors = bool(params.get('skip_errors', True))
            imported_records: List[Tuple[str, str, str]] = []
            overwrite_backups: List[Tuple[str, str, str, Dict[str, Any]]] = []
            created_targets: List[Tuple[str, str, Optional[str]]] = []
            created_target_keys: Set[Tuple[str, str, Optional[str]]] = set()
            
            if progress_callback:
                progress_callback(0, 0, "Extracting archive...")

            # 1. Extract only allowed files using PackageIO
            archive_manifest = None
            try:
                with zipfile.ZipFile(archive_path, 'r') as zf:
                    archive_manifest = self.package_io.read_json_member(zf, "manifest.json")
            except Exception:
                pass

            self.package_io.extract_filtered(
                archive_path,
                temp_extract_dir,
                allowed_extensions=self.ALLOWED_EXTENSIONS,
            )
                
            # 2. Process extracted files
            module_names = None
            topic_names = None
            if isinstance(archive_manifest, dict):
                module_names = archive_manifest.get("module_names")
                topic_names = archive_manifest.get("topic_names")

            # Scan for all task.json files in extracted structure
            task_files = list(temp_extract_dir.rglob("task.json"))
            total_tasks = len(task_files)
            
            # Build task index once for O(1) conflict lookups (WEAK-7 fix)
            task_index = self._build_task_index()
            
            for i, task_file in enumerate(task_files):
                excluded_list = params.get('excluded_tasks', [])
                if i in excluded_list or str(i) in excluded_list:
                    skipped_count += 1
                    continue
                task_dir = task_file.parent
                
                try:
                    with open(task_file, 'r', encoding='utf-8') as f:
                        task_data = json.load(f)
                    task_data, task_changed = self._rewrite_task_payload_image_refs(
                        task_data,
                        task_dir,
                        allow_stage_external=False,
                        allow_asset_resolution=False,
                    )
                    if task_changed:
                        with open(task_file, 'w', encoding='utf-8') as f:
                            json.dump(task_data, f, indent=2, ensure_ascii=False)

                    missing_images = self._check_extracted_task_dependencies(task_data, task_dir)
                    if missing_images:
                        raise ValueError(f"Missing images: {', '.join(missing_images)}")
                        
                    task_id = task_data.get('id')
                    if not task_id:
                        raise ValueError("Missing task ID in task.json")
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
                    
                    # Handle conflict
                    existing_path = self._find_task_in_storage(task_id, index=task_index)
                    
                    if existing_path:
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
                            
                            task_id = new_id
                        elif conflict_res == 'overwrite':
                            existing_ref = self._extract_task_ref_from_storage_path(existing_path)
                            if existing_ref is None:
                                raise ValueError(f"Cannot resolve existing task ref for overwrite: {task_id}")
                            existing_module_id, existing_topic_id, _ = existing_ref
                            target_module, target_topic, task_id = existing_module_id, existing_topic_id, task_id
                            backup_payload = self._backup_existing_task_payload(
                                target_module,
                                target_topic,
                                task_id,
                            )
                            if backup_payload is None:
                                raise ValueError(f"Cannot back up existing task for overwrite: {task_id}")
                            overwrite_backups.append(
                                (target_module, target_topic, task_id, backup_payload)
                            )

                    # Ensure the final write target exists only after conflict resolution.
                    creation_info = self._ensure_module_topic_exists(
                        target_module,
                        target_topic,
                        module_names=module_names,
                        topic_names=topic_names,
                    )
                    if creation_info.get("created_module"):
                        key = ("module", target_module, None)
                        if key not in created_target_keys:
                            created_target_keys.add(key)
                            created_targets.append(key)
                    if creation_info.get("created_topic"):
                        key = ("topic", target_module, target_topic)
                        if key not in created_target_keys:
                            created_target_keys.add(key)
                            created_targets.append(key)

                    import_payload = self._absolutize_extracted_task_image_refs(task_data, task_dir)
                    import_payload["id"] = task_id
                    if not import_payload.get("name"):
                        import_payload["name"] = task_name

                    current_user_id = params.get("current_user_id") or params.get("requested_by_user_id")
                    if current_user_id:
                        if "meta" not in import_payload or not isinstance(import_payload["meta"], dict):
                            import_payload["meta"] = {}
                        import_payload["meta"]["created_by_user_id"] = current_user_id
                        import_payload["meta"]["updated_by_user_id"] = current_user_id
                        import_payload["meta"]["created_via"] = "archive_import"
                        import_payload["meta"]["content_scope"] = "shared_local"

                    success = self.storage.save_task(
                        target_module,
                        target_topic,
                        task_id,
                        import_payload,
                        validate=False,
                    )
                    if not success:
                        raise ValueError(f"Failed to save imported task: {task_id}")

                    task_index[task_id] = (
                        self.storage.modules_dir / target_module / "topics" / target_topic / "tasks" / task_id
                    )
                    imported_records.append((target_module, target_topic, task_id))
                    imported_count += 1
                    
                except Exception as e:
                    self.logger.error(f"Failed to import task {task_file}: {e}")
                    errors_count += 1
                    
                    if not skip_errors:
                        self.logger.warning(
                            f"Rollback triggered: reverting {len(imported_records)} imported tasks"
                        )
                        for module_id, topic_id, imported_task_id in reversed(imported_records):
                            try:
                                self.storage.delete_task(module_id, topic_id, imported_task_id)
                            except Exception as rb_err:
                                self.logger.error(
                                    f"Rollback failed for {module_id}/{topic_id}/{imported_task_id}: {rb_err}"
                                )
                        for module_id, topic_id, overwritten_task_id, backup_payload in reversed(overwrite_backups):
                            try:
                                self.storage.save_task(
                                    module_id,
                                    topic_id,
                                    overwritten_task_id,
                                    json.loads(json.dumps(backup_payload, ensure_ascii=False)),
                                    validate=False,
                                )
                            except Exception as rb_err:
                                self.logger.error(
                                    f"Rollback restore failed for {module_id}/{topic_id}/{overwritten_task_id}: {rb_err}"
                                )
                        for kind, module_id, topic_id in reversed(created_targets):
                            try:
                                if kind == "topic" and topic_id:
                                    self.storage.delete_topic(module_id, topic_id)
                                elif kind == "module":
                                    self.storage.delete_module(module_id)
                            except Exception as rb_err:
                                self.logger.error(
                                    "Rollback cleanup failed for %s %s %s: %s",
                                    kind,
                                    module_id,
                                    topic_id,
                                    rb_err,
                                )
                        
                        self.storage.reload_modules()
                        hosted_shadow_payload = self._hosted_shadow_error_payload(e)
                        if hosted_shadow_payload is not None:
                            hosted_shadow_payload["imported"] = 0
                            hosted_shadow_payload["skipped"] = skipped_count
                            hosted_shadow_payload["errors"] = errors_count
                            hosted_shadow_payload["rollback"] = True
                            return hosted_shadow_payload
                        return self._with_service_contract({
                            "ok": False,
                            "imported": 0,
                            "skipped": skipped_count,
                            "errors": errors_count,
                            "rollback": True,
                            "error_message": str(e)
                        })
            
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
                from routes._context import is_hosted_web_runtime
                if not is_hosted_web_runtime():
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
            return self._with_service_contract(result)
            
        finally:
            # Cleanup temp
            if temp_extract_dir.exists():
                shutil.rmtree(temp_extract_dir)

    def _log_import(self, archive_path: str, result: Dict[str, Any]):
        """Append import event to import_journal.json."""
        from routes._context import is_hosted_web_runtime
        if is_hosted_web_runtime():
            return
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

    def _ensure_module_topic_exists(
        self,
        module_id: str,
        topic_id: str,
        module_names: Optional[Dict[str, str]] = None,
        topic_names: Optional[Dict[str, Dict[str, str]]] = None,
    ) -> Dict[str, bool]:
        """Create module/topic via storage service when absent, preserving original names if provided."""
        created_module = False
        created_topic = False

        existing_module = self.storage.get_module(module_id)
        if not existing_module:
            module_name = module_id
            if isinstance(module_names, dict) and module_id in module_names:
                module_name = module_names[module_id]
            created_module = bool(
                self.storage.create_module(
                    module_id,
                    module_name,
                    workspace_meta={
                        "created_via": "archive_import",
                        "content_scope": "shared_local",
                    },
                )
            )

        existing_topic = self.storage.get_topic(module_id, topic_id)
        if not existing_topic:
            topic_name = topic_id
            if isinstance(topic_names, dict) and module_id in topic_names:
                inner = topic_names[module_id]
                if isinstance(inner, dict) and topic_id in inner:
                    topic_name = inner[topic_id]
            created_topic = bool(
                self.storage.create_topic(
                    module_id,
                    topic_id,
                    topic_name,
                    workspace_meta={
                        "created_via": "archive_import",
                        "content_scope": "shared_local",
                    },
                )
            )

        if not self.storage.get_module(module_id):
            raise ValueError(f"Failed to ensure module exists: {module_id}")
        if not self.storage.get_topic(module_id, topic_id):
            raise ValueError(f"Failed to ensure topic exists: {module_id}/{topic_id}")

        return {"created_module": created_module, "created_topic": created_topic}
