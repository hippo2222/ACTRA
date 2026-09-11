import { describe, expect, it, vi, beforeEach } from "vitest";
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

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
    defineGlobal("fetch", (...args) => dom.window.fetch(...args));
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
            <div class="p-6 space-y-8"></div>
            <div id="question-list"></div>
            <button id="add-question-btn"></button>
            <button id="import-btn"></button>
            <button id="export-btn"></button>
            <input id="import-input" type="file" />
        </aside>
        <main>
            <section class="question-paste-surface">
                <textarea id="question-textarea"></textarea>
                <div class="question-media-dock">
                    <button id="upload-image-btn" type="button"></button>
                    <div id="question-images-grid" class="question-media-grid hidden"></div>
                </div>
            </section>
            <input id="image-upload-input" type="file" multiple />
            <div id="options-container"></div>
            <button id="add-option-btn"></button>
            <input id="option-image-input" type="file" />
        </main>
        <aside>
            <span id="answer-type-display"></span>
            <section id="test-image-bank" class="test-image-bank is-expanded">
                <button id="test-image-bank-toggle" type="button" aria-expanded="true" aria-controls="test-image-bank-panel"></button>
                <span id="test-image-bank-count"></span>
            </section>
        </aside>
    `;
}

describe("Test option text preservation", () => {
    let dom;
    let editor;

    beforeEach(() => {
        dom = setupDom();
        mountTestShell();
        const TestEditorClass = dom.window.TestEditor;
        const initSpy = vi.spyOn(TestEditorClass.prototype, "init").mockResolvedValue(undefined);
        editor = new TestEditorClass();
        initSpy.mockRestore();

        editor.task = {
            metadata: { id: "test_task", type: "test" },
            task_data: {
                meta: { module: "m1", topic: "t1" },
                settings: { allowed_difficulties: [2] },
                content: { questions: [], settings: { allowed_difficulties: [2] } },
            },
        };
        editor.questions = [
            {
                text: "Вопрос 1",
                options: [
                    { text: "", is_correct: true, image_path: null },
                ],
                explanation: "",
                images: [],
                image_path: null,
            },
        ];
        editor.currentQuestionIndex = 0;
        editor.difficultyAuthoring = {
            activeMeta: { authoring_enabled: true },
            state: { mode: "custom", selectedLevels: [2] }
        };
        editor.renderUI();
    });

    it("preserves 'Утолщение стенок бронхов (Бронхоэктазы)' when typing into textarea and saving", async () => {
        const textarea = document.querySelector("#options-container .option-row textarea");
        expect(textarea).not.toBeNull();

        const targetText = "Утолщение стенок бронхов (Бронхоэктазы)";
        textarea.value = targetText;
        textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

        expect(editor.questions[0].options[0].text).toBe(targetText);

        const valErr = editor.validateTask();
        expect(valErr).toBeNull();

        const taskData = editor.buildTaskData();
        const savedOptionText = taskData.content.questions[0].options[0].text;
        const savedAnswerText = taskData.content.questions[0].answers[0].text;

        expect(savedOptionText).toBe(targetText);
        expect(savedAnswerText).toBe(targetText);

        // Test saveTask fetch call
        let capturedPayload = null;
        editor.applyDifficultyAuthoringSettings = vi.fn().mockResolvedValue(true);
        dom.window.fetch = vi.fn().mockImplementation(async (url, opts) => {
            if (opts && opts.body) {
                capturedPayload = JSON.parse(opts.body);
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true })
            };
        });

        await editor.saveTask();
        expect(capturedPayload).not.toBeNull();
        const sentOptionText = capturedPayload.content.questions[0].options[0].text;
        expect(sentOptionText).toBe(targetText);
    });

    it("does not intercept Ctrl+Z when typing inside textarea or input", () => {
        const textarea = document.querySelector("#options-container .option-row textarea");
        expect(textarea).not.toBeNull();

        const undoSpy = vi.spyOn(editor, "performUndo");

        // Simulate Ctrl+Z while focused in textarea
        const ctrlZInside = new dom.window.KeyboardEvent("keydown", {
            key: "z",
            code: "KeyZ",
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        textarea.dispatchEvent(ctrlZInside);

        // Should NOT call editor.performUndo
        expect(undoSpy).not.toHaveBeenCalled();
        expect(ctrlZInside.defaultPrevented).toBe(false);

        // Simulate Ctrl+Z outside textarea (on document.body)
        const ctrlZOutside = new dom.window.KeyboardEvent("keydown", {
            key: "z",
            code: "KeyZ",
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        document.body.dispatchEvent(ctrlZOutside);

        // Should call editor.performUndo and preventDefault
        expect(undoSpy).toHaveBeenCalledTimes(1);
        expect(ctrlZOutside.defaultPrevented).toBe(true);

        // Test Russian layout: key is 'я'
        const ctrlYaOutside = new dom.window.KeyboardEvent("keydown", {
            key: "я",
            code: "KeyZ",
            ctrlKey: true,
            bubbles: true,
            cancelable: true
        });
        document.body.dispatchEvent(ctrlYaOutside);
        expect(undoSpy).toHaveBeenCalledTimes(2);
        expect(ctrlYaOutside.defaultPrevented).toBe(true);
    });
});

