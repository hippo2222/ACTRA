import sys
import os
import logging
from pathlib import Path
from unittest.mock import MagicMock

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.hosted_storage_service import HostedStorageService


class FakeTaskContentRepo:
    def __init__(self):
        self.upserted = []

    def upsert_task_content(self, module_id, topic_id, task_id, task_data, answer_key, updated_at):
        self.upserted.append({
            "module_id": module_id,
            "topic_id": topic_id,
            "task_id": task_id,
            "task_data": task_data,
            "answer_key": answer_key,
            "updated_at": updated_at,
        })


def test_hosted_storage_self_heals_stale_answer_key_on_read(tmp_path):
    svc = HostedStorageService.__new__(HostedStorageService)
    svc.logger = logging.getLogger("test")
    svc.modules_dir = tmp_path / "modules"
    fake_repo = FakeTaskContentRepo()
    svc.content_repository = fake_repo

    # Simulate Hippopotamus scenario: DB row has 1 annotation in task_data, but 18 targets in answer_key
    stale_targets = [
        {"shape": "polygon", "points": [[0, 0], [10, 0], [10, 10]], "label": "Artery"}
    ] + [
        {"shape": "polygon", "points": [[i, i], [i + 5, i], [i + 5, i + 5]], "label": f"Deleted_{i}"}
        for i in range(1, 18)
    ]
    content_row = {
        "task_data": {
            "id": "heart_anatomy_pt",
            "type": "click",
            "name": "Heart Anatomy (PT)",
            "content": {
                "annotations": [
                    {"type": "polygon", "points": [[0, 0], [10, 0], [10, 10]], "label": "Artery"}
                ]
            },
        },
        "answer_key": {
            "targets": stale_targets
        },
        "updated_at": "2026-10-08T22:00:00Z",
    }

    payload = svc._build_task_payload_from_repository(
        "vsyakoe",
        "a1",
        "heart_anatomy_pt",
        content_row,
        metadata={"id": "heart_anatomy_pt", "name": "Heart Anatomy (PT)"},
    )

    # Returned payload must have exactly 1 target
    assert len(payload["answer_key"]["targets"]) == 1
    assert payload["answer_key"]["targets"][0]["label"] == "Artery"

    # Repository must have received the healed answer_key
    assert len(fake_repo.upserted) == 1
    assert fake_repo.upserted[0]["task_id"] == "heart_anatomy_pt"
    assert len(fake_repo.upserted[0]["answer_key"]["targets"]) == 1
    assert fake_repo.upserted[0]["answer_key"]["targets"][0]["label"] == "Artery"
