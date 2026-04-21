import io
import json
import shutil
import uuid
from pathlib import Path

import pytest

from server import app, _headless_app_ctx  # type: ignore
from task_system.core.io.task_io import TaskIO


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


@pytest.fixture
def temp_test_task():
    """Создает временный модуль/тему/задание в файловой структуре редактора."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"module_editor_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_editor_{uuid.uuid4().hex[:8]}"
    task_id = f"task_{uuid.uuid4().hex[:6]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    try:
        # Минимальные файлы модуля/темы
        (module_dir / "topics").mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)

        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        task_data = TaskIO.new_task("test", name="API Test", module=module_id, topic=topic_id)
        TaskIO.save(task_data, str(task_dir / "task.json"), validate=True)

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, task_id, task_dir
    finally:
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


@pytest.fixture
def temp_open_answer_task():
    """Создает временный open_answer задание."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"module_oa_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_oa_{uuid.uuid4().hex[:8]}"
    task_id = f"task_oa_{uuid.uuid4().hex[:6]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id
    task_dir = topic_dir / "tasks" / task_id

    try:
        (module_dir / "topics").mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)

        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        task_data = TaskIO.new_task("open_answer", name="OA Test", module=module_id, topic=topic_id)
        TaskIO.save(task_data, str(task_dir / "task.json"), validate=True)

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, task_id, task_dir
    finally:
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


@pytest.fixture
def temp_editor_topic():
    """Создает временный модуль и тему без задач для draft-first сценариев."""
    modules_dir = Path(_headless_app_ctx.storage_service.modules_dir)
    module_id = f"module_bootstrap_{uuid.uuid4().hex[:8]}"
    topic_id = f"topic_bootstrap_{uuid.uuid4().hex[:8]}"

    module_dir = modules_dir / module_id
    topic_dir = module_dir / "topics" / topic_id

    try:
        (module_dir / "topics").mkdir(parents=True, exist_ok=True)
        (topic_dir / "tasks").mkdir(parents=True, exist_ok=True)

        (module_dir / "module.json").write_text(
            json.dumps({"id": module_id, "name": module_id, "topics": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (topic_dir / "topic.json").write_text(
            json.dumps({"id": topic_id, "name": topic_id, "tasks": []}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        _headless_app_ctx.storage_service.reload_modules()
        yield module_id, topic_id, topic_dir
    finally:
        shutil.rmtree(module_dir, ignore_errors=True)
        _headless_app_ctx.storage_service.reload_modules()


def test_task_bootstrap_creates_unsaved_payload_and_first_save_materializes_task(client, temp_editor_topic):
    module_id, topic_id, topic_dir = temp_editor_topic

    bootstrap_resp = client.post(
        "/api/editor/task/bootstrap",
        json={
            "module_id": module_id,
            "topic_id": topic_id,
            "task_name": "Draft First Test",
            "task_type": "test",
        },
    )
    assert bootstrap_resp.status_code == 200
    bootstrap_data = bootstrap_resp.get_json()
    assert bootstrap_data["ok"] is True

    task_id = bootstrap_data["task_id"]
    task_payload = bootstrap_data["task"]["task_data"]
    task_dir = topic_dir / "tasks" / task_id
    task_json = task_dir / "task.json"

    assert task_id
    assert task_payload["meta"]["name"] == "Draft First Test"
    assert bootstrap_data["task"]["is_new"] is True
    assert not task_json.exists()

    task_payload["content"] = {
        "questions": [
            {
                "id": 0,
                "question": "Сколько будет 2+2?",
                "answers": [
                    {"id": "a", "text": "4", "correct": True},
                    {"id": "b", "text": "5", "correct": False},
                ],
            }
        ],
        "test_type": "multiple_choice",
        "settings": {
            "shuffle_questions": False,
            "shuffle_answers": False,
            "time_limit": None,
            "passing_score": 70,
        },
    }

    save_resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=task_payload)
    assert save_resp.status_code == 200
    assert save_resp.get_json()["ok"] is True
    assert task_json.exists()
    saved = json.loads(task_json.read_text(encoding="utf-8"))
    assert saved["id"] == task_id
    assert saved["meta"]["id"] == task_id
    assert saved["meta"]["name"] == "Draft First Test"

    catalog_resp = client.get("/api/editor/catalog")
    catalog_data = catalog_resp.get_json()
    module = next(item for item in catalog_data["modules"] if item["id"] == module_id)
    topic = next(item for item in module["topics"] if item["id"] == topic_id)
    assert any(task["id"] == task_id for task in topic["tasks"])

    get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert get_resp.status_code == 200
    loaded = get_resp.get_json()["task"]["task_data"]
    assert loaded["meta"]["name"] == "Draft First Test"
    assert loaded["content"]["questions"][0]["question"] == "Сколько будет 2+2?"


def test_task_bootstrap_still_allows_draft_when_limit_reached_but_first_save_is_blocked(client, temp_editor_topic, monkeypatch):
    module_id, topic_id, topic_dir = temp_editor_topic

    bootstrap_resp = client.post(
        "/api/editor/task/bootstrap",
        json={
            "module_id": module_id,
            "topic_id": topic_id,
            "task_name": "Quota Draft",
            "task_type": "test",
        },
    )
    assert bootstrap_resp.status_code == 200
    bootstrap_data = bootstrap_resp.get_json()
    assert bootstrap_data["ok"] is True

    task_id = bootstrap_data["task_id"]
    task_payload = bootstrap_data["task"]["task_data"]
    task_json = topic_dir / "tasks" / task_id / "task.json"
    assert not task_json.exists()

    task_payload["content"] = {
        "questions": [
            {
                "id": 0,
                "question": "1+1?",
                "answers": [
                    {"id": "a", "text": "2", "correct": True},
                    {"id": "b", "text": "3", "correct": False},
                ],
            }
        ],
        "test_type": "multiple_choice",
        "settings": {
            "shuffle_questions": False,
            "shuffle_answers": False,
            "time_limit": None,
            "passing_score": 70,
        },
    }

    from routes import editor_routes

    def _raise_limit(*args, **kwargs):
        raise editor_routes.WorkspaceLimitError(
            entity_kind="task",
            limit_kind="personal",
            count=20,
            limit=20,
            remaining=0,
            plan="free",
            message="Task limit reached",
        )

    monkeypatch.setattr(
        _headless_app_ctx.workspace_limits_service,
        "assert_can_create_workspace_entity",
        _raise_limit,
    )

    save_resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=task_payload)
    assert save_resp.status_code == 409
    save_data = save_resp.get_json()
    assert save_data["error"] == "workspace_limit_reached"
    assert save_data["details"]["entity_kind"] == "task"
    assert not task_json.exists()


def test_save_task_normalizes_legacy_root_id_for_catalog(client, temp_editor_topic):
    module_id, topic_id, topic_dir = temp_editor_topic
    task_id = "legacy_click_task"
    legacy_uuid = str(uuid.uuid4())
    payload = TaskIO.new_task("test", name="Legacy Name", module=module_id, topic=topic_id).to_dict()

    payload["id"] = legacy_uuid
    payload.pop("name", None)
    payload["meta"].pop("id", None)
    payload["meta"]["name"] = "Legacy Name"
    payload["content"] = {
        "questions": [
            {
                "id": 0,
                "question": "2+3?",
                "answers": [
                    {"id": "a", "text": "5", "correct": True},
                    {"id": "b", "text": "6", "correct": False},
                ],
            }
        ],
        "test_type": "multiple_choice",
        "settings": {
            "shuffle_questions": False,
            "shuffle_answers": False,
            "time_limit": None,
            "passing_score": 70,
        },
    }

    save_resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert save_resp.status_code == 200
    assert save_resp.get_json()["ok"] is True

    task_json = topic_dir / "tasks" / task_id / "task.json"
    saved = json.loads(task_json.read_text(encoding="utf-8"))
    assert saved["id"] == task_id
    assert saved["meta"]["id"] == task_id
    assert saved["meta"]["name"] == "Legacy Name"

    catalog_resp = client.get("/api/editor/catalog")
    catalog_data = catalog_resp.get_json()
    module = next(item for item in catalog_data["modules"] if item["id"] == module_id)
    topic = next(item for item in module["topics"] if item["id"] == topic_id)
    task = next(item for item in topic["tasks"] if item["id"] == task_id)
    assert task["name"] == "Legacy Name"


def test_open_answer_save_load_roundtrip(client, temp_open_answer_task):
    """ED-2 regression: open_answer save persists canonical fields and strips removed legacy knobs."""
    module_id, topic_id, task_id, task_dir = temp_open_answer_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    payload["content"] = {
        "question": "Что изображено на картинке?",
        "prompt": "Что изображено на картинке?",
        "keywords": ["рентгенография", "огк"],
        "reference_answer": "Рентгенография ОГК",
        "hint": "Подсказка",
        "max_length": 500,
        "min_keywords": 1,
        "require_all_keywords": False,
        "sequence_matters": True,
        "images": [],
        "image": None,
        "sample_answers": None,
        "min_length": None,
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    c = saved["content"]
    assert c["question"] == "Что изображено на картинке?"
    assert c["prompt"] == "Что изображено на картинке?"
    assert c["keywords"] == ["рентгенография", "огк"]
    assert c["reference_answer"] == "Рентгенография ОГК"
    assert c["hint"] == "Подсказка"
    assert c["max_length"] == 500
    assert c["sequence_matters"] is True
    assert "min_keywords" not in c
    assert "require_all_keywords" not in c
    assert "image" not in c
    assert "sample_answers" not in c
    assert "min_length" not in c

    # Verify reload via GET
    get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert get_resp.status_code == 200
    loaded = get_resp.get_json()["task"]["task_data"]["content"]
    assert loaded["question"] == "Что изображено на картинке?"
    assert loaded["keywords"] == ["рентгенография", "огк"]
    assert loaded["reference_answer"] == "Рентгенография ОГК"
    assert loaded["sequence_matters"] is True


def test_open_answer_save_copies_images(client, temp_open_answer_task):
    """ED-1 regression: content.images[] paths are normalized on save."""
    module_id, topic_id, task_id, task_dir = temp_open_answer_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    # Create a temp image file
    tmp_dir = task_dir / "tmp_imgs"
    tmp_dir.mkdir(exist_ok=True)
    img_file = tmp_dir / "oa_sample.png"
    img_file.write_text("fake image", encoding="utf-8")

    payload["content"] = {
        "question": "Вопрос",
        "keywords": ["ключ"],
        "images": [str(img_file)],
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    images = saved["content"].get("images", [])
    assert len(images) == 1
    assert images[0].startswith("modules/")
    copied = Path(_headless_app_ctx.data_dir) / images[0]
    assert copied.exists()


def test_open_answer_evaluator_reads_saved_data(client, temp_open_answer_task):
    """Verify canonical open_answer saves normalize into an evaluator-friendly answer key."""
    module_id, topic_id, task_id, task_dir = temp_open_answer_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    payload["content"] = {
        "question": "Что делает печень?",
        "prompt": "Что делает печень?",
        "keywords": ["детоксикация", "фильтрация"],
        "reference_answer": "Печень выполняет детоксикацию и фильтрацию",
        "max_length": 500,
        "sequence_matters": False,
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200

    # Load and normalize
    storage = _headless_app_ctx.storage_service
    loaded = storage.load_task(module_id, topic_id, task_id)
    td = loaded["task_data"]
    content = td["content"]
    answer_key = storage._normalize_answer_key(td, content.get("answer_key", {}))

    assert answer_key["keywords"] == ["детоксикация", "фильтрация"]
    assert answer_key["reference_answer"] == "Печень выполняет детоксикацию и фильтрацию"
    assert answer_key["max_length"] == 500
    assert "min_keywords" not in answer_key
    assert "require_all_keywords" not in answer_key

    # Evaluate
    from services.task_evaluator_service import TaskEvaluatorService
    evaluator = TaskEvaluatorService()
    result = evaluator.evaluate_open_answer_task({"answer": "детоксикация"}, answer_key)
    assert result.success is False
    too_long = evaluator.evaluate_open_answer_task({"answer": "a" * 501}, answer_key)
    assert too_long.success is False
    assert too_long.details["error"] == "answer_too_long"


def test_open_answer_save_strips_null_schema_noise(client, temp_open_answer_task):
    """New open_answer saves should not retain null-only fields from unrelated schema branches."""
    module_id, topic_id, task_id, task_dir = temp_open_answer_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    payload["content"] = {
        "question": "Назовите метод исследования",
        "prompt": "Назовите метод исследования",
        "keywords": ["рентген"],
        "reference_answer": "Рентгенография",
        "hint": None,
        "max_length": None,
        "min_keywords": 1,
        "require_all_keywords": False,
        "sequence_matters": False,
        "images": [],
        "image": None,
        "sample_answers": None,
        "min_length": None,
    }
    payload["settings"] = {
        "difficulty": 1,
        "time_limit": None,
        "allow_hints": False,
        "tolerancePx": None,
        "overlapThreshold": None,
        "success_threshold": None,
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    content = saved["content"]
    settings = saved["settings"]

    assert "hint" not in content
    assert "max_length" not in content
    assert "image" not in content
    assert "sample_answers" not in content
    assert "min_length" not in content
    assert "min_keywords" not in content
    assert "require_all_keywords" not in content
    assert "tolerancePx" not in settings
    assert "overlapThreshold" not in settings
    assert "success_threshold" not in settings


def test_open_answer_import_execute_with_keywords(client, temp_open_answer_task):
    """ED-4 regression: import/execute passes keywords and reference_answer to task.json."""
    module_id, topic_id, _, _ = temp_open_answer_task

    payload = {
        "module_id": module_id,
        "topic_id": topic_id,
        "tasks": [
            {
                "name": "Imported OA",
                "type": "open_answer",
                "status": "valid",
                "data": {
                    "question": "Что изображено на снимке?",
                    "keywords": ["рентгенография", "ОГК"],
                    "reference_answer": "Рентгенография ОГК",
                    "prompt": "Что изображено на снимке?",
                },
            }
        ],
    }

    resp = client.post("/api/editor/import/execute", json=payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["imported"] == 1

    imported_task_id = body["task_ids"][0]
    loaded = _headless_app_ctx.storage_service.load_task(module_id, topic_id, imported_task_id)
    assert loaded is not None
    content = loaded["task_data"]["content"]

    assert content["question"] == "Что изображено на снимке?"
    assert content["prompt"] == "Что изображено на снимке?"
    assert content["keywords"] == ["рентгенография", "ОГК"]
    assert content["reference_answer"] == "Рентгенография ОГК"


def test_editor_import_export_endpoints(client):
    sample = "?Question text\n+Correct\n-Wrong\n"

    import_resp = client.post(
        "/api/editor/test/import",
        data={"file": (io.BytesIO(sample.encode("utf-8")), "sample.txt")},
        content_type="multipart/form-data",
    )
    assert import_resp.status_code == 200
    payload = import_resp.get_json()
    assert payload["ok"] is True
    assert len(payload["content"]["questions"]) == 1

    export_payload = {
        "test_type": "multiple_choice",
        "settings": {"shuffle_questions": True, "shuffle_answers": True, "time_limit": None, "passing_score": 70},
        "questions": payload["content"]["questions"],
    }
    export_resp = client.post("/api/editor/test/export", json=export_payload)
    assert export_resp.status_code == 200
    body = export_resp.data.decode("utf-8")
    assert "?Question text" in body
    assert "+Correct" in body


def test_editor_save_copies_images(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    image_dir = task_dir / "tmp_images"
    image_dir.mkdir(exist_ok=True)
    image_file = image_dir / "sample_image.png"
    image_file.write_text("fake image bytes", encoding="utf-8")

    payload["content"] = {
        "test_type": "multiple_choice",
        "settings": {"shuffle_questions": True, "shuffle_answers": True, "time_limit": None, "passing_score": 70},
        "questions": [
            {
                "id": 0,
                "text": "Q1",
                "answers": [{"text": "A", "correct": True}, {"text": "B", "correct": False}],
                "image_path": str(image_file),
            }
        ],
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    image_path = saved["content"]["questions"][0].get("image_path")
    assert image_path and image_path.startswith("modules/")

    copied = Path(_headless_app_ctx.data_dir) / image_path
    assert copied.exists()


def test_editor_save_preserves_analysis_grounding_meta(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    payload.setdefault("meta", {})
    payload["meta"]["ai_run_id"] = "ai_run_20260225T170000Z_meta555"
    payload["meta"]["educational_unit_ids"] = [1, 2]
    payload["meta"]["analysis_chunk_ids"] = ["chunk_1", "chunk_2"]
    payload["meta"]["source_grounding"] = {"score": 0.42, "weak": True}

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    meta = saved["meta"]
    assert meta["ai_run_id"] == "ai_run_20260225T170000Z_meta555"
    assert meta["educational_unit_ids"] == [1, 2]
    assert meta["analysis_chunk_ids"] == ["chunk_1", "chunk_2"]
    assert meta["source_grounding"]["weak"] is True

    get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert get_resp.status_code == 200
    loaded_meta = get_resp.get_json()["task"]["task_data"]["meta"]
    assert loaded_meta["ai_run_id"] == "ai_run_20260225T170000Z_meta555"
    assert loaded_meta["educational_unit_ids"] == [1, 2]
    assert loaded_meta["analysis_chunk_ids"] == ["chunk_1", "chunk_2"]


def test_editor_delete_task_endpoint(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    assert task_dir.exists()

    resp = client.delete(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["ok"] is True
    assert not task_dir.exists()


def test_editor_sequence_roundtrip(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    task_json = task_dir / "task.json"

    payload = json.loads(task_json.read_text(encoding="utf-8"))
    payload["type"] = "sequence_assembly"
    payload["content"] = {
        "prompt": "Соберите правильный порядок действий",
        "elements": [
            {"id": "elem_1", "text": "Снять показания"},
            {"id": "elem_2", "text": "Зафиксировать результаты"}
        ],
        "levels": [
            {
                "level_id": "level_1",
                "level_name": "Основной шаг",
                "blocks": ["elem_1", "elem_2"]
            }
        ],
        "sequence": [
            {
                "level_id": "level_1",
                "title": "Основной шаг",
                "items": [
                    {"id": "elem_1", "label": "Снять показания"},
                    {"id": "elem_2", "label": "Зафиксировать результаты"}
                ]
            }
        ],
        "sequence_within_level_matters": True,
        "level_order_matters": False
    }

    task_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _headless_app_ctx.storage_service.reload_modules()

    get_resp = client.get(f"/api/editor/task/{module_id}/{topic_id}/{task_id}")
    assert get_resp.status_code == 200
    body = get_resp.get_json()
    assert body["ok"] is True
    task_payload = body["task"]["task_data"]

    task_payload["content"]["elements"].append({"id": "elem_3", "text": "Отправить заключение"})
    task_payload["content"]["levels"].append({
        "level_id": "level_2",
        "level_name": "Завершение",
        "blocks": ["elem_3"]
    })
    task_payload["content"]["sequence"].append({
        "level_id": "level_2",
        "title": "Завершение",
        "items": [{"id": "elem_3", "label": "Отправить заключение"}]
    })
    task_payload["content"]["level_order_matters"] = True

    save_resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=task_payload)
    assert save_resp.status_code == 200
    assert save_resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    assert saved["type"] == "sequence_assembly"
    saved_content = saved["content"]
    assert len(saved_content["elements"]) == 3
    assert any(elem["id"] == "elem_3" for elem in saved_content["elements"])
    assert len(saved_content["levels"]) == 2
    assert saved_content["level_order_matters"] is True


def test_editor_import_execute_click_word_errors_normalized(client, temp_test_task):
    module_id, topic_id, _, _ = temp_test_task

    payload = {
        "module_id": module_id,
        "topic_id": topic_id,
        "tasks": [
            {
                "name": "Imported Click Errors",
                "type": "click",
                "status": "valid",
                "data": {
                    "prompt": "Find mistakes",
                    "mode": "word_errors",
                    "subtype": "error_detection",
                    "text": "alpha beta gamma",
                    "error_indices": [1],
                },
            }
        ],
    }

    resp = client.post("/api/editor/import/execute", json=payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["imported"] == 1
    assert len(body["task_ids"]) == 1

    imported_task_id = body["task_ids"][0]
    loaded = _headless_app_ctx.storage_service.load_task(module_id, topic_id, imported_task_id)
    assert loaded is not None
    task_data = loaded["task_data"]
    content = task_data["content"]

    assert task_data["type"] == "click"
    assert task_data.get("subtype") == "error_detection"
    assert content["mode"] == "text_errors"
    assert "error_indices" not in content
    assert isinstance(content.get("error_spans"), list)
    assert len(content["error_spans"]) == 1
    assert content["error_spans"][0]["start"] == 6
    assert content["error_spans"][0]["end"] == 10


def test_editor_import_execute_click_text_choice_normalizes_correct_flag(client, temp_test_task):
    module_id, topic_id, _, _ = temp_test_task

    payload = {
        "module_id": module_id,
        "topic_id": topic_id,
        "tasks": [
            {
                "name": "Imported Click Choice",
                "type": "click",
                "status": "valid",
                "data": {
                    "prompt": "Choose right",
                    "mode": "text_choice",
                    "subtype": "error_detection",
                    "options": [
                        {"id": "o1", "text": "Wrong", "correct": False},
                        {"id": "o2", "text": "Right", "correct": True},
                    ],
                },
            }
        ],
    }

    resp = client.post("/api/editor/import/execute", json=payload)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["ok"] is True
    assert body["imported"] == 1
    assert len(body["task_ids"]) == 1

    imported_task_id = body["task_ids"][0]
    loaded = _headless_app_ctx.storage_service.load_task(module_id, topic_id, imported_task_id)
    assert loaded is not None
    task_data = loaded["task_data"]
    content = task_data["content"]

    assert task_data["type"] == "click"
    assert task_data.get("subtype") == "error_detection"
    assert content["mode"] == "text_choice"
    assert isinstance(content.get("options"), list)
    assert len(content["options"]) == 2
    assert all("is_correct" in option for option in content["options"])
    assert any(option["is_correct"] for option in content["options"])


def test_editor_save_copies_click_additional_info_images(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    source_dir = task_dir / "tmp_click_images"
    source_dir.mkdir(exist_ok=True)
    main_image = source_dir / "main_click.png"
    extra_image = source_dir / "extra_click.png"
    extra_image_2 = source_dir / "extra_click_2.png"
    main_image.write_text("main", encoding="utf-8")
    extra_image.write_text("extra", encoding="utf-8")
    extra_image_2.write_text("extra2", encoding="utf-8")

    payload["type"] = "click"
    payload["subtype"] = "error_detection"
    payload["content"] = {
        "prompt": "Click task",
        "mode": "text_choice",
        "subtype": "error_detection",
        "annotations": [],
        "image": str(main_image),
        "options": [
            {"id": "c1", "text": "Wrong", "is_correct": False},
            {"id": "c2", "text": "Right", "is_correct": True},
        ],
        "additionalInfo": {
            "type": "combined",
            "text": "Hint text",
            "image": str(extra_image),
            "images": [str(extra_image), str(extra_image_2)],
        },
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    content = saved["content"]
    additional = content.get("additionalInfo", {})

    assert content.get("image", "").startswith("modules/")
    copied_main = Path(_headless_app_ctx.data_dir) / content["image"]
    assert copied_main.exists()

    assert isinstance(additional, dict)
    assert additional.get("image", "").startswith("modules/")
    copied_extra = Path(_headless_app_ctx.data_dir) / additional["image"]
    assert copied_extra.exists()

    assert isinstance(additional.get("images"), list)
    assert len(additional["images"]) == 2
    for image_path in additional["images"]:
        assert image_path.startswith("modules/")
        assert (Path(_headless_app_ctx.data_dir) / image_path).exists()


def test_editor_save_click_threshold_syncs_settings_and_preserves_metadata(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    task_json = task_dir / "task.json"
    payload = json.loads(task_json.read_text(encoding="utf-8"))

    source_dir = task_dir / "tmp_click_threshold"
    source_dir.mkdir(exist_ok=True)
    main_image = source_dir / "main_threshold.png"
    main_image.write_text("threshold-main", encoding="utf-8")

    created_iso = "2025-01-02T03:04:05+00:00"
    payload["type"] = "click"
    payload["meta"] = {
        "id": task_id,
        "name": "Click Threshold Test",
        "module": module_id,
        "topic": topic_id,
        "created": created_iso,
        "custom_marker": "keep-me",
    }
    payload["settings"] = {}
    payload["content"] = {
        "prompt": "Найдите области",
        "image": str(main_image),
        "required_correct": 2,
        "annotations": [
            {
                "type": "polygon",
                "label": "Область 1",
                "points": [[0, 0], [12, 0], [0, 12]],
            },
            {
                "type": "polygon",
                "label": "Область 2",
                "points": [[20, 20], [32, 20], [20, 32]],
            },
        ],
    }

    resp = client.post(f"/api/editor/task/{module_id}/{topic_id}/{task_id}", json=payload)
    assert resp.status_code == 200
    assert resp.get_json()["ok"] is True

    saved = json.loads(task_json.read_text(encoding="utf-8"))
    assert saved["content"]["required_correct"] == 2
    assert saved["settings"]["success_threshold"] == 2
    assert saved["meta"]["created"] == created_iso
    assert saved["meta"]["created_at"] == created_iso
    assert saved["meta"]["custom_marker"] == "keep-me"
    assert isinstance(saved["meta"].get("modified"), str)
    assert saved["meta"]["modified"]


def test_editor_upload_image_reuses_identical_file_instead_of_creating_suffix(client, temp_test_task):
    module_id, topic_id, task_id, task_dir = temp_test_task
    images_dir = task_dir / "images"

    upload_payload = {
        "module": module_id,
        "topic": topic_id,
        "task": task_id,
    }
    first = client.post(
        "/api/editor/upload-image",
        data={
            **upload_payload,
            "file": (io.BytesIO(b"same-image-bits"), "diagram.png"),
        },
        content_type="multipart/form-data",
    )
    assert first.status_code == 200
    first_data = first.get_json()
    assert first_data["ok"] is True

    second = client.post(
        "/api/editor/upload-image",
        data={
            **upload_payload,
            "file": (io.BytesIO(b"same-image-bits"), "diagram.png"),
        },
        content_type="multipart/form-data",
    )
    assert second.status_code == 200
    second_data = second.get_json()
    assert second_data["ok"] is True
    assert second_data["reused"] is True
    assert second_data["path"] == first_data["path"]

    stored_files = sorted(path.name for path in images_dir.glob("diagram*.png"))
    assert stored_files == ["diagram.png"]
