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

    def _evaluate_hierarchy(self, user_input: Dict[str, Any], reference_data: Dict[str, Any]) -> Dict[str, Any]:
        """Оценивает реляционную структуру узлов (nodes) в режиме иерархии/классификации."""
        user_nodes_raw = user_input.get("nodes", []) or []
        correct_nodes_raw = reference_data.get("nodes", []) or []
        sequence_matters = bool(reference_data.get("sequence_within_level_matters", False))
        level_order_matters = bool(reference_data.get("level_order_matters", False))
        semantic_map = self._build_element_semantic_map(reference_data)

        ref_nodes: Dict[str, Dict[str, Any]] = {}
        ref_children: Dict[str, List[str]] = {}
        ref_roots: List[str] = []
        for raw in correct_nodes_raw:
            if not isinstance(raw, dict):
                continue
            nid = str(raw.get("node_id") or "").strip()
            if not nid:
                continue
            ref_nodes[nid] = raw
            ref_children.setdefault(nid, [])

        for nid, raw in ref_nodes.items():
            pid = str(raw.get("parent_id") or "").strip()
            if pid and pid in ref_nodes:
                ref_children.setdefault(pid, []).append(nid)
            else:
                ref_roots.append(nid)

        user_nodes: Dict[str, Dict[str, Any]] = {}
        user_children: Dict[str, List[str]] = {}
        user_roots: List[str] = []
        for idx, raw in enumerate(user_nodes_raw):
            if not isinstance(raw, dict):
                continue
            nid = str(raw.get("node_id") or f"user_node_{idx + 1}").strip()
            user_nodes[nid] = raw
            user_children.setdefault(nid, [])

        for nid, raw in user_nodes.items():
            pid = str(raw.get("parent_id") or "").strip()
            if pid and pid in user_nodes:
                user_children.setdefault(pid, []).append(nid)
            else:
                user_roots.append(nid)

        total_blocks = sum(len(n.get("blocks", []) or []) for n in ref_nodes.values())
        if not ref_nodes:
            return {
                "success": False,
                "score": 0.0,
                "message": "Отсутствует структура узлов для проверки",
                "metric": "percent",
                "details": {},
            }

        memo: Dict[ Any, Dict[str, Any] ] = {}

        def match_node_lists(r_ids: List[str], u_ids: List[str]) -> Dict[str, Any]:
            if not r_ids or not u_ids:
                return {"correct_blocks": 0, "correct_nodes": 0, "pairs": []}

            if level_order_matters:
                pairs = []
                c_blocks = 0
                c_nodes = 0
                for idx, r_id in enumerate(r_ids):
                    if idx >= len(u_ids):
                        break
                    u_id = u_ids[idx]
                    r_lvl = str(ref_nodes[r_id].get("level_id") or "")
                    u_lvl = str(user_nodes[u_id].get("level_id") or "")
                    if r_lvl and u_lvl and r_lvl != u_lvl:
                        continue
                    sub = evaluate_pair(r_id, u_id)
                    c_blocks += sub["subtree_correct_blocks"]
                    c_nodes += sub["subtree_correct_nodes"]
                    pairs.append((r_id, u_id))
                return {"correct_blocks": c_blocks, "correct_nodes": c_nodes, "pairs": pairs}

            # Реляционное сопоставление (порядок веток/колонок на одном этаже не важен)
            m_len = len(r_ids)
            k_len = len(u_ids)
            if max(m_len, k_len) <= 10:
                dp_memo: Dict[Any, Any] = {}

                def solve_dp(r_idx: int, mask: int):
                    if r_idx >= m_len:
                        return (0, 0, 0, [])
                    state = (r_idx, mask)
                    if state in dp_memo:
                        return dp_memo[state]

                    # Вариант: пропустить r_idx (если у пользователя меньше узлов)
                    best = solve_dp(r_idx + 1, mask)
                    r_id = r_ids[r_idx]
                    r_lvl = str(ref_nodes[r_id].get("level_id") or "")
                    r_col_title = str(ref_nodes[r_id].get("column_title") or "").strip().lower()

                    for u_idx in range(k_len):
                        if mask & (1 << u_idx):
                            continue
                        u_id = u_ids[u_idx]
                        u_lvl = str(user_nodes[u_id].get("level_id") or "")
                        if r_lvl and u_lvl and r_lvl != u_lvl:
                            continue
                        u_col_title = str(user_nodes[u_id].get("column_title") or "").strip().lower()
                        if r_col_title:
                            if u_col_title:
                                if u_col_title != r_col_title:
                                    continue
                            else:
                                if r_id != u_id:
                                    continue
                        elif u_col_title:
                            if r_id != u_id:
                                continue
                        sub = evaluate_pair(r_id, u_id)
                        rem_blocks, rem_nodes, rem_same, rem_pairs = solve_dp(r_idx + 1, mask | (1 << u_idx))
                        cand = (
                            sub["subtree_correct_blocks"] + rem_blocks,
                            sub["subtree_correct_nodes"] + rem_nodes,
                            (1 if r_id == u_id else 0) + rem_same,
                            [(r_id, u_id)] + rem_pairs,
                        )
                        if cand[:3] > best[:3]:
                            best = cand

                    dp_memo[state] = best
                    return best

                best_blocks, best_nodes, _, best_pairs = solve_dp(0, 0)
                return {"correct_blocks": best_blocks, "correct_nodes": best_nodes, "pairs": best_pairs}

            # Fallback для > 10 веток одного родителя: жадное сопоставление по убыванию веса
            candidates = []
            for r_id in r_ids:
                r_lvl = str(ref_nodes[r_id].get("level_id") or "")
                r_col_title = str(ref_nodes[r_id].get("column_title") or "").strip().lower()
                for u_id in u_ids:
                    u_lvl = str(user_nodes[u_id].get("level_id") or "")
                    if r_lvl and u_lvl and r_lvl != u_lvl:
                        continue
                    u_col_title = str(user_nodes[u_id].get("column_title") or "").strip().lower()
                    if r_col_title:
                        if u_col_title:
                            if u_col_title != r_col_title:
                                continue
                        else:
                            if r_id != u_id:
                                continue
                    elif u_col_title:
                        if r_id != u_id:
                            continue
                    sub = evaluate_pair(r_id, u_id)
                    candidates.append((
                        sub["subtree_correct_blocks"],
                        sub["subtree_correct_nodes"],
                        1 if r_id == u_id else 0,
                        r_id,
                        u_id,
                    ))
            candidates.sort(reverse=True)
            used_r = set()
            used_u = set()
            pairs = []
            c_blocks = 0
            c_nodes = 0
            for b_cnt, n_cnt, _, r_id, u_id in candidates:
                if r_id in used_r or u_id in used_u:
                    continue
                used_r.add(r_id)
                used_u.add(u_id)
                pairs.append((r_id, u_id))
                c_blocks += b_cnt
                c_nodes += n_cnt
            return {"correct_blocks": c_blocks, "correct_nodes": c_nodes, "pairs": pairs}

        def evaluate_pair(r_id: str, u_id: str) -> Dict[str, Any]:
            key = (r_id, u_id)
            if key in memo:
                return memo[key]

            r_node = ref_nodes[r_id]
            u_node = user_nodes[u_id]
            r_blocks = r_node.get("blocks", []) or []
            u_blocks = u_node.get("blocks", []) or []
            u_block_names = u_node.get("block_names", {}) or {}

            own_correct = self._count_matching_blocks(
                u_blocks, r_blocks, semantic_map, sequence_matters, u_block_names
            )
            own_exact = self._blocks_match(
                u_blocks, r_blocks, semantic_map, sequence_matters, u_block_names
            )

            r_col_title = str(r_node.get("column_title") or "").strip().lower()
            u_col_title = str(u_node.get("column_title") or "").strip().lower()
            if r_col_title:
                if u_col_title:
                    col_title_ok = (u_col_title == r_col_title)
                else:
                    col_title_ok = (r_id == u_id)
            elif u_col_title:
                col_title_ok = (r_id == u_id)
            else:
                col_title_ok = True

            if not col_title_ok:
                own_exact = False

            children_res = match_node_lists(ref_children.get(r_id, []), user_children.get(u_id, []))
            res = {
                "own_correct_blocks": own_correct,
                "own_exact": own_exact,
                "subtree_correct_blocks": own_correct + children_res["correct_blocks"],
                "subtree_correct_nodes": (1 if own_exact else 0) + children_res["correct_nodes"],
                "child_pairs": children_res["pairs"],
            }
            memo[key] = res
            return res

        root_res = match_node_lists(ref_roots, user_roots)
        correct_blocks = root_res["correct_blocks"]

        node_mapping: Dict[str, str] = {}
        correct_nodes: List[str] = []
        incorrect_nodes: List[str] = []

        def collect_pairs(pairs: List[Any]):
            for r_id, u_id in pairs:
                node_mapping[r_id] = u_id
                pair_info = evaluate_pair(r_id, u_id)
                if pair_info["own_exact"]:
                    correct_nodes.append(u_id)
                else:
                    incorrect_nodes.append(u_id)
                collect_pairs(pair_info["child_pairs"])

        collect_pairs(root_res["pairs"])
        for r_id in ref_nodes:
            if r_id not in node_mapping:
                incorrect_nodes.append(r_id)

        score = (correct_blocks / total_blocks * 100.0) if total_blocks > 0 else 0.0
        success = (
            len(correct_nodes) == len(ref_nodes)
            and len(user_nodes) == len(ref_nodes)
            and len(incorrect_nodes) == 0
        )

        return {
            "success": success,
            "score": score,
            "message": self._format_result_message(
                success, score, total_blocks, sequence_matters, level_order_matters, True, [], []
            ),
            "metric": "percent",
            "details": {
                "display_mode": reference_data.get("display_mode", "hierarchy"),
                "correct_blocks": correct_blocks,
                "total_blocks": total_blocks,
                "correct_nodes": correct_nodes,
                "incorrect_nodes": incorrect_nodes,
                "node_mapping": node_mapping,
                "sequence_matters": sequence_matters,
                "level_order_matters": level_order_matters,
            },
        }

    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """Оценивает правильность последовательности элементов по уровням или иерархии узлов"""
        if not isinstance(user_input, dict) or not isinstance(reference_data, dict):
            return {
                "success": False,
                "score": 0.0,
                "message": "Неверный формат данных",
                "metric": "percent",
                "details": {}
            }

        # Если задание и ответ используют иерархическую структуру узлов (nodes)
        if reference_data.get("nodes") and user_input.get("nodes"):
            return self._evaluate_hierarchy(user_input, reference_data)
        
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
            "level_order_matters": False,
            "display_mode": "linear",
            "color_differentiation": False,
        }
    
    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Проверяет корректность данных задания"""
        if not isinstance(task_data, dict):
            return False
        
        # Проверяем наличие обязательных полей
        if 'elements' not in task_data:
            return False
        
        # Проверяем наличие levels, nodes или correct_sequence (для обратной совместимости)
        has_levels = 'levels' in task_data
        has_nodes = 'nodes' in task_data and bool(task_data.get('nodes'))
        has_sequence = 'correct_sequence' in task_data
        
        if not has_levels and not has_sequence and not has_nodes:
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
        
        level_ids = set()
        # Проверяем levels (новая структура)
        if has_levels:
            levels = task_data['levels']
            if not isinstance(levels, list):
                return False
            
            if len(levels) == 0:
                return False
            
            # Проверяем каждый уровень
            for level in levels:
                if not isinstance(level, dict) or 'level_id' not in level:
                    return False
                if not has_nodes and 'blocks' not in level:
                    return False
                
                level_ids.add(level['level_id'])
                blocks = level.get('blocks', [])
                if not isinstance(blocks, list):
                    return False
                
                # Проверяем, что все ID в blocks существуют в elements
                for block_id in blocks:
                    if block_id not in element_ids:
                        return False

        # Проверяем nodes (иерархическая структура)
        if has_nodes:
            nodes = task_data['nodes']
            if not isinstance(nodes, list) or len(nodes) == 0:
                return False
            node_ids = set()
            for node in nodes:
                if not isinstance(node, dict) or 'node_id' not in node or 'level_id' not in node:
                    return False
                nid = node['node_id']
                if not nid or nid in node_ids:
                    return False
                node_ids.add(nid)
                if level_ids and node['level_id'] not in level_ids:
                    return False
                nblocks = node.get('blocks', [])
                if not isinstance(nblocks, list):
                    return False
                for block_id in nblocks:
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

