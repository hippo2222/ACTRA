/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import "../frontend/OpenAnswerUI/OpenAnswerUI.web.js";

const OpenAnswerUI = window.OpenAnswerUI;

describe("OpenAnswerUI Single-Question In-Workspace Feedback", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="check-answer-btn" type="button"></button>
      <div id="open-answer-root"></div>
    `;
    OpenAnswerUI.cleanup();
  });

  it("renders feedback inside task card with success status and reference answer", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Какой предположительный диагноз?",
          reference_answer: "Плевральный выпот слева",
        },
      },
    });

    const textarea = container.querySelector("textarea");
    textarea.value = "плевральный выпот";

    const result = {
      success: true,
      score: 100.0,
      details: {
        success: true,
        found_keywords: ["плевральный", "выпот"],
        missing_keywords: [],
        reference_answer: "Плевральный выпот слева",
      },
    };

    OpenAnswerUI.applyCheckFeedback(result);

    const feedbackContainer = container.querySelector(".oa-single-feedback-container");
    expect(feedbackContainer).toBeTruthy();
    expect(feedbackContainer.classList.contains("hidden")).toBe(false);
    expect(feedbackContainer.textContent).toContain("Ответ принят");
    expect(feedbackContainer.textContent).toContain("плевральный");
    expect(feedbackContainer.textContent).toContain("выпот");
    expect(feedbackContainer.textContent).toContain("Плевральный выпот слева");
    expect(textarea.readOnly).toBe(true);
  });

  it("renders failure feedback with missing keywords and retry hint", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Опишите рентгенологическую картину",
        },
      },
    });

    const textarea = container.querySelector("textarea");
    textarea.value = "Затемнение";

    const result = {
      success: false,
      score: 0.0,
      details: {
        success: false,
        found_keywords: [],
        missing_keywords: ["ателектаз", "инфильтрация"],
      },
    };

    OpenAnswerUI.applyCheckFeedback(result);

    const feedbackContainer = container.querySelector(".oa-single-feedback-container");
    expect(feedbackContainer).toBeTruthy();
    expect(feedbackContainer.textContent).toContain("В ответе отсутствуют необходимые ключевые слова");
    expect(feedbackContainer.textContent).toContain("ателектаз");
    expect(feedbackContainer.textContent).toContain("инфильтрация");
  });

  it("displays sequence violation notice when keywords are present but out of order", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Укажите стадии процесса",
        },
      },
    });

    const result = {
      success: false,
      score: 0.0,
      details: {
        success: false,
        sequence_matters: true,
        found_keywords: ["фаза 2", "фаза 1"],
        total_keywords: 2,
        missing_keywords: [],
      },
    };

    OpenAnswerUI.applyCheckFeedback(result);

    const feedbackContainer = container.querySelector(".oa-single-feedback-container");
    expect(feedbackContainer).toBeTruthy();
    expect(feedbackContainer.textContent).toContain("Нарушена требуемая последовательность ключевых слов");
  });

  it("displays tolerance warning when accepted with typos", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Какой диагноз?",
        },
      },
    });

    const result = {
      success: true,
      score: 100.0,
      details: {
        success: true,
        found_keywords: ["пневмания"],
        tolerance_matches: [{ type: "typo", user_word: "пневмания", correct_word: "пневмония" }],
        tolerance_explanation: "Ответ засчитан с учётом опечатки: «пневмания» → «пневмония».",
      },
    };

    OpenAnswerUI.applyCheckFeedback(result);

    const feedbackContainer = container.querySelector(".oa-single-feedback-container");
    expect(feedbackContainer).toBeTruthy();
    expect(feedbackContainer.textContent).toContain("Ответ засчитан с учётом опечатки");
  });

  it("single-question card adheres to Anti-Matryoshka rule and uses WCAG AA contrast (DEF-08 & DEF-11)", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Опишите симптом",
          tolerance_type: "typo",
          tolerance_explanation: "Допущена опечатка в слове",
        },
      },
    });

    const card = container.querySelector(".oa-card-entry");
    expect(card).toBeTruthy();
    // Anti-matryoshka: card is not wrapped in redundant heavy bg-surface-2
    expect(card.className).not.toContain("bg-surface-2");

    // Textarea has crisp border
    const textarea = container.querySelector("textarea");
    expect(textarea.className).toContain("border-border-strong");

    // Apply feedback with tolerance
    OpenAnswerUI.applyCheckFeedback({
      success: true,
      score: 100,
      details: {
        success: true,
        tolerance_type: "typo",
        tolerance_explanation: "Допущена опечатка в слове",
        found_keywords: ["симптом"],
      },
    });

    // Tolerance note has text-amber-800 for WCAG 2.2 AA compliance >= 4.5:1
    const toleranceRow = container.querySelector(".text-amber-800");
    expect(toleranceRow).toBeTruthy();
    expect(toleranceRow.textContent).toContain("Допущена опечатка");
  });
});
