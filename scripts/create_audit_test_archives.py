import os
import json
import zipfile
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
OUTPUT_DIR = BASE_DIR / "reports" / "import_modal_audit" / "block_b"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# 1. Corrupt ZIP
corrupt_path = OUTPUT_DIR / "corrupt_test.zip"
with open(corrupt_path, "wb") as f:
    f.write(b"CORRUPTED_NOT_A_VALID_ZIP_HEADER_BYTES_1234567890")
print(f"[Archive Generator] Created {corrupt_path}")

# 2. Rich Test Archive
archive_path = OUTPUT_DIR / "audit_test_archive.zip"
with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as zf:
    # Manifest with older version to trigger compatibility warning
    manifest = {
        "app_version": "0.8.0",
        "module_names": {
            "modul_radiofiziki": "Радиофизика",
            "modul_biomed": "Биомедицина"
        },
        "topic_names": {
            "modul_radiofiziki": {
                "razdel_elektromagnetizm": "Электромагнетизм"
            },
            "modul_biomed": {
                "razdel_endokrin": "Эндокринология"
            }
        }
    }
    zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    # Task 1: Valid new task
    task_1 = {
        "id": "task_brand_new_insulinoma",
        "name": "Диагностика инсулиномы у взрослых",
        "type": "open_answer",
        "description": "Клинический разбор гипогликемического синдрома",
        "content": {
            "prompt": "Опишите пробу с 72-часовым голоданием при подозрении на инсулиному.",
            "reference_answer": "Контроль гликемии, С-пептида и инсулина каждые 6 часов."
        }
    }
    zf.writestr(
        "modules/modul_biomed/topics/razdel_endokrin/tasks/task_brand_new_insulinoma/task.json",
        json.dumps(task_1, ensure_ascii=False, indent=2)
    )

    # Task 2: Conflict / Overwrite with existing task_19acfca43d36
    task_2 = {
        "id": "task_19acfca43d36",
        "name": "Задание - Test 1 (Архивная модификация)",
        "type": "test",
        "description": "Модифицированное описание из архива",
        "content": {
            "test_type": "single_choice",
            "questions": [
                {
                    "id": 0,
                    "text": "Обновленный вопрос из архива?",
                    "answers": [
                        {"id": "q1_a1", "text": "Да", "is_correct": True},
                        {"id": "q1_a2", "text": "Нет", "is_correct": False}
                    ]
                }
            ]
        }
    }
    zf.writestr(
        "modules/modul_radiofiziki/topics/razdel_elektromagnetizm/tasks/task_19acfca43d36/task.json",
        json.dumps(task_2, ensure_ascii=False, indent=2)
    )

    # Task 3: Error task with invalid JSON syntax
    zf.writestr(
        "modules/modul_biomed/topics/razdel_endokrin/tasks/task_broken_corrupt/task.json",
        "{ 'corrupted_json': missing_closing_bracket"
    )

print(f"[Archive Generator] Created {archive_path} with 3 diverse tasks and manifest.")
