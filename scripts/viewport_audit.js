/**
 * Viewport / responsive-layout audit.
 *
 * Drives the running app (default http://127.0.0.1:8000) across several desktop
 * resolutions and, on each screen, programmatically detects layout problems that
 * are easy to miss by eye:
 *   - page-level horizontal overflow (a horizontal scrollbar appears);
 *   - elements whose right/left edge breaches the viewport;
 *   - elements wider than the viewport (usually a hard-coded px width);
 *   - interactive controls pushed below the fold (critical on 768px-tall screens).
 *
 * It reuses the smoke-test fixtures/login so the screens render with demo data.
 *
 * Usage:
 *   node scripts/viewport_audit.js                       # trial run, default screens
 *   node scripts/viewport_audit.js --screens=main,editor
 *   node scripts/viewport_audit.js --viewports=1366x768
 *   node scripts/viewport_audit.js --headed                # watch it run
 */

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const { pingBaseUrl, resolveUrl } = require("./browser_smoke_helpers");

// Hosted-web runtime disables the legacy profiles API, so we authenticate via
// the real /api/auth/register flow (which logs the user in immediately and sets
// the session cookie on the browser context).
async function registerAndLogin(context, baseUrl, suffix) {
  const stamp = Date.now().toString(36);
  const email = `viewport-audit+${suffix}-${stamp}@localhost.test`;
  const res = await context.request.post(resolveUrl(baseUrl, "/api/auth/register"), {
    data: {
      // Keep the display name realistically short so the profile chip's
      // by-design ellipsis doesn't show up as a false "clipped" finding.
      name: `QA${stamp.slice(-6)}`,
      email,
      password: "AuditPass123!",
      avatar_seed: "1.png",
    },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`register failed (${res.status()}): ${body.slice(0, 200)}`);
  }
  // Suppress the new-user onboarding tour so it doesn't cover the screens.
  await context.request.post(resolveUrl(baseUrl, "/api/ui/settings"), {
    data: { settings: { onboarding: { disabled: true, firstRunPromptSeen: true } } },
  });
  return email;
}

// Populate the freshly-registered user so content-bearing screens (complexes,
// catalog, editor) render with real data instead of empty states. Tasks already
// exist in the built-in /api/task-catalog, so we just assemble complexes from
// those refs (same path proven by ensure_contrast_s1_seed.js). Failures are
// non-fatal: the audit still runs against whatever rendered.
async function seedDemoData(context, baseUrl) {
  try {
    const res = await context.request.get(resolveUrl(baseUrl, "/api/task-catalog"));
    if (!res.ok()) {
      console.warn(`[viewport-audit] seed: task-catalog unavailable (${res.status()}), skipping`);
      return;
    }
    const body = await res.json();
    const items = Array.isArray(body && body.items) ? body.items : [];
    const refs = items
      .filter((it) => it && typeof it.ref === "string")
      .map((it) => it.ref);
    if (refs.length === 0) {
      console.warn("[viewport-audit] seed: no task refs in catalog, skipping complexes");
      return;
    }
    // A few complexes of varying size so the list renders multiple cards.
    const plans = [
      { name: "Демо: базовый комплекс", take: Math.min(3, refs.length) },
      { name: "Демо: расширенный комплекс", take: Math.min(8, refs.length) },
      { name: "Демо: интенсив", take: Math.min(5, refs.length) },
    ];
    let created = 0;
    for (const plan of plans) {
      const tasks = refs.slice(0, plan.take);
      if (tasks.length === 0) continue;
      const r = await context.request.post(resolveUrl(baseUrl, "/api/complexes"), {
        data: {
          name: plan.name,
          description:
            "Демонстрационный комплекс, созданный аудитом раскладки для наполнения экранов содержимым.",
          tasks,
          chains: [],
          settings: {},
        },
      });
      if (r.ok()) created += 1;
      else console.warn(`[viewport-audit] seed: complex "${plan.name}" failed (${r.status()})`);
    }
    console.log(`[viewport-audit] seed: ${created}/${plans.length} demo complexes created (catalog tasks: ${refs.length})`);
  } catch (err) {
    console.warn(`[viewport-audit] seed: error (non-fatal): ${err && err.message ? err.message : err}`);
  }
}

const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

const DEFAULT_VIEWPORTS = [
  { label: "1366x768", width: 1366, height: 768 },
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1536x864", width: 1536, height: 864 },
];

// Trial-run screen set: stable routes that render with the seeded fixture user.
const SCREENS = {
  main: { route: "/main", label: "Main dashboard" },
  complexes: { route: "/complexes", label: "Complexes list" },
  editor: { route: "/editor", label: "Task editor" },
  catalog: { route: "/catalog", label: "Catalog" },
  statistics: { route: "/statistics", label: "Statistics" },
  calendar: { route: "/calendar", label: "Calendar" },
  microcards: { route: "/microcards", label: "Microcards" },
  welcome: { route: "/welcome", label: "Welcome" },
};

const DEFAULT_SCREENS = ["main", "complexes", "editor"];

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    baseUrl: DEFAULT_BASE_URL,
    viewports: DEFAULT_VIEWPORTS,
    screens: DEFAULT_SCREENS,
    headless: true,
    reportDir: path.resolve(process.cwd(), "reports", "viewport_audit"),
    settleMs: 1200,
  };
  for (const raw of argv) {
    const arg = String(raw || "");
    if (arg === "--headed") {
      out.headless = false;
    } else if (arg.startsWith("--base-url=")) {
      out.baseUrl = arg.slice("--base-url=".length);
    } else if (arg.startsWith("--report-dir=")) {
      out.reportDir = path.resolve(arg.slice("--report-dir=".length));
    } else if (arg.startsWith("--settle-ms=")) {
      out.settleMs = Number(arg.slice("--settle-ms=".length)) || out.settleMs;
    } else if (arg.startsWith("--screens=")) {
      out.screens = arg
        .slice("--screens=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--viewports=")) {
      out.viewports = arg
        .slice("--viewports=".length)
        .split(",")
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => {
          const [w, h] = token.toLowerCase().split("x").map((n) => Number(n));
          return { label: token, width: w, height: h };
        })
        .filter((vp) => vp.width > 0 && vp.height > 0);
    }
  }
  return out;
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Runs inside the page. Returns a structured list of layout problems.
 * Kept dependency-free and self-contained so it can be serialized to the browser.
 */
function detectLayoutIssues() {
  const TOL = 2; // px tolerance to ignore sub-pixel rounding
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function shortSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    let label = el.tagName.toLowerCase();
    if (el.id) {
      label += "#" + el.id;
      return label;
    }
    const cls = (el.getAttribute("class") || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join(".");
    if (cls) label += "." + cls;
    // disambiguate among siblings
    if (el.parentElement) {
      const sameTag = Array.from(el.parentElement.children).filter(
        (c) => c.tagName === el.tagName
      );
      if (sameTag.length > 1) {
        label += `:nth(${sameTag.indexOf(el) + 1})`;
      }
    }
    return label;
  }

  function pathSelector(el, depth = 3) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < depth) {
      parts.unshift(shortSelector(cur));
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  // The element directly holds a non-empty text node (vs. only nesting children).
  function ownText(el) {
    return Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0
    );
  }

  // True when an ancestor with a clipping overflow has scrolled/collapsed this
  // element entirely out of view (e.g. a collapsed detail panel with
  // max-height:0; overflow:hidden). Such boxes still report a non-zero rect, so
  // they otherwise produce phantom overlaps/oversize findings.
  function isClippedAway(el, r) {
    let cur = el.parentElement;
    while (cur && cur.nodeType === 1 && cur !== document.body) {
      const s = window.getComputedStyle(cur);
      const clips = (v) => v === "hidden" || v === "clip" || v === "auto" || v === "scroll";
      if (clips(s.overflowX) || clips(s.overflowY)) {
        const cr = cur.getBoundingClientRect();
        const ix = Math.min(r.right, cr.right) - Math.max(r.left, cr.left);
        const iy = Math.min(r.bottom, cr.bottom) - Math.max(r.top, cr.top);
        if (ix <= 1 || iy <= 1) return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }

  const docEl = document.documentElement;
  const horizontalOverflowPx = Math.max(0, docEl.scrollWidth - vw);

  const all = Array.from(document.body.querySelectorAll("*"));
  const overflowingSet = new Set();
  const rects = new Map();

  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    rects.set(el, r);
    if (r.right > vw + TOL || r.left < -TOL) {
      overflowingSet.add(el);
    }
  }

  // "Culprit" = an overflowing element whose parent stays within bounds, i.e. the
  // first place the breach is introduced. This collapses long parent chains down
  // to the actual offending node.
  const overflowCulprits = [];
  for (const el of overflowingSet) {
    const parent = el.parentElement;
    if (parent && overflowingSet.has(parent)) continue;
    const r = rects.get(el);
    overflowCulprits.push({
      selector: pathSelector(el),
      text: (el.textContent || "").trim().slice(0, 60),
      right: Math.round(r.right),
      left: Math.round(r.left),
      width: Math.round(r.width),
      overflowRightPx: Math.round(Math.max(0, r.right - vw)),
    });
  }
  overflowCulprits.sort((a, b) => b.overflowRightPx - a.overflowRightPx);

  // Elements physically wider than the viewport (a strong fixed-width signal).
  const oversized = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    const r = rects.get(el) || el.getBoundingClientRect();
    if (r.width > vw + TOL) {
      const style = window.getComputedStyle(el);
      oversized.push({
        selector: pathSelector(el),
        width: Math.round(r.width),
        cssWidth: style.width,
        cssMinWidth: style.minWidth,
      });
    }
  }
  oversized.sort((a, b) => b.width - a.width);

  // Interactive controls below the fold (relevant for short 768px screens).
  const interactiveSel = 'button, a[href], [role="button"], input, select, textarea';
  const belowFold = [];
  for (const el of Array.from(document.querySelectorAll(interactiveSel))) {
    if (!isVisible(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.top >= vh - TOL) {
      belowFold.push({
        selector: pathSelector(el),
        text: (el.textContent || el.value || "").trim().slice(0, 40),
        top: Math.round(r.top),
      });
    }
  }
  belowFold.sort((a, b) => a.top - b.top);

  // --- Clipped content: an element cutting off its own text/children. -------
  // Catches things like a label rendered as "ACTRA" but clipped to "AC".
  const clipped = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    // Only flag an element that holds its OWN text being cut — container-level
    // descendant overflow (e.g. a panel clipping a slightly-wider child) is not
    // a text-truncation bug and produces noise.
    if (!ownText(el)) continue;
    const style = window.getComputedStyle(el);
    // text-overflow:ellipsis is intentional graceful truncation (e.g. the
    // profile name chip), not a layout failure — skip it. A hard overflow
    // hidden/clip cut with no ellipsis is the real "ACTRA → AC" bug we want.
    if (style.textOverflow === "ellipsis") continue;
    const clipsX = style.overflowX === "hidden" || style.overflowX === "clip";
    if (!clipsX) continue;
    if (el.clientWidth <= 0) continue;
    if (el.scrollWidth > el.clientWidth + TOL) {
      const txt = (el.textContent || "").trim();
      if (!txt) continue;
      clipped.push({
        selector: pathSelector(el),
        text: txt.slice(0, 60),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        hiddenPx: el.scrollWidth - el.clientWidth,
      });
    }
  }
  clipped.sort((a, b) => b.hiddenPx - a.hiddenPx);

  // --- Overlap: in-flow elements visually colliding with one another. ------
  // This is what catches header buttons spilling over the brand/actions: the
  // page never overflows, but the rendered boxes intersect.
  function inOverlayContext(el) {
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const s = window.getComputedStyle(cur);
      if (s.position === "absolute" || s.position === "fixed") return true;
      if (cur.getAttribute && cur.getAttribute("aria-hidden") === "true") return true;
      const role = cur.getAttribute && cur.getAttribute("role");
      if (role === "menu" || role === "dialog" || role === "tooltip" || role === "listbox") {
        return true;
      }
      cur = cur.parentElement;
    }
    return false;
  }
  const OVL = 4; // px: ignore hairline touches
  const candidates = [];
  for (const el of all) {
    if (!isVisible(el)) continue;
    if (inOverlayContext(el)) continue;
    const interactive = el.matches(
      'a[href], button, [role="button"], input, select, textarea, label'
    );
    if (!interactive && !ownText(el)) continue;
    const r = rects.get(el);
    if (isClippedAway(el, r)) continue;
    // Skip big layout containers — we want the small chips/labels that collide.
    if (r.width > vw * 0.5 || r.height > vh * 0.35) continue;
    candidates.push({ el, r });
  }
  const overlaps = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox > OVL && oy > OVL) {
        overlaps.push({
          a: pathSelector(a.el),
          aText: (a.el.textContent || "").trim().slice(0, 30),
          b: pathSelector(b.el),
          bText: (b.el.textContent || "").trim().slice(0, 30),
          overlapX: Math.round(ox),
          overlapY: Math.round(oy),
        });
      }
    }
  }
  overlaps.sort((a, b) => b.overlapX * b.overlapY - a.overlapX * a.overlapY);

  return {
    viewport: { width: vw, height: vh },
    pageScrollWidth: docEl.scrollWidth,
    pageScrollHeight: docEl.scrollHeight,
    horizontalOverflowPx,
    overflowCulprits: overflowCulprits.slice(0, 25),
    oversized: oversized.slice(0, 25),
    belowFoldInteractive: belowFold.slice(0, 25),
    clipped: clipped.slice(0, 25),
    overlaps: overlaps.slice(0, 25),
  };
}

function severityOf(result) {
  if (result.error) return "error";
  if (
    result.horizontalOverflowPx > TOL_PAGE ||
    result.oversized.length ||
    (result.overlaps && result.overlaps.length) ||
    (result.clipped && result.clipped.length)
  ) {
    return "fail";
  }
  if (result.overflowCulprits.length) return "warn";
  return "ok";
}

const TOL_PAGE = 2;

function buildMarkdown(payload) {
  const lines = [];
  lines.push("# Viewport / responsive layout audit");
  lines.push("");
  lines.push(`- Started: ${payload.startedAt}`);
  lines.push(`- Base URL: ${payload.baseUrl}`);
  lines.push(`- Viewports: ${payload.viewports.map((v) => v.label).join(", ")}`);
  lines.push(`- Screens: ${payload.screens.join(", ")}`);
  lines.push("");

  const fails = payload.results.filter((r) => r.severity === "fail" || r.severity === "error");
  const warns = payload.results.filter((r) => r.severity === "warn");
  lines.push(
    `**Summary:** ${fails.length} fail · ${warns.length} warn · ${payload.results.length} checks total`
  );
  lines.push("");

  for (const r of payload.results) {
    const icon =
      r.severity === "ok" ? "OK" : r.severity === "warn" ? "WARN" : "FAIL";
    lines.push(`## [${icon}] ${r.screenLabel} @ ${r.viewport}`);
    lines.push(`- Route: \`${r.route}\``);
    if (r.error) {
      lines.push(`- ERROR: ${r.error}`);
      lines.push("");
      continue;
    }
    lines.push(
      `- Horizontal overflow: ${r.horizontalOverflowPx}px (page width ${r.pageScrollWidth}px vs viewport ${r.viewport.split("x")[0]}px)`
    );
    if (r.screenshot) lines.push(`- Screenshot: \`${r.screenshot}\``);

    if (r.oversized.length) {
      lines.push("");
      lines.push("**Elements wider than the viewport:**");
      for (const o of r.oversized.slice(0, 8)) {
        lines.push(`  - ${o.width}px — \`${o.selector}\` (css width: ${o.cssWidth}, min-width: ${o.cssMinWidth})`);
      }
    }
    if (r.overflowCulprits.length) {
      lines.push("");
      lines.push("**Elements breaching the viewport edge (overflow source):**");
      for (const c of r.overflowCulprits.slice(0, 8)) {
        const txt = c.text ? ` — "${c.text}"` : "";
        lines.push(`  - +${c.overflowRightPx}px past right edge — \`${c.selector}\`${txt}`);
      }
    }
    if (r.overlaps && r.overlaps.length) {
      lines.push("");
      lines.push(`**Overlapping elements (${r.overlaps.length}):**`);
      for (const o of r.overlaps.slice(0, 10)) {
        const at = o.aText ? `"${o.aText}"` : o.a;
        const bt = o.bText ? `"${o.bText}"` : o.b;
        lines.push(`  - ${at} ∩ ${bt} — overlap ${o.overlapX}×${o.overlapY}px`);
        lines.push(`      a: \`${o.a}\``);
        lines.push(`      b: \`${o.b}\``);
      }
    }
    if (r.clipped && r.clipped.length) {
      lines.push("");
      lines.push(`**Clipped content / truncated text (${r.clipped.length}):**`);
      for (const c of r.clipped.slice(0, 8)) {
        lines.push(`  - cut ${c.hiddenPx}px — "${c.text}" — \`${c.selector}\``);
      }
    }
    if (r.belowFoldInteractive.length) {
      lines.push("");
      lines.push(`**Interactive controls below the fold (${r.belowFoldInteractive.length}):**`);
      for (const b of r.belowFoldInteractive.slice(0, 6)) {
        const txt = b.text ? ` "${b.text}"` : "";
        lines.push(`  - top ${b.top}px${txt} — \`${b.selector}\``);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs();

  const reachable = await pingBaseUrl(opts.baseUrl);
  if (!reachable) {
    throw new Error(
      `Server is not reachable at ${opts.baseUrl}. Start the localhost stack (docker compose -f docker-compose.hosted.yml -f docker-compose.localhost.yml up) and retry.`
    );
  }

  const unknownScreens = opts.screens.filter((s) => !SCREENS[s]);
  if (unknownScreens.length) {
    throw new Error(
      `Unknown screen(s): ${unknownScreens.join(", ")}. Known: ${Object.keys(SCREENS).join(", ")}`
    );
  }

  const timestamp = timestampSlug();
  const runDir = path.join(opts.reportDir, `viewport_audit_${timestamp}`);
  const shotsDir = path.join(runDir, "screenshots");
  ensureDirectory(shotsDir);

  const browser = await chromium.launch({ headless: opts.headless });
  const results = [];

  try {
    for (const vp of opts.viewports) {
      const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: 1,
      });
      await context.addInitScript(() => {
        try {
          localStorage.setItem("actra_onboarding_disabled_v1", "true");
        } catch (_) {}
      });
      await registerAndLogin(context, opts.baseUrl, vp.label.replace("x", "w"));
      await seedDemoData(context, opts.baseUrl);
      const page = await context.newPage();
      for (const screenId of opts.screens) {
        const screen = SCREENS[screenId];
        const tag = `${screenId}__${vp.label}`;
        const shotRel = path.join("screenshots", `${tag}.png`);
        const shotAbs = path.join(runDir, shotRel);
        let record;
        try {
          await page.goto(resolveUrl(opts.baseUrl, screen.route), {
            waitUntil: "networkidle",
            timeout: 30000,
          });
          await page.waitForTimeout(opts.settleMs);
          await page.screenshot({ path: shotAbs, fullPage: false });
          const detected = await page.evaluate(detectLayoutIssues);
          record = {
            screen: screenId,
            screenLabel: screen.label,
            route: screen.route,
            viewport: vp.label,
            viewportSize: detected.viewport,
            screenshot: shotRel.replace(/\\/g, "/"),
            pageScrollWidth: detected.pageScrollWidth,
            pageScrollHeight: detected.pageScrollHeight,
            horizontalOverflowPx: detected.horizontalOverflowPx,
            oversized: detected.oversized,
            overflowCulprits: detected.overflowCulprits,
            belowFoldInteractive: detected.belowFoldInteractive,
            clipped: detected.clipped,
            overlaps: detected.overlaps,
          };
        } catch (err) {
          record = {
            screen: screenId,
            screenLabel: screen.label,
            route: screen.route,
            viewport: vp.label,
            error: err && err.message ? err.message : String(err),
            horizontalOverflowPx: 0,
            oversized: [],
            overflowCulprits: [],
            belowFoldInteractive: [],
            clipped: [],
            overlaps: [],
          };
        }
        record.severity = severityOf(record);
        const icon =
          record.severity === "ok"
            ? "OK"
            : record.severity === "warn"
            ? "WARN"
            : "FAIL";
        console.log(
          `[viewport-audit] [${icon}] ${screen.label} @ ${vp.label} — overflow ${record.horizontalOverflowPx}px, oversized ${record.oversized.length}, overlaps ${record.overlaps.length}, clipped ${record.clipped.length}, below-fold ${record.belowFoldInteractive.length}`
        );
        results.push(record);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const payload = {
    startedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    viewports: opts.viewports,
    screens: opts.screens,
    results,
  };

  const jsonPath = path.join(runDir, "summary.json");
  const mdPath = path.join(runDir, "summary.md");
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), "utf8");
  fs.writeFileSync(mdPath, buildMarkdown(payload), "utf8");

  const fails = results.filter((r) => r.severity === "fail" || r.severity === "error");
  console.log("");
  console.log(`[viewport-audit] done. ${fails.length} fail / ${results.length} checks.`);
  console.log(`[viewport-audit] report: ${mdPath}`);
  console.log(`[viewport-audit] screenshots: ${shotsDir}`);
}

main().catch((err) => {
  console.error("[viewport-audit] FATAL:", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
