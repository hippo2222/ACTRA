"""
Tests for AIGenerationService — Phase A.

Covers:
- Analysis response parsing (JSON extraction from various LLM output formats)
- Human summary extraction
- Fallback logic (mock providers)
- Provider instantiation and config loading
- Daily limit tracker
- Generation prompt building
- Integration with existing parsers (LLM response → parser → preview)
"""

import json
import pytest
import shutil
import sys
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import date


@pytest.fixture
def tmpdir():
    """Manual temp directory that avoids Windows permission issues with tmp_path."""
    d = Path(tempfile.mkdtemp(prefix="actra_test_ai_"))
    yield d
    shutil.rmtree(d, ignore_errors=True)

# Ensure desktop-app and project root are on sys.path
DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from services.ai_generation_service import (
    parse_analysis_response,
    parse_human_summary,
    AnalysisResult,
    ValidationResult,
    DailyLimitTracker,
    AIProviderBase,
    OpenRouterProvider,
    GeminiProvider,
    GroqProvider,
    AIGenerationService,
    _build_generation_prompt,
    load_ai_config,
    STRUCTURED_ANALYSIS_PROMPT,
)


# ============================================================================
# parse_analysis_response
# ============================================================================


class TestParseAnalysisResponse:
    """Test JSON extraction from various LLM output formats."""

    def test_extract_with_markers(self):
        """Standard case: JSON between <analysis_json> markers."""
        raw = """<human_summary>
Материал посвящён пневмонии.
</human_summary>

<analysis_json>
{
  "material_volume": "medium",
  "educational_units": [
    {"id": 1, "title": "Этиология", "type": "concept", "description": "Возбудители"}
  ],
  "recommendations": [
    {"task_type": "TEST", "count": 5, "priority": "high", "covers_units": [1], "rationale": "Факты"}
  ],
  "not_recommended": [],
  "illustrations_detected": false,
  "illustrations_note": null,
  "warnings": []
}
</analysis_json>"""
        result = parse_analysis_response(raw)
        assert result["material_volume"] == "medium"
        assert len(result["educational_units"]) == 1
        assert result["educational_units"][0]["title"] == "Этиология"
        assert len(result["recommendations"]) == 1
        assert result["recommendations"][0]["task_type"] == "TEST"

    def test_extract_without_markers_recommendations(self):
        """Fallback: find JSON by 'recommendations' key."""
        raw = """Here is my analysis:
{"material_volume": "small", "recommendations": [{"task_type": "TEST", "count": 3}], "educational_units": [], "not_recommended": [], "illustrations_detected": false, "illustrations_note": null, "warnings": []}
End of response."""
        result = parse_analysis_response(raw)
        assert result["material_volume"] == "small"
        assert len(result["recommendations"]) == 1

    def test_extract_with_extra_whitespace(self):
        """Markers with extra whitespace."""
        raw = """<human_summary> Summary </human_summary>

<analysis_json>
  {
    "material_volume": "large",
    "educational_units": [],
    "recommendations": [],
    "not_recommended": [],
    "illustrations_detected": true,
    "illustrations_note": "Есть схемы",
    "warnings": ["Мало фактов"]
  }
</analysis_json>"""
        result = parse_analysis_response(raw)
        assert result["material_volume"] == "large"
        assert result["illustrations_detected"] is True
        assert result["illustrations_note"] == "Есть схемы"

    def test_unparseable_raises(self):
        """Completely unparseable response raises ValueError."""
        with pytest.raises(ValueError, match="Cannot parse"):
            parse_analysis_response("This is just plain text without any JSON")

    def test_markers_with_invalid_json_falls_through(self):
        """Invalid JSON inside markers → falls through to other strategies."""
        raw = """<analysis_json>
{not valid json}
</analysis_json>

Also here: {"recommendations": [{"task_type": "OPEN_ANSWER", "count": 2}], "educational_units": []}
"""
        result = parse_analysis_response(raw)
        assert "recommendations" in result

    def test_empty_recommendations(self):
        """Valid JSON with empty recommendations."""
        raw = '<analysis_json>{"material_volume": "small", "educational_units": [], "recommendations": [], "not_recommended": [], "illustrations_detected": false, "illustrations_note": null, "warnings": ["Мало материала"]}</analysis_json>'
        result = parse_analysis_response(raw)
        assert result["recommendations"] == []
        assert result["warnings"] == ["Мало материала"]


# ============================================================================
# parse_human_summary
# ============================================================================


class TestParseHumanSummary:

    def test_extract_summary(self):
        raw = "<human_summary>\nМатериал о пневмонии, средний объём.\n</human_summary>\n<analysis_json>{}</analysis_json>"
        assert parse_human_summary(raw) == "Материал о пневмонии, средний объём."

    def test_no_summary(self):
        assert parse_human_summary("No summary here") == ""

    def test_multiline_summary(self):
        raw = """<human_summary>
Материал посвящён внебольничной пневмонии.
Объём средний (~4 стр.), высокая фактическая плотность.
Выявлено 5 образовательных единиц.
</human_summary>"""
        result = parse_human_summary(raw)
        assert "внебольничной пневмонии" in result
        assert "5 образовательных единиц" in result


# ============================================================================
# AnalysisResult
# ============================================================================


class TestAnalysisResult:

    def test_to_dict(self):
        ar = AnalysisResult(
            human_summary="Summary",
            recommendations=[{"task_type": "TEST", "count": 5}],
            educational_units=[{"id": 1, "title": "Unit1"}],
            not_recommended=[],
            illustrations_detected=True,
            illustrations_note="Diagrams found",
            warnings=["Warning1"],
            material_volume="large",
        )
        d = ar.to_dict()
        assert d["human_summary"] == "Summary"
        assert len(d["recommendations"]) == 1
        assert d["illustrations_detected"] is True
        assert d["material_volume"] == "large"

    def test_defaults(self):
        ar = AnalysisResult()
        d = ar.to_dict()
        assert d["human_summary"] == ""
        assert d["recommendations"] == []
        assert d["educational_units"] == []
        assert d["illustrations_detected"] is False
        assert d["material_volume"] == "medium"


# ============================================================================
# DailyLimitTracker
# ============================================================================


class TestDailyLimitTracker:

    def test_initial_state(self):
        tracker = DailyLimitTracker(max_files_per_day=3)
        allowed, remaining, max_f = tracker.check_limit("user1")
        assert allowed is True
        assert remaining == 3
        assert max_f == 3

    def test_increment_and_check(self):
        tracker = DailyLimitTracker(max_files_per_day=2)
        tracker.increment("user1")
        allowed, remaining, _ = tracker.check_limit("user1")
        assert allowed is True
        assert remaining == 1

        tracker.increment("user1")
        allowed, remaining, _ = tracker.check_limit("user1")
        assert allowed is False
        assert remaining == 0

    def test_separate_users(self):
        tracker = DailyLimitTracker(max_files_per_day=1)
        tracker.increment("user1")
        allowed1, _, _ = tracker.check_limit("user1")
        allowed2, _, _ = tracker.check_limit("user2")
        assert allowed1 is False
        assert allowed2 is True

    def test_get_info(self):
        tracker = DailyLimitTracker(max_files_per_day=3)
        tracker.increment("u1")
        info = tracker.get_info("u1")
        assert info["files_remaining"] == 2
        assert info["max_files_per_day"] == 3
        assert "resets_at" in info

    @patch("services.ai_generation_service.date")
    def test_resets_on_new_day(self, mock_date):
        """Counter resets when date changes."""
        mock_date.today.return_value = date(2026, 2, 20)
        mock_date.side_effect = lambda *a, **kw: date(*a, **kw)

        tracker = DailyLimitTracker(max_files_per_day=1)
        tracker.increment("u1")
        allowed, _, _ = tracker.check_limit("u1")
        assert allowed is False

        # Next day
        mock_date.today.return_value = date(2026, 2, 21)
        allowed, remaining, _ = tracker.check_limit("u1")
        assert allowed is True
        assert remaining == 1


# ============================================================================
# Generation prompt building
# ============================================================================


class TestBuildGenerationPrompt:

    def test_basic_test_prompt(self):
        prompt = _build_generation_prompt("TEST", 5, [])
        assert "@TEST" in prompt
        assert "ровно 5 заданий" in prompt

    def test_with_educational_units(self):
        units = [
            {"title": "Этиология", "description": "Возбудители пневмонии"},
            {"title": "Патогенез", "description": ""},
        ]
        prompt = _build_generation_prompt("OPEN_ANSWER", 3, units)
        assert "ровно 3 заданий" in prompt
        assert "Этиология: Возбудители пневмонии" in prompt
        assert "- Патогенез" in prompt

    def test_all_task_types(self):
        for tt in ("TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS"):
            prompt = _build_generation_prompt(tt, 2, [])
            assert "ровно 2 заданий" in prompt

    def test_unknown_type_raises(self):
        with pytest.raises(ValueError, match="Unknown task type"):
            _build_generation_prompt("UNKNOWN_TYPE", 1, [])


# ============================================================================
# Config loading
# ============================================================================


class TestLoadAiConfig:

    def test_missing_file(self, tmpdir):
        result = load_ai_config(tmpdir)
        assert result == {}

    def test_valid_config(self, tmpdir):
        config = {
            "providers": {
                "openrouter": {"enabled": True, "api_key": "sk-test", "model": "test-model"}
            },
            "fallback_order": ["openrouter"],
            "timeout_seconds": 30,
        }
        (tmpdir / "ai_config.json").write_text(json.dumps(config), encoding="utf-8")
        result = load_ai_config(tmpdir)
        assert result["providers"]["openrouter"]["api_key"] == "sk-test"

    def test_corrupt_json(self, tmpdir):
        (tmpdir / "ai_config.json").write_text("not json!", encoding="utf-8")
        result = load_ai_config(tmpdir)
        assert result == {}


# ============================================================================
# AIGenerationService — init & status
# ============================================================================


class TestAIGenerationServiceInit:

    def test_no_config_file(self, tmpdir):
        svc = AIGenerationService(data_dir=tmpdir)
        assert svc.is_configured is False
        assert svc._providers == []

    def test_config_with_no_keys(self, tmpdir):
        config = {
            "providers": {
                "openrouter": {"enabled": True, "api_key": "", "model": "m"},
            },
            "fallback_order": ["openrouter"],
        }
        (tmpdir / "ai_config.json").write_text(json.dumps(config), encoding="utf-8")
        svc = AIGenerationService(data_dir=tmpdir)
        assert svc.is_configured is False

    def test_config_with_valid_provider(self, tmpdir):
        config = {
            "providers": {
                "openrouter": {"enabled": True, "api_key": "sk-test", "model": "test-model"},
            },
            "fallback_order": ["openrouter"],
        }
        (tmpdir / "ai_config.json").write_text(json.dumps(config), encoding="utf-8")
        svc = AIGenerationService(data_dir=tmpdir)
        assert svc.is_configured is True
        assert len(svc._providers) == 1
        assert svc._providers[0].name == "openrouter"

    def test_disabled_provider_skipped(self, tmpdir):
        config = {
            "providers": {
                "openrouter": {"enabled": False, "api_key": "sk-test", "model": "m"},
                "gemini": {"enabled": True, "api_key": "AIza-test", "model": "gemini-flash"},
            },
            "fallback_order": ["openrouter", "gemini"],
        }
        (tmpdir / "ai_config.json").write_text(json.dumps(config), encoding="utf-8")
        svc = AIGenerationService(data_dir=tmpdir)
        assert len(svc._providers) == 1
        assert svc._providers[0].name == "gemini"


# ============================================================================
# Fallback logic with mock providers
# ============================================================================


class _MockProvider(AIProviderBase):
    """Test provider with controllable behavior."""

    def __init__(self, name, should_fail=False, response="OK"):
        super().__init__(name, "fake-key", "fake-model")
        self.should_fail = should_fail
        self.response = response
        self.call_count = 0

    def _build_request(self, prompt, material):
        raise NotImplementedError

    def _extract_text(self, response_data):
        raise NotImplementedError

    def _build_ping_request(self):
        raise NotImplementedError

    def send_message(self, prompt, material):
        self.call_count += 1
        if self.should_fail:
            raise RuntimeError(f"{self.name} failed")
        return self.response

    def is_available(self):
        return not self.should_fail


class TestFallbackLogic:

    def _make_service(self, tmpdir, providers):
        """Create service with injected mock providers."""
        config = {"providers": {}, "fallback_order": [], "max_retries": 0}
        (tmpdir / "ai_config.json").write_text(json.dumps(config), encoding="utf-8")
        svc = AIGenerationService(data_dir=tmpdir)
        svc._providers = providers
        svc._config["max_retries"] = 0
        return svc

    def test_first_provider_succeeds(self, tmpdir):
        p1 = _MockProvider("p1", response="response from p1")
        p2 = _MockProvider("p2", response="response from p2")
        svc = self._make_service(tmpdir, [p1, p2])

        text, name = svc._try_with_fallback("prompt", "material")
        assert text == "response from p1"
        assert name == "p1"
        assert p1.call_count == 1
        assert p2.call_count == 0

    def test_fallback_to_second(self, tmpdir):
        p1 = _MockProvider("p1", should_fail=True)
        p2 = _MockProvider("p2", response="fallback response")
        svc = self._make_service(tmpdir, [p1, p2])

        text, name = svc._try_with_fallback("prompt", "material")
        assert text == "fallback response"
        assert name == "p2"
        assert p1.call_count == 1
        assert p2.call_count == 1

    def test_all_fail_raises(self, tmpdir):
        p1 = _MockProvider("p1", should_fail=True)
        p2 = _MockProvider("p2", should_fail=True)
        svc = self._make_service(tmpdir, [p1, p2])

        with pytest.raises(RuntimeError, match="All AI providers failed"):
            svc._try_with_fallback("prompt", "material")

    def test_retry_on_failure(self, tmpdir):
        """With max_retries=1, provider gets two attempts."""
        p1 = _MockProvider("p1", should_fail=True)
        svc = self._make_service(tmpdir, [p1])
        svc._config["max_retries"] = 1

        with pytest.raises(RuntimeError):
            svc._try_with_fallback("prompt", "material")
        # 1 initial + 1 retry = 2 calls
        assert p1.call_count == 2

    def test_get_status_with_mocks(self, tmpdir):
        p1 = _MockProvider("p1", should_fail=True)
        p2 = _MockProvider("p2")
        svc = self._make_service(tmpdir, [p1, p2])

        status = svc.get_status("user1")
        assert status["ai_available"] is True
        assert status["active_provider"] == "p2"
        assert status["providers"]["p1"]["available"] is False
        assert status["providers"]["p2"]["available"] is True

    def test_get_status_all_down(self, tmpdir):
        p1 = _MockProvider("p1", should_fail=True)
        svc = self._make_service(tmpdir, [p1])

        status = svc.get_status("user1")
        assert status["ai_available"] is False
        assert status["active_provider"] is None


# ============================================================================
# Integration: LLM response → parser → preview objects
# ============================================================================


class TestParserIntegration:
    """Verify that typical LLM output for each task type can be parsed."""

    def test_test_response_parsed(self):
        from task_system.models.parsers import TestImportParser

        llm_output = """@TEST
# Контрольные вопросы
? Какой возбудитель наиболее часто вызывает внебольничную пневмонию?
+ Streptococcus pneumoniae
- Pseudomonas aeruginosa
- Klebsiella pneumoniae
- Mycobacterium tuberculosis
? К факторам риска НЕ относится:
+ Молодой возраст без хронических заболеваний
- Курение
- Иммунодефицит
- Пожилой возраст"""

        parser = TestImportParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 1
        assert tasks[0]["type"] == "test"
        assert len(tasks[0]["data"]["questions"]) == 2

    def test_open_answer_response_parsed(self):
        from task_system.models.parsers import OpenAnswerParser

        llm_output = """@OPEN_ANSWER
# Объясните патогенез крупозной пневмонии
= Воспалительный процесс в лёгочной ткани проходит через четыре стадии
* воспаление
* стадии
* альвеолы

@OPEN_ANSWER
# Почему антибиотикотерапию начинают эмпирически?
= Потому что ожидание результатов посева занимает 3-5 дней
* эмпирическая
* посев"""

        parser = OpenAnswerParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 2
        assert tasks[0]["type"] == "open_answer"
        assert "патогенез" in tasks[0]["prompt"].lower()
        assert len(tasks[0]["data"]["keywords"]) == 3

    def test_sequence_response_parsed(self):
        from task_system.models.parsers import SequenceParser

        llm_output = """@SEQUENCE
# Расположите стадии крупозной пневмонии в порядке их развития
element_1: Стадия прилива
element_2: Стадия красного опеченения
element_3: Стадия серого опеченения
element_4: Стадия разрешения
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4"""

        parser = SequenceParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 1
        assert tasks[0]["type"] == "sequence_assembly"
        assert len(tasks[0]["data"]["elements"]) == 4

    def test_click_text_response_parsed(self):
        from task_system.models.parsers import ClickTextParser

        llm_output = """@CLICK_TEXT
# Выберите верные утверждения о пневмонии
+ Наиболее частый возбудитель — пневмококк
+ Характерны лихорадка, кашель и одышка
- Антибиотики назначают только после посева
- Пневмония не может развиться у молодых"""

        parser = ClickTextParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 1
        assert tasks[0]["type"] == "click"
        assert tasks[0]["data"]["mode"] == "text_choice"
        assert len(tasks[0]["data"]["options"]) == 4

    def test_click_words_response_parsed(self):
        from task_system.models.parsers import ClickWordsParser

        llm_output = """@CLICK_WORDS
# Найдите фактические ошибки
Пневмония — это воспалительное заболевание лёгких, чаще всего вызываемое [грибками]. Основные симптомы включают кашель, [лихорадку] и одышку. Для подтверждения назначают [УЗИ]."""

        parser = ClickWordsParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 1
        assert tasks[0]["type"] == "click"
        assert tasks[0]["data"]["mode"] == "word_errors"
        assert len(tasks[0]["data"]["error_indices"]) >= 2

    def test_llm_output_without_marker_still_parses(self):
        """If LLM forgets the marker, adding it should still work."""
        from task_system.models.parsers import OpenAnswerParser

        llm_output = """# Какова роль альвеол в дыхании?
= Альвеолы обеспечивают газообмен между воздухом и кровью
* альвеолы
* газообмен"""

        # Without marker — parser won't find it
        parser = OpenAnswerParser()
        tasks = parser.parse_text(llm_output)
        assert len(tasks) == 0

        # With marker prepended (as our endpoint does)
        parser2 = OpenAnswerParser()
        tasks2 = parser2.parse_text(f"@OPEN_ANSWER\n{llm_output}")
        assert len(tasks2) == 1


# ============================================================================
# Provider class instantiation
# ============================================================================


class TestProviderInstantiation:

    def test_openrouter_provider(self):
        p = OpenRouterProvider(api_key="sk-test", model="test-model")
        assert p.name == "openrouter"
        assert p.model == "test-model"

    def test_gemini_provider(self):
        p = GeminiProvider(api_key="AIza-test", model="gemini-flash")
        assert p.name == "gemini"
        assert p.model == "gemini-flash"

    def test_groq_provider(self):
        p = GroqProvider(api_key="gsk-test", model="llama-3.1-70b")
        assert p.name == "groq"
        assert p.model == "llama-3.1-70b"

    def test_openrouter_build_request(self):
        p = OpenRouterProvider(api_key="sk-test", model="test-model")
        req = p._build_request("system prompt", "user material")
        assert req.method == "POST"
        assert "openrouter.ai" in req.full_url
        body = json.loads(req.data.decode("utf-8"))
        assert body["model"] == "test-model"
        assert body["messages"][0]["role"] == "system"
        assert body["messages"][1]["role"] == "user"

    def test_gemini_build_request(self):
        p = GeminiProvider(api_key="AIza-test", model="gemini-flash")
        req = p._build_request("prompt", "material")
        assert "generativelanguage.googleapis.com" in req.full_url
        assert "AIza-test" in req.full_url

    def test_groq_build_request(self):
        p = GroqProvider(api_key="gsk-test", model="llama-model")
        req = p._build_request("prompt", "material")
        assert "api.groq.com" in req.full_url
        body = json.loads(req.data.decode("utf-8"))
        assert body["model"] == "llama-model"


# ============================================================================
# Structured analysis prompt
# ============================================================================


class TestStructuredPrompt:

    def test_prompt_contains_required_sections(self):
        assert "<task>" in STRUCTURED_ANALYSIS_PROMPT
        assert "<available_task_types>" in STRUCTURED_ANALYSIS_PROMPT
        assert "<calibration>" in STRUCTURED_ANALYSIS_PROMPT
        assert "<output_format>" in STRUCTURED_ANALYSIS_PROMPT
        assert "<analysis_json>" in STRUCTURED_ANALYSIS_PROMPT
        assert "<human_summary>" in STRUCTURED_ANALYSIS_PROMPT

    def test_prompt_contains_all_task_types(self):
        for tt in ("OPEN_ANSWER", "SEQUENCE", "TEST", "CLICK_TEXT", "CLICK_WORDS"):
            assert tt in STRUCTURED_ANALYSIS_PROMPT
