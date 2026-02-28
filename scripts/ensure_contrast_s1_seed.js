const SEED_COMPLEX_ID = "contrast_audit_s1_seed";
const LEGACY_COMPLEX_IDS = ["contrast_tmp_s1_matrix"];

function parseCliArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--base-url" && argv[i + 1]) {
      out.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--base-url=")) {
      out.baseUrl = token.slice("--base-url=".length);
    }
  }
  return out;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
    throw new Error(`Request failed ${url}: ${msg}`);
  }
  return payload;
}

function sameTaskRefs(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i]) !== String(b[i])) return false;
  }
  return true;
}

async function deleteComplexIfExists(baseUrl, complexId) {
  const complexes = await fetchJson(new URL("/api/complexes", baseUrl), { method: "GET" });
  const items = Array.isArray(complexes && complexes.items) ? complexes.items : [];
  const exists = items.some((item) => item && (item.id || item.complex_id) === complexId);
  if (!exists) return false;

  await fetchJson(
    new URL(`/api/complexes/${encodeURIComponent(complexId)}`, baseUrl),
    { method: "DELETE" }
  );
  return true;
}

async function main() {
  const cli = parseCliArgs();
  const baseUrl = new URL(cli.baseUrl || process.env.CONTRAST_AUDIT_BASE_URL || "http://127.0.0.1:8000");

  const taskCatalog = await fetchJson(new URL("/api/task-catalog", baseUrl), { method: "GET" });
  const items = Array.isArray(taskCatalog && taskCatalog.items) ? taskCatalog.items : [];
  const testRefs = items
    .filter((item) => item && item.task_type === "test" && typeof item.ref === "string")
    .slice(0, 2)
    .map((item) => item.ref);

  if (testRefs.length < 1) {
    throw new Error("No test tasks available in /api/task-catalog to build S1 contrast seed complex");
  }

  for (const legacyId of LEGACY_COMPLEX_IDS) {
    const deleted = await deleteComplexIfExists(baseUrl, legacyId);
    if (deleted) {
      console.log(`[ensure_contrast_s1_seed] deleted legacy complex: ${legacyId}`);
    }
  }

  const complexes = await fetchJson(new URL("/api/complexes", baseUrl), { method: "GET" });
  const complexItems = Array.isArray(complexes && complexes.items) ? complexes.items : [];
  const existing = complexItems.find(
    (item) => item && (item.id || item.complex_id) === SEED_COMPLEX_ID
  );

  if (existing && sameTaskRefs(existing.tasks || [], testRefs)) {
    console.log(
      `[ensure_contrast_s1_seed] seed complex already present: ${SEED_COMPLEX_ID} (tasks=${testRefs.length})`
    );
    return;
  }

  if (existing) {
    await fetchJson(
      new URL(`/api/complexes/${encodeURIComponent(SEED_COMPLEX_ID)}`, baseUrl),
      { method: "DELETE" }
    );
    console.log(`[ensure_contrast_s1_seed] replaced existing seed complex: ${SEED_COMPLEX_ID}`);
  }

  const payload = {
    id: SEED_COMPLEX_ID,
    name: "Contrast Audit S1 Seed",
    description: "Deterministic seed complex for S1 state matrix contrast audit.",
    tasks: testRefs,
    chains: [],
    settings: {},
  };

  await fetchJson(new URL("/api/complexes", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  console.log(
    `[ensure_contrast_s1_seed] ensured seed complex: ${SEED_COMPLEX_ID} (tasks=${testRefs.length})`
  );
}

main().catch((err) => {
  console.error("[ensure_contrast_s1_seed] failed:", err && err.message ? err.message : err);
  process.exit(1);
});
