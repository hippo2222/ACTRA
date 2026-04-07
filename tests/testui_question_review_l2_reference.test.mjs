/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI L2 review reference answer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.eval(loadScript("frontend/TestUI/TestUI.question.js"));
  });

  function renderQuestion(stateOverrides = {}) {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Назовите орган", index: 0 }],
      rawQuestions: [{ type: "open_answer", content: { reference_answer: "Печень" } }],
      currentIndex: 0,
      answers: { q1: "Сердце" },
      selections: { q1: true },
      questionResults: {
        q1: {
          status: "incorrect",
          details: { reference_answer: "Печень" },
        },
      },
      flags: {},
      isOpenMode: true,
      mode: "review",
      ...stateOverrides,
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();
    return main;
  }

  it("shows the reference answer for incorrect open-answer responses on level 2", () => {
    const main = renderQuestion();

    const referenceCard = main.querySelector('[data-testui="l2-reference-answer"]');
    expect(referenceCard).toBeTruthy();
    expect(referenceCard.textContent).toContain("Эталонный ответ");
    expect(referenceCard.textContent).toContain("Печень");
    expect(main.textContent).not.toContain("Ответ на этот вопрос не засчитан как верный.");
  });

  it("does not show the reference answer card for correct responses", () => {
    const main = renderQuestion({
      questionResults: {
        q1: {
          status: "correct",
          details: { reference_answer: "Печень" },
        },
      },
    });

    expect(main.querySelector('[data-testui="l2-reference-answer"]')).toBeNull();
  });

  it("reads reference answer from top-level feedback when details are absent", () => {
    const main = renderQuestion({
      questionResults: {
        q1: {
          status: "incorrect",
          reference_answer: "Печень",
        },
      },
    });

    const referenceCard = main.querySelector('[data-testui="l2-reference-answer"]');
    expect(referenceCard).toBeTruthy();
    expect(referenceCard.textContent).toContain("Печень");
  });

  it("falls back to correct answer options when explicit reference is absent", () => {
    const main = renderQuestion({
      rawQuestions: [
        {
          type: "open_answer",
          answers: [
            { text: "Печень", correct: true },
            { text: "Сердце", correct: false },
          ],
        },
      ],
      questionResults: {
        q1: {
          status: "incorrect",
          correct_option_ids: [0],
        },
      },
    });

    const referenceCard = main.querySelector('[data-testui="l2-reference-answer"]');
    expect(referenceCard).toBeTruthy();
    expect(referenceCard.textContent).toContain("Печень");
  });
});
