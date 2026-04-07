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
import { countSubmitRequestsDuring, assertBlockedSubmissionState } from "./helpers/s1_helpers.mjs";
import { performTaskPartialAction } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const WAVE2_VALIDATION_CASES = [
  {
    taskType: "click",
    difficulty: 2,
    scenarioId: "cpw_s1_click_l2_submit_blocked_without_label",
    partialMode: "omit_labels",
    expectedStatus: null,
  },
  {
    taskType: "click",
    difficulty: 3,
    scenarioId: "cpw_s1_click_l3_submit_blocked_without_label",
    partialMode: "omit_labels",
    expectedStatus: null,
  },
  {
    taskType: "draw",
    difficulty: 2,
    scenarioId: "cpw_s1_draw_l2_submit_blocked_without_label",
    partialMode: "omit_labels",
    expectedStatus: null,
  },
  {
    taskType: "test",
    difficulty: 2,
    scenarioId: "cpw_s1_test_l2_submit_blocked_when_empty",
    partialMode: null,
    expectedStatus: "\u041e\u0442\u0432\u0435\u0442\u044c\u0442\u0435 \u043d\u0430 \u0432\u0441\u0435 \u0432\u043e\u043f\u0440\u043e\u0441\u044b \u043f\u0435\u0440\u0435\u0434 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u043e\u0439",
  },
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

async function attemptSubmit(page) {
  const checkButton = page.locator("#check-answer-btn");
  if (await checkButton.isDisabled().catch(() => false)) {
    await checkButton.dispatchEvent("pointerdown");
    return;
  }
  await checkButton.click();
}

test.describe("complex audit wave 2 validation", () => {
  for (const testCase of WAVE2_VALIDATION_CASES) {
    test(testCase.scenarioId, async ({ page }) => {
      test.setTimeout(180000);

      const consoleMessages = [];
      const pageErrors = [];
      attachConsoleTracking(page, consoleMessages);
      attachPageErrorTracking(page, pageErrors);

      const run = await createStartedTypeRun(
        page,
        `${testCase.scenarioId}_run`,
        testCase.taskType,
        testCase.difficulty
      );

      try {
        const { fixture, sessionId } = run;

        if (testCase.partialMode === "omit_labels") {
          await performTaskPartialAction(page, fixture, testCase.partialMode);
          await expect(page.locator("#task-content img").first()).toBeVisible();
        } else if (testCase.taskType === "test") {
          await expect(
            page.locator('#task-content textarea, #task-content input[type="text"], #task-content label').first()
          ).toBeVisible();
        }

        const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
          await attemptSubmit(page);
        });

        expect(submitCount).toBe(0);
        await assertBlockedSubmissionState(page, testCase.expectedStatus);
        if (testCase.taskType === "test") {
          await expect(page.locator("#check-answer-btn")).toContainText("Всё равно проверить");
        }
        expect(pageErrors).toEqual([]);
      } finally {
        await run.runtime.dispose();
      }
    });
  }
});
