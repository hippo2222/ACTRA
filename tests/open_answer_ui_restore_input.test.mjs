/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import "../frontend/OpenAnswerUI/OpenAnswerUI.web.js";

const OpenAnswerUI = window.OpenAnswerUI;

describe("OpenAnswerUI restoreInput", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button id="check-answer-btn" type="button"></button>
      <div id="open-answer-root"></div>
    `;
    OpenAnswerUI.cleanup();
  });

  it("synchronizes textarea, button state, and counter when draft changes", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Question",
          max_length: 5,
        },
      },
    });

    OpenAnswerUI.restoreInput({ answer: "abcd" });

    const textarea = container.querySelector("textarea");
    const counter = [...container.querySelectorAll("div")].find((el) =>
      el.textContent === "4/5"
    );

    expect(textarea.value).toBe("abcd");
    expect(document.getElementById("check-answer-btn").disabled).toBe(false);
    expect(counter).toBeTruthy();

    OpenAnswerUI.restoreInput({ answer: "" });

    expect(textarea.value).toBe("");
    expect(document.getElementById("check-answer-btn").disabled).toBe(true);
    expect(container.textContent).toContain("0/5");
  });

  it("renders a constrained preview and opens a lightbox with zoom controls", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          title: "Question",
          question: "Inspect image",
          image_path: "/uploads/chart.png",
        },
      },
    });

    const preview = container.querySelector(".group.relative");
    expect(preview).toBeTruthy();
    expect(preview.className).toContain("max-w-3xl");
    expect(preview.querySelector(".bg-scrim")).toBeNull();
    expect(container.textContent).toContain("Inspect image");
    expect(container.textContent).not.toContain("Пустой ответ отправить нельзя");

    const openViewerButton = container.querySelector(
      'button[aria-label="Open image viewer"]'
    );
    expect(openViewerButton).toBeTruthy();

    openViewerButton.click();

    const lightboxImg = document.body.lastElementChild.querySelector("img");
    Object.defineProperty(lightboxImg, "naturalWidth", {
      configurable: true,
      value: 1600,
    });
    Object.defineProperty(lightboxImg, "naturalHeight", {
      configurable: true,
      value: 900,
    });
    lightboxImg.dispatchEvent(new window.Event("load"));

    const zoomIn = document.querySelector('button[aria-label="Zoom in"]');
    const zoomOut = document.querySelector('button[aria-label="Zoom out"]');
    const fit = document.querySelector('button[aria-label="Fit to screen"]');
    const close = document.querySelector(
      'button[aria-label="Close image viewer"]'
    );

    expect(zoomIn).toBeTruthy();
    expect(zoomOut).toBeTruthy();
    expect(fit).toBeTruthy();
    expect(close).toBeTruthy();
    expect(document.body.textContent).toContain("100%");

    zoomIn.click();
    expect(document.body.textContent).toContain("115%");
  });

  it("does not render an empty footer row when no max length is configured", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Question without limit",
        },
      },
    });

    expect(container.querySelector("textarea + div")).toBeNull();
  });

  it("locks the textarea after check feedback is applied", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          question: "Question",
        },
      },
    });

    OpenAnswerUI.restoreInput({ answer: "draft answer" });
    OpenAnswerUI.applyCheckFeedback({ success: false });

    const textarea = container.querySelector("textarea");
    expect(textarea.readOnly).toBe(true);
    expect(textarea.disabled).toBe(true);
    expect(document.getElementById("check-answer-btn").disabled).toBe(true);
  });

  it("resolves asset-backed images to the canonical hosted asset URL", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          title: "Question",
          question: "Inspect hosted image",
          image_asset_id: "asset_open_answer_42",
        },
      },
    });

    const image = container.querySelector(".group.relative img");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("/api/assets/asset_open_answer_42/content");
  });

  it("prefers canonical asset refs over legacy image_path for open-answer media", () => {
    const container = document.getElementById("open-answer-root");

    OpenAnswerUI.render(container, {
      task_data: {
        content: {
          title: "Question",
          question: "Prefer hosted image",
          image_asset_id: "asset_open_answer_43",
          image_path: "legacy/open-answer.png",
        },
      },
    });

    const image = container.querySelector(".group.relative img");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("/api/assets/asset_open_answer_43/content");
  });
});
