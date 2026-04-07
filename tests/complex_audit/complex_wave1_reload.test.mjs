import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedSmokeTestL1Fixture,
  seedTypeHappyPathFixture,
} from "./helpers/data_seed.mjs";
import {
  buildSessionIterationUrl,
  buildSessionResultsUrl,
  computeSuccessRatePercent,
  getSessionScreen,
  readFinalResults,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  completeFixtureSession,
  startComplexFromList,
  submitCurrentTask,
} from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createStartedTypeRun(page, prefix, taskType) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedTypeHappyPathFixture({
      baseUrl: runtime.baseUrl,
      runId,
      taskType,
      dataDir: runtime.dataDir,
    });
    const sessionId = await startComplexFromList(page, {
      baseUrl: runtime.baseUrl,
      complexId: fixture.complexId,
      complexName: fixture.complexName,
    });

    return {
      runtime,
      fixture,
      sessionId,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

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
      sessionId,
      flow,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test.describe("complex audit wave 1 reload", () => {
  test("cpw_s1_reload_preserves_current_task_state", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_reload_s1_draft", "open_answer");

    try {
      const { fixture, sessionId } = run;
      const draftText = fixture.tasks[0].interaction.answerText;

      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await page.locator("#task-content textarea").fill(draftText);
      await expect(page.locator("#check-answer-btn")).toBeEnabled();

      await page.reload();
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s1");
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await expect(page.locator("#task-content textarea")).toHaveValue(draftText);
      await expect(page.locator("#status-banner")).toContainText("Восстановлен несохраненный ответ");
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s1_reload_preserves_task_results_state", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_reload_s1_results", "open_answer");

    try {
      const { fixture, sessionId } = run;

      await performTaskHappyPath(page, fixture);
      const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

      expect(submitResponse.ok()).toBe(true);
      expect(submitJson.ok).toBe(true);
      expect(submitJson.result?.success).toBe(true);

      await expect(page.locator("#result-box")).toBeVisible();
      await expect(page.locator("#next-task-btn")).toBeEnabled();

      const resultTitleBeforeReload = await page.locator("#result-title").textContent();

      await page.reload();
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s1");
      await expect(page.locator("#result-box")).toBeVisible();
      await expect(page.locator("#next-task-btn")).toBeEnabled();
      await expect(page.locator("#result-title")).toHaveText(resultTitleBeforeReload || "");
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s2_reload_preserves_iteration_results", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createCompletedSmokeRun(page, "cpw_reload_s2");

    try {
      const { runtime, fixture, sessionId, flow } = run;
      const iterationResults = flow.finalIterationResults || (await readIterationResults(
        runtime.baseUrl,
        sessionId
      ));

      await page.goto(
        buildSessionIterationUrl(runtime.baseUrl, sessionId, iterationResults.iteration)
      );
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s2");
      const expectedSuccessRateText = `${computeSuccessRatePercent(iterationResults)}%`;

      await expect(page.locator("#stat-success-rate")).toHaveText(expectedSuccessRateText, {
        timeout: 10000,
      });

      const statsBeforeReload = {
        totalTasks: await page.locator("#stat-total-tasks-main").textContent(),
        failedTasks: await page.locator("#stat-failed-tasks").textContent(),
        successRate: expectedSuccessRateText,
        triggerList: await page.locator("#trigger-tasks-list").textContent(),
      };

      await page.reload();
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s2");
      expect(Number(iterationResults.total_tasks || 0)).toBe(fixture.expected.totalTasks);
      await expect(page.locator("#stat-total-tasks-main")).toHaveText(statsBeforeReload.totalTasks || "");
      await expect(page.locator("#stat-failed-tasks")).toHaveText(statsBeforeReload.failedTasks || "");
      await expect(page.locator("#stat-success-rate")).toHaveText(statsBeforeReload.successRate || "", {
        timeout: 10000,
      });
      await expect(page.locator("#trigger-tasks-list")).toContainText(statsBeforeReload.triggerList || "");
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s3_reload_preserves_final_results", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createCompletedSmokeRun(page, "cpw_reload_s3");

    try {
      const { runtime, sessionId } = run;
      const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
      const totalTasks = Number(finalResults.total_tasks || 0);
      const successfulTasks = Number(finalResults.successful_tasks_count || 0);
      const expectedSuccessRate = totalTasks > 0
        ? Math.round((successfulTasks / totalTasks) * 100)
        : 0;

      await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
      await waitForPageStable(page);

      await expect(page.locator("#summary-iterations")).toContainText(
        String(finalResults.total_iterations)
      );
      await expect(page.locator("#summary-completed-tasks")).toContainText(
        String(finalResults.successful_tasks_count)
      );
      await expect(page.locator("#summary-success-rate")).toContainText(
        String(expectedSuccessRate)
      );

      await page.reload();
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s3");
      expect(Number(finalResults.total_tasks || 0)).toBeGreaterThan(0);
      await expect(page.locator("#summary-iterations")).toContainText(
        String(finalResults.total_iterations)
      );
      await expect(page.locator("#summary-completed-tasks")).toContainText(
        String(finalResults.successful_tasks_count)
      );
      await expect(page.locator("#summary-success-rate")).toContainText(
        String(expectedSuccessRate)
      );
    } finally {
      await run.runtime.dispose();
    }
  });
});
