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
  const baseContent = {
    prompt: "Расположите элементы по уровням эволюции",
    elements: Array.from({ length: 12 }, (_, index) => ({
      id: `element_${index + 1}`,
      text: `Элемент ${index + 1}`,
    })),
    levels: Array.from({ length: 8 }, (_, index) => ({
      level_id: `level_${index + 1}`,
      label: `Уровень ${index + 1}`,
      blocks: ["slot_1"],
    })),
    settings: {
      difficulty: 1,
      level_order_matters: true,
      shuffle_elements: false,
    },
  };
  const overrideContent = taskOverrides.task_data?.content || {};
  const overrideSettings = taskOverrides.task_data?.settings || {};
  const taskData = {
    content: {
      ...baseContent,
      ...overrideContent,
      settings: {
        ...baseContent.settings,
        ...(overrideContent.settings || {}),
      },
    },
    settings: {
      ...baseContent.settings,
      ...overrideSettings,
    },
  };
  const task = {
    task_data: taskData,
    ...taskOverrides,
  };
  task.task_data = taskData;

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

describe("SequenceUI render stability", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="seq-root"></div>`;
  });

  afterEach(() => {
    SequenceUI.cleanup();
  });

  it("preserves scroll positions when rerendering selection state", () => {
    renderSequence({
      task_data: {
        content: {
          prompt: "Расположите элементы по уровням эволюции",
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

    const availableList = document.querySelector('[data-sequenceui="available-list"]');
    const levelsList = document.querySelector('[data-sequenceui="levels-list"]');
    const availableItem = document.querySelector('[data-sequenceui="available-item"]');

    availableList.scrollTop = 48;
    levelsList.scrollTop = 84;
    availableItem.click();

    expect(availableList.scrollTop).toBe(48);
    expect(levelsList.scrollTop).toBe(84);
  });

  it("does not inject entry keyframes for every rerender", () => {
    renderSequence();

    const style = document.querySelector("#seq-root style");

    expect(style?.textContent).not.toContain("@keyframes seqSlideUp");
    expect(style?.textContent).not.toContain("@keyframes seqScaleIn");
    expect(style?.textContent).toContain(".seq-level-entry[data-reordering='true']");
  });
});
