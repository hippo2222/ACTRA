/**
 * Task Import Studio — Frontend Controller
 * Complete 3-stage interactive studio for lecture analysis and task creation.
 */

(function () {
    'use strict';

    // ---------------------------------------------------------------------------
    // 1. Studio State
    // ---------------------------------------------------------------------------

    const StudioState = {
        currentStep: 1,
        selectedModuleId: '',
        selectedTopicId: '',
        selectedModuleName: '',
        selectedTopicName: '',
        catalogModules: [],

        materialText: '',
        fileInfo: null,

        analysisRawResponse: '',
        analysisResult: null,

        activeGenerationType: 'TEST',
        typeDrafts: {}, // { [taskType]: { responseText: '', parsedTasks: [], isCommitted: false } }
        allTasks: [], // Accumulated tasks across all types

        cachedPrompts: {
            analysis: '',
            generation: {},
        },

        targetLanguage: '', // initialized to user's UI language on boot ('ru' | 'en' | 'uk' | 'source')
        hasExplicitTargetLanguage: false,

        sessionId: 'sess_' + Math.random().toString(36).substring(2, 11),
        isDirty: false,
        pendingNavUrl: null,
    };

    function t(key, fallback = '') {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const val = window.i18n.t(key);
            if (val && val !== key) return val;
        }
        return fallback;
    }

    function getTaskTypeLabel(taskType) {
        const labels = {
            TEST: t('editor_base.task_type.test', 'Тест'),
            OPEN_ANSWER: t('editor_base.task_type.open_answer', 'Открытый ответ'),
            SEQUENCE: t('editor_base.task_type.sequence', 'Последовательность'),
            CLICK_TEXT: t('editor_base.task_type.click_text', 'Клик / Текст'),
            CLICK_WORDS: t('editor_base.task_type.click_words', 'Клик / Ошибки'),
            CLICK: t('editor_base.task_type.click', 'Клик по изображению'),
            DRAW: t('editor_base.task_type.draw', 'Рисование'),
        };
        return labels[taskType] || taskType;
    }

    const TASK_TYPE_LABELS = new Proxy({}, {
        get(_, prop) {
            return getTaskTypeLabel(prop);
        },
    });

    const AUTOSAVE_KEY_PREFIX = 'actra_ai_studio_draft_v1_';

    // ---------------------------------------------------------------------------
    // 2. DOM Elements Cache
    // ---------------------------------------------------------------------------

    let DOM = {};

    function initDOM() {
        DOM = {
            // Toolbar & Nav
            btnBackDashboard: document.getElementById('btn-back-dashboard'),
            breadcrumbModule: document.getElementById('breadcrumb-module'),
            breadcrumbTopic: document.getElementById('breadcrumb-topic'),
            btnSelectTopic: document.getElementById('btn-select-topic'),
            labelSelectedTopic: document.getElementById('label-selected-topic'),
            autosaveStatusDot: document.getElementById('autosave-status-dot'),
            autosaveStatusText: document.getElementById('autosave-status-text'),
            btnOpenHistory: document.getElementById('btn-open-history'),
            historyCountBadge: document.getElementById('history-count-badge'),

            // Stepper
            stepNode1: document.getElementById('step-node-1'),
            stepNode2: document.getElementById('step-node-2'),
            stepNode3: document.getElementById('step-node-3'),

            // Stages
            stage1: document.getElementById('stage-1'),
            stage2: document.getElementById('stage-2'),
            stage3: document.getElementById('stage-3'),

            // Stage 1
            targetLangGroup: document.getElementById('studio-target-lang-group'),
            btnCopySystemPrompt: document.getElementById('btn-copy-system-prompt'),
            btnCopyAnalysisPrompt: document.getElementById('btn-copy-analysis-prompt'),
            analysisPromptPreviewText: document.getElementById('analysis-prompt-preview-text'),
            analysisResponseInput: document.getElementById('analysis-response-input'),
            btnParseAnalysis: document.getElementById('btn-parse-analysis'),
            lessonMapContainer: document.getElementById('lesson-map-container'),
            lessonMapSummary: document.getElementById('lesson-map-summary'),
            lessonMapRecommendations: document.getElementById('lesson-map-recommendations'),
            btnProceedToStep2: document.getElementById('btn-proceed-to-step-2'),

            // Stage 2
            btnBackToStep1: document.getElementById('btn-back-to-step-1'),
            typesTabsContainer: document.getElementById('types-tabs-container'),
            btnAddExtraType: document.getElementById('btnAddExtraType') || document.getElementById('btn-add-extra-type'),
            focusPaneTypeLabel: document.getElementById('focus-pane-type-label'),
            focusPaneCoverageBadge: document.getElementById('focus-pane-coverage-badge'),
            focusUnitsDescription: document.getElementById('focus-units-description'),
            btnCopyTypePrompt: document.getElementById('btn-copy-type-prompt'),
            labelCopyTypePrompt: document.getElementById('label-copy-type-prompt'),
            typePromptPreviewText: document.getElementById('type-prompt-preview-text'),
            typeResponseInput: document.getElementById('type-response-input'),
            liveParseCounter: document.getElementById('live-parse-counter'),
            liveParseCountText: document.getElementById('live-parse-count-text'),
            btnCommitTypeTasks: document.getElementById('btn-commit-type-tasks'),
            btnProceedToStep3: document.getElementById('btn-proceed-to-step-3'),

            // Stage 3
            showcaseSelectAll: document.getElementById('showcase-select-all'),
            showcaseTotalCount: document.getElementById('showcase-total-count'),
            showcaseFilterPills: document.getElementById('showcase-filter-pills'),
            showcaseCardsGrid: document.getElementById('showcase-cards-grid'),
            btnBackToStep2: document.getElementById('btn-back-to-step-2'),
            stickyBarSummary: document.getElementById('sticky-bar-summary'),
            stickyBarTopicTarget: document.getElementById('sticky-bar-topic-target'),
            btnExecuteImport: document.getElementById('btn-execute-import'),

            // Modals
            modalTopicSelector: document.getElementById('modal-topic-selector'),
            btnCloseTopicModal: document.getElementById('btn-close-topic-modal'),
            topicSearchInput: document.getElementById('topic-search-input'),
            topicTreeContainer: document.getElementById('topic-tree-container'),

            modalSessionHistory: document.getElementById('modal-session-history'),
            btnCloseHistoryModal: document.getElementById('btn-close-history-modal'),
            historyItemsContainer: document.getElementById('history-items-container'),

            modalNavGuard: document.getElementById('modal-nav-guard'),
            btnGuardStay: document.getElementById('btn-guard-stay'),
            btnGuardLeave: document.getElementById('btn-guard-leave'),

            // Reset / Discard Draft
            btnResetDraft: document.getElementById('btn-reset-draft'),
            modalResetDraft: document.getElementById('modal-reset-draft'),
            btnResetCancel: document.getElementById('btn-reset-cancel'),
            btnResetConfirm: document.getElementById('btn-reset-confirm'),
        };
    }

    // ---------------------------------------------------------------------------
    // 3. Data Protection & Autosave
    // ---------------------------------------------------------------------------

    let autosaveTimer = null;

    function markDirty() {
        StudioState.isDirty = true;
        if (DOM.autosaveStatusDot) {
            DOM.autosaveStatusDot.className = 'studio-status-dot studio-status-dot--unsaved';
        }
        if (DOM.autosaveStatusText) {
            DOM.autosaveStatusText.textContent = t('studio.autosave.unsaved', 'Есть несохранённые изменения');
        }
        scheduleAutosave();
    }

    function markSaved() {
        if (DOM.autosaveStatusDot) {
            DOM.autosaveStatusDot.className = 'studio-status-dot';
        }
        if (DOM.autosaveStatusText) {
            const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const savedLabel = t('studio.autosave.saved', 'Черновик сохранён');
            DOM.autosaveStatusText.textContent = `${savedLabel} (${time})`;
        }
    }

    function scheduleAutosave() {
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(saveDraftToLocalStorage, 400);
    }

    function saveDraftToLocalStorage() {
        try {
            const payload = {
                sessionId: StudioState.sessionId,
                currentStep: StudioState.currentStep,
                selectedModuleId: StudioState.selectedModuleId,
                selectedTopicId: StudioState.selectedTopicId,
                selectedModuleName: StudioState.selectedModuleName,
                selectedTopicName: StudioState.selectedTopicName,
                materialText: StudioState.materialText,
                fileInfo: StudioState.fileInfo,
                analysisRawResponse: StudioState.analysisRawResponse,
                analysisResult: StudioState.analysisResult,
                activeGenerationType: StudioState.activeGenerationType,
                targetLanguage: StudioState.targetLanguage,
                typeDrafts: StudioState.typeDrafts,
                allTasks: StudioState.allTasks,
                savedAt: new Date().toISOString(),
            };
            localStorage.setItem(AUTOSAVE_KEY_PREFIX + 'current', JSON.stringify(payload));
            markSaved();
        } catch (e) {
            console.warn('[Studio] Failed to autosave draft to localStorage:', e);
        }
    }

    function restoreDraftFromLocalStorage() {
        try {
            const raw = localStorage.getItem(AUTOSAVE_KEY_PREFIX + 'current');
            if (!raw) return false;
            const draft = JSON.parse(raw);
            if (!draft || typeof draft !== 'object') return false;

            if (draft.materialText || (draft.allTasks && draft.allTasks.length > 0) || draft.targetLanguage) {
                StudioState.sessionId = draft.sessionId || StudioState.sessionId;
                StudioState.materialText = draft.materialText || '';
                StudioState.fileInfo = draft.fileInfo || null;
                StudioState.analysisRawResponse = draft.analysisRawResponse || '';
                StudioState.analysisResult = draft.analysisResult || null;
                StudioState.activeGenerationType = draft.activeGenerationType || 'TEST';
                if (draft.targetLanguage) {
                    const restoredLang = draft.targetLanguage === 'auto' ? 'source' : draft.targetLanguage;
                    setTargetLanguage(restoredLang, true);
                } else {
                    setTargetLanguage(getDefaultTargetLanguage(), false);
                }
                StudioState.typeDrafts = draft.typeDrafts || {};
                StudioState.allTasks = draft.allTasks || [];

                if (!StudioState.selectedTopicId && draft.selectedTopicId) {
                    StudioState.selectedModuleId = draft.selectedModuleId || '';
                    StudioState.selectedTopicId = draft.selectedTopicId || '';
                    StudioState.selectedModuleName = draft.selectedModuleName || '';
                    StudioState.selectedTopicName = draft.selectedTopicName || '';
                }

                // Hydrate UI inputs
                if (DOM.analysisResponseInput) DOM.analysisResponseInput.value = StudioState.analysisRawResponse;

                if (StudioState.analysisResult) {
                    renderLessonMap(StudioState.analysisResult);
                    if (DOM.btnProceedToStep2) DOM.btnProceedToStep2.disabled = false;
                }

                if (draft.currentStep && draft.currentStep > 1) {
                    switchStep(draft.currentStep);
                }

                updateProceedToStep3Button();
                markSaved();
                return true;
            }
        } catch (e) {
            console.warn('[Studio] Failed to restore draft:', e);
        }
        return false;
    }

    function clearLocalStorageDraft() {
        try {
            localStorage.removeItem(AUTOSAVE_KEY_PREFIX + 'current');
            StudioState.isDirty = false;
            markSaved();
        } catch (e) {
            // ignore
        }
    }

    // ---------------------------------------------------------------------------
    // 4. Stepper & Navigation Guard
    // ---------------------------------------------------------------------------

    function switchStep(stepNumber) {
        if (stepNumber === StudioState.currentStep) return;

        // Topic gate when moving from Step 1 to Step 2
        if (stepNumber >= 2 && !StudioState.selectedTopicId) {
            openTopicModal();
            showToast('Пожалуйста, выберите тему курса для добавления заданий', 'warning');
            return;
        }

        StudioState.currentStep = stepNumber;

        // Update Stepper Nodes
        [DOM.stepNode1, DOM.stepNode2, DOM.stepNode3].forEach((node, idx) => {
            if (!node) return;
            const nodeStep = idx + 1;
            node.setAttribute('data-active', nodeStep === stepNumber ? 'true' : 'false');
            node.setAttribute('data-completed', nodeStep < stepNumber ? 'true' : 'false');
            node.setAttribute('aria-current', nodeStep === stepNumber ? 'step' : 'false');
        });

        // Update Stage Visibility
        if (DOM.stage1) DOM.stage1.setAttribute('data-active', stepNumber === 1 ? 'true' : 'false');
        if (DOM.stage2) DOM.stage2.setAttribute('data-active', stepNumber === 2 ? 'true' : 'false');
        if (DOM.stage3) DOM.stage3.setAttribute('data-active', stepNumber === 3 ? 'true' : 'false');

        if (stepNumber === 2) {
            setupStage2();
        } else if (stepNumber === 3) {
            setupStage3();
        }

        scheduleAutosave();
    }

    function initStepper() {
        if (DOM.stepNode1) {
            DOM.stepNode1.addEventListener('click', () => {
                if (StudioState.currentStep === 1) return;
                switchStep(1);
            });
        }

        if (DOM.stepNode2) {
            DOM.stepNode2.addEventListener('click', () => {
                if (StudioState.currentStep === 2) return;
                if (StudioState.currentStep === 1 && !StudioState.analysisResult) {
                    showToast(t('studio.stage1.no_response_error', 'Сначала выполните анализ материала'), 'warning');
                    return;
                }
                switchStep(2);
            });
        }

        if (DOM.stepNode3) {
            DOM.stepNode3.addEventListener('click', () => {
                if (StudioState.currentStep === 3) return;
                if (StudioState.currentStep === 1 && !StudioState.analysisResult && StudioState.allTasks.length === 0) {
                    showToast(t('studio.stage1.no_response_error', 'Сначала выполните анализ материала'), 'warning');
                    return;
                }
                switchStep(3);
            });
        }
    }

    function initNavigationGuard() {
        window.addEventListener('beforeunload', (e) => {
            if (StudioState.isDirty && StudioState.allTasks.length > 0) {
                e.preventDefault();
                e.returnValue = '';
            }
        });

        document.body.addEventListener('click', (e) => {
            const anchor = e.target.closest('a');
            if (anchor && anchor.href && !anchor.href.includes('#') && !anchor.target) {
                if (StudioState.isDirty && StudioState.allTasks.length > 0) {
                    const targetUrl = anchor.href;
                    if (targetUrl !== window.location.href) {
                        e.preventDefault();
                        StudioState.pendingNavUrl = targetUrl;
                        openNavGuardModal();
                    }
                }
            }
        });

        if (DOM.btnGuardStay) {
            DOM.btnGuardStay.addEventListener('click', () => {
                closeNavGuardModal();
                StudioState.pendingNavUrl = null;
            });
        }

        if (DOM.btnGuardLeave) {
            DOM.btnGuardLeave.addEventListener('click', () => {
                StudioState.isDirty = false;
                closeNavGuardModal();
                if (StudioState.pendingNavUrl) {
                    window.location.href = StudioState.pendingNavUrl;
                }
            });
        }

        if (DOM.modalNavGuard) {
            DOM.modalNavGuard.addEventListener('click', (e) => {
                if (e.target === DOM.modalNavGuard) {
                    closeNavGuardModal();
                    StudioState.pendingNavUrl = null;
                }
            });
        }
    }

    function openNavGuardModal() {
        if (DOM.modalNavGuard) DOM.modalNavGuard.classList.remove('hidden');
    }

    function closeNavGuardModal() {
        if (DOM.modalNavGuard) DOM.modalNavGuard.classList.add('hidden');
    }

    // ---------------------------------------------------------------------------
    // Reset & Discard Draft
    // ---------------------------------------------------------------------------

    function openResetModal() {
        if (DOM.modalResetDraft) DOM.modalResetDraft.classList.remove('hidden');
    }

    function closeResetModal() {
        if (DOM.modalResetDraft) DOM.modalResetDraft.classList.add('hidden');
    }

    function isDraftEmpty() {
        const hasMaterial = Boolean(StudioState.materialText && StudioState.materialText.trim());
        const hasAnalysisRaw = Boolean((DOM.analysisResponseInput ? DOM.analysisResponseInput.value : StudioState.analysisRawResponse || '').trim());
        const hasAnalysisResult = Boolean(StudioState.analysisResult);
        const hasTasks = Boolean(StudioState.allTasks && StudioState.allTasks.length > 0);
        const hasTypeDrafts = Object.values(StudioState.typeDrafts || {}).some(
            (d) => d && ((d.responseText && d.responseText.trim()) || (d.parsedTasks && d.parsedTasks.length > 0))
        );
        const hasTypeInput = Boolean(DOM.typeResponseInput && DOM.typeResponseInput.value.trim());
        return !hasMaterial && !hasAnalysisRaw && !hasAnalysisResult && !hasTasks && !hasTypeDrafts && !hasTypeInput;
    }

    function resetStudioState() {
        // Clear autosave timer first to avoid saving stale data
        clearTimeout(autosaveTimer);

        // 1. Reset state
        StudioState.materialText = '';
        StudioState.fileInfo = null;
        StudioState.analysisRawResponse = '';
        StudioState.analysisResult = null;
        StudioState.activeGenerationType = 'TEST';
        StudioState.typeDrafts = {};
        StudioState.allTasks = [];
        StudioState.cachedPrompts = { analysis: '', generation: {} };
        StudioState.isDirty = false;

        // 2. Clear localStorage
        clearLocalStorageDraft();

        // 3. Clear Stage 1 UI
        if (DOM.analysisResponseInput) {
            DOM.analysisResponseInput.value = '';
        }
        if (DOM.lessonMapContainer) {
            DOM.lessonMapContainer.classList.add('hidden');
        }
        if (DOM.lessonMapSummary) {
            DOM.lessonMapSummary.textContent = '';
        }
        if (DOM.lessonMapRecommendations) {
            DOM.lessonMapRecommendations.innerHTML = '';
        }
        if (DOM.btnProceedToStep2) {
            DOM.btnProceedToStep2.disabled = true;
        }

        // 4. Clear Stage 2 UI
        if (DOM.typeResponseInput) {
            DOM.typeResponseInput.value = '';
        }
        if (DOM.liveParseCounter) {
            DOM.liveParseCounter.classList.add('hidden');
        }
        if (DOM.btnCommitTypeTasks) {
            DOM.btnCommitTypeTasks.disabled = true;
        }
        if (DOM.typesTabsContainer) {
            DOM.typesTabsContainer.innerHTML = '';
        }

        // 5. Clear Stage 3 UI
        if (DOM.showcaseCardsGrid) {
            DOM.showcaseCardsGrid.innerHTML = '';
        }
        if (DOM.showcaseTotalCount) {
            DOM.showcaseTotalCount.textContent = '0';
        }
        if (DOM.btnExecuteImport) {
            DOM.btnExecuteImport.disabled = true;
        }

        // 6. Navigate back to Step 1
        if (StudioState.currentStep !== 1) {
            switchStep(1);
        } else {
            [DOM.stepNode1, DOM.stepNode2, DOM.stepNode3].forEach((node, idx) => {
                if (!node) return;
                const nodeStep = idx + 1;
                node.setAttribute('data-active', nodeStep === 1 ? 'true' : 'false');
                node.setAttribute('data-completed', 'false');
                node.setAttribute('aria-current', nodeStep === 1 ? 'step' : 'false');
            });
            if (DOM.stage1) DOM.stage1.classList.remove('hidden');
            if (DOM.stage2) DOM.stage2.classList.add('hidden');
            if (DOM.stage3) DOM.stage3.classList.add('hidden');
        }

        // Cancel any autosave triggered by switchStep
        clearTimeout(autosaveTimer);
        clearLocalStorageDraft();

        // 7. Refresh previews and indicators
        loadAnalysisPrompt();
        updateProceedToStep3Button();
        updateStickyBar();
        markSaved();
    }

    function initResetDraft() {
        if (DOM.btnResetDraft) {
            DOM.btnResetDraft.addEventListener('click', () => {
                if (isDraftEmpty()) {
                    showToast(t('studio.modal.reset_empty_toast', 'Черновик уже пуст'), 'info');
                    return;
                }
                openResetModal();
            });
        }

        if (DOM.btnResetCancel) {
            DOM.btnResetCancel.addEventListener('click', closeResetModal);
        }

        if (DOM.btnResetConfirm) {
            DOM.btnResetConfirm.addEventListener('click', () => {
                resetStudioState();
                closeResetModal();
                showToast(t('studio.modal.reset_toast', 'Черновик и анализ успешно сброшены'), 'success');
            });
        }

        if (DOM.modalResetDraft) {
            DOM.modalResetDraft.addEventListener('click', (e) => {
                if (e.target === DOM.modalResetDraft) {
                    closeResetModal();
                }
            });
        }
    }

    // ---------------------------------------------------------------------------
    // 5. Catalog & Topic Selector
    // ---------------------------------------------------------------------------

    async function loadCatalog() {
        try {
            const res = await fetch('/api/editor/catalog');
            if (!res.ok) return;
            const data = await res.json();
            if (data.ok && Array.isArray(data.modules)) {
                StudioState.catalogModules = data.modules;
                resolveTopicFromUrlOrCatalog();
                renderTopicTree();
            }
        } catch (e) {
            console.warn('[Studio] Failed to load catalog:', e);
        }
    }

    function resolveTopicFromUrlOrCatalog() {
        const params = new URLSearchParams(window.location.search);
        const urlModule = params.get('module');
        const urlTopic = params.get('topic');

        if (urlModule && urlTopic) {
            for (const mod of StudioState.catalogModules) {
                if (mod.id === urlModule) {
                    StudioState.selectedModuleId = mod.id;
                    StudioState.selectedModuleName = mod.name || mod.title || mod.id;
                    if (Array.isArray(mod.topics)) {
                        for (const top of mod.topics) {
                            if (top.id === urlTopic) {
                                StudioState.selectedTopicId = top.id;
                                StudioState.selectedTopicName = top.name || top.title || top.id;
                                break;
                            }
                        }
                    }
                    break;
                }
            }
        }

        updateTopicDisplay();
    }

    function updateTopicDisplay() {
        if (DOM.labelSelectedTopic) {
            if (StudioState.selectedTopicId) {
                DOM.labelSelectedTopic.textContent = `${StudioState.selectedModuleName} → ${StudioState.selectedTopicName}`;
                if (DOM.btnSelectTopic) {
                    DOM.btnSelectTopic.classList.remove('studio-topic-badge--empty');
                }
            } else {
                DOM.labelSelectedTopic.textContent = t('studio.topic_selector.placeholder', 'Выберите тему курса');
                if (DOM.btnSelectTopic) {
                    DOM.btnSelectTopic.classList.add('studio-topic-badge--empty');
                }
            }
        }

        if (DOM.breadcrumbModule) {
            DOM.breadcrumbModule.textContent = StudioState.selectedModuleName || t('studio.breadcrumbs.module', 'Модуль');
        }
        if (DOM.breadcrumbTopic) {
            DOM.breadcrumbTopic.textContent = StudioState.selectedTopicName || t('studio.breadcrumbs.topic', 'Тема');
        }

        if (DOM.stickyBarTopicTarget) {
            DOM.stickyBarTopicTarget.textContent = StudioState.selectedTopicId
                ? t('studio.stage3.topic_target_selected', 'Целевая тема курса: {module} / {topic}')
                    .replace('{module}', StudioState.selectedModuleName)
                    .replace('{topic}', StudioState.selectedTopicName)
                : t('studio.stage3.topic_not_selected', 'Целевая тема курса: не выбрана');
        }

        if (DOM.btnBackDashboard && StudioState.selectedModuleId && StudioState.selectedTopicId) {
            DOM.btnBackDashboard.href = `/editor?module=${encodeURIComponent(StudioState.selectedModuleId)}&topic=${encodeURIComponent(StudioState.selectedTopicId)}`;
        }
    }

    function renderTopicTree(filterText = '') {
        if (!DOM.topicTreeContainer) return;
        DOM.topicTreeContainer.innerHTML = '';

        if (!StudioState.catalogModules || StudioState.catalogModules.length === 0) {
            DOM.topicTreeContainer.innerHTML = `<p class="text-xs text-text-secondary text-center py-4">${t('studio.modal.topic_empty', 'Нет доступных модулей и тем.')}</p>`;
            return;
        }

        const q = String(filterText || '').trim().toLowerCase();
        let totalMatchingTopics = 0;

        StudioState.catalogModules.forEach((mod) => {
            const modName = mod.name || mod.title || mod.id || '';
            const modMatches = q ? modName.toLowerCase().includes(q) : true;

            const topics = Array.isArray(mod.topics) ? mod.topics : [];
            const matchingTopics = q
                ? topics.filter((top) => {
                    const topName = top.name || top.title || top.id || '';
                    return modMatches || topName.toLowerCase().includes(q);
                })
                : topics;

            if (q && !modMatches && matchingTopics.length === 0) {
                return; // Hide module if neither its title nor its topics match
            }

            totalMatchingTopics += matchingTopics.length;

            const modBox = document.createElement('div');
            modBox.className = 'flex flex-col gap-1 rounded-xl bg-surface-2 p-2.5 border border-border-subtle shrink-0';

            const modHeader = document.createElement('p');
            modHeader.className = 'text-xs font-bold text-text-secondary uppercase tracking-wider px-1';
            modHeader.textContent = modName;
            modBox.appendChild(modHeader);

            const topicsList = document.createElement('div');
            topicsList.className = 'flex flex-col gap-1';

            if (matchingTopics.length > 0) {
                matchingTopics.forEach((top) => {
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'flex items-center justify-between p-2 rounded-lg text-xs font-medium text-left hover:bg-surface-1 transition-colors';
                    if (top.id === StudioState.selectedTopicId) {
                        btn.classList.add('bg-primary-light', 'text-primary', 'font-bold');
                    }

                    btn.innerHTML = `
                        <span class="truncate">${escapeHtml(top.name || top.title || top.id)}</span>
                        <span class="text-[11px] text-text-muted ml-2 shrink-0">${(top.tasks && top.tasks.length) || 0} зад.</span>
                    `;

                    btn.addEventListener('click', () => {
                        StudioState.selectedModuleId = mod.id;
                        StudioState.selectedModuleName = mod.name || mod.title || mod.id;
                        StudioState.selectedTopicId = top.id;
                        StudioState.selectedTopicName = top.name || top.title || top.id;

                        updateTopicDisplay();
                        closeTopicModal();
                        showToast(`Выбрана тема: ${StudioState.selectedTopicName}`, 'success');
                        markDirty();
                    });

                    topicsList.appendChild(btn);
                });
            } else {
                const emptyP = document.createElement('p');
                emptyP.className = 'text-[11px] text-text-muted px-2 py-1';
                emptyP.textContent = t('studio.modal.module_empty', 'Нет тем в модуле');
                topicsList.appendChild(emptyP);
            }

            modBox.appendChild(topicsList);
            DOM.topicTreeContainer.appendChild(modBox);
        });

        if (q && totalMatchingTopics === 0) {
            DOM.topicTreeContainer.innerHTML = `
                <div class="flex flex-col items-center justify-center py-8 text-center text-text-muted">
                    <span class="material-symbols-outlined text-[32px] mb-1 text-text-muted">search_off</span>
                    <p class="text-xs text-text-secondary">${t('studio.modal.topic_empty', 'Темы не найдены')}</p>
                </div>
            `;
        }
    }

    function openTopicModal() {
        if (DOM.topicSearchInput) {
            DOM.topicSearchInput.value = '';
        }
        renderTopicTree('');
        if (DOM.modalTopicSelector) DOM.modalTopicSelector.classList.remove('hidden');
        setTimeout(() => {
            if (DOM.topicSearchInput) DOM.topicSearchInput.focus();
        }, 80);
    }

    function closeTopicModal() {
        if (DOM.modalTopicSelector) DOM.modalTopicSelector.classList.add('hidden');
    }

    // ---------------------------------------------------------------------------
    // 6. Stage 1: Document Upload & Analysis Parser
    // ---------------------------------------------------------------------------

    function getDefaultTargetLanguage() {
        const uiLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function')
            ? window.i18n.getLang()
            : 'ru';
        return ['ru', 'en', 'uk'].includes(uiLang) ? uiLang : 'ru';
    }

    function initStage1() {
        // Pre-select default target language if not already set
        if (!StudioState.targetLanguage) {
            setTargetLanguage(getDefaultTargetLanguage(), false);
        } else {
            updateTargetLanguageUI(StudioState.targetLanguage);
        }

        // Target Language Selector
        if (DOM.targetLangGroup) {
            DOM.targetLangGroup.querySelectorAll('.studio-lang-btn').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const lang = btn.getAttribute('data-lang') || getDefaultTargetLanguage();
                    setTargetLanguage(lang, true);
                });
            });
        }

        // Copy System Prompt
        if (DOM.btnCopySystemPrompt) {
            DOM.btnCopySystemPrompt.addEventListener('click', copySystemPrompt);
        }

        // Copy Analysis Prompt
        if (DOM.btnCopyAnalysisPrompt) {
            DOM.btnCopyAnalysisPrompt.addEventListener('click', copyAnalysisPrompt);
        }

        // Parse Analysis Response
        if (DOM.btnParseAnalysis) {
            DOM.btnParseAnalysis.addEventListener('click', parseAnalysisResponse);
        }

        if (DOM.analysisResponseInput) {
            DOM.analysisResponseInput.addEventListener('input', () => {
                StudioState.analysisRawResponse = DOM.analysisResponseInput.value;
                markDirty();
            });
        }

        // Proceed to Step 2
        if (DOM.btnProceedToStep2) {
            DOM.btnProceedToStep2.addEventListener('click', () => {
                switchStep(2);
            });
        }

        // Preload analysis prompt preview
        loadAnalysisPrompt();
    }

    function updateTargetLanguageUI(lang) {
        if (DOM.targetLangGroup) {
            DOM.targetLangGroup.querySelectorAll('.studio-lang-btn').forEach((btn) => {
                const btnLang = btn.getAttribute('data-lang');
                if (btnLang === lang) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
            });
        }
    }

    function setTargetLanguage(lang, isExplicit = true) {
        if (!['ru', 'en', 'uk', 'source'].includes(lang)) {
            lang = getDefaultTargetLanguage();
        }
        StudioState.targetLanguage = lang;
        if (isExplicit) {
            StudioState.hasExplicitTargetLanguage = true;
        }

        updateTargetLanguageUI(lang);

        loadAnalysisPrompt();
        if (StudioState.currentStep === 2 && StudioState.activeGenerationType) {
            loadGenerationPromptForType(StudioState.activeGenerationType);
        }
        markDirty();
    }

    async function loadAnalysisPrompt() {
        const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
        const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
        const promptLang = (targetLang === 'source') ? 'en' : currentLang;
        const cacheKey = `${promptLang}_${targetLang}`;
        if (StudioState.cachedPrompts.analysis && StudioState.cachedPrompts.analysisCacheKey === cacheKey) {
            updateAnalysisPromptPreview(StudioState.cachedPrompts.analysis);
            return;
        }

        try {
            const res = await fetch(`/api/editor/studio/prompts?type=analysis&prompt_lang=${encodeURIComponent(promptLang)}&target_lang=${encodeURIComponent(targetLang)}`);
            if (res.ok) {
                const data = await res.json();
                StudioState.cachedPrompts.analysis = data.prompt || '';
                StudioState.cachedPrompts.analysisCacheKey = cacheKey;
                updateAnalysisPromptPreview(data.prompt || '');
            }
        } catch (e) {
            console.warn('[Studio] Failed to load analysis prompt:', e);
        }
    }

    function updateAnalysisPromptPreview(promptText) {
        if (DOM.analysisPromptPreviewText) {
            DOM.analysisPromptPreviewText.textContent = promptText || t('editor_base.lbl_loading', 'Загрузка промпта...');
        }
    }

    async function copyAnalysisPrompt() {
        try {
            const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
            const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
            const promptLang = (targetLang === 'source') ? 'en' : currentLang;
            const cacheKey = `${promptLang}_${targetLang}`;
            if (!StudioState.cachedPrompts.analysis || StudioState.cachedPrompts.analysisCacheKey !== cacheKey) {
                await loadAnalysisPrompt();
            }

            const promptText = StudioState.cachedPrompts.analysis || '';
            if (!promptText) {
                showToast(t('studio.stage1.parsing_error', 'Не удалось получить текст промпта'), 'error');
                return;
            }

            await navigator.clipboard.writeText(promptText);
            showToast(t('studio.stage1.prompt_copied', 'Промпт анализа скопирован в буфер обмена!'), 'success');
        } catch (e) {
            console.error('[Studio] Copy prompt error:', e);
            showToast(t('studio.stage1.parsing_error', 'Ошибка при копировании промпта'), 'error');
        }
    }

    async function copySystemPrompt() {
        try {
            const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
            const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
            const promptLang = (targetLang === 'source') ? 'en' : currentLang;

            const res = await fetch(`/api/editor/studio/prompts?type=system&prompt_lang=${encodeURIComponent(promptLang)}&target_lang=${encodeURIComponent(targetLang)}`);
            if (!res.ok) {
                showToast(t('studio.stage1.parsing_error', 'Не удалось получить текст системного промпта'), 'error');
                return;
            }

            const data = await res.json();
            if (!data.ok || !data.prompt) {
                showToast(t('studio.stage1.parsing_error', 'Не удалось получить текст системного промпта'), 'error');
                return;
            }

            await navigator.clipboard.writeText(data.prompt);
            showToast(t('studio.stage1.system_prompt_copied', 'Системный промпт скопирован в буфер обмена!'), 'success');
        } catch (e) {
            console.error('[Studio] Copy system prompt error:', e);
            showToast(t('studio.stage1.parsing_error', 'Ошибка при копировании системного промпта'), 'error');
        }
    }

    async function parseAnalysisResponse() {
        const raw = (DOM.analysisResponseInput ? DOM.analysisResponseInput.value : '').trim();
        if (!raw) {
            showToast('Пожалуйста, вставьте текст ответа нейросети', 'warning');
            return;
        }

        showToast('Разбор структуры материала...', 'info');

        try {
            const res = await fetch('/api/editor/import/parse-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: raw }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showToast(data.message || 'Ошибка парсинга ответа анализа', 'error');
                return;
            }

            StudioState.analysisResult = data;
            renderLessonMap(data);

            if (DOM.btnProceedToStep2) {
                DOM.btnProceedToStep2.disabled = false;
            }

            showToast('Структура материала успешно разобрана!', 'success');
            markDirty();
        } catch (e) {
            console.error('[Studio] Parse analysis error:', e);
            showToast('Сетевая ошибка при парсинге анализа', 'error');
        }
    }

    function getStrategyInfo(strategy) {
        if (!strategy) return { label: '', tooltip: '' };
        const clean = String(strategy).toLowerCase().trim();
        const fallbacks = {
            misconception_first: 'Типичные заблуждения',
            breadth_first: 'Широкий охват',
            high_risk_first: 'Критические точки',
            visual_first: 'Визуальный фокус',
            structure_first: 'Структурирование',
        };
        const label = t(`studio.strategies.${clean}`, fallbacks[clean] || strategy);
        const tooltip = t(`studio.strategies.${clean}_desc`, '');
        return { label, tooltip };
    }

    function renderLessonMap(analysis) {
        if (!DOM.lessonMapContainer) return;
        DOM.lessonMapContainer.classList.remove('hidden');

        if (DOM.lessonMapSummary) {
            DOM.lessonMapSummary.textContent = analysis.human_summary || t('studio.stage1.no_summary', 'Резюме не предоставлено.');
        }

        if (DOM.lessonMapRecommendations) {
            DOM.lessonMapRecommendations.innerHTML = '';
            const recs = analysis.recommendations || [];

            if (recs.length === 0) {
                DOM.lessonMapRecommendations.innerHTML = `<p class="text-xs text-text-muted">${t('studio.stage1.no_recommendations', 'Рекомендации не сформированы.')}</p>`;
            } else {
                recs.forEach((rec) => {
                    const card = document.createElement('div');
                    card.className = 'studio-unit-card';

                    const typeName = rec.task_type || 'TEST';
                    const isManual = rec.manual_only || typeName === 'CLICK' || typeName === 'DRAW';
                    const stratInfo = getStrategyInfo(rec.coverage_strategy);

                    card.innerHTML = `
                        <div class="flex items-center justify-between gap-2">
                            <span class="text-xs font-bold text-text-main">${TASK_TYPE_LABELS[typeName] || typeName}</span>
                            <div class="flex items-center gap-1">
                                ${stratInfo.label ? `<span class="studio-unit-badge bg-surface-2 text-text-secondary border border-border-subtle" title="${escapeHtml(stratInfo.tooltip)}">${escapeHtml(stratInfo.label)}</span>` : ''}
                                <span class="studio-unit-badge ${isManual ? 'bg-warning-light text-warning-dark' : 'bg-primary-light text-primary'}">
                                    ${isManual ? t('studio.labels.manual_only', 'Ручное создание') : `${t('studio.labels.recommended', 'Рекомендовано')} (~${rec.count || 2})`}
                                </span>
                            </div>
                        </div>
                        <p class="text-[11px] text-text-secondary leading-relaxed">${escapeHtml(rec.rationale || rec.generation_focus || '')}</p>
                    `;

                    DOM.lessonMapRecommendations.appendChild(card);
                });
            }
        }
    }

    // ---------------------------------------------------------------------------
    // 7. Stage 2: Zero-Scroll Split-View Task Generation
    // ---------------------------------------------------------------------------

    let liveParseDebounceTimer = null;

    function updateProceedToStep3Button() {
        if (!DOM.btnProceedToStep3) return;
        const count = (StudioState.allTasks || []).length;
        const labelSpan = DOM.btnProceedToStep3.querySelector('.btn-proceed-step3-label') || DOM.btnProceedToStep3.querySelector('span:not(.material-symbols-outlined)');
        if (labelSpan) {
            if (count > 0) {
                labelSpan.textContent = t('studio.stage2.btn_proceed_step3', 'Перейти к витрине ({count})').replace('{count}', count);
            } else {
                labelSpan.textContent = t('studio.stage2.btn_proceed_step3_empty', 'Перейти к витрине');
            }
        }
    }

    function setupStage2() {
        renderStage2Tabs();
        selectGenerationType(StudioState.activeGenerationType);
        updateProceedToStep3Button();
    }

    function renderStage2Tabs() {
        if (!DOM.typesTabsContainer) return;
        DOM.typesTabsContainer.innerHTML = '';

        // Extract recommended types from analysis or fallback to standard 5 types
        const types = ['TEST', 'OPEN_ANSWER', 'SEQUENCE', 'CLICK_TEXT', 'CLICK_WORDS'];
        if (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations)) {
            StudioState.analysisResult.recommendations.forEach((r) => {
                if (r.task_type && !types.includes(r.task_type) && !r.manual_only) {
                    types.push(r.task_type);
                }
            });
        }

        types.forEach((t) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'studio-type-tab';
            btn.setAttribute('data-type', t);
            btn.setAttribute('data-active', t === StudioState.activeGenerationType ? 'true' : 'false');

            const draft = StudioState.typeDrafts[t];
            const isReady = draft && draft.parsedTasks && draft.parsedTasks.length > 0;
            btn.setAttribute('data-ready', isReady ? 'true' : 'false');

            btn.innerHTML = `
                <span>${TASK_TYPE_LABELS[t] || t}</span>
                ${isReady ? `<span class="text-success text-[12px] font-bold">✓ ${draft.parsedTasks.length}</span>` : ''}
            `;

            btn.addEventListener('click', () => {
                selectGenerationType(t);
            });

            DOM.typesTabsContainer.appendChild(btn);
        });
    }

    async function selectGenerationType(taskType) {
        StudioState.activeGenerationType = taskType;

        // Update Tab active state
        if (DOM.typesTabsContainer) {
            DOM.typesTabsContainer.querySelectorAll('.studio-type-tab').forEach((tab) => {
                tab.setAttribute('data-active', tab.getAttribute('data-type') === taskType ? 'true' : 'false');
            });
        }

        // Update Labels
        if (DOM.focusPaneTypeLabel) {
            DOM.focusPaneTypeLabel.textContent = `${t('studio.stage2.prompt_title', 'Промпт для типа')}: ${TASK_TYPE_LABELS[taskType] || taskType}`;
        }
        if (DOM.labelCopyTypePrompt) {
            DOM.labelCopyTypePrompt.textContent = `${t('studio.stage2.btn_copy_type_prompt', 'Скопировать промпт для заданий')} (${TASK_TYPE_LABELS[taskType] || taskType})`;
        }

        // Pedagogical focus from analysis
        let focusText = t('studio.stage2.select_direction_hint', 'Выберите направление сверху для формирования точечного промпта.');
        let strategyBadge = t('studio.stage2.focus_badge', 'Фокус');
        let strategyTooltip = '';
        if (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations)) {
            const rec = StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType);
            if (rec) {
                focusText = rec.generation_focus || rec.rationale || focusText;
                if (rec.coverage_strategy) {
                    const info = getStrategyInfo(rec.coverage_strategy);
                    strategyBadge = info.label || strategyBadge;
                    strategyTooltip = info.tooltip || '';
                }
            }
        }
        if (DOM.focusUnitsDescription) DOM.focusUnitsDescription.textContent = focusText;
        if (DOM.focusPaneCoverageBadge) {
            DOM.focusPaneCoverageBadge.textContent = strategyBadge;
            if (strategyTooltip) {
                DOM.focusPaneCoverageBadge.setAttribute('title', strategyTooltip);
            } else {
                DOM.focusPaneCoverageBadge.removeAttribute('title');
            }
        }

        // Load canonical prompt for type
        await loadGenerationPromptForType(taskType);

        // Restore response textarea from draft
        const draft = StudioState.typeDrafts[taskType] || { responseText: '', parsedTasks: [] };
        if (DOM.typeResponseInput) {
            DOM.typeResponseInput.value = draft.responseText || '';
        }
        runClientRegexCounter(draft.responseText || '', taskType);
    }

    async function loadGenerationPromptForType(taskType) {
        const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
        const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
        const promptLang = (targetLang === 'source') ? 'en' : currentLang;
        const cacheKey = `${taskType}_${promptLang}_${targetLang}`;
        if (StudioState.cachedPrompts.generation[cacheKey]) {
            updatePromptPreview(StudioState.cachedPrompts.generation[cacheKey]);
            return;
        }

        try {
            const res = await fetch(`/api/editor/studio/prompts?type=generation&task_type=${taskType}&prompt_lang=${encodeURIComponent(promptLang)}&target_lang=${encodeURIComponent(targetLang)}`);
            if (res.ok) {
                const data = await res.json();
                StudioState.cachedPrompts.generation[cacheKey] = data.prompt || '';
                updatePromptPreview(data.prompt || '');
            }
        } catch (e) {
            console.warn('[Studio] Failed to load generation prompt:', e);
        }
    }

    function updatePromptPreview(promptText) {
        if (DOM.typePromptPreviewText) {
            DOM.typePromptPreviewText.textContent = promptText || t('editor_base.lbl_loading', 'Загрузка промпта...');
        }
    }

    function initStage2() {
        // Copy type prompt
        if (DOM.btnCopyTypePrompt) {
            DOM.btnCopyTypePrompt.addEventListener('click', async () => {
                const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
                const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
                const promptLang = (targetLang === 'source') ? 'en' : currentLang;
                const cacheKey = `${StudioState.activeGenerationType}_${promptLang}_${targetLang}`;
                let prompt = StudioState.cachedPrompts.generation[cacheKey] || '';
                if (!prompt) {
                    await loadGenerationPromptForType(StudioState.activeGenerationType);
                    prompt = StudioState.cachedPrompts.generation[cacheKey] || '';
                }
                if (!prompt) {
                    showToast(t('studio.stage1.parsing_error', 'Промпт не загружен'), 'error');
                    return;
                }
                try {
                    await navigator.clipboard.writeText(prompt);
                    const label = TASK_TYPE_LABELS[StudioState.activeGenerationType] || StudioState.activeGenerationType;
                    showToast(t('studio.stage1.prompt_copied', `Промпт для ${label} скопирован!`), 'success');
                } catch (e) {
                    showToast(t('studio.stage1.parsing_error', 'Ошибка копирования'), 'error');
                }
            });
        }

        // Live typing in response
        if (DOM.typeResponseInput) {
            DOM.typeResponseInput.addEventListener('input', () => {
                const val = DOM.typeResponseInput.value;
                if (!StudioState.typeDrafts[StudioState.activeGenerationType]) {
                    StudioState.typeDrafts[StudioState.activeGenerationType] = { responseText: '', parsedTasks: [] };
                }
                StudioState.typeDrafts[StudioState.activeGenerationType].responseText = val;

                clearTimeout(liveParseDebounceTimer);
                liveParseDebounceTimer = setTimeout(() => {
                    runClientRegexCounter(val, StudioState.activeGenerationType);
                }, 200);

                markDirty();
            });
        }

        // Commit tasks of this type
        if (DOM.btnCommitTypeTasks) {
            DOM.btnCommitTypeTasks.addEventListener('click', commitTypeTasks);
        }

        // Back to Step 1
        if (DOM.btnBackToStep1) {
            DOM.btnBackToStep1.addEventListener('click', () => {
                switchStep(1);
            });
        }

        // Proceed to Step 3
        if (DOM.btnProceedToStep3) {
            DOM.btnProceedToStep3.addEventListener('click', () => {
                switchStep(3);
            });
        }
    }

    function runClientRegexCounter(text, taskType) {
        if (!DOM.liveParseCounter || !DOM.liveParseCountText) return;

        const count = countTasksByRegex(text, taskType);
        if (count > 0) {
            DOM.liveParseCounter.classList.remove('hidden');
            DOM.liveParseCountText.textContent = `${count} ${pluralizeTasks(count)} найдено`;
            if (DOM.btnCommitTypeTasks) DOM.btnCommitTypeTasks.disabled = false;
        } else {
            DOM.liveParseCounter.classList.add('hidden');
            if (DOM.btnCommitTypeTasks) DOM.btnCommitTypeTasks.disabled = true;
        }
    }

    function countTasksByRegex(text, taskType) {
        if (!text) return 0;
        const marker = `@${taskType}`;
        const regex = new RegExp(marker, 'g');
        const matches = text.match(regex);
        return matches ? matches.length : 0;
    }

    async function commitTypeTasks() {
        const taskType = StudioState.activeGenerationType;
        const draft = StudioState.typeDrafts[taskType];
        if (!draft || !draft.responseText.trim()) {
            showToast('Нет текста заданий для сохранения', 'warning');
            return;
        }

        if (!StudioState.selectedModuleId || !StudioState.selectedTopicId) {
            openTopicModal();
            showToast('Выберите модуль и тему курса', 'warning');
            return;
        }

        showToast('Серверная валидация схемы заданий...', 'info');

        try {
            const res = await fetch('/api/editor/import/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: StudioState.selectedModuleId,
                    topic_id: StudioState.selectedTopicId,
                    text: draft.responseText,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showToast(data.message || 'Ошибка парсинга схемы заданий', 'error');
                return;
            }

            const parsed = data.tasks || [];
            if (parsed.length === 0) {
                showToast('Не удалось распознать корректные задания', 'warning');
                return;
            }

            // Store in draft
            draft.parsedTasks = parsed;
            draft.isCommitted = true;

            // Merge into allTasks (replace previous parsed tasks of this type)
            StudioState.allTasks = StudioState.allTasks.filter((t) => t.type !== taskType && t._import_type !== taskType);
            parsed.forEach((t) => {
                t._selected_for_import = true;
                t._studio_id = 't_' + Math.random().toString(36).substring(2, 9);
                StudioState.allTasks.push(t);
            });

            renderStage2Tabs();
            updateProceedToStep3Button();
            showToast(`Принято ${parsed.length} заданий типа ${TASK_TYPE_LABELS[taskType] || taskType}!`, 'success');
            markDirty();
        } catch (e) {
            console.error('[Studio] Commit error:', e);
            showToast('Ошибка проверки заданий', 'error');
        }
    }

    // ---------------------------------------------------------------------------
    // 8. Stage 3: Task Showcase & Selective Import
    // ---------------------------------------------------------------------------

    let showcaseFilterType = 'ALL';

    function setupStage3() {
        renderShowcase();
        updateStickyBar();
    }

    function initStage3() {
        if (DOM.showcaseSelectAll) {
            DOM.showcaseSelectAll.addEventListener('change', (e) => {
                const checked = e.target.checked;
                StudioState.allTasks.forEach((t) => {
                    t._selected_for_import = checked;
                });
                renderShowcase();
                updateStickyBar();
                markDirty();
            });
        }

        if (DOM.btnBackToStep2) {
            DOM.btnBackToStep2.addEventListener('click', () => {
                switchStep(2);
            });
        }

        if (DOM.btnExecuteImport) {
            DOM.btnExecuteImport.addEventListener('click', executeImport);
        }
    }

    function renderShowcase() {
        if (!DOM.showcaseCardsGrid) return;
        DOM.showcaseCardsGrid.innerHTML = '';

        const tasks = StudioState.allTasks || [];
        if (DOM.showcaseTotalCount) DOM.showcaseTotalCount.textContent = tasks.length;

        if (tasks.length === 0) {
            DOM.showcaseCardsGrid.innerHTML = `
                <div class="col-span-full py-12 flex flex-col items-center justify-center text-center">
                    <span class="material-symbols-outlined text-[48px] text-text-muted mb-2">inbox</span>
                    <p class="text-sm font-semibold text-text-secondary">${t('studio.stage3.empty_showcase', 'Нет принятых заданий. Вернитесь на Шаг 2 для генерации.')}</p>
                </div>
            `;
            return;
        }

        renderShowcaseFilterPills();

        const filtered = showcaseFilterType === 'ALL'
            ? tasks
            : tasks.filter((t) => (t.type || t._import_type || '').toUpperCase() === showcaseFilterType);

        filtered.forEach((task) => {
            const card = document.createElement('div');
            card.className = 'studio-task-card';
            card.setAttribute('data-selected', task._selected_for_import ? 'true' : 'false');

            const taskType = (task.type || task._import_type || 'TEST').toUpperCase();
            const questionTitle = task.title || task.question || task.stem || 'Задание';

            card.innerHTML = `
                <div class="studio-task-card__top">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" class="task-select-checkbox rounded border-border-strong text-primary w-4 h-4"
                            ${task._selected_for_import ? 'checked' : ''} />
                        <span class="studio-unit-badge bg-primary-light text-primary font-bold">${TASK_TYPE_LABELS[taskType] || taskType}</span>
                    </label>
                    <button type="button" class="btn-delete-task text-text-muted hover:text-error transition-colors p-1" title="${t('studio.stage3.delete_task', 'Удалить задание')}">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>

                <div class="flex flex-col gap-1 flex-1">
                    <p class="text-xs font-bold text-text-main line-clamp-2">${escapeHtml(questionTitle)}</p>
                    ${renderTaskPreviewSnippet(task)}
                </div>
            `;

            // Checkbox event
            const cb = card.querySelector('.task-select-checkbox');
            if (cb) {
                cb.addEventListener('change', (e) => {
                    task._selected_for_import = e.target.checked;
                    card.setAttribute('data-selected', task._selected_for_import ? 'true' : 'false');
                    updateStickyBar();
                    markDirty();
                });
            }

            // Delete event
            const delBtn = card.querySelector('.btn-delete-task');
            if (delBtn) {
                delBtn.addEventListener('click', () => {
                    StudioState.allTasks = StudioState.allTasks.filter((t) => t._studio_id !== task._studio_id);
                    renderShowcase();
                    updateStickyBar();
                    updateProceedToStep3Button();
                    showToast(t('studio.modal.history_delete', 'Удалено'), 'info');
                    markDirty();
                });
            }

            DOM.showcaseCardsGrid.appendChild(card);
        });
    }

    function renderShowcaseFilterPills() {
        if (!DOM.showcaseFilterPills) return;
        DOM.showcaseFilterPills.innerHTML = '';

        const typeCounts = { ALL: StudioState.allTasks.length };
        StudioState.allTasks.forEach((t) => {
            const key = (t.type || t._import_type || 'TEST').toUpperCase();
            typeCounts[key] = (typeCounts[key] || 0) + 1;
        });

        Object.keys(typeCounts).forEach((key) => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${showcaseFilterType === key ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-1'}`;
            const labelText = key === 'ALL' ? t('studio.stage3.filter_all', 'Все') : (TASK_TYPE_LABELS[key] || key);
            pill.textContent = `${labelText} (${typeCounts[key]})`;

            pill.addEventListener('click', () => {
                showcaseFilterType = key;
                renderShowcase();
            });

            DOM.showcaseFilterPills.appendChild(pill);
        });
    }

    function renderTaskPreviewSnippet(task) {
        if (task.options && Array.isArray(task.options)) {
            return `
                <div class="mt-1 flex flex-col gap-1 text-[11px] text-text-secondary">
                    ${task.options.slice(0, 3).map((opt) => `
                        <div class="flex items-center gap-1.5 ${opt.is_correct ? 'text-success font-semibold' : ''}">
                            <span class="text-[10px]">${opt.is_correct ? '✓' : '•'}</span>
                            <span class="truncate">${escapeHtml(opt.text || opt.title || '')}</span>
                        </div>
                    `).join('')}
                    ${task.options.length > 3 ? `<span class="text-text-muted text-[10px]">+ ещё ${task.options.length - 3} вар.</span>` : ''}
                </div>
            `;
        }
        if (task.standard_answer || task.correct_answer) {
            return `
                <p class="mt-1 text-[11px] text-text-secondary line-clamp-2 bg-surface-2 p-1.5 rounded-md border border-border-subtle">
                    <span class="font-bold text-text-main">${t('studio.stage3.standard_answer', 'Эталон:')}</span> ${escapeHtml(task.standard_answer || task.correct_answer || '')}
                </p>
            `;
        }
        return '';
    }

    function updateStickyBar() {
        const selected = StudioState.allTasks.filter((t) => t._selected_for_import);
        if (DOM.stickyBarSummary) {
            if (StudioState.allTasks.length === 0) {
                DOM.stickyBarSummary.textContent = t('studio.stage3.selected_zero', 'Выбрано: 0 заданий');
            } else {
                DOM.stickyBarSummary.textContent = t('studio.stage3.import_selected_summary', 'Выбрано для импорта: {selected} из {total} заданий')
                    .replace('{selected}', selected.length)
                    .replace('{total}', StudioState.allTasks.length);
            }
        }
        if (DOM.btnExecuteImport) {
            DOM.btnExecuteImport.disabled = selected.length === 0 || !StudioState.selectedTopicId;
        }
    }

    async function executeImport() {
        const selected = StudioState.allTasks.filter((t) => t._selected_for_import);
        if (selected.length === 0) {
            showToast('Выберите хотя бы одно задание для импорта', 'warning');
            return;
        }

        if (!StudioState.selectedModuleId || !StudioState.selectedTopicId) {
            openTopicModal();
            showToast('Выберите целевую тему курса', 'warning');
            return;
        }

        const idempotencyKey = 'imp_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
        showToast('Импорт заданий в тему курса...', 'info');

        try {
            const res = await fetch('/api/editor/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: StudioState.selectedModuleId,
                    topic_id: StudioState.selectedTopicId,
                    tasks: selected,
                    idempotency_key: idempotencyKey,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showToast(data.message || 'Ошибка импорта заданий в тему', 'error');
                return;
            }

            // Save session to PostgreSQL
            await saveSessionToBackend('imported');

            clearLocalStorageDraft();
            showToast(`🎉 Успешно импортировано ${data.imported || selected.length} заданий!`, 'success');

            // Redirect back to dashboard topic after short delay
            setTimeout(() => {
                window.location.href = `/editor?module=${encodeURIComponent(StudioState.selectedModuleId)}&topic=${encodeURIComponent(StudioState.selectedTopicId)}`;
            }, 1200);
        } catch (e) {
            console.error('[Studio] Execute import error:', e);
            showToast('Сетевая ошибка импорта', 'error');
        }
    }

    // ---------------------------------------------------------------------------
    // 9. Session Manager (PostgreSQL max 3 FIFO)
    // ---------------------------------------------------------------------------

    async function loadSessionsList() {
        try {
            const res = await fetch('/api/editor/studio/sessions');
            if (!res.ok) return;
            const data = await res.json();
            if (data.ok && Array.isArray(data.sessions)) {
                if (DOM.historyCountBadge) {
                    DOM.historyCountBadge.textContent = data.sessions.length;
                }
                renderHistoryItems(data.sessions);
            }
        } catch (e) {
            console.warn('[Studio] Failed to load sessions list:', e);
        }
    }

    async function saveSessionToBackend(status = 'draft') {
        try {
            await fetch('/api/editor/studio/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: StudioState.sessionId,
                    module_id: StudioState.selectedModuleId,
                    topic_id: StudioState.selectedTopicId,
                    human_summary: (StudioState.analysisResult && StudioState.analysisResult.human_summary) || '',
                    recommendations: (StudioState.analysisResult && StudioState.analysisResult.recommendations) || [],
                    tasks: StudioState.allTasks || [],
                    status: status,
                }),
            });
            loadSessionsList();
        } catch (e) {
            console.warn('[Studio] Failed to save session to backend:', e);
        }
    }

    function renderHistoryItems(sessions) {
        if (!DOM.historyItemsContainer) return;
        DOM.historyItemsContainer.innerHTML = '';

        if (!sessions || sessions.length === 0) {
            DOM.historyItemsContainer.innerHTML = `<p class="text-xs text-text-muted py-4 text-center">${t('studio.modal.history_empty', 'В истории пока нет сохранённых сессий.')}</p>`;
            return;
        }

        sessions.forEach((s) => {
            const item = document.createElement('div');
            item.className = 'flex flex-col gap-2 p-3 rounded-xl bg-surface-2 border border-border-subtle';

            const dateStr = s.created_at ? new Date(s.created_at).toLocaleString() : t('studio.modal.history_session', 'Сессия');
            const taskCount = (s.tasks && s.tasks.length) || 0;

            item.innerHTML = `
                <div class="flex items-center justify-between">
                    <span class="text-xs font-bold text-text-main">${dateStr}</span>
                    <span class="studio-unit-badge ${s.status === 'imported' ? 'bg-success-light text-success-dark' : 'bg-primary-light text-primary'}">
                        ${s.status === 'imported' ? t('studio.modal.status_imported', 'Импортировано') : t('studio.modal.status_draft', 'Черновик')}
                    </span>
                </div>
                <p class="text-xs text-text-secondary line-clamp-2">${escapeHtml(s.human_summary || '')}</p>
                <div class="flex items-center justify-between pt-1 border-t border-border-subtle">
                    <span class="text-[11px] text-text-muted">${taskCount} ${pluralizeTasks(taskCount)}</span>
                    <div class="flex items-center gap-1.5">
                        <button type="button" class="btn-restore-session text-xs font-semibold text-primary hover:underline">
                            ${t('studio.modal.history_restore', 'Открыть')}
                        </button>
                        <span class="text-border-subtle">·</span>
                        <button type="button" class="btn-delete-session text-xs font-semibold text-error hover:underline">
                            ${t('studio.modal.history_delete', 'Удалить')}
                        </button>
                    </div>
                </div>
            `;

            // Restore
            item.querySelector('.btn-restore-session').addEventListener('click', () => {
                restoreSession(s);
                closeHistoryModal();
            });

            // Delete
            item.querySelector('.btn-delete-session').addEventListener('click', async () => {
                await deleteSessionFromBackend(s.session_id);
                loadSessionsList();
            });

            DOM.historyItemsContainer.appendChild(item);
        });
    }

    function restoreSession(session) {
        StudioState.sessionId = session.session_id;
        StudioState.selectedModuleId = session.module_id || '';
        StudioState.selectedTopicId = session.topic_id || '';
        StudioState.analysisResult = {
            human_summary: session.human_summary || '',
            recommendations: session.recommendations || [],
        };
        StudioState.allTasks = session.tasks || [];

        resolveTopicFromUrlOrCatalog();
        if (DOM.lessonMapContainer) renderLessonMap(StudioState.analysisResult);
        if (DOM.btnProceedToStep2) DOM.btnProceedToStep2.disabled = false;

        switchStep(session.tasks && session.tasks.length > 0 ? 3 : 2);
        updateProceedToStep3Button();
        showToast('Сессия восстановлена из базы данных', 'success');
        markDirty();
    }

    async function deleteSessionFromBackend(sessionId) {
        try {
            await fetch(`/api/editor/studio/sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
            });
            showToast('Сессия удалена', 'info');
        } catch (e) {
            showToast('Ошибка удаления сессии', 'error');
        }
    }

    function initHistoryModal() {
        if (DOM.btnOpenHistory) {
            DOM.btnOpenHistory.addEventListener('click', () => {
                loadSessionsList();
                if (DOM.modalSessionHistory) DOM.modalSessionHistory.classList.remove('hidden');
            });
        }
        if (DOM.btnCloseHistoryModal) {
            DOM.btnCloseHistoryModal.addEventListener('click', closeHistoryModal);
        }
        if (DOM.btnSelectTopic) {
            DOM.btnSelectTopic.addEventListener('click', openTopicModal);
        }
        if (DOM.btnCloseTopicModal) {
            DOM.btnCloseTopicModal.addEventListener('click', closeTopicModal);
        }

        // Live search in topic modal
        if (DOM.topicSearchInput) {
            DOM.topicSearchInput.addEventListener('input', (e) => {
                renderTopicTree(e.target.value);
            });
        }

        // Close modals when clicking on background backdrop
        [DOM.modalTopicSelector, DOM.modalSessionHistory].forEach((modal) => {
            if (!modal) return;
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.add('hidden');
                }
            });
        });

        // Close active modal on Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeTopicModal();
                closeHistoryModal();
                closeNavGuardModal();
            }
        });
    }

    function closeHistoryModal() {
        if (DOM.modalSessionHistory) DOM.modalSessionHistory.classList.add('hidden');
    }

    // ---------------------------------------------------------------------------
    // 10. Utilities & Toast Helpers
    // ---------------------------------------------------------------------------

    function showToast(message, variant = 'info') {
        if (window.NotificationUI && typeof window.NotificationUI.toast === 'function') {
            window.NotificationUI.toast(message, variant);
        } else {
            console.log(`[Toast ${variant}] ${message}`);
        }
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function pluralizeTasks(count) {
        const lang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
        if (lang === 'en') {
            return count === 1 ? t('studio.labels.tasks_one', 'task') : t('studio.labels.tasks_many', 'tasks');
        }
        const rem10 = Math.abs(count) % 10;
        const rem100 = Math.abs(count) % 100;
        if (rem10 === 1 && rem100 !== 11) return t('studio.labels.tasks_one', 'задание');
        if (rem10 >= 2 && rem10 <= 4 && (rem100 < 10 || rem100 >= 20)) return t('studio.labels.tasks_few', 'задания');
        return t('studio.labels.tasks_many', 'заданий');
    }

    // ---------------------------------------------------------------------------
    // 11. App Initialization
    // ---------------------------------------------------------------------------

    document.addEventListener('DOMContentLoaded', () => {
        initDOM();
        initStepper();
        initStage1();
        initStage2();
        initStage3();
        initNavigationGuard();
        initResetDraft();
        initHistoryModal();

        updateTopicDisplay();
        updateStickyBar();
        updateProceedToStep3Button();

        loadCatalog();
        loadSessionsList();
        restoreDraftFromLocalStorage();

        window.addEventListener('i18n:changed', () => {
            if (typeof window.i18n.updateDOM === 'function') {
                window.i18n.updateDOM();
            }
            if (!StudioState.hasExplicitTargetLanguage) {
                setTargetLanguage(getDefaultTargetLanguage(), false);
            }
            updateTopicDisplay();
            updateStickyBar();
            updateProceedToStep3Button();
            if (StudioState.currentStep === 1) {
                loadAnalysisPrompt();
                if (StudioState.analysisResult) {
                    renderLessonMap(StudioState.analysisResult);
                }
            } else if (StudioState.currentStep === 2) {
                renderStage2Tabs();
                selectGenerationType(StudioState.activeGenerationType);
                loadGenerationPromptForType(StudioState.activeGenerationType);
            } else if (StudioState.currentStep === 3) {
                renderShowcase();
            }
            if (StudioState.isDirty) {
                markDirty();
            } else {
                markSaved();
            }
        });
    });

})();
