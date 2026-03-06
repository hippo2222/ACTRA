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
        showRetryOption,
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

    function getTheoryBridgeStorageKey(sessionId) {
        return `theory_training_bridge_v1:${String(sessionId || '').trim()}`;
    }

    function loadTheoryBridgeContext(sessionId) {
        const normalizedSessionId = String(sessionId || '').trim();
        if (!normalizedSessionId || typeof window.sessionStorage === 'undefined') return null;

        try {
            const raw = window.sessionStorage.getItem(getTheoryBridgeStorageKey(normalizedSessionId));
            if (!raw) return null;

            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;

            const theoryId = String(parsed.theoryId || '').trim();
            if (!theoryId) return null;

            return {
                ...parsed,
                theoryId,
                theoryTitle: String(parsed.theoryTitle || '').trim() || theoryId,
            };
        } catch (error) {
            console.warn('Failed to load theory bridge context in S1', error);
            return null;
        }
    }

    function renderTheorySessionContext(context) {
        const banner = document.getElementById('theory-session-banner');
        const titleEl = document.getElementById('theory-session-title');
        const metaEl = document.getElementById('theory-session-meta');
        if (!banner || !titleEl || !metaEl) return;

        const theoryId = String(context?.theoryId || '').trim();
        if (!theoryId) {
            banner.classList.add('hidden');
            titleEl.textContent = 'Теория';
            metaEl.textContent = '';
            state.theoryContext = null;
            return;
        }

        const theoryTitle = String(context?.theoryTitle || '').trim() || theoryId;
        const complexId = String(context?.complexId || '').trim();
        const origin = String(context?.origin || '').trim();
        const metaParts = [];

        if (complexId) metaParts.push(`Комплекс: ${complexId}`);
        if (origin === 'editor_theory_hub') {
            metaParts.push('Сессия запущена из Theory Hub.');
        } else if (origin === 'complex_theory_link') {
            metaParts.push('Контекст подтянут из theory_link комплекса.');
        } else {
            metaParts.push('Текущая сессия привязана к этой теории.');
        }
        metaParts.push('После завершения можно вернуться к связанному theory-контексту на экране итогов.');

        titleEl.textContent = `Теория: ${theoryTitle}`;
        metaEl.textContent = metaParts.join(' ');
        banner.classList.remove('hidden');
        state.theoryContext = {
            theoryId,
            theoryTitle,
            complexId,
            origin,
        };
    }

    async function resolveTheorySessionContext(taskPayload) {
        const sessionId = String(state.sessionId || '').trim();
        const bridgeContext = loadTheoryBridgeContext(sessionId);
        if (bridgeContext && bridgeContext.theoryId) {
            return bridgeContext;
        }

        const complexId = String(taskPayload?.complex_id || '').trim();
        if (!complexId) return null;

        try {
            const response = await fetch(`/api/complexes/${encodeURIComponent(complexId)}`);
            const data = await response.json();
            if (!response.ok || !data?.ok || !data?.item) return null;

            const theoryLink = (data.item && typeof data.item.theory_link === 'object') ? data.item.theory_link : null;
            const theoryId = String(theoryLink?.theory_id || '').trim();
            if (!theoryId) return null;

            return {
                theoryId,
                theoryTitle: String(theoryLink?.title_cache || '').trim() || theoryId,
                complexId,
                origin: 'complex_theory_link',
            };
        } catch (error) {
            console.warn('Failed to resolve theory context for session task', error);
            return null;
        }
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
        renderTheorySessionContext(null);
        const sessionLabel = document.getElementById('session-id-label');
        if (sessionLabel) {
            sessionLabel.textContent = sessionId || '-';
        }

        try {
            setLoading(true);
            showStatus('Загружаем текущее задание...');
            const hadRenderedTask = !!state.currentTask;
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
                if (!hadRenderedTask) {
                    renderTask(null);
                }
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
            const theoryContext = await resolveTheorySessionContext(response.task);
            renderTheorySessionContext(theoryContext);
            renderTask(response.task);
            syncCheckButtonState();
        } catch (err) {
            console.error(err);
            renderTheorySessionContext(null);
            if (typeof showRetryOption === 'function') {
                showRetryOption(loadInitialTask);
            } else {
                showStatus('Не удалось загрузить задание. Попробуйте снова', 'error');
            }
            if (!state.currentTask) {
                renderTask(null);
            }
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
