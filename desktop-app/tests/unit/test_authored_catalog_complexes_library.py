import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.catalog_service import CatalogService
from persistence.hosted_complex_repository import HostedComplexRepository
from services.hosted_complex_service import HostedComplexService
from task_system.core.models.complex_models import Complex


def test_list_complex_library_entries_includes_authored_catalog_complexes():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        catalog_service = CatalogService(
            data_dir=str(tmp_path),
            complex_service=SimpleNamespace(),
            theory_service=SimpleNamespace(),
            storage_service=SimpleNamespace(),
        )

        author_id = "user_hippopotamus"
        other_user_id = "user_other"

        # Mock catalog items
        catalog_service._list_item_payloads = lambda: [
            {
                "item_id": "item_chest_ct",
                "content_type": "complex",
                "owner_user_id": author_id,
                "title": "КТ Грудной клетки. Шесть уровней",
                "description": "Описание комплекса",
                "catalog_visibility": "public",
                "created_at": "2026-08-25T10:00:00Z",
                "updated_at": "2026-08-25T10:00:00Z",
                "latest_version_id": "ver_chest_ct_1",
            },
            {
                "item_id": "item_other",
                "content_type": "complex",
                "owner_user_id": other_user_id,
                "title": "Чужой комплекс",
                "catalog_visibility": "public",
                "created_at": "2026-08-25T10:00:00Z",
                "updated_at": "2026-08-25T10:00:00Z",
                "latest_version_id": "ver_other_1",
            },
        ]

        # Mock versions
        catalog_service._get_version_payload = lambda item_id, ver_id: {
            "version_id": ver_id,
            "item_id": item_id,
            "content_type": "complex",
            "published_at": "2026-08-25T10:00:00Z",
            "snapshot": {
                "complex": {
                    "id": "complex_chest_ct",
                    "name": "КТ Грудной клетки. Шесть уровней",
                    "tasks": [],
                },
                "dependencies": {},
            },
        }

        # Mock get item payload
        catalog_service._get_item_payload = lambda item_id: next(
            (i for i in catalog_service._list_item_payloads() if i["item_id"] == item_id),
            None,
        )

        # Mock empty raw library entries (user has not clicked "Add to Library")
        catalog_service._list_complex_library_entry_payloads_for_user = lambda user_id: []
        catalog_service._upsert_complex_library_entry_payload = lambda payload: None

        result = catalog_service.list_complex_library_entries(requested_by_user_id=author_id)
        assert result["ok"] is True
        assert result["count"] == 1
        entry = result["entries"][0]
        assert entry["item"]["item_id"] == "item_chest_ct"
        assert entry["item"]["title"] == "КТ Грудной клетки. Шесть уровней"
        assert entry["library_entry"]["catalog_item_id"] == "item_chest_ct"


def test_publish_complex_auto_attaches_library_entry():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        author_id = "user_hippopotamus"
        complex_payload = {
            "id": "workspace_chest_ct",
            "name": "КТ Грудной клетки. Шесть уровней",
            "description": "Описание",
            "tasks": [],
            "chains": [],
            "settings": {},
            "created_by_user_id": author_id,
            "updated_by_user_id": author_id,
            "created_via": "manual_editor",
            "content_scope": "shared_local",
        }

        complex_model = Complex(**complex_payload)
        fake_complex_service = SimpleNamespace(
            get_complex=lambda cid: complex_model if cid == "workspace_chest_ct" else None
        )

        catalog_service = CatalogService(
            data_dir=str(tmp_path),
            complex_service=fake_complex_service,
            theory_service=SimpleNamespace(),
            storage_service=SimpleNamespace(),
        )

        upserted_entries = []
        catalog_service._upsert_complex_library_entry_payload = lambda p: upserted_entries.append(p)
        catalog_service._get_complex_library_entry_by_user_item = lambda uid, cid: None

        res = catalog_service.publish_complex(
            "workspace_chest_ct",
            requested_by_user_id=author_id,
            catalog_visibility="public",
        )

        assert res["ok"] is True
        assert len(upserted_entries) >= 1
        assert upserted_entries[0]["user_id"] == author_id


def test_hosted_complex_repository_methods_exist():
    repo = HostedComplexRepository("postgresql://dummy:dummy@localhost:5432/dummy")
    assert hasattr(repo, "upsert_complex")
    assert hasattr(repo, "delete_complex")
    assert callable(repo.upsert_complex)
    assert callable(repo.delete_complex)
