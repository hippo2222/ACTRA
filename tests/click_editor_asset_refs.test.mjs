import { describe, it, expect, vi } from "vitest";
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
    dom.window.__CLICK_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.HTMLCanvasElement.prototype.getContext = () => ({
        drawImage: vi.fn(),
        clearRect: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        stroke: vi.fn(),
        fill: vi.fn(),
        save: vi.fn(),
        restore: vi.fn(),
        measureText: () => ({ width: 0 }),
    });

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor_helpers.js"));
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor.js") + "\n;window.ClickEditor = ClickEditor;");

    return dom;
}

const dom = setupDom();
const ClickEditor = dom.window.ClickEditor;

function createEditorInstance() {
    const initSpy = vi.spyOn(ClickEditor.prototype, "init").mockResolvedValue(undefined);
    const instance = new ClickEditor();
    initSpy.mockRestore();
    return instance;
}

describe("ClickEditor asset refs", () => {
    it("preserves nested hosted asset refs and still resolves preview through asset_id", () => {
        const editor = createEditorInstance();
        editor.moduleId = "m1";
        editor.topicId = "t1";
        editor.taskId = "task1";

        const normalized = editor.normalizeImageReference({
            image: {
                asset_id: "asset_click_editor_1",
                path: "legacy/click-image.png"
            }
        });

        expect(normalized).toEqual({
            path: "legacy/click-image.png",
            asset_id: "asset_click_editor_1",
            asset_url: null,
        });
        expect(editor.resolveEditorImagePreviewSrc(normalized)).toBe(
            "/api/editor/image?asset_id=asset_click_editor_1"
        );
    });
});
