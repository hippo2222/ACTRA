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
      <div class="editor-header-actions">
        <input id="editor-search-input" />
        <button id="editor-author-note-filter" type="button" aria-pressed="false">
          <span class="material-symbols-outlined">flag</span>
          <span id="editor-author-note-filter-count" class="hidden">0</span>
        </button>
        <div data-role="sort-controller">
          <button data-role="sort-toggle" type="button"></button>
          <div data-role="sort-menu" class="hidden">
            <button data-sort-option="alphabet" type="button"><span data-role="sort-check"></span></button>
            <button data-sort-option="date" type="button"><span data-role="sort-check"></span></button>
            <button data-sort-option="type" type="button"><span data-role="sort-check"></span></button>
          </div>
          <span data-role="sort-label"></span>
        </div>
      </div>
    </header>

    <button data-role="create-task-card" type="button"></button>
    <button data-role="return-main" type="button"></button>
    <button data-role="open-recovery-center" type="button"></button>
    <button data-role="close-recovery-center" type="button"></button>

    <div id="create-task-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-module-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="create-topic-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="topic-theory-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="import-modal" class="hidden"><div class="bg-surface-1"></div></div>
    <div id="recovery-center-modal" class="hidden"><div id="recovery-center-content"></div></div>
    <div id="toast-container"></div>
  `;
}

describe("EditorDashboard Author Notes (Phase 3)", () => {
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
            modules: [],
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

  describe("hasTaskAuthorNote and getTaskAuthorNoteText", () => {
    it("returns true for open author note and false for resolved note", () => {
      const taskWithOpenNote = {
        id: "task-1",
        author_note: {
          text: "Fix question wording",
          status: "open",
        },
      };

      const taskWithResolvedNote = {
        id: "task-2",
        author_note: {
          text: "Already fixed",
          status: "resolved",
        },
      };

      const taskWithoutNote = {
        id: "task-3",
        author_note: null,
      };

      expect(dashboard.hasTaskAuthorNote(taskWithOpenNote)).toBe(true);
      expect(dashboard.getTaskAuthorNoteText(taskWithOpenNote)).toBe("Fix question wording");

      expect(dashboard.hasTaskAuthorNote(taskWithResolvedNote)).toBe(false);
      expect(dashboard.hasTaskAuthorNote(taskWithoutNote)).toBe(false);
      expect(dashboard.hasTaskAuthorNote(null)).toBe(false);
    });

    it("checks author_note in metadata or meta fallback", () => {
      const taskWithMetadataNote = {
        id: "task-4",
        metadata: {
          author_note: { text: "Note in metadata", status: "open" },
        },
      };

      expect(dashboard.hasTaskAuthorNote(taskWithMetadataNote)).toBe(true);
      expect(dashboard.getTaskAuthorNoteText(taskWithMetadataNote)).toBe("Note in metadata");
    });
  });

  describe("createTaskCard badge rendering (flags only, concise)", () => {
    it("renders flag icon badge with tooltip and NO textual label when task has author note", () => {
      const task = {
        id: "task-1",
        name: "Test task with note",
        type: "test",
        moduleId: "mod1",
        topicId: "top1",
        created_at: "2026-11-09T10:00:00Z",
        author_note: {
          text: "Correct option B typo",
          status: "open",
        },
      };

      const card = dashboard.createTaskCard(task, { animateEntrance: false });

      // Find all flag icons on the card
      const flagElements = Array.from(card.querySelectorAll(".material-symbols-outlined")).filter(
        (el) => el.textContent.trim() === "flag"
      );
      expect(flagElements.length).toBe(1);

      const flagBadge = flagElements[0].parentElement;
      expect(flagBadge.getAttribute("title")).toContain("Correct option B typo");

      // Verify that badge does NOT contain redundant text labels like "Заметка" or "Требует внимания"
      expect(flagBadge.textContent.trim()).toBe("flag");
    });

    it("does not render flag icon when task has no author note", () => {
      const task = {
        id: "task-2",
        name: "Test task without note",
        type: "test",
        moduleId: "mod1",
        topicId: "top1",
        created_at: "2026-11-09T10:00:00Z",
        author_note: null,
      };

      const card = dashboard.createTaskCard(task, { animateEntrance: false });
      const flagElements = Array.from(card.querySelectorAll(".material-symbols-outlined")).filter(
        (el) => el.textContent.trim() === "flag"
      );
      expect(flagElements.length).toBe(0);
    });
  });

  describe("Filtering tasks by author note", () => {
    it("filters grid to only tasks with author notes when filter is active", () => {
      const tasks = [
        {
          id: "t1",
          name: "Task One (with note)",
          type: "test",
          moduleId: "m1",
          topicId: "top1",
          created_at: "2026-11-09T10:00:00Z",
          author_note: { text: "Note on t1", status: "open" },
        },
        {
          id: "t2",
          name: "Task Two (clean)",
          type: "test",
          moduleId: "m1",
          topicId: "top1",
          created_at: "2026-11-09T10:00:00Z",
          author_note: null,
        },
        {
          id: "t3",
          name: "Task Three (with note)",
          type: "click",
          moduleId: "m1",
          topicId: "top1",
          created_at: "2026-11-09T10:00:00Z",
          author_note: { text: "Note on t3", status: "open" },
        },
      ];

      dashboard.catalog = [
        {
          id: "m1",
          name: "Module 1",
          topics: [
            {
              id: "top1",
              name: "Topic 1",
              tasks: tasks,
            },
          ],
        },
      ];

      // Initial render: all 3 tasks present
      dashboard.renderGrid();
      const grid = document.querySelector("main .grid");
      expect(grid.querySelectorAll(".task-card").length).toBe(3);

      // Filter button should display count = 2
      const filterBtn = document.getElementById("editor-author-note-filter");
      const countEl = document.getElementById("editor-author-note-filter-count");
      expect(countEl.textContent).toBe("2");
      expect(countEl.classList.contains("hidden")).toBe(false);

      // Toggle filter on
      filterBtn.click();
      expect(dashboard.showAuthorNoteTasks).toBe(true);
      expect(filterBtn.getAttribute("aria-pressed")).toBe("true");

      // Grid now contains only 2 tasks
      const filteredCards = grid.querySelectorAll(".task-card");
      expect(filteredCards.length).toBe(2);

      // Toggle filter off
      filterBtn.click();
      expect(dashboard.showAuthorNoteTasks).toBe(false);
      expect(filterBtn.getAttribute("aria-pressed")).toBe("false");
      expect(grid.querySelectorAll(".task-card").length).toBe(3);
    });

    it("displays empty state card when author notes filter finds no matches", () => {
      dashboard.catalog = [
        {
          id: "m1",
          name: "Module 1",
          topics: [
            {
              id: "top1",
              name: "Topic 1",
              tasks: [
                {
                  id: "t1",
                  name: "No note task",
                  type: "test",
                  moduleId: "m1",
                  topicId: "top1",
                  author_note: null,
                },
              ],
            },
          ],
        },
      ];

      dashboard.showAuthorNoteTasks = true;
      dashboard.renderGrid();

      const grid = document.querySelector("main .grid");
      expect(grid.querySelectorAll(".task-card").length).toBe(0);
      expect(grid.textContent).toContain("Нет заданий с заметками автора");
    });
  });
});
