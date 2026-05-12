/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

describe("TaskRenderer test summary normalization", () => {
  let TaskRenderer;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="result-box"></div>
      <div id="result-inner"></div>
      <div id="result-header"></div>
      <div id="result-icon-wrap"></div>
      <span id="result-icon"></span>
      <div id="result-title"></div>
      <div id="result-message"></div>
      <div id="result-details"></div>
      <div id="result-keywords" class="hidden"></div>
      <div id="result-user-answer" class="hidden"></div>
      <div id="result-reference" class="hidden"></div>
      <div id="result-reference-title"></div>
      <div id="result-reference-text"></div>
      <div id="current-task-title"></div>
    `;

    globalThis.SuccessEffects = undefined;
    TaskRenderer = require(path.resolve(process.cwd(), "frontend/S1/task-renderer.js"));
    const SessionState = require(path.resolve(process.cwd(), "frontend/S1/session-state.js"));
    SessionState.currentTask = {
      task_type: "test",
      difficulty: 2,
      task_data: { task_type: "test", type: "test", content: {} },
    };
  });

  it("rewrites old ambiguous test summary copy using counts from details", () => {
    TaskRenderer.showEvaluationResult({
      success: false,
      message: "❌ Есть ошибки: 2/3 верно, 1 с ошибкой",
      details: {
        correct_count: 1,
        total_count: 3,
      },
    });

    expect(document.getElementById("result-message").textContent).toContain(
      "❌ Есть ошибки: 2 из 3 с ошибкой, верно 1",
    );
  });

  it("updates the S1 header when TestUI reports a per-question source title", () => {
    TaskRenderer.renderTask({
      task_type: "test",
      task_name: "First test title",
      task_data: {
        type: "test",
        content: { questions: [] },
      },
    });

    expect(document.getElementById("current-task-title").textContent).toBe(
      "First test title",
    );

    window.dispatchEvent(
      new CustomEvent("test:current-question-changed", {
        detail: { taskTitle: "Second test title" },
      }),
    );

    expect(document.getElementById("current-task-title").textContent).toBe(
      "Second test title",
    );
    expect(document.getElementById("current-task-title").classList.contains("s1-title-updated")).toBe(
      true,
    );
  });

  it("does not touch the S1 header when the per-question source title is unchanged", () => {
    TaskRenderer.renderTask({
      task_type: "test",
      task_name: "Same test title",
      task_data: {
        type: "test",
        content: { questions: [] },
      },
    });

    const titleEl = document.getElementById("current-task-title");
    titleEl.dispatchEvent(new Event("animationend"));
    titleEl.classList.remove("s1-title-updated");

    window.dispatchEvent(
      new CustomEvent("test:current-question-changed", {
        detail: { taskTitle: "Same   test   title" },
      }),
    );

    expect(titleEl.textContent).toBe("Same test title");
    expect(titleEl.classList.contains("s1-title-updated")).toBe(false);
  });
});
