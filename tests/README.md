# Task Import Parser Tests

This directory contains automated tests for the task import parser feature.

## Structure

- `unit/` - Unit tests for individual parsers
- `integration/` - Integration tests for API endpoints
- `fixtures/` - Test data and fixtures

## Running Tests

### Install dependencies

```bash
pip install -r test_requirements.txt
```

### Run all tests

```bash
# From project root
pytest tests/ -v

# With coverage
pytest tests/ -v --cov=task_system --cov=desktop-app --cov-report=html
```

### Run specific test suites

```bash
# Unit tests only
pytest tests/unit/ -v

# Integration tests only (requires server running)
pytest tests/integration/ -v
```

### Run specific test file

```bash
pytest tests/unit/test_task_import_parsers.py -v
pytest tests/integration/test_import_api.py -v
```

## Test Coverage

### Unit Tests (`test_task_import_parsers.py`)

**TestOpenAnswerParser:**
- Single task parsing
- Multiple tasks parsing
- Empty prompt error handling
- Short prompt warnings

**TestSequenceParser:**
- Valid sequence parsing
- Duplicate element ID warnings
- Invalid element reference errors
- Unused elements warnings

**TestClickTextParser:**
- Valid click text parsing
- No correct answers error

**TestClickWordsParser:**
- Valid click words parsing
- Invalid indices error

**TestParserIntegration:**
- Mixed task types parsing
- Task name generation

### Integration Tests (`test_import_api.py`)

**TestImportParseAPI:**
- Parse Open Answer success
- Parse Sequence success
- Parse Click Text success
- Missing module_id error
- Empty text error
- Multiple task types
- Validation errors handling

**TestImportExecuteAPI:**
- Execute import success
- Invalid module error
- Empty tasks array
- Skip error tasks

**TestFullImportFlow:**
- Complete workflow (parse → execute)
- Import with warnings

## Notes

- Integration tests require the server to be running at `http://localhost:8000`
- Tests use `test_module` and `test_topic` - ensure these exist or configure fixtures
- Coverage reports are generated in `htmlcov/` directory
