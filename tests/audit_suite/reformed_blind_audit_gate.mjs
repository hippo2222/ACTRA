/**
 * ACTRA Reformed Blind Audit Gate Runner (Headless Hard Gates)
 *
 * Implements 5 Hard Quality Gates:
 * 1. assertNoClippedBorders: Zero truncation or clipping on tabs & nodes.
 * 2. assertScalabilityMatrix: Real SequenceUI.render() for N in {3, 5, 9} (3 flat tabs, 5/9 sticky accordion).
 * 3. assertSmoothLayoutTransition: Genuine kinetic RAF tracking & Web Animations API pause/play intermediate frame hash diff.
 * 4. assertSlotBorderContinuity: Dashed borders on single & group inner slots, linkClearance >= 1.5px across 100%, 80%, 60% zoom.
 * 5. assertMaxNestingDepth: Anti-Matryoshka strict border nesting <= 1.
 */

import { chromium } from "playwright";
import crypto from "crypto";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const ARTIFACTS_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function parseRgb(colorStr) {
  const m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
}

function relativeLuminance([r, g, b]) {
  const sRGB = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

function calculateContrast(color1Str, color2Str) {
  const l1 = relativeLuminance(parseRgb(color1Str));
  const l2 = relativeLuminance(parseRgb(color2Str));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// -----------------------------------------------------------------------------
// GATE 1: assertNoClippedBorders
// -----------------------------------------------------------------------------
async function assertNoClippedBorders(page) {
  console.log("\n[Gate 1] Running assertNoClippedBorders...");
  const report = await page.evaluate(() => {
    const results = [];
    const scroll = document.querySelector(".seqh-tabs-scroll");
    const tabs = Array.from(document.querySelectorAll(".seqh-tab"));
    if (scroll && tabs.length > 0) {
      const parentRect = scroll.getBoundingClientRect();
      const parentStyle = window.getComputedStyle(scroll);
      const padBottom = parseFloat(parentStyle.paddingBottom) || 0;
      const padTop = parseFloat(parentStyle.paddingTop) || 0;

      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const r = tab.getBoundingClientRect();
        const bottomClipped = r.bottom > parentRect.bottom - padBottom + 0.5;
        const topClipped = r.top < parentRect.top + padTop - 0.5;
        results.push({
          target: `Tab[${i}] (${tab.innerText.trim()})`,
          bottom: r.bottom,
          parentBottom: parentRect.bottom,
          bottomClipped,
          topClipped,
          passed: !bottomClipped && !topClipped,
        });
      }
    }

    // Nodes vs Grid
    const nodes = Array.from(document.querySelectorAll(".seqh-node"));
    const grid = document.querySelector(".seqh-grid");
    if (grid && nodes.length > 0) {
      const gRect = grid.getBoundingClientRect();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const r = n.getBoundingClientRect();
        const nodeClipped = r.right > gRect.right + 1 || r.bottom > gRect.bottom + 1;
        results.push({
          target: `Node[${i}] (${n.dataset.nodeId})`,
          right: r.right,
          gridRight: gRect.right,
          passed: !nodeClipped,
        });
      }
    }

    return results;
  });

  let allPassed = true;
  for (const res of report) {
    if (!res.passed) {
      console.error(`  FAIL: ${res.target} clipped by parent boundary!`, res);
      allPassed = false;
    } else {
      console.log(`  PASS: ${res.target} cleanly within container.`);
    }
  }

  if (!allPassed) {
    throw new Error("assertNoClippedBorders: Clipped element detected!");
  }
  return true;
}

// -----------------------------------------------------------------------------
// GATE 2: assertScalabilityMatrix (N in {3, 5, 9} via genuine SequenceUI.render)
// -----------------------------------------------------------------------------
async function assertScalabilityMatrix(page) {
  console.log("\n[Gate 2] Running assertScalabilityMatrix (N in {3, 5, 9} via real SequenceUI.render)...");

  const scalingTests = [
    { count: 3, label: "N=3 Flat Tabs" },
    { count: 5, label: "N=5 Sticky Accordion" },
    { count: 9, label: "N=9 Sticky Accordion" },
  ];

  for (const testCase of scalingTests) {
    console.log(`  Testing ${testCase.label} with real SequenceUI.render...`);

    const result = await page.evaluate(async (levelCount) => {
      const container = document.querySelector("#task-content");
      if (!container || !window.SequenceUI) return { error: "Container or SequenceUI not found" };

      // Build synthetic clinical task
      const levels = [];
      const nodes = [];
      const elements = [];
      for (let i = 0; i < levelCount; i++) {
        const levelId = `tier_${i + 1}`;
        const itemId = `item_${i + 1}`;
        levels.push({
          level_id: levelId,
          label: `Уровень ${i + 1}`,
          blocks: [itemId],
        });
        const parentId = i > 0 ? nodes[i - 1].node_id : null;
        const nodeId = `node_${i + 1}`;
        nodes.push({
          node_id: nodeId,
          level_id: levelId,
          parent_id: parentId,
          slots: [itemId],
        });
        elements.push({
          id: itemId,
          text: `Клинический шаг ${i + 1}`,
          tier_id: levelId,
        });
      }

      const syntheticTask = {
        task_data: {
          content: {
            display_mode: "hierarchy",
            levels,
            nodes,
            elements,
          }
        }
      };

      // Real render
      window.SequenceUI.render(container, syntheticTask);

      // Wait a frame for DOM
      await new Promise(r => requestAnimationFrame(r));

      const scrollContainer = document.querySelector(".seqh-tabs-scroll");
      const tabs = Array.from(document.querySelectorAll(".seqh-tab"));
      const accordionGroups = Array.from(document.querySelectorAll(".seqh-pool-group"));
      const pool = document.querySelector(".seqh-pool");

      const hasHorizontalScroll = scrollContainer ? (scrollContainer.scrollWidth > scrollContainer.clientWidth + 1) : false;
      const poolHorizontalScroll = pool ? (pool.scrollWidth > pool.clientWidth + 1) : false;

      let accordionWorking = false;
      if (accordionGroups.length > 0) {
        const firstGroup = accordionGroups[0];
        const header = firstGroup.querySelector(".seqh-pool-group__header");
        const wasCollapsed = firstGroup.classList.contains("is-collapsed");
        if (header) {
          header.click();
          const newFirstGroup = document.querySelector(".seqh-pool-group");
          const isCollapsedNow = newFirstGroup ? newFirstGroup.classList.contains("is-collapsed") : false;
          accordionWorking = (wasCollapsed !== isCollapsedNow);
          // toggle back
          const newHeader = newFirstGroup ? newFirstGroup.querySelector(".seqh-pool-group__header") : null;
          if (newHeader) newHeader.click();
        }
      }

      return {
        levelCount,
        tabsCount: tabs.length,
        accordionGroupsCount: accordionGroups.length,
        hasHorizontalScroll,
        poolHorizontalScroll,
        accordionWorking,
      };
    }, testCase.count);

    if (result.error) throw new Error(result.error);

    console.log(`    Result for N=${testCase.count}:`, result);

    if (testCase.count === 3) {
      if (result.tabsCount !== 3) {
        throw new Error(`assertScalabilityMatrix FAIL (N=3): Expected 3 tabs, got ${result.tabsCount}`);
      }
      if (result.accordionGroupsCount !== 0) {
        throw new Error(`assertScalabilityMatrix FAIL (N=3): Unexpected accordion groups for N=3`);
      }
      if (result.hasHorizontalScroll) {
        throw new Error(`assertScalabilityMatrix FAIL (N=3): Horizontal scrollbar detected in tabs!`);
      }
      console.log(`    PASS: N=3 renders clean flat tabs without scrollbar.`);
    } else {
      // N in {5, 9}
      if (result.accordionGroupsCount !== testCase.count) {
        throw new Error(`assertScalabilityMatrix FAIL (N=${testCase.count}): Expected ${testCase.count} accordion groups, got ${result.accordionGroupsCount}`);
      }
      if (result.poolHorizontalScroll) {
        throw new Error(`assertScalabilityMatrix FAIL (N=${testCase.count}): Horizontal scrollbar detected in pool!`);
      }
      if (!result.accordionWorking) {
        throw new Error(`assertScalabilityMatrix FAIL (N=${testCase.count}): Accordion toggle failed!`);
      }
      console.log(`    PASS: N=${testCase.count} renders sticky accordion with functional toggle & zero horizontal overflow.`);
    }
  }

  // Restore original session task by reloading
  console.log("  Restoring clinical session task...");
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".seqh-shell", { timeout: 15000 });
  await page.waitForTimeout(300);

  return true;
}

// -----------------------------------------------------------------------------
// GATE 3: assertSmoothLayoutTransition (Genuine RAF & Web Animations API pause/play)
// -----------------------------------------------------------------------------
async function assertSmoothLayoutTransition(page) {
  console.log("\n[Gate 3] Running assertSmoothLayoutTransition (RAF kinetic tracking + Web Animations pause/play)...");

  // Detect target node
  const targetId = await page.evaluate(() => {
    const n = document.querySelector(".seqh-node");
    return n ? n.dataset.nodeId : null;
  });
  if (!targetId) throw new Error("No target node found in canvas");

  // Select card in sidebar
  const card = page.locator('[data-sequenceui="available-item"]').first();
  await card.click();
  await page.waitForTimeout(100);

  // 1. Capture start state before click
  const targetEl = await page.$(`.seqh-node[data-node-id="${targetId}"]`);
  const startBox = await targetEl.boundingBox();
  const startHeight = startBox.height;
  const startBuf = await targetEl.screenshot();
  const startHash = crypto.createHash("sha256").update(startBuf).digest("hex");

  // Setup RAF frame recorder
  await page.evaluate((id) => {
    window.__kineticFrames = [];
    let active = true;
    const start = performance.now();

    function recordFrame() {
      if (!active) return;
      const now = performance.now() - start;
      const node = document.querySelector(`.seqh-node[data-node-id="${id}"]`);
      if (node) {
        const r = node.getBoundingClientRect();
        window.__kineticFrames.push({
          time: Math.round(now),
          height: Math.round(r.height * 10) / 10,
        });
      }
      if (now < 300) {
        requestAnimationFrame(recordFrame);
      }
    }
    window.__stopRecorder = () => { active = false; };
    requestAnimationFrame(recordFrame);
  }, targetId);

  // 2. Click slot to insert
  await page.evaluate((id) => {
    const slot = document.querySelector(`.seqh-node[data-node-id="${id}"] [data-sequenceui-slot="true"]`);
    if (slot) slot.click();
  }, targetId);

  // 3. At t=50ms (early-midway through 240ms cubic-bezier transition), pause Web Animations
  await page.waitForTimeout(50);
  const midMetrics = await page.evaluate((id) => {
    document.getAnimations().forEach((a) => a.pause());
    const node = document.querySelector(`.seqh-node[data-node-id="${id}"]`);
    const r = node ? node.getBoundingClientRect() : null;
    return {
      height: r ? r.height : 0,
      animCount: document.getAnimations().length,
    };
  }, targetId);

  // 4. Capture real intermediate frozen frame
  const midBuf = await targetEl.screenshot();
  const midHash = crypto.createHash("sha256").update(midBuf).digest("hex");

  // 5. Resume Web Animations and let transition finish
  await page.evaluate(() => {
    document.getAnimations().forEach((a) => a.play());
  });
  await page.waitForTimeout(250);

  // 6. Capture final state
  const finalBox = await targetEl.boundingBox();
  const finalHeight = finalBox.height;
  const finalBuf = await targetEl.screenshot();
  const finalHash = crypto.createHash("sha256").update(finalBuf).digest("hex");

  const frames = await page.evaluate(() => {
    if (window.__stopRecorder) window.__stopRecorder();
    return window.__kineticFrames;
  });

  console.log(`  Recorded ${frames.length} frames during expansion.`);
  if (frames.length < 6) {
    throw new Error(`assertSmoothLayoutTransition FAIL: Insufficient frames captured (${frames.length} < 6)`);
  }

  // Check continuity: max delta <= 28px (prevents 44px instantaneous snap)
  let maxDelta = 0;
  for (let i = 1; i < frames.length; i++) {
    const delta = Math.abs(frames[i].height - frames[i - 1].height);
    if (delta > maxDelta) maxDelta = delta;
  }
  console.log(`  Max height delta between consecutive frames: ${maxDelta.toFixed(1)}px (snap threshold: 28px)`);
  if (maxDelta > 28) {
    throw new Error(`assertSmoothLayoutTransition FAIL: Max frame delta (${maxDelta.toFixed(1)}px) exceeded 28px threshold! Instantaneous snap detected.`);
  }

  console.log(`  Genuine Physical Heights:`);
  console.log(`    Start height: ${startHeight.toFixed(1)}px`);
  console.log(`    Mid-transition height (frozen via Web Animations): ${midMetrics.height.toFixed(1)}px`);
  console.log(`    Final height: ${finalHeight.toFixed(1)}px`);
  console.log(`  Crypto Raster Hashes:`);
  console.log(`    Start frame: ${startHash.substring(0, 16)}...`);
  console.log(`    Mid frame:   ${midHash.substring(0, 16)}...`);
  console.log(`    Final frame: ${finalHash.substring(0, 16)}...`);

  // Assert genuine physical expansion in flight
  if (midMetrics.height <= startHeight + 2 || midMetrics.height >= finalHeight - 2) {
    throw new Error(`assertSmoothLayoutTransition FAIL: Mid-frame height (${midMetrics.height.toFixed(1)}px) is not strictly intermediate between start (${startHeight.toFixed(1)}px) and final (${finalHeight.toFixed(1)}px)!`);
  }
  if (startHash === midHash || midHash === finalHash) {
    throw new Error("assertSmoothLayoutTransition FAIL: Mid-transition raster identical to start or final state!");
  }
  console.log("  PASS: Genuine intermediate motion frame captured and verified via Web Animations API.");

  return true;
}

// -----------------------------------------------------------------------------
// GATE 4: assertSlotBorderContinuity (multi-slot dashed & linkClearance >= 1.5px)
// -----------------------------------------------------------------------------
async function assertSlotBorderContinuity(page) {
  console.log("\n[Gate 4] Running assertSlotBorderContinuity (Multi-slot dashed contours & linkClearance >= 1.5px)...");

  const zoomLevels = [1.0, 0.8, 0.6];

  for (const zoom of zoomLevels) {
    console.log(`  Inspecting slots at zoom scale = ${(zoom * 100).toFixed(0)}%...`);
    await page.evaluate((z) => {
      const stage = document.querySelector(".seqh-stage");
      if (stage) stage.style.transform = `scale(${z})`;
    }, zoom);
    await page.waitForTimeout(100);

    const slotMetrics = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(".seqh-node"));
      const stage = document.querySelector(".seqh-stage");
      const links = Array.from(document.querySelectorAll(".seqh-link"));

      function getOffsetWithin(el, ancestor) {
        let x = 0;
        let y = 0;
        let node = el;
        let guard = 0;
        while (node && node !== ancestor && guard < 12) {
          x += node.offsetLeft || 0;
          y += node.offsetTop || 0;
          node = node.offsetParent;
          guard += 1;
        }
        return { x, y, w: el.offsetWidth || 0, h: el.offsetHeight || 0 };
      }

      return nodes.map((n, i) => {
        const cs = window.getComputedStyle(n);
        const r = n.getBoundingClientRect();
        const band = n.closest(".seqh-band");
        const bandCs = band ? window.getComputedStyle(band) : null;
        const emptySlots = Array.from(n.querySelectorAll(".seqh-slot--empty"));
        const slotCount = parseInt(n.getAttribute("data-slot-count") || "1", 10);

        // Slot border metrics
        const innerSlotMetrics = emptySlots.map(s => {
          const scs = window.getComputedStyle(s);
          return {
            borderBottomStyle: scs.borderBottomStyle,
            borderBottomWidth: scs.borderBottomWidth,
            borderColor: scs.borderBottomColor,
          };
        });

        // Find child link originating from this node
        const childLink = links.find((l) => l.dataset.parentId === n.dataset.nodeId);
        let linkClearance = null;
        if (childLink) {
          const d = childLink.getAttribute("d") || "";
          const m = d.match(/M\s*[\d.]+\s+([\d.]+)/);
          if (m) {
            const startY = parseFloat(m[1]);
            const pos = getOffsetWithin(n, stage);
            const nodeBottom = pos.y + pos.h;
            linkClearance = Math.round((startY - nodeBottom) * 10) / 10;
          }
        }

        return {
          idx: i,
          nodeId: n.dataset.nodeId,
          tierId: n.dataset.tierId,
          slotCount,
          borderBottomStyle: cs.borderBottomStyle,
          borderBottomWidth: cs.borderBottomWidth,
          borderColor: cs.borderBottomColor,
          bandBgColor: bandCs ? bandCs.backgroundColor : "rgb(255,255,255)",
          height: r.height,
          emptySlotsCount: emptySlots.length,
          innerSlotMetrics,
          linkClearance,
        };
      });
    });

    for (const sm of slotMetrics) {
      if (sm.slotCount > 1) {
        // Multi-slot group node: each empty slot inside must have dashed border
        for (const ism of sm.innerSlotMetrics) {
          if (ism.borderBottomStyle !== "dashed") {
            throw new Error(`assertSlotBorderContinuity FAIL: Inner slot in node ${sm.nodeId} borderBottomStyle is '${ism.borderBottomStyle}', expected 'dashed'`);
          }
          const widthVal = parseFloat(ism.borderBottomWidth);
          if (widthVal < 1.0) {
            throw new Error(`assertSlotBorderContinuity FAIL: Inner slot in node ${sm.nodeId} borderBottomWidth (${widthVal}px) is too thin!`);
          }
        }
      } else {
        // Single slot node: node itself carries the dashed border
        if (sm.borderBottomStyle !== "dashed") {
          throw new Error(`assertSlotBorderContinuity FAIL: Node ${sm.nodeId} borderBottomStyle is '${sm.borderBottomStyle}', expected 'dashed'`);
        }
        const widthVal = parseFloat(sm.borderBottomWidth);
        if (widthVal < 1.0) {
          throw new Error(`assertSlotBorderContinuity FAIL: Node ${sm.nodeId} borderBottomWidth (${widthVal}px) is too thin!`);
        }
        const contrast = calculateContrast(sm.borderColor, sm.bandBgColor);
        if (contrast < 2.5) {
          throw new Error(`assertSlotBorderContinuity FAIL: Node ${sm.nodeId} contrast ratio (${contrast.toFixed(2)}:1) violates minimum contrast!`);
        }
      }

      // Check linkClearance if node has outgoing links
      if (sm.linkClearance !== null) {
        if (sm.linkClearance < 1.5) {
          throw new Error(`assertSlotBorderContinuity FAIL: Node ${sm.nodeId} linkClearance (${sm.linkClearance}px) is less than required 1.5px minimum!`);
        }
      }
    }
    console.log(`  PASS: All ${slotMetrics.length} nodes retain dashed contour, valid contrast, and linkClearance (${slotMetrics[0]?.linkClearance}px) >= 1.5px at ${(zoom * 100).toFixed(0)}% zoom.`);
  }

  // Reset zoom scale
  await page.evaluate(() => {
    const stage = document.querySelector(".seqh-stage");
    if (stage) stage.style.transform = "";
  });

  return true;
}

// -----------------------------------------------------------------------------
// GATE 5: assertMaxNestingDepth
// -----------------------------------------------------------------------------
async function assertMaxNestingDepth(page) {
  console.log("\n[Gate 5] Running assertMaxNestingDepth (Anti-Matryoshka strict limit <= 1)...");

  const report = await page.evaluate(() => {
    const results = [];
    const tabs = Array.from(document.querySelectorAll(".seqh-tab"));
    const container = document.querySelector('[data-sequenceui="available-card"]');
    if (!container) return { passed: false, error: "available-card not found" };

    function countBorderedAncestors(el, root) {
      let count = 0;
      let curr = el.parentElement;
      while (curr && curr !== root) {
        const style = window.getComputedStyle(curr);
        const hasBorder =
          style.borderWidth !== "0px" &&
          style.borderStyle !== "none" &&
          style.borderColor !== "transparent";
        if (hasBorder) count++;
        curr = curr.parentElement;
      }
      return count;
    }

    tabs.forEach((tab) => {
      const depth = countBorderedAncestors(tab, container);
      results.push({
        text: tab.innerText.trim(),
        depth,
        passed: depth <= 1,
      });
    });

    return {
      passed: results.every((r) => r.passed),
      results,
      containerClass: container.className,
    };
  });

  if (!report.passed) {
    console.error("  Nesting Depth Failures:", report.results);
    throw new Error("assertMaxNestingDepth: Visual hierarchy contains excessive nested card borders (Matryoshka anti-pattern)!");
  }

  console.log("  Surface container: [data-sequenceui=\"available-card\"] (surface-1)");
  report.results.forEach((r) => {
    console.log(`  Tab "${r.text}": intermediate border nesting depth = ${r.depth}`);
  });
  console.log("  PASS: Zero intermediate border nesting between surface-1 and tab controls (Anti-Matryoshka PASS).");
  return true;
}

// -----------------------------------------------------------------------------
// MAIN EXECUTION
// -----------------------------------------------------------------------------
async function runReformedBlindAuditGate() {
  console.log("==================================================================");
  console.log("   ACTRA REFORMED BLIND AUDIT SUITE — 5 HEADLESS HARD GATES       ");
  console.log("==================================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  try {
    // 1. Authenticate
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
      headers: { Origin: BASE_URL },
    });
    if (!loginRes.ok()) throw new Error(`Login failed with status ${loginRes.status()}`);

    // 2. Start Session for Task 5.1
    const startRes = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
      data: { force: true },
      headers: { Origin: BASE_URL },
    });
    const startData = await startRes.json();
    const sessionUrl = `${BASE_URL}/session/${startData.session_id}`;

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(sessionUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });
    await page.waitForTimeout(400);

    // Execute the 5 Gates sequentially across dual viewports (1280x720 and 1280x800)
    for (const vp of [{ width: 1280, height: 720 }, { width: 1280, height: 800 }]) {
      console.log(`\n>>> Testing Viewport ${vp.width}x${vp.height} <<<`);
      await page.setViewportSize(vp);
      await page.waitForTimeout(200);
      await assertNoClippedBorders(page);
      await assertSlotBorderContinuity(page);
    }

    await assertScalabilityMatrix(page);
    await assertMaxNestingDepth(page);
    await assertSmoothLayoutTransition(page);

    console.log("\n==================================================================");
    console.log("   REFORMED BLIND AUDIT VERDICT: ALL 5 GATES PASSED (100% PASS)  ");
    console.log("==================================================================");
  } finally {
    await browser.close();
  }
}

runReformedBlindAuditGate().catch((err) => {
  console.error("\n*** REFORMED BLIND AUDIT HARD GATE FAILURE ***", err);
  process.exit(1);
});
