import fs from "fs";
import path from "path";

import { JSDOM } from "jsdom";
import { vi } from "vitest";

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
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
    dom.window.__OPEN_ANSWER_EDITOR_AUTO_INIT_DISABLED__ = true;

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/open_answer_editor.js") + "\n;window.OpenAnswerEditor = OpenAnswerEditor;");

    return dom;
}

function dispatchDomReady(dom) {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
}

function createEditorInstance(dom) {
    const editorClass = dom.window.OpenAnswerEditor;
    if (!editorClass) {
        throw new Error("OpenAnswerEditor is not available");
    }
    const initSpy = vi.spyOn(editorClass.prototype, "init").mockImplementation(() => {});
    const instance = new editorClass();
    initSpy.mockRestore();
    return instance;
}

function mountOpenAnswerShell() {
    document.body.innerHTML = `
        <header>
            <button id="back-to-dashboard-btn"></button>
            <h2 id="editor-title"></h2>
            <button id="save-task-btn"></button>
        </header>
        <button id="split-keywords-btn"></button>
        <div id="keywords-section">
            <div id="keywords-container"></div>
            <span id="selected-count-badge"></span>
        </div>
        <textarea id="question-textarea"></textarea>
        <textarea id="reference-textarea"></textarea>
        <textarea id="hint-textarea"></textarea>
        <input id="max-length-input" type="number" />
        <input id="sequence-order-check" type="checkbox" />
        <div id="images-container">
            <button id="add-image-btn"><span class="add-image-label">Добавить изображение</span></button>
        </div>
        <input id="image-upload-input" type="file" multiple />
        <div id="image-preview-overlay" class="hidden"></div>
        <img id="image-preview-img" />
        <button id="image-preview-close" type="button"></button>
    `;
}

function createBaseTask() {
    return {
        task_data: {
            meta: { module: "module_01", topic: "topic_01", id: "task_001", name: "OA task" },
            content: {
                question: "",
                prompt: "",
                reference_answer: "",
                hint: "",
                max_length: 500,
                sequence_matters: false,
                keywords: [],
                images: [],
            },
        },
        metadata: { id: "task_001", module: "module_01", topic: "topic_01", name: "OA task" },
    };
}

export function createOpenAnswerEditorAuditAdapter() {
    const dom = setupDom();

    return {
        teardown() {
            dom.window.close();
        },

        describeSurfaceAudit() {
            return {
                capabilities: [
                    { id: "question", kind: "primary_field", description: "Основной вопрос или кейс" },
                    { id: "reference_answer", kind: "primary_field", description: "Эталонный ответ" },
                    { id: "keyword_split", kind: "assist_action", description: "Авторазбиение эталона на кандидаты ключевых слов" },
                    { id: "keyword_selection", kind: "secondary_field", description: "Ручной выбор обязательных ключевых слов" },
                    { id: "hint", kind: "supplementary", description: "Подсказка к открытому ответу" },
                    { id: "sequence_matters", kind: "requirement", description: "Проверка порядка ключевых слов" },
                    { id: "images", kind: "asset", description: "До трёх прикреплённых изображений и их превью" },
                ],
                riskClasses: [
                    "ambient_state_contamination",
                    "copy_language_defect",
                    "persistence_divergence",
                    "legacy_revival",
                    "unprotected_destructive_flow",
                ],
                heuristics: [
                    "copy_lint",
                    "dirty_state_audit",
                    "persistence_diff",
                    "archived_logic_audit",
                    "overlay_audit",
                ],
                scenarios: {
                    happy: [
                        "Заполнить вопрос, эталон, выбрать ключевые слова и сохранить",
                    ],
                    rich: [
                        "Добавить подсказку, изображения и включить проверку порядка слов",
                    ],
                    recovery: [
                        "Изменить текст и ключевые слова, перезагрузить страницу, восстановить локальный черновик",
                    ],
                    error: [
                        "Попытаться сохранить без вопроса, без эталона или без обязательных ключевых слов",
                    ],
                    destructive: [
                        "Снять обязательность с ключевого слова и вернуть её обратно",
                        "Удалить прикреплённое изображение из списка",
                    ],
                },
            };
        },

        createDraftRoundtripContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountOpenAnswerShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.task.task_data.content.images = ["img1.png"];
            editor.keywords = [
                { text: "Печень", normalized: "печень", required: true },
                { text: "Здоровье", normalized: "здоровье", required: false },
            ];
            editor.sequenceMatters = true;

            document.querySelector("#question-textarea").value = "Новый вопрос";
            document.querySelector("#reference-textarea").value = "Правильный ответ";
            document.querySelector("#hint-textarea").value = "Подсказка";
            document.querySelector("#sequence-order-check").checked = true;

            return {
                editor,
                expected: {
                    question: "Новый вопрос",
                    prompt: "Новый вопрос",
                    reference_answer: "Правильный ответ",
                    hint: "Подсказка",
                    sequence_matters: true,
                    keywords: ["Печень"],
                    images: ["img1.png"],
                },
                readDraft(state) {
                    return {
                        question: state.content.question,
                        prompt: state.content.prompt,
                        reference_answer: state.content.reference_answer,
                        hint: state.content.hint,
                        sequence_matters: state.content.sequence_matters,
                        keywords: state.content.keywords,
                        images: state.content.images,
                    };
                },
            };
        },

        createCanonicalHydrationContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountOpenAnswerShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.task.task_data.content = {
                question: "Канонический вопрос",
                prompt: "Legacy prompt",
                reference_answer: "Эталонный ответ",
                hint: "Подсказка",
                max_length: 500,
                sequence_matters: true,
                keywords: ["Печень"],
                images: [],
            };

            return {
                editor,
                hydrate() {
                    editor.renderUI();
                },
                expected: {
                    question: "Канонический вопрос",
                    sequenceMatters: true,
                },
                readUi(instance) {
                    return {
                        question: document.querySelector("#question-textarea").value,
                        sequenceMatters: document.querySelector("#sequence-order-check").checked && instance.sequenceMatters,
                    };
                },
            };
        },

        createUndoableDestructiveContext() {
            vi.restoreAllMocks();
            bindDomGlobals(dom);
            mountOpenAnswerShell();
            dispatchDomReady(dom);

            const editor = createEditorInstance(dom);
            editor.task = createBaseTask();
            editor.task.task_data.content.images = ["img1.png"];
            editor.renderImages();

            return {
                editor,
                act() {
                    document.querySelector(".open-answer-image-card .delete-btn")?.click();
                },
                undo() {
                    document.querySelector('[data-toast-action="action"]')?.click();
                },
                read(instance) {
                    return {
                        imageCount: Array.isArray(instance.task.task_data.content.images)
                            ? instance.task.task_data.content.images.length
                            : 0,
                    };
                },
                expectedAfterAction: {
                    imageCount: 0,
                },
                expectedAfterUndo: {
                    imageCount: 1,
                },
            };
        },
    };
}
