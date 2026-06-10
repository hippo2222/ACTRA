"""Pin the data-integrity guarantee behind catalog re-imports of complexes.

The lineage key includes `source_catalog_version_id` on EVERY level (complex,
module, topic, task, theory). Therefore importing a republished (new) version
never matches the existing copy: a fresh copy is created and the old one —
together with the user's progress keyed by its `module/topic/task` paths —
is left untouched. If someone ever drops the version from the key, in-place
reuse would start mutating copies under users' progress; this test is the
tripwire for that.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "desktop-app"))

from services.workspace_lineage import (
    build_source_lineage_fields,
    build_source_lineage_key,
    normalize_workspace_lineage_fields,
    source_lineage_matches,
)


def _entity_for_version(version_id: str):
    payload = dict(build_source_lineage_fields(
        source_catalog_item_id="catalog_item_1",
        source_catalog_version_id=version_id,
        source_entity_kind="task",
        module_id="m1",
        topic_id="t1",
        task_id="task_1",
    ))
    return normalize_workspace_lineage_fields(
        payload, entity_kind="task", entity_id="task_1", entity_ref="m1/t1/task_1",
    )


def test_lineage_key_includes_catalog_version():
    key_v1 = build_source_lineage_key(_entity_for_version("version_1"))
    key_v2 = build_source_lineage_key(_entity_for_version("version_2"))
    assert key_v1 and key_v2
    assert "source_catalog_version_id=version_1" in key_v1
    assert key_v1 != key_v2


def test_new_catalog_version_never_matches_existing_copy():
    existing_copy = _entity_for_version("version_1")

    # Same version re-import → reuse (no duplicate, no mutation).
    assert source_lineage_matches(
        existing_copy,
        source_catalog_item_id="catalog_item_1",
        source_catalog_version_id="version_1",
        source_entity_kind="task",
        source_entity_id="m1/t1/task_1",
    ) is True

    # Republished (new) version → NO match → importer creates a fresh copy
    # and the old copy with the user's progress stays untouched.
    assert source_lineage_matches(
        existing_copy,
        source_catalog_item_id="catalog_item_1",
        source_catalog_version_id="version_2",
        source_entity_kind="task",
        source_entity_id="m1/t1/task_1",
    ) is False
