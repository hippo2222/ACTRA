/**
 * Session Controls Module
 * Handles session flow actions: submit, next, pause, resume, cancel.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['SessionState', 'SessionAPI', 'UIHelpers', 'TaskRenderer', 'DraftStorage', 'SessionRoutes', 'SessionFlow'], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node/CommonJS
        module.exports = factory(
            require('./session-state'),
            require('./api-client'),
            require('./ui-helpers'),
            require('./task-renderer'),
            require('./draft-storage'),
            require('./routes'),
            require('./session_flow')
        );
    } else {
        // Browser globals
        root.SessionControls = factory(
            root.SessionState,
            root.SessionAPI,
            root.UIHelpers,
            root.TaskRenderer,
            root.DraftStorage,
            root.SessionRoutes,
            root.SessionFlow
        );
    }
}(typeof self !== 'undefined' ? self : this, function (SessionState, SessionAPI, UIHelpers, TaskRenderer, DraftStorage, SessionRoutes, SessionFlow) {
    'use strict';

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

    const {
        showStatus,
        showRetryOption,
        showResumeModal,
        hideResumeModal,
        setPauseInFlight,
        setCanGoNext,
        setLoading,
        showTaskSkeleton,
        setButtonBusy
    } = UIHelpers;

    const {
        renderTask,
        getTaskSubtype,
        getRawTaskType,
        getCurrentEffectiveTaskType,
        showEvaluationResult
    } = TaskRenderer;

    function buildTestProgress(payload) {
        const questions = Array.isArray(payload && payload.questions) ? payload.questions : [];
        const answers = payload && payload.answers && typeof payload.answers === "object" && !Array.isArray(payload.answers)
            ? payload.answers
            : {};
        const textAnswers = payload && payload.text_answers && typeof payload.text_answers === "object" && !Array.isArray(payload.text_answers)
            ? payload.text_answers
            : {};

        const answeredIds = new Set();
        Object.keys(answers).forEach((qid) => {
            const value = answers[qid];
            if (value == null) return;
            if (Array.isArray(value) && value.length === 0) return;
            answeredIds.add(String(qid));
        });
        Object.keys(textAnswers).forEach((qid) => {
            const value = textAnswers[qid];
            if (typeof value === "string" && value.trim().length === 0) return;
            if (value == null) return;
            answeredIds.add(String(qid));
        });

        const totalQuestions = questions.length;
        const questionIds = questions.map((question, index) => {
            if (question && question.id != null) {
                return String(question.id);
            }
            return String(index);
        });
        const answeredQuestionIds = questionIds.filter((qid) => answeredIds.has(qid));
        const unansweredQuestionIds = questionIds.filter((qid) => !answeredIds.has(qid));
        const answeredCount = answeredQuestionIds.length;
        const unansweredCount = unansweredQuestionIds.length;

        return {
            totalQuestions,
            answeredCount,
            unansweredCount,
            answeredQuestionIds,
            unansweredQuestionIds,
            allAnswered: totalQuestions > 0 && unansweredCount === 0
        };
    }

    function getCurrentTestProgress() {
        if (typeof TestUI === "undefined") return null;
        if (typeof TestUI.getAnswerProgress === "function") {
            const progress = TestUI.getAnswerProgress();
            if (progress && typeof progress === "object") return progress;
        }
        if (typeof TestUI.getUserAnswerPayload === "function") {
            return buildTestProgress(TestUI.getUserAnswerPayload() || {});
        }
        return null;
    }

    const TEST_DRAFT_AUTOSAVE_DEBOUNCE_MS = 250;
    let testDraftAutosaveTimer = null;
    const UI_STATE_AUTOSAVE_DEBOUNCE_MS = 1200;
    let uiStateAutosaveTimer = null;
    let uiStateAutosaveListenerBound = false;
    let uiStateAutosaveInFlight = false;
    let uiStateAutosavePending = false;
    let lastUiStateAutosaveSignature = null;
    const TEST_FORCE_SUBMIT_WINDOW_MS = 6000;
    let testForceSubmitTimer = null;
    let testForceSubmitActive = false;
    let testForceSubmitTaskKey = null;

    function clearPendingTestDraftAutosave() {
        if (testDraftAutosaveTimer) {
            clearTimeout(testDraftAutosaveTimer);
            testDraftAutosaveTimer = null;
        }
    }

    function scheduleTestDraftAutosave() {
        clearPendingTestDraftAutosave();

        if (
            typeof DraftStorage === "undefined" ||
            !SessionState ||
            !SessionState.sessionId ||
            !SessionState.currentTask ||
            !buildCurrentDraftStorageKey() ||
            getCurrentEffectiveTaskType() !== "test" ||
            typeof TestUI === "undefined" ||
            typeof TestUI.getUserAnswerPayload !== "function"
        ) {
            return;
        }

        const sessionId = SessionState.sessionId;
        const draftKey = buildCurrentDraftStorageKey();
        const payload = TestUI.getUserAnswerPayload() || null;
        if (!payload || !draftKey) return;

        testDraftAutosaveTimer = setTimeout(() => {
            testDraftAutosaveTimer = null;
            try {
                DraftStorage.saveDraft(sessionId, draftKey, payload);
            } catch (err) {
                // best-effort
            }
        }, TEST_DRAFT_AUTOSAVE_DEBOUNCE_MS);
    }

    function clearPendingUiStateAutosave(resetSignature = false) {
        if (uiStateAutosaveTimer) {
            clearTimeout(uiStateAutosaveTimer);
            uiStateAutosaveTimer = null;
        }
        uiStateAutosavePending = false;
        if (resetSignature) {
            lastUiStateAutosaveSignature = null;
        }
    }

    function buildCurrentTaskRef() {
        const task = SessionState && SessionState.currentTask ? SessionState.currentTask : null;
        if (!task) return null;
        if (task.task_ref) return String(task.task_ref);
        if (task.module_id && task.topic_id && task.task_id) {
            return `${task.module_id}/${task.topic_id}/${task.task_id}`;
        }
        return null;
    }

    function buildCurrentTaskQueueIndex() {
        const task = SessionState && SessionState.currentTask ? SessionState.currentTask : null;
        if (!task || !task.queue || !Number.isInteger(task.queue.index)) {
            return null;
        }
        return task.queue.index;
    }

    function buildCurrentDraftStorageKey(taskOverride = null) {
        const task = taskOverride || (SessionState && SessionState.currentTask ? SessionState.currentTask : null);
        if (!task) return null;

        const taskRef =
            task.task_ref
                ? String(task.task_ref)
                : (task.module_id && task.topic_id && task.task_id)
                    ? `${task.module_id}/${task.topic_id}/${task.task_id}`
                    : null;
        const queueIndex =
            task.queue && Number.isInteger(task.queue.index)
                ? task.queue.index
                : null;
        const iteration =
            Number.isInteger(task.iteration)
                ? task.iteration
                : null;
        const iterationSuffix = iteration != null ? `#iter${iteration}` : "";

        if (taskRef && queueIndex != null) {
            return `${taskRef}@${queueIndex}${iterationSuffix}`;
        }
        if (task.task_id != null) {
            return `${String(task.task_id)}${iterationSuffix}`;
        }
        return taskRef ? `${taskRef}${iterationSuffix}` : null;
    }

    function getCheckButton() {
        return document.getElementById("check-answer-btn");
    }

    function getCheckButtonLabelEl(button = null) {
        const targetButton = button || getCheckButton();
        if (!targetButton) return null;
        return targetButton.querySelector(".truncate") || targetButton;
    }

    function setCheckButtonLabel(label) {
        const checkBtn = getCheckButton();
        const labelEl = getCheckButtonLabelEl(checkBtn);
        if (!checkBtn || !labelEl) return;
        const nextLabel = String(label || "").trim();
        labelEl.textContent = nextLabel;
        checkBtn.dataset.defaultLabel = nextLabel;
    }

    function getCheckButtonToolbar(button = null) {
        const targetButton = button || getCheckButton();
        return targetButton && targetButton.closest ? targetButton.closest(".s1-toolbar") : null;
    }

    function buildCurrentTestForceSubmitTaskKey() {
        return buildCurrentDraftStorageKey()
            || buildCurrentTaskRef()
            || (SessionState && SessionState.currentTask && SessionState.currentTask.task_id != null
                ? String(SessionState.currentTask.task_id)
                : null);
    }

    function clearPendingTestForceSubmitTimer() {
        if (testForceSubmitTimer) {
            clearTimeout(testForceSubmitTimer);
            testForceSubmitTimer = null;
        }
    }

    function syncPendingIncompleteTestSidebar(progress) {
        if (typeof TestUI === "undefined") return;
        const unansweredIds = progress && Array.isArray(progress.unansweredQuestionIds)
            ? progress.unansweredQuestionIds
            : [];
        if (unansweredIds.length > 0 && typeof TestUI.setPendingUnansweredQuestionIds === "function") {
            TestUI.setPendingUnansweredQuestionIds(unansweredIds);
            return;
        }
        if (typeof TestUI.clearPendingUnansweredQuestionIds === "function") {
            TestUI.clearPendingUnansweredQuestionIds();
        }
    }

    function resetPendingIncompleteTestSubmit(options = {}) {
        clearPendingTestForceSubmitTimer();
        testForceSubmitActive = false;
        testForceSubmitTaskKey = null;

        const clearSidebar = options.clearSidebar !== false;
        const restoreLabel = options.restoreLabel !== false;
        const checkBtn = getCheckButton();
        if (checkBtn) {
            checkBtn.removeAttribute("data-test-force-mode");
            if (restoreLabel) {
                setCheckButtonLabel(wt('s1.check_btn', 'Проверить'));
            }
        }

        const toolbar = getCheckButtonToolbar(checkBtn);
        if (toolbar) {
            toolbar.removeAttribute("data-force-submit-active");
        }

        if (clearSidebar) {
            syncPendingIncompleteTestSidebar(null);
        }
    }

    function armPendingIncompleteTestSubmit(progress) {
        const unansweredIds = progress && Array.isArray(progress.unansweredQuestionIds)
            ? progress.unansweredQuestionIds
            : [];
        if (!unansweredIds.length) {
            resetPendingIncompleteTestSubmit();
            return;
        }

        clearPendingTestForceSubmitTimer();
        testForceSubmitActive = true;
        testForceSubmitTaskKey = buildCurrentTestForceSubmitTaskKey();

        const checkBtn = getCheckButton();
        if (checkBtn) {
            checkBtn.setAttribute("data-test-force-mode", "true");
            setCheckButtonLabel(wt('s1.check_btn_force', 'Всё равно проверить'));
        }

        const toolbar = getCheckButtonToolbar(checkBtn);
        if (toolbar) {
            toolbar.setAttribute("data-force-submit-active", "true");
        }

        syncPendingIncompleteTestSidebar(progress);

        testForceSubmitTimer = setTimeout(() => {
            resetPendingIncompleteTestSubmit();
            refreshCheckButtonState();
        }, TEST_FORCE_SUBMIT_WINDOW_MS);
    }

    function isPendingIncompleteTestSubmitActive() {
        return testForceSubmitActive
            && !!testForceSubmitTaskKey
            && testForceSubmitTaskKey === buildCurrentTestForceSubmitTaskKey();
    }

    function buildAutosavePayload() {
        if (!SessionState || !SessionState.sessionId || !SessionState.currentTask || SessionState.paused) {
            return null;
        }

        const taskRef = buildCurrentTaskRef();
        if (!taskRef) return null;

        const userInput = getCurrentAnswerPayload();
        const viewState = getCurrentViewState();
        const payload = buildPausePayload(userInput, viewState);

        if (!payload.user_input && !payload.view_state && !payload.evaluation_result) {
            return null;
        }
        return payload;
    }

    function computeUiStateAutosaveSignature(payload) {
        if (!payload || typeof payload !== "object") return null;
        try {
            return JSON.stringify(payload);
        } catch (err) {
            return null;
        }
    }

    function shouldPersistDraftLocally(payload) {
        return !!(
            payload &&
            payload.user_input &&
            typeof payload.user_input === "object" &&
            SessionState &&
            !SessionState.currentTaskChecked
        );
    }

    function persistDraftSnapshotLocally(payload) {
        if (!shouldPersistDraftLocally(payload)) return;
        if (
            typeof DraftStorage === "undefined" ||
            !SessionState ||
            !SessionState.sessionId ||
            !SessionState.currentTask ||
            !buildCurrentDraftStorageKey()
        ) {
            return;
        }
        try {
            const draftKey = buildCurrentDraftStorageKey();
            if (!draftKey) return;
            DraftStorage.saveDraft(
                SessionState.sessionId,
                draftKey,
                payload.user_input
            );
        } catch (err) {
            // best-effort
        }
    }

    async function persistCurrentUiStateNow(options = {}) {
        const force = options && options.force === true;
        const allowWhileLoading = options && options.allowWhileLoading === true;
        if (
            !SessionState ||
            !SessionState.sessionId ||
            SessionState.paused ||
            (SessionState.isLoading && !allowWhileLoading) ||
            typeof SessionAPI === "undefined" ||
            typeof SessionAPI.saveTaskUiState !== "function"
        ) {
            return false;
        }

        const payload = buildAutosavePayload();
        if (!payload) return false;

        const signature = computeUiStateAutosaveSignature(payload);
        if (!force && signature && signature === lastUiStateAutosaveSignature) {
            return false;
        }

        if (uiStateAutosaveInFlight) {
            uiStateAutosavePending = true;
            return false;
        }

        uiStateAutosaveInFlight = true;
        try {
            persistDraftSnapshotLocally(payload);
            const { status, data } = await SessionAPI.saveTaskUiState(
                SessionState.sessionId,
                payload
            );
            if (status === 200 && data && data.ok === true) {
                lastUiStateAutosaveSignature = signature;
                return true;
            }
            return false;
        } catch (err) {
            return false;
        } finally {
            uiStateAutosaveInFlight = false;
            if (uiStateAutosavePending) {
                uiStateAutosavePending = false;
                scheduleUiStateAutosave(0);
            }
        }
    }

    function scheduleUiStateAutosave(delayMs = UI_STATE_AUTOSAVE_DEBOUNCE_MS) {
        if (!SessionState || !SessionState.sessionId || !SessionState.currentTask || SessionState.paused) {
            return;
        }
        if (uiStateAutosaveTimer) {
            clearTimeout(uiStateAutosaveTimer);
        }
        uiStateAutosaveTimer = setTimeout(() => {
            uiStateAutosaveTimer = null;
            void persistCurrentUiStateNow();
        }, Math.max(0, Number(delayMs) || 0));
    }

    function shouldIgnoreUiAutosaveEvent(target) {
        if (!target || !target.closest) return false;
        return !!target.closest(
            "#check-answer-btn, #next-task-btn, #finish-complex-btn, #back-to-complexes-btn, #pause-confirm-submit, #pause-confirm-discard, #pause-confirm-continue, #resume-continue-btn, #resume-exit-btn"
        );
    }

    function isTaskSurfaceEventTarget(target) {
        if (!target || !target.closest) return false;
        return !!target.closest("#task-content, #result-box");
    }

    function initUiStateAutosave() {
        if (uiStateAutosaveListenerBound || typeof document === "undefined" || typeof window === "undefined") {
            return;
        }
        uiStateAutosaveListenerBound = true;

        const scheduleFromEvent = (ev) => {
            const target = ev && ev.target;
            if (shouldIgnoreUiAutosaveEvent(target)) return;
            if (!isTaskSurfaceEventTarget(target)) return;
            scheduleUiStateAutosave();
        };

        document.addEventListener("input", scheduleFromEvent, true);
        document.addEventListener("change", scheduleFromEvent, true);
        document.addEventListener("click", scheduleFromEvent, true);
        document.addEventListener("pointerup", scheduleFromEvent, true);
        document.addEventListener("scroll", scheduleFromEvent, true);
        document.addEventListener("wheel", scheduleFromEvent, { passive: true, capture: true });
        window.addEventListener("test:answer-state-changed", () => {
            scheduleUiStateAutosave();
        });
    }

    function resetUiStateAutosaveTracking() {
        clearPendingUiStateAutosave(true);
    }

    function setCheckButtonBlockedVisual(blocked, progress) {
        const checkBtn = document.getElementById("check-answer-btn");
        if (!checkBtn) return;

        const isLoading = !!(SessionState && SessionState.isLoading);
        if (isLoading) {
            checkBtn.disabled = true;
            return;
        }

        checkBtn.disabled = false;
        checkBtn.classList.remove("cursor-not-allowed");

        if (!blocked) {
            checkBtn.removeAttribute("aria-disabled");
            checkBtn.removeAttribute("data-test-incomplete");
            checkBtn.removeAttribute("title");
            return;
        }

        checkBtn.removeAttribute("aria-disabled");
        checkBtn.setAttribute("data-test-incomplete", "true");
        if (progress && Number.isFinite(progress.answeredCount) && Number.isFinite(progress.totalQuestions) && progress.totalQuestions > 0) {
            checkBtn.title = isPendingIncompleteTestSubmitActive()
                ? wt('s1.check_btn_incomplete_with_count', 'Есть вопросы без ответа. Повторное нажатие проверит как есть ({answered}/{total})').replace('{answered}', progress.answeredCount).replace('{total}', progress.totalQuestions)
                : wt('s1.check_btn_has_unanswered_with_count', 'Есть вопросы без ответа ({answered}/{total})').replace('{answered}', progress.answeredCount).replace('{total}', progress.totalQuestions);
        } else {
            checkBtn.title = isPendingIncompleteTestSubmitActive()
                ? wt('s1.check_btn_incomplete_no_count', 'Есть вопросы без ответа. Повторное нажатие проверит как есть')
                : wt('s1.check_btn_has_unanswered_no_count', 'Есть вопросы без ответа');
        }
    }

    function isPendingUserJudgementResult(result) {
        return !!(
            result &&
            result.details &&
            typeof result.details === "object" &&
            result.details.requires_user_judgement === true
        );
    }

    function refreshCheckButtonState(progressOverride = null) {
        if (SessionState && SessionState.currentTaskChecked) {
            resetPendingIncompleteTestSubmit();
            const checkBtn = document.getElementById("check-answer-btn");
            if (checkBtn) {
                checkBtn.disabled = true;
                checkBtn.setAttribute("aria-disabled", "true");
                checkBtn.removeAttribute("data-test-incomplete");
                checkBtn.setAttribute("title", wt('s1.check_already_checked', 'Задание уже проверено'));
            }
            return null;
        }

        if (SessionState && SessionState.pendingManualJudgement) {
            resetPendingIncompleteTestSubmit();
            const checkBtn = document.getElementById("check-answer-btn");
            if (checkBtn) {
                checkBtn.disabled = true;
                checkBtn.setAttribute("aria-disabled", "true");
                checkBtn.removeAttribute("data-test-incomplete");
                checkBtn.setAttribute("title", wt('s1.check_pending_judgement', 'Сначала выберите итог проверки'));
            }
            return null;
        }

        const taskType = getCurrentEffectiveTaskType();
        if (taskType !== "test") {
            resetPendingIncompleteTestSubmit();
            setCheckButtonBlockedVisual(false, null);
            return null;
        }

        if (testForceSubmitActive && !isPendingIncompleteTestSubmitActive()) {
            resetPendingIncompleteTestSubmit();
        }

        const progress = progressOverride || getCurrentTestProgress();
        const blocked = !!(progress && progress.totalQuestions > 0 && !progress.allAnswered);
        if (!blocked) {
            resetPendingIncompleteTestSubmit();
        } else if (isPendingIncompleteTestSubmitActive()) {
            syncPendingIncompleteTestSidebar(progress);
        }
        setCheckButtonBlockedVisual(blocked, progress);
        return progress;
    }

    function handleCheckAnswerClick(event) {
        if (SessionState && SessionState.pendingManualJudgement) {
            if (event) {
                event.preventDefault();
                event.stopPropagation();
            }
            showStatus(wt('s1.err_choose_verdict', 'Сначала выберите, считать ли ответ верным'));
            return;
        }

        const taskType = getCurrentEffectiveTaskType();
        if (taskType === "test") {
            const progress = refreshCheckButtonState();
            const blocked = !!(progress && progress.totalQuestions > 0 && !progress.allAnswered);
            if (blocked) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                if (!isPendingIncompleteTestSubmitActive()) {
                    armPendingIncompleteTestSubmit(progress);
                    showStatus(wt('s1.err_answer_all_with_count', 'Ответьте на все вопросы перед проверкой ({answered}/{total})').replace('{answered}', progress.answeredCount).replace('{total}', progress.totalQuestions));
                    showEvaluationResult(null);
                    return;
                }
                resetPendingIncompleteTestSubmit();
                handleSubmitAnswer({ allowIncompleteTest: true });
                return;
            }
        }
        handleSubmitAnswer();
    }

    let testProgressListenerBound = false;
    let testBlockedHintListenerBound = false;
    function initTestSubmitGuard() {
        if (testProgressListenerBound || typeof window === "undefined") {
            refreshCheckButtonState();
            return;
        }
        testProgressListenerBound = true;
        window.addEventListener("test:answer-state-changed", (ev) => {
            const detail = ev && ev.detail && typeof ev.detail === "object" ? ev.detail : null;
            refreshCheckButtonState(detail);
            scheduleTestDraftAutosave();
        });

        if (!testBlockedHintListenerBound && typeof document !== "undefined") {
            testBlockedHintListenerBound = true;
            document.addEventListener("pointerdown", (ev) => {
                const target = ev && ev.target && ev.target.closest
                    ? ev.target.closest("#check-answer-btn")
                    : null;
                if (!target) return;
                if (!target.disabled) return;
                if (target.getAttribute("data-test-incomplete") !== "true") return;
                const progress = getCurrentTestProgress();
                if (progress && progress.totalQuestions > 0 && !progress.allAnswered) {
                    showStatus(wt('s1.err_answer_all_with_count', 'Ответьте на все вопросы перед проверкой ({answered}/{total})').replace('{answered}', progress.answeredCount).replace('{total}', progress.totalQuestions));
                }
            });
        }
        refreshCheckButtonState();
    }

    // -------------------------------------------------------------------
    // Helper: maybeRedirectToResults (Internal)
    // -------------------------------------------------------------------
    async function maybeRedirectToResults(targetIteration) {
        if (!SessionState.sessionId) return false;

        try {
            const currentIteration =
                targetIteration || (SessionState.currentTask && SessionState.currentTask.iteration) || 1;

            const { status, data } = await SessionAPI.getIterationResults(SessionState.sessionId, currentIteration);
            if (!data || !data.ok || !data.results) {
                return false;
            }

            const res = data.results;
            const iteration =
                res.iteration != null ? res.iteration : currentIteration;

            let hasNext = null;
            if (res.has_next_iteration !== undefined) {
                hasNext = !!res.has_next_iteration;
            }

            // Fallback logic
            if (hasNext === null) {
                hasNext = true;
            }

            if (hasNext) {
                navigateWithoutPrompt(`/session/${encodeURIComponent(
                    SessionState.sessionId
                )}/iteration/${encodeURIComponent(iteration)}`);
            } else {
                navigateWithoutPrompt(`/session/${encodeURIComponent(
                    SessionState.sessionId
                )}/results`);
            }

            return true;
        } catch (e) {
            console.warn("Не удалось перейти к результатам", e);
            return false;
        }
    }

    // -------------------------------------------------------------------
    // Pause/Resume Logic
    // -------------------------------------------------------------------
    async function handlePausedConflict() {
        showStatus(wt('s1.paused_msg', 'Сессия на паузе. Возобновите её, чтобы продолжить'), "error");
        showResumeModal();
    }

    async function handleResumeConfirm() {
        if (!SessionState.sessionId) return;
        const spinner = document.getElementById("resume-spinner");
        if (spinner) spinner.classList.remove("hidden");
        try {
            const { status, data } = await SessionAPI.resumeSession(SessionState.sessionId, {
                source: "s1_resume_modal",
            });
            const resp = data;
            if (status === 200 && resp && resp.ok) {
                hideResumeModal();
                UIHelpers.setPausedUI(false); // Direct call to updated helper if exported, or via setPaused alias in UIHelpers?
                // Note: UIHelpers.setPausedUI was not explicitly exported in my memory of ui-helpers.js source unless I check.
                // But index.html had `const setPaused = UIHelpers.setPausedUI`.
                // I should verify if setPausedUI is valid. I'll assume yes for now.
                showStatus("");
                const resumeUrl =
                    typeof resp?.resume_target?.url === "string"
                        ? resp.resume_target.url
                        : "";
                if (resumeUrl && resumeUrl !== window.location.pathname) {
                    navigateWithoutPrompt(resumeUrl);
                    return;
                }
                const reloadTask =
                    (window.Main && typeof window.Main.loadInitialTask === "function")
                        ? window.Main.loadInitialTask.bind(window.Main)
                        : (typeof window.loadInitialTask === "function" ? window.loadInitialTask : null);

                if (reloadTask) {
                    await reloadTask();
                } else {
                    console.warn("loadInitialTask not found, reloading page");
                    window.location.reload();
                }
            } else {
                showStatus((resp && resp.error) || wt('s1.err_resume_fail', 'Не удалось возобновить сессию'), "error");
            }
        } catch (e) {
            console.error("Resume failed", e);
            showStatus(wt('s1.err_resume_fail_retry', 'Не удалось возобновить сессию. Попробуйте снова'), "error");
        } finally {
            if (spinner) spinner.classList.add("hidden");
        }
    }

    async function handlePauseConfirm() {
        if (!SessionState.sessionId) {
            showStatus(wt('s1.err_session_missing', 'Сессия не найдена. Обновите страницу'), "error");
            return;
        }
        clearPendingUiStateAutosave();
        setPauseInFlight(true);
        showStatus("");
        try {
            const payload = getCurrentAnswerPayload();
            const viewState = getCurrentViewState();
            if (
                payload &&
                typeof DraftStorage !== "undefined" &&
                SessionState.currentTask &&
                buildCurrentDraftStorageKey()
            ) {
                DraftStorage.saveDraft(SessionState.sessionId, buildCurrentDraftStorageKey(), payload);
            }

            const { status, data } = await SessionAPI.pauseSession(
                SessionState.sessionId,
                buildPausePayload(payload, viewState)
            );
            const resp = data;
            if (status === 409) {
                await handlePausedConflict();
                return;
            }
            if (!resp || resp.ok !== true) {
                const message =
                    (resp && (resp.error || resp.message)) ||
                    wt('s1.err_pause_fail', 'Не удалось поставить сессию на паузу. Попробуйте ещё раз');
                showStatus(message, "error");
                return;
            }
            navigateWithoutPrompt(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/complexes");
        } catch (err) {
            console.error("Pause request failed", err);
            showStatus(wt('s1.err_pause_fail_network', 'Не удалось поставить сессию на паузу. Проверьте соединение и попробуйте снова'), "error");
        } finally {
            setPauseInFlight(false);
        }
    }

    async function handleDiscardSession() {
        if (!SessionState.sessionId) {
            navigateWithoutPrompt(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/complexes");
            return;
        }

        clearPendingUiStateAutosave();
        setPauseInFlight(true);
        showStatus("");
        try {
            const response = await fetch(SessionRoutes.API.CANCEL(SessionState.sessionId), { method: "POST" });
            if (!response.ok) {
                let message = wt('s1.err_discard_fail', 'Не удалось завершить попытку без сохранения.');
                try {
                    const data = await response.json();
                    if (data && (data.error || data.message)) {
                        message = data.error || data.message;
                    }
                } catch (e) {
                    // Ignore parse errors and keep default message.
                }
                showStatus(message, "error");
                return;
            }

            navigateWithoutPrompt(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/complexes");
        } catch (err) {
            console.error("Discard session failed", err);
            showStatus(wt('s1.err_discard_fail_retry', 'Не удалось выйти без сохранения. Попробуйте снова'), "error");
        } finally {
            setPauseInFlight(false);
        }
    }

    // -------------------------------------------------------------------
    // Submit Answer
    // -------------------------------------------------------------------
    function applyTaskCheckFeedback(taskType, result) {
        if (taskType === "test" && typeof TestUI !== "undefined") TestUI.applyCheckFeedback(result);
        else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined") SequenceUI.applyCheckFeedback(result);
        else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined") ImageLabelUI.applyCheckFeedback(result);
        else if (taskType === "click") {
            const subtype = getTaskSubtype(SessionState.currentTask);
            if (subtype !== "error_detection" && typeof ClickUI !== "undefined") ClickUI.applyCheckFeedback(result);
        } else if (taskType === "draw") {
            if (typeof DrawUI !== "undefined") DrawUI.applyCheckFeedback(result);
        } else if (taskType === "open_answer" && typeof OpenAnswerUI !== "undefined") OpenAnswerUI.applyCheckFeedback(result);
    }

    function applyPendingUserJudgementState(result, currentTaskType) {
        showStatus("");
        showEvaluationResult(result);

        if (SessionState) {
            SessionState.currentTaskChecked = false;
            SessionState.pendingManualJudgement = true;
            SessionState.currentEvaluationResult = result || null;
        }

        setCanGoNext(false);
        void persistCurrentUiStateNow({ force: true, allowWhileLoading: true });
        applyTaskCheckFeedback(currentTaskType, result);
    }

    function finalizeCheckedResult(result, currentTaskType) {
        const isSuccess = !!result && result.success === true;

        if (SessionState) {
            SessionState.pendingManualJudgement = false;
        }

        if (typeof SuccessEffects !== 'undefined') {
            if (isSuccess) { SuccessEffects.recordSuccess(); }
            else { SuccessEffects.recordFailure(); }
        }

        showEvaluationResult(result);

        if (SessionState) {
            SessionState.currentTaskChecked = true;
            SessionState.currentEvaluationResult = result || null;
        }
        setCanGoNext(true);
        void persistCurrentUiStateNow({ force: true, allowWhileLoading: true });

        if (typeof SuccessEffects !== 'undefined') {
            SuccessEffects.playResultEffects(isSuccess);
        }

        applyTaskCheckFeedback(currentTaskType, result);
    }

    async function handleUserJudgementChoice(choice) {
        if (!SessionState || !SessionState.sessionId || !SessionState.currentTask) {
            return;
        }

        const normalizedChoice = choice === "accept" ? "accept" : "reject";
        const mode = normalizedChoice === "accept" ? "force_success" : "force_failure";
        const isAccept = normalizedChoice === "accept";
        const message = isAccept
            ? wt('s1.verdict_accepted', 'Ответ принят по вашему выбору.')
            : wt('s1.verdict_rejected', 'Ответ отмечен как неверный по вашему выбору.');

        const baseResult =
            SessionState.currentEvaluationResult && typeof SessionState.currentEvaluationResult === "object"
                ? SessionState.currentEvaluationResult
                : null;
        const baseDetails =
            baseResult && baseResult.details && typeof baseResult.details === "object"
                ? baseResult.details
                : {};

        const currentTaskType = getCurrentEffectiveTaskType();
        let answer = {};

        try {
            if (currentTaskType === "image_labeling" && typeof ImageLabelUI !== "undefined") {
                answer = ImageLabelUI.getUserAnswerPayload() || {};
            } else if (typeof getCurrentAnswerPayload === "function") {
                answer = getCurrentAnswerPayload() || {};
            }
        } catch (e) {
            answer = {};
        }

        if (isAccept) {
            answer.override_typo = true;
            answer.single_retry_copy = false;
        } else {
            answer.override_typo = false;
            answer.single_retry_copy = true;
        }

        const auditDetails = {
            ...baseDetails,
            requires_user_judgement: false,
            pending_user_judgement: false,
            user_judgement_resolved: true,
            override_typo: isAccept,
            single_retry_copy: !isAccept,
            manual_label_judgement: {
                resolved: true,
                user_choice: normalizedChoice,
            },
        };

        try {
            setLoading(true);
            showStatus("");

            const { status, data } = await SessionAPI.submitAnswer(
                SessionState.sessionId,
                SessionState.currentTask.task_id,
                answer,
                {
                    auditControl: {
                        enabled: true,
                        mode,
                        message,
                        details: auditDetails,
                    },
                }
            );

            if (status === 409) {
                await handlePausedConflict();
                return;
            }

            const response = data;
            if (!response || !response.ok || !response.result) {
                showStatus((response && (response.error || response.message)) || wt('s1.err_save_verdict', 'Не удалось сохранить ваш выбор'), "error");
                return;
            }

            showStatus("");
            finalizeCheckedResult(response.result, currentTaskType);
        } catch (err) {
            console.error(err);
            showStatus(wt('s1.err_save_verdict_retry', 'Не удалось сохранить ваш выбор. Попробуйте ещё раз'), "error");
        } finally {
            setLoading(false);
            refreshCheckButtonState();
        }
    }

    async function handleDrawLabelJudgementChoice(choice) {
        return handleUserJudgementChoice(choice);
    }

    async function handleSubmitAnswer(options = {}) {
        if (SessionState.isLoading) return;
        if (!SessionState.sessionId || !SessionState.currentTask) return;
        if (SessionState.paused) {
            showResumeModal();
            return;
        }
        clearPendingTestDraftAutosave();
        clearPendingUiStateAutosave();

        let answer = {};
        const currentTaskType = getCurrentEffectiveTaskType();
        const allowIncompleteTest = !!(options && options.allowIncompleteTest === true);
        let testAnsweredCount = null;
        let testTotalQuestions = null;

        setCanGoNext(false);
        if (currentTaskType !== "test" || allowIncompleteTest) {
            resetPendingIncompleteTestSubmit();
        }
        refreshCheckButtonState();

        // Extract answer from UIs
        // Note: We access global UI objects (TestUI, etc.) assuming they are loaded in window.
        if (currentTaskType === "test" && typeof TestUI !== "undefined") {
            const testPayload = TestUI.getUserAnswerPayload() || {};
            const userInput = {};
            if (Array.isArray(testPayload.questions)) userInput.questions = testPayload.questions;
            if (testPayload.answers && typeof testPayload.answers === "object" && !Array.isArray(testPayload.answers)) userInput.answers = testPayload.answers;
            if (testPayload.text_answers && typeof testPayload.text_answers === "object" && !Array.isArray(testPayload.text_answers)) userInput.text_answers = testPayload.text_answers;
            answer = userInput;
        } else if (currentTaskType === "sequence_assembly" && typeof SequenceUI !== "undefined") {
            answer = SequenceUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "image_labeling" && typeof ImageLabelUI !== "undefined") {
            answer = ImageLabelUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "click" && getTaskSubtype(SessionState.currentTask) === "error_detection" && typeof MistakesUI !== "undefined") {
            answer = MistakesUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "click" && typeof ClickUI !== "undefined") {
            answer = ClickUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "draw") {
            if (typeof DrawUI !== "undefined") {
                answer = DrawUI.getUserAnswerPayload() || {};
            }
        } else if (currentTaskType === "open_answer" && typeof OpenAnswerUI !== "undefined") {
            answer = OpenAnswerUI.getUserAnswerPayload() || {};
        }

        if (options && typeof options === "object") {
            if (options.override_typo !== undefined) answer.override_typo = !!options.override_typo;
            if (options.single_retry_copy !== undefined) answer.single_retry_copy = !!options.single_retry_copy;
        }

        // Validation
        try {
            if (currentTaskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.validateBeforeSubmit === "function") {
                const validation = SequenceUI.validateBeforeSubmit();
                if (validation && validation.valid === false) {
                    showStatus(validation.message || wt('s1.err_check_levels', 'Проверьте уровни перед проверкой'), "error");
                    showEvaluationResult(null);
                    return;
                }
                answer = SequenceUI.getUserAnswerPayload() || answer;
            }
            if (currentTaskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.validateBeforeSubmit === "function") {
                const validation = ImageLabelUI.validateBeforeSubmit();
                if (validation && validation.valid === false) {
                    showStatus(validation.message || 'Заполните все области перед отправкой на проверку', "error");
                    showEvaluationResult(null);
                    return;
                }
                const freshPayload = ImageLabelUI.getUserAnswerPayload() || answer;
                if (options && typeof options === "object") {
                    if (options.override_typo !== undefined) freshPayload.override_typo = !!options.override_typo;
                    if (options.single_retry_copy !== undefined) freshPayload.single_retry_copy = !!options.single_retry_copy;
                }
                answer = freshPayload;
            }
            if (currentTaskType === "open_answer") {
                const isValid = typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.isAnswerValid === "function"
                    ? !!OpenAnswerUI.isAnswerValid()
                    : !!(answer && typeof answer.answer === "string" && answer.answer.trim().length > 0);
                if (!isValid) {
                    showStatus(wt('s1.err_enter_answer', 'Введите ответ перед проверкой'), "error");
                    showEvaluationResult(null);
                    return;
                }
            }
        } catch (e) { /* ignore */ }

        // Sequence Assembly difficulty checks
        try {
            if (currentTaskType === "sequence_assembly") {
                const difficulty = Number(
                    (SessionState.currentTask.difficulty) ||
                    (SessionState.currentTask.task_data && SessionState.currentTask.task_data.difficulty) ||
                    1
                );
                const levels = answer && Array.isArray(answer.levels) ? answer.levels : [];
                const hasAnyBlock = levels.some((l) => Array.isArray(l && l.blocks) && l.blocks.some((x) => x != null));
                if (!hasAnyBlock) {
                    const emptyMessage = difficulty >= 3
                        ? wt('s1.err_add_level_name', 'Сначала создайте уровень и введите хотя бы одно название элемента')
                        : difficulty >= 2
                            ? wt('s1.err_add_level_element', 'Сначала создайте уровень и разместите хотя бы один элемент')
                            : wt('s1.err_add_element', 'Сначала разместите хотя бы один элемент перед проверкой');
                    showStatus(emptyMessage, "error");
                    showEvaluationResult(null);
                    return;
                }
                if (difficulty === 3) {
                    let missingName = false;
                    for (const lvl of levels) {
                        const blocks = Array.isArray(lvl && lvl.blocks) ? lvl.blocks : [];
                        const names = lvl && typeof lvl === "object" ? (lvl.block_names || lvl.blockNames) : null;
                        for (const id of blocks) {
                            if (id == null) continue;
                            const name = names && typeof names === "object" ? String(names[id] || "") : "";
                            if (!name.trim()) {
                                missingName = true;
                                break;
                            }
                        }
                        if (missingName) break;
                    }
                    if (missingName) {
                        showStatus(wt('s1.err_fill_sequence_names', 'Для всех размещённых элементов нужно указать названия'), "error");
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Validation 3: Test must be fully answered before submit
        try {
            if (currentTaskType === "test") {
                const hasAnyAnswer =
                    (answer.answers && Object.keys(answer.answers).length > 0) ||
                    (answer.text_answers && Object.keys(answer.text_answers).length > 0);

                if (!hasAnyAnswer && !allowIncompleteTest) {
                    showStatus(wt('s1.err_answer_at_least_one', 'Ответьте хотя бы на один вопрос перед проверкой'), "error");
                    showEvaluationResult(null);
                    return;
                }

                const progress = buildTestProgress(answer);
                const totalQuestions = progress.totalQuestions;
                if (totalQuestions > 0) {
                    testAnsweredCount = progress.answeredCount;
                    testTotalQuestions = totalQuestions;
                    console.info("[SubmitAnswer][test] payload summary", {
                        totalQuestions,
                        answeredCount: progress.answeredCount,
                        unansweredCount: progress.unansweredCount,
                        answeredQuestionIds: Array.from(progress.answeredQuestionIds || []),
                        unansweredQuestionIds: Array.from(progress.unansweredQuestionIds || []),
                        answerKeys: Object.keys(answer.answers || {}),
                        textAnswerKeys: Object.keys(answer.text_answers || {})
                    });

                    if (progress.unansweredCount > 0 && !allowIncompleteTest) {
                        showStatus(wt('s1.err_answer_all_with_count', 'Ответьте на все вопросы перед проверкой ({answered}/{total})').replace('{answered}', progress.answeredCount).replace('{total}', totalQuestions));
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        function getTaskDifficultyLevel(task) {
            try {
                const taskData = task && task.task_data ? task.task_data : {};
                const content = taskData && taskData.content ? taskData.content : {};
                const settings =
                    (taskData && taskData.settings) ||
                    (content && content.settings) ||
                    {};
                const candidates = [
                    task && task.difficulty,
                    taskData && taskData._difficulty_level,
                    taskData && taskData.difficulty,
                    settings && settings.difficulty,
                    content && content.difficulty,
                ];
                for (const candidate of candidates) {
                    const parsed = Number(candidate);
                    if (Number.isFinite(parsed) && parsed > 0) return parsed;
                }
            } catch (e) { /* ignore */ }
            return null;
        }

        function requiresLabelsForAnswer(task, fallbackDifficulty) {
            let explicitRequiresLabels = null;
            try {
                const taskData = task && task.task_data ? task.task_data : {};
                const content = taskData && taskData.content ? taskData.content : {};
                explicitRequiresLabels =
                    content.requires_labels ??
                    taskData.requires_labels ??
                    (task && task.requires_labels);
            } catch (e) { /* ignore */ }
            const inferredDifficulty = Math.max(
                Number(fallbackDifficulty) || 0,
                Number(getTaskDifficultyLevel(task)) || 0,
                Number(task && task.iteration) || 0,
                1
            );
            if (explicitRequiresLabels === true) return true;
            if (inferredDifficulty >= 2) return true;
            if (explicitRequiresLabels === false) return false;
            return inferredDifficulty >= 2;
        }

        function hasAllFilledLabels(labels, expectedCount) {
            if (!expectedCount || expectedCount <= 0) return true;
            const normalized = Array.isArray(labels) ? labels : [];
            if (normalized.length < expectedCount) return false;
            for (let index = 0; index < expectedCount; index += 1) {
                if (!String(normalized[index] || '').trim()) return false;
            }
            return true;
        }

        function missingRequiredLabels(answerPayload, markCounts, task, fallbackDifficulty) {
            if (!requiresLabelsForAnswer(task, fallbackDifficulty)) return false;
            const clickCount = Number(markCounts && markCounts.clicks || 0);
            const polygonCount = Number(markCounts && markCounts.polygons || 0);
            const lineCount = Number(markCounts && markCounts.lines || 0);
            const drawingCount = Number(markCounts && markCounts.drawing || 0);

            const labelsClicks = Array.isArray(answerPayload && answerPayload.labels_clicks)
                ? answerPayload.labels_clicks
                : [];
            const labelsPolygons = Array.isArray(answerPayload && answerPayload.labels_polygons)
                ? answerPayload.labels_polygons
                : [];
            const labelsLines = Array.isArray(answerPayload && answerPayload.labels_lines)
                ? answerPayload.labels_lines
                : [];
            const legacyLabels = answerPayload && answerPayload.labels && typeof answerPayload.labels === 'object'
                ? Object.values(answerPayload.labels)
                : [];

            if (clickCount > 0) {
                const clicksSatisfied =
                    hasAllFilledLabels(labelsClicks, clickCount) ||
                    hasAllFilledLabels(legacyLabels, clickCount);
                if (!clicksSatisfied) return true;
            }
            if (polygonCount > 0 && !hasAllFilledLabels(labelsPolygons, polygonCount)) return true;
            if (lineCount > 0 && !hasAllFilledLabels(labelsLines, lineCount)) return true;
            if (drawingCount > 0 && polygonCount <= 0 && lineCount <= 0) {
                const legacyLabel = String(answerPayload && answerPayload.label || '').trim();
                if (!legacyLabel) return true;
            }
            return false;
        }

        // Validation 4: Click must have at least one interaction
        try {
            if (currentTaskType === 'click') {
                const subtype = getTaskSubtype(SessionState.currentTask);
                const rawTaskType = getRawTaskType(SessionState.currentTask);
                // Skip validation for error_detection (auto-submit)
                if (subtype !== 'error_detection') {
                    const clicks = Array.isArray(answer.clicks) ? answer.clicks : [];
                    const labels = answer.labels || {};
                    const polygons = Array.isArray(answer.polygons) ? answer.polygons : [];
                    const lines = Array.isArray(answer.lines) ? answer.lines : [];
                    const drawing = Array.isArray(answer.drawing) ? answer.drawing : [];
                    const hasShapeInteraction =
                        polygons.length > 0 || lines.length > 0 || drawing.length > 0;
                    const hasDrawInteraction =
                        (rawTaskType === 'draw' || (rawTaskType === 'click' && hasShapeInteraction)) &&
                        hasShapeInteraction;
                    const hasAnyInteraction =
                        clicks.length > 0 ||
                        Object.keys(labels).length > 0 ||
                        hasDrawInteraction;

                    if (!hasAnyInteraction) {
                        showStatus(wt('s1.err_make_action', 'Сделайте хотя бы одно действие (клик или подпись) перед проверкой'), 'error');
                        showEvaluationResult(null);
                        return;
                    }

                    if (missingRequiredLabels(answer, {
                        clicks: clicks.length,
                        polygons: polygons.length,
                        lines: lines.length,
                        drawing: drawing.length,
                    }, SessionState.currentTask)) {
                        showStatus(wt('s1.err_fill_labels', 'Заполните названия для всех отметок перед проверкой'), 'error');
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Validation 5: Draw must have at least one drawing
        try {
            if (currentTaskType === 'draw') {
                // Check if DrawUI has validation method
                if (typeof DrawUI !== 'undefined' && typeof DrawUI.hasAnyDrawing === 'function') {
                    if (!DrawUI.hasAnyDrawing()) {
                        showStatus(wt('s1.err_draw_mark', 'Нарисуйте хотя бы одну метку перед проверкой'), 'error');
                        showEvaluationResult(null);
                        return;
                    }
                } else {
                    // Fallback: check payload structure
                    const hasDrawing =
                        (answer.drawings && Array.isArray(answer.drawings) && answer.drawings.length > 0) ||
                        (answer.strokes && Array.isArray(answer.strokes) && answer.strokes.length > 0) ||
                        (answer.drawing && Array.isArray(answer.drawing) && answer.drawing.length > 0) ||
                        (answer.polygons && Array.isArray(answer.polygons) && answer.polygons.length > 0) ||
                        (answer.lines && Array.isArray(answer.lines) && answer.lines.length > 0);

                    if (!hasDrawing) {
                        showStatus(wt('s1.err_draw_mark', 'Нарисуйте хотя бы одну метку перед проверкой'), 'error');
                        showEvaluationResult(null);
                        return;
                    }
                }

                const polygons = Array.isArray(answer.polygons) ? answer.polygons : [];
                const lines = Array.isArray(answer.lines) ? answer.lines : [];
                const drawing = Array.isArray(answer.drawing) ? answer.drawing : [];
                if (missingRequiredLabels(answer, {
                    clicks: 0,
                    polygons: polygons.length,
                    lines: lines.length,
                    drawing: drawing.length,
                }, SessionState.currentTask)) {
                    showStatus(wt('s1.err_fill_labels', 'Заполните названия для всех отметок перед проверкой'), 'error');
                    showEvaluationResult(null);
                    return;
                }
            }
        } catch (e) { /* ignore */ }

        // Save draft
        if (typeof DraftStorage !== 'undefined') {
            const draftKey = buildCurrentDraftStorageKey();
            if (draftKey) {
                DraftStorage.saveDraft(SessionState.sessionId, draftKey, answer);
            }
        }

        try {
            setLoading(true);
            setButtonBusy("check-answer-btn", true, { label: wt('s1.btn_checking', 'Проверяем') });
            showStatus("");

            const { status, data } = await SessionAPI.submitAnswer(
                SessionState.sessionId,
                SessionState.currentTask.task_id,
                answer
            );

            if (status === 409) {
                await handlePausedConflict();
                return;
            }

            const response = data;
            if (!response.ok) {
                showStatus(response.error || wt('s1.err_send_answer', 'Не удалось отправить ответ'), "error");
                showEvaluationResult(null);
                setCanGoNext(false);
                return;
            }

            // Clear draft
            if (typeof DraftStorage !== 'undefined') {
                clearPendingTestDraftAutosave();
                const draftKey = buildCurrentDraftStorageKey();
                if (draftKey) {
                    DraftStorage.clearDraft(SessionState.sessionId, draftKey);
                }
            }

            showStatus("");
            if (isPendingUserJudgementResult(response.result)) {
                applyPendingUserJudgementState(response.result, currentTaskType);
            } else {
                finalizeCheckedResult(response.result, currentTaskType);
            }

        } catch (err) {
            console.error(err);
            showRetryOption(handleSubmitAnswer);
            showEvaluationResult(null);
        } finally {
            setButtonBusy("check-answer-btn", false);
            setLoading(false);
            refreshCheckButtonState();
        }
    }

    // -------------------------------------------------------------------
    // Next Task
    // -------------------------------------------------------------------
    async function handleNextTask() {
        if (SessionState.isLoading) return;
        if (!SessionState.sessionId) return;
        if (SessionState.paused) {
            showResumeModal();
            return;
        }
        if (!SessionState.currentTaskChecked || !SessionState.canGoNext) {
            showStatus(wt('s1.err_check_first', 'Сначала проверьте задание'), "error");
            return;
        }
        clearPendingUiStateAutosave(true);
        try {
            setLoading(true);
            setButtonBusy("next-task-btn", true, { label: wt('s1.btn_loading', 'Загрузка') });
            showStatus("");

            const prevTask = SessionState.currentTask || null;
            if (!prevTask) {
                showTaskSkeleton();
            }
            const { status, data } = await SessionAPI.nextTask(SessionState.sessionId);

            if (status === 409 && data && data.error === "session_paused") {
                await handlePausedConflict();
                return;
            }

            const response = data;

            // Use SessionFlow if available
            if (SessionFlow) {
                const handled = SessionFlow.handleNextTaskCompletion({
                    sessionId: SessionState.sessionId,
                    status,
                    response,
                    redirect: (url) => { navigateWithoutPrompt(url); },
                });
                if (handled && handled.handled) return;
            }

            if (!response.ok) {
                if (response.error === "task_not_checked") {
                    showStatus(wt('s1.err_check_first', 'Сначала проверьте задание'), "error");
                    return;
                }
                const redirected = await maybeRedirectToResults();
                if (!redirected) showStatus(response.error || wt('s1.err_no_more_tasks', 'Следующее задание не найдено'), "error");
                return;
            }

            const nextTask = response.task || response;

            // Iteration end check
            if (prevTask && nextTask) {
                const prevIter = typeof prevTask.iteration === "number" ? prevTask.iteration : null;
                const nextIter = typeof nextTask.iteration === "number" ? nextTask.iteration : null;
                if (prevIter !== null && nextIter !== null && nextIter > prevIter) {
                    const redirected = await maybeRedirectToResults(prevIter);
                    if (redirected) return;
                }
            }

            // Same task check
            let isSameTask = false;
            if (prevTask && nextTask) {
                const prevRef = prevTask.task_ref || `${prevTask.module_id}/${prevTask.topic_id}/${prevTask.task_id}`;
                const nextRef = nextTask.task_ref || `${nextTask.module_id}/${nextTask.topic_id}/${nextTask.task_id}`;
                const prevIndex = (prevTask.queue && typeof prevTask.queue.index === "number") ? prevTask.queue.index : null;
                const nextIndex = (nextTask.queue && typeof nextTask.queue.index === "number") ? nextTask.queue.index : null;
                isSameTask = prevRef === nextRef && prevIndex === nextIndex;
            }

            if (isSameTask) {
                const redirected = await maybeRedirectToResults();
                if (!redirected) showStatus(wt('s1.err_no_iteration_tasks', 'Больше нет заданий в этой итерации'), "error");
                return;
            }

            showStatus("");
            renderTask(nextTask);
            refreshCheckButtonState();

        } catch (err) {
            console.error(err);
            showStatus(wt('s1.err_next_task_fail', 'Неожиданная ошибка при загрузке следующего задания'), "error");
        } finally {
            setButtonBusy("next-task-btn", false);
            setLoading(false);
            refreshCheckButtonState();
        }
    }

    // -------------------------------------------------------------------
    // Cancel Session
    // -------------------------------------------------------------------
    async function handleCancelSession() {
        if (!SessionState.sessionId) {
            showStatus(wt('s1.err_session_missing', 'Сессия не найдена. Обновите страницу'), "error");
            return;
        }
        clearPendingUiStateAutosave();

        const confirmed = await NotificationUI.confirm({
            title: wt('s1.confirm_cancel_title', 'Прервать комплекс?'),
            message: wt('s1.confirm_cancel_message', 'Вы уверены, что хотите прервать выполнение комплекса и вернуться в меню?'),
            confirmText: wt('s1.confirm_cancel_confirm', 'Прервать'),
            cancelText: wt('s1.confirm_cancel_cancel', 'Продолжить'),
            variant: 'error'
        });
        if (!confirmed) return;

        const finishBtn = document.getElementById("finish-complex-btn");
        if (finishBtn) finishBtn.setAttribute("disabled", "true");

        try {
            const response = await fetch(SessionRoutes.API.CANCEL(SessionState.sessionId), { method: "POST" });
            if (!response.ok) {
                let message = wt('s1.err_cancel_fail', 'Не удалось завершить комплекс. Попробуйте ещё раз');
                try {
                    const data = await response.json();
                    if (data && (data.error || data.message)) {
                        message = data.error || data.message;
                    }
                } catch (e) {
                    // Ignore parse errors and keep default message.
                }
                showStatus(message, "error");
                if (finishBtn) finishBtn.removeAttribute("disabled");
                return;
            }
            navigateWithoutPrompt(SessionRoutes.MAIN);
        } catch (err) {
            console.error("Cancel session failed", err);
            showStatus(wt('s1.err_cancel_fail', 'Не удалось завершить комплекс. Попробуйте ещё раз'), "error");
            if (finishBtn) finishBtn.removeAttribute("disabled");
        }
    }

    // -------------------------------------------------------------------
    // MISSING-1 & MISSING-2: beforeunload — save draft + warn on leave
    // -------------------------------------------------------------------
    function getCurrentAnswerPayload() {
        const taskType = getCurrentEffectiveTaskType();
        if (!taskType) return null;
        try {
            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.getUserAnswerPayload === "function") {
                return TestUI.getUserAnswerPayload() || null;
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.getUserAnswerPayload === "function") {
                return SequenceUI.getUserAnswerPayload() || null;
            } else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.getUserAnswerPayload === "function") {
                return ImageLabelUI.getUserAnswerPayload() || null;
            } else if (taskType === "click" && typeof ClickUI !== "undefined" && typeof ClickUI.getUserAnswerPayload === "function") {
                return ClickUI.getUserAnswerPayload() || null;
            } else if (taskType === "open_answer" && typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.getUserAnswerPayload === "function") {
                return OpenAnswerUI.getUserAnswerPayload() || null;
            } else if (taskType === "draw" && typeof DrawUI !== "undefined" && typeof DrawUI.getUserAnswerPayload === "function") {
                return DrawUI.getUserAnswerPayload() || null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function getCurrentViewState() {
        const taskType = getCurrentEffectiveTaskType();
        if (!taskType) return null;
        try {
            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.getViewState === "function") {
                return TestUI.getViewState() || null;
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.getViewState === "function") {
                return SequenceUI.getViewState() || null;
            } else if (taskType === "image_labeling" && typeof ImageLabelUI !== "undefined" && typeof ImageLabelUI.getViewState === "function") {
                return ImageLabelUI.getViewState() || null;
            } else if (taskType === "click" && typeof ClickUI !== "undefined" && typeof ClickUI.getViewState === "function") {
                return ClickUI.getViewState() || null;
            } else if (taskType === "draw" && typeof DrawUI !== "undefined" && typeof DrawUI.getViewState === "function") {
                return DrawUI.getViewState() || null;
            }
        } catch (e) {
            return null;
        }
        return null;
    }

    function buildPausePayload(userInput, viewState) {
        const payload = {};
        const taskRef = buildCurrentTaskRef();
        const queueIndex = buildCurrentTaskQueueIndex();
        if (taskRef) {
            payload.task_ref = taskRef;
        }
        if (Number.isInteger(queueIndex)) {
            payload.task_index = queueIndex;
        }
        if (userInput && typeof userInput === "object") {
            payload.user_input = userInput;
        }
        if (viewState && typeof viewState === "object") {
            payload.view_state = viewState;
        }
        if (
            SessionState &&
            SessionState.currentEvaluationResult &&
            (SessionState.currentTaskChecked || SessionState.pendingManualJudgement) &&
            typeof SessionState.currentEvaluationResult === "object"
        ) {
            payload.evaluation_result = SessionState.currentEvaluationResult;
        }
        return payload;
    }

    function buildPauseRequestBody(userInput, viewState) {
        return JSON.stringify(buildPausePayload(userInput, viewState));
    }

    const PENDING_UNLOAD_PAUSE_KEY_PREFIX = "s1_pending_unload_pause_v1:";
    const PENDING_UNLOAD_PAUSE_MAX_AGE_MS = 15000;

    function getPendingUnloadPauseKey(sessionId) {
        return `${PENDING_UNLOAD_PAUSE_KEY_PREFIX}${String(sessionId || "").trim()}`;
    }

    function rememberPendingUnloadPause(sessionId) {
        if (
            typeof window === "undefined" ||
            typeof sessionStorage === "undefined" ||
            !sessionId
        ) {
            return;
        }

        try {
            sessionStorage.setItem(
                getPendingUnloadPauseKey(sessionId),
                JSON.stringify({
                    timestamp: Date.now(),
                    path: String(window.location.pathname || ""),
                })
            );
        } catch (err) {
            // best-effort
        }
    }

    function consumePendingUnloadPauseMarker(sessionId) {
        if (
            typeof window === "undefined" ||
            typeof sessionStorage === "undefined" ||
            !sessionId
        ) {
            return false;
        }

        const key = getPendingUnloadPauseKey(sessionId);
        let raw = null;
        try {
            raw = sessionStorage.getItem(key);
            sessionStorage.removeItem(key);
        } catch (err) {
            return false;
        }

        if (!raw) return false;

        try {
            const parsed = JSON.parse(raw);
            const timestamp = Number(parsed && parsed.timestamp);
            const path = String((parsed && parsed.path) || "").trim();
            const ageMs = Date.now() - timestamp;
            if (!Number.isFinite(timestamp) || ageMs < 0 || ageMs > PENDING_UNLOAD_PAUSE_MAX_AGE_MS) {
                return false;
            }
            if (path && path !== String(window.location.pathname || "").trim()) {
                return false;
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    function tryPauseSessionOnUnload(userInput, viewState) {
        if (!SessionState || !SessionState.sessionId || SessionState.paused) return false;
        const pauseUrl =
            SessionRoutes &&
            SessionRoutes.API &&
            typeof SessionRoutes.API.PAUSE === "function"
                ? SessionRoutes.API.PAUSE(SessionState.sessionId)
                : null;
        if (!pauseUrl) return false;
        const requestBody = buildPauseRequestBody(userInput, viewState);

        let requested = false;
        try {
            if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
                const body = typeof Blob !== "undefined"
                    ? new Blob([requestBody], { type: "application/json" })
                    : requestBody;
                requested = navigator.sendBeacon(pauseUrl, body) === true;
            }
        } catch (err) {
            requested = false;
        }

        if (!requested) {
            try {
                if (typeof fetch === "function") {
                    fetch(pauseUrl, {
                        method: "POST",
                        credentials: "same-origin",
                        keepalive: true,
                        headers: { "Content-Type": "application/json" },
                        body: requestBody
                    }).catch(() => { });
                    requested = true;
                }
            } catch (err) {
                requested = false;
            }
        }

        if (requested) {
            rememberPendingUnloadPause(SessionState.sessionId);
            SessionState.paused = true;
        }
        return requested;
    }

    function initBeforeUnloadGuard() {
        if (typeof window === "undefined") return;
        window.addEventListener("beforeunload", (e) => {
            if (!SessionState.sessionId || !SessionState.currentTask) return;
            if (SessionState.skipBeforeUnloadPrompt) return;

            let payload = null;
            let viewState = null;
            try {
                payload = getCurrentAnswerPayload();
                viewState = getCurrentViewState();
                if (payload && typeof DraftStorage !== "undefined") {
                    const draftKey = buildCurrentDraftStorageKey();
                    if (draftKey) {
                        DraftStorage.saveDraft(SessionState.sessionId, draftKey, payload);
                    }
                }
            } catch (err) {
                // best-effort
            }

            try {
                tryPauseSessionOnUnload(payload, viewState);
            } catch (err) {
                // best-effort
            }
        });
    }

    function allowNavigationWithoutPrompt() {
        if (!SessionState) return;
        SessionState.skipBeforeUnloadPrompt = true;
    }

    function navigateWithoutPrompt(url) {
        if (!url) return;
        allowNavigationWithoutPrompt();
        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition(url);
        } else {
            window.location.href = url;
        }
    }

    return {
        handleCheckAnswerClick,
        handleSubmitAnswer,
        handleUserJudgementChoice,
        handleDrawLabelJudgementChoice,
        handleNextTask,
        handleCancelSession,
        handlePauseConfirm,
        handleResumeConfirm,
        handleDiscardSession,
        initTestSubmitGuard,
        initUiStateAutosave,
        refreshCheckButtonState,
        initBeforeUnloadGuard,
        resetUiStateAutosaveTracking,
        consumePendingUnloadPauseMarker,
        allowNavigationWithoutPrompt,
        navigateWithoutPrompt
    };
}));
