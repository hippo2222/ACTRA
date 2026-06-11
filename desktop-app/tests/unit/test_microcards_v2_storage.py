import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from persistence.microcards_v2_storage import (
    FileMicrocardsStorage,
    PostgresMicrocardsStorage,
    resolve_microcards_storage,
)


def test_file_backend_roundtrip_matches_historical_layout():
    tmp = Path(tempfile.mkdtemp())
    st = FileMicrocardsStorage(tmp)

    deck = {"id": "deck_1", "name": "D", "created_by_user_id": "alice", "cards": []}
    st.put_deck_doc("deck_1", deck)
    # Byte-compatible location with the historical layout.
    assert (tmp / "microcards" / "decks" / "deck_1.json").exists()
    assert st.get_deck_doc("deck_1")["name"] == "D"

    st.put_deck_doc("deck_2", {"id": "deck_2", "created_by_user_id": "bob"})
    assert {d["id"] for d in st.list_deck_docs()} == {"deck_1", "deck_2"}
    assert [d["id"] for d in st.list_deck_docs(owner_user_id="alice")] == ["deck_1"]

    assert st.delete_deck_doc("deck_2") is True
    assert st.delete_deck_doc("deck_2") is False
    assert st.get_deck_doc("deck_2") is None

    # User documents: events are a bare list, states an envelope — stored as-is.
    st.put_user_doc("alice", "events", [{"id": "e1"}])
    st.put_user_doc("alice", "states", {"schema_version": "2.0", "items": {"c": {}}})
    assert (tmp / "users" / "alice" / "microcards" / "review_events.json").exists()
    assert st.get_user_doc("alice", "events", []) == [{"id": "e1"}]
    assert st.get_user_doc("alice", "states", {})["items"] == {"c": {}}
    assert st.get_user_doc("alice", "records", {"d": 1}) == {"d": 1}  # default

    assert st.delete_user_docs("alice") == 2


def test_resolver_picks_backend_by_runtime(monkeypatch):
    monkeypatch.delenv("ACTRA_RUNTIME_MODE", raising=False)
    monkeypatch.delenv("ACTRA_POSTGRES_DSN", raising=False)
    assert isinstance(resolve_microcards_storage("data"), FileMicrocardsStorage)

    # Hosted without a DSN still falls back to files (better than crashing).
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "hosted_web")
    assert isinstance(resolve_microcards_storage("data"), FileMicrocardsStorage)

    # Hosted + DSN → Postgres backend (construction is lazy, no connection yet).
    monkeypatch.setenv("ACTRA_POSTGRES_DSN", "postgresql://app@db/actra")
    st = resolve_microcards_storage("data")
    assert isinstance(st, PostgresMicrocardsStorage)

    # Desktop with a DSN set stays on files.
    monkeypatch.setenv("ACTRA_RUNTIME_MODE", "desktop")
    assert isinstance(resolve_microcards_storage("data"), FileMicrocardsStorage)


def test_migration_script_dry_run_scans_layout(monkeypatch, capsys):
    tmp = Path(tempfile.mkdtemp())
    st = FileMicrocardsStorage(tmp)
    st.put_deck_doc("deck_1", {"id": "deck_1", "name": "D", "created_by_user_id": "alice"})
    st.put_user_doc("alice", "events", [{"id": "e1"}])
    st.put_user_doc("alice", "records", {"items": {}})

    tools_dir = Path(__file__).parent.parent.parent.parent / "tools"
    sys.path.insert(0, str(tools_dir))
    try:
        import migrate_microcards_files_to_postgres as mig
        monkeypatch.setattr(sys, "argv", ["mig", "--data-dir", str(tmp), "--dry-run"])
        assert mig.main() == 0
    finally:
        sys.path.remove(str(tools_dir))
    out = capsys.readouterr().out
    assert "1 decks, 2 user documents" in out
    assert "DRY RUN" in out
