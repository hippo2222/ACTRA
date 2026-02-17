import io
import shutil
import tempfile
from pathlib import Path

import pytest
from werkzeug.datastructures import FileStorage

from services.theory_service import (
    TheoryConflictError,
    TheoryNotFoundError,
    TheoryService,
)


@pytest.fixture
def theory_service():
    base = tempfile.mkdtemp()
    data_dir = Path(base) / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    svc = TheoryService(str(data_dir))
    yield svc
    shutil.rmtree(base, ignore_errors=True)


def test_create_and_get_theory(theory_service: TheoryService):
    created = theory_service.create_theory(
        {
            "title": "Anatomy Notes",
            "delta": {"ops": [{"insert": "Hello"}, {"insert": "\n"}]},
        }
    )
    assert created["id"].startswith("th_")
    assert created["title"] == "Anatomy Notes"
    assert created["delta"]["ops"][0]["insert"] == "Hello"

    loaded = theory_service.get_theory(created["id"])
    assert loaded["id"] == created["id"]
    assert loaded["title"] == "Anatomy Notes"
    assert loaded["delta"]["ops"][0]["insert"] == "Hello"


def test_update_with_version_conflict(theory_service: TheoryService):
    created = theory_service.create_theory(
        {
            "title": "V1",
            "delta": {"ops": [{"insert": "A"}, {"insert": "\n"}]},
        }
    )
    theory_id = created["id"]
    v1 = created["version"]

    updated = theory_service.update_theory(
        theory_id,
        {"title": "V2", "delta": {"ops": [{"insert": "B"}, {"insert": "\n"}]}},
        expected_version=v1,
    )
    assert updated["title"] == "V2"

    with pytest.raises(TheoryConflictError):
        theory_service.update_theory(
            theory_id,
            {"title": "V3"},
            expected_version=v1,
        )


def test_history_and_restore(theory_service: TheoryService):
    created = theory_service.create_theory(
        {
            "title": "Version 1",
            "delta": {"ops": [{"insert": "One"}, {"insert": "\n"}]},
        }
    )
    theory_id = created["id"]

    theory_service.update_theory(
        theory_id,
        {"title": "Version 2", "delta": {"ops": [{"insert": "Two"}, {"insert": "\n"}]}},
        expected_version=created["version"],
    )
    latest = theory_service.get_theory(theory_id)
    theory_service.update_theory(
        theory_id,
        {"title": "Version 3"},
        expected_version=latest["version"],
    )

    history = theory_service.get_history(theory_id)
    assert len(history) >= 2
    snap = history[0]["_snapshot_timestamp"]
    restored = theory_service.restore_from_history(theory_id, snap)
    assert restored["id"] == theory_id
    assert restored["title"] in {"Version 1", "Version 2"}


def test_add_image(theory_service: TheoryService):
    created = theory_service.create_theory({"title": "Image Theory", "delta": {"ops": [{"insert": "\n"}]}})
    theory_id = created["id"]

    image_bytes = io.BytesIO(b"\x89PNG\r\n\x1a\nfake")
    fs = FileStorage(stream=image_bytes, filename="sample.png", content_type="image/png")
    result = theory_service.add_image(theory_id, fs)
    assert result["path"].endswith(".png")

    loaded = theory_service.get_theory(theory_id, include_delta=False)
    assert any(img.endswith(".png") for img in loaded["images"])


def test_clone_theory_creates_independent_copy(theory_service: TheoryService):
    created = theory_service.create_theory(
        {"title": "Source Theory", "delta": {"ops": [{"insert": "Line 1"}, {"insert": "\n"}]}}
    )
    source_id = created["id"]

    image_bytes = io.BytesIO(b"\x89PNG\r\n\x1a\nfake")
    fs = FileStorage(stream=image_bytes, filename="source.png", content_type="image/png")
    image_result = theory_service.add_image(source_id, fs)
    source_image = image_result["path"]

    source_after_image = theory_service.get_theory(source_id)
    source_updated = theory_service.update_theory(
        source_id,
        {
            "delta": {
                "ops": [
                    {"insert": "With image"},
                    {"insert": "\n"},
                    {"insert": {"image": source_image}},
                    {"insert": "\n"},
                ]
            }
        },
        expected_version=source_after_image["version"],
    )
    source_version = source_updated["version"]

    cloned = theory_service.clone_theory(source_id)
    clone_id = cloned["id"]
    assert clone_id != source_id
    assert cloned["title"] == "Source Theory (copy)"

    clone_images = cloned.get("images") or []
    assert len(clone_images) == 1
    clone_image = clone_images[0]
    assert clone_image != source_image
    assert (theory_service.data_dir / clone_image).exists()

    clone_image_refs = [
        op["insert"]["image"]
        for op in cloned["delta"]["ops"]
        if isinstance(op.get("insert"), dict) and isinstance(op["insert"].get("image"), str)
    ]
    assert source_image not in clone_image_refs
    assert clone_image in clone_image_refs

    edited_clone = theory_service.update_theory(
        clone_id,
        {"title": "Clone Edited"},
        expected_version=cloned["version"],
    )
    assert edited_clone["title"] == "Clone Edited"

    source_reloaded = theory_service.get_theory(source_id, include_delta=False)
    assert source_reloaded["version"] == source_version
    assert source_reloaded["title"] == "Source Theory"


def test_get_missing_theory_raises(theory_service: TheoryService):
    with pytest.raises(TheoryNotFoundError):
        theory_service.get_theory("th_missing")
