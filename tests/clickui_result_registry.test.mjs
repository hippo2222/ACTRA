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

    // Simulate small laptop / tablet container width (< 1020px)
    resizeCallback([{ contentRect: { width: 920 } }]);
    expect(sbsGrid?.classList.contains("hidden")).toBe(true);
    expect(tabsContainer?.classList.contains("hidden")).toBe(false);

    // Simulate large desktop container width (>= 1020px)
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
});



