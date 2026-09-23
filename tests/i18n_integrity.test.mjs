import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

function walkFiles(dir, ext) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat && stat.isDirectory()) {
      if (file !== "node_modules" && file !== "vendor" && file !== "locales" && file !== ".git") {
        results = results.concat(walkFiles(full, ext));
      }
    } else if (file.endsWith(ext) && !file.endsWith(".min.js")) {
      results.push(full);
    }
  }
  return results;
}

function extractFlattenedKeys(obj, prefix = "") {
  let keys = [];
  for (const k of Object.keys(obj)) {
    const full = prefix ? `${prefix}.${k}` : k;
    if (obj[k] && typeof obj[k] === "object" && !Array.isArray(obj[k])) {
      keys = keys.concat(extractFlattenedKeys(obj[k], full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

const localesDir = path.resolve(process.cwd(), "frontend/assets/locales");
const ruPath = path.join(localesDir, "ru.json");
const enPath = path.join(localesDir, "en.json");
const ukPath = path.join(localesDir, "uk.json");

const ruJson = JSON.parse(fs.readFileSync(ruPath, "utf8"));
const enJson = JSON.parse(fs.readFileSync(enPath, "utf8"));
const ukJson = JSON.parse(fs.readFileSync(ukPath, "utf8"));

const ruFlat = extractFlattenedKeys(ruJson);
const enFlat = extractFlattenedKeys(enJson);
const ukFlat = extractFlattenedKeys(ukJson);

const ruSet = new Set(ruFlat);
const enSet = new Set(enFlat);
const ukSet = new Set(ukFlat);

// Also top-level keys for direct dictionary access
Object.keys(ruJson).forEach((k) => ruSet.add(k));
Object.keys(enJson).forEach((k) => enSet.add(k));
Object.keys(ukJson).forEach((k) => ukSet.add(k));

const baselinePath = path.resolve(process.cwd(), "tests/fixtures/i18n_known_missing_keys.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const baselineMissingJs = new Set(baseline.missing_in_js || []);
const baselineMissingHtml = new Set(baseline.missing_in_html || []);

describe("i18n Integrity & CI Gates", () => {
  describe("Suite 1: Locale Dictionary Parity & Quality", () => {
    it("has 100% key parity between ru.json and en.json", () => {
      const missingInEn = ruFlat.filter((key) => !enSet.has(key));
      const extraInEn = enFlat.filter((key) => !ruSet.has(key));

      expect(
        missingInEn,
        `Keys defined in ru.json but MISSING in en.json:\n${missingInEn.slice(0, 20).join("\n")}`
      ).toEqual([]);

      expect(
        extraInEn,
        `Keys defined in en.json but MISSING in ru.json:\n${extraInEn.slice(0, 20).join("\n")}`
      ).toEqual([]);
    });

    it("has 100% key parity between ru.json and uk.json", () => {
      const missingInUk = ruFlat.filter((key) => !ukSet.has(key));
      const extraInUk = ukFlat.filter((key) => !ruSet.has(key));

      expect(
        missingInUk,
        `Keys defined in ru.json but MISSING in uk.json:\n${missingInUk.slice(0, 20).join("\n")}`
      ).toEqual([]);

      expect(
        extraInUk,
        `Keys defined in uk.json but MISSING in ru.json:\n${extraInUk.slice(0, 20).join("\n")}`
      ).toEqual([]);
    });

    it("contains no empty string translations in dictionaries", () => {
      const allowedEmptyKeys = new Set(["ce.k088"]); // deliberate empty prefix in English sentence structure
      function findEmptyLeaves(obj, pathAcc = "") {
        let empty = [];
        for (const [k, v] of Object.entries(obj)) {
          const current = pathAcc ? `${pathAcc}.${k}` : k;
          if (typeof v === "string") {
            if (v.trim() === "" && !allowedEmptyKeys.has(current)) empty.push(current);
          } else if (v && typeof v === "object" && !Array.isArray(v)) {
            empty = empty.concat(findEmptyLeaves(v, current));
          }
        }
        return empty;
      }

      const emptyRu = findEmptyLeaves(ruJson);
      const emptyEn = findEmptyLeaves(enJson);
      const emptyUk = findEmptyLeaves(ukJson);

      expect(emptyRu, `Empty string values in ru.json:\n${emptyRu.join("\n")}`).toEqual([]);
      expect(emptyEn, `Empty string values in en.json:\n${emptyEn.join("\n")}`).toEqual([]);
      expect(emptyUk, `Empty string values in uk.json:\n${emptyUk.join("\n")}`).toEqual([]);
    });
  });

  describe("Suite 2: HTML Template data-i18n Attribute Validation", () => {
    const htmlFiles = walkFiles(path.resolve(process.cwd(), "frontend"), ".html");
    const dataI18nRegex = /\bdata-i18n(?:-[a-z]+)?=['"]([^'"]+)['"]/g;

    it("ensures all HTML data-i18n keys exist or are documented in baseline", () => {
      const unexpectedMissing = [];

      for (const file of htmlFiles) {
        const content = fs.readFileSync(file, "utf8");
        let match;
        while ((match = dataI18nRegex.exec(content)) !== null) {
          const raw = match[1].trim();
          if (!raw) continue;
          const candidates = raw.includes("|")
            ? raw.split(/[,;]/).map((p) => {
                const parts = p.trim().split("|");
                return parts.length === 2 ? parts[1].trim() : parts[0].trim();
              })
            : [raw];

          for (const key of candidates) {
            if (!key || key.includes("${") || key.length < 2) continue;
            if (!ruSet.has(key) && !baselineMissingHtml.has(key)) {
              const relPath = path.relative(process.cwd(), file);
              unexpectedMissing.push({ file: relPath, key });
            }
          }
        }
      }

      const errorMsg = unexpectedMissing
        .map((item) => `Missing key: "${item.key}" in ${item.file}`)
        .join("\n");

      expect(
        unexpectedMissing,
        `New unlocalized data-i18n keys detected in HTML!\n${errorMsg}\n` +
          `Add these keys to frontend/assets/locales/ru.json, en.json, and uk.json.`
      ).toEqual([]);
    });
  });

  describe("Suite 3: Frontend JS Code Key Scanner (Zero New Debt Gate)", () => {
    const jsFiles = walkFiles(path.resolve(process.cwd(), "frontend"), ".js");
    const wtRegex = /\b(?:wt|wtf|t)\(\s*['"]([^'"]+)['"]/g;

    it("ensures all wt(), wtf(), t() keys exist in dictionaries or baseline", () => {
      const unexpectedMissing = [];

      for (const file of jsFiles) {
        const content = fs.readFileSync(file, "utf8");
        const lines = content.split("\n");
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          const line = lines[lineIndex];
          let match;
          while ((match = wtRegex.exec(line)) !== null) {
            const key = match[1];
            if (!key || key.includes("${") || key.length < 2) continue;
            if (!ruSet.has(key) && !baselineMissingJs.has(key)) {
              const relPath = path.relative(process.cwd(), file);
              unexpectedMissing.push({
                file: relPath,
                line: lineIndex + 1,
                key,
              });
            }
          }
        }
      }

      const errorMsg = unexpectedMissing
        .map((item) => `[${item.key}] at ${item.file}:${item.line}`)
        .join("\n");

      expect(
        unexpectedMissing,
        `New unlocalized string key(s) detected in JS code!\n${errorMsg}\n` +
          `You MUST add these keys to ru.json, en.json, and uk.json to prevent silent English fallback.`
      ).toEqual([]);
    });

    it("detects resolved baseline keys to keep baseline shrinking", () => {
      const resolvedFromBaseline = [];

      for (const key of baselineMissingJs) {
        if (ruSet.has(key)) {
          resolvedFromBaseline.push(key);
        }
      }

      expect(
        resolvedFromBaseline,
        `Great job! The following keys from baseline are now localized in ru.json:\n` +
          `${resolvedFromBaseline.join("\n")}\n` +
          `Please remove them from tests/fixtures/i18n_known_missing_keys.json to lock in the progress!`
      ).toEqual([]);
    });
  });

  describe("Suite 4: Guardrail Self-Verification", () => {
    it("rejects an imaginary untracked key if encountered in code", () => {
      const dummyLine = `const text = wt("hypothetical.fake.untranslated_key_12345", "Текст");`;
      const wtRegex = /\b(?:wt|wtf|t)\(\s*['"]([^'"]+)['"]/g;
      const match = wtRegex.exec(dummyLine);
      expect(match).toBeTruthy();
      const key = match[1];

      const isKnown = ruSet.has(key) || baselineMissingJs.has(key);
      expect(isKnown).toBe(false);
    });

    it("detects dictionary parity discrepancy when simulated", () => {
      const mockRu = ["app.title", "app.logout", "app.new_untranslated_feature"];
      const mockEn = new Set(["app.title", "app.logout"]);
      const diff = mockRu.filter((k) => !mockEn.has(k));
      expect(diff).toEqual(["app.new_untranslated_feature"]);
    });
  });
});
