/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const managerSource = readFileSync(
  path.resolve(process.cwd(), "frontend/Editor/autosave_manager.js"),
  "utf8",
);

function getManagerClass() {
  return window.__EditorAutoSaveManager__;
}

describe("Editor AutoSaveManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.eval(`${managerSource}\nwindow.__EditorAutoSaveManager__ = AutoSaveManager;`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__EditorAutoSaveManager__;
  });

  it("treats ISO modified timestamps as older than a fresher local draft", () => {
    const Manager = getManagerClass();
    expect(Manager).toBeTypeOf("function");

    const manager = new Manager({
      taskId: "task_1",
      moduleId: "m1",
      topicId: "t1",
      captureState: () => ({ prompt: "draft" }),
      updateSaveStatus: vi.fn(),
    });

    localStorage.setItem(
      manager.getDraftKey(),
      JSON.stringify({
        taskId: "task_1",
        moduleId: "m1",
        topicId: "t1",
        timestamp: Date.parse("2026-03-12T02:00:00.000Z"),
        data: { prompt: "draft" },
      }),
    );

    expect(manager.hasFresherDraft("2026-03-12T01:00:00.000Z")).toBe(true);
    expect(manager.hasFresherDraft("2026-03-12T03:00:00.000Z")).toBe(false);
  });

  it("loads the freshest draft from legacy task id aliases", () => {
    const Manager = getManagerClass();
    expect(Manager).toBeTypeOf("function");

    const manager = new Manager({
      taskId: "1",
      moduleId: "m1",
      topicId: "t1",
      getDraftTaskIds: () => ["1", "legacy_uuid"],
      captureState: () => ({ prompt: "draft" }),
      updateSaveStatus: vi.fn(),
    });

    localStorage.setItem(
      "task_draft_m1_t1_legacy_uuid",
      JSON.stringify({
        taskId: "legacy_uuid",
        moduleId: "m1",
        topicId: "t1",
        timestamp: Date.parse("2026-03-12T02:30:00.000Z"),
        data: { prompt: "legacy draft" },
      }),
    );

    const draft = manager.loadDraft();
    expect(draft).toBeTruthy();
    expect(draft.taskId).toBe("legacy_uuid");
    expect(draft.data).toEqual({ prompt: "legacy draft" });
  });

  it("uses an owner-scoped key and ignores legacy drafts when owner is known", () => {
    const Manager = getManagerClass();
    expect(Manager).toBeTypeOf("function");

    const manager = new Manager({
      taskId: "task_1",
      moduleId: "m1",
      topicId: "t1",
      task: {
        metadata: {
          created_by_user_id: "editor-user",
        },
      },
      captureState: () => ({ prompt: "draft" }),
      updateSaveStatus: vi.fn(),
    });

    localStorage.setItem(
      "task_draft_m1_t1_task_1",
      JSON.stringify({
        taskId: "task_1",
        moduleId: "m1",
        topicId: "t1",
        timestamp: Date.parse("2026-03-12T02:30:00.000Z"),
        ownerUserId: "other-user",
        data: { prompt: "foreign draft" },
      }),
    );

    expect(manager.loadDraft()).toBeNull();

    manager.saveDraft();

    const scopedKey = "task_draft_v2_editor-user_m1_t1_task_1";
    const stored = JSON.parse(localStorage.getItem(scopedKey) || "null");
    expect(stored).toBeTruthy();
    expect(stored.ownerUserId).toBe("editor-user");
    expect(stored.data).toEqual({ prompt: "draft" });
  });
});
