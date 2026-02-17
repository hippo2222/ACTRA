/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import "../frontend/MistakesUI/MistakesUI.web.js";

describe("MistakesUI text_choice mode", () => {
  let container;
  let task;
  let onStateChange;

  beforeEach(() => {
    document.body.innerHTML = `<div id="root"></div>`;
    container = document.getElementById("root");
    onStateChange = vi.fn();

    task = {
      task_data: {
        content: {
          mode: "text_choice",
          choice_prompt: "Выберите правильный вариант текста",
          options: [
            { id: "opt_a", text: "Вариант А", is_correct: false },
            { id: "opt_b", text: "Вариант B", is_correct: true },
            { id: "opt_c", text: "Вариант C", is_correct: false },
          ],
        },
      },
    };
  });

  it("renders instruction and options, selection updates state and payload", () => {
    MistakesUI.render(container, task, { onStateChange });

    const heading = container.querySelector("h2");
    expect(heading?.textContent).toContain("Выберите правильный вариант текста");

    const cards = Array.from(container.querySelectorAll(".choice-card"));
    expect(cards).toHaveLength(3);
    expect(cards[1].textContent).toContain("Вариант B");

    // Initially no selection
    let payload = MistakesUI.getUserAnswerPayload();
    expect(payload.mode).toBe("text_choice");
    expect(payload.selected_option_id).toBeNull();
    expect(onStateChange).toHaveBeenCalled();
    onStateChange.mockClear();

    // Select option B by clicking button
    const button = cards[1].querySelector("button");
    button.click();

    payload = MistakesUI.getUserAnswerPayload();
    expect(payload.selected_option_id).toBe("opt_b");
    expect(payload.selected_option_index).toBe(1);

    expect(onStateChange).toHaveBeenCalled();
    const detail = onStateChange.mock.calls.at(-1)?.[0];
    expect(detail?.completed).toBe(true);
    expect(detail?.selectedOptionId).toBe("opt_b");
  });
});
