/**
 * ACTRA Stage 5.4.1 — Dual-Height & Theme Matrix Audit Runner
 * Strict deterministic compliance with Rule 10 (Cold-Eye Visual Gate & UI Inspection Protocol)
 * Covers Editor and S1 Live Trainer in 1280x800 & 1280x720, Light ('light-a') & Dark ('dark-a') themes,
 * Micro-Crop Protocol, and 9 Headless Assertions.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/stage5_matrix");
const CROPS_DIR = path.join(OUT_DIR, "micro_crops");

[OUT_DIR, CROPS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const auditResults = {
  assertions: [],
  screenshots: [],
  microCrops: [],
  summary: { passed: 0, failed: 0 },
};

function recordAssertion(name, pass, details = "") {
  auditResults.assertions.push({ name, pass, details });
  if (pass) {
    auditResults.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? "— " + details : ""}`);
  } else {
    auditResults.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function setAppTheme(page, theme) {
  await page.evaluate((th) => {
    if (window.ThemeManager && typeof window.ThemeManager.setTheme === "function") {
      window.ThemeManager.setTheme(th);
    }
    document.documentElement.setAttribute("data-theme", th);
    if (th.startsWith("dark")) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, theme);
  await page.waitForTimeout(150);
}

async function assertZeroTruncation(page, selector, contextLabel) {
  const elements = await page.$$(selector);
  let truncatedCount = 0;
  const truncatedDetails = [];

  for (const el of elements) {
    const isTruncated = await el.evaluate((node) => {
      if (!node.offsetParent && node.offsetWidth === 0) return false;
      return node.scrollWidth > node.offsetWidth + 1;
    });
    if (isTruncated) {
      const text = (await el.textContent() || "").trim().slice(0, 40);
      truncatedDetails.push(text);
      truncatedCount++;
    }
  }

  recordAssertion(
    `Zero-Truncation [${contextLabel}] (${selector})`,
    truncatedCount === 0,
    truncatedCount === 0 ? "All items fit cleanly" : `Truncated: ${truncatedDetails.join(", ")}`
  );
}

async function assertNoAABBCollision(page, selectorA, selectorB, contextLabel) {
  const result = await page.evaluate(
    ({ selA, selB }) => {
      const elsA = Array.from(document.querySelectorAll(selA));
      const elsB = Array.from(document.querySelectorAll(selB));
      const collisions = [];

      for (let i = 0; i < elsA.length; i++) {
        const rA = elsA[i].getBoundingClientRect();
        if (rA.width === 0 || rA.height === 0) continue;

        for (let j = 0; j < elsB.length; j++) {
          if (elsA[i] === elsB[j]) continue;
          const rB = elsB[j].getBoundingClientRect();
          if (rB.width === 0 || rB.height === 0) continue;

          // Check AABB intersection
          const overlaps = !(
            rA.right <= rB.left ||
            rA.left >= rB.right ||
            rA.bottom <= rB.top ||
            rA.top >= rB.bottom
          );
          if (overlaps) {
            collisions.push({
              a: elsA[i].className.slice(0, 30),
              b: elsB[j].className.slice(0, 30),
              overlapBox: {
                x: Math.max(rA.left, rB.left),
                y: Math.max(rA.top, rB.top),
              },
            });
          }
        }
      }
      return collisions;
    },
    { selA: selectorA, selB: selectorB }
  );

  recordAssertion(
    `No-Overlap Collision [${contextLabel}] (${selectorA} vs ${selectorB})`,
    result.length === 0,
    result.length === 0 ? "Zero AABB overlaps" : `Found ${result.length} collisions`
  );
}

async function assertStackingContext(page, selector, contextLabel) {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { found: false, error: "not_found" };
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { found: false, error: "zero_size" };

    const points = [
      { x: rect.left + 5, y: rect.top + 5 },
      { x: rect.right - 5, y: rect.top + 5 },
      { x: rect.left + 5, y: rect.bottom - 5 },
      { x: rect.right - 5, y: rect.bottom - 5 },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    ];

    const unreached = [];
    for (const pt of points) {
      const topEl = document.elementFromPoint(pt.x, pt.y);
      if (!topEl || (!el.contains(topEl) && topEl !== el)) {
        unreached.push({ pt, topEl: topEl ? topEl.className.slice(0, 30) : "null" });
      }
    }
    return { found: true, unreached, rect };
  }, selector);

  const errorDetail = result.found
    ? (result.unreached.length === 0
        ? "Passed all 5 hit-tests"
        : `Occluded at ${result.unreached.length} points: ${JSON.stringify(result.unreached)} (rect: ${JSON.stringify(result.rect)})`)
    : result.error;

  recordAssertion(
    `Stacking Context Integrity [${contextLabel}] (${selector})`,
    result.found && result.unreached.length === 0,
    errorDetail
  );
}

async function captureMicroCrop(page, selector, outName, padding = 12) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) return null;

  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) return null;

  const cropPath = path.join(CROPS_DIR, outName);
  await page.screenshot({
    path: cropPath,
    clip: {
      x: Math.max(0, box.x - padding),
      y: Math.max(0, box.y - padding),
      width: box.width + padding * 2,
      height: box.height + padding * 2,
    },
  });
  auditResults.microCrops.push(cropPath);
  console.log(`    🔍 Micro-crop saved: ${cropPath}`);
  return cropPath;
}

async function runStage5MatrixAudit() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.4.1: Dual-Height & Theme Matrix Visual Audit");
  console.log("   ================================================================\n");

  const sessionInfoPath = path.resolve(process.cwd(), "tests/fixtures/clinical_fixtures/live_stand_session_info.json");
  if (!fs.existsSync(sessionInfoPath)) {
    throw new Error(`Session info not found at ${sessionInfoPath}. Run seed_and_verify_s1_stand.py first.`);
  }
  const sessionInfo = JSON.parse(fs.readFileSync(sessionInfoPath, "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Intercept UI settings to guarantee onboarding is disabled for the visual audit
  await context.route("**/api/ui/settings", async (route) => {
    try {
      const response = await route.fetch();
      const json = await response.json();
      json.onboarding = { disabled: true };
      await route.fulfill({ response, json });
    } catch (e) {
      await route.continue();
    }
  });

  // Disable onboarding tour overlays during headless visual audit
  await context.addInitScript(() => {
    try {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
      window.ACTRA_DISABLE_ONBOARDING_FIRST_RUN_PROMPT = true;
      localStorage.setItem("actra_onboarding_disabled_v1", "true");
      localStorage.setItem("actra_onboarding_seen_v1", JSON.stringify({ all: true }));
      localStorage.setItem("actra_onboarding_first_run_prompt_v1", "true");
    } catch (e) {}
  });

  // Auth login
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Auth: Login as Clinical Expert", loginResp.ok(), `Status ${loginResp.status()}`);

  const page = await context.newPage();

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
  const s1Url = sessionInfo.sessionUrl;

  try {
    // -------------------------------------------------------------------------
    // MATRIX 1: EDITOR (Table 5.1 ТЭЛА) — Light & Dark, 1280x800 & 1280x720
    // -------------------------------------------------------------------------
    console.log("\n📐 -------------------------------------------------------------");
    console.log("   Matrix 1: Sequence Assembly Editor (Table 5.1 ТЭЛА)");
    console.log("   -------------------------------------------------------------\n");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });
    await page.evaluate(() => {
      if (window.OnboardingTour && typeof window.OnboardingTour.finish === "function") {
        window.OnboardingTour.finish();
      }
      document.querySelectorAll(".onboarding-tour-scrim, .onboarding-tour-callout").forEach((el) => el.remove());
    });
    recordAssertion("Editor: Loaded in Hierarchy Mode", true, ".se-hierarchy-shell present");

    // Themes & Viewports for Editor
    const editorMatrix = [
      { theme: "light-a", vp: { width: 1280, height: 800 }, name: "editor_tela_1280x800_light.png" },
      { theme: "dark-a", vp: { width: 1280, height: 800 }, name: "editor_tela_1280x800_dark.png" },
      { theme: "light-a", vp: { width: 1280, height: 720 }, name: "editor_tela_1280x720_compact_light.png" },
      { theme: "dark-a", vp: { width: 1280, height: 720 }, name: "editor_tela_1280x720_compact_dark.png" },
    ];

    for (const item of editorMatrix) {
      await page.setViewportSize(item.vp);
      await setAppTheme(page, item.theme);
      await page.waitForTimeout(200);

      const shotPath = path.join(OUT_DIR, item.name);
      await page.screenshot({ path: shotPath });
      auditResults.screenshots.push(shotPath);
      console.log(`  📸 Screenshot saved: ${shotPath}`);

      // Headless Assertions on Editor in this state
      const ctxLabel = `Editor ${item.vp.height}p ${item.theme}`;
      await assertZeroTruncation(page, "#task-title-display, .se-tier-title-input, .se-node-item-input", ctxLabel);
      await assertNoAABBCollision(page, ".se-node-card", ".se-tier-cell", ctxLabel);

      // Viewport Fold Assertion (Rule 10: CTA, add buttons, and first data row must fit within window.innerHeight)
      const fold = await page.evaluate(() => {
        const toolbar = document.querySelector("#se-hierarchy-toolbar");
        const firstCard = document.querySelector(".se-node-card");
        const tRect = toolbar ? toolbar.getBoundingClientRect() : null;
        const cRect = firstCard ? firstCard.getBoundingClientRect() : null;
        return {
          toolbarBottom: tRect ? Math.round(tRect.bottom) : null,
          firstCardBottom: cRect ? Math.round(cRect.bottom) : null,
          windowHeight: window.innerHeight,
        };
      });
      const inFold =
        fold.toolbarBottom !== null &&
        fold.toolbarBottom <= fold.windowHeight &&
        fold.firstCardBottom !== null &&
        fold.firstCardBottom <= fold.windowHeight;
      recordAssertion(
        `Viewport Fold [${ctxLabel}]`,
        inFold,
        `Toolbar bottom=${fold.toolbarBottom}px, First card bottom=${fold.firstCardBottom}px <= ${fold.windowHeight}px`
      );
    }

    // Micro-Crops for Editor
    console.log("\n  🔍 Capturing Editor Micro-Crops...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await setAppTheme(page, "light-a");

    // 1. crop_editor_footer_boundary.png (bottom of first node card input)
    await captureMicroCrop(page, ".se-node-card", "crop_editor_footer_boundary.png", 8);

    // 2. crop_editor_inter_section_rhythm.png (junction between tier cell and node card)
    await captureMicroCrop(page, ".se-tier-cell", "crop_editor_inter_section_rhythm.png", 6);

    // 3. crop_editor_focus_ring.png (focus on node input)
    const nodeInput = page.locator(".se-node-item-input").first();
    await nodeInput.focus();
    await page.waitForTimeout(100);
    await captureMicroCrop(page, ".se-node-item-input", "crop_editor_focus_ring.png", 10);
    await page.evaluate(() => document.activeElement?.blur());

    // 4. Stacking Context on Editor Toolbar
    await assertStackingContext(page, "#se-hierarchy-toolbar", "Editor Toolbar");


    // -------------------------------------------------------------------------
    // MATRIX 2: S1 LIVE TRAINER (Table 5.1 ТЭЛА) — Light & Dark, 1280x800 & 1280x720
    // -------------------------------------------------------------------------
    console.log("\n📐 -------------------------------------------------------------");
    console.log("   Matrix 2: S1 Live Trainer (Table 5.1 ТЭЛА & Table 5.2 Пневмоторакс)");
    console.log("   -------------------------------------------------------------\n");

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });
    recordAssertion("S1 Trainer: Loaded Live Session", true, ".seqh-shell present");

    const s1Matrix = [
      { theme: "light-a", vp: { width: 1280, height: 800 }, name: "s1_tela_1280x800_light.png" },
      { theme: "dark-a", vp: { width: 1280, height: 800 }, name: "s1_tela_1280x800_dark.png" },
      { theme: "light-a", vp: { width: 1280, height: 720 }, name: "s1_tela_1280x720_compact_light.png" },
      { theme: "dark-a", vp: { width: 1280, height: 720 }, name: "s1_tela_1280x720_compact_dark.png" },
    ];

    for (const item of s1Matrix) {
      await page.setViewportSize(item.vp);
      await setAppTheme(page, item.theme);
      await page.waitForTimeout(200);

      const shotPath = path.join(OUT_DIR, item.name);
      await page.screenshot({ path: shotPath });
      auditResults.screenshots.push(shotPath);
      console.log(`  📸 Screenshot saved: ${shotPath}`);

      const ctxLabel = `S1 ${item.vp.height}p ${item.theme}`;
      await assertZeroTruncation(page, "#task-title, .seqh-tab__label, [data-sequenceui='available-item']", ctxLabel);
      await assertNoAABBCollision(page, ".seqh-node", ".seqh-tier", ctxLabel);

      // Primary CTA Reachability
      const ctaInView = await page.$eval("#check-answer-btn, #check-btn", (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom <= window.innerHeight && r.top >= 0;
      });
      recordAssertion(`Primary CTA In-View [${ctxLabel}]`, ctaInView, "Check button visible on fold");
    }

    // Micro-Crops for S1
    console.log("\n  🔍 Capturing S1 Micro-Crops...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await setAppTheme(page, "light-a");

    // 1. crop_s1_footer_boundary.png (bottom of available card)
    await captureMicroCrop(page, '[data-sequenceui="available-item"]', "crop_s1_footer_boundary.png", 8);

    // 2. crop_s1_inter_section_rhythm.png (swimlane junction)
    await captureMicroCrop(page, ".seqh-tiers", "crop_s1_inter_section_rhythm.png", 6);

    // 3. crop_s1_focus_ring.png (focus on check button or tab)
    const tabEl = page.locator(".seqh-tab").first();
    await tabEl.focus();
    await page.waitForTimeout(100);
    await captureMicroCrop(page, ".seqh-tab", "crop_s1_focus_ring.png", 10);
    await page.evaluate(() => document.activeElement?.blur());

    // 4. crop_s1_minimap_ghosting.png
    await captureMicroCrop(page, ".seqh-minimap", "crop_s1_minimap_ghosting.png", 10);

    // Stacking Context on S1 Minimap & Segmented Tabs
    await assertStackingContext(page, ".seqh-tabs", "S1 Segmented Tabs");


    // -------------------------------------------------------------------------
    // ADVANCE TO TASK 2 (Table 5.2 Пневмоторакс) & SCREENSHOT
    // -------------------------------------------------------------------------
    console.log("\n📐 -------------------------------------------------------------");
    console.log("   Matrix 3: S1 Live Trainer (Table 5.2 Пневмоторакс)");
    console.log("   -------------------------------------------------------------\n");

    const curTaskResp = await context.request.get(`${BASE_URL}/api/session/${sessionInfo.sessionId}/task`);
    const curTask = (await curTaskResp.json()).task;
    const curTaskId = curTask.task_id;
    const curTd = curTask.task_data;
    const ans = {
      display_mode: "hierarchy",
      levels: (curTd.levels || []).map((l) => ({ level_id: l.level_id, blocks: l.blocks || l.slots || [] })),
      nodes: (curTd.nodes || []).map((n) => ({
        node_id: n.node_id,
        level_id: n.level_id,
        parent_id: n.parent_id,
        blocks: n.blocks || n.slots || [],
      })),
    };
    await context.request.post(`${BASE_URL}/api/session/${sessionInfo.sessionId}/task/submit`, {
      data: { task_id: curTaskId, user_input: ans },
      headers: { Origin: BASE_URL },
    });
    await context.request.post(`${BASE_URL}/api/session/${sessionInfo.sessionId}/task/next`, {
      headers: { Origin: BASE_URL },
    });

    await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    for (const th of ["light-a", "dark-a"]) {
      await setAppTheme(page, th);
      await page.waitForTimeout(200);
      const shotPath = path.join(OUT_DIR, `s1_pneumo_1280x800_${th.replace("-a", "")}.png`);
      await page.screenshot({ path: shotPath });
      auditResults.screenshots.push(shotPath);
      console.log(`  📸 Screenshot saved: ${shotPath}`);

      await assertZeroTruncation(page, "#task-title, .seqh-tab__label, [data-sequenceui='available-item']", `S1 Pneumo ${th}`);
    }

    // Resilience Gate
    const criticalErrors = pageErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("404") && !e.includes("Failed to load resource")
    );
    recordAssertion(
      "Resilience Gate: Zero Unhandled JavaScript Runtime Errors",
      criticalErrors.length === 0,
      criticalErrors.length > 0 ? `Errors: ${criticalErrors.join("; ")}` : "Clean console"
    );

  } finally {
    await browser.close();
  }

  // Summary report
  console.log("\n================================================================");
  console.log(`   Stage 5.4.1 Matrix Audit: ${auditResults.summary.passed} Passed, ${auditResults.summary.failed} Failed`);
  console.log(`   Screenshots saved: ${auditResults.screenshots.length}`);
  console.log(`   Micro-crops saved: ${auditResults.microCrops.length}`);
  console.log("================================================================\n");

  if (auditResults.summary.failed > 0) {
    process.exit(1);
  }
}

runStage5MatrixAudit().catch((err) => {
  console.error("FATAL ERROR in runStage5MatrixAudit:", err);
  process.exit(1);
});
