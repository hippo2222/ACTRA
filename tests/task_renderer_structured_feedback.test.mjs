/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "module";
import path from "path";

const require = createRequire(import.meta.url);

describe("TaskRenderer structured message feedback", () => {
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

  it("renders structured click_combined_success_threshold in English without regex fallback", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "Текст на русском от бэкенда",
      details: {
        message_key: "click_combined_success_threshold",
        message_params: {
          found_count: 5,
          required_correct: 5,
          total_count: 18,
          labels_message: "✅ Все названия правильные (5/5) ⚠️ (с учетом толерантности)",
        },
        labels: {
          success: true,
          matched_count: 5,
          total_labels: 5,
          has_tolerance: true,
          tolerance_type: "normalized",
          normalization_kinds: ["layout"],
        },
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "✅ Correct! Areas found: 5/5 required (of 18), ✅ All names are correct (5/5) ⚠️ (considering tolerance)"
    );
  });

  it("renders structured click_combined_success_threshold in Ukrainian without regex fallback", () => {
    const ukLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/uk.json"));
    window.i18n = {
      t: (key) => ukLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "Текст на русском от бэкенда",
      details: {
        message_key: "click_combined_success_threshold",
        message_params: {
          found_count: 5,
          required_correct: 5,
          total_count: 18,
          labels_message: "✅ Все названия правильные (5/5) ⚠️ (с учетом толерантности)",
        },
        labels: {
          success: true,
          matched_count: 5,
          total_labels: 5,
          has_tolerance: true,
          tolerance_type: "normalized",
          normalization_kinds: ["layout"],
        },
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "✅ Правильно! Знайдено областей: 5/5 потрібно (з 18), ✅ Усі назви правильні (5/5) ⚠️ (з урахуванням толерантності)"
    );
  });

  it("renders structured click_labels_missing_threshold in English", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "Текст на русском",
      details: {
        message_key: "click_labels_missing_threshold",
        message_params: {
          found_count: 3,
          required_correct: 3,
          total_count: 5,
        },
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "❌ Enter names for the found areas (3/3 required of 5)"
    );
  });

  it("renders structured click_fail_threshold directly via message_key", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: false,
      message_key: "click_fail_threshold",
      message_params: {
        found_count: 2,
        required_correct: 5,
        total_count: 18,
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "❌ You found 2 of 5 required annotations (18 total). Try again!"
    );
  });
});
