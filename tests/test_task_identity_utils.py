import sys
from pathlib import Path
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
DESKTOP_APP_DIR = ROOT_DIR / "desktop-app"
if str(DESKTOP_APP_DIR) not in sys.path:
    sys.path.insert(0, str(DESKTOP_APP_DIR))

from services.task_identity_utils import (
    strip_task_copy_suffix,
    detect_copy_word,
    generate_duplicate_task_identity,
)


class TestTaskIdentityUtils:
    def test_strip_task_copy_suffix_basic(self):
        base_id, base_name, word = strip_task_copy_suffix("heart_anatomy", "Анатомия сердца")
        assert base_id == "heart_anatomy"
        assert base_name == "Анатомия сердца"
        assert word is None

    def test_strip_task_copy_suffix_with_copy_number(self):
        base_id, base_name, word = strip_task_copy_suffix("heart_anatomy_copy1", "Анатомия сердца (копия 1)")
        assert base_id == "heart_anatomy"
        assert base_name == "Анатомия сердца"
        assert word == "копия"

    def test_strip_task_copy_suffix_english(self):
        base_id, base_name, word = strip_task_copy_suffix("ecg_lead_copy5", "ECG Lead (Copy 5)")
        assert base_id == "ecg_lead"
        assert base_name == "ECG Lead"
        assert word == "Copy"

    def test_strip_task_copy_suffix_ukrainian(self):
        base_id, base_name, word = strip_task_copy_suffix("cardio_copy2", "Кардіограма (копія 2)")
        assert base_id == "cardio"
        assert base_name == "Кардіограма"
        assert word == "копія"

    def test_detect_copy_word(self):
        assert detect_copy_word("Анатомия сердца") == "копия"
        assert detect_copy_word("Кардіологія") == "копія"
        assert detect_copy_word("Cardiac anatomy") == "copy"
        assert detect_copy_word("", fallback_word="копія") == "копія"

    def test_generate_duplicate_task_identity_first_copy(self):
        existing_ids = ["heart_anatomy", "lung_anatomy"]
        existing_names = ["Анатомия сердца", "Анатомия легких"]

        new_id, new_name = generate_duplicate_task_identity(
            existing_ids, existing_names, "heart_anatomy", "Анатомия сердца"
        )
        assert new_id == "heart_anatomy_copy1"
        assert new_name == "Анатомия сердца (копия 1)"

    def test_generate_duplicate_task_identity_second_copy_from_copy(self):
        existing_ids = ["heart_anatomy", "heart_anatomy_copy1"]
        existing_names = ["Анатомия сердца", "Анатомия сердца (копия 1)"]

        # When duplicating heart_anatomy_copy1, it should produce copy2, NOT copy1_copy1
        new_id, new_name = generate_duplicate_task_identity(
            existing_ids, existing_names, "heart_anatomy_copy1", "Анатомия сердца (копия 1)"
        )
        assert new_id == "heart_anatomy_copy2"
        assert new_name == "Анатомия сердца (копия 2)"

    def test_generate_duplicate_task_identity_gap_in_numbers(self):
        # copy1 and copy3 exist, copy2 was deleted
        existing_ids = ["heart_anatomy", "heart_anatomy_copy1", "heart_anatomy_copy3"]
        existing_names = ["Анатомия сердца", "Анатомия сердца (копия 1)", "Анатомия сердца (копия 3)"]

        new_id, new_name = generate_duplicate_task_identity(
            existing_ids, existing_names, "heart_anatomy", "Анатомия сердца"
        )
        assert new_id == "heart_anatomy_copy4"
        assert new_name == "Анатомия сердца (копия 4)"

    def test_generate_duplicate_task_identity_english(self):
        existing_ids = ["ecg_task"]
        existing_names = ["ECG Analysis"]

        new_id, new_name = generate_duplicate_task_identity(
            existing_ids, existing_names, "ecg_task", "ECG Analysis"
        )
        assert new_id == "ecg_task_copy1"
        assert new_name == "ECG Analysis (copy 1)"

    def test_generate_duplicate_task_identity_empty_name(self):
        existing_ids = ["task_alpha"]
        existing_names = []

        new_id, new_name = generate_duplicate_task_identity(
            existing_ids, existing_names, "task_alpha", None
        )
        assert new_id == "task_alpha_copy1"
        assert new_name == "task_alpha (copy 1)"
