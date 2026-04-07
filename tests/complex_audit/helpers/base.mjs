import path from "node:path";

export function makeRunId(prefix = "cpw") {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `${prefix}_${iso}_${Math.random().toString(16).slice(2, 8)}`;
}

export function makeAuditUserId(runId) {
  return `pw_audit_${String(runId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

export function resolveProjectPath(projectRoot, ...segments) {
  return path.resolve(projectRoot, ...segments);
}

export async function waitForPageStable(page, timeoutMs = 10000) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 5000) });
  } catch (_) {
    // Some app surfaces keep background requests alive; DOM readiness is enough
    // for the first iteration of the audit harness.
  }
}

export function attachConsoleTracking(page, sink = []) {
  page.on("console", (msg) => {
    sink.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
    });
  });
  return sink;
}

export function attachPageErrorTracking(page, sink = []) {
  page.on("pageerror", (error) => {
    sink.push({
      message: error && error.message ? error.message : String(error),
      stack: error && error.stack ? error.stack : "",
    });
  });
  return sink;
}
