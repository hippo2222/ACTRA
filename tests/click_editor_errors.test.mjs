import { describe, it, expect, beforeEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
    return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function setupDom() {
    const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost",
        runScripts: "dangerously",
        resources: "usable"
    });

    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.Node = dom.window.Node;

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
        drawImage: vi.fn(), clearRect: vi.fn(), beginPath: vi.fn(),
        moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
        save: vi.fn(), restore: vi.fn(), measureText: () => ({ width: 0 }),
    });

    // Load dependencies in order
    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor_helpers.js"));
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor.js") + "\n;window.ClickEditor = ClickEditor;");

    return dom;
}

const dom = setupDom();

const dispatchDomReady = () => {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
};

const buildErrorsPane = () => {
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
        <div>
            <div data-errors-text-editor-wrapper>
                <textarea data-errors-text-editor></textarea>
                <div data-errors-highlight-layer></div>
                <button data-errors-add-span-btn disabled></button>
                <div data-errors-selection-hint></div>
                <input data-errors-required-correct />
                <span data-errors-total-count></span>
                <button data-errors-clear-all></button>
                <table>
                    <tbody data-errors-span-list></tbody>
                </table>
                <div data-errors-spans-empty></div>
            </div>
            <div data-reference-section>
                <textarea data-reference-text-editor></textarea>
                <div data-reference-highlight-layer></div>
                <button data-reference-add-span-btn disabled></button>
                <div data-reference-selection-hint></div>
                <span data-reference-char-counter></span>
                <button data-reference-clear-all></button>
                <button data-reference-copy-btn></button>
                <div data-reference-spans-empty></div>
                <table>
                    <tbody data-reference-span-list></tbody>
                </table>
            </div>
            <div data-errors-subpane="errors">
                <div data-choice-prompt-preview></div>
                <div data-choice-prompt-area>
                    <textarea id="choice-prompt-textarea"></textarea>
                </div>
                <button data-choice-prompt-toggle>
                    <span data-choice-prompt-icon></span>
                    <span data-choice-prompt-label></span>
                </button>
            </div>
        </div>
    `;
    return wrapper.firstElementChild; // return the outer div
};

const createEditorInstance = () => {
    const editorClass = dom.window.editor?.constructor;
    if (!editorClass) {
        throw new Error("ClickEditor is not available on dom.window.editor");
    }
    return new editorClass();
};

describe("ClickEditor errors pane (jsdom)", () => {
    let editor;
    let pane;

    beforeEach(() => {
        // fresh DOM
        document.body.innerHTML = `<div id="app"></div>`;
        // stub dialogs
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        dispatchDomReady();
        pane = buildErrorsPane();
        document.getElementById("app").appendChild(pane);
        editor = createEditorInstance();
        editor.errorsModePane = document.getElementById("app");
        editor.errorsPaneInitialized = false;
        editor.initErrorsPaneComponents();
        editor.errorDetection.text = "abc def";
        editor.errorsTextEditor.value = editor.errorDetection.text;
        editor.referenceData.text = "  foo  ";
        if (editor.referenceTextEditor) {
            editor.referenceTextEditor.value = editor.referenceData.text;
        }
        editor.renderErrorsHighlightLayer();
        editor.updateErrorsAddButtonState();
        editor.updateErrorsTotalCount();
    });

    it("adds an error span from selection and clears selection state", () => {
        editor.errorsTextEditor.setSelectionRange(0, 3);
        editor.handleErrorsTextSelection();
        editor.handleErrorsAddSpan();

        const spans = editor.getErrorSpansArray();
        expect(spans.length).toBe(1);
        expect(spans[0]).toMatchObject({ start: 0, end: 3 });
        expect(editor.errorsTextSelection).toBeNull();
        expect(editor.errorsAddSpanBtn.disabled).toBe(true);
    });

    it("clears all spans and resets selection/highlight on clear-all", () => {
        const spans = editor.getErrorSpansArray();
        spans.push({ start: 0, end: 3 });
        editor.renderErrorsSpanList();
        editor.renderErrorsHighlightLayer();
        editor.updateErrorsAddButtonState();

        editor.errorsTextSelection = { start: 0, end: 3 };
        editor.errorsTextEditor.setSelectionRange(0, 3);

        editor.handleErrorsClearAll();

        expect(spans.length).toBe(0);
        expect(editor.errorsTextSelection).toBeNull();
        expect(editor.errorsTextEditor.selectionStart).toBe(0);
        expect(editor.errorsTextEditor.selectionEnd).toBe(0);
        expect(editor.errorsAddSpanBtn.disabled).toBe(true);
    });

    it("updates counters and required_correct when spans change", () => {
        editor.updateErrorsTotalCount();
        expect(editor.errorsTotalCountLabel.textContent).toBe("0");
        expect(editor.errorsRequiredCorrectInput.value).toBe("0");

        const spans = editor.getErrorSpansArray();
        spans.push({ start: 1, end: 4 });
        editor.updateErrorsTotalCount(); // also syncs required_correct

        expect(editor.errorsTotalCountLabel.textContent).toBe("1");
        expect(editor.errorsRequiredCorrectInput.value).toBe("1");
    });

    it("trims whitespace from reference selection before adding span", () => {
        if (!editor.referenceTextEditor) throw new Error("referenceTextEditor missing");
        const spans = editor.getReferenceSpansArray();
        editor.referenceTextEditor.setSelectionRange(0, editor.referenceTextEditor.value.length);
        editor.handleReferenceTextSelection();
        editor.handleReferenceAddSpan();
        expect(spans.length).toBe(1);
        expect(spans[0]).toMatchObject({ start: 2, end: 5 }); // "foo" without spaces
        expect(editor.referenceSelection).toBeNull();
        expect(editor.referenceAddSpanBtn.disabled).toBe(true);
    });
});

describe("ClickEditor choice prompt (errors text_choice)", () => {
    let editor;
    let pane;

    const buildPromptShell = () => {
        document.body.innerHTML = `
            <header><h2></h2></header>
            <textarea id="prompt-textarea"></textarea>
            <input id="required-correct-input" />
            <div id="click-mode-pane"></div>
            <div id="errors-mode-pane"></div>
        `;
        const host = document.createElement("div");
        host.id = "app";
        pane = buildErrorsPane();
        host.appendChild(pane);
        document.body.appendChild(host);
    };

    const createEditorWithTask = (contentOverrides = {}) => {
        dispatchDomReady();
        editor = createEditorInstance();
        editor.cacheDom();
        editor.errorsModePane = pane;
        editor.errorsPaneInitialized = false;
        editor.task = {
            task_data: {
                content: {
                    text: "",
                    error_spans: [],
                    options: [],
                    prompt: "Основной",
                    choice_prompt: "Выберите верный",
                    mode: "text_choice",
                    ...contentOverrides
                },
                meta: { module: "m1", topic: "t1", id: "task1" },
                subtype: "error_detection"
            },
            metadata: { id: "task1", module: "m1", topic: "t1" }
        };
        editor.moduleId = "m1";
        editor.topicId = "t1";
        editor.taskId = "task1";
        editor.errorDetection.enabled = true;
        editor.errorDetection.mode = editor.task.task_data.content.mode;
        editor.initErrorsPaneComponents();
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        window.alert = vi.fn();
        window.confirm = vi.fn(() => true);
        buildPromptShell();
    });

    it("loads and displays choice_prompt with fallback to prompt", () => {
        createEditorWithTask();
        expect(editor.choicePromptTextarea.value).toBe("Выберите верный");
        expect(editor.choicePromptPreviewEl.textContent).toBe("Выберите верный");

        // remove choice_prompt to check fallback
        createEditorWithTask({ choice_prompt: "", prompt: "Фолбек" });
        expect(editor.choicePromptTextarea.value).toBe("Фолбек");
        expect(editor.choicePromptPreviewEl.textContent).toBe("Фолбек");
    });

    it("saves choice_prompt separately and falls back to main prompt when empty", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true })
        });

        createEditorWithTask({
            choice_prompt: "Старая",
            prompt: "Основной",
            options: [
                { id: "opt1", text: "Вариант А", is_correct: true },
                { id: "opt2", text: "Вариант Б", is_correct: false }
            ]
        });
        editor.errorDetection.options = editor.task.task_data.content.options;
        dom.window.fetch = fetchMock;
        editor.choicePromptTextarea.value = "Новая инструкция выбора";
        editor.promptArea.value = "Основной промпт";
        await editor.saveTask();

        expect(editor.task.task_data.content.choice_prompt).toBe("Новая инструкция выбора");

        // now empty choice prompt -> fallback to main prompt
        editor.choicePromptTextarea.value = "";
        editor.promptArea.value = "Промпт по умолчанию";
        await editor.saveTask();

        expect(editor.task.task_data.content.choice_prompt).toBe("Промпт по умолчанию");
        expect(fetchMock).toHaveBeenCalled();
    });
});
