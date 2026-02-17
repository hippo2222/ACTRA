import json
import os
import shutil
import tempfile
from pathlib import Path

import pytest

import sys


_DESKTOP_APP_ROOT = Path(__file__).resolve().parents[2]
if str(_DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(_DESKTOP_APP_ROOT))

from services.complex_import_export_service import ComplexImportExportService
from services.complex_service import ComplexService
from services.import_export_service import ImportExportService
from services.storage_service import StorageService
from services.theory_service import TheoryService


def _create_task(data_dir: Path, module_id: str, topic_id: str, task_id: str) -> None:
    module_dir = data_dir / "modules" / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id
    task_dir.mkdir(parents=True, exist_ok=True)

    (module_dir / "module.json").write_text(
        json.dumps({"id": module_id, "name": module_id}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (topic_dir / "topic.json").write_text(
        json.dumps({"id": topic_id, "name": topic_id}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (task_dir / "task.json").write_text(
        json.dumps(
            {
                "id": task_id,
                "name": "Task",
                "type": "open_answer",
                "content": {"prompt": "Sample prompt"},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


class _Env:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.storage = StorageService(str(data_dir))
        self.complex_service = ComplexService(str(data_dir))
        self.theory_service = TheoryService(str(data_dir))
        self.task_io = ImportExportService(self.storage)
        self.complex_io = ComplexImportExportService(
            storage_service=self.storage,
            complex_service=self.complex_service,
            theory_service=self.theory_service,
            task_import_export_service=self.task_io,
        )


@pytest.fixture
def temp_dirs():
    source_root = Path(tempfile.mkdtemp(prefix="complex_src_"))
    target_root = Path(tempfile.mkdtemp(prefix="complex_dst_"))
    src_data = source_root / "data"
    dst_data = target_root / "data"
    src_data.mkdir(parents=True, exist_ok=True)
    dst_data.mkdir(parents=True, exist_ok=True)
    try:
        yield src_data, dst_data
    finally:
        shutil.rmtree(source_root, ignore_errors=True)
        shutil.rmtree(target_root, ignore_errors=True)


def _prepare_source_env(source_data: Path) -> _Env:
    _create_task(source_data, "mod1", "topic1", "task1")
    env = _Env(source_data)
    env.theory_service.create_theory(
        {
            "id": "th_shared",
            "title": "Shared theory",
            "delta": {"ops": [{"insert": "Theory text\n"}]},
        }
    )
    env.complex_service.create_complex(
        {
            "id": "cx_1",
            "name": "Complex One",
            "description": "",
            "tasks": ["mod1/topic1/task1"],
            "chains": [],
            "settings": {},
            "theory_link": {"theory_id": "th_shared", "relation": "link"},
        }
    )
    return env


def test_complex_bundle_export_import_roundtrip(temp_dirs):
    source_data, target_data = temp_dirs
    source_env = _prepare_source_env(source_data)
    target_env = _Env(target_data)

    archive_path = source_env.complex_io.create_export_archive(["cx_1"])
    try:
        report = target_env.complex_io.validate_import_archive(archive_path)
        assert report["ok"] is True
        assert report["summary"]["total"] == 1

        result = target_env.complex_io.import_complexes_atomic(
            archive_path,
            params={
                "complex_conflict_resolution": "new_id",
                "task_conflict_resolution": "skip",
                "theory_conflict_resolution": "reuse_if_same_hash",
                "atomic_mode": "bundle",
                "skip_errors": False,
            },
        )
        assert result["ok"] is True
        assert result["imported_complexes"] == 1

        complex_obj = target_env.complex_service.get_complex("cx_1")
        assert complex_obj is not None
        assert complex_obj.dict().get("theory_link", {}).get("theory_id") == "th_shared"

        loaded_task = target_env.storage.load_task("mod1", "topic1", "task1")
        assert loaded_task is not None

        loaded_theory = target_env.theory_service.get_theory("th_shared", include_delta=True)
        assert loaded_theory["title"] == "Shared theory"
    finally:
        if os.path.exists(archive_path):
            os.remove(archive_path)


def test_complex_import_remaps_theory_when_id_conflicts(temp_dirs):
    source_data, target_data = temp_dirs
    source_env = _prepare_source_env(source_data)
    target_env = _Env(target_data)

    target_env.theory_service.create_theory(
        {
            "id": "th_shared",
            "title": "Conflicting theory",
            "delta": {"ops": [{"insert": "Different content\n"}]},
        }
    )

    archive_path = source_env.complex_io.create_export_archive(["cx_1"])
    try:
        result = target_env.complex_io.import_complexes_atomic(
            archive_path,
            params={
                "complex_conflict_resolution": "new_id",
                "task_conflict_resolution": "skip",
                "theory_conflict_resolution": "reuse_if_same_hash",
                "atomic_mode": "bundle",
                "skip_errors": False,
            },
        )
        assert result["ok"] is True
        assert result["theories"]["imported"] == 1
        remapped = result["id_remap"]["theories"]["th_shared"]
        assert remapped != "th_shared"

        complex_obj = target_env.complex_service.get_complex("cx_1")
        assert complex_obj is not None
        assert complex_obj.dict().get("theory_link", {}).get("theory_id") == remapped

        remapped_theory = target_env.theory_service.get_theory(remapped, include_delta=True)
        assert remapped_theory["title"] == "Shared theory"
    finally:
        if os.path.exists(archive_path):
            os.remove(archive_path)
