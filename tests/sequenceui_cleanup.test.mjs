/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const code = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/SequenceUI/SequenceUI.web.js"),
  "utf8"
);

let SequenceUI;

beforeAll(() => {
  window.requestAnimationFrame = window.requestAnimationFrame || ((cb) => {
    cb();
    return 1;
  });
  global.requestAnimationFrame = window.requestAnimationFrame;
  window.eval(`${code}\n;window.SequenceUI = SequenceUI;`);
  SequenceUI = window.SequenceUI;
});

describe("SequenceUI cleanup", () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="seq-root"></div>`;
  });

  afterEach(() => {
    SequenceUI.cleanup();
    vi.restoreAllMocks();
  });

  it("removes the resize listener registered during render", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const container = document.getElementById("seq-root");

    SequenceUI.render(container, {
      task_data: {
        content: {
          elements: [{ id: "e1", text: "One" }],
          levels: [{ level_id: "l1", label: "Level 1", slots: ["slot_1"] }],
        },
      },
    });

    const resizeCall = addSpy.mock.calls.find((call) => call[0] === "resize");
    expect(resizeCall).toBeTruthy();

    SequenceUI.cleanup();

    expect(removeSpy).toHaveBeenCalledWith("resize", resizeCall[1]);
  });
});
