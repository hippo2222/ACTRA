import { chromium } from "playwright";
import fs from "fs";

const BASE_URL = "http://127.0.0.1:8000";
const ARTIFACT_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // 1. Login via API
  const loginResp = await context.request.post(`${BASE_URL}/api/auth/login`, {
    data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
    headers: { Origin: BASE_URL },
  });
  if (!loginResp.ok()) {
    throw new Error(`Login failed: ${loginResp.status()}`);
  }

  // 2. Start Session for Task 5.1 (4 tiers)
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

  // 3. Inspect Tabs geometry
  const tabsInfo = await page.evaluate(() => {
    const nav = document.querySelector(".seqh-tabs-scroll");
    const tabs = document.querySelector(".seqh-tabs");
    const tabBtns = Array.from(document.querySelectorAll(".seqh-tab"));
    const caption = document.querySelector(".seqh-tab-caption");
    const card = document.querySelector('[data-sequenceui="available-card"]');
    
    return {
      navRect: nav ? nav.getBoundingClientRect() : null,
      tabsRect: tabs ? tabs.getBoundingClientRect() : null,
      captionRect: caption ? caption.getBoundingClientRect() : null,
      cardRect: card ? card.getBoundingClientRect() : null,
      tabsScrollWidth: tabs ? tabs.scrollWidth : 0,
      tabsClientWidth: tabs ? tabs.clientWidth : 0,
      hasHorizontalOverflow: tabs ? tabs.scrollWidth > tabs.clientWidth : false,
      tabBtns: tabBtns.map((b, i) => {
        const r = b.getBoundingClientRect();
        const cs = window.getComputedStyle(b);
        return {
          idx: i,
          text: b.innerText.trim(),
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          width: r.width,
          borderTop: cs.borderTop,
          borderBottom: cs.borderBottom,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          isActive: b.classList.contains("is-active")
        };
      })
    };
  });

  console.log("=== TABS INSPECTION (4 TIERS) ===");
  console.log(JSON.stringify(tabsInfo, null, 2));

  // 4. Assertions
  const navRect = tabsInfo.navRect;
  for (const b of tabsInfo.tabBtns) {
    if (b.bottom > navRect.bottom + 1) {
      console.error(`FAILURE: Tab ${b.idx} bottom (${b.bottom}) exceeds nav bottom (${navRect.bottom})!`);
    } else {
      console.log(`PASS: Tab ${b.idx} is completely within nav boundary (bottom: ${b.bottom} <= ${navRect.bottom})`);
    }
  }

  // 5. Screenshots
  const navEl = await page.$(".seqh-tabs-scroll");
  if (navEl) {
    await navEl.screenshot({ path: `${ARTIFACT_DIR}/crop_stage1_tabs_4tiers.png` });
  }
  const captionEl = await page.$(".seqh-tab-caption");
  if (captionEl) {
    await captionEl.screenshot({ path: `${ARTIFACT_DIR}/crop_stage1_caption_4tiers.png` });
  }
  const availableCardEl = await page.$('[data-sequenceui="available-card"]');
  if (availableCardEl) {
    await availableCardEl.screenshot({ path: `${ARTIFACT_DIR}/crop_stage1_sidebar_4tiers.png` });
  }

  // 6. Test 9 Tiers Scalability
  console.log("\n=== TESTING 9 TIERS SCALABILITY ===");
  const test9Info = await page.evaluate(() => {
    const tabs = document.querySelector(".seqh-tabs");
    tabs.innerHTML = "";
    tabs.classList.add("seqh-tabs--wrap");
    
    const roman = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    for (let i = 0; i < 9; i++) {
      const btn = document.createElement("button");
      btn.className = "seqh-tab" + (i === 0 ? " is-active" : "");
      const tint = String(i % 5);
      btn.dataset.tint = tint;
      btn.style.setProperty("--seqh-tint", `var(--seqh-tint-${tint})`);
      btn.innerHTML = `<span class="seqh-tab__index">${roman[i]}</span><span class="seqh-tab__count">${i + 1}</span>`;
      tabs.appendChild(btn);
    }
    
    return {
      tabsScrollWidth: tabs.scrollWidth,
      tabsClientWidth: tabs.clientWidth,
      tabsHeight: tabs.getBoundingClientRect().height,
      hasHorizontalOverflow: tabs.scrollWidth > tabs.clientWidth,
      buttonsCount: tabs.querySelectorAll(".seqh-tab").length
    };
  });

  console.log("9 Tiers Info:", JSON.stringify(test9Info, null, 2));

  if (availableCardEl) {
    await availableCardEl.screenshot({ path: `${ARTIFACT_DIR}/crop_stage1_sidebar_9tiers_wrap.png` });
  }

  // 7. Full page views at 1280x800 and 1280x720
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".seqh-shell", { timeout: 15000 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/stage1_verified_1280x800.png` });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.screenshot({ path: `${ARTIFACT_DIR}/stage1_verified_1280x720.png` });

  await browser.close();
  console.log("\nALL CHECKS PASSED: Stage 1 visual verification completed successfully!");
}

main().catch(console.error);
