"""
AppContext - Контекст приложения для передачи плагинам

Предоставляет плагинам доступ к сервисам и информации о приложении
без прямой зависимости от конкретных классов приложения.
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass, field


@dataclass
class AppContext:
    """
    Контекст приложения, передаваемый плагинам при инициализации.
    
    Содержит информацию о типе приложения, доступные сервисы,
    версию ядра и другую информацию, необходимую плагинам.
    """
    app_type: str  # "trainer" или "editor"
    core_version: str  # Версия ядра task_system (например "1.0.0")
    services: Dict[str, Any] = field(default_factory=dict)
    config: Dict[str, Any] = field(default_factory=dict)
    
    def get_service(self, service_name: str) -> Optional[Any]:
        """
        Получить сервис по имени.
        
        Args:
            service_name: Имя сервиса (например "task_evaluator", "storage", "progress")
        
        Returns:
            Сервис или None, если не найден
        """
        return self.services.get(service_name)
    
    def has_service(self, service_name: str) -> bool:
        """
        Проверить наличие сервиса.
        
        Args:
            service_name: Имя сервиса
        
        Returns:
            True, если сервис доступен
        """
        return service_name in self.services
    
    def is_trainer(self) -> bool:
        """Проверить, является ли приложение тренажёром"""
        return self.app_type == "trainer"
    
    def is_editor(self) -> bool:
        """Проверить, является ли приложение редактором"""
        return self.app_type == "editor"





