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

describe("SessionControls beforeunload guard", () => {
  beforeEach(() => {
    document.body.innerHTML = `<button id="check-answer-btn" type="button"></button>`;
    global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
    window.fetch = global.fetch;
    window.navigator.sendBeacon = vi.fn(() => true);
    window.SessionState = {
      sessionId: "sess-1",
      currentTask: {
        task_id: "task-1",
        task_ref: "module/topic/task-1",
        iteration: 1,
        queue: { index: 2, total: 5 },
      },
      canGoNext: false,
      skipBeforeUnloadPrompt: false,
      paused: false,
    };
    window.SessionAPI = {};
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
    window.DraftStorage = {
      saveDraft: vi.fn(),
    };
    window.SessionRoutes = {
      API: {
        PAUSE: vi.fn((sessionId) => `/api/session/${sessionId}/pause`),
      },
    };
    window.SessionFlow = {};
    window.OpenAnswerUI = {
      getUserAnswerPayload: vi.fn(() => ({ answer: "draft" })),
    };
  });

  it("autosaves and pauses silently, then stays silent during intentional navigation bypass", () => {
    const SessionControls = loadSessionControls();
    SessionControls.initBeforeUnloadGuard();

    const guardedEvent = new Event("beforeunload", { cancelable: true });
    guardedEvent.preventDefault = vi.fn();
    Object.defineProperty(guardedEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    window.dispatchEvent(guardedEvent);

    expect(window.DraftStorage.saveDraft).toHaveBeenCalledWith(
      "sess-1",
      "module/topic/task-1@2#iter1",
      { answer: "draft" }
    );
    expect(window.navigator.sendBeacon).toHaveBeenCalledTimes(1);
    expect(window.navigator.sendBeacon).toHaveBeenCalledWith(
      "/api/session/sess-1/pause",
      expect.anything()
    );
    expect(window.SessionState.paused).toBe(true);
    expect(guardedEvent.preventDefault).not.toHaveBeenCalled();
    expect(guardedEvent.returnValue).toBeUndefined();

    window.DraftStorage.saveDraft.mockClear();
    SessionControls.allowNavigationWithoutPrompt();

    const bypassedEvent = new Event("beforeunload", { cancelable: true });
    bypassedEvent.preventDefault = vi.fn();
    Object.defineProperty(bypassedEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    window.dispatchEvent(bypassedEvent);

    expect(window.DraftStorage.saveDraft).not.toHaveBeenCalled();
    expect(window.navigator.sendBeacon).toHaveBeenCalledTimes(1);
    expect(bypassedEvent.preventDefault).not.toHaveBeenCalled();
    expect(bypassedEvent.returnValue).toBeUndefined();
  });

  it("falls back to keepalive fetch when sendBeacon is unavailable", () => {
    window.navigator.sendBeacon = undefined;
    const SessionControls = loadSessionControls();
    SessionControls.initBeforeUnloadGuard();

    const guardedEvent = new Event("beforeunload", { cancelable: true });
    guardedEvent.preventDefault = vi.fn();
    Object.defineProperty(guardedEvent, "returnValue", {
      configurable: true,
      writable: true,
      value: undefined,
    });

    window.dispatchEvent(guardedEvent);

    expect(global.fetch).toHaveBeenCalledWith("/api/session/sess-1/pause", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_ref: "module/topic/task-1",
        task_index: 2,
        user_input: { answer: "draft" },
      }),
    });
    expect(window.SessionState.paused).toBe(true);
    expect(guardedEvent.preventDefault).not.toHaveBeenCalled();
    expect(guardedEvent.returnValue).toBeUndefined();
  });
});
