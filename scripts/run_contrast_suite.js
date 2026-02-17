const { spawn } = require("child_process");

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--base-url" && argv[i + 1]) {
      args.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--base-url=")) {
      args.baseUrl = token.slice("--base-url=".length);
      continue;
    }
  }
  return args;
}

async function pingBaseUrl(baseUrl, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
    });
    return !!response;
  } catch (e) {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let json = null;
  try {
    json = await response.json();
  } catch (e) {
    json = null;
  }
  return { response, json };
}

async function ensureActiveSession(baseUrl) {
  const activeUrl = new URL("/api/sessions/active", baseUrl).toString();
  const { response: activeRes, json: activeJson } = await fetchJson(activeUrl);
  if (activeRes.ok && activeJson && Array.isArray(activeJson.items) && activeJson.items.length) {
    return { ok: true, created: false, count: activeJson.items.length };
  }

  const complexesUrl = new URL("/api/complexes", baseUrl).toString();
  const { response: complexesRes, json: complexesJson } = await fetchJson(complexesUrl);
  if (!complexesRes.ok || !complexesJson || !Array.isArray(complexesJson.items)) {
    return {
      ok: false,
      error: "cannot_load_complexes",
      details: complexesJson && (complexesJson.error || complexesJson.message),
    };
  }

  const first = complexesJson.items.find((item) => item && (item.id || item.complex_id));
  if (!first) {
    return { ok: false, error: "no_complexes_available" };
  }
  const complexId = first.id || first.complex_id;

  const startUrl = new URL(
    `/api/session/${encodeURIComponent(complexId)}/start`,
    baseUrl
  ).toString();
  const { response: startRes, json: startJson } = await fetchJson(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_iteration: 1 }),
  });
  if (!startRes.ok || !startJson || !startJson.ok) {
    return {
      ok: false,
      error: "cannot_start_session",
      details: startJson && (startJson.error || startJson.message),
      complexId,
    };
  }

  const { response: activeRes2, json: activeJson2 } = await fetchJson(activeUrl);
  if (!activeRes2.ok || !activeJson2 || !Array.isArray(activeJson2.items) || !activeJson2.items.length) {
    return {
      ok: true,
      created: true,
      complexId,
      count: 0,
      activeVisible: false,
      sessionId: startJson.session_id || null,
    };
  }

  return {
    ok: true,
    created: true,
    complexId,
    count: activeJson2.items.length,
    activeVisible: true,
    sessionId: startJson.session_id || null,
  };
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function main() {
  const cli = parseArgs();
  const baseUrl = cli.baseUrl || "http://127.0.0.1:8000";

  console.log(`[contrast-suite] Checking server: ${baseUrl}`);
  const isUp = await pingBaseUrl(baseUrl);
  if (!isUp) {
    console.error(
      `[contrast-suite] Server is not reachable at ${baseUrl}. Start desktop-app/server.py and retry.`
    );
    process.exit(1);
  }

  console.log("[contrast-suite] Ensuring active session...");
  const activeStatus = await ensureActiveSession(baseUrl);
  if (!activeStatus.ok) {
    console.error(
      `[contrast-suite] Failed to prepare active session: ${activeStatus.error}${
        activeStatus.details ? ` (${activeStatus.details})` : ""
      }`
    );
    process.exit(1);
  }
  if (activeStatus.created) {
    if (activeStatus.activeVisible === false) {
      console.log(
        `[contrast-suite] Session started (${activeStatus.sessionId || "unknown"}), but /api/sessions/active is empty. Continuing with audit auto-create fallback.`
      );
    } else {
      console.log(
        `[contrast-suite] Active session created from complex ${activeStatus.complexId}.`
      );
    }
  } else {
    console.log(
      `[contrast-suite] Active sessions already available: ${activeStatus.count}.`
    );
  }

  console.log("[contrast-suite] Building CSS...");
  await runCommand("npm", ["run", "build:css"]);

  console.log("[contrast-suite] Running base contrast audit (S1/S2/S3)...");
  await runCommand("node", [
    "scripts/contrast_audit.js",
    "--config",
    "scripts/contrast_audit.config.json",
    "--base-url",
    baseUrl,
  ]);

  console.log("[contrast-suite] Running S1 state matrix audit...");
  await runCommand("node", [
    "scripts/contrast_audit.js",
    "--config",
    "scripts/contrast_audit.s1_state_matrix.config.json",
    "--base-url",
    baseUrl,
  ]);

  console.log("[contrast-suite] Completed.");
}

main().catch((err) => {
  console.error("[contrast-suite] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
