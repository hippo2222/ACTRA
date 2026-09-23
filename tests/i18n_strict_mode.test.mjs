import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { JSDOM } from "jsdom";

describe("i18n Strict Dev Mode (Visual Missing Translation Markers)", () => {
  let dom;
  let i18nCode;

  beforeEach(() => {
    i18nCode = fs.readFileSync(path.resolve(process.cwd(), "frontend/assets/i18n.js"), "utf8");
    dom = new JSDOM(
      `<!DOCTYPE html>
      <html>
        <head></head>
        <body>
          <div data-i18n="app.known_key">Исходный текст</div>
          <div data-i18n="app.untranslated_key">Русский заголовок</div>
          <input data-i18n-placeholder="app.untranslated_placeholder" placeholder="Введите имя" />
          <button data-i18n-title="app.untranslated_title" title="Подсказка">Кнопка</button>
        </body>
      </html>`,
      {
        url: "http://localhost:8000/",
        runScripts: "outside-only",
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupI18n(lang = "ru", localeData = {}) {
    dom.window.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => localeData,
    });
    dom.window.eval(i18nCode);
    dom.window.i18n.applyLocale(localeData, lang);
    return dom.window.i18n;
  }

  describe("Default / Production Mode (Non-strict)", () => {
    it("returns safe fallback when key is missing in Russian", () => {
      const i18n = setupI18n("ru", { "app.known_key": "Известный ключ" });
      expect(i18n.isStrict()).toBe(false);

      const val = i18n.wt("app.missing_key", "Русский фоллбэк");
      expect(val).toBe("Русский фоллбэк");
    });

    it("returns safe fallback when key is missing in English without strict flag", () => {
      const i18n = setupI18n("en", { "app.known_key": "Known key" });
      expect(i18n.isStrict()).toBe(false);

      const val = i18n.wt("app.untranslated_key", "Русский фоллбэк");
      expect(val).toBe("Русский фоллбэк");
    });

    it("does not tag DOM elements with data-i18n-missing in non-strict mode", () => {
      setupI18n("en", { "app.known_key": "Known key" });
      const el = dom.window.document.querySelector('[data-i18n="app.untranslated_key"]');
      expect(el.getAttribute("data-i18n-missing")).toBeNull();
      // in non-strict mode, unlocalized element keeps original content
      expect(el.textContent).toBe("Русский заголовок");
    });
  });

  describe("Strict Mode Activation Mechanisms", () => {
    it("activates via window.i18n.setStrict(true)", () => {
      const i18n = setupI18n("en", {});
      expect(i18n.isStrict()).toBe(false);

      i18n.setStrict(true);
      expect(i18n.isStrict()).toBe(true);

      i18n.setStrict(false);
      expect(i18n.isStrict()).toBe(false);
    });

    it("activates via window.__STRICT_I18N__ flag", () => {
      dom.window.__STRICT_I18N__ = true;
      const i18n = setupI18n("en", {});
      expect(i18n.isStrict()).toBe(true);
    });

    it("activates via localStorage 'actra_i18n_strict'", () => {
      dom.window.localStorage.setItem("actra_i18n_strict", "true");
      const i18n = setupI18n("en", {});
      expect(i18n.isStrict()).toBe(true);
    });

    it("activates via URL query parameter ?i18n_strict=1", () => {
      dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
        url: "http://localhost:8000/?i18n_strict=1",
        runScripts: "outside-only",
      });
      dom.window.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      dom.window.eval(i18nCode);
      expect(dom.window.i18n.isStrict()).toBe(true);
    });
  });

  describe("Strict Mode Behavior on Non-Default Locales (EN, UK)", () => {
    it("returns [MISSING: key] and warns in console when key is missing in English", () => {
      const warnSpy = vi.spyOn(dom.window.console, "warn").mockImplementation(() => {});
      const i18n = setupI18n("en", { "app.known_key": "Known key" });
      i18n.setStrict(true);

      // Known key returns valid translation
      expect(i18n.wt("app.known_key", "Фоллбэк")).toBe("Known key");

      // Missing key returns loud missing marker instead of Russian fallback!
      const missingVal = i18n.wt("app.missing_action", "Русское действие");
      expect(missingVal).toBe("🔴[MISSING: app.missing_action]");

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[i18n:strict] Missing translation for key: "app.missing_action" in locale: "en"')
      );
    });

    it("marks untranslated DOM elements with missing marker and data-i18n-missing attribute", () => {
      vi.spyOn(dom.window.console, "warn").mockImplementation(() => {});
      const i18n = setupI18n("en", { "app.known_key": "Known key" });
      i18n.setStrict(true);

      const knownEl = dom.window.document.querySelector('[data-i18n="app.known_key"]');
      expect(knownEl.textContent).toBe("Known key");
      expect(knownEl.getAttribute("data-i18n-missing")).toBeNull();

      const missingEl = dom.window.document.querySelector('[data-i18n="app.untranslated_key"]');
      expect(missingEl.textContent).toBe("🔴[MISSING: app.untranslated_key]");
      expect(missingEl.getAttribute("data-i18n-missing")).toBe("true");

      const missingInput = dom.window.document.querySelector('[data-i18n-placeholder="app.untranslated_placeholder"]');
      expect(missingInput.getAttribute("placeholder")).toBe("🔴[MISSING: app.untranslated_placeholder]");
      expect(missingInput.getAttribute("data-i18n-missing")).toBe("true");

      const missingBtn = dom.window.document.querySelector('[data-i18n-title="app.untranslated_title"]');
      expect(missingBtn.getAttribute("title")).toBe("🔴[MISSING: app.untranslated_title]");
      expect(missingBtn.getAttribute("data-i18n-missing")).toBe("true");
    });

    it("preserves fallback for Russian even when strict mode is active", () => {
      const i18n = setupI18n("ru", { "app.known_key": "Известный ключ" });
      i18n.setStrict(true);

      // Since Russian is the source locale (DEFAULT_LANG), fallback is the source text
      expect(i18n.wt("app.untranslated_key", "Русский фоллбэк")).toBe("Русский фоллбэк");
    });
  });

  describe("Component Delegation to window.i18n.wt", () => {
    it("ClickUI and task-renderer wt wrappers correctly delegate to strict i18n", () => {
      const i18n = setupI18n("en", {});
      i18n.setStrict(true);
      vi.spyOn(dom.window.console, "warn").mockImplementation(() => {});

      // S1 task-renderer wt wrapper
      function taskRendererWt(key, fallback) {
        if (typeof dom.window !== 'undefined' && dom.window.i18n && typeof dom.window.i18n.wt === 'function') {
          return dom.window.i18n.wt(key, fallback);
        }
        return fallback;
      }

      // ClickUI wt wrapper
      function clickUIWt(key, fallback) {
        if (dom.window.i18n && typeof dom.window.i18n.wt === "function") {
          return dom.window.i18n.wt(key, fallback);
        }
        return fallback;
      }

      expect(taskRendererWt("clickui.missing_chip", "Область")).toBe("🔴[MISSING: clickui.missing_chip]");
      expect(clickUIWt("clickui.missing_button", "Нажми")).toBe("🔴[MISSING: clickui.missing_button]");
    });
  });
});
