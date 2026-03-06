import json
import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from api.complexes_api import validate_and_normalize_create_payload

from .package_io import PackageIO
from .theory_service import TheoryNotFoundError


ComplexImportReport = Dict[str, Any]


class ComplexImportExportService:
    """Import/export service for full complex bundles (complex + tasks + theory)."""

    SPEC = "actra.package/2"
    ALLOWED_EXTENSIONS = {".json", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}

    def __init__(self, storage_service, complex_service, theory_service, task_import_export_service=None):
        self.storage = storage_service
        self.complex_service = complex_service
        self.theory_service = theory_service
        self.task_import_export_service = task_import_export_service
        self.package_io = PackageIO()
        self.logger = logging.getLogger(self.__class__.__name__)
        self._app_version = self._read_app_version()

    def _read_app_version(self) -> str:
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

    # -------------------------------------------------------------------------
    # Export
    # -------------------------------------------------------------------------

    def create_export_archive(
        self,
        complex_ids: List[str],
        options: Optional[Dict[str, Any]] = None,
    ) -> str:
        options = options or {}
        include_tasks = bool(options.get("include_tasks", True))
        include_theories = bool(options.get("include_theories", True))

        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip", prefix="export_complexes_")
        temp_zip_path = temp_zip.name
        temp_zip.close()

        checksums: Dict[str, str] = {}
        exported_complex_ids: List[str] = []
        exported_task_refs: Set[str] = set()
        exported_theory_ids: Set[str] = set()
        missing_complexes: List[str] = []
        missing_tasks: List[str] = []
        missing_theories: List[str] = []

        try:
            with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for complex_id in complex_ids:
                    complex_obj = self.complex_service.get_complex(complex_id)
                    if not complex_obj:
                        missing_complexes.append(complex_id)
                        continue

                    payload = self._serialize_datetimes(complex_obj.dict())
                    complex_arc_path = f"complexes/{payload['id']}.json"
                    content = json.dumps(payload, indent=2, ensure_ascii=False).encode("utf-8")
                    zf.writestr(complex_arc_path, content)
                    checksums[complex_arc_path] = self.package_io.sha256_bytes(content)
                    exported_complex_ids.append(str(payload["id"]))

                    for task_ref in payload.get("tasks", []):
                        if isinstance(task_ref, str) and task_ref.strip():
                            exported_task_refs.add(task_ref.strip())

                    theory_link = payload.get("theory_link")
                    if include_theories and isinstance(theory_link, dict):
                        theory_id = theory_link.get("theory_id")
                        if isinstance(theory_id, str) and theory_id.strip():
                            exported_theory_ids.add(theory_id.strip())

                if include_tasks:
                    for task_ref in sorted(exported_task_refs):
                        parsed = self._parse_task_ref(task_ref)
                        if parsed is None:
                            missing_tasks.append(task_ref)
                            continue
                        module_id, topic_id, task_id = parsed
                        task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
                        if not task_dir.exists():
                            missing_tasks.append(task_ref)
                            continue
                        for root, dirs, files in os.walk(task_dir):
                            dirs.sort()
                            files.sort()
                            for filename in files:
                                file_path = Path(root) / filename
                                rel = file_path.relative_to(task_dir).as_posix()
                                arc_name = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}/{rel}"
                                zf.write(file_path, arc_name)
                                checksums[arc_name] = self.package_io.sha256_file(file_path)

                if include_theories:
                    for theory_id in sorted(exported_theory_ids):
                        source_dir = self.theory_service.theories_dir / theory_id
                        if not source_dir.exists():
                            missing_theories.append(theory_id)
                            continue
                        for root, dirs, files in os.walk(source_dir):
                            dirs.sort()
                            files.sort()
                            for filename in files:
                                file_path = Path(root) / filename
                                rel = file_path.relative_to(source_dir).as_posix()
                                if rel.startswith("history/"):
                                    continue
                                arc_name = f"theories/{theory_id}/{rel}"
                                zf.write(file_path, arc_name)
                                checksums[arc_name] = self.package_io.sha256_file(file_path)

                manifest = {
                    "spec": self.SPEC,
                    "export_type": "complexes",
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "app_version": self._app_version,
                    "hash_algo": "sha256",
                    "entities": {
                        "complexes": sorted(exported_complex_ids),
                        "tasks": sorted(exported_task_refs) if include_tasks else [],
                        "theories": sorted(exported_theory_ids) if include_theories else [],
                    },
                    "missing": {
                        "complexes": sorted(set(missing_complexes)),
                        "tasks": sorted(set(missing_tasks)),
                        "theories": sorted(set(missing_theories)),
                    },
                }
                manifest_bytes = json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")
                zf.writestr("manifest.json", manifest_bytes)
                checksums["manifest.json"] = self.package_io.sha256_bytes(manifest_bytes)

                checksums_bytes = json.dumps(checksums, indent=2, ensure_ascii=False).encode("utf-8")
                zf.writestr("checksums.json", checksums_bytes)

            self.logger.info(
                "Exported complexes=%s tasks=%s theories=%s -> %s",
                len(exported_complex_ids),
                len(exported_task_refs),
                len(exported_theory_ids),
                temp_zip_path,
            )
            return temp_zip_path
        except Exception:
            if os.path.exists(temp_zip_path):
                os.remove(temp_zip_path)
            raise

    # -------------------------------------------------------------------------
    # Validation
    # -------------------------------------------------------------------------

    def validate_import_archive(self, archive_path: str) -> ComplexImportReport:
        report: ComplexImportReport = {
            "ok": False,
            "summary": {"total": 0, "valid": 0, "conflicts": 0, "errors": 0},
            "conflicts": {"duplicates": [], "overwrites": [], "broken_deps": []},
            "errors": [],
            "complexes": [],
            "warnings": [],
        }

        try:
            self.package_io.validate_zip_security(archive_path)
            with zipfile.ZipFile(archive_path, "r") as zf:
                members = self.package_io.list_members(zf)

                manifest = self._read_manifest(zf, report)
                if manifest:
                    report["manifest"] = manifest
                    if manifest.get("spec") != self.SPEC:
                        report["warnings"].append(
                            f"Package spec mismatch: archive={manifest.get('spec')} expected={self.SPEC}"
                        )
                    if manifest.get("export_type") != "complexes":
                        report["warnings"].append(
                            f"Package export_type is '{manifest.get('export_type')}', expected 'complexes'"
                        )

                self._validate_checksums(zf, report)

                complex_files = sorted(
                    path for path in members if path.startswith("complexes/") and path.endswith(".json")
                )
                report["summary"]["total"] = len(complex_files)

                for complex_file in complex_files:
                    try:
                        payload = self.package_io.read_json_member(zf, complex_file)
                    except Exception as exc:
                        report["summary"]["errors"] += 1
                        report["errors"].append(
                            {"id": complex_file, "error": f"invalid_complex_json: {exc}"}
                        )
                        continue

                    item_report = self._analyze_complex_payload(payload, members)
                    report["complexes"].append(item_report)

                    status = item_report.get("status")
                    if status == "error":
                        report["summary"]["errors"] += 1
                        report["errors"].append(
                            {
                                "id": item_report.get("id") or complex_file,
                                "name": item_report.get("name") or "",
                                "error": item_report.get("error") or "unknown_error",
                            }
                        )
                        if item_report.get("broken_deps"):
                            report["conflicts"]["broken_deps"].append(item_report)
                    elif status == "conflict":
                        report["summary"]["conflicts"] += 1
                        if item_report.get("conflict_type") == "duplicate":
                            report["conflicts"]["duplicates"].append(item_report)
                        else:
                            report["conflicts"]["overwrites"].append(item_report)
                    else:
                        report["summary"]["valid"] += 1

            report["ok"] = True
            return report
        except Exception as exc:
            self.logger.error("Complex archive validation failed: %s", exc)
            report["critical_error"] = str(exc)
            return report

    def _read_manifest(self, zf: zipfile.ZipFile, report: ComplexImportReport) -> Optional[Dict[str, Any]]:
        try:
            return self.package_io.read_json_member(zf, "manifest.json")
        except Exception:
            report["warnings"].append("Archive does not contain a valid manifest.json")
            return None

    def _validate_checksums(self, zf: zipfile.ZipFile, report: ComplexImportReport) -> None:
        try:
            checksums = self.package_io.read_json_member(zf, "checksums.json")
            if not isinstance(checksums, dict):
                raise ValueError("checksums_not_object")
            verification = self.package_io.validate_archive_checksums(
                zf,
                checksums,
                ignore_paths={"checksums.json"},
            )
            if verification["missing"] or verification["mismatched"]:
                report["warnings"].append(
                    "Checksum validation reported issues: "
                    f"missing={len(verification['missing'])}, "
                    f"mismatched={len(verification['mismatched'])}"
                )
        except KeyError:
            report["warnings"].append("Archive does not contain checksums.json")
        except Exception as exc:
            report["warnings"].append(f"Failed to validate checksums: {exc}")

    def _analyze_complex_payload(self, payload: Dict[str, Any], members: Set[str]) -> Dict[str, Any]:
        result: Dict[str, Any] = {"status": "valid"}
        if not isinstance(payload, dict):
            return {"status": "error", "error": "complex_payload_must_be_object"}

        complex_id = payload.get("id")
        if not isinstance(complex_id, str) or not complex_id.strip():
            return {"status": "error", "error": "complex_id_missing_or_invalid"}
        complex_id = complex_id.strip()
        result["id"] = complex_id
        result["name"] = str(payload.get("name") or complex_id)

        normalized_new = self._normalized_complex_for_compare(payload)
        if normalized_new is None:
            return {
                "status": "error",
                "id": complex_id,
                "name": result["name"],
                "error": "complex_payload_validation_failed",
            }

        existing = self.complex_service.get_complex(complex_id)
        if existing:
            existing_payload = self._serialize_datetimes(existing.dict())
            normalized_existing = self._normalized_complex_for_compare(existing_payload)
            if normalized_existing is not None:
                hash_new = self.package_io.normalized_json_hash(normalized_new)
                hash_old = self.package_io.normalized_json_hash(normalized_existing)
                result["status"] = "conflict"
                if hash_new == hash_old:
                    result["conflict_type"] = "duplicate"
                else:
                    result["conflict_type"] = "overwrite"
            else:
                result["status"] = "conflict"
                result["conflict_type"] = "overwrite"
        else:
            result["exists"] = False

        missing_deps: List[str] = []
        for task_ref in normalized_new.get("tasks", []):
            parsed = self._parse_task_ref(task_ref)
            if parsed is None:
                missing_deps.append(f"invalid_task_ref:{task_ref}")
                continue
            module_id, topic_id, task_id = parsed
            archive_task = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}/task.json"
            in_archive = archive_task in members
            in_storage = bool(self.storage.load_task(module_id, topic_id, task_id))
            if not in_archive and not in_storage:
                missing_deps.append(f"task:{task_ref}")

        theory_link = normalized_new.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id.strip():
                theory_id = theory_id.strip()
                in_archive = f"theories/{theory_id}/theory.json" in members
                in_storage = False
                try:
                    self.theory_service.get_theory(theory_id, include_delta=False)
                    in_storage = True
                except TheoryNotFoundError:
                    in_storage = False
                except Exception:
                    in_storage = False
                if not in_archive and not in_storage:
                    missing_deps.append(f"theory:{theory_id}")

        if missing_deps:
            result["status"] = "error"
            result["broken_deps"] = missing_deps
            result["error"] = f"missing_dependencies: {', '.join(missing_deps)}"

        return result

    # -------------------------------------------------------------------------
    # Import
    # -------------------------------------------------------------------------

    def import_complexes_atomic(
        self,
        archive_path: str,
        params: Dict[str, Any],
        progress_callback: Optional[Any] = None,
    ) -> ComplexImportReport:
        temp_extract_dir = Path(tempfile.mkdtemp(prefix="complex_import_extract_"))
        backup_dir: Optional[Path] = None

        skip_errors = bool(params.get("skip_errors", False))
        atomic_mode = str(params.get("atomic_mode", "bundle") or "bundle").strip().lower()
        if atomic_mode not in {"bundle", "best_effort"}:
            atomic_mode = "bundle"

        task_conflict = str(params.get("task_conflict_resolution", "skip") or "skip").strip().lower()
        if task_conflict not in {"skip", "overwrite"}:
            raise ValueError("task_conflict_resolution must be 'skip' or 'overwrite'")

        complex_conflict = str(params.get("complex_conflict_resolution", "new_id") or "new_id").strip().lower()
        if complex_conflict not in {"skip", "overwrite", "new_id"}:
            raise ValueError("complex_conflict_resolution must be skip|overwrite|new_id")

        theory_conflict = str(
            params.get("theory_conflict_resolution", "reuse_if_same_hash") or "reuse_if_same_hash"
        ).strip().lower()
        if theory_conflict not in {"reuse_if_same_hash", "new_id_if_diff", "overwrite"}:
            raise ValueError("theory_conflict_resolution must be reuse_if_same_hash|new_id_if_diff|overwrite")

        result: ComplexImportReport = {
            "ok": False,
            "rollback": False,
            "imported_complexes": 0,
            "skipped_complexes": 0,
            "complex_errors": 0,
            "theories": {"imported": 0, "reused": 0, "overwritten": 0, "errors": 0},
            "tasks": {"ok": True, "imported": 0, "skipped": 0, "errors": 0},
            "id_remap": {"complexes": {}, "theories": {}},
            "errors": [],
        }

        try:
            if progress_callback:
                progress_callback(0, 0, "Extracting archive...")

            self.package_io.validate_zip_security(archive_path)
            self.package_io.extract_filtered(archive_path, temp_extract_dir, allowed_extensions=self.ALLOWED_EXTENSIONS)

            if atomic_mode == "bundle":
                backup_dir = self._create_state_backup()

            if self.task_import_export_service is not None:
                if progress_callback:
                    progress_callback(0, 0, "Importing task dependencies...")
                task_params = {
                    "conflict_resolution": task_conflict,
                    "skip_errors": False if atomic_mode == "bundle" else skip_errors,
                }
                task_result = self.task_import_export_service.import_tasks_atomic(
                    archive_path,
                    task_params,
                    progress_callback=None,
                )
                result["tasks"] = task_result
                if not task_result.get("ok", False) and atomic_mode == "bundle":
                    raise RuntimeError("task_import_failed")

            theory_root = temp_extract_dir / "theories"
            theory_dirs = sorted([p for p in theory_root.iterdir() if p.is_dir()]) if theory_root.exists() else []
            for idx, theory_dir in enumerate(theory_dirs):
                if progress_callback:
                    progress_callback(idx + 1, max(len(theory_dirs), 1), f"Importing theory {theory_dir.name}...")
                theory_status = self._import_theory_dir(theory_dir, policy=theory_conflict)
                incoming_id = theory_status.get("incoming_id")
                final_id = theory_status.get("final_id")
                status = theory_status.get("status")

                if isinstance(incoming_id, str) and isinstance(final_id, str):
                    result["id_remap"]["theories"][incoming_id] = final_id

                if status == "error":
                    result["theories"]["errors"] += 1
                    result["errors"].append({"scope": "theory", **theory_status})
                    if atomic_mode == "bundle" or not skip_errors:
                        raise RuntimeError(f"theory_import_failed:{incoming_id}")
                elif status == "reused":
                    result["theories"]["reused"] += 1
                elif status == "overwritten":
                    result["theories"]["overwritten"] += 1
                else:
                    result["theories"]["imported"] += 1

            complex_root = temp_extract_dir / "complexes"
            complex_files = sorted(
                [p for p in complex_root.iterdir() if p.is_file() and p.suffix.lower() == ".json"]
            ) if complex_root.exists() else []

            for idx, complex_path in enumerate(complex_files):
                if progress_callback:
                    progress_callback(
                        idx + 1,
                        max(len(complex_files), 1),
                        f"Importing complex {complex_path.stem}...",
                    )
                try:
                    payload = json.loads(complex_path.read_text(encoding="utf-8"))
                except Exception as exc:
                    result["complex_errors"] += 1
                    result["errors"].append(
                        {"scope": "complex", "id": complex_path.stem, "error": f"invalid_json:{exc}"}
                    )
                    if atomic_mode == "bundle" or not skip_errors:
                        raise RuntimeError(f"complex_json_invalid:{complex_path.stem}")
                    continue

                import_status = self._import_complex_payload(
                    payload,
                    complex_conflict_policy=complex_conflict,
                    theory_id_remap=result["id_remap"]["theories"],
                )
                incoming_id = import_status.get("incoming_id")
                final_id = import_status.get("final_id")
                if isinstance(incoming_id, str) and isinstance(final_id, str):
                    result["id_remap"]["complexes"][incoming_id] = final_id

                status = import_status.get("status")
                if status == "imported":
                    result["imported_complexes"] += 1
                elif status == "skipped":
                    result["skipped_complexes"] += 1
                else:
                    result["complex_errors"] += 1
                    result["errors"].append({"scope": "complex", **import_status})
                    if atomic_mode == "bundle" or not skip_errors:
                        raise RuntimeError(f"complex_import_failed:{incoming_id}")

            self.storage.reload_modules()
            self.complex_service.load_complexes()

            result["ok"] = result["complex_errors"] == 0 and result["theories"]["errors"] == 0
            if skip_errors and result["complex_errors"] > 0:
                result["ok"] = True
            return result

        except Exception as exc:
            self.logger.error("Complex import failed: %s", exc)
            if backup_dir is not None and atomic_mode == "bundle":
                try:
                    self._restore_state_backup(backup_dir)
                    result["rollback"] = True
                except Exception as rb_exc:
                    self.logger.error("Complex import rollback failed: %s", rb_exc)
                    result["errors"].append({"scope": "rollback", "error": str(rb_exc)})
            result["ok"] = False
            result["error_message"] = str(exc)
            return result
        finally:
            try:
                if temp_extract_dir.exists():
                    shutil.rmtree(temp_extract_dir)
            except Exception:
                pass
            if backup_dir is not None and backup_dir.exists():
                try:
                    shutil.rmtree(backup_dir)
                except Exception:
                    pass

    def _import_theory_dir(self, source_dir: Path, policy: str) -> Dict[str, Any]:
        incoming_meta, incoming_delta = self._load_theory_payload_from_dir(source_dir)
        incoming_id = str(incoming_meta.get("id") or source_dir.name).strip()
        if not incoming_id:
            return {"status": "error", "incoming_id": source_dir.name, "error": "theory_id_missing"}

        incoming_hash = self._compute_theory_hash(
            title=str(incoming_meta.get("title") or ""),
            images=list(incoming_meta.get("images") or []),
            delta=incoming_delta,
        )

        existing = None
        try:
            existing = self.theory_service.get_theory(incoming_id, include_delta=True)
        except TheoryNotFoundError:
            existing = None
        except Exception:
            existing = None

        if existing is None:
            self._materialize_theory(source_dir, incoming_id, incoming_id, overwrite=False)
            return {"status": "imported", "incoming_id": incoming_id, "final_id": incoming_id}

        existing_hash = self._compute_theory_hash(
            title=str(existing.get("title") or ""),
            images=list(existing.get("images") or []),
            delta=existing.get("delta") or {"ops": [{"insert": "\n"}]},
        )
        if existing_hash == incoming_hash:
            return {"status": "reused", "incoming_id": incoming_id, "final_id": incoming_id}

        if policy == "overwrite":
            self._materialize_theory(source_dir, incoming_id, incoming_id, overwrite=True)
            return {"status": "overwritten", "incoming_id": incoming_id, "final_id": incoming_id}

        if policy in {"reuse_if_same_hash", "new_id_if_diff"}:
            new_id = self._generate_unique_theory_id()
            self._materialize_theory(source_dir, incoming_id, new_id, overwrite=False)
            return {"status": "imported", "incoming_id": incoming_id, "final_id": new_id}

        return {"status": "error", "incoming_id": incoming_id, "error": "unsupported_theory_policy"}

    def _materialize_theory(
        self,
        source_dir: Path,
        source_theory_id: str,
        target_theory_id: str,
        overwrite: bool,
    ) -> None:
        target_dir = self.theory_service.theories_dir / target_theory_id
        if target_dir.exists():
            if not overwrite:
                raise ValueError(f"Theory already exists: {target_theory_id}")
            shutil.rmtree(target_dir)

        shutil.copytree(source_dir, target_dir)
        history_dir = target_dir / "history"
        if history_dir.exists():
            shutil.rmtree(history_dir)
        (target_dir / "history").mkdir(parents=True, exist_ok=True)
        (target_dir / "images").mkdir(parents=True, exist_ok=True)

        meta_path = target_dir / "theory.json"
        delta_path = target_dir / "body.delta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        delta = json.loads(delta_path.read_text(encoding="utf-8")) if delta_path.exists() else {"ops": [{"insert": "\n"}]}

        meta = self._rewrite_theory_meta_image_refs(meta, source_theory_id, target_theory_id)
        delta = self._rewrite_theory_delta_image_refs(delta, source_theory_id, target_theory_id)

        now = datetime.utcnow().isoformat()
        meta["id"] = target_theory_id
        meta["delta_path"] = "body.delta.json"
        meta["updated_at"] = now
        meta["version"] = now
        if not meta.get("created_at"):
            meta["created_at"] = now

        image_refs = list(meta.get("images") or [])
        for image_ref in self._collect_delta_image_refs(delta):
            if image_ref not in image_refs:
                image_refs.append(image_ref)
        meta["images"] = image_refs

        meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
        delta_path.write_text(json.dumps(delta, indent=2, ensure_ascii=False), encoding="utf-8")

    def _load_theory_payload_from_dir(self, theory_dir: Path) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        meta_path = theory_dir / "theory.json"
        delta_path = theory_dir / "body.delta.json"
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        delta = json.loads(delta_path.read_text(encoding="utf-8")) if delta_path.exists() else {"ops": [{"insert": "\n"}]}
        return meta, delta

    def _rewrite_theory_meta_image_refs(
        self,
        meta: Dict[str, Any],
        source_theory_id: str,
        target_theory_id: str,
    ) -> Dict[str, Any]:
        remapped = dict(meta)
        images = []
        for raw_ref in list(remapped.get("images") or []):
            if not isinstance(raw_ref, str):
                continue
            images.append(self._remap_theory_image_ref(raw_ref, source_theory_id, target_theory_id))
        remapped["images"] = images
        return remapped

    def _rewrite_theory_delta_image_refs(
        self,
        delta: Dict[str, Any],
        source_theory_id: str,
        target_theory_id: str,
    ) -> Dict[str, Any]:
        remapped_ops: List[Dict[str, Any]] = []
        for op in list(delta.get("ops") or []):
            if not isinstance(op, dict):
                continue
            cloned_op = dict(op)
            insert = cloned_op.get("insert")
            if isinstance(insert, dict) and isinstance(insert.get("image"), str):
                cloned_insert = dict(insert)
                cloned_insert["image"] = self._remap_theory_image_ref(
                    cloned_insert["image"], source_theory_id, target_theory_id
                )
                cloned_op["insert"] = cloned_insert
            remapped_ops.append(cloned_op)
        return {"ops": remapped_ops or [{"insert": "\n"}]}

    def _remap_theory_image_ref(self, image_ref: str, source_theory_id: str, target_theory_id: str) -> str:
        normalized = str(image_ref).replace("\\", "/").lstrip("/")
        old_prefix = f"complexes/theories/{source_theory_id}/images/"
        if normalized.startswith(old_prefix):
            suffix = normalized[len(old_prefix):]
            return f"complexes/theories/{target_theory_id}/images/{suffix}"
        return normalized

    def _collect_delta_image_refs(self, delta: Dict[str, Any]) -> List[str]:
        refs: List[str] = []
        for op in list(delta.get("ops") or []):
            if not isinstance(op, dict):
                continue
            insert = op.get("insert")
            if not isinstance(insert, dict):
                continue
            image_ref = insert.get("image")
            if isinstance(image_ref, str):
                normalized = image_ref.replace("\\", "/").lstrip("/")
                if normalized not in refs:
                    refs.append(normalized)
        return refs

    def _compute_theory_hash(self, title: str, images: List[str], delta: Dict[str, Any]) -> str:
        normalized_images = sorted(
            set(
                self._normalize_theory_ref_for_hash(ref)
                for ref in images
                if isinstance(ref, str) and ref.strip()
            )
        )
        payload = {
            "title": str(title or "").strip(),
            "images": normalized_images,
            "delta": self._normalize_theory_delta_for_hash(delta),
        }
        return self.package_io.normalized_json_hash(payload)

    def _normalize_theory_ref_for_hash(self, ref: str) -> str:
        normalized = ref.replace("\\", "/").lstrip("/")
        parts = normalized.split("/")
        if len(parts) >= 5 and parts[0] == "complexes" and parts[1] == "theories" and parts[3] == "images":
            return "/".join(["complexes", "theories", "<id>", "images"] + parts[4:])
        return normalized

    def _normalize_theory_delta_for_hash(self, delta: Dict[str, Any]) -> Dict[str, Any]:
        ops: List[Dict[str, Any]] = []
        for op in list((delta or {}).get("ops") or []):
            if not isinstance(op, dict):
                continue
            insert = op.get("insert")
            cloned = dict(op)
            if isinstance(insert, dict) and isinstance(insert.get("image"), str):
                cloned_insert = dict(insert)
                cloned_insert["image"] = self._normalize_theory_ref_for_hash(cloned_insert["image"])
                cloned["insert"] = cloned_insert
            ops.append(cloned)
        return {"ops": ops or [{"insert": "\n"}]}

    def _import_complex_payload(
        self,
        payload: Dict[str, Any],
        complex_conflict_policy: str,
        theory_id_remap: Dict[str, str],
    ) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return {"status": "error", "error": "complex_payload_must_be_object"}

        incoming_id = payload.get("id")
        if not isinstance(incoming_id, str) or not incoming_id.strip():
            return {"status": "error", "error": "complex_id_missing_or_invalid", "incoming_id": incoming_id}
        incoming_id = incoming_id.strip()

        cloned = dict(payload)
        theory_link = cloned.get("theory_link")
        if isinstance(theory_link, dict):
            theory_id = theory_link.get("theory_id")
            if isinstance(theory_id, str) and theory_id in theory_id_remap:
                theory_link = dict(theory_link)
                theory_link["theory_id"] = theory_id_remap[theory_id]
                cloned["theory_link"] = theory_link

        normalized, errors = validate_and_normalize_create_payload(cloned)
        if normalized is None:
            return {
                "status": "error",
                "incoming_id": incoming_id,
                "error": "complex_validation_failed",
                "details": errors,
            }

        missing_tasks = []
        for task_ref in normalized.get("tasks", []):
            parsed = self._parse_task_ref(task_ref)
            if parsed is None:
                missing_tasks.append(task_ref)
                continue
            module_id, topic_id, task_id = parsed
            if not self.storage.load_task(module_id, topic_id, task_id):
                missing_tasks.append(task_ref)
        if missing_tasks:
            return {
                "status": "error",
                "incoming_id": incoming_id,
                "error": "complex_missing_tasks",
                "missing_tasks": missing_tasks,
            }

        existing = self.complex_service.get_complex(incoming_id)
        import_data = {
            "name": normalized.get("name", ""),
            "description": normalized.get("description", ""),
            "tasks": normalized.get("tasks", []),
            "chains": normalized.get("chains", []),
            "settings": normalized.get("settings", {}),
            "theory_link": normalized.get("theory_link"),
            "theory_mode": normalized.get("theory_mode"),
            "created_by_user_id": (
                str(cloned.get("created_by_user_id")).strip()
                if isinstance(cloned.get("created_by_user_id"), str) and str(cloned.get("created_by_user_id")).strip()
                else None
            ),
            "updated_by_user_id": (
                str(cloned.get("updated_by_user_id")).strip()
                if isinstance(cloned.get("updated_by_user_id"), str) and str(cloned.get("updated_by_user_id")).strip()
                else None
            ),
            # Imported complexes must be explicitly marked as archive-originated,
            # otherwise ownership filters cannot distinguish them from local edits.
            "created_via": "archive_import",
            "content_scope": "shared_local",
        }

        if existing:
            existing_payload = self._serialize_datetimes(existing.dict())
            normalized_existing = self._normalized_complex_for_compare(existing_payload)
            normalized_incoming = self._normalized_complex_for_compare(
                {"id": incoming_id, **import_data}
            )
            same_hash = False
            if normalized_existing is not None and normalized_incoming is not None:
                same_hash = (
                    self.package_io.normalized_json_hash(normalized_existing)
                    == self.package_io.normalized_json_hash(normalized_incoming)
                )

            if same_hash:
                return {"status": "skipped", "incoming_id": incoming_id, "final_id": incoming_id, "reason": "duplicate"}

            if complex_conflict_policy == "skip":
                return {"status": "skipped", "incoming_id": incoming_id, "final_id": incoming_id, "reason": "conflict_skip"}

            if complex_conflict_policy == "overwrite":
                self.complex_service.update_complex(incoming_id, import_data, expected_version=None)
                return {"status": "imported", "incoming_id": incoming_id, "final_id": incoming_id, "action": "overwrite"}

            if complex_conflict_policy == "new_id":
                new_id = str(uuid.uuid4())
                create_payload = {"id": new_id, **import_data}
                self.complex_service.create_complex(create_payload)
                return {"status": "imported", "incoming_id": incoming_id, "final_id": new_id, "action": "new_id"}

            return {"status": "error", "incoming_id": incoming_id, "error": "unsupported_complex_policy"}

        create_payload = {"id": incoming_id, **import_data}
        self.complex_service.create_complex(create_payload)
        return {"status": "imported", "incoming_id": incoming_id, "final_id": incoming_id}

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _create_state_backup(self) -> Path:
        backup_root = Path(tempfile.mkdtemp(prefix="complex_import_backup_"))
        modules_backup = backup_root / "modules"
        theories_backup = backup_root / "theories"
        complexes_backup = backup_root / "complexes.json"

        if self.storage.modules_dir.exists():
            shutil.copytree(self.storage.modules_dir, modules_backup)

        if self.theory_service.theories_dir.exists():
            shutil.copytree(self.theory_service.theories_dir, theories_backup)
        else:
            theories_backup.mkdir(parents=True, exist_ok=True)

        if self.complex_service.complexes_file.exists():
            shutil.copy2(self.complex_service.complexes_file, complexes_backup)
        else:
            complexes_backup.write_text("[]", encoding="utf-8")

        return backup_root

    def _restore_state_backup(self, backup_root: Path) -> None:
        modules_backup = backup_root / "modules"
        theories_backup = backup_root / "theories"
        complexes_backup = backup_root / "complexes.json"

        if self.storage.modules_dir.exists():
            shutil.rmtree(self.storage.modules_dir)
        if modules_backup.exists():
            shutil.copytree(modules_backup, self.storage.modules_dir)

        if self.theory_service.theories_dir.exists():
            shutil.rmtree(self.theory_service.theories_dir)
        shutil.copytree(theories_backup, self.theory_service.theories_dir)

        self.complex_service.complexes_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(complexes_backup, self.complex_service.complexes_file)

        self.storage.reload_modules()
        self.complex_service.load_complexes()

    def _generate_unique_theory_id(self) -> str:
        while True:
            theory_id = self.theory_service._generate_theory_id()  # pylint: disable=protected-access
            if not (self.theory_service.theories_dir / theory_id).exists():
                return theory_id

    def _parse_task_ref(self, task_ref: str) -> Optional[Tuple[str, str, str]]:
        if not isinstance(task_ref, str):
            return None
        parts = [p for p in task_ref.split("/") if p != ""]
        if len(parts) < 3:
            return None
        module_id = parts[0].strip()
        topic_id = parts[1].strip()
        task_id = parts[-1].strip()
        if not module_id or not topic_id or not task_id:
            return None
        return module_id, topic_id, task_id

    def _serialize_datetimes(self, value: Any) -> Any:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, dict):
            return {k: self._serialize_datetimes(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self._serialize_datetimes(item) for item in value]
        return value

    def _normalized_complex_for_compare(self, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        normalized, _ = validate_and_normalize_create_payload(payload)
        if normalized is None:
            return None
        theory_link = normalized.get("theory_link")
        if isinstance(theory_link, dict):
            cleaned_theory_link = dict(theory_link)
            cleaned_theory_link.pop("updated_at", None)
            cleaned_theory_link.pop("title_cache", None)
            cleaned_theory_link.pop("missing", None)
            normalized["theory_link"] = cleaned_theory_link
        return normalized
