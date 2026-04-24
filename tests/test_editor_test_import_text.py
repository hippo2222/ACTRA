import io

from flask import Flask

from routes.editor_routes import editor_bp


def _client():
    app = Flask(__name__)
    app.register_blueprint(editor_bp)
    return app.test_client()


def test_test_import_accepts_raw_text_payload():
    raw_text = """?Какой вариант верный?
+Правильный
-Неверный

?Выберите города Украины
+Киев
+Львов
-Варшава
"""

    response = _client().post("/api/editor/test/import", json={"text": raw_text})

    assert response.status_code == 200
    payload = response.get_json()
    assert payload["ok"] is True
    questions = payload["content"]["questions"]
    assert len(questions) == 2
    assert payload["content"]["test_type"] == "multiple_choice"
    assert questions[0]["text"] == "Какой вариант верный?"
    assert questions[0]["answers"][0] == {"text": "Правильный", "correct": True, "image_path": None}
    assert questions[0]["answers"][1]["correct"] is False
    assert [answer["correct"] for answer in questions[1]["answers"]] == [True, True, False]


def test_test_import_accepts_file_with_multiple_correct_answers():
    raw_text = """?Выберите все чётные числа
+2
+4
-5
"""

    response = _client().post(
        "/api/editor/test/import",
        data={"file": (io.BytesIO(raw_text.encode("utf-8")), "questions.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 200
    payload = response.get_json()
    questions = payload["content"]["questions"]
    assert len(questions) == 1
    assert questions[0]["text"] == "Выберите все чётные числа"
    assert [answer["correct"] for answer in questions[0]["answers"]] == [True, True, False]


def test_test_import_still_requires_file_or_text():
    response = _client().post("/api/editor/test/import")

    assert response.status_code == 400
    assert response.get_json()["error"] == "file_or_text_required"
