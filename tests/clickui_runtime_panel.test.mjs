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

    // Pre-action state: empty state is shown inside the unified panel before clicks
    const emptyState = container.querySelector('[data-clickui="labels-empty-state"]');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent || "").toContain("Поставьте первую отметку");

    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      action_history: [{ kind: "click" }],
      labels_clicks: [""],
    });

    const input = container.querySelector('.clickui-card-entry input[type="text"]');
    const sideColumn = container.querySelector('[data-clickui="side-column"]');
    const targetsPanel = container.querySelector('[data-clickui="targets-panel"]');
    const labelsSection = container.querySelector('[data-clickui="labels-section"]');
    const statusCard = container.querySelector('[data-clickui="status-card"]');
    const additionalInfo = container.querySelector('[data-clickui="additional-info"]');
    const labelsCard = container.querySelector('[data-clickui="labels-card"]');
    const targetsTitle = container.querySelector('[data-clickui="targets-title"]');
    const inputLabel = container.querySelector('label[for="clickui-click-1"]');
    const row = container.querySelector('[data-clickui="labels-card"] > div');
    const labelsIndicator = Array.from(container.querySelectorAll("button")).find((el) =>
      (el.textContent || "").includes("Ваши действия")
    );

    expect(input).toBeTruthy();
    expect(input?.id || "").toContain("clickui-click-1");
    expect(input?.getAttribute("aria-label") || "").toContain("Клик 1");
    expect(sideColumn?.contains(input)).toBe(true);
    // Unified single-card architecture: targetsPanel contains labelsSection internally
    expect(Array.from(sideColumn?.children || [])).toContain(targetsPanel);
    expect(targetsPanel?.contains(labelsSection)).toBe(true);
    expect(statusCard).toBeNull();
    if (additionalInfo) {
      expect(targetsPanel?.compareDocumentPosition(additionalInfo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(targetsTitle?.textContent || "").toContain("Подписи");
    expect(inputLabel).toBeNull();
    expect(row?.className || "").toContain("items-center");
    expect(labelsCard?.className || "").toContain("flex-col");
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
    // L2 скрывает список целей и показывает инструкцию «кликай и называй».
    expect(instruction?.textContent || "").toContain("Кликай по областям и давай каждой название.");
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

  it("allows duplicate clicks on the same target and marks repeat click as duplicate error after check", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const img = container.querySelector("img");
    if (img) {
      img.getBoundingClientRect = () => ({
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
        width: 100,
        height: 100,
      });
      Object.defineProperty(img, "naturalWidth", { configurable: true, value: 100 });
      Object.defineProperty(img, "naturalHeight", { configurable: true, value: 100 });
    }

    const viewport = container.querySelector('[data-clickui="viewport"]');
    // First click on target 0 (polygon: [[10, 10], [20, 10], [20, 20], [10, 20]])
    viewport?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, clientX: 15, clientY: 15 }));
    // Second click on target 0 (previously blocked by early return)
    viewport?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, clientX: 16, clientY: 16 }));

    const payload = dom.window.ClickUI.getUserAnswerPayload();
    expect(payload.clicks).toHaveLength(2);
    expect(payload.clicks[0].x).toBe(15);
    expect(payload.clicks[1].x).toBe(16);

    const markers = Array.from(container.querySelectorAll(".clickui-marker-entry"));
    expect(markers).toHaveLength(2);

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0],
        targets_info: [
          { index: 0, found: true, matched_click_idx: 0 },
        ],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));
    expect(rows).toHaveLength(2);

    // First click was matched and counted
    expect(rows[0]?.textContent || "").toMatch(/Клик 1/);
    expect(rows[0]?.textContent || "").toMatch(/Засчитано/);

    // Second click was recognized as a duplicate click and not counted (error)
    expect(rows[1]?.textContent || "").toMatch(/Клик 2/);
    expect(rows[1]?.textContent || "").toMatch(/Повторный клик/);
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

  it("keeps review pointers when its reference image is opened full-screen", () => {
    const task = createClickTaskFixture();
    task.task_data.content.image_url = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15 }],
      action_history: [{ kind: "click" }],
    });
    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        click_results: [{ target_index: 0, click_success: true, matched_click_idx: 0 }],
        found_targets: [0],
      },
    });

    const zoomButton = container.querySelector('[data-clickui="review-reference-preview-zoom"]');
    expect(zoomButton).toBeTruthy();
    zoomButton.click();

    const modalOverlay = document.querySelector('[role="dialog"]');
    const modalPointers = modalOverlay?.querySelector("svg");
    expect(modalOverlay?.getAttribute("aria-hidden")).toBe("false");
    expect(modalPointers?.getAttribute("viewBox")).toBe("0 0 640 360");
    expect(modalPointers?.querySelectorAll("path, circle").length || 0).toBeGreaterThan(0);
  });

  it("fades a duplicate user click while inspecting the first click", () => {
    const task = createClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15 }, { x: 16, y: 16 }],
      action_history: [{ kind: "click" }, { kind: "click" }],
    });
    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        click_results: [{ target_index: 0, click_success: true, matched_click_idx: 0 }],
        found_targets: [0],
      },
    });

    const markers = Array.from(container.querySelectorAll(".clickui-marker-entry"));
    const actions = Array.from(container.querySelectorAll('[data-clickui="user-action-row"]'));
    expect(markers).toHaveLength(2);
    expect(actions).toHaveLength(2);

    actions[0].dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(markers[0].style.opacity).toBe("1");
    expect(markers[1].style.opacity).toBe("0.08");
  });

  it("renders review comparison for level 2 click tasks in runtime mode", () => {
    // Разбор ответа показывается для всех уровней и в runtime-сессии (намеренно,
    // см. commit 4324339): после проверки пользователь видит свой ответ и эталон.
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

    expect(container.querySelector('[data-clickui="review-comparison"]')).toBeTruthy();
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

  it("renders review comparison for draw tasks in runtime mode", () => {
    // См. предыдущий тест: разбор показывается и в runtime для draw/L3 задач.
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

    expect(container.querySelector('[data-clickui="review-comparison"]')).toBeTruthy();
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

  it("isolates hovered review target/label and fades other SVG elements to 0.08 opacity", () => {
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

    const userPreview = container.querySelector('[data-clickui="review-user-preview"]');
    expect(userPreview).toBeTruthy();

    const hoverables = Array.from(userPreview.querySelectorAll('[data-target-index]'));
    expect(hoverables.length).toBeGreaterThan(0);

    const target0Elements = hoverables.filter(el => el.getAttribute('data-target-index') === '0');
    const target1Elements = hoverables.filter(el => el.getAttribute('data-target-index') === '1');

    expect(target0Elements.length).toBeGreaterThan(0);
    expect(target1Elements.length).toBeGreaterThan(0);

    target1Elements.forEach(el => {
      expect(el.style.opacity).not.toBe("0.08");
    });

    const eventEnter = new dom.window.MouseEvent("mouseenter", { bubbles: true });
    target0Elements[0].dispatchEvent(eventEnter);

    target1Elements.forEach(el => {
      const isSvg = el instanceof dom.window.SVGElement || !!(el.closest && el.closest("svg"));
      expect(el.style.opacity).toBe(isSvg ? "0.08" : "0.55");
    });
    target0Elements.forEach(el => {
      expect(el.style.opacity).toBe("1");
    });

    const eventLeave = new dom.window.MouseEvent("mouseleave", { bubbles: true });
    target0Elements[0].dispatchEvent(eventLeave);

    hoverables.forEach(el => {
      expect(el.style.opacity).toBe("");
    });
  });

  it("links hover across BOTH images and BOTH label tables in review", () => {
    const task = createDrawTaskFixture([
      { label: "Контур мишени", shape: "polygon", points: [[10, 10], [20, 10], [20, 20], [10, 20]] },
      { label: "Линия ориентира", shape: "freehand", points: [[40, 40], [55, 40], [70, 42]] },
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
        polygon_results: [{ target_index: 0, polygon_success: true, coverage: 95, threshold: 75, matched_polygon_idx: 0 }],
        line_results: [{ target_index: 1, line_success: false, coverage: 60, threshold: 75, matched_line_idx: 0 }],
        found_targets: [0],
      },
    });

    const userPreview = container.querySelector('[data-clickui="review-user-preview"]');
    const refPreview = container.querySelector('[data-clickui="review-reference-preview"]');
    const userLabels = container.querySelector('[data-clickui="review-user-labels"]');
    const refLabels = container.querySelector('[data-clickui="review-reference-labels"]');
    expect(userPreview && refPreview && userLabels && refLabels).toBeTruthy();

    const t0InRef = refPreview.querySelector('[data-target-index="0"]');
    const t0InUser = userPreview.querySelector('[data-target-index="0"]');
    const t0UserRow = userLabels.querySelector('[data-target-index="0"]');
    const t0RefRow = refLabels.querySelector('[data-target-index="0"]');
    const t1InUser = userPreview.querySelector('[data-target-index="1"]');
    const t1RefRow = refLabels.querySelector('[data-target-index="1"]');
    expect(t0InRef && t0InUser && t0UserRow && t0RefRow).toBeTruthy();

    // Hover the reference IMAGE area for target 0 → target 0 lights up everywhere:
    // user image marker + both label-table rows; target 1 fades on every surface.
    t0InRef.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(t0InUser.style.opacity).toBe("1");
    expect(t0UserRow.style.opacity).toBe("1");
    expect(t0RefRow.style.opacity).toBe("1");
    if (t1InUser) expect(t1InUser.style.opacity).toBe("0.08");
    if (t1RefRow) expect(t1RefRow.style.opacity).toBe("0.55");
  });

  it("renders default prompt translated to English when i18n locale is en", () => {
    const task = createClickTaskFixture();
    task.task_data.content.prompt = "Отметьте указанные области на изображении";
    dom.window.i18n = {
      t: (key) => (key === "ce.k001_click" ? "Mark the indicated areas on the image" : key)
    };
    const container = document.getElementById("app");
    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    const promptEl = container.querySelector('[data-clickui="targets-prompt"]');
    expect(promptEl).toBeTruthy();
    expect(promptEl.textContent).toBe("Mark the indicated areas on the image");
  });

  it("translates 'Targets to find' panel title according to active locale in runtimeMode (S1)", () => {
    const task = createClickTaskFixture();
    dom.window.i18n = {
      t: (key) => {
        if (key === "clickui.targets_to_find") return "Targets to find";
        return key;
      }
    };
    const container = document.getElementById("app");
    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    const titleEl = container.querySelector('[data-clickui="targets-title"]');
    expect(titleEl).toBeTruthy();
    expect(titleEl.textContent).toBe("Targets to find");
    expect(titleEl.getAttribute("data-i18n")).toBe("clickui.targets_to_find");
  });

  it("updates panel title dynamically on i18n:changed event", () => {
    const task = createClickTaskFixture();
    let currentLang = "ru";
    dom.window.i18n = {
      t: (key) => {
        if (key === "clickui.targets_to_find") {
          return currentLang === "uk" ? "Цілі для пошуку" : "Targets to find";
        }
        return key;
      }
    };
    const container = document.getElementById("app");
    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    const titleEl = container.querySelector('[data-clickui="targets-title"]');
    expect(titleEl.textContent).toBe("Targets to find");

    currentLang = "uk";
    dom.window.dispatchEvent(new dom.window.CustomEvent("i18n:changed"));
    expect(titleEl.textContent).toBe("Цілі для пошуку");
  });

  it("translates L2 prompt and status instruction to English", () => {
    const task = {
      task_type: "click",
      difficulty: 2,
      task_data: {
        task_type: "click",
        _difficulty_level: 2,
        content: {
          prompt: "Mark the indicated areas on the image и назовите её",
          image_url: "",
          mode: "click_and_label",
          requires_labels: true,
        },
      },
      answer_key: {
        targets: [
          {
            label: "Center",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
      },
    };
    const enLoc = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "frontend/assets/locales/en.json"), "utf8"));
    dom.window.i18n = {
      t: (key) => {
        if (typeof enLoc[key] === "string") return enLoc[key];
        const parts = key.split(".");
        let cur = enLoc;
        for (const p of parts) {
          if (!cur || typeof cur !== "object") return key;
          cur = cur[p];
        }
        return typeof cur === "string" ? cur : key;
      }
    };
    const container = document.getElementById("app");
    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const promptEl = container.querySelector('[data-clickui="targets-prompt"]');
    expect(promptEl).toBeTruthy();
    expect(promptEl.textContent).toBe("Mark the indicated areas on the image and name them");

    const instructionEl = container.querySelector('[data-clickui="targets-instruction"]');
    expect(instructionEl).toBeTruthy();
    expect(instructionEl.textContent).toContain("Click the areas and name each one.");
  });

  it("updates L2 prompt and instruction dynamically on i18n:changed", () => {
    const task = {
      task_type: "click",
      difficulty: 2,
      task_data: {
        task_type: "click",
        _difficulty_level: 2,
        content: {
          prompt: "Mark the indicated areas on the image и назовите её",
          image_url: "",
          mode: "click_and_label",
          requires_labels: true,
        },
      },
      answer_key: {
        targets: [
          {
            label: "Center",
            shape: "polygon",
            points: [[10, 10], [20, 10], [20, 20], [10, 20]],
          },
        ],
      },
    };
    const enLoc = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "frontend/assets/locales/en.json"), "utf8"));
    const ukLoc = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "frontend/assets/locales/uk.json"), "utf8"));

    let activeLoc = enLoc;
    dom.window.i18n = {
      t: (key) => {
        if (typeof activeLoc[key] === "string") return activeLoc[key];
        const parts = key.split(".");
        let cur = activeLoc;
        for (const p of parts) {
          if (!cur || typeof cur !== "object") return key;
          cur = cur[p];
        }
        return typeof cur === "string" ? cur : key;
      }
    };
    const container = document.getElementById("app");
    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const promptEl = container.querySelector('[data-clickui="targets-prompt"]');
    expect(promptEl.textContent).toBe("Mark the indicated areas on the image and name them");

    activeLoc = ukLoc;
    dom.window.dispatchEvent(new dom.window.CustomEvent("i18n:changed"));

    expect(promptEl.textContent).toBe("Позначте вказані області на зображенні та назвіть їх");
    const instructionEl = container.querySelector('[data-clickui="targets-instruction"]');
    expect(instructionEl.textContent).toContain("Клікай по областях і давай кожній назву.");
  });
it("activates canvas spotlight and highlights matched polygon contour when hovering on user click in review", () => {
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
        targets_info: [{ index: 0, found: true, matched_click_idx: 0 }],
      },
    });

    const userPreview = container.querySelector('[data-clickui="review-user-preview"]');
    const refPreview = container.querySelector('[data-clickui="review-reference-preview"]');
    expect(userPreview).toBeTruthy();
    expect(refPreview).toBeTruthy();

    const spotlightOverlays = Array.from(container.querySelectorAll(".clickui-spotlight-overlay"));
    expect(spotlightOverlays.length).toBeGreaterThan(0);
    spotlightOverlays.forEach(ov => {
      expect(ov.style.opacity || "0").toBe("0");
    });

    const userClickMarker = userPreview.querySelector('[data-clickui-action-key="click:0"]');
    expect(userClickMarker).toBeTruthy();

    userClickMarker.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    spotlightOverlays.forEach(ov => {
      expect(ov.style.opacity).toBe("0.38");
    });

    const cutouts = Array.from(container.querySelectorAll(".clickui-spotlight-cutouts"));
    const totalCutoutShapes = cutouts.reduce((sum, g) => sum + g.children.length, 0);
    expect(totalCutoutShapes).toBeGreaterThan(0);

    const userTarget0Contour = userPreview.querySelector('path[data-target-index="0"]');
    if (userTarget0Contour) {
      expect(userTarget0Contour.style.opacity).toBe("1");
      expect(userTarget0Contour.style.filter).toContain("drop-shadow");
      expect(Number(userTarget0Contour.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(5);
    }

    const refTarget0Contour = refPreview.querySelector('path[data-target-index="0"]');
    expect(refTarget0Contour).toBeTruthy();
    expect(refTarget0Contour.style.opacity).toBe("1");
    expect(refTarget0Contour.style.filter).toContain("drop-shadow");
    expect(Number(refTarget0Contour.getAttribute("stroke-width"))).toBeGreaterThanOrEqual(5);

    userClickMarker.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    spotlightOverlays.forEach(ov => {
      expect(ov.style.opacity).toBe("0");
    });
    cutouts.forEach(g => {
      expect(g.children.length).toBe(0);
    });
    // Contrast halo filter is preserved on unhovered review path
    expect(refTarget0Contour.style.filter).toContain("drop-shadow");
  });

  it("does not spotlight user answer pane when hovering on a missed target in side-by-side review", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels([
      {
        label: "Цель 1",
        shape: "polygon",
        points: [[10, 10], [20, 10], [20, 20], [10, 20]],
      },
      {
        label: "Цель 2",
        shape: "polygon",
        points: [[50, 50], [60, 50], [60, 60], [50, 60]],
      },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 }],
      labels_clicks: ["Подпись пользователя"],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        click_results: [{ target_index: 0, click_success: true, matched_click_idx: 0 }],
        found_targets: [0],
        targets_info: [
          { index: 0, found: true, matched_click_idx: 0 },
          { index: 1, found: false },
        ],
      },
    });

    const userPreview = container.querySelector('[data-clickui="review-user-preview"]');
    const refPreview = container.querySelector('[data-clickui="review-reference-preview"]');
    expect(userPreview).toBeTruthy();
    expect(refPreview).toBeTruthy();

    const userOverlay = userPreview.querySelector('.clickui-spotlight-overlay[data-spotlight-role="user"]');
    const refOverlay = refPreview.querySelector('.clickui-spotlight-overlay[data-spotlight-role="ref"]');
    const userCutouts = userPreview.querySelector(".clickui-spotlight-cutouts");
    const refCutouts = refPreview.querySelector(".clickui-spotlight-cutouts");

    expect(userOverlay).toBeTruthy();
    expect(refOverlay).toBeTruthy();
    expect(userOverlay.style.opacity || "0").toBe("0");
    expect(refOverlay.style.opacity || "0").toBe("0");

    // 1. Hover target 1 in reference pane (MISSED by the user)
    const refTarget1 = refPreview.querySelector('path[data-target-index="1"]');
    expect(refTarget1).toBeTruthy();

    refTarget1.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    // Reference pane should activate its spotlight on target 1
    expect(refOverlay.style.opacity).toBe("0.38");
    expect(refCutouts.children.length).toBeGreaterThan(0);

    // User answer pane MUST NOT spotlight because the student did not click target 1!
    expect(userOverlay.style.opacity || "0").toBe("0");
    expect(userCutouts.children.length).toBe(0);

    refTarget1.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    // 2. Hover user click on target 0 (HIT by the user)
    const userClickMarker = userPreview.querySelector('[data-clickui-action-key="click:0"]');
    expect(userClickMarker).toBeTruthy();

    userClickMarker.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    // Both panes should spotlight because user actually hit target 0
    expect(refOverlay.style.opacity).toBe("0.38");
    expect(userOverlay.style.opacity).toBe("0.38");
    expect(userCutouts.children.length).toBeGreaterThan(0);

    userClickMarker.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));
  });

  it("renders empty state when zero marks are placed in Level 2 runtime mode", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    const emptyState = container.querySelector('[data-clickui="labels-empty-state"]');
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent || "").toContain("Поставьте первую отметку");
    expect(emptyState?.querySelector('.material-symbols-outlined')?.textContent).toBe("touch_app");

    // Title should be Labels (Подписи) with edit_note icon
    const targetsTitle = container.querySelector('[data-clickui="targets-title"]');
    expect(targetsTitle?.textContent || "").toContain("Подписи");
    const titleIcon = container.querySelector('[data-clickui="targets-header"] .material-symbols-outlined');
    expect(titleIcon?.textContent).toBe("edit_note");

    // No duplicate card or "Ваши действия" header
    expect(container.querySelector('[data-clickui="labels-card"]')).toBeNull();
  });

  it("links bidirectional interactive hover and smooth scroll between canvas marker dots and sidebar label rows before check", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    dom.window.ClickUI.restoreInput({
      clicks: [
        { x: 15, y: 15, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 },
        { x: 50, y: 50, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 },
      ],
      action_history: [{ kind: "click" }, { kind: "click" }],
      labels_clicks: ["", ""],
    });

    const dots = Array.from(container.querySelectorAll('.clickui-marker-entry'));
    expect(dots.length).toBe(2);

    const rows = Array.from(container.querySelectorAll('[data-clickui="labels-card"] > div'));
    expect(rows.length).toBe(2);

    // Mock scrollIntoView on rows
    let scrollCalledOnRow1 = false;
    rows[0].scrollIntoView = () => { scrollCalledOnRow1 = true; };

    // Hover dot 1 on canvas
    dots[0].dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    // Dot 1 is scaled with high z-index
    expect(dots[0].style.transform).toContain("scale(1.24)");
    expect(dots[0].style.zIndex).toBe("40");

    // Dot 2 is dimmed
    expect(dots[1].style.opacity).toBe("0.08");

    // Row 1 in sidebar gets active ring and border
    expect(rows[0].style.boxShadow).toContain("0 0 0 2px");
    expect(rows[0].style.transform).toBe("translateX(2px)");
    expect(scrollCalledOnRow1).toBe(true);

    // Row 2 is dimmed
    expect(rows[1].style.opacity).toBe("0.55");

    // Leave dot 1
    dots[0].dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    expect(dots[0].style.transform).toBe("");
    expect(dots[0].style.zIndex).toBe("");
    expect(rows[0].style.boxShadow).toBe("");
    expect(rows[0].style.transform).toBe("");

    // Now hover row 2 in sidebar
    rows[1].dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(dots[1].style.transform).toContain("scale(1.24)");
    expect(dots[1].style.zIndex).toBe("40");
    expect(dots[0].style.opacity).toBe("0.08");
    expect(rows[1].style.boxShadow).toContain("0 0 0 2px");

    // Leave row 2
    rows[1].dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    expect(dots[1].style.transform).toBe("");
    expect(rows[1].style.boxShadow).toBe("");
  });

  it("preserves existing input DOM elements, focus, and values when new clicks are added sequentially", () => {
    const task = createLevel2ClickTaskWithoutExplicitLabels([
      { label: "Target 1", shape: "point", x: 10, y: 10 },
      { label: "Target 2", shape: "point", x: 30, y: 30 },
      { label: "Target 3", shape: "point", x: 50, y: 50 },
    ]);
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });
    primeClickUiImage(container, dom);

    const viewport = container.querySelector('[data-clickui="viewport"]');

    // Click 1
    viewport.dispatchEvent(new dom.window.MouseEvent("click", { clientX: 10, clientY: 10, bubbles: true }));

    const card = container.querySelector('[data-clickui="labels-card"]');
    expect(card).not.toBeNull();
    const rowsAfterClick1 = Array.from(card.querySelectorAll('[data-clickui-action-key]'));
    expect(rowsAfterClick1.length).toBe(1);
    const input1 = rowsAfterClick1[0].querySelector("input");
    expect(input1).not.toBeNull();

    // User types in input 1
    input1.value = "Anatomy Alpha";
    input1.dispatchEvent(new dom.window.Event("input", { bubbles: true }));

    // Click 2
    viewport.dispatchEvent(new dom.window.MouseEvent("click", { clientX: 30, clientY: 30, bubbles: true }));

    const cardAfterClick2 = container.querySelector('[data-clickui="labels-card"]');
    // Card DOM element must be preserved (not recreated via innerHTML = "")
    expect(cardAfterClick2).toBe(card);

    const rowsAfterClick2 = Array.from(card.querySelectorAll('[data-clickui-action-key]'));
    expect(rowsAfterClick2.length).toBe(2);

    // Row 1 DOM element and input must be PRESERVED
    expect(rowsAfterClick2[0]).toBe(rowsAfterClick1[0]);
    expect(rowsAfterClick2[0].querySelector("input")).toBe(input1);
    expect(input1.value).toBe("Anatomy Alpha");

    // Click 2 dot must NOT trigger immediate hover dimming on dot 1
    const dots = Array.from(container.querySelectorAll(".clickui-marker-entry"));
    expect(dots.length).toBe(2);
    // Dot 1 must NOT be dimmed to 0.08 on click 2 addition
    expect(dots[0].style.opacity).not.toBe("0.08");

    // Click 3
    viewport.dispatchEvent(new dom.window.MouseEvent("click", { clientX: 50, clientY: 50, bubbles: true }));
    const rowsAfterClick3 = Array.from(card.querySelectorAll('[data-clickui-action-key]'));
    expect(rowsAfterClick3.length).toBe(3);
    expect(rowsAfterClick3[0]).toBe(rowsAfterClick1[0]);
    expect(input1.value).toBe("Anatomy Alpha");
  });
});

