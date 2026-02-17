#!/usr/bin/env python3
"""Validate release catalog integrity for build/release pipelines.

Checks:
1. Module catalog integrity (`data/modules/**/module.json`)
2. Complex/theory integrity (`data/complexes/complexes.json`, `data/complexes/theories/*`)
3. Orphan task files (`task.json` that are not referenced in module.json)
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple

NON_DEMO_MINIMUMS = {
    "modules": 2,
    "topics": 2,
    "tasks": 6,
    "complexes": 2,
    "theories": 2,
}


@dataclass
class ValidationIssue:
    severity: str
    code: str
    location: str
    message: str


@dataclass
class ValidationResult:
    errors: List[ValidationIssue]
    warnings: List[ValidationIssue]
    orphan_task_files: List[Path]
    catalog_task_refs: Set[str]
    catalog_stats: Dict[str, int]


def _read_json(path: Path) -> Tuple[Optional[Any], Optional[str]]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(handle), None
    except FileNotFoundError:
        return None, "file_not_found"
    except json.JSONDecodeError as exc:
        return None, f"json_decode_error: {exc}"
    except Exception as exc:  # pragma: no cover - defensive path
        return None, f"read_error: {exc}"


def _resolve_task_json_path(raw_path: str, data_dir: Path) -> Path:
    normalized = raw_path.replace("\\", "/").strip()
    if not normalized:
        return data_dir / "__invalid_empty_path__"

    path = Path(normalized)
    if path.is_absolute():
        return path

    if normalized.startswith("../data/"):
        return data_dir / normalized.replace("../data/", "", 1)
    if normalized.startswith("data/"):
        return data_dir / normalized.replace("data/", "", 1)
    return data_dir / normalized


def _issue(
    target: List[ValidationIssue], severity: str, code: str, location: Path | str, message: str
) -> None:
    target.append(
        ValidationIssue(
            severity=severity,
            code=code,
            location=str(location),
            message=message,
        )
    )


def _validate_modules(
    data_dir: Path,
) -> Tuple[List[ValidationIssue], List[ValidationIssue], Set[Path], Set[str]]:
    errors: List[ValidationIssue] = []
    warnings: List[ValidationIssue] = []
    referenced_task_files: Set[Path] = set()
    catalog_task_refs: Set[str] = set()

    modules_dir = data_dir / "modules"
    if not modules_dir.exists() or not modules_dir.is_dir():
        _issue(errors, "error", "modules_dir_missing", modules_dir, "Modules directory is missing.")
        return errors, warnings, referenced_task_files, catalog_task_refs

    module_dirs = sorted([p for p in modules_dir.iterdir() if p.is_dir()])
    if not module_dirs:
        _issue(errors, "error", "modules_empty", modules_dir, "No modules found in data/modules.")
        return errors, warnings, referenced_task_files, catalog_task_refs

    for module_dir in module_dirs:
        module_json = module_dir / "module.json"
        if not module_json.exists():
            _issue(
                errors,
                "error",
                "module_json_missing",
                module_json,
                "Every module must define module.json for release.",
            )
            continue

        module_data, err = _read_json(module_json)
        if err is not None:
            _issue(errors, "error", "module_json_invalid", module_json, err)
            continue
        if not isinstance(module_data, dict):
            _issue(
                errors,
                "error",
                "module_json_not_object",
                module_json,
                "module.json must be an object.",
            )
            continue

        raw_module_id = module_data.get("id")
        module_id = (
            raw_module_id.strip()
            if isinstance(raw_module_id, str) and raw_module_id.strip()
            else module_dir.name
        )
        if raw_module_id is None:
            _issue(
                warnings,
                "warning",
                "module_id_missing",
                module_json,
                f"module.id missing; fallback to folder name '{module_id}'.",
            )

        topics = module_data.get("topics")
        if not isinstance(topics, list):
            _issue(
                errors, "error", "topics_not_array", module_json, "module.topics must be an array."
            )
            continue
        if not topics:
            _issue(
                errors,
                "error",
                "topics_empty",
                module_json,
                "module.topics must not be empty for release.",
            )
            continue

        for topic_idx, topic in enumerate(topics):
            topic_loc = f"{module_json}::topics[{topic_idx}]"
            if not isinstance(topic, dict):
                _issue(
                    errors, "error", "topic_not_object", topic_loc, "Topic entry must be an object."
                )
                continue

            raw_topic_id = topic.get("id")
            if not isinstance(raw_topic_id, str) or not raw_topic_id.strip():
                _issue(errors, "error", "topic_id_required", topic_loc, "Topic id is required.")
                continue
            topic_id = raw_topic_id.strip()

            tasks = topic.get("tasks")
            if not isinstance(tasks, list):
                _issue(
                    errors, "error", "tasks_not_array", topic_loc, "topic.tasks must be an array."
                )
                continue
            if not tasks:
                _issue(errors, "error", "tasks_empty", topic_loc, "topic.tasks must not be empty.")
                continue

            for task_idx, task in enumerate(tasks):
                task_loc = f"{topic_loc}::tasks[{task_idx}]"
                if not isinstance(task, dict):
                    _issue(
                        errors,
                        "error",
                        "task_entry_not_object",
                        task_loc,
                        "Task entry must be an object with id/type/path.",
                    )
                    continue

                task_id = task.get("id")
                task_type = task.get("type")
                task_path = task.get("path")

                if not isinstance(task_id, str) or not task_id.strip():
                    _issue(errors, "error", "task_id_required", task_loc, "Task id is required.")
                if not isinstance(task_type, str) or not task_type.strip():
                    _issue(
                        errors, "error", "task_type_required", task_loc, "Task type is required."
                    )
                if not isinstance(task_path, str) or not task_path.strip():
                    _issue(
                        errors, "error", "task_path_required", task_loc, "Task path is required."
                    )
                    continue

                resolved_task_path = _resolve_task_json_path(task_path, data_dir).resolve()
                if resolved_task_path.name != "task.json":
                    _issue(
                        errors,
                        "error",
                        "task_path_not_task_json",
                        task_loc,
                        f"Task path must point to task.json, got: {task_path}",
                    )
                    continue

                try:
                    resolved_task_path.relative_to(data_dir.resolve())
                except ValueError:
                    _issue(
                        errors,
                        "error",
                        "task_path_outside_data_dir",
                        task_loc,
                        f"Task path resolves outside data/: {resolved_task_path}",
                    )
                    continue

                if not resolved_task_path.exists() or not resolved_task_path.is_file():
                    _issue(
                        errors,
                        "error",
                        "task_file_missing",
                        task_loc,
                        f"Referenced task file not found: {resolved_task_path}",
                    )
                    continue

                referenced_task_files.add(resolved_task_path)
                if isinstance(task_id, str) and task_id.strip():
                    catalog_task_refs.add(f"{module_id}/{topic_id}/{task_id.strip()}")

    return errors, warnings, referenced_task_files, catalog_task_refs


def _collect_orphan_tasks(modules_dir: Path, referenced_task_files: Set[Path]) -> List[Path]:
    all_task_files = sorted([p.resolve() for p in modules_dir.rglob("task.json") if p.is_file()])
    referenced = {p.resolve() for p in referenced_task_files}
    return [task_file for task_file in all_task_files if task_file not in referenced]


def _validate_complexes_and_theories(
    data_dir: Path, catalog_task_refs: Set[str]
) -> Tuple[List[ValidationIssue], List[ValidationIssue]]:
    errors: List[ValidationIssue] = []
    warnings: List[ValidationIssue] = []

    complexes_dir = data_dir / "complexes"
    theories_dir = complexes_dir / "theories"
    complexes_file = complexes_dir / "complexes.json"

    if not complexes_dir.exists() or not complexes_dir.is_dir():
        _issue(
            errors,
            "error",
            "complexes_dir_missing",
            complexes_dir,
            "Complexes directory is missing.",
        )
        return errors, warnings

    existing_theories: Set[str] = set()
    if not theories_dir.exists() or not theories_dir.is_dir():
        _issue(
            errors, "error", "theories_dir_missing", theories_dir, "Theories directory is missing."
        )
    else:
        for theory_dir in sorted([p for p in theories_dir.iterdir() if p.is_dir()]):
            theory_json = theory_dir / "theory.json"
            if not theory_json.exists():
                _issue(
                    warnings,
                    "warning",
                    "theory_json_missing",
                    theory_dir,
                    "Theory directory without theory.json was ignored.",
                )
                continue
            theory_data, err = _read_json(theory_json)
            if err is not None:
                _issue(errors, "error", "theory_json_invalid", theory_json, err)
                continue

            theory_id = theory_dir.name
            if isinstance(theory_data, dict):
                raw_id = theory_data.get("id")
                if isinstance(raw_id, str) and raw_id.strip():
                    theory_id = raw_id.strip()
            existing_theories.add(theory_id)

    if not existing_theories:
        _issue(
            errors,
            "error",
            "no_theories",
            theories_dir,
            "Release catalog must contain at least one theory.",
        )

    complexes_data, complexes_err = _read_json(complexes_file)
    if complexes_err is not None:
        _issue(errors, "error", "complexes_json_invalid", complexes_file, complexes_err)
        return errors, warnings

    if not isinstance(complexes_data, list):
        _issue(
            errors,
            "error",
            "complexes_not_array",
            complexes_file,
            "complexes.json must contain an array.",
        )
        return errors, warnings
    if not complexes_data:
        _issue(
            errors,
            "error",
            "complexes_empty",
            complexes_file,
            "Release catalog must contain at least one complex.",
        )
        return errors, warnings

    for index, complex_obj in enumerate(complexes_data):
        loc = f"{complexes_file}::[{index}]"
        if not isinstance(complex_obj, dict):
            _issue(errors, "error", "complex_not_object", loc, "Complex entry must be an object.")
            continue

        complex_id = complex_obj.get("id")
        if not isinstance(complex_id, str) or not complex_id.strip():
            _issue(errors, "error", "complex_id_required", loc, "Complex id is required.")

        tasks = complex_obj.get("tasks")
        if not isinstance(tasks, list) or not tasks:
            _issue(
                errors,
                "error",
                "complex_tasks_required",
                loc,
                "Complex tasks must be a non-empty array.",
            )
            tasks_list: List[Any] = []
        else:
            tasks_list = tasks

        for task_pos, task_ref in enumerate(tasks_list):
            task_loc = f"{loc}::tasks[{task_pos}]"
            if not isinstance(task_ref, str) or not task_ref.strip():
                _issue(
                    errors,
                    "error",
                    "complex_task_ref_invalid",
                    task_loc,
                    "Task ref must be a non-empty string.",
                )
                continue
            if catalog_task_refs and task_ref not in catalog_task_refs:
                _issue(
                    errors,
                    "error",
                    "complex_task_ref_missing_in_catalog",
                    task_loc,
                    f"Task ref is missing in module catalog: {task_ref}",
                )

        theory_link = complex_obj.get("theory_link")
        if not isinstance(theory_link, dict):
            _issue(
                errors,
                "error",
                "theory_link_required",
                loc,
                "Complex must contain theory_link with a valid theory_id.",
            )
            continue

        raw_theory_id = theory_link.get("theory_id")
        if not isinstance(raw_theory_id, str) or not raw_theory_id.strip():
            _issue(errors, "error", "theory_id_required", loc, "theory_link.theory_id is required.")
            continue

        theory_id = raw_theory_id.strip()
        if theory_id not in existing_theories:
            _issue(
                errors,
                "error",
                "theory_id_not_found",
                loc,
                f"theory_link.theory_id does not exist in data/complexes/theories: {theory_id}",
            )

    return errors, warnings


def _collect_catalog_stats(data_dir: Path) -> Dict[str, int]:
    modules_count = 0
    topics_count = 0
    tasks_count = 0
    complexes_count = 0
    theories_count = 0

    modules_dir = data_dir / "modules"
    if modules_dir.exists() and modules_dir.is_dir():
        for module_dir in sorted([p for p in modules_dir.iterdir() if p.is_dir()]):
            module_json = module_dir / "module.json"
            if not module_json.exists():
                continue
            module_data, err = _read_json(module_json)
            if err is not None or not isinstance(module_data, dict):
                continue
            modules_count += 1
            topics = module_data.get("topics")
            if not isinstance(topics, list):
                continue
            for topic in topics:
                if not isinstance(topic, dict):
                    continue
                topics_count += 1
                tasks = topic.get("tasks")
                if not isinstance(tasks, list):
                    continue
                for task in tasks:
                    if isinstance(task, dict):
                        tasks_count += 1

    complexes_file = data_dir / "complexes" / "complexes.json"
    complexes_data, complexes_err = _read_json(complexes_file)
    if complexes_err is None and isinstance(complexes_data, list):
        complexes_count = len([item for item in complexes_data if isinstance(item, dict)])

    theories_dir = data_dir / "complexes" / "theories"
    if theories_dir.exists() and theories_dir.is_dir():
        for theory_dir in sorted([p for p in theories_dir.iterdir() if p.is_dir()]):
            theory_json = theory_dir / "theory.json"
            if not theory_json.exists():
                continue
            theory_data, theory_err = _read_json(theory_json)
            if theory_err is None and isinstance(theory_data, dict):
                theories_count += 1

    return {
        "modules": modules_count,
        "topics": topics_count,
        "tasks": tasks_count,
        "complexes": complexes_count,
        "theories": theories_count,
    }


def _validate_non_demo_minimums(data_dir: Path, stats: Dict[str, int]) -> List[ValidationIssue]:
    errors: List[ValidationIssue] = []
    for key, required in NON_DEMO_MINIMUMS.items():
        actual = int(stats.get(key, 0))
        if actual < required:
            _issue(
                errors,
                "error",
                f"non_demo_minimum_{key}",
                data_dir,
                f"Non-demo minimum is not met for '{key}': {actual} < {required}.",
            )
    return errors


def validate_release_catalog(data_dir: Path, *, require_non_demo: bool = False) -> ValidationResult:
    all_errors: List[ValidationIssue] = []
    all_warnings: List[ValidationIssue] = []

    mod_errors, mod_warnings, referenced_task_files, catalog_task_refs = _validate_modules(data_dir)
    all_errors.extend(mod_errors)
    all_warnings.extend(mod_warnings)

    modules_dir = data_dir / "modules"
    orphan_task_files = (
        _collect_orphan_tasks(modules_dir, referenced_task_files) if modules_dir.exists() else []
    )
    for orphan in orphan_task_files:
        _issue(
            all_errors,
            "error",
            "orphan_task_file",
            orphan,
            "Task file is not referenced by any module.json entry.",
        )

    complex_errors, complex_warnings = _validate_complexes_and_theories(data_dir, catalog_task_refs)
    all_errors.extend(complex_errors)
    all_warnings.extend(complex_warnings)

    stats = _collect_catalog_stats(data_dir)
    if require_non_demo:
        all_errors.extend(_validate_non_demo_minimums(data_dir, stats))

    return ValidationResult(
        errors=all_errors,
        warnings=all_warnings,
        orphan_task_files=orphan_task_files,
        catalog_task_refs=catalog_task_refs,
        catalog_stats=stats,
    )


def _prune_orphan_tasks(orphan_task_files: Iterable[Path]) -> List[Tuple[Path, Optional[str]]]:
    results: List[Tuple[Path, Optional[str]]] = []
    for task_file in orphan_task_files:
        task_dir = task_file.parent
        try:
            shutil.rmtree(task_dir)
            results.append((task_dir, None))
        except Exception as exc:  # pragma: no cover - defensive path
            results.append((task_dir, str(exc)))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate release catalog integrity.")
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Path to data directory (default: ./data)",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON summary.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors.",
    )
    parser.add_argument(
        "--prune-orphans",
        action="store_true",
        help="Delete orphan task directories and re-run validation.",
    )
    parser.add_argument(
        "--require-non-demo",
        action="store_true",
        help=(
            "Enforce minimum release content criteria "
            f"(modules>={NON_DEMO_MINIMUMS['modules']}, "
            f"topics>={NON_DEMO_MINIMUMS['topics']}, "
            f"tasks>={NON_DEMO_MINIMUMS['tasks']}, "
            f"complexes>={NON_DEMO_MINIMUMS['complexes']}, "
            f"theories>={NON_DEMO_MINIMUMS['theories']})."
        ),
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir).resolve()
    result = validate_release_catalog(data_dir, require_non_demo=args.require_non_demo)

    pruned: List[Tuple[Path, Optional[str]]] = []
    if args.prune_orphans and result.orphan_task_files:
        pruned = _prune_orphan_tasks(result.orphan_task_files)
        result = validate_release_catalog(data_dir, require_non_demo=args.require_non_demo)
        for path, err in pruned:
            if err is not None:
                _issue(result.errors, "error", "orphan_prune_failed", path, err)

    payload = {
        "data_dir": str(data_dir),
        "require_non_demo": args.require_non_demo,
        "non_demo_minimums": dict(NON_DEMO_MINIMUMS),
        "catalog_stats": dict(result.catalog_stats),
        "errors": [asdict(issue) for issue in result.errors],
        "warnings": [asdict(issue) for issue in result.warnings],
        "error_count": len(result.errors),
        "warning_count": len(result.warnings),
        "catalog_task_ref_count": len(result.catalog_task_refs),
        "orphan_task_files": [str(path) for path in result.orphan_task_files],
        "pruned_orphans": [{"path": str(path), "error": err} for path, err in pruned],
    }

    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(
            f"Release catalog: {payload['error_count']} errors, {payload['warning_count']} warnings"
        )
        print(
            "Catalog stats: "
            f"modules={result.catalog_stats['modules']}, "
            f"topics={result.catalog_stats['topics']}, "
            f"tasks={result.catalog_stats['tasks']}, "
            f"complexes={result.catalog_stats['complexes']}, "
            f"theories={result.catalog_stats['theories']}"
        )
        if result.errors:
            print("\nErrors:")
            for issue in result.errors:
                print(f"- [{issue.code}] {issue.location}: {issue.message}")
        if result.warnings:
            print("\nWarnings:")
            for issue in result.warnings:
                print(f"- [{issue.code}] {issue.location}: {issue.message}")
        if pruned:
            print("\nPrune results:")
            for path, err in pruned:
                if err is None:
                    print(f"- deleted: {path}")
                else:
                    print(f"- failed: {path}: {err}")

    has_failure = bool(result.errors) or (args.strict and bool(result.warnings))
    return 1 if has_failure else 0


if __name__ == "__main__":
    sys.exit(main())
