import { chromium } from "playwright";
import fs from "fs";

async function run() {
  const b = await chromium.launch();
  const c = await b.newContext();
  await c.request.post("http://127.0.0.1:8000/api/auth/login", {
    data: { identifier: "clinical_expert@actra.local", password: "Clinical.Pass1!" },
    headers: { Origin: "http://127.0.0.1:8000" },
  });
  const p = await c.newPage();
  await p.setViewportSize({ width: 1280, height: 800 });
  const sessionInfo = JSON.parse(
    fs.readFileSync("tests/fixtures/clinical_fixtures/live_stand_session_info.json", "utf8")
  );
  await p.goto(sessionInfo.sessionUrl);
  await p.waitForSelector(".seqh-shell");

  const cardChildren = await p.evaluate(() => {
    const card = document.querySelector('[data-sequenceui="available-card"]');
    if (!card) return null;
    return Array.from(card.children).map((c) => ({
      tag: c.tagName,
      cls: c.className,
      rect: c.getBoundingClientRect(),
      text: c.textContent.trim().slice(0, 50),
    }));
  });

  console.log("CARD CHILDREN:", JSON.stringify(cardChildren, null, 2));
  await b.close();
}

run().catch(console.error);
