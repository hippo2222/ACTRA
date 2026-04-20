import path from "node:path";

const runtimeContextByBaseUrl = new Map();

function normalizeBaseUrl(baseUrl) {
  const url = new URL(String(baseUrl || ""));
  const normalized = new URL("/", url).toString();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function slugifyRunId(runId = "") {
  return (
    String(runId || "cpw")
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "_")
      .replace(/^[_-]+|[_-]+$/g, "")
      .slice(0, 24)
      .replace(/^[_-]+|[_-]+$/g, "")
  ) || "cpw";
}

function readSetCookieHeader(headers) {
  if (!headers) {
    return "";
  }
  if (typeof headers.getSetCookie === "function") {
    const values = headers.getSetCookie();
    if (Array.isArray(values) && values.length > 0) {
      return String(values[0] || "");
    }
  }
  return String(headers.get?.("set-cookie") || "");
}

function parseCookiePair(rawSetCookie) {
  const firstSegment = String(rawSetCookie || "").split(";")[0] || "";
  const separatorIndex = firstSegment.indexOf("=");
  if (separatorIndex <= 0) {
    return null;
  }
  const name = firstSegment.slice(0, separatorIndex).trim();
  const value = firstSegment.slice(separatorIndex + 1).trim();
  if (!name || !value) {
    return null;
  }
  return { name, value };
}

function buildHostedAuditIdentity(runId, overrides = {}) {
  const slug = slugifyRunId(runId);
  const login = String(overrides.login || `cpw.${slug}`).trim();
  const email = String(overrides.email || `${login}@actra.local`).trim();
  const password = String(overrides.password || `Cpw.${slug}.Pass1!`).trim();
  const name = String(overrides.name || `CPW ${slug}`).trim();
  return {
    slug,
    login,
    email,
    password,
    name,
    identifier: login,
  };
}

export function registerRuntimeContext(baseUrl, context = {}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const current = runtimeContextByBaseUrl.get(normalizedBaseUrl) || {};
  const next = {
    ...current,
    ...context,
    baseUrl: normalizedBaseUrl,
  };
  runtimeContextByBaseUrl.set(normalizedBaseUrl, next);
  return next;
}

export function getRuntimeContext(baseUrl) {
  return runtimeContextByBaseUrl.get(normalizeBaseUrl(baseUrl)) || null;
}

export function unregisterRuntimeContext(baseUrl) {
  runtimeContextByBaseUrl.delete(normalizeBaseUrl(baseUrl));
}

export function maybeAttachAuthHeaders(baseUrl, headers = {}) {
  const runtimeContext = getRuntimeContext(baseUrl);
  if (!runtimeContext?.apiCookieHeader) {
    return { ...headers };
  }

  return {
    ...headers,
    Cookie: headers.Cookie || headers.cookie || runtimeContext.apiCookieHeader,
  };
}

export async function bootstrapHostedAuthSession(baseUrl, runId, overrides = {}) {
  const identity = buildHostedAuditIdentity(runId, overrides);
  const registerResponse = await fetch(new URL("/api/auth/register", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: identity.name,
      login: identity.login,
      email: identity.email,
      password: identity.password,
      avatar_seed: "1.png",
    }),
  });

  let registerPayload = null;
  try {
    registerPayload = await registerResponse.json();
  } catch (_) {
    registerPayload = null;
  }

  let rawSetCookie = readSetCookieHeader(registerResponse.headers);

  if (!registerResponse.ok || !rawSetCookie) {
    const loginResponse = await fetch(new URL("/api/auth/login", baseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        identifier: identity.identifier,
        password: identity.password,
      }),
    });

    let loginPayload = null;
    try {
      loginPayload = await loginResponse.json();
    } catch (_) {
      loginPayload = null;
    }

    rawSetCookie = readSetCookieHeader(loginResponse.headers);
    if (!loginResponse.ok || !rawSetCookie) {
      const details = loginPayload || registerPayload || {};
      throw new Error(
        `hosted_auth_bootstrap_failed:${loginResponse.status}:${JSON.stringify(details)}`
      );
    }

    const loginCookie = parseCookiePair(rawSetCookie);
    if (!loginCookie) {
      throw new Error("hosted_auth_cookie_missing");
    }

    const cookieHeader = `${loginCookie.name}=${loginCookie.value}`;
    return {
      identity,
      user: loginPayload?.user || null,
      apiCookieHeader: cookieHeader,
      browserCookie: {
        name: loginCookie.name,
        value: loginCookie.value,
        url: new URL("/", baseUrl).toString(),
      },
    };
  }

  const registerCookie = parseCookiePair(rawSetCookie);
  if (!registerCookie) {
    throw new Error("hosted_auth_cookie_missing");
  }

  const cookieHeader = `${registerCookie.name}=${registerCookie.value}`;
  return {
    identity,
    user: registerPayload?.user || null,
    apiCookieHeader: cookieHeader,
    browserCookie: {
      name: registerCookie.name,
      value: registerCookie.value,
      url: new URL("/", baseUrl).toString(),
    },
  };
}

export async function ensureHostedBrowserAuth(page, baseUrl) {
  const runtimeContext = getRuntimeContext(baseUrl);
  if (!runtimeContext?.browserCookie) {
    return false;
  }

  await page.context().addCookies([runtimeContext.browserCookie]);
  return true;
}

export function translateRuntimePathForApp(baseUrl, hostPath) {
  const runtimeContext = getRuntimeContext(baseUrl);
  const hostDataDir = String(runtimeContext?.hostDataDir || "").trim();
  const appDataDir = String(runtimeContext?.appDataDir || "").trim();
  if (!hostDataDir || !appDataDir) {
    return String(hostPath || "");
  }

  const resolvedHostPath = path.resolve(String(hostPath || ""));
  const resolvedHostDataDir = path.resolve(hostDataDir);
  const relativePath = path.relative(resolvedHostDataDir, resolvedHostPath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return resolvedHostPath;
  }

  const posixRelative = relativePath.split(path.sep).join(path.posix.sep);
  return path.posix.join(appDataDir.replace(/\\/g, "/"), posixRelative);
}
