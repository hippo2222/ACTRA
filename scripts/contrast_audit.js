const fs = require("fs");
const path = require("path");

async function loadPlaywright() {
  try {
    return require("playwright");
  } catch (err) {
    console.error("[contrast_audit] Playwright not installed.");
    console.error("Install: npm i -D playwright");
    throw err;
  }
}

function parseCliArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (token === "--config" && argv[i + 1]) {
      out.config = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--config=")) {
      out.config = token.slice("--config=".length);
      continue;
    }
    if (token === "--base-url" && argv[i + 1]) {
      out.baseUrl = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--base-url=")) {
      out.baseUrl = token.slice("--base-url=".length);
      continue;
    }
    if (token === "--output-dir" && argv[i + 1]) {
      out.outputDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (token.startsWith("--output-dir=")) {
      out.outputDir = token.slice("--output-dir=".length);
      continue;
    }
    if (token === "--headless" && argv[i + 1]) {
      const raw = String(argv[i + 1]).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      i += 1;
      continue;
    }
    if (token.startsWith("--headless=")) {
      const raw = token.slice("--headless=".length).toLowerCase();
      out.headless = !(raw === "false" || raw === "0" || raw === "no");
      continue;
    }
  }
  return out;
}

function resolveConfigPath(cli = {}) {
  const explicitPath = cli && cli.config ? path.resolve(process.cwd(), cli.config) : null;
  if (explicitPath && fs.existsSync(explicitPath)) return explicitPath;

  const envPath = process.env.CONTRAST_AUDIT_CONFIG
    ? path.resolve(process.cwd(), process.env.CONTRAST_AUDIT_CONFIG)
    : null;
  if (envPath && fs.existsSync(envPath)) return envPath;

  const candidates = [
    path.resolve(process.cwd(), "contrast_audit.config.json"),
    path.resolve(process.cwd(), "scripts", "contrast_audit.config.json"),
    path.resolve(process.cwd(), "scripts", "contrast_audit.sample.json"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function loadConfig(cli = {}) {
  const configPath = resolveConfigPath(cli);
  if (!configPath) {
    throw new Error(
      "contrast_audit.config.json not found. Copy scripts/contrast_audit.sample.json to contrast_audit.config.json and edit URLs."
    );
  }
  const raw = fs.readFileSync(configPath, "utf8");
  const config = JSON.parse(raw);
  if (cli && cli.baseUrl) config.baseUrl = cli.baseUrl;
  if (cli && cli.outputDir) config.outputDir = cli.outputDir;
  if (cli && typeof cli.headless === "boolean") config.headless = cli.headless;
  return { config, configPath };
}

function resolveReportRetentionPolicy(config) {
  const raw = isPlainObject(config && config.reportRetention) ? config.reportRetention : {};
  return {
    clearOutputDirBeforeRun: raw.clearOutputDirBeforeRun !== false,
    deleteOutputDirOnCleanRun: raw.deleteOutputDirOnCleanRun !== false,
  };
}

function resetDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(
      `[contrast_audit] failed to clear output dir ${dirPath}: ${err && err.message ? err.message : err}`
    );
  }
  fs.mkdirSync(dirPath, { recursive: true });
}

function slugify(value) {
  return String(value || "page")
    .replace(/https?:\/\//g, "")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function hasSessionPlaceholder(value) {
  if (!value) return false;
  return /(\{sessionId\}|:sessionId\b|__SESSION_ID__|session_auto_placeholder)/i.test(
    String(value)
  );
}

function injectSessionIdIntoUrlLike(urlLike, sessionId) {
  if (!urlLike || !sessionId) return urlLike;
  const encoded = encodeURIComponent(String(sessionId));
  return String(urlLike)
    .replace(/\{sessionId\}/gi, encoded)
    .replace(/:sessionId\b/gi, encoded)
    .replace(/__SESSION_ID__/g, encoded)
    .replace(/session_auto_placeholder/gi, encoded);
}

function isSessionIdPlaceholder(rawValue) {
  if (!rawValue) return false;
  const value = String(rawValue).trim().toLowerCase();
  if (!value) return true;
  if (
    value === "session_auto_placeholder" ||
    value === "__session_id__" ||
    value === ":sessionid" ||
    value === "{sessionid}"
  ) {
    return true;
  }
  return /(^|[^a-z0-9])session[_-]?id([^a-z0-9]|$)/i.test(value);
}

function extractSessionIdFromUrlLike(value) {
  if (!value) return null;
  const raw = String(value);
  const match = raw.match(/\/ui\/session\/([^/?#]+)/i);
  if (!match || !match[1]) return null;
  const candidate = decodeURIComponent(match[1]);
  if (isSessionIdPlaceholder(candidate)) return null;
  return candidate;
}

function resolveUrl(baseUrl, url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (!baseUrl) {
    throw new Error(`Relative url "${url}" provided without baseUrl`);
  }
  return new URL(url, baseUrl).toString();
}

function parseTimestamp(value) {
  if (!value) return 0;
  const t = Date.parse(String(value));
  return Number.isFinite(t) ? t : 0;
}

async function createSessionForAuto(baseUrl, autoCfg = {}) {
  const explicitComplexId = autoCfg.complexId || null;
  let complexId = explicitComplexId;

  if (!complexId) {
    const complexesUrl = new URL("/api/complexes", baseUrl).toString();
    const complexesRes = await fetch(complexesUrl);
    if (!complexesRes.ok) {
      throw new Error(`Failed to load complexes for auto session: HTTP ${complexesRes.status}`);
    }
    const complexesPayload = await complexesRes.json();
    const items = Array.isArray(complexesPayload && complexesPayload.items)
      ? complexesPayload.items
      : [];
    const first = items.find((item) => item && (item.id || item.complex_id));
    if (!first) {
      throw new Error("No complexes available to create auto session");
    }
    complexId = first.id || first.complex_id;
  }

  const startIterationRaw =
    autoCfg.startIteration !== undefined
      ? autoCfg.startIteration
      : autoCfg.preferredIteration !== undefined
        ? autoCfg.preferredIteration
        : 1;
  const startIteration = Number.isFinite(Number(startIterationRaw))
    ? Number(startIterationRaw)
    : 1;

  const startUrl = new URL(
    `/api/session/${encodeURIComponent(complexId)}/start`,
    baseUrl
  ).toString();
  const startRes = await fetch(startUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start_iteration: startIteration }),
  });
  const startPayload = await startRes.json().catch(() => null);
  if (!startRes.ok || !startPayload || !startPayload.ok || !startPayload.session_id) {
    throw new Error(
      `Failed to create auto session for complex ${complexId}: ${
        (startPayload && (startPayload.error || startPayload.message)) || `HTTP ${startRes.status}`
      }`
    );
  }

  const createdSession = {
    session_id: startPayload.session_id,
    complex_id: startPayload.complex_id || complexId,
    iteration: startPayload.iteration || startIteration,
    paused: false,
    total_tasks:
      startPayload && startPayload.queue && Number.isFinite(Number(startPayload.queue.total))
        ? Number(startPayload.queue.total)
        : null,
    _auto_created: true,
  };

  const createdUrl = new URL(
    `/ui/session/${encodeURIComponent(createdSession.session_id)}`,
    baseUrl
  ).toString();

  return { url: createdUrl, session: createdSession };
}

async function resolveAutoSessionUrl(baseUrl, autoCfg = {}) {
  if (!baseUrl) {
    throw new Error("baseUrl is required for autoSession mode");
  }

  const activeUrl = new URL("/api/sessions/active", baseUrl).toString();
  const response = await fetch(activeUrl);
  if (!response.ok) {
    throw new Error(`Failed to load active sessions: HTTP ${response.status}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload && payload.items) ? payload.items : [];
  const allowCreateWhenEmpty = autoCfg.autoCreateWhenEmpty !== false;
  if (!items.length) {
    if (!allowCreateWhenEmpty) {
      throw new Error("No active sessions returned by /api/sessions/active");
    }
    return createSessionForAuto(baseUrl, autoCfg);
  }

  const complexId = autoCfg.complexId || null;
  const preferredIteration = Number(
    autoCfg.preferredIteration !== undefined ? autoCfg.preferredIteration : 1
  );
  const requireNotPaused = autoCfg.requireNotPaused === true;
  const minTotalTasks = Number(
    autoCfg.minTotalTasks !== undefined ? autoCfg.minTotalTasks : 0
  );
  const pinnedSessionId = autoCfg.sessionId ? String(autoCfg.sessionId) : null;
  const preferredSessionId = autoCfg.preferredSessionId
    ? String(autoCfg.preferredSessionId)
    : null;

  if (pinnedSessionId) {
    const pinned = items.find((s) => s && s.session_id === pinnedSessionId);
    if (!pinned) {
      throw new Error(`Pinned sessionId not found in active sessions: ${pinnedSessionId}`);
    }
    const pinnedUrl = new URL(
      `/ui/session/${encodeURIComponent(pinned.session_id)}`,
      baseUrl
    ).toString();
    return { url: pinnedUrl, session: pinned };
  }

  let candidates = items;
  if (complexId) {
    candidates = candidates.filter((s) => s && s.complex_id === complexId);
  }
  if (requireNotPaused) {
    candidates = candidates.filter((s) => s && s.paused !== true);
  }
  if (Number.isFinite(minTotalTasks) && minTotalTasks > 0) {
    candidates = candidates.filter(
      (s) => s && Number.isFinite(Number(s.total_tasks)) && Number(s.total_tasks) >= minTotalTasks
    );
  }
  if (!candidates.length) {
    if (allowCreateWhenEmpty) {
      return createSessionForAuto(baseUrl, autoCfg);
    }
    throw new Error("No active sessions match autoSession filters");
  }

  const scored = candidates
    .filter((s) => s && s.session_id)
    .map((s) => {
      let score = 0;
      if (preferredSessionId && s.session_id === preferredSessionId) score += 10000;
      if (s.paused !== true) score += 50;
      if (
        Number.isFinite(preferredIteration) &&
        Number(s.iteration) === preferredIteration
      ) {
        score += 30;
      }
      if (
        Number.isFinite(Number(s.current_task_index)) &&
        Number.isFinite(Number(s.total_tasks)) &&
        Number(s.current_task_index) < Number(s.total_tasks)
      ) {
        score += 10;
      }
      if (Number.isFinite(Number(s.total_tasks))) {
        // Prefer sessions with larger task pools to maximize coverage.
        score += Math.min(Number(s.total_tasks), 100);
      }
      score += Math.floor(parseTimestamp(s.updated_at) / 1000);
      return { score, item: s };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) {
    throw new Error("No valid active sessions with session_id");
  }

  const best = scored[0].item;
  const url = new URL(`/ui/session/${encodeURIComponent(best.session_id)}`, baseUrl).toString();
  return { url, session: best };
}

const DEFAULT_TASK_TYPES = [
  "click",
  "draw",
  "test",
  "sequence_assembly",
  "open_answer",
];

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function mergeAuditOptions(...sources) {
  const merged = {};
  sources.forEach((src) => {
    if (!isPlainObject(src)) return;
    Object.assign(merged, src);
  });
  if ("silent" in merged) delete merged.silent;
  return merged;
}

async function runActions(page, actions = []) {
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const type = action.type;
    if (type === "wait") {
      const ms = Number(action.ms || 0);
      if (ms > 0) await page.waitForTimeout(ms);
      continue;
    }
    if (type === "waitFor") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      continue;
    }
    if (type === "click") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      await page.click(selector);
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "hover") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      await page.hover(selector);
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "focus") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      await page.focus(selector);
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "press") {
      if (action.selector) {
        await page.waitForSelector(action.selector, { timeout: action.timeout || 15000 });
        await page.focus(action.selector);
      }
      const key = action.key || "Enter";
      await page.keyboard.press(key);
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "type") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      await page.fill(selector, action.value || "");
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "select") {
      const selector = action.selector;
      if (!selector) continue;
      await page.waitForSelector(selector, { timeout: action.timeout || 15000 });
      if (Array.isArray(action.values)) {
        await page.selectOption(selector, action.values);
      } else if (action.value !== undefined) {
        await page.selectOption(selector, action.value);
      }
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "waitForFunction") {
      const script = action.script || action.expression;
      if (!script) continue;
      const arg = Object.prototype.hasOwnProperty.call(action, "arg")
        ? action.arg
        : undefined;
      const timeout = Number(action.timeout || 15000);
      const polling = Number(action.pollMs || 100);
      await page.waitForFunction(
        ({ code, data }) => {
          // eslint-disable-next-line no-new-func
          const fn = new Function("arg", code);
          try {
            return !!fn(data);
          } catch (e) {
            return false;
          }
        },
        { code: String(script), data: arg },
        { timeout, polling }
      );
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "evaluate") {
      const script = action.script || action.expression;
      if (!script) continue;
      const arg = Object.prototype.hasOwnProperty.call(action, "arg")
        ? action.arg
        : undefined;
      const result = await page.evaluate(
        async ({ code, data }) => {
          const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
          // eslint-disable-next-line no-new-func
          const fn = new AsyncFunction("arg", String(code));
          return fn(data);
        },
        { code: script, data: arg }
      );
      if (action.failOnError !== false && result && result.ok === false) {
        throw new Error(
          `evaluate action failed: ${
            result.error || result.reason || JSON.stringify(result)
          }`
        );
      }
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "s1_modal") {
      const modal = String(action.modal || "pause").toLowerCase();
      await page.evaluate((requestedModal) => {
        const ui = window.UIHelpers || null;
        if (!ui) return;

        const closePause = () => {
          if (typeof ui.closePauseModal === "function") ui.closePauseModal();
          const pauseModal = document.getElementById("pause-confirm-modal");
          if (pauseModal) {
            pauseModal.classList.add("hidden");
            pauseModal.classList.remove("flex");
          }
        };
        const closeResume = () => {
          if (typeof ui.hideResumeModal === "function") ui.hideResumeModal();
          const resumeModal = document.getElementById("resume-modal");
          if (resumeModal) {
            resumeModal.classList.add("hidden");
            resumeModal.classList.remove("flex");
          }
        };

        if (requestedModal === "close" || requestedModal === "none") {
          closePause();
          closeResume();
          return;
        }

        closePause();
        closeResume();

        if (requestedModal === "pause") {
          if (typeof ui.openPauseModal === "function") {
            ui.openPauseModal();
            return;
          }
          const btn = document.getElementById("back-to-complexes-btn");
          if (btn) btn.click();
          return;
        }

        if (requestedModal === "resume") {
          if (typeof ui.showResumeModal === "function") {
            ui.showResumeModal();
            return;
          }
          const modal = document.getElementById("resume-modal");
          if (modal) {
            modal.classList.remove("hidden");
            modal.classList.add("flex");
          }
        }
      }, modal);
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "s1_review") {
      const mode = String(action.mode || "success").toLowerCase();
      const forceMode = mode === "failure" ? "force_failure" : "force_success";
      const result = await page.evaluate(async (cfg) => {
        const state = window.SessionState || {};
        const task = state.currentTask || (state.state && state.state.currentTask) || null;
        const sessionId = state.sessionId || (state.state && state.state.sessionId) || null;
        if (!task || !task.task_id || !sessionId) {
          return { ok: false, reason: "task_or_session_missing" };
        }

        try {
          const response = await fetch(
            `/api/session/${encodeURIComponent(sessionId)}/task/submit`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                task_id: task.task_id,
                user_input: {},
                audit_control: {
                  enabled: true,
                  mode: cfg.forceMode,
                },
              }),
            }
          );

          let json = null;
          try {
            json = await response.json();
          } catch (e) {
            json = null;
          }

          if (!response.ok || !json || !json.ok || !json.result) {
            return {
              ok: false,
              reason: "submit_failed",
              status: response.status,
              error: json && (json.error || json.message),
            };
          }

          const resultPayload = json.result;

          if (
            window.TaskRenderer &&
            typeof window.TaskRenderer.showEvaluationResult === "function"
          ) {
            window.TaskRenderer.showEvaluationResult(resultPayload);
          }

          const typeResolver =
            window.TaskRenderer &&
            typeof window.TaskRenderer.getCurrentEffectiveTaskType === "function"
              ? window.TaskRenderer.getCurrentEffectiveTaskType
              : null;
          const taskType = typeResolver ? typeResolver() : null;
          const subtypeResolver =
            window.TaskRenderer && typeof window.TaskRenderer.getTaskSubtype === "function"
              ? window.TaskRenderer.getTaskSubtype
              : null;
          const subtype = subtypeResolver ? subtypeResolver(task) : null;
          const rawTypeResolver =
            window.TaskRenderer && typeof window.TaskRenderer.getRawTaskType === "function"
              ? window.TaskRenderer.getRawTaskType
              : null;
          const rawType = rawTypeResolver ? rawTypeResolver(task) : null;

          if (taskType === "test" && window.TestUI && typeof window.TestUI.applyCheckFeedback === "function") {
            window.TestUI.applyCheckFeedback(resultPayload);
          } else if (
            taskType === "sequence_assembly" &&
            window.SequenceUI &&
            typeof window.SequenceUI.applyCheckFeedback === "function"
          ) {
            window.SequenceUI.applyCheckFeedback(resultPayload);
          } else if (taskType === "click") {
            if (
              subtype !== "error_detection" &&
              window.ClickUI &&
              typeof window.ClickUI.applyCheckFeedback === "function"
            ) {
              window.ClickUI.applyCheckFeedback(resultPayload);
            }
          } else if (taskType === "draw") {
            if (
              rawType === "draw" &&
              window.ClickUI &&
              typeof window.ClickUI.applyCheckFeedback === "function"
            ) {
              window.ClickUI.applyCheckFeedback(resultPayload);
            } else if (
              window.DrawUI &&
              typeof window.DrawUI.applyCheckFeedback === "function"
            ) {
              window.DrawUI.applyCheckFeedback(resultPayload);
            }
          } else if (
            taskType === "open_answer" &&
            window.OpenAnswerUI &&
            typeof window.OpenAnswerUI.applyCheckFeedback === "function"
          ) {
            window.OpenAnswerUI.applyCheckFeedback(resultPayload);
          }

          if (window.UIHelpers && typeof window.UIHelpers.setCanGoNext === "function") {
            window.UIHelpers.setCanGoNext(resultPayload.success === true);
          }
          if (
            window.SessionControls &&
            typeof window.SessionControls.refreshCheckButtonState === "function"
          ) {
            window.SessionControls.refreshCheckButtonState();
          }

          return {
            ok: true,
            success: resultPayload.success === true,
            message: resultPayload.message || null,
          };
        } catch (err) {
          return { ok: false, reason: String(err) };
        }
      }, { forceMode });

      if (action.failOnError !== false && result && result.ok === false) {
        throw new Error(
          `s1_review action failed: ${
            result.error || result.reason || JSON.stringify(result)
          }`
        );
      }
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
    if (type === "s1_seek_task") {
      const taskTypes = Array.isArray(action.taskTypes) && action.taskTypes.length
        ? action.taskTypes.map((x) => String(x))
        : [String(action.taskType || "test")];
      const maxSteps = Number(action.maxSteps || 30);
      const autoSubmitMode = String(action.autoSubmitMode || "force_success");
      const afterStepWaitMs = Number(action.afterStepWaitMs || 220);
      let result = { ok: false, reason: "max_steps_exceeded", maxSteps };
      for (let step = 0; step <= maxSteps; step += 1) {
        const urlNow = page.url();
        if (urlNow.includes("/results")) {
          result = { ok: false, reason: "reached_results_page", step };
          break;
        }
        if (urlNow.includes("/iteration/")) {
          const moved = await advanceFromIterationPage(page);
          if (moved === "none") {
            result = { ok: false, reason: "cannot_leave_iteration_page", step };
            break;
          }
          await page.waitForTimeout(afterStepWaitMs);
        }

        const info = await readS1TaskInfo(page);
        const ctx = await getPageContext(page);
        const type = String(info && (info.effectiveType || info.rawType || "unknown"));
        if (taskTypes.includes(type)) {
          result = {
            ok: true,
            step,
            foundType: type,
            taskId: info && info.taskId ? info.taskId : null,
          };
          break;
        }

        if (!ctx || !ctx.sessionId || !info || !info.taskId) {
          await page.waitForTimeout(afterStepWaitMs);
          continue;
        }

        const submitRes = await page.evaluate(
          async ({ sessionId, taskId, mode }) => {
            try {
              const response = await fetch(
                `/api/session/${encodeURIComponent(sessionId)}/task/submit`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    task_id: taskId,
                    user_input: {},
                    audit_control: {
                      enabled: true,
                      mode,
                    },
                  }),
                }
              );
              let json = null;
              try {
                json = await response.json();
              } catch (e) {
                json = null;
              }
              return {
                ok: !!(response.ok && json && json.ok),
                status: response.status,
                error: json && (json.error || json.message),
              };
            } catch (err) {
              return { ok: false, error: String(err) };
            }
          },
          { sessionId: ctx.sessionId, taskId: info.taskId, mode: autoSubmitMode }
        );
        if (!submitRes || !submitRes.ok) {
          result = {
            ok: false,
            reason: "submit_failed",
            step,
            type,
            error: submitRes ? submitRes.error : "unknown",
          };
          break;
        }

        const advanced = await page.evaluate(async () => {
          if (
            window.SessionControls &&
            typeof window.SessionControls.handleNextTask === "function"
          ) {
            await window.SessionControls.handleNextTask();
            return "handler";
          }
          const state = window.SessionState || {};
          const sessionId = state.sessionId || (state.state && state.state.sessionId) || null;
          if (window.SessionAPI && typeof window.SessionAPI.nextTask === "function" && sessionId) {
            await window.SessionAPI.nextTask(sessionId);
            return "api";
          }
          const btn = document.getElementById("next-task-btn");
          if (btn) {
            btn.click();
            return "click";
          }
          return "none";
        });

        if (advanced === "none") {
          result = { ok: false, reason: "cannot_advance_task", step, type };
          break;
        }

        await page.waitForTimeout(afterStepWaitMs);
      }

      if (action.failOnError !== false && result && result.ok === false) {
        throw new Error(
          `s1_seek_task action failed: ${
            result.reason || result.error || JSON.stringify(result)
          }`
        );
      }
      if (action.waitMs) await page.waitForTimeout(action.waitMs);
      continue;
    }
  }
}

async function applyTheme(page, themeId) {
  await page.evaluate((theme) => {
    if (window.ThemeManager && typeof window.ThemeManager.setTheme === "function") {
      window.ThemeManager.setTheme(theme);
    } else {
      localStorage.setItem("app-theme", theme);
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, themeId);
}

const CONTRAST_AUDIT_FREEZE_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

async function settlePageForContrastAudit(page) {
  await page.evaluate((cssText) => {
    const styleId = "__contrast_audit_freeze_style__";
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = styleId;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = cssText;

    if (typeof document.getAnimations === "function") {
      document.getAnimations({ subtree: true }).forEach((animation) => {
        try {
          animation.finish();
        } catch (err) {
          try {
            animation.cancel();
          } catch (_ignore) {
            // Ignore animations that cannot be force-finished.
          }
        }
      });
    }
  }, CONTRAST_AUDIT_FREEZE_CSS);
}

async function readS1TaskInfo(page) {
  return page.evaluate(() => {
    const state = window.SessionState || null;
    const task =
      (state && (state.currentTask || (state.state && state.state.currentTask))) ||
      null;

    const rawType =
      window.TaskRenderer && typeof window.TaskRenderer.getRawTaskType === "function"
        ? window.TaskRenderer.getRawTaskType(task)
        : task &&
          (task.task_type ||
            task.type ||
            (task.task_data && (task.task_data.task_type || task.task_data.type))) ||
          null;

    const effectiveType =
      window.TaskRenderer &&
      typeof window.TaskRenderer.pickEffectiveTaskType === "function"
        ? window.TaskRenderer.pickEffectiveTaskType(task)
        : rawType;

    const subtype =
      window.TaskRenderer && typeof window.TaskRenderer.getTaskSubtype === "function"
        ? window.TaskRenderer.getTaskSubtype(task)
        : task &&
          (task.subtype ||
            (task.task_data &&
              (task.task_data.subtype ||
                (task.task_data.content && task.task_data.content.subtype)))) ||
          null;

    const difficulty =
      (task &&
        (task.difficulty ??
          (task.task_data && task.task_data.difficulty) ??
          (task.task_data &&
            task.task_data.content &&
            task.task_data.content.difficulty))) ??
      null;

    const queueIndex = task && task.queue ? task.queue.index : null;
    const queueTotal = task && task.queue ? task.queue.total : null;
    const taskId = task ? task.task_id : null;

    return {
      taskId,
      rawType,
      effectiveType,
      subtype,
      difficulty,
      queueIndex,
      queueTotal,
    };
  });
}

async function getPageContext(page) {
  return page.evaluate(() => {
    const pathname = window.location.pathname || "";
    const segments = pathname.split("/").filter(Boolean);
    let sessionId = null;
    const sessionIdx = segments.indexOf("session");
    if (sessionIdx >= 0 && segments[sessionIdx + 1]) {
      sessionId = decodeURIComponent(segments[sessionIdx + 1]);
    }
    if (!sessionId) {
      const state = window.SessionState || null;
      sessionId =
        (state && (state.sessionId || (state.state && state.state.sessionId))) || null;
    }
    return { pathname, sessionId };
  });
}

async function advanceFromIterationPage(page) {
  return page.evaluate(() => {
    const btn = document.getElementById("continue-btn");
    if (btn) {
      btn.click();
      return "clicked";
    }
    const pathname = window.location.pathname || "";
    const segments = pathname.split("/").filter(Boolean);
    const sessionIdx = segments.indexOf("session");
    if (sessionIdx >= 0 && segments[sessionIdx + 1]) {
      const sessionId = segments[sessionIdx + 1];
      window.location.href = `/ui/session/${sessionId}`;
      return "redirected";
    }
    return "none";
  });
}

function buildTargetSet({
  taskTypes,
  difficulties,
  completionMode,
  subtypesByType,
}) {
  if (!Array.isArray(taskTypes) || !taskTypes.length) return null;
  if (!Array.isArray(difficulties) || !difficulties.length) return null;

  const target = new Set();
  if (completionMode === "subtype" && subtypesByType) {
    taskTypes.forEach((type) => {
      const subtypes = Array.isArray(subtypesByType[type]) ? subtypesByType[type] : [];
      if (!subtypes.length) {
        difficulties.forEach((diff) => {
          target.add(`${type}|none|${diff}`);
        });
        return;
      }
      subtypes.forEach((sub) => {
        difficulties.forEach((diff) => {
          target.add(`${type}|${sub}|${diff}`);
        });
      });
    });
    return target;
  }

  taskTypes.forEach((type) => {
    difficulties.forEach((diff) => {
      target.add(`${type}|${diff}`);
    });
  });
  return target;
}

function normalizeTaskType(raw) {
  if (!raw) return null;
  const value = String(raw).trim().toLowerCase();
  return value || null;
}

function readTaskTypeFromTaskJson(taskJson) {
  if (!taskJson || typeof taskJson !== "object") return null;
  const candidates = [
    taskJson.type,
    taskJson.task_type,
    taskJson.metadata && taskJson.metadata.type,
    taskJson.task_data && taskJson.task_data.type,
    taskJson.task_data && taskJson.task_data.task_type,
    taskJson.task_data && taskJson.task_data._original_type,
    taskJson.task_data &&
      taskJson.task_data.content &&
      taskJson.task_data.content.type,
    taskJson.content && taskJson.content.type,
  ];
  for (const candidate of candidates) {
    const normalized = normalizeTaskType(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function readTaskTypeFromRef(taskRef, taskTypeCache) {
  if (!taskRef || typeof taskRef !== "string") return null;
  if (taskTypeCache.has(taskRef)) return taskTypeCache.get(taskRef);

  const parts = taskRef.split("/").filter(Boolean);
  if (parts.length < 3) {
    taskTypeCache.set(taskRef, null);
    return null;
  }

  const moduleId = parts[0];
  const topicId = parts[1];
  const taskId = parts[parts.length - 1];
  const taskJsonPath = path.resolve(
    process.cwd(),
    "data",
    "modules",
    moduleId,
    "topics",
    topicId,
    "tasks",
    taskId,
    "task.json"
  );

  if (!fs.existsSync(taskJsonPath)) {
    taskTypeCache.set(taskRef, null);
    return null;
  }

  try {
    const raw = fs.readFileSync(taskJsonPath, "utf8");
    const parsed = JSON.parse(raw);
    const taskType = readTaskTypeFromTaskJson(parsed);
    taskTypeCache.set(taskRef, taskType || null);
    return taskType || null;
  } catch (err) {
    taskTypeCache.set(taskRef, null);
    return null;
  }
}

async function loadComplexes(baseUrl) {
  if (!baseUrl) return [];
  const complexesUrl = new URL("/api/complexes", baseUrl).toString();
  try {
    const response = await fetch(complexesUrl);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    return items.filter((item) => item && item.id);
  } catch (err) {
    return [];
  }
}

async function loadTaskCatalog(baseUrl) {
  if (!baseUrl) return [];
  const catalogUrl = new URL("/api/task-catalog", baseUrl).toString();
  try {
    const response = await fetch(catalogUrl);
    if (!response.ok) return [];
    const payload = await response.json().catch(() => null);
    const items = Array.isArray(payload && payload.items) ? payload.items : [];
    return items
      .map((item) => {
        if (!item) return null;
        const taskRef = item.task_ref || item.ref || null;
        return taskRef ? { ...item, task_ref: String(taskRef) } : null;
      })
      .filter(Boolean);
  } catch (err) {
    return [];
  }
}

async function advanceSessionTask(baseUrl, sessionId) {
  if (!baseUrl || !sessionId) {
    return {
      httpOk: false,
      ok: false,
      finished: false,
      task: null,
      error: "missing_base_or_session",
    };
  }

  try {
    const nextUrl = new URL(
      `/api/session/${encodeURIComponent(sessionId)}/task/next`,
      baseUrl
    ).toString();
    const response = await fetch(nextUrl, { method: "POST" });
    const payload = await response.json().catch(() => null);
    return {
      httpOk: response.ok,
      ok: !!(payload && payload.ok),
      finished: !!(payload && payload.finished),
      task: payload && payload.task ? payload.task : null,
      error:
        (payload && (payload.error || payload.message || payload.reason)) ||
        (response.ok ? null : `HTTP ${response.status}`),
    };
  } catch (err) {
    return {
      httpOk: false,
      ok: false,
      finished: false,
      task: null,
      error: String(err),
    };
  }
}

async function createTemporaryCoverageComplex({
  baseUrl,
  targetTaskTypes,
  preferredTypes,
  tasksPerType,
  excludeSubtypes,
}) {
  if (!baseUrl) return null;
  const taskCatalog = await loadTaskCatalog(baseUrl);
  if (!taskCatalog.length) return null;

  const normalizedTargets = Array.from(
    new Set(
      (Array.isArray(targetTaskTypes) ? targetTaskTypes : [])
        .map((x) => normalizeTaskType(x))
        .filter(Boolean)
    )
  );
  const preferred = Array.from(
    new Set(
      (Array.isArray(preferredTypes) ? preferredTypes : [])
        .map((x) => normalizeTaskType(x))
        .filter(Boolean)
    )
  );
  const typeOrder = [
    ...preferred,
    ...normalizedTargets.filter((t) => !preferred.includes(t)),
  ];

  const excludedSubtypeSet = new Set(
    (Array.isArray(excludeSubtypes) ? excludeSubtypes : ["error_detection"])
      .map((x) => String(x || "").trim().toLowerCase())
      .filter(Boolean)
  );

  const maxTasksPerType =
    Number.isFinite(Number(tasksPerType)) && Number(tasksPerType) > 0
      ? Number(tasksPerType)
      : 2;

  const selectedTaskRefs = [];
  const selectedByType = {};
  for (const type of typeOrder) {
    const perType = taskCatalog
      .filter((item) => normalizeTaskType(item.task_type) === type)
      .filter((item) => {
        const subtype = String(item.subtype || "").trim().toLowerCase();
        return !excludedSubtypeSet.has(subtype);
      })
      .slice(0, maxTasksPerType)
      .map((item) => String(item.task_ref));
    if (!perType.length) continue;
    selectedByType[type] = perType;
    perType.forEach((ref) => {
      if (!selectedTaskRefs.includes(ref)) selectedTaskRefs.push(ref);
    });
  }

  if (!selectedTaskRefs.length) return null;

  const complexId = `contrast_cov_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const createUrl = new URL("/api/complexes", baseUrl).toString();
  const createPayload = {
    id: complexId,
    name: "[AUTO] Contrast Coverage",
    description: "Temporary complex for automated contrast coverage sweep",
    tasks: selectedTaskRefs,
    chains: [],
    settings: {},
  };
  try {
    const response = await fetch(createUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createPayload),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload || !payload.ok) return null;
    return {
      complexId,
      selectedTaskRefs,
      selectedByType,
    };
  } catch (err) {
    return null;
  }
}

async function deleteComplex(baseUrl, complexId) {
  if (!baseUrl || !complexId) return;
  try {
    const deleteUrl = new URL(`/api/complexes/${encodeURIComponent(complexId)}`, baseUrl).toString();
    await fetch(deleteUrl, { method: "DELETE" });
  } catch (err) {
    // Best effort cleanup; ignore failures.
  }
}

function buildComplexCatalog(items, targetTaskTypes, taskTypeCache) {
  const targetSet = new Set(
    (Array.isArray(targetTaskTypes) ? targetTaskTypes : [])
      .map((x) => normalizeTaskType(x))
      .filter(Boolean)
  );

  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const taskRefs = Array.isArray(item.tasks) ? item.tasks : [];
      const typeSet = new Set();
      taskRefs.forEach((taskRef) => {
        const taskType = readTaskTypeFromRef(taskRef, taskTypeCache);
        if (taskType) typeSet.add(taskType);
      });
      const matchingTypeCount = Array.from(typeSet).filter((t) => targetSet.has(t)).length;
      return {
        complexId: item.id,
        taskCount: taskRefs.length,
        typeSet,
        matchingTypeCount,
      };
    })
    .sort((a, b) => {
      if (b.matchingTypeCount !== a.matchingTypeCount) {
        return b.matchingTypeCount - a.matchingTypeCount;
      }
      return b.taskCount - a.taskCount;
    });
}

function buildCoverageCandidates({
  coverage,
  autoSessionConfig,
  targetTaskTypes,
  targetDifficulties,
  complexCatalog,
}) {
  const autoCfg = autoSessionConfig || {};
  const explicitComplexIds = Array.isArray(coverage.complexIds)
    ? coverage.complexIds.map(String).filter(Boolean)
    : null;
  const allowComplexScan = coverage.allowComplexScan !== false;
  const fallbackComplexId = autoCfg.complexId ? String(autoCfg.complexId) : null;

  let complexIds = [];
  if (explicitComplexIds && explicitComplexIds.length) {
    complexIds = explicitComplexIds;
  } else if (!allowComplexScan && fallbackComplexId) {
    complexIds = [fallbackComplexId];
  } else {
    complexIds = complexCatalog.map((entry) => entry.complexId);
    if (fallbackComplexId && !complexIds.includes(fallbackComplexId)) {
      complexIds.unshift(fallbackComplexId);
    }
  }

  const uniqueComplexIds = [];
  const seenComplexIds = new Set();
  complexIds.forEach((id) => {
    const norm = String(id || "").trim();
    if (!norm || seenComplexIds.has(norm)) return;
    seenComplexIds.add(norm);
    uniqueComplexIds.push(norm);
  });

  const iterationCandidates = Array.isArray(coverage.iterationsToTry) && coverage.iterationsToTry.length
    ? coverage.iterationsToTry
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x >= 1)
    : (Array.isArray(targetDifficulties) && targetDifficulties.length
        ? targetDifficulties.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x >= 1)
        : [Number(autoCfg.preferredIteration || 1)]);

  const uniqueIterations = [];
  const seenIterations = new Set();
  iterationCandidates.forEach((iteration) => {
    if (seenIterations.has(iteration)) return;
    seenIterations.add(iteration);
    uniqueIterations.push(iteration);
  });

  const typeSetByComplex = new Map();
  complexCatalog.forEach((entry) => {
    typeSetByComplex.set(entry.complexId, entry.typeSet);
  });

  const maxComplexesToTry =
    Number.isFinite(Number(coverage.maxComplexesToTry)) &&
    Number(coverage.maxComplexesToTry) > 0
      ? Number(coverage.maxComplexesToTry)
      : uniqueComplexIds.length;
  const cappedComplexIds = uniqueComplexIds.slice(0, maxComplexesToTry);

  const normalizedTargetTypes = new Set(
    (Array.isArray(targetTaskTypes) ? targetTaskTypes : [])
      .map((x) => normalizeTaskType(x))
      .filter(Boolean)
  );

  const candidates = [];
  cappedComplexIds.forEach((complexId) => {
    const typeSet = typeSetByComplex.get(complexId) || new Set();
    uniqueIterations.forEach((iteration) => {
      candidates.push({
        complexId,
        iteration,
        typeSet,
        targetTypeCoverage: Array.from(typeSet).filter((t) => normalizedTargetTypes.has(t)).length,
      });
    });
  });

  return candidates.sort((a, b) => {
    if (b.targetTypeCoverage !== a.targetTypeCoverage) {
      return b.targetTypeCoverage - a.targetTypeCoverage;
    }
    return a.iteration - b.iteration;
  });
}

function computeMissingKeys(targetSet, completionSeen) {
  if (!targetSet) return [];
  const out = [];
  for (const key of targetSet) {
    if (!completionSeen.has(key)) out.push(key);
  }
  return out;
}

function buildCandidateScore(candidate, missingSet) {
  if (!candidate || !missingSet || !missingSet.size) return 0;
  const iteration = String(candidate.iteration);
  let score = 0;
  candidate.typeSet.forEach((taskType) => {
    if (missingSet.has(`${taskType}|${iteration}`)) score += 1;
  });
  return score;
}

async function runS1Coverage({
  page,
  pageCfg,
  themesForPage,
  auditorPath,
  outputDir,
  timestamp,
  summary,
  pageSlug,
  name,
  url,
  globalAuditOptions,
  pageAuditOptions,
  baseUrl,
}) {
  const coverage = pageCfg.s1Coverage || {};
  const autoSessionConfig = pageCfg.autoSession || coverage.autoSession || {};
  const coverageAuditOptions = isPlainObject(coverage.auditOptions)
    ? coverage.auditOptions
    : {};
  const auditOptions = mergeAuditOptions(
    globalAuditOptions,
    pageAuditOptions,
    coverageAuditOptions
  );
  const maxTasks = Number(coverage.maxTasks || 200);
  const afterTaskWaitMs = Number(coverage.afterTaskWaitMs || 200);
  const afterThemeWaitMs = Number(coverage.afterThemeWaitMs || 120);
  const autoSubmit = coverage.autoSubmit !== false;
  const autoSubmitMode = String(coverage.autoSubmitMode || "force_success");
  const completionMode = coverage.completionMode || "type";
  const includeSubtypes = coverage.includeSubtypes !== false;
  const targetTaskTypes = Array.isArray(coverage.targetTaskTypes) && coverage.targetTaskTypes.length
    ? coverage.targetTaskTypes
    : DEFAULT_TASK_TYPES;
  const targetDifficulties = Array.isArray(coverage.targetDifficulties) && coverage.targetDifficulties.length
    ? coverage.targetDifficulties
    : null;
  const targetSet = buildTargetSet({
    taskTypes: targetTaskTypes,
    difficulties: targetDifficulties,
    completionMode,
    subtypesByType: coverage.subtypesByType || null,
  });
  const stopWhenComplete = coverage.stopWhenComplete !== false;
  const multiSessionSweep = coverage.multiSessionSweep !== false;
  const maxSessionSweeps =
    Number.isFinite(Number(coverage.maxSessionSweeps)) &&
    Number(coverage.maxSessionSweeps) > 0
      ? Number(coverage.maxSessionSweeps)
      : 60;
  const comboSeen = new Set();
  const completionSeen = new Set();
  const coverageLog = [];
  const diagnostics = {
    noTaskRetries: 0,
    lastPathname: null,
    lastSessionId: null,
    breakReason: null,
    sweepCount: 0,
    sweeps: [],
  };

  const ensureAuditorReady = async () => {
    let hasAuditor = false;
    try {
      hasAuditor = await page.evaluate(
        () => typeof window.runContrastAudit === "function"
      );
    } catch (err) {
      hasAuditor = false;
    }
    if (hasAuditor) return true;
    try {
      await page.addScriptTag({ path: auditorPath });
    } catch (err) {
      return false;
    }
    try {
      return await page.evaluate(
        () => typeof window.runContrastAudit === "function"
      );
    } catch (err) {
      return false;
    }
  };

  const runAuditWithRetry = async (opts) => {
    const invokeAudit = async () => {
      try {
        return await page.evaluate((innerOpts) => {
          if (typeof window.runContrastAudit === "function") {
            return window.runContrastAudit({ ...(innerOpts || {}), silent: true });
          }
          return null;
        }, opts);
      } catch (err) {
        return null;
      }
    };

    const ready = await ensureAuditorReady();
    if (!ready) return null;

    let result = await invokeAudit();
    if (result) return result;

    try {
      await page.addScriptTag({ path: auditorPath });
    } catch (err) {
      return null;
    }
    result = await invokeAudit();
    return result;
  };

  const runCoverageSweep = async (sweepMeta = {}) => {
    let taskCounter = 0;
    let stagnantCount = 0;
    let lastFingerprint = null;
    let noTaskRetries = 0;
    const beforeCompletionSize = completionSeen.size;
    const sweepDiagnostics = {
      sweep: sweepMeta,
      noTaskRetries: 0,
      lastPathname: null,
      lastSessionId: null,
      breakReason: null,
      completedDelta: 0,
    };

    while (taskCounter < maxTasks) {
      const pageContext = await getPageContext(page);
      sweepDiagnostics.lastPathname = pageContext.pathname || null;
      sweepDiagnostics.lastSessionId = pageContext.sessionId || null;
      diagnostics.lastPathname = pageContext.pathname || null;
      diagnostics.lastSessionId = pageContext.sessionId || null;

      if (pageContext.pathname.includes("/results")) {
        sweepDiagnostics.breakReason = "results_page";
        break;
      }
      if (pageContext.pathname.includes("/iteration/")) {
        const moved = await advanceFromIterationPage(page);
        if (moved === "none") {
          sweepDiagnostics.breakReason = "iteration_no_continue_action";
          break;
        }
        await page.waitForTimeout(afterTaskWaitMs || 250);
        try {
          await page.waitForSelector("#task-content", { timeout: 15000 });
        } catch (e) {
          // Keep loop alive; next iteration decides if we can continue.
        }
      }

      const info = await readS1TaskInfo(page);
      if (!info || !info.taskId) {
        noTaskRetries += 1;
        sweepDiagnostics.noTaskRetries = noTaskRetries;
        diagnostics.noTaskRetries = noTaskRetries;
        if (noTaskRetries > 5) {
          sweepDiagnostics.breakReason = "task_not_available";
          break;
        }
        await page.waitForTimeout(afterTaskWaitMs || 250);
        continue;
      }
      noTaskRetries = 0;

      const rawTypeKey = normalizeTaskType(info.rawType);
      const effectiveTypeKey = normalizeTaskType(info.effectiveType);
      const typeKey = rawTypeKey || effectiveTypeKey || "unknown";
      const difficultyKey =
        info.difficulty !== null && info.difficulty !== undefined
          ? String(info.difficulty)
          : "unknown";
      const subtypeKey = includeSubtypes && info.subtype ? String(info.subtype) : null;

      const uniqueKey = `${typeKey}|${subtypeKey || "none"}|${difficultyKey}`;
      const completionKey =
        completionMode === "subtype" ? uniqueKey : `${typeKey}|${difficultyKey}`;

      if (!comboSeen.has(uniqueKey)) {
        await ensureAuditorReady();
        for (const theme of themesForPage) {
          await applyTheme(page, theme);
          await settlePageForContrastAudit(page);
          if (afterThemeWaitMs) await page.waitForTimeout(afterThemeWaitMs);

          if (Array.isArray(coverage.actionsPerTheme)) {
            await runActions(page, coverage.actionsPerTheme);
          }

          const resultWithOptions = await runAuditWithRetry(auditOptions);

          const comboSlug = slugify(
            `${typeKey}${subtypeKey ? `-${subtypeKey}` : ""}-d${difficultyKey}`
          );
          const themeSlug = slugify(theme);
          const fileName = `${pageSlug}__${comboSlug}__${themeSlug}__${timestamp}.md`;
          const outPath = path.join(outputDir, fileName);
          const reportText =
            resultWithOptions && resultWithOptions.report
              ? resultWithOptions.report
              : `# Contrast Audit Report\n\nNo report generated.`;
          fs.writeFileSync(outPath, reportText, "utf8");

          summary.push({
            page: name || url,
            theme,
            combo: `${typeKey}${subtypeKey ? `/${subtypeKey}` : ""} (d=${difficultyKey})`,
            issues:
              resultWithOptions && resultWithOptions.issues
                ? resultWithOptions.issues.length
                : null,
            warnings:
              resultWithOptions && resultWithOptions.warnings
                ? resultWithOptions.warnings.length
                : null,
            report: outPath,
          });
        }

        comboSeen.add(uniqueKey);
        coverageLog.push({
          type: typeKey,
          rawType: rawTypeKey || null,
          effectiveType: effectiveTypeKey || null,
          subtype: subtypeKey,
          difficulty: difficultyKey,
          taskId: info.taskId,
          queueIndex: info.queueIndex,
          queueTotal: info.queueTotal,
          sweep: sweepMeta || null,
        });
      }

      completionSeen.add(completionKey);

      if (targetSet && stopWhenComplete && computeMissingKeys(targetSet, completionSeen).length === 0) {
        sweepDiagnostics.breakReason = "target_complete";
        break;
      }

      const fingerprint = `${info.taskId}|${info.queueIndex ?? ""}`;
      if (fingerprint === lastFingerprint) {
        stagnantCount += 1;
      } else {
        stagnantCount = 0;
        lastFingerprint = fingerprint;
      }

      if (stagnantCount >= 3) {
        sweepDiagnostics.breakReason = "stagnant_task_fingerprint";
        break;
      }

      if (autoSubmit && pageContext.sessionId && info.taskId) {
        const submitRes = await page.evaluate(
          async ({ sessionId, taskId, mode }) => {
            try {
              const response = await fetch(
                `/api/session/${encodeURIComponent(sessionId)}/task/submit`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    task_id: taskId,
                    user_input: {},
                    audit_control: {
                      enabled: true,
                      mode,
                    },
                  }),
                }
              );
              let json = null;
              try {
                json = await response.json();
              } catch (e) {
                json = null;
              }
              return {
                httpOk: response.ok,
                ok: !!(json && json.ok),
                error: json && json.error ? json.error : null,
              };
            } catch (err) {
              return { httpOk: false, ok: false, error: String(err) };
            }
          },
          { sessionId: pageContext.sessionId, taskId: info.taskId, mode: autoSubmitMode }
        );
        if (!submitRes || !submitRes.httpOk || !submitRes.ok) {
          throw new Error(
            `Auto submit failed for task ${info.taskId}: ${
              submitRes ? submitRes.error : "unknown"
            }`
          );
        }
      }

      const nextRes = await advanceSessionTask(baseUrl, pageContext.sessionId);
      if (nextRes.httpOk && nextRes.ok) {
        if (nextRes.finished || !nextRes.task) {
          sweepDiagnostics.breakReason = "session_finished";
          break;
        }

        try {
          const sessionUrl = new URL(
            `/ui/session/${encodeURIComponent(pageContext.sessionId)}`,
            baseUrl
          ).toString();
          await page.goto(sessionUrl, { waitUntil: "networkidle" });
          await page.waitForSelector("#task-content", { timeout: 20000 });
          await ensureAuditorReady();
        } catch (err) {
          sweepDiagnostics.breakReason = "reload_after_next_failed";
          break;
        }
      } else {
        const advanced = await page.evaluate(async () => {
          if (
            window.SessionControls &&
            typeof window.SessionControls.handleNextTask === "function"
          ) {
            await window.SessionControls.handleNextTask();
            return "handler";
          }
          const sessionId =
            (window.SessionState &&
              (window.SessionState.sessionId ||
                (window.SessionState.state && window.SessionState.state.sessionId))) ||
            null;
          if (window.SessionAPI && typeof window.SessionAPI.nextTask === "function" && sessionId) {
            await window.SessionAPI.nextTask(sessionId);
            return "api";
          }
          const btn = document.getElementById("next-task-btn");
          if (btn) {
            btn.click();
            return "click";
          }
          return "none";
        });

        if (advanced === "none") {
          sweepDiagnostics.breakReason = "cannot_advance_task";
          break;
        }
      }

      if (afterTaskWaitMs) await page.waitForTimeout(afterTaskWaitMs);

      const urlNow = page.url();
      if (!urlNow.includes("/ui/session/") || urlNow.includes("/results")) {
        sweepDiagnostics.breakReason = "navigated_outside_s1";
        break;
      }

      taskCounter += 1;
    }

    if (!sweepDiagnostics.breakReason) sweepDiagnostics.breakReason = "max_tasks_reached";
    sweepDiagnostics.completedDelta = completionSeen.size - beforeCompletionSize;
    diagnostics.breakReason = sweepDiagnostics.breakReason;
    diagnostics.sweeps.push(sweepDiagnostics);
    diagnostics.sweepCount = diagnostics.sweeps.length;
    return sweepDiagnostics;
  };

  await ensureAuditorReady();
  await runCoverageSweep({ source: "initial_page" });

  const missingAfterInitial = computeMissingKeys(targetSet, completionSeen);
  let temporaryCoverageComplex = null;
  if (
    targetSet &&
    stopWhenComplete &&
    missingAfterInitial.length > 0 &&
    multiSessionSweep &&
    baseUrl
  ) {
    const missingTypes = Array.from(
      new Set(
        missingAfterInitial
          .map((key) => {
            const firstSep = String(key).indexOf("|");
            return firstSep > 0 ? String(key).slice(0, firstSep) : null;
          })
          .filter(Boolean)
      )
    );

    if (coverage.autoCreateCoverageComplex !== false) {
      temporaryCoverageComplex = await createTemporaryCoverageComplex({
        baseUrl,
        targetTaskTypes,
        preferredTypes: missingTypes,
        tasksPerType: coverage.coverageComplexTasksPerType,
        excludeSubtypes: coverage.coverageComplexExcludeSubtypes,
      });
    }

    const complexes = await loadComplexes(baseUrl);
    const taskTypeCache = new Map();
    const complexCatalog = buildComplexCatalog(complexes, targetTaskTypes, taskTypeCache);
    if (
      temporaryCoverageComplex &&
      temporaryCoverageComplex.complexId &&
      !complexCatalog.find((x) => x.complexId === temporaryCoverageComplex.complexId)
    ) {
      const temporaryTypeSet = new Set(
        Object.keys(temporaryCoverageComplex.selectedByType || {}).map((x) =>
          normalizeTaskType(x)
        )
      );
      complexCatalog.unshift({
        complexId: temporaryCoverageComplex.complexId,
        taskCount: Array.isArray(temporaryCoverageComplex.selectedTaskRefs)
          ? temporaryCoverageComplex.selectedTaskRefs.length
          : 0,
        typeSet: temporaryTypeSet,
        matchingTypeCount: temporaryTypeSet.size,
      });
    }
    const candidates = buildCoverageCandidates({
      coverage,
      autoSessionConfig,
      targetTaskTypes,
      targetDifficulties,
      complexCatalog,
    });
    const tried = new Set();
    const maxSweeps = Math.max(1, maxSessionSweeps);

    while (
      diagnostics.sweeps.length < maxSweeps &&
      computeMissingKeys(targetSet, completionSeen).length > 0
    ) {
      const missingSet = new Set(computeMissingKeys(targetSet, completionSeen));
      let bestIdx = -1;
      let bestScore = -1;
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const candidateKey = `${candidate.complexId}|${candidate.iteration}`;
        if (tried.has(candidateKey)) continue;
        const score = buildCandidateScore(candidate, missingSet);
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;

      const candidate = candidates[bestIdx];
      const candidateKey = `${candidate.complexId}|${candidate.iteration}`;
      tried.add(candidateKey);

      let created = null;
      try {
        created = await createSessionForAuto(baseUrl, {
          ...autoSessionConfig,
          complexId: candidate.complexId,
          startIteration: candidate.iteration,
        });
      } catch (err) {
        diagnostics.sweeps.push({
          sweep: { source: "auto_session_create", ...candidate },
          breakReason: `session_create_failed:${err && err.message ? err.message : String(err)}`,
          completedDelta: 0,
        });
        diagnostics.sweepCount = diagnostics.sweeps.length;
        continue;
      }

      try {
        await page.goto(created.url, { waitUntil: "networkidle" });
        await page.waitForSelector("#task-content", { timeout: 20000 });
        await ensureAuditorReady();
      } catch (err) {
        diagnostics.sweeps.push({
          sweep: {
            source: "auto_session_goto",
            ...candidate,
            sessionId: created && created.session ? created.session.session_id : null,
          },
          breakReason: `session_goto_failed:${err && err.message ? err.message : String(err)}`,
          completedDelta: 0,
        });
        diagnostics.sweepCount = diagnostics.sweeps.length;
        continue;
      }

      if (afterTaskWaitMs) await page.waitForTimeout(afterTaskWaitMs);
      await runCoverageSweep({
        source: "auto_session",
        complexId: candidate.complexId,
        iteration: candidate.iteration,
        sessionId: created && created.session ? created.session.session_id : null,
      });
    }
  }

  if (temporaryCoverageComplex && temporaryCoverageComplex.complexId) {
    await deleteComplex(baseUrl, temporaryCoverageComplex.complexId);
  }

  const missing = computeMissingKeys(targetSet, completionSeen);

  const coverageSummary = {
    page: name || url,
    url,
    combos: Array.from(comboSeen),
    completionSeen: Array.from(completionSeen),
    missing,
    log: coverageLog,
    diagnostics,
  };

  const summaryPath = path.join(
    outputDir,
    `${pageSlug}__coverage__${timestamp}.json`
  );
  fs.writeFileSync(summaryPath, JSON.stringify(coverageSummary, null, 2), "utf8");

  summary.push({
    page: name || url,
    coverage: true,
    combos: comboSeen.size,
    completed: completionSeen.size,
    missing: missing.length,
    report: summaryPath,
  });
}

async function main() {
  const cli = parseCliArgs();
  const { config, configPath } = loadConfig(cli);
  const playwright = await loadPlaywright();
  const { chromium } = playwright;

  const baseUrl = config.baseUrl || "";
  const themes = Array.isArray(config.themes)
    ? config.themes
    : ["light-a", "light-b", "neutral-a", "neutral-b", "dark-a", "dark-b"];
  const pages = Array.isArray(config.pages) ? config.pages : [];

  if (!pages.length) {
    throw new Error("No pages configured in contrast audit config.");
  }

  const outputDir = path.resolve(process.cwd(), config.outputDir || "reports/contrast");
  const reportRetention = resolveReportRetentionPolicy(config);
  if (reportRetention.clearOutputDirBeforeRun) {
    resetDirectory(outputDir);
  } else {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const globalAfterThemeWaitMs = Number.isFinite(Number(config.afterThemeWaitMs))
    ? Math.max(0, Number(config.afterThemeWaitMs))
    : null;

  const auditorPath = path.resolve(__dirname, "..", "frontend", "contrast_auditor.js");
  if (!fs.existsSync(auditorPath)) {
    throw new Error(`Auditor script not found at ${auditorPath}`);
  }

  const browser = await chromium.launch({
    headless: config.headless !== false,
  });

  const summary = [];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const globalAuditOptions = isPlainObject(config.auditOptions)
    ? config.auditOptions
    : {};
  let previousAutoSession = null;

  for (const pageCfg of pages) {
    const name = pageCfg.name || pageCfg.url;
    let resolvedPageUrl = pageCfg.url;
    const autoSessionConfig =
      pageCfg.autoSession ||
      (pageCfg.s1Coverage && pageCfg.s1Coverage.autoSession) ||
      null;
    if (autoSessionConfig) {
      const autoCfg = { ...autoSessionConfig };
      const preferredFromUrl = extractSessionIdFromUrlLike(pageCfg.url);
      const configuredHasPlaceholder = hasSessionPlaceholder(pageCfg.url);
      const canReusePreviousDirect =
        configuredHasPlaceholder &&
        autoCfg.usePreviousSession !== false &&
        autoCfg.reusePreviousSessionDirect !== false &&
        previousAutoSession &&
        previousAutoSession.session_id &&
        !autoCfg.sessionId;
      if (
        autoCfg.usePreviousSession !== false &&
        previousAutoSession &&
        previousAutoSession.session_id &&
        !autoCfg.sessionId &&
        !autoCfg.preferredSessionId
      ) {
        autoCfg.preferredSessionId = String(previousAutoSession.session_id);
        if (!autoCfg.complexId && previousAutoSession.complex_id) {
          autoCfg.complexId = String(previousAutoSession.complex_id);
        }
      }

      if (canReusePreviousDirect) {
        resolvedPageUrl = injectSessionIdIntoUrlLike(
          pageCfg.url,
          previousAutoSession.session_id
        );
        console.log(
          `[contrast_audit] ${name || "page"} autoSession reused previous session: ${previousAutoSession.session_id}`
        );
      }

      // If config already points to a concrete session URL, use it as primary source.
      // This avoids false negatives from /api/sessions/active filtering.
      if (
        preferredFromUrl &&
        autoCfg.preferConfiguredUrlSession !== false &&
        !configuredHasPlaceholder &&
        !canReusePreviousDirect
      ) {
        resolvedPageUrl = pageCfg.url;
        console.log(
          `[contrast_audit] S1 using configured session url: ${preferredFromUrl}`
        );
      } else if (!autoCfg.sessionId && preferredFromUrl) {
        autoCfg.preferredSessionId = preferredFromUrl;
      }
      const strictAuto = autoCfg.strict === true;
      if (
        !canReusePreviousDirect &&
        !(preferredFromUrl && autoCfg.preferConfiguredUrlSession !== false)
      ) {
        try {
          const autoResolved = await resolveAutoSessionUrl(baseUrl, autoCfg);
          previousAutoSession = autoResolved.session || previousAutoSession;
          if (configuredHasPlaceholder && autoResolved.session && autoResolved.session.session_id) {
            resolvedPageUrl = injectSessionIdIntoUrlLike(
              pageCfg.url,
              autoResolved.session.session_id
            );
          } else {
            resolvedPageUrl = autoResolved.url;
          }
          console.log(
            `[contrast_audit] ${name || "page"} autoSession selected: ${autoResolved.session.session_id} ` +
              `(complex=${autoResolved.session.complex_id}, iteration=${autoResolved.session.iteration}, paused=${autoResolved.session.paused})`
          );
        } catch (err) {
          if (strictAuto || !resolvedPageUrl) {
            throw err;
          }
          console.warn(
            `[contrast_audit] ${name || "page"} autoSession fallback to configured url: ${resolvedPageUrl}. ` +
              `Reason: ${err && err.message ? err.message : err}`
          );
        }
      }
    }

    if (hasSessionPlaceholder(resolvedPageUrl)) {
      throw new Error(
        `Page "${name || pageCfg.url}" contains unresolved session placeholder in url: ${resolvedPageUrl}`
      );
    }

    const url = resolveUrl(baseUrl, resolvedPageUrl);
    if (!url) continue;

    const pageSlug = slugify(name || url);
    const themesForPage =
      Array.isArray(pageCfg.themes) && pageCfg.themes.length ? pageCfg.themes : themes;
    const pageAuditOptions = isPlainObject(pageCfg.auditOptions)
      ? pageCfg.auditOptions
      : {};

    if (pageCfg.s1Coverage) {
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: pageCfg.waitUntil || "networkidle" });

      if (pageCfg.waitFor) {
        await page.waitForSelector(pageCfg.waitFor, {
          state: pageCfg.waitForState || "attached",
          timeout: pageCfg.waitForTimeout || 20000,
        });
      }

      if (Array.isArray(pageCfg.actionsOnce)) {
        await runActions(page, pageCfg.actionsOnce);
      }

      await runS1Coverage({
        page,
        pageCfg,
        themesForPage,
        auditorPath,
        outputDir,
        timestamp,
        summary,
        pageSlug,
        name,
        url,
        globalAuditOptions,
        pageAuditOptions,
        baseUrl,
      });
      await page.close();
    } else {
      const auditOptions = mergeAuditOptions(globalAuditOptions, pageAuditOptions);
      const pageAfterThemeWaitMs = Number.isFinite(Number(pageCfg.afterThemeWaitMs))
        ? Math.max(0, Number(pageCfg.afterThemeWaitMs))
        : globalAfterThemeWaitMs !== null
          ? globalAfterThemeWaitMs
          : 120;
      const page = await browser.newPage();

      for (const theme of themesForPage) {
        await page.goto(url, { waitUntil: pageCfg.waitUntil || "networkidle" });

        if (pageCfg.waitFor) {
          await page.waitForSelector(pageCfg.waitFor, {
            state: pageCfg.waitForState || "attached",
            timeout: pageCfg.waitForTimeout || 20000,
          });
        }

        if (Array.isArray(pageCfg.actionsOnce)) {
          await runActions(page, pageCfg.actionsOnce);
        }

        await page.addScriptTag({ path: auditorPath });
        await applyTheme(page, theme);
        await settlePageForContrastAudit(page);

        if (pageAfterThemeWaitMs > 0) {
          await page.waitForTimeout(pageAfterThemeWaitMs);
        }

        if (Array.isArray(pageCfg.actions)) {
          await runActions(page, pageCfg.actions);
        }

        const result = await page.evaluate((opts) => {
          if (typeof window.runContrastAudit === "function") {
            return window.runContrastAudit({ ...(opts || {}), silent: true });
          }
          return null;
        }, auditOptions);

        const themeSlug = slugify(theme);
        const fileName = `${pageSlug}__${themeSlug}__${timestamp}.md`;
        const outPath = path.join(outputDir, fileName);
        const reportText =
          result && result.report
            ? result.report
            : `# Contrast Audit Report\n\nNo report generated.`;
        fs.writeFileSync(outPath, reportText, "utf8");

        summary.push({
          page: name || url,
          theme,
          issues: result && result.issues ? result.issues.length : null,
          warnings: result && result.warnings ? result.warnings.length : null,
          report: outPath,
        });
      }
      await page.close();
    }
  }

  await browser.close();

  console.log("\nContrast audit completed.");
  summary.forEach((row) => {
    if (row.coverage) {
      console.log(
        `- ${row.page} [coverage] combos=${row.combos} completed=${row.completed} missing=${row.missing} -> ${row.report}`
      );
      return;
    }
    if (row.combo) {
      console.log(
        `- ${row.page} [${row.theme}] ${row.combo} issues=${row.issues ?? "?"} warnings=${row.warnings ?? "?"} -> ${row.report}`
      );
      return;
    }
    console.log(
      `- ${row.page} [${row.theme}] issues=${row.issues ?? "?"} warnings=${row.warnings ?? "?"} -> ${row.report}`
    );
  });

  const issueRows = summary.filter(
    (row) => !row.coverage && Number.isFinite(Number(row.issues)) && Number(row.issues) > 0
  );
  const totalIssues = issueRows.reduce((acc, row) => acc + Number(row.issues || 0), 0);
  const warningRows = summary.filter(
    (row) => !row.coverage && Number.isFinite(Number(row.warnings)) && Number(row.warnings) > 0
  );
  const totalWarnings = warningRows.reduce((acc, row) => acc + Number(row.warnings || 0), 0);

  const coverageRows = summary.filter((row) => row.coverage);
  const coverageMissingRows = coverageRows.filter(
    (row) => Number.isFinite(Number(row.missing)) && Number(row.missing) > 0
  );
  const totalMissingCoverage = coverageMissingRows.reduce(
    (acc, row) => acc + Number(row.missing || 0),
    0
  );

  const summaryArtifact = {
    timestamp,
    configPath,
    outputDir,
    baseUrl,
    totals: {
      rows: summary.length,
      issueRows: issueRows.length,
      issues: totalIssues,
      warningRows: warningRows.length,
      warnings: totalWarnings,
      coverageRows: coverageRows.length,
      missingCoverageRows: coverageMissingRows.length,
      missingCoverage: totalMissingCoverage,
    },
    rows: summary,
  };
  const summaryArtifactPath = path.join(
    outputDir,
    `${slugify(path.basename(configPath, path.extname(configPath)))}__summary__${timestamp}.json`
  );
  fs.writeFileSync(summaryArtifactPath, JSON.stringify(summaryArtifact, null, 2), "utf8");
  console.log(`[contrast_audit] summary json: ${summaryArtifactPath}`);

  const cleanRun =
    totalIssues === 0 && totalWarnings === 0 && totalMissingCoverage === 0;
  if (cleanRun && reportRetention.deleteOutputDirOnCleanRun) {
    try {
      fs.rmSync(outputDir, { recursive: true, force: true });
      console.log(`[contrast_audit] clean run: removed output dir ${outputDir}`);
    } catch (err) {
      console.warn(
        `[contrast_audit] clean run: failed to remove output dir ${outputDir}: ${err && err.message ? err.message : err}`
      );
    }
  }

  const failOnIssues = config.failOnIssues === true;
  const failOnCoverageMissing = config.failOnCoverageMissing === true;

  if (failOnCoverageMissing && coverageMissingRows.length > 0) {
    throw new Error(
      `coverage missing detected: rows=${coverageMissingRows.length}, missing=${totalMissingCoverage}`
    );
  }
  if (failOnIssues && issueRows.length > 0) {
    throw new Error(`contrast issues detected: rows=${issueRows.length}, issues=${totalIssues}`);
  }
}

main().catch((err) => {
  console.error("[contrast_audit] failed:", err.message || err);
  process.exit(1);
});
