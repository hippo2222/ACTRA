import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service_v2 import MicrocardsServiceV2, _read_json, _write_json
from logic.fsrs import Rating, State


def _write_raw_settings(svc, payload):
    """Persist a raw settings file (simulates legacy/stored settings).
    Study settings are no longer user-editable via the service, so tests drive
    get_settings() — which still clamps/sanitizes — through the file directly."""
    _write_json(svc._settings_path, payload)

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
    """Mastery cycle: a missed card is re-queued until answered correctly,
    first-try stats drive the summary, FSRS fires once per card per session."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Test Deck")

    for i in range(3):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    session = svc.start_session(deck["id"], level_mode=1)
    assert session["id"].startswith("session_")
    assert session["cursor"] == 0
    assert session["stats"]["unique_total"] == 3
    q = list(session["card_queue"])

    # Card 0: correct on the first try → mastered immediately.
    res1 = svc.submit_answer(session["id"], q[0], "know")
    assert res1["is_correct"] is True
    assert res1["first_attempt"] is True
    assert res1["is_retry"] is False
    assert res1["session"]["stats"]["mastered"] == 1
    assert res1["session"]["stats"]["first_try_correct"] == 1

    # Card 1: wrong → re-queued; the session cannot complete without it.
    res2 = svc.submit_answer(session["id"], q[1], "dont_know")
    assert res2["is_correct"] is False
    s = res2["session"]
    assert s["card_queue"].count(q[1]) == 2  # original + re-queued copy
    assert s["stats"]["pending_retry"] == 1
    assert s["stats"]["errors"] == 1
    assert s["first_results"][q[1]] is False

    # Card 2 correct — still not complete, the retry is pending.
    res3 = svc.submit_answer(session["id"], q[2], "know")
    assert res3["session"]["completed"] is False

    # The re-queued copy of card 1 comes back and is closed correctly.
    res4 = svc.submit_answer(session["id"], q[1], "know")
    assert res4["is_retry"] is True
    s = res4["session"]
    assert s["completed"] is True
    assert s["stats"]["mastered"] == 3
    assert s["stats"]["first_try_correct"] == 2  # card 1 missed its first try
    assert s["stats"]["pending_retry"] == 0

    # Finishing the completed run computes stars server-side (2/3 first try →
    # 67% → 3 stars), persists the record and opens the L2 gate.
    fin = svc.finish_session(session["id"], session_xp=240, max_combo=2)
    assert fin["mode"] == "run"
    assert fin["accuracy"] == 67
    assert fin["stars"] == 3
    assert fin["is_new_record"] is True
    assert fin["l2_unlocked"] is True
    rec = svc.get_deck_record(deck["id"])
    assert rec["scoreL1"] == 240
    assert rec["starsL1"] == 3
    assert rec["sizeL1"] == 3
    assert rec["l2_unlocked"] is True

    # finish is idempotent.
    fin2 = svc.finish_session(session["id"], session_xp=999)
    assert fin2 == fin

    # FSRS/event history: exactly one review per card — the retry didn't double it.
    events = _read_json(svc._events_path, [])
    assert len(events) == 3
    assert sum(1 for e in events if e["card_id"] == q[1]) == 1


def _complete_l1_run(svc, deck_id):
    """Helper: finish a full L1 run so the L2 gate opens."""
    session = svc.start_session(deck_id, mode="run", level_mode=1, restart=True)
    for cid in list(session["card_queue"]):
        svc.submit_answer(session["id"], cid, "know")
    svc.finish_session(session["id"], session_xp=100)


def test_l2_override_corrects_previous_wrong():
    """Override undoes the wrong verdict: error stats, the first-try result and
    the re-queued copy are all rolled back; a duplicate override is a no-op."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Override Deck")
    svc.create_card(deck["id"], front_text="Q0", back_text="A0")
    svc.create_card(deck["id"], front_text="Q1", back_text="A1")
    _complete_l1_run(svc, deck["id"])

    session = svc.start_session(deck["id"], level_mode=2)
    q = list(session["card_queue"])

    res_wrong = svc.submit_answer(session["id"], q[0], "blatantly wrong")
    assert res_wrong["is_correct"] is False
    assert res_wrong["session"]["card_queue"].count(q[0]) == 2

    res_fix = svc.submit_answer(session["id"], q[0], "blatantly wrong", override=True)
    assert res_fix["is_correct"] is True
    s = res_fix["session"]
    assert s["card_queue"].count(q[0]) == 1  # re-queued copy withdrawn
    assert s["stats"]["errors"] == 0
    assert s["stats"]["pending_retry"] == 0
    assert s["first_results"][q[0]] is True  # first-try result restored
    correct_after_fix = s["stats"]["correct"]

    # Duplicate override (double click) must not double-count anything.
    res_dup = svc.submit_answer(session["id"], q[0], "x", override=True)
    assert res_dup["session"]["stats"]["correct"] == correct_after_fix


def test_run_gate_unlocks_l2():
    """L2 unlocks by COMPLETING a full L1 run (finish_session) — answering all
    cards alone is not enough, and starting an L2 run while locked fails.
    Adding cards later does not re-lock the honestly earned gate."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Gate Deck")
    for i in range(2):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    rec = svc.get_deck_record(deck["id"])
    assert rec["l2_unlocked"] is False

    # L2 run is locked before any completed L1 run.
    try:
        svc.start_session(deck["id"], mode="run", level_mode=2)
        raise AssertionError("expected level2_locked")
    except ValueError as exc:
        assert "level2_locked" in str(exc)

    session = svc.start_session(deck["id"], mode="run", level_mode=1)
    for cid in list(session["card_queue"]):
        svc.submit_answer(session["id"], cid, "know")
    # All cards answered, but the gate opens only on finish.
    assert svc.get_deck_record(deck["id"])["l2_unlocked"] is False
    svc.finish_session(session["id"], session_xp=200)

    rec = svc.get_deck_record(deck["id"])
    assert rec["l1_run_completed"] is True
    assert rec["l2_unlocked"] is True

    decks = svc.list_decks()
    assert decks[0]["l2_unlocked"] is True

    # Adding a card does NOT retroactively close the gate (the run was honest);
    # new star attempts simply cover the bigger deck.
    svc.create_card(deck["id"], front_text="new", back_text="card")
    rec = svc.get_deck_record(deck["id"])
    assert rec["l2_unlocked"] is True

    # And the L2 run now starts fine.
    l2 = svc.start_session(deck["id"], mode="run", level_mode=2)
    assert l2["level_mode"] == 2
    assert len(l2["card_queue"]) == 3  # whole (grown) deck


def test_run_checkpoint_abandon_rolls_back_to_pause():
    """Pause = checkpoint. 'Exit without saving' loses only the current
    sitting; a run that was never paused is discarded outright."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Checkpoint Deck")
    for i in range(3):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    run = svc.start_session(deck["id"], mode="run", level_mode=1)
    q = list(run["card_queue"])

    # Sitting 1: one card mastered, then pause (checkpoint).
    svc.submit_answer(run["id"], q[0], "know")
    svc.pause_session(run["id"], combo=1, max_combo=1, session_xp=100)

    # Sitting 2: another card mastered... then exit WITHOUT saving.
    resumed = svc.start_session(deck["id"], mode="run", level_mode=1)
    assert resumed["id"] == run["id"]
    svc.submit_answer(run["id"], q[1], "know")
    res = svc.abandon_session(run["id"])
    assert res["restored"] is True
    rolled = res["session"]
    assert rolled["paused"] is True
    assert rolled["completed"] is False
    assert rolled["stats"]["mastered"] == 1      # sitting 2 is gone
    assert rolled["session_xp"] == 100           # checkpointed XP
    assert q[1] not in rolled["mastered_ids"]

    # The rolled-back run resumes and completes normally.
    resumed2 = svc.start_session(deck["id"], mode="run", level_mode=1)
    assert resumed2["id"] == run["id"]
    for cid in (q[1], q[2]):
        svc.submit_answer(run["id"], cid, "know")
    fin = svc.finish_session(run["id"], session_xp=300)
    assert fin["stars"] == 5  # every card first-try within the saved history

    # A never-paused run abandons into a discard (no checkpoint to restore).
    run2 = svc.start_session(deck["id"], mode="run", level_mode=1, restart=True)
    svc.submit_answer(run2["id"], run2["card_queue"][0], "know")
    res2 = svc.abandon_session(run2["id"])
    assert res2["restored"] is False
    assert res2["session"]["discarded"] is True
    assert svc._get_active_session_for_deck(deck["id"], "run_l1") is None


def test_review_composition_and_adaptive_forms():
    """Review sessions say what they picked (due/new) and check strong cards
    (mastery level 2) with typed input — but only after the L2 gate opened."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Review Deck")
    cards = [svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}") for i in range(3)]

    # Fresh deck, gate locked: everything is new and self-graded (form 1).
    review = svc.start_session(deck["id"], mode="review")
    assert review["mode"] == "review"
    assert review["level_mode"] is None
    assert review["composition"] == {"due": 0, "new": 3}
    assert all(f == 1 for f in review["card_forms"].values())
    res = svc.submit_answer(review["id"], review["card_queue"][0], "know")
    assert res["form"] == 1 and res["is_correct"] is True
    svc.abandon_session(review["id"])

    # Open the gate and make one card "strong" (mastery level 2).
    _complete_l1_run(svc, deck["id"])
    states = svc._read_states()
    states[cards[0]["id"]]["level"] = 2
    svc._write_states(states)

    review2 = svc.start_session(deck["id"], mode="review", restart=True)
    forms = review2["card_forms"]
    assert forms[cards[0]["id"]] == 2          # strong card → typed input
    assert forms[cards[1]["id"]] == 1

    # Answer in queue order: the typed card is graded by fuzzy matching,
    # the others by know/dont_know.
    typed_result = None
    for cid in list(review2["card_queue"]):
        if cid == cards[0]["id"]:
            typed_result = svc.submit_answer(review2["id"], cid, "A0")
        else:
            svc.submit_answer(review2["id"], cid, "know")
    assert typed_result["form"] == 2 and typed_result["is_correct"] is True

    # Reviews never write records, even when finished.
    fin = svc.finish_session(review2["id"], session_xp=500)
    assert fin["mode"] == "review"
    assert "record" not in fin
    rec = svc.get_deck_record(deck["id"])
    assert rec["scoreL1"] == 100  # still the L1 run's record, untouched


def test_run_and_review_slots_coexist():
    """A paused run must not block the daily review (separate active slots)."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Slots Deck")
    for i in range(2):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    run = svc.start_session(deck["id"], mode="run", level_mode=1)
    svc.pause_session(run["id"])
    review = svc.start_session(deck["id"], mode="review")
    assert review["id"] != run["id"]

    actives = svc._get_active_sessions_for_deck(deck["id"])
    assert set(actives.keys()) == {"run_l1", "review"}
    assert actives["run_l1"]["id"] == run["id"]
    assert actives["review"]["id"] == review["id"]

    # Resuming the run later still finds it.
    resumed = svc.start_session(deck["id"], mode="run", level_mode=1)
    assert resumed["id"] == run["id"]


def test_legacy_records_are_wiped():
    """Pre-run (schema 1.0) records are discarded on first read — the agreed
    one-time reset when the run model shipped."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    _write_json(svc._records_path, {
        "schema_version": "1.0",
        "user_id": "test_user",
        "items": {"deck_x": {"scoreL1": 999, "starsL1": 5}},
    })
    assert svc.get_all_records() == {}
    rec = svc.get_deck_record("deck_x")
    assert rec["scoreL1"] == 0
    assert rec["l2_unlocked"] is False

def test_import_export():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Import Deck")
    
    csv_content = """front,back,hint
"What is RFC?","Request for Comments","Hint 1"
"What is OSI?","Open Systems Interconnection",""
"""
    # Import CSV
    cards = svc.import_csv(deck["id"], csv_content)["items"]
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
    cards_json = svc.import_json(deck_2["id"], exported_json)["items"]
    assert len(cards_json) == 2
    assert cards_json[1]["front"]["text"] == "What is OSI?"


def test_new_import_formats():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Import Deck")
    
    # 1. Test full TXT (@MICROCARD/@PAIR_MATCH)
    txt_full_content = """@MICROCARD
# Q1
= A1
@ tags: tag1
@ difficulty: 1

@PAIR_MATCH
# Pair Question
L: L1
L: L2
R: R1
R: R2
P: L1 => R1
P: L2 => R2
"""
    cards_full = svc.import_txt_full(deck["id"], txt_full_content)["items"]
    # 1 fact recall + 2 pair matches = 3 cards total
    assert len(cards_full) == 3
    assert cards_full[0]["front"]["text"] == "Q1"
    assert cards_full[0]["back"]["text"] == "A1"
    assert cards_full[1]["front"]["text"] == "L1"
    assert cards_full[1]["back"]["text"] == "R1"
    assert cards_full[2]["front"]["text"] == "L2"
    assert cards_full[2]["back"]["text"] == "R2"
    
    # 2. Test Simplified TXT (fresh deck so cross-format dedup doesn't drop rows)
    deck_simplified = svc.create_deck(name="Simplified Deck")
    simplified_content = """
    Q1 - A1
    Q2 => A2
    Q3; A3
    Q4: A4
    """
    cards_simplified = svc.import_txt_simplified(deck_simplified["id"], simplified_content)["items"]
    assert len(cards_simplified) == 4
    assert cards_simplified[0]["front"]["text"] == "Q1"
    assert cards_simplified[0]["back"]["text"] == "A1"
    assert cards_simplified[1]["front"]["text"] == "Q2"
    assert cards_simplified[1]["back"]["text"] == "A2"
    assert cards_simplified[2]["front"]["text"] == "Q3"
    assert cards_simplified[2]["back"]["text"] == "A3"
    assert cards_simplified[3]["front"]["text"] == "Q4"
    assert cards_simplified[3]["back"]["text"] == "A4"
    
    # 3. Test Test format
    test_content = """? Test Q1
    + Correct Answer
    - Incorrect Answer 1
    - Incorrect Answer 2
    """
    cards_test = svc.import_test(deck["id"], test_content)["items"]
    assert len(cards_test) == 1
    assert cards_test[0]["front"]["text"] == "Test Q1"
    assert cards_test[0]["back"]["text"] == "Correct Answer"


def test_export_txt_roundtrip():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Export Deck")
    svc.create_card(deck["id"], front_text="Q1", back_text="A1")
    svc.create_card(deck["id"], front_text="Q2", back_text="A2")

    txt = svc.export_txt(deck["id"])
    assert txt == "Q1\tA1\nQ2\tA2\n"

    # Round-trips through the simplified TXT import (tab separator).
    deck2 = svc.create_deck(name="Reimported")
    cards = svc.import_txt_simplified(deck2["id"], txt, options={"qa_separator": "tab"})["items"]
    assert len(cards) == 2
    assert cards[0]["front"]["text"] == "Q1"
    assert cards[0]["back"]["text"] == "A1"


def test_import_dedup():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Dedup Deck")

    content = "Q1 - A1\nQ2 - A2\nQ1 - A1 (duplicate front)\n"
    res = svc.import_txt_simplified(deck["id"], content)
    assert len(res["items"]) == 2
    assert res["skipped_duplicates"] == 1

    # Re-importing the same content into the same deck skips everything.
    res2 = svc.import_txt_simplified(deck["id"], content)
    assert len(res2["items"]) == 0
    assert res2["skipped_duplicates"] == 3

    # dedup=False keeps duplicates.
    res3 = svc.import_txt_simplified(deck["id"], content, dedup=False)
    assert len(res3["items"]) == 3


def test_import_test_multi_correct():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Multi Correct Deck")

    content = """? Which are prime?
+ 2
+ 3
- 4
"""
    cards = svc.import_test(deck["id"], content)["items"]
    assert len(cards) == 1
    assert cards[0]["back"]["text"] == "2"
    assert cards[0]["acceptable_answers"] == ["3"]


def test_import_test_messy_bank_is_lenient():
    # A real-world test bank often has malformed lines: a question without the
    # leading '?', B./C. option markers, stray separators. Import must skip those
    # gracefully and still create the valid cards (not raise / 500).
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Messy Bank")

    content = "\n".join([
        "?Q1 good",
        "+A1",
        "-w",
        "Q2 question without leading question-mark",   # malformed → skipped
        "+ignored",
        "?Q3 good",
        "+A3",
        "B. option-style answer",                       # malformed → skipped
        "--",                                            # stray separator
        "?Q4 good",
        "+A4",
    ]) + "\n"

    cards = svc.import_test(deck["id"], content)["items"]
    fronts = [c["front"]["text"] for c in cards]
    assert "Q1 good" in fronts and "Q3 good" in fronts and "Q4 good" in fronts
    assert all("without leading" not in f for f in fronts)
    assert len(cards) >= 3


def test_import_test_mytestx_hash_format():
    # MyTestX text export: '#' question marker + '@ image' lines. Auto-detect must
    # recognize it as a test bank; '@' image references are skipped (no file).
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="MyTestX Deck")

    content = (
        "#Сколько цветов у радуги?\n"
        "@ радуга.jpg\n"
        "+ 7\n"
        "- 10\n"
        "\n"
        "#Кто друг Гены?\n"
        "+ Чебурашка\n"
        "- Шапокляк\n"
    )
    assert svc._detect_format(content) == "test"
    cards = svc.import_test(deck["id"], content)["items"]
    fronts = [c["front"]["text"] for c in cards]
    assert "Сколько цветов у радуги?" in fronts
    assert "Кто друг Гены?" in fronts
    assert any(c["back"]["text"] == "7" for c in cards)
    # image filename must not leak into a card
    assert all("радуга" not in c["back"]["text"] for c in cards)


def test_deck_author_fields():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="u1")
    own = svc.create_deck(name="Own")
    assert own["author_name"] is None  # own deck → UI shows "Вы"
    imported = svc.create_deck(name="Imported", catalog_item_id="cat_x",
                               author_name="Alice Tester", author_user_id="user_alice")
    assert imported["author_name"] == "Alice Tester"
    # list_decks surfaces the author for the byline
    rows = {d["name"]: d for d in svc.list_decks()}
    assert rows["Imported"]["author_name"] == "Alice Tester"
    assert rows["Own"]["author_name"] is None


def test_update_deck_catalog_fields():
    # Publish denormalizes visibility/access_code onto the deck (and the publish
    # route relies on update_deck accepting catalog_item_id — was a 500 before).
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Pub")
    assert deck["catalog_item_id"] is None
    assert svc.get_deck(deck["id"]).get("catalog_visibility") is None

    up = svc.update_deck(deck["id"], catalog_item_id="cat_1",
                         catalog_visibility="access_code", access_code="ABCDEF12")
    assert up["catalog_item_id"] == "cat_1"
    assert up["catalog_visibility"] == "access_code"
    assert up["access_code"] == "ABCDEF12"

    cleared = svc.update_deck(deck["id"], catalog_visibility="public", access_code="")
    assert cleared["catalog_visibility"] == "public"
    assert cleared["access_code"] is None
    # editing name must not disturb catalog fields
    renamed = svc.update_deck(deck["id"], name="New")
    assert renamed["name"] == "New" and renamed["catalog_item_id"] == "cat_1"


def test_import_test_custom_markers():
    # Variant A: adapt the parser to an unusual file via custom markers, no code change.
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Custom Markers")

    content = "* Capital of France?\n= Paris\n~ Lyon\n* 2+2?\n= 4\n~ 3\n"
    # default markers don't recognize * = ~ → no cards
    assert len(svc.import_test(deck["id"], content)["items"]) == 0
    # custom markers unlock it
    deck2 = svc.create_deck(name="Custom Markers 2")
    opts = {"markers": {"question": "*", "correct": "=", "wrong": "~"}}
    cards = svc.import_test(deck2["id"], content, options=opts)["items"]
    assert [c["front"]["text"] for c in cards] == ["Capital of France?", "2+2?"]
    assert cards[0]["back"]["text"] == "Paris"


def test_import_auto_multiline_decision():
    # multiline:"auto" — ON for a tab hierarchy (Quizlet tree), OFF for a flat list.
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")

    quizlet = "Виды\tНапряжения\nВазоспастическая\nНестабильная\nСтатины\tЛовастатин\nСимвастатин\n"
    rows = svc._parse_txt_simplified(quizlet, {"separator": "auto", "multiline": "auto"})
    ok = [r for r in rows if r["status"] == "ok"]
    assert len(ok) == 2  # tab-less lines merged into the previous card
    assert ok[0]["back"] == "Напряжения\nВазоспастическая\nНестабильная"

    flat = "Cor - сердце\nHepar - печень\nRen - почка\n"
    rows2 = svc._parse_txt_simplified(flat, {"separator": "auto", "multiline": "auto"})
    ok2 = [r for r in rows2 if r["status"] == "ok"]
    assert len(ok2) == 3  # each line is its own card, no merging

    # "separator" alias is honored (manual): pipe splits without auto.
    rows3 = svc._parse_txt_simplified("A | 1\nB | 2\n", {"separator": " | "})
    assert [r["front"] for r in rows3 if r["status"] == "ok"] == ["A", "B"]


def test_import_simplified_separator_options():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Sep Deck")

    # Pipe is not in the auto cascade, so a custom separator is required.
    content = "Term1 | Def1\nTerm2 | Def2\n"
    cards = svc.import_txt_simplified(deck["id"], content, options={"qa_separator": " | "})["items"]
    assert len(cards) == 2
    assert cards[0]["front"]["text"] == "Term1"
    assert cards[0]["back"]["text"] == "Def1"

    # Blank-line blocks: first line front, rest back.
    deck2 = svc.create_deck(name="Block Deck")
    block = "Question one\nLine A of answer\nLine B of answer\n\nQuestion two\nAnswer two\n"
    blk_cards = svc.import_txt_simplified(deck2["id"], block, options={"card_separator": "blank"})["items"]
    assert len(blk_cards) == 2
    assert blk_cards[0]["front"]["text"] == "Question one"
    assert blk_cards[0]["back"]["text"] == "Line A of answer\nLine B of answer"


def test_import_quizlet_multiline():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Quizlet Deck")

    # Quizlet TAB export where definitions span several tab-less lines.
    content = (
        "Виды стенокардии\tНапряжения\n"
        "Вазоспастическая\n"
        "Нестабильная\n"
        "Статины\tЛовастатин\n"
        "Симвастатин\n"
    )
    opts = {"qa_separator": "tab", "multiline": True}
    cards = svc.import_txt_simplified(deck["id"], content, options=opts)["items"]
    assert len(cards) == 2
    assert cards[0]["front"]["text"] == "Виды стенокардии"
    assert cards[0]["back"]["text"] == "Напряжения\nВазоспастическая\nНестабильная"
    assert cards[1]["front"]["text"] == "Статины"
    assert cards[1]["back"]["text"] == "Ловастатин\nСимвастатин"

    # Without multiline the tab-less lines are flagged as errors (no silent merge).
    res = svc.analyze_import(deck["id"], "txt_simplified", content, options={"qa_separator": "tab"})
    assert res["counts"]["errors"] == 3

    # Auto mode locks onto the dominant separator (tab) so a definition containing
    # " - " is treated as a continuation, not split on the dash.
    deck2 = svc.create_deck(name="Quizlet Auto Deck")
    auto_content = (
        "Никотиновая к-та\tНиацин\n"
        "Пролонг форма - Эндурацин\n"
        "Статины\tЛовастатин\n"
    )
    auto_cards = svc.import_txt_simplified(deck2["id"], auto_content, options={"multiline": True})["items"]
    assert len(auto_cards) == 2
    assert auto_cards[0]["front"]["text"] == "Никотиновая к-та"
    assert auto_cards[0]["back"]["text"] == "Ниацин\nПролонг форма - Эндурацин"


def test_analyze_import_preview():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Analyze Deck")
    svc.create_card(deck["id"], front_text="Existing", back_text="Card")

    content = "Existing - dup\nFresh - new\nBrokenLineNoSeparator\n"
    result = svc.analyze_import(deck["id"], "txt_simplified", content)
    counts = result["counts"]
    assert counts["total"] == 3
    assert counts["ok"] == 1
    assert counts["duplicates"] == 1
    assert counts["errors"] == 1
    # No cards were written by a dry-run.
    assert len(svc.list_cards(deck["id"])) == 1


def test_analytics_aggregation():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Analytics Deck")
    for i in range(3):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    # Empty history → panel-empty shape.
    empty = svc.get_analytics()
    assert empty["total_reviews"] == 0
    assert empty["streak"] == 0
    assert len(empty["heatmap"]) == 84
    assert len(empty["forecast"]) == 7

    # Generate some review events.
    session = svc.start_session(deck["id"])
    for cid in session["card_queue"]:
        svc.submit_answer(session["id"], cid, "know")

    data = svc.get_analytics()
    assert data["total_reviews"] == 3
    assert data["reviews_today"] == 3
    assert data["streak"] == 1
    assert data["retention"] == 100.0
    assert any(d["deck_id"] == deck["id"] for d in data["deck_mastery"])


def test_list_cards_with_state_buckets():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Progress Deck")
    for i in range(3):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    # Fresh deck: every card is "new".
    cards = svc.list_cards_with_state(deck["id"])
    assert all(c["is_new"] and c["progress"] == "new" for c in cards)

    # Study one card once → it becomes "learning" (has state, level 1).
    session = svc.start_session(deck["id"], restart=True)
    first = session["card_queue"][0]
    svc.submit_answer(session["id"], first, "know")

    cards = {c["id"]: c for c in svc.list_cards_with_state(deck["id"])}
    assert cards[first]["progress"] == "learning"
    assert cards[first]["is_new"] is False
    others = [c for cid, c in cards.items() if cid != first]
    assert all(c["progress"] == "new" for c in others)


def test_analytics_ignores_orphaned_states():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Temp Deck")
    for i in range(2):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    # Study both cards (creates states + events), then delete the deck.
    session = svc.start_session(deck["id"], restart=True)
    for cid in session["card_queue"]:
        svc.submit_answer(session["id"], cid, "know")
    svc.delete_deck(deck["id"])

    # A fresh deck with untouched cards must show zero overdue / reviews —
    # the deleted deck's leftover states must not leak into analytics.
    deck2 = svc.create_deck(name="Fresh Deck")
    svc.create_card(deck2["id"], front_text="New", back_text="Card")

    data = svc.get_analytics()
    assert data["overdue"] == 0
    assert data["total_reviews"] == 0
    assert data["streak"] == 0


def test_settings_clamp_and_persist():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    assert svc.get_settings()["session_size"] == 20

    _write_raw_settings(svc, {"session_size": 999, "new_per_session": -5,
                              "default_direction": "bogus"})
    s = svc.get_settings()
    assert s["session_size"] == 100          # clamped to max
    assert s["new_per_session"] == 0         # clamped to min
    assert "fuzzy_threshold" not in s        # not a user-facing setting
    assert s["default_direction"] == "front_back"  # invalid → default

    _write_raw_settings(svc, {"session_size": 7, "default_direction": "back_front"})
    s2 = svc.get_settings()
    assert s2["session_size"] == 7
    assert s2["default_direction"] == "back_front"


def test_session_size_setting():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Sized Deck")
    for i in range(10):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    _write_raw_settings(svc, {"session_size": 4})
    session = svc.start_session(deck["id"], restart=True)
    assert len(session["card_queue"]) == 4


def test_fuzzy_and_acceptable_answers():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")

    # Token-set tolerance: word order should not matter.
    assert svc.verify_fuzzy_match("blue light", "light blue") is True
    # Acceptable alternatives.
    assert svc.verify_answer_against_card("H2O", "water", ["H2O", "aqua"]) is True
    assert svc.verify_answer_against_card("fire", "water", ["H2O"]) is False


def test_reverse_direction_session():
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Reverse Deck")
    card = svc.create_card(deck["id"], front_text="apple", back_text="яблоко")
    svc.create_card(deck["id"], front_text="dog", back_text="собака")  # keeps session open
    _complete_l1_run(svc, deck["id"])

    # Open-answer (L2) run: the run level decides the grading.
    session = svc.start_session(deck["id"], restart=True, direction="back_front", level_mode=2)
    assert session["card_directions"][card["id"]] == "back_front"

    # In reverse mode the expected answer is the FRONT text.
    res = svc.submit_answer(session["id"], card["id"], "apple")
    assert res["is_correct"] is True
    assert res["expected_answer"] == "apple"
    assert res["direction"] == "back_front"


def test_cross_user_deck_isolation():
    """Decks live in a global store but must be scoped to their owner (IDOR regression)."""
    shared_dir = tempfile.mkdtemp()
    alice = MicrocardsServiceV2(shared_dir, user_id="alice")
    bob = MicrocardsServiceV2(shared_dir, user_id="bob")
    deck = alice.create_deck(name="Alice Private")
    did = deck["id"]
    alice.create_card(did, front_text="q", back_text="a")
    assert bob.list_decks() == []
    assert bob.get_deck(did) is None
    assert bob.delete_deck(did) is False
    for fn in (
        lambda: bob.update_deck(did, name="hacked"),
        lambda: bob.list_cards(did),
        lambda: bob.create_card(did, front_text="x", back_text="y"),
    ):
        try:
            fn(); raise AssertionError("expected LookupError for non-owner access")
        except LookupError:
            pass
    assert [d["name"] for d in alice.list_decks()] == ["Alice Private"]
    assert alice.delete_deck(did) is True


class _FakeCatalog:
    """Minimal catalog stub mirroring add_item_to_library's contract."""

    def __init__(self, snapshot=None, *, error=None):
        self._snapshot = snapshot or {}
        self._error = error
        self.calls = []

    def add_item_to_library(self, item_id, requested_by_user_id=None, access_code=None):
        self.calls.append((item_id, requested_by_user_id, access_code))
        if self._error:
            raise ValueError(self._error)
        return {"item": {"id": item_id}, "snapshot": self._snapshot}


def _linked_snapshot():
    return {
        "name": "Catalog Latin",
        "description": "anatomy",
        "tags": ["latin"],
        "cards": [
            {"id": "mc_a", "front": {"text": "os"}, "back": {"text": "bone"}},
            {"id": "mc_b", "front": {"text": "cor"}, "back": {"text": "heart"}},
        ],
    }


def test_delete_card_scrubs_active_session():
    """Deleting a card while a session is paused must not leave a ghost id
    in the queue (resuming would 404 on answer)."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Scrub Deck")
    for i in range(3):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    session = svc.start_session(deck["id"], level_mode=1)
    q = list(session["card_queue"])
    svc.submit_answer(session["id"], q[0], "know")
    svc.pause_session(session["id"])

    # Delete an unanswered card.
    assert svc.delete_card(deck["id"], q[1]) is True

    resumed = svc.start_session(deck["id"], level_mode=1)
    assert resumed["id"] == session["id"]
    assert q[1] not in resumed["card_queue"]
    assert resumed["stats"]["unique_total"] == 2
    assert resumed["stats"]["mastered"] == 1
    # The session is still answerable to completion.
    res = svc.submit_answer(resumed["id"], q[2], "know")
    assert res["session"]["completed"] is True


def test_resume_scrubs_cards_deleted_behind_sessions_back():
    """Edits that bypass delete_card (other tab, linked refresh) are healed
    when the session is resumed."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Ghost Deck")
    for i in range(2):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    session = svc.start_session(deck["id"], level_mode=1)
    q = list(session["card_queue"])

    # Remove a card by rewriting the deck file directly (no scrub hook).
    raw = _read_json(svc._deck_path(deck["id"]), None)
    raw["cards"] = [c for c in raw["cards"] if c["id"] != q[0]]
    _write_json(svc._deck_path(deck["id"]), raw)

    resumed = svc.start_session(deck["id"], level_mode=1)
    assert resumed["id"] == session["id"]
    assert q[0] not in resumed["card_queue"]
    assert resumed["stats"]["unique_total"] == 1


def test_submit_answer_heals_missing_card():
    """Answering a card that was deleted mid-session returns card_missing and
    a healed session instead of failing the run with a 404."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Heal Deck")
    for i in range(2):
        svc.create_card(deck["id"], front_text=f"Q{i}", back_text=f"A{i}")

    session = svc.start_session(deck["id"], level_mode=1)
    q = list(session["card_queue"])

    # Card vanishes between render and answer.
    raw = _read_json(svc._deck_path(deck["id"]), None)
    raw["cards"] = [c for c in raw["cards"] if c["id"] != q[0]]
    _write_json(svc._deck_path(deck["id"]), raw)

    res = svc.submit_answer(session["id"], q[0], "know")
    assert res.get("card_missing") is True
    healed = res["session"]
    assert q[0] not in healed["card_queue"]
    assert healed["stats"]["unique_total"] == 1
    # The remaining card still completes the session normally.
    res2 = svc.submit_answer(session["id"], q[1], "know")
    assert res2["session"]["completed"] is True


def test_scrub_to_empty_queue_completes_and_new_session_starts():
    """If every remaining card is deleted, the old session closes out and a
    fresh one is created on the next start."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="test_user")
    deck = svc.create_deck(name="Empty Deck")
    card = svc.create_card(deck["id"], front_text="Q", back_text="A")
    extra = svc.create_card(deck["id"], front_text="Q2", back_text="A2")

    session = svc.start_session(deck["id"], level_mode=1)
    svc.pause_session(session["id"])
    svc.delete_card(deck["id"], card["id"])
    svc.delete_card(deck["id"], extra["id"])

    # Both cards gone -> old session was completed by the scrub.
    svc.create_card(deck["id"], front_text="Q3", back_text="A3")
    fresh = svc.start_session(deck["id"], level_mode=1)
    assert fresh["id"] != session["id"]
    assert fresh["stats"]["unique_total"] == 1


def test_reimport_dedup_preserves_card_ids():
    """Author-side guarantee for linked progress: re-importing the same content
    keeps existing card ids (dedup skips, never re-creates)."""
    tmp = tempfile.mkdtemp()
    svc = MicrocardsServiceV2(tmp, user_id="author")
    deck = svc.create_deck(name="Reimport Deck")
    csv = "front,back\nos,bone\ncor,heart\n"
    svc.import_csv(deck["id"], csv)
    ids_before = [c["id"] for c in svc.list_cards(deck["id"])]

    result = svc.import_csv(deck["id"], csv)
    assert result["items"] == []
    assert result["skipped_duplicates"] == 2
    ids_after = [c["id"] for c in svc.list_cards(deck["id"])]
    assert ids_after == ids_before


def test_linked_deck_resolves_readonly_from_catalog():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    cat = _FakeCatalog(_linked_snapshot())
    svc.catalog_service = cat

    deck = svc.create_linked_deck("catalog_item_1", _linked_snapshot(),
                                  author_name="Teacher", author_user_id="teacher_1")
    assert deck["linked"] is True
    # No content copied — cards resolved live on read.
    assert deck.get("cards") in ([], None)

    resolved = svc.get_deck(deck["id"])
    assert resolved["read_only"] is True
    assert resolved["access_state"] == "granted"
    assert len(resolved["cards"]) == 2
    assert resolved["card_count"] == 2
    assert cat.calls and cat.calls[0][0] == "catalog_item_1"


def test_linked_deck_republish_migrates_progress_by_content():
    """When the author republishes with re-created card ids, the subscriber's
    review states (FSRS schedule, l1_mastered → L2 gate) follow the content
    instead of silently orphaning."""
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    cat = _FakeCatalog(_linked_snapshot())
    svc.catalog_service = cat
    deck = svc.create_linked_deck("catalog_item_1", _linked_snapshot())
    did = deck["id"]

    # Learner completes a full L1 run → gate opens, states written.
    session = svc.start_session(did, level_mode=1)
    for cid in list(session["card_queue"]):
        svc.submit_answer(session["id"], cid, "know")
    svc.finish_session(session["id"], session_xp=100)
    rec = svc.get_deck_record(did)
    assert rec["l1_progress"]["complete"] is True
    assert rec["l2_unlocked"] is True
    states_before = svc._read_states()
    assert states_before["mc_a"]["l1_mastered"] is True
    stability_before = states_before["mc_a"]["stability"]

    # Author re-creates the cards: same content, brand-new ids.
    cat._snapshot = {
        "name": "Catalog Latin",
        "cards": [
            {"id": "mc_a2", "front": {"text": "os"}, "back": {"text": "bone"}},
            {"id": "mc_b2", "front": {"text": "cor"}, "back": {"text": "heart"}},
        ],
    }
    resolved = svc.get_deck(did)
    assert [c["id"] for c in resolved["cards"]] == ["mc_a2", "mc_b2"]

    states = svc._read_states()
    assert "mc_a" not in states and "mc_b" not in states
    assert states["mc_a2"]["l1_mastered"] is True
    assert states["mc_a2"]["stability"] == stability_before
    assert states["mc_a2"]["card_id"] == "mc_a2"

    # The L2 gate survives the republish.
    rec_after = svc.get_deck_record(did)
    assert rec_after["l1_progress"]["complete"] is True
    assert rec_after["l2_unlocked"] is True


def test_linked_deck_republish_edited_card_resets_only_that_card():
    """A card whose content AND id changed cannot be matched — it honestly
    resets, while untouched cards keep their progress."""
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    cat = _FakeCatalog(_linked_snapshot())
    svc.catalog_service = cat
    deck = svc.create_linked_deck("catalog_item_1", _linked_snapshot())
    did = deck["id"]

    session = svc.start_session(did, level_mode=1)
    for cid in list(session["card_queue"]):
        svc.submit_answer(session["id"], cid, "know")

    cat._snapshot = {
        "name": "Catalog Latin",
        "cards": [
            # mc_a re-created with the same content → migrates.
            {"id": "mc_a2", "front": {"text": "os"}, "back": {"text": "bone"}},
            # mc_b re-created with REWRITTEN content → honest reset.
            {"id": "mc_b2", "front": {"text": "pulmo"}, "back": {"text": "lung"}},
        ],
    }
    svc.get_deck(did)

    states = svc._read_states()
    assert states["mc_a2"]["l1_mastered"] is True
    assert "mc_b2" not in states            # fresh card, no inherited state
    assert "mc_a" not in states             # migrated away
    rec = svc.get_deck_record(did)
    assert rec["l1_progress"] == {"mastered": 1, "total": 2, "complete": False}


def test_linked_deck_blocks_content_mutations():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    svc.catalog_service = _FakeCatalog(_linked_snapshot())
    deck = svc.create_linked_deck("catalog_item_1", _linked_snapshot())
    did = deck["id"]

    for fn in (
        lambda: svc.update_deck(did, name="hacked"),
        lambda: svc.create_card(did, front_text="x", back_text="y"),
        lambda: svc.update_card(did, "mc_a", front_text="x"),
        lambda: svc.delete_card(did, "mc_a"),
    ):
        try:
            fn(); raise AssertionError("expected ValueError(deck_is_linked_readonly)")
        except ValueError as exc:
            assert "deck_is_linked_readonly" in str(exc)


def test_linked_deck_access_states():
    snap = _linked_snapshot()
    # requires access code
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    svc.catalog_service = _FakeCatalog(snap, error="access_code_required")
    d = svc.create_linked_deck("c1", snap)
    assert svc.get_deck(d["id"])["access_state"] == "requires_access_code"

    # revoked / removed from catalog
    svc2 = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    svc2.catalog_service = _FakeCatalog(snap, error="item_not_found")
    d2 = svc2.create_linked_deck("c1", snap)
    assert svc2.get_deck(d2["id"])["access_state"] == "revoked"


def test_linked_deck_listed_and_findable():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    svc.catalog_service = _FakeCatalog(_linked_snapshot())
    deck = svc.create_linked_deck("catalog_item_42", _linked_snapshot())

    summaries = svc.list_decks()
    assert len(summaries) == 1
    assert summaries[0]["linked"] is True
    assert summaries[0]["read_only"] is True

    found = svc.find_deck_by_catalog_item_id("catalog_item_42")
    assert found is not None and found["id"] == deck["id"]


def test_auto_new_limit_throttles_with_backlog():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    # Caught up → full ceiling; growing backlog → fewer new; heavy backlog → none.
    assert svc._auto_new_limit(0, 20) == 20
    assert svc._auto_new_limit(4, 20) == 20
    assert svc._auto_new_limit(5, 20) == 15
    assert svc._auto_new_limit(15, 20) == 10
    assert svc._auto_new_limit(30, 20) == 5
    assert svc._auto_new_limit(50, 20) == 0
    # Monotonic non-increasing as backlog grows.
    vals = [svc._auto_new_limit(d, 20) for d in range(0, 60, 5)]
    assert all(a >= b for a, b in zip(vals, vals[1:]))
    # Never exceeds the ceiling; empty ceiling falls back to a sane default.
    assert svc._auto_new_limit(0, 3) == 3
    assert svc._auto_new_limit(0, 0) == 10


def test_settings_new_per_session_mode_sanitized():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    assert svc.get_settings()["new_per_session_mode"] == "auto"  # universal default
    _write_raw_settings(svc, {"new_per_session_mode": "manual"})
    assert svc.get_settings()["new_per_session_mode"] == "manual"
    _write_raw_settings(svc, {"new_per_session_mode": "nonsense"})
    assert svc.get_settings()["new_per_session_mode"] == "auto"  # invalid → default


def test_card_image_attribution_stored_and_preserved():
    svc = MicrocardsServiceV2(tempfile.mkdtemp(), user_id="learner")
    deck = svc.create_deck(name="Imgs")
    did = deck["id"]
    attr = {"author": "Jane", "license": "BY-SA 4.0",
            "source_page": "https://commons.wikimedia.org/wiki/File:X", "junk": "drop me"}
    card = svc.create_card(did, front_text="q", back_text="a",
                           front_image_url="/api/assets/asset_1/content",
                           front_image_attribution=attr)
    stored = card["front"]["image_attribution"]
    assert stored["author"] == "Jane" and stored["license"] == "BY-SA 4.0"
    assert "junk" not in stored  # only known fields kept
    assert card["back"]["image_attribution"] is None

    # Updating only the text must NOT wipe the existing attribution (_UNSET).
    svc.update_card(did, card["id"], front_text="q2")
    refreshed = next(c for c in svc.list_cards(did) if c["id"] == card["id"])
    assert refreshed["front"]["image_attribution"]["author"] == "Jane"

    # Explicitly clearing the image clears attribution too.
    svc.update_card(did, card["id"], front_image_url=None, front_image_attribution=None)
    refreshed2 = next(c for c in svc.list_cards(did) if c["id"] == card["id"])
    assert refreshed2["front"]["image_attribution"] is None
