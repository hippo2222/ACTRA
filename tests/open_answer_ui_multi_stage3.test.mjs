/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import "../frontend/OpenAnswerUI/OpenAnswerUI.web.js";

const OpenAnswerUI = window.OpenAnswerUI;

describe("OpenAnswerUI Stage 3 Multi-Question & Progression", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="check-answer-btn" type="button"></button>
      <div id="open-answer-root"></div>
    `;
    OpenAnswerUI.cleanup();
  });

  it("renders case context preamable when case_text is present", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          case_text: "Пациент 45 лет поступил с жалобами на одышку.",
          questions: [
            { id: "q1", question: "Какой предположительный диагноз?", keywords: ["пневмония"] },
            { id: "q2", question: "Какие исследования назначить?", keywords: ["кт"] },
          ],
          display_mode: "simultaneous",
        },
      },
    });

    const caseBlock = container.querySelector('[data-openanswerui="case-context"]');
    expect(caseBlock).toBeTruthy();
    expect(caseBlock.textContent).toContain("Пациент 45 лет поступил с жалобами на одышку");
  });

  it("renders simultaneous mode with multiple question cards and collects all answers in payload", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          case_text: "Клинический кейс",
          questions: [
            { id: "q1", question: "Вопрос 1: Локализация?", max_length: 50 },
            { id: "q2", question: "Вопрос 2: Дифференциальный диагноз?", max_length: 100 },
          ],
          display_mode: "simultaneous",
        },
      },
    });

    const textareas = container.querySelectorAll("textarea");
    expect(textareas.length).toBe(2);
    expect(textareas[0].getAttribute("data-qid")).toBe("q1");
    expect(textareas[1].getAttribute("data-qid")).toBe("q2");

    // Initially check button disabled
    const checkBtn = document.getElementById("check-answer-btn");
    expect(checkBtn.disabled).toBe(true);
    expect(OpenAnswerUI.isAnswerValid()).toBe(false);

    // Fill only first question
    textareas[0].value = "Правое легкое";
    textareas[0].dispatchEvent(new window.Event("input"));
    expect(checkBtn.disabled).toBe(true);
    expect(OpenAnswerUI.isAnswerValid()).toBe(false);

    // Fill second question
    textareas[1].value = "Пневмония или туберкулез";
    textareas[1].dispatchEvent(new window.Event("input"));
    expect(checkBtn.disabled).toBe(false);
    expect(OpenAnswerUI.isAnswerValid()).toBe(true);

    const payload = OpenAnswerUI.getUserAnswerPayload();
    expect(payload.answers).toEqual({
      q1: "Правое легкое",
      q2: "Пневмония или туберкулез",
    });
    expect(payload.answer).toBe("Правое легкое");
  });

  it("restores draft answers for multiple questions in simultaneous mode", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          questions: [
            { id: "q1", question: "Вопрос 1" },
            { id: "q2", question: "Вопрос 2" },
          ],
          display_mode: "simultaneous",
        },
      },
    });

    OpenAnswerUI.restoreInput({
      answers: {
        q1: "Ответ на первый вопрос",
        q2: "Ответ на второй вопрос",
      },
    });

    const textareas = container.querySelectorAll("textarea");
    expect(textareas[0].value).toBe("Ответ на первый вопрос");
    expect(textareas[1].value).toBe("Ответ на второй вопрос");
    expect(document.getElementById("check-answer-btn").disabled).toBe(false);
  });

  it("handles sequential mode step-by-step reasoning with reference answer reveal", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          questions: [
            { id: "q1", question: "Шаг 1: Опишите тень", reference_answer: "Очаговая тень 2 см" },
            { id: "q2", question: "Шаг 2: Какая тактика?", reference_answer: "Биопсия" },
          ],
          display_mode: "sequential",
        },
      },
    });

    // Step indicator
    expect(container.textContent).toContain("1 из 2");

    // Initially on step 1
    const ta1 = container.querySelector('textarea[data-qid="q1"]');
    expect(ta1).toBeTruthy();
    expect(container.querySelector('textarea[data-qid="q2"]')).toBeNull();

    const nextBtn = container.querySelector(".oa-next-step-btn");
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.disabled).toBe(true);

    // Type answer for step 1
    ta1.value = "Круглая тень в верхней доле";
    ta1.dispatchEvent(new window.Event("input"));
    expect(nextBtn.disabled).toBe(false);

    // Advance to step 2
    nextBtn.click();

    // Now step 2 is active
    expect(container.textContent).toContain("2 из 2");
    const ta2 = container.querySelector('textarea[data-qid="q2"]');
    expect(ta2).toBeTruthy();

    // Past step 1 is displayed in read-only with reference answer revealed
    expect(container.textContent).toContain("Круглая тень в верхней доле");
    expect(container.textContent).toContain("Очаговая тень 2 см");

    // Enter answer for step 2
    ta2.value = "Выполнить биопсию узла";
    ta2.dispatchEvent(new window.Event("input"));

    const payload = OpenAnswerUI.getUserAnswerPayload();
    expect(payload.answers.q1).toBe("Круглая тень в верхней доле");
    expect(payload.answers.q2).toBe("Выполнить биопсию узла");
  });

  it("applies check feedback per question and locks passed questions for smart partial retry", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          questions: [
            { id: "q1", question: "Вопрос 1", keywords: ["пневмония", "долевая"] },
            { id: "q2", question: "Вопрос 2", keywords: ["антибиотики"] },
          ],
          display_mode: "simultaneous",
        },
      },
    });

    const textareas = container.querySelectorAll("textarea");
    textareas[0].value = "пневмония долевая";
    textareas[1].value = "витамины";

    // Simulate evaluator result: q1 passed, q2 failed
    const evaluationResult = {
      success: false,
      score: 50.0,
      details: {
        questions: {
          q1: {
            success: true,
            score: 100.0,
            found_keywords: ["пневмония", "долевая"],
            missing_keywords: [],
            reference_answer: "Пневмония долевая",
          },
          q2: {
            success: false,
            score: 0.0,
            found_keywords: [],
            missing_keywords: ["антибиотики"],
            reference_answer: "Антибактериальная терапия",
          },
        },
      },
    };

    OpenAnswerUI.applyCheckFeedback(evaluationResult);

    // Q1 textarea should be locked (passed)
    expect(textareas[0].readOnly).toBe(true);
    expect(textareas[0].disabled).toBe(true);

    // Q2 textarea should remain editable for retry
    expect(textareas[1].readOnly).toBe(false);
    expect(textareas[1].disabled).toBe(false);

    // Feedback chips check
    const q1Feedback = container.querySelector('[data-feedback-qid="q1"]');
    expect(q1Feedback.textContent).toContain("пневмония");
    expect(q1Feedback.textContent).toContain("Ответ принят");

    const q2Feedback = container.querySelector('[data-feedback-qid="q2"]');
    expect(q2Feedback.textContent).toContain("антибиотики");
    expect(q2Feedback.textContent).toContain("В ответе отсутствуют");
  });
});
