/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../frontend/Editor/dashboard.js";

function createJsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  };
}

function setupDomSkeleton() {
  document.body.innerHTML = `
    <aside id="editor-sidebar">
      <div class="h-16"></div>
      <div class="flex-1">
        <div id="editor-workspace-shortcuts" class="px-4 mb-4"></div>
        <div class="flex flex-col"></div>
      </div>
    </aside>
    <div id="sidebar-resizer"></div>
    <div id="sidebar-blur-overlay"></div>
    <div id="sidebar-delete-modal"></div>

    <main>
      <div class="grid"></div>
    </main>

    <header>
      <div class="flex items-center gap-3"></div>
    </header>

    <button data-role="create-task-card" type="button"></button>
    <button data-role="return-main" type="button"></button>
    <button data-role="open-recovery-center" type="button"></button>
    <button data-role="close-recovery-center" type="button"></button>
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
    <div id="topic-theory-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="import-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="recovery-center-modal" class="hidden"><div id="recovery-center-content"></div></div>
    <div id="toast-container"></div>
  `;
}

describe("EditorDashboard workspace import history", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.NotificationUI = {
      toast: vi.fn(),
      confirm: vi.fn(async () => true),
    };
    window.navigateWithTransition = vi.fn();
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    localStorage.clear();

    localStorage.setItem(
      "editor_import_history_v1",
      JSON.stringify([
        {
          timestamp: Date.now(),
          mode: "text",
          module: "Модуль A",
          topic: "Тема A",
          module_id: "m1",
          topic_id: "t1",
          status: "ok",
          imported: 3,
          skipped: 1,
          errors: 0,
        },
      ]),
    );
    localStorage.setItem(
      "task_draft_m1_t1_task_1",
      JSON.stringify({
        moduleId: "m1",
        topicId: "t1",
        taskId: "task_1",
        timestamp: Date.now(),
      }),
    );

    global.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : String(input?.url || "");
      if (url === "/api/editor/catalog") {
        return createJsonResponse({
          ok: true,
          modules: [
            {
              id: "m1",
              name: "Модуль A",
              topics: [{ id: "t1", name: "Тема A", tasks: [] }],
            },
          ],
        });
      }
      return createJsonResponse({ ok: true, modules: [] });
    });

    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    delete window.NotificationUI;
    delete window.navigateWithTransition;
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders import history shortcuts and opens import modal on click", () => {
    const host = document.getElementById("editor-workspace-shortcuts");
    expect(host).toBeTruthy();
    expect(host.classList.contains("hidden")).toBe(false);
    expect(host.textContent).toContain("Модуль A / Тема A");

    const firstEntryBtn = host.querySelector("button");
    expect(firstEntryBtn).toBeTruthy();
    firstEntryBtn.click();

    const importModal = document.getElementById("import-modal");
    expect(importModal.classList.contains("hidden")).toBe(false);
  });

  it("shows recovery shortcut summary and badge on recovery trigger", () => {
    const host = document.getElementById("editor-workspace-shortcuts");
    expect(host).toBeTruthy();

    const badge = document.querySelector(
      '[data-role="open-recovery-center"] [data-role="recovery-draft-count"]'
    );
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("1");

    const recoveryShortcutBtn = host.querySelector('[data-role="recovery-shortcut-open"]');
    expect(recoveryShortcutBtn).toBeTruthy();

    recoveryShortcutBtn.click();

    const recoveryModal = document.getElementById("recovery-center-modal");
    expect(recoveryModal.classList.contains("hidden")).toBe(false);
    expect(recoveryModal.classList.contains("flex")).toBe(true);
  });

  it("closeModals closes the import modal as part of common modal cleanup", () => {
    const importModal = document.getElementById("import-modal");
    expect(importModal).toBeTruthy();

    importModal.classList.remove("hidden");
    window.dashboard.closeModals();

    expect(importModal.classList.contains("hidden")).toBe(true);
  });
});
