# Клинические демонстрационные задания ACTRA (Стандартные пользовательские ZIP-экспорты)

В этой папке подготовлены демонстрационные клинические задания матричной иерархии в **каноническом формате пользовательского экспорта ACTRA (ZIP-архивы с `manifest.json` и структурой `modules/.../topics/.../tasks/.../task.json`)**, полностью готовые для импорта через встроенную функцию **«Импорт»** в редакторе/дашборде ACTRA на любом сервере (включая **Production**).

---

## 📦 Пакеты пользовательского экспорта (.ZIP)

| Архив | Описание и состав | Размер |
|:---|:---|:---|
| [`tasks_export_clinical_hierarchies.zip`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/tasks_export_clinical_hierarchies.zip) | **Полный бандл (оба задания вместе):**<br>• Таблица 5.1 (ТЭЛА, 4 уровня, 8 карточек)<br>• Таблица 5.2 (Пневмоторакс / ателектаз / выпот, 3 уровня, 9 карточек)<br>• Полный манифест совместимости `manifest.json`. | ~5.3 КБ |
| [`tasks_export_table_5_1_tela_stratification.zip`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/tasks_export_table_5_1_tela_stratification.zip) | **Одиночный экспорт Таблицы 5.1:**<br>«Стратификация риска и реперфузия при ТЭЛА» (ESC 2019 / РКО 2024). | ~2.9 КБ |
| [`tasks_export_table_5_2_pneumothorax_differentiation.zip`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/tasks_export_table_5_2_pneumothorax_differentiation.zip) | **Одиночный экспорт Таблицы 5.2:**<br>«Дифференциация синдрома затенения и просветления гемиторакса». | ~3.0 КБ |

---

## 🛠 Дополнительные исходные файлы (JSON)

| Файл | Описание |
|:---|:---|
| [`table_5_1_tela_stratification.json`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/table_5_1_tela_stratification.json) | Чистый JSON-манифест задания 5.1 (`task_schema_version: "1.2"`, `sequence_assembly`). |
| [`table_5_2_pneumothorax_differentiation.json`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/table_5_2_pneumothorax_differentiation.json) | Чистый JSON-манифест задания 5.2 (`task_schema_version: "1.2"`, `sequence_assembly`). |
| [`clinical_hierarchy_complex.json`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/clinical_hierarchy_complex.json) | Обучающий комплекс для объединения обоих заданий в единый клинический тренажёр. |
| [`pack_export_zips.py`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/pack_export_zips.py) | Скрипт пересборки ZIP-архивов с манифестом экспорта. |
| [`import_clinical_tasks_prod.py`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/import_clinical_tasks_prod.py) | Автономный CLI-скрипт импорта через REST API (альтернативный путь). |

---

## 🚀 Порядок импорта через стандартный интерфейс ACTRA (GUI)

Пользовательский импорт в ACTRA не требует ручного создания системных директорий или знания технического API:

1. **Создайте модуль и тему в вашей библиотеке:**
   - Откройте дашборд редактора (`/editor/Main_Dashboard.html` или раздел «Редактор заданий»).
   - Нажмите **«+ Создать модуль»** и задайте любое желаемое название (например, *«Неотложные состояния»* или используйте существующий модуль вашей кафедры).
   - Внутри модуля нажмите **«+ Создать тему»** (например, *«Дифференциальная диагностика и стратификация риска»*).

2. **Запустите мастер импорта:**
   - В шапке дашборда редактора нажмите кнопку **«Импорт»** (или выберите режим импорта в боковом меню).
   - В открывшемся модальном окне выберите вкладку **«Архив (ZIP)»**.
   - Перетащите в окно загрузки архив [`tasks_export_clinical_hierarchies.zip`](file:///d:/Ai%20Ai/radioproject_git/exports/clinical_tasks/tasks_export_clinical_hierarchies.zip) (или одиночный архив нужного задания).

3. **Валидация и выбор целевого назначения:**
   - Система автоматически выполнит проверку архива через сервис `validate_import_archive`.
   - В списке отобразятся задания со статусом **Valid (Готово к импорту)**.
   - В выпадающих списках **«Целевой модуль»** и **«Целевая тема»** выберите созданные вами в Шаге 1 модуль и тему.
   - При необходимости выберите политику разрешения конфликтов (по умолчанию `Пропускать дубликаты` или `Перезаписывать`).

4. **Завершение:**
   - Нажмите **«Импортировать»** (или *«Подтвердить импорт»*).
   - Задания мгновенно появятся в выбранной теме вашей библиотеки и будут готовы к открытию в редакторе или включению в обучающие комплексы.

---

## 📋 Внутренняя структура экспортированного архива

Архив полностью воспроизводит результат работы функции `POST /api/editor/export/tasks`:

```text
tasks_export_clinical_hierarchies.zip
│
├── manifest.json
│     ├── export_date: "2026-10-23T..."
│     ├── app_version: "1.1.0"
│     ├── export_type: "tasks"
│     ├── total_tasks: 2
│     ├── contains: { modules: [...], topics: [...], tasks: [...] }
│     ├── module_names: { ... }
│     └── topic_names: { ... }
│
└── modules/
    └── neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya/
        └── topics/
            └── differentsialnaya_diagnostika_i_stratifikatsiya_riska/
                └── tasks/
                    ├── task_5_1_tela_stratification/
                    │   └── task.json
                    └── task_5_2_pneumothorax_differentiation/
                        └── task.json
```

При импорте в пользовательскую библиотеку ACTRA берёт данные каждого `task.json` и направляет их в те модуль и тему, которые вы укажете в мастере импорта в веб-интерфейсе.
