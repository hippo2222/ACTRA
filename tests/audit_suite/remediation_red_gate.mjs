/**
 * ACTRA Stage 5.5.1.0 — TDD Red Gate Runner
 * Strict adherence to TDD protocol and AGENTS.md.
 * Verifies that the 4 primary defect classes FAIL before implementation:
 * 1. Editor: Tier cell header mislabeling / two-line wrap & transparent resting input border (P1-4, P1-5)
 * 2. Editor: Tree not centered when scaled (anchored to top-left corner) (P1-3)
 * 3. S1 Live: Category tabs horizontal overflow (scrollWidth >> clientWidth) (P1-1)
 * 4. S1 Live: Available card bottom fold collision on 1280x720 (clearance < 24px) (P1-2)
 */

import { chromium } from "playwright";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";

const redGateResults = {
  assert1_editor_tier_layout: null,
  assert1_editor_tier_border: null,
  assert2_editor_tree_centering: null,
  assert3_s1_tabs_overflow: null,
  assert4_s1_card_fold_clearance: null,
};

async function runRedGate() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.5.1.0: TDD Red Gate (Pre-Remediation Verification)");
  console.log("   ================================================================\n");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

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

  // Login
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: "clinical_expert@actra.local",
      password: "Clinical.Pass1!",
    },
    headers: { Origin: BASE_URL },
  });
  if (!loginResp.ok()) {
    throw new Error(`Login failed: ${loginResp.status()}`);
  }

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });

  try {
    // -------------------------------------------------------------------------
    // TEST 1 & 2: EDITOR CHECKS (Table 5.1 ТЭЛА)
    // -------------------------------------------------------------------------
    const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });

    // Assert 1A: Tier Cell Header Mislabeled / Two-Line Split
    const tierHeaderDetails = await page.evaluate(() => {
      const firstTierHeader = document.querySelector(".se-tier-cell-header");
      const titleSpan = firstTierHeader?.querySelector("[data-i18n='se.k008'], .text-\\[11px\\]");
      const text = titleSpan?.textContent.trim() || "";
      const isTwoLinesOrMislabeled = /название\s+уровня/i.test(text);
      return { text, isTwoLinesOrMislabeled };
    });

    // We WANT header to NOT have the legacy "Название уровня" split string
    const pass1A = !tierHeaderDetails.isTwoLinesOrMislabeled && tierHeaderDetails.text.length > 0;
    redGateResults.assert1_editor_tier_layout = {
      name: "Assert 1A [Editor]: Шапка ячейки этажа не содержит разорванную строку 'Название уровня'",
      pass: pass1A,
      details: pass1A
        ? `Текст шапки корректен: "${tierHeaderDetails.text}"`
        : `FAIL (Ожидаемо для Red Gate): В шапке отображается унаследованная строка "${tierHeaderDetails.text}"`,
    };

    // Assert 1B: Tier Input Visible Border in Resting State
    const tierInputStyle = await page.evaluate(() => {
      const input = document.querySelector(".level-title-input");
      if (!input) return { borderStyle: "none", borderColor: "transparent" };
      const cs = window.getComputedStyle(input);
      return {
        borderStyle: cs.borderStyle,
        borderColor: cs.borderColor,
      };
    });

    const pass1B =
      tierInputStyle.borderStyle !== "none" &&
      tierInputStyle.borderColor !== "transparent" &&
      tierInputStyle.borderColor !== "rgba(0, 0, 0, 0)";
    redGateResults.assert1_editor_tier_border = {
      name: "Assert 1B [Editor]: Поле названия этажа имеет видимую рамку в покое (аффорданс)",
      pass: pass1B,
      details: pass1B
        ? `Рамка видна: ${tierInputStyle.borderColor}`
        : `FAIL (Ожидаемо для Red Gate): Рамка прозрачна в покое (${tierInputStyle.borderColor})`,
    };

    // Assert 2: Tree Centering at 75% Zoom
    await page.evaluate(() => {
      const ed = window.editorInstance || window.sequenceEditor;
      if (ed && typeof ed.setCanvasZoom === "function") {
        ed.setCanvasZoom(0.75);
      } else {
        const stage = document.querySelector("#se-hierarchy-stage");
        if (stage) stage.style.transform = "scale(0.75)";
      }
    });
    await page.waitForTimeout(250);

    const centeringMetrics = await page.evaluate(() => {
      const viewport = document.querySelector("#se-hierarchy-viewport");
      const grid = document.querySelector(".se-hierarchy-grid");
      if (!viewport || !grid) return { diffX: 999 };

      const vpRect = viewport.getBoundingClientRect();
      const gridRect = grid.getBoundingClientRect();

      const vpCenterX = vpRect.left + vpRect.width / 2;
      const gridCenterX = gridRect.left + gridRect.width / 2;
      const diffX = Math.round(Math.abs(vpCenterX - gridCenterX));
      return { diffX, vpCenterX, gridCenterX, gridLeft: gridRect.left, vpLeft: vpRect.left };
    });

    // Tolerance is 35px for being horizontally centered
    const pass2 = centeringMetrics.diffX <= 35;
    redGateResults.assert2_editor_tree_centering = {
      name: "Assert 2 [Editor]: Дерево центрируется относительно рабочей области при масштабировании",
      pass: pass2,
      details: pass2
        ? `Дерево сцентрировано: смещение центра ${centeringMetrics.diffX}px <= 35px`
        : `FAIL (Ожидаемо для Red Gate): Дерево прижато к левому краю, смещение центра ${centeringMetrics.diffX}px > 35px`,
    };

    // -------------------------------------------------------------------------
    // TEST 3 & 4: S1 LIVE TRAINER CHECKS
    // -------------------------------------------------------------------------
    const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
      data: { force: true },
      headers: { Origin: BASE_URL },
    });
    const startData = await startResp.json();
    const s1Url = `${BASE_URL}/session/${startData.session_id}`;

    await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    // Assert 3: Tabs Horizontal Overflow
    const tabsMetrics = await page.evaluate(() => {
      const tabs = document.querySelector(".seqh-tabs");
      if (!tabs) return { scrollWidth: 0, clientWidth: 0, overflowPx: 0 };
      const overflowPx = Math.max(0, tabs.scrollWidth - tabs.clientWidth);
      return {
        scrollWidth: tabs.scrollWidth,
        clientWidth: tabs.clientWidth,
        overflowPx,
      };
    });

    // We WANT tabs to fit without horizontal overflow: scrollWidth <= clientWidth + 1
    const pass3 = tabsMetrics.overflowPx <= 1;
    redGateResults.assert3_s1_tabs_overflow = {
      name: "Assert 3 [S1 Live]: Сегментированные вкладки этажей не вылезают за границы панели (0px скролла)",
      pass: pass3,
      details: pass3
        ? `Вкладки укладываются идеально: ${tabsMetrics.scrollWidth}px <= ${tabsMetrics.clientWidth}px`
        : `FAIL (Ожидаемо для Red Gate): Скрыто ${tabsMetrics.overflowPx}px контента вкладок (${tabsMetrics.scrollWidth}px vs ${tabsMetrics.clientWidth}px)`,
    };

    // Assert 4: Available Card Viewport Fold Clearance on 1280x720
    // Check all tabs to find the worst-case viewport fold clearance (as in Role 4 rapid tab switch)
    let minClearance = 999;
    let worstBottom = 0;
    const allTabs = page.locator(".seqh-tab");
    const tabCount = await allTabs.count();
    for (let i = 0; i < tabCount; i++) {
      await allTabs.nth(i).click();
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const card = document.querySelector('[data-sequenceui="available-card"]');
        if (!card) return { clearance: -999, bottom: 0 };
        const rect = card.getBoundingClientRect();
        return {
          clearance: Math.round(window.innerHeight - rect.bottom),
          bottom: Math.round(rect.bottom),
        };
      });
      if (m.clearance < minClearance) {
        minClearance = m.clearance;
        worstBottom = m.bottom;
      }
    }

    const cardFoldMetrics = {
      clearance: minClearance,
      bottom: worstBottom,
      innerHeight: 720,
    };

    const pass4 = cardFoldMetrics.clearance >= 24;
    redGateResults.assert4_s1_card_fold_clearance = {
      name: "Assert 4 [S1 Live]: Нижняя граница боковой панели не срезается экраном на 1280x720 (зазор >= 24px)",
      pass: pass4,
      details: pass4
        ? `Безопасный зазор: ${cardFoldMetrics.clearance}px >= 24px`
        : `FAIL (Ожидаемо для Red Gate): Карточка вылезает вниз, зазор ${cardFoldMetrics.clearance}px < 24px (bottom=${cardFoldMetrics.bottom}px при высоте ${cardFoldMetrics.innerHeight}px)`,
    };

  } finally {
    await browser.close();
  }

  // Print Summary
  console.log("----------------------------------------------------------------");
  let passedCount = 0;
  let failedCount = 0;

  for (const [key, result] of Object.entries(redGateResults)) {
    if (result.pass) {
      passedCount++;
      console.log(`  \x1b[32m✔ PASS\x1b[0m | ${result.name}\n         ↳ ${result.details}`);
    } else {
      failedCount++;
      console.log(`  \x1b[31m✖ FAIL\x1b[0m | ${result.name}\n         ↳ ${result.details}`);
    }
  }

  console.log("\n================================================================");
  console.log(`   TDD Red Gate Execution: ${passedCount} Passed, ${failedCount} Failed`);
  console.log("================================================================\n");

  return { passedCount, failedCount, results: redGateResults };
}

runRedGate().catch((err) => {
  console.error("FATAL ERROR in runRedGate:", err);
  process.exit(1);
});
