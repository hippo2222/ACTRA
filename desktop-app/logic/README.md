# Logic Layer - Управление бизнес-логикой и рабочими процессами

**НЕДЕЛЯ 2: SERVICES И LOGIC LAYERS**  
**Дни 6-7:** Logic Layer

---

## 📋 Статус выполнения

### ✅ Завершённые блоки

#### **Блок A: Task Controller** (День 6, 3 часа)
- ✅ `task_controller.py` (~420 строк)
- ✅ Тесты: 29/29 ✅
- ✅ Документация: `BLOCK_A_SUMMARY.md`

#### **Блок B: Session Manager** (День 6, 3 часа)
- ✅ `session_manager.py` (~430 строк)
- ✅ Тесты: 39/39 ✅
- ✅ Документация: `BLOCK_B_SUMMARY.md`

#### **Блок C: Module Repository** (День 7, 2 часа)
- ✅ `module_repository.py` (~360 строк)
- ✅ Тесты: 33/33 ✅
- ✅ Интеграция с StorageService

---

## 🎯 Назначение Layer

**Logic Layer** — слой управления бизнес-логикой, который координирует работу между **Services** (обработка данных) и **UI** (отображение).

### Принципы:
1. **Координация** — управляет взаимодействием между сервисами
2. **Workflow** — реализует бизнес-процессы (жизненный цикл заданий, навигация)
3. **No UI Dependencies** — не зависит от Tkinter или UI компонентов
4. **Self-Contained** — может работать независимо для тестирования

---

## 🗂️ Структура

```
logic/
├── __init__.py                    # Экспорты компонентов логики
├── task_controller.py             # ✅ Управление жизненным циклом задания
├── session_manager.py             # ✅ Управление сессией и навигацией
├── module_repository.py           # ✅ Фасад для доступа к модулям/темам/заданиям
├── BLOCK_A_SUMMARY.md             # ✅ Документация Task Controller
└── BLOCK_B_SUMMARY.md             # ✅ Документация Session Manager
```

---

## 📦 Блок A: Task Controller

**Файл:** `task_controller.py` (~420 строк)

### Функциональность:
- ✅ Управление жизненным циклом задания
- ✅ Загрузка заданий (load_task)
- ✅ Отправка ответов (submit_answer)
- ✅ Управление состоянием (skip_task, reset_task, clear_task)
- ✅ Интеграция с TaskEvaluatorService и ProgressService
- ✅ TaskState enum (NOT_STARTED, IN_PROGRESS, COMPLETED, FAILED, SKIPPED)
- ✅ Task dataclass (module_id, topic_id, task_id, task_type, task_data, answer_key)

### Тесты: **29/29 проходят** ✅

---

## 📦 Блок B: Session Manager

**Файл:** `session_manager.py` (~430 строк)

### Функциональность:
- ✅ Управление сессией (start_session, end_session, is_session_active)
- ✅ Навигация между заданиями (next_task, previous_task)
- ✅ Проверки навигации (can_go_next, can_go_previous)
- ✅ Прогресс в теме (get_progress_in_topic, is_first_task, is_last_task)
- ✅ Длительность сессии (get_session_duration)
- ✅ Прямая навигация (jump_to_task, get_task_by_id)
- ✅ Информация о сессии (get_session_summary)

### Тесты: **39/39 проходят** ✅

---

## 📦 Блок C: Module Repository

**Файл:** `module_repository.py` (~360 строк)

### Функциональность:
- ✅ Фасад для доступа к модулям/темам/заданиям
- ✅ Получение модулей (get_all_modules, get_module, module_exists)
- ✅ Получение тем (get_topics_for_module, get_topic, topic_exists)
- ✅ Получение заданий (get_tasks_for_topic, get_task, task_exists)
- ✅ Поиск заданий (search_tasks)
- ✅ Статистика (get_repository_stats, get_task_count_for_topic)
- ✅ Кэширование модулей
- ✅ Интеграция с StorageService

### Тесты: **33/33 проходят** ✅

**Покрытие:**
- Инициализация (2 теста)
- Получение модулей (6 тестов)
- Получение тем (7 тестов)
- Получение заданий (8 тестов)
- Поиск (4 теста)
- Статистика (4 теста)
- Утилиты (2 теста)

---

## 🎯 Общая статистика Logic Layer

| Блок | Строк кода | Тесты | Статус |
|------|------------|-------|--------|
| **A: Task Controller** | ~420 | 29/29 ✅ | Завершён |
| **B: Session Manager** | ~430 | 39/39 ✅ | Завершён |
| **C: Module Repository** | ~360 | 33/33 ✅ | Завершён |
| **ИТОГО** | **~1210** | **101/101 ✅** | **100%** |

**Покрытие:**
- Инициализация (2 теста)
- Загрузка заданий (4 теста)
- Task dataclass (3 теста)
- Отправка ответов (6 тестов)
- Пропуск задания (3 теста)
- Сброс задания (4 теста)
- Очистка задания (2 теста)
- Геттеры и утилиты (5 тестов)

### Пример использования:

#### Через DI-контейнер (рекомендуется):
```python
from core.container import Container
from logic.task_controller import TaskController, TaskState
from services.task_evaluator_service import TaskEvaluatorService
from services.progress_service import ProgressService

# В TrainerApp
container = Container()

# Регистрация сервисов
container.register(TaskEvaluatorService, TaskEvaluatorService, lifetime='singleton')
container.register(ProgressService, factory=lambda: ProgressService(data_dir="./data"), lifetime='singleton')

# Разрешение зависимостей
evaluator = container.resolve(TaskEvaluatorService)
progress = container.resolve(ProgressService)

# Создание TaskController с зависимостями из контейнера
controller = TaskController(evaluator, progress)
```

#### Прямое использование (для тестов):
```python
from logic.task_controller import TaskController, TaskState
from services.task_evaluator_service import TaskEvaluatorService
from services.progress_service import ProgressService

# Инициализация
evaluator = TaskEvaluatorService()
progress = ProgressService(data_dir="./data")
controller = TaskController(evaluator, progress)

# Загрузка задания
task = controller.load_task(
    module_id="anatomy",
    topic_id="liver",
    task_id="liver_click_01",
    task_data={'type': 'click', 'description': '...'},
    answer_key={'targets': [...]}
)

print(task.full_id)  # "anatomy/liver/liver_click_01"
print(controller.task_state)  # TaskState.IN_PROGRESS

# Отправка ответа
result = controller.submit_answer({
    'x': 100, 'y': 100,
    'scale_factor': 1.0,
    'offset_x': 0, 'offset_y': 0
})

print(result.success)  # True
print(result.success)    # True/False
print(controller.task_state)  # TaskState.COMPLETED

# Управление
controller.skip_task()   # Пропустить задание
controller.reset_task()  # Сбросить в начальное состояние
controller.clear_task()  # Очистить для нового задания
```

---

## 🔗 Интеграция с другими слоями

### **Services Layer** (Блоки A, B, C)
```python
# TaskController использует сервисы:
from services.task_evaluator_service import TaskEvaluatorService  # Оценка
from services.progress_service import ProgressService              # Сохранение
from services.image_service import ImageService                    # Изображения (опционально)
```

### **UI Layer** (НЕДЕЛЯ 3)
```python
# UI использует TaskController через TrainerApp:
# Сервисы доступны через self.app.* (TrainerApp создаёт их через контейнер)

class TaskScreen(BaseScreen):
    def __init__(self, parent, app, **kwargs):
        super().__init__(parent, app, **kwargs)
        # app содержит task_controller, созданный через DI-контейнер
    
    def on_submit(self):
        user_input = self.get_user_input()
        result = self.app.task_controller.submit_answer(user_input)
        self.display_result(result)
```

### **Dependency Injection через контейнер**

Все компоненты Logic Layer получают зависимости через DI-контейнер:

```python
# В TrainerApp._init_logic()
storage = container.resolve(StorageService)
evaluator = container.resolve(TaskEvaluatorService)
progress = container.resolve(ProgressService)

# Создание Logic компонентов с зависимостями из контейнера
module_repository = ModuleRepository(storage)
task_controller = TaskController(evaluator, progress)
session_manager = SessionManager()  # Без зависимостей
```

**Преимущества:**
- Упрощение тестирования - легко подставлять моки
- Снижение связанности - зависимости конфигурируются в одном месте
- Гибкость замены - можно менять реализации без изменения кода

---

## 🎯 Переходы состояний

```
NOT_STARTED
    ↓ load_task()
IN_PROGRESS
    ↓ submit_answer(success=True)
COMPLETED

IN_PROGRESS
    ↓ submit_answer(success=False)
FAILED

IN_PROGRESS
    ↓ skip_task()
SKIPPED

COMPLETED / FAILED
    ↓ reset_task()
IN_PROGRESS

ANY_STATE
    ↓ clear_task()
NOT_STARTED
```

---

## 📊 Ключевые решения

### 1. **Разделение ответственности**
- `TaskController` — **координатор** (не содержит бизнес-логику оценки)
- `TaskEvaluatorService` — **оценка** (бизнес-логика)
- `ProgressService` — **сохранение** (персистентность)

### 2. **Immutable Task**
- `Task` создаётся при `load_task()` и не изменяется
- Только `user_input` обновляется при `submit_answer()`

### 3. **Explicit State Transitions**
- Каждый метод явно меняет состояние
- Состояние всегда консистентно

### 4. **Fail-Fast подход**
- Методы бросают `RuntimeError` если задание не загружено
- Предотвращает неконсистентное состояние

---

## 🔲 Следующие блоки

### **Блок B: Navigation Controller** (TODO)
- Управление навигацией между заданиями
- Логика "следующее/предыдущее" задание
- Интеграция с TaskController
- Навигация по модулям/темам

### **Блок C: Module Repository** (TODO)
- Загрузка модулей из файловой системы
- Парсинг JSON файлов модулей/тем/заданий
- Кэширование загруженных данных
- Валидация структуры данных

---

## 📝 Документация

- **`BLOCK_A_SUMMARY.md`** — детальное описание TaskController
- **`README.md`** — общая информация о Logic Layer (этот файл)

---

**Создано в рамках:**  
**Phase 6 - Architecture Refactor**  
См.: `PHASE_6_ARCHITECTURE.md` → НЕДЕЛЯ 2: Logic Layer
