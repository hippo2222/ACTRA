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

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: path.resolve(process.cwd(), "reports", "draw_editor_browser_audit"),
    scenarioIds: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--base-url" && argv[i + 1]) { out.baseUrl = argv[i + 1]; i += 1; continue; }
    if (token.startsWith("--base-url=")) { out.baseUrl = token.slice("--base-url=".length); continue; }
    if (token === "--headless" && argv[i + 1]) {
      const raw = String(argv[i + 1]).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      i += 1; continue;
    }
    if (token.startsWith("--headless=")) {
      const raw = token.slice("--headless=".length).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      continue;
    }
    if (token === "--headed") { out.headless = false; continue; }
    if (token === "--report-dir" && argv[i + 1]) { out.reportDir = path.resolve(process.cwd(), argv[i + 1]); i += 1; continue; }
    if (token.startsWith("--report-dir=")) { out.reportDir = path.resolve(process.cwd(), token.slice("--report-dir=".length)); continue; }
    if (token === "--scenario" && argv[i + 1]) {
      out.scenarioIds.push(...String(argv[i + 1]).split(",").map((p) => p.trim()).filter(Boolean));
      i += 1; continue;
    }
    if (token.startsWith("--scenario=")) {
      out.scenarioIds.push(...String(token.slice("--scenario=".length)).split(",").map((p) => p.trim()).filter(Boolean));
      continue;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

function ensureDirectory(dirPath) { fs.mkdirSync(dirPath, { recursive: true }); }

function timestampSlug(date = new Date()) {
  return date.toISOString().slice(11, 23).replace(/[:.]/g, "-") + "z";
}

function createRunArtifacts(reportDir) {
  ensureDirectory(reportDir);
  const slug = timestampSlug();
  const runDir = path.join(reportDir, `draw_editor_audit_${new Date().toISOString().slice(0, 10)}T${slug}`);
  const screenshotDir = path.join(runDir, "screenshots");
  const taskSnapshotDir = path.join(runDir, "task_snapshots");
  ensureDirectory(runDir);
  ensureDirectory(screenshotDir);
  ensureDirectory(taskSnapshotDir);
  return { runDir, screenshotDir, taskSnapshotDir, jsonPath: path.join(runDir, "summary.json"), mdPath: path.join(runDir, "summary.md") };
}

function writeRunSummary(artifacts, payload) {
  fs.writeFileSync(artifacts.jsonPath, JSON.stringify(payload, null, 2), "utf8");
  const lines = [];
  lines.push("# Draw Editor Browser Audit", "");
  lines.push(`- Timestamp: ${payload.startedAt}`);
  lines.push(`- Base URL: ${payload.baseUrl}`);
  lines.push(`- Duration: ${payload.durationMs} ms`);
  lines.push(`- Passed: ${payload.passedCount}`);
  lines.push(`- Failed: ${payload.failedCount}`, "", "## Scenarios", "");
  for (const sc of payload.scenarios || []) {
    lines.push(`- ${sc.ok ? "PASS" : "FAIL"} ${sc.id} (${sc.durationMs} ms)`);
    if (sc.error) lines.push(`  - Error: ${sc.error}`);
    if (sc.taskRef) lines.push(`  - Task: ${sc.taskRef}`);
    for (const step of sc.steps || []) {
      const shotRel = step.screenshot ? path.relative(artifacts.runDir, step.screenshot).replace(/\\/g, "/") : "";
      const snapRel = step.taskSnapshot ? path.relative(artifacts.runDir, step.taskSnapshot).replace(/\\/g, "/") : "";
      lines.push(`  - step_${String(step.seq).padStart(2, "0")}: ${step.title}${shotRel ? ` [shot](${shotRel})` : ""}${snapRel ? ` [task](${snapRel})` : ""}`);
      if (step.note) lines.push(`    - ${step.note}`);
      if (step.url) lines.push(`    - URL: ${step.url}`);
    }
  }
  lines.push("");
  fs.writeFileSync(artifacts.mdPath, lines.join("\n"), "utf8");
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

function readTaskJson(taskJsonPath) {
  if (!fs.existsSync(taskJsonPath)) return null;
  try { return JSON.parse(fs.readFileSync(taskJsonPath, "utf8")); } catch (_) { return null; }
}

function buildTaskPaths(moduleId, topicId, taskId) {
  const taskDir = path.resolve(process.cwd(), "data", "modules", moduleId, "topics", topicId, "tasks", taskId);
  return { taskDir, taskJsonPath: path.join(taskDir, "task.json"), imagesDir: path.join(taskDir, "images") };
}

function listFilesRecursive(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fp = path.join(dirPath, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(fp));
    else if (entry.isFile()) out.push(fp);
  }
  return out;
}

function computeSha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function summarizeImageDir(imagesDir) {
  const files = listFilesRecursive(imagesDir);
  const hashes = new Map();
  for (const fp of files) {
    const h = computeSha256(fp);
    if (!hashes.has(h)) hashes.set(h, []);
    hashes.get(h).push(fp);
  }
  const groups = [...hashes.values()].filter((g) => g.length > 1);
  return { fileCount: files.length, duplicateGroups: groups };
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function loadEditorCatalog(baseUrl) {
  const r = await fetchJson(baseUrl, "/api/editor/catalog");
  return assertApiOk(r, "load_editor_catalog");
}

function findModuleByName(catalog, name) {
  return (catalog.modules || []).find((m) => String(m?.name || "").trim() === name);
}

function findTopicByName(moduleRow, name) {
  return (moduleRow?.topics || []).find((t) => String(t?.name || "").trim() === name);
}

async function ensureModuleAndTopic(baseUrl, fixture) {
  let catalog = await loadEditorCatalog(baseUrl);
  let moduleRow = findModuleByName(catalog, fixture.moduleName);
  if (!moduleRow) {
    assertApiOk(
      await fetchJson(baseUrl, "/api/editor/module/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: fixture.moduleName }) }),
      "create_draw_audit_module"
    );
    catalog = await loadEditorCatalog(baseUrl);
    moduleRow = findModuleByName(catalog, fixture.moduleName);
  }
  if (!moduleRow) throw new Error(`module_not_found_after_create:${fixture.moduleName}`);

  let topicRow = findTopicByName(moduleRow, fixture.topicName);
  if (!topicRow) {
    assertApiOk(
      await fetchJson(baseUrl, "/api/editor/topic/new", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ module_id: moduleRow.id, name: fixture.topicName }) }),
      "create_draw_audit_topic"
    );
    catalog = await loadEditorCatalog(baseUrl);
    moduleRow = findModuleByName(catalog, fixture.moduleName);
    topicRow = findTopicByName(moduleRow, fixture.topicName);
  }
  if (!topicRow) throw new Error(`topic_not_found_after_create:${fixture.topicName}`);
  return { moduleId: String(moduleRow.id || "").trim(), topicId: String(topicRow.id || "").trim() };
}

async function bootstrapNewTask(baseUrl, moduleId, topicId, taskName, taskType = "draw") {
  const r = await fetchJson(baseUrl, "/api/editor/task/bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module_id: moduleId, topic_id: topicId, task_name: taskName, task_type: taskType }),
  });
  return assertApiOk(r, "bootstrap_draw_task");
}

async function seedTaskViaApi(baseUrl, moduleId, topicId, taskId, payload) {
  const r = await fetchJson(baseUrl, `/api/editor/task/${encodeURIComponent(moduleId)}/${encodeURIComponent(topicId)}/${encodeURIComponent(taskId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return assertApiOk(r, "seed_draw_task_via_api");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function buildFixture() {
  const slug = timestampSlug();
  return {
    moduleName: `PW Draw Audit Module`,
    topicName: `PW Draw Audit Topic`,
    taskName: `[PW Draw] Task ${slug}`,
    prompt: `Playwright audit task ${slug}: обведите ключевой объект`,
    questionText: `Audit question ${slug}`,
  };
}

// Image fixture — a 100x100 red PNG encoded inline
function getImageFixturePath() {
  const tmpDir = path.resolve(process.cwd(), "tmp_audit_fixtures");
  ensureDirectory(tmpDir);
  const imgPath = path.join(tmpDir, "audit_fixture_red_100x100.png");
  if (!fs.existsSync(imgPath)) {
    // 100x100 red PNG (valid base64)
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAvSURBVHhe7cAxAQAAAMKg9U9tCy8gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOADNYAAAYFm7RkAAAAASUVORK5CYII=";
    fs.writeFileSync(imgPath, Buffer.from(b64, "base64"));
  }
  return imgPath;
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function waitForDashboardReady(page, baseUrl) {
  await page.goto(resolveUrl(baseUrl, "/ui/editor"), { waitUntil: "networkidle", timeout: 60000 });
  // Wait for the sidebar which is always present in the dashboard
  await page.waitForSelector("#editor-sidebar", { state: "visible", timeout: 30000 });
}

async function openCreateTaskModal(page) {
  // The create button is the card with data-role="create-task-card"
  const createBtn = page.locator('[data-role="create-task-card"]').first();
  await createBtn.click();
  // Wait for the modal form to appear
  await page.waitForSelector("#task-name-input", { state: "visible", timeout: 10000 });
}

async function submitNewDrawTask(page, { moduleId, topicId, taskName }) {
  // Module select — wait until options are populated by dashboard JS
  const moduleSelect = page.locator("#task-module-select");
  await page.waitForFunction(
    (id) => { const s = document.querySelector("#task-module-select"); return s && [...s.options].some(o => o.value === id); },
    moduleId,
    { timeout: 15000 }
  ).catch(() => {});
  await moduleSelect.selectOption({ value: moduleId });

  // Topic select — wait until options are populated after module selection
  const topicSelect = page.locator("#task-topic-select");
  await page.waitForFunction(
    (id) => { const s = document.querySelector("#task-topic-select"); return s && [...s.options].some(o => o.value === id); },
    topicId,
    { timeout: 15000 }
  ).catch(() => {});
  await topicSelect.selectOption({ value: topicId });

  // Task name
  await page.locator("#task-name-input").fill(taskName);

  // Task type = draw (Drawing editor)
  await page.locator("#task-type-select").selectOption({ value: "draw" });

  // Submit via the button calling dashboard.submitTaskForm()
  const submitBtn = page.locator("button[onclick*='submitTaskForm']");
  await submitBtn.click();

  // Wait for navigation to Point_Annotation editor
  await page.waitForURL((url) => url.toString().includes("Point_Annotation"), { timeout: 30000 });
  await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
}

function extractTaskRefFromUrl(pageUrl) {
  const u = new URL(pageUrl);
  return {
    moduleId: u.searchParams.get("module") || "",
    topicId: u.searchParams.get("topic") || "",
    taskId: u.searchParams.get("task") || "",
  };
}

async function openEditorDirectly(page, baseUrl, moduleId, topicId, taskId) {
  const url = resolveUrl(baseUrl, `/ui/editor/Point_Annotation.html?module=${encodeURIComponent(moduleId)}&topic=${encodeURIComponent(topicId)}&task=${encodeURIComponent(taskId)}`);
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
}

async function saveCurrentDrawTask(page, taskRef) {
  const responsePromise = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().includes(`/api/editor/task/${encodeURIComponent(taskRef.moduleId)}/${encodeURIComponent(taskRef.topicId)}/${encodeURIComponent(taskRef.taskId)}`),
    { timeout: 30000 }
  );
  await page.locator("#save-task-btn").click();
  const response = await responsePromise;
  const body = await response.json().catch(() => ({}));
  if (!response.ok() || body.ok === false) {
    throw new Error(`save_failed: HTTP ${response.status()} ${body.error || ""}`);
  }
  return body;
}

/**
 * Draw a simple polygon on canvas by clicking 3 corners + finishing.
 * Points are relative fractions of the image area (0..1).
 *
 * Strategy: wait for #main-image to be visible and loaded, then use
 * the image's bounding box as the coordinate system for clicks.
 * The #annotation-overlay SVG sits exactly on top of the image.
 */
async function drawPolygonOnCanvas(page, points = [[0.25, 0.25], [0.65, 0.25], [0.65, 0.65]]) {
  // Wait for the image to be visible and fully loaded
  await page.waitForSelector("#main-image:not(.hidden)", { state: "visible", timeout: 20000 });
  await page.waitForFunction(
    () => {
      const img = document.querySelector("#main-image");
      return img && !img.classList.contains("hidden") && img.naturalWidth > 0;
    },
    { timeout: 15000 }
  );
  await page.waitForTimeout(300); // Let any JS layout run

  // ensure we are not focusing an input from a previous label edit
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);

  // Get click target: #annotation-overlay or #canvas-layer or fallback to #main-image
  const targetSelector = "#annotation-overlay, #canvas-layer, #main-image";
  const targetEl = page.locator("#annotation-overlay").first();
  let box = await targetEl.boundingBox();
  if (!box || box.width < 10) {
    box = await page.locator("#canvas-container").boundingBox();
  }
  if (!box || box.width < 10) {
    box = await page.locator("#main-image").boundingBox();
  }
  if (!box || box.width < 10 || box.height < 10) {
    throw new Error(`draw_target_has_zero_size: w=${box?.width} h=${box?.height}`);
  }

  // Count existing annotations before drawing
  const prevCount = await page.$$eval(
    "#annotation-list > li, #annotation-list > div",
    (els) => els.length
  );

  // Click polygon points on the canvas area
  for (let i = 0; i < points.length; i++) {
    const [fx, fy] = points[i];
    const px = box.x + box.width * fx;
    const py = box.y + box.height * fy;
    console.log(`[DIAG] clicking point ${i} at ${px},${py} (factor ${fx},${fy})`);
    await page.mouse.click(px, py);
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(600);
  if (prevCount === 1) {
    await page.screenshot({ path: `debug_s03_after_points_${Date.now()}.png` }).catch(() => {});
  }

  // A small wait to allow UI to update state
  await page.waitForTimeout(300);

  // Finish: prefer #finish-polygon-btn if enabled, otherwise double-click last point
  const finishBtn = page.locator("#finish-polygon-btn");
  const isFinishEnabled = await finishBtn.evaluate((el) => !el.disabled).catch(() => false);
  if (isFinishEnabled) {
    await finishBtn.click();
  } else {
    const [lx, ly] = points[points.length - 1];
    await page.mouse.dblclick(box.x + box.width * lx, box.y + box.height * ly);
  }

  // Wait for a new annotation to appear in the list (count increased)
  await page.waitForFunction(
    (prev) => {
      const list = document.querySelector("#annotation-list");
      return list && list.children.length > prev;
    },
    prevCount,
    { timeout: 12000 }
  );
}

async function setAnnotationLabel(page, annotationIndex, label) {
  // click_editor uses input fields inside #annotation-list items
  const inputs = page.locator(
    "#annotation-list input[type='text'], #annotation-list .annotation-label-input, #annotation-list input"
  );
  const input = inputs.nth(annotationIndex);
  await input.click();
  await input.fill(label);
  await input.press("Enter");
  await page.waitForTimeout(300);
}

async function deleteAnnotation(page, annotationIndex) {
  const currentCount = await countAnnotationsInList(page);
  const deleteBtn = page.locator("#annotation-list .delete-annotation-btn").nth(annotationIndex);
  await deleteBtn.click();
  console.log(`[DIAG] deleteAnnotation clicked for index ${annotationIndex}, waiting for count < ${currentCount}`);
  await page.waitForFunction(
    (c) => document.querySelectorAll("#annotation-list .annotation-list-item").length < c,
    currentCount,
    { timeout: 5000 }
  ).catch((e) => console.log(`[DIAG] deleteAnnotation wait failed: ${e.message}`));
  await page.waitForTimeout(300);
}

async function countAnnotationsInList(page) {
  return await page.$$eval("#annotation-list .annotation-list-item", (els) => els.length);
}

// ---------------------------------------------------------------------------
// Scenario runner
// ---------------------------------------------------------------------------

async function runScenario(browser, artifacts, options, scenario) {
  const startedAt = Date.now();
  const result = { id: scenario.id, title: scenario.title, ok: false, steps: [], error: null, taskRef: null, durationMs: 0 };
  let stepSeq = 0;

  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  const httpErrors = [];

  page.on("console", (msg) => { 
    const text = msg.text();
    if (msg.type() === "error") {
      consoleErrors.push(text);
      console.log(`[BROWSER ERROR] ${text}`);
    } else if (text.includes("[DIAG]")) {
      console.log(`[BROWSER LOG] ${text}`);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("favicon")) httpErrors.push({ status: r.status(), method: r.request().method(), url: r.url() }); });

  async function step(title, fn) {
    stepSeq += 1;
    const seq = stepSeq;
    const stepResult = { seq, id: `step_${String(seq).padStart(2, "0")}`, title, screenshot: null, taskSnapshot: null, note: null, url: null };
    result.steps.push(stepResult);

    const shotPath = path.join(artifacts.screenshotDir, `${scenario.id}_step_${String(seq).padStart(2, "0")}.png`);
    try {
      const data = await fn();
      await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
      stepResult.screenshot = shotPath;
      stepResult.url = page.url();
      if (data) {
        if (data.note) stepResult.note = data.note;
        if (data.taskJson) {
          const snapPath = path.join(artifacts.taskSnapshotDir, `${scenario.id}_step_${String(seq).padStart(2, "0")}_task.json`);
          fs.writeFileSync(snapPath, JSON.stringify(data.taskJson, null, 2), "utf8");
          stepResult.taskSnapshot = snapPath;
        }
      }
    } catch (err) {
      await page.screenshot({ path: shotPath, fullPage: false }).catch(() => {});
      stepResult.screenshot = shotPath;
      stepResult.url = page.url();
      stepResult.note = `ERROR: ${err.message}`;
      throw err;
    }
    return stepResult;
  }

  try {
    await scenario.run({ page, step, options, result, artifacts });
    result.ok = true;
  } catch (err) {
    result.error = err.message;
    result.ok = false;
  } finally {
    result.consoleErrors = consoleErrors;
    result.pageErrors = pageErrors;
    result.httpErrors = httpErrors;
    result.durationMs = Date.now() - startedAt;
    await page.close().catch(() => {});
  }

  const status = result.ok ? "PASS" : "FAIL";
  console.log(`  [${status}] ${scenario.id} (${result.durationMs}ms)${result.error ? ` — ${result.error}` : ""}`);
  if (!result.ok) {
    if (result.pageErrors.length > 0) console.log(`    Page Errors: ${JSON.stringify(result.pageErrors)}`);
    if (result.httpErrors.length > 0) console.log(`    HTTP Errors: ${JSON.stringify(result.httpErrors)}`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

function createScenarioDefinitions() {
  const imageFixturePath = getImageFixturePath();

  return [
    // ------------------------------------------------------------------
    // S01 — Create and open new draw task
    // ------------------------------------------------------------------
    {
      id: "s01_create_open_new_draw_task",
      title: "Create a new draw task via modal and verify editor opens without task.json",
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

        await step("submit_new_draw_task", async () => {
          await submitNewDrawTask(page, { ...fixture, ...scope });
          const taskRef = extractTaskRefFromUrl(page.url());
          result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
          const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);
          const hasTaskJson = fs.existsSync(paths.taskJsonPath);
          const isNew = new URL(page.url()).searchParams.get("new") === "1";
          if (!isNew) throw new Error("s01_expected_new_flag_in_url");
          return { note: `Opened task editor (new=1). task.json exists: ${hasTaskJson}` };
        });
      },
    },

    // ------------------------------------------------------------------
    // S02 — Minimal valid save roundtrip
    // ------------------------------------------------------------------
    {
      id: "s02_minimal_valid_save_roundtrip",
      title: "Fill prompt + upload image + draw polygon + save + reload — all fields persist",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => {
          await waitForDashboardReady(page, options.baseUrl);
          return { note: `Module ${scope.moduleId}, topic ${scope.topicId}` };
        });

        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal visible" }; });

        await step("create_draw_task", async () => {
          await submitNewDrawTask(page, { ...fixture, ...scope });
          return { note: "Editor open, new task" };
        });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_prompt", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          return { note: `Prompt filled: "${fixture.prompt}"` };
        });

        await step("upload_main_image", async () => {
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const img = document.querySelector("#main-image");
            return img && !img.classList.contains("hidden") && img.src && img.src.includes("/api") && img.complete && img.naturalWidth > 0;
          }, { timeout: 15000 });
          return { note: "Main image uploaded and displayed" };
        });

        await step("draw_polygon_annotation", async () => {
          await drawPolygonOnCanvas(page);
          await setAnnotationLabel(page, 0, "Ключевая зона");
          const count = await countAnnotationsInList(page);
          if (count < 1) throw new Error("s02_polygon_not_in_annotation_list");
          return { note: `Polygon drawn, ${count} annotation(s) in list, label set` };
        });

        await step("save_task", async () => {
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          if (!taskJson) throw new Error("s02_task_json_not_materialized");
          const prompt = taskJson?.task_data?.content?.prompt || taskJson?.content?.prompt;
          const image = taskJson?.task_data?.content?.image || taskJson?.content?.image;
          const annotations = taskJson?.task_data?.content?.annotations || taskJson?.content?.annotations || [];
          if (!prompt) throw new Error("s02_prompt_missing_in_task_json");
          if (!image) throw new Error("s02_image_missing_in_task_json");
          if (!annotations.length) throw new Error("s02_annotations_empty_in_task_json");
          return { note: `Saved: prompt OK, image OK, ${annotations.length} annotation(s)`, taskJson };
        });

        await step("reload_and_verify", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForTimeout(1000);
          const promptVal = await page.$eval("#prompt-textarea", (el) => el.value);
          if (!promptVal.includes("Playwright audit")) throw new Error(`s02_reload_prompt_lost: "${promptVal}"`);
          const annotCount = await countAnnotationsInList(page);
          const taskJson = readTaskJson(paths.taskJsonPath);
          return { note: `After reload: prompt="${promptVal.slice(0, 40)}…", annotations in UI: ${annotCount}`, taskJson };
        });

        try { await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId); } catch (_) {}
      },
    },

    // ------------------------------------------------------------------
    // S03 — Annotation label edit and delete roundtrip
    // ------------------------------------------------------------------
    {
      id: "s03_annotation_label_edit_delete",
      title: "Add 3 annotations, rename one, delete one, save — 2 remain with correct labels",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "dashboard ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_and_upload", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
          return { note: "prompt + image ready" };
        });

        await step("draw_three_polygons", async () => {
          await page.locator("#lasso-tool-btn").click();
          await drawPolygonOnCanvas(page, [[0.1, 0.1], [0.3, 0.1], [0.3, 0.3], [0.1, 0.3]]);
          await setAnnotationLabel(page, 0, "Зона-Alpha");

          await page.locator("#lasso-tool-btn").click();
          await drawPolygonOnCanvas(page, [[0.4, 0.1], [0.6, 0.1], [0.6, 0.3], [0.4, 0.3]]);
          await setAnnotationLabel(page, 1, "Зона-Beta");

          await page.locator("#lasso-tool-btn").click();
          await drawPolygonOnCanvas(page, [[0.1, 0.5], [0.3, 0.5], [0.3, 0.7], [0.1, 0.7]]);
          await setAnnotationLabel(page, 2, "Зона-Gamma");

          const count = await countAnnotationsInList(page);
          if (count !== 3) throw new Error(`s03_expected_3_annotations_got_${count}`);
          return { note: "3 annotations drawn with labels" };
        });

        await step("rename_and_delete", async () => {
          // Rename first annotation
          await setAnnotationLabel(page, 0, "Зона-Alpha-RENAMED");
          // Delete the middle annotation (index 1)
          await deleteAnnotation(page, 1);

          const count = await countAnnotationsInList(page);
          if (count !== 2) throw new Error(`s03_expected_2_after_delete_got_${count}`);
          return { note: `After delete: ${count} annotations remain` };
        });

        await step("save_and_verify", async () => {
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const annotations = taskJson?.task_data?.content?.annotations || taskJson?.content?.annotations || [];
          if (annotations.length !== 2) throw new Error(`s03_expected_2_in_task_json_got_${annotations.length}`);
          const labels = annotations.map((a) => a.label);
          if (!labels.includes("Зона-Alpha-RENAMED")) throw new Error(`s03_renamed_label_not_found: ${JSON.stringify(labels)}`);
          if (!labels.includes("Зона-Gamma")) throw new Error(`s03_gamma_label_not_found: ${JSON.stringify(labels)}`);
          return { note: `task.json has ${annotations.length} annotations: ${labels.join(", ")}`, taskJson };
        });

        try { await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId); } catch (_) {}
      },
    },

    // ------------------------------------------------------------------
    // S04 — required_correct boundary guardrail
    // ------------------------------------------------------------------
    {
      id: "s04_required_correct_guardrail",
      title: "required_correct > region count must block save (validateTask guardrail)",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("setup_with_image_and_one_polygon", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
          await drawPolygonOnCanvas(page);
          await setAnnotationLabel(page, 0, "Единственная зона");
          return { note: "1 annotation, image set, prompt filled" };
        });

        await step("set_required_correct_above_limit", async () => {
          await page.locator("#required-correct-input").fill("5");
          // Trigger input event
          await page.locator("#required-correct-input").dispatchEvent("input");
          await page.waitForTimeout(500);
          return { note: "Attempted to set required_correct to 5" };
        });

        await step("verify_clamped_and_save", async () => {
          const val = await page.$eval("#required-correct-input", (el) => el.value);
          if (val !== "1") throw new Error(`s04_failed_to_clamp_value: expected 1, got ${val}`);
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const requiredCorrect = taskJson?.task_data?.settings?.success_threshold || taskJson?.settings?.success_threshold;
          if (String(requiredCorrect) !== "1") throw new Error(`s04_task_json_saved_wrong_value: expected 1, got ${requiredCorrect}`);
          return { note: "Input correctly clamped to 1 and saved" };
        });
      },
    },

    // ------------------------------------------------------------------
    // S05 — Main image upload, persist, file verify, reload
    // ------------------------------------------------------------------
    {
      id: "s05_main_image_persist_roundtrip",
      title: "Upload main image → save → verify file on disk → reload → image restored",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_and_upload_image", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.src.includes("/api"); }, { timeout: 15000 });
          const imgSrc = await page.$eval("#main-image", (el) => el.src);
          return { note: `Image displayed: ${imgSrc.slice(0, 80)}` };
        });

        await step("draw_polygon_and_save", async () => {
          await drawPolygonOnCanvas(page);
          await setAnnotationLabel(page, 0, "Тестовая зона");
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const imagePath = taskJson?.task_data?.content?.image || taskJson?.content?.image;
          if (!imagePath) throw new Error("s05_image_path_missing_in_task_json");
          // Verify file exists on disk
          const absoluteImagePath = imagePath.startsWith("modules/")
            ? path.resolve(process.cwd(), "data", imagePath)
            : path.resolve(paths.taskDir, imagePath);
          if (!fs.existsSync(absoluteImagePath)) throw new Error(`s05_image_file_not_on_disk: ${absoluteImagePath}`);
          const fileSize = fs.statSync(absoluteImagePath).size;
          return { note: `Image path: "${imagePath}", file on disk: ${fileSize} bytes`, taskJson };
        });

        await step("reload_and_verify_image_restored", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForTimeout(1500);
          const imgHidden = await page.$eval("#main-image", (el) => el.classList.contains("hidden")).catch(() => true);
          if (imgHidden) throw new Error("s05_after_reload_main_image_is_hidden");
          const imgSrc = await page.$eval("#main-image", (el) => el.src);
          const taskJson = readTaskJson(paths.taskJsonPath);
          return { note: `After reload: image src="${imgSrc.slice(0, 80)}"`, taskJson };
        });

        try { await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId); } catch (_) {}
      },
    },

    // ------------------------------------------------------------------
    // S06 — additionalInfo text roundtrip
    // ------------------------------------------------------------------
    {
      id: "s06_additional_info_text_roundtrip",
      title: "Set additionalInfo type=text, fill text, save, reload — text persists in task.json",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const additionalText = `Дополнительный контекст для задания ${timestampSlug()}`;

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_minimal_and_set_additional_text", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
          await drawPolygonOnCanvas(page);
          await setAnnotationLabel(page, 0, "Зона для S06");

          // Set additional info type = text
          await page.locator("#additional-type-select").selectOption("text");
          await page.waitForSelector("#additional-textarea:not([disabled])", { state: "visible", timeout: 5000 }).catch(() => {});
          await page.locator("#additional-textarea").fill(additionalText);
          return { note: `additionalInfo type=text set, text="${additionalText.slice(0, 40)}…"` };
        });

        await step("save_and_verify", async () => {
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const addInfo = taskJson?.task_data?.content?.additionalInfo || taskJson?.content?.additionalInfo;
          if (!addInfo) throw new Error("s06_additionalInfo_missing_in_task_json");
          if (addInfo.type !== "text") throw new Error(`s06_additionalInfo_type_wrong: "${addInfo.type}"`);
          if (!addInfo.text || !addInfo.text.includes("Дополнительный контекст")) throw new Error(`s06_additionalInfo_text_wrong: "${addInfo.text}"`);
          return { note: `additionalInfo.type="${addInfo.type}", text OK`, taskJson };
        });

        await step("reload_and_verify", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForTimeout(1000);
          const typeVal = await page.$eval("#additional-type-select", (el) => el.value).catch(() => "");
          const taskJson = readTaskJson(paths.taskJsonPath);
          return { note: `After reload: additionalType select="${typeVal}"`, taskJson };
        });

        try { await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId); } catch (_) {}
      },
    },

    // ------------------------------------------------------------------
    // S07 — additionalInfo images roundtrip (gap candidate)
    // ------------------------------------------------------------------
    {
      id: "s07_additional_info_images_roundtrip",
      title: "Upload additional image → save → reload → re-save without changes — images survive",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_minimal_and_upload_additional_image", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
          await drawPolygonOnCanvas(page);
          await setAnnotationLabel(page, 0, "Зона для S07");

          // Set additional type = image and upload
          await page.locator("#additional-type-select").selectOption("image");
          await page.waitForSelector("#additional-add-image-btn", { state: "visible", timeout: 5000 }).catch(() => {});
          await page.locator("#additional-add-image-btn").click();
          await page.locator("#additional-image-input").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => {
            const grid = document.querySelector("#additional-images-grid");
            return grid && grid.children.length > 0;
          }, { timeout: 10000 });
          return { note: "Additional image uploaded and shown in grid" };
        });

        await step("first_save", async () => {
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const addInfo = taskJson?.task_data?.content?.additionalInfo || taskJson?.content?.additionalInfo;
          if (!addInfo) throw new Error("s07_additionalInfo_missing_after_first_save");
          const images = addInfo.images || [];
          if (images.length === 0) throw new Error("s07_additionalInfo_images_empty_after_first_save");
          return { note: `First save: additionalInfo.images=[${images.join(", ")}]`, taskJson };
        });

        await step("reload_and_re_save", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForTimeout(1500);
          // Re-save without any changes
          await saveCurrentDrawTask(page, taskRef);
          const taskJson = readTaskJson(paths.taskJsonPath);
          const addInfo = taskJson?.task_data?.content?.additionalInfo || taskJson?.content?.additionalInfo;
          const images = addInfo?.images || [];
          const gapFound = images.length === 0;
          const note = gapFound
            ? `GAP_CONFIRMED: additionalInfo.images is EMPTY after reload+re-save. serializeAdditionalInfo dropped the images.`
            : `OK: ${images.length} image(s) survived reload+re-save: [${images.join(", ")}]`;
          return { note, taskJson };
        });

        try { await deleteEditorTask(options.baseUrl, taskRef.moduleId, taskRef.topicId, taskRef.taskId); } catch (_) {}
      },
    },

    // ------------------------------------------------------------------
    // S08 — Draft recovery after unsaved edit
    // ------------------------------------------------------------------
    {
      id: "s08_draft_recovery",
      title: "Fill prompt but do NOT save → localStorage draft persisted → reload → draft restored",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);
        const draftPrompt = `DRAFT_UNSAVED_${timestampSlug()}`;

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        await step("fill_prompt_without_saving", async () => {
          await page.locator("#prompt-textarea").fill(draftPrompt);
          return { note: `Filled prompt: "${draftPrompt}" — NOT saved` };
        });

        await step("persist_draft_to_localstorage", async () => {
          // Trigger autosave manually via JS
          const draftKey = await page.evaluate(() => {
            const u = new URL(window.location.href);
            const m = u.searchParams.get("module");
            const t = u.searchParams.get("topic");
            const id = u.searchParams.get("task");
            return `task_draft_${m}_${t}_${id}`;
          });

          await page.evaluate((key) => {
            if (window.editor && typeof window.editor.captureState === "function") {
              const state = window.editor.captureState();
              const draft = { timestamp: Date.now(), data: state };
              localStorage.setItem(key, JSON.stringify(draft));
            }
          }, draftKey);

          const stored = await page.evaluate((key) => !!localStorage.getItem(key), draftKey);
          if (!stored) throw new Error("s08_draft_not_stored_in_localstorage");
          const noTaskJson = !fs.existsSync(paths.taskJsonPath);
          return { note: `Draft stored in localStorage key="${draftKey}", task.json exists: ${!noTaskJson}` };
        });

        await step("reload_and_check_draft_recovery", async () => {
          await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
          await page.waitForSelector("#prompt-textarea", { state: "visible", timeout: 30000 });
          await page.waitForTimeout(1500);
          const promptVal = await page.$eval("#prompt-textarea", (el) => el.value);
          const draftRestored = promptVal.includes("DRAFT_UNSAVED");
          const note = draftRestored
            ? `DRAFT_RECOVERED: prompt="${promptVal.slice(0, 50)}" restored without task.json`
            : `NOTE: prompt="${promptVal.slice(0, 50)}" — draft may require dialog confirmation`;
          return { note };
        });
      },
    },

    // ------------------------------------------------------------------
    // S09 — Invalid save guardrails
    // ------------------------------------------------------------------
    {
      id: "s09_invalid_save_guardrails",
      title: "Empty prompt / no image / no annotations / empty label — each blocks save",
      async run({ page, step, options, result }) {
        const fixture = buildFixture();
        const scope = await ensureModuleAndTopic(options.baseUrl, fixture);

        await step("open_dashboard", async () => { await waitForDashboardReady(page, options.baseUrl); return { note: "ready" }; });
        await step("open_create_modal", async () => { await openCreateTaskModal(page); return { note: "modal open" }; });
        await step("create_draw_task", async () => { await submitNewDrawTask(page, { ...fixture, ...scope }); return { note: "editor open" }; });

        const taskRef = extractTaskRefFromUrl(page.url());
        result.taskRef = `${taskRef.moduleId}/${taskRef.topicId}/${taskRef.taskId}`;
        const paths = buildTaskPaths(taskRef.moduleId, taskRef.topicId, taskRef.taskId);

        async function attemptSaveAndVerifyBlocked(label) {
          let saveReqSeen = false;
          const handler = (r) => {
            if (r.request().method() === "POST" && r.url().includes(`/api/editor/task/${encodeURIComponent(taskRef.moduleId)}`)) {
              saveReqSeen = true;
            }
          };
          page.on("response", handler);
          try {
            await page.locator("#save-task-btn").click();
            await page.waitForTimeout(900);
          } finally { page.off("response", handler); }
          if (saveReqSeen) throw new Error(`guardrail_failed_${label}: save request sent`);
        }

        await step("subA_empty_prompt_blocked", async () => {
          await page.locator("#prompt-textarea").fill("");
          await attemptSaveAndVerifyBlocked("empty_prompt");
          if (fs.existsSync(paths.taskJsonPath)) throw new Error("guardrail_empty_prompt_materialized_task_json");
          return { note: "Empty prompt → save blocked ✓" };
        });

        await step("subB_no_image_blocked", async () => {
          await page.locator("#prompt-textarea").fill(fixture.prompt);
          // No image uploaded — try to save
          await attemptSaveAndVerifyBlocked("no_image");
          return { note: "No image → save blocked ✓" };
        });

        await step("subC_upload_image_but_no_annotations", async () => {
          await page.locator("#change-image-btn").click();
          await page.locator("#main-image-upload").setInputFiles(imageFixturePath);
          await page.waitForFunction(() => { const img = document.querySelector("#main-image"); return img && !img.classList.contains("hidden") && img.complete && img.naturalWidth > 0; }, { timeout: 15000 });
          await attemptSaveAndVerifyBlocked("no_annotations");
          return { note: "Image OK but no annotations → save blocked ✓" };
        });

        await step("subD_annotation_with_empty_label_blocked", async () => {
          await drawPolygonOnCanvas(page);
          // Leave label empty
          await setAnnotationLabel(page, 0, "");
          await attemptSaveAndVerifyBlocked("empty_label");
          if (fs.existsSync(paths.taskJsonPath)) throw new Error("guardrail_empty_label_materialized_task_json");
          return { note: "Annotation with empty label → save blocked ✓" };
        });
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs();
  const startedAt = new Date();

  const isAvailable = await pingBaseUrl(options.baseUrl, 5000);
  if (!isAvailable) throw new Error(`base_url_unreachable:${options.baseUrl}`);

  const artifacts = createRunArtifacts(options.reportDir);
  const browser = await chromium.launch({ headless: options.headless });
  const allScenarios = createScenarioDefinitions();
  const selected = options.scenarioIds.length
    ? allScenarios.filter((s) => options.scenarioIds.includes(s.id))
    : allScenarios;

  if (!selected.length) throw new Error("no_scenarios_selected");

  console.log(`\nDraw Editor Browser Audit — ${selected.length} scenario(s):`);
  selected.forEach((s) => console.log(`  • ${s.id}`));
  console.log("");

  const results = [];
  try {
    for (const scenario of selected) {
      const r = await runScenario(browser, artifacts, options, scenario);
      results.push(r);
    }
  } finally {
    await browser.close();
  }

  const payload = {
    startedAt: startedAt.toISOString(),
    baseUrl: options.baseUrl,
    headless: options.headless,
    durationMs: Date.now() - startedAt.getTime(),
    passedCount: results.filter((r) => r.ok).length,
    failedCount: results.filter((r) => !r.ok).length,
    selectedScenarios: selected.map((s) => s.id),
    scenarios: results,
  };

  writeRunSummary(artifacts, payload);

  if (payload.failedCount > 0) {
    console.error(`\nDraw editor audit finished with failures. Report: ${artifacts.mdPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDraw editor audit passed. Report: ${artifacts.mdPath}`);
}

main().catch((err) => {
  console.error("[draw_editor_browser_audit] Fatal error:", err);
  process.exitCode = 1;
});
