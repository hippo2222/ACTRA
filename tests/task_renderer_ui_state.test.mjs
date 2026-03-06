/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, "utf8");
}

function buildShell() {
  document.body.innerHTML = `
    <div id="status-banner"></div>
    <div id="task-title"></div>
    <div id="task-meta"></div>
    <div id="task-ref-label"></div>
    <div id="task-description"></div>
    <div id="task-image"></div>
    <div id="progress-label"></div>
    <div id="difficulty-label"></div>
    <div id="progress-bar"></div>
    <div id="task-header-meta"></div>
    <div id="task-header-block"></div>
    <button id="check-answer-btn" type="button"></button>
    <button id="next-task-btn" type="button"></button>
    <div id="task-content"></div>
    <div id="result-box">
      <div id="result-inner">
        <div id="result-header">
          <div id="result-icon-wrap"><span id="result-icon"></span></div>
          <div id="result-title"></div>
        </div>
        <div id="result-message"></div>
        <div id="result-details"></div>
        <div id="result-keywords"></div>
        <div id="result-user-answer"></div>
        <div id="result-reference">
          <div id="result-reference-card">
            <div id="result-reference-title"></div>
            <div id="result-reference-text"></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function initTaskRenderer() {
  window.requestAnimationFrame =
    window.requestAnimationFrame || ((cb) => cb());
  global.requestAnimationFrame = window.requestAnimationFrame;

  window.SessionState = {
    currentTask: null,
    paused: false,
    isLoading: false,
    canGoNext: false,
    sessionId: "sess-1",
  };
  window.UIHelpers = {
    setCanGoNext: vi.fn(),
    showStatus: vi.fn(),
  };
  window.DraftStorage = {
    loadDraft: vi.fn(() => null),
  };

  delete window.TaskRenderer;
  window.eval(loadScript("frontend/S1/task-renderer.js"));
  return window.TaskRenderer;
}

describe("TaskRenderer UI state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    buildShell();
  });

  afterEach(() => {
    delete global.requestAnimationFrame;
  });

  it("clears stale task UI when no task is available", () => {
    const TaskRenderer = initTaskRenderer();
    document.getElementById("task-content").innerHTML =
      '<button id="stale-content">Old task</button>';
    document.getElementById("result-box").classList.remove("hidden");
    document.getElementById("status-banner").textContent = "Old error";
    document.getElementById("status-banner").classList.remove("hidden");
    window.SessionState.currentTask = { task_type: "open_answer" };

    TaskRenderer.renderTask(null);

    expect(window.UIHelpers.setCanGoNext).toHaveBeenCalledWith(false);
    expect(window.SessionState.currentTask).toBeNull();
    expect(document.getElementById("stale-content")).toBeNull();
    expect(document.getElementById("task-content").textContent).toContain(
      "Для этой сессии больше нет доступных заданий."
    );
    expect(
      document.getElementById("result-box").classList.contains("hidden")
    ).toBe(true);
    expect(
      document.getElementById("status-banner").classList.contains("hidden")
    ).toBe(true);
    expect(document.getElementById("check-answer-btn").disabled).toBe(true);
    expect(
      document.getElementById("check-answer-btn").classList.contains("hidden")
    ).toBe(true);
  });

  it("clears stale open-answer result fragments when new payload omits them", () => {
    const TaskRenderer = initTaskRenderer();
    window.SessionState.currentTask = {
      task_type: "open_answer",
      task_id: "t1",
      task_data: {},
    };

    const keywordsBox = document.getElementById("result-keywords");
    const userAnswerBox = document.getElementById("result-user-answer");
    const referenceWrap = document.getElementById("result-reference");
    const referenceTitle = document.getElementById("result-reference-title");
    const referenceText = document.getElementById("result-reference-text");

    keywordsBox.classList.remove("hidden");
    userAnswerBox.classList.remove("hidden");
    referenceWrap.classList.remove("hidden");
    keywordsBox.textContent = "old keywords";
    userAnswerBox.textContent = "old answer";
    referenceTitle.textContent = "old title";
    referenceText.textContent = "old reference";

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "Nope",
      details: {},
    });

    expect(keywordsBox.textContent).toBe("");
    expect(userAnswerBox.textContent).toBe("");
    expect(referenceTitle.textContent).toBe("");
    expect(referenceText.textContent).toBe("");
    expect(keywordsBox.classList.contains("hidden")).toBe(true);
    expect(userAnswerBox.classList.contains("hidden")).toBe(true);
    expect(referenceWrap.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("result-message").textContent).toBe("Nope");
  });

  it("renders unsupported task fallback without injecting task metadata", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: '"><img src=x onerror=1>',
      task_id: 'task"><img src=x onerror=1>',
      module_id: "m1",
      topic_id: "t1",
      task_data: {},
    });

    const taskContent = document.getElementById("task-content");
    expect(taskContent.querySelector("img")).toBeNull();
    expect(taskContent.textContent).toContain('"><img src=x onerror=1>');
    expect(window.UIHelpers.showStatus).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
