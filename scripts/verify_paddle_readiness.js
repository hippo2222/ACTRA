const REQUIRED_PUBLIC_PATHS = [
  "/",
  "/pricing",
  "/refund",
  "/terms",
  "/privacy",
  "/legal/terms",
  "/legal/privacy",
  "/robots.txt",
  "/sitemap.xml",
  "/ui/welcome",
];

const TEXT_PATHS_WITHOUT_LOCALHOST = [
  "/",
  "/pricing",
  "/refund",
  "/terms",
  "/privacy",
  "/robots.txt",
  "/sitemap.xml",
  "/ui/welcome",
];

function normalizeBaseUrl(raw) {
  const value = String(raw || "https://actra.site").trim();
  if (!value) return new URL("https://actra.site");
  const parsed = new URL(value);
  parsed.pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function isLocalHost(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(String(hostname || "").toLowerCase());
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function fetchResponse(baseUrl, path, options = {}) {
  const url = new URL(path, baseUrl);
  const response = await fetch(url, {
    redirect: options.redirect || "follow",
    headers: { Accept: options.accept || "*/*" },
  });
  return { url, response };
}

async function fetchText(baseUrl, path) {
  const { url, response } = await fetchResponse(baseUrl, path, {
    accept: "text/html,text/plain,application/xml,*/*",
  });
  const text = await response.text();
  return { url, response, text };
}

async function fetchJson(baseUrl, path) {
  const { url, response } = await fetchResponse(baseUrl, path, {
    accept: "application/json",
  });
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(`${url.href} did not return valid JSON: ${error.message}`);
  }
  return { url, response, data };
}

function assertStatusOk(url, response) {
  assert(response.status === 200, `${url.href} returned ${response.status}, expected 200`);
}

function assertContains(text, needle, label) {
  assert(text.includes(needle), `${label} is missing ${needle}`);
}

async function checkHttpsAndRedirect(baseUrl) {
  if (isLocalHost(baseUrl.hostname)) {
    return;
  }

  assert(baseUrl.protocol === "https:", `BASE_URL must use HTTPS for public verification: ${baseUrl.href}`);

  const httpUrl = new URL(baseUrl.href);
  httpUrl.protocol = "http:";
  httpUrl.pathname = "/";
  const response = await fetch(httpUrl, { redirect: "manual" });
  const location = response.headers.get("location") || "";
  assert(
    response.status >= 300 && response.status < 400,
    `${httpUrl.href} must redirect to HTTPS, got status ${response.status}`
  );
  assert(
    location.startsWith(`https://${baseUrl.host}/`) || location === `https://${baseUrl.host}`,
    `${httpUrl.href} redirects to unexpected location: ${location || "<empty>"}`
  );
}

async function checkPublicPages(baseUrl) {
  const cache = new Map();
  for (const path of REQUIRED_PUBLIC_PATHS) {
    const result = await fetchText(baseUrl, path);
    assertStatusOk(result.url, result.response);
    cache.set(path, result.text);
  }

  for (const path of TEXT_PATHS_WITHOUT_LOCALHOST) {
    const text = cache.get(path) || "";
    assert(!/localhost:?\d*/i.test(text), `${path} contains localhost`);
  }

  const root = cache.get("/") || "";
  assertContains(root, "ACTRA", "/");
  assertContains(root, "What ACTRA does", "/");
  assertContains(root, "$4.99", "/");
  assertContains(root, "$7.99", "/");
  assertContains(root, "$19.99", "/");
  assertContains(root, "ACTRA Premium is a digital service", "/");

  const pricing = cache.get("/pricing") || "";
  assertContains(pricing, "$4.99", "/pricing");
  assertContains(pricing, "$7.99", "/pricing");
  assertContains(pricing, "$19.99", "/pricing");
  assertContains(pricing, "No physical goods are sold or shipped", "/pricing");

  const refund = cache.get("/refund") || "";
  assertContains(refund, "Refund Policy", "/refund");
  assertContains(refund, "14 days", "/refund");
  assertContains(refund, "actrafb@proton.me", "/refund");

  const robots = cache.get("/robots.txt") || "";
  assertContains(robots, "User-agent: *", "/robots.txt");
  assertContains(robots, "Sitemap:", "/robots.txt");

  const sitemap = cache.get("/sitemap.xml") || "";
  assertContains(sitemap, "<loc>https://actra.site/</loc>", "/sitemap.xml");
  assertContains(sitemap, "<loc>https://actra.site/pricing</loc>", "/sitemap.xml");
  assertContains(sitemap, "<loc>https://actra.site/refund</loc>", "/sitemap.xml");

  const welcome = cache.get("/ui/welcome") || "";
  assert(!welcome.includes("heroGradient.js"), "/ui/welcome still references removed heroGradient.js");
  assertContains(welcome, "onboardingAcceptRefund", "/ui/welcome");
  assertContains(welcome, "selectAcceptRefund", "/ui/welcome");
  assertContains(welcome, "consentGateAcceptRefund", "/ui/welcome");
}

async function checkLegalApi(baseUrl) {
  const current = await fetchJson(baseUrl, "/api/legal/current");
  assertStatusOk(current.url, current.response);
  const documents = current.data && current.data.documents;
  assert(current.data && current.data.ok === true, "/api/legal/current returned ok=false");
  assert(documents && documents.terms && documents.privacy && documents.refund, "/api/legal/current must include terms, privacy, and refund");
  assert(documents.refund.version === "2026-05-25.1", `/api/legal/current refund version is ${documents.refund.version || "<empty>"}`);

  const refundDocument = await fetchJson(baseUrl, "/api/legal/document/refund");
  assertStatusOk(refundDocument.url, refundDocument.response);
  const document = refundDocument.data && refundDocument.data.document;
  assert(refundDocument.data && refundDocument.data.ok === true, "/api/legal/document/refund returned ok=false");
  assert(document && document.version === "2026-05-25.1", "/api/legal/document/refund has unexpected version");
  assert(String(document.content || "").includes("ACTRA Refund Policy"), "/api/legal/document/refund is missing refund policy content");
}

async function main() {
  const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
  await checkHttpsAndRedirect(baseUrl);
  await checkPublicPages(baseUrl);
  await checkLegalApi(baseUrl);
  console.log(`Paddle readiness verification passed for ${baseUrl.href}`);
}

main().catch((error) => {
  console.error(`Paddle readiness verification failed: ${error.message}`);
  process.exitCode = 1;
});
