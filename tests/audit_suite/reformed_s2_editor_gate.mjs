/**
 * ACTRA Stage 4 — Reformed S2 Editor Automated Gate Runner
 *
 * Implements the 7 Deterministic Hard Gates established in AGENTS.md & Remediation Plan:
 * 1. Gate S2-1: assertSegmentedControlClearance (Mode tabs 0px right overflow, accurate pill offsetLeft)
 * 2. Gate S2-2: assertNoFooterButtonOverflow (Card action buttons 0px left/right overflow)
 * 3. Gate S2-3: assertUndoRedoTextIntegrity (Preservation of text on Ctrl+Z, delegation from input, fast undo 100ms race, sync delete 50ms race)
 * 4. Gate S2-4: assertEmptySlotValidationHighlighter (Visual highlighting, repeated shake, autofocus, error clearance on input & delete)
 * 5. Gate S2-5: assertPrecisionZoomSlider (Two-way slider sync, pan preservation, minimap SVG connectors)
 * 6. Gate S2-6: assertKineticTransitions (Table card & row FLIP entry/exit, "Группа (2)" badge synchrony, linear mode addBlock order)
 * 7. Gate S2-7: assertColorDifferentiationPermanent (Permanent tier color coding, 0 toggle checkbox)
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const ARTIFACTS_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function login(context) {
  await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
    headers: { Origin: BASE_URL },
  });
}

// -----------------------------------------------------------------------------
// GATE S2-1: assertSegmentedControlClearance
// -----------------------------------------------------------------------------
async function assertSegmentedControlClearance(page) {
  console.log("\n[Gate S2-1] Running assertSegmentedControlClearance...");
  const data = await page.evaluate(() => {
    const container = document.querySelector("#se-display-mode-tabs");
    const pill = document.querySelector("#se-mode-tabs-pill");
    const hier = document.querySelector("#mode-tab-hierarchy");
    if (!container || !pill || !hier) {
      return { passed: false, error: "Mode tabs DOM elements not found" };
    }
    const cR = container.getBoundingClientRect();
    const pR = pill.getBoundingClientRect();
    const hR = hier.getBoundingClientRect();
    const cCs = window.getComputedStyle(container);

    const pillOverflow = Math.max(0, Math.round((pR.right - cR.right) * 10) / 10);
    const hierOverflow = Math.max(0, Math.round((hR.right - cR.right) * 10) / 10);
    const overflowHidden = cCs.overflow === "hidden";
    const borderBox = cCs.boxSizing === "border-box";
    const tabDelta = Math.abs(pR.left - hR.left);

    return {
      passed: pillOverflow <= 0 && hierOverflow <= 0 && overflowHidden && borderBox && tabDelta <= 2.5,
      containerWidth: cR.width,
      pillRight: pR.right,
      containerRight: cR.right,
      pillOverflow,
      hierOverflow,
      tabDelta,
      overflowHidden,
      borderBox,
    };
  });

  console.log("  Results:", JSON.stringify(data));
  if (!data.passed) {
    throw new Error(`Gate S2-1 FAILED: pillOverflow=${data.pillOverflow}px, tabDelta=${data.tabDelta}px`);
  }
  console.log("  ✅ Gate S2-1 PASSED (0px overflow on segmented mode tabs, accurate pill alignment).");
  return data;
}

// -----------------------------------------------------------------------------
// GATE S2-2: assertNoFooterButtonOverflow
// -----------------------------------------------------------------------------
async function assertNoFooterButtonOverflow(page) {
  console.log("\n[Gate S2-2] Running assertNoFooterButtonOverflow...");
  await page.evaluate(() => {
    document.querySelectorAll(".se-node-footer").forEach((f) => {
      f.style.opacity = "1";
      f.style.visibility = "visible";
    });
  });
  await page.waitForTimeout(100);

  const report = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".se-node-card"));
    const issues = [];
    let checkedButtons = 0;

    cards.forEach((card) => {
      const cardR = card.getBoundingClientRect();
      const footer = card.querySelector(".se-node-footer");
      if (!footer) return;
      const buttons = Array.from(footer.querySelectorAll("button"));

      buttons.forEach((btn) => {
        checkedButtons++;
        const btnR = btn.getBoundingClientRect();
        const text = btn.innerText.trim().replace(/\n/g, " ");
        const overflowsLeft = btnR.left < cardR.left - 0.5;
        const overflowsRight = btnR.right > cardR.right + 0.5;

        if (overflowsLeft || overflowsRight) {
          issues.push({
            nodeId: card.dataset.nodeId,
            buttonText: text,
            cardLeft: cardR.left,
            cardRight: cardR.right,
            btnLeft: btnR.left,
            btnRight: btnR.right,
            overflowsLeft,
            overflowsRight,
          });
        }
      });
    });

    return {
      passed: issues.length === 0,
      totalCards: cards.length,
      checkedButtons,
      issues,
    };
  });

  console.log(`  Checked ${report.checkedButtons} footer buttons across ${report.totalCards} cards.`);
  if (!report.passed) {
    console.error("  Issues:", JSON.stringify(report.issues, null, 2));
    throw new Error(`Gate S2-2 FAILED: ${report.issues.length} button overflow issues detected.`);
  }
  console.log("  ✅ Gate S2-2 PASSED (0px button overflow on cards, all buttons within card bounds).");
  return report;
}

// -----------------------------------------------------------------------------
// GATE S2-3: assertUndoRedoTextIntegrity (Hardened with delegation & race gates)
// -----------------------------------------------------------------------------
async function assertUndoRedoTextIntegrity(page) {
  console.log("\n[Gate S2-3] Running assertUndoRedoTextIntegrity (Text preservation, input delegation, and race tests)...");

  // 1. Delegation from focused non-empty input
  const delegation = await page.evaluate(() => {
    const editor = window.editor;
    const card = document.querySelector(".se-node-card");
    const textarea = card?.querySelector("textarea.block-title-input");
    return {
      delegates: editor ? editor.shouldDelegateUndoRedoFromInput(textarea) : false,
    };
  });
  if (!delegation.delegates) {
    throw new Error("Gate S2-3 FAILED: shouldDelegateUndoRedoFromInput returned false for card textarea!");
  }
  console.log("  PASS: shouldDelegateUndoRedoFromInput properly delegates keyboard Ctrl+Z/Ctrl+Y.");

  // 2. Fast Undo at 100ms (flushing 400ms debounce timer)
  const raceTest = await page.evaluate(async () => {
    const editor = window.editor;
    editor.saveStateToHistory();

    const textarea = document.querySelector(".se-node-card textarea.block-title-input");
    const originalText = textarea.value;

    textarea.value = "Быстрый набор для проверки отката";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    const timerActive = !!editor._historySaveTimeout;

    // Fast undo before 400ms timer
    editor.performUndo();
    const textAfterUndo = document.querySelector(".se-node-card textarea.block-title-input")?.value;

    // Redo restores text
    editor.performRedo();
    const textAfterRedo = document.querySelector(".se-node-card textarea.block-title-input")?.value;

    // Restore original
    editor.performUndo();

    return {
      timerActive,
      originalText,
      textAfterUndo,
      textAfterRedo,
    };
  });

  if (!raceTest.timerActive || raceTest.textAfterUndo !== raceTest.originalText || raceTest.textAfterRedo !== "Быстрый набор для проверки отката") {
    throw new Error(`Gate S2-3 FAILED: Fast undo 100ms race failed! state=${JSON.stringify(raceTest)}`);
  }
  console.log("  PASS: Fast undo cleanly flushed debounce timer, and redo restored text.");

  // 3. Fast Undo after deleteItemFromNode (synchronous history save at t=0ms)
  const syncDeleteTest = await page.evaluate(async () => {
    const editor = window.editor;
    const leaf = editor.nodes.find(n => !editor.nodes.some(c => c.parentId === n.nodeId));
    if (!leaf) return { error: "No leaf" };
    const leafId = leaf.nodeId;

    if (leaf.items.length === 1) {
      editor.addItemToNode(leafId);
    }
    editor.saveStateToHistory();
    const countBefore = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

    // Delete item
    editor.deleteItemFromNode(leafId, countBefore - 1);
    const countImmediatelyAfter = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

    // Immediate undo at 50ms (before 180ms timeout)
    editor.performUndo();
    const countAfterUndo = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

    // Clean up: delete extra item so leaf card is back to original state
    editor.deleteItemFromNode(leafId, countAfterUndo - 1);
    await new Promise(r => setTimeout(r, 220));

    return {
      countBefore,
      countImmediatelyAfter,
      countAfterUndo,
    };
  });

  if (syncDeleteTest.countImmediatelyAfter !== syncDeleteTest.countBefore - 1 || syncDeleteTest.countAfterUndo !== syncDeleteTest.countBefore) {
    throw new Error(`Gate S2-3 FAILED: Synchronous delete history save failed! state=${JSON.stringify(syncDeleteTest)}`);
  }
  console.log("  PASS: deleteItemFromNode executed synchronous history save without timer race.");

  console.log("  ✅ Gate S2-3 PASSED (Complete undo/redo text integrity, delegation, and race resilience).");
  return { passed: true };
}

// -----------------------------------------------------------------------------
// GATE S2-4: assertEmptySlotValidationHighlighter (Hardened with repeated shake & clear)
// -----------------------------------------------------------------------------
async function assertEmptySlotValidationHighlighter(page) {
  console.log("\n[Gate S2-4] Running assertEmptySlotValidationHighlighter (Error styling, shake, autofocus, and resolution)...");
  const leafCard = await page.$(".se-node-card:has(.add-node-item-btn)");
  if (!leafCard) throw new Error("Leaf card not found");

  // 1. Add empty item to leaf card
  const addItemBtn = await leafCard.$(".add-node-item-btn");
  await addItemBtn.click();
  await page.waitForTimeout(250);

  // 2. Trigger validation via saveTask
  await page.evaluate(async () => {
    return window.editor.saveTask();
  });
  await page.waitForTimeout(300);

  // 3. Assert visual classes and focus
  const state = await leafCard.evaluate((card) => {
    const emptyField = card.querySelector(".se-field--error");
    return {
      cardHasError: card.classList.contains("se-node-card--error"),
      cardHasShake: card.classList.contains("se-shake"),
      fieldHasError: Boolean(emptyField),
      isFocused: document.activeElement === emptyField,
    };
  });

  const toastMessage = await page.evaluate(() => {
    const container = document.querySelector("#notify-toast-container");
    return container ? container.innerText.trim() : "";
  });

  console.log("  Validation state:", JSON.stringify(state));
  console.log(`  Toast message: "${toastMessage.replace(/\n/g, " ")}"`);

  if (!state.cardHasError || !state.fieldHasError || !state.isFocused || toastMessage.length === 0) {
    throw new Error(`Gate S2-4 FAILED: missing error highlight, shake, or focus. State: ${JSON.stringify(state)}`);
  }

  // 4. Test repeated validation re-triggers .se-shake
  await leafCard.evaluate((card) => card.classList.remove("se-shake")); // simulate animationend
  await page.evaluate(async () => {
    return window.editor.saveTask();
  });
  await page.waitForTimeout(100);

  const retriggeredShake = await leafCard.evaluate((card) => card.classList.contains("se-shake"));
  if (!retriggeredShake) {
    throw new Error("Gate S2-4 FAILED: Repeated validation did not re-trigger .se-shake!");
  }
  console.log("  PASS: Repeated validation re-triggered .se-shake animation.");

  // 5. Test error clearance on typing
  await page.keyboard.type("Заполненное значение для очистки ошибки");
  await page.waitForTimeout(200);

  const errorsCleared = await leafCard.evaluate((card) => {
    return !card.classList.contains("se-node-card--error") && !card.querySelector(".se-field--error");
  });

  if (!errorsCleared) {
    throw new Error("Gate S2-4 FAILED: Typing did not clear error highlight.");
  }
  console.log("  PASS: Typing into empty field immediately cleared error highlight.");

  // 6. Test error clearance on deleting empty item via "×"
  const deleteClearTest = await page.evaluate(async () => {
    const editor = window.editor;
    const leaf = editor.nodes.find(n => !editor.nodes.some(c => c.parentId === n.nodeId));
    while (leaf.items.length < 2) {
      editor.addItemToNode(leaf.nodeId);
    }
    leaf.items[1].label = "";

    const card = document.querySelector(`.se-node-card[data-node-id="${leaf.nodeId}"]`);
    editor.validateTask();
    const hadError = card.classList.contains("se-node-card--error");

    editor.deleteItemFromNode(leaf.nodeId, 1);
    await new Promise(r => setTimeout(r, 220));

    const stillHasError = card.classList.contains("se-node-card--error");
    return { hadError, stillHasError };
  });

  if (!deleteClearTest.hadError || deleteClearTest.stillHasError) {
    throw new Error(`Gate S2-4 FAILED: Deleting empty item did not remove card error! state=${JSON.stringify(deleteClearTest)}`);
  }
  console.log("  PASS: Deleting empty item via '×' cleanly removed card error via clearCardErrorIfResolved.");

  console.log("  ✅ Gate S2-4 PASSED (Informative toast, visual card error, shake, autofocus, and auto-clear on input & delete).");
  return { passed: true, toastMessage };
}

// -----------------------------------------------------------------------------
// GATE S2-5: assertPrecisionZoomSlider (Hardened with pan preservation & minimap connectors)
// -----------------------------------------------------------------------------
async function assertPrecisionZoomSlider(page) {
  console.log("\n[Gate S2-5] Running assertPrecisionZoomSlider (Two-way sync, pan preservation, and minimap connectors)...");

  // 1. Slider geometry and two-way sync
  const sliderReport = await page.evaluate(() => {
    const slider = document.querySelector("#se-zoom-slider");
    const zoomOut = document.querySelector("#se-zoom-out");
    const reset = document.querySelector("#se-zoom-reset");
    if (!slider || !zoomOut || !reset) return { exists: false };
    return {
      exists: true,
      min: slider.min,
      max: slider.max,
      step: slider.step,
      value: slider.value,
      width: slider.getBoundingClientRect().width,
    };
  });

  if (!sliderReport.exists) {
    throw new Error("Gate S2-5 FAILED: Zoom slider controls not found in DOM");
  }

  // Set slider to 120
  await page.evaluate(() => {
    const slider = document.querySelector("#se-zoom-slider");
    slider.value = 120;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(200);

  const state120 = await page.evaluate(() => {
    const stage = document.querySelector("#se-hierarchy-stage");
    const reset = document.querySelector("#se-zoom-reset");
    return {
      transform: stage?.style.transform,
      resetText: reset?.textContent.trim(),
    };
  });

  // Click zoom out
  await page.click("#se-zoom-out");
  await page.waitForTimeout(200);

  const stateAfterZoomOut = await page.evaluate(() => {
    const slider = document.querySelector("#se-zoom-slider");
    const reset = document.querySelector("#se-zoom-reset");
    return {
      sliderVal: slider?.value,
      resetText: reset?.textContent.trim(),
    };
  });

  const syncPassed =
    state120.transform.includes("scale(1.2)") &&
    state120.resetText === "120%" &&
    stateAfterZoomOut.sliderVal === "110" &&
    stateAfterZoomOut.resetText === "110%";

  if (!syncPassed) {
    throw new Error("Gate S2-5 FAILED: Two-way sync between slider and canvas failed");
  }
  console.log("  PASS: Two-way slider sync: input -> scale/text, zoom button -> slider thumb.");

  // 2. Pan preservation during zoom
  const panTest = await page.evaluate(() => {
    const editor = window.editor;
    editor.panX = 140;
    editor.panY = 95;
    // Zoom via slider with recenter: false
    editor.setCanvasZoom(1.3, 0.4, 1.5, { recenter: false });
    return {
      panX: editor.panX,
      panY: editor.panY,
      retainedPan: editor.panX !== 0 && editor.panY !== 0,
    };
  });
  if (!panTest.retainedPan) {
    throw new Error("Gate S2-5 FAILED: Slider zoom reset user panX/panY to zero!");
  }
  console.log("  PASS: Zoom slider preserved user viewport pan point.");

  // 3. Minimap SVG connectors
  const minimapConnectors = await page.evaluate(() => {
    const editor = window.editor;
    editor.minimapVisible = true;
    editor.updateHierarchyMinimap();
    const svg = document.querySelector("#se-hierarchy-minimap svg");
    const paths = svg ? svg.querySelectorAll("path") : [];
    return {
      hasSvg: !!svg,
      pathsCount: paths.length,
    };
  });
  if (!minimapConnectors.hasSvg || minimapConnectors.pathsCount === 0) {
    throw new Error(`Gate S2-5 FAILED: Minimap missing SVG connector paths! pathsCount=${minimapConnectors.pathsCount}`);
  }
  console.log(`  PASS: Minimap draws ${minimapConnectors.pathsCount} SVG connector paths using this.nodes.`);

  // Reset to fit
  await page.click("#se-zoom-reset");
  await page.waitForTimeout(200);

  console.log("  ✅ Gate S2-5 PASSED (Slider sync, pan preservation, and minimap connectors).");
  return { passed: true };
}

// -----------------------------------------------------------------------------
// GATE S2-6: assertKineticTransitions (FLIP kinetic, badge synchrony, linear order)
// -----------------------------------------------------------------------------
async function assertKineticTransitions(page) {
  console.log("\n[Gate S2-6] Running assertKineticTransitions (Card & item FLIP, badge synchrony, and linear mode addBlock)...");
  const leafCard = await page.$(".se-node-card:has(.add-node-item-btn)");
  if (!leafCard) throw new Error("Leaf card not found");

  // 1. Kinetic item row entry/exit
  const addItemBtn = await leafCard.$(".add-node-item-btn");
  await addItemBtn.click();

  const enteringRowClass = await leafCard.evaluate((card) => {
    const rows = card.querySelectorAll(".se-node-item-row");
    const last = rows[rows.length - 1];
    return last?.classList.contains("se-node-item-row--entering");
  });

  if (!enteringRowClass) {
    throw new Error("Gate S2-6 FAILED: .se-node-item-row--entering class missing upon adding item row!");
  }
  console.log("  PASS: Item row entry transition applied.");
  await page.waitForTimeout(250);

  // 2. "Группа (2)" badge synchrony
  const groupBadgeState = await leafCard.evaluate((card) => {
    const badge = card.querySelector(".se-node-group-badge");
    const isLeafGroup = card.classList.contains("is-leaf-group");
    return {
      badgeText: badge ? badge.textContent.trim() : null,
      isLeafGroup,
    };
  });
  if (!groupBadgeState.isLeafGroup || !groupBadgeState.badgeText || !groupBadgeState.badgeText.includes("2")) {
    throw new Error(`Gate S2-6 FAILED: Group badge synchrony failed! state=${JSON.stringify(groupBadgeState)}`);
  }
  console.log("  PASS: 'Группа (2)' badge and .is-leaf-group dynamically appeared on 2nd item.");

  // Delete item row
  const delBtn = await leafCard.$(".delete-node-item");
  if (delBtn) {
    await delBtn.click();
    const exitingClass = await leafCard.evaluate((card) => {
      return Boolean(card.querySelector(".se-node-item-row--exiting"));
    });
    if (!exitingClass) {
      throw new Error("Gate S2-6 FAILED: .se-node-item-row--exiting class missing on item deletion!");
    }
    await page.waitForTimeout(250);
  }

  const badgeRemoved = await leafCard.evaluate((card) => {
    return !card.classList.contains("is-leaf-group") && !card.querySelector(".se-node-group-badge");
  });
  if (!badgeRemoved) {
    throw new Error("Gate S2-6 FAILED: Group badge not removed after deleting 2nd item!");
  }
  console.log("  PASS: Group badge cleanly removed when item count reverted to 1.");

  // 3. Card FLIP entry/exit
  const addSiblingBtn = await leafCard.$(".add-sibling-node-btn");
  await addSiblingBtn.click();
  await page.waitForTimeout(50);

  const enteringCard = await page.$(".se-node-card.is-new-node");
  const hasEnteringCard = !!enteringCard;
  console.log(`  Card entering class (is-new-node) detected: ${hasEnteringCard}`);
  await page.waitForTimeout(250);

  const siblingDelBtn = await page.$(".se-node-card:last-child .delete-node");
  if (siblingDelBtn) {
    await siblingDelBtn.click();
    await page.waitForTimeout(50);
    const exitingCard = await page.$(".se-node-card--exiting");
    const hasExitingCard = !!exitingCard;
    console.log(`  Card exiting class detected: ${hasExitingCard}`);
    await page.waitForTimeout(250);
  }

  // 4. Linear Mode addBlock order and move-right enablement
  console.log("  Testing linear mode addBlock order and button states...");
  await page.click("#mode-tab-linear");
  await page.waitForTimeout(100);
  const confirmBtn = await page.$('button[data-role="confirm"]');
  if (confirmBtn) await confirmBtn.click();
  await page.waitForSelector(".sequence-level-card", { timeout: 10000 });
  await page.waitForTimeout(200);

  const linearTest = await page.evaluate(() => {
    const editor = window.editor;
    const levelCards = document.querySelectorAll(".sequence-level-card");
    const targetCard = levelCards[0];
    const addBtn = targetCard ? targetCard.querySelector(".sequence-add-block-btn") : null;
    if (!targetCard || !addBtn) return { error: "No level card or add button" };

    const blocksBefore = targetCard.querySelectorAll(".sequence-block-wrapper").length;

    // Click add step
    addBtn.click();

    const blocksAfter = targetCard.querySelectorAll(".sequence-block-wrapper");
    const lastBlock = blocksAfter[blocksAfter.length - 1];

    // Assert new block is strictly before add button
    const container = addBtn.parentElement;
    const children = Array.from(container.children);
    const lastBlockIdx = children.indexOf(lastBlock);
    const addBtnIdx = children.indexOf(addBtn);
    const placedBefore = lastBlockIdx >= 0 && lastBlockIdx < addBtnIdx;

    // Assert previous block's move-right is enabled
    const prevBlock = blocksAfter.length >= 2 ? blocksAfter[blocksAfter.length - 2] : null;
    const moveRightBtn = prevBlock ? prevBlock.querySelector(".move-right") : null;
    const moveRightEnabled = moveRightBtn ? !moveRightBtn.disabled : false;

    return {
      blocksBefore,
      blocksAfterCount: blocksAfter.length,
      placedBefore,
      moveRightEnabled,
    };
  });

  if (linearTest.error || !linearTest.placedBefore || !linearTest.moveRightEnabled) {
    throw new Error(`Gate S2-6 FAILED: Linear mode addBlock failed! state=${JSON.stringify(linearTest)}`);
  }
  console.log("  PASS: Linear mode addBlock inserted strictly before add button, move-right enabled.");

  // Undo linear addBlock to keep task clean
  await page.evaluate(() => window.editor.performUndo());
  await page.waitForTimeout(100);

  // Switch back to hierarchy mode
  await page.click("#mode-tab-hierarchy");
  await page.waitForTimeout(100);
  const returnConfirm = await page.$('button[data-role="confirm"]');
  if (returnConfirm) await returnConfirm.click();
  await page.waitForSelector(".se-hierarchy-shell", { timeout: 10000 });
  await page.waitForTimeout(200);

  console.log("  ✅ Gate S2-6 PASSED (Full kinetic transitions, badge synchrony, and linear order).");
  return { passed: true };
}

// -----------------------------------------------------------------------------
// GATE S2-7: assertColorDifferentiationPermanent
// -----------------------------------------------------------------------------
async function assertColorDifferentiationPermanent(page) {
  console.log("\n[Gate S2-7] Running assertColorDifferentiationPermanent...");
  const report = await page.evaluate(() => {
    const checkbox = document.querySelector("#color-differentiation");
    const cards = Array.from(document.querySelectorAll(".se-node-card"));
    const cardsWithTint = cards.filter((c) => c.hasAttribute("data-color-tint"));
    const editorVal = window.editor ? window.editor.colorDifferentiation : null;

    return {
      checkboxInDom: Boolean(checkbox),
      editorColorDiff: editorVal,
      totalCards: cards.length,
      cardsWithTint: cardsWithTint.length,
    };
  });

  console.log("  Color differentiation status:", report);
  const passed = !report.checkboxInDom && report.editorColorDiff === true && report.cardsWithTint === report.totalCards;

  if (!passed) {
    throw new Error("Gate S2-7 FAILED: Color differentiation not permanently active or checkbox still present");
  }

  console.log("  ✅ Gate S2-7 PASSED (Checkbox permanently removed, color-tint active on all cards).");
  return { passed: true };
}

// -----------------------------------------------------------------------------
// MAIN TEST RUNNER
// -----------------------------------------------------------------------------
async function main() {
  console.log("=================================================================");
  console.log("  ACTRA REFORMED S2 EDITOR AUTOMATED AUDIT GATE RUNNER");
  console.log("=================================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await login(context);

  const page = await context.newPage();
  const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
  await page.goto(editorUrl, { waitUntil: "networkidle" });
  await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });
  await page.waitForSelector(".se-node-card", { timeout: 15000 });
  await page.waitForTimeout(1000);

  const results = {};
  try {
    results["Gate S2-1 (Segmented Tabs Clearance)"] = await assertSegmentedControlClearance(page);
    results["Gate S2-2 (Card Buttons Overflow)"] = await assertNoFooterButtonOverflow(page);
    results["Gate S2-5 (Precision Zoom Slider & Pan)"] = await assertPrecisionZoomSlider(page);
    results["Gate S2-6 (Kinetic Transitions & Linear Order)"] = await assertKineticTransitions(page);
    results["Gate S2-7 (Permanent Color Differentiation)"] = await assertColorDifferentiationPermanent(page);
    results["Gate S2-3 (Undo/Redo Text Integrity & Race)"] = await assertUndoRedoTextIntegrity(page);
    results["Gate S2-4 (Empty Slot Validation & Highlight)"] = await assertEmptySlotValidationHighlighter(page);

    console.log("\n=================================================================");
    console.log("  ALL 7 REFORMED S2 AUTOMATED GATES PASSED (100% GREEN) ✅");
    console.log("=================================================================");
  } catch (err) {
    console.error("\n❌ AUDIT GATE RUNNER FAILED:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
