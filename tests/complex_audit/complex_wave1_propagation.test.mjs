import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId } from "./helpers/base.mjs";
import {
  assertCalendarShell,
  openCalendar,
  waitForCalendarPropagation,
} from "./helpers/calendar_helpers.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import {
  completeFixtureSession,
  startComplexFromList,
} from "./helpers/s1_helpers.mjs";
import {
  assertStatisticsShell,
  openStatistics,
  waitForStatisticsPropagation,
} from "./helpers/statistics_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createCompletedSmokeRun(page, prefix) {
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

    await startComplexFromList(page, {
      baseUrl: runtime.baseUrl,
      complexId: fixture.complexId,
      complexName: fixture.complexName,
    });
    await completeFixtureSession(page, {
      baseUrl: runtime.baseUrl,
      fixture,
    });

    return {
      runtime,
      fixture,
    };
  } catch (error) {
    await runtime.dispose();
    throw error;
  }
}

test.describe("complex audit wave 1 propagation", () => {
  test("cpw_calendar_completion_reflected_after_final_strict", async ({ page }) => {
    test.setTimeout(180000);
    const run = await createCompletedSmokeRun(page, "cpw_prop_calendar");

    try {
      const { runtime, fixture } = run;

      await waitForCalendarPropagation(runtime.baseUrl, fixture, { strict: true });
      await openCalendar(page, runtime.baseUrl);
      await assertCalendarShell(page);
      await expect(page.locator("#streak-badge")).toContainText(
        String(fixture.expected.streakDaysAfterRun)
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_statistics_completion_reflected_after_final_strict", async ({ page }) => {
    test.setTimeout(180000);
    const run = await createCompletedSmokeRun(page, "cpw_prop_statistics");

    try {
      const { runtime, fixture } = run;

      await waitForStatisticsPropagation(runtime.baseUrl, fixture, { strict: true });
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
});
