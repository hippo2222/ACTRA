import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  makeRunId,
  waitForPageStable,
} from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedPartialRetryFixture,
  seedRetryQueueFixture,
} from "./helpers/data_seed.mjs";
import {
  getSessionScreen,
  readCurrentTask,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  startComplexFromList,
  submitCurrentTask,
} from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
}

async function createStartedRun(page, prefix, seedFixture) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedFixture({
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

async function clickAnswerByText(page, answerText) {
  await page.locator("label").filter({ hasText: answerText }).first().click();
}

async function clickQuestionNav(page, iconName) {
  const buttons = page.getByRole("button").filter({ hasText: iconName });
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (await button.isDisabled().catch(() => true)) {
      continue;
    }
    await button.click();
    await waitForPageStable(page);
    return;
  }

  throw new Error(`question_nav_disabled:${iconName}`);
}

async function ensureQuestionVisible(page, questionText, questionIndex = null) {
  const taskContent = page.locator("#task-content");
  const hasQuestionText = async () => {
    const text = await taskContent.textContent();
    return String(text || "").includes(questionText);
  };

  if (await hasQuestionText()) {
    return;
  }

  if (Number.isInteger(questionIndex)) {
    const panelButton = page.getByRole("button", { name: String(questionIndex + 1) }).last();
    if (await panelButton.count().catch(() => 0)) {
      await panelButton.click();
      await waitForPageStable(page);
      if (await hasQuestionText()) {
        return;
      }
    }
  }

  for (const iconName of ["chevron_right", "chevron_left"]) {
    try {
      await clickQuestionNav(page, iconName);
    } catch (_) {
      continue;
    }
    if (await hasQuestionText()) {
      return;
    }
  }

  throw new Error(`question_not_visible:${questionText}`);
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

test.describe("complex audit wave 1 queue / retry", () => {
  test("cpw_cross_retry_copies_appear_inside_same_iteration", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedRun(page, "cpw_retry_queue", seedRetryQueueFixture);

    try {
      const { runtime, fixture, sessionId } = run;
      const failedTaskFixture = fixture.tasks[0];
      const followupTaskFixture = fixture.tasks[1];

      const firstTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(firstTask.task_id).toBe(failedTaskFixture.taskId);
      expect(Boolean(firstTask.is_retry)).toBe(false);
      expect(Number(firstTask.queue?.index)).toBe(0);
      expect(Number(firstTask.queue?.total)).toBe(2);

      await clickAnswerByText(page, failedTaskFixture.wrongAnswerText);
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
          isRetry: Boolean(currentTask.is_retry),
          originIteration: Number(currentTask.order_meta?.retry?.origin_iteration || 0),
          queueIndex: Number(currentTask.queue?.index || 0),
          queueTotal: Number(currentTask.queue?.total || 0),
        });

        if (currentTask.task_id === failedTaskFixture.taskId) {
          await clickAnswerByText(page, failedTaskFixture.correctAnswerText);
        } else if (currentTask.task_id === followupTaskFixture.taskId) {
          await clickAnswerByText(page, followupTaskFixture.correctAnswerText);
        } else {
          throw new Error(`unexpected_task_after_retry_insert:${currentTask.task_id}`);
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
      expect(failedTaskRetries.every((item) => item.originIteration === 1)).toBe(true);

      const terminalScreen = await waitForTerminalScreen(page, sessionId);
      expect(["s2", "s3"]).toContain(terminalScreen);

      const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);
      expect(Boolean(iterationResults.has_next_iteration)).toBe(false);
      expect(Number(iterationResults.total_tasks || 0)).toBe(fixture.expected.totalTasksAfterRetry);
      expect(Number(iterationResults.successful_tasks || 0)).toBe(fixture.expected.successfulTasks);
      expect(Number(iterationResults.failed_tasks || 0)).toBe(fixture.expected.failedTasks);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_test_partial_retry_shows_failed_subquestions_only", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedRun(page, "cpw_partial_retry", seedPartialRetryFixture);

    try {
      const { runtime, fixture, sessionId } = run;
      const taskFixture = fixture.tasks[0];

      const firstTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      const firstQuestions = firstTask.task_data?.content?.questions || [];
      expect(firstTask.task_id).toBe(taskFixture.taskId);
      expect(Array.isArray(firstQuestions)).toBe(true);
      expect(firstQuestions.length).toBe(2);

      await ensureQuestionVisible(page, taskFixture.questions[0].text, 0);
      await clickAnswerByText(page, taskFixture.firstQuestionCorrectText);
      await ensureQuestionVisible(page, taskFixture.questions[1].text, 1);
      await clickAnswerByText(page, taskFixture.secondQuestionWrongText);

      const firstSubmit = await submitCurrentTask(page, sessionId);
      expect(firstSubmit.submitResponse.ok()).toBe(true);
      expect(firstSubmit.submitJson.ok).toBe(true);
      expect(firstSubmit.submitJson.result?.success).toBe(false);

      await clickNextTask(page, sessionId);
      expect(getSessionScreen(page.url(), sessionId)).toBe("s1");

      const retryTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      const retryQuestions = retryTask.task_data?.content?.questions || [];
      expect(retryTask.task_id).toBe(taskFixture.taskId);
      expect(Boolean(retryTask.is_retry)).toBe(true);
      expect(Boolean(retryTask.order_meta?.retry?.is_retry)).toBe(true);
      expect(Number(retryTask.order_meta?.retry?.origin_iteration)).toBe(1);
      expect(Array.isArray(retryQuestions)).toBe(true);
      expect(retryQuestions.length).toBe(fixture.expected.retryQuestionCount);
      expect(String(retryQuestions[0]?.text || "")).toContain(fixture.expected.failedQuestionText);

      await expect(page.locator("#task-content")).toContainText(fixture.expected.failedQuestionText);
      await expect(page.locator("#task-content")).not.toContainText(fixture.expected.hiddenQuestionText);
      await expect(page.locator("label")).toHaveCount(2);
    } finally {
      await run.runtime.dispose();
    }
  });
});
