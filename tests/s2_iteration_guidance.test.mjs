import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const s2Html = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S2/index.html"),
  "utf8",
);

const s2Script = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/assets/s2-results.js"),
  "utf8",
);

const s2Markup = s2Html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

function defineGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

function bindDomGlobals(dom) {
  defineGlobal("window", dom.window);
  defineGlobal("document", dom.window.document);
  defineGlobal("HTMLElement", dom.window.HTMLElement);
  defineGlobal("Node", dom.window.Node);
  defineGlobal("navigator", dom.window.navigator);
  defineGlobal("localStorage", dom.window.localStorage);
  defineGlobal("sessionStorage", dom.window.sessionStorage);
  defineGlobal("URL", dom.window.URL);
  defineGlobal("URLSearchParams", dom.window.URLSearchParams);
  defineGlobal("requestAnimationFrame", dom.window.requestAnimationFrame);
  defineGlobal("cancelAnimationFrame", dom.window.cancelAnimationFrame);
  defineGlobal("matchMedia", dom.window.matchMedia);
  defineGlobal("fetch", dom.window.fetch);
}

function createIterationTask(index, overrides = {}) {
  return {
    task_ref: `module/topic/task-${index}`,
    task_name: `Problem Task ${index}`,
    task_id: `task-${index}`,
    success: false,
    difficulty: 2,
    correct_answer: `Correct ${index}`,
    user_answer: `Wrong ${index}`,
    ...overrides,
  };
}

function createIterationPayload(overrides = {}) {
  const resultOverrides = overrides && overrides.results ? overrides.results : overrides;
  const baseTasks = [
    createIterationTask(1, { success: true, user_answer: "Correct 1" }),
    createIterationTask(2),
  ];

  return {
    ok: true,
    results: {
      iteration: 1,
      complex_name: "Контрольный комплекс",
      total_tasks: 2,
      successful_tasks: 1,
      failed_tasks: 1,
      duration_seconds: 125,
      success_rate: 0.5,
      has_next_iteration: true,
      iteration_results: baseTasks,
      ...resultOverrides,
    },
  };
}

function setupDom(options = {}) {
  const {
    url = "http://localhost/session/sess-1/iteration/1",
    payload = createIterationPayload(),
  } = options;

  const dom = new JSDOM(s2Markup, {
    url,
    runScripts: "dangerously",
  });

  dom.window.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  dom.window.cancelAnimationFrame = (id) => clearTimeout(id);
  dom.window.matchMedia = () => ({
    matches: false,
    media: "",
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() { return false; },
  });

  dom.window.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });

  dom.window.NotificationUI = {
    confirm: async () => true,
    toast: () => ({ dismiss() {} }),
  };

  dom.window.navigateWithTransition = (targetUrl) => {
    dom.window.__lastNavigation = targetUrl;
  };

  dom.window.CelebrationEffects = {
    animateCounter(el, target, opts = {}) {
      const prefix = opts.prefix || "";
      const suffix = opts.suffix || "";
      el.textContent = `${prefix}${target}${suffix}`;
    },
    createProgressRing(percent) {
      const el = dom.window.document.createElement("div");
      el.setAttribute("data-progress-ring", String(percent));
      return el;
    },
    celebrate(successRate, opts) {
      dom.window.__lastCelebrate = { successRate, opts };
    },
  };

  bindDomGlobals(dom);
  dom.window.eval(s2Script);

  return dom;
}

async function flushDom() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function bootDom(options = {}) {
  const dom = setupDom(options);
  dom.window.S2Page.init();
  await flushDom();
  return dom;
}

describe("S2 iteration guidance", () => {
  afterEach(() => {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.navigator;
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
    delete globalThis.URL;
    delete globalThis.URLSearchParams;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
    delete globalThis.matchMedia;
    delete globalThis.fetch;
  });

  it("keeps next-step copy focused on the next iteration even after mistakes", async () => {
    const dom = await bootDom();
    const { state, updateIterationNextStepGuidance } = dom.window.S2Page;

    state.hasNextIteration = true;
    state.failedCount = 3;

    updateIterationNextStepGuidance();

    expect(document.querySelector("#continue-btn .truncate").textContent).toBe(
      "К следующей итерации",
    );
    expect(document.querySelector("#to-complex-list-btn .truncate").textContent).toBe(
      "Сделать паузу",
    );
    expect(document.getElementById("next-step-hint").textContent).toBe(
      "Следующий шаг — новая итерация в этой же сессии.",
    );
  });

  it("renders iteration time from duration_seconds", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          ...createIterationPayload().results,
          duration_seconds: 125,
        },
      }),
    });

    expect(dom.window.document.getElementById("stat-iteration-time").textContent).toBe("2:05");
  });

  it("falls back to timestamps when duration_seconds is missing", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          ...createIterationPayload().results,
          duration_seconds: null,
          start_time: "2026-03-27T10:00:00.000Z",
          end_time: "2026-03-27T10:03:05.000Z",
        },
      }),
    });

    expect(dom.window.document.getElementById("stat-iteration-time").textContent).toBe("3:05");
  });

  it("collapses a long failed-task list into preview and exposes the full dialog trigger", async () => {
    const failedTasks = [
      createIterationTask(1),
      createIterationTask(2),
      createIterationTask(3),
      createIterationTask(4),
      createIterationTask(5, { success: true, user_answer: "Correct 5" }),
    ];

    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          ...createIterationPayload().results,
          total_tasks: 5,
          successful_tasks: 1,
          failed_tasks: 4,
          iteration_results: failedTasks,
        },
      }),
    });

    const reviewCards = dom.window.document.querySelectorAll("#review-inline .s2-inline-review-card");
    expect(reviewCards).toHaveLength(4);
    expect(
      dom.window.document.getElementById("review-btn").classList.contains("hidden"),
    ).toBe(false);
  });

  it("shows a positive empty state and hides the review trigger when there are no failures", async () => {
    const cleanTasks = [
      createIterationTask(1, { success: true, user_answer: "Correct 1" }),
      createIterationTask(2, { success: true, user_answer: "Correct 2" }),
    ];

    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          ...createIterationPayload().results,
          successful_tasks: 2,
          failed_tasks: 0,
          success_rate: 1,
          iteration_results: cleanTasks,
        },
      }),
    });

    expect(
      dom.window.document.querySelector("#review-inline .s2-review-empty"),
    ).not.toBeNull();
    expect(
      dom.window.document.getElementById("review-btn").classList.contains("hidden"),
    ).toBe(true);
  });


  it("expands the review section with all problem tasks when toggled", async () => {
    const tasks = [
      createIterationTask(1),
      createIterationTask(2),
      createIterationTask(3, { success: true, user_answer: "Correct 3" }),
    ];

    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          ...createIterationPayload().results,
          total_tasks: 3,
          successful_tasks: 1,
          failed_tasks: 2,
          iteration_results: tasks,
        },
      }),
    });

    const reviewBtn = dom.window.document.getElementById("review-btn");
    expect(reviewBtn.classList.contains("hidden")).toBe(false);
    reviewBtn.click();
    await flushDom();

    expect(dom.window.document.querySelectorAll("#review-inline .s2-inline-review-card")).toHaveLength(2);
    expect(
      dom.window.document.getElementById("review-inline").classList.contains("is-open"),
    ).toBe(true);
  });
});
