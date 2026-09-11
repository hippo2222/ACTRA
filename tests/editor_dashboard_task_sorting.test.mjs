/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "../frontend/Editor/dashboard.js";

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
      <nav id="header-breadcrumbs"></nav>
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

describe("EditorDashboard Task Sorting by Modification Date", () => {
  let dashboard;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__ = true;
    delete window.__EDITOR_ROUTE_STATE__;
    setupDomSkeleton();
    window.dashboard = undefined;

    global.fetch = vi.fn((url) => {
      if (url === "/api/editor/catalog") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            modules: [
              {
                id: "mod1",
                name: "Модуль 1",
                topics: [
                  {
                    id: "top1",
                    name: "Тема 1",
                    tasks: [
                      {
                        id: "task_old_created_recently_edited",
                        name: "Задание А (старое, но недавно изменённое)",
                        type: "test",
                        created_at: "2026-01-01T10:00:00Z",
                        updated_at: "2026-09-10T12:00:00Z",
                      },
                      {
                        id: "task_newer_created_not_edited",
                        name: "Задание Б (создано позже, но не менялось)",
                        type: "click",
                        created_at: "2026-05-01T10:00:00Z",
                        updated_at: "2026-05-01T10:00:00Z",
                      },
                      {
                        id: "task_middle_created_modified_field",
                        name: "Задание В (modified вместо updated_at)",
                        type: "draw",
                        created_at: "2026-03-01T10:00:00Z",
                        modified: "2026-08-01T10:00:00Z",
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    });

    document.dispatchEvent(new Event("DOMContentLoaded"));
    await Promise.resolve();
    await Promise.resolve();
    dashboard = window.dashboard;
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("sorts tasks by latest modification time in descending order", () => {
    dashboard.currentSort = "date";
    const tasks = [
      {
        id: "t1",
        name: "Старое создание, свежее изменение",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
      },
      {
        id: "t2",
        name: "Новое создание, без изменений",
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "t3",
        name: "Самое свежее изменение",
        created_at: "2026-02-01T00:00:00Z",
        updated_at: "2026-09-10T00:00:00Z",
      },
    ];

    const sorted = dashboard.sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("falls back to created_at when updated_at is absent or empty", () => {
    dashboard.currentSort = "date";
    const tasks = [
      {
        id: "t_no_update_older",
        name: "Без update, старше",
        created_at: "2026-01-10T00:00:00Z",
      },
      {
        id: "t_no_update_newer",
        name: "Без update, новее",
        created_at: "2026-04-15T00:00:00Z",
      },
    ];

    const sorted = dashboard.sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["t_no_update_newer", "t_no_update_older"]);
  });

  it("recognizes modified and updatedAt alternative keys", () => {
    dashboard.currentSort = "date";
    const tasks = [
      {
        id: "t_modified",
        name: "С ключом modified",
        created_at: "2026-01-01T00:00:00Z",
        modified: "2026-08-20T00:00:00Z",
      },
      {
        id: "t_updatedAt",
        name: "С ключом updatedAt",
        created_at: "2026-01-01T00:00:00Z",
        updatedAt: "2026-08-25T00:00:00Z",
      },
      {
        id: "t_old",
        name: "Старое",
        created_at: "2026-05-01T00:00:00Z",
      },
    ];

    const sorted = dashboard.sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["t_updatedAt", "t_modified", "t_old"]);
  });

  it("applies stable secondary sort by name when timestamps are identical", () => {
    dashboard.currentSort = "date";
    const sameDate = "2026-07-01T12:00:00Z";
    const tasks = [
      { id: "c", name: "Второе задание", updated_at: sameDate },
      { id: "a", name: "Первое задание", updated_at: sameDate },
      { id: "b", name: "Третье задание", updated_at: sameDate },
    ];

    const sorted = dashboard.sortTasks(tasks);
    expect(sorted.map((t) => t.id)).toEqual(["c", "a", "b"]);
    expect(sorted.map((t) => t.name)).toEqual(["Второе задание", "Первое задание", "Третье задание"]);
  });

  it("handles malformed or invalid date strings gracefully", () => {
    dashboard.currentSort = "date";
    const tasks = [
      { id: "valid", name: "Валидная дата", updated_at: "2026-08-01T00:00:00Z" },
      { id: "invalid", name: "Битая дата", updated_at: "not-a-date" },
      { id: "empty", name: "Пустая дата", updated_at: "" },
    ];

    expect(() => dashboard.sortTasks(tasks)).not.toThrow();
    const sorted = dashboard.sortTasks(tasks);
    expect(sorted[0].id).toBe("valid");
  });

  it("normalizes catalog tasks with both created_at and updated_at", () => {
    const rawTask = {
      id: "raw_1",
      name: "Тест",
      created_at: "2026-02-01T00:00:00Z",
      modified: "2026-08-01T00:00:00Z",
    };
    const normalized = dashboard.normalizeCatalogTask(rawTask, {
      moduleId: "mod1",
      topicId: "top1",
    });

    expect(normalized.created_at).toBe("2026-02-01T00:00:00Z");
    expect(normalized.updated_at).toBe("2026-08-01T00:00:00Z");
  });

  it("collectAllTasks preserves updated_at from catalog topics", () => {
    const all = dashboard.collectAllTasks();
    expect(all.length).toBe(3);
    const taskA = all.find((t) => t.id === "task_old_created_recently_edited");
    expect(taskA).toBeDefined();
    expect(taskA.updated_at).toBe("2026-09-10T12:00:00Z");

    const taskV = all.find((t) => t.id === "task_middle_created_modified_field");
    expect(taskV).toBeDefined();
    expect(taskV.updated_at).toBe("2026-08-01T10:00:00Z");
  });

  it("createTaskCard renders modification date badge when updated_at differs from created_at", () => {
    const taskWithEdit = {
      id: "card_task",
      name: "Тестовая карточка",
      type: "test",
      moduleId: "mod1",
      topicId: "top1",
      created_at: "2026-01-01T10:00:00Z",
      updated_at: "2026-09-10T15:00:00Z",
    };

    const card = dashboard.createTaskCard(taskWithEdit);
    const dateText = card.querySelector("p.text-text-secondary")?.textContent || "";
    expect(dateText).toContain("Создано");
    expect(dateText).toContain("Изм.");
  });
});
