import { expect } from "@playwright/test";

import { waitForPageStable } from "./base.mjs";
import { assertApiOk, fetchJson } from "./data_seed.mjs";
import { ensureHostedBrowserAuth } from "./runtime_context.mjs";
import {
  escapeRegExp,
  extractSessionIdFromUrl,
  extractTaskIdentity,
  getSessionScreen,
  readCurrentTask,
  readIterationResults,
  tryReadResponseJson,
} from "./session_api.mjs";

export async function startComplexFromList(page, { baseUrl, complexId, complexName }) {
  await ensureHostedBrowserAuth(page, baseUrl);
  await page.goto(new URL("/complexes", baseUrl).toString());
  await waitForPageStable(page);

  const startButton = page.locator(`button.start-btn[data-complex-id="${complexId}"]`);

  await expect(startButton).toBeVisible();
  await expect(page.locator("#complexes-list")).toContainText(complexName);

  await startButton.click();
  await page.waitForURL(
    new RegExp(`${escapeRegExp(baseUrl)}/session/[^/?#]+$`),
    { timeout: 20000 }
  );
  await waitForPageStable(page);

  return extractSessionIdFromUrl(page.url());
}

export async function completeFixtureSession(page, { baseUrl, fixture }) {
  const sessionId = extractSessionIdFromUrl(page.url());
  const seenTaskIds = new Set();
  const submittedTaskIds = [];
  const iterationSnapshots = [];
  let finalIterationResults = null;

  while (submittedTaskIds.length < fixture.tasks.length) {
    const screen = getSessionScreen(page.url(), sessionId);

    if (screen === "s1") {
      const currentTaskApi = await readCurrentTask(baseUrl, sessionId);
      const currentTaskIdentity = extractTaskIdentity(currentTaskApi);
      const taskFixture = fixture.tasks.find((item) => item.taskId === currentTaskIdentity.taskId);

      expect(taskFixture).toBeTruthy();
      expect(seenTaskIds.has(currentTaskIdentity.taskId)).toBe(false);

      seenTaskIds.add(currentTaskIdentity.taskId);
      submittedTaskIds.push(currentTaskIdentity.taskId);

      await expect(page.locator("#task-title")).toContainText(taskFixture.taskName);
      await expect(page.locator("#task-content")).toContainText(taskFixture.questionText);

      const answerOption = page.locator("label").filter({
        hasText: taskFixture.chosenAnswerText,
      });
      await answerOption.first().click();

      const submitResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/task/submit`)
        );
      });

      await page.locator("#check-answer-btn").click();

      const submitResponse = await submitResponsePromise;
      const submitJson = await submitResponse.json();

      expect(submitResponse.ok()).toBe(true);
      expect(submitJson.ok).toBe(true);
      expect(submitJson.result?.success).toBe(taskFixture.expectedSuccess);

      await expect(page.locator("#result-box")).toBeVisible();
      await expect(page.locator("#result-title")).not.toHaveText(/^\s*$/);
      await expect(page.locator("#next-task-btn")).toBeEnabled();

      const nextResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/task/next`)
        );
      });
      const navigationAfterNextPromise = page
        .waitForURL(
          (url) => {
            const nextScreen = getSessionScreen(url.toString(), sessionId);
            return nextScreen === "s2" || nextScreen === "s3";
          },
          { timeout: 6000 }
        )
        .catch(() => null);

      await page.locator("#next-task-btn").click();

      const [nextResponse] = await Promise.all([
        nextResponsePromise,
        navigationAfterNextPromise,
      ]);
      const nextJson = await tryReadResponseJson(nextResponse);

      if (!nextResponse.ok() || nextJson?.ok === false) {
        await page.waitForURL(
          (url) => {
            const nextScreen = getSessionScreen(url.toString(), sessionId);
            return nextScreen === "s2" || nextScreen === "s3";
          },
          { timeout: 20000 }
        );
        await waitForPageStable(page);
        continue;
      }

      const postNextScreen = getSessionScreen(page.url(), sessionId);
      if (postNextScreen === "s2" || postNextScreen === "s3") {
        await waitForPageStable(page);
        continue;
      }

      const nextTaskIdentity = extractTaskIdentity(nextJson.task);
      await expect(page.locator("#task-title")).toContainText(nextTaskIdentity.taskName);
      continue;
    }

    if (screen === "s2") {
      const results = await readIterationResults(baseUrl, sessionId);
      iterationSnapshots.push({
        iteration: Number(results.iteration || 0),
        totalTasks: Number(results.total_tasks || 0),
        successfulTasks: Number(results.successful_tasks || 0),
        failedTasks: Number(results.failed_tasks || 0),
        hasNextIteration: Boolean(results.has_next_iteration),
      });

      expect(Number(results.total_tasks || 0)).toBeGreaterThan(0);
      expect(
        Number(results.successful_tasks || 0) + Number(results.failed_tasks || 0)
      ).toBe(Number(results.total_tasks || 0));

      if (submittedTaskIds.length === fixture.tasks.length) {
        finalIterationResults = results;
        break;
      }

      await page.locator("#continue-btn").click();
      await page.waitForURL(
        (url) => {
          const nextScreen = getSessionScreen(url.toString(), sessionId);
          return nextScreen === "s1" || nextScreen === "s3";
        },
        { timeout: 20000 }
      );
      await waitForPageStable(page);
      continue;
    }

    if (screen === "s3") {
      break;
    }

    throw new Error(`unexpected_session_screen:${screen}:${page.url()}`);
  }

  return {
    sessionId,
    submittedTaskIds,
    seenTaskIds: [...seenTaskIds],
    iterationSnapshots,
    finalIterationResults,
    terminalScreen: getSessionScreen(page.url(), sessionId),
  };
}

export async function countSubmitRequestsDuring(page, sessionId, action, settleMs = 700) {
  let submitCount = 0;
  const requestListener = (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/api/session/${sessionId}/task/submit`)
    ) {
      submitCount += 1;
    }
  };

  page.on("request", requestListener);

  try {
    await action();
    await page.waitForTimeout(settleMs);
    return submitCount;
  } finally {
    page.off("request", requestListener);
  }
}

export async function submitCurrentTask(page, sessionId) {
  const submitResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/submit`)
    );
  });

  await page.locator("#check-answer-btn").click();

  const submitResponse = await submitResponsePromise;
  const submitJson = await submitResponse.json();

  return {
    submitResponse,
    submitJson,
  };
}

export async function assertBlockedSubmissionState(page, expectedStatusText = null) {
  if (expectedStatusText) {
    await expect(page.locator("#status-banner")).toBeVisible();
    await expect(page.locator("#status-banner")).toContainText(expectedStatusText);
  }

  await expect(page.locator("#result-box")).toBeHidden();
  await expect(page.locator("#next-task-btn")).toBeDisabled();
}
