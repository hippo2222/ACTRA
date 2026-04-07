/* @vitest-environment jsdom */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("SessionControls explicit pause", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="check-answer-btn" type="button"></button>`;
    window.SessionState = {
      sessionId: "sess-1",
      currentTask: {
        task_id: "task-1",
        task_ref: "module/topic/task-1",
        iteration: 1,
        queue: { index: 1, total: 3 },
        task_data: {
          type: "sequence_assembly",
        },
      },
      canGoNext: false,
      skipBeforeUnloadPrompt: false,
      paused: false,
      isLoading: false,
    };
    window.SessionAPI = {
      pauseSession: vi.fn().mockResolvedValue({
        status: 200,
        data: { ok: true, paused: true },
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
    };
    window.TaskRenderer = {
      renderTask: vi.fn(),
      getTaskSubtype: vi.fn(() => null),
      getRawTaskType: vi.fn(() => "sequence_assembly"),
      getCurrentEffectiveTaskType: vi.fn(() => "sequence_assembly"),
      showEvaluationResult: vi.fn(),
    };
    window.DraftStorage = {
      saveDraft: vi.fn(),
    };
    window.SessionRoutes = {
      COMPLEXES: "/ui/complexes",
      MAIN: "/ui/main",
      API: {
        PAUSE: vi.fn((sessionId) => `/api/session/${sessionId}/pause`),
      },
    };
    window.SessionFlow = {};
    window.SequenceUI = {
      getUserAnswerPayload: vi.fn(() => ({
        levels: [
          { level_id: "level_1", blocks: ["wolf_a"] },
          { level_id: "level_2", blocks: ["dog"] },
        ],
      })),
      getViewState: vi.fn(() => ({
        mode: "in_progress",
        selected_available_id: "dog",
        scroll_positions: {
          availableTop: 24,
          levelsTop: 48,
        },
      })),
    };
    window.navigateWithTransition = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("saves the current task payload before pausing and sends it to the server", async () => {
    const SessionControls = loadSessionControls();
    const payload = {
      levels: [
        { level_id: "level_1", blocks: ["wolf_a"] },
        { level_id: "level_2", blocks: ["dog"] },
      ],
    };

    await SessionControls.handlePauseConfirm();

    expect(window.DraftStorage.saveDraft).toHaveBeenCalledWith(
      "sess-1",
      "module/topic/task-1@1#iter1",
      payload
    );
    expect(window.SessionAPI.pauseSession).toHaveBeenCalledWith("sess-1", {
      task_ref: "module/topic/task-1",
      task_index: 1,
      user_input: payload,
      view_state: {
        mode: "in_progress",
        selected_available_id: "dog",
        scroll_positions: {
          availableTop: 24,
          levelsTop: 48,
        },
      },
    });
    expect(window.navigateWithTransition).toHaveBeenCalledWith("/ui/complexes");
    expect(window.SessionState.skipBeforeUnloadPrompt).toBe(true);
  });

  it("includes the restored evaluation result when pausing an already checked task", async () => {
    window.SessionState.currentTaskChecked = true;
    window.SessionState.currentEvaluationResult = {
      success: true,
      message: "Correct",
      details: { found_targets: [0], total_targets: 1 },
    };
    const SessionControls = loadSessionControls();
    const payload = {
      levels: [
        { level_id: "level_1", blocks: ["wolf_a"] },
        { level_id: "level_2", blocks: ["dog"] },
      ],
    };

    await SessionControls.handlePauseConfirm();

    expect(window.SessionAPI.pauseSession).toHaveBeenCalledWith("sess-1", {
      task_ref: "module/topic/task-1",
      task_index: 1,
      user_input: payload,
      view_state: {
        mode: "in_progress",
        selected_available_id: "dog",
        scroll_positions: {
          availableTop: 24,
          levelsTop: 48,
        },
      },
      evaluation_result: {
        success: true,
        message: "Correct",
        details: { found_targets: [0], total_targets: 1 },
      },
    });
  });

  it("keeps the check button disabled for a task restored in checked state", () => {
    window.SessionState.currentTaskChecked = true;
    const SessionControls = loadSessionControls();
    const checkBtn = document.getElementById("check-answer-btn");

    SessionControls.refreshCheckButtonState();

    expect(checkBtn.disabled).toBe(true);
    expect(checkBtn.getAttribute("title")).toBe("Задание уже проверено");
  });
});
