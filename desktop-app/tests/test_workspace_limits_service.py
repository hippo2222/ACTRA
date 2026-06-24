from datetime import datetime, timedelta, timezone
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


DESKTOP_APP_PATH = Path(__file__).resolve().parents[1]
if str(DESKTOP_APP_PATH) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_PATH))

from services.user_service import USER_PLAN_FREE, USER_PLAN_PREMIUM, USER_ROLE_ADMIN, USER_ROLE_USER
from services.workspace_limits_service import (
    PremiumArchivedContentError,
    WorkspaceLimitError,
    WorkspaceLimitsService,
)


class _FakeUserService:
    def __init__(self, plan=USER_PLAN_FREE, role=USER_ROLE_USER, premium_expires_at=None):
        self.plan = plan
        self.role = role
        self.premium_expires_at = premium_expires_at

    def get_user(self, user_id):
        return SimpleNamespace(
            user_id=user_id,
            plan=self.plan,
            role=self.role,
            premium_expires_at=self.premium_expires_at,
        )


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
    decks=None,
    premium_expires_at=None,
):
    deck_items = list(decks or [])
    return WorkspaceLimitsService(
        user_service=_FakeUserService(
            plan=plan,
            role=role,
            premium_expires_at=premium_expires_at,
        ),
        theory_service=_FakeTheoryService(theories),
        complex_service=_FakeComplexService(complexes),
        storage_service=_FakeStorageService(modules),
        catalog_service=_FakeCatalogService(
            theory_entries=linked_theories,
            complex_entries=linked_complexes,
        ),
        microcards_decks_provider=lambda _user_id, _items=deck_items: list(_items),
    )


def _own_deck(i):
    return {
        "id": f"d{i}",
        "created_by_user_id": "u1",
        "created_at": f"2026-05-{i + 1:02d}T00:00:00",
    }


def _linked_deck(i):
    return {
        "id": f"ld{i}",
        "created_by_user_id": "u1",
        "linked": True,
        "catalog_item_id": f"cat-{i}",
        "created_at": f"2026-06-{i + 1:02d}T00:00:00",
    }


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

    assert summary["theories"]["personal_count"] == 4
    assert summary["theories"]["workspace_total_count"] == 4
    assert summary["theories"]["linked_library_count"] == 2
    assert summary["theories"]["library_total_count"] == 6

    assert summary["complexes"]["personal_count"] == 2
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


def test_free_user_archives_newest_personal_complexes_beyond_limit():
    service = _make_service(
        complexes=[
            {
                "id": f"c{i}",
                "created_by_user_id": "u1",
                "created_via": "complex_builder",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(7)
        ]
    )

    summary = service.get_summary("u1")
    complexes = summary["complexes"]

    assert complexes["active_count"] == 5
    assert complexes["archived_count"] == 2
    assert complexes["overage_count"] == 2
    assert [item["id"] for item in complexes["archived_items"]] == ["c5", "c6"]
    assert {item["workspace_access_state"] for item in complexes["archived_items"]} == {"premium_archived"}


def test_expired_timed_premium_uses_free_archive_limits():
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    service = _make_service(
        plan=USER_PLAN_PREMIUM,
        premium_expires_at=expired,
        complexes=[
            {
                "id": f"c{i}",
                "created_by_user_id": "u1",
                "created_via": "complex_builder",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(6)
        ],
    )

    summary = service.get_summary("u1")

    assert summary["plan"] == USER_PLAN_FREE
    assert summary["complexes"]["archived_count"] == 1
    assert summary["complexes"]["archived_items"][0]["id"] == "c5"


def test_restored_premium_clears_expiry_archive_restrictions():
    expired = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    restored = (datetime.now(timezone.utc) + timedelta(days=30)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    service = _make_service(
        plan=USER_PLAN_PREMIUM,
        premium_expires_at=expired,
        complexes=[
            {
                "id": f"c{i}",
                "created_by_user_id": "u1",
                "created_via": "complex_builder",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(6)
        ],
    )

    expired_summary = service.get_summary("u1")
    assert expired_summary["plan"] == USER_PLAN_FREE
    assert expired_summary["complexes"]["archived_count"] == 1
    with pytest.raises(PremiumArchivedContentError):
        service.assert_entity_not_archived("u1", "complex", "c5", action="start", scope="workspace")

    service.user_service.premium_expires_at = restored
    restored_summary = service.get_summary("u1")
    restored_state = service.assert_entity_not_archived("u1", "complex", "c5", action="start", scope="workspace")

    assert restored_summary["plan"] == USER_PLAN_PREMIUM
    assert restored_summary["complexes"]["archived_count"] == 0
    assert restored_summary["complexes"]["active_count"] == 6
    assert restored_state["workspace_access_state"] == "active"
    assert restored_state["is_premium_archived"] is False


def test_premium_user_has_no_archive_even_above_free_limits():
    service = _make_service(
        plan=USER_PLAN_PREMIUM,
        complexes=[
            {
                "id": f"c{i}",
                "created_by_user_id": "u1",
                "created_via": "complex_builder",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(7)
        ],
    )

    summary = service.get_summary("u1")

    assert summary["complexes"]["active_count"] == 7
    assert summary["complexes"]["archived_count"] == 0
    assert summary["complexes"]["archived_items"] == []


def test_library_total_archives_newest_linked_entries_beyond_limit():
    service = _make_service(
        theories=[
            {
                "id": f"t{i}",
                "created_by_user_id": "u1",
                "created_via": "manual",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(4)
        ],
        linked_theories=[
            {
                "library_entry": {
                    "library_entry_id": f"lt{i}",
                    "created_at": f"2026-05-{i + 5:02d}T00:00:00",
                }
            }
            for i in range(8)
        ],
    )

    summary = service.get_summary("u1")
    theories = summary["theories"]

    assert theories["library_total_count"] == 12
    assert theories["active_count"] == 10
    assert theories["archived_count"] == 2
    assert [item["id"] for item in theories["archived_items"]] == ["lt6", "lt7"]
    assert {item["scope"] for item in theories["archived_items"]} == {"linked_library"}


def test_archive_state_recomputes_after_deleting_excess_item():
    complex_items = [
        {
            "id": f"c{i}",
            "created_by_user_id": "u1",
            "created_via": "complex_builder",
            "created_at": f"2026-05-{i + 1:02d}T00:00:00",
        }
        for i in range(6)
    ]
    service = _make_service(complexes=complex_items)

    before = service.get_summary("u1")
    assert before["complexes"]["archived_count"] == 1

    service.complex_service.items = complex_items[:5]
    after = service.get_summary("u1")

    assert after["complexes"]["archived_count"] == 0
    assert after["complexes"]["active_count"] == 5


def test_archived_complex_guard_blocks_mutating_actions():
    service = _make_service(
        complexes=[
            {
                "id": f"c{i}",
                "created_by_user_id": "u1",
                "created_via": "complex_builder",
                "created_at": f"2026-05-{i + 1:02d}T00:00:00",
            }
            for i in range(6)
        ]
    )

    with pytest.raises(PremiumArchivedContentError) as excinfo:
        service.assert_entity_not_archived("u1", "complex", "c5", action="edit", scope="workspace")

    payload = excinfo.value.to_payload()
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "complex"
    assert payload["details"]["entity_ref"] == "c5"
    assert payload["details"]["action"] == "edit"
    assert payload["details"]["allowed_actions"]["delete"] is True
    assert payload["details"]["allowed_actions"]["edit"] is False


def test_archived_linked_complex_guard_matches_library_entry_id():
    service = _make_service(
        linked_complexes=[
            {
                "library_entry": {
                    "library_entry_id": f"lc{i}",
                    "created_at": f"2026-05-{i + 1:02d}T00:00:00",
                }
            }
            for i in range(11)
        ]
    )

    state = service.get_entity_access_state("u1", "complex", "lc10", scope="linked_library")

    assert state["workspace_access_state"] == "premium_archived"
    assert state["is_premium_archived"] is True
    assert state["archived_item"]["id"] == "lc10"


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


# ── Microcards decks (B1): own + linked into the complex-shaped limit ──────


def test_deck_summary_splits_own_and_linked_decks():
    service = _make_service(decks=[_own_deck(i) for i in range(3)] + [_linked_deck(i) for i in range(2)])

    decks = service.get_summary("u1")["decks"]

    assert decks["personal_count"] == 3
    assert decks["workspace_total_count"] == 3
    assert decks["linked_library_count"] == 2
    assert decks["library_total_count"] == 5
    assert decks["personal_limit"] == 4
    assert decks["library_limit"] == 8
    assert decks["active_count"] == 5
    assert decks["archived_count"] == 0


def test_deck_free_blocked_by_own_limit():
    service = _make_service(decks=[_own_deck(i) for i in range(4)])

    with pytest.raises(WorkspaceLimitError) as excinfo:
        service.assert_can_create_workspace_entity("u1", "deck")

    payload = excinfo.value.to_payload()
    assert payload["error"] == "workspace_limit_reached"
    assert payload["details"]["entity_kind"] == "deck"
    assert payload["details"]["limit_kind"] == "personal"


def test_deck_free_blocked_by_library_total_even_below_own_limit():
    service = _make_service(decks=[_own_deck(i) for i in range(3)] + [_linked_deck(i) for i in range(5)])

    with pytest.raises(WorkspaceLimitError) as excinfo:
        service.assert_can_create_workspace_entity("u1", "deck")

    payload = excinfo.value.to_payload()
    assert payload["details"]["entity_kind"] == "deck"
    assert payload["details"]["limit_kind"] == "library_total"


def test_deck_linked_import_checks_only_library_total():
    service = _make_service(decks=[_own_deck(i) for i in range(4)] + [_linked_deck(i) for i in range(4)])

    # 4 own already hits the own-limit, but importing a linked deck must ignore
    # the own-only limit and block solely on the combined total (8/8 -> full).
    with pytest.raises(WorkspaceLimitError) as excinfo:
        service.assert_can_add_linked_deck("u1")

    assert excinfo.value.to_payload()["details"]["limit_kind"] == "library_total"


def test_deck_premium_user_has_no_limit_or_archive():
    service = _make_service(
        plan=USER_PLAN_PREMIUM,
        decks=[_own_deck(i) for i in range(6)] + [_linked_deck(i) for i in range(6)],
    )

    evaluation = service.assert_can_create_workspace_entity("u1", "deck")
    decks = service.get_summary("u1")["decks"]

    assert evaluation["blocked"] is False
    assert decks["active_count"] == 12
    assert decks["archived_count"] == 0
    assert decks["archived_items"] == []


def test_deck_archives_newest_own_beyond_personal_limit():
    service = _make_service(decks=[_own_deck(i) for i in range(6)])

    decks = service.get_summary("u1")["decks"]

    assert decks["active_count"] == 4
    assert decks["archived_count"] == 2
    assert [item["id"] for item in decks["archived_items"]] == ["d4", "d5"]
    assert {item["limit_kind"] for item in decks["archived_items"]} == {"personal"}


def test_deck_archives_newest_linked_beyond_library_total():
    service = _make_service(decks=[_own_deck(i) for i in range(4)] + [_linked_deck(i) for i in range(6)])

    decks = service.get_summary("u1")["decks"]

    assert decks["library_total_count"] == 10
    assert decks["active_count"] == 8
    assert decks["archived_count"] == 2
    assert [item["id"] for item in decks["archived_items"]] == ["ld4", "ld5"]
    assert {item["scope"] for item in decks["archived_items"]} == {"linked_library"}


def test_deck_archived_guard_blocks_mutations_but_allows_delete():
    service = _make_service(decks=[_own_deck(i) for i in range(6)])

    with pytest.raises(PremiumArchivedContentError) as excinfo:
        service.assert_entity_not_archived("u1", "deck", "d5", action="start", scope="workspace")

    payload = excinfo.value.to_payload()
    assert payload["error"] == "premium_archived_content"
    assert payload["details"]["entity_kind"] == "deck"
    assert payload["details"]["action"] == "start"
    assert payload["details"]["allowed_actions"]["delete"] is True
    assert payload["details"]["allowed_actions"]["start"] is False

    active_state = service.assert_entity_not_archived("u1", "deck", "d0", action="start", scope="workspace")
    assert active_state["is_premium_archived"] is False


def test_deck_without_provider_reads_as_empty():
    service = WorkspaceLimitsService(
        user_service=_FakeUserService(),
        theory_service=_FakeTheoryService(),
        complex_service=_FakeComplexService(),
        storage_service=_FakeStorageService(),
        catalog_service=_FakeCatalogService(),
    )

    decks = service.get_summary("u1")["decks"]

    assert decks["library_total_count"] == 0
    assert decks["archived_count"] == 0
    assert service.assert_can_create_workspace_entity("u1", "deck")["blocked"] is False


def test_deck_provider_integration_with_real_microcards_service():
    """B2 wiring: a real MicrocardsServiceV2.list_decks() payload must flow
    through the provider into the limit/archive partition (validates the real
    deck-summary field shape, not just hand-rolled fakes)."""
    import tempfile

    from services.microcards_service_v2 import MicrocardsServiceV2

    data_dir = tempfile.mkdtemp()
    author = MicrocardsServiceV2(data_dir, user_id="u1")
    for i in range(6):
        author.create_deck(name=f"Deck {i}")

    service = WorkspaceLimitsService(
        user_service=_FakeUserService(),
        theory_service=_FakeTheoryService(),
        complex_service=_FakeComplexService(),
        storage_service=_FakeStorageService(),
        catalog_service=_FakeCatalogService(),
        microcards_decks_provider=(
            lambda user_id: MicrocardsServiceV2(data_dir, user_id=user_id).list_decks(limit=500)
        ),
    )

    decks = service.get_summary("u1")["decks"]

    # All 6 are own (not linked); free splits into 4 active + 2 archived.
    assert decks["personal_count"] == 6
    assert decks["linked_library_count"] == 0
    assert decks["library_total_count"] == 6
    assert decks["active_count"] == 4
    assert decks["archived_count"] == 2
    assert {item["limit_kind"] for item in decks["archived_items"]} == {"personal"}
    with pytest.raises(WorkspaceLimitError):
        service.assert_can_create_workspace_entity("u1", "deck")
