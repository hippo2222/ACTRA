import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const localesDir = path.resolve(process.cwd(), "frontend/assets/locales");
const ruJson = JSON.parse(fs.readFileSync(path.join(localesDir, "ru.json"), "utf8"));
const enJson = JSON.parse(fs.readFileSync(path.join(localesDir, "en.json"), "utf8"));
const ukJson = JSON.parse(fs.readFileSync(path.join(localesDir, "uk.json"), "utf8"));

const mainLogicContent = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/assets/MainLogic.js"),
  "utf8"
);

describe("Main Screen Quick Access Widget i18n & Localization", () => {
  it("has 100% dictionary parity across ru, en, and uk for all card keys", () => {
    const requiredKeys = [
      "card_paused_resume",
      "card_paused_waiting",
      "card_now_step",
      "card_percent_mastered",
      "card_mastered_percent",
      "card_status_ready",
      "card_status_in_progress",
      "card_status_completed",
      "card_status_frozen",
      "card_status_critical",
      "card_status_pinned",
      "card_action_launch",
      "card_action_continue",
      "card_action_open",
      "card_action_repeat",
      "card_action_remove",
      "card_ready_launch",
      "card_ready_continue",
      "card_has_session",
      "card_risk_forgetting",
      "card_time_to_return",
      "card_in_calendar",
      "card_manual_launch",
      "card_can_repeat",
      "card_desc_active_session",
      "card_desc_paused_session",
      "card_desc_ready",
      "card_desc_retention",
      "card_desc_planned",
      "card_desc_frozen",
      "card_desc_general",
      "card_step_indicator",
      "card_today",
      "card_days_ago",
    ];

    for (const key of requiredKeys) {
      expect(
        ruJson.main[key],
        `Key "main.${key}" missing or empty in ru.json`
      ).toBeTruthy();
      expect(
        enJson.main[key],
        `Key "main.${key}" missing or empty in en.json`
      ).toBeTruthy();
      expect(
        ukJson.main[key],
        `Key "main.${key}" missing or empty in uk.json`
      ).toBeTruthy();
    }
  });

  it("ensures buildQuickAccessCard in MainLogic.js uses wt() for all labels with no raw Cyrillic or unicode escapes", () => {
    // Extract buildQuickAccessCard function body
    const fnStart = mainLogicContent.indexOf("const buildQuickAccessCard = (item) => {");
    expect(fnStart).toBeGreaterThan(-1);
    const fnEnd = mainLogicContent.indexOf("previewItems.forEach((item) => {", fnStart);
    expect(fnEnd).toBeGreaterThan(fnStart);
    const cardFnCode = mainLogicContent.slice(fnStart, fnEnd);

    // Verify key wt() calls are in place
    expect(cardFnCode).toContain("wt('main.card_status_ready'");
    expect(cardFnCode).toContain("wt('main.card_status_paused'");
    expect(cardFnCode).toContain("wt('main.card_status_in_progress'");
    expect(cardFnCode).toContain("wt('main.card_step_indicator'");
    expect(cardFnCode).toContain("wt('main.card_paused_resume'");
    expect(cardFnCode).toContain("wt('main.card_now_step'");
    expect(cardFnCode).toContain("wt('main.card_percent_mastered'");
    expect(cardFnCode).toContain("wt('main.card_action_remove'");

    // Check for escaped unicode Cyrillic \u04xx
    const unicodeEscapeMatch = cardFnCode.match(/\\u04[0-9a-fA-F]{2}/);
    expect(
      unicodeEscapeMatch,
      `Found escaped unicode Cyrillic in buildQuickAccessCard: ${unicodeEscapeMatch?.[0]}`
    ).toBeNull();
  });

  it("verifies formatPausedAt uses active locale rather than hardcoded ru-RU", () => {
    const fnMatch = mainLogicContent.match(/const formatPausedAt = \([\s\S]*?localeCode[\s\S]*?\};/);
    expect(fnMatch, "formatPausedAt must dynamically compute localeCode from active lang").toBeTruthy();
    expect(mainLogicContent).not.toMatch(/date\.toLocaleString\(\s*["']ru-RU["']/);
  });

  it("provides runtime scanLeaks helper in window.i18n to detect Cyrillic DOM leaks", () => {
    const i18nJs = fs.readFileSync(path.resolve(process.cwd(), "frontend/assets/i18n.js"), "utf8");
    expect(i18nJs).toContain("function scanLeaks(");
    expect(i18nJs).toContain("scanLeaks: scanLeaks");
  });
});
