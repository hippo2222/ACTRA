const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

const FIXTURE = {
  userName: "[Smoke] Release QA",
  userAvatarSeed: "1.png",
  theoryId: "release_smoke_theory",
  theoryTitle: "[Smoke] Release Theory",
  moduleId: "release_smoke_module",
  moduleName: "release_smoke_module",
  topicId: "release_smoke_topic",
  topicName: "release_smoke_topic",
  taskId: "release_smoke_test_task",
  taskName: "release_smoke_test_task",
  complexId: "release_smoke_theory_complex",
  complexName: "[Smoke] Theory Complex",
  correctAnswerText: "Smoke Correct Answer",
  wrongAnswerText: "Smoke Wrong Answer",
  taskQuestionText: "Smoke question: choose the correct answer.",
  microcardsDeckName: "[Smoke] Release Deck",
  microcardsDeckLanguage: "en",
  microcardsDeckTag: "release-smoke",
  microcardsFrontText: "Smoke microcard front",
  microcardsBackText: "Smoke microcard back",
};

const FIXTURE_THEORY_DELTA = {
  ops: [
    { insert: "Release Smoke Theory\n", attributes: { header: 1 } },
    {
      insert:
        "This theory is used by the browser-level release smoke to verify the theory-driven flow.\n",
    },
  ],
};

const FIXTURE_TASK_PAYLOAD = {
  id: FIXTURE.taskId,
  type: "test",
  meta: {
    task_schema_version: "1.2",
    name: FIXTURE.taskName,
    module: FIXTURE.moduleId,
    topic: FIXTURE.topicId,
    id: FIXTURE.taskId,
  },
  content: {
    questions: [
      {
        id: 0,
        text: FIXTURE.taskQuestionText,
        answers: [
          { text: FIXTURE.correctAnswerText, correct: true },
          { text: FIXTURE.wrongAnswerText, correct: false },
        ],
      },
    ],
    test_type: "single_choice",
    settings: {
      shuffle_questions: false,
      shuffle_answers: false,
      passing_score: 100,
    },
  },
  settings: {
    difficulty: 1,
    time_limit: null,
    allow_hints: false,
  },
};

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    headless: true,
    reportDir: path.resolve(process.cwd(), "reports", "browser_smoke"),
    scenarioIds: [],
    suiteIds: [],
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
      out.reportDir = path.resolve(
        process.cwd(),
        token.slice("--report-dir=".length)
      );
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

    if (token === "--suite" && argv[i + 1]) {
      out.suiteIds.push(
        ...String(argv[i + 1])
          .split(",")
          .map((part) => part.trim().toLowerCase())
          .filter(Boolean)
      );
      i += 1;
      continue;
    }
    if (token.startsWith("--suite=")) {
      out.suiteIds.push(
        ...String(token.slice("--suite=".length))
          .split(",")
          .map((part) => part.trim().toLowerCase())
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

function resolveUrl(baseUrl, route) {
  return new URL(route, baseUrl).toString();
}

async function pingBaseUrl(baseUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
    });
    return !!response;
  } catch (error) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(baseUrl, route, options = {}) {
  const response = await fetch(resolveUrl(baseUrl, route), options);
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }
  return { response, data };
}

function summarizeApiError(result, fallback = "request_failed") {
  if (!result) return fallback;
  const status = result.response ? result.response.status : "unknown";
  const error =
    (result.data &&
      (result.data.error ||
        result.data.message ||
        (result.data.details && JSON.stringify(result.data.details)))) ||
    "no_body";
  return `${fallback}: HTTP ${status} (${error})`;
}

function assertApiOk(result, context) {
  if (result && result.response && result.response.ok && result.data && result.data.ok !== false) {
    return result.data;
  }
  throw new Error(summarizeApiError(result, context));
}

async function getCurrentUser(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/users/current");
  if (!result.response.ok || !result.data || result.data.ok === false) {
    return null;
  }
  return result.data.user || null;
}

async function listUsers(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/users");
  return assertApiOk(result, "list_users");
}

async function selectUser(baseUrl, userId) {
  const result = await fetchJson(baseUrl, "/api/users/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return assertApiOk(result, "select_user");
}

async function createUser(baseUrl, payload = {}) {
  const result = await fetchJson(baseUrl, "/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return assertApiOk(result, "create_user");
}

async function deleteUser(baseUrl, userId) {
  const result = await fetchJson(baseUrl, "/api/users/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return assertApiOk(result, "delete_user");
}

async function ensureSmokeUser(baseUrl) {
  const currentUser = await getCurrentUser(baseUrl);
  const previousUserId =
    currentUser && currentUser.user_id ? String(currentUser.user_id).trim() : "";

  const usersData = await listUsers(baseUrl);
  const items = Array.isArray(usersData.items) ? usersData.items : [];
  let user = items.find(
    (item) => String(item && item.name ? item.name : "").trim() === FIXTURE.userName
  );

  if (!user) {
    const createdData = await createUser(baseUrl, {
        name: FIXTURE.userName,
        avatar_seed: FIXTURE.userAvatarSeed,
    });
    user = createdData.user || null;
  }

  if (!user || !user.user_id) {
    throw new Error("smoke_user_missing_user_id");
  }

  await selectUser(baseUrl, user.user_id);

  return {
    userId: String(user.user_id).trim(),
    previousUserId,
  };
}

async function ensureSmokeTheory(baseUrl) {
  const existing = await fetchJson(
    baseUrl,
    `/api/theories/${encodeURIComponent(FIXTURE.theoryId)}`
  );

  if (existing.response.status === 404) {
    const created = await fetchJson(baseUrl, "/api/theories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: FIXTURE.theoryId,
        title: FIXTURE.theoryTitle,
        delta: FIXTURE_THEORY_DELTA,
      }),
    });
    const createdData = assertApiOk(created, "create_smoke_theory");
    return createdData.item;
  }

  const existingData = assertApiOk(existing, "get_smoke_theory");
  const item = existingData.item || {};
  const needsUpdate =
    String(item.title || "").trim() !== FIXTURE.theoryTitle ||
    JSON.stringify(item.delta || null) !== JSON.stringify(FIXTURE_THEORY_DELTA);

  if (!needsUpdate) {
    return item;
  }

  const updated = await fetchJson(
    baseUrl,
    `/api/theories/${encodeURIComponent(FIXTURE.theoryId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: FIXTURE.theoryTitle,
        delta: FIXTURE_THEORY_DELTA,
      }),
    }
  );
  const updatedData = assertApiOk(updated, "update_smoke_theory");
  return updatedData.item;
}

function findCatalogModule(modules, moduleId) {
  return (Array.isArray(modules) ? modules : []).find(
    (moduleRow) => String(moduleRow && moduleRow.id ? moduleRow.id : "").trim() === moduleId
  );
}

function findCatalogTopic(moduleRow, topicId) {
  const topics = Array.isArray(moduleRow && moduleRow.topics ? moduleRow.topics : [])
    ? moduleRow.topics
    : [];
  return topics.find(
    (topicRow) => String(topicRow && topicRow.id ? topicRow.id : "").trim() === topicId
  );
}

async function loadEditorCatalog(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/editor/catalog");
  return assertApiOk(result, "load_editor_catalog");
}

async function ensureModuleAndTopic(baseUrl) {
  let catalog = await loadEditorCatalog(baseUrl);
  let modules = Array.isArray(catalog.modules) ? catalog.modules : [];
  let moduleRow = findCatalogModule(modules, FIXTURE.moduleId);

  if (!moduleRow) {
    const createdModule = await fetchJson(baseUrl, "/api/editor/module/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: FIXTURE.moduleName }),
    });
    assertApiOk(createdModule, "create_smoke_module");
    catalog = await loadEditorCatalog(baseUrl);
    modules = Array.isArray(catalog.modules) ? catalog.modules : [];
    moduleRow = findCatalogModule(modules, FIXTURE.moduleId);
  }

  if (!moduleRow) {
    throw new Error("smoke_module_not_found_after_create");
  }

  let topicRow = findCatalogTopic(moduleRow, FIXTURE.topicId);
  if (!topicRow) {
    const createdTopic = await fetchJson(baseUrl, "/api/editor/topic/new", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        module_id: FIXTURE.moduleId,
        name: FIXTURE.topicName,
      }),
    });
    assertApiOk(createdTopic, "create_smoke_topic");
  }

  const topicTheoryLink = await fetchJson(
    baseUrl,
    `/api/editor/topic/${encodeURIComponent(FIXTURE.moduleId)}/${encodeURIComponent(
      FIXTURE.topicId
    )}/theory-link`
  );
  const topicTheoryData = assertApiOk(topicTheoryLink, "get_smoke_topic_theory_link");
  const currentTheoryId = String(
    (((topicTheoryData.item || {}).theory_link || {}).theory_id) || ""
  ).trim();

  if (currentTheoryId !== FIXTURE.theoryId) {
    const updatedTopicLink = await fetchJson(
      baseUrl,
      `/api/editor/topic/${encodeURIComponent(FIXTURE.moduleId)}/${encodeURIComponent(
        FIXTURE.topicId
      )}/theory-link`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          theory_link: {
            theory_id: FIXTURE.theoryId,
            relation: "link",
          },
          apply_to_complexes: false,
        }),
      }
    );
    assertApiOk(updatedTopicLink, "set_smoke_topic_theory_link");
  }
}

async function ensureSmokeTask(baseUrl) {
  await ensureModuleAndTopic(baseUrl);
  const result = await fetchJson(
    baseUrl,
    `/api/editor/task/${encodeURIComponent(FIXTURE.moduleId)}/${encodeURIComponent(
      FIXTURE.topicId
    )}/${encodeURIComponent(FIXTURE.taskId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(FIXTURE_TASK_PAYLOAD),
    }
  );
  assertApiOk(result, "save_smoke_task");
  return `${FIXTURE.moduleId}/${FIXTURE.topicId}/${FIXTURE.taskId}`;
}

function buildSmokeTaskPayload(taskId, taskName) {
  return {
    ...FIXTURE_TASK_PAYLOAD,
    id: taskId,
    name: taskName,
    meta: {
      ...(FIXTURE_TASK_PAYLOAD.meta || {}),
      id: taskId,
      name: taskName,
      module: FIXTURE.moduleId,
      topic: FIXTURE.topicId,
    },
    content: JSON.parse(JSON.stringify(FIXTURE_TASK_PAYLOAD.content || {})),
  };
}

async function saveEditorTask(baseUrl, moduleId, topicId, taskId, taskName) {
  const payload = buildSmokeTaskPayload(taskId, taskName);
  payload.id = taskId;

  const result = await fetchJson(
    baseUrl,
    `/api/editor/task/${encodeURIComponent(moduleId)}/${encodeURIComponent(
      topicId
    )}/${encodeURIComponent(taskId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return assertApiOk(result, "save_editor_task");
}

async function getEditorTask(baseUrl, moduleId, topicId, taskId) {
  const result = await fetchJson(
    baseUrl,
    `/api/editor/task/${encodeURIComponent(moduleId)}/${encodeURIComponent(
      topicId
    )}/${encodeURIComponent(taskId)}`
  );
  if (result.response.status === 404) {
    return null;
  }
  const data = assertApiOk(result, "get_editor_task");
  return data.task || null;
}

async function deleteEditorTask(baseUrl, moduleId, topicId, taskId) {
  const result = await fetchJson(baseUrl, "/api/editor/tasks/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tasks: [
        {
          module_id: moduleId,
          topic_id: topicId,
          task_id: taskId,
        },
      ],
    }),
  });
  return assertApiOk(result, "delete_editor_task");
}

async function ensureEditorArchiveTaskFixture(baseUrl) {
  await ensureModuleAndTopic(baseUrl);
  const uniqueSuffix = timestampSlug()
    .replace(/[^0-9A-Za-z_-]/g, "")
    .slice(-12);
  const taskId = `release_smoke_archive_${uniqueSuffix}`;
  const taskName = `[Smoke] Archive Task ${uniqueSuffix}`;
  await saveEditorTask(baseUrl, FIXTURE.moduleId, FIXTURE.topicId, taskId, taskName);
  return {
    moduleId: FIXTURE.moduleId,
    topicId: FIXTURE.topicId,
    taskId,
    taskName,
    uniqueId: `${FIXTURE.moduleId}:${FIXTURE.topicId}:${taskId}`,
  };
}

async function ensureSmokeComplex(baseUrl, taskRef) {
  const complexPayload = {
    name: FIXTURE.complexName,
    description: "Release browser-smoke theory complex",
    tasks: [taskRef],
    settings: {},
    theory_mode: "inherit",
  };

  const existing = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(FIXTURE.complexId)}`
  );

  if (existing.response.status === 404) {
    const created = await fetchJson(baseUrl, "/api/complexes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: FIXTURE.complexId,
        ...complexPayload,
      }),
    });
    assertApiOk(created, "create_smoke_complex");
  } else {
    assertApiOk(existing, "get_smoke_complex");
    const updated = await fetchJson(
      baseUrl,
      `/api/complexes/${encodeURIComponent(FIXTURE.complexId)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(complexPayload),
      }
    );
    assertApiOk(updated, "update_smoke_complex");
  }

  const synced = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(FIXTURE.complexId)}/sync-theory-from-topics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propagation_mode: "safe",
        dry_run: false,
      }),
    }
  );
  assertApiOk(synced, "sync_smoke_complex_theory");

  const reloaded = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(FIXTURE.complexId)}`
  );
  const reloadedData = assertApiOk(reloaded, "reload_smoke_complex");
  const theoryId = String(
    ((((reloadedData.item || {}).theory_link) || {}).theory_id) || ""
  ).trim();
  if (theoryId !== FIXTURE.theoryId) {
    throw new Error(
      `smoke_complex_theory_link_mismatch: expected ${FIXTURE.theoryId}, got ${theoryId || "empty"}`
    );
  }

  return reloadedData.item;
}

async function deleteComplex(baseUrl, complexId) {
  const result = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(complexId)}`,
    {
      method: "DELETE",
    }
  );
  if (
    result &&
    result.response &&
    result.response.status === 404 &&
    result.data &&
    result.data.error === "complex_not_found"
  ) {
    return { ok: true, deleted: false, skipped: true };
  }
  return assertApiOk(result, "delete_complex");
}

async function exportComplexArchiveToFile(
  baseUrl,
  complexIds,
  archivePath,
  options = {}
) {
  const response = await fetch(resolveUrl(baseUrl, "/api/complexes/export"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      complex_ids: Array.isArray(complexIds) ? complexIds : [complexIds],
      include_tasks: options.includeTasks !== false,
      include_theories: options.includeTheories !== false,
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch (_) {
      detail = "";
    }
    throw new Error(
      `export_complex_archive_failed: HTTP ${response.status}${detail ? ` (${detail})` : ""}`
    );
  }

  ensureDirectory(path.dirname(archivePath));
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(archivePath, buffer);
  return {
    archivePath,
    size: buffer.length,
  };
}

async function ensureComplexImportArchiveFixture(baseUrl, archiveDir) {
  const uniqueSuffix = timestampSlug()
    .replace(/[^0-9A-Za-z_-]/g, "")
    .slice(-12);
  const complexId = `release_smoke_import_${uniqueSuffix}`;
  const complexName = `[Smoke] Imported Complex ${uniqueSuffix}`;
  const taskRef = `${FIXTURE.moduleId}/${FIXTURE.topicId}/${FIXTURE.taskId}`;
  const archivePath = path.join(archiveDir, `${complexId}.zip`);

  try {
    await deleteComplex(baseUrl, complexId);
  } catch (_) {
    // Best-effort cleanup from interrupted previous runs.
  }

  const created = await fetchJson(baseUrl, "/api/complexes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: complexId,
      name: complexName,
      description: "Release browser-smoke archive import source complex",
      tasks: [taskRef],
      settings: {},
      theory_mode: "inherit",
      created_via: "manual_editor",
    }),
  });
  assertApiOk(created, "create_import_archive_complex");

  const synced = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(complexId)}/sync-theory-from-topics`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propagation_mode: "safe",
        dry_run: false,
      }),
    }
  );
  assertApiOk(synced, "sync_import_archive_complex_theory");

  await exportComplexArchiveToFile(baseUrl, [complexId], archivePath, {
    includeTasks: true,
    includeTheories: true,
  });

  await deleteComplex(baseUrl, complexId);

  return {
    complexId,
    complexName,
    archivePath,
  };
}

async function listActiveSessions(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/sessions/active");
  return assertApiOk(result, "list_active_sessions");
}

async function cancelSession(baseUrl, sessionId) {
  const result = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(sessionId)}/cancel`,
    {
      method: "POST",
    }
  );
  return assertApiOk(result, "cancel_session");
}

async function cancelActiveSessionsForComplex(baseUrl, complexId) {
  const activeData = await listActiveSessions(baseUrl);
  const items = Array.isArray(activeData.items) ? activeData.items : [];
  const matching = items.filter(
    (item) => String(item && item.complex_id ? item.complex_id : "").trim() === complexId
  );

  for (const item of matching) {
    const sessionId = String(item && item.session_id ? item.session_id : "").trim();
    if (!sessionId) continue;
    await cancelSession(baseUrl, sessionId);
  }

  return matching.length;
}

async function seedCompletedSession(baseUrl, complexId) {
  await cancelActiveSessionsForComplex(baseUrl, complexId);

  const started = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(complexId)}/start`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  const startData = assertApiOk(started, "seed_start_session");
  const sessionId = String(startData.session_id || "").trim();
  if (!sessionId) {
    throw new Error("seed_start_session_missing_session_id");
  }

  const taskResult = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(sessionId)}/task`
  );
  const taskData = assertApiOk(taskResult, "seed_get_current_task");
  const taskId = String((((taskData.task || {}).task_data) || {}).id || "").trim();
  if (!taskId) {
    throw new Error("seed_task_missing_task_id");
  }

  const submitResult = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(sessionId)}/task/submit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        user_input: {},
        audit_control: {
          enabled: true,
          mode: "force_success",
        },
      }),
    }
  );
  assertApiOk(submitResult, "seed_submit_task");

  const nextResult = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(sessionId)}/task/next`,
    {
      method: "POST",
    }
  );
  if (!(nextResult.response.status === 410 && nextResult.data && nextResult.data.error === "session_completed")) {
    throw new Error(summarizeApiError(nextResult, "seed_complete_session"));
  }

  const finalResults = await fetchJson(
    baseUrl,
    `/api/session/${encodeURIComponent(sessionId)}/final-results`
  );
  assertApiOk(finalResults, "seed_final_results");
  return sessionId;
}

async function ensureStatisticsSeed(baseUrl, userId) {
  const complexStats = await fetchJson(
    baseUrl,
    `/api/statistics/complexes?user_id=${encodeURIComponent(userId)}`
  );
  if (complexStats.response.ok && complexStats.data && complexStats.data.ok) {
    const complexes = complexStats.data.complexes || {};
    const row = complexes[FIXTURE.complexId];
    const attempts = Number(
      (((row || {}).aggregated) || {}).attempts || 0
    );
    if (attempts > 0) {
      return { seeded: false, attempts };
    }
  }

  const sessionId = await seedCompletedSession(baseUrl, FIXTURE.complexId);
  return { seeded: true, sessionId };
}

async function listMicrocardsDecks(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/editor/microcards/decks?limit=200");
  return assertApiOk(result, "list_microcards_decks");
}

async function getMicrocardsDeck(baseUrl, deckId) {
  const result = await fetchJson(
    baseUrl,
    `/api/editor/microcards/decks/${encodeURIComponent(deckId)}`
  );
  return assertApiOk(result, "get_microcards_deck");
}

async function deleteMicrocardsDeck(baseUrl, deckId) {
  const result = await fetchJson(
    baseUrl,
    `/api/editor/microcards/decks/${encodeURIComponent(deckId)}`,
    {
      method: "DELETE",
    }
  );
  if (
    result &&
    result.response &&
    result.response.status === 404 &&
    result.data &&
    result.data.error === "deck_not_found"
  ) {
    return { ok: true, deleted: false, skipped: true };
  }
  return assertApiOk(result, "delete_microcards_deck");
}

async function createMicrocardsDeck(baseUrl) {
  const result = await fetchJson(
    baseUrl,
    "/api/editor/microcards/decks/create-manual",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: FIXTURE.microcardsDeckName,
        tags: [FIXTURE.microcardsDeckTag],
        target_language: FIXTURE.microcardsDeckLanguage,
      }),
    }
  );
  const data = assertApiOk(result, "create_microcards_deck");
  return data.deck || null;
}

async function createMicrocardsCard(baseUrl, deckId) {
  const result = await fetchJson(
    baseUrl,
    `/api/editor/microcards/decks/${encodeURIComponent(deckId)}/cards`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        card_type: "fact_recall",
        front_text: FIXTURE.microcardsFrontText,
        back_text: FIXTURE.microcardsBackText,
        tags: [FIXTURE.microcardsDeckTag],
        difficulty_hint: "easy",
      }),
    }
  );
  const data = assertApiOk(result, "create_microcards_card");
  return data.card || null;
}

async function ensureMicrocardsFixture(baseUrl) {
  const listed = await listMicrocardsDecks(baseUrl);
  const items = Array.isArray(listed.items) ? listed.items : [];
  const matchingDeckIds = items
    .filter(
      (deck) =>
        String(deck && deck.name ? deck.name : "").trim() ===
        FIXTURE.microcardsDeckName
    )
    .map((deck) => String(deck && deck.id ? deck.id : "").trim())
    .filter(Boolean);

  for (const deckId of matchingDeckIds) {
    await deleteMicrocardsDeck(baseUrl, deckId);
  }

  const createdDeck = await createMicrocardsDeck(baseUrl);
  const deckId = String(createdDeck && createdDeck.id ? createdDeck.id : "").trim();
  if (!deckId) {
    throw new Error("microcards_fixture_missing_deck_id");
  }

  await createMicrocardsCard(baseUrl, deckId);

  const deckData = await getMicrocardsDeck(baseUrl, deckId);
  const deck = deckData.deck || null;
  const cards = Array.isArray(deck && deck.cards ? deck.cards : []) ? deck.cards : [];
  if (!cards.length) {
    throw new Error("microcards_fixture_missing_cards");
  }

  return {
    deckId,
    deck,
    cardId: String(cards[0] && cards[0].id ? cards[0].id : "").trim(),
  };
}

async function ensureSmokeFixture(baseUrl) {
  const user = await ensureSmokeUser(baseUrl);
  await ensureSmokeTheory(baseUrl);
  const taskRef = await ensureSmokeTask(baseUrl);
  const complex = await ensureSmokeComplex(baseUrl, taskRef);
  await cancelActiveSessionsForComplex(baseUrl, FIXTURE.complexId);
  const statsSeed = await ensureStatisticsSeed(baseUrl, user.userId);
  const microcards = await ensureMicrocardsFixture(baseUrl);

  return {
    ...FIXTURE,
    userId: user.userId,
    previousUserId: user.previousUserId,
    complex,
    statsSeed,
    microcards,
  };
}

function createRunArtifacts(reportDir) {
  ensureDirectory(reportDir);
  const timestamp = timestampSlug();
  const runDir = path.join(reportDir, `release_smoke_${timestamp}`);
  const screenshotDir = path.join(runDir, "screenshots");
  ensureDirectory(runDir);
  ensureDirectory(screenshotDir);
  return {
    timestamp,
    runDir,
    screenshotDir,
    jsonPath: path.join(runDir, "summary.json"),
    mdPath: path.join(runDir, "summary.md"),
  };
}

function writeRunSummary(artifacts, payload) {
  fs.writeFileSync(artifacts.jsonPath, JSON.stringify(payload, null, 2), "utf8");

  const lines = [];
  lines.push("# Release Browser Smoke");
  lines.push("");
  lines.push(`- Timestamp: ${payload.startedAt}`);
  lines.push(`- Base URL: ${payload.baseUrl}`);
  lines.push(`- Fixture user: ${payload.fixture && payload.fixture.userId ? payload.fixture.userId : "unknown"}`);
  lines.push(`- Fixture complex: ${FIXTURE.complexId}`);
  lines.push(`- Fixture theory: ${FIXTURE.theoryId}`);
  if (Array.isArray(payload.selectedSuites) && payload.selectedSuites.length) {
    lines.push(`- Suites: ${payload.selectedSuites.join(", ")}`);
  }
  if (Array.isArray(payload.selectedScenarios) && payload.selectedScenarios.length) {
    lines.push(`- Scenario filter: ${payload.selectedScenarios.join(", ")}`);
  }
  lines.push("");
  lines.push("## Scenarios");
  lines.push("");

  (Array.isArray(payload.scenarios) ? payload.scenarios : []).forEach((scenario) => {
    lines.push(
      `- ${scenario.ok ? "PASS" : "FAIL"} ${scenario.id} (${scenario.durationMs} ms)${
        scenario.screenshot ? ` [screenshot](${path.relative(artifacts.runDir, scenario.screenshot).replace(/\\/g, "/")})` : ""
      }`
    );
    if (scenario.error) {
      lines.push(`  - Error: ${scenario.error}`);
    }
    if (scenario.notes && scenario.notes.length) {
      scenario.notes.forEach((note) => {
        lines.push(`  - ${note}`);
      });
    }
  });

  lines.push("");
  lines.push(`- Passed: ${payload.passedCount}`);
  lines.push(`- Failed: ${payload.failedCount}`);
  lines.push(`- Duration: ${payload.durationMs} ms`);
  lines.push("");
  fs.writeFileSync(artifacts.mdPath, lines.join("\n"), "utf8");
}

module.exports = {
  DEFAULT_BASE_URL,
  FIXTURE,
  parseArgs,
  pingBaseUrl,
  fetchJson,
  assertApiOk,
  summarizeApiError,
  resolveUrl,
  ensureSmokeFixture,
  ensureComplexImportArchiveFixture,
  ensureEditorArchiveTaskFixture,
  getEditorTask,
  deleteEditorTask,
  cancelActiveSessionsForComplex,
  selectUser,
  createUser,
  deleteUser,
  deleteComplex,
  createRunArtifacts,
  writeRunSummary,
};
