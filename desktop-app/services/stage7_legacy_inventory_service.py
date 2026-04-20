from __future__ import annotations

from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

from services.complex_service import ComplexService
from services.storage_service import StorageService
from services.theory_service import TheoryService


LEGACY_CREATED_VIA_MARKERS = {
    "workspace_import",
    "archive_import",
}

SAFE_BUCKET = "safe_read_only_candidate"
KEEP_BUCKET = "keep_legacy_draft"
REVIEW_BUCKET = "needs_manual_review"


def _normalize_optional_text(value: Any) -> str:
    return str(value or "").strip()


def _parse_datetime(value: Any) -> Optional[datetime]:
    raw = _normalize_optional_text(value)
    if not raw:
        return None
    normalized = raw.replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _count_history_snapshots(history_dir: Path) -> int:
    if not history_dir.exists() or not history_dir.is_dir():
        return 0
    return sum(1 for path in history_dir.glob("*.json") if path.is_file())


def _has_source_lineage(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    if _normalize_optional_text(payload.get("source_lineage_key")):
        return True
    return any(
        _normalize_optional_text(payload.get(field))
        for field in (
            "source_catalog_item_id",
            "source_catalog_version_id",
            "source_entity_kind",
            "source_entity_id",
        )
    )


def _is_legacy_copy_candidate(payload: Dict[str, Any]) -> bool:
    if not isinstance(payload, dict):
        return False
    created_via = _normalize_optional_text(payload.get("created_via")).lower()
    workspace_copy_kind = _normalize_optional_text(payload.get("workspace_copy_kind")).lower()
    return (
        created_via in LEGACY_CREATED_VIA_MARKERS
        or workspace_copy_kind == "imported_copy"
        or _has_source_lineage(payload)
    )


def _bucket_counts(records: Iterable["LegacyInventoryRecord"]) -> Dict[str, int]:
    counter = Counter(record.classification for record in records)
    return {
        SAFE_BUCKET: int(counter.get(SAFE_BUCKET, 0)),
        KEEP_BUCKET: int(counter.get(KEEP_BUCKET, 0)),
        REVIEW_BUCKET: int(counter.get(REVIEW_BUCKET, 0)),
    }


@dataclass
class LegacyInventoryRecord:
    entity_kind: str
    entity_id: str
    entity_ref: str
    parent_ref: Optional[str]
    path: str
    created_via: str
    content_scope: str
    workspace_copy_kind: str
    source_lineage_key: str
    has_source_lineage: bool
    classification: str
    reasons: List[str]
    local_edit_signals: List[str]
    child_bucket_counts: Dict[str, int]


class Stage7LegacyInventoryService:
    """Build a dry-run inventory of legacy imported copies for Stage 7 migration work."""

    def __init__(self, data_root: str | Path):
        self.data_root = Path(data_root).resolve()
        self.storage_service = StorageService(str(self.data_root))
        self.complex_service = ComplexService(str(self.data_root))
        self.theory_service = TheoryService(str(self.data_root))

    def build_report(self) -> Dict[str, Any]:
        task_records = self._collect_task_records()
        theory_records = self._collect_theory_records()
        topic_records = self._collect_topic_records(task_records, theory_records)
        module_records = self._collect_module_records(topic_records)
        complex_records = self._collect_complex_records(task_records, theory_records)

        all_records = [
            *complex_records.values(),
            *theory_records.values(),
            *module_records.values(),
            *topic_records.values(),
            *task_records.values(),
        ]
        records = sorted(all_records, key=lambda item: (item.entity_kind, item.entity_ref))

        totals_by_kind = Counter(record.entity_kind for record in records)
        classification_by_kind: Dict[str, Dict[str, int]] = {}
        for entity_kind in ("complex", "theory", "module", "topic", "task"):
            kind_records = [record for record in records if record.entity_kind == entity_kind]
            classification_by_kind[entity_kind] = _bucket_counts(kind_records)

        return {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "data_root": str(self.data_root),
            "summary": {
                "legacy_record_count": len(records),
                "totals_by_entity_kind": {
                    kind: int(totals_by_kind.get(kind, 0))
                    for kind in ("complex", "theory", "module", "topic", "task")
                },
                "classification_totals": _bucket_counts(records),
                "classification_by_entity_kind": classification_by_kind,
            },
            "records": [asdict(record) for record in records],
        }

    def _collect_complex_records(
        self,
        task_records: Dict[str, LegacyInventoryRecord],
        theory_records: Dict[str, LegacyInventoryRecord],
    ) -> Dict[str, LegacyInventoryRecord]:
        records: Dict[str, LegacyInventoryRecord] = {}
        for complex_obj in self.complex_service.get_all_complexes():
            payload = complex_obj.dict()
            if not _is_legacy_copy_candidate(payload):
                continue

            complex_id = _normalize_optional_text(payload.get("id"))
            local_edit_signals = self._complex_edit_signals(payload)
            child_records: List[LegacyInventoryRecord] = []

            for raw_task_ref in payload.get("tasks") or []:
                task_ref = _normalize_optional_text(raw_task_ref)
                if task_ref and task_ref in task_records:
                    child_records.append(task_records[task_ref])
                elif task_ref:
                    local_edit_signals.append(f"missing_child_task_record:{task_ref}")

            theory_link = payload.get("theory_link")
            if isinstance(theory_link, dict):
                source_kind = _normalize_optional_text(theory_link.get("source_kind")).lower()
                if source_kind == "linked_library":
                    local_edit_signals.append("complex_theory_link_points_to_linked_library")
                linked_theory_id = _normalize_optional_text(
                    theory_link.get("theory_id") or theory_link.get("source_theory_id")
                )
                if linked_theory_id and linked_theory_id in theory_records:
                    child_records.append(theory_records[linked_theory_id])

            classification, reasons = self._classify_payload(
                payload,
                local_edit_signals=local_edit_signals,
                child_records=child_records,
            )
            records[complex_id] = LegacyInventoryRecord(
                entity_kind="complex",
                entity_id=complex_id,
                entity_ref=complex_id,
                parent_ref=None,
                path=str(self.data_root / "complexes" / "complexes.json"),
                created_via=_normalize_optional_text(payload.get("created_via")),
                content_scope=_normalize_optional_text(payload.get("content_scope")),
                workspace_copy_kind=_normalize_optional_text(payload.get("workspace_copy_kind")),
                source_lineage_key=_normalize_optional_text(payload.get("source_lineage_key")),
                has_source_lineage=_has_source_lineage(payload),
                classification=classification,
                reasons=reasons,
                local_edit_signals=sorted(set(local_edit_signals)),
                child_bucket_counts=_bucket_counts(child_records),
            )
        return records

    def _collect_theory_records(self) -> Dict[str, LegacyInventoryRecord]:
        records: Dict[str, LegacyInventoryRecord] = {}
        for theory in self.theory_service.list_theories():
            payload = dict(theory or {})
            if not _is_legacy_copy_candidate(payload):
                continue

            theory_id = _normalize_optional_text(payload.get("id"))
            history_dir = self.data_root / "complexes" / "theories" / theory_id / "history"
            local_edit_signals = self._timestamp_edit_signals(
                payload,
                created_at_field="created_at",
                updated_at_field="updated_at",
            )
            history_count = _count_history_snapshots(history_dir)
            if history_count > 1:
                local_edit_signals.append(f"multiple_history_snapshots:{history_count}")

            classification, reasons = self._classify_payload(
                payload,
                local_edit_signals=local_edit_signals,
                child_records=[],
            )
            records[theory_id] = LegacyInventoryRecord(
                entity_kind="theory",
                entity_id=theory_id,
                entity_ref=theory_id,
                parent_ref=None,
                path=str(self.data_root / "complexes" / "theories" / theory_id / "theory.json"),
                created_via=_normalize_optional_text(payload.get("created_via")),
                content_scope=_normalize_optional_text(payload.get("content_scope")),
                workspace_copy_kind=_normalize_optional_text(payload.get("workspace_copy_kind")),
                source_lineage_key=_normalize_optional_text(payload.get("source_lineage_key")),
                has_source_lineage=_has_source_lineage(payload),
                classification=classification,
                reasons=reasons,
                local_edit_signals=sorted(set(local_edit_signals)),
                child_bucket_counts=_bucket_counts([]),
            )
        return records

    def _collect_task_records(self) -> Dict[str, LegacyInventoryRecord]:
        records: Dict[str, LegacyInventoryRecord] = {}
        for module in self.storage_service.load_modules():
            if not isinstance(module, dict):
                continue
            module_id = _normalize_optional_text(module.get("id"))
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                topic_id = _normalize_optional_text(topic.get("id"))
                for task in topic.get("tasks") or []:
                    if not isinstance(task, dict):
                        continue
                    payload = dict(task)
                    if not _is_legacy_copy_candidate(payload):
                        continue

                    task_id = _normalize_optional_text(payload.get("id"))
                    task_ref = f"{module_id}/{topic_id}/{task_id}"
                    loaded_task = self.storage_service.load_task(module_id, topic_id, task_id) or {}
                    task_meta = loaded_task.get("task_data", {}).get("meta")
                    if not isinstance(task_meta, dict):
                        task_meta = {}
                    local_edit_signals = self._task_edit_signals(payload, task_meta)

                    classification, reasons = self._classify_payload(
                        payload,
                        local_edit_signals=local_edit_signals,
                        child_records=[],
                    )
                    records[task_ref] = LegacyInventoryRecord(
                        entity_kind="task",
                        entity_id=task_id,
                        entity_ref=task_ref,
                        parent_ref=f"{module_id}/{topic_id}",
                        path=str(self.data_root / "modules" / module_id / "topics" / topic_id / "tasks" / task_id / "task.json"),
                        created_via=_normalize_optional_text(payload.get("created_via")),
                        content_scope=_normalize_optional_text(payload.get("content_scope")),
                        workspace_copy_kind=_normalize_optional_text(payload.get("workspace_copy_kind")),
                        source_lineage_key=_normalize_optional_text(payload.get("source_lineage_key")),
                        has_source_lineage=_has_source_lineage(payload),
                        classification=classification,
                        reasons=reasons,
                        local_edit_signals=sorted(set(local_edit_signals)),
                        child_bucket_counts=_bucket_counts([]),
                    )
        return records

    def _collect_topic_records(
        self,
        task_records: Dict[str, LegacyInventoryRecord],
        theory_records: Dict[str, LegacyInventoryRecord],
    ) -> Dict[str, LegacyInventoryRecord]:
        records: Dict[str, LegacyInventoryRecord] = {}
        for module in self.storage_service.load_modules():
            if not isinstance(module, dict):
                continue
            module_id = _normalize_optional_text(module.get("id"))
            for topic in module.get("topics") or []:
                if not isinstance(topic, dict):
                    continue
                payload = dict(topic)
                if not _is_legacy_copy_candidate(payload):
                    continue

                topic_id = _normalize_optional_text(payload.get("id"))
                topic_ref = f"{module_id}/{topic_id}"
                child_records: List[LegacyInventoryRecord] = []
                for task in topic.get("tasks") or []:
                    task_id = _normalize_optional_text((task or {}).get("id"))
                    task_ref = f"{module_id}/{topic_id}/{task_id}"
                    if task_ref in task_records:
                        child_records.append(task_records[task_ref])

                theory_link = payload.get("theory_link")
                local_edit_signals: List[str] = []
                if isinstance(theory_link, dict):
                    source_kind = _normalize_optional_text(theory_link.get("source_kind")).lower()
                    linked_theory_id = _normalize_optional_text(
                        theory_link.get("theory_id") or theory_link.get("source_theory_id")
                    )
                    if source_kind == "linked_library":
                        local_edit_signals.append("topic_theory_link_points_to_linked_library")
                    if linked_theory_id and linked_theory_id in theory_records:
                        child_records.append(theory_records[linked_theory_id])

                classification, reasons = self._classify_payload(
                    payload,
                    local_edit_signals=local_edit_signals,
                    child_records=child_records,
                )
                records[topic_ref] = LegacyInventoryRecord(
                    entity_kind="topic",
                    entity_id=topic_id,
                    entity_ref=topic_ref,
                    parent_ref=module_id,
                    path=str(self.data_root / "modules" / module_id / "topics" / topic_id / "topic.json"),
                    created_via=_normalize_optional_text(payload.get("created_via")),
                    content_scope=_normalize_optional_text(payload.get("content_scope")),
                    workspace_copy_kind=_normalize_optional_text(payload.get("workspace_copy_kind")),
                    source_lineage_key=_normalize_optional_text(payload.get("source_lineage_key")),
                    has_source_lineage=_has_source_lineage(payload),
                    classification=classification,
                    reasons=reasons,
                    local_edit_signals=sorted(set(local_edit_signals)),
                    child_bucket_counts=_bucket_counts(child_records),
                )
        return records

    def _collect_module_records(
        self,
        topic_records: Dict[str, LegacyInventoryRecord],
    ) -> Dict[str, LegacyInventoryRecord]:
        records: Dict[str, LegacyInventoryRecord] = {}
        for module in self.storage_service.load_modules():
            if not isinstance(module, dict):
                continue
            payload = dict(module)
            if not _is_legacy_copy_candidate(payload):
                continue

            module_id = _normalize_optional_text(payload.get("id"))
            child_records: List[LegacyInventoryRecord] = []
            for topic in module.get("topics") or []:
                topic_id = _normalize_optional_text((topic or {}).get("id"))
                topic_ref = f"{module_id}/{topic_id}"
                if topic_ref in topic_records:
                    child_records.append(topic_records[topic_ref])

            classification, reasons = self._classify_payload(
                payload,
                local_edit_signals=[],
                child_records=child_records,
            )
            records[module_id] = LegacyInventoryRecord(
                entity_kind="module",
                entity_id=module_id,
                entity_ref=module_id,
                parent_ref=None,
                path=str(self.data_root / "modules" / module_id / "module.json"),
                created_via=_normalize_optional_text(payload.get("created_via")),
                content_scope=_normalize_optional_text(payload.get("content_scope")),
                workspace_copy_kind=_normalize_optional_text(payload.get("workspace_copy_kind")),
                source_lineage_key=_normalize_optional_text(payload.get("source_lineage_key")),
                has_source_lineage=_has_source_lineage(payload),
                classification=classification,
                reasons=reasons,
                local_edit_signals=[],
                child_bucket_counts=_bucket_counts(child_records),
            )
        return records

    def _complex_edit_signals(self, payload: Dict[str, Any]) -> List[str]:
        complex_id = _normalize_optional_text(payload.get("id"))
        history_dir = self.data_root / "complexes" / "history" / complex_id
        signals = self._timestamp_edit_signals(
            payload,
            created_at_field="created_at",
            updated_at_field="updated_at",
        )
        history_count = _count_history_snapshots(history_dir)
        if history_count > 1:
            signals.append(f"multiple_history_snapshots:{history_count}")
        return signals

    def _task_edit_signals(self, payload: Dict[str, Any], task_meta: Dict[str, Any]) -> List[str]:
        signals: List[str] = []
        created_at = _parse_datetime(task_meta.get("created_at") or task_meta.get("created"))
        modified_at = _parse_datetime(task_meta.get("modified"))
        if created_at is not None and modified_at is not None and modified_at > created_at:
            signals.append("task_modified_after_creation")
        created_via = _normalize_optional_text(payload.get("created_via")).lower()
        if created_via == "archive_import" and _normalize_optional_text(task_meta.get("modified")):
            signals.append("task_has_runtime_modified_timestamp")
        return signals

    def _timestamp_edit_signals(
        self,
        payload: Dict[str, Any],
        *,
        created_at_field: str,
        updated_at_field: str,
    ) -> List[str]:
        signals: List[str] = []
        created_at = _parse_datetime(payload.get(created_at_field))
        updated_at = _parse_datetime(payload.get(updated_at_field))
        if created_at is not None and updated_at is not None and updated_at > created_at:
            signals.append("updated_after_creation")
        return signals

    def _classify_payload(
        self,
        payload: Dict[str, Any],
        *,
        local_edit_signals: List[str],
        child_records: List[LegacyInventoryRecord],
    ) -> tuple[str, List[str]]:
        reasons: List[str] = []
        created_via = _normalize_optional_text(payload.get("created_via")).lower()
        content_scope = _normalize_optional_text(payload.get("content_scope")).lower()
        has_source_lineage = _has_source_lineage(payload)
        is_legacy_marker = (
            created_via in LEGACY_CREATED_VIA_MARKERS
            or _normalize_optional_text(payload.get("workspace_copy_kind")).lower() == "imported_copy"
        )

        if not has_source_lineage:
            reasons.append("missing_source_lineage")
        if not is_legacy_marker:
            reasons.append(f"non_legacy_marker:{created_via or 'unknown'}")
        if content_scope and content_scope != "workspace_private":
            reasons.append(f"non_private_scope:{content_scope}")

        child_bucket_counts = _bucket_counts(child_records)
        if child_bucket_counts.get(KEEP_BUCKET):
            reasons.append("contains_descendant_keep_legacy_draft")
        if child_bucket_counts.get(REVIEW_BUCKET):
            reasons.append("contains_descendant_needs_manual_review")

        reasons.extend(sorted(set(local_edit_signals)))
        deduped_reasons = sorted(set(reasons))

        if local_edit_signals or child_bucket_counts.get(KEEP_BUCKET):
            return KEEP_BUCKET, deduped_reasons
        if has_source_lineage and is_legacy_marker and content_scope == "workspace_private" and not child_bucket_counts.get(REVIEW_BUCKET):
            return SAFE_BUCKET, deduped_reasons
        return REVIEW_BUCKET, deduped_reasons
