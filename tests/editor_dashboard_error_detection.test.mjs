/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import "../frontend/Editor/dashboard.js";

const sampleModules = [
  {
    id: "module_error",
    name: "Ошибки в кликах",
    topics: [
      {
        id: "topic_a",
        name: "Тема А",
        tasks: [
          { id: "task_regular", name: "Обычное задание", type: "click" },
          {
            id: "task_error_detection",
            name: "Задание с ошибками",
            type: "click",
            subtype: "error_detection",
          },
        ],
      },
    ],
  },
];

const createFetchResponse = () => ({
  ok: true,
  json: async () => ({ ok: true, modules: JSON.parse(JSON.stringify(sampleModules)) }),
});

describe("EditorDashboard initial route restore", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(() => Promise.resolve(createFetchResponse()));
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    window.__EDITOR_ROUTE_STATE__ = { module: "module_error", topic: "topic_a" };
    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    delete window.__EDITOR_ROUTE_STATE__;
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("applies module and topic route after catalog finishes loading", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();
    expect(dashboard.activeModuleId).toBe("module_error");
    expect(dashboard.activeTopicId).toBe("topic_a");

    const cards = Array.from(document.querySelectorAll("main .grid article"));
    expect(cards.length).toBe(2);
  });
});

describe("EditorDashboard persisted sidebar state", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/editor/modules/delete")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.resolve(createFetchResponse());
    });
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    localStorage.setItem("editorDashboardState", JSON.stringify({
      expanded: {
        modules: ["module_error"],
        topics: ["module_error:topic_a"],
      },
      lastView: {
        moduleId: "module_error",
        topicId: "topic_a",
      },
    }));
    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    localStorage.removeItem("editorDashboardState");
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("restores lastView from localStorage when route params are absent", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();
    expect(dashboard.activeModuleId).toBe("module_error");
    expect(dashboard.activeTopicId).toBe("topic_a");
  });

  it("persists programmatic sidebar expansion for the active topic", () => {
    const dashboard = window.dashboard;
    dashboard.expandedState = { modules: [], topics: [] };
    dashboard.saveDashboardState();

    dashboard.renderTopicTasks("module_error", "topic_a");

    const stored = JSON.parse(localStorage.getItem("editorDashboardState") || "{}");
    expect(stored.expanded.modules).toContain("module_error");
    expect(stored.expanded.topics).toContain("module_error:topic_a");
  });

  it("removes deleted module keys from expandedState after commit", async () => {
    const dashboard = window.dashboard;
    const key = "module:module_error";
    dashboard.pendingDeletions.set(key, {
      type: "module",
      payload: { module_id: "module_error" },
      timer: null,
      toastId: null,
      elementKey: key,
    });

    await dashboard.commitDeletion(key, "module", { module_id: "module_error" });

    const stored = JSON.parse(localStorage.getItem("editorDashboardState") || "{}");
    expect(stored.expanded.modules).not.toContain("module_error");
    expect(stored.expanded.topics).not.toContain("module_error:topic_a");
  });
});

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
  `;
}

describe("EditorDashboard error detection markers", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn(() => Promise.resolve(createFetchResponse()));
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("detects error_detection subtype and updates type label", () => {
    const dashboard = window.dashboard;
    expect(dashboard).toBeDefined();
    const errorTask = {
      type: "click",
      subtype: "error_detection",
    };

    expect(dashboard.isErrorDetectionTask(errorTask)).toBe(true);
    const meta = dashboard.getTaskTypeMeta(errorTask);
    expect(meta.label).toBe("Клик");
    expect(meta.className).toContain("secondary");
  });

  it("renders badge on error_detection cards and sidebar entries", () => {
    const cards = Array.from(document.querySelectorAll("main .grid article"));
    expect(cards.length).toBeGreaterThan(0);
    const errorCard = cards.find((card) => card.textContent.includes("Задание с ошибками"));
    expect(errorCard).toBeTruthy();
    expect(errorCard.textContent).toContain("Задание с ошибками");

    const sidebarButtons = Array.from(document.querySelectorAll("aside button"));
    const errorButton = sidebarButtons.find((btn) => btn.textContent.includes("Задание с ошибками"));
    expect(errorButton).toBeTruthy();
    expect(errorButton.innerHTML).toContain("touch_app");
  });
});

describe("EditorDashboard workspace limit placement", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "alert").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = vi.fn((url) => {
      if (String(url).includes("/api/workspace-limits/summary")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ok: true,
            plan: "free",
            tasks: {
              personal_count: 3,
              personal_limit: 20,
              remaining_personal: 17,
            },
          }),
        });
      }
      return Promise.resolve(createFetchResponse());
    });
    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    setupDomSkeleton();
    window.dashboard = undefined;
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("keeps the limit badge inside the all tasks sidebar button", () => {
    const allTasksButton = document.querySelector("[data-all-tasks-button]");
    const badge = document.querySelector('[data-role="all-tasks-limit-badge"]');

    expect(allTasksButton).toBeTruthy();
    expect(allTasksButton?.textContent).toContain("3/20");
    expect(badge?.textContent).toBe("3/20");
    expect(allTasksButton?.contains(badge)).toBe(true);
  });

  it("removes the standalone header limit pill from the dashboard template", () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), "frontend/Editor/Main_Dashboard.html"), "utf8");
    expect(html).not.toContain('id="task-workspace-limit-pill"');
  });
});
