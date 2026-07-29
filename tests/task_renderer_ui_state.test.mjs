/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

function loadScript(filePath) {
  const fullPath = path.resolve(process.cwd(), filePath);
  return fs.readFileSync(fullPath, "utf8");
}

function buildShell() {
  document.body.innerHTML = `
    <div id="status-banner"></div>
    <div id="current-task-title"></div>
    <div id="current-task-type"></div>
    <div id="task-progress-meta"></div>
    <button id="current-task-title-toggle" class="hidden" type="button"></button>
    <div id="task-title"></div>
    <div id="task-meta"></div>
    <div id="task-ref-label"></div>
    <div id="task-description"></div>
    <div id="task-image"></div>
    <div id="progress-label"></div>
    <div id="difficulty-label"></div>
    <div id="progress-bar"></div>
    <div id="task-header-meta"></div>
    <div id="task-header-block"></div>
    <div id="task-header-label"></div>
    <button id="check-answer-btn" type="button"></button>
    <button id="next-task-btn" type="button"></button>
    <div id="result-box">
      <div id="result-inner">
        <div id="result-header">
          <div id="result-icon-wrap"><span id="result-icon"></span></div>
          <div id="result-title"></div>
        </div>
        <div id="result-body">
          <div id="result-message"></div>
          <div id="result-details"></div>
          <div id="result-keywords"></div>
          <div id="result-user-answer"></div>
          <div id="result-decision-context"></div>
          <div id="result-reference">
            <div id="result-reference-card">
              <div id="result-reference-title"></div>
              <div id="result-reference-text"></div>
            </div>
          </div>
          <div id="result-decision-actions">
            <button id="result-decision-accept" type="button"></button>
            <button id="result-decision-reject" type="button"></button>
          </div>
        </div>
      </div>
    </div>
    <div id="task-content"></div>
  `;
}

function initTaskRenderer() {
  window.requestAnimationFrame =
    window.requestAnimationFrame || ((cb) => cb());
  global.requestAnimationFrame = window.requestAnimationFrame;

    window.SessionState = {
      currentTask: null,
      paused: false,
      isLoading: false,
      canGoNext: false,
      currentTaskChecked: false,
      sessionId: "sess-1",
    };
  window.UIHelpers = {
    setCanGoNext: vi.fn(),
    showStatus: vi.fn(),
  };
  window.DraftStorage = {
    loadDraft: vi.fn(() => null),
  };

  delete window.TaskRenderer;
  window.eval(loadScript("frontend/S1/task-renderer.js"));
  return window.TaskRenderer;
}

describe("TaskRenderer UI state", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    buildShell();
  });

  afterEach(() => {
    delete global.requestAnimationFrame;
  });

  it("clears stale task UI when no task is available", () => {
    const TaskRenderer = initTaskRenderer();
    document.getElementById("task-content").innerHTML =
      '<button id="stale-content">Old task</button>';
    document.getElementById("result-box").classList.remove("hidden");
    document.getElementById("status-banner").textContent = "Old error";
    document.getElementById("status-banner").classList.remove("hidden");
    window.SessionState.currentTask = { task_type: "open_answer" };

    TaskRenderer.renderTask(null);

    expect(window.UIHelpers.setCanGoNext).toHaveBeenCalledWith(false);
    expect(window.SessionState.currentTask).toBeNull();
    expect(document.getElementById("stale-content")).toBeNull();
    expect(document.getElementById("task-content").textContent).toContain(
      "Для этой сессии больше нет доступных заданий."
    );
    expect(
      document.getElementById("result-box").classList.contains("hidden")
    ).toBe(true);
    expect(
      document.getElementById("status-banner").classList.contains("hidden")
    ).toBe(true);
    expect(document.getElementById("check-answer-btn").disabled).toBe(true);
    expect(
      document.getElementById("check-answer-btn").classList.contains("hidden")
    ).toBe(true);
  });

  it("clears stale open-answer result fragments when new payload omits them", () => {
    const TaskRenderer = initTaskRenderer();
    window.SessionState.currentTask = {
      task_type: "open_answer",
      task_id: "t1",
      task_data: {},
    };

    const keywordsBox = document.getElementById("result-keywords");
    const userAnswerBox = document.getElementById("result-user-answer");
    const referenceWrap = document.getElementById("result-reference");
    const referenceTitle = document.getElementById("result-reference-title");
    const referenceText = document.getElementById("result-reference-text");

    keywordsBox.classList.remove("hidden");
    userAnswerBox.classList.remove("hidden");
    referenceWrap.classList.remove("hidden");
    keywordsBox.textContent = "old keywords";
    userAnswerBox.textContent = "old answer";
    referenceTitle.textContent = "old title";
    referenceText.textContent = "old reference";

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "Nope",
      details: {},
    });

    expect(keywordsBox.textContent).toBe("");
    expect(userAnswerBox.textContent).toBe("");
    expect(referenceTitle.textContent).toBe("");
    expect(referenceText.textContent).toBe("");
    expect(keywordsBox.classList.contains("hidden")).toBe(true);
    expect(userAnswerBox.classList.contains("hidden")).toBe(true);
    expect(referenceWrap.classList.contains("hidden")).toBe(true);
    expect(document.getElementById("result-message").textContent).toBe("Nope");
  });

  it("loads local drafts by task ref and queue slot for retry copies", () => {
    window.SequenceUI = {
      render: vi.fn(),
      restoreInput: vi.fn(),
    };

    try {
      const TaskRenderer = initTaskRenderer();
      const draftPayload = {
        levels: [{ level_id: "level_1", blocks: ["wolf_a"] }],
      };
      window.DraftStorage.loadDraft.mockReturnValue(draftPayload);

      TaskRenderer.renderTask({
        task_type: "sequence_assembly",
        task_id: "task-seq-1",
        task_ref: "m1/t1/task-seq-1",
        module_id: "m1",
        topic_id: "t1",
        iteration: 2,
        queue: { index: 4, total: 8 },
        task_data: {
          content: {
            prompt: "Расположите элементы",
            elements: [{ id: "wolf_a", text: "Волк" }],
            levels: [{ level_id: "level_1", label: "Уровень", blocks: ["slot_1"] }],
          },
        },
      });

      expect(window.DraftStorage.loadDraft).toHaveBeenCalledWith(
        "sess-1",
        "m1/t1/task-seq-1@4#iter2"
      );
    } finally {
      delete window.SequenceUI;
    }
  });

  it("normalizes stale contradictory sequence counters when level order is confirmed", () => {
    const TaskRenderer = initTaskRenderer();
    window.SessionState.currentTask = {
      task_type: "sequence_assembly",
      difficulty: 1,
      task_id: "seq_1",
      task_data: {},
    };

    TaskRenderer.showEvaluationResult({
      success: false,
      message:
        "✅ Последовательность уровней правильная, но проверьте блоки (1/5 уровней правильно, 6/10 блоков правильно)",
      details: {
        levels_order_correct: true,
        total_levels: 5,
        correct_levels_data: [
          { level_id: "level_1" },
          { level_id: "level_2" },
          { level_id: "level_3" },
          { level_id: "level_4" },
          { level_id: "level_5" },
        ],
      },
    });

    expect(document.getElementById("result-message").textContent).toBe(
      "✅ Последовательность уровней правильная, но проверьте блоки (5/5 уровней правильно, 6/10 блоков правильно)"
    );
  });

  it("renders unsupported task fallback without injecting task metadata", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: '"><img src=x onerror=1>',
      task_id: 'task"><img src=x onerror=1>',
      module_id: "m1",
      topic_id: "t1",
      task_data: {},
    });

    const taskContent = document.getElementById("task-content");
    expect(taskContent.querySelector("img")).toBeNull();
    expect(taskContent.textContent).toContain('"><img src=x onerror=1>');
    expect(window.UIHelpers.showStatus).toHaveBeenCalled();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("keeps the open-answer task name in the header and renders the prompt inside the task surface", () => {
    window.eval(loadScript("frontend/OpenAnswerUI/OpenAnswerUI.web.js"));
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: "open_answer",
      task_id: "task_oa_1",
      module_id: "m1",
      topic_id: "t1",
      iteration: 1,
      queue: { index: 0, total: 5 },
      task_data: {
        meta: { name: "Generic open answer title" },
        content: {
          question: "Who ruled after Robert Baratheon?",
          image_path: "/uploads/chart.png",
        },
      },
    });

    const promptEl = document.querySelector('[data-openanswerui="task-prompt"]');

    expect(document.getElementById("task-title").textContent).toBe(
      "Generic open answer title"
    );
    expect(document.getElementById("current-task-title").textContent).toBe(
      "Generic open answer title"
    );
    expect(document.getElementById("current-task-title").getAttribute("title")).toBe(
      "Generic open answer title"
    );
    expect(document.getElementById("current-task-type").textContent).toBe(
      "Открытый ответ"
    );
    expect(document.getElementById("task-progress-meta").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("task-meta").textContent).toBe(
      "Generic open answer title"
    );
    expect(document.getElementById("task-description").textContent).toBe("");
    expect(promptEl?.textContent || "").toContain(
      "Who ruled after Robert Baratheon?"
    );
    expect(promptEl?.textContent || "").toContain("Текст задания");
    expect(promptEl?.className || "").toContain("border-2");
    expect(promptEl?.nextElementSibling?.querySelector("img")).toBeTruthy();
  });

  it("renders hosted open-answer media through the canonical asset content URL", () => {
    window.eval(loadScript("frontend/OpenAnswerUI/OpenAnswerUI.web.js"));
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: "open_answer",
      task_id: "task_oa_asset",
      module_id: "m1",
      topic_id: "t1",
      task_data: {
        meta: { name: "Asset-backed open answer" },
        content: {
          question: "Inspect hosted image",
          image_asset_id: "asset_open_answer_1",
        },
      },
    });

    const image = document.querySelector("#task-content .group.relative img");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("/api/assets/asset_open_answer_1/content");
  });

  it("prefers canonical asset refs over legacy image_path in hosted open-answer render flow", () => {
    window.eval(loadScript("frontend/OpenAnswerUI/OpenAnswerUI.web.js"));
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: "open_answer",
      task_id: "task_oa_asset_path",
      module_id: "m1",
      topic_id: "t1",
      task_data: {
        meta: { name: "Asset-path mixed open answer" },
        content: {
          question: "Inspect hosted image",
          image_asset_id: "asset_open_answer_2",
          image_path: "legacy/open-answer.png",
        },
      },
    });

    const image = document.querySelector("#task-content .group.relative img");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("/api/assets/asset_open_answer_2/content");
  });

  it("renders task name and task type into the S1 header for click tasks", () => {
    const TaskRenderer = initTaskRenderer();

    TaskRenderer.renderTask({
      task_type: "click",
      task_id: "task_click_1",
      module_id: "m1",
      topic_id: "t1",
      iteration: 2,
      queue: { index: 1, total: 4 },
      difficulty: 3,
      task_data: {
        meta: { name: "Найди области на схеме" },
        content: {
          prompt: "Найди две области на изображении",
        },
      },
    });

    expect(document.getElementById("current-task-title").textContent).toBe(
      "Найди области на схеме"
    );
    expect(document.getElementById("current-task-type").textContent).toBe("Клик");
    expect(document.getElementById("task-progress-meta").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("progress-label").textContent).toBe(
      "Задание 2 из 4 • Итерация 2"
    );
    expect(document.getElementById("task-header-block").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("task-header-label").textContent).toBe("Что нужно сделать");
    expect(document.getElementById("task-title").textContent).toBe(
      "Найди две области на изображении"
    );
    expect(document.getElementById("task-meta").textContent).toBe(
      "Найди области на схеме"
    );
  });

  it("keeps the sequence prompt inside the task surface and uses the task name in the header", () => {
    window.SequenceUI = {
      render: vi.fn(),
    };

    try {
      const TaskRenderer = initTaskRenderer();

      TaskRenderer.renderTask({
        task_type: "sequence_assembly",
        task_id: "task_73fd150b",
        task_name: "Тест Задание Последовательность",
        module_id: "m1",
        topic_id: "t1",
        iteration: 1,
        queue: { index: 0, total: 3 },
        task_data: {
          type: "sequence_assembly",
          prompt: "Опишите правильную последовательность наложения электродов при снятии ЭКГ",
          elements: [],
          levels: [],
          settings: {},
        },
      });

      expect(document.getElementById("current-task-title").textContent).toBe(
        "Тест Задание Последовательность"
      );
      expect(document.getElementById("current-task-title").getAttribute("title")).toBe(
        "Тест Задание Последовательность"
      );
    } finally {
      delete window.SequenceUI;
    }
  });

  it("hides the duplicated instruction card for draw tasks routed through ClickUI", () => {
    window.TaskRendererSelector = {
      pickTaskType: (rawType) => (rawType === "draw" ? "click" : rawType),
    };

    try {
      const TaskRenderer = initTaskRenderer();
      TaskRenderer.renderTask({
        task_type: "draw",
        task_id: "task_draw_via_click",
        module_id: "m1",
        topic_id: "t1",
        iteration: 1,
        queue: { index: 0, total: 2 },
        task_data: {
          meta: { name: "Тест Задание Рисование" },
          content: {
            prompt: "Обведи центральную область мишени",
          },
        },
      });

      expect(document.getElementById("current-task-title").textContent).toBe(
        "Тест Задание Рисование"
      );
      expect(document.getElementById("current-task-type").textContent).toBe("Рисование");
      expect(document.getElementById("task-header-block").classList.contains("hidden")).toBe(true);
    } finally {
      delete window.TaskRendererSelector;
    }
  });

  it("delegates draw draft restoration to DrawUI when draw tasks are rendered directly", () => {
    window.DrawUI = {
      restoreInput: vi.fn(),
    };

    try {
      const TaskRenderer = initTaskRenderer();
      const draft = {
        polygons: [{ points: [[10, 10], [20, 10], [10, 20]] }],
      };

      TaskRenderer.restoreDraftToUI("draw", draft);

      expect(window.DrawUI.restoreInput).toHaveBeenCalledWith(draft);
    } finally {
      delete window.DrawUI;
    }
  });

  it("delegates sequence view-state restoration to SequenceUI", () => {
    window.SequenceUI = {
      restoreViewState: vi.fn(),
    };

    try {
      const TaskRenderer = initTaskRenderer();
      const viewState = {
        selected_available_id: "elem_2",
        scroll_positions: {
          availableTop: 10,
          levelsTop: 20,
        },
      };

      TaskRenderer.restoreViewStateToUI("sequence_assembly", viewState);

      expect(window.SequenceUI.restoreViewState).toHaveBeenCalledWith(viewState);
    } finally {
      delete window.SequenceUI;
    }
  });

  it("keeps the header title toggle hidden when the title fits without clamping", () => {
    const titleEl = document.getElementById("current-task-title");
    const toggleEl = document.getElementById("current-task-title-toggle");

    Object.defineProperty(titleEl, "clientHeight", {
      configurable: true,
      get: () => 54,
    });
    Object.defineProperty(titleEl, "scrollHeight", {
      configurable: true,
      get: () => 54,
    });
    Object.defineProperty(titleEl, "clientWidth", {
      configurable: true,
      get: () => 320,
    });
    Object.defineProperty(titleEl, "scrollWidth", {
      configurable: true,
      get: () => 320,
    });

    const TaskRenderer = initTaskRenderer();
    TaskRenderer.renderTask({
      task_type: "click",
      task_id: "task_click_short",
      module_id: "m1",
      topic_id: "t1",
      iteration: 1,
      queue: { index: 0, total: 3 },
      task_data: {
        meta: { name: "Short title" },
        content: { prompt: "Prompt" },
      },
    });

    expect(toggleEl.classList.contains("hidden")).toBe(true);
    expect(toggleEl.getAttribute("aria-expanded")).toBe("false");
    expect(toggleEl.textContent).toBe("");
  });

  it("keeps the toggle hidden for long titles and relies on the native tooltip", () => {
    const titleEl = document.getElementById("current-task-title");
    const toggleEl = document.getElementById("current-task-title-toggle");
    const longTitle =
      "Very long task title that must stay truncated in the S1 header while the full text remains available in the tooltip";

    const TaskRenderer = initTaskRenderer();
    TaskRenderer.renderTask({
      task_type: "draw",
      task_id: "task_draw_long",
      module_id: "m1",
      topic_id: "t1",
      iteration: 1,
      queue: { index: 0, total: 3 },
      task_data: {
        meta: {
          name: longTitle,
        },
        content: {},
      },
    });

    expect(toggleEl.classList.contains("hidden")).toBe(true);
    expect(toggleEl.textContent).toBe("");
    expect(toggleEl.getAttribute("aria-expanded")).toBe("false");
    expect(toggleEl.getAttribute("aria-hidden")).toBe("true");
    expect(titleEl.classList.contains("is-expanded")).toBe(false);
    expect(titleEl.getAttribute("title")).toBe(longTitle);
  });

  it("keeps the result box above the task content and highlights keywords inside the reference answer", () => {
    const TaskRenderer = initTaskRenderer();
    window.SessionState.currentTask = {
      task_type: "open_answer",
      task_id: "t_open_2",
      task_data: {},
    };

    const resultBox = document.getElementById("result-box");
    const taskContent = document.getElementById("task-content");
    expect(
      resultBox.compareDocumentPosition(taskContent) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "Not all keywords found",
      details: {
        keywords: ["Joffrey", "Baratheon"],
        found_keywords: ["Joffrey"],
        missing_keywords: ["Baratheon"],
        user_answer: "Joffrey",
        reference_answer: "After Robert Baratheon, the king was Joffrey Baratheon.",
      },
    });

    expect(document.getElementById("result-keywords").classList.contains("hidden")).toBe(true);
    expect(document.getElementById("result-reference").classList.contains("hidden")).toBe(false);
    const referenceHtml = document.getElementById("result-reference-text").innerHTML;
    expect(referenceHtml).toContain("bg-success-light/35");
    expect(referenceHtml).toContain("bg-error-light/30");
    expect(referenceHtml).not.toContain("<mark");
    expect(referenceHtml.match(/bg-success-light\/35/g)?.length || 0).toBe(1);
    expect(referenceHtml.match(/bg-error-light\/30/g)?.length || 0).toBe(1);
    expect(referenceHtml).toContain("After Robert Baratheon, the king was <span");
    expect(referenceHtml).toContain("Joffrey");
    expect(referenceHtml).toContain("Baratheon");
  });

  it("marks restored checked tasks as locked and disables the check button", () => {
    const TaskRenderer = initTaskRenderer();
    const checkBtn = document.getElementById("check-answer-btn");

    TaskRenderer.restoreCheckedTaskState(
      {
        task_type: "click",
        task_id: "task_click_checked",
        module_id: "m1",
        topic_id: "t1",
        task_data: {},
      },
      {
        success: true,
        message: "Correct",
        details: {
          found_targets: [0],
        },
      }
    );

    expect(window.SessionState.currentTaskChecked).toBe(true);
    expect(checkBtn.disabled).toBe(true);
    expect(checkBtn.getAttribute("title")).toBe("Задание уже проверено");
  });
  it("renders draw manual judgement actions inside the S1 result card", () => {
    const TaskRenderer = initTaskRenderer();
    const judgementSpy = vi.fn();
    window.SessionControls = {
      handleDrawLabelJudgementChoice: judgementSpy,
    };
    window.SessionState.currentTask = {
      task_type: "draw",
      task_id: "draw-1",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {},
      },
    };

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "",
      details: {
        requires_user_judgement: true,
        manual_label_judgement: {
          message: "В одном или нескольких названиях пропущено 1–2 слова. Решите, считать ли ответ верным.",
          soft_mismatches: [
            {
              user_answer: "Передний отдел мозга",
              correct_answer: "Передний отдел головного мозга",
              omitted_phrase: "головного",
            },
          ],
        },
      },
    });

    expect(document.getElementById("result-title").textContent).toBe("Нужно ваше решение");
    expect(document.getElementById("result-message").textContent).toContain("пропущено 1–2 слова");
    expect(document.getElementById("result-decision-context").textContent).toContain("Ваш ответ: Передний отдел мозга");
    expect(document.getElementById("result-decision-context").textContent).toContain("Эталон: Передний отдел головного мозга");
    expect(document.getElementById("result-decision-actions").classList.contains("hidden")).toBe(false);

    document.getElementById("result-decision-accept").click();
    document.getElementById("result-decision-reject").click();

    expect(judgementSpy).toHaveBeenNthCalledWith(1, "accept");
    expect(judgementSpy).toHaveBeenNthCalledWith(2, "reject");
  });

  it("renders draw manual judgement actions even when draw is routed through ClickUI", () => {
    const TaskRenderer = initTaskRenderer();
    const judgementSpy = vi.fn();
    window.TaskRendererSelector = {
      pickTaskType: (rawType) => (rawType === "draw" ? "click" : rawType),
    };
    window.SessionControls = {
      handleDrawLabelJudgementChoice: judgementSpy,
    };
    window.SessionState.currentTask = {
      task_type: "draw",
      task_id: "draw-routed-1",
      difficulty: 2,
      task_data: {
        task_type: "draw",
        _difficulty_level: 2,
        content: {},
      },
    };

    TaskRenderer.showEvaluationResult({
      success: false,
      message: "",
      details: {
        requires_user_judgement: true,
        manual_label_judgement: {
          message: "В одном или нескольких названиях пропущено 1–2 слова. Решите, считать ли ответ верным.",
          soft_mismatches: [
            {
              user_answer: "Передний отдел мозга",
              correct_answer: "Передний отдел головного мозга",
              omitted_phrase: "головного",
            },
          ],
        },
      },
    });

    expect(document.getElementById("result-decision-context").textContent).toContain("Ваш ответ: Передний отдел мозга");
    expect(document.getElementById("result-decision-actions").classList.contains("hidden")).toBe(false);

    document.getElementById("result-decision-accept").click();
    expect(judgementSpy).toHaveBeenCalledWith("accept");

    delete window.TaskRendererSelector;
  });
});
