import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  makeRunId,
  waitForPageStable,
} from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { assertApiOk, fetchJson, seedHighLevelRetryFixture } from "./helpers/data_seed.mjs";
import {
  getSessionScreen,
  readCurrentTask,
  readIterationResults,
} from "./helpers/session_api.mjs";
import { ensureHostedBrowserAuth } from "./helpers/runtime_context.mjs";
import { submitCurrentTask } from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
}

async function startComplexAtIteration(page, { baseUrl, complexId, startIteration }) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(complexId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start_iteration: startIteration }),
    }),
    "start_complex_session"
  );

  const sessionId = String(payload.session_id || "").trim();
  if (!sessionId) {
    throw new Error("start_complex_session_missing_session_id");
  }

  await ensureHostedBrowserAuth(page, baseUrl);
  await page.goto(new URL(`/session/${encodeURIComponent(sessionId)}`, baseUrl).toString());
  await waitForPageStable(page);
  return sessionId;
}

async function createStartedRun(page, prefix) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedHighLevelRetryFixture({
      baseUrl: runtime.baseUrl,
      runId,
    });
    const sessionId = await startComplexAtIteration(page, {
      baseUrl: runtime.baseUrl,
      complexId: fixture.complexId,
      startIteration: fixture.expected.difficulty,
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

async function fillOpenTextAnswer(page, answerText) {
  const input = page.locator('#task-content textarea, #task-content input[type="text"]').first();
  await expect(input).toBeVisible();
  await input.fill(answerText);
}

async function clickNextTask(page, sessionId) {
  const nextResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/next`)
    );
  });

  await page.locator("#next-task-btn").click();

  const nextResponse = await nextResponsePromise;
  const nextJson = await nextResponse.json().catch(() => null);

  await waitForPageStable(page);

  return {
    nextResponse,
    nextJson,
  };
}

async function waitForTerminalScreen(page, sessionId, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const screen = getSessionScreen(page.url(), sessionId);
    if (screen === "s2" || screen === "s3") {
      return screen;
    }
    await page.waitForTimeout(100);
  }
  return getSessionScreen(page.url(), sessionId);
}

test.describe("complex audit wave 2 mechanics", () => {
  test("cpw_cross_test_l2_retry_copies_appear_inside_same_iteration", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedRun(page, "cpw_wave2_retry_queue");

    try {
      const { runtime, fixture, sessionId } = run;
      const failedTaskFixture = fixture.tasks[0];
      const followupTaskFixture = fixture.tasks[1];

      const firstTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(firstTask.task_id).toBe(failedTaskFixture.taskId);
      expect(Number(firstTask.difficulty || 0)).toBe(fixture.expected.difficulty);
      expect(Boolean(firstTask.is_retry)).toBe(false);
      expect(Number(firstTask.queue?.index)).toBe(0);
      expect(Number(firstTask.queue?.total)).toBe(2);
      await expect(page.locator("#difficulty-label")).toContainText(String(fixture.expected.difficulty));

      await fillOpenTextAnswer(page, failedTaskFixture.wrongAnswerText);
      const firstSubmit = await submitCurrentTask(page, sessionId);
      expect(firstSubmit.submitResponse.ok()).toBe(true);
      expect(firstSubmit.submitJson.ok).toBe(true);
      expect(firstSubmit.submitJson.result?.success).toBe(false);
      await expect(page.locator("#next-task-btn")).toBeEnabled();

      await clickNextTask(page, sessionId);
      expect(getSessionScreen(page.url(), sessionId)).toBe("s1");

      const postFailureVisits = [];

      for (let index = 0; index < 3; index += 1) {
        const currentTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
        postFailureVisits.push({
          taskId: currentTask.task_id,
          difficulty: Number(currentTask.difficulty || 0),
          isRetry: Boolean(currentTask.is_retry),
          originIteration: Number(currentTask.order_meta?.retry?.origin_iteration || 0),
          queueIndex: Number(currentTask.queue?.index || 0),
          queueTotal: Number(currentTask.queue?.total || 0),
        });

        if (currentTask.task_id === failedTaskFixture.taskId) {
          await fillOpenTextAnswer(page, failedTaskFixture.correctAnswerText);
        } else if (currentTask.task_id === followupTaskFixture.taskId) {
          await fillOpenTextAnswer(page, followupTaskFixture.correctAnswerText);
        } else {
          throw new Error(`unexpected_task_after_high_level_retry:${currentTask.task_id}`);
        }

        const submit = await submitCurrentTask(page, sessionId);
        expect(submit.submitResponse.ok()).toBe(true);
        expect(submit.submitJson.ok).toBe(true);
        expect(submit.submitJson.result?.success).toBe(true);

        await clickNextTask(page, sessionId);
      }

      const failedTaskRetries = postFailureVisits.filter(
        (item) => item.taskId === failedTaskFixture.taskId && item.isRetry
      );
      const remainingOriginalTask = postFailureVisits.find(
        (item) => item.taskId === followupTaskFixture.taskId && !item.isRetry
      );

      expect(postFailureVisits).toHaveLength(3);
      expect(failedTaskRetries).toHaveLength(2);
      expect(remainingOriginalTask).toBeTruthy();
      expect(postFailureVisits.every((item) => item.queueTotal === 4)).toBe(true);
      expect(postFailureVisits.every((item) => item.difficulty === fixture.expected.difficulty)).toBe(true);
      expect(failedTaskRetries.every((item) => item.originIteration === fixture.expected.difficulty)).toBe(true);

      const terminalScreen = await waitForTerminalScreen(page, sessionId);
      expect(["s2", "s3"]).toContain(terminalScreen);

      const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);
      expect(Boolean(iterationResults.has_next_iteration)).toBe(false);
      expect(Number(iterationResults.total_tasks || 0)).toBe(fixture.expected.totalTasksAfterRetry);
      expect(Number(iterationResults.successful_tasks || 0)).toBe(fixture.expected.successfulTasks);
      expect(Number(iterationResults.failed_tasks || 0)).toBe(fixture.expected.failedTasks);

      if (terminalScreen === "s2") {
        await expect(page.locator("#stat-total-tasks-main")).toContainText(String(fixture.expected.totalTasksAfterRetry));
        await expect(page.locator("#stat-failed-tasks")).toContainText(String(fixture.expected.failedTasks));
        await expect(page.locator("#stat-success-rate")).toContainText(String(fixture.expected.successRatePercent));
        await expect(page.locator("#trigger-tasks-list")).toContainText(failedTaskFixture.taskName);
      }
    } finally {
      await run.runtime.dispose();
    }
  });
});
