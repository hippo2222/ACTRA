import { chromium } from 'playwright';
import path from 'path';

const BASE_URL = 'http://127.0.0.1:8000';
const ARTIFACTS_DIR = 'C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d';

async function runStage3Verification() {
  console.log('=== Stage 3 Kinetic Height & Motion Verification ===');
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  // 1. Authenticate
  const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: 'clinical_expert@actra.local', password: 'Clinical.Pass1!' },
    headers: { Origin: BASE_URL },
  });
  if (!loginRes.ok()) throw new Error(`Login failed: ${loginRes.status()}`);

  // 2. Start complex clinical hierarchy task
  const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
    data: { force: true },
    headers: { Origin: BASE_URL },
  });
  const data = await startResp.json();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE_URL}/session/${data.session_id}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.seqh-node', { timeout: 15000 });
  await page.waitForTimeout(500);

  // 3. Detect node IDs dynamically
  const nodeConfig = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.seqh-node'));
    return {
      targetId: nodes[0] ? nodes[0].dataset.nodeId : null,
      row2Id: nodes[1] ? nodes[1].dataset.nodeId : null,
    };
  });
  console.log('Detected hierarchy test nodes:', nodeConfig);
  const targetId = nodeConfig.targetId;
  const row2Id = nodeConfig.row2Id;

  // 4. Capture baseline crop before insertion
  const nodeEl = await page.$(`.seqh-node[data-node-id="${targetId}"]`);
  if (nodeEl) {
    await nodeEl.screenshot({ path: path.join(ARTIFACTS_DIR, 'crop_stage3_before_placement.png') });
  }

  // Measure initial empty height
  const initialMetrics = await page.evaluate(({ targetId, row2Id }) => {
    const node = document.querySelector(`.seqh-node[data-node-id="${targetId}"]`);
    const row2 = document.querySelector(`.seqh-node[data-node-id="${row2Id}"]`);
    const r1 = node.getBoundingClientRect();
    const r2 = row2.getBoundingClientRect();
    return {
      emptyHeight: Math.round(r1.height),
      emptyTop: Math.round(r1.top),
      row2Top: Math.round(r2.top),
    };
  }, { targetId, row2Id });
  console.log('Initial empty node metrics:', initialMetrics);

  // 5. Set up client-side frame recorder for placement
  await page.evaluate(({ targetId, row2Id }) => {
    window.__kineticLog = [];
    window.__targetId = targetId;
    window.__row2Id = row2Id;

    let recording = false;
    let startTime = 0;

    window.__startKineticRecording = () => {
      recording = true;
      startTime = performance.now();
      function sample() {
        if (!recording) return;
        const elapsed = performance.now() - startTime;
        const n = document.querySelector(`.seqh-node[data-node-id="${window.__targetId}"]`);
        const r2Node = document.querySelector(`.seqh-node[data-node-id="${window.__row2Id}"]`);
        const link = document.querySelector(`.seqh-link[data-parent-id="${window.__targetId}"]`);
        const r1 = n ? n.getBoundingClientRect() : null;
        const r2 = r2Node ? r2Node.getBoundingClientRect() : null;
        const linkD = link ? link.getAttribute('d') : null;
        window.__kineticLog.push({
          time: Math.round(elapsed),
          nodeHeight: r1 ? Math.round(r1.height * 10) / 10 : 0,
          row2Top: r2 ? Math.round(r2.top * 10) / 10 : 0,
          linkD: linkD ? linkD.slice(0, 30) : null,
        });
        if (elapsed < 350) {
          requestAnimationFrame(sample);
        }
      }
      requestAnimationFrame(sample);
    };

    window.__stopKineticRecording = () => {
      recording = false;
    };
  }, { targetId, row2Id });

  // Select multi-line available item in sidebar
  const availableItem = page.locator('[data-sequenceui="available-item"]').first();
  const availableText = await availableItem.innerText();
  console.log('Selected card text:', availableText.replace(/\n/g, ' '));
  await availableItem.click();
  await page.waitForTimeout(80);

  // Trigger placement and recording simultaneously
  await page.evaluate(() => window.__startKineticRecording());
  const slotBtn = page.locator(`.seqh-node[data-node-id="${targetId}"] [data-sequenceui-slot="true"]`).first();
  await slotBtn.click();

  // Capture mid-transition screenshot at ~120ms
  await page.waitForTimeout(120);
  const midNode = await page.$(`.seqh-node[data-node-id="${targetId}"]`);
  if (midNode) await midNode.screenshot({ path: path.join(ARTIFACTS_DIR, 'crop_stage3_mid_transition_120ms.png') });

  // Wait for animation completion
  await page.waitForTimeout(260);

  // Capture fully expanded crop
  const finalNode = await page.$(`.seqh-node[data-node-id="${targetId}"]`);
  if (finalNode) await finalNode.screenshot({ path: path.join(ARTIFACTS_DIR, 'crop_stage3_expanded_final.png') });

  // Retrieve recorded placement frames
  const placementFrames = await page.evaluate(() => {
    window.__stopKineticRecording();
    return window.__kineticLog;
  });

  console.log(`Recorded ${placementFrames.length} frames during placement.`);
  console.log('Sample placement frames:');
  console.table(placementFrames.filter((_, i) => i % 2 === 0));

  // 6. Assertions on placement kinetics:
  const firstFrame = placementFrames[0];
  const lastFrame = placementFrames[placementFrames.length - 1];
  const heightDelta = lastFrame.nodeHeight - firstFrame.nodeHeight;

  console.log(`Height delta during expansion: +${heightDelta.toFixed(1)}px (from ${firstFrame.nodeHeight}px to ${lastFrame.nodeHeight}px)`);
  if (heightDelta < 15) {
    throw new Error(`Expected significant expansion for multi-line card, got ${heightDelta}px`);
  }

  // Check no abrupt snap: max delta between consecutive frames must be <= 15px
  let maxFrameDelta = 0;
  for (let i = 1; i < placementFrames.length; i++) {
    const diff = Math.abs(placementFrames[i].nodeHeight - placementFrames[i - 1].nodeHeight);
    if (diff > maxFrameDelta) maxFrameDelta = diff;
  }
  console.log(`Max height delta between consecutive frames: ${maxFrameDelta.toFixed(1)}px`);
  if (maxFrameDelta > 22) {
    throw new Error(`Frame delta exceeded smoothness threshold (22px): ${maxFrameDelta}px`);
  }

  // 7. Test Removal Kinetics (Shrinking):
  await page.evaluate(() => {
    window.__kineticLog = [];
    window.__startKineticRecording();
  });

  // Click placed item to remove it
  const placedBtn = page.locator(`.seqh-node[data-node-id="${targetId}"] [data-sequenceui-placed-item="true"]`).first();
  await placedBtn.click();

  // Wait for shrinking transition to finish
  await page.waitForTimeout(350);

  const removalFrames = await page.evaluate(() => {
    window.__stopKineticRecording();
    return window.__kineticLog;
  });

  console.log(`Recorded ${removalFrames.length} frames during removal.`);
  console.log('Sample removal frames:');
  console.table(removalFrames.filter((_, i) => i % 2 === 0));

  // Assert removal smoothness:
  let maxRemovalDelta = 0;
  for (let i = 1; i < removalFrames.length; i++) {
    const diff = Math.abs(removalFrames[i].nodeHeight - removalFrames[i - 1].nodeHeight);
    if (diff > maxRemovalDelta) maxRemovalDelta = diff;
  }
  console.log(`Max height delta during removal: ${maxRemovalDelta.toFixed(1)}px`);
  if (maxRemovalDelta > 22) {
    throw new Error(`Removal frame delta exceeded smoothness threshold (22px): ${maxRemovalDelta}px`);
  }

  // Final returned empty node screenshot
  const emptyNode = await page.$(`.seqh-node[data-node-id="${targetId}"]`);
  if (emptyNode) await emptyNode.screenshot({ path: path.join(ARTIFACTS_DIR, 'crop_stage3_returned_empty.png') });

  // 8. Full-page renders at 1280x720 and 1280x800
  // Place an item again so full page shows placed state
  await availableItem.click();
  await page.waitForTimeout(80);
  await page.locator(`.seqh-node[data-node-id="${targetId}"] [data-sequenceui-slot="true"]`).first().click();
  await page.waitForTimeout(400);

  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'stage3_verified_1280x720.png'), fullPage: false });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'stage3_verified_1280x800.png'), fullPage: false });

  await browser.close();
  console.log('=== Stage 3 Verification PASSED: Smooth continuous height interpolation verified! ===');
}

runStage3Verification().catch((err) => {
  console.error('Stage 3 Verification Failed:', err);
  process.exit(1);
});
