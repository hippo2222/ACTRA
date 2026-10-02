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

    function normalizeTaskType(taskOrType) {
        if (!taskOrType) return 'TEST';
        let rawType = '';
        let mode = '';
        let subtype = '';
        if (typeof taskOrType === 'object') {
            const data = taskOrType.data || taskOrType.task_data || taskOrType.content || {};
            rawType = taskOrType.type || taskOrType._import_type || taskOrType.task_type || data.type || '';
            mode = taskOrType.mode || data.mode || (taskOrType.content && taskOrType.content.mode) || '';
            subtype = taskOrType.subtype || data.subtype || (taskOrType.content && taskOrType.content.subtype) || '';
        } else if (typeof taskOrType === 'string') {
            rawType = taskOrType;
        }

        const s = String(rawType || '').trim().toLowerCase();
        const m = String(mode || '').trim().toLowerCase();
        const sub = String(subtype || '').trim().toLowerCase();

        // 1. Text error detection (text_errors mode, error_detection subtype, or click_words)
        if (m === 'text_errors' || sub === 'error_detection' || s === 'click_words' || s === 'text_errors') {
            return 'CLICK_WORDS';
        }
        // 2. Contrastive statements (text_choice mode, myth_busters subtype, or click_text)
        if (m === 'text_choice' || sub === 'myth_busters' || s === 'click_text' || s === 'text_choice') {
            return 'CLICK_TEXT';
        }
        // 3. Sequences
        if (s === 'sequence_assembly' || s === 'sequence') {
            return 'SEQUENCE';
        }
        // 4. Open Answer
        if (s === 'open_answer') {
            return 'OPEN_ANSWER';
        }
        // 5. Draw
        if (s === 'draw') {
            return 'DRAW';
        }
        // 6. Test
        if (s === 'test') {
            return 'TEST';
        }
        // 7. Visual Click on image
        if (s === 'click') {
            return 'CLICK';
        }
        if (s) {
            return s.toUpperCase();
        }
        return 'TEST';
    }

    function getTaskTypeLabel(taskType) {
        const norm = normalizeTaskType(taskType);
        const labels = {
            TEST: t('studio.task_types.test', 'Тест'),
            OPEN_ANSWER: t('studio.task_types.open_answer', 'Открытый ответ'),
            SEQUENCE: t('studio.task_types.sequence', 'Последовательность'),
            CLICK_TEXT: t('studio.task_types.click_text', 'Контрастные утверждения'),
            CLICK_WORDS: t('studio.task_types.click_words', 'Поиск ошибок в тексте'),
            CLICK: t('studio.task_types.click', 'Клик по изображению'),
            DRAW: t('studio.task_types.draw', 'Рисование'),
        };
        return labels[norm] || labels[taskType] || taskType;
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
            focusPaneTypeLabel: document.getElementById('focus-pane-type-label'),
            focusPaneCoverageBadge: document.getElementById('focus-pane-coverage-badge'),
            focusUnitsDescription: document.getElementById('focus-units-description'),
            focusInjectedBadge: document.getElementById('focus-injected-badge'),
            btnCopyTypePrompt: document.getElementById('btn-copy-type-prompt'),
            labelCopyTypePrompt: document.getElementById('label-copy-type-prompt'),
            btnPasteTypeResponse: document.getElementById('btn-paste-type-response'),
            labelPasteTypeResponse: document.getElementById('label-paste-type-response'),
            paneResponseIcon: document.getElementById('pane-response-icon'),
            paneResponseTitle: document.getElementById('pane-response-title'),
            typePromptPreviewText: document.getElementById('type-prompt-preview-text'),
            typeResponseInput: document.getElementById('type-response-input'),
            typeCommittedView: document.getElementById('type-committed-view'),
            committedViewTitle: document.getElementById('committed-view-title'),
            btnEditTypeTasks: document.getElementById('btn-edit-type-tasks'),
            typeCommittedCardsList: document.getElementById('type-committed-cards-list'),
            typeCommittedRawCode: document.getElementById('type-committed-raw-code'),
            liveParseCounter: document.getElementById('live-parse-counter'),
            liveParseCountText: document.getElementById('live-parse-count-text'),
            btnCommitTypeTasks: document.getElementById('btn-commit-type-tasks'),
            labelCommitTypeTasks: document.getElementById('label-commit-type-tasks'),
            btnProceedToStep3: document.getElementById('btn-proceed-to-step-3'),

            // Stage 2 Manual Visual View
            typeManualVisualView: document.getElementById('type-manual-visual-view'),
            manualVisualIcon: document.getElementById('manual-visual-icon'),
            manualVisualTitle: document.getElementById('manual-visual-title'),
            manualVisualDesc: document.getElementById('manual-visual-desc'),
            manualVisualTargetsBox: document.getElementById('manual-visual-targets-box'),
            manualVisualTargetsList: document.getElementById('manual-visual-targets-list'),
            manualVisualHint: document.getElementById('manual-visual-hint'),
            btnOpenVisualEditor: document.getElementById('btn-open-visual-editor'),
            labelOpenVisualEditor: document.getElementById('label-open-visual-editor'),
            manualSpecTextarea: document.getElementById('manual-spec-textarea'),
            btnCommitManualSpec: document.getElementById('btn-commit-manual-spec'),

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
            modalTaskPreview: document.getElementById('modal-task-preview'),
            modalPreviewTitle: document.getElementById('modal-preview-title'),
            previewTaskTypeBadge: document.getElementById('preview-task-type-badge'),
            previewTaskCounter: document.getElementById('preview-task-counter'),
            btnPreviewPrevTask: document.getElementById('btn-preview-prev-task'),
            btnPreviewNextTask: document.getElementById('btn-preview-next-task'),
            btnClosePreviewModal: document.getElementById('btn-close-preview-modal'),
            btnClosePreviewFooter: document.getElementById('btn-close-preview-footer'),
            taskPreviewContentContainer: document.getElementById('task-preview-content-container'),
            previewTaskSelectCheckbox: document.getElementById('preview-task-select-checkbox'),
            btnPreviewToggleRaw: document.getElementById('btn-preview-toggle-raw'),

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
                syncTypeDraftsWithAllTasks();

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
            showToast(t('studio.toast.select_topic_first', 'Пожалуйста, выберите тему курса для добавления заданий'), 'warning');
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
            DOM.typeResponseInput.classList.remove('hidden');
        }
        if (DOM.typeCommittedView) {
            DOM.typeCommittedView.classList.add('hidden');
        }
        if (DOM.typeCommittedCardsList) {
            DOM.typeCommittedCardsList.innerHTML = '';
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
        if (DOM.focusUnitsDescription) {
            DOM.focusUnitsDescription.textContent = t('studio.stage2.select_direction_hint', 'Выберите направление сверху для формирования точечного промпта.');
        }
        if (DOM.focusPaneCoverageBadge) {
            DOM.focusPaneCoverageBadge.classList.add('hidden');
            DOM.focusPaneCoverageBadge.removeAttribute('title');
        }
        if (DOM.typeManualVisualView) {
            DOM.typeManualVisualView.classList.add('hidden');
        }
        if (DOM.manualSpecTextarea) {
            DOM.manualSpecTextarea.value = '';
        }
        if (DOM.manualVisualTargetsList) {
            DOM.manualVisualTargetsList.innerHTML = '';
        }
        if (DOM.focusInjectedBadge) {
            DOM.focusInjectedBadge.classList.add('hidden');
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
            if (StudioState.selectedTopicId) {
                DOM.stickyBarTopicTarget.innerHTML = escapeHtml(
                    t('studio.stage3.topic_target_selected', 'Целевая тема курса: {module} / {topic}')
                        .replace('{module}', StudioState.selectedModuleName)
                        .replace('{topic}', StudioState.selectedTopicName)
                );
            } else {
                DOM.stickyBarTopicTarget.innerHTML = `
                    <span class="text-text-muted">${escapeHtml(t('studio.stage3.topic_not_selected', 'Целевая тема курса: не выбрана'))}</span>
                    <button type="button" id="btn-sticky-choose-topic" class="ml-1.5 text-primary hover:underline font-semibold cursor-pointer inline-flex items-center gap-0.5 align-baseline">
                        <span>${escapeHtml(t('studio.stage3.choose_topic_action', 'выбрать тему'))}</span>
                        <span class="material-symbols-outlined text-[13px]">arrow_forward</span>
                    </button>
                `;
                const chooseBtn = DOM.stickyBarTopicTarget.querySelector('#btn-sticky-choose-topic');
                if (chooseBtn) {
                    chooseBtn.addEventListener('click', () => {
                        openTopicModal();
                    });
                }
            }
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
                        <span class="text-[11px] text-text-muted ml-2 shrink-0">${(top.tasks && top.tasks.length) || 0} ${t('studio.card.tasks_abbr', 'зад.')}</span>
                    `;

                    btn.addEventListener('click', () => {
                        StudioState.selectedModuleId = mod.id;
                        StudioState.selectedModuleName = mod.name || mod.title || mod.id;
                        StudioState.selectedTopicId = top.id;
                        StudioState.selectedTopicName = top.name || top.title || top.id;

                        updateTopicDisplay();
                        closeTopicModal();
                        showToast(t('studio.toast.topic_selected', 'Выбрана тема: {topic}').replace('{topic}', StudioState.selectedTopicName), 'success');
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
            showToast(t('studio.toast.paste_response_first', 'Пожалуйста, вставьте текст ответа нейросети'), 'warning');
            return;
        }

        showToast(t('studio.toast.parsing_structure', 'Разбор структуры материала...'), 'info');

        try {
            const res = await fetch('/api/editor/import/parse-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: raw }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showToast(data.message || t('studio.toast.analysis_parse_error', 'Ошибка парсинга ответа анализа'), 'error');
                return;
            }

            StudioState.analysisResult = data;
            renderLessonMap(data);

            if (DOM.btnProceedToStep2) {
                DOM.btnProceedToStep2.disabled = false;
            }

            showToast(t('studio.toast.analysis_parse_success', 'Структура материала успешно разобрана!'), 'success');
            markDirty();
        } catch (e) {
            console.error('[Studio] Parse analysis error:', e);
            showToast(t('studio.toast.analysis_network_error', 'Сетевая ошибка при парсинге анализа'), 'error');
        }
    }

    function getStrategyInfo(strategy) {
        if (!strategy) return { label: '', fullLabel: '', tooltip: '', icon: 'tune' };
        const clean = String(strategy).toLowerCase().trim();
        const strategyMeta = {
            structure_first: { fallbackLabel: t('studio.strategies.structure_first', 'Структурирование'), icon: 'account_tree' },
            misconception_first: { fallbackLabel: t('studio.strategies.misconception_first', 'Типичные заблуждения'), icon: 'psychology' },
            high_risk_first: { fallbackLabel: t('studio.strategies.high_risk_first', 'Критические точки'), icon: 'warning' },
            breadth_first: { fallbackLabel: t('studio.strategies.breadth_first', 'Широкий охват'), icon: 'apps' },
            visual_first: { fallbackLabel: t('studio.strategies.visual_first', 'Визуальный фокус'), icon: 'visibility' },
        };
        const meta = strategyMeta[clean] || { fallbackLabel: strategy, icon: 'tune' };
        const label = t(`studio.strategies.${clean}`, meta.fallbackLabel);
        const prefixTpl = t('studio.strategies.strategy_prefix', 'Стратегия: {name}');
        const fullLabel = prefixTpl.replace('{name}', label);
        const tooltip = t(`studio.strategies.${clean}_desc`, '');
        return { label, fullLabel, tooltip, icon: meta.icon };
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
                                ${stratInfo.label ? `<span class="studio-unit-badge bg-surface-2 text-text-secondary border border-border-subtle inline-flex items-center gap-1" title="${escapeHtml(stratInfo.tooltip || stratInfo.fullLabel)}"><span class="material-symbols-outlined text-[12px]">${escapeHtml(stratInfo.icon)}</span><span>${escapeHtml(stratInfo.label)}</span></span>` : ''}
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

    function updateStage2ActionButtons() {
        if (!DOM.btnCommitTypeTasks && !DOM.btnProceedToStep3) return;

        const taskType = StudioState.activeGenerationType;
        const draft = StudioState.typeDrafts[taskType] || { responseText: '', parsedTasks: [], isCommitted: false };
        const currentText = DOM.typeResponseInput ? DOM.typeResponseInput.value : (draft.responseText || '');
        const regexCount = countTasksByRegex(currentText, taskType);
        const isCommitted = Boolean(draft.isCommitted && Array.isArray(draft.parsedTasks) && draft.parsedTasks.length > 0 && draft.responseText.trim() === currentText.trim());
        const totalAllTasks = (StudioState.allTasks || []).length;

        // 1. Live Parse Counter
        if (DOM.liveParseCounter && DOM.liveParseCountText) {
            if (regexCount > 0) {
                DOM.liveParseCounter.classList.remove('hidden');
                DOM.liveParseCountText.textContent = `${regexCount} ${pluralizeTasks(regexCount)} ` + t('studio.stage2.tasks_found_suffix', 'найдено');
            } else {
                DOM.liveParseCounter.classList.add('hidden');
            }
        }

        // 2. Commit button (footer sole primary CTA when uncommitted)
        if (DOM.btnCommitTypeTasks) {
            if (regexCount > 0 && !isCommitted) {
                // UNCOMMITTED TASKS DETECTED: Sole Primary CTA!
                DOM.btnCommitTypeTasks.disabled = false;
                DOM.btnCommitTypeTasks.classList.remove('studio-btn--secondary', 'studio-btn--committed');
                DOM.btnCommitTypeTasks.classList.add('studio-btn--primary');
                const commitLabel = t('studio.stage2.btn_commit_count', 'Принять задания ({count})').replace('{count}', regexCount);
                if (DOM.labelCommitTypeTasks) {
                    DOM.labelCommitTypeTasks.textContent = commitLabel;
                } else {
                    DOM.btnCommitTypeTasks.textContent = commitLabel;
                }
            } else if (isCommitted) {
                // COMMITTED TASKS: Confirmed calm state
                DOM.btnCommitTypeTasks.disabled = false;
                DOM.btnCommitTypeTasks.classList.remove('studio-btn--primary');
                DOM.btnCommitTypeTasks.classList.add('studio-btn--secondary', 'studio-btn--committed');
                const committedLabel = t('studio.stage2.btn_committed_count', '✓ Принято ({count})').replace('{count}', draft.parsedTasks.length);
                if (DOM.labelCommitTypeTasks) {
                    DOM.labelCommitTypeTasks.textContent = committedLabel;
                } else {
                    DOM.btnCommitTypeTasks.textContent = committedLabel;
                }
            } else {
                // NO TASKS DETECTED: Disabled state
                DOM.btnCommitTypeTasks.disabled = true;
                DOM.btnCommitTypeTasks.classList.remove('studio-btn--primary', 'studio-btn--committed');
                DOM.btnCommitTypeTasks.classList.add('studio-btn--secondary');
                const defaultLabel = t('studio.stage2.btn_commit', 'Принять задания этого типа');
                if (DOM.labelCommitTypeTasks) {
                    DOM.labelCommitTypeTasks.textContent = defaultLabel;
                } else {
                    DOM.btnCommitTypeTasks.textContent = defaultLabel;
                }
            }
        }

        // 3. Proceed to Step 3 button
        if (DOM.btnProceedToStep3) {
            const labelSpan = DOM.btnProceedToStep3.querySelector('.btn-proceed-step3-label') || DOM.btnProceedToStep3.querySelector('span:not(.material-symbols-outlined)');
            if (totalAllTasks > 0) {
                if (labelSpan) {
                    labelSpan.textContent = t('studio.stage2.btn_proceed_step3', 'Перейти к витрине ({count})').replace('{count}', totalAllTasks);
                }
                // If there are uncommitted tasks sitting in textarea, demote Proceed button to secondary!
                if (regexCount > 0 && !isCommitted) {
                    DOM.btnProceedToStep3.classList.remove('studio-btn--primary');
                    DOM.btnProceedToStep3.classList.add('studio-btn--secondary');
                } else {
                    DOM.btnProceedToStep3.classList.remove('studio-btn--secondary');
                    DOM.btnProceedToStep3.classList.add('studio-btn--primary');
                }
            } else {
                if (labelSpan) {
                    labelSpan.textContent = t('studio.stage2.btn_proceed_step3_empty', 'Перейти к витрине');
                }
                DOM.btnProceedToStep3.classList.remove('studio-btn--primary');
                DOM.btnProceedToStep3.classList.add('studio-btn--secondary');
            }
        }
    }

    function updateProceedToStep3Button() {
        updateStage2ActionButtons();
    }

    function extractTestOptions(task, data) {
        if (!data && task) data = task.data || task.task_data || task.content || task;
        if (!data) return null;
        if (Array.isArray(data.questions) && data.questions[0]) {
            const q0 = data.questions[0];
            if (Array.isArray(q0.answers) && q0.answers.length > 0) return q0.answers;
            if (Array.isArray(q0.options) && q0.options.length > 0) return q0.options;
        }
        if (Array.isArray(data.answers) && data.answers.length > 0) return data.answers;
        if (Array.isArray(data.options) && data.options.length > 0) return data.options;
        if (task) {
            if (Array.isArray(task.answers) && task.answers.length > 0) return task.answers;
            if (Array.isArray(task.options) && task.options.length > 0) return task.options;
        }
        return null;
    }

    function serializeTaskToText(task) {
        if (!task || typeof task !== 'object') return '';
        const canonicalType = normalizeTaskType(task);
        const data = task.data || task.task_data || task.content || task;
        const { questionTitle } = extractTaskDisplayInfo(task);

        if (canonicalType === 'TEST') {
            const lines = ['@TEST'];
            if (questionTitle) lines.push(`# ${questionTitle}`);
            const options = extractTestOptions(task, data);
            if (Array.isArray(options)) {
                options.forEach((opt) => {
                    const isCorrect = Boolean(opt.is_correct ?? opt.correct ?? false);
                    const optText = typeof opt === 'object' && opt ? (opt.text || opt.title || opt.value || '') : String(opt);
                    lines.push(`${isCorrect ? '+' : '-'} ${optText}`);
                });
            }
            const explanation = data.explanation || (data.questions && data.questions[0] && data.questions[0].explanation) || task.explanation;
            if (explanation && typeof explanation === 'string' && explanation.trim()) {
                lines.push(`// ${explanation.trim()}`);
            }
            return lines.join('\n');
        }

        if (canonicalType === 'OPEN_ANSWER') {
            const lines = ['@OPEN_ANSWER'];
            if (questionTitle) lines.push(`# ${questionTitle}`);
            const stdAnswer = data.standard_answer || data.correct_answer || data.reference_answer || task.standard_answer || task.correct_answer || '';
            if (stdAnswer) {
                lines.push(`= ${String(stdAnswer).trim()}`);
            }
            const criteria = data.criteria || data.rubric || task.criteria;
            if (criteria && typeof criteria === 'string' && criteria.trim()) {
                lines.push(`// ${criteria.trim()}`);
            }
            return lines.join('\n');
        }

        if (canonicalType === 'SEQUENCE') {
            const lines = ['@SEQUENCE'];
            if (questionTitle) lines.push(`# ${questionTitle}`);
            let sequenceSteps = [];
            if (data.elements && typeof data.elements === 'object') {
                if (data.levels && typeof data.levels === 'object') {
                    const levelKeys = Object.keys(data.levels).sort((a, b) => Number(a) - Number(b));
                    levelKeys.forEach((lvlKey) => {
                        const elIds = data.levels[lvlKey];
                        if (Array.isArray(elIds)) {
                            elIds.forEach((elId) => {
                                const stepVal = data.elements[elId] || elId;
                                const txt = typeof stepVal === 'object' && stepVal ? (stepVal.text || stepVal.title) : String(stepVal);
                                if (txt) sequenceSteps.push(txt);
                            });
                        }
                    });
                }
                if (sequenceSteps.length === 0) {
                    Object.values(data.elements).forEach((val) => {
                        const txt = typeof val === 'object' && val ? (val.text || val.title) : String(val);
                        if (txt) sequenceSteps.push(txt);
                    });
                }
            } else if (Array.isArray(data.levels)) {
                data.levels.forEach((lvl) => {
                    if (Array.isArray(lvl)) {
                        lvl.forEach((s) => sequenceSteps.push(String(s)));
                    }
                });
            } else if (Array.isArray(data.items) || Array.isArray(task.items)) {
                const items = data.items || task.items;
                items.forEach((it) => {
                    const txt = typeof it === 'object' && it ? (it.text || it.title) : String(it);
                    if (txt) sequenceSteps.push(txt);
                });
            }
            sequenceSteps.forEach((step, idx) => {
                lines.push(`${idx + 1}. ${step}`);
            });
            return lines.join('\n');
        }

        if (canonicalType === 'CLICK_TEXT') {
            const lines = ['@CLICK_TEXT'];
            if (questionTitle) lines.push(`# ${questionTitle}`);
            const options = Array.isArray(data.options) ? data.options : (Array.isArray(data.statements) ? data.statements : []);
            options.forEach((opt) => {
                const isCorrect = Boolean(opt.is_correct ?? opt.correct ?? false);
                const optText = typeof opt === 'object' && opt ? (opt.text || opt.title || opt.value || '') : String(opt);
                lines.push(`${isCorrect ? '+' : '-'} ${optText}`);
            });
            return lines.join('\n');
        }

        if (canonicalType === 'CLICK_WORDS' || data.mode === 'text_errors') {
            const lines = ['@CLICK_WORDS'];
            if (questionTitle && !questionTitle.startsWith('text:')) {
                lines.push(`# ${questionTitle}`);
            }
            let rawText = String(data.text || task.text || (task.content && task.content.text) || '').trim();
            let prefixLen = 0;
            const prefixMatch = rawText.match(/^text:\s*/i);
            if (prefixMatch) {
                prefixLen = prefixMatch[0].length;
                rawText = rawText.slice(prefixLen);
            }
            const errorSpans = data.error_spans || task.error_spans || (task.content && task.content.error_spans);
            const errorIndices = data.error_indices || task.error_indices || (task.content && task.content.error_indices);
            const { clusters } = getErrorAnalysis(rawText, errorSpans, errorIndices);

            if (clusters && clusters.length > 0) {
                const adjustedClusters = clusters.map((c) => ({
                    ...c,
                    start: Math.max(0, c.start - prefixLen),
                    end: Math.max(0, c.end - prefixLen),
                })).filter((c) => c.start < rawText.length && c.end > c.start);

                if (adjustedClusters.length > 0) {
                    const snappedClusters = snapClustersToWordBoundaries(rawText, adjustedClusters);
                    let markedText = '';
                    let cursor = 0;
                    snappedClusters.forEach((cl) => {
                        const s = cl.start;
                        const e = cl.end;
                        markedText += rawText.slice(cursor, s);
                        markedText += `[${rawText.slice(s, e)}]`;
                        cursor = e;
                    });
                    markedText += rawText.slice(cursor);
                    lines.push(markedText);
                } else if (rawText) {
                    lines.push(rawText);
                }
            } else if (rawText) {
                lines.push(rawText);
            }
            return lines.join('\n');
        }

        if (canonicalType === 'CLICK' || canonicalType === 'DRAW') {
            return JSON.stringify(task, null, 2);
        }

        return JSON.stringify(task, null, 2);
    }

    function serializeTasksToText(taskType, tasks) {
        if (!Array.isArray(tasks) || tasks.length === 0) return '';
        if (taskType === 'CLICK' || taskType === 'DRAW') {
            return JSON.stringify(tasks, null, 2);
        }
        return tasks.map((t) => serializeTaskToText(t)).join('\n\n');
    }

    function syncTypeDraftsWithAllTasks() {
        const tasks = StudioState.allTasks || [];
        if (!StudioState.typeDrafts || typeof StudioState.typeDrafts !== 'object') {
            StudioState.typeDrafts = {};
        }

        const tasksByType = new Map();
        tasks.forEach((task) => {
            const canonicalType = normalizeTaskType(task);
            if (!tasksByType.has(canonicalType)) {
                tasksByType.set(canonicalType, []);
            }
            tasksByType.get(canonicalType).push(task);
        });

        tasksByType.forEach((typeTasks, canonicalType) => {
            let draft = StudioState.typeDrafts[canonicalType];
            if (!draft) {
                draft = { responseText: '', parsedTasks: [], isCommitted: false };
                StudioState.typeDrafts[canonicalType] = draft;
            }

            draft.parsedTasks = typeTasks;
            draft.isCommitted = true;

            if (!draft.responseText || !draft.responseText.trim()) {
                draft.responseText = serializeTasksToText(canonicalType, typeTasks);
            }
        });

        Object.keys(StudioState.typeDrafts).forEach((type) => {
            const draft = StudioState.typeDrafts[type];
            if (draft && draft.isCommitted) {
                const stillInAll = tasksByType.get(type);
                if (!stillInAll || stillInAll.length === 0) {
                    draft.parsedTasks = [];
                    draft.isCommitted = false;
                }
            }
        });
    }

    function attachSnippetExpansionListeners(container) {
        if (!container) return;
        container.querySelectorAll('.btn-expand-snippet').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.getAttribute('data-action');
                let targetSelector = '.task-extra-options';
                if (action === 'toggle-steps') targetSelector = '.task-extra-steps';
                else if (action === 'toggle-targets') targetSelector = '.task-extra-targets';
                const extraEl = container.querySelector(targetSelector);
                if (!extraEl) return;
                const isHidden = extraEl.classList.contains('hidden');
                if (isHidden) {
                    extraEl.classList.remove('hidden');
                    const icon = btn.querySelector('.material-symbols-outlined');
                    if (icon) icon.textContent = 'expand_less';
                    const textEl = btn.querySelector('.expand-btn-text');
                    if (textEl) textEl.textContent = btn.getAttribute('data-collapse-text') || t('studio.stage3.collapse', 'Свернуть');
                } else {
                    extraEl.classList.add('hidden');
                    const icon = btn.querySelector('.material-symbols-outlined');
                    if (icon) icon.textContent = 'expand_more';
                    const textEl = btn.querySelector('.expand-btn-text');
                    if (textEl) textEl.textContent = btn.getAttribute('data-more-fmt') || '';
                }
            });
        });

        const expandTextBtn = container.querySelector('.btn-expand-text');
        if (expandTextBtn) {
            expandTextBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const textSnippet = container.querySelector('.task-text-snippet');
                if (!textSnippet) return;
                const isClamped = textSnippet.classList.contains('line-clamp-3');
                if (isClamped) {
                    textSnippet.classList.remove('line-clamp-3');
                    const icon = expandTextBtn.querySelector('.material-symbols-outlined');
                    if (icon) icon.textContent = 'expand_less';
                    const textEl = expandTextBtn.querySelector('.expand-btn-text');
                    if (textEl) textEl.textContent = expandTextBtn.getAttribute('data-collapse-text') || t('studio.stage3.collapse', 'Свернуть');
                } else {
                    textSnippet.classList.add('line-clamp-3');
                    const icon = expandTextBtn.querySelector('.material-symbols-outlined');
                    if (icon) icon.textContent = 'expand_more';
                    const textEl = expandTextBtn.querySelector('.expand-btn-text');
                    if (textEl) textEl.textContent = expandTextBtn.getAttribute('data-expand-text') || t('studio.stage3.expand_text', 'Читать полностью');
                }
            });
        }
    }

    function setupStage2() {
        syncTypeDraftsWithAllTasks();

        const curDraft = StudioState.typeDrafts[StudioState.activeGenerationType];
        if (!curDraft || (!curDraft.isCommitted && !curDraft.responseText)) {
            const typesWithTasks = Object.keys(StudioState.typeDrafts).filter(
                (t) => StudioState.typeDrafts[t]?.isCommitted && StudioState.typeDrafts[t]?.parsedTasks?.length > 0
            );
            if (typesWithTasks.length > 0) {
                StudioState.activeGenerationType = typesWithTasks[0];
            }
        }

        renderStage2Tabs();
        selectGenerationType(StudioState.activeGenerationType);
        updateProceedToStep3Button();
    }

    function getTypeTabState(t) {
        const draft = StudioState.typeDrafts[t];
        const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
            ? StudioState.analysisResult.recommendations.find((r) => r && r.task_type === t)
            : null;

        const isCommitted = Boolean(draft && draft.isCommitted && Array.isArray(draft.parsedTasks) && draft.parsedTasks.length > 0);
        const committedCount = isCommitted ? draft.parsedTasks.length : 0;

        const hasDraftText = Boolean(draft && !draft.isCommitted && draft.responseText && draft.responseText.trim().length > 0);
        const hasUncommittedTasks = Boolean(draft && !draft.isCommitted && Array.isArray(draft.parsedTasks) && draft.parsedTasks.length > 0);
        const isDraft = hasDraftText || hasUncommittedTasks;
        const draftCount = (draft && Array.isArray(draft.parsedTasks) && draft.parsedTasks.length > 0) ? draft.parsedTasks.length : 0;

        const isManual = Boolean(rec && rec.manual_only) || ['CLICK', 'DRAW'].includes(t);

        let status = 'idle';
        if (isCommitted) {
            status = 'ready';
        } else if (isDraft) {
            status = 'draft';
        } else if (isManual) {
            status = 'manual';
        } else if (rec) {
            status = 'recommended';
        }

        let recCount = 3;
        if (rec && rec.count !== undefined && rec.count !== null) {
            const parsed = parseInt(rec.count, 10);
            if (!isNaN(parsed) && parsed > 0) {
                recCount = parsed;
            }
        }

        return {
            status,
            isCommitted,
            committedCount,
            isDraft,
            draftCount,
            isManual,
            isRecommended: Boolean(rec && !isManual),
            recCount,
        };
    }

    function renderTypeTabBadgeHtml(tabState) {
        if (tabState.status === 'ready') {
            const tooltip = t('studio.stage2.tab_ready_tooltip', 'Принято {count} заданий в витрину')
                .replace('{count}', tabState.committedCount);
            return `<span class="studio-tab-badge studio-tab-badge--ready" title="${escapeHtml(tooltip)}">✓ ${tabState.committedCount}</span>`;
        }
        if (tabState.status === 'draft') {
            const tooltip = t('studio.stage2.tab_draft_tooltip', 'Есть несохранённый черновик заданий');
            const countText = tabState.draftCount > 0 ? tabState.draftCount : t('studio.stage2.tab_draft_short', 'черновик');
            return `<span class="studio-tab-badge studio-tab-badge--draft" title="${escapeHtml(tooltip)}"><span class="studio-tab-dot">●</span> ${escapeHtml(countText)}</span>`;
        }
        if (tabState.status === 'recommended') {
            const tooltip = t('studio.stage2.tab_rec_tooltip', 'Рекомендовано анализом: ~{count} заданий')
                .replace('{count}', tabState.recCount);
            return `<span class="studio-tab-badge studio-tab-badge--rec" title="${escapeHtml(tooltip)}">~${tabState.recCount}</span>`;
        }
        if (tabState.status === 'manual') {
            const label = t('studio.stage2.tab_manual_label', 'Ручной');
            return `<span class="studio-tab-badge studio-tab-badge--manual"><span class="material-symbols-outlined text-[12px]">draw</span> ${escapeHtml(label)}</span>`;
        }
        return '';
    }

    function updateTypeTabStatus(taskType) {
        if (!DOM.typesTabsContainer || !taskType) return;
        const tab = DOM.typesTabsContainer.querySelector(`.studio-type-tab[data-type="${taskType}"]`);
        if (!tab) return;

        const tabState = getTypeTabState(taskType);
        tab.setAttribute('data-status', tabState.status);
        tab.setAttribute('data-ready', tabState.isCommitted ? 'true' : 'false');
        tab.setAttribute('data-draft', tabState.isDraft ? 'true' : 'false');
        tab.setAttribute('data-recommended', tabState.status === 'recommended' ? 'true' : 'false');
        tab.setAttribute('data-manual', tabState.isManual ? 'true' : 'false');

        const badgeHtml = renderTypeTabBadgeHtml(tabState);
        const badgeSlot = tab.querySelector('.studio-tab-badge-slot');
        if (badgeSlot) {
            badgeSlot.innerHTML = badgeHtml;
        } else {
            const label = TASK_TYPE_LABELS[taskType] || taskType;
            tab.innerHTML = `
                <span class="studio-tab-label">${label}</span>
                <span class="studio-tab-badge-slot">${badgeHtml}</span>
            `;
        }
    }

    function renderStage2Tabs() {
        if (!DOM.typesTabsContainer) return;
        DOM.typesTabsContainer.innerHTML = '';

        // Extract recommended types from analysis or fallback to standard 5 types
        const types = ['TEST', 'OPEN_ANSWER', 'SEQUENCE', 'CLICK_TEXT', 'CLICK_WORDS'];
        if (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations)) {
            StudioState.analysisResult.recommendations.forEach((r) => {
                if (r && r.task_type && !types.includes(r.task_type)) {
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

            const tabState = getTypeTabState(t);
            btn.setAttribute('data-status', tabState.status);
            btn.setAttribute('data-ready', tabState.isCommitted ? 'true' : 'false');
            btn.setAttribute('data-draft', tabState.isDraft ? 'true' : 'false');
            btn.setAttribute('data-recommended', tabState.status === 'recommended' ? 'true' : 'false');
            btn.setAttribute('data-manual', tabState.isManual ? 'true' : 'false');

            btn.innerHTML = `
                <span class="studio-tab-label">${TASK_TYPE_LABELS[t] || t}</span>
                <span class="studio-tab-badge-slot">${renderTypeTabBadgeHtml(tabState)}</span>
            `;

            btn.addEventListener('click', () => {
                selectGenerationType(t);
            });

            DOM.typesTabsContainer.appendChild(btn);
        });
    }

    function formatClientPedagogicalDirective(taskType, recommendation, educationalUnits, promptLang) {
        if (!recommendation || typeof recommendation !== 'object') {
            return '';
        }

        let pLang = String(promptLang || 'ru').toLowerCase().trim();
        if (!['ru', 'en', 'uk'].includes(pLang)) {
            pLang = 'ru';
        }

        let countVal = 3;
        if (recommendation.count !== undefined && recommendation.count !== null) {
            const parsed = parseInt(recommendation.count, 10);
            if (!isNaN(parsed) && parsed > 0) {
                countVal = parsed;
            }
        }

        const generationFocus = String(recommendation.generation_focus || recommendation.rationale || '').trim();
        const strategyRaw = String(recommendation.coverage_strategy || '').trim().toLowerCase();

        let anchorsRaw = recommendation.assessable_anchors || [];
        if (!Array.isArray(anchorsRaw)) {
            anchorsRaw = anchorsRaw ? [String(anchorsRaw)] : [];
        }
        const anchors = anchorsRaw.filter((a) => a != null).map((a) => String(a).trim()).filter(Boolean);

        let candidatesRaw = recommendation.design_candidates || [];
        if (!Array.isArray(candidatesRaw)) {
            candidatesRaw = candidatesRaw ? [String(candidatesRaw)] : [];
        }
        const candidates = candidatesRaw.filter((c) => c != null).map((c) => String(c).trim()).filter(Boolean);

        const coversUnits = Array.isArray(recommendation.covers_units) ? recommendation.covers_units : [];
        let matchedUnits = [];
        if (Array.isArray(educationalUnits) && educationalUnits.length > 0) {
            if (coversUnits.length > 0) {
                const coversSet = new Set(coversUnits.map((u) => String(u).trim()));
                matchedUnits = educationalUnits.filter((u) => {
                    if (!u || typeof u !== 'object') return false;
                    const idStr = String(u.id || '').trim();
                    const titleStr = String(u.title || '').trim();
                    return coversSet.has(idStr) || coversSet.has(titleStr);
                });
            }
            if (matchedUnits.length === 0 && educationalUnits.length <= 4) {
                matchedUnits = educationalUnits.filter((u) => u && typeof u === 'object');
            }
        }

        if (!generationFocus && anchors.length === 0 && candidates.length === 0 && matchedUnits.length === 0 && !strategyRaw) {
            return '';
        }

        if (pLang === 'en') {
            const strategies = {
                misconception_first: 'Addressing common misconceptions, false assumptions, and subtle distinctions',
                high_risk_first: 'Testing critical risk points, edge conditions, boundary values, and safety boundaries',
                breadth_first: 'Broad systematic coverage of core concepts, definitions, and facts',
                structure_first: 'Structuring logical relationships, chronological processes, and classification hierarchies',
                visual_first: 'Visual identification, spatial relationships, and landmark recognition',
            };
            const strategyDesc = strategies[strategyRaw] || strategyRaw || 'Pedagogical alignment with lecture material';

            const lines = [
                '<pedagogical_directive>',
                'PIPELINE STAGE: Task generation grounded in the prior pedagogical material analysis.',
                `TARGET TASK TYPE: ${taskType}`,
                `TARGET QUANTITY: Generate exactly ${countVal} tasks of this type.`,
            ];
            if (generationFocus) {
                lines.push('', 'PEDAGOGICAL GENERATION FOCUS:', generationFocus);
            }
            if (strategyDesc) {
                lines.push('', 'COVERAGE STRATEGY:', strategyDesc);
            }
            if (anchors.length > 0) {
                lines.push('', 'ASSESSABLE ANCHORS & TRAPS (Incorporate these specific elements):', ...anchors.map((a) => `- ${a}`));
            }
            if (matchedUnits.length > 0) {
                const unitLines = matchedUnits.slice(0, 5).map((u) => {
                    const title = u.title || `Unit ${u.id || ''}`;
                    const desc = u.description || '';
                    return desc ? `- ${title}: ${desc}` : `- ${title}`;
                });
                lines.push('', 'TARGET EDUCATIONAL UNITS COVERED:', ...unitLines);
            }
            if (candidates.length > 0) {
                lines.push('', 'DRAFT DESIGN CANDIDATES (Use as inspiration / starting points):', ...candidates.slice(0, 4).map((c) => `- ${c}`));
            }
            lines.push('</pedagogical_directive>');
            return lines.join('\n');
        } else if (pLang === 'uk') {
            const strategies = {
                misconception_first: t('studio.prompt.strategy_misconceptions_uk', 'Виявлення типових помилкових уявлень, хибних припущень і тонких відмінностей'),
                high_risk_first: t('studio.prompt.strategy_high_risk_uk', 'Перевірка критичних точок, граничних умов, параметрів безпеки та зон ризику'),
                breadth_first: t('studio.prompt.strategy_breadth_uk', 'Широке системне охоплення ключових понять, термінів та визначень теми'),
                structure_first: t('studio.prompt.strategy_structure_uk', 'Аналіз і складання логічної структури, послідовностей, етапів та ієрархій'),
                visual_first: t('studio.prompt.strategy_visual_uk', 'Візуальний фокус, просторове розташування та розпізнавання орієнтирів'),
            };
            const strategyDesc = strategies[strategyRaw] || strategyRaw || t('studio.prompt.strategy_default_uk', 'Методична відповідність матеріалу лекції');

            const lines = [
                '<pedagogical_directive>',
                t('studio.prompt.directive_stage_uk', 'ЕТАП ПАЙПЛАЙНУ: Генерація завдань за результатами попереднього методичного аналізу лекції.'),
                t('studio.prompt.task_type_prefix_uk', 'ТИП ЗАВДАНЬ: {type}').replace('{type}', taskType),
                t('studio.prompt.task_count_prefix_uk', 'КІЛЬКІСТЬ ЗАВДАНЬ: Згенеруй рівно {count} завдань цього типу.').replace('{count}', countVal),
            ];
            if (generationFocus) {
                lines.push('', t('studio.prompt.focus_header_uk', 'ЦІЛЬОВИЙ ПЕДАГОГІЧНИЙ ФОКУС:'), generationFocus);
            }
            if (strategyDesc) {
                lines.push('', t('studio.prompt.strategy_header_uk', 'СТРАТЕГІЯ ПЕРЕВІРКИ:'), strategyDesc);
            }
            if (anchors.length > 0) {
                lines.push('', t('studio.prompt.anchors_header_uk', "ЗМІСТОВІ ОПОРИ ТА ПАСТКИ ДЛЯ ПЕРЕВІРКИ (Обов'язково використай):"), ...anchors.map((a) => `- ${a}`));
            }
            if (matchedUnits.length > 0) {
                const unitLines = matchedUnits.slice(0, 5).map((u) => {
                    const title = u.title || t('studio.prompt.unit_fallback_uk', 'Одиниця {id}').replace('{id}', u.id || '');
                    const desc = u.description || '';
                    return desc ? `- ${title}: ${desc}` : `- ${title}`;
                });
                lines.push('', t('studio.prompt.units_header_uk', "ПОВ'ЯЗАНІ ОСВІТНІ ОДИНИЦІ:"), ...unitLines);
            }
            if (candidates.length > 0) {
                lines.push('', t('studio.prompt.candidates_header_uk', 'ПОПЕРЕДНІ ЗАГОТОВКИ З АНАЛІЗУ (Використовуй як орієнтир):'), ...candidates.slice(0, 4).map((c) => `- ${c}`));
            }
            lines.push('</pedagogical_directive>');
            return lines.join('\n');
        } else {
            const strategies = {
                misconception_first: t('studio.prompt.strategy_misconceptions', 'Выявление типичных заблуждений, ложных предпосылок и тонких различий'),
                high_risk_first: t('studio.prompt.strategy_high_risk', 'Проверка критических точек, граничных условий, параметров безопасности и зон риска'),
                breadth_first: t('studio.prompt.strategy_breadth', 'Широкий системный охват ключевых понятий, терминов и определений темы'),
                structure_first: t('studio.prompt.strategy_structure', 'Анализ и сборка логической структуры, последовательностей, этапов и иерархий'),
                visual_first: t('studio.prompt.strategy_visual', 'Визуальный фокус, пространственное сопоставление и распознавание ориентиров'),
            };
            const strategyDesc = strategies[strategyRaw] || strategyRaw || t('studio.prompt.strategy_default', 'Методическое соответствие материалу лекции');

            const lines = [
                '<pedagogical_directive>',
                t('studio.prompt.directive_stage', 'ЭТАП ПАЙПЛАЙНА: Генерация заданий по результатам предварительного методического анализа лекции.'),
                t('studio.prompt.task_type_prefix', 'ТИП ЗАДАНИЙ: {type}').replace('{type}', taskType),
                t('studio.prompt.task_count_prefix', 'КОЛИЧЕСТВО ЗАДАНИЙ: Сгенерируй ровно {count} заданий данного типа.').replace('{count}', countVal),
            ];
            if (generationFocus) {
                lines.push('', t('studio.prompt.focus_header', 'ЦЕЛЕВОЙ ПЕДАГОГИЧЕСКИЙ ФОКУС:'), generationFocus);
            }
            if (strategyDesc) {
                lines.push('', t('studio.prompt.strategy_header', 'СТРАТЕГИЯ ПРОВЕРКИ:'), strategyDesc);
            }
            if (anchors.length > 0) {
                lines.push('', t('studio.prompt.anchors_header', 'СОДЕРЖАТЕЛЬНЫЕ ОПОРЫ И ЛОВУШКИ ДЛЯ ПРОВЕРКИ (Обязательно задействуй):'), ...anchors.map((a) => `- ${a}`));
            }
            if (matchedUnits.length > 0) {
                const unitLines = matchedUnits.slice(0, 5).map((u) => {
                    const title = u.title || t('studio.prompt.unit_fallback', 'Единица {id}').replace('{id}', u.id || '');
                    const desc = u.description || '';
                    return desc ? `- ${title}: ${desc}` : `- ${title}`;
                });
                lines.push('', t('studio.prompt.units_header', 'СВЯЗАННЫЕ ОБРАЗОВАТЕЛЬНЫЕ ЕДИНИЦЫ:'), ...unitLines);
            }
            if (candidates.length > 0) {
                lines.push('', t('studio.prompt.candidates_header', 'ПРЕДВАРИТЕЛЬНЫЕ ЗАГОТОВКИ ИЗ АНАЛИЗА (Используй как отправную точку):'), ...candidates.slice(0, 4).map((c) => `- ${c}`));
            }
            lines.push('</pedagogical_directive>');
            return lines.join('\n');
        }
    }

    function getEnrichedPromptForType(taskType, basePrompt, overridePromptLang) {
        if (!basePrompt) return '';
        if (!StudioState.analysisResult || !Array.isArray(StudioState.analysisResult.recommendations)) {
            return basePrompt;
        }
        const rec = StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType);
        if (!rec) {
            return basePrompt;
        }
        const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
        const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
        const promptLang = overridePromptLang || ((targetLang === 'source') ? 'en' : currentLang);
        const units = Array.isArray(StudioState.analysisResult.educational_units) ? StudioState.analysisResult.educational_units : [];
        const directive = formatClientPedagogicalDirective(taskType, rec, units, promptLang);
        if (!directive) {
            return basePrompt;
        }
        return directive + '\n\n' + basePrompt;
    }

    function isManualVisualType(taskType, rec = null) {
        const norm = String(taskType || '').trim().toUpperCase();
        if (norm === 'CLICK' || norm === 'DRAW') return true;
        if (rec && (rec.manual_only || rec.recommendation_status === 'recommended_manual')) return true;
        return false;
    }

    function buildVisualGuidanceText(taskType, rec) {
        const typeLabel = TASK_TYPE_LABELS[taskType] || taskType;
        const topicName = StudioState.selectedTopicName || t('studio.prompt.default_topic', 'Тема');
        const manual = (rec && rec.manual_authoring) ? rec.manual_authoring : {};
        const focus = rec?.generation_focus || manual.why_visual || rec?.rationale || '';
        const targets = (Array.isArray(manual.target_objects) && manual.target_objects.length > 0)
            ? manual.target_objects
            : (Array.isArray(rec?.assessable_anchors) ? rec.assessable_anchors : []);
        const stem = manual.task_stem_example || '';
        const hint = manual.polygon_hint || '';

        const lines = [
            t('studio.prompt.visual_guidance_header', '# МЕТОДИЧЕСКИЕ ОРИЕНТИРЫ ДЛЯ ВИЗУАЛЬНОГО ЗАДАНИЯ ({type})').replace('{type}', typeLabel),
            t('studio.prompt.topic_label', 'Тема: {topic}').replace('{topic}', topicName),
        ];
        if (focus) {
            lines.push('\n' + t('studio.prompt.focus_title', '## Целевой фокус:') + '\n' + focus);
        }
        if (targets.length > 0) {
            lines.push('\n' + t('studio.prompt.targets_title', '## Рекомендуемые ориентиры и структуры для разметки:'));
            targets.forEach((targetItem) => lines.push(`- ${targetItem}`));
        }
        if (stem) {
            lines.push('\n' + t('studio.prompt.stem_example_title', '## Пример формулировки задания:') + '\n' + stem);
        }
        if (hint) {
            lines.push('\n' + t('studio.prompt.geometry_hint_title', '## Подсказка по геометрии/разметке:') + '\n' + hint);
        }
        return lines.join('\n');
    }

    function renderManualVisualView(taskType, rec) {
        if (!DOM.typeManualVisualView) return;

        const isDraw = taskType === 'DRAW';
        const typeLabel = TASK_TYPE_LABELS[taskType] || taskType;

        // 1. Icon & Titles
        if (DOM.manualVisualIcon) {
            DOM.manualVisualIcon.textContent = isDraw ? 'draw' : 'ads_click';
        }
        if (DOM.manualVisualTitle) {
            DOM.manualVisualTitle.textContent = `${t('studio.stage2.visual_mode_title', 'Интерактивное задание на изображении')}: ${typeLabel}`;
        }

        // 2. Open Visual Editor Button Link
        if (DOM.btnOpenVisualEditor) {
            const mod = StudioState.selectedModuleId || '';
            const top = StudioState.selectedTopicId || '';
            const edType = isDraw ? 'draw' : 'click';
            const params = new URLSearchParams({
                module: mod,
                topic: top,
                task_type: edType,
                new: '1',
            });
            DOM.btnOpenVisualEditor.href = `/editor/Point_Annotation.html?${params.toString()}`;
            if (DOM.labelOpenVisualEditor) {
                DOM.labelOpenVisualEditor.textContent = `${t('studio.stage2.btn_open_visual_editor', 'Открыть визуальный редактор')} (${typeLabel})`;
            }
        }

        // 3. Targets List
        if (DOM.manualVisualTargetsList) {
            const manual = (rec && rec.manual_authoring) ? rec.manual_authoring : {};
            const targets = (Array.isArray(manual.target_objects) && manual.target_objects.length > 0)
                ? manual.target_objects
                : (Array.isArray(rec?.assessable_anchors) ? rec.assessable_anchors : []);

            if (targets.length > 0) {
                DOM.manualVisualTargetsList.innerHTML = targets
                    .map((tgt) => `<li><span class="font-medium text-text-main">${escapeHtml(tgt)}</span></li>`)
                    .join('');
            } else {
                DOM.manualVisualTargetsList.innerHTML = `<li>${escapeHtml(t('studio.stage2.visual_target_default', 'Локализуйте ключевые визуальные ориентиры и анатомические структуры по материалу лекции'))}</li>`;
            }

            // Hint
            if (DOM.manualVisualHint) {
                const stem = manual.task_stem_example || '';
                const hint = manual.polygon_hint || '';
                const hintParts = [];
                if (stem) hintParts.push(t('studio.prompt.stem_example_fmt', 'Пример формулировки: «{stem}»').replace('{stem}', stem));
                if (hint) hintParts.push(t('studio.prompt.hint_fmt', 'Подсказка: {hint}').replace('{hint}', hint));
                if (hintParts.length > 0) {
                    DOM.manualVisualHint.textContent = hintParts.join(' • ');
                    DOM.manualVisualHint.classList.remove('hidden');
                } else {
                    DOM.manualVisualHint.classList.add('hidden');
                }
            }
        }
    }

    async function selectGenerationType(taskType) {
        StudioState.activeGenerationType = taskType;

        const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
            ? StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType)
            : null;
        const isManualVisual = isManualVisualType(taskType, rec);

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
            const btnKey = isManualVisual ? 'studio.stage2.btn_copy_visual_guidance' : 'studio.stage2.btn_copy_type_prompt';
            const defaultBtnLabel = isManualVisual ? t('studio.stage2.btn_copy_visual_guidance', 'Скопировать методические ориентиры') : t('studio.stage2.btn_copy_type_prompt', 'Скопировать промпт для заданий');
            DOM.labelCopyTypePrompt.textContent = `${t(btnKey, defaultBtnLabel)} (${TASK_TYPE_LABELS[taskType] || taskType})`;
        }

        // Pedagogical focus from analysis
        let focusText = t('studio.stage2.select_direction_hint', 'Выберите направление сверху для формирования точечного промпта.');
        let stratInfo = null;
        let hasAnalysisRec = false;
        if (rec) {
            hasAnalysisRec = true;
            focusText = rec.generation_focus || rec.rationale || focusText;
            if (rec.coverage_strategy) {
                stratInfo = getStrategyInfo(rec.coverage_strategy);
            }
        }
        if (DOM.focusUnitsDescription) {
            DOM.focusUnitsDescription.textContent = focusText;
        }
        if (DOM.focusPaneCoverageBadge) {
            if (stratInfo && stratInfo.label) {
                DOM.focusPaneCoverageBadge.innerHTML = `
                    <span class="material-symbols-outlined text-[13px] strategy-icon">${escapeHtml(stratInfo.icon || 'tune')}</span>
                    <span class="strategy-label">${escapeHtml(stratInfo.fullLabel || stratInfo.label)}</span>
                `;
                const tooltip = stratInfo.tooltip || stratInfo.fullLabel || stratInfo.label;
                DOM.focusPaneCoverageBadge.setAttribute('title', tooltip);
                DOM.focusPaneCoverageBadge.classList.remove('hidden');
            } else {
                DOM.focusPaneCoverageBadge.classList.add('hidden');
                DOM.focusPaneCoverageBadge.removeAttribute('title');
            }
        }
        if (DOM.focusInjectedBadge) {
            if (hasAnalysisRec) {
                DOM.focusInjectedBadge.classList.remove('hidden');
            } else {
                DOM.focusInjectedBadge.classList.add('hidden');
            }
        }

        // Prompt Preview or Visual Guidance
        if (isManualVisual) {
            const guidanceText = buildVisualGuidanceText(taskType, rec);
            updatePromptPreview(guidanceText);
        } else {
            // Load canonical prompt for type in background
            loadGenerationPromptForType(taskType);
        }

        // Restore response textarea from draft or show committed view
        const draft = StudioState.typeDrafts[taskType] || { responseText: '', parsedTasks: [], isCommitted: false };
        if (DOM.typeResponseInput) {
            DOM.typeResponseInput.value = draft.responseText || '';
        }
        if (draft.isCommitted && Array.isArray(draft.parsedTasks) && draft.parsedTasks.length > 0) {
            if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.add('hidden');
            if (DOM.typeResponseInput) DOM.typeResponseInput.classList.add('hidden');
            renderCommittedView(taskType);
        } else if (isManualVisual) {
            if (DOM.paneResponseIcon) DOM.paneResponseIcon.textContent = 'edit_note';
            if (DOM.paneResponseTitle) {
                DOM.paneResponseTitle.setAttribute('data-i18n', 'studio.stage2.paste_type_response_title');
                DOM.paneResponseTitle.textContent = t('studio.stage2.paste_type_response_title', 'Вставьте ответ ИИ');
            }
            if (DOM.btnPasteTypeResponse) DOM.btnPasteTypeResponse.classList.remove('hidden');
            if (DOM.typeCommittedView) DOM.typeCommittedView.classList.add('hidden');
            if (DOM.typeResponseInput) DOM.typeResponseInput.classList.add('hidden');
            if (DOM.typeManualVisualView) {
                DOM.typeManualVisualView.classList.remove('hidden');
                renderManualVisualView(taskType, rec);
            }
        } else {
            if (DOM.paneResponseIcon) DOM.paneResponseIcon.textContent = 'edit_note';
            if (DOM.paneResponseTitle) {
                DOM.paneResponseTitle.setAttribute('data-i18n', 'studio.stage2.paste_type_response_title');
                DOM.paneResponseTitle.textContent = t('studio.stage2.paste_type_response_title', 'Вставьте ответ ИИ');
            }
            if (DOM.btnPasteTypeResponse) DOM.btnPasteTypeResponse.classList.remove('hidden');
            if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.add('hidden');
            if (DOM.typeCommittedView) DOM.typeCommittedView.classList.add('hidden');
            if (DOM.typeResponseInput) DOM.typeResponseInput.classList.remove('hidden');
        }
        runClientRegexCounter(draft.responseText || '', taskType);
    }

    async function loadGenerationPromptForType(taskType) {
        const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
        const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
        const promptLang = (targetLang === 'source') ? 'en' : currentLang;
        const cacheKey = `${taskType}_${promptLang}_${targetLang}`;
        if (StudioState.cachedPrompts.generation[cacheKey]) {
            const basePrompt = StudioState.cachedPrompts.generation[cacheKey];
            updatePromptPreview(getEnrichedPromptForType(taskType, basePrompt));
            return;
        }

        try {
            const res = await fetch(`/api/editor/studio/prompts?type=generation&task_type=${taskType}&prompt_lang=${encodeURIComponent(promptLang)}&target_lang=${encodeURIComponent(targetLang)}`);
            if (res.ok) {
                const data = await res.json();
                const basePrompt = data.prompt || '';
                StudioState.cachedPrompts.generation[cacheKey] = basePrompt;
                updatePromptPreview(getEnrichedPromptForType(taskType, basePrompt));
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

    async function pasteResponseFromClipboard() {
        const taskType = StudioState.activeGenerationType;
        const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
            ? StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType)
            : null;
        const isManualVisual = isManualVisualType(taskType, rec);

        let text = '';
        if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.readText === 'function') {
            try {
                text = await navigator.clipboard.readText();
            } catch (err) {
                console.warn('[Studio] Clipboard readText failed or denied:', err);
            }
        }

        if (isManualVisual) {
            if (DOM.manualSpecTextarea) {
                const details = DOM.manualSpecTextarea.closest('details');
                if (details) details.open = true;
                if (text && text.trim()) {
                    DOM.manualSpecTextarea.value = text;
                    DOM.manualSpecTextarea.focus();
                    showToast(t('studio.stage2.paste_success_toast', 'Ответ нейросети успешно вставлен!'), 'success');
                } else {
                    DOM.manualSpecTextarea.focus();
                    showToast(t('studio.stage2.paste_manual_hint_toast', 'Вставьте скопированный ответ клавишами Ctrl+V (Cmd+V)'), 'info');
                }
            }
            return;
        }

        if (text && text.trim()) {
            if (DOM.typeResponseInput) {
                DOM.typeResponseInput.value = text;
                if (!StudioState.typeDrafts[StudioState.activeGenerationType]) {
                    StudioState.typeDrafts[StudioState.activeGenerationType] = { responseText: '', parsedTasks: [], isCommitted: false };
                }
                StudioState.typeDrafts[StudioState.activeGenerationType].responseText = text;
                StudioState.typeDrafts[StudioState.activeGenerationType].isCommitted = false;

                runClientRegexCounter(text, StudioState.activeGenerationType);
                updateTypeTabStatus(StudioState.activeGenerationType);
                markDirty();

                DOM.typeResponseInput.focus();
                DOM.typeResponseInput.classList.remove('studio-field-pulse');
                void DOM.typeResponseInput.offsetWidth;
                DOM.typeResponseInput.classList.add('studio-field-pulse');

                showToast(t('studio.stage2.paste_success_toast', 'Ответ нейросети успешно вставлен!'), 'success');
            }
        } else {
            if (DOM.typeResponseInput) {
                DOM.typeResponseInput.focus();
                DOM.typeResponseInput.classList.remove('studio-field-pulse');
                void DOM.typeResponseInput.offsetWidth;
                DOM.typeResponseInput.classList.add('studio-field-pulse');
            }
            showToast(t('studio.stage2.paste_manual_hint_toast', 'Вставьте скопированный ответ клавишами Ctrl+V (Cmd+V)'), 'info');
        }
    }

    function renderCommittedView(taskType) {
        if (!DOM.typeCommittedView || !DOM.typeResponseInput) return;
        const draft = StudioState.typeDrafts[taskType];
        if (!draft || !draft.isCommitted || !Array.isArray(draft.parsedTasks) || draft.parsedTasks.length === 0) {
            if (DOM.paneResponseIcon) DOM.paneResponseIcon.textContent = 'edit_note';
            if (DOM.paneResponseTitle) {
                DOM.paneResponseTitle.setAttribute('data-i18n', 'studio.stage2.paste_type_response_title');
                DOM.paneResponseTitle.textContent = t('studio.stage2.paste_type_response_title', 'Вставьте ответ ИИ');
            }
            if (DOM.btnPasteTypeResponse) DOM.btnPasteTypeResponse.classList.remove('hidden');
            DOM.typeCommittedView.classList.add('hidden');
            const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
                ? StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType)
                : null;
            if (isManualVisualType(taskType, rec)) {
                if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.remove('hidden');
                if (DOM.typeResponseInput) DOM.typeResponseInput.classList.add('hidden');
            } else {
                if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.add('hidden');
                DOM.typeResponseInput.classList.remove('hidden');
            }
            return;
        }

        // Hide raw textarea and manual visual view, show committed view
        if (DOM.typeResponseInput) DOM.typeResponseInput.classList.add('hidden');
        if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.add('hidden');
        DOM.typeCommittedView.classList.remove('hidden');

        // Update pane header for committed state
        const count = draft.parsedTasks.length;
        if (DOM.paneResponseIcon) DOM.paneResponseIcon.textContent = 'task_alt';
        if (DOM.paneResponseTitle) {
            DOM.paneResponseTitle.removeAttribute('data-i18n');
            DOM.paneResponseTitle.textContent = t('studio.stage2.tasks_committed_header', 'Принятые задания ({count})').replace('{count}', count);
        }
        if (DOM.btnPasteTypeResponse) DOM.btnPasteTypeResponse.classList.add('hidden');

        // Title with count and type label
        if (DOM.committedViewTitle) {
            const count = draft.parsedTasks.length;
            const typeLabel = TASK_TYPE_LABELS[taskType] || taskType;
            DOM.committedViewTitle.textContent = t('studio.stage2.committed_view_title', 'Задания успешно приняты в витрину ({count})')
                .replace('{count}', `${count} ${pluralizeTasks(count)} ` + t('studio.stage2.type_quote_fmt', 'типа «{type}»').replace('{type}', typeLabel));
        }

        // Raw code preview in collapsible details
        if (DOM.typeCommittedRawCode) {
            DOM.typeCommittedRawCode.textContent = draft.responseText || '';
        }

        // Cards list
        if (DOM.typeCommittedCardsList) {
            DOM.typeCommittedCardsList.innerHTML = '';
            draft.parsedTasks.forEach((task, idx) => {
                const card = document.createElement('div');
                card.className = 'studio-committed-mini-card';

                const { questionTitle } = extractTaskDisplayInfo(task, idx);

                card.innerHTML = `
                    <div class="studio-committed-mini-card__header">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">№${idx + 1}</span>
                        <div class="flex items-center gap-1.5">
                            <span class="studio-unit-badge bg-primary-light text-primary font-bold">${TASK_TYPE_LABELS[taskType] || taskType}</span>
                            <button type="button" class="btn-preview-committed-task btn-action-ghost text-text-muted hover:text-primary transition-colors p-0.5 rounded cursor-pointer" title="${escapeHtml(t('studio.stage3.preview_btn_tooltip', 'Просмотреть задание целиком'))}">
                                <span class="material-symbols-outlined text-[15px]">visibility</span>
                            </button>
                        </div>
                    </div>
                    <p class="studio-task-card-title text-xs font-bold text-text-main leading-relaxed line-clamp-2 cursor-pointer hover:text-primary transition-colors" title="${escapeHtml(questionTitle)}">${escapeHtml(questionTitle)}</p>
                    ${renderTaskPreviewSnippet(task)}
                `;

                const previewBtn = card.querySelector('.btn-preview-committed-task');
                const titleEl = card.querySelector('.studio-task-card-title');
                const openPreview = (e) => {
                    e.stopPropagation();
                    const allTasksIdx = StudioState.allTasks.indexOf(task);
                    openTaskPreviewModal(task, allTasksIdx >= 0 ? allTasksIdx : 0);
                };
                if (previewBtn) previewBtn.addEventListener('click', openPreview);
                if (titleEl) titleEl.addEventListener('click', openPreview);

                attachSnippetExpansionListeners(card);

                DOM.typeCommittedCardsList.appendChild(card);
            });
        }
    }

    function commitManualSpec() {
        if (!DOM.manualSpecTextarea) return;
        const raw = DOM.manualSpecTextarea.value.trim();
        if (!raw) {
            showToast(t('studio.stage2.no_tasks_text', 'Нет текста заданий для сохранения'), 'warning');
            return;
        }

        const taskType = StudioState.activeGenerationType;
        try {
            let parsed = [];
            if (raw.startsWith('{') || raw.startsWith('[')) {
                const json = JSON.parse(raw);
                const items = Array.isArray(json) ? json : [json];
                parsed = items.map((it, idx) => ({
                    id: it.id || `spec_${Date.now()}_${idx + 1}`,
                    type: (it.type || it.task_type || taskType).toLowerCase(),
                    task_type: (it.task_type || it.type || taskType).toUpperCase(),
                    title: it.title || it.question || it.name || `${TASK_TYPE_LABELS[taskType] || taskType} #${idx + 1}`,
                    question: it.question || it.title || '',
                    task_data: it.task_data || it,
                    module: StudioState.selectedModuleId,
                    topic: StudioState.selectedTopicId,
                }));
            } else {
                parsed = [{
                    id: `spec_${Date.now()}_1`,
                    type: taskType.toLowerCase(),
                    task_type: taskType,
                    title: `${TASK_TYPE_LABELS[taskType] || taskType} #1`,
                    raw_text: raw,
                    module: StudioState.selectedModuleId,
                    topic: StudioState.selectedTopicId,
                }];
            }

            if (!StudioState.typeDrafts[taskType]) {
                StudioState.typeDrafts[taskType] = { responseText: '', parsedTasks: [], isCommitted: false };
            }
            StudioState.typeDrafts[taskType].responseText = raw;
            StudioState.typeDrafts[taskType].parsedTasks = parsed;
            StudioState.typeDrafts[taskType].isCommitted = true;

            StudioState.allTasks = StudioState.allTasks.filter((t) => (t.task_type || t.type || '').toUpperCase() !== taskType);
            parsed.forEach((t) => StudioState.allTasks.push(t));

            renderStage2Tabs();
            updateProceedToStep3Button();
            renderCommittedView(taskType);
            showToast(t('studio.stage2.spec_applied_toast', 'Спецификация успешно применена!'), 'success');
            markDirty();
        } catch (err) {
            console.warn('[Studio] Manual spec commit error:', err);
            showToast(t('studio.stage2.spec_error_toast', 'Ошибка парсинга спецификации. Проверьте формат JSON.'), 'error');
        }
    }

    function switchToEditMode() {
        if (!DOM.typeCommittedView) return;
        const taskType = StudioState.activeGenerationType;
        const draft = StudioState.typeDrafts[taskType];
        if (draft) {
            draft.isCommitted = false;
        }

        const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
            ? StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType)
            : null;
        const isManualVisual = isManualVisualType(taskType, rec);

        DOM.typeCommittedView.classList.add('hidden');
        if (DOM.paneResponseIcon) DOM.paneResponseIcon.textContent = 'edit_note';
        if (DOM.paneResponseTitle) {
            DOM.paneResponseTitle.setAttribute('data-i18n', 'studio.stage2.paste_type_response_title');
            DOM.paneResponseTitle.textContent = t('studio.stage2.paste_type_response_title', 'Вставьте ответ ИИ');
        }
        if (DOM.btnPasteTypeResponse) DOM.btnPasteTypeResponse.classList.remove('hidden');
        if (isManualVisual) {
            if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.remove('hidden');
            if (DOM.typeResponseInput) DOM.typeResponseInput.classList.add('hidden');
            renderManualVisualView(taskType, rec);
        } else {
            if (DOM.typeManualVisualView) DOM.typeManualVisualView.classList.add('hidden');
            if (DOM.typeResponseInput) {
                DOM.typeResponseInput.classList.remove('hidden');
                DOM.typeResponseInput.value = (draft && draft.responseText) || '';
                runClientRegexCounter(DOM.typeResponseInput.value, taskType);
                DOM.typeResponseInput.focus();
            }
        }

        updateStage2ActionButtons();
        renderStage2Tabs();
        markDirty();
    }

    function initStage2() {
        // Switch to edit mode button
        if (DOM.btnEditTypeTasks) {
            DOM.btnEditTypeTasks.addEventListener('click', switchToEditMode);
        }

        // Commit manual spec button
        if (DOM.btnCommitManualSpec) {
            DOM.btnCommitManualSpec.addEventListener('click', commitManualSpec);
        }

        // Copy type prompt
        if (DOM.btnCopyTypePrompt) {
            DOM.btnCopyTypePrompt.addEventListener('click', async () => {
                const taskType = StudioState.activeGenerationType;
                const rec = (StudioState.analysisResult && Array.isArray(StudioState.analysisResult.recommendations))
                    ? StudioState.analysisResult.recommendations.find((r) => r.task_type === taskType)
                    : null;
                const isManualVisual = isManualVisualType(taskType, rec);

                if (isManualVisual) {
                    const guidance = buildVisualGuidanceText(taskType, rec);
                    try {
                        if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                            await navigator.clipboard.writeText(guidance);
                            showToast(t('studio.stage1.prompt_copied', 'Методические ориентиры скопированы!'), 'success');
                            return;
                        }
                    } catch (e) {
                        showToast(t('studio.stage1.parsing_error', 'Ошибка копирования'), 'error');
                        return;
                    }
                }

                const currentLang = (typeof window !== 'undefined' && window.i18n && typeof window.i18n.getLang === 'function') ? window.i18n.getLang() : 'ru';
                const targetLang = StudioState.targetLanguage || getDefaultTargetLanguage();
                const promptLang = (targetLang === 'source') ? 'en' : currentLang;
                const cacheKey = `${StudioState.activeGenerationType}_${promptLang}_${targetLang}`;
                let basePrompt = StudioState.cachedPrompts.generation[cacheKey] || '';
                if (!basePrompt) {
                    await loadGenerationPromptForType(StudioState.activeGenerationType);
                    basePrompt = StudioState.cachedPrompts.generation[cacheKey] || '';
                }
                if (!basePrompt) {
                    showToast(t('studio.stage1.parsing_error', 'Промпт не загружен'), 'error');
                    return;
                }
                const promptToCopy = getEnrichedPromptForType(StudioState.activeGenerationType, basePrompt);
                try {
                    await navigator.clipboard.writeText(promptToCopy);
                    const label = TASK_TYPE_LABELS[StudioState.activeGenerationType] || StudioState.activeGenerationType;
                    showToast(t('studio.stage1.prompt_copied', `Промпт для ${label} скопирован!`), 'success');
                } catch (e) {
                    showToast(t('studio.stage1.parsing_error', 'Ошибка копирования'), 'error');
                }
            });
        }

        // Paste type response from clipboard
        if (DOM.btnPasteTypeResponse) {
            DOM.btnPasteTypeResponse.addEventListener('click', pasteResponseFromClipboard);
        }

        // Live typing in response
        if (DOM.typeResponseInput) {
            DOM.typeResponseInput.addEventListener('input', () => {
                const val = DOM.typeResponseInput.value;
                if (!StudioState.typeDrafts[StudioState.activeGenerationType]) {
                    StudioState.typeDrafts[StudioState.activeGenerationType] = { responseText: '', parsedTasks: [], isCommitted: false };
                }
                StudioState.typeDrafts[StudioState.activeGenerationType].responseText = val;
                StudioState.typeDrafts[StudioState.activeGenerationType].isCommitted = false;

                updateTypeTabStatus(StudioState.activeGenerationType);

                clearTimeout(liveParseDebounceTimer);
                liveParseDebounceTimer = setTimeout(() => {
                    runClientRegexCounter(val, StudioState.activeGenerationType);
                    updateTypeTabStatus(StudioState.activeGenerationType);
                }, 150);

                markDirty();
            });
        }

        // Commit tasks of this type (footer button)
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
        updateStage2ActionButtons();
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
            showToast(t('studio.toast.no_tasks_to_save', 'Нет текста заданий для сохранения'), 'warning');
            return;
        }

        if (!StudioState.selectedModuleId || !StudioState.selectedTopicId) {
            openTopicModal();
            showToast(t('studio.toast.select_module_topic', 'Выберите модуль и тему курса'), 'warning');
            return;
        }

        showToast(t('studio.toast.validating_schema', 'Серверная валидация схемы заданий...'), 'info');

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
                showToast(data.message || t('studio.toast.schema_parse_error', 'Ошибка парсинга схемы заданий'), 'error');
                return;
            }

            const parsed = data.tasks || [];
            if (parsed.length === 0) {
                showToast(t('studio.toast.no_valid_tasks', 'Не удалось распознать корректные задания'), 'warning');
                return;
            }

            // Store in draft
            draft.parsedTasks = parsed;
            draft.isCommitted = true;

            // Merge into allTasks (replace previous parsed tasks of this type)
            const normType = normalizeTaskType(taskType);
            StudioState.allTasks = StudioState.allTasks.filter((t) => {
                const curNorm = normalizeTaskType(t);
                return curNorm !== normType;
            });
            parsed.forEach((t) => {
                t._selected_for_import = true;
                t._studio_id = 't_' + Math.random().toString(36).substring(2, 9);
                if (!t._import_type && taskType) {
                    t._import_type = taskType;
                }
                StudioState.allTasks.push(t);
            });

            renderStage2Tabs();
            updateProceedToStep3Button();
            renderCommittedView(taskType);
            showToast(t('studio.toast.tasks_accepted_fmt', 'Принято {count} заданий типа {type}!').replace('{count}', parsed.length).replace('{type}', TASK_TYPE_LABELS[taskType] || taskType), 'success');
            markDirty();
        } catch (e) {
            console.error('[Studio] Commit error:', e);
            showToast(t('studio.toast.validation_error', 'Ошибка проверки заданий'), 'error');
        }
    }

    // ---------------------------------------------------------------------------
    // 8. Stage 3: Task Showcase & Selective Import
    // ---------------------------------------------------------------------------

    let showcaseFilterType = 'ALL';

    const SHOWCASE_CATEGORIES = [
        {
            key: 'TEST',
            types: ['TEST'],
            labelKey: 'studio.stage3.group_test',
            defaultLabel: t('studio.stage3.group_test', 'Тестовые задания'),
            icon: 'quiz',
        },
        {
            key: 'OPEN_ANSWER',
            types: ['OPEN_ANSWER'],
            labelKey: 'studio.stage3.group_open_answer',
            defaultLabel: t('studio.stage3.group_open_answer', 'Задания с открытым ответом'),
            icon: 'edit_note',
        },
        {
            key: 'SEQUENCE',
            types: ['SEQUENCE'],
            labelKey: 'studio.stage3.group_sequence',
            defaultLabel: t('studio.stage3.group_sequence', 'Последовательности'),
            icon: 'format_list_numbered',
        },
        {
            key: 'CLICK_WORDS',
            types: ['CLICK_WORDS'],
            labelKey: 'studio.stage3.group_click_words',
            defaultLabel: t('studio.stage3.group_click_words', 'Поиск ошибок в тексте'),
            icon: 'find_in_page',
        },
        {
            key: 'CLICK_TEXT',
            types: ['CLICK_TEXT'],
            labelKey: 'studio.stage3.group_click_text',
            defaultLabel: t('studio.stage3.group_click_text', 'Контрастные утверждения'),
            icon: 'rule',
        },
        {
            key: 'VISUAL',
            types: ['CLICK', 'DRAW'],
            labelKey: 'studio.stage3.group_visual',
            defaultLabel: t('studio.stage3.group_visual', 'Интерактивные задания на изображениях'),
            icon: 'image',
        },
    ];

    const OTHER_CATEGORY = {
        key: 'OTHER',
        types: [],
        labelKey: 'studio.stage3.group_other',
        defaultLabel: t('studio.stage3.group_other', 'Другие задания'),
        icon: 'extension',
    };

    function getCategoryForType(canonicalType) {
        const found = SHOWCASE_CATEGORIES.find((cat) => cat.types.includes(canonicalType));
        return found || OTHER_CATEGORY;
    }

    function setupStage3() {
        renderShowcase();
        updateStickyBar();
    }

    let stage3Initialized = false;
    function initStage3() {
        if (stage3Initialized) return;
        stage3Initialized = true;
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

        // Preview modal interactions
        if (DOM.btnClosePreviewModal) {
            DOM.btnClosePreviewModal.addEventListener('click', closeTaskPreviewModal);
        }

        if (DOM.btnClosePreviewFooter) {
            DOM.btnClosePreviewFooter.addEventListener('click', closeTaskPreviewModal);
        }

        if (DOM.modalTaskPreview) {
            DOM.modalTaskPreview.addEventListener('click', (e) => {
                if (e.target === DOM.modalTaskPreview) {
                    closeTaskPreviewModal();
                }
            });
        }

        if (DOM.btnPreviewPrevTask) {
            DOM.btnPreviewPrevTask.addEventListener('click', () => {
                if (currentPreviewIndex > 0) {
                    currentPreviewIndex--;
                    renderTaskPreviewModalContent();
                }
            });
        }

        if (DOM.btnPreviewNextTask) {
            DOM.btnPreviewNextTask.addEventListener('click', () => {
                const tasks = StudioState.allTasks || [];
                if (currentPreviewIndex < tasks.length - 1) {
                    currentPreviewIndex++;
                    renderTaskPreviewModalContent();
                }
            });
        }

        if (DOM.previewTaskSelectCheckbox) {
            DOM.previewTaskSelectCheckbox.addEventListener('change', (e) => {
                const tasks = StudioState.allTasks || [];
                const currentTask = tasks[currentPreviewIndex];
                if (currentTask) {
                    currentTask._selected_for_import = e.target.checked;
                    renderShowcase();
                    updateStickyBar();
                    markDirty();
                }
            });
        }

        if (DOM.btnPreviewToggleRaw) {
            DOM.btnPreviewToggleRaw.addEventListener('click', () => {
                isRawSpecVisible = !isRawSpecVisible;
                renderTaskPreviewModalContent();
            });
        }
    }

    function updateShowcaseSelectAllCheckbox() {
        if (!DOM.showcaseSelectAll) return;
        const tasks = StudioState.allTasks || [];
        if (tasks.length === 0) {
            DOM.showcaseSelectAll.checked = false;
            DOM.showcaseSelectAll.indeterminate = false;
            return;
        }
        const selectedCount = tasks.filter((t) => t._selected_for_import).length;
        if (selectedCount === 0) {
            DOM.showcaseSelectAll.checked = false;
            DOM.showcaseSelectAll.indeterminate = false;
        } else if (selectedCount === tasks.length) {
            DOM.showcaseSelectAll.checked = true;
            DOM.showcaseSelectAll.indeterminate = false;
        } else {
            DOM.showcaseSelectAll.checked = false;
            DOM.showcaseSelectAll.indeterminate = true;
        }
    }

    let currentPreviewIndex = 0;
    let isRawSpecVisible = false;

    function openTaskPreviewModal(task, targetIndex) {
        const tasks = StudioState.allTasks || [];
        if (tasks.length === 0) return;

        if (typeof targetIndex === 'number' && targetIndex >= 0) {
            currentPreviewIndex = targetIndex;
        } else if (task) {
            const idx = tasks.indexOf(task);
            currentPreviewIndex = idx >= 0 ? idx : 0;
        } else {
            currentPreviewIndex = 0;
        }

        if (currentPreviewIndex < 0) currentPreviewIndex = 0;
        if (currentPreviewIndex >= tasks.length) currentPreviewIndex = tasks.length - 1;

        if (DOM.modalTaskPreview) {
            DOM.modalTaskPreview.classList.remove('hidden');
        }
        renderTaskPreviewModalContent();
    }

    function closeTaskPreviewModal() {
        if (DOM.modalTaskPreview) {
            DOM.modalTaskPreview.classList.add('hidden');
        }
        isRawSpecVisible = false;
    }

    function renderTaskPreviewModalContent() {
        const tasks = StudioState.allTasks || [];
        if (tasks.length === 0 || !tasks[currentPreviewIndex]) {
            closeTaskPreviewModal();
            return;
        }

        const task = tasks[currentPreviewIndex];
        const canonicalType = normalizeTaskType(task);
        const { questionTitle, data } = extractTaskDisplayInfo(task, currentPreviewIndex);

        if (DOM.modalPreviewTitle) {
            DOM.modalPreviewTitle.textContent = questionTitle || t('studio.modal.preview_title', 'Просмотр задания');
            DOM.modalPreviewTitle.title = questionTitle || '';
        }
        if (DOM.previewTaskTypeBadge) {
            DOM.previewTaskTypeBadge.textContent = TASK_TYPE_LABELS[canonicalType] || canonicalType;
        }
        if (DOM.previewTaskCounter) {
            DOM.previewTaskCounter.textContent = `${currentPreviewIndex + 1} / ${tasks.length}`;
        }
        if (DOM.btnPreviewPrevTask) {
            DOM.btnPreviewPrevTask.disabled = currentPreviewIndex <= 0;
        }
        if (DOM.btnPreviewNextTask) {
            DOM.btnPreviewNextTask.disabled = currentPreviewIndex >= tasks.length - 1;
        }
        if (DOM.previewTaskSelectCheckbox) {
            DOM.previewTaskSelectCheckbox.checked = Boolean(task._selected_for_import);
        }
        if (DOM.btnPreviewToggleRaw) {
            if (isRawSpecVisible) {
                DOM.btnPreviewToggleRaw.classList.remove('studio-btn--secondary');
                DOM.btnPreviewToggleRaw.classList.add('studio-btn--primary');
            } else {
                DOM.btnPreviewToggleRaw.classList.remove('studio-btn--primary');
                DOM.btnPreviewToggleRaw.classList.add('studio-btn--secondary');
            }
        }

        if (!DOM.taskPreviewContentContainer) return;

        if (isRawSpecVisible) {
            DOM.taskPreviewContentContainer.innerHTML = `
                <div class="flex flex-col gap-2">
                    <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.raw_spec_title', 'Спецификация задания (JSON):')}</span>
                    <pre class="p-3.5 rounded-lg bg-surface-2 border border-border-subtle text-xs font-mono text-text-main overflow-x-auto max-h-[60vh] leading-relaxed select-all">${escapeHtml(JSON.stringify(task, null, 2))}</pre>
                </div>
            `;
            return;
        }

        let bodyHtml = `
            <div class="flex flex-col gap-1.5">
                <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.modal_prompt_label', 'Текст вопроса / задание:')}</span>
                <div class="text-sm font-semibold text-text-main p-3 rounded-lg bg-surface-2 border border-border-subtle leading-relaxed">
                    ${escapeHtml(questionTitle)}
                </div>
            </div>
        `;

        // 1. TEST or CLICK_TEXT options
        const options = extractTestOptions(task, data);

        if (Array.isArray(options) && options.length > 0) {
            const isClickText = canonicalType === 'CLICK_TEXT';
            const groupTitle = isClickText
                ? t('studio.stage3.statements_label', 'Утверждения (верные и мифы):')
                : t('studio.stage3.modal_options_label', 'Варианты ответов:');

            bodyHtml += `
                <div class="flex flex-col gap-1.5">
                    <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${groupTitle}</span>
                    <div class="flex flex-col gap-2">
                        ${options.map((opt) => {
                            const isCorrect = Boolean(opt.is_correct ?? opt.correct ?? false);
                            const optText = typeof opt === 'object' && opt ? (opt.text || opt.title || opt.value || '') : String(opt);

                            if (isClickText) {
                                return `
                                    <div class="flex items-start justify-between gap-3 p-2.5 rounded-lg border ${isCorrect ? 'bg-success/5 border-success/30' : 'bg-surface-2 border-border-subtle'}">
                                        <span class="text-xs text-text-main leading-relaxed font-medium">${escapeHtml(optText)}</span>
                                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${isCorrect ? 'bg-success/15 text-success' : 'bg-surface-3 text-text-muted'}">
                                            <span class="material-symbols-outlined text-[12px]">${isCorrect ? 'check_circle' : 'cancel'}</span>
                                            <span>${isCorrect ? t('studio.stage3.true_statement', 'Верно') : t('studio.stage3.false_statement', 'Ложь / Миф')}</span>
                                        </span>
                                    </div>
                                `;
                            } else {
                                return `
                                    <div class="flex items-start justify-between gap-3 p-2.5 rounded-lg border ${isCorrect ? 'bg-success/5 border-success/30' : 'bg-surface-2 border-border-subtle'}">
                                        <div class="flex items-start gap-2">
                                            <span class="text-xs font-bold ${isCorrect ? 'text-success' : 'text-text-muted'} mt-0.5">${isCorrect ? '✓' : '•'}</span>
                                            <span class="text-xs text-text-main leading-relaxed ${isCorrect ? 'font-semibold' : ''}">${escapeHtml(optText)}</span>
                                        </div>
                                        ${isCorrect ? `
                                            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 bg-success/15 text-success">
                                                <span>${t('studio.stage3.correct_answer_badge', 'Правильный ответ')}</span>
                                            </span>
                                        ` : ''}
                                    </div>
                                `;
                            }
                        }).join('')}
                    </div>
                </div>
            `;
        }

        // Explanation / Rationale
        const explanation = data.explanation || (data.questions && data.questions[0] && data.questions[0].explanation) || task.explanation;
        if (explanation && typeof explanation === 'string' && explanation.trim()) {
            bodyHtml += `
                <div class="flex flex-col gap-1.5">
                    <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.explanation_label', 'Методическое пояснение:')}</span>
                    <div class="text-xs text-text-secondary p-3 rounded-lg bg-surface-2 border border-border-subtle leading-relaxed flex items-start gap-2">
                        <span class="material-symbols-outlined text-primary text-[16px] flex-shrink-0 mt-0.5">info</span>
                        <div>${escapeHtml(explanation.trim())}</div>
                    </div>
                </div>
            `;
        }

        // 2. OPEN_ANSWER
        if (canonicalType === 'OPEN_ANSWER') {
            const stdAnswer = data.standard_answer || data.correct_answer || data.reference_answer || task.standard_answer || task.correct_answer;
            if (stdAnswer && typeof stdAnswer === 'string' && stdAnswer.trim()) {
                bodyHtml += `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.standard_answer', 'Эталонный ответ:')}</span>
                        <div class="text-xs text-text-main p-3 rounded-lg bg-primary-light/15 border border-primary/20 leading-relaxed font-mono whitespace-pre-wrap">
                            ${escapeHtml(stdAnswer.trim())}
                        </div>
                    </div>
                `;
            }

            const criteria = data.criteria || data.rubric || task.criteria;
            if (criteria && typeof criteria === 'string' && criteria.trim()) {
                bodyHtml += `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.criteria_label', 'Критерии проверки:')}</span>
                        <div class="text-xs text-text-secondary p-2.5 rounded-lg bg-surface-2 border border-border-subtle leading-relaxed whitespace-pre-wrap">
                            ${escapeHtml(criteria.trim())}
                        </div>
                    </div>
                `;
            }
        }

        // 3. SEQUENCE
        if (canonicalType === 'SEQUENCE') {
            let sequenceSteps = [];
            if (data.elements && typeof data.elements === 'object') {
                if (data.levels && typeof data.levels === 'object') {
                    const levelKeys = Object.keys(data.levels).sort((a, b) => Number(a) - Number(b));
                    levelKeys.forEach((lvlKey) => {
                        const elIds = data.levels[lvlKey];
                        if (Array.isArray(elIds)) {
                            elIds.forEach((elId) => {
                                const stepVal = data.elements[elId] || elId;
                                const txt = typeof stepVal === 'object' && stepVal ? (stepVal.text || stepVal.title) : String(stepVal);
                                if (txt) sequenceSteps.push(txt);
                            });
                        }
                    });
                }
                if (sequenceSteps.length === 0) {
                    Object.values(data.elements).forEach((val) => {
                        const txt = typeof val === 'object' && val ? (val.text || val.title) : String(val);
                        if (txt) sequenceSteps.push(txt);
                    });
                }
            } else if (Array.isArray(data.levels)) {
                data.levels.forEach((lvl) => {
                    if (Array.isArray(lvl)) {
                        lvl.forEach((s) => sequenceSteps.push(String(s)));
                    }
                });
            } else if (Array.isArray(data.items) || Array.isArray(task.items)) {
                const items = data.items || task.items;
                items.forEach((it) => {
                    const txt = typeof it === 'object' && it ? (it.text || it.title) : String(it);
                    if (txt) sequenceSteps.push(txt);
                });
            }

            if (sequenceSteps.length > 0) {
                bodyHtml += `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.sequence_steps_label', 'Правильный порядок шагов:')}</span>
                        <div class="flex flex-col gap-1.5">
                            ${sequenceSteps.map((step, sIdx) => `
                                <div class="flex items-center gap-3 p-2.5 rounded-lg bg-surface-2 border border-border-subtle text-xs text-text-main">
                                    <span class="w-6 h-6 rounded-full bg-primary text-white font-bold text-[11px] flex items-center justify-center flex-shrink-0">${sIdx + 1}</span>
                                    <span class="font-medium leading-relaxed">${escapeHtml(step)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            }
        }

        // 4. CLICK_WORDS (error text and fragmented breakdown)
        if (canonicalType === 'CLICK_WORDS' || data.mode === 'text_errors') {
            const text = String(data.text || task.text || (task.content && task.content.text) || '');
            const errorSpans = data.error_spans || task.error_spans || (task.content && task.content.error_spans);
            const errorIndices = data.error_indices || task.error_indices || (task.content && task.content.error_indices);

            const { phraseCount, totalWords, clusters } = getErrorAnalysis(text, errorSpans, errorIndices);
            let badgeLabel = '';
            if (phraseCount > 0) {
                if (totalWords > phraseCount) {
                    badgeLabel = t('studio.stage3.errors_phrases_and_words_fmt', 'Ошибок: {phrases} фрагм. ({words} сл.)')
                        .replace('{phrases}', phraseCount)
                        .replace('{words}', totalWords);
                } else {
                    badgeLabel = t('studio.stage3.errors_count_fmt', 'Ошибок: {count}')
                        .replace('{count}', phraseCount);
                }
            } else {
                const fallbackCount = data.error_count ?? (Array.isArray(errorSpans) ? errorSpans.length : 0);
                badgeLabel = t('studio.stage3.errors_count_fmt', 'Ошибок: {count}').replace('{count}', fallbackCount);
            }

            const highlightedText = highlightErrorSpansInText(text, clusters);

            bodyHtml += `
                <div class="flex flex-col gap-1.5">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.error_text_title', 'Клинический текст с ошибками:')}</span>
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/20 text-[11px]">
                            <span class="material-symbols-outlined text-[13px]">find_in_page</span>
                            <span>${badgeLabel}</span>
                        </span>
                    </div>
                    <div class="text-xs text-text-secondary p-3.5 rounded-lg bg-surface-2 border border-border-subtle leading-relaxed whitespace-pre-wrap">
                        ${highlightedText}
                    </div>
                </div>
            `;

            if (clusters && clusters.length > 0) {
                let cleanText = text.trim();
                const prefixMatch = cleanText.match(/^text:\s*/i);
                if (prefixMatch) cleanText = cleanText.slice(prefixMatch[0].length);

                bodyHtml += `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.error_fragments_label', 'Ошибочные фрагменты (цели клика):')}</span>
                        <div class="flex flex-wrap gap-1.5">
                            ${clusters.map((cl, cIdx) => {
                                const fragment = cleanText.slice(cl.start, cl.end).trim();
                                return `
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-xs font-semibold text-amber-900 dark:text-amber-200">
                                        <span class="text-amber-700 dark:text-amber-300 font-bold">${cIdx + 1}.</span>
                                        <span>${escapeHtml(fragment || '—')}</span>
                                    </span>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
        }

        // 5. Visual / Interactive targets (CLICK / DRAW)
        if (canonicalType === 'CLICK' || canonicalType === 'DRAW') {
            const targets = data.targets || data.regions || task.targets;
            bodyHtml += `
                <div class="flex flex-col gap-2">
                    <div class="p-3 rounded-lg bg-primary-light/10 border border-primary/20 text-xs text-primary leading-relaxed flex items-center gap-2">
                        <span class="material-symbols-outlined text-[18px]">info</span>
                        <span>${t('studio.stage3.visual_image_note', 'Графическая подложка размечается в интерактивном редакторе.')}</span>
                    </div>
                    ${Array.isArray(targets) && targets.length > 0 ? `
                        <div class="flex flex-col gap-1.5">
                            <span class="text-[11px] font-bold text-text-muted uppercase tracking-wider">${t('studio.stage3.targets_label', 'Ориентиры / цели:')}</span>
                            <div class="flex flex-wrap gap-1.5">
                                ${targets.map((tgt, tIdx) => {
                                    const tgtName = typeof tgt === 'object' && tgt ? (tgt.name || tgt.label || tgt.title) : String(tgt);
                                    return `
                                        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-2 border border-border-subtle text-xs font-medium text-text-main">
                                            <span class="text-primary font-bold">${tIdx + 1}.</span>
                                            <span>${escapeHtml(tgtName || '—')}</span>
                                        </span>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}
                </div>
            `;
        }

        DOM.taskPreviewContentContainer.innerHTML = bodyHtml;
    }

    function createShowcaseTaskCard(task, allTasksIndex) {
        const card = document.createElement('div');
        card.className = 'studio-task-card';
        card.setAttribute('data-selected', task._selected_for_import ? 'true' : 'false');

        const canonicalType = normalizeTaskType(task);
        const { questionTitle } = extractTaskDisplayInfo(task, allTasksIndex);

        card.innerHTML = `
            <div class="studio-task-card__top">
                <label class="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" class="task-select-checkbox rounded border-border-strong text-primary w-4 h-4"
                        ${task._selected_for_import ? 'checked' : ''} />
                    <span class="studio-unit-badge bg-primary-light text-primary font-bold">${TASK_TYPE_LABELS[canonicalType] || canonicalType}</span>
                </label>
                <div class="flex items-center gap-1">
                    <button type="button" class="btn-preview-task text-text-muted hover:text-primary transition-colors p-1" title="${t('studio.stage3.preview_task', 'Просмотр задания')}">
                        <span class="material-symbols-outlined text-[18px]">visibility</span>
                    </button>
                    <button type="button" class="btn-delete-task text-text-muted hover:text-error transition-colors p-1" title="${t('studio.stage3.delete_task', 'Удалить задание')}">
                        <span class="material-symbols-outlined text-[18px]">delete</span>
                    </button>
                </div>
            </div>

            <div class="flex flex-col gap-1 flex-1">
                <p class="studio-task-card-title text-xs font-bold text-text-main line-clamp-2 cursor-pointer hover:text-primary transition-colors" title="${t('studio.stage3.preview_task', 'Просмотр задания')}">${escapeHtml(questionTitle)}</p>
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
                updateShowcaseSelectAllCheckbox();
                const section = card.closest('.studio-showcase-section');
                if (section && section._updateCategoryToggle) {
                    section._updateCategoryToggle();
                }
                markDirty();
            });
        }

        // Delete event
        const delBtn = card.querySelector('.btn-delete-task');
        if (delBtn) {
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                StudioState.allTasks = StudioState.allTasks.filter((t) => t._studio_id !== task._studio_id);
                if (currentPreviewIndex >= StudioState.allTasks.length) {
                    currentPreviewIndex = Math.max(0, StudioState.allTasks.length - 1);
                }
                if (DOM.modalTaskPreview && !DOM.modalTaskPreview.classList.contains('hidden')) {
                    if (StudioState.allTasks.length === 0) {
                        closeTaskPreviewModal();
                    } else {
                        renderTaskPreviewModalContent();
                    }
                }
                renderShowcase();
                updateStickyBar();
                updateProceedToStep3Button();
                showToast(t('studio.modal.history_delete', 'Удалено'), 'info');
                markDirty();
            });
        }

        // Preview modal events
        const previewBtn = card.querySelector('.btn-preview-task');
        if (previewBtn) {
            previewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskPreviewModal(task, allTasksIndex);
            });
        }

        const titleEl = card.querySelector('.studio-task-card-title');
        if (titleEl) {
            titleEl.addEventListener('click', (e) => {
                e.stopPropagation();
                openTaskPreviewModal(task, allTasksIndex);
            });
        }

        // Expand snippet events (+ ещё N вар. / + ещё N шаг. / + ещё N / Читать полностью)
        attachSnippetExpansionListeners(card);

        return card;
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
            updateShowcaseSelectAllCheckbox();
            return;
        }

        renderShowcaseFilterPills();
        updateShowcaseSelectAllCheckbox();

        // Group tasks by category
        const tasksByCategory = new Map();
        SHOWCASE_CATEGORIES.forEach((cat) => tasksByCategory.set(cat.key, { cat, tasks: [] }));
        const otherGroup = { cat: OTHER_CATEGORY, tasks: [] };

        tasks.forEach((task) => {
            const canonicalType = normalizeTaskType(task);
            const group = tasksByCategory.get(canonicalType) || (
                canonicalType === 'CLICK' || canonicalType === 'DRAW' ? tasksByCategory.get('VISUAL') : otherGroup
            );
            if (group) {
                group.tasks.push(task);
            } else {
                otherGroup.tasks.push(task);
            }
        });

        // Filter categories according to showcaseFilterType
        const categoriesToRender = [];
        SHOWCASE_CATEGORIES.forEach((cat) => {
            const grp = tasksByCategory.get(cat.key);
            if (grp && grp.tasks.length > 0) {
                if (showcaseFilterType === 'ALL' || showcaseFilterType === cat.key) {
                    categoriesToRender.push(grp);
                }
            }
        });
        if (otherGroup.tasks.length > 0 && (showcaseFilterType === 'ALL' || showcaseFilterType === 'OTHER')) {
            categoriesToRender.push(otherGroup);
        }

        if (categoriesToRender.length === 0) {
            DOM.showcaseCardsGrid.innerHTML = `
                <div class="col-span-full py-8 flex flex-col items-center justify-center text-center">
                    <span class="material-symbols-outlined text-[36px] text-text-muted mb-2">filter_alt_off</span>
                    <p class="text-xs font-medium text-text-secondary">${t('studio.stage3.no_tasks_of_type', 'Нет заданий выбранного типа в текущем наборе')}</p>
                </div>
            `;
            return;
        }

        categoriesToRender.forEach(({ cat, tasks: catTasks }) => {
            const section = document.createElement('div');
            section.className = 'studio-showcase-section';
            section.setAttribute('data-category', cat.key);

            const header = document.createElement('div');
            header.className = 'studio-showcase-section__header';

            const titleWrap = document.createElement('div');
            titleWrap.className = 'studio-showcase-section__title-wrap';

            const iconSpan = document.createElement('span');
            iconSpan.className = 'material-symbols-outlined studio-showcase-section__icon';
            iconSpan.textContent = cat.icon;

            const titleH3 = document.createElement('h3');
            titleH3.className = 'studio-showcase-section__title';
            titleH3.textContent = t(cat.labelKey, cat.defaultLabel);

            const countBadge = document.createElement('span');
            countBadge.className = 'studio-showcase-section__count';
            countBadge.textContent = catTasks.length;

            titleWrap.appendChild(iconSpan);
            titleWrap.appendChild(titleH3);
            titleWrap.appendChild(countBadge);

            const actionsWrap = document.createElement('div');
            actionsWrap.className = 'studio-showcase-section__actions';

            const btnToggleCat = document.createElement('button');
            btnToggleCat.type = 'button';
            btnToggleCat.className = 'studio-showcase-section__btn-select-all';

            function updateCategoryToggleBtn() {
                const allSel = catTasks.every((t) => t._selected_for_import);
                const someSel = !allSel && catTasks.some((t) => t._selected_for_import);
                const iconName = allSel ? 'check_box' : (someSel ? 'indeterminate_check_box' : 'check_box_outline_blank');
                const text = allSel ? t('studio.stage3.unselect_category', 'Снять выбор') : t('studio.stage3.select_category', 'Выбрать всю категорию');
                btnToggleCat.innerHTML = `
                    <span class="material-symbols-outlined text-[14px]">${iconName}</span>
                    <span>${text}</span>
                `;
            }

            updateCategoryToggleBtn();
            section._updateCategoryToggle = updateCategoryToggleBtn;

            btnToggleCat.addEventListener('click', () => {
                const allSel = catTasks.every((t) => t._selected_for_import);
                const newState = !allSel;
                catTasks.forEach((t) => {
                    t._selected_for_import = newState;
                });
                renderShowcase();
                updateStickyBar();
                markDirty();
            });

            actionsWrap.appendChild(btnToggleCat);
            header.appendChild(titleWrap);
            header.appendChild(actionsWrap);
            section.appendChild(header);

            // Sub-grid for cards
            const grid = document.createElement('div');
            grid.className = 'studio-showcase-section__grid';

            catTasks.forEach((task) => {
                const card = createShowcaseTaskCard(task, StudioState.allTasks.indexOf(task));
                grid.appendChild(card);
            });

            section.appendChild(grid);
            DOM.showcaseCardsGrid.appendChild(section);
        });
    }

    function renderShowcaseFilterPills() {
        if (!DOM.showcaseFilterPills) return;
        DOM.showcaseFilterPills.innerHTML = '';

        const categoryCounts = { ALL: StudioState.allTasks.length };
        StudioState.allTasks.forEach((t) => {
            const canonicalType = normalizeTaskType(t);
            const cat = getCategoryForType(canonicalType);
            const key = cat.key;
            categoryCounts[key] = (categoryCounts[key] || 0) + 1;
        });

        // "All" pill
        const allPill = document.createElement('button');
        allPill.type = 'button';
        allPill.className = `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${showcaseFilterType === 'ALL' ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-1'}`;
        allPill.textContent = `${t('studio.stage3.filter_all', 'Все')} (${categoryCounts.ALL})`;
        allPill.addEventListener('click', () => {
            showcaseFilterType = 'ALL';
            renderShowcase();
        });
        DOM.showcaseFilterPills.appendChild(allPill);

        // Category pills for present categories
        SHOWCASE_CATEGORIES.forEach((cat) => {
            const count = categoryCounts[cat.key] || 0;
            if (count > 0) {
                const pill = document.createElement('button');
                pill.type = 'button';
                pill.className = `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${showcaseFilterType === cat.key ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-1'}`;
                const labelText = cat.key === 'VISUAL'
                    ? t('studio.stage3.group_visual', 'Интерактивные')
                    : (TASK_TYPE_LABELS[cat.key] || t(cat.labelKey, cat.defaultLabel));
                pill.textContent = `${labelText} (${count})`;
                pill.addEventListener('click', () => {
                    showcaseFilterType = cat.key;
                    renderShowcase();
                });
                DOM.showcaseFilterPills.appendChild(pill);
            }
        });

        if (categoryCounts.OTHER > 0) {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = `px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${showcaseFilterType === 'OTHER' ? 'bg-primary text-white' : 'bg-surface-2 text-text-secondary hover:bg-surface-1'}`;
            pill.textContent = `${t('studio.stage3.group_other', 'Другие')} (${categoryCounts.OTHER})`;
            pill.addEventListener('click', () => {
                showcaseFilterType = 'OTHER';
                renderShowcase();
            });
            DOM.showcaseFilterPills.appendChild(pill);
        }
    }

    function extractTaskDisplayInfo(task, fallbackIndex = 0) {
        if (!task || typeof task !== 'object') {
            return { questionTitle: t('studio.stage3.task_num_prefix', 'Задание #{n}').replace('{n}', fallbackIndex + 1), data: {}, taskType: 'TEST' };
        }
        const data = task.data || task.task_data || task.content || task || {};
        const canonicalType = normalizeTaskType(task);
        const rawType = String(task.type || task.task_type || task._import_type || data.type || canonicalType);
        const normalizedType = rawType.toLowerCase();

        function clean(str) {
            if (!str || typeof str !== 'string') return '';
            let s = str.trim();
            s = s.replace(/^text:\s*/i, '');
            s = s.replace(/^(?:клик|тест|последовательность|открытый ответ|рисуй|рисование)\s*[-—:]\s*/i, '');
            s = s.replace(/^[#?@*•-]+\s*/, '');
            return s.trim();
        }

        let questionTitle = '';

        // 1. Try questions array (common in TEST, or multi-question tasks)
        if (Array.isArray(data.questions) && data.questions.length > 0) {
            const q0 = data.questions[0];
            if (typeof q0 === 'object' && q0) {
                questionTitle = clean(q0.text || q0.question || q0.title || q0.prompt || q0.stem);
            }
        }

        // 2. Try prompt or question on data or task root
        if (!questionTitle) {
            questionTitle = clean(data.prompt || task.prompt || data.question || task.question || data.stem || task.stem);
        }

        // 3. For click_words or text_errors, fallback to data.text
        if (!questionTitle && (canonicalType === 'CLICK_WORDS' || normalizedType.includes('click_words') || data.mode === 'text_errors') && data.text) {
            const sample = clean(data.text);
            questionTitle = sample.length > 90 ? sample.slice(0, 87) + '...' : sample;
        }

        // 4. Try title / name (avoid generic placeholders like "Task #1" or "Задание 1")
        if (!questionTitle) {
            const candidate = clean(task.title || data.title || task.name || data.name);
            if (candidate && !/^task\s*#?\d+/i.test(candidate) && !/^(?:задание|завдання)\s*#?\d+/i.test(candidate) && candidate.toLowerCase() !== t('studio.stage3.task_word_ru', 'задание') && candidate.toLowerCase() !== t('studio.stage3.task_word_uk', 'завдання')) {
                questionTitle = candidate;
            }
        }

        // 5. Fallback to human type label + index
        if (!questionTitle) {
            const humanTypeLabel = getTaskTypeLabel(task);
            questionTitle = `${humanTypeLabel} #${fallbackIndex + 1}`;
        }

        return {
            questionTitle,
            data,
            taskType: canonicalType
        };
    }

    function getErrorAnalysis(text, errorSpans, errorIndices) {
        if (Array.isArray(errorSpans) && errorSpans.length > 0) {
            const normalizedSpans = errorSpans.map((s) => {
                if (Array.isArray(s) && s.length >= 2 && typeof s[0] === 'number' && typeof s[1] === 'number') {
                    return { start: s[0], end: s[1] };
                }
                return s;
            });
            const validSpans = normalizedSpans.filter((s) => {
                if (!s || typeof s !== 'object') return false;
                if (typeof s.start !== 'number' || typeof s.end !== 'number') return false;
                if (s.start < 0 || s.end <= s.start) return false;
                if (s.is_correct === true) return false;
                return true;
            }).sort((a, b) => a.start - b.start);

            if (validSpans.length > 0) {
                const clusters = [];
                let currentCluster = { start: validSpans[0].start, end: validSpans[0].end, wordCount: 1 };

                for (let i = 1; i < validSpans.length; i++) {
                    const sp = validSpans[i];
                    if (sp.start <= currentCluster.end) {
                        currentCluster.end = Math.max(currentCluster.end, sp.end);
                        currentCluster.wordCount++;
                    } else {
                        const gap = typeof text === 'string' ? text.slice(currentCluster.end, sp.start) : '';
                        if (gap.trim().length === 0 || gap.length <= 2) {
                            currentCluster.end = Math.max(currentCluster.end, sp.end);
                            currentCluster.wordCount++;
                        } else {
                            clusters.push(currentCluster);
                            currentCluster = { start: sp.start, end: sp.end, wordCount: 1 };
                        }
                    }
                }
                clusters.push(currentCluster);

                return {
                    phraseCount: clusters.length,
                    totalWords: validSpans.length,
                    clusters,
                };
            }
        }

        if (Array.isArray(errorIndices) && errorIndices.length > 0) {
            const sorted = [...errorIndices].sort((a, b) => a - b);
            let phrases = 0;
            let lastIdx = -999;
            sorted.forEach((idx) => {
                if (idx !== lastIdx + 1) phrases++;
                lastIdx = idx;
            });
            return {
                phraseCount: phrases,
                totalWords: sorted.length,
                clusters: [],
            };
        }

        return { phraseCount: 0, totalWords: 0, clusters: [] };
    }

    function snapClustersToWordBoundaries(text, clusters) {
        if (!text || !Array.isArray(clusters) || clusters.length === 0) return [];
        const isWordChar = (ch) => /[\p{L}\p{N}_-]/u.test(ch);
        const snapped = [];

        clusters.forEach((cl) => {
            let s = Math.max(0, Math.min(cl.start, text.length));
            let e = Math.max(s, Math.min(cl.end, text.length));

            while (s > 0 && isWordChar(text[s]) && isWordChar(text[s - 1])) {
                s--;
            }
            while (e < text.length && isWordChar(text[e - 1]) && isWordChar(text[e])) {
                e++;
            }

            if (snapped.length > 0 && s <= snapped[snapped.length - 1].end) {
                snapped[snapped.length - 1].end = Math.max(snapped[snapped.length - 1].end, e);
            } else {
                snapped.push({ start: s, end: e });
            }
        });

        return snapped;
    }

    function highlightErrorSpansInText(text, clusters) {
        if (!text || typeof text !== 'string') return '';
        let cleanText = text.trim();
        let prefixLen = 0;
        const prefixMatch = cleanText.match(/^text:\s*/i);
        if (prefixMatch) {
            prefixLen = prefixMatch[0].length;
            cleanText = cleanText.slice(prefixLen);
        }

        if (!clusters || clusters.length === 0) {
            return escapeHtml(cleanText);
        }

        const adjustedClusters = clusters.map((c) => ({
            ...c,
            start: Math.max(0, c.start - prefixLen),
            end: Math.max(0, c.end - prefixLen),
        })).filter((c) => c.start < cleanText.length && c.end > c.start);

        if (adjustedClusters.length === 0) {
            return escapeHtml(cleanText);
        }

        const snappedClusters = snapClustersToWordBoundaries(cleanText, adjustedClusters);

        let result = '';
        let cursor = 0;
        snappedClusters.forEach((cl) => {
            const s = cl.start;
            const e = cl.end;
            if (s > cursor) {
                result += escapeHtml(cleanText.slice(cursor, s));
            }
            const highlightedPart = cleanText.slice(s, e);
            if (highlightedPart) {
                result += `<mark class="bg-amber-500/20 text-amber-900 dark:text-amber-200 px-0.5 rounded font-semibold underline decoration-amber-500/40">${escapeHtml(highlightedPart)}</mark>`;
            }
            cursor = e;
        });
        if (cursor < cleanText.length) {
            result += escapeHtml(cleanText.slice(cursor));
        }
        return result;
    }

    function renderTaskPreviewSnippet(task) {
        if (!task || typeof task !== 'object') return '';
        const data = task.data || task.task_data || task.content || task;
        const canonicalType = normalizeTaskType(task);
        const rawType = String(task.type || task.task_type || task._import_type || data.type || canonicalType).toLowerCase();

        // 1. TEST (options with ✓ and •)
        const options = extractTestOptions(task, data);

        if (Array.isArray(options) && options.length > 0) {
            const previewOpts = options.slice(0, 3);
            const remainingOpts = options.slice(3);
            const formatOpt = (opt) => {
                const isCorrect = Boolean(opt.is_correct ?? opt.correct ?? false);
                const optText = typeof opt === 'object' && opt ? (opt.text || opt.title || opt.value || '') : String(opt);
                return `
                    <div class="flex items-center gap-1.5 ${isCorrect ? 'text-success font-semibold' : 'text-text-secondary'}">
                        <span class="text-[10px] flex-shrink-0">${isCorrect ? '✓' : '•'}</span>
                        <span class="truncate">${escapeHtml(optText)}</span>
                    </div>
                `;
            };

            return `
                <div class="mt-1 flex flex-col gap-1 text-[11px] text-text-secondary">
                    ${previewOpts.map(formatOpt).join('')}
                    ${remainingOpts.length > 0 ? `
                        <div class="task-extra-options hidden flex flex-col gap-1">
                            ${remainingOpts.map(formatOpt).join('')}
                        </div>
                        <button type="button" class="btn-expand-snippet text-primary hover:underline text-[10px] font-semibold flex items-center gap-0.5 mt-0.5 w-fit" data-action="toggle-options" data-more-fmt="+ ${t('studio.stage3.more_options_fmt', 'ещё {n} вар.').replace('{n}', remainingOpts.length)}" data-collapse-text="${t('studio.stage3.collapse', 'Свернуть')}">
                            <span class="material-symbols-outlined text-[12px]">expand_more</span>
                            <span class="expand-btn-text">+ ${t('studio.stage3.more_options_fmt', 'ещё {n} вар.').replace('{n}', remainingOpts.length)}</span>
                        </button>
                    ` : ''}
                </div>
            `;
        }

        // 2. OPEN_ANSWER (standard / reference answer)
        const stdAnswer = data.standard_answer || data.correct_answer || data.reference_answer || task.standard_answer || task.correct_answer;
        if (stdAnswer && typeof stdAnswer === 'string') {
            const cleanAnswer = stdAnswer.trim();
            if (cleanAnswer) {
                return `
                    <div class="mt-1 text-[11px] text-text-secondary line-clamp-2 bg-surface-2 p-1.5 rounded-md border border-border-subtle">
                        <span class="font-bold text-text-main">${t('studio.stage3.standard_answer', 'Эталон:')}</span> ${escapeHtml(cleanAnswer)}
                    </div>
                `;
            }
        }

        // 3. SEQUENCE / SEQUENCE_ASSEMBLY (ordered steps 1 → 2 → 3)
        let sequenceSteps = [];
        if (data.elements && typeof data.elements === 'object') {
            if (data.levels && typeof data.levels === 'object') {
                const levelKeys = Object.keys(data.levels).sort((a, b) => Number(a) - Number(b));
                levelKeys.forEach((lvlKey) => {
                    const elIds = data.levels[lvlKey];
                    if (Array.isArray(elIds)) {
                        elIds.forEach((elId) => {
                            const stepVal = data.elements[elId] || elId;
                            const txt = typeof stepVal === 'object' && stepVal ? (stepVal.text || stepVal.title) : String(stepVal);
                            if (txt) sequenceSteps.push(txt);
                        });
                    }
                });
            }
            if (sequenceSteps.length === 0) {
                Object.values(data.elements).forEach((val) => {
                    const txt = typeof val === 'object' && val ? (val.text || val.title) : String(val);
                    if (txt) sequenceSteps.push(txt);
                });
            }
        } else if (Array.isArray(data.levels)) {
            data.levels.forEach((lvl) => {
                if (Array.isArray(lvl)) {
                    lvl.forEach((s) => sequenceSteps.push(String(s)));
                }
            });
        } else if (Array.isArray(data.items) || Array.isArray(task.items)) {
            const items = data.items || task.items;
            items.forEach((it) => {
                const txt = typeof it === 'object' && it ? (it.text || it.title) : String(it);
                if (txt) sequenceSteps.push(txt);
            });
        }

        if (sequenceSteps.length > 0) {
            const previewSteps = sequenceSteps.slice(0, 3);
            const remainingSteps = sequenceSteps.slice(3);
            const formatStep = (step, idx, hasArrow) => `
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-2 border border-border-subtle text-text-main text-[10px] font-medium">
                    <span class="text-primary font-bold">${idx + 1}.</span>
                    <span class="truncate max-w-[120px]">${escapeHtml(step)}</span>
                </span>
                ${hasArrow ? '<span class="text-text-muted text-[10px]">→</span>' : ''}
            `;

            return `
                <div class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-text-secondary">
                    ${previewSteps.map((step, sIdx) => formatStep(step, sIdx, sIdx < previewSteps.length - 1 || remainingSteps.length > 0)).join('')}
                    ${remainingSteps.length > 0 ? `
                        <div class="task-extra-steps hidden flex flex-wrap items-center gap-1">
                            ${remainingSteps.map((step, rIdx) => formatStep(step, previewSteps.length + rIdx, rIdx < remainingSteps.length - 1)).join('')}
                        </div>
                        <button type="button" class="btn-expand-snippet text-primary hover:underline text-[10px] font-semibold flex items-center gap-0.5 ml-1" data-action="toggle-steps" data-more-fmt="+ ${t('studio.stage3.more_steps_fmt', 'ещё {n} шаг.').replace('{n}', remainingSteps.length)}" data-collapse-text="${t('studio.stage3.collapse', 'Свернуть')}">
                            <span class="material-symbols-outlined text-[12px]">expand_more</span>
                            <span class="expand-btn-text">+ ${t('studio.stage3.more_steps_fmt', 'ещё {n} шаг.').replace('{n}', remainingSteps.length)}</span>
                        </button>
                    ` : ''}
                </div>
            `;
        }

        // 4. CLICK_WORDS / text_errors (error count badge & highlighted snippet)
        if (canonicalType === 'CLICK_WORDS' || data.mode === 'text_errors' || rawType.includes('click_words')) {
            const text = String(data.text || task.text || (task.content && task.content.text) || '');
            const errorSpans = data.error_spans || task.error_spans || (task.content && task.content.error_spans);
            const errorIndices = data.error_indices || task.error_indices || (task.content && task.content.error_indices);

            const { phraseCount, totalWords, clusters } = getErrorAnalysis(text, errorSpans, errorIndices);

            let badgeLabel = '';
            if (phraseCount > 0) {
                if (totalWords > phraseCount) {
                    badgeLabel = t('studio.stage3.errors_phrases_and_words_fmt', 'Ошибок: {phrases} фрагм. ({words} сл.)')
                        .replace('{phrases}', phraseCount)
                        .replace('{words}', totalWords);
                } else {
                    badgeLabel = t('studio.stage3.errors_count_fmt', 'Ошибок: {count}')
                        .replace('{count}', phraseCount);
                }
            } else {
                const fallbackCount = data.error_count ?? (Array.isArray(errorSpans) ? errorSpans.length : 0);
                badgeLabel = t('studio.stage3.errors_count_fmt', 'Ошибок: {count}').replace('{count}', fallbackCount);
            }

            const highlightedSnippet = highlightErrorSpansInText(text, clusters);

            return `
                <div class="mt-1 flex flex-col gap-1 text-[11px]">
                    <div class="flex items-center gap-1.5">
                        <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 font-semibold border border-amber-500/20 text-[10px]">
                            <span class="material-symbols-outlined text-[12px]">find_in_page</span>
                            <span>${badgeLabel}</span>
                        </span>
                    </div>
                    ${highlightedSnippet ? `
                        <div class="task-text-snippet p-1.5 rounded-md bg-surface-2 border border-border-subtle text-text-secondary text-[11px] leading-relaxed line-clamp-3">
                            ${highlightedSnippet}
                        </div>
                        ${text.length > 140 ? `
                            <button type="button" class="btn-expand-text text-primary hover:underline text-[10px] font-semibold flex items-center gap-0.5 self-start mt-0.5" data-expand-text="${t('studio.stage3.expand_text', 'Читать полностью')}" data-collapse-text="${t('studio.stage3.collapse', 'Свернуть')}">
                                <span class="material-symbols-outlined text-[12px]">expand_more</span>
                                <span class="expand-btn-text">${t('studio.stage3.expand_text', 'Читать полностью')}</span>
                            </button>
                        ` : ''}
                    ` : ''}
                </div>
            `;
        }

        // 5. Visual / Manual targets (CLICK / DRAW)
        const targets = data.targets || data.regions || task.targets;
        if (Array.isArray(targets) && targets.length > 0) {
            const targetNames = targets.slice(0, 10).map((t) => typeof t === 'object' && t ? (t.name || t.label || t.title) : String(t)).filter(Boolean);
            if (targetNames.length > 0) {
                const previewTargets = targetNames.slice(0, 3);
                const remainingTargets = targetNames.slice(3);
                return `
                    <div class="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-text-secondary">
                        <span class="material-symbols-outlined text-[12px] text-primary">target</span>
                        <span>${previewTargets.map((n) => `<span class="font-medium text-text-main">${escapeHtml(n)}</span>`).join(', ')}</span>
                        ${remainingTargets.length > 0 ? `
                            <span class="task-extra-targets hidden">, ${remainingTargets.map((n) => `<span class="font-medium text-text-main">${escapeHtml(n)}</span>`).join(', ')}</span>
                            <button type="button" class="btn-expand-snippet text-primary hover:underline text-[10px] font-semibold flex items-center gap-0.5 ml-1" data-action="toggle-targets" data-more-fmt="+ ${t('studio.stage3.more_targets_fmt', 'ещё {n}').replace('{n}', remainingTargets.length)}" data-collapse-text="${t('studio.stage3.collapse', 'Свернуть')}">
                                <span class="material-symbols-outlined text-[12px]">expand_more</span>
                                <span class="expand-btn-text">+ ${t('studio.stage3.more_targets_fmt', 'ещё {n}').replace('{n}', remainingTargets.length)}</span>
                            </button>
                        ` : ''}
                    </div>
                `;
            }
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
            DOM.btnExecuteImport.disabled = selected.length === 0;
            if (selected.length > 0 && !StudioState.selectedTopicId) {
                DOM.btnExecuteImport.title = t('studio.stage3.select_topic_first_tooltip', 'Сначала выберите целевую тему курса для импорта');
            } else {
                DOM.btnExecuteImport.removeAttribute('title');
            }
        }
    }

    async function executeImport() {
        const selected = StudioState.allTasks.filter((t) => t._selected_for_import);
        if (selected.length === 0) {
            showToast(t('studio.toast.select_at_least_one', 'Выберите хотя бы одно задание для импорта'), 'warning');
            return;
        }

        if (!StudioState.selectedModuleId || !StudioState.selectedTopicId) {
            openTopicModal();
            if (DOM.btnSelectTopic) {
                DOM.btnSelectTopic.classList.remove('studio-field-pulse');
                void DOM.btnSelectTopic.offsetWidth;
                DOM.btnSelectTopic.classList.add('studio-field-pulse');
            }
            showToast(t('studio.toast.select_target_topic', 'Выберите целевую тему курса для импорта'), 'warning');
            return;
        }

        const idempotencyKey = 'imp_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
        showToast(t('studio.toast.importing_tasks', 'Импорт заданий в тему курса...'), 'info');

        try {
            const res = await fetch('/api/editor/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: StudioState.selectedModuleId,
                    topic_id: StudioState.selectedTopicId,
                    tasks: selected,
                    import_context: {
                        source: 'studio',
                        source_file_name: StudioState.sourceFileName || null,
                        target_language: StudioState.targetLanguage || null,
                    },
                    idempotency_key: idempotencyKey,
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.ok) {
                showToast(data.message || t('studio.toast.import_failed', 'Ошибка импорта заданий в тему'), 'error');
                return;
            }

            // Save session to PostgreSQL
            await saveSessionToBackend('imported');

            clearLocalStorageDraft();
            showToast(`🎉 ` + t('studio.toast.import_success_fmt', 'Успешно импортировано {count} заданий!').replace('{count}', data.imported || selected.length), 'success');

            // Redirect back to dashboard topic after short delay
            setTimeout(() => {
                window.location.href = `/editor?module=${encodeURIComponent(StudioState.selectedModuleId)}&topic=${encodeURIComponent(StudioState.selectedTopicId)}`;
            }, 1200);
        } catch (e) {
            console.error('[Studio] Execute import error:', e);
            showToast(t('studio.toast.network_import_error', 'Сетевая ошибка импорта'), 'error');
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
        syncTypeDraftsWithAllTasks();

        resolveTopicFromUrlOrCatalog();
        if (DOM.lessonMapContainer) renderLessonMap(StudioState.analysisResult);
        if (DOM.btnProceedToStep2) DOM.btnProceedToStep2.disabled = false;

        switchStep(session.tasks && session.tasks.length > 0 ? 3 : 2);
        updateProceedToStep3Button();
        showToast(t('studio.toast.session_restored', 'Сессия восстановлена из базы данных'), 'success');
        markDirty();
    }

    async function deleteSessionFromBackend(sessionId) {
        try {
            await fetch(`/api/editor/studio/sessions/${encodeURIComponent(sessionId)}`, {
                method: 'DELETE',
            });
            showToast(t('studio.toast.session_deleted', 'Сессия удалена'), 'info');
        } catch (e) {
            showToast(t('studio.toast.session_delete_error', 'Ошибка удаления сессии'), 'error');
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

        // Close active modal on Escape key, navigate preview on Arrow keys
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                closeTopicModal();
                closeHistoryModal();
                closeNavGuardModal();
                closeTaskPreviewModal();
                closeResetModal();
            } else if (DOM.modalTaskPreview && !DOM.modalTaskPreview.classList.contains('hidden')) {
                if (e.key === 'ArrowLeft') {
                    if (currentPreviewIndex > 0) {
                        e.preventDefault();
                        currentPreviewIndex--;
                        renderTaskPreviewModalContent();
                    }
                } else if (e.key === 'ArrowRight') {
                    const tasks = StudioState.allTasks || [];
                    if (currentPreviewIndex < tasks.length - 1) {
                        e.preventDefault();
                        currentPreviewIndex++;
                        renderTaskPreviewModalContent();
                    }
                }
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

    if (typeof window !== 'undefined' && window.__ACTRA_DEV_MODE__) {
        window.__StudioInternal = {
            StudioState,
            get DOM() { return DOM; },
            formatClientPedagogicalDirective,
            getEnrichedPromptForType,
            selectGenerationType,
            loadGenerationPromptForType,
            updatePromptPreview,
            updateStage2ActionButtons,
            pasteResponseFromClipboard,
            renderCommittedView,
            switchToEditMode,
            renderStage2Tabs,
            getTypeTabState,
            updateTypeTabStatus,
            getStrategyInfo,
            resetStudioState,
            renderLessonMap,
            isManualVisualType,
            buildVisualGuidanceText,
            renderManualVisualView,
            commitManualSpec,
            extractTaskDisplayInfo,
            renderTaskPreviewSnippet,
            getErrorAnalysis,
            highlightErrorSpansInText,
            snapClustersToWordBoundaries,
            normalizeTaskType,
            getTaskTypeLabel,
            SHOWCASE_CATEGORIES,
            renderShowcase,
            openTaskPreviewModal,
            closeTaskPreviewModal,
            renderTaskPreviewModalContent,
            getCurrentPreviewIndex: () => currentPreviewIndex,
            createShowcaseTaskCard,
            serializeTaskToText,
            serializeTasksToText,
            syncTypeDraftsWithAllTasks,
            attachSnippetExpansionListeners,
            restoreDraftFromLocalStorage,
            restoreSession,
            switchStep,
            setupStage2,
            runClientRegexCounter,
        };
    }

})();
