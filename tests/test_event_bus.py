"""
Unit tests for EventBus — coverage plan.

Covers:
- subscribe / publish / unsubscribe / clear_subscribers
- Multiple subscribers
- Error handling in subscribers
- Event data passing
"""

import sys
import os
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "desktop-app"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.event_bus import EventBus


class TestEventBus:
    def test_subscribe_and_publish(self):
        bus = EventBus()
        received = []
        bus.subscribe("test", lambda **kw: received.append(kw))
        bus.publish("test", key="value")
        assert len(received) == 1
        assert received[0]["key"] == "value"

    def test_multiple_subscribers(self):
        bus = EventBus()
        r1, r2 = [], []
        bus.subscribe("evt", lambda **kw: r1.append(1))
        bus.subscribe("evt", lambda **kw: r2.append(1))
        bus.publish("evt")
        assert len(r1) == 1
        assert len(r2) == 1

    def test_publish_no_subscribers(self):
        bus = EventBus()
        bus.publish("no_one_listening")  # should not raise

    def test_subscriber_error_does_not_block_others(self):
        bus = EventBus()
        received = []

        def bad(**kw):
            raise RuntimeError("fail")

        def good(**kw):
            received.append(1)

        bus.subscribe("evt", bad)
        bus.subscribe("evt", good)
        bus.publish("evt")
        assert len(received) == 1

    def test_unsubscribe(self):
        bus = EventBus()
        received = []
        handler = lambda **kw: received.append(1)
        bus.subscribe("evt", handler)
        assert bus.unsubscribe("evt", handler) is True
        bus.publish("evt")
        assert len(received) == 0

    def test_unsubscribe_not_found(self):
        bus = EventBus()
        assert bus.unsubscribe("evt", lambda **kw: None) is False

    def test_unsubscribe_wrong_event(self):
        bus = EventBus()
        handler = lambda **kw: None
        bus.subscribe("evt1", handler)
        assert bus.unsubscribe("evt2", handler) is False

    def test_clear_specific_event(self):
        bus = EventBus()
        received = []
        bus.subscribe("evt1", lambda **kw: received.append(1))
        bus.subscribe("evt2", lambda **kw: received.append(2))
        bus.clear_subscribers("evt1")
        bus.publish("evt1")
        bus.publish("evt2")
        assert received == [2]

    def test_clear_all(self):
        bus = EventBus()
        received = []
        bus.subscribe("evt1", lambda **kw: received.append(1))
        bus.subscribe("evt2", lambda **kw: received.append(2))
        bus.clear_subscribers()
        bus.publish("evt1")
        bus.publish("evt2")
        assert received == []
