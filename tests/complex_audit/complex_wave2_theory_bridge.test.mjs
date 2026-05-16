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
import { assertApiOk, fetchJson, seedTheoryBridgeFixture } from "./helpers/data_seed.mjs";
import { getSessionScreen } from "./helpers/session_api.mjs";
import { submitCurrentTask } from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function startComplex(page, { baseUrl, complexId }) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(complexId)}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
    "start_complex_session"
  );

  const sessionId = String(payload.session_id || "").trim();
  if (!sessionId) {
    throw new Error("start_complex_session_missing_session_id");
  }

  return sessionId;
}

async function setTheoryBridgeStorage(page, { baseUrl, sessionId, theoryId, theoryTitle, complexId, returnUrl }) {
  await page.goto(new URL("/main", baseUrl).toString());
  await page.evaluate(
    ({ key, payload }) => {
      window.sessionStorage.setItem(key, JSON.stringify(payload));
    },
    {
      key: `theory_training_bridge_v1:${String(sessionId || "").trim()}`,
      payload: {
        sessionId,
        theoryId,
        theoryTitle,
        complexId,
        origin: "editor_theory_hub",
        returnUrl,
        savedAt: Date.now(),
      },
    }
  );
}

async function completeSingleTaskRun(page, sessionId, fixture) {
  await performTaskHappyPath(page, fixture);
  const { submitResponse, submitJson } = await submitCurrentTask(page, sessionId);

  expect(submitResponse.ok()).toBe(true);
  expect(submitJson.ok).toBe(true);
  expect(submitJson.result?.success).toBe(true);

  const nextResponsePromise = page.waitForResponse((response) => {
    return (
      response.request().method() === "POST" &&
      response.url().includes(`/api/session/${sessionId}/task/next`)
    );
  });
  const navigationPromise = page.waitForURL(
    (url) => getSessionScreen(url.toString(), sessionId) === "s3",
    { timeout: 20000 }
  );

  await page.locator("#next-task-btn").click();
  await Promise.all([nextResponsePromise, navigationPromise]);
  await waitForPageStable(page);
}

test.describe("complex audit wave 2 theory bridge", () => {
  test("cpw_cross_theory_bridge_storage_context_survives_s1_to_s3_and_returns_to_theory", async ({ page }) => {
    test.setTimeout(180000);

    const runId = makeRunId("cpw_theory_storage");
    const runtime = await createRuntimeHarness({
      projectRoot: PROJECT_ROOT,
      runId,
    });

    const consoleMessages = [];
    const pageErrors = [];
    attachConsoleTracking(page, consoleMessages);
    attachPageErrorTracking(page, pageErrors);

    try {
      const fixture = await seedTheoryBridgeFixture({
        baseUrl: runtime.baseUrl,
        runId,
      });

      const sessionId = await startComplex(page, {
        baseUrl: runtime.baseUrl,
        complexId: fixture.complexId,
      });

      const expectedReturnUrl = `/editor/Theory_Editor.html?theory_id=${encodeURIComponent(
        fixture.theoryId
      )}&return_url=${encodeURIComponent("/editor")}`;

      await setTheoryBridgeStorage(page, {
        baseUrl: runtime.baseUrl,
        sessionId,
        theoryId: fixture.theoryId,
        theoryTitle: fixture.theoryTitle,
        complexId: fixture.complexId,
        returnUrl: expectedReturnUrl,
      });

      await page.goto(new URL(`/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString());
      await waitForPageStable(page);

      await test.step("S1 shows theory-hub bridge context", async () => {
        await expect(page.locator("#theory-session-banner")).toBeVisible();
        await expect(page.locator("#theory-session-title")).toContainText(fixture.theoryTitle);
        await expect(page.locator("#theory-session-meta")).toContainText("Theory Hub");
      });

      await completeSingleTaskRun(page, sessionId, fixture);

      await test.step("S3 keeps theory bridge action and returns to exact theory editor route", async () => {
        await expect(page.locator("#to-theory-hub-btn")).toBeVisible();
        await expect(page.locator("#to-theory-hub-btn")).toContainText(fixture.theoryTitle);

        await page.locator("#to-theory-hub-btn").click();
        await page.waitForURL(new RegExp(`${expectedReturnUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), {
          timeout: 20000,
        });
      });

      expect(pageErrors).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });

  test("cpw_cross_complex_theory_link_fallback_surfaces_s1_banner_and_s3_theory_return", async ({ page }) => {
    test.setTimeout(180000);

    const runId = makeRunId("cpw_theory_link");
    const runtime = await createRuntimeHarness({
      projectRoot: PROJECT_ROOT,
      runId,
    });

    const consoleMessages = [];
    const pageErrors = [];
    attachConsoleTracking(page, consoleMessages);
    attachPageErrorTracking(page, pageErrors);

    try {
      const fixture = await seedTheoryBridgeFixture({
        baseUrl: runtime.baseUrl,
        runId,
      });

      const sessionId = await startComplex(page, {
        baseUrl: runtime.baseUrl,
        complexId: fixture.complexId,
      });

      await page.goto(new URL(`/session/${encodeURIComponent(sessionId)}`, runtime.baseUrl).toString());
      await waitForPageStable(page);

      await test.step("S1 falls back to complex theory_link when no storage bridge exists", async () => {
        await expect(page.locator("#theory-session-banner")).toBeVisible();
        await expect(page.locator("#theory-session-title")).toContainText(fixture.theoryTitle);
        await expect(page.locator("#theory-session-meta")).toContainText("theory_link");
      });

      await completeSingleTaskRun(page, sessionId, fixture);

      await test.step("S3 hydrates theory action from final results and returns to theory editor", async () => {
        await expect(page.locator("#to-theory-hub-btn")).toBeVisible();
        await expect(page.locator("#to-theory-hub-btn")).toContainText(fixture.theoryTitle);

        await page.locator("#to-theory-hub-btn").click();
        await page.waitForURL(
          new RegExp(
            `/editor/Theory_Editor\\.html\\?theory_id=${String(fixture.theoryId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
          ),
          { timeout: 20000 }
        );
      });

      expect(pageErrors).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  });
});
