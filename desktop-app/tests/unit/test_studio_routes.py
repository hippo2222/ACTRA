import io
import sys
from pathlib import Path
from typing import Any, Dict

import pytest
from flask import Flask

DESKTOP_APP_DIR = Path(__file__).resolve().parent.parent.parent
PROJECT_ROOT = DESKTOP_APP_DIR.parent
for p in (str(DESKTOP_APP_DIR), str(PROJECT_ROOT)):
    if p not in sys.path:
        sys.path.insert(0, p)

from persistence.hosted_studio_session_repository import HostedStudioSessionRepository
from routes import _context, studio_routes
from services.ai_generation_service import build_studio_analysis_prompt, get_studio_generation_prompt


class MockAppContext:
    def __init__(self, user_id="test_user"):
        self.user_id = user_id
        self.data_dir = Path(".test_data_dir")
        self.persistence_runtime = None


@pytest.fixture
def app(tmp_path):
    flask_app = Flask(__name__)
    flask_app.config["TESTING"] = True

    mock_ctx = MockAppContext(user_id="test_teacher")
    repo = HostedStudioSessionRepository(dsn=None, fallback_dir=tmp_path / "sessions")
    repo.ensure_schema()

    prev_ctx = _context._app_ctx
    prev_extra = dict(_context._extra)
    try:
        _context.init_context(
            mock_ctx,
            studio_session_repository=repo,
        )
        _context.set_extra("studio_session_repository", repo)

        flask_app.register_blueprint(studio_routes.studio_bp)
        yield flask_app
    finally:
        _context._app_ctx = prev_ctx
        _context._extra = prev_extra


@pytest.fixture
def client(app):
    return app.test_client()


# ---------------------------------------------------------------------------
# 1. Document Upload Endpoint Tests
# ---------------------------------------------------------------------------


def test_upload_document_requires_auth(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "guest")
    resp = client.post("/api/editor/studio/upload-document")
    assert resp.status_code == 403
    assert resp.get_json()["error"] == "guest_cannot_use_studio"


def test_upload_document_requires_file(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")
    resp = client.post("/api/editor/studio/upload-document")
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "file_required"


def test_upload_document_success_txt(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")

    content = b"This is a test medical lecture text with enough words to satisfy extraction requirements.\n" * 10
    data = {
        "file": (io.BytesIO(content), "lecture.txt"),
    }
    resp = client.post(
        "/api/editor/studio/upload-document",
        data=data,
        content_type="multipart/form-data",
    )
    assert resp.status_code == 200
    payload = resp.get_json()
    assert payload["ok"] is True
    assert "extracted_text" in payload
    assert payload["word_count"] > 50
    assert payload["file_info"]["original_name"] == "lecture.txt"


# ---------------------------------------------------------------------------
# 2. Canonical Prompts Tests
# ---------------------------------------------------------------------------


def test_get_prompts_requires_auth(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "guest")
    resp = client.get("/api/editor/studio/prompts")
    assert resp.status_code == 403


def test_get_prompts_analysis(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")
    resp = client.get("/api/editor/studio/prompts?type=analysis&lang=ru")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert data["prompt_type"] == "analysis"
    assert "<human_summary>" in data["prompt"]
    assert "<analysis_json>" in data["prompt"]
    # Verify corrected CLICK_WORDS description
    assert "CLICK_WORDS — синтез текста с намеренными фактическими ошибками" in data["prompt"]
    # Verify schema v2 / capability matrix is excluded
    assert "<capability_matrix_v1>" not in data["prompt"]
    assert "<analysis_v2_routes_mode>" not in data["prompt"]


def test_get_prompts_generation_specific_type(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")
    for task_type in ["TEST", "OPEN_ANSWER", "SEQUENCE", "CLICK_TEXT", "CLICK_WORDS"]:
        resp = client.get(f"/api/editor/studio/prompts?type=generation&task_type={task_type}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ok"] is True
        assert data["task_type"] == task_type
        assert f"@{task_type}" in data["prompt"]

    # Unknown type
    resp = client.get("/api/editor/studio/prompts?type=generation&task_type=UNKNOWN_TYPE")
    assert resp.status_code == 404
    assert resp.get_json()["error"] == "task_type_not_found"


def test_get_prompts_all(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")
    resp = client.get("/api/editor/studio/prompts?type=all")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert "analysis" in data
    assert "generation" in data
    assert "SEQUENCE" in data["generation"]


# ---------------------------------------------------------------------------
# 3. Session History & FIFO Retention (Max 3) Tests
# ---------------------------------------------------------------------------


def test_studio_sessions_lifecycle_and_fifo_rotation(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")

    # 1. Initially empty
    resp = client.get("/api/editor/studio/sessions")
    assert resp.status_code == 200
    assert resp.get_json()["sessions"] == []

    # 2. Save 4 sessions sequentially
    for i in range(1, 5):
        session_data = {
            "session_id": f"sess_00{i}",
            "module_id": "mod_1",
            "topic_id": "top_1",
            "created_at": f"2026-09-12T10:0{i}:00Z",
            "human_summary": f"Summary {i}",
            "recommendations": [{"task_type": "TEST", "count": i}],
            "tasks": [{"index": 0, "name": f"Task {i}"}],
            "status": "draft",
        }
        res = client.post("/api/editor/studio/sessions", json=session_data)
        assert res.status_code == 200
        assert res.get_json()["session"]["session_id"] == f"sess_00{i}"

    # 3. List sessions - must return only the latest 3 (sess_004, sess_003, sess_002)
    resp = client.get("/api/editor/studio/sessions")
    assert resp.status_code == 200
    sessions = resp.get_json()["sessions"]
    assert len(sessions) == 3

    ids = [s["session_id"] for s in sessions]
    assert ids == ["sess_004", "sess_003", "sess_002"]
    assert "sess_001" not in ids  # FIFO pruned!

    # 4. Delete one session
    del_resp = client.delete("/api/editor/studio/sessions/sess_003")
    assert del_resp.status_code == 200
    assert del_resp.get_json()["deleted"] is True

    # 5. Verify remaining
    resp2 = client.get("/api/editor/studio/sessions")
    remaining_ids = [s["session_id"] for s in resp2.get_json()["sessions"]]
    assert remaining_ids == ["sess_004", "sess_002"]


# ---------------------------------------------------------------------------
# 4. Stage 2 Scaffolding & Design System Tests
# ---------------------------------------------------------------------------


def test_studio_html_scaffolding():
    html_path = PROJECT_ROOT / "frontend" / "Editor" / "Task_Import_Studio.html"
    assert html_path.is_file(), "Task_Import_Studio.html must exist"
    content = html_path.read_text(encoding="utf-8")

    # Global ACTRA Header integration
    assert 'data-global-header' in content
    assert 'data-app-section="editor"' in content

    # Context toolbar elements
    assert 'id="btn-back-dashboard"' in content
    assert 'id="breadcrumb-module"' in content
    assert 'id="breadcrumb-topic"' in content
    assert 'id="btn-select-topic"' in content
    assert 'id="autosave-status-dot"' in content
    assert 'id="btn-open-history"' in content

    # 3-step navigation
    assert 'id="step-node-1"' in content
    assert 'id="step-node-2"' in content
    assert 'id="step-node-3"' in content

    # Stages 1, 2, 3
    assert 'id="stage-1"' in content
    assert 'id="stage-2"' in content
    assert 'id="stage-3"' in content

    # Stage 1 elements
    assert 'id="material-dropzone"' in content
    assert 'id="material-text-input"' in content
    assert 'id="btn-copy-analysis-prompt"' in content
    assert 'id="analysis-response-input"' in content
    assert 'id="btn-parse-analysis"' in content
    assert 'id="lesson-map-container"' in content

    # Stage 2 Zero-Scroll Split-View elements
    assert 'id="types-tabs-container"' in content
    assert 'id="btn-copy-type-prompt"' in content
    assert 'id="type-response-input"' in content
    assert 'id="live-parse-counter"' in content
    assert 'id="btn-commit-type-tasks"' in content

    # Stage 3 Showcase & Selective Import
    assert 'id="showcase-select-all"' in content
    assert 'id="showcase-cards-grid"' in content
    assert 'id="btn-execute-import"' in content

    # Modals
    assert 'id="modal-topic-selector"' in content
    assert 'id="modal-session-history"' in content
    assert 'id="modal-nav-guard"' in content

    # Ensure no mock filename or dummy text is hardcoded in HTML
    assert 'document.pdf' not in content, "document.pdf must not be hardcoded in HTML scaffolding"
    assert 'Резюме материала...' not in content, "Mockup placeholder text 'Резюме материала...' must not linger in HTML"


def test_studio_css_design_system():
    css_path = PROJECT_ROOT / "frontend" / "Editor" / "task_import_studio.css"
    assert css_path.is_file(), "task_import_studio.css must exist"
    content = css_path.read_text(encoding="utf-8")

    # Semantic CSS Variables & Heights
    assert '--studio-header-height' in content
    assert '--studio-subnav-height' in content
    assert '--studio-stepper-height' in content
    assert '--ease-spring' in content

    # Zero-Scroll Split View
    assert '.studio-shell' in content
    assert '.studio-split-panes' in content
    assert '.stage-2-container' in content

    # Utility hidden rules
    assert '.studio-file-chip.hidden' in content
    assert 'display: none !important;' in content

    # Micro-interactions & animations
    assert 'studio-pulse' in content
    assert 'studio-modal-in' in content

    # Accessibility guard
    assert '@media (prefers-reduced-motion: reduce)' in content


def test_studio_js_controller():
    js_path = PROJECT_ROOT / "frontend" / "Editor" / "task_import_studio.js"
    assert js_path.is_file(), "task_import_studio.js must exist"
    content = js_path.read_text(encoding="utf-8")

    # DataProtectionManager
    assert 'saveDraftToLocalStorage' in content
    assert 'restoreDraftFromLocalStorage' in content
    assert 'scheduleAutosave' in content
    assert 'beforeunload' in content
    assert 'modalNavGuard' in content

    # TopicGate
    assert 'openTopicModal' in content
    assert 'closeTopicModal' in content
    assert 'switchStep' in content
    assert 'selectedTopicId' in content

    # PromptEngine
    assert 'copyAnalysisPrompt' in content
    assert 'selectGenerationType' in content
    assert '/api/editor/studio/prompts' in content

    # ParserEngine
    assert 'uploadDocumentFile' in content
    assert 'parseAnalysisResponse' in content
    assert 'runClientRegexCounter' in content
    assert 'commitTypeTasks' in content
    assert '/api/editor/import/parse-analysis' in content
    assert '/api/editor/import/parse' in content

    # Showcase & CommitManager
    assert 'renderShowcase' in content
    assert 'executeImport' in content
    assert 'idempotencyKey' in content
    assert '/api/editor/import/execute' in content

    # SessionManager (PostgreSQL max 3 FIFO)
    assert 'loadSessionsList' in content
    assert 'saveSessionToBackend' in content
    assert 'restoreSession' in content
    assert 'deleteSessionFromBackend' in content
    assert '/api/editor/studio/sessions' in content


# ---------------------------------------------------------------------------
# 5. Stage 4 Entry Points & Navigation Integrity Tests
# ---------------------------------------------------------------------------


def test_stage4_entry_points_integrity():
    dashboard_html_path = PROJECT_ROOT / "frontend" / "Editor" / "Main_Dashboard.html"
    dashboard_js_path = PROJECT_ROOT / "frontend" / "Editor" / "dashboard.js"
    test_editor_html_path = PROJECT_ROOT / "frontend" / "Editor" / "Test Task Editor Multiple Choice.html"
    test_editor_js_path = PROJECT_ROOT / "frontend" / "Editor" / "test_editor.js"

    # Main_Dashboard.html
    dash_html = dashboard_html_path.read_text(encoding="utf-8")
    assert 'onclick="dashboard.openTaskImportStudio()"' in dash_html
    assert 'data-onboarding-target="editor-analysis-action"' in dash_html
    assert 'Анализ теории · Студия' in dash_html
    # Import modal button is preserved
    assert 'onclick="dashboard.showImportModal()"' in dash_html
    assert 'data-role="open-import-modal"' in dash_html

    # dashboard.js
    dash_js = dashboard_js_path.read_text(encoding="utf-8")
    assert 'openTaskImportStudio()' in dash_js
    assert 'formatTopicTaskCount(count)' in dash_js
    assert 'editor-breadcrumb-count' in dash_js

    # Test Task Editor Multiple Choice.html
    test_html = test_editor_html_path.read_text(encoding="utf-8")
    assert 'id="open-studio-sidebar-link"' in test_html
    assert 'href="/editor/Task_Import_Studio.html"' in test_html

    # test_editor.js
    test_js = test_editor_js_path.read_text(encoding="utf-8")
    assert '#open-studio-sidebar-link' in test_js
    assert '/editor/Task_Import_Studio.html' in test_js


# ---------------------------------------------------------------------------
# 6. Stage 5 Prompt Synchronization & Canonical Delivery Tests
# ---------------------------------------------------------------------------


def test_stage5_prompt_synchronization_and_exclusion():
    # Python canonical prompt
    prompts = studio_routes.get_all_studio_prompts("ru")
    analysis_prompt = prompts["analysis"]

    assert "CLICK_WORDS — синтез текста с намеренными фактическими ошибками" in analysis_prompt
    assert "laterality/направлениях" in analysis_prompt
    assert "<analysis_v2_routes_mode>" not in analysis_prompt
    assert "schema_v2" not in analysis_prompt

    # import_manager.js sync
    im_path = PROJECT_ROOT / "frontend" / "Editor" / "import_manager.js"
    im_content = im_path.read_text(encoding="utf-8")
    assert "CLICK_WORDS — синтез текста с намеренными фактическими ошибками для их обнаружения студентом." in im_content
    assert "laterality/направлениях" in im_content


# ---------------------------------------------------------------------------
# 7. Stage 6 Parser & Visual Recommendations Compatibility Tests
# ---------------------------------------------------------------------------


def test_stage6_visual_recommendations_and_parser_flow(monkeypatch):
    from routes import import_routes

    monkeypatch.setattr(import_routes, "get_extra", lambda key, default=None: default)

    raw_ai_response = """
<human_summary>
Тема: Лучевая диагностика пневмоний. Высокая содержательная плотность, материал богат как фактическими опорами, так и рентгенологическими снимками.
</human_summary>

<analysis_json>
{
  "material_volume": "medium",
  "educational_units": [
    {
      "id": 1,
      "title": "Инфильтрация лёгочной ткани",
      "type": "concept",
      "description": "Основной рентгенологический симптом долевой пневмонии.",
      "explicitness": "explicit",
      "evidence": "Лекция, раздел 2",
      "modality": "mixed",
      "assessment_risk": "medium"
    },
    {
      "id": 2,
      "title": "Дифференциальная диагностика",
      "type": "principle",
      "description": "Различение с ателектазом и инфаркт-пневмонией.",
      "explicitness": "explicit",
      "evidence": "Лекция, раздел 3",
      "modality": "text",
      "assessment_risk": "high"
    }
  ],
  "recommendations": [
    {
      "task_type": "TEST",
      "count": 3,
      "priority": "high",
      "covers_units": [1, 2],
      "rationale": "Проверка знания ключевых признаков и дифференциальной диагностики."
    },
    {
      "task_type": "CLICK_WORDS",
      "count": 2,
      "priority": "medium",
      "covers_units": [2],
      "rationale": "Искажения в формулировках дифференциальных критериев."
    },
    {
      "task_type": "CLICK",
      "count": 2,
      "priority": "high",
      "covers_units": [1],
      "rationale": "Локализация затемнения на рентгенограмме органов грудной клетки.",
      "manual_only": true,
      "auto_generation_supported": false
    },
    {
      "task_type": "DRAW",
      "count": 1,
      "priority": "medium",
      "covers_units": [1],
      "rationale": "Обводка зоны консолидации лёгочной ткани.",
      "manual_only": true,
      "auto_generation_supported": false
    }
  ],
  "not_recommended": [
    {
      "task_type": "SEQUENCE",
      "reason": "В материале нет жёсткого алгоритма или хронологии."
    }
  ],
  "illustrations_detected": true,
  "illustrations_note": "Материал включает примеры рентгенограмм лёгких.",
  "warnings": ["Задания типов CLICK и DRAW создаются вручную в визуальном редакторе."]
}
</analysis_json>
""".strip()

    parsed = import_routes._parse_imported_analysis_response(raw_ai_response)
    assert parsed["ok"] is True
    assert "Лучевая диагностика пневмоний" in parsed["human_summary"]
    assert len(parsed["educational_units"]) == 2
    assert len(parsed["recommendations"]) == 4

    # Verify CLICK and DRAW manual_only flags
    rec_types = {r["task_type"]: r for r in parsed["recommendations"]}
    assert "TEST" in rec_types
    assert "CLICK_WORDS" in rec_types
    assert "CLICK" in rec_types
    assert "DRAW" in rec_types

    assert rec_types["CLICK"].get("manual_only") is True
    assert rec_types["DRAW"].get("manual_only") is True
    assert parsed["illustrations_detected"] is True


def test_stage6_document_upload_error_handling(client, monkeypatch):
    monkeypatch.setattr(_context, "get_current_user_id", lambda: "teacher_1")

    # 1. Invalid file format
    data = {
        "file": (io.BytesIO(b"fake executable binary content"), "script.exe"),
    }
    resp = client.post(
        "/api/editor/studio/upload-document",
        data=data,
        content_type="multipart/form-data",
    )
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "unsupported_format"

    # 2. Mock DOCX / PDF success via FileProcessor
    from services.file_processor import ExtractionResult, FileProcessor

    def mock_process_file(self, content_bytes, filename, original_name=None):
        return ExtractionResult(
            ok=True,
            extracted_text="Извлечённый текст лекции из файла DOCX / PDF со всеми необходимыми словами.",
            word_count=120,
            file_info={"original_name": original_name or filename, "file_size": len(content_bytes)},
            warnings=[],
        )

    monkeypatch.setattr(FileProcessor, "process_file", mock_process_file)

    data_docx = {
        "file": (io.BytesIO(b"mock docx bytes"), "lecture.docx"),
    }
    resp_docx = client.post(
        "/api/editor/studio/upload-document",
        data=data_docx,
        content_type="multipart/form-data",
    )
    assert resp_docx.status_code == 200
    res = resp_docx.get_json()
    assert res["ok"] is True
    assert res["file_info"]["original_name"] == "lecture.docx"
    assert "Извлечённый текст лекции" in res["extracted_text"]


# ---------------------------------------------------------------------------
# 8. Localization Parity Tests (RU, EN, UK)
# ---------------------------------------------------------------------------


def test_studio_localization_keys_parity():
    import json

    locales_dir = PROJECT_ROOT / "frontend" / "assets" / "locales"
    ru_path = locales_dir / "ru.json"
    en_path = locales_dir / "en.json"
    uk_path = locales_dir / "uk.json"

    assert ru_path.is_file()
    assert en_path.is_file()
    assert uk_path.is_file()

    ru = json.loads(ru_path.read_text(encoding="utf-8"))
    en = json.loads(en_path.read_text(encoding="utf-8"))
    uk = json.loads(uk_path.read_text(encoding="utf-8"))

    assert "studio" in ru
    assert "studio" in en
    assert "studio" in uk

    def get_nested_keys(obj, prefix=""):
        keys = set()
        for k, v in obj.items():
            full = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                keys.update(get_nested_keys(v, full))
            else:
                keys.add(full)
        return keys

    ru_keys = get_nested_keys(ru["studio"])
    en_keys = get_nested_keys(en["studio"])
    uk_keys = get_nested_keys(uk["studio"])

    assert len(ru_keys) >= 110
    assert ru_keys == en_keys, f"Diff RU vs EN: {ru_keys ^ en_keys}"
    assert ru_keys == uk_keys, f"Diff RU vs UK: {ru_keys ^ uk_keys}"

    # Verify key dashboard and test editor additions
    for d in (ru, en, uk):
        assert "md" in d and "studio_btn" in d["md"]
        assert "xt" in d and "studio_link_label" in d["xt"]




