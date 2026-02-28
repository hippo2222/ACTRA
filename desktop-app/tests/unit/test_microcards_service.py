import sys
import tempfile
from pathlib import Path


sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service import (  # type: ignore
    MicrocardsService,
    apply_sm2_mvp_rating,
    score_pair_match_response,
)


def test_pair_match_scoring_partial_and_perfect():
    card = {
        "back": {
            "payload": {
                "pairs": [
                    {"left_id": "l1", "right_id": "r2"},
                    {"left_id": "l2", "right_id": "r1"},
                ]
            }
        }
    }
    partial = score_pair_match_response(
        card,
        {"pairs": [{"left_id": "l1", "right_id": "r2"}, {"left_id": "l2", "right_id": "r9"}]},
    )
    assert partial["partial_score"] == 50.0
    assert partial["correct_pairs"] == 1
    assert partial["total_pairs"] == 2
    assert partial["is_perfect"] is False

    perfect = score_pair_match_response(
        card,
        {"mapping": {"l1": "r2", "l2": "r1"}},
    )
    assert perfect["partial_score"] == 100.0
    assert perfect["is_perfect"] is True


def test_sm2_mvp_scheduler_transitions_new_and_review():
    st1 = apply_sm2_mvp_rating(None, "good")
    assert st1["status"] == "review"
    assert st1["interval_days"] >= 1
    assert st1["last_rating"] == "good"

    st2 = apply_sm2_mvp_rating(st1, "again")
    assert st2["status"] in {"learning", "relearning"}
    assert st2["interval_days"] == 0
    assert st2["lapses"] >= 1
    assert st2["last_rating"] == "again"


def test_create_deck_and_submit_review_persists_user_scoped_state():
    local_tmp_root = Path.cwd() / ".pytest_tmp_p9_microcards"
    local_tmp_root.mkdir(parents=True, exist_ok=True)
    tmp_path = Path(tempfile.mkdtemp(prefix="mcsvc_", dir=str(local_tmp_root)))
    svc_a = MicrocardsService(str(tmp_path), user_id="user_a")
    analysis = {
        "target_language": "ru",
        "educational_units": [
            {"id": 1, "title": "Термин A", "description": "Определение A", "chunk_ids": ["chunk_1"]},
            {"id": 2, "title": "Термин B", "description": "Определение B", "chunk_ids": ["chunk_1"]},
        ],
        "learning_chunks": [{"id": "chunk_1", "title": "Chunk 1", "unit_ids": [1, 2]}],
        "future_capabilities": [{"capability_id": "pair_matching", "covers_chunk_ids": ["chunk_1"]}],
        "microcards_candidates": [
            {"candidate_id": "c1", "unit_id": 1, "chunk_id": "chunk_1", "card_type": "fact_recall", "prompt_seed": "A?", "answer_seed": "A"},
            {"candidate_id": "c2", "unit_id": 1, "chunk_id": "chunk_1", "card_type": "pair_match", "prompt_seed": "Термин A", "answer_seed": "Определение A"},
            {"candidate_id": "c3", "unit_id": 2, "chunk_id": "chunk_1", "card_type": "pair_match", "prompt_seed": "Термин B", "answer_seed": "Определение B"},
        ],
    }
    deck = svc_a.create_deck_from_analysis(analysis, ai_run_id="ai_run_test_123456", selector={"scope": "all"})
    assert deck["id"].startswith("deck_")
    assert len(deck["cards"]) >= 2

    queue_a = svc_a.get_due_queue(deck["id"])
    assert queue_a["queue"]
    first_card = next(c for c in queue_a["queue"] if c["card_type"] != "pair_match")
    submit = svc_a.submit_review(deck_id=deck["id"], card_id=first_card["id"], rating="good")
    assert submit["review_state"]["user_id"] == "user_a"

    svc_b = MicrocardsService(str(tmp_path), user_id="user_b")
    queue_b = svc_b.get_due_queue(deck["id"])
    assert len(queue_b["queue"]) >= len(queue_a["queue"]) - 1
    states_a = (tmp_path / "users" / "user_a" / "microcards" / "review_states.json").read_text(encoding="utf-8")
    states_b_path = tmp_path / "users" / "user_b" / "microcards" / "review_states.json"
    assert "user_a" in states_a
    assert states_b_path.exists() is False or "user_b" in states_b_path.read_text(encoding="utf-8")
