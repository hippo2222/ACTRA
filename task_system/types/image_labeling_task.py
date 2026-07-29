"""
Тип задания "Подписи на рисунке" (image_labeling)
Пользователь должен соотнести области на изображении с названиями или вписать их вручную.
"""

from typing import Dict, List, Any, Optional
from ..core.base.task_type import BaseTaskType
from ..core.base.task_evaluator import BaseTaskEvaluator
from ..core.base.task_ui import BaseTaskUI


class ImageLabelingTaskEvaluator(BaseTaskEvaluator):
    """Оценщик для заданий на подписи на рисунке"""

    @staticmethod
    def _normalize_text(value: Any) -> str:
        """Нормализация текста ответа для сравнения"""
        normalized = " ".join(str(value or "").strip().lower().split())
        translit_map = str.maketrans({
            "\u0451": "\u0435",  # ё -> е
            "\u0439": "\u0438",  # й -> и
            "\u0456": "\u0438",  # украинское і -> и
            "\u0457": "\u0438",  # украинское ї -> и
            "i": "\u0438",        # латинское i -> и
        })
        return normalized.translate(translit_map)

    @staticmethod
    def _levenshtein_distance(s1: str, s2: str) -> int:
        """Damerau-Levenshtein distance with adjacent transposition support"""
        d = {}
        len1, len2 = len(s1), len(s2)
        for i in range(-1, len1 + 1):
            d[(i, -1)] = i + 1
        for j in range(-1, len2 + 1):
            d[(-1, j)] = j + 1

        for i in range(len1):
            for j in range(len2):
                cost = 0 if s1[i] == s2[j] else 1
                d[(i, j)] = min(
                    d[(i - 1, j)] + 1,       # deletion
                    d[(i, j - 1)] + 1,       # insertion
                    d[(i - 1, j - 1)] + cost # substitution
                )
                if i > 0 and j > 0 and s1[i] == s2[j - 1] and s1[i - 1] == s2[j]:
                    d[(i, j)] = min(d[(i, j)], d[(i - 2, j - 2)] + 1) # transposition

        return d[(len1 - 1, len2 - 1)]

    @classmethod
    def _split_candidate_options(cls, raw_label: str) -> List[str]:
        """Разбивает эталонную метку на допустимые синонимы/варианты (через /, |, или) и обрабатывает текст в скобках"""
        import re
        candidates = set()
        raw_norm = cls._normalize_text(raw_label)
        if raw_norm:
            candidates.add(raw_norm)

        # Вариант без текста в скобках (...)
        without_parens = re.sub(r'\(.*?\)', '', raw_label)
        norm_no_parens = cls._normalize_text(without_parens)
        if norm_no_parens:
            candidates.add(norm_no_parens)

        # Содержимое только внутри скобок
        parens_matches = re.findall(r'\((.*?)\)', raw_label)
        for pm in parens_matches:
            norm_pm = cls._normalize_text(pm)
            if norm_pm:
                candidates.add(norm_pm)

        # Разбиваем собранные строки по слэшам, | и 'или'
        final_candidates = set()
        for cand in candidates:
            parts = re.split(r'[/|]|\s+или\s+', cand)
            for p in parts:
                norm_p = cls._normalize_text(p)
                if norm_p:
                    final_candidates.add(norm_p)

        return list(final_candidates) if final_candidates else [raw_norm]

    @classmethod
    def _evaluate_single_pair(cls, norm_user: str, norm_correct: str) -> str:
        """Оценивает пару пользовательская строка vs эталонная нормализованная строка"""
        if not norm_user:
            return "incorrect"
        if norm_user == norm_correct:
            return "correct"

        # 1. Сравнение наборов слов (перестановка слов местами: "кость большеберцовая" == "большеберцовая кость")
        user_tokens = set(norm_user.split())
        correct_tokens = set(norm_correct.split())
        if user_tokens == correct_tokens and len(user_tokens) > 0:
            return "correct"

        # 2. Вычисление расстояния Дамерау-Левенштейна
        dist = cls._levenshtein_distance(norm_correct, norm_user)
        max_len = max(len(norm_correct), len(norm_user))
        
        if max_len == 0:
            return "incorrect"

        similarity = 1.0 - (dist / max_len)

        # 3. Правила для опечаток с учетом длины:
        # - Очень короткие слова (<= 3 символа): опечатки ЗАПРЕЩЕНЫ (например "Рот" vs "Кот")
        if max_len <= 3:
            return "incorrect"

        # - Короткие слова (4-6 символов): допускается ровно 1 опечатка при схожести >= 75%
        if 4 <= max_len <= 6:
            if dist == 1 and similarity >= 0.75:
                return "typo"
            return "incorrect"

        # - Средние и длинные слова/фразы (> 6 символов):
        if max_len > 6:
            if dist <= 2 or similarity >= 0.78:
                return "typo"

        return "incorrect"

    def evaluate(self, user_input: Any, reference_data: Any) -> Dict[str, Any]:
        """
        Оценивает ответы студента.
        
        Args:
            user_input: Ввод пользователя вида {"answers": {"zone_1": "текст", "zone_2": "текст"}}
            reference_data: Данные задания (content) содержащие список zones с эталонами
        """
        if not isinstance(user_input, dict) or not isinstance(reference_data, dict):
            return {
                "success": False,
                "score": 0.0,
                "message": "Неверный формат данных",
                "metric": "percent",
                "details": {}
            }

        user_answers = user_input.get("answers", {})
        if not isinstance(user_answers, dict):
            user_answers = {}

        zones = reference_data.get("zones", []) or []
        if not isinstance(zones, list):
            zones = []

        if not zones:
            return {
                "success": False,
                "score": 0.0,
                "message": "Отсутствует эталонная разметка зон",
                "metric": "percent",
                "details": {}
            }

        override_typo = bool(user_input.get("override_typo", False)) if isinstance(user_input, dict) else False
        single_retry_copy = bool(user_input.get("single_retry_copy", False)) if isinstance(user_input, dict) else False

        correct_count = 0.0
        total_count = len(zones)
        zone_results = {}
        has_typos = False

        for zone in zones:
            if not isinstance(zone, dict):
                continue
            zone_id = str(zone.get("id", ""))
            correct_label = str(zone.get("label", ""))
            
            user_text = user_answers.get(zone_id, "")
            norm_user = self._normalize_text(user_text)
            
            status = "incorrect"
            if norm_user != "":
                # Получаем все допустимые кандидаты правильного ответа (синонимы, скобки, слэши)
                candidates = self._split_candidate_options(correct_label)
                
                # Ищем лучший статус среди кандидатов: correct > typo > incorrect
                best_status = "incorrect"
                for cand in candidates:
                    st = self._evaluate_single_pair(norm_user, cand)
                    if st == "correct":
                        best_status = "correct"
                        break
                    elif st == "typo":
                        best_status = "typo"

                if best_status == "correct":
                    status = "correct"
                elif best_status == "typo":
                    has_typos = True
                    if override_typo:
                        status = "correct"
                    else:
                        status = "typo"

            if status == "correct":
                correct_count += 1

            zone_results[zone_id] = {
                "status": status,
                "is_correct": (status == "correct"),
                "is_typo": (status == "typo"),
                "expected": correct_label,
                "actual": user_text
            }

        score = (correct_count / total_count) * 100.0 if total_count > 0 else 0.0
        success = (correct_count == total_count)

        # Сообщение о результате
        if success:
            message = "Отлично! Все подписи верны (100.0%)"
        else:
            message = f"Неверно. Правильно вписано областей: {correct_count} из {total_count}"

        requires_user_judgement = bool(has_typos and not override_typo and not single_retry_copy)

        return {
            "success": success,
            "score": score,
            "message": message,
            "metric": "percent",
            "details": {
                "correct_count": correct_count,
                "total_count": total_count,
                "zone_results": zone_results,
                "has_typos": has_typos,
                "single_retry_copy": single_retry_copy,
                "requires_user_judgement": requires_user_judgement,
                "requires_typo_judgement": requires_user_judgement
            }
        }

    def get_evaluation_method(self) -> str:
        return "image_labeling_comparison"


class ImageLabelingTaskUI(BaseTaskUI):
    """UI настройки для заданий на подписи на рисунке"""

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
                "command": "check_labels"
            }),
            ("reset", "button", {
                "text": "🔄 Сбросить",
                "command": "reset_labels"
            })
        ]

    def get_initial_instructions(self) -> str:
        return "Укажите верные подписи для областей на рисунке"

    def get_task_instructions(self, task_data: Dict[str, Any]) -> str:
        prompt = task_data.get("prompt", "")
        zones_count = len(task_data.get("zones", []))
        if prompt:
            return f"{prompt} (областей: {zones_count})"
        return f"Подпишите {zones_count} областей на рисунке"

    def get_completion_message(self, result: Dict[str, Any]) -> str:
        if result.get("success", False):
            return f"Правильно! Результат: {result.get('score', 0):.1f}%"
        return f"Неправильно. Результат: {result.get('score', 0):.1f}%"


class ImageLabelingTaskType(BaseTaskType):
    """Тип задания 'Подписи на рисунке'"""

    def __init__(self):
        super().__init__(
            task_id="image_labeling",
            name="Подписи на рисунке",
            description="Расположите подписи к соответствующим областям на изображении или впишите их вручную"
        )

    def create_evaluator(self) -> BaseTaskEvaluator:
        return ImageLabelingTaskEvaluator()

    def create_ui(self) -> BaseTaskUI:
        return ImageLabelingTaskUI()

    def get_available_tools(self) -> List[str]:
        return ["select", "drag", "compare", "reset"]

    def get_default_settings(self) -> Dict[str, Any]:
        return {
            "difficulty_level": 1,
            "case_sensitive": False,
            "allow_hints": True
        }

    def validate_task_data(self, task_data: Dict[str, Any]) -> bool:
        """Валидирует структуру данных задания"""
        if not isinstance(task_data, dict):
            return False

        if "image" not in task_data or not isinstance(task_data["image"], str):
            return False

        zones = task_data.get("zones", [])
        if not isinstance(zones, list) or len(zones) == 0:
            return False

        for zone in zones:
            if not isinstance(zone, dict):
                return False
            if "id" not in zone or "label" not in zone:
                return False
            
            rect = zone.get("rect")
            if not isinstance(rect, dict):
                return False
            
            for key in ("x", "y", "width", "height"):
                if key not in rect or not isinstance(rect[key], (int, float)):
                    return False

        return True
