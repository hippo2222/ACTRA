import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.catalog_service import CatalogService
from services.theory_service import TheoryService


@pytest.fixture()
def services(tmp_path):
    theory_service = TheoryService(data_dir=str(tmp_path))
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=MagicMock(),
        theory_service=theory_service,
        storage_service=MagicMock(),
    )
    return theory_service, catalog_service


def _create_theory(theory_service, *, title="Linked theory", user_id="author"):
    return theory_service.create_theory(
        {
            "title": title,
            "delta": {"ops": [{"insert": "Hello linked world\n"}]},
            "created_by_user_id": user_id,
            "updated_by_user_id": user_id,
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )


def test_add_item_to_library_is_idempotent_and_tracks_latest_version(services):
    theory_service, catalog_service = services
    theory = _create_theory(theory_service)
    first_publish = catalog_service.publish_theory(
        theory["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    first_add = catalog_service.add_item_to_library(
        first_publish["item"]["item_id"],
        requested_by_user_id="reader",
    )
    second_add = catalog_service.add_item_to_library(
        first_publish["item"]["item_id"],
        requested_by_user_id="reader",
    )

    assert first_add["created"] is True
    assert second_add["reused"] is True
    assert first_add["library_entry"]["library_entry_id"] == second_add["library_entry"]["library_entry_id"]

    theory_service.update_theory(
        theory["id"],
        {
            "title": "Linked theory v2",
            "delta": {"ops": [{"insert": "Updated content\n"}]},
            "updated_by_user_id": "author",
        },
    )
    second_publish = catalog_service.publish_theory(
        theory["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    detail = catalog_service.get_theory_library_entry(
        first_add["library_entry"]["library_entry_id"],
        requested_by_user_id="reader",
    )

    assert detail["library_entry"]["resolved_version_id"] == second_publish["version"]["version_id"]
    assert detail["snapshot"]["title"] == "Linked theory v2"


def test_linked_entry_reflects_revoked_and_access_code_states(services):
    theory_service, catalog_service = services
    theory = _create_theory(theory_service)
    publish_result = catalog_service.publish_theory(
        theory["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    entry_id = add_result["library_entry"]["library_entry_id"]

    catalog_service.set_item_visibility(
        publish_result["item"]["item_id"],
        catalog_visibility="private",
        requested_by_user_id="author",
    )
    revoked_detail = catalog_service.get_theory_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )
    assert revoked_detail["library_entry"]["access_state"] == "revoked"
    assert revoked_detail["snapshot"] is None

    access_code_update = catalog_service.set_item_visibility(
        publish_result["item"]["item_id"],
        catalog_visibility="access_code",
        requested_by_user_id="author",
    )
    requires_code = catalog_service.get_theory_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )
    assert requires_code["library_entry"]["access_state"] == "requires_access_code"

    unlocked = catalog_service.submit_theory_library_access_code(
        entry_id,
        requested_by_user_id="reader",
        access_code=access_code_update["item"]["access_code"],
    )
    assert unlocked["library_entry"]["access_state"] == "active"
    assert unlocked["snapshot"]["id"] == theory["id"]


def test_remove_theory_linked_entry_deletes_only_reader_binding(services):
    theory_service, catalog_service = services
    theory = _create_theory(theory_service)
    publish_result = catalog_service.publish_theory(
        theory["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    entry_id = add_result["library_entry"]["library_entry_id"]

    removed = catalog_service.remove_theory_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )

    assert removed["ok"] is True
    assert removed["removed"] is True
    assert removed["library_entry_id"] == entry_id
    assert catalog_service.list_theory_library_entries(requested_by_user_id="reader")["count"] == 0
    with pytest.raises(ValueError, match="theory_library_entry_not_found"):
        catalog_service.get_theory_library_entry(entry_id, requested_by_user_id="reader")
