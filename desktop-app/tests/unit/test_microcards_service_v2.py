import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service_v2 import MicrocardsServiceV2
from logic.fsrs import Rating, State

def test_fsrs_math_and_transitions():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="test_user")
    
    # 1. Test initial stability and difficulty
    s_again = svc.fsrs.init_stability(Rating.AGAIN)
    s_good = svc.fsrs.init_stability(Rating.GOOD)
    assert s_good > s_again
    
    d_again = svc.fsrs.init_difficulty(Rating.AGAIN)
    d_good = svc.fsrs.init_difficulty(Rating.GOOD)
    assert d_again > d_good  # Again increases difficulty
    
    # 2. Test step transition from NEW
    state_new = {"stability": 0.0, "difficulty": 0.0, "state": int(State.NEW)}
    next_state = svc.fsrs.step(state_new, Rating.GOOD, 0.0)
    assert next_state["state"] == int(State.REVIEW)
    assert next_state["stability"] == s_good
    assert next_state["difficulty"] == d_good
    assert next_state["interval_days"] >= 1

def test_fuzzy_matching_scenarios():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="test_user")
    
    # 1. Exact match
    assert svc.verify_fuzzy_match("Request for Comments", "Request for Comments") is True
    # 2. Case and space mismatch
    assert svc.verify_fuzzy_match("  request for   comments  ", "Request for Comments") is True
    # 3. Punctuation mismatch
    assert svc.verify_fuzzy_match("Request, for Comments!", "Request for Comments") is True
    # 4. Small typos (SequenceMatcher ratio >= 0.82)
    # Target: "Request for Comments" (len = 20)
    # User: "Rquest for Coments" (len = 18)
    assert svc.verify_fuzzy_match("Rquest for Coments", "Request for Comments") is True
    # 5. Big difference
    assert svc.verify_fuzzy_match("RFC docs", "Request for Comments") is False

def test_deck_and_card_crud():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    
    # Create deck
    deck = svc.create_deck(name="Test Deck", description="Desc", tags=["test", "tag"])
    assert deck["id"].startswith("deck_")
    assert deck["name"] == "Test Deck"
    assert "tag" in deck["tags"]
    
    # List decks
    decks = svc.list_decks()
    assert len(decks) == 1
    assert decks[0]["id"] == deck["id"]
    
    # Update deck
    updated = svc.update_deck(deck["id"], name="New Name", tags=["updated"])
    assert updated["name"] == "New Name"
    assert "updated" in updated["tags"]
    
    # Create card
    card = svc.create_card(deck["id"], front_text="Front", back_text="Back", hint="Hint")
    assert card["id"].startswith("mc_")
    assert card["front"]["text"] == "Front"
    assert card["back"]["text"] == "Back"
    assert card["hint"] == "Hint"
    
    # List cards
    cards = svc.list_cards(deck["id"])
    assert len(cards) == 1
    assert cards[0]["id"] == card["id"]
    
    # Update card
    updated_card = svc.update_card(deck["id"], card["id"], front_text="New Front")
    assert updated_card["front"]["text"] == "New Front"
    
    # Delete card
    assert svc.delete_card(deck["id"], card["id"]) is True
    assert len(svc.list_cards(deck["id"])) == 0
    
    # Delete deck
    assert svc.delete_deck(deck["id"]) is True
    assert len(svc.list_decks()) == 0

def test_session_flows_and_progression():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Test Deck")
    
    # Create 5 cards
    card_ids = []
    for i in range(5):
        c = svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")
        card_ids.append(c["id"])
        
    # Start session
    session = svc.start_session(deck["id"])
    assert session["id"].startswith("session_")
    assert len(session["card_queue"]) == 5
    assert session["cursor"] == 0
    
    # Let's study card 0: level 1, answer 'know' -> correct, level 1, consecutive_correct + 1
    card_0_id = session["card_queue"][0]
    res1 = svc.submit_answer(session["id"], card_0_id, "know")
    assert res1["is_correct"] is True
    assert res1["card_state"]["level"] == 1
    assert res1["card_state"]["consecutive_correct"] == 1
    
    # Answer 'know' two more times for card 0 to upgrade it to level 2
    # First we start a new session (to review again or just use same card)
    res2 = svc.submit_answer(session["id"], card_0_id, "know")
    res3 = svc.submit_answer(session["id"], card_0_id, "know")
    assert res3["card_state"]["level"] == 2
    assert res3["card_state"]["consecutive_correct"] == 0
    
    # Now that card 0 is level 2, submitting "know" is not enough, it needs fuzzy matching back text "A0"
    res4 = svc.submit_answer(session["id"], card_0_id, "wrong answer")
    assert res4["is_correct"] is False
    # Rolls back to level 1
    assert res4["card_state"]["level"] == 1
    
    # Test override ("Всё равно правильно")
    res5 = svc.submit_answer(session["id"], card_0_id, "wrong answer", override=True)
    assert res5["is_correct"] is True
    assert res5["card_state"]["level"] == 1
    assert res5["card_state"]["consecutive_correct"] == 1

def test_import_export():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Import Deck")
    
    csv_content = """front,back,hint
"What is RFC?","Request for Comments","Hint 1"
"What is OSI?","Open Systems Interconnection",""
"""
    # Import CSV
    cards = svc.import_csv(deck["id"], csv_content)
    assert len(cards) == 2
    assert cards[0]["front"]["text"] == "What is RFC?"
    assert cards[0]["back"]["text"] == "Request for Comments"
    assert cards[0]["hint"] == "Hint 1"
    
    # Export CSV
    exported_csv = svc.export_csv(deck["id"])
    assert "What is RFC?" in exported_csv
    assert "Open Systems Interconnection" in exported_csv
    
    # Export JSON
    exported_json = svc.export_json(deck["id"])
    assert exported_json["schema"] == "actra_flashcards_v1"
    assert len(exported_json["cards"]) == 2
    
    # Import JSON to new deck
    deck_2 = svc.create_deck(name="Import JSON Deck")
    cards_json = svc.import_json(deck_2["id"], exported_json)
    assert len(cards_json) == 2
    assert cards_json[1]["front"]["text"] == "What is OSI?"


def test_cross_user_deck_isolation():
    """Decks live in a global store but must be scoped to their owner.
    Regression for the IDOR / cross-user leak: a second user sharing the same
    data_dir must not see, read, mutate or delete the first user's decks."""
    shared_dir = tempfile.mkdtemp()
    alice = MicrocardsServiceV2(shared_dir, user_id="alice")
    bob = MicrocardsServiceV2(shared_dir, user_id="bob")

    deck = alice.create_deck(name="Alice Private")
    did = deck["id"]
    alice.create_card(did, front_text="q", back_text="a")

    # Bob cannot see or reach Alice's deck
    assert bob.list_decks() == []
    assert bob.get_deck(did) is None
    assert bob.delete_deck(did) is False

    for fn in (
        lambda: bob.update_deck(did, name="hacked"),
        lambda: bob.list_cards(did),
        lambda: bob.create_card(did, front_text="x", back_text="y"),
    ):
        try:
            fn()
            raise AssertionError("expected LookupError for non-owner access")
        except LookupError:
            pass

    # Alice retains full, untouched access
    assert [d["name"] for d in alice.list_decks()] == ["Alice Private"]
    assert alice.get_deck(did)["name"] == "Alice Private"
    assert alice.delete_deck(did) is True
