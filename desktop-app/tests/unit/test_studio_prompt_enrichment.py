from typing import Any, Dict
import pytest
from flask import Flask

from services.ai_generation_service import (
    build_enriched_generation_prompt,
    get_studio_generation_prompt,
)
from routes.studio_routes import studio_bp


def test_build_enriched_fallback_when_none():
    base = get_studio_generation_prompt("TEST", target_language="ru", prompt_language="ru")
    assert base is not None

    result_none = build_enriched_generation_prompt("TEST", recommendation=None, target_language="ru", prompt_language="ru")
    assert result_none == base

    result_empty = build_enriched_generation_prompt("TEST", recommendation={}, target_language="ru", prompt_language="ru")
    assert result_empty == base


def test_build_enriched_ru():
    rec: Dict[str, Any] = {
        "task_type": "TEST",
        "count": 4,
        "generation_focus": "Сфокусироваться на дифференциальной диагностике вирусных и бактериальных пневмоний.",
        "coverage_strategy": "misconception_first",
        "assessable_anchors": ["инфильтрация на рентгенограмме", "прокальцитонин > 0.5 нг/мл", "характер мокроты"],
        "design_candidates": [
            "Тест на интерпретацию уровня прокальцитонина при атипичном течении",
            "Тест на выбор антибактериальной терапии первой линии"
        ],
        "covers_units": [1, 2]
    }
    units = [
        {"id": 1, "title": "Бактериальная пневмония", "description": "Острое инфекционное воспаление альвеол."},
        {"id": 2, "title": "Вирусная пневмония", "description": "Интерстициальное поражение с преимущественным вовлечением интерстиция."},
        {"id": 3, "title": "Абсцесс лёгкого", "description": "Ограниченный гнойно-деструктивный процесс."}
    ]

    prompt = build_enriched_generation_prompt(
        task_type="TEST",
        recommendation=rec,
        educational_units=units,
        target_language="ru",
        prompt_language="ru"
    )
    assert prompt is not None
    assert "<pedagogical_directive>" in prompt
    assert "</pedagogical_directive>" in prompt
    assert "КОЛИЧЕСТВО ЗАДАНИЙ: Сгенерируй ровно 4 заданий данного типа." in prompt
    assert "ЦЕЛЕВОЙ ПЕДАГОГИЧЕСКИЙ ФОКУС:" in prompt
    assert "дифференциальной диагностике" in prompt
    assert "СТРАТЕГИЯ ПРОВЕРКИ:" in prompt
    assert "Выявление типичных заблуждений" in prompt
    assert "СОДЕРЖАТЕЛЬНЫЕ ОПОРЫ И ЛОВУШКИ ДЛЯ ПРОВЕРКИ" in prompt
    assert "прокальцитонин > 0.5 нг/мл" in prompt
    assert "СВЯЗАННЫЕ ОБРАЗОВАТЕЛЬНЫЕ ЕДИНИЦЫ:" in prompt
    assert "Бактериальная пневмония" in prompt
    assert "Вирусная пневмония" in prompt
    assert "Абсцесс лёгкого" not in prompt  # Unit 3 was not covered
    assert "ПРЕДВАРИТЕЛЬНЫЕ ЗАГОТОВКИ ИЗ АНАЛИЗА" in prompt
    assert "Тест на интерпретацию уровня прокальцитонина" in prompt

    # Ensure format block is also present
    assert "@TEST" in prompt
    assert "? <вопрос>" in prompt


def test_build_enriched_en():
    rec = {
        "task_type": "OPEN_ANSWER",
        "count": 2,
        "generation_focus": "Explain the molecular mechanism of CRISPR-Cas9 cleavage.",
        "coverage_strategy": "high_risk_first",
        "assessable_anchors": ["PAM sequence recognition (NGG)", "sgRNA spacer hybridization", "RuvC and HNH nuclease domains"],
        "design_candidates": ["Describe how PAM mismatch prevents off-target cleavage."],
        "covers_units": ["u1"]
    }
    units = [{"id": "u1", "title": "Cas9 Endonuclease", "description": "RNA-guided DNA cleavage enzyme."}]

    prompt = build_enriched_generation_prompt(
        task_type="OPEN_ANSWER",
        recommendation=rec,
        educational_units=units,
        target_language="en",
        prompt_language="en"
    )
    assert prompt is not None
    assert "<pedagogical_directive>" in prompt
    assert "TARGET QUANTITY: Generate exactly 2 tasks of this type." in prompt
    assert "PEDAGOGICAL GENERATION FOCUS:" in prompt
    assert "CRISPR-Cas9 cleavage" in prompt
    assert "COVERAGE STRATEGY:" in prompt
    assert "critical risk points" in prompt
    assert "PAM sequence recognition (NGG)" in prompt
    assert "Cas9 Endonuclease" in prompt
    assert "@OPEN_ANSWER" in prompt


def test_build_enriched_uk():
    rec = {
        "task_type": "SEQUENCE",
        "count": 3,
        "generation_focus": "Впорядкувати стадії мітотичного поділу клітини.",
        "coverage_strategy": "structure_first",
        "assessable_anchors": ["профаза", "метафазна пластинка", "анафазне розходження", "телофаза"],
    }
    prompt = build_enriched_generation_prompt(
        task_type="SEQUENCE",
        recommendation=rec,
        target_language="uk",
        prompt_language="uk"
    )
    assert prompt is not None
    assert "<pedagogical_directive>" in prompt
    assert "КІЛЬКІСТЬ ЗАВДАНЬ: Згенеруй рівно 3 завдань цього типу." in prompt
    assert "ЦІЛЬОВИЙ ПЕДАГОГІЧНИЙ ФОКУС:" in prompt
    assert "Впорядкувати стадії мітотичного поділу клітини." in prompt
    assert "СТРАТЕГІЯ ПЕРЕВІРКИ:" in prompt
    assert "Аналіз і складання логічної структури" in prompt
    assert "@SEQUENCE" in prompt


def test_studio_enrich_prompt_endpoint(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test-secret"
    app.register_blueprint(studio_bp)

    class DummyContext:
        user_id = "test-user-123"

    monkeypatch.setattr("routes.studio_routes.get_ctx", lambda: DummyContext())

    client = app.test_client()

    # 1. Unknown type
    resp_bad = client.post("/api/editor/studio/prompts/enrich", json={"task_type": "INVALID_TYPE"})
    assert resp_bad.status_code == 404

    # 2. Valid request with recommendation
    payload = {
        "task_type": "TEST",
        "recommendation": {
            "count": 2,
            "generation_focus": "Тестирование физики полупроводников",
            "coverage_strategy": "breadth_first",
            "assessable_anchors": ["p-n переход", "дырочная проводимость"]
        },
        "target_language": "ru",
        "prompt_language": "ru"
    }
    resp = client.post("/api/editor/studio/prompts/enrich", json=payload)
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "<pedagogical_directive>" in data["prompt"]
    assert "Тестирование физики полупроводников" in data["prompt"]
    assert "p-n переход" in data["prompt"]
    assert "@TEST" in data["prompt"]
