/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function initShell({ runtime = false } = {}) {
  document.body.innerHTML = `${runtime ? '<button id="check-answer-btn"></button>' : ""}<div id="app"></div>`;
  window.TaskMetadataPanel = {
    create() {
      return {
        rootEl: document.createElement("div"),
        api: {
          collect: () => null,
        },
      };
    },
  };
  window.eval(loadScript("frontend/DrawUI/DrawUI.web.js"));
}

function createDrawTaskFixture() {
  return {
    task_type: "draw",
    difficulty: 3,
    task_data: {
      task_type: "draw",
      _difficulty_level: 2,
      content: {
        prompt: "Обведи нужную область и проведи линию.",
        image_url: "",
      },
    },
    answer_key: {
      targets: [
        {
          label: "Контур",
          shape: "polygon",
          points: [[10, 10], [40, 10], [40, 40], [10, 40]],
        },
        {
          label: "Линия",
          shape: "freehand",
          points: [[60, 60], [90, 70], [120, 90]],
        },
      ],
    },
  };
}

describe("DrawUI review preview", () => {
  beforeEach(() => {
    initShell();
  });

  it("renders image-based review previews with labels after check", () => {
    const container = document.getElementById("app");
    const task = createDrawTaskFixture();

    window.DrawUI.render(container, task);
    window.DrawUI.restoreInput({
      polygons: [{ points: [[10, 10], [40, 10], [40, 40], [10, 40]] }],
      lines: [{ points: [[60, 60], [88, 70], [118, 90]] }],
      labels_polygons: ["Контур пользователя"],
      labels_lines: ["Линия пользователя"],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    window.DrawUI.applyCheckFeedback({
      success: false,
      details: {
        error: "mismatch",
      },
    });

    const review = container.querySelector('[data-drawui="review-comparison"]');
    const userPreview = container.querySelector('[data-drawui="review-user-preview"]');
    const refPreview = container.querySelector('[data-drawui="review-reference-preview"]');

    expect(review).toBeTruthy();
    expect(userPreview?.textContent || "").toContain("Ваш ответ");
    expect(refPreview?.textContent || "").toContain("Эталон");
    expect(userPreview?.textContent || "").toContain("Контур пользователя");
    expect(userPreview?.textContent || "").toContain("Линия пользователя");
    expect(refPreview?.textContent || "").toContain("Контур");
    expect(refPreview?.textContent || "").toContain("Линия");
    expect(userPreview?.querySelector("svg")).toBeTruthy();
    expect(refPreview?.querySelector("svg")).toBeTruthy();
    expect(refPreview?.querySelectorAll("path").length || 0).toBeGreaterThan(0);
  });

  it("links hover across BOTH images and BOTH label tables in review", () => {
    const container = document.getElementById("app");
    const task = createDrawTaskFixture();

    window.DrawUI.render(container, task);
    window.DrawUI.restoreInput({
      polygons: [{ points: [[10, 10], [40, 10], [40, 40], [10, 40]] }],
      lines: [{ points: [[60, 60], [88, 70], [118, 90]] }],
      labels_polygons: ["Контур пользователя"],
      labels_lines: ["Линия пользователя"],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    // target 0 = polygon "Контур", target 1 = freehand "Линия"
    window.DrawUI.applyCheckFeedback({
      success: false,
      details: {
        polygon_results: [{ target_index: 0, matched_polygon_idx: 0, polygon_success: true, coverage: 95, threshold: 75 }],
        line_results: [{ target_index: 1, matched_line_idx: 0, line_success: false, coverage: 60, threshold: 75 }],
      },
    });

    const userPreview = container.querySelector('[data-drawui="review-user-preview"]');
    const refPreview = container.querySelector('[data-drawui="review-reference-preview"]');
    const userLabels = container.querySelector('[data-drawui="review-user-labels"]');
    const refLabels = container.querySelector('[data-drawui="review-reference-labels"]');
    expect(userPreview && refPreview && userLabels && refLabels).toBeTruthy();

    const t0InRef = refPreview.querySelector('[data-target-index="0"]');
    const t0InUser = userPreview.querySelector('[data-target-index="0"]');
    const t0UserRow = userLabels.querySelector('[data-target-index="0"]');
    const t0RefRow = refLabels.querySelector('[data-target-index="0"]');
    const t1InUser = userPreview.querySelector('[data-target-index="1"]');
    const t1RefRow = refLabels.querySelector('[data-target-index="1"]');
    expect(t0InRef && t0InUser && t0UserRow && t0RefRow && t1InUser && t1RefRow).toBeTruthy();

    // Наведение на эталонный контур (target 0) подсвечивает контур пользователя и обе
    // строки таблиц для target 0; всё, что относится к target 1, гаснет.
    t0InRef.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));

    expect(t0InUser.style.opacity).toBe("1");
    expect(t0UserRow.style.opacity).toBe("1");
    expect(t0RefRow.style.opacity).toBe("1");
    expect(t1InUser.style.opacity).toBe("0.08");
    expect(t1RefRow.style.opacity).toBe("0.08");
  });

  it("does not render the review block in runtime sessions", () => {
    initShell({ runtime: true });

    const container = document.getElementById("app");
    const task = createDrawTaskFixture();

    window.DrawUI.render(container, task);
    window.DrawUI.restoreInput({
      polygons: [{ points: [[10, 10], [40, 10], [40, 40], [10, 40]] }],
      lines: [{ points: [[60, 60], [88, 70], [118, 90]] }],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    window.DrawUI.applyCheckFeedback({
      success: false,
      details: {
        error: "mismatch",
      },
    });

    expect(container.querySelector('[data-drawui="review-comparison"]')).toBeNull();
  });
});
