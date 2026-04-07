from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = REPO_ROOT / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.theory_service import TheoryService  # type: ignore  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize saved theories by removing broken image references."
    )
    parser.add_argument(
        "--data-dir",
        default=str(REPO_ROOT / "data"),
        help="Path to the app data directory. Defaults to ./data.",
    )
    parser.add_argument(
        "--theory-id",
        action="append",
        dest="theory_ids",
        default=[],
        help="Normalize only the specified theory id. Can be repeated.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write fixes to disk. Without this flag the script runs in dry-run mode.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full report as JSON.",
    )
    return parser.parse_args()


def print_human_report(report: dict) -> None:
    mode = "apply" if not report.get("dry_run") else "dry-run"
    print(f"[Theory image normalization] mode: {mode}")
    print(
        "Scanned: {scanned}, changed: {changed}, removed broken image ops: {ops}, "
        "removed broken refs: {refs}, removed stale meta images: {meta}".format(
            scanned=report.get("theories_scanned", 0),
            changed=report.get("theories_changed", 0),
            ops=report.get("removed_delta_image_ops_total", 0),
            refs=report.get("removed_delta_image_refs_total", 0),
            meta=report.get("removed_meta_images_total", 0),
        )
    )

    changed_items = [item for item in report.get("items", []) if item.get("changed")]
    for item in changed_items:
        refs = ", ".join(item.get("removed_delta_image_refs") or []) or "-"
        stale_meta = ", ".join(item.get("removed_meta_images") or []) or "-"
        print(
            " - {theory_id}: removed ops={ops}; broken delta refs=[{refs}]; stale meta=[{meta}]".format(
                theory_id=item.get("theory_id", "?"),
                ops=item.get("removed_delta_image_ops", 0),
                refs=refs,
                meta=stale_meta,
            )
        )

    for error in report.get("errors", []):
        print(
            " ! {theory_id}: {error}".format(
                theory_id=error.get("theory_id", "?"),
                error=error.get("error", "unknown_error"),
            )
        )


def main() -> int:
    args = parse_args()
    service = TheoryService(data_dir=str(Path(args.data_dir).resolve()))
    report = service.normalize_theories_image_refs(
        theory_ids=args.theory_ids or None,
        dry_run=not args.apply,
    )

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_human_report(report)

    return 0 if report.get("ok", False) else 1


if __name__ == "__main__":
    raise SystemExit(main())
