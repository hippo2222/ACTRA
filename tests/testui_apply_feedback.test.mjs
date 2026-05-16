/* @vitest-environment node */

import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function createTestUIWindow() {
  const dom = new JSDOM(
    '<div id="app"></div><aside><ol id="question-panel-list"></ol></aside>',
    { runScripts: "outside-only", url: "http://localhost/session/test" }
  );
  const { window } = dom;

  window.eval(loadScript("frontend/TestUI/testui-core.js"));
  window.eval(loadScript("frontend/TestUI/testui-layout.js"));
  window.eval(loadScript("frontend/TestUI/TestUI.sidebar.js"));
  window.eval(`
    var TestUIQuestion = window.TestUIQuestion = {
      createQuestionRenderer: function (_state, main) {
        return {
          renderQuestionView: function () {
            main.innerHTML = '<div data-testui="stub-question"></div>';
          }
        };
      }
    };
  `);
  window.eval(`${loadScript("frontend/TestUI/TestUI.web.js")}\nwindow.TestUI = TestUI;`);

  return window;
}

function renderBasicTest(window, questions) {
  window.TestUI.render(window.document.getElementById("app"), {
    task_type: "test",
    difficulty: 1,
    task_data: {
      task_type: "test",
      content: {
        questions,
        test_type: "single_choice",
      },
    },
  });
}

describe("TestUI applyCheckFeedback", () => {
  it("includes backend index aliases for answers to questions without ids", () => {
    const window = createTestUIWindow();
    renderBasicTest(window, [
      { text: "First", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
      { text: "Second", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
    ]);

    window.TestUI.restoreInput({
      answers: {
        q_1: 0,
      },
    });

    const payload = window.TestUI.getUserAnswerPayload();
    expect(payload.answers.q_1).toBe(0);
    expect(payload.answers["0"]).toBe(0);
  });

  it("maps index-keyed per_question feedback onto synthetic UI question ids", () => {
    const window = createTestUIWindow();
    renderBasicTest(window, [
      { text: "First", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
      { text: "Second", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
    ]);

    window.TestUI.applyCheckFeedback({
      success: false,
      details: {
        per_question: {
          "0": { status: "correct" },
          "1": { status: "incorrect" },
        },
      },
    });

    const items = Array.from(window.document.querySelectorAll("#question-panel-list button"));
    expect(items).toHaveLength(2);
    expect(items[0]?.className || "").toContain("bg-success-light");
    expect(items[1]?.className || "").toContain("bg-error-light");
  });

  it("synthesizes review statuses when backend returns no per_question map", () => {
    const window = createTestUIWindow();
    renderBasicTest(window, [
      { id: "q1", text: "First", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
      { id: "q2", text: "Second", answers: [{ text: "A", correct: true }, { text: "B", correct: false }] },
    ]);

    window.TestUI.restoreInput({
      answers: {
        q1: 0,
      },
    });
    window.TestUI.applyCheckFeedback({
      success: false,
      details: {
        error: "no_answers",
        level: 1,
      },
    });

    const items = Array.from(window.document.querySelectorAll("#question-panel-list button"));
    expect(items).toHaveLength(2);
    expect(items[0]?.className || "").toContain("bg-error-light");
    expect(items[1]?.className || "").toContain("bg-surface-2");
    expect(items[1]?.className || "").not.toContain("bg-error-light");
  });
});
