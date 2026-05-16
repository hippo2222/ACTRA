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
import { assertApiOk, fetchJson, seedTypeHappyPathFixture } from "./helpers/data_seed.mjs";
import {
  getSessionScreen,
  readCurrentTask,
  readFinalResults,
  readIterationResults,
  tryReadResponseJson,
} from "./helpers/session_api.mjs";
import { ensureHostedBrowserAuth } from "./helpers/runtime_context.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const WAVE2_CASES = [
  ["click", 2, "cpw_s1_click_l2_happy_path"],
  ["click", 3, "cpw_s1_click_l3_happy_path"],
  ["draw", 2, "cpw_s1_draw_l2_happy_path"],
  ["test", 2, "cpw_s1_test_l2_happy_path"],
  ["sequence_assembly", 2, "cpw_s1_sequence_l2_happy_path"],
  ["sequence_assembly", 3, "cpw_s1_sequence_l3_happy_path"],
];


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

test.describe("complex audit wave 2 task levels", () => {
  for (const [taskType, difficulty, scenarioId] of WAVE2_CASES) {
    test(scenarioId, async ({ page }, testInfo) => {
      test.setTimeout(180000);

      const runId = makeRunId(`cpw_type_${taskType}_l${difficulty}`);
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
          difficulty,
          dataDir: runtime.dataDir,
        });

        const sessionId = await startComplexAtIteration(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
          startIteration: difficulty,
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
          const promptText = String(
            content.prompt || content.question || content.questions?.[0]?.text || ""
          );
          expect(promptText).toContain(fixture.tasks[0].questionText);
          expect(rendererContract.rawTaskType).toBe(taskType);
          await expect(page.locator("#difficulty-label")).toContainText(String(difficulty));

          if (taskType === "test") {
            expect(rendererContract.effectiveTaskType).toBe("test");
            await expect(
              page.locator('#task-content textarea, #task-content input[type="text"]').first()
            ).toBeVisible();
            return;
          }

          if (taskType === "sequence_assembly") {
            expect(rendererContract.effectiveTaskType).toBe("sequence_assembly");
            if (difficulty === 3) {
              await expect(
                page.getByRole("button", {
                  name: /Создать уровень/i,
                }).first()
              ).toBeVisible();
            } else {
              await expect(page.locator("#task-content")).toContainText("Collect baseline image");
              await expect(page.locator("#task-content")).toContainText("Verify target zone");
            }
            return;
          }

          const expectedEffectiveType =
            taskType === "draw"
              ? rendererContract.featureFlags?.drawViaClickUI === false
                ? "draw"
                : "click"
              : taskType;
          expect(rendererContract.effectiveTaskType).toBe(expectedEffectiveType);
          await expect(page.locator("#task-content img").first()).toBeVisible();
        });

        await test.step("S1: perform happy-path user action", async () => {
          await performTaskHappyPath(page, fixture);
          await page.screenshot({
            path: testInfo.outputPath(`cpw_${taskType}_l${difficulty}_before_submit.png`),
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
            return;
          }

          const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
          expect(finalResults.session_id).toBe(sessionId);
          expect(finalResults.complex_id).toBe(fixture.complexId);
          expect(Number(finalResults.successful_tasks_count || 0)).toBeGreaterThanOrEqual(1);
          expect(Number(finalResults.tasks_failed_count || 0)).toBe(0);
          await expect(page.locator("#summary-success-rate")).toContainText("100");
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
