import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { mkdir, cp, writeFile } from "node:fs/promises";

import { makeRunId, resolveProjectPath } from "./base.mjs";

async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

async function copyBaselineData(projectRoot, targetDataDir) {
  const sourceDataDir = resolveProjectPath(projectRoot, "data");
  await cp(sourceDataDir, targetDataDir, { recursive: true });
  return targetDataDir;
}

async function fetchHealth(baseUrl, readyPath = "/api/users/current") {
  try {
    const response = await fetch(new URL(readyPath, baseUrl), { method: "GET" });
    return response.ok;
  } catch (_) {
    return false;
  }
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
  await ensureDir(runRoot);
  await ensureDir(logsDir);
  await copyBaselineData(projectRoot, dataDir);
  return { runId, runRoot, dataDir, logsDir };
}

export async function waitForRuntimeServer(
  baseUrl,
  { timeoutMs = 30000, pollMs = 500, readyPath = "/api/users/current" } = {}
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fetchHealth(baseUrl, readyPath)) {
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

export async function startRuntimeServer({
  projectRoot,
  runRoot,
  dataDir,
  startupUserId = "",
  port,
  pythonCommand = process.env.PYTHON || "python",
  env = {},
  readyPath = "/api/users/current",
} = {}) {
  const resolvedPort = Number(port) || (await allocatePort());
  const baseUrl = `http://127.0.0.1:${resolvedPort}`;
  const logsDir = path.resolve(runRoot, "logs");
  const stdoutPath = path.resolve(logsDir, "server.stdout.log");
  const stderrPath = path.resolve(logsDir, "server.stderr.log");

  await ensureDir(logsDir);
  await writeFile(stdoutPath, "", "utf-8");
  await writeFile(stderrPath, "", "utf-8");

  const child = spawn(pythonCommand, ["desktop-app/server.py"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      ...env,
      TRAINER_HTTP_PORT: String(resolvedPort),
      TRAINER_DATA_ROOT: String(dataDir),
      ...(startupUserId ? { TRAINER_STARTUP_USER_ID: String(startupUserId) } : {}),
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
    await waitForRuntimeServer(baseUrl, { readyPath });
  } catch (error) {
    await stopRuntimeServer({ process: child });
    throw error;
  }

  return {
    process: child,
    port: resolvedPort,
    baseUrl,
    stdoutPath,
    stderrPath,
    readyPath,
  };
}

export async function stopRuntimeServer(runtimeServer, { timeoutMs = 10000 } = {}) {
  if (!runtimeServer || !runtimeServer.process) {
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
} = {}) {
  const runtime = await createRuntimeRunRoot({ projectRoot, runId, rootDir });
  const server = await startRuntimeServer({
    projectRoot,
    runRoot: runtime.runRoot,
    dataDir: runtime.dataDir,
    startupUserId,
    port,
    pythonCommand,
  });

  return {
    ...runtime,
    ...server,
    async dispose() {
      await stopRuntimeServer(server);
    },
  };
}
