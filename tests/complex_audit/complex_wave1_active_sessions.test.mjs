import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import { fetchJson, seedSmokeTestL1Fixture } from "./helpers/data_seed.mjs";
import {
  cancelSession,
  pauseSession,
  readActiveSessions,
} from "./helpers/session_api.mjs";
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

function findSessionRecord(items, sessionId) {
  return (Array.isArray(items) ? items : []).find(
    (item) => String(item?.session_id || "").trim() === sessionId
  ) || null;
}

async function expectActiveSessionState(baseUrl, sessionId, predicate, message) {
  await expect
    .poll(
      async () => {
        const items = await readActiveSessions(baseUrl);
        const record = findSessionRecord(items, sessionId);
        return predicate(record) ? record : null;
      },
      {
        timeout: 10000,
        intervals: [250, 500, 1000],
        message,
      }
    )
    .not.toBeNull();
}

test.describe("complex audit wave 1 active sessions", () => {
  test("cpw_cross_active_sessions_endpoint_shape", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_active_shape");

    try {
      const result = await fetchJson(run.runtime.baseUrl, "/api/sessions/active");

      expect(result.response.ok).toBe(true);
      expect(result.data?.ok).toBe(true);
      expect(Array.isArray(result.data?.items)).toBe(true);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_active_sessions_lists_running_session", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_active_running");

    try {
      const { runtime, fixture, sessionId } = run;

      await expectActiveSessionState(
        runtime.baseUrl,
        sessionId,
        (record) => Boolean(record) && record.paused === false,
        "Running session should be visible in /api/sessions/active."
      );

      const items = await readActiveSessions(runtime.baseUrl);
      const record = findSessionRecord(items, sessionId);

      expect(record).toBeTruthy();
      expect(String(record.complex_id || "")).toBe(fixture.complexId);
      expect(Boolean(record.paused)).toBe(false);
      expect(Boolean(record.is_active)).toBe(true);
      expect(Number(record.iteration)).toBe(1);
      expect(Number(record.total_tasks)).toBe(fixture.tasks.length);
      expect(Number(record.current_task_index)).toBeGreaterThanOrEqual(0);
      expect(Number(record.current_task_index)).toBeLessThanOrEqual(Number(record.total_tasks));
      expect(String(record.updated_at || "")).not.toBe("");
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_active_sessions_lists_paused_session", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_active_paused");

    try {
      const { runtime, sessionId } = run;

      const pauseResult = await pauseSession(runtime.baseUrl, sessionId);
      expect(pauseResult.response.ok).toBe(true);
      expect(pauseResult.data?.ok).toBe(true);
      expect(pauseResult.data?.paused).toBe(true);

      await expectActiveSessionState(
        runtime.baseUrl,
        sessionId,
        (record) => Boolean(record) && record.paused === true,
        "Paused session should remain visible in /api/sessions/active with paused=true."
      );

      const items = await readActiveSessions(runtime.baseUrl);
      const record = findSessionRecord(items, sessionId);

      expect(record).toBeTruthy();
      expect(Boolean(record.paused)).toBe(true);
      expect(String(record.paused_at || "")).not.toBe("");
      expect(Boolean(record.is_active)).toBe(true);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_cross_active_sessions_hides_cancelled_session", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedSmokeRun(page, "cpw_active_cancelled");

    try {
      const { runtime, sessionId } = run;

      await expectActiveSessionState(
        runtime.baseUrl,
        sessionId,
        (record) => Boolean(record),
        "Session should be visible before cancellation."
      );

      const cancelResult = await cancelSession(runtime.baseUrl, sessionId);
      expect(cancelResult.response.ok).toBe(true);
      expect(cancelResult.data?.ok).toBe(true);

      await expect
        .poll(
          async () => {
            const items = await readActiveSessions(runtime.baseUrl);
            return findSessionRecord(items, sessionId);
          },
          {
            timeout: 10000,
            intervals: [250, 500, 1000],
            message: "Cancelled session should disappear from /api/sessions/active.",
          }
        )
        .toBeNull();
    } finally {
      await run.runtime.dispose();
    }
  });
});
