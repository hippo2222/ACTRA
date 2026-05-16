import { assertApiOk, fetchJson } from "./data_seed.mjs";

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function extractSessionIdFromUrl(urlString) {
  const url = new URL(urlString);
  const parts = url.pathname.split("/").filter(Boolean);
  const sessionIndex = parts.indexOf("session");

  if (sessionIndex === -1 || !parts[sessionIndex + 1]) {
    throw new Error(`session_id_missing_in_url:${urlString}`);
  }

  return parts[sessionIndex + 1];
}

export function extractTaskIdentity(taskPayload) {
  const task = taskPayload?.task || taskPayload || {};
  const taskData = task.task_data || {};
  const taskId = String(taskData.id || task.task_id || "").trim();
  const taskName = String(
    taskData?.meta?.name || taskData?.name || taskData?.content?.task_name || taskId
  ).trim();

  return {
    taskId,
    taskName,
  };
}

export function getSessionScreen(urlString, sessionId) {
  const url = new URL(urlString);
  const sessionBasePath = `/session/${encodeURIComponent(sessionId)}`;

  if (url.pathname === sessionBasePath) {
    return "s1";
  }
  if (url.pathname === `${sessionBasePath}/results`) {
    return "s3";
  }
  if (url.pathname.startsWith(`${sessionBasePath}/iteration/`)) {
    return "s2";
  }
  return "other";
}

export async function tryReadResponseJson(response) {
  if (!response) return null;
  try {
    return await response.json();
  } catch (_) {
    return null;
  }
}

export function computeSuccessRatePercent(results) {
  if (results?.success_rate != null) {
    return Math.round(Number(results.success_rate) * 100);
  }
  const total = Number(results?.total_tasks || 0);
  const success = Number(results?.successful_tasks || 0);
  if (!total) return 0;
  return Math.round((success / total) * 100);
}

export function buildSessionIterationUrl(baseUrl, sessionId, iteration) {
  return new URL(
    `/session/${encodeURIComponent(sessionId)}/iteration/${encodeURIComponent(iteration)}`,
    baseUrl
  ).toString();
}

export function buildSessionResultsUrl(baseUrl, sessionId) {
  return new URL(`/session/${encodeURIComponent(sessionId)}/results`, baseUrl).toString();
}

export async function readCurrentTask(baseUrl, sessionId) {
  return assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/task`),
    "current_task"
  );
}

export async function readActiveSessions(baseUrl) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, "/api/sessions/active"),
    "active_sessions"
  );
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function pauseSession(baseUrl, sessionId) {
  return fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function resumeSession(baseUrl, sessionId) {
  return fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/resume`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function cancelSession(baseUrl, sessionId) {
  return fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
}

export async function readIterationResults(baseUrl, sessionId) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/iteration-results`),
    "iteration_results"
  );
  return payload.results || {};
}

export async function readFinalResults(baseUrl, sessionId) {
  const payload = assertApiOk(
    await fetchJson(baseUrl, `/api/session/${encodeURIComponent(sessionId)}/final-results`),
    "final_results"
  );
  return payload.results || {};
}
