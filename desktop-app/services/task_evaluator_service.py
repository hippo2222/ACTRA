"""
Task Evaluator Service - Единая точка входа для оценки заданий всех типов.

Этот сервис извлекает логику оценки из trainer.py и предоставляет
унифицированный API для проверки ответов пользователя.

НЕДЕЛЯ 2, Блок A: Task Evaluator Service
Извлечено из trainer.py:
- check_click_accuracy (строки 833-884)
- compare_drawing (строки 1240-1308)
- check_open_answer (строки 1652-1699)
- check_sequence_levels (строки 2303-2396)
"""

import sys
import os
import logging
from collections import Counter
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional, Literal
from dataclasses import dataclass, field
from datetime import datetime
import re

# Импортируем geometry utils
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from task_system.utils.geometry import point_in_polygon, calculate_polygon_coverage
from task_system.core.exceptions import EvaluationError
from task_system.core.hooks.hook_registry import hook_registry
from task_system.core.hooks.evaluator_hooks import evaluator_hooks

# Импортируем модуль толерантности к тексту
from .text_tolerance import find_keyword_with_tolerance, normalize_text, compare_words_with_tolerance_info, extract_words_from_text
from .text_tolerance import find_keyword_with_tolerance, normalize_text, compare_words_with_tolerance_info, extract_words_from_text
from .difficulty_config_loader import load_difficulty_config
from .evaluation_messages import get_message

logger = logging.getLogger(__name__)


@dataclass
class EvaluationResult:
    """
    Унифицированный результат оценки задания.
    Используется для всех типов заданий.
    """
    success: bool
    message: str
    score: Optional[float] = None
    metric: Optional[Literal["IoU", "distance", "percent"]] = None
    details: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    
    def __post_init__(self):
        """Валидация данных"""
        # Валидация score
        if self.score is not None and (self.score < 0 or self.score > 100):
            raise EvaluationError(
                f"Invalid score: {self.score}. Must be between 0 and 100",
                details={'score': self.score}
            )
        # Валидация метрики
        if self.metric is not None and self.metric not in ("IoU", "distance", "percent"):
            raise EvaluationError(
                f"Invalid metric: {self.metric}. Must be one of: IoU, distance, percent",
                details={'metric': self.metric}
            )
    
    @classmethod
    def infer_metric_from_task_type(cls, task_type: str) -> Literal["IoU", "distance", "percent"]:
        """
        Автоматически определяет метрику по типу задачи.
        
        Args:
            task_type: Тип задания ('click', 'draw', 'open_answer', 'sequence_assembly', 'test')
        
        Returns:
            Метрика для данного типа задания
        """
        metric_map = {
            "click": "distance",
            "draw": "IoU",
            "open_answer": "percent",
            "sequence_assembly": "percent",
            "test": "percent"
        }
        return metric_map.get(task_type, "percent")


class TaskEvaluatorService:
    """
    Сервис для оценки заданий всех типов.
    
    Предоставляет единый интерфейс evaluate_task() который 
    делегирует в специализированные методы в зависимости от типа задания.
    
    Поддерживаемые типы:
    - click: клик по анатомическим областям
    - draw: рисование контуров органов
    - open_answer: текстовые ответы с ключевыми словами
    - sequence_assembly: сборка последовательностей
    - test: тестовые задания (делегируется в существующую систему)
    """
    
    def __init__(self, config: Optional[Dict[str, Any]] = None):
        """
        Инициализация сервиса.
        
        Args:
            config: Опциональная конфигурация (для будущего расширения)
        """
        self.config = config or {}
        
        # Загружаем конфигурацию сложности
        try:
            difficulty_config = load_difficulty_config()
        except Exception as e:
            logger.warning(f"Failed to load difficulty_config.json: {e}. Using hardcoded defaults.")
            difficulty_config = {}
        
        eval_defaults = difficulty_config.get('evaluation_defaults', {})
        
        # Параметры по умолчанию для Click заданий
        click_defaults = eval_defaults.get('click', {})
        self.default_click_tolerance = click_defaults.get('tolerance_px', 25)
        self.default_freehand_tolerance = click_defaults.get('freehand_tolerance_px', 15)
        self.default_click_success_threshold = click_defaults.get('success_threshold_percent', 100.0)
        
        # Параметры по умолчанию для Draw заданий
        draw_defaults = eval_defaults.get('draw', {})
        self.default_draw_threshold = draw_defaults.get('success_threshold_percent', 75)
        self.default_brush_radius = draw_defaults.get('brush_radius_px', 8)
        self.default_iou_threshold = draw_defaults.get('iou_threshold', 0.5)
        
        # Параметры для других типов заданий (для будущего использования)
        self.open_answer_defaults = eval_defaults.get('open_answer', {})
        self.sequence_defaults = eval_defaults.get('sequence_assembly', {})
        self.test_defaults = eval_defaults.get('test', {})
        
        # Настройки валидации
        validation_config = difficulty_config.get('validation', {})
        self.strict_mode = validation_config.get('strict_mode', False)
        self.log_fallbacks = validation_config.get('log_fallbacks', True)
        self.fail_on_missing_shape = validation_config.get('fail_on_missing_shape', False)
        
        logger.info(
            f"TaskEvaluatorService initialized with config: "
            f"click_tolerance={self.default_click_tolerance}px, "
            f"freehand_tolerance={self.default_freehand_tolerance}px, "
            f"draw_threshold={self.default_draw_threshold}%, "
            f"brush_radius={self.default_brush_radius}px"
        )
    
    def evaluate_task(self, task_type: str, user_input: Any, 
                     answer_key: Dict[str, Any], 
                     task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Unified entry point для всех типов заданий.
        
        Args:
            task_type: Тип задания ('click', 'draw', 'open_answer', 'sequence_assembly', 'test')
            user_input: Ответ пользователя (формат зависит от типа)
            answer_key: Правильный ответ из JSON
            task_data: Данные задания (для доступа к settings и другим полям)
        
        Returns:
            EvaluationResult с результатом оценки
        
        Raises:
            EvaluationError: если task_type неизвестен или произошла ошибка оценки
        """
        try:
            # Evaluator overrides via hook (highest priority)
            eval_cfg = (self.config or {}).get('evaluators', {})
            if eval_cfg.get('enabled', True) and eval_cfg.get('allow_override', True):
                override_hook_name = f"evaluator.hooks.override.{task_type}"
                override_result = hook_registry.call_first(
                    override_hook_name, task_type, user_input, answer_key, task_data
                )
                if override_result is not None:
                    if isinstance(override_result, EvaluationResult):
                        return override_result
                    if isinstance(override_result, dict):
                        # Используем metric из override_result или определяем по типу задачи
                        metric = override_result.get('metric')
                        if metric is None:
                            metric = EvaluationResult.infer_metric_from_task_type(task_type)
                        return EvaluationResult(
                            success=override_result.get('success', False),
                            message=override_result.get('message', ''),
                            score=override_result.get('score'),
                            metric=metric,
                            details=override_result.get('details', {})
                        )

            # Pre-evaluate hooks can modify inputs
            if eval_cfg.get('enabled', True):
                try:
                    user_input, answer_key = evaluator_hooks.call_pre_evaluate(
                        task_type, user_input, answer_key
                    )
                except Exception:
                    # Логи уже внутри hook_registry; продолжаем стандартную логику
                    pass
            if task_type == 'click':
                result = self.evaluate_click_task(user_input, answer_key, task_data)
            elif task_type == 'draw':
                result = self.evaluate_draw_task(user_input, answer_key, task_data)
            elif task_type == 'open_answer':
                result = self.evaluate_open_answer_task(user_input, answer_key, task_data)
            elif task_type == 'sequence_assembly':
                result = self.evaluate_sequence_task(user_input, answer_key, task_data)
            elif task_type == 'test':
                result = self.evaluate_test_task(user_input, answer_key, task_data)
            else:
                raise EvaluationError(
                    f"Unknown task type: {task_type}",
                    details={'task_type': task_type, 'user_input_type': type(user_input).__name__}
                )
            # Post-evaluate hooks can modify result
            if eval_cfg.get('enabled', True):
                try:
                    result_dict = {
                        'success': result.success,
                        'message': result.message,
                        'score': result.score,
                        'metric': result.metric,
                        'details': result.details,
                    }
                    modified = evaluator_hooks.call_post_evaluate(
                        task_type, user_input, answer_key, result_dict
                    )
                    # Normalize back to EvaluationResult
                    if isinstance(modified, dict):
                        return EvaluationResult(
                            success=bool(modified.get('success', result.success)),
                            message=str(modified.get('message', result.message)),
                            score=modified.get('score', result.score),
                            metric=modified.get('metric', result.metric),
                            details=modified.get('details', result.details)
                        )
                except Exception:
                    # Логи уже внутри hook_registry; возвращаем исходный result
                    pass
            # Если metric не установлен, определяем его по типу задачи
            if result.metric is None:
                result.metric = EvaluationResult.infer_metric_from_task_type(task_type)
            return result
        except EvaluationError:
            # Re-raise EvaluationError as is
            raise
        except Exception as e:
            logger.exception(f"Ошибка оценки задания типа {task_type}")
            raise EvaluationError(
                f"Ошибка оценки задания типа {task_type}: {e}",
                details={'task_type': task_type, 'error_type': type(e).__name__}
            ) from e
    
    # =========================================================================
    # CLICK TASK EVALUATION
    # Извлечено из trainer.py::check_click_accuracy (строки 833-884)
    # =========================================================================

    @staticmethod
    def _normalize_required_correct(raw_value: Any, default_value: int = 1) -> int:
        try:
            value = int(raw_value)
        except Exception:
            value = default_value
        return max(1, value)

    @staticmethod
    def _is_error_detection_click(content: Dict[str, Any], subtype: Any, content_subtype: Any) -> bool:
        mode = str(content.get("mode") or "").strip().lower()
        if str(subtype or "").strip().lower() == "error_detection":
            return True
        if str(content_subtype or "").strip().lower() == "error_detection":
            return True
        if mode in {"text_errors", "text_choice"}:
            return True
        if isinstance(content.get("error_spans"), list) or isinstance(content.get("errorSpans"), list):
            return True
        return False

    @staticmethod
    def _normalize_selected_indices(raw_indices: Any) -> Tuple[List[int], List[Any]]:
        if not isinstance(raw_indices, list):
            return [], []
        normalized: List[int] = []
        invalid_raw: List[Any] = []
        seen: set[int] = set()
        for raw in raw_indices:
            try:
                idx = int(raw)
            except Exception:
                invalid_raw.append(raw)
                continue
            if idx < 0:
                invalid_raw.append(raw)
                continue
            if idx in seen:
                continue
            seen.add(idx)
            normalized.append(idx)
        return normalized, invalid_raw

    @staticmethod
    def _split_text_into_words_with_spans(text: str) -> List[Dict[str, int]]:
        words: List[Dict[str, int]] = []
        cursor = 0
        index = 0
        for token in re.split(r"(\s+)", text or ""):
            start = cursor
            end = start + len(token)
            if token and token.strip():
                words.append({"index": index, "start": start, "end": end})
                index += 1
            cursor = end
        return words

    @staticmethod
    def _extract_error_word_indices_from_content(content: Dict[str, Any]) -> Tuple[Optional[set], Optional[int]]:
        text = content.get("text") or content.get("prompt")
        if not isinstance(text, str):
            return None, None

        words = TaskEvaluatorService._split_text_into_words_with_spans(text)
        word_count = len(words)
        raw_spans = content.get("error_spans")
        if not isinstance(raw_spans, list):
            raw_spans = content.get("errorSpans")
        if not isinstance(raw_spans, list):
            return None, word_count

        error_spans: List[Tuple[int, int]] = []
        for span in raw_spans:
            if not isinstance(span, dict):
                continue
            try:
                start = int(span.get("start"))
                end = int(span.get("end"))
            except Exception:
                continue
            if end <= start:
                continue
            # Frontend considers error only when is_correct === false.
            if span.get("is_correct", True) is False:
                error_spans.append((start, end))

        indices: set[int] = set()
        for word in words:
            ws = word["start"]
            we = word["end"]
            if any(ws < se and we > ss for ss, se in error_spans):
                indices.add(word["index"])

        return indices, word_count

    @staticmethod
    def _compute_error_required_count(
        required_correct: int,
        require_all_errors: bool,
        expected_error_count: Optional[int],
    ) -> int:
        if require_all_errors and expected_error_count and expected_error_count > 0:
            return expected_error_count
        required = max(1, required_correct)
        if expected_error_count and expected_error_count > 0:
            return min(required, expected_error_count)
        return required
    
    def evaluate_click_task(self, user_input: Dict[str, Any], 
                           answer_key: Dict[str, Any],
                           task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Click-задания (клик по анатомическим областям).
        
        Поддерживает уровни сложности через поля из DifficultyManager:
        - Уровень 1: только клик (базовая логика)
        - Уровень 2: клик + проверка названий (content.requires_labels = True)
        - Уровень 3: обводка + проверка названий (content.requires_drawing = True)
        
        Args:
            user_input: {
                # Уровень 1 (старый формат):
                'x': int,  # координата клика на canvas
                'y': int,
                'scale_factor': float,
                'offset_x': float,
                'offset_y': float
                
                # Уровень 1 (новый формат для множественных кликов):
                'clicks': [...],
                'found_targets': [...],
                'total_targets': int
                
                # Уровень 2:
                'labels': [str, ...]  # названия для каждого найденного target (в порядке targets)
                
                # Уровень 3:
                'drawing': [...],  # штрихи обводки
                'image_width': int,
                'image_height': int,
                'brush_radius': int,
                'labels': [str, ...]  # названия для каждого найденного target
            }
            answer_key: {
                'targets': [
                    {
                        'shape': 'point' | 'polygon',
                        'point': [x, y],  # для point
                        'points': [[x, y], ...],  # для polygon
                        'label': str,
                        'tolerance_px': int  # для point
                    },
                    ...
                ],
                'target_names': [str, ...]  # правильные названия в порядке targets (для level >= 2)
            }
            task_data: Данные задания для получения settings.tolerancePx
                     Может содержать поля из DifficultyManager:
                     - content.requires_labels: требуется проверка названий (level >= 2)
                     - content.requires_drawing: требуется обводка (level >= 3)
                     - content.mode: режим задания ('click', 'click_and_label', 'draw_and_label')
        
        Returns:
            EvaluationResult с результатами проверки:
            - Уровень 1: только результат клика
            - Уровень 2: комбинация клика (70%) + labels (30%)
            - Уровень 3: комбинация обводки (70%) + labels (30%)
        
        Логика извлечена из trainer.py строки 833-884
        """
        # ВАЖНО: Сначала проверяем уровень сложности, чтобы определить формат user_input
        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)
        requires_drawing = content.get('requires_drawing', False)
        mode = content.get('mode', 'click')
        subtype = task_data.get("subtype") if task_data else None
        content_subtype = content.get("subtype")
        content_options = content.get("options") or []
        reference_spans = content.get("reference_spans") or []
        required_correct = self._normalize_required_correct(
            content.get("required_correct", answer_key.get("required_correct", 1)),
            default_value=1,
        )
        require_all_errors = bool(
            content.get("require_all_errors") is True or content.get("requireAllErrors") is True
        )
        is_error_detection = self._is_error_detection_click(content, subtype, content_subtype)

        # Специальная ветка: text_choice / options-driven проверки
        options = answer_key.get("options") or content_options
        has_options = bool(options)
        if mode == "text_choice" or ("options" in answer_key) or has_options:
            correct_opt = next((o for o in options if o.get("is_correct")), None)
            correct_id = correct_opt.get("id") if correct_opt else None
            selected_id = None
            if isinstance(user_input, dict):
                selected_id = (
                    user_input.get("selected_option_id")
                    or user_input.get("selected_option")
                    or (user_input.get("selected_option_ids") or [None])[0]
                )
            success = bool(selected_id) and correct_id is not None and str(selected_id) == str(correct_id)
            score = 100.0 if success else 0.0
            return EvaluationResult(
                success=success,
                message="✅ Правильно" if success else "❌ Неправильно",
                score=score,
                metric="percent",
                details={
                    "mode": "text_choice",
                    "selected_option_id": selected_id,
                    "correct_option_id": correct_id,
                    "options_total": len(options),
                },
            )

        targets = answer_key.get('targets', [])

        # Fallback для error_detection (слова/текст): строим цели из reference_spans
        if not targets and is_error_detection:
            if isinstance(reference_spans, list):
                targets = [
                    {
                        "shape": "span",
                        "start": span.get("start"),
                        "end": span.get("end"),
                    }
                    for span in reference_spans
                    if isinstance(span, dict) and span.get("start") is not None and span.get("end") is not None
                ]
                answer_key = dict(answer_key)
                answer_key["targets"] = targets

        if not targets and not is_error_detection:
            return EvaluationResult(
                success=False,
                message="❌ Нет правильных ответов для проверки",
                score=0.0,
                metric="distance",
                details={'error': 'no_targets'}
            )

        # Ветка для text error detection по spans (слова)
        if is_error_detection:
            # Поддержка web-пейлоада с selected_indices / total_errors (MistakesUI)
            if isinstance(user_input, dict) and isinstance(user_input.get("selected_indices"), list):
                selected_indices, invalid_raw_indices = self._normalize_selected_indices(
                    user_input.get("selected_indices")
                )
                expected_error_indices, word_count = self._extract_error_word_indices_from_content(content)
                expected_count = len(expected_error_indices) if expected_error_indices is not None else None
                required = self._compute_error_required_count(
                    required_correct=required_correct,
                    require_all_errors=require_all_errors,
                    expected_error_count=expected_count,
                )

                accepted_indices = list(selected_indices)
                rejected_indices: List[int] = []
                out_of_range_indices: List[int] = []

                if word_count is not None:
                    accepted_indices = [idx for idx in accepted_indices if idx < word_count]
                    out_of_range_indices = [idx for idx in selected_indices if idx >= word_count]

                if expected_error_indices is not None:
                    matched = [idx for idx in accepted_indices if idx in expected_error_indices]
                    rejected_indices = [idx for idx in accepted_indices if idx not in expected_error_indices]
                    selected_count = len(matched)
                else:
                    matched = list(accepted_indices)
                    selected_count = len(accepted_indices)

                success = selected_count >= required
                score = 100.0 if success else 0.0
                return EvaluationResult(
                    success=success,
                    message="✅ Правильно" if success else "❌ Неправильно",
                    score=score,
                    metric="percent",
                    details={
                        "mode": "text_errors",
                        "selected_indices": selected_indices,
                        "selected_count": selected_count,
                        "matched_indices": matched,
                        "rejected_indices": rejected_indices,
                        "out_of_range_indices": out_of_range_indices,
                        "invalid_raw_indices": invalid_raw_indices,
                        "word_count": word_count,
                        "expected_error_count": expected_count,
                        "required": required,
                        "require_all_errors": require_all_errors,
                        "total_errors_reported": user_input.get("total_errors"),
                        "validation_mode": "indices_vs_error_words" if expected_error_indices is not None else "count_only",
                    },
                )

            user_spans = []
            if isinstance(user_input, dict):
                if isinstance(user_input.get("spans"), list):
                    user_spans = [
                        s for s in user_input.get("spans")
                        if isinstance(s, dict) and s.get("start") is not None and s.get("end") is not None
                    ]
                elif isinstance(user_input.get("clicks"), list):
                    # tolerate clicks payload with start/end naming
                    user_spans = [
                        c for c in user_input.get("clicks")
                        if isinstance(c, dict) and c.get("start") is not None and c.get("end") is not None
                    ]
            correct = 0
            for us in user_spans:
                for tgt in targets:
                    if tgt.get("shape") == "span":
                        # считаем попадание, если интервалы пересекаются
                        if not (us["end"] <= tgt["start"] or us["start"] >= tgt["end"]):
                            correct += 1
                            break
            expected_span_targets = len([t for t in targets if t.get("shape") == "span"])
            required = self._compute_error_required_count(
                required_correct=required_correct,
                require_all_errors=require_all_errors,
                expected_error_count=expected_span_targets,
            )
            success = correct >= required
            score = 100.0 if success else 0.0
            return EvaluationResult(
                success=success,
                message="✅ Правильно" if success else "❌ Неправильно",
                score=score,
                metric="percent",
                details={
                    "mode": "text_errors",
                    "spans_marked": len(user_spans),
                    "spans_correct": correct,
                    "required": required,
                    "require_all_errors": require_all_errors,
                },
            )
        
        # УРОВЕНЬ 3: требуется обводка + названия (проверяем ПЕРВЫМ, т.к. формат user_input отличается)
        # Важно: L3 web payload тоже содержит 'lines', но это НЕ та же логика, что _evaluate_click_with_lines.
        if requires_drawing:
            # Для уровня 3 click-заданий: каждый штрих соответствует отдельному target
            # Используем специальную логику для проверки множественных штрихов
            return self._evaluate_click_level_3_multiple_strokes(user_input, answer_key, task_data)

        # Проверяем наличие freehand targets
        has_freehand = any(
            (target.get('shape') == 'freehand' or target.get('type') == 'freehand')
            for target in targets
        )
        
        # Если есть freehand targets и есть нарисованные линии, используем специальную логику
        if has_freehand and user_input.get('lines'):
            return self._evaluate_click_with_lines(user_input, answer_key, task_data)
        
        # УРОВЕНЬ 1-2: требуется клик (с названиями или без)
        # ВАЖНО: Проверяем формат user_input ПЕРЕД попыткой извлечь 'x' и 'y'
        if 'clicks' in user_input:
            # Новый формат: множественные клики
            return self._evaluate_multiple_clicks(user_input, answer_key, task_data)
        
        # Старый формат: один клик (обратная совместимость)
        try:
            click_x = user_input['x']
            click_y = user_input['y']
        except KeyError as e:
            logger.error(f"Отсутствует обязательное поле в user_input: {e}")
            raise EvaluationError(
                f"Отсутствует обязательное поле в user_input: {e}",
                details={'user_input_keys': list(user_input.keys()), 'missing_field': str(e)}
            ) from e
        
        scale_factor = user_input.get('scale_factor', 1.0)
        offset_x = user_input.get('offset_x', 0.0)
        offset_y = user_input.get('offset_y', 0.0)
        
        # Get tolerance from task_data.settings.tolerancePx (not from answer_key)
        tolerance_px = self.default_click_tolerance
        if task_data:
            settings = task_data.get('settings', {})
            tolerance_px = settings.get('tolerancePx', self.default_click_tolerance)
        
        # УРОВЕНЬ 2: требуется только проверка названий (после клика)
        if requires_labels:
            # Сначала проверяем базовый клик
            click_result = None
            found_targets = []
            
            for idx, target in enumerate(targets):
                target_shape = target.get('shape') or target.get('type')
                
                # Fallback: автоматически определяем тип по наличию полей
                if target_shape is None:
                    points = target.get('points', [])
                    if len(points) >= 3:
                        target_shape = 'polygon'
                    elif len(points) >= 2:
                        # Проверяем явный тип
                        if target.get('type') == 'freehand' or target.get('shape') == 'freehand':
                            target_shape = 'freehand'
                        else:
                            # По умолчанию считаем polygon если >= 3 точки
                            target_shape = 'polygon' if len(points) >= 3 else 'freehand'
                    elif 'point' in target or 'coordinates' in target:
                        target_shape = 'point'
                
                is_hit = False
                if target_shape == 'point':
                    target_tolerance = target.get('tolerance_px') or target.get('tolerancePx')
                    is_hit = self._check_point_target(
                        click_x, click_y, target,
                        scale_factor, offset_x, offset_y,
                        tolerance_px=target_tolerance or tolerance_px
                    )
                elif target_shape == 'polygon':
                    is_hit = self._check_polygon_target(click_x, click_y, target,
                                                        scale_factor, offset_x, offset_y)
                elif target_shape == 'freehand':
                    # НОВОЕ: проверка попадания клика на freehand-линию
                    target_tolerance = target.get('tolerance_px')
                    if target_tolerance is None:
                        target_tolerance = target.get('tolerancePx')

                    if target_tolerance is None:
                        target_tolerance = self.default_freehand_tolerance
                    is_hit = self._check_freehand_target(
                        click_x, click_y, target,
                        scale_factor, offset_x, offset_y,
                        tolerance_px=target_tolerance
                    )
                
                if is_hit:
                    found_targets.append(idx)
            
            if not found_targets:
                # Не попали ни в одну цель
                return EvaluationResult(
                    success=False,
                    message="❌ Неправильно! Посмотрите на правильные области (зеленые)",
                    score=0.0,
                    metric="distance",
                    details={'targets_count': len(targets), 'level': 2}
                )
            
            # Проверяем labels
            # Формат: user_input['labels'] = [str, ...] - список названий в порядке найденных targets
            # Извлекаем правильные labels из targets, а не из target_names
            # target_names может отсутствовать в answer_key
            correct_labels = [target.get('label', '') for target in targets]
            user_labels = user_input.get('labels', [])
            
            # Если labels не предоставлены, но требуется проверка
            if not user_labels:
                return EvaluationResult(
                    success=False,
                    message="❌ Введите названия для найденных областей",
                    metric="distance",
                    details={
                        'targets_count': len(targets),
                        'found_targets': found_targets,
                        'level': 2,
                        'error': 'labels_missing'
                    }
                )
            
            # Проверяем labels для найденных targets
            # Для множественных кликов: проверяем labels в порядке found_targets
            found_correct_labels = [correct_labels[i] if i < len(correct_labels) else '' 
                                   for i in found_targets]
            found_user_labels = user_labels[:len(found_targets)] if len(user_labels) >= len(found_targets) else user_labels
            
            labels_result = self._evaluate_labels(found_user_labels, found_correct_labels)
            
            # Определяем успешность: базовый клик И правильные labels
            combined_success = len(found_targets) > 0 and labels_result['success']
            
            # Формируем сообщение
            if combined_success:
                message = f"✅ Правильно! Найдено областей: {len(found_targets)}, {labels_result['message']}"
            else:
                message = f"❌ Найдено областей: {len(found_targets)}, но {labels_result['message']}"
            
            return EvaluationResult(
                success=combined_success,
                message=message,
                score=labels_result.get('score', 0.0),
                metric="distance",
                details={
                    'found_targets': found_targets,
                    'labels': labels_result,
                    'level': 2
                }
            )
        
        # УРОВЕНЬ 1: только клик (базовая логика с поддержкой freehand)
        for target in targets:
            target_shape = target.get('shape') or target.get('type')
            
            # Fallback: автоматически определяем тип по наличию полей
            if target_shape is None:
                points = target.get('points', [])
                if len(points) >= 3:
                    target_shape = 'polygon'
                elif len(points) >= 2:
                    # Проверяем явный тип
                    if target.get('type') == 'freehand' or target.get('shape') == 'freehand':
                        target_shape = 'freehand'
                    else:
                        target_shape = 'polygon' if len(points) >= 3 else 'freehand'
                elif 'point' in target or 'coordinates' in target:
                    target_shape = 'point'
            
            if target_shape == 'point':
                # Проверка попадания в точку
                # Get tolerance from target or use from settings
                target_tolerance = target.get('tolerance_px') or target.get('tolerancePx')
                if self._check_point_target(
                    click_x, click_y, target, 
                    scale_factor, offset_x, offset_y,
                    tolerance_px=target_tolerance or tolerance_px
                ):
                    label = target.get('label', 'Цель')
                    return EvaluationResult(
                        success=True,
                        message=f"✅ Правильно! Вы попали в область: {label}",
                        score=100.0,
                        metric="distance",
                        details={
                            'target_label': label,
                            'target_shape': 'point',
                            'distance': 0,  # попадание в пределах tolerance
                            'tolerance': target_tolerance or tolerance_px,
                            'level': 1
                        }
                    )
            
            elif target_shape == 'polygon':
                # Проверка попадания в полигон
                if self._check_polygon_target(click_x, click_y, target,
                                             scale_factor, offset_x, offset_y):
                    label = target.get('label', 'Цель')
                    return EvaluationResult(
                        success=True,
                        message=f"✅ Правильно! Вы попали в область: {label}",
                        score=100.0,
                        metric="distance",
                        details={
                            'target_label': label,
                            'target_shape': 'polygon',
                            'level': 1
                        }
                    )
            
            elif target_shape == 'freehand':
                # НОВОЕ: проверка попадания клика на freehand-линию
                target_tolerance = target.get('tolerance_px')
                if target_tolerance is None:
                    target_tolerance = target.get('tolerancePx')

                if target_tolerance is None:
                    target_tolerance = self.default_freehand_tolerance
                if self._check_freehand_target(
                    click_x, click_y, target,
                    scale_factor, offset_x, offset_y,
                    tolerance_px=target_tolerance
                ):
                    label = target.get('label', 'Цель')
                    return EvaluationResult(
                        success=True,
                        message=f"✅ Правильно! Вы попали в область: {label}",
                        score=100.0,
                        metric="distance",
                        details={
                            'target_label': label,
                            'target_shape': 'freehand',
                            'level': 1
                        }
                    )
        
        # Если не попали ни в одну цель
        return EvaluationResult(
            success=False,
            message="❌ Неправильно! Посмотрите на правильные области (зеленые)",
            score=0.0,
            metric="distance",
            details={'targets_count': len(targets), 'level': 1}
        )
    
    def _evaluate_multiple_clicks(self, user_input: Dict[str, Any],
                                  answer_key: Dict[str, Any],
                                  task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Click-задания с множественными аннотациями.
        
        Поддерживает уровни сложности:
        - Уровень 1: только клики
        - Уровень 2: клики + названия (user_input['labels'])
        - Уровень 3: обводка + названия (не используется в множественных кликах)
        
        Args:
            user_input: {
                'clicks': [
                    {'x': int, 'y': int, 'scale_factor': float, 'offset_x': float, 'offset_y': float},
                    ...
                ],
                'found_targets': [0, 2, ...],  # индексы уже найденных targets
                'total_targets': int,
                'labels': [str, ...]  # названия для проверки (уровень 2)
            }
            answer_key: {
                'targets': [...],
                'target_names': [str, ...]  # правильные названия (уровень 2)
            }
        
        Returns:
            EvaluationResult с информацией о найденных/не найденных targets
        """
        clicks = user_input.get('clicks', [])
        found_targets_indices = set(user_input.get('found_targets', []))
        total_targets = user_input.get('total_targets', 0)
        
        targets = answer_key.get('targets', [])
        
        if not targets:
            return EvaluationResult(
                success=False,
                message="❌ Нет правильных ответов для проверки",
                metric="distance",
                details={'error': 'no_targets'}
            )
        
        # Проверяем уровень сложности
        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)
        
        # Get tolerance from task_data.settings.tolerancePx
        tolerance_px = self.default_click_tolerance
        if task_data:
            settings = task_data.get('settings', {})
            tolerance_px = settings.get('tolerancePx', self.default_click_tolerance)
        
        # Проверяем каждый target на наличие попадания
        found_targets = set()
        targets_info = []
        
        for idx, target in enumerate(targets):
            target_shape = target.get('shape') or target.get('type')
            
            # Автоматическое определение типа
            if target_shape is None:
                # В строгом режиме ошибка, если тип не указан
                if getattr(self, 'strict_mode', False) or getattr(self, 'fail_on_missing_shape', False):
                    raise EvaluationError(
                        f"Target shape not specified for target {idx} and strict mode is enabled",
                        details={'target_index': idx, 'task_data_id': task_data.get('id') if task_data else 'unknown'}
                    )

                if getattr(self, 'log_fallbacks', True):
                    logger.warning(
                        f"Target shape not specified for target {idx}, auto-detecting. "
                        f"Task: {task_data.get('id', 'unknown') if task_data else 'unknown'}"
                    )

                points = target.get('points', [])
                if len(points) >= 3:
                    target_shape = 'polygon'
                elif len(points) >= 2:
                    # Проверяем явный тип
                    if target.get('type') == 'freehand' or target.get('shape') == 'freehand':
                        target_shape = 'freehand'
                    else:
                        target_shape = 'polygon' if len(points) >= 3 else 'freehand'
                elif 'point' in target or 'coordinates' in target:
                    target_shape = 'point'
            
            found = False
            matched_click_idx = None
            
            # Проверяем все клики на попадание в этот target
            for click_idx, click in enumerate(clicks):
                click_x = click['x']
                click_y = click['y']
                
                if target_shape == 'polygon':
                    if self._check_polygon_target(click_x, click_y, target,
                                                click.get('scale_factor', 1.0),
                                                click.get('offset_x', 0.0),
                                                click.get('offset_y', 0.0)):
                        found = True
                        matched_click_idx = click_idx
                        break
                elif target_shape == 'point':
                    target_tolerance = target.get('tolerance_px') or target.get('tolerancePx')
                    if target_tolerance is None:
                        target_tolerance = tolerance_px
                    
                    if self._check_point_target(click_x, click_y, target,
                                              click.get('scale_factor', 1.0),
                                              click.get('offset_x', 0.0),
                                              click.get('offset_y', 0.0),
                                              tolerance_px=target_tolerance):
                        found = True
                        matched_click_idx = click_idx
                        break
                elif target_shape == 'freehand':
                    # НОВОЕ: проверка попадания клика на freehand-линию
                    target_tolerance = target.get('tolerance_px')
                    if target_tolerance is None:
                        target_tolerance = target.get('tolerancePx')

                    if target_tolerance is None:
                        target_tolerance = self.default_freehand_tolerance
                    if self._check_freehand_target(click_x, click_y, target,
                                                  click.get('scale_factor', 1.0),
                                                  click.get('offset_x', 0.0),
                                                  click.get('offset_y', 0.0),
                                                  tolerance_px=target_tolerance):
                        found = True
                        matched_click_idx = click_idx
                        break
            
            if found:
                found_targets.add(idx)
            
            targets_info.append({
                'index': idx,
                'label': target.get('label', f'Область {idx + 1}'),
                'found': found,
                'matched_click_idx': matched_click_idx if found else None
            })
        
        # Вычисляем результат для кликов
        found_count = len(found_targets)
        total_count = len(targets)
        
        # Calculate click score (used in both pathways)
        click_score = (found_count / total_count * 100) if total_count > 0 else 0.0

        # Список ошибочных под-целей (для последующего частичного ретрая)
        failed_subtests = [
            {
                "index": info.get("index"),
                "label": info.get("label", "")
            }
            for info in targets_info
            if not info.get("found")
        ]
        
        # НОВОЕ: Проверяем порог успеха из settings
        success_threshold = None
        if task_data:
            settings = task_data.get('settings', {})
            success_threshold = settings.get('success_threshold')
        
        # Определяем требуемое количество правильных кликов
        if success_threshold is not None:
            required_correct = min(success_threshold, total_count)  # Не может быть больше total
            click_success = found_count >= required_correct
            threshold_mode = True
        else:
            required_correct = total_count
            click_success = found_count == total_count
            threshold_mode = False
        
        # УРОВЕНЬ 2: проверка labels
        if requires_labels:
            user_labels = user_input.get('labels', [])
            labels_clicks = user_input.get('labels_clicks', [])
            if not isinstance(user_labels, list):
                user_labels = []
            if not isinstance(labels_clicks, list):
                labels_clicks = []
            # Извлекаем правильные labels из targets, а не из target_names
            # target_names может отсутствовать в answer_key
            correct_labels = [target.get('label', '') for target in targets]
            
            if not user_labels and not labels_clicks:
                if threshold_mode:
                    msg = f"❌ Введите названия для найденных областей ({found_count}/{required_correct} требуется из {total_count})"
                else:
                    msg = f"❌ Введите названия для найденных областей ({found_count}/{total_count})"
                return EvaluationResult(
                    success=False,
                    message=msg,
                    score=0.0,
                    metric="distance",
                    details={
                        'found_targets': list(found_targets),
                        'total_targets': total_count,
                        'targets_info': targets_info,
                        'found_count': found_count,
                        'required_correct': required_correct,
                        'threshold_mode': threshold_mode,
                        'level': 2,
                        'error': 'labels_missing',
                        'failed_subtests': failed_subtests,
                    }
                )
            
            # Проверяем labels для найденных targets
            found_targets_list = sorted(list(found_targets))
            found_correct_labels = [correct_labels[i] if i < len(correct_labels) else '' 
                                   for i in found_targets_list]
            if labels_clicks:
                # Привязка названия к цели ВСЕГДА по спатиальному якорю: берём имя у того
                # клика, который геометрически попал в эту цель (matched_click_idx).
                # Порядок ввода названий не учитывается. Если у цели нет привязанного
                # клика — название не продемонстрировано и не засчитывается (candidate='').
                matched_click_idx_by_target = {
                    info.get('index'): info.get('matched_click_idx')
                    for info in targets_info
                    if isinstance(info, dict)
                }
                found_user_labels = []
                for target_idx in found_targets_list:
                    candidate = ''
                    click_i = matched_click_idx_by_target.get(target_idx)
                    if click_i is not None and click_i < len(labels_clicks):
                        candidate = labels_clicks[click_i]
                    found_user_labels.append(candidate)
            else:
                # Legacy-формат без per-click названий (современный фронтенд всегда шлёт
                # labels_clicks — см. контракт test_clickui_evaluator_contract). Якоря нет.
                found_user_labels = user_labels[:len(found_targets_list)] if len(user_labels) >= len(found_targets_list) else user_labels
            
            labels_result = self._evaluate_labels(found_user_labels, found_correct_labels)
            
            # НОВОЕ: Комбинированный score
            # 70% за нахождение целей, 30% за правильные названия
            label_score = labels_result.get('score', 0.0)
            combined_score = (click_score * 0.7) + (label_score * 0.3)
            
            # Определяем успешность: клики И правильные labels
            # Внимание: для успеха labels должен быть success=True (т.е. все labels верны)
            # Но можно смягчить, используя порог на combined_score
            combined_success = click_success and labels_result['success']
            
            # Формируем сообщение
            if combined_success:
                if threshold_mode:
                    message = get_message("click_combined_success_threshold", 
                                       found_count=found_count, required_correct=required_correct, 
                                       total_count=total_count, labels_message=labels_result['message'])
                else:
                    message = get_message("click_combined_success", 
                                       found_count=found_count, total_count=total_count, 
                                       labels_message=labels_result['message'])
            else:
                if threshold_mode:
                    message = get_message("click_combined_fail_threshold", 
                                       found_count=found_count, required_correct=required_correct, 
                                       total_count=total_count, labels_message=labels_result['message'])
                else:
                    message = get_message("click_combined_fail", 
                                       found_count=found_count, total_count=total_count, 
                                       labels_message=labels_result['message'])
            
            return EvaluationResult(
                success=combined_success,
                score=combined_score,  # НОВОЕ
                message=message,
                metric="distance",
                details={
                    'found_targets': list(found_targets),
                    'total_targets': total_count,
                    'targets_info': targets_info,
                    'found_count': found_count,
                    'required_correct': required_correct,
                    'threshold_mode': threshold_mode,
                    'labels': labels_result,
                    'level': 2,
                    'failed_subtests': failed_subtests,
                }
            )
        
        # УРОВЕНЬ 1: только клики (базовая логика)
        if click_success:
            if threshold_mode:
                message = get_message("click_success_partial_threshold", 
                                   found_count=found_count, required_correct=required_correct, 
                                   total_count=total_count)
            else:
                message = get_message("click_success_all", found_count=found_count)
        else:
            found_labels = [info['label'] for info in targets_info if info['found']]
            if threshold_mode:
                message = get_message("click_fail_partial", 
                                   found_count=found_count, required_correct=required_correct, 
                                   total_count=total_count)
            else:
                message = get_message("click_fail_basic", 
                                   found_count=found_count, total_count=total_count)
            if found_labels:
                message += f"\nНайдено: {', '.join(found_labels)}"
        
        return EvaluationResult(
            success=click_success,
            score=click_score,  # НОВОЕ
            message=message,
            metric="distance",
            details={
                'found_targets': list(found_targets),
                'total_targets': total_count,
                'targets_info': targets_info,
                'found_count': found_count,
                'required_correct': required_correct,
                'threshold_mode': threshold_mode,
                'level': 1,
                'failed_subtests': failed_subtests,
            }
        )
    
    def _find_best_matching_line(self, target_points: List[Tuple[float, float]], 
                                 user_lines: List[Dict],
                                 used_lines: set,
                                 line_tolerance: float,
                                 drawing_context: Optional[Dict[str, Any]] = None) -> Tuple[Optional[Dict], int]:
        """
        Находит лучшую линию пользователя для заданного референсного target.
        
        Алгоритм:
        1. Для каждой доступной линии пользователя вычисляет покрытие
        2. Выбирает линию с максимальным покрытием
        3. Учитывает, что одна линия может соответствовать только одному target
        
        Args:
            target_points: Точки референсной линии [(x1, y1), (x2, y2), ...]
            user_lines: Список линий пользователя
            used_lines: Множество индексов уже использованных линий
            line_tolerance: Допустимое расстояние для оценки покрытия
        
        Returns:
            Tuple[Dict, int]: (линия пользователя, индекс в user_lines) или (None, -1)
        """
        if len(target_points) < 2:
            return (None, -1)
        
        best_line = None
        best_coverage = 0.0
        best_index = -1
        
        for idx, line in enumerate(user_lines):
            # Пропускаем уже использованные линии
            if idx in used_lines:
                continue
            
            line_points = line.get('points', [])
            if not line_points or len(line_points) < 2:
                continue
            
            # Преобразуем line_points в формат для calculate_line_coverage
            drawing_strokes = [{
                'type': 'brush_stroke',
                'points': [[p[0], p[1]] if isinstance(p, (list, tuple)) else [p.get('x', 0), p.get('y', 0)] 
                          for p in line_points]
            }]
            drawing_payload: Dict[str, Any] = {'drawing': drawing_strokes}
            if isinstance(drawing_context, dict):
                for key in ('image_width', 'image_height', 'display_width', 'display_height'):
                    if drawing_context.get(key) is not None:
                        drawing_payload[key] = drawing_context.get(key)
            
            # Вычисляем покрытие для этой линии
            coverage = self.calculate_line_coverage(target_points, drawing_payload, line_tolerance)
            
            # Если это лучшая линия, сохраняем её
            if coverage > best_coverage:
                best_coverage = coverage
                best_line = line
                best_index = idx
        
        return (best_line, best_index) if best_line else (None, -1)
    
    def _evaluate_click_with_lines(self, user_input: Dict[str, Any],
                                   answer_key: Dict[str, Any],
                                   task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Click-задания с freehand-линиями (поэтапная проверка).
        
        Этап 1: Проверка кликов для всех targets (обязательно)
        Этап 2: Проверка линий для freehand targets (только если все клики выполнены)
        
        Args:
            user_input: {
                'clicks': [...],
                'found_targets': [...],
                'lines': [
                    {
                        'target_index': int,  # Индекс freehand target (может быть None)
                        'points': [[x, y], ...],
                        'color': str,
                        'width': int
                    }
                ],
                'labels': [...]  # Для уровня 2-3
            }
            answer_key: {
                'targets': [...]
            }
            task_data: Данные задания
        
        Returns:
            EvaluationResult с результатами поэтапной проверки
        """
        targets = answer_key.get('targets', [])
        if not targets:
            return EvaluationResult(
                success=False,
                message="❌ Нет правильных ответов для проверки",
                score=0.0,
                metric="distance",
                details={'error': 'no_targets'}
            )
        
        # Получаем параметры из task_data
        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)
        
        tolerance_px = self.default_click_tolerance
        if task_data:
            settings = task_data.get('settings', {})
            tolerance_px = settings.get('tolerancePx', self.default_click_tolerance)
        
        # ЭТАП 1: Проверка кликов для всех targets
        clicks = user_input.get('clicks', [])
        found_targets = set()
        click_results = []
        
        for idx, target in enumerate(targets):
            target_shape = target.get('shape') or target.get('type')
            
            # Определяем тип target
            if target_shape is None:
                points = target.get('points', [])
                if len(points) >= 3:
                    target_shape = 'polygon'
                elif len(points) >= 2:
                    if target.get('type') == 'freehand' or target.get('shape') == 'freehand':
                        target_shape = 'freehand'
                    else:
                        target_shape = 'polygon' if len(points) >= 3 else 'freehand'
                elif 'point' in target or 'coordinates' in target:
                    target_shape = 'point'
            
            found = False
            matched_click_idx = None
            
            # Проверяем все клики на попадание в этот target
            for click_idx, click in enumerate(clicks):
                click_x = click['x']
                click_y = click['y']
                
                if target_shape == 'polygon':
                    if self._check_polygon_target(click_x, click_y, target,
                                                click.get('scale_factor', 1.0),
                                                click.get('offset_x', 0.0),
                                                click.get('offset_y', 0.0)):
                        found = True
                        matched_click_idx = click_idx
                        break
                elif target_shape == 'point':
                    target_tolerance = target.get('tolerance_px')
                    if target_tolerance is None:
                        target_tolerance = target.get('tolerancePx')
                    if target_tolerance is None:
                        target_tolerance = tolerance_px
                    if target_tolerance is None:
                        target_tolerance = 15.0  # Значение по умолчанию
                    if self._check_point_target(click_x, click_y, target,
                                              click.get('scale_factor', 1.0),
                                              click.get('offset_x', 0.0),
                                              click.get('offset_y', 0.0),
                                              tolerance_px=target_tolerance):
                        found = True
                        matched_click_idx = click_idx
                        break
                elif target_shape == 'freehand':
                    target_tolerance = target.get('tolerance_px')
                    if target_tolerance is None:
                        target_tolerance = target.get('tolerancePx')
                    if target_tolerance is None:
                        target_tolerance = tolerance_px
                    if target_tolerance is None:
                        target_tolerance = 15.0  # Значение по умолчанию
                    if self._check_freehand_target(click_x, click_y, target,
                                                  click.get('scale_factor', 1.0),
                                                  click.get('offset_x', 0.0),
                                                  click.get('offset_y', 0.0),
                                                  tolerance_px=target_tolerance):
                        found = True
                        matched_click_idx = click_idx
                        break
            
            if found:
                found_targets.add(idx)
            
            click_results.append({
                'target_index': idx,
                'click_success': found,
                'requires_line': target_shape == 'freehand',
                'matched_click_idx': matched_click_idx if found else None
            })
        
        # Проверяем, все ли клики по ПОЛИГОНАМ выполнены (не freehand)
        polygon_targets = [idx for idx, target in enumerate(targets) 
                          if (target.get('shape') != 'freehand' and target.get('type') != 'freehand')]
        found_polygon_targets = [idx for idx in found_targets if idx in polygon_targets]
        all_clicks_done = len(found_polygon_targets) == len(polygon_targets) if polygon_targets else True
        
        if not all_clicks_done:
            # Не все клики по полигонам выполнены - возвращаем ошибку
            found_count = len(found_polygon_targets)
            total_count = len(polygon_targets)
            return EvaluationResult(
                success=False,
                message=f"❌ Сначала выполните все клики ({found_count}/{total_count})",
                score=(found_count / total_count * 100.0) if total_count > 0 else 0.0,
                metric="distance",
                details={
                    'click_results': click_results,
                    'found_targets': list(found_targets),
                    'total_targets': total_count,
                    'found_count': found_count,
                    'stage': 'clicks'
                }
            )
        
        # ЭТАП 2: Проверка линий для freehand targets (только если все клики выполнены)
        user_lines = user_input.get('lines', [])
        freehand_targets = [idx for idx, target in enumerate(targets) 
                           if (target.get('shape') == 'freehand' or target.get('type') == 'freehand')]
        
        if not freehand_targets:
            # Нет freehand targets - проверяем только клики
            return EvaluationResult(
                success=True,
                message=f"✅ Все клики выполнены ({len(found_targets)}/{len(targets)})",
                score=100.0,
                metric="distance",
                details={
                    'click_results': click_results,
                    'found_targets': list(found_targets),
                    'total_targets': len(targets)
                }
            )
        
        if not user_lines:
            # Есть freehand targets, но нет нарисованных линий
            return EvaluationResult(
                success=False,
                message=f"❌ Теперь нарисуйте линии для {len(freehand_targets)} границ",
                score=0.0, # Можно было бы считать клики, но здесь этап 2 не начат
                metric="distance",
                details={
                    'click_results': click_results,
                    'freehand_targets': freehand_targets,
                    'stage': 'lines',
                    'error': 'lines_missing'
                }
            )
        
        # Получаем tolerance по умолчанию для всех targets
        default_tolerance = 18.0
        
        # Проверяем покрытие линий для каждого freehand target
        # Используем жадный алгоритм: для каждого target находим лучшую доступную линию
        line_results = []
        used_line_indices = set()  # Индексы уже использованных линий
        
        for freehand_idx in freehand_targets:
            target = targets[freehand_idx]
            target_points = target.get('points', [])
            
            if len(target_points) < 2:
                continue
            
            # Получаем tolerance для этого target
            line_tolerance = target.get('line_tolerance_px') or target.get('lineTolerancePx') or default_tolerance
            
            # Ищем линию пользователя для этого target
            user_line = None
            matched_line_idx = -1
            
            # Сначала проверяем, есть ли явно указанный target_index
            for idx, line in enumerate(user_lines):
                if line.get('target_index') == freehand_idx:
                    user_line = line
                    matched_line_idx = idx
                    used_line_indices.add(idx)
                    break
            
            # Если явного соответствия нет, используем улучшенный алгоритм поиска
            if not user_line:
                user_line, matched_line_idx = self._find_best_matching_line(
                    target_points, user_lines, used_line_indices, line_tolerance, drawing_context=user_input
                )
                if matched_line_idx >= 0:
                    used_line_indices.add(matched_line_idx)
            
            if not user_line:
                # Линия не найдена для этого target
                line_results.append({
                    'target_index': freehand_idx,
                    'line_success': False,
                    'coverage': 0.0,
                    'error': 'line_not_found',
                    'matched_line_idx': None
                })
                continue
            
            # Проверяем покрытие линии
            line_points = user_line.get('points', [])
            if not line_points:
                line_results.append({
                    'target_index': freehand_idx,
                    'line_success': False,
                    'coverage': 0.0,
                    'error': 'empty_line',
                    'matched_line_idx': matched_line_idx if matched_line_idx >= 0 else None
                })
                continue
            
            # Преобразуем line_points в формат для calculate_line_coverage
            # Формат: список словарей с 'drawing'
            drawing_strokes = [{
                'type': 'brush_stroke',
                'points': [[p[0], p[1]] if isinstance(p, (list, tuple)) else [p.get('x', 0), p.get('y', 0)] 
                          for p in line_points]
            }]
            
            # Получаем tolerance и threshold из target
            # Более строгие условия по умолчанию (если не задано в таргете):
            # - tolerance: уже, чтобы требовать ближе к эталонной линии
            # - threshold: выше, чтобы требовать большее покрытие
            line_tolerance = target.get('line_tolerance_px') or target.get('lineTolerancePx') or 12.0
            score_config = target.get('score', {})
            threshold = score_config.get('threshold', 0.75) if isinstance(score_config, dict) else 0.75
            
            line_drawing_context = {
                'drawing': drawing_strokes,
                'image_width': user_input.get('image_width'),
                'image_height': user_input.get('image_height'),
                'display_width': user_input.get('display_width'),
                'display_height': user_input.get('display_height'),
            }

            # Вычисляем покрытие с улучшенной оценкой
            coverage = self.calculate_line_coverage(
                target_points, line_drawing_context, line_tolerance, use_improved_evaluation=True
            )
            line_success = coverage >= (threshold * 100)
            
            # Дополнительная информация для логирования (если нужно)
            effective_line_tolerance = self._resolve_line_tolerance_px(line_tolerance, line_drawing_context)
            bidirectional = self._calculate_bidirectional_coverage(
                target_points, drawing_strokes, effective_line_tolerance
            )
            shape_score = self._calculate_shape_similarity(
                target_points, drawing_strokes, effective_line_tolerance
            )
            
            # Логирование для отладки с детальной информацией
            logger.debug(f"🎨 Проверка линии {freehand_idx}: coverage={coverage:.1f}% (ref={bidirectional['reference_coverage']:.1f}%, "
                        f"user={bidirectional['user_coverage']:.1f}%, shape={shape_score:.1f}%), threshold={threshold*100:.1f}%, "
                        f"tolerance={line_tolerance}px, success={line_success}, точек в линии={len(line_points)}")
            
            line_results.append({
                'target_index': freehand_idx,
                'line_success': line_success,
                'coverage': coverage,
                'threshold': threshold * 100,
                'matched_line_idx': matched_line_idx if matched_line_idx >= 0 else None
            })
        
        # Проверяем успешность всех линий
        all_lines_success = all(r['line_success'] for r in line_results)
        lines_count = len([r for r in line_results if r['line_success']])
        total_lines = len(freehand_targets)
        
        # УРОВЕНЬ 2-3: Проверка labels если требуется
        labels_result = None
        if requires_labels:
            user_labels = user_input.get('labels', [])
            labels_clicks = user_input.get('labels_clicks', [])
            labels_lines = user_input.get('labels_lines', [])
            correct_labels = [target.get('label', '') for target in targets]
            
            if not user_labels and not labels_clicks and not labels_lines:
                return EvaluationResult(
                    success=False,
                    message=f"❌ Введите названия для всех областей",
                    score=0.0,
                    metric="distance",
                    details={
                        'click_results': click_results,
                        'line_results': line_results,
                        'found_targets': list(found_targets),
                        'total_targets': len(targets),
                        'stage': 'labels',
                        'error': 'labels_missing'
                    }
                )
            
            # Проверяем labels для всех targets (включая freehand)
            found_targets_list = sorted(list(found_targets))
            found_correct_labels = [correct_labels[i] if i < len(correct_labels) else '' 
                                   for i in found_targets_list]
            if labels_clicks or labels_lines:
                matched_click_idx_by_target = {
                    r.get('target_index'): r.get('matched_click_idx')
                    for r in click_results
                    if isinstance(r, dict)
                }
                matched_line_idx_by_target = {
                    r.get('target_index'): r.get('matched_line_idx')
                    for r in line_results
                    if isinstance(r, dict)
                }

                found_user_labels = []
                for idx in found_targets_list:
                    if idx in freehand_targets:
                        li = matched_line_idx_by_target.get(idx)
                        found_user_labels.append(labels_lines[li] if li is not None and li < len(labels_lines) else '')
                    else:
                        li = matched_click_idx_by_target.get(idx)
                        found_user_labels.append(labels_clicks[li] if li is not None and li < len(labels_clicks) else '')
            else:
                found_user_labels = user_labels[:len(found_targets_list)] if len(user_labels) >= len(found_targets_list) else user_labels

            # Если какие-то названия для найденных целей отсутствуют — просим заполнить
            if len(found_user_labels) < len(found_targets_list) or any((not str(x).strip()) for x in found_user_labels):
                return EvaluationResult(
                    success=False,
                    message=f"❌ Введите названия для всех областей",
                    score=0.0,
                    metric="distance",
                    details={
                        'click_results': click_results,
                        'line_results': line_results,
                        'found_targets': list(found_targets),
                        'total_targets': len(targets),
                        'stage': 'labels',
                        'error': 'labels_missing'
                    }
                )
            
            labels_result = self._evaluate_labels(found_user_labels, found_correct_labels)
        
        # Вычисляем правильные счетчики для кликов (только polygon targets)
        found_clicks_count = len(found_polygon_targets)
        total_clicks_count = len(polygon_targets)
        
        # Комбинированный результат
        # НОВОЕ: Расчет совокупного скора
        total_parts = total_clicks_count + total_lines
        if requires_labels:
            total_parts += len(correct_labels)
        
        correct_parts = found_clicks_count + lines_count
        if requires_labels:
            correct_parts += (labels_result['score'] * len(correct_labels) / 100.0)
            
        score = (correct_parts / total_parts * 100.0) if total_parts > 0 else 0.0
        
        # Комбинированный результат
        combined_success = all_clicks_done and all_lines_success and (not requires_labels or labels_result['success'])
        
        if combined_success:
            message = "✅ Правильно! Все этапы выполнены"
        else:
            message = "❌ Задание выполнено не полностью или с ошибками"

        return EvaluationResult(
            success=combined_success,
            message=message,
            score=score,
            metric="distance",
            details={
                'click_results': click_results,
                'line_results': line_results,
                'found_targets': list(found_targets),
                'total_targets': len(targets),
                'found_clicks_count': found_clicks_count,
                'total_clicks_count': total_clicks_count,
                'found_lines_count': lines_count,
                'total_lines_count': total_lines,
                'freehand_targets': freehand_targets,
                'polygon_targets': polygon_targets,
                'lines_count': lines_count,
                'total_lines': total_lines,
                'labels': labels_result if requires_labels else None,
                'level': 2 if requires_labels else 1
            }
        )
    
    def _check_point_target(self, click_x: float, click_y: float, 
                           target: Dict, scale_factor: float, 
                           offset_x: float, offset_y: float,
                           tolerance_px: Optional[int] = None) -> bool:
        """
        Проверка попадания клика в точечную цель (с радиусом tolerance).
        
        ВАЖНО: click_x и click_y уже в координатах оригинального изображения.
        
        Args:
            tolerance_px: Tolerance in pixels (from task settings or target)
        """
        # Get tolerance from target if specified, otherwise use default
        tolerance = tolerance_px if tolerance_px is not None else self.default_click_tolerance
        
        # Try to get tolerance from target (for backward compatibility)
        if tolerance == self.default_click_tolerance and 'tolerance_px' in target:
            tolerance = target['tolerance_px']
        elif tolerance == self.default_click_tolerance and 'tolerancePx' in target:
            tolerance = target['tolerancePx']
        
        # Получаем координаты цели (уже в оригинальных координатах)
        # Support both validated model format (point) and legacy format (coordinates)
        if 'point' in target:
            # Validated Pydantic model format
            point = target['point']
            target_x = point[0] if isinstance(point, (list, tuple)) else point
            target_y = point[1] if isinstance(point, (list, tuple)) else point
        elif 'coordinates' in target:
            # Legacy format
            target_x = target['coordinates'][0]
            target_y = target['coordinates'][1]
        elif 'points' in target and len(target['points']) > 0:
            # Для полигонов берем первую точку как центр
            target_x = target['points'][0][0]
            target_y = target['points'][0][1]
        else:
            return False
        
        # Вычисляем расстояние
        distance = ((click_x - target_x) ** 2 + (click_y - target_y) ** 2) ** 0.5
        
        return distance <= tolerance
    
    def _check_polygon_target(self, click_x: float, click_y: float,
                             target: Dict, scale_factor: float,
                             offset_x: float, offset_y: float) -> bool:
        """
        Проверка попадания клика в полигональную цель.
        
        ВАЖНО: click_x и click_y уже в координатах оригинального изображения
        (преобразованы в _canvas_to_image_coords), поэтому координаты полигона
        из answer_key (тоже в оригинальных координатах) используются напрямую.
        """
        if 'points' not in target or len(target['points']) < 3:
            return False
        
        # Координаты полигона уже в координатах оригинального изображения
        # НЕ нужно применять scale_factor и offset!
        polygon_points = [(point[0], point[1]) for point in target['points']]
        
        # Используем утилиту из geometry.py
        return point_in_polygon(click_x, click_y, polygon_points)
    
    # =========================================================================
    # HELPER METHODS для проверки labels (ФАЗА 2: Уровни сложности)
    # =========================================================================
    
    @staticmethod
    def _format_normalization_kinds(normalization_kinds: List[str]) -> str:
        kind_labels = {
            'layout': 'раскладки',
            'yo': 'е/ё',
            'y_i': 'ы/і',
        }
        normalized = []
        for kind in normalization_kinds or []:
            key = str(kind or '').strip().lower()
            if key and key in kind_labels and kind_labels[key] not in normalized:
                normalized.append(kind_labels[key])

        if not normalized:
            return 'текста'
        if len(normalized) == 1:
            return normalized[0]
        if len(normalized) == 2:
            return f"{normalized[0]} и {normalized[1]}"
        return f"{', '.join(normalized[:-1])} и {normalized[-1]}"

    def _summarize_tolerance_matches(self, matches: List[Dict[str, Any]]) -> Dict[str, Any]:
        normalized_matches = []
        normalization_kinds: List[str] = []
        raw_types = set()

        for raw_match in matches or []:
            if not isinstance(raw_match, dict):
                continue

            match_type = str(raw_match.get('type') or '').strip().lower()
            normalized_kinds = raw_match.get('normalized_kinds')
            if not isinstance(normalized_kinds, list):
                normalized_kinds = []
            cleaned_kinds = []
            for kind in normalized_kinds:
                kind_key = str(kind or '').strip().lower()
                if not kind_key:
                    continue
                cleaned_kinds.append(kind_key)
                if kind_key not in normalization_kinds:
                    normalization_kinds.append(kind_key)

            item = dict(raw_match)
            if cleaned_kinds:
                item['normalized_kinds'] = cleaned_kinds
            normalized_matches.append(item)

            if match_type in {'typo', 'ending', 'both'}:
                raw_types.add(match_type)

        if 'both' in raw_types or ('typo' in raw_types and 'ending' in raw_types):
            tolerance_type = 'both'
        elif 'ending' in raw_types:
            tolerance_type = 'ending'
        elif 'typo' in raw_types:
            tolerance_type = 'typo'
        elif normalization_kinds:
            tolerance_type = 'normalized'
        else:
            tolerance_type = None

        return {
            'matches': normalized_matches,
            'tolerance_type': tolerance_type,
            'normalization_kinds': normalization_kinds,
            'has_tolerance': bool(tolerance_type),
        }

    def _build_tolerance_explanation(self, subject: str, summary: Optional[Dict[str, Any]]) -> str:
        if not isinstance(summary, dict):
            return ''

        tolerance_type = str(summary.get('tolerance_type') or '').strip().lower()
        normalization_kinds = summary.get('normalization_kinds') or []
        normalization_part = self._format_normalization_kinds(normalization_kinds)

        if tolerance_type == 'typo':
            return f"{subject} засчитан с учетом опечатки."
        if tolerance_type == 'ending':
            return f"{subject} засчитан с учетом формы слова."
        if tolerance_type == 'both':
            return f"{subject} засчитан с учетом формы слова и опечатки."
        if tolerance_type == 'normalized':
            return f"{subject} засчитан после нормализации {normalization_part}."
        return ''

    def _compare_named_text(self, user_text: str, correct_text: str) -> Optional[Dict[str, Any]]:
        safe_user = str(user_text or '').strip()
        safe_correct = str(correct_text or '').strip()
        if not safe_user or not safe_correct:
            return None
        return compare_words_with_tolerance_info(
            safe_user,
            safe_correct,
            self._get_tolerance_config_for_labels()
        )

    def _tokenize_label_text(self, text: str) -> List[str]:
        safe_text = str(text or '').strip().lower()
        if not safe_text:
            return []

        normalized = normalize_text(
            safe_text,
            normalize_yo=True,
            normalize_layout=True,
            normalize_y_i=True,
        )
        return [
            str(token).strip()
            for token in extract_words_from_text(normalized)
            if str(token).strip()
        ]

    def _match_label_with_omitted_words(self, user_label: str, correct_label: str) -> Optional[Dict[str, Any]]:
        safe_user = str(user_label or '').strip()
        safe_correct = str(correct_label or '').strip()
        if not safe_user or not safe_correct:
            return None

        user_words = self._tokenize_label_text(safe_user)
        correct_words = self._tokenize_label_text(safe_correct)
        if not user_words or not correct_words:
            return None

        omitted_count = len(correct_words) - len(user_words)
        if omitted_count not in (1, 2):
            return None

        tolerance_config = self._get_tolerance_config_for_labels()
        omitted_words: List[str] = []
        user_idx = 0
        correct_idx = 0

        while user_idx < len(user_words) and correct_idx < len(correct_words):
            if compare_words_with_tolerance_info(
                user_words[user_idx],
                correct_words[correct_idx],
                tolerance_config,
            ) is not None:
                user_idx += 1
                correct_idx += 1
                continue

            omitted_words.append(correct_words[correct_idx])
            correct_idx += 1
            if len(omitted_words) > 2:
                return None

        if user_idx < len(user_words):
            return None

        while correct_idx < len(correct_words):
            omitted_words.append(correct_words[correct_idx])
            correct_idx += 1
            if len(omitted_words) > 2:
                return None

        if len(omitted_words) not in (1, 2):
            return None

        return {
            'user_answer': safe_user,
            'correct_answer': safe_correct,
            'omitted_words': omitted_words,
            'omitted_phrase': ' '.join(omitted_words).strip(),
        }

    def _build_draw_label_user_judgement(self, labels_eval: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if not isinstance(labels_eval, dict):
            return None

        unmatched_labels = labels_eval.get('unmatched_labels')
        if not isinstance(unmatched_labels, list) or not unmatched_labels:
            return None

        soft_mismatches: List[Dict[str, Any]] = []
        for item in unmatched_labels:
            if not isinstance(item, (list, tuple)) or len(item) < 3:
                return None

            try:
                mismatch_index = int(item[0])
            except Exception:
                return None

            omission_match = self._match_label_with_omitted_words(item[1], item[2])
            if omission_match is None:
                return None

            omission_match['index'] = mismatch_index
            soft_mismatches.append(omission_match)

        if not soft_mismatches:
            return None

        return {
            'reason': 'omitted_words',
            'message': 'В одном или нескольких названиях пропущено 1–2 слова. Решите, считать ли ответ верным.',
            'soft_mismatches': soft_mismatches,
        }

    def _evaluate_labels(self, user_labels: List[str],
                        correct_labels: List[str]) -> Dict[str, Any]:
        if not correct_labels:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Нет правильных названий для проверки',
                'matched_labels': [],
                'unmatched_labels': []
            }

        if not user_labels:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Названия не введены',
                'matched_labels': [],
                'unmatched_labels': []
            }

        tolerance_config = self._get_tolerance_config_for_labels()
        matched = []
        unmatched = []
        tolerance_matches = []
        tolerance_matches = []

        max_len = max(len(user_labels), len(correct_labels))
        for i in range(max_len):
            user_label_raw = user_labels[i].strip() if i < len(user_labels) and user_labels[i] else ''
            correct_label_raw = correct_labels[i] if i < len(correct_labels) else ''

            if user_label_raw and correct_label_raw:
                tolerance_info = compare_words_with_tolerance_info(
                    user_label_raw,
                    correct_label_raw,
                    tolerance_config
                )
                if tolerance_info is not None:
                    matched.append((i, user_label_raw, correct_label_raw))
                    if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                        tolerance_matches.append({
                            'index': i,
                            'type': tolerance_info.get('type', 'exact'),
                            'user_answer': user_label_raw,
                            'correct_answer': correct_label_raw,
                            'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                            if isinstance(tolerance_info.get('normalized_kinds'), list)
                            else [],
                        })
                else:
                    unmatched.append((i, user_label_raw, correct_label_raw))
            elif user_label_raw and not correct_label_raw:
                unmatched.append((i, user_label_raw, ''))
            elif not user_label_raw and correct_label_raw:
                unmatched.append((i, '', correct_label_raw))

        total_labels = len(correct_labels)
        matched_count = len(matched)
        success = matched_count == total_labels and len(unmatched) == 0
        score = (matched_count / total_labels * 100) if total_labels > 0 else 0.0

        tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)
        tolerance_explanation = self._build_tolerance_explanation('Название', tolerance_summary)

        if success:
            if tolerance_summary.get('has_tolerance'):
                message = get_message('labels_success_tolerance', matched_count=matched_count, total_labels=total_labels)
            else:
                message = get_message('labels_success_all', matched_count=matched_count, total_labels=total_labels)
        else:
            if total_labels > 0:
                message = get_message('labels_fail_score', matched_count=matched_count, total_labels=total_labels, score=score)
            else:
                message = get_message('labels_fail', matched_count=matched_count, total_labels=total_labels)

        return {
            'success': success,
            'score': score,
            'message': message,
            'matched_labels': matched,
            'unmatched_labels': unmatched,
            'tolerance_matches': tolerance_summary.get('matches', []),
            'tolerance_type': tolerance_summary.get('tolerance_type'),
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': tolerance_explanation
        }

    def _evaluate_label(self, user_label: str, correct_label: str) -> Dict[str, Any]:
        """
        Проверяет одно название пользователя против правильного названия.
        
        Используется для draw заданий уровня 2, где пользователь должен
        ввести название для ближайшей структуры.
        
        Использует нормализацию опечаток и раскладок клавиатуры, как в заданиях
        Открытый ответ и Тест уровня 2.
        
        Args:
            user_label: Название от пользователя (str)
            correct_label: Правильное название (str)
        
        Returns:
            dict: {
                'success': bool,
                'score': float,  # 0.0 или 100.0
                'message': str
            }
        """
        if not correct_label:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Нет правильного названия для проверки'
            }
        
        if not user_label or not user_label.strip():
            return {
                'success': False,
                'score': 0.0,
                'message': 'Название не введено'
            }
        
        # Загружаем конфигурацию толерантности
        tolerance_config = self._get_tolerance_config_for_labels()
        
        # Используем compare_words_with_tolerance_info для проверки с учетом опечаток и раскладок
        tolerance_info = compare_words_with_tolerance_info(
            user_label.strip(),
            correct_label,
            tolerance_config
        )
        
        success = tolerance_info is not None
        normalized_kinds = tolerance_info.get('normalized_kinds', []) if isinstance(tolerance_info, dict) else []
        tolerance_summary = self._summarize_tolerance_matches(
            [{
                'type': tolerance_info.get('type', 'exact'),
                'user_answer': user_label.strip(),
                'correct_answer': correct_label,
                'normalized_kinds': list(normalized_kinds) if isinstance(normalized_kinds, list) else [],
            }] if success and (tolerance_info.get('type', 'exact') != 'exact' or normalized_kinds) else []
        )
        tolerance_explanation = self._build_tolerance_explanation("Название", tolerance_summary)
        
        if success:
            # Определяем тип совпадения для сообщения
            match_type = tolerance_info.get('type', 'exact')
            if match_type == 'exact':
                message = get_message("label_correct", correct_label=correct_label)
            elif match_type in ('typo', 'ending', 'both'):
                message = get_message("label_correct_tolerance", correct_label=correct_label)
            else:
                message = get_message("label_correct", correct_label=correct_label)
        else:
            message = get_message("label_wrong", correct_label=correct_label)
        
        return {
            'success': success,
            'message': message,
            'tolerance_matches': tolerance_summary.get('matches', []),
            'tolerance_type': tolerance_summary.get('tolerance_type'),
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': tolerance_explanation
        }
    
    def _evaluate_click_level_3_multiple_strokes(self, user_input: Dict[str, Any],
                                                  answer_key: Dict[str, Any],
                                                  task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Click-задания уровня 3 с множественными штрихами.
        
        Каждый штрих должен соответствовать отдельному target.
        Проверяет покрытие каждого штриха против соответствующего target.
        
        Args:
            user_input: {
                'drawing': [stroke1, stroke2, ...],  # Каждый штрих отдельно
                'labels': [label1, label2, ...],  # Названия для каждого штриха
                'image_width': int,
                'image_height': int,
                'brush_radius': int
            }
            answer_key: {
                'targets': [target1, target2, ...]
            }
            task_data: Данные задания
        
        Returns:
            EvaluationResult с комбинированным результатом
        """
        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)

        # Поддерживаем два формата:
        # 1. Старый формат из DrawTaskRendererV2: 'drawing' - список штрихов
        # 2. Новый формат из ClickTaskRendererV2 / web: 'polygons' и 'lines' - отдельные списки
        user_drawing = user_input.get('drawing', [])
        user_polygons = user_input.get('polygons', [])
        user_lines = user_input.get('lines', [])
        user_labels = user_input.get('labels', [])
        labels_polygons = user_input.get('labels_polygons', [])
        labels_lines = user_input.get('labels_lines', [])
        targets = answer_key.get('targets', [])

        if not targets:
            return EvaluationResult(
                success=False,
                message="Нет эталонных областей",
                score=0.0,
                metric="IoU",
                details={'error': 'no_targets', 'level': 3}
            )

        polygon_targets = [
            idx for idx, t in enumerate(targets)
            if (t.get('shape') != 'freehand' and t.get('type') != 'freehand')
        ]
        freehand_targets = [
            idx for idx, t in enumerate(targets)
            if (t.get('shape') == 'freehand' or t.get('type') == 'freehand')
        ]

        # Legacy fallback: if polygons/lines are not provided, try to split drawing by points count.
        if (not user_polygons and not user_lines) and isinstance(user_drawing, list) and user_drawing:
            for stroke in user_drawing:
                if not isinstance(stroke, dict):
                    continue
                pts = stroke.get('points', [])
                if not isinstance(pts, list):
                    continue
                if len(pts) >= 3:
                    user_polygons.append({'points': pts})
                elif len(pts) >= 2:
                    user_lines.append({'points': pts})

        if not user_polygons and not user_lines:
            return EvaluationResult(
                success=False,
                message="Сначала нарисуйте области",
                score=0.0,
                metric="IoU",
                details={
                    'error': 'no_drawing',
                    'stage': 'drawing',
                    'level': 3,
                    'drawing': {
                        'success': False,
                        'coverage': 0.0,
                        'message': 'missing_drawing',
                    },
                }
            )

        threshold = self.default_draw_threshold

        # -----------------------------
        # Polygons: match contours to polygon targets
        # -----------------------------
        polygon_results = []
        used_polygon_indices = set()

        for target_idx in polygon_targets:
            target = targets[target_idx]
            polygon_points = target.get('points', [])
            if not isinstance(polygon_points, list) or len(polygon_points) < 3:
                continue

            best = None
            best_idx = None

            for poly_idx, poly in enumerate(user_polygons):
                if poly_idx in used_polygon_indices:
                    continue
                if not isinstance(poly, dict):
                    continue
                pts = poly.get('points', [])
                if not isinstance(pts, list) or len(pts) < 3:
                    continue

                single = {
                    'drawing': [{'type': 'brush_stroke', 'points': pts}],
                    'image_width': user_input.get('image_width'),
                    'image_height': user_input.get('image_height'),
                    'brush_radius': user_input.get('brush_radius')
                }

                cov = calculate_polygon_coverage(
                    polygon_points, single,
                    task_data=task_data,
                    answer_key={'targets': [target]}
                )

                if best is None or cov > best:
                    best = cov
                    best_idx = poly_idx

            if best is None:
                polygon_results.append({
                    'target_index': target_idx,
                    'polygon_success': False,
                    'coverage': 0.0,
                    'threshold': threshold,
                    'matched_polygon_idx': None
                })
                continue

            used_polygon_indices.add(best_idx)
            coverage_value = best
            if coverage_value <= 1.0:
                coverage_value *= 100.0
            polygon_results.append({
                'target_index': target_idx,
                'polygon_success': coverage_value >= threshold,
                'coverage': coverage_value,
                'threshold': threshold,
                'matched_polygon_idx': best_idx
            })

        # -----------------------------
        # Lines: match strokes to freehand targets
        # -----------------------------
        line_results = []
        used_line_indices = set()
        for target_idx in freehand_targets:
            target = targets[target_idx]
            target_points = target.get('points', [])
            if not isinstance(target_points, list) or len(target_points) < 2:
                continue

            line_tolerance = target.get('line_tolerance_px') or target.get('lineTolerancePx') or 12.0
            score_config = target.get('score', {})
            line_threshold = score_config.get('threshold', 0.75) if isinstance(score_config, dict) else 0.75

            user_line, matched_line_idx = self._find_best_matching_line(
                target_points, user_lines, used_line_indices, line_tolerance, drawing_context=user_input
            )
            if matched_line_idx is not None and matched_line_idx >= 0:
                used_line_indices.add(matched_line_idx)

            if not user_line:
                line_results.append({
                    'target_index': target_idx,
                    'line_success': False,
                    'coverage': 0.0,
                    'threshold': line_threshold * 100,
                    'matched_line_idx': None
                })
                continue

            line_points = user_line.get('points', [])
            drawing_strokes = [{
                'type': 'brush_stroke',
                'points': [[p[0], p[1]] if isinstance(p, (list, tuple)) else [p.get('x', 0), p.get('y', 0)] for p in line_points]
            }]

            line_drawing_context = {
                'drawing': drawing_strokes,
                'image_width': user_input.get('image_width'),
                'image_height': user_input.get('image_height'),
                'display_width': user_input.get('display_width'),
                'display_height': user_input.get('display_height'),
            }

            coverage = self.calculate_line_coverage(
                target_points, line_drawing_context, line_tolerance, use_improved_evaluation=True
            )
            ok = coverage >= (line_threshold * 100)
            line_results.append({
                'target_index': target_idx,
                'line_success': ok,
                'coverage': coverage,
                'threshold': line_threshold * 100,
                'matched_line_idx': matched_line_idx if matched_line_idx is not None and matched_line_idx >= 0 else None
            })

        all_polygons_success = all(r.get('polygon_success') for r in polygon_results) if polygon_targets else True
        all_lines_success = all(r.get('line_success') for r in line_results) if freehand_targets else True

        found_targets = set()
        fallback_draw_details = None
        if polygon_targets and not all_polygons_success and user_input.get('drawing'):
            fallback_draw_details = self._evaluate_drawing_coverage(user_input, answer_key, task_data)
            fallback_coverage = fallback_draw_details.get('coverage', 0.0)
            fallback_success = fallback_coverage >= threshold
            if fallback_success:
                all_polygons_success = True
                for r in polygon_results:
                    if not r.get('polygon_success'):
                        r['polygon_success'] = True
                        r['coverage'] = fallback_coverage
                        r['matched_polygon_idx'] = r.get('matched_polygon_idx') or 0
        for r in polygon_results:
            if r.get('polygon_success'):
                found_targets.add(r.get('target_index'))
        for r in line_results:
            if r.get('line_success'):
                found_targets.add(r.get('target_index'))

        # Labels (required only for found targets)
        labels_result = {'success': True, 'message': ''}
        if requires_labels:
            correct_labels = [target.get('label', '') for target in targets]
            found_targets_list = sorted([x for x in found_targets if isinstance(x, int)])
            total_targets = len(targets)

            def _normalize_label_list(source: List[str], count: int) -> List[str]:
                if not source:
                    return [''] * count
                normalized = list(source)[:count]
                if len(normalized) < count:
                    normalized.extend([''] * (count - len(normalized)))
                return normalized

            normalized_labels = _normalize_label_list(user_labels, total_targets)
            normalized_polygon_labels = _normalize_label_list(labels_polygons, total_targets)
            normalized_line_labels = _normalize_label_list(labels_lines, total_targets)

            if not any(normalized_labels) and not any(normalized_polygon_labels) and not any(normalized_line_labels):
                return EvaluationResult(
                    success=False,
                    message=f"❌ Введите названия для всех областей",
                    score=0.0,
                    metric="IoU",
                    details={
                        'polygon_results': polygon_results,
                        'line_results': line_results,
                        'found_targets': found_targets_list,
                        'total_targets': len(targets),
                        'stage': 'labels',
                        'error': 'labels_missing',
                        'level': 3
                    }
                )

            matched_polygon_idx_by_target = {
                r.get('target_index'): r.get('matched_polygon_idx')
                for r in polygon_results
                if isinstance(r, dict)
            }
            matched_line_idx_by_target = {
                r.get('target_index'): r.get('matched_line_idx')
                for r in line_results
                if isinstance(r, dict)
            }

            # Привязка названия к цели ВСЕГДА по спатиальному якорю: берём имя у того
            # контура/линии, который геометрически сопоставлен этой цели
            # (matched_polygon_idx / matched_line_idx). Порядок ввода не учитывается.
            # Если для семейства (контуры/линии) переданы привязанные названия, но у
            # конкретной цели якоря нет — название не засчитывается (candidate='').
            # Legacy-исключение: если привязанных названий семейства нет вовсе, а есть
            # только плоский список labels (старый формат), используем его по индексу
            # цели как единственный доступный источник (современный фронтенд всегда
            # шлёт labels_polygons/labels_lines — см. контракт).
            found_user_labels = []
            found_correct_labels = []
            for idx in found_targets_list:
                found_correct_labels.append(correct_labels[idx] if idx < len(correct_labels) else '')
                if idx in freehand_targets:
                    li = matched_line_idx_by_target.get(idx)
                    candidate = ''
                    if li is not None and li < len(labels_lines):
                        candidate = labels_lines[li]
                    elif not labels_lines and idx < len(normalized_labels):
                        candidate = normalized_labels[idx]
                    found_user_labels.append(candidate)
                else:
                    pi = matched_polygon_idx_by_target.get(idx)
                    candidate = ''
                    if labels_polygons and pi is not None and pi < len(labels_polygons):
                        candidate = labels_polygons[pi]
                    elif not labels_polygons and idx < len(normalized_labels):
                        candidate = normalized_labels[idx]
                    found_user_labels.append(candidate)

            if len(found_user_labels) < len(found_targets_list) or any((not str(x).strip()) for x in found_user_labels):
                return EvaluationResult(
                    success=False,
                    message=f"❌ Введите названия для всех областей",
                    score=0.0,
                    metric="IoU",
                    details={
                        'polygon_results': polygon_results,
                        'line_results': line_results,
                        'found_targets': found_targets_list,
                        'total_targets': len(targets),
                        'stage': 'labels',
                        'error': 'labels_missing',
                        'level': 3
                    }
                )

            labels_result = self._evaluate_labels(found_user_labels, found_correct_labels)

        combined_success = all_polygons_success and all_lines_success and (labels_result.get('success') if requires_labels else True)

        found_polygons = len([r for r in polygon_results if r.get('polygon_success')])
        total_polygons = len(polygon_targets)
        found_lines = len([r for r in line_results if r.get('line_success')])
        total_lines = len(freehand_targets)
        message = f"Contours: {found_polygons}/{total_polygons}, Lines: {found_lines}/{total_lines}"

        if requires_labels:
            if combined_success:
                message = f"✅ Отлично! Контуры: {found_polygons}/{total_polygons}, Штрихи: {found_lines}/{total_lines}, {labels_result.get('message', '')}"
            else:
                message = f"❌ Контуры: {found_polygons}/{total_polygons}, Штрихи: {found_lines}/{total_lines}"
        
        # НОВОЕ: Расчет совокупного скора
        total_parts = total_polygons + total_lines
        if requires_labels:
            total_parts += len(correct_labels)
        
        correct_parts = found_polygons + found_lines
        if requires_labels:
            correct_parts += (labels_result['score'] * len(correct_labels) / 100.0)
            
        score = (correct_parts / total_parts * 100.0) if total_parts > 0 else 0.0
        drawing_coverage_values = []
        for item in polygon_results + line_results:
            value = item.get('coverage') if isinstance(item, dict) else None
            if isinstance(value, (int, float)):
                drawing_coverage_values.append(float(value))
        aggregate_drawing_coverage = max(drawing_coverage_values) if drawing_coverage_values else 0.0

        return EvaluationResult(
            success=combined_success,
            message=message,
            score=score,
            metric="IoU",
            details={
                'polygon_results': polygon_results,
                'line_results': line_results,
                'found_targets': sorted([x for x in found_targets if isinstance(x, int)]),
                'total_targets': len(targets),
                'found_polygons_count': found_polygons,
                'total_polygons_count': total_polygons,
                'found_lines_count': found_lines,
                'total_lines_count': total_lines,
                'level': 3,
                'labels': labels_result if requires_labels else None,
                'drawing': fallback_draw_details or {
                    'success': all_polygons_success and all_lines_success,
                    'message': "Контуры и линии проверены",
                    'coverage': aggregate_drawing_coverage,
                    'polygon_results': polygon_results,
                    'line_results': line_results
                }
            }
        )
    
    def _evaluate_drawing_coverage(self, user_input: Dict[str, Any],
                                   answer_key: Dict[str, Any],
                                   task_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Проверяет покрытие обводки для click заданий уровня 3.
        
        Использует логику Draw evaluator для проверки покрытия полигона.
        
        TODO: SUCCESS_THRESHOLD SUPPORT FOR DRAW TASKS
        ================================================
        Для полной поддержки success_threshold в draw заданиях, рекомендуется
        использовать DrawTaskEvaluator из task_system.types.draw_task:
        
        from task_system.types.draw_task import DrawTaskEvaluator
        
        evaluator = DrawTaskEvaluator()
        result = evaluator.evaluate(
            user_input=user_drawing,
            reference_data={
                'targets': targets,
                'success_threshold': task_data.get('settings', {}).get('success_threshold')
            }
        )
        
        Evaluator уже реализует логику:
        - Подсчет покрытия для каждого полигона
        - Подсчет полигонов с coverage >= 75%
        - Сравнение с success_threshold
        - Формирование сообщений в режиме порога
        
        Args:
            user_input: {
                'drawing': [...],  # штрихи обводки
                'image_width': int,
                'image_height': int,
                'brush_radius': int
            }
            answer_key: {
                'targets': [...]
            }
            task_data: Данные задания
        
        Returns:
            dict: {
                'success': bool,
                'score': float,  # 0.0 - 100.0 (процент покрытия)
                'message': str,
                'coverage': float,
                'target_index': int
            }
        """
        # Используем существующую логику evaluate_draw_task для проверки покрытия
        # Но возвращаем результат в формате словаря для комбинирования с labels
        draw_result = self.evaluate_draw_task(user_input, answer_key, task_data)
        
        details = draw_result.details or {}
        return {
            'success': draw_result.success,
            'message': draw_result.message,
            'coverage': details.get('coverage', 0.0),
            'target_index': details.get('target_index', -1)
        }
    
    def _evaluate_text_answer(self, user_text: str,
                              keywords: List[str],
                              reference_answer: Optional[str] = None,
                              task_data: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        if not keywords:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Нет ключевых слов для проверки',
                'found_keywords': [],
                'missing_keywords': []
            }

        if not user_text or not user_text.strip():
            return {
                'success': False,
                'score': 0.0,
                'message': 'Ответ не введен',
                'found_keywords': [],
                'missing_keywords': keywords
            }

        tolerance_config = self._get_tolerance_config(task_data)
        use_tolerance = tolerance_config is not None
        tolerance_matches = []

        def _find_keyword_match(keyword: str) -> Optional[Dict[str, Any]]:
            config = tolerance_config or self._get_tolerance_config_for_labels()
            for user_word in extract_words_from_text(user_text):
                match_info = compare_words_with_tolerance_info(user_word, keyword, config)
                if match_info is None:
                    continue
                return {
                    'keyword': keyword,
                    'type': match_info.get('type', 'exact'),
                    'user_answer': user_word,
                    'correct_answer': keyword,
                    'normalized_kinds': list(match_info.get('normalized_kinds', []))
                    if isinstance(match_info.get('normalized_kinds'), list)
                    else [],
                }
            return None

        if use_tolerance:
            found_keywords = []
            keywords_set = set(kw.lower() for kw in keywords)

            for keyword in keywords_set:
                if find_keyword_with_tolerance(user_text, keyword, tolerance_config):
                    found_keywords.append(keyword)
                    match_info = _find_keyword_match(keyword)
                    if match_info and (match_info.get('type') != 'exact' or match_info.get('normalized_kinds')):
                        tolerance_matches.append(match_info)

            found_keywords_set = set(found_keywords)
        else:
            user_text_lower = user_text.strip().lower()
            keywords_set = set(kw.lower() for kw in keywords)
            found_keywords_set = set()
            for keyword in keywords_set:
                pattern = r"\b" + re.escape(keyword) + r"\b"
                if re.search(pattern, user_text_lower, re.UNICODE):
                    found_keywords_set.add(keyword)

        missing_keywords = keywords_set - found_keywords_set
        total_keywords = len(keywords)
        found_count = len(found_keywords_set)
        success = found_count == total_keywords

        tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)
        tolerance_type = tolerance_summary.get('tolerance_type')
        tolerance_explanation = self._build_tolerance_explanation('Ответ', tolerance_summary)

        if success:
            message = f"✅ Правильно! Найдены все ключевые слова ({found_count}/{total_keywords})"
        else:
            message = f"❌ Не все ключевые слова найдены ({found_count}/{total_keywords})"

        return {
            'success': success,
            'message': message,
            'found_keywords': list(found_keywords_set),
            'missing_keywords': list(missing_keywords),
            'tolerance_matches': tolerance_summary.get('matches', []),
            'tolerance_type': tolerance_type,
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': tolerance_explanation
        }

    def _get_tolerance_config(self, task_data: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
        """
        Получает конфигурацию толерантности из task_data или difficulty_config.json.
        
        Args:
            task_data: Данные задания (может содержать настройки толерантности)
        
        Returns:
            Конфигурация толерантности или None, если не используется
        """
        # Сначала проверяем task_data (приоритет выше)
        if task_data:
            content = task_data.get('content', {})
            if isinstance(content, dict):
                tolerance_settings = content.get('text_tolerance', {})
                if tolerance_settings:
                    return tolerance_settings
        
        # Затем проверяем difficulty_config.json
        try:
            difficulty_config = load_difficulty_config()
            test_level_2_settings = difficulty_config.get('test_level_2_settings')
            if test_level_2_settings:
                return test_level_2_settings
        except Exception as e:
            logger.debug(f"Не удалось загрузить настройки толерантности из difficulty_config: {e}")
        
        # Если настройки не найдены, возвращаем None (используется старая логика)
        return None
    
    def _get_tolerance_config_for_labels(self) -> Dict[str, Any]:
        """
        Загружает конфигурацию толерантности для проверки названий.
        
        Используется для заданий Клик (уровни 2-3) и Рисование (уровень 2).
        Загружает настройки из test_level_2_settings и добавляет настройки нормализации.
        
        Returns:
            dict: Конфигурация толерантности с настройками по умолчанию
        """
        try:
            difficulty_config = load_difficulty_config()
            tolerance_config = difficulty_config.get('test_level_2_settings', {})
            # Добавить normalize_layout и normalize_y_i если их нет
            if tolerance_config:
                tolerance_config = tolerance_config.copy()  # Не изменяем оригинальный dict
                tolerance_config.setdefault('normalize_layout', True)
                tolerance_config.setdefault('normalize_y_i', True)
            else:
                tolerance_config = {}
        except Exception as e:
            logger.debug(f"Не удалось загрузить настройки толерантности: {e}")
            tolerance_config = {}
        
        # Настройки по умолчанию
        default_config = {
            'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
            'ending_tolerance': {'use_morphology': True, 'stemming_chars': 3},
            'normalize_yo': True,
            'normalize_layout': True,
            'normalize_y_i': True
        }
        
        # Объединяем с настройками по умолчанию
        result = default_config.copy()
        result.update(tolerance_config)
        if 'typo_tolerance' in tolerance_config:
            result['typo_tolerance'] = default_config['typo_tolerance'].copy()
            result['typo_tolerance'].update(tolerance_config['typo_tolerance'])
        if 'ending_tolerance' in tolerance_config:
            result['ending_tolerance'] = default_config['ending_tolerance'].copy()
            result['ending_tolerance'].update(tolerance_config['ending_tolerance'])
        
        return result
    
    def _normalize_text_for_comparison(self, text: str) -> str:
        """
        Нормализовать текст для сравнения: нижний регистр, убрать пробелы, заменить ё на е.
        
        Args:
            text: Текст для нормализации
        
        Returns:
            Нормализованный текст
        """
        if not text:
            return ''
        # Приводим к нижнему регистру
        normalized = text.lower()
        # Заменяем похожие символы и раскладки
        translit_map = {
            'ё': 'е',
            'й': 'и',
            'і': 'и',
            'ї': 'и',
            'i': 'и',   # латиница
        }
        normalized = ''.join(translit_map.get(ch, ch) for ch in normalized)
        # Убираем пробелы в начале и конце
        normalized = normalized.strip()
        # Убираем множественные пробелы внутри
        normalized = ' '.join(normalized.split())
        return normalized

    def _extract_test_question_correct_answer_texts(self, question: Dict[str, Any]) -> List[str]:
        answers_list = question.get("answers") or []
        if not answers_list and isinstance(question.get("content"), dict):
            answers_list = question.get("content", {}).get("answers") or []

        correct_texts: List[str] = []
        for answer in answers_list:
            if not isinstance(answer, dict) or not answer.get("correct"):
                continue
            text = str(answer.get("text") or answer.get("label") or "").strip()
            if text and text not in correct_texts:
                correct_texts.append(text)
        return correct_texts

    def _normalize_text_for_answer_listing(self, text: str) -> str:
        normalized = normalize_text(
            str(text or "").strip().lower(),
            normalize_yo=True,
            normalize_layout=True,
            normalize_y_i=True,
        )
        normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
        return " ".join(normalized.split())

    def _normalize_text_for_case_punctuation_match(self, text: str) -> str:
        normalized = str(text or "").strip().lower()
        normalized = re.sub(r"[^\w]+", " ", normalized, flags=re.UNICODE)
        return " ".join(normalized.split())

    def _should_hide_test_l2_tolerance_feedback(
        self,
        user_text: str,
        reference_answer: str,
        correct_answer_texts: List[str],
    ) -> bool:
        normalized_user = self._normalize_text_for_case_punctuation_match(user_text)
        if not normalized_user:
            return False

        candidates: List[str] = []
        seen: set[str] = set()
        for raw_candidate in [reference_answer, *list(correct_answer_texts or [])]:
            candidate = str(raw_candidate or "").strip()
            if not candidate or candidate in seen:
                continue
            seen.add(candidate)
            candidates.append(candidate)

        for candidate in candidates:
            normalized_candidate = self._normalize_text_for_case_punctuation_match(candidate)
            if not normalized_candidate or normalized_candidate != normalized_user:
                continue
            if str(user_text or "").strip() == candidate:
                return False
            return True

        return False

    def _matches_test_question_answer_listing(
        self,
        user_text: str,
        correct_answer_texts: List[str],
    ) -> bool:
        if not user_text or len(correct_answer_texts or []) < 2:
            return False

        normalized_user = self._normalize_text_for_answer_listing(user_text)
        if not normalized_user:
            return False

        for answer_text in correct_answer_texts:
            normalized_answer = self._normalize_text_for_answer_listing(answer_text)
            if not normalized_answer:
                continue
            answer_parts = [re.escape(part) for part in normalized_answer.split() if part]
            if not answer_parts:
                continue
            pattern = r"(?<!\w)" + r"\s+".join(answer_parts) + r"(?!\w)"
            if re.search(pattern, normalized_user, re.UNICODE) is None:
                return False

        return True
    
    def _evaluate_level_names(self, user_levels: List[Dict[str, Any]],
                             correct_levels: List[Dict[str, Any]],
                             sequence_within_level_matters: bool = False,
                             level_mapping: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
        """
        Проверяет названия уровней для sequence заданий уровня 2-3.
        
        Для уровня 2: сопоставляет уровни по содержимому блоков, а не по level_id.
        Для уровня 3: использует переданный level_mapping (соответствия, найденные в первой проверке).
        
        Args:
            user_levels: [
                {
                    'level_id': str,
                    'level_name': str,  # название от пользователя
                    'blocks': [str, ...],  # блоки уровня
                    ...
                },
                ...
            ]
            correct_levels: [
                {
                    'level_id': str,
                    'level_name': str,  # правильное название
                    'blocks': [str, ...],  # блоки уровня
                    ...
                },
                ...
            ]
            sequence_within_level_matters: bool, важна ли последовательность блоков внутри уровня
            level_mapping: Optional[Dict[str, int]], для уровня 3 - mapping соответствий {correct_level_id: user_level_index}
        
        Returns:
            dict: {
                'success': bool,
                'score': float,  # 0.0 - 100.0
                'message': str,
                'matched_levels': List[Tuple[str, str, str]],  # (level_id, user_name, correct_name)
                'unmatched_levels': List[Tuple[str, str, str]]
            }
        """
        if not correct_levels:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Нет правильных уровней для проверки',
                'matched_levels': [],
                'unmatched_levels': []
            }
        
        matched = []
        unmatched = []
        tolerance_matches = []
        used_user_indices = set()  # Индексы уровней пользователя, которые уже сопоставлены
        
        # Для каждого правильного уровня находим соответствующий уровень пользователя по содержимому
        logger.debug(f"[LevelNamesEval] === НАЧАЛО ПРОВЕРКИ НАЗВАНИЙ ===")
        logger.debug(f"[LevelNamesEval] user_levels count: {len(user_levels)}, correct_levels count: {len(correct_levels)}")
        
        # Если передан level_mapping, названия проверяем только для уровней,
        # которые уже были сопоставлены по структуре.
        if level_mapping is not None:
            logger.debug(f"[LevelNamesEval] Используем level_mapping для уровня 3: {level_mapping}")
            for correct_level in correct_levels:
                correct_level_id = correct_level.get('level_id', '')
                correct_name = correct_level.get('level_name', '')
                
                if correct_level_id in level_mapping:
                    user_idx = level_mapping[correct_level_id]
                    user_level = user_levels[user_idx]
                    user_name = user_level.get('level_name', '').strip()
                    user_level_id = user_level.get('level_id', '')
                    
                    # Проверяем название
                    user_normalized = self._normalize_text_for_comparison(user_name)
                    correct_normalized = self._normalize_text_for_comparison(correct_name)
                    
                    logger.debug(f"[LevelNamesEval] Проверяем по mapping: correct_level_id={correct_level_id}, "
                               f"user_level[{user_idx}], user_name='{user_name}', correct_name='{correct_name}'")
                    logger.debug(f"[LevelNamesEval] Сравнение названий: "
                               f"user='{user_name}' -> '{user_normalized}', "
                               f"correct='{correct_name}' -> '{correct_normalized}', "
                               f"совпадают={user_normalized == correct_normalized}")
                    
                    tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                    if tolerance_info is not None and correct_name:
                        matched.append((user_level_id, user_name, correct_name))
                        if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                            tolerance_matches.append({
                                'level_id': user_level_id,
                                'type': tolerance_info.get('type', 'exact'),
                                'user_answer': user_name,
                                'correct_answer': correct_name,
                                'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                if isinstance(tolerance_info.get('normalized_kinds'), list)
                                else [],
                            })
                        used_user_indices.add(user_idx)
                        logger.debug(f"[LevelNamesEval] ✓ Название совпадает для level_id={correct_level_id}")
                    else:
                        unmatched.append((correct_level_id, '', correct_name))
                        unmatched.append((user_level_id, user_name, ''))
                        logger.debug(f"[LevelNamesEval] ✗ Название не совпадает для level_id={correct_level_id}")
                else:
                    # Правильный уровень не найден в mapping
                    unmatched.append((correct_level_id, '', correct_name))
                    logger.debug(f"[LevelNamesEval] ✗ Правильный уровень {correct_level_id} не найден в mapping")
            
            # ИСПРАВЛЕНИЕ: Не добавляем лишние уровни пользователя здесь - они будут добавлены в конце функции
            # чтобы избежать дублирования
        else:
            # Существующая логика для уровня 2
            for correct_level in correct_levels:
                correct_blocks = correct_level.get('blocks', [])
                correct_name = correct_level.get('level_name', '')
                correct_level_id = correct_level.get('level_id', '')
                
                logger.debug(f"[LevelNamesEval] Проверяем correct_level: level_id={correct_level_id}, "
                            f"level_name='{correct_name}', blocks={correct_blocks}")
                
                # Нормализуем блоки для сравнения
                if sequence_within_level_matters:
                    correct_blocks_normalized = tuple(correct_blocks)
                else:
                    correct_blocks_normalized = tuple(sorted(correct_blocks))
                
                # Ищем соответствующий уровень пользователя по содержимому
                best_match = None
                best_match_idx = None
                best_match_score = 0
                
                for idx, user_level in enumerate(user_levels):
                    if idx in used_user_indices:
                        continue  # Уже использован
                    
                    user_blocks = user_level.get('blocks', [])
                    
                    # Нормализуем блоки пользователя
                    if sequence_within_level_matters:
                        user_blocks_normalized = tuple(user_blocks)
                    else:
                        user_blocks_normalized = tuple(sorted(user_blocks))
                    
                    logger.debug(f"[LevelNamesEval] Проверяем user_level[{idx}]: level_id={user_level.get('level_id')}, "
                               f"blocks={user_blocks}, normalized={user_blocks_normalized}, "
                               f"level_name='{user_level.get('level_name', '')}'")
                    
                    # Проверяем совпадение блоков
                    blocks_match = user_blocks_normalized == correct_blocks_normalized
                    
                    # ИСПРАВЛЕНИЕ: Для уровня 2 проверяем названия всегда
                    # Это позволяет проверить названия даже если пользователь не добавил блоки или добавил не все
                    # Проверяем названия независимо от совпадения блоков
                    should_check_name = True
                    
                    if should_check_name:
                        if blocks_match:
                            logger.debug(f"[LevelNamesEval] ✓ Блоки совпадают для user_level[{idx}]")
                        else:
                            logger.debug(f"[LevelNamesEval] Блоки не совпадают или пустые, проверяем только название для user_level[{idx}]")
                        
                        user_name = user_level.get('level_name', '').strip()
                        user_level_id = user_level.get('level_id', '')
                        
                        # Проверяем название
                        user_normalized = self._normalize_text_for_comparison(user_name)
                        correct_normalized = self._normalize_text_for_comparison(correct_name)
                        
                        logger.debug(f"[LevelNamesEval] Сравнение названий: "
                                   f"user='{user_name}' -> '{user_normalized}', "
                                   f"correct='{correct_name}' -> '{correct_normalized}', "
                                   f"совпадают={user_normalized == correct_normalized}")
                        
                        # Оценка: 
                        # - Если блоки совпадают: блоки = 1, название = +1 (макс 2)
                        # - Если блоки не совпадают/пустые: только название = 1 (макс 1)
                        if blocks_match:
                            score = 1
                            tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                            if tolerance_info is not None and correct_name:
                                score = 2
                                if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                                    tolerance_matches.append({
                                        'level_id': user_level_id,
                                        'type': tolerance_info.get('type', 'exact'),
                                        'user_answer': user_name,
                                        'correct_answer': correct_name,
                                        'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                        if isinstance(tolerance_info.get('normalized_kinds'), list)
                                        else [],
                                    })
                                logger.debug(f"[LevelNamesEval] ✓✓ Блоки И название совпадают (score=2)")
                            else:
                                logger.debug(f"[LevelNamesEval] ✗ Блоки совпадают, но название неверное (score=1)")
                        else:
                            # Только название, без блоков
                            tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                            score = 1 if (tolerance_info is not None and correct_name) else 0
                            if score == 1:
                                if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                                    tolerance_matches.append({
                                        'level_id': user_level_id,
                                        'type': tolerance_info.get('type', 'exact'),
                                        'user_answer': user_name,
                                        'correct_answer': correct_name,
                                        'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                        if isinstance(tolerance_info.get('normalized_kinds'), list)
                                        else [],
                                    })
                                logger.debug(f"[LevelNamesEval] ✓ Название совпадает (блоки пустые/не совпадают, score=1)")
                            else:
                                logger.debug(f"[LevelNamesEval] ✗ Название не совпадает (блоки пустые/не совпадают, score=0)")
                        
                        # Сохраняем лучший вариант
                        if score > best_match_score:
                            best_match = (user_level_id, user_name, correct_name, score)
                            best_match_idx = idx
                
                if best_match:
                    used_user_indices.add(best_match_idx)
                    user_level_id, user_name, correct_name_check, score = best_match
                    
                    # Для уровня 2: если блоки пустые, проверяем только названия
                    # score=1 означает, что название совпадает (даже если блоки пустые)
                    # score=2 означает, что блоки И название совпадают
                    if score >= 1:  # Блоки И название совпадают (score=2) ИЛИ только название совпадает (score=1)
                        matched.append((user_level_id, user_name, correct_name))
                    else:  # score=0: название не совпадает
                        unmatched.append((user_level_id, user_name, correct_name))
                else:
                    # Правильный уровень не найден среди уровней пользователя
                    unmatched.append((correct_level_id, '', correct_name))
        
        # Проверяем, есть ли лишние уровни пользователя
        for idx, user_level in enumerate(user_levels):
            if idx not in used_user_indices:
                user_level_id = user_level.get('level_id', '')
                user_name = user_level.get('level_name', '').strip()
                unmatched.append((user_level_id, user_name, ''))
        
        # Определяем успешность
        total_levels = len(correct_levels)
        matched_count = len(matched)
        success = matched_count == total_levels and len(unmatched) == 0
        
        logger.debug(f"[LevelNamesEval] === РЕЗУЛЬТАТ ПРОВЕРКИ НАЗВАНИЙ ===")
        logger.debug(f"[LevelNamesEval] total_levels={total_levels}, matched_count={matched_count}, "
                    f"unmatched_count={len(unmatched)}, success={success}")
        logger.debug(f"[LevelNamesEval] matched: {matched}")
        logger.debug(f"[LevelNamesEval] unmatched: {unmatched}")
        
        # Формируем сообщение
        if success:
            message = f"✅ Все названия уровней правильные ({matched_count}/{total_levels})"
        else:
            message = f"❌ Не все названия уровней правильные ({matched_count}/{total_levels})"
        
        score = (matched_count / total_levels * 100.0) if total_levels > 0 else 0.0
        
        tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)

        return {
            'success': success,
            'score': score,
            'message': message,
            'matched_levels': matched,
            'unmatched_levels': unmatched,
            'total_levels': total_levels,  # Добавляем total_levels для правильного отображения
            'tolerance_matches': tolerance_summary.get('matches', []),
            'tolerance_type': tolerance_summary.get('tolerance_type'),
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': self._build_tolerance_explanation('Название', tolerance_summary),
        }
    
    def _evaluate_block_names(self, user_levels: List[Dict[str, Any]],
                             correct_levels: List[Dict[str, Any]],
                             level_mapping: Optional[Dict[str, int]] = None,
                             sequence_within_level_matters: bool = False) -> Dict[str, Any]:
        """
        Проверяет названия блоков для sequence заданий уровня 3.
        
        Args:
            user_levels: [
                {
                    'level_id': str,
                    'blocks': [str, ...],  # ID блоков
                    'block_names': {block_id: str, ...}  # названия от пользователя
                    ...
                },
                ...
            ]
            correct_levels: [
                {
                    'level_id': str,
                    'blocks': [str, ...],  # ID блоков
                    'block_names': {block_id: str, ...}  # правильные названия
                    ...
                },
                ...
            ]
        
        Returns:
            dict: {
                'success': bool,
                'score': float,  # 0.0 - 100.0
                'message': str,
                'matched_blocks': List[Tuple[str, str, str, str]],  # (level_id, block_id, user_name, correct_name)
                'unmatched_blocks': List[Tuple[str, str, str, str]]
            }
        """
        if not correct_levels:
            return {
                'success': False,
                'score': 0.0,
                'message': 'Нет правильных уровней для проверки',
                'matched_blocks': [],
                'unmatched_blocks': []
            }
        
        # Создаем карту правильных названий блоков
        # Для fallback-режима сопоставляем по названиям уровней, так как level_id могут быть разными.
        correct_map_by_level_name = {}
        correct_map_by_level_id = {}
        for level in correct_levels:
            level_id = level.get('level_id', '')
            level_name = level.get('level_name', '')
            correct_block_names = level.get('block_names', {})
            if level_id and isinstance(correct_block_names, dict):
                correct_map_by_level_id[level_id] = correct_block_names
                if level_name:
                    correct_map_by_level_name[self._normalize_text_for_comparison(level_name)] = correct_block_names
        
        matched = []
        unmatched = []
        tolerance_matches = []
        total_blocks = 0

        # Безопасный режим для level 3: названия блоков проверяются только внутри уровней,
        # которые уже были structurally matched в первой фазе.
        if level_mapping is not None:
            for correct_level in correct_levels:
                correct_level_id = correct_level.get('level_id', '')
                correct_blocks = correct_level.get('blocks', [])
                correct_block_names = correct_level.get('block_names', {})
                total_blocks += len([name for name in correct_block_names.values() if str(name or '').strip()])

                if correct_level_id not in level_mapping:
                    if isinstance(correct_block_names, dict):
                        for block_id in correct_blocks:
                            correct_name = correct_block_names.get(block_id, '')
                            if str(correct_name or '').strip():
                                unmatched.append((correct_level_id, block_id, '', correct_name))
                    continue

                user_idx = level_mapping[correct_level_id]
                if user_idx < 0 or user_idx >= len(user_levels):
                    if isinstance(correct_block_names, dict):
                        for block_id in correct_blocks:
                            correct_name = correct_block_names.get(block_id, '')
                            if str(correct_name or '').strip():
                                unmatched.append((correct_level_id, block_id, '', correct_name))
                    continue

                user_level = user_levels[user_idx]
                user_level_id = user_level.get('level_id', '')
                user_blocks = user_level.get('blocks', [])
                user_block_names = user_level.get('block_names', {})
                if not isinstance(user_block_names, dict):
                    user_block_names = {}

                if sequence_within_level_matters:
                    limit = min(len(user_blocks), len(correct_blocks))
                    used_correct_indices = set()

                    for block_index in range(limit):
                        user_block_id = user_blocks[block_index]
                        correct_block_id = correct_blocks[block_index]
                        user_name = str(user_block_names.get(user_block_id, '') or '').strip()
                        correct_name = str(correct_block_names.get(correct_block_id, '') or '').strip()
                        if not correct_name:
                            continue
                        tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                        if tolerance_info is not None:
                            matched.append((user_level_id, str(user_block_id), user_name, correct_name))
                            if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                                tolerance_matches.append({
                                    'level_id': user_level_id,
                                    'block_id': str(user_block_id),
                                    'type': tolerance_info.get('type', 'exact'),
                                    'user_answer': user_name,
                                    'correct_answer': correct_name,
                                    'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                    if isinstance(tolerance_info.get('normalized_kinds'), list)
                                    else [],
                                })
                        else:
                            unmatched.append((user_level_id, str(user_block_id), user_name, correct_name))
                        used_correct_indices.add(block_index)

                    for block_index, correct_block_id in enumerate(correct_blocks):
                        if block_index in used_correct_indices:
                            continue
                        correct_name = str(correct_block_names.get(correct_block_id, '') or '').strip()
                        if correct_name:
                            unmatched.append((correct_level_id, str(correct_block_id), '', correct_name))
                else:
                    user_names_list = [
                        str(user_block_names.get(block_id, '') or '').strip()
                        for block_id in user_blocks
                        if str(user_block_names.get(block_id, '') or '').strip()
                    ]
                    correct_names_list = [
                        str(correct_block_names.get(block_id, '') or '').strip()
                        for block_id in correct_blocks
                        if str(correct_block_names.get(block_id, '') or '').strip()
                    ]

                    used_correct_indices = set()
                    for user_name in user_names_list:
                        user_normalized = self._normalize_text_for_comparison(user_name)
                        matched_found = False
                        for idx, correct_name in enumerate(correct_names_list):
                            if idx in used_correct_indices:
                                continue
                            tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                            if tolerance_info is not None:
                                matched.append((user_level_id, '', user_name, correct_name))
                                if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                                    tolerance_matches.append({
                                        'level_id': user_level_id,
                                        'type': tolerance_info.get('type', 'exact'),
                                        'user_answer': user_name,
                                        'correct_answer': correct_name,
                                        'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                        if isinstance(tolerance_info.get('normalized_kinds'), list)
                                        else [],
                                    })
                                used_correct_indices.add(idx)
                                matched_found = True
                                break
                        if not matched_found:
                            unmatched.append((user_level_id, '', user_name, ''))

                    for idx, correct_name in enumerate(correct_names_list):
                        if idx not in used_correct_indices:
                            unmatched.append((correct_level_id, '', '', correct_name))

            matched_count = len(matched)
            success = matched_count == total_blocks and len(unmatched) == 0
            if success:
                message = f"✅ Все названия блоков правильные ({matched_count}/{total_blocks})"
            else:
                message = f"❌ Не все названия блоков правильные ({matched_count}/{total_blocks})"
            score = (matched_count / total_blocks * 100.0) if total_blocks > 0 else 0.0
            tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)
            return {
                'success': success,
                'score': score,
                'message': message,
                'matched_blocks': matched,
                'unmatched_blocks': unmatched,
                'tolerance_matches': tolerance_summary.get('matches', []),
                'tolerance_type': tolerance_summary.get('tolerance_type'),
                'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
                'tolerance_explanation': self._build_tolerance_explanation('Название', tolerance_summary),
            }
        
        # Проверяем названия блоков пользователя
        for user_level in user_levels:
            user_level_id = user_level.get('level_id', '')
            user_level_name = user_level.get('level_name', '').strip()
            user_block_names = user_level.get('block_names', {})
            
            # Пытаемся найти правильные названия по level_id или по названию уровня
            correct_block_names = correct_map_by_level_id.get(user_level_id, {})
            if not correct_block_names and user_level_name:
                correct_block_names = correct_map_by_level_name.get(self._normalize_text_for_comparison(user_level_name), {})
            
            if not isinstance(user_block_names, dict):
                # Пользователь не ввел названия блоков
                if isinstance(correct_block_names, dict):
                    for block_id, correct_name in correct_block_names.items():
                        if correct_name:  # Только если есть название
                            unmatched.append((user_level_id, block_id, '', correct_name))
                            total_blocks += 1
                continue
            
            # Для уровня 3: сопоставляем блоки по названиям, а не по ID
            # У пользователя ID типа user_elem_..., у правильных - elem_1, elem_2 и т.д.
            # Поэтому сравниваем значения (названия), а не ключи (ID)
            
            # Получаем списки названий
            user_names_list = [v.strip() for v in user_block_names.values() if v.strip()]
            correct_names_list = [v.strip() for v in correct_block_names.values() if v.strip()]
            
            # Обновляем total_blocks - это количество правильных блоков
            total_blocks += len(correct_names_list)
            
            # Нормализуем названия для сравнения
            # Сопоставляем названия пользователя с правильными
            used_correct_indices = set()
            for user_name in user_names_list:
                matched_found = False
                
                # Ищем соответствующее правильное название
                for idx, correct_name in enumerate(correct_names_list):
                    if idx in used_correct_indices:
                        continue
                    tolerance_info = self._compare_named_text(user_name, correct_name) if correct_name else None
                    if tolerance_info is not None:
                        # Найдено соответствие по названию
                        matched.append((user_level_id, '', user_name, correct_name))
                        if tolerance_info.get('type') != 'exact' or tolerance_info.get('normalized_kinds'):
                            tolerance_matches.append({
                                'level_id': user_level_id,
                                'type': tolerance_info.get('type', 'exact'),
                                'user_answer': user_name,
                                'correct_answer': correct_name,
                                'normalized_kinds': list(tolerance_info.get('normalized_kinds', []))
                                if isinstance(tolerance_info.get('normalized_kinds'), list)
                                else [],
                            })
                        used_correct_indices.add(idx)
                        matched_found = True
                        break
                
                if not matched_found:
                    # Название пользователя не найдено в правильных - это "лишний"
                    unmatched.append((user_level_id, '', user_name, ''))
            
            # Проверяем правильные названия, которые не были сопоставлены
            for idx, correct_name in enumerate(correct_names_list):
                if idx not in used_correct_indices:
                    # Правильное название не найдено у пользователя - это "отсутствует"
                    unmatched.append((user_level_id, '', '', correct_name))
        
        # Определяем успешность
        matched_count = len(matched)
        success = matched_count == total_blocks and len(unmatched) == 0
        
        # Формируем сообщение
        if success:
            message = f"✅ Все названия блоков правильные ({matched_count}/{total_blocks})"
        else:
            message = f"❌ Не все названия блоков правильные ({matched_count}/{total_blocks})"
        
        score = (matched_count / total_blocks * 100.0) if total_blocks > 0 else 0.0
        
        tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)

        return {
            'success': success,
            'score': score,
            'message': message,
            'matched_blocks': matched,
            'unmatched_blocks': unmatched,
            'tolerance_matches': tolerance_summary.get('matches', []),
            'tolerance_type': tolerance_summary.get('tolerance_type'),
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': self._build_tolerance_explanation('Название', tolerance_summary),
        }
    
    # =========================================================================
    # DRAW TASK EVALUATION
    # Извлечено из trainer.py::compare_drawing (строки 1240-1308)
    # =========================================================================
    
    def evaluate_draw_task(self, user_input: Dict[str, Any],
                          answer_key: Dict[str, Any],
                          task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Draw-задания (рисование контуров органов).
        
        Поддерживает уровни сложности через поля из DifficultyManager:
        - Уровень 1: только обводка (базовая логика)
        - Уровень 2: обводка + проверка названия (content.requires_labels = True)
        - Уровень 3: исключен для Draw заданий (используется только для Click уровня 3)
        
        Поддерживает успех-порог (success_threshold):
        - Если указан порог: оценивает все полигоны, считает успешные (покрытие >= 75%)
        - Если порог не указан: использует старую логику (ближайший полигон)
        
        Args:
            user_input: {
                'drawing': [  # список штрихов пользователя
                    {
                        'type': 'brush_stroke',
                        'points': [[x, y], ...]
                    },
                    ...
                ],
                'image_width': int,  # опционально
                'image_height': int,  # опционально
                'brush_radius': int,  # опционально
                'label': str  # название для ближайшей структуры (уровень 2)
            }
            answer_key: {
                'targets': [
                    {
                        'shape': 'polygon' | 'freehand',
                        'points': [[x, y], ...],
                        'label': str  # правильное название (для уровня 2)
                    },
                    ...
                ]
            }
            task_data: Данные задания
                     Может содержать поля из DifficultyManager:
                     - content.requires_labels: требуется проверка названия (level >= 2)
                     - settings.success_threshold: минимум успешных полигонов
        
        Returns:
            EvaluationResult с детальными метриками покрытия:
            - Уровень 1: только результат обводки (процент покрытия)
            - Уровень 2: комбинация обводки (70%) + label (30%)
        
        Логика извлечена из trainer.py строки 1240-1308
        """

        # NEW FORMAT (web DrawUI): polygons/lines (+ labels_polygons/labels_lines)
        # Handle it first so we don't fall back to legacy 'drawing' checks.
        # Важно: если ключи polygons/lines присутствуют, считаем это новым форматом,
        # даже если массивы пустые (нужно вернуть polygons_missing/lines_missing).
        try:
            if isinstance(user_input, dict) and ('polygons' in user_input or 'lines' in user_input):
                return self._evaluate_draw_task_new_format(user_input, answer_key, task_data)
        except Exception:
            # Fallback to legacy path
            pass

        user_drawing = user_input.get('drawing', [])
        
        # Если user_input содержит image_width/image_height или brush_radius, передаем их через user_drawing
        # для использования в _get_image_dimensions и calculate_polygon_coverage
        if (
            'image_width' in user_input or
            'image_height' in user_input or
            'display_width' in user_input or
            'display_height' in user_input or
            'brush_radius' in user_input
        ):
            # Создаем словарь с данными о размерах изображения и brush_radius
            user_drawing_with_size = {
                'drawing': user_drawing,
                'image_width': user_input.get('image_width'),
                'image_height': user_input.get('image_height'),
                'display_width': user_input.get('display_width'),
                'display_height': user_input.get('display_height'),
                'brush_radius': user_input.get('brush_radius')
            }
        else:
            user_drawing_with_size = user_drawing
        
        # Определяем метрику: проверяем answer_key.targets[].score.metric, иначе используем "IoU"
        determined_metric = "IoU"
        targets = answer_key.get('targets', [])
        for target in targets:
            score_config = target.get('score', {})
            if isinstance(score_config, dict) and 'metric' in score_config:
                determined_metric = score_config['metric']
                break
        
        if not user_drawing:
            return EvaluationResult(
                success=False,
                message="Сначала нарисуйте область",
                score=0.0,
                metric=determined_metric,
                details={'error': 'no_drawing'}
            )
        
        if not targets:
            return EvaluationResult(
                success=False,
                message="Нет эталонных областей",
                score=0.0,
                metric=determined_metric,
                details={'error': 'no_targets'}
            )
        
        # ВАЖНО: Безопасная проверка полей из DifficultyManager
        # Эти поля используются для поддержки уровней сложности (ФАЗА 2)
        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)
        requires_explanation = content.get('requires_explanation', False)
        mode = content.get('mode', 'draw')
        
        # НОВОЕ: Проверяем наличие success_threshold
        success_threshold = None
        if task_data:
            settings = task_data.get('settings', {})
            success_threshold = settings.get('success_threshold')
        
        # Если есть success_threshold - используем режим множественных полигонов
        if success_threshold is not None:
            return self._evaluate_draw_task_multiple_polygons(
                user_input, answer_key, task_data, 
                user_drawing_with_size, targets, 
                determined_metric, success_threshold
            )
        
        # СТАРАЯ ЛОГИКА: находим ближайшую аннотацию к рисунку пользователя (для обратной совместимости)
        closest_result = self._find_closest_annotation(user_drawing_with_size, targets)
        
        if closest_result is None:
            return EvaluationResult(
                success=False,
                message="Не удалось определить ближайшую аннотацию",
                score=0.0,
                metric=determined_metric,
                details={'error': 'no_closest_annotation'}
            )
        
        closest_idx, distance = closest_result
        target = targets[closest_idx]
        
        # Проверяем только ближайшую аннотацию
        polygon_points = target.get('points', [])
        shape = target.get('shape', '')
        target_type = target.get('type', '')
        
        # Определяем тип: polygon или freehand
        # ИСПРАВЛЕНИЕ: Сначала проверяем явный тип, потом количество точек
        # Если явно указан freehand - это freehand, независимо от количества точек
        is_freehand = (shape == 'freehand') or (target_type == 'freehand')
        is_polygon = (shape == 'polygon') or (not is_freehand and isinstance(polygon_points, list) and len(polygon_points) >= 3)
        
        coverage = 0.0
        
        if is_polygon and len(polygon_points) >= 3:
            # Используем утилиту из geometry.py с передачей task_data и answer_key
            coverage = calculate_polygon_coverage(
                polygon_points, user_drawing_with_size,
                task_data=task_data,
                answer_key=answer_key
            )
        elif is_freehand and len(polygon_points) >= 2:
            # Получаем tolerance из настроек или используем значение по умолчанию
            tolerance_px = 15.0  # По умолчанию
            if task_data and isinstance(task_data, dict):
                settings = task_data.get('settings', {})
                if isinstance(settings, dict):
                    tolerance_px = settings.get('line_tolerance_px', settings.get('lineTolerancePx', 15.0))
            
            # Проверяем покрытие линии
            coverage = self.calculate_line_coverage(
                polygon_points, user_drawing_with_size, tolerance_px
            )
        else:
            return EvaluationResult(
                success=False,
                message="Некорректный тип аннотации",
                score=0.0,
                metric=determined_metric,
                details={'error': 'invalid_annotation_type', 'target_index': closest_idx}
            )
        
        # Порог прохождения для обводки
        threshold = self.default_draw_threshold
        draw_success = coverage >= threshold
        
        target_label = target.get('label', f'Аннотация {closest_idx + 1}')
        annotation_type = 'polygon' if is_polygon else 'freehand'
        
        # УРОВЕНЬ 2: проверка label для ближайшей структуры
        if requires_labels:
            # Формат: user_input['label'] = str - одно название для ближайшей структуры
            # Формат: answer_key['targets'][closest_idx]['label'] = str - правильное название
            user_label = user_input.get('label', '').strip()
            correct_label = target.get('label', '')
            
            if not user_label:
                return EvaluationResult(
                    success=False,
                    message=f"❌ Введите название структуры. Покрытие: {coverage:.1f}%",
                    score=0.0,
                    metric=determined_metric,
                    details={
                        'target_index': closest_idx,
                        'target_label': target_label,
                        'coverage': coverage,
                        'type': annotation_type,
                        'distance': distance,
                        'threshold': threshold,
                        'total_strokes': len(user_drawing),
                        'level': 2,
                        'error': 'label_missing'
                    }
                )
            
            # Проверяем label
            label_result = self._evaluate_label(user_label, correct_label)
            
            # Определяем успешность: обводка И правильный label
            combined_success = draw_success and label_result['success']
            
            # Формируем сообщение
            if combined_success:
                message = f"✅ Отлично! Покрытие: {coverage:.1f}%, {label_result['message']}"
            else:
                if not draw_success:
                    message = f"❌ Нужно улучшить обводку. Покрытие: {coverage:.1f}% (минимум {threshold}%), {label_result['message']}"
                else:
                    message = f"❌ Обводка правильная ({coverage:.1f}%), но {label_result['message']}"
            
            # НОВОЕ: Скор для Л2 (70% обводка, 30% название)
            score = (coverage * 0.7) + (label_result.get('score', 0.0) * 0.3)

            return EvaluationResult(
                success=combined_success,
                message=message,
                score=score,
                metric=determined_metric,
                details={
                    'target_index': closest_idx,
                    'target_label': target_label,
                    'coverage': coverage,
                    'type': annotation_type,
                    'distance': distance,
                    'threshold': threshold,
                    'total_strokes': len(user_drawing),
                    'label': label_result,
                    'level': 2
                }
            )
        
        # УРОВЕНЬ 1: только обводка (базовая логика без изменений)
        if draw_success:
            message = get_message("draw_success", coverage=coverage, threshold=threshold)
        else:
            message = get_message("draw_fail", coverage=coverage, threshold=threshold)
        
        return EvaluationResult(
            success=draw_success,
            message=message,
            score=coverage,
            metric=determined_metric,
            details={
                'target_index': closest_idx,
                'target_label': target_label,
                'coverage': coverage,
                'type': annotation_type,
                'distance': distance,
                'threshold': threshold,
                'total_strokes': len(user_drawing),
                'level': 1
            }
        )

    def _evaluate_draw_task_new_format(self, user_input: Dict[str, Any],
                                       answer_key: Dict[str, Any],
                                       task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """Новый формат Draw (web): polygons/lines + labels_polygons/labels_lines.

        Требования:
        - Сначала контуры (polygons), затем штрихи (lines) если они есть в targets
        - На L2 (content.requires_labels=True) обязательны названия для всех целей
        """

        content = task_data.get('content', {}) if task_data else {}
        requires_labels = content.get('requires_labels', False)

        targets = answer_key.get('targets', [])
        if not isinstance(targets, list) or not targets:
            return EvaluationResult(
                success=False,
                message="Нет эталонных областей",
                score=0.0,
                metric="IoU",
                details={'error': 'no_targets'}
            )

        polygon_targets = [
            idx for idx, t in enumerate(targets)
            if (t.get('shape') != 'freehand' and t.get('type') != 'freehand')
        ]
        freehand_targets = [
            idx for idx, t in enumerate(targets)
            if (t.get('shape') == 'freehand' or t.get('type') == 'freehand')
        ]

        user_polygons = user_input.get('polygons', [])
        user_lines = user_input.get('lines', [])
        if not isinstance(user_polygons, list):
            user_polygons = []
        if not isinstance(user_lines, list):
            user_lines = []

        # Stage gating: polygons first
        required_polygons = len(polygon_targets)
        required_lines = len(freehand_targets)

        if required_polygons > 0 and len(user_polygons) < required_polygons:
            return EvaluationResult(
                success=False,
                message="Сначала нарисуйте контуры",
                score=0.0,
                metric="IoU",
                details={
                    'stage': 'polygons',
                    'error': 'polygons_missing',
                    'required_polygons': required_polygons,
                    'done_polygons': len(user_polygons),
                    'required_lines': required_lines,
                    'done_lines': len(user_lines),
                    'level': 1 if not requires_labels else 2
                }
            )

        if required_lines > 0 and len(user_lines) < required_lines:
            return EvaluationResult(
                success=False,
                message="Теперь нарисуйте штрихи",
                score=0.0,
                metric="IoU",
                details={
                    'stage': 'lines',
                    'error': 'lines_missing',
                    'required_polygons': required_polygons,
                    'done_polygons': len(user_polygons),
                    'required_lines': required_lines,
                    'done_lines': len(user_lines),
                    'level': 1 if not requires_labels else 2
                }
            )

        # Prepare evaluation parameters
        threshold = self.default_draw_threshold
        settings = task_data.get('settings', {}) if isinstance(task_data, dict) else {}
        success_threshold = settings.get('success_threshold') if isinstance(settings, dict) else None

        image_w = user_input.get('image_width')
        image_h = user_input.get('image_height')
        brush_radius = user_input.get('brush_radius', self.default_brush_radius)

        # -----------------------------
        # Polygons matching
        # -----------------------------
        polygon_results = []
        used_polygon_indices = set()

        for target_idx in polygon_targets:
            target = targets[target_idx]
            polygon_points = target.get('points', [])
            if not isinstance(polygon_points, list) or len(polygon_points) < 3:
                continue

            best_cov = None
            best_poly_idx = None

            for poly_idx, poly in enumerate(user_polygons):
                if poly_idx in used_polygon_indices:
                    continue
                if not isinstance(poly, dict):
                    continue
                pts = poly.get('points', [])
                if not isinstance(pts, list) or len(pts) < 3:
                    continue

                single = {
                    'drawing': [{'type': 'brush_stroke', 'points': pts}],
                    'image_width': image_w,
                    'image_height': image_h,
                    'display_width': user_input.get('display_width'),
                    'display_height': user_input.get('display_height'),
                    'brush_radius': brush_radius,
                }

                cov = calculate_polygon_coverage(
                    polygon_points, single,
                    task_data=task_data,
                    answer_key={'targets': [target]}
                )

                if best_cov is None or cov > best_cov:
                    best_cov = cov
                    best_poly_idx = poly_idx

            if best_cov is None:
                polygon_results.append({
                    'target_index': target_idx,
                    'polygon_success': False,
                    'coverage': 0.0,
                    'threshold': threshold,
                    'matched_polygon_idx': None,
                })
                continue

            used_polygon_indices.add(best_poly_idx)
            polygon_results.append({
                'target_index': target_idx,
                'polygon_success': best_cov >= threshold,
                'coverage': float(best_cov),
                'threshold': threshold,
                'matched_polygon_idx': int(best_poly_idx),
            })

        # -----------------------------
        # Lines matching
        # -----------------------------
        line_results = []
        used_line_indices = set()

        line_tolerance = 15.0
        if isinstance(settings, dict):
            line_tolerance = settings.get('line_tolerance_px', settings.get('lineTolerancePx', 15.0))

        for target_idx in freehand_targets:
            target = targets[target_idx]
            target_points = target.get('points', [])
            if not isinstance(target_points, list) or len(target_points) < 2:
                continue

            # Allow per-target threshold override (0..1) like in click L3
            score_config = target.get('score', {})
            line_threshold = threshold
            if isinstance(score_config, dict) and 'threshold' in score_config:
                try:
                    line_threshold = float(score_config.get('threshold', 0.75)) * 100.0
                except Exception:
                    line_threshold = threshold

            best_cov = None
            best_line_idx = None

            for line_idx, line in enumerate(user_lines):
                if line_idx in used_line_indices:
                    continue
                if not isinstance(line, dict):
                    continue
                pts = line.get('points', [])
                if not isinstance(pts, list) or len(pts) < 2:
                    continue

                single = {
                    'drawing': [{'type': 'brush_stroke', 'points': pts}],
                    'image_width': image_w,
                    'image_height': image_h,
                    'brush_radius': brush_radius,
                }

                cov = self.calculate_line_coverage(target_points, single, line_tolerance, use_improved_evaluation=True)
                if best_cov is None or cov > best_cov:
                    best_cov = cov
                    best_line_idx = line_idx

            if best_cov is None:
                line_results.append({
                    'target_index': target_idx,
                    'line_success': False,
                    'coverage': 0.0,
                    'threshold': float(line_threshold),
                    'matched_line_idx': None,
                })
                continue

            used_line_indices.add(best_line_idx)
            line_results.append({
                'target_index': target_idx,
                'line_success': best_cov >= line_threshold,
                'coverage': float(best_cov),
                'threshold': float(line_threshold),
                'matched_line_idx': int(best_line_idx),
            })

        # Overall success (coverage)
        successes = 0
        for r in polygon_results:
            if r.get('polygon_success'):
                successes += 1
        for r in line_results:
            if r.get('line_success'):
                successes += 1

        total_targets = len(polygon_targets) + len(freehand_targets)
        required_correct = int(success_threshold) if success_threshold is not None else total_targets
        if required_correct < 1:
            required_correct = total_targets

        coverage_success = successes >= required_correct

        # Labels stage (L2)
        if requires_labels:
            labels_polygons = user_input.get('labels_polygons', [])
            labels_lines = user_input.get('labels_lines', [])
            if not isinstance(labels_polygons, list):
                labels_polygons = []
            if not isinstance(labels_lines, list):
                labels_lines = []

            # Map user labels to target order by matched indices
            ordered_user_labels = []
            ordered_correct_labels = []

            # Polygons first
            for r in polygon_results:
                t_idx = r.get('target_index')
                if t_idx is None:
                    continue
                ordered_correct_labels.append(str(targets[int(t_idx)].get('label', '') or ''))
                m_idx = r.get('matched_polygon_idx')
                if m_idx is None or int(m_idx) >= len(labels_polygons):
                    ordered_user_labels.append('')
                else:
                    ordered_user_labels.append(str(labels_polygons[int(m_idx)] or '').strip())

            # Lines next
            for r in line_results:
                t_idx = r.get('target_index')
                if t_idx is None:
                    continue
                ordered_correct_labels.append(str(targets[int(t_idx)].get('label', '') or ''))
                m_idx = r.get('matched_line_idx')
                if m_idx is None or int(m_idx) >= len(labels_lines):
                    ordered_user_labels.append('')
                else:
                    ordered_user_labels.append(str(labels_lines[int(m_idx)] or '').strip())

            if any(not (s or '').strip() for s in ordered_user_labels):
                return EvaluationResult(
                    success=False,
                    message=get_message("draw_labels_missing"),
                    score=0.0,
                    metric="IoU",
                    details={
                        'stage': 'labels',
                        'error': 'labels_missing',
                        'level': 2,
                        'polygon_results': polygon_results,
                        'line_results': line_results,
                    }
                )

            labels_eval = self._evaluate_labels(ordered_user_labels, ordered_correct_labels)
            
            # НОВОЕ: Комбинированный score для Draw-задания уровня 2
            # Success определяется по порогу для контуров И верности всех лейблов (или тоже процентно)
            draw_score = (successes / total_targets * 100) if total_targets > 0 else 0.0
            label_score = labels_eval.get('score', 0.0)
            combined_score = (draw_score * 0.7) + (label_score * 0.3)

            manual_label_judgement = None
            if coverage_success and labels_eval.get('success') is not True:
                manual_label_judgement = self._build_draw_label_user_judgement(labels_eval)

            if manual_label_judgement is not None:
                return EvaluationResult(
                    success=False,
                    score=combined_score,
                    message=str(
                        manual_label_judgement.get('message')
                        or 'В названии цели пропущено 1–2 слова. Решите, считать ли ответ верным.'
                    ).strip(),
                    metric="IoU",
                    details={
                        'stage': 'labels_review',
                        'level': 2,
                        'successful_targets': successes,
                        'required_correct': required_correct,
                        'total_targets': total_targets,
                        'draw_score': draw_score,
                        'label_score': label_score,
                        'threshold': threshold,
                        'polygon_results': polygon_results,
                        'line_results': line_results,
                        'labels': labels_eval,
                        'requires_user_judgement': True,
                        'pending_user_judgement': True,
                        'manual_label_judgement': manual_label_judgement,
                    }
                )
            
            combined_success = coverage_success and labels_eval.get('success') is True
            msg = (
                ("✅ " if combined_success else "❌ ") +
                f"Контроль: {successes}/{total_targets}. " +
                str(labels_eval.get('message', '')).strip()
            )

            return EvaluationResult(
                success=combined_success,
                score=combined_score,  # НОВОЕ
                message=msg,
                metric="IoU",
                details={
                    'stage': 'done',
                    'level': 2,
                    'successful_targets': successes,
                    'required_correct': required_correct,
                    'total_targets': total_targets,
                    'draw_score': draw_score,
                    'label_score': label_score,
                    'threshold': threshold,
                    'polygon_results': polygon_results,
                    'line_results': line_results,
                    'labels': labels_eval,
                }
            )

        # L1 result
        msg = (
            "✅ Отлично! " if coverage_success else "❌ Нужно улучшить. "
        ) + f"Контроль: {successes}/{total_targets}."

        # НОВОЕ: Скор для Л1 (процент успешных целей)
        score = (successes / total_targets * 100) if total_targets > 0 else 0.0

        return EvaluationResult(
            success=coverage_success,
            message=msg,
            score=score,
            metric="IoU",
            details={
                'stage': 'done',
                'level': 1,
                'successful_targets': successes,
                'required_correct': required_correct,
                'total_targets': total_targets,
                'threshold': threshold,
                'polygon_results': polygon_results,
                'line_results': line_results,
            }
        )
    
    def _evaluate_draw_task_multiple_polygons(self, user_input: Dict[str, Any],
                                             answer_key: Dict[str, Any],
                                             task_data: Dict[str, Any],
                                             user_drawing_with_size: Any,
                                             targets: List[Dict],
                                             determined_metric: str,
                                             success_threshold: int) -> EvaluationResult:
        """
        Оценка Draw-задания с поддержкой success_threshold (множественные полигоны).
        
        Проверяет все полигоны, считает сколько имеют покрытие >= 75%,
        сравнивает с success_threshold.
        
        Args:
            user_input: Пользовательский ввод
            answer_key: Правильные ответы
            task_data: Данные задания
            user_drawing_with_size: Рисунок пользователя с метаданными
            targets: Список целевых полигонов
            determined_metric: Метрика оценки
            success_threshold: Минимум успешных полигонов
        
        Returns:
            EvaluationResult с подробными метриками
        """
        user_drawing = user_input.get('drawing', [])
        threshold = self.default_draw_threshold  # 75%
        
        # Оцениваем каждый полигон
        polygon_results = []
        successful_count = 0
        
        for idx, target in enumerate(targets):
            polygon_points = target.get('points', [])
            shape = target.get('shape', '')
            target_type = target.get('type', '')
            
            is_freehand = (shape == 'freehand') or (target_type == 'freehand')
            is_polygon = (shape == 'polygon') or (not is_freehand and isinstance(polygon_points, list) and len(polygon_points) >= 3)
            
            coverage = 0.0
            
            if is_polygon and len(polygon_points) >= 3:
                coverage = calculate_polygon_coverage(
                    polygon_points, user_drawing_with_size,
                    task_data=task_data,
                    answer_key=answer_key
                )
            elif is_freehand and len(polygon_points) >= 2:
                tolerance_px = 15.0
                if task_data:
                    settings = task_data.get('settings', {})
                    tolerance_px = settings.get('line_tolerance_px', settings.get('lineTolerancePx', 15.0))
                coverage = self.calculate_line_coverage(
                    polygon_points, user_drawing_with_size, tolerance_px
                )
            
            success = coverage >= threshold
            if success:
                successful_count += 1
            
            polygon_results.append({
                'index': idx,
                'label': target.get('label', f'Полигон {idx + 1}'),
                'coverage': coverage,
                'success': success
            })
        
        # Определяем требуемое количество
        total_count = len(targets)
        required_correct = min(success_threshold, total_count)
        threshold_mode = True
        
        # Определяем общий успех
        overall_success = successful_count >= required_correct
        
        # Формируем сообщение
        if overall_success:
            message = f"✅ Отлично! Успешно обведено: {successful_count} из {required_correct} требуемых (всего {total_count})"
        else:
            message = f"❌ Нужно улучшить. Успешно обведено: {successful_count} из {required_correct} требуемых (всего {total_count})"
        
        # Добавляем детали об успешных полигонах
        successful_labels = [r['label'] for r in polygon_results if r['success']]
        if successful_labels and not overall_success:
            message += f"\nУспешные: {', '.join(successful_labels)}"
        
        # НОВОЕ: Скор (процент успешных полигонов)
        score = (successful_count / total_count * 100) if total_count > 0 else 0.0

        return EvaluationResult(
            success=overall_success,
            message=message,
            score=score,
            metric=determined_metric,
            details={
                'successful_count': successful_count,
                'required_correct': required_correct,
                'total_targets': total_count,
                'threshold_mode': threshold_mode,
                'polygon_results': polygon_results,
                'coverage_threshold': threshold,
                'level': 1
            }
        )
    
    # =========================================================================
    # HELPER METHODS для Draw задаий
    # Извлечено из trainer.py (строки 1338-1395)
    # =========================================================================
    
    def _is_point_covered_by_strokes(self, x: float, y: float, 
                                    strokes: List[Dict]) -> bool:
        """
        Проверяет, покрыта ли точка нарисованными штрихами.
        
        Извлечено из trainer.py::is_point_covered_by_strokes (строки 1338-1351)
        """
        brush_radius = self.default_brush_radius
        
        for stroke in strokes:
            if stroke.get('type') == 'brush_stroke':
                for point in stroke.get('points', []):
                    px, py = point
                    distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
                    if distance <= brush_radius:
                        return True
        return False
    
    def _calculate_accuracy_bonus(self, polygon_points: List[Tuple], 
                                 strokes: List[Dict]) -> float:
        """
        Рассчитывает бонус точности на основе попадания нарисованных точек 
        в эталонную область.
        
        Извлечено из trainer.py::calculate_accuracy_bonus (строки 1353-1372)
        
        Returns:
            float: коэффициент от 0.5 до 1.0
        """
        if not strokes:
            return 0.5
        
        total_stroke_points = 0
        points_in_target = 0
        
        for stroke in strokes:
            if stroke.get('type') == 'brush_stroke':
                for point in stroke.get('points', []):
                    total_stroke_points += 1
                    if point_in_polygon(point[0], point[1], polygon_points):
                        points_in_target += 1
        
        if total_stroke_points > 0:
            accuracy_ratio = points_in_target / total_stroke_points
            return max(0.5, accuracy_ratio)  # Минимум 0.5, максимум 1.0
        return 0.5
    
    def _calculate_outside_penalty(self, polygon_points: List[Tuple],
                                  strokes: List[Dict]) -> float:
        """
        Рассчитывает штраф за рисование вне эталонной области.
        
        Извлечено из trainer.py::calculate_outside_penalty (строки 1374-1395)
        
        Returns:
            float: штраф в процентах (до 20%)
        """
        if not strokes:
            return 0.0
        
        total_stroke_points = 0
        points_outside = 0
        
        for stroke in strokes:
            if stroke.get('type') == 'brush_stroke':
                for point in stroke.get('points', []):
                    total_stroke_points += 1
                    if not point_in_polygon(point[0], point[1], polygon_points):
                        points_outside += 1
        
        if total_stroke_points > 0:
            outside_ratio = points_outside / total_stroke_points
            return outside_ratio * 20  # Штраф до 20%
        return 0.0
    
    def _calculate_bidirectional_coverage(self, reference_points: List[Tuple[float, float]], 
                                          user_drawing: List[Dict],
                                          tolerance_px: float) -> Dict[str, float]:
        """
        Вычисляет двустороннее покрытие: эталонной линии рисунком и рисунка эталонной линией.
        
        Args:
            reference_points: Точки эталонной линии
            user_drawing: Штрихи пользователя
            tolerance_px: Допустимое расстояние
        
        Returns:
            Dict с 'reference_coverage' и 'user_coverage' (0-100)
        """
        # Покрытие эталонной линии рисунком (используем базовый алгоритм, чтобы избежать рекурсии)
        reference_coverage = self.calculate_line_coverage(reference_points, user_drawing, tolerance_px, use_improved_evaluation=False)
        
        # Покрытие рисунка эталонной линией
        # Извлекаем все точки из рисунка пользователя
        user_points = []
        for stroke in user_drawing:
            if stroke.get('type') == 'brush_stroke':
                points = stroke.get('points', [])
                for point in points:
                    if isinstance(point, (list, tuple)) and len(point) >= 2:
                        user_points.append((point[0], point[1]))
                    elif isinstance(point, dict):
                        user_points.append((point.get('x', 0), point.get('y', 0)))
        
        if not user_points:
            return {'reference_coverage': reference_coverage, 'user_coverage': 0.0}
        
        # Проверяем, сколько точек рисунка находятся близко к эталонной линии
        covered_user_points = 0
        for user_pt in user_points:
            # Находим минимальное расстояние от точки до любого сегмента эталонной линии
            min_dist = float('inf')
            for i in range(len(reference_points) - 1):
                dist = self._point_to_line_segment_distance(
                    user_pt[0], user_pt[1],
                    reference_points[i],
                    reference_points[i + 1]
                )
                min_dist = min(min_dist, dist)
            
            if min_dist <= tolerance_px:
                covered_user_points += 1
        
        user_coverage = (covered_user_points / len(user_points)) * 100.0 if user_points else 0.0
        
        return {
            'reference_coverage': reference_coverage,
            'user_coverage': min(user_coverage, 100.0)
        }
    
    def _calculate_average_distance(self, reference_points: List[Tuple[float, float]], 
                                   user_drawing: List[Dict]) -> float:
        """
        Вычисляет среднее расстояние между эталонной линией и рисунком пользователя.
        
        Args:
            reference_points: Точки эталонной линии
            user_drawing: Штрихи пользователя
        
        Returns:
            Среднее расстояние в пикселях
        """
        # Извлекаем все точки из рисунка пользователя
        user_points = []
        for stroke in user_drawing:
            if stroke.get('type') == 'brush_stroke':
                points = stroke.get('points', [])
                for point in points:
                    if isinstance(point, (list, tuple)) and len(point) >= 2:
                        user_points.append((point[0], point[1]))
                    elif isinstance(point, dict):
                        user_points.append((point.get('x', 0), point.get('y', 0)))
        
        if not user_points or len(reference_points) < 2:
            return float('inf')
        
        # Для каждой точки рисунка находим минимальное расстояние до эталонной линии
        total_distance = 0.0
        for user_pt in user_points:
            min_dist = float('inf')
            for i in range(len(reference_points) - 1):
                dist = self._point_to_line_segment_distance(
                    user_pt[0], user_pt[1],
                    reference_points[i],
                    reference_points[i + 1]
                )
                min_dist = min(min_dist, dist)
            total_distance += min_dist
        
        return total_distance / len(user_points) if user_points else float('inf')
    
    def _calculate_shape_similarity(self, reference_points: List[Tuple[float, float]], 
                                   user_drawing: List[Dict],
                                   tolerance_px: float) -> float:
        """
        Оценивает схожесть формы линий на основе среднего расстояния.
        
        Args:
            reference_points: Точки эталонной линии
            user_drawing: Штрихи пользователя
            tolerance_px: Допустимое расстояние
        
        Returns:
            Оценка схожести формы (0-100), где 100 = идеальное совпадение
        """
        avg_distance = self._calculate_average_distance(reference_points, user_drawing)
        
        if avg_distance == float('inf'):
            return 0.0
        
        # Преобразуем расстояние в оценку: чем меньше расстояние, тем выше оценка
        # Используем экспоненциальное затухание
        # При avg_distance = 0 -> score = 100
        # При avg_distance = tolerance_px -> score ≈ 50
        # При avg_distance = 2 * tolerance_px -> score ≈ 25
        if avg_distance <= tolerance_px:
            # Линейная интерполяция от 100 до 50
            score = 100.0 - (avg_distance / tolerance_px) * 50.0
        else:
            # Экспоненциальное затухание от 50 до 0
            excess = avg_distance - tolerance_px
            score = 50.0 * (2.0 ** (-excess / tolerance_px))
        
        return max(0.0, min(100.0, score))

    def _extract_line_coordinate_scale(self, user_drawing: Any) -> float:
        """Возвращает коэффициент перевода экранных пикселей в координаты изображения."""
        if not isinstance(user_drawing, dict):
            return 1.0

        image_w = user_drawing.get('image_width') or user_drawing.get('imageWidth')
        image_h = user_drawing.get('image_height') or user_drawing.get('imageHeight')
        display_w = user_drawing.get('display_width') or user_drawing.get('displayWidth')
        display_h = user_drawing.get('display_height') or user_drawing.get('displayHeight')

        ratios: List[float] = []
        try:
            if image_w is not None and display_w is not None:
                image_w_num = float(image_w)
                display_w_num = float(display_w)
                if image_w_num > 0 and display_w_num > 0:
                    ratios.append(image_w_num / display_w_num)
            if image_h is not None and display_h is not None:
                image_h_num = float(image_h)
                display_h_num = float(display_h)
                if image_h_num > 0 and display_h_num > 0:
                    ratios.append(image_h_num / display_h_num)
        except Exception:
            return 1.0

        if not ratios:
            return 1.0

        scale = max(ratios)
        if not isinstance(scale, (int, float)) or scale <= 0:
            return 1.0
        return float(scale)

    def _resolve_line_tolerance_px(self, tolerance_px: float, user_drawing: Any) -> float:
        """Масштабирует tolerance под реальные координаты изображения, если известен scale."""
        try:
            base_tolerance = float(tolerance_px)
        except Exception:
            base_tolerance = 12.0
        if base_tolerance <= 0:
            base_tolerance = 12.0

        coordinate_scale = self._extract_line_coordinate_scale(user_drawing)
        if coordinate_scale <= 0:
            return base_tolerance
        return base_tolerance * coordinate_scale
    
    def calculate_line_coverage(self, line_points: List[Tuple[float, float]], 
                                  user_drawing: List[Dict],
                                  tolerance_px: float = 12.0,
                                  use_improved_evaluation: bool = True) -> float:
        """
        Рассчитывает покрытие линии (freehand) рисунком пользователя.
        
        Использует улучшенный алгоритм с комбинированной оценкой:
        - Покрытие эталонной линии рисунком (50%)
        - Покрытие рисунка эталонной линией (30%)
        - Оценка формы (20%)
        
        Args:
            line_points: Список точек линии [(x1, y1), (x2, y2), ...]
            user_drawing: Список штрихов пользователя или словарь с 'drawing'
            tolerance_px: Допустимое расстояние от линии до рисунка (в пикселях)
            use_improved_evaluation: Использовать улучшенную оценку (по умолчанию True)
        
        Returns:
            float: Процент покрытия (0-100)
        """
        if len(line_points) < 2:
            return 0.0

        effective_tolerance_px = self._resolve_line_tolerance_px(tolerance_px, user_drawing)
        
        # Извлекаем список штрихов если user_drawing это словарь
        drawing_list = user_drawing
        if isinstance(user_drawing, dict):
            drawing_list = user_drawing.get('drawing', [])
            if not isinstance(drawing_list, list):
                drawing_list = user_drawing
        
        if use_improved_evaluation:
            # Используем улучшенную комбинированную оценку
            # 1. Двустороннее покрытие
            bidirectional = self._calculate_bidirectional_coverage(
                line_points, drawing_list, effective_tolerance_px
            )
            ref_coverage = bidirectional['reference_coverage']
            user_coverage = bidirectional['user_coverage']
            
            # 2. Оценка формы
            shape_score = self._calculate_shape_similarity(
                line_points, drawing_list, effective_tolerance_px
            )
            
            # 3. Комбинированная оценка с весами
            # Покрытие эталонной линии: 50%
            # Покрытие рисунка: 30%
            # Форма: 20%
            combined_score = (ref_coverage * 0.5 + user_coverage * 0.3 + shape_score * 0.2)
            
            return min(combined_score, 100.0)
        else:
            # Старый алгоритм (для обратной совместимости)
            # Генерируем точки вдоль линии с шагом ~2 пикселя
            all_line_points = []
            for i in range(len(line_points) - 1):
                p1 = line_points[i]
                p2 = line_points[i + 1]
                
                # Расстояние между точками
                dist = ((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2) ** 0.5
                steps = max(1, int(dist / 2.0))  # Шаг ~2 пикселя
                
                for j in range(steps + 1):
                    t = j / steps if steps > 0 else 0
                    x = p1[0] + t * (p2[0] - p1[0])
                    y = p1[1] + t * (p2[1] - p1[1])
                    all_line_points.append((x, y))
            
            if not all_line_points:
                return 0.0
            
            # Проверяем покрытие каждой точки
            covered_points = 0
            for line_pt in all_line_points:
                if self._is_point_near_strokes(line_pt[0], line_pt[1], drawing_list, effective_tolerance_px):
                    covered_points += 1
            
            coverage_percent = (covered_points / len(all_line_points)) * 100.0
            return min(coverage_percent, 100.0)
    
    def _is_point_near_strokes(self, x: float, y: float, 
                               strokes: List[Dict], tolerance_px: float) -> bool:
        """
        Проверяет, есть ли точки рисунка в пределах tolerance от заданной точки.
        
        Args:
            x, y: Координаты точки
            strokes: Список штрихов пользователя
            tolerance_px: Допустимое расстояние
        
        Returns:
            bool: True если есть точки в пределах tolerance
        """
        for stroke in strokes:
            if stroke.get('type') == 'brush_stroke':
                points = stroke.get('points', [])
                for point in points:
                    # Поддержка разных форматов точек
                    if isinstance(point, (list, tuple)) and len(point) >= 2:
                        px, py = point[0], point[1]
                    elif isinstance(point, dict):
                        px = point.get('x', 0)
                        py = point.get('y', 0)
                    else:
                        continue
                    
                    distance = ((x - px) ** 2 + (y - py) ** 2) ** 0.5
                    if distance <= tolerance_px:
                        return True
        return False
    
    def _point_to_line_segment_distance(self, px: float, py: float, 
                                        line_start: Tuple[float, float], 
                                        line_end: Tuple[float, float]) -> float:
        """
        Вычисляет расстояние от точки до отрезка линии.
        
        Args:
            px, py: Координаты точки
            line_start: Начало отрезка (x, y)
            line_end: Конец отрезка (x, y)
        
        Returns:
            float: Расстояние от точки до отрезка
        """
        x0, y0 = px, py
        x1, y1 = line_start
        x2, y2 = line_end
        
        dx = x2 - x1
        dy = y2 - y1
        
        # Если отрезок - точка
        if dx == 0 and dy == 0:
            return ((x0 - x1) ** 2 + (y0 - y1) ** 2) ** 0.5
        
        # Параметр проекции точки на прямую
        t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
        # Ограничиваем параметр в диапазоне [0, 1] для отрезка
        t = max(0, min(1, t))
        
        # Точка проекции на отрезок
        proj_x = x1 + t * dx
        proj_y = y1 + t * dy
        
        # Расстояние от точки до проекции
        return ((x0 - proj_x) ** 2 + (y0 - proj_y) ** 2) ** 0.5
    
    def _check_freehand_target(self, click_x: float, click_y: float, 
                               target: Dict[str, Any],
                               scale_factor: float = 1.0,
                               offset_x: float = 0.0,
                               offset_y: float = 0.0,
                               tolerance_px: float = 15.0) -> bool:
        """
        Проверяет, попадает ли клик в freehand-линию.
        
        Алгоритм:
        1. Преобразует координаты клика в координаты изображения
        2. Вычисляет расстояние от точки клика до ближайшего сегмента линии
        3. Если расстояние <= tolerance_px, считает попаданием
        
        Args:
            click_x, click_y: Координаты клика на canvas
            target: Словарь с freehand-аннотацией
            scale_factor, offset_x, offset_y: Параметры трансформации canvas
            tolerance_px: Допустимое расстояние от линии (в пикселях)
        
        Returns:
            bool: True если клик попадает в линию
        """
        # Преобразуем координаты клика в координаты изображения
        img_x = (click_x - offset_x) / scale_factor
        img_y = (click_y - offset_y) / scale_factor
        
        points = target.get('points', [])
        if len(points) < 2:
            return False
        
        # Получаем tolerance из target или используем переданный
        target_tolerance = target.get('tolerance_px')
        if target_tolerance is None:
            target_tolerance = target.get('tolerancePx')
        if target_tolerance is None:
            target_tolerance = tolerance_px
        # Убеждаемся, что target_tolerance не None
        if target_tolerance is None:
            target_tolerance = 15.0  # Значение по умолчанию
        
        # Вычисляем минимальное расстояние от точки до любого сегмента линии
        min_distance = float('inf')
        for i in range(len(points) - 1):
            p1 = points[i]
            p2 = points[i + 1]
            dist = self._point_to_line_segment_distance(img_x, img_y, p1, p2)
            min_distance = min(min_distance, dist)
        
        return min_distance <= target_tolerance
    
    def _find_closest_annotation(self, user_drawing: List[Dict], 
                                 targets: List[Dict]) -> Optional[Tuple[int, float]]:
        """
        Находит ближайшую аннотацию к рисунку пользователя.
        
        Алгоритм:
        1. Вычисляет центр масс рисунка пользователя (среднее всех точек всех штрихов)
        2. Для каждой аннотации вычисляет расстояние:
           - Полигон: если центр внутри - расстояние 0, иначе расстояние до ближайшей точки полигона
           - Freehand: расстояние до ближайшей точки линии
        3. Возвращает индекс и расстояние ближайшей аннотации
        
        Args:
            user_drawing: Список штрихов пользователя или словарь с 'drawing'
            targets: Список аннотаций из answer_key
        
        Returns:
            Tuple[int, float] или None: (индекс_аннотации, расстояние) или None если не найдено
        """
        if not user_drawing or not targets:
            return None
        
        # Извлекаем список штрихов если user_drawing это словарь
        drawing_list = user_drawing
        if isinstance(user_drawing, dict):
            drawing_list = user_drawing.get('drawing', [])
            if not isinstance(drawing_list, list):
                drawing_list = user_drawing
        
        # Вычисляем центр масс рисунка пользователя
        total_x, total_y, total_points = 0, 0, 0
        for stroke in drawing_list:
            if stroke.get('type') == 'brush_stroke':
                points = stroke.get('points', [])
                for point in points:
                    # Поддержка разных форматов точек
                    if isinstance(point, (list, tuple)) and len(point) >= 2:
                        total_x += point[0]
                        total_y += point[1]
                        total_points += 1
                    elif isinstance(point, dict):
                        total_x += point.get('x', 0)
                        total_y += point.get('y', 0)
                        total_points += 1
        
        if total_points == 0:
            return None
        
        center_x = total_x / total_points
        center_y = total_y / total_points
        
        # Находим ближайшую аннотацию
        closest_idx = None
        min_distance = float('inf')
        
        for idx, target in enumerate(targets):
            shape = target.get('shape', '')
            target_type = target.get('type', '')
            points = target.get('points', [])
            
            if not isinstance(points, list) or len(points) < 2:
                continue
            
            # Определяем тип: polygon или freehand
            # ИСПРАВЛЕНИЕ: Сначала проверяем явный тип, потом количество точек
            # Если явно указан freehand - это freehand, независимо от количества точек
            is_freehand = (shape == 'freehand') or (target_type == 'freehand')
            is_polygon = (shape == 'polygon') or (not is_freehand and isinstance(points, list) and len(points) >= 3)
            
            distance = float('inf')
            
            if is_polygon and len(points) >= 3:
                # Для полигона: проверяем, находится ли центр внутри
                if point_in_polygon(center_x, center_y, points):
                    distance = 0  # Внутри полигона - приоритет
                else:
                    # Расстояние до ближайшей точки полигона
                    min_point_dist = min(
                        ((center_x - p[0]) ** 2 + (center_y - p[1]) ** 2) ** 0.5
                        for p in points
                    )
                    distance = min_point_dist
            
            elif is_freehand and len(points) >= 2:
                # Для freehand: расстояние до ближайшей точки линии
                min_line_dist = float('inf')
                for i in range(len(points) - 1):
                    p1 = points[i]
                    p2 = points[i + 1]
                    # Расстояние от точки до отрезка
                    dist = self._point_to_line_segment_distance(center_x, center_y, p1, p2)
                    min_line_dist = min(min_line_dist, dist)
                distance = min_line_dist
            else:
                continue
            
            # Обновляем ближайшую аннотацию
            # Приоритет аннотациям с расстоянием 0 (центр внутри/на линии)
            if distance < min_distance or (distance == 0 and min_distance > 0):
                min_distance = distance
                closest_idx = idx
        
        if closest_idx is not None:
            return (closest_idx, min_distance)
        return None
    
    # =========================================================================
    # OPEN ANSWER TASK EVALUATION
    # Извлечено из trainer.py::check_open_answer (строки 1652-1699)
    # =========================================================================
    
    def evaluate_open_answer_task(self, user_input: Dict[str, Any],
                                  answer_key: Dict[str, Any],
                                  task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Open Answer задания (проверка по ключевым словам).
        
        Args:
            user_input: {
                'answer': str  # текстовый ответ пользователя
            }
            answer_key: {
                'keywords': [str, ...],  # ключевые слова
                'sequence_matters': bool  # важна ли последовательность
            }
        
        Returns:
            EvaluationResult с найденными и пропущенными ключевыми словами
        
        Логика извлечена из trainer.py строки 1652-1699
        """
        user_answer = user_input.get('answer', '').strip()
        
        if not user_answer:
            return EvaluationResult(
                success=False,
                message="Введите ответ перед проверкой",
                score=0.0,
                metric="percent",
                details={'error': 'empty_answer'}
            )
        
        max_length = None
        max_length_candidates = []
        if isinstance(task_data, dict):
            content = task_data.get('content', {}) if isinstance(task_data.get('content'), dict) else {}
            settings = task_data.get('settings', {}) if isinstance(task_data.get('settings'), dict) else {}
            max_length_candidates.extend([
                content.get('max_length'),
                content.get('maxLength'),
                settings.get('max_length'),
                settings.get('maxLength'),
            ])
        if isinstance(answer_key, dict):
            nested_content = answer_key.get('content', {}) if isinstance(answer_key.get('content'), dict) else {}
            max_length_candidates.extend([
                answer_key.get('max_length'),
                answer_key.get('maxLength'),
                nested_content.get('max_length'),
                nested_content.get('maxLength'),
            ])

        for candidate in max_length_candidates:
            try:
                parsed = int(candidate)
            except (TypeError, ValueError):
                continue
            if parsed > 0:
                max_length = parsed
                break

        if max_length is not None and len(user_answer) > max_length:
            return EvaluationResult(
                success=False,
                message=f"Ответ слишком длинный (максимум {max_length} символов)",
                score=0.0,
                metric="percent",
                details={
                    'error': 'answer_too_long',
                    'max_length': max_length,
                    'answer_length': len(user_answer),
                }
            )

        keywords = answer_key.get('keywords', [])
        # Fallback: поддержка формата task.json, где ключевые слова лежат в content
        if not keywords:
            keywords = answer_key.get('content', {}).get('keywords', [])
        
        if not keywords:
            return EvaluationResult(
                success=False,
                message="Ключевые слова не найдены в задании",
                score=0.0,
                metric="percent",
                details={'error': 'no_keywords'}
            )
        
        # Получаем sequence_matters - сначала из answer_key, потом из task_data.content, потом из answer_key.content
        sequence_matters = answer_key.get('sequence_matters', False)
        if task_data and isinstance(task_data, dict):
            # Если в task_data есть content.sequence_matters, используем его (приоритет выше)
            content_seq = task_data.get('content', {}).get('sequence_matters')
            if content_seq is not None:
                sequence_matters = bool(content_seq)
        elif 'sequence_matters' not in answer_key:
            # Fallback: проверяем answer_key.content
            sequence_matters = answer_key.get('content', {}).get('sequence_matters', False)
        
        # Загружаем конфигурацию толерантности
        tolerance_config = None
        try:
            difficulty_config = load_difficulty_config()
            tolerance_config = difficulty_config.get('test_level_2_settings')
            # Добавить normalize_layout и normalize_y_i в config (если их нет)
            if tolerance_config:
                tolerance_config['normalize_layout'] = True
                tolerance_config['normalize_y_i'] = True
        except Exception as e:
            logger.debug(f"Не удалось загрузить настройки толерантности: {e}")
            # Используем настройки по умолчанию
            tolerance_config = {
                'typo_tolerance': {'max_typos_per_word': 2, 'use_levenshtein': True},
                'ending_tolerance': {'use_morphology': True, 'stemming_chars': 3},
                'normalize_yo': True,
                'normalize_layout': True,
                'normalize_y_i': True
            }
        
        # Проверка в зависимости от настроек
        user_answer_lower = user_answer.lower()

        def _iter_words_with_spans(text: str):
            # Word extraction with spans in the ORIGINAL text (for UI highlighting)
            try:
                for m in re.finditer(r"\b\w+\b", text, flags=re.UNICODE):
                    yield {
                        'text': m.group(0),
                        'start': int(m.start()),
                        'end': int(m.end()),
                    }
            except Exception:
                return

        user_words_with_spans = list(_iter_words_with_spans(user_answer))
        
        # Детальная информация о толерантности + позиции для UI
        keyword_tolerance_info = {}
        tolerance_matches = []

        def _match_keyword_with_spans(keyword: str):
            # Return first matched word span info for keyword, using the same tolerance function.
            try:
                for w in user_words_with_spans:
                    td = compare_words_with_tolerance_info(w['text'], keyword, tolerance_config)
                    if td:
                        # td: {'type': 'exact'|'typo'|'ending'|'both', 'correct_answer', 'user_answer', 'normalized_kinds'?}
                        return {
                            'keyword': keyword,
                            'type': td.get('type', 'unknown'),
                            'user_word': w['text'],
                            'correct_word': keyword,
                            'start': w['start'],
                            'end': w['end'],
                            'normalized_kinds': td.get('normalized_kinds', []),
                        }
            except Exception:
                return None
            return None
        
        if sequence_matters and len(keywords) > 1:
            # Проверка последовательности: слова должны идти подряд в том же порядке
            # Сначала нормализуем текст для поиска
            normalized_user_answer = normalize_text(
                user_answer_lower,
                normalize_yo=tolerance_config.get('normalize_yo', True),
                normalize_layout=tolerance_config.get('normalize_layout', True),
                normalize_y_i=tolerance_config.get('normalize_y_i', True)
            )
            
            # Нормализуем ключевые слова для построения паттерна последовательности
            normalized_keywords = []
            for keyword in keywords:
                normalized_keyword = normalize_text(
                    keyword.lower(),
                    normalize_yo=tolerance_config.get('normalize_yo', True),
                    normalize_layout=tolerance_config.get('normalize_layout', True),
                    normalize_y_i=tolerance_config.get('normalize_y_i', True)
                )
                normalized_keywords.append(normalized_keyword)
            
            # Проверяем, что все ключевые слова найдены с толерантностью
            keywords_set = set(kw.lower() for kw in keywords)
            found_keywords = set()
            
            # Извлекаем слова из нормализованного текста пользователя
            user_words = extract_words_from_text(normalized_user_answer)
            
            for keyword in keywords:
                keyword_lower = keyword.lower()
                # Используем find_keyword_with_tolerance для поиска
                found = find_keyword_with_tolerance(user_answer, keyword, tolerance_config)
                if found:
                    found_keywords.add(keyword_lower)
                    
                    # Получаем детальную информацию о толерантности
                    keyword_normalized = normalize_text(
                        keyword_lower,
                        normalize_yo=tolerance_config.get('normalize_yo', True),
                        normalize_layout=tolerance_config.get('normalize_layout', True),
                        normalize_y_i=tolerance_config.get('normalize_y_i', True)
                    )
                    
                    # Позиции/детали для UI
                    m = _match_keyword_with_spans(keyword)
                    if m:
                        tolerance_matches.append(m)
                        td = {
                            'type': m.get('type'),
                            'correct_answer': m.get('correct_word'),
                            'user_answer': m.get('user_word'),
                        }
                        if m.get('normalized_kinds'):
                            td['normalized_kinds'] = m.get('normalized_kinds')
                        keyword_tolerance_info[keyword] = td
            
            missing_keywords = keywords_set - found_keywords
            
            # Проверяем последовательность: если все слова найдены, проверяем порядок
            if len(found_keywords) == len(keywords):
                # D-7 fix: allow other words between keywords (use \b...\b with .*? between)
                pattern = r'\b' + r'\b.*?\b'.join(re.escape(kw) for kw in normalized_keywords) + r'\b'
                is_correct = bool(re.search(pattern, normalized_user_answer, re.UNICODE))
            else:
                is_correct = False
        else:
            # Обычная проверка: наличие всех ключевых слов с толерантностью
            keywords_set = set(kw.lower() for kw in keywords)
            found_keywords = set()
            
            # Нормализуем текст пользователя для извлечения слов
            normalized_user_text = normalize_text(
                user_answer_lower,
                normalize_yo=tolerance_config.get('normalize_yo', True),
                normalize_layout=tolerance_config.get('normalize_layout', True),
                normalize_y_i=tolerance_config.get('normalize_y_i', True)
            )
            user_words = extract_words_from_text(normalized_user_text)
            
            for keyword in keywords:
                keyword_lower = keyword.lower()
                
                # Используем find_keyword_with_tolerance для поиска с толерантностью
                found = find_keyword_with_tolerance(user_answer, keyword, tolerance_config)
                if found:
                    found_keywords.add(keyword_lower)
                    
                    # Получаем детальную информацию о толерантности
                    # Ищем соответствующее слово в тексте пользователя
                    keyword_normalized = normalize_text(
                        keyword_lower,
                        normalize_yo=tolerance_config.get('normalize_yo', True),
                        normalize_layout=tolerance_config.get('normalize_layout', True),
                        normalize_y_i=tolerance_config.get('normalize_y_i', True)
                    )
                    
                    m = _match_keyword_with_spans(keyword)
                    if m:
                        tolerance_matches.append(m)
                        td = {
                            'type': m.get('type'),
                            'correct_answer': m.get('correct_word'),
                            'user_answer': m.get('user_word'),
                        }
                        if m.get('normalized_kinds'):
                            td['normalized_kinds'] = m.get('normalized_kinds')
                        keyword_tolerance_info[keyword] = td
            
            missing_keywords = keywords_set - found_keywords
            
            # D-1 fix: support min_keywords / require_all_keywords
            require_all = answer_key.get('require_all_keywords', True)
            min_kw = answer_key.get('min_keywords')
            if not require_all and isinstance(min_kw, (int, float)) and int(min_kw) >= 1:
                is_correct = len(found_keywords) >= int(min_kw)
            else:
                is_correct = len(found_keywords) == len(keywords_set)
        
        # Определяем успешность на основе найденных слов
        total_keywords = len(keywords)
        found_count = len(found_keywords)
        
        # Если важна последовательность и порядок нарушен:
        if sequence_matters and len(keywords) > 1 and not is_correct:
            if found_count == total_keywords:
                # Все слова есть, но порядок неверный
                # Пытаемся вывести эталонный ответ или корректную последовательность
                ref_answer = (
                    answer_key.get('reference_answer') or
                    answer_key.get('content', {}).get('reference_answer', '')
                )
                correct_sequence_text = ' '.join(keywords)
                # Сообщение без вставки полного ответа — сам ответ покажем в UI отдельно
                message = (
                    "Ключевые слова найдены, но нарушена требуемая последовательность"
                )
            else:
                # Частичное совпадение: поясняем про порядок
                message = f"Не все ключевые слова найдены ({found_count}/{total_keywords}). Требуется порядок"
        else:
            message = None
        
        if is_correct:
            message = message or f"✅ Правильно! Найдены все ключевые слова ({found_count}/{total_keywords})"
        else:
            message = message or f"❌ Не все ключевые слова найдены ({found_count}/{total_keywords})"
        
        # Проверяем наличие опечаток в найденных словах
        has_typos = False
        if keyword_tolerance_info:
            for keyword, tolerance_detail in keyword_tolerance_info.items():
                if tolerance_detail and tolerance_detail.get('type') in ['typo', 'ending', 'both']:
                    has_typos = True
                    break
                if tolerance_detail and tolerance_detail.get('type') == 'exact':
                    kinds = tolerance_detail.get('normalized_kinds') if isinstance(tolerance_detail, dict) else None
                    if kinds:
                        has_typos = True
                        break
        
        # Добавляем предупреждение об опечатках, если они были обнаружены
        if has_typos:
            typo_warning = " ⚠️ Обратите внимание на опечатки!"
            if message:
                message = message + typo_warning
            else:
                message = typo_warning
        
        # Формируем детали ответа (с полезными подсказками для UI)
        tolerance_summary = self._summarize_tolerance_matches(tolerance_matches)
        tolerance_type = tolerance_summary.get('tolerance_type')
        tolerance_explanation = self._build_tolerance_explanation("Ответ", tolerance_summary)

        ref_answer = (
            answer_key.get('reference_answer') or
            answer_key.get('content', {}).get('reference_answer', '')
        )
        details_payload = {
            'found_keywords': list(found_keywords),
            'missing_keywords': list(missing_keywords),
            'total_keywords': total_keywords,
            'sequence_matters': sequence_matters,
            'keywords': keywords,
            'tolerance_matches': tolerance_matches,
            'tolerance_type': tolerance_type,
            'normalization_kinds': tolerance_summary.get('normalization_kinds', []),
            'tolerance_explanation': tolerance_explanation,
            'user_answer': user_answer
        }
        if sequence_matters and len(keywords) > 1:
            details_payload['correct_sequence'] = keywords
        if ref_answer:
            details_payload['reference_answer'] = ref_answer
        
        # D-8 fix: wrong sequence = fail = 0%
        if sequence_matters and len(keywords) > 1 and found_count == total_keywords and not is_correct:
            score = 0.0
        else:
            score = (found_count / total_keywords * 100.0) if total_keywords > 0 else 0.0

        return EvaluationResult(
            success=is_correct,
            message=message,
            score=score,
            metric="percent",
            details=details_payload
        )
    
    # =========================================================================
    # SEQUENCE ASSEMBLY TASK EVALUATION
    # Извлечено из trainer.py::check_sequence_levels (строки 2303-2396)
    # =========================================================================
    
    def evaluate_sequence_task(self, user_input: Dict[str, Any],
                              answer_key: Dict[str, Any],
                              task_data: Optional[Dict[str, Any]] = None) -> EvaluationResult:
        """
        Оценка Sequence Assembly задания (сборка последовательностей).
        
        Поддерживает уровни сложности через поля из DifficultyManager:
        - Уровень 1: только сборка последовательности (базовая логика)
        - Уровень 2: сборка + проверка названий уровней (content.requires_level_names = True)
        - Уровень 3: сборка + проверка названий уровней + названий блоков (content.requires_block_names = True)
        
        Args:
            user_input: {
                'levels': [
                    {
                        'level_id': str,
                        'blocks': [str, ...],  # ID элементов
                        'level_name': str,  # название уровня (уровень 2-3)
                        'block_names': {block_id: str, ...}  # названия блоков (уровень 3)
                    },
                    ...
                ]
            }
            answer_key: {
                'levels': [
                    {
                        'level_id': str,
                        'blocks': [str, ...],
                        'level_name': str,  # правильное название уровня (уровень 2-3)
                        'block_names': {block_id: str, ...}  # правильные названия блоков (уровень 3)
                    },
                    ...
                ],
                'sequence_within_level_matters': bool,
                'level_order_matters': bool
            }
            task_data: Данные задания
                     Может содержать поля из DifficultyManager:
                     - content.requires_level_names: требуется проверка названий уровней (level >= 2)
                     - content.requires_block_names: требуется проверка названий блоков (level >= 3)
        
        Returns:
            EvaluationResult с детальными результатами по уровням:
            - Уровень 1: только результат последовательности
            - Уровень 2: комбинация последовательности (70%) + названия уровней (15%)
            - Уровень 3: комбинация последовательности (70%) + названия уровней (15%) + названия блоков (15%)
        
        Логика делегируется в SequenceAssemblyTaskEvaluator (строки 2378-2396)
        """
        try:
            from task_system.types.sequence_assembly_task import SequenceAssemblyTaskEvaluator
            
            # Нормализация формата, как в легаси: если данные лежат в content,
            # поднимем ключи на верхний уровень (levels/correct_sequence/настройки)
            normalized = dict(answer_key or {})
            
            # Извлекаем из content если есть
            if isinstance(normalized.get('content'), dict):
                content = normalized['content']
                for k in ('levels', 'correct_sequence', 'sequence_within_level_matters', 'level_order_matters'):
                    if k in content and k not in normalized:
                        normalized[k] = content[k]
            
            # Извлекаем настройки из settings если есть
            if task_data and isinstance(task_data.get('settings'), dict):
                settings = task_data['settings']
                for k in ('sequence_within_level_matters', 'level_order_matters'):
                    if k in settings and k not in normalized:
                        normalized[k] = settings[k]
            
            # ВАЖНО: Проверка полей из DifficultyManager для поддержки уровней сложности (ФАЗА 2)
            content = task_data.get('content', {}) if task_data else {}
            requires_level_names = content.get('requires_level_names', False)
            requires_block_names = content.get('requires_block_names', False)
            show_level_labels = content.get('show_level_labels', True)
            show_block_labels = content.get('show_block_labels', True)

            # Отладка: логируем обнаруженные уровни/последовательность
            try:
                dbg_levels = normalized.get('levels')
                dbg_seq = normalized.get('correct_sequence')
                logger.debug(f"[SequenceEval] levels_present={bool(dbg_levels)} seq_present={bool(dbg_seq)}")
                if dbg_levels:
                    logger.debug(f"[SequenceEval] levels_count={len(dbg_levels)}")
            except Exception:
                pass

            evaluator = SequenceAssemblyTaskEvaluator()
            result = evaluator.evaluate(user_input, normalized)

            # Итог из внутреннего оценщика (базовая проверка последовательности)
            # Для уровня 2 (requires_level_names = True): базовый оценщик не подходит,
            # так как level_id не совпадают (пользователь создает уровни с user_level_*)
            # Мы определим sequence_success позже, после сопоставления по содержимому
            sequence_success = result.get('success', result.get('is_correct', False))
            inner_details = result.get('details', {})
            
            # Для уровня 2: сбрасываем sequence_success, будет определен позже
            if requires_level_names:
                sequence_success = None  # Будет определен после сопоставления по содержимому

            # Сформируем дружественные списки правильных/неправильных уровней для UI
            user_levels = (user_input or {}).get('levels', [])
            correct_levels_ref = normalized.get('levels', []) or []
            sequence_matters = normalized.get('sequence_within_level_matters', False)
            level_order_matters = normalized.get('level_order_matters', False)
            
            # Fix: Log warning if null values detected in user blocks (shouldn't happen after frontend fix)
            for ul_idx, ul in enumerate(user_levels):
                ul_blocks = ul.get('blocks', [])
                if any(b is None for b in ul_blocks):
                    logger.warning(f"[SequenceEval] Null value in user_levels[{ul_idx}].blocks: {ul_blocks}")
            
            # Извлекаем elements для получения правильных названий блоков (уровень 3)
            elements = None
            if task_data:
                # Пробуем извлечь из content
                content = task_data.get('content', {})
                if isinstance(content, dict) and 'elements' in content:
                    elements = content['elements']
                # Или из самого task_data
                elif 'elements' in task_data:
                    elements = task_data['elements']
            # Или из normalized/answer_key
            if not elements and isinstance(normalized.get('elements'), list):
                elements = normalized['elements']
            
            # Создаем словарь element_id -> element_text для быстрого поиска
            element_text_map = {}
            if isinstance(elements, list):
                for element in elements:
                    if isinstance(element, dict):
                        element_id = element.get('id')
                        element_text = element.get('text', '')
                        if element_id:
                            element_text_map[element_id] = element_text

            def canonicalize_sequence_semantic_value(explicit_key, raw_text='', raw_image=''):
                explicit_value = str(explicit_key or '').strip()
                if explicit_value:
                    lowered = explicit_value.lower()
                    if lowered.startswith('text:'):
                        normalized_explicit_text = self._normalize_text_for_comparison(
                            explicit_value.split(':', 1)[1]
                        )
                        if normalized_explicit_text:
                            return f"text:{normalized_explicit_text}"
                    elif lowered.startswith('image:'):
                        normalized_explicit_image = explicit_value.split(':', 1)[1].strip().replace('\\', '/')
                        if normalized_explicit_image:
                            return f"image:{normalized_explicit_image}"
                    return explicit_value

                normalized_text = self._normalize_text_for_comparison(raw_text)
                if normalized_text:
                    return f"text:{normalized_text}"

                normalized_image = str(raw_image or '').strip().replace('\\', '/')
                if normalized_image:
                    return f"image:{normalized_image}"

                return ''

            element_semantic_map = {}
            if isinstance(elements, list):
                for element in elements:
                    if not isinstance(element, dict):
                        continue
                    element_id = str(element.get('id') or '').strip()
                    if not element_id:
                        continue
                    explicit_key = str(
                        element.get('semantic_key')
                        or element.get('semanticKey')
                        or ''
                    ).strip()
                    semantic_value = canonicalize_sequence_semantic_value(
                        explicit_key,
                        raw_text=element.get('text', ''),
                        raw_image=element.get('image'),
                    )
                    element_semantic_map[element_id] = semantic_value or f"id:{element_id}"

            def normalize_sequence_blocks(blocks, block_names=None):
                normalized_blocks = []
                normalized_block_names = block_names if isinstance(block_names, dict) else {}
                for raw_block in blocks or []:
                    if raw_block is None:
                        normalized_blocks.append('__missing__')
                        continue
                    block_id = str(raw_block)
                    semantic_value = element_semantic_map.get(block_id)
                    if not semantic_value:
                        typed_name = str(normalized_block_names.get(block_id, '') or '').strip()
                        normalized_typed_name = self._normalize_text_for_comparison(typed_name)
                        if normalized_typed_name:
                            semantic_value = f"text:{normalized_typed_name}"
                    normalized_blocks.append(semantic_value or f"id:{block_id}")
                return normalized_blocks

            def sequence_blocks_match(user_blocks, correct_blocks, order_matters, user_block_names=None):
                normalized_user = normalize_sequence_blocks(user_blocks, user_block_names)
                normalized_correct = normalize_sequence_blocks(correct_blocks)
                if order_matters:
                    return tuple(normalized_user) == tuple(normalized_correct)
                return Counter(normalized_user) == Counter(normalized_correct)

            def count_sequence_block_matches(user_blocks, correct_blocks, order_matters, user_block_names=None):
                normalized_user = normalize_sequence_blocks(user_blocks, user_block_names)
                normalized_correct = normalize_sequence_blocks(correct_blocks)
                if order_matters:
                    return sum(
                        1
                        for idx, block in enumerate(normalized_user)
                        if idx < len(normalized_correct) and block == normalized_correct[idx]
                    )
                return sum((Counter(normalized_user) & Counter(normalized_correct)).values())

            def collect_matching_user_block_ids(user_blocks, correct_blocks, order_matters, user_block_names=None):
                matched_ids = []
                normalized_user = normalize_sequence_blocks(user_blocks, user_block_names)
                normalized_correct = normalize_sequence_blocks(correct_blocks)
                if order_matters:
                    matched_ids = [None] * len(normalized_correct)
                    for idx, correct_block in enumerate(normalized_correct):
                        if idx >= len(normalized_user):
                            continue
                        if normalized_user[idx] != correct_block:
                            continue
                        raw_id = user_blocks[idx] if idx < len(user_blocks) else None
                        if raw_id is not None:
                            matched_ids[idx] = raw_id
                    return matched_ids

                remaining = Counter(normalized_correct)
                for idx, block in enumerate(normalized_user):
                    if remaining.get(block, 0) <= 0:
                        continue
                    raw_id = user_blocks[idx] if idx < len(user_blocks) else None
                    if raw_id is not None:
                        matched_ids.append(raw_id)
                    remaining[block] -= 1
                return matched_ids
            
            # ОТЛАДКА: логируем входные данные для уровня 2
            if requires_level_names:
                logger.debug(f"[SequenceEval Level2] === НАЧАЛО ПРОВЕРКИ ===")
                logger.debug(f"[SequenceEval Level2] user_levels count: {len(user_levels)}")
                for i, ul in enumerate(user_levels):
                    logger.debug(f"[SequenceEval Level2] user_level[{i}]: level_id={ul.get('level_id')}, "
                               f"blocks={ul.get('blocks')}, level_name='{ul.get('level_name', '')}'")
                
                logger.debug(f"[SequenceEval Level2] correct_levels_ref count: {len(correct_levels_ref)}")
                for i, cl in enumerate(correct_levels_ref):
                    logger.debug(f"[SequenceEval Level2] correct_level[{i}]: level_id={cl.get('level_id')}, "
                               f"blocks={cl.get('blocks')}, level_name='{cl.get('level_name', '')}'")
                
                logger.debug(f"[SequenceEval Level2] requires_level_names={requires_level_names}, "
                            f"sequence_matters={sequence_matters}, level_order_matters={level_order_matters}")

            correct_level_ids: List[str] = []
            incorrect_level_ids: List[str] = []
            level_names_map = {}  # Карта level_id -> level_name для отображения
            level_mapping = None  # Для уровня 3: mapping соответствий {correct_level_id: user_level_index}
            # Для уровня 1: счетчики правильно размещенных блоков
            total_correct_blocks = 0
            total_blocks_in_levels = 0
            correct_blocks_by_level = {}  # {level_id: set of correct block IDs} - для визуализации уровня 1
            levels_order_info = False  # Информация о правильности порядка уровней (для сообщения)
            if correct_levels_ref:
                # Для уровня 2-3 (requires_level_names = True): сопоставляем по содержимому или block_names
                if requires_level_names:
                    # Для уровня 3 (requires_block_names): сопоставляем по block_names, а не по ID блоков
                    if requires_block_names:
                        # Сопоставление по block_names для уровня 3
                        used_user_indices = set()
                        level_mapping = {}  # {correct_level_id: user_level_index} - для передачи в _evaluate_level_names
                        
                        # ИСПРАВЛЕНИЕ: Подсчитываем общее количество блоков для уровня 3
                        total_blocks_in_levels = 0
                        for correct_level in correct_levels_ref:
                            cblocks = correct_level.get('blocks', [])
                            total_blocks_in_levels += len(cblocks)
                        
                        for correct_level in correct_levels_ref:
                            cid = correct_level.get('level_id', '')
                            cblocks = correct_level.get('blocks', [])
                            correct_block_names = correct_level.get('block_names', {})
                            level_name = correct_level.get('level_name', '')
                            if level_name:
                                level_names_map[cid] = level_name
                            
                            logger.debug(f"[SequenceEval Level3] Ищем соответствие для correct_level: "
                                       f"level_id={cid}, level_name='{level_name}', "
                                       f"block_names={correct_block_names}")
                            
                            # Ищем соответствующий уровень пользователя по реальной структуре блоков.
                            # Введенные пользователем названия не должны определять сам structural match.
                            found_match = False
                            for idx, user_level in enumerate(user_levels):
                                if idx in used_user_indices:
                                    continue
                                
                                ublocks = user_level.get('blocks', [])
                                user_block_names = user_level.get('block_names', {})
                                user_level_name = user_level.get('level_name', '')
                                
                                logger.debug(f"[SequenceEval Level3] Проверяем user_level[{idx}]: "
                                           f"level_id={user_level.get('level_id')}, "
                                           f"blocks={ublocks}, "
                                           f"block_names={user_block_names}, "
                                           f"level_name='{user_level_name}'")
                                
                                if sequence_blocks_match(ublocks, cblocks, sequence_matters, user_block_names):
                                    logger.debug(f"[SequenceEval Level3] ✓ НАЙДЕНО STRUCTURAL СООТВЕТСТВИЕ: "
                                               f"correct_level_id={cid} <-> user_level[{idx}]")
                                    used_user_indices.add(idx)
                                    correct_level_ids.append(cid)
                                    level_mapping[cid] = idx
                                    total_correct_blocks += len(cblocks)
                                    correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters, user_block_names)
                                    found_match = True
                                    break
                            
                            if not found_match:
                                logger.debug(f"[SequenceEval Level3] ✗ НЕ НАЙДЕНО соответствие для correct_level_id={cid}")
                                incorrect_level_ids.append(cid)
                                correct_blocks_by_level[cid] = []
                        
                        # Проверяем лишние уровни пользователя
                        for idx, user_level in enumerate(user_levels):
                            if idx not in used_user_indices:
                                uid = user_level.get('level_id', '')
                                logger.debug(f"[SequenceEval Level3] ✗ Лишний уровень пользователя: user_level[{idx}], level_id={uid}")
                                incorrect_level_ids.append(uid)
                        
                        # Для уровня 3: определяем sequence_success на основе сопоставления по block_names
                        total_correct = len(correct_levels_ref)
                        total_found = len(correct_level_ids)
                        total_user = len(user_levels)
                        sequence_success = (total_found == total_correct and total_user == total_correct)
                        
                        logger.debug(f"[SequenceEval Level3] === РЕЗУЛЬТАТ СОПОСТАВЛЕНИЯ ===")
                        logger.debug(f"[SequenceEval Level3] total_correct={total_correct}, total_found={total_found}, "
                                   f"total_user={total_user}, sequence_success={sequence_success}")
                    else:
                        # Для уровня 2: сопоставление по содержимому блоков
                        used_user_indices = set()
                        # ДОБАВЛЕНО: Mapping для проверки порядка: {user_level_index: correct_level_id}
                        user_to_correct_mapping = {}
                        # ДОБАВЛЕНО: Mapping на основе названий для проверки порядка: {user_level_index: correct_level_id}
                        user_to_correct_by_name = {}
                        
                        # ИСПРАВЛЕНИЕ: Инициализируем счетчики блоков для уровня 2
                        total_correct_blocks = 0
                        total_blocks_in_levels = 0
                        correct_blocks_by_level = {}
                        
                        for correct_level in correct_levels_ref:
                            cid = correct_level.get('level_id', '')
                            cblocks = correct_level.get('blocks', [])
                            level_name = correct_level.get('level_name', '')
                            if level_name:
                                level_names_map[cid] = level_name
                            
                            # ИСПРАВЛЕНИЕ: Подсчитываем общее количество блоков
                            total_blocks_in_levels += len(cblocks)
                            
                            # Нормализуем блоки для сравнения
                            cblocks_normalized = tuple(normalize_sequence_blocks(cblocks))
                            
                            logger.debug(f"[SequenceEval Level2] Ищем соответствие для correct_level: "
                                       f"level_id={cid}, level_name='{level_name}', "
                                       f"blocks={cblocks}, normalized={cblocks_normalized}")
                            
                            # Ищем соответствующий уровень пользователя по содержимому
                            found_match = False
                            for idx, user_level in enumerate(user_levels):
                                if idx in used_user_indices:
                                    continue
                                
                                ublocks = user_level.get('blocks', [])
                                # Нормализуем блоки пользователя
                                ublocks_normalized = tuple(normalize_sequence_blocks(ublocks))
                                
                                logger.debug(f"[SequenceEval Level2] Проверяем user_level[{idx}]: "
                                           f"level_id={user_level.get('level_id')}, "
                                           f"blocks={ublocks}, normalized={ublocks_normalized}, "
                                           f"level_name='{user_level.get('level_name', '')}'")
                                
                                # ИСПРАВЛЕНИЕ: Проверяем точное совпадение блоков
                                if ublocks_normalized == cblocks_normalized:
                                    logger.debug(f"[SequenceEval Level2] ✓ НАЙДЕНО СООТВЕТСТВИЕ (точное): "
                                               f"correct_level_id={cid} <-> user_level[{idx}]")
                                    used_user_indices.add(idx)
                                    correct_level_ids.append(cid)
                                    # ДОБАВЛЕНО: Сохраняем mapping для проверки порядка
                                    user_to_correct_mapping[idx] = cid
                                    # ИСПРАВЛЕНИЕ: Подсчитываем правильные блоки
                                    total_correct_blocks += len(cblocks)
                                    correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                                    found_match = True
                                    break
                            
                            # ДОБАВЛЕНО: Если не найдено точное соответствие, проверяем по названию уровня
                            matched_user_idx = None
                            if not found_match:
                                correct_name_normalized = self._normalize_text_for_comparison(level_name)
                                for idx, user_level in enumerate(user_levels):
                                    if idx in used_user_indices:
                                        continue
                                    
                                    user_name = user_level.get('level_name', '')
                                    user_name_normalized = self._normalize_text_for_comparison(user_name)
                                    
                                    if user_name_normalized == correct_name_normalized:
                                        logger.debug(f"[SequenceEval Level2] ✓ НАЙДЕНО СООТВЕТСТВИЕ (по названию): "
                                                   f"correct_level_id={cid} <-> user_level[{idx}], name='{level_name}'")
                                        # Сохраняем mapping по названию для проверки порядка
                                        user_to_correct_by_name[idx] = cid
                                        matched_user_idx = idx
                                        # ИСПРАВЛЕНИЕ: Устанавливаем found_match = True, чтобы не добавлять в incorrect_level_ids
                                        found_match = True
                                        # НЕ добавляем в used_user_indices, чтобы можно было найти точное соответствие по блокам
                                        # НЕ добавляем в correct_level_ids, так как блоки не совпадают
                                        break
                            
                            # ИСПРАВЛЕНИЕ: Если найдено соответствие по названию, проверяем блоки
                            if found_match and matched_user_idx is not None:
                                user_level = user_levels[matched_user_idx]
                                ublocks = user_level.get('blocks', [])
                                
                                # Нормализуем блоки пользователя
                                ublocks_normalized = tuple(normalize_sequence_blocks(ublocks))
                                
                                # Проверяем совпадение блоков
                                if ublocks_normalized == cblocks_normalized:
                                    # Блоки полностью совпадают - добавляем в correct_level_ids
                                    if matched_user_idx not in used_user_indices:
                                        used_user_indices.add(matched_user_idx)
                                        correct_level_ids.append(cid)
                                        # Обновляем mapping - используем точное соответствие
                                        if matched_user_idx in user_to_correct_by_name:
                                            del user_to_correct_by_name[matched_user_idx]
                                        user_to_correct_mapping[matched_user_idx] = cid
                                    total_correct_blocks += len(cblocks)
                                    correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                                    logger.debug(f"[SequenceEval Level2] ✓ Блоки совпадают для уровня {cid}, добавлено в correct_level_ids")
                                else:
                                    # Блоки не совпадают полностью - считаем правильные блоки
                                    if sequence_matters:
                                        # Частичное совпадение тоже считаем по semantic_key, а не по сырым id.
                                        correct_in_level = count_sequence_block_matches(ublocks, cblocks, True)
                                        correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, True)
                                        total_correct_blocks += correct_in_level
                                        correct_blocks_by_level[cid] = correct_block_ids
                                    else:
                                        # Для неупорядоченного уровня учитываем кратность одинаковых шагов.
                                        correct_in_level = count_sequence_block_matches(ublocks, cblocks, False)
                                        correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, False)
                                        total_correct_blocks += correct_in_level
                                        correct_blocks_by_level[cid] = correct_block_ids
                                    
                                    logger.debug(f"[SequenceEval Level2] Блоки частично совпадают для уровня {cid}: {correct_in_level}/{len(cblocks)} правильных")
                            
                            if not found_match:
                                logger.debug(f"[SequenceEval Level2] ✗ НЕ НАЙДЕНО соответствие для correct_level_id={cid}")
                                incorrect_level_ids.append(cid)
                                correct_blocks_by_level[cid] = []  # Нет правильных блоков
                        
                        # ИСПРАВЛЕНИЕ: Убеждаемся, что все правильные уровни инициализированы в correct_blocks_by_level
                        for correct_level in correct_levels_ref:
                            cid = correct_level.get('level_id', '')
                            if cid not in correct_blocks_by_level:
                                correct_blocks_by_level[cid] = []

                        # Названия уровней должны проверяться только для уровней,
                        # которые уже совпали по реальной структуре блоков.
                        level_mapping = {correct_id: user_idx for user_idx, correct_id in user_to_correct_mapping.items()}
                        
                        # Проверяем лишние уровни пользователя
                        # ИСПРАВЛЕНИЕ: Не добавляем в incorrect_level_ids уровни, которые сопоставлены по названию
                        for idx, user_level in enumerate(user_levels):
                            if idx not in used_user_indices:
                                # Проверяем, есть ли соответствие по названию
                                if idx in user_to_correct_by_name:
                                    # Уровень сопоставлен по названию, не добавляем в incorrect
                                    logger.debug(f"[SequenceEval Level2] Уровень user_level[{idx}] сопоставлен по названию, пропускаем")
                                    continue
                                uid = user_level.get('level_id', '')
                                logger.debug(f"[SequenceEval Level2] ✗ Лишний уровень пользователя: user_level[{idx}], level_id={uid}")
                                incorrect_level_ids.append(uid)
                        
                        # ДОБАВЛЕНО: Проверка порядка уровней для уровня 2, если level_order_matters=True
                        levels_order_correct = None
                        if level_order_matters:
                            # ИСПРАВЛЕНИЕ: Проверяем порядок на основе названий уровней
                            # Используем mapping по блокам, если есть, иначе - по названиям
                            order_mapping = user_to_correct_mapping if user_to_correct_mapping else user_to_correct_by_name
                            
                            if order_mapping:
                                # Создаем список correct_level_id в порядке user_level_index
                                user_indices_sorted = sorted(order_mapping.keys())
                                found_order = [order_mapping[idx] for idx in user_indices_sorted]
                                correct_order = [l.get('level_id', '') for l in correct_levels_ref]
                                
                                levels_order_correct = (found_order == correct_order)
                                
                                logger.debug(f"[SequenceEval Level2] Проверка порядка: found_order={found_order}, correct_order={correct_order}, levels_order_correct={levels_order_correct}")
                            else:
                                # Если нет соответствий ни по блокам, ни по названиям, проверяем порядок по названиям напрямую
                                user_level_names = [self._normalize_text_for_comparison(ul.get('level_name', '')) for ul in user_levels]
                                correct_level_names = [self._normalize_text_for_comparison(cl.get('level_name', '')) for cl in correct_levels_ref]
                                
                                levels_order_correct = (user_level_names == correct_level_names)
                                
                                logger.debug(f"[SequenceEval Level2] Проверка порядка по названиям (напрямую): user_names={user_level_names}, correct_names={correct_level_names}, levels_order_correct={levels_order_correct}")
                        
                        # Для уровня 2: определяем sequence_success на основе сопоставления по содержимому
                        # Все правильные уровни должны быть найдены, и не должно быть лишних
                        total_correct = len(correct_levels_ref)
                        total_found = len(correct_level_ids)
                        total_user = len(user_levels)
                        # ИСПРАВЛЕНИЕ: Если level_order_matters=True, учитываем порядок в sequence_success
                        if level_order_matters and levels_order_correct is not None:
                            # Успех = все правильные уровни найдены И нет лишних И порядок правильный
                            sequence_success = (total_found == total_correct and total_user == total_correct and levels_order_correct)
                        else:
                            # Успех = все правильные уровни найдены И нет лишних уровней
                            sequence_success = (total_found == total_correct and total_user == total_correct)
                        
                        # ДОБАВЛЕНО: Сохраняем levels_order_info для сообщения
                        if levels_order_correct is not None:
                            levels_order_info = levels_order_correct
                        
                        logger.debug(f"[SequenceEval Level2] === РЕЗУЛЬТАТ СОПОСТАВЛЕНИЯ ===")
                        logger.debug(f"[SequenceEval Level2] total_correct={total_correct}, total_found={total_found}, "
                                   f"total_user={total_user}, sequence_success={sequence_success}")
                        if levels_order_correct is not None:
                            logger.debug(f"[SequenceEval Level2] levels_order_correct={levels_order_correct}")
                        logger.debug(f"[SequenceEval Level2] correct_level_ids: {correct_level_ids}")
                        logger.debug(f"[SequenceEval Level2] incorrect_level_ids: {incorrect_level_ids}")
                        logger.debug(f"[SequenceEval Level2] used_user_indices: {used_user_indices}")
                        logger.debug(f"[SequenceEval Level2] total_correct_blocks={total_correct_blocks}, total_blocks_in_levels={total_blocks_in_levels}")
                        logger.debug(f"[SequenceEval Level2] correct_blocks_by_level: {correct_blocks_by_level}")
                elif level_order_matters:
                    # Уровень 1: порядок важен - сопоставляем по позиции
                    # Сбрасываем счетчики для этого случая
                    total_correct_blocks = 0
                    total_blocks_in_levels = 0
                    # Очищаем словарь для хранения правильно размещенных блоков по уровням
                    correct_blocks_by_level.clear()
                    
                    for user_level, correct_level in zip(user_levels, correct_levels_ref):
                        uid = (user_level or {}).get('level_id', '')
                        cid = (correct_level or {}).get('level_id', '')
                        ublocks = (user_level or {}).get('blocks', [])
                        cblocks = (correct_level or {}).get('blocks', [])
                        # Сохраняем название уровня
                        level_name = correct_level.get('level_name', '')
                        if level_name:
                            level_names_map[cid] = level_name
                        
                        total_blocks_in_levels += len(cblocks)
                        
                        if uid == cid:
                            # ИСПРАВЛЕНИЕ: Считаем правильно размещенные блоки, даже если не все размещены
                                if sequence_matters:
                                    # Если порядок важен, проверяем точное совпадение последовательности
                                    if sequence_blocks_match(ublocks, cblocks, True):
                                        correct_level_ids.append(cid)
                                        total_correct_blocks += len(cblocks)
                                        correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                                    else:
                                        # Частичное совпадение считаем семантически, чтобы одинаковый текст не зависел от auto-id.
                                        correct_in_level = count_sequence_block_matches(ublocks, cblocks, True)
                                        correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, True)
                                        total_correct_blocks += correct_in_level
                                        correct_blocks_by_level[cid] = correct_block_ids
                                        if correct_in_level > 0:
                                            # Есть правильно размещенные блоки, но не все
                                            incorrect_level_ids.append(cid)
                                        else:
                                            # Нет правильно размещенных блоков
                                            incorrect_level_ids.append(cid)
                                else:
                                    # Если порядок не важен, сравниваем состав по semantic_key с учетом кратности.
                                    if sequence_blocks_match(ublocks, cblocks, False):
                                        # Точное совпадение - все блоки размещены правильно
                                        correct_level_ids.append(cid)
                                        total_correct_blocks += len(cblocks)
                                        correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                                    else:
                                        correct_in_level = count_sequence_block_matches(ublocks, cblocks, False)
                                        correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, False)
                                        total_correct_blocks += correct_in_level
                                        correct_blocks_by_level[cid] = correct_block_ids
                                        if correct_in_level > 0:
                                            # Есть правильно размещенные блоки, но не все
                                            incorrect_level_ids.append(cid)
                                        else:
                                            # Нет правильно размещенных блоков или есть неправильные
                                            incorrect_level_ids.append(cid)
                        else:
                            incorrect_level_ids.append(cid)
                            correct_blocks_by_level[cid] = []  # Нет правильных блоков
                    
                    # Убеждаемся, что все правильные уровни инициализированы в correct_blocks_by_level
                    for correct_level in correct_levels_ref:
                        cid = correct_level.get('level_id', '')
                        if cid not in correct_blocks_by_level:
                            correct_blocks_by_level[cid] = []
                    
                    # ОБНОВЛЕНИЕ: Для уровня 1 обновляем sequence_success на основе проверки блоков
                    total_correct = len(correct_levels_ref)
                    total_found = len(correct_level_ids)
                    total_user = len(user_levels)
                    
                    # ИСПРАВЛЕНИЕ: Для level_order_matters=True проверяем порядок уровней И правильность блоков
                    # Последовательность правильная, если:
                    # 1. Порядок level_id правильный
                    # 2. Все уровни присутствуют
                    # 3. Все блоки размещены правильно (все уровни в correct_level_ids, нет в incorrect_level_ids)
                    user_level_ids = [l.get('level_id', '') for l in user_levels]
                    correct_level_ids_list = [l.get('level_id', '') for l in correct_levels_ref]
                    levels_order_correct = (user_level_ids == correct_level_ids_list)
                    
                    # Сохраняем информацию о правильности порядка уровней для сообщения
                    levels_order_info = (levels_order_correct and total_user == total_correct)
                    
                    # ДОБАВЛЕНО: Логируем levels_order_info для отладки
                    logger.debug(f"[SequenceEval Level1] levels_order_info={levels_order_info} (levels_order_correct={levels_order_correct}, total_user={total_user}, total_correct={total_correct})")
                    
                    # Успех последовательности = правильный порядок уровней И все уровни присутствуют И все блоки правильные
                    sequence_success = (
                        levels_order_correct and 
                        total_user == total_correct and 
                        len(correct_level_ids) == total_correct and
                        len(incorrect_level_ids) == 0
                    )
                    
                    logger.debug(f"[SequenceEval Level1] === РЕЗУЛЬТАТ ПРОВЕРКИ БЛОКОВ (order matters) ===")
                    logger.debug(f"[SequenceEval Level1] user_level_ids={user_level_ids}, correct_level_ids_list={correct_level_ids_list}")
                    logger.debug(f"[SequenceEval Level1] levels_order_correct={levels_order_correct}")
                    logger.debug(f"[SequenceEval Level1] total_correct={total_correct}, total_found={total_found}, "
                               f"total_user={total_user}, incorrect_count={len(incorrect_level_ids)}, sequence_success={sequence_success}")
                    logger.debug(f"[SequenceEval Level1] correct_level_ids: {correct_level_ids}")
                    logger.debug(f"[SequenceEval Level1] incorrect_level_ids: {incorrect_level_ids}")
                    logger.debug(f"[SequenceEval Level1] total_correct_blocks={total_correct_blocks}, total_blocks_in_levels={total_blocks_in_levels}")
                    logger.debug(f"[SequenceEval Level1] correct_blocks_by_level: {correct_blocks_by_level}")
                else:
                    # Уровень 1: порядок не важен - сопоставляем по level_id
                    # Сбрасываем счетчики для этого случая
                    total_correct_blocks = 0
                    total_blocks_in_levels = 0
                    # Очищаем словарь для хранения правильно размещенных блоков по уровням
                    correct_blocks_by_level.clear()
                    
                    correct_map = {lvl.get('level_id', ''): lvl for lvl in correct_levels_ref}
                    for cid, clvl in correct_map.items():
                        cblocks = clvl.get('blocks', [])
                        # Сохраняем название уровня
                        level_name = clvl.get('level_name', '')
                        if level_name:
                            level_names_map[cid] = level_name
                        
                        total_blocks_in_levels += len(cblocks)
                        
                        # Найдём соответствующий уровень пользователя
                        ulvl = next((l for l in user_levels if l.get('level_id', '') == cid), None)
                        if not ulvl:
                            incorrect_level_ids.append(cid)
                            correct_blocks_by_level[cid] = []  # Нет правильных блоков
                            continue
                        ublocks = ulvl.get('blocks', [])
                        
                        # ИСПРАВЛЕНИЕ: Считаем правильно размещенные блоки, даже если не все размещены
                        if sequence_matters:
                            # Если порядок важен, проверяем точное совпадение последовательности
                            if sequence_blocks_match(ublocks, cblocks, True):
                                correct_level_ids.append(cid)
                                total_correct_blocks += len(cblocks)
                                correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                            else:
                                # Частичное совпадение тоже считаем по semantic_key.
                                correct_in_level = count_sequence_block_matches(ublocks, cblocks, True)
                                correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, True)
                                total_correct_blocks += correct_in_level
                                correct_blocks_by_level[cid] = correct_block_ids
                                if correct_in_level > 0:
                                    # Есть правильно размещенные блоки, но не все
                                    incorrect_level_ids.append(cid)
                                else:
                                    # Нет правильно размещенных блоков
                                    incorrect_level_ids.append(cid)
                        else:
                            # Если порядок не важен, сравниваем состав по semantic_key с учетом кратности.
                            if sequence_blocks_match(ublocks, cblocks, False):
                                # Точное совпадение - все блоки размещены правильно
                                correct_level_ids.append(cid)
                                total_correct_blocks += len(cblocks)
                                correct_blocks_by_level[cid] = collect_matching_user_block_ids(ublocks, cblocks, sequence_matters)
                            else:
                                correct_in_level = count_sequence_block_matches(ublocks, cblocks, False)
                                correct_block_ids = collect_matching_user_block_ids(ublocks, cblocks, False)
                                total_correct_blocks += correct_in_level
                                correct_blocks_by_level[cid] = correct_block_ids
                                if correct_in_level > 0:
                                    # Есть правильно размещенные блоки, но не все
                                    incorrect_level_ids.append(cid)
                                else:
                                    # Нет правильно размещенных блоков или есть неправильные
                                    incorrect_level_ids.append(cid)
                    
                    # Убеждаемся, что все правильные уровни инициализированы в correct_blocks_by_level
                    for cid in correct_map.keys():
                        if cid not in correct_blocks_by_level:
                            correct_blocks_by_level[cid] = []
                    
                    # ОБНОВЛЕНИЕ: Для уровня 1 обновляем sequence_success на основе проверки блоков
                    total_correct = len(correct_levels_ref)
                    total_found = len(correct_level_ids)
                    total_user = len(user_levels)
                    
                    # ИСПРАВЛЕНИЕ: Для level_order_matters=False проверяем наличие всех уровней И правильность блоков
                    # Последовательность правильная, если:
                    # 1. Все правильные уровни присутствуют
                    # 2. Нет лишних уровней
                    # 3. Все блоки размещены правильно (все уровни в correct_level_ids, нет в incorrect_level_ids)
                    user_level_ids = [l.get('level_id', '') for l in user_levels]
                    correct_level_ids_set = {l.get('level_id', '') for l in correct_levels_ref}
                    user_level_ids_set = set(user_level_ids)
                    all_levels_present = (correct_level_ids_set == user_level_ids_set)
                    
                    # Сохраняем информацию о правильности порядка уровней для сообщения
                    levels_order_info = (all_levels_present and total_user == total_correct)
                    
                    # Успех последовательности = все правильные уровни присутствуют И нет лишних И все блоки правильные
                    sequence_success = (
                        all_levels_present and 
                        total_user == total_correct and 
                        len(correct_level_ids) == total_correct and
                        len(incorrect_level_ids) == 0
                    )
                    
                    logger.debug(f"[SequenceEval Level1] === РЕЗУЛЬТАТ ПРОВЕРКИ БЛОКОВ ===")
                    logger.debug(f"[SequenceEval Level1] user_level_ids={user_level_ids}, correct_level_ids_set={correct_level_ids_set}")
                    logger.debug(f"[SequenceEval Level1] all_levels_present={all_levels_present}")
                    logger.debug(f"[SequenceEval Level1] total_correct={total_correct}, total_found={total_found}, "
                               f"total_user={total_user}, incorrect_count={len(incorrect_level_ids)}, sequence_success={sequence_success}")
                    logger.debug(f"[SequenceEval Level1] correct_level_ids: {correct_level_ids}")
                    logger.debug(f"[SequenceEval Level1] incorrect_level_ids: {incorrect_level_ids}")
                    logger.debug(f"[SequenceEval Level1] total_correct_blocks={total_correct_blocks}, total_blocks_in_levels={total_blocks_in_levels}")
                    logger.debug(f"[SequenceEval Level1] correct_blocks_by_level: {correct_blocks_by_level}")

            # УРОВЕНЬ 2-3: проверка названий уровней
            level_names_result = None
            if requires_level_names:
                sequence_within_level_matters = normalized.get('sequence_within_level_matters', False)
                # Для уровней 2-3: названия проверяем только после structural matching.
                if level_mapping is not None:
                    level_names_result = self._evaluate_level_names(
                        user_levels, correct_levels_ref, sequence_within_level_matters,
                        level_mapping=level_mapping
                    )
                else:
                    level_names_result = self._evaluate_level_names(user_levels, correct_levels_ref, sequence_within_level_matters)
            
            # УРОВЕНЬ 3: проверка названий блоков
            block_names_result = None
            if requires_block_names:
                # Обогащаем correct_levels_ref правильными названиями блоков из elements
                if element_text_map:
                    logger.debug(f"[BlockNamesEval] Обогащаем correct_levels правильными названиями блоков")
                    logger.debug(f"[BlockNamesEval] element_text_map содержит {len(element_text_map)} элементов")
                    # Создаем копию correct_levels_ref для обогащения (не изменяем оригинал)
                    enriched_correct_levels = []
                    for level in correct_levels_ref:
                        level_copy = dict(level)  # Копируем уровень
                        blocks = level_copy.get('blocks', [])
                        # Создаем block_names на основе blocks и element_text_map
                        block_names = {}
                        for block_id in blocks:
                            if block_id in element_text_map:
                                block_names[block_id] = element_text_map[block_id]
                        level_copy['block_names'] = block_names
                        enriched_correct_levels.append(level_copy)
                        logger.debug(f"[BlockNamesEval] level_id={level_copy.get('level_id', '')}, block_names={block_names}")
                    
                    block_names_result = self._evaluate_block_names(
                        user_levels,
                        enriched_correct_levels,
                        level_mapping=level_mapping,
                        sequence_within_level_matters=sequence_within_level_matters
                    )
                else:
                    # Если elements не найдены, используем оригинальные correct_levels_ref
                    logger.debug(f"[BlockNamesEval] elements не найдены, используем оригинальные correct_levels_ref")
                    block_names_result = self._evaluate_block_names(
                        user_levels,
                        correct_levels_ref,
                        level_mapping=level_mapping,
                        sequence_within_level_matters=sequence_within_level_matters
                    )
            
            # Определяем успешность: последовательность И названия (если требуются)
            # Для уровня 2: sequence_success уже определен на основе сопоставления по содержимому
            if sequence_success is None:
                # Fallback: если sequence_success не был определен (не должно происходить)
                sequence_success = False
            
            combined_success = (
                sequence_success and
                (not requires_level_names or level_names_result['success'] if level_names_result else True) and
                (not requires_block_names or block_names_result['success'] if block_names_result else True)
            )
            
            # Формируем сообщение
            if combined_success:
                message = "✅ Правильно! Все уровни собраны корректно"
                if level_names_result:
                    message += f". {level_names_result['message']}"
                if block_names_result:
                    message += f". {block_names_result['message']}"
            else:
                total_cnt = len(correct_levels_ref)
                # ДОБАВЛЕНО: Логируем levels_order_info перед формированием сообщения
                logger.debug(f"[SequenceEval] Перед формированием сообщения: levels_order_info={levels_order_info}, level_order_matters={level_order_matters}, requires_level_names={requires_level_names}, total_blocks_in_levels={total_blocks_in_levels}")
                # В ветках "проверьте блоки" correct_level_ids считает только полностью собранные
                # уровни (включая все блоки внутри). Если порядок/наличие уровней уже подтвержден
                # отдельно через levels_order_info, показываем это в тексте как все уровни
                # правильные, чтобы не получать противоречие вида
                # "Последовательность уровней правильная" + "1/5 уровней правильно".
                block_feedback_level_count = total_cnt if levels_order_info else len(correct_level_ids)
                
                # Для уровня 1 показываем количество правильных блоков
                if not requires_level_names and total_blocks_in_levels > 0:
                    # ИСПРАВЛЕНИЕ: Разделяем сообщения для последовательности и блоков
                    if levels_order_info:
                        # Последовательность правильная, но блоки неправильные
                        if level_order_matters:
                            message = f"✅ Последовательность уровней правильная, но проверьте блоки ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                        else:
                            message = f"✅ Все уровни присутствуют, но проверьте блоки ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                    else:
                        # Последовательность неправильная
                        message = f"❌ Проверьте последовательность ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                else:
                    # Для уровня 2-3 (requires_level_names=True)
                    # ИСПРАВЛЕНИЕ: Показываем информацию о блоках, если они были подсчитаны
                    if total_blocks_in_levels > 0:
                        # Есть информация о блоках - показываем её
                        if levels_order_info:
                            if level_order_matters:
                                message = f"✅ Последовательность уровней правильная, но проверьте блоки ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                            else:
                                message = f"✅ Все уровни присутствуют, но проверьте блоки ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                        else:
                            message = f"❌ Проверьте последовательность ({block_feedback_level_count}/{total_cnt} уровней правильно, {total_correct_blocks}/{total_blocks_in_levels} блоков правильно)"
                    else:
                        # Нет информации о блоках - показываем только уровни
                        if levels_order_info:
                            if level_order_matters:
                                message = f"✅ Последовательность уровней правильная, но проверьте уровни ({len(correct_level_ids)}/{total_cnt} уровней правильно)"
                            else:
                                message = f"✅ Все уровни присутствуют, но проверьте уровни ({len(correct_level_ids)}/{total_cnt} уровней правильно)"
                        else:
                            message = f"❌ Проверьте последовательность ({len(correct_level_ids)}/{total_cnt} уровней правильно)"
                
                # ДОБАВЛЕНО: Логируем сформированное сообщение
                logger.debug(f"[SequenceEval] Сформированное сообщение: {message}")
                
                if level_names_result and not level_names_result['success']:
                    message += f". {level_names_result['message']}"
                if block_names_result and not block_names_result['success']:
                    # ИСПРАВЛЕНИЕ: Для уровня 3 используем total_blocks_in_levels вместо total_blocks из block_names_result
                    # так как total_blocks в block_names_result может быть меньше (только для сопоставленных уровней)
                    if requires_block_names and total_blocks_in_levels > 0:
                        matched_blocks_count = len(block_names_result.get('matched_blocks', []))
                        message += f". ❌ Не все названия блоков правильные ({matched_blocks_count}/{total_blocks_in_levels})"
                    else:
                        message += f". {block_names_result['message']}"
                
                # ДОБАВЛЕНО: Логируем финальное сообщение после добавления level_names и block_names
                logger.debug(f"[SequenceEval] Финальное сообщение: {message}")

            # Определяем levels_order_correct для передачи в details
            levels_order_correct_value = None
            if level_order_matters:
                # Для level_order_matters=True: levels_order_correct уже определен выше
                if 'levels_order_correct' in locals():
                    levels_order_correct_value = levels_order_correct
            else:
                # Для level_order_matters=False: используем all_levels_present
                if 'all_levels_present' in locals():
                    levels_order_correct_value = all_levels_present
            
            details = {
                'correct_levels': correct_level_ids,
                'incorrect_levels': incorrect_level_ids,
                'level_names_map': level_names_map,  # Карта для отображения названий
                'evaluator_result': result,
                'total_levels': len(correct_levels_ref),
                'sequence_success': sequence_success,  # Информация о последовательности
                'levels_order_correct': levels_order_correct_value  # ДОБАВЛЕНО: Информация о правильности порядка уровней
            }
            
            # Для уровня 1-2 добавляем информацию о правильно размещенных блоках
            if total_blocks_in_levels > 0:
                details['total_correct_blocks'] = total_correct_blocks
                details['total_blocks_in_levels'] = total_blocks_in_levels
                # Добавляем информацию о правильных блоках по уровням (для визуализации)
                # Преобразуем sets в lists для JSON-совместимости
                correct_blocks_by_level_serializable = {
                    level_id: (
                        list(blocks_list)
                        if isinstance(blocks_list, (list, tuple, set))
                        else []
                    )
                    for level_id, blocks_list in correct_blocks_by_level.items()
                }
                details['correct_blocks_by_level'] = correct_blocks_by_level_serializable
            
            # Определяем уровень сложности
            if requires_block_names:
                level = 3
            elif requires_level_names:
                level = 2
            else:
                level = 1
            
            details['level'] = level
            
            if level_names_result:
                details['level_names'] = level_names_result
            if block_names_result:
                details['block_names'] = block_names_result

            sequence_tolerance_matches = []
            if level_names_result:
                for level_id, user_name, correct_name in level_names_result.get('matched_levels', []):
                    match_info = self._compare_named_text(user_name, correct_name)
                    if match_info is None or (match_info.get('type') == 'exact' and not match_info.get('normalized_kinds')):
                        continue
                    sequence_tolerance_matches.append({
                        'level_id': level_id,
                        'type': match_info.get('type', 'exact'),
                        'user_answer': user_name,
                        'correct_answer': correct_name,
                        'normalized_kinds': list(match_info.get('normalized_kinds', []))
                        if isinstance(match_info.get('normalized_kinds'), list)
                        else [],
                    })
            if block_names_result:
                for level_id, block_id, user_name, correct_name in block_names_result.get('matched_blocks', []):
                    match_info = self._compare_named_text(user_name, correct_name)
                    if match_info is None or (match_info.get('type') == 'exact' and not match_info.get('normalized_kinds')):
                        continue
                    sequence_tolerance_matches.append({
                        'level_id': level_id,
                        'block_id': block_id,
                        'type': match_info.get('type', 'exact'),
                        'user_answer': user_name,
                        'correct_answer': correct_name,
                        'normalized_kinds': list(match_info.get('normalized_kinds', []))
                        if isinstance(match_info.get('normalized_kinds'), list)
                        else [],
                    })

            sequence_tolerance_summary = self._summarize_tolerance_matches(sequence_tolerance_matches)
            if sequence_tolerance_summary.get('has_tolerance'):
                details['tolerance_matches'] = sequence_tolerance_summary.get('matches', [])
                details['tolerance_type'] = sequence_tolerance_summary.get('tolerance_type')
                details['normalization_kinds'] = sequence_tolerance_summary.get('normalization_kinds', [])
                details['tolerance_explanation'] = self._build_tolerance_explanation('Название', sequence_tolerance_summary)
            
            # Добавляем данные для визуализации схемы
            # Обогащенные правильные уровни с block_names (для визуализации)
            if requires_block_names and element_text_map:
                enriched_correct_levels_for_viz = []
                for level in correct_levels_ref:
                    level_copy = dict(level)
                    blocks = level_copy.get('blocks', [])
                    block_names = {}
                    for block_id in blocks:
                        if block_id in element_text_map:
                            block_names[block_id] = element_text_map[block_id]
                    level_copy['block_names'] = block_names
                    enriched_correct_levels_for_viz.append(level_copy)
                details['correct_levels_data'] = enriched_correct_levels_for_viz
            else:
                # Для уровней 1-2 используем оригинальные correct_levels_ref
                details['correct_levels_data'] = correct_levels_ref
            
            # Данные пользователя (для сравнения)
            details['user_levels_data'] = user_levels
            
            # Данные элементов (для отображения названий блоков)
            if element_text_map:
                elements_list = []
                for element in (elements or []):
                    if isinstance(element, dict):
                        element_id = element.get('id')
                        element_text = element.get('text', '')
                        if element_id:
                            elements_list.append({'id': element_id, 'text': element_text})
                details['elements_data'] = elements_list
            
            # Добавляем информацию о том, что блоки отсутствуют, но названия правильные
            if requires_level_names and level_names_result:
                # Проверяем, есть ли уровни с правильными названиями, но пустыми блоками
                user_levels_with_empty_blocks = []
                matched_levels = level_names_result.get('matched_levels', [])
                
                # Создаем множество правильных названий из matched_levels
                matched_names = set()
                for match in matched_levels:
                    if len(match) >= 2:
                        matched_names.add(match[1])  # user_name
                
                # Проверяем уровни пользователя
                for user_level in user_levels:
                    user_blocks = user_level.get('blocks', [])
                    user_name = user_level.get('level_name', '').strip()
                    
                    # Если блоки пустые И название правильное
                    if len(user_blocks) == 0 and user_name and user_name in matched_names:
                        user_levels_with_empty_blocks.append(user_name)
                
                if user_levels_with_empty_blocks:
                    details['names_correct_but_blocks_empty'] = user_levels_with_empty_blocks
                    logger.debug(f"[SequenceEval] Найдены уровни с правильными названиями, но пустыми блоками: {user_levels_with_empty_blocks}")

            # НОВОЕ: Расчет совокупного скора
            if level == 1:
                score = (total_correct_blocks / total_blocks_in_levels * 100.0) if total_blocks_in_levels > 0 else 0.0
            elif level == 2:
                # 70% блоки, 30% названия уровней
                block_score = (total_correct_blocks / total_blocks_in_levels * 70.0) if total_blocks_in_levels > 0 else 0.0
                level_names_item_score = (level_names_result['score'] * 0.3) if level_names_result else 0.0
                score = block_score + level_names_item_score
            else: # level == 3
                # 70% блоки, 15% названия уровней, 15% названия блоков
                block_pos_score = (total_correct_blocks / total_blocks_in_levels * 70.0) if total_blocks_in_levels > 0 else 0.0
                level_names_item_score = (level_names_result['score'] * 0.15) if level_names_result else 0.0
                block_names_item_score = (block_names_result['score'] * 0.15) if block_names_result else 0.0
                score = block_pos_score + level_names_item_score + block_names_item_score

            return EvaluationResult(
                success=combined_success,
                message=message,
                score=score,
                metric="percent",
                details=details
            )
            
        except Exception as e:
            logger.exception(f"Ошибка оценки sequence task")
            raise EvaluationError(
                f"Ошибка при проверке sequence task: {e}",
                details={'error': str(e), 'error_type': type(e).__name__}
            ) from e
    
    # =========================================================================
    # TEST TASK EVALUATION
    # =========================================================================
    
    def _format_test_result_message(self, correct_count: int, total_count: int) -> str:
        """Build a clear summary for TEST results."""
        if total_count <= 0:
            return "❌ Проверьте ответы"

        if correct_count >= total_count:
            return f"✅ Правильно! {correct_count}/{total_count} ответов"

        incorrect_count = max(0, total_count - correct_count)
        return (
            f"❌ Есть ошибки: {incorrect_count} из {total_count} с ошибкой, "
            f"верно {correct_count}"
        )

    @staticmethod
    def _is_image_only_test_question(question: Dict[str, Any]) -> bool:
        if not isinstance(question, dict):
            return False

        answers = question.get("answers")
        if not isinstance(answers, list) and isinstance(question.get("content"), dict):
            answers = question.get("content", {}).get("answers")
        if not isinstance(answers, list) or not answers:
            return False

        def _has_image(answer: Any) -> bool:
            if not isinstance(answer, dict):
                return False
            image_meta = answer.get("image")
            return bool(
                answer.get("image_path")
                or answer.get("image_url")
                or (isinstance(image_meta, dict) and image_meta.get("url"))
                or (isinstance(image_meta, dict) and image_meta.get("path"))
            )

        return all(_has_image(answer) for answer in answers)

    def _should_use_level2_test_mode(
        self,
        *,
        requires_text_input: bool,
        show_options: bool,
        difficulty: Any,
        questions: List[Dict[str, Any]],
    ) -> bool:
        if requires_text_input or not show_options:
            return True

        if isinstance(difficulty, (int, float)) and difficulty >= 2:
            if questions and all(self._is_image_only_test_question(question) for question in questions):
                return False
            return True

        return False

    def evaluate_test_task(
        self,
        user_input: Dict[str, Any],
        answer_key: Dict[str, Any],
        task_data: Optional[Dict[str, Any]] = None,
    ) -> EvaluationResult:
        """Оценка Test задания (тестовые вопросы с вариантами ответов).

        Уровни:
        - level 1: multiple choice (варианты ответов)
        - level 2: открытые ответы (text_answers)
        """

        try:
            # Определяем режим (multiple choice vs text)
            content = task_data.get("content", {}) if task_data else {}
            requires_text_input = content.get("requires_text_input", False)
            show_options = content.get("show_options", True)

            # Синхронизация с frontend: difficulty >= 2 обычно активирует Level 2 (open text),
            # кроме чисто картинных тестов, которые остаются в вариантах ответа.
            difficulty = None
            if task_data:
                difficulty = task_data.get("settings", {}).get("difficulty")
                if difficulty is None:
                    difficulty = content.get("difficulty")

            # Получаем список вопросов из разных возможных мест
            questions = answer_key.get("questions", [])
            if not questions:
                questions = answer_key.get("content", {}).get("questions", [])
            if not questions and "task_data" in answer_key:
                questions = answer_key["task_data"].get("questions", [])
            if not questions and task_data:
                questions = (
                    task_data.get("content", {}).get("questions", [])
                    or task_data.get("questions", [])
                )

            if not questions:
                return EvaluationResult(
                    success=False,
                    message="❌ Нет вопросов в тесте",
                    score=0.0,
                    metric="percent",
                    details={"error": "no_questions"},
                )

            is_level2 = self._should_use_level2_test_mode(
                requires_text_input=requires_text_input,
                show_options=show_options,
                difficulty=difficulty,
                questions=questions,
            )

            answers_in = user_input.get("answers", {})
            text_answers_in = user_input.get("text_answers", {})
            answers = {str(k): v for k, v in answers_in.items()}
            text_answers = {str(k): v for k, v in text_answers_in.items()}

            def _extract_answer_options(question: Dict[str, Any]) -> List[Dict[str, Any]]:
                answer_options = question.get("answers")
                if not isinstance(answer_options, list) and isinstance(
                    question.get("content"), dict
                ):
                    answer_options = question.get("content", {}).get("answers")
                if not isinstance(answer_options, list):
                    return []
                return [answer for answer in answer_options if isinstance(answer, dict)]

            def _evaluate_choice_question(
                question: Dict[str, Any], fallback_index: int
            ) -> Dict[str, Any]:
                qid_raw = question.get("id")
                qid = str(qid_raw) if qid_raw is not None else str(fallback_index)
                answer_options = _extract_answer_options(question)

                raw_answer = answers.get(qid) if qid in answers else answers.get(qid_raw)
                if raw_answer is None:
                    try:
                        qid_int = int(qid)
                        raw_answer = answers.get(qid_int)
                    except Exception:
                        raw_answer = None

                correct_option_indices = [
                    i for i, ans in enumerate(answer_options) if ans.get("correct", False)
                ]

                if raw_answer is None:
                    return {
                        "correct": False,
                        "question_result": {
                            "question_id": qid,
                            "correct": False,
                            "reason": "not_answered",
                        },
                        "per_question": {
                            "status": "unanswered",
                            "correct_option_ids": correct_option_indices,
                            "user_option_ids": [],
                        },
                    }

                candidate_indices: List[int] = []
                if isinstance(raw_answer, (list, tuple)):
                    for answer_value in raw_answer:
                        if isinstance(answer_value, (int, float)):
                            candidate_indices.append(int(answer_value))
                        elif isinstance(answer_value, str) and answer_value.isdigit():
                            candidate_indices.append(int(answer_value))
                else:
                    if isinstance(raw_answer, str):
                        if raw_answer.startswith("answer_"):
                            try:
                                candidate_indices.append(int(raw_answer.split("_")[1]))
                            except Exception:
                                pass
                        else:
                            raw_norm = raw_answer.strip().lower()
                            for option_index, answer_option in enumerate(answer_options):
                                option_text = str(
                                    answer_option.get("text")
                                    or answer_option.get("label")
                                    or ""
                                ).strip()
                                if option_text.lower() == raw_norm:
                                    candidate_indices.append(option_index)
                                    break
                    elif isinstance(raw_answer, (int, float)):
                        candidate_indices.append(int(raw_answer))

                if not candidate_indices:
                    return {
                        "correct": False,
                        "question_result": {
                            "question_id": qid,
                            "correct": False,
                            "reason": "not_answered",
                        },
                        "per_question": {
                            "status": "unanswered",
                            "correct_option_ids": correct_option_indices,
                            "user_option_ids": [],
                        },
                    }

                valid_user_indices = [
                    option_index
                    for option_index in candidate_indices
                    if 0 <= option_index < len(answer_options)
                ]

                if not valid_user_indices:
                    return {
                        "correct": False,
                        "question_result": {
                            "question_id": qid,
                            "correct": False,
                            "reason": "invalid_answer_index",
                        },
                        "per_question": {
                            "status": "incorrect",
                            "correct_option_ids": correct_option_indices,
                            "user_option_ids": candidate_indices,
                        },
                    }

                is_correct = (
                    set(valid_user_indices) == set(correct_option_indices)
                    and len(valid_user_indices) == len(correct_option_indices)
                    and len(valid_user_indices) > 0
                )

                if is_correct:
                    return {
                        "correct": True,
                        "question_result": {
                            "question_id": qid,
                            "correct": True,
                            "user_answer": valid_user_indices[0]
                            if len(valid_user_indices) == 1
                            else valid_user_indices,
                        },
                        "per_question": {
                            "status": "correct",
                            "correct_option_ids": correct_option_indices,
                            "user_option_ids": valid_user_indices,
                        },
                    }

                return {
                    "correct": False,
                    "question_result": {
                        "question_id": qid,
                        "correct": False,
                        "user_answer": valid_user_indices[0]
                        if len(valid_user_indices) == 1
                        else valid_user_indices,
                        "correct_answer": next(iter(correct_option_indices), None),
                    },
                    "per_question": {
                        "status": "incorrect",
                        "correct_option_ids": correct_option_indices,
                        "user_option_ids": valid_user_indices,
                    },
                }

            def _question_source_index(question: Dict[str, Any], fallback_index: int) -> int:
                try:
                    original_index = question.get("_partial_retry_original_index")
                except Exception:
                    original_index = None

                try:
                    return int(original_index)
                except Exception:
                    return fallback_index

            # ------------------------
            # Уровень 2: text_answers
            # ------------------------
            if is_level2:
                def _extract_reference_answer_from_question(question: Dict[str, Any]) -> str:
                    direct = str(question.get("reference_answer") or "").strip()
                    if direct:
                        return direct

                    content_ref = str(
                        (question.get("content") or {}).get("reference_answer") or ""
                    ).strip()
                    if content_ref:
                        return content_ref

                    answers_list = _extract_answer_options(question)
                    correct_texts = []
                    for answer in answers_list:
                        if not isinstance(answer, dict) or not answer.get("correct"):
                            continue
                        text = str(answer.get("text") or answer.get("label") or "").strip()
                        if text and text not in correct_texts:
                            correct_texts.append(text)
                    return "; ".join(correct_texts)

                def _extract_keywords_from_question(question: Dict[str, Any]) -> List[str]:
                    kw: List[str] = list(question.get("keywords") or [])
                    answers_list = _extract_answer_options(question)
                    correct_texts = [
                        a.get("text") or a.get("label") or ""
                        for a in answers_list
                        if a.get("correct")
                    ]
                    ref = (
                        question.get("reference_answer")
                        or question.get("content", {}).get("reference_answer", "")
                    )
                    texts = correct_texts + ([ref] if ref else [])
                    for t in texts:
                        norm = self._normalize_text_for_comparison(t)
                        if norm:
                            for w in extract_words_from_text(norm):
                                if len(w) > 1:
                                    kw.append(w)
                    seen = set()
                    uniq: List[str] = []
                    for w in kw:
                        if w not in seen:
                            seen.add(w)
                            uniq.append(w)
                    return uniq

                # Автогенерируем keywords при необходимости
                for q in questions:
                    if not q.get("keywords"):
                        q["keywords"] = _extract_keywords_from_question(q)

                has_choice_mode_questions = any(
                    self._is_image_only_test_question(question) for question in questions
                )
                has_text_mode_questions = any(
                    not self._is_image_only_test_question(question) for question in questions
                )

                if has_text_mode_questions and not has_choice_mode_questions and not text_answers:
                    return EvaluationResult(
                        success=False,
                        message="❌ Введите текстовые ответы",
                        score=0.0,
                        metric="percent",
                        details={"error": "no_text_answers", "level": 2},
                    )

                correct_count = 0
                total_count = len(questions)
                question_results: List[Dict[str, Any]] = []
                per_question: Dict[str, Any] = {}

                for idx, question in enumerate(questions):
                    qid_raw = question.get("id")
                    qid = str(qid_raw) if qid_raw is not None else str(idx)
                    if self._is_image_only_test_question(question):
                        choice_result = _evaluate_choice_question(question, idx)
                        if choice_result["correct"]:
                            correct_count += 1
                        question_results.append(choice_result["question_result"])
                        per_question[qid] = choice_result["per_question"]
                        continue
                    keywords = question.get("keywords", [])
                    reference_answer = _extract_reference_answer_from_question(question)
                    correct_answer_texts = self._extract_test_question_correct_answer_texts(question)

                    user_text = str(text_answers.get(qid, "")).strip()
                    if not user_text:
                        question_results.append(
                            {
                                "question_id": qid,
                                "correct": False,
                                "reason": "not_answered",
                            }
                        )
                        per_question[qid] = {
                            "status": "unanswered",
                            "details": {
                                "reference_answer": reference_answer,
                                "found_keywords": [],
                                "missing_keywords": list(keywords),
                            },
                        }
                        continue

                    text_result = self._evaluate_text_answer(
                        user_text, keywords, reference_answer, task_data
                    )
                    if (
                        not text_result.get("success")
                        and self._matches_test_question_answer_listing(
                            user_text,
                            correct_answer_texts,
                        )
                    ):
                        text_result = dict(text_result)
                        text_result["success"] = True
                        text_result["message"] = (
                            "✅ Правильно! Все правильные варианты перечислены в ответе."
                        )
                        text_result["found_keywords"] = list(
                            dict.fromkeys(str(keyword).strip().lower() for keyword in keywords if str(keyword).strip())
                        )
                        text_result["missing_keywords"] = []

                    if text_result["success"]:
                        correct_count += 1

                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": text_result["success"],
                            "user_answer": user_text,
                            "text_evaluation": text_result,
                        }
                    )
                    per_question[qid] = {
                        "status": "correct" if text_result["success"] else "incorrect",
                        "details": {
                            "reference_answer": reference_answer,
                            "user_answer": user_text,
                            "found_keywords": list(text_result.get("found_keywords") or []),
                            "missing_keywords": list(text_result.get("missing_keywords") or []),
                        },
                    }
                    hide_tolerance_feedback = text_result["success"] and self._should_hide_test_l2_tolerance_feedback(
                        user_text,
                        reference_answer,
                        correct_answer_texts,
                    )
                    if not hide_tolerance_feedback:
                        tolerance_type = text_result.get("tolerance_type")
                        if isinstance(tolerance_type, str) and tolerance_type.strip():
                            per_question[qid]["tolerance_type"] = tolerance_type.strip()
                        normalization_kinds = text_result.get("normalization_kinds")
                        if isinstance(normalization_kinds, list) and normalization_kinds:
                            per_question[qid]["normalization_kinds"] = list(normalization_kinds)
                        tolerance_explanation = text_result.get("tolerance_explanation")
                        if isinstance(tolerance_explanation, str) and tolerance_explanation.strip():
                            per_question[qid]["tolerance_explanation"] = tolerance_explanation.strip()

                success = correct_count == total_count
                score = (correct_count / total_count * 100.0) if total_count > 0 else 0.0
                message = self._format_test_result_message(correct_count, total_count)

                # Список заваленных вопросов (для частичного ретрая)
                failed_subtests = [
                    {
                        "question_id": qr.get("question_id"),
                        "index": _question_source_index(questions[idx], idx),
                    }
                    for idx, qr in enumerate(question_results)
                    if not qr.get("correct", False)
                ]

                return EvaluationResult(
                    success=success,
                    message=message,
                    score=score,
                    metric="percent",
                    details={
                        "correct_count": correct_count,
                        "total_count": total_count,
                        "question_results": question_results,
                        "per_question": per_question,
                        "level": 2,
                        "failed_subtests": failed_subtests,
                    },
                )

            # ------------------------
            # Уровень 1: multiple choice
            # ------------------------
            if not answers:
                return EvaluationResult(
                    success=False,
                    message="❌ Не выбраны ответы",
                    score=0.0,
                    metric="percent",
                    details={"error": "no_answers", "level": 1},
                )

            correct_count = 0
            total_count = len(questions)
            question_results: List[Dict[str, Any]] = []
            per_question: Dict[str, Any] = {}

            for idx, question in enumerate(questions):
                qid_raw = question.get("id")
                qid = str(qid_raw) if qid_raw is not None else str(idx)
                choice_result = _evaluate_choice_question(question, idx)
                if choice_result["correct"]:
                    correct_count += 1
                question_results.append(choice_result["question_result"])
                per_question[qid] = choice_result["per_question"]
                continue

                raw_answer = (
                    answers.get(qid) if qid in answers else answers.get(qid_raw)
                )
                if raw_answer is None:
                    try:
                        qid_int = int(qid)
                        raw_answer = answers.get(qid_int)
                    except Exception:
                        raw_answer = None

                if raw_answer is None:
                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": False,
                            "reason": "not_answered",
                        }
                    )
                    per_question[qid] = {
                        "status": "unanswered",
                        "correct_option_ids": [
                            i
                            for i, ans in enumerate(answer_options)
                            if ans.get("correct", False)
                        ],
                        "user_option_ids": [],
                    }
                    continue

                # Нормализуем ответ в список индексов
                candidate_indices: List[int] = []
                if isinstance(raw_answer, (list, tuple)):
                    for a in raw_answer:
                        if isinstance(a, (int, float)):
                            candidate_indices.append(int(a))
                        elif isinstance(a, str) and a.isdigit():
                            candidate_indices.append(int(a))
                else:
                    if isinstance(raw_answer, str):
                        if raw_answer.startswith("answer_"):
                            try:
                                candidate_indices.append(
                                    int(raw_answer.split("_")[1])
                                )
                            except Exception:
                                pass
                        else:
                            raw_norm = raw_answer.strip().lower()
                            for i, ans in enumerate(answer_options):
                                if (
                                    str(ans.get("text", ""))
                                    .strip()
                                    .lower()
                                    == raw_norm
                                ):
                                    candidate_indices.append(i)
                                    break
                    elif isinstance(raw_answer, (int, float)):
                        candidate_indices.append(int(raw_answer))

                if not candidate_indices:
                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": False,
                            "reason": "not_answered",
                        }
                    )
                    per_question[qid] = {
                        "status": "unanswered",
                        "correct_option_ids": [
                            i
                            for i, ans in enumerate(answer_options)
                            if ans.get("correct", False)
                        ],
                        "user_option_ids": [],
                    }
                    continue

                valid_user_indices = [
                    idx2
                    for idx2 in candidate_indices
                    if 0 <= idx2 < len(answer_options)
                ]

                if not valid_user_indices:
                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": False,
                            "reason": "invalid_answer_index",
                        }
                    )
                    per_question[qid] = {
                        "status": "incorrect",
                        "correct_option_ids": [
                            i
                            for i, ans in enumerate(answer_options)
                            if ans.get("correct", False)
                        ],
                        "user_option_ids": candidate_indices,
                    }
                    continue

                correct_option_indices = [
                    i for i, ans in enumerate(answer_options) if ans.get("correct", False)
                ]

                is_correct = (
                    set(valid_user_indices) == set(correct_option_indices)
                    and len(valid_user_indices) == len(correct_option_indices)
                    and len(valid_user_indices) > 0
                )

                if is_correct:
                    correct_count += 1
                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": True,
                            "user_answer": valid_user_indices[0]
                            if len(valid_user_indices) == 1
                            else valid_user_indices,
                        }
                    )
                    per_question[qid] = {
                        "status": "correct",
                        "correct_option_ids": correct_option_indices,
                        "user_option_ids": valid_user_indices,
                    }
                else:
                    correct_index = next(
                        (
                            i
                            for i, ans in enumerate(answer_options)
                            if ans.get("correct", False)
                        ),
                        None,
                    )
                    question_results.append(
                        {
                            "question_id": qid,
                            "correct": False,
                            "user_answer": valid_user_indices[0]
                            if len(valid_user_indices) == 1
                            else valid_user_indices,
                            "correct_answer": correct_index,
                        }
                    )
                    per_question[qid] = {
                        "status": "incorrect",
                        "correct_option_ids": correct_option_indices,
                        "user_option_ids": valid_user_indices,
                    }

            success = correct_count == total_count
            score = (correct_count / total_count * 100.0) if total_count > 0 else 0.0
            message = self._format_test_result_message(correct_count, total_count)

            # Список заваленных вопросов (для частичного ретрая)
            failed_subtests = [
                {
                    "question_id": qr.get("question_id"),
                    "index": _question_source_index(questions[idx], idx),
                }
                for idx, qr in enumerate(question_results)
                if not qr.get("correct", False)
            ]

            return EvaluationResult(
                success=success,
                message=message,
                score=score,
                metric="percent",
                details={
                    "correct_count": correct_count,
                    "total_count": total_count,
                    "question_results": question_results,
                    "per_question": per_question,
                    "level": 1,
                    "failed_subtests": failed_subtests,
                },
            )

        except Exception as e:
            logger.exception("Ошибка оценки test task")
            raise EvaluationError(
                f"Ошибка при проверке теста: {e}",
                details={"error": str(e), "error_type": type(e).__name__},
            ) from e


# Экспортируемые классы
__all__ = ['TaskEvaluatorService', 'EvaluationResult']
