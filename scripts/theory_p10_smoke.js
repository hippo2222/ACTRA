const { chromium } = require("playwright");

function parseArgs(argv = process.argv.slice(2)) {
  const out = { baseUrl: "http://127.0.0.1:8000" };
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
      continue;
    }
    if (token === "--headless" && argv[i + 1]) {
      const raw = String(argv[i + 1]).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      i += 1;
      continue;
    }
    if (token.startsWith("--headless=")) {
      const raw = token.slice("--headless=".length).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
    }
  }
  return out;
}

async function bootstrapTheoryMode(page, baseUrl) {
  const url = new URL("/ui/editor", baseUrl).toString();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  await page.waitForFunction(
    () => !!(window.dashboard && window.dashboard.importManager),
    { timeout: 30000 }
  );

  const boot = await page.evaluate(async () => {
    const im = window.dashboard && window.dashboard.importManager;
    if (!im) return { ok: false, error: "import_manager_missing" };
    im.aiCheckStatus = async function () {
      this.aiStatus = { ai_available: true };
      return { ok: true, ai_available: true };
    };
    im.loadTheoryAnalysisRuns = async function () {
      this.theoryRuns = [];
      this.theoryRunsLoading = false;
      this.theoryRunsError = "";
      return { ok: true, items: [] };
    };
    if (window.dashboard && typeof window.dashboard.showTheoryAnalysisModal === "function") {
      window.dashboard.showTheoryAnalysisModal();
    }
    for (const el of Array.from(document.body.children)) {
      if (el && el.id !== "import-modal") {
        el.style.display = "none";
      }
    }
    return { ok: true };
  });
  if (!boot || boot.ok === false) {
    throw new Error(`bootstrap failed: ${boot && boot.error ? boot.error : "unknown"}`);
  }

  await page.waitForFunction(
    () => {
      const m = document.getElementById("import-modal");
      const im = window.dashboard && window.dashboard.importManager;
      return !!(m && !m.classList.contains("hidden") && im && im.modalPurpose === "theory_analysis");
    },
    { timeout: 30000 }
  );
}

async function injectFallbackFixture(page) {
  const result = await page.evaluate(() => {
    const im = window.dashboard && window.dashboard.importManager;
    if (!im) return { ok: false, error: "import_manager_missing" };

    const units = Array.from({ length: 8 }, (_, i) => ({
      id: i + 1,
      title: `Unit ${i + 1}`,
      type: ["concept", "process", "fact", "term"][i % 4],
      description: `Fixture unit ${i + 1}`,
    }));

    const typeProgression = [
      {
        task_type: "SEQUENCE",
        availability: "implemented",
        progression_is_fixed: true,
        complex_role: "core",
        suitability: "high",
        priority: "high",
        why: "Primary structuring progression.",
        level_role_map: [
          { level: 1, role: "Structure assembly", value_for_material: "Builds the base structure." },
          { level: 2, role: "Label levels", value_for_material: "Adds explicit naming." },
          { level: 3, role: "Label levels and blocks", value_for_material: "Shows full hierarchy." },
        ],
        iterative_system_notes: [
          "Levels are shown as roles inside the progression, not a separate manual pick.",
        ],
        sequence_intents: ["classification"],
      },
      {
        task_type: "TEST",
        availability: "implemented",
        progression_is_fixed: true,
        complex_role: "core",
        suitability: "high",
        priority: "high",
        why: "Recognition + recall progression.",
        level_role_map: [
          { level: 1, role: "Recognition", value_for_material: "Checks objective recognition." },
          { level: 2, role: "Recall", value_for_material: "Checks answer retrieval." },
        ],
        iterative_system_notes: [
          "Use the full fixed progression in complexes.",
        ],
      },
    ];

    im.analysisResult = {
      ok: true,
      ai_run_id: "p10_smoke_fallback",
      analysis_created_at: "2026-02-26T12:00:00Z",
      material_language: "ru",
      target_language: "ru",
      effective_output_language: "ru",
      analysis_schema_version: "2.0",
      report_blocks_version: "1.0",
      provider_used: "fixture",
      provider_model: "p10-smoke",
      human_summary: "Fallback smoke fixture for P10 fixed progressions.",
      warnings: ["Smoke warning"],
      educational_units: units,
      learning_chunks: [
        { id: "chunk_1", title: "Chunk 1", chunk_type: "classification", unit_ids: [1, 2, 3, 4] },
        { id: "chunk_2", title: "Chunk 2", chunk_type: "process", unit_ids: [5, 6, 7, 8] },
      ],
      recommendations: [
        { task_type: "SEQUENCE", count: 3, priority: "high", rationale: "Structuring", covers_units: [1, 2, 3] },
        { task_type: "TEST", count: 4, priority: "high", rationale: "Recall", covers_units: [4, 5, 6] },
      ],
      not_recommended: [],
      type_progression_suitability: typeProgression,
      authoring_routes: [],
      future_capabilities: [],
      microcards_candidates: [],
      report_blocks: [],
      report_lint: { verbosity_risk: "low", duplicate_content_signals: 0, fallback_renderer_recommended: false },
    };
    im.aiRunId = im.analysisResult.ai_run_id;
    im.aiAnalyzing = false;
    im.theoryReportPanelOpen = true;
    im.skipTheoryViewStateCaptureOnce = true;
    im.renderTheoryAnalysisMode();
    return { ok: true };
  });

  if (!result || result.ok === false) {
    throw new Error(`fallback fixture failed: ${result && result.error ? result.error : "unknown"}`);
  }
}

async function assertFallbackP10(page) {
  await page.waitForSelector("[data-role='theory-analysis-report-body']", { timeout: 20000 });
  await page.waitForFunction(
    () => {
      const body = document.querySelector("[data-role='theory-analysis-report-body']");
      if (!body) return false;
      const text = (body.innerText || body.textContent || "").toLowerCase();
      return text.includes("fixed progression") && text.includes("progression");
    },
    { timeout: 20000 }
  );

  const checks = await page.evaluate(() => {
    const body = document.querySelector("[data-role='theory-analysis-report-body']");
    const text = (body && (body.innerText || body.textContent || "")) || "";
    return {
      hasBody: !!body,
      hasFallbackNote: text.toLowerCase().includes("fallback renderer"),
      hasFixedProgressionText: text.toLowerCase().includes("fixed progression"),
      hasProgressionLevelsLabel: text.toLowerCase().includes("уровни в progression"),
    };
  });

  if (!checks.hasBody || !checks.hasFixedProgressionText || !checks.hasProgressionLevelsLabel) {
    throw new Error(`fallback assertions failed: ${JSON.stringify(checks)}`);
  }
  return checks;
}

async function injectStructuredFixture(page) {
  const result = await page.evaluate(() => {
    const im = window.dashboard && window.dashboard.importManager;
    if (!im || !im.analysisResult) return { ok: false, error: "analysis_missing" };
    const a = im.analysisResult;
    a.report_lint = { verbosity_risk: "low", duplicate_content_signals: 0, fallback_renderer_recommended: false };
    a.type_progression_suitability = (Array.isArray(a.type_progression_suitability) ? a.type_progression_suitability : []).map((e) => ({
      ...e,
      progression_is_fixed: e.progression_is_fixed !== false,
      iterative_system_notes: Array.isArray(e.iterative_system_notes) && e.iterative_system_notes.length
        ? e.iterative_system_notes
        : ["Fixed progression in complexes."],
      level_role_map: Array.isArray(e.level_role_map) && e.level_role_map.length
        ? e.level_role_map
        : [{ level: 1, role: "Role", value_for_material: "Value" }],
    }));
    a.report_blocks = [
      {
        id: "toc_1",
        type: "toc",
        title: "TOC",
        body: { items: [{ label: "Types", anchor: "types-progressions" }] },
      },
      {
        id: "sec_1",
        type: "section",
        title: "Progressions Section",
        anchor: "types-progressions",
        collapsible: true,
        body: { summary: "Structured smoke fixture for P10." },
      },
      {
        id: "pm_1",
        type: "progression_matrix",
        title: "Progression matrix",
        anchor: "progression-matrix",
        body: {
          rows: [
            { task_type: "SEQUENCE", suitability: "high", show_level_roles: true, show_iterative_notes: true },
            { task_type: "TEST", suitability: "high", show_level_roles: true, show_iterative_notes: true },
          ],
        },
      },
    ];
    im.theoryReportPanelOpen = true;
    im.skipTheoryViewStateCaptureOnce = true;
    im.renderTheoryAnalysisMode();
    return { ok: true };
  });

  if (!result || result.ok === false) {
    throw new Error(`structured fixture failed: ${result && result.error ? result.error : "unknown"}`);
  }
}

async function assertStructuredP10(page) {
  await page.waitForFunction(
    () => {
      const body = document.querySelector("[data-role='theory-analysis-report-body']");
      if (!body) return false;
      const text = (body.innerText || body.textContent || "").toLowerCase();
      const hasTable = body.querySelectorAll("table").length > 0;
      const hasHeader = Array.from(body.querySelectorAll("th")).some((th) =>
        ((th.innerText || th.textContent || "").toLowerCase()).includes("progression")
      );
      return hasTable && hasHeader && text.includes("fixed progression");
    },
    { timeout: 20000 }
  );

  const checks = await page.evaluate(() => {
    const body = document.querySelector("[data-role='theory-analysis-report-body']");
    const ths = body ? Array.from(body.querySelectorAll("th")).map((th) => (th.innerText || th.textContent || "").trim()) : [];
    const text = body ? (body.innerText || body.textContent || "") : "";
    const lower = text.toLowerCase();
    return {
      hasBody: !!body,
      headerCount: ths.length,
      ths,
      hasP10Section: lower.includes("типы как progression") || lower.includes("типы как progressions"),
      hasMatrixHeader: ths.some((v) => v.toLowerCase().includes("progression")),
      hasFixedProgression: lower.includes("fixed progression"),
    };
  });

  if (!checks.hasBody || !checks.hasMatrixHeader || !checks.hasFixedProgression || !checks.hasP10Section) {
    throw new Error(`structured assertions failed: ${JSON.stringify(checks)}`);
  }
  return checks;
}

async function assertMinimalAnimations(page) {
  const checks = await page.evaluate(() => {
    const im = window.dashboard && window.dashboard.importManager;
    const methodsOk = !!(
      im &&
      typeof im.prefersReducedMotion === "function" &&
      typeof im.toggleTheoryReportBlockCollapse === "function" &&
      typeof im.scrollTheoryReportToAnchor === "function"
    );

    const blockToggleIcon = document.querySelector("[data-role='theory-report-block-toggle-icon']");
    const blockContent = document.querySelector("[data-role='theory-report-block-content']");
    const reportToggleBtn = document.querySelector("[data-role='theory-report-toggle-btn']");
    const panelBody = document.querySelector("[data-role='theory-analysis-report-body']");

    const iconClasses = blockToggleIcon ? Array.from(blockToggleIcon.classList) : [];
    const contentClasses = blockContent ? Array.from(blockContent.classList) : [];
    const btnClasses = reportToggleBtn ? Array.from(reportToggleBtn.classList) : [];

    return {
      methodsOk,
      hasPanelBody: !!panelBody,
      hasBlockToggleIcon: !!blockToggleIcon,
      hasBlockContent: !!blockContent,
      hasReportToggleBtn: !!reportToggleBtn,
      iconHasTransitionTransform: iconClasses.includes("transition-transform"),
      contentHasTransitionOpacity: contentClasses.includes("transition-opacity"),
      contentHasTransitionTransform: contentClasses.includes("transition-transform"),
      reportToggleHasTransitionColors: btnClasses.includes("transition-colors"),
    };
  });

  const ok =
    checks.methodsOk &&
    checks.hasPanelBody &&
    checks.hasBlockToggleIcon &&
    checks.hasBlockContent &&
    checks.hasReportToggleBtn &&
    checks.iconHasTransitionTransform &&
    checks.contentHasTransitionOpacity &&
    checks.contentHasTransitionTransform &&
    checks.reportToggleHasTransitionColors;

  if (!ok) {
    throw new Error(`animation assertions failed: ${JSON.stringify(checks)}`);
  }
  return checks;
}

async function main() {
  const opts = parseArgs();
  const browser = await chromium.launch({ headless: opts.headless !== false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await bootstrapTheoryMode(page, opts.baseUrl);
    await injectFallbackFixture(page);
    const fallback = await assertFallbackP10(page);
    await injectStructuredFixture(page);
    const structured = await assertStructuredP10(page);
    const animations = await assertMinimalAnimations(page);

    console.log("[theory_p10_smoke] PASS");
    console.log(JSON.stringify({ fallback, structured, animations }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[theory_p10_smoke] FAIL:", err && err.message ? err.message : err);
  process.exit(1);
});
