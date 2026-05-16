import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import { extractSessionIdFromUrl, readCurrentTask } from "./helpers/session_api.mjs";
import { startComplexFromList, submitCurrentTask } from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const PAUSED_BADGE_TEXT = "\u041d\u0430 \u043f\u0430\u0443\u0437\u0435";

function compactUiLabel(value, maxLength = 56) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;

  const separatorCount = (text.match(/[_:/-]/g) || []).length;
  const looksMachineLike =
    separatorCount >= 4 || /\b(session|complex|iteration|task)\b/i.test(text);

  if (!looksMachineLike) return text;

  const head = Math.max(18, Math.floor(maxLength * 0.62));
  const tail = Math.max(10, maxLength - head - 1);
  return `${text.slice(0, head)}\u2026${text.slice(-tail)}`;
}

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

async function pauseCurrentRunFromS1(page, sessionId) {
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
}

async function assertResumedPausedSession(page, sessionId, expectedTaskName) {
  await page.waitForURL(new RegExp(`/session/${sessionId}$`), { timeout: 20000 });
  await waitForPageStable(page);

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
    await expect(resumeModal).toBeHidden();
  }

  await expect(page.locator("#task-title")).toContainText(expectedTaskName);
}

test.describe("complex audit wave 2 main entry surfaces", () => {
  test("cpw_cross_main_uses_quick_access_without_next_step_banner", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_main_banner_resume");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);
      await pauseCurrentRunFromS1(page, sessionId);

      await page.goto(new URL("/main", runtime.baseUrl).toString());
      await waitForPageStable(page);

      await expect(page.locator("#mainNextStepBanner")).toHaveCount(0);
      await expect(page.locator("#quick-access-list")).toContainText(
        compactUiLabel(fixture.complexName, 58)
      );
      await expect(page.locator("#quick-access-list")).toContainText(PAUSED_BADGE_TEXT);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_main_quick_access_card_resumes_paused_session", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_main_quick_access_resume");

    try {
      const { runtime, fixture, sessionId } = run;

      await moveSmokeRunToSecondTask(page, sessionId, fixture);
      const currentTaskBeforePause = unwrapTaskPayload(
        await readCurrentTask(runtime.baseUrl, sessionId)
      );

      await pauseCurrentRunFromS1(page, sessionId);

      await page.goto(new URL("/main", runtime.baseUrl).toString());
      await waitForPageStable(page);

      await expect(page.locator("#quick-access-list")).toContainText(
        compactUiLabel(fixture.complexName, 58)
      );
      await expect(page.locator("#quick-access-list")).toContainText(PAUSED_BADGE_TEXT);

      const card = page.locator("#quick-access-list .main-quick-access-card").filter({
        hasText: compactUiLabel(fixture.complexName, 58),
      }).first();
      await expect(card).toBeVisible();
      await card.click();

      await assertResumedPausedSession(page, sessionId, fixture.tasks[1].taskName);

      const restoredTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
      expect(restoredTask.task_id).toBe(currentTaskBeforePause.task_id);
    } finally {
      await run.runtime.dispose();
    }
  });
});
