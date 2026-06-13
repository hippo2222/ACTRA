"""Concurrency guard for MicrocardsServiceV2.

The storage layer does a full-document read-modify-write (deck docs plus the
per-user states / sessions / records docs), so two concurrent writers for the
SAME user — e.g. two browser tabs or two devices — could clobber each other
(last-write-wins). The service serializes its mutators with a process-global
per-user reentrant lock; these tests reproduce the race with real threads and
assert nothing is lost. The hosted runtime serves on a single process
(waitress thread pool), so an in-process lock is the right (and sufficient)
guard — which is exactly what threads here exercise.
"""

import sys
import tempfile
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from services.microcards_service_v2 import MicrocardsServiceV2


def test_concurrent_create_card_no_lost_writes():
    """Several tabs adding cards at once each do get_deck → append → put_deck_doc.
    Without serialization the interleaved writes lose cards; with the per-user
    lock every card survives."""
    tmp = tempfile.mkdtemp()
    setup = MicrocardsServiceV2(tmp, user_id="racer")
    did = setup.create_deck(name="Race Deck")["id"]

    n = 8
    barrier = threading.Barrier(n)
    errors = []

    def worker(i):
        # A fresh service per thread mirrors the per-request instances the
        # route layer builds; they share the process-global lock by user id.
        svc = MicrocardsServiceV2(tmp, user_id="racer")
        barrier.wait()  # release all threads together for maximum overlap
        try:
            svc.create_card(did, front_text=f"Q{i}", back_text=f"A{i}")
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    cards = setup.list_cards(did)
    assert len(cards) == n
    assert len({c["id"] for c in cards}) == n


def test_concurrent_finish_sessions_no_lost_records():
    """Runs finished in parallel all write into the SAME per-user records / states
    / sessions docs. Without serialization some records vanish; with the lock
    every deck's record persists."""
    tmp = tempfile.mkdtemp()
    setup = MicrocardsServiceV2(tmp, user_id="racer")
    deck_ids = []
    for d in range(8):
        deck = setup.create_deck(name=f"D{d}")
        setup.create_card(deck["id"], front_text="Q", back_text="A")
        deck_ids.append(deck["id"])

    barrier = threading.Barrier(len(deck_ids))
    errors = []

    def worker(did):
        svc = MicrocardsServiceV2(tmp, user_id="racer")
        barrier.wait()
        try:
            sess = svc.start_session(did, mode="run", level_mode=1)
            for cid in list(sess["card_queue"]):
                svc.submit_answer(sess["id"], cid, "know")
            svc.finish_session(sess["id"])
        except Exception as exc:  # pragma: no cover
            errors.append(exc)

    threads = [threading.Thread(target=worker, args=(did,)) for did in deck_ids]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert not errors, errors
    records = setup.get_all_records()
    assert set(records) == set(deck_ids)
    assert all(records[did]["cumulative_sw"] > 0 for did in deck_ids)
