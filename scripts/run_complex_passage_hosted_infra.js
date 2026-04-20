const { spawnSync } = require("node:child_process");
const path = require("node:path");

function buildRuntimeEnv() {
  const env = { ...process.env };
  const dockerBinDir = path.join(
    "C:\\Program Files\\Docker\\Docker\\resources\\bin"
  );
  const currentPath = String(env.PATH || env.Path || "");
  const pathEntries = currentPath
    .split(path.delimiter)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);

  if (!pathEntries.includes(dockerBinDir)) {
    pathEntries.unshift(dockerBinDir);
  }

  env.PATH = pathEntries.join(path.delimiter);
  env.Path = env.PATH;
  return env;
}

const runtimeEnv = buildRuntimeEnv();

function ensureDockerAvailable() {
  const dockerCheck = spawnSync("docker", ["--version"], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: runtimeEnv,
  });

  if (dockerCheck.error || dockerCheck.status !== 0) {
    const reason = dockerCheck.error
      ? dockerCheck.error.message
      : String((dockerCheck.stderr || "").toString("utf-8") || "").trim();
    console.error(
      [
        "Docker is required for `smoke:complex-passage:hosted:infra`.",
        "Install and start Docker Desktop, then verify:",
        "  docker --version",
        "  docker compose version",
        reason ? `Details: ${reason}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
    process.exit(1);
  }
}

ensureDockerAvailable();

const command = process.execPath;
const playwrightCliPath = require.resolve("@playwright/test/cli");
const args = [
  playwrightCliPath,
  "test",
  "-c",
  "playwright.complex-passage-hosted.config.js",
  ...process.argv.slice(2),
];

const result = spawnSync(command, args, {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    ...runtimeEnv,
    ACTRA_AUDIT_RUNTIME_BACKEND: "docker_compose",
  },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

process.exit(1);
