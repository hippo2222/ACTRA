import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { seedAdaptiveDifficultyFixture, fetchJson } from "./helpers/data_seed.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  getSessionScreen,
  readActiveSessions,
  readIterationResults,
} from "./helpers/session_api.mjs";
import { startComplexFromList, submitCurrentTask } from "./helpers/s1_helpers.mjs";
import { readComplexStatistics, readOverallStatistics } from "./helpers/statistics_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createStartedAdaptiveRun(page, prefix) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedAdaptiveDifficultyFixture({
      baseUrl: runtime.baseUrl,
      runId,
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

async function answerAdaptiveTask(page, fixture, difficulty) {
  if (difficulty >= 2 || (await page.locator("#task-content textarea").count()) > 0) {
    await page.locator("#task-content textarea").fill(fixture.tasks[0].openAnswerText);
    return;
  }

  await page
    .locator("label")
    .filter({ hasText: fixture.tasks[0].correctAnswerText })
    .first()
    .click();
}

async function clickNextTask(page, sessionId) {
  const nextResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/next`)
    );
  });

  await page.locator("#next-task-btn").click();
  return nextResponsePromise;
}

function readComplexAggregateSnapshot(complexStatsPayload, complexId) {
  const aggregated = complexStatsPayload?.complexes?.[complexId]?.aggregated || {};
  return {
    attempts: Number(aggregated.attempts || 0),
    wins: Number(aggregated.wins || 0),
  };
}

test.describe("complex audit wave 2 cancellation", () => {
  test("cpw_cross_finish_from_s2_cancels_session_without_completion_side_effects", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedAdaptiveRun(page, "cpw_finish_from_s2");

    try {
      const { runtime, fixture, sessionId } = run;

      const overallBefore = await readOverallStatistics(runtime.baseUrl);
      const complexesBefore = await readComplexStatistics(runtime.baseUrl);
      const complexBefore = readComplexAggregateSnapshot(complexesBefore, fixture.complexId);

      await answerAdaptiveTask(page, fixture, 1);
      const submitStep = await submitCurrentTask(page, sessionId);
      expect(submitStep.submitResponse.ok()).toBe(true);
      expect(submitStep.submitJson.ok).toBe(true);
      expect(submitStep.submitJson.result?.success).toBe(true);

      const nextResponse = await clickNextTask(page, sessionId);
      expect(nextResponse.ok()).toBe(true);

      await page.waitForURL(
        (url) => getSessionScreen(url.toString(), sessionId) === "s2",
        { timeout: 20000 }
      );
      await waitForPageStable(page);

      const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);
      expect(Boolean(iterationResults.has_next_iteration)).toBe(true);
      await expect(page.locator("#continue-btn .truncate")).toContainText(/следующ|продолж/i);

      const cancelResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/cancel`)
        );
      });

      await page.locator("#finish-complex-btn").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.getByRole("button", { name: /^Завершить$/ }).click();

      const cancelResponse = await cancelResponsePromise;
      const cancelJson = await cancelResponse.json();
      expect(cancelResponse.ok()).toBe(true);
      expect(cancelJson.ok).toBe(true);

      await page.waitForURL(new RegExp("/complexes$"), { timeout: 20000 });
      await waitForPageStable(page);

      await expect
        .poll(async () => {
          const activeSessions = await readActiveSessions(runtime.baseUrl);
          return activeSessions.some((item) => item.session_id === sessionId);
        }, { timeout: 10000, intervals: [250, 500, 1000] })
        .toBe(false);

      const currentTaskAfterCancel = await fetchJson(
        runtime.baseUrl,
        `/api/session/${encodeURIComponent(sessionId)}/task`
      );
      expect(currentTaskAfterCancel.response.status).toBe(404);

      const finalResultsAfterCancel = await fetchJson(
        runtime.baseUrl,
        `/api/session/${encodeURIComponent(sessionId)}/final-results`
      );
      expect(finalResultsAfterCancel.response.status).toBe(404);

      const overallAfter = await readOverallStatistics(runtime.baseUrl);
      const complexesAfter = await readComplexStatistics(runtime.baseUrl);
      const complexAfter = readComplexAggregateSnapshot(complexesAfter, fixture.complexId);

      expect(Number(overallAfter.stats?.total_tasks_attempted || 0)).toBeGreaterThanOrEqual(
        Number(overallBefore.stats?.total_tasks_attempted || 0) + 1
      );
      expect(complexAfter.attempts).toBe(complexBefore.attempts);
      expect(complexAfter.wins).toBe(complexBefore.wins);
    } finally {
      await run.runtime.dispose();
    }
  });
});
