import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { extractTaskIdentity, readCurrentTask } from "./helpers/session_api.mjs";
import { startComplexFromList } from "./helpers/s1_helpers.mjs";

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

async function countNextRequestsDuring(page, sessionId, action, settleMs = 700) {
  let nextCount = 0;
  const requestListener = (request) => {
    if (
      request.method() === "POST" &&
      request.url().includes(`/api/session/${sessionId}/task/next`)
    ) {
      nextCount += 1;
    }
  };

  page.on("request", requestListener);

  try {
    await action();
    await page.waitForTimeout(settleMs);
    return nextCount;
  } finally {
    page.off("request", requestListener);
  }
}

test.describe("complex audit wave 2 next guard", () => {
  test("cpw_s1_next_without_submit_is_browser_blocked_and_keeps_current_task", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_next_guard");

    try {
      const { runtime, fixture, sessionId } = run;

      const firstTask = await readCurrentTask(runtime.baseUrl, sessionId);
      const firstTaskIdentity = extractTaskIdentity(firstTask);

      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await expect(page.locator("#next-task-btn")).toBeDisabled();
      await expect(page.locator("#result-box")).toBeHidden();

      await page
        .locator("label")
        .filter({ hasText: fixture.tasks[0].chosenAnswerText })
        .first()
        .click();

      await expect(page.locator("#next-task-btn")).toBeDisabled();
      await expect(page.locator("#check-answer-btn")).toBeEnabled();

      const nextRequests = await countNextRequestsDuring(page, sessionId, async () => {
        await page.evaluate(() => {
          const nextButton = document.getElementById("next-task-btn");
          if (!nextButton) {
            throw new Error("next_task_button_missing");
          }
          nextButton.click();
        });
      });

      expect(nextRequests).toBe(0);

      const currentTaskAfterAttempt = await readCurrentTask(runtime.baseUrl, sessionId);
      const currentTaskIdentity = extractTaskIdentity(currentTaskAfterAttempt);

      expect(currentTaskIdentity.taskId).toBe(firstTaskIdentity.taskId);
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await expect(page.locator("#result-box")).toBeHidden();

      const queue = currentTaskAfterAttempt?.task?.queue || currentTaskAfterAttempt?.queue || {};
      expect(Number(queue.index)).toBe(0);
      expect(Number(queue.total)).toBe(fixture.tasks.length);

      await page.reload();
      await waitForPageStable(page);

      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await expect(page.locator("#next-task-btn")).toBeDisabled();
      await expect(page.locator("#result-box")).toBeHidden();
    } finally {
      await run.runtime.dispose();
    }
  });
});
