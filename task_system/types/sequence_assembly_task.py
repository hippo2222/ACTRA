"""
Тип задания "Сборка схем" (sequence_assembly)
Пользователь должен расставить элементы в правильной последовательности
"""

from collections import Counter
from typing import Dict, List, Any
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class SequenceAssemblyTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий на сборку схем"""
    
    @staticmethod
    def _normalize_semantic_text(value: Any) -> str:
        normalized = " ".join(str(value or "").strip().lower().split())
        translit_map = str.maketrans({
            "\u0451": "\u0435",
            "\u0439": "\u0438",
            "\u0456": "\u0438",
            "\u0457": "\u0438",
            "i": "\u0438",
        })
        return normalized.translate(translit_map)

    def _canonicalize_semantic_value(self, explicit_key: Any, raw_text: Any = None, raw_image: Any = None) -> str:
        explicit_value = str(explicit_key or "").strip()
        if explicit_value:
            lowered = explicit_value.lower()
            if lowered.startswith("text:"):
                normalized_explicit_text = self._normalize_semantic_text(explicit_value.split(":", 1)[1])
                if normalized_explicit_text:
                    return f"text:{normalized_explicit_text}"
            elif lowered.startswith("image:"):
                normalized_explicit_image = explicit_value.split(":", 1)[1].strip().replace("\\", "/")
                if normalized_explicit_image:
                    return f"image:{normalized_explicit_image}"
            return explicit_value

        normalized_text = self._normalize_semantic_text(raw_text)
        if normalized_text:
            return f"text:{normalized_text}"

        normalized_image = str(raw_image or "").strip().replace("\\", "/")
        if normalized_image:
            return f"image:{normalized_image}"

        return ""

    def _build_element_semantic_map(self, reference_data: Dict[str, Any]) -> Dict[str, str]:
        semantic_map: Dict[str, str] = {}
        for element in reference_data.get("elements", []) or []:
            if not isinstance(element, dict):
                continue
            element_id = str(element.get("id") or "").strip()
            if not element_id:
                continue
            explicit_key = str(
                element.get("semantic_key")
                or element.get("semanticKey")
                or ""
            ).strip()
            semantic_value = self._canonicalize_semantic_value(
                explicit_key,
                raw_text=element.get("text"),
                raw_image=element.get("image"),
            )
            semantic_map[element_id] = semantic_value or f"id:{element_id}"
        return semantic_map

    def _normalize_block_refs(self, blocks: List[Any], semantic_map: Dict[str, str], block_names: Dict[str, Any] = None) -> List[str]:
        normalized: List[str] = []
        normalized_block_names = block_names if isinstance(block_names, dict) else {}
        for raw_block in blocks or []:
            if raw_block is None:
                normalized.append("__missing__")
                continue
            block_id = str(raw_block)
            semantic_value = semantic_map.get(block_id)
            if not semantic_value:
                typed_name = self._normalize_semantic_text(normalized_block_names.get(block_id))
                if typed_name:
                    semantic_value = f"text:{typed_name}"
            normalized.append(semantic_value or f"id:{block_id}")
        return normalized

    def _count_matching_blocks(self, user_blocks: List[Any], correct_blocks: List[Any], semantic_map: Dict[str, str], sequence_matters: bool, user_block_names: Dict[str, Any] = None) -> int:
        normalized_user = self._normalize_block_refs(user_blocks, semantic_map, user_block_names)
        normalized_correct = self._normalize_block_refs(correct_blocks, semantic_map)
        if sequence_matters:
            return sum(
                1
                for idx, block in enumerate(normalized_user)
                if idx < len(normalized_correct) and block == normalized_correct[idx]
            )
        return sum((Counter(normalized_user) & Counter(normalized_correct)).values())

    def _blocks_match(self, user_blocks: List[Any], correct_blocks: List[Any], semantic_map: Dict[str, str], sequence_matters: bool, user_block_names: Dict[str, Any] = None) -> bool:
        normalized_user = self._normalize_block_refs(user_blocks, semantic_map, user_block_names)
        normalized_correct = self._normalize_block_refs(correct_blocks, semantic_map)
        if sequence_matters:
            return normalized_user == normalized_correct
        return Counter(normalized_user) == Counter(normalized_correct)

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
        semantic_map = self._build_element_semantic_map(reference_data)
        
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
                user_block_names = user_level.get("block_names", {})
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
                    if self._blocks_match(user_blocks, correct_blocks_list, semantic_map, True, user_block_names):
                        correct_blocks += len(correct_blocks_list)
                    else:
                        correct_blocks += self._count_matching_blocks(user_blocks, correct_blocks_list, semantic_map, True, user_block_names)
                        # Последовательность неправильная
                        incorrect_sequences.append({
                            'level': i + 1,
                            'level_id': user_level_id,
                            'expected': correct_blocks_list,
                            'actual': user_blocks
                        })
                else:
                    # Проверяем только наличие блоков в уровне (порядок не важен)
                    if self._blocks_match(user_blocks, correct_blocks_list, semantic_map, False, user_block_names):
                        correct_blocks += len(correct_blocks_list)
                    else:
                        # Блоки в неправильном уровне
                        correct_blocks += self._count_matching_blocks(user_blocks, correct_blocks_list, semantic_map, False, user_block_names)
                        incorrect_levels.append(i + 1)
        else:
            # Порядок уровней не важен - сопоставляем по level_id
            correct_levels_dict = {level.get("level_id", ""): level for level in correct_levels}
            used_correct_level_ids = set()
            
            for idx, user_level in enumerate(user_levels):
                user_level_id = user_level.get("level_id", "")
                user_blocks = user_level.get("blocks", [])
                user_block_names = user_level.get("block_names", {})

                matched_correct_level = None
                matched_correct_level_id = ""

                if user_level_id in correct_levels_dict:
                    matched_correct_level = correct_levels_dict[user_level_id]
                    matched_correct_level_id = user_level_id
                else:
                    for candidate_level in correct_levels:
                        candidate_level_id = candidate_level.get("level_id", "")
                        if candidate_level_id in used_correct_level_ids:
                            continue
                        candidate_blocks = candidate_level.get("blocks", [])
                        if self._blocks_match(user_blocks, candidate_blocks, semantic_map, sequence_matters, user_block_names):
                            matched_correct_level = candidate_level
                            matched_correct_level_id = candidate_level_id
                            break

                if matched_correct_level is not None:
                    used_correct_level_ids.add(matched_correct_level_id)
                    correct_level = matched_correct_level
                    correct_blocks_list = correct_level.get("blocks", [])
                    
                    total_blocks += len(correct_blocks_list)
                    
                    if sequence_matters:
                        # Строгое совпадение последовательности внутри уровня
                        if self._blocks_match(user_blocks, correct_blocks_list, semantic_map, True, user_block_names):
                            correct_blocks += len(correct_blocks_list)
                        else:
                            correct_blocks += self._count_matching_blocks(user_blocks, correct_blocks_list, semantic_map, True, user_block_names)
                            # Последовательность неправильная
                            incorrect_sequences.append({
                                'level': idx + 1,
                                'level_id': user_level_id,
                                'expected': correct_blocks_list,
                                'actual': user_blocks
                            })
                    else:
                        # Проверяем только наличие блоков в уровне (порядок не важен)
                        if self._blocks_match(user_blocks, correct_blocks_list, semantic_map, False, user_block_names):
                            correct_blocks += len(correct_blocks_list)
                        else:
                            # Блоки в неправильном уровне
                            correct_blocks += self._count_matching_blocks(user_blocks, correct_blocks_list, semantic_map, False, user_block_names)
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
