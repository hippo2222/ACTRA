/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import fs from "fs";
import path from "path";

const code = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/SequenceUI/ImageLabelUI.web.js"),
  "utf8"
);

let ImageLabelUI;

function renderImageLabeling(taskOverrides = {}) {
  const container = document.getElementById("task-content");
  
  const baseTask = {
    id: "task_6b008145",
    type: "image_labeling",
    content: {
      image: "modules/proverka_skhem/topics/proverochka/tasks/task_6b008145/images/image.png",
      zones: [
        {
          color: "#f2f2f2",
          id: "zone_1",
          label: "Fibula",
          rect: { x: 10, y: 10, width: 20, height: 10 }
        },
        {
          color: "#6366f1",
          id: "zone_2",
          label: "Patella",
          rect: { x: 30, y: 30, width: 20, height: 10 }
        }
      ]
    },
    settings: {
      difficulty: 1,
      allow_hints: false
    }
  };

  const task = {
    ...baseTask,
    ...taskOverrides,
    content: {
      ...baseTask.content,
      ...(taskOverrides.content || {})
    },
    settings: {
      ...baseTask.settings,
      ...(taskOverrides.settings || {})
    }
  };

  ImageLabelUI.render(container, task);
  return container;
}

beforeAll(() => {
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => {
    cb();
    return 1;
  });
  global.requestAnimationFrame = window.requestAnimationFrame;
  
  // Eval code and attach to window
  window.eval(`${code}\n;window.ImageLabelUI = ImageLabelUI;`);
  ImageLabelUI = window.ImageLabelUI;
});

describe("ImageLabelUI render stability", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="task-content"></div>`;
  });

  it("successfully renders base structure (image, viewport, zoom controls)", () => {
    const container = renderImageLabeling();
    
    // Check main workspace and viewport elements
    const workspace = container.querySelector('#player-workspace');
    const viewport = container.querySelector('#player-viewport');
    const canvasContainer = container.querySelector('#player-canvas-container');
    const img = container.querySelector('#player-main-image');
    
    expect(workspace).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(canvasContainer).not.toBeNull();
    expect(img).not.toBeNull();
    expect(img.src).toContain("local-image?path=");
  });

  it("renders zoom controls with reset button", () => {
    const container = renderImageLabeling();
    
    const zoomIn = container.querySelector('#p-zoom-in');
    const zoomOut = container.querySelector('#p-zoom-out');
    const zoomReset = container.querySelector('#p-zoom-reset');
    const zoomValue = container.querySelector('#p-zoom-value');
    
    expect(zoomIn).not.toBeNull();
    expect(zoomOut).not.toBeNull();
    expect(zoomReset).not.toBeNull();
    expect(zoomValue).not.toBeNull();
  });

  it("renders right sidebar labels pool in difficulty 1", () => {
    const container = renderImageLabeling({
      settings: { difficulty: 1 }
    });
    
    const img = container.querySelector('#player-main-image');
    Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    img.dispatchEvent(new window.Event('load'));
    
    const pool = container.querySelector('#labels-pool');
    expect(pool).not.toBeNull();
    
    // Check that we have two cards in the pool
    const cards = pool.querySelectorAll('[data-label-id]');
    expect(cards.length).toBe(2);
    
    const labels = Array.from(cards).map(c => c.getAttribute('data-label-val'));
    expect(labels).toContain("Fibula");
    expect(labels).toContain("Patella");
  });

  it("successfully executes onImageReady with naturalWidth resolution", () => {
    const container = renderImageLabeling();
    const img = container.querySelector('#player-main-image');
    
    // Simulate image loaded properties
    Object.defineProperty(img, 'naturalWidth', { value: 1200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 900, configurable: true });
    
    // Dispatch load event
    const loadEvent = new window.Event('load');
    img.dispatchEvent(loadEvent);
    
    const canvasContainer = container.querySelector('#player-canvas-container');
    expect(canvasContainer.style.width).toBe("1200px");
    expect(canvasContainer.style.height).toBe("900px");
    
    // Verify interactive zones are created
    const zones = canvasContainer.querySelectorAll('.player-zone-overlay');
    expect(zones.length).toBe(2);
    expect(zones[0].style.left).toBe("10%");
    expect(zones[1].style.left).toBe("30%");
  });
});
