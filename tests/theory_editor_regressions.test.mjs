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
                    <button id="theory-drafts-badge-btn" class="hidden">
                        <span id="theory-drafts-badge-count">0</span>
                    </button>
                    <div id="theory-library-count"></div>
                    <div id="theory-library-list"></div>
                </aside>
                <section class="theory-workspace-panel">
                    <div id="theory-draft-banner" hidden>
                        <span id="theory-draft-banner-meta"></span>
                        <button id="theory-draft-banner-registry-btn" hidden></button>
                        <button id="theory-draft-banner-preview-btn"></button>
                        <button id="theory-draft-banner-restore-btn"></button>
                        <button id="theory-draft-banner-delete-btn"></button>
                    </div>
                    <div id="theory-color-picker-host">
                        <button id="theory-color-btn" type="button"></button>
                        <div id="theory-color-palette"></div>
                    </div>
                    <span id="theory-color-indicator"></span>
                    <span id="theory-usage-note"></span>
                    <div id="theory-stats-counter"></div>
                    <input id="theory-title" />
                    <div id="theory-toolbar">
                        <button id="theory-undo" disabled></button>
                        <button id="theory-redo" disabled></button>
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
    theoryUndoManager,
    pushTheoryUndoState,
    performTheoryUndo,
    performTheoryRedo,
    updateTheoryUndoButtons,
    initTheoryUndoHistory,
    toggleTheoryHeading,
    toggleTheoryList,
    executeTheoryListCommand,
    handleTheoryEditorKeydown,
    bindTheoryToolbar,
    bindTheoryEditorEvents,
    readTheoryDraft,
    saveTheoryDraftNow,
    clearTheoryDraft,
    getTheoryDraftKey,
    getLegacyTheoryDraftKey,
    openTheoryDraftModal,
    restoreTheoryDraftIfPresent,
    showTheoryDraftBanner,
    hideTheoryDraftBanner,
    extractTheoryDeltaStats,
    renderTheoryDeltaToHtmlSnippet,
    listTheoryDrafts,
    clearAllTheoryDrafts,
    cleanupExpiredTheoryDrafts,
    openTheoryDraftsRegistryModal,
    updateTheoryDraftsBadge,
    sanitizeDeltaForDraftStorage,
    formatTheorySnapshotTime,
    clearTheoryDraftByKey,
    applyRestoredTheoryDraft,
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

    it("preserves spaces between a period and the start of a new sentence across various inline structures", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        // 1. Plain text with sentences
        editor.innerHTML = "<p>Первое предложение. Второе предложение. Третье предложение.</p>";
        let delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение. Второе предложение. Третье предложение." },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение. Третье предложение.");

        // 2. Sentences in separate spans (e.g. styled or pasted from Word)
        editor.innerHTML = "<p><span>Первое предложение. </span><span>Второе предложение.</span></p>";
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение. Второе предложение." },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение.");

        // 3. Space between spans
        editor.innerHTML = "<p><span>Первое предложение.</span> <span>Второе предложение.</span></p>";
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение. Второе предложение." },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение.");

        // 4. Formatted first sentence (bold) followed by normal second sentence
        editor.innerHTML = "<p><strong>Первое предложение.</strong> Второе предложение.</p>";
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение.", attributes: { bold: true } },
            { insert: " Второе предложение." },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение.");

        // 5. Formatted first sentence with trailing space inside strong
        editor.innerHTML = "<p><strong>Первое предложение. </strong>Второе предложение.</p>";
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение. ", attributes: { bold: true } },
            { insert: "Второе предложение." },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение.");

        // 6. Normal first sentence followed by formatted second sentence with leading space inside strong
        editor.innerHTML = "<p>Первое предложение.<strong> Второе предложение.</strong></p>";
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Первое предложение." },
            { insert: " Второе предложение.", attributes: { bold: true } },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toBe("Первое предложение. Второе предложение.");

        // 7. Multi-cycle roundtrip: save -> render -> save -> render
        const initialHtml = "<p><strong>Глава 1.</strong> Основные понятия. <em>Раздел 2.</em> Подробности.</p>";
        editor.innerHTML = initialHtml;
        const delta1 = editorHtmlToTheoryDelta();
        renderTheoryDeltaToEditor(delta1);
        const textAfterFirstReload = editor.textContent;
        expect(textAfterFirstReload).toBe("Глава 1. Основные понятия. Раздел 2. Подробности.");

        const delta2 = editorHtmlToTheoryDelta();
        renderTheoryDeltaToEditor(delta2);
        const textAfterSecondReload = editor.textContent;
        expect(textAfterSecondReload).toBe("Глава 1. Основные понятия. Раздел 2. Подробности.");
        expect(delta2.ops).toEqual(delta1.ops);
    });

    it("does not insert extra empty lines or trailing br breaks under heading styles", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
            cleanTheoryWordHtml,
        } = dom.window.__theoryEditorTestExports;
        const editor = dom.window.document.getElementById("theory-editor");

        // 1. Heading with browser trailing <br> placeholder
        editor.innerHTML = "<h1>Заголовок раздела<br></h1><p>Текст первого абзаца</p>";
        let delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Заголовок раздела" },
            { insert: "\n", attributes: { header: 1 } },
            { insert: "Текст первого абзаца" },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.innerHTML).toBe("<h1>Заголовок раздела</h1><p>Текст первого абзаца</p>");

        // 2. Multi-cycle roundtrip stability for headings (no phantom empty paragraphs or breaks)
        for (let i = 0; i < 3; i++) {
            delta = editorHtmlToTheoryDelta();
            renderTheoryDeltaToEditor(delta);
        }
        expect(editor.innerHTML).toBe("<h1>Заголовок раздела</h1><p>Текст первого абзаца</p>");
        expect(delta.ops).toEqual([
            { insert: "Заголовок раздела" },
            { insert: "\n", attributes: { header: 1 } },
            { insert: "Текст первого абзаца" },
            { insert: "\n" },
        ]);

        // 3. Word heading and post-heading empty spacing paragraph cleanup
        const wordHtml = `
            <p class="MsoHeading1"><span>Основной заголовок</span></p>
            <p class="MsoNormal"><span lang="RU">&nbsp;</span></p>
            <p class="MsoNormal"><span>Содержимое раздела</span></p>
        `;
        const cleaned = cleanTheoryWordHtml(wordHtml);
        editor.innerHTML = cleaned;
        delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Основной заголовок" },
            { insert: "\n", attributes: { header: 1 } },
            { insert: "Содержимое раздела" },
            { insert: "\n" },
        ]);
        renderTheoryDeltaToEditor(delta);
        expect(editor.innerHTML).toBe("<h1>Основной заголовок</h1><p>Содержимое раздела</p>");
    });

    it("includes undo/redo controls, script reference, and disabled button CSS in Theory_Editor.html", () => {
        expect(theoryEditorHtml).toContain('<script src="/editor/undo_manager.js"></script>');
        expect(theoryEditorHtml).toContain('id="theory-undo"');
        expect(theoryEditorHtml).toContain('id="theory-redo"');
        expect(theoryEditorHtml).toContain('data-i18n-title="the.k053"');
        expect(theoryEditorHtml).toContain('data-i18n-title="the.k054"');
        expect(theoryEditorHtml).toContain('.theory-toolbar-btn:disabled');
        expect(theoryEditorHtml).toContain('pointer-events: none;');
    });

    it("manages undo and redo snapshots, button states, and history truncation correctly", () => {
        const dom = setupTheoryEditorDom();
        const {
            initTheoryUndoHistory,
            pushTheoryUndoState,
            performTheoryUndo,
            performTheoryRedo,
        } = dom.window.__theoryEditorTestExports;

        const undoBtn = dom.window.document.getElementById("theory-undo");
        const redoBtn = dom.window.document.getElementById("theory-redo");
        const titleInput = dom.window.document.getElementById("theory-title");
        const editor = dom.window.document.getElementById("theory-editor");

        initTheoryUndoHistory();
        expect(undoBtn.disabled).toBe(true);
        expect(redoBtn.disabled).toBe(true);

        titleInput.value = "Теория V1";
        editor.innerHTML = "<p>Текст версии 1</p>";
        pushTheoryUndoState(true);

        titleInput.value = "Теория V2";
        editor.innerHTML = "<p>Текст версии 2</p>";
        pushTheoryUndoState(true);

        expect(undoBtn.disabled).toBe(false);
        expect(redoBtn.disabled).toBe(true);

        // Undo to V1
        const undoSuccess = performTheoryUndo();
        expect(undoSuccess).toBe(true);
        expect(titleInput.value).toBe("Теория V1");
        expect(editor.innerHTML).toBe("<p>Текст версии 1</p>");
        expect(undoBtn.disabled).toBe(false); // Can still undo back to initial empty state
        expect(redoBtn.disabled).toBe(false);

        // Undo to initial state
        const undoToRootSuccess = performTheoryUndo();
        expect(undoToRootSuccess).toBe(true);
        expect(undoBtn.disabled).toBe(true); // Now at root
        expect(redoBtn.disabled).toBe(false);

        // Redo to V1
        const redoToV1Success = performTheoryRedo();
        expect(redoToV1Success).toBe(true);
        expect(titleInput.value).toBe("Теория V1");
        expect(editor.innerHTML).toBe("<p>Текст версии 1</p>");
        expect(undoBtn.disabled).toBe(false);
        expect(redoBtn.disabled).toBe(false);

        // Redo to V2
        const redoSuccess = performTheoryRedo();
        expect(redoSuccess).toBe(true);
        expect(titleInput.value).toBe("Теория V2");
        expect(editor.innerHTML).toBe("<p>Текст версии 2</p>");
        expect(undoBtn.disabled).toBe(false);
        expect(redoBtn.disabled).toBe(true);

        // Undo and make a new branch to verify redo history truncation
        performTheoryUndo();
        expect(titleInput.value).toBe("Теория V1");
        expect(redoBtn.disabled).toBe(false);

        editor.innerHTML = "<p>Альтернативная ветка</p>";
        pushTheoryUndoState(true);
        expect(redoBtn.disabled).toBe(true);
        expect(undoBtn.disabled).toBe(false);
    });

    it("routes Ctrl+Z, Ctrl+Y, and Ctrl+Shift+Z globally but ignores them in library search", () => {
        const dom = setupTheoryEditorDom();
        const {
            initTheoryUndoHistory,
            pushTheoryUndoState,
            bindTheoryEditorEvents,
        } = dom.window.__theoryEditorTestExports;

        bindTheoryEditorEvents();
        const titleInput = dom.window.document.getElementById("theory-title");
        const editor = dom.window.document.getElementById("theory-editor");

        initTheoryUndoHistory();
        titleInput.value = "Исходное состояние";
        editor.innerHTML = "<p>Шаг 1</p>";
        pushTheoryUndoState(true);

        editor.innerHTML = "<p>Шаг 2</p>";
        pushTheoryUndoState(true);

        // Dispatch Ctrl+Z
        const undoEvent = new dom.window.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "z",
            ctrlKey: true,
        });
        dom.window.document.dispatchEvent(undoEvent);
        expect(editor.innerHTML).toBe("<p>Шаг 1</p>");

        // Dispatch Ctrl+Y
        const redoEvent = new dom.window.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "y",
            ctrlKey: true,
        });
        dom.window.document.dispatchEvent(redoEvent);
        expect(editor.innerHTML).toBe("<p>Шаг 2</p>");

        // Dispatch Ctrl+Shift+Z
        dom.window.document.dispatchEvent(undoEvent);
        expect(editor.innerHTML).toBe("<p>Шаг 1</p>");

        const redoShiftEvent = new dom.window.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "z",
            ctrlKey: true,
            shiftKey: true,
        });
        dom.window.document.dispatchEvent(redoShiftEvent);
        expect(editor.innerHTML).toBe("<p>Шаг 2</p>");

        // When focused in search input, Ctrl+Z should not affect editor
        const searchInput = dom.window.document.createElement("input");
        searchInput.id = "theory-library-search";
        dom.window.document.body.appendChild(searchInput);
        searchInput.focus();

        const searchUndoEvent = new dom.window.KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "z",
            ctrlKey: true,
        });
        dom.window.document.dispatchEvent(searchUndoEvent);
        expect(editor.innerHTML).toBe("<p>Шаг 2</p>");
    });

    it("executes list commands via execCommand and connects toolbar buttons", () => {
        const dom = setupTheoryEditorDom();
        const {
            toggleTheoryList,
            bindTheoryToolbar,
        } = dom.window.__theoryEditorTestExports;

        bindTheoryToolbar();
        const execSpy = dom.window.document.execCommand;

        toggleTheoryList("ul");
        expect(execSpy).toHaveBeenCalledWith("insertUnorderedList", false, null);

        toggleTheoryList("ol");
        expect(execSpy).toHaveBeenCalledWith("insertOrderedList", false, null);

        // Click toolbar button
        const ulBtn = dom.window.document.getElementById("theory-ul");
        ulBtn.click();
        expect(execSpy).toHaveBeenCalledWith("insertUnorderedList", false, null);

        const olBtn = dom.window.document.getElementById("theory-ol");
        olBtn.click();
        expect(execSpy).toHaveBeenCalledWith("insertOrderedList", false, null);
    });

    it("handles smart list navigation for Tab, Shift+Tab, Enter, and Backspace on empty items", () => {
        const dom = setupTheoryEditorDom();
        const {
            handleTheoryEditorKeydown,
        } = dom.window.__theoryEditorTestExports;

        const editor = dom.window.document.getElementById("theory-editor");
        const execSpy = dom.window.document.execCommand;

        // 1. Tab and Shift+Tab inside <li>
        editor.innerHTML = "<ul><li id='test-item'>Пункт списка</li></ul>";
        const liItem = dom.window.document.getElementById("test-item");

        dom.window.getSelection = () => ({
            rangeCount: 1,
            isCollapsed: true,
            getRangeAt: () => ({
                startContainer: liItem,
                collapsed: true,
            }),
        });

        let tabEvent = {
            key: "Tab",
            shiftKey: false,
            preventDefault: vi.fn(),
            defaultPrevented: false,
        };
        handleTheoryEditorKeydown(tabEvent);
        expect(tabEvent.preventDefault).toHaveBeenCalled();
        expect(execSpy).toHaveBeenCalledWith("indent", false, null);

        let shiftTabEvent = {
            key: "Tab",
            shiftKey: true,
            preventDefault: vi.fn(),
            defaultPrevented: false,
        };
        handleTheoryEditorKeydown(shiftTabEvent);
        expect(shiftTabEvent.preventDefault).toHaveBeenCalled();
        expect(execSpy).toHaveBeenCalledWith("outdent", false, null);

        // 2. Enter on empty <li> exits the list
        editor.innerHTML = "<ul><li id='empty-item'><br></li></ul>";
        const emptyLi = dom.window.document.getElementById("empty-item");
        dom.window.getSelection = () => ({
            rangeCount: 1,
            isCollapsed: true,
            getRangeAt: () => ({
                startContainer: emptyLi,
                collapsed: true,
            }),
        });

        let enterEvent = {
            key: "Enter",
            shiftKey: false,
            ctrlKey: false,
            metaKey: false,
            preventDefault: vi.fn(),
            defaultPrevented: false,
        };
        handleTheoryEditorKeydown(enterEvent);
        expect(enterEvent.preventDefault).toHaveBeenCalled();
        expect(execSpy).toHaveBeenCalledWith("insertUnorderedList", false, null);

        // 3. Backspace on empty <li> exits the list
        let backspaceEvent = {
            key: "Backspace",
            preventDefault: vi.fn(),
            defaultPrevented: false,
        };
        handleTheoryEditorKeydown(backspaceEvent);
        expect(backspaceEvent.preventDefault).toHaveBeenCalled();
        expect(execSpy).toHaveBeenCalledWith("insertUnorderedList", false, null);
    });

    it("prevents silent data loss in editorHtmlToTheoryDelta on nested and non-standard list structures", () => {
        const dom = setupTheoryEditorDom();
        const {
            editorHtmlToTheoryDelta,
            renderTheoryDeltaToEditor,
        } = dom.window.__theoryEditorTestExports;

        const editor = dom.window.document.getElementById("theory-editor");

        // Nested lists (e.g., from browser execCommand indent or pasted HTML)
        editor.innerHTML = `
            <ul>
                <li>Родитель 1
                    <ul>
                        <li>Подпункт 1.1</li>
                        <li>Подпункт 1.2</li>
                    </ul>
                </li>
                <li>Родитель 2</li>
            </ul>
        `;

        const delta = editorHtmlToTheoryDelta();
        expect(delta.ops).toEqual([
            { insert: "Родитель 1" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "Подпункт 1.1" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "Подпункт 1.2" },
            { insert: "\n", attributes: { list: "bullet" } },
            { insert: "Родитель 2" },
            { insert: "\n", attributes: { list: "bullet" } },
        ]);

        // Roundtrip back to editor
        renderTheoryDeltaToEditor(delta);
        expect(editor.textContent).toContain("Родитель 1");
        expect(editor.textContent).toContain("Подпункт 1.1");
        expect(editor.textContent).toContain("Подпункт 1.2");
        expect(editor.textContent).toContain("Родитель 2");

        // Non-li direct children inside list are also preserved instead of dropped
        editor.innerHTML = `
            <ul>
                <p>Текст внутри списка</p>
                <li>Элемент списка</li>
            </ul>
        `;
        const nonLiDelta = editorHtmlToTheoryDelta();
        const texts = nonLiDelta.ops.filter((op) => typeof op.insert === "string" && op.insert !== "\n").map((op) => op.insert);
        expect(texts).toContain("Текст внутри списка");
        expect(texts).toContain("Элемент списка");
    });

    it("toggles headings back to paragraph when clicked again", () => {
        const dom = setupTheoryEditorDom();
        const {
            toggleTheoryHeading,
        } = dom.window.__theoryEditorTestExports;

        const execSpy = dom.window.document.execCommand;

        // 1. When formatBlock is currently h1, clicking h1 toggles back to <p>
        dom.window.document.queryCommandValue = vi.fn((cmd) => cmd === "formatBlock" ? "h1" : "");
        toggleTheoryHeading(1);
        expect(execSpy).toHaveBeenCalledWith("formatBlock", false, "<p>");

        // 2. When formatBlock is p, clicking h1 changes to <h1>
        dom.window.document.queryCommandValue = vi.fn((cmd) => cmd === "formatBlock" ? "p" : "");
        toggleTheoryHeading(1);
        expect(execSpy).toHaveBeenCalledWith("formatBlock", false, "<h1>");

        // 3. When formatBlock is h2, clicking h2 toggles back to <p>
        dom.window.document.queryCommandValue = vi.fn((cmd) => cmd === "formatBlock" ? "h2" : "");
        toggleTheoryHeading(2);
        expect(execSpy).toHaveBeenCalledWith("formatBlock", false, "<p>");
    });

    it("cleanTheoryWordHtml preserves img src and anchor href attributes while stripping Word bloat", () => {
        const dom = setupTheoryEditorDom();
        const {
            cleanTheoryWordHtml,
        } = dom.window.__theoryEditorTestExports;

        const sampleWordHtml = `
            <p class="MsoNormal" style="margin-left:0cm;text-indent:0cm">
                <span lang="RU">Текст с картинкой: </span>
                <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" alt="Диаграмма" style="width:200px">
                <a href="https://example.com/handbook">Справочник</a>
                <o:p></o:p>
            </p>
        `;

        const cleaned = cleanTheoryWordHtml(sampleWordHtml);
        expect(cleaned).toContain('src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="');
        expect(cleaned).toContain('href="https://example.com/handbook"');
        expect(cleaned).toContain("Справочник");
        expect(cleaned).not.toContain("o:p");
        expect(cleaned).not.toContain("MsoNormal");
    });

    it("verifies redesigned topbar in Theory_Editor.html conforms to flat studio design without card-elevated", () => {
        const dom = new JSDOM(theoryEditorHtml);
        const header = dom.window.document.getElementById("theory-editor-header");
        expect(header).toBeTruthy();
        expect(header.classList.contains("theory-topbar")).toBe(true);
        expect(header.classList.contains("card-elevated")).toBe(false);
        expect(header.getAttribute("data-onboarding-target")).toBe("theory-editor-header");

        // Essential controls and onboarding elements must remain intact
        expect(dom.window.document.getElementById("theory-back-btn")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-back-btn-label")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-context-copy")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-sidebar-toggle-btn")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-publish-btn")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-open-center-btn")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-open-complexes-btn")).toBeTruthy();
        expect(dom.window.document.getElementById("theory-new-btn")).toBeTruthy();

        const saveBtn = dom.window.document.getElementById("theory-save-btn");
        expect(saveBtn).toBeTruthy();
        expect(saveBtn.classList.contains("btn-primary")).toBe(true);
        expect(saveBtn.getAttribute("data-onboarding-target")).toBe("theory-editor-save-action");

        // Banner container must be present in HTML
        const banner = dom.window.document.getElementById("theory-draft-banner");
        expect(banner).toBeTruthy();
        expect(banner.hidden).toBe(true);
    });

    it("saves draft to localStorage with metadata (words, chars, images, preview)", () => {
        const dom = setupTheoryEditorDom();
        const {
            theoryEditorState,
            saveTheoryDraftNow,
            readTheoryDraft,
        } = dom.window.__theoryEditorTestExports;

        const titleEl = dom.window.document.getElementById("theory-title");
        const editorEl = dom.window.document.getElementById("theory-editor");

        titleEl.value = "Квантовая оптика";
        editorEl.innerHTML = "<p>Фотон переносит энергию пропорционально частоте излучения.</p>";
        theoryEditorState.dirty = true;

        saveTheoryDraftNow();

        const draft = readTheoryDraft("");
        expect(draft).toBeTruthy();
        expect(draft.title).toBe("Квантовая оптика");
        expect(draft.delta).toBeTruthy();
        expect(draft.wordCount).toBeGreaterThan(0);
        expect(draft.charCount).toBeGreaterThan(0);
        expect(draft.previewText).toContain("Фотон переносит энергию");

        // Check it exists in localStorage
        const rawLs = dom.window.localStorage.getItem(draft.key);
        expect(rawLs).toBeTruthy();
        expect(rawLs).toContain("Квантовая оптика");
    });

    it("readTheoryDraft seamlessly migrates legacy draft keys from localStorage or sessionStorage", () => {
        const dom = setupTheoryEditorDom();
        const {
            readTheoryDraft,
            getLegacyTheoryDraftKey,
        } = dom.window.__theoryEditorTestExports;

        const legacyKey = getLegacyTheoryDraftKey("");
        const legacyPayload = {
            title: "Устаревший черновик",
            delta: { ops: [{ insert: "Текст из старой сессии\n" }] },
            savedAt: new Date().toISOString(),
        };

        dom.window.sessionStorage.setItem(legacyKey, JSON.stringify(legacyPayload));

        const draft = readTheoryDraft("");
        expect(draft).toBeTruthy();
        expect(draft.title).toBe("Устаревший черновик");
        expect(draft.previewText).toContain("Текст из старой сессии");
    });

    it("openTheoryDraftModal renders live content preview and statistics comparison", async () => {
        const dom = setupTheoryEditorDom();
        const {
            openTheoryDraftModal,
        } = dom.window.__theoryEditorTestExports;

        const draft = {
            title: "Черновик теории волн",
            delta: {
                ops: [
                    { insert: "Введение в волновую теорию\n", attributes: { header: 1 } },
                    { insert: "Длина волны связана с частотой.\n" },
                ],
            },
            savedAt: new Date().toISOString(),
            wordCount: 8,
            charCount: 56,
            imageCount: 0,
            previewText: "Введение в волновую теорию",
        };

        const modalPromise = openTheoryDraftModal(draft, "");
        const modalEl = dom.window.document.getElementById("theory-draft-modal");
        expect(modalEl).toBeTruthy();

        // Check preview content rendered
        const previewBox = dom.window.document.getElementById("theory-draft-preview-box");
        expect(previewBox).toBeTruthy();
        expect(previewBox.innerHTML).toContain("Введение в волновую теорию");
        expect(previewBox.innerHTML).toContain("Длина волны связана с частотой");

        // Check 3 explicit actions exist
        const restoreBtn = dom.window.document.getElementById("theory-draft-restore-btn");
        const deferBtn = dom.window.document.getElementById("theory-draft-defer-btn");
        const deleteBtn = dom.window.document.getElementById("theory-draft-delete-btn");

        expect(restoreBtn).toBeTruthy();
        expect(deferBtn).toBeTruthy();
        expect(deleteBtn).toBeTruthy();

        // Deferring must not delete the draft and must resolve with 'deferred'
        deferBtn.click();
        const outcome = await modalPromise;
        expect(outcome).toBe("deferred");
        expect(dom.window.document.getElementById("theory-draft-modal")).toBeNull();

        // Banner must be visible
        const banner = dom.window.document.getElementById("theory-draft-banner");
        expect(banner.hidden).toBe(false);
    });

    it("restores draft into editor and updates dirty flag on user confirmation", async () => {
        const dom = setupTheoryEditorDom();
        const {
            theoryEditorState,
            openTheoryDraftModal,
        } = dom.window.__theoryEditorTestExports;

        const draft = {
            title: "Восстановленная теория",
            delta: {
                ops: [
                    { insert: "Содержимое восстановлено успешно!\n" },
                ],
            },
            savedAt: new Date().toISOString(),
            wordCount: 3,
            charCount: 34,
            imageCount: 0,
            previewText: "Содержимое восстановлено успешно!",
        };

        const modalPromise = openTheoryDraftModal(draft, "");
        const restoreBtn = dom.window.document.getElementById("theory-draft-restore-btn");
        restoreBtn.click();

        const outcome = await modalPromise;
        expect(outcome).toBe("restored");
        expect(theoryEditorState.dirty).toBe(true);

        const titleEl = dom.window.document.getElementById("theory-title");
        expect(titleEl.value).toBe("Восстановленная теория");

        const editorEl = dom.window.document.getElementById("theory-editor");
        expect(editorEl.innerHTML).toContain("Содержимое восстановлено успешно!");
    });

    it("maintains up to 5 rolling snapshots and debounces rapid saves within 45 seconds", () => {
        const dom = setupTheoryEditorDom();
        const {
            theoryEditorState,
            saveTheoryDraftNow,
            readTheoryDraft,
            getTheoryDraftKey,
        } = dom.window.__theoryEditorTestExports;

        const titleEl = dom.window.document.getElementById("theory-title");
        const editorEl = dom.window.document.getElementById("theory-editor");
        titleEl.value = "Квантовая механика";
        editorEl.innerHTML = "<p>Уравнение Шрёдингера</p>";
        theoryEditorState.dirty = true;

        // 1st save
        saveTheoryDraftNow();
        let draft = readTheoryDraft("");
        expect(draft).toBeTruthy();
        expect(draft.snapshots.length).toBe(1);
        expect(draft.snapshots[0].title).toBe("Квантовая механика");
        expect(draft.snapshots[0].previewText).toContain("Уравнение Шрёдингера");

        // 2nd save within same minute (debounce in-place update)
        editorEl.innerHTML = "<p>Уравнение Шрёдингера и волновая функция</p>";
        saveTheoryDraftNow();
        draft = readTheoryDraft("");
        expect(draft.snapshots.length).toBe(1);
        expect(draft.snapshots[0].previewText).toContain("волновая функция");

        // Manually simulate checkpoints by pushing snapshots with older timestamps
        const key = getTheoryDraftKey("");
        const raw = JSON.parse(dom.window.localStorage.getItem(key));
        const olderSnapshots = [];
        for (let i = 1; i <= 6; i++) {
            olderSnapshots.push({
                id: `snap_old_${i}`,
                title: `Старая версия ${i}`,
                delta: { ops: [{ insert: `Текст версии ${i}\n` }] },
                savedAt: new Date(Date.now() - (i + 1) * 60000).toISOString(),
                wordCount: 10 + i,
                charCount: 50 + i,
                imageCount: 0,
                previewText: `Текст версии ${i}`,
            });
        }
        // Place one top snapshot that is older than 45s so next save generates new checkpoint
        raw.snapshots = [
            {
                id: "snap_recent",
                title: "Предшествующий снимок",
                delta: { ops: [{ insert: "Предшествующий снимок\n" }] },
                savedAt: new Date(Date.now() - 50000).toISOString(),
                wordCount: 5,
                charCount: 30,
                imageCount: 0,
                previewText: "Предшествующий снимок",
            },
            ...olderSnapshots,
        ];
        dom.window.localStorage.setItem(key, JSON.stringify(raw));

        // Save new content now -> must prepend new snapshot and cap total at 5
        editorEl.innerHTML = "<p>Финальная редакция квантовой механики</p>";
        saveTheoryDraftNow();
        draft = readTheoryDraft("");
        expect(draft.snapshots.length).toBe(5);
        expect(draft.snapshots[0].previewText).toContain("Финальная редакция");
        expect(draft.snapshots[1].previewText).toContain("Предшествующий снимок");
    });

    it("openTheoryDraftModal allows selecting and restoring a historical snapshot", async () => {
        const dom = setupTheoryEditorDom();
        const {
            theoryEditorState,
            openTheoryDraftModal,
        } = dom.window.__theoryEditorTestExports;

        const draft = {
            title: "Оптика",
            key: "theory_editor_draft_v2:new:standalone::::",
            savedAt: new Date().toISOString(),
            snapshots: [
                {
                    id: "snap_1",
                    title: "Оптика — Черновик 2",
                    delta: { ops: [{ insert: "Вторая версия: дифракция и интерференция\n" }] },
                    savedAt: new Date().toISOString(),
                    wordCount: 5,
                    charCount: 42,
                    imageCount: 0,
                    previewText: "Вторая версия: дифракция и интерференция",
                },
                {
                    id: "snap_0",
                    title: "Оптика — Черновик 1 (Начальный)",
                    delta: { ops: [{ insert: "Первая версия: геометрическая оптика\n" }] },
                    savedAt: new Date(Date.now() - 120000).toISOString(),
                    wordCount: 4,
                    charCount: 36,
                    imageCount: 0,
                    previewText: "Первая версия: геометрическая оптика",
                },
            ],
        };

        const modalPromise = openTheoryDraftModal(draft, "");
        const modalEl = dom.window.document.getElementById("theory-draft-modal");
        expect(modalEl).toBeTruthy();

        // Checkpoint pills rendered
        const pills = modalEl.querySelectorAll(".theory-snapshot-pill");
        expect(pills.length).toBe(2);
        expect(pills[0].classList.contains("is-active")).toBe(true);

        const previewBox = dom.window.document.getElementById("theory-draft-preview-box");
        expect(previewBox.textContent).toContain("Вторая версия");

        // Switch to checkpoint 1 (the older one)
        pills[1].click();
        expect(pills[1].classList.contains("is-active")).toBe(true);
        expect(pills[0].classList.contains("is-active")).toBe(false);
        expect(previewBox.textContent).toContain("Первая версия: геометрическая оптика");

        // Restore selected snapshot
        const restoreBtn = dom.window.document.getElementById("theory-draft-restore-btn");
        restoreBtn.click();
        const outcome = await modalPromise;

        expect(outcome).toBe("restored");
        expect(theoryEditorState.dirty).toBe(true);
        const editorEl = dom.window.document.getElementById("theory-editor");
        expect(editorEl.innerHTML).toContain("Первая версия: геометрическая оптика");
    });

    it("listTheoryDrafts aggregates drafts with accurate scope context and sorting", () => {
        const dom = setupTheoryEditorDom();
        const {
            listTheoryDrafts,
        } = dom.window.__theoryEditorTestExports;

        // Draft 1: Standalone
        const key1 = "theory_editor_draft_v2:new:standalone::::";
        dom.window.localStorage.setItem(key1, JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Автономный черновик",
                delta: { ops: [{ insert: "Текст 1\n" }] },
                savedAt: new Date(Date.now() - 10000).toISOString(),
                wordCount: 2,
                charCount: 8,
                imageCount: 0,
                previewText: "Текст 1",
            }],
        }));

        // Draft 2: Bound to course topic
        const key2 = "theory_editor_draft_v2:new:topic:mod_1:top_2:comp_3";
        dom.window.localStorage.setItem(key2, JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Черновик темы курса",
                delta: { ops: [{ insert: "Текст темы курса\n" }] },
                savedAt: new Date(Date.now()).toISOString(),
                wordCount: 3,
                charCount: 16,
                imageCount: 0,
                previewText: "Текст темы курса",
            }],
        }));

        // Draft 3: Bound to existing theory id
        const key3 = "theory_editor_draft_v2:theory:th_abc123";
        dom.window.localStorage.setItem(key3, JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Черновик существующей теории",
                delta: { ops: [{ insert: "Текст правки\n" }] },
                savedAt: new Date(Date.now() - 30000).toISOString(),
                wordCount: 2,
                charCount: 12,
                imageCount: 0,
                previewText: "Текст правки",
            }],
        }));

        const drafts = listTheoryDrafts();
        expect(drafts.length).toBe(3);

        // Sorted newest first: Draft 2 (now) -> Draft 1 (-10s) -> Draft 3 (-30s)
        expect(drafts[0].title).toBe("Черновик темы курса");
        expect(drafts[0].contextType).toBe("bound_course");

        expect(drafts[1].title).toBe("Автономный черновик");
        expect(drafts[1].contextType).toBe("standalone");

        expect(drafts[2].title).toBe("Черновик существующей теории");
        expect(drafts[2].contextType).toBe("bound_theory");
        expect(drafts[2].theoryId).toBe("th_abc123");
    });

    it("sanitizes large base64 image data URIs to protect local storage quota", () => {
        const dom = setupTheoryEditorDom();
        const {
            sanitizeDeltaForDraftStorage,
        } = dom.window.__theoryEditorTestExports;

        const hugeBase64 = "data:image/png;base64," + "A".repeat(2048);
        const normalUrl = "/api/theory/images/img_123.webp";

        const delta = {
            ops: [
                { insert: "Изображение 1: " },
                { insert: { image: hugeBase64 } },
                { insert: "\nИзображение 2: " },
                { insert: { image: normalUrl } },
                { insert: "\n" },
            ],
        };

        const sanitized = sanitizeDeltaForDraftStorage(delta);
        expect(sanitized.ops[1].insert.image).not.toContain("AAAA");
        expect(sanitized.ops[1].insert.image).toContain("svg");
        expect(sanitized.ops[3].insert.image).toBe(normalUrl);
    });

    it("cleanupExpiredTheoryDrafts purges records older than TTL", () => {
        const dom = setupTheoryEditorDom();
        const {
            cleanupExpiredTheoryDrafts,
            listTheoryDrafts,
        } = dom.window.__theoryEditorTestExports;

        // Fresh draft: 2 days old
        dom.window.localStorage.setItem("theory_editor_draft_v2:new:fresh::::", JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Свежий черновик",
                delta: { ops: [{ insert: "Свежий\n" }] },
                savedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
            }],
        }));

        // Expired draft: 20 days old (> 14 days)
        dom.window.localStorage.setItem("theory_editor_draft_v2:new:old::::", JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Старый черновик",
                delta: { ops: [{ insert: "Старый\n" }] },
                savedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
            }],
        }));

        expect(listTheoryDrafts().length).toBe(2);

        const cleanedCount = cleanupExpiredTheoryDrafts(14);
        expect(cleanedCount).toBe(1);

        const remaining = listTheoryDrafts();
        expect(remaining.length).toBe(1);
        expect(remaining[0].title).toBe("Свежий черновик");
    });

    it("updateTheoryDraftsBadge and clearAllTheoryDrafts manage UI indicators and bulk deletion", () => {
        const dom = setupTheoryEditorDom();
        const {
            updateTheoryDraftsBadge,
            clearAllTheoryDrafts,
            listTheoryDrafts,
        } = dom.window.__theoryEditorTestExports;

        const badgeBtn = dom.window.document.getElementById("theory-drafts-badge-btn");
        const badgeCount = dom.window.document.getElementById("theory-drafts-badge-count");
        const registryBtn = dom.window.document.getElementById("theory-draft-banner-registry-btn");

        // Initially no drafts
        updateTheoryDraftsBadge();
        expect(badgeBtn.classList.contains("hidden")).toBe(true);

        // Add 2 drafts
        dom.window.localStorage.setItem("theory_editor_draft_v2:new:first::::", JSON.stringify({
            version: 2,
            snapshots: [{ title: "Черновик 1", savedAt: new Date().toISOString() }],
        }));
        dom.window.localStorage.setItem("theory_editor_draft_v2:new:second::::", JSON.stringify({
            version: 2,
            snapshots: [{ title: "Черновик 2", savedAt: new Date().toISOString() }],
        }));

        updateTheoryDraftsBadge();
        expect(badgeBtn.classList.contains("hidden")).toBe(false);
        expect(badgeCount.textContent).toBe("2");
        expect(registryBtn.hidden).toBe(false);

        // Clear all drafts
        clearAllTheoryDrafts();
        expect(listTheoryDrafts().length).toBe(0);
        expect(badgeBtn.classList.contains("hidden")).toBe(true);
        expect(badgeCount.textContent).toBe("0");
    });

    it("clicking 'Открыть в редакторе' in registry restores draft directly into editor with no intermediate modal", async () => {
        const dom = setupTheoryEditorDom();
        const {
            openTheoryDraftsRegistryModal,
            listTheoryDrafts,
            getTheoryDraftKey,
        } = dom.window.__theoryEditorTestExports;

        const currentKey = getTheoryDraftKey();
        dom.window.localStorage.setItem(currentKey, JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Черновик из реестра",
                delta: { ops: [{ insert: "Восстановленный текст\n" }] },
                savedAt: new Date().toISOString(),
                wordCount: 2,
                charCount: 20,
                imageCount: 0,
            }],
        }));

        expect(listTheoryDrafts().length).toBe(1);

        openTheoryDraftsRegistryModal();
        const registryModal = dom.window.document.getElementById("theory-drafts-registry-modal");
        expect(registryModal).toBeTruthy();

        const openBtn = registryModal.querySelector(".theory-registry-open-btn");
        expect(openBtn).toBeTruthy();

        await openBtn.click();

        // Registry modal should be closed
        expect(dom.window.document.getElementById("theory-drafts-registry-modal")).toBeNull();
        // Intermediate prompt modal should NOT have been opened
        expect(dom.window.document.getElementById("theory-draft-modal")).toBeNull();

        // Content must be restored directly into the editor
        const titleInput = dom.window.document.getElementById("theory-title");
        const editorDiv = dom.window.document.getElementById("theory-editor");
        expect(titleInput.value).toBe("Черновик из реестра");
        expect(editorDiv.textContent).toContain("Восстановленный текст");
    });

    it("legacy key theory-editor-draft: is pruned and migrated to v2 without duplicate cards in listTheoryDrafts()", () => {
        const dom = setupTheoryEditorDom();
        const { listTheoryDrafts } = dom.window.__theoryEditorTestExports;

        // Populate both legacy key and v2 key for the same theory scope
        dom.window.localStorage.setItem("theory-editor-draft:theory:42", JSON.stringify({
            title: "Устаревший ключ",
            delta: { ops: [{ insert: "Старый текст\n" }] },
            savedAt: "2026-03-01T10:00:00.000Z",
        }));
        dom.window.localStorage.setItem("theory_editor_draft_v2:theory:42", JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Новый ключ v2",
                delta: { ops: [{ insert: "Новый текст v2\n" }] },
                savedAt: "2026-03-02T10:00:00.000Z",
            }],
        }));
        dom.window.sessionStorage.setItem("theory-editor-draft:theory:42", JSON.stringify({
            title: "Копия в сессии",
            delta: { ops: [{ insert: "Сессионный текст\n" }] },
            savedAt: "2026-03-01T10:00:00.000Z",
        }));

        const drafts = listTheoryDrafts();

        // Must strictly deduplicate by scope -> exactly 1 draft returned!
        expect(drafts.length).toBe(1);
        expect(drafts[0].scopeId).toBe("theory:42");
        expect(drafts[0].title).toBe("Новый ключ v2");

        // Legacy keys must be pruned from both localStorage and sessionStorage
        expect(dom.window.localStorage.getItem("theory-editor-draft:theory:42")).toBeNull();
        expect(dom.window.sessionStorage.getItem("theory-editor-draft:theory:42")).toBeNull();

        // v2 key remains in localStorage
        expect(dom.window.localStorage.getItem("theory_editor_draft_v2:theory:42")).toBeTruthy();
    });

    it("cross-theory navigation with auto-restore flag bypasses prompt modal and directly applies draft", async () => {
        const dom = setupTheoryEditorDom("http://localhost/editor/Theory_Editor.html?theory_id=99&restore_draft=1");
        dom.window.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, item: { id: "99", title: "Теория 99", delta: { ops: [{ insert: "Старое\n" }] } } }),
        });
        const {
            restoreTheoryDraftIfPresent,
            theoryEditorState,
        } = dom.window.__theoryEditorTestExports;

        theoryEditorState.activeTheoryId = "99";
        dom.window.localStorage.setItem("theory_editor_draft_v2:theory:99", JSON.stringify({
            version: 2,
            snapshots: [{
                title: "Авто-восстановленная теория 99",
                delta: { ops: [{ insert: "Тело теории 99\n" }] },
                savedAt: new Date().toISOString(),
            }],
        }));

        const restored = await restoreTheoryDraftIfPresent("99");
        expect(restored).toBe(true);

        // Prompt modal must NOT be created
        expect(dom.window.document.getElementById("theory-draft-modal")).toBeNull();

        // Editor must have draft content
        const titleInput = dom.window.document.getElementById("theory-title");
        expect(titleInput.value).toBe("Авто-восстановленная теория 99");

        // Flag in URL should be stripped
        expect(dom.window.location.search).not.toContain("restore_draft=1");
    });

    it("closing or deferring openTheoryDraftModal does not spawn duplicate drafts in storage or registry", async () => {
        const dom = setupTheoryEditorDom();
        const {
            openTheoryDraftModal,
            listTheoryDrafts,
        } = dom.window.__theoryEditorTestExports;

        const draft = {
            key: "theory_editor_draft_v2:new:standalone::::",
            version: 2,
            theoryId: "",
            scopeId: "new:standalone::::",
            title: "Единый черновик",
            delta: { ops: [{ insert: "Единое тело\n" }] },
            savedAt: new Date().toISOString(),
            snapshots: [{
                title: "Единый черновик",
                delta: { ops: [{ insert: "Единое тело\n" }] },
                savedAt: new Date().toISOString(),
            }],
        };
        dom.window.localStorage.setItem("theory_editor_draft_v2:new:standalone::::", JSON.stringify(draft));

        expect(listTheoryDrafts().length).toBe(1);

        // Open recovery modal
        const modalPromise = openTheoryDraftModal(draft, "");
        const modalEl = dom.window.document.getElementById("theory-draft-modal");
        expect(modalEl).toBeTruthy();

        // User closes modal via [X]
        const closeBtn = dom.window.document.getElementById("theory-draft-modal-close-btn");
        expect(closeBtn).toBeTruthy();
        closeBtn.click();

        const outcome = await modalPromise;
        expect(outcome).toBe("deferred");

        // Modal closed
        expect(dom.window.document.getElementById("theory-draft-modal")).toBeNull();

        // Drafts registry must STILL contain exactly 1 draft, NO duplicate card!
        const draftsAfter = listTheoryDrafts();
        expect(draftsAfter.length).toBe(1);
        expect(draftsAfter[0].title).toBe("Единый черновик");
    });

    it("clearTheoryDraftByKey purges both v2 and legacy keys across localStorage and sessionStorage", () => {
        const dom = setupTheoryEditorDom();
        const {
            clearTheoryDraftByKey,
            listTheoryDrafts,
        } = dom.window.__theoryEditorTestExports;

        dom.window.localStorage.setItem("theory_editor_draft_v2:theory:50", JSON.stringify({ version: 2, snapshots: [{ title: "T50" }] }));
        dom.window.localStorage.setItem("theory-editor-draft:theory:50", JSON.stringify({ title: "T50-legacy" }));
        dom.window.sessionStorage.setItem("theory_editor_draft_v2:theory:50", JSON.stringify({ version: 2, snapshots: [{ title: "T50-session" }] }));
        dom.window.sessionStorage.setItem("theory-editor-draft:theory:50", JSON.stringify({ title: "T50-legacy-session" }));

        clearTheoryDraftByKey("theory_editor_draft_v2:theory:50");

        expect(dom.window.localStorage.getItem("theory_editor_draft_v2:theory:50")).toBeNull();
        expect(dom.window.localStorage.getItem("theory-editor-draft:theory:50")).toBeNull();
        expect(dom.window.sessionStorage.getItem("theory_editor_draft_v2:theory:50")).toBeNull();
        expect(dom.window.sessionStorage.getItem("theory-editor-draft:theory:50")).toBeNull();
        expect(listTheoryDrafts().length).toBe(0);
    });
});


