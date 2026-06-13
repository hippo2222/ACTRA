import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.microcards_routes_v2 as microcards_routes
from services.workspace_limits_service import PremiumArchivedContentError, WorkspaceLimitError


def _limit_error(limit_kind="personal"):
    return WorkspaceLimitError(
        entity_kind="deck",
        limit_kind=limit_kind,
        count=4,
        limit=4 if limit_kind == "personal" else 8,
        remaining=0,
        plan="free",
        message="Лимит колод исчерпан.",
    )


def _archived_error(action, entity_ref="deck_alpha"):
    return PremiumArchivedContentError(
        entity_kind="deck",
        entity_ref=entity_ref,
        action=action,
        plan="free",
        limit_kind="library_total",
        archived_item={
            "entity_kind": "deck",
            "scope": "workspace",
            "id": entity_ref,
            "ref": entity_ref,
            "limit_kind": "library_total",
            "allowed_actions": {
                "list": True,
                "read": True,
                "delete": True,
                "edit": False,
                "start": False,
                "publish": False,
            },
        },
    )


def _ctx(**limits_methods):
    return SimpleNamespace(
        user_id="u1",
        data_dir="data",
        workspace_limits_service=SimpleNamespace(**limits_methods),
        catalog_service=SimpleNamespace(),
    )


def test_create_deck_blocked_by_workspace_limit(monkeypatch):
    app = Flask(__name__)

    def fake_create(user_id, entity_kind):
        raise _limit_error("personal")

    def must_not_create():
        raise AssertionError("deck must not be created when blocked")

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_can_create_workspace_entity=fake_create))
    monkeypatch.setattr(microcards_routes, "_get_svc", lambda: SimpleNamespace(create_deck=lambda **k: must_not_create()))

    with app.test_request_context("/api/v2/microcards/decks", method="POST", json={"name": "X"}):
        response, status = microcards_routes.create_deck()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "workspace_limit_reached"
    assert payload["details"]["entity_kind"] == "deck"
    assert payload["details"]["limit_kind"] == "personal"


def test_create_deck_allowed_when_within_limit(monkeypatch):
    app = Flask(__name__)
    created = []

    monkeypatch.setattr(
        microcards_routes,
        "get_ctx",
        lambda: _ctx(assert_can_create_workspace_entity=lambda user_id, entity_kind: {"ok": True}),
    )
    monkeypatch.setattr(
        microcards_routes,
        "_get_svc",
        lambda: SimpleNamespace(create_deck=lambda **k: created.append(k) or {"id": "d1", "name": k.get("name")}),
    )

    with app.test_request_context("/api/v2/microcards/decks", method="POST", json={"name": "X"}):
        response = microcards_routes.create_deck()

    payload = response.get_json()
    assert payload["ok"] is True
    assert created and created[0]["name"] == "X"


def test_update_deck_blocked_by_premium_archive(monkeypatch):
    app = Flask(__name__)

    def fake_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action, entity_ref)

    def must_not_update():
        raise AssertionError("archived deck must not be updated")

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_entity_not_archived=fake_archived))
    monkeypatch.setattr(microcards_routes, "_get_svc", lambda: SimpleNamespace(update_deck=lambda **k: must_not_update()))

    with app.test_request_context("/api/v2/microcards/decks/deck_alpha", method="PATCH", json={"name": "X"}):
        response, status = microcards_routes.update_deck("deck_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "deck"
    assert payload["details"]["action"] == "edit"


def test_start_session_blocked_by_premium_archive(monkeypatch):
    app = Flask(__name__)
    archive_calls = []

    def fake_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        archive_calls.append((user_id, entity_kind, entity_ref, action, scope))
        raise _archived_error(action, entity_ref)

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_entity_not_archived=fake_archived))

    with app.test_request_context("/api/v2/microcards/decks/deck_alpha/session/start", method="POST", json={}):
        response, status = microcards_routes.start_session("deck_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "start"
    # scope omitted -> matches an archived deck whether it is own or linked.
    assert archive_calls == [("u1", "deck", "deck_alpha", "start", None)]


def test_import_blocked_by_premium_archive(monkeypatch):
    app = Flask(__name__)

    def fake_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action, entity_ref)

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_entity_not_archived=fake_archived))

    with app.test_request_context(
        "/api/v2/microcards/decks/deck_alpha/import/auto", method="POST", json={"text": "a;b"}
    ):
        response, status = microcards_routes.import_auto("deck_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "import"


def test_publish_blocked_by_premium_archive(monkeypatch):
    app = Flask(__name__)

    def fake_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action, entity_ref)

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_entity_not_archived=fake_archived))

    with app.test_request_context(
        "/api/v2/microcards/decks/deck_alpha/publish", method="POST", json={"catalog_visibility": "public"}
    ):
        response, status = microcards_routes.publish_deck_to_catalog("deck_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "publish"


def test_catalog_import_blocked_by_linked_limit(monkeypatch):
    app = Flask(__name__)
    added = []

    def fake_linked(user_id, *args, **kwargs):
        raise _limit_error("library_total")

    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: _ctx(assert_can_add_linked_deck=fake_linked))
    monkeypatch.setattr(
        microcards_routes,
        "_get_svc",
        lambda: SimpleNamespace(find_deck_by_catalog_item_id=lambda item_id: None, user_id="u1"),
    )
    monkeypatch.setattr(
        microcards_routes,
        "_get_catalog_svc",
        lambda: SimpleNamespace(add_item_to_library=lambda *a, **k: added.append((a, k))),
    )

    with app.test_request_context("/api/v2/microcards/catalog/cat1/import", method="POST", json={}):
        response, status = microcards_routes.import_deck_from_catalog("cat1")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "workspace_limit_reached"
    assert payload["details"]["limit_kind"] == "library_total"
    # The expensive add-to-library must never run once the limit blocks the import.
    assert added == []


# ── B4: deleting a published deck cascades to revoke its catalog publication ──


def _delete_ctx(monkeypatch, *, deck, cascade_calls):
    fake_svc = SimpleNamespace(
        user_id="u1",
        get_deck=lambda deck_id: dict(deck) if deck else None,
        delete_deck=lambda deck_id: True,
    )
    fake_catalog = SimpleNamespace(
        handle_workspace_source_deleted=lambda content_type, **kwargs: (
            cascade_calls.append((content_type, kwargs)) or {"ok": True, "affected_count": 1}
        ),
    )
    monkeypatch.setattr(microcards_routes, "get_ctx", lambda: SimpleNamespace(user_id="u1"))
    monkeypatch.setattr(microcards_routes, "_get_svc", lambda: fake_svc)
    monkeypatch.setattr(microcards_routes, "_get_catalog_svc", lambda: fake_catalog)


def test_delete_own_published_deck_revokes_catalog_publication(monkeypatch):
    app = Flask(__name__)
    cascade_calls = []
    _delete_ctx(monkeypatch, deck={"id": "d1", "catalog_item_id": "cat1", "linked": False}, cascade_calls=cascade_calls)

    with app.test_request_context("/api/v2/microcards/decks/d1", method="DELETE"):
        response = microcards_routes.delete_deck("d1")

    payload = response.get_json()
    assert payload["ok"] is True
    assert payload.get("catalog_source_delete", {}).get("ok") is True
    assert len(cascade_calls) == 1
    content_type, kwargs = cascade_calls[0]
    assert content_type == "flashcard_deck"
    assert kwargs["owner_user_id"] == "u1"
    assert kwargs["source_workspace_id"] == "d1"


def test_delete_linked_deck_does_not_touch_catalog_publication(monkeypatch):
    app = Flask(__name__)
    cascade_calls = []
    # A linked deck carries catalog_item_id too — it points at someone else's
    # publication and must NEVER trigger a source-delete cascade.
    _delete_ctx(monkeypatch, deck={"id": "d1", "catalog_item_id": "cat1", "linked": True}, cascade_calls=cascade_calls)

    with app.test_request_context("/api/v2/microcards/decks/d1", method="DELETE"):
        response = microcards_routes.delete_deck("d1")

    payload = response.get_json()
    assert payload["ok"] is True
    assert "catalog_source_delete" not in payload
    assert cascade_calls == []


def test_delete_unpublished_deck_skips_cascade(monkeypatch):
    app = Flask(__name__)
    cascade_calls = []
    _delete_ctx(monkeypatch, deck={"id": "d1", "catalog_item_id": None, "linked": False}, cascade_calls=cascade_calls)

    with app.test_request_context("/api/v2/microcards/decks/d1", method="DELETE"):
        response = microcards_routes.delete_deck("d1")

    payload = response.get_json()
    assert payload["ok"] is True
    assert "catalog_source_delete" not in payload
    assert cascade_calls == []
