(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['SessionState', 'SessionAPI', 'UIHelpers', 'TaskRenderer', 'SessionControls', 'SessionRoutes', 'SessionValidation'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(
            require('./session-state'),
            require('./api-client'),
            require('./ui-helpers'),
            require('./task-renderer'),
            require('./session-controls'),
            require('./routes'),
            require('./session_validation')
        );
    } else {
        root.Main = factory(
            root.SessionState,
            root.SessionAPI,
            root.UIHelpers,
            root.TaskRenderer,
            root.SessionControls,
            root.SessionRoutes,
            root.SessionValidation
        );
    }
}(typeof self !== 'undefined' ? self : this, function (SessionState, api, UIHelpers, TaskRenderer, SessionControls, SessionRoutes, SessionValidation) {

    const state = SessionState && SessionState.state ? SessionState.state : SessionState;
    const {
        showStatus,
        showResumeModal,
        hideResumeModal,
        setPaused,
        setLoading,
        setCanGoNext,
        openPauseModal,
        closePauseModal
    } = UIHelpers;

    const {
        renderTask
    } = TaskRenderer;

    const {
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
    } = SessionControls;

    function syncCheckButtonState() {
        if (typeof refreshCheckButtonState === 'function') {
            refreshCheckButtonState();
        }
    }

    function getSessionIdFromLocation() {
        const url = new URL(window.location.href);

        let rawId = url.searchParams.get('sessionId');

        if (!rawId) {
            const segments = url.pathname.split('/').filter(Boolean);
            rawId = segments[segments.length - 1];
        }

        if (typeof SessionValidation !== 'undefined') {
            const validation = SessionValidation.validateSessionId(rawId);
            if (!validation.valid) {
                console.error('Invalid session ID:', validation.error);
                showStatus(`Ошибка: ${validation.error}`, 'error');

                setTimeout(() => {
                    window.navigateWithTransition(SessionRoutes.MAIN);
                }, 2000);

                return null;
            }
        }

        return rawId;
    }

    async function loadInitialTask() {
        const sessionId = getSessionIdFromLocation();

        if (!sessionId) {
            renderTask(null);
            syncCheckButtonState();
            return;
        }

        state.sessionId = sessionId;
        setCanGoNext(false);
        const sessionLabel = document.getElementById('session-id-label');
        if (sessionLabel) {
            sessionLabel.textContent = sessionId || '-';
        }

        try {
            setLoading(true);
            showStatus('Загружаем текущее задание...');
            const { status, data } = await api.getCurrentTask(sessionId);

            if (status === 404) {
                showStatus('Сессия не найдена', 'error');
                setTimeout(() => {
                    window.navigateWithTransition('/ui/main');
                }, 2000);
                renderTask(null);
                syncCheckButtonState();
                return;
            }

            if (status === 410) {
                showStatus('Сессия завершена', 'success');
                setTimeout(() => {
                    window.navigateWithTransition(SessionRoutes.SESSION_RESULTS(sessionId));
                }, 1000);
                renderTask(null);
                syncCheckButtonState();
                return;
            }

            const response = data;
            if (!response.ok) {
                showStatus(response.error || 'Не удалось загрузить задание', 'error');
                renderTask(null);
                syncCheckButtonState();
                return;
            }

            setPaused(!!response.paused);
            if (response.paused) {
                showResumeModal();
            } else {
                hideResumeModal();
            }

            showStatus('');
            renderTask(response.task);
            syncCheckButtonState();
        } catch (err) {
            console.error(err);
            showRetryOption(loadInitialTask);
            renderTask(null);
            syncCheckButtonState();
        } finally {
            setLoading(false);
            syncCheckButtonState();
        }
    }

    function init() {
        document
            .getElementById('check-answer-btn')
            .addEventListener('click', handleCheckAnswerClick || handleSubmitAnswer);
        document
            .getElementById('next-task-btn')
            .addEventListener('click', handleNextTask);
        document
            .getElementById('finish-complex-btn')
            .addEventListener('click', handleCancelSession);

        const backBtn = document.getElementById('back-to-complexes-btn');
        if (backBtn) {
            backBtn.addEventListener('click', openPauseModal);
        }
        const pauseContinue = document.getElementById('pause-confirm-continue');
        if (pauseContinue) {
            pauseContinue.addEventListener('click', closePauseModal);
        }
        const pauseSubmit = document.getElementById('pause-confirm-submit');
        if (pauseSubmit) {
            pauseSubmit.addEventListener('click', () => {
                handlePauseConfirm();
            });
        }
        const pauseDiscard = document.getElementById('pause-confirm-discard');
        if (pauseDiscard) {
            pauseDiscard.addEventListener('click', () => {
                handleDiscardSession();
            });
        }
        const resumeExit = document.getElementById('resume-exit-btn');
        if (resumeExit) {
            resumeExit.addEventListener('click', () => {
                window.navigateWithTransition(SessionRoutes.COMPLEXES || '/ui/complexes');
            });
        }
        const resumeContinue = document.getElementById('resume-continue-btn');
        if (resumeContinue) {
            resumeContinue.addEventListener('click', () => {
                handleResumeConfirm();
            });
        }

        if (typeof initTestSubmitGuard === 'function') {
            initTestSubmitGuard();
        } else {
            syncCheckButtonState();
        }

        if (typeof initBeforeUnloadGuard === 'function') {
            initBeforeUnloadGuard();
        }

        loadInitialTask();
    }

    return {
        init,
        loadInitialTask,
        getSessionIdFromLocation
    };

}));
