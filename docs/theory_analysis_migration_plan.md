# Theory Analysis Migration Plan

## Summary

Цель миграции: вынести analysis-driven workflow из `AI-импорта` в полноценный блок `Анализ теории` на дашборде редактора, при этом сохранить `AI-импорт` как быстрый инструмент прямой генерации конкретного типа задания.

Итоговое разделение должно быть таким:

- `Анализ теории` = стратегический режим.
  От материала к карте покрытия, затем к генерации, импорту и возврату в coverage map.
- `AI-импорт` = тактический режим.
  От выбранного типа задания сразу к prompt-у, parse preview и импорту, без промежуточного анализа.

Главный принцип: analysis session не должна больше жить как подрежим внутри `Импорта заданий`. Она должна стать основным сценарием блока `Анализ теории`, а `AI-импорт` должен работать независимо и проще.

## Current State

Сейчас система уже частично готова к такому переносу:

- в `ImportManager` есть два режима `modalPurpose`:
  - `import`
  - `theory_analysis`
- внутри `theory_analysis` уже живёт значительная часть анализа и связанных сценариев;
- внутри `AI-импорта` всё ещё существует `material_analysis` как шаблон внешнего ИИ;
- analysis session уже влияет на downstream generation prompts;
- после импорта можно возвращаться к coverage map.

Но архитектурно это пока смешано:

- один и тот же modal объединяет:
  - классический импорт файлов,
  - AI-импорт задач,
  - анализ теории,
  - microcards-related theory flows;
- `AI-импорт` всё ещё содержит option `material_analysis`, хотя по смыслу это уже не import-task;
- часть state и UI-текста по-прежнему мыслит analysis как “один из промптов”, а не как отдельный верхнеуровневый workflow.

## Product Decision

Нужно принять и зафиксировать следующее поведение:

### 1. Remove Material Analysis From AI Import

Из блока `Импорт заданий -> AI-импорт` убрать вариант:

- `Анализ материала / Анализ теории / material_analysis`

В `AI-импорте` оставить только прямую генерацию конкретных типов:

- `TEST`
- `OPEN_ANSWER`
- `SEQUENCE`
- `CLICK_TEXT`
- `CLICK_WORDS`

Опционально later:

- `CLICK` / `DRAW` как manual-authoring helper, если появится отдельный visual authoring flow.

### 2. Promote Analysis Session Into Theory Analysis

Весь flow:

`анализ материала -> coverage map -> выбор типа -> generation workspace -> parse/import -> возврат в coverage map`

должен жить в блоке `Анализ теории`.

### 3. Keep Shared Task Generation Engine

Не нужно дублировать prompt builder, parse preview, import execute и batch handling.

Нужно разделить:

- `entrypoints and UX`
- `shared generation/import engine`

То есть UI-сценарии становятся разными, а нижележащая механика генерации и импорта остаётся общей.

## Target UX

### Path A. Theory Analysis

1. Пользователь нажимает `Анализ теории` в sidebar.
2. Открывается theory-analysis workspace.
3. Пользователь вставляет материал или файл.
4. Запускает анализ.
5. Получает coverage map.
6. Выбирает рекомендованный тип.
7. Переходит в generation workspace этого типа.
8. Вставляет ответ внешнего ИИ или использует внутренний запуск.
9. Смотрит parse preview.
10. Импортирует batch.
11. Возвращается обратно в coverage map.
12. Продолжает по следующему типу.

### Path B. AI Import

1. Пользователь нажимает `Импорт заданий`.
2. Выбирает `AI-импорт`.
3. Сразу выбирает конкретный тип задания.
4. Получает prompt для этого типа.
5. Делает parse preview.
6. Импортирует.

В этом пути нет:

- material analysis
- coverage map
- analysis session

## Migration Principles

### Separate Entry Layer From Engine Layer

Нужно перестать воспринимать текущий код как “import modal с кучей режимов” и явно разрезать его на два уровня:

- Entry / navigation layer:
  - где пользователь оказался;
  - какой верхнеуровневый сценарий сейчас запущен;
  - какие кнопки и заголовки видны.
- Shared engine layer:
  - prompt generation;
  - manual analysis parsing;
  - analysis-session state;
  - task parse preview;
  - import execution;
  - post-import bookkeeping.

### Keep Backward-Compatible Routes First

Backend endpoints лучше не ломать на первом этапе.

Пока сохраняем текущие parse/import routes:

- `/api/editor/import/parse-analysis`
- existing task parse routes
- existing import execute routes

На frontend сначала меняем entrypoint и orchestration.

### Migrate By Subtraction, Not Rewrite

Нужно не переписывать всё заново, а:

- вынести existing `material_analysis` flow из AI-import menu;
- подключить тот же flow к `theory_analysis`;
- затем упростить import UI.

## Architecture Target

## 1. Theory Analysis Workspace

В `ImportManager` или в выделенном controller должен существовать отдельный верхнеуровневый workspace:

- `theory_analysis`

У него должны быть собственные подэкраны:

- `composer`
- `coverage_map`
- `task_generation`
- `task_preview`
- `microcards`
- `manual_editor`

Ключевая мысль: `coverage_map` и `task_generation` становятся first-class screens блока теории, а не побочным результатом AI-import prompt.

## 2. Direct AI Import Workspace

Для прямой генерации заданий нужен отдельный, более простой workspace:

- `import_ai_direct`

Он использует shared task-generation UI, но без:

- analysis report
- recommendation map
- session coverage tracking

## 3. Shared Generation Module

Нужно концептуально выделить общий модуль/слой:

- prompt selection
- prompt rendering
- sourceText handling
- parse response handling
- preview rendering
- import execution
- draft persistence

Этот слой должен уметь работать в двух контекстах:

- `direct_import`
- `analysis_session`

## File-Level Migration Plan

## Frontend

### [frontend/Editor/Main_Dashboard.html](/D:/Ai%20Ai/radioproject_git/frontend/Editor/Main_Dashboard.html)

Что менять:

- сохранить отдельную кнопку `Анализ теории`;
- сохранить отдельную кнопку `Импорт заданий`;
- не менять sidebar IA концептуально;
- при необходимости обновить tooltip/label, чтобы было ясно:
  - `Анализ теории` = анализ материала и построение набора заданий;
  - `Импорт заданий` = быстрый импорт уже готовых задач или прямой AI-import по конкретному типу.

### [frontend/Editor/dashboard.js](/D:/Ai%20Ai/radioproject_git/frontend/Editor/dashboard.js)

Что менять:

- оставить `showTheoryAnalysisModal()` как основной entrypoint theory-analysis workflow;
- оставить `showImportModal()` как entrypoint direct import workflow;
- убедиться, что `closeImportModal()` корректно работает для обоих сценариев;
- обновить close-confirm copy:
  - для theory-analysis предупреждать о сбросе analysis session;
  - для import предупреждать о сбросе import drafts;
- при необходимости выделить отдельные helper methods:
  - `openTheoryWorkspace()`
  - `openDirectImportWorkspace()`

### [frontend/Editor/import_manager.js](/D:/Ai%20Ai/radioproject_git/frontend/Editor/import_manager.js)

Это главный файл миграции.

Нужно сделать четыре крупных шага.

#### Step 1. Remove `material_analysis` from direct AI-import templates

Что менять:

- в `getAIAgentTemplateOptions()` убрать `material_analysis` из набора direct AI templates;
- убедиться, что direct-import step 2 больше не умеет переключаться на `material_analysis`;
- обновить `renderStep1AI`, `renderStep2`, `updateNavigationButtons`, `handleNextStep` и related logic так, чтобы в import mode были только task-type templates.

Результат:

- `AI-импорт` перестаёт быть входом в analysis workflow.

#### Step 2. Make theory-analysis use the same generation workspace intentionally

Что менять:

- `openTheoryAnalysisMode()` должен открывать theory workspace как основной сценарий;
- coverage map в theory mode должен иметь действие:
  - `Сгенерировать этот тип`
- это действие должно вести не в import-step illusion, а в явный theory submode `task_generation`.

Нужен явный state:

- `theorySubMode = 'analysis' | 'coverage_map' | 'task_generation' | 'task_preview' | ...`

Результат:

- внутри `Анализа теории` generation workspace становится естественным следующим экраном.

#### Step 3. Extract shared task-generation rendering/helpers

Сейчас часть generation UI завязана на import steps.

Нужно выделить общие куски:

- prompt textarea rendering;
- prompt context card;
- parse textarea;
- parse status UI;
- preview UI;
- import action UI.

Желательно оформить это как набор методов с нейтральными именами:

- `renderTaskGenerationWorkspace(context)`
- `renderTaskPreviewWorkspace(context)`
- `getTaskGenerationTemplateConfig(taskType, contextMode)`

Результат:

- one rendering engine works for both theory-analysis and direct-import.

#### Step 4. Re-scope local session/draft state

Нужно явно разделить:

- `manualAnalysisSession`
- `directImportDraft`
- `taskGenerationDraftByType`

Сейчас state partly mixed around:

- `aiTemplateType`
- `sourceText`
- `parsedResult`
- `generationResult`
- `manualAnalysisResult`

Нужно сделать понятнее, что именно относится к theory-analysis flow, а что к direct import.

Результат:

- меньше скрытых side effects;
- проще закрывать модалку и очищать только нужный state.

## Backend

### [desktop-app/routes/import_routes.py](/D:/Ai%20Ai/radioproject_git/desktop-app/routes/import_routes.py)

На первом этапе:

- endpoints не ломать;
- manual analysis parse оставить как есть;
- task parse/import endpoints оставить как есть.

На втором этапе можно подумать о semantic rename, но это не blocker.

### [desktop-app/services/ai_generation_service.py](/D:/Ai%20Ai/radioproject_git/desktop-app/services/ai_generation_service.py)

Что важно:

- prompt builder уже умеет встраивать analysis-session context;
- это надо сохранить;
- generation builder должен уметь явно отличать:
  - direct generation
  - theory-analysis-driven generation

Нужно проверить, чтобы:

- analysis context не ожидался в direct import;
- analysis context был обязательным в theory task-generation mode.

## State Model

Нужно сохранить текущий `analysis session`, но переосмыслить его место.

### Theory Analysis State

Минимально:

```json
{
  "analysis_session_id": "uuid",
  "module_id": "string",
  "topic_id": "string",
  "analysis": {},
  "coverage": {},
  "recommendation_states": [],
  "drafts_by_type": {},
  "generated_batches": []
}
```

### Direct Import State

Отдельно:

```json
{
  "selected_task_type": "TEST",
  "source_text": "",
  "parsed_result": null,
  "preview_state": {},
  "conflicts": {}
}
```

Важно: direct-import state не должен случайно наследовать analysis-session state.

## Draft and Close Behavior

Новая миграция не должна сломать уже продуманный close UX.

Нужно сохранить:

- если пользователь уже импортировал batch, imported tasks остаются в каталоге;
- если он закрывает theory-analysis modal, локальная session/drafts могут сброситься после confirm;
- если ничего не импортировано и есть только мусорный local draft, он должен очищаться;
- warning copy должен зависеть от workspace:
  - `Анализ теории`: сбросится analysis session и локальные черновики;
  - `Импорт заданий`: сбросятся import drafts и preview.

## Migration Phases

## Phase 1. Entry Separation

Цель:

- убрать `material_analysis` из AI-import options;
- перевести theory-analysis на роль единственного entrypoint для анализа материала.

Изменения:

- frontend only;
- minimal behavior changes;
- no route changes.

Definition of done:

- в `Импорте заданий` нельзя выбрать анализ материала;
- в `Анализе теории` можно пройти analysis -> coverage map.

## Phase 2. Shared Generation Workspace

Цель:

- внутри `Анализа теории` можно полноценно генерировать, парсить, preview-ить и импортировать batch по выбранному типу.

Изменения:

- refactor `import_manager.js`;
- выделение shared generation renderer/helpers.

Definition of done:

- theory-analysis workflow больше не зависит от import steps UX.

## Phase 3. Coverage-First Loop Completion

Цель:

- после импорта batch пользователь гарантированно возвращается в coverage map;
- тип получает статус;
- coverage обновляется;
- можно переходить к следующему типу.

Definition of done:

- complete closed loop for theory-analysis session.

## Phase 4. Cleanup and Naming

Цель:

- удалить старые ветки логики, где analysis masquerades as import template;
- упростить import-mode code;
- выровнять тексты UI.

Definition of done:

- код больше не держит legacy `material_analysis` inside direct import path;
- структура сценариев понятна по коду.

## Risks

### 1. Over-coupled ImportManager

`ImportManager` уже очень большой и обслуживает несколько разных сценариев.

Риск:

- миграция через локальные if/else ещё сильнее усложнит файл.

Смягчение:

- по возможности не добавлять ещё один слой условий;
- выносить shared rendering/helpers в отдельные методы;
- если потребуется, later split by domain:
  - `theory_analysis_controller`
  - `direct_import_controller`
  - `task_generation_workspace`

### 2. State Leakage Between Modes

Риск:

- `sourceText`, `parsedResult`, `aiTemplateType`, `manualAnalysisResult` и drafts будут перетекать между theory-analysis и direct import.

Смягчение:

- ввести явные reset points;
- нормализовать state ownership;
- покрыть regression tests/manual test checklist.

### 3. UX Regression Around Close/Back Navigation

Риск:

- пользователь потеряет draft или окажется не на том экране после импорта.

Смягчение:

- сохранить existing close-confirm logic;
- отдельно проверить:
  - close from coverage map
  - close from task generation
  - close from preview
  - close after import

## Manual Test Checklist

- `Анализ теории` открывается отдельно от `Импорта заданий`.
- В `AI-импорте` больше нет `Анализа материала`.
- В `Анализе теории` можно:
  - вставить материал;
  - разобрать анализ;
  - увидеть coverage map;
  - выбрать тип;
  - перейти к generation workspace;
  - вставить ответ ИИ;
  - сделать preview;
  - импортировать;
  - вернуться в coverage map.
- После импорта:
  - задачи реально сохранены;
  - status типа обновлён;
  - draft очищен или помечен корректно.
- При закрытии:
  - появляется корректное предупреждение;
  - imported tasks не теряются;
  - local garbage state очищается.

## Recommended Implementation Order

1. Phase 1: убрать `material_analysis` из direct AI-import и закрепить theory-analysis как единственный analysis entrypoint.
2. Phase 2: выделить shared task-generation workspace внутри `ImportManager`.
3. Phase 3: завершить coverage-first loop и статусы after import.
4. Phase 4: зачистить legacy-ветки и тексты UI.

## Deliverable

После миграции пользователь должен воспринимать систему так:

- `Анализ теории` помогает построить и поэтапно реализовать полный набор заданий по материалу.
- `Импорт заданий` помогает быстро импортировать уже подготовленный batch или сгенерировать один конкретный тип без стратегического анализа.

Именно это разделение нужно считать целевым продуктовым состоянием.
