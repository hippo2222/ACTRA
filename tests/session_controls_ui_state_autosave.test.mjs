/* @vitest-environment jsdom */

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";

const scriptCode = fs.readFileSync(
  path.resolve(process.cwd(), "frontend/S1/session-controls.js"),
  "utf8"
);

let SessionControls;
let sessionStateRef;
let sessionApiRef;
let uiHelpersRef;
let taskRendererRef;
let draftStorageRef;
let sessionRoutesRef;
let sessionFlowRef;

describe("SessionControls UI-state autosave", () => {
  beforeAll(() => {
    sessionStateRef = {
      sessionId: "sess-1",
      currentTask: null,
      paused: false,
      isLoading: false,
      canGoNext: false,
      currentTaskChecked: false,
      currentEvaluationResult: null,
      skipBeforeUnloadPrompt: false,
    };
    sessionApiRef = {
      saveTaskUiState: vi.fn(),
      submitAnswer: vi.fn(),
    };
    uiHelpersRef = {
      showStatus: vi.fn(),
      showRetryOption: vi.fn(),
      showResumeModal: vi.fn(),
      hideResumeModal: vi.fn(),
      setPauseInFlight: vi.fn(),
      setCanGoNext: vi.fn(),
      setLoading: vi.fn(),
      showTaskSkeleton: vi.fn(),
      setButtonBusy: vi.fn(),
    };
    taskRendererRef = {
      renderTask: vi.fn(),
      getTaskSubtype: vi.fn(() => null),
      getRawTaskType: vi.fn(() => "sequence_assembly"),
      getCurrentEffectiveTaskType: vi.fn(() => "sequence_assembly"),
      showEvaluationResult: vi.fn(),
    };
    draftStorageRef = {
      saveDraft: vi.fn(),
      clearDraft: vi.fn(),
    };
    sessionRoutesRef = {
      MAIN: "/ui/main",
      COMPLEXES: "/ui/complexes",
      API: {
        PAUSE: vi.fn((sessionId) => `/api/session/${sessionId}/pause`),
        CANCEL: vi.fn((sessionId) => `/api/session/${sessionId}/cancel`),
      },
    };
    sessionFlowRef = {};

    window.SessionState = sessionStateRef;
    window.SessionAPI = sessionApiRef;
    window.UIHelpers = uiHelpersRef;
    window.TaskRenderer = taskRendererRef;
    window.DraftStorage = draftStorageRef;
    window.SessionRoutes = sessionRoutesRef;
    window.SessionFlow = sessionFlowRef;
    window.navigateWithTransition = vi.fn();
    window.NotificationUI = {
      confirm: vi.fn().mockResolvedValue(true),
    };
    window.SuccessEffects = {
      recordSuccess: vi.fn(),
      recordFailure: vi.fn(),
      playResultEffects: vi.fn(),
    };

    delete window.SessionControls;
    window.eval(scriptCode);
    SessionControls = window.SessionControls;
    SessionControls.initUiStateAutosave();
  });

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <header class="s1-toolbar">
        <div class="s1-toolbar-actions">
          <div class="s1-progress-cluster"></div>
          <div class="s1-toolbar-primary">
            <button id="check-answer-btn" type="button"><span class="truncate">Проверить</span></button>
          </div>
        </div>
      </header>
      <div id="task-content">
        <button id="task-surface-btn" type="button">surface</button>
        <textarea id="oa-input"></textarea>
      </div>
      <div id="result-box"></div>
      <button id="next-task-btn" type="button"></button>
      <button id="finish-complex-btn" type="button"></button>
      <button id="back-to-complexes-btn" type="button"></button>
      <button id="pause-confirm-submit" type="button"></button>
      <button id="pause-confirm-discard" type="button"></button>
      <button id="pause-confirm-continue" type="button"></button>
      <button id="resume-continue-btn" type="button"></button>
      <button id="resume-exit-btn" type="button"></button>
    `;

    Object.assign(sessionStateRef, {
      sessionId: "sess-1",
      currentTask: {
        task_id: "task-1",
        task_ref: "m1/t1/task-1",
        module_id: "m1",
        topic_id: "t1",
        iteration: 1,
        queue: { index: 0, total: 3 },
      },
      paused: false,
      isLoading: false,
      canGoNext: false,
      currentTaskChecked: false,
      currentEvaluationResult: null,
      skipBeforeUnloadPrompt: false,
    });

    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("sequence_assembly");
    taskRendererRef.getRawTaskType.mockReturnValue("sequence_assembly");
    taskRendererRef.getTaskSubtype.mockReturnValue(null);
    taskRendererRef.showEvaluationResult.mockReset();
    taskRendererRef.renderTask.mockReset();

    sessionApiRef.saveTaskUiState.mockReset();
    sessionApiRef.saveTaskUiState.mockResolvedValue({
      status: 200,
      data: { ok: true, saved: true },
    });
    sessionApiRef.submitAnswer.mockReset();

    draftStorageRef.saveDraft.mockReset();
    draftStorageRef.clearDraft.mockReset();
    uiHelpersRef.showStatus.mockReset();
    uiHelpersRef.showRetryOption.mockReset();
    uiHelpersRef.showResumeModal.mockReset();
    uiHelpersRef.hideResumeModal.mockReset();
    uiHelpersRef.setPauseInFlight.mockReset();
    uiHelpersRef.setCanGoNext.mockReset();
    uiHelpersRef.setLoading.mockReset();
    uiHelpersRef.showTaskSkeleton.mockReset();
    uiHelpersRef.setButtonBusy.mockReset();
    window.navigateWithTransition.mockReset();
    window.NotificationUI.confirm.mockReset();
    window.NotificationUI.confirm.mockResolvedValue(true);
    window.SuccessEffects.recordSuccess.mockReset();
    window.SuccessEffects.recordFailure.mockReset();
    window.SuccessEffects.playResultEffects.mockReset();

    window.SequenceUI = {
      getUserAnswerPayload: vi.fn(() => ({
        levels: [{ level_id: "level_1", blocks: ["wolf_a"] }],
      })),
      getViewState: vi.fn(() => ({
        mode: "in_progress",
        selected_available_id: "wolf_a",
        scroll_positions: { availableTop: 12, levelsTop: 34 },
      })),
      applyCheckFeedback: vi.fn(),
    };
    window.OpenAnswerUI = {
      getUserAnswerPayload: vi.fn(() => ({ answer: "draft answer" })),
      isAnswerValid: vi.fn(() => true),
      applyCheckFeedback: vi.fn(),
    };
    window.ClickUI = {
      getUserAnswerPayload: vi.fn(() => ({
        clicks: [{ x: 10, y: 10 }],
        labels_clicks: [""],
      })),
      applyCheckFeedback: vi.fn(),
    };
    window.DrawUI = {
      getUserAnswerPayload: vi.fn(() => ({
        polygons: [{ points: [[0, 0], [1, 1], [2, 2]] }],
        labels_polygons: [""],
      })),
      hasAnyDrawing: vi.fn(() => true),
      applyCheckFeedback: vi.fn(),
    };
    window.TestUI = {
      getUserAnswerPayload: vi.fn(() => ({
        type: "test",
        questions: [
          { id: "q1" },
          { id: "q2" },
        ],
        answers: { q1: 0 },
        text_answers: {},
      })),
      getAnswerProgress: vi.fn(() => ({
        totalQuestions: 2,
        answeredCount: 1,
        unansweredCount: 1,
        answeredQuestionIds: ["q1"],
        unansweredQuestionIds: ["q2"],
        allAnswered: false,
      })),
      setPendingUnansweredQuestionIds: vi.fn(),
      clearPendingUnansweredQuestionIds: vi.fn(),
      applyCheckFeedback: vi.fn(),
    };
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    delete window.SequenceUI;
    delete window.OpenAnswerUI;
    delete window.ClickUI;
    delete window.DrawUI;
    delete window.TestUI;
  });

  it("autosaves task ui-state with debounce and skips identical snapshots", async () => {
    document
      .getElementById("task-surface-btn")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await vi.advanceTimersByTimeAsync(1200);

    expect(sessionApiRef.saveTaskUiState).toHaveBeenCalledTimes(1);
    expect(sessionApiRef.saveTaskUiState).toHaveBeenCalledWith("sess-1", {
      task_ref: "m1/t1/task-1",
      task_index: 0,
      user_input: {
        levels: [{ level_id: "level_1", blocks: ["wolf_a"] }],
      },
      view_state: {
        mode: "in_progress",
        selected_available_id: "wolf_a",
        scroll_positions: { availableTop: 12, levelsTop: 34 },
      },
    });
    expect(draftStorageRef.saveDraft).toHaveBeenCalledWith(
      "sess-1",
      "m1/t1/task-1@0#iter1",
      { levels: [{ level_id: "level_1", blocks: ["wolf_a"] }] }
    );

    document
      .getElementById("task-surface-btn")
      .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1200);

    expect(sessionApiRef.saveTaskUiState).toHaveBeenCalledTimes(1);
  });

  it("flushes checked-state ui-state after successful submit", async () => {
    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("open_answer");
    taskRendererRef.getRawTaskType.mockReturnValue("open_answer");
    sessionStateRef.currentTask = {
      task_id: "task-open",
      task_ref: "m1/t1/task-open",
      module_id: "m1",
      topic_id: "t1",
      iteration: 1,
      queue: { index: 1, total: 3 },
    };
    sessionApiRef.submitAnswer.mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        result: {
          success: true,
          message: "Correct",
        },
      },
    });

    await SessionControls.handleSubmitAnswer();
    await Promise.resolve();

    expect(sessionApiRef.saveTaskUiState).toHaveBeenCalledWith("sess-1", {
      task_ref: "m1/t1/task-open",
      task_index: 1,
      user_input: { answer: "draft answer" },
      evaluation_result: {
        success: true,
        message: "Correct",
      },
    });
    expect(draftStorageRef.clearDraft).toHaveBeenCalledWith("sess-1", "m1/t1/task-open@1#iter1");
  });

  it("plays success effects for every supported task type across all difficulty levels", async () => {
    const cases = [
      {
        label: "open_answer",
        effectiveType: "open_answer",
        rawType: "open_answer",
        configure(difficulty) {
          window.OpenAnswerUI.getUserAnswerPayload.mockReturnValue({
            answer: `valid answer ${difficulty}`,
          });
          window.OpenAnswerUI.isAnswerValid.mockReturnValue(true);
        },
      },
      {
        label: "sequence_assembly",
        effectiveType: "sequence_assembly",
        rawType: "sequence_assembly",
        configure(difficulty) {
          const baseLevel = {
            level_id: `level_${difficulty}`,
            blocks: ["wolf_a"],
          };
          if (difficulty >= 2) {
            baseLevel.level_name = `Stage ${difficulty}`;
          }
          if (difficulty >= 3) {
            baseLevel.block_names = { wolf_a: "Wolf" };
          }
          window.SequenceUI.getUserAnswerPayload.mockReturnValue({
            levels: [baseLevel],
          });
        },
      },
      {
        label: "click",
        effectiveType: "click",
        rawType: "click",
        configure(difficulty) {
          window.ClickUI.getUserAnswerPayload.mockReturnValue({
            clicks: [{ x: 10, y: 10 }],
            labels_clicks: difficulty >= 2 ? ["Target"] : [],
          });
        },
      },
      {
        label: "draw_routed_via_click",
        effectiveType: "click",
        rawType: "draw",
        configure(difficulty) {
          window.ClickUI.getUserAnswerPayload.mockReturnValue({
            polygons: [{ points: [[0, 0], [1, 1], [2, 2]] }],
            labels_polygons: difficulty >= 2 ? ["Contour"] : [],
            lines: [],
            labels_lines: [],
          });
        },
      },
      {
        label: "draw",
        effectiveType: "draw",
        rawType: "draw",
        configure(difficulty) {
          window.DrawUI.getUserAnswerPayload.mockReturnValue({
            polygons: [{ points: [[0, 0], [1, 1], [2, 2]] }],
            labels_polygons: difficulty >= 2 ? ["Contour"] : [],
            lines: [],
            labels_lines: [],
          });
          window.DrawUI.hasAnyDrawing.mockReturnValue(true);
        },
      },
      {
        label: "test",
        effectiveType: "test",
        rawType: "test",
        configure() {
          window.TestUI.getUserAnswerPayload.mockReturnValue({
            type: "test",
            questions: [{ id: "q1" }, { id: "q2" }],
            answers: { q1: 0, q2: 1 },
            text_answers: {},
          });
          window.TestUI.getAnswerProgress.mockReturnValue({
            totalQuestions: 2,
            answeredCount: 2,
            unansweredCount: 0,
            answeredQuestionIds: ["q1", "q2"],
            unansweredQuestionIds: [],
            allAnswered: true,
          });
        },
      },
    ];

    for (const testCase of cases) {
      for (const difficulty of [1, 2, 3]) {
        sessionApiRef.submitAnswer.mockReset();
        sessionApiRef.submitAnswer.mockResolvedValue({
          status: 200,
          data: {
            ok: true,
            result: {
              success: true,
              message: `Correct ${testCase.label} d${difficulty}`,
            },
          },
        });
        window.SuccessEffects.recordSuccess.mockReset();
        window.SuccessEffects.recordFailure.mockReset();
        window.SuccessEffects.playResultEffects.mockReset();

        taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue(testCase.effectiveType);
        taskRendererRef.getRawTaskType.mockReturnValue(testCase.rawType);
        taskRendererRef.getTaskSubtype.mockReturnValue(null);
        sessionStateRef.currentTask = {
          task_id: `task-${testCase.label}-${difficulty}`,
          task_ref: `m1/t1/task-${testCase.label}-${difficulty}`,
          module_id: "m1",
          topic_id: "t1",
          difficulty,
          iteration: difficulty,
          queue: { index: 0, total: 1 },
          task_data: {
            type: testCase.rawType,
            difficulty,
            _difficulty_level: difficulty,
            content: {
              requires_labels: difficulty >= 2,
            },
          },
        };

        testCase.configure(difficulty);

        await SessionControls.handleSubmitAnswer();
        await Promise.resolve();

        expect(sessionApiRef.submitAnswer, `${testCase.label} difficulty ${difficulty}`).toHaveBeenCalledTimes(1);
        expect(window.SuccessEffects.recordSuccess, `${testCase.label} difficulty ${difficulty}`).toHaveBeenCalledTimes(1);
        expect(window.SuccessEffects.recordFailure, `${testCase.label} difficulty ${difficulty}`).not.toHaveBeenCalled();
        expect(window.SuccessEffects.playResultEffects, `${testCase.label} difficulty ${difficulty}`).toHaveBeenCalledWith(true);
      }
    }
  });

  it("arms a force-submit window on the first incomplete test click and reverts after 6 seconds", async () => {
    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("test");
    taskRendererRef.getRawTaskType.mockReturnValue("test");

    SessionControls.handleCheckAnswerClick(new MouseEvent("click", { bubbles: true }));

    expect(sessionApiRef.submitAnswer).not.toHaveBeenCalled();
    expect(uiHelpersRef.showStatus).toHaveBeenCalledWith(
      "Ответьте на все вопросы перед проверкой (1/2)"
    );
    expect(window.TestUI.setPendingUnansweredQuestionIds).toHaveBeenCalledWith(["q2"]);
    expect(document.getElementById("check-answer-btn")?.textContent).toContain("Всё равно проверить");
    expect(document.querySelector(".s1-toolbar")?.getAttribute("data-force-submit-active")).toBe("true");

    await vi.advanceTimersByTimeAsync(6000);

    expect(window.TestUI.clearPendingUnansweredQuestionIds).toHaveBeenCalled();
    expect(document.getElementById("check-answer-btn")?.textContent).toContain("Проверить");
    expect(document.querySelector(".s1-toolbar")?.hasAttribute("data-force-submit-active")).toBe(false);
  });

  it("submits an incomplete test on the second click while the force-submit window is active", async () => {
    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("test");
    taskRendererRef.getRawTaskType.mockReturnValue("test");
    sessionApiRef.submitAnswer.mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        result: {
          success: false,
          message: "Есть ошибки",
          details: {
            per_question: {
              q1: { status: "correct" },
              q2: { status: "unanswered" },
            },
          },
        },
      },
    });

    SessionControls.handleCheckAnswerClick(new MouseEvent("click", { bubbles: true }));
    SessionControls.handleCheckAnswerClick(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(sessionApiRef.submitAnswer).toHaveBeenCalledTimes(1);
    expect(sessionApiRef.submitAnswer).toHaveBeenCalledWith(
      "sess-1",
      "task-1",
      {
        questions: [{ id: "q1" }, { id: "q2" }],
        answers: { q1: 0 },
        text_answers: {},
      }
    );
    expect(document.getElementById("check-answer-btn")?.textContent).toContain("Проверить");
  });

  it("blocks click L2 submit when labels are missing and falls back to iteration as difficulty", async () => {
    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("click");
    taskRendererRef.getRawTaskType.mockReturnValue("click");
    taskRendererRef.getTaskSubtype.mockReturnValue(null);
    sessionStateRef.currentTask = {
      task_id: "task-click-l2",
      task_ref: "m1/t1/task-click-l2",
      module_id: "m1",
      topic_id: "t1",
      difficulty: 1,
      iteration: 2,
      queue: { index: 0, total: 1 },
      task_data: {
        type: "click",
        _difficulty_level: 1,
        content: {
          requires_labels: false,
        },
      },
    };

    await SessionControls.handleSubmitAnswer();

    expect(sessionApiRef.submitAnswer).not.toHaveBeenCalled();
    expect(uiHelpersRef.showStatus).toHaveBeenCalledWith(
      "Заполните названия для всех отметок перед проверкой",
      "error"
    );
  });

  it("blocks draw L2 submit when labels are missing and falls back to iteration as difficulty", async () => {
    taskRendererRef.getCurrentEffectiveTaskType.mockReturnValue("draw");
    taskRendererRef.getRawTaskType.mockReturnValue("draw");
    sessionStateRef.currentTask = {
      task_id: "task-draw-l2",
      task_ref: "m1/t1/task-draw-l2",
      module_id: "m1",
      topic_id: "t1",
      difficulty: 1,
      iteration: 2,
      queue: { index: 0, total: 1 },
      task_data: {
        type: "draw",
        _difficulty_level: 1,
        content: {
          requires_labels: false,
        },
      },
    };

    await SessionControls.handleSubmitAnswer();

    expect(sessionApiRef.submitAnswer).not.toHaveBeenCalled();
    expect(uiHelpersRef.showStatus).toHaveBeenCalledWith(
      "Заполните названия для всех отметок перед проверкой",
      "error"
    );
  });
});
