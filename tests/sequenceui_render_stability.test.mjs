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

  it("normalizes asset-backed sequence elements to canonical hosted asset URLs", () => {
    const normalized = SequenceUI.__testHooks.normalizeTaskData({
      task_data: {
        content: {
          elements: [
            { id: "element_asset", text: "Asset element", image_asset_id: "asset_sequence_1" },
          ],
          levels: [
            { level_id: "level_1", label: "Level 1", blocks: ["slot_1"] },
          ],
        },
      },
    });

    expect(normalized.elements).toHaveLength(1);
    expect(normalized.elements[0].image).toBe("/api/assets/asset_sequence_1/content");
  });

  it("prefers canonical asset refs over legacy image_path sequence refs", () => {
    const normalized = SequenceUI.__testHooks.normalizeTaskData({
      task_data: {
        content: {
          elements: [
            {
              id: "element_asset_and_path",
              text: "Asset element",
              image_asset_id: "asset_sequence_2",
              image_path: "legacy/sequence.png",
            },
          ],
          levels: [
            { level_id: "level_1", label: "Level 1", blocks: ["slot_1"] },
          ],
        },
      },
    });

    expect(normalized.elements).toHaveLength(1);
    expect(normalized.elements[0].image).toBe("/api/assets/asset_sequence_2/content");
  });

  it("triggers FLIP placement animation on target placed node when an element is placed", () => {
    const animateCalls = [];
    const origAnimate = window.Element.prototype.animate;
    const origGetBoundingClientRect = window.Element.prototype.getBoundingClientRect;

    window.Element.prototype.animate = function(keyframes, options) {
      animateCalls.push({ element: this, keyframes, options });
      return { cancel: () => {}, finish: () => {} };
    };

    window.Element.prototype.getBoundingClientRect = function() {
      if (this.dataset?.sequenceui === "available-item") {
        return { left: 50, top: 100, width: 200, height: 40 };
      }
      if (this.dataset?.sequenceuiPlacedItem === "true") {
        return { left: 400, top: 200, width: 200, height: 40 };
      }
      return { left: 0, top: 0, width: 0, height: 0 };
    };

    try {
      renderSequence({
        task_data: {
          content: {
            settings: {
              difficulty: 1,
              level_order_matters: false,
              shuffle_elements: false,
            },
          },
        },
      });

      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      availableItem.click();

      const placeSlot = document.querySelector('[data-sequenceui-slot="true"]');
      placeSlot.click();

      expect(animateCalls.length).toBeGreaterThanOrEqual(1);
      const placementCall = animateCalls.find(c => c.element.dataset?.sequenceuiPlacedItem === "true");
      expect(placementCall).toBeDefined();
      expect(placementCall.options.duration).toBe(220);
      expect(placementCall.options.easing).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    } finally {
      window.Element.prototype.animate = origAnimate;
      window.Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    }
  });

  it("triggers FLIP return animation on available node when a placed element is removed", () => {
    const animateCalls = [];
    const origAnimate = window.Element.prototype.animate;
    const origGetBoundingClientRect = window.Element.prototype.getBoundingClientRect;

    window.Element.prototype.animate = function(keyframes, options) {
      animateCalls.push({ element: this, keyframes, options });
      return { cancel: () => {}, finish: () => {} };
    };

    window.Element.prototype.getBoundingClientRect = function() {
      if (this.dataset?.sequenceuiPlacedItem === "true") {
        return { left: 400, top: 200, width: 200, height: 40 };
      }
      if (this.dataset?.sequenceui === "available-item") {
        return { left: 50, top: 100, width: 200, height: 40 };
      }
      return { left: 0, top: 0, width: 0, height: 0 };
    };

    try {
      renderSequence({
        task_data: {
          content: {
            settings: {
              difficulty: 1,
              level_order_matters: false,
              shuffle_elements: false,
            },
          },
        },
      });

      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      availableItem.click();

      const placeSlot = document.querySelector('[data-sequenceui-slot="true"]');
      placeSlot.click();

      animateCalls.length = 0; // Clear placement calls

      const placedItem = document.querySelector('[data-sequenceui-placed-item="true"]');
      expect(placedItem).toBeTruthy();
      placedItem.click();

      expect(animateCalls.length).toBeGreaterThanOrEqual(1);
      const returnCall = animateCalls.find(c => c.element.dataset?.sequenceui === "available-item");
      expect(returnCall).toBeDefined();
      expect(returnCall.options.duration).toBe(220);
      expect(returnCall.options.easing).toBe("cubic-bezier(0.22, 1, 0.36, 1)");
    } finally {
      window.Element.prototype.animate = origAnimate;
      window.Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    }
  });

  it("creates floating dragAvatar when dragging available item past threshold and drops into slot", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;
    const origGetBoundingClientRect = window.Element.prototype.getBoundingClientRect;

    window.Element.prototype.animate = function() {
      return { cancel: () => {}, finish: () => {} };
    };

    window.Element.prototype.getBoundingClientRect = function() {
      return { left: 100, top: 100, width: 200, height: 40 };
    };

    try {
      renderSequence({
        task_data: {
          content: {
            settings: {
              difficulty: 1,
              level_order_matters: false,
              shuffle_elements: false,
            },
          },
        },
      });

      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      const targetSlot = document.querySelector('[data-sequenceui-slot="true"]');
      expect(availableItem).toBeTruthy();
      expect(targetSlot).toBeTruthy();

      // Dispatch pointerdown
      availableItem.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        button: 0,
        pointerType: "mouse",
        bubbles: true,
      }));

      // Small move <= 4px should NOT trigger drag
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 102,
        clientY: 102,
        bubbles: true,
      }));
      expect(document.querySelector(".fixed.z-\\[999999\\]")).toBeNull();

      // Mock elementFromPoint to return targetSlot when moving to (400, 200)
      document.elementFromPoint = (x, y) => {
        if (x === 400 && y === 200) {
          return targetSlot;
        }
        return null;
      };

      // Move past 4px threshold
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 400,
        clientY: 200,
        bubbles: true,
      }));

      const avatar = document.querySelector(".fixed.z-\\[999999\\]");
      expect(avatar).toBeTruthy();
      expect(avatar.textContent).toBe(availableItem.textContent);
      expect(targetSlot.classList.contains("seq-slot-hover")).toBe(true);

      // Release over slot
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 400,
        clientY: 200,
        bubbles: true,
      }));

      // Avatar should be removed and element placed into slot
      expect(document.querySelector(".fixed.z-\\[999999\\]")).toBeNull();
      const placedItem = document.querySelector('[data-sequenceui-placed-item="true"]');
      expect(placedItem).toBeTruthy();
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
      window.Element.prototype.getBoundingClientRect = origGetBoundingClientRect;
    }
  });

  it("restores origin element opacity when drag is dropped outside any slot", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;

    window.Element.prototype.animate = function() {
      return { cancel: () => {}, finish: () => {} };
    };

    document.elementFromPoint = () => null;

    try {
      renderSequence();

      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      availableItem.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 100,
        clientY: 100,
        button: 0,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      }));

      expect(document.querySelector(".fixed.z-\\[999999\\]")).toBeTruthy();
      expect(availableItem.style.opacity).toBe("0.3");

      // Release in empty space
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      }));

      expect(document.querySelector(".fixed.z-\\[999999\\]")).toBeNull();
      expect(availableItem.style.opacity).toBe("");
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("moves placed element between slots in the same level via pointer drag", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;
    const animateCalls = [];

    window.Element.prototype.animate = function(keyframes, options) {
      animateCalls.push({ element: this, keyframes, options });
      return { cancel: () => {}, finish: () => {} };
    };

    try {
      renderSequence({
        task_data: {
          content: {
            levels: [
              {
                level_id: "level_1",
                label: "Уровень 1",
                blocks: ["slot_1", "slot_2"],
              },
            ],
          },
        },
      });

      // Place first item in slot 0 via click
      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      availableItem.click();
      const firstEmptySlot = document.querySelector('[data-sequenceui-slot="true"]');
      firstEmptySlot.click();

      // Check slot 0 has placed item
      let placedBtn = document.querySelector('[data-sequenceui-placed-item="true"]');
      expect(placedBtn).toBeTruthy();
      expect(placedBtn.dataset.sequenceuiSlotIdx).toBe("0");

      // Find the second empty slot (slot 1)
      const slot1Target = document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-slot-idx="1"]');
      expect(slot1Target).toBeTruthy();

      document.elementFromPoint = (x, y) => {
        if (x === 180 && y === 180) {
          return slot1Target;
        }
        return null;
      };

      // Start dragging the placed item (> 4px)
      placedBtn.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 180,
        clientY: 180,
        bubbles: true,
      }));

      // Release over slot 1
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 180,
        clientY: 180,
        bubbles: true,
      }));

      // Now slot 0 should be empty and slot 1 should have the placed item
      const newPlacedBtn = document.querySelector('[data-sequenceui-placed-item="true"]');
      expect(newPlacedBtn).toBeTruthy();
      expect(newPlacedBtn.dataset.sequenceuiSlotIdx).toBe("1");

      const emptySlot0 = document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-slot-idx="0"]');
      expect(emptySlot0).toBeTruthy();
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("moves placed element across different levels via pointer drag", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;

    window.Element.prototype.animate = function() {
      return { cancel: () => {}, finish: () => {} };
    };

    try {
      renderSequence();

      // Place first item in Level 0, slot 0
      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      const elemId = availableItem.dataset.sequenceuiElementId;
      availableItem.click();
      const slotLvl0 = document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-level-idx="0"]');
      slotLvl0.click();

      let placedBtn = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-level-idx="0"]');
      expect(placedBtn).toBeTruthy();

      // Find slot in Level 1
      const slotLvl1 = document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-level-idx="1"]');
      expect(slotLvl1).toBeTruthy();

      document.elementFromPoint = (x, y) => {
        if (x === 250 && y === 250) {
          return slotLvl1;
        }
        return null;
      };

      // Drag placed item to Level 1
      placedBtn.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 250,
        clientY: 250,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 250,
        clientY: 250,
        bubbles: true,
      }));

      // Level 0 should now be empty, Level 1 should have the item
      const placedLvl0 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-level-idx="0"]');
      expect(placedLvl0).toBeNull();

      const placedLvl1 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-level-idx="1"]');
      expect(placedLvl1).toBeTruthy();
      expect(placedLvl1.dataset.sequenceuiElementId).toBe(elemId);
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("returns placed element back to sidebar when dragged over available sidebar", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;

    window.Element.prototype.animate = function() {
      return { cancel: () => {}, finish: () => {} };
    };

    try {
      renderSequence();

      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      const elemId = availableItem.dataset.sequenceuiElementId;
      availableItem.click();
      const emptySlot = document.querySelector('[data-sequenceui-slot="true"]');
      emptySlot.click();

      // Ensure item is placed
      let placedBtn = document.querySelector('[data-sequenceui-placed-item="true"]');
      expect(placedBtn).toBeTruthy();

      const sidebar = document.querySelector('[data-sequenceui="available-sidebar"]');
      expect(sidebar).toBeTruthy();

      document.elementFromPoint = (x, y) => {
        if (x === 900 && y === 200) {
          return sidebar;
        }
        return null;
      };

      // Drag placed item back to sidebar
      placedBtn.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 900,
        clientY: 200,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 900,
        clientY: 200,
        bubbles: true,
      }));

      // Placed item must be removed from level
      expect(document.querySelector('[data-sequenceui-placed-item="true"]')).toBeNull();

      // Item should be back in available sidebar
      const returnedItem = document.querySelector(`[data-sequenceui="available-item"][data-sequenceui-element-id="${elemId}"]`);
      expect(returnedItem).toBeTruthy();
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("swaps two placed elements when one is dragged over another", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;

    window.Element.prototype.animate = function() {
      return { cancel: () => {}, finish: () => {} };
    };

    try {
      renderSequence({
        task_data: {
          content: {
            levels: [
              {
                level_id: "level_1",
                label: "Уровень 1",
                blocks: ["slot_1", "slot_2"],
              },
            ],
          },
        },
      });

      // Place first item in slot 0
      const item1 = document.querySelectorAll('[data-sequenceui="available-item"]')[0];
      const id1 = item1.dataset.sequenceuiElementId;
      item1.click();
      document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-slot-idx="0"]').click();

      // Place second item in slot 1
      const item2 = document.querySelectorAll('[data-sequenceui="available-item"]')[0];
      const id2 = item2.dataset.sequenceuiElementId;
      item2.click();
      document.querySelector('[data-sequenceui-slot="true"][data-sequenceui-slot-idx="1"]').click();

      let placed0 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-slot-idx="0"]');
      let placed1 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-slot-idx="1"]');
      expect(placed0.dataset.sequenceuiElementId).toBe(id1);
      expect(placed1.dataset.sequenceuiElementId).toBe(id2);

      document.elementFromPoint = (x, y) => {
        if (x === 200 && y === 100) {
          return placed1;
        }
        return null;
      };

      // Drag placed0 over placed1
      placed0.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 200,
        clientY: 100,
        bubbles: true,
      }));

      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 200,
        clientY: 100,
        bubbles: true,
      }));

      // Positions should be cleanly swapped!
      placed0 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-slot-idx="0"]');
      placed1 = document.querySelector('[data-sequenceui-placed-item="true"][data-sequenceui-slot-idx="1"]');
      expect(placed0.dataset.sequenceuiElementId).toBe(id2);
      expect(placed1.dataset.sequenceuiElementId).toBe(id1);
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("preserves click-to-remove without triggering drag when movement is <= 4px", () => {
    renderSequence();

    const availableItem = document.querySelector('[data-sequenceui="available-item"]');
    const elemId = availableItem.dataset.sequenceuiElementId;
    availableItem.click();
    const emptySlot = document.querySelector('[data-sequenceui-slot="true"]');
    emptySlot.click();

    const placedBtn = document.querySelector('[data-sequenceui-placed-item="true"]');
    expect(placedBtn).toBeTruthy();

    // Regular click on placed item
    placedBtn.click();

    // Item is removed and returned to sidebar
    expect(document.querySelector('[data-sequenceui-placed-item="true"]')).toBeNull();
    expect(document.querySelector(`[data-sequenceui="available-item"][data-sequenceui-element-id="${elemId}"]`)).toBeTruthy();
  });
  it("animates empty slot placeholder entry when an item is removed from a slot", () => {
    const origAnimate = window.Element.prototype.animate;
    const animateCalls = [];
    window.Element.prototype.animate = function(keyframes, options) {
      animateCalls.push({ element: this, keyframes, options });
      return { cancel: () => {}, finish: () => {} };
    };

    try {
      renderSequence();
      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      availableItem.click();
      const placeSlot = document.querySelector('[data-sequenceui-slot="true"]');
      placeSlot.click();

      // Clear calls from placement
      animateCalls.length = 0;

      const placedBtn = document.querySelector('[data-sequenceui-placed-item="true"]');
      placedBtn.click();

      const emptySlotCall = animateCalls.find(c => c.element.dataset?.sequenceuiSlot === "true");
      expect(emptySlotCall).toBeDefined();
      expect(emptySlotCall.options.duration).toBe(180);
      expect(emptySlotCall.keyframes[0].transform).toBe("scale(0.95)");
    } finally {
      window.Element.prototype.animate = origAnimate;
    }
  });

  it("toggles seq-avatar-snapping on drag avatar when hovering over slot targets", () => {
    const origElementFromPoint = document.elementFromPoint;
    const origAnimate = window.Element.prototype.animate;
    window.Element.prototype.animate = () => ({ cancel: () => {}, finish: () => {} });

    try {
      renderSequence();
      const availableItem = document.querySelector('[data-sequenceui="available-item"]');
      const emptySlot = document.querySelector('[data-sequenceui-slot="true"]');

      availableItem.dispatchEvent(new window.PointerEvent("pointerdown", {
        clientX: 50,
        clientY: 50,
        button: 0,
        bubbles: true,
      }));

      // Move over empty space
      document.elementFromPoint = () => null;
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 100,
        clientY: 100,
        bubbles: true,
      }));

      const dragAvatar = document.querySelector(".fixed.z-\\[999999\\]");
      expect(dragAvatar).toBeTruthy();
      expect(dragAvatar.classList.contains("seq-avatar-snapping")).toBe(false);

      // Move over slot
      document.elementFromPoint = () => emptySlot;
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 200,
        clientY: 200,
        bubbles: true,
      }));

      expect(dragAvatar.classList.contains("seq-avatar-snapping")).toBe(true);

      // Move away
      document.elementFromPoint = () => null;
      window.dispatchEvent(new window.PointerEvent("pointermove", {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      }));

      expect(dragAvatar.classList.contains("seq-avatar-snapping")).toBe(false);

      // Cleanup
      window.dispatchEvent(new window.PointerEvent("pointerup", {
        clientX: 300,
        clientY: 300,
        bubbles: true,
      }));
    } finally {
      document.elementFromPoint = origElementFromPoint;
      window.Element.prototype.animate = origAnimate;
    }
  });
});

