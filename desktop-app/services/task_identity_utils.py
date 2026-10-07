"""Utilities for task identity, slug generation, and copy numbering."""

import re
from typing import Iterable, Optional, Tuple


_COPY_ID_PATTERN = re.compile(r"^(?P<base>.+?)_copy(?:\d+)?$", re.IGNORECASE)
_COPY_NAME_PATTERN = re.compile(
    r"^(?P<base>.*?)(?:\s*\((?P<word>копия|copy|копія)\s*(?P<num>\d*)\))?\s*$",
    re.IGNORECASE,
)
_UKRAINIAN_CHARS_PATTERN = re.compile(r"[іїєґІЇЄҐ]")
_CYRILLIC_CHARS_PATTERN = re.compile(r"[\u0400-\u04FF]")


def strip_task_copy_suffix(
    task_id: str,
    task_name: Optional[str] = None,
) -> Tuple[str, str, Optional[str]]:
    """
    Strip '_copyN' and '(копия N)' suffixes from task ID and name.

    Returns:
        (base_id, base_name, detected_copy_word)
    """
    clean_id = str(task_id or "").strip()
    id_match = _COPY_ID_PATTERN.match(clean_id)
    base_id = id_match.group("base").strip() if id_match else clean_id

    clean_name = str(task_name or "").strip() if task_name is not None else ""
    detected_word: Optional[str] = None

    if clean_name:
        name_match = _COPY_NAME_PATTERN.match(clean_name)
        if name_match and name_match.group("word"):
            base_name = name_match.group("base").strip()
            detected_word = name_match.group("word")
        else:
            base_name = clean_name
    else:
        base_name = base_id

    return base_id, base_name, detected_word


def detect_copy_word(text: str, fallback_word: Optional[str] = None) -> str:
    """
    Determine the appropriate copy word ('копия', 'копія', or 'copy').
    """
    if fallback_word:
        clean_fallback = str(fallback_word).strip().lower()
        if clean_fallback in {"копия", "копія", "copy"}:
            return clean_fallback

    probe = str(text or "")
    if _UKRAINIAN_CHARS_PATTERN.search(probe):
        return "копія"
    if _CYRILLIC_CHARS_PATTERN.search(probe):
        return "копия"
    return "copy"


def generate_duplicate_task_identity(
    existing_task_ids: Iterable[str],
    existing_task_names: Iterable[str],
    source_id: str,
    source_name: Optional[str] = None,
) -> Tuple[str, str]:
    """
    Generate next unique task ID and display name with incremental copy index (_copyN / (копия N)).

    Examples:
        ('heart_anatomy', 'Анатомия сердца') -> ('heart_anatomy_copy1', 'Анатомия сердца (копия 1)')
        ('heart_anatomy_copy1', 'Анатомия сердца (копия 1)') -> ('heart_anatomy_copy2', 'Анатомия сердца (копия 2)')

    Returns:
        (new_task_id, new_task_name)
    """
    base_id, base_name, detected_word = strip_task_copy_suffix(source_id, source_name)
    copy_word = detect_copy_word(source_name or base_name, fallback_word=detected_word)

    existing_ids_set = {str(item).strip() for item in (existing_task_ids or []) if item}
    existing_names_set = {str(item).strip() for item in (existing_task_names or []) if item}

    id_regex = re.compile(rf"^{re.escape(base_id)}(?:_copy(?P<num>\d+))?$", re.IGNORECASE)
    name_regex = re.compile(
        rf"^{re.escape(base_name)}(?:\s*\((?:копия|copy|копія)\s*(?P<num>\d*)\))?$",
        re.IGNORECASE,
    )

    found_numbers = []

    for existing_id in existing_ids_set:
        m = id_regex.match(existing_id)
        if m:
            num_str = m.group("num")
            found_numbers.append(int(num_str) if num_str else 0)

    for existing_name in existing_names_set:
        m = name_regex.match(existing_name)
        if m:
            num_str = m.group("num")
            found_numbers.append(int(num_str) if num_str else (1 if "(" in existing_name else 0))

    if found_numbers:
        candidate_n = max(1, max(found_numbers) + 1)
    else:
        candidate_n = 1

    # Guarantee uniqueness against any existing collisions
    while True:
        candidate_id = f"{base_id}_copy{candidate_n}"
        candidate_name = f"{base_name} ({copy_word} {candidate_n})"
        if candidate_id not in existing_ids_set and candidate_name not in existing_names_set:
            return candidate_id, candidate_name
        candidate_n += 1
