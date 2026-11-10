/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const questionScript = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/TestUI/TestUI.question.js"),
  "utf8"
);

function initTestUIQuestion() {
  window.eval(questionScript);
  return window.TestUIQuestion;
}

describe("TestUI Multiple Choice Indicators (Level 1 & Level 2)", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="test-host"></div>';
    window.i18n = {
      t: (key) => {
        const dict = {
          "testui_q.instruction_select_single": "Выберите один верный вариант",
          "testui_q.instruction_select_multiple": "Выберите все верные варианты",
          "testui_q.open_multiple_hint": "Вопрос предполагает несколько ответов — перечислите все верные варианты",
          "testui_q.placeholder_enter_multiple": "Перечислите верные ответы (через запятую или точку с запятой)...",
          "testui_q.enter_answer": "Введите точный ответ",
          "testui_q.your_answer": "Ваш ответ:",
          "testui_q.explanation_title": "Пояснение",
        };
        return dict[key] || key;
      },
    };
  });

  it("Level 1 single-choice: renders radio buttons and single-choice instruction badge", () => {
    const TestUIQuestion = initTestUIQuestion();
    const currentMeta = { id: "q1", text: "Одиночный вопрос", index: 0 };
    const raw = {
      id: "q1",
      text: "Одиночный вопрос",
      answers: [
        { id: 0, text: "Вариант А", correct: true },
        { id: 1, text: "Вариант Б", correct: false },
      ],
    };
    const state = {
      questions: [currentMeta],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: {},
      selections: {},
      flags: {},
      mode: "answering",
      isOpenMode: false,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    const badge = main.querySelector('[data-testui="choice-instruction-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("Выберите один верный вариант");

    const radioIcons = main.querySelectorAll('[data-testui="choice-radio"]');
    expect(radioIcons.length).toBe(2);

    const checkboxIcons = main.querySelectorAll('[data-testui="choice-checkbox"]');
    expect(checkboxIcons.length).toBe(0);
  });

  it("Level 1 multiple-choice: renders checkboxes and multiple-choice instruction badge", () => {
    const TestUIQuestion = initTestUIQuestion();
    const currentMeta = { id: "q2", text: "Множественный вопрос", index: 0 };
    const raw = {
      id: "q2",
      text: "Множественный вопрос",
      answers: [
        { id: 0, text: "Вариант А", correct: true },
        { id: 1, text: "Вариант Б", correct: true },
        { id: 2, text: "Вариант В", correct: false },
      ],
    };
    const state = {
      questions: [currentMeta],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: {},
      selections: {},
      flags: {},
      mode: "answering",
      isOpenMode: false,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    const badge = main.querySelector('[data-testui="choice-instruction-badge"]');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain("Выберите все верные варианты");

    const checkboxes = main.querySelectorAll('[data-testui="choice-checkbox"]');
    expect(checkboxes.length).toBe(3);

    const radios = main.querySelectorAll('[data-testui="choice-radio"]');
    expect(radios.length).toBe(0);
  });

  it("Level 2 multiple-choice question in open mode: renders non-spoiling open-multiple hint and plural placeholder", () => {
    const TestUIQuestion = initTestUIQuestion();
    const currentMeta = { id: "q3", text: "Открытый вопрос с несколькими ответами", index: 0 };
    const raw = {
      id: "q3",
      text: "Открытый вопрос с несколькими ответами",
      answers: [
        { id: 0, text: "Первый ответ", correct: true },
        { id: 1, text: "Второй ответ", correct: true },
      ],
    };
    const state = {
      questions: [currentMeta],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: {},
      selections: {},
      flags: {},
      mode: "answering",
      isOpenMode: true,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    const hint = main.querySelector('[data-testui="open-multiple-hint"]');
    expect(hint).toBeTruthy();
    expect(hint.textContent).toContain("Вопрос предполагает несколько ответов — перечислите все верные варианты");

    const textarea = main.querySelector("textarea");
    expect(textarea).toBeTruthy();
    expect(textarea.placeholder).toContain("Перечислите верные ответы");
  });

  it("Review mode: renders author explanation when present", () => {
    const TestUIQuestion = initTestUIQuestion();
    const currentMeta = { id: "q4", text: "Вопрос с пояснением", index: 0 };
    const raw = {
      id: "q4",
      text: "Вопрос с пояснением",
      explanation: "Клиническое пояснение: симптом обусловлен поражением зоны.",
      answers: [
        { id: 0, text: "Вариант А", correct: true },
        { id: 1, text: "Вариант Б", correct: false },
      ],
    };
    const state = {
      questions: [currentMeta],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: { q4: 0 },
      selections: { q4: true },
      flags: {},
      questionResults: {
        q4: { correct: true, status: "correct" },
      },
      mode: "review",
      isOpenMode: false,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    const explanationCard = main.querySelector('[data-testui="question-explanation"]');
    expect(explanationCard).toBeTruthy();
    expect(explanationCard.textContent).toContain("Клиническое пояснение: симптом обусловлен поражением зоны.");
    expect(explanationCard.textContent).toContain("Пояснение");
  });

  it("extracts question text from raw.question or raw.prompt when raw.text is missing (DEF-05)", () => {
    const TestUIQuestion = initTestUIQuestion();
    const raw = {
      id: "q_prompt",
      question: "Какое изменение корня легкого является патогномоничным?",
      answers: [
        { id: 0, text: "Полициклический контур", correct: true },
        { id: 1, text: "Обеднение рисунка", correct: false },
      ],
    };
    const state = {
      questions: [{ id: "q_prompt", index: 0 }],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: {},
      selections: {},
      flags: {},
      mode: "answering",
      isOpenMode: false,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    expect(main.textContent).toContain("Какое изменение корня легкого является патогномоничным?");
    expect(main.textContent).not.toContain("Вопрос теста");
  });

  it("selected text option renders anti-matryoshka subtle tint with primary filled indicator (DEF-09)", () => {
    const TestUIQuestion = initTestUIQuestion();
    const raw = {
      id: "q_style",
      text: "Тестовый вопрос на стили",
      answers: [
        { id: 0, text: "Вариант А", correct: true },
        { id: 1, text: "Вариант Б", correct: false },
      ],
    };
    const state = {
      questions: [{ id: "q_style", index: 0 }],
      rawQuestions: [raw],
      currentIndex: 0,
      answers: { q_style: 0 },
      selections: { q_style: true },
      flags: {},
      mode: "answering",
      isOpenMode: false,
    };
    const main = document.getElementById("test-host");
    const renderer = TestUIQuestion.createQuestionRenderer(state, main);

    renderer.renderQuestionView();

    const labels = main.querySelectorAll("label");
    expect(labels.length).toBe(2);
    // Selected option has subtle tint and primary border, NOT solid dark bg-primary
    expect(labels[0].className).toContain("bg-primary/5");
    expect(labels[0].className).toContain("border-primary");
    expect(labels[0].className).not.toContain("bg-primary ");

    // Selected icon has tui-choice-icon--selected class
    const icon0 = labels[0].querySelector('[data-testui="choice-radio"]');
    expect(icon0).toBeTruthy();
    expect(icon0.className).toContain("tui-choice-icon--selected");
  });
});
