import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { fetchJson, seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import {
  extractSessionIdFromUrl,
  readActiveSessions,
  readCurrentTask,
} from "./helpers/session_api.mjs";
import { startComplexFromList, submitCurrentTask } from "./helpers/s1_helpers.mjs";

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

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
}

async function answerSingleChoiceByText(page, answerText) {
  await page.locator("label").filter({ hasText: answerText }).first().click();
}

async function clickNextTask(page, sessionId) {
  const nextResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/next`)
    );
  });

  await page.locator("#next-task-btn").click();
  await nextResponsePromise;
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

async function resumePausedSessionFromComplexesList(page, { baseUrl, complexId, sessionId }) {
  const startButton = page.locator(`button.start-btn[data-complex-id="${complexId}"]`);
  await expect(startButton).toBeVisible();

  await startButton.click();

  const dialog = page.locator('[role="dialog"]').filter({ hasText: "Найдена сессия на паузе" });
  const deadline = Date.now() + 8000;

  while (Date.now() < deadline) {
    if (page.url().includes(`/session/${sessionId}`)) {
      break;
    }
    if (await dialog.isVisible().catch(() => false)) {
      await dialog.locator('[data-role="confirm"]').click();
      break;
    }
    await page.waitForTimeout(150);
  }

  await page.waitForURL(new RegExp(`${String(baseUrl).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/session/${sessionId}$`), {
    timeout: 20000,
  });
  await waitForPageStable(page);
}

test.describe("complex audit wave 2 re-entry / cancel surfaces", () => {
  test("cpw_cross_complexes_list_resumes_paused_session", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_complexes_resume");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);

      const currentTaskBeforePause = unwrapTaskPayload(
        await readCurrentTask(runtime.baseUrl, sessionId)
      );

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

      await page.waitForURL(new RegExp("/complexes$"), { timeout: 20000 });
      await waitForPageStable(page);

      await expect(page.locator("#complexes-list")).toContainText(fixture.complexName);
      await expect(page.locator("#complexes-list")).toContainText("На паузе");

      await resumePausedSessionFromComplexesList(page, {
        baseUrl: runtime.baseUrl,
        complexId: fixture.complexId,
        sessionId,
      });

      expect(extractSessionIdFromUrl(page.url())).toBe(sessionId);
      const resumeModal = page.locator("#resume-modal");
      if (await resumeModal.isVisible().catch(() => false)) {
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
      } else {
        await expect(resumeModal).toBeHidden();
      }

      const restoredTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(restoredTask.task_id).toBe(currentTaskBeforePause.task_id);
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[1].taskName);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_pause_discard_cancels_session_and_next_start_is_fresh", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_pause_discard");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);

      await page.locator("#back-to-complexes-btn").click();
      await expect(page.locator("#pause-confirm-modal")).toBeVisible();

      const cancelResponsePromise = page.waitForResponse((response) => {
        return (
          response.request().method() === "POST" &&
          response.url().includes(`/api/session/${sessionId}/cancel`)
        );
      });

      await page.locator("#pause-confirm-discard").click();
      const cancelResponse = await cancelResponsePromise;
      expect(cancelResponse.ok()).toBe(true);

      await page.waitForURL(new RegExp("/complexes$"), { timeout: 20000 });
      await waitForPageStable(page);

      await expect
        .poll(async () => {
          const active = await readActiveSessions(runtime.baseUrl);
          return active.some((item) => item.session_id === sessionId);
        }, { timeout: 10000, intervals: [250, 500, 1000] })
        .toBe(false);

      const taskAfterCancel = await fetchJson(
        runtime.baseUrl,
        `/api/session/${encodeURIComponent(sessionId)}/task`
      );
      expect(taskAfterCancel.response.status).toBe(404);

      const finalAfterCancel = await fetchJson(
        runtime.baseUrl,
        `/api/session/${encodeURIComponent(sessionId)}/final-results`
      );
      expect(finalAfterCancel.response.status).toBe(404);

      const startButton = page.locator(`button.start-btn[data-complex-id="${fixture.complexId}"]`);
      await expect(startButton).toBeVisible();
      await startButton.click();

      await page.waitForURL(new RegExp("/session/[^/?#]+$"), { timeout: 20000 });
      await waitForPageStable(page);

      const newSessionId = extractSessionIdFromUrl(page.url());
      expect(newSessionId).not.toBe(sessionId);
      await expect(page.locator("#resume-modal")).toBeHidden();

      const freshTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, newSessionId));
      expect(Number(freshTask.queue?.index)).toBe(0);
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
    } finally {
      await run.runtime.dispose();
    }
  });
});
