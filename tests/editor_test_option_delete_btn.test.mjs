import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("Test editor option delete button container and markup", () => {
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
                content: { questions: [], settings: {} },
            },
        };
        editor.questions = [
            {
                text: "Вопрос 1",
                options: [
                    { text: "Вариант А", is_correct: true, image_path: null },
                    { text: "Вариант Б", is_correct: false, image_path: null },
                    { text: "Вариант В", is_correct: false, image_path: null },
                ],
                explanation: "",
                images: [],
                image_path: null,
            },
        ];
        editor.currentQuestionIndex = 0;
        editor.renderUI();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders delete button inside option-row__toolbar-actions with icon and sr-only label", () => {
        const optionRows = document.querySelectorAll("#options-container .option-row");
        expect(optionRows.length).toBe(3);

        const firstRow = optionRows[0];
        const actionsContainer = firstRow.querySelector(".option-row__toolbar-actions");
        expect(actionsContainer).not.toBeNull();

        const deleteBtn = actionsContainer.querySelector(".delete-option.option-row__delete-btn");
        expect(deleteBtn).not.toBeNull();
        expect(deleteBtn.getAttribute("type")).toBe("button");
        expect(deleteBtn.getAttribute("title")).toContain("Удалить");
        expect(deleteBtn.getAttribute("aria-label")).toContain("Удалить");

        // Material symbol icon must be present and have text 'delete'
        const icon = deleteBtn.querySelector(".material-symbols-outlined");
        expect(icon).not.toBeNull();
        expect(icon.textContent.trim()).toBe("delete");

        // The text label must be wrapped inside .sr-only
        const srOnly = deleteBtn.querySelector(".sr-only");
        expect(srOnly).not.toBeNull();
        expect(srOnly.textContent.trim()).toBe("Удалить");

        // No loose text node should exist directly in the button
        const directTextNodes = Array.from(deleteBtn.childNodes)
            .filter((node) => node.nodeType === 3 && node.textContent.trim().length > 0);
        expect(directTextNodes.length).toBe(0);
    });

    it("ensures test_editor.css has proper styling and does not hide delete icon", () => {
        const cssContent = loadScript("frontend/Editor/test_editor.css");

        // Ensure the broken selector was removed
        expect(cssContent).not.toMatch(/\.option-row__delete-btn\s+span:last-child\s*\{\s*display:\s*none;?\s*\}/);

        // Ensure icon button sizing is polished
        expect(cssContent).toMatch(/\.option-row__delete-btn\s*\{[^}]*width:\s*1\.5rem;/);
        expect(cssContent).toMatch(/\.option-row__delete-btn\s*\{[^}]*height:\s*1\.5rem;/);
        expect(cssContent).toMatch(/\.option-row__toolbar-actions\s*\{[^}]*justify-content:\s*flex-end;/);
    });

    it("clicking delete button removes the option cleanly", () => {
        const deleteButtons = document.querySelectorAll("#options-container .delete-option");
        expect(deleteButtons.length).toBe(3);

        deleteButtons[0].click();

        const remainingRows = document.querySelectorAll("#options-container .option-row");
        expect(remainingRows.length).toBe(2);
        expect(editor.questions[0].options.length).toBe(2);
        expect(editor.questions[0].options[0].text).toBe("Вариант Б");
    });
});
