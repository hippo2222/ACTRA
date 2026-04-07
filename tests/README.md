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

## Playwright Tests (Frontend E2E)

### Theory Center Fixes Tests

Комплексный набор E2E тестов для проверки всех исправлений Центра теории.

**Файлы:**
- `theory-center-fixes.test.mjs` - Основные тесты
- `theory-center-helpers.mjs` - Helper функции

### Запуск Playwright тестов

```bash
# Установка Playwright (если ещё не установлен)
npm install -D @playwright/test

# Установка браузеров
npx playwright install

# Запуск всех тестов
npx playwright test

# Запуск конкретного файла
npx playwright test theory-center-fixes.test.mjs

# Запуск с UI режимом
npx playwright test --ui

# Запуск с headed браузером (видимый)
npx playwright test --headed

# Запуск конкретного теста
npx playwright test -g "должен отображать Автосинхронизация"
```

### Покрытие тестами

**Локализация и тексты:**
- ✅ "Автосинхронизация" вместо "Worker Sync"
- ✅ Пояснения к способам привязки
- ✅ Корректный текст о комплексах
- ✅ Упрощённый текст в редакторе

**Модальные окна:**
- ✅ Кастомное модальное окно создания теории
- ✅ Кнопки закрытия
- ✅ Поддержка Enter/Escape

**Навигация:**
- ✅ Кнопка "Центр теории" в хедере
- ✅ Кликабельность кнопок
- ✅ Правильные тексты кнопок

**Форматирование:**
- ✅ Кнопка подчёркивания текста
- ✅ Расположение кнопок форматирования

**Изображения:**
- ✅ Атрибуты data-width и data-align
- ✅ Кликабельность (cursor: pointer)
- ✅ Обёртка theory-image-wrapper

**UI элементы:**
- ✅ Высота списка теорий
- ✅ Отсутствие растягивания тегов
- ✅ Адаптивность кнопок

**Статусы и tooltips:**
- ✅ Tooltips у статусов синхронизации
- ✅ Title атрибуты у кнопок

**Анимации:**
- ✅ Использование will-change
- ✅ Оптимизированные transitions

**Интеграция:**
- ✅ Навигация между страницами
- ✅ Отсутствие критичных ошибок

### Требования

- Сервер должен быть запущен на `http://localhost:5000`
- Node.js версии 16 или выше
- Playwright установлен и настроен

### Отчёты

```bash
# Генерация HTML отчёта
npx playwright test --reporter=html

# Открыть отчёт
npx playwright show-report
```

## Notes

- Integration tests require the server to be running at `http://localhost:8000`
- Tests use `test_module` and `test_topic` - ensure these exist or configure fixtures
- Coverage reports are generated in `htmlcov/` directory
- Playwright tests require server at `http://localhost:5000`
