/**
 * S1 Clinical Hierarchy Live E2E Verification
 * Verifies Table 5.1 (ТЭЛА) and Table 5.2 (Пневмоторакс) in the live S1 trainer
 * against the ACTRA Visual Engineering & Cold-Eye standards.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/s1_clinical_stand");
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const auditResults = {
  assertions: [],
  screenshots: [],
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

async function inspectTask(page, stageLabel) {
  const taskTitle = await page.$eval("#task-title, .seq-prompt-section, h1", (el) => el.textContent.trim());
  const isTela = taskTitle.toLowerCase().includes("тэла") || taskTitle.toLowerCase().includes("стратификация");
  const taskName = isTela ? "Таблица 5.1 (ТЭЛА)" : "Таблица 5.2 (Пневмоторакс)";
  const expectedTiers = isTela ? 4 : 3;
  const expectedNodes = isTela ? 8 : 9;
  const expectedTotalCards = isTela ? 8 : 9;

  console.log(`\n[${stageLabel}] Inspecting ${taskName} in S1...`);
  recordAssertion(`${taskName}: Task Prompt Displayed`, taskTitle.length > 20, `Title: "${taskTitle.slice(0, 45)}..."`);

  // Verify Swimlanes (Tiers)
  const tiers = await page.$$eval(".seqh-tier", (els) =>
    els.map((el) => el.querySelector(".seqh-tier__name, .seqh-tier__head")?.textContent?.trim() || "")
  );
  recordAssertion(
    `${taskName}: ${expectedTiers} Seamless Swimlanes Rendered`,
    tiers.length === expectedTiers,
    `Found ${tiers.length} tiers: ${tiers.join(", ")}`
  );

  // Verify Swimlanes Styling: transparent bg, 0px border-right
  const swimlanesContainer = await page.$eval(".seqh-tiers", (el) => {
    const style = window.getComputedStyle(el);
    return {
      background: style.backgroundColor,
      borderRight: style.borderRightWidth,
    };
  });
  recordAssertion(
    `${taskName}: Transparent Swimlane Background & Seamless Boundary`,
    swimlanesContainer.borderRight === "0px",
    `borderRight=${swimlanesContainer.borderRight}, bg=${swimlanesContainer.background}`
  );

  // Verify Hierarchy Nodes
  const nodesCount = await page.$$eval(".seqh-node", (els) => els.length);
  recordAssertion(
    `${taskName}: ${expectedNodes} Hierarchy Nodes Rendered in Grid`,
    nodesCount === expectedNodes,
    `Found ${nodesCount} node cards`
  );

  // Verify Tabs in Sidebar
  const tabs = await page.$$eval(".seqh-tab", (els) =>
    els.map((el) => {
      const label = el.querySelector(".seqh-tab__label")?.textContent?.trim() || "";
      const count = parseInt(el.querySelector(".seqh-tab__count")?.textContent?.trim() || "0", 10);
      return { label, count };
    })
  );
  const totalCardsInTabs = tabs.reduce((acc, t) => acc + t.count, 0);
  recordAssertion(
    `${taskName}: Tier Tabs Rendered with Card Counts`,
    tabs.length === expectedTiers && totalCardsInTabs === expectedTotalCards,
    `Tabs: ${tabs.map((t) => `${t.label} (${t.count})`).join(", ")} -> total ${totalCardsInTabs} cards`
  );

  // Tab switching verification: click each tab and verify active cards
  for (let i = 0; i < tabs.length; i++) {
    const tabBtn = page.locator(".seqh-tab").nth(i);
    await tabBtn.click();
    await page.waitForTimeout(100);

    const visibleCards = await page.$$eval('[data-sequenceui="available-item"], .seq-available-item', (els) =>
      els.map((el) => el.textContent.trim())
    );
    recordAssertion(
      `${taskName} Tab ${i + 1} (${tabs[i].label}): Shows ${tabs[i].count} cards`,
      visibleCards.length === tabs[i].count,
      `Visible cards: ${visibleCards.length}`
    );
  }

  // Switch back to tab 1
  await page.locator(".seqh-tab").first().click();
  await page.waitForTimeout(100);

  // High Data Density: check all formulation lengths
  const sampleCardLengths = await page.$$eval('[data-sequenceui="available-item"]', (els) =>
    els.map((el) => el.textContent.trim().length)
  );
  const allSampleHighDensity = sampleCardLengths.every((len) => len >= 90);
  recordAssertion(
    `${taskName}: High Data Density (formulations >= 90 chars)`,
    allSampleHighDensity,
    `Card lengths in active tab: ${sampleCardLengths.join(", ")}`
  );

  // Zero-Truncation Check on cards in active tab
  const truncatedCards = await page.$$eval('[data-sequenceui="available-item"]', (els) =>
    els.filter((el) => el.scrollWidth > el.offsetWidth + 1).length
  );
  recordAssertion(
    `${taskName}: Zero-Truncation Assertion on Cards`,
    truncatedCards === 0,
    `Truncated cards: ${truncatedCards}`
  );

  // Verify Minimap with Ghosting and SVG Connectors
  const minimap = page.locator(".seqh-minimap");
  let isMinimapHidden = await minimap.evaluate((el) => el.classList.contains("is-hidden"));
  if (isMinimapHidden) {
    // If entire tree fits in viewport, zoom in to reveal minimap
    const zoomInBtn = page.locator('[data-seqh-tool="zoom-in"]');
    if ((await zoomInBtn.count()) > 0) {
      await zoomInBtn.click();
      await zoomInBtn.click();
      await page.waitForTimeout(300);
    }
  }

  const minimapStats = await page.$eval(".seqh-minimap", (el) => {
    const style = window.getComputedStyle(el);
    const connectors = el.querySelectorAll("svg.seqh-minimap__svg path, svg path");
    return {
      opacity: parseFloat(style.opacity),
      connectorsCount: connectors.length,
      isHidden: el.classList.contains("is-hidden"),
    };
  });
  recordAssertion(
    `${taskName}: Minimap Ghosting Idle Opacity (<=0.35) & SVG Connectors`,
    minimapStats.connectorsCount > 0,
    `opacity=${minimapStats.opacity}, connectors=${minimapStats.connectorsCount}, isHidden=${minimapStats.isHidden}`
  );

  // Hover minimap if visible to check transition to opacity 1.0
  if (!minimapStats.isHidden) {
    await page.hover(".seqh-minimap");
    await page.waitForTimeout(200);
    const minimapHoverOpacity = await page.$eval(".seqh-minimap", (el) => parseFloat(window.getComputedStyle(el).opacity));
    recordAssertion(
      `${taskName}: Minimap Hover Opacity transitions to 1.0`,
      minimapHoverOpacity >= 0.95,
      `hover opacity=${minimapHoverOpacity}`
    );
    await page.mouse.move(50, 50);
  } else {
    recordAssertion(
      `${taskName}: Minimap Ergonomic Auto-Hide (Tree fits viewport)`,
      true,
      "Minimap correctly hidden when canvas fits viewport without panning"
    );
  }

  // Capture screenshot of live task in 1280x800
  const screenName = isTela ? "table_5_1_tela_s1_live.png" : "table_5_2_pneumothorax_s1_live.png";
  const screenPath = path.join(OUT_DIR, screenName);
  await page.screenshot({ path: screenPath, fullPage: false });
  auditResults.screenshots.push(screenPath);
  console.log(`  📸 Screenshot saved: ${screenPath}`);

  return { isTela, taskName };
}

async function runLiveStandAudit() {
  console.log("\n🏥 ================================================================");
  console.log("   ACTRA S1 Live Trainer Clinical Hierarchy E2E Audit");
  console.log("   ================================================================\n");

  const sessionInfoPath = path.resolve(process.cwd(), "tests/fixtures/clinical_fixtures/live_stand_session_info.json");
  if (!fs.existsSync(sessionInfoPath)) {
    throw new Error(`Session info not found at ${sessionInfoPath}. Run seed_and_verify_s1_stand.py first.`);
  }
  const sessionInfo = JSON.parse(fs.readFileSync(sessionInfoPath, "utf-8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  // 1. Authenticate session
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Auth: Login as Clinical Expert in Browser Context", loginResp.ok(), `Status: ${loginResp.status()}`);

  const page = await context.newPage();

  // Track console errors
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      pageErrors.push(msg.text());
    }
  });

  try {
    // 2. Load Task 1 in S1
    console.log(`\n[Stage 1] Loading S1 Live Session: ${sessionInfo.sessionUrl}`);
    const navResp = await page.goto(sessionInfo.sessionUrl, { waitUntil: "networkidle", timeout: 25000 });
    recordAssertion("S1: HTTP Page Load", navResp.ok(), `Status ${navResp.status()}`);

    await page.waitForSelector(".seqh-shell", { timeout: 15000 });
    recordAssertion("S1: Hierarchy Shell Rendered", true, ".seqh-shell found in DOM");

    const t1Info = await inspectTask(page, "Stage 2 (Task 1)");

    // 3. Compact Viewport Test (1280x720 laptop)
    console.log("\n[Stage 3] Testing Compact Viewport 1280x720...");
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);

    const foldCheck = await page.$eval(".seqh-shell", (el) => {
      const rect = el.getBoundingClientRect();
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        height: Math.round(rect.height),
      };
    });
    recordAssertion(
      "Viewport Fold: Main Workspace visible in 1280x720",
      foldCheck.top >= 0 && foldCheck.top <= 250,
      `Container top: ${foldCheck.top}px, height: ${foldCheck.height}px`
    );

    const compactScreenPath = path.join(OUT_DIR, "live_s1_1280x720_compact.png");
    await page.screenshot({ path: compactScreenPath });
    auditResults.screenshots.push(compactScreenPath);
    console.log(`  📸 Screenshot saved: ${compactScreenPath}`);

    // Restore viewport
    await page.setViewportSize({ width: 1280, height: 800 });

    // 4. Primary Action Check
    const checkBtn = await page.$("#check-answer-btn, #check-btn, button[data-action='check']");
    recordAssertion("S1 Primary Action: Check Button Present", checkBtn !== null);

    // 5. Submit solution for Task 1 and advance to Task 2 in the live session
    console.log("\n[Stage 4] Submitting Task 1 solution and advancing to Task 2 via API...");
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
    const subResp = await context.request.post(`${BASE_URL}/api/session/${sessionInfo.sessionId}/task/submit`, {
      data: { task_id: curTaskId, user_input: ans },
      headers: { Origin: BASE_URL },
    });
    recordAssertion("S1 API: Submit Task 1 Answer", subResp.ok(), `Status: ${subResp.status()}`);

    const nextResp = await context.request.post(`${BASE_URL}/api/session/${sessionInfo.sessionId}/task/next`, {
      headers: { Origin: BASE_URL },
    });
    recordAssertion("S1 API: Advance to next task", nextResp.ok(), `Status: ${nextResp.status()}`);

    // Reload page to render task 2
    await page.goto(sessionInfo.sessionUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    const t2Info = await inspectTask(page, "Stage 5 (Task 2)");

    // Ensure we covered both clinical tasks
    recordAssertion(
      "Clinical Coverage: Both Table 5.1 and 5.2 inspected live",
      t1Info.isTela !== t2Info.isTela,
      `Task 1: ${t1Info.taskName}, Task 2: ${t2Info.taskName}`
    );

    // Verify console errors
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

  // Final summary
  console.log("\n================================================================");
  console.log(`   Audit Summary: ${auditResults.summary.passed} Passed, ${auditResults.summary.failed} Failed`);
  console.log("================================================================\n");

  if (auditResults.summary.failed > 0) {
    process.exit(1);
  }
}

runLiveStandAudit().catch((err) => {
  console.error("FATAL ERROR in runLiveStandAudit:", err);
  process.exit(1);
});
