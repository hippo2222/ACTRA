/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const managerSource = readFileSync(
  path.resolve(process.cwd(), "frontend/Complexes/complex_autosave_manager.js"),
  "utf8",
);

function getManagerClass() {
  return window.__ComplexAutoSaveManager__;
}

describe("ComplexAutoSaveManager", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    window.eval(`${managerSource}\nwindow.__ComplexAutoSaveManager__ = ComplexAutoSaveManager;`);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    delete window.__ComplexAutoSaveManager__;
  });

  it("lists local drafts sorted by freshness and can delete by key", () => {
    const Manager = getManagerClass();
    expect(Manager).toBeTypeOf("function");

    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(3000);

    const first = new Manager(
      {
        captureState: () => ({ name: "First draft" }),
      },
      { complexId: "first" },
    );
    const second = new Manager(
      {
        captureState: () => ({ name: "Second draft" }),
      },
      { complexId: "second" },
    );

    first.saveDraft();
    second.saveDraft();

    const drafts = first.listDrafts();
    expect(drafts.map((item) => item.id)).toEqual(["second", "first"]);
    expect(drafts[0].key).toBe("complex_draft_second");
    expect(drafts[0].data).toEqual({ name: "Second draft" });

    first.clearDraftByKey("complex_draft_second");
    expect(localStorage.getItem("complex_draft_second")).toBeNull();

    nowSpy.mockRestore();
  });

  it("returns localized status text when autosave fails", () => {
    const Manager = getManagerClass();
    const updateStatus = vi.fn();

    const manager = new Manager(
      {
        captureState: () => {
          throw new Error("boom");
        },
        updateStatus,
      },
      { complexId: "new" },
    );

    manager.saveDraft();

    expect(updateStatus).toHaveBeenCalledWith({
      error: true,
      message: "Автосохранение не выполнено",
    });
  });

  it("clears status callback when deleting current draft key", () => {
    const Manager = getManagerClass();
    const updateStatus = vi.fn();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2000);

    const manager = new Manager(
      {
        captureState: () => ({ value: 1 }),
        updateStatus,
      },
      { complexId: "abc" },
    );
    manager.saveDraft();
    manager.clearDraftByKey(manager.getDraftKey());

    expect(updateStatus).toHaveBeenLastCalledWith(null);
    nowSpy.mockRestore();
  });
});

