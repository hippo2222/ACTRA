import { chromium } from "playwright";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.ACTRA_BASE_URL || "http://127.0.0.1:8000";
const ARTIFACTS_DIR = "C:/Users/ASUS/.gemini/antigravity/brain/359934c7-7eec-4920-bb3f-9d25160c801d";

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

const table51Task = {
  task_data: {
    content: {
      prompt: "Таблица 5.1. Дифференциальная диагностика: Пневмоторакс vs Обтурационный ателектаз",
      display_mode: "hierarchy",
      elements: [
        { id: "e1", text: "Смещение в противоположную (здоровую) сторону" },
        { id: "e2", text: "Опущен и уплощен, экскурсия ограничена" },
        { id: "e3", text: "Смещение в сторону поражения (коллапса)" },
        { id: "e4", text: "Поднят вверх, купол деформирован" },
      ],
      levels: [
        { level_id: "lvl_1", label: "Положение средостения", blocks: ["e1", "e3"] },
        { level_id: "lvl_2", label: "Положение купола диафрагмы", blocks: ["e2", "e4"] },
      ],
      nodes: [
        {
          node_id: "n_ptx_1",
          level_id: "lvl_1",
          parent_id: null,
          column_title: "Пневмоторакс",
          slots: ["e1"],
        },
        {
          node_id: "n_ptx_2",
          level_id: "lvl_2",
          parent_id: "n_ptx_1",
          column_title: "Пневмоторакс",
          slots: ["e2"],
        },
        {
          node_id: "n_atel_1",
          level_id: "lvl_1",
          parent_id: null,
          column_title: "Обтурационный ателектаз",
          slots: ["e3"],
        },
        {
          node_id: "n_atel_2",
          level_id: "lvl_2",
          parent_id: "n_atel_1",
          column_title: "Обтурационный ателектаз",
          slots: ["e4"],
        },
      ],
      settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
    },
    settings: { difficulty: 1, shuffle_elements: false, display_mode: "hierarchy" },
  },
};

async function capture() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  try {
    // 1. Authenticate
    const loginRes = await context.request.post(`${BASE_URL}/api/auth/login`, {
      data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
      headers: { Origin: BASE_URL },
    });
    if (!loginRes.ok()) throw new Error(`Login failed with status ${loginRes.status()}`);

    // 2. Start Session
    const startRes = await context.request.post(`${BASE_URL}/api/session/clinical_hierarchy_complex/start`, {
      data: { force: true },
      headers: { Origin: BASE_URL },
    });
    const startData = await startRes.json();
    const sessionUrl = `${BASE_URL}/session/${startData.session_id}`;

    const page = await context.newPage();
    page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(sessionUrl, { waitUntil: "networkidle" });
    await page.waitForSelector(".seqh-shell", { timeout: 15000 });
    await page.waitForTimeout(300);

    // Render Table 5.1 task directly to inspect textbook table in Player
    await page.evaluate((task) => {
      const container = document.querySelector("#sequence-root, [data-task-container], .task-content-area, main") || document.body;
      const target = document.querySelector(".seq-root-wrap") || container;
      window.SequenceUI.render(target, task);
    }, table51Task);

    await page.waitForTimeout(400);

    // Place an element to verify de-nested single slot
    await page.evaluate(() => {
      const inst = window.SequenceUI.__testHooks.getCurrentInstance();
      if (inst && typeof inst.placeElementIntoLevel === "function") {
        inst.placeElementIntoLevel(0, 0, "e1");
      }
    });

    await page.waitForTimeout(300);

    // 1. Full viewport 1280x800
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, "stage3_s1_player_verified_1280x800.png"),
      fullPage: false,
    });
    console.log("Captured stage3_s1_player_verified_1280x800.png");

    // 2. Full viewport 1280x720
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(200);
    await page.screenshot({
      path: path.join(ARTIFACTS_DIR, "stage3_s1_player_verified_1280x720.png"),
      fullPage: false,
    });
    console.log("Captured stage3_s1_player_verified_1280x720.png");

    // 3. Micro-crop: Corner Spacer & Headers Area
    const grid = await page.$(".seqh-grid");
    if (grid) {
      const box = await grid.boundingBox();
      if (box) {
        await page.screenshot({
          path: path.join(ARTIFACTS_DIR, "crop_stage3_corner_spacer.png"),
          clip: {
            x: Math.max(0, box.x),
            y: Math.max(0, box.y),
            width: Math.min(600, box.width),
            height: 180,
          },
        });
        console.log("Captured crop_stage3_corner_spacer.png");
      }
    }

    // 4. Micro-crop: Column Header (Roman numeral badge + title)
    const colHeader = await page.$(".seqh-col-header");
    if (colHeader) {
      await colHeader.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage3_col_header.png"),
      });
      console.log("Captured crop_stage3_col_header.png");
    }

    // 5. Micro-crop: Node Card with Column Tag
    const cardWithTag = await page.$(".seqh-node[data-col-idx='0']");
    if (cardWithTag) {
      await cardWithTag.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage3_col_tag.png"),
      });
      console.log("Captured crop_stage3_col_tag.png");
    }

    // 6. Micro-crop: Placed De-nested Slot
    const placedSlot = await page.$(".seqh-node[data-slot-count='1']");
    if (placedSlot) {
      await placedSlot.screenshot({
        path: path.join(ARTIFACTS_DIR, "crop_stage3_denested_slot.png"),
      });
      console.log("Captured crop_stage3_denested_slot.png");
    }

    console.log("All Stage 3 player screenshots and micro-crops generated successfully!");
  } finally {
    await browser.close();
  }
}

capture().catch((err) => {
  console.error("Capture failure:", err);
  process.exit(1);
});
