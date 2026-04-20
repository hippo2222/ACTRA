/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/assets/MainLogic.js"),
  "utf8"
);

function makeJsonResponse(payload) {
  return Promise.resolve({
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  });
}

function makeDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function loadMainLogic() {
  delete window.selectStatsPeriod;
  window.eval(scriptCode);
}

describe("Main statistics widget stability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="quick-access-section"></div>
      <div id="statsCard">
        <div id="statsContent">
          <div class="main-stats-row">
            <span id="statSolvedTasks">0</span>
            <span id="statTotalAvailable">0</span>
          </div>
          <div class="main-stats-row">
            <span id="statSuccessRate">0%</span>
          </div>
          <div class="main-stats-row">
            <span id="statTimeSpent">0ч 0м</span>
          </div>
          <div class="main-stats-row">
            <span id="statComplexesLabel">Комплексов сегодня</span>
            <span id="statTodayCount">0</span>
          </div>
        </div>
        <div id="statsSkeleton" class="hidden"></div>
      </div>
      <button id="btnPeriod1"></button>
      <button id="btnPeriod7"></button>
      <button id="btnPeriod30"></button>
      <button id="btnPeriod0"></button>
    `;

    const statsCard = document.getElementById("statsCard");
    const statsContent = document.getElementById("statsContent");
    const getMockHeight = () =>
      statsContent.classList.contains("stats-content--empty") ? 180 : 240;

    statsCard.getBoundingClientRect = () => ({
      width: 320,
      height: getMockHeight(),
      top: 0,
      left: 0,
      right: 320,
      bottom: getMockHeight(),
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(statsCard, "offsetHeight", {
      configurable: true,
      get: () => {
        const inlineHeight = Number.parseFloat(statsCard.style.height || "");
        return Number.isFinite(inlineHeight) ? inlineHeight : getMockHeight();
      },
    });
    Object.defineProperty(statsCard, "scrollHeight", {
      configurable: true,
      get: () => getMockHeight(),
    });

    window.requestAnimationFrame = (cb) => {
      cb();
      return 1;
    };
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not reopen the skeleton and animates card height when the content shrinks", async () => {
    const activeStats = {
      tasks_mastered: 6,
      total_tasks_available: 12,
      success_rate: 0.75,
      completed_complexes_today: 2,
      completed_complexes_period: 4,
      total_time_spent: 3600,
      learning_sources: {
        combined: { time_spent_seconds: 3600 },
      },
    };
    const zeroStats = {
      tasks_mastered: 0,
      total_tasks_available: 12,
      success_rate: 0,
      completed_complexes_today: 0,
      completed_complexes_period: 0,
      total_time_spent: 0,
      learning_sources: {
        combined: { time_spent_seconds: 0 },
      },
    };
    const secondStatsRequest = makeDeferred();
    let statsRequestCount = 0;

    global.fetch = vi.fn((url, options = {}) => {
      if (url === "/api/ui/settings" && options.method === "POST") {
        return makeJsonResponse({ ok: true });
      }

      if (String(url).startsWith("/api/statistics/overall?days=")) {
        statsRequestCount += 1;
        if (statsRequestCount === 1) {
          return makeJsonResponse({ ok: true, stats: activeStats });
        }
        if (statsRequestCount === 2) {
          return secondStatsRequest.promise;
        }
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });

    loadMainLogic();

    await window.selectStatsPeriod(1);

    const statsCard = document.getElementById("statsCard");
    const statsContent = document.getElementById("statsContent");
    const statsSkeleton = document.getElementById("statsSkeleton");
    const btnPeriod7 = document.getElementById("btnPeriod7");

    expect(statsSkeleton.classList.contains("hidden")).toBe(true);
    expect(statsContent.classList.contains("hidden")).toBe(false);

    const reloadPromise = window.selectStatsPeriod(7);
    await vi.runAllTicks();

    expect(statsSkeleton.classList.contains("hidden")).toBe(true);
    expect(statsContent.classList.contains("hidden")).toBe(false);
    expect(statsContent.classList.contains("stats-content--switching")).toBe(true);
    expect(statsContent.getAttribute("aria-busy")).toBe("true");
    expect(statsCard.style.height).toBe("240px");
    expect(statsCard.style.overflow).toBe("hidden");
    expect(btnPeriod7.disabled).toBe(true);

    secondStatsRequest.resolve(
      makeJsonResponse({ ok: true, stats: zeroStats })
    );

    await reloadPromise;

    expect(statsSkeleton.classList.contains("hidden")).toBe(true);
    expect(statsContent.classList.contains("hidden")).toBe(false);
    expect(statsContent.classList.contains("stats-content--empty")).toBe(true);
    expect(statsContent.classList.contains("stats-content--switching")).toBe(
      false
    );
    expect(statsContent.getAttribute("aria-busy")).toBe("false");
    expect(statsCard.style.height).toBe("180px");
    expect(btnPeriod7.disabled).toBe(false);

    await vi.advanceTimersByTimeAsync(380);

    expect(statsCard.style.height).toBe("180px");
    expect(statsCard.style.overflow).toBe("hidden");
  });
});
