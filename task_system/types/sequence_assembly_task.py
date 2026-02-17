"""
Тип задания "Сборка схем" (sequence_assembly)
Пользователь должен расставить элементы в правильной последовательности
"""

from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class SequenceAssemblyTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий на сборку схем"""
    
    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает правильность последовательности элементов по уровням"""
        if not isinstance(user_input, dict) or not isinstance(reference_data, dict):
            return {
                "success": False,
                "score": 0.0,
                "message": "Неверный формат данных",
                "metric": "percent",
                "details": {}
            }
        
        # Получаем уровни пользователя и правильные уровни
        user_levels = user_input.get('levels', [])
        correct_levels = reference_data.get('levels', [])
        sequence_matters = reference_data.get('sequence_within_level_matters', False)
        level_order_matters = reference_data.get('level_order_matters', False)
        
        # Обратная совместимость: если нет levels, но есть sequence
        if not user_levels and 'sequence' in user_input:
            user_sequence = user_input['sequence']
            user_levels = [{"level_id": f"level_{i+1}", "blocks": [elem_id]} 
                          for i, elem_id in enumerate(user_sequence)]
        
        if not correct_levels and 'correct_sequence' in reference_data:
            correct_sequence = reference_data['correct_sequence']
            correct_levels = [{"level_id": f"level_{i+1}", "blocks": [elem_id]} 
                             for i, elem_id in enumerate(correct_sequence)]
        
        if not user_levels or not correct_levels:
            return {
                "success": False,
                "score": 0.0,
                "message": "Отсутствует структура уровней для проверки",
                "metric": "percent",
                "details": {}
            }
        
        # Проверяем количество уровней
        if len(user_levels) != len(correct_levels):
            return {
                "success": False,
                "score": 0.0,
                "message": f"Неверное количество уровней. Ожидается: {len(correct_levels)}, получено: {len(user_levels)}",
                "metric": "percent",
                "details": {
                    "user_levels": user_levels,
                    "correct_levels": correct_levels,
                    "total_levels": len(correct_levels)
                }
            }
        
        # Подсчитываем правильные блоки и собираем детали ошибок
        correct_blocks = 0
        total_blocks = 0
        levels_in_correct_order = True
        incorrect_levels = []  # Список уровней с ошибками
        incorrect_sequences = []  # Список уровней с неправильной последовательностью
        
        if level_order_matters:
            # Порядок уровней важен - проверяем строгое соответствие позиций
            for i, (user_level, correct_level) in enumerate(zip(user_levels, correct_levels)):
                user_blocks = user_level.get("blocks", [])
                correct_blocks_list = correct_level.get("blocks", [])
                user_level_id = user_level.get("level_id", "")
                correct_level_id = correct_level.get("level_id", "")
                
                total_blocks += len(correct_blocks_list)
                
                # Проверяем, что level_id совпадает (правильный порядок)
                if user_level_id != correct_level_id:
                    levels_in_correct_order = False
                    incorrect_levels.append(i + 1)  # Номер уровня (1-based для пользователя)
                    continue
                
                if sequence_matters:
                    # Строгое совпадение последовательности внутри уровня
                    if user_blocks == correct_blocks_list:
                        correct_blocks += len(correct_blocks_list)
                    else:
                        # Последовательность неправильная
                        incorrect_sequences.append({
                            'level': i + 1,
                            'level_id': user_level_id,
                            'expected': correct_blocks_list,
                            'actual': user_blocks
                        })
                else:
                    # Проверяем только наличие блоков в уровне (порядок не важен)
                    user_blocks_set = set(user_blocks)
                    correct_blocks_set = set(correct_blocks_list)
                    if user_blocks_set == correct_blocks_set:
                        correct_blocks += len(correct_blocks_list)
                    else:
                        # Блоки в неправильном уровне
                        incorrect_levels.append(i + 1)
        else:
            # Порядок уровней не важен - сопоставляем по level_id
            correct_levels_dict = {level.get("level_id", ""): level for level in correct_levels}
            
            for idx, user_level in enumerate(user_levels):
                user_level_id = user_level.get("level_id", "")
                user_blocks = user_level.get("blocks", [])
                
                if user_level_id in correct_levels_dict:
                    correct_level = correct_levels_dict[user_level_id]
                    correct_blocks_list = correct_level.get("blocks", [])
                    
                    total_blocks += len(correct_blocks_list)
                    
                    if sequence_matters:
                        # Строгое совпадение последовательности внутри уровня
                        if user_blocks == correct_blocks_list:
                            correct_blocks += len(correct_blocks_list)
                        else:
                            # Последовательность неправильная
                            incorrect_sequences.append({
                                'level': idx + 1,
                                'level_id': user_level_id,
                                'expected': correct_blocks_list,
                                'actual': user_blocks
                            })
                    else:
                        # Проверяем только наличие блоков в уровне (порядок не важен)
                        user_blocks_set = set(user_blocks)
                        correct_blocks_set = set(correct_blocks_list)
                        if user_blocks_set == correct_blocks_set:
                            correct_blocks += len(correct_blocks_list)
                        else:
                            # Блоки в неправильном уровне
                            incorrect_levels.append(idx + 1)
                else:
                    # Уровень с несуществующим level_id
                    incorrect_levels.append(idx + 1)
        
        # Вычисляем процент правильности
        if total_blocks > 0:
            score = (correct_blocks / total_blocks) * 100
        else:
            score = 0.0
        
        # Определяем успешность
        if level_order_matters:
            success = (score == 100.0) and levels_in_correct_order
        else:
            success = (score == 100.0)
        
        return {
            "success": success,
            "score": score,
            "message": self._format_result_message(success, score, total_blocks, sequence_matters, level_order_matters, levels_in_correct_order, incorrect_levels, incorrect_sequences),
            "metric": "percent",
            "details": {
                "user_levels": user_levels,
                "correct_levels": correct_levels,
                "correct_blocks": correct_blocks,
                "total_blocks": total_blocks,
                "sequence_matters": sequence_matters,
                "level_order_matters": level_order_matters,
                "levels_in_correct_order": levels_in_correct_order,
                "incorrect_levels": incorrect_levels,
                "incorrect_sequences": incorrect_sequences
            }
        }
    
    def _format_result_message(self, success: bool, score: float, total_blocks: int, sequence_matters: bool = False, level_order_matters: bool = False, levels_in_correct_order: bool = True, incorrect_levels: list = None, incorrect_sequences: list = None) -> str:
        """Форматирует сообщение о результате с деталями ошибок"""
        if success:
            return f"Отлично! Структура уровней правильная ({score:.1f}%)"
        else:
            message_parts = []
            message_parts.append(f"Структура неверная. Правильных блоков: {score:.1f}% из {total_blocks}")
            
            incorrect_levels = incorrect_levels or []
            incorrect_sequences = incorrect_sequences or []
            
            if level_order_matters and not levels_in_correct_order and incorrect_levels:
                if len(incorrect_levels) == 1:
                    message_parts.append(f"Неправильный порядок: уровень {incorrect_levels[0]} на неправильной позиции")
                elif len(incorrect_levels) == 2:
                    message_parts.append(f"Неправильный порядок уровней: {incorrect_levels[0]} и {incorrect_levels[1]}")
                else:
                    message_parts.append(f"Неправильный порядок уровней: {', '.join(map(str, incorrect_levels[:3]))}{'...' if len(incorrect_levels) > 3 else ''}")
            
            if incorrect_sequences:
                for seq in incorrect_sequences[:2]:  # Показываем максимум 2 уровня
                    level_name = seq.get('level_id', f"уровня {seq['level']}")
                    message_parts.append(f"В {level_name} неправильная последовательность блоков")
            
            return ". ".join(message_parts)
    
    def get_evaluation_method(self) -> str:
        return "sequence_comparison"


class SequenceAssemblyTaskUI(BaseTaskUI):
    """UI компоненты для заданий на сборку схем"""
    
    def get_ui_elements(self) -> Dict[str, bool]:
        return {
            "show_brush": False,
            "show_compare": True,
            "show_reset": True,
            "handle_click": True,
            "handle_draw": False
        }
    
    def get_toolbar_widgets(self) -> List:
        return [
            ("compare", "button", {
                "text": "✓ Проверить",
                "command": "check_sequence"
            }),
            ("reset", "button", {
                "text": "🔄 Сбросить",
                "command": "reset_sequence"
            })
        ]
    
    def get_initial_instructions(self) -> str:
        return "Расставьте элементы в правильной последовательности"
    
    def get_task_instructions(self, task_data: Dict[str, Any]) -> str:
        prompt = task_data.get('prompt', '')
        elements_count = len(task_data.get('elements', []))
        
        if prompt:
            return f"{prompt} (элементов: {elements_count})"
        else:
            return f"Расставьте {elements_count} элементов в правильной последовательности"
    
    def get_completion_message(self, result: Dict[str, Any]) -> str:
        if result.get("success", False):
            return f"Правильно! Результат: {result.get('score', 0):.1f}%"
        else:
            return f"Неправильно. Результат: {result.get('score', 0):.1f}%"


class SequenceAssemblyTaskType(BaseTaskType):
    """Тип задания 'Сборка схем'"""
    
    def __init__(self):
        super().__init__(
            task_id="sequence_assembly",
            name="Сборка схем",
            description="Расставить элементы в правильной последовательности"
        )
    
    def create_evaluator(self) -> BaseTaskEvaluator:
        return SequenceAssemblyTaskEvaluator()
    
    def create_ui(self) -> BaseTaskUI:
        return SequenceAssemblyTaskUI()
    
    def get_available_tools(self) -> List[str]:
        return ["select", "drag", "compare", "reset"]
    
    def get_default_settings(self) -> Dict[str, Any]:
        return {
            "shuffle_elements": True,
            "show_hints": False,
            "allow_duplicates": False,
            "sequence_within_level_matters": False,
            "level_order_matters": False
        }
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Проверяет корректность данных задания"""
        if not isinstance(task_data, dict):
            return False
        
        # Проверяем наличие обязательных полей
        if 'elements' not in task_data:
            return False
        
        # Проверяем наличие levels или correct_sequence (для обратной совместимости)
        has_levels = 'levels' in task_data
        has_sequence = 'correct_sequence' in task_data
        
        if not has_levels and not has_sequence:
            return False
        
        elements = task_data['elements']
        
        # Проверяем типы данных
        if not isinstance(elements, list):
            return False
        
        # Проверяем, что есть элементы
        if len(elements) == 0:
            return False
        
        # Проверяем, что все элементы имеют ID
        element_ids = set()
        for element in elements:
            if not isinstance(element, dict) or 'id' not in element:
                return False
            element_id = element['id']
            if element_id in element_ids:
                return False  # Дублирующиеся ID
            element_ids.add(element_id)
        
        # Проверяем levels (новая структура)
        if has_levels:
            levels = task_data['levels']
            if not isinstance(levels, list):
                return False
            
            if len(levels) == 0:
                return False
            
            # Проверяем каждый уровень
            for level in levels:
                if not isinstance(level, dict) or 'level_id' not in level or 'blocks' not in level:
                    return False
                
                blocks = level['blocks']
                if not isinstance(blocks, list):
                    return False
                
                # Проверяем, что все ID в blocks существуют в elements
                for block_id in blocks:
                    if block_id not in element_ids:
                        return False
        
        # Проверяем correct_sequence (старая структура для обратной совместимости)
        if has_sequence:
            correct_sequence = task_data['correct_sequence']
            if not isinstance(correct_sequence, list):
                return False
            
            if len(correct_sequence) == 0:
                return False
            
            # Проверяем, что все ID в correct_sequence существуют в elements
            for element_id in correct_sequence:
                if element_id not in element_ids:
                    return False
        
        return True

