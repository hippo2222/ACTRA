import sys
from pathlib import Path
from types import SimpleNamespace

from flask import Flask


DESKTOP_APP_PATH = Path(__file__).resolve().parents[2]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

import routes.catalog_routes as catalog_routes
import routes.complexes_routes as complexes_routes
import routes.editor_routes as editor_routes
import routes.import_routes as import_routes
import routes.theories_routes as theories_routes
import routes.workspace_import_routes as workspace_import_routes
from services.workspace_limits_service import PremiumArchivedContentError


def _archived_error(
    *,
    action: str,
    entity_ref: str = "complex_alpha",
    entity_kind: str = "complex",
) -> PremiumArchivedContentError:
    return PremiumArchivedContentError(
        entity_kind=entity_kind,
        entity_ref=entity_ref,
        action=action,
        plan="free",
        limit_kind="personal",
        archived_item={
            "entity_kind": entity_kind,
            "scope": "workspace",
            "id": entity_ref,
            "ref": entity_ref,
            "limit_kind": "personal",
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


def test_update_complex_route_blocks_premium_archived_complex(monkeypatch):
    app = Flask(__name__)
    service_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        service_calls.append((user_id, entity_kind, entity_ref, action, scope))
        raise _archived_error(action=action, entity_ref=entity_ref)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        complex_service=SimpleNamespace(update_complex=lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not update"))),
    )
    monkeypatch.setattr(complexes_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/complexes/complex_alpha",
        method="PUT",
        json={"name": "Changed"},
    ):
        response, status = complexes_routes.update_complex("complex_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "edit"
    assert service_calls == [("audit_user", "complex", "complex_alpha", "edit", "workspace")]


def test_publish_catalog_complex_blocks_premium_archived_source(monkeypatch):
    app = Flask(__name__)
    publish_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            publish_complex=lambda *args, **kwargs: publish_calls.append((args, kwargs)) or {"ok": True}
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/complexes/complex_alpha/publish",
        method="POST",
        json={"catalog_visibility": "public"},
    ):
        response, status = catalog_routes.publish_catalog_complex("complex_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["action"] == "publish"
    assert payload["route_contract"]["mode"] == "publish_complex"
    assert publish_calls == []


def test_update_theory_route_blocks_premium_archived_theory(monkeypatch):
    app = Flask(__name__)
    update_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        theory_service=SimpleNamespace(
            update_theory=lambda *args, **kwargs: update_calls.append((args, kwargs)) or {"id": "theory_alpha"}
        ),
    )
    monkeypatch.setattr(theories_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/theories/theory_alpha",
        method="PUT",
        json={"title": "Changed"},
    ):
        response, status = theories_routes.update_theory("theory_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "theory"
    assert payload["details"]["action"] == "edit"
    assert update_calls == []


def test_publish_catalog_theory_blocks_premium_archived_source(monkeypatch):
    app = Flask(__name__)
    publish_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            publish_theory=lambda *args, **kwargs: publish_calls.append((args, kwargs)) or {"ok": True}
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/theories/theory_alpha/publish",
        method="POST",
        json={"catalog_visibility": "public"},
    ):
        response, status = catalog_routes.publish_catalog_theory("theory_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "theory"
    assert payload["details"]["action"] == "publish"
    assert payload["route_contract"]["mode"] == "publish_theory"
    assert publish_calls == []


def test_visibility_update_allows_archived_complex_source_to_narrow_access(monkeypatch):
    app = Flask(__name__)
    visibility_calls = []

    def fake_assert_entity_not_archived(*args, **kwargs):
        raise AssertionError("narrowing access should not check premium archive")

    catalog_item = {
        "item_id": "catalog_complex_alpha",
        "content_type": "complex",
        "source_workspace_id": "complex_alpha",
        "catalog_visibility": "public",
    }
    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            get_item=lambda *args, **kwargs: {"item": catalog_item},
            set_item_visibility=lambda *args, **kwargs: visibility_calls.append((args, kwargs)) or {
                "ok": True,
                "item": dict(catalog_item, catalog_visibility=kwargs["catalog_visibility"]),
            },
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/items/catalog_complex_alpha/visibility",
        method="POST",
        json={"catalog_visibility": "private"},
    ):
        response = catalog_routes.update_catalog_item_visibility("catalog_complex_alpha")

    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["item"]["catalog_visibility"] == "private"
    assert payload["route_contract"]["mode"] == "set_visibility"
    assert len(visibility_calls) == 1


def test_visibility_update_blocks_archived_complex_source_when_expanding_access(monkeypatch):
    app = Flask(__name__)
    visibility_calls = []
    archive_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        archive_calls.append((user_id, entity_kind, entity_ref, action, scope))
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    catalog_item = {
        "item_id": "catalog_complex_alpha",
        "content_type": "complex",
        "source_workspace_id": "complex_alpha",
        "catalog_visibility": "private",
    }
    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            get_item=lambda *args, **kwargs: {"item": catalog_item},
            set_item_visibility=lambda *args, **kwargs: visibility_calls.append((args, kwargs)) or {"ok": True},
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/items/catalog_complex_alpha/visibility",
        method="POST",
        json={"catalog_visibility": "public"},
    ):
        response, status = catalog_routes.update_catalog_item_visibility("catalog_complex_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "complex"
    assert payload["details"]["action"] == "change_visibility"
    assert archive_calls == [("audit_user", "complex", "complex_alpha", "change_visibility", "workspace")]
    assert visibility_calls == []


def test_visibility_update_allows_archived_theory_source_to_narrow_access(monkeypatch):
    app = Flask(__name__)
    visibility_calls = []

    def fake_assert_entity_not_archived(*args, **kwargs):
        raise AssertionError("narrowing access should not check premium archive")

    catalog_item = {
        "item_id": "catalog_theory_alpha",
        "content_type": "theory",
        "source_workspace_id": "theory_alpha",
        "catalog_visibility": "access_code",
    }
    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            get_item=lambda *args, **kwargs: {"item": catalog_item},
            set_item_visibility=lambda *args, **kwargs: visibility_calls.append((args, kwargs)) or {
                "ok": True,
                "item": dict(catalog_item, catalog_visibility=kwargs["catalog_visibility"]),
            },
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/items/catalog_theory_alpha/visibility",
        method="POST",
        json={"catalog_visibility": "private"},
    ):
        response = catalog_routes.update_catalog_item_visibility("catalog_theory_alpha")

    payload = response.get_json()
    assert payload["ok"] is True
    assert payload["item"]["catalog_visibility"] == "private"
    assert payload["route_contract"]["mode"] == "set_visibility"
    assert len(visibility_calls) == 1


def test_visibility_update_blocks_archived_theory_source_when_expanding_access(monkeypatch):
    app = Flask(__name__)
    visibility_calls = []
    archive_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        archive_calls.append((user_id, entity_kind, entity_ref, action, scope))
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    catalog_item = {
        "item_id": "catalog_theory_alpha",
        "content_type": "theory",
        "source_workspace_id": "theory_alpha",
        "catalog_visibility": "access_code",
    }
    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        catalog_service=SimpleNamespace(
            get_item=lambda *args, **kwargs: {"item": catalog_item},
            set_item_visibility=lambda *args, **kwargs: visibility_calls.append((args, kwargs)) or {"ok": True},
        ),
    )
    monkeypatch.setattr(catalog_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/catalog/items/catalog_theory_alpha/visibility",
        method="POST",
        json={"catalog_visibility": "public"},
    ):
        response, status = catalog_routes.update_catalog_item_visibility("catalog_theory_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "theory"
    assert payload["details"]["action"] == "change_visibility"
    assert archive_calls == [("audit_user", "theory", "theory_alpha", "change_visibility", "workspace")]
    assert visibility_calls == []


def test_save_editor_task_blocks_premium_archived_task(monkeypatch, tmp_path):
    app = Flask(__name__)
    save_calls = []
    task_dir = tmp_path / "task_alpha"
    task_dir.mkdir()
    (task_dir / "task.json").write_text("{}", encoding="utf-8")

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        if entity_ref == "task_alpha":
            raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)
        return {"workspace_access_state": "active", "is_premium_archived": False}

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        storage_service=SimpleNamespace(
            save_task=lambda *args, **kwargs: save_calls.append((args, kwargs)) or True
        ),
    )
    monkeypatch.setattr(editor_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(editor_routes, "is_hosted_web_runtime", lambda: False)
    monkeypatch.setattr(editor_routes, "_resolve_task_dir", lambda module_id, topic_id, task_id: task_dir)

    with app.test_request_context(
        "/api/editor/task/mod/topic/task_alpha",
        method="POST",
        json={"type": "test"},
    ):
        response, status = editor_routes.save_editor_task("mod", "topic", "task_alpha")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "task"
    assert payload["details"]["action"] == "edit"
    assert save_calls == []


def test_create_complex_blocks_premium_archived_task_dependency(monkeypatch):
    app = Flask(__name__)
    create_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        if entity_kind == "task" and entity_ref == "task_alpha":
            raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)
        return {"workspace_access_state": "active", "is_premium_archived": False}

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(
            assert_can_create_workspace_entity=lambda *args, **kwargs: None,
            assert_entity_not_archived=fake_assert_entity_not_archived,
        ),
        storage_service=SimpleNamespace(load_task=lambda module_id, topic_id, task_id: {"id": task_id}),
        complex_service=SimpleNamespace(
            create_complex=lambda *args, **kwargs: create_calls.append((args, kwargs)) or {"id": "complex_alpha"}
        ),
    )
    monkeypatch.setattr(complexes_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/complexes",
        method="POST",
        json={
            "name": "Complex Alpha",
            "tasks": ["mod/topic/task_alpha"],
            "chains": [],
            "settings": {},
        },
    ):
        response, status = complexes_routes.create_complex()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "task"
    assert payload["details"]["action"] == "use_as_dependency"
    assert create_calls == []


def test_set_topic_theory_link_blocks_premium_archived_theory_dependency(monkeypatch):
    app = Flask(__name__)
    set_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        theory_service=SimpleNamespace(get_theory=lambda theory_id, include_delta=False: {"id": theory_id}),
        storage_service=SimpleNamespace(
            set_topic_theory_link=lambda *args, **kwargs: set_calls.append((args, kwargs)) or {}
        ),
    )
    monkeypatch.setattr(editor_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/editor/topic/mod/topic/theory-link",
        method="PUT",
        json={"theory_link": {"source_kind": "workspace", "theory_id": "theory_alpha"}},
    ):
        response, status = editor_routes.set_editor_topic_theory_link("mod", "topic")

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "theory"
    assert payload["details"]["action"] == "use_as_dependency"
    assert set_calls == []


def test_workspace_import_complex_copy_blocks_premium_archived_source(monkeypatch):
    app = Flask(__name__)
    import_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        complex_service=SimpleNamespace(get_complex=lambda complex_id: {"id": complex_id}),
        workspace_import_service=SimpleNamespace(
            import_complex_copy_by_source_complex_id=lambda *args, **kwargs: import_calls.append((args, kwargs)) or {}
        ),
    )
    monkeypatch.setattr(workspace_import_routes, "get_ctx", lambda: fake_ctx)
    monkeypatch.setattr(workspace_import_routes, "is_hosted_web_runtime", lambda: False)

    with app.test_request_context(
        "/api/internal/workspace/import/complex-copy",
        method="POST",
        json={
            "source_complex_id": "complex_alpha",
            "source_catalog_item_id": "catalog_alpha",
            "source_catalog_version_id": "version_alpha",
        },
    ):
        response, status = workspace_import_routes.import_workspace_complex_copy()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "complex"
    assert payload["details"]["action"] == "copy"
    assert payload["route_contract"]["mode"] == "execute"
    assert import_calls == []


def test_task_archive_export_blocks_premium_archived_task(monkeypatch):
    app = Flask(__name__)
    export_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        import_export_service=SimpleNamespace(
            create_export_archive=lambda *args, **kwargs: export_calls.append((args, kwargs)) or "never.zip"
        ),
    )
    monkeypatch.setattr(editor_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/editor/export/tasks",
        method="POST",
        json={"tasks": [{"module_id": "mod", "topic_id": "topic", "task_id": "task_alpha"}]},
    ):
        response, status = editor_routes.export_tasks()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "task"
    assert payload["details"]["action"] == "export"
    assert export_calls == []


def test_text_export_blocks_premium_archived_task(monkeypatch):
    app = Flask(__name__)
    load_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        storage_service=SimpleNamespace(
            load_task=lambda *args, **kwargs: load_calls.append((args, kwargs)) or {}
        ),
    )
    monkeypatch.setattr(import_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/editor/export/text",
        method="POST",
        json={"tasks": [{"module_id": "mod", "topic_id": "topic", "task_id": "task_alpha"}]},
    ):
        response, status = import_routes.export_tasks_to_text()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "task"
    assert payload["details"]["action"] == "export"
    assert load_calls == []


def test_bulk_task_archive_export_blocks_premium_archived_task(monkeypatch):
    app = Flask(__name__)
    export_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        storage_service=SimpleNamespace(
            load_modules=lambda: [
                {
                    "id": "mod",
                    "topics": [{"id": "topic", "tasks": [{"id": "task_alpha"}]}],
                }
            ]
        ),
        import_export_service=SimpleNamespace(
            create_export_archive=lambda *args, **kwargs: export_calls.append((args, kwargs)) or "never.zip"
        ),
    )
    monkeypatch.setattr(editor_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/editor/export/bulk",
        method="POST",
        json={"module_id": "mod"},
    ):
        response, status = editor_routes.export_bulk()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "task"
    assert payload["details"]["action"] == "export"
    assert export_calls == []


def test_complex_archive_export_blocks_premium_archived_complex(monkeypatch):
    app = Flask(__name__)
    export_calls = []

    def fake_assert_entity_not_archived(user_id, entity_kind, entity_ref, *, action, scope=None):
        raise _archived_error(action=action, entity_ref=entity_ref, entity_kind=entity_kind)

    fake_ctx = SimpleNamespace(
        user_id="audit_user",
        workspace_limits_service=SimpleNamespace(assert_entity_not_archived=fake_assert_entity_not_archived),
        complex_import_export_service=SimpleNamespace(
            create_export_archive=lambda *args, **kwargs: export_calls.append((args, kwargs)) or "never.zip"
        ),
    )
    monkeypatch.setattr(editor_routes, "get_ctx", lambda: fake_ctx)

    with app.test_request_context(
        "/api/complexes/export",
        method="POST",
        json={"complex_id": "complex_alpha"},
    ):
        response, status = editor_routes.export_complexes_bundle()

    payload = response.get_json()
    assert status == 409
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "complex"
    assert payload["details"]["action"] == "export"
    assert export_calls == []
