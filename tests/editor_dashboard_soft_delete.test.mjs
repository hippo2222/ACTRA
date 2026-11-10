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

describe("EditorDashboard Optimistic Soft-Delete and In-Place Updates", () => {
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
                        id: "task_1",
                        name: "Задание 1",
                        type: "test",
                      },
                      {
                        id: "task_2",
                        name: "Задание 2",
                        type: "click",
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
    await dashboard.loadCatalog();
  });

  afterEach(() => {
    delete window.__EDITOR_DASHBOARD_SUPPRESS_IMPORT_MANAGER_WARNING__;
    vi.restoreAllMocks();
  });

  it("does not render dangerous quick-delete buttons on card or sidebar item to prevent accidental deletion", () => {
    const task = {
      id: "task_test_btn",
      name: "Тестовое задание",
      type: "test",
      moduleId: "mod1",
      topicId: "top1",
    };

    // 1. Task Card must NOT have delete-task icon next to title
    const card = dashboard.createTaskCard(task);
    const cardDelBtn = card.querySelector('[data-action="delete-task"]');
    expect(cardDelBtn).toBeNull();

    // 2. Sidebar Task Element must NOT have sidebar-delete-task icon
    const sidebarBtn = dashboard.createTaskElement(task, "mod1", "top1");
    const sideDelBtn = sidebarBtn.querySelector('[data-action="sidebar-delete-task"]');
    expect(sideDelBtn).toBeNull();
  });

  it("executes soft-delete with 6-second undo toast without immediate network deletion", async () => {
    vi.useFakeTimers();

    const card = document.querySelector('article[data-task-id="mod1:top1:task_1"]') || dashboard.createTaskCard({ id: "task_1", moduleId: "mod1", topicId: "top1", name: "Задание 1" });
    if (!card.parentNode) {
      document.querySelector("main .grid").appendChild(card);
    }

    dashboard.executeSoftDeleteTasks([{
      module_id: "mod1",
      topic_id: "top1",
      task_id: "task_1",
    }]);

    // Exit transition begins
    expect(card.classList.contains("task-card--deleting")).toBe(true);

    // Toast is displayed with 6s countdown
    const toast = document.querySelector("#toast-container div");
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain("Задание удалено");
    expect(toast.textContent).toContain("Отменить");

    // Advance 200ms: card is hidden from display via FLIP
    vi.advanceTimersByTime(200);
    expect(card.style.display).toBe("none");

    // Network request has NOT been made yet!
    const deleteCalls = global.fetch.mock.calls.filter(call => call[0] === "/api/editor/tasks/delete");
    expect(deleteCalls.length).toBe(0);

    // Advance timer past 6000ms: commitDeletion executes
    await vi.advanceTimersByTimeAsync(6000);

    const postDeleteCalls = global.fetch.mock.calls.filter(call => call[0] === "/api/editor/tasks/delete");
    expect(postDeleteCalls.length).toBe(1);
    expect(JSON.parse(postDeleteCalls[0][1].body)).toEqual({
      tasks: [{ module_id: "mod1", topic_id: "top1", task_id: "task_1" }],
    });

    vi.useRealTimers();
  });

  it("clicking Undo immediately restores the cards and cancels pending deletion", () => {
    vi.useFakeTimers();

    const card = document.querySelector('article[data-task-id="mod1:top1:task_1"]');
    expect(card).not.toBeNull();

    dashboard.executeSoftDeleteTasks([{
      module_id: "mod1",
      topic_id: "top1",
      task_id: "task_1",
    }]);

    vi.advanceTimersByTime(200);
    expect(card.style.display).toBe("none");

    // Click Undo button
    const undoBtn = document.querySelector("#toast-container button");
    expect(undoBtn).not.toBeNull();
    undoBtn.click();

    // Card is restored
    expect(card.style.display).toBe("");

    // Advance past 6000ms: ensure network delete was NOT sent
    vi.advanceTimersByTime(7000);
    const deleteCalls = global.fetch.mock.calls.filter(call => call[0] === "/api/editor/tasks/delete");
    expect(deleteCalls.length).toBe(0);

    vi.useRealTimers();
  });

  it("cancelSelection unchecks cards and resets selection without clearing grid DOM", () => {
    const card = document.querySelector('article[data-task-id="mod1:top1:task_1"]');
    expect(card).not.toBeNull();
    const grid = document.querySelector("main .grid");

    const refreshSpy = vi.spyOn(dashboard, "refreshCurrentView");

    // Enter selection
    dashboard.selectionMode = true;
    dashboard.selectedTasks.add("mod1:top1:task_1");
    const cb = card.querySelector('input[type="checkbox"]');
    cb.checked = true;
    card.classList.add("ring-2", "border-primary");

    // Cancel selection
    dashboard.cancelSelection({ rerender: false });

    expect(cb.checked).toBe(false);
    expect(card.classList.contains("border-primary")).toBe(false);
    expect(dashboard.selectedTasks.size).toBe(0);
    expect(refreshSpy).not.toHaveBeenCalled();
    // Card DOM was preserved in-place (not wiped)
    expect(grid.contains(card)).toBe(true);
  });

  it("toggleFavoriteTask updates the card favorite star in-place without clearing grid DOM", () => {
    const card = document.querySelector('article[data-task-id="mod1:top1:task_1"]');
    expect(card).not.toBeNull();
    const grid = document.querySelector("main .grid");

    const refreshSpy = vi.spyOn(dashboard, "refreshCurrentView");

    // Add to favorites
    dashboard.toggleFavoriteTask({
      uniqueId: "mod1:top1:task_1",
      moduleId: "mod1",
      topicId: "top1",
      taskId: "task_1",
      name: "Задание 1",
    });

    const favBtn = card.querySelector('[data-action="favorite-task"]');
    const icon = favBtn.querySelector(".material-symbols-outlined");
    expect(icon.textContent).toBe("star");
    expect(favBtn.classList.contains("text-warning-dark")).toBe(true);
    expect(refreshSpy).not.toHaveBeenCalled();

    // Remove from favorites
    dashboard.toggleFavoriteTask({
      uniqueId: "mod1:top1:task_1",
      moduleId: "mod1",
      topicId: "top1",
      taskId: "task_1",
      name: "Задание 1",
    });

    expect(icon.textContent).toBe("star_outline");
    expect(favBtn.classList.contains("text-text-disabled")).toBe(true);
    expect(refreshSpy).not.toHaveBeenCalled();
    // Grid DOM was preserved in-place
    expect(grid.contains(card)).toBe(true);
  });
});
