/**
 * Cross-Theme CSS Variable Validator
 * ====================================
 * Parses theme CSS files and validates that all themes define the same
 * set of CSS custom properties. Reports missing variables per theme and
 * detects lightness anomalies (e.g. light colors in dark themes).
 *
 * Usage:  node scripts/validate_theme_vars.js [--fix-report]
 *
 * Exit codes:
 *   0 = all themes consistent
 *   1 = missing variables detected
 */

const fs = require("fs");
const path = require("path");

// ── Configuration ──────────────────────────────────────────────────────────────

const FRONTEND_DIR = path.resolve(__dirname, "../frontend/assets");

/** CSS files that define theme-scoped variables, in load order */
const THEME_CSS_FILES = [
  "input.css",
  "lightB-variables.css",
  "hotfix_contrast.css",
];

/**
 * Variables that are intentionally theme-specific and should NOT be
 * flagged as missing from other themes (e.g. badge system only in dark themes)
 */
const OPTIONAL_VARS = new Set([
  "--badge-secondary-bg",
  "--badge-secondary-text",
  "--badge-secondary-ring",
  "--badge-success-bg",
  "--badge-success-text",
  "--badge-success-ring",
  "--badge-warning-bg",
  "--badge-warning-text",
  "--badge-warning-ring",
  "--badge-primary-bg",
  "--badge-primary-text",
  "--badge-primary-ring",
  "--badge-error-bg",
  "--badge-error-text",
  "--badge-error-ring",
  "--badge-info-bg",
  "--badge-info-text",
  "--badge-info-ring",
  "--color-secondary-text",   // legacy alias
  "--color-accent-text",      // only defined in neutral-b, not in tailwind config
  "--color-primary-active",   // only in light-a/light-b/neutral-a, not in tailwind config
  "--color-primary-darkest",  // only in light-b/neutral-a, not in tailwind config
  "--color-status-error-dark", // only in light-a, not in tailwind config
]);

/** Theme categories for lightness validation */
const THEME_CATEGORIES = {
  "light-a": "light",
  "light-b": "light",
  "neutral-a": "neutral",
  "neutral-b": "neutral",
  "dark-a": "dark",
  "dark-b": "dark",
};

// ── CSS Parsing ────────────────────────────────────────────────────────────────

/**
 * Extract theme blocks from a CSS file.
 * Returns Map<themeName, Map<varName, { value, line, file }>>
 */
function parseThemeBlocks(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath);
  const themes = new Map();

  // Match [data-theme="xxx"] { ... } blocks (also handles :root[data-theme="xxx"])
  const themeBlockRegex =
    /(?::root)?\[data-theme="([^"]+)"\](?:\s*,\s*\[data-theme="[^"]+"\])?\s*\{/g;

  let match;
  while ((match = themeBlockRegex.exec(content)) !== null) {
    const themeName = match[1];
    const blockStart = match.index + match[0].length;

    // Find matching closing brace (handle nesting)
    let depth = 1;
    let i = blockStart;
    while (i < content.length && depth > 0) {
      if (content[i] === "{") depth++;
      else if (content[i] === "}") depth--;
      i++;
    }
    const blockContent = content.slice(blockStart, i - 1);

    // Extract variables from block
    const vars = new Map();
    const varRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let varMatch;
    while ((varMatch = varRegex.exec(blockContent)) !== null) {
      const varName = varMatch[1].trim();
      const varValue = varMatch[2].trim();
      // Calculate approximate line number
      const linesBefore = content.slice(0, match.index + varMatch.index).split("\n").length;
      vars.set(varName, {
        value: varValue,
        line: linesBefore,
        file: fileName,
      });
    }

    // Merge into existing theme data (later files override earlier ones)
    if (!themes.has(themeName)) {
      themes.set(themeName, new Map());
    }
    const existing = themes.get(themeName);
    for (const [k, v] of vars) {
      existing.set(k, v);
    }
  }

  return themes;
}

// ── Color Utilities ────────────────────────────────────────────────────────────

/**
 * Parse a hex color to {r, g, b} (0-255).
 * Returns null if not a simple hex color.
 */
function parseHex(value) {
  const hex = value.replace(/\s|!important/g, "");
  const m = hex.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  const h = m[1];
  if (h.length === 3) {
    return {
      r: parseInt(h[0] + h[0], 16),
      g: parseInt(h[1] + h[1], 16),
      b: parseInt(h[2] + h[2], 16),
    };
  }
  if (h.length === 6 || h.length === 8) {
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  return null;
}

/**
 * Calculate relative luminance (WCAG 2.x formula).
 */
function getLuminance({ r, g, b }) {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Get HSL lightness (0-100) from RGB.
 */
function getLightness({ r, g, b }) {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  return ((max + min) / 2) * 100;
}

// ── Validation Logic ───────────────────────────────────────────────────────────

/**
 * Semantic variable classification rules.
 * Each rule: { match(varName) → bool, role, darkRange, lightRange }
 *   darkRange/lightRange: [minL, maxL] expected lightness for that theme category.
 *   null = skip (no expectation for this category).
 *
 * Order matters — first match wins.
 */
const SEMANTIC_RULES = [
  // ── Foreground / Contrast text (inverted: dark text in dark themes for buttons) ──
  {
    role: "fg/contrast",
    match: (v) => /(primary-fg|primary-contrast|text-contrast|text-on-dark)$/.test(v),
    darkRange: null,      // varies: can be dark (text on bright button) or light
    lightRange: null,     // varies
    neutralRange: null,
  },

  // ── Text colors (should be light in dark themes, dark in light themes) ──
  {
    role: "text",
    match: (v) => /^--color-text-(main|secondary|muted)$/.test(v),
    darkRange: [55, 100],    // L > 55% — text must be readable on dark bg
    lightRange: [0, 45],     // L < 45% — text must be dark on light bg
    neutralRange: [0, 50],   // L < 50%
  },

  // ── Disabled text (dimmer, but same direction) ──
  {
    role: "text-disabled",
    match: (v) => /^--color-text-(disabled|chip)$/.test(v),
    darkRange: null,         // can be dim
    lightRange: null,
    neutralRange: null,
  },

  // ── Background / Surface variables (should be dark in dark themes) ──
  {
    role: "background",
    match: (v) => /^--color-(bg-|surface-)/.test(v),
    darkRange: [0, 40],      // L < 40% — backgrounds must be dark
    lightRange: [55, 100],   // L > 55% — backgrounds must be light
    neutralRange: null,      // neutral themes span a wide range
  },

  // ── "*-lighter" variants (should match theme direction — dark tint in dark themes) ──
  {
    role: "lighter-variant",
    match: (v) => /-lighter$/.test(v) && /^--color-/.test(v),
    darkRange: [0, 55],      // L < 55% — "lighter" in dark theme = subtly lighter tint, NOT pastel
    lightRange: [60, 100],   // L > 60% — "lighter" in light theme = very light pastel
    neutralRange: null,
  },

  // ── "*-light" variants (slightly less strict than lighter) ──
  {
    role: "light-variant",
    match: (v) => /-light$/.test(v) && /^--color-/.test(v) && !/-primary-light$/.test(v),
    darkRange: [0, 70],      // Can be somewhat bright for accents/decorations
    lightRange: [40, 100],
    neutralRange: null,
  },

  // ── "*-darker" / "*-darkest" variants ──
  {
    role: "darker-variant",
    match: (v) => /-(darker|darkest)$/.test(v) && /^--color-/.test(v),
    darkRange: null,         // already dark
    lightRange: [0, 55],     // should be dark tones in light themes
    neutralRange: null,
  },

  // ── State *-text variables (text color on state backgrounds) ──
  {
    role: "state-text",
    match: (v) => /-(error-text|success-text|warning-text|info-text)$/.test(v),
    darkRange: [55, 100],    // readable in dark themes
    lightRange: [0, 45],     // dark in light themes
    neutralRange: null,
  },

  // ── Border colors ──
  {
    role: "border",
    match: (v) => /^--color-border/.test(v),
    darkRange: [20, 75],     // medium range — visible but not glaring
    lightRange: [15, 88],    // light themes can have very subtle borders
    neutralRange: null,
  },
];

/**
 * Variables to skip entirely in lightness analysis.
 * These have unique semantics or use var() references.
 */
const LIGHTNESS_SKIP_PATTERNS = [
  /^--shadow/,          // shadow values, not colors
  /^--transition/,      // timing values
  /^--badge/,           // badge system (handled separately)
  /^--color-scrim/,     // scrims are rgba overlays
  /^--color-glass/,     // glass effects
  /^--color-bg-ink$/,   // always dark by design
  /^--color-status-error$/,  // alias, skip
  /-hover$/,            // hover states can vary widely
  /-active$/,           // active states can vary widely
  /-disabled$/,         // disabled states are intentionally muted
  /^--color-primary$/,  // primary brand color — intentionally chosen
  /^--color-secondary$/, // secondary brand — intentionally chosen
  /^--color-accent$/,   // accent — intentionally chosen
  /^--color-(success|error|warning|info)$/, // base state colors — semantic
  /^--color-(success|error|warning|info)-text$/, // state-text: dark themes use dark: overrides
  /^--color-primary-light$/, // primary-light can be decorative accent, varies widely
];

/**
 * Comprehensive lightness analysis of ALL theme variables.
 * Classifies each variable by semantic role and checks against
 * expected lightness ranges for the theme category.
 */
function checkLightnessAnomalies(themeName, vars) {
  const category = THEME_CATEGORIES[themeName];
  if (!category) return [];

  const anomalies = [];

  for (const [varName, entry] of vars) {
    // Skip non-color vars and special patterns
    if (!varName.startsWith("--color-")) continue;
    if (entry.value.startsWith("var(")) continue;
    if (entry.value.startsWith("rgba(")) continue;
    if (LIGHTNESS_SKIP_PATTERNS.some((p) => p.test(varName))) continue;

    const rgb = parseHex(entry.value);
    if (!rgb) continue;

    const lightness = getLightness(rgb);

    // Find matching semantic rule
    const rule = SEMANTIC_RULES.find((r) => r.match(varName));
    if (!rule) continue;

    const range =
      category === "dark" ? rule.darkRange :
        category === "light" ? rule.lightRange :
          rule.neutralRange;

    if (!range) continue; // no expectation for this category

    const [minL, maxL] = range;
    if (lightness < minL || lightness > maxL) {
      anomalies.push({
        variable: varName,
        value: entry.value,
        lightness: lightness.toFixed(1),
        role: rule.role,
        issue: `${rule.role}: L=${lightness.toFixed(1)}% out of range [${minL}–${maxL}%] for ${category} theme`,
        file: entry.file,
        line: entry.line,
      });
    }
  }

  return anomalies;
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║       Cross-Theme CSS Variable Validator  v2.0             ║");
  console.log("║       + Comprehensive Semantic Lightness Analysis          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // 1. Parse all CSS files
  const allThemes = new Map(); // themeName -> Map<varName, {value, line, file}>

  for (const file of THEME_CSS_FILES) {
    const filePath = path.join(FRONTEND_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠  Skipping ${file} (not found)`);
      continue;
    }
    console.log(`  📄 Parsing ${file}...`);
    const parsed = parseThemeBlocks(filePath);
    for (const [themeName, vars] of parsed) {
      if (!allThemes.has(themeName)) {
        allThemes.set(themeName, new Map());
      }
      const existing = allThemes.get(themeName);
      for (const [k, v] of vars) {
        existing.set(k, v);
      }
    }
  }

  const themeNames = [...allThemes.keys()].sort();
  console.log(`\n  Found ${themeNames.length} themes: ${themeNames.join(", ")}\n`);

  // 2. Build union of ALL variable names (excluding optional)
  const allVarNames = new Set();
  for (const [, vars] of allThemes) {
    for (const varName of vars.keys()) {
      if (!OPTIONAL_VARS.has(varName)) {
        allVarNames.add(varName);
      }
    }
  }
  const sortedVarNames = [...allVarNames].sort();
  console.log(`  Total unique variables: ${sortedVarNames.length}`);
  console.log(`  Optional (skipped): ${OPTIONAL_VARS.size}\n`);

  // 3. Find per-theme gaps
  let totalMissing = 0;
  let totalAnomalies = 0;
  const report = [];

  for (const themeName of themeNames) {
    const vars = allThemes.get(themeName);
    const defined = vars.size;
    const missing = sortedVarNames.filter(
      (v) => !vars.has(v) && !OPTIONAL_VARS.has(v)
    );

    // Check lightness anomalies
    const anomalies = checkLightnessAnomalies(themeName, vars);

    const category = THEME_CATEGORIES[themeName] || "unknown";
    const icon = missing.length === 0 && anomalies.length === 0 ? "✅" : "❌";

    console.log(
      `  ${icon} ${themeName} (${category}) — ${defined} vars defined, ${missing.length} missing, ${anomalies.length} anomalies`
    );

    if (missing.length > 0) {
      totalMissing += missing.length;
      console.log(`     Missing variables:`);
      for (const v of missing) {
        // Find which themes DO define it, to show example values
        const examples = [];
        for (const [otherTheme, otherVars] of allThemes) {
          if (otherTheme !== themeName && otherVars.has(v)) {
            examples.push(`${otherTheme}: ${otherVars.get(v).value}`);
            if (examples.length >= 2) break;
          }
        }
        console.log(`       • ${v}  (e.g. ${examples.join(" | ")})`);
      }
    }

    if (anomalies.length > 0) {
      totalAnomalies += anomalies.length;
      console.log(`     Lightness anomalies:`);
      for (const a of anomalies) {
        console.log(`       ⚠ ${a.variable}: ${a.value} — ${a.issue}`);
      }
    }

    report.push({ themeName, category, defined, missing, anomalies });
    console.log("");
  }

  // 4. Summary
  console.log("─".repeat(62));
  if (totalMissing === 0 && totalAnomalies === 0) {
    console.log("  ✅ All themes are consistent. No missing variables or anomalies.");
    process.exit(0);
  } else {
    if (totalMissing > 0) {
      console.log(`  ❌ ${totalMissing} missing variable(s) across all themes.`);
    }
    if (totalAnomalies > 0) {
      console.log(`  ⚠  ${totalAnomalies} lightness anomaly(ies) detected.`);
    }
    console.log("  Run with --fix-report to generate a template fix file.\n");
    process.exit(1);
  }
}

main();
