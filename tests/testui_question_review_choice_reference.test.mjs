/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI choice review reference answer", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.eval(loadScript("frontend/TestUI/TestUI.question.js"));
  });

  it("keeps only the review block for incorrect image-only answers", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Pick the correct image", index: 0 }],
      rawQuestions: [
        {
          type: "single_choice",
          answers: [
            {
              text: "Wrong image",
              image_url: "/images/wrong.png",
              correct: false,
            },
            {
              text: "Correct image",
              image_url: "/images/correct.png",
              correct: true,
            },
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
      isOpenMode: true,
      mode: "review",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    const reviewBlock = main.querySelector("section");
    expect(reviewBlock).toBeTruthy();
    expect(reviewBlock.textContent).toContain("Разбор ответа");
    expect(reviewBlock.textContent).toContain("Есть ошибка");
    expect(reviewBlock.textContent).toContain("Правильный");
    expect(reviewBlock.textContent).toContain("Ваш выбор");
    expect(reviewBlock.querySelectorAll("label")).toHaveLength(2);
    expect(reviewBlock.querySelectorAll("img")).toHaveLength(2);

    expect(
      main.querySelector('[data-testui="choice-user-answer"]')
    ).toBeNull();
    expect(
      main.querySelector('[data-testui="choice-reference-answer"]')
    ).toBeNull();
  });
});
