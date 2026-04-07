import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { assertApiOk, fetchJson, seedTypeHappyPathFixture } from "./helpers/data_seed.mjs";
import { getSessionScreen } from "./helpers/session_api.mjs";
import { submitCurrentTask } from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const WAVE2_RELOAD_CASES = [
  ["click", 2, "cpw_s1_click_l2_reload_preserves_task_results_state"],
  ["click", 3, "cpw_s1_click_l3_reload_preserves_task_results_state"],
  ["draw", 2, "cpw_s1_draw_l2_reload_preserves_task_results_state"],
  ["test", 2, "cpw_s1_test_l2_reload_preserves_task_results_state"],
  ["sequence_assembly", 3, "cpw_s1_sequence_l3_reload_preserves_task_results_state"],
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
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test.describe("complex audit wave 2 reload", () => {
  for (const [taskType, difficulty, scenarioId] of WAVE2_RELOAD_CASES) {
    test(scenarioId, async ({ page }) => {
      test.setTimeout(180000);

      const run = await createStartedTypeRun(
        page,
        `${scenarioId}_run`,
        taskType,
        difficulty
      );

      try {
        const { fixture, sessionId } = run;

        await performTaskHappyPath(page, fixture);
        const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

        expect(submitResponse.ok()).toBe(true);
        expect(submitJson.ok).toBe(true);
        expect(submitJson.result?.success).toBe(true);

        await expect(page.locator("#result-box")).toBeVisible();
        await expect(page.locator("#next-task-btn")).toBeEnabled();
        await expect(page.locator("#difficulty-label")).toContainText(String(difficulty));

        const snapshotBeforeReload = {
          title: await page.locator("#task-title").textContent(),
          resultTitle: await page.locator("#result-title").textContent(),
          resultMessage: await page.locator("#result-message").textContent(),
        };

        await page.reload();
        await waitForPageStable(page);

        expect(getSessionScreen(page.url(), sessionId)).toBe("s1");
        await expect(page.locator("#result-box")).toBeVisible();
        await expect(page.locator("#next-task-btn")).toBeEnabled();
        await expect(page.locator("#difficulty-label")).toContainText(String(difficulty));
        await expect(page.locator("#status-banner")).toContainText("\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438");
        await expect(page.locator("#task-title")).toHaveText(snapshotBeforeReload.title || "");
        await expect(page.locator("#result-title")).toHaveText(snapshotBeforeReload.resultTitle || "");
        await expect(page.locator("#result-message")).toHaveText(snapshotBeforeReload.resultMessage || "");
      } finally {
        await run.runtime.dispose();
      }
    });
  }
});
