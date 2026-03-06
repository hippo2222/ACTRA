/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/main.js"),
  "utf8"
);

function loadMain() {
  delete window.Main;
  window.eval(scriptCode);
  return window.Main;
}

describe("S1 Main loadInitialTask", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="status-banner"></div>
      <div id="session-id-label"></div>
      <div id="theory-session-banner" class="hidden"></div>
      <div id="theory-session-title"></div>
      <div id="theory-session-meta"></div>
    `;
    window.history.replaceState({}, "", "/ui/session/sess-1");

    window.SessionState = {
      state: {
        sessionId: null,
        currentTask: { task_id: "t1" },
      },
    };
    window.SessionAPI = {
      getCurrentTask: vi.fn().mockResolvedValue({
        status: 503,
        data: { ok: false, error: "temporary failure" },
      }),
    };
    window.UIHelpers = {
      showStatus: vi.fn(),
      showRetryOption: vi.fn(),
      showResumeModal: vi.fn(),
      hideResumeModal: vi.fn(),
      setPaused: vi.fn(),
      setLoading: vi.fn(),
      setCanGoNext: vi.fn(),
      openPauseModal: vi.fn(),
      closePauseModal: vi.fn(),
    };
    window.TaskRenderer = {
      renderTask: vi.fn(),
    };
    window.SessionControls = {
      handleCheckAnswerClick: vi.fn(),
      handleSubmitAnswer: vi.fn(),
      handleNextTask: vi.fn(),
      handleCancelSession: vi.fn(),
      handlePauseConfirm: vi.fn(),
      handleResumeConfirm: vi.fn(),
      handleDiscardSession: vi.fn(),
      initTestSubmitGuard: vi.fn(),
      refreshCheckButtonState: vi.fn(),
      initBeforeUnloadGuard: vi.fn(),
    };
    window.SessionRoutes = {
      MAIN: "/ui/main",
      COMPLEXES: "/ui/complexes",
      SESSION_RESULTS: (sessionId) => `/ui/session/${encodeURIComponent(sessionId)}/results`,
    };
    window.SessionValidation = {
      validateSessionId: vi.fn(() => ({ valid: true })),
    };
    window.navigateWithTransition = vi.fn();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        ok: true,
        item: {
          id: "cx-1",
          theory_link: { theory_id: "th-a", title_cache: "Theory A" },
        },
      }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the current task rendered on recoverable load errors", async () => {
    const Main = loadMain();

    await Main.loadInitialTask();

    expect(window.UIHelpers.showStatus).toHaveBeenCalledWith(
      "temporary failure",
      "error"
    );
    expect(window.TaskRenderer.renderTask).not.toHaveBeenCalledWith(null);
    expect(window.UIHelpers.showRetryOption).not.toHaveBeenCalled();
  });

  it("uses retry UI on thrown load errors without crashing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.SessionAPI.getCurrentTask = vi.fn().mockRejectedValue(new Error("boom"));
    const Main = loadMain();

    await Main.loadInitialTask();

    expect(window.UIHelpers.showRetryOption).toHaveBeenCalledTimes(1);
    expect(window.UIHelpers.showRetryOption).toHaveBeenCalledWith(Main.loadInitialTask);
    expect(window.TaskRenderer.renderTask).not.toHaveBeenCalledWith(null);
  });

  it("shows theory context for session tasks linked to a theory", async () => {
    window.SessionAPI.getCurrentTask = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        paused: false,
        task: {
          task_id: "t1",
          complex_id: "cx-1",
        },
      },
    });
    const Main = loadMain();

    await Main.loadInitialTask();

    const banner = document.getElementById("theory-session-banner");
    const title = document.getElementById("theory-session-title");
    const meta = document.getElementById("theory-session-meta");

    expect(global.fetch).toHaveBeenCalledWith("/api/complexes/cx-1");
    expect(banner.classList.contains("hidden")).toBe(false);
    expect(title.textContent).toContain("Theory A");
    expect(meta.textContent).toContain("cx-1");
    expect(window.TaskRenderer.renderTask).toHaveBeenCalledWith({
      task_id: "t1",
      complex_id: "cx-1",
    });
  });
});
