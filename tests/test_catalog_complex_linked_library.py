import os
import sys
from copy import deepcopy
import json

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.catalog_service import CatalogService
from services.theory_service import TheoryService


class FakeComplex:
    def __init__(self, payload):
        self._payload = payload

    def dict(self):
        return deepcopy(self._payload)


class FakeComplexService:
    def __init__(self, payload):
        self.payload = payload

    def get_complex(self, complex_id):
        if str(self.payload.get("id")) != str(complex_id):
            return None
        return FakeComplex(self.payload)


class FakeStorageService:
    def __init__(self, theory_link=None):
        self.modules = {
            "module-a": {"id": "module-a", "name": "Module A"},
        }
        self.topics = {
            "module-a/topic-a": {"id": "topic-a", "module_id": "module-a", "name": "Topic A"},
        }
        self.tasks = {
            "module-a/topic-a/task-a": {
                "id": "task-a",
                "module_id": "module-a",
                "topic_id": "topic-a",
                "task_data": {
                    "type": "test",
                    "name": "Task A",
                    "prompt": "Read-only task body",
                },
            },
        }
        self.theory_link = deepcopy(theory_link) if isinstance(theory_link, dict) else None

    def get_module(self, module_id):
        return deepcopy(self.modules.get(module_id))

    def get_topic(self, module_id, topic_id):
        return deepcopy(self.topics.get(f"{module_id}/{topic_id}"))

    def load_task(self, module_id, topic_id, task_id):
        return deepcopy(self.tasks.get(f"{module_id}/{topic_id}/{task_id}"))

    def get_topic_theory_link(self, module_id, topic_id):
        return deepcopy(self.theory_link)


@pytest.fixture()
def services(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    complex_payload = {
        "id": "complex-a",
        "name": "Linked complex",
        "description": "Initial description",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": None,
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    theory_service = TheoryService(data_dir=str(tmp_path))
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(),
    )
    return complex_payload, catalog_service


@pytest.fixture()
def services_with_published_theory(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Linked theory",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload = {
        "id": "complex-a",
        "name": "Linked complex",
        "description": "Initial description",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_status": "ok",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )
    theory_publish = catalog_service.publish_theory(
        theory["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    return complex_payload, theory, theory_publish, catalog_service


def test_catalog_item_uses_owner_display_name_from_profile(services):
    complex_payload, catalog_service = services
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    assert publish_result["item"]["owner_user_id"] == "author"
    assert publish_result["item"]["owner_display_name"] == "Dr. Jane Author"


def test_catalog_item_repairs_mojibake_owner_display_name(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    expected_name = "Анастасия Автор"
    mojibake_name = expected_name.encode("utf-8").decode("cp1251")
    (author_dir / "profile.json").write_text(
        json.dumps(
            {
                "user_id": "author",
                "profile": {
                    "name": mojibake_name,
                },
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    complex_payload = {
        "id": "complex-a",
        "name": "Linked complex",
        "description": "Initial description",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": None,
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    theory_service = TheoryService(data_dir=str(tmp_path))
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(),
    )

    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    assert publish_result["item"]["owner_display_name"] == expected_name


def test_catalog_list_hides_non_public_items_even_for_author(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    complex_payload = {
        "id": "complex-a",
        "name": "Linked complex",
        "description": "Initial description",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": None,
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    theory_service = TheoryService(data_dir=str(tmp_path))
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(),
    )

    private_publish = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="private",
    )
    access_code_publish = catalog_service.set_item_visibility(
        private_publish["item"]["item_id"],
        catalog_visibility="access_code",
        requested_by_user_id="author",
    )

    author_items = catalog_service.list_items(
        owner_user_id="author",
        requested_by_user_id="author",
    )["items"]
    owner_index_items = catalog_service.list_items(
        owner_user_id="author",
        include_owned_non_public=True,
        requested_by_user_id="author",
    )["items"]

    assert access_code_publish["item"]["catalog_visibility"] == "access_code"
    assert author_items == []
    assert len(owner_index_items) == 1
    assert owner_index_items[0]["catalog_visibility"] == "access_code"


def test_add_complex_item_to_library_is_idempotent_and_tracks_latest_version(services):
    complex_payload, catalog_service = services
    first_publish = catalog_service.publish_complex(
        complex_payload["id"],
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

    complex_payload["name"] = "Linked complex v2"
    second_publish = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    detail = catalog_service.get_complex_library_entry(
        first_add["library_entry"]["library_entry_id"],
        requested_by_user_id="reader",
    )

    assert detail["library_entry"]["resolved_version_id"] == second_publish["version"]["version_id"]
    assert detail["snapshot"]["complex"]["name"] == "Linked complex v2"


def test_complex_linked_entry_reflects_revoked_and_access_code_states(services):
    complex_payload, catalog_service = services
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
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
    revoked_detail = catalog_service.get_complex_library_entry(
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
    requires_code = catalog_service.get_complex_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )
    assert requires_code["library_entry"]["access_state"] == "requires_access_code"

    unlocked = catalog_service.submit_complex_library_access_code(
        entry_id,
        requested_by_user_id="reader",
        access_code=access_code_update["item"]["access_code"],
    )
    assert unlocked["library_entry"]["access_state"] == "active"
    assert unlocked["snapshot"]["complex"]["id"] == complex_payload["id"]


def test_author_deleted_complex_turns_reader_linked_entry_into_deleted_source_ghost(services):
    complex_payload, catalog_service = services
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    entry_id = add_result["library_entry"]["library_entry_id"]

    deleted = catalog_service.handle_workspace_source_deleted(
        "complex",
        owner_user_id="author",
        source_workspace_id=complex_payload["id"],
        source_workspace_ref=complex_payload["id"],
        source_workspace_kind="complex",
        reason="author_deleted_workspace_complex",
    )
    detail = catalog_service.get_complex_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )

    assert deleted["affected_count"] == 1
    assert deleted["affected_library_entry_count"] == 1
    assert deleted["affected_library_entries"][0]["library_entry_id"] == entry_id
    assert deleted["affected_library_entries"][0]["access_state"] == "deleted_source"
    assert deleted["items"][0]["status"] == "deleted_source"
    assert catalog_service.list_items(content_type="complex")["items"] == []
    assert detail["library_entry"]["access_state"] == "deleted_source"
    assert detail["library_entry"]["resolved_version_id"] is None
    assert detail["item"]["status"] == "deleted_source"
    assert detail["snapshot"] is None
    with pytest.raises(ValueError, match="catalog_item_source_deleted"):
        catalog_service.add_item_to_library(
            publish_result["item"]["item_id"],
            requested_by_user_id="late_reader",
        )


def test_remove_complex_linked_entry_deletes_only_reader_binding(services):
    complex_payload, catalog_service = services
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )
    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    entry_id = add_result["library_entry"]["library_entry_id"]

    removed = catalog_service.remove_complex_library_entry(
        entry_id,
        requested_by_user_id="reader",
    )

    assert removed["ok"] is True
    assert removed["removed"] is True
    assert removed["library_entry_id"] == entry_id
    assert catalog_service.list_complex_library_entries(requested_by_user_id="reader")["count"] == 0
    with pytest.raises(ValueError, match="complex_library_entry_not_found"):
        catalog_service.get_complex_library_entry(entry_id, requested_by_user_id="reader")


def test_add_complex_item_to_library_adds_related_theory_to_linked_library(services_with_published_theory):
    complex_payload, theory, theory_publish, catalog_service = services_with_published_theory
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )

    related_theories = add_result["related_theory_library_entries"]
    assert len(related_theories) == 1
    assert related_theories[0]["item"]["item_id"] == theory_publish["item"]["item_id"]
    assert related_theories[0]["created"] is True

    theory_library = catalog_service.list_theory_library_entries(requested_by_user_id="reader")
    assert theory_library["count"] == 1
    assert theory_library["entries"][0]["item"]["item_id"] == theory_publish["item"]["item_id"]


def test_remove_complex_linked_entry_cascades_orphaned_auto_added_theory(services_with_published_theory):
    complex_payload, theory, theory_publish, catalog_service = services_with_published_theory
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    complex_entry_id = add_result["library_entry"]["library_entry_id"]
    theory_entry_id = add_result["related_theory_library_entries"][0]["library_entry"]["library_entry_id"]

    removed = catalog_service.remove_complex_library_entry(
        complex_entry_id,
        requested_by_user_id="reader",
    )

    assert removed["ok"] is True
    assert removed["removed"] is True
    assert removed["related_theory_entries_removed"] == [
        {
            "library_entry_id": theory_entry_id,
            "catalog_item_id": theory_publish["item"]["item_id"],
            "reason": "orphaned_auto_added_entry",
        }
    ]
    assert removed["related_theory_entries_retained"] == []
    assert catalog_service.list_theory_library_entries(requested_by_user_id="reader")["count"] == 0


def test_remove_complex_linked_entry_keeps_theory_if_user_added_it_explicitly(services_with_published_theory):
    complex_payload, theory, theory_publish, catalog_service = services_with_published_theory
    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
    )
    complex_entry_id = add_result["library_entry"]["library_entry_id"]
    theory_entry_id = add_result["related_theory_library_entries"][0]["library_entry"]["library_entry_id"]

    manual_add = catalog_service.add_item_to_library(
        theory_publish["item"]["item_id"],
        requested_by_user_id="reader",
    )
    assert manual_add["library_entry"]["library_entry_id"] == theory_entry_id

    removed = catalog_service.remove_complex_library_entry(
        complex_entry_id,
        requested_by_user_id="reader",
    )

    assert removed["related_theory_entries_removed"] == []
    assert removed["related_theory_entries_retained"] == [
        {
            "library_entry_id": theory_entry_id,
            "catalog_item_id": theory_publish["item"]["item_id"],
            "reason": "manually_added",
        }
    ]
    theory_library = catalog_service.list_theory_library_entries(requested_by_user_id="reader")
    assert theory_library["count"] == 1
    assert theory_library["entries"][0]["library_entry"]["library_entry_id"] == theory_entry_id


def test_linked_library_complex_embeds_attached_theory_snapshot_without_separate_theory_publication(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Attached theory",
            "delta": {"ops": [{"insert": "Embedded body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    complex_payload = {
        "id": "complex-linked-library-theory",
        "name": "Linked complex with embedded theory",
        "description": "Complex snapshot should carry the attached theory",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": {
            "source_kind": "linked_library",
            "library_entry_id": "theory_library::author_entry::deadbeef",
            "relation": "link",
            "title_cache": theory["title"],
            "updated_at": theory["updated_at"],
            "source_theory_id": theory["id"],
        },
        "theory_mode": "override",
        "theory_sync_status": "ok",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(),
    )

    publish_result = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="access_code",
    )
    assert publish_result["version"]["manifest"]["dependency_counts"]["theories"] == 1

    add_result = catalog_service.add_item_to_library(
        publish_result["item"]["item_id"],
        requested_by_user_id="reader",
        access_code=publish_result["item"]["access_code"],
    )
    detail = catalog_service.get_complex_library_entry(
        add_result["library_entry"]["library_entry_id"],
        requested_by_user_id="reader",
    )
    theories = ((detail.get("snapshot") or {}).get("dependencies") or {}).get("theories") or {}

    assert theory["id"] in theories
    assert theories[theory["id"]]["title"] == theory["title"]
    assert theories[theory["id"]]["delta"]["ops"][0]["insert"] == "Embedded body\n"


def test_public_complex_publish_auto_publishes_linked_theory(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Theory auto-publish",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload = {
        "id": "complex-public",
        "name": "Public complex",
        "description": "Complex with auto-published theory",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )

    catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    theory_items = catalog_service.list_items(
        content_type="theory",
        owner_user_id="author",
        requested_by_user_id="author",
    )["items"]
    assert len(theory_items) == 1
    assert theory_items[0]["catalog_visibility"] == "public"


def test_public_complex_visibility_update_to_public_auto_publishes_linked_theory(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Theory for visibility sync",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload = {
        "id": "complex-private",
        "name": "Private complex",
        "description": "Complex with private initial visibility",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )

    complex_publish = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="private",
    )
    assert catalog_service.list_items(
        content_type="theory",
        owner_user_id="author",
        requested_by_user_id="author",
    )["count"] == 0

    catalog_service.set_item_visibility(
        complex_publish["item"]["item_id"],
        catalog_visibility="public",
        requested_by_user_id="author",
    )

    theory_items = catalog_service.list_items(
        content_type="theory",
        owner_user_id="author",
        requested_by_user_id="author",
    )["items"]
    assert len(theory_items) == 1
    assert theory_items[0]["catalog_visibility"] == "public"


def test_access_code_complex_publish_auto_publishes_linked_theory_as_access_code(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Theory for access code sync",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload = {
        "id": "complex-access-code",
        "name": "Code complex",
        "description": "Complex with access-code visibility",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )

    catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="access_code",
    )

    theory_item = catalog_service.get_item(
        f"catalog_theory_{theory['id']}",
        requested_by_user_id="author",
    )["item"]
    assert theory_item["catalog_visibility"] == "access_code"
    assert theory_item["has_access_code"] is True


def test_catalog_list_marks_public_complex_and_theory_as_bundle(services_with_published_theory):
    complex_payload, theory, theory_publish, catalog_service = services_with_published_theory
    complex_publish = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    items = catalog_service.list_items(requested_by_user_id="reader")["items"]
    items_by_id = {str(item["item_id"]): item for item in items}

    complex_item = items_by_id[complex_publish["item"]["item_id"]]
    theory_item = items_by_id[theory_publish["item"]["item_id"]]

    assert complex_item["linked_theory_item"]["item_id"] == theory_publish["item"]["item_id"]
    assert complex_item["bundle"]["role"] == "complex"
    assert complex_item["bundle"]["paired_item_id"] == theory_publish["item"]["item_id"]
    assert theory_item["linked_complex_count"] == 1
    assert theory_item["linked_complex_items"][0]["item_id"] == complex_publish["item"]["item_id"]
    assert theory_item["bundle"]["role"] == "theory"
    assert theory_item["bundle"]["paired_item_id"] == complex_publish["item"]["item_id"]


def test_public_complex_visibility_update_to_access_code_downgrades_linked_theory(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Theory downgrade",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload = {
        "id": "complex-visibility-downgrade",
        "name": "Visibility downgrade complex",
        "description": "Complex that changes from public to access code",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )

    complex_publish = catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    catalog_service.set_item_visibility(
        complex_publish["item"]["item_id"],
        catalog_visibility="access_code",
        requested_by_user_id="author",
    )

    theory_item = catalog_service.get_item(
        f"catalog_theory_{theory['id']}",
        requested_by_user_id="author",
    )["item"]
    assert theory_item["catalog_visibility"] == "access_code"
    assert theory_item["has_access_code"] is True


def test_public_complex_priority_wins_over_access_code_for_shared_theory(tmp_path):
    author_dir = tmp_path / "users" / "author"
    author_dir.mkdir(parents=True, exist_ok=True)
    (author_dir / "profile.json").write_text(
        '{"user_id":"author","profile":{"name":"Dr. Jane Author"}}',
        encoding="utf-8",
    )
    theory_service = TheoryService(data_dir=str(tmp_path))
    theory = theory_service.create_theory(
        {
            "title": "Shared visibility theory",
            "delta": {"ops": [{"insert": "Theory body\n"}]},
            "created_by_user_id": "author",
            "updated_by_user_id": "author",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }
    )
    theory_link = {
        "theory_id": theory["id"],
        "relation": "link",
        "title_cache": theory["title"],
        "updated_at": theory["updated_at"],
    }
    complex_payload_a = {
        "id": "complex-access-ref",
        "name": "Access complex",
        "description": "Access-code complex",
        "tasks": ["module-a/topic-a/task-a"],
        "chains": [],
        "theory_link": theory_link,
        "theory_mode": "override",
        "theory_sync_meta": {
            "source": "test",
            "updated_at": theory["updated_at"],
            "topic_count": 1,
            "theory_ids": [theory["id"]],
        },
        "created_by_user_id": "author",
        "updated_by_user_id": "author",
        "created_via": "manual_editor",
        "content_scope": "shared_local",
    }
    complex_payload_b = deepcopy(complex_payload_a)
    complex_payload_b["id"] = "complex-public-ref"
    complex_payload_b["name"] = "Public complex"

    catalog_service = CatalogService(
        data_dir=str(tmp_path),
        complex_service=FakeComplexService(complex_payload_a),
        theory_service=theory_service,
        storage_service=FakeStorageService(theory_link=theory_link),
    )
    catalog_service.publish_complex(
        complex_payload_a["id"],
        requested_by_user_id="author",
        catalog_visibility="access_code",
    )
    catalog_service.complex_service = FakeComplexService(complex_payload_b)
    catalog_service.publish_complex(
        complex_payload_b["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    theory_item = catalog_service.get_item(
        f"catalog_theory_{theory['id']}",
        requested_by_user_id="author",
    )["item"]
    assert theory_item["catalog_visibility"] == "public"
    assert theory_item["visibility_lock"]["forced_visibility"] == "public"


def test_theory_visibility_is_locked_by_public_complex(services_with_published_theory):
    complex_payload, theory, theory_publish, catalog_service = services_with_published_theory
    catalog_service.publish_complex(
        complex_payload["id"],
        requested_by_user_id="author",
        catalog_visibility="public",
    )

    theory_item = catalog_service.get_item(
        theory_publish["item"]["item_id"],
        requested_by_user_id="author",
    )["item"]
    assert theory_item["visibility_lock"]["forced_visibility"] == "public"
    assert theory_item["visibility_lock"]["complex_count"] == 1

    with pytest.raises(ValueError, match="theory_catalog_visibility_locked_by_public_complex"):
        catalog_service.set_item_visibility(
            theory_publish["item"]["item_id"],
            catalog_visibility="private",
            requested_by_user_id="author",
        )

    with pytest.raises(ValueError, match="theory_catalog_visibility_locked_by_public_complex"):
        catalog_service.set_item_visibility(
            theory_publish["item"]["item_id"],
            catalog_visibility="access_code",
            requested_by_user_id="author",
        )

    with pytest.raises(ValueError, match="theory_catalog_visibility_locked_by_public_complex"):
        catalog_service.publish_theory(
            theory["id"],
            requested_by_user_id="author",
            catalog_visibility="private",
        )
