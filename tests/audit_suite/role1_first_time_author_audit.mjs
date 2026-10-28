/**
 * ACTRA Stage 5.4.2 — Role 1 Audit Runner: First-Time Author (Junior Methodist)
 * Strict compliance with Rule 11 (AGENTS.md)
 * Focus: Blank state, onboarding clarity, human copy (zero tech slop),
 * node/tier creation flow, and Data Loss Prevention (DLP) dialogues.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/stage5_matrix/role1_author");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const role1Results = {
  assertions: [],
  screenshots: [],
  findings: [],
  summary: { passed: 0, failed: 0 },
};

function recordAssertion(name, pass, details = "") {
  role1Results.assertions.push({ name, pass, details });
  if (pass) {
    role1Results.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? "— " + details : ""}`);
  } else {
    role1Results.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function runRole1Audit() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.4.2: Role 1 Audit — First-Time Author (Junior Methodist)");
  console.log("   ================================================================\n");

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

  // Login as author
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Auth: Login as Author", loginResp.ok(), `Status ${loginResp.status()}`);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;

  try {
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });

    // -------------------------------------------------------------------------
    // 1. ПЕРВОЕ ВПЕЧАТЛЕНИЕ И АФФОРДАНСЫ РЕДАКТИРОВАНИЯ
    // -------------------------------------------------------------------------
    console.log("\n  [1] Первое впечатление и аффордансы...");
    
    // Check main action buttons in toolbar
    const addTierBtn = page.locator(".add-tier-top-btn");
    const addColumnBtn = page.locator(".add-root-node-btn");
    
    recordAssertion(
      "Affordance: Кнопка '+ Добавить этаж (параметр)' видима в тулбаре",
      (await addTierBtn.count()) > 0 && (await addTierBtn.isVisible()),
      "Первичная кнопка добавления уровня на месте"
    );
    recordAssertion(
      "Affordance: Кнопка '+ Колонка' видима в тулбаре",
      (await addColumnBtn.count()) > 0 && (await addColumnBtn.isVisible()),
      "Кнопка добавления колонки дерева на месте"
    );

    // Check tier cell affordance
    const tierInput = page.locator(".se-tier-cell .level-title-input").first();
    const tierInputBox = await tierInput.boundingBox();
    const tierPlaceholder = await tierInput.getAttribute("placeholder");
    
    recordAssertion(
      "Zero-Placeholder: Наличие понятного плейсхолдера в ячейке этажа",
      Boolean(tierPlaceholder && tierPlaceholder.length > 5),
      `Placeholder: "${tierPlaceholder}"`
    );

    // Check node action buttons
    const addChildBtn = page.locator(".add-child-node-btn").first();
    const addSiblingBtn = page.locator(".add-sibling-node-btn").first();
    const addGroupItemBtn = page.locator(".add-node-item-btn").first();

    recordAssertion(
      "Affordance: Кнопка '+ Ветка ↓' присутствует на карточке узла",
      (await addChildBtn.count()) > 0,
      "Кнопка создания дочернего разветвления доступна"
    );
    recordAssertion(
      "Affordance: Кнопка '+ Ветка →' присутствует на карточке узла",
      (await addSiblingBtn.count()) > 0,
      "Кнопка создания параллельной ветки доступна"
    );

    const shot1 = path.join(OUT_DIR, "role1_initial_overview.png");
    await page.screenshot({ path: shot1 });
    role1Results.screenshots.push(shot1);

    // -------------------------------------------------------------------------
    // 2. ИНТЕРАКТИВНОЕ СОЗДАНИЕ ВЕТКИ И ВВОД ТЕКСТА
    // -------------------------------------------------------------------------
    console.log("\n  [2] Интерактивное создание узлов и редактирование...");

    const initialNodeCount = await page.locator(".se-node-card").count();
    
    // Click Add Sibling Branch on the first node
    await addSiblingBtn.click();
    await page.waitForTimeout(200);

    const newNodeCount = await page.locator(".se-node-card").count();
    recordAssertion(
      "Author Flow: Добавление новой параллельной ветки (+ Ветка →)",
      newNodeCount > initialNodeCount,
      `Узлов было: ${initialNodeCount}, стало: ${newNodeCount}`
    );

    // Verify unsaved indicator triggers
    const saveStatusText = (await page.locator("#save-status-text").textContent() || "").trim();
    recordAssertion(
      "DLP: Индикация несохраненных изменений после добавления узла",
      saveStatusText.includes("Не сохранено") || saveStatusText.includes("не сохранено"),
      `Статус: "${saveStatusText}"`
    );

    // Type text into the new node textarea
    const lastNodeInput = page.locator(".se-node-card .se-node-item-input").last();
    await lastNodeInput.fill("Тестовый клинический признак автора");
    await page.waitForTimeout(100);

    const shot2 = path.join(OUT_DIR, "role1_after_node_creation.png");
    await page.screenshot({ path: shot2 });
    role1Results.screenshots.push(shot2);

    // -------------------------------------------------------------------------
    // 3. ЗАЩИТА ОТ ПОТЕРИ ДАННЫХ (DATA LOSS PREVENTION / DLP GATE)
    // -------------------------------------------------------------------------
    console.log("\n  [3] Тестирование Data Loss Prevention (DLP)...");

    // Click mode switch to Linear: must trigger confirm modal
    const linearTab = page.locator("#mode-tab-linear");
    await linearTab.click();
    await page.waitForTimeout(200);

    // Check if confirm modal / dialog appeared
    const confirmModal = page.locator(".modal-backdrop, .confirm-dialog, [role='dialog'], .custom-confirm");
    const isModalOpen = (await confirmModal.count()) > 0 && (await confirmModal.first().isVisible());
    
    recordAssertion(
      "DLP Gate: Модальное предупреждение при переключении режима (Защита от сброса)",
      isModalOpen,
      isModalOpen ? "Диалог подтверждения переключения режима появился" : "Диалог не обнаружен!"
    );

    if (isModalOpen) {
      const shot3 = path.join(OUT_DIR, "role1_dlp_confirm_dialog.png");
      await page.screenshot({ path: shot3 });
      role1Results.screenshots.push(shot3);

      // Cancel mode switch to preserve data
      const cancelBtn = page.locator("button:has-text('Отмена'), button:has-text('Назад'), .modal-cancel-btn").first();
      if ((await cancelBtn.count()) > 0) {
        await cancelBtn.click();
        await page.waitForTimeout(150);
      }
    }

    // -------------------------------------------------------------------------
    // 4. ТЕРМИНОЛОГИЯ И ЧЕЛОВЕКОПОНЯТНОСТЬ (ANTI-MACHINE SLOP)
    // -------------------------------------------------------------------------
    console.log("\n  [4] Анализ терминологии и машинного сленга...");

    const forbiddenTechWords = [
      "SEQUENCE_ASSEMBLY",
      "level_id",
      "node_id",
      "parent_id",
      "colSpan",
      "colStart",
      "slots",
      "blocks",
      "null",
      "undefined",
      "payload",
      "DTO",
    ];

    const bodyText = await page.evaluate(() => document.body.innerText);
    const leakedWords = forbiddenTechWords.filter((word) => bodyText.includes(word));

    recordAssertion(
      "Anti-Machine Slop: Полное отсутствие технического сленга программистов в UI",
      leakedWords.length === 0,
      leakedWords.length === 0 ? "Терминология чиста и дружелюбна" : `Обнаружен сленг: ${leakedWords.join(", ")}`
    );

  } finally {
    await browser.close();
  }

  console.log("\n================================================================");
  console.log(`   Stage 5.4.2 Role 1 Audit: ${role1Results.summary.passed} Passed, ${role1Results.summary.failed} Failed`);
  console.log(`   Screenshots saved: ${role1Results.screenshots.length}`);
  console.log("================================================================\n");

  if (role1Results.summary.failed > 0) {
    process.exit(1);
  }
}

runRole1Audit().catch((err) => {
  console.error("FATAL ERROR in runRole1Audit:", err);
  process.exit(1);
});
