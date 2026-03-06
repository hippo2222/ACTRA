/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/draft-storage.js"),
  "utf8"
);

function loadDraftStorage() {
  delete window.DraftStorage;
  window.eval(scriptCode);
  return window.DraftStorage;
}

describe("DraftStorage behavior", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    delete window.DraftStorage;
  });

  it("restores the same draft after module reload in the same tab", () => {
    const DraftStorageA = loadDraftStorage();
    const payload = { answer: "hello" };

    expect(DraftStorageA.saveDraft("s1", "t1", payload)).toBe(true);

    const DraftStorageB = loadDraftStorage();
    expect(DraftStorageB.loadDraft("s1", "t1")).toEqual(payload);
  });

  it("clears both tab-specific and legacy draft keys", () => {
    const DraftStorage = loadDraftStorage();
    DraftStorage.saveDraft("s1", "t1", { answer: "x" });
    localStorage.setItem(
      "session_draft_s1_t1",
      JSON.stringify({
        userInput: { answer: "legacy" },
        timestamp: Date.now(),
        sessionId: "s1",
        taskId: "t1",
      })
    );

    expect(DraftStorage.clearDraft("s1", "t1")).toBe(true);
    expect(
      Object.keys(localStorage).filter((key) => key.startsWith("session_draft_s1_t1"))
    ).toEqual([]);
  });
});
