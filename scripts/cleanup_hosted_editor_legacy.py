#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP_ROOT = PROJECT_ROOT / "desktop-app"
if str(DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_ROOT))

from persistence.hosted_task_content_repository import HostedTaskContentRepository  # noqa: E402
from persistence.hosted_workspace_catalog_repository import HostedWorkspaceCatalogRepository  # noqa: E402
from services.hosted_editor_cleanup_service import HostedEditorCleanupService  # noqa: E402
from services.storage_service import StorageService  # noqa: E402


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dry-run or apply cleanup for ownerless/legacy hosted editor data.",
    )
    parser.add_argument(
        "--postgres-dsn",
        default=str(os.environ.get("ACTRA_POSTGRES_DSN") or "").strip(),
        help="Hosted Postgres DSN. Defaults to ACTRA_POSTGRES_DSN.",
    )
    parser.add_argument(
        "--data-root",
        default=str(PROJECT_ROOT / "data"),
        help="Shadow workspace data root for optional filesystem cleanup. Defaults to ./data",
    )
    parser.add_argument(
        "--skip-postgres",
        action="store_true",
        help="Skip hosted Postgres cleanup planning/apply.",
    )
    parser.add_argument(
        "--skip-shadow",
        action="store_true",
        help="Skip shadow filesystem cleanup planning/apply.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply cleanup. Without this flag the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--json-out",
        default="",
        help="Optional path to write the full JSON report.",
    )
    return parser.parse_args()


def _print_plan_summary(name: str, plan_report: Dict[str, Any]) -> None:
    summary = plan_report.get("summary") or {}
    print(f"[{name}]")
    print(f"  modules_to_delete: {summary.get('modules_to_delete', 0)}")
    print(f"  topics_to_delete: {summary.get('topics_to_delete', 0)}")
    print(f"  tasks_to_delete: {summary.get('tasks_to_delete', 0)}")
    print(f"  task_content_to_delete: {summary.get('task_content_to_delete', 0)}")
    print(f"  kept_orphan_task_content: {summary.get('kept_orphan_task_content', 0)}")
    print(f"  remaining_modules: {summary.get('remaining_modules', 0)}")
    print(f"  remaining_tasks: {summary.get('remaining_tasks', 0)}")

    for key in ("modules_to_delete", "topics_to_delete", "tasks_to_delete", "task_content_to_delete"):
        items = plan_report.get(key) or []
        if not items:
            continue
        print(f"  sample_{key}:")
        for item in items[:5]:
            reasons = ",".join(item.get("reasons") or [])
            print(f"    - {item.get('ref')} [{reasons}]")


def _build_postgres_report(dsn: str) -> Dict[str, Any]:
    clean_dsn = str(dsn or "").strip()
    if not clean_dsn:
        raise RuntimeError("postgres_dsn_required")

    repository = HostedWorkspaceCatalogRepository(clean_dsn)
    content_repository = HostedTaskContentRepository(clean_dsn)
    repository.ensure_schema()
    content_repository.ensure_schema()

    service = HostedEditorCleanupService(
        repository=repository,
        content_repository=content_repository,
    )
    plan = service.build_plan_from_repositories()
    return {
        "plan": plan,
        "report": plan.to_report(),
        "service": service,
    }


def _build_shadow_report(data_root: Path) -> Dict[str, Any]:
    storage_service = StorageService(str(data_root))
    planner = HostedEditorCleanupService()
    plan = planner.build_plan(modules=storage_service.load_modules())
    return {
        "plan": plan,
        "report": plan.to_report(),
        "storage_service": storage_service,
        "service": planner,
    }


def main() -> int:
    args = _parse_args()
    if args.skip_postgres and args.skip_shadow:
        raise SystemExit("Both backends are skipped. Remove one of --skip-postgres/--skip-shadow.")

    report: Dict[str, Any] = {
        "mode": "apply" if args.apply else "dry_run",
    }

    postgres_bundle: Optional[Dict[str, Any]] = None
    if not args.skip_postgres:
        postgres_bundle = _build_postgres_report(args.postgres_dsn)
        report["postgres"] = postgres_bundle["report"]
        _print_plan_summary("postgres", postgres_bundle["report"])

    shadow_bundle: Optional[Dict[str, Any]] = None
    data_root = Path(args.data_root).resolve()
    if not args.skip_shadow:
        shadow_bundle = _build_shadow_report(data_root)
        shadow_report = shadow_bundle["report"]
        shadow_report["data_root"] = str(data_root)
        report["shadow"] = shadow_report
        _print_plan_summary("shadow", shadow_report)

    if args.apply:
        apply_report: Dict[str, Any] = {}
        if postgres_bundle is not None:
            apply_report["postgres"] = postgres_bundle["service"].apply_hosted_plan(postgres_bundle["plan"])
        if shadow_bundle is not None:
            apply_report["shadow"] = HostedEditorCleanupService.apply_shadow_plan(
                shadow_bundle["storage_service"],
                shadow_bundle["plan"],
            )
        report["applied"] = apply_report
        print("apply_complete: true")
    else:
        print("apply_complete: false")

    json_out = str(args.json_out or "").strip()
    if json_out:
        output_path = Path(json_out)
        if not output_path.is_absolute():
            output_path = (PROJECT_ROOT / output_path).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"json_report: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
