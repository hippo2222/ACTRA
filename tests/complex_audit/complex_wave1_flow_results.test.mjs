import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import {
  buildSessionIterationUrl,
  buildSessionResultsUrl,
  readFinalResults,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  completeFixtureSession,
  startComplexFromList,
} from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createCompletedSmokeRun(page, prefix) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedSmokeTestL1Fixture({
      baseUrl: runtime.baseUrl,
      runId,
    });
    const failedTask = fixture.tasks.find((task) => task.expectedSuccess === false);

    const sessionId = await startComplexFromList(page, {
      baseUrl: runtime.baseUrl,
      complexId: fixture.complexId,
      complexName: fixture.complexName,
    });
    const flow = await completeFixtureSession(page, {
      baseUrl: runtime.baseUrl,
      fixture,
    });

    return {
      runtime,
      fixture,
      failedTask,
      sessionId,
      flow,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test.describe("complex audit wave 1 flow/results", () => {
  test("cpw_cross_single_iteration_s2_contract", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createCompletedSmokeRun(page, "cpw_flow_s2");

    try {
      const { runtime, fixture, failedTask, sessionId, flow } = run;
      const iterationResults = flow.finalIterationResults || (await readIterationResults(
        runtime.baseUrl,
        sessionId
      ));

      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto(
        buildSessionIterationUrl(runtime.baseUrl, sessionId, iterationResults.iteration)
      );
      await waitForPageStable(page);

      expect(Number(iterationResults.total_tasks || 0)).toBe(fixture.expected.totalTasks);
      expect(Boolean(iterationResults.has_next_iteration)).toBe(false);

      await expect(page.locator("#continue-btn .truncate")).toContainText(/итог|комплекс/i);
      await expect(page.locator("#to-complex-list-btn .truncate")).toContainText(/списк|комплекс/i);
      await expect(page.locator("#next-step-hint")).toContainText(/последн|итог/i);
      await expect(page.locator("#stat-iteration-time")).not.toHaveText(/^\s*—\s*$/);
      await expect(page.locator("#continue-btn")).toBeVisible();
      await expect(page.locator("#to-complex-list-btn")).toBeVisible();

      const layoutProbe = await page.evaluate(() => {
        const scrollingEl = document.scrollingElement || document.documentElement;
        const continueBtn = document.getElementById("continue-btn");
        const secondaryBtn = document.getElementById("to-complex-list-btn");

        function isFullyVisible(el) {
          if (!el) return false;
          const rect = el.getBoundingClientRect();
          return (
            rect.top >= 0 &&
            rect.bottom <= window.innerHeight &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth
          );
        }

        return {
          hasVerticalOverflow:
            !!scrollingEl && Math.ceil(scrollingEl.scrollHeight) > Math.ceil(window.innerHeight) + 2,
          continueVisible: isFullyVisible(continueBtn),
          secondaryVisible: isFullyVisible(secondaryBtn),
        };
      });

      expect(layoutProbe.hasVerticalOverflow).toBe(false);
      expect(layoutProbe.continueVisible).toBe(true);
      expect(layoutProbe.secondaryVisible).toBe(true);

      await page.locator("#open-problem-dialog-btn").click();
      await expect(page.locator("#problem-dialog")).toBeVisible();
      await expect(page.locator("#problem-dialog-list li")).toHaveCount(
        fixture.expected.failedTasks
      );
      await expect(page.locator("#problem-dialog-list")).toContainText(failedTask.taskName);
      await page.locator("#problem-dialog-close-btn").click();
      await expect(page.locator("#problem-dialog-backdrop")).toBeHidden();

      await page.locator("#continue-btn").click();
      await page.waitForURL(buildSessionResultsUrl(runtime.baseUrl, sessionId), {
        timeout: 20000,
      });
      await waitForPageStable(page);
      expect(page.url()).toBe(buildSessionResultsUrl(runtime.baseUrl, sessionId));
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s3_problem_tasks_reflect_failed_results", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createCompletedSmokeRun(page, "cpw_flow_s3");

    try {
      const { runtime, fixture, failedTask, sessionId } = run;
      const finalResults = await readFinalResults(runtime.baseUrl, sessionId);

      await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
      await waitForPageStable(page);

      expect(Number(finalResults.tasks_failed_count || 0)).toBe(fixture.expected.failedTasks);
      expect(failedTask).toBeTruthy();
      await expect(page.locator("#problem-tasks-list li")).toHaveCount(
        fixture.expected.failedTasks
      );
      await expect(page.locator("#problem-tasks-list")).toContainText(failedTask.taskName);
    } finally {
      await run.runtime.dispose();
    }
  });
});
