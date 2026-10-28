import { chromium } from "playwright";
import fs from "fs";

const BASE_URL = "http://127.0.0.1:8000";

async function inspect() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Login
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
    headers: { Origin: BASE_URL },
  });
  if (!loginResp.ok()) {
    throw new Error(`Login failed: ${loginResp.status()}`);
  }

  // Start Session
  const startResp = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
    data: { force: true },
    headers: { Origin: BASE_URL },
  });
  const startData = await startResp.json();
  const s1Url = `${BASE_URL}/session/${startData.session_id}`;

  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(s1Url, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForSelector(".seqh-shell", { timeout: 15000 });
  await page.waitForTimeout(1000);

  // 1. Inspect Tabs
  const tabsInfo = await page.evaluate(() => {
    const scroll = document.querySelector(".seqh-tabs-scroll");
    const tabs = document.querySelector(".seqh-tabs");
    const tabButtons = Array.from(document.querySelectorAll(".seqh-tab")).map(b => {
      const r = b.getBoundingClientRect();
      const style = window.getComputedStyle(b);
      return {
        text: b.innerText,
        rect: { top: r.top, bottom: r.bottom, height: r.height, width: r.width },
        borderBottom: style.borderBottom,
        overflow: style.overflow
      };
    });
    const scrollRect = scroll ? scroll.getBoundingClientRect() : null;
    const tabsRect = tabs ? tabs.getBoundingClientRect() : null;
    const scrollStyle = scroll ? window.getComputedStyle(scroll) : null;
    return {
      scrollRect,
      tabsRect,
      scrollOverflowY: scrollStyle ? scrollStyle.overflowY : null,
      scrollPadding: scrollStyle ? scrollStyle.padding : null,
      tabButtons
    };
  });
  console.log("TABS INFO:", JSON.stringify(tabsInfo, null, 2));

  // Take crop of tabs
  const tabsEl = await page.$(".seqh-tabs-scroll");
  if (tabsEl) {
    await tabsEl.screenshot({ path: "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/crop_inspect_tabs.png" });
  }

  // 2. Inspect Node Slots across tiers (rows)
  const nodesInfo = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".seqh-node")).map(n => {
      const r = n.getBoundingClientRect();
      const style = window.getComputedStyle(n);
      const slot = n.querySelector(".seqh-slot");
      const slotStyle = slot ? window.getComputedStyle(slot) : null;
      const slotR = slot ? slot.getBoundingClientRect() : null;
      return {
        nodeId: n.dataset.nodeId,
        tierId: n.dataset.tierId,
        classes: n.className,
        rect: { top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), width: Math.round(r.width) },
        border: style.border,
        borderBottom: style.borderBottom,
        slotBorder: slotStyle ? slotStyle.border : null,
        slotBorderBottom: slotStyle ? slotStyle.borderBottom : null,
        slotRect: slotR ? { top: Math.round(slotR.top), bottom: Math.round(slotR.bottom), height: Math.round(slotR.height) } : null
      };
    });
    return nodes;
  });
  console.log("NODES INFO:", JSON.stringify(nodesInfo, null, 2));

  // Screenshot stage
  const stageEl = await page.$(".seqh-stage");
  if (stageEl) {
    await stageEl.screenshot({ path: "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/stage_inspect_nodes.png" });
  }

  // Full page screenshot
  await page.screenshot({ path: "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d/full_page_inspect.png" });

  await browser.close();
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
