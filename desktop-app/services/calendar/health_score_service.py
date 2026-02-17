"""
Health Score Service - Сервис расчёта здоровья памяти.

Реализует:
- MVP: decay-based HealthScore
- Stage 2: FSRS-совместимую модель (Stability/Retrievability)
- Миграцию confidence из grading

Формулы:
- MVP: Health = exp(-0.15 × days_since_review)
- FSRS: Stability = InitialStability × exp(k × Σ(confidence_ratings))
- FSRS: Retrievability = exp(-ln(2) × days / Stability)
"""

import math
import logging
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

from .models import ComplexProgress, TaskAttempt, ComplexStatus


class HealthScoreService:
    """Сервис расчёта и обновления HealthScore."""
    
    # Константы для decay модели (MVP)
    DECAY_RATE = 0.15  # Скорость забывания
    
    # Константы для FSRS модели (Stage 2)
    INITIAL_STABILITY = 1.0  # Начальная стабильность (дни)
    STABILITY_GROWTH_RATE = 0.1  # k в формуле
    
    # Пороги
    CRITICAL_THRESHOLD = 0.65  # Порог критического состояния
    MASTERY_THRESHOLD = 0.90   # Порог для статуса "освоен"
    
    def __init__(self, use_fsrs: bool = False):
        """
        Инициализация сервиса.
        
        Args:
            use_fsrs: Использовать FSRS модель (Stage 2) вместо decay (MVP)
        """
        self.use_fsrs = use_fsrs
        self.logger = logging.getLogger(self.__class__.__name__)
    
    # =========================================================================
    # MVP: DECAY MODEL
    # =========================================================================
    
    def calculate_decay_health(self, days_since_review: float) -> float:
        """
        Рассчитать HealthScore по decay модели (MVP).
        
        Health = exp(-0.15 × days)
        - 0 дней → 100%
        - 7 дней → ~35%
        - 14 дней → ~12%
        
        Args:
            days_since_review: Количество дней с последнего повторения
            
        Returns:
            float: HealthScore от 0.0 до 1.0
        """
        if days_since_review <= 0:
            return 1.0
        return math.exp(-self.DECAY_RATE * days_since_review)
    
    def get_days_to_threshold(self, current_health: float, threshold: float = 0.65) -> float:
        """
        Рассчитать через сколько дней здоровье упадёт до порога.
        
        Args:
            current_health: Текущий HealthScore
            threshold: Целевой порог
            
        Returns:
            float: Количество дней (может быть отрицательным если уже ниже)
        """
        if current_health <= threshold:
            return 0.0
        if current_health <= 0:
            return 0.0
        # Health = exp(-k * days) → days = -ln(Health) / k
        days_current = -math.log(current_health) / self.DECAY_RATE
        days_threshold = -math.log(threshold) / self.DECAY_RATE
        return days_threshold - days_current
    
    # =========================================================================
    # STAGE 2: FSRS MODEL
    # =========================================================================
    
    def calculate_stability(
        self, 
        initial_stability: float,
        confidence_ratings: List[int]
    ) -> float:
        """
        Рассчитать стабильность по FSRS модели.
        
        Stability = InitialStability × exp(k × Σ(confidence_ratings))
        
        Args:
            initial_stability: Начальная стабильность
            confidence_ratings: Список оценок уверенности (1-5)
            
        Returns:
            float: Стабильность в днях
        """
        if not confidence_ratings:
            return initial_stability
        
        # Нормализуем ratings: 1-5 → -2 to +2
        normalized_sum = sum((r - 3) for r in confidence_ratings)
        
        return initial_stability * math.exp(
            self.STABILITY_GROWTH_RATE * normalized_sum
        )
    
    def calculate_retrievability(
        self, 
        days_since_review: float, 
        stability: float
    ) -> float:
        """
        Рассчитать извлекаемость (вероятность вспомнить).
        
        Retrievability = exp(-ln(2) × days / Stability)
        
        Args:
            days_since_review: Дни с последнего повторения
            stability: Текущая стабильность
            
        Returns:
            float: Retrievability от 0.0 до 1.0
        """
        if stability <= 0:
            stability = self.INITIAL_STABILITY
        if days_since_review <= 0:
            return 1.0
        
        return math.exp(-math.log(2) * days_since_review / stability)
    
    def infer_confidence_from_grading(self, user_grading: int) -> int:
        """
        Инферировать confidence_rating из user_grading (для миграции).
        
        user_grading 1 (правильно) → confidence 3 (средняя уверенность)
        user_grading 0 (неправильно) → confidence 1 (низкая уверенность)
        
        Args:
            user_grading: 0 или 1
            
        Returns:
            int: confidence_rating 1-5
        """
        return 3 if user_grading == 1 else 1
    
    # =========================================================================
    # UNIFIED INTERFACE
    # =========================================================================
    
    def calculate_health_score(
        self,
        progress: ComplexProgress,
        recent_attempts: Optional[List[TaskAttempt]] = None
    ) -> float:
        """
        Рассчитать HealthScore для комплекса (универсальный метод).
        
        Выбирает модель в зависимости от настроек и доступных данных.
        
        Args:
            progress: Прогресс по комплексу
            recent_attempts: Последние попытки (для FSRS)
            
        Returns:
            float: HealthScore от 0.0 до 1.0
        """
        # Заморожен — считаем здоровье, но не учитываем в расписании
        if progress.status == ComplexStatus.FROZEN:
            if progress.frozen_until and datetime.now() < progress.frozen_until:
                pass  # Продолжаем расчёт для мониторинга
        
        # Никогда не повторял — здоровье = 0 (нужно начать)
        if progress.last_reviewed_at is None:
            return 0.0 if progress.status != ComplexStatus.NEW else 1.0
        
        days_since = (datetime.now() - progress.last_reviewed_at).total_seconds() / 86400
        
        if self.use_fsrs and progress.stability is not None and recent_attempts:
            # FSRS модель (Stage 2)
            confidence_ratings = [
                a.confidence_rating or self.infer_confidence_from_grading(a.user_grading)
                for a in recent_attempts
            ]
            new_stability = self.calculate_stability(
                progress.stability or self.INITIAL_STABILITY,
                confidence_ratings
            )
            return self.calculate_retrievability(days_since, new_stability)
        else:
            # Decay модель (MVP)
            return self.calculate_decay_health(days_since)
    
    def update_progress_health(
        self,
        progress: ComplexProgress,
        recent_attempts: Optional[List[TaskAttempt]] = None
    ) -> ComplexProgress:
        """
        Обновить HealthScore в прогрессе.
        
        Args:
            progress: Прогресс по комплексу
            recent_attempts: Последние попытки
            
        Returns:
            ComplexProgress: Обновлённый прогресс
        """
        progress.health_score = self.calculate_health_score(progress, recent_attempts)
        progress.updated_at = datetime.now()
        
        # Обновляем stability если используем FSRS
        if self.use_fsrs and recent_attempts:
            confidence_ratings = [
                a.confidence_rating or self.infer_confidence_from_grading(a.user_grading)
                for a in recent_attempts
            ]
            progress.stability = self.calculate_stability(
                progress.stability or self.INITIAL_STABILITY,
                confidence_ratings
            )
        
        return progress
    
    def get_review_priority(self, health_score: float) -> float:
        """
        Получить приоритет для повторения (выше = важнее).
        
        Args:
            health_score: Текущий HealthScore
            
        Returns:
            float: Приоритет от 0.0 до 1.0
        """
        # Инвертируем: меньше здоровье = выше приоритет
        return 1.0 - health_score
    
    def is_critical(self, health_score: float) -> bool:
        """Проверить, критично ли здоровье."""
        return health_score < self.CRITICAL_THRESHOLD
    
    def is_mastered(self, health_score: float, total_tasks: int, completed_tasks: int) -> bool:
        """
        Проверить, освоен ли комплекс.
        
        Args:
            health_score: Текущий HealthScore
            total_tasks: Всего задач в комплексе
            completed_tasks: Выполнено задач
            
        Returns:
            bool: True если комплекс можно считать освоенным
        """
        if total_tasks == 0:
            return False
        completion_rate = completed_tasks / total_tasks
        return health_score >= self.MASTERY_THRESHOLD and completion_rate >= 0.9
    
    def estimate_recovery_time(self, current_health: float, target_health: float = 0.90) -> int:
        """
        Оценить время на восстановление здоровья.
        
        Args:
            current_health: Текущий HealthScore
            target_health: Целевой HealthScore
            
        Returns:
            int: Примерное время в минутах
        """
        if current_health >= target_health:
            return 0
        
        # Эмпирическая оценка: 1% = ~0.5 минуты повторения
        health_gap = target_health - current_health
        return int(health_gap * 100 * 0.5)
    
    def format_health_message(
        self, 
        complex_name: str, 
        health_score: float
    ) -> Dict[str, str]:
        """
        Сформировать сообщение о здоровье комплекса.
        
        Args:
            complex_name: Название комплекса
            health_score: Текущий HealthScore
            
        Returns:
            dict: {"title", "message", "recovery_time"}
        """
        health_percent = int(health_score * 100)
        recovery_minutes = self.estimate_recovery_time(health_score)
        
        if health_score < 0.5:
            severity = "критически низкое"
        elif health_score < 0.65:
            severity = "требует внимания"
        elif health_score < 0.8:
            severity = "немного снизилось"
        else:
            severity = "в норме"
        
        return {
            "title": f"{complex_name} ↓{health_percent}%",
            "message": f"Здоровье памяти {severity}. "
                      f"{recovery_minutes} мин вернут до 90%." if recovery_minutes > 0 else "Всё отлично!",
            "recovery_time": f"~{recovery_minutes} мин" if recovery_minutes > 0 else "",
        }
