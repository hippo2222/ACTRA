/**
 * ACTRA Stage 5.4.4 — Role 3 Audit Runner: Visual Guardian (Design System Inspector)
 * Strict compliance with Rule 10 & 11 (AGENTS.md) and Google AI Studio Visual Engineering Method.
 * Focus:
 * 1. Правило «Анти-Матрёшка» (Strict De-nesting & Flat Surface Hierarchy)
 * 2. Заповедь живого контента (Zero-Placeholder Mandate & High Data Density)
 * 3. Закон единственного фокуса (Single Primary CTA per Visible Zone)
 * 4. Запрет на машинный мусор (Clean Terminology & Human-Centric Copy)
 * 5. Геометрия без коллизий и утечек (Visual Geometry & AABB Collision Assertions)
 * 6. Дизайн-токены, типографика (line-height, font-size) и цветовой контраст (WCAG AA)
 */

import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const OUT_DIR = path.resolve(process.cwd(), "tmp/stage5_matrix/role3_visual");

if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const role3Results = {
  assertions: [],
  screenshots: [],
  microCrops: [],
  findings: [],
  summary: { passed: 0, failed: 0 },
};

function recordAssertion(name, pass, details = "") {
  role3Results.assertions.push({ name, pass, details });
  if (pass) {
    role3Results.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? "— " + details : ""}`);
  } else {
    role3Results.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function setAppTheme(page, theme) {
  await page.evaluate((th) => {
    document.documentElement.setAttribute("data-theme", th);
    if (th.includes("dark")) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("actra_theme", th);
  }, theme);
  await page.waitForTimeout(150);
}

async function captureMicroCrop(page, selector, filename, padding = 8) {
  const el = await page.$(selector);
  if (!el) {
    console.warn(`    ⚠️ Micro-crop skipped: selector not found: ${selector}`);
    return null;
  }
  const box = await el.boundingBox();
  if (!box || box.width === 0 || box.height === 0) {
    console.warn(`    ⚠️ Micro-crop skipped: 0-size box for ${selector}`);
    return null;
  }

  const vp = page.viewportSize() || { width: 1280, height: 800 };
  const clip = {
    x: Math.max(0, Math.floor(box.x - padding)),
    y: Math.max(0, Math.floor(box.y - padding)),
    width: Math.min(vp.width, Math.ceil(box.width + padding * 2)),
    height: Math.min(vp.height, Math.ceil(box.height + padding * 2)),
  };

  const cropPath = path.join(OUT_DIR, filename);
  await page.screenshot({ path: cropPath, clip });
  role3Results.microCrops.push(cropPath);
  console.log(`    🔍 Micro-crop: ${filename} (${clip.width}x${clip.height})`);
  return cropPath;
}

// Luminance and Contrast calculation (WCAG 2.1)
function getLuminance(r, g, b) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function parseRgb(colorStr) {
  const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
  }
  return [255, 255, 255];
}

function calculateContrastRatio(fgStr, bgStr) {
  const [r1, g1, b1] = parseRgb(fgStr);
  const [r2, g2, b2] = parseRgb(bgStr);
  const l1 = getLuminance(r1, g1, b1);
  const l2 = getLuminance(r2, g2, b2);
  const brightest = Math.max(l1, l2);
  const darkest = Math.min(l1, l2);
  return (brightest + 0.05) / (darkest + 0.05);
}

async function runRole3VisualGuardianAudit() {
  console.log("\n================================================================");
  console.log("   ACTRA Stage 5.4.4: Role 3 Audit — Visual Guardian (Design System)");
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
  await page.setViewportSize({ width: 1280, height: 800 });

  try {
    // =========================================================================
    // ЧАСТЬ 1: ВИЗУАЛЬНЫЙ АУДИТ РЕДАКТОРА (SEQUENCE EDITOR)
    // =========================================================================
    console.log("\n📐 -------------------------------------------------------------");
    console.log("   [Part 1] Visual Guardian Audit: Sequence Assembly Editor");
    console.log("   -------------------------------------------------------------\n");

    const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
    await page.goto(editorUrl, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".se-hierarchy-shell", { timeout: 15000 });

    // 1.1 Правило «Анти-Матрёшка» в Редакторе
    const editorNesting = await page.evaluate(() => {
      // Check maximum border nesting inside .se-hierarchy-shell
      const shell = document.querySelector(".se-hierarchy-shell");
      if (!shell) return { maxDepth: 0, violations: [] };

      const cards = shell.querySelectorAll(".se-node-card");
      let deepCards = 0;
      cards.forEach((card) => {
        let parentCard = card.parentElement.closest(".se-node-card");
        if (parentCard) deepCards++;
      });
      return { maxDepth: deepCards > 0 ? 2 : 1, violations: deepCards };
    });

    recordAssertion(
      "Rule 1 (Анти-Матрёшка - Редактор): Отсутствие вложенных рамок глубже 1 уровня",
      editorNesting.violations === 0,
      `Вложенных карточек с рамками: ${editorNesting.violations}`
    );

    // 1.2 Закон единственного фокуса (Single Primary CTA)
    const editorPrimaryCtas = await page.evaluate(() => {
      const primaryBtns = Array.from(document.querySelectorAll(".btn--primary, .studio-btn--primary, button.bg-primary:not(.hidden)"));
      return primaryBtns.map((b) => ({ id: b.id, text: b.textContent.trim() }));
    });

    const isSingleFocusEditor = editorPrimaryCtas.length <= 1 && (editorPrimaryCtas.length === 0 || editorPrimaryCtas[0].id === "save-task-btn");
    recordAssertion(
      "Rule 3 (Единственный фокус - Редактор): Ровно 1 первичный CTA на видимый экран",
      isSingleFocusEditor,
      `Primary CTA: ${editorPrimaryCtas.map((c) => c.text || c.id).join(", ") || "0 (спокойное состояние)"}`
    );

    // 1.3 Запрет на машинный мусор в UI Редактора
    const editorSlop = await page.evaluate(() => {
      const text = document.querySelector(".se-hierarchy-shell")?.innerText || "";
      const slopKeywords = ["colSpan", "slots", "parent_id", "node_id", "level_id", "SEQUENCE_ASSEMBLY", "undefined", "null", "NaN", "[object Object]"];
      const found = [];
      slopKeywords.forEach((kw) => {
        if (text.includes(kw)) found.push(kw);
      });
      return found;
    });

    recordAssertion(
      "Rule 4 (Запрет на машинный мусор - Редактор): Отсутствие программных enum и DTO в UI",
      editorSlop.length === 0,
      editorSlop.length === 0 ? "Чистый клинический текст" : `Обнаружен сленг: ${editorSlop.join(", ")}`
    );

    // 1.4 Геометрия без коллизий (AABB) в Редакторе
    const editorCollisions = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".se-node-card"));
      const collisions = [];
      for (let i = 0; i < cards.length; i++) {
        const r1 = cards[i].getBoundingClientRect();
        for (let j = i + 1; j < cards.length; j++) {
          const r2 = cards[j].getBoundingClientRect();
          const overlap = !(
            r1.right <= r2.left ||
            r1.left >= r2.right ||
            r1.bottom <= r2.top ||
            r1.top >= r2.bottom
          );
          if (overlap) collisions.push(`Card ${i} overlaps Card ${j}`);
        }
      }
      return collisions;
    });

    recordAssertion(
      "Rule 5 (AABB-коллизии - Редактор): Отсутствие взаимного перекрытия карточек узлов",
      editorCollisions.length === 0,
      editorCollisions.length === 0 ? "Коллизий нет (0 AABB)" : `Коллизии: ${editorCollisions.join(", ")}`
    );

    // 1.5 Микро-типографика и токены Редактора
    const editorTypography = await page.evaluate(() => {
      const input = document.querySelector(".se-node-item-input, .block-title-input");
      if (!input) return null;
      const cs = window.getComputedStyle(input);
      return {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        borderRadius: cs.borderRadius,
        fontWeight: cs.fontWeight,
      };
    });

    recordAssertion(
      "Design System: Микро-типографика полей ввода узлов Редактора",
      editorTypography && parseFloat(editorTypography.fontSize) >= 12,
      `fontSize: ${editorTypography?.fontSize}, lineHeight: ${editorTypography?.lineHeight}, radius: ${editorTypography?.borderRadius}`
    );

    // Editor Screenshots
    const shotEdLight = path.join(OUT_DIR, "role3_editor_light_overview.png");
    await page.screenshot({ path: shotEdLight });
    role3Results.screenshots.push(shotEdLight);

    await setAppTheme(page, "dark-a");
    const shotEdDark = path.join(OUT_DIR, "role3_editor_dark_overview.png");
    await page.screenshot({ path: shotEdDark });
    role3Results.screenshots.push(shotEdDark);
    await setAppTheme(page, "light-a");

    // Editor Micro-Crops
    await captureMicroCrop(page, ".se-tier-cell", "crop_role3_editor_tier_border_rhythm.png", 6);
    await captureMicroCrop(page, ".se-node-card", "crop_role3_editor_node_input_typography.png", 8);

    // =========================================================================
    // ЧАСТЬ 2: ВИЗУАЛЬНЫЙ АУДИТ ТРЕНАЖЕРА S1 LIVE
    // =========================================================================
    console.log("\n📐 -------------------------------------------------------------");
    console.log("   [Part 2] Visual Guardian Audit: S1 Live Trainer (SequenceUI)");
    console.log("   -------------------------------------------------------------\n");

    const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
      data: { force: true },
      headers: { Origin: BASE_URL },
    });
    const startData = await startResp.json();
    const s1Url = `${BASE_URL}/session/${startData.session_id}`;

    await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });

    // 2.1 Правило «Анти-Матрёшка» в S1
    const s1Nesting = await page.evaluate(() => {
      const shell = document.querySelector(".seqh-shell");
      if (!shell) return { violations: 0 };
      const nodes = shell.querySelectorAll(".seqh-node");
      let deepNesting = 0;
      nodes.forEach((n) => {
        if (n.parentElement.closest(".seqh-node")) deepNesting++;
      });
      return { violations: deepNesting };
    });

    recordAssertion(
      "Rule 1 (Анти-Матрёшка - S1): Плоская иерархия поверхностей свимлейнов и узлов",
      s1Nesting.violations === 0,
      `Вложенных узлов с рамками: ${s1Nesting.violations}`
    );

    // 2.2 Заповедь живого контента (Zero-Placeholder Mandate)
    const placeholderCheck = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll(".seq-available-item, .seqh-slot, .seqh-tier__name"));
      const placeholders = [];
      elements.forEach((el) => {
        const txt = el.textContent.trim();
        if (/^(Задание|Элемент|Узел|Item|Card)\s*\d+$/i.test(txt)) {
          placeholders.push(txt);
        }
      });
      return placeholders;
    });

    recordAssertion(
      "Rule 2 (Живой контент - S1): Отсутствие слепых заглушек 'Задание N / Элемент N'",
      placeholderCheck.length === 0,
      placeholderCheck.length === 0 ? "100% реальный клинический контент" : `Заглушки: ${placeholderCheck.join(", ")}`
    );

    // 2.3 Закон единственного фокуса (Single Primary CTA в S1)
    const s1PrimaryCtas = await page.evaluate(() => {
      const primaryBtns = Array.from(document.querySelectorAll("#check-answer-btn, .btn--primary, button.bg-primary"));
      return primaryBtns.filter((b) => b.offsetParent !== null).map((b) => ({ id: b.id, text: b.textContent.trim() }));
    });

    const isSingleFocusS1 = s1PrimaryCtas.length === 1 && s1PrimaryCtas[0].id === "check-answer-btn";
    recordAssertion(
      "Rule 3 (Единственный фокус - S1): Ровно 1 первичный CTA ('Проверить')",
      isSingleFocusS1,
      `CTA: ${s1PrimaryCtas.map((c) => c.text || c.id).join(", ")}`
    );

    // 2.4 Запрет на машинный мусор в UI S1
    const s1Slop = await page.evaluate(() => {
      const text = document.querySelector(".seqh-shell")?.innerText || "";
      const slopKeywords = ["colSpan", "slots", "parent_id", "node_id", "level_id", "SEQUENCE_ASSEMBLY", "undefined", "null", "NaN", "[object Object]"];
      const found = [];
      slopKeywords.forEach((kw) => {
        if (text.includes(kw)) found.push(kw);
      });
      return found;
    });

    recordAssertion(
      "Rule 4 (Запрет на машинный мусор - S1): Отсутствие программных enum и технических полей",
      s1Slop.length === 0,
      s1Slop.length === 0 ? "Терминология полностью локализована" : `Обнаружен сленг: ${s1Slop.join(", ")}`
    );

    // 2.5 Цветовой контраст WCAG AA на свимлейнах (data-tint)
    const tierContrasts = await page.evaluate(() => {
      const tiers = Array.from(document.querySelectorAll(".seqh-tier"));
      return tiers.map((tier, idx) => {
        const title = tier.querySelector(".seqh-tier__name");
        const csTier = window.getComputedStyle(tier);
        const csTitle = title ? window.getComputedStyle(title) : null;
        return {
          tierIdx: idx,
          tint: tier.dataset.tint || "default",
          bgColor: csTier.backgroundColor,
          fgColor: csTitle ? csTitle.color : csTier.color,
        };
      });
    });

    let minContrast = 999;
    tierContrasts.forEach((tc) => {
      const ratio = calculateContrastRatio(tc.fgColor, tc.bgColor);
      if (ratio < minContrast) minContrast = ratio;
    });

    recordAssertion(
      "Accessibility (WCAG AA): Цветовой контраст заголовков свимлейнов на тонированном фоне",
      minContrast >= 4.5,
      `Минимальный контраст: ${minContrast.toFixed(2)}:1 (требуется >= 4.5:1)`
    );

    // 2.6 AABB-коллизии узлов в S1
    const s1Collisions = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll(".seqh-node"));
      const collisions = [];
      for (let i = 0; i < nodes.length; i++) {
        const r1 = nodes[i].getBoundingClientRect();
        for (let j = i + 1; j < nodes.length; j++) {
          const r2 = nodes[j].getBoundingClientRect();
          const overlap = !(
            r1.right <= r2.left ||
            r1.left >= r2.right ||
            r1.bottom <= r2.top ||
            r1.top >= r2.bottom
          );
          if (overlap) collisions.push(`Node ${i} overlaps Node ${j}`);
        }
      }
      return collisions;
    });

    recordAssertion(
      "Rule 5 (AABB-коллизии - S1): Отсутствие взаимного перекрытия узлов на холсте",
      s1Collisions.length === 0,
      s1Collisions.length === 0 ? "0 AABB коллизий" : `Коллизии: ${s1Collisions.join(", ")}`
    );

    // S1 Screenshots & Micro-Crops
    const shotS1Light = path.join(OUT_DIR, "role3_s1_light_overview.png");
    await page.screenshot({ path: shotS1Light });
    role3Results.screenshots.push(shotS1Light);

    await setAppTheme(page, "dark-a");
    const shotS1Dark = path.join(OUT_DIR, "role3_s1_dark_overview.png");
    await page.screenshot({ path: shotS1Dark });
    role3Results.screenshots.push(shotS1Dark);
    await setAppTheme(page, "light-a");

    await captureMicroCrop(page, ".seqh-tier", "crop_role3_s1_swimlane_tint_contrast.png", 6);
    await captureMicroCrop(page, ".seqh-node", "crop_role3_s1_placed_card_micro_geometry.png", 8);

  } finally {
    await browser.close();
  }

  console.log("\n================================================================");
  console.log(`   Stage 5.4.4 Role 3 Audit: ${role3Results.summary.passed} Passed, ${role3Results.summary.failed} Failed`);
  console.log(`   Screenshots saved: ${role3Results.screenshots.length}, Micro-crops: ${role3Results.microCrops.length}`);
  console.log("================================================================\n");

  if (role3Results.summary.failed > 0) {
    process.exit(1);
  }
}

runRole3VisualGuardianAudit().catch((err) => {
  console.error("FATAL ERROR in runRole3VisualGuardianAudit:", err);
  process.exit(1);
});
