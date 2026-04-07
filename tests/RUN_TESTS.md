# Быстрый запуск тестов Центра теории

## Предварительные требования

1. **Запустите сервер приложения:**
   ```bash
   # Из корня проекта
   python desktop-app/app.py
   ```
   Сервер должен быть доступен на `http://localhost:5000`

2. **Установите Playwright (если ещё не установлен):**
   ```bash
   npm install -D @playwright/test
   npx playwright install
   ```

## Запуск тестов

### Все тесты Центра теории
```bash
npx playwright test theory-center-fixes.test.mjs
```

### С видимым браузером (рекомендуется для первого запуска)
```bash
npx playwright test theory-center-fixes.test.mjs --headed
```

### С UI режимом (интерактивный)
```bash
npx playwright test theory-center-fixes.test.mjs --ui
```

### Конкретная группа тестов
```bash
# Только локализация
npx playwright test -g "Локализация и понятность"

# Только модальные окна
npx playwright test -g "Кастомное модальное окно"

# Только изображения
npx playwright test -g "Функциональность изображений"

# Только UI элементы
npx playwright test -g "UI элементы"
```

### Отладка конкретного теста
```bash
npx playwright test -g "должен отображать Автосинхронизация" --headed --debug
```

## Просмотр отчётов

```bash
# Генерация HTML отчёта
npx playwright test theory-center-fixes.test.mjs --reporter=html

# Открыть отчёт в браузере
npx playwright show-report
```

## Структура тестов

### 📋 Покрытие (всего ~30 тестов)

1. **Локализация и тексты** (4 теста)
   - Автосинхронизация вместо Worker Sync
   - Пояснения к способам привязки
   - Корректный текст о комплексах
   - Упрощённый текст в редакторе

2. **Модальные окна** (3 теста)
   - Кастомное модальное окно
   - Кнопки закрытия
   - Поддержка клавиатуры

3. **Навигация** (3 теста)
   - Кнопка Центра теории
   - Кликабельность
   - Правильные тексты

4. **Форматирование** (2 теста)
   - Кнопка подчёркивания
   - Расположение кнопок

5. **Изображения** (3 теста)
   - Атрибуты изображений
   - Кликабельность
   - Обёртки

6. **UI элементы** (4 теста)
   - Высота списков
   - Теги без растягивания
   - Адаптивность

7. **Статусы и tooltips** (2 теста)
   - Tooltips синхронизации
   - Title атрибуты

8. **Анимации** (2 теста)
   - will-change
   - transitions

9. **Интеграция** (2 теста)
   - Навигация
   - Отсутствие ошибок

## Ожидаемые результаты

✅ **Все тесты должны пройти успешно** если:
- Сервер запущен на localhost:5000
- Все исправления применены корректно
- База данных содержит тестовые данные (темы, теории)

⚠️ **Некоторые тесты могут быть пропущены** если:
- Модалки не открыты (тесты проверяют наличие элементов в DOM)
- Нет данных для отображения (пустые списки)

## Troubleshooting

### Тесты не запускаются
```bash
# Проверьте установку Playwright
npx playwright --version

# Переустановите браузеры
npx playwright install --force
```

### Тайм-ауты
Увеличьте timeout в `playwright.config.js`:
```javascript
timeout: 60000, // 60 секунд
```

### Сервер не отвечает
Проверьте, что сервер запущен:
```bash
curl http://localhost:5000/ui/editor
```

## Дополнительные опции

```bash
# Запуск в определённом браузере
npx playwright test --project=chromium
npx playwright test --project=firefox
npx playwright test --project=webkit

# Параллельный запуск
npx playwright test --workers=4

# Повтор упавших тестов
npx playwright test --retries=2

# Запись видео всех тестов
npx playwright test --video=on
```

## CI/CD Integration

Для GitHub Actions добавьте в `.github/workflows/test.yml`:

```yaml
- name: Install Playwright
  run: |
    npm install -D @playwright/test
    npx playwright install --with-deps

- name: Run Playwright tests
  run: npx playwright test theory-center-fixes.test.mjs
  
- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: playwright-report/
```
