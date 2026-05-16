import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import {
  assertCalendarShell,
  openCalendar,
  waitForCalendarPropagation,
} from "./helpers/calendar_helpers.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { assertApiOk, fetchJson, seedHighLevelFlowResultsFixture } from "./helpers/data_seed.mjs";
import {
  buildSessionResultsUrl,
  getSessionScreen,
  readCurrentTask,
  readFinalResults,
  readIterationResults,
  tryReadResponseJson,
} from "./helpers/session_api.mjs";
import { ensureHostedBrowserAuth } from "./helpers/runtime_context.mjs";
import {
  assertStatisticsShell,
  openStatistics,
  waitForStatisticsPropagation,
} from "./helpers/statistics_helpers.mjs";
import { submitCurrentTask } from "./helpers/s1_helpers.mjs";
import { answerDrawTask, answerSequenceTask } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const WRONG_POLYGON = [
  [80, 80],
  [92, 80],
  [92, 92],
  [80, 92],
  [80, 80],
];

const CASES = [
  {
    taskType: "click",
    difficulty: 3,
    scenarioId: "cpw_cross_click_l3_propagation_contract",
  },
  {
    taskType: "draw",
    difficulty: 2,
    scenarioId: "cpw_cross_draw_l2_propagation_contract",
  },
  {
    taskType: "sequence_assembly",
    difficulty: 3,
    scenarioId: "cpw_cross_sequence_l3_propagation_contract",
  },
];

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
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

  await ensureHostedBrowserAuth(page, baseUrl);
  await page.goto(new URL(`/session/${encodeURIComponent(sessionId)}`, baseUrl).toString());
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
    const fixture = await seedHighLevelFlowResultsFixture({
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

async function answerTask(page, task, expectedSuccess) {
  if (task.taskType === "click") {
    await answerDrawTask(
      page,
      {
        interaction: {
          points: expectedSuccess ? task.interaction.points : WRONG_POLYGON,
          labelsPolygons: [expectedSuccess ? task.interaction.labelsPolygons[0] : task.wrongLabelText],
        },
      },
      task.taskType
    );
    return;
  }

  if (task.taskType === "draw") {
    await answerDrawTask(
      page,
      {
        interaction: {
          points: expectedSuccess ? task.interaction.points : WRONG_POLYGON,
          labelsPolygons: [expectedSuccess ? task.interaction.labelsPolygons[0] : task.wrongLabelText],
        },
      },
      task.taskType
    );
    return;
  }

  if (task.taskType === "sequence_assembly") {
    await answerSequenceTask(page, {
      interaction: {
        kind: "sequence_l3",
        levels: [
          {
            levelName: task.interaction.levels[0].levelName,
            blockNames: expectedSuccess
              ? task.interaction.levels[0].blockNames
              : [task.interaction.levels[0].blockNames[0]],
          },
        ],
      },
    });
    return;
  }

  throw new Error(`unsupported_propagation_task:${task.taskType}`);
}

async function clickNextToTerminal(page, sessionId) {
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
}

test.describe("complex audit wave 2 propagation", () => {
  for (const testCase of CASES) {
    test(testCase.scenarioId, async ({ page }) => {
      test.setTimeout(180000);

      const run = await createStartedTypeRun(
        page,
        `${testCase.scenarioId}_run`,
        testCase.taskType,
        testCase.difficulty
      );

      try {
        const { runtime, fixture, sessionId } = run;

        for (let index = 0; index < fixture.tasks.length; index += 1) {
          const currentTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));
          const taskFixture = fixture.tasks.find((task) => task.taskId === currentTask.task_id);
          expect(taskFixture).toBeTruthy();

          await answerTask(page, taskFixture, taskFixture.expectedSuccess);

          const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);
          expect(submitResponse.ok()).toBe(true);
          expect(submitJson.ok).toBe(true);
          expect(submitJson.result?.success).toBe(taskFixture.expectedSuccess);

          await expect(page.locator("#next-task-btn")).toBeEnabled();
          await clickNextToTerminal(page, sessionId);
        }

        const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);
        expect(Boolean(iterationResults.has_next_iteration)).toBe(false);

        const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
        expect(Number(finalResults.total_tasks || 0)).toBe(fixture.expected.totalTasks);
        expect(Number(finalResults.successful_tasks_count || 0)).toBe(fixture.expected.successfulTasks);
        expect(Number(finalResults.tasks_failed_count || 0)).toBe(fixture.expected.failedTasks);

        await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
        await waitForPageStable(page);

        await waitForCalendarPropagation(runtime.baseUrl, fixture, { strict: true });
        await waitForStatisticsPropagation(runtime.baseUrl, fixture, { strict: true });

        await openCalendar(page, runtime.baseUrl);
        await assertCalendarShell(page);
        await expect(page.locator("#streak-badge")).toContainText(
          String(fixture.expected.streakDaysAfterRun)
        );

        await openStatistics(page, runtime.baseUrl);
        await assertStatisticsShell(page, fixture);
        await expect(page.locator("#streak-days")).toHaveText(
          String(fixture.expected.streakDaysAfterRun)
        );
        await expect(page.locator("#tasks-mastered")).toHaveText(
          String(fixture.expected.successfulTasks)
        );
      } finally {
        await run.runtime.dispose();
      }
    });
  }
});
