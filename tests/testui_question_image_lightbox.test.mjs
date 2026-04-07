/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

describe("TestUI image-option lightbox", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.eval(loadScript("frontend/TestUI/TestUI.question.js"));
  });

  it("opens image answers in a viewer with zoom controls", () => {
    const main = document.createElement("div");
    document.body.appendChild(main);

    const state = {
      questions: [{ id: "q1", text: "Pick the correct image", index: 0 }],
      rawQuestions: [
        {
          type: "single_choice",
          answers: [
            {
              text: "Image option",
              image_url: "/images/option.png",
              correct: true,
            },
          ],
        },
      ],
      currentIndex: 0,
      answers: {},
      selections: {},
      questionResults: {},
      flags: {},
      isOpenMode: true,
      mode: "answering",
    };

    const renderer = window.TestUIQuestion.createQuestionRenderer(state, main);
    renderer.renderQuestionView();

    const openViewerButton = main.querySelector(
      'button[aria-label="Open image viewer"]'
    );
    expect(openViewerButton).toBeTruthy();
    expect(openViewerButton.parentElement?.querySelector("img")).toBeTruthy();

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
});
