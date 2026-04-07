import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { waitForPageStable, makeRunId } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import {
  buildSessionIterationUrl,
  buildSessionResultsUrl,
  getSessionScreen,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  completeFixtureSession,
  startComplexFromList,
  submitCurrentTask,
} from "./helpers/s1_helpers.mjs";
import { openCalendar, assertCalendarShell } from "./helpers/calendar_helpers.mjs";
import { openStatistics, assertStatisticsShell } from "./helpers/statistics_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const UI_SNAPSHOT_ROOT = path.resolve(
  PROJECT_ROOT,
  "reports",
  "complex_passage_playwright_audit",
  "ui_snapshots"
);

async function ensureSnapshotDir(runId) {
  const dir = path.join(UI_SNAPSHOT_ROOT, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

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
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
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
      runId,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
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

async function pauseCurrentSessionFromS1(page, sessionId) {
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

async function captureCompletedSurfaces(page, run, snapshotDir, viewport, filePrefix = "") {
  await page.setViewportSize(viewport);

  await waitForPageStable(page);
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}s1_active_task.png`),
    fullPage: true,
  });

  const flow = await completeFixtureSession(page, {
    baseUrl: run.runtime.baseUrl,
    fixture: run.fixture,
  });

  const terminalScreen = getSessionScreen(page.url(), flow.sessionId);
  const latestIterationResults = await readIterationResults(run.runtime.baseUrl, flow.sessionId).catch(
    () => null
  );
  const targetIteration =
    latestIterationResults?.iteration ||
    flow.finalIterationResults?.iteration ||
    flow.iterationSnapshots.at(-1)?.iteration;

  if (terminalScreen === "s2") {
    await waitForPageStable(page);
    await page.screenshot({
      path: path.join(snapshotDir, `${filePrefix}s2_iteration_results.png`),
      fullPage: true,
    });
  } else if (targetIteration != null) {
    await page.goto(
      buildSessionIterationUrl(
        run.runtime.baseUrl,
        flow.sessionId,
        targetIteration
      )
    );
    await waitForPageStable(page);
    await page.screenshot({
      path: path.join(snapshotDir, `${filePrefix}s2_iteration_results.png`),
      fullPage: true,
    });
  }

  if (getSessionScreen(page.url(), flow.sessionId) !== "s3") {
    if (getSessionScreen(page.url(), flow.sessionId) === "s2") {
      await page.locator("#continue-btn").click();
      await page.waitForURL(buildSessionResultsUrl(run.runtime.baseUrl, flow.sessionId), {
        timeout: 20000,
      });
    } else {
      await page.goto(buildSessionResultsUrl(run.runtime.baseUrl, flow.sessionId));
    }
  }

  await waitForPageStable(page);
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}s3_final_results.png`),
    fullPage: true,
  });

  await openCalendar(page, run.runtime.baseUrl);
  await assertCalendarShell(page);
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}calendar.png`),
    fullPage: true,
  });

  await openStatistics(page, run.runtime.baseUrl);
  await assertStatisticsShell(page, run.fixture);
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}statistics.png`),
    fullPage: true,
  });

  await page.goto(new URL("/ui/main", run.runtime.baseUrl).toString());
  await waitForPageStable(page);
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}main_completed.png`),
    fullPage: true,
  });
}

async function capturePausedMain(page, run, snapshotDir, viewport, filePrefix = "") {
  await page.setViewportSize(viewport);

  await moveSmokeRunToSecondTask(page, run.sessionId, run.fixture);

  await pauseCurrentSessionFromS1(page, run.sessionId);
  await page.waitForURL(new RegExp("/ui/complexes$"), { timeout: 20000 });

  await page.goto(new URL("/ui/main", run.runtime.baseUrl).toString());
  await waitForPageStable(page);
  await expect(page.locator("#mainNextStepBanner")).toHaveCount(0);
  await expect(page.locator("#quick-access-list")).toContainText(
    compactUiLabel(run.fixture.complexName, 58)
  );
  await page.screenshot({
    path: path.join(snapshotDir, `${filePrefix}main_paused.png`),
    fullPage: true,
  });
}

test.describe("complex UI surface snapshots", () => {
  test("cpw_ui_completed_surfaces_capture", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_ui_completed");

    try {
      const snapshotDir = await ensureSnapshotDir(run.runId);
      await captureCompletedSurfaces(
        page,
        run,
        snapshotDir,
        { width: 1440, height: 1400 }
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_ui_main_paused_surface_capture", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_ui_paused");

    try {
      const snapshotDir = await ensureSnapshotDir(run.runId);
      await capturePausedMain(
        page,
        run,
        snapshotDir,
        { width: 1440, height: 1400 }
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_ui_completed_surfaces_capture_mobile", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_ui_completed_mobile");

    try {
      const snapshotDir = await ensureSnapshotDir(run.runId);
      await captureCompletedSurfaces(
        page,
        run,
        snapshotDir,
        { width: 393, height: 1200 },
        "mobile_"
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_ui_main_paused_surface_capture_mobile", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_ui_paused_mobile");

    try {
      const snapshotDir = await ensureSnapshotDir(run.runId);
      await capturePausedMain(
        page,
        run,
        snapshotDir,
        { width: 393, height: 1200 },
        "mobile_"
      );
    } finally {
      await run.runtime.dispose();
    }
  });
});
