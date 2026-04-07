/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

describe("TaskRenderer tolerance explanation", () => {
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
    `;

    globalThis.SuccessEffects = undefined;
    TaskRenderer = require(path.resolve(process.cwd(), "frontend/S1/task-renderer.js"));
  });

  it("renders tolerance explanation from nested label feedback", () => {
    TaskRenderer.showEvaluationResult({
      success: true,
      message: "Проверено",
      details: {
        labels: {
          tolerance_type: "typo",
        },
      },
    });

    expect(document.getElementById("result-details").textContent).toContain(
      "Ответ засчитан с учетом опечатки.",
    );
  });
});
