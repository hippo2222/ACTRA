import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function mountClickUi() {
  const dom = new JSDOM("<!DOCTYPE html><html><body><div id=\"app\"></div></body></html>", {
    url: "http://localhost",
    runScripts: "dangerously",
    resources: "usable",
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.HTMLInputElement = dom.window.HTMLInputElement;
  global.Node = dom.window.Node;

  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
  dom.window.console = console;

  dom.window.eval(loadScript("frontend/ClickUI/ClickUI.web.js"));
  return dom;
}

function createDrawTaskWithAdditionalInfo() {
  return {
    task_type: "draw",
    difficulty: 1,
    task_data: {
      task_type: "draw",
      _difficulty_level: 1,
      content: {
        prompt: "Обведи нужную область и проверь результат.",
        image_url: "",
        additionalInfo: {
          type: "combined",
          text: "Подсказка для проверки результата.",
          images: ["sample.png"],
        },
      },
    },
    answer_key: {
      targets: [
        {
          label: "Контур цели",
          shape: "polygon",
          points: [[10, 10], [20, 10], [20, 20], [10, 20]],
        },
      ],
    },
  };
}

describe("ClickUI runtime side panels", () => {
  let dom;

  beforeEach(() => {
    dom = mountClickUi();
  });

  it("keeps runtime panels from shrinking when additional materials are present", () => {
    const task = createDrawTaskWithAdditionalInfo();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const targetsPanel = container.querySelector('[data-clickui="targets-panel"]');
    const userActionsPanel = container.querySelector('[data-clickui="user-actions-section"]');
    const additionalInfoPanel = container.querySelector('[data-clickui="additional-info"]');
    const sideColumn = additionalInfoPanel?.parentElement;

    expect(targetsPanel).toBeTruthy();
    expect(userActionsPanel).toBeTruthy();
    expect(additionalInfoPanel).toBeTruthy();
    expect(targetsPanel?.className || "").toContain("shrink-0");
    expect(userActionsPanel?.className || "").toContain("shrink-0");
    expect(additionalInfoPanel?.className || "").toContain("shrink-0");
    expect(sideColumn?.className || "").not.toContain("lg:max-h-[calc(100vh-128px)]");
    expect(sideColumn?.className || "").not.toContain("lg:overflow-y-auto");
  });
});
