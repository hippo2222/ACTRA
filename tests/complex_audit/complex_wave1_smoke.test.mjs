import path from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";

import {
  attachConsoleTracking,
  attachPageErrorTracking,
  makeRunId,
  waitForPageStable,
} from "./helpers/base.mjs";
import {
  assertCalendarShell,
  findCalendarActivityEntry,
  openCalendar,
  waitForCalendarPropagation,
} from "./helpers/calendar_helpers.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  assertApiOk,
  fetchJson,
  seedSmokeTestL1Fixture,
} from "./helpers/data_seed.mjs";
import {
  buildSessionIterationUrl,
  buildSessionResultsUrl,
  computeSuccessRatePercent,
  getSessionScreen,
  readFinalResults,
} from "./helpers/session_api.mjs";
import {
  completeFixtureSession,
  startComplexFromList,
} from "./helpers/s1_helpers.mjs";
import {
  assertStatisticsShell,
  openStatistics,
  readComplexStatistics,
  readOverallStatistics,
  waitForStatisticsPropagation,
} from "./helpers/statistics_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function readJsonFile(filePath) {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

test.describe("complex audit wave 1 smoke", () => {
  test("cpw_smoke_test_l1_vertical_flow", async ({ page }, testInfo) => {
    test.setTimeout(180000);

    const runId = makeRunId("cpw_smoke_l1");
    const runtime = await createRuntimeHarness({
      projectRoot: PROJECT_ROOT,
      runId,
    });

    const consoleMessages = [];
    const pageErrors = [];
    attachConsoleTracking(page, consoleMessages);
    attachPageErrorTracking(page, pageErrors);

    try {
      const fixture = await seedSmokeTestL1Fixture({
        baseUrl: runtime.baseUrl,
        runId,
      });
      const failedTask = fixture.tasks.find((task) => task.expectedSuccess === false);
      let sessionId = null;
      let submittedTaskIds = [];
      let seenTaskIds = [];
      const expectedTaskIds = fixture.tasks.map((item) => item.taskId).sort();
      let iterationSnapshots = [];
      let finalIterationResults = null;

      await test.step("Complexes: open list and start smoke complex", async () => {
        sessionId = await startComplexFromList(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
          complexName: fixture.complexName,
        });
      });

      await test.step("S1: complete seeded smoke fixture through terminal screen", async () => {
        const flow = await completeFixtureSession(page, {
          baseUrl: runtime.baseUrl,
          fixture,
        });
        sessionId = flow.sessionId;
        submittedTaskIds = flow.submittedTaskIds;
        seenTaskIds = flow.seenTaskIds;
        iterationSnapshots = flow.iterationSnapshots;
        finalIterationResults = flow.finalIterationResults;
      });

      await test.step("S1/S2 coverage: verify submitted task coverage and final iteration state", async () => {
        expect(submittedTaskIds.length).toBe(fixture.tasks.length);
        expect([...seenTaskIds].sort()).toEqual(expectedTaskIds);
        expect(["s2", "s3"]).toContain(getSessionScreen(page.url(), sessionId));
      });

      await test.step("S2: open and validate iteration results", async () => {
        if (!finalIterationResults) {
          const iterationResultsPayload = assertApiOk(
            await fetchJson(runtime.baseUrl, `/api/session/${sessionId}/iteration-results`),
            "iteration_results_final"
          );
          finalIterationResults = iterationResultsPayload.results || {};
        }

        if (getSessionScreen(page.url(), sessionId) !== "s2") {
          await page.goto(
            buildSessionIterationUrl(runtime.baseUrl, sessionId, finalIterationResults.iteration)
          );
          await waitForPageStable(page);
        }

        expect(Number(finalIterationResults.iteration || 0)).toBeGreaterThan(0);
        expect(Number(finalIterationResults.total_tasks || 0)).toBe(fixture.expected.totalTasks);
        expect(Number(finalIterationResults.successful_tasks || 0)).toBe(
          fixture.expected.successfulTasks
        );
        expect(Number(finalIterationResults.failed_tasks || 0)).toBe(
          fixture.expected.failedTasks
        );

        await expect(page.locator("#stat-total-tasks-main")).toHaveText(
          String(fixture.expected.totalTasks)
        );
        await expect(page.locator("#stat-failed-tasks")).toContainText(
          String(fixture.expected.failedTasks)
        );
        await expect(page.locator("#stat-success-rate")).toContainText(
          String(fixture.expected.successRatePercent)
        );
        expect(failedTask).toBeTruthy();
        await expect(page.locator("#trigger-tasks-list")).toContainText(failedTask.taskName);

        await page.screenshot({
          path: testInfo.outputPath("cpw_smoke_s2.png"),
          fullPage: true,
        });
      });

      await test.step("S2 -> S3: open final complex results", async () => {
        if (Boolean(finalIterationResults?.has_next_iteration) === false) {
          await page.locator("#continue-btn").click();
          await page.waitForURL(buildSessionResultsUrl(runtime.baseUrl, sessionId), {
            timeout: 20000,
          });
        } else {
          await page.goto(buildSessionResultsUrl(runtime.baseUrl, sessionId));
        }
        await waitForPageStable(page);
      });

      await test.step("S3: validate final results via UI and API", async () => {
        const results = await readFinalResults(runtime.baseUrl, sessionId);

        expect(results.session_id).toBe(sessionId);
        expect(results.complex_id).toBe(fixture.complexId);
        expect(Number(results.total_iterations || 0)).toBeGreaterThan(0);
        expect(Number(results.total_tasks || 0)).toBe(fixture.expected.totalTasks);
        expect(Number(results.successful_tasks_count || 0)).toBe(
          fixture.expected.successfulTasks
        );
        expect(Number(results.tasks_failed_count || 0)).toBe(fixture.expected.failedTasks);
        expect(Array.isArray(results.iterations)).toBe(true);
        expect(results.iterations.length).toBe(Number(results.total_iterations || 0));
        if (iterationSnapshots.length > 0) {
          expect(Number(results.total_iterations || 0)).toBe(iterationSnapshots.length);
        }

        await expect(page.locator("#summary-iterations")).toContainText(
          String(results.total_iterations)
        );
        await expect(page.locator("#summary-unique-tasks")).toContainText(
          String(fixture.expected.totalTasks)
        );
        await expect(page.locator("#summary-completed-tasks")).toContainText(
          String(fixture.expected.successfulTasks)
        );
        await expect(page.locator("#summary-success-rate")).toContainText(
          String(fixture.expected.successRatePercent)
        );

        await page.screenshot({
          path: testInfo.outputPath("cpw_smoke_s3.png"),
          fullPage: true,
        });
      });

      await test.step("File layer: verify complex statistics and calendar activity snapshots", async () => {
        const complexStatsPath = path.join(
          runtime.dataDir,
          "users",
          fixture.user.userId,
          "complex_statistics.json"
        );
        const calendarActivityPath = path.join(
          runtime.dataDir,
          "user_calendar",
          fixture.user.userId,
          "activity.json"
        );

        await expect
          .poll(async () => {
            const payload = await readJsonFile(complexStatsPath);
            return {
              attempts: Number(payload?.[fixture.complexId]?.aggregated?.attempts || 0),
              wins: Number(payload?.[fixture.complexId]?.aggregated?.wins || 0),
            };
          }, { timeout: 15000, intervals: [500, 1000] })
          .toMatchObject({
            attempts: expect.any(Number),
            wins: expect.any(Number),
          });

        const complexStatsPayload = await readJsonFile(complexStatsPath);
        expect(
          Number(complexStatsPayload?.[fixture.complexId]?.aggregated?.attempts || 0)
        ).toBeGreaterThanOrEqual(fixture.expected.totalTasks);
        expect(
          Number(complexStatsPayload?.[fixture.complexId]?.aggregated?.wins || 0)
        ).toBeGreaterThanOrEqual(fixture.expected.successfulTasks);

        const activityPayload = await readJsonFile(calendarActivityPath);
        const matchingEntry = findCalendarActivityEntry(activityPayload, fixture.expected.totalTasks);

        expect(matchingEntry).toBeTruthy();
      });

      await test.step("Calendar: validate downstream activity propagation", async () => {
        await waitForCalendarPropagation(runtime.baseUrl, fixture);
        await openCalendar(page, runtime.baseUrl);
        await assertCalendarShell(page);
      });

      await test.step("Statistics: validate downstream statistics propagation", async () => {
        await waitForStatisticsPropagation(runtime.baseUrl, fixture);

        const overall = await readOverallStatistics(runtime.baseUrl);
        const complexes = await readComplexStatistics(runtime.baseUrl);

        expect(Number(overall.stats?.total_tasks_attempted || 0)).toBeGreaterThanOrEqual(
          fixture.expected.totalTasks
        );
        expect(
          Number(complexes.complexes?.[fixture.complexId]?.aggregated?.attempts || 0)
        ).toBeGreaterThanOrEqual(fixture.expected.totalTasks);

        await openStatistics(page, runtime.baseUrl);
        await assertStatisticsShell(page, fixture);
      });

      await test.step("Smoke hygiene: no page errors captured", async () => {
        expect(pageErrors).toEqual([]);
      });
    } finally {
      await runtime.dispose();
    }
  });
});
