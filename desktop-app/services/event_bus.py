"""
Event Bus - Simple pub/sub system for service communication.

Allows services to communicate without tight coupling.
Supports event-driven architecture for cache invalidation and other cross-service notifications.
"""
from typing import Dict, List, Callable, Any
from collections import defaultdict
import logging

logger = logging.getLogger(__name__)


class EventBus:
    """Simple event bus for decoupled service communication.
    
    Usage:
        # Create event bus
        event_bus = EventBus()
        
        # Subscribe to events
        def on_progress_update(user_id: str):
            print(f"Progress updated for {user_id}")
        
        event_bus.subscribe('progress_updated', on_progress_update)
        
        # Publish events
        event_bus.publish('progress_updated', user_id='user_123')
    """
    
    def __init__(self):
        """Initialize event bus with empty subscriber registry."""
        self._subscribers: Dict[str, List[Callable]] = defaultdict(list)
    
    def subscribe(self, event_type: str, callback: Callable) -> None:
        """Subscribe to an event type.
        
        Args:
            event_type: Name of the event (e.g., 'progress_updated')
            callback: Function to call when event is published.
                     Must accept **kwargs matching the event data.
        
        Example:
            def handler(user_id: str):
                print(f"User {user_id} updated")
            
            event_bus.subscribe('progress_updated', handler)
        """
        self._subscribers[event_type].append(callback)
        logger.debug(f"Subscribed to event '{event_type}': {callback.__name__}")
    
    def publish(self, event_type: str, **data: Any) -> None:
        """Publish an event to all subscribers.
        
        Args:
            event_type: Name of the event
            **data: Event data to pass to subscribers
        
        Note:
            If a subscriber raises an exception, it will be logged but won't
            prevent other subscribers from being notified.
        
        Example:
            event_bus.publish('progress_updated', user_id='user_123', task_ref='module/topic/task')
        """
        subscribers = self._subscribers.get(event_type, [])
        logger.debug(f"Publishing event '{event_type}' to {len(subscribers)} subscribers")
        
        for callback in subscribers:
            try:
                callback(**data)
            except Exception as e:
                logger.error(
                    f"Error in event subscriber {callback.__name__} for event '{event_type}': {e}",
                    exc_info=True
                )
    
    def unsubscribe(self, event_type: str, callback: Callable) -> bool:
        """Unsubscribe from an event type.
        
        Args:
            event_type: Name of the event
            callback: The callback function to remove
        
        Returns:
            bool: True if callback was found and removed, False otherwise
        """
        if event_type in self._subscribers:
            try:
                self._subscribers[event_type].remove(callback)
                logger.debug(f"Unsubscribed from event '{event_type}': {callback.__name__}")
                return True
            except ValueError:
                return False
        return False
    
    def clear_subscribers(self, event_type: str = None) -> None:
        """Clear all subscribers for an event type, or all events.
        
        Args:
            event_type: Event type to clear. If None, clears all events.
        """
        if event_type:
            self._subscribers[event_type].clear()
            logger.debug(f"Cleared all subscribers for event '{event_type}'")
        else:
            self._subscribers.clear()
            logger.debug("Cleared all event subscribers")
