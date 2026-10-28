import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE_URL = process.env.ACTRA_BASE_URL || 'http://127.0.0.1:8000';
const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

async function verifyOnboardingVisuals() {
  console.log('🚀 Starting Full Onboarding & Reference Visual Verification...');

  const browser = await chromium.launch({ headless: true });

  for (const height of [800, 720]) {
    console.log(`\n======================================================`);
    console.log(`📐 TESTING VIEWPORT: 1280 × ${height}`);
    console.log(`======================================================`);

    const context = await browser.newContext({
      viewport: { width: 1280, height }
    });

    // Authenticate
    await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
      headers: { Origin: BASE_URL }
    });

    const page = await context.newPage();

    // -----------------------------------------------------------------------
    // PART A: REFERENCE ("СПРАВОЧНИК") PAGE AUDIT
    // -----------------------------------------------------------------------
    console.log('📖 [Part A] Loading Reference page with hash #sequence-hierarchy-editor-authoring...');
    await page.goto(`${BASE_URL}/reference#sequence-hierarchy-editor-authoring`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // Verify tour item is active in Reference sidebar
    const activeItemText = await page.evaluate(() => {
      const activeEl = document.querySelector('[data-reference-tour-id="sequence-hierarchy-editor-authoring"].is-active');
      return activeEl ? activeEl.innerText.replace(/\n/g, ' ') : null;
    });
    console.log(`Active Reference TOC item: "${activeItemText}"`);

    // Wait for preview iframe
    const previewIframe = await page.$('#reference-preview-iframe') || await page.$('iframe');
    if (previewIframe) {
      const iframeSrc = await previewIframe.getAttribute('src');
      console.log(`Reference preview iframe src: ${iframeSrc}`);

      const frame = await previewIframe.contentFrame();
      if (frame) {
        try {
          await frame.waitForSelector('.se-hierarchy-shell', { timeout: 15000 });
          console.log('✅ Hierarchy shell loaded inside Reference preview iframe!');
          await frame.waitForTimeout(1000);
        } catch (e) {
          console.warn('Iframe load notice:', e.message);
        }
      }
    }

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `reference_hierarchy_overview_1280x${height}.png`)
    });

    if (height === 800) {
      // Micro-crop of the handbook sidebar TOC
      const tocEl = await page.$('.reference-toc');
      if (tocEl) {
        const box = await tocEl.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_reference_toc_item.png'),
            clip: {
              x: Math.max(0, box.x),
              y: Math.max(0, box.y),
              width: Math.min(420, box.width),
              height: Math.min(560, box.height)
            }
          });
        }
      }

      // Micro-crop of the preview frame header & canvas
      if (previewIframe) {
        const box = await previewIframe.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_reference_preview_canvas.png'),
            clip: {
              x: Math.max(0, box.x),
              y: Math.max(0, box.y),
              width: Math.min(780, box.width),
              height: Math.min(520, box.height)
            }
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // PART B: SEQUENCE EDITOR - LINEAR TOUR STEP 5
    // -----------------------------------------------------------------------
    console.log('\n🧭 [Part B] Sequence Editor: Linear Sequence Tour Step 5...');
    await page.goto(`${BASE_URL}/editor/Sequence%20Assembly%20Editor%20Procedural%20Steps.html?onboarding_preview=sequence-editor-authoring&onboarding_state=5`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);

    await page.evaluate(async () => {
      if (window.OnboardingTour && typeof window.OnboardingTour.start === 'function') {
        const activeStep = document.querySelector('[data-onboarding-target="sequence-display-mode-block"]');
        const hasCallout = document.querySelector('.onboarding-tour-callout');
        if (!hasCallout) {
          await window.OnboardingTour.start('sequence-editor-authoring', { force: true, initialStep: 4 });
        }
      }
    });
    await page.waitForTimeout(1500);

    // Verify step 5 callouts, beacon, and branch CTA
    const step5Metrics = await page.evaluate(() => {
      const callouts = Array.from(document.querySelectorAll('.onboarding-tour-callout')).map(el => {
        const titleEl = el.querySelector('.onboarding-tour-callout-title');
        const bodyEl = el.querySelector('.onboarding-tour-callout-body');
        return {
          title: titleEl?.textContent?.trim() || '',
          body: bodyEl?.textContent?.trim() || '',
          unclipped: el.scrollWidth <= el.offsetWidth + 1
        };
      });

      const beacon = document.querySelector('.onboarding-tour-beacon');
      const branchBtn = document.querySelector('[data-onboarding-start-tour="sequence-hierarchy-editor-authoring"]');

      return {
        calloutCount: callouts.length,
        callouts,
        hasBeacon: Boolean(beacon),
        beaconLabel: beacon?.getAttribute('aria-label') || beacon?.getAttribute('title') || '',
        hasBranchBtn: Boolean(branchBtn),
        branchBtnLabel: branchBtn?.textContent?.trim() || '',
        branchBtnTarget: branchBtn?.getAttribute('data-onboarding-start-tour') || ''
      };
    });
    console.log('Step 5 Metrics:', JSON.stringify(step5Metrics, null, 2));

    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_linear_step5_1280x${height}.png`)
    });

    if (height === 800) {
      // Micro-crop mode block callout + beacon
      const modeBlock = await page.$('[data-onboarding-target="sequence-display-mode-block"]');
      if (modeBlock) {
        const box = await modeBlock.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_linear_step5_mode_callout_beacon.png'),
            clip: {
              x: Math.max(0, box.x - 420),
              y: Math.max(0, box.y - 30),
              width: 560,
              height: 290
            }
          });
        }
      }

      // Micro-crop controls bar with [ Иерархии ] CTA
      const controlsBar = await page.$('.onboarding-tour-control');
      if (controlsBar) {
        const box = await controlsBar.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_linear_step5_branch_cta.png'),
            clip: {
              x: Math.max(0, box.x - 20),
              y: Math.max(0, box.y - 10),
              width: Math.min(1280, box.width + 40),
              height: box.height + 20
            }
          });
        }
      }
    }

    // -----------------------------------------------------------------------
    // PART C: SEQUENCE EDITOR - HIERARCHY SISTER TOUR (ALL 5 STEPS)
    // -----------------------------------------------------------------------
    console.log('\n🌿 [Part C] Sequence Editor: Hierarchy Sister Tour...');

    // Click branch button [ Иерархии ]
    const branchClicked = await page.evaluate(() => {
      const branchBtn = document.querySelector('[data-onboarding-start-tour="sequence-hierarchy-editor-authoring"]');
      if (branchBtn) {
        branchBtn.click();
        return true;
      }
      return false;
    });
    console.log(`Branch button clicked: ${branchClicked}`);
    await page.waitForTimeout(2000);

    const activeTourId = await page.evaluate(() => document.body.dataset.onboardingTourId);
    console.log(`Active tour after branch: ${activeTourId}`);

    // Step 1: Mode switch
    console.log('Capturing Step 1: hierarchy-mode-switch');
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_hierarchy_step1_1280x${height}.png`)
    });

    if (height === 800) {
      const modeBlock = await page.$('[data-onboarding-target="sequence-display-mode-block"]');
      if (modeBlock) {
        const box = await modeBlock.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_hierarchy_step1_mode_switch.png'),
            clip: {
              x: Math.max(0, box.x - 380),
              y: Math.max(0, box.y - 30),
              width: 520,
              height: 260
            }
          });
        }
      }
    }

    // Step 2: Columns
    console.log('Capturing Step 2: hierarchy-columns');
    await page.evaluate(() => {
      const nextBtn = document.querySelector('[data-onboarding-action="next"]');
      if (nextBtn) nextBtn.click();
    });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_hierarchy_step2_1280x${height}.png`)
    });

    if (height === 800) {
      const colHeader = await page.$('[data-onboarding-target="sequence-hierarchy-first-column"]');
      if (colHeader) {
        const box = await colHeader.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_hierarchy_step2_col_callout.png'),
            clip: {
              x: Math.max(0, box.x - 20),
              y: Math.max(0, box.y - 10),
              width: 580,
              height: 380
            }
          });
        }
      }
    }

    // Step 3: Levels
    console.log('Capturing Step 3: hierarchy-levels');
    await page.evaluate(() => {
      const nextBtn = document.querySelector('[data-onboarding-action="next"]');
      if (nextBtn) nextBtn.click();
    });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_hierarchy_step3_1280x${height}.png`)
    });

    if (height === 800) {
      const tierCell = await page.$('[data-onboarding-target="sequence-hierarchy-first-tier"]');
      if (tierCell) {
        const box = await tierCell.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_hierarchy_step3_tier_callout.png'),
            clip: {
              x: Math.max(0, box.x - 20),
              y: Math.max(0, box.y - 20),
              width: 580,
              height: 320
            }
          });
        }
      }
    }

    // Step 4: Nodes
    console.log('Capturing Step 4: hierarchy-nodes');
    await page.evaluate(() => {
      const nextBtn = document.querySelector('[data-onboarding-action="next"]');
      if (nextBtn) nextBtn.click();
    });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_hierarchy_step4_1280x${height}.png`)
    });

    if (height === 800) {
      const nodeCard = await page.$('[data-onboarding-target="sequence-hierarchy-first-node"]');
      if (nodeCard) {
        const box = await nodeCard.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_hierarchy_step4_node_callout.png'),
            clip: {
              x: Math.max(0, box.x - 30),
              y: Math.max(0, box.y - 10),
              width: 520,
              height: 380
            }
          });
        }
      }
    }

    // Step 5: Settings and [ К линейной ] return button
    console.log('Capturing Step 5: hierarchy-settings');
    await page.evaluate(() => {
      const nextBtn = document.querySelector('[data-onboarding-action="next"]');
      if (nextBtn) nextBtn.click();
    });
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, `tour_hierarchy_step5_1280x${height}.png`)
    });

    const step5HierarchyMetrics = await page.evaluate(() => {
      const returnBtn = document.querySelector('[data-onboarding-action="return-tour"]');
      const callout = document.querySelector('.onboarding-tour-callout');
      return {
        hasReturnBtn: Boolean(returnBtn),
        returnBtnText: returnBtn?.textContent?.trim() || '',
        returnTourTarget: returnBtn?.getAttribute('data-onboarding-return-tour') || '',
        calloutTitle: callout?.querySelector('.onboarding-tour-callout-title')?.textContent?.trim() || '',
        calloutBody: callout?.querySelector('.onboarding-tour-callout-body')?.textContent?.trim() || ''
      };
    });
    console.log('Hierarchy Step 5 Metrics:', JSON.stringify(step5HierarchyMetrics, null, 2));

    if (height === 800) {
      const controlsBar = await page.$('.onboarding-tour-control');
      if (controlsBar) {
        const box = await controlsBar.boundingBox();
        if (box) {
          await page.screenshot({
            path: path.join(ARTIFACTS_DIR, 'crop_hierarchy_step5_return_cta.png'),
            clip: {
              x: Math.max(0, box.x - 20),
              y: Math.max(0, box.y - 10),
              width: Math.min(1280, box.width + 40),
              height: box.height + 20
            }
          });
        }
      }
    }

    // Verify returning back to linear tour
    console.log('Testing Return to Linear Tour button...');
    const returnClicked = await page.evaluate(() => {
      const returnBtn = document.querySelector('[data-onboarding-action="return-tour"]');
      if (returnBtn) {
        returnBtn.click();
        return true;
      }
      return false;
    });
    console.log(`Return button clicked: ${returnClicked}`);
    await page.waitForTimeout(1500);

    const afterReturnState = await page.evaluate(() => ({
      activeTourId: document.body.dataset.onboardingTourId || '',
      displayMode: window.editor ? window.editor.displayMode : null
    }));
    console.log('State after return to linear:', JSON.stringify(afterReturnState));

    await context.close();
  }

  await browser.close();
  console.log('\n🎉 Visual Verification run complete! All screenshots and micro-crops saved to artifacts.');
}

verifyOnboardingVisuals().catch((err) => {
  console.error('❌ Verification run failed:', err);
  process.exit(1);
});
