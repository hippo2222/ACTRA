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
            <button id="theory-sidebar-toggle-btn"><span class="material-symbols-outlined">view_sidebar</span></button>
            <button id="theory-open-center-btn"></button>
            <button id="theory-open-complexes-btn"></button>
            <main id="theory-main-grid">
                <aside id="theory-library-panel">
                    <div id="theory-library-count"></div>
                    <div id="theory-library-list"></div>
                </aside>
                <section class="theory-workspace-panel">
                    <div id="theory-color-picker-host">
                        <button id="theory-color-btn" type="button"></button>
                        <div id="theory-color-palette"></div>
                    </div>
                    <span id="theory-color-indicator"></span>
                    <span id="theory-usage-note"></span>
                    <div id="theory-stats-counter"></div>
                    <input id="theory-title" />
                    <div id="theory-toolbar">
                        <button id="theory-bold" aria-pressed="false"></button>
                        <button id="theory-italic" aria-pressed="false"></button>
                        <button id="theory-underline" aria-pressed="false"></button>
                        <button id="theory-h1" aria-pressed="false"></button>
                        <button id="theory-h2" aria-pressed="false"></button>
                        <button id="theory-ul" aria-pressed="false"></button>
                        <button id="theory-ol" aria-pressed="false"></button>
                        <button id="theory-align-left" aria-pressed="false"></button>
                        <button id="theory-align-center" aria-pressed="false"></button>
                        <button id="theory-align-right" aria-pressed="false"></button>
                        <button id="theory-align-justify" aria-pressed="false"></button>
                    </div>
                    <div id="theory-editor" contenteditable="true"></div>
                    <span id="theory-status-pill"></span>
                    <button id="theory-save-btn"></button>
                </section>
            </main>
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
    setTheoryStatus,
    persistTheory,
    initTheorySidebarToggle,
    updateTheoryStatsCounter,
    updateTheoryToolbarActiveStates,
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
        expect(theoryEditorHtml).toContain("padding-top: 0.55rem;");
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

    it("renders concise status pill with tooltip title and resilient label element", () => {
        const dom = setupTheoryEditorDom();
        const { setTheoryStatus } = dom.window.__theoryEditorTestExports;
        const pill = dom.window.document.getElementById("theory-status-pill");

        setTheoryStatus("Теория сохранена", "success", "check_circle");
        expect(pill.dataset.tone).toBe("success");
        expect(pill.title).toBe("Теория сохранена");
        expect(pill.innerHTML).toContain("theory-status-pill__label");
        expect(pill.innerHTML).toContain("check_circle");
        expect(pill.textContent).toContain("Теория сохранена");
    });

    it("includes overflow-safe CSS styles for theory-status-pill in Theory_Editor.html", () => {
        const dom = new JSDOM(theoryEditorHtml);
        expect(theoryEditorHtml).toContain(".theory-status-pill__label");
        expect(theoryEditorHtml).toContain("text-overflow: ellipsis");
        expect(theoryEditorHtml).toContain("max-width: 100%");
        expect(theoryEditorHtml).toContain("min-width: 0");
    });

    it("preserves bold formatting from <b>, <strong>, and inline font-weight styles (bold, 700, etc.)", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        // 1. Test <span style="font-weight: bold;"> produced by document.execCommand("bold")
        editor.innerHTML = '<p>Обычный <span style="font-weight: bold;">жирный</span> текст</p>';
        let delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual(expect.arrayContaining([
            { insert: "Обычный " },
            { insert: "жирный", attributes: { bold: true } },
            { insert: " текст" },
            { insert: "\n" },
        ]));

        // 2. Test <span style="font-weight: 700;"> (e.g. from pasted Word/Google Docs)
        editor.innerHTML = '<p>Начало <span style="font-weight: 700;">жирный 700</span> конец</p>';
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual(expect.arrayContaining([
            { insert: "Начало " },
            { insert: "жирный 700", attributes: { bold: true } },
            { insert: " конец" },
            { insert: "\n" },
        ]));

        // 3. Test <strong> and <b> tags
        editor.innerHTML = '<p><strong>Стронг</strong> и <b>тег б</b></p>';
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual(expect.arrayContaining([
            { insert: "Стронг", attributes: { bold: true } },
            { insert: " и " },
            { insert: "тег б", attributes: { bold: true } },
            { insert: "\n" },
        ]));

        // 4. Test roundtrip: render back to editor produces <strong>, which serializes back to bold delta
        renderTheoryDeltaToEditor(delta);
        expect(editor.innerHTML).toContain("<strong>Стронг</strong>");
        expect(editor.innerHTML).toContain("<strong>тег б</strong>");
        const roundtripDelta = editorHtmlToTheoryDelta();
        expect(roundtripDelta.ops).toEqual(delta.ops);
    });

    it("preserves italic, underline, strike, and color from inline styles through delta conversion", () => {
        const dom = setupTheoryEditorDom();
        const { editorHtmlToTheoryDelta } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        editor.innerHTML = '<p>' +
            '<span style="font-style: italic;">курсив</span> ' +
            '<span style="text-decoration: underline;">подчёркнутый</span> ' +
            '<span style="text-decoration: line-through;">зачёркнутый</span> ' +
            '<span style="color: #e11d48;">красный</span>' +
            '</p>';

        const delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual(expect.arrayContaining([
            { insert: "курсив", attributes: { italic: true } },
            { insert: " " },
            { insert: "подчёркнутый", attributes: { underline: true } },
            { insert: " " },
            { insert: "зачёркнутый", attributes: { strike: true } },
            { insert: " " },
            { insert: "красный", attributes: { color: expect.stringMatching(/(#e11d48|rgb\(225,\s*29,\s*72\))/) } },
            { insert: "\n" },
        ]));
    });

    it("toggles library sidebar and persists collapsed state in localStorage", () => {
        const dom = setupTheoryEditorDom();
        const { initTheorySidebarToggle } = dom.window.__theoryEditorTestExports;
        initTheorySidebarToggle();

        const grid = dom.window.document.getElementById("theory-main-grid");
        const panel = dom.window.document.getElementById("theory-library-panel");
        const toggleBtn = dom.window.document.getElementById("theory-sidebar-toggle-btn");

        expect(grid.classList.contains("sidebar-collapsed")).toBe(false);
        expect(panel.classList.contains("is-collapsed")).toBe(false);
        expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");

        // Click toggle to collapse
        toggleBtn.click();
        expect(grid.classList.contains("sidebar-collapsed")).toBe(true);
        expect(panel.classList.contains("is-collapsed")).toBe(true);
        expect(toggleBtn.getAttribute("aria-expanded")).toBe("false");
        expect(dom.window.localStorage.getItem("theorySidebarCollapsed")).toBe("true");

        // Click toggle to expand again
        toggleBtn.click();
        expect(grid.classList.contains("sidebar-collapsed")).toBe(false);
        expect(panel.classList.contains("is-collapsed")).toBe(false);
        expect(toggleBtn.getAttribute("aria-expanded")).toBe("true");
        expect(dom.window.localStorage.getItem("theorySidebarCollapsed")).toBe("false");
    });

    it("calculates live word and character statistics on content update", () => {
        const dom = setupTheoryEditorDom();
        const { updateTheoryStatsCounter } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");
        const counter = dom.window.document.getElementById("theory-stats-counter");

        editor.innerText = "Это короткий тестовый фрагмент теории";
        updateTheoryStatsCounter();
        expect(counter.textContent).toContain("5 слов");
        expect(counter.textContent).toContain("37 симв.");

        editor.innerText = "";
        updateTheoryStatsCounter();
        expect(counter.textContent).toBe("");
    });

    it("reflects active toolbar state with aria-pressed on text commands", () => {
        const dom = setupTheoryEditorDom();
        const { updateTheoryToolbarActiveStates } = dom.window.__theoryEditorTestExports;
        const boldBtn = dom.window.document.getElementById("theory-bold");
        const italicBtn = dom.window.document.getElementById("theory-italic");

        dom.window.document.queryCommandState = vi.fn((cmd) => cmd === "bold");
        dom.window.document.queryCommandValue = vi.fn(() => "");

        updateTheoryToolbarActiveStates();
        expect(boldBtn.getAttribute("aria-pressed")).toBe("true");
        expect(boldBtn.classList.contains("active")).toBe(true);
        expect(italicBtn.getAttribute("aria-pressed")).toBe("false");
        expect(italicBtn.classList.contains("active")).toBe(false);
    });
});
