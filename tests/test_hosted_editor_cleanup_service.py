from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

from services.hosted_editor_cleanup_service import HostedEditorCleanupService


TaskRef = Tuple[str, str, str]


class _CatalogRepositoryStub:
    def __init__(self, modules: List[Dict[str, Any]]):
        self.modules = modules
        self.replaced_with = None

    def load_catalog(self):
        return self.modules

    def replace_catalog(self, modules):
        self.replaced_with = modules
        self.modules = modules


class _TaskContentRepositoryStub:
    def __init__(self, rows: Dict[TaskRef, Dict[str, Any]]):
        self.rows = dict(rows)
        self.deleted_refs: List[TaskRef] = []

    def list_task_refs(self):
        return list(self.rows.keys())

    def get_task_content(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        return self.rows.get((module_id, topic_id, task_id))

    def delete_task_content(self, module_id: str, topic_id: str, task_id: str) -> bool:
        ref = (module_id, topic_id, task_id)
        if ref not in self.rows:
            return False
        self.deleted_refs.append(ref)
        self.rows.pop(ref, None)
        return True


class _ShadowStorageStub:
    def __init__(self):
        self.deleted_tasks: List[TaskRef] = []
        self.deleted_topics: List[Tuple[str, str]] = []
        self.deleted_modules: List[str] = []

    def delete_task(self, module_id: str, topic_id: str, task_id: str) -> bool:
        self.deleted_tasks.append((module_id, topic_id, task_id))
        return True

    def delete_topic(self, module_id: str, topic_id: str) -> bool:
        self.deleted_topics.append((module_id, topic_id))
        return True

    def delete_module(self, module_id: str) -> bool:
        self.deleted_modules.append(module_id)
        return True


def _task_ref(
    task_id: str,
    *,
    created_by_user_id: Optional[str] = None,
    created_via: str = "manual_editor",
    source_catalog_item_id: Optional[str] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "id": task_id,
        "name": task_id,
        "created_via": created_via,
        "content_scope": "shared_local",
    }
    if created_by_user_id is not None:
        payload["created_by_user_id"] = created_by_user_id
    if source_catalog_item_id is not None:
        payload["source_catalog_item_id"] = source_catalog_item_id
    return payload


def _task_row(
    *,
    created_by_user_id: Optional[str] = None,
    created_via: str = "manual_editor",
    source_catalog_item_id: Optional[str] = None,
) -> Dict[str, Any]:
    meta: Dict[str, Any] = {
        "created_via": created_via,
        "content_scope": "shared_local",
    }
    if created_by_user_id is not None:
        meta["created_by_user_id"] = created_by_user_id
    if source_catalog_item_id is not None:
        meta["source_catalog_item_id"] = source_catalog_item_id
    return {
        "task_data": {
            "meta": meta,
        },
        "answer_key": {},
    }


def test_cleanup_plan_removes_ownerless_and_legacy_catalog_entries():
    modules = [
        {
            "id": "module_drop",
            "name": "Legacy module",
            "created_via": "legacy_unknown",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_drop",
                    "name": "Legacy topic",
                    "created_via": "legacy_unknown",
                    "content_scope": "shared_local",
                    "tasks": [
                        _task_ref("task_drop", created_via="legacy_unknown"),
                    ],
                }
            ],
        }
    ]
    rows = {
        ("module_drop", "topic_drop", "task_drop"): _task_row(created_via="legacy_unknown"),
    }

    service = HostedEditorCleanupService()
    plan = service.build_plan(
        modules=modules,
        task_content_refs=list(rows.keys()),
        task_content_loader=lambda m, t, task: rows.get((m, t, task)),
    )

    assert plan.summary["modules_to_delete"] == 1
    assert plan.summary["topics_to_delete"] == 1
    assert plan.summary["tasks_to_delete"] == 1
    assert plan.summary["task_content_to_delete"] == 1
    assert plan.filtered_modules == []
    assert plan.modules_to_delete[0].ref == "module_drop"
    assert plan.tasks_to_delete[0].ref == "module_drop/topic_drop/task_drop"


def test_cleanup_plan_keeps_imported_content_and_only_deletes_ownerless_orphans():
    modules = [
        {
            "id": "module_keep",
            "name": "Owned module",
            "created_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_keep",
                    "name": "Owned topic",
                    "created_by_user_id": "editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        _task_ref("task_owned", created_by_user_id="editor-user"),
                        _task_ref("task_ownerless"),
                        _task_ref("task_imported", source_catalog_item_id="catalog-1"),
                    ],
                }
            ],
        }
    ]
    rows = {
        ("module_keep", "topic_keep", "task_owned"): _task_row(created_by_user_id="editor-user"),
        ("module_keep", "topic_keep", "task_ownerless"): _task_row(),
        ("module_keep", "topic_keep", "task_imported"): _task_row(source_catalog_item_id="catalog-1"),
        ("orphan_mod", "orphan_topic", "orphan_ownerless"): _task_row(),
        ("orphan_mod", "orphan_topic", "orphan_imported"): _task_row(source_catalog_item_id="catalog-2"),
    }

    service = HostedEditorCleanupService()
    plan = service.build_plan(
        modules=modules,
        task_content_refs=list(rows.keys()),
        task_content_loader=lambda m, t, task: rows.get((m, t, task)),
    )

    kept_task_ids = [
        task["id"]
        for task in plan.filtered_modules[0]["topics"][0]["tasks"]
    ]
    assert kept_task_ids == ["task_owned", "task_imported"]
    assert [record.ref for record in plan.tasks_to_delete] == ["module_keep/topic_keep/task_ownerless"]
    assert sorted(record.ref for record in plan.task_content_to_delete) == [
        "module_keep/topic_keep/task_ownerless",
        "orphan_mod/orphan_topic/orphan_ownerless",
    ]
    assert [record.ref for record in plan.kept_orphan_task_content] == [
        "orphan_mod/orphan_topic/orphan_imported"
    ]


def test_cleanup_apply_updates_hosted_repositories():
    modules = [
        {
            "id": "module_keep",
            "name": "Owned module",
            "created_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_keep",
                    "name": "Owned topic",
                    "created_by_user_id": "editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        _task_ref("task_keep", created_by_user_id="editor-user"),
                        _task_ref("task_drop"),
                    ],
                }
            ],
        }
    ]
    rows = {
        ("module_keep", "topic_keep", "task_keep"): _task_row(created_by_user_id="editor-user"),
        ("module_keep", "topic_keep", "task_drop"): _task_row(),
    }
    catalog_repo = _CatalogRepositoryStub(modules)
    content_repo = _TaskContentRepositoryStub(rows)
    service = HostedEditorCleanupService(
        repository=catalog_repo,
        content_repository=content_repo,
    )

    plan = service.build_plan_from_repositories()
    apply_report = service.apply_hosted_plan(plan)

    assert apply_report["task_content_deleted"] == 1
    assert content_repo.deleted_refs == [("module_keep", "topic_keep", "task_drop")]
    assert catalog_repo.replaced_with[0]["topics"][0]["tasks"] == [
        _task_ref("task_keep", created_by_user_id="editor-user")
    ]


def test_cleanup_apply_shadow_skips_children_of_deleted_parents():
    modules = [
        {
            "id": "module_drop",
            "name": "Legacy module",
            "created_via": "legacy_unknown",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_drop",
                    "name": "Legacy topic",
                    "created_via": "legacy_unknown",
                    "content_scope": "shared_local",
                    "tasks": [
                        _task_ref("task_drop", created_via="legacy_unknown"),
                    ],
                }
            ],
        },
        {
            "id": "module_keep",
            "name": "Owned module",
            "created_by_user_id": "editor-user",
            "created_via": "manual_editor",
            "content_scope": "shared_local",
            "topics": [
                {
                    "id": "topic_keep",
                    "name": "Owned topic",
                    "created_by_user_id": "editor-user",
                    "created_via": "manual_editor",
                    "content_scope": "shared_local",
                    "tasks": [
                        _task_ref("task_ownerless"),
                    ],
                }
            ],
        },
    ]

    plan = HostedEditorCleanupService().build_plan(modules=modules)
    storage = _ShadowStorageStub()
    report = HostedEditorCleanupService.apply_shadow_plan(storage, plan)

    assert report["shadow_modules_deleted"] == 1
    assert report["shadow_tasks_deleted"] == 1
    assert storage.deleted_modules == ["module_drop"]
    assert storage.deleted_topics == []
    assert storage.deleted_tasks == [("module_keep", "topic_keep", "task_ownerless")]
