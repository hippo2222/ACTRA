import fs from "fs";
import path from "path";

import { JSDOM } from "jsdom";
import { vi } from "vitest";

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function extractBetween(source, startMarker, endMarker) {
    const startIndex = source.indexOf(startMarker);
    if (startIndex === -1) {
        return "";
    }
    const endIndex = endMarker ? source.indexOf(endMarker, startIndex) : -1;
    if (endIndex === -1) {
        return source.slice(startIndex);
    }
    return source.slice(startIndex, endIndex);
}

function findLineNumber(source, marker) {
    const index = source.indexOf(marker);
    if (index === -1) {
        return 1;
    }
    return source.slice(0, index).split(/\r?\n/).length;
}

function findForbiddenKeyPaths(value, forbiddenKeys, currentPath = "") {
    if (!value || typeof value !== "object") {
        return [];
    }

    const paths = [];
    for (const [key, nestedValue] of Object.entries(value)) {
        const nextPath = currentPath ? `${currentPath}.${key}` : key;
        if (forbiddenKeys.includes(key)) {
            paths.push(nextPath);
        }
        paths.push(...findForbiddenKeyPaths(nestedValue, forbiddenKeys, nextPath));
    }
    return paths;
}

function defineGlobal(name, value) {
    Object.defineProperty(global, name, {
        value,
        configurable: true,
        writable: true,
    });
}

function bindDomGlobals(dom) {
    defineGlobal("window", dom.window);
    defineGlobal("document", dom.window.document);
    defineGlobal("HTMLElement", dom.window.HTMLElement);
    defineGlobal("Node", dom.window.Node);
    defineGlobal("CustomEvent", dom.window.CustomEvent);
    defineGlobal("FormData", dom.window.FormData);
    defineGlobal("File", dom.window.File);
    defineGlobal("Blob", dom.window.Blob);
    defineGlobal("navigator", dom.window.navigator);
    defineGlobal("URL", dom.window.URL);
}

function setupDom() {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        resources: "usable",
    });

    bindDomGlobals(dom);

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.console.error = vi.fn();
    dom.window.NotificationUI = {
        confirm: vi.fn().mockResolvedValue(true),
    };
    dom.window.__TEST_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
    dom.window.cancelAnimationFrame = dom.window.cancelAnimationFrame || ((id) => clearTimeout(id));
    dom.window.navigateWithTransition = vi.fn();

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/test_editor.js") + "\n;window.TestEditor = TestEditor;");

    return dom;
}

function createEditorInstance(dom) {
    const editorClass = dom.window.TestEditor;
    if (!editorClass) {
        throw new Error("TestEditor is not available");
    }
    const initSpy = vi.spyOn(editorClass.prototype, "init").mockResolvedValue(undefined);
    const instance = new editorClass();
    initSpy.mockRestore();
    return instance;
}

function mountTestShell() {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="loading-overlay" class="hidden"></div>
        <div id="loading-text"></div>
        <header>
            <button id="back-btn"></button>
            <div id="save-status-container">
                <div id="save-status-indicator"></div>
                <span id="save-status-text"></span>
                <span id="save-status-detail"></span>
            </div>
            <button id="undo-btn"></button>
            <button id="redo-btn"></button>
            <button id="clear-test-btn"></button>
            <button id="delete-test-btn"></button>
            <button id="save-task-btn"></button>
        </header>
        <aside>
            <div id="question-list"></div>
            <button id="add-question-btn"></button>
            <button id="import-btn"></button>
            <button id="export-btn"></button>
            <input id="import-input" type="file" />
        </aside>
        <main>
            <textarea id="question-textarea"></textarea>
            <button id="upload-image-btn"></button>
            <div id="question-image-thumb" class="hidden">
                <img id="question-image" />
                <button id="remove-question-image-btn" type="button"></button>
            </div>
            <input id="image-upload-input" type="file" />
            <div id="options-container"></div>
            <button id="add-option-btn"></button>
            <input id="option-image-input" type="file" />
        </main>
        <aside>
            <span id="answer-type-display"></span>
            <textarea id="explanation-textarea"></textarea>
        </aside>
        <div id="import-modal" class="hidden"></div>
        <div id="import-file-name"></div>
        <div id="import-question-count"></div>
        <div id="import-warning" class="hidden"></div>
        <div id="import-parser-status"></div>
        <div id="import-question-preview"></div>
        <div id="import-error" class="hidden"></div>
        <div id="import-mode-hint"></div>
        <button id="choose-import-file-btn"></button>
        <label class="import-mode-option" data-active="true">
            <input type="radio" name="import-mode" value="replace" checked />
        </label>
        <label class="import-mode-option" data-active="false">
            <input type="radio" name="import-mode" value="append" />
        </label>
        <button id="import-modal-close"></button>
        <button id="cancel-import-btn"></button>
        <button id="confirm-import-btn"></button>
    `;
}

function createBaseTask() {
    return {
        task_data: {
            type: "test",
            meta: {
                module: "module_01",
                topic: "topic_01",
                id: "task_test_001",
                name: "Test task",
            },
            content: {
                test_type: "multiple_choice",
                settings: {
                    shuffle_questions: true,
                    shuffle_answers: true,
                    time_limit: null,
                    passing_score: 70,
                },
                questions: [],
            },
            settings: {},
        },
        metadata: {
            id: "task_test_001",
            module: "module_01",
            topic: "topic_01",
            name: "Test task",
        },
    };
}

function createEditorQuestion(overrides = {}) {
    return {
        id: 1,
        text: "Что изображено на снимке?",
        options: [
            { text: "Пневмония", is_correct: true, image_path: null },
            { text: "Норма", is_correct: false, image_path: null },
        ],
        settings: { all_correct_required: true, allow_partial_credit: false },
        explanation: "Верный ответ объясняется клинической картиной.",
        image: null,
        images: [],
        ...overrides,
    };
}

export function createTestEditorAuditAdapter() {
    const dom = setupDom();
    const baseEditorSource = loadScript("frontend/Editor/base_editor.js");
    const htmlSource = loadScript("frontend/Editor/Test Task Editor Multiple Choice.html");
    const jsSource = loadScript("frontend/Editor/test_editor.js");

    return {
        teardown() {
            dom.window.close();
        },

        describeSurfaceAudit() {
            return {
                capabilities: [
                    { id: "question_list", kind: "secondary_panel", description: "Список вопросов теста" },
                    { id: "question_text", kind: "primary_field", description: "Текст текущего вопроса" },
                    { id: "question_image", kind: "asset", description: "Изображение вопроса" },
                    { id: "options", kind: "primary_field", description: "Варианты ответа и правильность" },
                    { id: "option_images", kind: "asset", description: "Изображения вариантов ответа" },
                    { id: "import_modal", kind: "service_flow", description: "Импорт вопросов из файла" },
                    { id: "export", kind: "service_flow", description: "Экспорт теста в файл" },
                    { id: "clear_test", kind: "destructive_action", description: "Очистка всего теста" },
                ],
                riskClasses: [
                    "copy_language_defect",
                    "false_affordance",
                    "archived_logic_leakage",
                    "persistence_divergence",
                    "unprotected_destructive_flow",
                ],
                heuristics: [
                    "copy_lint",
                    "surface_drift_audit",
                    "dirty_state_audit",
                    "affordance_audit",
                    "archived_logic_audit",
                ],
                scenarios: {
                    happy: [
                        "Создать вопрос, заполнить два варианта и сохранить тест",
                    ],
                    rich: [
                        "Добавить изображение к вопросу, изображение к варианту, explanation и второй вопрос",
                    ],
                    recovery: [
                        "Изменить текст вопроса, варианты и explanation, затем восстановить локальный draft",
                    ],
                    error: [
                        "Попытаться сохранить вопрос без текста, без двух вариантов или без правильного ответа",
                    ],
                    destructive: [
                        "Удалить вариант ответа и восстановить состояние редактора",
                        "Очистить весь тест через confirm flow",
                    ],
                },
            };
        },

        createCopyLintContext() {
            return {
                sources: [
                    { label: "html", text: htmlSource },
                    { label: "js", text: jsSource },
                ],
                forbiddenPatterns: [
                    /Import from JSON/i,
                    /Export to JSON/i,
                    /Clear test\?/i,
                    /All questions will be removed\./i,
                    /Delete task\?/i,
                    /This action cannot be undone\./i,
                    /Deleting task\.\.\./i,
                    /Task deleted/i,
                    /Delete failed/i,
                ],
            };
        },

        createArchivedLogicAuditContext() {
            return {
                methodSources: [
                    {
                        name: "clearTest",
                        source: extractBetween(jsSource, "async clearTest()", "async deleteTest()"),
                        startLine: findLineNumber(jsSource, "async clearTest()"),
                    },
                    {
                        name: "deleteTest",
                        source: extractBetween(jsSource, "async deleteTest()", "showToast(message, variant = 'info')"),
                        startLine: findLineNumber(jsSource, "async deleteTest()"),
                    },
                ],
                suspiciousTailPatterns: [
                    /Р[^\s]{2,}/,
                    /confirm\(/,
                    /РћС/,
                    /withLoading\(/,
                ],
            };
        },

        createSurfaceDriftAuditContext() {
            return {
                htmlSource,
                jsSource,
                focusSelectors: [
                    "question-textarea",
                    "add-question-btn",
                    "save-task-btn",
                    "confirm-import-btn",
                ],
            };
        },

        createDirtyStateAuditContext() {
            return {
                cases: [
                    {
                        id: "draft_excludes_transient_import_state",
                        run() {
                            vi.restoreAllMocks();
                            bindDomGlobals(dom);
                            mountTestShell();

                            const editor = createEditorInstance(dom);
                            editor.task = createBaseTask();
                            editor.questions = [createEditorQuestion()];
                            editor.pendingImportData = [{ text: "temp import" }];
                            editor.pendingImportFile = { name: "sample.json" };
                            editor.pendingImportErrors = ["parse error"];
                            editor.importMode = "append";
                            editor.loadingCounter = 2;

                            const state = editor.captureState();
                            const leakedPaths = findForbiddenKeyPaths(state, [
                                "pendingImportData",
                                "pendingImportFile",
                                "pendingImportErrors",
                                "importMode",
                                "loadingCounter",
                            ]);

                            if (!leakedPaths.length) {
                                return null;
                            }

                            return {
                                type: "transient_state_leaked_into_draft",
                                leakedPaths,
                            };
                        },
                    },
                    {
                        id: "hide_import_modal_clears_pending_state",
                        run() {
                            vi.restoreAllMocks();
                            bindDomGlobals(dom);
                            mountTestShell();

                            const editor = createEditorInstance(dom);
                            editor.pendingImportData = [{ text: "temp import" }];
                            editor.pendingImportFile = { name: "sample.json" };
                            editor.pendingImportErrors = ["parse error"];
                            editor.showImportModal(true);
                            editor.hideImportModal(true);

                            const modal = document.querySelector("#import-modal");
                            const modalVisible = modal ? !modal.classList.contains("hidden") : false;
                            const pendingErrors = Array.isArray(editor.pendingImportErrors)
                                ? editor.pendingImportErrors.length
                                : -1;

                            if (
                                !modalVisible &&
                                editor.pendingImportData === null &&
                                editor.pendingImportFile === null &&
                                pendingErrors === 0
                            ) {
                                return null;
                            }

                            return {
                                type: "stale_import_state_persists_after_close",
                                modalVisible,
                                pendingImportData: editor.pendingImportData,
                                pendingImportFile: editor.pendingImportFile,
                                pendingErrors,
                            };
                        },
                    },
                ],
            };
        },

        createAffordanceAuditContext() {
            return {
                htmlSource,
                jsSources: [baseEditorSource, jsSource],
            };
        },

        createDraftRoundtripContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountTestShell();

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.questions = [
                createEditorQuestion({
                    text: "Как называется это исследование?",
                    options: [
                        { text: "КТ", is_correct: true, image_path: "modules/m/topics/t/tasks/test/images/ct.png" },
                        { text: "МРТ", is_correct: false, image_path: null },
                    ],
                    explanation: "Подсказка для преподавателя",
                    image: "modules/m/topics/t/tasks/test/images/question.png",
                }),
            ];
            editor.currentQuestionIndex = 0;
            editor.task.task_data.content.settings = {
                shuffle_questions: false,
                shuffle_answers: true,
                time_limit: 30,
                passing_score: 80,
            };

            return {
                editor,
                expected: {
                    questionText: "Как называется это исследование?",
                    firstAnswerText: "КТ",
                    firstAnswerCorrect: true,
                    explanation: "Подсказка для преподавателя",
                    questionImage: "modules/m/topics/t/tasks/test/images/question.png",
                    passingScore: 80,
                    currentQuestionIndex: 0,
                },
                readDraft(state) {
                    return {
                        questionText: state.questions[0].text,
                        firstAnswerText: state.questions[0].answers[0].text,
                        firstAnswerCorrect: state.questions[0].answers[0].correct,
                        explanation: state.questions[0].explanation,
                        questionImage: state.questions[0].image_path,
                        passingScore: state.settings.passing_score,
                        currentQuestionIndex: state.currentQuestionIndex,
                    };
                },
            };
        },

        createCanonicalHydrationContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountTestShell();

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.task.task_data.content.questions = [
                {
                    id: 1,
                    text: "Какое исследование показано на снимке?",
                    answers: [
                        { text: "Рентгенография", correct: true, image_path: null },
                        { text: "УЗИ", correct: false, image_path: null },
                    ],
                    explanation: "Нужен рентген-контекст.",
                },
            ];

            return {
                editor,
                hydrate() {
                    editor.onTaskLoaded();
                },
                expected: {
                    questionText: "Какое исследование показано на снимке?",
                    answerType: "Одиночный выбор",
                    explanation: "Нужен рентген-контекст.",
                    optionCount: 2,
                },
                readUi() {
                    return {
                        questionText: document.querySelector("#question-textarea").value,
                        answerType: document.querySelector("#answer-type-display").textContent,
                        explanation: document.querySelector("#explanation-textarea").value,
                        optionCount: document.querySelectorAll("#options-container .option-row").length,
                    };
                },
            };
        },

        createUndoableDestructiveContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountTestShell();

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.questions = [
                createEditorQuestion({
                    options: [
                        { text: "А", is_correct: true, image_path: null },
                        { text: "Б", is_correct: false, image_path: null },
                        { text: "В", is_correct: false, image_path: null },
                    ],
                }),
            ];
            editor.currentQuestionIndex = 0;
            editor.renderUI();
            const snapshot = editor.captureState();

            return {
                editor,
                act() {
                    document.querySelector("#options-container .delete-option")?.click();
                },
                undo() {
                    editor.restoreState(snapshot);
                },
                read(instance) {
                    return {
                        optionCount: instance.questions[instance.currentQuestionIndex].options.length,
                    };
                },
                expectedAfterAction: {
                    optionCount: 2,
                },
                expectedAfterUndo: {
                    optionCount: 3,
                },
            };
        },
    };
}
