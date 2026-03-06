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
});
