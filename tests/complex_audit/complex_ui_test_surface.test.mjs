import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { test } from "@playwright/test";

import { makeRunId, waitForPageStable } from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedSmokeTestL1Fixture,
  seedTypeHappyPathFixture,
} from "./helpers/data_seed.mjs";
import { startComplexFromList } from "./helpers/s1_helpers.mjs";

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

test.describe("complex UI TestUI surfaces", () => {
  test("cpw_ui_test_l1_surface_capture", async ({ page }) => {
    test.setTimeout(180000);

    const runId = makeRunId("ui_surface_test_l1");
    const runtime = await createRuntimeHarness({
      projectRoot: PROJECT_ROOT,
      runId,
    });

    try {
      const fixture = await seedSmokeTestL1Fixture({
        baseUrl: runtime.baseUrl,
        runId,
      });

      await page.setViewportSize({ width: 1440, height: 1024 });
      await startComplexFromList(page, {
        baseUrl: runtime.baseUrl,
        complexId: fixture.complexId,
        complexName: fixture.complexName,
      });
      await waitForPageStable(page);

      const snapshotDir = await ensureSnapshotDir(runId);
      await page.screenshot({
        path: path.join(snapshotDir, "test_l1_initial.png"),
        fullPage: true,
      });
    } finally {
      await runtime.dispose();
    }
  });

  test("cpw_ui_test_l2_surface_capture", async ({ page }) => {
    test.setTimeout(180000);

    const runId = makeRunId("ui_surface_test_l2");
    const runtime = await createRuntimeHarness({
      projectRoot: PROJECT_ROOT,
      runId,
    });

    try {
      const fixture = await seedTypeHappyPathFixture({
        baseUrl: runtime.baseUrl,
        runId,
        taskType: "test",
        difficulty: 2,
        dataDir: runtime.dataDir,
      });

      await page.setViewportSize({ width: 1440, height: 1024 });
      await startComplexFromList(page, {
        baseUrl: runtime.baseUrl,
        complexId: fixture.complexId,
        complexName: fixture.complexName,
      });

      await waitForPageStable(page);

      const snapshotDir = await ensureSnapshotDir(runId);
      await page.screenshot({
        path: path.join(snapshotDir, "test_l2_initial.png"),
        fullPage: true,
      });
    } finally {
      await runtime.dispose();
    }
  });
});
