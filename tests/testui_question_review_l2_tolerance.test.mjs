/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI L2 review tolerance feedback", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.eval(loadScript("frontend/TestUI/TestUI.question.js"));
  });

  it("shows normalized acceptance copy for level 2 open-answer review", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Введите термин", index: 0 }],
      rawQuestions: [{ type: "open_answer", content: { reference_answer: "Heart" } }],
      currentIndex: 0,
      answers: { q1: "Ghbdtn" },
      selections: { q1: true },
      questionResults: {
        q1: {
          status: "correct",
          tolerance_type: "normalized",
          normalization_kinds: ["layout"],
          details: { reference_answer: "Heart" },
        },
      },
      flags: {},
      isOpenMode: true,
      mode: "review",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    expect(main.textContent).toContain("Верно (нормализация)");
    expect(main.textContent).toContain(
      "Ответ засчитан после нормализации раскладки."
    );
    expect(main.querySelector('[data-testui="l2-reference-answer"]')).toBeTruthy();
    expect(main.querySelectorAll('[data-testui="l2-reference-diff"]').length).toBeGreaterThan(0);
  });

  it("highlights case-only differences in the reference answer diff", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Введите термин", index: 0 }],
      rawQuestions: [{ type: "open_answer", content: { reference_answer: "Heart" } }],
      currentIndex: 0,
      answers: { q1: "heart" },
      selections: { q1: true },
      questionResults: {
        q1: {
          status: "correct",
          tolerance_type: "typo",
          details: { reference_answer: "Heart" },
        },
      },
      flags: {},
      isOpenMode: true,
      mode: "review",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    const highlights = main.querySelectorAll('[data-testui="l2-reference-diff"]');
    expect(highlights.length).toBeGreaterThan(0);
    expect(highlights[0]?.textContent || "").toContain("H");
  });

  it("does not show typo acceptance copy for case-only accepted answers", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Введите термин", index: 0 }],
      rawQuestions: [{ type: "open_answer", content: { reference_answer: "Heart" } }],
      currentIndex: 0,
      answers: { q1: "heart" },
      selections: { q1: true },
      questionResults: {
        q1: {
          status: "correct",
          details: { reference_answer: "Heart" },
        },
      },
      flags: {},
      isOpenMode: true,
      mode: "review",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    expect(main.textContent).toContain("Верно");
    expect(main.textContent).not.toContain("опечат");
  });
});
