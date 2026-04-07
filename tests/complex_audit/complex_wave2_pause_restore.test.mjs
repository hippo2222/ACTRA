import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { assertApiOk, fetchJson, seedTypeHappyPathFixture } from "./helpers/data_seed.mjs";
import { getSessionScreen, readCurrentTask } from "./helpers/session_api.mjs";
import { startComplexFromList, submitCurrentTask } from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

function polygonCentroid(points) {
  const safePoints = Array.isArray(points) ? points : [];
  if (!safePoints.length) return [0, 0];
  const total = safePoints.reduce(
    (acc, point) => {
      acc.x += Number(point?.[0] || 0);
      acc.y += Number(point?.[1] || 0);
      return acc;
    },
    { x: 0, y: 0 }
  );
  return [total.x / safePoints.length, total.y / safePoints.length];
}

async function getTaskImageMetrics(imageLocator) {
  await expect(imageLocator).toBeVisible();
  const box = await imageLocator.boundingBox();
  if (!box) {
    throw new Error("task_image_bounding_box_missing");
  }
  const metrics = await imageLocator.evaluate((img) => ({
    naturalWidth: Number(img.naturalWidth || 0),
    naturalHeight: Number(img.naturalHeight || 0),
  }));
  return {
    box,
    naturalWidth: metrics.naturalWidth || box.width,
    naturalHeight: metrics.naturalHeight || box.height,
  };
}

function toClientPoint(metrics, point) {
  const [x, y] = point;
  return {
    x: metrics.box.x + (Number(x) / metrics.naturalWidth) * metrics.box.width,
    y: metrics.box.y + (Number(y) / metrics.naturalHeight) * metrics.box.height,
  };
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

  await page.goto(new URL(`/ui/session/${encodeURIComponent(sessionId)}`, baseUrl).toString());
  await waitForPageStable(page);
  return sessionId;
}

async function createStartedTypeRun(page, prefix, taskType, difficulty) {
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
      difficulty,
      dataDir: runtime.dataDir,
    });
    const sessionId = await startComplexAtIteration(page, {
      baseUrl: runtime.baseUrl,
      complexId: fixture.complexId,
      startIteration: difficulty,
    });

    return {
      runtime,
      fixture,
      sessionId,
      sessionUrl: new URL(`/ui/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString(),
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test("cpw_s1_click_pause_resume_preserves_checked_state_and_marks", async ({ page }) => {
  test.setTimeout(180000);

  const run = await createStartedTypeRun(page, "cpw_s1_click_pause_restore", "click", 2);

  try {
    const { fixture, sessionId, sessionUrl } = run;

    await performTaskHappyPath(page, fixture);
    const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

    expect(submitResponse.ok()).toBe(true);
    expect(submitJson.ok).toBe(true);
    expect(page.url()).toContain(`/ui/session/${sessionId}`);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#next-task-btn")).toBeEnabled();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator('[data-clickui="ref-toggles"]')).toBeVisible();
    await expect(page.locator('[data-clickui="user-marks"]')).toBeChecked();

    const resultTitle = (await page.locator("#result-title").textContent()) || "";
    const resultMessage = (await page.locator("#result-message").textContent()) || "";
    const markerCountBeforePause = await page.locator(".clickui-marker-entry").count();
    const firstInput = page.locator('.clickui-card-entry input[type="text"]').first();
    const inputValueBeforePause = await firstInput.inputValue();
    const inputDisabledBeforePause = await firstInput.isDisabled();

    expect(markerCountBeforePause).toBeGreaterThan(0);
    expect(inputDisabledBeforePause).toBe(true);

    await page.locator("#back-to-complexes-btn").click();
    await expect(page.locator("#pause-confirm-modal")).toBeVisible();
    await page.locator("#pause-confirm-submit").click();
    await page.waitForURL(/\/ui\/complexes$/);
    await waitForPageStable(page);

    await page.goto(sessionUrl);
    await waitForPageStable(page);
    await expect(page.locator("#resume-modal")).toBeVisible();
    await page.locator("#resume-continue-btn").click();
    await expect(page.locator("#resume-modal")).toBeHidden();
    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#next-task-btn")).toBeEnabled();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator('[data-clickui="ref-toggles"]')).toBeVisible();
    await expect(page.locator('[data-clickui="user-marks"]')).toBeChecked();
    await expect(page.locator("#status-banner")).toContainText("Восстановлен результат проверки");

    expect(getSessionScreen(page.url(), sessionId)).toBe("s1");
    await expect(page.locator("#result-title")).toHaveText(resultTitle);
    await expect(page.locator("#result-message")).toHaveText(resultMessage);
    await expect.poll(async () => page.locator(".clickui-marker-entry").count()).toBe(markerCountBeforePause);
    await expect(page.locator('.clickui-card-entry input[type="text"]').first()).toHaveValue(inputValueBeforePause);
    await expect(page.locator('.clickui-card-entry input[type="text"]').first()).toBeDisabled();
  } finally {
    await run.runtime.dispose();
  }
});

test("cpw_s1_click_continue_from_complexes_preserves_checked_state_and_marks", async ({ page }) => {
  test.setTimeout(180000);

  const run = await createStartedTypeRun(page, "cpw_s1_click_continue_from_complexes", "click", 2);

  try {
    const { fixture, sessionId } = run;

    await performTaskHappyPath(page, fixture);
    const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

    expect(submitResponse.ok()).toBe(true);
    expect(submitJson.ok).toBe(true);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator('[data-clickui="ref-toggles"]')).toBeVisible();

    const resultTitle = (await page.locator("#result-title").textContent()) || "";
    const resultMessage = (await page.locator("#result-message").textContent()) || "";
    const markerCountBeforePause = await page.locator(".clickui-marker-entry").count();

    await page.locator("#back-to-complexes-btn").click();
    await expect(page.locator("#pause-confirm-modal")).toBeVisible();
    await page.locator("#pause-confirm-submit").click();
    await page.waitForURL(/\/ui\/complexes$/);
    await waitForPageStable(page);

    const continueButton = page.locator(`button.start-btn[data-complex-id="${fixture.complexId}"]`).first();
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toContainText("Продолжить");
    await continueButton.click();

    await page.waitForURL(new RegExp(`/ui/session/${sessionId}$`));
    await waitForPageStable(page);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator('[data-clickui="ref-toggles"]')).toBeVisible();
    await expect(page.locator('[data-clickui="user-marks"]')).toBeChecked();
    await expect(page.locator('[data-clickui="targets-progress"]')).toContainText("Прогресс поиска");

    await expect(page.locator("#result-title")).toHaveText(resultTitle);
    await expect(page.locator("#result-message")).toHaveText(resultMessage);
    await expect.poll(async () => page.locator(".clickui-marker-entry").count()).toBe(markerCountBeforePause);
  } finally {
    await run.runtime.dispose();
  }
});

test("cpw_s1_click_l1_continue_from_complexes_preserves_checked_state", async ({ page }) => {
  test.setTimeout(180000);

  const run = await createStartedTypeRun(page, "cpw_s1_click_l1_continue_from_complexes", "click", 1);

  try {
    const { fixture, sessionId } = run;

    await performTaskHappyPath(page, fixture);
    const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

    expect(submitResponse.ok()).toBe(true);
    expect(submitJson.ok).toBe(true);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();

    const resultTitle = (await page.locator("#result-title").textContent()) || "";
    const resultMessage = (await page.locator("#result-message").textContent()) || "";
    const markerCountBeforePause = await page.locator(".clickui-marker-entry").count();

    await page.locator("#back-to-complexes-btn").click();
    await expect(page.locator("#pause-confirm-modal")).toBeVisible();
    await page.locator("#pause-confirm-submit").click();
    await page.waitForURL(/\/ui\/complexes$/);
    await waitForPageStable(page);

    const continueButton = page.locator(`button.start-btn[data-complex-id="${fixture.complexId}"]`).first();
    await expect(continueButton).toBeVisible();
    await continueButton.click();

    await page.waitForURL(new RegExp(`/ui/session/${sessionId}$`));
    await waitForPageStable(page);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator("#result-title")).toHaveText(resultTitle);
    await expect(page.locator("#result-message")).toHaveText(resultMessage);
    await expect.poll(async () => page.locator(".clickui-marker-entry").count()).toBe(markerCountBeforePause);
  } finally {
    await run.runtime.dispose();
  }
});

test("cpw_s1_real_click_continue_from_complexes_preserves_checked_state", async ({ page }) => {
  test.setTimeout(180000);

  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId: makeRunId("cpw_s1_real_click_continue_from_complexes"),
  });

  try {
    const complexId = "cf05238b-1bf1-4e05-b581-cbc1bed5f9e1";
    const complexName = "Комплекс Все Типы Заданий";
    const sessionId = await startComplexFromList(page, {
      baseUrl: runtime.baseUrl,
      complexId,
      complexName,
    });

    const currentTaskPayload = await readCurrentTask(runtime.baseUrl, sessionId);
    const task = currentTaskPayload?.task || {};
    const targets = Array.isArray(task.answer_key?.targets) ? task.answer_key.targets : [];
    const firstTarget = targets[0] || {};
    const points = Array.isArray(firstTarget.points) ? firstTarget.points : [];

    expect(String(task.task_type || task.task_data?.type || "")).toBe("click");
    expect(points.length).toBeGreaterThanOrEqual(3);

    const image = page.locator("#task-content img").first();
    const metrics = await getTaskImageMetrics(image);
    const clientPoint = toClientPoint(metrics, polygonCentroid(points));
    await page.mouse.click(clientPoint.x, clientPoint.y);

    const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);
    expect(submitResponse.ok()).toBe(true);
    expect(submitJson.ok).toBe(true);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();

    const resultTitle = (await page.locator("#result-title").textContent()) || "";
    const resultMessage = (await page.locator("#result-message").textContent()) || "";
    const markerCountBeforePause = await page.locator(".clickui-marker-entry").count();

    await page.locator("#back-to-complexes-btn").click();
    await expect(page.locator("#pause-confirm-modal")).toBeVisible();
    await page.locator("#pause-confirm-submit").click();
    await page.waitForURL(/\/ui\/complexes$/);
    await waitForPageStable(page);

    const continueButton = page.locator(`button.start-btn[data-complex-id="${complexId}"]`).first();
    await expect(continueButton).toBeVisible();
    await expect(continueButton).toContainText("Продолжить");
    await continueButton.click();

    await page.waitForURL(new RegExp(`/ui/session/${sessionId}$`));
    await waitForPageStable(page);

    await expect(page.locator("#result-box")).toBeVisible();
    await expect(page.locator("#check-answer-btn")).toBeDisabled();
    await expect(page.locator("#result-title")).toHaveText(resultTitle);
    await expect(page.locator("#result-message")).toHaveText(resultMessage);
    await expect.poll(async () => page.locator(".clickui-marker-entry").count()).toBe(markerCountBeforePause);
  } finally {
    await runtime.dispose();
  }
});
