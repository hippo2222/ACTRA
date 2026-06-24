const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { setTimeout: sleep } = require("node:timers/promises");

const DOCKER_COMPOSE_FILE = "docker-compose.hosted.yml";
const DEFAULT_PORT = process.env.ACTRA_HOSTED_APP_PORT || "8000";
const LOCAL_ACCEPTANCE_DEFAULTS = {
  ACTRA_SECRET_KEY: "local-launch-acceptance-secret",
  ACTRA_AUTH_EMAIL_ENABLED: "1",
  ACTRA_AUTH_SMTP_HOST: "mailpit",
  ACTRA_AUTH_SMTP_PORT: "1025",
  ACTRA_AUTH_SMTP_FROM: "noreply@localhost.test",
  ACTRA_AUTH_SMTP_USE_TLS: "0",
  ACTRA_AUTH_SMTP_USE_SSL: "0",
  ACTRA_AUTH_PUBLIC_BASE_URL: `http://localhost:${DEFAULT_PORT}`,
  ACTRA_SESSION_COOKIE_SECURE: "1",
  ACTRA_HOSTED_DEV_AUTH_BRIDGE: "0",
  ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK: "0",
};

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

  for (const [name, value] of Object.entries(LOCAL_ACCEPTANCE_DEFAULTS)) {
    if (env[name] == null || String(env[name]).trim() === "") {
      env[name] = value;
    }
  }

  return env;
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));
  return {
    dryRun: flags.has("--dry-run"),
    keepStack: flags.has("--keep-stack"),
    skipCompanionPassage: flags.has("--skip-companion-passage"),
  };
}

function ensureDockerAvailable(runtimeEnv) {
  const dockerCheck = spawnSync("docker", ["--version"], {
    cwd: process.cwd(),
    stdio: "pipe",
    env: runtimeEnv,
  });

  if (dockerCheck.error || dockerCheck.status !== 0) {
    const reason = dockerCheck.error
      ? dockerCheck.error.message
      : String((dockerCheck.stderr || "").toString("utf-8") || "").trim();
    throw new Error(
      [
        "Docker is required for `smoke:launch-acceptance:hosted`.",
        "Install and start Docker Desktop, then verify:",
        "  docker --version",
        "  docker compose version",
        reason ? `Details: ${reason}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

function envBool(env, name, defaultValue = false) {
  const raw = env[name];
  if (raw == null || String(raw).trim() === "") {
    return Boolean(defaultValue);
  }
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function validateLaunchEnv(env, baseUrl) {
  const errors = [];
  const warnings = [];
  const secretKey = String(env.ACTRA_SECRET_KEY || "").trim();
  const smtpHost = String(env.ACTRA_AUTH_SMTP_HOST || "").trim();
  const smtpFrom = String(env.ACTRA_AUTH_SMTP_FROM || "").trim();
  const smtpUser = String(env.ACTRA_AUTH_SMTP_USER || "").trim();

  if (!baseUrl) {
    errors.push("ACTRA_AUTH_PUBLIC_BASE_URL must be configured for launch acceptance.");
  }
  if (!secretKey) {
    errors.push("ACTRA_SECRET_KEY must be configured.");
  } else if (secretKey === "change-me-before-production") {
    errors.push("ACTRA_SECRET_KEY still uses the default placeholder.");
  }
  if (!envBool(env, "ACTRA_AUTH_EMAIL_ENABLED", false)) {
    errors.push("ACTRA_AUTH_EMAIL_ENABLED must be enabled for launch acceptance.");
  }
  if (!smtpHost) {
    errors.push("ACTRA_AUTH_SMTP_HOST must be configured.");
  }
  if (!smtpFrom && !smtpUser) {
    errors.push("ACTRA_AUTH_SMTP_FROM or ACTRA_AUTH_SMTP_USER must be configured.");
  }
  if (!envBool(env, "ACTRA_SESSION_COOKIE_SECURE", true)) {
    errors.push("ACTRA_SESSION_COOKIE_SECURE must stay enabled.");
  }
  if (envBool(env, "ACTRA_HOSTED_DEV_AUTH_BRIDGE", false)) {
    errors.push("ACTRA_HOSTED_DEV_AUTH_BRIDGE must stay disabled.");
  }
  if (envBool(env, "ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK", false)) {
    errors.push("ACTRA_ENABLE_HOSTED_SHADOW_WRITE_FALLBACK must stay disabled.");
  }
  if (String(baseUrl).includes("localhost")) {
    warnings.push(
      "ACTRA_AUTH_PUBLIC_BASE_URL points to localhost. This is acceptable for a Docker verification run, but not a final public-domain launch proof."
    );
  }
  if (smtpHost === "mailpit") {
    warnings.push(
      "Using the local Mailpit SMTP sink. This is acceptable for local launch acceptance, but not a final public SMTP proof."
    );
  }

  return { errors, warnings };
}

function runCommand(command, args, { env, stdio = "inherit", allowFailure = false } = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio,
  });
  if (result.error) {
    throw result.error;
  }
  if (!allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
  return result;
}

function runNpmScript(scriptName, env) {
  if (process.platform === "win32") {
    return runCommand(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `npm run ${scriptName}`],
      { env, stdio: "inherit" }
    );
  }
  return runCommand("npm", ["run", scriptName], {
    env,
    stdio: "inherit",
  });
}

function dockerCompose(args, runtimeEnv, options = {}) {
  return runCommand("docker", ["compose", "-f", DOCKER_COMPOSE_FILE, ...args], {
    env: runtimeEnv,
    ...options,
  });
}

function buildCookieHeader(cookieJar) {
  const pairs = [];
  for (const [name, value] of cookieJar.entries()) {
    pairs.push(`${name}=${value}`);
  }
  return pairs.join("; ");
}

function updateCookieJar(cookieJar, setCookieHeader) {
  if (!setCookieHeader) {
    return;
  }
  const firstCookie = String(setCookieHeader).split(",")[0];
  const [pair] = firstCookie.split(";");
  const separatorIndex = pair.indexOf("=");
  if (separatorIndex <= 0) {
    return;
  }
  const name = pair.slice(0, separatorIndex).trim();
  const value = pair.slice(separatorIndex + 1).trim();
  if (!name) {
    return;
  }
  cookieJar.set(name, value);
}

async function request(baseUrl, pathName, { method = "GET", body, cookieJar, expectJson = true } = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch is unavailable. Run this script on Node.js 18+.");
  }

  const headers = { Accept: expectJson ? "application/json" : "*/*" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (cookieJar && cookieJar.size > 0) {
    headers.Cookie = buildCookieHeader(cookieJar);
  }

  const response = await fetch(new URL(pathName, baseUrl), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });

  if (cookieJar) {
    updateCookieJar(cookieJar, response.headers.get("set-cookie"));
  }

  let payload = null;
  if (expectJson) {
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
  } else {
    payload = await response.text();
  }

  return { response, payload };
}

async function waitForReady(baseUrl) {
  const deadline = Date.now() + 180000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const health = await request(baseUrl, "/api/health");
      const healthPayload = health.payload || {};
      if (health.response.ok && healthPayload.runtime_mode === "hosted_web") {
        const ready = await request(baseUrl, "/api/ready");
        if (ready.response.ok) {
          return ready.payload || {};
        }
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(2000);
  }

  throw new Error(
    `Timed out waiting for hosted stack readiness.${lastError ? ` Last error: ${lastError.message}` : ""}`
  );
}

function assertCondition(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runAuthLifecycle(baseUrl) {
  const cookieJar = new Map();
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const login = `launch.reader.${suffix}`;
  const email = `launch.reader.${suffix}@example.test`;
  const password = `StrongPass!${suffix}`;

  const unauthMain = await request(baseUrl, "/main", {
    cookieJar,
    expectJson: false,
  });
  assertCondition(
    unauthMain.response.status === 302,
    "Expected /main to redirect to /welcome before authentication."
  );
  const redirectTarget = String(unauthMain.response.headers.get("location") || "");
  assertCondition(
    redirectTarget.includes("/welcome") || redirectTarget === "/" || redirectTarget.endsWith("/"),
    `Expected /main redirect target to contain /welcome or be /, got: ${redirectTarget}`
  );

  const register = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    cookieJar,
    body: {
      name: `Launch Reader ${suffix}`,
      login,
      email,
      password,
    },
  });
  assertCondition(register.response.status === 201, "Hosted register request did not return 201.");
  assertCondition(register.payload && register.payload.ok === true, "Hosted register request did not succeed.");
  assertCondition(
    register.payload?.verification_email?.sent === true,
    "Hosted register request did not send a verification email."
  );
  const verifyUrl = String(register.payload?.verification_email?.verify_url || "").trim();
  assertCondition(verifyUrl, "Hosted register response did not include verify_url.");
  const verifyToken = new URL(verifyUrl).searchParams.get("verify_email_token");
  assertCondition(verifyToken, "Unable to extract verify_email_token from verify_url.");

  const verify = await request(
    baseUrl,
    `/api/auth/verify-email?token=${encodeURIComponent(String(verifyToken))}`,
    { cookieJar }
  );
  assertCondition(verify.response.ok, "Hosted email verification request failed.");
  assertCondition(verify.payload?.verified === true, "Hosted email verification did not mark the account as verified.");

  const meAfterVerify = await request(baseUrl, "/api/auth/me", { cookieJar });
  assertCondition(meAfterVerify.payload?.authenticated === true, "Hosted session is missing after email verification.");

  const mainAfterVerify = await request(baseUrl, "/main", {
    cookieJar,
    expectJson: false,
  });
  assertCondition(
    mainAfterVerify.response.status === 200,
    "Expected /main to render successfully after authentication."
  );

  const resend = await request(baseUrl, "/api/auth/resend-verification", {
    method: "POST",
    cookieJar,
    body: {},
  });
  assertCondition(resend.response.ok, "Hosted resend-verification request failed.");
  assertCondition(
    resend.payload?.already_verified === true ||
      resend.payload?.verification_email?.reason === "already_verified",
    "Expected resend-verification to report already_verified after email confirmation."
  );

  const forgotPassword = await request(baseUrl, "/api/auth/forgot-password", {
    method: "POST",
    cookieJar,
    body: { identifier: email },
  });
  assertCondition(forgotPassword.response.ok, "Hosted forgot-password request failed.");
  assertCondition(
    forgotPassword.payload?.requested === true,
    "Hosted forgot-password request did not return the concealed success payload."
  );

  const logout = await request(baseUrl, "/api/auth/logout", {
    method: "POST",
    cookieJar,
    body: {},
  });
  assertCondition(logout.response.ok, "Hosted logout request failed.");

  const loginResponse = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    cookieJar,
    body: {
      identifier: login,
      password,
    },
  });
  assertCondition(loginResponse.response.ok, "Hosted login request failed.");
  assertCondition(loginResponse.payload?.ok === true, "Hosted login request did not succeed.");

  const meAfterLogin = await request(baseUrl, "/api/auth/me", { cookieJar });
  assertCondition(meAfterLogin.payload?.authenticated === true, "Hosted login did not restore the auth session.");

  return {
    login,
    email,
    verifyUrl,
  };
}

async function main() {
  const runtimeEnv = buildRuntimeEnv();
  const args = parseArgs(process.argv);
  const baseUrl = String(runtimeEnv.ACTRA_AUTH_PUBLIC_BASE_URL || "").trim();
  const { errors, warnings } = validateLaunchEnv(runtimeEnv, baseUrl);

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`[launch-acceptance] Warning: ${warning}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  if (args.dryRun) {
    console.log(
      [
        "[launch-acceptance] Dry run only.",
        `Base URL: ${baseUrl}`,
        `Companion passage gate: ${args.skipCompanionPassage ? "skipped" : "npm run smoke:complex-passage:hosted:infra"}`,
        "Docker compose stack: docker-compose.hosted.yml",
        "Live checks:",
        "  - /api/health and /api/ready.launch_contract",
        "  - hosted register -> verify email -> me -> logout -> login",
        "  - hosted forgot-password request",
        "  - /main redirect before auth and render after auth",
      ].join("\n")
    );
    return;
  }

  ensureDockerAvailable(runtimeEnv);

  if (!args.skipCompanionPassage) {
    console.log("[launch-acceptance] Running companion passage infra gate...");
    runNpmScript("smoke:complex-passage:hosted:infra", runtimeEnv);
  }

  let stackStarted = false;
  try {
    console.log("[launch-acceptance] Starting hosted docker compose stack...");
    dockerCompose(["up", "--build", "-d"], runtimeEnv);
    stackStarted = true;

    console.log("[launch-acceptance] Waiting for /api/ready...");
    const readyPayload = await waitForReady(baseUrl);
    const launchContract = readyPayload.launch_contract || {};
    assertCondition(
      launchContract.runtime_ready === true,
      "Launch contract is not runtime_ready on the live hosted stack."
    );
    assertCondition(
      launchContract.status === "green",
      "Launch contract status is not green on the live hosted stack."
    );

    console.log("[launch-acceptance] Running live hosted auth lifecycle...");
    const authResult = await runAuthLifecycle(baseUrl);

    console.log(
      [
        "[launch-acceptance] Hosted launch acceptance completed.",
        `Verified login: ${authResult.login}`,
        `Verified email: ${authResult.email}`,
        "Manual follow-up still recommended for:",
        "  - real inbox delivery/open of verify and reset-password emails",
        "  - reverse proxy / HTTPS termination",
        "  - backup / restore drill",
      ].join("\n")
    );
  } finally {
    if (stackStarted && !args.keepStack) {
      console.log("[launch-acceptance] Stopping hosted docker compose stack...");
      dockerCompose(["down"], runtimeEnv, { allowFailure: true });
    }
  }
}

main().catch((error) => {
  console.error(`[launch-acceptance] ${error && error.message ? error.message : error}`);
  process.exit(1);
});
