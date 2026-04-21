import { afterEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const theoryCenterSource = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/theory_center.js"),
    "utf8",
);

const theoryCenterHtml = fs.readFileSync(
    path.resolve(process.cwd(), "frontend/Editor/Theory_Center.html"),
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

function setupTheoryCenterDom(url = "http://localhost/ui/editor/Theory_Center.html") {
    const dom = new JSDOM(
        `<!DOCTYPE html><html><body>
            <button id="theory-center-summary-toggle" type="button"></button>
            <span id="theory-center-summary-toggle-icon"></span>
            <span id="theory-center-summary-toggle-label"></span>
            <div id="theory-center-summary-wrap" data-collapsed="0"></div>
            <div id="theory-center-summary"></div>
            <input id="theory-center-search" />
            <button id="theory-center-scope-all" data-scope="all"></button>
            <button id="theory-center-scope-topics" data-scope="topics"></button>
            <button id="theory-center-scope-complexes" data-scope="complexes"></button>
            <button id="theory-center-scope-orphans" data-scope="orphans"></button>
            <button id="theory-center-scope-only-title" data-scope="only_title"></button>
            <span id="theory-center-selection-toggle-wrap"></span>
            <button id="theory-center-selection-toggle" data-active="0"></button>
            <span id="theory-center-selection-toggle-icon"></span>
            <span id="theory-center-selection-toggle-label"></span>
            <select id="theory-center-module-filter"></select>
            <select id="theory-center-state-filter"></select>
            <h2 id="theory-center-list-title"></h2>
            <p id="theory-center-list-subtitle"></p>
            <p id="theory-center-result-summary"></p>
            <div id="theory-center-list"></div>
            <div id="theory-center-flash"></div>
            <div id="theory-center-bulk-bar" class="hidden"></div>
            <div id="theory-center-selection-counter"></div>
            <div id="theory-center-selection-note"></div>
            <button id="theory-center-selection-select-visible" type="button"></button>
            <button id="theory-center-selection-delete" type="button"></button>
            <button id="theory-center-selection-cancel" type="button"></button>
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
        json: async () => ({ ok: true, summary: {}, filters: { modules: [], topic_states: [], complex_states: [] }, topics: [], complexes: [], orphans: [], theories: [], linked_theories: [], entries: [], authenticated: false }),
    });
    dom.window.confirm = vi.fn(() => true);
    dom.window.NotificationUI = {
        confirm: vi.fn().mockResolvedValue(true),
        toast: vi.fn(() => ({ dismiss: vi.fn() })),
    };
    dom.window.__THEORY_CENTER_ENABLE_TEST_HOOKS__ = true;
    dom.window.__THEORY_CENTER_AUTO_INIT_DISABLED__ = true;

    dom.window.eval(theoryCenterSource);
    return dom;
}

describe("Theory center regressions", () => {
    afterEach(() => {
        vi.useRealTimers();
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

    it("ships updated center markup without refresh and with all-scope toggle UI", () => {
        const dom = new JSDOM(theoryCenterHtml);
        const document = dom.window.document;

        expect(document.getElementById("theory-center-refresh")).toBeNull();
        expect(document.getElementById("theory-center-scope-all")).not.toBeNull();
        expect(document.getElementById("theory-center-scope-only-title")).not.toBeNull();
        expect(document.getElementById("theory-center-summary-toggle")).not.toBeNull();
        expect(document.getElementById("theory-center-selection-toggle")).not.toBeNull();
        expect(document.getElementById("theory-center-selection-toggle-wrap")).not.toBeNull();
        expect(document.getElementById("theory-center-bulk-bar")).not.toBeNull();
        expect(theoryCenterHtml).toContain("theory-summary-wrap");
        expect(theoryCenterHtml).toContain(".theory-bulk-bar.hidden");
        expect(theoryCenterHtml).toContain(".theory-center-header > .min-w-0 > .inline-flex:first-child");
        expect(theoryCenterHtml).toContain("data-page-transition-root");
        expect(theoryCenterHtml).toContain("Теории: Все");
        expect(theoryCenterHtml).toContain("Теории: Без привязки");
        expect(theoryCenterHtml).toContain("Теории: Только заголовок");
    });

    it("avoids redundant tooltip-only copies on visible theory state badges", () => {
        expect(theoryCenterSource).not.toContain('title="В теории нет изображений"');
        expect(theoryCenterSource).not.toContain('title="В теории только заголовок"');
        expect(theoryCenterSource).not.toContain('title="В теории только заголовок без текста"');
    });

    it("reads scope=all from the query string", () => {
        const dom = setupTheoryCenterDom("http://localhost/ui/editor/Theory_Center.html?scope=all&q=atlas");
        const { state, readQueryState } = dom.window.__theoryCenterTestExports;

        readQueryState();

        expect(state.scope).toBe("all");
        expect(state.search).toBe("atlas");
    });

    it("hides default all-modules captions in summary cards", () => {
        const dom = setupTheoryCenterDom();
        const { state, renderSummaryCards } = dom.window.__theoryCenterTestExports;
        state.overview = {
            summary: {
                topics_without_theory: 2,
                complexes_single_theory: 1,
                complexes_composite_theory: 3,
                complexes_override_theory: 4,
                complexes_without_theory: 5,
                orphan_theories: 6,
            },
            filters: {
                modules: [{ id: "m1", name: "Модуль 1" }],
            },
        };

        state.moduleId = "all";
        renderSummaryCards();
        expect(dom.window.document.getElementById("theory-center-summary").textContent).not.toContain("по всем модулям");

        state.moduleId = "m1";
        renderSummaryCards();
        expect(dom.window.document.getElementById("theory-center-summary").textContent).toContain("Модуль 1");
    });

    it("persists summary collapse state in localStorage", () => {
        const dom = setupTheoryCenterDom();
        const { state, applySummaryCollapsedState, toggleSummaryCollapsed } = dom.window.__theoryCenterTestExports;
        const wrap = dom.window.document.getElementById("theory-center-summary-wrap");
        const label = dom.window.document.getElementById("theory-center-summary-toggle-label");

        state.summaryCollapsed = false;
        applySummaryCollapsedState();
        expect(wrap.classList.contains("hidden")).toBe(false);

        toggleSummaryCollapsed();
        expect(wrap.classList.contains("hidden")).toBe(true);
        expect(dom.window.localStorage.getItem("theory-center-summary-collapsed")).toBe("1");
        expect(label.textContent).toBe("Развернуть");
    });

    it("renders complex sync action and all-theories list view without topic sync button", () => {
        const dom = setupTheoryCenterDom();
        const { state, renderTopicCard, renderList } = dom.window.__theoryCenterTestExports;

        state.scope = "topics";
        const topicCard = renderTopicCard({
            has_theory: true,
            module_id: "m1",
            topic_id: "t1",
            module_name: "Модуль 1",
            topic_name: "Тема 1",
            theory_title: "Теория 1",
            theory_state: "assigned",
            theory_state_label: "Теория задана",
            linked_complexes_count: 2,
            theory_has_content: true,
            theory_image_count: 1,
        });
        expect(topicCard).not.toContain('data-action="sync-topic-complexes"');
        expect(topicCard).not.toContain("Синхронизировать комплексы");

        state.scope = "complexes";
        state.overview = {
            complexes: [{
                complex_id: "cx_1",
                complex_name: "Комплекс 1",
                module_names: ["Модуль 1"],
                task_count: 2,
                theory_state: "single",
                theory_source: "topics",
                theory_source_label: "Из тем",
                theory_state_label: "Одна теория",
                theory_items: [{ theory_id: "th_1", title_cache: "Теория 1" }],
                open_theory_id: "th_1",
                needs_sync: true,
                sync_label: "Теория темы изменилась",
            }],
        };
        renderList();
        expect(dom.window.document.getElementById("theory-center-list").innerHTML).toContain('data-action="sync-complex"');

        state.scope = "all";
        state.overview = {
            theories: [{
                id: "th_1",
                title: "Теория 1",
                usage_topics: 2,
                usage_complexes: 1,
                is_orphan: false,
                has_content: true,
                image_count: 1,
                updated_at: "2026-03-18T09:00:00.000Z",
            }],
        };
        renderList();

        expect(dom.window.document.getElementById("theory-center-list-title").textContent).toBe("Теории: Все");
        expect(dom.window.document.getElementById("theory-center-result-summary").textContent).toBe("Показано 1 из 1");
        expect(dom.window.document.getElementById("theory-center-list").textContent).toContain("Теория 1");
    });

    it("renders linked theory publications as a separate non-editable section in all scope", () => {
        const dom = setupTheoryCenterDom();
        const { state, renderList, rebuildTheoryPublicationIndex } = dom.window.__theoryCenterTestExports;

        state.scope = "all";
        rebuildTheoryPublicationIndex([{
            item_id: "catalog_theory_th_local",
            source_workspace_id: "th_local",
            owner_user_id: "user_author",
            owner_display_name: "Автор теории",
            catalog_visibility: "public",
        }]);
        state.overview = {
            theories: [{
                id: "th_local",
                title: "Локальная теория",
                usage_topics: 0,
                usage_complexes: 0,
                is_orphan: true,
                has_content: true,
                image_count: 0,
                ownership: {
                    created_by_user_id: "user_author",
                    created_by_user_name: "Автор теории",
                    is_owned_by_current_user: false,
                },
            }],
            complexes: [{
                complex_id: "cx_1",
                complex_name: "Мой комплекс",
                theory_ids: ["th_local"],
            }],
            linked_theories: [{
                id: "lib_1",
                library_entry_id: "lib_1",
                title: "Связанная теория",
                access_state: "active",
                access_reason: "Публикация доступна.",
                updated_at: "2026-04-13T10:00:00.000Z",
                image_count: 1,
                is_linked_publication: true,
                owner_user_id: "user_catalog",
                owner_display_name: "Каталожный автор",
                catalog_visibility: "access_code",
            }],
        };

        renderList();

        const html = dom.window.document.getElementById("theory-center-list").innerHTML;
        expect(html).toContain("Связанные публикации");
        expect(html).toContain("Рабочие теории");
        expect(html).toContain('data-action="open-linked-theory"');
        expect(html).toContain('data-selectable="0"');
        expect(html).toContain("Автор теории");
        expect(html).toContain("Каталожный автор");
        expect(html).toContain("Родная");
        expect(html).toContain("Из каталога");
        expect(html).toContain("Общий доступ");
        expect(html).toContain("По коду");
        expect(html).toContain("Открыть");
        expect(html).toContain("Комплекс:");
    });

    it("opens foreign workspace theories in a read-only viewer instead of navigating to the editor", async () => {
        const dom = setupTheoryCenterDom();
        const { state, openTheoryRecord } = dom.window.__theoryCenterTestExports;

        state.overview = {
            theories: [{
                id: "th_foreign",
                title: "Чужая теория",
                updated_at: "2026-04-13T10:00:00.000Z",
                usage_topics: 0,
                usage_complexes: 1,
                ownership: {
                    created_by_user_id: "user_author",
                    created_by_user_name: "Автор теории",
                    is_owned_by_current_user: false,
                },
            }],
            complexes: [{
                complex_id: "cx_1",
                complex_name: "Мой комплекс",
                theory_ids: ["th_foreign"],
            }],
        };

        dom.window.navigateWithTransition = vi.fn();
        dom.window.fetch = vi.fn(async (url) => {
            if (url === "/api/theories/th_foreign") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        item: {
                            id: "th_foreign",
                            title: "Чужая теория",
                            updated_at: "2026-04-13T10:00:00.000Z",
                            delta: { ops: [{ insert: "Текст для просмотра\n" }] },
                        },
                    }),
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        await openTheoryRecord("th_foreign");

        expect(dom.window.navigateWithTransition).not.toHaveBeenCalled();
        expect(dom.window.document.body.textContent).toContain("Просмотр без редактирования");
        expect(dom.window.document.body.textContent).toContain("Мой комплекс");
        expect(dom.window.document.body.textContent).toContain("Текст для просмотра");
    });

    it("enables selection mode only for orphan theories in the all scope", () => {
        const dom = setupTheoryCenterDom();
        const {
            state,
            toggleTheorySelectionMode,
            selectAllVisibleTheories,
        } = dom.window.__theoryCenterTestExports;

        state.scope = "all";
        state.overview = {
            theories: [
                {
                    id: "th_orphan",
                    title: "Свободная теория",
                    usage_topics: 0,
                    usage_complexes: 0,
                    is_orphan: true,
                    has_content: true,
                    image_count: 0,
                },
                {
                    id: "th_linked",
                    title: "Связанная теория",
                    usage_topics: 1,
                    usage_complexes: 0,
                    is_orphan: false,
                    has_content: true,
                    image_count: 0,
                },
            ],
        };

        toggleTheorySelectionMode();
        selectAllVisibleTheories();

        expect(state.selectionMode).toBe(true);
        expect(Array.from(state.selectedTheoryIds)).toEqual(["th_orphan"]);
        expect(dom.window.document.getElementById("theory-center-bulk-bar").classList.contains("hidden")).toBe(false);
        expect(dom.window.document.getElementById("theory-center-selection-counter").textContent).toBe("Выбрано: 1");
        expect(dom.window.document.getElementById("theory-center-list").innerHTML).toContain('data-theory-id="th_orphan"');
        expect(dom.window.document.getElementById("theory-center-list").innerHTML).toContain('data-selectable="0"');
    });

    it("shows a visible quick-select checkbox on theory cards before selection mode starts", () => {
        const dom = setupTheoryCenterDom();
        const { state, renderList } = dom.window.__theoryCenterTestExports;

        state.scope = "all";
        state.overview = {
            theories: [{
                id: "th_orphan",
                title: "Свободная теория",
                usage_topics: 0,
                usage_complexes: 0,
                is_orphan: true,
                has_content: true,
                image_count: 0,
            }],
        };

        renderList();

        const listHtml = dom.window.document.getElementById("theory-center-list").innerHTML;
        expect(listHtml).toContain('data-action="toggle-theory-selection"');
        expect(listHtml).toContain("Начать массовые операции");
    });

    it("turns selection mode off after unchecking the only selected theory", () => {
        const dom = setupTheoryCenterDom();
        const { state, toggleTheorySelection } = dom.window.__theoryCenterTestExports;

        state.scope = "orphans";
        state.overview = {
            orphans: [{
                id: "th_orphan",
                title: "Свободная теория",
                usage_topics: 0,
                usage_complexes: 0,
                is_orphan: true,
                has_content: true,
                image_count: 0,
            }],
        };

        toggleTheorySelection("th_orphan");
        expect(state.selectionMode).toBe(true);
        expect(Array.from(state.selectedTheoryIds)).toEqual(["th_orphan"]);

        toggleTheorySelection("th_orphan");
        expect(state.selectionMode).toBe(false);
        expect(Array.from(state.selectedTheoryIds)).toEqual([]);
    });

    it("disables bulk operations in the topics scope", () => {
        const dom = setupTheoryCenterDom();
        const { state, updateSelectionControls } = dom.window.__theoryCenterTestExports;

        state.scope = "topics";
        state.loading = false;
        state.overview = {
            topics: [],
            filters: { modules: [], topic_states: [], complex_states: [] },
        };

        updateSelectionControls([]);

        const toggle = dom.window.document.getElementById("theory-center-selection-toggle");
        const wrap = dom.window.document.getElementById("theory-center-selection-toggle-wrap");

        expect(toggle.disabled).toBe(true);
        expect(toggle.title).toContain("Массовые");
        expect(wrap.title).toContain("Массовые");
        expect(wrap.dataset.disabled).toBe("1");
    });

    it("schedules selected theory deletion with undo before committing", async () => {
        vi.useFakeTimers();
        const dom = setupTheoryCenterDom();
        const {
            state,
            toggleTheorySelectionMode,
            toggleTheorySelection,
            deleteSelectedTheories,
        } = dom.window.__theoryCenterTestExports;

        state.scope = "orphans";
        state.overview = {
            orphans: [{
                id: "th_orphan",
                title: "Свободная теория",
                usage_topics: 0,
                usage_complexes: 0,
                is_orphan: true,
                has_content: true,
                image_count: 0,
            }],
        };

        dom.window.fetch = vi.fn(async (url, options = {}) => {
            if (url === "/api/theories/th_orphan") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        item: { id: "th_orphan" },
                    }),
                };
            }
            if (url === "/api/theory-center/overview") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        summary: {},
                        filters: { modules: [], topic_states: [], complex_states: [] },
                        topics: [],
                        complexes: [],
                        orphans: [],
                        theories: [],
                    }),
                };
            }
            if (url === "/api/theory-library") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        entries: [],
                    }),
                };
            }
            if (url === "/api/auth/me") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        authenticated: true,
                        user: { user_id: "user_author" },
                    }),
                };
            }
            if (url === "/api/catalog/items?content_type=theory&owner_user_id=user_author&include_owned_non_public=true") {
                return {
                    ok: true,
                    json: async () => ({
                        ok: true,
                        items: [],
                    }),
                };
            }
            throw new Error(`Unexpected fetch: ${url}`);
        });

        toggleTheorySelectionMode();
        toggleTheorySelection("th_orphan");
        deleteSelectedTheories();

        expect(dom.window.NotificationUI.toast).toHaveBeenCalledTimes(1);
        expect(dom.window.NotificationUI.toast.mock.calls[0][3]).toMatchObject({ showTimer: true, closeable: false });
        expect(typeof dom.window.NotificationUI.toast.mock.calls[0][3].timerFormatter).toBe("function");
        expect(dom.window.fetch).not.toHaveBeenCalled();
        expect(state.selectionMode).toBe(false);
        expect(Array.from(state.selectedTheoryIds)).toEqual([]);

        await vi.advanceTimersByTimeAsync(5000);

        const deleteCall = dom.window.fetch.mock.calls.find(([url]) => url === "/api/theories/th_orphan");
        const overviewReloadCall = dom.window.fetch.mock.calls.find(([url]) => url === "/api/theory-center/overview");
        expect(deleteCall[0]).toBe("/api/theories/th_orphan");
        expect(deleteCall[1]).toMatchObject({ method: "DELETE" });
        expect(overviewReloadCall[0]).toBe("/api/theory-center/overview");
        expect(state.selectionMode).toBe(false);
        expect(Array.from(state.selectedTheoryIds)).toEqual([]);
        expect(dom.window.document.getElementById("theory-center-flash").textContent).toContain("Теория");
    });
    it("does not auto-scroll the page when showing a flash message", () => {
        const dom = setupTheoryCenterDom();
        const { setFlash } = dom.window.__theoryCenterTestExports;
        const flash = dom.window.document.getElementById("theory-center-flash");
        flash.scrollIntoView = vi.fn();

        setFlash("Saved", "success");

        expect(flash.textContent).toBe("Saved");
        expect(flash.scrollIntoView).not.toHaveBeenCalled();
    });

    it("does not show a flash when all visible selections are toggled off", () => {
        const dom = setupTheoryCenterDom();
        const {
            state,
            selectAllVisibleTheories,
            toggleTheorySelectionMode,
        } = dom.window.__theoryCenterTestExports;

        state.scope = "orphans";
        state.overview = {
            orphans: [{
                id: "th_orphan",
                title: "Свободная теория",
                usage_topics: 0,
                usage_complexes: 0,
                is_orphan: true,
                has_content: true,
                image_count: 0,
            }],
        };

        toggleTheorySelectionMode();
        selectAllVisibleTheories();
        dom.window.document.getElementById("theory-center-flash").textContent = "";

        selectAllVisibleTheories();

        expect(dom.window.document.getElementById("theory-center-flash").textContent).toBe("");
        expect(state.selectionMode).toBe(false);
        expect(Array.from(state.selectedTheoryIds)).toEqual([]);
    });

    it("renders a remove action for linked theory library rows", () => {
        const dom = setupTheoryCenterDom();
        const { renderTheoryCatalogCard } = dom.window.__theoryCenterTestExports;

        const markup = renderTheoryCatalogCard({
            id: "theory_library::catalog_theory_demo::123",
            library_entry_id: "theory_library::catalog_theory_demo::123",
            title: "Связанная теория",
            owner_user_id: "user_author",
            owner_display_name: "Author",
            catalog_visibility: "public",
            updated_at: "2026-04-16T10:00:00Z",
            access_state: "active",
            access_reason: "",
            is_linked_publication: true,
            image_count: 0,
        });

        expect(markup).toContain('data-action="delete-linked-theory-record"');
        expect(markup).toContain('data-library-entry-id="theory_library::catalog_theory_demo::123"');
        expect(markup).toContain("Убрать");
    });
    it("normalizes hosted asset-backed viewer images to canonical asset URLs", () => {
        const dom = setupTheoryCenterDom();
        const {
            theoryViewerAssetSrc,
            normalizeTheoryViewerImageRef,
            renderLinkedTheoryDeltaHtml,
        } = dom.window.__theoryCenterTestExports;

        expect(theoryViewerAssetSrc("asset_tc_1", "")).toBe("/api/assets/asset_tc_1/content");
        expect(
            normalizeTheoryViewerImageRef("/api/local-image?asset_id=asset_tc_2"),
        ).toBe("/api/assets/asset_tc_2/content");

        const html = renderLinkedTheoryDeltaHtml({
            ops: [
                {
                    insert: { image: "/api/local-image?asset_id=asset_tc_3" },
                    attributes: { align: "center", width: "420px" },
                },
            ],
        });

        expect(html).toContain("/api/assets/asset_tc_3/content");
        expect(html).not.toContain("/api/local-image?asset_id=asset_tc_3");
    });
});
