import { expect } from "@playwright/test";

import { assertApiOk, fetchJson } from "./data_seed.mjs";
import { waitForPageStable } from "./base.mjs";

function compactUiLabel(value, maxLength = 56) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;

  const separatorCount = (text.match(/[_:/-]/g) || []).length;
  const looksMachineLike =
    separatorCount >= 4 || /\b(session|complex|iteration|task)\b/i.test(text);

  if (!looksMachineLike) return text;

  const head = Math.max(18, Math.floor(maxLength * 0.62));
  const tail = Math.max(10, maxLength - head - 1);
  return `${text.slice(0, head)}…${text.slice(-tail)}`;
}

export async function readOverallStatistics(baseUrl) {
  return assertApiOk(await fetchJson(baseUrl, "/api/statistics/overall"), "statistics_overall");
}

export async function readComplexStatistics(baseUrl) {
  return assertApiOk(
    await fetchJson(baseUrl, "/api/statistics/complexes"),
    "statistics_complexes"
  );
}

export async function waitForStatisticsPropagation(baseUrl, fixture, options = {}) {
  const { strict = false } = options;

  await expect
    .poll(async () => {
      const overall = await readOverallStatistics(baseUrl);
      const complexes = await readComplexStatistics(baseUrl);
      const complexStats = complexes.complexes?.[fixture.complexId]?.aggregated || {};

      return {
        totalTasksAttempted: Number(overall.stats?.total_tasks_attempted || 0),
        activityStreakDays: Number(
          overall.stats?.activity_streak_days ?? overall.stats?.streak_days ?? 0
        ),
        complexAttempts: Number(complexStats.attempts || 0),
        complexWins: Number(complexStats.wins || 0),
      };
    }, { timeout: 15000, intervals: [500, 1000] })
    .toMatchObject({
      ...(strict
        ? {
            totalTasksAttempted: fixture.expected.totalTasks,
            activityStreakDays: fixture.expected.streakDaysAfterRun,
            complexAttempts: fixture.expected.totalTasks,
            complexWins: fixture.expected.successfulTasks,
          }
        : {
            totalTasksAttempted: expect.any(Number),
            complexAttempts: expect.any(Number),
          }),
    });
}

export async function openStatistics(page, baseUrl) {
  await page.goto(new URL("/ui/statistics", baseUrl).toString());
  await waitForPageStable(page);
}

export async function assertStatisticsShell(page, fixture) {
  await expect(page.locator("#streak-days")).toBeVisible();
  await expect(page.locator("#complexes-grid")).toContainText(
    compactUiLabel(fixture.complexName, 60)
  );
  await expect(page.locator("#tasks-mastered")).toBeVisible();
}
