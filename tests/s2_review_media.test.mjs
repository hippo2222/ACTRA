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
    sharedLightbox = null,
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
  if (!dom.window.HTMLElement.prototype.scrollIntoView) {
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }

  dom.window.fetch = async () => ({
    ok: true,
    json: async () => payload,
  });

  dom.window.NotificationUI = {
    confirm: async () => true,
    toast: (message, variant) => {
      dom.window.__toasts = dom.window.__toasts || [];
      dom.window.__toasts.push({ message, variant });
      return { dismiss() {} };
    },
  };

  dom.window.navigateWithTransition = (targetUrl) => {
    dom.window.__lastNavigation = targetUrl;
  };

  if (sharedLightbox) {
    dom.window.OpenAnswerUIImageLightbox = sharedLightbox;
  }

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
    celebrate() {},
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

describe("S2 review media", () => {
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

  it("keeps the review block collapsed by default when there are errors", async () => {
    const dom = await bootDom();
    const reviewInline = dom.window.document.getElementById("review-inline");

    expect(dom.window.document.getElementById("review-btn").textContent).toContain("Посмотреть");
    expect(reviewInline.classList.contains("hidden")).toBe(false);
    expect(reviewInline.classList.contains("is-open")).toBe(false);
    expect(reviewInline.getAttribute("aria-hidden")).toBe("true");
    expect(dom.window.__toasts || []).toHaveLength(0);
  });

  it("renders compact image thumbnails in review and opens preview on click", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Комплекс Все Типы Заданий",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 12,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              review: {
                title: "Тест задание Тест",
                prompt: "Выберите Вомбата",
                user_label: "Ваш ответ",
                user_lines: ["Вариант 2"],
                user_items: [
                  {
                    type: "choice_option",
                    option_index: 1,
                    fallback_label: "Вариант 2",
                    image_path: "modules/test/topic/task/images/seal.jpg",
                  },
                ],
                reference_label: "Правильный ответ",
                reference_lines: ["Вариант 4"],
                reference_items: [
                  {
                    type: "choice_option",
                    option_index: 3,
                    fallback_label: "Вариант 4",
                    image_path: "modules/test/topic/task/images/wombat.jpg",
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const reviewInline = dom.window.document.getElementById("review-inline");
    const thumbs = reviewInline.querySelectorAll(".s2-review-media-thumb");
    const images = reviewInline.querySelectorAll(".s2-review-media-image");

    expect(thumbs).toHaveLength(2);
    expect(images).toHaveLength(2);
    expect(images[1].getAttribute("src")).toContain("/api/local-image?path=");
    expect(images[1].getAttribute("src")).toContain("wombat.jpg");

    thumbs[1].click();
    await flushDom();

    const previewBackdrop = dom.window.document.getElementById("image-preview-backdrop");
    const previewImage = dom.window.document.getElementById("image-preview-image");

    expect(previewBackdrop).not.toBeNull();
    expect(previewBackdrop.classList.contains("hidden")).toBe(false);
    expect(previewImage.getAttribute("src")).toContain("wombat.jpg");
  });

  it("uses the shared image lightbox in review when it is available", async () => {
    const opened = [];
    const dom = await bootDom({
      sharedLightbox: {
        open(src, caption) {
          opened.push({ src, caption });
        },
      },
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Shared Review Lightbox",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 12,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              review: {
                title: "Shared Review Lightbox",
                prompt: "Pick the wombat",
                user_items: [
                  {
                    type: "choice_option",
                    option_index: 0,
                    fallback_label: "Tiger",
                    image_path: "modules/test/topic/task/images/tiger.jpg",
                  },
                ],
                reference_items: [
                  {
                    type: "choice_option",
                    option_index: 1,
                    fallback_label: "Wombat",
                    image_path: "modules/test/topic/task/images/wombat.jpg",
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const thumbs = dom.window.document.querySelectorAll(".s2-review-media-thumb");
    thumbs[1].click();
    await flushDom();

    expect(opened).toHaveLength(1);
    expect(opened[0].src).toContain("wombat.jpg");
    expect(dom.window.document.getElementById("image-preview-backdrop")).toBeNull();
  });

  it("renders asset-backed review media through canonical hosted asset URLs", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Hosted Review Media",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 12,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              review: {
                title: "Hosted Review Media",
                prompt: "Выберите вариант",
                user_items: [
                  {
                    type: "choice_option",
                    option_index: 0,
                    fallback_label: "Вариант 1",
                    image_asset_id: "asset_s2_user_1",
                  },
                ],
                reference_items: [
                  {
                    type: "choice_option",
                    option_index: 1,
                    fallback_label: "Вариант 2",
                    image: {
                      asset_id: "asset_s2_reference_1",
                    },
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const images = dom.window.document.querySelectorAll(".s2-review-media-image");
    expect(images).toHaveLength(2);
    expect(images[0].getAttribute("src")).toBe("/api/assets/asset_s2_user_1/content");
    expect(images[1].getAttribute("src")).toBe("/api/assets/asset_s2_reference_1/content");
  });

  it("renders all failed test subquestions from review entries", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Mixed Test Review",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 18,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              review: {
                title: "Mixed Test Review",
                prompt: "Pick the correct text answer",
                entries: [
                  {
                    title: "Mixed Test Review",
                    prompt: "Pick the correct text answer",
                    user_label: "Твой ответ",
                    user_lines: ["Wrong text option"],
                    reference_label: "Правильный ответ",
                    reference_lines: ["Correct text option"],
                  },
                  {
                    title: "Mixed Test Review",
                    prompt: "Pick the wombat",
                    user_label: "Твой ответ",
                    user_items: [
                      {
                        type: "choice_option",
                        option_index: 0,
                        fallback_label: "Tiger",
                        image_path: "modules/test/topic/task/images/tiger.jpg",
                      },
                    ],
                    reference_label: "Правильный ответ",
                    reference_items: [
                      {
                        type: "choice_option",
                        option_index: 1,
                        fallback_label: "Wombat",
                        image_path: "modules/test/topic/task/images/wombat.jpg",
                      },
                    ],
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const cards = dom.window.document.querySelectorAll(".s2-inline-review-card");
    const reviewInline = dom.window.document.getElementById("review-inline");

    expect(cards).toHaveLength(2);
    expect(reviewInline.textContent).toContain("Pick the correct text answer");
    expect(reviewInline.textContent).toContain("Pick the wombat");
    expect(reviewInline.querySelectorAll(".s2-review-media-thumb")).toHaveLength(2);
  });

  it("shows a positive placeholder in the review block when there are no errors", async () => {
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
      dom.window.document.getElementById("result-review-panel").classList.contains("hidden"),
    ).toBe(false);
    expect(dom.window.document.getElementById("review-btn").classList.contains("hidden")).toBe(true);
    expect(dom.window.document.querySelector(".s2-review-empty")).not.toBeNull();
    expect(dom.window.document.getElementById("review-inline").textContent).toContain(
      "Разбор ошибок не нужен",
    );
  });

  it("renders side-by-side click comparison cards with SVG overlays and legend for failed click tasks", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Click Review Test",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 45,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              task_type: "click",
              review: {
                title: "Анатомия сердца",
                prompt: "Укажите верхушку сердца и дугу аорты",
                user_items: [
                  {
                    type: "click_comparison",
                    is_user: true,
                    image_url: "modules/heart/images/xray.jpg",
                    targets: [
                      { label: "Верхушка сердца", points: [[100, 150], [150, 150], [125, 200]], shape: "polygon" },
                      { label: "Дуга аорты", point: [250, 300], shape: "point" },
                    ],
                    clicks: [
                      [125, 175], // hit target 0
                      [400, 450], // miss
                    ],
                    targets_info: [
                      { index: 0, label: "Верхушка сердца", found: true, matched_click_idx: 0 },
                      { index: 1, label: "Дуга аорты", found: false },
                    ],
                    labels_clicks: ["Верхушка сердца", "Мимо"],
                    is_full_width: true,
                  },
                ],
                reference_items: [
                  {
                    type: "click_comparison",
                    is_user: false,
                    image_url: "modules/heart/images/xray.jpg",
                    targets: [
                      { label: "Верхушка сердца", points: [[100, 150], [150, 150], [125, 200]], shape: "polygon" },
                      { label: "Дуга аорты", point: [250, 300], shape: "point" },
                    ],
                    clicks: [
                      [125, 175],
                      [400, 450],
                    ],
                    targets_info: [
                      { index: 0, label: "Верхушка сердца", found: true, matched_click_idx: 0 },
                      { index: 1, label: "Дуга аорты", found: false },
                    ],
                    is_full_width: true,
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const userCard = dom.window.document.querySelector('[data-s2-review="user-clicks"]');
    const refCard = dom.window.document.querySelector('[data-s2-review="ref-targets"]');

    expect(userCard).not.toBeNull();
    expect(refCard).not.toBeNull();

    // User card: check user clicks
    const clickMarkers = userCard.querySelectorAll(".s2-click-marker");
    expect(clickMarkers).toHaveLength(2);
    expect(clickMarkers[0].getAttribute("data-target-index")).toBe("0");
    expect(clickMarkers[1].getAttribute("data-target-index")).toBeNull();

    // User card: check labels
    expect(userCard.textContent).toContain("Верхушка сердца");
    expect(userCard.textContent).toContain("Мимо");

    // Reference card: check shapes
    const polyShape = refCard.querySelector(".s2-target-shape");
    expect(polyShape).not.toBeNull();
    expect(polyShape.tagName.toLowerCase()).toBe("polygon");
    expect(polyShape.getAttribute("data-target-index")).toBe("0");

    const markerTarget = refCard.querySelector(".s2-target-marker");
    expect(markerTarget).not.toBeNull();
    expect(markerTarget.getAttribute("data-target-index")).toBe("1");

    // Reference card: check legend
    const legendRows = refCard.querySelectorAll("[data-target-index]");
    expect(legendRows.length).toBeGreaterThanOrEqual(2);
    expect(refCard.textContent).toContain("Верхушка сердца");
    expect(refCard.textContent).toContain("Дуга аорты");
    expect(refCard.textContent).toContain("Найдено");
    expect(refCard.textContent).toContain("Не найдено");
  });

  it("synchronizes target highlighting between user and reference cards on hover", async () => {
    const dom = await bootDom({
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Click Hover Test",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 30,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              task_type: "click",
              review: {
                title: "Click Hover Test",
                prompt: "Hover test prompt",
                user_items: [
                  {
                    type: "click_comparison",
                    is_user: true,
                    imageUrl: "modules/heart/images/xray.jpg",
                    targets: [
                      { label: "Цель 1", point: [100, 100], shape: "point" },
                      { label: "Цель 2", point: [200, 200], shape: "point" },
                    ],
                    clicks: [[100, 100]],
                    targets_info: [
                      { index: 0, label: "Цель 1", found: true, matched_click_idx: 0 },
                      { index: 1, label: "Цель 2", found: false },
                    ],
                  },
                ],
                reference_items: [
                  {
                    type: "click_comparison",
                    is_user: false,
                    imageUrl: "modules/heart/images/xray.jpg",
                    targets: [
                      { label: "Цель 1", point: [100, 100], shape: "point" },
                      { label: "Цель 2", point: [200, 200], shape: "point" },
                    ],
                    clicks: [[100, 100]],
                    targets_info: [
                      { index: 0, label: "Цель 1", found: true, matched_click_idx: 0 },
                      { index: 1, label: "Цель 2", found: false },
                    ],
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const refCard = dom.window.document.querySelector('[data-s2-review="ref-targets"]');
    const userCard = dom.window.document.querySelector('[data-s2-review="user-clicks"]');

    const target0El = refCard.querySelector('[data-target-index="0"]');
    const target1El = refCard.querySelector('[data-target-index="1"]');
    const userClick0 = userCard.querySelector('[data-target-index="0"]');

    // Simulate mouseenter on target 0
    target0El.dispatchEvent(new dom.window.MouseEvent("mouseenter", { bubbles: true }));

    expect(target0El.style.opacity).toBe("1");
    expect(userClick0.style.opacity).toBe("1");
    expect(target1El.style.opacity).toBe("0.2");

    // Simulate mouseleave
    refCard.dispatchEvent(new dom.window.MouseEvent("mouseleave", { bubbles: true }));

    expect(target0El.style.opacity).toBe("");
    expect(userClick0.style.opacity).toBe("");
    expect(target1El.style.opacity).toBe("");
  });

  it("opens shared review lightbox when zoom button is clicked in click comparison cards", async () => {
    const opened = [];
    const dom = await bootDom({
      sharedLightbox: {
        open(src, caption) {
          opened.push({ src, caption });
        },
      },
      payload: createIterationPayload({
        results: {
          iteration: 1,
          complex_name: "Click Zoom Test",
          total_tasks: 1,
          successful_tasks: 0,
          failed_tasks: 1,
          duration_seconds: 20,
          success_rate: 0,
          has_next_iteration: true,
          iteration_results: [
            createIterationTask(1, {
              task_type: "click",
              review: {
                title: "Click Zoom Test",
                prompt: "Click zoom test prompt",
                user_items: [
                  {
                    type: "click_comparison",
                    is_user: true,
                    imageUrl: "modules/heart/images/xray.jpg",
                    targets: [{ label: "Цель 1", point: [100, 100] }],
                    clicks: [[100, 100]],
                  },
                ],
                reference_items: [
                  {
                    type: "click_comparison",
                    is_user: false,
                    imageUrl: "modules/heart/images/xray.jpg",
                    targets: [{ label: "Цель 1", point: [100, 100] }],
                    clicks: [[100, 100]],
                  },
                ],
              },
            }),
          ],
        },
      }),
    });

    dom.window.document.getElementById("review-btn").click();
    await flushDom();

    const userCard = dom.window.document.querySelector('[data-s2-review="user-clicks"]');
    const refCard = dom.window.document.querySelector('[data-s2-review="ref-targets"]');

    const userZoomBtn = userCard.querySelector(".s2-review-media-zoom");
    expect(userZoomBtn).not.toBeNull();
    userZoomBtn.click();

    expect(opened).toHaveLength(1);
    expect(opened[0].src).toContain("xray.jpg");
    expect(opened[0].caption).toContain("Твоё решение");

    const refZoomBtn = refCard.querySelector(".s2-review-media-zoom");
    expect(refZoomBtn).not.toBeNull();
    refZoomBtn.click();

    expect(opened).toHaveLength(2);
    expect(opened[1].src).toContain("xray.jpg");
    expect(opened[1].caption).toContain("Референс");
  });
});
