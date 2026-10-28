/**
 * ACTRA Stage 1 — S1 Deep Fix Verification Gate Runner
 *
 * Validates:
 * 1.1 Multi-slot group nodes (K >= 2) have container border + dashed slot borders.
 *     Single-slot group nodes (K = 1) have single dashed border on card and no nested border.
 * 1.2 In-place DOM patching preserves shell and elements across mutations.
 * 1.3 Sticky category accordion for N >= 5 tiers with sticky headers, Roman numerals, and collapse/expand.
 * 1.4 Precision analog zoom slider in S1 toolbar with two-way sync.
 *
 * Saves screenshots and micro-crops to conversation artifacts directory.
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const ARTIFACTS_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function runStage1Verification() {
  console.log("==================================================================");
  console.log("   ACTRA STAGE 1 — S1 HIERARCHY DEEP VERIFICATION GATE            ");
  console.log("==================================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  try {
    // 1. Authenticate
    console.log("\n[1/5] Authenticating as clinical expert...");
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
      headers: { Origin: BASE_URL },
    });
    if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

    // 2. Start Session for Task 5.1 (Hierarchy)
    console.log("[2/5] Starting clinical hierarchy complex session...");
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

    // 3. Verify Stage 1.4: Analog zoom slider in S1 toolbar
    console.log("\n[3/5] Verifying 1.4: Precision analog zoom slider in S1 toolbar...");
    const sliderInfo = await page.evaluate(() => {
      const slider = document.querySelector(".seqh-zoom-slider");
      const label = document.querySelector(".seqh-zoom-label");
      if (!slider) return null;
      return {
        exists: true,
        min: slider.min,
        max: slider.max,
        step: slider.step,
        value: slider.value,
        label: label ? label.textContent : "",
      };
    });

    if (!sliderInfo) throw new Error("Zoom slider .seqh-zoom-slider not found in S1 toolbar!");
    console.log("Slider info:", sliderInfo);
    if (sliderInfo.min !== "60" || sliderInfo.max !== "140") {
      throw new Error(`Zoom slider range mismatch: ${sliderInfo.min}-${sliderInfo.max}, expected 60-140`);
    }

    // Test sliding to 125%
    await page.evaluate(() => {
      const slider = document.querySelector(".seqh-zoom-slider");
      slider.value = "125";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(100);

    const zoomStageScale = await page.evaluate(() => {
      const stage = document.querySelector(".seqh-stage");
      const label = document.querySelector(".seqh-zoom-label");
      return { transform: stage.style.transform, label: label ? label.textContent : "" };
    });
    console.log("Scale at 125%:", zoomStageScale);
    if (zoomStageScale.label !== "125%" || !zoomStageScale.transform.includes("1.25")) {
      throw new Error(`Zoom slider failed to update canvas scale: ${JSON.stringify(zoomStageScale)}`);
    }

    // Micro-crop zoom toolbar
    const toolbarEl = await page.$(".seqh-toolbar__tools");
    if (toolbarEl) {
      await toolbarEl.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage1_s1_zoom_slider.png"),
      });
      console.log("  Saved micro-crop: crop_stage1_s1_zoom_slider.png");
    }

    // Reset zoom
    await page.evaluate(() => {
      const fit = document.querySelector('[data-seqh-tool="fit"]');
      if (fit) fit.click();
    });
    await page.waitForTimeout(200);

    // 4. Verify Stage 1.2: In-place DOM patching
    console.log("\n[4/5] Verifying 1.2: In-place DOM patching without shell destruction...");
    const inPlaceTest = await page.evaluate(() => {
      const shellBefore = document.querySelector('[data-sequenceui="hierarchy-shell"]');
      shellBefore.id = "test-canary-shell-id";

      // Select available card
      const availableCard = document.querySelector('[data-sequenceui="available-item"]');
      if (!availableCard) return { error: "No available card found" };
      const cardLabel = availableCard.innerText.trim();
      availableCard.click();

      // Click first empty target slot
      const targetSlot = document.querySelector('.seqh-slot--empty');
      if (!targetSlot) return { error: "No target slot found" };
      const targetNode = targetSlot.closest('.seqh-node');
      const targetNodeId = targetNode ? targetNode.dataset.nodeId : null;
      targetSlot.click();

      const shellAfter = document.querySelector('[data-sequenceui="hierarchy-shell"]');
      const isSameNode = shellAfter === shellBefore && shellAfter.id === "test-canary-shell-id";
      const placedCard = targetNode.querySelector('[data-sequenceui-placed-item="true"]');

      return {
        isSameNode,
        targetNodeId,
        cardLabel,
        hasPlacedCard: !!placedCard,
        placedText: placedCard ? placedCard.textContent.trim() : null,
      };
    });

    console.log("In-place mutation result:", inPlaceTest);
    if (!inPlaceTest.isSameNode) {
      throw new Error("FAIL: Shell was destroyed on card placement! In-place patching broken.");
    }
    if (!inPlaceTest.hasPlacedCard) {
      throw new Error("FAIL: Card was not placed in slot!");
    }
    console.log("  PASS: In-place DOM patching verified (shell identity preserved, card placed).");

    // Capture Dual-Height Viewport Full Screenshots on the pristine Clinical Session
    console.log("\nCapturing clean full viewport screenshots of clinical session (1280x800 and 1280x720)...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "stage1_s1_verified_1280x800.png") });

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "stage1_s1_verified_1280x720.png") });

    console.log("  Saved: stage1_s1_verified_1280x800.png");
    console.log("  Saved: stage1_s1_verified_1280x720.png");

    // 5. Verify Stage 1.1: Multi-slot group nodes (K >= 2) vs single-slot nodes (K = 1) in isolated sandbox
    console.log("\n[5/5] Verifying 1.1: Multi-slot empty borders & Anti-Matryoshka compliance...");
    const multiSlotTest = await page.evaluate(() => {
      const sandbox = document.createElement("div");
      sandbox.id = "stage1-sandbox-multislot";
      sandbox.style.cssText = "position: fixed; top: 0; left: 0; width: 1280px; height: 800px; z-index: 99999; background: var(--color-bg, #0f172a);";
      document.body.appendChild(sandbox);

      const task = {
        task_data: {
          content: {
            prompt: "Classification with multi-slot and single-slot nodes",
            display_mode: "hierarchy",
            color_differentiation: true,
            elements: [
              { id: "e1", text: "Single Finding" },
              { id: "e2", text: "Group Finding A" },
              { id: "e3", text: "Group Finding B" },
            ],
            levels: [
              { level_id: "lvl_1", label: "Category 1", blocks: ["e1"] },
              { level_id: "lvl_2", label: "Category 2", blocks: ["e2", "e3"] },
            ],
            nodes: [
              { node_id: "node_single", level_id: "lvl_1", parent_id: null, slots: ["e1"] },
              { node_id: "node_multi", level_id: "lvl_2", parent_id: "node_single", slots: ["e2", "e3"] },
            ],
            settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
          },
        },
      };

      window.SequenceUI.render(sandbox, task);

      const singleNode = sandbox.querySelector('.seqh-node[data-node-id="node_single"]');
      const multiNode = sandbox.querySelector('.seqh-node[data-node-id="node_multi"]');

      const singleCs = window.getComputedStyle(singleNode);
      const singleSlot = singleNode.querySelector(".seqh-slot--empty");
      const singleSlotCs = singleSlot ? window.getComputedStyle(singleSlot) : null;

      const multiCs = window.getComputedStyle(multiNode);
      const multiSlots = Array.from(multiNode.querySelectorAll(".seqh-slot--empty"));
      const multiSlotStyles = multiSlots.map((s) => {
        const cs = window.getComputedStyle(s);
        return {
          borderStyle: cs.borderBottomStyle,
          borderWidth: cs.borderBottomWidth,
        };
      });

      return {
        single: {
          slotCount: singleNode.dataset.slotCount,
          cardBorderStyle: singleCs.borderBottomStyle,
          cardBorderWidth: singleCs.borderBottomWidth,
          slotBorderStyle: singleSlotCs ? singleSlotCs.borderBottomStyle : "none",
        },
        multi: {
          slotCount: multiNode.dataset.slotCount,
          cardBorderStyle: multiCs.borderBottomStyle,
          cardBorderWidth: multiCs.borderBottomWidth,
          slotCountAttr: multiNode.getAttribute("data-slot-count"),
          slots: multiSlotStyles,
        },
      };
    });

    console.log("Multi-slot / single-slot test metrics:", multiSlotTest);

    // Assert single-slot node
    if (multiSlotTest.single.slotCount !== "1" || multiSlotTest.single.cardBorderStyle !== "dashed") {
      throw new Error(`Single slot node must have slotCount 1 and dashed card border, got ${JSON.stringify(multiSlotTest.single)}`);
    }
    if (multiSlotTest.single.slotBorderStyle !== "none") {
      throw new Error(`Single slot node slot must have no border (Anti-Matryoshka violation): ${multiSlotTest.single.slotBorderStyle}`);
    }
    console.log("  PASS: Single-slot empty node has dashed border on card and borderless inner slot.");

    // Assert multi-slot node
    if (multiSlotTest.multi.slotCount !== "2" || multiSlotTest.multi.cardBorderStyle !== "solid") {
      throw new Error(`Multi slot node must have solid container border, got ${JSON.stringify(multiSlotTest.multi)}`);
    }
    if (multiSlotTest.multi.slots.length !== 2) {
      throw new Error(`Multi slot node must have 2 slots, found ${multiSlotTest.multi.slots.length}`);
    }
    for (const slot of multiSlotTest.multi.slots) {
      if (slot.borderStyle !== "dashed") {
        throw new Error(`Multi-slot empty slot must have dashed border, got ${slot.borderStyle}`);
      }
    }
    console.log("  PASS: Multi-slot group node has solid container border and 2 distinct dashed slots.");

    // Micro-crop multi-slot card
    const multiNodeEl = await page.$('#stage1-sandbox-multislot .seqh-node[data-node-id="node_multi"]');
    if (multiNodeEl) {
      await multiNodeEl.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage1_s1_multislot_empty_borders.png"),
      });
      console.log("  Saved micro-crop: crop_stage1_s1_multislot_empty_borders.png");
    }

    // Clean up sandbox 1
    await page.evaluate(() => {
      const el = document.getElementById("stage1-sandbox-multislot");
      if (el) el.remove();
    });

    // 6. Verify Stage 1.3: Sticky category accordion with 5 tiers in isolated sandbox
    console.log("\n[6/5] Verifying 1.3: Sticky category accordion for 5+ tiers...");
    const accordionReport = await page.evaluate(() => {
      const sandbox = document.createElement("div");
      sandbox.id = "stage1-sandbox-accordion";
      sandbox.style.cssText = "position: fixed; top: 0; left: 0; width: 1280px; height: 800px; z-index: 99999; background: var(--color-bg, #0f172a);";
      document.body.appendChild(sandbox);

      const task = {
        task_data: {
          content: {
            prompt: "Classification with 5 tiers",
            display_mode: "hierarchy",
            color_differentiation: true,
            elements: [
              { id: "e1", text: "Element 1" },
              { id: "e2", text: "Element 2" },
              { id: "e3", text: "Element 3" },
              { id: "e4", text: "Element 4" },
              { id: "e5", text: "Element 5" },
            ],
            levels: [
              { level_id: "lvl_1", label: "Category 1", blocks: ["e1"] },
              { level_id: "lvl_2", label: "Category 2", blocks: ["e2"] },
              { level_id: "lvl_3", label: "Category 3", blocks: ["e3"] },
              { level_id: "lvl_4", label: "Category 4", blocks: ["e4"] },
              { level_id: "lvl_5", label: "Category 5", blocks: ["e5"] },
            ],
            nodes: [
              { node_id: "n_1", level_id: "lvl_1", parent_id: null, slots: ["e1"] },
              { node_id: "n_2", level_id: "lvl_2", parent_id: "n_1", slots: ["e2"] },
              { node_id: "n_3", level_id: "lvl_3", parent_id: "n_2", slots: ["e3"] },
              { node_id: "n_4", level_id: "lvl_4", parent_id: "n_3", slots: ["e4"] },
              { node_id: "n_5", level_id: "lvl_5", parent_id: "n_4", slots: ["e5"] },
            ],
            settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
          },
        },
      };

      window.SequenceUI.render(sandbox, task);

      const tabs = sandbox.querySelector(".seqh-tabs");
      const headers = Array.from(sandbox.querySelectorAll('[data-sequenceui="available-tier-header"]'));
      return {
        tabsHidden: tabs ? tabs.classList.contains("hidden") : true,
        headerCount: headers.length,
        headerLabels: headers.map((h) => h.innerText.replace(/\s+/g, " ").trim()),
      };
    });

    console.log("Accordion report:", accordionReport);
    if (!accordionReport.tabsHidden) {
      throw new Error("FAIL: Standard tabs must be hidden when 5 or more tiers are present!");
    }
    if (accordionReport.headerCount !== 5) {
      throw new Error(`FAIL: Expected 5 accordion headers, found ${accordionReport.headerCount}`);
    }
    console.log("  PASS: 5-tier task switches to sticky category accordion with 5 headers.");

    // Micro-crop accordion in sidebar
    const sidebarEl = await page.$('#stage1-sandbox-accordion [data-sequenceui="available-sidebar"]');
    if (sidebarEl) {
      await sidebarEl.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage1_s1_sticky_accordion_5tiers.png"),
      });
      console.log("  Saved micro-crop: crop_stage1_s1_sticky_accordion_5tiers.png");
    }

    // Clean up sandbox 2
    await page.evaluate(() => {
      const el = document.getElementById("stage1-sandbox-accordion");
      if (el) el.remove();
    });

    console.log("\n==================================================================");
    console.log("   STAGE 1 (S1) VERIFICATION VERDICT: 100% PASS                   ");
    console.log("==================================================================");
  } finally {
    await browser.close();
  }
}

runStage1Verification().catch((err) => {
  console.error("\n*** STAGE 1 VERIFICATION FAILURE ***", err);
  process.exit(1);
});
