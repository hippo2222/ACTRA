from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}


@dataclass
class ImageReference:
    task_json: Path
    json_path: str
    raw_value: str
    resolved_path: Optional[Path]


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as fh:
        while True:
            chunk = fh.read(8192)
            if not chunk:
                break
            hasher.update(chunk)
    return hasher.hexdigest()


def iter_image_strings(value: Any, path: str = "$") -> Iterable[Tuple[str, str]]:
    if isinstance(value, dict):
        for key, item in value.items():
            next_path = f"{path}.{key}"
            yield from iter_image_strings(item, next_path)
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            next_path = f"{path}[{index}]"
            yield from iter_image_strings(item, next_path)
        return
    if not isinstance(value, str):
        return

    normalized = value.strip()
    lower = normalized.lower()
    if any(lower.endswith(ext) for ext in IMAGE_EXTENSIONS):
        yield path, normalized


def resolve_image_path(data_dir: Path, task_dir: Path, raw_value: str) -> Optional[Path]:
    if not raw_value:
        return None

    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate if candidate.exists() else None

    if raw_value.startswith("modules/"):
        resolved = data_dir / raw_value
        return resolved if resolved.exists() else None

    task_relative = task_dir / raw_value
    if task_relative.exists():
        return task_relative

    data_relative = data_dir / raw_value
    if data_relative.exists():
        return data_relative

    return None


def relative_to(path: Path, root: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def build_report(project_root: Path, output_dir: Path) -> Dict[str, Any]:
    data_dir = project_root / "data"
    modules_dir = data_dir / "modules"
    task_json_paths = sorted(modules_dir.rglob("task.json"))

    references: List[ImageReference] = []
    references_by_image: Dict[Path, List[ImageReference]] = defaultdict(list)
    unresolved_references: List[ImageReference] = []

    for task_json in task_json_paths:
        task_dir = task_json.parent
        try:
            payload = json.loads(task_json.read_text(encoding="utf-8"))
        except Exception as exc:
            unresolved_references.append(
                ImageReference(task_json=task_json, json_path="$", raw_value=f"<json load failed: {exc}>", resolved_path=None)
            )
            continue

        for json_path, raw_value in iter_image_strings(payload):
            resolved = resolve_image_path(data_dir, task_dir, raw_value)
            ref = ImageReference(task_json=task_json, json_path=json_path, raw_value=raw_value, resolved_path=resolved)
            references.append(ref)
            if resolved is None:
                unresolved_references.append(ref)
            else:
                references_by_image[resolved].append(ref)

    task_image_files = sorted(
        path
        for path in modules_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS and "tasks" in path.parts and "images" in path.parts
    )

    hashes_by_image: Dict[Path, str] = {}
    by_hash: Dict[str, List[Path]] = defaultdict(list)
    for image_path in task_image_files:
        digest = sha256_file(image_path)
        hashes_by_image[image_path] = digest
        by_hash[digest].append(image_path)

    orphan_entries: List[Dict[str, Any]] = []
    for image_path in task_image_files:
        if image_path in references_by_image:
            continue
        digest = hashes_by_image[image_path]
        duplicate_candidates = [candidate for candidate in by_hash[digest] if candidate != image_path]
        referenced_duplicates = [candidate for candidate in duplicate_candidates if candidate in references_by_image]
        orphan_entries.append(
            {
                "image": relative_to(image_path, project_root),
                "size_bytes": image_path.stat().st_size,
                "sha256": digest,
                "same_content_as": [relative_to(candidate, project_root) for candidate in duplicate_candidates],
                "same_content_as_referenced": [relative_to(candidate, project_root) for candidate in referenced_duplicates],
            }
        )

    duplicate_groups: List[Dict[str, Any]] = []
    for digest, paths in sorted(by_hash.items(), key=lambda item: len(item[1]), reverse=True):
        if len(paths) < 2:
            continue
        duplicate_groups.append(
            {
                "sha256": digest,
                "files": [relative_to(path, project_root) for path in sorted(paths)],
                "referenced_files": [
                    relative_to(path, project_root) for path in sorted(paths) if path in references_by_image
                ],
                "orphan_files": [
                    relative_to(path, project_root) for path in sorted(paths) if path not in references_by_image
                ],
            }
        )

    reference_rows: List[Dict[str, Any]] = []
    for image_path, refs in sorted(references_by_image.items(), key=lambda item: relative_to(item[0], project_root)):
        reference_rows.append(
            {
                "image": relative_to(image_path, project_root),
                "ref_count": len(refs),
                "task_jsons": sorted({relative_to(ref.task_json, project_root) for ref in refs}),
                "json_paths": sorted({ref.json_path for ref in refs}),
                "sha256": hashes_by_image.get(image_path),
            }
        )

    report = {
        "project_root": str(project_root),
        "data_dir": str(data_dir),
        "summary": {
            "task_json_count": len(task_json_paths),
            "referenced_image_count": len(references_by_image),
            "task_image_file_count": len(task_image_files),
            "orphan_image_count": len(orphan_entries),
            "duplicate_hash_group_count": len(duplicate_groups),
            "unresolved_reference_count": len(unresolved_references),
        },
        "referenced_images": reference_rows,
        "orphan_images": orphan_entries,
        "duplicate_groups": duplicate_groups,
        "unresolved_references": [
            {
                "task_json": relative_to(ref.task_json, project_root),
                "json_path": ref.json_path,
                "raw_value": ref.raw_value,
            }
            for ref in unresolved_references
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "task_image_audit.json"
    md_path = output_dir / "task_image_audit.md"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(render_markdown(report), encoding="utf-8")

    report["json_report"] = str(json_path)
    report["markdown_report"] = str(md_path)
    return report


def render_markdown(report: Dict[str, Any]) -> str:
    summary = report["summary"]
    lines: List[str] = [
        "# Аудит изображений задач",
        "",
        "## Сводка",
        "",
        f"- `task.json`: {summary['task_json_count']}",
        f"- файлов изображений в папках задач: {summary['task_image_file_count']}",
        f"- уникально используемых изображений: {summary['referenced_image_count']}",
        f"- сиротских изображений: {summary['orphan_image_count']}",
        f"- групп дублей по хэшу: {summary['duplicate_hash_group_count']}",
        f"- неразрешённых ссылок: {summary['unresolved_reference_count']}",
        "",
    ]

    orphan_images = report["orphan_images"]
    lines.extend(["## Сиротские изображения", ""])
    if not orphan_images:
        lines.append("Сиротских изображений не найдено.")
    else:
        for entry in orphan_images:
            lines.append(f"- `{entry['image']}`")
            lines.append(f"  размер: `{entry['size_bytes']}` байт")
            lines.append(f"  sha256: `{entry['sha256']}`")
            if entry["same_content_as_referenced"]:
                lines.append(
                    f"  совпадает по содержимому с используемыми файлами: {', '.join(f'`{item}`' for item in entry['same_content_as_referenced'])}"
                )
            elif entry["same_content_as"]:
                lines.append(
                    f"  совпадает по содержимому с: {', '.join(f'`{item}`' for item in entry['same_content_as'])}"
                )
            else:
                lines.append("  совпадений по содержимому не найдено")
    lines.append("")

    duplicate_groups = report["duplicate_groups"]
    lines.extend(["## Дубли по содержимому", ""])
    if not duplicate_groups:
        lines.append("Групп дублей не найдено.")
    else:
        for group in duplicate_groups:
            lines.append(f"- sha256 `{group['sha256']}`")
            lines.append(f"  файлы: {', '.join(f'`{item}`' for item in group['files'])}")
            lines.append(f"  используются: {', '.join(f'`{item}`' for item in group['referenced_files']) or 'нет'}")
            lines.append(f"  сироты: {', '.join(f'`{item}`' for item in group['orphan_files']) or 'нет'}")
    lines.append("")

    unresolved = report["unresolved_references"]
    lines.extend(["## Неразрешённые ссылки", ""])
    if not unresolved:
        lines.append("Неразрешённых ссылок не найдено.")
    else:
        for entry in unresolved:
            lines.append(
                f"- `{entry['task_json']}` -> `{entry['json_path']}` = `{entry['raw_value']}`"
            )
    lines.append("")

    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit task image references without deleting files.")
    parser.add_argument(
        "--project-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Project root path.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "reports" / "task_image_audit",
        help="Directory for markdown/json reports.",
    )
    args = parser.parse_args()

    report = build_report(args.project_root.resolve(), args.output_dir.resolve())
    print(json.dumps(report["summary"], ensure_ascii=False, indent=2))
    print(report["markdown_report"])


if __name__ == "__main__":
    main()
