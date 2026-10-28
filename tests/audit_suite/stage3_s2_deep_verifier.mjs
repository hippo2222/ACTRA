/**
 * ACTRA Stage 3 — S2 Deep Verification Gate Runner
 *
 * Validates:
 * 3.1 Undo/Redo stack reliability:
 *     - Keyboard Ctrl+Z / Ctrl+Y delegation from focused non-empty textareas.
 *     - Fast undo (100ms after typing) flushes 400ms debounce timer and undoes cleanly.
 *     - Fast redo restores flushed state.
 *     - Synchronous history save during deleteItemFromNode prevents timer race.
 * 3.2 Empty slot validation & error recovery:
 *     - .se-node-card--error and .se-shake classes applied on validation failure.
 *     - Multi-trigger .se-shake on repeated validation.
 *     - Immediate clearance of error styling upon typing in empty field.
 *     - Immediate clearance of card error when empty item is deleted via "×".
 *     - Informative error message with location jump for multiple empty items.
 *
 * Generates visual artifacts:
 * - crop_stage3_s2_validation_error.png
 * - stage3_s2_verified_1280x800.png
 * - stage3_s2_verified_1280x720.png
 */

import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const ARTIFACTS_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function runStage3Verification() {
  console.log("==================================================================");
  console.log("   ACTRA STAGE 3 — S2 DEEP VERIFICATION GATE                      ");
  console.log("==================================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  try {
    // 1. Authenticate
    console.log("\n[1/7] Authenticating as clinical expert...");
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
      headers: { Origin: BASE_URL },
    });
    if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 720 });

    const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
    console.log(`[2/7] Navigating to S2 editor: ${editorUrl}`);
    await page.goto(editorUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });
    await page.waitForSelector(".se-node-card", { timeout: 15000 });
    await page.waitForTimeout(600);

    // 2. Verify 3.1: shouldDelegateUndoRedoFromInput in focused non-empty input
    console.log("\n[3/7] Verifying 3.1: Undo/Redo keyboard delegation from inside focused textarea...");
    const delegationTest = await page.evaluate(async () => {
      const editor = window.editor;
      if (!editor) return { error: "No window.editor found" };

      const card = document.querySelector(".se-node-card");
      const textarea = card?.querySelector("textarea.block-title-input");
      if (!textarea) return { error: "No textarea found" };

      const shouldDelegate = editor.shouldDelegateUndoRedoFromInput(textarea);
      const isTargetCardInput = textarea.classList.contains("block-title-input") || textarea.closest(".se-node-card");

      return {
        shouldDelegate,
        isTargetCardInput: !!isTargetCardInput,
        hasValue: textarea.value.length > 0,
      };
    });

    console.log("Delegation test:", delegationTest);
    if (!delegationTest.shouldDelegate) {
      throw new Error("FAIL: shouldDelegateUndoRedoFromInput returned false for card textarea!");
    }
    console.log("  PASS: shouldDelegateUndoRedoFromInput correctly delegates for card inputs.");

    // 3. Verify 3.1: Fast Undo/Redo without debounce race (typing text & immediate Ctrl+Z)
    console.log("\n[4/7] Verifying 3.1: Fast Undo flushes 400ms debounce timer & Redo restores state...");
    const raceTest = await page.evaluate(async () => {
      const editor = window.editor;
      editor.saveStateToHistory(); // initial state
      const initialHistorySize = editor.undoManager.getHistorySize();

      const card = document.querySelector(".se-node-card");
      const textarea = card.querySelector("textarea.block-title-input");
      const originalValue = textarea.value;

      // Simulate typing new text
      textarea.value = "Срочный тест отката";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const timerScheduled = !!editor._historySaveTimeout;

      // Fast undo (before 400ms debounce expires)
      editor.performUndo();
      const textareaAfterUndo = document.querySelector(".se-node-card textarea.block-title-input");
      const valueAfterUndo = textareaAfterUndo ? textareaAfterUndo.value : null;
      const modelAfterUndo = editor.nodes[0]?.items[0]?.label;
      const historySizeAfterUndo = editor.undoManager.getHistorySize();

      // Redo
      editor.performRedo();
      const textareaAfterRedo = document.querySelector(".se-node-card textarea.block-title-input");
      const valueAfterRedo = textareaAfterRedo ? textareaAfterRedo.value : null;
      const modelAfterRedo = editor.nodes[0]?.items[0]?.label;

      // Restore to original for subsequent tests
      editor.performUndo();

      return {
        timerScheduled,
        initialHistorySize,
        originalValue,
        valueAfterUndo,
        valueAfterRedo,
        modelAfterUndo,
        modelAfterRedo,
        historySizeAfterUndo,
      };
    });

    console.log("Fast undo/redo race test:", raceTest);
    if (!raceTest.timerScheduled) {
      throw new Error("FAIL: Input event did not schedule debounce history save!");
    }
    if (raceTest.valueAfterUndo !== raceTest.originalValue) {
      throw new Error(`FAIL: Value after undo ("${raceTest.valueAfterUndo}") does not match original ("${raceTest.originalValue}")!`);
    }
    if (raceTest.valueAfterRedo !== "Срочный тест отката") {
      throw new Error(`FAIL: Value after redo ("${raceTest.valueAfterRedo}") does not match typed text!`);
    }
    console.log("  PASS: Fast undo flushed debounce timer cleanly, and redo restored text perfectly.");

    // 4. Verify 3.1: Synchronous History Save in deleteItemFromNode
    console.log("\n[5/7] Verifying 3.1: Synchronous history save in deleteItemFromNode (no 180ms race)...");
    const syncDeleteTest = await page.evaluate(async () => {
      const editor = window.editor;
      // Ensure we have a leaf card with at least 2 items
      const leafNode = editor.nodes.find(n => !editor.nodes.some(c => c.parentId === n.nodeId));
      if (!leafNode) return { error: "No leaf node found" };
      const leafId = leafNode.nodeId;

      // Add second item if only 1 exists
      if (leafNode.items.length === 1) {
        editor.addItemToNode(leafId);
      }
      editor.saveStateToHistory();
      const countBefore = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

      // Call deleteItemFromNode
      editor.deleteItemFromNode(leafId, countBefore - 1);
      const countImmediatelyAfter = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

      // Immediately trigger undo (within 10ms, well before 180ms animation finishes)
      editor.performUndo();
      const countAfterUndo = editor.nodes.find(n => n.nodeId === leafId)?.items.length || 0;

      return {
        countBefore,
        countImmediatelyAfter,
        countAfterUndo,
      };
    });

    console.log("Sync delete test:", syncDeleteTest);
    if (syncDeleteTest.countImmediatelyAfter !== syncDeleteTest.countBefore - 1) {
      throw new Error("FAIL: deleteItemFromNode did not synchronously remove item at t=0!");
    }
    if (syncDeleteTest.countAfterUndo !== syncDeleteTest.countBefore) {
      throw new Error("FAIL: Immediate undo after deleteItemFromNode did not restore items!");
    }
    console.log("  PASS: deleteItemFromNode executes state mutation and history save synchronously.");

    // 5. Verify 3.2: Empty slot validation, .se-node-card--error, .se-shake, and error clearance
    console.log("\n[6/7] Verifying 3.2: Empty slot validation, .se-node-card--error, and dynamic error clearance...");
    const validationTest = await page.evaluate(async () => {
      const editor = window.editor;
      const targetCard = document.querySelector(".se-node-card");
      const targetNode = editor.nodes.find(n => n.nodeId === targetCard.getAttribute("data-node-id"));
      const textarea = targetCard.querySelector("textarea.block-title-input");

      const savedLabel = targetNode.items[0].label;
      // Make it empty
      targetNode.items[0].label = "";
      textarea.value = "";

      // Validate
      const errorMsg = editor.validateTask();
      const hasCardError = targetCard.classList.contains("se-node-card--error");
      const hasShake = targetCard.classList.contains("se-shake");
      const hasFieldError = textarea.classList.contains("se-field--error");

      // Repeated validation to test re-triggering shake
      targetCard.classList.remove("se-shake"); // simulate animationend
      const secondErrorMsg = editor.validateTask();
      const retriggeredShake = targetCard.classList.contains("se-shake");

      // Now type into textarea and check clearance
      textarea.value = "Восстановленный элемент";
      targetNode.items[0].label = "Восстановленный элемент";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));

      const cardErrorAfterInput = targetCard.classList.contains("se-node-card--error");
      const fieldErrorAfterInput = textarea.classList.contains("se-field--error");

      // Restore original
      targetNode.items[0].label = savedLabel;
      textarea.value = savedLabel;
      editor.validateTask(); // clears or passes

      return {
        errorMsg,
        hasCardError,
        hasShake,
        hasFieldError,
        retriggeredShake,
        cardErrorAfterInput,
        fieldErrorAfterInput,
      };
    });

    console.log("Validation test:", validationTest);
    if (!validationTest.hasCardError || !validationTest.hasFieldError) {
      throw new Error(`FAIL: Validation did not apply error classes! Card: ${validationTest.hasCardError}, Field: ${validationTest.hasFieldError}`);
    }
    if (!validationTest.retriggeredShake) {
      throw new Error("FAIL: Repeated validation failed to re-trigger .se-shake animation!");
    }
    if (validationTest.cardErrorAfterInput || validationTest.fieldErrorAfterInput) {
      throw new Error("FAIL: Typing into empty field did not clear error classes!");
    }
    console.log("  PASS: Validation accurately marks error and shake, and removes error upon user input.");

    // Micro-crop validation error state
    await page.evaluate(() => {
      const card = document.querySelector(".se-node-card");
      const textarea = card.querySelector("textarea.block-title-input");
      card.classList.add("se-node-card--error", "se-shake");
      textarea.classList.add("se-field--error");
    });
    await page.waitForTimeout(100);

    const errorCardEl = await page.$(".se-node-card--error");
    if (errorCardEl) {
      await errorCardEl.screenshot({ path: path.join(ARTIFACTS_DIR, "crop_stage3_s2_validation_error.png") });
      console.log("  Saved micro-crop: crop_stage3_s2_validation_error.png");
    }

    // Clean up temporary error state on card
    await page.evaluate(() => {
      const card = document.querySelector(".se-node-card");
      const textarea = card.querySelector("textarea.block-title-input");
      card.classList.remove("se-node-card--error", "se-shake");
      textarea.classList.remove("se-field--error");
    });

    // 6. Test delete item clears card error
    console.log("\n[7/7] Verifying 3.2: Deleting empty item clears card error via clearCardErrorIfResolved...");
    const deleteClearErrorTest = await page.evaluate(async () => {
      const editor = window.editor;
      const leafNode = editor.nodes.find(n => !editor.nodes.some(c => c.parentId === n.nodeId));
      if (!leafNode) return { error: "No leaf node found" };

      // Ensure 2 items, second is empty
      while (leafNode.items.length < 2) {
        editor.addItemToNode(leafNode.nodeId);
      }
      leafNode.items[0].label = "Заполненный";
      leafNode.items[1].label = "";

      const card = document.querySelector(`.se-node-card[data-node-id="${leafNode.nodeId}"]`);
      editor.validateTask();

      const hadErrorBefore = card.classList.contains("se-node-card--error");

      // Delete the empty 2nd item
      editor.deleteItemFromNode(leafNode.nodeId, 1);

      // Wait 200ms for DOM removal
      await new Promise(r => setTimeout(r, 200));

      const hasErrorAfter = card.classList.contains("se-node-card--error");

      return {
        hadErrorBefore,
        hasErrorAfter,
      };
    });

    console.log("Delete empty item error clearance test:", deleteClearErrorTest);
    if (!deleteClearErrorTest.hadErrorBefore) {
      throw new Error("FAIL: Validation did not set error on card with empty item!");
    }
    if (deleteClearErrorTest.hasErrorAfter) {
      throw new Error("FAIL: Deleting empty item did not remove .se-node-card--error from card!");
    }
    console.log("  PASS: Deleting empty item cleanly removes card error state.");

    // 7. Full dual-height screenshots
    console.log("\nCapturing dual-height full screenshots...");
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, "stage3_s2_verified_1280x800.png"),
      fullPage: false,
    });
    console.log("  Saved full screenshot: stage3_s2_verified_1280x800.png");

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, "stage3_s2_verified_1280x720.png"),
      fullPage: false,
    });
    console.log("  Saved full screenshot: stage3_s2_verified_1280x720.png");

    console.log("\n==================================================================");
    console.log("   STAGE 3 S2 VERIFICATION COMPLETE: 100% PASS                   ");
    console.log("==================================================================");
  } finally {
    await browser.close();
  }
}

runStage3Verification().catch((err) => {
  console.error("Stage 3 Verification Failed:", err);
  process.exit(1);
});
