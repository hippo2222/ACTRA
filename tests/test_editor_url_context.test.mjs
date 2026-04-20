import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

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
    defineGlobal("navigator", dom.window.navigator);
    defineGlobal("localStorage", dom.window.localStorage);
    defineGlobal("sessionStorage", dom.window.sessionStorage);
    defineGlobal("URL", dom.window.URL);
    defineGlobal("URLSearchParams", dom.window.URLSearchParams);
}

function setupDom(url) {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>
            <div id="toast-container"></div>
            <div id="loading-overlay"></div>
            <div id="loading-text"></div>
        </body></html>`,
        {
            url,
            runScripts: "dangerously",
            resources: "usable",
        }
    );

    bindDomGlobals(dom);
    dom.window.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ ok: false, error: "Not found" }),
    });
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.NotificationUI = {
        confirm: vi.fn().mockResolvedValue(true),
    };
    dom.window.navigateWithTransition = vi.fn();
    dom.window.requestAnimationFrame = dom.window.requestAnimationFrame || ((cb) => setTimeout(cb, 0));
    dom.window.cancelAnimationFrame = dom.window.cancelAnimationFrame || ((id) => clearTimeout(id));

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/test_editor.js") + "\n;window.TestEditor = TestEditor;");

    return dom;
}

describe("TestEditor URL context", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("reads module, topic and task from URL when opening a new task", async () => {
        const dom = setupDom("http://localhost/ui/editor/Test%20Task%20Editor%20Multiple%20Choice.html?module=test_module&topic=test_topic&task=task_123&new=1&task_type=test&task_name=Smoke");
        const EditorClass = dom.window.TestEditor;
        const initSpy = vi.spyOn(EditorClass.prototype, "init").mockResolvedValue(undefined);
        const editor = new EditorClass();
        initSpy.mockRestore();

        const fatalSpy = vi.spyOn(editor, "showFatalError").mockImplementation(() => {});
        const bootstrapSpy = vi.spyOn(editor, "fetchTaskBootstrap").mockResolvedValue({
            task_data: {
                type: "test",
                meta: {
                    id: "task_123",
                    module: "test_module",
                    topic: "test_topic",
                    name: "Smoke",
                },
                content: {
                    questions: [],
                    settings: {},
                },
                settings: {},
            },
            metadata: {
                id: "task_123",
                module: "test_module",
                topic: "test_topic",
                name: "Smoke",
            },
        });
        const applySpy = vi.spyOn(editor, "applyLoadedTask").mockImplementation(() => {});

        const ok = await editor.initTaskFromUrlContext();

        expect(ok).toBe(true);
        expect(fatalSpy).not.toHaveBeenCalled();
        expect(editor.moduleId).toBe("test_module");
        expect(editor.topicId).toBe("test_topic");
        expect(editor.taskId).toBe("task_123");
        expect(bootstrapSpy).toHaveBeenCalledWith(
            "test_module",
            "test_topic",
            "task_123",
            "test",
            "Smoke"
        );
        expect(applySpy).toHaveBeenCalled();
    });

    it("discards an unsaved bootstrap task locally without calling delete API", async () => {
        const dom = setupDom("http://localhost/ui/editor/Test%20Task%20Editor%20Multiple%20Choice.html?module=test_module&topic=test_topic&task=task_123&new=1&task_type=test&task_name=Smoke");
        const EditorClass = dom.window.TestEditor;
        const initSpy = vi.spyOn(EditorClass.prototype, "init").mockResolvedValue(undefined);
        const editor = new EditorClass();
        initSpy.mockRestore();

        editor.task = {
            task_data: {
                type: "test",
                meta: {
                    id: "task_123",
                    module: "test_module",
                    topic: "test_topic",
                    name: "Smoke",
                },
                content: {
                    questions: [],
                    settings: {},
                },
                settings: {},
            },
            metadata: {
                id: "task_123",
                module: "test_module",
                topic: "test_topic",
                name: "Smoke",
            },
        };
        editor.moduleId = "test_module";
        editor.topicId = "test_topic";
        editor.taskId = "task_123";
        editor.hasPersistedTask = false;
        editor.autoSaveManager = {
            stop: vi.fn(),
            clearDraft: vi.fn(),
        };

        const clearBootstrapSpy = vi.spyOn(editor, "clearTaskBootstrap").mockImplementation(() => {});
        const showToastSpy = vi.spyOn(editor, "showToast").mockImplementation(() => {});

        dom.window.fetch.mockClear();
        await editor.deleteTest();

        const deleteCalls = dom.window.fetch.mock.calls.filter(([, options]) => options?.method === "DELETE");
        expect(deleteCalls).toHaveLength(0);
        expect(editor.autoSaveManager.stop).toHaveBeenCalledTimes(1);
        expect(editor.autoSaveManager.clearDraft).toHaveBeenCalledTimes(1);
        expect(clearBootstrapSpy).toHaveBeenCalledTimes(1);
        expect(showToastSpy).toHaveBeenCalledWith("Черновик удалён", "success");
        expect(dom.window.navigateWithTransition).toHaveBeenCalledWith("/ui/editor");
        expect(editor.hasUnsavedChanges).toBe(false);
    });
    it("preserves nested hosted image refs when normalizing backend questions", () => {
        const dom = setupDom("http://localhost/ui/editor/Test%20Task%20Editor%20Multiple%20Choice.html");
        const EditorClass = dom.window.TestEditor;
        const initSpy = vi.spyOn(EditorClass.prototype, "init").mockResolvedValue(undefined);
        const editor = new EditorClass();
        initSpy.mockRestore();

        const [question] = editor.normalizeQuestionsFromBackend([
            {
                text: "Hosted image question",
                image: {
                    asset_url: "/api/assets/question_asset_1/content",
                    path: "legacy/question-image.png"
                },
                answers: [
                    {
                        text: "Option A",
                        correct: true,
                        image: {
                            asset_id: "answer_asset_1",
                            path: "legacy/answer-image.png"
                        }
                    }
                ]
            }
        ]);

        expect(question.image).toBe("legacy/question-image.png");
        expect(question.image_asset_url).toBe("/api/assets/question_asset_1/content");
        expect(question.options[0]).toMatchObject({
            image_path: "legacy/answer-image.png",
            image_asset_id: "answer_asset_1",
            image_asset_url: null,
        });
        expect(
            editor.resolveImageSource(
                question.options[0].image_path,
                question.options[0].image_asset_url,
                question.options[0].image_asset_id
            )
        ).toBe("/api/editor/image?asset_id=answer_asset_1");
    });
});
