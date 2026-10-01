const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'http://127.0.0.1:8000';
const HARNESS_URL = `${BASE_URL}/visual_audit_click_result.html?case=heart_l1&theme=light-b`;
const OUT_DIR = process.env.VISUAL_QA_OUT_DIR || path.join(__dirname, '..', 'tmp', 'visual_qa');

fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = [
  { name: 'V1_1920x1080', width: 1920, height: 1080, dsf: 1 },
  { name: 'V2_1440x900',  width: 1440, height: 900,  dsf: 1 },
  { name: 'V3_1280x800',  width: 1280, height: 800,  dsf: 1 },
  { name: 'V4_850x900',   width: 850,  height: 900,  dsf: 1 },
  { name: 'V5_640x900',   width: 640,  height: 900,  dsf: 1 },
];

async function run() {
  console.log('🚀 Launching ACTRA Visual QA Re-Audit Suite...');
  const browser = await chromium.launch({ headless: true });

  const auditLog = [];

  for (const vp of VIEWPORTS) {
    console.log(`\n========================================`);
    console.log(`📸 Viewport: ${vp.name} (${vp.width}x${vp.height})`);
    console.log(`========================================`);

    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dsf,
    });

    const page = await context.newPage();
    await page.goto(HARNESS_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('[data-clickui="review-comparison"]', { state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    // Helper: capture full page screenshot
    const snap = async (name) => {
      const p = path.join(OUT_DIR, `${name}_${vp.name}.png`);
      await page.screenshot({ path: p, fullPage: false });
      console.log(`  ✓ Saved: ${name}_${vp.name}.png`);
    };

    // Helper: measure vertical geometry
    const measureGeometry = async (label) => {
      return await page.evaluate((lbl) => {
        const header = document.querySelector('[data-clickui="result-header-banner"]');
        const toolbar = document.querySelector('[data-clickui="result-viewport-toolbar"]');
        const inspector = document.querySelector('[data-clickui="result-inspector"]');
        const sbs = document.querySelector('[data-clickui="result-side-by-side"]');
        const tabs = document.querySelector('[data-clickui="result-tabs-container"]');
        const sideCol = document.querySelector('[data-clickui="side-column"]');
        const icon = inspector ? inspector.querySelector('.material-symbols-outlined') : null;

        const hRect = header ? header.getBoundingClientRect() : null;
        const tRect = toolbar ? toolbar.getBoundingClientRect() : null;
        const iRect = inspector ? inspector.getBoundingClientRect() : null;
        const sbsRect = sbs && !sbs.classList.contains('hidden') ? sbs.getBoundingClientRect() : null;
        const tabsRect = tabs && !tabs.classList.contains('hidden') ? tabs.getBoundingClientRect() : null;
        const activeVp = sbsRect || tabsRect;

        // Total vertical overhead above the active canvas
        const topOverhead = (iRect && hRect) ? (iRect.bottom - hRect.top) : 0;

        return {
          step: lbl,
          headerHeight: hRect ? Math.round(hRect.height) : 0,
          toolbarHeight: tRect ? Math.round(tRect.height) : 0,
          inspectorHeight: iRect ? Math.round(iRect.height) : 0,
          topOverhead: Math.round(topOverhead),
          activeViewportHeight: activeVp ? Math.round(activeVp.height) : 0,
          inspectorIcon: icon ? icon.textContent : 'none',
          inspectorIconClass: icon ? icon.className : '',
          isSbsVisible: sbs ? !sbs.classList.contains('hidden') : false,
          isTabsVisible: tabs ? !tabs.classList.contains('hidden') : false,
        };
      }, label);
    };

    // 1. Initial State: Default Review
    const geo1 = await measureGeometry('01_default');
    console.log(`  [Geo Default] Header: ${geo1.headerHeight}px, Toolbar: ${geo1.toolbarHeight}px, Inspector: ${geo1.inspectorHeight}px (Overhead: ${geo1.topOverhead}px)`);
    await snap('01_review_default');
    auditLog.push({ vp: vp.name, state: '01_default', geo: geo1 });

    // 2. Mode: "Ваш ответ" (User)
    const userBtn = page.locator('[data-clickui="tab-user"]');
    if (await userBtn.isVisible()) {
      await userBtn.click();
      await page.waitForTimeout(300);
      const geoUser = await measureGeometry('02_mode_user');
      await snap('02_mode_user');
      auditLog.push({ vp: vp.name, state: '02_user', geo: geoUser });
    }

    // 3. Mode: "Эталон" (Reference)
    const refBtn = page.locator('[data-clickui="tab-reference"]');
    if (await refBtn.isVisible()) {
      await refBtn.click();
      await page.waitForTimeout(300);
      const geoRef = await measureGeometry('03_mode_ref');
      await snap('03_mode_ref');
      auditLog.push({ vp: vp.name, state: '03_ref', geo: geoRef });
    }

    // 4. Mode: "Наложение" (Overlay)
    const overlayBtn = page.locator('[data-clickui="tab-overlay"]');
    if (await overlayBtn.isVisible()) {
      await overlayBtn.click();
      await page.waitForTimeout(300);
      const geoOverlay = await measureGeometry('04_mode_overlay');
      await snap('04_mode_overlay');
      auditLog.push({ vp: vp.name, state: '04_overlay', geo: geoOverlay });
    }

    // 5. Mode: Switch back to "2 снимка рядом" (SBS)
    const sbsBtn = page.locator('[data-clickui="mode-side-by-side"]');
    if (await sbsBtn.isVisible()) {
      await sbsBtn.click();
      await page.waitForTimeout(300);
      const geoSbs = await measureGeometry('05_mode_sbs');
      await snap('05_mode_sbs');
      auditLog.push({ vp: vp.name, state: '05_sbs', geo: geoSbs });
    }

    // 6. Hover Enter: Hover over an unmatched / error row in the registry
    const errRow = page.locator('[data-clickui="unmatched-action-row"], [data-has-error="true"]').first();
    if (await errRow.isVisible()) {
      await errRow.hover();
      await page.waitForTimeout(300);
      const geoHover = await measureGeometry('06_hover_enter');
      console.log(`  [Geo Hover Enter] Icon: ${geoHover.inspectorIcon}, InspectorHeight: ${geoHover.inspectorHeight}px`);
      await snap('06_hover_enter');
      auditLog.push({ vp: vp.name, state: '06_hover_enter', geo: geoHover });

      // 7. Hover Leave: Move mouse away to header to verify clean un-hover
      const headerTitle = page.locator('#task-header-title');
      await headerTitle.hover();
      await page.waitForTimeout(300);
      const geoLeave = await measureGeometry('07_hover_leave');
      console.log(`  [Geo Hover Leave] Icon: ${geoLeave.inspectorIcon}, InspectorHeight: ${geoLeave.inspectorHeight}px`);
      await snap('07_hover_leave');
      auditLog.push({ vp: vp.name, state: '07_hover_leave', geo: geoLeave });
    }

    await context.close();
  }

  // 8. Dark Theme Check on 1440x900
  console.log(`\n========================================`);
  console.log(`🌙 Testing Dark Theme on 1440x900`);
  console.log(`========================================`);
  const darkContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const darkPage = await darkContext.newPage();
  await darkPage.goto(`${BASE_URL}/visual_audit_click_result.html?case=heart_l1&theme=dark-b`, { waitUntil: 'networkidle' });
  await darkPage.waitForSelector('[data-clickui="review-comparison"]', { state: 'visible' });
  await darkPage.waitForTimeout(500);
  await darkPage.screenshot({ path: path.join(OUT_DIR, '08_dark_theme_1440x900.png') });
  console.log(`  ✓ Saved: 08_dark_theme_1440x900.png`);
  await darkContext.close();

  await browser.close();

  // Save audit log JSON
  fs.writeFileSync(path.join(OUT_DIR, 'reaudit_metrics.json'), JSON.stringify(auditLog, null, 2));
  console.log(`\n🎉 Visual Re-Audit Complete! Metrics saved to reaudit_metrics.json`);
}

run().catch((err) => {
  console.error('Audit failed with error:', err);
  process.exit(1);
});
