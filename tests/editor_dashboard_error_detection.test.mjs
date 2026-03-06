/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
