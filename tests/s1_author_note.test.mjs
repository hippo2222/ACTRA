/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const authorNoteCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/author-note.js"),
  "utf8"
);

function loadAuthorNoteUI() {
  delete window.AuthorNoteUI;
  window.eval(authorNoteCode);
  return window.AuthorNoteUI;
}

describe("S1 AuthorNoteUI", () => {
  let AuthorNoteUI;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="status-banner"></div>
      <div class="s1-toolbar-heading-row">
        <h1 id="current-task-title">–</h1>
        <button id="s1-author-note-btn" type="button" class="hidden">
          <span class="material-symbols-outlined">edit_note</span>
          <span id="s1-author-note-badge" class="hidden"></span>
        </button>
      </div>
      <dialog id="s1-author-note-dialog">
        <h2 id="s1-author-note-dialog-title">Заметка автора к заданию</h2>
        <button id="s1-author-note-close" type="button">X</button>
        <textarea id="s1-author-note-input" maxlength="2000"></textarea>
        <span id="s1-author-note-updated-at"></span>
        <span id="s1-author-note-char-count">0/2000</span>
        <button id="s1-author-note-delete" type="button" class="hidden">Удалить</button>
        <button id="s1-author-note-cancel" type="button">Отмена</button>
        <button id="s1-author-note-save" type="button"><span>Сохранить</span></button>
      </dialog>
    `;

    // Mock HTMLDialogElement methods in JSDOM if missing
    const dialogEl = document.getElementById("s1-author-note-dialog");
    if (!dialogEl.showModal) {
      dialogEl.showModal = vi.fn(function () {
        this.open = true;
        this.setAttribute("open", "");
      });
    }
    if (!dialogEl.close) {
      dialogEl.close = vi.fn(function () {
        this.open = false;
        this.removeAttribute("open");
      });
    }

    window.SessionState = {
      currentTask: null,
    };

    window.SessionRoutes = {
      API: {
        TASK_AUTHOR_NOTE: (m, t, id) => `/api/editor/task/${m}/${t}/${id}/author-note`,
      },
    };

    window.SessionAPI = {
      saveTaskAuthorNote: vi.fn(),
      getTaskAuthorNote: vi.fn(),
    };

    window.UIHelpers = {
      showStatus: vi.fn(),
    };

    window.wt = vi.fn((key, fallback) => fallback);

    AuthorNoteUI = loadAuthorNoteUI();
  });

  describe("syncAuthorNoteButton", () => {
    it("hides the button if task is null or not provided", () => {
      const btn = document.getElementById("s1-author-note-btn");
      btn.classList.remove("hidden");

      AuthorNoteUI.syncAuthorNoteButton(null);

      expect(btn.classList.contains("hidden")).toBe(true);
    });

    it("hides the button if author_meta.is_author is false", () => {
      const btn = document.getElementById("s1-author-note-btn");
      btn.classList.remove("hidden");

      const task = {
        task_id: "task-1",
        author_meta: { is_author: false, author_note: null },
      };

      AuthorNoteUI.syncAuthorNoteButton(task);

      expect(btn.classList.contains("hidden")).toBe(true);
    });

    it("shows the button without active note styling when is_author is true and no note exists", () => {
      const btn = document.getElementById("s1-author-note-btn");
      const badge = document.getElementById("s1-author-note-badge");

      const task = {
        task_id: "task-1",
        author_meta: { is_author: true, author_note: null },
      };

      AuthorNoteUI.syncAuthorNoteButton(task);

      expect(btn.classList.contains("hidden")).toBe(false);
      expect(btn.classList.contains("has-note")).toBe(false);
      expect(badge.classList.contains("hidden")).toBe(true);
    });

    it("shows active note indicator and badge when an open note exists", () => {
      const btn = document.getElementById("s1-author-note-btn");
      const badge = document.getElementById("s1-author-note-badge");

      const task = {
        task_id: "task-1",
        author_meta: {
          is_author: true,
          author_note: {
            text: "Fix typo in prompt",
            status: "open",
            updated_at: "2026-11-09T18:00:00Z",
          },
        },
      };

      AuthorNoteUI.syncAuthorNoteButton(task);

      expect(btn.classList.contains("hidden")).toBe(false);
      expect(btn.classList.contains("has-note")).toBe(true);
      expect(badge.classList.contains("hidden")).toBe(false);
      expect(btn.getAttribute("title")).toContain("Fix typo in prompt");
    });

    it("treats resolved status as not having an open note", () => {
      const btn = document.getElementById("s1-author-note-btn");
      const badge = document.getElementById("s1-author-note-badge");

      const task = {
        task_id: "task-1",
        author_meta: {
          is_author: true,
          author_note: {
            text: "Fixed earlier",
            status: "resolved",
          },
        },
      };

      AuthorNoteUI.syncAuthorNoteButton(task);

      expect(btn.classList.contains("hidden")).toBe(false);
      expect(btn.classList.contains("has-note")).toBe(false);
      expect(badge.classList.contains("hidden")).toBe(true);
    });
  });

  describe("openAuthorNoteDialog and closeAuthorNoteDialog", () => {
    it("does not open dialog if task is not owned by author", () => {
      const dialog = document.getElementById("s1-author-note-dialog");
      window.SessionState.currentTask = {
        author_meta: { is_author: false },
      };

      AuthorNoteUI.openAuthorNoteDialog();

      expect(dialog.open).toBeFalsy();
    });

    it("populates textarea and opens dialog for task author", () => {
      const dialog = document.getElementById("s1-author-note-dialog");
      const input = document.getElementById("s1-author-note-input");
      const deleteBtn = document.getElementById("s1-author-note-delete");
      const charCount = document.getElementById("s1-author-note-char-count");

      window.SessionState.currentTask = {
        module_id: "m1",
        topic_id: "t1",
        task_id: "task-1",
        author_meta: {
          is_author: true,
          author_note: {
            text: "Need to change option C",
            status: "open",
            updated_at: "2026-11-09T18:00:00Z",
          },
        },
      };

      AuthorNoteUI.openAuthorNoteDialog();

      expect(input.value).toBe("Need to change option C");
      expect(charCount.textContent).toBe("23/2000");
      expect(deleteBtn.classList.contains("hidden")).toBe(false);
      expect(dialog.open).toBe(true);
    });

    it("closes the dialog when closeAuthorNoteDialog is called", () => {
      const dialog = document.getElementById("s1-author-note-dialog");
      dialog.open = true;

      AuthorNoteUI.closeAuthorNoteDialog();

      expect(dialog.open).toBe(false);
    });
  });

  describe("saveAuthorNote", () => {
    it("saves note via API, updates task object, updates UI, and shows toast", async () => {
      const task = {
        module_id: "mod1",
        topic_id: "top1",
        task_id: "task1",
        author_meta: {
          is_author: true,
          author_note: null,
        },
      };
      window.SessionState.currentTask = task;

      AuthorNoteUI.openAuthorNoteDialog();

      const input = document.getElementById("s1-author-note-input");
      input.value = "Review this question";

      const savedNote = {
        text: "Review this question",
        status: "open",
        updated_at: "2026-11-09T18:30:00Z",
      };

      window.SessionAPI.saveTaskAuthorNote.mockResolvedValueOnce({
        status: 200,
        data: { ok: true, author_note: savedNote },
      });

      await AuthorNoteUI.saveAuthorNote();

      expect(window.SessionAPI.saveTaskAuthorNote).toHaveBeenCalledWith(
        "mod1",
        "top1",
        "task1",
        { text: "Review this question", status: "open" }
      );

      expect(task.author_meta.author_note).toEqual(savedNote);
      expect(window.UIHelpers.showStatus).toHaveBeenCalledWith(
        "Заметка сохранена",
        "success",
        expect.any(Object)
      );

      const btn = document.getElementById("s1-author-note-btn");
      expect(btn.classList.contains("has-note")).toBe(true);
      const dialog = document.getElementById("s1-author-note-dialog");
      expect(dialog.open).toBe(false);
    });

    it("calls delete when saving with empty text and existing note", async () => {
      const task = {
        module_id: "mod1",
        topic_id: "top1",
        task_id: "task1",
        author_meta: {
          is_author: true,
          author_note: { text: "Old note", status: "open" },
        },
      };
      window.SessionState.currentTask = task;

      AuthorNoteUI.openAuthorNoteDialog();

      const input = document.getElementById("s1-author-note-input");
      input.value = "   "; // cleared

      window.SessionAPI.saveTaskAuthorNote.mockResolvedValueOnce({
        status: 200,
        data: { ok: true, author_note: null },
      });

      await AuthorNoteUI.saveAuthorNote();

      expect(window.SessionAPI.saveTaskAuthorNote).toHaveBeenCalledWith(
        "mod1",
        "top1",
        "task1",
        { delete: true }
      );
      expect(task.author_meta.author_note).toBeNull();
      expect(window.UIHelpers.showStatus).toHaveBeenCalledWith(
        "Заметка удалена",
        "info",
        expect.any(Object)
      );
    });
  });

  describe("deleteAuthorNote", () => {
    it("deletes note via API, resets task author_note to null, and updates UI", async () => {
      const task = {
        module_id: "mod1",
        topic_id: "top1",
        task_id: "task1",
        author_meta: {
          is_author: true,
          author_note: { text: "Something to delete", status: "open" },
        },
      };
      window.SessionState.currentTask = task;

      AuthorNoteUI.syncAuthorNoteButton(task);
      AuthorNoteUI.openAuthorNoteDialog();

      window.SessionAPI.saveTaskAuthorNote.mockResolvedValueOnce({
        status: 200,
        data: { ok: true, author_note: null },
      });

      await AuthorNoteUI.deleteAuthorNote();

      expect(window.SessionAPI.saveTaskAuthorNote).toHaveBeenCalledWith(
        "mod1",
        "top1",
        "task1",
        { delete: true }
      );
      expect(task.author_meta.author_note).toBeNull();
      const btn = document.getElementById("s1-author-note-btn");
      expect(btn.classList.contains("has-note")).toBe(false);
      expect(window.UIHelpers.showStatus).toHaveBeenCalledWith(
        "Заметка удалена",
        "info",
        expect.any(Object)
      );
    });
  });

  describe("init event binding", () => {
    it("binds click to button to open dialog and cancel to close dialog", () => {
      AuthorNoteUI.init();

      const task = {
        module_id: "m",
        topic_id: "t",
        task_id: "k",
        author_meta: { is_author: true, author_note: null },
      };
      window.SessionState.currentTask = task;
      AuthorNoteUI.syncAuthorNoteButton(task);

      const btn = document.getElementById("s1-author-note-btn");
      const dialog = document.getElementById("s1-author-note-dialog");

      btn.click();
      expect(dialog.open).toBe(true);

      const cancelBtn = document.getElementById("s1-author-note-cancel");
      cancelBtn.click();
      expect(dialog.open).toBe(false);
    });

    it("triggers save on Ctrl+Enter in textarea", async () => {
      AuthorNoteUI.init();

      const task = {
        module_id: "m",
        topic_id: "t",
        task_id: "k",
        author_meta: { is_author: true, author_note: null },
      };
      window.SessionState.currentTask = task;

      const input = document.getElementById("s1-author-note-input");
      input.value = "Ctrl Enter note";

      window.SessionAPI.saveTaskAuthorNote.mockResolvedValueOnce({
        status: 200,
        data: { ok: true, author_note: { text: "Ctrl Enter note", status: "open" } },
      });

      const event = new KeyboardEvent("keydown", {
        key: "Enter",
        ctrlKey: true,
        bubbles: true,
      });
      input.dispatchEvent(event);

      // Allow microtask to complete
      await new Promise((r) => setTimeout(r, 0));

      expect(window.SessionAPI.saveTaskAuthorNote).toHaveBeenCalledWith(
        "m",
        "t",
        "k",
        { text: "Ctrl Enter note", status: "open" }
      );
    });
  });
});
