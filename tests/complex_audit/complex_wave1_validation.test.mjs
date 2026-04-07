import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import {
  attachConsoleTracking,
  attachPageErrorTracking,
  makeRunId,
} from "./helpers/base.mjs";
import { createRuntimeHarness } from "./helpers/runtime_server.mjs";
import {
  seedTestValidationFixture,
  seedTypeHappyPathFixture,
} from "./helpers/data_seed.mjs";
import { startComplexFromList, countSubmitRequestsDuring, assertBlockedSubmissionState } from "./helpers/s1_helpers.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

async function createStartedTypeRun(page, prefix, taskType) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedTypeHappyPathFixture({
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

async function createStartedTestValidationRun(page, prefix) {
  const runId = makeRunId(prefix);
  const runtime = await createRuntimeHarness({
    projectRoot: PROJECT_ROOT,
    runId,
  });

  try {
    const fixture = await seedTestValidationFixture({
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

test.describe("complex audit wave 1 validation", () => {
  test("cpw_s1_test_l1_submit_blocked_until_complete", async ({ page }) => {
    test.setTimeout(180000);

    const consoleMessages = [];
    const pageErrors = [];
    attachConsoleTracking(page, consoleMessages);
    attachPageErrorTracking(page, pageErrors);

    const run = await createStartedTestValidationRun(page, "cpw_validation_test");

    try {
      const { fixture, sessionId } = run;

      await expect(page.locator("#check-answer-btn")).toBeEnabled();

      await page
        .locator("#task-content label")
        .first()
        .click();

      await expect(page.locator("#check-answer-btn")).toBeEnabled();

      const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
        await page.locator("#check-answer-btn").click();
      });

      expect(submitCount).toBe(0);
      await assertBlockedSubmissionState(
        page,
        "Ответьте на все вопросы перед проверкой (1/2)"
      );

      await expect(page.locator("#check-answer-btn")).toContainText("Всё равно проверить");
      expect(pageErrors).toEqual([]);
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s1_click_l1_submit_blocked_without_action", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_validation_click", "click");

    try {
      const { sessionId } = run;

      const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
        await page.locator("#check-answer-btn").click();
      });

      expect(submitCount).toBe(0);
      await assertBlockedSubmissionState(
        page,
        "Сделайте хотя бы одно действие (клик или подпись) перед проверкой"
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s1_draw_l1_submit_blocked_without_mark", async ({ page }) => {
    test.setTimeout(180000);

    await page.addInitScript(() => {
      window.RP_FEATURES = {
        ...(window.RP_FEATURES || {}),
        drawViaClickUI: false,
      };
    });

    const run = await createStartedTypeRun(page, "cpw_validation_draw", "draw");

    try {
      const { sessionId } = run;

      const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
        await page.locator("#check-answer-btn").click();
      });

      expect(submitCount).toBe(0);
      await assertBlockedSubmissionState(
        page,
        "Нарисуйте хотя бы одну метку перед проверкой"
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s1_sequence_l1_submit_blocked_when_incomplete", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_validation_sequence", "sequence_assembly");

    try {
      const { sessionId } = run;

      const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
        await page.locator("#check-answer-btn").click();
      });

      expect(submitCount).toBe(0);
      await assertBlockedSubmissionState(
        page,
        "\u0421\u043d\u0430\u0447\u0430\u043b\u0430 \u0440\u0430\u0437\u043c\u0435\u0441\u0442\u0438\u0442\u0435 \u0445\u043e\u0442\u044f \u0431\u044b \u043e\u0434\u0438\u043d \u044d\u043b\u0435\u043c\u0435\u043d\u0442 \u043f\u0435\u0440\u0435\u0434 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u043e\u0439"
      );
    } finally {
      await run.runtime.dispose();
    }
  });

  test("cpw_s1_open_answer_l1_submit_blocked_when_empty", async ({ page }) => {
    test.setTimeout(180000);

    const run = await createStartedTypeRun(page, "cpw_validation_open_answer", "open_answer");

    try {
      const { sessionId } = run;

      await expect(page.locator("#task-content textarea")).toBeVisible();
      await expect(page.locator("#check-answer-btn")).toBeEnabled();

      const submitCount = await countSubmitRequestsDuring(page, sessionId, async () => {
        await page.locator("#check-answer-btn").click();
      });

      expect(submitCount).toBe(0);
      await assertBlockedSubmissionState(page, "Введите ответ перед проверкой");
    } finally {
      await run.runtime.dispose();
    }
  });
});
