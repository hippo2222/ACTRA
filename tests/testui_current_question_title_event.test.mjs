/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI current question title event", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
    delete window.TestUI;
    delete window.TestUILayout;
    window.TestUIQuestion = {
      createQuestionRenderer(state, main) {
        return {
          renderQuestionView() {
            main.textContent = state.questions[state.currentIndex]?.text || "";
          },
        };
      },
    };
    delete window.TestUISidebar;
    const code = loadScript("frontend/TestUI/TestUI.web.js").replace(
      "const TestUI = (function () {",
      "window.__TestUIForTest = (function () {",
    );
    window.eval(code);
  });

  it("emits the source task title for each selected scattered question", () => {
    const events = [];
    window.addEventListener("test:current-question-changed", (event) => {
      events.push(event.detail);
    });

    const task = {
      difficulty: 1,
      task_data: {
        type: "test",
        content: {
          questions: [
            {
              id: "split_0",
              text: "Question from A",
              _split_source_task_name: "Task A",
              _split_source_task_ref: "m/t/test_A",
              answers: [{ text: "A", correct: true }, { text: "B", correct: false }],
            },
            {
              id: "split_1",
              text: "Question from B",
              _split_source_task_name: "Task B",
              _split_source_task_ref: "m/t/test_B",
              answers: [{ text: "A", correct: true }, { text: "B", correct: false }],
            },
          ],
        },
      },
    };

    window.__TestUIForTest.render(document.getElementById("root"), task);

    expect(events.at(-1)?.taskTitle).toBe("Task A");

    const secondQuestionButton = document.querySelectorAll("li")[1];
    expect(secondQuestionButton).toBeTruthy();
    secondQuestionButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(events.at(-1)?.taskTitle).toBe("Task B");
    expect(events.at(-1)?.sourceTaskRef).toBe("m/t/test_B");
  });
});
