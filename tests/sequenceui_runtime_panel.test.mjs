/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";

const code = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/SequenceUI/SequenceUI.web.js"),
  "utf8"
);

let SequenceUI;

function renderSequence(taskOverrides = {}) {
  const container = document.getElementById("seq-root");
  const task = {
    task_data: {
      content: {
        prompt: "Расположите элементы по уровням эволюции",
        elements: [
          { id: "wolf_a", text: "Волк" },
          { id: "wolf_b", text: "Волк" },
          { id: "dog", text: "Собака" },
        ],
        levels: [
          { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
          { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
        ],
        settings: {
          difficulty: 1,
          level_order_matters: true,
        },
      },
      settings: {
        difficulty: 1,
        level_order_matters: true,
      },
    },
    ...taskOverrides,
  };

  SequenceUI.render(container, task);
  return container;
}

beforeAll(() => {
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => {
    cb();
    return 1;
  });
  global.requestAnimationFrame = window.requestAnimationFrame;
  window.eval(`${code}\n;window.SequenceUI = SequenceUI;`);
  SequenceUI = window.SequenceUI;
});

describe("SequenceUI runtime panel", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="seq-root"></div>`;
  });

  afterEach(() => {
    SequenceUI.cleanup();
  });

  it("shows the real task prompt, keeps the available panel sticky, and lets levels follow page scroll", () => {
    renderSequence();

    const prompt = document.querySelector('[data-sequenceui="task-prompt"]');
    const availableList = document.querySelector('[data-sequenceui="available-list"]');
    const levelsList = document.querySelector('[data-sequenceui="levels-list"]');
    const availableSidebar = document.querySelector('[data-sequenceui="available-sidebar"]');
    const availableStickyFrame = document.querySelector('[data-sequenceui="available-sticky-frame"]');
    const availableCard = document.querySelector('[data-sequenceui="available-card"]');

    expect(prompt?.textContent).toContain("Расположите элементы по уровням эволюции");
    expect(availableList?.className).toContain("overflow-y-auto");
    expect(availableList?.className).toContain("flex-1");
    expect(levelsList?.className || "").not.toContain("overflow-y-auto");
    expect(levelsList?.className || "").not.toContain("flex-1");
    expect(availableSidebar?.style.position).toBe("sticky");
    expect(availableSidebar?.style.top).toBe("6rem");
    expect(availableSidebar?.style.alignSelf).toBe("start");
    expect(availableStickyFrame?.className || "").not.toContain("lg:sticky");
    expect(availableCard?.className || "").not.toContain("lg:sticky");
    expect(availableCard?.style.maxHeight).toBe("calc(100vh - 7rem)");
  });

  it("groups duplicate-looking available elements and removes only one occurrence on placement", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "wolf_b", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: false,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: false,
          shuffle_elements: false,
        },
      },
    });

    const availableItemsBefore = Array.from(
      document.querySelectorAll('[data-sequenceui="available-item"]')
    );
    const duplicateBadgeBefore = document.querySelector(
      '[data-sequenceui="available-duplicate-count"]'
    );
    const availableCount = document.querySelector('[data-sequenceui="available-count"]');

    expect(availableItemsBefore).toHaveLength(2);
    expect(duplicateBadgeBefore?.textContent).toBe("x2");
    expect(availableCount?.textContent).toContain("3");

    availableItemsBefore[0].click();
    const firstLevelPanel = document.querySelector(
      '[data-sequenceui="levels-list"] div.cursor-pointer'
    );

    expect(firstLevelPanel).toBeTruthy();
    firstLevelPanel.click();

    const availableItemsAfter = Array.from(
      document.querySelectorAll('[data-sequenceui="available-item"]')
    );
    const duplicateBadgeAfter = document.querySelector(
      '[data-sequenceui="available-duplicate-count"]'
    );

    expect(availableCount?.textContent).toContain("2");
    expect(availableItemsAfter).toHaveLength(2);
    expect(duplicateBadgeAfter).toBeNull();
  });

  it("uses a single outer border for level reorder controls", () => {
    renderSequence();

    const controls = document.querySelector('[data-sequenceui="level-order-controls"]');

    expect(controls).toBeTruthy();
    const buttons = Array.from(controls.querySelectorAll("button"));
    expect(controls.className).toContain("border");
    expect(buttons).toHaveLength(2);
    buttons.forEach((button) => {
      expect(button.className).not.toContain("border-border-strong");
      expect(button.className).not.toContain(" rounded ");
    });
  });

  it("renders enabled reorder buttons lighter than disabled ones", () => {
    renderSequence();

    const controls = document.querySelector('[data-sequenceui="level-order-controls"]');
    const buttons = Array.from(controls.querySelectorAll("button"));
    const [upButton, downButton] = buttons;

    expect(upButton.disabled).toBe(true);
    expect(upButton.className).toContain("bg-surface-2");
    expect(upButton.className).toContain("opacity-70");
    expect(downButton.disabled).toBe(false);
    expect(downButton.className).toContain("bg-surface-1");
    expect(downButton.className).toContain("shadow-sm");
  });

  it("restores a saved layout order and placements for fixed levels", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "wolf_b", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: true,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
    });

    const restoredInput = {
      levels: [
        { level_id: "level_2", blocks: ["dog"] },
        { level_id: "level_1", blocks: ["wolf_a"] },
      ],
    };

    SequenceUI.restoreInput(restoredInput);

    expect(SequenceUI.getUserAnswerPayload()).toEqual(restoredInput);

    const levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_2");
    expect(levelCards[1]?.getAttribute("data-sequenceui-level-id")).toBe("level_1");

    const availableCount = document.querySelector('[data-sequenceui="available-count"]');
    expect(availableCount?.textContent).toContain("1");
  });

  it("clears placed elements back to the available list without resetting level order", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "wolf_b", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: true,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
    });

    const restoredInput = {
      levels: [
        { level_id: "level_2", blocks: ["dog"] },
        { level_id: "level_1", blocks: ["wolf_a"] },
      ],
    };

    SequenceUI.restoreInput(restoredInput);

    const clearButton = document.querySelector('[data-sequenceui="clear-button"]');
    expect(clearButton).toBeTruthy();
    clearButton.click();

    expect(SequenceUI.getUserAnswerPayload()).toEqual({
      levels: [
        { level_id: "level_2", blocks: [] },
        { level_id: "level_1", blocks: [] },
      ],
    });

    const levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_2");
    expect(levelCards[1]?.getAttribute("data-sequenceui-level-id")).toBe("level_1");

    const availableCount = document.querySelector('[data-sequenceui="available-count"]');
    expect(availableCount?.textContent).toContain("3");
  });

  it("blocks submit on difficulty 3 when a filled level has no level name", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Назовите уровни и элементы.",
          elements: [
            { id: "a", text: "Шаг A" },
          ],
          levels: [],
          settings: {
            difficulty: 3,
            level_order_matters: true,
            shuffle_elements: false,
          },
          requires_level_names: true,
          requires_block_names: true,
        },
        settings: {
          difficulty: 3,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
      difficulty: 3,
    });

    SequenceUI.restoreInput({
      levels: [
        {
          level_id: "user_level_1",
          level_name: "",
          blocks: ["slot_1"],
          block_names: {
            slot_1: "Шаг A",
          },
        },
      ],
    });

    expect(SequenceUI.getUserAnswerPayload()).toEqual({
      levels: [
        {
          level_id: "user_level_1",
          level_name: "",
          blocks: ["slot_1"],
          block_names: {
            slot_1: "Шаг A",
          },
        },
      ],
    });

    expect(SequenceUI.validateBeforeSubmit()).toEqual({
      valid: false,
      reason: "missing_level_name",
      message: "Добавьте название уровня перед проверкой",
    });
  });

  it("hides and disables the clear action immediately after check feedback", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "wolf_b", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: true,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
    });

    const filledInput = {
      levels: [
        { level_id: "level_2", blocks: ["dog"] },
        { level_id: "level_1", blocks: ["wolf_a"] },
      ],
    };

    SequenceUI.restoreInput(filledInput);

    const clearButton = document.querySelector('[data-sequenceui="clear-button"]');
    expect(clearButton).toBeTruthy();
    expect(clearButton?.className || "").toContain("inline-flex");

    SequenceUI.applyCheckFeedback({
      success: false,
      details: {
        incorrect_levels: ["level_1", "level_2"],
      },
    });

    expect(clearButton?.className || "").toContain("hidden");
    expect(clearButton?.className || "").not.toContain("inline-flex");

    clearButton?.click();

    expect(SequenceUI.getUserAnswerPayload()).toEqual(filledInput);
  });

  it("lets the user place an element into a specific empty slot instead of the first free one", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по слотам",
          elements: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          levels: [
            { level_id: "level_1", label: "Уровень", blocks: ["slot_1", "slot_2"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: false,
            sequence_within_level_matters: false,
            shuffle_elements: false,
          },
          sequence_within_level_matters: false,
        },
        settings: {
          difficulty: 1,
          level_order_matters: false,
          sequence_within_level_matters: false,
          shuffle_elements: false,
        },
      },
    });

    const availableItems = Array.from(
      document.querySelectorAll('[data-sequenceui="available-item"]')
    );
    expect(availableItems).toHaveLength(2);

    availableItems[0].click();

    const slotButtons = Array.from(
      document.querySelectorAll('button[aria-label="Разместить выбранный элемент в этот слот"]')
    );
    expect(slotButtons).toHaveLength(2);

    slotButtons[1].click();

    expect(SequenceUI.getUserAnswerPayload()).toEqual({
      levels: [
        { level_id: "level_1", blocks: [null, "a"] },
      ],
    });

    SequenceUI.restoreInput({
      levels: [
        { level_id: "level_1", blocks: [null, "a"] },
      ],
    });

    const placedButtons = Array.from(
      document.querySelectorAll('button[aria-label^="Убрать элемент:"]')
    );
    const restoredSlotButtons = Array.from(
      document.querySelectorAll('button[aria-label="Разместить выбранный элемент в этот слот"]')
    );

    expect(placedButtons).toHaveLength(1);
    expect(placedButtons[0].textContent).toContain("A");
    expect(restoredSlotButtons).toHaveLength(1);
  });

  it("switches between checked user state and reference state without mutating the answer", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: true,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
    });

    const checkedUserInput = {
      levels: [
        { level_id: "level_2", blocks: ["dog"] },
        { level_id: "level_1", blocks: ["wolf_a"] },
      ],
    };

    SequenceUI.restoreInput(checkedUserInput);
    SequenceUI.applyCheckFeedback({
      success: false,
      details: {
        correct_levels: ["level_1", "level_2"],
        incorrect_levels: [1, 2],
        correct_blocks_by_level: {
          level_1: ["wolf_a"],
          level_2: ["dog"],
        },
        correct_levels_data: [
          { level_id: "level_1", level_name: "Дикие", blocks: ["wolf_a"] },
          { level_id: "level_2", level_name: "Домашние", blocks: ["dog"] },
        ],
        user_levels_data: checkedUserInput.levels,
        elements_data: [
          { id: "wolf_a", text: "Волк" },
          { id: "dog", text: "Собака" },
        ],
      },
    });

    const referenceButton = document.querySelector('[data-sequenceui="comparison-view-reference"]');
    const userButton = document.querySelector('[data-sequenceui="comparison-view-user"]');
    const comparisonToolbar = document.querySelector('[data-sequenceui="comparison-toolbar"]');

    expect(comparisonToolbar).toBeTruthy();
    expect(referenceButton).toBeTruthy();
    expect(userButton).toBeTruthy();
    expect(document.querySelector("#seq-root")?.firstElementChild?.dataset.sequenceuiComparisonView).toBe("user");

    let levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_2");

    referenceButton.click();

    expect(document.querySelector("#seq-root")?.firstElementChild?.dataset.sequenceuiComparisonView).toBe("reference");
    levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_1");
    expect(SequenceUI.getUserAnswerPayload()).toEqual(checkedUserInput);
    expect(SequenceUI.getViewState()?.comparison_view).toBe("reference");

    userButton.click();

    expect(document.querySelector("#seq-root")?.firstElementChild?.dataset.sequenceuiComparisonView).toBe("user");
    levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_2");
  });

  it("uses readable comparison status text and compares level order by level ids", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
          elements: [
            { id: "wolf_a", text: "Волк" },
            { id: "dog", text: "Собака" },
          ],
          levels: [
            { level_id: "level_1", label: "Дикие", blocks: ["slot_1"] },
            { level_id: "level_2", label: "Домашние", blocks: ["slot_1"] },
          ],
          settings: {
            difficulty: 1,
            level_order_matters: true,
            shuffle_elements: false,
          },
        },
        settings: {
          difficulty: 1,
          level_order_matters: true,
          shuffle_elements: false,
        },
      },
    });

    SequenceUI.restoreInput({
      levels: [
        { level_id: "level_2", blocks: ["dog"] },
        { level_id: "level_1", blocks: ["wolf_a"] },
      ],
    });
    SequenceUI.applyCheckFeedback({
      success: false,
      details: {
        correct_levels: [],
        incorrect_levels: ["level_1", "level_2"],
        correct_levels_data: [
          { level_id: "level_1", level_name: "Дикие", blocks: ["wolf_a"] },
          { level_id: "level_2", level_name: "Домашние", blocks: ["dog"] },
        ],
        user_levels_data: [
          { level_id: "level_2", blocks: ["dog"] },
          { level_id: "level_1", blocks: ["wolf_a"] },
        ],
        elements_data: [
          { id: "wolf_a", text: "Волк" },
          { id: "dog", text: "Собака" },
        ],
      },
    });

    const comparisonStatus = document.querySelector('[data-sequenceui="comparison-status"]');
    let levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));

    expect(comparisonStatus?.textContent).toBe("Показан ваш ответ с отметками проверки.");
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_2");
    expect(levelCards[0]?.textContent || "").toContain("Неверная позиция");
    expect(levelCards[0]?.textContent || "").not.toContain("Позиция верная");

    document.querySelector('[data-sequenceui="comparison-view-reference"]')?.click();

    levelCards = Array.from(document.querySelectorAll("[data-sequenceui-level-id]"));
    expect(comparisonStatus?.textContent).toBe("Показан эталонный вариант.");
    expect(levelCards[0]?.getAttribute("data-sequenceui-level-id")).toBe("level_1");
  });

  it("captures and restores sequence view state with selection and scroll positions", () => {
    renderSequence();

    const availableList = document.querySelector('[data-sequenceui="available-list"]');
    const levelsList = document.querySelector('[data-sequenceui="levels-list"]');
    const firstAvailable = document.querySelector('[data-sequenceui="available-item"]');

    expect(firstAvailable).toBeTruthy();
    firstAvailable.click();
    availableList.scrollTop = 30;
    levelsList.scrollTop = 55;

    const viewState = SequenceUI.getViewState();

    SequenceUI.restoreViewState({
      ...viewState,
      scroll_positions: {
        availableTop: 12,
        levelsTop: 18,
      },
    });

    expect(SequenceUI.getViewState()).toMatchObject({
      selected_available_id: viewState.selected_available_id,
    });
    expect(availableList.scrollTop).toBe(12);
    expect(levelsList.scrollTop).toBe(18);
  });
});
