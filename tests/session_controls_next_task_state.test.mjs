/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/session-controls.js"),
  "utf8"
);

function loadSessionControls() {
  delete window.SessionControls;
  window.eval(scriptCode);
  return window.SessionControls;
}

describe("SessionControls next task state", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="check-answer-btn" type="button"></button>`;
    window.SessionState = {
      isLoading: false,
      sessionId: "sess-1",
      paused: false,
      skipBeforeUnloadPrompt: false,
      currentTask: {
        task_id: "t1",
        module_id: "m1",
        topic_id: "tp1",
        iteration: 1,
        queue: { index: 0, total: 2 },
      },
      canGoNext: true,
      currentTaskChecked: true,
    };
    window.SessionAPI = {
      nextTask: vi.fn().mockResolvedValue({
        status: 500,
        data: { ok: false, error: "network" },
      }),
      getIterationResults: vi.fn().mockResolvedValue({
        status: 200,
        data: { ok: false },
      }),
    };
    window.UIHelpers = {
      showStatus: vi.fn(),
      showRetryOption: vi.fn(),
      showResumeModal: vi.fn(),
      hideResumeModal: vi.fn(),
      setPauseInFlight: vi.fn(),
      setCanGoNext: vi.fn(),
      setLoading: vi.fn(),
      showTaskSkeleton: vi.fn(),
      setPausedUI: vi.fn(),
    };
    window.TaskRenderer = {
      renderTask: vi.fn(),
      getTaskSubtype: vi.fn(() => null),
      getRawTaskType: vi.fn(() => "open_answer"),
      getCurrentEffectiveTaskType: vi.fn(() => "open_answer"),
      showEvaluationResult: vi.fn(),
    };
    window.DraftStorage = {};
    window.SessionRoutes = {
      MAIN: "/main",
      COMPLEXES: "/complexes",
      API: {
        CANCEL: () => "/api/cancel",
      },
    };
    window.SessionFlow = {
      handleNextTaskCompletion: vi.fn(() => ({ handled: false })),
    };
    window.NotificationUI = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    window.navigateWithTransition = vi.fn();
  });

  it("keeps the current task visible while next-task request is pending/fails", async () => {
    const SessionControls = loadSessionControls();

    await SessionControls.handleNextTask();

    expect(window.UIHelpers.showTaskSkeleton).not.toHaveBeenCalled();
    expect(window.UIHelpers.showStatus).toHaveBeenCalledWith("Загружаем следующее задание...");
    expect(window.UIHelpers.showStatus).toHaveBeenCalledWith("network", "error");
    expect(window.TaskRenderer.renderTask).not.toHaveBeenCalled();
  });

  it("bypasses beforeunload autopause when redirecting to iteration results", async () => {
    window.SessionAPI.nextTask = vi.fn().mockResolvedValue({
      status: 400,
      data: { ok: false, error: "iteration_finished" },
    });
    window.SessionAPI.getIterationResults = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        results: {
          iteration: 1,
          has_next_iteration: true,
        },
      },
    });

    const SessionControls = loadSessionControls();

    await SessionControls.handleNextTask();

    expect(window.SessionState.skipBeforeUnloadPrompt).toBe(true);
    expect(window.navigateWithTransition).toHaveBeenCalledWith(
      "/session/sess-1/iteration/1"
    );
  });
});
