"""
Схемы валидации для пользовательских данных.

Содержит валидаторы для:
- profile.json - профиль пользователя
- progress.json - история выполнения заданий
- statistics.json - агрегированная статистика
"""

from .user_schemas import (
    ProfileSchema,
    ProgressSchema,
    StatisticsSchema,
    validate_profile,
    validate_progress,
    validate_statistics,
)

__all__ = [
    'ProfileSchema',
    'ProgressSchema',
    'StatisticsSchema',
    'validate_profile',
    'validate_progress',
    'validate_statistics',
]

