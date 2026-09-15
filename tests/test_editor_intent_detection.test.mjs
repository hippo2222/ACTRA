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
        toast: vi.fn(),
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

describe("TestEditor Smart Intent Detection (Level 2 auto-detect)", () => {
    let dom;
    let editor;

    beforeEach(() => {
        dom = setupDom();
        mountTestShell();
        const TestEditorClass = dom.window.TestEditor;
        const initSpy = vi.spyOn(TestEditorClass.prototype, "init").mockResolvedValue(undefined);
        editor = new TestEditorClass();
        initSpy.mockRestore();

        editor.moduleId = "mod1";
        editor.topicId = "top1";
        editor.taskId = "task1";
        editor.task = {
            task_data: {
                id: "task1",
                type: "test",
                content: {
                    test_type: "multiple_choice",
                    settings: {},
                    questions: []
                },
                settings: {},
                meta: { module: "mod1", topic: "top1", id: "task1", name: "Тест 4.12" }
            },
            metadata: { module: "mod1", topic: "top1", id: "task1", name: "Тест 4.12" }
        };

        editor.difficultyAuthoring = {
            activeMeta: {
                supported_levels: [1, 2],
                authoring_enabled: true
            },
            state: {
                mode: "all",
                selectedLevels: [1, 2],
                lastCustomSelectedLevels: [1, 2]
            },
            ui: { expanded: false }
        };
    });

    it("shouldPromptForLevel2Intent returns true when all questions have 1 option and Level 1 is active", () => {
        editor.questions = [
            { id: 1, text: "Вопрос 1", options: [{ text: "Диагноз А", is_correct: true }] },
            { id: 2, text: "Вопрос 2", options: [{ text: "Признак Б", is_correct: true }] }
        ];

        expect(editor.isOnlyLevel2Selected()).toBe(false);
        expect(editor.shouldPromptForLevel2Intent()).toBe(true);
    });

    it("shouldPromptForLevel2Intent returns false when Level 2 is already exclusively selected", () => {
        editor.questions = [
            { id: 1, text: "Вопрос 1", options: [{ text: "Диагноз А", is_correct: true }] }
        ];
        editor.difficultyAuthoring.state = {
            mode: "custom",
            selectedLevels: [2],
            lastCustomSelectedLevels: [2]
        };

        expect(editor.isOnlyLevel2Selected()).toBe(true);
        expect(editor.shouldPromptForLevel2Intent()).toBe(false);
    });

    it("shouldPromptForLevel2Intent returns false when some questions have multiple options", () => {
        editor.questions = [
            { id: 1, text: "Вопрос 1", options: [{ text: "Диагноз А", is_correct: true }] },
            { id: 2, text: "Вопрос 2", options: [{ text: "Вариант 1", is_correct: true }, { text: "Вариант 2", is_correct: false }] }
        ];

        expect(editor.shouldPromptForLevel2Intent()).toBe(false);
    });

    it("selectOnlyLevel2Difficulty switches mode to custom, sets [2], and validates successfully", () => {
        editor.questions = [
            { id: 1, text: "Какая патология?", options: [{ text: "Обычная пневмония", is_correct: false }] }
        ];

        // Before switch: Level 1 is active, validation fails
        expect(editor.isOnlyLevel2Selected()).toBe(false);
        const errBefore = editor.validateTask();
        expect(errBefore).toContain("минимум два варианта ответа");

        // Execute switch
        const ok = editor.selectOnlyLevel2Difficulty();
        expect(ok).toBe(true);

        // After switch: mode is custom, selectedLevels is [2], option is marked correct
        expect(editor.difficultyAuthoring.state.mode).toBe("custom");
        expect(editor.difficultyAuthoring.state.selectedLevels).toEqual([2]);
        expect(editor.task.task_data.settings.allowed_difficulties).toEqual([2]);
        expect(editor.questions[0].options[0].is_correct).toBe(true);
        expect(editor.isOnlyLevel2Selected()).toBe(true);

        // Validation passes
        const errAfter = editor.validateTask();
        expect(errAfter).toBeNull();
    });

    it("resolveSingleOptionTestIntent prompts user and switches to Level 2 on confirm", async () => {
        editor.questions = [
            { id: 1, text: "Диагноз?", options: [{ text: "Саркоидоз", is_correct: true }] }
        ];

        const confirmSpy = vi.spyOn(editor, "confirmAction").mockResolvedValue(true);

        const canProceed = await editor.resolveSingleOptionTestIntent();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(canProceed).toBe(true);
        expect(editor.isOnlyLevel2Selected()).toBe(true);
    });

    it("resolveSingleOptionTestIntent aborts and shows info toast on cancel", async () => {
        editor.questions = [
            { id: 1, text: "Диагноз?", options: [{ text: "Саркоидоз", is_correct: true }] }
        ];

        const confirmSpy = vi.spyOn(editor, "confirmAction").mockResolvedValue(false);
        const toastSpy = vi.spyOn(editor, "showToast");

        const canProceed = await editor.resolveSingleOptionTestIntent();
        expect(confirmSpy).toHaveBeenCalledTimes(1);
        expect(canProceed).toBe(false);
        expect(editor.isOnlyLevel2Selected()).toBe(false);
        expect(toastSpy).toHaveBeenCalledWith(
            expect.stringContaining("Добавьте второй вариант"),
            "info"
        );
    });

    it("saveTask saves with allowed_difficulties: [2] when author confirms Level 2 intent", async () => {
        editor.questions = [
            { id: 1, text: "Диагноз?", options: [{ text: "Саркоидоз", is_correct: true }] }
        ];

        vi.spyOn(editor, "confirmAction").mockResolvedValue(true);
        editor.applyDifficultyAuthoringSettings = vi.fn().mockResolvedValue(true);

        let sentPayload = null;
        dom.window.fetch = vi.fn().mockImplementation(async (url, opts) => {
            if (opts && opts.body) {
                sentPayload = JSON.parse(opts.body);
            }
            return {
                ok: true,
                status: 200,
                json: async () => ({ ok: true })
            };
        });

        await editor.saveTask();

        expect(sentPayload).not.toBeNull();
        expect(sentPayload.settings.allowed_difficulties).toEqual([2]);
        expect(editor.isOnlyLevel2Selected()).toBe(true);
    });

    it("saveTask does not send request when author cancels Level 2 prompt", async () => {
        editor.questions = [
            { id: 1, text: "Диагноз?", options: [{ text: "Саркоидоз", is_correct: true }] }
        ];

        vi.spyOn(editor, "confirmAction").mockResolvedValue(false);
        const fetchSpy = vi.spyOn(dom.window, "fetch");

        await editor.saveTask();

        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
