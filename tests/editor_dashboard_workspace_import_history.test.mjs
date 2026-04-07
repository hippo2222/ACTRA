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

  it("shows orphan draft in recovery center with human-readable module/topic names", () => {
    const host = document.getElementById("editor-workspace-shortcuts");
    expect(host).toBeTruthy();
    expect(host.textContent).not.toContain("Недавние");
    expect(host.querySelector('[data-role="recovery-shortcut-open"]')).toBeNull();

    const badge = document.querySelector(
      '[data-role="open-recovery-center"] [data-role="recovery-draft-count"]'
    );
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("1");

    const recoveryTrigger = document.querySelector('[data-role="open-recovery-center"]');
    expect(recoveryTrigger).toBeTruthy();

    recoveryTrigger.click();

    const recoveryModal = document.getElementById("recovery-center-modal");
    expect(recoveryModal.classList.contains("hidden")).toBe(false);
    expect(recoveryModal.classList.contains("flex")).toBe(true);
    expect(recoveryModal.textContent).toContain("Модуль A / Тема A");
    expect(recoveryModal.textContent).toContain("task_1");
  });

  it("marks task cards with a draft badge when a local draft exists", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    dashboard.renderGrid([
      {
        id: "task_1",
        name: "Черновое задание",
        type: "click",
        created_at: "2026-03-12T10:00:00Z",
        updated_at: "2026-03-12T10:05:00Z",
        moduleId: "m1",
        moduleName: "Модуль A",
        topicId: "t1",
        topicName: "Тема A",
      },
    ]);

    const card = document.querySelector('article[data-task-id="m1:t1:task_1"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Черновик");
  });

  it("shows orphan draft task as a draft card inside its topic", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    dashboard.catalog = [
      {
        id: "m1",
        name: "Модуль A",
        topics: [
          {
            id: "t1",
            name: "Тема A",
            tasks: [],
          },
        ],
      },
    ];

    dashboard.renderTopicTasks("m1", "t1");

    const card = document.querySelector('article[data-task-id="m1:t1:task_1"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Черновик");
    expect(card.textContent).toContain("Модуль A");
    expect(card.textContent).toContain("Тема A");
  });

  it("shows drafts of existing tasks in recovery center and on the task card", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    dashboard.catalog = [
      {
        id: "m1",
        name: "Модуль A",
        topics: [
          {
            id: "t1",
            name: "Тема A",
            tasks: [
              {
                id: "task_1",
                name: "Задание 1",
                type: "click",
                created_at: "2026-03-12T10:00:00Z",
              },
            ],
          },
        ],
      },
    ];

    dashboard.renderWorkspaceShortcuts();
    dashboard.renderGrid();

    const badge = document.querySelector(
      '[data-role="open-recovery-center"] [data-role="recovery-draft-count"]'
    );
    expect(badge).toBeTruthy();
    expect(badge.textContent).toBe("1");

    const taskCard = document.querySelector('article[data-task-id="m1:t1:task_1"]');
    expect(taskCard).toBeTruthy();
    expect(taskCard.textContent).toContain("Черновик");

    dashboard.showRecoveryCenter();
    const recoveryModal = document.getElementById("recovery-center-modal");
    expect(recoveryModal.textContent).toContain("Задание 1");
    expect(recoveryModal.textContent).toContain("Откроется задача и предложит восстановить локальный черновик");
  });

  it("collapses a legacy draft onto an existing task resolved by path", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    localStorage.setItem(
      "task_draft_m1_t1_task_1",
      JSON.stringify({
        moduleId: "m1",
        topicId: "t1",
        taskId: "task_1",
        timestamp: Date.now(),
        data: {
          meta: {
            name: "Задание 1",
          },
        },
      }),
    );

    dashboard.catalog = [
      {
        id: "m1",
        name: "Модуль A",
        topics: [
          {
            id: "t1",
            name: "Тема A",
            tasks: [
              {
                id: "legacy_uuid",
                name: "Задание 1",
                type: "click",
                created_at: "2026-03-12T10:00:00Z",
                path: "modules/m1/topics/t1/tasks/task_1/task.json",
              },
            ],
          },
        ],
      },
    ];

    dashboard.renderGrid();

    const cards = document.querySelectorAll("article[data-task-id]");
    expect(cards).toHaveLength(1);
    expect(cards[0].dataset.taskId).toBe("m1:t1:task_1");
    expect(cards[0].textContent).toContain("Черновик");
    expect(cards[0].textContent).toContain("Задание 1");

    dashboard.showRecoveryCenter();
    const recoveryModal = document.getElementById("recovery-center-modal");
    expect(recoveryModal.textContent).toContain("Задание 1");
  });

  it("marks an existing task as draft when local storage uses a legacy task id alias", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    localStorage.setItem(
      "task_draft_m1_t1_legacy_uuid",
      JSON.stringify({
        moduleId: "m1",
        topicId: "t1",
        taskId: "legacy_uuid",
        timestamp: Date.now(),
        data: {
          meta: {
            name: "Задание 1",
          },
        },
      }),
    );

    dashboard.catalog = [
      {
        id: "m1",
        name: "Модуль A",
        topics: [
          {
            id: "t1",
            name: "Тема A",
            tasks: [
              {
                id: "task_1",
                legacy_id: "legacy_uuid",
                name: "Задание 1",
                type: "click",
                created_at: "2026-03-12T10:00:00Z",
              },
            ],
          },
        ],
      },
    ];

    dashboard.renderGrid();

    const card = document.querySelector('article[data-task-id="m1:t1:task_1"]');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain("Черновик");

    dashboard.showRecoveryCenter();
    const recoveryModal = document.getElementById("recovery-center-modal");
    expect(recoveryModal.textContent).toContain("Задание 1");
  });

  it("opens the editor with canonical meta.id instead of legacy root task_data.id", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    dashboard.switchEditor({
      metadata: {
        id: "legacy_uuid",
        module: "m1",
        topic: "t1",
      },
      task_data: {
        id: "legacy_uuid",
        type: "click",
        meta: {
          id: "task_1",
          module: "m1",
          topic: "t1",
        },
      },
    });

    expect(window.navigateWithTransition).toHaveBeenCalledWith(
      "Point_Annotation.html?module=m1&topic=t1&task=task_1"
    );
  });

  it("loads an existing task by canonical id resolved from its path", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    const loadTaskSpy = vi.spyOn(dashboard, "loadTask").mockImplementation(() => {});

    dashboard.openTaskEntry(
      {
        id: "legacy_uuid",
        path: "modules/m1/topics/t1/tasks/task_1/task.json",
        type: "click",
      },
      "m1",
      "t1"
    );

    expect(loadTaskSpy).toHaveBeenCalledWith("m1", "t1", "task_1", {
      restoreDraft: false,
    });
  });

  it("opens a tagged draft task with automatic draft restoration intent", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    const loadTaskSpy = vi.spyOn(dashboard, "loadTask").mockImplementation(() => {});

    dashboard.openTaskEntry(
      {
        id: "task_1",
        type: "click",
        hasDraft: true,
      },
      "m1",
      "t1"
    );

    expect(loadTaskSpy).toHaveBeenCalledWith("m1", "t1", "task_1", {
      restoreDraft: true,
    });
  });

  it("opens an existing task draft from recovery center via loadTask", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();

    const loadTaskSpy = vi.spyOn(dashboard, "loadTask").mockImplementation(() => {});

    dashboard.openRecoveryDraft({
      kind: "task",
      taskExists: true,
      moduleId: "m1",
      topicId: "t1",
      taskId: "legacy_uuid",
      resolvedTaskId: "task_1",
    });

    expect(loadTaskSpy).toHaveBeenCalledWith("m1", "t1", "task_1", {
      restoreDraft: true,
    });
  });

  it("closeModals closes the import modal as part of common modal cleanup", () => {
    const importModal = document.getElementById("import-modal");
    expect(importModal).toBeTruthy();

    importModal.classList.remove("hidden");
    window.dashboard.closeModals();

    expect(importModal.classList.contains("hidden")).toBe(true);
  });
});
