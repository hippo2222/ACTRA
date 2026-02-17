"""
Unit tests for EventBus.

Tests the pub/sub functionality, error handling, and subscriber management.
"""
import pytest
from services.event_bus import EventBus


class TestEventBus:
    """Test suite for EventBus class."""
    
    def test_subscribe_and_publish(self):
        """Test basic pub/sub functionality."""
        event_bus = EventBus()
        
        # Track callback invocations
        callback_data = []
        
        def handler(user_id: str):
            callback_data.append(user_id)
        
        # Subscribe and publish
        event_bus.subscribe('test_event', handler)
        event_bus.publish('test_event', user_id='user_123')
        
        # Verify callback was invoked
        assert len(callback_data) == 1
        assert callback_data[0] == 'user_123'
    
    def test_multiple_subscribers(self):
        """Test multiple subscribers to same event."""
        event_bus = EventBus()
        
        # Track which handlers were called
        handler1_called = []
        handler2_called = []
        
        def handler1(value: int):
            handler1_called.append(value)
        
        def handler2(value: int):
            handler2_called.append(value * 2)
        
        # Subscribe both handlers
        event_bus.subscribe('test_event', handler1)
        event_bus.subscribe('test_event', handler2)
        
        # Publish event
        event_bus.publish('test_event', value=10)
        
        # Verify both handlers were called
        assert handler1_called == [10]
        assert handler2_called == [20]
    
    def test_error_handling(self):
        """Test that subscriber errors don't break other subscribers."""
        event_bus = EventBus()
        
        # Track successful handler
        successful_handler_called = []
        
        def failing_handler(**kwargs):
            raise ValueError("Intentional error")
        
        def successful_handler(value: str):
            successful_handler_called.append(value)
        
        # Subscribe both handlers
        event_bus.subscribe('test_event', failing_handler)
        event_bus.subscribe('test_event', successful_handler)
        
        # Publish event - should not raise exception
        event_bus.publish('test_event', value='test')
        
        # Verify successful handler was still called
        assert successful_handler_called == ['test']
    
    def test_publish_without_subscribers(self):
        """Test publishing to event with no subscribers."""
        event_bus = EventBus()
        
        # Should not raise exception
        event_bus.publish('nonexistent_event', data='test')
    
    def test_unsubscribe(self):
        """Test unsubscribing from events."""
        event_bus = EventBus()
        
        callback_count = []
        
        def handler(**kwargs):
            callback_count.append(1)
        
        # Subscribe and publish
        event_bus.subscribe('test_event', handler)
        event_bus.publish('test_event')
        assert len(callback_count) == 1
        
        # Unsubscribe and publish again
        result = event_bus.unsubscribe('test_event', handler)
        assert result is True
        event_bus.publish('test_event')
        
        # Callback should not be called again
        assert len(callback_count) == 1
    
    def test_unsubscribe_nonexistent(self):
        """Test unsubscribing a callback that was never subscribed."""
        event_bus = EventBus()
        
        def handler(**kwargs):
            pass
        
        result = event_bus.unsubscribe('test_event', handler)
        assert result is False
    
    def test_clear_subscribers_specific_event(self):
        """Test clearing subscribers for specific event."""
        event_bus = EventBus()
        
        callback_count = []
        
        def handler(**kwargs):
            callback_count.append(1)
        
        # Subscribe to two different events
        event_bus.subscribe('event1', handler)
        event_bus.subscribe('event2', handler)
        
        # Clear event1 subscribers
        event_bus.clear_subscribers('event1')
        
        # Publish both events
        event_bus.publish('event1')
        event_bus.publish('event2')
        
        # Only event2 handler should be called
        assert len(callback_count) == 1
    
    def test_clear_all_subscribers(self):
        """Test clearing all subscribers."""
        event_bus = EventBus()
        
        callback_count = []
        
        def handler(**kwargs):
            callback_count.append(1)
        
        # Subscribe to multiple events
        event_bus.subscribe('event1', handler)
        event_bus.subscribe('event2', handler)
        
        # Clear all subscribers
        event_bus.clear_subscribers()
        
        # Publish events
        event_bus.publish('event1')
        event_bus.publish('event2')
        
        # No handlers should be called
        assert len(callback_count) == 0
    
    def test_multiple_events(self):
        """Test subscribing to different events."""
        event_bus = EventBus()
        
        event1_data = []
        event2_data = []
        
        def handler1(value: str):
            event1_data.append(value)
        
        def handler2(value: int):
            event2_data.append(value)
        
        # Subscribe to different events
        event_bus.subscribe('event1', handler1)
        event_bus.subscribe('event2', handler2)
        
        # Publish to both events
        event_bus.publish('event1', value='test')
        event_bus.publish('event2', value=42)
        
        # Verify correct handlers were called
        assert event1_data == ['test']
        assert event2_data == [42]
    
    def test_event_data_passing(self):
        """Test that event data is correctly passed to handlers."""
        event_bus = EventBus()
        
        received_data = {}
        
        def handler(user_id: str, task_ref: str, success: bool):
            received_data['user_id'] = user_id
            received_data['task_ref'] = task_ref
            received_data['success'] = success
        
        event_bus.subscribe('progress_updated', handler)
        event_bus.publish(
            'progress_updated',
            user_id='user_123',
            task_ref='module/topic/task',
            success=True
        )
        
        assert received_data == {
            'user_id': 'user_123',
            'task_ref': 'module/topic/task',
            'success': True
        }
