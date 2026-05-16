const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { chromium } = require("playwright");

const {
  DEFAULT_BASE_URL,
  fetchJson,
  assertApiOk,
  resolveUrl,
  pingBaseUrl,
  deleteEditorTask,
} = require("./browser_smoke_helpers");

const QUESTION_NAV_ITEM_SELECTOR = "#question-list [data-question-index]";
const QUESTION_NAV_SELECT_SELECTOR = `${QUESTION_NAV_ITEM_SELECTOR} .question-nav-item__select`;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: path.resolve(process.cwd(), "reports", "test_editor_browser_audit"),
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

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function createRunArtifacts(reportDir) {
  ensureDirectory(reportDir);
  const timestamp = timestampSlug();
  const runDir = path.join(reportDir, `test_editor_audit_${timestamp}`);
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
  lines.push("# Test Editor Browser Audit");
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
    lines.push(
      `- ${scenario.ok ? "PASS" : "FAIL"} ${scenario.id} (${scenario.durationMs} ms)`
    );
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
    assertApiOk(createdModule, "create_test_editor_audit_module");
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
    assertApiOk(createdTopic, "create_test_editor_audit_topic");
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
    imagesDir: path.join(taskDir, "images"),
  };
}

function resolveStoredTaskAssetPath(taskPaths, assetPath) {
  const normalized = String(assetPath || "").trim().replace(/\\/g, "/");
  if (!normalized) return "";
  if (normalized.startsWith("modules/")) {
    return path.resolve(process.cwd(), "data", normalized);
  }
  return path.resolve(taskPaths.taskDir, normalized);
}

function listFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      out.push(fullPath);
    }
  }
  return out;
}

function computeSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function summarizeImageDir(imagesDir) {
  const files = listFilesRecursive(imagesDir);
  const hashes = new Map();
  for (const filePath of files) {
    const digest = computeSha256(filePath);
    if (!hashes.has(digest)) hashes.set(digest, []);
    hashes.get(digest).push(filePath);
  }
  return {
    files,
    fileCount: files.length,
    duplicateGroups: [...hashes.values()].filter((group) => group.length > 1),
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

function buildFixture(prefix = "pw_test_editor") {
  const suffix = timestampSlug().replace(/[^0-9A-Za-z_-]/g, "").slice(-12);
  return {
    moduleName: `[PW Test Editor] Module ${suffix}`,
    topicName: `[PW Test Editor] Topic ${suffix}`,
    taskName: `[PW Test Editor] Test ${suffix}`,
    questionText: `Smoke question ${suffix}: choose the correct answer.`,
    explanation: `Explanation ${suffix}`,
  };
}

function createTinyPngFixture(artifacts, name = "fixture.png") {
  const fixtureDir = path.join(artifacts.runDir, "fixtures");
  ensureDirectory(fixtureDir);
  const fixturePath = path.join(fixtureDir, name);
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnR0f8AAAAASUVORK5CYII=";
  fs.writeFileSync(fixturePath, Buffer.from(pngBase64, "base64"));
  return fixturePath;
}

function createTextFixture(artifacts, name, contents) {
  const fixtureDir = path.join(artifacts.runDir, "fixtures");
  ensureDirectory(fixtureDir);
  const fixturePath = path.join(fixtureDir, name);
  fs.writeFileSync(fixturePath, contents, "utf8");
  return fixturePath;
}

async function waitForDashboardReady(page, baseUrl) {
  await page.goto(resolveUrl(baseUrl, "/editor"), {
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

async function submitNewTestTask(page, fixture) {
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
  await page.selectOption("#task-type-select", "test");

  await Promise.all([
    page.waitForURL(/\/ui\/editor\/Test%20Task%20Editor%20Multiple%20Choice\.html\?/i, {
      timeout: 30000,
    }),
    page.locator('#create-task-modal button[onclick="dashboard.submitTaskForm()"]').click(),
  ]);

  await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
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

async function saveCurrentTestTask(page, taskRef) {
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

async function ensureOptionCount(page, expectedCount) {
  while ((await page.locator("#options-container .option-row").count()) < expectedCount) {
    await page.locator("#add-option-btn").click();
  }
}

async function setCorrectOptions(page, correctIndexes = []) {
  const wanted = new Set(correctIndexes);
  const buttons = page.locator("#options-container .option-letter");
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const isCorrect = await button.evaluate((node) => node.classList.contains("correct"));
    const shouldBeCorrect = wanted.has(index);
    if (isCorrect !== shouldBeCorrect) {
      await button.click();
    }
  }
}

async function fillCurrentQuestion(page, payload) {
  const {
    questionText,
    explanation = "",
    options = [],
    correctIndexes = [],
  } = payload;

  if (typeof questionText === "string") {
    await page.fill("#question-textarea", questionText);
  }

  if (typeof explanation === "string") {
    await page.fill("#explanation-textarea", explanation);
  }

  if (Array.isArray(options) && options.length) {
    await ensureOptionCount(page, options.length);
    const optionInputs = page.locator("#options-container textarea");
    for (let index = 0; index < options.length; index += 1) {
      await optionInputs.nth(index).fill(options[index]);
    }
  }

  await setCorrectOptions(page, correctIndexes);
}

async function selectQuestionByIndex(page, index) {
  await page.locator(QUESTION_NAV_SELECT_SELECTOR).nth(index).click();
}

async function waitForQuestionText(page, expectedText) {
  await page.waitForFunction(
    (value) => {
      const field = document.querySelector("#question-textarea");
      return !!field && String(field.value || "").trim() === value;
    },
    expectedText,
    { timeout: 30000 }
  );
}

async function waitForOptionText(page, index, expectedText) {
  await page.waitForFunction(
    ({ optionIndex, value }) => {
      const fields = [...document.querySelectorAll("#options-container textarea")];
      const field = fields[optionIndex];
      return !!field && String(field.value || "").trim() === value;
    },
    { optionIndex: index, value: expectedText },
    { timeout: 30000 }
  );
}

async function waitForConfirmModal(page) {
  await page.waitForFunction(() => {
    const legacy = document.querySelector("#custom-confirm-modal");
    const notificationUi = document.querySelector('[data-role="confirm-card"]');
    return Boolean(
      (legacy && legacy.offsetParent !== null) ||
      (notificationUi && notificationUi.offsetParent !== null)
    );
  }, { timeout: 10000 });
}

async function confirmModal(page) {
  await waitForConfirmModal(page);
  if (await page.locator('[data-role="confirm"]').count()) {
    await page.locator('[data-role="confirm"]').click();
    return;
  }
  await page.locator("#confirm-modal-btn").click();
}

async function openEditorDirectly(page, baseUrl, moduleId, topicId, taskId) {
  const editorUrl = resolveUrl(
    baseUrl,
    `/editor/Test%20Task%20Editor%20Multiple%20Choice.html?module=${encodeURIComponent(moduleId)}&topic=${encodeURIComponent(topicId)}&task=${encodeURIComponent(taskId)}`
  );
  await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
  await page.waitForSelector("#options-container .option-row", { state: "visible", timeout: 20000 });
}

async function bootstrapNewTask(baseUrl, moduleId, topicId, taskName, taskType = "test") {
  const result = await fetchJson(baseUrl, "/api/editor/task/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      module_id: moduleId,
      topic_id: topicId,
      task_name: taskName,
      task_type: taskType,
    }),
  });
  return assertApiOk(result, "bootstrap_test_task");
}

async function seedTestTaskViaApi(baseUrl, moduleId, topicId, taskId, payload) {
  const result = await fetchJson(
    baseUrl,
    `/api/editor/task/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/${encodeURIComponent(taskId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return assertApiOk(result, "seed_test_task_via_api");
}

async function openImportModal(page) {
  await page.locator("#import-btn").click();
  await page.waitForSelector("#import-modal", { state: "visible", timeout: 10000 });
}

async function uploadImportFile(page, filePath) {
  await page.locator("#import-input").setInputFiles(filePath);
  await page.waitForFunction(() => {
    const count = document.querySelector("#import-question-count");
    return !!count && String(count.textContent || "").trim() !== "0" && String(count.textContent || "").trim() !== "—";
  });
}

async function chooseImportMode(page, mode) {
  const option = page.locator(`.import-mode-option:has(input[name="import-mode"][value="${mode}"])`);
  await option.click();
}

async function confirmImport(page) {
  await page.locator("#confirm-import-btn").click();
  await page.waitForSelector("#import-modal", { state: "hidden", timeout: 10000 });
}

async function downloadExportFile(page, targetPath) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
  await page.locator("#export-btn").click();
  const download = await downloadPromise;
  await download.saveAs(targetPath);
  return download;
}

async function runScenario(browser, artifacts, options, definition) {
  const context = await browser.newContext({ acceptDownloads: true });
  await context.addInitScript(() => {
    window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
    try {
      const seenKey = "actra_onboarding_seen_v1";
      const seen = JSON.parse(localStorage.getItem(seenKey) || "{}");
      seen["test-editor-authoring"] = Math.max(Number(seen["test-editor-authoring"]) || 0, 1);
      localStorage.setItem(seenKey, JSON.stringify(seen));
    } catch (_) {
      // Onboarding also respects the global flag when localStorage is unavailable.
    }
  });
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
    const failurePath = path.join(artifacts.screenshotDir, `${definition.id}_failure.png`);
    try {
      await page.screenshot({ path: failurePath, fullPage: true });
      result.failureScreenshot = failurePath;
    } catch (_) {
      // Best effort.
    }
  } finally {
    result.durationMs = Date.now() - startedAt;
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("response", onResponse);
    await context.close();
  }

  return result;
}

function createScenarioDefinitions() {
  return [
    {
      id: "s01_create_open_new_test_task",
      title: "Create and open new Test task through dashboard",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          await page.waitForSelector("#task-module-select", { state: "visible", timeout: 10000 });
          return { note: "Create task modal is visible" };
        });

        const taskRef = await step("submit_new_test_task", async () => {
          const created = await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          const paths = buildTaskPaths(created.moduleId, created.topicId, created.taskId);
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("new_test_task_materialized_before_first_save");
          }
          if (!created.isNew) {
            throw new Error("new_task_flag_missing_in_editor_url");
          }
          return {
            note: `Opened task ${created.taskId} without materialized task.json before first save`,
          };
        });

        result.taskRef = `${scope.moduleId}/${scope.topicId}/${new URL(page.url()).searchParams.get("task")}`;
      },
    },
    {
      id: "s02_minimal_valid_save_roundtrip",
      title: "Minimal valid Test task save and reopen roundtrip",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create test task" };
        });

        const created = await step("create_test_task", async () => {
          const taskRef = await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return {
            note: `Editor opened for ${taskRef.taskId}`,
          };
        });

        const url = new URL(page.url());
        const taskRef = {
          moduleId: String(url.searchParams.get("module") || "").trim(),
          topicId: String(url.searchParams.get("topic") || "").trim(),
          taskId: String(url.searchParams.get("task") || "").trim(),
        };
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_minimal_valid_content", async () => {
          await page.fill("#question-textarea", fixture.questionText);
          await page.fill("#explanation-textarea", fixture.explanation);
          const optionInputs = page.locator("#options-container textarea");
          await optionInputs.nth(0).fill("Correct answer");
          await optionInputs.nth(1).fill("Wrong answer");
          return { note: "Question text, explanation and two options are filled" };
        });

        await step("save_task", async () => {
          await saveCurrentTestTask(page, taskRef);
          if (!fs.existsSync(paths.taskJsonPath)) {
            throw new Error("task_json_missing_after_save");
          }
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) {
            throw new Error("task_json_unreadable_after_save");
          }
          if (String(taskJson.type || "").trim() !== "test") {
            throw new Error("saved_task_type_mismatch");
          }
          if (String((((taskJson.meta || {}).name) || "")).trim() !== fixture.taskName) {
            throw new Error("saved_task_name_mismatch");
          }
          const savedQuestion = (((taskJson.content || {}).questions || [])[0] || {}).text || "";
          if (String(savedQuestion).trim() !== fixture.questionText) {
            throw new Error("saved_question_text_mismatch");
          }
          return {
            note: "Save request succeeded and task.json was materialized",
            taskJson,
          };
        });

        await step("reload_and_verify", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
          await page.waitForFunction(
            (expected) => {
              const field = document.querySelector("#question-textarea");
              return !!field && String(field.value || "").trim() === expected;
            },
            fixture.questionText,
            { timeout: 30000 }
          );
          const value = await page.locator("#question-textarea").inputValue();
          if (value.trim() !== fixture.questionText) {
            throw new Error("question_text_not_restored_after_reload");
          }
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Reload preserved saved question text",
            taskJson,
          };
        });

        try {
          await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        } catch (_) {
          // Best effort cleanup; report should not fail because of cleanup only.
        }
      },
    },
    {
      id: "s03_rich_single_question_assets_roundtrip",
      title: "Rich single-question Test task with images save and reopen roundtrip",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const imageFixturePath = createTinyPngFixture(
          artifacts,
          `${safeSlug(fixture.taskName)}_rich.png`
        );
        const richQuestion = {
          questionText: `Rich question ${fixture.taskName}: identify the illustrated answer.`,
          explanation: `Rich explanation for ${fixture.taskName}`,
          options: ["Image-supported correct answer", "Text-only distractor"],
          correctIndexes: [0],
        };

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create rich test task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return {
            note: "Editor opened for rich single-question scenario",
          };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_question_and_upload_assets", async () => {
          await fillCurrentQuestion(page, richQuestion);

          await page.locator("#image-upload-input").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const thumb = document.querySelector("#question-image-thumb");
            return !!thumb && !thumb.classList.contains("hidden");
          });

          await page.locator(".upload-option-image").nth(0).click();
          await page.locator("#option-image-input").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const firstOptionImage = document.querySelector("#options-container img");
            return !!firstOptionImage && String(firstOptionImage.getAttribute("src") || "").length > 0;
          });

          return {
            note: "Question image and first option image are attached before save",
          };
        });

        await step("save_rich_task", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const savedQuestion = (((taskJson?.content || {}).questions || [])[0] || {});
          const questionImagePath = String(savedQuestion.image || savedQuestion.image_path || "").trim();
          const optionImagePath = String((((savedQuestion.answers || [])[0] || {}).image_path) || "").trim();

          if (!questionImagePath) {
            throw new Error("question_image_missing_after_save");
          }
          if (!optionImagePath) {
            throw new Error("option_image_missing_after_save");
          }

          const resolvedQuestionImage = resolveStoredTaskAssetPath(paths, questionImagePath);
          const resolvedOptionImage = resolveStoredTaskAssetPath(paths, optionImagePath);
          if (!fs.existsSync(resolvedQuestionImage)) {
            throw new Error("question_image_file_missing_on_disk");
          }
          if (!fs.existsSync(resolvedOptionImage)) {
            throw new Error("option_image_file_missing_on_disk");
          }

          return {
            note: "Rich task saved with question image and option image on disk",
            taskJson,
          };
        });

        await step("reload_and_verify_rich_state", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
          await waitForQuestionText(page, richQuestion.questionText);
          await waitForOptionText(page, 0, richQuestion.options[0]);
          await page.waitForFunction(() => {
            const thumb = document.querySelector("#question-image-thumb");
            const optionImage = document.querySelector("#options-container img");
            return !!thumb && !thumb.classList.contains("hidden") && !!optionImage;
          });
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Reload preserved rich question text and both attached images",
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
      id: "s04_multi_question_navigation_roundtrip",
      title: "Multi-question navigation preserves state before and after save",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const questionOne = {
          questionText: `Question one ${fixture.taskName}`,
          explanation: `Explanation one ${fixture.taskName}`,
          options: ["Q1 correct", "Q1 distractor"],
          correctIndexes: [0],
        };
        const questionTwo = {
          questionText: `Question two ${fixture.taskName}`,
          explanation: `Explanation two ${fixture.taskName}`,
          options: ["Q2 distractor", "Q2 correct"],
          correctIndexes: [1],
        };

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create multi-question test task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for multi-question scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_first_question", async () => {
          await fillCurrentQuestion(page, questionOne);
          return { note: "First question is filled with distinct content" };
        });

        await step("add_and_fill_second_question", async () => {
          await page.locator("#add-question-btn").click();
          await page.waitForFunction(() => {
            const items = document.querySelectorAll("#question-list [data-question-index]");
            return items.length === 2;
          });
          await fillCurrentQuestion(page, questionTwo);
          return { note: "Second question is added and filled" };
        });

        await step("switch_between_questions", async () => {
          await selectQuestionByIndex(page, 0);
          await waitForQuestionText(page, questionOne.questionText);
          await waitForOptionText(page, 0, questionOne.options[0]);

          await selectQuestionByIndex(page, 1);
          await waitForQuestionText(page, questionTwo.questionText);
          await waitForOptionText(page, 1, questionTwo.options[1]);

          return { note: "Switching between question tabs preserves per-question state" };
        });

        await step("save_multi_question_task", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const questions = ((taskJson?.content || {}).questions || []);
          if (questions.length !== 2) {
            throw new Error("multi_question_count_mismatch_after_save");
          }
          if (String(questions[0]?.text || "").trim() !== questionOne.questionText) {
            throw new Error("question_one_text_mismatch_after_save");
          }
          if (String(questions[1]?.text || "").trim() !== questionTwo.questionText) {
            throw new Error("question_two_text_mismatch_after_save");
          }
          return {
            note: "Two-question task saved with both question payloads intact",
            taskJson,
          };
        });

        await step("reload_and_verify_multi_question_state", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForFunction(() => {
            const items = document.querySelectorAll("#question-list [data-question-index]");
            return items.length === 2;
          });
          await selectQuestionByIndex(page, 0);
          await waitForQuestionText(page, questionOne.questionText);
          await selectQuestionByIndex(page, 1);
          await waitForQuestionText(page, questionTwo.questionText);
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Reload preserved both questions and navigation between them",
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
      id: "s05_reload_and_draft_recovery",
      title: "Unsaved edits survive reload via local draft recovery",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const draftQuestion = {
          questionText: `Draft question ${fixture.taskName}`,
          explanation: `Draft explanation ${fixture.taskName}`,
          options: ["Draft option A", "Draft option B"],
          correctIndexes: [1],
        };

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create draft-recovery test task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for draft recovery scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("edit_unsaved_content", async () => {
          await fillCurrentQuestion(page, draftQuestion);
          return { note: "Unsaved question content differs from editor defaults" };
        });

        await step("persist_local_draft_only", async () => {
          const draftInfo = await page.evaluate(() => {
            window.editor.autoSaveManager.saveDraft();
            const key = window.editor.autoSaveManager.getDraftKey();
            return {
              key,
              hasValue: Boolean(localStorage.getItem(key)),
            };
          });
          if (!draftInfo.key || !draftInfo.hasValue) {
            throw new Error("draft_not_saved_to_local_storage");
          }
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("task_json_should_not_exist_before_first_save");
          }
          return { note: `Local draft persisted under ${draftInfo.key}` };
        });

        await step("reload_and_recover_unsaved_content", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
          await waitForQuestionText(page, draftQuestion.questionText);
          await waitForOptionText(page, 1, draftQuestion.options[1]);
          if (!new URL(page.url()).searchParams.get("new")) {
            throw new Error("new_task_flag_missing_after_draft_reload");
          }
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("task_json_materialized_during_draft_recovery");
          }
          return { note: "Reload restored unsaved draft content without materializing task.json" };
        });

        await step("save_recovered_draft", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const savedQuestion = (((taskJson?.content || {}).questions || [])[0] || {});
          if (String(savedQuestion.text || "").trim() !== draftQuestion.questionText) {
            throw new Error("recovered_draft_text_not_saved");
          }
          return {
            note: "Recovered draft was saved into task.json successfully",
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
      id: "s06_import_replace_roundtrip",
      title: "Import replace swaps current questions with imported set and survives save",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const importFilePath = createTextFixture(
          artifacts,
          `${safeSlug(fixture.taskName)}_replace_import.txt`,
          [
            "? Imported question one",
            "+ Imported correct one",
            "- Imported wrong one",
            "? Imported question two",
            "+ Imported correct two",
            "- Imported wrong two",
            "",
          ].join("\n")
        );

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create import-replace task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for import replace scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("seed_existing_question", async () => {
          await fillCurrentQuestion(page, {
            questionText: `Seed question ${fixture.taskName}`,
            explanation: "Seed explanation",
            options: ["Seed correct", "Seed wrong"],
            correctIndexes: [0],
          });
          return { note: "Editor contains an existing question before import replace" };
        });

        await step("import_replace_file", async () => {
          await openImportModal(page);
          await uploadImportFile(page, importFilePath);
          await chooseImportMode(page, "replace");
          await confirmImport(page);
          await page.waitForFunction(() => document.querySelectorAll("#question-list [data-question-index]").length === 2);
          await waitForQuestionText(page, "Imported question one");
          return { note: "Import replace swapped current content with 2 imported questions" };
        });

        await step("save_import_replace_result", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const questions = ((taskJson?.content || {}).questions || []);
          if (questions.length !== 2) {
            throw new Error("import_replace_question_count_mismatch");
          }
          if (String(questions[0]?.text || "").trim() !== "Imported question one") {
            throw new Error("import_replace_first_question_mismatch");
          }
          if (String(questions[1]?.text || "").trim() !== "Imported question two") {
            throw new Error("import_replace_second_question_mismatch");
          }
          return {
            note: "Imported replace content saved into task.json",
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
      id: "s07_import_append_roundtrip",
      title: "Import append keeps existing question and appends imported question",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const importFilePath = createTextFixture(
          artifacts,
          `${safeSlug(fixture.taskName)}_append_import.txt`,
          [
            "? Appended imported question",
            "+ Appended correct",
            "- Appended wrong",
            "",
          ].join("\n")
        );

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create import-append task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for import append scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);
        const originalQuestionText = `Original append question ${fixture.taskName}`;

        await step("seed_existing_question", async () => {
          await fillCurrentQuestion(page, {
            questionText: originalQuestionText,
            explanation: "Original append explanation",
            options: ["Original correct", "Original wrong"],
            correctIndexes: [0],
          });
          return { note: "Editor contains an original question before append import" };
        });

        await step("import_append_file", async () => {
          await openImportModal(page);
          await uploadImportFile(page, importFilePath);
          await chooseImportMode(page, "append");
          await confirmImport(page);
          await page.waitForFunction(() => document.querySelectorAll("#question-list [data-question-index]").length === 2);
          await selectQuestionByIndex(page, 0);
          await waitForQuestionText(page, originalQuestionText);
          await selectQuestionByIndex(page, 1);
          await waitForQuestionText(page, "Appended imported question");
          return { note: "Import append preserved original question and added imported question" };
        });

        await step("save_import_append_result", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const questions = ((taskJson?.content || {}).questions || []);
          if (questions.length !== 2) {
            throw new Error("import_append_question_count_mismatch");
          }
          if (String(questions[0]?.text || "").trim() !== originalQuestionText) {
            throw new Error("import_append_original_question_mismatch");
          }
          if (String(questions[1]?.text || "").trim() !== "Appended imported question") {
            throw new Error("import_append_imported_question_mismatch");
          }
          return {
            note: "Append import saved both original and imported questions",
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
      id: "s08_export_current_test",
      title: "Export current test downloads a file with current question content",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create export test task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for export scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const exportQuestionText = `Export question ${fixture.taskName}`;
        const exportCorrectText = "Export correct option";

        await step("fill_exportable_content", async () => {
          await fillCurrentQuestion(page, {
            questionText: exportQuestionText,
            explanation: "Export explanation",
            options: [exportCorrectText, "Export wrong option"],
            correctIndexes: [0],
          });
          return { note: "Current test contains exportable question content" };
        });

        await step("export_current_test", async () => {
          const downloadsDir = path.join(artifacts.runDir, "downloads");
          ensureDirectory(downloadsDir);
          const exportPath = path.join(downloadsDir, `${taskRef.taskId || "test"}.txt`);
          const download = await downloadExportFile(page, exportPath);
          if (!fs.existsSync(exportPath)) {
            throw new Error("export_file_not_downloaded");
          }
          const exported = fs.readFileSync(exportPath, "utf8");
          if (!exported.includes(exportQuestionText)) {
            throw new Error("export_missing_question_text");
          }
          if (!exported.includes(`+${exportCorrectText}`)) {
            throw new Error("export_missing_correct_option_marker");
          }
          return {
            note: `Export produced ${download.suggestedFilename()} with expected question content`,
          };
        });
      },
    },
    {
      id: "s10_destructive_flows_clear_and_delete",
      title: "Clear test resets content and delete task removes saved task from disk",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create destructive-flow task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for clear/delete scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_and_save_original_content", async () => {
          await fillCurrentQuestion(page, {
            questionText: `Delete me ${fixture.taskName}`,
            explanation: "This will be cleared and deleted",
            options: ["Keep", "Discard"],
            correctIndexes: [0],
          });
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Task saved before destructive actions",
            taskJson,
          };
        });

        await step("clear_current_test", async () => {
          await page.locator("#clear-test-sidebar-btn").click();
          await confirmModal(page);
          await waitForQuestionText(page, "Новый вопрос");
          await page.waitForFunction(() => document.querySelectorAll("#question-list [data-question-index]").length === 1);
          return { note: "Clear action reset editor to a single default question" };
        });

        await step("save_cleared_state", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const questions = ((taskJson?.content || {}).questions || []);
          if (questions.length !== 1) {
            throw new Error("clear_saved_question_count_mismatch");
          }
          if (String(questions[0]?.text || "").trim() !== "Новый вопрос") {
            throw new Error("clear_saved_default_question_mismatch");
          }
          return {
            note: "Cleared default state was persisted to task.json",
            taskJson,
          };
        });

        await step("delete_saved_task", async () => {
          const deleteResponse = page.waitForResponse(
            (response) =>
              response.request().method() === "DELETE" &&
              response.url().includes(
                `/api/editor/task/${encodeURIComponent(taskRef.moduleId)}/${encodeURIComponent(taskRef.topicId)}/${encodeURIComponent(taskRef.taskId)}`
              ),
            { timeout: 30000 }
          );
          await page.locator("#delete-test-sidebar-btn").click();
          await confirmModal(page);
          const response = await deleteResponse;
          if (!response.ok()) {
            throw new Error(`delete_failed_http_${response.status()}`);
          }
          await page.waitForURL(/\/ui\/editor$/, { timeout: 30000 });
          if (fs.existsSync(paths.taskDir)) {
            throw new Error("task_dir_still_exists_after_delete");
          }
          return { note: "Delete removed task from disk and returned to dashboard" };
        });
      },
    },
    {
      id: "s11_asset_integrity_same_image_reupload",
      title: "Reuploading the same question image does not create duplicate task assets",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const imageFixturePath = createTinyPngFixture(
          artifacts,
          `${safeSlug(fixture.taskName)}_asset_integrity.png`
        );

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create asset-integrity task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for asset integrity scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("upload_and_save_first_image", async () => {
          await fillCurrentQuestion(page, {
            questionText: `Asset integrity question ${fixture.taskName}`,
            explanation: "Testing repeated image upload",
            options: ["Asset correct", "Asset wrong"],
            correctIndexes: [0],
          });
          await page.locator("#image-upload-input").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const thumb = document.querySelector("#question-image-thumb");
            return !!thumb && !thumb.classList.contains("hidden");
          });
          await saveCurrentTestTask(page, taskRef);
          const imageSummary = summarizeImageDir(paths.imagesDir);
          if (imageSummary.fileCount !== 1) {
            throw new Error("asset_integrity_expected_single_image_after_first_save");
          }
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Initial image upload saved exactly one asset file",
            taskJson,
          };
        });

        await step("remove_and_save_without_image", async () => {
          await page.locator("#remove-question-image-btn").click();
          await page.waitForFunction(() => {
            const thumb = document.querySelector("#question-image-thumb");
            return !!thumb && thumb.classList.contains("hidden");
          });
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const savedQuestion = (((taskJson?.content || {}).questions || [])[0] || {});
          if (savedQuestion.image || savedQuestion.image_path) {
            throw new Error("asset_integrity_image_reference_should_be_removed");
          }
          return {
            note: "Question image reference removed from task.json before reupload",
            taskJson,
          };
        });

        await step("reupload_same_image_and_verify_no_duplicates", async () => {
          await page.locator("#image-upload-input").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const thumb = document.querySelector("#question-image-thumb");
            return !!thumb && !thumb.classList.contains("hidden");
          });
          await saveCurrentTestTask(page, taskRef);
          const imageSummary = summarizeImageDir(paths.imagesDir);
          if (imageSummary.duplicateGroups.length > 0) {
            throw new Error("asset_integrity_duplicate_hash_group_detected");
          }
          if (imageSummary.fileCount !== 1) {
            throw new Error("asset_integrity_duplicate_files_created");
          }
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: "Reupload reused the same asset without creating duplicate image files",
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
      id: "s09_invalid_save_guardrails",
      title: "Invalid save guardrails block network save for broken question state",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Ready to create invalid-save test task" };
        });

        await step("create_test_task", async () => {
          await submitNewTestTask(page, {
            ...fixture,
            ...scope,
          });
          return { note: "Editor opened for invalid save scenario" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("prepare_invalid_question_state", async () => {
          await fillCurrentQuestion(page, {
            questionText: `Invalid question ${fixture.taskName}`,
            explanation: "This question intentionally has no correct answers",
            options: ["Option A", "Option B"],
            correctIndexes: [],
          });
          return { note: "Current question has no marked correct answers" };
        });

        await step("attempt_invalid_save", async () => {
          let saveRequestSeen = false;
          const handler = (response) => {
            if (
              response.request().method() === "POST" &&
              response.url().includes(
                `/api/editor/task/${encodeURIComponent(taskRef.moduleId)}/${encodeURIComponent(taskRef.topicId)}/${encodeURIComponent(taskRef.taskId)}`
              )
            ) {
              saveRequestSeen = true;
            }
          };

          page.on("response", handler);
          try {
            await page.locator("#save-task-btn").click();
            await page.waitForTimeout(900);
          } finally {
            page.off("response", handler);
          }

          if (saveRequestSeen) {
            throw new Error("invalid_save_triggered_network_request");
          }
          if (fs.existsSync(paths.taskJsonPath)) {
            throw new Error("invalid_save_materialized_task_json");
          }
          if (!new URL(page.url()).searchParams.get("new")) {
            throw new Error("invalid_save_dropped_new_task_flag");
          }

          return { note: "Broken question state was blocked before network save" };
        });
      },
    },
    {
      id: "s12_multiple_correct_answers_roundtrip",
      title: "Mark multiple correct answers, verify UI label updates, save, reload, confirm both still correct",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => {
          await openCreateTaskModal(page);
          return { note: "Create task modal visible" };
        });

        await step("create_test_task_with_three_options", async () => {
          await submitNewTestTask(page, { ...fixture, ...scope });
          // Add third option
          await fillCurrentQuestion(page, {
            questionText: `Multi-correct question ${fixture.taskName}`,
            explanation: "Two of three options are correct",
            options: ["Option A (correct)", "Option B (correct)", "Option C (wrong)"],
            correctIndexes: [0],
          });
          return { note: "Editor opened with 3 options, option A correct" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("mark_option_b_also_correct", async () => {
          const letterBtns = page.locator("#options-container .option-letter");
          await letterBtns.nth(1).click();
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll("#options-container .option-letter")].filter((b) =>
                b.classList.contains("correct")
              ).length === 2,
            { timeout: 5000 }
          );
          const answerTypeLabel = await page.$eval(
            "#answer-type-display",
            (el) => el.textContent.trim()
          );
          if (!answerTypeLabel.includes("Множественный")) {
            throw new Error(`answer_type_label_not_updated: "${answerTypeLabel}"`);
          }
          return {
            note: `#answer-type-display = "${answerTypeLabel}" — correctly updated to multiple choice`,
          };
        });

        await step("save_and_verify_two_correct_in_task_json", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const answers = taskJson?.content?.questions?.[0]?.answers || [];
          const correctAnswers = answers.filter((a) => a.correct);
          if (correctAnswers.length !== 2) {
            throw new Error(`expected_2_correct_in_task_json_got_${correctAnswers.length}`);
          }
          const wrongAnswers = answers.filter((a) => !a.correct);
          if (wrongAnswers.length !== 1) {
            throw new Error(`expected_1_wrong_in_task_json_got_${wrongAnswers.length}`);
          }
          return {
            note: `PRESERVED: task.json has ${correctAnswers.length}/${answers.length} correct answers`,
            taskJson,
          };
        });

        await step("reload_and_verify_two_correct_in_ui", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#question-textarea", { state: "visible", timeout: 30000 });
          await page.waitForSelector("#options-container .option-row", { state: "visible", timeout: 20000 });
          const correctInUI = await page.$$eval(
            "#options-container .option-letter",
            (btns) => btns.filter((b) => b.classList.contains("correct")).length
          );
          if (correctInUI !== 2) {
            throw new Error(`after_reload_expected_2_correct_ui_got_${correctInUI}`);
          }
          const answerTypeLabel = await page.$eval(
            "#answer-type-display",
            (el) => el.textContent.trim()
          );
          const taskJson = readTaskJson(paths.taskJsonPath);
          return {
            note: `After reload: ${correctInUI} correct in UI, label="${answerTypeLabel}"`,
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
      id: "s13_test_type_not_recalculated_gap",
      title: "GAP: test_type is taken from old content on save, not recalculated from current correctness",
      async run({ page, step, options, artifacts, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        // Step 1: bootstrap a task ID without going through browser
        let taskId;
        await step("bootstrap_task_via_api", async () => {
          const bootstrapResult = await bootstrapNewTask(
            options.baseUrl, scope.moduleId, scope.topicId, fixture.taskName, "test"
          );
          taskId =
            bootstrapResult.task_id ||
            bootstrapResult.id ||
            bootstrapResult.task?.metadata?.id ||
            bootstrapResult.task?.task_data?.meta?.id;
          if (!taskId) {
            throw new Error(`bootstrap_no_task_id: ${JSON.stringify(Object.keys(bootstrapResult))}`);
          }
          result.taskRef = `${scope.moduleId}/${scope.topicId}/${taskId}`;
          return { note: `Bootstrapped task id: ${taskId}` };
        });

        const paths = buildTaskPaths(scope.moduleId, scope.topicId, taskId);
        const taskRef = { moduleId: scope.moduleId, topicId: scope.topicId, taskId };

        // Step 2: seed via POST so task.json has test_type = "single_choice" and 1 correct answer
        await step("seed_single_choice_task_via_api", async () => {
          await seedTestTaskViaApi(options.baseUrl, scope.moduleId, scope.topicId, taskId, {
            type: "test",
            name: fixture.taskName,
            meta: {
              id: taskId,
              name: fixture.taskName,
              module: scope.moduleId,
              topic: scope.topicId,
            },
            content: {
              test_type: "single_choice",
              settings: { shuffle_questions: true, shuffle_answers: true, passing_score: 70 },
              questions: [
                {
                  id: 1,
                  text: fixture.questionText,
                  answers: [
                    { text: "Option A", correct: true },
                    { text: "Option B", correct: false },
                    { text: "Option C", correct: false },
                  ],
                },
              ],
            },
          });
          const taskJson = readTaskJson(paths.taskJsonPath);
          const seededType = taskJson?.content?.test_type;
          if (seededType !== "single_choice") {
            throw new Error(`seed_test_type_mismatch: got "${seededType}"`);
          }
          return {
            note: `Seeded: test_type="${seededType}", 1 correct answer`,
            taskJson,
          };
        });

        // Step 3: open in editor, mark second option also correct
        await step("open_task_and_mark_second_correct", async () => {
          await openEditorDirectly(page, options.baseUrl, scope.moduleId, scope.topicId, taskId);
          const typeLabel = await page.$eval("#answer-type-display", (el) => el.textContent.trim());
          // Now mark option B (index 1) as correct too
          const letterBtns = page.locator("#options-container .option-letter");
          const bIsCorrect = await letterBtns.nth(1).evaluate((el) =>
            el.classList.contains("correct")
          );
          if (!bIsCorrect) await letterBtns.nth(1).click();
          await page.waitForFunction(
            () =>
              [...document.querySelectorAll("#options-container .option-letter")].filter((b) =>
                b.classList.contains("correct")
              ).length === 2,
            { timeout: 5000 }
          );
          const newLabel = await page.$eval("#answer-type-display", (el) => el.textContent.trim());
          return {
            note: `Opened editor. Initial label: "${typeLabel}". After marking B: "${newLabel}"`,
          };
        });

        // Step 4: save and check what test_type ends up in task.json
        await step("save_and_inspect_test_type_in_task_json", async () => {
          await saveCurrentTestTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const savedTestType = taskJson?.content?.test_type;
          const correctCount = (taskJson?.content?.questions?.[0]?.answers || []).filter(
            (a) => a.correct
          ).length;

          // GAP: buildBackendContent() takes test_type from originalContent, does not recalculate.
          // So it stays "single_choice" even though two answers are now correct.
          const gapConfirmed = savedTestType === "single_choice" && correctCount === 2;
          const note = gapConfirmed
            ? `GAP_CONFIRMED: test_type="${savedTestType}" (unchanged from seed) but ${correctCount} answers are correct=true in task.json. buildBackendContent() does not recalculate test_type from current correctness structure.`
            : `UNEXPECTED: test_type="${savedTestType}", correct=${correctCount}. Gap may have been fixed — verify buildBackendContent().`;
          return {
            note,
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
  ];
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
    console.error(`Test editor browser audit finished with failures. Report: ${artifacts.mdPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Test editor browser audit passed. Report: ${artifacts.mdPath}`);
}

main().catch((error) => {
  console.error("[test_editor_browser_audit] Fatal error:", error);
  process.exitCode = 1;
});
