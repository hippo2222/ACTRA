import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedMistakesUIFixture,
  seedTypeHappyPathFixture,
} from "./helpers/data_seed.mjs";
import { startComplexFromList } from "./helpers/s1_helpers.mjs";
import { performTaskHappyPath } from "./helpers/task_type_actions.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const UI_SNAPSHOT_ROOT = path.resolve(
  PROJECT_ROOT,
  "reports",
  "complex_passage_playwright_audit",
  "ui_snapshots"
);

async function ensureSnapshotDir(runId) {
  const dir = path.join(UI_SNAPSHOT_ROOT, runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function startMistakesComplex(page, { baseUrl, complexId }) {
  const response = await page.request.post(
    new URL(`/api/session/${encodeURIComponent(complexId)}/start`, baseUrl).toString(),
    {
      data: {},
    }
  );
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.ok).toBe(true);
  const sessionId = String(payload.session_id || "").trim();
  expect(sessionId).not.toBe("");
  await page.goto(new URL(`/ui/session/${encodeURIComponent(sessionId)}`, baseUrl).toString());
  await waitForPageStable(page);
  return sessionId;
}

test.describe("complex UI task surfaces", () => {
  const desktopViewport = { width: 1440, height: 1300 };

  const typeCases = [
    { taskType: "click", difficulty: 1, scenarioId: "cpw_ui_click_surface_capture" },
    { taskType: "draw", difficulty: 1, scenarioId: "cpw_ui_draw_surface_capture" },
    { taskType: "open_answer", difficulty: 1, scenarioId: "cpw_ui_open_answer_surface_capture" },
  ];

  for (const item of typeCases) {
    test(item.scenarioId, async ({ page }) => {
      test.setTimeout(180000);

      if (item.taskType === "draw") {
        await page.addInitScript(() => {
          window.RP_FEATURES = {
            ...(window.RP_FEATURES || {}),
            drawViaClickUI: false,
          };
        });
      }

      const runId = makeRunId(`ui_surface_${item.taskType}`);
      const runtime = await createRuntimeHarness({
        projectRoot: PROJECT_ROOT,
        runId,
      });

      try {
        const fixture = await seedTypeHappyPathFixture({
          baseUrl: runtime.baseUrl,
          runId,
          taskType: item.taskType,
          difficulty: item.difficulty,
          dataDir: runtime.dataDir,
        });

        await page.setViewportSize(desktopViewport);

        await startComplexFromList(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
          complexName: fixture.complexName,
        });

        await performTaskHappyPath(page, fixture);
        await waitForPageStable(page);

        const snapshotDir = await ensureSnapshotDir(runId);
        await page.screenshot({
          path: path.join(snapshotDir, `${item.taskType}_ready.png`),
          fullPage: true,
        });
      } finally {
        await runtime.dispose();
      }
    });
  }

  const mistakesCases = [
    { mode: "text_errors", scenarioId: "cpw_ui_mistakes_text_errors_surface_capture" },
    { mode: "text_choice", scenarioId: "cpw_ui_mistakes_text_choice_surface_capture" },
  ];

  for (const item of mistakesCases) {
    test(item.scenarioId, async ({ page }) => {
      test.setTimeout(180000);

      const runId = makeRunId(`ui_surface_mistakes_${item.mode}`);
      const runtime = await createRuntimeHarness({
        projectRoot: PROJECT_ROOT,
        runId,
      });

      try {
        const fixture = await seedMistakesUIFixture({
          baseUrl: runtime.baseUrl,
          runId,
          mode: item.mode,
        });

        await page.setViewportSize(desktopViewport);
        await startMistakesComplex(page, {
          baseUrl: runtime.baseUrl,
          complexId: fixture.complexId,
        });

        const snapshotDir = await ensureSnapshotDir(runId);

        await page.screenshot({
          path: path.join(snapshotDir, `${item.mode}_initial.png`),
          fullPage: true,
        });

        await performTaskHappyPath(page, fixture);
        await waitForPageStable(page);

        await page.screenshot({
          path: path.join(snapshotDir, `${item.mode}_resolved.png`),
          fullPage: true,
        });
      } finally {
        await runtime.dispose();
      }
    });
  }
});
