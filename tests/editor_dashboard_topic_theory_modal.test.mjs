/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../frontend/Editor/dashboard.js";

const sampleModules = [
  {
    id: "m1",
    name: "Модуль 1",
    topics: [
      {
        id: "t1",
        name: "Тема 1",
        tasks: [],
      },
    ],
  },
];

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function setupDomSkeleton() {
  document.body.innerHTML = `
    <aside>
      <div class="flex-1">
        <div class="flex-col"></div>
      </div>
    </aside>
    <main>
      <div class="grid"></div>
    </main>
    <button data-role="create-task-card" type="button"></button>
    <button data-role="return-main" type="button"></button>
    <input id="editor-search-input" />
    <div data-role="sort-controller">
      <button data-role="sort-toggle" type="button"></button>
      <div data-role="sort-menu" class="hidden">
        <button data-sort-option="alphabet" type="button"><span data-role="sort-check"></span></button>
        <button data-sort-option="date" type="button"><span data-role="sort-check"></span></button>
        <button data-sort-option="type" type="button"><span data-role="sort-check"></span></button>
      </div>
      <span data-role="sort-label"></span>
    </div>

    <div id="create-task-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-module-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-topic-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="import-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="topic-sync-confirm-modal" class="hidden">
      <div id="topic-sync-blur-overlay"></div>
      <div id="topic-sync-modal-content">
        <span id="topic-sync-confirm-target"></span>
        <button id="topic-sync-confirm-btn" type="button">Подтвердить обновление</button>
        <button id="topic-sync-cancel-btn" type="button">Отмена</button>
      </div>
    </div>
    <div id="toast-container"></div>

    <div id="topic-theory-modal" class="hidden">
      <div class="bg-surface-1">
        <button data-role="topic-theory-close" type="button"></button>
        <button data-role="topic-theory-close" type="button"></button>
        <p id="topic-theory-meta"></p>
        <div id="topic-theory-current-info" class="hidden">
          <p id="topic-theory-current-title"></p>
          <button id="topic-theory-edit-content-btn" type="button"></button>
          <button id="topic-theory-clear-btn" type="button"></button>
        </div>
        <div id="topic-theory-empty-state">
          <button id="topic-theory-create-new-btn" type="button"></button>
          <select id="topic-theory-picker">
            <option value="">Без теории</option>
          </select>
        </div>
        <div id="topic-theory-note-container">
          <div id="topic-theory-workspace-note">
            <p id="topic-theory-workspace-note-text"></p>
          </div>
        </div>
        <select id="topic-theory-relation">
          <option value="link">link</option>
          <option value="copy">copy</option>
        </select>
        <input id="topic-theory-apply" type="checkbox" />
        <input id="topic-theory-dry-run" type="checkbox" checked />
        <select id="topic-theory-propagation-mode">
          <option value="safe">safe</option>
          <option value="inherit_only_force">inherit_only_force</option>
          <option value="all_force">all_force</option>
        </select>
        <p id="topic-theory-propagation-summary"></p>
        <button id="topic-theory-preview-btn" type="button"></button>
        <button id="topic-theory-open-complexes-btn" type="button" class="hidden"></button>
        <button id="topic-theory-save-btn" type="button"></button>
      </div>
    </div>
  `;
}

async function flushPromises(rounds = 8) {
  for (let index = 0; index < rounds; index += 1) {
    await Promise.resolve();
  }
}

describe("EditorDashboard topic theory modal", () => {
  let capturedPutPayload = null;
  let putPayloads = [];
  let currentTheoryLink = { theory_id: "th_a", relation: "copy" };

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.NotificationUI = {
      toast: vi.fn(),
      confirm: vi.fn(async () => true),
    };
    window.navigateWithTransition = vi.fn();
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    capturedPutPayload = null;
    putPayloads = [];
    currentTheoryLink = { theory_id: "th_a", relation: "copy" };

    global.fetch = vi.fn(async (input, init = {}) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      const method = String(init?.method || "GET").toUpperCase();

      if (url === "/api/editor/catalog") {
        return createJsonResponse({ ok: true, modules: JSON.parse(JSON.stringify(sampleModules)) });
      }
      if (url === "/api/theories") {
        return createJsonResponse({
          ok: true,
          items: [{ id: "th_a", title: "Theory A" }, { id: "th_b", title: "Theory B" }],
        });
      }
      if (url.includes("/api/editor/topic/m1/t1/theory-link") && method === "GET") {
        return createJsonResponse({
          ok: true,
          item: {
            module_id: "m1",
            topic_id: "t1",
            theory_link: currentTheoryLink,
          },
          propagation_preview: {
            mode: "safe",
            dry_run: true,
            impacted_complexes: 1,
            would_update: 1,
            updated: 0,
            skipped: 0,
          },
        });
      }
      if (url.includes("/api/editor/topic/m1/t1/theory-link") && method === "PUT") {
        capturedPutPayload = JSON.parse(String(init?.body || "{}"));
        putPayloads.push(capturedPutPayload);
        return createJsonResponse({
          ok: true,
          item: {
            module_id: "m1",
            topic_id: "t1",
            theory_link: capturedPutPayload.theory_link,
          },
          propagation: {
            summary: {
              mode: capturedPutPayload.propagation_mode || "safe",
              dry_run: !!capturedPutPayload.dry_run,
              impacted_complexes: 2,
              would_update: capturedPutPayload.dry_run ? 1 : 0,
              updated: capturedPutPayload.dry_run ? 0 : 1,
              skipped: 1,
            },
            items: [],
          },
        });
      }

      return createJsonResponse({ ok: true });
    });

    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    delete window.NotificationUI;
    delete window.navigateWithTransition;
    vi.restoreAllMocks();
  });

  it("loads topic theory link and preview into modal", async () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    await dashboard.showTopicTheoryModal("m1", "t1");

    const modal = document.getElementById("topic-theory-modal");
    const picker = document.getElementById("topic-theory-picker");
    const relation = document.getElementById("topic-theory-relation");
    const summary = document.getElementById("topic-theory-propagation-summary");
    const workspaceNote = document.getElementById("topic-theory-workspace-note-text");

    expect(modal.classList.contains("hidden")).toBe(false);
    expect(modal.classList.contains("flex")).toBe(true);
    expect(picker.value).toBe("th_a");
    expect(relation.value).toBe("copy");
    expect(summary.textContent).toContain("Обновление комплексов (safe)");
    expect(summary.textContent).toContain("1");
    expect(workspaceNote).toBeTruthy();
    expect(workspaceNote.textContent).toContain("общей библиотеке");
  });

  it("submits topic theory payload with propagation controls", async () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    await dashboard.showTopicTheoryModal("m1", "t1");

    const applyEl = document.getElementById("topic-theory-apply");
    const dryRunEl = document.getElementById("topic-theory-dry-run");
    const modeEl = document.getElementById("topic-theory-propagation-mode");
    const picker = document.getElementById("topic-theory-picker");
    const relation = document.getElementById("topic-theory-relation");

    applyEl.checked = true;
    applyEl.dispatchEvent(new Event("change"));
    dryRunEl.checked = false;
    modeEl.value = "all_force";
    picker.value = "th_b";
    relation.value = "link";

    await dashboard.submitTopicTheoryForm();

    expect(capturedPutPayload).toBeTruthy();
    expect(capturedPutPayload).toEqual({
      theory_link: { theory_id: "th_b", relation: "link" },
      apply_to_complexes: true,
      dry_run: false,
      propagation_mode: "safe",
    });

    const modal = document.getElementById("topic-theory-modal");
    expect(modal.classList.contains("hidden")).toBe(true);
    expect(window.NotificationUI.toast).toHaveBeenCalled();
  });

  it("runs quick topic theory sync from sidebar action", async () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    const syncAction = document.querySelector(
      '[data-role="topic-theory-sync"][data-module-id="m1"][data-topic-id="t1"]'
    );
    expect(syncAction).toBeTruthy();

    syncAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("topic-sync-confirm-btn").click();
    await flushPromises();

    expect(putPayloads.length).toBeGreaterThan(0);
    expect(putPayloads[0]).toEqual({
      theory_link: { theory_id: "th_a", relation: "copy" },
      apply_to_complexes: true,
      dry_run: false,
      propagation_mode: "safe",
    });
    expect(window.NotificationUI.toast).toHaveBeenCalled();
  });

  it("stops quick topic sync when topic has no theory link", async () => {
    currentTheoryLink = null;

    const syncAction = document.querySelector(
      '[data-role="topic-theory-sync"][data-module-id="m1"][data-topic-id="t1"]'
    );
    expect(syncAction).toBeTruthy();

    syncAction.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    document.getElementById("topic-sync-confirm-btn").click();
    await flushPromises();

    expect(putPayloads.length).toBe(0);
    expect(window.NotificationUI.toast).toHaveBeenCalledWith(expect.any(String), "warning", expect.any(Number));
  });

  it("opens related complexes and standalone theory editor from topic theory modal", async () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    await dashboard.showTopicTheoryModal("m1", "t1");

    const openComplexesBtn = document.getElementById("topic-theory-open-complexes-btn");
    const editContentBtn = document.getElementById("topic-theory-edit-content-btn");
    const workspaceNote = document.getElementById("topic-theory-workspace-note-text");

    expect(openComplexesBtn.classList.contains("hidden")).toBe(false);
    expect(workspaceNote.textContent).toContain("Комплексы");

    openComplexesBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(window.navigateWithTransition).toHaveBeenLastCalledWith("/complexes?theory_id=th_a");

    await dashboard.showTopicTheoryModal("m1", "t1");
    editContentBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const theoryEditorUrl = window.navigateWithTransition.mock.lastCall[0];
    expect(theoryEditorUrl).toContain("/editor/Theory_Editor.html?theory_id=th_a");
    expect(theoryEditorUrl).toContain("context=topic");
    expect(theoryEditorUrl).toContain("module_id=m1");
    expect(theoryEditorUrl).toContain("topic_id=t1");

    await dashboard.showTopicTheoryModal("m1", "t1");
    const picker = document.getElementById("topic-theory-picker");
    picker.value = "";
    picker.dispatchEvent(new Event("change"));
    expect(openComplexesBtn.classList.contains("hidden")).toBe(true);
    expect(workspaceNote.textContent).toContain("Теории хранятся");
  });
});
