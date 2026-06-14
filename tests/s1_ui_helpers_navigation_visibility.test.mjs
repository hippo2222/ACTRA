/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/ui-helpers.js"),
  "utf8"
);

function loadUiHelpers() {
  delete window.UIHelpers;
  window.eval(scriptCode);
  return window.UIHelpers;
}

describe("UIHelpers navigation visibility", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="status-banner"></div>
      <div id="task-content"></div>
      <button id="check-answer-btn" type="button"></button>
      <button id="next-task-btn" type="button" class="hidden"></button>
    `;
    window.SessionState = {
      paused: false,
      isLoading: false,
      canGoNext: false,
      currentTaskChecked: true,
    };
  });

  it("keeps the next-task button hidden until progression is allowed", () => {
    const UIHelpers = loadUiHelpers();
    const nextBtn = document.getElementById("next-task-btn");

    UIHelpers.setCanGoNext(false);
    expect(nextBtn.classList.contains("hidden")).toBe(true);
    expect(nextBtn.disabled).toBe(true);

    UIHelpers.setCanGoNext(true);
    expect(nextBtn.classList.contains("hidden")).toBe(false);
    expect(nextBtn.disabled).toBe(false);
  });
});
