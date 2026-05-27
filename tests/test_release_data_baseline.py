from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
VALIDATOR_PATH = PROJECT_ROOT / "scripts" / "validate_release_catalog.py"

_SPEC = importlib.util.spec_from_file_location("validate_release_catalog_script", VALIDATOR_PATH)
assert _SPEC and _SPEC.loader
validator = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = validator
_SPEC.loader.exec_module(validator)


def _build_empty_release_data(tmp_path: Path) -> Path:
    data_dir = tmp_path / "data"
    (data_dir / "modules").mkdir(parents=True, exist_ok=True)
    (data_dir / "complexes" / "theories").mkdir(parents=True, exist_ok=True)
    (data_dir / "complexes" / "history").mkdir(parents=True, exist_ok=True)
    (data_dir / "complexes" / "complexes.json").write_text("[]\n", encoding="utf-8")
    return data_dir


def test_expect_empty_release_baseline_passes_when_catalog_is_blank(tmp_path: Path) -> None:
    data_dir = _build_empty_release_data(tmp_path)

    result = validator.validate_release_catalog(data_dir, expect_empty=True)

    assert result.errors == []
    assert result.warnings == []
    assert result.catalog_stats == {
        "modules": 0,
        "topics": 0,
        "tasks": 0,
        "complexes": 0,
        "theories": 0,
    }


def test_expect_empty_release_baseline_flags_bundled_learning_content(tmp_path: Path) -> None:
    data_dir = _build_empty_release_data(tmp_path)
    module_dir = data_dir / "modules" / "legacy_module"
    task_dir = module_dir / "topics" / "legacy_topic" / "tasks" / "legacy_task"
    task_dir.mkdir(parents=True, exist_ok=True)
    task_path = task_dir / "task.json"
    task_path.write_text(json.dumps({"id": "legacy_task", "type": "test"}), encoding="utf-8")
    (module_dir / "module.json").write_text(
        json.dumps(
            {
                "id": "legacy_module",
                "name": "Legacy Module",
                "topics": [
                    {
                        "id": "legacy_topic",
                        "name": "Legacy Topic",
                        "tasks": [
                            {
                                "id": "legacy_task",
                                "type": "test",
                                "path": "modules/legacy_module/topics/legacy_topic/tasks/legacy_task/task.json",
                            }
                        ],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    theory_dir = data_dir / "complexes" / "theories" / "th_legacy"
    theory_dir.mkdir(parents=True, exist_ok=True)
    (theory_dir / "theory.json").write_text(json.dumps({"id": "th_legacy"}), encoding="utf-8")
    (data_dir / "complexes" / "complexes.json").write_text(
        json.dumps([{"id": "cx_legacy", "tasks": ["legacy_module/legacy_topic/legacy_task"], "theory_link": {"theory_id": "th_legacy"}}]),
        encoding="utf-8",
    )

    result = validator.validate_release_catalog(data_dir, expect_empty=True)
    error_codes = {issue.code for issue in result.errors}

    assert "expected_empty_modules" in error_codes
    assert "expected_empty_topics" in error_codes
    assert "expected_empty_tasks" in error_codes
    assert "expected_empty_complexes" in error_codes
    assert "expected_empty_theories" in error_codes
