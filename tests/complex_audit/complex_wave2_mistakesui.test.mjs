import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  attachConsoleTracking,
  attachPageErrorTracking,
  makeRunId,
  waitForPageStable,
} from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedMistakesUIFixture, assertApiOk, fetchJson } from "./helpers/data_seed.mjs";
import {
  getSessionScreen,
  readCurrentTask,
  readFinalResults,
} from "./helpers/session_api.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const MISTAKES_CASES = [
  ["text_errors", "cpw_s1_mistakesui_text_errors_auto_submit_happy_path"],
  ["text_choice", "cpw_s1_mistakesui_text_choice_auto_submit_happy_path"],
];

async function startComplex(page, { baseUrl, complexId }) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(complexId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    "start_complex_session"
  );

  const sessionId = String(payload.session_id || "").trim();
  if (!sessionId) {
    throw new Error("start_complex_session_missing_session_id");
  }

  await page.goto(new URL(`/session/${encodeURIComponent(sessionId)}`, baseUrl).toString());
  await waitForPageStable(page);
  return sessionId;
}

test.describe("complex audit wave 2 MistakesUI", () => {
  for (const [mode, scenarioId] of MISTAKES_CASES) {
    test(scenarioId, async ({ page }, testInfo) => {
      test.setTimeout(180000);

      const runId = makeRunId(`cpw_mistakes_${mode}`);
      const runtime = await createRuntimeHarness({
        projectRoot: PROJECT_ROOT,
        runId,
      });

      const consoleMessages = [];
      const pageErrors = [];
      attachConsoleTracking(page, consoleMessages);
      attachPageErrorTracking(page, pageErrors);

      try {
        const fixture = await seedMistakesUIFixture({
          baseUrl: runtime.baseUrl,
          runId,
          mode,
        });

        const sessionId = await startComplex(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
        });

        await test.step("S1: validate MistakesUI contract", async () => {
          const currentTask = await readCurrentTask(runtime.baseUrl, sessionId);
          const task = currentTask?.task || {};
          const content = task?.task_data?.content || {};
          const rendererContract = await page.evaluate(() => ({
            rawTaskType:
              window.TaskRenderer?.getRawTaskType?.(window.SessionState?.currentTask) || null,
            subtype:
              window.TaskRenderer?.getTaskSubtype?.(window.SessionState?.currentTask) || null,
            hasGlobalSubmit: typeof window.handleSubmitAnswer === "function",
          }));

          expect(rendererContract.rawTaskType).toBe("click");
          expect(rendererContract.subtype).toBe("error_detection");
          expect(rendererContract.hasGlobalSubmit).toBe(true);
          if (mode === "text_choice") {
            expect(Array.isArray(content.options)).toBe(true);
            expect(content.options.length).toBeGreaterThanOrEqual(2);
          } else {
            const spans = Array.isArray(content.error_spans) ? content.error_spans : [];
            expect(spans.length).toBeGreaterThanOrEqual(1);
          }

          await expect(page.locator("#task-title")).not.toHaveText(/^\s*$/);
          if (mode === "text_errors") {
            await expect(page.locator("#task-content")).toContainText("alpha");
            await expect(page.locator("#task-content")).toContainText("beta");
            await expect(page.locator("#task-content")).toContainText("gamma");
          } else {
            await expect(page.locator("#task-content")).toContainText(fixture.tasks[0].questionText);
          }
          await expect(page.locator("#check-answer-btn")).toBeHidden();
          await expect(page.locator("#next-task-btn")).toBeDisabled();
        });

        await test.step("S1: perform MistakesUI action and expect auto-submit", async () => {
          const submitResponsePromise = page.waitForResponse((response) => {
            return (
              response.request().method() === "POST" &&
              response.url().includes(`/api/session/${sessionId}/task/submit`)
            );
          });

          await performTaskHappyPath(page, fixture);

          const submitResponse = await submitResponsePromise;
          const submitJson = await submitResponse.json();

          expect(submitResponse.ok()).toBe(true);
          expect(submitJson.ok).toBe(true);
          expect(submitJson.result?.success).toBe(true);

          await expect(page.locator("#next-task-btn")).toBeEnabled();
          await expect(page.locator("#result-box")).toBeHidden();

          if (mode === "text_errors") {
            await expect(page.locator("#task-content")).toContainText("alpha theta gamma");
          } else {
            await expect(page.locator("#task-content .choice-card.selected")).toHaveCount(1);
            await expect(page.locator("#task-content .choice-card.success")).toHaveCount(1);
          }

          await page.screenshot({
            path: testInfo.outputPath(`${scenarioId}_after_auto_submit.png`),
            fullPage: true,
          });
        });

        await test.step("S3: finish single-task complex and validate final results", async () => {
          const nextResponsePromise = page.waitForResponse((response) => {
            return (
              response.request().method() === "POST" &&
              response.url().includes(`/api/session/${sessionId}/task/next`)
            );
          });
          const navigationPromise = page.waitForURL(
            (url) => getSessionScreen(url.toString(), sessionId) === "s3",
            { timeout: 20000 }
          );

          await page.locator("#next-task-btn").click();

          await Promise.all([nextResponsePromise, navigationPromise]);
          await waitForPageStable(page);

          expect(getSessionScreen(page.url(), sessionId)).toBe("s3");

          const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
          expect(finalResults.session_id).toBe(sessionId);
          expect(finalResults.complex_id).toBe(fixture.complexId);
          expect(Number(finalResults.successful_tasks_count || 0)).toBe(1);
          expect(Number(finalResults.tasks_failed_count || 0)).toBe(0);

          await expect(page.locator("#summary-success-rate")).toContainText("100");
        });

        await test.step("Hygiene: no MistakesUI bootstrap warnings", async () => {
          expect(pageErrors).toEqual([]);
          expect(
            consoleMessages.some((entry) =>
              String(entry?.text || "").includes("handleSubmitAnswer not found")
            )
          ).toBe(false);
        });
      } finally {
        await runtime.dispose();
      }
    });
  }
});
