"""
Парсер для импорта микрокарточек из текстового формата @MICROCARD и @PAIR_MATCH.

Формат v1 (@MICROCARD):
    @MICROCARD
    @ deck: Кардиология / Базовые
    @ tags: кардиология, ритм
    @ difficulty: 2
    # Что такое синусовый ритм?
    = Ритм сердца, при котором импульсы исходят из синусового узла.

Формат v1.1 (@PAIR_MATCH):
    @PAIR_MATCH
    @ deck: Кардиология / Сопоставления
    # Сопоставьте термин и определение
    L: Систола
    L: Диастола
    R: Фаза расслабления миокарда
    R: Фаза сокращения миокарда
    P: Систола => Фаза сокращения миокарда
    P: Диастола => Фаза расслабления миокарда

Правила:
- Каждый блок начинается с @MICROCARD или @PAIR_MATCH
- # — front (одна строка в v1)
- = — back (одна строка в v1, только @MICROCARD)
- @ key: value — metadata (deck, tags, difficulty)
- Metadata действует в рамках одного блока (без наследования)
- @PAIR_MATCH: L:/R: — left/right items, P: — explicit pair links
- @PAIR_MATCH: 2-5 пар, без many-to-many (уникальные left/right)
"""

import re
from typing import List, Dict, Any, Optional, Tuple


# Supported markers
MARKER_MICROCARD = "@MICROCARD"
MARKER_PAIR_MATCH = "@PAIR_MATCH"
ALL_MARKERS = [MARKER_MICROCARD, MARKER_PAIR_MATCH]

# Difficulty mapping: text/number -> normalized string
_DIFFICULTY_MAP = {
    "1": "low", "low": "low", "низкая": "low", "easy": "low",
    "2": "medium", "medium": "medium", "средняя": "medium", "normal": "medium",
    "3": "high", "high": "high", "высокая": "high", "hard": "high",
}


class MicrocardParser:
    """Parser for @MICROCARD text import format."""

    def __init__(self):
        self.errors: List[str] = []
        self.warnings: List[Dict[str, Any]] = []

    def reset(self):
        self.errors = []
        self.warnings = []

    def parse_text(self, text: str) -> Dict[str, Any]:
        """
        Parse text containing @MICROCARD blocks and return preview payload.

        Returns:
            Dict with keys: ok, summary, items, parsing_errors, notes
        """
        self.reset()
        if not text or not isinstance(text, str):
            return self._build_response([], [])

        blocks = self._split_blocks(text)
        items: List[Dict[str, Any]] = []

        for idx, (marker, content, line_num) in enumerate(blocks):
            if marker == MARKER_PAIR_MATCH:
                item = self._parse_pair_match_block(content, idx, line_num)
                items.append(item)
            elif marker == MARKER_MICROCARD:
                item = self._parse_microcard_block(content, idx, line_num)
                items.append(item)

        return self._build_response(items, self.errors)

    def _split_blocks(self, text: str) -> List[Tuple[str, str, int]]:
        """Split text into (marker, content, start_line_number) tuples."""
        lines = text.split("\n")
        blocks: List[Tuple[str, str, int]] = []
        current_marker: Optional[str] = None
        current_lines: List[str] = []
        current_start: int = 0

        for line_num, line in enumerate(lines):
            stripped = line.strip()
            matched_marker = None
            for marker in ALL_MARKERS:
                if stripped == marker or stripped.startswith(marker + " "):
                    matched_marker = marker
                    break

            if matched_marker:
                if current_marker is not None:
                    blocks.append((current_marker, "\n".join(current_lines), current_start))
                current_marker = matched_marker
                current_lines = []
                current_start = line_num + 1  # 1-indexed
            elif current_marker is not None:
                current_lines.append(line)

        if current_marker is not None:
            blocks.append((current_marker, "\n".join(current_lines), current_start))

        return blocks

    def _parse_metadata(self, lines: List[str]) -> Tuple[Dict[str, Any], List[str], List[Dict[str, Any]]]:
        """
        Extract @ key: value metadata from lines.
        Returns (metadata_dict, remaining_lines, warnings_list).
        Implements last-write-wins with warning on duplicate keys.
        """
        metadata: Dict[str, Any] = {}
        remaining: List[str] = []
        warnings: List[Dict[str, Any]] = []
        seen_keys: Dict[str, int] = {}  # key -> count

        for line in lines:
            stripped = line.strip()
            if stripped.startswith("@ ") and ":" in stripped:
                key_val = stripped[2:].split(":", 1)
                key = key_val[0].strip().lower()
                val = key_val[1].strip()

                if key in seen_keys:
                    seen_keys[key] += 1
                    warnings.append({
                        "severity": "warning",
                        "code": "duplicate_metadata_key",
                        "message": f"Повторяющийся ключ метаданных '{key}' (используется последнее значение).",
                    })
                else:
                    seen_keys[key] = 1

                if key == "deck":
                    metadata["deck"] = val
                elif key == "tags":
                    metadata["tags"] = [t.strip() for t in val.split(",") if t.strip()]
                elif key == "difficulty":
                    normalized = _DIFFICULTY_MAP.get(val.strip().lower())
                    if normalized:
                        metadata["difficulty"] = normalized
                    else:
                        warnings.append({
                            "severity": "warning",
                            "code": "unknown_difficulty",
                            "message": f"Неизвестное значение difficulty: '{val}'. Допустимо: 1/2/3, low/medium/high.",
                        })
                else:
                    metadata[key] = val
            else:
                remaining.append(line)

        return metadata, remaining, warnings

    def _parse_microcard_block(self, content: str, index: int, start_line: int) -> Dict[str, Any]:
        """Parse a single @MICROCARD block into a preview item."""
        lines = content.split("\n")
        metadata, remaining, meta_warnings = self._parse_metadata(lines)

        front_text: Optional[str] = None
        back_text: Optional[str] = None
        validation_issues: List[Dict[str, Any]] = list(meta_warnings)

        for line in remaining:
            stripped = line.strip()
            if not stripped or stripped.startswith("//"):
                continue
            if stripped.startswith("#") and front_text is None:
                front_text = stripped[1:].strip()
                continue
            if stripped.startswith("=") and back_text is None:
                back_text = stripped[1:].strip()
                continue

        # Validation
        status = "valid"

        if not front_text:
            validation_issues.append({
                "severity": "error",
                "code": "missing_front",
                "message": f"Блок #{index + 1} (строка {start_line}): отсутствует текст вопроса (строка #).",
                "field": "front",
            })
            status = "error"

        if not back_text:
            validation_issues.append({
                "severity": "error",
                "code": "missing_back",
                "message": f"Блок #{index + 1} (строка {start_line}): отсутствует текст ответа (строка =).",
                "field": "back",
            })
            status = "error"

        if front_text and len(front_text) < 3:
            validation_issues.append({
                "severity": "warning",
                "code": "front_too_short",
                "message": f"Блок #{index + 1}: текст вопроса слишком короткий ({len(front_text)} символов).",
                "field": "front",
            })
            if status == "valid":
                status = "warning"

        if back_text and len(back_text) < 2:
            validation_issues.append({
                "severity": "warning",
                "code": "back_too_short",
                "message": f"Блок #{index + 1}: текст ответа слишком короткий ({len(back_text)} символов).",
                "field": "back",
            })
            if status == "valid":
                status = "warning"

        if front_text and len(front_text) > 500:
            validation_issues.append({
                "severity": "warning",
                "code": "front_too_long",
                "message": f"Блок #{index + 1}: текст вопроса очень длинный ({len(front_text)} символов).",
                "field": "front",
            })
            if status == "valid":
                status = "warning"

        if back_text and len(back_text) > 1000:
            validation_issues.append({
                "severity": "warning",
                "code": "back_too_long",
                "message": f"Блок #{index + 1}: текст ответа очень длинный ({len(back_text)} символов).",
                "field": "back",
            })
            if status == "valid":
                status = "warning"

        # Sanitize
        if front_text:
            front_text = self._sanitize(front_text)
        if back_text:
            back_text = self._sanitize(back_text)

        return {
            "index": index,
            "status": status,
            "card_preview": {
                "card_type": "fact_recall",
                "front": front_text or "",
                "back": back_text or "",
            },
            "metadata": {
                "deck": metadata.get("deck"),
                "tags": metadata.get("tags", []),
                "difficulty": metadata.get("difficulty", "medium"),
            },
            "validation_issues": validation_issues,
            "source_line": start_line,
        }

    def _parse_pair_match_block(self, content: str, index: int, start_line: int) -> Dict[str, Any]:
        """Parse a single @PAIR_MATCH block into a preview item."""
        lines = content.split("\n")
        metadata, remaining, meta_warnings = self._parse_metadata(lines)

        front_text: Optional[str] = None
        left_items: List[str] = []
        right_items: List[str] = []
        pair_links: List[Tuple[str, str]] = []
        validation_issues: List[Dict[str, Any]] = list(meta_warnings)

        for line in remaining:
            stripped = line.strip()
            if not stripped or stripped.startswith("//"):
                continue
            if stripped.startswith("#") and front_text is None:
                front_text = stripped[1:].strip()
                continue
            if stripped.startswith("L:"):
                val = stripped[2:].strip()
                if val:
                    left_items.append(val)
                continue
            if stripped.startswith("R:"):
                val = stripped[2:].strip()
                if val:
                    right_items.append(val)
                continue
            if stripped.startswith("P:"):
                val = stripped[2:].strip()
                if "=>" in val:
                    parts = val.split("=>", 1)
                    l_text = parts[0].strip()
                    r_text = parts[1].strip()
                    if l_text and r_text:
                        pair_links.append((l_text, r_text))
                continue

        # Validation
        status = "valid"

        if not front_text:
            validation_issues.append({
                "severity": "error",
                "code": "missing_front",
                "message": f"Блок #{index + 1} (строка {start_line}): отсутствует текст инструкции (строка #).",
                "field": "front",
            })
            status = "error"

        if not pair_links:
            validation_issues.append({
                "severity": "error",
                "code": "missing_pairs",
                "message": f"Блок #{index + 1} (строка {start_line}): отсутствуют связи пар (строки P:).",
                "field": "pairs",
            })
            status = "error"

        if len(pair_links) < 2:
            validation_issues.append({
                "severity": "error",
                "code": "pair_match_min_2_pairs",
                "message": f"Блок #{index + 1}: требуется минимум 2 пары, найдено {len(pair_links)}.",
                "field": "pairs",
            })
            status = "error"

        if len(pair_links) > 5:
            validation_issues.append({
                "severity": "error",
                "code": "pair_match_max_5_pairs",
                "message": f"Блок #{index + 1}: максимум 5 пар, найдено {len(pair_links)}.",
                "field": "pairs",
            })
            status = "error"

        # Check for duplicate lefts/rights (no many-to-many)
        pair_lefts = [p[0] for p in pair_links]
        pair_rights = [p[1] for p in pair_links]
        if len(set(pair_lefts)) != len(pair_lefts):
            validation_issues.append({
                "severity": "error",
                "code": "pair_match_duplicate_left",
                "message": f"Блок #{index + 1}: обнаружены дублирующиеся левые элементы в парах.",
                "field": "pairs",
            })
            status = "error"
        if len(set(pair_rights)) != len(pair_rights):
            validation_issues.append({
                "severity": "error",
                "code": "pair_match_duplicate_right",
                "message": f"Блок #{index + 1}: обнаружены дублирующиеся правые элементы в парах.",
                "field": "pairs",
            })
            status = "error"

        # Cross-check L:/R: items vs P: links
        if left_items and pair_links:
            p_lefts_set = set(pair_lefts)
            l_set = set(left_items)
            unlinked_l = l_set - p_lefts_set
            if unlinked_l:
                validation_issues.append({
                    "severity": "warning",
                    "code": "unlinked_left_items",
                    "message": f"Блок #{index + 1}: L:-элементы без связи P:: {', '.join(sorted(unlinked_l)[:3])}.",
                    "field": "pairs",
                })
                if status == "valid":
                    status = "warning"
        if right_items and pair_links:
            p_rights_set = set(pair_rights)
            r_set = set(right_items)
            unlinked_r = r_set - p_rights_set
            if unlinked_r:
                validation_issues.append({
                    "severity": "warning",
                    "code": "unlinked_right_items",
                    "message": f"Блок #{index + 1}: R:-элементы без связи P:: {', '.join(sorted(unlinked_r)[:3])}.",
                    "field": "pairs",
                })
                if status == "valid":
                    status = "warning"

        # Sanitize
        if front_text:
            front_text = self._sanitize(front_text)

        pairs_preview = [{"left": self._sanitize(p[0]), "right": self._sanitize(p[1])} for p in pair_links]

        return {
            "index": index,
            "status": status,
            "card_preview": {
                "card_type": "pair_match",
                "front": front_text or "",
                "pairs": pairs_preview,
            },
            "metadata": {
                "deck": metadata.get("deck"),
                "tags": metadata.get("tags", []),
                "difficulty": metadata.get("difficulty", "medium"),
            },
            "validation_issues": validation_issues,
            "source_line": start_line,
        }

    def _build_response(self, items: List[Dict[str, Any]], errors: List[str]) -> Dict[str, Any]:
        """Build the canonical parse response."""
        valid_count = sum(1 for it in items if it["status"] == "valid")
        warning_count = sum(1 for it in items if it["status"] == "warning")
        error_count = sum(1 for it in items if it["status"] == "error")

        fact_recall_count = sum(1 for it in items if it.get("card_preview", {}).get("card_type") == "fact_recall")
        pair_match_count = sum(1 for it in items if it.get("card_preview", {}).get("card_type") == "pair_match")

        notes = [
            "Поддерживаемые маркеры: @MICROCARD, @PAIR_MATCH.",
        ]

        # Add global warnings as notes
        for w in self.warnings:
            if w.get("index") == -1:
                notes.append(w.get("message", ""))

        by_type: Dict[str, int] = {}
        if fact_recall_count:
            by_type["fact_recall"] = fact_recall_count
        if pair_match_count:
            by_type["pair_match"] = pair_match_count

        return {
            "ok": True,
            "summary": {
                "total": len(items),
                "valid": valid_count,
                "warnings": warning_count,
                "errors": error_count,
                "by_type": by_type,
            },
            "items": items,
            "parsing_errors": list(errors),
            "notes": notes,
        }

    @staticmethod
    def _sanitize(text: str) -> str:
        """Remove HTML tags and trim."""
        text = re.sub(r"</?[a-zA-Z][^>]*>", "", text)
        return text.strip()

    @staticmethod
    def build_pair_match_card_data(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Convert a parsed @PAIR_MATCH preview item into card creation data.

        Returns dict with keys: front_text, pairs, tags, difficulty_hint
        or None if item is not a valid pair_match.
        """
        preview = item.get("card_preview") or {}
        if preview.get("card_type") != "pair_match":
            return None
        if item.get("status") == "error":
            return None
        pairs = preview.get("pairs", [])
        if not isinstance(pairs, list) or len(pairs) < 2:
            return None
        meta = item.get("metadata") or {}
        return {
            "front_text": preview.get("front", ""),
            "pairs": pairs,
            "tags": meta.get("tags", []),
            "difficulty_hint": meta.get("difficulty", "medium"),
        }
