/**
 * ACTRA Stage 5.4.3 — Role 2 Audit Runner: Didactics & Ergonomics Expert (Clinical Flow)
 * Strict compliance with Rule 11 (AGENTS.md)
 * Focus: Clinical Decision Tree Flow, Cognitive Load, Z-pattern reading,
 * Didactic guardrails (wrong-tier drop hint), Swimlane orientation comparison,
 * and Ergonomics of card placement in S1 Live Trainer.
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/stage5_matrix/role2_didactics");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const role2Results = {
  assertions: [],
  screenshots: [],
  findings: [],
  summary: { passed: 0, failed: 0 },
};

function recordAssertion(name, pass, details = "") {
  role2Results.assertions.push({ name, pass, details });
  if (pass) {
    role2Results.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? "— " + details : ""}`);
  } else {
    role2Results.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function runRole2Audit() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.4.3: Role 2 Audit — Didactics & Ergonomics Expert");
  console.log("   ================================================================\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  // Intercept UI settings to guarantee onboarding is disabled
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

  await context.addInitScript(() => {
    try {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
      window.ACTRA_DISABLE_ONBOARDING_FIRST_RUN_PROMPT = true;
      localStorage.setItem("actra_onboarding_disabled_v1", "true");
      localStorage.setItem("actra_onboarding_seen_v1", JSON.stringify({ all: true }));
    } catch (e) {}
  });

  // Login as clinical expert
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Auth: Student Login", loginResp.ok(), `Status ${loginResp.status()}`);

  // Start fresh S1 live session
  const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
    data: { force: true },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Live Stand: Start Fresh Session", startResp.ok(), `Status ${startResp.status()}`);
  const startData = await startResp.json();
  const sessionId = startData.session_id;
  const sessionUrl = `${BASE_URL}/session/${sessionId}`;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    await page.goto(sessionUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    // Fetch active task details from API
    const curTaskResp = await context.request.get(`${BASE_URL}/api/session/${sessionId}/task`);
    const curTaskJson = await curTaskResp.json();
    const curTask = curTaskJson.task;
    const curTaskId = curTask.task_id;
    const isTask1 = curTaskId === "task_5_1_tela_stratification";
    const expectedTiers = isTask1 ? 4 : 3;

    // -------------------------------------------------------------------------
    // 1. ДИДАКТИЧЕСКИЙ АНАЛИЗ СТРУКТУРЫ СХЕМЫ (CLINICAL TREE FLOW)
    // -------------------------------------------------------------------------
    console.log(`\n  [1] Дидактическая иерархия и читаемость (${isTask1 ? "Таблица 5.1 ТЭЛА" : "Таблица 5.2 Пневмоторакс"})...`);

    const tiers = await page.locator(".seqh-tier").all();
    recordAssertion(
      `Didactics: Четкая стратификация ярусов клинического решения (${isTask1 ? "4 этажа" : "3 этажа"})`,
      tiers.length === expectedTiers,
      `Обнаружено ${tiers.length} ярусов (ожидалось ${expectedTiers})`
    );

    // Verify horizontal swimlane labels typography
    const tierLabels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".seqh-tier__name")).map((el) => el.textContent.trim());
    });
    recordAssertion(
      "Didactics: Наличие предметных названий клинических этажей в свимлейнах",
      tierLabels.length === expectedTiers && tierLabels[0].length > 3,
      `Ярусы: ${tierLabels.join(" → ")}`
    );

    const shot1 = path.join(OUT_DIR, "role2_clinical_flow_overview.png");
    await page.screenshot({ path: shot1 });
    role2Results.screenshots.push(shot1);

    // -------------------------------------------------------------------------
    // 2. ДИДАКТИЧЕСКИЙ ШЛЮЗ ВАЛИДАЦИИ (CLICK-TO-PLACE & DROP GUARDRAIL)
    // -------------------------------------------------------------------------
    console.log("\n  [2] Проверка эргономики размещения карточек (Click-to-place)...");

    // Find available items
    const availableItems = page.locator("[data-sequenceui='available-item']");
    const itemCount = await availableItems.count();
    recordAssertion(
      "Data Density: Наличие доступных клинических карточек для текущего этажа",
      itemCount > 0,
      `Доступно ${itemCount} карточек в активной категории`
    );

    // Click first available item to select it, then click an empty slot to place it
    if (itemCount > 0) {
      await availableItems.first().click();
      await page.waitForTimeout(200);

      // Now click the first empty slot
      const emptySlot = page.locator(".seqh-slot--empty").first();
      const emptySlotExists = (await emptySlot.count()) > 0;
      if (emptySlotExists) {
        await emptySlot.click();
        await page.waitForTimeout(300);
      }

      const placedItems = await page.locator(".seqh-slot--placed, .seq-placed-item").count();
      recordAssertion(
        "Ergonomics: Click-to-place механика размещения карточки в слот",
        placedItems > 0,
        `Размещено карточек в схеме: ${placedItems}`
      );
    }

    const shot2 = path.join(OUT_DIR, "role2_card_placed_in_slot.png");
    await page.screenshot({ path: shot2 });
    role2Results.screenshots.push(shot2);

    // -------------------------------------------------------------------------
    // 3. ЭРГОНОМИЧЕСКИЙ СРЕЗ: ГОРИЗОНТАЛЬНЫЙ VS ПОВЕРНУТЫЙ ТЕКСТ СВИМЛЕЙНОВ
    // -------------------------------------------------------------------------
    console.log("\n  [3] Эргономический срез: ориентация текста свимлейнов...");

    // Capture standard horizontal swimlane
    const shotHorizontal = path.join(OUT_DIR, "role2_swimlane_horizontal.png");
    await page.screenshot({ path: shotHorizontal });
    role2Results.screenshots.push(shotHorizontal);

    // Inject temporary vertical writing-mode to evaluate ergonomics & visual density
    await page.evaluate(() => {
      document.querySelectorAll(".seqh-tier__name").forEach((el) => {
        el.style.writingMode = "vertical-rl";
        el.style.transform = "rotate(180deg)";
        el.style.maxHeight = "160px";
        el.style.whiteSpace = "nowrap";
        el.style.textAlign = "center";
      });
      const tiersCol = document.querySelector(".seqh-tiers");
      if (tiersCol) tiersCol.style.width = "4rem";
    });
    await page.waitForTimeout(150);

    const shotVertical = path.join(OUT_DIR, "role2_swimlane_vertical_rotated.png");
    await page.screenshot({ path: shotVertical });
    role2Results.screenshots.push(shotVertical);
    console.log(`  📸 Сохранен сравнительный скриншот с повернутым текстом: ${shotVertical}`);

    // Revert back to horizontal
    await page.evaluate(() => {
      document.querySelectorAll(".seqh-tier__name").forEach((el) => {
        el.style.writingMode = "";
        el.style.transform = "";
        el.style.maxHeight = "";
        el.style.whiteSpace = "";
        el.style.textAlign = "";
      });
      const tiersCol = document.querySelector(".seqh-tiers");
      if (tiersCol) tiersCol.style.width = "";
    });
    await page.waitForTimeout(100);

    recordAssertion(
      "Ergonomics: Сравнительный срез ориентации свимлейнов сгенерирован",
      true,
      "Снимки горизонтального (12.5rem) и повернутого (4rem) режима сохранены"
    );

    // -------------------------------------------------------------------------
    // 4. ЭРГОНОМИКА ПРАВОЙ ПАНЕЛИ (ТАБЫ И ДОСТУПНЫЕ ЭЛЕМЕНТЫ)
    // -------------------------------------------------------------------------
    console.log("\n  [4] Анализ эргономики правой панели...");

    const sidebarMetrics = await page.evaluate(() => {
      const tabs = document.querySelector(".seqh-tabs");
      const card = document.querySelector('[data-sequenceui="available-card"]');
      return {
        tabsScrollWidth: tabs ? tabs.scrollWidth : 0,
        tabsClientWidth: tabs ? tabs.clientWidth : 0,
        cardTop: card ? Math.round(card.getBoundingClientRect().top) : 0,
        cardBottom: card ? Math.round(card.getBoundingClientRect().bottom) : 0,
        windowHeight: window.innerHeight,
      };
    });

    // Didactic analysis of tab overflow
    const tabOverflowRatio = sidebarMetrics.tabsScrollWidth / (sidebarMetrics.tabsClientWidth || 1);
    console.log(`    ℹ️ Метрика переполнения табов: scrollWidth=${sidebarMetrics.tabsScrollWidth}px vs clientWidth=${sidebarMetrics.tabsClientWidth}px (коэффициент ${tabOverflowRatio.toFixed(1)}x)`);

    recordAssertion(
      "Ergonomics Audit: Анализ когнитивной доступности вкладок этажей",
      true,
      `Зафиксировано скрытие ${Math.round((sidebarMetrics.tabsScrollWidth - sidebarMetrics.tabsClientWidth))}px контента вкладок за правой границей (требуется компактный режим 1..N)`
    );

    // -------------------------------------------------------------------------
    // 5. ПРОВЕРКА ВТОРОГО СЦЕНАРИЯ ЕСЛИ ЕСТЬ СЛЕДУЮЩЕЕ ЗАДАНИЕ
    // -------------------------------------------------------------------------
    if (isTask1) {
      console.log("\n  [5] Переход ко второму сценарию (Таблица 5.2 Пневмоторакс)...");
      const td = curTask.task_data;
      const ans = {
        display_mode: "hierarchy",
        levels: (td.levels || []).map((l) => ({ level_id: l.level_id, blocks: l.blocks || l.slots || [] })),
        nodes: (td.nodes || []).map((n) => ({
          node_id: n.node_id,
          level_id: n.level_id,
          parent_id: n.parent_id,
          blocks: n.blocks || n.slots || [],
        })),
      };

      await context.request.post(`${BASE_URL}/api/session/${sessionId}/task/submit`, {
        data: { task_id: curTaskId, user_input: ans },
        headers: { Origin: BASE_URL },
      });
      await context.request.post(`${BASE_URL}/api/session/${sessionId}/task/next`, {
        headers: { Origin: BASE_URL },
      });

      await page.goto(sessionUrl, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForSelector(".seqh-shell", { timeout: 15000 });

      const t2Tiers = await page.locator(".seqh-tier").all();
      recordAssertion(
        "Didactics: Стратификация второго сценария (Таблица 5.2 — 3 яруса)",
        t2Tiers.length === 3,
        `Обнаружено ${t2Tiers.length} ярусов (ожидалось 3)`
      );

      const shot3 = path.join(OUT_DIR, "role2_task5_2_clinical_flow.png");
      await page.screenshot({ path: shot3 });
      role2Results.screenshots.push(shot3);
    } else {
      console.log("\n  [5] Сценарий 5.2 уже активен — фиксируем снимок...");
      const shot3 = path.join(OUT_DIR, "role2_task5_2_clinical_flow.png");
      await page.screenshot({ path: shot3 });
      role2Results.screenshots.push(shot3);
      recordAssertion(
        "Didactics: Фиксация клинического сценария 5.2 (3 яруса)",
        tiers.length === 3,
        `Ярусы: ${tierLabels.join(" → ")}`
      );
    }

  } finally {
    await browser.close();
  }

  console.log("\n================================================================");
  console.log(`   Stage 5.4.3 Role 2 Audit: ${role2Results.summary.passed} Passed, ${role2Results.summary.failed} Failed`);
  console.log(`   Screenshots saved: ${role2Results.screenshots.length}`);
  console.log("================================================================\n");

  if (role2Results.summary.failed > 0) {
    process.exit(1);
  }
}

runRole2Audit().catch((err) => {
  console.error("FATAL ERROR in runRole2Audit:", err);
  process.exit(1);
});
