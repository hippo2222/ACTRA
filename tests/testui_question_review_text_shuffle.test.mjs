/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI text choice review with shuffled answers", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.eval(loadScript("frontend/TestUI/TestUI.question.js"));
  });

  it("marks the shuffled wrong user choice instead of the original option index", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Pick the correct answer", index: 0 }],
      rawQuestions: [
        {
          type: "single_choice",
          answers: [
            { text: "Shuffled wrong option", correct: false },
            { text: "Shuffled correct option", correct: true },
            { text: "Another wrong option", correct: false },
          ],
        },
      ],
      currentIndex: 0,
      answers: { q1: 0 },
      selections: { q1: true },
      questionResults: {
        q1: {
          status: "incorrect",
          correct_option_ids: [1],
          user_option_ids: [0],
        },
      },
      flags: {},
      isOpenMode: false,
      mode: "review",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    const optionRows = Array.from(main.querySelectorAll("label"));
    expect(optionRows).toHaveLength(3);

    const wrongChosenRow = optionRows.find((row) =>
      row.textContent.includes("Shuffled wrong option")
    );
    const correctRow = optionRows.find((row) =>
      row.textContent.includes("Shuffled correct option")
    );
    const untouchedWrongRow = optionRows.find((row) =>
      row.textContent.includes("Another wrong option")
    );

    expect(wrongChosenRow?.textContent).toContain("Ваш выбор");
    expect(correctRow?.textContent).toContain("Правильный");
    expect(untouchedWrongRow?.textContent).not.toContain("Ваш выбор");
    expect(untouchedWrongRow?.textContent).not.toContain("Правильный");
  });
});
