import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { mkdir, cp, readdir, readFile, writeFile } from "node:fs/promises";

import { makeRunId, resolveProjectPath } from "./base.mjs";
import {
  bootstrapHostedAuthSession,
  registerRuntimeContext,
  unregisterRuntimeContext,
} from "./runtime_context.mjs";

const DEFAULT_RUNTIME_BACKEND =
  String(process.env.ACTRA_AUDIT_RUNTIME_BACKEND || "local_python").trim() || "local_python";
const DOCKER_APP_DATA_DIR = "/app/data";

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function copyBaselineData(projectRoot, targetDataDir) {
  const sourceDataDir = resolveProjectPath(projectRoot, "data");
  await cp(sourceDataDir, targetDataDir, { recursive: true });
  return targetDataDir;
}

function hasOwnEnv(env, name) {
  return Boolean(env && Object.prototype.hasOwnProperty.call(env, name));
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

async function resolveHostedStartupUserId(dataDir) {
  const dataRoot = path.resolve(String(dataDir || ""));
  if (!dataRoot) {
    return "";
  }

  const appState = await readJsonIfExists(path.join(dataRoot, "app_state.json"));
  const appStateUserId = String(appState?.last_user_id || "").trim();
  if (appStateUserId && appStateUserId !== "guest" && appStateUserId !== "default_user") {
    return appStateUserId;
  }

  try {
    const usersDir = path.join(dataRoot, "users");
    const entries = await readdir(usersDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const userId = String(entry.name || "").trim();
      if (!userId || userId === "guest" || userId === "default_user") {
        continue;
      }
      const profile = await readJsonIfExists(path.join(usersDir, userId, "profile.json"));
      if (profile && String(profile.user_id || "").trim() === userId) {
        return userId;
      }
    }
  } catch (_) {
    return "";
  }

  return "";
}

function sanitizeComposeProjectName(runId = "") {
  const slug =
    String(runId || "cpw")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 42)
      .replace(/^-+|-+$/g, "") || "cpw";
  return `actra-${slug}`;
}

function buildAuditRuntimeKey(runId = "") {
  const slug =
    String(runId || "cpw")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 42) || "cpw";
  return `actra-${slug}-runtime-key`;
}

async function fetchHealth(baseUrl, readyPath = "/api/health", expectedRuntimeMode = "") {
  try {
    const response = await fetch(new URL(readyPath, baseUrl), { method: "GET" });
    if (!response.ok) {
      return false;
    }
    if (!expectedRuntimeMode) {
      return true;
    }

    let payload = null;
    try {
      payload = await response.json();
    } catch (_) {
      payload = null;
    }

    const runtimeMode = String(payload?.runtime_mode || "").trim();
    return runtimeMode === expectedRuntimeMode;
  } catch (_) {
    return false;
  }
}

async function runCommand(executable, args, { cwd, env, timeoutMs = 120000 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timer = null;

    const finalize = (fn) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      fn();
    };

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finalize(() => reject(error));
    });
    child.on("exit", (code, signal) => {
      finalize(() => {
        if (code === 0) {
          resolve({ stdout, stderr, code, signal });
          return;
        }
        const message = [
          `${executable} ${args.join(" ")} failed`,
          `code=${code} signal=${signal}`,
          stdout ? `stdout:\n${stdout}` : "",
          stderr ? `stderr:\n${stderr}` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
        reject(new Error(message));
      });
    });

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        finalize(() => {
          reject(
            new Error(`${executable} ${args.join(" ")} timed out after ${timeoutMs}ms`)
          );
        });
      }, timeoutMs);
    }
  });
}

async function runDockerCompose(args, { cwd, env, timeoutMs } = {}) {
  return await runCommand("docker", ["compose", ...args], {
    cwd,
    env,
    timeoutMs,
  });
}

async function cleanupDockerComposeProject(server, { timeoutMs = 180000 } = {}) {
  if (!server?.composeProjectName || !server?.composeFile || !server?.projectRoot) {
    return;
  }

  try {
    await runDockerCompose(
      [
        "-p",
        server.composeProjectName,
        "-f",
        server.composeFile,
        "down",
        "-v",
        "--remove-orphans",
      ],
      {
        cwd: server.projectRoot,
        env: server.composeEnv,
        timeoutMs,
      }
    );
  } catch (_) {
    // Best-effort cleanup only.
  }
}

async function writeDockerComposeLogs(server) {
  if (!server?.composeProjectName) {
    return;
  }
  try {
    const { stdout, stderr } = await runDockerCompose(
      [
        "-p",
        server.composeProjectName,
        "-f",
        server.composeFile,
        "logs",
        "--no-color",
      ],
      {
        cwd: server.projectRoot,
        env: server.composeEnv,
        timeoutMs: 30000,
      }
    );
    await writeFile(server.stdoutPath, stdout || "", "utf-8");
    await writeFile(server.stderrPath, stderr || "", "utf-8");
  } catch (error) {
    const text = String(error?.stack || error?.message || error);
    await writeFile(server.stderrPath, text, "utf-8");
  }
}

async function registerRuntime(baseUrl, context) {
  registerRuntimeContext(baseUrl, context);
}

export async function allocatePort() {
  const { createServer } = await import("node:net");
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function createRuntimeRunRoot({
  projectRoot,
  runId = makeRunId(),
  rootDir = resolveProjectPath(projectRoot, "tmp_audit_fixtures", "complex_passage_playwright"),
} = {}) {
  const runRoot = path.resolve(rootDir, runId);
  const dataDir = path.resolve(runRoot, "data");
  const logsDir = path.resolve(runRoot, "logs");
  const runtimeStateDir = path.resolve(runRoot, "runtime_state");
  await ensureDir(runRoot);
  await ensureDir(logsDir);
  await ensureDir(runtimeStateDir);
  await copyBaselineData(projectRoot, dataDir);
  return { runId, runRoot, dataDir, logsDir, runtimeStateDir };
}

export async function waitForRuntimeServer(
  baseUrl,
  {
    timeoutMs = 30000,
    pollMs = 500,
    readyPath = "/api/health",
    expectedRuntimeMode = "",
  } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchHealth(baseUrl, readyPath, expectedRuntimeMode)) {
      return true;
    }
    await delay(pollMs);
  }
  throw new Error(
    `Runtime server did not become ready within ${timeoutMs}ms: ${new URL(
      readyPath,
      baseUrl
    )}`
  );
}

async function startLocalRuntimeServer({
  projectRoot,
  runId,
  runRoot,
  dataDir,
  logsDir,
  startupUserId = "",
  port,
  pythonCommand = process.env.PYTHON || "python",
  runtimeMode = String(process.env.ACTRA_AUDIT_RUNTIME_MODE || "hosted_web").trim() || "hosted_web",
  env = {},
  readyPath = "/api/health",
  expectedRuntimeMode = "",
} = {}) {
  const resolvedPort = Number(port) || (await allocatePort());
  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  const stdoutPath = path.resolve(logsDir, "server.stdout.log");
  const stderrPath = path.resolve(logsDir, "server.stderr.log");
  const resolvedRuntimeMode =
    String(runtimeMode || process.env.ACTRA_AUDIT_RUNTIME_MODE || "hosted_web").trim() ||
    "hosted_web";
  const resolvedExpectedRuntimeMode =
    String(expectedRuntimeMode || resolvedRuntimeMode).trim() || "";
  const generatedRuntimeKey = buildAuditRuntimeKey(runId);
  const resolvedSecretKey =
    String(env.ACTRA_SECRET_KEY || process.env.ACTRA_SECRET_KEY || generatedRuntimeKey).trim() ||
    generatedRuntimeKey;
  let resolvedStartupUserId = String(startupUserId || "").trim();

  await ensureDir(logsDir);
  await writeFile(stdoutPath, "", "utf-8");
  await writeFile(stderrPath, "", "utf-8");

  if (
    resolvedRuntimeMode === "hosted_web" &&
    !resolvedStartupUserId &&
    !hasOwnEnv(env, "TRAINER_STARTUP_USER_ID")
  ) {
    resolvedStartupUserId = await resolveHostedStartupUserId(dataDir);
  }

  const hostedRuntimeDefaults =
    resolvedRuntimeMode === "hosted_web"
      ? {
          ACTRA_HOSTED_DEV_AUTH_BRIDGE: "1",
          ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK: "1",
        }
      : {};

  const child = spawn(pythonCommand, ["desktop-app/server.py"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...hostedRuntimeDefaults,
      ...env,
      ACTRA_SECRET_KEY: resolvedSecretKey,
      ACTRA_RUNTIME_MODE: resolvedRuntimeMode,
      TRAINER_HTTP_PORT: String(resolvedPort),
      TRAINER_DATA_ROOT: String(dataDir),
      ...(resolvedStartupUserId
        ? { TRAINER_STARTUP_USER_ID: String(resolvedStartupUserId) }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";

  child.stdout?.on("data", async (chunk) => {
    const text = String(chunk);
    stdoutBuffer += text;
    await writeFile(stdoutPath, stdoutBuffer, "utf-8");
  });

  child.stderr?.on("data", async (chunk) => {
    const text = String(chunk);
    stderrBuffer += text;
    await writeFile(stderrPath, stderrBuffer, "utf-8");
  });

  child.once("exit", (code, signal) => {
    if (!stdoutBuffer && !stderrBuffer) {
      return;
    }
    if (code !== null || signal) {
      stderrBuffer += `\n[process-exit] code=${code} signal=${signal}\n`;
      void writeFile(stderrPath, stderrBuffer, "utf-8");
    }
  });

  try {
    await waitForRuntimeServer(baseUrl, {
      readyPath,
      expectedRuntimeMode: resolvedExpectedRuntimeMode,
    });
  } catch (error) {
    await stopRuntimeServer({ backend: "local_python", process: child, baseUrl });
    throw error;
  }

  await registerRuntime(baseUrl, {
    backend: "local_python",
    hostDataDir: dataDir,
    appDataDir: dataDir,
    supportsShadowFileAssertions: true,
  });

  return {
    backend: "local_python",
    process: child,
    port: resolvedPort,
    baseUrl,
    stdoutPath,
    stderrPath,
    readyPath,
    runtimeMode: resolvedRuntimeMode,
    expectedRuntimeMode: resolvedExpectedRuntimeMode,
    startupUserId: resolvedStartupUserId,
    secretKey: resolvedSecretKey,
    supportsShadowFileAssertions: true,
  };
}

async function startDockerComposeRuntime({
  projectRoot,
  runId,
  runRoot,
  dataDir,
  logsDir,
  runtimeStateDir,
  port,
  env = {},
  readyPath = "/ready",
  expectedRuntimeMode = "hosted_web",
  startupAttempt = 0,
} = {}) {
  const resolvedPort = Number(port) || (await allocatePort());
  const resolvedMailpitHttpPort = await allocatePort();
  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  const stdoutPath = path.resolve(logsDir, "compose.stdout.log");
  const stderrPath = path.resolve(logsDir, "compose.stderr.log");
  const composeProjectName = sanitizeComposeProjectName(runId);
  const composeFile = resolveProjectPath(projectRoot, "docker-compose.hosted.yml");
  const generatedRuntimeKey = buildAuditRuntimeKey(runId);
  const resolvedSecretKey =
    String(env.ACTRA_SECRET_KEY || process.env.ACTRA_SECRET_KEY || generatedRuntimeKey).trim() ||
    generatedRuntimeKey;
  const composeEnv = {
    ...process.env,
    ...env,
    ACTRA_HOSTED_APP_PORT: String(resolvedPort),
    ACTRA_HOSTED_MAILPIT_HTTP_PORT: String(resolvedMailpitHttpPort),
    ACTRA_HOSTED_DATA_ROOT_HOST: String(dataDir),
    ACTRA_HOSTED_RUNTIME_STATE_ROOT_HOST: String(runtimeStateDir),
    ACTRA_HOSTED_LOGS_ROOT_HOST: String(logsDir),
    ACTRA_SECRET_KEY: resolvedSecretKey,
    ACTRA_RUNTIME_MODE: "hosted_web",
    ACTRA_HOSTED_PERSISTENCE_STRICT: "1",
    ACTRA_HOSTED_DEV_AUTH_BRIDGE: "0",
    ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK: "0",
  };

  await ensureDir(logsDir);
  await ensureDir(runtimeStateDir);
  await writeFile(stdoutPath, "", "utf-8");
  await writeFile(stderrPath, "", "utf-8");

  const server = {
    backend: "docker_compose",
    process: null,
    port: resolvedPort,
    baseUrl,
    stdoutPath,
    stderrPath,
    readyPath,
    runtimeMode: "hosted_web",
    expectedRuntimeMode,
    startupUserId: "",
    secretKey: resolvedSecretKey,
    supportsShadowFileAssertions: false,
    composeProjectName,
    composeFile,
    composeEnv,
    projectRoot,
    runRoot,
    dataDir,
    runtimeStateDir,
  };

  try {
    await cleanupDockerComposeProject(server, { timeoutMs: 120000 });

    const upResult = await runDockerCompose(
      [
        "-p",
        composeProjectName,
        "-f",
        composeFile,
        "up",
        "-d",
        "--build",
      ],
      {
        cwd: projectRoot,
        env: composeEnv,
        timeoutMs: 600000,
      }
    );
    await writeFile(stdoutPath, upResult.stdout || "", "utf-8");
    await writeFile(stderrPath, upResult.stderr || "", "utf-8");

    await waitForRuntimeServer(baseUrl, {
      readyPath,
      expectedRuntimeMode,
      timeoutMs: 180000,
    });

    const authSession = await bootstrapHostedAuthSession(baseUrl, runId);
    await registerRuntime(baseUrl, {
      backend: "docker_compose",
      hostDataDir: dataDir,
      appDataDir: DOCKER_APP_DATA_DIR,
      supportsShadowFileAssertions: false,
      strictHostedAuth: true,
      ...authSession,
    });

    return server;
  } catch (error) {
    await writeDockerComposeLogs(server);
    await cleanupDockerComposeProject(server, { timeoutMs: 120000 });
    const errorText = String(error?.message || error || "");
    if (
      !Number(port) &&
      startupAttempt < 3 &&
      (errorText.includes("address already in use") ||
        errorText.includes("port is already allocated"))
    ) {
      return await startDockerComposeRuntime({
        projectRoot,
        runId,
        runRoot,
        dataDir,
        logsDir,
        runtimeStateDir,
        env,
        readyPath,
        expectedRuntimeMode,
        startupAttempt: startupAttempt + 1,
      });
    }
    throw error;
  }
}

export async function startRuntimeServer({
  projectRoot,
  runId,
  runRoot,
  dataDir,
  logsDir = path.resolve(runRoot, "logs"),
  runtimeStateDir = path.resolve(runRoot, "runtime_state"),
  startupUserId = "",
  port,
  pythonCommand = process.env.PYTHON || "python",
  runtimeMode = String(process.env.ACTRA_AUDIT_RUNTIME_MODE || "hosted_web").trim() || "hosted_web",
  runtimeBackend = DEFAULT_RUNTIME_BACKEND,
  env = {},
  readyPath,
  expectedRuntimeMode = "",
} = {}) {
  if (runtimeBackend === "docker_compose") {
    return await startDockerComposeRuntime({
      projectRoot,
      runId,
      runRoot,
      dataDir,
      logsDir,
      runtimeStateDir,
      port,
      env,
      readyPath: readyPath || "/ready",
      expectedRuntimeMode: String(expectedRuntimeMode || "hosted_web").trim() || "hosted_web",
    });
  }

  return await startLocalRuntimeServer({
    projectRoot,
    runId,
    runRoot,
    dataDir,
    logsDir,
    startupUserId,
    port,
    pythonCommand,
    runtimeMode,
    env,
    readyPath: readyPath || "/api/health",
    expectedRuntimeMode,
  });
}

async function restartDockerComposeRuntime(runtimeServer, { timeoutMs = 180000 } = {}) {
  await runDockerCompose(
    [
      "-p",
      runtimeServer.composeProjectName,
      "-f",
      runtimeServer.composeFile,
      "restart",
      "app",
    ],
    {
      cwd: runtimeServer.projectRoot,
      env: runtimeServer.composeEnv,
      timeoutMs: 120000,
    }
  );

  await waitForRuntimeServer(runtimeServer.baseUrl, {
    readyPath: runtimeServer.readyPath || "/ready",
    expectedRuntimeMode: runtimeServer.expectedRuntimeMode || "hosted_web",
    timeoutMs,
  });

  return runtimeServer;
}

export async function stopRuntimeServer(runtimeServer, { timeoutMs = 10000 } = {}) {
  if (!runtimeServer) {
    return;
  }

  unregisterRuntimeContext(runtimeServer.baseUrl);

  if (runtimeServer.backend === "docker_compose") {
    await writeDockerComposeLogs(runtimeServer);
    await cleanupDockerComposeProject(runtimeServer, { timeoutMs: 180000 });
    return;
  }

  if (!runtimeServer.process) {
    return;
  }

  const child = runtimeServer.process;
  if (child.exitCode !== null || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.killed) {
      return;
    }
    await delay(250);
  }

  child.kill("SIGKILL");
}

export async function createRuntimeHarness({
  projectRoot,
  runId = makeRunId(),
  startupUserId = "",
  port,
  rootDir,
  pythonCommand,
  runtimeMode,
  runtimeBackend = DEFAULT_RUNTIME_BACKEND,
  env,
  readyPath,
} = {}) {
  const runtime = await createRuntimeRunRoot({ projectRoot, runId, rootDir });
  let server = await startRuntimeServer({
    projectRoot,
    runId,
    runRoot: runtime.runRoot,
    dataDir: runtime.dataDir,
    logsDir: runtime.logsDir,
    runtimeStateDir: runtime.runtimeStateDir,
    startupUserId,
    port,
    pythonCommand,
    runtimeMode,
    runtimeBackend,
    env,
    readyPath,
  });

  const syncServerFields = (target, nextServer) => {
    target.backend = nextServer.backend;
    target.process = nextServer.process;
    target.port = nextServer.port;
    target.baseUrl = nextServer.baseUrl;
    target.stdoutPath = nextServer.stdoutPath;
    target.stderrPath = nextServer.stderrPath;
    target.readyPath = nextServer.readyPath;
    target.runtimeMode = nextServer.runtimeMode;
    target.expectedRuntimeMode = nextServer.expectedRuntimeMode;
    target.startupUserId = nextServer.startupUserId;
    target.secretKey = nextServer.secretKey;
    target.supportsShadowFileAssertions = nextServer.supportsShadowFileAssertions;
    target.composeProjectName = nextServer.composeProjectName || null;
    target.composeFile = nextServer.composeFile || null;
    target.appDataDir = nextServer.backend === "docker_compose" ? DOCKER_APP_DATA_DIR : runtime.dataDir;
  };

  const harness = {
    ...runtime,
    backend: server.backend,
    projectRoot,
    pythonCommand,
    runtimeBackend,
    port: server.port,
    process: server.process,
    baseUrl: server.baseUrl,
    stdoutPath: server.stdoutPath,
    stderrPath: server.stderrPath,
    readyPath: server.readyPath,
    runtimeMode: server.runtimeMode,
    expectedRuntimeMode: server.expectedRuntimeMode,
    startupUserId: server.startupUserId,
    secretKey: server.secretKey,
    supportsShadowFileAssertions: server.supportsShadowFileAssertions,
    composeProjectName: server.composeProjectName || null,
    composeFile: server.composeFile || null,
    appDataDir: server.backend === "docker_compose" ? DOCKER_APP_DATA_DIR : runtime.dataDir,
    async restart(options = {}) {
      if (server.backend === "docker_compose") {
        server = await restartDockerComposeRuntime(server);
        syncServerFields(this, server);
        return this;
      }

      await stopRuntimeServer(server);
      server = await startRuntimeServer({
        projectRoot,
        runId,
        runRoot: runtime.runRoot,
        dataDir: runtime.dataDir,
        logsDir: runtime.logsDir,
        runtimeStateDir: runtime.runtimeStateDir,
        startupUserId: options.startupUserId ?? this.startupUserId,
        port: options.port || server.port,
        pythonCommand,
        env: options.env || {},
        runtimeMode: options.runtimeMode || this.runtimeMode,
        runtimeBackend: options.runtimeBackend || this.runtimeBackend,
        readyPath: options.readyPath || server.readyPath,
        expectedRuntimeMode: options.expectedRuntimeMode || this.expectedRuntimeMode,
      });
      syncServerFields(this, server);
      return this;
    },
    async dispose() {
      await stopRuntimeServer(server);
    },
  };

  return harness;
}
