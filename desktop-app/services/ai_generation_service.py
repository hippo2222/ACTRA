"""
AI Generation Service — провайдеры LLM и сервис генерации заданий.

Реализует цепочку фолбеков OpenRouter → Gemini → Groq → ручной режим.
Все API-ключи хранятся в серверном конфиге ai_config.json.
"""

import json
import logging
import math
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

    def __init__(self, api_key: str, model: str = "deepseek/deepseek-chat:free", timeout: int = 60):
        super().__init__("openrouter", api_key, model, timeout)

    def _build_request(self, prompt: str, material: str) -> Request:
        body = json.dumps({
            "model": self.model,
            "messages": [
                {"role": "system", "content": prompt},
                {"role": "user", "content": material},
            ],
            "temperature": 0.3,
            "max_tokens": 4096,
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
                "maxOutputTokens": 4096,
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
            "max_tokens": 4096,
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

STRUCTURED_ANALYSIS_PROMPT = r"""Ты — эксперт по педагогическому дизайну. Проанализируй учебный материал.

<task>
Твоя задача — тщательно проанализировать текст и выделить все объективно значимые смысловые пункты, которые студент должен усвоить.
Определи эти «образовательные единицы» — концепции, факты, процессы, термины, классификации.
Для каждой выявленной единицы определи оптимальный тип интерактивного задания, который наилучшим образом закрепит эти знания.
Сформируй свой ответ точно по описанному формату, используя только блоки <human_summary> и <analysis_json>.
</task>

<available_task_types>
OPEN_ANSWER — свободный ответ. Студент формулирует ответ своими словами.
  Подходит для: концепций, определений, причинно-следственных связей, механизмов.

SEQUENCE — восстановление порядка и структуры перетаскиванием элементов.
  Подходит не только для хронологии и алгоритмов, но и для заданий на: классификацию данных, правильное понимание иерархии, группировку понятий и ранжирование (с возможностью отключения жесткой проверки порядка там, где это уместно).

TEST — тест с вариантами ответов (один или несколько правильных).
  Подходит для: фактов, классификаций, терминологии, количественных данных.

CLICK_TEXT — выбор верных/неверных утверждений из списка.
  Подходит для: тем с распространёнными заблуждениями, похожими понятиями, тонкими различиями.

CLICK_WORDS — поиск фактических ошибок в тексте.
  Подходит для: проверки внимательности и понимания материала. Сам исходный текст не обязан содержать ошибок. Задача состоит в том, чтобы впоследствии на основе этих фактов сгенерировать похожий на правду текст с намеренными искажениями, которые студент будет находить и исправлять.
</available_task_types>

<calibration>
Выяви все объективно присутствующие в материале «образовательные единицы». Количество рекомендованных заданий должно быть оптимальным и строго обоснованным количеством этих найденных единиц. Ни больше, ни меньше.
Ориентировочные рамки в зависимости от объёма текста:
- ~300 слов (1 стр.) → 2–5 заданий суммарно.
- ~1000 слов (3–4 стр.) → 10–15 заданий.
- ~3000+ слов (10+ стр.) → 25–40 заданий.
Рекомендуй только типы, для которых материал даёт достаточно содержания. Если полезного смыслового материала мало — честно укажи это и предложи минимум заданий.
</calibration>

<illustrations_rule>
Если материал упоминает или содержит изображения, схемы, диаграммы —
установи "illustrations_detected": true и опиши потенциал
в "illustrations_note". Задания с изображениями создаются
в редакторе вручную, не через генерацию.
</illustrations_rule>

<output_format>
Верни ответ ровно в таком формате.
Внимание к полям rationale и reason: они должны состоять из 1 короткого, ёмкого предложения без многословия.

<human_summary>
2–4 предложения: тема, объём, ключевые выводы для преподавателя.
</human_summary>

<analysis_json>
{
  "material_volume": "small | medium | large",
  "educational_units": [
    { "id": 1, "title": "...", "type": "concept|process|fact|term|classification", "description": "..." }
  ],
  "recommendations": [
    { "task_type": "TEST|OPEN_ANSWER|SEQUENCE|CLICK_TEXT|CLICK_WORDS", "count": N, "priority": "high|medium|low", "covers_units": [1, 2], "rationale": "Краткое изложение причины выбора данного формата." }
  ],
  "not_recommended": [
    { "task_type": "...", "reason": "Краткая причина (1 предложение)." }
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
Задания типа TEST — это тестовые вопросы с вариантами ответов. Студент выбирает один или несколько правильных вариантов из предложенных.
</task_context>

<task>
Преобразуй предоставленный материал в тестовые вопросы формата @TEST.
</task>

<quality_criteria>
- На каждый вопрос 4 варианта ответа. Среди них 1–2 правильных и 2–3 неправильных.
- Неправильные варианты (дистракторы) должны быть правдоподобными.
- Формулировки всех вариантов сопоставимы по длине и стилю.
- Вопросы покрывают разные аспекты материала, избегая повторов.
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
Задания типа OPEN_ANSWER — это вопросы со свободным ответом. Студент видит вопрос и пишет ответ своими словами.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @OPEN_ANSWER.
</task>

<quality_criteria>
- Вопросы проверяют понимание, а не механическое запоминание.
- Эталонный ответ (строка =) содержит краткий, но полный ответ.
- Ключевые слова (строки *) — существенные термины, без которых ответ неполон.
- Каждый вопрос самодостаточен.
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
Задания типа SEQUENCE — это упражнения на восстановление правильного порядка перетаскиванием.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @SEQUENCE.
</task>

<quality_criteria>
- Каждое задание содержит от 3 до 7 элементов.
- Правильный порядок должен быть однозначным и обоснованным материалом.
- Формулировки элементов краткие и сопоставимые по длине.
- Вопрос в строке # чётко указывает принцип упорядочивания.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @SEQUENCE на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@SEQUENCE
# <инструкция: что и по какому принципу упорядочить>
element_1: <текст элемента>
element_2: <текст элемента>
element_3: <текст элемента>
level_1: element_1
level_2: element_2
level_3: element_3

Элементы нумеруются последовательно (element_1, element_2, ...).
Уровни (level_N) задают правильный порядок. Если два элемента равноправны — через запятую: level_2: element_3, element_4.
</output_format>""",

    "CLICK_TEXT": r"""Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_TEXT — это упражнения на классификацию утверждений. Студент видит список утверждений и отмечает верные или неверные.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @CLICK_TEXT.
</task>

<quality_criteria>
- Каждое задание содержит 4–7 утверждений: часть верных (+), часть неверных (-).
- Неверные утверждения основаны на типичных заблуждениях.
- Все утверждения относятся к одной теме.
- Формулировки сопоставимы по длине и стилю.
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
Задания типа CLICK_WORDS — это упражнения на поиск фактических ошибок в тексте. Студент кликает на неверные слова/фразы.
</task_context>

<task>
На основе предоставленного материала создай задания формата @CLICK_WORDS. Напиши связный текст из 2–4 предложений с 2–4 фактическими ошибками. Ошибочные фрагменты оберни в [квадратные скобки].
</task>

<quality_criteria>
- Текст читается как связный параграф — ошибки не очевидны без знания материала.
- Ошибки — подмены фактов: неправильные числа, перепутанные термины, инверсии.
- Ошибочные фрагменты в [квадратных скобках].
- Верная часть текста действительно верна.
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
- Add `target_language` to top-level JSON (usually `ru`, `en`, or `mixed`) and keep generated task content in that language.
- For each educational unit, MUST add `explicitness`, `evidence`, `modality`, and `assessment_risk` (do not omit these keys).
- Prefer broad coverage and avoid recommending many tasks that test the same paragraph/fact repeatedly.
- Recommend `SEQUENCE` for explicit structure-building cases, including ordering, classification, hierarchy, ranking, or grouping (not only chronology).
- In `not_recommended`, include short user-oriented guidance for unsupported/poor-fit task types: whether the material is suitable in principle and whether manual authoring is recommended (especially image-based tasks when illustrations are present).
- If `illustrations_detected=true`, explicitly tell the user that image-based tasks are not auto-generated here and should be created manually if visual recognition matters.
- Treat CLICK_WORDS as suitable when the material contains facts that can be intentionally distorted (numbers, dates, thresholds, terminology), even if the source text itself has no mistakes.
- Calibrate recommended counts for coverage: do not collapse medium materials into too few tasks if many educational units are present.
- Add a short coverage warning when visual content exists but text-only generation cannot assess image recognition.
- Cover every supported text task type (TEST, OPEN_ANSWER, SEQUENCE, CLICK_TEXT, CLICK_WORDS) exactly once across `recommendations` or `not_recommended` so the user gets a complete suitability map.
- Keep the analysis JSON compact enough to fit model output limits: cluster related facts into broader educational units instead of enumerating every micro-fact.
- Prefer assessable unit clusters (not exhaustive lists of all examples, drug names, doses, subvariants) when the source is dense.
- Use enum values exactly as requested: `explicitness` = `explicit|inferred`, `modality` = `text|visual|mixed`, `assessment_risk` = `low|medium|high`.
- Keep `title` short, `description` concise (1 sentence), `evidence` brief (short phrase or citation clue).
</analysis_strictness_addendum>
"""

ANALYSIS_V2_ROUTES_ADDENDUM = r"""

<analysis_v2_routes_mode>
- Output `analysis_schema_version` = `2.0` and keep legacy compatibility fields (`educational_units`, `recommendations`, `not_recommended`, `warnings`).
- Also include practical v2 fields when possible: `learning_chunks`, `type_progression_suitability`, `authoring_routes`, `coverage_plan`, `future_capabilities`, `microcards_candidates`.
- Build the analysis as practical routes and progression semantics, not only a flat list of task types.
- Treat fixed progressions as fixed: do NOT present levels as arbitrary user choices for implemented complex task types.
- In `type_progression_suitability`, describe level roles in `level_role_map`; for fixed progressions explain why each level matters for this material.
- `SEQUENCE` is a universal structuring type (ordering, classification, hierarchy, ranking, grouping), not only chronology.
- If `SEQUENCE` is suitable or recommended, set `sequence_intents` using only: `ordering`, `classification`, `hierarchy`, `ranking`, `grouping`.
- When a route step uses `SEQUENCE`, include route-step `sequence_intent` with the same enum when relevant.
- In `authoring_routes`, use concrete steps and target surfaces (`complexes`, `editor_manual`, `microcards`) instead of abstract advice.
- For fixed progression route steps, use `progression_policy` = `full_fixed_progression` and never `pick_only_level`.
- Do NOT invent new implemented task types such as `MATCH` or `CLASSIFY`.
- `CLICK_TEXT` and `CLICK_WORDS` are error-detection/discrimination variants and must NOT be presented as `MATCH`.
- Represent pair matching as a future capability: add `future_capabilities` entry with `capability_id` = `pair_matching`, truthful status (usually `planned`), `recommended_surface` = `microcards`, and `fallback_now`.
- Do NOT claim `pair_matching` is an implemented complex task type; the first target implementation is microcards mode `pair_match`.
- In `type_progression_suitability`, mark `availability` truthfully (`implemented`, `planned`, `microcards_only`, `unsupported`) and never present planned items as implemented.
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
        "Create SEQUENCE only for explicitly stated orders/chronologies/rankings.",
        "Do not invent medical rankings if the source only lists terms.",
        "State the ordering principle clearly in the # instruction.",
        "If the order is only loosely inferred, do not use SEQUENCE.",
    ],
    "OPEN_ANSWER": [
        "Include keywords that cover abbreviations and synonyms used in the material.",
        "Prefer 4-8 meaningful keywords over overly narrow keyword lists.",
        "When multiple phrasings are acceptable, you may add metadata lines before # such as '@ min_keywords: N' and '@ require_all_keywords: false'.",
    ],
    "CLICK_TEXT": [
        "Use misconception-style contrasts and subtle distinctions from the source.",
        "When available, include statement traps around numbers/dates/regulatory details.",
        "Mix true and false statements with plausible wording; avoid obvious fillers.",
    ],
    "CLICK_WORDS": [
        "Prefer factual substitutions in numbers, dates, thresholds, and terminology (not spelling errors).",
        "Create exactly 2-4 factual errors per task.",
        "Wrap only single-word (or hyphenated single-token) erroneous fragments in [brackets]; avoid multi-word bracket spans.",
        "Do not leave unmatched '[' or ']' in the final text.",
    ],
}


_AI_TASK_TYPES = {"TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS"}
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


def _estimate_text_task_target(
    word_count: int,
    units_count: int,
    illustrations_detected: bool,
    numeric_signal: int,
) -> Tuple[int, int]:
    if units_count <= 0:
        base = 8 if word_count >= 600 else 5
    else:
        base = max(8, int(math.ceil(units_count * 1.4)))
    if word_count >= 900:
        base = max(base, 14)
    if word_count >= 1200:
        base = max(base, 16)
    if word_count >= 2000:
        base = max(base, 20)
    if numeric_signal >= 8:
        base += 2
    elif numeric_signal >= 4:
        base += 1
    if illustrations_detected:
        base += 1
    target_min = max(5, min(32, base))
    extra_band = max(4, int(math.ceil(units_count * 0.35))) if units_count else 4
    target_max = max(target_min + 2, min(40, target_min + extra_band))
    return target_min, target_max


def _merge_recommendations_by_type(recommendations: Any, valid_unit_ids: set) -> List[Dict[str, Any]]:
    if not isinstance(recommendations, list):
        return []
    merged: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for rec in recommendations:
        if not isinstance(rec, dict):
            continue
        task_type = str(rec.get("task_type") or "").strip().upper()
        if task_type not in _AI_TASK_TYPES:
            continue
        count = max(1, min(20, _coerce_int(rec.get("count"), 1)))
        priority = _normalize_priority(rec.get("priority"))
        covers_units = _unique_int_list(rec.get("covers_units"), allowed=valid_unit_ids)
        rationale = str(rec.get("rationale") or "").strip()

        if task_type not in merged:
            merged[task_type] = {
                "task_type": task_type,
                "count": count,
                "priority": priority,
                "covers_units": covers_units,
                "rationale": rationale,
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

    material_word_count = len((material or "").split())
    numeric_signal = _material_numeric_signal(material or "")

    if numeric_signal >= 6:
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
            numeric_unit_ids = [u["id"] for u in units if _is_numeric_or_regulatory_unit(u)]
            recommendations.append(
                {
                    "task_type": "CLICK_WORDS",
                    "count": 2 if numeric_signal < 12 else 3,
                    "priority": "medium",
                    "covers_units": numeric_unit_ids or [u["id"] for u in units[: min(4, len(units))]],
                    "rationale": "Good fit for factual substitutions in numbers, dates, and terminology.",
                }
            )
            _append_unique(
                warnings,
                "Heuristic adjustment: CLICK_WORDS was enabled because the material contains enough factual anchors (numbers/dates/terms).",
            )
        elif removed_click_words_reason:
            _append_unique(
                warnings,
                "Heuristic adjustment: CLICK_WORDS was removed from not_recommended because this material supports factual error-detection tasks.",
            )

    if illustrations_detected:
        image_guidance_reason = (
            "Illustrations are present. Image-based tasks are not auto-generated in this flow; "
            "consider manually creating 2-4 image tasks in the editor for visual recognition/classification."
        )
        has_image_guidance = any(
            "image" in str(item.get("task_type", "")).lower()
            or "illustr" in str(item.get("reason", "")).lower()
            for item in not_recommended
        )
        if not has_image_guidance:
            not_recommended.append({"task_type": "IMAGE_TASKS (manual)", "reason": image_guidance_reason})

        existing_note = str(data.get("illustrations_note") or "").strip()
        if existing_note:
            if "manual" not in existing_note.lower():
                data["illustrations_note"] = existing_note + " Manual image-task authoring is recommended."
        else:
            data["illustrations_note"] = "Visual examples detected; manual image-task authoring is recommended."

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

    target_min, target_max = _estimate_text_task_target(
        material_word_count,
        len(units),
        illustrations_detected,
        numeric_signal,
    )
    current_total = sum(int(rec.get("count", 1)) for rec in recommendations)

    def _bump_or_add(task_type: str, amount: int, covers: Optional[List[int]] = None, rationale: str = "") -> None:
        if amount <= 0:
            return
        rec = _find_recommendation(recommendations, task_type)
        if rec is None:
            rec = {
                "task_type": task_type,
                "count": 0,
                "priority": "medium",
                "covers_units": [],
                "rationale": rationale or "Added by heuristic coverage calibration.",
            }
            recommendations.append(rec)
        rec["count"] = min(20, int(rec.get("count", 0)) + amount)
        if covers:
            rec["covers_units"] = _unique_int_list(list(rec.get("covers_units") or []) + covers, allowed=valid_unit_ids)
        if rationale and not str(rec.get("rationale") or "").strip():
            rec["rationale"] = rationale

    if current_total < target_min:
        deficit = target_min - current_total
        numeric_unit_ids = [u["id"] for u in units if _is_numeric_or_regulatory_unit(u)]
        preferred_cycle = ["TEST", "CLICK_TEXT", "OPEN_ANSWER", "CLICK_WORDS", "TEST", "CLICK_TEXT"]
        caps = {"TEST": 8, "CLICK_TEXT": 7, "OPEN_ANSWER": 5, "CLICK_WORDS": 4, "SEQUENCE": 2}
        while deficit > 0:
            progress = False
            for task_type in preferred_cycle:
                rec = _find_recommendation(recommendations, task_type)
                if rec is None:
                    if task_type == "CLICK_WORDS" and numeric_signal < 6:
                        continue
                    default_covers = numeric_unit_ids if task_type == "CLICK_WORDS" and numeric_unit_ids else [u["id"] for u in units]
                    _bump_or_add(task_type, 1, default_covers, "Added by coverage calibration to improve overall material coverage.")
                    deficit -= 1
                    progress = True
                    if deficit <= 0:
                        break
                    continue

                if int(rec.get("count", 0)) >= caps.get(task_type, 6):
                    continue
                rec["count"] = int(rec.get("count", 0)) + 1
                if task_type == "CLICK_WORDS" and numeric_unit_ids:
                    rec["covers_units"] = _unique_int_list(
                        list(rec.get("covers_units") or []) + numeric_unit_ids,
                        allowed=valid_unit_ids,
                    )
                deficit -= 1
                progress = True
                if deficit <= 0:
                    break

            if not progress:
                _bump_or_add("TEST", deficit, [u["id"] for u in units], "Added by coverage calibration to reach a reasonable task count.")
                deficit = 0

        _append_unique(
            warnings,
            f"Coverage calibration increased recommended text tasks to improve coverage (target ~{target_min}-{target_max}).",
        )
    elif current_total > target_max + 6:
        _append_unique(
            warnings,
            f"AI recommended a high total task count ({current_total}); trim low-priority items if authoring time is limited (rough target ~{target_min}-{target_max}).",
        )
    else:
        _append_unique(
            warnings,
            f"Heuristic coverage target for this material is roughly {target_min}-{target_max} text tasks (plus manual image tasks where relevant).",
        )

    seq_rec = _find_recommendation(recommendations, "SEQUENCE")
    if seq_rec and int(seq_rec.get("count", 0)) > 2:
        seq_rec["count"] = 2
        _append_unique(warnings, "SEQUENCE recommendation count was capped at 2 to avoid forcing implicit rankings.")

    # Ensure the user sees guidance for every supported text task type
    # even if the model omitted some types entirely.
    recommended_types = {str(r.get("task_type") or "").upper() for r in recommendations}
    notrec_types = {str(n.get("task_type") or "").upper() for n in not_recommended}
    missing_types = [t for t in sorted(_AI_TASK_TYPES) if t not in recommended_types and t not in notrec_types]
    for missing_type in missing_types:
        if missing_type == "SEQUENCE":
            reason = "No explicit order/ranking was clearly identified; use SEQUENCE only if the source defines a strict order."
        elif missing_type == "OPEN_ANSWER":
            reason = "May still be suitable for manual authoring if you want explanation-focused tasks, but it was not prioritized by the analysis."
        elif missing_type == "CLICK_WORDS":
            reason = "Use when the material has factual anchors (numbers/dates/terms) that can be intentionally distorted."
        elif missing_type == "CLICK_TEXT":
            reason = "Use when the topic contains subtle distinctions or common misconceptions that fit true/false statements."
        else:  # TEST
            reason = "Use for precise facts, definitions, and classifications if you need additional objective coverage."
        not_recommended.append({"task_type": missing_type, "reason": reason})

    order_index = {"TEST": 0, "CLICK_TEXT": 1, "OPEN_ANSWER": 2, "CLICK_WORDS": 3, "SEQUENCE": 4}
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
    cyr = sum(1 for ch in material if "а" <= ch.lower() <= "я" or ch.lower() == "ё")
    lat = sum(1 for ch in material if "a" <= ch.lower() <= "z")
    if cyr > lat * 1.3:
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
    ????????? JSON ?? ?????? ??-??????.
    ???? ???? ????? ????????? <analysis_json> ? </analysis_json>.
    ???? ??????? ?? ???????, ???????? ????? ?????? ???????? JSON-??????.
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
            if task_type not in _AI_TASK_TYPES:
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

    merged_raw = {
        "target_language": fallback_target_language,
        "material_volume": "large" if len((material or "").split()) >= _ANALYSIS_CHUNK_TRIGGER_WORDS else "medium",
        "educational_units": merged_units,
        "recommendations": merged_recommendations,
        "not_recommended": merged_not_recommended,
        "illustrations_detected": illustrations_detected,
        "illustrations_note": " ".join(note_parts[:2]).strip() or None,
        "warnings": warnings,
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
    if not config_path.exists():
        logger.warning("[AI] ai_config.json not found at %s", config_path)
        return {}
    try:
        with open(config_path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except Exception as e:
        logger.error("[AI] Failed to load ai_config.json: %s", e)
        return {}


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
