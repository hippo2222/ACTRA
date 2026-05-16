import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const theoryEditorSource = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/theory_editor.js"),
    "utf8",
);

const theoryEditorHtml = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/Theory_Editor.html"),
    "utf8",
);

function defineGlobal(name, value) {
    Object.defineProperty(globalThis, name, {
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

function setupTheoryEditorDom(url = "http://localhost/editor/Theory_Editor.html") {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>
            <div id="theory-context-copy"></div>
            <button id="theory-back-btn"></button>
            <span id="theory-back-btn-label"></span>
            <button id="theory-open-center-btn"></button>
            <button id="theory-open-complexes-btn"></button>
            <div id="theory-library-count"></div>
            <div id="theory-library-list"></div>
            <div id="theory-color-picker-host">
                <button id="theory-color-btn" type="button"></button>
                <div id="theory-color-palette"></div>
            </div>
            <span id="theory-color-indicator"></span>
            <input id="theory-title" />
            <div id="theory-editor" contenteditable="true"></div>
            <span id="theory-status-pill"></span>
            <button id="theory-save-btn"></button>
        </body></html>`,
        {
            url,
            runScripts: "dangerously",
            resources: "usable",
        },
    );

    bindDomGlobals(dom);
    dom.window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, items: [] }),
    });
    dom.window.alert = vi.fn();
    dom.window.confirm = vi.fn(() => true);
    dom.window.NotificationUI = {
        toast: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
    };
    dom.window.navigateWithTransition = vi.fn();
    dom.window.document.execCommand = vi.fn();

    dom.window.eval(`${theoryEditorSource}
window.__theoryEditorTestExports = {
    theoryEditorState,
    cleanTheoryWordHtml,
    editorHtmlToTheoryDelta,
    renderTheoryDeltaToEditor,
    normalizeTheoryWorkspaceUrl,
    resolveTheoryCenterUrl,
    resolveTheoryComplexesUrl,
    renderTheoryLibraryList,
    renderTheoryContextHeader,
    updateTheoryEditorActions,
    setTheoryColorIndicator,
    initColorPicker,
};`);

    return dom;
}

describe("Theory editor regressions", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.HTMLElement;
        delete globalThis.Node;
        delete globalThis.navigator;
        delete globalThis.localStorage;
        delete globalThis.sessionStorage;
        delete globalThis.URL;
        delete globalThis.URLSearchParams;
    });

    it("ships theme-aware defaults and visible library overflow in static markup", () => {
        const dom = new JSDOM(theoryEditorHtml);
        const titleInput = dom.window.document.getElementById("theory-title");
        const colorIndicator = dom.window.document.getElementById("theory-color-indicator");
        const complexesBtn = dom.window.document.getElementById("theory-open-complexes-btn");
        const aside = dom.window.document.querySelector("aside");

        expect(titleInput?.className).not.toContain("text-black");
        expect(colorIndicator?.getAttribute("style")).toContain("background:var(--color-text-main)");
        expect(complexesBtn?.className).not.toContain("disabled:cursor-not-allowed");
        expect(aside?.className).toContain("overflow-visible");
        expect(theoryEditorHtml).toContain("padding-top: 0.35rem;");
        expect(theoryEditorHtml).toContain("color: var(--color-text-main);");
        expect(theoryEditorHtml).toContain("caret-color: var(--color-text-main);");
        expect(theoryEditorHtml).toContain(".theory-form-field::placeholder");
        expect(theoryEditorHtml).not.toContain("Рабочее пространство теории");
        expect(theoryEditorSource).toContain("function getTheoryDefaultTextColor()");
        expect(theoryEditorSource).not.toContain('const THEORY_DEFAULT_TEXT_COLOR = "#000000";');
    });

    it("drops query prefill when normalizing legacy theory center URLs", () => {
        const dom = setupTheoryEditorDom();
        const { normalizeTheoryWorkspaceUrl } = dom.window.__theoryEditorTestExports;

        expect(normalizeTheoryWorkspaceUrl("/editor?theory_hub=1&theory_id=th_123")).toBe(
            "/editor/Theory_Center.html?scope=complexes",
        );
        expect(normalizeTheoryWorkspaceUrl("http://localhost/editor?theory_hub=1&theory_id=th_123")).toBe(
            "/editor/Theory_Center.html?scope=complexes",
        );
    });

    it("resolves theory center URLs by context without leaking q search params", () => {
        const dom = setupTheoryEditorDom();
        const { theoryEditorState, resolveTheoryCenterUrl } = dom.window.__theoryEditorTestExports;

        theoryEditorState.context = { context: "complex", complexId: "cx_1" };
        expect(resolveTheoryCenterUrl()).toBe("/editor/Theory_Center.html?scope=complexes");

        theoryEditorState.context = { context: "topic", topicId: "tp_1" };
        expect(resolveTheoryCenterUrl()).toBe("/editor/Theory_Center.html?scope=topics");

        theoryEditorState.context = {};
        expect(resolveTheoryCenterUrl()).toBe("/editor/Theory_Center.html");
    });

    it("keeps the complexes button active and routes it to the plain complexes page", () => {
        const dom = setupTheoryEditorDom();
        const {
            theoryEditorState,
            renderTheoryContextHeader,
            updateTheoryEditorActions,
            resolveTheoryComplexesUrl,
        } = dom.window.__theoryEditorTestExports;
        const button = dom.window.document.getElementById("theory-open-complexes-btn");

        theoryEditorState.context = { context: "complex", complexId: "cx_42" };
        theoryEditorState.activeTheoryId = "";
        renderTheoryContextHeader();
        updateTheoryEditorActions();
        expect(button.disabled).toBe(false);
        expect(button.dataset.target).toBe("/complexes");
        expect(resolveTheoryComplexesUrl()).toBe("/complexes");

        theoryEditorState.context = {};
        theoryEditorState.activeTheoryId = "th_42";
        renderTheoryContextHeader();
        updateTheoryEditorActions();
        expect(button.disabled).toBe(false);
        expect(button.dataset.target).toBe("/complexes");
        expect(resolveTheoryComplexesUrl()).toBe("/complexes");

        theoryEditorState.activeTheoryId = "";
        renderTheoryContextHeader();
        updateTheoryEditorActions();
        expect(button.disabled).toBe(false);
        expect(button.dataset.target).toBe("/complexes");
        expect(resolveTheoryComplexesUrl()).toBe("/complexes");
    });

    it("renders library cards without showing theory ids and keeps badges on one row", () => {
        const dom = setupTheoryEditorDom();
        const { theoryEditorState, renderTheoryLibraryList } = dom.window.__theoryEditorTestExports;

        theoryEditorState.catalog = [{
            id: "th_hidden_42",
            title: "Тестовая теория",
            usage_topics: 0,
            usage_complexes: 0,
            has_content: false,
            image_count: 2,
            updated_at: "2026-03-18T08:15:00.000Z",
        }];
        theoryEditorState.search = "";
        theoryEditorState.activeTheoryId = "";

        renderTheoryLibraryList();

        const item = dom.window.document.querySelector(".theory-library-item");
        expect(item).not.toBeNull();
        expect(item.textContent).toContain("Тестовая теория");
        expect(item.textContent).toContain("2 фото");
        expect(item.textContent).not.toContain("th_hidden_42");
        expect(item.innerHTML).toContain("grid w-full");
    });

    it("keeps Word list paragraphs as semantic lists through save and reload conversion", () => {
        const dom = setupTheoryEditorDom();
        const {
            cleanTheoryWordHtml,
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        editor.innerHTML = cleanTheoryWordHtml(`
            <p class="MsoNormal">Intro</p>
            <p class="MsoListParagraphCxSpFirst" style="margin-left:36pt;text-indent:-18pt;mso-list:l0 level1 lfo1">
                <span style="mso-list:Ignore;font-family:Symbol">·<span>&nbsp;&nbsp;&nbsp;</span></span>
                First bullet
            </p>
            <p class="MsoListParagraphCxSpLast" style="margin-left:36pt;text-indent:-18pt;mso-list:l0 level1 lfo1">
                <span style="mso-list:Ignore;font-family:Symbol">·<span>&nbsp;&nbsp;&nbsp;</span></span>
                Second bullet
            </p>
            <p class="MsoNormal">Tail</p>
        `);

        expect(editor.innerHTML).toContain("<ul>");
        expect(editor.innerHTML).toContain("<li>");

        const delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual(expect.arrayContaining([
            { insert: "First bullet" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "Second bullet" },
            { insert: "\n", attributes: { list: "bullet" } },
        ]));

        renderTheoryDeltaToEditor(delta);
        expect(editor.innerHTML).toContain("<ul>");
        expect(editor.innerHTML).toContain("<li>First bullet</li>");
        expect(editor.innerHTML).toContain("<li>Second bullet</li>");
        expect(editor.textContent).not.toContain("?");
    });

    it("ignores whitespace-only nodes between block elements when serializing editor content", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        editor.innerHTML = "<p>Paragraph 1</p>\n    <p>Paragraph 2</p>\n    <p>Paragraph 3</p>";

        const delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Paragraph 1" },
            { insert: "\n" },
            { insert: "Paragraph 2" },
            { insert: "\n" },
            { insert: "Paragraph 3" },
            { insert: "\n" },
        ]);

        renderTheoryDeltaToEditor(delta);
        expect(editor.innerHTML).toBe("<p>Paragraph 1</p><p>Paragraph 2</p><p>Paragraph 3</p>");
    });

    it("preserves hosted asset image refs through render and delta serialization", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        renderTheoryDeltaToEditor({
            ops: [
                { insert: { image: "/api/assets/asset_theory_42/content" } },
                { insert: "\n" },
            ],
        });

        const image = editor.querySelector("img");
        expect(image).not.toBeNull();
        expect(image.getAttribute("src")).toBe("/api/assets/asset_theory_42/content");
        expect(image.getAttribute("data-asset-url")).toBe("/api/assets/asset_theory_42/content");
        expect(image.hasAttribute("data-path")).toBe(false);

        const delta = editorHtmlToTheoryDelta();
        expect(delta.ops[0].insert.image).toBe("/api/assets/asset_theory_42/content");
    });
});
