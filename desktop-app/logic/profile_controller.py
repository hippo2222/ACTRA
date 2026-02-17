"""
Profile Controller - Управление профилями пользователей.

Координирует работу сервисов для:
- Выбора профиля пользователя
- Создания новых профилей
- Получения статистики профиля

ФАЗА 1: Профили пользователей и расширенная статистика
"""

import sys
from pathlib import Path
from typing import Optional, Dict, Any
import logging

# Добавляем пути для импорта
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Импортируем сервисы
from services.user_service import UserService, User
from services.statistics_service import StatisticsService


class ProfileController:
    """
    Контроллер для управления профилями пользователей.
    
    Координирует работу сервисов:
    - UserService - управление профилями (создание, получение)
    - StatisticsService - агрегация статистики
    
    Использование:
        controller = ProfileController(user_service, statistics_service)
        
        # Выбор профиля
        controller.select_profile("user_123")
        
        # Создание нового профиля
        user = controller.create_new_profile("Иван Иванов")
        
        # Получение статистики
        stats = controller.get_profile_statistics("user_123")
    """
    
    def __init__(self, 
                 user_service: UserService,
                 statistics_service: StatisticsService):
        """
        Инициализация ProfileController.
        
        Args:
            user_service: Сервис для управления профилями
            statistics_service: Сервис для агрегации статистики
        """
        self.user_service = user_service
        self.statistics_service = statistics_service
        self.logger = logging.getLogger(self.__class__.__name__)
    
    # =========================================================================
    # ВЫБОР ПРОФИЛЯ
    # =========================================================================
    
    def select_profile(self, user_id: str) -> Optional[User]:
        """
        Выбирает профиль пользователя по ID.
        
        Args:
            user_id: ID пользователя
        
        Returns:
            User: Профиль пользователя или None, если не найден
        
        Example:
            >>> user = controller.select_profile("user_123")
            >>> if user:
            ...     print(f"Выбран профиль: {user.name}")
        """
        if not user_id:
            self.logger.warning("Attempted to select profile with empty user_id")
            return None
        
        try:
            user = self.user_service.get_user(user_id)
            
            if user:
                self.logger.info(f"Selected profile: {user_id} ({user.name})")
            else:
                self.logger.warning(f"Profile not found: {user_id}")
            
            return user
            
        except Exception as e:
            self.logger.error(f"Error selecting profile {user_id}: {e}")
            return None
    
    # =========================================================================
    # СОЗДАНИЕ ПРОФИЛЯ
    # =========================================================================
    
    def create_new_profile(self, name: str) -> User:
        """
        Создает новый профиль пользователя.
        
        Args:
            name: Имя пользователя
        
        Returns:
            User: Созданный профиль пользователя
        
        Raises:
            ValueError: Если имя пустое или некорректное
            TaskValidationError: Если данные не прошли валидацию
        
        Example:
            >>> user = controller.create_new_profile("Иван Иванов")
            >>> print(f"Создан профиль: {user.user_id}")
        """
        if not name or not name.strip():
            self.logger.error("Attempted to create profile with empty name")
            raise ValueError("Имя пользователя не может быть пустым")
        
        try:
            user = self.user_service.create_user(
                name=name.strip()
            )
            
            self.logger.info(f"Created new profile: {user.user_id} ({user.name})")
            
            return user
            
        except ValueError as e:
            self.logger.error(f"Validation error creating profile: {e}")
            raise
        except Exception as e:
            self.logger.error(f"Error creating profile: {e}")
            raise
    
    # =========================================================================
    # ПОЛУЧЕНИЕ СТАТИСТИКИ
    # =========================================================================
    
    def get_profile_statistics(self, user_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        """
        Получает статистику профиля пользователя.
        
        Агрегирует данные из ProgressService и возвращает общую статистику:
        - Общие метрики (попытки, успехи, success_rate)
        - Статистика по типам заданий
        - Слабые области
        - Динамика по времени
        
        Args:
            user_id: ID пользователя
            force_refresh: Принудительное обновление кэша статистики
        
        Returns:
            dict: {
                "user_id": str,
                "user_name": str,
                "statistics": {
                    "total_tasks_attempted": int,
                    "tasks_mastered": int,  # Количество уникальных заданий с хотя бы одной успешной попыткой
                    "total_tasks_available": int,  # Общее количество доступных заданий
                    "success_rate": float,
                    "average_score": float,
                    "total_time_spent": int,
                    "by_task_type": {...},
                    "last_updated": str
                },
                "weak_areas": [...],
                "performance_by_type": {...},
                "time_dynamics": [...]
            }
        
        Example:
            >>> stats = controller.get_profile_statistics("user_123")
            >>> print(f"Попыток: {stats['statistics']['total_tasks_attempted']}")
            >>> print(f"Успешность: {stats['statistics']['success_rate']:.1%}")
        """
        if not user_id:
            self.logger.warning("Attempted to get statistics with empty user_id")
            return self._empty_statistics_response()
        
        try:
            # Получаем информацию о пользователе
            user = self.user_service.get_user(user_id)
            
            if not user:
                self.logger.warning(f"User not found for statistics: {user_id}")
                return self._empty_statistics_response(user_id=user_id)
            
            # Агрегируем статистику
            statistics = self.statistics_service.aggregate_statistics(
                user_id=user_id,
                force_refresh=force_refresh
            )
            
            # Получаем слабые области
            weak_areas = self.statistics_service.get_weak_areas(user_id=user_id)
            
            # Получаем производительность по типам
            performance_by_type = self.statistics_service.get_performance_by_type(
                user_id=user_id
            )
            
            # Получаем динамику по времени
            time_dynamics = self.statistics_service.get_time_dynamics(
                user_id=user_id,
                days=30
            )
            
            # Формируем результат
            result = {
                "user_id": user.user_id,
                "user_name": user.name,
                "statistics": statistics,
                "weak_areas": weak_areas,
                "performance_by_type": performance_by_type,
                "time_dynamics": time_dynamics
            }
            
            self.logger.info(
                f"Retrieved statistics for user {user_id}: "
                f"{statistics.get('total_tasks_attempted', 0)} attempts, "
                f"{statistics.get('success_rate', 0):.1%} success rate"
            )
            
            return result
            
        except Exception as e:
            self.logger.error(f"Error getting statistics for user {user_id}: {e}")
            return self._empty_statistics_response(user_id=user_id)
    
    # =========================================================================
    # ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    # =========================================================================
    
    def _empty_statistics_response(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Создает пустой ответ со статистикой.
        
        Args:
            user_id: ID пользователя (опционально)
        
        Returns:
            dict: Пустая структура статистики
        """
        return {
            "user_id": user_id or "",
            "user_name": "",
            "statistics": {
                "total_tasks_attempted": 0,
                "tasks_mastered": 0,
                "total_tasks_available": 0,
                "success_rate": 0.0,
                "average_score": 0.0,
                "total_time_spent": 0,
                "by_task_type": {},
                "last_updated": ""
            },
            "weak_areas": [],
            "performance_by_type": {},
            "time_dynamics": []
        }
