import { afterEach, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";

const s3Html = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S3/index.html"),
  "utf8",
);

const s3Markup = s3Html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
const inlineScriptMatch = s3Html.match(/<script>([\s\S]*?)<\/script>/i);
const s3Script = inlineScriptMatch ? inlineScriptMatch[1] : "";

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
  defineGlobal("fetch", dom.window.fetch);
}

function createFinalResultsPayload() {
  return {
    ok: true,
    results: {
      complex_name: "Контрольный комплекс",
      total_iterations: 2,
      total_tasks: 4,
      successful_tasks: 3,
      failed_tasks: 1,
      duration_seconds: 4440,
      success_rate: 0.75,
      iterations: [
        {
          iteration: 1,
          total_tasks: 4,
          successful_tasks: 3,
          failed_tasks: 1,
          duration_seconds: 4418,
          success_rate: 0.75,
        },
        {
          iteration: 2,
          total_tasks: 2,
          successful_tasks: 2,
          failed_tasks: 0,
          duration_seconds: 22,
          success_rate: 1,
        },
      ],
      problem_tasks: [
        {
          id: "hbv",
          task_name: "HBc",
          errors: 1,
        },
      ],
    },
  };
}

async function flushAsync(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function setupDom(payload = createFinalResultsPayload()) {
  const dom = new JSDOM(s3Markup, {
    url: "http://localhost/ui/session/sess-1/results",
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

  dom.window.fetch = async (resource) => {
    const url = String(resource || "");
    if (url.includes("/final-results")) {
      return {
        ok: true,
        json: async () => payload,
      };
    }
    if (url.includes("/api/complexes/")) {
      return {
        ok: true,
        json: async () => ({ item: null }),
      };
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  dom.window.NotificationUI = {
    toast() {},
    confirm: async () => true,
  };
  dom.window.CelebrationEffects = {
    celebrate() {},
  };
  dom.window.navigateWithTransition = () => {};

  bindDomGlobals(dom);
  dom.window.eval(s3Script);
  dom.window.document.dispatchEvent(
    new dom.window.Event("DOMContentLoaded", { bubbles: true, cancelable: true }),
  );
  await flushAsync();

  return dom;
}

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
  delete globalThis.fetch;
});

describe("S3 final results visibility", () => {
  it("hides empty placeholders when iterations and problem tasks are present", async () => {
    const dom = await setupDom();

    const iterationsPlaceholder = dom.window.document.getElementById("iterations-placeholder");
    const iterationsGrid = dom.window.document.getElementById("iterations-grid");
    const problemEmptyHint = dom.window.document.getElementById("problem-empty-hint");
    const problemList = dom.window.document.getElementById("problem-tasks-list");
    const reviewButton = dom.window.document.getElementById("problem-review-open-btn");

    expect(iterationsPlaceholder?.hidden).toBe(true);
    expect(iterationsPlaceholder?.style.display).toBe("none");
    expect(problemEmptyHint?.hidden).toBe(true);
    expect(problemEmptyHint?.style.display).toBe("none");

    expect(iterationsGrid?.hidden).toBe(false);
    expect(problemList?.hidden).toBe(false);
    expect(reviewButton?.hidden).toBe(false);
    expect(problemList?.children.length).toBe(1);
  });

  it("normalizes asset-backed review media to canonical hosted asset URLs", async () => {
    const dom = await setupDom();

    const hooks = dom.window.__S3_TEST_HOOKS;
    const items = hooks.normalizeReviewItems([
      {
        type: "choice_option",
        text: "Вариант с asset",
        image_asset_id: "asset_s3_1",
      },
      {
        type: "choice_option",
        image: {
          asset_id: "asset_s3_nested",
        },
      },
    ]);

    expect(hooks.resolveReviewImageUrl({ asset_id: "asset_s3_direct" })).toBe(
      "/api/assets/asset_s3_direct/content",
    );
    expect(items[0]?.imageUrl).toBe("/api/assets/asset_s3_1/content");
    expect(items[1]?.imageUrl).toBe("/api/assets/asset_s3_nested/content");
  });
});
