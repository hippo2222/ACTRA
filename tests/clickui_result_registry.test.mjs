import { beforeEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  return fs.readFileSync(path.resolve(process.cwd(), filePath), "utf8");
}

function mountClickUi() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
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

function createL1ClickTaskFixture() {
  return {
    task_type: "click",
    difficulty: 1,
    task_data: {
      task_type: "click",
      _difficulty_level: 1,
      content: {
        prompt: "Найдите правое легкое и трахею",
        image_url: "",
        mode: "click",
      },
    },
    answer_key: {
      targets: [
        {
          label: "Правое легкое",
          shape: "polygon",
          points: [[10, 10], [30, 10], [30, 30], [10, 30]],
        },
        {
          label: "Трахея",
          shape: "polygon",
          points: [[40, 10], [50, 10], [50, 30], [40, 30]],
        },
      ],
    },
  };
}

function createL2ClickTaskFixture() {
  return {
    task_type: "click",
    difficulty: 2,
    task_data: {
      task_type: "click",
      _difficulty_level: 2,
      content: {
        prompt: "Найдите структуры и укажите их названия",
        image_url: "",
        mode: "click_and_label",
        requires_labels: true,
      },
    },
    answer_key: {
      targets: [
        {
          label: "Правое легкое",
          shape: "polygon",
          points: [[10, 10], [30, 10], [30, 30], [10, 30]],
        },
        {
          label: "Трахея",
          shape: "polygon",
          points: [[40, 10], [50, 10], [50, 30], [40, 30]],
        },
      ],
    },
  };
}

function createL3DrawTaskFixture() {
  return {
    task_type: "draw",
    difficulty: 3,
    task_data: {
      task_type: "draw",
      _difficulty_level: 3,
      content: {
        prompt: "Обведите контур сердца",
        image_url: "",
        mode: "draw",
      },
    },
    answer_key: {
      targets: [
        {
          label: "Сердце",
          shape: "polygon",
          points: [[10, 10], [40, 10], [40, 40], [10, 40]],
        },
      ],
    },
  };
}

describe("ClickUI Result Registry (Stage 4)", () => {
  let dom;

  beforeEach(() => {
    dom = mountClickUi();
  });

  it("transforms sidebar header into Result Registry and adds filter tabs", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    // Pre-check: targets panel title says "Цели для поиска"
    const titleBefore = container.querySelector('[data-clickui="targets-title"]');
    expect(titleBefore?.textContent).toContain("Цели для поиска");

    // Apply check feedback
    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    // Header transformed
    const titleAfter = container.querySelector('[data-clickui="targets-title"]');
    expect(titleAfter?.textContent).toBe("Реестр результатов");

    // Filter controls present
    const btnAll = container.querySelector('[data-clickui-filter="all"]');
    const btnErrors = container.querySelector('[data-clickui-filter="errors"]');
    expect(btnAll).toBeTruthy();
    expect(btnErrors).toBeTruthy();
    expect(btnAll?.textContent).toContain("Все (2)");
    expect(btnErrors?.textContent).toContain("Ошибки (0)");
  });

  it("displays hit status and matched click details in target rows", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        found_targets: [0],
        click_results: [
          { target_index: 0, click_success: true, matched_click_idx: 0 },
        ],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(rows).toHaveLength(2);

    // Target 0: found
    expect(rows[0]?.textContent).toContain("Правое легкое");
    expect(rows[0]?.textContent).toContain("Найдена");
    expect(rows[0]?.textContent).toContain("Засчитано кликом №1");
    expect(rows[0]?.getAttribute("data-has-error")).toBe("false");

    // Target 1: missed
    expect(rows[1]?.textContent).toContain("Трахея");
    expect(rows[1]?.textContent).toContain("Пропущено");
    expect(rows[1]?.textContent).toContain("Отметка не была поставлена");
    expect(rows[1]?.getAttribute("data-has-error")).toBe("true");
  });

  it("populates target rows in Result Registry for Level 2 (where targets were hidden during attempt)", () => {
    const task = createL2ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    // Pre-check: in L2 attempt phase, target rows were hidden
    const rowsBefore = container.querySelectorAll('[data-clickui="target-row"]');
    expect(rowsBefore).toHaveLength(0);

    // Provide check feedback with 1 matched label and 1 unmatched label
    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        found_targets: [0, 1],
        labels: {
          matched_labels: [[0, "правое легкое", "Правое легкое"]],
          unmatched_labels: [[1, "пищевод", "Трахея"]],
        },
      },
    });

    // After check: target rows are populated in Registry
    const rowsAfter = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(rowsAfter).toHaveLength(2);

    // Row 0: matched label
    expect(rowsAfter[0]?.textContent).toContain("Правое легкое");
    expect(rowsAfter[0]?.textContent).toContain("Найдена");
    expect(rowsAfter[0]?.getAttribute("data-has-error")).toBe("false");

    // Row 1: label error
    expect(rowsAfter[1]?.textContent).toContain("Трахея");
    expect(rowsAfter[1]?.textContent).toContain("Ошибка названия");
    expect(rowsAfter[1]?.textContent).toContain("Введено:");
    expect(rowsAfter[1]?.textContent).toContain("пищевод");
    expect(rowsAfter[1]?.textContent).toContain("Ожидалось:");
    expect(rowsAfter[1]?.textContent).toContain("Трахея");
    expect(rowsAfter[1]?.getAttribute("data-has-error")).toBe("true");
  });

  it("displays coverage percentage for Level 3 draw tasks in Registry", () => {
    const task = createL3DrawTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0],
        polygon_results: [
          { target_index: 0, polygon_success: true, coverage: 92, threshold: 75 },
        ],
      },
    });

    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain("Сердце");
    expect(rows[0]?.textContent).toContain("Покрытие: 92% (порог: 75%)");
  });

  it("filters items by errors and all when filter buttons are clicked", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        found_targets: [0], // target 0 found, target 1 missed
      },
    });

    const btnAll = container.querySelector('[data-clickui-filter="all"]');
    const btnErrors = container.querySelector('[data-clickui-filter="errors"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));

    // Both rows visible by default
    expect(rows[0]?.classList.contains("hidden")).toBe(false);
    expect(rows[1]?.classList.contains("hidden")).toBe(false);

    // Click "Ошибки"
    btnErrors?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    // Target 0 (success) is hidden, Target 1 (error) remains visible
    expect(rows[0]?.classList.contains("hidden")).toBe(true);
    expect(rows[1]?.classList.contains("hidden")).toBe(false);

    // Click "Все"
    btnAll?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    // Both rows visible again
    expect(rows[0]?.classList.contains("hidden")).toBe(false);
    expect(rows[1]?.classList.contains("hidden")).toBe(false);
  });

  it("displays placeholder when error filter is active but there are 0 errors", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1], // all found, 0 errors
      },
    });

    const btnErrors = container.querySelector('[data-clickui-filter="errors"]');
    const placeholder = container.querySelector('[data-clickui="no-errors-placeholder"]');

    expect(placeholder?.classList.contains("hidden")).toBe(true);

    // Click "Ошибки"
    btnErrors?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    expect(placeholder?.classList.contains("hidden")).toBe(false);
    expect(placeholder?.textContent).toContain("Ошибок не обнаружено");
  });

  it("updates inspector on hover over registry target row", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    const inspector = container.querySelector('[data-clickui="result-inspector"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));

    // Hover over row 0
    rows[0]?.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(inspector?.textContent).toContain("Правое легкое");
    expect(inspector?.textContent).toContain("Найдена");

    // Mouse leave
    rows[0]?.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    expect(inspector?.textContent).toContain("Задание успешно выполнено");
  });

  it("updates all Result Workspace and Registry texts dynamically on i18n:changed", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

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

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      score: 100,
      details: {
        found_targets: [0, 1],
      },
    });

    // Check English initial strings
    expect(container.querySelector('[data-clickui="targets-title"]')?.textContent).toBe("Result Registry");
    expect(container.querySelector('[data-clickui="result-verdict-badge"]')?.textContent).toContain("Passed");
    expect(container.querySelector('[data-clickui-filter="all"]')?.textContent).toContain("All (2)");
    expect(container.querySelector('[data-clickui-filter="errors"]')?.textContent).toContain("Errors (0)");

    // Switch to Ukrainian
    activeLoc = ukLoc;
    dom.window.dispatchEvent(new dom.window.CustomEvent("i18n:changed"));

    // Check Ukrainian translated strings
    expect(container.querySelector('[data-clickui="targets-title"]')?.textContent).toBe("Реєстр результатів");
    expect(container.querySelector('[data-clickui="result-verdict-badge"]')?.textContent).toContain("Зараховано");
    expect(container.querySelector('[data-clickui-filter="all"]')?.textContent).toContain("Всі (2)");
    expect(container.querySelector('[data-clickui-filter="errors"]')?.textContent).toContain("Помилки (0)");
    expect(container.querySelector('[data-clickui="result-inspector"]')?.textContent).toContain("Завдання успішно виконано");
  });

  it("automatically adapts display mode between side-by-side and tabs based on container width", () => {
    let resizeCallback = null;
    dom.window.ResizeObserver = class {
      constructor(cb) {
        resizeCallback = cb;
      }
      observe() {}
      disconnect() {}
    };

    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    const sbsGrid = container.querySelector('[data-clickui="result-side-by-side"]');
    const tabsContainer = container.querySelector('[data-clickui="result-tabs-container"]');

    expect(typeof resizeCallback).toBe("function");

    // Simulate narrow container width (< 680px breakpoint)
    resizeCallback([{ contentRect: { width: 600 } }]);
    expect(sbsGrid?.classList.contains("hidden")).toBe(true);
    expect(tabsContainer?.classList.contains("hidden")).toBe(false);

    // Simulate large desktop container width (>= 680px)
    resizeCallback([{ contentRect: { width: 1200 } }]);
    expect(sbsGrid?.classList.contains("hidden")).toBe(false);
    expect(tabsContainer?.classList.contains("hidden")).toBe(true);
  });

  it("unifies all targets and extra/off-target user actions in a single table, hiding separate user actions card", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.restoreInput({
      clicks: [
        { x: 15, y: 15 },
        { x: 16, y: 16 },
        { x: 99, y: 99 },
      ],
      action_history: [{ kind: "click" }, { kind: "click" }, { kind: "click" }],
    });

    const userActionsBefore = container.querySelector('[data-clickui="user-actions-section"]');
    expect(userActionsBefore).toBeTruthy();
    expect(userActionsBefore?.classList.contains("hidden")).toBe(false);

    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        found_targets: [0],
        target_matches: { "0": 0 },
        duplicate_clicks: [1],
        off_target_clicks: [2],
      },
    });

    const userActionsAfter = container.querySelector('[data-clickui="user-actions-section"]');
    expect(userActionsAfter?.classList.contains("hidden")).toBe(true);

    const targetRows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    const unmatchedRows = Array.from(container.querySelectorAll('[data-clickui="unmatched-action-row"]'));

    expect(targetRows).toHaveLength(2);
    expect(unmatchedRows).toHaveLength(2);

    const btnAll = container.querySelector('[data-clickui-filter="all"]');
    const btnErrors = container.querySelector('[data-clickui-filter="errors"]');
    expect(btnAll?.textContent).toContain("Все (4)");
    expect(btnErrors?.textContent).toContain("Ошибки (3)");

    expect(unmatchedRows[0]?.textContent).toContain("Повторный клик №2");
    expect(unmatchedRows[0]?.textContent).toContain("Повтор");
    expect(unmatchedRows[1]?.textContent).toContain("Лишняя отметка №3");
    expect(unmatchedRows[1]?.textContent).toContain("Вне зоны");

    btnErrors?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    expect(targetRows[0]?.classList.contains("hidden")).toBe(true);
    expect(targetRows[1]?.classList.contains("hidden")).toBe(false);
    expect(unmatchedRows[0]?.classList.contains("hidden")).toBe(false);
    expect(unmatchedRows[1]?.classList.contains("hidden")).toBe(false);
  });

  it("properly displays draw task results with polygon, line, and extra user actions in Registry and sets badRefTargets on failure", () => {
    const task = {
      task_type: "draw",
      difficulty: 1,
      task_data: {
        task_type: "draw",
        _difficulty_level: 1,
        content: {
          prompt: "Обведите очаг и проведите ось",
          image_url: "",
          mode: "draw",
          requires_drawing: true,
        },
      },
      answer_key: {
        targets: [
          {
            label: "Очаг",
            shape: "polygon",
            points: [[10, 10], [40, 10], [40, 40], [10, 40]],
          },
          {
            label: "Ось",
            shape: "line",
            points: [[10, 10], [40, 40]],
          },
        ],
      },
    };
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    // Simulate user drawing 2 polygons and 1 line
    dom.window.ClickUI.restoreInput({
      polygons: [
        { points: [[10, 10], [40, 10], [40, 40], [10, 40]] },
        { points: [[200, 200], [250, 200], [250, 250], [200, 250]] },
      ],
      lines: [
        { points: [[300, 300], [350, 350]] },
      ],
      action_history: [
        { kind: "polygon" },
        { kind: "polygon" },
        { kind: "line" },
      ],
    });

    // Evaluation result: target 0 found (coverage 90%), target 1 missed (coverage 10%)
    dom.window.ClickUI.applyCheckFeedback({
      success: false,
      details: {
        found_targets: [0],
        polygon_results: [
          { target_index: 0, polygon_success: true, coverage: 90, threshold: 75, matched_polygon_idx: 0 },
        ],
        line_results: [
          { target_index: 1, line_success: false, coverage: 10, threshold: 75, matched_line_idx: null },
        ],
      },
    });

    const targetRows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    const unmatchedRows = Array.from(container.querySelectorAll('[data-clickui="unmatched-action-row"]'));

    expect(targetRows).toHaveLength(2);
    expect(unmatchedRows).toHaveLength(2);

    // Target 0: found with 90% coverage
    expect(targetRows[0]?.textContent).toContain("Очаг");
    expect(targetRows[0]?.textContent).toContain("Найдена");
    expect(targetRows[0]?.textContent).toContain("Покрытие: 90% (порог: 75%)");
    expect(targetRows[0]?.getAttribute("data-has-error")).toBe("false");

    // Target 1: line failed (10% coverage, threshold 75%)
    expect(targetRows[1]?.textContent).toContain("Ось");
    expect(targetRows[1]?.textContent).toContain("10%");
    expect(targetRows[1]?.getAttribute("data-has-error")).toBe("true");

    // Unmatched actions: extra polygon and extra line
    expect(unmatchedRows[0]?.getAttribute("data-clickui-action-key")).toBe("polygon:1");
    expect(unmatchedRows[0]?.textContent).toContain("Вне зоны");
    expect(unmatchedRows[1]?.getAttribute("data-clickui-action-key")).toBe("line:0");
    expect(unmatchedRows[1]?.textContent).toContain("Вне зоны");

    // badRefTargets should contain index 1
    const badTargets = dom.window.ClickUI.getState().badRefTargets;
    expect(badTargets).toBeInstanceOf(dom.window.Set);
    expect(badTargets.has(1)).toBe(true);
    expect(badTargets.has(0)).toBe(false);

    // Filter by errors
    const btnErrors = container.querySelector('[data-clickui-filter="errors"]');
    btnErrors?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

    expect(targetRows[0]?.classList.contains("hidden")).toBe(true);
    expect(targetRows[1]?.classList.contains("hidden")).toBe(false);
    expect(unmatchedRows[0]?.classList.contains("hidden")).toBe(false);
    expect(unmatchedRows[1]?.classList.contains("hidden")).toBe(false);
  });

  it("renders flat 4-mode projection toolbar and allows switching between side-by-side, user, ref, and overlay", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    const toolbar = container.querySelector('[data-clickui="result-viewport-toolbar"]');
    expect(toolbar).toBeTruthy();

    const modeSwitch = container.querySelector('[data-clickui="result-mode-switch"]');
    expect(modeSwitch?.getAttribute("role")).toBe("tablist");

    const sideBtn = container.querySelector('[data-clickui="mode-side-by-side"]');
    const userBtn = container.querySelector('[data-clickui="tab-user"]');
    const refBtn = container.querySelector('[data-clickui="tab-reference"]');
    const overlayBtn = container.querySelector('[data-clickui="tab-overlay"]');
    const resetViewBtn = container.querySelector('[data-clickui="result-reset-view"]');
    const zoomBtn = container.querySelector('[data-clickui="result-zoom-btn"]');

    expect(sideBtn).toBeTruthy();
    expect(userBtn).toBeTruthy();
    expect(refBtn).toBeTruthy();
    expect(overlayBtn).toBeTruthy();
    expect(resetViewBtn).toBeTruthy();
    expect(zoomBtn).toBeTruthy();

    expect(sideBtn?.getAttribute("role")).toBe("tab");
    expect(userBtn?.getAttribute("role")).toBe("tab");
    expect(refBtn?.getAttribute("role")).toBe("tab");
    expect(overlayBtn?.getAttribute("role")).toBe("tab");

    const sbsGrid = container.querySelector('[data-clickui="result-side-by-side"]');
    const tabsContainer = container.querySelector('[data-clickui="result-tabs-container"]');

    // Default mode is side-by-side
    expect(sbsGrid?.classList.contains("hidden")).toBe(false);
    expect(tabsContainer?.classList.contains("hidden")).toBe(true);
    expect(sideBtn?.getAttribute("aria-selected")).toBe("true");
    expect(sideBtn?.tabIndex).toBe(0);
    expect(userBtn?.getAttribute("aria-selected")).toBe("false");
    expect(userBtn?.tabIndex).toBe(-1);

    // Switch to User Answer
    userBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(sbsGrid?.classList.contains("hidden")).toBe(true);
    expect(tabsContainer?.classList.contains("hidden")).toBe(false);
    expect(userBtn?.getAttribute("aria-selected")).toBe("true");
    expect(userBtn?.tabIndex).toBe(0);
    expect(sideBtn?.getAttribute("aria-selected")).toBe("false");
    expect(sideBtn?.tabIndex).toBe(-1);

    // Keyboard navigation: ArrowRight from User Answer moves to Reference
    userBtn?.focus();
    modeSwitch?.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(refBtn?.getAttribute("aria-selected")).toBe("true");
    expect(refBtn?.tabIndex).toBe(0);
    expect(userBtn?.getAttribute("aria-selected")).toBe("false");

    // Switch to Overlay
    overlayBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(sbsGrid?.classList.contains("hidden")).toBe(true);
    expect(tabsContainer?.classList.contains("hidden")).toBe(false);
    expect(overlayBtn?.getAttribute("aria-selected")).toBe("true");

    // Switch back to side-by-side
    sideBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(sbsGrid?.classList.contains("hidden")).toBe(false);
    expect(tabsContainer?.classList.contains("hidden")).toBe(true);
    expect(sideBtn?.getAttribute("aria-selected")).toBe("true");
  });

  it("maintains compact 46px inspector bar height and resets icon on hover-out (no sticky error icon bug)", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.restoreInput({
      clicks: [{ x: 99, y: 99 }],
      action_history: [{ kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
        off_target_clicks: [0],
      },
    });

    const inspector = container.querySelector('[data-clickui="result-inspector"]');
    expect(inspector).toBeTruthy();
    expect(inspector?.style.height).toBe("46px");
    expect(inspector?.style.minHeight).toBe("46px");

    const icon = inspector?.querySelector(".material-symbols-outlined");
    expect(icon?.textContent).toBe("check_circle");
    expect(icon?.classList.contains("text-emerald-500")).toBe(true);

    // Hover over off-target click row (error)
    const unmatchedRow = container.querySelector('[data-clickui="unmatched-action-row"]');
    unmatchedRow?.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(icon?.textContent).toBe("cancel");
    expect(icon?.classList.contains("text-rose-500")).toBe(true);
    expect(inspector?.className).toContain("h-[46px]");

    // Hover out
    unmatchedRow?.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    // Icon MUST be restored to check_circle and NOT stuck as cancel
    expect(icon?.textContent).toBe("check_circle");
    expect(icon?.classList.contains("text-emerald-500")).toBe(true);
    expect(inspector?.className).toContain("h-[46px]");
  });

  it("provides unified zoom cluster and context-aware fullscreen buttons without clutter", () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      details: {
        found_targets: [0, 1],
      },
    });

    // 1. Zoom cluster in toolbar
    const zoomCluster = container.querySelector('[data-clickui="result-zoom-cluster"]');
    const zoomOutBtn = container.querySelector('[data-clickui="result-zoom-out"]');
    const zoomInBtn = container.querySelector('[data-clickui="result-zoom-in"]');
    const resetViewBtn = container.querySelector('[data-clickui="result-reset-view"]');
    const tabZoomBtn = container.querySelector('[data-clickui="result-zoom-btn"]');

    expect(zoomCluster).toBeTruthy();
    expect(zoomOutBtn).toBeTruthy();
    expect(zoomInBtn).toBeTruthy();
    expect(resetViewBtn).toBeTruthy();

    // 2. In SBS mode (default), toolbar fullscreen button is hidden to prevent clutter and surprise overlay
    expect(tabZoomBtn?.classList.contains("hidden")).toBe(true);

    // 3. Card headers have distinct open_in_full buttons
    const userPreviewZoom = container.querySelector('[data-clickui="review-user-preview-zoom"]');
    const refPreviewZoom = container.querySelector('[data-clickui="review-reference-preview-zoom"]');
    expect(userPreviewZoom).toBeTruthy();
    expect(refPreviewZoom).toBeTruthy();
    expect(userPreviewZoom?.querySelector(".material-symbols-outlined")?.textContent).toBe("open_in_full");
    expect(refPreviewZoom?.querySelector(".material-symbols-outlined")?.textContent).toBe("open_in_full");
    expect(userPreviewZoom?.getAttribute("aria-label")).toBe("Развернуть ответ на весь экран");
    expect(refPreviewZoom?.getAttribute("aria-label")).toBe("Развернуть эталон на весь экран");

    // 4. In tabs mode, toolbar fullscreen button becomes visible
    const userTabBtn = container.querySelector('[data-clickui="tab-user"]');
    userTabBtn?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    expect(tabZoomBtn?.classList.contains("hidden")).toBe(false);
    expect(tabZoomBtn?.getAttribute("aria-label")).toBe("Развернуть ответ на весь экран");

    // 5. Open modal and check modal zoom controls
    userPreviewZoom?.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    const modalControls = dom.window.document.querySelector('[data-clickui="modal-zoom-controls"]');
    expect(modalControls).toBeTruthy();
    const modalButtons = Array.from(modalControls?.querySelectorAll("button") || []);
    expect(modalButtons.length).toBe(3); // Zoom out, Scale badge/reset, Zoom in
  });

  it("renders typo status pill, pedagogical diff, gentle hover opacity, and inset focus ring", () => {
    const task = createL2ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.restoreInput({
      labels_clicks: ["Правое легкае", "Трахея"],
      clicks: [
        { x: 20, y: 20, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 },
        { x: 45, y: 20, scale_factor: 1.0, offset_x: 0.0, offset_y: 0.0 },
      ],
      action_history: [{ kind: "click" }, { kind: "click" }],
    });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      score: 100,
      details: {
        level: 2,
        found_targets: [0, 1],
        total_targets: 2,
        click_results: [
          { target_index: 0, click_success: true, matched_click_idx: 0 },
          { target_index: 1, click_success: true, matched_click_idx: 1 },
        ],
        labels: {
          success: true,
          score: 100,
          matched_labels: [
            [0, "Правое легкае", "Правое легкое"],
            [1, "Трахея", "Трахея"],
          ],
          unmatched_labels: [],
          tolerance_matches: [
            {
              index: 0,
              type: "typo",
              user_answer: "Правое легкае",
              correct_answer: "Правое легкое",
              target_index: 0,
              matched_click_idx: 0,
            },
          ],
        },
      },
    });

    // 1. Result Registry row for target 0 should have typo pill
    const targetRows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(targetRows.length).toBe(2);

    const typoRow = targetRows.find((r) => r.getAttribute("data-target-index") === "0");
    expect(typoRow).toBeTruthy();

    const pill = typoRow.querySelector('[data-clickui="status-pill"]');
    expect(pill?.textContent).toContain("Опечатка");
    expect(pill?.querySelector(".material-symbols-outlined")?.textContent).toBe("spellcheck");

    // 2. Typo diff box with fine-grained character highlighting
    expect(typoRow.textContent).toContain("Введено:");
    expect(typoRow.textContent).toContain("«Правое легкае»");
    expect(typoRow.textContent).toContain("Ожидалось:");
    expect(typoRow.textContent).toContain("«Правое легкое»");
    const charDiffDel = typoRow.querySelector(".text-rose-600, .dark\\:text-rose-400");
    expect(charDiffDel).toBeTruthy();
    expect(charDiffDel?.textContent).toBe("а");
    const charDiffIns = typoRow.querySelector(".text-emerald-600, .dark\\:text-emerald-400");
    expect(charDiffIns).toBeTruthy();
    expect(charDiffIns?.textContent).toBe("о");

    // 2b. Exact match row (target 1) must NEVER be marked as typo
    const exactRow = targetRows.find((r) => r.getAttribute("data-target-index") === "1");
    expect(exactRow).toBeTruthy();
    const exactPill = exactRow.querySelector('[data-clickui="status-pill"]');
    expect(exactPill?.textContent).toContain("Найдена");
    expect(exactPill?.textContent).not.toContain("Опечатка");
    expect(exactRow.textContent).not.toContain("Введено:");

    // 3. Bottom panel USER LABELS should show typo badge with canonical hint
    const userLabelsBlock = container.querySelector('[data-clickui="review-user-labels"]');
    expect(userLabelsBlock).toBeTruthy();
    const userRows = Array.from(userLabelsBlock.querySelectorAll("[data-target-index]"));
    const userTypoRow = userRows.find((r) => r.getAttribute("data-target-index") === "0");
    expect(userTypoRow).toBeTruthy();
    expect(userTypoRow.textContent).toContain("Опечатка");
    expect(userTypoRow.querySelector("span[title*='Правое легкое']")).toBeTruthy();

    // 4. Hovering on target row activates inspector with typo state
    typoRow.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));
    const inspector = container.querySelector(".clickui-result-inspector");
    expect(inspector?.textContent).toContain("Опечатка");
    expect(inspector?.textContent).toContain("Правое легкае");
    expect(inspector?.textContent).toContain("Правое легкое");

    // 5. Unhovered rows maintain gentle opacity (0.55), not collapsed to 0.08
    const otherRow = userRows.find((r) => r.getAttribute("data-target-index") === "1");
    if (otherRow) {
      expect(otherRow.style.opacity).toBe("0.55");
    }

    // 6. Active row has inset box-shadow to avoid clipping
    expect(userTypoRow.style.boxShadow).toContain("inset");
  });

  it("eliminates inspector jitter via grace-period debounce and sticky hover retention", async () => {
    const task = createL1ClickTaskFixture();
    const container = document.getElementById("app");

    dom.window.ClickUI.render(container, task, { runtimeMode: true });

    dom.window.ClickUI.applyCheckFeedback({
      success: true,
      score: 100,
      details: {
        found_targets: [0, 1],
      },
    });

    const inspector = container.querySelector('[data-clickui="result-inspector"]');
    const rows = Array.from(container.querySelectorAll('[data-clickui="target-row"]'));
    expect(rows.length).toBeGreaterThanOrEqual(2);

    // Initial state: idle prompt
    expect(inspector?.textContent).toContain("Задание успешно выполнено");

    // Enable custom delay for testing debounce behavior
    dom.window._CLICKUI_FORCE_INSPECTOR_DELAY = 100;

    try {
      // 1. Instant update on mouseenter (0ms)
      rows[0].dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));
      expect(inspector?.textContent).toContain("Правое легкое");
      expect(inspector?.textContent).toContain("Найдена");

      // 2. Mouse leave row 0 into gap: inspector MUST retain row 0 details during grace period (no flash)
      rows[0].dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));
      expect(inspector?.textContent).toContain("Правое легкое");
      expect(inspector?.textContent).not.toContain("Задание успешно выполнено");

      // 3. Move into row 1 before grace period expires (at 30ms): transitions directly to row 1
      await new Promise((resolve) => setTimeout(resolve, 30));
      rows[1].dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));
      expect(inspector?.textContent).toContain("Трахея");
      expect(inspector?.textContent).not.toContain("Правое легкое");
      expect(inspector?.textContent).not.toContain("Задание успешно выполнено");

      // 4. Mouse leave row 1: remains sticky during grace period
      rows[1].dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));
      expect(inspector?.textContent).toContain("Трахея");

      // 5. User moves cursor into inspector bar: preserves content and prevents reset
      inspector?.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(inspector?.textContent).toContain("Трахея");

      // 6. User exits inspector bar and leaves: after delay expires, smoothly returns to idle prompt
      inspector?.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(inspector?.textContent).toContain("Задание успешно выполнено");
    } finally {
      delete dom.window._CLICKUI_FORCE_INSPECTOR_DELAY;
    }
  });
});



