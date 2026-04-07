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
import { seedTypeHappyPathFixture } from "./helpers/data_seed.mjs";
import {
  getSessionScreen,
  readCurrentTask,
  readFinalResults,
  readIterationResults,
  tryReadResponseJson,
} from "./helpers/session_api.mjs";
import { startComplexFromList } from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const HAPPY_PATH_TYPES = [
  ["click", "cpw_s1_click_l1_happy_path"],
  ["draw", "cpw_s1_draw_l1_happy_path"],
  ["sequence_assembly", "cpw_s1_sequence_l1_happy_path"],
  ["open_answer", "cpw_s1_open_answer_l1_happy_path"],
];

test.describe("complex audit wave 1 task types", () => {
  for (const [taskType, scenarioId] of HAPPY_PATH_TYPES) {
    test(scenarioId, async ({ page }, testInfo) => {
      test.setTimeout(180000);

      if (taskType === "draw") {
        await page.addInitScript(() => {
          window.RP_FEATURES = {
            ...(window.RP_FEATURES || {}),
            drawViaClickUI: false,
          };
        });
      }

      const runId = makeRunId(`cpw_type_${taskType}`);
      const runtime = await createRuntimeHarness({
        projectRoot: PROJECT_ROOT,
        runId,
      });

      const consoleMessages = [];
      const pageErrors = [];
      attachConsoleTracking(page, consoleMessages);
      attachPageErrorTracking(page, pageErrors);

      try {
        const fixture = await seedTypeHappyPathFixture({
          baseUrl: runtime.baseUrl,
          runId,
          taskType,
          dataDir: runtime.dataDir,
        });

        const sessionId = await startComplexFromList(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
          complexName: fixture.complexName,
        });

        await test.step("S1: validate current task contract", async () => {
          const currentTask = await readCurrentTask(runtime.baseUrl, sessionId);
          const taskData = currentTask?.task?.task_data || currentTask?.task_data || {};
          const content = taskData.content || taskData || {};
          const rendererContract = await page.evaluate(() => ({
            rawTaskType:
              window.TaskRenderer?.getRawTaskType?.(window.SessionState?.currentTask) || null,
            effectiveTaskType: window.TaskRenderer?.getCurrentEffectiveTaskType?.() || null,
            featureFlags: window.FeatureConfig?.getFeatureFlags?.() || window.RP_FEATURES || null,
          }));

          await expect(page.locator("#task-title")).not.toHaveText(/^\s*$/);
          expect(
            String(content.prompt || content.question || "").trim()
          ).toContain(fixture.tasks[0].questionText);
          expect(rendererContract.rawTaskType).toBe(taskType);

          if (taskType === "open_answer") {
            expect(rendererContract.effectiveTaskType).toBe("open_answer");
            await expect(page.locator("#task-content textarea")).toBeVisible();
            await expect(page.locator("#task-content")).toContainText(fixture.tasks[0].questionText);
          } else if (taskType === "sequence_assembly") {
            expect(rendererContract.effectiveTaskType).toBe("sequence_assembly");
            await expect(page.locator("#task-content")).toContainText("Collect baseline image");
            await expect(page.locator("#task-content")).toContainText("Verify target zone");
          } else {
            const expectedEffectiveType = taskType === "draw" ? "draw" : taskType;
            expect(rendererContract.effectiveTaskType).toBe(expectedEffectiveType);
            expect(String(content.image || "")).not.toBe("");
            await expect(page.locator("#task-content img").first()).toBeVisible();
            await expect
              .poll(async () => {
                return page.locator("#task-content img").first().evaluate((img) => ({
                  complete: Boolean(img.complete),
                  naturalWidth: Number(img.naturalWidth || 0),
                  naturalHeight: Number(img.naturalHeight || 0),
                }));
              })
              .toMatchObject({
                complete: true,
                naturalWidth: expect.any(Number),
                naturalHeight: expect.any(Number),
              });
            const imageMetrics = await page
              .locator("#task-content img")
              .first()
              .evaluate((img) => ({
                src: img.currentSrc || img.src || "",
                naturalWidth: Number(img.naturalWidth || 0),
                naturalHeight: Number(img.naturalHeight || 0),
              }));
            expect(imageMetrics.src).not.toBe("");
            expect(imageMetrics.naturalWidth).toBeGreaterThan(0);
            expect(imageMetrics.naturalHeight).toBeGreaterThan(0);
          }
        });

        await test.step("S1: perform happy-path user action", async () => {
          await performTaskHappyPath(page, fixture);
          await page.screenshot({
            path: testInfo.outputPath(`cpw_${taskType}_before_submit.png`),
            fullPage: true,
          });
        });

        await test.step("S1: submit answer and validate success result", async () => {
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
          expect(submitJson.result?.success).toBe(true);

          await expect(page.locator("#result-box")).toBeVisible();
          await expect(page.locator("#result-title")).not.toHaveText(/^\s*$/);
          await expect(page.locator("#next-task-btn")).toBeEnabled();
        });

        await test.step("Session end: move to terminal screen", async () => {
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
          }

          await waitForPageStable(page);
          expect(["s2", "s3"]).toContain(getSessionScreen(page.url(), sessionId));
        });

        await test.step("Terminal screen: validate success contract", async () => {
          const screen = getSessionScreen(page.url(), sessionId);

          if (screen === "s2") {
            const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);

            expect(Number(iterationResults.successful_tasks || 0)).toBeGreaterThanOrEqual(1);
            expect(Number(iterationResults.failed_tasks || 0)).toBe(0);
            await expect(page.locator("#stat-success-rate")).toContainText("100");
            await expect(page.locator("#continue-btn")).toBeVisible();
            return;
          }

          if (screen === "s3") {
            const finalResults = await readFinalResults(runtime.baseUrl, sessionId);

            expect(finalResults.session_id).toBe(sessionId);
            expect(finalResults.complex_id).toBe(fixture.complexId);
            expect(Number(finalResults.successful_tasks_count || 0)).toBeGreaterThanOrEqual(1);
            expect(Number(finalResults.tasks_failed_count || 0)).toBe(0);

            await expect(page.locator("#summary-success-rate")).toContainText("100");
            return;
          }

          throw new Error(`unexpected_terminal_screen:${screen}:${page.url()}`);
        });

        await test.step("Hygiene: no page errors", async () => {
          expect(pageErrors).toEqual([]);
        });
      } finally {
        await runtime.dispose();
      }
    });
  }
});
