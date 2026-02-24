"""Batch benchmark for AI analyze/generate pipeline on local materials.

Runs upload -> analyze -> generate (no import) through Flask test_client and
saves artifacts/metrics into reports/ai_generalization_benchmark.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, List


def _utc_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


def _load_server(project_root: Path):
    sys.path.insert(0, str(project_root / "desktop-app"))
    import server  # type: ignore

    return server


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def run_benchmark(project_root: Path, files: List[Path], append_summary: bool = False) -> Path:
    server = _load_server(project_root)
    client = server.app.test_client()

    base_reports = project_root / "reports" / "ai_generalization_benchmark"
    base_reports.mkdir(parents=True, exist_ok=True)

    summary_rows: List[Dict[str, Any]] = []

    for file_path in files:
        run_dir = base_reports / f"{file_path.stem}_{_utc_stamp()}"
        run_dir.mkdir(parents=True, exist_ok=True)

        row: Dict[str, Any] = {
            "file": file_path.name,
            "path": str(file_path),
            "ok": False,
        }

        # Upload
        with open(file_path, "rb") as f:
            upload_resp = client.post(
                "/api/editor/ai/upload",
                data={"file": (io.BytesIO(f.read()), file_path.name)},
                content_type="multipart/form-data",
            )
        upload = upload_resp.get_json() or {}
        _write_json(run_dir / "upload.json", upload)
        if not upload.get("ok"):
            row.update(
                {
                    "stage": "upload",
                    "error": upload.get("error") or upload.get("message"),
                }
            )
            summary_rows.append(row)
            continue

        file_info = upload.get("file_info") or {}
        material = upload.get("extracted_text", "")
        row["word_count"] = file_info.get("word_count")
        row["format"] = file_info.get("format")

        # Analyze
        requested_run_id = f"bench_{file_path.stem}_{_utc_stamp()}"
        analyze_resp = client.post(
            "/api/editor/ai/analyze",
            json={
                "material": material,
                "ai_run_id": requested_run_id,
                "source_file_info": file_info,
            },
        )
        analysis = analyze_resp.get_json() or {}
        _write_json(run_dir / "analysis_response.json", analysis)
        if not analysis.get("ok"):
            row.update(
                {
                    "stage": "analyze",
                    "error": analysis.get("error") or analysis.get("message"),
                }
            )
            summary_rows.append(row)
            continue

        units = analysis.get("educational_units") or []
        recs = analysis.get("recommendations") or []
        unit_by_id = {
            u.get("id"): u
            for u in units
            if isinstance(u, dict) and u.get("id") is not None
        }
        tasks_to_generate = []
        for rec in recs:
            if not isinstance(rec, dict):
                continue
            task_type = rec.get("task_type")
            count = int(rec.get("count") or 0)
            if not task_type or count <= 0:
                continue
            covers = rec.get("covers_units") or []
            task_units = [unit_by_id[uid] for uid in covers if uid in unit_by_id]
            tasks_to_generate.append(
                {
                    "task_type": task_type,
                    "count": count,
                    "educational_units": task_units,
                }
            )
        _write_json(run_dir / "generation_request.json", {"tasks_to_generate": tasks_to_generate})

        # Generate
        generate_resp = client.post(
            "/api/editor/ai/generate",
            json={
                "material": material,
                "ai_run_id": analysis.get("ai_run_id"),
                "tasks_to_generate": tasks_to_generate,
            },
        )
        generation = generate_resp.get_json() or {}
        _write_json(run_dir / "generation_response.json", generation)

        row.update(
            {
                "ok": bool(generation.get("ok")),
                "stage": "generate" if not generation.get("ok") else "done",
                "target_language": analysis.get("target_language"),
                "units_count": len(units),
                "recommendation_types": len(recs),
                "recommended_total": sum(
                    int(r.get("count") or 0) for r in recs if isinstance(r, dict)
                ),
                "recommended_by_type": {
                    r.get("task_type"): r.get("count")
                    for r in recs
                    if isinstance(r, dict)
                },
                "illustrations_detected": analysis.get("illustrations_detected"),
                "analysis_warnings_count": len(analysis.get("warnings") or []),
                "not_recommended_count": len(analysis.get("not_recommended") or []),
            }
        )

        if generation.get("ok"):
            summary = generation.get("summary") or {}
            quality = summary.get("quality") or {}
            row.update(
                {
                    "generated_total": summary.get("total_generated"),
                    "generated_valid": summary.get("total_valid"),
                    "generated_warnings": summary.get("total_warnings"),
                    "generated_errors": summary.get("total_errors"),
                    "generated_by_type": summary.get("by_type"),
                    "quality": quality,
                    "subrequest_count_by_type": {
                        r.get("task_type"): r.get("subrequest_count")
                        for r in (generation.get("results") or [])
                        if isinstance(r, dict)
                    },
                }
            )
        else:
            row["error"] = generation.get("error") or generation.get("message")

        summary_rows.append(row)

    summary_payload = {
        "created_at": datetime.now(UTC).isoformat(),
        "materials": summary_rows,
    }
    summary_path = base_reports / "benchmark_summary.json"
    _write_json(summary_path, summary_payload)

    timestamped_summary_path = base_reports / f"benchmark_summary_{_utc_stamp()}.json"
    _write_json(timestamped_summary_path, summary_payload)

    if append_summary:
        history_path = base_reports / "benchmark_summary_history.jsonl"
        history_path.parent.mkdir(parents=True, exist_ok=True)
        with history_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(summary_payload, ensure_ascii=False) + "\n")

    return summary_path


def main() -> int:
    parser = argparse.ArgumentParser(description="AI benchmark runner (upload/analyze/generate, no import)")
    parser.add_argument(
        "files",
        nargs="+",
        help="Paths to materials (PDF/DOCX/TXT) relative to project root or absolute paths",
    )
    parser.add_argument(
        "--project-root",
        default=".",
        help="Project root path (default: current directory)",
    )
    parser.add_argument(
        "--append-summary",
        action="store_true",
        help="Append the run summary to reports/ai_generalization_benchmark/benchmark_summary_history.jsonl",
    )
    args = parser.parse_args()

    project_root = Path(args.project_root).resolve()
    files = []
    for raw in args.files:
        p = Path(raw)
        if not p.is_absolute():
            p = (project_root / p).resolve()
        files.append(p)

    missing = [str(p) for p in files if not p.exists()]
    if missing:
        print("Missing files:", *missing, sep="\n- ")
        return 1

    summary_path = run_benchmark(project_root, files, append_summary=args.append_summary)
    print(f"Saved benchmark summary: {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
