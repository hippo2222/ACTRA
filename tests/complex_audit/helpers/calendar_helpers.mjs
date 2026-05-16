import { expect } from "@playwright/test";

import { fetchJson } from "./data_seed.mjs";
import { waitForPageStable } from "./base.mjs";

export function findCalendarActivityEntry(activityPayload, minimumAttempts) {
  const items = Array.isArray(activityPayload?.activity)
    ? activityPayload.activity
    : Object.values(activityPayload || {});

  return items.find((entry) => {
    const attempts = Number(entry?.activity_attempts_total ?? entry?.tasks_attempted ?? 0);
    return attempts >= minimumAttempts;
  });
}

export async function readCalendarToday(baseUrl) {
  return fetchJson(baseUrl, "/api/calendar/today");
}

export async function readCalendarActivity(baseUrl, days = 30) {
  return fetchJson(baseUrl, `/api/calendar/activity?days=${encodeURIComponent(days)}`);
}

export async function waitForCalendarPropagation(baseUrl, fixture, options = {}) {
  const { strict = false } = options;

  await expect
    .poll(async () => {
      const today = await readCalendarToday(baseUrl);
      const activity = await readCalendarActivity(baseUrl, 30);
      const todayData = today.data || {};
      const activityData = activity.data || {};
      const matchingActivity = findCalendarActivityEntry(
        activityData,
        fixture.expected.totalTasks
      );

      return {
        todaySuccess: today.response.ok && todayData.success === true,
        activitySuccess: activity.response.ok && activityData.success === true,
        streakDays: Number(todayData?.streak_info?.days || 0),
        activityAttempts: Number(
          matchingActivity?.activity_attempts_total ?? matchingActivity?.tasks_attempted ?? 0
        ),
      };
    }, { timeout: 15000, intervals: [500, 1000] })
    .toMatchObject({
      todaySuccess: true,
      activitySuccess: true,
      activityAttempts: fixture.expected.totalTasks,
      ...(strict ? { streakDays: fixture.expected.streakDaysAfterRun } : {}),
    });
}

export async function openCalendar(page, baseUrl) {
  await page.goto(new URL("/calendar", baseUrl).toString());
  await waitForPageStable(page);
}

export async function assertCalendarShell(page) {
  await expect(page.locator("#streak-badge")).toBeVisible();
  await expect(page.locator("#heatmap .tooltip")).toHaveCount(30);
  await expect(page.locator("#daily-mix-card")).toBeVisible();
}
