import { chromium } from 'playwright';

const BASE_URL = 'http://127.0.0.1:8000';
const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
    headers: { Origin: BASE_URL }
  });
  const page = await context.newPage();
  const editorUrl = `${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?module=neotlozhnye_sostoyaniya_pulmonologiya_i_kardiologiya&topic=differentsialnaya_diagnostika_i_stratifikatsiya_riska&task=task_5_1_tela_stratification`;
  await page.goto(editorUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('.se-hierarchy-shell', { timeout: 15000 });
  await page.waitForSelector('.se-node-card', { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Inspect mode tabs geometry
  const tabsInfo = await page.evaluate(() => {
    const container = document.querySelector('#se-display-mode-tabs');
    const linear = document.querySelector('#mode-tab-linear');
    const hier = document.querySelector('#mode-tab-hierarchy');
    const pill = document.querySelector('#se-mode-tabs-pill');
    const cR = container.getBoundingClientRect();
    const lR = linear.getBoundingClientRect();
    const hR = hier.getBoundingClientRect();
    const pR = pill.getBoundingClientRect();
    const cCs = window.getComputedStyle(container);
    return {
      container: { width: cR.width, left: cR.left, right: cR.right, padding: cCs.padding, boxSizing: cCs.boxSizing },
      linear: { width: lR.width, left: lR.left, right: lR.right },
      hier: { width: hR.width, left: hR.left, right: hR.right, overflowRight: Math.max(0, hR.right - cR.right) },
      pill: { width: pR.width, left: pR.left, right: pR.right, overflowRight: Math.max(0, pR.right - cR.right) }
    };
  });
  console.log('=== MODE TABS GEOMETRY ===', JSON.stringify(tabsInfo, null, 2));

  // 2. Inspect card footer buttons
  const leafCardInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.se-node-card'));
    const leafCards = cards.filter(c => c.querySelector('.add-node-item-btn'));
    return leafCards.map((card) => {
      const footer = card.querySelector('.se-node-footer');
      const cardR = card.getBoundingClientRect();
      const btns = footer ? Array.from(footer.querySelectorAll('button')).map(b => {
        const r = b.getBoundingClientRect();
        return {
          text: b.innerText.trim().replace(/\n/g, ' '),
          width: r.width,
          left: r.left,
          right: r.right,
          overflowsLeft: r.left < cardR.left,
          overflowsRight: r.right > cardR.right,
          leftDelta: Math.round((r.left - cardR.left) * 10) / 10
        };
      }) : [];
      return {
        nodeId: card.dataset.nodeId,
        cardWidth: cardR.width,
        cardLeft: cardR.left,
        cardRight: cardR.right,
        footerScrollW: footer ? footer.scrollWidth : 0,
        footerClientW: footer ? footer.clientWidth : 0,
        btns
      };
    });
  });
  console.log('=== LEAF CARDS FOOTER GEOMETRY ===', JSON.stringify(leafCardInfo, null, 2));

  // 3. Inspect Color Differentiation checkbox status
  const colorDiffStatus = await page.evaluate(() => {
    const el = document.querySelector('#color-differentiation');
    const editor = window.editor;
    return {
      elementExists: Boolean(el),
      editorColorDiff: editor ? editor.colorDifferentiation : null
    };
  });
  console.log('=== COLOR DIFF STATUS ===', JSON.stringify(colorDiffStatus, null, 2));

  // Force all footers visible for screenshots
  await page.evaluate(() => {
    document.querySelectorAll('.se-node-footer').forEach(f => {
      f.style.opacity = '1';
      f.style.visibility = 'visible';
    });
  });
  await page.waitForTimeout(200);

  // Screenshots: capture directly from elements
  const sidebarTabs = await page.$('#se-display-mode-tabs');
  if (sidebarTabs) {
    await sidebarTabs.screenshot({ path: `${ARTIFACTS_DIR}/crop_stage1_s2_mode_tabs.png` });
  }

  const leafCard = await page.$('.se-node-card:has(.add-node-item-btn)');
  if (leafCard) {
    await leafCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
    await leafCard.screenshot({ path: `${ARTIFACTS_DIR}/crop_stage1_s2_leaf_card_hover.png` });
  }

  // Full page screenshots
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage1_s2_verified_1280x720.png`, fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${ARTIFACTS_DIR}/stage1_s2_verified_1280x800.png`, fullPage: false });

  await browser.close();
  console.log('Inspection completed successfully.');
}

main().catch(console.error);
