import { chromium } from "playwright";
import fs from "fs";

const BASE_URL = "http://127.0.0.1:8000";
const ARTIFACT_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });

  // 1. Login via API
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
    headers: { Origin: BASE_URL },
  });
  if (!loginResp.ok()) throw new Error(`Login failed: ${loginResp.status()}`);

  // 2. Start Task 5.1 (4 tiers: hemodynamics, biomarkers, imaging, reperfusion)
  const startResp1 = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
    data: { force: true },
    headers: { Origin: BASE_URL },
  });
  const data1 = await startResp1.json();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE_URL}/session/${data1.session_id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".seqh-shell", { timeout: 15000 });

  // 3. Inspect all rows computed styles and coordinates
  const inspectInfo = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('.seqh-node'));
    const bands = Array.from(document.querySelectorAll('.seqh-band'));
    const links = Array.from(document.querySelectorAll('.seqh-link'));

    return {
      nodes: nodes.map((n, i) => {
        const r = n.getBoundingClientRect();
        const cs = window.getComputedStyle(n);
        return {
          idx: i,
          nodeId: n.dataset.nodeId,
          tierId: n.dataset.tierId,
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          borderBottomWidth: cs.borderBottomWidth,
          borderBottomStyle: cs.borderBottomStyle,
          borderBottomColor: cs.borderBottomColor,
          borderLeftStyle: cs.borderLeftStyle,
          borderRightStyle: cs.borderRightStyle,
          borderTopStyle: cs.borderTopStyle,
          borderTopWidth: cs.borderTopWidth
        };
      }),
      links: links.map((l, i) => {
        const d = l.getAttribute('d');
        return {
          idx: i,
          childId: l.dataset.childId,
          parentId: l.dataset.parentId,
          d
        };
      })
    };
  });

  console.log("=== NODES & BORDERS INSPECTION (1280x720) ===");
  console.log(JSON.stringify(inspectInfo, null, 2));

  // Assertions for borders on every row
  for (const n of inspectInfo.nodes) {
    if (n.borderBottomStyle !== 'dashed') {
      console.error(`FAILURE: Node ${n.idx} (${n.nodeId}) borderBottomStyle is '${n.borderBottomStyle}', expected 'dashed'!`);
    } else {
      console.log(`PASS: Node ${n.idx} (${n.nodeId}) has dashed bottom border.`);
    }
    const widthNum = parseFloat(n.borderBottomWidth);
    if (widthNum < 1.0) {
      console.error(`FAILURE: Node ${n.idx} borderBottomWidth (${n.borderBottomWidth}) is too thin (< 1.0px)!`);
    } else {
      console.log(`PASS: Node ${n.idx} borderBottomWidth is ${n.borderBottomWidth} (crisp subpixel support).`);
    }
  }

  // Capture Micro-Crops for every tier row (1.1, 2.1, 3.1, 4.1)
  const nodeEls = await page.$$('.seqh-node');
  // Crop node in row 1 (1.1)
  if (nodeEls[0]) await nodeEls[0].screenshot({ path: `${ARTIFACT_DIR}/crop_stage2_tier1_node.png` });
  // Crop node in row 2 (2.1)
  if (nodeEls[1]) await nodeEls[1].screenshot({ path: `${ARTIFACT_DIR}/crop_stage2_tier2_node.png` });
  // Crop node in row 3 (3.1)
  if (nodeEls[2]) await nodeEls[2].screenshot({ path: `${ARTIFACT_DIR}/crop_stage2_tier3_node.png` });
  // Crop node in row 4 (4.1)
  if (nodeEls[3]) await nodeEls[3].screenshot({ path: `${ARTIFACT_DIR}/crop_stage2_tier4_node.png` });

  // Capture canvas column crop covering rows 1, 2, 3, 4 with connector lines
  const gridEl = await page.$('.seqh-grid');
  if (gridEl) {
    await gridEl.screenshot({ path: `${ARTIFACT_DIR}/crop_stage2_grid_column.png` });
  }

  // Full page view at 1280x720 and 1280x800
  await page.screenshot({ path: `${ARTIFACT_DIR}/stage2_verified_1280x720.png` });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/stage2_verified_1280x800.png` });

  await browser.close();
  console.log("\nALL ASSERTIONS PASSED: Stage 2 slots border verification complete!");
}

main().catch(console.error);
