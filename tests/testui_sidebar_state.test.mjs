/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI sidebar states", () => {
  beforeEach(() => {
    document.body.innerHTML = '<ol id="question-panel-list"></ol>';
    window.eval(loadScript("frontend/TestUI/TestUI.sidebar.js"));
  });

  it("renders unvisited questions with a dashed border and visited ones with a solid border", () => {
    const listElement = document.getElementById("question-panel-list");
    const state = {
      currentIndex: 0,
      mode: "answering",
      questions: [{ id: "q1" }, { id: "q2" }, { id: "q3" }],
      selections: {},
      questionResults: {},
      visitedIndices: { 0: true, 1: true },
      flags: {},
    };

    window.TestUISidebar.renderSidebar({
      state,
      listElement,
      onSelectQuestion: () => {},
    });

    const items = Array.from(listElement.querySelectorAll("button"));
    expect(items).toHaveLength(3);
    expect(items[1]?.className || "").not.toContain("border-dashed");
    expect(items[2]?.className || "").toContain("border-dashed");
  });

  it("renders incorrect review questions with the error palette even when status is inferred", () => {
    const listElement = document.getElementById("question-panel-list");
    const state = {
      currentIndex: 0,
      mode: "review",
      questions: [{ id: "q1" }],
      selections: { q1: true },
      questionResults: {
        q1: {
          correct_option_ids: [2],
          user_option_ids: [0],
        },
      },
      visitedIndices: { 0: true },
      flags: {},
    };

    window.TestUISidebar.renderSidebar({
      state,
      listElement,
      onSelectQuestion: () => {},
    });

    const item = listElement.querySelector("button");
    expect(item?.className || "").toContain("bg-error-light");
  });

  it("highlights pending unanswered questions before review", () => {
    const listElement = document.getElementById("question-panel-list");
    const state = {
      currentIndex: 0,
      mode: "answering",
      questions: [{ id: "q1" }, { id: "q2" }],
      selections: {},
      questionResults: {},
      visitedIndices: { 0: true, 1: true },
      flags: {},
      pendingUnansweredQuestionIds: ["q2"],
    };

    window.TestUISidebar.renderSidebar({
      state,
      listElement,
      onSelectQuestion: () => {},
    });

    const items = Array.from(listElement.querySelectorAll("button"));
    expect(items).toHaveLength(2);
    expect(items[1]?.className || "").toContain("border-warning-light");
    expect(items[1]?.className || "").toContain("bg-warning-lighter");
  });
});
