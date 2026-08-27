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

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

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
        renderTask,
        restoreCheckedTaskState,
        restoreDraftToUI,
        restoreViewStateToUI,
        pickEffectiveTaskType
    } = TaskRenderer;

    const {
        handleCheckAnswerClick,
        handleSubmitAnswer,
        handleUserJudgementChoice,
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
        navigateWithoutPrompt
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
                showStatus(wt('s1.err_validation', 'Ошибка: {err}').replace('{err}', validation.error), 'error');

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

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char] || char));
    }

    function renderTheoryInline(text, attributes) {
        if (!text) return "";
        const attrs = attributes || {};
        const hasFormatting = Boolean(
            attrs.bold || attrs.italic || attrs.underline || attrs.strike || attrs.color || attrs.background || attrs.size || attrs.link
        );
        if (!hasFormatting) {
            return escapeHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
        }

        const match = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
        const leading = match ? match[1] : "";
        const core = match ? match[2] : text;
        const trailing = match ? match[3] : "";

        if (!core) {
            return escapeHtml(text).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
        }

        let html = escapeHtml(core).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
        if (attrs.bold) html = `<strong>${html}</strong>`;
        if (attrs.italic) html = `<em>${html}</em>`;
        if (attrs.underline) html = `<u>${html}</u>`;
        if (attrs.strike) html = `<s>${html}</s>`;

        const inlineStyles = [];
        if (attrs.color) inlineStyles.push(`color:${escapeHtml(attrs.color)}`);
        if (attrs.background) inlineStyles.push(`background-color:${escapeHtml(attrs.background)}`);
        if (attrs.size) {
            const sizeVal = String(attrs.size).trim();
            if (sizeVal === "small") inlineStyles.push("font-size:0.82em");
            else if (sizeVal === "large") inlineStyles.push("font-size:1.25em");
            else if (sizeVal === "huge") inlineStyles.push("font-size:1.6em");
            else if (/^\d+(px|rem|em|%)$/i.test(sizeVal)) inlineStyles.push(`font-size:${escapeHtml(sizeVal)}`);
        }

        if (inlineStyles.length > 0) {
            html = `<span style="${inlineStyles.join(';')}">${html}</span>`;
        }

        if (attrs.link) {
            const href = escapeHtml(String(attrs.link).trim());
            html = `<a href="${href}" target="_blank" rel="noopener noreferrer">${html}</a>`;
        }

        const leadHtml = escapeHtml(leading).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
        const trailHtml = escapeHtml(trailing).replace(/\u00A0/g, "&nbsp;").replace(/\r/g, "<br>");
        return leadHtml + html + trailHtml;
    }

    function deltaToTheoryLines(delta) {
        const ops = delta && Array.isArray(delta.ops) ? delta.ops : [];
        const lines = [];
        let segments = [];

        const pushLine = (attrs) => {
            lines.push({
                segments: segments.slice(),
                attrs: attrs || {},
            });
            segments = [];
        };

        for (const op of ops) {
            if (!op || typeof op !== "object" || !("insert" in op)) continue;
            const attrs = op.attributes || {};
            const insert = op.insert;
            if (typeof insert === "string") {
                const parts = insert.split("\n");
                for (let index = 0; index < parts.length; index += 1) {
                    const chunk = parts[index];
                    if (chunk) {
                        segments.push({ kind: "text", value: chunk, attrs });
                    }
                    if (index < parts.length - 1) {
                        pushLine(attrs);
                    }
                }
                continue;
            }

            if (insert && typeof insert === "object" && typeof insert.image === "string") {
                segments.push({
                    kind: "image",
                    value: insert.image,
                    attrs: attrs || {},
                });
            }
        }

        if (segments.length || !lines.length) {
            lines.push({ segments: segments.slice(), attrs: {} });
        }
        return lines;
    }

    function renderTheoryLineContent(segments) {
        if (!Array.isArray(segments) || !segments.length) return "<br>";
        let html = "";
        for (const segment of segments) {
            if (!segment || typeof segment !== "object") continue;
            if (segment.kind === "text") {
                html += renderTheoryInline(segment.value || "", segment.attrs || {});
                continue;
            }
            if (segment.kind === "image" && segment.value) {
                const safeRef = escapeHtml(segment.value);
                const attrs = segment.attrs || {};
                const width = attrs.width || "min(100%, 720px)";
                const align = attrs.align || "left";
                const alignClass = align === "center" ? "mx-auto" : align === "right" ? "ml-auto" : "";
                html += `<span class="theory-image-wrapper block ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}"><img src="${safeRef}" alt="" class="theory-image ${alignClass}" style="max-width:${escapeHtml(width)};width:${escapeHtml(width)};" /></span>`;
            }
        }
        return html || "<br>";
    }

    function renderTheoryDeltaHtml(delta) {
        if (!delta) return `<p style="margin:0;color:var(--color-text-secondary);">${wt('s1.theory_empty_content', 'Контент теории пока недоступен.')}</p>`;
        const lines = deltaToTheoryLines(delta);
        const blocks = [];
        let activeListType = null;
        let activeListItems = [];

        const flushList = () => {
            if (!activeListType || !activeListItems.length) {
                activeListType = null;
                activeListItems = [];
                return;
            }
            const listTag = activeListType === "ordered" ? "ol" : "ul";
            blocks.push(`<${listTag}>${activeListItems.join("")}</${listTag}>`);
            activeListType = null;
            activeListItems = [];
        };

        for (const line of lines) {
            const attrs = line && typeof line === "object" ? line.attrs || {} : {};
            const lineHtml = renderTheoryLineContent(line && line.segments);
            const listType =
                attrs.list === "ordered"
                    ? "ordered"
                    : attrs.list === "bullet" || attrs.list === "check"
                        ? "bullet"
                        : null;

            if (listType) {
                if (activeListType && activeListType !== listType) flushList();
                activeListType = listType;
                const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";
                activeListItems.push(`<li${align}>${lineHtml}</li>`);
                continue;
            }

            flushList();
            const headerLevel = Number(attrs.header);
            const align = attrs.align ? ` style="text-align: ${attrs.align}"` : "";

            if (Number.isInteger(headerLevel) && headerLevel >= 1 && headerLevel <= 6) {
                blocks.push(`<h${headerLevel}${align}>${lineHtml}</h${headerLevel}>`);
            } else if (attrs.blockquote) {
                blocks.push(`<blockquote${align}>${lineHtml}</blockquote>`);
            } else {
                blocks.push(`<p${align}>${lineHtml}</p>`);
            }
        }

        flushList();
        return blocks.length ? blocks.join("") : `<p style="margin:0;color:var(--color-text-secondary);">${wt('s1.theory_empty_content', 'Контент теории пока недоступен.')}</p>`;
    }

    async function openS1TheoryViewer(complexName, theoryIds, options = {}) {
        const rawIds = Array.isArray(theoryIds) ? theoryIds : [theoryIds];
        const ids = rawIds.map((id) => String(id || "").trim()).filter(Boolean);
        const embeddedItems = Array.isArray(options?.embeddedTheoryItems) ? options.embeddedTheoryItems : [];
        const singleEmbedded = options?.embeddedTheoryItem || null;

        const existing = document.getElementById("complex-theory-viewer-dialog");
        if (existing) existing.remove();

        const loadedTheories = [];
        if (singleEmbedded) {
            loadedTheories.push(singleEmbedded);
        } else {
            for (const id of ids) {
                const found = embeddedItems.find((item) => String(item.theoryId || item.id || "").trim() === id);
                if (found) {
                    loadedTheories.push(found);
                    continue;
                }
                try {
                    const resp = await fetch(`/api/theories/${encodeURIComponent(id)}`);
                    const data = await resp.json();
                    if (resp.ok && data?.ok && data?.item) {
                        loadedTheories.push(data.item);
                    }
                } catch (e) {
                    console.warn("Failed to fetch theory", id, e);
                }
            }
        }

        if (!loadedTheories.length) {
            showStatus(wt('s1.err_theory_not_found', 'Не удалось загрузить данные теории'), 'error');
            return;
        }

        const isComposite = loadedTheories.length > 1;
        let activeIndex = 0;

        const dialog = document.createElement("dialog");
        dialog.id = "complex-theory-viewer-dialog";
        dialog.className = "fixed inset-0 z-[1300] m-auto flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-2xl backdrop:bg-scrim-weak dark:backdrop:bg-scrim backdrop:backdrop-blur-sm p-0";

        const renderContent = () => {
            const currentTheory = loadedTheories[activeIndex] || loadedTheories[0];
            const deltaHtml = renderTheoryDeltaHtml(currentTheory.delta);
            const theoryTitle = currentTheory.title || wt('s1.theory_label', 'Теория');

            const tabsHtml = isComposite
                ? `
                    <div class="flex items-center gap-2 border-b border-border-strong bg-surface-2 px-6 py-2.5 overflow-x-auto">
                        <span class="text-xs font-bold uppercase tracking-wider text-text-secondary mr-1">${wt('s1.theories_tabs_label', 'Разделы:')}</span>
                        ${loadedTheories.map((th, idx) => `
                            <button type="button" data-tab-idx="${idx}" class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${idx === activeIndex ? 'bg-primary text-primary-fg shadow-sm' : 'bg-surface-1 text-text-secondary hover:bg-surface-3 hover:text-text-main border border-border-strong'}">
                                <span class="material-symbols-outlined text-[14px]">menu_book</span>
                                <span class="truncate max-w-[160px]">${escapeHtml(th.title || `${wt('s1.tab_prefix', 'Теория')} ${idx + 1}`)}</span>
                            </button>
                        `).join('')}
                    </div>
                `
                : '';

            dialog.innerHTML = `
                <div class="flex items-start justify-between gap-4 border-b border-border-strong bg-surface-2 px-6 py-4 flex-shrink-0">
                    <div class="min-w-0 space-y-1">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-[20px] text-primary">menu_book</span>
                            <h3 class="text-lg font-bold text-text-main truncate">${escapeHtml(theoryTitle)}</h3>
                        </div>
                        ${complexName ? `<p class="text-xs font-medium text-text-secondary truncate">${escapeHtml(complexName)}</p>` : ''}
                    </div>
                    <button type="button" data-action="close" class="inline-flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-3 hover:text-text-main transition-colors flex-shrink-0" aria-label="${wt('s1.close_btn', 'Закрыть')}">
                        <span class="material-symbols-outlined">close</span>
                    </button>
                </div>
                ${tabsHtml}
                <div class="flex-1 overflow-y-auto p-6 space-y-4">
                    <div class="theory-rendered-view mx-auto w-full max-w-4xl leading-relaxed text-text-main text-[0.95rem]">${deltaHtml}</div>
                </div>
                <div class="flex items-center justify-end border-t border-border-strong bg-surface-1 px-6 py-3 flex-shrink-0">
                    <button type="button" data-action="close" class="inline-flex items-center justify-center rounded-lg border-2 border-border-strong bg-surface-2 hover:bg-surface-3 px-4 py-2 text-xs font-semibold text-text-main transition-all s1-btn">
                        <span>${wt('s1.close_btn', 'Закрыть')}</span>
                    </button>
                </div>
            `;

            dialog.querySelectorAll('[data-action="close"]').forEach((btn) => {
                btn.addEventListener("click", () => close());
            });

            if (isComposite) {
                dialog.querySelectorAll('[data-tab-idx]').forEach((btn) => {
                    btn.addEventListener("click", () => {
                        const idx = Number(btn.getAttribute("data-tab-idx"));
                        if (!Number.isNaN(idx) && idx !== activeIndex) {
                            activeIndex = idx;
                            renderContent();
                        }
                    });
                });
            }
        };

        const close = () => {
            dialog.close();
            dialog.remove();
        };

        dialog.addEventListener("click", (e) => {
            if (e.target === dialog) close();
        });

        dialog.addEventListener("cancel", (e) => {
            e.preventDefault();
            close();
        });

        document.body.appendChild(dialog);
        renderContent();
        dialog.showModal();
    }

    function syncTheoryButtonState(task) {
        const theoryBtn = document.getElementById('s1-theory-btn');
        if (!theoryBtn) return;

        const effectiveTask = task || state.currentTask;
        if (task) {
            state.currentTask = task;
            if (typeof window !== 'undefined' && window.SessionState) {
                window.SessionState.currentTask = task;
            }
        }
        const currentIteration = Number(effectiveTask?.iteration) || 1;
        const theoryCtx = state.theoryContext || (typeof window !== 'undefined' && window.SessionState && window.SessionState.theoryContext);
        const hasTheory = !!(theoryCtx && (theoryCtx.theoryId || (theoryCtx.theoryIds && theoryCtx.theoryIds.length)));

        // Theory is accessible on 1st iteration only; blocked on iterations 2 and 3!
        if (currentIteration === 1 && hasTheory) {
            theoryBtn.classList.remove('hidden');
            theoryBtn.onclick = () => {
                const ids = theoryCtx.theoryIds || [theoryCtx.theoryId];
                openS1TheoryViewer(theoryCtx.complexTitle, ids);
            };
        } else {
            theoryBtn.classList.add('hidden');
            theoryBtn.onclick = null;
            const openDialog = document.getElementById('complex-theory-viewer-dialog');
            if (openDialog) {
                openDialog.close();
                openDialog.remove();
            }
        }
    }

    function renderTheorySessionContext(context) {
        state.theoryContext = context;
        if (typeof window !== 'undefined' && window.SessionState) {
            window.SessionState.theoryContext = context;
        }
        syncTheoryButtonState(state.currentTask);
    }

    async function resolveTheorySessionContext(taskPayload) {
        const sessionId = String(state.sessionId || '').trim();
        const bridgeContext = loadTheoryBridgeContext(sessionId);
        if (bridgeContext && (bridgeContext.theoryId || bridgeContext.theoryIds)) {
            return bridgeContext;
        }

        const complexId = String(taskPayload?.complex_id || '').trim();
        if (!complexId) return null;

        try {
            const response = await fetch(`/api/complexes/${encodeURIComponent(complexId)}`);
            const data = await response.json();
            if (!response.ok || !data?.ok || !data?.item) return null;

            const item = data.item;
            const theoryLink = (item && typeof item.theory_link === 'object') ? item.theory_link : null;

            let theoryIds = [];
            if (Array.isArray(item.theories) && item.theories.length) {
                theoryIds = item.theories.map((t) => typeof t === 'object' ? String(t.id || t.theory_id || '').trim() : String(t || '').trim()).filter(Boolean);
            } else if (Array.isArray(item.theory_ids) && item.theory_ids.length) {
                theoryIds = item.theory_ids.map((id) => String(id || '').trim()).filter(Boolean);
            } else if (theoryLink && Array.isArray(theoryLink.theory_ids)) {
                theoryIds = theoryLink.theory_ids.map((id) => String(id || '').trim()).filter(Boolean);
            }

            const singleTheoryId = String(theoryLink?.theory_id || item.theory_id || (theoryIds[0] || '')).trim();
            if (!singleTheoryId && !theoryIds.length) return null;

            return {
                theoryId: singleTheoryId,
                theoryIds: theoryIds.length ? theoryIds : [singleTheoryId],
                theoryTitle: String(theoryLink?.title_cache || item.theory_title || '').trim() || singleTheoryId,
                complexId,
                complexTitle: String(item?.name || item?.title || '').trim() || complexId,
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
            showStatus(wt('s1.loading_task', 'Загружаем текущее задание...'));
            const hadRenderedTask = !!state.currentTask;
            const pendingUnloadPauseRestore =
                typeof consumePendingUnloadPauseMarker === 'function'
                    ? consumePendingUnloadPauseMarker(sessionId)
                    : false;
            let { status, data } = await api.getCurrentTask(sessionId);

            if (status === 404) {
                showStatus(wt('s1.err_session_not_found', 'Сессия не найдена'), 'error');
                setTimeout(() => {
                    window.navigateWithTransition('/main');
                }, 2000);
                renderTask(null);
                syncCheckButtonState();
                return;
            }

            if (status === 410) {
                showStatus(wt('s1.session_completed', 'Сессия завершена'), 'success');
                setTimeout(() => {
                    navigateWithoutPrompt(SessionRoutes.SESSION_RESULTS(sessionId));
                }, 1000);
                renderTask(null);
                syncCheckButtonState();
                return;
            }

            if (
                pendingUnloadPauseRestore &&
                status === 200 &&
                data &&
                data.ok === true &&
                data.paused === true
            ) {
                try {
                    const resumeResponse = await api.resumeSession(sessionId, {
                        source: 's1_reload_restore',
                    });
                    if (resumeResponse.status === 200 && resumeResponse.data && resumeResponse.data.ok === true) {
                        const refreshedTask = await api.getCurrentTask(sessionId);
                        status = refreshedTask.status;
                        data = refreshedTask.data;
                    }
                } catch (resumeError) {
                    console.warn('Failed to auto-resume same-tab reload state', resumeError);
                }
            }

            const response = data;
            if (!response.ok) {
                showStatus(response.error || wt('s1.err_load_task', 'Не удалось загрузить задание'), 'error');
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

            const restoredEvaluationResult =
                response.task && response.task.restored_evaluation_result && typeof response.task.restored_evaluation_result === 'object'
                    ? response.task.restored_evaluation_result
                    : null;
            const restoredUserInput =
                response.task && response.task.restored_user_input && typeof response.task.restored_user_input === 'object'
                    ? response.task.restored_user_input
                    : null;
            const restoredViewState =
                response.task && response.task.restored_view_state && typeof response.task.restored_view_state === 'object'
                    ? response.task.restored_view_state
                    : null;

            if (restoredEvaluationResult) {
                showStatus(
                    '\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438',
                    'info',
                    { dismissible: true, autoHideMs: 8000 }
                );
            } else if (restoredUserInput) {
                showStatus(
                    '\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442',
                    'info',
                    { dismissible: true, autoHideMs: 8000 }
                );
            } else {
                showStatus('');
            }

            const theoryContext = await resolveTheorySessionContext(response.task);
            renderTheorySessionContext(theoryContext);
            if (typeof resetUiStateAutosaveTracking === 'function') {
                resetUiStateAutosaveTracking();
            }
            renderTask(response.task);
            const effectiveTaskType =
                typeof pickEffectiveTaskType === 'function'
                    ? pickEffectiveTaskType(response.task)
                    : null;

            if (
                restoredUserInput &&
                typeof restoreDraftToUI === 'function' &&
                effectiveTaskType
            ) {
                restoreDraftToUI(effectiveTaskType, restoredUserInput);
            }

            if (restoredEvaluationResult && typeof restoreCheckedTaskState === 'function') {
                restoreCheckedTaskState(response.task, restoredEvaluationResult);
                const pendingUserJudgement = !!(
                    restoredEvaluationResult.details &&
                    typeof restoredEvaluationResult.details === 'object' &&
                    restoredEvaluationResult.details.requires_user_judgement === true
                );
                setCanGoNext(!pendingUserJudgement);
            }

            if (
                restoredViewState &&
                typeof restoreViewStateToUI === 'function' &&
                effectiveTaskType
            ) {
                restoreViewStateToUI(effectiveTaskType, restoredViewState);
            }

            syncCheckButtonState();
        } catch (err) {
            console.error(err);
            renderTheorySessionContext(null);
            if (typeof showRetryOption === 'function') {
                showRetryOption(loadInitialTask);
            } else {
                showStatus(wt('s1.err_load_task_retry', 'Не удалось загрузить задание. Попробуйте снова'), 'error');
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
        if (typeof window !== 'undefined') {
            window.handleSubmitAnswer = handleSubmitAnswer;
            window.handleUserJudgementChoice = handleUserJudgementChoice;
        }

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
                if (typeof navigateWithoutPrompt === 'function') {
                    navigateWithoutPrompt(SessionRoutes.COMPLEXES || '/complexes');
                    return;
                }
                window.navigateWithTransition(SessionRoutes.COMPLEXES || '/complexes');
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

        if (typeof initUiStateAutosave === 'function') {
            initUiStateAutosave();
        }

        if (typeof window !== 'undefined') {
            window.syncTheoryButtonState = syncTheoryButtonState;
            window.renderTheorySessionContext = renderTheorySessionContext;
            window.addEventListener('i18n:changed', () => {
                if (window.i18n) window.i18n.updateDOM();
                syncTheoryButtonState(state.currentTask);
            });
        }

        loadInitialTask();
    }

    return {
        init,
        loadInitialTask,
        getSessionIdFromLocation,
        syncTheoryButtonState,
        renderTheorySessionContext,
        openS1TheoryViewer
    };

}));
