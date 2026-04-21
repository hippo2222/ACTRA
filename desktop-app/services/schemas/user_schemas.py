"""
Схемы валидации для пользовательских данных.

Валидирует структуру JSON файлов:
- profile.json - профиль пользователя
- progress.json - история выполнения заданий
- statistics.json - агрегированная статистика
"""

from typing import Dict, List, Any, Optional
from datetime import datetime
import re

from task_system.core.exceptions import TaskValidationError

# Алиас для обратной совместимости
ValidationError = TaskValidationError
_ALLOWED_USER_ROLES = {"user", "admin"}
_ALLOWED_USER_PLANS = {"free", "premium"}


class BaseUserSchema:
    """
    Базовая схема для валидации пользовательских данных.
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """
        Валидирует данные.
        
        Args:
            data: Данные для валидации
            
        Returns:
            Список ошибок валидации (пустой если данные валидны)
        """
        # Базовая схема не задает собственных правил.
        # Конкретная валидация описывается в подклассах.
        return []
        errors = []
        profile = {}
        # Переопределяется в подклассах
        if 'role' in profile:
            role = str(profile.get('role') or '').strip().lower()
            if role not in _ALLOWED_USER_ROLES:
                errors.append("profile.role: допустимые значения user или admin")

        if 'plan' in profile:
            plan = str(profile.get('plan') or '').strip().lower()
            if plan not in _ALLOWED_USER_PLANS:
                errors.append("profile.plan: допустимые значения free или premium")

        if 'role' in profile:
            role = str(profile.get('role') or '').strip().lower()
            if role not in _ALLOWED_USER_ROLES:
                errors.append("profile.role: допустимые значения user или admin")

        if 'plan' in profile:
            plan = str(profile.get('plan') or '').strip().lower()
            if plan not in _ALLOWED_USER_PLANS:
                errors.append("profile.plan: допустимые значения free или premium")

        if 'role' in profile:
            role = str(profile.get('role') or '').strip().lower()
            if role not in _ALLOWED_USER_ROLES:
                errors.append("profile.role: допустимые значения user или admin")

        if 'plan' in profile:
            plan = str(profile.get('plan') or '').strip().lower()
            if plan not in _ALLOWED_USER_PLANS:
                errors.append("profile.plan: допустимые значения free или premium")

        return errors
    
    @classmethod
    def is_valid(cls, data: Dict[str, Any]) -> bool:
        """
        Проверяет валидность данных.
        
        Args:
            data: Данные для проверки
            
        Returns:
            True если данные валидны
        """
        errors = cls.validate(data)
        return len(errors) == 0
    
    @classmethod
    def validate_or_raise(cls, data: Dict[str, Any]):
        """
        Валидирует данные и выбрасывает исключение при ошибках.
        
        Args:
            data: Данные для валидации
            
        Raises:
            ValidationError: Если данные невалидны
        """
        errors = cls.validate(data)
        if errors:
            error_message = "\n".join(errors)
            raise ValidationError(f"Ошибки валидации:\n{error_message}")


class ProfileSchema(BaseUserSchema):
    """
    Схема валидации для profile.json.
    
    Структура:
    {
        "user_id": "user_123",
        "profile": {
            "name": "Иван Иванов",
            "created_at": "2024-01-01T00:00:00",
            "settings": {}
        }
    }
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """Валидирует profile.json"""
        errors = []
        
        # Проверяем обязательные поля верхнего уровня
        if 'user_id' not in data:
            errors.append("Отсутствует обязательное поле: user_id")
        elif not isinstance(data['user_id'], str) or not data['user_id']:
            errors.append("user_id: должно быть непустой строкой")
        
        if 'profile' not in data:
            errors.append("Отсутствует обязательное поле: profile")
        elif not isinstance(data['profile'], dict):
            errors.append("profile: должно быть объектом")
        else:
            # Валидируем вложенный объект profile
            profile_errors = cls._validate_profile(data['profile'])
            errors.extend(profile_errors)
            role = str(data['profile'].get('role') or '').strip().lower()
            if role and role not in _ALLOWED_USER_ROLES:
                errors.append("profile.role: допустимые значения user или admin")
            plan = str(data['profile'].get('plan') or '').strip().lower()
            if plan and plan not in _ALLOWED_USER_PLANS:
                errors.append("profile.plan: допустимые значения free или premium")
        
        return errors
    
    @classmethod
    def _validate_profile(cls, profile: Dict[str, Any]) -> List[str]:
        """Валидирует объект profile"""
        errors = []
        
        # Проверяем обязательные поля profile
        if 'name' not in profile:
            errors.append("profile.name: поле обязательно")
        elif not isinstance(profile['name'], str) or not profile['name'].strip():
            errors.append("profile.name: должно быть непустой строкой")
        
        if 'created_at' not in profile:
            errors.append("profile.created_at: поле обязательно")
        else:
            # Проверяем формат даты ISO 8601 (требуем полный формат с временем)
            created_at = profile['created_at']
            if not isinstance(created_at, str):
                errors.append("profile.created_at: должно быть строкой в формате ISO 8601")
            else:
                # Проверяем, что дата содержит время (формат YYYY-MM-DDTHH:MM:SS)
                if 'T' not in created_at:
                    errors.append("profile.created_at: должен содержать время в формате ISO 8601 (YYYY-MM-DDTHH:MM:SS)")
                else:
                    try:
                        datetime.fromisoformat(created_at.replace('Z', '+00:00'))
                    except ValueError:
                        errors.append("profile.created_at: неверный формат даты (ожидается ISO 8601)")
        
        # Валидируем settings (опционально)
        if 'settings' in profile:
            if not isinstance(profile['settings'], dict):
                errors.append("profile.settings: должно быть объектом")
            else:
                settings_errors = cls._validate_settings(profile['settings'])
                errors.extend(settings_errors)
        
        return errors
    
    @classmethod
    def _validate_settings(cls, settings: Dict[str, Any]) -> List[str]:
        """Валидирует объект settings"""
        errors = []
        
        # Settings может содержать любые дополнительные поля в будущем
        # На данный момент валидация не требуется
        
        return errors


class ProgressSchema(BaseUserSchema):
    """
    Схема валидации для progress.json.
    
    Поддерживает версии 2.0 и 3.0.
    
    Структура версии 2.0:
    {
        "version": "2.0",
        "user_id": "user_123",
        "task_history": {
            "module_01/topic_01/task_001": {
                "attempts": [...],
                "current_difficulty": 2,
                "mastery_level": "good"
            }
        },
        "mistake_bank": [
            {
                "module": "module_01",
                "topic": "topic_01",
                "task": "task_001",
                "level": 2,
                "fail_count": 3,
                "last_failed": "2023-10-27T10:00:00Z"
            }
        ]
    }
    
    Структура версии 3.0:
    {
        "version": "3.0",
        "updated_at": "2023-10-27T10:00:00Z",
        "user_id": "user_123",
        "global_stats": {
            "total_attempts": 150,
            "total_time_seconds": 4500,
        },
        "task_history": {
            "module_01/topic_01/task_001": {
                "meta": {
                    "total_attempts": 12,
                    "last_attempt_at": "2023-10-27T10:00:00Z",
                    "success_rate": 0.85
                },
                "current_difficulty": 2,
                "mastery_level": "good",
                "attempts": [...]
            }
        },
        "mistake_bank": [
            {
                "key": "module_01/topic_01/task_001",
                "fail_count": 5,
                "success_streak": 0,
                "last_failed": "2023-10-27T10:00:00Z",
                "error_context": {
                    "type": "click",
                    "missed": ["segment_4"],
                    "wrongly_clicked": ["segment_2"]
                }
            }
        ]
    }
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """Валидирует progress.json"""
        errors = []
        
        # Проверяем версию
        if 'version' not in data:
            errors.append("Отсутствует обязательное поле: version")
        elif not isinstance(data['version'], str):
            errors.append("version: должно быть строкой")
        elif data['version'] not in ["2.0", "3.0"]:
            errors.append(f"version: неподдерживаемая версия (ожидается '2.0' или '3.0', получено '{data['version']}')")
        
        version = data.get('version', '2.0')
        
        # Проверяем user_id
        if 'user_id' not in data:
            errors.append("Отсутствует обязательное поле: user_id")
        elif not isinstance(data['user_id'], str) or not data['user_id']:
            errors.append("user_id: должно быть непустой строкой")
        
        # Для версии 3.0 проверяем updated_at
        if version == "3.0":
            if 'updated_at' not in data:
                errors.append("Отсутствует обязательное поле: updated_at (требуется для версии 3.0)")
            elif not isinstance(data['updated_at'], str):
                errors.append("updated_at: должно быть строкой в формате ISO 8601")
            else:
                try:
                    datetime.fromisoformat(data['updated_at'].replace('Z', '+00:00'))
                except ValueError:
                    errors.append("updated_at: неверный формат даты (ожидается ISO 8601)")
        
        # Для версии 3.0 проверяем global_stats
        if version == "3.0":
            if 'global_stats' not in data:
                errors.append("Отсутствует обязательное поле: global_stats (требуется для версии 3.0)")
            elif not isinstance(data['global_stats'], dict):
                errors.append("global_stats: должно быть объектом")
            else:
                global_stats_errors = cls._validate_global_stats(data['global_stats'])
                errors.extend(global_stats_errors)
        
        # Валидируем task_history
        if 'task_history' not in data:
            errors.append("Отсутствует обязательное поле: task_history")
        elif not isinstance(data['task_history'], dict):
            errors.append("task_history: должно быть объектом")
        else:
            task_history_errors = cls._validate_task_history(data['task_history'], version)
            errors.extend(task_history_errors)
        
        # Валидируем mistake_bank
        if 'mistake_bank' not in data:
            errors.append("Отсутствует обязательное поле: mistake_bank")
        elif not isinstance(data['mistake_bank'], list):
            errors.append("mistake_bank: должно быть массивом")
        else:
            mistake_bank_errors = cls._validate_mistake_bank(data['mistake_bank'], version)
            errors.extend(mistake_bank_errors)
        
        return errors
    
    @classmethod
    def _validate_global_stats(cls, global_stats: Dict[str, Any]) -> List[str]:
        """Валидирует global_stats для версии 3.0"""
        errors = []
        
        # total_attempts
        if 'total_attempts' not in global_stats:
            errors.append("global_stats.total_attempts: поле обязательно")
        else:
            total = global_stats['total_attempts']
            if not isinstance(total, int):
                errors.append("global_stats.total_attempts: должно быть целым числом")
            elif total < 0:
                errors.append("global_stats.total_attempts: не может быть отрицательным")
        
        # total_time_seconds
        if 'total_time_seconds' not in global_stats:
            errors.append("global_stats.total_time_seconds: поле обязательно")
        else:
            time = global_stats['total_time_seconds']
            if not isinstance(time, (int, float)):
                errors.append("global_stats.total_time_seconds: должно быть числом")
            elif time < 0:
                errors.append("global_stats.total_time_seconds: не может быть отрицательным")
        
        return errors
    
    @classmethod
    def _validate_task_history(cls, task_history: Dict[str, Any], version: str = "2.0") -> List[str]:
        """Валидирует task_history"""
        errors = []
        
        for task_ref, task_data in task_history.items():
            if not isinstance(task_data, dict):
                errors.append(f"task_history['{task_ref}']: должно быть объектом")
                continue
            
            # Для версии 3.0 проверяем meta
            if version == "3.0":
                if 'meta' not in task_data:
                    errors.append(f"task_history['{task_ref}'].meta: поле обязательно (требуется для версии 3.0)")
                elif not isinstance(task_data['meta'], dict):
                    errors.append(f"task_history['{task_ref}'].meta: должно быть объектом")
                else:
                    meta_errors = cls._validate_task_meta(task_data['meta'], f"task_history['{task_ref}'].meta")
                    errors.extend(meta_errors)
            
            # Проверяем attempts
            if 'attempts' not in task_data:
                errors.append(f"task_history['{task_ref}'].attempts: поле обязательно")
            elif not isinstance(task_data['attempts'], list):
                errors.append(f"task_history['{task_ref}'].attempts: должно быть массивом")
            else:
                # Валидируем каждую попытку
                for i, attempt in enumerate(task_data['attempts']):
                    if not isinstance(attempt, dict):
                        errors.append(f"task_history['{task_ref}'].attempts[{i}]: должно быть объектом")
                        continue
                    
                    attempt_errors = cls._validate_attempt(attempt, f"task_history['{task_ref}'].attempts[{i}]")
                    errors.extend(attempt_errors)
                
                # Для версии 3.0 проверяем лимит попыток (макс. 20)
                if version == "3.0" and len(task_data['attempts']) > 20:
                    errors.append(f"task_history['{task_ref}'].attempts: превышен лимит попыток (макс. 20 для версии 3.0)")
            
            # Проверяем current_difficulty (опционально)
            if 'current_difficulty' in task_data:
                diff = task_data['current_difficulty']
                if not isinstance(diff, int):
                    errors.append(f"task_history['{task_ref}'].current_difficulty: должно быть целым числом")
                elif diff < 1 or diff > 3:
                    errors.append(f"task_history['{task_ref}'].current_difficulty: должно быть в диапазоне 1-3")
            
            # Проверяем mastery_level (опционально)
            if 'mastery_level' in task_data:
                mastery = task_data['mastery_level']
                if not isinstance(mastery, str):
                    errors.append(f"task_history['{task_ref}'].mastery_level: должно быть строкой")
                elif mastery not in ['beginner', 'good', 'expert']:
                    errors.append(f"task_history['{task_ref}'].mastery_level: должно быть одним из: 'beginner', 'good', 'expert'")
        
        return errors
    
    @classmethod
    def _validate_task_meta(cls, meta: Dict[str, Any], prefix: str = "") -> List[str]:
        """Валидирует meta для task_entry (версия 3.0)"""
        errors = []
        
        # total_attempts
        if 'total_attempts' not in meta:
            errors.append(f"{prefix}.total_attempts: поле обязательно")
        else:
            total = meta['total_attempts']
            if not isinstance(total, int):
                errors.append(f"{prefix}.total_attempts: должно быть целым числом")
            elif total < 0:
                errors.append(f"{prefix}.total_attempts: не может быть отрицательным")
        
        # last_attempt_at
        if 'last_attempt_at' not in meta:
            errors.append(f"{prefix}.last_attempt_at: поле обязательно")
        else:
            last_attempt = meta['last_attempt_at']
            if not isinstance(last_attempt, str):
                errors.append(f"{prefix}.last_attempt_at: должно быть строкой в формате ISO 8601")
            else:
                try:
                    datetime.fromisoformat(last_attempt.replace('Z', '+00:00'))
                except ValueError:
                    errors.append(f"{prefix}.last_attempt_at: неверный формат даты (ожидается ISO 8601)")
        
        # success_rate
        if 'success_rate' not in meta:
            errors.append(f"{prefix}.success_rate: поле обязательно")
        else:
            rate = meta['success_rate']
            if not isinstance(rate, (int, float)):
                errors.append(f"{prefix}.success_rate: должно быть числом")
            elif rate < 0 or rate > 1:
                errors.append(f"{prefix}.success_rate: должно быть в диапазоне 0.0-1.0")
        
        return errors
    
    @classmethod
    def _validate_attempt(cls, attempt: Dict[str, Any], prefix: str = "") -> List[str]:
        """Валидирует одну попытку выполнения задания"""
        errors = []
        
        # timestamp
        if 'timestamp' not in attempt:
            errors.append(f"{prefix}.timestamp: поле обязательно")
        else:
            ts = attempt['timestamp']
            if not isinstance(ts, str):
                errors.append(f"{prefix}.timestamp: должно быть строкой в формате ISO 8601")
            else:
                try:
                    datetime.fromisoformat(ts.replace('Z', '+00:00'))
                except ValueError:
                    errors.append(f"{prefix}.timestamp: неверный формат даты (ожидается ISO 8601)")
        
        # difficulty
        if 'difficulty' not in attempt:
            errors.append(f"{prefix}.difficulty: поле обязательно")
        else:
            diff = attempt['difficulty']
            if not isinstance(diff, int):
                errors.append(f"{prefix}.difficulty: должно быть целым числом")
            elif diff < 1 or diff > 3:
                errors.append(f"{prefix}.difficulty: должно быть в диапазоне 1-3")
        
        # success
        if 'success' not in attempt:
            errors.append(f"{prefix}.success: поле обязательно")
        elif not isinstance(attempt['success'], bool):
            errors.append(f"{prefix}.success: должно быть булевым значением")
        
        # time_spent
        if 'time_spent' not in attempt:
            errors.append(f"{prefix}.time_spent: поле обязательно")
        else:
            time_spent = attempt['time_spent']
            if not isinstance(time_spent, int):
                errors.append(f"{prefix}.time_spent: должно быть целым числом")
            elif time_spent < 0:
                errors.append(f"{prefix}.time_spent: не может быть отрицательным")
        
        # complex_id (опционально, может быть null)
        if 'complex_id' in attempt and attempt['complex_id'] is not None:
            if not isinstance(attempt['complex_id'], str):
                errors.append(f"{prefix}.complex_id: должно быть строкой или null")
        
        # iteration (опционально, может быть null)
        if 'iteration' in attempt and attempt['iteration'] is not None:
            if not isinstance(attempt['iteration'], int):
                errors.append(f"{prefix}.iteration: должно быть целым числом или null")
            elif attempt['iteration'] < 1:
                errors.append(f"{prefix}.iteration: должно быть положительным числом")
        
        return errors
    
    @classmethod
    def _validate_mistake_bank(cls, mistake_bank: List[Any], version: str = "2.0") -> List[str]:
        """
        Валидирует mistake_bank.
        
        Поддерживает две версии схемы:
        - Версия 2.0: {module, topic, task, level, fail_count, last_failed}
        - Версия 3.0: {key, fail_count, success_streak, last_failed, error_context}
        """
        errors = []
        
        for i, mistake in enumerate(mistake_bank):
            if not isinstance(mistake, dict):
                errors.append(f"mistake_bank[{i}]: должно быть объектом")
                continue
            
            if version == "3.0":
                # Валидация для версии 3.0 (новая схема)
                # Проверяем обязательные поля
                required_fields = ['key', 'fail_count', 'success_streak', 'last_failed']
                for field in required_fields:
                    if field not in mistake:
                        errors.append(f"mistake_bank[{i}].{field}: поле обязательно (требуется для версии 3.0)")
                
                # Валидируем key
                if 'key' in mistake:
                    if not isinstance(mistake['key'], str):
                        errors.append(f"mistake_bank[{i}].key: должно быть строкой")
                    elif not mistake['key']:
                        errors.append(f"mistake_bank[{i}].key: не может быть пустой строкой")
                    # Проверяем формат ключа (должен быть в формате "module/topic/task")
                    elif mistake['key'].count('/') != 2:
                        errors.append(f"mistake_bank[{i}].key: должен быть в формате 'module/topic/task'")
                
                # Валидируем fail_count
                if 'fail_count' in mistake:
                    fail_count = mistake['fail_count']
                    if not isinstance(fail_count, int):
                        errors.append(f"mistake_bank[{i}].fail_count: должно быть целым числом")
                    elif fail_count < 1:
                        errors.append(f"mistake_bank[{i}].fail_count: должно быть положительным числом")
                
                # Валидируем success_streak
                if 'success_streak' in mistake:
                    success_streak = mistake['success_streak']
                    if not isinstance(success_streak, int):
                        errors.append(f"mistake_bank[{i}].success_streak: должно быть целым числом")
                    elif success_streak < 0:
                        errors.append(f"mistake_bank[{i}].success_streak: не может быть отрицательным")
                
                # Валидируем last_failed
                if 'last_failed' in mistake:
                    last_failed = mistake['last_failed']
                    if not isinstance(last_failed, str):
                        errors.append(f"mistake_bank[{i}].last_failed: должно быть строкой в формате ISO 8601")
                    else:
                        try:
                            datetime.fromisoformat(last_failed.replace('Z', '+00:00'))
                        except ValueError:
                            errors.append(f"mistake_bank[{i}].last_failed: неверный формат даты (ожидается ISO 8601)")
                
                # Валидируем error_context (опционально)
                if 'error_context' in mistake:
                    error_context = mistake['error_context']
                    if not isinstance(error_context, dict):
                        errors.append(f"mistake_bank[{i}].error_context: должно быть объектом")
                    else:
                        # Проверяем, что error_context содержит хотя бы одно поле
                        if not error_context:
                            errors.append(f"mistake_bank[{i}].error_context: не может быть пустым объектом")
                        # Валидируем тип ошибки, если указан
                        if 'type' in error_context:
                            if not isinstance(error_context['type'], str):
                                errors.append(f"mistake_bank[{i}].error_context.type: должно быть строкой")
                        # Валидируем missed и wrongly_clicked, если указаны
                        if 'missed' in error_context:
                            if not isinstance(error_context['missed'], list):
                                errors.append(f"mistake_bank[{i}].error_context.missed: должно быть массивом")
                        if 'wrongly_clicked' in error_context:
                            if not isinstance(error_context['wrongly_clicked'], list):
                                errors.append(f"mistake_bank[{i}].error_context.wrongly_clicked: должно быть массивом")
            else:
                # Валидация для версии 2.0 (старая схема)
                # Проверяем обязательные поля
                required_fields = ['module', 'topic', 'task', 'level', 'fail_count', 'last_failed']
                for field in required_fields:
                    if field not in mistake:
                        errors.append(f"mistake_bank[{i}].{field}: поле обязательно")
                
                # Валидируем типы
                if 'module' in mistake and not isinstance(mistake['module'], str):
                    errors.append(f"mistake_bank[{i}].module: должно быть строкой")
                
                if 'topic' in mistake and not isinstance(mistake['topic'], str):
                    errors.append(f"mistake_bank[{i}].topic: должно быть строкой")
                
                if 'task' in mistake and not isinstance(mistake['task'], str):
                    errors.append(f"mistake_bank[{i}].task: должно быть строкой")
                
                if 'level' in mistake:
                    level = mistake['level']
                    if not isinstance(level, int):
                        errors.append(f"mistake_bank[{i}].level: должно быть целым числом")
                    elif level < 1 or level > 3:
                        errors.append(f"mistake_bank[{i}].level: должно быть в диапазоне 1-3")
                
                if 'fail_count' in mistake:
                    fail_count = mistake['fail_count']
                    if not isinstance(fail_count, int):
                        errors.append(f"mistake_bank[{i}].fail_count: должно быть целым числом")
                    elif fail_count < 1:
                        errors.append(f"mistake_bank[{i}].fail_count: должно быть положительным числом")
                
                if 'last_failed' in mistake:
                    last_failed = mistake['last_failed']
                    if not isinstance(last_failed, str):
                        errors.append(f"mistake_bank[{i}].last_failed: должно быть строкой в формате ISO 8601")
                    else:
                        try:
                            datetime.fromisoformat(last_failed.replace('Z', '+00:00'))
                        except ValueError:
                            errors.append(f"mistake_bank[{i}].last_failed: неверный формат даты (ожидается ISO 8601)")
        
        return errors


class StatisticsSchema(BaseUserSchema):
    """
    Схема валидации для statistics.json.
    
    Структура:
    {
        "total_tasks_attempted": 150,
        "total_tasks_completed": 120,
        "success_rate": 0.80,
        "by_task_type": {
            "click": {"attempts": 50, "success_rate": 0.85},
            "draw": {"attempts": 30, "success_rate": 0.70}
        },
        "weak_areas": [
            {"topic": "topic_03", "success_rate": 0.60}
        ]
    }
    """
    
    @classmethod
    def validate(cls, data: Dict[str, Any]) -> List[str]:
        """Валидирует statistics.json"""
        errors = []
        
        # total_tasks_attempted
        if 'total_tasks_attempted' not in data:
            errors.append("Отсутствует обязательное поле: total_tasks_attempted")
        else:
            total = data['total_tasks_attempted']
            if not isinstance(total, int):
                errors.append("total_tasks_attempted: должно быть целым числом")
            elif total < 0:
                errors.append("total_tasks_attempted: не может быть отрицательным")
        
        # total_tasks_completed
        if 'total_tasks_completed' not in data:
            errors.append("Отсутствует обязательное поле: total_tasks_completed")
        else:
            completed = data['total_tasks_completed']
            if not isinstance(completed, int):
                errors.append("total_tasks_completed: должно быть целым числом")
            elif completed < 0:
                errors.append("total_tasks_completed: не может быть отрицательным")
            elif 'total_tasks_attempted' in data and completed > data['total_tasks_attempted']:
                errors.append("total_tasks_completed: не может быть больше total_tasks_attempted")
        
        # success_rate
        if 'success_rate' not in data:
            errors.append("Отсутствует обязательное поле: success_rate")
        else:
            rate = data['success_rate']
            if not isinstance(rate, (int, float)):
                errors.append("success_rate: должно быть числом")
            elif rate < 0 or rate > 1:
                errors.append("success_rate: должно быть в диапазоне 0.0-1.0")
        
        # by_task_type (опционально)
        if 'by_task_type' in data:
            if not isinstance(data['by_task_type'], dict):
                errors.append("by_task_type: должно быть объектом")
            else:
                by_type_errors = cls._validate_by_task_type(data['by_task_type'])
                errors.extend(by_type_errors)
        
        # weak_areas (опционально)
        if 'weak_areas' in data:
            if not isinstance(data['weak_areas'], list):
                errors.append("weak_areas: должно быть массивом")
            else:
                weak_areas_errors = cls._validate_weak_areas(data['weak_areas'])
                errors.extend(weak_areas_errors)
        
        return errors
    
    @classmethod
    def _validate_by_task_type(cls, by_task_type: Dict[str, Any]) -> List[str]:
        """Валидирует by_task_type"""
        errors = []
        
        for task_type, stats in by_task_type.items():
            if not isinstance(stats, dict):
                errors.append(f"by_task_type['{task_type}']: должно быть объектом")
                continue
            
            # attempts
            if 'attempts' in stats:
                attempts = stats['attempts']
                if not isinstance(attempts, int):
                    errors.append(f"by_task_type['{task_type}'].attempts: должно быть целым числом")
                elif attempts < 0:
                    errors.append(f"by_task_type['{task_type}'].attempts: не может быть отрицательным")
            
            # success_rate
            if 'success_rate' in stats:
                rate = stats['success_rate']
                if not isinstance(rate, (int, float)):
                    errors.append(f"by_task_type['{task_type}'].success_rate: должно быть числом")
                elif rate < 0 or rate > 1:
                    errors.append(f"by_task_type['{task_type}'].success_rate: должно быть в диапазоне 0.0-1.0")
        
        return errors
    
    @classmethod
    def _validate_weak_areas(cls, weak_areas: List[Any]) -> List[str]:
        """Валидирует weak_areas"""
        errors = []
        
        for i, area in enumerate(weak_areas):
            if not isinstance(area, dict):
                errors.append(f"weak_areas[{i}]: должно быть объектом")
                continue
            
            # topic
            if 'topic' not in area:
                errors.append(f"weak_areas[{i}].topic: поле обязательно")
            elif not isinstance(area['topic'], str):
                errors.append(f"weak_areas[{i}].topic: должно быть строкой")
            
            # success_rate
            if 'success_rate' not in area:
                errors.append(f"weak_areas[{i}].success_rate: поле обязательно")
            else:
                rate = area['success_rate']
                if not isinstance(rate, (int, float)):
                    errors.append(f"weak_areas[{i}].success_rate: должно быть числом")
                elif rate < 0 or rate > 1:
                    errors.append(f"weak_areas[{i}].success_rate: должно быть в диапазоне 0.0-1.0")
        
        return errors


# Функции-обертки для удобства использования
def validate_profile(data: Dict[str, Any]) -> List[str]:
    """Валидирует profile.json"""
    return ProfileSchema.validate(data)


def validate_progress(data: Dict[str, Any]) -> List[str]:
    """Валидирует progress.json"""
    return ProgressSchema.validate(data)


def validate_statistics(data: Dict[str, Any]) -> List[str]:
    """Валидирует statistics.json"""
    return StatisticsSchema.validate(data)

