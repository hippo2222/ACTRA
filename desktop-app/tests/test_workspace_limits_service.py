from types import SimpleNamespace

import pytest

from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, USER_ROLE_ADMIN, USER_ROLE_USER
from services.workspace_limits_service import WorkspaceLimitError, WorkspaceLimitsService


class _FakeUserService:
    def __init__(self, plan=USER_PLAN_FREE, role=USER_ROLE_USER):
        self.plan = plan
        self.role = role

    def get_user(self, user_id):
        return SimpleNamespace(user_id=user_id, plan=self.plan, role=self.role)


class _FakeTheoryService:
    def __init__(self, items=None):
        self.items = list(items or [])

    def list_theories(self):
        return list(self.items)


class _FakeComplexService:
    def __init__(self, items=None):
        self.items = list(items or [])

    def list_complexes(self):
        return list(self.items)


class _FakeStorageService:
    def __init__(self, modules=None):
        self.modules = list(modules or [])

    def load_modules(self):
        return list(self.modules)


class _FakeCatalogService:
    def __init__(self, theory_entries=None, complex_entries=None):
        self.theory_entries = list(theory_entries or [])
        self.complex_entries = list(complex_entries or [])

    def list_theory_library_entries(self, requested_by_user_id=None):
        return {"entries": list(self.theory_entries)}

    def list_complex_library_entries(self, requested_by_user_id=None):
        return {"entries": list(self.complex_entries)}


def _make_service(
    *,
    plan=USER_PLAN_FREE,
    role=USER_ROLE_USER,
    theories=None,
    complexes=None,
    modules=None,
    linked_theories=None,
    linked_complexes=None,
):
    return WorkspaceLimitsService(
        user_service=_FakeUserService(plan=plan, role=role),
        theory_service=_FakeTheoryService(theories),
        complex_service=_FakeComplexService(complexes),
        storage_service=_FakeStorageService(modules),
        catalog_service=_FakeCatalogService(
            theory_entries=linked_theories,
            complex_entries=linked_complexes,
        ),
    )


def test_summary_counts_personal_and_library_items_separately():
    service = _make_service(
        theories=[
            {"id": "t1", "created_by_user_id": "u1", "created_via": "manual"},
            {"id": "t2", "created_by_user_id": "u1", "created_via": "manual_copy"},
            {"id": "t3", "created_by_user_id": "u1", "created_via": "catalog_import"},
            {
                "id": "t4",
                "created_by_user_id": "u1",
                "created_via": "manual",
                "source_catalog_item_id": "pub-1",
                "source_catalog_version_id": "ver-1",
                "source_entity_kind": "theory",
                "source_entity_id": "pub-theory",
            },
            {"id": "t5", "created_by_user_id": "u2", "created_via": "manual"},
        ],
        complexes=[
            {"id": "c1", "created_by_user_id": "u1", "created_via": "complex_builder"},
            {"id": "c2", "created_by_user_id": "u1", "created_via": "manual_copy"},
        ],
        linked_theories=[{"id": "lt1"}, {"id": "lt2"}],
        linked_complexes=[{"id": "lc1"}],
    )

    summary = service.get_summary("u1")

    assert summary["theories"]["personal_count"] == 1
    assert summary["theories"]["workspace_total_count"] == 4
    assert summary["theories"]["linked_library_count"] == 2
    assert summary["theories"]["library_total_count"] == 6

    assert summary["complexes"]["personal_count"] == 1
    assert summary["complexes"]["workspace_total_count"] == 2
    assert summary["complexes"]["linked_library_count"] == 1
    assert summary["complexes"]["library_total_count"] == 3


def test_task_limits_use_only_user_created_tasks():
    service = _make_service(
        modules=[
            {
                "topics": [
                    {
                        "tasks": [
                            {"metadata": {"created_by_user_id": "u1", "created_via": "manual"}},
                            {"task_data": {"meta": {"created_by_user_id": "u1"}}},
                            {"metadata": {"created_by_user_id": "u2", "created_via": "manual"}},
                        ]
                    }
                ]
            }
        ]
    )

    summary = service.get_summary("u1")

    assert summary["tasks"]["personal_count"] == 2
    assert summary["tasks"]["workspace_total_count"] == 2
    assert summary["tasks"]["library_total_count"] == 2
    assert summary["tasks"]["remaining_personal"] == 18


def test_free_user_is_blocked_by_personal_and_library_limits():
    service = _make_service(
        theories=[
            {"id": f"t{i}", "created_by_user_id": "u1", "created_via": "manual"}
            for i in range(5)
        ],
        linked_theories=[{"id": f"lt{i}"} for i in range(5)],
    )

    with pytest.raises(WorkspaceLimitError) as excinfo:
        service.assert_can_create_workspace_entity("u1", "theory")

    payload = excinfo.value.to_payload()
    assert payload["error"] == "workspace_limit_reached"
    assert payload["details"]["entity_kind"] == "theory"
    assert payload["details"]["limit_kind"] in {"personal", "library_total"}


def test_premium_user_is_unlimited():
    service = _make_service(
        plan=USER_PLAN_PREMIUM,
        theories=[
            {"id": f"t{i}", "created_by_user_id": "u1", "created_via": "manual"}
            for i in range(12)
        ],
        linked_theories=[{"id": f"lt{i}"} for i in range(30)],
    )

    evaluation = service.assert_can_create_workspace_entity("u1", "theory")

    assert evaluation["ok"] is True
    assert evaluation["blocked"] is False
    assert evaluation["plan"] == USER_PLAN_PREMIUM


def test_admin_with_free_plan_is_treated_as_effective_premium():
    service = _make_service(
        plan=USER_PLAN_FREE,
        role=USER_ROLE_ADMIN,
        theories=[
            {"id": f"t{i}", "created_by_user_id": "u1", "created_via": "manual"}
            for i in range(12)
        ],
        linked_theories=[{"id": f"lt{i}"} for i in range(30)],
    )

    evaluation = service.assert_can_create_workspace_entity("u1", "theory")

    assert evaluation["ok"] is True
    assert evaluation["blocked"] is False
    assert evaluation["plan"] == USER_PLAN_PREMIUM
