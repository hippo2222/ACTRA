#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP_ROOT = PROJECT_ROOT / "desktop-app"
if str(DESKTOP_APP_ROOT) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_ROOT))

from services.stage7_legacy_inventory_service import (  # noqa: E402
    KEEP_BUCKET,
    REVIEW_BUCKET,
    SAFE_BUCKET,
    Stage7LegacyInventoryService,
)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Dry-run inventory for Stage 7 legacy imported copies.",
    )
    parser.add_argument(
        "--data-root",
        default=str(PROJECT_ROOT / "data"),
        help="Path to the workspace data root. Defaults to ./data",
    )
    parser.add_argument(
        "--json-out",
        default="",
        help="Optional path to write the full JSON report.",
    )
    return parser.parse_args()


def _print_summary(report: dict) -> None:
    summary = report.get("summary") or {}
    totals = summary.get("totals_by_entity_kind") or {}
    buckets = summary.get("classification_totals") or {}
    print("Stage 7 legacy inventory")
    print(f"data_root: {report.get('data_root')}")
    print(f"legacy_records: {summary.get('legacy_record_count', 0)}")
    print("totals_by_entity_kind:")
    for entity_kind in ("complex", "theory", "module", "topic", "task"):
        print(f"  {entity_kind}: {totals.get(entity_kind, 0)}")
    print("classification_totals:")
    print(f"  {SAFE_BUCKET}: {buckets.get(SAFE_BUCKET, 0)}")
    print(f"  {KEEP_BUCKET}: {buckets.get(KEEP_BUCKET, 0)}")
    print(f"  {REVIEW_BUCKET}: {buckets.get(REVIEW_BUCKET, 0)}")


def main() -> int:
    args = _parse_args()
    service = Stage7LegacyInventoryService(args.data_root)
    report = service.build_report()
    _print_summary(report)

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
