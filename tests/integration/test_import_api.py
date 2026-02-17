"""
Integration tests for Task Import API Endpoints
Tests /api/editor/import/parse and /api/editor/import/execute
"""

import os

import pytest
import requests
import uuid


# Runtime-resolved configuration (set by check_server_running fixture).
BASE_URL = ""
PARSE_ENDPOINT = ""
EXECUTE_ENDPOINT = ""


def _detect_base_url() -> str:
    """Resolve a reachable server URL from common local hosts/ports."""
    candidates = [
        os.getenv("IMPORT_API_BASE"),
        "http://127.0.0.1:8000",  # desktop-app/server.py default
        "http://localhost:8000",
        "http://127.0.0.1:5000",
        "http://localhost:5000",
    ]
    candidates = [c for c in candidates if c]

    errors = []
    for base in candidates:
        for path in ("/api/health", "/health", "/"):
            url = f"{base}{path}"
            try:
                response = requests.get(
                    url,
                    timeout=2,
                    proxies={"http": None, "https": None},
                )
                if response.status_code < 500:
                    return base
                errors.append(f"{url}: HTTP {response.status_code}")
            except requests.exceptions.RequestException as exc:
                errors.append(f"{url}: {exc}")

    pytest.skip(
        "Server is not reachable on common hosts/ports.\n"
        + "\n".join(errors)
    )


@pytest.fixture
def valid_module_topic():
    """Create an isolated module/topic pair for import tests."""
    module_name = f"import-module-{uuid.uuid4().hex[:8]}"
    module_resp = requests.post(
        f"{BASE_URL}/api/editor/module/new",
        json={"name": module_name},
    )
    assert module_resp.status_code == 200, module_resp.text
    module_data = module_resp.json()
    assert module_data.get("ok") is True, module_data
    module_id = module_data["module_id"]

    topic_name = f"import-topic-{uuid.uuid4().hex[:8]}"
    topic_resp = requests.post(
        f"{BASE_URL}/api/editor/topic/new",
        json={"module_id": module_id, "name": topic_name},
    )
    assert topic_resp.status_code == 200, topic_resp.text
    topic_data = topic_resp.json()
    assert topic_data.get("ok") is True, topic_data
    topic_id = topic_data["topic_id"]

    try:
        yield {"module_id": module_id, "topic_id": topic_id}
    finally:
        # Best-effort cleanup: deleting module removes all created topics/tasks.
        requests.post(
            f"{BASE_URL}/api/editor/modules/delete",
            json={"module_id": module_id},
        )


class TestImportParseAPI:
    """Tests for /api/editor/import/parse endpoint"""
    
    def test_parse_open_answer_success(self, valid_module_topic):
        """Test successful parsing of Open Answer task"""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@OPEN_ANSWER
# Опишите основные признаки пневмонии на рентгенограмме
"""
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data['ok'] is True
        assert 'summary' in data
        assert data['summary']['total'] == 1
        assert len(data['tasks']) == 1
        assert data['tasks'][0]['type'] == 'open_answer'
    
    def test_parse_sequence_success(self, valid_module_topic):
        """Test successful parsing of Sequence task"""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@SEQUENCE
# Алгоритм диагностики
element_1: Сбор анамнеза
element_2: Обследование
level_1: element_1
level_2: element_2
"""
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data['ok'] is True
        assert data['summary']['total'] == 1
        assert data['tasks'][0]['type'] == 'sequence_assembly'
    
    def test_parse_click_text_success(self, valid_module_topic):
        """CLICK_TEXT should be accepted as click/error_detection subtype."""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@CLICK_TEXT
# Выберите правильные ответы
+ Правильно
- Неправильно
"""
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data['ok'] is True
        assert data['summary']['total'] == 1
        assert data['tasks'][0]['type'] == 'click'
        assert data['tasks'][0]['data']['mode'] == 'text_choice'
        assert data['tasks'][0]['data']['subtype'] == 'error_detection'
        assert not any("CLICK_TEXT" in msg for msg in data.get("parsing_errors", []))

    def test_parse_click_words_success(self, valid_module_topic):
        """CLICK_WORDS should be accepted as click/error_detection subtype."""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@CLICK_WORDS
# Найдите ошибки в тексте (индексы: 1, 3)
Это тестовый текст с ошибками для проверки парсинга
"""
        }

        response = requests.post(PARSE_ENDPOINT, json=payload)

        assert response.status_code == 200
        data = response.json()

        assert data['ok'] is True
        assert data['summary']['total'] == 1
        assert data['tasks'][0]['type'] == 'click'
        assert data['tasks'][0]['data']['subtype'] == 'error_detection'
        assert data['tasks'][0]['data']['mode'] in ('word_errors', 'text_errors')
        assert not any("CLICK_WORDS" in msg for msg in data.get("parsing_errors", []))
    
    def test_parse_missing_module_id(self):
        """Test error when module_id is missing"""
        payload = {
            'topic_id': 'some_topic',
            'text': '@OPEN_ANSWER\n# Test'
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 400
        data = response.json()
        assert data['ok'] is False
    
    def test_parse_empty_text(self, valid_module_topic):
        """Test error when text is empty"""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': ''
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 400
        data = response.json()
        assert data['ok'] is False
    
    def test_parse_multiple_task_types(self, valid_module_topic):
        """Test parsing multiple task types in one request"""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@OPEN_ANSWER
# Вопрос 1

@SEQUENCE
# Последовательность
element_1: Шаг
level_1: element_1

@CLICK_TEXT
# Выбор
+ Да
- Нет
"""
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        assert data['ok'] is True
        assert data['summary']['total'] == 3
        assert not any("CLICK_TEXT" in msg for msg in data.get("parsing_errors", []))
    
    def test_parse_with_validation_errors(self, valid_module_topic):
        """Parser should return a stable preview payload for short prompts."""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@OPEN_ANSWER
# X
"""  # Too short prompt
        }
        
        response = requests.post(PARSE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        if len(data.get('tasks', [])) > 0:
            task = data['tasks'][0]
            assert task['status'] in ['valid', 'warning', 'error']


class TestImportExecuteAPI:
    """Tests for /api/editor/import/execute endpoint"""
    
    def test_execute_import_success(self, valid_module_topic):
        """Test successful task import execution"""
        # First parse
        parse_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': """
@OPEN_ANSWER
# Тестовый вопрос для импорта
"""
        }
        
        parse_response = requests.post(PARSE_ENDPOINT, json=parse_payload)
        parse_data = parse_response.json()
        
        assert parse_data['ok'] is True
        
        # Then execute
        execute_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'tasks': parse_data['tasks']
        }
        
        execute_response = requests.post(EXECUTE_ENDPOINT, json=execute_payload)
        
        assert execute_response.status_code == 200
        execute_data = execute_response.json()
        
        assert execute_data['ok'] is True
        assert execute_data['imported'] >= 1
    
    def test_execute_invalid_module(self):
        """Test error when module doesn't exist"""
        payload = {
            'module_id': 'nonexistent_module_xyz',
            'topic_id': 'nonexistent_topic',
            'tasks': [{
                'type': 'open_answer',
                'name': 'Test Task',
                'data': {'prompt': 'Test'},
                'status': 'valid'
            }]
        }
        
        response = requests.post(EXECUTE_ENDPOINT, json=payload)
        
        assert response.status_code == 400
        data = response.json()
        assert data['ok'] is False
    
    def test_execute_without_tasks(self, valid_module_topic):
        """Execute requires non-empty tasks payload."""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'tasks': []
        }
        
        response = requests.post(EXECUTE_ENDPOINT, json=payload)
        
        assert response.status_code == 400
        data = response.json()
        assert data['ok'] is False
        assert data['error'] == 'tasks_required'
    
    def test_execute_skips_error_tasks(self, valid_module_topic):
        """Test that tasks with errors are skipped"""
        payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'tasks': [
                {
                    'type': 'open_answer',
                    'name': 'Valid Task',
                    'data': {'prompt': 'Valid question'},
                    'status': 'valid'
                },
                {
                    'type': 'open_answer',
                    'name': 'Error Task',
                    'data': {'prompt': ''},
                    'status': 'error'
                }
            ]
        }
        
        response = requests.post(EXECUTE_ENDPOINT, json=payload)
        
        assert response.status_code == 200
        data = response.json()
        
        # Should only import the valid task
        assert data['imported'] <= 1


class TestFullImportFlow:
    """End-to-end tests for complete import flow"""
    
    def test_complete_import_workflow(self, valid_module_topic):
        """Test complete workflow: parse → review → execute"""
        # Step 1: Parse text
        text_to_import = """
@OPEN_ANSWER
# Описание рентгенологической картины
        
@SEQUENCE
# Протокол исследования
element_1: Подготовка пациента
element_2: Выполнение снимка
element_3: Описание
level_1: element_1
level_2: element_2, element_3
"""
        
        parse_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': text_to_import
        }
        
        parse_response = requests.post(PARSE_ENDPOINT, json=parse_payload)
        assert parse_response.status_code == 200
        
        parse_data = parse_response.json()
        assert parse_data['ok'] is True
        assert parse_data['summary']['total'] == 2
        
        # Step 2: Execute import
        valid_tasks = [t for t in parse_data['tasks'] if t['status'] != 'error']
        
        execute_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'tasks': valid_tasks
        }
        
        execute_response = requests.post(EXECUTE_ENDPOINT, json=execute_payload)
        assert execute_response.status_code == 200
        
        execute_data = execute_response.json()
        assert execute_data['ok'] is True
        assert execute_data['imported'] == len(valid_tasks)
    
    def test_import_with_validation_warnings(self, valid_module_topic):
        """Test importing tasks with warnings (should still succeed)"""
        text_to_import = """
@SEQUENCE
# Test
element_1: A
element_2: B
element_3: C
level_1: element_1
"""  # element_2 and element_3 unused - should generate warnings
        
        parse_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'text': text_to_import
        }
        
        parse_response = requests.post(PARSE_ENDPOINT, json=parse_payload)
        parse_data = parse_response.json()
        
        # Should parse with warnings
        assert parse_data['ok'] is True
        
        # Execute should still work
        execute_payload = {
            'module_id': valid_module_topic['module_id'],
            'topic_id': valid_module_topic['topic_id'],
            'tasks': parse_data['tasks']
        }
        
        execute_response = requests.post(EXECUTE_ENDPOINT, json=execute_payload)
        execute_data = execute_response.json()
        
        assert execute_data['ok'] is True


@pytest.fixture(scope="session", autouse=True)
def check_server_running():
    """Verify server is running before tests"""
    global BASE_URL, PARSE_ENDPOINT, EXECUTE_ENDPOINT
    BASE_URL = _detect_base_url()
    PARSE_ENDPOINT = f"{BASE_URL}/api/editor/import/parse"
    EXECUTE_ENDPOINT = f"{BASE_URL}/api/editor/import/execute"


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
