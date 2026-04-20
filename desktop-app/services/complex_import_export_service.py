import json
import io
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
from persistence.runtime import HOSTED_SHADOW_WRITE_FALLBACK_ENV
from werkzeug.datastructures import FileStorage

from .hosted_shadow_fallback import (
    HostedShadowReadFallbackDisabledError,
    HostedShadowWriteFallbackDisabledError,
)
from .package_io import PackageIO
from .theory_service import TheoryNotFoundError


ComplexImportReport = Dict[str, Any]

_WORKSPACE_IMPORT_MARKER_KEYS = (
    "source_complex_id",
    "source_catalog_item_id",
    "source_catalog_version_id",
    "prefer_existing_by_lineage",
    "requested_by_user_id",
)


class ComplexImportExportService:
    """Import/export service for full complex bundles (complex + tasks + theory)."""

    SPEC = "actra.package/2"
    ALLOWED_EXTENSIONS = {".json", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"}
    SERVICE_CONTRACT = {
        "namespace": "public_editor_import_export",
        "import_family": "complex_archive_import",
        "workspace_import": False,
        "public_api": True,
    }

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
                        if not self._write_task_payload_to_archive(
                            zf,
                            module_id,
                            topic_id,
                            task_id,
                            checksums=checksums,
                        ):
                            missing_tasks.append(task_ref)
                            continue

                if include_theories:
                    for theory_id in sorted(exported_theory_ids):
                        if not self._write_theory_payload_to_archive(
                            zf,
                            theory_id,
                            checksums=checksums,
                        ):
                            missing_theories.append(theory_id)
                            continue

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

    def _write_task_payload_to_archive(
        self,
        zf: zipfile.ZipFile,
        module_id: str,
        topic_id: str,
        task_id: str,
        *,
        checksums: Dict[str, str],
    ) -> bool:
        arc_root = f"modules/{module_id}/topics/{topic_id}/tasks/{task_id}"
        loaded_task = None
        if hasattr(self.storage, "load_task"):
            loaded_task = self.storage.load_task(module_id, topic_id, task_id)

        if isinstance(loaded_task, dict) and isinstance(loaded_task.get("task_data"), dict):
            task_payload = json.loads(json.dumps(loaded_task.get("task_data"), ensure_ascii=False))
            task_dir_value = loaded_task.get("task_dir")
            if isinstance(task_dir_value, str) and task_dir_value.strip():
                task_dir = Path(task_dir_value)
            else:
                task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id

            staged_assets: Dict[str, Path] = {}
            rewrite_helper = getattr(self.task_import_export_service, "_rewrite_task_payload_image_refs", None)
            if callable(rewrite_helper):
                task_payload, _ = rewrite_helper(
                    task_payload,
                    task_dir,
                    staged_assets=staged_assets,
                    allow_stage_external=True,
                    allow_asset_resolution=True,
                )

            task_bytes = json.dumps(task_payload, indent=2, ensure_ascii=False).encode("utf-8")
            task_arc_name = f"{arc_root}/task.json"
            zf.writestr(task_arc_name, task_bytes)
            checksums[task_arc_name] = self.package_io.sha256_bytes(task_bytes)
            for portable_rel_path, source_path in staged_assets.items():
                arc_name = f"{arc_root}/{portable_rel_path}".replace("\\", "/")
                zf.write(source_path, arc_name)
                checksums[arc_name] = self.package_io.sha256_file(source_path)
            return True

        task_dir = self.storage.modules_dir / module_id / "topics" / topic_id / "tasks" / task_id
        if not task_dir.exists():
            return False

        for root, dirs, files in os.walk(task_dir):
            dirs.sort()
            files.sort()
            for filename in files:
                file_path = Path(root) / filename
                rel = file_path.relative_to(task_dir).as_posix()
                arc_name = f"{arc_root}/{rel}"
                zf.write(file_path, arc_name)
                checksums[arc_name] = self.package_io.sha256_file(file_path)
        return True

    def _write_theory_payload_to_archive(
        self,
        zf: zipfile.ZipFile,
        theory_id: str,
        *,
        checksums: Dict[str, str],
    ) -> bool:
        try:
            theory_payload = self.theory_service.get_theory(theory_id, include_delta=True)
        except TheoryNotFoundError:
            theory_payload = None

        wrote_anything = False
        if isinstance(theory_payload, dict) and theory_payload:
            theory_meta = {
                "id": theory_payload.get("id", theory_id),
                "title": theory_payload.get("title") or "",
                "created_at": theory_payload.get("created_at"),
                "updated_at": theory_payload.get("updated_at"),
                "version": theory_payload.get("version"),
                "images": theory_payload.get("images") or [],
                "delta_path": "body.delta.json",
                "workspace_entity_kind": theory_payload.get("workspace_entity_kind"),
                "workspace_entity_id": theory_payload.get("workspace_entity_id"),
                "workspace_entity_ref": theory_payload.get("workspace_entity_ref"),
                "workspace_entity": theory_payload.get("workspace_entity"),
                "workspace_copy_kind": theory_payload.get("workspace_copy_kind"),
                "workspace_copy": theory_payload.get("workspace_copy"),
                "created_by_user_id": theory_payload.get("created_by_user_id"),
                "updated_by_user_id": theory_payload.get("updated_by_user_id"),
                "created_via": theory_payload.get("created_via"),
                "content_scope": theory_payload.get("content_scope"),
                "source_catalog_item_id": theory_payload.get("source_catalog_item_id"),
                "source_catalog_version_id": theory_payload.get("source_catalog_version_id"),
                "source_entity_kind": theory_payload.get("source_entity_kind"),
                "source_entity_id": theory_payload.get("source_entity_id"),
                "has_source_lineage": bool(theory_payload.get("has_source_lineage")),
                "source_lineage": theory_payload.get("source_lineage"),
                "source_lineage_key": theory_payload.get("source_lineage_key"),
            }
            theory_meta_bytes = json.dumps(theory_meta, indent=2, ensure_ascii=False).encode("utf-8")
            theory_meta_arc = f"theories/{theory_id}/theory.json"
            zf.writestr(theory_meta_arc, theory_meta_bytes)
            checksums[theory_meta_arc] = self.package_io.sha256_bytes(theory_meta_bytes)

            delta_bytes = json.dumps(
                theory_payload.get("delta") or {"ops": [{"insert": "\n"}]},
                indent=2,
                ensure_ascii=False,
            ).encode("utf-8")
            delta_arc = f"theories/{theory_id}/body.delta.json"
            zf.writestr(delta_arc, delta_bytes)
            checksums[delta_arc] = self.package_io.sha256_bytes(delta_bytes)
            wrote_anything = True

        source_dir = self.theory_service.theories_dir / theory_id
        if source_dir.exists():
            for root, dirs, files in os.walk(source_dir):
                dirs.sort()
                files.sort()
                for filename in files:
                    file_path = Path(root) / filename
                    rel = file_path.relative_to(source_dir).as_posix()
                    if rel.startswith("history/") or rel in {"theory.json", "body.delta.json"}:
                        continue
                    arc_name = f"theories/{theory_id}/{rel}"
                    zf.write(file_path, arc_name)
                    checksums[arc_name] = self.package_io.sha256_file(file_path)
                    wrote_anything = True

        return wrote_anything

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
            return self._with_service_contract(report)
        except Exception as exc:
            self.logger.error("Complex archive validation failed: %s", exc)
            report["critical_error"] = str(exc)
            return self._with_service_contract(report)

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
        self._reject_workspace_import_params(params, context="import_complexes_atomic")
        temp_extract_dir = Path(tempfile.mkdtemp(prefix="complex_import_extract_"))

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
        task_rollback_plan: Optional[Dict[str, Any]] = None
        created_theories: List[str] = []
        overwritten_theories: List[Tuple[str, str]] = []
        created_complexes: List[str] = []
        overwritten_complexes: List[Tuple[str, str]] = []

        try:
            if progress_callback:
                progress_callback(0, 0, "Extracting archive...")

            self.package_io.validate_zip_security(archive_path)
            self.package_io.extract_filtered(archive_path, temp_extract_dir, allowed_extensions=self.ALLOWED_EXTENSIONS)

            if atomic_mode == "bundle":
                task_rollback_plan = self._plan_task_import_rollback(
                    temp_extract_dir,
                    task_conflict_resolution=task_conflict,
                )

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
                    snapshot_timestamp = theory_status.get("snapshot_timestamp")
                    if isinstance(final_id, str) and isinstance(snapshot_timestamp, str):
                        overwritten_theories.append((final_id, snapshot_timestamp))
                else:
                    result["theories"]["imported"] += 1
                    if isinstance(final_id, str):
                        created_theories.append(final_id)

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
                    action = str(import_status.get("action") or "").strip().lower()
                    if action == "overwrite":
                        snapshot_timestamp = import_status.get("snapshot_timestamp")
                        if isinstance(final_id, str) and isinstance(snapshot_timestamp, str):
                            overwritten_complexes.append((final_id, snapshot_timestamp))
                    elif isinstance(final_id, str):
                        created_complexes.append(final_id)
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
            return self._with_service_contract(result)

        except Exception as exc:
            self.logger.error("Complex import failed: %s", exc)
            if atomic_mode == "bundle":
                try:
                    self._rollback_complex_import_changes(
                        task_plan=task_rollback_plan,
                        created_theories=created_theories,
                        overwritten_theories=overwritten_theories,
                        created_complexes=created_complexes,
                        overwritten_complexes=overwritten_complexes,
                    )
                    result["rollback"] = True
                except Exception as rb_exc:
                    self.logger.error("Complex import rollback failed: %s", rb_exc)
                    result["errors"].append({"scope": "rollback", "error": str(rb_exc)})
            hosted_shadow_payload = self._hosted_shadow_error_payload(exc)
            if hosted_shadow_payload is not None:
                hosted_shadow_payload["rollback"] = bool(result.get("rollback"))
                hosted_shadow_payload["imported_complexes"] = result["imported_complexes"]
                hosted_shadow_payload["skipped_complexes"] = result["skipped_complexes"]
                hosted_shadow_payload["complex_errors"] = result["complex_errors"]
                hosted_shadow_payload["theories"] = dict(result["theories"])
                hosted_shadow_payload["tasks"] = dict(result["tasks"])
                hosted_shadow_payload["id_remap"] = {
                    "complexes": dict(result["id_remap"]["complexes"]),
                    "theories": dict(result["id_remap"]["theories"]),
                }
                hosted_shadow_payload["errors"] = list(result["errors"])
                return hosted_shadow_payload
            result["ok"] = False
            result["error_message"] = str(exc)
            return self._with_service_contract(result)
        finally:
            try:
                if temp_extract_dir.exists():
                    shutil.rmtree(temp_extract_dir)
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

        final_id = incoming_id
        overwrite = False
        if existing is None:
            final_id = incoming_id
        else:
            existing_hash = self._compute_theory_hash(
                title=str(existing.get("title") or ""),
                images=list(existing.get("images") or []),
                delta=existing.get("delta") or {"ops": [{"insert": "\n"}]},
            )
            if existing_hash == incoming_hash:
                return {"status": "reused", "incoming_id": incoming_id, "final_id": incoming_id}
            if policy == "overwrite":
                final_id = incoming_id
                overwrite = True
            elif policy in {"reuse_if_same_hash", "new_id_if_diff"}:
                final_id = self._generate_unique_theory_id()
            else:
                return {"status": "error", "incoming_id": incoming_id, "error": "unsupported_theory_policy"}

        snapshot_timestamp: Optional[str] = None
        created_target = False
        try:
            if overwrite:
                snapshot_timestamp = self._capture_theory_snapshot(final_id)
            else:
                create_payload = {
                    "id": final_id,
                    "title": str(incoming_meta.get("title") or ""),
                    "delta": {"ops": [{"insert": "\n"}]},
                    "images": [],
                    "created_by_user_id": incoming_meta.get("created_by_user_id"),
                    "updated_by_user_id": incoming_meta.get("updated_by_user_id"),
                    "created_via": "archive_import",
                    "content_scope": "shared_local",
                }
                self.theory_service.create_theory(create_payload)
                created_target = True

            image_map = self._upload_theory_archive_images(
                source_dir,
                source_theory_id=incoming_id,
                target_theory_id=final_id,
                meta=incoming_meta,
                delta=incoming_delta,
            )
            final_meta, final_delta = self._rewrite_theory_payload_with_uploaded_images(
                incoming_meta,
                incoming_delta,
                image_map,
            )
            update_payload = {
                "title": str(final_meta.get("title") or ""),
                "images": list(final_meta.get("images") or []),
                "delta": final_delta,
                "created_by_user_id": incoming_meta.get("created_by_user_id"),
                "updated_by_user_id": incoming_meta.get("updated_by_user_id"),
                "created_via": "archive_import",
                "content_scope": "shared_local",
            }
            self.theory_service.update_theory(final_id, update_payload, expected_version=None)
        except Exception as exc:
            try:
                if created_target:
                    self.theory_service.delete_theory(final_id)
                elif overwrite and snapshot_timestamp:
                    self.theory_service.restore_from_history(final_id, snapshot_timestamp)
            except Exception as cleanup_exc:
                self.logger.warning(
                    "Theory import cleanup failed for %s -> %s: %s",
                    incoming_id,
                    final_id,
                    cleanup_exc,
                )
            return {
                "status": "error",
                "incoming_id": incoming_id,
                "final_id": final_id,
                "error": str(exc),
            }

        if overwrite:
            return {
                "status": "overwritten",
                "incoming_id": incoming_id,
                "final_id": final_id,
                "snapshot_timestamp": snapshot_timestamp,
            }
        return {"status": "imported", "incoming_id": incoming_id, "final_id": final_id}

    def _capture_theory_snapshot(self, theory_id: str) -> str:
        current_payload = self.theory_service.get_theory(theory_id, include_delta=True)
        meta = {
            key: value
            for key, value in current_payload.items()
            if key != "delta"
        }
        meta["delta_path"] = "body.delta.json"
        delta = current_payload.get("delta") or {"ops": [{"insert": "\n"}]}
        save_snapshot = getattr(self.theory_service, "_save_history_snapshot", None)
        if not callable(save_snapshot):
            raise RuntimeError("theory_history_snapshot_not_supported")
        save_snapshot(theory_id, meta, delta)
        history = self.theory_service.get_history(theory_id)
        if not history or not isinstance(history[0].get("_snapshot_timestamp"), str):
            raise RuntimeError("theory_history_snapshot_missing")
        return str(history[0]["_snapshot_timestamp"])

    def _upload_theory_archive_images(
        self,
        source_dir: Path,
        *,
        source_theory_id: str,
        target_theory_id: str,
        meta: Dict[str, Any],
        delta: Dict[str, Any],
    ) -> Dict[str, str]:
        image_map: Dict[str, str] = {}
        image_refs = list(meta.get("images") or [])
        for image_ref in self._collect_delta_image_refs(delta):
            if image_ref not in image_refs:
                image_refs.append(image_ref)

        for raw_ref in image_refs:
            normalized_ref = self._normalize_theory_archive_image_ref(raw_ref)
            if not normalized_ref or normalized_ref in image_map:
                continue
            image_source = self._resolve_theory_archive_image_source(
                source_dir,
                normalized_ref,
                source_theory_id=source_theory_id,
            )
            if image_source is None:
                raise ValueError(f"missing_theory_image:{normalized_ref}")
            with image_source.open("rb") as image_file:
                upload = FileStorage(
                    stream=io.BytesIO(image_file.read()),
                    filename=image_source.name,
                    content_type=None,
                )
            image_result = self.theory_service.add_image(target_theory_id, upload)
            uploaded_path = str(image_result.get("path") or "").strip()
            if not uploaded_path:
                raise ValueError(f"theory_image_upload_missing_path:{normalized_ref}")
            image_map[normalized_ref] = uploaded_path.replace("\\", "/").lstrip("/")
        return image_map

    def _normalize_theory_archive_image_ref(self, raw_ref: Any) -> str:
        if not isinstance(raw_ref, str):
            return ""
        return raw_ref.replace("\\", "/").lstrip("/")

    def _resolve_theory_archive_image_source(
        self,
        source_dir: Path,
        raw_ref: str,
        *,
        source_theory_id: str,
    ) -> Optional[Path]:
        normalized = self._normalize_theory_archive_image_ref(raw_ref)
        if not normalized:
            return None

        candidates: List[Path] = [source_dir / normalized, source_dir / Path(normalized).name]
        prefix = f"complexes/theories/{source_theory_id}/images/"
        if normalized.startswith(prefix):
            suffix = normalized[len(prefix):]
            candidates.append(source_dir / "images" / suffix)
        elif normalized.startswith("images/"):
            candidates.append(source_dir / normalized)
        elif "/images/" in normalized:
            suffix = normalized.split("/images/", 1)[-1]
            candidates.append(source_dir / "images" / suffix)
        else:
            candidates.append(source_dir / "images" / normalized)

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

    def _rewrite_theory_payload_with_uploaded_images(
        self,
        meta: Dict[str, Any],
        delta: Dict[str, Any],
        image_map: Dict[str, str],
    ) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        rewritten_meta = dict(meta or {})
        rewritten_delta = {"ops": []}
        rewritten_images: List[str] = []

        for raw_ref in list(rewritten_meta.get("images") or []):
            normalized_ref = self._normalize_theory_archive_image_ref(raw_ref)
            if normalized_ref in image_map:
                uploaded_ref = image_map[normalized_ref]
                if uploaded_ref not in rewritten_images:
                    rewritten_images.append(uploaded_ref)
        rewritten_meta["images"] = rewritten_images

        for op in list((delta or {}).get("ops") or []):
            if not isinstance(op, dict):
                continue
            cloned_op = dict(op)
            insert = cloned_op.get("insert")
            if isinstance(insert, dict) and isinstance(insert.get("image"), str):
                normalized_ref = self._normalize_theory_archive_image_ref(insert["image"])
                if normalized_ref in image_map:
                    cloned_insert = dict(insert)
                    cloned_insert["image"] = image_map[normalized_ref]
                    cloned_op["insert"] = cloned_insert
                    if cloned_insert["image"] not in rewritten_images:
                        rewritten_images.append(cloned_insert["image"])
            rewritten_delta["ops"].append(cloned_op)

        rewritten_meta["images"] = rewritten_images
        return rewritten_meta, {"ops": rewritten_delta["ops"] or [{"insert": "\n"}]}

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
                snapshot_timestamp = self._latest_complex_snapshot_timestamp(incoming_id)
                return {
                    "status": "imported",
                    "incoming_id": incoming_id,
                    "final_id": incoming_id,
                    "action": "overwrite",
                    "snapshot_timestamp": snapshot_timestamp,
                }

            if complex_conflict_policy == "new_id":
                new_id = str(uuid.uuid4())
                create_payload = {"id": new_id, **import_data}
                self.complex_service.create_complex(create_payload)
                return {"status": "imported", "incoming_id": incoming_id, "final_id": new_id, "action": "new_id"}

            return {"status": "error", "incoming_id": incoming_id, "error": "unsupported_complex_policy"}

        create_payload = {"id": incoming_id, **import_data}
        self.complex_service.create_complex(create_payload)
        return {
            "status": "imported",
            "incoming_id": incoming_id,
            "final_id": incoming_id,
            "action": "create",
        }

    # -------------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------------

    def _plan_task_import_rollback(
        self,
        temp_extract_dir: Path,
        *,
        task_conflict_resolution: str,
    ) -> Dict[str, Any]:
        plan: Dict[str, Any] = {
            "new_tasks": [],
            "overwritten_tasks": [],
            "created_targets": [],
        }
        created_target_keys: Set[Tuple[str, str, Optional[str]]] = set()

        for task_file in sorted(temp_extract_dir.rglob("task.json")):
            rel_parts = task_file.relative_to(temp_extract_dir).parts
            if len(rel_parts) < 6 or rel_parts[0] != "modules" or rel_parts[2] != "topics" or rel_parts[4] != "tasks":
                continue

            module_id = str(rel_parts[1]).strip()
            topic_id = str(rel_parts[3]).strip()
            if not module_id or not topic_id:
                continue

            task_data = json.loads(task_file.read_text(encoding="utf-8"))
            task_id = str(task_data.get("id") or "").strip() or str(rel_parts[5]).strip()
            if not task_id:
                continue

            existing_payload = self.storage.load_task(module_id, topic_id, task_id)
            if isinstance(existing_payload, dict) and isinstance(existing_payload.get("task_data"), dict):
                if task_conflict_resolution == "overwrite":
                    plan["overwritten_tasks"].append(
                        (
                            module_id,
                            topic_id,
                            task_id,
                            json.loads(json.dumps(existing_payload["task_data"], ensure_ascii=False)),
                        )
                    )
            else:
                plan["new_tasks"].append((module_id, topic_id, task_id))

            if not self.storage.get_module(module_id):
                key = ("module", module_id, None)
                if key not in created_target_keys:
                    created_target_keys.add(key)
                    plan["created_targets"].append(key)
            if not self.storage.get_topic(module_id, topic_id):
                key = ("topic", module_id, topic_id)
                if key not in created_target_keys:
                    created_target_keys.add(key)
                    plan["created_targets"].append(key)

        return plan

    def _rollback_task_import_plan(self, task_plan: Optional[Dict[str, Any]]) -> None:
        if not isinstance(task_plan, dict):
            return

        for module_id, topic_id, task_id in reversed(list(task_plan.get("new_tasks") or [])):
            self.storage.delete_task(module_id, topic_id, task_id)
        for module_id, topic_id, task_id, backup_payload in reversed(list(task_plan.get("overwritten_tasks") or [])):
            self.storage.save_task(
                module_id,
                topic_id,
                task_id,
                json.loads(json.dumps(backup_payload, ensure_ascii=False)),
                validate=False,
            )
        for kind, module_id, topic_id in reversed(list(task_plan.get("created_targets") or [])):
            if kind == "topic" and topic_id:
                self.storage.delete_topic(module_id, topic_id)
            elif kind == "module":
                self.storage.delete_module(module_id)

    def _rollback_complex_import_changes(
        self,
        *,
        task_plan: Optional[Dict[str, Any]],
        created_theories: List[str],
        overwritten_theories: List[Tuple[str, str]],
        created_complexes: List[str],
        overwritten_complexes: List[Tuple[str, str]],
    ) -> None:
        for complex_id in reversed(created_complexes):
            self.complex_service.delete_complex(complex_id)
        for complex_id, snapshot_timestamp in reversed(overwritten_complexes):
            self.complex_service.restore_from_history(complex_id, snapshot_timestamp)
        for theory_id in reversed(created_theories):
            self.theory_service.delete_theory(theory_id)
        for theory_id, snapshot_timestamp in reversed(overwritten_theories):
            self.theory_service.restore_from_history(theory_id, snapshot_timestamp)
        self._rollback_task_import_plan(task_plan)
        self.storage.reload_modules()
        self.complex_service.load_complexes()

    def _latest_complex_snapshot_timestamp(self, complex_id: str) -> str:
        history = self.complex_service.get_complex_history(complex_id)
        if not history or not isinstance(history[0].get("_snapshot_timestamp"), str):
            raise RuntimeError(f"complex_history_snapshot_missing:{complex_id}")
        return str(history[0]["_snapshot_timestamp"])

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
