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

  it("renders localized tolerance explanation in English for layout normalization", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "Checked",
      details: {
        labels: {
          tolerance_type: "normalized",
          normalization_kinds: ["layout"],
          tolerance_explanation: "Название засчитан после нормализации раскладки.",
        },
      },
    });

    expect(document.getElementById("result-details").textContent).toBe(
      "Answer accepted after keyboard layout normalization.",
    );
  });

  it("renders localized tolerance explanation in English from legacy backend string", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "Checked",
      details: {
        labels: {
          tolerance_explanation: "Название засчитан после нормализации раскладки.",
        },
      },
    });

    expect(document.getElementById("result-details").textContent).toBe(
      "Answer accepted after keyboard layout normalization.",
    );
  });

  it("translates combined click+labels result message to English with tolerance notice", () => {
    const enLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/en.json"));
    window.i18n = {
      t: (key) => enLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "✅ Правильно! Найдено областей: 5/5 требуется (из 18), ✅ Все названия правильные (5/5) ⚠️ (с учетом толерантности)",
      details: {
        found_count: 5,
        required_correct: 5,
        total_targets: 18,
        labels: {
          success: true,
          matched_count: 5,
          total_labels: 5,
          has_tolerance: true,
          tolerance_type: "normalized",
          normalization_kinds: ["layout"],
          tolerance_explanation: "Название засчитан после нормализации раскладки.",
        },
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "✅ Correct! Areas found: 5/5 required (of 18), ✅ All names are correct (5/5) ⚠️ (considering tolerance)",
    );
    expect(document.getElementById("result-details").textContent).toBe(
      "Answer accepted after keyboard layout normalization.",
    );
  });

  it("translates combined click+labels result message to Ukrainian", () => {
    const ukLoc = require(path.resolve(process.cwd(), "frontend/assets/locales/uk.json"));
    window.i18n = {
      t: (key) => ukLoc[key] || key,
    };

    TaskRenderer.showEvaluationResult({
      success: true,
      message: "✅ Правильно! Найдено областей: 5/5 требуется (из 18), ✅ Все названия правильные (5/5) ⚠️ (с учетом толерантности)",
      details: {
        found_count: 5,
        required_correct: 5,
        total_targets: 18,
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
      "✅ Правильно! Знайдено областей: 5/5 потрібно (з 18), ✅ Усі назви правильні (5/5) ⚠️ (з урахуванням толерантності)",
    );
    expect(document.getElementById("result-details").textContent).toBe(
      "Відповідь зараховано після нормалізації розкладки.",
    );
  });
});
