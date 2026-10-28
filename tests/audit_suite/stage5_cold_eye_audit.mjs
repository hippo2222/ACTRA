import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:8000';
const OUT_DIR = path.resolve(process.cwd(), 'tmp/stage5_audit');
if (!fs.existsSync(OUT_DIR)) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

const auditResults = {
  assertions: [],
  screenshots: [],
  microCrops: [],
  summary: { passed: 0, failed: 0 }
};

function recordAssertion(name, pass, details = '') {
  auditResults.assertions.push({ name, pass, details });
  if (pass) {
    auditResults.summary.passed++;
    console.log(`  \x1b[32m✔ PASS\x1b[0m | ${name} ${details ? '— ' + details : ''}`);
  } else {
    auditResults.summary.failed++;
    console.error(`  \x1b[31m✖ FAIL\x1b[0m | ${name} — ${details}`);
  }
}

async function loginAndGetCookie(context) {
  const resp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: {
      identifier: 'audit_student6@localhost.test',
      password: 'audit_password_123'
    },
    headers: {
      'Origin': BASE_URL
    }
  });
  if (!resp.ok()) {
    throw new Error(`Auth login failed: ${resp.status()} ${await resp.text()}`);
  }
  const cookies = await context.cookies();
  console.log(`[Auth] Logged in successfully. Cookies: ${cookies.map(c => c.name).join(', ')}`);
}

async function checkZeroTruncation(page, selector, label) {
  const elements = await page.$$(selector);
  let truncatedCount = 0;
  for (const el of elements) {
    const isTruncated = await el.evaluate(node => {
      if (!node.offsetParent && node.offsetWidth === 0) return false;
      return node.scrollWidth > node.offsetWidth + 1;
    });
    if (isTruncated) {
      const text = (await el.textContent() || '').trim().slice(0, 30);
      console.warn(`    [Truncation warning] "${text}" scrollWidth > offsetWidth`);
      truncatedCount++;
    }
  }
  recordAssertion(
    `Zero-Truncation: ${label} (${elements.length} elements)`,
    truncatedCount === 0,
    truncatedCount === 0 ? 'All elements fit within boundaries' : `${truncatedCount} elements overflow`
  );
}

async function checkNoOverlap(page, selectorA, selectorB, label) {
  const overlaps = await page.evaluate(({ selA, selB }) => {
    const elsA = Array.from(document.querySelectorAll(selA)).filter(el => el.offsetParent !== null);
    const elsB = Array.from(document.querySelectorAll(selB)).filter(el => el.offsetParent !== null);
    const collisions = [];
    for (const a of elsA) {
      const rA = a.getBoundingClientRect();
      for (const b of elsB) {
        if (a === b) continue;
        const rB = b.getBoundingClientRect();
        const noOverlap = (
          rA.right <= rB.left + 1 ||
          rA.left >= rB.right - 1 ||
          rA.bottom <= rB.top + 1 ||
          rA.top >= rB.bottom - 1
        );
        if (!noOverlap) {
          collisions.push({ a: a.className || a.tagName, b: b.className || b.tagName });
        }
      }
    }
    return collisions;
  }, { selA: selectorA, selB: selectorB });

  recordAssertion(
    `No-Overlap Collision (AABB): ${label}`,
    overlaps.length === 0,
    overlaps.length === 0 ? 'No bounding-box collisions' : `${overlaps.length} collisions detected`
  );
}

async function checkStackingIntegrity(page, selector, label) {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el || el.offsetParent === null) return { found: false, reason: 'element not visible' };
    const rect = el.getBoundingClientRect();
    const points = [
      { x: rect.left + 5, y: rect.top + 5 },
      { x: rect.right - 5, y: rect.top + 5 },
      { x: rect.left + 5, y: rect.bottom - 5 },
      { x: rect.right - 5, y: rect.bottom - 5 },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    ];
    for (const p of points) {
      const target = document.elementFromPoint(p.x, p.y);
      if (!target) return { found: true, pass: false, reason: `null element at ${p.x},${p.y}` };
      if (!el.contains(target) && target !== el) {
        return {
          found: true,
          pass: false,
          reason: `Point (${p.x},${p.y}) intercepted by <${target.tagName} class="${target.className}">`
        };
      }
    }
    return { found: true, pass: true };
  }, selector);

  recordAssertion(
    `Stacking Context Integrity (elementFromPoint): ${label}`,
    result.found && result.pass,
    result.found ? (result.pass ? 'All 5 points belong to element' : result.reason) : 'Element not visible'
  );
}

async function checkDismissControlReachability(page, selector, label) {
  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { exists: false };
    const rect = el.getBoundingClientRect();
    const inView = rect.top >= 0 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
    return { exists: true, inView, rect };
  }, selector);

  recordAssertion(
    `Dismiss Control Reachability: ${label}`,
    result.exists && result.inView,
    result.exists ? (result.inView ? 'Control is in-view and unclipped' : 'Control outside viewport') : 'Control not found'
  );
}

async function checkAntiGlue(page, selector, minGap = 8, label) {
  const result = await page.evaluate(({ sel, gap }) => {
    const els = Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
    const violations = [];
    for (let i = 0; i < els.length - 1; i++) {
      const r1 = els[i].getBoundingClientRect();
      const r2 = els[i + 1].getBoundingClientRect();
      const verticalGap = r2.top - r1.bottom;
      if (verticalGap >= 0 && verticalGap < gap) {
        violations.push({ index: i, gap: verticalGap });
      }
    }
    return { count: els.length, violations };
  }, { sel: selector, gap: minGap });

  recordAssertion(
    `Inter-Element Separation (Anti-Glue Gate): ${label}`,
    result.violations.length === 0,
    result.violations.length === 0
      ? `Proper gap between ${result.count} items (>= ${minGap}px)`
      : `${result.violations.length} pairs sticking with < ${minGap}px gap`
  );
}

async function checkNoDuplicateGlyphs(page, selector, label) {
  const result = await page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel)).filter(e => e.offsetParent !== null);
    const violations = [];
    const emojiRegex = /[\u{1F300}-\u{1F9FF}\u{2700}-\u{27BF}]/u;
    for (const el of els) {
      const text = el.textContent || '';
      const hasIcon = el.querySelector('.material-symbols-outlined, svg') !== null;
      if (hasIcon && emojiRegex.test(text)) {
        violations.push({ text: text.trim().slice(0, 30) });
      }
    }
    return violations;
  }, selector);

  recordAssertion(
    `Anti-Duplicate Glyph Assertion: ${label}`,
    result.length === 0,
    result.length === 0 ? 'No double emoji/icons detected' : `${result.length} duplicate glyphs found`
  );
}

async function runStage5Audit() {
  console.log('\n===============================================================');
  console.log('   ACTRA Cold-Eye Visual Gate: Sequence Hierarchy Mode');
  console.log('===============================================================\n');

  const browser = await chromium.launch({ headless: true });

  const viewports = [
    { width: 1280, height: 800, name: '1280x800' },
    { width: 1280, height: 720, name: '1280x720' }
  ];

  for (const vp of viewports) {
    console.log(`\n---------------------------------------------------------------`);
    console.log(` >>> Testing Viewport: ${vp.name} (${vp.width} × ${vp.height})`);
    console.log(`---------------------------------------------------------------`);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }
    });

    await loginAndGetCookie(context);
    const page = await context.newPage();

    // Disable tours
    await page.addInitScript(() => {
      window.ACTRA_DISABLE_AUTO_ONBOARDING = true;
    });

    // =========================================================================
    // PART 1: Task Editor Audit (Sequence Assembly Editor)
    // =========================================================================
    console.log('\n[1] Auditing Sequence Assembly Editor in Hierarchy Mode...');
    await page.goto(`${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?onboarding_preview=1&task_type=sequence_assembly`, {
      waitUntil: 'networkidle'
    });

    // Check mode tabs
    const modeTabs = page.locator('#se-display-mode-tabs');
    await modeTabs.waitFor({ state: 'visible' });
    recordAssertion('Editor: Display Mode segmented control visible', await modeTabs.isVisible());

    // Switch to Hierarchy mode
    const hierarchyTab = page.locator('#mode-tab-hierarchy');
    await hierarchyTab.click();
    await page.waitForTimeout(200);

    const isHierarchyActive = await hierarchyTab.getAttribute('aria-selected');
    recordAssertion('Editor: Switch to Hierarchy mode activated', isHierarchyActive === 'true');

    // Check hierarchy toolbar
    const toolbar = page.locator('#se-hierarchy-toolbar');
    recordAssertion('Editor: Hierarchy toolbar displayed', await toolbar.isVisible());

    // Check Quick Table Popover
    const quickTableBtn = page.locator('#quick-table-btn');
    await quickTableBtn.click();
    const quickTablePopover = page.locator('#quick-table-popover');
    await quickTablePopover.waitFor({ state: 'visible' });
    recordAssertion('Editor: Quick Table Popover opened', await quickTablePopover.isVisible());

    // Stacking context integrity & Dismiss control
    await checkStackingIntegrity(page, '#quick-table-popover', `Quick Table Popover (${vp.name})`);
    await checkDismissControlReachability(page, '#quick-table-close-btn', `Quick Table Close Button (${vp.name})`);

    // Capture popover screenshot
    if (vp.name === '1280x800') {
      const popoverShotPath = path.join(OUT_DIR, 'editor_quick_table_popover.png');
      await page.screenshot({ path: popoverShotPath });
      auditResults.screenshots.push(popoverShotPath);
    }

    // Set 3 cols × 3 rows and build grid
    await page.fill('#quick-table-cols-input', '3');
    await page.fill('#quick-table-rows-input', '3');
    await page.click('#quick-table-apply-btn');
    await page.waitForTimeout(250);

    // Verify grid generation
    const tiersCount = await page.locator('.se-tier-cell').count();
    const nodesCount = await page.locator('.se-node-card').count();
    recordAssertion('Editor: Quick Table 3×3 grid generated', tiersCount === 3 && nodesCount === 9, `Tiers: ${tiersCount}, Nodes: ${nodesCount}`);

    // Verify SVG connectors and minimap
    const editorSvg = page.locator('.se-hierarchy-svg');
    recordAssertion('Editor: SVG connectors rendered', await editorSvg.count() > 0);

    const editorMinimap = page.locator('.se-minimap');
    recordAssertion('Editor: Minimap element present', await editorMinimap.count() > 0);

    // Headless assertions on Editor
    await checkZeroTruncation(page, '#se-view-mode-bar button, .se-tier-input, .se-node-badge', `Editor Labels & Nodes (${vp.name})`);
    await checkNoOverlap(page, '.se-node-card', '.se-tier-cell', `Editor Nodes & Tier Cells (${vp.name})`);
    await checkAntiGlue(page, '.se-tier-cell', 8, `Editor Tier Cells Separation (${vp.name})`);
    await checkNoDuplicateGlyphs(page, 'button', `Editor Buttons (${vp.name})`);

    // Capture full editor screenshot
    const editorShotPath = path.join(OUT_DIR, `editor_hierarchy_${vp.name}.png`);
    await page.screenshot({ path: editorShotPath });
    auditResults.screenshots.push(editorShotPath);
    console.log(`    [Saved] ${editorShotPath}`);

    // Capture Micro-Crops for Editor
    if (vp.name === '1280x800') {
      // 1. crop_footer_boundary: status cluster of editor
      const saveCluster = page.locator('#save-status-cluster');
      const cropFooterPath = path.join(OUT_DIR, 'crop_footer_boundary.png');
      await saveCluster.screenshot({ path: cropFooterPath });
      auditResults.microCrops.push(cropFooterPath);

      // 2. crop_inter_section_rhythm: junction between tier 1 and tier 2
      const firstTier = page.locator('.se-tier-cell').first();
      const cropRhythmPath = path.join(OUT_DIR, 'crop_inter_section_rhythm.png');
      await firstTier.screenshot({ path: cropRhythmPath });
      auditResults.microCrops.push(cropRhythmPath);

      // 3. crop_focus_ring: focus on quick-table-btn
      await quickTableBtn.focus();
      const cropFocusPath = path.join(OUT_DIR, 'crop_focus_ring.png');
      await quickTableBtn.screenshot({ path: cropFocusPath });
      auditResults.microCrops.push(cropFocusPath);
    }

    // =========================================================================
    // PART 2: Task Player Audit (SequenceUI Hierarchy in audit.html)
    // =========================================================================
    console.log(`\n[2] Auditing SequenceUI Player in Hierarchy Mode (${vp.name})...`);
    await page.goto(`${BASE_URL}/SequenceUI/audit.html`, { waitUntil: 'networkidle' });

    // Define rich clinical classification test task (Hemithorax opacification etiology)
    const sampleHierarchyTask = {
      task_data: {
        content: {
          prompt: "Классифицируйте причины синдрома затенения гемиторакса и дифференцируйте их виды и провоцирующие факторы:",
          display_mode: "hierarchy",
          color_differentiation: true,
          elements: [
            { id: "e_atel", text: "Ателектаз" },
            { id: "e_pleur", text: "Плевральный выпот" },
            { id: "e_obstr", text: "Обтурационный" },
            { id: "e_compr", text: "Компрессионный" },
            { id: "e_trans", text: "Транссудат" },
            { id: "e_exsud", text: "Экссудат" },
            { id: "e_tumor", text: "Опухоль бронха" },
            { id: "e_foreign", text: "Инородное тело" }
          ],
          levels: [
            { level_id: "lvl_1", label: "Причины затемнения", blocks: ["e_atel", "e_pleur"] },
            { level_id: "lvl_2", label: "Виды патологии", blocks: ["e_obstr", "e_compr", "e_trans", "e_exsud"] },
            { level_id: "lvl_3", label: "Провоцирующие факторы", blocks: ["e_tumor", "e_foreign"] }
          ],
          nodes: [
            { node_id: "n_atel", level_id: "lvl_1", parent_id: null, blocks: ["e_atel"] },
            { node_id: "n_pleur", level_id: "lvl_1", parent_id: null, blocks: ["e_pleur"] },
            { node_id: "n_obstr", level_id: "lvl_2", parent_id: "n_atel", blocks: ["e_obstr"] },
            { node_id: "n_compr", level_id: "lvl_2", parent_id: "n_atel", blocks: ["e_compr"] },
            { node_id: "n_eff_types", level_id: "lvl_2", parent_id: "n_pleur", blocks: ["e_trans", "e_exsud"] },
            { node_id: "n_obstr_factors", level_id: "lvl_3", parent_id: "n_obstr", blocks: ["e_tumor", "e_foreign"] }
          ],
          settings: {
            difficulty: 1,
            shuffle_elements: false,
            display_mode: "hierarchy",
            color_differentiation: true
          }
        }
      }
    };

    // Render task in browser
    await page.evaluate((task) => {
      window.renderSequenceTask(task);
    }, sampleHierarchyTask);
    await page.waitForTimeout(300);

    // Verify Player Shell
    const playerShell = page.locator('[data-sequenceui="hierarchy-shell"]');
    recordAssertion('Player: Hierarchy shell mounted', await playerShell.isVisible());

    const playerNodes = page.locator('.seqh-node');
    const playerNodeCount = await playerNodes.count();
    recordAssertion('Player: 6 Hierarchy Nodes rendered', playerNodeCount === 6, `Count: ${playerNodeCount}`);

    const playerTiers = page.locator('.seqh-tier');
    const playerTierCount = await playerTiers.count();
    recordAssertion('Player: 3 Horizontal Tiers rendered', playerTierCount === 3, `Count: ${playerTierCount}`);

    const tierTabs = page.locator('[data-sequenceui="available-tier-tab"]');
    recordAssertion('Player: 3 Tier tabs in card panel', await tierTabs.count() === 3);

    // Verify Minimap
    const playerMinimap = page.locator('[data-sequenceui="hierarchy-minimap"]');
    recordAssertion('Player: Minimap HUD present', await playerMinimap.count() > 0);

    // Test Wrong Tier Drop protection & Toast hint
    console.log('    Testing wrong-tier placement protection...');
    await page.evaluate(() => {
      const inst = window.SequenceUI.__testHooks.getCurrentInstance();
      // Try to place 'e_atel' (Tier 1) into node 'n_obstr' (Tier 2, placement idx 2)
      inst.placeElementIntoLevel(2, 0, 'e_atel');
    });
    await page.waitForTimeout(150);

    const hint = page.locator('.seqh-hint');
    const hintVisible = await hint.evaluate(el => el.classList.contains('is-visible'));
    recordAssertion('Player: Wrong-tier drop blocked with shake & toast hint', hintVisible);

    // Place correct cards
    await page.evaluate(() => {
      const inst = window.SequenceUI.__testHooks.getCurrentInstance();
      inst.placeElementIntoLevel(0, 0, 'e_atel');
      inst.placeElementIntoLevel(1, 0, 'e_pleur');
      inst.placeElementIntoLevel(2, 0, 'e_obstr');
      inst.placeElementIntoLevel(3, 0, 'e_compr');
      inst.placeElementIntoLevel(4, 0, 'e_trans');
      inst.placeElementIntoLevel(4, 1, 'e_exsud');
      inst.placeElementIntoLevel(5, 0, 'e_tumor');
      inst.placeElementIntoLevel(5, 1, 'e_foreign');
    });
    await page.waitForTimeout(200);

    const placedCount = await page.locator('[data-sequenceui-placed-item="true"]').count();
    recordAssertion('Player: All 8 cards placed into skeleton nodes', placedCount === 8, `Placed: ${placedCount}`);

    // Verify Check Answer Feedback & Swapped Branch marking
    await page.evaluate(() => {
      const inst = window.SequenceUI.__testHooks.getCurrentInstance();
      inst.applyCheckFeedback({
        success: true,
        details: {
          correct_nodes: ["n_atel", "n_pleur", "n_obstr", "n_compr", "n_eff_types", "n_obstr_factors"],
          incorrect_nodes: [],
          correct_blocks_by_node: {
            n_atel: ["e_atel"], n_pleur: ["e_pleur"], n_obstr: ["e_obstr"],
            n_compr: ["e_compr"], n_eff_types: ["e_trans", "e_exsud"],
            n_obstr_factors: ["e_tumor", "e_foreign"]
          },
          node_mapping: {
            n_atel: "n_atel", n_pleur: "n_pleur", n_obstr: "n_obstr",
            n_compr: "n_compr", n_eff_types: "n_eff_types", n_obstr_factors: "n_obstr_factors"
          },
          symmetric_branches_accepted: ["n_eff_types"],
          correct_nodes_data: [
            { node_id: "n_atel", level_id: "lvl_1", parent_id: null, blocks: ["e_atel"] },
            { node_id: "n_pleur", level_id: "lvl_1", parent_id: null, blocks: ["e_pleur"] },
            { node_id: "n_obstr", level_id: "lvl_2", parent_id: "n_atel", blocks: ["e_obstr"] },
            { node_id: "n_compr", level_id: "lvl_2", parent_id: "n_atel", blocks: ["e_compr"] },
            { node_id: "n_eff_types", level_id: "lvl_2", parent_id: "n_pleur", blocks: ["e_trans", "e_exsud"] },
            { node_id: "n_obstr_factors", level_id: "lvl_3", parent_id: "n_obstr", blocks: ["e_tumor", "e_foreign"] }
          ],
          elements_data: [
            { id: "e_atel", text: "Ателектаз" },
            { id: "e_pleur", text: "Плевральный выпот" },
            { id: "e_obstr", text: "Обтурационный" },
            { id: "e_compr", text: "Компрессионный" },
            { id: "e_trans", text: "Транссудат" },
            { id: "e_exsud", text: "Экссудат" },
            { id: "e_tumor", text: "Опухоль бронха" },
            { id: "e_foreign", text: "Инородное тело" }
          ]
        }
      });
    });
    await page.waitForTimeout(200);

    const correctNodes = await page.locator('.seqh-node[data-verdict="correct"]').count();
    recordAssertion('Player: Nodes marked with success green borders', correctNodes === 6);

    // Capture placed feedback screenshot
    const playerPlacedPath = path.join(OUT_DIR, `player_diff1_feedback_${vp.name}.png`);
    await page.screenshot({ path: playerPlacedPath });
    auditResults.screenshots.push(playerPlacedPath);
    console.log(`    [Saved] ${playerPlacedPath}`);

    // Switch to Reference view
    const refViewBtn = page.locator('[data-sequenceui="comparison-view-reference"]');
    if (await refViewBtn.count() > 0) {
      await refViewBtn.click();
      await page.waitForTimeout(200);
      recordAssertion('Player: Switched to Reference view ("Эталон")', true);
      const refShotPath = path.join(OUT_DIR, `player_diff1_reference_${vp.name}.png`);
      await page.screenshot({ path: refShotPath });
      auditResults.screenshots.push(refShotPath);
    }

    // Headless assertions on Player Diff 1
    await checkZeroTruncation(page, '.seqh-tier__name, .seqh-tab__label, .seqh-slot', `Player Diff 1 Typography (${vp.name})`);
    await checkNoOverlap(page, '.seqh-node', '.seqh-minimap', `Player Nodes & Minimap HUD (${vp.name})`);
    await checkAntiGlue(page, '.seqh-tab', 4, `Player Tier Tabs Spacing (${vp.name})`);

    // =========================================================================
    // PART 3: Difficulty 2 Audit (Typed Tiers + Neutral Tabs)
    // =========================================================================
    console.log(`\n[3] Auditing Player Difficulty 2 (Typed Tiers)...`);
    const diff2Task = JSON.parse(JSON.stringify(sampleHierarchyTask));
    diff2Task.task_data.content.settings.difficulty = 2;
    diff2Task.task_data.content.requires_level_names = true;

    await page.evaluate((task) => {
      window.renderSequenceTask(task);
    }, diff2Task);
    await page.waitForTimeout(250);

    const tierInputs = page.locator('.seqh-tier__input');
    recordAssertion('Player Diff 2: Tier inputs present and rendered', await tierInputs.count() === 3);

    const neutralTabCount = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.seqh-tab__label'));
      return tabs.filter(t => t.textContent.includes('Уровень')).length;
    });
    recordAssertion('Player Diff 2: Neutral tab labels without spoilers', neutralTabCount === 3, `Neutral tabs: ${neutralTabCount}`);

    // Type tier name and check live update
    await tierInputs.first().fill('Причины затенения');
    const updatedTabLabel = await page.locator('.seqh-tab__label').first().textContent();
    recordAssertion('Player Diff 2: Live sync of typed tier name into tab', updatedTabLabel.includes('Причины затенения'));

    const diff2ShotPath = path.join(OUT_DIR, `player_diff2_${vp.name}.png`);
    await page.screenshot({ path: diff2ShotPath });
    auditResults.screenshots.push(diff2ShotPath);

    // =========================================================================
    // PART 4: Difficulty 3 Audit (Blind Skeleton with Text Inputs)
    // =========================================================================
    console.log(`\n[4] Auditing Player Difficulty 3 (Blind Tree)...`);
    const diff3Task = JSON.parse(JSON.stringify(sampleHierarchyTask));
    diff3Task.task_data.content.settings.difficulty = 3;
    diff3Task.task_data.content.requires_block_names = true;
    diff3Task.task_data.content.elements = [];

    await page.evaluate((task) => {
      window.renderSequenceTask(task);
    }, diff3Task);
    await page.waitForTimeout(250);

    const slotInputs = page.locator('.seqh-slot__input');
    const slotInputCount = await slotInputs.count();
    recordAssertion('Player Diff 3: 8 Text input slots generated across nodes', slotInputCount === 8, `Inputs: ${slotInputCount}`);

    const sidebarHidden = await page.locator('[data-sequenceui="available-sidebar"]').evaluate(el => el.classList.contains('hidden'));
    recordAssertion('Player Diff 3: Available cards sidebar hidden', sidebarHidden);

    // Fill first input
    await slotInputs.first().fill('Ателектаз легкого');
    const answerPayload = await page.evaluate(() => {
      return window.SequenceUI.__testHooks.getCurrentInstance().getUserAnswerPayload();
    });
    const firstSlotVal = answerPayload.nodes[0].block_names[answerPayload.nodes[0].blocks[0]];
    recordAssertion('Player Diff 3: Node text input correctly serialized', firstSlotVal === 'Ателектаз легкого');

    const diff3ShotPath = path.join(OUT_DIR, `player_diff3_${vp.name}.png`);
    await page.screenshot({ path: diff3ShotPath });
    auditResults.screenshots.push(diff3ShotPath);

    await context.close();
  }

  await browser.close();

  // Write final report JSON
  const reportPath = path.join(OUT_DIR, 'cold_eye_audit_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(auditResults, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(`   Audit Complete! Passed: ${auditResults.summary.passed}, Failed: ${auditResults.summary.failed}`);
  console.log(`   Report saved to: ${reportPath}`);
  console.log('===============================================================\n');

  if (auditResults.summary.failed > 0) {
    process.exit(1);
  }
}

runStage5Audit().catch(err => {
  console.error('\nFatal audit error:', err);
  process.exit(1);
});
