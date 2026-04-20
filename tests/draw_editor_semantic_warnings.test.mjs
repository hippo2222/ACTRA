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
    dom.window.__DRAW_EDITOR_AUTO_INIT_DISABLED__ = true;

    dom.window.eval(loadScript("frontend/Editor/undo_manager.js") + "\n;window.UndoManager = UndoManager;");
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/draw_editor.js") + "\n;window.DrawEditor = DrawEditor;");

    return dom;
}

const dom = setupDom();
const DrawEditor = dom.window.DrawEditor;

function createEditorInstance() {
    const initSpy = vi.spyOn(DrawEditor.prototype, "init").mockImplementation(() => {});
    const instance = new DrawEditor();
    initSpy.mockRestore();
    return instance;
}

describe("DrawEditor semantic warnings", () => {
    it("flags duplicate labels, placeholder labels, and tiny regions", () => {
        const editor = createEditorInstance();
        editor.regions = [
            {
                label: "New Region",
                points: [[10, 10], [11, 10], [11, 11], [10, 11]]
            },
            {
                label: "Liver",
                points: [[20, 20], [40, 20], [40, 40], [20, 40]]
            },
            {
                label: "liver",
                points: [[50, 50], [70, 50], [70, 70], [50, 70]]
            }
        ];

        const warnings = editor.getSemanticWarnings().join(" | ");

        expect(warnings).toContain("Повторяются названия областей");
        expect(warnings).toContain("техническое имя");
        expect(warnings).toContain("слишком маленькими");
    });
    it("prefers hosted asset refs for preview even when a legacy path is still present", () => {
        const editor = createEditorInstance();

        const normalized = editor.normalizeImageReference({
            image: {
                asset_url: "/api/assets/draw_asset_1/content",
                path: "legacy/draw-image.png"
            }
        });

        expect(normalized).toEqual({
            path: "legacy/draw-image.png",
            asset_id: null,
            asset_url: "/api/assets/draw_asset_1/content",
        });
        expect(editor.resolveEditorImagePreviewSrc(normalized)).toBe("/api/assets/draw_asset_1/content");
    });
});
