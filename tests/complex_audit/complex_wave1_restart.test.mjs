import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedTypeHappyPathFixture } from "./helpers/data_seed.mjs";
import { getSessionScreen } from "./helpers/session_api.mjs";
import { startComplexFromList } from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createStartedTypeRun(page, prefix, taskType) {
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
      dataDir: runtime.dataDir,
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

test.describe("complex audit wave 1 restart", () => {
  test("cpw_s1_restart_recovers_active_session_from_same_task", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_restart_s1_draft", "open_answer");

    try {
      const { runtime, fixture, sessionId } = run;
      const draftText = fixture.tasks[0].interaction.answerText;

      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await page.locator("#task-content textarea").fill(draftText);
      await expect(page.locator("#task-content textarea")).toHaveValue(draftText);

      await runtime.restart();

      await page.reload();
      await waitForPageStable(page);

      expect(getSessionScreen(page.url(), sessionId)).toBe("s1");
      await expect(page.locator("#task-title")).toContainText(fixture.tasks[0].taskName);
      await expect(page.locator("#task-content textarea")).toHaveValue(draftText);
      await expect(page.locator("#status-banner")).toContainText("Восстановлен несохраненный ответ");
    } finally {
      await run.runtime.dispose();
    }
  });
});
