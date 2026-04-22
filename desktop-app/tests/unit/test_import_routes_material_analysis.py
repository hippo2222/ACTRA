import sys
from pathlib import Path


DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)


from routes import import_routes


def test_parse_imported_analysis_response_parses_tagged_blocks(monkeypatch):
    monkeypatch.setattr(import_routes, "get_extra", lambda key, default=None: default)

    raw = """
<human_summary>
Краткое резюме материала.
</human_summary>

<analysis_json>
{
  "material_volume": "medium",
  "educational_units": [
    {
      "id": 1,
      "title": "Техническая адекватность",
      "type": "concept",
      "description": "Нужно оценить снимок до интерпретации.",
      "explicitness": "explicit",
      "evidence": "intro",
      "modality": "mixed",
      "assessment_risk": "high"
    }
  ],
  "recommendations": [
    {
      "task_type": "TEST",
      "count": 2,
      "priority": "high",
      "covers_units": [1],
      "rationale": "Подходит для критериев."
    }
  ],
  "not_recommended": [
    {
      "task_type": "SEQUENCE",
      "reason": "Нет однозначной последовательности."
    }
  ],
  "illustrations_detected": true,
  "illustrations_note": "Есть рентгенограммы.",
  "warnings": ["Визуальные задания ручные."]
}
</analysis_json>
""".strip()

    result = import_routes._parse_imported_analysis_response(raw)

    assert result["ok"] is True
    assert result["human_summary"] == "Краткое резюме материала."
    assert result["material_volume"] == "medium"
    assert len(result["educational_units"]) == 1
    assert result["recommendations"][0]["task_type"] == "TEST"
    assert result["not_recommended"][0]["task_type"] == "SEQUENCE"


def test_parse_imported_analysis_response_uses_optional_sanitizer(monkeypatch):
    monkeypatch.setattr(
        import_routes,
        "get_extra",
        lambda key, default=None: {
            "sanitize_analysis_response_for_client": lambda payload: {
                **payload,
                "sanitized": True,
            }
        } if key == "ai_helpers" else default,
    )

    raw = """
<human_summary>Summary</human_summary>
<analysis_json>
{"educational_units":[{"id":1,"title":"Unit","type":"fact","description":"Desc","explicitness":"explicit","evidence":"e","modality":"text","assessment_risk":"low"}],"recommendations":[]}
</analysis_json>
""".strip()

    result = import_routes._parse_imported_analysis_response(raw)

    assert result["ok"] is True
    assert result["sanitized"] is True
