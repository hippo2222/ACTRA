import { describe, it, expect } from "vitest";
import { execSync, execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const projectRoot = path.resolve(process.cwd());
const baselinePath = path.join(projectRoot, "tests/fixtures/i18n_hardcoded_baseline.json");

describe("i18n Hardcoded String Leak Detector & Ratchet Gate", () => {
  it("enforces ratchet baseline: zero new unlocalized Cyrillic strings allowed across entire frontend", { timeout: 30000 }, () => {
    expect(fs.existsSync(baselinePath), `Baseline file ${baselinePath} must exist!`).toBe(true);

    let output = "";
    let exitCode = 0;
    try {
      output = execSync(
        `python scripts/audit_i18n_leaks.py --ci --baseline tests/fixtures/i18n_hardcoded_baseline.json`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
    } catch (err) {
      exitCode = err.status || 1;
      output = (err.stdout || "") + "\n" + (err.stderr || "");
    }

    expect(
      exitCode,
      `CI Ratchet Gate Failed! New unlocalized strings or unicode escapes introduced:\n${output}`
    ).toBe(0);
  });

  it("enforces zero unlocalized string leaks permanently on the Main Screen", { timeout: 30000 }, () => {
    try {
      const outputHtml = execSync(
        `python scripts/audit_i18n_leaks.py --json --filter MainScreen/Main.html`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
      const dataHtml = JSON.parse(outputHtml);
      expect(
        dataHtml.total_leaks,
        `Main.html must have 0 hardcoded unlocalized strings, found ${dataHtml.total_leaks}`
      ).toBe(0);

      const outputJs = execSync(
        `python scripts/audit_i18n_leaks.py --json --filter assets/MainLogic.js`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
      const dataJs = JSON.parse(outputJs);
      expect(
        dataJs.total_leaks,
        `MainLogic.js must have 0 hardcoded unlocalized strings, found ${dataJs.total_leaks}`
      ).toBe(0);
    } catch (err) {
      throw new Error(`Failed to audit Main Screen: ${err.message}`);
    }
  });

  it("enforces zero unlocalized string leaks permanently on S1 core session files", { timeout: 30000 }, () => {
    const s1Files = ["S1/main.js", "S1/index.html", "S1/session-controls.js", "assets/s2-results.js"];
    for (const file of s1Files) {
      const output = execSync(
        `python scripts/audit_i18n_leaks.py --json --filter "${file}"`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
      const data = JSON.parse(output);
      expect(
        data.total_leaks,
        `${file} must have 0 hardcoded unlocalized strings, found ${data.total_leaks}`
      ).toBe(0);
    }
  });

  it("enforces zero unlocalized string leaks permanently on Student Journey files (GlobalHeader, Calendar, Settings)", { timeout: 30000 }, () => {
    const studentFiles = [
      "assets/GlobalHeader.js",
      "Calendar/calendar.js",
      "Calendar/calendar.html",
      "Settings/settings.js",
      "Settings/settings.html",
    ];
    for (const file of studentFiles) {
      const output = execSync(
        `python scripts/audit_i18n_leaks.py --json --filter "${file}"`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
      const data = JSON.parse(output);
      expect(
        data.total_leaks,
        `${file} must have 0 hardcoded unlocalized strings, found ${data.total_leaks}`
      ).toBe(0);
    }
  });

  it("enforces zero unlocalized string leaks permanently on Interactive Mechanics (ClickUI, ImageLabelUI, SequenceUI)", { timeout: 30000 }, () => {
    const mechanicsFiles = [
      "ClickUI/ClickUI.web.js",
      "ClickUI/TaskMetadataPanel.js",
      "SequenceUI/ImageLabelUI.web.js",
      "SequenceUI/SequenceUI.web.js",
    ];
    for (const file of mechanicsFiles) {
      const output = execSync(
        `python scripts/audit_i18n_leaks.py --json --filter "${file}"`,
        {
          cwd: projectRoot,
          encoding: "utf8",
          env: { ...process.env, PYTHONIOENCODING: "utf-8" },
        }
      );
      const data = JSON.parse(output);
      expect(
        data.total_leaks,
        `${file} must have 0 hardcoded unlocalized strings, found ${data.total_leaks}`
      ).toBe(0);
    }
  });

  it("verifies detector catches both literal Cyrillic and escaped Unicode (\\u04xx)", () => {
    const pythonScript = [
      "from scripts.audit_i18n_leaks import mask_safe_js_calls, ANY_CYRILLIC",
      "test_raw = 'const a = \"\\\\u041f\\\\u0430\\\\u0443\\\\u0437\\\\u0430\"; const b = \"Привет\"; const c = wt(\"k\", \"Привет\");'",
      "masked = mask_safe_js_calls(test_raw)",
      "assert '\\\\u04' in masked, 'Escaped unicode should be detected outside wt'",
      "assert 'Привет' in masked, 'Literal cyrillic should be detected outside wt'",
      "assert '\"k\"' not in masked, 'wt call arguments should be masked'",
      "print('OK')",
    ].join("\n");

    const res = execFileSync("python", ["-c", pythonScript], {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, PYTHONIOENCODING: "utf-8" },
    });
    expect(res.trim()).toBe("OK");
  });
});
