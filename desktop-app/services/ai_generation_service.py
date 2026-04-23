"""
AI Generation Service — провайдеры LLM и сервис генерации заданий.

Реализует цепочку фолбеков OpenRouter → Gemini → Groq → ручной режим.
Все API-ключи хранятся в серверном конфиге ai_config.json.
"""

import json
import logging
import math
import os
import re
import time
import threading
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from services.analysis_capability_matrix import apply_capability_matrix_v1_annotations
from services.analysis_schema_v2 import normalize_analysis_schema_v2

logger = logging.getLogger(__name__)


_AI_ENV_PROVIDER_NAMES = ("openrouter", "gemini", "groq", "mock")


def _env_bool(name: str, default: Optional[bool] = None) -> Optional[bool]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: Optional[int] = None) -> Optional[int]:
    raw = os.environ.get(name)
    if raw is None:
        return default
    try:
        return int(str(raw).strip())
    except Exception:
        return default


def _warn_on_file_based_provider_secrets(config: Dict[str, Any], config_path: Path) -> None:
    providers_cfg = config.get("providers", {})
    if not isinstance(providers_cfg, dict):
        return

    warned = False
    for provider_name in ("openrouter", "gemini", "groq"):
        provider_cfg = providers_cfg.get(provider_name, {})
        if not isinstance(provider_cfg, dict):
            continue
        api_key = str(provider_cfg.get("api_key") or "").strip()
        if api_key:
            warned = True
            logger.warning(
                "[AI] %s api_key is loaded from %s. Hosted deployments should use env secrets instead.",
                provider_name,
                config_path,
            )

    if warned:
        logger.warning(
            "[AI] File-based provider secrets are legacy-only and should not be used as the hosted source of truth."
        )


def _apply_env_ai_config_overrides(config: Dict[str, Any]) -> Dict[str, Any]:
    resolved: Dict[str, Any] = dict(config or {})
    providers_cfg = resolved.get("providers", {})
    if not isinstance(providers_cfg, dict):
        providers_cfg = {}
    else:
        providers_cfg = {
            str(name): (dict(value) if isinstance(value, dict) else {})
            for name, value in providers_cfg.items()
        }

    timeout_seconds = _env_int("ACTRA_AI_TIMEOUT_SECONDS", None)
    if timeout_seconds is not None:
        resolved["timeout_seconds"] = timeout_seconds

    fallback_order_raw = str(os.environ.get("ACTRA_AI_FALLBACK_ORDER") or "").strip()
    if fallback_order_raw:
        resolved["fallback_order"] = [
            item.strip().lower()
            for item in fallback_order_raw.split(",")
            if item.strip()
        ]

    for provider_name in _AI_ENV_PROVIDER_NAMES:
        provider_cfg = providers_cfg.get(provider_name, {})
        env_prefix = f"ACTRA_AI_{provider_name.upper()}_"

        enabled = _env_bool(f"{env_prefix}ENABLED", None)
        api_key_raw = os.environ.get(f"{env_prefix}API_KEY")
        model_raw = os.environ.get(f"{env_prefix}MODEL")
        fallback_models_raw = os.environ.get(f"{env_prefix}FALLBACK_MODELS")

        if enabled is not None:
            provider_cfg["enabled"] = enabled

        if api_key_raw is not None:
            api_key = str(api_key_raw).strip()
            provider_cfg["api_key"] = api_key
            if api_key and enabled is None:
                provider_cfg["enabled"] = True

        if model_raw is not None:
            provider_cfg["model"] = str(model_raw).strip()

        if fallback_models_raw is not None:
            provider_cfg["fallback_models"] = [
                item.strip()
                for item in str(fallback_models_raw).split(",")
                if item.strip()
            ]

        if provider_cfg:
            providers_cfg[provider_name] = provider_cfg

    resolved["providers"] = providers_cfg
    return resolved

# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class AnalysisResult:
    """Результат анализа материала (нулевой промпт)."""

    human_summary: str = ""
    recommendations: List[Dict[str, Any]] = field(default_factory=list)
    educational_units: List[Dict[str, Any]] = field(default_factory=list)
    not_recommended: List[Dict[str, Any]] = field(default_factory=list)
    illustrations_detected: bool = False
    illustrations_note: Optional[str] = None
    warnings: List[str] = field(default_factory=list)
    material_volume: str = "medium"
    target_language: Optional[str] = None
    analysis_schema_version: Optional[str] = None
    capability_matrix_version: Optional[str] = None
    capability_matrix_validation: Optional[Dict[str, Any]] = None
    learning_chunks: List[Dict[str, Any]] = field(default_factory=list)
    type_progression_suitability: List[Dict[str, Any]] = field(default_factory=list)
    authoring_routes: List[Dict[str, Any]] = field(default_factory=list)
    coverage_plan: Dict[str, Any] = field(default_factory=dict)
    future_capabilities: List[Dict[str, Any]] = field(default_factory=list)
    microcards_candidates: List[Dict[str, Any]] = field(default_factory=list)
    report_blocks_version: Optional[str] = None
    report_blocks: List[Dict[str, Any]] = field(default_factory=list)
    report_lint: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "human_summary": self.human_summary,
            "recommendations": self.recommendations,
            "educational_units": self.educational_units,
            "not_recommended": self.not_recommended,
            "illustrations_detected": self.illustrations_detected,
            "illustrations_note": self.illustrations_note,
            "warnings": self.warnings,
            "material_volume": self.material_volume,
            "target_language": self.target_language,
            "analysis_schema_version": self.analysis_schema_version,
            "capability_matrix_version": self.capability_matrix_version,
            "capability_matrix_validation": self.capability_matrix_validation,
            "learning_chunks": self.learning_chunks,
            "type_progression_suitability": self.type_progression_suitability,
            "authoring_routes": self.authoring_routes,
            "coverage_plan": self.coverage_plan,
            "future_capabilities": self.future_capabilities,
            "microcards_candidates": self.microcards_candidates,
            "report_blocks_version": self.report_blocks_version,
            "report_blocks": self.report_blocks,
            "report_lint": self.report_lint,
        }


@dataclass
class ValidationResult:
    """Результат валидации файла."""

    valid: bool = True
    error_message: Optional[str] = None
    word_count: int = 0
    warnings: List[str] = field(default_factory=list)


class AnalysisParseError(ValueError):
    """Raised when AI analysis response cannot be parsed into structured JSON."""

    def __init__(
        self,
        message: str,
        raw_text: str = "",
        provider_name: Optional[str] = None,
    ) -> None:
        super().__init__(message)
        self.raw_text = raw_text
        self.provider_name = provider_name


# ---------------------------------------------------------------------------
# Abstract provider
# ---------------------------------------------------------------------------


class AIProviderBase(ABC):
    """Абстракция над LLM-провайдером."""

    def __init__(self, name: str, api_key: str, model: str, timeout: int = 60):
        self.name = name
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    @abstractmethod
    def _build_request(self, prompt: str, material: str) -> Request:
        """Построить urllib Request для конкретного API."""
        ...

    @abstractmethod
    def _extract_text(self, response_data: dict) -> str:
        """Извлечь текст ответа из JSON тела ответа API."""
        ...

    def send_message(self, prompt: str, material: str) -> str:
        """Отправить сообщение и получить текстовый ответ."""
        req = self._build_request(prompt, material)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read().decode("utf-8")
                data = json.loads(raw)
                return self._extract_text(data)
        except HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="replace")[:500]
            except Exception:
                pass
            logger.error(
                "[AI] %s HTTP %s: %s body=%s",
                self.name, e.code, e.reason, body,
            )
            raise
        except (URLError, TimeoutError, OSError) as e:
            logger.error("[AI] %s network error: %s", self.name, e)
            raise

    def is_available(self) -> bool:
        """Лёгкая проверка доступности провайдера (ping)."""
        try:
            req = self._build_ping_request()
            with urlopen(req, timeout=10) as resp:
                return resp.status < 400
        except Exception as e:
            logger.warning("[AI] %s ping failed: %s", self.name, e)
            return False

    @abstractmethod
    def _build_ping_request(self) -> Request:
        """Построить лёгкий запрос для проверки доступности."""
        ...


# ---------------------------------------------------------------------------
# Concrete providers
# ---------------------------------------------------------------------------


class OpenRouterProvider(AIProviderBase):
    """OpenRouter API — основной провайдер."""

    API_URL = "https://openrouter.ai/api/v1/chat/completions"

    def __init__(self, api_key: str, model: str = "google/gemma-3-27b-it:free", timeout: int = 60):
        super().__init__("openrouter", api_key, model, timeout)

    def _build_request(self, prompt: str, material: str) -> Request:
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": material},
            ],
            "temperature": 0.3,
            "max_tokens": 8192,
        }).encode("utf-8")
        req = Request(self.API_URL, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        req.add_header("HTTP-Referer", "https://actra.app")
        req.add_header("X-Title", "ACTRA")
        return req

    def _extract_text(self, response_data: dict) -> str:
        msg = response_data["choices"][0]["message"]
        content = msg.get("content", "")
        if not content:
            content = msg.get("reasoning", "")
        return content or ""

    def _build_ping_request(self) -> Request:
        req = Request("https://openrouter.ai/api/v1/models", method="GET")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        return req


class GeminiProvider(AIProviderBase):
    """Google Gemini Free API — запасной провайдер №1."""

    API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash-lite", timeout: int = 60):
        super().__init__("gemini", api_key, model, timeout)

    def _build_request(self, prompt: str, material: str) -> Request:
        url = f"{self.API_BASE}/{self.model}:generateContent?key={self.api_key}"
        body = json.dumps({
            "contents": [{
                "parts": [{"text": f"{prompt}\n\n{material}"}]
            }],
            "generationConfig": {
                "temperature": 0.3,
                "maxOutputTokens": 16384,
            },
        }).encode("utf-8")
        req = Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        return req

    def _extract_text(self, response_data: dict) -> str:
        return response_data["candidates"][0]["content"]["parts"][0]["text"]

    def _build_ping_request(self) -> Request:
        url = f"{self.API_BASE}?key={self.api_key}"
        return Request(url, method="GET")


class GroqProvider(AIProviderBase):
    """Groq API — запасной провайдер №2."""

    API_URL = "https://api.groq.com/openai/v1/chat/completions"

    def __init__(self, api_key: str, model: str = "llama-3.1-70b-versatile", timeout: int = 60):
        super().__init__("groq", api_key, model, timeout)

    def _build_request(self, prompt: str, material: str) -> Request:
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": material},
            ],
            "temperature": 0.3,
            "max_tokens": 8192,
        }).encode("utf-8")
        req = Request(self.API_URL, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        return req

    def _extract_text(self, response_data: dict) -> str:
        return response_data["choices"][0]["message"]["content"]

    def _build_ping_request(self) -> Request:
        req = Request("https://api.groq.com/openai/v1/models", method="GET")
        req.add_header("Authorization", f"Bearer {self.api_key}")
        return req

class MockProvider(AIProviderBase):
    """Mock Provider for E2E Testing."""
    def __init__(self, api_key: str = "test", model: str = "mock", timeout: int = 60):
        super().__init__("mock", api_key, model, timeout)
    
    def _build_request(self, prompt: str, material: str) -> Request:
        pass
    
    def _extract_text(self, response_data: dict) -> str:
        pass
        
    def _build_ping_request(self) -> Request:
        pass
        
    def send_message(self, prompt: str, material: str) -> str:
        import time
        time.sleep(1) # Fake delay
        
        if "Анализ материала" in prompt or "образовательные единицы" in prompt:
            return json.dumps({
                "human_summary": "Test Summary",
                "recommendations": [{"task_type": "TEST", "count": 2, "priority": "high", "covers_units": [], "rationale": "mock"}],
                "educational_units": [],
                "not_recommended": [],
                "illustrations_detected": False,
                "warnings": [],
                "material_volume": "medium"
            })
        else:
            return "@TEST\n# Test 1\n? Вопрос?\n+ Да\n- Нет\n- Нет\n- Нет\n\n@TEST\n# Test 2\n? Второй?\n+ Да\n- Нет\n- Нет\n- Нет"
            
    def is_available(self) -> bool:
        return True


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

_PROVIDER_CLASSES = {
    "openrouter": OpenRouterProvider,
    "gemini": GeminiProvider,
    "groq": GroqProvider,
    "mock": MockProvider,
}


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------

STRUCTURED_ANALYSIS_PROMPT = r"""Ты — старший методист и эксперт по педагогическому дизайну. Проанализируй учебный материал.

<goal>
Твоя главная цель — не назначать количество заданий. Построй методическую карту материала: выдели образовательные единицы и покажи, как существующие типы заданий можно применять к ним максимально эффективно, разнообразно и практично.
</goal>

<task>
Выполни 4 действия:
1. Выдели образовательные единицы — термины, понятия, факты, критерии, процессы, структуры, визуальные ориентиры и умения, которые студент должен усвоить.
2. Для каждой единицы определи, что именно нужно проверить: узнавание, различение, объяснение, структурирование, обнаружение ошибки, визуальное распознавание, интерпретацию или применение.
3. Для каждого доступного типа задания оцени, как его можно применить к этому материалу: какие единицы он покрывает, какой когнитивный угол закрывает, на какие опоры материала должен опираться и какие конкретные design candidates можно из него собрать.
4. Верни строгий структурированный ответ только в блоках <human_summary> и <analysis_json>.
</task>

<coverage_policy>
Принципы принятия решений:
- Не оценивай материал по объёму текста и не начинай анализ с количества заданий.
- Главный результат анализа — карта образовательных единиц и способов применения типов заданий, а не числовой план.
- Каждая существенная единица должна быть связана хотя бы с одним подходящим типом задания.
- Many-to-many покрытие допустимо и желательно: одна единица может осмысленно входить в несколько типов, если они проверяют её с разных сторон.
- В первую очередь показывай, как тип работает на этом материале: какие anchors он использует, какие ошибки, различия, структуры, критерии или визуальные признаки проверяет и какие конкретные заготовки заданий из этого следуют.
- Не отвергай тип преждевременно, если его можно применить творчески, но всё ещё строго по материалу.
- Если тип всё же не подходит, объясни это через особенности материала, а не через общие фразы.
- Поле count допустимо только как вторичная техническая подсказка для downstream-генерации; оно не должно быть главным выводом анализа и не должно определяться по длине текста.
</coverage_policy>

<available_task_types>
OPEN_ANSWER — свободный ответ своими словами.
  Лучше всего подходит для: объяснения понятий, причинно-следственных связей, механизмов, сравнений, интерпретации, аргументации.
  Не лучший выбор для: простых одиночных фактов, терминов или числовых данных, которые эффективнее проверяются компактными форматами.

SEQUENCE — сборка правильной структуры перетаскиванием элементов.
  Подходит для: хронологии, алгоритмов, стадий процесса, классификации по группам, иерархии, ранжирования, распределения элементов по уровням, если правильная структура однозначно следует из материала.
  Не подходит для: спорных классификаций, открытых интерпретаций, случаев, где порядок/группировка неоднозначны или требуют внешних знаний.

TEST — выбор одного или нескольких правильных вариантов.
  Подходит для: фактов, терминов, признаков, классификаций, различения похожих понятий, количественных данных.
  Не лучший выбор для: сложных объяснений и развёрнутых причинно-следственных связей, где важна формулировка студента.

CLICK_TEXT — выбор верных и неверных утверждений из списка.
  Подходит для: типичных заблуждений, тонких различий, сопоставления похожих утверждений, проверки понимания нюансов.
  Не подходит для: тем, где невозможно составить правдоподобные контрастные утверждения без натяжки.

CLICK_WORDS — поиск фактических ошибок в тексте.
  Подходит для: материалов, где можно создать локальные и однозначно проверяемые искажения — в терминах, числах, параметрах, признаках, сравнениях, отношениях, квалификаторах, отрицаниях, laterality/направлениях и коротких фактических формулировках.
  Не подходит для: слишком общих, интерпретативных или бедных на конкретные проверяемые опоры материалов, где ошибку нельзя оформить как короткий локальный фрагмент без двусмысленности.

CLICK — нахождение нужных элементов на изображении.
  Подходит для: визуального распознавания объектов, анатомических структур, элементов схем, карт, диаграмм, интерфейсов.
  Важно: такие задания создаются вручную в редакторе, но их нужно полноценно рекомендовать, если без них покрытие материала будет неполным.

DRAW — обводка/выделение нужных зон на изображении.
  Подходит для: пространственного распознавания, выделения областей, контуров, зон, анатомических структур, частей схем.
  Важно: такие задания создаются вручную в редакторе, но их нужно полноценно рекомендовать, если это необходимо для полного покрытия.
</available_task_types>

<decision_rules>
- Не выбирай тип задания только потому, что он в целом подходит. Выбирай его только если он даёт лучший или дополнительный способ проверить конкретные единицы.
- Не своди весь материал к одному доминирующему типу, если разные аспекты знания требуют разных форм проверки.
- Если материал содержит явную структуру, не игнорируй SEQUENCE.
- Если материал содержит визуальные объекты, не игнорируй CLICK и DRAW.
- Если материал богат фактами, числами и параметрами, отдельно оцени пригодность CLICK_WORDS.
- Если единица требует не узнавания, а объяснения, отдавай приоритет OPEN_ANSWER.
- Если визуальный тип рекомендован, пометь его как manual_only=true и auto_generation_supported=false.
</decision_rules>

<illustrations_rule>
Если материал упоминает или содержит изображения, схемы, диаграммы или фотографии:
- установи "illustrations_detected": true;
- кратко опиши потенциал визуальных заданий в "illustrations_note";
- не скрывай CLICK и DRAW в not_recommended, если они реально нужны для покрытия;
- ясно укажи, что такие задания создаются вручную в редакторе.
</illustrations_rule>

<output_format>
Верни ответ ровно в таком формате. Не добавляй никакой прозы до или после блоков.
Главная ценность ответа — quality of mapping: educational_units, assessable_anchors, design_candidates, generation_focus и coverage_role.
Если поле count используется, трактуй его как вторичную техническую подсказку для последующей генерации, а не как основной результат анализа.
Поля rationale, coverage_role, generation_focus и reason должны быть короткими и содержательными (1 предложение каждое). Поле count_rationale опционально и допустимо только как вторичное пояснение.

<human_summary>
2–4 предложения: тема, содержательная плотность, насколько материал структурный, фактический или визуальный, какие есть ограничения.
</human_summary>

<analysis_json>
{
  "material_volume": "small | medium | large",
  "educational_units": [
    {
      "id": 1,
      "title": "...",
      "type": "concept|process|fact|term|classification",
      "description": "...",
      "explicitness": "explicit|inferred",
      "evidence": "...",
      "modality": "text|visual|mixed",
      "assessment_risk": "low|medium|high"
    }
  ],
  "recommendations": [
    {
      "task_type": "TEST|OPEN_ANSWER|SEQUENCE|CLICK_TEXT|CLICK_WORDS|CLICK|DRAW",
      "editor_label": "Exact editor-facing label for this type",
      "recommendation_status": "recommended_auto|recommended_manual|conditionally_recommended",
      "priority": "high|medium|low",
      "covers_units": [1, 2],
      "generation_focus": "Short downstream instruction for the generator of this specific type.",
      "coverage_strategy": "breadth_first|high_risk_first|misconception_first|visual_first|structure_first",
      "assessable_anchors": ["Concrete criteria, contrasts, traps, values or visual markers this type should cover."],
      "design_candidates": ["At least two concrete draft tasks grounded in the material, not abstract themes."],
      "rationale": "Почему этот тип нужен.",
      "coverage_role": "Какой когнитивный угол проверки он закрывает.",
      "count": 3,
      "count_rationale": "Optional secondary downstream hint; omit or keep minimal if not obvious.",
      "manual_only": false,
      "auto_generation_supported": true,
      "manual_authoring": {
        "figure_refs": ["Fig. 2.3", "Рис. 4"],
        "figure_caption_anchor": "Fragment of the figure caption",
        "text_anchor": "Phrase from the material that describes the target visual cue",
        "target_objects": ["What exactly should be clicked or outlined"],
        "polygon_hint": "What should become the polygon or selection zone",
        "task_stem_example": "Example wording of the future visual task",
        "why_visual": "Why a visual task is necessary for full coverage"
      }
    }
  ],
  "not_recommended": [
    {
      "task_type": "...",
      "editor_label": "Exact editor-facing label for this type",
      "recommendation_status": "not_recommended",
      "reason": "Почему этот тип не нужен или не имеет достаточного основания."
    }
  ],
  "illustrations_detected": false,
  "illustrations_note": null,
  "warnings": ["строка предупреждения, если есть"]
}
</analysis_json>
</output_format>"""

# Шаблон промпта генерации — параметризуется типом, количеством, образовательными единицами
_GENERATION_PROMPTS = {
    "TEST": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа TEST — это тестовые вопросы с вариантами ответов. Они подходят для проверки распознавания, различения, точности знания фактов, признаков, терминов, классификаций и устойчивых различий между похожими понятиями.
</task_context>

<task>
Преобразуй предоставленный материал в тестовые вопросы формата @TEST.
Используй этот тип там, где правильность ответа можно определить однозначно по материалу. Не используй TEST для случаев, где студент должен развернуто объяснять механизм, причинно-следственную связь, интерпретацию или аргументацию своими словами.
</task>

<quality_criteria>
- На каждый вопрос должно быть ровно 4 варианта ответа.
- Обычно делай 1 правильный ответ; 2 правильных ответа допустимы только если это действительно нужно для проверки материала и оба ответа независимо обоснованы источником.
- Вопрос должен быть самодостаточным, однозначным и полностью ответимым по предоставленному материалу без внешних знаний.
- Каждый вопрос должен проверять один конкретный факт, признак, различие, классификационное правило или устойчивое утверждение, а не смесь нескольких несвязанных проверок.
- Неправильные варианты (дистракторы) должны быть правдоподобными, тематически близкими и основанными на типичных смешениях, а не очевидно абсурдными.
- Формулировки всех вариантов должны быть сопоставимы по длине, стилю и грамматической форме, чтобы правильный ответ не выделялся технически.
- Не делай варианты, которые пересекаются, вкладываются друг в друга или отличаются только случайной детализацией, если это создаёт неоднозначность выбора.
- Не используй вопросы, где правильный ответ угадывается по длине, слишком общей формулировке, словам-маркерам вроде "всегда/никогда" или другим формальным подсказкам.
- Если создаётся несколько вопросов, они должны покрывать разные аспекты материала и не дублировать друг друга.
- Вопросы с несколькими правильными ответами помечай несколькими "+".
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @TEST на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@TEST
# <название теста>
? <вопрос>
+ <правильный ответ>
- <неправильный ответ>
- <неправильный ответ>
- <неправильный ответ>

Каждый вопрос начинается с "?". Правильные ответы — "+", неправильные — "-".
</output_format>""",

    "OPEN_ANSWER": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа OPEN_ANSWER — это вопросы со свободным ответом. Они подходят тогда, когда нужно проверить не узнавание, а самостоятельное объяснение: понимание понятий, причинно-следственных связей, механизмов, различий, интерпретации и аргументации.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @OPEN_ANSWER.
Используй этот тип только там, где студент должен сформулировать смысл своими словами. Не используй OPEN_ANSWER для простых одиночных фактов, терминов, дат, чисел и других случаев, где лучше подходит более компактный формат.
</task>

<quality_criteria>
- Каждый вопрос проверяет объяснение, сравнение, причинно-следственную связь, механизм, интерпретацию или обоснование.
- Вопрос должен быть самодостаточным, однозначным и полностью ответимым по предоставленному материалу без внешних знаний.
- Если создаётся несколько вопросов, они должны проверять разные аспекты материала и не дублировать друг друга.
- Эталонный ответ (строка =) должен быть кратким, но содержательно полным: фиксировать правильную мысль, причинность или различие без лишней воды.
- Эталонный ответ не должен добавлять фактов, которых нет в исходном материале.
- Ключевые слова (строки *) — это только обязательные слова или короткие фразы, без которых ответ нельзя считать полным по смыслу.
- Обычно выбирай 4-8 значимых ключевых слов, но не раздувай список искусственно.
- Включай в ключевые слова общепринятые аббревиатуры и синонимичные формулировки только если они действительно нужны для корректной проверки.
- Не превращай открытый вопрос в простое "назовите/перечислите", если материал требует более глубокого понимания.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @OPEN_ANSWER на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@OPEN_ANSWER
# <вопрос>
= <эталонный ответ>
* <ключевое слово 1>
* <ключевое слово 2>
</output_format>""",

    "SEQUENCE": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа SEQUENCE — это упражнения на сборку правильной структуры перетаскиванием. Они подходят не только для линейного порядка, но и для явной классификации по группам, иерархии, распределения элементов по уровням и ранжирования, но только если материал задаёт одну проверяемую и однозначную структуру.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @SEQUENCE.
Используй этот тип только если каждый элемент можно однозначно поместить в правильное место структуры на основе самого материала. Не используй SEQUENCE для простых списков, спорных классификаций, пересекающихся категорий и случаев, где возможны несколько равноценных структур.
</task>

<quality_criteria>
- Каждое задание обычно содержит 3-8 элементов и 2-5 уровней.
- Правильная структура должна быть однозначной, полностью обоснованной материалом и не требовать внешних знаний.
- Каждый элемент должен быть использован ровно один раз: без пропусков, дублирования и пустых уровней.
- Формулировки элементов должны быть краткими, сопоставимыми по длине и одного смыслового уровня.
- Вопрос в строке # должен чётко указывать, что именно нужно собрать и по какому принципу: порядок, стадии, классификация, иерархия, ранжирование или распределение по уровням.
- Для хронологии, алгоритма или процесса используй SEQUENCE только если порядок шагов единственный и устойчивый.
- Для классификации, группировки, иерархии или ранжирования используй SEQUENCE только если критерий группировки и относительный порядок уровней явно следуют из материала.
- Если несколько элементов находятся на одном уровне, их совместное размещение должно быть однозначно подтверждено материалом.
- В каждом блоке явно укажи @ level_order_matters: true|false и @ sequence_within_level_matters: true|false.
- Устанавливай @ level_order_matters: true, если порядок уровней является частью правильного ответа; для чистой классификации или группировки без фиксированного порядка уровней ставь false.
- Устанавливай @ sequence_within_level_matters: true только если внутри одного уровня порядок элементов тоже значим; если элементы в уровне образуют группу без внутреннего порядка — ставь false.
- Не превращай простой перечень фактов, примеров или терминов в искусственную структуру.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @SEQUENCE на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@SEQUENCE
@ level_order_matters: true
@ sequence_within_level_matters: false
# <инструкция: что и по какому принципу упорядочить>
element_1: <текст элемента>
element_2: <текст элемента>
element_3: <текст элемента>
level_1: element_1
level_2: element_2
level_3: element_3

Элементы нумеруются последовательно (element_1, element_2, ...).
Уровни (level_N) задают правильную структуру и должны идти последовательно без пропусков.
Каждый element_X должен встретиться ровно в одном level_N.
Если два элемента должны оказаться в одной группе/на одном уровне — укажи их через запятую: level_2: element_3, element_4.
</output_format>""",

    "CLICK_TEXT": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_TEXT — это упражнения на классификацию утверждений. Студент видит список утверждений и отмечает верные или неверные. Этот тип подходит для проверки тонких различий, типичных заблуждений, правил с исключениями, похожих формулировок и нюансов понимания.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @CLICK_TEXT.
Используй этот тип только там, где можно составить несколько содержательно сильных и правдоподобных утверждений для различения. Не используй CLICK_TEXT для тем, где утверждения получаются искусственными, тривиальными или требуют развернутого объяснения вместо различения формулировок.
</task>

<quality_criteria>
- Каждое задание содержит 4-7 утверждений.
- В одном задании должны быть и верные (+), и неверные (-) утверждения; по возможности делай несколько верных и несколько неверных, а не формат с одним очевидным правильным пунктом.
- Все утверждения в одном задании должны относиться к одной узкой теме, одному правилу, одному механизму или одному набору близких различий.
- Каждое утверждение должно быть самодостаточным, однозначным и полностью проверяемым по предоставленному материалу без внешних знаний.
- Неверные утверждения должны быть правдоподобными и основанными на типичных заблуждениях, смешении похожих понятий, неправильных обобщениях, перепутанных признаках, числах, датах, стадиях или условиях.
- Не делай ложные утверждения абсурдными, слишком грубо ошибочными или легко отсекаемыми по формальным словам-маркерам.
- Формулировки утверждений должны быть сопоставимы по длине, стилю и грамматической форме, чтобы правильность нельзя было угадать по оформлению.
- Не дублируй одно и то же различие несколькими почти одинаковыми утверждениями.
- Если создаётся несколько заданий, они должны покрывать разные нюансы материала и разные типы заблуждений.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_TEXT на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_TEXT
# <вопрос или инструкция>
+ <верное утверждение>
+ <верное утверждение>
- <неверное утверждение>
- <неверное утверждение>

Верные утверждения — "+", неверные — "-".
</output_format>""",

    "CLICK_WORDS": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_WORDS — это упражнения на поиск фактических искажений в тексте. Студент кликает на неверные слова или короткие локальные фрагменты. Этот тип подходит для материалов, где есть устойчивые проверяемые опоры: термины, числа, пороги, параметры, признаки, сравнения, отношения между объектами, квалификаторы, отрицания и другие короткие формулировки, которые можно правдоподобно исказить.
</task_context>

<task>
На основе предоставленного материала создай задания формата @CLICK_WORDS. Напиши связный текст из 2-4 предложений с 2-4 фактическими ошибками. Ошибочные фрагменты оберни в [квадратные скобки].
Используй этот тип там, где можно создать правдоподобные локальные искажения без искажения стиля текста: не только замены терминов и чисел, но и ошибки в отношениях, квалификаторах, противопоставлениях, laterality/направлениях, отрицаниях и коротких фактических формулировках. Не используй CLICK_WORDS для слишком общих, интерпретативных или бедных на проверяемые опоры материалов.
</task>

<quality_criteria>
- Текст должен читаться как естественный связный параграф; ошибки не должны бросаться в глаза без знания материала.
- Все ошибки должны быть именно фактическими или смысловыми искажениями локального уровня: неправильные числа, пороги, термины, признаки, стадии, классификационные признаки, органы, вещества, параметры, условия, сравнения, пространственные отношения, laterality/направления, отрицания или квалификаторы.
- Не создавай орфографические, пунктуационные, стилистические или грамматические ошибки, если они не меняют фактический смысл.
- Верная часть текста действительно должна оставаться верной по материалу.
- Ошибочные фрагменты должны быть локальными и компактными: обычно одно слово, короткое словосочетание или небольшой фрагмент внутри предложения, а не большие куски текста.
- Ошибочные фрагменты в [квадратных скобках] не должны пересекаться, вкладываться друг в друга или ломать читаемость текста.
- Не делай ошибки абсурдными или слишком лёгкими; хорошая ошибка должна быть правдоподобной заменой, а не случайным шумом.
- Если создаётся несколько заданий, они должны покрывать разные типы фактических опор и разные паттерны искажения, а не только однотипные замены слов.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_WORDS на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_WORDS
# <инструкция: что именно искать>
text: <связный текст, где ошибочные фрагменты обёрнуты в [квадратные скобки]>
</output_format>""",
}

ANALYSIS_PROMPT_ADDENDUM = r"""

<analysis_strictness_addendum>
- Add `target_language` to top-level JSON (`ru`, `uk`, `en`, or `mixed`) and keep generated task content in that language.
- ВАЖНО: АБСОЛЮТНО ВЕСЬ сгенерированный текст в значениях JSON-полей (включая title, description, rationale, reason, human_summary, evidence, warnings, notes_for_author, common_confusions) должен быть СТРОГО на языке, указанном в <target_language>, независимо от языка исходного материала.
- Если <target_language>ru</target_language>, то любой выдаваемый тобой смысловой текст обязан быть на правильном русском языке. Никакого английского текста в значениях JSON.
- For each educational unit, MUST add `explicitness`, `evidence`, `modality`, and `assessment_risk` (do not omit these keys).
- Prefer broad coverage and avoid recommending many tasks that test the same paragraph or fact repeatedly.
- Recommend `SEQUENCE` for explicit structure-building cases, including ordering, classification, hierarchy, ranking, or grouping (not only chronology).
- In `not_recommended`, include short user-oriented guidance for unsupported or poor-fit task types: whether the material is suitable in principle and whether manual authoring is recommended (especially image-based tasks when illustrations are present).
- If `illustrations_detected=true`, explicitly tell the user that image-based tasks are not auto-generated here and should be created manually if visual recognition matters.
- Treat CLICK_WORDS as suitable when the material contains concrete, locally distortable facts or relations — not only numbers and terminology, but also qualifiers, contrasts, negations, spatial relations, directions, and short factual claims — even if the source text itself has no mistakes.
- Add a short coverage warning when visual content exists but text-only generation cannot assess image recognition.
- Cover every supported text task type (TEST, OPEN_ANSWER, SEQUENCE, CLICK_TEXT, CLICK_WORDS) exactly once across `recommendations` or `not_recommended` so the user gets a complete suitability map.
- Keep the analysis JSON compact enough to fit model output limits: cluster related facts into broader educational units instead of enumerating every micro-fact.
- Prefer assessable unit clusters (not exhaustive lists of all examples, drug names, doses, subvariants) when the source is dense.
- Use enum values exactly as requested: `explicitness` = `explicit|inferred`, `modality` = `text|visual|mixed`, `assessment_risk` = `low|medium|high`.
- Keep `title` short, `description` concise (1 sentence), `evidence` brief (short phrase or citation clue).
- Explicitly evaluate EVERY available task type. Do not silently ignore a type.
- Reject a task type only if you cannot propose at least 2 concrete, plausible design candidates grounded in the material.
- Use exact editor-facing labels in `editor_label`: `Открытый ответ`, `Последовательность`, `Тест (вопросы с вариантами ответов)`, `Клик/Ошибки (текстовый выбор)`, `Клик/Ошибки (поиск ошибок в тексте)`, `Клик по изображению`, `Рисование на изображении`.
- For each recommendation, also return:
  - `recommendation_status`: `recommended_auto|recommended_manual|conditionally_recommended`
  - `generation_focus`: one short downstream instruction for the generator of this type
  - `coverage_strategy`: `breadth_first|high_risk_first|misconception_first|visual_first`
  - `assessable_anchors`: 2-6 concrete anchors from the material
  - `design_candidates`: at least 2 short but concrete authoring blueprints
- For CLICK and DRAW, add `manual_authoring` object with:
  - `figure_refs` (image or figure numbers),
  - `figure_caption_anchor`,
  - `text_anchor`,
  - `target_objects`,
  - `polygon_hint`,
  - `task_stem_example`,
  - `why_visual`.
- Visual recommendations are invalid if they only name abstract units without telling the author what exactly to click, outline, or recognize.
- The core quality criterion is not task quantity but actionable mapping.
- `design_candidates` and `assessable_anchors` must be concrete enough that an author can draft tasks without guessing.
- Treat `count` and `count_rationale` as secondary downstream metadata. Do not let them dominate rationale or replace concrete application guidance.
- When in doubt, enrich `generation_focus`, `coverage_role`, `assessable_anchors`, and `design_candidates` instead of inflating or debating counts.
</analysis_strictness_addendum>
"""

ANALYSIS_V2_ROUTES_ADDENDUM = r"""

<capability_matrix_v1>
Use this matrix as the ONLY normative source for type_progression_suitability. Do not invent types, levels, or roles not listed here.
[
  {"task_type":"TEST","status":"implemented","progression_is_fixed":true,"levels":[1,2],"complex_role":"core",
   "level_roles":{"1":"Multiple choice — recognition/fact check","2":"Text answer — recall/extraction"}},
  {"task_type":"OPEN_ANSWER","status":"implemented","progression_is_fixed":true,"levels":[1],"complex_role":"core",
   "level_roles":{"1":"Free-form answer — explanation, cause-effect, mechanisms"}},
  {"task_type":"SEQUENCE","status":"implemented","progression_is_fixed":true,"levels":[1,2,3],"complex_role":"core",
   "intents":["ordering","classification","hierarchy","ranking","grouping"],
   "level_roles":{"1":"Assemble structure / distribute elements","2":"Assemble + name levels","3":"Assemble + name levels and blocks"}},
  {"task_type":"CLICK","status":"implemented","progression_is_fixed":true,"levels":[1,2,3],"complex_role":"core",
   "note":"Visual tasks — requires images, manual authoring only",
   "level_roles":{"1":"Find/recognize on image","2":"Find + name","3":"Outline + name"}},
  {"task_type":"DRAW","status":"implemented","progression_is_fixed":true,"levels":[1,2],"complex_role":"core",
   "note":"Visual tasks — requires images, manual authoring only",
   "level_roles":{"1":"Outline / spatial recognition","2":"Outline + name"}},
  {"task_type":"CLICK_TEXT","status":"implemented","complex_role":"finisher_special",
   "note":"Error detection — classify statements as true/false. No fixed progression, no level_role_map."},
  {"task_type":"CLICK_WORDS","status":"implemented","complex_role":"finisher_special",
   "note":"Error detection — find factual errors in text. No fixed progression, no level_role_map."},
  {"capability_id":"pair_matching","status":"planned","first_target":"microcards.pair_match","complex_role":"none",
   "note":"Not an implemented task type. Represent as future_capabilities entry."}
]
</capability_matrix_v1>

<analysis_v2_routes_mode>
- Output `analysis_schema_version` = `2.0` and keep legacy compatibility fields (`educational_units`, `recommendations`, `not_recommended`, `warnings`).
- Also include practical v2 fields: `learning_chunks`, `type_progression_suitability`, `authoring_routes`, `future_capabilities`, `microcards_candidates`.
- `coverage_plan` is built by backend — do not generate it. Instead ensure `covers_unit_ids` and `covers_chunk_ids` are populated in `type_progression_suitability`.
- Build the analysis as practical routes and progression semantics, not only a flat list of task types.
- In `type_progression_suitability`, use the capability_matrix_v1 above as the normative source:
  - Copy `progression_is_fixed`, `levels`, `complex_role`, and `level_roles` from the matrix.
  - Add material-specific `suitability` (high/medium/low/none) and `rationale`.
  - For SEQUENCE, set `sequence_intents` from: `ordering`, `classification`, `hierarchy`, `ranking`, `grouping`.
  - For CLICK and DRAW, set suitability based on whether material has visual content (illustrations_detected).
  - For CLICK_TEXT and CLICK_WORDS (finisher_special): do NOT set `progression_is_fixed` or `level_role_map`.
  - Mark `availability` truthfully (`implemented`, `planned`, `microcards_only`, `unsupported`).
- In `learning_chunks`:
  - Use `unit_ids` (array of integer unit IDs) to link chunks to educational units. Do NOT use `units_covered`.
  - Populate `common_confusions` (what students typically mix up) and `notes_for_author` (practical tips for task creation) when inferable from the material.
- In `authoring_routes`, use concrete steps and target surfaces (`complexes`, `editor_manual`, `microcards`) instead of abstract advice.
  - For fixed progression route steps, use `progression_policy` = `full_fixed_progression` and never `pick_only_level`.
  - When a route step uses SEQUENCE, include `sequence_intent`.
- Do NOT invent new implemented task types such as `MATCH` or `CLASSIFY`.
- `CLICK_TEXT` and `CLICK_WORDS` are error-detection/discrimination variants and must NOT be presented as `MATCH`.
- Represent pair matching as a future capability: add `future_capabilities` entry with `capability_id` = `pair_matching`, truthful status (usually `planned`), `recommended_surface` = `microcards`, and `fallback_now`.
- Include `microcards_candidates` (array) — seeds for flashcard generation:
  - Each: {"candidate_id":"mc_1","unit_id":<int>,"chunk_id":"chunk_N","card_type":"fact_recall|term_definition|cloze|pair_match|numeric_anchor|contrast_pair","priority":"high|medium|low","prompt_seed":"short question","answer_seed":"short answer","anchors":["key term"],"why":"why useful"}
  - Aim for 5-15 candidates. Prioritize pair_match for contrast/classification, numeric_anchor for data-heavy, cloze for definitions.
- Include `report_blocks` (array) — AST-like structure for rendering the report. Minimal example:
  [
    {"type":"toc","anchor":"toc","title":"Contents","body":{"entries":[{"anchor":"units","label":"Units"},{"anchor":"progression","label":"Progression"},{"anchor":"routes","label":"Routes"}]}},
    {"type":"section","anchor":"units","title":"Educational Units Overview","body":{"prose":"Brief summary of units found."},"refs":{"unit_ids":[1,2,3]}},
    {"type":"progression_matrix","anchor":"progression","title":"Task Type Progression","body":{"rows":[{"task_type":"TEST","suitability":"high","show_level_roles":true}]}},
    {"type":"section","anchor":"routes","title":"Authoring Routes","body":{"prose":"Practical routes for creating tasks."}},
    {"type":"callout","anchor":"note-visual","title":"Visual Content","body":{"variant":"tip","text":"This material contains images. Consider CLICK/DRAW tasks via manual editor."}}
  ]
  - Keep prose concise (max 3 sentences per block). If you cannot generate full report_blocks, return at least `toc` + 1 `section`.
</analysis_v2_routes_mode>
"""

ANALYSIS_COMPACT_RECOVERY_ADDENDUM = r"""

<analysis_compact_recovery_mode>
- Recovery mode: previous attempt may have exceeded output size. Return a more compact but complete analysis.
- STRICT OUTPUT BUDGET:
  - educational_units: aim 8-18 units (cluster related details)
  - each description: <= 160 chars
  - each evidence: <= 80 chars
  - recommendations/not_recommended rationale/reason: very short (<= 1 sentence)
- Do not enumerate long treatment schemes, subtypes, or lists item-by-item if they can be grouped into a single assessable educational unit.
</analysis_compact_recovery_mode>
"""

ANALYSIS_FORMAT_RECOVERY_ADDENDUM = r"""

<analysis_format_recovery_mode>
- Recovery mode: previous response did not follow the required format.
- Return ONLY two blocks in this exact order: <human_summary>...</human_summary> then <analysis_json>{...}</analysis_json>
- Do not write any prose before/after the blocks.
- `<analysis_json>` MUST contain valid strict JSON (double quotes, no trailing commas, no comments).
- Keep `human_summary` short (2-4 sentences).
</analysis_format_recovery_mode>
"""

ANALYSIS_CHUNK_FALLBACK_ADDENDUM = r"""

<analysis_chunk_fallback_mode>
- You are analyzing only ONE CHUNK of a larger material.
- Focus on educational units that are explicitly present in this chunk.
- Keep output compact and structured.
- Recommendations may be minimal and local to this chunk; global balancing will be done later.
- Avoid listing every micro-detail separately if they belong to one assessable cluster.
- DO include these v2 fields for this chunk: `learning_chunks`, `type_progression_suitability`, `microcards_candidates`, `future_capabilities`.
- Do NOT include `report_blocks` or `authoring_routes` for chunks — they will be built after merging all chunks.
- Do NOT include `coverage_plan` — it is built by backend after merge.
</analysis_chunk_fallback_mode>
"""

_ANALYSIS_CHUNK_TRIGGER_WORDS = 1800
_ANALYSIS_CHUNK_MIN_TRIGGER_WORDS = 1000
_ANALYSIS_CHUNK_TARGET_WORDS = 900
_ANALYSIS_CHUNK_HARD_MAX_WORDS = 1200
_ANALYSIS_CHUNK_MAX_COUNT = 8

_GENERATION_GUARDRAILS = {
    "GLOBAL": [
        "Use only facts explicitly supported by the provided material.",
        "Ground every task in the listed educational units and their evidence snippets; do not add unsupported facts.",
        "If a listed unit lacks enough support for the requested task type, skip it and use another listed unit instead of inventing details.",
        "Avoid duplicates and near-duplicates across generated tasks.",
        "Match the language of the source material (target_language) consistently.",
        "Silently self-check before finalizing: exact task count, valid marker syntax, no Markdown explanations.",
    ],
    "TEST": [
        "Do not create all-correct answer sets unless explicitly unavoidable.",
        "Use plausible distractors.",
        "If multiple answers are correct, mark all correct answers with '+'.",
        "Each TEST should target a distinct fact/rule unless intentionally covering a broad unit with subfacts.",
    ],
    "SEQUENCE": [
        "Create SEQUENCE only when the source defines an explicit structure: order, stages, classification, hierarchy, ranking, or grouping.",
        "Do not invent hidden structures if the source only lists terms or loosely related facts.",
        "State the structuring principle clearly in the # instruction.",
        "Use shared levels for grouping/classification tasks when several elements belong together.",
        "If the structure is only loosely inferred, do not use SEQUENCE.",
    ],
    "OPEN_ANSWER": [
        "Include keywords that cover abbreviations and synonyms used in the material.",
        "Prefer 4-8 meaningful keywords over overly narrow keyword lists.",
        "Mark as keywords only the words or short phrases that must be present in the learner answer.",
    ],
    "CLICK_TEXT": [
        "Use misconception-style contrasts and subtle distinctions from the source.",
        "When available, include statement traps around numbers/dates/regulatory details.",
        "Mix true and false statements with plausible wording; avoid obvious fillers.",
        "Do not collapse CLICK_TEXT into a disguised single-choice item; prefer multiple meaningful true/false judgments.",
    ],
    "CLICK_WORDS": [
        "Prefer local factual distortions in terms, criteria, numbers, qualifiers, relations, directions, negations, and short factual claims (not spelling errors).",
        "Create exactly 2-4 factual errors per task.",
        "Wrap only compact local erroneous fragments in [brackets]; short multi-word spans are allowed when the error cannot be expressed by a single token.",
        "Keep the surrounding text fully correct; only the bracketed fragment should be wrong.",
        "Do not leave unmatched '[' or ']' in the final text.",
    ],
}


_TEXT_AI_TASK_TYPES = {"TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS"}
_MANUAL_ANALYSIS_TASK_TYPES = {"CLICK", "DRAW"}
_ANALYSIS_TASK_TYPES = _TEXT_AI_TASK_TYPES | _MANUAL_ANALYSIS_TASK_TYPES
_AI_TASK_TYPES = _TEXT_AI_TASK_TYPES
_PRIORITY_SCORE = {"low": 0, "medium": 1, "high": 2}
_PRIORITY_BY_SCORE = {v: k for k, v in _PRIORITY_SCORE.items()}


def _append_unique(items: List[str], value: str) -> None:
    if not value:
        return
    if value not in items:
        items.append(value)


def _coerce_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _normalize_priority(value: Any) -> str:
    val = str(value or "").strip().lower()
    if val in _PRIORITY_SCORE:
        return val
    return "medium"


def _unique_int_list(values: Any, allowed: Optional[set] = None) -> List[int]:
    out: List[int] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        try:
            iv = int(raw)
        except Exception:
            continue
        if allowed is not None and iv not in allowed:
            continue
        if iv in seen:
            continue
        seen.add(iv)
        out.append(iv)
    return out


def _material_numeric_signal(material: str) -> int:
    if not isinstance(material, str):
        return 0
    numbers = re.findall(r"\b\d+(?:[.,]\d+)?\b", material)
    markers = re.findall(r"[%]|p\s*[<=>]\s*0?\.\d+|\bOR\b|\bodds\b", material, flags=re.IGNORECASE)
    months = re.findall(
        r"\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|"
        r"sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b",
        material,
        flags=re.IGNORECASE,
    )
    years = re.findall(r"\b20\d{2}\b", material)
    return min(50, len(numbers) + len(markers) * 2 + len(months) + len(set(years)))


def _material_click_words_signal(material: str) -> int:
    if not isinstance(material, str):
        return 0
    signal = _material_numeric_signal(material)
    relation_markers = re.findall(
        r"\b(?:left|right|upper|lower|anterior|posterior|medial|lateral|proximal|distal|above|below|"
        r"versus|vs\.?|more|less|only|not|without|with|due to|because|compared with|increase|decrease|"
        r"лев|прав|верх|ниж|передн|задн|медиал|латерал|проксим|дистал|выше|ниже|без|не|только|"
        r"увелич|уменьш|по сравнению|в отличие|за сч[её]т)\b",
        material,
        flags=re.IGNORECASE,
    )
    criterion_markers = re.findall(
        r"\b(?:criterion|criteria|sign|marker|projection|phase|stage|class|type|group|ratio|level|"
        r"критер|признак|маркер|проекц|фаза|стад|класс|тип|групп|соотнош|уровн)\w*\b",
        material,
        flags=re.IGNORECASE,
    )
    return min(70, signal + min(len(relation_markers), 12) + min(len(criterion_markers), 8))


def _unit_text_blob(unit: Dict[str, Any]) -> str:
    return f"{unit.get('title', '')} {unit.get('description', '')} {unit.get('evidence', '')}"


def _is_visualish_unit(unit: Dict[str, Any]) -> bool:
    blob = _unit_text_blob(unit).lower()
    tokens = [
        "image", "images", "figure", "fig.", "illustration", "visual", "example image",
        "рис", "рисунок", "изображ", "снимк",
    ]
    return any(token in blob for token in tokens)


def _is_numeric_or_regulatory_unit(unit: Dict[str, Any]) -> bool:
    blob = _unit_text_blob(unit).lower()
    keyword_tokens = [
        "date", "report", "guidance", "federal", "regulat", "risk", "odds", "statistically",
        "требован", "дата", "риск", "отчет", "отчёт", "статист",
    ]
    return bool(re.search(r"\d|%|p\s*[<=>]\s*0?\.\d+", blob)) or any(t in blob for t in keyword_tokens)


def _is_click_words_friendly_unit(unit: Dict[str, Any]) -> bool:
    blob = _unit_text_blob(unit).lower()
    keyword_tokens = [
        "criteria", "criterion", "sign", "marker", "feature", "parameter", "projection", "relation",
        "contrast", "difference", "direction", "position", "laterality", "threshold", "term",
        "критер", "признак", "маркер", "характерист", "парамет", "проекц", "соотнош", "различ",
        "направлен", "положен", "лев", "прав", "верх", "ниж", "порог", "термин", "классиф",
    ]
    unit_type = str(unit.get("type") or "").strip().lower()
    return (
        _is_numeric_or_regulatory_unit(unit)
        or unit_type in {"fact", "classification", "process", "term"}
        or any(t in blob for t in keyword_tokens)
    )


def _coerce_boolish(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    raw = str(value).strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    return default


def _is_spatial_visual_unit(unit: Dict[str, Any]) -> bool:
    blob = _unit_text_blob(unit).lower()
    tokens = [
        "zone", "region", "contour", "outline", "boundary", "layer", "spatial", "anatom",
        "зон", "област", "контур", "границ", "слой", "простран", "анатом", "структур",
    ]
    return any(token in blob for token in tokens)


def _default_recommendation_coverage_role(task_type: str) -> str:
    mapping = {
        "TEST": "Проверяет распознавание, различение и точность знания фактов.",
        "OPEN_ANSWER": "Проверяет объяснение, интерпретацию и причинно-следственные связи.",
        "SEQUENCE": "Проверяет понимание структуры, порядка, уровней и связей между элементами.",
        "CLICK_TEXT": "Проверяет различение похожих утверждений и понимание нюансов.",
        "CLICK_WORDS": "Проверяет обнаружение фактических искажений и внимательность к опорным фактам.",
        "CLICK": "Проверяет визуальное распознавание и локализацию элементов на изображении.",
        "DRAW": "Проверяет пространственное распознавание и выделение правильных зон на изображении.",
    }
    return mapping.get(task_type, "Проверяет отдельный аспект усвоения материала.")


def _default_recommendation_count_rationale(task_type: str, covers_count: int, manual_only: bool) -> str:
    if manual_only:
        if covers_count > 1:
            return "Количество отражает число визуально значимых единиц, которые нельзя полноценно закрыть только текстом."
        return "Достаточно минимума ручных визуальных заданий, чтобы закрыть ключевой визуальный навык без дублирования."
    if covers_count >= 6:
        return "Количество увеличено, потому что этот формат закрывает несколько разных единиц без потери качества."
    if covers_count >= 3:
        return "Количество соответствует числу существенных единиц, которые этот формат проверяет с новой стороны."
    if task_type == "OPEN_ANSWER":
        return "Количество ограничено, чтобы оставить только действительно объяснительные и недублирующиеся вопросы."
    if task_type == "SEQUENCE":
        return "Количество зависит только от числа явно выраженных структур, а не от объёма текста."
    return "Количество выбрано по реальной потребности покрытия, а не по длине материала."


def _editor_label_for_task_type(task_type: str) -> str:
    mapping = {
        "OPEN_ANSWER": "Открытый ответ",
        "SEQUENCE": "Последовательность",
        "TEST": "Тест (вопросы с вариантами ответов)",
        "CLICK_TEXT": "Клик/Ошибки (текстовый выбор)",
        "CLICK_WORDS": "Клик/Ошибки (поиск ошибок в тексте)",
        "CLICK": "Клик по изображению",
        "DRAW": "Рисование на изображении",
    }
    return mapping.get(str(task_type or "").upper(), str(task_type or "").strip() or "Тип задания")


def _normalize_string_list(values: Any, max_items: int = 8) -> List[str]:
    out: List[str] = []
    seen = set()
    if not isinstance(values, list):
        return out
    for raw in values:
        txt = str(raw or "").strip()
        if not txt:
            continue
        key = txt.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(txt[:280])
        if len(out) >= max_items:
            break
    return out


def _extract_figure_refs(*texts: Any) -> List[str]:
    refs: List[str] = []
    seen = set()
    patterns = (
        r"\b(?:fig(?:ure)?|рис(?:\.|унок)?)\s*\d+(?:\.\d+)?\b",
        r"\b(?:box|табл(?:\.|ица)?)\s*\d+(?:\.\d+)?\b",
    )
    for raw in texts:
        text = str(raw or "")
        if not text:
            continue
        for pattern in patterns:
            for match in re.findall(pattern, text, flags=re.IGNORECASE):
                normalized = re.sub(r"\s+", " ", match).strip()
                key = normalized.lower()
                if key in seen:
                    continue
                seen.add(key)
                refs.append(normalized)
                if len(refs) >= 6:
                    return refs
    return refs


def _recommendation_units(rec: Dict[str, Any], units: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    covered_ids = set(_unique_int_list(rec.get("covers_units")))
    return [u for u in units if int(u.get("id") or 0) in covered_ids]


def _default_recommendation_status(task_type: str, manual_only: bool, auto_generation_supported: bool) -> str:
    if manual_only or not auto_generation_supported or str(task_type or "").upper() in _MANUAL_ANALYSIS_TASK_TYPES:
        return "recommended_manual"
    return "recommended_auto"


def _default_recommendation_generation_focus(task_type: str) -> str:
    mapping = {
        "TEST": "Разбей материал на несколько проверяемых фактов, критериев и contrast pairs, а не на один общий вопрос.",
        "OPEN_ANSWER": "Делай короткие, проверяемые open-answer задания с явными смысловыми anchors, а не эссе.",
        "SEQUENCE": "Ищи не только линейный порядок, но и классификацию, иерархию, группировку и распределение по уровням.",
        "CLICK_TEXT": "Собирай правдоподобные кластеры верных/неверных утверждений вокруг типичных заблуждений и тонких различий.",
        "CLICK_WORDS": "Используй фактические подмены в терминах, критериях, числах, признаках и подписях к рисункам.",
        "CLICK": "Привязывай задание к конкретным изображениям, ориентирам и зонам клика, которые реально описаны в материале.",
        "DRAW": "Привязывай задание к конкретным изображениям и пространственным зонам, которые нужно обвести или выделить.",
    }
    return mapping.get(str(task_type or "").upper(), "Опирайся на конкретные образовательные единицы и не дублируй уже покрытые аспекты.")


def _default_recommendation_coverage_strategy(task_type: str, covered_units: List[Dict[str, Any]]) -> str:
    if any(str(u.get("assessment_risk") or "").lower() == "high" for u in covered_units):
        return "high_risk_first"
    if str(task_type or "").upper() in {"CLICK_TEXT", "CLICK_WORDS"}:
        return "misconception_first"
    if str(task_type or "").upper() in {"CLICK", "DRAW"}:
        return "visual_first"
    return "breadth_first"


def _default_recommendation_assessable_anchors(rec: Dict[str, Any], units: List[Dict[str, Any]]) -> List[str]:
    anchors: List[str] = []
    seen = set()
    for unit in _recommendation_units(rec, units):
        title = str(unit.get("title") or "").strip()
        evidence = re.sub(r"\s+", " ", str(unit.get("evidence") or "")).strip()
        for candidate in (title, evidence):
            if not candidate:
                continue
            key = candidate.lower()
            if key in seen:
                continue
            seen.add(key)
            anchors.append(candidate[:180])
            if len(anchors) >= 6:
                return anchors
    return anchors


def _default_recommendation_design_candidates(rec: Dict[str, Any], units: List[Dict[str, Any]]) -> List[str]:
    task_type = str(rec.get("task_type") or "").upper()
    covered_units = _recommendation_units(rec, units)
    labels = [str(u.get("title") or "").strip() for u in covered_units if str(u.get("title") or "").strip()]
    anchors = _default_recommendation_assessable_anchors(rec, units)
    primary = labels[0] if labels else (anchors[0] if anchors else "ключевой аспект материала")
    secondary = labels[1] if len(labels) > 1 else (anchors[1] if len(anchors) > 1 else primary)

    if task_type == "TEST":
        return _normalize_string_list([
            f"Отдельный тестовый вопрос на распознавание или различение: {primary}.",
            f"Отдельный тестовый вопрос на критерий, contrast pair или ловушку интерпретации: {secondary}.",
        ], max_items=4)
    if task_type == "OPEN_ANSWER":
        return _normalize_string_list([
            f"Короткий открытый вопрос: объяснить механизм, смысл или диагностическую роль {primary}.",
            f"Короткий открытый вопрос на различение или причинно-следственную связь: {secondary}.",
        ], max_items=4)
    if task_type == "SEQUENCE":
        return _normalize_string_list([
            f"Собрать структуру, классификацию или порядок, связанный с {primary}.",
            f"Разложить по уровням, группам или иерархии элементы, относящиеся к {secondary}.",
        ], max_items=4)
    if task_type == "CLICK_TEXT":
        return _normalize_string_list([
            f"Набор утверждений с тонкими различиями и ловушками по теме: {primary}.",
            f"Набор правдоподобных верных/неверных утверждений для различения похожих формулировок: {secondary}.",
        ], max_items=4)
    if task_type == "CLICK_WORDS":
        return _normalize_string_list([
            f"Короткий абзац с фактическими подменами в критериях, терминах или признаках по теме: {primary}.",
            f"Короткий абзац с правдоподобными заменами в числах, названиях или характеристиках: {secondary}.",
        ], max_items=4)
    if task_type == "CLICK":
        return _normalize_string_list([
            f"Задание на клик по конкретному ориентиру или объекту на изображении: {primary}.",
            f"Задание на распознавание нужной анатомической, схемной или диагностической области: {secondary}.",
        ], max_items=4)
    if task_type == "DRAW":
        return _normalize_string_list([
            f"Задание на обводку или выделение зоны, связанной с {primary}.",
            f"Задание на пространственное выделение контура или области, относящейся к {secondary}.",
        ], max_items=4)
    return _normalize_string_list([primary, secondary], max_items=4)


def _normalize_manual_authoring(value: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(value, dict):
        return None
    result = {
        "figure_refs": _normalize_string_list(value.get("figure_refs"), max_items=6),
        "figure_caption_anchor": str(value.get("figure_caption_anchor") or "").strip()[:220],
        "text_anchor": str(value.get("text_anchor") or "").strip()[:220],
        "target_objects": _normalize_string_list(value.get("target_objects"), max_items=6),
        "polygon_hint": str(value.get("polygon_hint") or "").strip()[:220],
        "task_stem_example": str(value.get("task_stem_example") or "").strip()[:220],
        "why_visual": str(value.get("why_visual") or "").strip()[:220],
    }
    if any(result.values()):
        return result
    return None


def _default_visual_manual_authoring(rec: Dict[str, Any], units: List[Dict[str, Any]], illustrations_note: str) -> Dict[str, Any]:
    covered_units = _recommendation_units(rec, units)
    primary_unit = covered_units[0] if covered_units else {}
    primary_title = str(primary_unit.get("title") or "нужный ориентир").strip()
    primary_evidence = re.sub(r"\s+", " ", str(primary_unit.get("evidence") or "")).strip()
    figure_refs = _extract_figure_refs(
        illustrations_note,
        *(u.get("evidence") for u in covered_units),
        *(u.get("description") for u in covered_units),
    )
    task_type = str(rec.get("task_type") or "").upper()
    if task_type == "CLICK":
        task_stem = f"Кликните на ориентир, структуру или диагностический объект, связанный с: {primary_title}."
        polygon_hint = "Полигон или зона клика должны совпадать с конкретным ориентиром, который упомянут в подписи рисунка или в тексте."
    else:
        task_stem = f"Обведите или выделите область на изображении, которая соответствует: {primary_title}."
        polygon_hint = "Полигон должен описывать контур, зону или пространственную область, явно обсуждаемую в материале."
    return {
        "figure_refs": figure_refs,
        "figure_caption_anchor": primary_evidence[:220] if primary_evidence else "",
        "text_anchor": primary_evidence[:220] if primary_evidence else "",
        "target_objects": _normalize_string_list([primary_title, primary_evidence], max_items=4),
        "polygon_hint": polygon_hint,
        "task_stem_example": task_stem,
        "why_visual": "Этот навык зависит от распознавания конкретных объектов или зон на изображении и не должен оставаться только текстовой рекомендацией.",
    }


def _merge_recommendations_by_type(recommendations: Any, valid_unit_ids: set) -> List[Dict[str, Any]]:
    if not isinstance(recommendations, list):
        return []
    merged: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for rec in recommendations:
        if not isinstance(rec, dict):
            continue
        task_type = str(rec.get("task_type") or "").strip().upper()
        if task_type not in _ANALYSIS_TASK_TYPES:
            continue
        count = max(1, min(20, _coerce_int(rec.get("count"), 1)))
        priority = _normalize_priority(rec.get("priority"))
        covers_units = _unique_int_list(rec.get("covers_units"), allowed=valid_unit_ids)
        rationale = str(rec.get("rationale") or "").strip()
        coverage_role = str(rec.get("coverage_role") or "").strip()
        count_rationale = str(rec.get("count_rationale") or "").strip()
        editor_label = str(rec.get("editor_label") or "").strip()
        recommendation_status = str(rec.get("recommendation_status") or "").strip().lower()
        generation_focus = str(rec.get("generation_focus") or "").strip()
        coverage_strategy = str(rec.get("coverage_strategy") or "").strip().lower()
        assessable_anchors = _normalize_string_list(rec.get("assessable_anchors"), max_items=8)
        design_candidates = _normalize_string_list(rec.get("design_candidates"), max_items=8)
        manual_authoring = _normalize_manual_authoring(rec.get("manual_authoring"))
        manual_only = _coerce_boolish(rec.get("manual_only"), default=task_type in _MANUAL_ANALYSIS_TASK_TYPES)
        auto_generation_supported = _coerce_boolish(
            rec.get("auto_generation_supported"),
            default=not manual_only,
        )
        if manual_only:
            auto_generation_supported = False

        if task_type not in merged:
            merged[task_type] = {
                "task_type": task_type,
                "count": count,
                "priority": priority,
                "covers_units": covers_units,
                "rationale": rationale,
                "coverage_role": coverage_role,
                "count_rationale": count_rationale,
                "editor_label": editor_label,
                "recommendation_status": recommendation_status,
                "generation_focus": generation_focus,
                "coverage_strategy": coverage_strategy,
                "assessable_anchors": assessable_anchors,
                "design_candidates": design_candidates,
                "manual_authoring": manual_authoring,
                "manual_only": manual_only,
                "auto_generation_supported": auto_generation_supported,
            }
            order.append(task_type)
            continue

        existing = merged[task_type]
        existing["count"] = min(20, int(existing.get("count", 0)) + count)
        existing["priority"] = _PRIORITY_BY_SCORE[
            max(
                _PRIORITY_SCORE.get(str(existing.get("priority", "medium")), 1),
                _PRIORITY_SCORE.get(priority, 1),
            )
        ]
        existing["covers_units"] = _unique_int_list(
            list(existing.get("covers_units") or []) + covers_units,
            allowed=valid_unit_ids,
        )
        if rationale and not existing.get("rationale"):
            existing["rationale"] = rationale
        if coverage_role and not existing.get("coverage_role"):
            existing["coverage_role"] = coverage_role
        if count_rationale and not existing.get("count_rationale"):
            existing["count_rationale"] = count_rationale
        if editor_label and not existing.get("editor_label"):
            existing["editor_label"] = editor_label
        if recommendation_status and not existing.get("recommendation_status"):
            existing["recommendation_status"] = recommendation_status
        if generation_focus and not existing.get("generation_focus"):
            existing["generation_focus"] = generation_focus
        if coverage_strategy and not existing.get("coverage_strategy"):
            existing["coverage_strategy"] = coverage_strategy
        if assessable_anchors:
            existing["assessable_anchors"] = _normalize_string_list(
                list(existing.get("assessable_anchors") or []) + assessable_anchors,
                max_items=8,
            )
        if design_candidates:
            existing["design_candidates"] = _normalize_string_list(
                list(existing.get("design_candidates") or []) + design_candidates,
                max_items=8,
            )
        if manual_authoring and not existing.get("manual_authoring"):
            existing["manual_authoring"] = manual_authoring
        existing["manual_only"] = bool(existing.get("manual_only")) or manual_only
        existing["auto_generation_supported"] = bool(existing.get("auto_generation_supported", True)) and auto_generation_supported
    return [merged[t] for t in order]


def _find_recommendation(recs: List[Dict[str, Any]], task_type: str) -> Optional[Dict[str, Any]]:
    for rec in recs:
        if str(rec.get("task_type") or "").upper() == task_type:
            return rec
    return None


def _ensure_analysis_quality(
    analysis_data: Dict[str, Any],
    material: str,
    fallback_target_language: str,
) -> Dict[str, Any]:
    data = dict(analysis_data or {})
    warnings = [str(w) for w in (data.get("warnings") or []) if str(w).strip()]
    illustrations_detected = bool(data.get("illustrations_detected"))
    data["illustrations_detected"] = illustrations_detected
    data["target_language"] = str(data.get("target_language") or fallback_target_language or "unknown")
    illustrations_note = str(data.get("illustrations_note") or "").strip()

    raw_units = data.get("educational_units") if isinstance(data.get("educational_units"), list) else []
    units: List[Dict[str, Any]] = []
    used_ids = set()
    allowed_unit_types = {"concept", "process", "fact", "term", "classification"}
    for idx, raw_unit in enumerate(raw_units, start=1):
        if not isinstance(raw_unit, dict):
            continue
        unit = dict(raw_unit)
        uid = unit.get("id")
        try:
            uid = int(uid)
        except Exception:
            uid = idx
        while uid in used_ids:
            uid += 1
        used_ids.add(uid)
        unit["id"] = uid
        unit["title"] = str(unit.get("title") or f"Unit {uid}").strip()
        unit["description"] = str(unit.get("description") or "").strip()
        unit_type = str(unit.get("type") or "fact").strip().lower()
        unit["type"] = unit_type if unit_type in allowed_unit_types else "fact"

        explicitness = str(unit.get("explicitness") or "").strip().lower()
        if explicitness not in {"explicit", "inferred"}:
            explicitness = "explicit"
        unit["explicitness"] = explicitness

        evidence = str(unit.get("evidence") or "").strip()
        if not evidence:
            evidence = (unit.get("description") or unit.get("title") or "")[:180]
        unit["evidence"] = evidence

        modality = str(unit.get("modality") or "").strip().lower()
        if modality not in {"text", "visual", "mixed"}:
            modality = "mixed" if (illustrations_detected and _is_visualish_unit(unit)) else "text"
        unit["modality"] = modality

        assessment_risk = str(unit.get("assessment_risk") or "").strip().lower()
        if assessment_risk not in {"low", "medium", "high"}:
            blob = _unit_text_blob(unit).lower()
            if any(k in blob for k in ["suspicious", "malignan", "ranking", "rank", "подозр", "злокаче"]):
                assessment_risk = "high"
            elif unit["type"] in {"classification", "process"}:
                assessment_risk = "medium"
            else:
                assessment_risk = "low"
        unit["assessment_risk"] = assessment_risk
        units.append(unit)

    data["educational_units"] = units
    valid_unit_ids = {int(u["id"]) for u in units}
    recommendations = _merge_recommendations_by_type(data.get("recommendations"), valid_unit_ids)

    not_recommended_raw = data.get("not_recommended") if isinstance(data.get("not_recommended"), list) else []
    not_recommended: List[Dict[str, Any]] = []
    for item in not_recommended_raw:
        if not isinstance(item, dict):
            continue
        task_type = str(item.get("task_type") or "").strip()
        reason = str(item.get("reason") or "").strip()
        if task_type:
            not_recommended.append({"task_type": task_type, "reason": reason})

    click_words_signal = _material_click_words_signal(material or "")
    click_words_unit_ids = [u["id"] for u in units if _is_click_words_friendly_unit(u)]

    if click_words_signal >= 4 or len(click_words_unit_ids) >= 1:
        removed_click_words_reason = False
        filtered_not_recommended: List[Dict[str, Any]] = []
        for item in not_recommended:
            if str(item.get("task_type") or "").strip().upper() == "CLICK_WORDS":
                removed_click_words_reason = True
                continue
            filtered_not_recommended.append(item)
        not_recommended = filtered_not_recommended

        click_words_rec = _find_recommendation(recommendations, "CLICK_WORDS")
        if click_words_rec is None:
            recommendations.append(
                {
                    "task_type": "CLICK_WORDS",
                    "count": 2 if click_words_signal < 12 else 3,
                    "priority": "medium",
                    "covers_units": click_words_unit_ids or [u["id"] for u in units[: min(4, len(units))]],
                    "rationale": "Good fit for local factual distortions in terms, criteria, relations, and other concrete anchors.",
                }
            )
            _append_unique(
                warnings,
                "Heuristic adjustment: CLICK_WORDS was enabled because the material contains enough concrete anchors for local factual error-detection.",
            )
        elif removed_click_words_reason:
            _append_unique(
                warnings,
                "Heuristic adjustment: CLICK_WORDS was removed from not_recommended because this material supports factual error-detection tasks.",
            )

    visual_unit_ids = [
        u["id"]
        for u in units
        if u.get("modality") in {"visual", "mixed"} or _is_visualish_unit(u)
    ]
    spatial_visual_unit_ids = [
        u["id"]
        for u in units
        if u.get("modality") in {"visual", "mixed"} and _is_spatial_visual_unit(u)
    ]

    if illustrations_detected:
        click_rec = _find_recommendation(recommendations, "CLICK")
        if click_rec is None and visual_unit_ids:
            click_rec = {
                "task_type": "CLICK",
                "count": max(1, min(4, int(math.ceil(len(visual_unit_ids) / 3)))),
                "priority": "high" if len(visual_unit_ids) >= 2 else "medium",
                "covers_units": visual_unit_ids[: min(len(visual_unit_ids), 8)],
                "rationale": "Нужен для проверки визуального распознавания там, где текстовых форматов недостаточно.",
                "coverage_role": _default_recommendation_coverage_role("CLICK"),
                "count_rationale": _default_recommendation_count_rationale("CLICK", len(visual_unit_ids), True),
                "manual_only": True,
                "auto_generation_supported": False,
            }
            recommendations.append(click_rec)
            _append_unique(
                warnings,
                "Visual coverage was expanded with CLICK because the material contains image-dependent learning targets.",
            )

        draw_rec = _find_recommendation(recommendations, "DRAW")
        if draw_rec is None and spatial_visual_unit_ids:
            draw_rec = {
                "task_type": "DRAW",
                "count": max(1, min(3, int(math.ceil(len(spatial_visual_unit_ids) / 3)))),
                "priority": "medium",
                "covers_units": spatial_visual_unit_ids[: min(len(spatial_visual_unit_ids), 6)],
                "rationale": "Нужен для проверки пространственного распознавания и выделения правильных зон на изображениях.",
                "coverage_role": _default_recommendation_coverage_role("DRAW"),
                "count_rationale": _default_recommendation_count_rationale("DRAW", len(spatial_visual_unit_ids), True),
                "manual_only": True,
                "auto_generation_supported": False,
            }
            recommendations.append(draw_rec)
            _append_unique(
                warnings,
                "Visual coverage was expanded with DRAW where the material requires spatial or contour-based recognition.",
            )

        existing_note = str(data.get("illustrations_note") or "").strip()
        if existing_note:
            if "manual" not in existing_note.lower():
                data["illustrations_note"] = existing_note + " Manual image-task authoring is recommended."
        else:
            data["illustrations_note"] = "Visual examples detected; manual image-task authoring is recommended."
        illustrations_note = str(data.get("illustrations_note") or "").strip()

        _append_unique(
            warnings,
            "Visual content detected: text-only AI generation will not fully cover image recognition skills; add manual image tasks.",
        )

    coverage_map = {uid: 0 for uid in valid_unit_ids}
    for rec in recommendations:
        rec["task_type"] = str(rec.get("task_type") or "").upper()
        rec["count"] = max(1, min(20, _coerce_int(rec.get("count"), 1)))
        rec["priority"] = _normalize_priority(rec.get("priority"))
        rec["covers_units"] = _unique_int_list(rec.get("covers_units"), allowed=valid_unit_ids)
        if not str(rec.get("rationale") or "").strip():
            rec["rationale"] = "Recommended based on educational unit fit and coverage balance."
        manual_only = _coerce_boolish(rec.get("manual_only"), default=rec["task_type"] in _MANUAL_ANALYSIS_TASK_TYPES)
        rec["manual_only"] = manual_only
        rec["auto_generation_supported"] = False if manual_only else _coerce_boolish(
            rec.get("auto_generation_supported"),
            default=True,
        )
        if not str(rec.get("coverage_role") or "").strip():
            rec["coverage_role"] = _default_recommendation_coverage_role(rec["task_type"])
        if not str(rec.get("count_rationale") or "").strip():
            rec["count_rationale"] = _default_recommendation_count_rationale(
                rec["task_type"],
                len(rec["covers_units"]),
                manual_only,
            )
        if not str(rec.get("editor_label") or "").strip():
            rec["editor_label"] = _editor_label_for_task_type(rec["task_type"])
        recommendation_status = str(rec.get("recommendation_status") or "").strip().lower()
        if recommendation_status not in {"recommended_auto", "recommended_manual", "conditionally_recommended"}:
            rec["recommendation_status"] = _default_recommendation_status(
                rec["task_type"],
                manual_only,
                bool(rec.get("auto_generation_supported")),
            )
        covered_units = _recommendation_units(rec, units)
        if not str(rec.get("generation_focus") or "").strip():
            rec["generation_focus"] = _default_recommendation_generation_focus(rec["task_type"])
        coverage_strategy = str(rec.get("coverage_strategy") or "").strip().lower()
        if coverage_strategy not in {"breadth_first", "high_risk_first", "misconception_first", "visual_first"}:
            rec["coverage_strategy"] = _default_recommendation_coverage_strategy(rec["task_type"], covered_units)
        rec["assessable_anchors"] = _normalize_string_list(
            rec.get("assessable_anchors") or _default_recommendation_assessable_anchors(rec, units),
            max_items=8,
        )
        rec["design_candidates"] = _normalize_string_list(
            rec.get("design_candidates") or _default_recommendation_design_candidates(rec, units),
            max_items=8,
        )
        if rec["task_type"] in _MANUAL_ANALYSIS_TASK_TYPES:
            manual_authoring = _normalize_manual_authoring(rec.get("manual_authoring"))
            if manual_authoring is None:
                manual_authoring = _default_visual_manual_authoring(rec, units, illustrations_note)
            if not manual_authoring.get("figure_refs"):
                inferred_refs = _extract_figure_refs(illustrations_note, *(u.get("evidence") for u in covered_units))
                if inferred_refs:
                    manual_authoring["figure_refs"] = inferred_refs
            rec["manual_authoring"] = manual_authoring
            if not rec["manual_authoring"].get("figure_refs"):
                _append_unique(
                    warnings,
                    f"Authoring note: {rec['task_type']} should be tied to concrete figure references, captions or text anchors before manual creation.",
                )
        for uid in rec["covers_units"]:
            coverage_map[uid] += 1

    uncovered_units = [uid for uid in sorted(valid_unit_ids) if coverage_map.get(uid, 0) == 0]
    if uncovered_units:
        fallback_rec = _find_recommendation(recommendations, "TEST") or _find_recommendation(recommendations, "CLICK_TEXT")
        if fallback_rec is None:
            fallback_rec = {
                "task_type": "TEST",
                "count": 1,
                "priority": "high",
                "covers_units": [],
                "rationale": "Added to cover educational units missed by the analysis response.",
            }
            recommendations.append(fallback_rec)
        fallback_rec["covers_units"] = _unique_int_list(
            list(fallback_rec.get("covers_units") or []) + uncovered_units,
            allowed=valid_unit_ids,
        )
        fallback_rec["count"] = min(20, int(fallback_rec.get("count", 1)) + max(1, int(math.ceil(len(uncovered_units) * 0.6))))
        fallback_rec["priority"] = "high"
        _append_unique(
            warnings,
            f"Heuristic adjustment: {len(uncovered_units)} educational unit(s) were not covered by AI recommendations; coverage was expanded automatically.",
        )

    # Ensure the user sees guidance for every supported text task type
    # even if the model omitted some types entirely.
    recommended_types = {str(r.get("task_type") or "").upper() for r in recommendations}
    notrec_types = {str(n.get("task_type") or "").upper() for n in not_recommended}
    missing_types = [t for t in sorted(_ANALYSIS_TASK_TYPES) if t not in recommended_types and t not in notrec_types]
    for missing_type in missing_types:
        if missing_type == "SEQUENCE":
            reason = "Не рекомендован, потому что материал не задаёт достаточно явную структуру, порядок или группировку."
        elif missing_type == "OPEN_ANSWER":
            reason = "Не рекомендован как приоритетный формат, потому что материал лучше проверяется более компактными или более структурными способами."
        elif missing_type == "CLICK_WORDS":
            reason = "Не рекомендован, потому что в материале недостаточно устойчивых фактических опор для правдоподобных искажений."
        elif missing_type == "CLICK_TEXT":
            reason = "Не рекомендован, потому что материал не даёт достаточно сильной базы для правдоподобных контрастных утверждений."
        elif missing_type == "CLICK":
            reason = "Не рекомендован, потому что материал не требует отдельной проверки визуального распознавания по изображению."
        elif missing_type == "DRAW":
            reason = "Не рекомендован, потому что материал не требует пространственного выделения зон или контуров на изображении."
        else:  # TEST
            reason = "Не рекомендован как основной формат, потому что материал требует не столько узнавания фактов, сколько других когнитивных действий."
        not_recommended.append(
            {
                "task_type": missing_type,
                "editor_label": _editor_label_for_task_type(missing_type),
                "recommendation_status": "not_recommended",
                "reason": reason,
            }
        )

    order_index = {"TEST": 0, "CLICK_TEXT": 1, "OPEN_ANSWER": 2, "CLICK_WORDS": 3, "SEQUENCE": 4, "CLICK": 5, "DRAW": 6}
    recommendations.sort(
        key=lambda r: (
            order_index.get(str(r.get("task_type") or "").upper(), 99),
            -_PRIORITY_SCORE.get(_normalize_priority(r.get("priority")), 1),
            str(r.get("task_type") or ""),
        )
    )

    data["recommendations"] = recommendations
    data["not_recommended"] = not_recommended
    data["warnings"] = warnings
    data = apply_capability_matrix_v1_annotations(data)
    return normalize_analysis_schema_v2(data, material=material)


def _guess_target_language(material: str) -> str:
    if not isinstance(material, str) or not material.strip():
        return "unknown"
    cyr = sum(1 for ch in material if "а" <= ch.lower() <= "я" or ch.lower() == "ё"
              or ch.lower() in "іїєґ")
    lat = sum(1 for ch in material if "a" <= ch.lower() <= "z")
    if cyr > lat * 1.3:
        ua_markers = sum(1 for ch in material if ch.lower() in "іїєґ")
        ru_markers = sum(1 for ch in material if ch.lower() in "ыэёъ")
        if ua_markers > ru_markers * 1.5 and ua_markers >= 3:
            return "uk"
        return "ru"
    if lat > cyr * 1.3:
        return "en"
    if cyr == 0 and lat == 0:
        return "unknown"
    return "mixed"


def _build_generation_prompt(
    task_type: str,
    count: int,
    educational_units: List[Dict],
    target_language: str = "unknown",
    extra_instructions: Optional[str] = None,
) -> str:
    """Собирает финальный промпт для генерации заданий конкретного типа."""
    base = _GENERATION_PROMPTS.get(task_type, "")
    if not base:
        raise ValueError(f"Unknown task type: {task_type}")

    units_text = ""
    if educational_units:
        lines = []
        for u in educational_units:
            title = u.get("title", "")
            desc = u.get("description", "")
            evidence = str(u.get("evidence") or "").strip()
            uid = u.get("id")
            unit_type = u.get("type")
            explicitness = str(u.get("explicitness") or "").strip().lower()
            modality = str(u.get("modality") or "").strip().lower()
            assessment_risk = str(u.get("assessment_risk") or "").strip().lower()
            prefix = f"[{uid}] " if uid is not None else ""
            attrs = []
            if unit_type:
                attrs.append(str(unit_type))
            if explicitness in {"explicit", "inferred"}:
                attrs.append(f"explicitness={explicitness}")
            if modality in {"text", "visual", "mixed"}:
                attrs.append(f"modality={modality}")
            if assessment_risk in {"low", "medium", "high"}:
                attrs.append(f"risk={assessment_risk}")
            suffix = f" ({'; '.join(attrs)})" if attrs else ""
            line = f"- {prefix}{title}{suffix}"
            if desc:
                line += f": {desc}"
            if evidence:
                compact_evidence = re.sub(r"\s+", " ", evidence).strip()
                if len(compact_evidence) > 220:
                    compact_evidence = compact_evidence[:217].rstrip() + "..."
                line += f"\n  evidence: {compact_evidence}"
            lines.append(line)
        units_text = "\n".join(lines)

    params = f"\n\n<generation_parameters>\nСгенерируй ровно {count} заданий."
    if units_text:
        params += f"\nСфокусируйся на следующих образовательных единицах:\n{units_text}"
    if units_text:
        if count >= len(educational_units):
            params += "\nCoverage rule: cover each listed educational unit at least once before adding a second task on the same unit."
        else:
            params += "\nCoverage rule: prioritize breadth across listed units and avoid duplicate testing of the same fact."
        params += "\nGrounding rule: each generated task must be answerable from the listed units/evidence only (no external knowledge additions)."
        params += "\nGrounding rule: preserve exact factual anchors from evidence when available (numbers, dates, thresholds, named categories)."
    params += f"\nTarget language for generated task text: {target_language}."
    params += "\n</generation_parameters>"

    guardrail_lines = list(_GENERATION_GUARDRAILS.get("GLOBAL", []))
    guardrail_lines.extend(_GENERATION_GUARDRAILS.get(task_type, []))
    guardrails = ""
    if guardrail_lines:
        guardrails = (
            "\n\n<generation_guardrails>\n"
            + "\n".join(f"- {line}" for line in guardrail_lines)
            + "\n</generation_guardrails>"
        )
    repair_block = ""
    if isinstance(extra_instructions, str) and extra_instructions.strip():
        repair_block = (
            "\n\n<generation_repair_instructions>\n"
            + extra_instructions.strip()
            + "\n</generation_repair_instructions>"
        )

    return base + params + guardrails + repair_block


# ---------------------------------------------------------------------------
# Response parsing
# ---------------------------------------------------------------------------


def _strip_markdown_fence(text: str) -> str:
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if s.startswith("```json"):
        s = s[7:]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[:-3]
    return s.strip()


def _escape_control_chars_in_json_strings(json_str: str) -> str:
    cleaned = []
    in_string = False
    escape_next = False
    for char in json_str:
        if escape_next:
            cleaned.append(char)
            escape_next = False
        elif char == "\\":
            cleaned.append(char)
            escape_next = True
        elif char == '"':
            in_string = not in_string
            cleaned.append(char)
        elif in_string and char == "\n":
            cleaned.append("\\n")
        elif in_string and char == "\t":
            cleaned.append("\\t")
        elif in_string and char == "\r":
            cleaned.append("\\r")
        else:
            cleaned.append(char)
    return "".join(cleaned)


def _remove_trailing_commas_outside_strings(text: str) -> str:
    if not isinstance(text, str) or "," not in text:
        return text
    out = []
    in_string = False
    escape_next = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if escape_next:
            out.append(ch)
            escape_next = False
            i += 1
            continue
        if ch == "\\":
            out.append(ch)
            escape_next = True
            i += 1
            continue
        if ch == '"':
            in_string = not in_string
            out.append(ch)
            i += 1
            continue
        if not in_string and ch == ",":
            j = i + 1
            while j < n and text[j] in " \t\r\n":
                j += 1
            if j < n and text[j] in "}]":
                i += 1
                continue
        out.append(ch)
        i += 1
    return "".join(out)


def _iter_balanced_json_objects(text: str):
    """Yield balanced JSON object substrings using string-aware brace scanning."""
    if not isinstance(text, str):
        return
    n = len(text)
    i = 0
    while i < n:
        if text[i] != "{":
            i += 1
            continue
        start = i
        depth = 0
        in_string = False
        escape_next = False
        j = i
        while j < n:
            ch = text[j]
            if escape_next:
                escape_next = False
            elif ch == "\\":
                escape_next = True
            elif ch == '"':
                in_string = not in_string
            elif not in_string:
                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        yield text[start : j + 1]
                        break
            j += 1
        i = start + 1


def _try_parse_analysis_json_candidate(candidate: str) -> Optional[dict]:
    if not isinstance(candidate, str):
        return None
    s = _strip_markdown_fence(candidate)
    if not s:
        return None
    s = _escape_control_chars_in_json_strings(s)
    variants = [s]
    repaired = _remove_trailing_commas_outside_strings(s)
    if repaired != s:
        variants.append(repaired)
    for variant in variants:
        try:
            parsed = json.loads(variant)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and (
            "recommendations" in parsed or "educational_units" in parsed
        ):
            return parsed
    return None


def _heuristic_parse_analysis_from_prose(raw_text: str) -> Optional[dict]:
    """Best-effort fallback when model ignores JSON contract but returns usable prose/lists."""
    if not isinstance(raw_text, str) or not raw_text.strip():
        return None

    lines = [ln.strip() for ln in raw_text.splitlines()]
    anchor_idx = None
    anchor_tokens = [
        "образовательные единицы",
        "освітні одиниці",
        "educational units",
        "ключевые образовательные единицы",
        "ключові освітні одиниці",
        "выделю основные смысловые блоки",
        "виділю основні смислові блоки",
    ]
    for i, ln in enumerate(lines):
        low = ln.lower()
        if any(tok in low for tok in anchor_tokens):
            anchor_idx = i
            break

    scan_lines = lines[anchor_idx + 1 :] if anchor_idx is not None else lines
    units: List[Dict[str, Any]] = []
    seen_titles = set()
    unit_rx = re.compile(r"^\s*(\d{1,3})\s*[\.\)\-:]\s*(.+?)\s*$")

    def _classify_unit_type(text: str) -> str:
        low = text.lower()
        if any(t in low for t in ["классификац", "класифікац", "classification", "категор", "stages", "стади"]):
            return "classification"
        if any(t in low for t in ["процесс", "патогенез", "диагност", "лікуван", "лечени", "process", "mechan", "этап"]):
            return "process"
        if any(t in low for t in ["термин", "term", "определен", "definition"]):
            return "term"
        return "fact"

    def _extract_title_desc(payload: str) -> Tuple[str, str]:
        text = payload.strip().strip("*").strip()
        # Split on common delimiters, keeping the left part as title.
        for delim in (" - ", " — ", " – ", ": "):
            if delim in text:
                left, right = text.split(delim, 1)
                title = left.strip()
                desc = right.strip()
                return title[:120], desc[:220]
        return text[:120], text[:220]

    for ln in scan_lines:
        if not ln:
            continue
        m = unit_rx.match(ln)
        if not m:
            continue
        payload = m.group(2).strip()
        low_payload = payload.lower()
        if any(skip in low_payload for skip in [
            "задани", "завдан", "tasks", "рекоменд", "recommend",
            "объем", "обсяг", "volume", "размер текста", "size of text",
        ]):
            continue
        title, desc = _extract_title_desc(payload)
        if len(title) < 3:
            continue
        title_key = title.lower()
        if title_key in seen_titles:
            continue
        seen_titles.add(title_key)
        units.append(
            {
                "id": len(units) + 1,
                "title": title,
                "type": _classify_unit_type(payload),
                "description": desc,
                "explicitness": "inferred",
                "evidence": "heuristic extraction from freeform AI response",
                "modality": "text",
                "assessment_risk": "medium",
            }
        )
        if len(units) >= 24:
            break

    if len(units) < 4:
        return None

    unit_ids = [int(u["id"]) for u in units if isinstance(u.get("id"), int)]
    facts = [u for u in units if u.get("type") == "fact"]
    classifications = [u for u in units if u.get("type") == "classification"]
    processes = [u for u in units if u.get("type") == "process"]
    concepts_terms = [u for u in units if u.get("type") in {"concept", "term"}]
    sequence_like = []
    for u in units:
        blob = f"{u.get('title', '')} {u.get('description', '')}".lower()
        if any(tok in blob for tok in ["этап", "стад", "послед", "sequence", "order", "stage", "классификац", "classification"]):
            sequence_like.append(u)

    recommendations: List[Dict[str, Any]] = []
    test_units = facts + classifications
    if test_units:
        recommendations.append(
            {
                "task_type": "TEST",
                "count": max(4, min(12, int(math.ceil(len(test_units) * 0.6)))),
                "priority": "high",
                "covers_units": [u["id"] for u in test_units[: min(len(test_units), 16)]],
                "rationale": "Heuristic fallback: factual and classification-heavy units fit objective testing.",
            }
        )
    click_text_units = processes + classifications + concepts_terms
    if click_text_units:
        recommendations.append(
            {
                "task_type": "CLICK_TEXT",
                "count": max(2, min(7, int(math.ceil(len(click_text_units) * 0.25)) + 1)),
                "priority": "medium",
                "covers_units": [u["id"] for u in click_text_units[: min(len(click_text_units), 14)]],
                "rationale": "Heuristic fallback: suitable for distinctions, rules, and misconception checks.",
            }
        )
    open_units = processes + concepts_terms
    if open_units:
        recommendations.append(
            {
                "task_type": "OPEN_ANSWER",
                "count": max(2, min(5, int(math.ceil(len(open_units) * 0.18)) + 1)),
                "priority": "medium",
                "covers_units": [u["id"] for u in open_units[: min(len(open_units), 10)]],
                "rationale": "Heuristic fallback: process/concept units benefit from explanation-style answers.",
            }
        )
    if sequence_like:
        recommendations.append(
            {
                "task_type": "SEQUENCE",
                "count": min(2, max(1, len(sequence_like) // 6 or 1)),
                "priority": "low",
                "covers_units": [u["id"] for u in sequence_like[: min(len(sequence_like), 6)]],
                "rationale": "Heuristic fallback: sequence/ranking only where wording suggests explicit order or stages.",
            }
        )

    return {
        "material_volume": "medium",
        "educational_units": units,
        "recommendations": recommendations,
        "not_recommended": [],
        "illustrations_detected": False,
        "illustrations_note": None,
        "warnings": [
            "Heuristic fallback used: AI analysis response did not follow structured JSON format.",
        ],
    }


def parse_analysis_response(raw_text: str) -> dict:
    """
    Извлекает JSON из ответа ИИ-модели.
    Если блок обернут тегами <analysis_json> и </analysis_json>, берет его.
    Если теги не найдены, пытается взять первый валидный JSON-объект.
    """
    tag_match = re.search(
        r"<analysis_json>\s*(.*?)\s*</analysis_json>",
        raw_text,
        re.DOTALL | re.IGNORECASE,
    )
    if tag_match:
        inner = tag_match.group(1).strip()
        parsed = _try_parse_analysis_json_candidate(inner)
        if parsed is not None:
            return parsed
        for candidate in _iter_balanced_json_objects(inner):
            parsed = _try_parse_analysis_json_candidate(candidate)
            if parsed is not None:
                return parsed

    for fence_match in re.finditer(
        r"```(?:json)?\s*(.*?)\s*```",
        raw_text,
        re.DOTALL | re.IGNORECASE,
    ):
        parsed = _try_parse_analysis_json_candidate(fence_match.group(1))
        if parsed is not None:
            return parsed

    for candidate in _iter_balanced_json_objects(raw_text):
        parsed = _try_parse_analysis_json_candidate(candidate)
        if parsed is not None:
            return parsed

    heuristic = _heuristic_parse_analysis_from_prose(raw_text)
    if heuristic is not None:
        return heuristic

    if "<analysis_json" in (raw_text or "").lower() and "</analysis_json>" not in (raw_text or "").lower():
        raise ValueError("Cannot parse analysis response: truncated_analysis_json_block")
    raise ValueError("Cannot parse analysis response")


def parse_human_summary(raw_text: str) -> str:
    """Извлекает human_summary из ответа."""
    match = re.search(
        r"<human_summary>\s*(.*?)\s*</human_summary>",
        raw_text,
        re.DOTALL,
    )
    if match:
        return match.group(1).strip()
    return ""


def _split_long_segment_for_analysis(segment: str, hard_max_words: int) -> List[str]:
    text = str(segment or "").strip()
    if not text:
        return []
    words = text.split()
    if len(words) <= hard_max_words:
        return [text]

    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?])\s+(?=[A-ZА-ЯЁ0-9])", text)
        if s.strip()
    ]
    if len(sentences) <= 1:
        out: List[str] = []
        for i in range(0, len(words), hard_max_words):
            chunk = " ".join(words[i : i + hard_max_words]).strip()
            if chunk:
                out.append(chunk)
        return out

    out = []
    current: List[str] = []
    current_words = 0
    for sentence in sentences:
        sentence_words = len(sentence.split())
        if sentence_words > hard_max_words:
            if current:
                out.append(" ".join(current).strip())
                current = []
                current_words = 0
            out.extend(_split_long_segment_for_analysis(sentence, hard_max_words))
            continue
        if current and current_words + sentence_words > hard_max_words:
            out.append(" ".join(current).strip())
            current = [sentence]
            current_words = sentence_words
            continue
        current.append(sentence)
        current_words += sentence_words
    if current:
        out.append(" ".join(current).strip())
    return [chunk for chunk in out if chunk]


def _split_material_for_chunk_analysis(
    material: str,
    target_words: int = _ANALYSIS_CHUNK_TARGET_WORDS,
    hard_max_words: int = _ANALYSIS_CHUNK_HARD_MAX_WORDS,
    max_chunks: int = _ANALYSIS_CHUNK_MAX_COUNT,
) -> List[str]:
    text = str(material or "").strip()
    if not text:
        return []

    total_words = len(text.split())
    if total_words <= hard_max_words:
        return [text]

    raw_segments = [seg.strip() for seg in re.split(r"\n\s*\n+", text) if seg and seg.strip()]
    if not raw_segments:
        raw_segments = [text]

    segments: List[str] = []
    for seg in raw_segments:
        segments.extend(_split_long_segment_for_analysis(seg, hard_max_words))
    if not segments:
        return [text]

    if max_chunks > 0:
        dynamic_target = int(math.ceil(total_words / max_chunks))
        target_words = max(target_words, min(hard_max_words, dynamic_target + 40))

    chunks: List[str] = []
    current_parts: List[str] = []
    current_words = 0
    min_flush_threshold = max(180, int(target_words * 0.6))

    for seg in segments:
        seg_words = len(seg.split())
        if seg_words <= 0:
            continue
        would_exceed_hard = bool(current_parts and (current_words + seg_words > hard_max_words))
        would_exceed_target = bool(
            current_parts
            and (current_words + seg_words > target_words)
            and current_words >= min_flush_threshold
        )
        if would_exceed_hard or would_exceed_target:
            chunks.append("\n\n".join(current_parts).strip())
            current_parts = [seg]
            current_words = seg_words
            continue
        current_parts.append(seg)
        current_words += seg_words
    if current_parts:
        chunks.append("\n\n".join(current_parts).strip())

    chunks = [c for c in chunks if c]
    if len(chunks) <= max_chunks or max_chunks <= 0:
        return chunks or [text]

    recombined: List[str] = []
    current_parts = []
    current_words = 0
    target_words_2 = max(target_words, int(math.ceil(total_words / max_chunks)) + 120)
    for chunk in chunks:
        chunk_words = len(chunk.split())
        if current_parts and (current_words + chunk_words > target_words_2) and len(recombined) < max_chunks - 1:
            recombined.append("\n\n".join(current_parts).strip())
            current_parts = [chunk]
            current_words = chunk_words
            continue
        current_parts.append(chunk)
        current_words += chunk_words
    if current_parts:
        recombined.append("\n\n".join(current_parts).strip())

    return [c for c in recombined if c] or [text]


def _analysis_unit_fingerprint(unit: Dict[str, Any]) -> str:
    title = re.sub(r"\s+", " ", str(unit.get("title") or "").strip().lower())
    desc = re.sub(r"\s+", " ", str(unit.get("description") or "").strip().lower())
    evidence = re.sub(r"\s+", " ", str(unit.get("evidence") or "").strip().lower())
    unit_type = str(unit.get("type") or "").strip().lower()
    return "|".join([unit_type, title[:120], desc[:180], evidence[:80]])


def _merge_chunk_analysis_payloads(
    chunk_analyses: List[Dict[str, Any]],
    chunk_human_summaries: List[str],
    material: str,
    fallback_target_language: str,
) -> Tuple[str, Dict[str, Any]]:
    merged_units: List[Dict[str, Any]] = []
    fp_to_index: Dict[str, int] = {}
    chunk_local_to_global: List[Dict[int, int]] = []

    for chunk_data in chunk_analyses:
        local_map: Dict[int, int] = {}
        for raw_unit in (chunk_data.get("educational_units") or []):
            if not isinstance(raw_unit, dict):
                continue
            unit = dict(raw_unit)
            try:
                local_id = int(unit.get("id"))
            except Exception:
                local_id = None
            fp = _analysis_unit_fingerprint(unit)
            if fp and fp in fp_to_index:
                existing = merged_units[fp_to_index[fp]]
                if not str(existing.get("description") or "").strip() and str(unit.get("description") or "").strip():
                    existing["description"] = unit.get("description")
                if not str(existing.get("evidence") or "").strip() and str(unit.get("evidence") or "").strip():
                    existing["evidence"] = unit.get("evidence")
                if str(existing.get("modality") or "").lower() != str(unit.get("modality") or "").lower():
                    existing["modality"] = "mixed"
                if str(unit.get("explicitness") or "").lower() == "explicit":
                    existing["explicitness"] = "explicit"
                risk_score = {"low": 0, "medium": 1, "high": 2}
                e_risk = str(existing.get("assessment_risk") or "low").lower()
                n_risk = str(unit.get("assessment_risk") or "low").lower()
                if risk_score.get(n_risk, 0) > risk_score.get(e_risk, 0):
                    existing["assessment_risk"] = n_risk
                if local_id is not None:
                    local_map[local_id] = int(existing.get("id"))
                continue

            global_id = len(merged_units) + 1
            unit["id"] = global_id
            merged_units.append(unit)
            if fp:
                fp_to_index[fp] = len(merged_units) - 1
            if local_id is not None:
                local_map[local_id] = global_id
        chunk_local_to_global.append(local_map)

    merged_recommendations: List[Dict[str, Any]] = []
    for chunk_idx, chunk_data in enumerate(chunk_analyses):
        local_map = chunk_local_to_global[chunk_idx] if chunk_idx < len(chunk_local_to_global) else {}
        for rec in (chunk_data.get("recommendations") or []):
            if not isinstance(rec, dict):
                continue
            task_type = str(rec.get("task_type") or "").strip().upper()
            if task_type not in _ANALYSIS_TASK_TYPES:
                continue
            mapped_covers: List[int] = []
            for raw_uid in (rec.get("covers_units") or []):
                try:
                    mapped = local_map.get(int(raw_uid))
                except Exception:
                    mapped = None
                if mapped is not None:
                    mapped_covers.append(mapped)
            merged_recommendations.append(
                {
                    "task_type": task_type,
                    "count": rec.get("count", 1),
                    "priority": rec.get("priority", "medium"),
                    "covers_units": mapped_covers,
                    "rationale": rec.get("rationale") or "",
                }
            )

    # --- Normalize merged recommendation counts (chunked inflation fix) ---
    total_words = len((material or "").split())
    if total_words <= 400:
        target_tasks = max(2, min(5, len(merged_units)))
    elif total_words <= 1200:
        target_tasks = max(8, min(15, len(merged_units) + 2))
    elif total_words <= 3000:
        target_tasks = max(12, min(25, len(merged_units) + 3))
    else:
        target_tasks = max(20, min(40, len(merged_units) + 5))
    total_count = sum(int(r.get("count") or 1) for r in merged_recommendations)
    if total_count > target_tasks * 1.3 and total_count > 0:
        scale = target_tasks / total_count
        for rec in merged_recommendations:
            old_c = int(rec.get("count") or 1)
            rec["count"] = max(1, round(old_c * scale))

    merged_not_recommended: List[Dict[str, Any]] = []
    seen_notrec = set()
    for chunk_data in chunk_analyses:
        for item in (chunk_data.get("not_recommended") or []):
            if not isinstance(item, dict):
                continue
            task_type = str(item.get("task_type") or "").strip()
            reason = str(item.get("reason") or "").strip()
            if not task_type:
                continue
            key = (task_type.upper(), reason)
            if key in seen_notrec:
                continue
            seen_notrec.add(key)
            merged_not_recommended.append({"task_type": task_type, "reason": reason})

    warnings: List[str] = []
    for chunk_data in chunk_analyses:
        for warning in (chunk_data.get("warnings") or []):
            _append_unique(warnings, str(warning))

    illustrations_detected = any(bool(chunk_data.get("illustrations_detected")) for chunk_data in chunk_analyses)
    note_parts: List[str] = []
    for chunk_data in chunk_analyses:
        note = str(chunk_data.get("illustrations_note") or "").strip()
        if note and note not in note_parts:
            note_parts.append(note)

    # --- Merge v2 fields ---
    def _remap_unit_ids(ids: Any, local_map: Dict[int, int]) -> List[int]:
        out = []
        if not isinstance(ids, list):
            return out
        for raw in ids:
            try:
                mapped = local_map.get(int(raw))
            except Exception:
                mapped = None
            if mapped is not None:
                out.append(mapped)
        return out

    merged_learning_chunks: List[Dict[str, Any]] = []
    chunk_id_counter = 0
    for chunk_idx, chunk_data in enumerate(chunk_analyses):
        local_map = chunk_local_to_global[chunk_idx] if chunk_idx < len(chunk_local_to_global) else {}
        for lc in (chunk_data.get("learning_chunks") or []):
            if not isinstance(lc, dict):
                continue
            lc = dict(lc)
            chunk_id_counter += 1
            lc["chunk_id"] = f"chunk_{chunk_id_counter}"
            raw_uids = lc.get("unit_ids") or lc.get("units_covered") or []
            lc["unit_ids"] = _remap_unit_ids(raw_uids, local_map)
            lc.pop("units_covered", None)
            merged_learning_chunks.append(lc)

    merged_tps: List[Dict[str, Any]] = []
    tps_by_type: Dict[str, Dict[str, Any]] = {}
    suitability_rank = {"high": 3, "medium": 2, "low": 1, "none": 0}
    for chunk_idx, chunk_data in enumerate(chunk_analyses):
        local_map = chunk_local_to_global[chunk_idx] if chunk_idx < len(chunk_local_to_global) else {}
        for entry in (chunk_data.get("type_progression_suitability") or []):
            if not isinstance(entry, dict):
                continue
            tt = str(entry.get("task_type") or "").strip().upper()
            if not tt:
                continue
            existing = tps_by_type.get(tt)
            new_suit = str(entry.get("suitability") or "none").lower()
            if existing is None:
                tps_by_type[tt] = dict(entry)
                tps_by_type[tt]["task_type"] = tt
            else:
                old_suit = str(existing.get("suitability") or "none").lower()
                if suitability_rank.get(new_suit, 0) > suitability_rank.get(old_suit, 0):
                    tps_by_type[tt] = dict(entry)
                    tps_by_type[tt]["task_type"] = tt
    merged_tps = list(tps_by_type.values())

    merged_future_caps: List[Dict[str, Any]] = []
    seen_cap_ids: set = set()
    for chunk_data in chunk_analyses:
        for fc in (chunk_data.get("future_capabilities") or []):
            if not isinstance(fc, dict):
                continue
            cap_id = str(fc.get("capability_id") or "").strip()
            if cap_id and cap_id not in seen_cap_ids:
                seen_cap_ids.add(cap_id)
                merged_future_caps.append(fc)

    merged_microcards: List[Dict[str, Any]] = []
    mc_counter = 0
    for chunk_idx, chunk_data in enumerate(chunk_analyses):
        local_map = chunk_local_to_global[chunk_idx] if chunk_idx < len(chunk_local_to_global) else {}
        for mc in (chunk_data.get("microcards_candidates") or []):
            if not isinstance(mc, dict):
                continue
            mc = dict(mc)
            mc_counter += 1
            mc["candidate_id"] = f"mc_{mc_counter}"
            raw_uid = mc.get("unit_id")
            if raw_uid is not None:
                try:
                    mc["unit_id"] = local_map.get(int(raw_uid), int(raw_uid))
                except Exception:
                    pass
            merged_microcards.append(mc)

    merged_raw = {
        "target_language": fallback_target_language,
        "material_volume": "large" if len((material or "").split()) >= _ANALYSIS_CHUNK_TRIGGER_WORDS else "medium",
        "educational_units": merged_units,
        "recommendations": merged_recommendations,
        "not_recommended": merged_not_recommended,
        "illustrations_detected": illustrations_detected,
        "illustrations_note": " ".join(note_parts[:2]).strip() or None,
        "warnings": warnings,
        "learning_chunks": merged_learning_chunks,
        "type_progression_suitability": merged_tps,
        "future_capabilities": merged_future_caps,
        "microcards_candidates": merged_microcards,
    }
    merged_normalized = _ensure_analysis_quality(merged_raw, material, fallback_target_language)
    _append_unique(
        merged_normalized.setdefault("warnings", []),
        f"Chunked analysis fallback used: merged {len(chunk_analyses)} chunk analyses to reduce output-limit risk.",
    )

    unique_summaries: List[str] = []
    seen_summary = set()
    for raw_summary in chunk_human_summaries:
        summary = str(raw_summary or "").strip()
        if not summary:
            continue
        key = re.sub(r"\s+", " ", summary).strip().lower()
        if key in seen_summary:
            continue
        seen_summary.add(key)
        unique_summaries.append(summary)
    if not unique_summaries:
        human_summary = "Material was analyzed in chunks and merged into one structured coverage plan."
    elif len(unique_summaries) == 1:
        human_summary = unique_summaries[0]
    else:
        human_summary = ("Material was analyzed in chunks. " + " ".join(unique_summaries[:3])).strip()

    return human_summary, merged_normalized


# ---------------------------------------------------------------------------
# Daily limits tracker
# ---------------------------------------------------------------------------


class DailyLimitTracker:
    """Потокобезопасный трекер дневных лимитов загрузок."""

    def __init__(self, max_files_per_day: int = 3):
        self.max_files_per_day = max_files_per_day
        self._lock = threading.Lock()
        self._usage: Dict[str, Dict[str, int]] = {}  # user_id -> {"date": "YYYY-MM-DD", "count": N}

    def check_limit(self, user_id: str) -> Tuple[bool, int, int]:
        """Проверить лимит. Возвращает (allowed, remaining, max)."""
        with self._lock:
            today = date.today().isoformat()
            entry = self._usage.get(user_id, {})
            if entry.get("date") != today:
                entry = {"date": today, "count": 0}
                self._usage[user_id] = entry
            remaining = max(0, self.max_files_per_day - entry["count"])
            return remaining > 0, remaining, self.max_files_per_day

    def increment(self, user_id: str) -> None:
        """Увеличить счётчик использования."""
        with self._lock:
            today = date.today().isoformat()
            entry = self._usage.get(user_id, {})
            if entry.get("date") != today:
                entry = {"date": today, "count": 0}
                self._usage[user_id] = entry
            entry["count"] += 1

    def get_info(self, user_id: str) -> Dict[str, Any]:
        """Информация о лимите для API-ответа."""
        allowed, remaining, max_files = self.check_limit(user_id)
        today = date.today()
        tomorrow_midnight = datetime(today.year, today.month, today.day, 0, 0, 0)
        # Простой расчёт — обнуление в 00:00 следующего дня
        from datetime import timedelta
        resets_at = (today + timedelta(days=1)).isoformat() + "T00:00:00Z"
        return {
            "files_remaining": remaining,
            "max_files_per_day": max_files,
            "resets_at": resets_at,
        }


# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------


def load_ai_config(data_dir: Path) -> Dict[str, Any]:
    """Загрузить конфигурацию AI-провайдеров из ai_config.json."""
    config_path = data_dir / "ai_config.json"
    loaded: Dict[str, Any] = {}
    if not config_path.exists():
        logger.warning("[AI] ai_config.json not found at %s", config_path)
    else:
        try:
            with open(config_path, "r", encoding="utf-8-sig") as f:
                loaded = json.load(f)
            _warn_on_file_based_provider_secrets(loaded, config_path)
        except Exception as e:
            logger.error("[AI] Failed to load ai_config.json: %s", e)
            loaded = {}
    return _apply_env_ai_config_overrides(loaded)


# ---------------------------------------------------------------------------
# Main service
# ---------------------------------------------------------------------------


class AIGenerationService:
    """Сервис генерации заданий с цепочкой фолбеков по провайдерам."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self._config: Dict[str, Any] = {}
        self._providers: List[AIProviderBase] = []
        self._active_provider: Optional[AIProviderBase] = None
        self._daily_tracker = DailyLimitTracker()
        self._last_chain_attempts: List[Dict[str, Any]] = []
        self._current_request_chain_attempts: Optional[List[Dict[str, Any]]] = None
        self._last_request_chain_attempts: List[Dict[str, Any]] = []
        self._provider_cooldown_until: Dict[str, float] = {}
        self._load_config()

    def _load_config(self) -> None:
        """Загрузить конфиг и инициализировать провайдеров."""
        self._config = load_ai_config(self.data_dir)
        if not self._config:
            logger.info("[AI] No AI config — AI generation disabled")
            return

        providers_cfg = self._config.get("providers", {})
        fallback_order = self._config.get("fallback_order", ["openrouter", "gemini", "groq"])
        timeout = self._config.get("timeout_seconds", 60)

        # Обновить лимиты
        rate_limits = self._config.get("rate_limits", {})
        max_files = rate_limits.get("max_files_per_day", 3)
        self._daily_tracker.max_files_per_day = max_files

        self._providers = []
        for name in fallback_order:
            pcfg = providers_cfg.get(name, {})
            if not pcfg.get("enabled", False):
                continue
            api_key = pcfg.get("api_key", "")
            if not api_key:
                continue
            model = pcfg.get("model", "")
            cls = _PROVIDER_CLASSES.get(name)
            if cls is None:
                logger.warning("[AI] Unknown provider: %s", name)
                continue

            model_candidates: List[str] = []
            if model:
                model_candidates.append(str(model))
            fallback_models = pcfg.get("fallback_models", [])
            if isinstance(fallback_models, list):
                for fallback_model in fallback_models:
                    fallback_model_str = str(fallback_model or "").strip()
                    if fallback_model_str and fallback_model_str not in model_candidates:
                        model_candidates.append(fallback_model_str)

            if not model_candidates:
                model_candidates = [""]

            for model_idx, model_name in enumerate(model_candidates, start=1):
                if model_name:
                    provider = cls(api_key=api_key, model=model_name, timeout=timeout)
                else:
                    provider = cls(api_key=api_key, timeout=timeout)
                if len(model_candidates) > 1:
                    provider.name = f"{name}:{model_idx}"
                self._providers.append(provider)
                logger.info(
                    "[AI] Provider registered: %s (model=%s)",
                    provider.name,
                    provider.model,
                )

    def reload_config(self) -> None:
        """Перезагрузить конфигурацию (например, после изменения ключей)."""
        self._load_config()

    def apply_user_keys(self, user_ai_keys: Dict[str, str]) -> None:
        """Apply user-provided API keys on top of the base config.

        *user_ai_keys* is a dict like ``{"openrouter": "sk-...", "gemini": "...", "groq": "..."}``.
        Only non-empty values are used.  Empty strings or missing keys are ignored.
        If the user provides at least one valid key the service becomes ``is_configured``.
        """
        if not user_ai_keys or not isinstance(user_ai_keys, dict):
            # No user keys — fall back to global config
            self._load_config()
            return

        # Start from global config (or empty)
        base_config = load_ai_config(self.data_dir) or {}
        providers_cfg = dict(base_config.get("providers", {}))
        fallback_order = base_config.get("fallback_order", ["openrouter", "gemini", "groq"])
        timeout = base_config.get("timeout_seconds", 60)

        # Merge user keys into providers config
        for provider_name, api_key in user_ai_keys.items():
            api_key = str(api_key or "").strip()
            if not api_key:
                continue
            if provider_name not in providers_cfg:
                providers_cfg[provider_name] = {}
            providers_cfg[provider_name]["api_key"] = api_key
            providers_cfg[provider_name]["enabled"] = True
            # Ensure provider is in fallback order
            if provider_name not in fallback_order:
                fallback_order.append(provider_name)

        # Rebuild providers list
        self._config = base_config
        self._config["providers"] = providers_cfg
        self._config["fallback_order"] = fallback_order

        # Update rate limits
        rate_limits = self._config.get("rate_limits", {})
        max_files = rate_limits.get("max_files_per_day", 3)
        self._daily_tracker.max_files_per_day = max_files

        self._providers = []
        for name in fallback_order:
            pcfg = providers_cfg.get(name, {})
            if not pcfg.get("enabled", False):
                continue
            key = pcfg.get("api_key", "")
            if not key:
                continue
            model = pcfg.get("model", "")
            cls = _PROVIDER_CLASSES.get(name)
            if cls is None:
                continue

            model_candidates: List[str] = []
            if model:
                model_candidates.append(str(model))
            fallback_models = pcfg.get("fallback_models", [])
            if isinstance(fallback_models, list):
                for fm in fallback_models:
                    fm_str = str(fm or "").strip()
                    if fm_str and fm_str not in model_candidates:
                        model_candidates.append(fm_str)
            if not model_candidates:
                model_candidates = [""]

            for model_idx, model_name in enumerate(model_candidates, start=1):
                if model_name:
                    provider = cls(api_key=key, model=model_name, timeout=timeout)
                else:
                    provider = cls(api_key=key, timeout=timeout)
                if len(model_candidates) > 1:
                    provider.name = f"{name}:{model_idx}"
                self._providers.append(provider)
                logger.info(
                    "[AI] User-key provider registered: %s (model=%s)",
                    provider.name,
                    provider.model,
                )

    @staticmethod
    def get_user_ai_keys(user_settings: Dict[str, Any]) -> Dict[str, str]:
        """Extract AI keys dict from user profile settings."""
        ai_keys = user_settings.get("ai_keys", {})
        if not isinstance(ai_keys, dict):
            return {}
        return {
            k: str(v) for k, v in ai_keys.items()
            if k in ("openrouter", "gemini", "groq") and v
        }

    @staticmethod
    def has_user_ai_keys(user_settings: Dict[str, Any]) -> bool:
        """Check if user has at least one non-empty AI key."""
        keys = AIGenerationService.get_user_ai_keys(user_settings)
        return any(v.strip() for v in keys.values())

    # ----- Provider chain tracing -----

    def _begin_provider_chain_trace(self) -> None:
        self._current_request_chain_attempts = []

    def _append_provider_chain_attempts(
        self,
        stage: str,
        attempts: Optional[List[Dict[str, Any]]],
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if self._current_request_chain_attempts is None:
            self._current_request_chain_attempts = []
        for item in attempts or []:
            if not isinstance(item, dict):
                continue
            entry = dict(item)
            entry["stage"] = stage
            if metadata:
                for key, value in metadata.items():
                    if key not in entry:
                        entry[key] = value
            self._current_request_chain_attempts.append(entry)

    def _end_provider_chain_trace(self) -> None:
        current = list(self._current_request_chain_attempts or [])
        self._last_request_chain_attempts = current
        self._current_request_chain_attempts = None

    def consume_last_provider_chain_attempts(self) -> List[Dict[str, Any]]:
        attempts = list(self._last_request_chain_attempts or [])
        self._last_request_chain_attempts = []
        return attempts

    def _iter_provider_chain(
        self,
        start_after_provider: Optional[str] = None,
        preferred_provider_names: Optional[List[str]] = None,
    ) -> List[AIProviderBase]:
        if not self._providers:
            return []
        providers_chain = list(self._providers)
        if preferred_provider_names:
            preferred_seen = set()
            preferred_ordered: List[AIProviderBase] = []
            preferred_set = {str(name) for name in preferred_provider_names if str(name).strip()}
            for wanted_name in preferred_provider_names:
                wanted_name = str(wanted_name or "").strip()
                if not wanted_name or wanted_name in preferred_seen:
                    continue
                for provider in providers_chain:
                    if provider.name == wanted_name:
                        preferred_ordered.append(provider)
                        preferred_seen.add(wanted_name)
                        break
            if preferred_set:
                providers_chain = preferred_ordered + [
                    provider for provider in providers_chain if provider.name not in preferred_set
                ]
        if not start_after_provider:
            return providers_chain
        for idx, provider in enumerate(providers_chain):
            if provider.name == start_after_provider:
                return list(providers_chain[idx + 1 :])
        return providers_chain

    def _provider_cooldown_remaining(self, provider_name: str) -> float:
        until = float(self._provider_cooldown_until.get(provider_name, 0.0) or 0.0)
        return max(0.0, until - time.time())

    def _mark_provider_rate_limit_cooldown(self, provider: AIProviderBase, error: Exception) -> None:
        if not isinstance(error, HTTPError) or getattr(error, "code", None) != 429:
            return

        now_ts = time.time()
        default_seconds = float(self._config.get("provider_429_cooldown_seconds", 300) or 300)
        cooldown_until = now_ts + max(10.0, default_seconds)

        try:
            reset_header = None
            if getattr(error, "headers", None) is not None:
                reset_header = error.headers.get("X-RateLimit-Reset")
            if reset_header:
                reset_value = str(reset_header).strip()
                reset_ts = float(reset_value)
                if reset_ts > 10_000_000_000:  # milliseconds
                    reset_ts = reset_ts / 1000.0
                if reset_ts > now_ts:
                    cooldown_until = max(cooldown_until, reset_ts)
        except Exception:
            pass

        self._provider_cooldown_until[provider.name] = cooldown_until
        logger.info(
            "[AI] Provider cooldown set: %s for %.0fs",
            provider.name,
            max(0.0, cooldown_until - now_ts),
        )


    # ----- Status -----

    def get_available_provider(self) -> Optional[AIProviderBase]:
        """Вернуть первого доступного провайдера из цепочки."""
        for provider in self._providers:
            if provider.is_available():
                self._active_provider = provider
                return provider
        self._active_provider = None
        return None

    def get_status(self, user_id: str) -> Dict[str, Any]:
        """Информация о статусе AI для GET /api/editor/ai/status."""
        provider_statuses = {}
        active_name = None

        for p in self._providers:
            available = p.is_available()
            provider_statuses[p.name] = {"available": available, "model": getattr(p, "model", None)}
            if available and active_name is None:
                active_name = p.name
                self._active_provider = p

        ai_available = active_name is not None
        return {
            "ok": True,
            "ai_available": ai_available,
            "active_provider": active_name,
            "providers": provider_statuses,
            "daily_limit": self._daily_tracker.get_info(user_id),
        }

    # ----- Core: send with fallback -----

    def _try_with_fallback(
        self,
        prompt: str,
        material: str,
        start_after_provider: Optional[str] = None,
        preferred_provider_names: Optional[List[str]] = None,
    ) -> Tuple[str, str]:
        """
        Отправить запрос с фолбеком по цепочке провайдеров.
        Возвращает (response_text, provider_name).
        """
        max_retries = self._config.get("max_retries", 1)
        last_error = None
        chain_attempts: List[Dict[str, Any]] = []

        for provider in self._iter_provider_chain(
            start_after_provider=start_after_provider,
            preferred_provider_names=preferred_provider_names,
        ):
            cooldown_remaining = self._provider_cooldown_remaining(provider.name)
            if cooldown_remaining > 0:
                chain_attempts.append(
                    {
                        "provider": provider.name,
                        "model": getattr(provider, "model", None),
                        "attempt": 0,
                        "status": "skipped_cooldown",
                        "cooldown_remaining_sec": int(math.ceil(cooldown_remaining)),
                    }
                )
                continue
            for attempt in range(1 + max_retries):
                trace_entry = {
                    "provider": provider.name,
                    "model": getattr(provider, "model", None),
                    "attempt": attempt + 1,
                    "status": "started",
                }
                try:
                    text = provider.send_message(prompt, material)
                    self._active_provider = provider
                    trace_entry["status"] = "success"
                    chain_attempts.append(trace_entry)
                    self._last_chain_attempts = chain_attempts
                    return text, provider.name
                except Exception as e:
                    last_error = e
                    trace_entry["status"] = "error"
                    trace_entry["error"] = str(e)
                    chain_attempts.append(trace_entry)
                    self._mark_provider_rate_limit_cooldown(provider, e)
                    logger.warning(
                        "[AI] %s attempt %d failed: %s",
                        provider.name, attempt + 1, e,
                    )
                    if attempt < max_retries:
                        time.sleep(1)

        self._last_chain_attempts = chain_attempts
        raise RuntimeError(
            f"All AI providers failed. Last error: {last_error}"
        )

    def _analyze_material_chunked_fallback(
        self,
        material: str,
        target_language: str,
    ) -> Tuple[str, Dict[str, Any], str]:
        """Analyze large material in chunks and merge structured results."""
        chunks = _split_material_for_chunk_analysis(material)
        if len(chunks) < 2:
            raise AnalysisParseError(
                "Chunked analysis fallback could not split material into multiple chunks",
                raw_text="",
                provider_name=None,
            )

        logger.info(
            "[AI] Starting chunked analysis fallback: chunks=%d words=%d",
            len(chunks),
            len((material or "").split()),
        )

        def _parse_chunk_analysis(raw: str, provider: str, chunk_text: str) -> Tuple[str, Dict[str, Any]]:
            human = parse_human_summary(raw)
            try:
                parsed = parse_analysis_response(raw)
            except ValueError as exc:
                logger.warning(
                    "[AI] Failed to parse chunk analysis response provider=%s, chunk_snippet=%s",
                    provider,
                    (raw or "")[:600].replace("\n", "\\n"),
                )
                raise AnalysisParseError(
                    str(exc),
                    raw_text=raw,
                    provider_name=provider,
                ) from exc
            parsed = _ensure_analysis_quality(parsed, chunk_text, target_language)
            return human, parsed

        chunk_analyses: List[Dict[str, Any]] = []
        chunk_human_summaries: List[str] = []
        providers_used: List[str] = []
        base_prompt = (
            STRUCTURED_ANALYSIS_PROMPT
            + ANALYSIS_PROMPT_ADDENDUM
            + ANALYSIS_V2_ROUTES_ADDENDUM
            + ANALYSIS_CHUNK_FALLBACK_ADDENDUM
            + ANALYSIS_FORMAT_RECOVERY_ADDENDUM
            + ANALYSIS_COMPACT_RECOVERY_ADDENDUM
            + f"\n\n<target_language>{target_language}</target_language>"
        )

        for idx, chunk_text in enumerate(chunks, start=1):
            chunk_prompt = (
                base_prompt
                + f"\n<chunk_index>{idx}</chunk_index>"
                + f"\n<chunk_count>{len(chunks)}</chunk_count>"
            )
            raw_text, provider_name = self._try_with_fallback(chunk_prompt, chunk_text)
            self._append_provider_chain_attempts("analysis_chunk", self._last_chain_attempts, metadata={"chunk_index": idx, "chunk_count": len(chunks)})
            try:
                human_summary, chunk_data = _parse_chunk_analysis(raw_text, provider_name, chunk_text)
            except AnalysisParseError as first_exc:
                escalated_chunk_handled = False
                try:
                    raw_text_escalated, provider_name_escalated = self._try_with_fallback(
                        chunk_prompt,
                        chunk_text,
                        start_after_provider=provider_name,
                    )
                    self._append_provider_chain_attempts(
                        "analysis_chunk_parse_escalation",
                        self._last_chain_attempts,
                        metadata={"chunk_index": idx, "chunk_count": len(chunks)},
                    )
                    human_summary, chunk_data = _parse_chunk_analysis(raw_text_escalated, provider_name_escalated, chunk_text)
                    provider_name = provider_name_escalated or provider_name
                    escalated_chunk_handled = True
                except (AnalysisParseError, RuntimeError):
                    escalated_chunk_handled = False

                if escalated_chunk_handled:
                    chunk_analyses.append(chunk_data)
                    chunk_human_summaries.append(human_summary)
                    providers_used.append(provider_name)
                    continue

                retry_prompt = (
                    base_prompt
                    + f"\n<chunk_index>{idx}</chunk_index>"
                    + f"\n<chunk_count>{len(chunks)}</chunk_count>"
                    + "\n<retry_context>Previous chunk response was unparsable. Return strict compact JSON in required tags only.</retry_context>"
                )
                retry_raw_text, retry_provider_name = self._try_with_fallback(retry_prompt, chunk_text)
                self._append_provider_chain_attempts("analysis_chunk_recovery", self._last_chain_attempts, metadata={"chunk_index": idx, "chunk_count": len(chunks)})
                provider_name = retry_provider_name or provider_name
                try:
                    human_summary, chunk_data = _parse_chunk_analysis(retry_raw_text, provider_name, chunk_text)
                except AnalysisParseError as retry_exc:
                    try:
                        retry_raw_text_escalated, retry_provider_name_escalated = self._try_with_fallback(
                            retry_prompt,
                            chunk_text,
                            start_after_provider=provider_name,
                        )
                        self._append_provider_chain_attempts(
                            "analysis_chunk_recovery_escalation",
                            self._last_chain_attempts,
                            metadata={"chunk_index": idx, "chunk_count": len(chunks)},
                        )
                        provider_name = retry_provider_name_escalated or provider_name
                        human_summary, chunk_data = _parse_chunk_analysis(retry_raw_text_escalated, provider_name, chunk_text)
                    except (AnalysisParseError, RuntimeError):
                        raise first_exc from retry_exc

            chunk_analyses.append(chunk_data)
            chunk_human_summaries.append(human_summary)
            providers_used.append(provider_name)

        merged_human_summary, merged_analysis_data = _merge_chunk_analysis_payloads(
            chunk_analyses,
            chunk_human_summaries,
            material,
            target_language,
        )
        unique_providers = [p for p in dict.fromkeys(providers_used) if p]
        provider_label = unique_providers[0] if len(unique_providers) == 1 else ",".join(unique_providers)
        return merged_human_summary, merged_analysis_data, provider_label

    # ----- Analyze -----

    def analyze_material(
        self,
        material: str,
        target_language_override: Optional[str] = None,
    ) -> Tuple[AnalysisResult, str]:
        """Phase 1: analyze material and return structured recommendations."""
        guessed_target_language = _guess_target_language(material)
        target_language = str(target_language_override or guessed_target_language or "unknown").strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,15}", target_language or ""):
            target_language = guessed_target_language
        analysis_prompt = (
            STRUCTURED_ANALYSIS_PROMPT
            + ANALYSIS_PROMPT_ADDENDUM
            + ANALYSIS_V2_ROUTES_ADDENDUM
            + f"\n\n<target_language>{target_language}</target_language>"
        )

        def _parse_and_normalize_analysis(
            raw: str,
            provider: str,
            material_for_quality: Optional[str] = None,
        ) -> Tuple[str, Dict[str, Any]]:
            human = parse_human_summary(raw)
            try:
                parsed = parse_analysis_response(raw)
            except ValueError as exc:
                logger.warning(
                    "[AI] Failed to parse analysis response from provider=%s, snippet=%s",
                    provider,
                    (raw or "")[:1200].replace("\n", "\\n"),
                )
                raise AnalysisParseError(
                    str(exc),
                    raw_text=raw,
                    provider_name=provider,
                ) from exc
            parsed = _ensure_analysis_quality(parsed, material_for_quality or material, target_language)
            return human, parsed

        def _request_and_parse_with_escalation(
            prompt_text: str,
            failed_provider_name: str,
            stage_name: str,
            material_for_quality: Optional[str] = None,
        ) -> Tuple[str, Dict[str, Any], str]:
            current_failed_provider = failed_provider_name
            last_parse_exc: Optional[AnalysisParseError] = None
            while True:
                remaining_providers = self._iter_provider_chain(start_after_provider=current_failed_provider)
                if not remaining_providers:
                    if last_parse_exc is not None:
                        raise last_parse_exc
                    raise RuntimeError("No providers left for parse-aware escalation")
                raw_escalated, escalated_provider_name = self._try_with_fallback(
                    prompt_text,
                    material,
                    start_after_provider=current_failed_provider,
                )
                self._append_provider_chain_attempts(stage_name, self._last_chain_attempts)
                try:
                    human_escalated, data_escalated = _parse_and_normalize_analysis(
                        raw_escalated,
                        escalated_provider_name,
                        material_for_quality=material_for_quality,
                    )
                    return human_escalated, data_escalated, escalated_provider_name
                except AnalysisParseError as escalated_exc:
                    last_parse_exc = escalated_exc
                    current_failed_provider = escalated_provider_name
                    logger.info(
                        "[AI] Parse-aware escalation continuing after unparsable response from provider=%s",
                        escalated_provider_name,
                    )

        self._begin_provider_chain_trace()
        try:
            raw_text, provider_name = self._try_with_fallback(analysis_prompt, material)
            self._append_provider_chain_attempts("analysis_initial", self._last_chain_attempts)

            material_word_count = len((material or "").split())
            chunk_fallback_reason: Optional[str] = None
            first_parse_exc: Optional[AnalysisParseError] = None
            try:
                human_summary, analysis_data = _parse_and_normalize_analysis(raw_text, provider_name)
            except AnalysisParseError as first_exc:
                first_parse_exc = first_exc
                try:
                    human_summary, analysis_data, escalated_provider_name = _request_and_parse_with_escalation(
                        analysis_prompt,
                        provider_name,
                        "analysis_parse_escalation",
                    )
                    provider_name = escalated_provider_name or provider_name
                except (AnalysisParseError, RuntimeError):
                    pass
                else:
                    first_parse_exc = None

            if first_parse_exc is not None:
                raw_lower = (getattr(first_parse_exc, "raw_text", "") or "").lower()
                truncation_suspected = (
                    "truncated_analysis_json_block" in str(first_parse_exc).lower()
                    or ("<analysis_json" in raw_lower and "</analysis_json>" not in raw_lower)
                )
                recovery_addendum = ANALYSIS_FORMAT_RECOVERY_ADDENDUM
                if truncation_suspected:
                    recovery_addendum += ANALYSIS_COMPACT_RECOVERY_ADDENDUM
                    logger.info(
                        "[AI] Retrying analysis in compact+format recovery mode (provider=%s)",
                        provider_name,
                    )
                else:
                    logger.info(
                        "[AI] Retrying analysis in format recovery mode (provider=%s)",
                        provider_name,
                    )

                recovery_analysis_prompt = (
                    STRUCTURED_ANALYSIS_PROMPT
                    + ANALYSIS_PROMPT_ADDENDUM
                    + ANALYSIS_V2_ROUTES_ADDENDUM
                    + recovery_addendum
                    + f"\n\n<target_language>{target_language}</target_language>"
                )
                second_parse_exc: Optional[AnalysisParseError] = None
                try:
                    compact_raw_text, compact_provider_name = self._try_with_fallback(
                        recovery_analysis_prompt, material
                    )
                    self._append_provider_chain_attempts("analysis_recovery", self._last_chain_attempts)
                    provider_name = compact_provider_name or provider_name
                    human_summary, analysis_data = _parse_and_normalize_analysis(compact_raw_text, provider_name)
                except AnalysisParseError as second_exc:
                    second_parse_exc = second_exc
                    try:
                        human_summary, analysis_data, escalated_provider_name = _request_and_parse_with_escalation(
                            recovery_analysis_prompt,
                            provider_name,
                            "analysis_recovery_escalation",
                        )
                        provider_name = escalated_provider_name or provider_name
                        second_parse_exc = None
                    except (AnalysisParseError, RuntimeError):
                        pass

                if second_parse_exc is not None:
                    second_raw_lower = (getattr(second_parse_exc, "raw_text", "") or "").lower()
                    second_truncation_suspected = (
                        "truncated_analysis_json_block" in str(second_parse_exc).lower()
                        or ("<analysis_json" in second_raw_lower and "</analysis_json>" not in second_raw_lower)
                    )
                    allow_chunk_fallback = (
                        material_word_count >= _ANALYSIS_CHUNK_TRIGGER_WORDS
                        or (
                            material_word_count >= _ANALYSIS_CHUNK_MIN_TRIGGER_WORDS
                            and (truncation_suspected or second_truncation_suspected)
                        )
                    )
                    if not allow_chunk_fallback:
                        raise

                    chunk_fallback_reason = (
                        "truncation"
                        if (truncation_suspected or second_truncation_suspected)
                        else "format_noncompliance"
                    )
                    logger.info(
                        "[AI] Falling back to chunked analysis mode (reason=%s, words=%d)",
                        chunk_fallback_reason,
                        material_word_count,
                    )
                    human_summary, analysis_data, chunk_provider_name = self._analyze_material_chunked_fallback(
                        material,
                        target_language,
                    )
                    if chunk_provider_name:
                        provider_name = chunk_provider_name

            if chunk_fallback_reason:
                analysis_warnings = analysis_data.setdefault("warnings", [])
                _append_unique(analysis_warnings, f"Chunked fallback reason: {chunk_fallback_reason}.")

            result = AnalysisResult(
                human_summary=human_summary,
                recommendations=analysis_data.get("recommendations", []),
                educational_units=analysis_data.get("educational_units", []),
                not_recommended=analysis_data.get("not_recommended", []),
                illustrations_detected=analysis_data.get("illustrations_detected", False),
                illustrations_note=analysis_data.get("illustrations_note"),
                warnings=analysis_data.get("warnings", []),
                material_volume=analysis_data.get("material_volume", "medium"),
                target_language=analysis_data.get("target_language", target_language),
                analysis_schema_version=analysis_data.get("analysis_schema_version"),
                capability_matrix_version=analysis_data.get("capability_matrix_version"),
                capability_matrix_validation=analysis_data.get("capability_matrix_validation"),
                learning_chunks=analysis_data.get("learning_chunks", []),
                type_progression_suitability=analysis_data.get("type_progression_suitability", []),
                authoring_routes=analysis_data.get("authoring_routes", []),
                coverage_plan=analysis_data.get("coverage_plan", {}),
                future_capabilities=analysis_data.get("future_capabilities", []),
                microcards_candidates=analysis_data.get("microcards_candidates", []),
                report_blocks_version=analysis_data.get("report_blocks_version"),
                report_blocks=analysis_data.get("report_blocks", []),
                report_lint=analysis_data.get("report_lint", {}),
            )

            return result, provider_name
        finally:
            self._end_provider_chain_trace()

    # ----- Generate -----

    def generate_tasks(
        self,
        material: str,
        task_type: str,
        count: int,
        educational_units: Optional[List[Dict]] = None,
        target_language_override: Optional[str] = None,
        extra_instructions: Optional[str] = None,
        start_after_provider: Optional[str] = None,
        preferred_provider_names: Optional[List[str]] = None,
    ) -> Tuple[str, str]:
        """
        Фаза 2: Генерация заданий одного типа.
        Возвращает (raw_response_text, provider_name).
        """
        guessed_target_language = _guess_target_language(material)
        target_language = str(target_language_override or guessed_target_language or "unknown").strip().lower()
        if not re.fullmatch(r"[a-z][a-z0-9_-]{0,15}", target_language or ""):
            target_language = guessed_target_language
        prompt = _build_generation_prompt(
            task_type,
            count,
            educational_units or [],
            target_language=target_language,
            extra_instructions=extra_instructions,
        )
        self._begin_provider_chain_trace()
        try:
            raw_text, provider_name = self._try_with_fallback(
                prompt,
                material,
                start_after_provider=start_after_provider,
                preferred_provider_names=preferred_provider_names,
            )
            self._append_provider_chain_attempts(
                "generate",
                self._last_chain_attempts,
                metadata={
                    "task_type": task_type,
                    "requested_count": count,
                    **({"start_after_provider": start_after_provider} if start_after_provider else {}),
                    **({"preferred_providers": list(preferred_provider_names)} if preferred_provider_names else {}),
                },
            )
            return raw_text, provider_name
        finally:
            self._end_provider_chain_trace()

    # ----- Daily limits -----

    def check_daily_limit(self, user_id: str) -> Tuple[bool, int, int]:
        """Проверка дневного лимита. Возвращает (allowed, remaining, max)."""
        return self._daily_tracker.check_limit(user_id)

    def increment_daily_usage(self, user_id: str) -> None:
        """Увеличить счётчик загрузок."""
        self._daily_tracker.increment(user_id)

    def get_daily_limit_info(self, user_id: str) -> Dict[str, Any]:
        """Получить информацию о лимите для API-ответа."""
        return self._daily_tracker.get_info(user_id)

    # ----- Config access -----

    @property
    def max_text_length(self) -> int:
        return self._config.get("rate_limits", {}).get("max_text_length_chars", 100000)

    @property
    def max_file_size_mb(self) -> int:
        return self._config.get("rate_limits", {}).get("max_file_size_mb", 18)

    @property
    def allowed_extensions(self) -> List[str]:
        return self._config.get("file_processing", {}).get(
            "allowed_extensions", [".pdf", ".docx", ".txt"]
        )

    @property
    def max_word_count(self) -> int:
        return self._config.get("file_processing", {}).get("max_word_count", 15000)

    @property
    def is_configured(self) -> bool:
        """Есть ли хотя бы один настроенный провайдер."""
        return len(self._providers) > 0
