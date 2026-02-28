"""
Difficulty Manager - Система уровней сложности для заданий

Модифицирует задания в памяти для разных уровней сложности.
НЕ изменяет исходные файлы заданий.
"""

import copy
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

# Импортируем загрузчик конфигурации
try:
    from services.difficulty_config_loader import DifficultyConfigLoader
    CONFIG_LOADER_AVAILABLE = True
except ImportError:
    CONFIG_LOADER_AVAILABLE = False
    DifficultyConfigLoader = None

# Импортируем hooks для интеграции с плагинами
try:
    from task_system.core.hooks.difficulty_hooks import difficulty_hooks
    HOOKS_AVAILABLE = True
except ImportError:
    HOOKS_AVAILABLE = False
    difficulty_hooks = None

logger = logging.getLogger(__name__)


class DifficultyManager:
    """
    Менеджер уровней сложности для заданий.
    
    Модифицирует задания в памяти для разных уровней сложности.
    НЕ изменяет исходные файлы заданий.
    
    Использует DifficultyConfigLoader для загрузки конфигурации из difficulty_config.json.
    Поддерживает переопределения уровней для конкретных заданий и типов заданий.
    
    Поддерживаемые типы заданий:
    - click: уровни 1-3 (клик → клик+название → обводка+название)
    - draw: уровни 1-2 (рисование → рисование+название)
    - test: уровни 1-2 (множественный выбор → открытый вопрос)
    - sequence_assembly: уровни 1-3 (все подсказки → названия уровней → названия уровней и блоков)
    - open_answer: только уровень 1 (не поддерживает уровни)
    - Плагинные типы: через hooks (fallback на уровень 1)
    """
    
    def __init__(self, config_path: Optional[str] = None):
        """
        Инициализация DifficultyManager.
        
        Args:
            config_path: Путь к файлу конфигурации (если None, определяется автоматически)
        """
        self.config_path = config_path
        self.logger = logging.getLogger(self.__class__.__name__)
        
        # Загружаем конфигурацию через DifficultyConfigLoader
        if CONFIG_LOADER_AVAILABLE and DifficultyConfigLoader:
            try:
                self.config = DifficultyConfigLoader.load_config(config_path)
                self.logger.debug(f"Конфигурация уровней сложности загружена")
            except Exception as e:
                self.logger.warning(f"Ошибка загрузки конфигурации: {e}, используем дефолтные значения")
                self.config = {}
        else:
            self.logger.warning("DifficultyConfigLoader не доступен, используем дефолтные значения")
            self.config = {}
        
        # Получаем дефолтные уровни из конфигурации или используем значения по умолчанию
        self.default_levels = self._get_default_levels()
        
        # Hooks для интеграции с плагинами
        self.hooks_available = HOOKS_AVAILABLE
    
    def _get_default_levels(self) -> Dict[str, List[int]]:
        """
        Получает дефолтные уровни из конфигурации или возвращает значения по умолчанию.
        
        Returns:
            Словарь с дефолтными уровнями для каждого типа задания
        """
        if self.config and 'default_levels' in self.config:
            return self.config['default_levels'].copy()
        
        # Fallback на дефолтные значения
        return {
            "click": [1, 2, 3],
            "draw": [1, 2],  # Убрали уровень 3 для заданий типа рисование
            "test": [1, 2],
            "sequence_assembly": [1, 2, 3],
            "open_answer": [1]
        }
    
    def get_available_levels(self, task_type: str, task_ref: Optional[str] = None) -> List[int]:
        """
        Получить доступные уровни для задания.
        
        Args:
            task_type: Тип задания (click, draw, test, sequence_assembly, open_answer)
            task_ref: Ссылка на задание (module/topic/task) для проверки переопределений
        
        Returns:
            Список доступных уровней [1, 2, 3]
        """
        # Проверяем hooks для плагинных типов
        if self.hooks_available and difficulty_hooks:
            plugin_levels = difficulty_hooks.call_get_levels(task_type, task_ref)
            if plugin_levels is not None:
                self.logger.debug(f"Плагин вернул уровни для {task_type}: {plugin_levels}")
                return plugin_levels
        
        # 1. Проверяем переопределение для конкретного задания
        if task_ref and self.config.get('task_overrides', {}).get(task_ref):
            override_levels = self.config['task_overrides'][task_ref].get('levels')
            if override_levels:
                self.logger.debug(f"Найдено переопределение для задания {task_ref}: {override_levels}")
                return override_levels
        
        # 2. Проверяем переопределение для типа
        if self.config.get('type_overrides', {}).get(task_type):
            max_level = self.config['type_overrides'][task_type].get('max_level', 3)
            levels = list(range(1, max_level + 1))
            self.logger.debug(f"Найдено переопределение для типа {task_type}: {levels}")
            return levels
        
        # 3. Используем значения по умолчанию
        return self.default_levels.get(task_type, [1])
    
    def get_smart_retry_config(self) -> Dict[str, Any]:
        """
        Возвращает конфигурацию Smart Retry.
        """
        return self.config.get('smart_retry_defaults', {
            "near_offset": 2,
            "near_jitter_max": 2,
            "max_copies": 5,
            "training_control_enabled": True
        })
    
    def enhance_task_for_level(
        self, 
        task_data: Dict[str, Any], 
        level: int,
        task_ref: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Модифицирует задание в памяти для заданного уровня.
        
        НЕ изменяет исходный файл.
        
        Args:
            task_data: Исходные данные задания (из task.json)
            level: Уровень сложности (1, 2, 3)
            task_ref: Ссылка на задание для логирования
        
        Returns:
            Модифицированное задание (копия, исходное не изменено)
        
        ВАЖНО: Добавляет флаги валидации:
        - _difficulty_enhanced: True - помечает, что задание модифицировано
        - _original_type: исходный тип задания - для сохранения исходного типа
        """
        try:
            # Логируем начало модификации
            self.logger.debug(
                f"Начало модификации задания для уровня {level}, "
                f"ref={task_ref}"
            )
            
            # Создаем глубокую копию для модификации
            enhanced = copy.deepcopy(task_data)
            
            # Определяем исходный тип задания
            original_type = enhanced.get('type') or enhanced.get('content', {}).get('type', 'unknown')
            
            self.logger.debug(
                f"Исходный тип задания: {original_type}, "
                f"применяемый уровень: {level}"
            )
            
            # ВАЖНО: Добавляем флаги валидации
            # Эти флаги используются для идентификации модифицированных заданий
            enhanced['_difficulty_enhanced'] = True
            enhanced['_original_type'] = original_type
            enhanced['_difficulty_level'] = level
            
            # Вызываем hook before_enhance (если доступен)
            if self.hooks_available and difficulty_hooks:
                enhanced_before = copy.deepcopy(enhanced)
                enhanced = difficulty_hooks.call_before_enhance(enhanced, level, task_ref)
                if enhanced != enhanced_before:
                    self.logger.debug(
                        f"Hook before_enhance модифицировал задание для типа {original_type}"
                    )
            
            # Определяем тип задания для модификации
            task_type = enhanced.get('type') or enhanced.get('content', {}).get('type', 'unknown')
            
            # Модифицируем задание в зависимости от типа и уровня
            if task_type == 'click':
                self.logger.debug(f"Применение модификации для click задания, уровень {level}")
                enhanced = self._enhance_click_task(enhanced, level)
            elif task_type == 'draw':
                self.logger.debug(f"Применение модификации для draw задания, уровень {level}")
                enhanced = self._enhance_draw_task(enhanced, level)
            elif task_type == 'test':
                self.logger.debug(f"Применение модификации для test задания, уровень {level}")
                enhanced = self._enhance_test_task(enhanced, level)
            elif task_type == 'sequence_assembly':
                self.logger.debug(f"Применение модификации для sequence_assembly задания, уровень {level}")
                enhanced = self._enhance_sequence_task(enhanced, level)
            elif task_type == 'open_answer':
                # Open Answer не поддерживает уровни - возвращаем как есть
                self.logger.debug("Open Answer не поддерживает уровни сложности, возвращаем исходное задание")
                pass
            else:
                # Неизвестный тип - проверяем hooks для плагинных типов
                if self.hooks_available and difficulty_hooks:
                    # Проверяем, есть ли обработчики для плагинного типа
                    plugin_levels = difficulty_hooks.call_get_levels(task_type, task_ref)
                    if plugin_levels and level in plugin_levels:
                        # Плагин поддерживает этот уровень - используем hooks для модификации
                        # hook already called in call_before_enhance above
                        plugin_enhanced = difficulty_hooks.call_before_enhance(enhanced, level, task_ref)
                        if plugin_enhanced != enhanced:
                            enhanced = plugin_enhanced
                            self.logger.debug(
                                f"Плагин модифицировал задание типа {task_type} для уровня {level}"
                            )
                    else:
                        # Плагин не поддерживает этот уровень или нет обработчиков
                        # Возвращаем задание как есть (уровень 1)
                        self.logger.debug(
                            f"Плагин не поддерживает уровень {level} для типа {task_type}, "
                            f"доступные уровни: {plugin_levels}"
                        )
                else:
                    # Hooks не доступны - возвращаем задание как есть (уровень 1)
                    self.logger.debug(
                        f"Hooks не доступны, тип {task_type} не поддерживает уровни сложности, "
                        f"возвращаем исходное задание"
                    )
            
            # Вызываем hook after_enhance (если доступен)
            if self.hooks_available and difficulty_hooks:
                enhanced_after = copy.deepcopy(enhanced)
                enhanced = difficulty_hooks.call_after_enhance(enhanced, level, task_ref)
                if enhanced != enhanced_after:
                    self.logger.debug(
                        f"Hook after_enhance модифицировал задание для типа {task_type}"
                    )
            
            # Логируем итоговые изменения
            content = enhanced.get('content', {})
            mode = content.get('mode', 'unknown')
            requires_labels = content.get('requires_labels', False)
            requires_drawing = content.get('requires_drawing', False)
            
            self.logger.info(
                f"Задание успешно модифицировано для уровня {level}: "
                f"тип={task_type}, ref={task_ref}, mode={mode}, "
                f"requires_labels={requires_labels}, requires_drawing={requires_drawing}"
            )
            
            self.logger.debug(
                f"Детали модификации: "
                f"flags=[_difficulty_enhanced={enhanced.get('_difficulty_enhanced')}, "
                f"_original_type={enhanced.get('_original_type')}, "
                f"_difficulty_level={enhanced.get('_difficulty_level')}]"
            )
            
            return enhanced
            
        except Exception as e:
            # При ошибке логируем и возвращаем исходное задание (fallback на уровень 1)
            self.logger.error(
                f"Ошибка при модификации задания для уровня {level}: {e}, "
                f"ref={task_ref}, возвращаем исходное задание"
            )
            # Возвращаем исходное задание без модификации
            if task_data is None:
                # Если task_data None, возвращаем пустой словарь с флагом
                return {'_difficulty_enhanced': False}
            original = copy.deepcopy(task_data)
            original['_difficulty_enhanced'] = False  # Помечаем как не модифицированное
            return original
    
    def _enhance_click_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        Модификация click задания для уровня.
        
        Args:
            task_data: Данные задания
            level: Уровень сложности (1, 2, 3)
        
        Returns:
            Модифицированное задание
        """
        content = task_data.get('content', {})
        
        if level == 1:
            # Уровень 1: базовый клик (без изменений)
            content['mode'] = 'click'
            content['requires_labels'] = False
            content['requires_drawing'] = False
        elif level == 2:
            # Уровень 2: клик + название
            content['mode'] = 'click_and_label'
            content['requires_labels'] = True
            content['requires_drawing'] = False
            original_prompt = content.get('prompt', 'Кликните на область')
            content['prompt'] = f"{original_prompt} и назовите её"
        elif level == 3:
            # Уровень 3: обводка + название
            content['mode'] = 'draw_and_label'
            content['requires_labels'] = True
            content['requires_drawing'] = True
            original_prompt = content.get('prompt', 'Кликните на область')
            content['prompt'] = f"Обведите контур и назовите: {original_prompt}"
        
        task_data['content'] = content
        return task_data
    
    def _enhance_draw_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        Модификация draw задания для уровня.
        
        Args:
            task_data: Данные задания
            level: Уровень сложности (1, 2, 3)
        
        Returns:
            Модифицированное задание
        """
        content = task_data.get('content', {})
        
        if level == 1:
            content['mode'] = 'draw'
            content['requires_labels'] = False
            content['requires_explanation'] = False
        elif level == 2:
            # Уровень 2: рисование контуров + название (как уровень 3 для click)
            content['mode'] = 'draw_and_label'
            content['requires_labels'] = True
            content['requires_drawing'] = True  # Добавить это поле
            content['requires_explanation'] = False
            original_prompt = content.get('prompt', 'Обведите контур')
            content['prompt'] = f"Обведите контур и назовите: {original_prompt}"  # Изменить промпт как в click уровне 3
        elif level == 3:
            content['mode'] = 'draw_multiple_and_explain'
            content['requires_labels'] = True
            content['requires_explanation'] = True
            original_prompt = content.get('prompt', 'Обведите контур')
            content['prompt'] = f"Обведите несколько связанных структур и опишите связь между ними: {original_prompt}"
        
        task_data['content'] = content
        return task_data
    
    def _enhance_test_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        Модификация test задания для уровня.
        
        Args:
            task_data: Данные задания
            level: Уровень сложности (1, 2)
        
        Returns:
            Модифицированное задание
        """
        content = task_data.get('content', {})

        # P0 fix: test task must not inherit sequence_assembly flags.
        content.pop('show_level_labels', None)
        content.pop('show_block_labels', None)
        content.pop('requires_level_names', None)
        content.pop('requires_block_names', None)

        if level == 1:
            # TEST L1: multiple choice
            content['mode'] = 'multiple_choice'
            content['show_options'] = True
            content['requires_text_input'] = False
        elif level >= 2:
            # TEST supports only two levels; 2+ maps to open-text mode.
            content['mode'] = 'open_question'
            content['show_options'] = False
            content['requires_text_input'] = True

        task_data['content'] = content
        return task_data

    def _enhance_sequence_task(self, task_data: Dict[str, Any], level: int) -> Dict[str, Any]:
        """
        Sequence Assembly difficulty progression flags.

        L1: show level/block labels
        L2: require level names
        L3: require level names and block names
        """
        content = task_data.get('content', {})

        # Remove unrelated test flags if they leaked into content.
        content.pop('show_options', None)
        content.pop('requires_text_input', None)

        if level == 1:
            content['show_level_labels'] = True
            content['show_block_labels'] = True
            content['requires_level_names'] = False
            content['requires_block_names'] = False
        elif level == 2:
            content['show_level_labels'] = False
            content['show_block_labels'] = True
            content['requires_level_names'] = True
            content['requires_block_names'] = False
        elif level == 3:
            content['show_level_labels'] = False
            content['show_block_labels'] = False
            content['requires_level_names'] = True
            content['requires_block_names'] = True

        task_data['content'] = content
        return task_data
    
    def _should_use_draw_instead_of_click(self, task_data: Dict[str, Any]) -> bool:
        """
        Определяет, нужно ли использовать Draw вместо Click.
        
        Draw нужен, если в задании есть хотя бы одна freehand-аннотация.
        Если только полигоны - можно использовать Click.
        
        ПРИМЕЧАНИЕ: В текущей реализации этот метод не используется.
        Задания типа 'draw' всегда остаются типом 'draw' на всех уровнях.
        Оставлен для возможного будущего использования.
        """
        content = task_data.get('content', {})
        annotations = content.get('annotations', [])
        
        # Проверяем наличие freehand-аннотаций
        for ann in annotations:
            ann_type = ann.get('type', '')
            shape = ann.get('shape', '')
            if ann_type == 'freehand' or shape == 'freehand':
                return True  # Есть freehand - нужен Draw
        
        # Только полигоны - можно использовать Click
        return False
    
    def get_initial_level(self, task_data: Dict[str, Any]) -> int:
        """
        Определяет начальный уровень для задания.
        
        Использует settings.difficulty для обратной совместимости.
        Если уровень больше максимального доступного, возвращает максимальный.
        Если уровень меньше минимального доступного, возвращает минимальный.
        """
        # Используем settings.difficulty как начальный уровень
        default_level = task_data.get('settings', {}).get('difficulty', 1)
        
        # Ограничиваем диапазон в зависимости от типа задания
        task_type = task_data.get('type') or task_data.get('content', {}).get('type', 'click')
        available_levels = self.get_available_levels(task_type)
        
        if not available_levels:
            # Если нет доступных уровней, возвращаем 1
            return 1
        
        if default_level not in available_levels:
            # Если уровень не доступен, ограничиваем диапазон
            if default_level < min(available_levels):
                # Уровень меньше минимального - возвращаем минимальный
                return min(available_levels)
            else:
                # Уровень больше максимального - возвращаем максимальный
                return max(available_levels)
        
        return default_level

