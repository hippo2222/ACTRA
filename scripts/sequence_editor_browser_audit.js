const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const {
  DEFAULT_BASE_URL,
  fetchJson,
  assertApiOk,
  resolveUrl,
  pingBaseUrl,
  deleteEditorTask,
} = require("./browser_smoke_helpers");

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: path.resolve(process.cwd(), "reports", "sequence_editor_browser_audit"),
    scenarioIds: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token === "--base-url" && argv[i + 1]) {
      out.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--base-url=")) {
      out.baseUrl = token.slice("--base-url=".length);
      continue;
    }

    if (token === "--headless" && argv[i + 1]) {
      const raw = String(argv[i + 1]).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      i += 1;
      continue;
    }
    if (token.startsWith("--headless=")) {
      const raw = token.slice("--headless=".length).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      continue;
    }
    if (token === "--headed") {
      out.headless = false;
      continue;
    }

    if (token === "--report-dir" && argv[i + 1]) {
      out.reportDir = path.resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }
    if (token.startsWith("--report-dir=")) {
      out.reportDir = path.resolve(process.cwd(), token.slice("--report-dir=".length));
      continue;
    }

    if (token === "--scenario" && argv[i + 1]) {
      out.scenarioIds.push(
        ...String(argv[i + 1])
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      );
      i += 1;
      continue;
    }
    if (token.startsWith("--scenario=")) {
      out.scenarioIds.push(
        ...String(token.slice("--scenario=".length))
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      );
      continue;
    }
  }

  return out;
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createRunArtifacts(reportDir) {
  ensureDirectory(reportDir);
  const timestamp = timestampSlug();
  const runDir = path.join(reportDir, `sequence_editor_audit_${timestamp}`);
  const screenshotDir = path.join(runDir, "screenshots");
  const taskDir = path.join(runDir, "task_snapshots");
  ensureDirectory(runDir);
  ensureDirectory(screenshotDir);
  ensureDirectory(taskDir);
  return {
    timestamp,
    runDir,
    screenshotDir,
    taskDir,
    jsonPath: path.join(runDir, "summary.json"),
    mdPath: path.join(runDir, "summary.md"),
  };
}

function writeRunSummary(artifacts, payload) {
  fs.writeFileSync(artifacts.jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const lines = [];
  lines.push("# Sequence Editor Browser Audit");
  lines.push("");
  lines.push(`- Timestamp: ${payload.startedAt}`);
  lines.push(`- Base URL: ${payload.baseUrl}`);
  lines.push(`- Duration: ${payload.durationMs} ms`);
  lines.push(`- Passed: ${payload.passedCount}`);
  lines.push(`- Failed: ${payload.failedCount}`);
  lines.push("");
  lines.push("## Scenarios");
  lines.push("");

  for (const scenario of payload.scenarios || []) {
    lines.push(`- ${scenario.ok ? "PASS" : "FAIL"} ${scenario.id} (${scenario.durationMs} ms)`);
    if (scenario.error) {
      lines.push(`  - Error: ${scenario.error}`);
    }
    if (scenario.taskRef) {
      lines.push(`  - Task: ${scenario.taskRef}`);
    }
    if (scenario.consoleErrors && scenario.consoleErrors.length) {
      lines.push(`  - Console errors: ${scenario.consoleErrors.length}`);
    }
    if (scenario.pageErrors && scenario.pageErrors.length) {
      lines.push(`  - Page errors: ${scenario.pageErrors.length}`);
    }
    if (scenario.httpErrors && scenario.httpErrors.length) {
      lines.push(`  - HTTP errors: ${scenario.httpErrors.length}`);
      for (const entry of scenario.httpErrors.slice(0, 3)) {
        lines.push(`    - ${entry.status} ${entry.method} ${entry.url}`);
      }
    }
    for (const step of scenario.steps || []) {
      const screenshotRel = step.screenshot
        ? path.relative(artifacts.runDir, step.screenshot).replace(/\\/g, "/")
        : "";
      const taskSnapshotRel = step.taskSnapshot
        ? path.relative(artifacts.runDir, step.taskSnapshot).replace(/\\/g, "/")
        : "";
      lines.push(
        `  - ${step.id}: ${step.title}${screenshotRel ? ` [shot](${screenshotRel})` : ""}${taskSnapshotRel ? ` [task](${taskSnapshotRel})` : ""}`
      );
      if (step.note) {
        lines.push(`    - ${step.note}`);
      }
      if (step.url) {
        lines.push(`    - URL: ${step.url}`);
      }
    }
  }

  lines.push("");
  fs.writeFileSync(artifacts.mdPath, lines.join("\n"), "utf8");
}

async function loadEditorCatalog(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/editor/catalog");
  return assertApiOk(result, "load_editor_catalog");
}

function findModuleByName(catalog, moduleName) {
  return (Array.isArray(catalog.modules) ? catalog.modules : []).find(
    (item) => String(item && item.name ? item.name : "").trim() === moduleName
  );
}

function findTopicByName(moduleRow, topicName) {
  const topics = Array.isArray(moduleRow && moduleRow.topics ? moduleRow.topics : [])
    ? moduleRow.topics
    : [];
  return topics.find(
    (item) => String(item && item.name ? item.name : "").trim() === topicName
  );
}

async function ensureModuleAndTopic(baseUrl, fixture) {
  let catalog = await loadEditorCatalog(baseUrl);
  let moduleRow = findModuleByName(catalog, fixture.moduleName);

  if (!moduleRow) {
    const createdModule = await fetchJson(baseUrl, "/api/editor/module/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: fixture.moduleName }),
    });
    assertApiOk(createdModule, "create_sequence_editor_audit_module");
    catalog = await loadEditorCatalog(baseUrl);
    moduleRow = findModuleByName(catalog, fixture.moduleName);
  }

  if (!moduleRow) {
    throw new Error(`module_not_found_after_create:${fixture.moduleName}`);
  }

  let topicRow = findTopicByName(moduleRow, fixture.topicName);
  if (!topicRow) {
    const createdTopic = await fetchJson(baseUrl, "/api/editor/topic/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module_id: moduleRow.id,
        name: fixture.topicName,
      }),
    });
    assertApiOk(createdTopic, "create_sequence_editor_audit_topic");
    catalog = await loadEditorCatalog(baseUrl);
    moduleRow = findModuleByName(catalog, fixture.moduleName);
    topicRow = findTopicByName(moduleRow, fixture.topicName);
  }

  if (!topicRow) {
    throw new Error(`topic_not_found_after_create:${fixture.topicName}`);
  }

  return {
    moduleId: String(moduleRow.id || "").trim(),
    topicId: String(topicRow.id || "").trim(),
    moduleName: fixture.moduleName,
    topicName: fixture.topicName,
  };
}

function buildTaskPaths(moduleId, topicId, taskId) {
  const taskDir = path.resolve(
    process.cwd(),
    "data",
    "modules",
    moduleId,
    "topics",
    topicId,
    "tasks",
    taskId
  );
  return {
    taskDir,
    taskJsonPath: path.join(taskDir, "task.json"),
  };
}

function readTaskJson(taskJsonPath) {
  if (!fs.existsSync(taskJsonPath)) return null;
  return JSON.parse(fs.readFileSync(taskJsonPath, "utf8"));
}

function writeTaskSnapshot(artifacts, scenarioId, stepId, taskJson) {
  const snapshotPath = path.join(artifacts.taskDir, `${scenarioId}_${stepId}_task.json`);
  fs.writeFileSync(snapshotPath, JSON.stringify(taskJson, null, 2), "utf8");
  return snapshotPath;
}

function buildFixture(prefix = "pw_sequence_editor") {
  const suffix = timestampSlug().replace(/[^0-9A-Za-z_-]/g, "").slice(-12);
  return {
    moduleName: `[PW Sequence Editor] Module ${suffix}`,
    topicName: `[PW Sequence Editor] Topic ${suffix}`,
    taskName: `[PW Sequence Editor] Sequence ${suffix}`,
    prompt: `Соберите последовательность шагов ${suffix}.`,
    levelTitle: `Этап ${suffix}`,
    secondLevelTitle: `Проверка ${suffix}`,
    itemA: `Шаг A ${suffix}`,
    itemB: `Шаг B ${suffix}`,
    secondLevelItem: `Контроль ${suffix}`,
  };
}

async function waitForDashboardReady(page, baseUrl) {
  await page.goto(resolveUrl(baseUrl, "/ui/editor"), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector('[data-role="create-task-card"]', {
    state: "visible",
    timeout: 30000,
  });
}

async function openCreateTaskModal(page) {
  await page.locator('[data-role="create-task-card"]').click();
  await page.waitForSelector("#create-task-modal", {
    state: "visible",
    timeout: 10000,
  });
}

async function submitNewSequenceTask(page, fixture) {
  await page.selectOption("#task-module-select", fixture.moduleId);
  await page.waitForFunction(
    (expectedTopicId) => {
      const topicSelect = document.querySelector("#task-topic-select");
      if (!topicSelect) return false;
      return [...topicSelect.options].some((option) => option.value === expectedTopicId);
    },
    fixture.topicId,
    { timeout: 10000 }
  );
  await page.selectOption("#task-topic-select", fixture.topicId);
  await page.fill("#task-name-input", fixture.taskName);
  await page.selectOption("#task-type-select", "sequence_assembly");

  await Promise.all([
    page.waitForURL(/\/ui\/editor\/Sequence%20Assembly%20Editor%20Procedural%20Steps\.html\?/i, {
      timeout: 30000,
    }),
    page.locator('#create-task-modal button[onclick="dashboard.submitTaskForm()"]').click(),
  ]);

  await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
  await page.waitForSelector("#save-task-btn", { state: "visible", timeout: 10000 });

  const url = new URL(page.url());
  return {
    moduleId: url.searchParams.get("module"),
    topicId: url.searchParams.get("topic"),
    taskId: url.searchParams.get("task"),
    isNew: url.searchParams.get("new") === "1",
    pageUrl: url.toString(),
  };
}

function extractTaskRefFromUrl(pageUrl) {
  const url = new URL(pageUrl);
  return {
    moduleId: String(url.searchParams.get("module") || "").trim(),
    topicId: String(url.searchParams.get("topic") || "").trim(),
    taskId: String(url.searchParams.get("task") || "").trim(),
    isNew: url.searchParams.get("new") === "1",
    pageUrl: url.toString(),
  };
}

async function saveCurrentSequenceTask(page, taskRef) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(
        `/api/editor/task/${encodeURIComponent(taskRef.moduleId)}/${encodeURIComponent(taskRef.topicId)}/${encodeURIComponent(taskRef.taskId)}`
      ),
    { timeout: 30000 }
  );

  await page.click("#save-task-btn");
  const response = await responsePromise;
  if (!response.ok()) {
    throw new Error(`save_failed_http_${response.status()}`);
  }
  return response;
}

async function fillMinimalSequence(page, fixture) {
  await page.fill("#prompt-textarea", fixture.prompt);
  await page.locator(".level-title-input").first().fill(fixture.levelTitle);
  await page.locator(".block-title-input").nth(0).fill(fixture.itemA);
  await page.locator(".block-title-input").nth(1).fill(fixture.itemB);
}

async function verifyMinimalSequenceUI(page, fixture) {
  await page.waitForFunction(
    ({ prompt, levelTitle, itemA, itemB }) => {
      const promptField = document.querySelector("#prompt-textarea");
      const levelTitleField = document.querySelector(".level-title-input");
      const blockFields = [...document.querySelectorAll(".block-title-input")];
      return (
        promptField &&
        String(promptField.value || "").trim() === prompt &&
        levelTitleField &&
        String(levelTitleField.value || "").trim() === levelTitle &&
        blockFields.length >= 2 &&
        String(blockFields[0].value || "").trim() === itemA &&
        String(blockFields[1].value || "").trim() === itemB
      );
    },
    fixture,
    { timeout: 30000 }
  );
}

async function prepareDraftRecoveryState(page, fixture) {
  await page.fill("#prompt-textarea", `${fixture.prompt} (черновик)`);
  await page.locator("#order-inside-matters").check();
  await page.locator("#level-order-matters").check();
  await page.locator(".level-title-input").first().fill(`${fixture.levelTitle} draft`);
  await page.locator(".block-title-input").nth(0).fill(`${fixture.itemA} draft`);
  await page.locator(".block-title-input").nth(1).fill(`${fixture.itemB} draft`);
  await page.locator("#add-level-btn").click();
  await page.waitForFunction(() => document.querySelectorAll(".level-title-input").length === 2, {
    timeout: 10000,
  });
  await page.locator(".level-title-input").nth(1).fill(fixture.secondLevelTitle);
  await page.locator(".block-title-input").nth(2).fill(fixture.secondLevelItem);
}

async function verifyDraftRecoveryUI(page, fixture) {
  await page.waitForFunction(
    ({ prompt, levelTitle, itemA, itemB, secondLevelTitle, secondLevelItem }) => {
      const promptField = document.querySelector("#prompt-textarea");
      const orderInside = document.querySelector("#order-inside-matters");
      const levelOrder = document.querySelector("#level-order-matters");
      const levelFields = [...document.querySelectorAll(".level-title-input")];
      const blockFields = [...document.querySelectorAll(".block-title-input")];
      return (
        promptField &&
        String(promptField.value || "").trim() === `${prompt} (черновик)` &&
        orderInside &&
        orderInside.checked === true &&
        levelOrder &&
        levelOrder.checked === true &&
        levelFields.length === 2 &&
        String(levelFields[0].value || "").trim() === `${levelTitle} draft` &&
        String(levelFields[1].value || "").trim() === secondLevelTitle &&
        blockFields.length >= 3 &&
        String(blockFields[0].value || "").trim() === `${itemA} draft` &&
        String(blockFields[1].value || "").trim() === `${itemB} draft` &&
        String(blockFields[2].value || "").trim() === secondLevelItem
      );
    },
    fixture,
    { timeout: 30000 }
  );
}

async function saveLocalDraft(page) {
  await page.evaluate(() => {
    if (!window.editor || !window.editor.autoSaveManager) {
      throw new Error("autosave_manager_missing");
    }
    window.editor.autoSaveManager.saveDraft();
  });
}

function createScenarioDefinitions() {
  return [
    {
      id: "s01_create_open_new_sequence_task",
      title: "Create a new sequence task from dashboard and open editor",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Create task modal is visible" };
        });

        await step("submit_new_sequence_task", async () => {
          const taskRef = await submitNewSequenceTask(page, {
            ...fixture,
            ...scope,
          });
          result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
          const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("task_json_materialized_before_first_save");
          }
          const visibleTitle = await page.locator("#task-title-display").textContent();
          return {
            note: `Editor opened for ${String(visibleTitle || "").trim()} without materialized task.json before first save`,
          };
        });
      },
    },
    {
      id: "s02_minimal_valid_sequence_save_roundtrip",
      title: "Minimal valid sequence task saves and survives reload",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create sequence task" };
        });

        await step("create_sequence_task", async () => {
          await submitNewSequenceTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Sequence editor opened from dashboard create flow" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_minimal_valid_content", async () => {
          await fillMinimalSequence(page, fixture);
          return { note: "Prompt, level title and two step labels are filled" };
        });

        await step("save_sequence_task", async () => {
          await saveCurrentSequenceTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) {
            throw new Error("task_json_missing_after_save");
          }
          const content = taskJson.content || {};
          if (String(content.prompt || "").trim() !== fixture.prompt) {
            throw new Error("saved_prompt_mismatch");
          }
          if (!Array.isArray(content.elements) || content.elements.length !== 2) {
            throw new Error("saved_elements_shape_mismatch");
          }
          if (!Array.isArray(content.levels) || content.levels.length !== 1) {
            throw new Error("saved_levels_shape_mismatch");
          }
          if (String(content.levels[0]?.level_name || "").trim() !== fixture.levelTitle) {
            throw new Error("saved_level_title_mismatch");
          }
          if (!Array.isArray(content.sequence) || content.sequence.length !== 1) {
            throw new Error("saved_legacy_sequence_missing");
          }
          return {
            note: "Save request succeeded and canonical plus legacy sequence structures were materialized",
            taskJson,
          };
        });

        await step("reload_and_verify", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await verifyMinimalSequenceUI(page, fixture);
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Reload preserved prompt, level title and both step labels",
            taskJson,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
    {
      id: "s03_sequence_draft_recovery_roundtrip",
      title: "Unsaved prompt, settings and structure recover after reload",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create draft-recovery sequence task" };
        });

        await step("create_sequence_task", async () => {
          await submitNewSequenceTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Sequence editor opened for draft recovery scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("edit_unsaved_content", async () => {
          await prepareDraftRecoveryState(page, fixture);
          return { note: "Unsaved prompt, flags and multi-level structure differ from bootstrap defaults" };
        });

        await step("persist_local_draft_only", async () => {
          await saveLocalDraft(page);
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("draft_recovery_should_not_materialize_task_json");
          }
          return { note: "Local draft persisted without creating task.json" };
        });

        await step("reload_and_verify_recovery", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await verifyDraftRecoveryUI(page, fixture);
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("draft_recovery_reload_should_not_create_task_json");
          }
          return { note: "Reload restored prompt, settings flags and second level from local draft" };
        });

        try {
          await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
    {
      id: "s04_sequence_clear_all_confirm_and_undo",
      title: "Clear-all uses custom confirm, supports cancel and restores structure via undo",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create sequence task for destructive-flow checks" };
        });

        await step("create_sequence_task", async () => {
          await submitNewSequenceTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Sequence editor opened for clear-all scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;

        await step("fill_structure_before_clear", async () => {
          await fillMinimalSequence(page, fixture);
          return { note: "Prompt and two-step structure are ready for clear-all checks" };
        });

        await step("cancel_clear_all", async () => {
          await page.click("#clear-all-btn");
          await page.waitForSelector('[data-role="confirm-card"]', { state: "visible", timeout: 10000 });
          const confirmText = await page.locator('[data-role="confirm-card"]').textContent();
          if (!String(confirmText || "").trim()) {
            throw new Error("clear_all_confirm_copy_missing");
          }
          await page.locator('[data-role="cancel"]').click();
          await page.waitForSelector('[data-role="confirm-card"]', { state: "hidden", timeout: 10000 });
          await verifyMinimalSequenceUI(page, fixture);
          return { note: "Cancel kept the current prompt and structure untouched" };
        });

        await step("confirm_clear_all", async () => {
          await page.click("#clear-all-btn");
          await page.waitForSelector('[data-role="confirm-card"]', { state: "visible", timeout: 10000 });
          await page.locator('[data-role="confirm"]').click();
          await page.waitForSelector('[data-role="confirm-card"]', { state: "hidden", timeout: 10000 });
          await page.waitForFunction(
            (prompt) => {
              const promptField = document.querySelector("#prompt-textarea");
              return (
                promptField &&
                String(promptField.value || "").trim() === prompt &&
                document.querySelectorAll(".level-title-input").length === 1 &&
                document.querySelectorAll(".block-title-input").length === 1
              );
            },
            fixture.prompt,
            { timeout: 15000 }
          );
          return { note: "Confirm left prompt intact and reset the structure to one empty level" };
        });

        await step("undo_clear_all", async () => {
          await page.waitForFunction(() => {
            const undoBtn = document.querySelector("#undo-btn");
            return Boolean(undoBtn && !undoBtn.disabled);
          }, { timeout: 10000 });
          await page.click("#undo-btn");
          await verifyMinimalSequenceUI(page, fixture);
          return { note: "Undo restored the prompt, level title and both original step labels" };
        });

        try {
          await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },

    // ==================== PRODUCT GAP AUDIT SCENARIOS ====================

    {
      id: "s14_image_field_preservation_on_resave",
      title: "Element image fields survive editor re-save without data loss",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        // Build a task.json payload with element images
        const taskId = `pw_seq_img_${timestampSlug().replace(/[^0-9A-Za-z_-]/g, "").slice(-12)}`;
        const seededPayload = {
          type: "sequence_assembly",
          task_type: "sequence_assembly",
          name: fixture.taskName,
          meta: {
            task_schema_version: "1.2",
            name: fixture.taskName,
            module: scope.moduleId,
            topic: scope.topicId,
            id: taskId,
          },
          content: {
            prompt: fixture.prompt,
            elements: [
              { id: "elem_img_1", text: fixture.itemA, image: "assets/step_a.png" },
              { id: "elem_img_2", text: fixture.itemB, image: "assets/step_b.jpg" },
            ],
            levels: [
              {
                level_id: "level_img_1",
                level_name: fixture.levelTitle,
                blocks: ["elem_img_1", "elem_img_2"],
              },
            ],
            sequence: [
              {
                level_id: "level_img_1",
                title: fixture.levelTitle,
                items: [
                  { id: "elem_img_1", label: fixture.itemA },
                  { id: "elem_img_2", label: fixture.itemB },
                ],
              },
            ],
            sequence_within_level_matters: false,
            level_order_matters: false,
          },
          settings: {
            level_order_matters: false,
            sequence_within_level_matters: false,
          },
        };

        await step("seed_task_with_images_via_api", async () => {
          const saveResult = await fetchJson(
            options.baseUrl,
            `/api/editor/task/${encodeURIComponent(scope.moduleId)}/${encodeURIComponent(scope.topicId)}/${encodeURIComponent(taskId)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(seededPayload),
            }
          );
          assertApiOk(saveResult, "seed_task_with_images");
          const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("seeded_task_json_missing");
          const elements = (taskJson.content || {}).elements || [];
          const withImage = elements.filter((e) => e.image);
          if (withImage.length !== 2) {
            throw new Error(`seeded_elements_image_count_mismatch:${withImage.length}`);
          }
          return { note: `Seeded task.json with ${withImage.length} elements having image fields`, taskJson };
        });

        result.taskRef = `${scope.moduleId}/${scope.topicId}/${taskId}`;
        const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);

        await step("open_task_in_editor", async () => {
          const editorUrl = resolveUrl(
            options.baseUrl,
            `/ui/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=${encodeURIComponent(scope.moduleId)}&topic=${encodeURIComponent(scope.topicId)}&task=${encodeURIComponent(taskId)}`
          );
          await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForSelector("#save-task-btn", { state: "visible", timeout: 10000 });
          // Wait for actual task content to load and render (levels appear after async load)
          await page.waitForSelector(".level-title-input", { state: "visible", timeout: 30000 });
          // Check UI: are image indicators visible?
          const hasImageUI = await page.evaluate(() => {
            const blocks = [...document.querySelectorAll(".block-title-input")];
            const imageElements = document.querySelectorAll("[data-element-image], .element-image, img.block-image");
            return { blockCount: blocks.length, imageElementCount: imageElements.length };
          });
          return {
            note: `Editor opened: ${hasImageUI.blockCount} blocks visible, ${hasImageUI.imageElementCount} image UI elements (expected 0 — editor has no image UI)`,
          };
        });

        await step("resave_without_edits", async () => {
          const taskRef = { moduleId: scope.moduleId, topicId: scope.topicId, taskId };
          await saveCurrentSequenceTask(page, taskRef);
          return { note: "Save completed without any edits" };
        });

        await step("verify_image_fields_after_resave", async () => {
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("task_json_missing_after_resave");
          const content = taskJson.content || {};
          const elements = content.elements || [];
          const withImage = elements.filter((e) => e.image);
          const gapConfirmed = withImage.length === 0;
          const note = gapConfirmed
            ? `GAP_CONFIRMED: all ${elements.length} elements lost their image fields after re-save`
            : `PRESERVED: ${withImage.length}/${elements.length} elements still have image fields`;
          return { note, taskJson };
        });

        await step("reload_and_verify_consistency", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          const taskJson = readTaskJson(paths.taskJsonPath);
          const content = taskJson ? taskJson.content || {} : {};
          const elements = content.elements || [];
          const withImage = elements.filter((e) => e.image);
          return {
            note: `After reload: ${withImage.length}/${elements.length} elements have image fields`,
            taskJson,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, scope.moduleId, scope.topicId, taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
    {
      id: "s15_extended_settings_roundtrip",
      title: "Extended settings (shuffle_elements, show_hints) survive editor re-save",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        const taskId = `pw_seq_set_${timestampSlug().replace(/[^0-9A-Za-z_-]/g, "").slice(-12)}`;
        const seededPayload = {
          type: "sequence_assembly",
          task_type: "sequence_assembly",
          name: fixture.taskName,
          meta: {
            task_schema_version: "1.2",
            name: fixture.taskName,
            module: scope.moduleId,
            topic: scope.topicId,
            id: taskId,
          },
          content: {
            prompt: fixture.prompt,
            elements: [
              { id: "elem_set_1", text: fixture.itemA },
              { id: "elem_set_2", text: fixture.itemB },
            ],
            levels: [
              {
                level_id: "level_set_1",
                level_name: fixture.levelTitle,
                blocks: ["elem_set_1", "elem_set_2"],
              },
            ],
            sequence: [
              {
                level_id: "level_set_1",
                title: fixture.levelTitle,
                items: [
                  { id: "elem_set_1", label: fixture.itemA },
                  { id: "elem_set_2", label: fixture.itemB },
                ],
              },
            ],
            sequence_within_level_matters: true,
            level_order_matters: true,
          },
          settings: {
            level_order_matters: true,
            sequence_within_level_matters: true,
            shuffle_elements: false,
            show_hints: true,
            allow_duplicates: false,
          },
        };

        await step("seed_task_with_extended_settings_via_api", async () => {
          const saveResult = await fetchJson(
            options.baseUrl,
            `/api/editor/task/${encodeURIComponent(scope.moduleId)}/${encodeURIComponent(scope.topicId)}/${encodeURIComponent(taskId)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(seededPayload),
            }
          );
          assertApiOk(saveResult, "seed_task_with_extended_settings");
          const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("seeded_task_json_missing");
          const settings = taskJson.settings || {};
          if (settings.shuffle_elements !== false) throw new Error("seeded_shuffle_elements_mismatch");
          if (settings.show_hints !== true) throw new Error("seeded_show_hints_mismatch");
          return {
            note: `Seeded task.json with shuffle_elements=${settings.shuffle_elements}, show_hints=${settings.show_hints}, allow_duplicates=${settings.allow_duplicates}`,
            taskJson,
          };
        });

        result.taskRef = `${scope.moduleId}/${scope.topicId}/${taskId}`;
        const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);

        await step("open_task_in_editor", async () => {
          const editorUrl = resolveUrl(
            options.baseUrl,
            `/ui/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=${encodeURIComponent(scope.moduleId)}&topic=${encodeURIComponent(scope.topicId)}&task=${encodeURIComponent(taskId)}`
          );
          await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          // Wait for actual task content to load and render (levels appear after async load)
          await page.waitForSelector(".level-title-input", { state: "visible", timeout: 30000 });
          // Check if extended settings have UI controls
          const settingsUI = await page.evaluate(() => {
            const shuffleEl = document.querySelector("#shuffle-elements, [name='shuffle_elements']");
            const hintsEl = document.querySelector("#show-hints, [name='show_hints']");
            const dupsEl = document.querySelector("#allow-duplicates, [name='allow_duplicates']");
            return {
              hasShuffle: !!shuffleEl,
              hasHints: !!hintsEl,
              hasDuplicates: !!dupsEl,
            };
          });
          return {
            note: `Editor opened. Extended settings UI: shuffle=${settingsUI.hasShuffle}, hints=${settingsUI.hasHints}, duplicates=${settingsUI.hasDuplicates} (all expected false — no UI exists)`,
          };
        });

        await step("resave_without_edits", async () => {
          const taskRef = { moduleId: scope.moduleId, topicId: scope.topicId, taskId };
          await saveCurrentSequenceTask(page, taskRef);
          return { note: "Save completed without any edits" };
        });

        await step("verify_extended_settings_after_resave", async () => {
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("task_json_missing_after_resave");
          const settings = taskJson.settings || {};
          const findings = [];
          if (!("shuffle_elements" in settings)) {
            findings.push("shuffle_elements: DROPPED");
          } else if (settings.shuffle_elements !== false) {
            findings.push(`shuffle_elements: CHANGED to ${settings.shuffle_elements}`);
          } else {
            findings.push("shuffle_elements: preserved");
          }
          if (!("show_hints" in settings)) {
            findings.push("show_hints: DROPPED");
          } else if (settings.show_hints !== true) {
            findings.push(`show_hints: CHANGED to ${settings.show_hints}`);
          } else {
            findings.push("show_hints: preserved");
          }
          if (!("allow_duplicates" in settings)) {
            findings.push("allow_duplicates: DROPPED");
          } else {
            findings.push(`allow_duplicates: ${settings.allow_duplicates === false ? "preserved" : "CHANGED"}`);
          }
          const gapConfirmed = findings.some((f) => f.includes("DROPPED") || f.includes("CHANGED"));
          return {
            note: `${gapConfirmed ? "GAP_CONFIRMED" : "PRESERVED"}: ${findings.join("; ")}`,
            taskJson,
          };
        });

        await step("reload_and_verify_consistency", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          const taskJson = readTaskJson(paths.taskJsonPath);
          const settings = taskJson ? taskJson.settings || {} : {};
          return {
            note: `After reload: settings keys = [${Object.keys(settings).join(", ")}]`,
            taskJson,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, scope.moduleId, scope.topicId, taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
    {
      id: "s16_new_task_default_settings_shape",
      title: "New task from dashboard produces expected settings shape in task.json",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create sequence task for settings audit" };
        });

        await step("create_sequence_task", async () => {
          await submitNewSequenceTask(page, { ...fixture, ...scope });
          return { note: "Sequence editor opened for default settings check" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_minimal_and_save", async () => {
          await fillMinimalSequence(page, fixture);
          await saveCurrentSequenceTask(page, taskRef);
          return { note: "Minimal content filled and saved" };
        });

        await step("verify_settings_shape", async () => {
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("task_json_missing_after_save");
          const settings = taskJson.settings || {};
          const contentSettings = (taskJson.content || {}).settings || {};
          const allSettingsKeys = [...new Set([...Object.keys(settings), ...Object.keys(contentSettings)])];

          // Expected from evaluator get_default_settings():
          // shuffle_elements, show_hints, allow_duplicates, sequence_within_level_matters, level_order_matters
          const expectedKeys = [
            "shuffle_elements",
            "show_hints",
            "allow_duplicates",
            "sequence_within_level_matters",
            "level_order_matters",
          ];
          const presentKeys = expectedKeys.filter((k) => k in settings || k in contentSettings);
          const missingKeys = expectedKeys.filter((k) => !(k in settings) && !(k in contentSettings));

          const gapConfirmed = missingKeys.length > 0;
          return {
            note: `${gapConfirmed ? "GAP_CONFIRMED" : "COMPLETE"}: settings keys present=[${presentKeys.join(", ")}], missing=[${missingKeys.join(", ")}]. All settings keys in file: [${allSettingsKeys.join(", ")}]`,
            taskJson,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
    {
      id: "s17_image_element_in_seeded_task_file",
      title: "Seeded task.json with element images has correct file structure",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        const taskId = `pw_seq_rt_${timestampSlug().replace(/[^0-9A-Za-z_-]/g, "").slice(-12)}`;
        const seededPayload = {
          type: "sequence_assembly",
          task_type: "sequence_assembly",
          name: fixture.taskName,
          meta: {
            task_schema_version: "1.2",
            name: fixture.taskName,
            module: scope.moduleId,
            topic: scope.topicId,
            id: taskId,
          },
          content: {
            prompt: fixture.prompt,
            elements: [
              { id: "elem_rt_1", text: fixture.itemA, image: "assets/diagram_a.png" },
              { id: "elem_rt_2", text: fixture.itemB, image: "assets/diagram_b.svg" },
            ],
            levels: [
              {
                level_id: "level_rt_1",
                level_name: fixture.levelTitle,
                blocks: ["elem_rt_1", "elem_rt_2"],
              },
            ],
            sequence: [
              {
                level_id: "level_rt_1",
                title: fixture.levelTitle,
                items: [
                  { id: "elem_rt_1", label: fixture.itemA },
                  { id: "elem_rt_2", label: fixture.itemB },
                ],
              },
            ],
            sequence_within_level_matters: false,
            level_order_matters: false,
          },
          settings: {
            level_order_matters: false,
            sequence_within_level_matters: false,
          },
        };

        await step("seed_task_with_images", async () => {
          const saveResult = await fetchJson(
            options.baseUrl,
            `/api/editor/task/${encodeURIComponent(scope.moduleId)}/${encodeURIComponent(scope.topicId)}/${encodeURIComponent(taskId)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(seededPayload),
            }
          );
          assertApiOk(saveResult, "seed_task_with_images_for_delivery");
          return { note: "Task with image elements seeded via API" };
        });

        result.taskRef = `${scope.moduleId}/${scope.topicId}/${taskId}`;
        const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);

        await step("verify_task_json_image_structure", async () => {
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("seeded_task_json_missing");
          const content = taskJson.content || {};
          const elements = content.elements || [];
          const results = elements.map((e) => ({
            id: e.id,
            text: e.text || "",
            image: e.image || null,
          }));
          const allHaveImages = results.every((e) => e.image !== null);
          return {
            note: `Task file elements: ${JSON.stringify(results)}. All have images: ${allHaveImages}`,
            taskJson,
          };
        });

        await step("verify_runtime_delivery_via_api", async () => {
          // Load the task via the editor GET API and check if image fields are present
          const getResult = await fetchJson(
            options.baseUrl,
            `/api/editor/task/${encodeURIComponent(scope.moduleId)}/${encodeURIComponent(scope.topicId)}/${encodeURIComponent(taskId)}`
          );
          const data = assertApiOk(getResult, "get_seeded_task_for_delivery_check");
          const task = data.task || {};
          const content = (task.task_data || task).content || task.content || {};
          const elements = content.elements || [];
          const withImage = elements.filter((e) => e.image);
          return {
            note: `Editor API returns ${withImage.length}/${elements.length} elements with image field. Delivery layer (SessionAPI) would construct WebSequenceElement with image from this data.`,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, scope.moduleId, scope.topicId, taskId);
        } catch (_) {
          // Best effort cleanup.
        }
      },
    },
  ];
}

async function runScenario(browser, artifacts, options, definition) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const startedAt = Date.now();
  const result = {
    id: definition.id,
    title: definition.title,
    ok: false,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: 0,
    steps: [],
    consoleErrors: [],
    pageErrors: [],
    httpErrors: [],
    taskRef: "",
  };

  const onConsole = (msg) => {
    if (msg.type() === "error") {
      result.consoleErrors.push(msg.text());
    }
  };
  const onPageError = (err) => {
    result.pageErrors.push(String(err && err.message ? err.message : err));
  };
  const onResponse = (response) => {
    const status = response.status();
    if (status < 400) return;
    const url = response.url();
    if (!url.startsWith(options.baseUrl)) return;
    result.httpErrors.push({
      status,
      method: response.request().method(),
      resourceType: response.request().resourceType(),
      url,
    });
  };

  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("response", onResponse);

  let stepCounter = 0;
  async function step(title, fn) {
    stepCounter += 1;
    const stepId = `step_${String(stepCounter).padStart(2, "0")}`;
    const payload = {
      id: stepId,
      title,
      url: page.url(),
      note: "",
      screenshot: "",
      taskSnapshot: "",
    };

    const data = await fn();
    if (data && typeof data.note === "string") {
      payload.note = data.note;
    }
    if (data && data.taskJson) {
      payload.taskSnapshot = writeTaskSnapshot(artifacts, definition.id, stepId, data.taskJson);
    }
    payload.url = page.url();
    payload.screenshot = path.join(artifacts.screenshotDir, `${definition.id}_${stepId}.png`);
    await page.screenshot({ path: payload.screenshot, fullPage: true });
    result.steps.push(payload);
    return data;
  }

  try {
    await definition.run({ page, step, options, artifacts, result });
    result.ok = true;
  } catch (error) {
    result.error = String(error && error.message ? error.message : error);
    result.ok = false;
  } finally {
    result.durationMs = Date.now() - startedAt;
    await context.close();
  }

  return result;
}

async function main() {
  const options = parseArgs();
  const startedAt = new Date();

  const isAvailable = await pingBaseUrl(options.baseUrl, 5000);
  if (!isAvailable) {
    throw new Error(`base_url_unreachable:${options.baseUrl}`);
  }

  const artifacts = createRunArtifacts(options.reportDir);
  const browser = await chromium.launch({ headless: options.headless });
  const allScenarios = createScenarioDefinitions();
  const selected = options.scenarioIds.length
    ? allScenarios.filter((item) => options.scenarioIds.includes(item.id))
    : allScenarios;

  if (!selected.length) {
    throw new Error("no_scenarios_selected");
  }

  const results = [];
  try {
    for (const scenario of selected) {
      const result = await runScenario(browser, artifacts, options, scenario);
      results.push(result);
    }
  } finally {
    await browser.close();
  }

  const payload = {
    startedAt: startedAt.toISOString(),
    baseUrl: options.baseUrl,
    headless: options.headless,
    durationMs: Date.now() - startedAt.getTime(),
    passedCount: results.filter((item) => item.ok).length,
    failedCount: results.filter((item) => !item.ok).length,
    selectedScenarios: selected.map((item) => item.id),
    scenarios: results,
  };

  writeRunSummary(artifacts, payload);

  if (payload.failedCount > 0) {
    console.error(`Sequence editor browser audit finished with failures. Report: ${artifacts.mdPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Sequence editor browser audit passed. Report: ${artifacts.mdPath}`);
}

main().catch((error) => {
  console.error("[sequence_editor_browser_audit] Fatal error:", error);
  process.exitCode = 1;
});
