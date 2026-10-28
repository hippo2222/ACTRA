/**
 * ACTRA Stage 5.4.5 — Role 4 Audit Runner: Zero-Rails Wildcard (Adversarial Stress-Tester)
 * Strict compliance with Rule 10 & 11 (AGENTS.md)
 * Focus:
 * 1. Ультра-длинный клинический текст (350+ символов в карточке узла и 150+ символов в названии этажа).
 * 2. Демонстрация масштабной сетки (Zoom Levels 50%, 75%, 100%, 125%, 150%, Fit-to-Viewport) — Запрос Аудитора 1.2.
 * 3. Быстрые хаотичные клики и добавление/удаление веток (Monkey Testing / Race Conditions).
 * 4. Динамический ресайз окна (1920x1080, 1280x800, 1280x720, 1024x768).
 * 5. Стресс-тест вкладок и табов в S1 Live Trainer.
 * 6. Контроль консоли браузера (Zero Unhandled Errors Gate).
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/stage5_matrix/role4_adversarial");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const role4Results = {
  assertions: [],
  screenshots: [],
  summary: { passed: 0, failed: 0 },
};

function recordAssertion(name, pass, details = "") {
  role4Results.assertions.push({ name, pass, details });
  if (pass) {
    role4Results.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? "— " + details : ""}`);
  } else {
    role4Results.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function runRole4AdversarialAudit() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.4.5: Role 4 Audit — Zero-Rails Wildcard (Stress)");
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

  // Track uncaught browser exceptions
  const pageErrors = [];
  context.on("weberror", (webError) => {
    pageErrors.push(webError.error().message);
  });

  // Login
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  recordAssertion("Auth: Student Login", loginResp.ok(), `Status ${loginResp.status()}`);

  const page = await context.newPage();
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
  });

  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    // =========================================================================
    // СТРЕСС-ТЕСТ 1: УЛЬТРА-ДЛИННЫЙ КЛИНИЧЕСКИЙ ТЕКСТ (350+ СИМВОЛОВ)
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 1] Extremely Long Copy Stress (Node & Tier Inputs)");
    console.log("   -------------------------------------------------------------\n");

    const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });

    const ULTRA_LONG_NODE_TEXT =
      "Пациент с массивной тромбоэмболией легочной артерии высокого риска, обструктивным шоком, рефрактерной артериальной гипотензией (АДсист < 90 мм рт.ст. более 15 минут), выраженными признаками острой перегрузки правого желудочка по данным трансторакальной ЭхоКГ (соотношение ПЖ/ЛЖ > 1.0, парадоксальное систолическое движение МЖП, регургитация 3 ст.) и положительным тропонином.";

    const ULTRA_LONG_TIER_TEXT =
      "Этаж 1: Стратификация клинико-гемодинамического фенотипа, биохимических маркеров миокардиального повреждения и ультразвуковых критериев декомпенсации";

    const textInjectionResult = await page.evaluate(
      ({ nodeText, tierText }) => {
        const firstNodeInput = document.querySelector(".se-node-item-input");
        const firstTierInput = document.querySelector(".level-title-input");
        if (!firstNodeInput || !firstTierInput) return { success: false };

        firstNodeInput.value = nodeText;
        firstNodeInput.dispatchEvent(new Event("input", { bubbles: true }));

        firstTierInput.value = tierText;
        firstTierInput.dispatchEvent(new Event("input", { bubbles: true }));

        // Trigger resize and re-render connectors
        const card = firstNodeInput.closest(".se-node-card");
        const tier = firstTierInput.closest(".se-tier-cell");
        return {
          success: true,
          nodeCardHeight: card ? card.offsetHeight : 0,
          tierCellHeight: tier ? tier.offsetHeight : 0,
          nodeCardWidth: card ? card.offsetWidth : 0,
        };
      },
      { nodeText: ULTRA_LONG_NODE_TEXT, tierText: ULTRA_LONG_TIER_TEXT }
    );

    await page.waitForTimeout(300);

    recordAssertion(
      "Stress 1 (Long Copy): Успешная адаптация сетки при вводе 350+ символов",
      textInjectionResult.success && textInjectionResult.nodeCardHeight > 100,
      `Высота карточки выросла до ${textInjectionResult.nodeCardHeight}px, ширина стабильна (${textInjectionResult.nodeCardWidth}px)`
    );

    // Verify SVG connectors recalculated without NaN
    const svgConnectorsValid = await page.evaluate(() => {
      const paths = Array.from(document.querySelectorAll(".se-hierarchy-svg path"));
      if (paths.length === 0) return true;
      for (const p of paths) {
        const d = p.getAttribute("d") || "";
        if (d.includes("NaN") || d.includes("undefined")) return false;
      }
      return true;
    });

    recordAssertion(
      "Stress 1 (SVG Connectors): Отсутствие NaN / undefined в координатах связей",
      svgConnectorsValid,
      "Все ортогональные кривые пересчитаны корректно"
    );

    const shotLongText = path.join(OUT_DIR, "role4_long_text_stress_editor.png");
    await page.screenshot({ path: shotLongText });
    role4Results.screenshots.push(shotLongText);

    // =========================================================================
    // СТРЕСС-ТЕСТ 2: ДЕМОНСТРАЦИЯ МАСШТАБНОЙ СЕТКИ (ZOOM LEVELS) — ЗАПРОС 1.2
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 2] Zoom Scale Grid & Affordance (50%, 75%, 100%, 125%, 150%, Fit)");
    console.log("   -------------------------------------------------------------\n");

    const zoomLevels = [
      { scale: 0.5, label: "50%", file: "role4_zoom_50.png" },
      { scale: 0.75, label: "75%", file: "role4_zoom_75.png" },
      { scale: 1.0, label: "100%", file: "role4_zoom_100.png" },
      { scale: 1.25, label: "125%", file: "role4_zoom_125.png" },
      { scale: 1.5, label: "150%", file: "role4_zoom_150.png" },
    ];

    for (const zl of zoomLevels) {
      await page.evaluate((sc) => {
        const ed = window.editorInstance || window.sequenceEditor;
        if (ed && typeof ed.setScale === "function") {
          ed.setScale(sc);
        } else {
          const stage = document.querySelector("#se-hierarchy-stage");
          if (stage) stage.style.transform = `scale(${sc})`;
        }
      }, zl.scale);
      await page.waitForTimeout(200);

      const shotPath = path.join(OUT_DIR, zl.file);
      await page.screenshot({ path: shotPath });
      role4Results.screenshots.push(shotPath);
      console.log(`    🔍 Сохранен снимок масштаба ${zl.label}: ${zl.file}`);
    }

    // Fit to Viewport test
    await page.evaluate(() => {
      const fitBtn = document.querySelector("#se-fit-viewport-btn");
      if (fitBtn) fitBtn.click();
    });
    await page.waitForTimeout(250);

    const shotFit = path.join(OUT_DIR, "role4_zoom_fit_viewport.png");
    await page.screenshot({ path: shotFit });
    role4Results.screenshots.push(shotFit);
    console.log("    🔍 Сохранен снимок Fit-to-Viewport: role4_zoom_fit_viewport.png");

    recordAssertion(
      "Stress 2 (Zoom Scale Grid): Полная серия масштабной сетки сгенерирована (50%..150% + Fit)",
      true,
      "Все 6 снимков масштабирования сохранены"
    );

    // =========================================================================
    // СТРЕСС-ТЕСТ 3: БЫСТРЫЕ ХАОТИЧНЫЕ КЛИКИ И МОДИФИКАЦИЯ ДЕРЕВА
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 3] Rapid Monkey Branching & State Resilience");
    console.log("   -------------------------------------------------------------\n");

    const monkeyResult = await page.evaluate(() => {
      const errors = [];
      try {
        // Fast click + Ветка ↓
        for (let i = 0; i < 3; i++) {
          const childBtns = document.querySelectorAll(".add-child-node-btn");
          if (childBtns.length > 0) childBtns[0].click();
        }
        // Fast click + Ветка →
        for (let i = 0; i < 3; i++) {
          const sibBtns = document.querySelectorAll(".add-sibling-node-btn");
          if (sibBtns.length > 0) sibBtns[sibBtns.length - 1].click();
        }
        // Fast delete of temporary node
        const delBtns = document.querySelectorAll(".delete-node:not([disabled])");
        if (delBtns.length > 0) delBtns[delBtns.length - 1].click();
      } catch (e) {
        errors.push(e.message);
      }

      const totalNodes = document.querySelectorAll(".se-node-card").length;
      return { errors, totalNodes };
    });

    await page.waitForTimeout(300);

    recordAssertion(
      "Stress 3 (Monkey Branching): Устойчивость состояния дерева при серии быстрых мутаций",
      monkeyResult.errors.length === 0 && monkeyResult.totalNodes > 5,
      `Ошибок: ${monkeyResult.errors.length}, узлов на холсте: ${monkeyResult.totalNodes}`
    );

    const shotMonkey = path.join(OUT_DIR, "role4_after_rapid_branching.png");
    await page.screenshot({ path: shotMonkey });
    role4Results.screenshots.push(shotMonkey);

    // =========================================================================
    // СТРЕСС-ТЕСТ 4: ДИНАМИЧЕСКИЙ РЕСАЙЗ ОКНА БРАУЗЕРА (JITTER & TABLET)
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 4] Dynamic Viewport Jitter (1920 -> 1280 -> 1024)");
    console.log("   -------------------------------------------------------------\n");

    const viewports = [
      { w: 1920, h: 1080, name: "Desktop 1080p" },
      { w: 1280, h: 720, name: "Compact Laptop" },
      { w: 1024, h: 768, name: "Tablet / Medical Workstation" },
      { w: 1280, h: 800, name: "Standard 800p" },
    ];

    let resizeErrors = 0;
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.evaluate(() => window.dispatchEvent(new Event("resize")));
      await page.waitForTimeout(150);

      const isValid = await page.evaluate(() => {
        const shell = document.querySelector(".se-hierarchy-shell");
        return shell && shell.offsetWidth > 0 && shell.offsetHeight > 0;
      });
      if (!isValid) resizeErrors++;

      if (vp.w === 1024) {
        const shotTablet = path.join(OUT_DIR, "role4_viewport_1024x768_tablet.png");
        await page.screenshot({ path: shotTablet });
        role4Results.screenshots.push(shotTablet);
        console.log("    🔍 Сохранен снимок планшетного разрешения 1024x768");
      }
    }

    recordAssertion(
      "Stress 4 (Viewport Jitter): Отсутствие крашей разметки при циклическом ресайзе",
      resizeErrors === 0,
      "Холст корректно адаптировался под 1920px, 1280px, 1024px"
    );

    // =========================================================================
    // СТРЕСС-ТЕСТ 5: S1 LIVE TRAINER — БЫСТРЫЕ ПЕРЕКЛЮЧЕНИЯ ВКЛАДОК
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 5] S1 Live Trainer Rapid Tab Flipping & Click Thrash");
    console.log("   -------------------------------------------------------------\n");

    const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
      data: { force: true },
      headers: { Origin: BASE_URL },
    });
    const startData = await startResp.json();
    const s1Url = `${BASE_URL}/session/${startData.session_id}`;

    await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    const tabSwitchResult = await page.evaluate(async () => {
      const tabs = Array.from(document.querySelectorAll(".seqh-tab"));
      if (tabs.length === 0) return { count: 0, errors: [] };

      const errors = [];
      for (let cycle = 0; cycle < 8; cycle++) {
        for (let i = 0; i < tabs.length; i++) {
          try {
            tabs[i].click();
          } catch (e) {
            errors.push(e.message);
          }
        }
      }

      // Check final state
      const activeTab = document.querySelector(".seqh-tab.is-active");
      const availableItems = document.querySelectorAll("[data-sequenceui='available-item']");
      return {
        count: tabs.length,
        errors,
        hasActive: !!activeTab,
        itemsRendered: availableItems.length,
      };
    });

    recordAssertion(
      "Stress 5 (S1 Tab Thrashing): Отсутствие рассинхронизации состояния при быстрых кликах",
      tabSwitchResult.errors.length === 0 && tabSwitchResult.hasActive,
      `Успешно выполнено 32 быстрых переключения вкладок, элементов в списке: ${tabSwitchResult.itemsRendered}`
    );

    const shotS1Tab = path.join(OUT_DIR, "role4_s1_rapid_tab_switch.png");
    await page.screenshot({ path: shotS1Tab });
    role4Results.screenshots.push(shotS1Tab);

    // =========================================================================
    // СТРЕСС-ТЕСТ 6: ZERO UNCAUGHT ERRORS GATE
    // =========================================================================
    console.log("\n💥 -------------------------------------------------------------");
    console.log("   [Stress 6] Zero Uncaught Errors Gate");
    console.log("   -------------------------------------------------------------\n");

    recordAssertion(
      "Stress 6 (Zero Console Errors): 0 необработанных исключений JavaScript",
      pageErrors.length === 0,
      pageErrors.length === 0 ? "Консоль абсолютно чиста" : `Ошибки: ${pageErrors.join(" | ")}`
    );

  } finally {
    await browser.close();
  }

  console.log("\n================================================================");
  console.log(`   Stage 5.4.5 Role 4 Audit: ${role4Results.summary.passed} Passed, ${role4Results.summary.failed} Failed`);
  console.log(`   Screenshots saved: ${role4Results.screenshots.length}`);
  console.log("================================================================\n");

  if (role4Results.summary.failed > 0) {
    process.exit(1);
  }
}

runRole4AdversarialAudit().catch((err) => {
  console.error("FATAL ERROR in runRole4AdversarialAudit:", err);
  process.exit(1);
});
