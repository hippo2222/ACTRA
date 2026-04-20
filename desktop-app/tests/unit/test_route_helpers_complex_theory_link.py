import sys
from pathlib import Path
from types import SimpleNamespace


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes._helpers as route_helpers


def test_serialize_complex_payload_keeps_active_linked_library_theory(monkeypatch):
    fake_catalog_service = SimpleNamespace(
        get_theory_library_entry=lambda library_entry_id, requested_by_user_id: {
            "library_entry": {
                "library_entry_id": library_entry_id,
                "updated_at": "2026-04-14T18:20:00",
            },
            "item": {
                "item_id": "catalog_theory_1",
                "title": "Linked Theory",
                "source_workspace_id": "theory_src_1",
            },
            "snapshot": {
                "id": "theory_src_1",
                "title": "Linked Theory",
                "updated_at": "2026-04-14T18:20:00",
            },
        }
    )
    fake_ctx = SimpleNamespace(user_id="qa_user", catalog_service=fake_catalog_service)

    monkeypatch.setattr(route_helpers, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(route_helpers, "is_hosted_web_runtime", lambda: False)

    payload = route_helpers._serialize_complex_payload(
        {
            "id": "complex_1",
            "name": "QA complex",
            "tasks": [],
            "theory_link": {
                "source_kind": "linked_library",
                "library_entry_id": "thlib_1",
                "relation": "link",
                "title_cache": "Linked Theory",
            },
        },
        current_user_id="qa_user",
    )

    assert payload["has_theory"] is True
    assert payload["theory_link"]["library_entry_id"] == "thlib_1"
    assert payload["theory_link"]["access_state"] == "active"
    assert payload["theory_link"].get("missing") is not True
