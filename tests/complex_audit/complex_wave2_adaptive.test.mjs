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
import { seedAdaptiveTypeFixture } from "./helpers/data_seed.mjs";
import {
  buildSessionResultsUrl,
  getSessionScreen,
  readCurrentTask,
  readFinalResults,
  readIterationResults,
} from "./helpers/session_api.mjs";
import {
  assertStatisticsShell,
  openStatistics,
  waitForStatisticsPropagation,
} from "./helpers/statistics_helpers.mjs";
import { startComplexFromList, submitCurrentTask } from "./helpers/s1_helpers.mjs";
import {
  answerClickTask,
  answerDrawTask,
  answerSequenceTask,
} from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

const CASES = [
  {
    taskType: "click",
    scenarioId: "cpw_cross_click_adaptive_progression_downstream_contract",
  },
  {
    taskType: "draw",
    scenarioId: "cpw_cross_draw_adaptive_progression_downstream_contract",
  },
  {
    taskType: "sequence_assembly",
    scenarioId: "cpw_cross_sequence_adaptive_progression_downstream_contract",
  },
];

function unwrapTaskPayload(payload) {
  return payload?.task || payload || {};
}

async function createStartedAdaptiveTypeRun(page, prefix, taskType) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedAdaptiveTypeFixture({
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

async function answerAdaptiveTaskByLevel(page, fixture, level) {
  const task = Array.isArray(fixture.tasks) ? fixture.tasks[0] : null;
  if (!task) {
    throw new Error("adaptive_fixture_missing_task");
  }

  const progression = Array.isArray(task.progression) ? task.progression : [];
  const levelPayload = progression.find((item) => Number(item.level) === Number(level));
  if (!levelPayload) {
    throw new Error(`adaptive_level_payload_missing:${fixture.taskType}:L${level}`);
  }

  if (fixture.taskType === "click") {
    if (levelPayload.interaction.kind === "draw_and_label") {
      await answerDrawTask(page, { interaction: levelPayload.interaction }, "click");
      return;
    }
    await answerClickTask(page, { interaction: levelPayload.interaction });
    return;
  }

  if (fixture.taskType === "draw") {
    await answerDrawTask(page, { interaction: levelPayload.interaction }, "draw");
    return;
  }

  if (fixture.taskType === "sequence_assembly") {
    await answerSequenceTask(page, { interaction: levelPayload.interaction });
    return;
  }

  throw new Error(`unsupported_adaptive_task_type:${fixture.taskType}`);
}

async function clickNextToIterationOrFinal(page, sessionId) {
  const nextResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/next`)
    );
  });

  await page.locator("#next-task-btn").click();
  await nextResponsePromise;

  await page.waitForURL(
    (url) => {
      const nextScreen = getSessionScreen(url.toString(), sessionId);
      return nextScreen === "s2" || nextScreen === "s3";
    },
    { timeout: 20000 }
  );
  await waitForPageStable(page);
}

test.describe("complex audit wave 2 adaptive progression", () => {
  for (const testCase of CASES) {
    test(testCase.scenarioId, async ({ page }) => {
      test.setTimeout(240000);

      const run = await createStartedAdaptiveTypeRun(
        page,
        `${testCase.scenarioId}_run`,
        testCase.taskType
      );

      try {
        const { runtime, fixture, sessionId } = run;
        const progression = fixture.expected.progression || [];

        for (let index = 0; index < progression.length; index += 1) {
          const expectedLevel = Number(progression[index]);
          const currentTask = unwrapTaskPayload(await readCurrentTask(runtime.baseUrl, sessionId));

          expect(Number(currentTask.iteration)).toBe(index + 1);
          expect(Number(currentTask.difficulty)).toBe(expectedLevel);
          await expect(page.locator("#difficulty-label")).toContainText(String(expectedLevel));

          await answerAdaptiveTaskByLevel(page, fixture, expectedLevel);

          const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);
          expect(submitResponse.ok()).toBe(true);
          expect(submitJson.ok).toBe(true);
          expect(submitJson.result?.success).toBe(true);
          await expect(page.locator("#next-task-btn")).toBeEnabled();

          await clickNextToIterationOrFinal(page, sessionId);

          const screenAfterNext = getSessionScreen(page.url(), sessionId);
          expect(["s2", "s3"]).toContain(screenAfterNext);

          if (screenAfterNext === "s2") {
            const iterationResults = await readIterationResults(runtime.baseUrl, sessionId);
            expect(Number(iterationResults.iteration)).toBe(index + 1);
            expect(Number(iterationResults.total_tasks || 0)).toBe(1);
            expect(Number(iterationResults.successful_tasks || 0)).toBe(1);
            expect(Number(iterationResults.failed_tasks || 0)).toBe(0);

            await expect(page.locator("#stat-total-tasks-main")).toContainText("1");
            await expect(page.locator("#stat-success-rate")).toContainText("100");
            await expect(page.locator("#stat-difficulty")).toContainText(String(expectedLevel));

            if (index < progression.length - 1) {
              expect(Boolean(iterationResults.has_next_iteration)).toBe(true);
              await page.locator("#continue-btn").click();
              await page.waitForURL(
                (url) => getSessionScreen(url.toString(), sessionId) === "s1",
                { timeout: 20000 }
              );
              await waitForPageStable(page);
            } else {
              expect(Boolean(iterationResults.has_next_iteration)).toBe(false);
              await page.locator("#continue-btn").click();
              await page.waitForURL(buildSessionResultsUrl(runtime.baseUrl, sessionId), {
                timeout: 20000,
              });
              await waitForPageStable(page);
            }
          } else {
            expect(index).toBe(progression.length - 1);
          }
        }

        if (getSessionScreen(page.url(), sessionId) !== "s3") {
          await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
          await waitForPageStable(page);
        }

        const finalResults = await readFinalResults(runtime.baseUrl, sessionId);
        expect(Number(finalResults.total_iterations || 0)).toBe(fixture.expected.iterations);
        expect(Number(finalResults.total_tasks || 0)).toBe(fixture.expected.totalTasks);
        expect(Number(finalResults.successful_tasks_count || 0)).toBe(fixture.expected.successfulTasks);
        expect(Number(finalResults.tasks_failed_count || 0)).toBe(fixture.expected.failedTasks);
        expect(Number(finalResults.tasks_mastered_count || 0)).toBe(
          fixture.expected.uniqueTasksMastered
        );
        expect(Array.isArray(finalResults.iterations)).toBe(true);
        expect(finalResults.iterations.length).toBe(fixture.expected.iterations);

        await expect(page.locator("#summary-iterations")).toContainText(String(fixture.expected.iterations));
        await expect(page.locator("#summary-completed-tasks")).toContainText(
          String(fixture.expected.successfulTasks)
        );
        await expect(page.locator("#summary-success-rate")).toContainText(
          String(fixture.expected.successRatePercent)
        );
        await expect(page.locator("#iterations-grid").locator(":scope > *")).toHaveCount(
          fixture.expected.iterations
        );

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
          String(fixture.expected.uniqueTasksMastered)
        );
      } finally {
        await run.runtime.dispose();
      }
    });
  }
});
