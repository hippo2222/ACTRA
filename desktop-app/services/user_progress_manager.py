"""
UserProgressManager - управление прогрессом пользователя (новая реализация).

Отвечает за:
- Сохранение попыток выполнения заданий (task_history)
- Управление банком ошибок (mistake_bank)
- Работа с новой структурой progress.json (версии 2.0 и 3.0)

ФАЗА 1: Профили пользователей и расширенная статистика
Этап 2: Обновление логики mistake_bank (Schema 3.0)
"""

import json
import logging
import os
import tempfile
from pathlib import Path
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta

from services.schemas.user_schemas import ProgressSchema
from task_system.core.exceptions import TaskValidationError


class UserProgressManager:
    """
    Менеджер прогресса пользователя (новая реализация).
    
    Управляет:
    - Историей попыток выполнения заданий (task_history)
    - Банком ошибок (mistake_bank)
    - Персистентным хранением в progress.json
    
    Поддерживает версии 2.0 и 3.0.
    """
    
    # Максимальное количество попыток в истории (Rolling Window)
    MAX_HISTORY = 20
    
    """
    Структура progress.json версии 3.0:
    {
        "version": "3.0",
        "updated_at": "2023-10-27T10:00:00Z",
        "user_id": "user_123",
        "global_stats": {
            "total_attempts": 150,
            "total_time_seconds": 4500,
            "average_score": 75.5
        },
        "task_history": {
            "module_01/topic_01/task_001": {
                "meta": {
                    "total_attempts": 12,
                    "best_score": 95.0,
                    "last_attempt_at": "2023-10-27T10:00:00Z",
                    "avg_score": 80.0,
                    "success_rate": 0.85
                },
                "attempts": [
                    {
                        "timestamp": "2024-01-01T00:00:00",
                        "difficulty": 1,
                        "success": true,
                        "score": 85.0,
                        "time_spent": 120,
                        "complex_id": null,
                        "iteration": null
                    }
                ],
                "current_difficulty": 2,
                "mastery_level": "good"
            }
        },
        "mistake_bank": [
            {
                "key": "module_01/topic_01/task_001",
                "fail_count": 5,
                "success_streak": 0,
                "last_failed": "2024-01-01T00:00:00",
                "error_context": {
                    "type": "click",
                    "missed": ["segment_4"],
                    "wrongly_clicked": ["segment_2"]
                }
            }
        ]
    }
    """
    
    def __init__(self, data_dir: str = None, user_id: str = "default_user", 
                 difficulty_manager: Optional[Any] = None,
                 event_bus: Optional[Any] = None):
        """
        Инициализация UserProgressManager.
        
        Args:
            data_dir: Путь к директории с данными (если None, используется config.json)
            user_id: ID пользователя
            difficulty_manager: DifficultyManager для определения доступных уровней (опционально)
        """
        # Импортируем load_config только если data_dir не указан
        if data_dir is None:
            from common.config_loader import load_config
            config = load_config()
            data_dir = config.get("data_root", "data")
        
        self.data_dir = Path(data_dir)
        self.user_id = user_id
        self.users_dir = self.data_dir / "users"
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # DifficultyManager для эскалации уровней (Шаг 2.7)
        self.difficulty_manager = difficulty_manager
        
        # EventBus для уведомления других сервисов об изменениях
        self.event_bus = event_bus
        
        # Путь к файлу progress.json пользователя
        self.user_dir = self.users_dir / user_id
        self.progress_file = self.user_dir / "progress.json"
        
        # Создаем директорию пользователя, если её нет
        self.user_dir.mkdir(parents=True, exist_ok=True)
        
        # Загружаем или создаем структуру прогресса
        self.progress_data = self._load_or_create_progress()
        
        self.logger.info(f"UserProgressManager initialized for user: {user_id}")
    
    def _load_or_create_progress(self) -> Dict[str, Any]:
        """
        Загружает прогресс из файла или создает новую структуру.
        
        Returns:
            Dict[str, Any]: Данные прогресса
        """
        if self.progress_file.exists():
            try:
                with open(self.progress_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                # Валидируем данные
                errors = ProgressSchema.validate(data)
                if errors:
                    self.logger.error(f"Invalid progress data for user {self.user_id}: {errors}")
                    # Создаем новую структуру при ошибке валидации и сохраняем
                    data = self._get_default_progress_structure()
                    self._save_progress(data)
                    return data
                
                # Проверяем версию и выполняем миграцию при необходимости
                version = data.get("version", "2.0")
                if version == "2.0":
                    self.logger.info(
                        f"Detected version 2.0 for user {self.user_id}, "
                        "migrating to version 3.0..."
                    )
                    data = self._migrate_v2_to_v3(data)
                    # Сохраняем мигрированные данные
                    self._save_progress(data)
                    self.logger.info(f"Migration completed for user {self.user_id}")
                
                # Логируем информацию о загруженных данных
                task_count = len(data.get("task_history", {}))
                total_attempts = sum(
                    len(task_data.get("attempts", []))
                    for task_data in data.get("task_history", {}).values()
                )
                self.logger.debug(
                    f"Progress loaded for user {self.user_id}: "
                    f"{task_count} tasks, {total_attempts} total attempts"
                )
                return data
                
            except json.JSONDecodeError as e:
                self.logger.error(f"Failed to parse progress.json for user {self.user_id}: {e}")
                # Восстанавливаем структуру и сохраняем в файл
                data = self._get_default_progress_structure()
                self._save_progress(data)
                return data
            except Exception as e:
                self.logger.error(f"Error loading progress for user {self.user_id}: {e}")
                # Восстанавливаем структуру и сохраняем в файл
                data = self._get_default_progress_structure()
                self._save_progress(data)
                return data
        else:
            # Создаем новую структуру
            data = self._get_default_progress_structure()
            self._save_progress(data)
            return data
    
    def _get_default_progress_structure(self) -> Dict[str, Any]:
        """
        Возвращает базовую структуру данных прогресса (версия 3.0).
        
        Returns:
            Dict[str, Any]: Структура по умолчанию версии 3.0
        """
        return {
            "version": "3.0",
            "updated_at": datetime.now().isoformat(),
            "user_id": self.user_id,
            "global_stats": {
                "total_attempts": 0,
                "total_time_seconds": 0
            },
            "task_history": {},
            "mistake_bank": [],
            "complex_completions": []
        }
    
    def _migrate_v2_to_v3(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Мигрирует данные прогресса из версии 2.0 в версию 3.0.
        
        Алгоритм:
        1. Для каждого задания:
           - Рассчитать meta (просуммировать все имеющиеся попытки)
           - Найти best_score
           - Обрезать массив attempts до последних 20 элементов
        2. Рассчитать global_stats
        3. Добавить updated_at
        4. Установить version: "3.0"
        
        Args:
            data: Данные прогресса версии 2.0
        
        Returns:
            Dict[str, Any]: Мигрированные данные версии 3.0
        """
        self.logger.info("Starting migration from version 2.0 to 3.0")
        
        # Создаем новую структуру версии 3.0
        migrated_data = {
            "version": "3.0",
            "updated_at": datetime.now().isoformat(),
            "user_id": data.get("user_id", self.user_id),
            "global_stats": {
                "total_attempts": 0,
                "total_time_seconds": 0
            },
            "task_history": {},
            "mistake_bank": data.get("mistake_bank", [])
        }
        
        task_history = data.get("task_history", {})
        global_total_attempts = 0
        global_total_time = 0
        
        # Мигрируем каждое задание
        for task_ref, task_data in task_history.items():
            attempts = task_data.get("attempts", [])
            
            if not attempts:
                # Если нет попыток, создаем структуру с пустыми meta
                migrated_data["task_history"][task_ref] = {
                    "meta": {
                        "total_attempts": 0,
                        "last_attempt_at": datetime.now().isoformat(),
                        "success_rate": 0.0
                    },
                    "attempts": [],
                    "current_difficulty": task_data.get("current_difficulty", 1),
                    "mastery_level": task_data.get("mastery_level", "beginner")
                }
                continue
            
            # Обрезаем массив attempts до последних 20 элементов
            truncated_attempts = attempts[-self.MAX_HISTORY:] if len(attempts) > self.MAX_HISTORY else attempts
            
            # Рассчитываем meta на основе всех попыток (до обрезки)
            total_attempts = len(attempts)
            
            # Находим последнюю попытку для last_attempt_at
            last_attempt = attempts[-1] if attempts else None
            last_attempt_at = last_attempt.get("timestamp", datetime.now().isoformat()) if last_attempt else datetime.now().isoformat()
            
            # Вычисляем success_rate на основе всех попыток
            successful_count = sum(1 for a in attempts if a.get("success", False))
            success_rate = successful_count / total_attempts if total_attempts > 0 else 0.0
            
            # Обновляем глобальную статистику
            global_total_attempts += total_attempts
            for attempt in attempts:
                global_total_time += attempt.get("time_spent", 0)
            
            # Создаем мигрированную запись задания
            migrated_data["task_history"][task_ref] = {
                "meta": {
                    "total_attempts": total_attempts,
                    "last_attempt_at": last_attempt_at,
                    "success_rate": round(success_rate, 2)
                },
                "attempts": truncated_attempts,
                "current_difficulty": task_data.get("current_difficulty", 1),
                "mastery_level": task_data.get("mastery_level", "beginner")
            }
        
        # Рассчитываем global_stats
        migrated_data["global_stats"] = {
            "total_attempts": global_total_attempts,
            "total_time_seconds": global_total_time
        }
        
        self.logger.info(
            f"Migration completed: {len(migrated_data['task_history'])} tasks, "
            f"{global_total_attempts} total attempts"
        )
        
        return migrated_data
    
    def _save_progress(self, data: Optional[Dict[str, Any]] = None):
        """
        Сохраняет прогресс в файл атомарно (через временный файл).
        
        Использует атомарную запись для предотвращения потери данных при краше
        во время записи. Записывает данные во временный файл, затем атомарно
        заменяет оригинальный файл.
        
        Args:
            data: Данные для сохранения (если None, используется self.progress_data)
        """
        if data is None:
            data = self.progress_data
        
        # Обновляем updated_at для версии 3.0
        if data.get("version") == "3.0":
            data["updated_at"] = datetime.now().isoformat()
        
        # Валидируем перед сохранением
        errors = ProgressSchema.validate(data)
        if errors:
            self.logger.error(f"Invalid progress data before save: {errors}")
            raise TaskValidationError(f"Invalid progress data: {errors}")
        
        # Получаем директорию файла (преобразуем Path в строку)
        dir_path = str(self.progress_file.parent)
        progress_file_str = str(self.progress_file)
        
        # Создаем временный файл в той же директории
        try:
            with tempfile.NamedTemporaryFile(
                mode='w',
                dir=dir_path,
                delete=False,
                encoding='utf-8',
                suffix='.tmp'
            ) as tf:
                json.dump(data, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            
            # Атомарная замена файла
            try:
                os.replace(temp_name, progress_file_str)
            except OSError:
                # Fallback для Windows, если файл заблокирован
                # Сначала удаляем оригинальный файл, затем переименовываем временный
                if os.path.exists(progress_file_str):
                    os.remove(progress_file_str)
                os.rename(temp_name, progress_file_str)
            
            self.logger.debug(f"Progress saved atomically for user {self.user_id}")
            
        except Exception as e:
            self.logger.error(f"Failed to save progress for user {self.user_id}: {e}")
            # Пытаемся удалить временный файл, если он остался
            if 'temp_name' in locals() and os.path.exists(temp_name):
                try:
                    os.remove(temp_name)
                except Exception:
                    pass
            raise

    def add_complex_completion(self, complex_id: str, session_id: Optional[str] = None, timestamp: Optional[str] = None):
        """
        Добавляет событие завершения комплекса в progress.json (complex_completions).
        """
        ts = timestamp or datetime.utcnow().isoformat()
        entry = {
            "complex_id": complex_id,
            "session_id": session_id,
            "timestamp": ts,
            "date": ts.split("T")[0] if "T" in ts else ts
        }
        completions = self.progress_data.get("complex_completions")
        if completions is None or not isinstance(completions, list):
            completions = []
            self.progress_data["complex_completions"] = completions
        completions.append(entry)
        try:
            self._save_progress()
            self.logger.info(f"Added complex completion for user {self.user_id}: {complex_id} ({entry['date']})")
        except Exception as e:
            self.logger.error(f"Failed to add complex completion: {e}")

    def _get_task_ref(self, module_id: str, topic_id: str, task_id: str) -> str:
        """
        Формирует ключ для task_history.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            str: Ключ в формате "module_id/topic_id/task_id"
        """
        return f"{module_id}/{topic_id}/{task_id}"

    def save_attempt(self, module_id: str, topic_id: str, task_id: str,
                     difficulty: int, success: bool,
                     time_spent: int, complex_id: Optional[str] = None,
                     iteration: Optional[int] = None,
                     error_context: Optional[Dict[str, Any]] = None,
                     task_type: Optional[str] = None,
                     score: Optional[float] = None) -> bool:
        """
        Сохраняет попытку выполнения задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            difficulty: Уровень сложности (1-3)
            success: Успешность попытки
            time_spent: Время выполнения в секундах
            complex_id: ID комплекса (опционально)
            iteration: Номер итерации (опционально)
            error_context: Контекст ошибки для mistake_bank (опционально, для версии 3.0)
            task_type: Тип задания для эскалации уровней (опционально, Шаг 2.7)
        
        Returns:
            bool: True если сохранение успешно
        
        Raises:
            ValueError: Если параметры невалидны
            TaskValidationError: Если данные не прошли валидацию
        """
        # Валидация параметров
        if difficulty < 1 or difficulty > 3:
            raise ValueError("difficulty должен быть в диапазоне 1-3")
        
        if time_spent < 0:
            raise ValueError("time_spent не может быть отрицательным")
        
        task_ref = self._get_task_ref(module_id, topic_id, task_id)
        
        # Создаем запись попытки
        attempt = {
            "timestamp": datetime.now().isoformat(),
            "difficulty": difficulty,
            "success": success,
            "time_spent": time_spent,
            "complex_id": complex_id,
            "iteration": iteration,
        }
        
        if score is not None:
            attempt["score"] = score
        
        # Получаем или создаем запись для задания
        if task_ref not in self.progress_data["task_history"]:
            # Определяем версию для создания правильной структуры
            version = self.progress_data.get("version", "2.0")
            
            if version == "3.0":
                # Структура версии 3.0 с полем meta
                self.progress_data["task_history"][task_ref] = {
                    "meta": {
                        "total_attempts": 0,
                        "last_attempt_at": datetime.now().isoformat(),
                        "success_rate": 0.0
                    },
                    "attempts": [],
                    "current_difficulty": difficulty,
                    "mastery_level": "beginner"
                }
            else:
                # Структура версии 2.0 (для обратной совместимости)
                self.progress_data["task_history"][task_ref] = {
                    "attempts": [],
                    "current_difficulty": difficulty,
                    "mastery_level": "beginner"
                }
        
        task_entry = self.progress_data["task_history"][task_ref]
        
        # Добавляем попытку
        task_entry["attempts"].append(attempt)
        
        # Применяем усечение истории (Rolling Window)
        self._truncate_attempts_history(task_entry)
        
        # Обновляем статистику инкрементально (для версии 3.0)
        version = self.progress_data.get("version", "2.0")
        if version == "3.0":
            self._update_global_stats(time_spent)
            self._update_task_meta(task_entry, success)
            task_entry["mastery_level"] = self._calculate_mastery_level(task_entry)
        
        # Сохраняем прогресс
        try:
            self._save_progress()
            
            # Публикуем событие для инвалидации кэша статистики
            if self.event_bus:
                self.event_bus.publish('progress_updated', user_id=self.user_id)
            
            self.logger.info(
                f"Saved attempt for {task_ref}: success={success}, difficulty={difficulty}"
            )
            return True
        except Exception as e:
            self.logger.error(f"Failed to save attempt for {task_ref}: {e}")
            return False
    
    def _calculate_new_difficulty(self, task_entry: Dict[str, Any], 
                                  current_difficulty: int, success: bool, 
                                  task_type: Optional[str] = None,
                                  task_ref: Optional[str] = None) -> int:
        """
        Вычисляет новый уровень сложности на основе результата попытки (Шаг 2.7).
        
        Логика эскалации:
        - При успехе (success=True): повысить уровень (если не максимальный)
        - При неудаче (success=False): понизить уровень (если не минимальный)
        
        Args:
            task_entry: Запись задания из task_history
            current_difficulty: Текущий уровень сложности
            success: Успешность попытки
            task_type: Тип задания (click, draw, test, и т.д.) для получения доступных уровней
            task_ref: Ссылка на задание (module/topic/task) для получения доступных уровней
        
        Returns:
            int: Новый уровень сложности
        """
        # Получаем доступные уровни через DifficultyManager
        if self.difficulty_manager and task_type:
            try:
                available_levels = self.difficulty_manager.get_available_levels(task_type, task_ref)
                if not available_levels:
                    available_levels = [1, 2, 3]
            except Exception as e:
                self.logger.warning(
                    f"Ошибка при получении доступных уровней для {task_ref}: {e}, "
                    f"используем fallback"
                )
                available_levels = [1, 2, 3]
        else:
            # Fallback если DifficultyManager не доступен или task_type не указан
            available_levels = [1, 2, 3]

        normalized_current = (
            self.difficulty_manager.normalize_requested_level(current_difficulty, available_levels)
            if self.difficulty_manager
            else current_difficulty
        )
        
        # Логика эскалации
        if success:
            new_level = (
                self.difficulty_manager.get_next_allowed_level(normalized_current, available_levels)
                if self.difficulty_manager
                else min(normalized_current + 1, max(available_levels))
            )
            if new_level != normalized_current:
                self.logger.info(
                    f"Эскалация: уровень {normalized_current} → {new_level} "
                    f"(успех) для {task_ref}"
                )
            return new_level
        elif not success:
            new_level = (
                self.difficulty_manager.get_previous_allowed_level(normalized_current, available_levels)
                if self.difficulty_manager
                else max(normalized_current - 1, min(available_levels))
            )
            if new_level != normalized_current:
                self.logger.info(
                    f"Эскалация: уровень {normalized_current} → {new_level} "
                    f"(неудача) для {task_ref}"
                )
            return new_level
        else:
            return normalized_current
    
    def _truncate_attempts_history(self, task_entry: Dict[str, Any]):
        """
        Усекает историю попыток до MAX_HISTORY (Rolling Window).
        
        Согласно рекомендации из плана:
        - Хранить best_score в meta, а массив attempts жестко резать до последних 20
        - Старые рекорды в деталях не нужны, важен факт рекорда
        
        Args:
            task_entry: Запись задания из task_history
        """
        attempts = task_entry.get("attempts", [])
        
        # Если попыток меньше или равно лимиту, ничего не делаем
        if len(attempts) <= self.MAX_HISTORY:
            return
        
        # Жестко обрезаем массив до последних MAX_HISTORY элементов
        task_entry["attempts"] = attempts[-self.MAX_HISTORY:]
        
        self.logger.debug(
            f"Truncated attempts history to {len(task_entry['attempts'])} entries "
            f"(max: {self.MAX_HISTORY})"
        )
    
    def _update_global_stats(self, time_spent: int):
        """
        Инкрементально обновляет глобальную статистику пользователя.
        
        Args:
            time_spent: Время выполнения в секундах
        """
        if "global_stats" not in self.progress_data:
            self.progress_data["global_stats"] = {
                "total_attempts": 0,
                "total_time_seconds": 0
            }
        
        global_stats = self.progress_data["global_stats"]
        
        # Обновляем счетчики
        total_attempts = global_stats.get("total_attempts", 0) + 1
        total_time = global_stats.get("total_time_seconds", 0) + time_spent
        
        global_stats["total_attempts"] = total_attempts
        global_stats["total_time_seconds"] = total_time
    
    def _update_task_meta(self, task_entry: Dict[str, Any], success: bool):
        """
        Инкрементально обновляет метаданные задания (meta).
        
        Args:
            task_entry: Запись задания из task_history
            success: Успешность попытки
        """
        if "meta" not in task_entry:
            # Создаем meta, если его нет (для миграции с версии 2.0)
            task_entry["meta"] = {
                "total_attempts": 0,
                "last_attempt_at": datetime.now().isoformat(),
                "success_rate": 0.0
            }
        
        meta = task_entry["meta"]
        attempts = task_entry.get("attempts", [])
        
        # Обновляем total_attempts (используем длину массива attempts)
        meta["total_attempts"] = len(attempts)
        
        # Обновляем last_attempt_at
        if attempts:
            last_attempt = attempts[-1]
            meta["last_attempt_at"] = last_attempt.get("timestamp", datetime.now().isoformat())
        
        # Пересчитываем success_rate
        if attempts:
            successful_count = sum(1 for attempt in attempts if attempt.get("success", False))
            meta["success_rate"] = round(successful_count / len(attempts), 2)
        else:
            meta["success_rate"] = 0.0

    def _calculate_mastery_level(self, task_entry: Dict[str, Any]) -> str:
        """
        Определяет уровень мастерства по последним попыткам.
        """
        attempts = task_entry.get("attempts", [])
        if not attempts:
            return "beginner"

        recent_attempts = attempts[-5:] if len(attempts) > 5 else attempts
        if len(recent_attempts) < 3:
            return "beginner"

        successful_count = sum(1 for a in recent_attempts if a.get("success", False))
        success_rate = successful_count / len(recent_attempts) if recent_attempts else 0.0

        last_3_attempts = recent_attempts[-3:]
        last_3_successful = all(a.get("success", False) for a in last_3_attempts)

        # Деградация по давности
        degraded = False
        meta = task_entry.get("meta", {})
        last_attempt_at_str = meta.get("last_attempt_at")
        if last_attempt_at_str:
            try:
                last_attempt_at = datetime.fromisoformat(last_attempt_at_str.replace('Z', '+00:00'))
                if last_attempt_at.tzinfo:
                    last_attempt_at = last_attempt_at.replace(tzinfo=None)
                if (datetime.now() - last_attempt_at).days > 30:
                    degraded = True
            except Exception:
                pass

        if success_rate >= 0.9 or (success_rate >= 0.8 and last_3_successful):
            return "good" if degraded else "expert"
        if success_rate >= 0.7:
            return "good"
        return "beginner"
    
    def _update_mistake_bank(self, module_id: str, topic_id: str, task_id: str,
                            difficulty: int, success: bool, 
                            error_context: Optional[Dict[str, Any]] = None):
        """
        Обновляет банк ошибок (Schema 3.0).
        
        Логика работы:
        - При сохранении ошибки игнорируется уровень сложности
        - Ключ поиска в банке: f"{module}/{topic}/{task}"
        
        Если success == False:
        - Сброс success_streak = 0
        - fail_count += 1
        - Обновление error_context
        
        Если success == True:
        - success_streak += 1
        - Если success_streak >= 2: Удалить запись из банка
        - Иначе: Обновить запись (сохранить новый стрик), но не удалять
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
            difficulty: Уровень сложности (игнорируется в версии 3.0)
            success: Успешность попытки
            error_context: Контекст ошибки (опционально, для версии 3.0)
        """
        version = self.progress_data.get("version", "2.0")
        mistake_bank = self.progress_data["mistake_bank"]
        
        if version == "3.0":
            # Новая логика для версии 3.0
            key = f"{module_id}/{topic_id}/{task_id}"
            now = datetime.now().isoformat()
            
            # Ищем запись в mistake_bank по ключу (без level)
            mistake_index = None
            for i, mistake in enumerate(mistake_bank):
                if mistake.get("key") == key:
                    mistake_index = i
                    break
            
            if success:
                # Успешная попытка полностью снимает ошибку из банка
                if mistake_index is not None:
                    mistake_bank.pop(mistake_index)
                    self.logger.debug(f"Removed from mistake_bank after success: {key}")
                # Если записи нет, ничего не делаем (успешная попытка без ошибок)
            else:
                # Неудачная попытка
                if mistake_index is not None:
                    # Обновляем существующую запись
                    mistake_bank[mistake_index]["fail_count"] += 1
                    mistake_bank[mistake_index]["success_streak"] = 0  # Сброс стрика
                    mistake_bank[mistake_index]["last_failed"] = now
                    
                    # Обновляем error_context, если передан
                    if error_context is not None:
                        mistake_bank[mistake_index]["error_context"] = error_context
                    
                    self.logger.debug(
                        f"Updated mistake_bank entry: {key} "
                        f"(fail_count: {mistake_bank[mistake_index]['fail_count']})"
                    )
                else:
                    # Создаем новую запись
                    new_entry = {
                        "key": key,
                        "fail_count": 1,
                        "success_streak": 0,
                        "last_failed": now
                    }
                    
                    # Добавляем error_context, если передан
                    if error_context is not None:
                        new_entry["error_context"] = error_context
                    
                    mistake_bank.append(new_entry)
                    self.logger.debug(f"Added to mistake_bank: {key}")
        else:
            # Старая логика для версии 2.0 (обратная совместимость)
            # Ищем запись в mistake_bank
            mistake_index = None
            for i, mistake in enumerate(mistake_bank):
                if (mistake.get("module") == module_id and
                    mistake.get("topic") == topic_id and
                    mistake.get("task") == task_id and
                    mistake.get("level") == difficulty):
                    mistake_index = i
                    break
            
            if success:
                # Успешная попытка - удаляем из mistake_bank
                if mistake_index is not None:
                    mistake_bank.pop(mistake_index)
                    self.logger.debug(f"Removed from mistake_bank: {module_id}/{topic_id}/{task_id} (level {difficulty})")
            else:
                # Неудачная попытка - добавляем или обновляем
                now = datetime.now().isoformat()
                if mistake_index is not None:
                    # Обновляем существующую запись
                    mistake_bank[mistake_index]["fail_count"] += 1
                    mistake_bank[mistake_index]["last_failed"] = now
                else:
                    # Создаем новую запись
                    mistake_bank.append({
                        "module": module_id,
                        "topic": topic_id,
                        "task": task_id,
                        "level": difficulty,
                        "fail_count": 1,
                        "last_failed": now
                    })
                    self.logger.debug(f"Added to mistake_bank: {module_id}/{topic_id}/{task_id} (level {difficulty})")
    
    def get_task_history(self, module_id: str, topic_id: str, task_id: str) -> Optional[Dict[str, Any]]:
        """
        Получает историю попыток для задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            Dict[str, Any] или None: {
                "attempts": [...],
                "current_difficulty": int,
                "mastery_level": str
            }
        """
        task_ref = self._get_task_ref(module_id, topic_id, task_id)
        return self.progress_data["task_history"].get(task_ref)
    
    def get_all_attempts(self, module_id: str, topic_id: str, task_id: str) -> List[Dict[str, Any]]:
        """
        Получает список всех попыток для задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            List[Dict[str, Any]]: Список попыток (от старых к новым)
        """
        task_history = self.get_task_history(module_id, topic_id, task_id)
        if task_history:
            return task_history.get("attempts", [])
        return []
    
    def get_mistake_bank(self) -> List[Dict[str, Any]]:
        """
        Получает банк ошибок, отсортированный по fail_count (по убыванию).
        
        Returns:
            List[Dict[str, Any]]: Список ошибок, отсортированный по fail_count
        """
        task_history = self.progress_data.get("task_history", {})
        if isinstance(task_history, dict) and task_history:
            normalized: List[Dict[str, Any]] = []
            for task_ref, entry in task_history.items():
                attempts = entry.get("attempts", [])
                if not attempts:
                    continue
                
                last_attempt = attempts[-1]
                if last_attempt.get("success"):
                    # Последняя попытка успешна — задача не считается открытой ошибкой
                    continue
                
                failed_attempts = [a for a in attempts if not a.get("success", False)]
                if not failed_attempts:
                    continue
                
                last_failed = max(
                    failed_attempts,
                    key=lambda a: a.get("timestamp", "")
                )
                
                parts = task_ref.split("/")
                module_id = parts[0] if len(parts) > 0 else ""
                topic_id = parts[1] if len(parts) > 1 else ""
                task_id = parts[2] if len(parts) > 2 else parts[-1]
                
                normalized.append({
                    "module": module_id,
                    "topic": topic_id,
                    "task": task_id,
                    "level": last_failed.get("difficulty", entry.get("current_difficulty", 1)),
                    "fail_count": len(failed_attempts),
                    "last_failed": last_failed.get("timestamp"),
                    "key": task_ref,
                })
            
            normalized.sort(key=lambda x: x.get("fail_count", 0), reverse=True)
            return normalized
        
        mistake_bank = self.progress_data.get("mistake_bank", []).copy()
        mistake_bank.sort(key=lambda x: x.get("fail_count", 0), reverse=True)
        return mistake_bank
    
    def get_mistakes_for_task(self, module_id: str, topic_id: str, task_id: str) -> List[Dict[str, Any]]:
        """
        Получает ошибки для конкретного задания.
        
        Поддерживает версии 2.0 и 3.0 схемы mistake_bank.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            List[Dict[str, Any]]: Список ошибок для задания
        """
        version = self.progress_data.get("version", "2.0")
        mistake_bank = self.get_mistake_bank()
        
        if version == "3.0":
            return [
                mistake for mistake in mistake_bank
                if (
                    mistake.get("module") == module_id and
                    mistake.get("topic") == topic_id and
                    mistake.get("task") == task_id
                )
            ]
        else:
            return [
                mistake for mistake in mistake_bank
                if (mistake.get("module") == module_id and
                    mistake.get("topic") == topic_id and
                    mistake.get("task") == task_id)
            ]
    
    def reset_task_history(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """
        Сбрасывает историю попыток для задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если сброс успешен
        """
        task_ref = self._get_task_ref(module_id, topic_id, task_id)
        
        if task_ref in self.progress_data["task_history"]:
            del self.progress_data["task_history"][task_ref]
            
            # Удаляем из mistake_bank
            version = self.progress_data.get("version", "2.0")
            mistake_bank = self.progress_data["mistake_bank"]
            
            if version == "3.0":
                # Для версии 3.0 используем ключ
                key = f"{module_id}/{topic_id}/{task_id}"
                self.progress_data["mistake_bank"] = [
                    mistake for mistake in mistake_bank
                    if mistake.get("key") != key
                ]
            else:
                # Для версии 2.0 используем старую структуру
                self.progress_data["mistake_bank"] = [
                    mistake for mistake in mistake_bank
                    if not (mistake.get("module") == module_id and
                           mistake.get("topic") == topic_id and
                           mistake.get("task") == task_id)
                ]
            
            try:
                self._save_progress()
                self.logger.info(f"Reset task history for {task_ref}")
                return True
            except Exception as e:
                self.logger.error(f"Failed to reset task history: {e}")
                return False
        
        return True  # Уже нет истории
    
    def remove_last_attempt(self, module_id: str, topic_id: str, task_id: str) -> bool:
        """
        Удаляет последнюю попытку выполнения задания.
        
        Args:
            module_id: ID модуля
            topic_id: ID темы
            task_id: ID задания
        
        Returns:
            bool: True если удаление успешно, False если попыток нет
        """
        task_ref = self._get_task_ref(module_id, topic_id, task_id)
        
        if task_ref not in self.progress_data["task_history"]:
            return False
        
        task_entry = self.progress_data["task_history"][task_ref]
        attempts = task_entry.get("attempts", [])
        
        if not attempts:
            return False
        
        # Удаляем последнюю попытку
        attempts.pop()
        
        # Обновляем статистику для версии 3.0
        version = self.progress_data.get("version", "2.0")
        if version == "3.0":
            # Пересчитываем meta
            if attempts:
                # Обновляем last_attempt_at на последнюю попытку
                last_attempt = attempts[-1]
                task_entry["meta"]["last_attempt_at"] = last_attempt.get("timestamp", datetime.now().isoformat())
                
                # Пересчитываем success_rate
                successful_count = sum(1 for a in attempts if a.get("success", False))
                task_entry["meta"]["success_rate"] = successful_count / len(attempts) if attempts else 0.0
            else:
                # Если попыток не осталось, сбрасываем meta
                task_entry["meta"]["last_attempt_at"] = None
                task_entry["meta"]["success_rate"] = 0.0
            
            task_entry["meta"]["total_attempts"] = len(attempts)
        
        # Пересчитываем mastery_level
        task_entry["mastery_level"] = self._calculate_mastery_level(task_entry)
        
        # Сохраняем прогресс
        try:
            self._save_progress()
            self.logger.info(f"Removed last attempt for {task_ref}")
            return True
        except Exception as e:
            self.logger.error(f"Failed to remove last attempt: {e}")
            return False
    
    def get_progress_data(self) -> Dict[str, Any]:
        """
        Получает полные данные прогресса (для отладки/экспорта).
        
        Returns:
            Dict[str, Any]: Полные данные прогресса
        """
        return self.progress_data.copy()
    
    def switch_user(self, user_id: str):
        """
        Переключает менеджер на другого пользователя.
        
        Обновляет пути к файлам и перезагружает данные для нового пользователя.
        
        Args:
            user_id: ID нового пользователя
        """
        if self.user_id == user_id:
            # Уже работаем с этим пользователем
            self.logger.debug(f"Already working with user {user_id}, skipping switch")
            return
        
        self.logger.info(f"Switching UserProgressManager from {self.user_id} to {user_id}")
        
        # Сохраняем данные текущего пользователя перед переключением
        try:
            self._save_progress()
        except Exception as e:
            self.logger.warning(f"Failed to save progress for {self.user_id} before switch: {e}")
        
        # Обновляем user_id
        old_user_id = self.user_id
        self.user_id = user_id
        
        # Обновляем пути к файлам
        self.user_dir = self.users_dir / user_id
        self.progress_file = self.user_dir / "progress.json"
        
        # Создаем директорию пользователя, если её нет
        self.user_dir.mkdir(parents=True, exist_ok=True)
        
        # Перезагружаем данные для нового пользователя
        self.progress_data = self._load_or_create_progress()
        
        # Логируем информацию о загруженных данных для отладки
        task_count = len(self.progress_data.get("task_history", {}))
        total_attempts = sum(
            len(task_data.get("attempts", []))
            for task_data in self.progress_data.get("task_history", {}).values()
        )
        self.logger.info(
            f"UserProgressManager switched to user: {user_id}. "
            f"Loaded {task_count} tasks with {total_attempts} total attempts"
        )

