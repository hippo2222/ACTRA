import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, "utf8");
}

function setupDom() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    url: "http://localhost",
    runScripts: "dangerously",
    resources: "usable",
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;

  return dom;
}

describe("TestUI fallback question renderer", () => {
  let dom;

  beforeEach(() => {
    dom = setupDom();
    const code = loadScript("frontend/TestUI/testui-question.js");
    dom.window.eval(code);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderQuestion(stateOverrides = {}) {
    const state = {
      questions: [{ id: "q1", text: "Question 1" }],
      rawQuestions: [
        {
          type: "single_choice",
          answers: [{ text: "Option A" }],
        },
      ],
      currentIndex: 0,
      answers: {},
      flags: {},
      ...stateOverrides,
    };
    const main = dom.window.document.createElement("div");
    dom.window.document.body.appendChild(main);
    const renderer = dom.window.TestUIQuestion.createQuestionRenderer(
      state,
      main
    );
    renderer.renderQuestionView();
    const checkBtn = [...main.querySelectorAll("button")].find(
      (btn) => btn.textContent === "Check Answer"
    );
    return { checkBtn };
  }

  it("uses state onCheckRequested when bridge is missing", () => {
    const onCheckRequested = vi.fn();
    const { checkBtn } = renderQuestion({ onCheckRequested });

    expect(checkBtn).toBeTruthy();
    checkBtn.click();

    expect(onCheckRequested).toHaveBeenCalledTimes(1);
  });

  it("shows a warning toast when no check handler is available", () => {
    const toast = vi.fn();
    dom.window.NotificationUI = { toast };
    const { checkBtn } = renderQuestion();

    expect(checkBtn).toBeTruthy();
    checkBtn.click();

    expect(toast).toHaveBeenCalledWith(
      "Check is unavailable on this screen.",
      "warning"
    );
  });
});
