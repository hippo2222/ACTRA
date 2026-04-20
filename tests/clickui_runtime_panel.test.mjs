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
  global.PointerEvent = dom.window.PointerEvent || dom.window.MouseEvent;

  if (!dom.window.PointerEvent) {
    dom.window.PointerEvent = dom.window.MouseEvent;
  }
  if (!dom.window.HTMLElement.prototype.setPointerCapture) {
    dom.window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!dom.window.HTMLElement.prototype.releasePointerCapture) {
    dom.window.HTMLElement.prototype.releasePointerCapture = () => {};
  }

  dom.window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
  dom.window.console = console;
  dom.window.TaskMetadataPanel = {
    create() {
      return {
        rootEl: dom.window.document.createElement("div"),
        api: {
          collect: () => null,
          setLocked: () => {},
          updateAnnotationTotals: () => {},
        },
      };
    },
  };

  dom.window.eval(loadScript("frontend/ClickUI/ClickUI.web.js"));
  return dom;
}

function primeClickUiImage(
  container,
  dom,
  rect = { left: 0, top: 0, width: 100, height: 100 },
  naturalSize = { width: rect.width, height: rect.height }
) {
  const img = container.querySelector("img");
  expect(img).toBeTruthy();
  Object.defineProperty(img, "naturalWidth", { configurable: true, value: naturalSize.width });
  Object.defineProperty(img, "naturalHeight", { configurable: true, value: naturalSize.height });
  img.getBoundingClientRect = () => ({
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  });
  return img;
}

function drawStroke(dom, container, points) {
  const viewport = container.querySelector('[data-clickui="viewport"]');
  expect(viewport).toBeTruthy();
  const safePoints = Array.isArray(points) ? points : [];
  expect(safePoints.length).toBeGreaterThanOrEqual(2);
  const base = {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    buttons: 1,
    bubbles: true,
  };
  viewport.dispatchEvent(
    new dom.window.PointerEvent("pointerdown", {
      ...base,
      clientX: safePoints[0][0],
      clientY: safePoints[0][1],
    })
  );
  for (let index = 1; index < safePoints.length; index += 1) {
    dom.window.dispatchEvent(
      new dom.window.PointerEvent("pointermove", {
        ...base,
        clientX: safePoints[index][0],
        clientY: safePoints[index][1],
      })
    );
  }
  const last = safePoints[safePoints.length - 1];
  dom.window.dispatchEvent(
    new dom.window.PointerEvent("pointerup", {
      ...base,
      buttons: 0,
      clientX: last[0],
      clientY: last[1],
    })
  );
}

function createClickTaskFixture(targets = null) {
  return {
    task_type: "click",
    difficulty: 1,
    task_data: {
      task_type: "click",
      _difficulty_level: 1,
      content: {
        prompt: "Найди две цели на изображении.",
        image_url: "",
      },
    },
    answer_key: {
      targets:
        targets || [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
          {
            label: "Последние три слова текста",
            shape: "polygon",
            points: [[40, 40], [60, 40], [60, 60], [40, 60]],
          },
        ],
    },
  };
}

function createLevel2ClickTaskWithoutExplicitLabels(targets = null) {
  return {
    task_type: "click",
    difficulty: 2,
    task_data: {
      task_type: "click",
      _difficulty_level: 2,
      content: {
        prompt: "Кликните по нужной области и назовите её.",
        image_url: "",
      },
    },
    answer_key: {
      targets:
        targets || [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
    },
  };
}

function createDrawTaskFixture(targets = null) {
  return {
    task_type: "draw",
    difficulty: 3,
    task_data: {
      task_type: "draw",
      _difficulty_level: 1,
      content: {
        prompt: "Обведи и дорисуй нужные фрагменты на изображении.",
        image_url: "",
      },
    },
    answer_key: {
      targets:
        targets || [
          {
            label: "Центр мишени",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
    },
  };
}

function createClickLevel3OutlineTask(targets = null) {
  return {
    task_type: "click",
    difficulty: 3,
    task_data: {
      task_type: "click",
      _difficulty_level: 3,
      content: {
        prompt: "Обведите нужную область и назовите её.",
        image_url: "",
      },
    },
    answer_key: {
      targets:
        targets || [
          {
            label: "Контур миокарда",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
    },
  };
}

describe("ClickUI runtime targets panel", () => {
  let dom;

  beforeEach(() => {
    dom = mountClickUi();
  });

  it("keeps a single instruction block above a scrollable targets list", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const panel = container.querySelector('[data-clickui="targets-panel"]');
    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const guide = container.querySelector('[data-clickui="targets-guide"]');
    const listSection = container.querySelector('[data-clickui="targets-list-section"]');

    expect(panel).toBeTruthy();
    expect(instruction).toBeTruthy();
    expect(guide).toBeNull();
    expect(panel.textContent).not.toContain("Что нужно сделать");
    expect(listSection?.className).toContain("px-3");
    expect(listSection?.className).toContain("py-3");
  });

  it("prefers canonical asset refs over legacy image_path in runtime viewport media", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");
    task.task_data.content.image_asset_id = "asset_click_1";
    task.task_data.content.image_path = "legacy/click.png";

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const image = container.querySelector("img");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("/api/assets/asset_click_1/content");
  });

  it("renders click-oriented guidance for polygon targets", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));

    expect(instruction?.textContent).toContain("кликни по соответствующей области");
    expect(instruction?.textContent).not.toContain("проведи линию");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Область #1");
    expect(rows[0].textContent).toContain("Цвет цели");
  });

  it("renders drawing-oriented guidance when freehand targets are present", () => {
    const task = createClickTaskFixture([
      {
        label: "Обведи береговую линию",
        shape: "freehand",
        points: [[10, 10], [30, 20], [45, 35]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const row = container.querySelector('[data-clickui="target-row"]');

    expect(instruction?.textContent).toContain("проведи линию");
    expect(instruction?.textContent).not.toContain("кликни по соответствующей области");
    expect(row?.textContent).toContain("Линия #1");
  });

  it("renders contour-oriented guidance for draw polygon targets", () => {
    const task = createDrawTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const panel = container.querySelector('[data-clickui="targets-panel"]');
    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const row = container.querySelector('[data-clickui="target-row"]');
    expect(panel?.textContent).toContain("Что нужно отметить");
    expect(instruction?.textContent).toContain("обведи нужную область");
    expect(instruction?.textContent).not.toContain("кликни по соответствующей области");
    expect(row?.textContent).toContain("Контур #1");
  });

  it("accentuates outline guidance for click level 3 runtime tasks", () => {
    const task = createClickLevel3OutlineTask();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const header = container.querySelector('[data-clickui="targets-header"]');
    const subtitleWrap = container.querySelector('[data-clickui="targets-subtitle-wrap"]');
    const title = container.querySelector('[data-clickui="targets-title"]');
    const outlineVerb = container.querySelector('[data-clickui="target-verb-outline"]');

    expect(title?.textContent || "").toContain("Что нужно отметить");
    expect(header?.className || "").toContain("clickui-targets-attention");
    expect(subtitleWrap?.className || "").toContain("clickui-targets-attention");
    expect(outlineVerb?.textContent || "").toContain("Обвести");
    expect(outlineVerb?.className || "").toContain("clickui-outline-verb-attention");
  });

  it("shows label inputs for iteration 2 even when requires_labels is explicitly false", () => {
    const task = {
      task_type: "click",
      difficulty: 1,
      iteration: 2,
      task_data: {
        task_type: "click",
        _difficulty_level: 1,
        content: {
          prompt: "Кликните по нужной области и назовите её.",
          image_url: "",
          requires_labels: false,
        },
      },
      answer_key: {
        targets: [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15 }],
    });

    const labelsSection = container.querySelector('[data-clickui="labels-section"]');
    const labelInput = labelsSection?.querySelector('input[type="text"]');

    expect(labelInput).toBeTruthy();
    expect(labelInput?.getAttribute("placeholder")).toContain("Введите");
  });

  it("distinguishes contours from lines for mixed draw targets", () => {
    const task = createDrawTaskFixture([
      {
        label: "Центр мишени",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
      {
        label: "Подчеркни финальную строку",
        shape: "freehand",
        points: [[40, 40], [60, 40], [70, 42]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(instruction?.textContent).toContain("Контур");
    expect(instruction?.textContent).toContain("Линия");
    expect(instruction?.textContent).not.toContain("кликать");
    expect(rows[0]?.textContent).toContain("Контур #1");
    expect(rows[1]?.textContent).toContain("Линия #1");
  });

  it("keeps draw action colors distinct from target colors before check", () => {
    const task = createDrawTaskFixture([
      {
        label: "Центр мишени",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
      {
        label: "Подчеркни финальную строку",
        shape: "freehand",
        points: [[40, 40], [60, 40], [70, 42]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      polygons: [{ points: [[10, 10], [20, 10], [20, 20], [10, 20]] }],
      lines: [{ points: [[40, 40], [55, 40], [70, 42]] }],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    const targetRows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    const actionRows = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));
    const contourTargetBadge = targetRows[0]?.firstElementChild;
    const lineTargetBadge = targetRows[1]?.firstElementChild;
    const contourActionBadge = actionRows[0]?.firstElementChild;
    const lineActionBadge = actionRows[1]?.firstElementChild;

    expect(actionRows).toHaveLength(2);
    expect(contourActionBadge?.style.backgroundColor).not.toBe(contourTargetBadge?.style.backgroundColor);
    expect(lineActionBadge?.style.backgroundColor).not.toBe(lineTargetBadge?.style.backgroundColor);
    expect(contourActionBadge?.style.backgroundColor).not.toBe(lineActionBadge?.style.backgroundColor);
  });

  it("fills search progress and marks found targets after check feedback", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    const toggles = container.querySelector('[data-clickui="ref-toggles"]');
    const userMarksCheckbox = container.querySelector('[data-clickui="user-marks"]');
    const progress = container.querySelector('[data-clickui="targets-progress"]');

    expect(progress).toBeNull();
    expect(rows[0]?.className || "").toContain("ring-success-light");
    expect(rows[1]?.className || "").toContain("ring-success-light");
    expect(toggles?.classList.contains("hidden")).toBe(false);
    expect(userMarksCheckbox?.checked).toBe(true);
  });

  it("restores saved click input and keeps the found targets in payload", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      found_targets: [0],
      total_targets: 2,
      action_history: [{ kind: "click" }],
    });

    const payload = dom.window.ClickUI.getUserAnswerPayload();
    const progress = container.querySelector('[data-clickui="targets-progress"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));

    expect(payload.clicks).toHaveLength(1);
    expect(payload.found_targets).toEqual([0]);
    expect(payload.action_history).toEqual([{ kind: "click" }]);
    expect(progress).toBeNull();
    expect(rows[0]?.className || "").not.toContain("ring-success-light");
    expect(rows[1]?.className || "").not.toContain("ring-success-light");
  });

  it("shows click label inputs on level 2 even without explicit requires_labels flag", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
      labels_clicks: [""],
    });

    const input = container.querySelector('.clickui-card-entry input[type="text"]');
    const sideColumn = container.querySelector('[data-clickui="side-column"]');
    const labelsSection = container.querySelector('[data-clickui="labels-section"]');
    const statusCard = container.querySelector('[data-clickui="status-card"]');
    const additionalInfo = container.querySelector('[data-clickui="additional-info"]');
    const labelsGrid = container.querySelector('[data-clickui="labels-card"] > div:last-child');
    const labelsHeader = container.querySelector('[data-clickui="labels-card"] > div:first-child');
    const inputLabel = container.querySelector('label[for="clickui-click-1"]');
    const row = container.querySelector('[data-clickui="labels-card"] > div:last-child > div');
    const labelsIndicator = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent || "").includes("Ваши действия")
    );

    expect(input).toBeTruthy();
    expect(input?.id || "").toContain("clickui-click-1");
    expect(input?.getAttribute("aria-label") || "").toContain("Клик 1");
    expect(sideColumn?.contains(input)).toBe(true);
    expect(Array.from(sideColumn?.children || [])).toContain(labelsSection);
    expect(statusCard).toBeNull();
    if (additionalInfo) {
      expect(labelsSection?.compareDocumentPosition(additionalInfo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(labelsHeader?.textContent || "").toContain("Ваши действия");
    expect(inputLabel).toBeNull();
    expect(row?.className || "").toContain("items-center");
    expect(labelsGrid?.className || "").toContain("grid-cols-1");
    expect(labelsGrid?.className || "").not.toContain("sm:grid-cols-3");
    expect(labelsIndicator).toBeUndefined();
  });

  it("shows the source task prompt on level 2 in the targets panel", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
      labels_clicks: [""],
    });

    const prompt = container.querySelector('[data-clickui="targets-prompt"]');
    const instruction = container.querySelector('[data-clickui="targets-instruction"]');
    const list = container.querySelector('[data-clickui="targets-list"]');
    const rows = container.querySelectorAll('[data-clickui="target-row"]');
    const statusCard = container.querySelector('[data-clickui="status-card"]');

    expect(prompt?.textContent || "").toContain("Кликните по нужной области и назовите её.");
    expect(instruction?.textContent || "").toContain("кликай только по подходящим областям");
    expect(instruction?.textContent || "").toContain("Сделано 1 кликов из 1 доступных.");
    expect(instruction?.textContent || "").toContain("Введи названия для отмеченных целей");
    expect(list).toBeNull();
    expect(rows).toHaveLength(0);
    expect(statusCard).toBeNull();
  });

  it("shows contour and line progress instead of click progress for level 2 draw tasks", () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Обведите центр, затем подчеркните текст.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
          {
            label: "Текст",
            shape: "freehand",
            points: [[40, 40], [60, 40], [70, 42]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const instruction = container.querySelector('[data-clickui="targets-instruction"]');

    expect(instruction?.textContent || "").toContain("Контуры 0 из 1. Линии 0 из 1.");
    expect(instruction?.textContent || "").not.toContain("кликов");
  });

  it("allows drawing a contour after a line when the task still has polygon slots", () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Обведите центр, затем подчеркните текст.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
          {
            label: "Текст",
            shape: "freehand",
            points: [[40, 40], [60, 40], [70, 42]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(container, dom);
    drawStroke(dom, container, [
      [40, 40],
      [60, 40],
      [70, 42],
    ]);
    drawStroke(dom, container, [
      [10, 10],
      [25, 10],
      [25, 25],
      [10, 25],
      [10, 10],
    ]);

    const payload = dom.window.ClickUI.getUserAnswerPayload();
    const instruction = container.querySelector('[data-clickui="targets-instruction"]');

    expect(payload.lines || []).toHaveLength(1);
    expect(payload.polygons || []).toHaveLength(1);
    expect(instruction?.textContent || "").toContain("Контуры 1 из 1. Линии 1 из 1.");
  });

  it("classifies an overdrawn closed stroke as a contour for draw tasks", () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Обведите область.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Центр",
            shape: "polygon",
            points: [[10, 10], [25, 10], [25, 25], [10, 25]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(container, dom);
    drawStroke(dom, container, [
      [10, 10],
      [25, 10],
      [25, 25],
      [10, 25],
      [10, 10],
      [14, 10],
    ]);

    const payload = dom.window.ClickUI.getUserAnswerPayload();

    expect(payload.polygons || []).toHaveLength(1);
    expect(payload.lines || []).toHaveLength(0);
    expect(payload.polygons?.[0]?.points || []).toHaveLength(5);
  });

  it("keeps contour classification stable for high-resolution draw tasks routed through ClickUI", () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Обведите область.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Область",
            shape: "polygon",
            points: [[40, 40], [200, 40], [200, 200], [40, 200]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(
      container,
      dom,
      { left: 0, top: 0, width: 500, height: 250 },
      { width: 2000, height: 1000 }
    );
    drawStroke(dom, container, [
      [10, 10],
      [50, 10],
      [50, 50],
      [10, 50],
      [18, 12],
      [14, 10],
    ]);

    const payload = dom.window.ClickUI.getUserAnswerPayload();

    expect(payload.polygons || []).toHaveLength(1);
    expect(payload.lines || []).toHaveLength(0);
  });

  it("includes display dimensions in routed draw payloads for scale-aware evaluation", () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Обведите область.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Область",
            shape: "polygon",
            points: [[10, 10], [25, 10], [25, 25], [10, 25]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(
      container,
      dom,
      { left: 0, top: 0, width: 500, height: 250 },
      { width: 2000, height: 1000 }
    );
    drawStroke(dom, container, [
      [10, 10],
      [25, 10],
      [25, 25],
      [10, 25],
      [10, 10],
    ]);

    const payload = dom.window.ClickUI.getUserAnswerPayload();

    expect(payload.image_width).toBe(2000);
    expect(payload.image_height).toBe(1000);
    expect(payload.display_width).toBe(500);
    expect(payload.display_height).toBe(250);
  });

  it("highlights undo when routed draw exceeds the freehand limit", async () => {
    const task = {
      task_type: "draw",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {
          prompt: "Подчеркните фрагмент.",
          image_url: "",
        },
      },
      answer_key: {
        targets: [
          {
            label: "Текст",
            shape: "freehand",
            points: [[40, 40], [60, 40], [70, 42]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(container, dom);
    dom.window.ClickUI.restoreInput({
      lines: [{ points: [[40, 40], [60, 40], [70, 42]] }],
      action_history: [{ kind: "line" }],
      labels_lines: [""],
    });

    drawStroke(dom, container, [
      [42, 44],
      [60, 44],
      [72, 45],
    ]);
    await new Promise((resolve) => setTimeout(resolve, 120));

    const undoBtn = container.querySelector('[data-clickui="toolbar-undo"]');

    expect(undoBtn?.className || "").toContain("clickui-undo-attention");
  });

  it("suggests undo and highlights the undo tool when click limit is reached", async () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
      labels_clicks: [""],
    });

    const viewport = container.querySelector('[data-clickui="viewport"]');
    const hintText = container.querySelector('[data-clickui="targets-instruction"]');
    const undoBtn = container.querySelector('[data-clickui="toolbar-undo"]');
    const statusCard = container.querySelector('[data-clickui="status-card"]');

    viewport?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(hintText?.textContent || "").toContain("Проверить");
    expect(hintText?.textContent || "").toContain("Отменить");
    expect(statusCard).toBeNull();
    expect(undoBtn?.className || "").toContain("clickui-undo-attention");
    expect(undoBtn?.style.backgroundColor || "").not.toBe("");
    expect(undoBtn?.style.transform || "").toContain("scale");
  });

  it("animates labels card out when the last click is undone", async () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
      labels_clicks: [""],
    });

    const undoBtn = container.querySelector('[data-clickui="toolbar-undo"]');
    const labelsCard = container.querySelector('[data-clickui="labels-card"]');

    expect(labelsCard).toBeTruthy();

    undoBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    const exitingCard = container.querySelector('[data-clickui="labels-card"]');
    expect(exitingCard?.className || "").toContain("clickui-card-exit");

    await new Promise((resolve) => setTimeout(resolve, 260));
    expect(container.querySelector('[data-clickui="labels-card"]')).toBeNull();
  });

  it("shows pending user actions before check", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
    });

    const section = container.querySelector('[data-clickui="user-actions-section"]');
    const list = container.querySelector('[data-clickui="user-actions-list"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));

    expect(section).toBeTruthy();
    expect(list?.className || "").toContain("overflow-y-auto");
    expect(list?.className || "").toContain("max-h-52");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent || "").toContain("Клик 1");
    expect(rows[0]?.textContent || "").toContain("Ожидает проверки");
  });

  it("maps click actions from found_targets when evaluator omits click_results", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent || "").toMatch(/Клик 1/);
    expect(rows[0]?.textContent || "").toMatch(/Засчитано/);
    expect(rows[0]?.textContent || "").toMatch(/Область #1/);
    expect(rows[0]?.textContent || "").not.toMatch(/Не сопоставлено/);
  });

  it("shows system interpretation for matched user actions after check", () => {
    const task = createDrawTaskFixture([
      {
        label: "Центр мишени",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
      {
        label: "Подчеркни финальную строку",
        shape: "freehand",
        points: [[40, 40], [60, 40], [70, 42]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      polygons: [{ points: [[10, 10], [20, 10], [20, 20], [10, 20]] }],
      lines: [{ points: [[40, 40], [55, 40], [70, 42]] }],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        polygon_results: [
          {
            target_index: 0,
            polygon_success: true,
            coverage: 92,
            threshold: 75,
            matched_polygon_idx: 0,
          },
        ],
        line_results: [
          {
            target_index: 1,
            line_success: false,
            coverage: 61,
            threshold: 75,
            matched_line_idx: 0,
          },
        ],
        found_targets: [0],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));

    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent || "").toContain("Контур 1");
    expect(rows[0]?.textContent || "").toContain("Засчитано");
    expect(rows[0]?.textContent || "").toContain("Контур #1");
    expect(rows[0]?.textContent || "").toContain("92%");
    expect(rows[1]?.textContent || "").toContain("Штрих 1");
    expect(rows[1]?.textContent || "").toContain("Не засчитано");
    expect(rows[1]?.textContent || "").toContain("Линия #1");
    expect(rows[1]?.textContent || "").toContain("61%");
  });

  it("renders image-based review previews after click answer check", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        click_results: [
          { target_index: 0, click_success: true },
          { target_index: 1, click_success: false },
        ],
        found_targets: [0],
      },
    });

    const review = container.querySelector('[data-clickui="review-comparison"]');
    const userPreview = container.querySelector('[data-clickui="review-user-preview"]');
    const refPreview = container.querySelector('[data-clickui="review-reference-preview"]');

    expect(review).toBeTruthy();
    expect(userPreview?.textContent || "").toContain("Ваш ответ");
    expect(refPreview?.textContent || "").toContain("Эталон");
    expect(userPreview?.querySelector("svg")).toBeTruthy();
    expect(refPreview?.querySelector("svg")).toBeTruthy();
    expect(refPreview?.querySelectorAll("path, circle").length || 0).toBeGreaterThan(0);
  });

  it("does not render review comparison for level 2 click tasks in runtime mode", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      labels_clicks: ["Подпись пользователя"],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        click_results: [{ target_index: 0, click_success: true, matched_click_idx: 0 }],
        found_targets: [0],
      },
    });

    expect(container.querySelector('[data-clickui="review-comparison"]')).toBeNull();
  });

  it("renders click review labels in non-runtime mode", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: false });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      labels_clicks: ["Подпись пользователя"],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        click_results: [{ target_index: 0, click_success: true, matched_click_idx: 0 }],
        found_targets: [0],
      },
    });

    const review = container.querySelector('[data-clickui="review-comparison"]');
    const userLabels = container.querySelector('[data-clickui="review-user-labels"]');
    const refLabels = container.querySelector('[data-clickui="review-reference-labels"]');

    expect(review).toBeTruthy();
    expect(userLabels?.textContent || "").toContain("Подпись пользователя");
    expect(refLabels?.textContent || "").toContain("Центр");
  });

  it("does not render review comparison for draw tasks in runtime mode", () => {
    const task = createDrawTaskFixture([
      {
        label: "Контур мишени",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      polygons: [{ points: [[10, 10], [20, 10], [20, 20], [10, 20]] }],
      labels_polygons: ["Контур пользователя"],
      action_history: [{ kind: "polygon" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        polygon_results: [
          {
            target_index: 0,
            polygon_success: true,
            coverage: 95,
            threshold: 75,
            matched_polygon_idx: 0,
          },
        ],
        found_targets: [0],
      },
    });

    expect(container.querySelector('[data-clickui="review-comparison"]')).toBeNull();
  });

  it("renders draw review labels in non-runtime mode", () => {
    const task = createDrawTaskFixture([
      {
        label: "Контур мишени",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
      {
        label: "Линия ориентира",
        shape: "freehand",
        points: [[40, 40], [55, 40], [70, 42]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: false });
    dom.window.ClickUI.restoreInput({
      polygons: [{ points: [[10, 10], [20, 10], [20, 20], [10, 20]] }],
      lines: [{ points: [[40, 40], [55, 40], [70, 42]] }],
      labels_polygons: ["Контур пользователя"],
      labels_lines: ["Линия пользователя"],
      action_history: [{ kind: "polygon" }, { kind: "line" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        polygon_results: [
          {
            target_index: 0,
            polygon_success: true,
            coverage: 95,
            threshold: 75,
            matched_polygon_idx: 0,
          },
        ],
        line_results: [
          {
            target_index: 1,
            line_success: false,
            coverage: 60,
            threshold: 75,
            matched_line_idx: 0,
          },
        ],
        found_targets: [0],
      },
    });

    const review = container.querySelector('[data-clickui="review-comparison"]');
    const userLabels = container.querySelector('[data-clickui="review-user-labels"]');
    const refLabels = container.querySelector('[data-clickui="review-reference-labels"]');

    expect(review).toBeTruthy();
    expect(userLabels?.textContent || "").toContain("Контур пользователя");
    expect(userLabels?.textContent || "").toContain("Линия пользователя");
    expect(refLabels?.textContent || "").toContain("Контур мишени");
    expect(refLabels?.textContent || "").toContain("Линия ориентира");
  });
});

