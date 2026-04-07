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
});
