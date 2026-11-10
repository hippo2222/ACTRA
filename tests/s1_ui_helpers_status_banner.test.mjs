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

describe("UIHelpers status banner", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="status-banner"></div>`;
    window.SessionState = { paused: false };
  });

  it("renders a dismiss button for dismissible statuses", () => {
    const UIHelpers = loadUiHelpers();

    UIHelpers.showStatus("Восстановлен несохраненный ответ", "info", {
      dismissible: true,
    });

    const banner = document.getElementById("status-banner");
    const closeBtn = banner.querySelector('button[aria-label="Закрыть уведомление"]');

    expect(closeBtn).toBeTruthy();
    expect(banner.textContent).toContain("Восстановлен несохраненный ответ");

    closeBtn.click();

    expect(banner.classList.contains("hidden")).toBe(true);
    expect(banner.textContent).toBe("");
  });

  it("configures fixed toast overlay classes to prevent document layout shifts", () => {
    const UIHelpers = loadUiHelpers();

    UIHelpers.showStatus("Операция выполнена успешно", "success");

    const banner = document.getElementById("status-banner");
    expect(banner.classList.contains("fixed")).toBe(true);
    expect(banner.classList.contains("bottom-6")).toBe(true);
    expect(banner.classList.contains("right-6")).toBe(true);
    expect(banner.classList.contains("z-60")).toBe(true);
    expect(banner.classList.contains("pointer-events-auto")).toBe(true);
    // Dismiss button rendered by default on toast overlay
    const closeBtn = banner.querySelector('button[aria-label="Закрыть уведомление"]');
    expect(closeBtn).toBeTruthy();
  });

  it("activates next-task-btn as primary CTA when task is checked and canGoNext is enabled (DEF-01)", () => {
    document.body.innerHTML = `
      <div id="status-banner"></div>
      <button id="check-answer-btn" class="bg-primary text-primary-fg"></button>
      <button id="next-task-btn" class="hidden"></button>
    `;
    window.SessionState = {
      paused: false,
      isLoading: false,
      canGoNext: false,
      currentTaskChecked: true,
    };
    const UIHelpers = loadUiHelpers();
    const nextBtn = document.getElementById("next-task-btn");
    const checkBtn = document.getElementById("check-answer-btn");

    UIHelpers.setCanGoNext(true);

    expect(window.SessionState.canGoNext).toBe(true);
    expect(nextBtn.classList.contains("hidden")).toBe(false);
    expect(nextBtn.classList.contains("bg-primary")).toBe(true);
    expect(nextBtn.classList.contains("text-primary-fg")).toBe(true);

    UIHelpers.setCanGoNext(false);
    expect(window.SessionState.canGoNext).toBe(false);
    expect(nextBtn.classList.contains("hidden")).toBe(true);
  });
});
