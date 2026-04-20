import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  makeRunId,
  waitForPageStable,
} from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedAdaptiveDifficultyFixture,
  seedSmokeTestL1Fixture,
} from "./helpers/data_seed.mjs";
import {
  buildSessionResultsUrl,
  extractSessionIdFromUrl,
  getSessionScreen,
  pauseSession,
  readActiveSessions,
  readCurrentTask,
  readFinalResults,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  startComplexFromList,
  submitCurrentTask,
} from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createStartedSmokeRun(page, prefix) {
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

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
}

async function answerSingleChoiceByText(page, answerText) {
  await page.locator("label").filter({
    hasText: answerText,
  }).first().click();
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

  return {
    nextResponse,
    nextJson,
  };
}

async function moveSmokeRunToSecondTask(page, sessionId, fixture) {
  const firstTask = fixture.tasks[0];

  await answerSingleChoiceByText(page, firstTask.chosenAnswerText);
  const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

  expect(submitResponse.ok()).toBe(true);
  expect(submitJson.ok).toBe(true);
  expect(submitJson.result?.success).toBe(firstTask.expectedSuccess);

  await expect(page.locator("#next-task-btn")).toBeEnabled();
  await clickNextTask(page, sessionId);

  await expect(page.locator("#task-title")).toContainText(fixture.tasks[1].taskName);
  await waitForPageStable(page);
}

async function answerAdaptiveTask(page, fixture, difficulty) {
  if (difficulty >= 2 || await page.locator("#task-content textarea").count() > 0) {
    await page.locator("#task-content textarea").fill(fixture.tasks[0].openAnswerText);
    return;
  }

  await answerSingleChoiceByText(page, fixture.tasks[0].correctAnswerText);
}

test.describe("complex audit wave 1 queue / pause / difficulty", () => {
  test("cpw_cross_queue_progression_inside_iteration", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_queue_progression");

    try {
      const { runtime, fixture, sessionId } = run;

      const firstTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(firstTask.task_id).toBe(fixture.tasks[0].taskId);
      expect(Number(firstTask.queue?.index)).toBe(0);
      expect(Number(firstTask.queue?.total)).toBe(fixture.tasks.length);
      expect(Number(firstTask.iteration)).toBe(1);

      await moveSmokeRunToSecondTask(page, sessionId, fixture);

      const secondTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(secondTask.task_id).toBe(fixture.tasks[1].taskId);
      expect(secondTask.task_id).not.toBe(firstTask.task_id);
      expect(Number(secondTask.queue?.index)).toBe(1);
      expect(Number(secondTask.queue?.total)).toBe(fixture.tasks.length);
      expect(Number(secondTask.iteration)).toBe(1);
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[1].taskName);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_pause_resume_inside_iteration", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_pause_resume");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);

      const currentTaskBeforePause = unwrapTaskPayload(
        await readCurrentTask(runtime.baseUrl, sessionId)
      );
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[1].taskName);

      await page.locator("#back-to-complexes-btn").click();
      await expect(page.locator("#pause-confirm-modal")).toBeVisible();

      const pauseResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/pause`)
        );
      });

      await page.locator("#pause-confirm-submit").click();
      const pauseResponse = await pauseResponsePromise;
      const pauseJson = await pauseResponse.json();

      expect(pauseResponse.ok()).toBe(true);
      expect(pauseJson.ok).toBe(true);
      expect(pauseJson.paused).toBe(true);

      await page.waitForURL(new RegExp("/ui/complexes$"), { timeout: 20000 });
      await waitForPageStable(page);

      await expect
        .poll(async () => {
          const activeSessions = await readActiveSessions(runtime.baseUrl);
          const pausedSession = activeSessions.find((item) => item.session_id === sessionId);
          return pausedSession?.paused ?? null;
        }, { timeout: 10000, intervals: [250, 500, 1000] })
        .toBe(true);

      await page.goto(new URL(`/ui/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString());
      await waitForPageStable(page);

      expect(extractSessionIdFromUrl(page.url())).toBe(sessionId);
      await expect(page.locator("#resume-modal")).toBeVisible();

      const resumeResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/resume`)
        );
      });

      await page.locator("#resume-continue-btn").click();
      const resumeResponse = await resumeResponsePromise;
      const resumeJson = await resumeResponse.json();

      expect(resumeResponse.ok()).toBe(true);
      expect(resumeJson.ok).toBe(true);
      expect(resumeJson.paused).toBe(false);

      await expect(page.locator("#resume-modal")).toBeHidden();
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[1].taskName);

      const restoredTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(restoredTask.task_id).toBe(currentTaskBeforePause.task_id);
      expect(Number(restoredTask.queue?.index)).toBe(Number(currentTaskBeforePause.queue?.index));
      expect(Number(restoredTask.iteration)).toBe(Number(currentTaskBeforePause.iteration));
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_restore_from_paused_session", async ({ page, context }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_restore_paused");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);
      const currentTaskBeforePause = unwrapTaskPayload(
        await readCurrentTask(runtime.baseUrl, sessionId)
      );

      const pauseResult = await pauseSession(runtime.baseUrl, sessionId);
      expect(pauseResult.response.ok).toBe(true);
      expect(pauseResult.data?.ok).toBe(true);

      const restoredPage = await context.newPage();
      try {
        await restoredPage.goto(
          new URL(`/ui/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString()
        );
        await waitForPageStable(restoredPage);

        await expect(restoredPage.locator("#resume-modal")).toBeVisible();

        const resumeResponsePromise = restoredPage.waitForResponse((response) => {
          return (
            response.request().method() === "POST" &&
            response.url().includes(`/api/session/${sessionId}/resume`)
          );
        });

        await restoredPage.locator("#resume-continue-btn").click();
        await resumeResponsePromise;

        await expect(restoredPage.locator("#task-title")).toContainText(fixture.tasks[1].taskName);

        const restoredTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
        expect(restoredTask.task_id).toBe(currentTaskBeforePause.task_id);
        expect(Number(restoredTask.queue?.index)).toBe(Number(currentTaskBeforePause.queue?.index));
      } finally {
        await restoredPage.close();
      }
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_pause_redirect_contract", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_pause_redirect");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);

      await page.locator("#back-to-complexes-btn").click();
      await expect(page.locator("#pause-confirm-modal")).toBeVisible();

      const pauseResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/pause`)
        );
      });

      await page.locator("#pause-confirm-submit").click();
      const pauseResponse = await pauseResponsePromise;
      const pauseJson = await pauseResponse.json();

      expect(pauseResponse.ok()).toBe(true);
      expect(pauseJson.ok).toBe(true);
      expect(pauseJson.paused).toBe(true);

      await page.waitForURL(new RegExp("/ui/complexes$"), { timeout: 20000 });
      await waitForPageStable(page);

      await page.goto(new URL(`/ui/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString());
      await waitForPageStable(page);
      await expect(page.locator("#resume-modal")).toBeVisible();
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_difficulty_progression_contract", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedAdaptiveRun(page, "cpw_difficulty_contract");

    try {
      const { runtime, fixture, sessionId } = run;

      const taskIteration1 = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(taskIteration1.task_id).toBe(fixture.tasks[0].taskId);
      expect(Number(taskIteration1.iteration)).toBe(1);
      expect(Number(taskIteration1.difficulty)).toBe(1);
      expect(Number(taskIteration1.queue?.index)).toBe(0);
      expect(Number(taskIteration1.queue?.total)).toBe(1);

      await answerAdaptiveTask(page, fixture, 1);
      const submitIteration1 = await submitCurrentTask(page, sessionId);
      expect(submitIteration1.submitResponse.ok()).toBe(true);
      expect(submitIteration1.submitJson.result?.success).toBe(true);
      await clickNextTask(page, sessionId);

      await page.waitForURL((url) => getSessionScreen(url.toString(), sessionId) === "s2", {
        timeout: 20000,
      });
      await waitForPageStable(page);

      const iteration1Results = await readIterationResults(runtime.baseUrl, sessionId);
      expect(Number(iteration1Results.iteration)).toBe(1);
      expect(Boolean(iteration1Results.has_next_iteration)).toBe(true);
      expect(Number(iteration1Results.total_tasks || 0)).toBe(1);
      expect(Number(iteration1Results.successful_tasks || 0)).toBe(1);

      await expect(page.locator("#stat-total-tasks-main")).toContainText("1");
      await page.locator("#continue-btn").click();
      await page.waitForURL((url) => getSessionScreen(url.toString(), sessionId) === "s1", {
        timeout: 20000,
      });
      await waitForPageStable(page);

      const taskIteration2 = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(taskIteration2.task_id).toBe(fixture.tasks[0].taskId);
      expect(Number(taskIteration2.iteration)).toBe(2);
      expect(Number(taskIteration2.difficulty)).toBe(2);
      await expect(page.locator("#task-content textarea")).toBeVisible();

      await answerAdaptiveTask(page, fixture, 2);
      const submitIteration2 = await submitCurrentTask(page, sessionId);
      expect(submitIteration2.submitResponse.ok()).toBe(true);
      expect(submitIteration2.submitJson.result?.success).toBe(true);
      await clickNextTask(page, sessionId);
      await page.waitForURL((url) => {
        const screen = getSessionScreen(url.toString(), sessionId);
        return screen === "s2" || screen === "s3";
      }, {
        timeout: 20000,
      });
      await waitForPageStable(page);

      const terminalScreen = getSessionScreen(page.url(), sessionId);
      expect(["s2", "s3"]).toContain(terminalScreen);

      if (terminalScreen === "s2") {
        const iteration2Results = await readIterationResults(runtime.baseUrl, sessionId);
        expect(Boolean(iteration2Results.has_next_iteration)).toBe(false);
        await page.locator("#continue-btn").click();
        await page.waitForURL(buildSessionResultsUrl(runtime.baseUrl, sessionId), {
          timeout: 20000,
        });
      } else {
        await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
      }
      await waitForPageStable(page);

      const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
      expect(Number(finalResults.total_iterations || 0)).toBe(2);
      expect(Array.isArray(finalResults.iterations)).toBe(true);
      expect(finalResults.iterations.length).toBe(2);

      await expect(page.locator("#summary-iterations")).toContainText("2");
      await expect(page.locator("#iterations-grid").locator(":scope > *")).toHaveCount(2);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_difficulty_progression_visible_in_s1_s2_s3", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedAdaptiveRun(page, "cpw_difficulty_visible");

    try {
      const { runtime, fixture, sessionId } = run;

      await expect(page.locator("#difficulty-label")).toBeVisible();
      await expect(page.locator("#difficulty-label")).toContainText("1");

      await answerAdaptiveTask(page, fixture, 1);
      await submitCurrentTask(page, sessionId);
      await clickNextTask(page, sessionId);
      await page.waitForURL((url) => getSessionScreen(url.toString(), sessionId) === "s2", {
        timeout: 20000,
      });
      await waitForPageStable(page);

      await expect(page.locator("#stat-difficulty")).toBeVisible();
      await expect(page.locator("#stat-difficulty")).toContainText("1");

      await page.locator("#continue-btn").click();
      await page.waitForURL((url) => getSessionScreen(url.toString(), sessionId) === "s1", {
        timeout: 20000,
      });
      await waitForPageStable(page);
      await expect(page.locator("#difficulty-label")).toBeVisible();
      await expect(page.locator("#difficulty-label")).toContainText("2");

      await answerAdaptiveTask(page, fixture, 2);
      await submitCurrentTask(page, sessionId);
      await clickNextTask(page, sessionId);
      await page.waitForURL((url) => {
        const screen = getSessionScreen(url.toString(), sessionId);
        return screen === "s2" || screen === "s3";
      }, {
        timeout: 20000,
      });
      await waitForPageStable(page);

      if (getSessionScreen(page.url(), sessionId) === "s2") {
        await page.locator("#continue-btn").click();
        await page.waitForURL(buildSessionResultsUrl(runtime.baseUrl, sessionId), {
          timeout: 20000,
        });
      } else {
        await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
      }
      await waitForPageStable(page);

      await expect(page.locator("#iterations-grid")).toContainText("2");
    } finally {
      await run.runtime.dispose();
    }
  });
});
