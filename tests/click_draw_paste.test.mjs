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
    global.File = dom.window.File;

    dom.window.fetch = vi.fn();
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.__CLICK_EDITOR_AUTO_INIT_DISABLED__ = true;
    dom.window.__DRAW_EDITOR_AUTO_INIT_DISABLED__ = true;

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
    dom.window.wt = (key, fallback) => fallback;
    dom.window.eval(loadScript("frontend/Editor/base_editor.js") + "\n;window.BaseEditor = BaseEditor;");
    dom.window.eval(loadScript("frontend/Editor/autosave_manager.js") + "\n;window.AutoSaveManager = AutoSaveManager;");
    dom.window.eval(loadScript("frontend/Editor/click_editor.js") + "\n;window.ClickEditor = ClickEditor;");
    dom.window.eval(loadScript("frontend/Editor/draw_editor.js") + "\n;window.DrawEditor = DrawEditor;");

    return dom;
}

const dom = setupDom();
const ClickEditor = dom.window.ClickEditor;
const DrawEditor = dom.window.DrawEditor;

describe("DrawEditor clipboard image paste", () => {
    it("routes pasted image directly to handleMainImageUpload", async () => {
        const initSpy = vi.spyOn(DrawEditor.prototype, "init").mockImplementation(() => Promise.resolve());
        const editor = new DrawEditor();
        initSpy.mockRestore();

        const uploadSpy = vi.spyOn(editor, "handleMainImageUpload").mockResolvedValue(true);
        const file = new dom.window.File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });

        const mockEvent = {
            preventDefault: vi.fn(),
            clipboardData: {
                items: [
                    {
                        kind: "file",
                        type: "image/png",
                        getAsFile: () => file
                    }
                ]
            }
        };

        await editor.handleClipboardPaste(mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(uploadSpy).toHaveBeenCalledTimes(1);
        expect(uploadSpy.mock.calls[0][0].target.files[0]).toBe(file);
    });
});

describe("ClickEditor clipboard image paste", () => {
    it("routes pasted image to handleMainImageUpload when focus is outside additional-textarea", async () => {
        const initSpy = vi.spyOn(ClickEditor.prototype, "init").mockImplementation(() => Promise.resolve());
        const editor = new ClickEditor();
        initSpy.mockRestore();

        const uploadSpy = vi.spyOn(editor, "handleMainImageUpload").mockResolvedValue(true);
        const additionalUploadSpy = vi.spyOn(editor, "handleAdditionalImageUpload").mockResolvedValue(true);
        const file = new dom.window.File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });

        const mockEvent = {
            preventDefault: vi.fn(),
            target: dom.window.document.createElement("div"),
            clipboardData: {
                items: [
                    {
                        kind: "file",
                        type: "image/png",
                        getAsFile: () => file
                    }
                ]
            }
        };

        await editor.handleClipboardPaste(mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(uploadSpy).toHaveBeenCalledTimes(1);
        expect(uploadSpy.mock.calls[0][0].target.files[0]).toBe(file);
        expect(additionalUploadSpy).not.toHaveBeenCalled();
    });

    it("routes pasted image to handleAdditionalImageUpload when focus is inside additional-textarea", async () => {
        const initSpy = vi.spyOn(ClickEditor.prototype, "init").mockImplementation(() => Promise.resolve());
        const editor = new ClickEditor();
        initSpy.mockRestore();

        const uploadSpy = vi.spyOn(editor, "handleMainImageUpload").mockResolvedValue(true);
        const additionalUploadSpy = vi.spyOn(editor, "handleAdditionalImageUpload").mockResolvedValue(true);
        const file = new dom.window.File([new Uint8Array([1, 2, 3])], "pasted.png", { type: "image/png" });

        const textarea = dom.window.document.createElement("textarea");
        textarea.id = "additional-textarea";
        dom.window.document.body.appendChild(textarea);

        const mockEvent = {
            preventDefault: vi.fn(),
            target: textarea,
            clipboardData: {
                items: [
                    {
                        kind: "file",
                        type: "image/png",
                        getAsFile: () => file
                    }
                ]
            }
        };

        await editor.handleClipboardPaste(mockEvent);

        expect(mockEvent.preventDefault).toHaveBeenCalled();
        expect(additionalUploadSpy).toHaveBeenCalledTimes(1);
        expect(additionalUploadSpy.mock.calls[0][0].target.files[0]).toBe(file);
        expect(uploadSpy).not.toHaveBeenCalled();

        dom.window.document.body.removeChild(textarea);
    });
});
