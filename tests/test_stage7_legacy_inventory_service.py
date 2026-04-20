from __future__ import annotations

import json
from pathlib import Path

from services.stage7_legacy_inventory_service import (
    KEEP_BUCKET,
    REVIEW_BUCKET,
    SAFE_BUCKET,
    Stage7LegacyInventoryService,
)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def test_stage7_inventory_builds_expected_buckets(tmp_path: Path) -> None:
    data_root = tmp_path / "data"

    _write_json(
        data_root / "complexes" / "complexes.json",
        [
            {
                "id": "cx_safe",
                "name": "Safe imported complex",
                "description": "",
                "tasks": ["mod_safe/topic_safe/task_safe"],
                "chains": [],
                "settings": {},
                "created_at": "2026-04-01T10:00:00+00:00",
                "updated_at": "2026-04-01T10:00:00+00:00",
                "created_via": "workspace_import",
                "content_scope": "workspace_private",
                "source_catalog_item_id": "catalog_complex_safe",
                "source_catalog_version_id": "v1",
                "source_entity_kind": "complex",
                "source_entity_id": "src_complex_safe",
            },
            {
                "id": "cx_edited",
                "name": "Edited imported complex",
                "description": "",
                "tasks": ["mod_edited/topic_edited/task_edited"],
                "chains": [],
                "settings": {},
                "created_at": "2026-04-01T10:00:00+00:00",
                "updated_at": "2026-04-02T10:00:00+00:00",
                "created_via": "workspace_import",
                "content_scope": "workspace_private",
                "source_catalog_item_id": "catalog_complex_edited",
                "source_catalog_version_id": "v2",
                "source_entity_kind": "complex",
                "source_entity_id": "src_complex_edited",
            },
            {
                "id": "cx_review",
                "name": "Review imported complex",
                "description": "",
                "tasks": ["mod_safe/topic_safe/task_safe"],
                "chains": [],
                "settings": {},
                "created_at": "2026-04-01T10:00:00+00:00",
                "updated_at": "2026-04-01T10:00:00+00:00",
                "created_via": "workspace_import",
                "content_scope": "workspace_private",
            },
        ],
    )

    _write_json(
        data_root / "complexes" / "history" / "cx_edited" / "20260402_100000.json",
        {"id": "cx_edited"},
    )
    _write_json(
        data_root / "complexes" / "history" / "cx_edited" / "20260403_100000.json",
        {"id": "cx_edited"},
    )

    _write_json(
        data_root / "complexes" / "theories" / "th_safe" / "theory.json",
        {
            "id": "th_safe",
            "title": "Safe imported theory",
            "created_at": "2026-04-01T10:00:00+00:00",
            "updated_at": "2026-04-01T10:00:00+00:00",
            "version": "v1",
            "delta_path": "body.delta.json",
            "images": [],
            "created_via": "workspace_import",
            "content_scope": "workspace_private",
            "source_catalog_item_id": "catalog_theory_safe",
            "source_catalog_version_id": "v1",
            "source_entity_kind": "theory",
            "source_entity_id": "src_theory_safe",
        },
    )
    _write_json(
        data_root / "complexes" / "theories" / "th_safe" / "body.delta.json",
        {"ops": [{"insert": "Safe theory\n"}]},
    )

    _write_json(
        data_root / "complexes" / "theories" / "th_edited" / "theory.json",
        {
            "id": "th_edited",
            "title": "Edited imported theory",
            "created_at": "2026-04-01T10:00:00+00:00",
            "updated_at": "2026-04-03T10:00:00+00:00",
            "version": "v2",
            "delta_path": "body.delta.json",
            "images": [],
            "created_via": "workspace_import",
            "content_scope": "workspace_private",
            "source_catalog_item_id": "catalog_theory_edited",
            "source_catalog_version_id": "v2",
            "source_entity_kind": "theory",
            "source_entity_id": "src_theory_edited",
        },
    )
    _write_json(
        data_root / "complexes" / "theories" / "th_edited" / "body.delta.json",
        {"ops": [{"insert": "Edited theory\n"}]},
    )
    _write_json(
        data_root / "complexes" / "theories" / "th_edited" / "history" / "20260401_100000.json",
        {"id": "th_edited"},
    )
    _write_json(
        data_root / "complexes" / "theories" / "th_edited" / "history" / "20260402_100000.json",
        {"id": "th_edited"},
    )

    _write_json(
        data_root / "modules" / "mod_safe" / "module.json",
        {
            "id": "mod_safe",
            "name": "Safe imported module",
            "created_via": "workspace_import",
            "content_scope": "workspace_private",
            "source_catalog_item_id": "catalog_complex_safe",
            "source_catalog_version_id": "v1",
            "source_entity_kind": "module",
            "source_entity_id": "mod_safe",
            "topics": [
                {
                    "id": "topic_safe",
                    "name": "Safe imported topic",
                    "created_via": "workspace_import",
                    "content_scope": "workspace_private",
                    "source_catalog_item_id": "catalog_complex_safe",
                    "source_catalog_version_id": "v1",
                    "source_entity_kind": "topic",
                    "source_entity_id": "mod_safe/topic_safe",
                    "tasks": [
                        {
                            "id": "task_safe",
                            "type": "test",
                            "path": "modules/mod_safe/topics/topic_safe/tasks/task_safe/task.json",
                        }
                    ],
                }
            ],
        },
    )
    _write_json(
        data_root / "modules" / "mod_safe" / "topics" / "topic_safe" / "tasks" / "task_safe" / "task.json",
        {
            "id": "task_safe",
            "type": "test",
            "meta": {
                "id": "task_safe",
                "name": "Safe task",
                "created_at": "2026-04-01T10:00:00+00:00",
                "created": "2026-04-01T10:00:00+00:00",
                "modified": "2026-04-01T10:00:00+00:00",
                "created_via": "workspace_import",
                "content_scope": "workspace_private",
                "source_catalog_item_id": "catalog_complex_safe",
                "source_catalog_version_id": "v1",
                "source_entity_kind": "task",
                "source_entity_id": "mod_safe/topic_safe/task_safe",
            },
            "content": {
                "test_type": "single_choice",
                "questions": [
                    {
                        "text": "Safe question",
                        "options": [
                            {"id": "a", "text": "A", "is_correct": True},
                            {"id": "b", "text": "B", "is_correct": False},
                        ],
                    }
                ],
            },
        },
    )

    _write_json(
        data_root / "modules" / "mod_edited" / "module.json",
        {
            "id": "mod_edited",
            "name": "Edited imported module",
            "created_via": "workspace_import",
            "content_scope": "workspace_private",
            "source_catalog_item_id": "catalog_complex_edited",
            "source_catalog_version_id": "v2",
            "source_entity_kind": "module",
            "source_entity_id": "mod_edited",
            "topics": [
                {
                    "id": "topic_edited",
                    "name": "Edited imported topic",
                    "created_via": "workspace_import",
                    "content_scope": "workspace_private",
                    "source_catalog_item_id": "catalog_complex_edited",
                    "source_catalog_version_id": "v2",
                    "source_entity_kind": "topic",
                    "source_entity_id": "mod_edited/topic_edited",
                    "tasks": [
                        {
                            "id": "task_edited",
                            "type": "test",
                            "path": "modules/mod_edited/topics/topic_edited/tasks/task_edited/task.json",
                        }
                    ],
                }
            ],
        },
    )
    _write_json(
        data_root / "modules" / "mod_edited" / "topics" / "topic_edited" / "tasks" / "task_edited" / "task.json",
        {
            "id": "task_edited",
            "type": "test",
            "meta": {
                "id": "task_edited",
                "name": "Edited task",
                "created_at": "2026-04-01T10:00:00+00:00",
                "created": "2026-04-01T10:00:00+00:00",
                "modified": "2026-04-02T10:00:00+00:00",
                "created_via": "workspace_import",
                "content_scope": "workspace_private",
                "source_catalog_item_id": "catalog_complex_edited",
                "source_catalog_version_id": "v2",
                "source_entity_kind": "task",
                "source_entity_id": "mod_edited/topic_edited/task_edited",
            },
            "content": {
                "test_type": "single_choice",
                "questions": [
                    {
                        "text": "Edited question",
                        "options": [
                            {"id": "a", "text": "A", "is_correct": False},
                            {"id": "b", "text": "B", "is_correct": True},
                        ],
                    }
                ],
            },
        },
    )

    service = Stage7LegacyInventoryService(data_root)
    report = service.build_report()

    summary = report["summary"]
    assert summary["classification_totals"][SAFE_BUCKET] >= 4
    assert summary["classification_totals"][KEEP_BUCKET] >= 4
    assert summary["classification_totals"][REVIEW_BUCKET] >= 1

    records = {record["entity_ref"]: record for record in report["records"]}
    assert records["cx_safe"]["classification"] == SAFE_BUCKET
    assert records["cx_edited"]["classification"] == KEEP_BUCKET
    assert records["cx_review"]["classification"] == REVIEW_BUCKET
    assert records["th_safe"]["classification"] == SAFE_BUCKET
    assert records["th_edited"]["classification"] == KEEP_BUCKET
    assert records["mod_safe"]["classification"] == SAFE_BUCKET
    assert records["mod_safe/topic_safe"]["classification"] == SAFE_BUCKET
    assert records["mod_safe/topic_safe/task_safe"]["classification"] == SAFE_BUCKET
    assert records["mod_edited"]["classification"] == KEEP_BUCKET
    assert records["mod_edited/topic_edited"]["classification"] == KEEP_BUCKET
    assert records["mod_edited/topic_edited/task_edited"]["classification"] == KEEP_BUCKET
