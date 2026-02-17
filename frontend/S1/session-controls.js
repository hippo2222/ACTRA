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

    const {
        showStatus,
        showRetryOption,
        showResumeModal,
        hideResumeModal,
        setPauseInFlight,
        setCanGoNext,
        setLoading,
        showTaskSkeleton
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
        const answeredCount = answeredIds.size;
        const unansweredCount = Math.max(0, totalQuestions - answeredCount);

        return {
            totalQuestions,
            answeredCount,
            unansweredCount,
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

    function setCheckButtonBlockedVisual(blocked, progress) {
        const checkBtn = document.getElementById("check-answer-btn");
        if (!checkBtn) return;

        const isLoading = !!(SessionState && SessionState.isLoading);
        if (isLoading) {
            checkBtn.disabled = true;
            return;
        }

        checkBtn.disabled = !!blocked;
        checkBtn.classList.remove("cursor-not-allowed");

        if (!blocked) {
            checkBtn.removeAttribute("aria-disabled");
            checkBtn.removeAttribute("data-test-incomplete");
            checkBtn.removeAttribute("title");
            return;
        }

        checkBtn.setAttribute("aria-disabled", "true");
        checkBtn.setAttribute("data-test-incomplete", "true");
        checkBtn.classList.add("cursor-not-allowed");
        if (progress && Number.isFinite(progress.answeredCount) && Number.isFinite(progress.totalQuestions) && progress.totalQuestions > 0) {
            checkBtn.title = `Ответьте на все вопросы (${progress.answeredCount}/${progress.totalQuestions})`;
        } else {
            checkBtn.title = "Ответьте на все вопросы перед проверкой";
        }
    }

    function refreshCheckButtonState(progressOverride = null) {
        const taskType = getCurrentEffectiveTaskType();
        if (taskType !== "test") {
            setCheckButtonBlockedVisual(false, null);
            return null;
        }

        const progress = progressOverride || getCurrentTestProgress();
        const blocked = !!(progress && progress.totalQuestions > 0 && !progress.allAnswered);
        setCheckButtonBlockedVisual(blocked, progress);
        return progress;
    }

    function handleCheckAnswerClick(event) {
        const taskType = getCurrentEffectiveTaskType();
        if (taskType === "test") {
            const progress = refreshCheckButtonState();
            const blocked = !!(progress && progress.totalQuestions > 0 && !progress.allAnswered);
            if (blocked) {
                if (event) {
                    event.preventDefault();
                    event.stopPropagation();
                }
                showStatus(`Ответьте на все вопросы перед проверкой (${progress.answeredCount}/${progress.totalQuestions})`);
                showEvaluationResult(null);
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
        });

        if (!testBlockedHintListenerBound && typeof document !== "undefined") {
            testBlockedHintListenerBound = true;
            document.addEventListener("pointerdown", (ev) => {
                const target = ev && ev.target && ev.target.closest
                    ? ev.target.closest("#check-answer-btn")
                    : null;
                if (!target) return;
                if (target.getAttribute("data-test-incomplete") !== "true") return;
                const progress = getCurrentTestProgress();
                if (progress && progress.totalQuestions > 0 && !progress.allAnswered) {
                    showStatus(`Ответьте на все вопросы перед проверкой (${progress.answeredCount}/${progress.totalQuestions})`);
                }
            });
        }
        refreshCheckButtonState();
    }

    // -------------------------------------------------------------------
    // Helper: maybeRedirectToResults (Internal)
    // -------------------------------------------------------------------
    async function maybeRedirectToResults() {
        if (!SessionState.sessionId) return false;

        try {
            const currentIteration =
                (SessionState.currentTask && SessionState.currentTask.iteration) || 1;

            const { status, data } = await SessionAPI.getIterationResults(SessionState.sessionId);
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
                window.navigateWithTransition(`/ui/session/${encodeURIComponent(
                    SessionState.sessionId
                )}/iteration/${encodeURIComponent(iteration)}`);
            } else {
                window.navigateWithTransition(`/ui/session/${encodeURIComponent(
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
        showStatus("Сессия на паузе. Возобновите её, чтобы продолжить", "error");
        showResumeModal();
    }

    async function handleResumeConfirm() {
        if (!SessionState.sessionId) return;
        const spinner = document.getElementById("resume-spinner");
        if (spinner) spinner.classList.remove("hidden");
        try {
            const { status, data } = await SessionAPI.resumeSession(SessionState.sessionId);
            const resp = data;
            if (status === 200 && resp && resp.ok) {
                hideResumeModal();
                UIHelpers.setPausedUI(false); // Direct call to updated helper if exported, or via setPaused alias in UIHelpers?
                // Note: UIHelpers.setPausedUI was not explicitly exported in my memory of ui-helpers.js source unless I check.
                // But index.html had `const setPaused = UIHelpers.setPausedUI`.
                // I should verify if setPausedUI is valid. I'll assume yes for now.
                showStatus("");
                // Access global loadInitialTask? Or should we reload?
                // Ideally we should reload the task. But loadInitialTask is in main.js (not yet created).
                // Check if loadInitialTask is available globally.
                if (typeof window.loadInitialTask === 'function') {
                    await window.loadInitialTask();
                } else {
                    console.warn("loadInitialTask not found, reloading page");
                    window.location.reload();
                }
            } else {
                showStatus((resp && resp.error) || "Не удалось возобновить сессию", "error");
            }
        } catch (e) {
            console.error("Resume failed", e);
            showStatus("Не удалось возобновить сессию. Попробуйте снова", "error");
        } finally {
            if (spinner) spinner.classList.add("hidden");
        }
    }

    async function handlePauseConfirm() {
        if (!SessionState.sessionId) {
            showStatus("Сессия не найдена. Обновите страницу", "error");
            return;
        }
        setPauseInFlight(true);
        showStatus("");
        try {
            const { status, data } = await SessionAPI.pauseSession(SessionState.sessionId);
            const resp = data;
            if (status === 409) {
                await handlePausedConflict();
                return;
            }
            if (!resp || resp.ok !== true) {
                const message =
                    (resp && (resp.error || resp.message)) ||
                    "Не удалось поставить сессию на паузу. Попробуйте ещё раз";
                showStatus(message, "error");
                return;
            }
            window.navigateWithTransition(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/ui/complexes");
        } catch (err) {
            console.error("Pause request failed", err);
            showStatus("Не удалось поставить сессию на паузу. Проверьте соединение и попробуйте снова", "error");
        } finally {
            setPauseInFlight(false);
        }
    }

    async function handleDiscardSession() {
        if (!SessionState.sessionId) {
            window.navigateWithTransition(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/ui/complexes");
            return;
        }

        setPauseInFlight(true);
        showStatus("");
        try {
            const response = await fetch(SessionRoutes.API.CANCEL(SessionState.sessionId), { method: "POST" });
            if (!response.ok) {
                let message = "Не удалось завершить попытку без сохранения.";
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

            window.navigateWithTransition(SessionRoutes.COMPLEXES || SessionRoutes.MAIN || "/ui/complexes");
        } catch (err) {
            console.error("Discard session failed", err);
            showStatus("Не удалось выйти без сохранения. Попробуйте снова", "error");
        } finally {
            setPauseInFlight(false);
        }
    }

    // -------------------------------------------------------------------
    // Submit Answer
    // -------------------------------------------------------------------
    async function handleSubmitAnswer() {
        if (SessionState.isLoading) return;
        if (!SessionState.sessionId || !SessionState.currentTask) return;
        if (SessionState.paused) {
            showResumeModal();
            return;
        }

        let answer = {};
        const currentTaskType = getCurrentEffectiveTaskType();
        let testAnsweredCount = null;
        let testTotalQuestions = null;

        setCanGoNext(false);
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
        } else if (currentTaskType === "click" && getTaskSubtype(SessionState.currentTask) === "error_detection" && typeof MistakesUI !== "undefined") {
            answer = MistakesUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "click" && typeof ClickUI !== "undefined") {
            answer = ClickUI.getUserAnswerPayload() || {};
        } else if (currentTaskType === "draw") {
            const rawType = getRawTaskType(SessionState.currentTask);
            if (rawType === "draw" && typeof ClickUI !== "undefined") {
                answer = ClickUI.getUserAnswerPayload() || {};
            } else if (typeof DrawUI !== "undefined") {
                answer = DrawUI.getUserAnswerPayload() || {};
            }
        } else if (currentTaskType === "open_answer" && typeof OpenAnswerUI !== "undefined") {
            answer = OpenAnswerUI.getUserAnswerPayload() || {};
        }

        // Validation
        try {
            if (currentTaskType === "open_answer") {
                const isValid = typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.isAnswerValid === "function"
                    ? !!OpenAnswerUI.isAnswerValid()
                    : !!(answer && typeof answer.answer === "string" && answer.answer.trim().length > 0);
                if (!isValid) {
                    showStatus("Введите ответ перед проверкой", "error");
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
                if (difficulty === 2 || difficulty === 3) {
                    const levels = answer && Array.isArray(answer.levels) ? answer.levels : [];
                    const hasAnyBlock = levels.some((l) => Array.isArray(l && l.blocks) && l.blocks.some((x) => x != null));
                    if (!hasAnyBlock) {
                        showStatus("Сначала создайте уровень и разместите хотя бы один элемент", "error");
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
                            showStatus("Для всех размещенных элементов нужно указать названия", "error");
                            showEvaluationResult(null);
                            return;
                        }
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

                if (!hasAnyAnswer) {
                    showStatus("Ответьте хотя бы на один вопрос перед проверкой", "error");
                    showEvaluationResult(null);
                    return;
                }
            
                const totalQuestions = Array.isArray(answer.questions) ? answer.questions.length : 0;
                if (totalQuestions > 0) {
                    const answeredIds = new Set([
                        ...Object.keys(answer.answers || {}),
                        ...Object.keys(answer.text_answers || {})
                    ]);
                    const answeredCount = answeredIds.size;
                    const unansweredCount = Math.max(0, totalQuestions - answeredCount);
                    testAnsweredCount = answeredCount;
                    testTotalQuestions = totalQuestions;
                    console.info("[SubmitAnswer][test] payload summary", {
                        totalQuestions,
                        answeredCount,
                        unansweredCount,
                        answeredQuestionIds: Array.from(answeredIds),
                        answerKeys: Object.keys(answer.answers || {}),
                        textAnswerKeys: Object.keys(answer.text_answers || {})
                    });

                    // Prevent misleading "wrong answer" result when user checked
                    // only part of the test.
                    if (unansweredCount > 0) {
                        showStatus(`Ответьте на все вопросы перед проверкой (${answeredCount}/${totalQuestions})`);
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Validation 4: Click must have at least one interaction
        try {
            if (currentTaskType === "click") {
                const subtype = getTaskSubtype(SessionState.currentTask);
                // Skip validation for error_detection (auto-submit)
                if (subtype !== "error_detection") {
                    const clicks = answer.clicks || [];
                    const labels = answer.labels || {};
                    const hasAnyInteraction = clicks.length > 0 || Object.keys(labels).length > 0;

                    if (!hasAnyInteraction) {
                        showStatus("Сделайте хотя бы одно действие (клик или подпись) перед проверкой", "error");
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Validation 5: Draw must have at least one drawing
        try {
            if (currentTaskType === "draw") {
                // Check if DrawUI has validation method
                if (typeof DrawUI !== "undefined" && typeof DrawUI.hasAnyDrawing === "function") {
                    if (!DrawUI.hasAnyDrawing()) {
                        showStatus("Нарисуйте хотя бы одну метку перед проверкой", "error");
                        showEvaluationResult(null);
                        return;
                    }
                } else {
                    // Fallback: check payload structure
                    const hasDrawing =
                        (answer.drawings && Array.isArray(answer.drawings) && answer.drawings.length > 0) ||
                        (answer.strokes && Array.isArray(answer.strokes) && answer.strokes.length > 0);

                    if (!hasDrawing) {
                        showStatus("Нарисуйте хотя бы одну метку перед проверкой", "error");
                        showEvaluationResult(null);
                        return;
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Save draft
        if (typeof DraftStorage !== 'undefined') {
            DraftStorage.saveDraft(SessionState.sessionId, SessionState.currentTask.task_id, answer);
        }

        try {
            setLoading(true);
            const currentSubtype = getTaskSubtype(SessionState.currentTask);
            if (!(currentSubtype === "error_detection" && getCurrentEffectiveTaskType() === "click")) {
                if (
                    currentTaskType === "test" &&
                    Number.isFinite(testAnsweredCount) &&
                    Number.isFinite(testTotalQuestions) &&
                    testTotalQuestions > 0
                ) {
                    showStatus(`Проверяем ответ... (отвечено ${testAnsweredCount}/${testTotalQuestions})`);
                } else {
                    showStatus("Проверяем ответ...");
                }
            } else {
                showStatus("");
            }

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
                showStatus(response.error || "Не удалось отправить ответ", "error");
                showEvaluationResult(null);
                setCanGoNext(false);
                return;
            }

            // Clear draft
            if (typeof DraftStorage !== 'undefined') {
                DraftStorage.clearDraft(SessionState.sessionId, SessionState.currentTask.task_id);
            }

            showStatus("");
            showEvaluationResult(response.result);

            setCanGoNext(true);

            // Apply feedback
            // Note: Simplified logic to call applyCheckFeedback on various UIs
            if (currentTaskType === "test" && typeof TestUI !== "undefined") TestUI.applyCheckFeedback(response.result);
            else if (currentTaskType === "sequence_assembly" && typeof SequenceUI !== "undefined") SequenceUI.applyCheckFeedback(response.result);
            else if (currentTaskType === "click") {
                const subtype = getTaskSubtype(SessionState.currentTask);
                if (subtype !== "error_detection" && typeof ClickUI !== "undefined") ClickUI.applyCheckFeedback(response.result);
            } else if (currentTaskType === "draw") {
                const rawType = getRawTaskType(SessionState.currentTask);
                if (rawType === "draw" && typeof ClickUI !== "undefined") ClickUI.applyCheckFeedback(response.result);
                else if (typeof DrawUI !== "undefined") DrawUI.applyCheckFeedback(response.result);
            } else if (currentTaskType === "open_answer" && typeof OpenAnswerUI !== "undefined") OpenAnswerUI.applyCheckFeedback(response.result);

        } catch (err) {
            console.error(err);
            showRetryOption(handleSubmitAnswer);
            showEvaluationResult(null);
        } finally {
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
        try {
            setLoading(true);
            showStatus("Загружаем следующее задание...");
            showTaskSkeleton(); // Skeleton integration!

            const prevTask = SessionState.currentTask || null;
            const { status, data } = await SessionAPI.nextTask(SessionState.sessionId);

            if (status === 409) {
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
                    redirect: (url) => { window.navigateWithTransition(url); },
                });
                if (handled && handled.handled) return;
            }

            if (!response.ok) {
                const redirected = await maybeRedirectToResults();
                if (!redirected) showStatus(response.error || "Следующее задание не найдено", "error");
                return;
            }

            const nextTask = response.task;

            // Iteration end check
            if (prevTask && nextTask) {
                const prevIter = typeof prevTask.iteration === "number" ? prevTask.iteration : null;
                const nextIter = typeof nextTask.iteration === "number" ? nextTask.iteration : null;
                if (prevIter !== null && nextIter !== null && nextIter > prevIter) {
                    const redirected = await maybeRedirectToResults();
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
                if (!redirected) showStatus("Больше нет заданий в этой итерации", "error");
                return;
            }

            showStatus("");
            renderTask(nextTask);
            refreshCheckButtonState();

        } catch (err) {
            console.error(err);
            showStatus("Неожиданная ошибка при загрузке следующего задания", "error");
        } finally {
            setLoading(false);
        }
    }

    // -------------------------------------------------------------------
    // Cancel Session
    // -------------------------------------------------------------------
    async function handleCancelSession() {
        if (!SessionState.sessionId) {
            showStatus("Сессия не найдена. Обновите страницу", "error");
            return;
        }

        const confirmed = await NotificationUI.confirm({
            title: 'Прервать комплекс?',
            message: 'Вы уверены, что хотите прервать выполнение комплекса и вернуться в меню?',
            confirmText: 'Прервать',
            cancelText: 'Продолжить',
            variant: 'error'
        });
        if (!confirmed) return;

        const finishBtn = document.getElementById("finish-complex-btn");
        if (finishBtn) finishBtn.setAttribute("disabled", "true");

        try {
            await fetch(SessionRoutes.API.CANCEL(SessionState.sessionId), { method: "POST" });
            window.navigateWithTransition(SessionRoutes.MAIN);
        } catch (err) {
            console.error("Cancel session failed", err);
            showStatus("Не удалось завершить комплекс. Попробуйте ещё раз", "error");
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

    function initBeforeUnloadGuard() {
        if (typeof window === "undefined") return;
        window.addEventListener("beforeunload", (e) => {
            if (!SessionState.sessionId || !SessionState.currentTask) return;
            if (SessionState.canGoNext) return;

            try {
                const payload = getCurrentAnswerPayload();
                if (payload && typeof DraftStorage !== "undefined") {
                    DraftStorage.saveDraft(SessionState.sessionId, SessionState.currentTask.task_id, payload);
                }
            } catch (err) {
                // best-effort
            }

            e.preventDefault();
            e.returnValue = "";
        });
    }

    return {
        handleCheckAnswerClick,
        handleSubmitAnswer,
        handleNextTask,
        handleCancelSession,
        handlePauseConfirm,
        handleResumeConfirm,
        handleDiscardSession,
        initTestSubmitGuard,
        refreshCheckButtonState,
        initBeforeUnloadGuard
    };
}));

