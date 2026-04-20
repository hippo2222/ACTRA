import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyFile, mkdir, readFile } from "node:fs/promises";

import {
  maybeAttachAuthHeaders,
  translateRuntimePathForApp,
} from "./runtime_context.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

function resolveUrl(baseUrl, route) {
  return new URL(route, baseUrl).toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchJson(baseUrl, route, options = {}) {
  const nextOptions = { ...options };
  nextOptions.headers = maybeAttachAuthHeaders(baseUrl, options.headers || {});
  const response = await fetch(resolveUrl(baseUrl, route), nextOptions);
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  return { response, data };
}

export function summarizeApiError(result, fallback = "request_failed") {
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

export function assertApiOk(result, context) {
  if (result?.response?.ok && result?.data && result.data.ok !== false) {
    return result.data;
  }
  throw new Error(summarizeApiError(result, context));
}

function normalizeRunSlug(runId = "") {
  return (
    String(runId || "cpw_smoke")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/^_+|_+$/g, "")
  ) || "cpw_smoke";
}

function buildTaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  questionText,
  answers,
  difficulty = 1,
}) {
  return {
    id: taskId,
    type: "test",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      questions: [
        {
          id: 0,
          text: questionText,
          answers: answers.map((item) => ({
            text: item.text,
            correct: item.correct === true,
          })),
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
      difficulty,
      time_limit: null,
      allow_hints: false,
    },
  };
}

function buildMultiQuestionTestPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  questions,
  difficulty = 1,
}) {
  return {
    id: taskId,
    type: "test",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      questions: (Array.isArray(questions) ? questions : []).map((question, index) => ({
        id: index,
        text: question.text,
        answers: (Array.isArray(question.answers) ? question.answers : []).map((item) => ({
          text: item.text,
          correct: item.correct === true,
        })),
      })),
      test_type: "single_choice",
      settings: {
        shuffle_questions: false,
        shuffle_answers: false,
        passing_score: 100,
      },
    },
    settings: {
      difficulty,
      time_limit: null,
      allow_hints: false,
    },
  };
}

const SHARED_SAMPLE_IMAGE_FILE = path.join(
  PROJECT_ROOT,
  "tests",
  "complex_audit",
  "assets",
  "happy_path_target.svg"
);
const SAMPLE_CLICK_POLYGON = [
  [28, 25],
  [32, 22],
  [37, 23],
  [41, 26],
  [42, 32],
  [38, 36],
  [32, 37],
  [27, 33],
];

function clonePoints(points) {
  return (Array.isArray(points) ? points : []).map((point) => [
    Number(point?.[0] || 0),
    Number(point?.[1] || 0),
  ]);
}

function buildClickTaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  prompt,
  image,
  points = SAMPLE_CLICK_POLYGON,
}) {
  return {
    id: taskId,
    type: "click",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      image,
      prompt,
      required_correct: 1,
      annotations: [
        {
          type: "polygon",
          label: "Target zone",
          points: clonePoints(points),
          color: "#2563eb",
          labelVisible: false,
        },
      ],
    },
    settings: {
      difficulty: 1,
      time_limit: null,
      allow_hints: false,
      tolerancePx: null,
      overlapThreshold: null,
      success_threshold: null,
    },
  };
}

function buildDrawTaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  prompt,
  image,
  points = SAMPLE_CLICK_POLYGON,
}) {
  return {
    id: taskId,
    type: "draw",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      image,
      prompt,
      annotations: [
        {
          type: "polygon",
          label: "Target contour",
          points: clonePoints(points),
          color: "#2563eb",
          labelVisible: false,
        },
      ],
    },
    settings: {
      difficulty: 1,
      time_limit: null,
      allow_hints: false,
    },
  };
}

function buildSequenceTaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  prompt,
}) {
  return {
    id: taskId,
    type: "sequence_assembly",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      prompt,
      elements: [
        { id: "elem_1", text: "Collect baseline image", image: null },
        { id: "elem_2", text: "Verify target zone", image: null },
      ],
      levels: [
        {
          level_id: "level_1",
          level_name: "Main flow",
          blocks: ["elem_1", "elem_2"],
        },
      ],
      sequence: [
        {
          level_id: "level_1",
          title: "Main flow",
          items: [
            { id: "elem_1", label: "Collect baseline image" },
            { id: "elem_2", label: "Verify target zone" },
          ],
        },
      ],
      level_order_matters: false,
      sequence_within_level_matters: true,
    },
    settings: {
      difficulty: 1,
      time_limit: null,
      allow_hints: false,
      level_order_matters: false,
      sequence_within_level_matters: true,
      shuffle_elements: false,
      show_hints: true,
      allow_duplicates: false,
    },
  };
}

function buildOpenAnswerTaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  questionText,
  keywords,
  referenceAnswer,
}) {
  return {
    id: taskId,
    type: "open_answer",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      prompt: questionText,
      question: questionText,
      keywords: Array.isArray(keywords) ? keywords.slice() : [],
      reference_answer: referenceAnswer,
      case_sensitive: false,
      sequence_matters: false,
    },
    settings: {
      difficulty: 1,
      time_limit: null,
      allow_hints: false,
    },
  };
}

function findCatalogModule(modules, moduleId) {
  return (Array.isArray(modules) ? modules : []).find(
    (item) => String(item?.id || "").trim() === moduleId
  );
}

function findCatalogTopic(moduleRow, topicId) {
  return (Array.isArray(moduleRow?.topics) ? moduleRow.topics : []).find(
    (item) => String(item?.id || "").trim() === topicId
  );
}

async function listUsers(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/users");
  return assertApiOk(result, "list_users");
}

async function readRuntimeMode(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/health");
  if (!result?.response?.ok) {
    return "";
  }
  return String(result?.data?.runtime_mode || "").trim();
}

async function readCurrentUser(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/users/current");
  return assertApiOk(result, "current_user");
}

async function createUser(baseUrl, payload) {
  const result = await fetchJson(baseUrl, "/api/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return assertApiOk(result, "create_user");
}

async function selectUser(baseUrl, userId) {
  const result = await fetchJson(baseUrl, "/api/users/select", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_id: userId }),
  });
  return assertApiOk(result, "select_user");
}

async function loadEditorCatalog(baseUrl) {
  const result = await fetchJson(baseUrl, "/api/editor/catalog");
  return assertApiOk(result, "load_editor_catalog");
}

async function createModule(baseUrl, name) {
  const result = await fetchJson(baseUrl, "/api/editor/module/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return assertApiOk(result, "create_module");
}

async function createTopic(baseUrl, moduleId, name) {
  const result = await fetchJson(baseUrl, "/api/editor/topic/new", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ module_id: moduleId, name }),
  });
  return assertApiOk(result, "create_topic");
}

async function saveEditorTask(baseUrl, moduleId, topicId, taskId, payload) {
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

async function getComplex(baseUrl, complexId) {
  const result = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(complexId)}`
  );
  if (result.response.status === 404) {
    return null;
  }
  const data = assertApiOk(result, "get_complex");
  return data.item || null;
}

async function createComplex(baseUrl, payload) {
  const result = await fetchJson(baseUrl, "/api/complexes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return assertApiOk(result, "create_complex");
}

async function createTheory(baseUrl, payload) {
  const result = await fetchJson(baseUrl, "/api/theories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return assertApiOk(result, "create_theory");
}

async function updateComplex(baseUrl, complexId, payload) {
  const result = await fetchJson(
    baseUrl,
    `/api/complexes/${encodeURIComponent(complexId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );
  return assertApiOk(result, "update_complex");
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

export async function cancelActiveSessionsForComplex(baseUrl, complexId) {
  const active = await listActiveSessions(baseUrl);
  const items = Array.isArray(active.items) ? active.items : [];
  const matching = items.filter(
    (item) => String(item?.complex_id || "").trim() === complexId
  );

  for (const item of matching) {
    const sessionId = String(item?.session_id || "").trim();
    if (!sessionId) continue;
    await cancelSession(baseUrl, sessionId);
  }

  return matching.length;
}

async function ensureAuditUser(baseUrl, slug) {
  const runtimeMode = await readRuntimeMode(baseUrl);
  if (runtimeMode === "hosted_web") {
    const current = await readCurrentUser(baseUrl);
    const userId = String(current?.user?.user_id || "").trim();
    if (!userId) {
      throw new Error("hosted_current_user_missing_user_id");
    }
    return {
      userId,
      name: String(current?.user?.name || "").trim() || String(slug || "hosted_audit_user"),
    };
  }

  const shortSlug = String(slug || "")
    .replace(/[^a-z0-9_-]+/gi, "_")
    .slice(0, 24);
  const name = `CPW Smoke ${shortSlug}`;
  const listed = await listUsers(baseUrl);
  const items = Array.isArray(listed.items) ? listed.items : [];
  let user = items.find((item) => String(item?.name || "").trim() === name) || null;

  if (!user) {
    const created = await createUser(baseUrl, {
      name,
      avatar_seed: "1.png",
    });
    user = created.user || null;
  }

  if (!user?.user_id) {
    throw new Error("audit_user_missing_user_id");
  }

  await selectUser(baseUrl, user.user_id);

  return {
    userId: String(user.user_id).trim(),
    name,
  };
}

async function ensureModuleAndTopic(baseUrl, moduleId, topicId) {
  let catalog = await loadEditorCatalog(baseUrl);
  let moduleRow = findCatalogModule(catalog.modules, moduleId);

  if (!moduleRow) {
    await createModule(baseUrl, moduleId);
    for (let attempt = 0; attempt < 5 && !moduleRow; attempt += 1) {
      await sleep(150 * (attempt + 1));
      catalog = await loadEditorCatalog(baseUrl);
      moduleRow = findCatalogModule(catalog.modules, moduleId);
    }
  }

  if (!moduleRow) {
    throw new Error(`module_not_found_after_create:${moduleId}`);
  }

  let topicRow = findCatalogTopic(moduleRow, topicId);
  if (!topicRow) {
    await createTopic(baseUrl, moduleId, topicId);
    for (let attempt = 0; attempt < 5 && !topicRow; attempt += 1) {
      await sleep(150 * (attempt + 1));
      catalog = await loadEditorCatalog(baseUrl);
      moduleRow = findCatalogModule(catalog.modules, moduleId);
      topicRow = findCatalogTopic(moduleRow, topicId);
    }
  }

  if (!topicRow) {
    throw new Error(`topic_not_found_after_create:${moduleId}/${topicId}`);
  }

  return {
    moduleId,
    topicId,
  };
}

async function ensureSmokeComplex(baseUrl, fixture) {
  const payload = {
    name: fixture.complexName,
    description: fixture.description,
    tasks: fixture.taskRefs,
    chains: fixture.chains,
    settings: fixture.settings,
    theory_mode: fixture.theoryLink ? "override" : "inherit",
    ...(fixture.theoryLink ? { theory_link: fixture.theoryLink } : {}),
    created_via: "manual_editor",
  };

  const existing = await getComplex(baseUrl, fixture.complexId);
  if (!existing) {
    const created = await createComplex(baseUrl, {
      id: fixture.complexId,
      ...payload,
    });
    return created.item || null;
  }

  const updated = await updateComplex(baseUrl, fixture.complexId, payload);
  return updated.item || null;
}

export function buildSmokeTestL1Fixture(runId) {
  const slug = normalizeRunSlug(runId);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Smoke Test L1 ${slug}`;

  const taskBlueprints = [
    {
      ordinal: 1,
      taskId: `${slug}_task_1`,
      taskName: `[CPW] Q1 ${slug}`,
      questionText: "Smoke question 1: choose the baseline-safe correct option.",
      answers: [
        { text: "Baseline-safe answer", correct: true },
        { text: "Incorrect distractor one", correct: false },
        { text: "Incorrect distractor two", correct: false },
      ],
      chosenAnswerText: "Baseline-safe answer",
      expectedSuccess: true,
    },
    {
      ordinal: 2,
      taskId: `${slug}_task_2`,
      taskName: `[CPW] Q2 ${slug}`,
      questionText: "Smoke question 2: choose the only correct diagnosis label.",
      answers: [
        { text: "Correct diagnosis label", correct: true },
        { text: "Wrong diagnosis label", correct: false },
        { text: "Borderline distractor", correct: false },
      ],
      chosenAnswerText: "Correct diagnosis label",
      expectedSuccess: true,
    },
    {
      ordinal: 3,
      taskId: `${slug}_task_3`,
      taskName: `[CPW] Q3 ${slug}`,
      questionText: "Smoke question 3: choose the final correct option to finish the complex.",
      answers: [
        { text: "Final correct option", correct: true },
        { text: "Final distractor one", correct: false },
        { text: "Final distractor two", correct: false },
      ],
      chosenAnswerText: "Final distractor one",
      expectedSuccess: false,
    },
  ];

  const tasks = taskBlueprints.map((task) => ({
    ...task,
    moduleId,
    topicId,
    taskRef: `${moduleId}/${topicId}/${task.taskId}`,
    correctAnswerText:
      task.answers.find((item) => item.correct === true)?.text || "",
    wrongAnswerText:
      task.answers.find((item) => item.correct !== true)?.text || "",
    payload: buildTaskPayload({
      moduleId,
      topicId,
      taskId: task.taskId,
      taskName: task.taskName,
      questionText: task.questionText,
      answers: task.answers,
      difficulty: 1,
    }),
  }));

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 1 vertical smoke for complex passage audit",
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 2,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    tasks,
    taskRefs: tasks.map((task) => task.taskRef),
    chains: [tasks.map((task) => task.taskRef)],
    expectedFailureTaskId: tasks.find((task) => !task.expectedSuccess)?.taskId || null,
    expected: {
      totalTasks: tasks.length,
      successfulTasks: tasks.filter((task) => task.expectedSuccess).length,
      failedTasks: tasks.filter((task) => !task.expectedSuccess).length,
      iterations: 1,
      successRatePercent: 67,
      streakDaysAfterRun: 1,
    },
  };
}

export function buildTestValidationFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_test_validation`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Test Validation L1 ${slug}`;
  const taskId = `${slug}_task`;
  const taskName = `[CPW] Test Validation ${slug}`;
  const questions = [
    {
      text: "Validation question 1: choose the safe baseline option.",
      answers: [
        { text: "Baseline option", correct: true },
        { text: "Distractor A", correct: false },
      ],
    },
    {
      text: "Validation question 2: choose the final correct option.",
      answers: [
        { text: "Distractor B", correct: false },
        { text: "Final correct option", correct: true },
      ],
    },
  ];
  const taskRef = `${moduleId}/${topicId}/${taskId}`;

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 1 validation fixture for multi-question test L1",
    taskType: "test",
    tasks: [
      {
        taskId,
        taskName,
        taskRef,
        questionText: "Answer both questions before submit becomes valid.",
        partialAnswerText: "Baseline option",
        finalAnswerText: "Final correct option",
        questions,
        payload: buildMultiQuestionTestPayload({
          moduleId,
          topicId,
          taskId,
          taskName,
          questions,
          difficulty: 1,
        }),
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 1,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    expected: {
      totalTasks: 1,
      successfulTasks: 1,
      failedTasks: 0,
      iterations: 1,
      successRatePercent: 100,
    },
  };
}

export function buildAdaptiveDifficultyFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_adaptive_difficulty`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Adaptive Difficulty ${slug}`;
  const taskId = `${slug}_task`;
  const taskName = `[CPW] Adaptive Test ${slug}`;
  const questionText = "Select the named vessel and then restate it in open text on the next level.";
  const correctAnswerText = "Alpha artery";
  const taskRef = `${moduleId}/${topicId}/${taskId}`;

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 1 adaptive difficulty fixture for test L1 -> L2 progression",
    taskType: "test",
    tasks: [
      {
        taskId,
        taskName,
        taskRef,
        questionText,
        correctAnswerText,
        openAnswerText: "Alpha artery",
        payload: buildTaskPayload({
          moduleId,
          topicId,
          taskId,
          taskName,
          questionText,
          answers: [
            { text: correctAnswerText, correct: true },
            { text: "Beta ligament", correct: false },
            { text: "Gamma fissure", correct: false },
          ],
          difficulty: 1,
        }),
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    settings: {
      adaptive_difficulty: true,
      escalation_on_success: true,
      error_pool_enabled: false,
      max_iterations: 3,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    expected: {
      totalTasks: 1,
      successfulTasks: 1,
      failedTasks: 0,
      iterations: 2,
      successRatePercent: 100,
      progression: [1, 2],
    },
  };
}

function buildMistakesUITaskPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  prompt,
  mode = "text_errors",
  text = "",
  errorSpans = [],
  requiredCorrect = 1,
  referenceText = "",
  referenceSpans = [],
  options = [],
}) {
  const normalizedMode = String(mode || "text_errors").trim();
  const content = {
    prompt,
    mode: normalizedMode,
    subtype: "error_detection",
  };

  if (normalizedMode === "text_choice") {
    content.options = Array.isArray(options)
      ? options.map((option, index) => ({
          id: String(option?.id || `option_${index + 1}`),
          text: String(option?.text || ""),
          is_correct: option?.is_correct === true,
        }))
      : [];
    if (referenceText) {
      content.reference_text = referenceText;
    }
  } else {
    content.text = text;
    content.required_correct = Number(requiredCorrect || 1);
    content.error_spans = Array.isArray(errorSpans)
      ? errorSpans.map((span) => ({
          start: Number(span?.start || 0),
          end: Number(span?.end || 0),
          is_correct: span?.is_correct === false ? false : true,
        }))
      : [];
    if (referenceText) {
      content.reference_text = referenceText;
    }
    if (Array.isArray(referenceSpans) && referenceSpans.length) {
      content.reference_spans = referenceSpans.map((span) => ({
        start: Number(span?.start || 0),
        end: Number(span?.end || 0),
      }));
    }
  }

  return {
    id: taskId,
    type: "click",
    subtype: "error_detection",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content,
    settings: {
      difficulty: 1,
      time_limit: null,
      allow_hints: false,
    },
  };
}

export function buildAdaptiveTypeFixture(runId, taskType) {
  const normalizedType = String(taskType || "").trim();
  const supportedLevelsMap = {
    click: [1, 2, 3],
    draw: [1, 2],
    sequence_assembly: [1, 2, 3],
  };
  const supportedLevels = supportedLevelsMap[normalizedType];
  if (!Array.isArray(supportedLevels) || !supportedLevels.length) {
    throw new Error(`unsupported_adaptive_type_fixture:${normalizedType}`);
  }

  const slug = normalizeRunSlug(`${runId}_${normalizedType}_adaptive`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const displayType = normalizedType === "sequence_assembly" ? "sequence" : normalizedType;
  const complexName = `[CPW] Adaptive ${displayType} ${slug}`;

  const baseBlueprint = buildTypeTaskBlueprint(`${slug}_base`, normalizedType, 1);
  const taskRef = `${moduleId}/${topicId}/${baseBlueprint.taskId}`;
  const progression = supportedLevels.map((level) => {
    const blueprint = buildTypeTaskBlueprint(`${slug}_lvl${level}`, normalizedType, level);
    return {
      level,
      questionText: blueprint.questionText,
      interaction: blueprint.interaction,
    };
  });

  const payload = buildTypeTaskPayload(
    moduleId,
    topicId,
    baseBlueprint,
    normalizedType,
    1,
    SHARED_SAMPLE_IMAGE_FILE
  );

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: `Adaptive fixture for ${normalizedType} progression ${supportedLevels.join(" -> ")}`,
    taskType: normalizedType,
    difficulty: 1,
    tasks: [
      {
        ...baseBlueprint,
        moduleId,
        topicId,
        taskRef,
        payload,
        progression,
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    settings: {
      adaptive_difficulty: true,
      escalation_on_success: true,
      error_pool_enabled: false,
      max_iterations: supportedLevels.length,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    expected: {
      totalTasks: supportedLevels.length,
      successfulTasks: supportedLevels.length,
      failedTasks: 0,
      uniqueTasksMastered: 1,
      iterations: supportedLevels.length,
      successRatePercent: 100,
      progression: supportedLevels,
      streakDaysAfterRun: 1,
    },
  };
}


export function buildRetryQueueFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_retry_queue`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Retry Queue ${slug}`;

  const taskBlueprints = [
    {
      ordinal: 1,
      taskId: `${slug}_task_1`,
      taskName: `[CPW] Retry Q1 ${slug}`,
      questionText: "Retry queue question 1: intentionally fail this one first.",
      answers: [
        { text: "Correct baseline answer", correct: true },
        { text: "Wrong retry trigger answer", correct: false },
      ],
      chosenAnswerText: "Wrong retry trigger answer",
      expectedSuccess: false,
    },
    {
      ordinal: 2,
      taskId: `${slug}_task_2`,
      taskName: `[CPW] Retry Q2 ${slug}`,
      questionText: "Retry queue question 2: complete the remaining original task.",
      answers: [
        { text: "Correct follow-up answer", correct: true },
        { text: "Wrong follow-up answer", correct: false },
      ],
      chosenAnswerText: "Correct follow-up answer",
      expectedSuccess: true,
    },
  ];

  const tasks = taskBlueprints.map((task) => ({
    ...task,
    moduleId,
    topicId,
    taskRef: `${moduleId}/${topicId}/${task.taskId}`,
    correctAnswerText:
      task.answers.find((item) => item.correct === true)?.text || "",
    wrongAnswerText:
      task.answers.find((item) => item.correct !== true)?.text || "",
    payload: buildTaskPayload({
      moduleId,
      topicId,
      taskId: task.taskId,
      taskName: task.taskName,
      questionText: task.questionText,
      answers: task.answers,
      difficulty: 1,
    }),
  }));

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 1 retry queue fixture for same-iteration smart retry",
    taskType: "test",
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 1,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 2,
      smart_retry_training_control_enabled: false,
    },
    tasks,
    taskRefs: tasks.map((task) => task.taskRef),
    chains: [tasks.map((task) => task.taskRef)],
    expected: {
      totalTasksAfterRetry: 4,
      successfulTasks: 3,
      failedTasks: 1,
      iterations: 1,
      successRatePercent: 75,
    },
  };
}

export function buildPartialRetryFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_partial_retry`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Partial Retry ${slug}`;
  const taskId = `${slug}_task`;
  const taskName = `[CPW] Partial Retry Test ${slug}`;
  const questions = [
    {
      text: "Partial retry question 1: select the stable baseline finding.",
      answers: [
        { text: "Baseline finding", correct: true },
        { text: "Distractor baseline", correct: false },
      ],
    },
    {
      text: "Partial retry question 2: select the follow-up finding that should remain in retry.",
      answers: [
        { text: "Wrong follow-up finding", correct: false },
        { text: "Correct follow-up finding", correct: true },
      ],
    },
  ];
  const taskRef = `${moduleId}/${topicId}/${taskId}`;

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 1 partial retry fixture for multi-question test",
    taskType: "test",
    tasks: [
      {
        taskId,
        taskName,
        taskRef,
        questions,
        firstQuestionCorrectText: "Baseline finding",
        secondQuestionWrongText: "Wrong follow-up finding",
        secondQuestionCorrectText: "Correct follow-up finding",
        payload: buildMultiQuestionTestPayload({
          moduleId,
          topicId,
          taskId,
          taskName,
          questions,
          difficulty: 1,
        }),
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 2,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 2,
      smart_retry_training_control_enabled: false,
    },
    expected: {
      retryQuestionCount: 1,
      failedQuestionText: questions[1].text,
      hiddenQuestionText: questions[0].text,
    },
  };
}


export function buildHighLevelRetryFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_high_level_retry`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] High-Level Retry ${slug}`;

  const taskBlueprints = [
    {
      ordinal: 1,
      taskId: `${slug}_task_1`,
      taskName: `[CPW] High Retry L2 Q1 ${slug}`,
      questionText: "Type the baseline diagnostic label, but fail this one first to trigger retry copies.",
      correctAnswerText: "Baseline safe diagnostic label",
      wrongAnswerText: "Wrong diagnostic label",
      keywords: ["baseline", "safe", "diagnostic", "label"],
      expectedSuccess: false,
    },
    {
      ordinal: 2,
      taskId: `${slug}_task_2`,
      taskName: `[CPW] High Retry L2 Q2 ${slug}`,
      questionText: "Type the baseline safe diagnostic label to complete the original queue.",
      correctAnswerText: "Baseline safe diagnostic label",
      wrongAnswerText: "Wrong diagnostic label",
      keywords: ["baseline", "safe", "diagnostic", "label"],
      expectedSuccess: true,
    },
  ];

  const tasks = taskBlueprints.map((task) => ({
    ...task,
    moduleId,
    topicId,
    difficulty: 2,
    taskRef: `${moduleId}/${topicId}/${task.taskId}`,
    payload: buildOpenQuestionTestPayload({
      moduleId,
      topicId,
      taskId: task.taskId,
      taskName: task.taskName,
      questionText: task.questionText,
      answerText: task.correctAnswerText,
      keywords: task.keywords,
      referenceAnswer: task.correctAnswerText,
      difficulty: 2,
    }),
  }));

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: "Wave 2 retry queue fixture for higher-level open-text test tasks",
    taskType: "test",
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 2,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 2,
      smart_retry_training_control_enabled: false,
    },
    tasks,
    taskRefs: tasks.map((task) => task.taskRef),
    chains: [tasks.map((task) => task.taskRef)],
    expected: {
      totalTasksAfterRetry: 4,
      successfulTasks: 3,
      failedTasks: 1,
      iterations: 1,
      successRatePercent: 75,
      difficulty: 2,
    },
  };
}


export function buildHighLevelFlowResultsFixture(runId, taskType, difficulty) {
  const normalizedType = String(taskType || '').trim();
  const normalizedDifficulty = Number(difficulty || 1);
  const slug = normalizeRunSlug(`${runId}_${normalizedType}_flow_l${normalizedDifficulty}`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const displayType = normalizedType === 'sequence_assembly' ? 'sequence' : normalizedType;
  const complexName = `[CPW] ${displayType} Flow L${normalizedDifficulty} ${slug}`;

  const taskBlueprints = [
    {
      ordinal: 1,
      expectedSuccess: false,
      variant: 'fail',
    },
    {
      ordinal: 2,
      expectedSuccess: true,
      variant: 'pass',
    },
  ].map((item) => {
    const blueprint = buildTypeTaskBlueprint(`${slug}_${item.variant}`, normalizedType, normalizedDifficulty);
    return {
      ...blueprint,
      ...item,
      taskName: `${blueprint.taskName} ${item.variant.toUpperCase()}`,
    };
  });

  const tasks = taskBlueprints.map((task) => ({
    ...task,
    taskType: normalizedType,
    difficulty: normalizedDifficulty,
    moduleId,
    topicId,
    taskRef: `${moduleId}/${topicId}/${task.taskId}`,
    wrongLabelText:
      normalizedType === 'draw'
        ? 'Completely unrelated contour'
        : normalizedType === 'click'
          ? 'Completely unrelated marker'
          : '',
    wrongBlockNames:
      normalizedType === 'sequence_assembly'
        ? ['Wrong step one', 'Wrong step two']
        : [],
    payload: buildTypeTaskPayload(
      moduleId,
      topicId,
      task,
      normalizedType,
      normalizedDifficulty,
      SHARED_SAMPLE_IMAGE_FILE
    ),
  }));

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: `Wave 2 flow/results fixture for ${normalizedType} level ${normalizedDifficulty}`,
    taskType: normalizedType,
    difficulty: normalizedDifficulty,
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: Math.max(1, normalizedDifficulty),
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    tasks,
    taskRefs: tasks.map((task) => task.taskRef),
    chains: [tasks.map((task) => task.taskRef)],
    expectedFailureTaskId: tasks.find((task) => !task.expectedSuccess)?.taskId || null,
    expected: {
      totalTasks: tasks.length,
      successfulTasks: tasks.filter((task) => task.expectedSuccess).length,
      failedTasks: tasks.filter((task) => !task.expectedSuccess).length,
      iterations: 1,
      successRatePercent: 50,
      streakDaysAfterRun: 1,
      difficulty: normalizedDifficulty,
    },
  };
}
function buildOpenQuestionTestPayload({
  moduleId,
  topicId,
  taskId,
  taskName,
  questionText,
  answerText,
  keywords,
  referenceAnswer,
  difficulty = 2,
}) {
  return {
    id: taskId,
    type: "test",
    meta: {
      task_schema_version: "1.2",
      name: taskName,
      module: moduleId,
      topic: topicId,
      id: taskId,
    },
    content: {
      questions: [
        {
          id: 0,
          text: questionText,
          answers: [
            {
              text: answerText,
              correct: true,
            },
          ],
          keywords: Array.isArray(keywords) ? keywords.slice() : [],
          reference_answer: referenceAnswer || answerText,
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
      difficulty,
      time_limit: null,
      allow_hints: false,
    },
  };
}

function buildTypeTaskBlueprint(slug, taskType, difficulty = 1) {
  if (taskType === "click" && difficulty === 1) {
    return {
      taskId: `${slug}_click_task`,
      taskName: `[CPW] Click L1 ${slug}`,
      questionText: "Click the highlighted central zone on the reference image.",
      expectedSuccess: true,
      interaction: {
        kind: "click",
        points: clonePoints(SAMPLE_CLICK_POLYGON),
      },
    };
  }

  if (taskType === "click" && difficulty === 2) {
    return {
      taskId: `${slug}_click_l2_task`,
      taskName: `[CPW] Click L2 ${slug}`,
      questionText: "Click the highlighted zone and enter its label.",
      expectedSuccess: true,
      interaction: {
        kind: "click_and_label",
        points: clonePoints(SAMPLE_CLICK_POLYGON),
        labelsClicks: ["Target zone"],
      },
    };
  }

  if (taskType === "click" && difficulty === 3) {
    return {
      taskId: `${slug}_click_l3_task`,
      taskName: `[CPW] Click L3 ${slug}`,
      questionText: "Outline the highlighted zone and enter its label.",
      expectedSuccess: true,
      interaction: {
        kind: "draw_and_label",
        points: clonePoints([...SAMPLE_CLICK_POLYGON, SAMPLE_CLICK_POLYGON[0]]),
        labelsPolygons: ["Target zone"],
      },
    };
  }

  if (taskType === "draw" && difficulty === 1) {
    return {
      taskId: `${slug}_draw_task`,
      taskName: `[CPW] Draw L1 ${slug}`,
      questionText: "Draw a contour around the highlighted target zone.",
      expectedSuccess: true,
      interaction: {
        kind: "draw",
        points: clonePoints([...SAMPLE_CLICK_POLYGON, SAMPLE_CLICK_POLYGON[0]]),
      },
    };
  }

  if (taskType === "draw" && difficulty === 2) {
    return {
      taskId: `${slug}_draw_l2_task`,
      taskName: `[CPW] Draw L2 ${slug}`,
      questionText: "Draw the contour and enter the correct label for it.",
      expectedSuccess: true,
      interaction: {
        kind: "draw_and_label",
        points: clonePoints([...SAMPLE_CLICK_POLYGON, SAMPLE_CLICK_POLYGON[0]]),
        labelsPolygons: ["Target contour"],
      },
    };
  }

  if (taskType === "test" && difficulty === 2) {
    return {
      taskId: `${slug}_test_l2_task`,
      taskName: `[CPW] Test L2 ${slug}`,
      questionText: "Type the exact target phrase used for the correct diagnostic label.",
      expectedSuccess: true,
      interaction: {
        kind: "test_open",
        answerText: "Baseline safe diagnostic label",
      },
      keywords: ["baseline", "safe", "diagnostic", "label"],
      referenceAnswer: "Baseline safe diagnostic label",
    };
  }

  if (taskType === "sequence_assembly" && difficulty === 1) {
    return {
      taskId: `${slug}_sequence_task`,
      taskName: `[CPW] Sequence L1 ${slug}`,
      questionText: "Assemble the main flow in the correct order.",
      expectedSuccess: true,
      interaction: {
        kind: "sequence",
        placements: [
          { elementText: "Collect baseline image" },
          { elementText: "Verify target zone" },
        ],
      },
    };
  }

  if (taskType === "sequence_assembly" && difficulty === 2) {
    return {
      taskId: `${slug}_sequence_l2_task`,
      taskName: `[CPW] Sequence L2 ${slug}`,
      questionText: "Create the level structure and place the elements into the correct level.",
      expectedSuccess: true,
      interaction: {
        kind: "sequence_l2",
        levels: [
          {
            levelName: "Main flow",
            blocks: ["Collect baseline image", "Verify target zone"],
          },
        ],
      },
      correctLevels: [
        {
          level_id: "level_1",
          level_name: "Main flow",
          blocks: ["elem_1", "elem_2"],
        },
      ],
    };
  }

  if (taskType === "sequence_assembly" && difficulty === 3) {
    return {
      taskId: `${slug}_sequence_l3_task`,
      taskName: `[CPW] Sequence L3 ${slug}`,
      questionText: "Create the level and name the blocks in the correct order.",
      expectedSuccess: true,
      interaction: {
        kind: "sequence_l3",
        levels: [
          {
            levelName: "Main flow",
            blockNames: ["Collect baseline image", "Verify target zone"],
          },
        ],
      },
      correctLevels: [
        {
          level_id: "level_1",
          level_name: "Main flow",
          blocks: ["elem_1", "elem_2"],
          block_names: {
            elem_1: "Collect baseline image",
            elem_2: "Verify target zone",
          },
        },
      ],
    };
  }

  if (taskType === "open_answer" && difficulty === 1) {
    return {
      taskId: `${slug}_open_answer_task`,
      taskName: `[CPW] Open Answer L1 ${slug}`,
      questionText: "Name the organ that filters blood in the human body.",
      expectedSuccess: true,
      interaction: {
        kind: "open_answer",
        answerText: "The liver filters blood in the human body.",
      },
      keywords: ["liver", "filters", "blood"],
      referenceAnswer: "The liver filters blood in the human body.",
    };
  }

  throw new Error(`unsupported_happy_path_task_type:${taskType}:L${difficulty}`);
}

function buildTypeTaskPayload(moduleId, topicId, blueprint, taskType, difficulty, imageUrl) {
  if (taskType === "click") {
    const payload = buildClickTaskPayload({
      moduleId,
      topicId,
      taskId: blueprint.taskId,
      taskName: blueprint.taskName,
      prompt: blueprint.questionText,
      image: imageUrl,
      points: blueprint.interaction.points,
    });
    payload.settings = {
      ...(payload.settings || {}),
      difficulty,
    };
    return payload;
  }

  if (taskType === "draw") {
    const payload = buildDrawTaskPayload({
      moduleId,
      topicId,
      taskId: blueprint.taskId,
      taskName: blueprint.taskName,
      prompt: blueprint.questionText,
      image: imageUrl,
      points: blueprint.interaction.points,
    });
    payload.settings = {
      ...(payload.settings || {}),
      difficulty,
    };
    return payload;
  }

  if (taskType === "test") {
    return buildOpenQuestionTestPayload({
      moduleId,
      topicId,
      taskId: blueprint.taskId,
      taskName: blueprint.taskName,
      questionText: blueprint.questionText,
      answerText: blueprint.interaction.answerText,
      keywords: blueprint.keywords,
      referenceAnswer: blueprint.referenceAnswer,
      difficulty,
    });
  }

  if (taskType === "sequence_assembly") {
    const payload = buildSequenceTaskPayload({
      moduleId,
      topicId,
      taskId: blueprint.taskId,
      taskName: blueprint.taskName,
      prompt: blueprint.questionText,
    });
    payload.settings = {
      ...(payload.settings || {}),
      difficulty,
    };
    if (Array.isArray(blueprint.correctLevels)) {
      payload.content = {
        ...(payload.content || {}),
        levels: blueprint.correctLevels.map((level) => ({
          level_id: level.level_id,
          level_name: level.level_name,
          blocks: Array.isArray(level.blocks) ? level.blocks.slice() : [],
          ...(level.block_names ? { block_names: { ...level.block_names } } : {}),
        })),
      };
    }
    return payload;
  }

  if (taskType === "open_answer") {
    return buildOpenAnswerTaskPayload({
      moduleId,
      topicId,
      taskId: blueprint.taskId,
      taskName: blueprint.taskName,
      questionText: blueprint.questionText,
      keywords: blueprint.keywords,
      referenceAnswer: blueprint.referenceAnswer,
    });
  }

  throw new Error(`unsupported_happy_path_payload_type:${taskType}:L${difficulty}`);
}

export function buildTypeHappyPathFixture(runId, taskType, difficulty = 1) {
  const normalizedType = String(taskType || "").trim();
  const normalizedDifficulty = Number(difficulty || 1);
  const slug = normalizeRunSlug(`${runId}_${normalizedType}_l${normalizedDifficulty}`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const displayType = normalizedType === "sequence_assembly" ? "sequence" : normalizedType;
  const complexName = `[CPW] ${displayType} Happy L${normalizedDifficulty} ${slug}`;
  const blueprint = buildTypeTaskBlueprint(slug, normalizedType, normalizedDifficulty);
  const payload = buildTypeTaskPayload(
    moduleId,
    topicId,
    blueprint,
    normalizedType,
    normalizedDifficulty,
    SHARED_SAMPLE_IMAGE_FILE
  );
  const taskRef = `${moduleId}/${topicId}/${blueprint.taskId}`;

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: `Happy-path fixture for ${normalizedType} level ${normalizedDifficulty}`,
    taskType: normalizedType,
    difficulty: normalizedDifficulty,
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: Math.max(1, normalizedDifficulty),
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    tasks: [
      {
        ...blueprint,
        difficulty: normalizedDifficulty,
        moduleId,
        topicId,
        taskRef,
        payload,
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    expected: {
      totalTasks: 1,
      successfulTasks: 1,
      failedTasks: 0,
      iterations: 1,
      successRatePercent: 100,
    },
  };
}

export async function seedSmokeTestL1Fixture({ baseUrl, runId }) {
  const fixture = buildSmokeTestL1Fixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export async function seedTestValidationFixture({ baseUrl, runId }) {
  const fixture = buildTestValidationFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export async function seedAdaptiveDifficultyFixture({ baseUrl, runId }) {
  const fixture = buildAdaptiveDifficultyFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export function buildMistakesUIFixture(runId, mode = "text_errors") {
  const normalizedMode = String(mode || "text_errors").trim();
  if (!["text_errors", "text_choice"].includes(normalizedMode)) {
    throw new Error(`unsupported_mistakesui_mode:${normalizedMode}`);
  }

  const slug = normalizeRunSlug(`${runId}_mistakes_${normalizedMode}`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] MistakesUI ${normalizedMode} ${slug}`;

  const taskId = `${slug}_task`;
  const taskName = `[CPW] MistakesUI ${normalizedMode} ${slug}`;
  const taskRef = `${moduleId}/${topicId}/${taskId}`;

  let questionText = "";
  let interaction = {};
  let payload = null;

  if (normalizedMode === "text_choice") {
    questionText = "Choose the only clinically correct corrected sentence.";
    interaction = {
      kind: "mistakes_text_choice",
      selectedOptionId: "opt-2",
      selectedOptionText: "Alpha theta gamma",
    };
    payload = buildMistakesUITaskPayload({
      moduleId,
      topicId,
      taskId,
      taskName,
      prompt: questionText,
      mode: "text_choice",
      referenceText: "Hint: only one sentence fully removes the detected error.",
      options: [
        { id: "opt-1", text: "Alpha beta gamma", is_correct: false },
        { id: "opt-2", text: "Alpha theta gamma", is_correct: true },
        { id: "opt-3", text: "Alpha beta delta", is_correct: false },
      ],
    });
  } else {
    questionText = "Mark the incorrect word in the sentence.";
    interaction = {
      kind: "mistakes_text_errors",
      wordIndex: 1,
      selectedWordText: "beta",
    };
    payload = buildMistakesUITaskPayload({
      moduleId,
      topicId,
      taskId,
      taskName,
      prompt: questionText,
      mode: "text_errors",
      text: "alpha beta gamma",
      requiredCorrect: 1,
      errorSpans: [
        { start: 6, end: 10, is_correct: false },
      ],
      referenceText: "alpha theta gamma",
      referenceSpans: [
        { start: 6, end: 11 },
      ],
    });
  }

  return {
    slug,
    moduleId,
    topicId,
    complexId,
    complexName,
    description: `MistakesUI ${normalizedMode} auto-submit fixture`,
    taskType: "click",
    taskSubtype: "error_detection",
    mode: normalizedMode,
    difficulty: 1,
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 1,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    tasks: [
      {
        taskId,
        taskName,
        questionText,
        expectedSuccess: true,
        interaction,
        difficulty: 1,
        moduleId,
        topicId,
        taskRef,
        payload,
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    expected: {
      totalTasks: 1,
      successfulTasks: 1,
      failedTasks: 0,
      iterations: 1,
      successRatePercent: 100,
    },
  };
}

export function buildTheoryBridgeFixture(runId) {
  const slug = normalizeRunSlug(`${runId}_theory_bridge`);
  const moduleId = `${slug}_module`;
  const topicId = `${slug}_topic`;
  const theoryId = `${slug}_theory`;
  const theoryTitle = `[CPW] Theory ${slug}`;
  const complexId = `${slug}_complex`;
  const complexName = `[CPW] Theory Bridge ${slug}`;

  const blueprint = buildTypeTaskBlueprint(slug, "open_answer", 1);
  const payload = buildTypeTaskPayload(
    moduleId,
    topicId,
    blueprint,
    "open_answer",
    1,
    SHARED_SAMPLE_IMAGE_FILE
  );
  const taskRef = `${moduleId}/${topicId}/${blueprint.taskId}`;

  return {
    slug,
    moduleId,
    topicId,
    theoryId,
    theoryTitle,
    complexId,
    complexName,
    description: "Theory bridge edge fixture for S1/S3 return-to-theory flows",
    taskType: "open_answer",
    difficulty: 1,
    theoryLink: {
      theory_id: theoryId,
      relation: "link",
      title_cache: theoryTitle,
    },
    settings: {
      adaptive_difficulty: false,
      escalation_on_success: false,
      error_pool_enabled: false,
      max_iterations: 1,
      smart_retry_near_offset: 0,
      smart_retry_near_jitter_max: 0,
      smart_retry_max_copies_per_task: 0,
      smart_retry_training_control_enabled: false,
    },
    tasks: [
      {
        ...blueprint,
        difficulty: 1,
        moduleId,
        topicId,
        taskRef,
        payload,
      },
    ],
    taskRefs: [taskRef],
    chains: [[taskRef]],
    expected: {
      totalTasks: 1,
      successfulTasks: 1,
      failedTasks: 0,
      iterations: 1,
      successRatePercent: 100,
    },
  };
}

export async function seedAdaptiveTypeFixture({ baseUrl, runId, taskType, dataDir }) {
  const fixture = buildAdaptiveTypeFixture(runId, taskType);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);
  await prepareTaskImageFixture(baseUrl, dataDir, fixture);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }
  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}


export async function seedRetryQueueFixture({ baseUrl, runId }) {
  const fixture = buildRetryQueueFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export async function seedPartialRetryFixture({ baseUrl, runId }) {
  const fixture = buildPartialRetryFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}


export async function seedHighLevelRetryFixture({ baseUrl, runId }) {
  const fixture = buildHighLevelRetryFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}


export async function seedHighLevelFlowResultsFixture({ baseUrl, runId, taskType, difficulty, dataDir }) {
  const fixture = buildHighLevelFlowResultsFixture(runId, taskType, difficulty);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);
  await prepareTaskImageFixture(baseUrl, dataDir, fixture);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}
async function prepareTaskImageFixture(baseUrl, dataDir, fixture) {
  if (!dataDir || !fixture || !["click", "draw"].includes(fixture.taskType)) {
    return;
  }

  const runtimeMode = await readRuntimeMode(baseUrl);
  const hostedRuntime = runtimeMode === "hosted_web";

  for (const task of fixture.tasks || []) {
    if (hostedRuntime) {
      const uploadForm = new FormData();
      uploadForm.set("module", fixture.moduleId);
      uploadForm.set("topic", fixture.topicId);
      uploadForm.set("task", task.taskId);
      uploadForm.set(
        "file",
        new Blob([await readFile(SHARED_SAMPLE_IMAGE_FILE)], { type: "image/svg+xml" }),
        path.basename(SHARED_SAMPLE_IMAGE_FILE)
      );

      const uploadResponse = await fetch(resolveUrl(baseUrl, "/api/editor/upload-image"), {
        method: "POST",
        headers: maybeAttachAuthHeaders(baseUrl, {}),
        body: uploadForm,
      });
      let uploadPayload = null;
      try {
        uploadPayload = await uploadResponse.json();
      } catch (_) {
        uploadPayload = null;
      }
      if (!uploadResponse.ok || !uploadPayload || uploadPayload.ok === false) {
        throw new Error(
          `upload_editor_image_failed:${uploadResponse.status}:${JSON.stringify(uploadPayload)}`
        );
      }

      const assetId = String(uploadPayload.asset_id || "").trim();
      const assetUrl = String(uploadPayload.asset_url || "").trim();
      if (!assetId && !assetUrl) {
        throw new Error(`upload_editor_image_missing_asset_ref:${JSON.stringify(uploadPayload)}`);
      }

      if (task.payload?.content && typeof task.payload.content === "object") {
        if (assetId) {
          task.payload.content.image_asset_id = assetId;
        }
        if (assetUrl) {
          task.payload.content.image_asset_url = assetUrl;
          task.payload.content.image = assetUrl;
        } else if (assetId) {
          task.payload.content.image = `/api/assets/${encodeURIComponent(assetId)}/content`;
        }
        delete task.payload.content.image_url;
      }
      continue;
    }

    const taskDir = path.join(
      dataDir,
      "modules",
      fixture.moduleId,
      "topics",
      fixture.topicId,
      "tasks",
      task.taskId
    );
    const imagesDir = path.join(taskDir, "images");
    const targetImagePath = path.join(imagesDir, path.basename(SHARED_SAMPLE_IMAGE_FILE));
    await mkdir(imagesDir, { recursive: true });
    await copyFile(SHARED_SAMPLE_IMAGE_FILE, targetImagePath);
    const runtimeImagePath = translateRuntimePathForApp(baseUrl, targetImagePath);

    if (task.payload?.content && typeof task.payload.content === "object") {
      task.payload.content.image = runtimeImagePath;
      delete task.payload.content.image_url;
    }
  }
}

export async function seedTypeHappyPathFixture({ baseUrl, runId, taskType, difficulty = 1, dataDir }) {
  const fixture = buildTypeHappyPathFixture(runId, taskType, difficulty);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);
  await prepareTaskImageFixture(baseUrl, dataDir, fixture);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export async function seedMistakesUIFixture({ baseUrl, runId, mode = "text_errors" }) {
  const fixture = buildMistakesUIFixture(runId, mode);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}

export async function seedTheoryBridgeFixture({ baseUrl, runId }) {
  const fixture = buildTheoryBridgeFixture(runId);
  const user = await ensureAuditUser(baseUrl, fixture.slug);

  await ensureModuleAndTopic(baseUrl, fixture.moduleId, fixture.topicId);

  await createTheory(baseUrl, {
    id: fixture.theoryId,
    title: fixture.theoryTitle,
    delta: {
      ops: [
        {
          insert: `${fixture.theoryTitle}\n`,
          attributes: { header: 1 },
        },
        {
          insert: "Theory bridge audit content.\n",
        },
      ],
    },
    images: [],
  });

  for (const task of fixture.tasks) {
    await saveEditorTask(baseUrl, fixture.moduleId, fixture.topicId, task.taskId, task.payload);
  }

  await ensureSmokeComplex(baseUrl, fixture);
  await cancelActiveSessionsForComplex(baseUrl, fixture.complexId);

  return {
    ...fixture,
    user,
  };
}



