// i18n helper
function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
    var v = window.i18n.t(key);
    return v !== key ? v : fallback;
}

/**
 * ImportManager - Manages task import workflow
 */
class ImportManager {
    constructor(dashboard) {
        this.dashboard = dashboard;
        this.currentStep = 1;
        this.selectedModule = null;
        this.selectedTopic = null;
        this.selectedModuleName = '';
        this.selectedTopicName = '';
        this.sourceText = '';
        this.manualAnalysisResult = null;
        this.parsedResult = null;
        this.excludedTasks = new Set();
        this.selectedTasks = new Set(); // For bulk actions
        this.importMode = 'text'; // 'text' | 'archive' | 'ai'
        this.uploadedFile = null;
        this.checkResult = null;
        this.archiveCacheId = null;
        this.perTaskConflictRes = new Map(); // index -> 'skip'|'overwrite'|'new_id'
        this.aiTemplateType = 'open_answer';
        this.workspaceImportState = this.createWorkspaceImportState();

        // AI generation mode state
        this.materialText = '';
        this.aiUploadedFile = null;
        this.aiFileInfo = null;
        this.analysisResult = null;
        this.generationResult = null;
        this.aiProvider = null;
        this.aiProviderModel = null;
        this.aiRunId = null;
        this.dailyLimit = null;
        this.aiStatus = null;
        this.aiSelectedRecs = new Map(); // task_type -> {enabled, count}
        this.aiOutputLanguageMode = 'same_as_material'; // 'same_as_material' | 'custom'
        this.aiOutputLanguage = 'ru'; // used when mode=custom
        this.aiGenerating = false;
        this.aiAnalyzing = false;
        this.importInProgress = false;
        this.importRequestKey = null;
        this.importHistoryStorageKey = 'editor_import_history_v1';
        this.manualAnalysisSessionStorageKey = 'editor_manual_analysis_session_v1';
        this.manualAnalysisArchiveStorageKey = 'editor_manual_analysis_archive_v1';
        this.manualAnalysisSession = this.loadManualAnalysisSession();
        this.manualAnalysisArchive = this.loadManualAnalysisArchive();

        // Shared modal can run in classic import mode or standalone theory analysis mode (P5)
        this.modalPurpose = 'import'; // 'import' | 'theory_analysis'
        this.theoryRuns = [];
        this.theoryRunsLoading = false;
        this.theoryRunsError = '';
        this.theoryRunsRequestToken = 0;
        this.theoryOpeningRunId = null;
        this.theoryReportPanelOpen = true; // P6: quick open/collapse report instead of persistent panel
        this.theoryReportScrollTop = 0;
        this.theoryComposerViewState = null;
        this.skipTheoryViewStateCaptureOnce = false;
        this.theoryReportBlockCollapseState = new Map(); // P7: per-block collapse state in report_blocks renderer
        this.theoryReportActiveAnchor = null;
        this.theoryReportAnchorHighlightTimer = null;
        this.theorySubMode = 'analysis'; // 'analysis' | 'home' | 'archive' | 'coverage_map' | 'task_generation' | 'task_preview' | 'microcards'

        // P9 microcards mode state (separate mode inside theory analysis modal)
        this.microcardsDecks = [];
        this.microcardsDecksLoading = false;
        this.microcardsDecksError = '';
        this.microcardsActiveDeck = null;
        this.microcardsSession = null;
        this.microcardsQueue = [];
        this.microcardsQueueIndex = 0;
        this.microcardsQueueLoading = false;
        this.microcardsReviewSubmitting = false;
        this.microcardsReviewReveal = false;
        this.microcardsReviewEvaluation = null;
        this.microcardsReviewStartedAt = 0;
        this.microcardsPairSelections = {};
        this.microcardsCreateLoading = false;

        // M11 manual editor state
        this.manualEditorDeck = null;         // full deck object with cards for editing
        this.manualEditorDeckLoading = false;
        this.manualEditorCardForm = null;     // { mode: 'create'|'edit', card_id?, front_text, back_text, tags, difficulty_hint }
        this.manualEditorSaving = false;
        this.manualEditorRenamingDeckId = null;
        this.manualEditorPreviewCard = null;  // card object for review-like preview

        // M12 text import state
        this.mcImportText = '';
        this.mcImportParsing = false;
        this.mcImportParsedResult = null;     // result from parse-text endpoint
        this.mcImportExecuting = false;
        this.mcImportExecuteResult = null;    // result from execute-text endpoint
        this.mcImportMode = 'create_deck';    // 'create_deck' | 'append_to_deck'
        this.mcImportTargetDeckId = '';
        this.mcImportDeckName = '';
        this.mcImportTemplateType = 'qa_short'; // active prompt template key

        // P8 bridge: shared context between theory report and manual editors
        this.editorTheoryBridgeStorageKey = 'rp_editor_theory_bridge_v1';

        // P12 quality gates: server-provided theory feature flags (defaults keep legacy behavior unchanged)
        this.theoryFeatureFlags = {
            ai_mode: false,
            analysis_v2_schema: true,
            analysis_report_blocks_v1: true,
            analysis_report_renderer_v1: true,
            editor_analysis_report_link: true,
            analysis_coverage_in_editor: true,
            microcards_mode: false,
            microcards_pair_match: false,
        };
    }

    updateTheoryFeatureFlagsFromPayload(payload) {
        const src = payload && typeof payload === 'object' && payload.feature_flags && typeof payload.feature_flags === 'object'
            ? payload.feature_flags
            : null;
        if (!src) return this.theoryFeatureFlags;
        const next = { ...(this.theoryFeatureFlags || {}) };
        Object.keys(next).forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(src, key)) {
                next[key] = !!src[key];
            }
        });
        if (next.ai_mode === false) {
            next.analysis_v2_schema = false;
            next.analysis_report_blocks_v1 = false;
            next.analysis_report_renderer_v1 = false;
            next.editor_analysis_report_link = false;
            next.analysis_coverage_in_editor = false;
            next.microcards_mode = false;
            next.microcards_pair_match = false;
        }
        if (next.analysis_v2_schema === false) {
            next.analysis_report_blocks_v1 = false;
            next.analysis_report_renderer_v1 = false;
        }
        if (next.analysis_report_blocks_v1 === false) {
            next.analysis_report_renderer_v1 = false;
        }
        if (next.microcards_mode === false) {
            next.microcards_pair_match = false;
        }
        this.theoryFeatureFlags = next;
        return next;
    }

    isTheoryFeatureEnabled(flagName, defaultValue = true) {
        const key = String(flagName || '').trim();
        if (!key) return !!defaultValue;
        const flags = (this.theoryFeatureFlags && typeof this.theoryFeatureFlags === 'object') ? this.theoryFeatureFlags : {};
        if (!Object.prototype.hasOwnProperty.call(flags, key)) return !!defaultValue;
        return !!flags[key];
    }

    ensureTheoryFeatureEnabled(flagName, message, level = 'warning') {
        if (this.isTheoryFeatureEnabled(flagName, true)) return true;
        if (message) this.showToast(message, level);
        return false;
    }

    openTheoryAiInProgressPlaceholder() {
        this.setModalPurpose('theory_analysis');
        this.theorySubMode = 'analysis';
        this.renderTheoryAnalysisMode();
        return { ok: false, error: 'ai_mode_in_progress' };
    }

    isInternalAiGenerationInDevelopment() {
        return true;
    }

    isTheoryExternalAnalysisFallback() {
        return this.isInternalAiGenerationInDevelopment() || !this.isTheoryFeatureEnabled('ai_mode', false);
    }

    createWorkspaceImportState() {
        return {
            request: null,
            preview: null,
            executeResult: null,
            loadingPreview: false,
            executing: false,
            error: '',
        };
    }

    resetWorkspaceImportState() {
        this.workspaceImportState = this.createWorkspaceImportState();
    }

    createManualAnalysisSessionId() {
        return `manual_analysis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    getEditorFacingTaskTypeLabel(taskType) {
        const normalized = String(taskType || '').trim().toUpperCase();
        const labels = {
            OPEN_ANSWER: wt('im.k001', 'Открытый ответ'),
            SEQUENCE: wt('im.k002', 'Последовательность'),
            TEST: wt('im.k003', 'Тест (вопросы с вариантами ответов)'),
            CLICK_TEXT: wt('im.k004', 'Клик/Ошибки (текстовый выбор)'),
            CLICK_WORDS: wt('im.k005', 'Клик/Ошибки (поиск ошибок в тексте)'),
            CLICK: wt('im.k006', 'Клик по изображению'),
            DRAW: wt('im.k007', 'Рисование на изображении'),
        };
        return labels[normalized] || normalized || wt('im.k008', 'Тип задания');
    }

    getTaskTypeForAIAgentTemplateKey(templateKey) {
        const normalized = String(templateKey || '').trim().toLowerCase();
        const mapping = {
            open_answer: 'OPEN_ANSWER',
            sequence_assembly: 'SEQUENCE',
            test: 'TEST',
            click_text: 'CLICK_TEXT',
            click_words: 'CLICK_WORDS',
        };
        return mapping[normalized] || null;
    }

    getManualAnalysisStatusMeta(status) {
        const normalized = String(status || '').trim().toLowerCase();
        const meta = {
            not_started: {
                label: wt('im.k009', 'не начато'),
                className: 'bg-surface-1 text-text-secondary border border-border-subtle',
            },
            selected: {
                label: wt('im.k010', 'выбрано'),
                className: 'bg-surface-2 text-text-main border border-info-light',
            },
            draft_generated: {
                label: wt('im.k011', 'черновик готов'),
                className: 'bg-surface-2 text-text-main border border-primary-light',
            },
            imported: {
                label: wt('im.k012', 'импортировано'),
                className: 'bg-surface-2 text-text-main border border-success-light',
            },
            manual_only: {
                label: wt('im.k013', 'только вручную'),
                className: 'bg-surface-2 text-text-main border border-warning-light',
            },
            manual_done: {
                label: wt('im.k014', 'сделано вручную'),
                className: 'bg-surface-2 text-text-main border border-success-light',
            },
            skipped: {
                label: wt('im.k015', 'пропущено'),
                className: 'bg-surface-1 text-text-disabled border border-border-subtle',
            },
            not_recommended: {
                label: wt('im.k016', 'не рекомендуется'),
                className: 'bg-surface-1 text-text-disabled border border-border-subtle',
            },
        };
        return meta[normalized] || meta.not_started;
    }

    normalizeManualAnalysisSession(session) {
        if (!session || typeof session !== 'object') return null;
        const analysis = (session.analysis && typeof session.analysis === 'object') ? session.analysis : null;
        const recommendations = Array.isArray(analysis?.recommendations) ? analysis.recommendations : [];
        if (!analysis?.ok || !recommendations.length) return null;

        const rawState = (session.recommendation_state && typeof session.recommendation_state === 'object')
            ? session.recommendation_state
            : {};
        const recommendationState = {};

        recommendations.forEach((rec) => {
            const taskType = String(rec?.task_type || '').trim().toUpperCase();
            if (!taskType) return;
            const existing = (rawState[taskType] && typeof rawState[taskType] === 'object') ? rawState[taskType] : {};
            const manualOnly = rec?.manual_only === true || rec?.auto_generation_supported === false;
            const fallbackStatus = manualOnly ? 'manual_only' : 'not_started';
            recommendationState[taskType] = {
                status: String(existing.status || fallbackStatus).trim().toLowerCase() || fallbackStatus,
                imported_count: Math.max(0, Number(existing.imported_count || 0)),
                imported_batches: Math.max(0, Number(existing.imported_batches || 0)),
                last_imported_at: existing.last_imported_at ? String(existing.last_imported_at) : null,
                last_selected_at: existing.last_selected_at ? String(existing.last_selected_at) : null,
                draft_source_text: existing.draft_source_text ? String(existing.draft_source_text) : '',
                draft_saved_at: existing.draft_saved_at ? String(existing.draft_saved_at) : null,
                draft_task_count: Math.max(0, Number(existing.draft_task_count || 0)),
                draft_parsed_result: (existing.draft_parsed_result && typeof existing.draft_parsed_result === 'object')
                    ? existing.draft_parsed_result
                    : null,
                covers_units: Array.isArray(existing.covers_units)
                    ? existing.covers_units.map((id) => Number(id)).filter((id) => Number.isFinite(id))
                    : (Array.isArray(rec?.covers_units)
                        ? rec.covers_units.map((id) => Number(id)).filter((id) => Number.isFinite(id))
                        : []),
            };
        });

        return {
            version: Number(session.version || 1),
            id: String(session.id || this.createManualAnalysisSessionId()),
            created_at: String(session.created_at || new Date().toISOString()),
            updated_at: String(session.updated_at || new Date().toISOString()),
            module_id: session.module_id ? String(session.module_id) : null,
            topic_id: session.topic_id ? String(session.topic_id) : null,
            module_name: session.module_name ? String(session.module_name) : '',
            topic_name: session.topic_name ? String(session.topic_name) : '',
            selected_task_type: session.selected_task_type ? String(session.selected_task_type).trim().toUpperCase() : null,
            analysis,
            recommendation_state: recommendationState,
        };
    }

    loadManualAnalysisSession() {
        try {
            const raw = window.localStorage.getItem(this.manualAnalysisSessionStorageKey);
            if (!raw) return null;
            return this.normalizeManualAnalysisSession(JSON.parse(raw));
        } catch (error) {
            console.warn('[ImportManager] Failed to load manual analysis session:', error);
            return null;
        }
    }

    saveManualAnalysisSession() {
        try {
            if (!this.manualAnalysisSession) {
                window.localStorage.removeItem(this.manualAnalysisSessionStorageKey);
                return;
            }
            this.manualAnalysisSession.updated_at = new Date().toISOString();
            window.localStorage.setItem(
                this.manualAnalysisSessionStorageKey,
                JSON.stringify(this.manualAnalysisSession),
            );
        } catch (error) {
            console.warn('[ImportManager] Failed to save manual analysis session:', error);
        }
    }

    normalizeManualAnalysisArchiveEntry(entry) {
        if (!entry || typeof entry !== 'object') return null;
        const session = this.normalizeManualAnalysisSession(entry.session || entry);
        if (!session) return null;
        return {
            id: String(entry.id || session.id || this.createManualAnalysisSessionId()),
            archived_at: String(entry.archived_at || session.updated_at || new Date().toISOString()),
            session,
        };
    }

    loadManualAnalysisArchive() {
        try {
            const raw = window.localStorage.getItem(this.manualAnalysisArchiveStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
                .map((entry) => this.normalizeManualAnalysisArchiveEntry(entry))
                .filter(Boolean)
                .sort((a, b) => new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime());
        } catch (error) {
            console.warn('[ImportManager] Failed to load manual analysis archive:', error);
            return [];
        }
    }

    saveManualAnalysisArchive() {
        try {
            const items = Array.isArray(this.manualAnalysisArchive) ? this.manualAnalysisArchive : [];
            window.localStorage.setItem(
                this.manualAnalysisArchiveStorageKey,
                JSON.stringify(items),
            );
        } catch (error) {
            console.warn('[ImportManager] Failed to save manual analysis archive:', error);
        }
    }

    getManualAnalysisArchive() {
        if (!Array.isArray(this.manualAnalysisArchive)) {
            this.manualAnalysisArchive = this.loadManualAnalysisArchive();
        }
        return this.manualAnalysisArchive;
    }

    upsertManualAnalysisArchiveEntry(session) {
        const normalized = this.normalizeManualAnalysisSession(session);
        if (!normalized) return null;
        const entry = {
            id: String(normalized.id),
            archived_at: new Date().toISOString(),
            session: normalized,
        };
        const items = this.getManualAnalysisArchive().filter((item) => String(item?.id || '') !== entry.id);
        items.unshift(entry);
        this.manualAnalysisArchive = items.slice(0, 25);
        this.saveManualAnalysisArchive();
        return entry;
    }

    clearManualAnalysisSession(options = {}) {
        const preserveManualAnalysisResult = options.preserveManualAnalysisResult === true;
        this.manualAnalysisSession = null;
        try {
            window.localStorage.removeItem(this.manualAnalysisSessionStorageKey);
        } catch (error) {
            console.warn('[ImportManager] Failed to clear manual analysis session:', error);
        }
        if (!preserveManualAnalysisResult) {
            this.manualAnalysisResult = null;
        }
    }

    createManualAnalysisSession(result) {
        const analysis = (result && typeof result === 'object') ? result : null;
        if (!analysis?.ok) return null;
        const nowIso = new Date().toISOString();
        const recommendationState = {};
        (analysis.recommendations || []).forEach((rec) => {
            const taskType = String(rec?.task_type || '').trim().toUpperCase();
            if (!taskType) return;
            const manualOnly = rec?.manual_only === true || rec?.auto_generation_supported === false;
            recommendationState[taskType] = {
                status: manualOnly ? 'manual_only' : 'not_started',
                imported_count: 0,
                imported_batches: 0,
                last_imported_at: null,
                last_selected_at: null,
                draft_source_text: '',
                draft_saved_at: null,
                draft_task_count: 0,
                draft_parsed_result: null,
                covers_units: Array.isArray(rec?.covers_units)
                    ? rec.covers_units.map((id) => Number(id)).filter((id) => Number.isFinite(id))
                    : [],
            };
        });

        this.manualAnalysisSession = this.normalizeManualAnalysisSession({
            version: 1,
            id: this.createManualAnalysisSessionId(),
            created_at: nowIso,
            updated_at: nowIso,
            module_id: this.selectedModule ? String(this.selectedModule) : null,
            topic_id: this.selectedTopic ? String(this.selectedTopic) : null,
            module_name: this.selectedModuleName || '',
            topic_name: this.selectedTopicName || '',
            selected_task_type: null,
            analysis,
            recommendation_state: recommendationState,
        });
        this.manualAnalysisResult = analysis;
        this.saveManualAnalysisSession();
        return this.manualAnalysisSession;
    }

    getActiveManualAnalysisSession() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session || this.importMode !== 'ai') return null;
        if (this.selectedModule && session.module_id && String(this.selectedModule) !== String(session.module_id)) return null;
        if (this.selectedTopic && session.topic_id && String(this.selectedTopic) !== String(session.topic_id)) return null;
        return session;
    }

    getManualAnalysisRecommendation(taskType) {
        const session = this.getActiveManualAnalysisSession();
        const analysis = session?.analysis || this.manualAnalysisResult;
        const normalized = String(taskType || '').trim().toUpperCase();
        return Array.isArray(analysis?.recommendations)
            ? analysis.recommendations.find((rec) => String(rec?.task_type || '').trim().toUpperCase() === normalized) || null
            : null;
    }

    updateManualAnalysisRecommendationState(taskType, patch = {}) {
        const session = this.getActiveManualAnalysisSession();
        const normalized = String(taskType || '').trim().toUpperCase();
        if (!session || !normalized) return null;
        const current = (session.recommendation_state && session.recommendation_state[normalized])
            ? session.recommendation_state[normalized]
            : {
                status: 'not_started',
                imported_count: 0,
                imported_batches: 0,
                last_imported_at: null,
                last_selected_at: null,
                draft_source_text: '',
                draft_saved_at: null,
                draft_task_count: 0,
                draft_parsed_result: null,
                covers_units: [],
            };
        session.recommendation_state[normalized] = {
            ...current,
            ...patch,
        };
        this.manualAnalysisSession = session;
        this.saveManualAnalysisSession();
        return session.recommendation_state[normalized];
    }

    getManualAnalysisDraft(taskType) {
        const session = this.getActiveManualAnalysisSession();
        const normalized = String(taskType || '').trim().toUpperCase();
        if (!session || !normalized) return null;
        const state = session.recommendation_state?.[normalized];
        const sourceText = String(state?.draft_source_text || '');
        const parsedResult = (state?.draft_parsed_result && typeof state.draft_parsed_result === 'object')
            ? state.draft_parsed_result
            : null;
        const taskCount = Math.max(
            0,
            Number(
                state?.draft_task_count
                || (Array.isArray(parsedResult?.tasks) ? parsedResult.tasks.length : 0),
            ),
        );
        const savedAt = state?.draft_saved_at ? String(state.draft_saved_at) : null;
        if (!sourceText && !parsedResult) return null;
        return {
            sourceText,
            parsedResult,
            taskCount,
            savedAt,
        };
    }

    storeManualAnalysisDraft(taskType, draft = {}) {
        const normalized = String(taskType || '').trim().toUpperCase();
        if (!normalized) return null;
        const parsedResult = (draft?.parsedResult && typeof draft.parsedResult === 'object')
            ? draft.parsedResult
            : null;
        return this.updateManualAnalysisRecommendationState(normalized, {
            status: 'draft_generated',
            draft_source_text: String(draft?.sourceText || ''),
            draft_saved_at: new Date().toISOString(),
            draft_task_count: Math.max(0, Number(Array.isArray(parsedResult?.tasks) ? parsedResult.tasks.length : 0)),
            draft_parsed_result: parsedResult,
        });
    }

    clearManualAnalysisDraft(taskType, patch = {}) {
        const normalized = String(taskType || '').trim().toUpperCase();
        if (!normalized) return null;
        return this.updateManualAnalysisRecommendationState(normalized, {
            draft_source_text: '',
            draft_saved_at: null,
            draft_task_count: 0,
            draft_parsed_result: null,
            ...patch,
        });
    }

    setManualAnalysisSelectedTaskType(taskType, options = {}) {
        const session = this.getActiveManualAnalysisSession();
        const normalized = String(taskType || '').trim().toUpperCase();
        if (!session || !normalized) return;
        session.selected_task_type = normalized;
        this.manualAnalysisSession = session;
        if (options.updateStatus !== false) {
            const current = session.recommendation_state?.[normalized];
            if (current && current.status !== 'manual_only') {
                this.updateManualAnalysisRecommendationState(normalized, {
                    status: 'selected',
                    last_selected_at: new Date().toISOString(),
                });
                return;
            }
        }
        this.saveManualAnalysisSession();
    }

    openManualAnalysisDraft(taskType) {
        const normalizedTaskType = String(taskType || '').trim().toUpperCase();
        const templateKey = this.getAIAgentTemplateKeyForTaskType(normalizedTaskType);
        if (!templateKey) {
            this.showToast(wt('im.k017', 'Этот тип нельзя открыть через текстовый импорт. Его нужно создавать вручную в редакторе.'), 'warning');
            return;
        }
        const draft = this.getManualAnalysisDraft(normalizedTaskType);
        if (!draft) {
            this.applyManualAnalysisRecommendation(normalizedTaskType);
            return;
        }

        this.setManualAnalysisSelectedTaskType(normalizedTaskType);
        this.aiTemplateType = templateKey;
        this.sourceText = draft.sourceText || '';
        this.parsedResult = draft.parsedResult || null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importRequestKey = null;

        const activeSession = this.getActiveManualAnalysisSession();
        if (activeSession?.analysis) {
            this.manualAnalysisResult = activeSession.analysis;
        }

        const templateSelect = document.getElementById('ai-agent-template-type');
        if (templateSelect) templateSelect.value = templateKey;
        this.updateAIAgentPromptTextarea();
        this._updateLiveCounter(this.sourceText);
        this.currentStep = this.parsedResult ? 3 : 2;
        if (this.modalPurpose === 'theory_analysis') {
            this.theorySubMode = this.parsedResult ? 'task_preview' : 'task_generation';
        }
        this.updateNavigationButtons();
        this.showToast(`${wt('im.k620', 'Черновик для')} ${this.getEditorFacingTaskTypeLabel(normalizedTaskType)} ${wt('im.k621', 'восстановлен.')}`, 'success');
        this.renderCurrentStep();
    }

    resumeManualAnalysisSession() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session?.analysis?.ok) {
            this.showToast(wt('im.k018', 'Сохранённая analysis session не найдена.'), 'warning');
            return;
        }

        this.setModalPurpose('theory_analysis');
        this.importMode = 'ai';
        this.selectedModule = session.module_id || '';
        this.selectedTopic = session.topic_id || '';
        this.selectedModuleName = session.module_name || '';
        this.selectedTopicName = session.topic_name || '';
        this.manualAnalysisResult = session.analysis;
        this.aiTemplateType = 'material_analysis';
        this.sourceText = '';
        this.parsedResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.currentStep = 2;
        this.theorySubMode = 'coverage_map';
        this.updateNavigationButtons();
        this.showToast(wt('im.k019', 'Analysis session восстановлена. Можно продолжать работу по карте покрытия.'), 'success');
        this.renderTheoryAnalysisMode();
    }

    openTheoryAnalysisHome() {
        this.setModalPurpose('theory_analysis');
        this.importMode = 'ai';
        this.currentStep = 2;
        this.aiTemplateType = 'material_analysis';
        this.theorySubMode = 'home';
        this.renderTheoryAnalysisMode();
    }

    openTheoryAnalysisArchive() {
        this.setModalPurpose('theory_analysis');
        this.importMode = 'ai';
        this.currentStep = 2;
        this.aiTemplateType = 'material_analysis';
        this.theorySubMode = 'archive';
        this.renderTheoryAnalysisMode();
    }

    returnToManualAnalysisCoverageMap() {
        const session = this.getActiveManualAnalysisSession();
        if (session?.analysis?.ok) {
            this.manualAnalysisResult = session.analysis;
        }
        this.aiTemplateType = 'material_analysis';
        this.sourceText = '';
        this.parsedResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importRequestKey = null;
        this.currentStep = 2;
        this.theorySubMode = 'coverage_map';
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        } else {
            this.renderCurrentStep();
        }
    }

    async archiveActiveManualAnalysisSession() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session?.analysis?.ok) {
            this.showToast(wt('im.k020', 'Активный анализ не найден.'), 'warning');
            return false;
        }
        this.upsertManualAnalysisArchiveEntry(session);
        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
        this.sourceText = '';
        this.parsedResult = null;
        this.aiTemplateType = 'material_analysis';
        this.theorySubMode = 'analysis';
        this.showToast(wt('im.k021', 'Анализ сохранён в архив. Можно начать новый.'), 'success');
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
        return true;
    }

    async deleteActiveManualAnalysisSession() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session?.analysis?.ok) {
            this.showToast(wt('im.k022', 'Активный анализ не найден.'), 'warning');
            return false;
        }
        const confirmed = await this.confirmAction({
            title: wt('im.k023', 'Удалить текущий анализ?'),
            message: wt('im.k024', 'Текущая analysis session и все локальные черновики по ней будут удалены. Уже импортированные задания в библиотеке останутся.'),
            confirmText: wt('im.k025', 'Удалить'),
            cancelText: wt('im.k026', 'Отмена'),
            variant: 'warning',
        });
        if (!confirmed) return false;
        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
        this.sourceText = '';
        this.parsedResult = null;
        this.aiTemplateType = 'material_analysis';
        this.theorySubMode = 'analysis';
        this.showToast(wt('im.k027', 'Текущий анализ удалён.'), 'success');
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
        return true;
    }

    async startFreshTheoryAnalysis() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (session?.analysis?.ok) {
            const confirmed = await this.confirmAction({
                title: wt('im.k028', 'Начать новый анализ?'),
                message: wt('im.k029', 'Текущий активный анализ перестанет быть активным. Если его нужно сохранить, сначала отправьте его в архив.'),
                confirmText: wt('im.k030', 'Начать новый'),
                cancelText: wt('im.k031', 'Отмена'),
                variant: 'warning',
            });
            if (!confirmed) return false;
        }
        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
        this.sourceText = '';
        this.parsedResult = null;
        this.generationResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importRequestKey = null;
        this.aiTemplateType = 'material_analysis';
        this.currentStep = 2;
        this.theorySubMode = 'analysis';
        if (!this.selectedModule && !this.selectedTopic) {
            this.presetFromCurrentLocation();
        }
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
        return true;
    }

    restoreArchivedManualAnalysisSession(entryId) {
        const entry = this.getManualAnalysisArchive().find((item) => String(item?.id || '') === String(entryId || ''));
        const session = this.normalizeManualAnalysisSession(entry?.session);
        if (!session?.analysis?.ok) {
            this.showToast(wt('im.k032', 'Архивный анализ не найден.'), 'warning');
            return false;
        }
        this.manualAnalysisSession = session;
        this.manualAnalysisResult = session.analysis;
        this.saveManualAnalysisSession();
        this.selectedModule = session.module_id || this.selectedModule || '';
        this.selectedTopic = session.topic_id || this.selectedTopic || '';
        this.selectedModuleName = session.module_name || this.selectedModuleName || '';
        this.selectedTopicName = session.topic_name || this.selectedTopicName || '';
        this.aiTemplateType = 'material_analysis';
        this.currentStep = 2;
        this.theorySubMode = 'coverage_map';
        this.showToast(wt('im.k033', 'Архивный анализ открыт.'), 'success');
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
        return true;
    }

    async deleteArchivedManualAnalysisSession(entryId) {
        const entry = this.getManualAnalysisArchive().find((item) => String(item?.id || '') === String(entryId || ''));
        if (!entry) {
            this.showToast(wt('im.k034', 'Архивный анализ не найден.'), 'warning');
            return false;
        }
        const confirmed = await this.confirmAction({
            title: wt('im.k035', 'Удалить анализ из архива?'),
            message: wt('im.k036', 'Запись будет удалена из архива без возможности восстановления. Уже импортированные задания в библиотеке останутся.'),
            confirmText: wt('im.k037', 'Удалить'),
            cancelText: wt('im.k038', 'Отмена'),
            variant: 'warning',
        });
        if (!confirmed) return false;
        this.manualAnalysisArchive = this.getManualAnalysisArchive().filter((item) => String(item?.id || '') !== String(entryId || ''));
        this.saveManualAnalysisArchive();
        this.showToast(wt('im.k039', 'Запись удалена из архива.'), 'success');
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
        return true;
    }

    resetTheoryAnalysisWorkflow() {
        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
        this.manualAnalysisResult = null;
        this.aiTemplateType = 'material_analysis';
        this.sourceText = '';
        this.parsedResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importRequestKey = null;
        this.currentStep = 2;
        this.theorySubMode = 'analysis';
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
        }
    }

    buildManualAnalysisGenerationContext() {
        const session = this.getActiveManualAnalysisSession();
        const taskType = this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType);
        if (!session || !taskType) return null;

        const analysis = session.analysis;
        const recommendation = this.getManualAnalysisRecommendation(taskType);
        if (!recommendation) return null;

        const units = Array.isArray(analysis?.educational_units) ? analysis.educational_units : [];
        const unitMap = new Map(units.map((unit) => [Number(unit?.id), unit]));
        const targetUnitIds = Array.isArray(recommendation.covers_units)
            ? recommendation.covers_units.map((id) => Number(id)).filter((id) => Number.isFinite(id))
            : [];
        const targetUnits = targetUnitIds.map((id) => unitMap.get(id)).filter(Boolean);

        const importedSummaries = [];
        const importedUnitIds = new Set();
        Object.entries(session.recommendation_state || {}).forEach(([type, state]) => {
            const importedCount = Math.max(0, Number(state?.imported_count || 0));
            const status = String(state?.status || '').trim().toLowerCase();
            const completed = importedCount > 0 || status === 'manual_done';
            if (!completed) return;
            const covers = Array.isArray(state?.covers_units) ? state.covers_units : [];
            covers.forEach((id) => importedUnitIds.add(Number(id)));
            importedSummaries.push({
                taskType: type,
                label: this.getEditorFacingTaskTypeLabel(type),
                importedCount: importedCount > 0 ? importedCount : 1,
                status,
                units: covers
                    .map((id) => unitMap.get(Number(id)))
                    .filter(Boolean)
                    .map((unit) => `#${unit.id} ${unit.title}`),
            });
        });

        const remainingUnits = units.filter((unit) => !importedUnitIds.has(Number(unit?.id)));

        return {
            session,
            taskType,
            recommendation,
            targetUnits,
            importedSummaries,
            remainingUnits,
            selectedState: (session.recommendation_state && session.recommendation_state[taskType]) || null,
        };
    }

    buildManualAnalysisPromptContextBlock() {
        const ctx = this.buildManualAnalysisGenerationContext();
        if (!ctx) return '';

        const recommendation = ctx.recommendation;
        const anchors = Array.isArray(recommendation?.assessable_anchors) ? recommendation.assessable_anchors.filter(Boolean) : [];
        const candidates = Array.isArray(recommendation?.design_candidates) ? recommendation.design_candidates.filter(Boolean) : [];
        const targetUnits = ctx.targetUnits.map((unit) => {
            const description = String(unit?.description || '').trim();
            return `- #${unit.id} ${unit.title}${description ? ` — ${description}` : ''}`;
        }).join('\n') || wt('im.k618', '- Нет выделенных образовательных единиц');
        const imported = ctx.importedSummaries.map((item) => {
            const units = item.units.length ? `; units: ${item.units.join(', ')}` : '';
            return `- ${item.label}: imported_count=${item.importedCount}${units}`;
        }).join('\n') || wt('im.k619', '- Пока ничего не импортировано');
        const remaining = ctx.remainingUnits.map((unit) => `- #${unit.id} ${unit.title}`).join('\n') || '- Все единицы уже покрыты хотя бы одним импортированным типом';
        const anchorsText = anchors.length ? anchors.map((item) => `- ${item}`).join('\n') : '- Нет дополнительных assessable anchors';
        const candidatesText = candidates.length ? candidates.map((item) => `- ${item}`).join('\n') : '- Нет отдельных design candidates';

        return `
<analysis_session_context>
session_id: ${ctx.session.id}
selected_task_type: ${ctx.taskType}
selected_editor_label: ${this.getEditorFacingTaskTypeLabel(ctx.taskType)}
recommended_count: ${Number(recommendation?.count || 0)}
priority: ${String(recommendation?.priority || 'medium')}
coverage_role: ${String(recommendation?.coverage_role || '').trim() || 'n/a'}
generation_focus: ${String(recommendation?.generation_focus || '').trim() || 'n/a'}
coverage_strategy: ${String(recommendation?.coverage_strategy || '').trim() || 'n/a'}
count_rationale: ${String(recommendation?.count_rationale || '').trim() || 'n/a'}

<target_units>
${targetUnits}
</target_units>

<assessable_anchors>
${anchorsText}
</assessable_anchors>

<design_candidates>
${candidatesText}
</design_candidates>

<already_imported_in_this_session>
${imported}
</already_imported_in_this_session>

<remaining_units_after_imports>
${remaining}
</remaining_units_after_imports>

<session_rules>
- Use this analysis session context as the primary authoring brief for the selected task type.
- Generate only the selected task type and align it with the recommendation above.
- Prioritize educational units that are still uncovered or only lightly covered by already imported types.
- Do not duplicate the exact same checking angle if it was already imported by another type in this session.
- If this task type was already imported earlier, expand coverage instead of repeating near-identical prompts.
</session_rules>
</analysis_session_context>`.trim();
    }

    getActiveAIAgentTemplateConfig() {
        const options = this.getAIAgentTemplateOptions();
        const active = options[this.aiTemplateType] || options.open_answer;
        const analysisContextBlock = this.buildManualAnalysisPromptContextBlock();
        if (!analysisContextBlock || this.aiTemplateType === 'material_analysis') {
            return active;
        }
        return {
            ...active,
            instructions: `${active.instructions}\n4. В промпт уже встроен контекст analysis session: используй его как основной authoring brief и не игнорируй покрытие уже импортированных типов.`,
            prompt: `${active.prompt}\n\n${analysisContextBlock}`,
        };
    }

    renderManualAnalysisPromptContextCard() {
        const ctx = this.buildManualAnalysisGenerationContext();
        if (!ctx) return '';
        const recommendation = ctx.recommendation;
        const anchors = Array.isArray(recommendation?.assessable_anchors) ? recommendation.assessable_anchors.filter(Boolean) : [];
        const remainingUnits = ctx.remainingUnits.slice(0, 6);
        return `
            <div class="mb-4 rounded-xl border border-primary-light bg-primary-lighter/40 p-4 space-y-3">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <div class="text-sm font-bold text-text-main">${wt('im.k815', 'Текущий маршрут генерации')}</div>
                        <div class="text-xs text-text-secondary mt-1">
                            ${this.escapeHtml(this.getEditorFacingTaskTypeLabel(ctx.taskType))} • ${wt('im.k040', 'сессия')}${this.escapeHtml(ctx.session.id)}
                        </div>
                    </div>
                    <div class="text-right text-xs text-text-secondary">
                        <div>${wt('im.k041', 'Рекомендовано: <span class="font-bold text-text-main">')}${Number(recommendation?.count || 0)}</span></div>
                        <div>${wt('im.k042', 'Импортировано ранее: <span class="font-bold text-text-main">')}${Math.max(0, Number(ctx.selectedState?.imported_count || 0))}</span></div>
                    </div>
                </div>
                ${recommendation?.generation_focus ? `
                    <div class="text-xs text-text-secondary">
                        <span class="font-semibold text-text-main">${wt('im.k816', 'Фокус:')}</span> ${this.escapeHtml(String(recommendation.generation_focus))}
                    </div>
                ` : ''}
                <div class="text-xs text-text-secondary">
                    <span class="font-semibold text-text-main">${wt('im.k817', 'Целевые единицы:')}</span>
                    ${this.escapeHtml(ctx.targetUnits.map((unit) => `#${unit.id} ${unit.title}`).join('; ') || wt('im.k043', 'нет'))}
                </div>
                ${anchors.length ? `
                    <div class="text-xs text-text-secondary">
                        <span class="font-semibold text-text-main">${wt('im.k818', 'Опоры для генерации:')}</span>
                        ${this.escapeHtml(anchors.join('; '))}
                    </div>
                ` : ''}
                <div class="text-xs text-text-secondary">
                    <span class="font-semibold text-text-main">${wt('im.k819', 'Осталось без импорта:')}</span>
                    ${this.escapeHtml(remainingUnits.map((unit) => `#${unit.id} ${unit.title}`).join('; ') || wt('im.k044', 'все единицы уже покрыты'))}
                </div>
            </div>
        `;
    }

    setManualAnalysisRecommendationLifecycle(taskType, nextStatus) {
        const normalizedTaskType = String(taskType || '').trim().toUpperCase();
        const normalizedStatus = String(nextStatus || '').trim().toLowerCase();
        if (!normalizedTaskType || !normalizedStatus) return;

        const rec = this.getManualAnalysisRecommendation(normalizedTaskType);
        const manualOnly = rec?.manual_only === true || rec?.auto_generation_supported === false;

        if (normalizedStatus === 'reset') {
            this.clearManualAnalysisDraft(normalizedTaskType, {
                status: manualOnly ? 'manual_only' : 'not_started',
                imported_count: 0,
                imported_batches: 0,
                last_imported_at: null,
                last_selected_at: null,
            });
            if (this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType) === normalizedTaskType) {
                this.aiTemplateType = 'material_analysis';
                this.sourceText = '';
                this.parsedResult = null;
                this.updateAIAgentPromptTextarea();
                this._updateLiveCounter('');
            }
            this.showToast(`${wt('im.k622', 'Статус для')} ${this.getEditorFacingTaskTypeLabel(normalizedTaskType)} ${wt('im.k623', 'сброшен.')}`, 'info');
            this.renderCurrentStep();
            return;
        }

        if (normalizedStatus === 'manual_done') {
            this.updateManualAnalysisRecommendationState(normalizedTaskType, {
                status: 'manual_done',
                last_imported_at: new Date().toISOString(),
            });
            this.showToast(`${wt('im.k624', 'Ручной этап отмечен для')} ${this.getEditorFacingTaskTypeLabel(normalizedTaskType)}.`, 'success');
            this.renderCurrentStep();
            return;
        }

        if (normalizedStatus === 'skipped') {
            this.updateManualAnalysisRecommendationState(normalizedTaskType, {
                status: 'skipped',
            });
            if (this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType) === normalizedTaskType) {
                this.aiTemplateType = 'material_analysis';
                this.sourceText = '';
                this.parsedResult = null;
                this.updateAIAgentPromptTextarea();
                this._updateLiveCounter('');
            }
            this.showToast(`${wt('im.k625', 'Тип')} ${this.getEditorFacingTaskTypeLabel(normalizedTaskType)} ${wt('im.k626', 'помечен как пропущенный.')}`, 'warning');
            this.renderCurrentStep();
            return;
        }
    }

    getManualAnalysisCoverageSnapshot(session = this.getActiveManualAnalysisSession()) {
        if (!session?.analysis?.ok) {
            return {
                rows: [],
                uncovered: [],
                coveredOnce: [],
                coveredMulti: [],
            };
        }

        const units = Array.isArray(session.analysis.educational_units) ? session.analysis.educational_units : [];
        const recommendations = Array.isArray(session.analysis.recommendations) ? session.analysis.recommendations : [];
        const recommendationState = (session.recommendation_state && typeof session.recommendation_state === 'object')
            ? session.recommendation_state
            : {};

        const rows = units.map((unit) => {
            const unitId = Number(unit?.id);
            const recommendedBy = recommendations
                .filter((rec) => Array.isArray(rec?.covers_units) && rec.covers_units.map((id) => Number(id)).includes(unitId))
                .map((rec) => ({
                    task_type: String(rec?.task_type || '').trim().toUpperCase(),
                    label: String(rec?.editor_label || this.getEditorFacingTaskTypeLabel(rec?.task_type)),
                }));

            const completedBy = recommendedBy.filter((item) => {
                const state = recommendationState[item.task_type];
                return ['imported', 'manual_done'].includes(String(state?.status || '').trim().toLowerCase());
            });

            const pendingBy = recommendedBy.filter((item) => {
                const state = recommendationState[item.task_type];
                return !['imported', 'manual_done', 'skipped'].includes(String(state?.status || '').trim().toLowerCase());
            });

            let status = 'uncovered';
            if (completedBy.length >= 2) status = 'covered_multi';
            else if (completedBy.length === 1) status = 'covered_once';

            return {
                unit,
                status,
                completedBy,
                pendingBy,
                recommendedBy,
            };
        });

        return {
            rows,
            uncovered: rows.filter((row) => row.status === 'uncovered'),
            coveredOnce: rows.filter((row) => row.status === 'covered_once'),
            coveredMulti: rows.filter((row) => row.status === 'covered_multi'),
        };
    }

    renderManualAnalysisCoverageMapCard() {
        const session = this.getActiveManualAnalysisSession();
        if (!session?.analysis?.ok) return '';

        const snapshot = this.getManualAnalysisCoverageSnapshot(session);
        const summaryBadge = (label, count, tone) => `
            <div class="rounded-lg border ${tone} px-3 py-2 text-xs">
                <div class="text-text-secondary">${label}</div>
                <div class="text-base font-bold text-text-main mt-0.5">${count}</div>
            </div>
        `;

        const unitRows = snapshot.rows.map((row) => {
            const statusMeta = row.status === 'covered_multi'
                ? { label: wt('im.k045', 'покрыто 2+ типами'), className: 'bg-success-lighter text-success-text border border-success-light' }
                : row.status === 'covered_once'
                    ? { label: wt('im.k046', 'покрыто'), className: 'bg-info-lighter text-info-text border border-info-light' }
                    : { label: wt('im.k047', 'ещё не покрыто'), className: 'bg-warning-lighter text-warning-text border border-warning-light' };
            const completed = row.completedBy.map((item) => item.label).join('; ');
            const pending = row.pendingBy.map((item) => item.label).join('; ');
            return `
                <div class="rounded-lg border border-border-subtle bg-surface-2 p-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="text-sm font-semibold text-text-main">#${Number(row.unit?.id || 0)} ${this.escapeHtml(String(row.unit?.title || wt('im.k820', 'Единица')))}</div>
                            ${row.unit?.description ? `<div class="mt-1 text-[11px] text-text-secondary">${this.escapeHtml(String(row.unit.description))}</div>` : ''}
                            ${completed ? `<div class="mt-2 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k821', 'Уже закрыто:')}</span> ${this.escapeHtml(completed)}</div>` : ''}
                            ${pending ? `<div class="mt-1 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k822', 'Ещё можно закрыть:')}</span> ${this.escapeHtml(pending)}</div>` : ''}
                        </div>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusMeta.className}">${this.escapeHtml(statusMeta.label)}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="rounded-xl border border-border-subtle bg-surface-1 p-4 space-y-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 class="text-sm font-bold text-text-main">${wt('im.k627', 'Карта покрытия материала')}</h4>
                        <p class="text-xs text-text-secondary mt-1">${wt('im.k628', 'Показывает, какие образовательные единицы уже закрыты импортом или ручной работой, а какие ещё требуют отдельного типа задания.')}</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    ${summaryBadge(wt('im.k629', 'Всего единиц'), snapshot.rows.length, 'border-border-subtle bg-surface-2')}
                    ${summaryBadge(wt('im.k630', 'Не покрыто'), snapshot.uncovered.length, 'border-warning-light bg-warning-lighter')}
                    ${summaryBadge(wt('im.k631', 'Покрыто 1 типом'), snapshot.coveredOnce.length, 'border-info-light bg-info-lighter')}
                    ${summaryBadge(wt('im.k632', 'Покрыто 2+ типами'), snapshot.coveredMulti.length, 'border-success-light bg-success-lighter')}
                </div>
                ${snapshot.uncovered.length ? `
                    <div class="rounded-lg border border-warning-light bg-warning-lighter p-3 text-xs text-warning-text">
                        <span class="font-semibold">${wt('im.k634', 'Сейчас без покрытия:')}</span>
                        ${this.escapeHtml(snapshot.uncovered.map((row) => `#${row.unit.id} ${row.unit.title}`).join('; '))}
                    </div>
                ` : `
                    <div class="rounded-lg border border-success-light bg-success-lighter p-3 text-xs text-success-text">
                        ${wt('im.k565', 'Все образовательные единицы уже покрыты хотя бы одним импортированным или вручную завершённым типом.')}
                    </div>
                `}
                <div class="space-y-2">
                    ${unitRows}
                </div>
            </div>
        `;
    }

    formatTheorySessionTimestamp(value) {
        const date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return wt('im.k048', 'Без даты');
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    getManualAnalysisSessionHeadline(session) {
        const normalized = this.normalizeManualAnalysisSession(session);
        if (!normalized) return wt('im.k049', 'Анализ без контекста');
        const parts = [
            normalized.module_name || normalized.module_id || '',
            normalized.topic_name || normalized.topic_id || '',
        ].filter(Boolean);
        return parts.length ? parts.join(' / ') : wt('im.k050', 'Анализ без выбранной темы');
    }

    renderTheoryAnalysisHomeScreen() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session?.analysis?.ok) return '';
        const snapshot = this.getManualAnalysisCoverageSnapshot(session);
        const draftCount = Object.values(session.recommendation_state || {}).filter((state) => {
            return !!String(state?.draft_source_text || '').trim() || !!state?.draft_parsed_result;
        }).length;
        const importedTypes = Object.values(session.recommendation_state || {}).filter((state) => {
            return Math.max(0, Number(state?.imported_count || 0)) > 0 || String(state?.status || '').trim().toLowerCase() === 'manual_done';
        }).length;
        const archiveCount = this.getManualAnalysisArchive().length;

        return `
            <div class="max-w-4xl mx-auto space-y-5">
                <div class="rounded-2xl border border-border-subtle bg-surface-1 p-5">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div class="text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">${wt('im.k823', 'Активный анализ')}</div>
                            <h3 class="mt-1 text-lg font-bold text-text-main">${this.escapeHtml(this.getManualAnalysisSessionHeadline(session))}</h3>
                            <div class="mt-2 text-sm text-text-secondary">
                                ${wt('im.k051', 'Последнее обновление:')}${this.escapeHtml(this.formatTheorySessionTimestamp(session.updated_at))}
                            </div>
                            <div class="mt-1 text-sm text-text-secondary">
                                ${this.escapeHtml(String(session.analysis?.human_summary || wt('im.k635', 'Открыт сохранённый анализ материала.')))}
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button onclick="dashboard.importManager.resumeManualAnalysisSession()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                                ${wt('im.k052', 'Продолжить')}
                            </button>
                            <button onclick="dashboard.importManager.startFreshTheoryAnalysis()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                ${wt('im.k053', 'Новый анализ')}
                            </button>
                            <button onclick="dashboard.importManager.openTheoryAnalysisArchive()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                ${wt('im.k054', 'Архив (')}${archiveCount})
                            </button>
                        </div>
                    </div>
                    <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
                            <div class="text-xs text-text-secondary">${wt('im.k824', 'Единиц')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${snapshot.rows.length}</div>
                        </div>
                        <div class="rounded-lg border border-warning-light bg-warning-lighter px-3 py-2">
                            <div class="text-xs text-warning-text">${wt('im.k825', 'Без покрытия')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${snapshot.uncovered.length}</div>
                        </div>
                        <div class="rounded-lg border border-info-light bg-info-lighter px-3 py-2">
                            <div class="text-xs text-info-text">${wt('im.k826', 'Черновики')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${draftCount}</div>
                        </div>
                        <div class="rounded-lg border border-success-light bg-success-lighter px-3 py-2">
                            <div class="text-xs text-success-text">${wt('im.k827', 'Импортированные типы')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${importedTypes}</div>
                        </div>
                    </div>
                </div>

                <div class="flex flex-wrap gap-3">
                    <button onclick="dashboard.importManager.archiveActiveManualAnalysisSession()"
                        class="px-4 py-2 text-sm font-medium rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                        ${wt('im.k055', 'Сохранить в архив')}
                    </button>
                    <button onclick="dashboard.importManager.deleteActiveManualAnalysisSession()"
                        class="px-4 py-2 text-sm font-medium rounded-lg border border-error-light text-error hover:bg-error-lighter transition-colors">
                        ${wt('im.k056', 'Удалить текущий анализ')}
                    </button>
                </div>

                ${this.renderManualAnalysisCoverageMapCard()}
            </div>
        `;
    }

    renderTheoryAnalysisArchiveScreen() {
        const items = this.getManualAnalysisArchive();
        return `
            <div class="max-w-4xl mx-auto space-y-5">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-lg font-bold text-text-main">${wt('im.k636', 'Архив анализов')}</h3>
                        <div class="text-sm text-text-secondary mt-1">
                            ${wt('im.k057', 'Здесь можно сохранить анализ даже без создания заданий и позже вернуться к нему.')}
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="dashboard.importManager.openTheoryAnalysisHome()"
                            class="px-4 py-2 text-sm font-medium rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k058', 'Назад')}
                        </button>
                        <button onclick="dashboard.importManager.startFreshTheoryAnalysis()"
                            class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                            ${wt('im.k059', 'Новый анализ')}
                        </button>
                    </div>
                </div>

                ${items.length ? `
                    <div class="space-y-3">
                        ${items.map((entry) => {
                            const session = this.normalizeManualAnalysisSession(entry.session);
                            const snapshot = this.getManualAnalysisCoverageSnapshot(session);
                            return `
                                <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                                    <div class="flex flex-wrap items-start justify-between gap-4">
                                        <div class="min-w-0 flex-1">
                                            <div class="text-sm font-bold text-text-main">${this.escapeHtml(this.getManualAnalysisSessionHeadline(session))}</div>
                                            <div class="mt-1 text-xs text-text-secondary">
                                                ${wt('im.k060', 'Архивирован:')}${this.escapeHtml(this.formatTheorySessionTimestamp(entry.archived_at))}
                                            </div>
                                            <div class="mt-2 text-sm text-text-secondary">
                                                ${this.escapeHtml(String(session?.analysis?.human_summary || ''))}
                                            </div>
                                            <div class="mt-2 text-xs text-text-secondary">
                                                ${wt('im.k061', 'Единиц: <strong>')}${snapshot.rows.length}</strong>,
                                                ${wt('im.k062', 'без покрытия: <strong>')}${snapshot.uncovered.length}</strong>
                                            </div>
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            <button onclick="dashboard.importManager.restoreArchivedManualAnalysisSession('${this.escapeInlineJsString(String(entry.id))}')"
                                                class="px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                                                ${wt('im.k063', 'Открыть')}
                                            </button>
                                            <button onclick="dashboard.importManager.deleteArchivedManualAnalysisSession('${this.escapeInlineJsString(String(entry.id))}')"
                                                class="px-3 py-2 text-sm font-medium rounded-lg border border-error-light text-error hover:bg-error-lighter transition-colors">
                                                ${wt('im.k064', 'Удалить')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : `
                    <div class="rounded-2xl border border-border-subtle bg-surface-1 p-6 text-center">
                        <div class="text-base font-semibold text-text-main">${wt('im.k828', 'Архив пока пуст')}</div>
                        <div class="mt-2 text-sm text-text-secondary">
                            ${wt('im.k566', 'Сохраняйте полезные анализы в архив, чтобы возвращаться к ним позже даже без генерации заданий.')}
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    renderManualAnalysisCoverageMapCard() {
        const session = this.getActiveManualAnalysisSession();
        if (!session?.analysis?.ok) return '';

        const snapshot = this.getManualAnalysisCoverageSnapshot(session);
        const summaryBadge = (label, count, tone) => `
            <div class="rounded-lg border ${tone} bg-surface-2 px-3 py-2 text-xs">
                <div class="text-text-secondary">${label}</div>
                <div class="text-base font-bold text-text-main mt-0.5">${count}</div>
            </div>
        `;

        const unitRows = snapshot.rows.map((row) => {
            const statusMeta = row.status === 'covered_multi'
                ? { label: wt('im.k065', 'покрыто 2+ типами'), className: 'bg-surface-1 text-text-main border border-success-light' }
                : row.status === 'covered_once'
                    ? { label: wt('im.k066', 'покрыто'), className: 'bg-surface-1 text-text-main border border-info-light' }
                    : { label: wt('im.k067', 'ещё не покрыто'), className: 'bg-surface-1 text-text-main border border-warning-light' };
            const completed = row.completedBy.map((item) => item.label).join('; ');
            const pending = row.pendingBy.map((item) => item.label).join('; ');
            return `
                <div class="rounded-lg border border-border-subtle bg-surface-2 p-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                            <div class="text-sm font-semibold text-text-main">#${Number(row.unit?.id || 0)} ${this.escapeHtml(String(row.unit?.title || wt('im.k820', 'Единица')))}</div>
                            ${row.unit?.description ? `<div class="mt-1 text-[11px] text-text-secondary">${this.escapeHtml(String(row.unit.description))}</div>` : ''}
                            ${completed ? `<div class="mt-2 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k821', 'Уже закрыто:')}</span> ${this.escapeHtml(completed)}</div>` : ''}
                            ${pending ? `<div class="mt-1 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k822', 'Ещё можно закрыть:')}</span> ${this.escapeHtml(pending)}</div>` : ''}
                        </div>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusMeta.className}">${this.escapeHtml(statusMeta.label)}</span>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="rounded-xl border border-border-subtle bg-surface-1 p-4 space-y-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h4 class="text-sm font-bold text-text-main">${wt('im.k627', 'Карта покрытия материала')}</h4>
                        <p class="text-xs text-text-secondary mt-1">${wt('im.k628', 'Показывает, какие образовательные единицы уже закрыты импортом или ручной работой, а какие ещё требуют отдельного типа задания.')}</p>
                    </div>
                </div>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-2">
                    ${summaryBadge(wt('im.k629', 'Всего единиц'), snapshot.rows.length, 'border-border-subtle')}
                    ${summaryBadge(wt('im.k633', 'Без покрытия'), snapshot.uncovered.length, 'border-warning-light')}
                    ${summaryBadge(wt('im.k631', 'Покрыто 1 типом'), snapshot.coveredOnce.length, 'border-info-light')}
                    ${summaryBadge(wt('im.k632', 'Покрыто 2+ типами'), snapshot.coveredMulti.length, 'border-success-light')}
                </div>
                ${snapshot.uncovered.length ? `
                    <div class="rounded-lg border border-warning-light bg-surface-2 p-3 text-xs text-text-secondary">
                        <span class="font-semibold text-text-main">${wt('im.k634', 'Сейчас без покрытия:')}</span>
                        ${this.escapeHtml(snapshot.uncovered.map((row) => `#${row.unit.id} ${row.unit.title}`).join('; '))}
                    </div>
                ` : `
                    <div class="rounded-lg border border-success-light bg-surface-2 p-3 text-xs text-text-secondary">
                        ${wt('im.k565', 'Все образовательные единицы уже покрыты хотя бы одним импортированным или вручную завершённым типом.')}
                    </div>
                `}
                <div class="space-y-2">
                    ${unitRows}
                </div>
            </div>
        `;
    }

    formatTheorySessionTimestamp(value) {
        const date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return wt('im.k068', 'Без даты');
        return date.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    getManualAnalysisSessionHeadline(session) {
        const normalized = this.normalizeManualAnalysisSession(session);
        if (!normalized) return wt('im.k069', 'Анализ без контекста');
        const parts = [
            normalized.module_name || normalized.module_id || '',
            normalized.topic_name || normalized.topic_id || '',
        ].filter(Boolean);
        return parts.length ? parts.join(' / ') : wt('im.k070', 'Анализ без выбранной темы');
    }

    renderTheoryAnalysisHomeScreen() {
        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        if (!session?.analysis?.ok) return '';
        const snapshot = this.getManualAnalysisCoverageSnapshot(session);
        const draftCount = Object.values(session.recommendation_state || {}).filter((state) => {
            return !!String(state?.draft_source_text || '').trim() || !!state?.draft_parsed_result;
        }).length;
        const importedTypes = Object.values(session.recommendation_state || {}).filter((state) => {
            return Math.max(0, Number(state?.imported_count || 0)) > 0 || String(state?.status || '').trim().toLowerCase() === 'manual_done';
        }).length;
        const archiveCount = this.getManualAnalysisArchive().length;

        return `
            <div class="max-w-4xl mx-auto space-y-5">
                <div class="rounded-2xl border border-border-subtle bg-surface-1 p-5">
                    <div class="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div class="text-xs font-semibold uppercase tracking-[0.08em] text-text-secondary">${wt('im.k823', 'Активный анализ')}</div>
                            <h3 class="mt-1 text-lg font-bold text-text-main">${this.escapeHtml(this.getManualAnalysisSessionHeadline(session))}</h3>
                            <div class="mt-2 text-sm text-text-secondary">
                                ${wt('im.k071', 'Последнее обновление:')}${this.escapeHtml(this.formatTheorySessionTimestamp(session.updated_at))}
                            </div>
                            <div class="mt-1 text-sm text-text-secondary">
                                ${this.escapeHtml(String(session.analysis?.human_summary || wt('im.k635', 'Открыт сохранённый анализ материала.')))}
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button onclick="dashboard.importManager.resumeManualAnalysisSession()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                                ${wt('im.k072', 'Продолжить')}
                            </button>
                            <button onclick="dashboard.importManager.startFreshTheoryAnalysis()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                ${wt('im.k073', 'Новый анализ')}
                            </button>
                            <button onclick="dashboard.importManager.openTheoryAnalysisArchive()"
                                class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                ${wt('im.k074', 'Архив (')}${archiveCount})
                            </button>
                        </div>
                    </div>
                    <div class="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
                            <div class="text-xs text-text-secondary">${wt('im.k824', 'Единиц')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${snapshot.rows.length}</div>
                        </div>
                        <div class="rounded-lg border border-warning-light bg-surface-2 px-3 py-2">
                            <div class="text-xs text-text-secondary">${wt('im.k825', 'Без покрытия')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${snapshot.uncovered.length}</div>
                        </div>
                        <div class="rounded-lg border border-primary-light bg-surface-2 px-3 py-2">
                            <div class="text-xs text-text-secondary">${wt('im.k826', 'Черновики')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${draftCount}</div>
                        </div>
                        <div class="rounded-lg border border-success-light bg-surface-2 px-3 py-2">
                            <div class="text-xs text-text-secondary">${wt('im.k827', 'Импортированные типы')}</div>
                            <div class="text-base font-bold text-text-main mt-1">${importedTypes}</div>
                        </div>
                    </div>
                </div>

                <div class="flex flex-wrap gap-3">
                    <button onclick="dashboard.importManager.archiveActiveManualAnalysisSession()"
                        class="px-4 py-2 text-sm font-medium rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                        ${wt('im.k075', 'Сохранить в архив')}
                    </button>
                    <button onclick="dashboard.importManager.deleteActiveManualAnalysisSession()"
                        class="px-4 py-2 text-sm font-medium rounded-lg border border-error-light text-error hover:bg-error-lighter transition-colors">
                        ${wt('im.k076', 'Удалить текущий анализ')}
                    </button>
                </div>

                ${this.renderManualAnalysisCoverageMapCard()}
            </div>
        `;
    }

    renderTheoryAnalysisArchiveScreen() {
        const items = this.getManualAnalysisArchive();
        return `
            <div class="max-w-4xl mx-auto space-y-5">
                <div class="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h3 class="text-lg font-bold text-text-main">${wt('im.k636', 'Архив анализов')}</h3>
                        <div class="text-sm text-text-secondary mt-1">
                            ${wt('im.k077', 'Здесь можно сохранить анализ даже без создания заданий и позже вернуться к нему.')}
                        </div>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button onclick="dashboard.importManager.openTheoryAnalysisHome()"
                            class="px-4 py-2 text-sm font-medium rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k078', 'Назад')}
                        </button>
                        <button onclick="dashboard.importManager.startFreshTheoryAnalysis()"
                            class="px-4 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                            ${wt('im.k079', 'Новый анализ')}
                        </button>
                    </div>
                </div>

                ${items.length ? `
                    <div class="space-y-3">
                        ${items.map((entry) => {
                            const session = this.normalizeManualAnalysisSession(entry.session);
                            const snapshot = this.getManualAnalysisCoverageSnapshot(session);
                            return `
                                <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                                    <div class="flex flex-wrap items-start justify-between gap-4">
                                        <div class="min-w-0 flex-1">
                                            <div class="text-sm font-bold text-text-main">${this.escapeHtml(this.getManualAnalysisSessionHeadline(session))}</div>
                                            <div class="mt-1 text-xs text-text-secondary">
                                                ${wt('im.k080', 'Архивирован:')}${this.escapeHtml(this.formatTheorySessionTimestamp(entry.archived_at))}
                                            </div>
                                            <div class="mt-2 text-sm text-text-secondary">
                                                ${this.escapeHtml(String(session?.analysis?.human_summary || ''))}
                                            </div>
                                            <div class="mt-2 text-xs text-text-secondary">
                                                ${wt('im.k081', 'Единиц: <strong class="text-text-main">')}${snapshot.rows.length}</strong>,
                                                ${wt('im.k082', 'без покрытия: <strong class="text-text-main">')}${snapshot.uncovered.length}</strong>
                                            </div>
                                        </div>
                                        <div class="flex flex-wrap gap-2">
                                            <button onclick="dashboard.importManager.restoreArchivedManualAnalysisSession('${this.escapeInlineJsString(String(entry.id))}')"
                                                class="px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors">
                                                ${wt('im.k083', 'Открыть')}
                                            </button>
                                            <button onclick="dashboard.importManager.deleteArchivedManualAnalysisSession('${this.escapeInlineJsString(String(entry.id))}')"
                                                class="px-3 py-2 text-sm font-medium rounded-lg border border-error-light text-error hover:bg-error-lighter transition-colors">
                                                ${wt('im.k084', 'Удалить')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                ` : `
                    <div class="rounded-2xl border border-border-subtle bg-surface-1 p-6 text-center">
                        <div class="text-base font-semibold text-text-main">${wt('im.k828', 'Архив пока пуст')}</div>
                        <div class="mt-2 text-sm text-text-secondary">
                            ${wt('im.k566', 'Сохраняйте полезные анализы в архив, чтобы возвращаться к ним позже даже без генерации заданий.')}
                        </div>
                    </div>
                `}
            </div>
        `;
    }

    hasActiveWorkspaceImportFlow() {
        return !!(
            this.workspaceImportState?.request
            || this.workspaceImportState?.preview
            || this.workspaceImportState?.loadingPreview
            || this.workspaceImportState?.executing
        );
    }

    normalizeWorkspaceImportRequest(payload = {}) {
        const sourceComplexId = String(
            payload.sourceComplexId
            || payload.source_complex_id
            || ''
        ).trim();
        const sourceCatalogItemId = String(
            payload.sourceCatalogItemId
            || payload.source_catalog_item_id
            || ''
        ).trim();
        const sourceCatalogVersionId = String(
            payload.sourceCatalogVersionId
            || payload.source_catalog_version_id
            || ''
        ).trim();
        const preferExistingByLineage = payload.preferExistingByLineage !== false
            && payload.prefer_existing_by_lineage !== false;
        return {
            sourceComplexId,
            sourceCatalogItemId,
            sourceCatalogVersionId,
            preferExistingByLineage,
        };
    }

    getWorkspaceImportPreviewPayload() {
        if (this.workspaceImportState?.preview) return this.workspaceImportState.preview;
        if (this.isWorkspaceImportContractPayload(this.parsedResult)) {
            return this.normalizeWorkspaceImportResponse(this.parsedResult);
        }
        return null;
    }

    getWorkspaceImportExecutePayload() {
        if (this.workspaceImportState?.executeResult) return this.workspaceImportState.executeResult;
        if (this.isWorkspaceImportContractPayload(this.checkResult)) {
            return this.normalizeWorkspaceImportResponse(this.checkResult);
        }
        return null;
    }

    async openWorkspaceImportPreviewFlow(payload = {}) {
        void payload;
        this.resetWorkspaceImportState();
        this.showVoiceToast({
            severity: 'info',
            what: 'Legacy import is internal-only.',
            impact: 'Hosted editor surfaces no longer create workspace copies from linked content.',
            next: 'Open the linked publication directly or create a new workspace complex from scratch.',
        });
        if (this.dashboard && typeof this.dashboard.closeImportModal === 'function') {
            this.dashboard.closeImportModal();
        }
        return { ok: false, error: 'workspace_import_legacy_only' };
    }

    async retryWorkspaceImportPreview() {
        if (!this.workspaceImportState?.request) return;
        await this.openWorkspaceImportPreviewFlow(this.workspaceImportState.request);
    }

    isWorkspaceImportContractPayload(payload) {
        const routeNamespace = String(payload?.route_contract?.namespace || '').trim();
        const serviceNamespace = String(payload?.service_contract?.namespace || '').trim();
        return routeNamespace === 'internal_workspace_import' || serviceNamespace === 'internal_workspace_import';
    }

    normalizeWorkspaceImportNode(node = {}) {
        const payload = (node && typeof node === 'object') ? node : {};
        const ownership = this.dashboard && typeof this.dashboard.normalizeComplexOwnership === 'function'
            ? this.dashboard.normalizeComplexOwnership(payload)
            : {
                createdByUserId: String(payload?.ownership?.created_by_user_id || payload?.created_by_user_id || '').trim(),
                updatedByUserId: String(payload?.ownership?.updated_by_user_id || payload?.updated_by_user_id || '').trim(),
                createdVia: String(payload?.ownership?.created_via || payload?.created_via || '').trim() || 'legacy_unknown',
                contentScope: String(payload?.ownership?.content_scope || payload?.content_scope || '').trim() || 'shared_local',
                hasOwner: payload?.ownership?.has_owner === true || !!payload?.ownership?.created_by_user_id || !!payload?.created_by_user_id,
                isOwnedByCurrentUser: payload?.ownership?.is_owned_by_current_user === true,
                isSharedLibrary: payload?.ownership?.is_shared_library !== false,
            };
        const workspaceCopy = (payload.workspace_copy && typeof payload.workspace_copy === 'object')
            ? payload.workspace_copy
            : {};
        const sourceLineage = (payload.source_lineage && typeof payload.source_lineage === 'object')
            ? payload.source_lineage
            : {};
        return {
            ...payload,
            ownership,
            workspaceCopy: {
                kind: String(workspaceCopy.kind || '').trim() || 'local_draft',
                hasSourceLineage: workspaceCopy.has_source_lineage === true || workspaceCopy.hasSourceLineage === true,
                sourceLineageKey: String(
                    workspaceCopy.source_lineage_key
                    || workspaceCopy.sourceLineageKey
                    || ''
                ).trim() || null,
            },
            sourceLineage: {
                sourceCatalogItemId: String(
                    sourceLineage.source_catalog_item_id
                    || sourceLineage.sourceCatalogItemId
                    || ''
                ).trim() || null,
                sourceCatalogVersionId: String(
                    sourceLineage.source_catalog_version_id
                    || sourceLineage.sourceCatalogVersionId
                    || ''
                ).trim() || null,
                sourceEntityKind: String(
                    sourceLineage.source_entity_kind
                    || sourceLineage.sourceEntityKind
                    || ''
                ).trim() || null,
                sourceEntityId: String(
                    sourceLineage.source_entity_id
                    || sourceLineage.sourceEntityId
                    || ''
                ).trim() || null,
            },
        };
    }

    normalizeWorkspaceImportResponse(payload = {}) {
        const response = (payload && typeof payload === 'object') ? payload : {};
        const result = (response.result && typeof response.result === 'object') ? response.result : {};
        const normalizeNodeList = (items) => Array.isArray(items)
            ? items.map((item) => this.normalizeWorkspaceImportNode(item))
            : [];
        return {
            ok: response.ok !== false,
            importKind: String(response.import_kind || response.importKind || '').trim() || null,
            routeContract: (response.route_contract && typeof response.route_contract === 'object')
                ? response.route_contract
                : null,
            serviceContract: (response.service_contract && typeof response.service_contract === 'object')
                ? response.service_contract
                : null,
            source: (response.source && typeof response.source === 'object') ? response.source : null,
            summary: (response.summary && typeof response.summary === 'object') ? response.summary : null,
            workspace: (response.workspace && typeof response.workspace === 'object') ? response.workspace : null,
            result: {
                complex: this.normalizeWorkspaceImportNode(result.complex || {}),
                modules: normalizeNodeList(result.modules),
                topics: normalizeNodeList(result.topics),
                tasks: normalizeNodeList(result.tasks),
                theories: normalizeNodeList(result.theories),
                createdCounts: (result.created_counts && typeof result.created_counts === 'object') ? result.created_counts : {},
                reusedCounts: (result.reused_counts && typeof result.reused_counts === 'object') ? result.reused_counts : {},
                taskRefMap: (result.task_ref_map && typeof result.task_ref_map === 'object') ? result.task_ref_map : {},
            },
        };
    }

    renderWorkspaceImportSummaryStat(label, value, tone = 'neutral') {
        const toneMap = {
            neutral: 'border-border-subtle bg-surface-2 text-text-main',
            success: 'border-success-light bg-success-lighter text-success-darker',
            warning: 'border-warning-light bg-warning-lighter text-warning-darker',
            info: 'border-primary-light bg-primary-lighter text-primary-darker',
        };
        return `
            <div class="rounded-xl border px-4 py-3 ${toneMap[tone] || toneMap.neutral}">
                <div class="text-[11px] uppercase tracking-wide opacity-80">${this.escapeHtml(label)}</div>
                <div class="mt-1 text-2xl font-bold">${this.escapeHtml(String(value ?? 0))}</div>
            </div>
        `;
    }

    renderWorkspaceImportNodePreview(title, nodes = [], emptyText = wt('im.k085', 'Нет элементов.')) {
        const normalizedNodes = Array.isArray(nodes) ? nodes : [];
        if (!normalizedNodes.length) {
            return `
                <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                    <div class="text-sm font-semibold text-text-main">${this.escapeHtml(title)}</div>
                    <div class="mt-2 text-sm text-text-secondary">${this.escapeHtml(emptyText)}</div>
                </div>
            `;
        }
        const listHtml = normalizedNodes.slice(0, 5).map((node) => {
            const item = this.normalizeWorkspaceImportNode(node);
            const entityRef = String(
                item.workspace_entity_ref
                || item.target_task_ref
                || item.workspace_entity_id
                || item.id
                || ''
            ).trim();
            const sourceEntityId = item.sourceLineage?.sourceEntityId || '';
            const badges = [];
            if (item.workspaceCopy?.kind) {
                badges.push(`<span class="inline-flex items-center rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${this.escapeHtml(item.workspaceCopy.kind)}</span>`);
            }
            if (item.sourceLineage?.sourceEntityKind) {
                badges.push(`<span class="inline-flex items-center rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${this.escapeHtml(item.sourceLineage.sourceEntityKind)}</span>`);
            }
            const ownershipBadges = this.dashboard && typeof this.dashboard.renderComplexOwnershipBadges === 'function'
                ? this.dashboard.renderComplexOwnershipBadges(item.ownership)
                : '';
            return `
                <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-sm font-semibold text-text-main break-words">${this.escapeHtml(String(item.name || entityRef || title))}</div>
                            ${entityRef ? `<div class="mt-0.5 text-[11px] font-mono text-text-secondary break-all">${this.escapeHtml(entityRef)}</div>` : ''}
                            ${sourceEntityId ? `<div class="mt-1 text-[11px] text-text-secondary break-all">source: ${this.escapeHtml(sourceEntityId)}</div>` : ''}
                        </div>
                        <div class="flex flex-wrap gap-1">
                            ${badges.join('')}
                        </div>
                    </div>
                    ${ownershipBadges ? `<div class="mt-2 flex flex-wrap gap-1">${ownershipBadges}</div>` : ''}
                </div>
            `;
        }).join('');
        const hiddenCount = normalizedNodes.length > 5 ? normalizedNodes.length - 5 : 0;
        return `
            <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-sm font-semibold text-text-main">${this.escapeHtml(title)}</div>
                    <div class="text-xs text-text-secondary">${this.escapeHtml(String(normalizedNodes.length))}</div>
                </div>
                <div class="mt-3 space-y-2">${listHtml}</div>
                ${hiddenCount > 0 ? `<div class="mt-2 text-xs text-text-secondary">${wt('im.k829', 'И ещё {n} элементов.').replace('{n}', hiddenCount)}</div>` : ''}
            </div>
        `;
    }

    renderWorkspaceImportPreviewStep() {
        const state = this.workspaceImportState || {};
        const preview = this.getWorkspaceImportPreviewPayload();
        const request = state.request || {};
        if (state.loadingPreview) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k637', 'Подготовка workspace-копии...')}</h3>
                    <p class="text-text-secondary text-sm mt-2">${wt('im.k830', 'Проверяем source lineage, reuse и целевую структуру graph.')}</p>
                </div>
            `;
        }
        if (!preview) {
            return `
                <div class="max-w-3xl mx-auto animate-slide-up-fade">
                    <div class="rounded-2xl border border-error-light bg-error-lighter px-5 py-4">
                        <div class="text-base font-bold text-error-text">${wt('im.k831', 'Не удалось получить preview workspace-импорта')}</div>
                        <div class="mt-2 text-sm text-error-text break-words">${this.escapeHtml(state.error || 'workspace_import_preview_failed')}</div>
                        <div class="mt-4 flex flex-wrap gap-2">
                            <button type="button" onclick="dashboard.importManager.retryWorkspaceImportPreview()"
                                class="px-4 py-2 rounded-lg bg-primary text-primary-fg text-sm font-semibold hover:bg-primary-hover transition-colors">
                                ${wt('im.k086', 'Повторить preview')}
                            </button>
                        </div>
                    </div>
                </div>
            `;
        }

        const result = preview.result || {};
        const summary = preview.summary || {};
        const totalNodes = summary.total_nodes || {};
        const source = preview.source || {};
        const workspace = preview.workspace || {};
        const complexNode = result.complex || {};
        const plannedAction = String(complexNode.planned_action || 'workspace_import_preview').trim();
        return `
            <div class="max-w-5xl mx-auto animate-slide-up-fade space-y-5">
                <div>
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k638', 'Предпросмотр workspace-импорта')}</h3>
                    <p class="text-sm text-text-secondary mt-1">${wt('im.k832', 'Этот internal flow ещё не является public catalog API. Здесь мы проверяем, какая рабочая версия будет создана или переиспользована, с учётом lineage и ownership imported graph.')}</p>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                    ${this.renderWorkspaceImportSummaryStat(wt('im.k639', 'Комплекс'), totalNodes.complexes || 0, 'info')}
                    ${this.renderWorkspaceImportSummaryStat(wt('im.k640', 'Модули'), totalNodes.modules || 0, 'neutral')}
                    ${this.renderWorkspaceImportSummaryStat(wt('im.k641', 'Темы'), totalNodes.topics || 0, 'neutral')}
                    ${this.renderWorkspaceImportSummaryStat(wt('im.k642', 'Задания'), totalNodes.tasks || 0, 'success')}
                    ${this.renderWorkspaceImportSummaryStat(wt('im.k643', 'Теории'), totalNodes.theories || 0, 'neutral')}
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                        <div class="text-sm font-semibold text-text-main">${wt('im.k833', 'Источник')}</div>
                        <div class="mt-3 space-y-2 text-sm">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">source_complex_id</span>
                                <span class="font-mono text-text-main break-all">${this.escapeHtml(request.sourceComplexId || '')}</span>
                            </div>
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">catalog_item_id</span>
                                <span class="font-mono text-text-main break-all">${this.escapeHtml(source.catalog_item_id || request.sourceCatalogItemId || '')}</span>
                            </div>
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">catalog_version_id</span>
                                <span class="font-mono text-text-main break-all">${this.escapeHtml(source.catalog_version_id || request.sourceCatalogVersionId || '')}</span>
                            </div>
                        </div>
                    </div>

                    <div class="rounded-xl border border-border-subtle bg-surface-1 p-4">
                        <div class="text-sm font-semibold text-text-main">${wt('im.k834', 'Целевая версия в workspace')}</div>
                        <div class="mt-3 space-y-2 text-sm">
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">complex_id</span>
                                <span class="font-mono text-text-main break-all">${this.escapeHtml(workspace.complex_id || '')}</span>
                            </div>
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">complex_ref</span>
                                <span class="font-mono text-text-main break-all">${this.escapeHtml(workspace.complex_ref || '')}</span>
                            </div>
                            <div class="flex flex-wrap items-start justify-between gap-3">
                                <span class="text-text-secondary">planned_action</span>
                                <span class="font-semibold text-text-main">${this.escapeHtml(plannedAction)}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    ${this.renderWorkspaceImportNodePreview(wt('im.k639', 'Комплекс'), result.complex ? [result.complex] : [], wt('im.k644', 'Комплекс не найден.'))}
                    ${this.renderWorkspaceImportNodePreview(wt('im.k640', 'Модули'), result.modules, wt('im.k645', 'Модулей нет.'))}
                    ${this.renderWorkspaceImportNodePreview(wt('im.k641', 'Темы'), result.topics, wt('im.k646', 'Тем нет.'))}
                    ${this.renderWorkspaceImportNodePreview(wt('im.k642', 'Задания'), result.tasks, wt('im.k647', 'Заданий нет.'))}
                    ${this.renderWorkspaceImportNodePreview(wt('im.k643', 'Теории'), result.theories, wt('im.k648', 'Теорий нет.'))}
                </div>

            </div>
        `;
    }

    renderWorkspaceImportConfirmStep() {
        const state = this.workspaceImportState || {};
        const preview = this.getWorkspaceImportPreviewPayload();
        if (!preview) {
            return `
                <div class="max-w-3xl mx-auto text-center py-10 animate-slide-up-fade">
                    <div class="rounded-2xl border border-error-light bg-error-lighter px-5 py-4 text-left">
                        <div class="text-base font-bold text-error-text">${wt('im.k835', 'Подтверждение недоступно')}</div>
                        <div class="mt-2 text-sm text-error-text">${wt('im.k836', 'Сначала нужно получить корректный preview workspace-импорта.')}</div>
                    </div>
                </div>
            `;
        }
        const summary = preview.summary || {};
        const workspace = preview.workspace || {};
        const executeResult = this.getWorkspaceImportExecutePayload();
        const totalNodes = summary.total_nodes || {};
        const createdCounts = summary.created_counts || {};
        const reusedCounts = summary.reused_counts || {};
        const runtimeError = String(state.error || '').trim();
        const importedComplexId = String(
            executeResult?.workspace?.complex_id
            || executeResult?.result?.complex?.complex_id
            || executeResult?.result?.complex?.workspace_entity_id
            || workspace.complex_id
            || ''
        ).trim();
        return `
            <div class="max-w-3xl mx-auto text-center py-8 animate-slide-up-fade space-y-5">
                <div class="w-20 h-20 bg-primary-lighter rounded-full flex items-center justify-center mx-auto">
                    <span class="material-symbols-outlined text-primary text-[48px]">inventory_2</span>
                </div>

                <div>
                    <h3 class="text-xl font-bold text-text-main mb-2">${wt('im.k649', 'Готово к добавлению в workspace')}</h3>
                    <p class="text-text-secondary">${wt('im.k837', 'Будет создана или переиспользована рабочая версия комплекса со всеми зависимостями, без merge по имени.')}</p>
                </div>

                ${runtimeError ? `
                    <div class="rounded-xl border border-error-light bg-error-lighter px-4 py-3 text-left text-sm text-error-text">
                        <div class="font-semibold">${wt('im.k838', 'Последняя ошибка выполнения')}</div>
                        <div class="mt-1 break-words">${this.escapeHtml(runtimeError)}</div>
                    </div>
                ` : ''}

                <div class="bg-surface-2 rounded-lg p-6 text-left">
                    <div class="space-y-2 text-sm">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">Complex ID</span>
                            <span class="font-mono text-text-main break-all">${this.escapeHtml(workspace.complex_id || '')}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">Tasks</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(String(totalNodes.tasks || 0))}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">Modules / Topics / Theories</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(`${totalNodes.modules || 0} / ${totalNodes.topics || 0} / ${totalNodes.theories || 0}`)}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k839', 'Создаст новых')}</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(`${createdCounts.modules || 0} модулей, ${createdCounts.topics || 0} тем, ${createdCounts.tasks || 0} заданий, ${createdCounts.theories || 0} теорий`)}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k840', 'Переиспользует')}</span>
                            <span class="font-medium text-text-main">${this.escapeHtml(`${reusedCounts.modules || 0} модулей, ${reusedCounts.topics || 0} тем, ${reusedCounts.tasks || 0} заданий, ${reusedCounts.theories || 0} теорий`)}</span>
                        </div>
                    </div>
                </div>

                ${executeResult?.ok ? `
                    <div class="rounded-xl border border-success-light bg-success-lighter px-4 py-3 text-left text-sm text-success-darker">
                        <div class="font-semibold">${wt('im.k841', 'Последний execute-ответ уже нормализован')}</div>
                        <div class="mt-1 break-words">service_contract: ${this.escapeHtml(executeResult.serviceContract?.namespace || '')}</div>
                        ${importedComplexId ? `<div class="mt-1 break-words">workspace_complex_id: ${this.escapeHtml(importedComplexId)}</div>` : ''}
                    </div>
                    <div class="flex flex-wrap items-center justify-center gap-3">
                        <button
                            type="button"
                            onclick="dashboard.importManager.openWorkspaceImportResultComplex()"
                            class="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-fg shadow-sm transition hover:opacity-95"
                        >
                            <span class="material-symbols-outlined text-[18px]">open_in_new</span>
                            ${wt('im.k567', 'Открыть copy')}
                        </button>
                        <button
                            type="button"
                            onclick="dashboard.closeImportModal()"
                            class="inline-flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-1 px-5 py-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
                        >
                            <span class="material-symbols-outlined text-[18px]">close</span>
                            ${wt('im.k568', 'Закрыть')}
                        </button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    async executeWorkspaceImportFlow() {
        const request = this.workspaceImportState?.request;
        if (!request) {
            this.showToast(wt('im.k087', 'Нет запроса для workspace-импорта.'), 'error');
            return { ok: false, error: 'workspace_import_request_missing' };
        }

        this.workspaceImportState.executing = true;
        this.workspaceImportState.error = '';
        this.updateNavigationButtons();
        try {
            const response = await fetch('/api/internal/workspace/import/complex-copy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    source_complex_id: request.sourceComplexId,
                    source_catalog_item_id: request.sourceCatalogItemId,
                    source_catalog_version_id: request.sourceCatalogVersionId,
                    prefer_existing_by_lineage: request.preferExistingByLineage,
                }),
            });
            const data = await response.json();
            if (!response.ok || data?.ok === false) {
                throw new Error(data?.error || `workspace_import_execute_failed:${response.status}`);
            }
            const normalized = this.normalizeWorkspaceImportResponse(data);
            this.workspaceImportState.executeResult = normalized;
            this.checkResult = data;
            return normalized;
        } catch (error) {
            const message = String(error?.message || 'workspace_import_execute_failed');
            this.workspaceImportState.error = message;
            return { ok: false, error: message };
        } finally {
            this.workspaceImportState.executing = false;
            this.renderCurrentStep();
            this.updateNavigationButtons();
        }
    }

    async openWorkspaceImportResultComplex() {
        const executeResult = this.getWorkspaceImportExecutePayload();
        const complexId = String(
            executeResult?.workspace?.complex_id
            || executeResult?.result?.complex?.complex_id
            || executeResult?.result?.complex?.workspace_entity_id
            || ''
        ).trim();
        if (!complexId) {
            this.showToast(wt('im.k088', 'Не удалось определить созданную workspace-копию.'), 'error');
            return;
        }

        try {
            if (this.dashboard && typeof this.dashboard.loadWorkspaceLimits === 'function') {
                this.dashboard.loadWorkspaceLimits().catch(() => {});
            }
            if (this.dashboard && typeof this.dashboard.loadCatalog === 'function') {
                await this.dashboard.loadCatalog();
            }
        } catch (error) {
            console.warn('[ImportManager] Failed to refresh catalog before opening imported copy:', error);
        }

        if (this.dashboard && typeof this.dashboard.closeImportModal === 'function') {
            this.dashboard.closeImportModal();
        }
        if (this.dashboard && typeof this.dashboard.openComplexBuilder === 'function') {
            this.dashboard.openComplexBuilder(complexId);
            return;
        }
        this.showToast(wt('im.k089', 'Рабочая версия создана, но переход к комплексу недоступен.'), 'warning');
    }

    setModalPurpose(purpose) {
        this.modalPurpose = purpose === 'theory_analysis' ? 'theory_analysis' : 'import';
        const modal = document.getElementById('import-modal');
        if (!modal) return;

        const titleEl = modal.querySelector('[data-role="import-modal-title"]')
            || modal.querySelector('h2.text-xl.font-bold.text-text-main');
        let subtitleEl = modal.querySelector('[data-role="import-modal-subtitle"]');
        const stepsPanel = modal.querySelector('[data-role="import-steps-panel"]');
        const footer = modal.querySelector('[data-role="import-footer"]');
        const content = modal.querySelector('[data-role="import-content"]');

        if (titleEl) {
            titleEl.textContent = this.modalPurpose === 'theory_analysis' ? wt('im.k559', 'Анализ теории') : wt('im.k560', 'Импорт заданий');
        }
        if (titleEl) {
            if (!subtitleEl) {
                subtitleEl = document.createElement('p');
                subtitleEl.setAttribute('data-role', 'import-modal-subtitle');
                subtitleEl.className = 'editor-flow-wrap mt-1 text-sm text-text-secondary';
                titleEl.insertAdjacentElement('afterend', subtitleEl);
            }
            subtitleEl.textContent = this.modalPurpose === 'theory_analysis'
                ? wt('im.k090', 'Стратегический workflow: анализ материала, карта покрытия и поэтапная генерация типов заданий.')
                : wt('im.k091', 'Быстрый импорт готовых задач или прямой AI-import по конкретному типу.');
        }
        if (stepsPanel) {
            stepsPanel.classList.toggle('hidden', this.modalPurpose === 'theory_analysis');
        }
        if (footer) {
            footer.classList.toggle('hidden', this.modalPurpose === 'theory_analysis');
        }
        if (content) {
            content.classList.toggle('p-6', this.modalPurpose !== 'theory_analysis');
            content.classList.toggle('p-5', this.modalPurpose === 'theory_analysis');
        }
        modal.style.background = this.modalPurpose === 'theory_analysis' ? 'rgba(0, 0, 0, 0.52)' : '';
    }

    enterImportModalMode() {
        this.setModalPurpose('import');
        if (this.aiTemplateType === 'material_analysis') {
            this.aiTemplateType = 'open_answer';
        }
    }

    async openTheoryAnalysisMode() {
        this.setModalPurpose('theory_analysis');
        if (!this.selectedModule && !this.selectedTopic) {
            this.presetFromCurrentLocation();
        }
        this.theorySubMode = 'analysis';
        this.importMode = 'ai';
        this.currentStep = 2;
        this.generationResult = null;
        this.parsedResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importRequestKey = null;
        this.aiSelectedRecs.clear();
        this.aiGenerating = false;
        this.aiAnalyzing = false;
        this.theoryOpeningRunId = null;
        const session = this.getActiveManualAnalysisSession();
        if (session?.analysis?.ok) {
            this.manualAnalysisResult = session.analysis;
            this.selectedModule = session.module_id || this.selectedModule || '';
            this.selectedTopic = session.topic_id || this.selectedTopic || '';
            this.selectedModuleName = session.module_name || this.selectedModuleName || '';
            this.selectedTopicName = session.topic_name || this.selectedTopicName || '';
        }
        this.aiTemplateType = 'material_analysis';
        this.theorySubMode = session?.analysis?.ok ? 'home' : 'analysis';
        this.renderTheoryAnalysisMode();
        if (this.isTheoryExternalAnalysisFallback()) {
            return { ok: true, mode: 'external_manual' };
        }
        this.aiCheckStatus().then(() => this.renderTheoryAnalysisMode()).catch(() => {});
        this.loadTheoryAnalysisRuns().catch(() => {});
    }

    // =========================================================================
    // Step Navigation
    // =========================================================================

    goToStep(step) {
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
            return;
        }
        this.currentStep = step;
        this.updateStepUI();
        this.renderCurrentStep();
        this.updateNavigationButtons();
    }

    /**
     * Preset module/topic from current dashboard location
     * Called when opening import modal
     */
    presetFromCurrentLocation() {
        const moduleId = this.dashboard.activeModuleId;
        const topicId = this.dashboard.activeTopicId;

        if (moduleId) {
            this.selectedModule = moduleId;
            const module = this.dashboard.catalog.find(m => m.id === moduleId);
            this.selectedModuleName = module ? (module.name || module.id) : moduleId;

            if (topicId && module) {
                const topic = (module.topics || []).find(t => t.id === topicId);
                if (topic) {
                    this.selectedTopic = topicId;
                    this.selectedTopicName = topic.name || topic.id;
                }
            }
        }
    }

    /**
     * Apply preset selection to UI elements after rendering
     */
    applyPresetSelection() {
        const moduleSelect = document.getElementById('import-module-select');
        const topicSelect = document.getElementById('import-topic-select');

        if (moduleSelect && this.selectedModule) {
            moduleSelect.value = this.selectedModule;
            // Trigger topic select update
            this.updateTopicSelect();

            // Set topic value after topics are loaded
            if (topicSelect && this.selectedTopic) {
                topicSelect.value = this.selectedTopic;
            }
        }
    }

    nextStep() {
        if (this.modalPurpose === 'theory_analysis') {
            if (this.currentStep < 4) {
                this.currentStep += 1;
                this.renderTheoryAnalysisMode();
            }
            return;
        }
        if (this.currentStep < 4) {
            this.goToStep(this.currentStep + 1);
        }
    }

    prevStep() {
        if (this.modalPurpose === 'theory_analysis') {
            if (this.currentStep > 2) {
                this.currentStep -= 1;
                this.renderTheoryAnalysisMode();
            }
            return;
        }
        if (this.hasActiveWorkspaceImportFlow()) {
            if (this.currentStep > 3) {
                this.goToStep(this.currentStep - 1);
                return;
            }
            if (this.dashboard && typeof this.dashboard.closeImportModal === 'function') {
                this.dashboard.closeImportModal();
            }
            return;
        }
        if (this.currentStep > 1) {
            this.goToStep(this.currentStep - 1);
        }
    }

    updateStepUI() {
        if (this.modalPurpose === 'theory_analysis') return;
        const steps = document.querySelectorAll('[data-role="import-steps"] [data-step]');
        steps.forEach(stepEl => {
            const stepNum = parseInt(stepEl.dataset.step);
            const circle = stepEl.querySelector('div:first-child');
            const label = stepEl.querySelector('span');
            if (label && !stepEl.dataset.defaultLabel) {
                stepEl.dataset.defaultLabel = label.textContent || '';
            }

            if (this.hasActiveWorkspaceImportFlow()) {
                if (stepNum < 3) {
                    stepEl.classList.add('hidden');
                    return;
                }
                stepEl.classList.remove('hidden');
                if (label) {
                    label.textContent = stepNum === 3 ? 'Legacy import' : 'Confirm';
                }
            } else {
                stepEl.classList.remove('hidden');
                if (label && stepEl.dataset.defaultLabel) {
                    label.textContent = stepEl.dataset.defaultLabel;
                }
            }

            if (stepNum === this.currentStep) {
                // Current step - primary color with number
                circle.className = 'w-10 h-10 rounded-full bg-primary flex items-center justify-center text-primary-contrast font-semibold text-sm transition-all duration-300';
                circle.innerHTML = stepNum;
                label.className = 'editor-import-step-label text-xs font-medium text-text-secondary transition-colors duration-300';
                stepEl.classList.remove('completed');
            } else if (stepNum < this.currentStep) {
                // Completed step - green with checkmark
                circle.className = 'w-10 h-10 rounded-full bg-success flex items-center justify-center text-primary-contrast font-semibold text-sm cursor-pointer hover:ring-2 hover:ring-success hover:ring-offset-2 transition-all duration-300';
                circle.innerHTML = '<span class="material-symbols-outlined text-[20px]">check</span>';
                label.className = 'editor-import-step-label text-xs font-medium text-success-text transition-colors duration-300';
                stepEl.classList.add('completed');
            } else {
                // Future step - disabled
                circle.className = 'w-10 h-10 rounded-full bg-surface-2 flex items-center justify-center text-text-disabled font-semibold text-sm transition-all duration-300';
                circle.innerHTML = stepNum;
                label.className = 'editor-import-step-label text-xs font-medium text-text-disabled transition-colors duration-300';
                stepEl.classList.remove('completed');
            }

            // Clickable completed steps
            stepEl.onclick = stepNum < this.currentStep ? () => this.goToStep(stepNum) : null;
            stepEl.style.cursor = stepNum < this.currentStep ? 'pointer' : 'default';
        });
    }

    updateNavigationButtons() {
        const prevBtn = document.querySelector('[data-role="import-prev"]');
        const nextBtn = document.querySelector('[data-role="import-next"]');
        if (!prevBtn || !nextBtn) return;
        if (this.modalPurpose === 'theory_analysis') {
            return;
        }

        if (this.hasActiveWorkspaceImportFlow()) {
            prevBtn.disabled = false;
            const executeReady = !!this.getWorkspaceImportExecutePayload()?.ok;
            prevBtn.textContent = this.currentStep > 3 && !executeReady ? wt('im.k092', 'Назад') : wt('im.k093', 'Закрыть');
            const preview = this.getWorkspaceImportPreviewPayload();
            const previewReady = !!preview;
            const loadingPreview = this.workspaceImportState?.loadingPreview === true;
            const executing = this.workspaceImportState?.executing === true || this.importInProgress;
            if (this.currentStep >= 4) {
                if (executeReady) {
                    nextBtn.textContent = wt('im.k094', 'Открыть copy');
                    nextBtn.disabled = false;
                } else {
                    nextBtn.textContent = executing ? wt('im.k095', 'Добавление...') : wt('im.k096', 'Добавить в workspace');
                    nextBtn.disabled = !previewReady || loadingPreview || executing;
                }
            } else {
                nextBtn.textContent = wt('im.k097', 'К подтверждению');
                nextBtn.disabled = !previewReady || loadingPreview;
            }
            return;
        }

        // Prev button
        prevBtn.disabled = this.currentStep === 1;
        prevBtn.textContent = wt('im.k098', 'Назад');

        const limits = this.parsedResult?.workspace_limits;
        let limitExceeded = false;
        if (limits && limits.plan !== 'premium') {
            const remainingTasks = limits.tasks?.remaining_personal ?? 0;
            const importableTasksCount = this.getPreviewImportableTasks().length;
            if (importableTasksCount > remainingTasks) {
                limitExceeded = true;
            }
        }

        const nothingToImport = this.currentStep === 4 && this.getPreviewImportableTasks().length === 0;

        // Next button label
        if (this.currentStep === 4) {
            nextBtn.textContent = this.importInProgress ? wt('im.k099', 'Импорт...') : wt('im.k100', 'Импортировать');
        } else if (this.importMode === 'ai') {
            if (this.currentStep === 1) nextBtn.textContent = wt('im.k101', 'К промптам');
            else if (this.currentStep === 2) nextBtn.textContent = this.aiTemplateType === 'material_analysis' ? wt('im.k561', 'Разобрать анализ') : wt('im.k562', 'Проверить текст');
            else if (this.currentStep === 3) nextBtn.textContent = wt('im.k102', 'К импорту');
            else nextBtn.textContent = wt('im.k103', 'Далее');
        } else {
            nextBtn.textContent = wt('im.k104', 'Далее');
        }

        if (this.currentStep === 4 && nothingToImport && !this.importInProgress) {
            nextBtn.textContent = wt('im.k105', 'Нечего импортировать');
        } else if (limitExceeded && !this.importInProgress) {
            nextBtn.textContent = wt('im.limit_exceeded_btn', 'Превышен лимит');
        }

        // Disable next during AI processing or if limits are exceeded
        nextBtn.disabled = this.aiAnalyzing || this.aiGenerating || this.importInProgress || nothingToImport || limitExceeded;
    }

    // =========================================================================
    // Step Rendering
    // =========================================================================

    renderCurrentStep() {
        if (this.modalPurpose === 'theory_analysis') {
            this.renderTheoryAnalysisMode();
            return;
        }
        const contentArea = document.querySelector('[data-role="import-content"]');
        if (!contentArea) return;

        // Add fade-out class for smooth transition
        contentArea.classList.add('step-transitioning-out');

        // Wait for fade-out, then update content and fade-in
        setTimeout(() => {
            switch (this.currentStep) {
                case 1:
                    contentArea.innerHTML = this.renderStep1();
                    break;
                case 2:
                    contentArea.innerHTML = this.renderStep2();
                    break;
                case 3:
                    contentArea.innerHTML = this.renderStep3();
                    break;
                case 4:
                    contentArea.innerHTML = this.renderStep4();
                    break;
            }

            // Remove fade-out and add fade-in
            contentArea.classList.remove('step-transitioning-out');
            contentArea.classList.add('step-transitioning-in');

            // Clean up animation class after completion
            setTimeout(() => {
                contentArea.classList.remove('step-transitioning-in');
            }, 300);

            this.attachStepEventListeners();

            // Apply preset selection for step 1 after DOM is ready
            if (this.currentStep === 1) {
                this.applyPresetSelection();
            }
        }, 150);
    }

    setImportMode(mode) {
        this.importMode = mode;
        if (mode === 'ai' && this.aiTemplateType === 'material_analysis') {
            this.aiTemplateType = 'open_answer';
        }
        // Check AI availability when switching to AI mode
        if (mode === 'ai' && !this.aiStatus) {
            this.aiCheckStatus().then(() => this.renderCurrentStep());
        }
        this.renderCurrentStep();
    }

    showToast(message, type = 'info', timeout = 3500) {
        const normalizeType = () => {
            const key = String(type || '').trim().toLowerCase();
            if (key === 'blocking') return 'error';
            if (key === 'success' || key === 'warning' || key === 'error' || key === 'info') return key;
            if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.resolveVariant === 'function') {
                return NotificationUI.resolveVariant(key);
            }
            return 'info';
        };
        const resolvedType = normalizeType();

        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, resolvedType, timeout);
            return;
        }

        const colors = {
            success: 'bg-success text-white',
            error: 'bg-error text-white',
            warning: 'bg-warning text-warning-dark',
            info: 'bg-info text-white',
        };
        const toast = document.createElement('div');
        toast.className = `fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] px-5 py-3 rounded-xl shadow-lg text-sm font-medium ${colors[resolvedType] || colors.info} transition-all opacity-0 translate-y-2`;
        toast.textContent = message;
        document.body.appendChild(toast);
        requestAnimationFrame(() => {
            toast.style.transition = 'opacity 200ms, transform 200ms';
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
        });
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(8px)';
            setTimeout(() => toast.remove(), 250);
        }, timeout);
    }

    showVoiceToast({ severity = 'info', what = '', impact = '', next = '', timeout = 4200 } = {}) {
        let message = '';
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.voiceMessage === 'function') {
            message = NotificationUI.voiceMessage({ what, impact, next });
        } else {
            message = [what, impact, next].filter(Boolean).join(' ');
        }
        if (!message) return;
        this.showToast(message, severity, timeout);
    }

    async confirmAction({
        title = wt('im.k106', 'Подтверждение'),
        message = wt('im.k107', 'Вы уверены?'),
        confirmText = wt('im.k108', 'Подтвердить'),
        cancelText = wt('im.k109', 'Отмена'),
        variant = 'error',
    } = {}) {
        // Поскольку import-modal открывается как native dialog через showModal,
        // кастомный NotificationUI.confirm (добавляемый в document.body) становится inert (некликбельным).
        // Поэтому для надежности используем нативный window.confirm.
        return window.confirm(message);
    }

    getImportModalCloseGuardState() {
        if (this.modalPurpose === 'theory_analysis') {
            const hasMeaningfulState = !!(
                String(this.materialText || '').trim()
                || this.aiUploadedFile
                || this.aiAnalyzing
                || this.aiGenerating
                || this.generationResult
                || this.analysisResult
            );
            return {
                hasMeaningfulState,
                hasImportedProgress: false,
                importedRecommendationTypes: 0,
                draftRecommendationTypes: 0,
                isTheoryAnalysis: true
            };
        }

        const session = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        const recommendationState = (session?.recommendation_state && typeof session.recommendation_state === 'object')
            ? session.recommendation_state
            : {};
        const importedRecommendationTypes = Object.values(recommendationState).filter((state) => {
            const importedCount = Math.max(0, Number(state?.imported_count || 0));
            const status = String(state?.status || '').trim().toLowerCase();
            return importedCount > 0 || status === 'manual_done';
        }).length;
        const draftRecommendationTypes = Object.values(recommendationState).filter((state) => {
            return !!String(state?.draft_source_text || '').trim() || !!state?.draft_parsed_result;
        }).length;
        const hasMeaningfulState = !!(
            String(this.sourceText || '').trim()
            || this.parsedResult
            || this.uploadedFile
            || this.checkResult
            || this.archiveCacheId
            || this.perTaskConflictRes.size > 0
            || this.excludedTasks.size > 0
            || this.selectedTasks.size > 0
            || this.currentStep > 1
            || this.importMode !== 'text'
            || session
            || this.manualAnalysisResult
        );

        return {
            hasMeaningfulState,
            hasImportedProgress: importedRecommendationTypes > 0,
            importedRecommendationTypes,
            draftRecommendationTypes,
            isTheoryAnalysis: false
        };
    }

    async confirmImportModalCloseIfNeeded() {
        const guard = this.getImportModalCloseGuardState();
        if (!guard.hasMeaningfulState) return true;

        if (guard.isTheoryAnalysis) {
            return await this.confirmAction({
                title: wt('im.k285', 'Закрыть анализ теории?'),
                message: wt('im.k286', 'Окно анализа будет закрыто. Несохранённые результаты анализа и генерации задач будут потеряны.'),
                confirmText: wt('im.k112', 'Закрыть и сбросить'),
                cancelText: wt('im.k113', 'Продолжить работу'),
                variant: 'warning',
            });
        }

        const title = guard.hasImportedProgress
            ? wt('im.k110', 'Закрыть импорт и сбросить локальные данные?')
            : wt('im.k111', 'Сбросить данные импорта?');
        const message = guard.hasImportedProgress
            ? `${wt('im.k650', 'Окно импорта будет закрыто. Черновики, карта покрытия и промежуточные данные будут сброшены. Уже импортированные задания останутся в библиотеке. Импортировано типов:')} ${guard.importedRecommendationTypes}.`
            : `${wt('im.k651', 'Окно импорта будет закрыто. Все промежуточные данные будут удалены: введённый текст, результаты парсинга и черновики')}${guard.draftRecommendationTypes > 0 ? ` (${guard.draftRecommendationTypes})` : ''}.`;
        return await this.confirmAction({
            title,
            message,
            confirmText: wt('im.k112', 'Закрыть и сбросить'),
            cancelText: wt('im.k113', 'Продолжить работу'),
            variant: 'warning',
        });
    }

    async discardImportArchiveCache() {
        const cacheId = String(this.archiveCacheId || '').trim();
        if (!cacheId) return false;
        try {
            const response = await fetch('/api/editor/import/discard-cache', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cache_id: cacheId }),
            });
            if (!response.ok) return false;
            const data = await response.json().catch(() => ({}));
            return data?.ok === true;
        } catch (error) {
            console.warn('[ImportManager] Failed to discard archive cache:', error);
            return false;
        }
    }

    async resetImportModalState() {
        await this.discardImportArchiveCache();
        this.setModalPurpose('import');
        this.currentStep = 1;
        this.selectedModule = null;
        this.selectedTopic = null;
        this.selectedModuleName = '';
        this.selectedTopicName = '';
        this.sourceText = '';
        this.manualAnalysisResult = null;
        this.parsedResult = null;
        this.excludedTasks.clear();
        this.selectedTasks.clear();
        this.importMode = 'text';
        this.uploadedFile = null;
        this.checkResult = null;
        this.archiveCacheId = null;
        this.perTaskConflictRes.clear();
        this.resetWorkspaceImportState();
        this.aiTemplateType = 'open_answer';
        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
        this.materialText = '';
        this.aiUploadedFile = null;
        this.aiFileInfo = null;
        this.analysisResult = null;
        this.generationResult = null;
        this.aiProvider = null;
        this.aiProviderModel = null;
        this.aiRunId = null;
        this.aiSelectedRecs.clear();
        this.aiGenerating = false;
        this.aiAnalyzing = false;
        this.importRequestKey = null;
        this.theoryOpeningRunId = null;
    }

    _makeIdempotencyKey() {
        if (window.crypto?.randomUUID) {
            return `import-${window.crypto.randomUUID()}`;
        }
        return `import-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }

    loadImportHistory() {
        try {
            const raw = localStorage.getItem(this.importHistoryStorageKey);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    saveImportHistory(items = []) {
        try {
            localStorage.setItem(this.importHistoryStorageKey, JSON.stringify(items));
        } catch (e) {
            // Ignore storage errors for non-critical import history.
        }
    }

    recordImportHistory(entry = {}) {
        const history = this.loadImportHistory();
        const nextEntry = {
            timestamp: Date.now(),
            mode: this.importMode || 'text',
            module: this.selectedModuleName || this.selectedModule || '',
            topic: this.selectedTopicName || this.selectedTopic || '',
            module_id: this.selectedModule || '',
            topic_id: this.selectedTopic || '',
            status: entry.status || 'unknown',
            imported: Number(entry.imported || 0),
            skipped: Number(entry.skipped || 0),
            errors: Number(entry.errors || 0),
            message: String(entry.message || ''),
        };
        history.unshift(nextEntry);
        this.saveImportHistory(history.slice(0, 8));
    }

    renderImportHistoryCompact() {
        const items = this.loadImportHistory();
        if (!items.length) {
            return `
                <div class="mt-6 rounded-xl border border-border-subtle bg-surface-1 p-3">
                    <div class="text-xs font-semibold text-text-secondary mb-1">${wt('im.k842', 'Последние импорты')}</div>
                    <div class="editor-import-history-summary text-[11px]">${wt('im.k843', 'История пока пуста.')}</div>
                </div>
            `;
        }

        const rows = items.slice(0, 4).map((item) => {
            const date = new Date(item.timestamp || Date.now());
            const dateText = Number.isNaN(date.getTime())
                ? wt('im.k114', 'недавно')
                : `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const status = String(item.status || 'unknown');
            const tone = status === 'ok'
                ? 'text-success-text'
                : (status === 'error' ? 'text-error-text' : 'text-warning-text');
            const location = [item.module, item.topic].filter(Boolean).join(' / ');
            const summary = `+${Number(item.imported || 0)} | skip ${Number(item.skipped || 0)} | err ${Number(item.errors || 0)}`;
            return `
                <div class="rounded-lg border border-border-subtle bg-surface-2 px-2.5 py-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-[11px] font-semibold ${tone}">${this.escapeHtml(status === 'ok' ? wt('im.k844', 'Успешно') : status === 'error' ? wt('im.k845', 'Ошибка') : wt('im.k846', 'Частично'))}</div>
                        <div class="editor-import-history-meta text-[10px]" title="${this.escapeHtmlAttr(dateText)}">${this.escapeHtml(dateText)}</div>
                    </div>
                    <div class="editor-import-history-title text-[11px] mt-1">${this.escapeHtml(location || wt('im.k847', 'Без привязки'))}</div>
                    <div class="editor-import-history-summary text-[10px] mt-0.5">${this.escapeHtml(summary)}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="mt-6 rounded-xl border border-border-subtle bg-surface-1 p-3 space-y-2">
                <div class="text-xs font-semibold text-text-secondary">${wt('im.k842', 'Последние импорты')}</div>
                ${rows}
            </div>
        `;
    }

    renderModuleOptions(modules, placeholderLabel = wt('im.k115', 'Выберите модуль...')) {
        const options = [
            `<option value="">${this.escapeHtml(placeholderLabel)}</option>`,
        ];
        (Array.isArray(modules) ? modules : []).forEach((module) => {
            const value = this.escapeHtmlAttr(String(module?.id || ''));
            const label = this.escapeHtml(String(module?.name || module?.id || ''));
            options.push(`<option value="${value}">${label}</option>`);
        });
        return options.join('');
    }

    renderStep1() {
        // Get modules from dashboard catalog
        const modules = this.dashboard.catalog || [];

        return `
            <div class="max-w-3xl mx-auto animate-slide-up-fade">
                <h3 class="text-lg font-bold text-text-main mb-6">${wt('im.k652', 'Выберите режим импорта')}</h3>
                
                <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
                    <button data-role="import-mode-text" onclick="dashboard.importManager.setImportMode('text')" 
                        class="editor-flow-wrap p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'text' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'text' ? 'text-primary' : 'text-text-disabled'}">description</span>
                            <span class="font-bold text-text-main">${wt('im.k848', 'Из текста')}</span>
                        </div>
                        <p class="text-xs text-text-secondary">${wt('im.k849', 'Вставка текста с разметкой (@OPEN_ANSWER, @SEQUENCE...)')}</p>
                    </button>
                    
                    <button data-role="import-mode-archive" onclick="dashboard.importManager.setImportMode('archive')" 
                        class="editor-flow-wrap p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'archive' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'archive' ? 'text-primary' : 'text-text-disabled'}">folder_zip</span>
                            <span class="font-bold text-text-main">${wt('im.k850', 'Из архива')}</span>
                        </div>
                        <p class="text-xs text-text-secondary">${wt('im.k851', 'Загрузка ZIP-архива с заданиями (с картинками)')}</p>
                    </button>

                    <button data-role="import-mode-ai" onclick="dashboard.importManager.setImportMode('ai')" 
                        class="editor-flow-wrap p-4 rounded-xl border-2 transition-all text-left ${this.importMode === 'ai' ? 'border-primary bg-primary-lighter ring-2 ring-primary-light' : 'border-border-subtle hover:border-border-strong'}">
                        <div class="flex items-center gap-3 mb-2">
                            <span class="material-symbols-outlined text-2xl ${this.importMode === 'ai' ? 'text-primary' : 'text-text-disabled'}">auto_awesome</span>
                            <span class="font-bold text-text-main">${wt('im.k852', 'ИИ-генерация')}</span>
                        </div>
                        <p class="text-xs text-text-secondary">${wt('im.k853', 'Промпты для самостоятельной работы с внешней нейросетью и последующего импорта результата')}</p>
                    </button>
                </div>

                ${this.renderImportHistoryCompact()}
                
                ${this.importMode === 'text' ? this.renderStep1Text(modules) : ''}
                ${this.importMode === 'archive' ? this.renderStep1Archive(modules) : ''}
                ${this.importMode === 'ai' ? this.renderStep1AI(modules) : ''}
            </div>
        `;
    }

    renderStep1Text(modules) {
        return `
            <div class="space-y-4 animate-fade-in">
                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k854', 'Целевой модуль')}</label>
                    <select id="import-module-select"
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                        ${this.renderModuleOptions(modules, wt('im.k653', 'Выберите модуль...'))}
                    </select>
                </div>
                
                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k855', 'Целевая тема')}</label>
                    <select id="import-topic-select"
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                        disabled>
                        <option value="">${wt('im.k856', 'Сначала выберите модуль...')}</option>
                    </select>
                </div>

            </div>
        `;
    }

    renderStep1Archive(modules) {
        return `
            <div class="space-y-4 animate-fade-in">
                <div class="p-4 bg-warning-lighter text-warning-text rounded-lg text-sm border border-warning-light">
                    <div class="font-bold mb-1">${wt('im.k857', 'Как это работает:')}</div>
                    <ul class="list-disc list-inside space-y-1 ml-1 text-xs">
                        <li>${wt('im.k858', 'Задания будут распакованы из ZIP-архива')}</li>
                        <li>${wt('im.k859', 'Картинки будут сохранены автоматически')}</li>
                        <li>${wt('im.k860', 'Если модули/темы не выбраны, они будут созданы из структуры архива')}</li>
                    </ul>
                </div>

                 <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k861', 'Файл архива (.zip)')}</label>
                    <div id="import-drop-zone" class="border-2 border-dashed border-border-subtle rounded-lg p-8 text-center bg-surface-2 hover:bg-bg-hover hover:border-primary transition-colors cursor-pointer relative">
                        <input type="file" id="import-file-input" accept=".zip" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                        <div class="pointer-events-none">
                            <span class="material-symbols-outlined text-4xl text-text-disabled mb-2">cloud_upload</span>
                            <p class="text-sm font-medium text-text-secondary" id="file-name-display">${wt('im.k862', 'Перетащите файл сюда или кликните')}</p>
                            <p class="text-xs text-text-disabled mt-1">${wt('im.k863', 'Максимальный размер: 200MB')}</p>
                        </div>
                    </div>
                </div>

                <div class="pt-4 border-t border-border-subtle">
                   <div class="flex items-center justify-between mb-2 cursor-pointer" onclick="document.getElementById('advanced-options').classList.toggle('hidden')">
                       <span class="text-sm font-semibold text-text-secondary">${wt('im.k864', 'Дополнительно (Target Override)')}</span>
                       <span class="material-symbols-outlined text-text-disabled">expand_more</span>
                   </div>
                   <div id="advanced-options" class="hidden space-y-4">
                       <div>
                            <label class="block text-sm font-medium text-text-secondary mb-1">${wt('im.k865', 'Переопределить модуль (опционально)')}</label>
                            <select id="import-module-select" 
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2 text-text-main sm:text-xs">
                                ${this.renderModuleOptions(modules, wt('im.k654', 'Не переопределять (из архива)'))}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-medium text-text-secondary mb-1">${wt('im.k866', 'Переопределить тему (опционально)')}</label>
                            <select id="import-topic-select" 
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2 text-text-main sm:text-xs" disabled>
                                <option value="">${wt('im.k867', 'Не переопределять')}</option>
                            </select>
                        </div>
                   </div>
                </div>
            </div>
        `;
    }
    renderStep2() {
        if (this.importMode === 'ai' && !this.isInternalAiGenerationInDevelopment()) {
            return this.renderStep2AI();
        }

        if (this.importMode === 'archive') {
            // Step 2 for Archive is "Validating..." (Spinner)
            return `
               <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                   <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                   <h3 class="text-lg font-bold text-text-main">${wt('im.k655', 'Проверка архива...')}</h3>
                   <p class="text-text-secondary text-sm mt-2">${wt('im.k868', 'Анализ структуры и поиск конфликтов')}</p>
               </div>
            `;
        }

        const hasErrors = this.parsedResult?.parsing_errors?.length > 0;
        const errorsList = this.parsedResult?.parsing_errors || [];
        const templateOptions = this.modalPurpose === 'theory_analysis'
            ? this.getAIAgentTemplateOptions()
            : this.getDirectAIAgentTemplateOptions();
        const activeTemplate = this.getActiveAIAgentTemplateConfig();
        const isAiPromptMode = this.importMode === 'ai';
        const isMaterialAnalysisMode = isAiPromptMode && this.aiTemplateType === 'material_analysis';
        const manualAnalysisPreview = isAiPromptMode ? this.renderManualAnalysisPreviewCard() : '';
        const manualAnalysisPromptContext = isAiPromptMode ? this.renderManualAnalysisPromptContextCard() : '';
        const stepTitle = isAiPromptMode ? wt('im.k116', 'Скопируйте промпт и вставьте ответ внешнего ИИ') : wt('im.k117', 'Вставьте текст с заданиями');
        const stepDescription = isAiPromptMode
            ? wt('im.k118', 'Сгенерируйте задания во внешней нейросети, затем вставьте результат сюда для проверки и импорта.')
            : wt('im.k119', 'Вставьте текст, содержащий задания в формате парсера');
        const showStepIntro = this.modalPurpose !== 'theory_analysis';
        const showTemplateSelector = this.modalPurpose !== 'theory_analysis';
        const fixedTheoryTemplateLabel = isMaterialAnalysisMode
            ? wt('im.k120', 'Анализ материала')
            : this.getEditorFacingTaskTypeLabel(this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType) || activeTemplate.taskType || activeTemplate.title);

        return `
            <div class="max-w-3xl mx-auto animate-slide-up-fade">
                ${showStepIntro ? `
                    <h3 class="text-lg font-bold text-text-main mb-2">${stepTitle}</h3>
                    <p class="text-sm text-text-secondary mb-6">${stepDescription}</p>
                ` : ''}

                <div class="mb-4 p-4 bg-surface-2 border border-border-subtle rounded-lg">
                    <div class="flex items-start justify-between gap-3 mb-3">
                        <div>
                            <h4 class="text-sm font-bold text-text-main">${wt('im.k869', 'Шаблон промпта для ИИ-агента')}</h4>
                            <p class="text-xs text-text-secondary mt-1">${wt('im.k870', 'Скопируйте шаблон, передайте его ИИ-агенту и вставьте результат ниже.')}</p>
                        </div>
                        <button id="ai-agent-copy-prompt-btn"
                            class="px-3 py-1.5 text-xs font-semibold text-primary border border-primary rounded hover:bg-primary hover:text-primary-fg transition-colors">
                            ${wt('im.k121', 'Скопировать промпт')}
                        </button>
                    </div>
                    ${showTemplateSelector ? `
                        <div class="mb-3">
                            <label for="ai-agent-template-type" class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k871', 'Тип задания')}</label>
                            <select id="ai-agent-template-type"
                                class="block w-full rounded-lg border-border-subtle bg-surface-1 py-2 px-3 text-sm text-text-main focus:ring-2 focus:ring-primary">
                                ${Object.entries(templateOptions).map(([key, value]) => `
                                    <option value="${key}" ${this.aiTemplateType === key ? 'selected' : ''}>${this.escapeHtml(value.title)}</option>
                                `).join('')}
                            </select>
                        </div>
                    ` : `
                        <div class="mb-3">
                            <div class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k872', 'Режим')}</div>
                            <div class="rounded-lg border border-border-subtle bg-surface-1 py-2 px-3 text-sm font-medium text-text-main">
                                ${this.escapeHtml(fixedTheoryTemplateLabel)}
                            </div>
                        </div>
                    `}
                    <div id="ai-agent-instructions" class="mb-3 p-3 bg-surface-2 border border-info-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-info text-[18px] mt-0.5">lightbulb</span>
                            <div class="text-xs text-text-secondary whitespace-pre-line">${this.escapeHtml(activeTemplate.instructions)}</div>
                        </div>
                    </div>
                    <textarea id="ai-agent-prompt-textarea" rows="12" readonly
                        class="block w-full rounded-lg border-border-subtle bg-surface-1 p-3 text-xs text-text-main font-mono">${this.escapeHtml(activeTemplate.prompt)}</textarea>
                </div>

                ${manualAnalysisPromptContext}

                ${hasErrors ? `
                    <div class="mb-4 p-4 bg-error-lighter border border-error-light rounded-lg">
                        <div class="flex items-start gap-2 mb-2">
                            <span class="material-symbols-outlined text-error text-[20px]">error</span>
                            <div class="flex-1">
                                <h4 class="font-bold text-error-text mb-1">${wt('im.k656', 'Обнаружены ошибки парсинга')}</h4>
                                <p class="text-sm text-error-text">${wt('im.k873', 'Исправьте ошибки ниже и повторите попытку')}</p>
                            </div>
                        </div>
                        <div class="mt-3 space-y-1 max-h-32 overflow-y-auto">
                            ${errorsList.map(err => `
                                <div class="text-sm text-error-text font-mono bg-surface-1 p-2 rounded border border-error-light">
                                    ${this.escapeHtml(err)}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}

                <div class="mb-2 flex justify-end">
                    <button id="import-paste-clipboard-btn"
                        class="px-3 py-1.5 text-xs font-semibold text-text-secondary border border-border-subtle rounded hover:bg-bg-hover transition-colors">
                        ${wt('im.k122', 'Вставить из буфера обмена')}
                    </button>
                </div>

                <textarea id="import-text-area" 
                    class="block w-full rounded-lg border-border-subtle bg-surface-2 p-4 text-text-main placeholder:text-text-disabled focus:ring-2 focus:ring-primary sm:text-sm font-mono ${hasErrors ? 'border-error focus:ring-error' : ''}"
                    rows="15"
                    placeholder="@OPEN_ANSWER&#10;# ${wt('im.k123', 'Опишите признаки пневмонии&#10;&#10;@SEQUENCE&#10;# Алгоритм диагностики&#10;element_1: Сбор анамнеза&#10;...&#10;&#10;@CLICK_TEXT&#10;# Выберите верные утверждения&#10;+ Верный вариант&#10;- Неверный вариант&#10;&#10;@TEST&#10;# Контрольные вопросы&#10;? Вопрос&#10;+ Верный ответ&#10;- Неверный ответ">')}${this.escapeHtml(this.sourceText)}</textarea>
                
                <div id="import-live-counter" class="mt-2 flex flex-wrap gap-2 text-xs min-h-[24px]"></div>
                
                <div class="mt-3 flex items-start gap-2 p-3 bg-surface-2 border border-info-light rounded-lg">
                    <span class="material-symbols-outlined text-info text-[20px]">info</span>
                    <div class="text-xs text-text-secondary">
                        <p class="font-medium mb-1">${wt('im.k874', 'Поддерживаемые форматы:')}</p>
                        <p>${wt('im.k875', '@OPEN_ANSWER - Открытый ответ')}</p>
                        <p>${wt('im.k876', '@SEQUENCE - Последовательность')}</p>
                        <p>${wt('im.k877', '@CLICK_TEXT - Клик/Ошибки (текстовый выбор)')}</p>
                        <p>${wt('im.k878', '@CLICK_WORDS - Клик/Ошибки (поиск ошибок в тексте)')}</p>
                        <p>${wt('im.k879', '@TEST - Тест (вопросы с вариантами ответов)')}</p>
                        <p class="mt-1 font-medium">${wt('im.k880', 'Поддерживается только подтип Клик/Ошибки (error_detection). Рисование и координатные click-задачи не поддерживаются.')}</p>
                    </div>
                </div>

                ${manualAnalysisPreview}
            </div>
        `;
    }

    getAIAgentTemplateKeyForTaskType(taskType) {
        const normalized = String(taskType || '').trim().toUpperCase();
        const mapping = {
            OPEN_ANSWER: 'open_answer',
            SEQUENCE: 'sequence_assembly',
            TEST: 'test',
            CLICK_TEXT: 'click_text',
            CLICK_WORDS: 'click_words',
        };
        return mapping[normalized] || null;
    }

    applyManualAnalysisRecommendation(taskType) {
        const normalizedTaskType = String(taskType || '').trim().toUpperCase();
        const templateKey = this.getAIAgentTemplateKeyForTaskType(normalizedTaskType);
        if (!templateKey) {
            this.showToast(wt('im.k124', 'Этот тип нельзя продолжить через текстовый импорт. Его нужно создавать вручную в редакторе.'), 'warning');
            return;
        }
        const existingDraft = this.getManualAnalysisDraft(normalizedTaskType);
        if (existingDraft) {
            this.openManualAnalysisDraft(normalizedTaskType);
            return;
        }

        this.setManualAnalysisSelectedTaskType(normalizedTaskType);
        this.aiTemplateType = templateKey;
        this.sourceText = '';
        this.parsedResult = null;
        const activeSession = this.getActiveManualAnalysisSession();
        if (activeSession?.analysis) {
            this.manualAnalysisResult = activeSession.analysis;
        }
        const templateSelect = document.getElementById('ai-agent-template-type');
        if (templateSelect) templateSelect.value = templateKey;
        const textArea = document.getElementById('import-text-area');
        if (textArea) textArea.value = '';
        this.updateAIAgentPromptTextarea();
        this._updateLiveCounter('');
        this.showToast(`${wt('im.k657', 'Шаблон переключён на')} ${this.getEditorFacingTaskTypeLabel(normalizedTaskType)}. ${wt('im.k658', 'Контекст анализа уже встроен в prompt.')}`, 'success');
        this.renderCurrentStep();
    }

    renderManualAnalysisPreviewCard() {
        const session = this.getActiveManualAnalysisSession();
        const analysis = (session?.analysis && typeof session.analysis === 'object')
            ? session.analysis
            : ((this.manualAnalysisResult && typeof this.manualAnalysisResult === 'object')
                ? this.manualAnalysisResult
                : null);
        if (!analysis?.ok) return '';

        const coverageMapCard = session ? this.renderManualAnalysisCoverageMapCard() : '';

        const units = Array.isArray(analysis.educational_units) ? analysis.educational_units : [];
        const recommendations = Array.isArray(analysis.recommendations) ? analysis.recommendations : [];
        const notRecommended = Array.isArray(analysis.not_recommended) ? analysis.not_recommended : [];
        const warnings = Array.isArray(analysis.warnings) ? analysis.warnings.filter(Boolean) : [];
        const unitMap = new Map(units.map((unit) => [Number(unit?.id), unit]));
        const recommendationState = (session?.recommendation_state && typeof session.recommendation_state === 'object')
            ? session.recommendation_state
            : {};
        const importedUnitIds = new Set();
        Object.values(recommendationState).forEach((state) => {
            const importedCount = Math.max(0, Number(state?.imported_count || 0));
            const status = String(state?.status || '').trim().toLowerCase();
            if (importedCount <= 0 && status !== 'manual_done') return;
            (Array.isArray(state?.covers_units) ? state.covers_units : []).forEach((id) => importedUnitIds.add(Number(id)));
        });
        const importedTypesCount = Object.values(recommendationState)
            .filter((state) => {
                const importedCount = Math.max(0, Number(state?.imported_count || 0));
                const status = String(state?.status || '').trim().toLowerCase();
                return importedCount > 0 || status === 'manual_done';
            })
            .length;
        const draftTypesCount = Object.values(recommendationState)
            .filter((state) => !!String(state?.draft_source_text || '').trim() || !!state?.draft_parsed_result)
            .length;

        return `
            <div class="mt-4 rounded-xl border border-border-subtle bg-surface-1 p-4 space-y-4">
                <div class="flex items-start justify-between gap-3">
                    <div>
                        <h4 class="text-sm font-bold text-text-main">${wt('im.k659', 'Разобранный анализ материала')}</h4>
                        <p class="text-xs text-text-secondary mt-1">${wt('im.k881', 'Теперь можно выбрать рекомендованный тип и перейти к генерации задач.')}</p>
                    </div>
                    <div class="flex flex-col items-end gap-2">
                        <div class="text-right text-xs text-text-secondary">
                            <div>${wt('im.k125', 'Единиц: <span class="font-bold text-text-main">')}${units.length}</span></div>
                            <div>${wt('im.k126', 'Рекомендаций: <span class="font-bold text-text-main">')}${recommendations.length}</span></div>
                        </div>
                        ${session ? `
                            <button
                                onclick="dashboard.importManager.archiveActiveManualAnalysisSession()"
                                class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                ${wt('im.k569', 'Сохранить в архив')}
                            </button>
                        ` : ''}
                    </div>
                </div>

                ${session ? `
                    <div class="rounded-lg border border-primary-light bg-surface-2 p-3 text-xs text-text-secondary">
                        <div class="flex flex-wrap items-center gap-3">
                            <span>${wt('im.k882', 'Сессия:')} <span class="font-semibold text-text-main">${this.escapeHtml(session.id)}</span></span>
                            <span>${wt('im.k883', 'Импортировано типов:')} <span class="font-semibold text-text-main">${importedTypesCount}</span></span>
                            <span>${wt('im.k884', 'Черновиков сохранено:')} <span class="font-semibold text-text-main">${draftTypesCount}</span></span>
                            <span>${wt('im.k885', 'Покрыто единиц импортом:')} <span class="font-semibold text-text-main">${importedUnitIds.size}/${units.length}</span></span>
                            ${session.selected_task_type ? `<span>${wt('im.k886', 'Текущий фокус:')} <span class="font-semibold text-text-main">${this.escapeHtml(this.getEditorFacingTaskTypeLabel(session.selected_task_type))}</span></span>` : ''}
                        </div>
                    </div>
                ` : ''}

                ${analysis.human_summary ? `
                    <div class="rounded-lg border border-border-subtle bg-surface-2 p-3 text-sm text-text-secondary leading-relaxed">
                        ${this.escapeHtml(analysis.human_summary)}
                    </div>
                ` : ''}

                ${warnings.length ? `
                    <div class="rounded-lg border border-warning-light bg-surface-2 p-3">
                        <div class="text-xs font-semibold text-text-main mb-1">${wt('im.k887', 'Предупреждения')}</div>
                        <div class="space-y-1 text-xs text-text-secondary">
                            ${warnings.map((warning) => `<p>${this.escapeHtml(String(warning))}</p>`).join('')}
                        </div>
                    </div>
                ` : ''}

                ${coverageMapCard}

                <div>
                    <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k888', 'Рекомендованные типы')}</div>
                    <div class="space-y-3">
                        ${recommendations.map((rec) => {
                            const taskType = String(rec?.task_type || '').trim().toUpperCase();
                            const templateKey = this.getAIAgentTemplateKeyForTaskType(taskType);
                            const manualOnly = rec?.manual_only === true || rec?.auto_generation_supported === false || !templateKey;
                            const editorLabel = String(rec?.editor_label || this.getEditorFacingTaskTypeLabel(taskType));
                            const coveredUnits = (Array.isArray(rec?.covers_units) ? rec.covers_units : [])
                                .map((unitId) => unitMap.get(Number(unitId)))
                                .filter(Boolean)
                                .map((unit) => `#${unit.id} ${unit.title}`);
                            const anchors = Array.isArray(rec?.assessable_anchors) ? rec.assessable_anchors.filter(Boolean) : [];
                            const designCandidates = Array.isArray(rec?.design_candidates) ? rec.design_candidates.filter(Boolean) : [];
                            const manualAuthoring = rec?.manual_authoring && typeof rec.manual_authoring === 'object'
                                ? rec.manual_authoring
                                : null;
                            const recState = recommendationState[taskType] || {};
                            const statusMeta = this.getManualAnalysisStatusMeta(
                                recState.status || (manualOnly ? 'manual_only' : rec?.recommendation_status || 'not_started')
                            );
                            const importedCount = Math.max(0, Number(recState?.imported_count || 0));
                            const draft = this.getManualAnalysisDraft(taskType);
                            const hasDraft = !!draft;
                            const draftCount = Math.max(0, Number(draft?.taskCount || 0));
                            const isCurrentFocus = session?.selected_task_type === taskType;
                            const draftIsOpen = hasDraft && isCurrentFocus && !!this.parsedResult && this.currentStep === 3;
                            const buttonLabel = manualOnly
                                ? wt('im.k127', 'Только вручную')
                                : (hasDraft
                                    ? (draftIsOpen ? wt('im.k128', 'Черновик открыт') : wt('im.k129', 'Открыть черновик'))
                                    : (isCurrentFocus ? wt('im.k556', 'Текущий тип') : (importedCount > 0 ? wt('im.k557', 'Сгенерировать ещё') : wt('im.k558', 'Выбрать этот тип'))));
                            const canReset = ['selected', 'draft_generated', 'manual_done', 'skipped'].includes(String(recState?.status || '').trim().toLowerCase());
                            const skipButtonLabel = String(recState?.status || '').trim().toLowerCase() === 'skipped' ? wt('im.k563', 'Вернуть в план') : wt('im.k564', 'Пропустить');
                            const primaryAction = hasDraft ? 'openManualAnalysisDraft' : 'applyManualAnalysisRecommendation';
                            return `
                                <div class="rounded-lg border border-border-subtle bg-surface-2 p-3">
                                    <div class="flex flex-wrap items-start justify-between gap-3">
                                        <div class="min-w-0 flex-1">
                                            <div class="flex flex-wrap items-center gap-2">
                                                <div class="text-sm font-bold text-text-main">${this.escapeHtml(editorLabel)}</div>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-1 text-text-main border border-primary-light">${this.escapeHtml(String(rec?.priority || 'medium'))}</span>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-1 text-text-secondary border border-border-subtle">${Number(rec?.count || 0)} ${wt('im.k889', 'шт.')}</span>
                                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${statusMeta.className}">${this.escapeHtml(statusMeta.label)}</span>
                                                ${importedCount > 0 ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-1 text-text-main border border-success-light">${wt('im.k890', 'импортов:')} ${importedCount}</span>` : ''}
                                                ${hasDraft ? `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-1 text-text-main border border-primary-light">черновик: ${draftCount || wt('im.k130', 'сохранён')}</span>` : ''}
                                            </div>
                                            ${rec?.coverage_role ? `<div class="mt-2 text-xs text-text-secondary">${this.escapeHtml(String(rec.coverage_role))}</div>` : ''}
                                            ${rec?.generation_focus ? `<div class="mt-2 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k891', 'Фокус генерации:')}</span> ${this.escapeHtml(String(rec.generation_focus))}</div>` : ''}
                                            ${coveredUnits.length ? `<div class="mt-2 text-[11px] text-text-secondary">${wt('im.k892', 'Покрывает:')} ${this.escapeHtml(coveredUnits.join('; '))}</div>` : ''}
                                            ${anchors.length ? `<div class="mt-2 text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k893', 'Опоры:')}</span> ${this.escapeHtml(anchors.join('; '))}</div>` : ''}
                                            ${rec?.count_rationale ? `<div class="mt-1 text-[11px] text-text-muted">${this.escapeHtml(String(rec.count_rationale))}</div>` : ''}
                                            ${draft?.savedAt ? `<div class="mt-1 text-[11px] text-text-muted">${wt('im.k894', 'Черновик сохранён:')} ${this.escapeHtml(new Date(draft.savedAt).toLocaleString())}</div>` : ''}
                                            ${designCandidates.length ? `
                                                <div class="mt-3">
                                                    <div class="text-[11px] font-semibold text-text-main mb-1">${wt('im.k895', 'Черновики заданий')}</div>
                                                    <div class="space-y-1">
                                                        ${designCandidates.map((item) => `
                                                            <div class="text-[11px] text-text-secondary bg-surface-1 border border-border-subtle rounded px-2 py-1">
                                                                ${this.escapeHtml(String(item))}
                                                            </div>
                                                        `).join('')}
                                                    </div>
                                                </div>
                                            ` : ''}
                                            ${manualAuthoring ? `
                                                <div class="mt-3 rounded-lg border border-warning-light bg-surface-1 p-2.5 space-y-1">
                                                    <div class="text-[11px] font-semibold text-text-main">${wt('im.k896', 'Визуальный blueprint')}</div>
                                                    ${Array.isArray(manualAuthoring.figure_refs) && manualAuthoring.figure_refs.length ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k897', 'Рисунки:')}</span> ${this.escapeHtml(manualAuthoring.figure_refs.join(', '))}</div>` : ''}
                                                    ${Array.isArray(manualAuthoring.target_objects) && manualAuthoring.target_objects.length ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k898', 'Что распознать:')}</span> ${this.escapeHtml(manualAuthoring.target_objects.join('; '))}</div>` : ''}
                                                    ${manualAuthoring.polygon_hint ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k899', 'Полигон:')}</span> ${this.escapeHtml(String(manualAuthoring.polygon_hint))}</div>` : ''}
                                                    ${manualAuthoring.task_stem_example ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k900', 'Пример формулировки:')}</span> ${this.escapeHtml(String(manualAuthoring.task_stem_example))}</div>` : ''}
                                                    ${manualAuthoring.text_anchor ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('im.k901', 'Текстовая привязка:')}</span> ${this.escapeHtml(String(manualAuthoring.text_anchor))}</div>` : ''}
                                                </div>
                                            ` : ''}
                                        </div>
                                        <div class="flex flex-col gap-2">
                                            <button
                                                onclick="dashboard.importManager.${primaryAction}('${this.escapeInlineJsString(taskType)}')"
                                                class="px-3 py-1.5 text-xs font-semibold rounded-lg ${manualOnly ? 'border border-border-subtle text-text-disabled cursor-not-allowed' : 'border border-primary text-primary hover:bg-primary hover:text-primary-fg'} transition-colors"
                                                ${manualOnly ? 'disabled' : ''}>
                                                ${buttonLabel}
                                            </button>
                                            ${manualOnly ? `
                                                <button
                                                    onclick="dashboard.importManager.setManualAnalysisRecommendationLifecycle('${this.escapeInlineJsString(taskType)}', '${String(recState?.status || '').trim().toLowerCase() === 'manual_done' ? 'reset' : 'manual_done'}')"
                                                    class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-success-light text-success-text hover:bg-success-lighter transition-colors">
                                                    ${String(recState?.status || '').trim().toLowerCase() === 'manual_done' ? wt('im.k660', 'Снять отметку') : wt('im.k661', 'Пометить как сделано вручную')}
                                                </button>
                                            ` : `
                                                <button
                                                    onclick="dashboard.importManager.setManualAnalysisRecommendationLifecycle('${this.escapeInlineJsString(taskType)}', '${String(recState?.status || '').trim().toLowerCase() === 'skipped' ? 'reset' : 'skipped'}')"
                                                    class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                                    ${skipButtonLabel}
                                                </button>
                                            `}
                                            ${canReset ? `
                                                <button
                                                    onclick="dashboard.importManager.setManualAnalysisRecommendationLifecycle('${this.escapeInlineJsString(taskType)}', 'reset')"
                                                    class="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border-subtle text-text-secondary hover:bg-bg-hover transition-colors">
                                                    ${wt('im.k131', 'Сбросить статус')}
                                                </button>
                                            ` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                ${notRecommended.length ? `
                    <div>
                        <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k902', 'Не рекомендуется')}</div>
                        <div class="space-y-2">
                            ${notRecommended.map((item) => `
                                <div class="rounded-lg border border-border-subtle bg-surface-2 p-3">
                                    <div class="text-sm font-semibold text-text-main">${this.escapeHtml(String(item?.editor_label || this.getEditorFacingTaskTypeLabel(String(item?.task_type || '').trim().toUpperCase()) || String(item?.task_type || wt('im.k903', 'Тип'))))}</div>
                                    <div class="mt-1 text-xs text-text-secondary">${this.escapeHtml(String(item?.reason || ''))}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderStep3() {
        if (this.importMode === 'ai' && !this.isInternalAiGenerationInDevelopment()) {
            return this.renderStep3AI();
        }
        if (this.hasActiveWorkspaceImportFlow()) {
            return this.renderWorkspaceImportPreviewStep();
        }
        if (this.importMode === 'archive') {
            return this.renderStep3Archive();
        }

        if (!this.parsedResult) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <p class="text-text-muted">${wt('im.k904', 'Парсинг заданий...')}</p>
                </div>
            `;
        }

        const summary = this.parsedResult.summary || {};
        const tasks = this.parsedResult.tasks || [];
        const selectedCount = this.selectedTasks.size;
        const notes = Array.isArray(this.parsedResult.notes)
            ? this.parsedResult.notes.filter(note => typeof note === 'string' && note.trim())
            : [];

        return `
            <div class="animate-slide-up-fade">
                <h3 class="text-lg font-bold text-text-main mb-4">${wt('im.k662', 'Просмотр распарсенных заданий')}</h3>

                ${notes.length ? `
                    <div class="mb-4 p-3 bg-info-lighter border border-info-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-info text-[18px]">info</span>
                            <div class="text-xs text-info-text space-y-1">
                                ${notes.map(note => `<p>${this.escapeHtml(note)}</p>`).join('')}
                            </div>
                        </div>
                    </div>
                ` : ''}
                
                <!-- Summary -->
                <div class="mb-6 p-4 bg-surface-2 rounded-lg">
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4">
                        <div class="text-center">
                            <div class="text-2xl font-bold text-text-main">${summary.total || 0}</div>
                            <div class="text-xs text-text-secondary">${wt('im.k905', 'Всего')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-success-text">${summary.valid || 0}</div>
                            <div class="text-xs text-text-secondary">✓ ${wt('im.k906', 'Готовы')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-warning-text">${summary.warnings || 0}</div>
                            <div class="text-xs text-text-secondary">⚠ ${wt('im.k887', 'Предупреждения')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-error-text">${summary.errors || 0}</div>
                            <div class="text-xs text-text-secondary">✗ ${wt('im.k845', 'Ошибки')}</div>
                        </div>
                    </div>
                </div>

                <!-- Settings Panel -->
                <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg shadow-sm">
                    <h4 class="text-sm font-bold text-text-main mb-3">${wt('im.k663', 'Настройки импорта')}</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k909', 'Если задание уже существует')}</label>
                            <select id="conflict-resolution-select" class="block w-full rounded border-border-normal text-sm py-1.5 focus:ring-primary">
                                <option value="skip">${wt('im.k910', 'Пропустить (по умолчанию)')}</option>
                                <option value="overwrite">${wt('im.k911', 'Перезаписать')}</option>
                                <option value="new_id">${wt('im.k912', 'Создать копию (новый ID)')}</option>
                            </select>
                        </div>
                        <div class="flex items-center">
                            <label class="flex items-center gap-2 cursor-pointer mt-4">
                                <input type="checkbox" id="skip-errors-checkbox" checked class="rounded text-primary focus:ring-primary w-4 h-4">
                                <span class="text-sm text-text-secondary">${wt('im.k913', 'Пропускать задания с ошибками')}</span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Bulk Actions -->
                <div class="mb-4 p-3 bg-primary-lighter border border-primary-light rounded-lg flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-3 min-w-0">
                        <label class="flex items-center gap-2 cursor-pointer">
                            <input 
                                type="checkbox" 
                                id="select-all-tasks"
                                onchange="dashboard.importManager.toggleSelectAll()"
                                class="w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary"
                                ${this.selectedTasks.size === tasks.length && tasks.length > 0 ? 'checked' : ''}>
                            <span class="text-sm font-medium text-text-secondary">${wt('im.k737', 'Выбрать все')}</span>
                        </label>
                        ${selectedCount > 0 ? `
                            <span class="text-xs text-text-muted px-2 py-1 bg-surface-1 rounded border border-border-subtle">
                                ${wt('im.k664', 'Выбрано:')} ${selectedCount}
                            </span>
                        ` : ''}
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <button 
                            onclick="dashboard.importManager.bulkExclude()"
                            class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            ${selectedCount === 0 ? 'disabled' : ''}>
                            ${wt('im.k132', 'Исключить выбранные')}
                        </button>
                        <button 
                            onclick="dashboard.importManager.bulkInclude()"
                            class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            ${selectedCount === 0 ? 'disabled' : ''}>
                            ${wt('im.k133', 'Включить выбранные')}
                        </button>
                    </div>
                </div>

                <!-- Tasks List -->
                <div class="space-y-3">
                    ${tasks.map((task, i) => this.renderTaskCard(task, i)).join('')}
                </div>
            </div>
        `;
    }

    resolveDisplayName(id, type, moduleId = null) {
        if (!id) return '';
        if (id === wt('im.k144', 'из архива') || id === wt('im.k145', 'из архива')) {
            return id;
        }
        
        if (this.dashboard && Array.isArray(this.dashboard.catalog)) {
            if (type === 'module') {
                const mod = this.dashboard.catalog.find(m => m.id === id);
                if (mod && mod.name) return mod.name;
            } else if (type === 'topic' && moduleId) {
                const mod = this.dashboard.catalog.find(m => m.id === moduleId);
                if (mod && Array.isArray(mod.topics)) {
                    const top = mod.topics.find(t => t.id === id);
                    if (top && top.name) return top.name;
                }
            }
        }

        if (this.parsedResult) {
            if (type === 'module' && this.parsedResult.module_names && this.parsedResult.module_names[id]) {
                return this.parsedResult.module_names[id];
            }
            if (type === 'topic' && moduleId && this.parsedResult.topic_names && this.parsedResult.topic_names[moduleId] && this.parsedResult.topic_names[moduleId][id]) {
                return this.parsedResult.topic_names[moduleId][id];
            }
        }
        
        if (type === 'module' && id === this.selectedModule && this.selectedModuleName) {
            return this.selectedModuleName;
        }
        if (type === 'topic' && id === this.selectedTopic && this.selectedTopicName) {
            return this.selectedTopicName;
        }
        
        if (id.includes('_') || id === id.toLowerCase()) {
            return id.replace(/_/g, ' ')
                     .split(' ')
                     .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                     .join(' ');
        }
        return id;
    }

    getArchiveTaskPreviewStatus(task = {}) {
        return String(task?.status || 'valid').trim().toLowerCase();
    }

    getPreviewImportableTasks() {
        const tasks = Array.isArray(this.parsedResult?.tasks) ? this.parsedResult.tasks : [];
        return tasks.filter((task, index) => this.getArchiveTaskPreviewStatus(task) !== 'error' && !this.excludedTasks.has(index));
    }

    getPreviewBlockedTaskCount() {
        const tasks = Array.isArray(this.parsedResult?.tasks) ? this.parsedResult.tasks : [];
        return tasks.filter((task) => this.getArchiveTaskPreviewStatus(task) === 'error').length;
    }

    getArchiveTaskPreviewStatusMeta(task = {}) {
        const status = this.getArchiveTaskPreviewStatus(task);
        if (status === 'error') {
            return {
                label: wt('im.k134', 'Ошибка'),
                badgeClass: 'border border-error-light bg-error-lighter text-error-text',
                cardClass: 'border-error-light bg-error-lighter',
                icon: 'error',
                hint: String(task.error || wt('im.k135', 'Архив содержит ошибку, задача не может быть импортирована.')),
            };
        }
        if (status === 'conflict') {
            if (String(task.conflict_type || '').trim().toLowerCase() === 'duplicate') {
                return {
                    label: wt('im.k136', 'Дубликат'),
                    badgeClass: 'border border-info-light bg-info-lighter text-info-text',
                    cardClass: 'border-info-light bg-info-lighter',
                    icon: 'content_copy',
                    hint: wt('im.k137', 'В библиотеке уже есть идентичное задание.'),
                };
            }
            return {
                label: wt('im.k138', 'Конфликт'),
                badgeClass: 'border border-warning-light bg-warning-lighter text-warning-text',
                cardClass: 'border-warning-light bg-warning-lighter',
                icon: 'warning',
                hint: wt('im.k139', 'Задание уже существует и отличается от версии в архиве.'),
            };
        }
        if (status === 'warning') {
            return {
                label: wt('im.k140', 'Предупреждение'),
                badgeClass: 'border border-warning-light bg-warning-lighter text-warning-text',
                cardClass: 'border-warning-light bg-warning-lighter',
                icon: 'warning',
                hint: wt('im.k141', 'Задание можно импортировать, но архив требует внимания.'),
            };
        }
        return {
            label: wt('im.k142', 'Готово'),
            badgeClass: 'border border-success-light bg-success-lighter text-success-darker',
            cardClass: 'border-success-light bg-success-lighter',
            icon: 'check_circle',
            hint: wt('im.k143', 'Задание можно импортировать без конфликта.'),
        };
    }

    renderArchivePreviewIssueList(items, emptyText, formatter, role = '') {
        const safeRole = role ? ` data-role="${this.escapeHtmlAttr(role)}"` : '';
        if (!Array.isArray(items) || items.length === 0) {
            return `<div${safeRole} class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-secondary">${this.escapeHtml(emptyText)}</div>`;
        }
        return `
            <div${safeRole} class="space-y-2">
                ${items.slice(0, 6).map((item) => `
                    <div class="rounded-xl border border-border-subtle bg-surface-2 px-3 py-2 text-sm text-text-main">
                        ${formatter(item)}
                    </div>
                `).join('')}
                ${items.length > 6 ? `<div class="text-xs text-text-secondary">${wt('im.k829', 'И ещё {n} элементов.').replace('{n}', items.length - 6)}</div>` : ''}
            </div>
        `;
    }

    renderArchiveTaskCard(task, index) {
        const meta = this.getArchiveTaskPreviewStatusMeta(task);
        const taskName = String(task.name || task.id || `${wt('im.k665', 'Задание')} ${index + 1}`);
        const taskId = String(task.id || '');
        const taskType = String(task.type || 'unknown');
        
        const rawModule = task.target_module || this.selectedModule || '';
        const targetModule = this.resolveDisplayName(rawModule, 'module') || wt('im.k144', 'из архива');
        
        const rawTopic = task.target_topic || this.selectedTopic || '';
        const targetTopic = this.resolveDisplayName(rawTopic, 'topic', rawModule) || wt('im.k145', 'из архива');

        const warnings = Array.isArray(task.warnings) ? task.warnings.filter(Boolean) : [];
        const diffKeys = Array.isArray(task.diff_keys) ? task.diff_keys.filter(Boolean) : [];
        const existingPath = String(task.existing_path || '').trim();
        const isSelected = this.selectedTasks.has(index);
        const isExcluded = this.excludedTasks.has(index);

        return `
            <div data-role="archive-import-task-card" class="rounded-xl border ${meta.cardClass} overflow-hidden transition-all hover:shadow-md ${isExcluded ? 'opacity-60' : ''}">
                <div class="p-4 border-b border-border-subtle">
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex items-start gap-3 min-w-0 flex-1">
                            <input
                                type="checkbox"
                                class="mt-1 w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary flex-shrink-0"
                                data-task-checkbox="${index}"
                                onchange="dashboard.importManager.toggleTaskSelection(${index})"
                                ${isSelected ? 'checked' : ''}>
                            <div class="min-w-0 flex-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="text-xs font-bold text-text-muted">#${index + 1}</span>
                                    <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border border-border-subtle bg-surface-1 text-text-secondary">${this.escapeHtml(taskType)}</span>
                                    ${isExcluded ? `<span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border border-border-subtle bg-surface-1 text-text-secondary">${wt('im.k914', 'исключено')}</span>` : ''}
                                </div>
                                <div class="mt-2 text-base font-bold text-text-main break-words">${this.escapeHtml(taskName)}</div>
                                <div class="text-[11px] font-mono text-text-secondary break-all mt-1">${this.escapeHtml(taskId)}</div>
                            </div>
                        </div>
                        <span class="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${meta.badgeClass}">
                            <span class="material-symbols-outlined text-[14px]">${meta.icon}</span>
                            <span>${this.escapeHtml(meta.label)}</span>
                        </span>
                    </div>
                    <p class="text-xs text-text-secondary mt-3">${this.escapeHtml(meta.hint)}</p>
                </div>

                <div class="p-4 bg-surface-1 space-y-3">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 min-w-0">
                            <div class="text-text-muted uppercase tracking-wide">${wt('im.k768', 'Модуль')}</div>
                            <div class="mt-1 font-semibold text-text-main break-words">${this.escapeHtml(targetModule)}</div>
                        </div>
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 min-w-0">
                            <div class="text-text-muted uppercase tracking-wide">${wt('im.k769', 'Тема')}</div>
                            <div class="mt-1 font-semibold text-text-main break-words">${this.escapeHtml(targetTopic)}</div>
                        </div>
                    </div>

                    ${existingPath ? `
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-xs">
                            <div class="text-text-muted uppercase tracking-wide">${wt('im.k917', 'Текущий путь')}</div>
                            <div class="mt-1 font-mono text-text-main break-all">${this.escapeHtml(existingPath)}</div>
                        </div>
                    ` : ''}

                    ${diffKeys.length ? `
                        <div class="rounded-lg border border-warning-light bg-warning-lighter px-3 py-2 text-xs text-warning-text">
                            <div class="font-semibold">${wt('im.k918', 'Изменённые ключи')}</div>
                            <div class="mt-1 break-words">${this.escapeHtml(diffKeys.join(', '))}</div>
                        </div>
                    ` : ''}

                    ${warnings.length ? `
                        <div class="rounded-lg border border-warning-light bg-warning-lighter px-3 py-2 text-xs text-warning-text">
                            <div class="font-semibold">${wt('im.k887', 'Предупреждения')}</div>
                            <div class="mt-1 space-y-1">
                                ${warnings.slice(0, 3).map((warning) => `<div>${this.escapeHtml(warning)}</div>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${task.status === 'error' && task.error ? `
                        <div class="rounded-lg border border-error-light bg-error-lighter px-3 py-2 text-xs text-error-text">
                            <div class="font-semibold">${wt('im.k845', 'Ошибка')}</div>
                            <div class="mt-1 break-words">${this.escapeHtml(task.error)}</div>
                        </div>
                    ` : ''}
                </div>

                ${task.status === 'conflict' ? `
                    <div class="px-4 py-3 border-t border-border-subtle bg-warning-lighter">
                        <label class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k919', 'Действие при конфликте:')}</label>
                        <select
                            onchange="dashboard.importManager.setPerTaskConflict(${index}, this.value)"
                            class="block w-full rounded border-border-normal text-xs py-1.5 focus:ring-primary bg-surface-1">
                            <option value="" ${!this.perTaskConflictRes.has(index) ? 'selected' : ''}>${wt('im.k920', 'Как в общих настройках')}</option>
                            <option value="skip" ${this.perTaskConflictRes.get(index) === 'skip' ? 'selected' : ''}>${wt('im.k921', 'Пропустить')}</option>
                            <option value="overwrite" ${this.perTaskConflictRes.get(index) === 'overwrite' ? 'selected' : ''}>${wt('im.k911', 'Перезаписать')}</option>
                            <option value="new_id" ${this.perTaskConflictRes.get(index) === 'new_id' ? 'selected' : ''}>${wt('im.k912', 'Создать копию (новый ID)')}</option>
                        </select>
                    </div>
                ` : ''}

                <div class="p-3 bg-surface-1 border-t border-border-subtle flex gap-2">
                    <button
                        onclick="dashboard.importManager.toggleExclude(${index})"
                        class="flex-1 px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-hover hover:text-text-main rounded transition-colors border border-border-subtle"
                        data-task-exclude-btn="${index}">
                        ${isExcluded ? wt('im.k666', 'Включить') : wt('im.k667', 'Исключить')}
                    </button>
                </div>
            </div>
        `;
    }

    renderLimitWarningHtml() {
        const limits = this.parsedResult?.workspace_limits;
        if (!limits || limits.plan === 'premium') return '';

        const remainingTasks = limits.tasks?.remaining_personal ?? 0;
        const importableTasksCount = this.getPreviewImportableTasks().length;

        if (importableTasksCount > remainingTasks) {
            return `
                <div class="rounded-xl border border-error-light bg-error-lighter px-4 py-3 text-sm text-error-text animate-slide-up-fade">
                    <div class="font-semibold">${wt('im.limit_exceeded_title', 'Недостаточно свободных слотов для импорта')}</div>
                    <div class="mt-1">
                        ${wt('im.limit_exceeded_desc', 'Свободно слотов: {remaining}, требуется: {required}. Освободите место или исключите лишние задания из импорта.')
                            .replace('{remaining}', remainingTasks)
                            .replace('{required}', importableTasksCount)}
                    </div>
                </div>
            `;
        }
        return '';
    }

    renderStep3Archive() {
        if (!this.parsedResult) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="Loading" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <p class="text-text-muted">${wt('im.k922', 'Проверка архива...')}</p>
                </div>
            `;
        }

        const summary = this.parsedResult.summary || {};
        const tasks = Array.isArray(this.parsedResult.tasks) ? this.parsedResult.tasks : [];
        const warnings = Array.isArray(this.parsedResult.warnings)
            ? this.parsedResult.warnings.filter((item) => typeof item === 'string' && item.trim())
            : [];
        const errors = Array.isArray(this.parsedResult.errors) ? this.parsedResult.errors : [];
        const duplicates = Array.isArray(this.parsedResult.conflicts?.duplicates) ? this.parsedResult.conflicts.duplicates : [];
        const overwrites = Array.isArray(this.parsedResult.conflicts?.overwrites) ? this.parsedResult.conflicts.overwrites : [];
        const brokenDeps = Array.isArray(this.parsedResult.conflicts?.broken_deps) ? this.parsedResult.conflicts.broken_deps : [];
        const selectedCount = this.selectedTasks.size;
        const taskWarningsCount = tasks.filter((task) => Array.isArray(task?.warnings) && task.warnings.length > 0).length;
        const overrideMode = this.selectedModule || this.selectedTopic;
        const overrideLabel = overrideMode
            ? `${this.selectedModuleName || this.selectedModule || wt('im.k146', 'Модуль не задан')} / ${this.selectedTopicName || this.selectedTopic || wt('im.k147', 'Тема из архива')}`
            : wt('im.k148', 'Структура архива будет использована как источник модулей и тем.');
        const archiveVersion = String(this.parsedResult.archive_version || '').trim();
        const blockedTasksCount = this.getPreviewBlockedTaskCount();
        const importableTasksCount = this.getPreviewImportableTasks().length;

        return `
            <div data-role="archive-import-preview" class="animate-slide-up-fade space-y-5">
                <div>
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k668', 'Предпросмотр архива')}</h3>
                    <p class="text-sm text-text-secondary mt-1">${wt('im.k923', 'Проверьте состав пакета, конфликты и правила импорта до применения изменений.')}</p>
                </div>

                ${this.parsedResult.critical_error ? `
                    <div class="rounded-xl border border-error-light bg-error-lighter px-4 py-3 text-sm text-error-text">
                        <div class="font-semibold">${wt('im.k924', 'Критическая ошибка проверки')}</div>
                        <div class="mt-1 break-words">${this.escapeHtml(this.parsedResult.critical_error)}</div>
                    </div>
                ` : ''}

                <div id="import-limit-warning-container">
                    ${this.renderLimitWarningHtml()}
                </div>

                <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <div class="rounded-xl border border-border-subtle bg-surface-2 px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-text-secondary">${wt('im.k905', 'Всего')}</div>
                        <div class="mt-1 text-2xl font-bold text-text-main">${summary.total || 0}</div>
                    </div>
                    <div class="rounded-xl border border-success-light bg-success-lighter px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-success-darker">${wt('im.k925', 'Готово')}</div>
                        <div class="mt-1 text-2xl font-bold text-success-darker">${summary.valid || 0}</div>
                    </div>
                    <div class="rounded-xl border border-warning-light bg-warning-lighter px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-warning-text">${wt('im.k926', 'Конфликты')}</div>
                        <div class="mt-1 text-2xl font-bold text-warning-text">${summary.conflicts || 0}</div>
                    </div>
                    <div class="rounded-xl border border-error-light bg-error-lighter px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-error-text">${wt('im.k927', 'Ошибки')}</div>
                        <div class="mt-1 text-2xl font-bold text-error-text">${summary.errors || 0}</div>
                    </div>
                    <div class="rounded-xl border border-warning-light bg-warning-lighter px-4 py-3">
                        <div class="text-xs uppercase tracking-wide text-warning-text">Warnings</div>
                        <div class="mt-1 text-2xl font-bold text-warning-text">${warnings.length + taskWarningsCount}</div>
                    </div>
                </div>

                <div class="rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-sm space-y-3">
                    <div class="flex flex-wrap items-start justify-between gap-3">
                        <div>
                            <h4 class="text-sm font-bold text-text-main">${wt('im.k669', 'Контекст импорта')}</h4>
                            <p class="text-xs text-text-secondary mt-1">${wt('im.k928', 'Override применяется только если вы задали модуль или тему вручную.')}</p>
                        </div>
                        ${archiveVersion ? `<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-2 px-2 py-1 text-xs font-semibold text-text-secondary">Archive v${this.escapeHtml(archiveVersion)}</span>` : ''}
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-3">
                            <div class="text-xs uppercase tracking-wide text-text-secondary">Target override</div>
                            <div class="mt-1 font-semibold text-text-main break-words">${this.escapeHtml(overrideLabel)}</div>
                        </div>
                        <div class="rounded-lg border border-border-subtle bg-surface-2 px-3 py-3">
                            <div class="text-xs uppercase tracking-wide text-text-secondary">${wt('im.k929', 'Политика ошибок')}</div>
                            <div class="mt-1 font-semibold text-text-main">${this.excludedTasks.size > 0 ? `Ручных исключений: ${this.excludedTasks.size}` : wt('im.k149', 'Исключений вручную пока нет.')}</div>
                        </div>
                    </div>
                </div>

                <div class="rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-sm">
                    <h4 class="text-sm font-bold text-text-main mb-3">${wt('im.k663', 'Настройки импорта')}</h4>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k909', 'Если задание уже существует')}</label>
                            <select id="conflict-resolution-select" class="block w-full rounded border-border-normal text-sm py-1.5 focus:ring-primary">
                                <option value="skip">${wt('im.k910', 'Пропустить (по умолчанию)')}</option>
                                <option value="overwrite">${wt('im.k911', 'Перезаписать')}</option>
                                <option value="new_id">${wt('im.k912', 'Создать копию (новый ID)')}</option>
                            </select>
                        </div>
                        <div class="flex items-center">
                            <label class="flex items-center gap-2 cursor-pointer mt-4">
                                <input type="checkbox" id="skip-errors-checkbox" checked class="rounded text-primary focus:ring-primary w-4 h-4">
                                <span class="text-sm text-text-secondary">${wt('im.k913', 'Пропускать задания с ошибками')}</span>
                            </label>
                        </div>
                    </div>
                    <div class="mt-4 rounded-xl border border-warning-light bg-warning-lighter px-4 py-3 text-sm text-warning-text">
                        <div class="font-semibold">${wt('im.k930', 'Импорт битых заданий заблокирован')}</div>
                        <div class="mt-1">
                            ${blockedTasksCount > 0
                                ? `${wt('im.k670', 'Задания со статусом «Ошибка» не будут добавлены. Сейчас заблокировано:')} ${blockedTasksCount}. ${wt('im.k671', 'К импорту доступно:')} ${importableTasksCount}.`
                                : wt('im.k150', 'Если при проверке находятся задания со статусом «Ошибка», они не добавляются и остаются только в списке предпросмотра.')}
                        </div>
                    </div>
                </div>

                <div class="grid gap-5 lg:grid-cols-2">
                    <div class="space-y-4">
                        <div>
                            <h4 class="text-sm font-bold text-text-main mb-2">${wt('im.k672', 'Конфликты и ошибки')}</h4>
                            ${this.renderArchivePreviewIssueList(
                                [
                                    ...duplicates.map((item) => ({
                                        title: item.name || item.id || wt('im.k151', 'Дубликат'),
                                        detail: wt('im.k152', 'Идентичная версия уже есть в библиотеке.'),
                                    })),
                                    ...overwrites.map((item) => ({
                                        title: item.name || item.id || wt('im.k153', 'Конфликт'),
                                        detail: `${wt('im.k673', 'Требует решения по конфликту')}${Array.isArray(item.diff_keys) && item.diff_keys.length ? `, diff: ${item.diff_keys.join(', ')}` : '.'}`,
                                    })),
                                    ...brokenDeps.map((item) => ({
                                        title: item.name || item.id || wt('im.k154', 'Проблема зависимостей'),
                                        detail: item.error || wt('im.k155', 'В архиве отсутствуют нужные ресурсы.'),
                                    })),
                                    ...errors.map((item) => ({
                                        title: item.name || item.id || wt('im.k156', 'Ошибка'),
                                        detail: item.error || wt('im.k157', 'Не удалось проверить задание.'),
                                    })),
                                ],
                                wt('im.k158', 'Проверка не нашла критичных конфликтов.'),
                                (item) => `
                                    <div class="font-medium text-text-main">${this.escapeHtml(item.title || wt('im.k159', 'Элемент архива'))}</div>
                                    <div class="text-xs text-text-secondary mt-1">${this.escapeHtml(item.detail || '')}</div>
                                `,
                                'archive-import-issues'
                            )}
                        </div>
                        <div>
                            <h4 class="text-sm font-bold text-text-main mb-2">${wt('im.k674', 'Предупреждения')}</h4>
                            ${this.renderArchivePreviewIssueList(
                                warnings.map((warning) => ({ warning })),
                                wt('im.k160', 'Дополнительных предупреждений нет.'),
                                (item) => `<div class="text-sm text-text-main">${this.escapeHtml(item.warning || '')}</div>`,
                                'archive-import-warnings'
                            )}
                        </div>
                    </div>

                    <div class="space-y-4">
                        <div class="p-3 bg-primary-lighter border border-primary-light rounded-lg flex flex-wrap items-center justify-between gap-3">
                            <div class="flex flex-wrap items-center gap-3 min-w-0">
                                <label class="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        id="select-all-tasks"
                                        onchange="dashboard.importManager.toggleSelectAll()"
                                        class="w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary"
                                        ${this.selectedTasks.size === tasks.length && tasks.length > 0 ? 'checked' : ''}>
                                    <span class="text-sm font-medium text-text-secondary">${wt('im.k737', 'Выбрать все')}</span>
                                </label>
                                ${selectedCount > 0 ? `
                                    <span class="text-xs text-text-muted px-2 py-1 bg-surface-1 rounded border border-border-subtle">
                                        ${wt('im.k664', 'Выбрано:')} ${selectedCount}
                                    </span>
                                ` : ''}
                            </div>
                            <div class="flex flex-wrap gap-2">
                                <button
                                    onclick="dashboard.importManager.bulkExclude()"
                                    class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    ${selectedCount === 0 ? 'disabled' : ''}>
                                    ${wt('im.k161', 'Исключить выбранные')}
                                </button>
                                <button
                                    onclick="dashboard.importManager.bulkInclude()"
                                    class="px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-1 border border-border-subtle rounded hover:bg-bg-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    ${selectedCount === 0 ? 'disabled' : ''}>
                                    ${wt('im.k162', 'Включить выбранные')}
                                </button>
                            </div>
                        </div>
                        <div class="space-y-3">
                            ${tasks.map((task, index) => this.renderArchiveTaskCard(task, index)).join('')}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderStep4() {
        if (this.hasActiveWorkspaceImportFlow()) {
            return this.renderWorkspaceImportConfirmStep();
        }
        const validTasks = this.getPreviewImportableTasks();
        const blockedTasksCount = this.getPreviewBlockedTaskCount();
        const excludedTasksCount = this.excludedTasks.size;
        const nothingToImport = validTasks.length === 0;

        const limits = this.parsedResult?.workspace_limits;
        let limitExceeded = false;
        let remainingTasks = 0;
        if (limits && limits.plan !== 'premium') {
            remainingTasks = limits.tasks?.remaining_personal ?? 0;
            if (validTasks.length > remainingTasks) {
                limitExceeded = true;
            }
        }
        const isBlocked = nothingToImport || limitExceeded;

        let description = '';
        if (nothingToImport) {
            description = wt('im.k163', 'После проверки и фильтрации не осталось заданий, которые можно импортировать.');
        } else if (limitExceeded) {
            description = wt('im.limit_exceeded_desc_step4', 'Количество импортируемых заданий превышает доступный лимит. Свободно слотов: {remaining}, требуется: {required}.')
                .replace('{remaining}', remainingTasks)
                .replace('{required}', validTasks.length);
        } else {
            description = `${wt('im.k793', 'Будет импортировано ')}${validTasks.length}${wt('im.k794', ' заданий')}`;
        }

        let boxText = '';
        if (nothingToImport) {
            boxText = wt('im.k164', 'Кнопка импорта отключена, потому что все задания либо битые, либо исключены вручную.');
        } else if (limitExceeded) {
            boxText = wt('im.limit_exceeded_box', 'Кнопка импорта отключена, так как количество импортируемых заданий превышает доступный лимит свободных слотов. Пожалуйста, вернитесь на предыдущий шаг и исключите некоторые задания из списка импорта.');
        } else {
            boxText = `${wt('im.k800', 'Задания со статусом «Ошибка» не будут добавлены. Импорт продолжится только для оставшихся ')}${validTasks.length}${wt('im.k801', ' заданий.')}`;
        }

        return `
            <div class="max-w-3xl mx-auto text-center py-8 animate-slide-up-fade">
                <div class="w-20 h-20 ${isBlocked ? 'bg-error-light' : 'bg-success-light'} rounded-full flex items-center justify-center mx-auto mb-6">
                    <span class="material-symbols-outlined ${isBlocked ? 'text-error-text' : 'text-success-text'} text-[48px]">${isBlocked ? 'block' : 'check_circle'}</span>
                </div>
                
                <h3 class="text-xl font-bold text-text-main mb-2">${isBlocked ? wt('im.k791', 'Импорт недоступен') : wt('im.k792', 'Готово к импорту')}</h3>
                <p class="text-text-secondary mb-6">${description}</p>
                
                <div class="bg-surface-2 rounded-lg p-6 text-left">
                    <div class="space-y-2 text-sm">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k768', 'Модуль')}:</span>
                            <span class="editor-flow-wrap font-medium text-text-main text-right">${this.escapeHtml(this.selectedModuleName || this.selectedModule)}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k769', 'Тема')}:</span>
                            <span class="editor-flow-wrap font-medium text-text-main text-right">${this.escapeHtml(this.selectedTopicName || this.selectedTopic)}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k795', 'Будет импортировано:')}</span>
                            <span class="font-medium text-text-main">${validTasks.length}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k796', 'Заблокировано по ошибкам:')}</span>
                            <span class="font-medium ${blockedTasksCount > 0 ? 'text-error-text' : 'text-text-main'}">${blockedTasksCount}</span>
                        </div>
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <span class="text-text-secondary">${wt('im.k797', 'Исключено вручную:')}</span>
                            <span class="font-medium text-text-main">${excludedTasksCount}</span>
                        </div>
                    </div>
                </div>
                <div class="mt-4 rounded-lg ${isBlocked ? 'border border-error-light bg-error-lighter text-error-text' : 'border border-warning-light bg-warning-lighter text-warning-text'} px-4 py-3 text-left text-sm">
                    <div class="font-semibold">${isBlocked ? wt('im.k798', 'Импорт отключён') : wt('im.k799', 'Что будет при импорте')}</div>
                    <div class="mt-1">
                        ${boxText}
                    </div>
                </div>
            </div>
        `;
    }
    renderTaskCard(task, index) {
        const statusColors = {
            valid: 'border-success-light bg-success-light',
            warning: 'border-warning-light bg-warning-light',
            error: 'border-error-light bg-error-light',
            conflict_overwrite: 'border-warning-light bg-warning-lighter',
            conflict_duplicate: 'border-info-light bg-info-lighter'
        };
        const statusIcons = {
            valid: '\u2713',
            warning: '\u26A0',
            error: '\u2717',
            conflict_overwrite: '\u26A1',
            conflict_duplicate: '\u2398'
        };
        const statusIconColors = {
            valid: 'text-success-text',
            warning: 'text-warning-text',
            error: 'text-error-text',
            conflict_overwrite: 'text-warning-dark',
            conflict_duplicate: 'text-info-dark'
        };
        const statusBgColors = {
            valid: 'bg-success-light',
            warning: 'bg-warning-light',
            error: 'bg-error-light',
            conflict_overwrite: 'bg-warning-lighter',
            conflict_duplicate: 'bg-info-light'
        };

        let statusKey = task.status;
        let statusLabel = task.status;

        if (task.status === 'conflict') {
            if (task.conflict_type === 'duplicate') {
                statusKey = 'conflict_duplicate';
                statusLabel = wt('im.k165', 'Дубликат (идентичен)');
            } else {
                statusKey = 'conflict_overwrite';
                statusLabel = wt('im.k166', 'Конфликт (изменен)');
            }
        }

        // Type-specific metadata
        const typeMetadata = this.getTaskTypeMetadata(task);

        // Type badges with icons
        const typeBadges = {
            'open_answer': { icon: '📝', label: wt('im.k167', 'Открытый ответ'), color: 'bg-info-light text-info-dark' },
            'sequence_assembly': { icon: '🔢', label: wt('im.k168', 'Последовательность'), color: 'bg-accent-light text-accent-dark' },
            'click': { icon: '🎯', label: wt('im.k169', 'Клик'), color: 'bg-secondary-light text-secondary-dark' },
            'test': { icon: '❓', label: wt('im.k170', 'Тест'), color: 'bg-warning-light text-warning-dark' }
        };
        const typeBadge = typeBadges[task.type] || { icon: '\u2022', label: task.type, color: 'bg-surface-2 text-text-secondary' };

        return `
            <div class="border-2 ${statusColors[statusKey] || 'border-border-subtle'} rounded-lg overflow-hidden transition-all hover:shadow-md">
                <!-- Card Header -->
                <div class="p-4 border-b border-border-subtle">
                    <div class="flex items-start justify-between mb-2">
                        <div class="flex items-center gap-2 flex-1">
                            <!-- Checkbox for bulk selection -->
                            <input 
                                type="checkbox" 
                                class="w-4 h-4 text-primary rounded focus:ring-2 focus:ring-primary flex-shrink-0"
                                data-task-checkbox="${index}"
                                onchange="dashboard.importManager.toggleTaskSelection(${index})"
                                ${this.selectedTasks.has(index) ? 'checked' : ''}>
                            <span class="text-sm font-bold text-text-muted">#${index + 1}</span>
                            <span class="inline-flex items-center gap-1 px-2 py-1 rounded ${typeBadge.color} text-xs font-medium">
                                <span>${typeBadge.icon}</span>
                                <span>${typeBadge.label}</span>
                            </span>
                        </div>
                        <div class="flex items-center gap-1 px-2 py-1 rounded ${statusBgColors[statusKey]} ${statusIconColors[statusKey]}">
                            <span class="text-lg font-bold">${statusIcons[statusKey]}</span>
                            <span class="text-xs font-semibold capitalize">${statusLabel}</span>
                        </div>
                    </div>
                    
                    <!-- Task Name (editable) -->
                    <h4 class="font-bold text-text-main mb-1 text-base cursor-pointer hover:bg-surface-2 rounded px-1 -mx-1 transition-colors" 
                        ${wt('im.k171', 'title="Нажмите для редактирования"')}
                        onclick="dashboard.importManager.startEditName(${index}, this)">${this.escapeHtml(task.name)}</h4>
                    
                    <!-- Prompt Preview -->
                    <p class="text-sm text-text-muted line-clamp-2">${this.escapeHtml(task.data?.prompt || wt('im.k802', 'Нет описания'))}</p>
                </div>
                
                <!-- Card Body: Metadata -->
                <div class="p-4 bg-surface-2">
                    <div class="grid grid-cols-2 gap-2 text-xs">
                        ${typeMetadata}
                    </div>
                </div>
                
                <!-- Validation Issues -->
                ${task.validation?.issues?.length > 0 ? `
                    <div class="p-4 border-t border-border-subtle bg-surface-2">
                        <div class="space-y-2">
                            ${task.validation.issues.slice(0, 3).map(issue => `
                                <div class="flex items-start gap-2 text-xs">
                                    <span class="flex-shrink-0 font-bold ${issue.severity === 'error' ? 'text-error' : 'text-warning'}">
                                        ${issue.severity === 'error' ? '\u2717' : '\u26A0'}
                                    </span>
                                    <span class="${issue.severity === 'error' ? 'text-error-text' : 'text-warning-text'} flex-1">
                                        ${this.escapeHtml(issue.message)}
                                    </span>
                                </div>
                            `).join('')}
                            ${task.validation.issues.length > 3 ? `
                                <div class="text-xs text-text-muted font-medium">
                                    +${task.validation.issues.length - 3} ${wt('im.k172', 'ещё...')}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Per-task conflict resolution (only for conflict tasks) -->
                ${task.status === 'conflict' ? `
                    <div class="px-4 py-2 border-t border-border-subtle bg-warning-lighter">
                        <label class="block text-xs font-semibold text-text-secondary mb-1">${wt('im.k772', 'Действие при конфликте:')}</label>
                        <select 
                            onchange="dashboard.importManager.setPerTaskConflict(${index}, this.value)"
                            class="block w-full rounded border-border-normal text-xs py-1 focus:ring-primary bg-surface-1">
                            <option value="" ${!this.perTaskConflictRes.has(index) ? 'selected' : ''}>${wt('im.k773', 'Как в общих настройках')}</option>
                            <option value="skip" ${this.perTaskConflictRes.get(index) === 'skip' ? 'selected' : ''}>${wt('im.k774', 'Пропустить')}</option>
                            <option value="overwrite" ${this.perTaskConflictRes.get(index) === 'overwrite' ? 'selected' : ''}>${wt('im.k761', 'Перезаписать')}</option>
                            <option value="new_id" ${this.perTaskConflictRes.get(index) === 'new_id' ? 'selected' : ''}>${wt('im.k762', 'Создать копию (новый ID)')}</option>
                        </select>
                    </div>
                ` : ''}

                <!-- Actions -->
                <div class="p-3 bg-surface-1 border-t border-border-subtle flex gap-2">
                    <button 
                        onclick="dashboard.importManager.showTaskDetails(${index})"
                        class="flex-1 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary hover:text-primary-fg rounded transition-colors border border-primary">
                        ${wt('im.k173', 'Детали')}
                    </button>
                    <button 
                        onclick="dashboard.importManager.toggleExclude(${index})"
                        class="flex-1 px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-bg-hover hover:text-text-on-dark rounded transition-colors border border-border-subtle"
                        data-task-exclude-btn="${index}">
                        ${this.excludedTasks.has(index) ? wt('im.k775', 'Включить') : wt('im.k776', 'Исключить')}
                    </button>
                </div>
            </div>
        `;
    }

    getTaskTypeMetadata(task) {
        const data = task.data || {};

        if (task.type === 'open_answer') {
            const promptLength = (data.prompt || '').length;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u270E</span>
                    <span class="text-text-secondary">${wt('im.k803', 'Длина вопроса:')}</span>
                    <span class="font-semibold text-text-main">${promptLength} ${wt('im.k804', 'симв.')}</span>
                </div>
            `;
        }

        if (task.type === 'sequence_assembly') {
            const elementsCount = data.elements_count || 0;
            const levelsCount = data.levels_count || 0;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u25A6</span>
                    <span class="text-text-secondary">${wt('im.k805', 'Элементов:')}</span>
                    <span class="font-semibold text-text-main">${elementsCount}</span>
                </div>
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u2261</span>
                    <span class="text-text-secondary">${wt('im.k806', 'Уровней:')}</span>
                    <span class="font-semibold text-text-main">${levelsCount}</span>
                </div>
            `;
        }

        if (task.type === 'click') {
            if (data.mode === 'text_choice') {
                const optionsCount = data.options_count || 0;
                const correctCount = data.correct_count || 0;
                return `
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u25A3</span>
                        <span class="text-text-secondary">${wt('im.k807', 'Вариантов:')}</span>
                        <span class="font-semibold text-text-main">${optionsCount}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u2713</span>
                        <span class="text-text-secondary">${wt('im.k808', 'Правильных:')}</span>
                        <span class="font-semibold text-text-main">${correctCount}</span>
                    </div>
                    <div class="col-span-2 flex items-center gap-1">
                        <span class="text-text-muted">\u2699</span>
                        <span class="text-text-secondary">${wt('im.k809', 'Режим:')}</span>
                        <span class="font-semibold text-text-main">${wt('im.k810', 'Текстовый выбор')}</span>
                    </div>
                `;
            } else if (data.mode === 'word_errors' || data.mode === 'text_errors') {
                const textLength = data.text_length || 0;
                const errorCount = data.error_count || 0;
                return `
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u270E</span>
                        <span class="text-text-secondary">${wt('im.k811', 'Текст:')}</span>
                        <span class="font-semibold text-text-main">${textLength} ${wt('im.k804', 'симв.')}</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <span class="text-text-muted">\u2717</span>
                        <span class="text-text-secondary">${wt('im.k812', 'Ошибок:')}</span>
                        <span class="font-semibold text-text-main">${errorCount}</span>
                    </div>
                `;
            }
        }

        if (task.type === 'test') {
            const questionCount = data.question_count || 0;
            return `
                <div class="flex items-center gap-1">
                    <span class="text-text-muted">\u25A3</span>
                    <span class="text-text-secondary">${wt('im.k813', 'Вопросов:')}</span>
                    <span class="font-semibold text-text-main">${questionCount}</span>
                </div>
            `;
        }

        return `
            <div class="col-span-2 text-text-muted text-center">${wt('im.k814', 'Нет дополнительной информации')}</div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    escapeHtmlAttr(text) {
        return String(text ?? '')
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeInlineJsString(text) {
        return String(text ?? '')
            .replace(/\\/g, '\\\\')
            .replace(/'/g, '\\x27')
            .replace(/"/g, '\\x22')
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n')
            .replace(/</g, '\\x3C')
            .replace(/>/g, '\\x3E')
            .replace(/&/g, '\\x26');
    }

    serializeInlineJson(value) {
        try {
            return this.escapeInlineJsString(
                JSON.stringify(value)
                    .replace(/</g, '\\u003c')
                    .replace(/>/g, '\\u003e')
                    .replace(/&/g, '\\u0026')
            );
        } catch (_) {
            return '';
        }
    }

    getMicrocardsDeckOwnership(deck) {
        const ownership = (deck && typeof deck.ownership === 'object') ? deck.ownership : {};
        const meta = (deck && typeof deck.meta === 'object') ? deck.meta : {};
        const createdByUserId = String(
            ownership.created_by_user_id || ownership.createdByUserId || meta.created_by_user_id || ''
        ).trim();
        const createdVia = String(
            ownership.created_via || ownership.createdVia || meta.source || ''
        ).trim() || ((deck && deck.analysis_id) ? 'analysis_auto' : 'manual_editor');
        return {
            createdByUserId,
            createdVia,
            hasOwner: ownership.has_owner === true || !!createdByUserId,
            isOwnedByCurrentUser: ownership.is_owned_by_current_user === true,
            isSharedLibrary: ownership.is_shared_library !== false,
        };
    }

    getMicrocardsDeckCreatedViaLabel(createdVia) {
        switch (String(createdVia || '').trim().toLowerCase()) {
            case 'analysis_auto':
                return wt('im.k174', 'ИИ');
            case 'manual_editor':
                return wt('im.k175', 'Редактор');
            case 'text_import':
                return wt('im.k176', 'Импорт');
            default:
                return wt('im.k177', 'Библиотека');
        }
    }

    renderMicrocardsDeckOwnershipBadges(deck) {
        const ownership = this.getMicrocardsDeckOwnership(deck);
        const chips = [];
        if (ownership.isSharedLibrary) {
            chips.push(wt('im.k178', '<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">Общая библиотека</span>'));
        }
        if (ownership.isOwnedByCurrentUser) {
            chips.push(wt('im.k179', '<span class="inline-flex items-center gap-1 rounded-full border border-primary-light bg-primary-lighter px-2 py-0.5 text-[10px] font-semibold text-primary-darker">Создано вами</span>'));
        } else if (ownership.hasOwner) {
            chips.push(`<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${this.escapeHtml(ownership.createdByUserId)}</span>`);
        }
        chips.push(`<span class="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[10px] font-semibold text-text-secondary">${this.escapeHtml(this.getMicrocardsDeckCreatedViaLabel(ownership.createdVia))}</span>`);
        return chips.join('');
    }

    aiUxMessage(key, fallback = '', params = {}) {
        try {
            const t = window?.RP_AI_UX?.t;
            if (typeof t === 'function') {
                return t.call(window.RP_AI_UX, key, params, fallback);
            }
        } catch (_) { }
        return fallback || key;
    }

    readEditorTheoryBridgeContext() {
        try {
            const raw = window.localStorage.getItem(this.editorTheoryBridgeStorageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : null;
        } catch (_) {
            return null;
        }
    }

    writeEditorTheoryBridgeContext(payload) {
        try {
            if (!payload || typeof payload !== 'object') return false;
            window.localStorage.setItem(this.editorTheoryBridgeStorageKey, JSON.stringify(payload));
            return true;
        } catch (_) {
            return false;
        }
    }

    _normalizeTheoryBridgeRefs(refs) {
        if (!refs || typeof refs !== 'object') return null;
        const normalizeIntList = (value) => {
            if (!Array.isArray(value)) return [];
            const seen = new Set();
            const out = [];
            value.forEach((raw) => {
                const num = Number.parseInt(raw, 10);
                if (!Number.isFinite(num) || seen.has(num)) return;
                seen.add(num);
                out.push(num);
            });
            return out;
        };
        const normalizeStrList = (value) => {
            if (!Array.isArray(value)) return [];
            const seen = new Set();
            const out = [];
            value.forEach((raw) => {
                const text = String(raw || '').trim();
                if (!text || seen.has(text)) return;
                seen.add(text);
                out.push(text);
            });
            return out;
        };
        const normalized = {
            unit_ids: normalizeIntList(refs.unit_ids),
            chunk_ids: normalizeStrList(refs.chunk_ids),
            route_ids: normalizeStrList(refs.route_ids),
        };
        return (normalized.unit_ids.length || normalized.chunk_ids.length || normalized.route_ids.length) ? normalized : null;
    }

    syncEditorTheoryBridgeContext({ refs = null, sourceBlock = null, showToast = false, intent = '' } = {}) {
        if (!this.isTheoryFeatureEnabled('editor_analysis_report_link')) {
            if (showToast) this.showToast(wt('im.k180', 'Связка отчёта с редактором отключена (feature flag).'), 'warning');
            return false;
        }
        const aiRunId = String(this.aiRunId || this.analysisResult?.ai_run_id || '').trim();
        if (!aiRunId) {
            if (showToast) this.showToast(this.aiUxMessage('theory_report.bridge.no_ai_run', wt('im.k181', 'Сначала откройте анализ, чтобы передать контекст в редактор.')), 'warning');
            return false;
        }
        const a = this.analysisResult && typeof this.analysisResult === 'object' ? this.analysisResult : {};
        const normalizedRefs = this._normalizeTheoryBridgeRefs(refs);
        const payload = {
            version: 1,
            source: 'theory_report',
            intent: String(intent || '').trim() || null,
            ai_run_id: aiRunId,
            saved_at: new Date().toISOString(),
            analysis_summary: {
                analysis_schema_version: a.analysis_schema_version || null,
                report_blocks_version: a.report_blocks_version || null,
                units_count: Array.isArray(a.educational_units) ? a.educational_units.length : 0,
                chunks_count: Array.isArray(a.learning_chunks) ? a.learning_chunks.length : 0,
                routes_count: Array.isArray(a.authoring_routes) ? a.authoring_routes.length : 0,
            },
            refs: normalizedRefs,
            source_block: sourceBlock && typeof sourceBlock === 'object' ? {
                id: sourceBlock.id || null,
                title: sourceBlock.title || null,
                anchor: sourceBlock.anchor || null,
                type: sourceBlock.type || null,
            } : null,
        };
        const ok = this.writeEditorTheoryBridgeContext(payload);
        if (ok && showToast) {
            const msgKey = normalizedRefs ? 'theory_report.bridge.saved_block_context' : 'theory_report.bridge.saved_context';
            this.showToast(this.aiUxMessage(msgKey, normalizedRefs ? wt('im.k182', 'Контекст блока отчёта сохранён для редактора.') : wt('im.k183', 'Контекст анализа сохранён для редактора.')), 'success');
        }
        return ok;
    }

    pushTheoryAnalysisContextForEditor() {
        return this.syncEditorTheoryBridgeContext({ showToast: true, intent: 'editor_link' });
    }

    pushTheoryReportBlockContextForEditor(blockId) {
        const id = String(blockId || '').trim();
        if (!id) {
            this.pushTheoryAnalysisContextForEditor();
            return;
        }
        const blocks = Array.isArray(this.analysisResult?.report_blocks) ? this.analysisResult.report_blocks : [];
        const block = blocks.find((b) => String(b?.id || '') === id);
        if (!block || typeof block !== 'object') {
            this.showToast(this.aiUxMessage('theory_report.bridge.block_not_found', wt('im.k184', 'Не удалось найти выбранный блок отчёта. Попробуйте сохранить контекст анализа целиком.')), 'warning');
            return;
        }
        this.syncEditorTheoryBridgeContext({
            refs: block.refs,
            sourceBlock: {
                id: block.id,
                title: block.title,
                anchor: block.anchor,
                type: block.type,
            },
            showToast: true,
            intent: 'editor_link',
        });
    }

    pushTheoryAuthoringRouteContextForEditor(routeId) {
        const id = String(routeId || '').trim();
        if (!id) {
            this.pushTheoryAnalysisContextForEditor();
            return;
        }
        const routes = Array.isArray(this.analysisResult?.authoring_routes) ? this.analysisResult.authoring_routes : [];
        const route = routes.find((r) => String(r?.id || '') === id);
        if (!route || typeof route !== 'object') {
            this.showToast(this.aiUxMessage('theory_report.bridge.route_not_found', wt('im.k185', 'Не удалось найти маршрут автора. Попробуйте сохранить контекст анализа целиком.')), 'warning');
            return;
        }
        this.syncEditorTheoryBridgeContext({
            refs: {
                unit_ids: Array.isArray(route.unit_ids) ? route.unit_ids : [],
                chunk_ids: Array.isArray(route.chunk_ids) ? route.chunk_ids : [],
                route_ids: [id],
            },
            sourceBlock: {
                id: `route:${id}`,
                title: route.title || id,
                anchor: null,
                type: 'authoring_route',
            },
            showToast: true,
            intent: 'editor_link',
        });
    }

    showTaskDetails(index) {
        const task = this.parsedResult?.tasks?.[index];
        if (!task) return;

        const typeLabels = {
            open_answer: wt('im.k186', 'Открытый ответ'),
            sequence_assembly: wt('im.k187', 'Последовательность'),
            click: wt('im.k188', 'Клик'),
            test: wt('im.k189', 'Тест')
        };
        const statusLabels = {
            valid: wt('im.k190', '<span class="text-success-text font-semibold">Валидно</span>'),
            warning: wt('im.k191', '<span class="text-warning-text font-semibold">Предупреждения</span>'),
            error: wt('im.k192', '<span class="text-error-text font-semibold">Ошибки</span>')
        };

        const issuesHtml = (task.validation?.issues || []).map(issue => {
            const color = issue.severity === 'error' ? 'text-error-text' : 'text-warning-text';
            const icon = issue.severity === 'error' ? 'error' : 'warning';
            return `<div class="flex items-start gap-2 py-1"><span class="material-symbols-outlined ${color} text-[16px] mt-0.5">${icon}</span><span class="text-sm ${color}">${this.escapeHtml(issue.message)}</span></div>`;
        }).join('') || `<div class="text-sm text-success-text">${wt('im.k738', 'Нет проблем')}</div>`;

        const data = task.data || {};
        let extraFieldsHtml = '';
        if (task.type === 'open_answer') {
            if (data.reference_answer) extraFieldsHtml += `<div class="mt-3"><div class="text-xs font-semibold text-text-muted mb-1">${wt('im.k739', 'Эталонный ответ')}</div><div class="text-sm text-text-main bg-surface-2 rounded p-2">${this.escapeHtml(data.reference_answer)}</div></div>`;
            if (data.keywords?.length) extraFieldsHtml += `<div class="mt-3"><div class="text-xs font-semibold text-text-muted mb-1">${wt('im.k740', 'Ключевые слова')}</div><div class="flex flex-wrap gap-1">${data.keywords.map(k => `<span class="px-2 py-0.5 bg-primary-lighter text-primary text-xs rounded-full">${this.escapeHtml(k)}</span>`).join('')}</div></div>`;
        } else if (task.type === 'sequence_assembly') {
            extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">${wt('im.k741', 'Элементов:')} ${data.elements_count || 0}, ${wt('im.k742', 'Уровней:')} ${data.levels_count || 0}</div>`;
        } else if (task.type === 'click') {
            if (data.mode === 'text_choice') extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">${wt('im.k743', 'Вариантов:')} ${data.options_count || 0}, ${wt('im.k744', 'Правильных:')} ${data.correct_count || 0}</div>`;
            else extraFieldsHtml += `<div class="mt-3 text-sm text-text-secondary">${wt('im.k745', 'Текст:')} ${data.text_length || 0} ${wt('im.k746', 'симв.,')} ${wt('im.k747', 'Ошибок:')} ${data.error_count || 0}</div>`;
        }

        // Create modal overlay
        let overlay = document.getElementById('task-detail-overlay');
        if (overlay) overlay.remove();

        overlay = document.createElement('div');
        overlay.id = 'task-detail-overlay';
        overlay.className = 'fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm';
        overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
        overlay.innerHTML = `
            <div class="bg-surface-1 rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto" onclick="event.stopPropagation()">
                <div class="flex items-center justify-between p-5 border-b border-border-subtle">
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k193', 'Задание #')}${index + 1}</h3>
                    <button onclick="document.getElementById('task-detail-overlay').remove()" class="w-8 h-8 rounded-full hover:bg-bg-hover flex items-center justify-center">
                        <span class="material-symbols-outlined text-text-muted">close</span>
                    </button>
                </div>
                <div class="p-5 space-y-4">
                    <div class="grid grid-cols-2 gap-3 text-sm">
                        <div><span class="text-text-muted">\u0422\u0438\u043f:</span> <span class="font-medium text-text-main">${typeLabels[task.type] || task.type}</span></div>
                        <div><span class="text-text-muted">${wt('im.k194', 'Статус:</span>')}${statusLabels[task.status] || task.status}</div>
                    </div>
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-1">${wt('im.k748', 'Название')}</div>
                        <div class="text-sm text-text-main">${this.escapeHtml(task.name)}</div>
                    </div>
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-1">\u041f\u0440\u043e\u043c\u043f\u0442</div>
                        <div class="text-sm text-text-main bg-surface-2 rounded p-3 whitespace-pre-wrap">${this.escapeHtml(data.prompt || wt('im.k752', 'Нет'))}</div>
                    </div>
                    ${extraFieldsHtml}
                    <div>
                        <div class="text-xs font-semibold text-text-muted mb-2">${wt('im.k749', 'Валидация')}</div>
                        ${issuesHtml}
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
    }

    startEditName(index, el) {
        const task = this.parsedResult?.tasks?.[index];
        if (!task) return;

        const currentName = task.name || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'w-full text-base font-bold text-text-main bg-surface-2 border border-primary rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary';

        const commit = () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                task.name = newName;
            }
            el.textContent = task.name;
            el.style.display = '';
            input.remove();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { el.style.display = ''; input.remove(); }
        });

        el.style.display = 'none';
        el.parentNode.insertBefore(input, el.nextSibling);
        input.focus();
        input.select();
    }

    setPerTaskConflict(index, value) {
        if (value) {
            this.perTaskConflictRes.set(index, value);
        } else {
            this.perTaskConflictRes.delete(index);
        }
    }

    toggleExclude(index) {
        if (this.excludedTasks.has(index)) {
            this.excludedTasks.delete(index);
        } else {
            this.excludedTasks.add(index);
        }

        // Update button text and card opacity
        const btn = document.querySelector(`[data-task-exclude-btn="${index}"]`);
        if (btn) {
            btn.textContent = this.excludedTasks.has(index) ? wt('im.k195', 'Включить') : wt('im.k196', 'Исключить');
            const card = btn.closest('[data-role="archive-import-task-card"]');
            if (card) {
                card.classList.toggle('opacity-60', this.excludedTasks.has(index));
            }
        }

        // Update limit warning container dynamically
        const warningContainer = document.getElementById('import-limit-warning-container');
        if (warningContainer) {
            warningContainer.innerHTML = this.renderLimitWarningHtml();
        }

        this.updateNavigationButtons();
    }

    // =========================================================================
    // Event Listeners
    // =========================================================================

    attachStepEventListeners() {
        const moduleSelect = document.getElementById('import-module-select');
        const topicSelect = document.getElementById('import-topic-select');

        if (moduleSelect && !moduleSelect.dataset.importBound) {
            moduleSelect.dataset.importBound = '1';
            moduleSelect.addEventListener('change', (e) => {
                this.selectedModule = e.target.value;
                this.selectedModuleName = e.target.selectedOptions[0]?.textContent || e.target.value;
                this.updateTopicSelect();
            });
        }
        if (topicSelect && !topicSelect.dataset.importBound) {
            topicSelect.dataset.importBound = '1';
            topicSelect.addEventListener('change', (e) => {
                this.selectedTopic = e.target.value;
                this.selectedTopicName = e.target.selectedOptions[0]?.textContent || e.target.value;
            });
        }

        if (this.currentStep === 1) {
            const fileInput = document.getElementById('import-file-input');
            const dropZone = document.getElementById('import-drop-zone');

            const handleFileSelected = (file) => {
                if (file && file.name.endsWith('.zip')) {
                    this.uploadedFile = file;
                    const display = document.getElementById('file-name-display');
                    if (display) {
                        display.textContent = file.name;
                        display.classList.add('text-primary', 'font-bold');
                    }
                }
            };

            if (fileInput) {
                fileInput.addEventListener('change', (e) => handleFileSelected(e.target.files[0]));
            }

            // Drag & Drop
            if (dropZone) {
                dropZone.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    dropZone.classList.add('border-primary', 'bg-primary-lighter');
                });
                dropZone.addEventListener('dragleave', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('border-primary', 'bg-primary-lighter');
                });
                dropZone.addEventListener('drop', (e) => {
                    e.preventDefault();
                    dropZone.classList.remove('border-primary', 'bg-primary-lighter');
                    const file = e.dataTransfer?.files?.[0];
                    handleFileSelected(file);
                });
            }

            // AI mode: file upload + drag-drop + textarea
            if (this.importMode === 'ai') {
                this.attachAIComposerEventListeners();
            }
        }

        if (this.currentStep === 2) {
            const textArea = document.getElementById('import-text-area');
            const pasteBtn = document.getElementById('import-paste-clipboard-btn');
            const copyPromptBtn = document.getElementById('ai-agent-copy-prompt-btn');
            const templateSelect = document.getElementById('ai-agent-template-type');

            if (templateSelect) {
                templateSelect.addEventListener('change', (e) => {
                    this.parsedResult = null;
                    this.aiTemplateType = e.target.value;
                    const selectedTaskType = this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType);
                    const activeSession = this.getActiveManualAnalysisSession();
                    if (activeSession?.analysis) {
                        this.manualAnalysisResult = activeSession.analysis;
                    }
                    if (selectedTaskType) {
                        this.setManualAnalysisSelectedTaskType(selectedTaskType);
                    }
                    this.updateAIAgentPromptTextarea();
                    this._updateLiveCounter(this.sourceText || '');
                    this.renderCurrentStep();
                });
            }

            if (copyPromptBtn) {
                copyPromptBtn.addEventListener('click', () => this.copyAIAgentPrompt());
            }

            if (pasteBtn) {
                pasteBtn.addEventListener('click', () => this.pasteImportTextFromClipboard());
            }

            if (textArea) {
                let liveCounterTimer = null;
                textArea.addEventListener('input', (e) => {
                    this.sourceText = e.target.value;
                    this.parsedResult = null;
                    if (this.aiTemplateType === 'material_analysis') {
                        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
                    }
                    clearTimeout(liveCounterTimer);
                    liveCounterTimer = setTimeout(() => this._updateLiveCounter(e.target.value), 300);
                });
                // Initial counter update
                this._updateLiveCounter(this.sourceText);
            }
            this.updateAIAgentPromptTextarea();
        }
    }

    attachAIComposerEventListeners() {
        const aiFileInput = document.getElementById('ai-file-input');
        const aiDropZone = document.getElementById('ai-drop-zone');
        const aiTextarea = document.getElementById('ai-material-textarea');

        if (aiFileInput) {
            aiFileInput.addEventListener('change', (e) => this._handleAIFileSelected(e.target.files[0]));
        }

        if (aiDropZone) {
            aiDropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                aiDropZone.classList.add('border-primary', 'bg-primary-lighter');
            });
            aiDropZone.addEventListener('dragleave', (e) => {
                e.preventDefault();
                aiDropZone.classList.remove('border-primary', 'bg-primary-lighter');
            });
            aiDropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                aiDropZone.classList.remove('border-primary', 'bg-primary-lighter');
                const file = e.dataTransfer?.files?.[0];
                this._handleAIFileSelected(file);
            });
        }

        if (aiTextarea) {
            aiTextarea.addEventListener('input', (e) => {
                this.materialText = e.target.value;
                const wc = e.target.value.split(/\s+/).filter(Boolean).length;
                const wcEl = document.getElementById('ai-word-count');
                if (wcEl) wcEl.textContent = wc > 0 ? `${wc} ${wt('im.k675', 'слов')}` : '';
            });
        }

        const langModeInputs = document.querySelectorAll('input[name="ai-output-language-mode"]');
        langModeInputs.forEach((input) => {
            input.addEventListener('change', (e) => this.setAIOutputLanguageMode(e.target.value));
        });
        const langSelect = document.getElementById('ai-output-language-select');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => this.setAIOutputLanguage(e.target.value));
        }
    }

    _updateLiveCounter(text) {
        const container = document.getElementById('import-live-counter');
        if (!container) return;

        if (this.aiTemplateType === 'material_analysis') {
            const markers = [
                { marker: '<human_summary>', label: wt('im.k197', 'Краткое резюме'), color: 'bg-sky-100 text-sky-700' },
                { marker: '<analysis_json>', label: wt('im.k198', 'Структурный JSON'), color: 'bg-emerald-100 text-emerald-700' },
            ];
            const badges = [];
            let total = 0;
            for (const { marker, label, color } of markers) {
                if (String(text || '').includes(marker)) {
                    total += 1;
                    badges.push(`<span class="px-2 py-0.5 rounded-full ${color} font-medium">${label}</span>`);
                }
            }
            if (total > 0) {
                container.innerHTML = `<span class="text-text-muted py-0.5">${wt('im.k750', 'Найдено:')}</span>${badges.join('')}`;
            } else {
                container.innerHTML = text.trim() ? wt('im.k199', '<span class="text-text-disabled py-0.5">Маркеры анализа не найдены</span>') : '';
            }
            return;
        }

        const markers = [
            { marker: '@OPEN_ANSWER', label: wt('im.k200', 'Открытый ответ'), color: 'bg-blue-100 text-blue-700' },
            { marker: '@SEQUENCE', label: wt('im.k201', 'Последовательность'), color: 'bg-purple-100 text-purple-700' },
            { marker: '@CLICK_TEXT', label: wt('im.k202', 'Клик / Ошибки (выбор)'), color: 'bg-amber-100 text-amber-700' },
            { marker: '@CLICK_WORDS', label: wt('im.k203', 'Клик / Ошибки (текст)'), color: 'bg-rose-100 text-rose-700' },
            { marker: '@TEST', label: wt('im.k204', 'Тест'), color: 'bg-orange-100 text-orange-700' }
        ];

        const badges = [];
        let total = 0;
        for (const { marker, label, color } of markers) {
            const count = (text.match(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
            if (count > 0) {
                total += count;
                badges.push(`<span class="px-2 py-0.5 rounded-full ${color} font-medium">${label}: ${count}</span>`);
            }
        }

        if (total > 0) {
            container.innerHTML = `<span class="text-text-muted py-0.5">${wt('im.k750', 'Найдено:')}</span>${badges.join('')}<span class="text-text-muted py-0.5 ml-1">${wt('im.k751', 'Всего:')} ${total}</span>`;
        } else {
            container.innerHTML = text.trim() ? wt('im.k205', '<span class="text-text-disabled py-0.5">Маркеры не найдены</span>') : '';
        }
    }

    getAIAgentTemplateOptions() {
        return {
            material_analysis: {
                title: wt('im.k206', '🔍 Анализ материала (с чего начать)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k207', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k208', '3. Изучите рекомендации ИИ и выберите подходящий тип задания из списка выше.')}
${wt('im.k571', 'Этот промпт НЕ генерирует задания — он помогает выбрать оптимальную стратегию.')}`,
                prompt: `Ты — старший методист и эксперт по педагогическому дизайну. Проанализируй учебный материал.

<goal>
Твоя главная цель — не назначать количество заданий. Построй методическую карту материала: выдели образовательные единицы и покажи, как существующие типы заданий можно применять к ним максимально эффективно, разнообразно и практично.
</goal>

<task>
Выполни 4 действия:
1. Выдели образовательные единицы — термины, понятия, факты, критерии, процессы, структуры, визуальные ориентиры и умения, которые студент должен усвоить.
2. Для каждой единицы определи, что именно нужно проверить: узнавание, различение, объяснение, структурирование, обнаружение ошибки, визуальное распознавание, интерпретацию или применение.
3. Для каждого доступного типа задания оцени, как его можно применить к этому материалу: какие единицы он покрывает, какой когнитивный угол закрывает, на какие опоры материала должен опираться и какие конкретные design candidates можно из него собрать.
4. Верни строгий структурированный ответ только в блоках <human_summary> и <analysis_json>.
</task>

<coverage_policy>
Принципы принятия решений:
- Не оценивай материал по объёму текста и не начинай анализ с количества заданий.
- Главный результат анализа — карта образовательных единиц и способов применения типов заданий, а не числовой план.
- Каждая существенная единица должна быть связана хотя бы с одним подходящим типом задания.
- Many-to-many покрытие допустимо и желательно: одна единица может осмысленно входить в несколько типов, если они проверяют её с разных сторон.
- В первую очередь показывай, как тип работает на этом материале: какие anchors он использует, какие ошибки, различия, структуры, критерии или визуальные признаки проверяет и какие конкретные заготовки заданий из этого следуют.
- Не отвергай тип преждевременно, если его можно применить творчески, но всё ещё строго по материалу.
- Если тип всё же не подходит, объясни это через особенности материала, а не через общие фразы.
- Поле count допустимо только как вторичная техническая подсказка для downstream-генерации; оно не должно быть главным выводом анализа и не должно определяться по длине текста.
</coverage_policy>

<available_task_types>
OPEN_ANSWER — свободный ответ своими словами.
  Лучше всего подходит для: объяснения понятий, причинно-следственных связей, механизмов, сравнений, интерпретации, аргументации.
  Не лучший выбор для: простых одиночных фактов, терминов или числовых данных, которые эффективнее проверяются компактными форматами.

SEQUENCE — сборка правильной структуры перетаскиванием элементов.
  Подходит для: хронологии, алгоритмов, стадий процесса, классификации по группам, иерархии, ранжирования, распределения элементов по уровням, если правильная структура однозначно следует из материала.
  Не подходит для: спорных классификаций, открытых интерпретаций, случаев, где порядок/группировка неоднозначны или требуют внешних знаний.

TEST — выбор одного или нескольких правильных вариантов.
  Подходит для: фактов, терминов, признаков, классификаций, различения похожих понятий, количественных данных.
  Не лучший выбор для: сложных объяснений и развёрнутых причинно-следственных связей, где важна формулировка студента.

CLICK_TEXT — выбор верных и неверных утверждений из списка.
  Подходит для: типичных заблуждений, тонких различий, сопоставления похожих утверждений, проверки понимания нюансов.
  Не подходит для: тем, где невозможно составить правдоподобные контрастные утверждения без натяжки.

CLICK_WORDS — поиск фактических ошибок в тексте.
  Подходит для: материалов с достаточным числом фактических опор — терминов, чисел, дат, параметров, характеристик, классификационных признаков — которые можно правдоподобно исказить.
  Не подходит для: слишком общих, интерпретативных или бедных на фактические опоры материалов.

CLICK — нахождение нужных элементов на изображении.
  Подходит для: визуального распознавания объектов, анатомических структур, элементов схем, карт, диаграмм, интерфейсов.
  Важно: такие задания создаются вручную в редакторе, но их нужно полноценно рекомендовать, если без них покрытие материала будет неполным.

DRAW — обводка/выделение нужных зон на изображении.
  Подходит для: пространственного распознавания, выделения областей, контуров, зон, анатомических структур, частей схем.
  Важно: такие задания создаются вручную в редакторе, но их нужно полноценно рекомендовать, если это необходимо для полного покрытия.
</available_task_types>

<decision_rules>
- Не выбирай тип задания только потому, что он в целом подходит. Выбирай его только если он даёт лучший или дополнительный способ проверить конкретные единицы.
- Не своди весь материал к одному доминирующему типу, если разные аспекты знания требуют разных форм проверки.
- Если материал содержит явную структуру, не игнорируй SEQUENCE.
- Если материал содержит визуальные объекты, не игнорируй CLICK и DRAW.
- Если материал богат фактами, числами и параметрами, отдельно оцени пригодность CLICK_WORDS.
- Если единица требует не узнавания, а объяснения, отдавай приоритет OPEN_ANSWER.
- Если визуальный тип рекомендован, пометь его как manual_only=true и auto_generation_supported=false.
</decision_rules>

<illustrations_rule>
Если материал упоминает или содержит изображения, схемы, диаграммы или фотографии:
- установи "illustrations_detected": true;
- кратко опиши потенциал визуальных заданий в "illustrations_note";
- не скрывай CLICK и DRAW в not_recommended, если они реально нужны для покрытия;
- ясно укажи, что такие задания создаются вручную в редакторе.
</illustrations_rule>

<output_format>
Верни ответ ровно в таком формате. Не добавляй никакой прозы до или после блоков.
Главная ценность ответа — quality of mapping: educational_units, assessable_anchors, design_candidates, generation_focus и coverage_role.
Если поле count используется, трактуй его как вторичную техническую подсказку для последующей генерации, а не как основной результат анализа.
Поля rationale, coverage_role, generation_focus и reason должны быть короткими и содержательными (1 предложение каждое). Поле count_rationale опционально и допустимо только как вторичное пояснение.

<human_summary>
2–4 предложения: тема, содержательная плотность, насколько материал структурный, фактический или визуальный, какие есть ограничения.
</human_summary>

<analysis_json>
{
  "material_volume": "small | medium | large",
  "educational_units": [
    {
      "id": 1,
      "title": "...",
      "type": "concept|process|fact|term|classification",
      "description": "...",
      "explicitness": "explicit|inferred",
      "evidence": "...",
      "modality": "text|visual|mixed",
      "assessment_risk": "low|medium|high"
    }
  ],
  "recommendations": [
    {
      "task_type": "TEST|OPEN_ANSWER|SEQUENCE|CLICK_TEXT|CLICK_WORDS|CLICK|DRAW",
      "editor_label": "Exact editor-facing label for this type",
      "recommendation_status": "recommended_auto|recommended_manual|conditionally_recommended",
      "priority": "high|medium|low",
      "covers_units": [1, 2],
      "generation_focus": "Short downstream instruction for the generator of this specific type.",
      "coverage_strategy": "breadth_first|high_risk_first|misconception_first|visual_first|structure_first",
      "assessable_anchors": ["Concrete criteria, contrasts, traps, values or visual markers this type should cover."],
      "design_candidates": ["At least two concrete draft tasks grounded in the material, not abstract themes."],
      "rationale": "Почему этот тип нужен.",
      "coverage_role": "Какой когнитивный угол проверки он закрывает.",
      "count": 3,
      "count_rationale": "Optional secondary downstream hint; omit or keep minimal if not obvious.",
      "manual_only": false,
      "auto_generation_supported": true,
      "manual_authoring": {
        "figure_refs": ["Fig. 2.3", "Рис. 4"],
        "figure_caption_anchor": "Fragment of the figure caption",
        "text_anchor": "Phrase from the material that describes the target visual cue",
        "target_objects": ["What exactly should be clicked or outlined"],
        "polygon_hint": "What should become the polygon or selection zone",
        "task_stem_example": "Example wording of the future visual task",
        "why_visual": "Why a visual task is necessary for full coverage"
      }
    }
  ],
  "not_recommended": [
    {
      "task_type": "...",
      "editor_label": "Exact editor-facing label for this type",
      "recommendation_status": "not_recommended",
      "reason": "Почему этот тип не нужен или не имеет достаточного основания."
    }
  ],
  "illustrations_detected": false,
  "illustrations_note": null,
  "warnings": ["строка предупреждения, если есть"]
}
</analysis_json>
</output_format>

<strictness_addendum>
- Обязательно оцени КАЖДЫЙ доступный тип задания и явно укажи его судьбу: recommendation или not_recommended.
- Тип можно отправить в not_recommended только если ты не смог предложить для него минимум 2 конкретных, правдоподобных design_candidates, прямо привязанных к материалу.
- Для CLICK и DRAW рекомендации недопустимо описывать абстрактно: они должны ссылаться на конкретные рисунки, подписи, текстовые якоря, target_objects и polygon_hint.
- Для CLICK_WORDS учитывай не только числа и термины, но и локально искажаемые критерии, отношения, квалификаторы, отрицания, contrast pairs и направления.
- SEQUENCE рассматривай широко: порядок, группировка, классификация, иерархия, ранжирование и распределение по уровням.
- Главный критерий качества — не количество, а то, насколько конкретно анализ связывает образовательные единицы с типами заданий.
- design_candidates и assessable_anchors должны быть достаточно конкретными, чтобы автор мог на их основе сразу проектировать задания.
- count и count_rationale — только вторичная техническая подсказка для последующей генерации; они не должны доминировать над rationale, coverage_role и generation_focus.
- Если сомневаешься, усиливай generation_focus, coverage_role, assessable_anchors и design_candidates, а не спорь о количестве.
</strictness_addendum>`
            },
            open_answer: {
                title: wt('im.k209', 'Открытый ответ (@OPEN_ANSWER)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k210', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k572', '3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа OPEN_ANSWER — это вопросы со свободным ответом. Студент видит вопрос и пишет ответ своими словами. Система затем сравнивает ответ с эталоном и ключевыми словами. Этот формат развивает глубокое понимание материала, способность формулировать мысли и воспроизводить знания по памяти — в отличие от тестов, где можно угадать ответ.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @OPEN_ANSWER. Извлеки из материала ключевые концепции, определения, причинно-следственные связи и важные факты, превратив их в вопросы, требующие осмысленного ответа.
</task>

<quality_criteria>
- Вопросы проверяют понимание, а не механическое запоминание. Вместо "Перечислите..." используй "Объясните...", "Опишите механизм...", "Почему...", "В чём различие между...".
- Эталонный ответ (строка =) содержит краткий, но полный ответ — он используется преподавателем для оценки.
- Ключевые слова (строки *) — это термины, наличие которых в ответе студента сигнализирует о правильности. Выбирай существенные термины, без которых ответ неполон.
- Каждый вопрос самодостаточен — понятен без контекста других заданий.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @OPEN_ANSWER на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@OPEN_ANSWER
# <вопрос>
= <эталонный ответ>
* <ключевое слово 1>
* <ключевое слово 2>
</output_format>

<example>
@OPEN_ANSWER
# Объясните, почему при пневмонии возникает одышка
= Воспалительный процесс в лёгочной ткани нарушает газообмен в альвеолах, снижая поступление кислорода в кровь, что компенсаторно увеличивает частоту дыхания
* газообмен
* альвеолы
* воспаление

@OPEN_ANSWER
# В чём различие между крупозной и очаговой пневмонией?
= Крупозная пневмония поражает целую долю лёгкого и имеет стадийное течение, очаговая — захватывает отдельные дольки и часто развивается как осложнение бронхита
* доля
* дольки
* стадийное течение
</example>`
            },
            sequence_assembly: {
                title: wt('im.k211', 'Последовательность (@SEQUENCE)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k212', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k572', '3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа SEQUENCE — это упражнения на восстановление правильного порядка. Студент видит перемешанные элементы и выстраивает их в верную последовательность перетаскиванием. Этот формат развивает процедурное мышление, понимание причинно-следственных связей, этапности процессов и хронологии событий.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @SEQUENCE. Выдели из материала процессы, алгоритмы, этапы, хронологические цепочки и классификации с естественным порядком — всё, что имеет логическую последовательность.
</task>

<quality_criteria>
- Каждое задание содержит от 3 до 7 элементов — достаточно для вызова, но не перегружает.
- Правильный порядок должен быть однозначным и обоснованным материалом, без спорных позиций.
- Формулировки элементов краткие и сопоставимые по длине, чтобы порядок нельзя было угадать по форме текста.
- Вопрос в строке # чётко указывает, по какому принципу нужно упорядочить элементы (хронология, этапность, от простого к сложному и т.д.).
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @SEQUENCE на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@SEQUENCE
# <инструкция: что и по какому принципу упорядочить>
element_1: <текст элемента>
element_2: <текст элемента>
element_3: <текст элемента>
level_1: element_1
level_2: element_2
level_3: element_3

Элементы нумеруются последовательно без пропусков (element_1, element_2, ...).
Уровни (level_N) задают правильный порядок, ссылаясь на element_X.
Если два элемента равноправны на одном уровне — перечисли их через запятую: level_2: element_3, element_4.
</output_format>

<example>
@SEQUENCE
# Расположите стадии крупозной пневмонии в порядке их развития
element_1: Стадия прилива
element_2: Стадия красного опеченения
element_3: Стадия серого опеченения
element_4: Стадия разрешения
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4

@SEQUENCE
# Упорядочьте действия врача при подозрении на пневмонию
element_1: Сбор жалоб и анамнеза
element_2: Физикальный осмотр и аускультация
element_3: Назначение рентгенографии грудной клетки
element_4: Забор мокроты на анализ
element_5: Назначение антибактериальной терапии
level_1: element_1
level_2: element_2
level_3: element_3
level_4: element_4
level_5: element_5
</example>`
            },
            test: {
                title: wt('im.k213', 'Тест (@TEST)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k214', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k572', '3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа TEST — это тестовые вопросы с вариантами ответов. Студент выбирает один или несколько правильных вариантов из предложенных. Тесты позволяют быстро проверить знание фактов, понимание терминологии и способность различать верные и ложные утверждения. Это самый распространённый формат контроля знаний.
</task_context>

<task>
Преобразуй предоставленный материал в тестовые вопросы формата @TEST. Охвати ключевые факты, определения, классификации и клинически значимые детали из материала. Варьируй сложность: от прямых вопросов на знание фактов до вопросов, требующих сопоставления и анализа.
</task>

<quality_criteria>
- На каждый вопрос 4 варианта ответа. Среди них 1–2 правильных и 2–3 неправильных.
- Неправильные варианты (дистракторы) должны быть правдоподобными — это реальные термины или утверждения из смежных тем, а не абсурдные варианты, которые легко отсеять.
- Формулировки всех вариантов сопоставимы по длине и стилю, чтобы правильный ответ не выделялся визуально.
- Вопросы покрывают разные аспекты материала, избегая повторов.
- Вопросы с несколькими правильными ответами помечай несколькими "+".
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @TEST на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@TEST
# <название теста>
? <вопрос>
+ <правильный ответ>
- <неправильный ответ>
- <неправильный ответ>
- <неправильный ответ>

Каждый вопрос начинается с "?". Правильные ответы — "+", неправильные — "-".
</output_format>

<example>
@TEST
# Контрольные вопросы: пневмония
? Какой возбудитель наиболее часто вызывает внебольничную пневмонию?
+ Streptococcus pneumoniae
- Pseudomonas aeruginosa
- Klebsiella pneumoniae
- Mycobacterium tuberculosis
? Какие из перечисленных методов применяются для диагностики пневмонии?
+ Рентгенография органов грудной клетки
+ Бактериологический анализ мокроты
- Электроэнцефалография
- Колоноскопия
? Что характерно для крупозной пневмонии в отличие от очаговой?
+ Поражение целой доли лёгкого
- Поражение отдельных долек
- Постепенное начало на фоне ОРВИ
- Отсутствие лихорадки
</example>`
            },
            click_text: {
                title: wt('im.k215', 'Ошибки — выбор из вариантов (@CLICK_TEXT)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k216', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k572', '3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_TEXT — это упражнения на классификацию утверждений. Студент видит список утверждений и должен кликнуть на верные (или неверные — в зависимости от инструкции). Все варианты отображаются как равноправные карточки, студент отмечает нужные. Этот формат развивает критическое мышление и способность отличать достоверную информацию от заблуждений.
</task_context>

<task>
Преобразуй предоставленный материал в задания формата @CLICK_TEXT. Для каждого задания сформулируй набор утверждений, часть которых верна, а часть содержит распространённые ошибки, заблуждения или неточности по теме материала.
</task>

<quality_criteria>
- Каждое задание содержит 4–7 утверждений: часть верных (+), часть неверных (-).
- Неверные утверждения основаны на типичных заблуждениях или подменах понятий, а не на очевидных нелепостях.
- Все утверждения относятся к одной теме, указанной в вопросе.
- Формулировки утверждений сопоставимы по длине и стилю.
- Вопрос в строке # однозначно указывает задачу: выбрать верные, выбрать неверные, или выбрать характерные признаки.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_TEXT на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_TEXT
# <вопрос или инструкция>
+ <верное утверждение>
+ <верное утверждение>
- <неверное утверждение>
- <неверное утверждение>

Верные утверждения — "+", неверные — "-".
</output_format>

<example>
@CLICK_TEXT
# Выберите верные утверждения о внебольничной пневмонии
+ Наиболее частый возбудитель — пневмококк
+ Характерны лихорадка, кашель и одышка
+ Рентгенография — основной метод подтверждения диагноза
- Антибиотики назначают только после получения результатов посева
- Вирусная пневмония всегда протекает легче бактериальной
- Пневмония не может развиться у молодых здоровых людей

@CLICK_TEXT
# Укажите, какие осложнения характерны для пневмонии
+ Плеврит
+ Абсцесс лёгкого
+ Дыхательная недостаточность
- Язвенная болезнь желудка
- Глаукома
</example>`
            },
            click_words: {
                title: wt('im.k217', 'Ошибки — поиск ошибок в тексте (@CLICK_WORDS)'),
                instructions: `${wt('im.k570', '1. Скопируйте промпт и отправьте его ИИ-агенту.')}
${wt('im.k218', '2. Прикрепите файл с материалом (PDF, DOCX) или вставьте текст после промпта.')}
${wt('im.k572', '3. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}`,
                prompt: `Ты — генератор заданий для образовательной платформы.

<task_context>
Задания типа CLICK_WORDS — это упражнения на поиск ошибок в тексте. Студент читает текст, в котором намеренно допущены фактические ошибки, и кликает на слова или фразы, которые считает неверными. Этот формат развивает внимательное чтение, критический анализ информации и глубокое владение материалом — студент должен не просто знать правильный ответ, но и распознать, где именно текст искажает факты.
</task_context>

<task>
На основе предоставленного материала создай задания формата @CLICK_WORDS. Для каждого задания напиши связный текст из 2–4 предложений, в котором большая часть информации верна, но 2–4 слова или фразы заменены на фактически неверные. Ошибки должны быть содержательными, а не орфографическими.
</task>

<quality_criteria>
- Текст читается как связный и осмысленный параграф — ошибки не должны быть очевидны без знания материала.
- Ошибки — это подмены фактов: неправильные числа, перепутанные термины, инверсия причинно-следственных связей, неверные характеристики.
- Ошибочные фрагменты обёрнуты в [квадратные скобки]. В скобки заключается именно неверное слово или фраза, минимально необходимая для идентификации ошибки.
- Верная часть текста должна быть действительно верной — проверяй факты.
- Каждое задание содержит 2–4 ошибки, равномерно распределённых по тексту.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @CLICK_WORDS на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки заданий, без пояснений и без Markdown.

@CLICK_WORDS
# <инструкция: что именно искать>
text: <связный текст, где ошибочные фрагменты обёрнуты в [квадратные скобки]>
</output_format>

<example>
@CLICK_WORDS
# Найдите фактические ошибки в описании пневмонии
text: Пневмония — это воспалительное заболевание лёгких, чаще всего вызываемое [грибками]. Основные симптомы включают кашель, лихорадку и [отсутствие одышки]. Для подтверждения диагноза назначают [УЗИ органов брюшной полости]. Лечение бактериальной пневмонии проводится антибиотиками.

@CLICK_WORDS
# Найдите ошибки в описании кровообращения
text: Сердце человека состоит из [трёх] камер. Артерии несут кровь от сердца к органам, а вены — от органов к сердцу. Малый круг кровообращения проходит через [печень], где происходит газообмен. В норме частота сердечных сокращений взрослого человека составляет [40–50] ударов в минуту.
</example>`
            }
        };
    }

    getDirectAIAgentTemplateOptions() {
        const options = this.getAIAgentTemplateOptions();
        const { material_analysis, ...directOnly } = options;
        return directOnly;
    }

    updateAIAgentPromptTextarea() {
        const textarea = document.getElementById('ai-agent-prompt-textarea');
        const instructionsEl = document.getElementById('ai-agent-instructions');
        if (!textarea) return;
        const active = this.getActiveAIAgentTemplateConfig();
        textarea.value = active.prompt;
        if (instructionsEl) {
            instructionsEl.innerHTML = `
                <div class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-info text-[18px] mt-0.5">lightbulb</span>
                    <div class="text-xs text-info-text whitespace-pre-line">${this.escapeHtml(active.instructions)}</div>
                </div>
            `;
        }
    }

    async copyAIAgentPrompt() {
        try {
            const active = this.getActiveAIAgentTemplateConfig();
            await this.writeToClipboard(active.prompt);
            this.showToast(wt('im.k219', 'Промпт для ИИ-агента скопирован в буфер обмена.'), 'success');
        } catch (error) {
            this.showToast(wt('im.k220', 'Не удалось скопировать промпт. Скопируйте текст вручную.'), 'error');
        }
    }

    async pasteImportTextFromClipboard() {
        const textArea = document.getElementById('import-text-area');
        if (!textArea) return;

        try {
            const text = await this.readFromClipboard();
            if (typeof text !== 'string' || !text.length) {
                this.showToast(wt('im.k221', 'Буфер обмена пуст.'), 'warning');
                return;
            }
            textArea.value = text;
            this.sourceText = text;
            if (this.aiTemplateType === 'material_analysis') {
                this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
            }
            this._updateLiveCounter(text);
            this.showToast(wt('im.k222', 'Текст из буфера обмена вставлен.'), 'success');
        } catch (error) {
            this.showToast(wt('im.k223', 'Не удалось прочитать буфер обмена. Используйте Ctrl+V.'), 'warning');
        }
    }

    async writeToClipboard(text) {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'fixed';
        temp.style.opacity = '0';
        document.body.appendChild(temp);
        temp.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(temp);
        if (!ok) throw new Error('copy_failed');
    }

    async readFromClipboard() {
        if (navigator?.clipboard?.readText) {
            return navigator.clipboard.readText();
        }
        throw new Error('clipboard_read_not_supported');
    }

    // showToast is defined above in the class

    updateTopicSelect() {
        const topicSelect = document.getElementById('import-topic-select');
        if (!topicSelect) return;

        const module = this.dashboard.catalog.find(m => m.id === this.selectedModule);

        if (!module || !module.topics) {
            topicSelect.disabled = true;
            topicSelect.innerHTML = '';
            const option = document.createElement('option');
            option.value = '';
            option.textContent = wt('im.k224', 'Модуль не содержит тем...');
            topicSelect.appendChild(option);
            return;
        }

        topicSelect.disabled = false;
        topicSelect.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = wt('im.k225', 'Выберите тему...');
        topicSelect.appendChild(placeholder);

        (module.topics || []).forEach((topic) => {
            const option = document.createElement('option');
            option.value = String(topic?.id || '');
            option.textContent = String(topic?.name || topic?.id || '');
            topicSelect.appendChild(option);
        });

        // Restore selection
        if (this.selectedTopic) {
            topicSelect.value = this.selectedTopic;
        }
    }

    // =========================================================================
    // API Calls
    // =========================================================================

    async parseText(text, moduleId, topicId) {
        try {
            const response = await fetch('/api/editor/import/parse', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    text: text
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Parse error:', error);
            throw error;
        }
    }

    async _readErrorResponse(response) {
        let payload = null;
        try {
            payload = await response.clone().json();
        } catch (_) {
            payload = null;
        }

        if (payload && typeof payload === 'object') {
            const message = payload.message || payload.error || payload.details;
            if (message) {
                return String(message);
            }
        }

        try {
            const rawText = await response.text();
            if (rawText && rawText.trim()) {
                return rawText.trim();
            }
        } catch (_) {
            // Ignore body-read errors and fall back to status text below.
        }

        return `HTTP error! status: ${response.status}`;
    }

    async parseManualAnalysisText(text) {
        try {
            const response = await fetch('/api/editor/import/parse-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text }),
            });

            if (!response.ok) {
                throw new Error(await this._readErrorResponse(response));
            }

            return await response.json();
        } catch (error) {
            console.error('Manual analysis parse error:', error);
            throw error;
        }
    }

    async executeImport(moduleId, topicId, tasks, options = {}) {
        try {
            const response = await fetch('/api/editor/import/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    tasks: tasks,
                    import_context: options.importContext || null,
                    idempotency_key: options.idempotencyKey || null,
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            return await response.json();
        } catch (error) {
            console.error('Import error:', error);
            throw error;
        }
    }

    // =========================================================================
    // Actions
    // =========================================================================

    async handleNext() {
        if (this.hasActiveWorkspaceImportFlow()) {
            if (this.currentStep === 3) {
                this.nextStep();
                return;
            }
            if (this.currentStep === 4) {
                if (this.getWorkspaceImportExecutePayload()?.ok) {
                    await this.openWorkspaceImportResultComplex();
                    return;
                }
                await this.handleImport();
                return;
            }
        }
        if (this.currentStep === 1) {
            if (this.importMode === 'ai') {
                if (!this.selectedModule || !this.selectedTopic) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('im.k226', 'Переход к промптам приостановлен.'),
                        impact: wt('im.k227', 'Модуль и тема не выбраны.'),
                        next: wt('im.k228', 'Выберите модуль и тему, затем продолжите.'),
                    });
                    return;
                }
                if (!this.isInternalAiGenerationInDevelopment()) {
                    this.nextStep();
                    this.aiAnalyze().catch(e => console.error('[AI] analyze failed:', e));
                    return;
                }
                this.nextStep();
                return;
            }

            if (this.importMode === 'text') {
                // Validate step 1 Text
                if (!this.selectedModule || !this.selectedTopic) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('im.k229', 'Переход к парсингу приостановлен.'),
                        impact: wt('im.k230', 'Модуль и тема не выбраны.'),
                        next: wt('im.k231', 'Выберите модуль и тему, затем продолжите импорт.'),
                    });
                    return;
                }
                this.nextStep();
            } else {
                // Validate step 1 Archive
                if (!this.uploadedFile) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('im.k232', 'Проверка архива не запущена.'),
                        impact: wt('im.k233', 'Файл архива не выбран.'),
                        next: wt('im.k234', 'Выберите архив и повторите проверку.'),
                    });
                    return;
                }
                // Go to Step 2 (Validation Spinner) which automatically triggers Step 3
                this.nextStep();

                // Trigger validation
                try {
                    const formData = new FormData();
                    formData.append('file', this.uploadedFile);

                    const response = await fetch('/api/editor/import/check', {
                        method: 'POST',
                        body: formData
                    });
                    const result = await response.json();

                    if (result.ok) {
                        this.parsedResult = result; // Reuse parsedResult structure
                        this.archiveCacheId = result.cache_id || null;
                        this.importRequestKey = null;
                        this.nextStep(); // Go to Step 3 (Preview)
                    } else {
                        this.showVoiceToast({
                            severity: 'error',
                            what: wt('im.k235', 'Проверка архива завершилась ошибкой.'),
                            impact: wt('im.k236', 'Предпросмотр не сформирован.'),
                            next: `${wt('im.k676', 'Проверьте архив и повторите проверку. Детали:')} ${result.error || 'unknown_error'}`,
                        });
                        this.prevStep();
                    }
                } catch (e) {
                    this.showVoiceToast({
                        severity: 'error',
                        what: wt('im.k237', 'Проверка архива прервана сетью.'),
                        impact: wt('im.k238', 'Импорт не может перейти к предпросмотру.'),
                        next: `${wt('im.k677', 'Проверьте соединение и повторите проверку. Детали:')} ${e.message}`,
                    });
                    this.prevStep();
                }
            }
        } else if (this.currentStep === 2) {
            if (this.importMode === 'ai' && !this.isInternalAiGenerationInDevelopment()) {
                // AI Step 2 -> Step 3: trigger generation
                this.nextStep();
                this.aiGenerate().catch(e => console.error('[AI] generate failed:', e));
                return;
            }
            if (this.importMode === 'ai' && this.aiTemplateType === 'material_analysis') {
                if (!this.sourceText.trim()) {
                    this.showVoiceToast({
                        severity: 'warning',
                        what: wt('im.k239', 'Разбор анализа не запущен.'),
                        impact: wt('im.k240', 'Поле с ответом ИИ пустое.'),
                        next: wt('im.k241', 'Вставьте ответ внешнего ИИ с блоками <human_summary> и <analysis_json>.'),
                    });
                    return;
                }

                try {
                    const result = await this.parseManualAnalysisText(this.sourceText);
                    if (!result.ok) {
                        this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
                        this.manualAnalysisResult = null;
                        this.parsedResult = {
                            parsing_errors: [result.message || result.error || 'analysis_parse_failed'],
                        };
                        this.renderCurrentStep();
                        return;
                    }

                    this.parsedResult = null;
                    this.createManualAnalysisSession(result);
                    if (this.modalPurpose === 'theory_analysis') {
                        this.theorySubMode = 'coverage_map';
                    }
                    this.showToast(wt('im.k242', 'Анализ материала распознан. Можно выбрать тип задания ниже.'), 'success');
                    this.renderCurrentStep();
                } catch (error) {
                    this.clearManualAnalysisSession({ preserveManualAnalysisResult: false });
                    this.manualAnalysisResult = null;
                    this.parsedResult = {
                        parsing_errors: [wt('im.k243', 'Ошибка разбора анализа: ') + error.message],
                    };
                    this.renderCurrentStep();
                }
                return;
            }

            // Parse text
            if (!this.sourceText.trim()) {
                this.showVoiceToast({
                    severity: 'warning',
                    what: wt('im.k244', 'Парсинг не запущен.'),
                    impact: wt('im.k245', 'Поле с исходным текстом пустое.'),
                    next: wt('im.k246', 'Вставьте текст заданий и повторите действие.'),
                });
                return;
            }

            // Show loading step
            this.nextStep();

            try {
                const result = await this.parseText(this.sourceText, this.selectedModule, this.selectedTopic);

                // Check if parsing was successful
                if (!result.ok) {
                    // Parse failed - show error and go back to step 2
                    this.parsedResult = {
                        parsing_errors: [result.error || 'Unknown parsing error']
                    };
                    this.prevStep();
                    return;
                }

                // Check for critical parsing errors
                if (result.parsing_errors && result.parsing_errors.length > 0) {
                    this.parsedResult = result;
                    this.prevStep();
                    return;
                }

                // Success - show preview
                this.parsedResult = result;
                this.importRequestKey = null;
                if (this.modalPurpose === 'theory_analysis') {
                    this.theorySubMode = 'task_preview';
                }
                if (this.importMode === 'ai') {
                    const selectedTaskType = this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType);
                    if (selectedTaskType) {
                        this.setManualAnalysisSelectedTaskType(selectedTaskType);
                        this.storeManualAnalysisDraft(selectedTaskType, {
                            sourceText: this.sourceText,
                            parsedResult: result,
                        });
                    }
                }
                this.renderCurrentStep();
            } catch (error) {
                // Network or other error
                this.parsedResult = {
                    parsing_errors: [wt('im.k247', 'Ошибка парсинга: ') + error.message]
                };
                this.prevStep();
            }
        } else if (this.currentStep === 3) {
            // Go to confirmation
            this.nextStep();
        } else if (this.currentStep === 4) {
            // Execute import
            await this.handleImport();
        }
    }

    async handleImport() {
        if (this.importInProgress) {
            return;
        }
        this.importInProgress = true;
        this.updateNavigationButtons();
        try {
            if (this.hasActiveWorkspaceImportFlow()) {
                const result = await this.executeWorkspaceImportFlow();
                if (result?.ok) {
                    const taskCount = Number(result?.summary?.total_nodes?.tasks || result?.result?.tasks?.length || 0);
                    this.recordImportHistory({
                        status: 'ok',
                        imported: taskCount,
                        skipped: 0,
                        errors: 0,
                        message: 'workspace_import',
                    });
                    this.showVoiceToast({
                        severity: 'success',
                        what: wt('im.k248', 'Рабочая версия добавлена.'),
                        impact: `${wt('im.k678', 'Заданий в рабочей версии:')} ${taskCount}.`,
                        next: wt('im.k249', 'Каталог будет обновлён, после чего можно открыть импортированную версию в рабочем пространстве.'),
                    });
                    try {
                        if (this.dashboard && typeof this.dashboard.loadWorkspaceLimits === 'function') {
                            this.dashboard.loadWorkspaceLimits().catch(() => {});
                        }
                        if (this.dashboard && typeof this.dashboard.loadCatalog === 'function') {
                            await this.dashboard.loadCatalog();
                        }
                    } catch (error) {
                        console.warn('[ImportManager] Failed to refresh catalog after workspace import:', error);
                    }
                    this.renderCurrentStep();
                    this.updateNavigationButtons();
                } else {
                    this.recordImportHistory({
                        status: 'error',
                        imported: 0,
                        skipped: 0,
                        errors: 1,
                        message: result?.error || 'workspace_import_failed',
                    });
                    this.showVoiceToast({
                        severity: 'error',
                        what: wt('im.k250', 'Workspace-импорт завершился ошибкой.'),
                        impact: wt('im.k251', 'Рабочая версия не была создана полностью.'),
                        next: `${wt('im.k679', 'Проверьте source lineage и повторите добавление. Детали:')} ${result?.error || 'workspace_import_failed'}`,
                    });
                }
                return;
            }
            if (this.importMode === 'text' || this.importMode === 'ai') {
                const validTasks = this.getPreviewImportableTasks();
                if (validTasks.length === 0) {
                    this.showToast(wt('im.k252', 'После проверки не осталось заданий, которые можно импортировать.'), 'warning');
                    return;
                }
                if (!this.importRequestKey) {
                    this.importRequestKey = this._makeIdempotencyKey();
                }
                const activeSession = this.getActiveManualAnalysisSession();
                const selectedTaskType = this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType);
                const selectedRecommendation = selectedTaskType ? this.getManualAnalysisRecommendation(selectedTaskType) : null;
                const importContext = this.importMode === 'ai'
                    ? {
                        source: 'ai',
                        ai_origin: 'external_prompt',
                        analysis_session_id: activeSession?.id || null,
                        analysis_selected_task_type: selectedTaskType || null,
                        analysis_selected_units: Array.isArray(selectedRecommendation?.covers_units) ? selectedRecommendation.covers_units : [],
                        analysis_generation_focus: selectedRecommendation?.generation_focus || null,
                        analysis_coverage_role: selectedRecommendation?.coverage_role || null,
                    }
                    : { source: 'text' };
                const result = await this.executeImport(this.selectedModule, this.selectedTopic, validTasks, {
                    importContext,
                    idempotencyKey: this.importRequestKey,
                });
                if (result.ok) {
                    this.recordImportHistory({
                        status: 'ok',
                        imported: result.imported,
                        skipped: result.skipped || 0,
                        errors: result.errors || 0,
                        message: 'text_or_ai',
                    });
                    if (this.importMode === 'ai' && activeSession && selectedTaskType) {
                        this.showVoiceToast({
                            severity: 'success',
                            what: wt('im.k253', 'Импорт завершён.'),
                            impact: `${wt('im.k680', 'Добавлено:')} ${result.imported}.`,
                            next: wt('im.k254', 'Сессия анализа сохранена. Можно выбрать следующий тип задания в карте покрытия.'),
                        });
                        this.setManualAnalysisSelectedTaskType(selectedTaskType);
                        this.clearManualAnalysisDraft(selectedTaskType, {
                            status: 'imported',
                            imported_count: Math.max(0, Number((activeSession.recommendation_state?.[selectedTaskType]?.imported_count || 0))) + Number(result.imported || 0),
                            imported_batches: Math.max(0, Number((activeSession.recommendation_state?.[selectedTaskType]?.imported_batches || 0))) + 1,
                            last_imported_at: new Date().toISOString(),
                        });
                        this.sourceText = '';
                        this.parsedResult = null;
                        this.excludedTasks.clear();
                        this.selectedTasks.clear();
                        this.importRequestKey = null;
                        this.currentStep = 2;
                        this.theorySubMode = 'coverage_map';
                        if (this.dashboard && typeof this.dashboard.loadWorkspaceLimits === 'function') {
                            this.dashboard.loadWorkspaceLimits().catch(() => {});
                        }
                        await this.dashboard.loadCatalog();
                        this.showToast(wt('im.k255', 'Тип импортирован. Можно продолжить с другим типом в карте покрытия ниже.'), 'success');
                        this.renderCurrentStep();
                        this.updateNavigationButtons();
                    } else {
                        this.showVoiceToast({
                            severity: 'success',
                            what: wt('im.k256', 'Импорт завершён.'),
                            impact: `${wt('im.k680', 'Добавлено:')} ${result.imported}.`,
                            next: wt('im.k257', 'Каталог обновлён, можно переходить к редактуре.'),
                        });
                        if (this.dashboard && typeof this.dashboard.loadWorkspaceLimits === 'function') {
                            this.dashboard.loadWorkspaceLimits().catch(() => {});
                        }
                        this.dashboard.closeImportModal({ skipConfirm: true });
                        this.dashboard.loadCatalog();
                    }
                } else {
                    this.recordImportHistory({
                        status: 'error',
                        imported: 0,
                        skipped: 0,
                        errors: 1,
                        message: result.error || 'import_failed',
                    });
                    this.showVoiceToast({
                        severity: 'error',
                        what: wt('im.k258', 'Импорт завершился ошибкой.'),
                        impact: wt('im.k259', 'Изменения в каталог не были применены полностью.'),
                        next: `${wt('im.k681', 'Проверьте источник и повторите импорт. Детали:')} ${result.error || 'unknown_error'}`,
                    });
                }
            } else {
                // Archive Import
                const conflictRes = document.getElementById('conflict-resolution-select')?.value || 'skip';
                const skipErrors = document.getElementById('skip-errors-checkbox')?.checked || false;
                if (this.getPreviewImportableTasks().length === 0) {
                    this.showToast(wt('im.k260', 'В архиве не осталось заданий, которые можно импортировать.'), 'warning');
                    return;
                }
                if (!this.importRequestKey) {
                    this.importRequestKey = this._makeIdempotencyKey();
                }

                const formData = new FormData();
                if (this.archiveCacheId) {
                    formData.append('cache_id', this.archiveCacheId);
                } else {
                    formData.append('file', this.uploadedFile);
                }
                formData.append('idempotency_key', this.importRequestKey);
                formData.append('conflict_resolution', conflictRes);
                formData.append('skip_errors', skipErrors.toString());
                if (this.selectedModule) formData.append('target_module_id', this.selectedModule);
                if (this.selectedTopic) formData.append('target_topic_id', this.selectedTopic);
                // Per-task conflict overrides
                if (this.perTaskConflictRes.size > 0) {
                    const overrides = {};
                    this.perTaskConflictRes.forEach((v, k) => { overrides[k] = v; });
                    formData.append('per_task_conflict', JSON.stringify(overrides));
                }
                // Excluded tasks
                if (this.excludedTasks.size > 0) {
                    formData.append('excluded_tasks', JSON.stringify(Array.from(this.excludedTasks)));
                }

                // UI Loading State
                const btn = document.querySelector('[data-role="import-next"]');
                const originalText = await this._getButtonContent(btn);
                if (btn) {
                    btn.disabled = true;
                    btn.textContent = wt('im.k261', 'Импорт...');
                }

                // Create visual progress bar
                const progressContainer = document.createElement('div');
                progressContainer.id = 'import-progress-bar-container';
                progressContainer.className = 'mt-4 px-2';
                progressContainer.innerHTML = `
                    <div class="flex items-center justify-between text-sm text-text-secondary mb-1">
                        <span id="import-progress-label">${wt('im.k931', 'Подготовка...')}</span>
                        <span id="import-progress-percent">0%</span>
                    </div>
                    <div class="w-full bg-surface-alt rounded-full h-3 overflow-hidden">
                        <div id="import-progress-fill" class="h-full bg-primary rounded-full transition-all duration-300 ease-out" style="width: 0%"></div>
                    </div>
                `;
                const stepContent = document.querySelector('#import-step-content') || btn?.parentElement;
                if (stepContent) stepContent.appendChild(progressContainer);

                try {
                    const response = await fetch('/api/editor/import/confirm', {
                        method: 'POST',
                        body: formData
                    });

                    if (!response.ok || !response.body) {
                        let errorText = `HTTP ${response.status || 'import_failed'}`;
                        try {
                            const errorData = await response.json();
                            errorText = errorData?.error || errorText;
                        } catch (_) {
                            // ignore JSON parse errors
                        }
                        throw new Error(errorText);
                    }

                    const reader = response.body.getReader();
                    const decoder = new TextDecoder();
                    let buffer = '';
                    let finalResult = null;

                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;

                        buffer += decoder.decode(value, { stream: true });
                        const lines = buffer.split('\n');
                        buffer = lines.pop();

                        for (const line of lines) {
                            if (!line.trim()) continue;
                            try {
                                const msg = JSON.parse(line);
                                if (msg.type === 'progress') {
                                    const pct = Math.round((msg.current / (msg.total || 1)) * 100);
                                    const fill = document.getElementById('import-progress-fill');
                                    const label = document.getElementById('import-progress-label');
                                    const pctEl = document.getElementById('import-progress-percent');
                                    if (fill) fill.style.width = `${pct}%`;
                                    if (label) label.textContent = msg.status || `${wt('im.k665', 'Задание')} ${msg.current} ${wt('im.k682', 'из')} ${msg.total}`;
                                    if (pctEl) pctEl.textContent = `${pct}%`;
                                    if (btn) btn.textContent = `${wt('im.k683', 'Импорт...')} ${pct}%`;
                                } else if (msg.type === 'result') {
                                    finalResult = msg.data;
                                } else if (msg.type === 'error') {
                                    throw new Error(msg.error);
                                }
                            } catch (e) {
                                console.error("Error parsing stream line:", e);
                            }
                        }
                    }

                    if (finalResult) {
                        if (finalResult.ok) {
                            this.recordImportHistory({
                                status: finalResult.errors > 0 ? 'partial' : 'ok',
                                imported: finalResult.imported,
                                skipped: finalResult.skipped,
                                errors: finalResult.errors,
                                message: 'archive_stream',
                            });
                            this.showVoiceToast({
                                severity: finalResult.errors > 0 ? 'warning' : 'success',
                                what: wt('im.k262', 'Импорт архива завершён.'),
                                impact: `${wt('im.k680', 'Добавлено:')} ${finalResult.imported}, ${wt('im.k684', 'пропущено:')} ${finalResult.skipped}, ${wt('im.k685', 'ошибок:')} ${finalResult.errors}.`,
                                next: finalResult.errors > 0
                                    ? wt('im.k263', 'Проверьте проблемные задания и при необходимости повторите импорт.')
                                    : wt('im.k264', 'Каталог обновлён и готов к работе.'),
                            });
                            if (this.dashboard && typeof this.dashboard.loadWorkspaceLimits === 'function') {
                                this.dashboard.loadWorkspaceLimits().catch(() => {});
                            }
                            this.dashboard.closeImportModal({ skipConfirm: true });
                            this.dashboard.loadCatalog();
                        } else {
                            const errorMsg = finalResult.rollback
                                ? `${wt('im.k686', 'Ошибка импорта (выполнен откат):')} ${finalResult.error_message || finalResult.error}`
                                : `${wt('im.k687', 'Ошибка импорта:')} ${finalResult.error}`;
                            this.recordImportHistory({
                                status: 'error',
                                imported: 0,
                                skipped: 0,
                                errors: 1,
                                message: errorMsg,
                            });
                            this.showVoiceToast({
                                severity: 'error',
                                what: wt('im.k265', 'Импорт архива завершился ошибкой.'),
                                impact: finalResult.rollback
                                    ? wt('im.k266', 'Откат выполнен, каталог сохранён в прежнем состоянии.')
                                    : wt('im.k267', 'Часть изменений могла не примениться.'),
                                next: wt('im.k268', 'Исправьте проблему в архиве и повторите импорт.'),
                            });
                        }
                    }
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.textContent = originalText || wt('im.k269', 'Импортировать');
                    }
                    const pc = document.getElementById('import-progress-bar-container');
                    if (pc) pc.remove();
                }
            }
        } catch (error) {
            this.recordImportHistory({
                status: 'error',
                imported: 0,
                skipped: 0,
                errors: 1,
                message: error.message,
            });
            this.showVoiceToast({
                severity: 'error',
                what: wt('im.k270', 'Импорт прерван из-за ошибки.'),
                impact: wt('im.k271', 'Операция не завершена.'),
                next: `${wt('im.k688', 'Проверьте соединение и входные данные. Детали:')} ${error.message}`,
            });
        }
        this.importInProgress = false;
        this.updateNavigationButtons();
    }

    _getButtonContent(btn) {
        return btn ? btn.textContent : '';
    }

    // =========================================================================
    // Bulk Actions
    // =========================================================================

    toggleSelectAll() {
        const tasks = this.parsedResult?.tasks || [];
        const checkbox = document.getElementById('select-all-tasks');

        if (checkbox.checked) {
            // Select all
            tasks.forEach((_, index) => {
                this.selectedTasks.add(index);
            });
        } else {
            // Deselect all
            this.selectedTasks.clear();
        }

        // Re-render to update checkboxes
        this.renderCurrentStep();
    }

    toggleTaskSelection(index) {
        if (this.selectedTasks.has(index)) {
            this.selectedTasks.delete(index);
        } else {
            this.selectedTasks.add(index);
        }

        // Update select-all checkbox state
        const tasks = this.parsedResult?.tasks || [];
        const selectAllCheckbox = document.getElementById('select-all-tasks');
        if (selectAllCheckbox) {
            selectAllCheckbox.checked = this.selectedTasks.size === tasks.length && tasks.length > 0;
        }

        // Update counter
        this.renderCurrentStep();
    }

    bulkExclude() {
        if (this.selectedTasks.size === 0) return;

        // Add all selected tasks to excluded set
        this.selectedTasks.forEach(index => {
            this.excludedTasks.add(index);
        });

        // Clear selection
        this.selectedTasks.clear();

        // Re-render
        this.renderCurrentStep();
    }

    bulkInclude() {
        if (this.selectedTasks.size === 0) return;

        // Remove all selected tasks from excluded set
        this.selectedTasks.forEach(index => {
            this.excludedTasks.delete(index);
        });

        // Clear selection
        this.selectedTasks.clear();

        // Re-render
        this.renderCurrentStep();
    }

    // =========================================================================
    // AI Generation Mode
    // =========================================================================

    renderTheoryAnalysisMode() {
        const contentArea = document.querySelector('[data-role="import-content"]');
        if (!contentArea) return;
        const shouldCapture = !this.skipTheoryViewStateCaptureOnce;
        this.skipTheoryViewStateCaptureOnce = false;
        if (shouldCapture) {
            this.captureTheoryAnalysisViewState();
        }
        contentArea.innerHTML = this.renderTheoryAnalysisLayout();
        this.attachStepEventListeners();
        this.attachAIComposerEventListeners();
        this.applyPresetSelection();
        this.applyTheoryReportPanelState();
        this.restoreTheoryAnalysisViewState();
    }

    captureTheoryAnalysisViewState() {
        if (this.modalPurpose !== 'theory_analysis') return;

        const textarea = document.getElementById('ai-material-textarea');
        if (textarea) {
            this.theoryComposerViewState = {
                scrollTop: textarea.scrollTop || 0,
                selectionStart: typeof textarea.selectionStart === 'number' ? textarea.selectionStart : null,
                selectionEnd: typeof textarea.selectionEnd === 'number' ? textarea.selectionEnd : null,
                wasFocused: document.activeElement === textarea,
            };
        }

        const reportBody = document.querySelector('[data-role="theory-analysis-report-body"]');
        if (reportBody) {
            this.theoryReportScrollTop = reportBody.scrollTop || 0;
        }
    }

    restoreTheoryAnalysisViewState() {
        if (this.modalPurpose !== 'theory_analysis') return;

        const textarea = document.getElementById('ai-material-textarea');
        const state = this.theoryComposerViewState;
        if (textarea && state) {
            if (typeof state.scrollTop === 'number') {
                textarea.scrollTop = state.scrollTop;
            }
            if (typeof state.selectionStart === 'number' && typeof state.selectionEnd === 'number') {
                try {
                    textarea.selectionStart = state.selectionStart;
                    textarea.selectionEnd = state.selectionEnd;
                } catch (_) { }
            }
            if (state.wasFocused) {
                try {
                    textarea.focus({ preventScroll: true });
                } catch (_) {
                    textarea.focus();
                }
            }
        }

        const reportBody = document.querySelector('[data-role="theory-analysis-report-body"]');
        if (reportBody && this.theoryReportPanelOpen) {
            reportBody.scrollTop = this.theoryReportScrollTop || 0;
        }
    }

    applyTheoryReportPanelState() {
        const panel = document.querySelector('[data-role="theory-analysis-report-panel"]');
        if (!panel) return;

        const isOpen = this.theoryReportPanelOpen !== false;
        const body = panel.querySelector('[data-role="theory-analysis-report-body"]');
        const collapsedNote = panel.querySelector('[data-role="theory-analysis-report-collapsed"]');
        const toggleBtn = panel.querySelector('[data-role="theory-report-toggle-btn"]');
        const toggleLabel = panel.querySelector('[data-role="theory-report-toggle-label"]');
        const toggleIcon = panel.querySelector('[data-role="theory-report-toggle-icon"]');

        if (body) body.classList.toggle('hidden', !isOpen);
        if (collapsedNote) collapsedNote.classList.toggle('hidden', isOpen);
        if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(isOpen));
        if (toggleLabel) toggleLabel.textContent = isOpen ? wt('im.k272', 'Свернуть отчёт') : wt('im.k273', 'Открыть отчёт');
        if (toggleIcon) toggleIcon.textContent = isOpen ? 'expand_less' : 'expand_more';
        panel.classList.toggle('ring-1', isOpen);
        panel.classList.toggle('ring-primary/20', isOpen);

        if (isOpen && body) {
            body.scrollTop = this.theoryReportScrollTop || 0;
        }
    }

    toggleTheoryAnalysisReportPanel(forceOpen = null) {
        const body = document.querySelector('[data-role="theory-analysis-report-body"]');
        if (body) {
            this.theoryReportScrollTop = body.scrollTop || 0;
        }

        if (typeof forceOpen === 'boolean') {
            this.theoryReportPanelOpen = forceOpen;
        } else {
            this.theoryReportPanelOpen = !(this.theoryReportPanelOpen !== false);
        }

        this.applyTheoryReportPanelState();
    }

    renderTheoryAnalysisLayout() {
        const analysisSessionModes = new Set(['analysis', 'home', 'archive', 'coverage_map', 'task_generation', 'task_preview']);
        if (analysisSessionModes.has(this.theorySubMode) && this.isTheoryExternalAnalysisFallback()) {
            return this.renderTheoryExternalAnalysisLayout();
        }
        const isMicrocardsMode = this.theorySubMode === 'microcards';
        const isManualEditor = this.theorySubMode === 'manual_editor';
        const isTextImport = this.theorySubMode === 'text_import';
        const titles = {
            microcards: wt('im.k274', 'Режим микрокарточек (P9)'),
            manual_editor: wt('im.k275', 'Редактор микрокарточек'),
            text_import: wt('im.k276', 'Импорт микрокарточек из текста'),
            analysis: wt('im.k277', 'Отдельный режим анализа теории'),
        };
        const subtitles = {
            microcards: wt('im.k278', 'Повторение по колодам из анализа. Колоды общие на устройстве, прогресс — персональный.'),
            manual_editor: wt('im.k279', 'Создание и редактирование колод вручную. Колоды общие на устройстве, а прогресс повторения остаётся персональным.'),
            text_import: wt('im.k280', 'Импорт карточек из @MICROCARD или ответа внешнего ИИ-агента в общую библиотеку колод. Прогресс повторения остаётся персональным.'),
            analysis: wt('im.k281', 'Запуск анализа без генерации и импорта. История сохраняется по <code class="font-mono">ai_run_id</code>.'),
        };
        const currentMode = isTextImport ? 'text_import' : (isManualEditor ? 'manual_editor' : (isMicrocardsMode ? 'microcards' : 'analysis'));
        const isMcSubMode = isMicrocardsMode || isManualEditor || isTextImport;
        const showHeader = isMcSubMode;

        const mcNavButtons = (activeMode) => {
            const modes = [
                { key: 'microcards', label: wt('im.k282', 'Повторение'), fn: 'openTheoryMicrocardsMode()' },
                { key: 'manual_editor', label: wt('im.k283', 'Редактор'), fn: 'openManualMicrocardsEditor()' },
                { key: 'text_import', label: wt('im.k284', 'Текстовый импорт'), fn: 'openMicrocardsTextImport()' },
            ];
            return modes.filter(m => m.key !== activeMode).map(m =>
                `<button onclick="dashboard.importManager.${m.fn}"
                    class="editor-flow-button-wrap px-3 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                    ${m.label}
                </button>`
            ).join('');
        };

        return `
            <div class="w-full animate-slide-up-fade">
                ${showHeader ? `
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
                        <div>
                            <h3 class="text-lg font-bold text-text-main">${titles[currentMode]}</h3>
                            <p class="editor-flow-wrap text-sm text-text-secondary">${subtitles[currentMode]}</p>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button onclick="dashboard.importManager.enterTheorySubMode('analysis')"
                                class="editor-flow-button-wrap px-3 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                                ${wt('im.k574', 'К анализу')}
                            </button>
                            ${mcNavButtons(currentMode)}
                            <button onclick="dashboard.importManager.loadMicrocardsDecks()"
                                class="editor-flow-button-wrap px-3 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary hover:text-primary-fg transition-colors">
                                ${wt('im.k575', 'Обновить колоды')}
                            </button>
                        </div>
                    </div>
                ` : ''}

                ${isTextImport ? this.renderMicrocardsTextImport() : (isManualEditor ? this.renderManualMicrocardsEditor() : `
                    <div class="grid grid-cols-1 xl:grid-cols-[1.35fr_0.85fr] gap-5">
                        <div class="space-y-4">
                            ${isMicrocardsMode ? this.renderTheoryMicrocardsMode() : `${this.renderTheoryAnalysisComposer()}${this.renderTheoryAnalysisResultPanel()}`}
                        </div>
                        <div>
                            ${this.renderTheoryAnalysisRunsPanel()}
                        </div>
                    </div>
                `)}
            </div>
        `;
    }

    renderTheoryExternalAnalysisLayout() {
        const session = this.getActiveManualAnalysisSession();
        const hasSession = !!session?.analysis?.ok;
        if (this.theorySubMode === 'home' && hasSession) {
            return `
                <div class="w-full animate-slide-up-fade space-y-5">
                    ${this.renderTheoryAnalysisHomeScreen()}
                </div>
            `;
        }
        if (this.theorySubMode === 'archive') {
            return `
                <div class="w-full animate-slide-up-fade space-y-5">
                    ${this.renderTheoryAnalysisArchiveScreen()}
                </div>
            `;
        }
        const isPromptStep = this.currentStep <= 2;
        const isPreviewStep = this.currentStep === 3;
        const isImportStep = this.currentStep === 4;
        const isCoverageMap = this.aiTemplateType === 'material_analysis';
        const stageLabel = isImportStep
            ? wt('im.k285', 'Шаг 3: импорт')
            : (isPreviewStep
                ? wt('im.k286', 'Шаг 2: предпросмотр')
                : (isCoverageMap
                    ? (hasSession ? wt('im.k287', 'Шаг 1: карта покрытия') : wt('im.k288', 'Шаг 1: анализ материала'))
                    : wt('im.k289', 'Шаг 2: генерация типа')));
        const primaryActionLabel = isImportStep
            ? (this.importInProgress ? wt('im.k290', 'Импорт...') : wt('im.k291', 'Импортировать'))
            : (isPreviewStep ? wt('im.k292', 'К импорту') : (isCoverageMap ? wt('im.k293', 'Разобрать анализ') : wt('im.k294', 'Проверить текст')));
        const primaryActionDisabled = this.importInProgress || this.aiAnalyzing || this.aiGenerating;

        return `
            <div class="w-full animate-slide-up-fade space-y-5">
                <div class="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
                    <div class="inline-flex items-center gap-2 rounded-full border border-border-subtle bg-surface-2 px-3 py-1 text-xs font-semibold text-text-secondary">
                        ${this.escapeHtml(stageLabel)}
                    </div>
                    ${hasSession && !isCoverageMap ? `
                        <button onclick="dashboard.importManager.returnToManualAnalysisCoverageMap()"
                            class="px-4 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                            ${wt('im.k576', 'К карте покрытия')}
                        </button>
                    ` : ''}
                </div>

                ${!hasSession && this.getManualAnalysisArchive().length ? `
                    <div class="max-w-3xl mx-auto rounded-xl border border-border-subtle bg-surface-1 p-4 flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <div class="text-sm font-semibold text-text-main">${wt('im.k932', 'В архиве есть сохранённые анализы')}</div>
                            <div class="text-xs text-text-secondary mt-1">
                                ${wt('im.k577', 'Можно открыть предыдущий анализ вместо запуска нового.')}
                            </div>
                        </div>
                        <button onclick="dashboard.importManager.openTheoryAnalysisArchive()"
                            class="px-4 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                            ${wt('im.k578', 'Открыть архив')}
                        </button>
                    </div>
                ` : ''}

                ${isPromptStep ? `
                    <div class="max-w-3xl mx-auto rounded-xl border border-border-subtle bg-surface-1 p-4 space-y-4">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                            <div>
                                <div class="text-sm font-bold text-text-main">${wt('im.k933', 'Целевой контекст')}</div>
                                <div class="text-xs text-text-secondary mt-1">
                                    ${wt('im.k579', 'Все созданные задания будут импортированы в выбранный модуль и тему.')}
                                </div>
                            </div>
                            ${hasSession ? `
                                <div class="text-xs text-text-secondary text-right">
                                    <div>Session: <span class="font-semibold text-text-main">${this.escapeHtml(session.id)}</span></div>
                                    <div>${wt('im.k295', 'Режим: <span class="font-semibold text-text-main">')}${this.escapeHtml(isCoverageMap ? 'анализ и карта покрытия' : this.getEditorFacingTaskTypeLabel(this.getTaskTypeForAIAgentTemplateKey(this.aiTemplateType)))}</span></div>
                                </div>
                            ` : ''}
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k854', 'Целевой модуль')}</label>
                                <select id="import-module-select"
                                    class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                                    ${this.renderModuleOptions(this.dashboard.catalog || [], wt('im.k296', 'Выберите модуль...'))}
                                </select>
                            </div>
                            <div>
                                <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k855', 'Целевая тема')}</label>
                                <select id="import-topic-select"
                                    class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                                    disabled>
                                    <option value="">${wt('im.k856', 'Сначала выберите модуль...')}</option>
                                </select>
                            </div>
                        </div>
                    </div>
                ` : ''}

                ${isPromptStep ? this.renderStep2() : (isPreviewStep ? this.renderStep3() : this.renderStep4())}

                <div class="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
                    <div class="flex flex-wrap gap-2">
                        ${isPreviewStep || isImportStep ? `
                            <button onclick="dashboard.importManager.prevStep()"
                                class="px-4 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                                ${wt('im.k580', 'Назад')}
                            </button>
                        ` : ''}
                    </div>
                    <button onclick="dashboard.importManager.handleNext()"
                        class="px-5 py-2.5 text-sm font-bold rounded-lg bg-primary text-primary-contrast hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        ${primaryActionDisabled ? 'disabled' : ''}>
                        ${primaryActionLabel}
                    </button>
                </div>
            </div>
        `;
    }

    renderTheoryAiInProgressPlaceholder() {
        return `
            <div class="w-full animate-slide-up-fade">
                <div class="rounded-2xl border border-border-strong bg-surface-1 p-6 lg:p-8 shadow-sm">
                    <div class="w-full">
                        <div class="inline-flex items-center gap-2 rounded-full border border-warning-light bg-warning-lighter px-3 py-1 text-xs font-semibold uppercase tracking-[0.08em] text-warning-text">
                            ${wt('im.k297', 'В разработке')}
                        </div>
                        <h3 class="mt-4 text-xl font-bold text-text-main">${wt('im.k297', 'В разработке')}</h3>
                        <p class="mt-3 w-full max-w-none text-sm leading-6 text-text-secondary text-justify">
                            ${wt('im.k298', 'Внутренняя ИИ-генерация и связанные сценарии временно прикрыты единым placeholder-состоянием.')}
                            ${wt('im.k299', 'В этом разделе пока не доступны запуск анализа, история прогонов и остальные встроенные AI-потоки.')}
                        </p>
                    </div>
                </div>
            </div>
        `;
    }

    enterTheorySubMode(mode) {
        const validModes = ['microcards', 'manual_editor', 'text_import', 'analysis', 'home', 'archive'];
        const nextMode = validModes.includes(mode) ? mode : 'analysis';
        if (!this.isTheoryFeatureEnabled('ai_mode', false)) {
            this.openTheoryAiInProgressPlaceholder();
            return;
        }
        if ((nextMode === 'microcards' || nextMode === 'manual_editor' || nextMode === 'text_import') && !this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k581', 'Режим микрокарточек отключён (feature flag).'))) {
            return;
        }
        this.theorySubMode = nextMode;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    async openTheoryMicrocardsMode(initialDeckId = null) {
        if (!this.isTheoryFeatureEnabled('ai_mode', false)) {
            return this.openTheoryAiInProgressPlaceholder();
        }
        if (!this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k300', 'Режим микрокарточек отключён (feature flag).'))) {
            return { ok: false, error: 'microcards_mode_disabled' };
        }
        this.theorySubMode = 'microcards';
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        await this.loadMicrocardsDecks();
        if (initialDeckId) {
            await this.openMicrocardsDeckQueue(initialDeckId);
        }
    }

    async loadMicrocardsDecks() {
        this.microcardsDecksLoading = true;
        this.microcardsDecksError = '';
        if (this.modalPurpose === 'theory_analysis' && this.theorySubMode === 'microcards') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch('/api/v2/microcards/decks?limit=100');
            const data = await resp.json();
            if (data.ok) {
                // V2 summaries → the field shape this panel has always rendered.
                this.microcardsDecks = (Array.isArray(data.items) ? data.items : []).map(d => ({
                    ...d,
                    stats: {
                        cards_due: d.due_count ?? 0,
                        cards_new: d.new_count ?? 0,
                        cards_total: d.card_count ?? 0,
                    },
                    meta: { created_by_user_id: d.created_by_user_id || null },
                }));
                this.microcardsDecksError = '';
            } else {
                this.microcardsDecks = [];
                this.microcardsDecksError = data.message || data.error || wt('im.k301', 'Не удалось загрузить колоды');
            }
            return data;
        } catch (e) {
            console.error('[Microcards] load decks failed:', e);
            this.microcardsDecks = [];
            this.microcardsDecksError = wt('im.k302', 'Ошибка сети при загрузке колод');
            return { ok: false, error: 'network_error' };
        } finally {
            this.microcardsDecksLoading = false;
            if (this.modalPurpose === 'theory_analysis' && this.theorySubMode === 'microcards') this.renderTheoryAnalysisMode();
        }
    }

    async createMicrocardsDeckFromCurrentAnalysis(selector = {}, opts = {}) {
        if (!this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k303', 'Режим микрокарточек отключён (feature flag).'))) {
            return { ok: false, error: 'microcards_mode_disabled' };
        }
        if (selector?.pair_match_only && !this.ensureTheoryFeatureEnabled('microcards_pair_match', wt('im.k304', 'pair_match отключён (feature flag).'))) {
            return { ok: false, error: 'microcards_pair_match_disabled' };
        }
        const runId = String(this.aiRunId || this.analysisResult?.ai_run_id || '').trim();
        if (!runId) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('im.k305', 'Создание колоды приостановлено.'),
                impact: wt('im.k306', 'Не найден открытый анализ (ai_run_id).'),
                next: wt('im.k307', 'Сначала откройте анализ, затем повторите создание колоды.'),
            });
            return { ok: false, error: 'ai_run_id_required' };
        }
        this.microcardsCreateLoading = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch('/api/v2/microcards/decks/from-analysis', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_run_id: runId, selector }),
            });
            const data = await resp.json();
            if (data.ok) {
                this.showVoiceToast({
                    severity: 'success',
                    what: wt('im.k308', 'Колода микрокарточек создана.'),
                    impact: `${wt('im.k689', 'Добавлено карточек:')} ${data.deck_summary?.cards_total || 0}.`,
                    next: wt('im.k309', 'Можно открыть колоду и начать повторение.'),
                });
                await this.loadMicrocardsDecks();
                if (opts?.open !== false && data.deck?.id) {
                    await this.openTheoryMicrocardsMode(data.deck.id);
                }
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('im.k310', 'Создание колоды завершилось ошибкой.'),
                    impact: wt('im.k311', 'Новая колода не была сохранена.'),
                    next: data.message || data.error || wt('im.k312', 'Проверьте входные данные и повторите создание.'),
                });
            }
            return data;
        } catch (e) {
            console.error('[Microcards] create deck failed:', e);
            this.showVoiceToast({
                severity: 'error',
                what: wt('im.k313', 'Создание колоды недоступно из-за сетевой ошибки.'),
                impact: wt('im.k314', 'Операция не была завершена.'),
                next: wt('im.k315', 'Проверьте сеть и повторите попытку.'),
            });
            return { ok: false, error: 'network_error' };
        } finally {
            this.microcardsCreateLoading = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    createTheoryMicrocardsDeckAll() {
        return this.createMicrocardsDeckFromCurrentAnalysis({ scope: 'all' }, { open: true });
    }

    createTheoryMicrocardsDeckForChunk(chunkId) {
        const cid = String(chunkId || '').trim();
        if (!cid) return Promise.resolve({ ok: false, error: 'chunk_id_required' });
        return this.createMicrocardsDeckFromCurrentAnalysis({ scope: 'chunk', chunk_id: cid }, { open: true });
    }

    createTheoryMicrocardsDeckForUnit(unitId, chunkId = null) {
        const uid = Number(unitId);
        if (!Number.isFinite(uid)) return Promise.resolve({ ok: false, error: 'unit_id_required' });
        const selector = { scope: 'unit', unit_id: uid };
        if (chunkId) selector.chunk_id = String(chunkId);
        return this.createMicrocardsDeckFromCurrentAnalysis(selector, { open: true });
    }

    createTheoryMicrocardsPairMatchDeck() {
        if (!this.ensureTheoryFeatureEnabled('microcards_pair_match', wt('im.k316', 'pair_match отключён (feature flag).'))) {
            return Promise.resolve({ ok: false, error: 'microcards_pair_match_disabled' });
        }
        return this.createMicrocardsDeckFromCurrentAnalysis({ scope: 'all', pair_match_only: true }, { open: true });
    }

    async pickExistingMicrocardsDeckId() {
        if (!Array.isArray(this.microcardsDecks) || this.microcardsDecks.length === 0) {
            await this.loadMicrocardsDecks();
        }
        const decks = Array.isArray(this.microcardsDecks) ? this.microcardsDecks : [];
        if (!decks.length) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('im.k317', 'Добавление в существующую колоду недоступно.'),
                impact: wt('im.k318', 'Список колод пуст.'),
                next: wt('im.k319', 'Сначала создайте новую колоду из текущего анализа.'),
            });
            return null;
        }
        const defaultId = String(this.microcardsActiveDeck?.id || decks[0]?.id || '').trim();
        const preview = decks.slice(0, 8).map((d) => `${d.id} — ${d.name || d.id}`).join('\n');
        const raw = window.prompt(`${wt('im.k690', 'Введите ID колоды для добавления карточек:')}\n\n${preview}${decks.length > 8 ? `\n... и ещё ${decks.length - 8}` : ''}`, defaultId);
        if (raw == null) return null;
        const picked = String(raw || '').trim();
        if (!picked) return null;
        return picked;
    }

    async appendMicrocardsToExistingDeckFromCurrentAnalysis(selector = {}, opts = {}) {
        if (!this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k320', 'Режим микрокарточек отключён (feature flag).'))) {
            return { ok: false, error: 'microcards_mode_disabled' };
        }
        if (selector?.pair_match_only && !this.ensureTheoryFeatureEnabled('microcards_pair_match', wt('im.k321', 'pair_match отключён (feature flag).'))) {
            return { ok: false, error: 'microcards_pair_match_disabled' };
        }
        const runId = String(this.aiRunId || this.analysisResult?.ai_run_id || '').trim();
        if (!runId) {
            this.showVoiceToast({
                severity: 'warning',
                what: wt('im.k322', 'Добавление карточек приостановлено.'),
                impact: wt('im.k323', 'Не найден открытый анализ (ai_run_id).'),
                next: wt('im.k324', 'Откройте анализ и повторите операцию.'),
            });
            return { ok: false, error: 'ai_run_id_required' };
        }
        const deckId = String(opts.deckId || '').trim() || await this.pickExistingMicrocardsDeckId();
        if (!deckId) return { ok: false, error: 'deck_id_required' };
        this.microcardsCreateLoading = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deckId)}/append-from-analysis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ai_run_id: runId, selector }),
            });
            const data = await resp.json();
            if (data.ok) {
                this.showVoiceToast({
                    severity: 'success',
                    what: wt('im.k325', 'Карточки добавлены в колоду.'),
                    impact: `${wt('im.k680', 'Добавлено:')} ${data.added_cards || 0}, ${wt('im.k691', 'пропущено дублей:')} ${data.skipped_duplicates || 0}.`,
                    next: wt('im.k326', 'Можно открыть очередь колоды и продолжить повторение.'),
                });
                await this.loadMicrocardsDecks();
                if (opts?.open !== false) {
                    await this.openTheoryMicrocardsMode(deckId);
                }
            } else {
                this.showVoiceToast({
                    severity: 'error',
                    what: wt('im.k327', 'Добавление карточек завершилось ошибкой.'),
                    impact: wt('im.k328', 'Колода не была обновлена.'),
                    next: data.message || data.error || wt('im.k329', 'Проверьте параметры и повторите попытку.'),
                });
            }
            return data;
        } catch (e) {
            console.error('[Microcards] append to deck failed:', e);
            this.showVoiceToast({
                severity: 'error',
                what: wt('im.k330', 'Добавление карточек недоступно из-за сетевой ошибки.'),
                impact: wt('im.k331', 'Изменения в колоду не сохранены.'),
                next: wt('im.k332', 'Проверьте сеть и повторите попытку.'),
            });
            return { ok: false, error: 'network_error' };
        } finally {
            this.microcardsCreateLoading = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    appendTheoryMicrocardsDeckAll() {
        return this.appendMicrocardsToExistingDeckFromCurrentAnalysis({ scope: 'all' }, { open: true });
    }

    appendTheoryMicrocardsDeckForChunk(chunkId) {
        const cid = String(chunkId || '').trim();
        if (!cid) return Promise.resolve({ ok: false, error: 'chunk_id_required' });
        return this.appendMicrocardsToExistingDeckFromCurrentAnalysis({ scope: 'chunk', chunk_id: cid }, { open: true });
    }

    appendTheoryMicrocardsDeckForUnit(unitId, chunkId = null) {
        const uid = Number(unitId);
        if (!Number.isFinite(uid)) return Promise.resolve({ ok: false, error: 'unit_id_required' });
        const selector = { scope: 'unit', unit_id: uid };
        if (chunkId) selector.chunk_id = String(chunkId);
        return this.appendMicrocardsToExistingDeckFromCurrentAnalysis(selector, { open: true });
    }

    appendTheoryMicrocardsPairMatchDeck() {
        if (!this.ensureTheoryFeatureEnabled('microcards_pair_match', wt('im.k333', 'pair_match отключён (feature flag).'))) {
            return Promise.resolve({ ok: false, error: 'microcards_pair_match_disabled' });
        }
        return this.appendMicrocardsToExistingDeckFromCurrentAnalysis({ scope: 'all', pair_match_only: true }, { open: true });
    }

    // D1: the embedded mini-player is gone — runs/reviews live in the
    // Microcards mode, which the deep link opens right on the deck.
    openMicrocardsDeckQueue(deckId) {
        const id = String(deckId || '').trim();
        if (!id) return { ok: false, error: 'deck_id_required' };
        window.open(`/microcards?deck=${encodeURIComponent(id)}`, '_blank');
        return { ok: true, deep_link: true };
    }

    renderTheoryMicrocardsMode() {
        const decks = Array.isArray(this.microcardsDecks) ? this.microcardsDecks : [];

        const deckListHtml = this.microcardsDecksLoading
            ? `<div class="text-sm text-text-secondary">${wt('im.k934', 'Загрузка колод...')}</div>`
            : (decks.length ? `
                <div class="space-y-2">
                    ${decks.map((deck) => {
                        const isActive = String(deck?.id || '') === String(activeDeck?.id || '');
                        const stats = deck?.stats || {};
                        const ownershipBadges = this.renderMicrocardsDeckOwnershipBadges(deck);
                        return `
                            <div class="rounded-lg border ${isActive ? 'border-primary bg-primary-lighter/20' : 'border-border-strong bg-surface-2'} p-3">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0">
                                        <div class="text-xs font-semibold text-text-main truncate">${this.escapeHtml(String(deck?.name || deck?.id || 'Deck'))}</div>
                                        <div class="text-[11px] text-text-secondary mt-1 font-mono truncate">${this.escapeHtml(String(deck?.id || ''))}</div>
                                        ${ownershipBadges ? `<div class="mt-2 flex flex-wrap gap-1">${ownershipBadges}</div>` : ''}
                                        <div class="text-[11px] text-text-secondary mt-1">
                                            ${wt('im.k692', 'к повторению:')} ${this.escapeHtml(String(stats.cards_due ?? 0))} · ${wt('im.k693', 'новые:')} ${this.escapeHtml(String(stats.cards_new ?? 0))} · ${wt('im.k694', 'всего:')} ${this.escapeHtml(String(stats.cards_total ?? 0))}
                                        </div>
                                    </div>
                                    <button type="button"
                                        onclick="dashboard.importManager.openMicrocardsDeckQueue('${this.escapeInlineJsString(String(deck?.id || ''))}')"
                                        class="px-2.5 py-1.5 text-xs font-medium rounded-md border ${isActive ? 'border-primary text-primary bg-primary-lighter' : 'border-border-strong text-text-secondary hover:bg-bg-hover'}">
                                        ${wt('im.k946', 'Открыть в Микрокарточках')}
                                    </button>
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            ` : `<div class="text-sm text-text-secondary">${wt('im.k695', 'Колод пока нет. Создайте их из отчёта анализа.')}</div>`);

        return `
            <div class="space-y-4">
                <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                    <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                        <div>
                            <div class="text-sm font-semibold text-text-main">${wt('im.k935', 'Колоды микрокарточек')}</div>
                            <div class="text-xs text-text-secondary mt-1">${wt('im.k936', 'Контент колод общий на устройстве; прогресс повторения считается отдельно для каждого пользователя.')}</div>
                        </div>
                        <div class="flex flex-wrap gap-2">
                            <button type="button"
                                onclick="dashboard.importManager.createTheoryMicrocardsDeckAll()"
                                ${this.microcardsCreateLoading ? 'disabled' : ''}
                                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-primary text-primary hover:bg-primary hover:text-primary-fg disabled:opacity-60">
                                ${this.microcardsCreateLoading ? wt('im.k696', 'Создание...') : wt('im.k697', 'Колода из анализа')}
                            </button>
                            <button type="button"
                                onclick="dashboard.importManager.appendTheoryMicrocardsDeckAll()"
                                ${this.microcardsCreateLoading ? 'disabled' : ''}
                                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover disabled:opacity-60">
                                ${wt('im.k341', 'Добавить в колоду...')}
                            </button>
                            <button type="button"
                                onclick="dashboard.importManager.createTheoryMicrocardsPairMatchDeck()"
                                ${this.microcardsCreateLoading ? 'disabled' : ''}
                                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-info-light text-info-text bg-info-lighter hover:bg-info-light disabled:opacity-60">
                                ${wt('im.k342', 'pair_match колода')}
                            </button>
                            <button type="button"
                                onclick="dashboard.importManager.appendTheoryMicrocardsPairMatchDeck()"
                                ${this.microcardsCreateLoading ? 'disabled' : ''}
                                class="px-3 py-1.5 text-xs font-medium rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover disabled:opacity-60">
                                ${wt('im.k343', 'pair_match → в колоду...')}
                            </button>
                        </div>
                    </div>
                    ${this.microcardsDecksError ? `<div class="mt-3 text-xs text-error-text">${this.escapeHtml(this.microcardsDecksError)}</div>` : ''}
                    <div class="mt-4">${deckListHtml}</div>
                </div>

                <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                    <div class="text-sm font-semibold text-text-main">${wt('im.k947', 'Прохождение и повторение — в режиме «Микрокарточки»')}</div>
                    <div class="text-xs text-text-secondary mt-1">${wt('im.k948', 'У колод там три режима (Просмотр, Повторение, Прохождение на звёзды), импорт и полноценный редактор. Кнопка «Открыть в Микрокарточках» ведёт прямо на колоду.')}</div>
                </div>
            </div>
        `;
    }

    // ── M11: Manual Microcards Editor ────────────────────────────────

    async openManualMicrocardsEditor() {
        if (!this.isTheoryFeatureEnabled('ai_mode', false)) {
            return this.openTheoryAiInProgressPlaceholder();
        }
        if (!this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k366', 'Режим микрокарточек отключён (feature flag).'))) {
            return;
        }
        this.setModalPurpose('theory_analysis');
        this.theorySubMode = 'manual_editor';
        this.manualEditorCardForm = null;
        this.manualEditorPreviewCard = null;
        this.renderTheoryAnalysisMode();
        await this.loadMicrocardsDecks();
    }

    async manualEditorOpenDeck(deckId) {
        const id = String(deckId || '').trim();
        if (!id) return;
        this.manualEditorDeckLoading = true;
        this.manualEditorCardForm = null;
        this.manualEditorPreviewCard = null;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(id)}`);
            const data = await resp.json();
            if (data.ok && data.deck) {
                this.manualEditorDeck = data.deck;
            } else {
                this.showToast(data.error || wt('im.k367', 'Не удалось загрузить колоду'), 'error');
            }
        } catch (e) {
            console.error('[M11] load deck failed:', e);
            this.showToast(wt('im.k368', 'Ошибка сети'), 'error');
        } finally {
            this.manualEditorDeckLoading = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    async manualEditorCreateDeck() {
        const nameEl = document.getElementById('m11DeckNameInput');
        const name = String(nameEl?.value || '').trim();
        if (!name) { this.showToast(wt('im.k369', 'Введите название колоды'), 'warning'); return; }
        this.manualEditorSaving = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch('/api/v2/microcards/decks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await resp.json();
            if (data.ok) {
                this.showToast(wt('im.k370', 'Колода создана'), 'success');
                await this.loadMicrocardsDecks();
                if (data.deck?.id) await this.manualEditorOpenDeck(data.deck.id);
            } else {
                this.showToast(data.error || wt('im.k371', 'Не удалось создать колоду'), 'error');
            }
        } catch (e) {
            console.error('[M11] create deck failed:', e);
            this.showToast(wt('im.k372', 'Ошибка сети'), 'error');
        } finally {
            this.manualEditorSaving = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    async manualEditorRenameDeck(deckId) {
        const nameEl = document.getElementById('m11RenameInput');
        const name = String(nameEl?.value || '').trim();
        if (!name) { this.showToast(wt('im.k373', 'Введите новое название'), 'warning'); return; }
        this.manualEditorSaving = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deckId)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name }),
            });
            const data = await resp.json();
            if (data.ok) {
                this.showToast(wt('im.k374', 'Колода переименована'), 'success');
                this.manualEditorRenamingDeckId = null;
                await this.loadMicrocardsDecks();
                if (this.manualEditorDeck?.id === deckId) {
                    this.manualEditorDeck.name = name;
                }
            } else {
                this.showToast(data.error || wt('im.k375', 'Не удалось переименовать'), 'error');
            }
        } catch (e) {
            console.error('[M11] rename deck failed:', e);
            this.showToast(wt('im.k376', 'Ошибка сети'), 'error');
        } finally {
            this.manualEditorSaving = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }


    async manualEditorDeleteDeck(deckId) {
        const confirmed = await this.confirmAction({
            title: wt('im.k381', 'Удалить колоду?'),
            message: wt('im.k382', 'Это действие необратимо.'),
            confirmText: wt('im.k383', 'Удалить'),
            cancelText: wt('im.k384', 'Отмена'),
            variant: 'error',
        });
        if (!confirmed) return;
        try {
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deckId)}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.ok) {
                this.showToast(wt('im.k385', 'Колода удалена'), 'success');
                if (this.manualEditorDeck?.id === deckId) this.manualEditorDeck = null;
                await this.loadMicrocardsDecks();
            } else {
                this.showToast(data.error || wt('im.k386', 'Не удалось удалить'), 'error');
            }
        } catch (e) {
            console.error('[M11] delete deck failed:', e);
            this.showToast(wt('im.k387', 'Ошибка сети'), 'error');
        }
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    manualEditorEditCardFromEncoded(encodedCardJson) {
        try {
            const parsed = JSON.parse(String(encodedCardJson || ''));
            this.manualEditorShowCardForm('edit', parsed);
        } catch (error) {
            console.error('[M11] decode card payload failed:', error);
            this.showToast(wt('im.k388', 'Не удалось открыть карточку для редактирования.'), 'error');
        }
    }

    manualEditorShowCardForm(mode = 'create', card = null) {
        // M15: detect pair_match card type and extract pairs for editing
        const cardType = String(card?.card_type || 'fact_recall');
        let pairs = [{ left: '', right: '' }, { left: '', right: '' }];
        if (cardType === 'pair_match' && card) {
            const frontPayload = (card.front && typeof card.front.payload === 'object') ? card.front.payload : {};
            const backPayload = (card.back && typeof card.back.payload === 'object') ? card.back.payload : {};
            const leftItems = Array.isArray(frontPayload.left_items) ? frontPayload.left_items : [];
            const pairLinks = Array.isArray(backPayload.pairs) ? backPayload.pairs : [];
            const rightById = {};
            if (Array.isArray(frontPayload.right_items)) {
                for (const ri of frontPayload.right_items) rightById[String(ri.id || '')] = String(ri.text || '');
            }
            const extracted = [];
            for (const pl of pairLinks) {
                const lid = String(pl.left_id || '');
                const rid = String(pl.right_id || '');
                const leftObj = leftItems.find(l => String(l.id || '') === lid);
                const leftText = leftObj ? String(leftObj.text || '') : '';
                const rightText = rightById[rid] || '';
                if (leftText || rightText) extracted.push({ left: leftText, right: rightText });
            }
            if (extracted.length >= 2) pairs = extracted;
        }
        this.manualEditorCardForm = {
            mode,
            card_id: card?.id || null,
            card_type: cardType,
            front_text: (card?.front?.text || ''),
            back_text: (card?.back?.text || ''),
            pairs: pairs,
            tags: Array.isArray(card?.tags) ? card.tags.join(', ') : '',
            difficulty_hint: card?.difficulty_hint || 'medium',
        };
        this.manualEditorPreviewCard = null;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    manualEditorCancelCardForm() {
        this.manualEditorCardForm = null;
        this.manualEditorPreviewCard = null;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    manualEditorPreviewCurrentCard() {
        const form = this.manualEditorCardForm;
        const isPairMatch = form && form.card_type === 'pair_match';
        const frontEl = document.getElementById('m11CardFront');
        const ft = String(frontEl?.value || '').trim();

        if (isPairMatch) {
            // M15: pair_match preview — read pairs from DOM
            if (!ft) { this.showToast(wt('im.k389', 'Заполните инструкцию (лицевая сторона)'), 'warning'); return; }
            const pairs = this._m15ReadPairsFromDOM();
            const validPairs = pairs.filter(p => p.left && p.right);
            if (validPairs.length < 2) { this.showToast(wt('im.k390', 'Заполните минимум 2 пары (левая и правая часть)'), 'warning'); return; }
            const leftItems = validPairs.map((p, i) => ({ id: `l${i + 1}`, text: p.left }));
            const rightItems = validPairs.map((p, i) => ({ id: `r${i + 1}`, text: p.right }));
            const pairLinks = validPairs.map((_, i) => ({ left_id: `l${i + 1}`, right_id: `r${i + 1}` }));
            this.manualEditorPreviewCard = {
                card_type: 'pair_match',
                front: { text: ft, payload: { mode: 'pair_match', left_items: leftItems, right_items: rightItems, shuffle_right: true } },
                back: { text: wt('im.k391', 'Правильные соответствия'), payload: { mode: 'pair_match_solution', pairs: pairLinks, explanations: [] } },
            };
        } else {
            const backEl = document.getElementById('m11CardBack');
            const bt = String(backEl?.value || '').trim();
            if (!ft || !bt) { this.showToast(wt('im.k392', 'Заполните лицевую и обратную стороны'), 'warning'); return; }
            this.manualEditorPreviewCard = {
                card_type: 'fact_recall',
                front: { text: ft },
                back: { text: bt },
            };
        }
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    _m15ReadPairsFromDOM() {
        const pairs = [];
        let idx = 0;
        while (true) {
            const leftEl = document.getElementById(`m15PairLeft_${idx}`);
            const rightEl = document.getElementById(`m15PairRight_${idx}`);
            if (!leftEl && !rightEl) break;
            pairs.push({
                left: String(leftEl?.value || '').trim(),
                right: String(rightEl?.value || '').trim(),
            });
            idx++;
        }
        return pairs;
    }

    _m15AddPair() {
        const form = this.manualEditorCardForm;
        if (!form) return;
        // Sync current DOM values into form state before mutating
        form.pairs = this._m15ReadPairsFromDOM();
        if (form.pairs.length >= 5) return;
        // Preserve front_text from DOM
        const frontEl = document.getElementById('m11CardFront');
        if (frontEl) form.front_text = frontEl.value;
        form.pairs.push({ left: '', right: '' });
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    _m15RemovePair(index) {
        const form = this.manualEditorCardForm;
        if (!form) return;
        form.pairs = this._m15ReadPairsFromDOM();
        if (form.pairs.length <= 2) return;
        const frontEl = document.getElementById('m11CardFront');
        if (frontEl) form.front_text = frontEl.value;
        form.pairs.splice(index, 1);
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    async manualEditorSaveCard() {
        const form = this.manualEditorCardForm;
        if (!form) return;
        const deckId = String(this.manualEditorDeck?.id || '').trim();
        if (!deckId) { this.showToast(wt('im.k393', 'Колода не выбрана'), 'warning'); return; }

        const frontEl = document.getElementById('m11CardFront');
        const backEl = document.getElementById('m11CardBack');
        const tagsEl = document.getElementById('m11CardTags');
        const diffEl = document.getElementById('m11CardDifficulty');

        const front_text = String(frontEl?.value || '').trim();
        if (!front_text) { this.showToast(wt('im.k394', 'Заполните лицевую сторону'), 'warning'); return; }

        const tagsRaw = String(tagsEl?.value || '').trim();
        const tags = tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [];
        const difficulty_hint = String(diffEl?.value || 'medium');

        const isPairMatch = form.card_type === 'pair_match';
        if (isPairMatch) {
            this.showToast(wt('im.k949', 'pair_match-карточки больше не поддерживаются: пары хранятся как обычные «вопрос → ответ».'), 'warning');
            return;
        }

        // M15: pair_match validation
        let pairs = null;
        let back_text = '';
        if (isPairMatch) {
            pairs = this._m15ReadPairsFromDOM().filter(p => p.left && p.right);
            if (pairs.length < 2) { this.showToast(wt('im.k395', 'Заполните минимум 2 пары (левая и правая часть)'), 'warning'); return; }
            if (pairs.length > 5) { this.showToast(wt('im.k396', 'Максимум 5 пар'), 'warning'); return; }
            const lefts = pairs.map(p => p.left);
            const rights = pairs.map(p => p.right);
            if (new Set(lefts).size !== lefts.length) { this.showToast(wt('im.k397', 'Левые элементы пар не должны повторяться'), 'warning'); return; }
            if (new Set(rights).size !== rights.length) { this.showToast(wt('im.k398', 'Правые элементы пар не должны повторяться'), 'warning'); return; }
        } else {
            back_text = String(backEl?.value || '').trim();
            if (!back_text) { this.showToast(wt('im.k399', 'Заполните обратную сторону'), 'warning'); return; }
        }

        this.manualEditorSaving = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();

        try {
            let url, method, body;
            if (form.mode === 'edit' && form.card_id) {
                url = `/api/v2/microcards/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(form.card_id)}`;
                method = 'PATCH';
                body = { front_text, back_text };
            } else {
                url = `/api/v2/microcards/decks/${encodeURIComponent(deckId)}/cards`;
                method = 'POST';
                body = { front_text, back_text };
            }
            const resp = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await resp.json();
            if (data.ok) {
                this.showToast(form.mode === 'edit' ? wt('im.k592', 'Карточка обновлена') : wt('im.k593', 'Карточка создана'), 'success');
                this.manualEditorCardForm = null;
                this.manualEditorPreviewCard = null;
                await this.manualEditorOpenDeck(deckId);
            } else {
                const errMap = {
                    duplicate_card: wt('im.k400', 'Такая карточка уже существует (дубликат)'),
                    pair_match_min_2_pairs: wt('im.k401', 'Минимум 2 пары'),
                    pair_match_max_5_pairs: wt('im.k402', 'Максимум 5 пар'),
                    pair_match_duplicate_left: wt('im.k403', 'Левые элементы пар не должны повторяться'),
                    pair_match_duplicate_right: wt('im.k404', 'Правые элементы пар не должны повторяться'),
                    not_pair_match_card: wt('im.k405', 'Эта карточка не является pair_match'),
                };
                const msg = errMap[data.error] || data.error || wt('im.k406', 'Ошибка сохранения');
                this.showToast(msg, 'error');
            }
        } catch (e) {
            console.error('[M15] save card failed:', e);
            this.showToast(wt('im.k407', 'Ошибка сети'), 'error');
        } finally {
            this.manualEditorSaving = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    async manualEditorDeleteCard(cardId) {
        const deckId = String(this.manualEditorDeck?.id || '').trim();
        if (!deckId || !cardId) return;
        const confirmed = await this.confirmAction({
            title: wt('im.k408', 'Удалить карточку?'),
            message: wt('im.k409', 'Карточка будет удалена без возможности восстановления.'),
            confirmText: wt('im.k410', 'Удалить'),
            cancelText: wt('im.k411', 'Отмена'),
            variant: 'error',
        });
        if (!confirmed) return;
        try {
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deckId)}/cards/${encodeURIComponent(cardId)}`, { method: 'DELETE' });
            const data = await resp.json();
            if (data.ok) {
                this.showToast(wt('im.k412', 'Карточка удалена'), 'success');
                await this.manualEditorOpenDeck(deckId);
            } else {
                this.showToast(data.error || wt('im.k413', 'Ошибка удаления'), 'error');
            }
        } catch (e) {
            console.error('[M11] delete card failed:', e);
            this.showToast(wt('im.k414', 'Ошибка сети'), 'error');
        }
    }

    async manualEditorMoveCard(cardId, direction) {
        const deck = this.manualEditorDeck;
        if (!deck?.cards?.length) return;
        const ids = deck.cards.map(c => c?.id).filter(Boolean);
        const idx = ids.indexOf(cardId);
        if (idx < 0) return;
        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= ids.length) return;
        [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
        try {
            await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deck.id)}/cards/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ card_ids: ids }),
            });
            await this.manualEditorOpenDeck(deck.id);
        } catch (e) {
            console.error('[M11] reorder failed:', e);
            this.showToast(wt('im.k415', 'Ошибка сети'), 'error');
        }
    }

    // ── M12: Microcards Text Import ────────────────────────────────

    async openMicrocardsTextImport() {
        if (!this.isTheoryFeatureEnabled('ai_mode', false)) {
            return this.openTheoryAiInProgressPlaceholder();
        }
        if (!this.ensureTheoryFeatureEnabled('microcards_mode', wt('im.k416', 'Режим микрокарточек отключён (feature flag).'))) {
            return;
        }
        this.theorySubMode = 'text_import';
        this.mcImportParsedResult = null;
        this.mcImportExecuteResult = null;
        this.mcImportExecuting = false;
        this.mcImportParsing = false;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        await this.loadMicrocardsDecks();
    }

    getMcImportPromptTemplates() {
        return {
            qa_short: {
                title: wt('im.k417', 'Q/A короткие (@MICROCARD)'),
                instructions: `${wt('im.k616', '1. Скопируйте промпт и отправьте его ИИ-агенту вместе с учебным материалом.')}
${wt('im.k418', '2. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}
${wt('im.k573', '3. Нажмите «Распарсить» для предпросмотра карточек.')}`,
                prompt: `Ты — генератор микрокарточек для образовательной платформы.

<task_context>
Микрокарточки — это карточки для интервального повторения (spaced repetition). На лицевой стороне — короткий вопрос, на обратной — краткий точный ответ. Цель — быстрое запоминание фактов, определений и ключевых связей.
</task_context>

<task>
Преобразуй предоставленный материал в микрокарточки формата @MICROCARD. Извлеки ключевые факты, определения, числовые данные и важные связи. Каждая карточка должна проверять одну конкретную единицу знания.
</task>

<quality_criteria>
- Вопрос (#) — краткий, однозначный, проверяет одну единицу знания.
- Ответ (=) — точный, лаконичный, не длиннее 1–2 предложений.
- Карточки самодостаточны — понятны без контекста других карточек.
- Без дублирования — каждый факт покрывается одной карточкой.
- Фактологическая точность — только то, что явно следует из материала.
</quality_criteria>

<output_format>
Каждый блок начинается с маркера @MICROCARD на отдельной строке. Между блоками — одна пустая строка. Ответ содержит только блоки карточек, без пояснений, Markdown и комментариев.

@MICROCARD
@ tags: тег1, тег2
@ difficulty: 2
# <вопрос>
= <ответ>
</output_format>

<metadata_rules>
- @ tags: — теги через запятую (опционально)
- @ difficulty: 1 (лёгкая), 2 (средняя), 3 (сложная) — опционально
- @ deck: — название колоды (опционально, для группировки)
</metadata_rules>

<example>
@MICROCARD
@ tags: кардиология, ритм
@ difficulty: 1
# Что такое синусовый ритм?
= Ритм сердца, при котором импульсы исходят из синусового узла.

@MICROCARD
@ tags: кардиология
@ difficulty: 2
# Какова нормальная ЧСС у взрослого в покое?
= 60–100 ударов в минуту.
</example>`
            },
            term_definition: {
                title: wt('im.k419', 'Термин → определение (@MICROCARD)'),
                instructions: `${wt('im.k616', '1. Скопируйте промпт и отправьте его ИИ-агенту вместе с учебным материалом.')}
${wt('im.k420', '2. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}
${wt('im.k573', '3. Нажмите «Распарсить» для предпросмотра карточек.')}`,
                prompt: `Ты — генератор микрокарточек для образовательной платформы.

<task>
Извлеки из предоставленного материала все ключевые термины и создай микрокарточки формата «Термин → Определение». На лицевой стороне — термин или понятие (в форме вопроса «Что такое…?»). На обратной — точное, краткое определение.
</task>

<quality_criteria>
- Термин формулируется как вопрос: «Что такое ...?», «Что означает ...?»
- Определение — точное, краткое, 1–2 предложения максимум.
- Только явные термины из материала, не общеизвестные понятия.
- Без дублирования и синонимичных карточек.
</quality_criteria>

<output_format>
@MICROCARD
@ tags: <тема>
# Что такое <термин>?
= <определение>

Между блоками — одна пустая строка. Без Markdown, без пояснений, только блоки @MICROCARD.
</output_format>

<example>
@MICROCARD
@ tags: гематология
# Что такое гемоглобин?
= Белок эритроцитов, осуществляющий транспорт кислорода от лёгких к тканям и углекислого газа обратно.

@MICROCARD
@ tags: гематология
# Что такое гематокрит?
= Объёмная доля эритроцитов в общем объёме крови, выражаемая в процентах.
</example>`
            },
            definition_term: {
                title: wt('im.k421', 'Определение → термин (@MICROCARD)'),
                instructions: `${wt('im.k616', '1. Скопируйте промпт и отправьте его ИИ-агенту вместе с учебным материалом.')}
${wt('im.k422', '2. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}
${wt('im.k573', '3. Нажмите «Распарсить» для предпросмотра карточек.')}`,
                prompt: `Ты — генератор микрокарточек для образовательной платформы.

<task>
Извлеки из предоставленного материала ключевые термины и создай микрокарточки в формате «Определение → Термин» (обратное направление). На лицевой стороне — описание или определение понятия. На обратной — сам термин. Это развивает узнавание термина по описанию.
</task>

<quality_criteria>
- Описание на лицевой стороне не содержит самого термина (иначе задача тривиальна).
- Ответ — только термин, без лишних слов.
- Описание достаточно точное, чтобы ответ был однозначным.
- Без дублирования с карточками «Термин → Определение» в той же колоде.
</quality_criteria>

<output_format>
@MICROCARD
@ tags: <тема>
# <описание понятия без упоминания термина>
= <термин>

Между блоками — одна пустая строка. Без Markdown, без пояснений, только блоки @MICROCARD.
</output_format>

<example>
@MICROCARD
@ tags: гематология
# Белок эритроцитов, транспортирующий кислород к тканям и углекислый газ обратно
= Гемоглобин

@MICROCARD
@ tags: гематология
# Объёмная доля эритроцитов в общем объёме крови, выраженная в процентах
= Гематокрит
</example>`
            },
            material_cards: {
                title: wt('im.k423', 'Карточки по тезисам материала (@MICROCARD)'),
                instructions: `${wt('im.k616', '1. Скопируйте промпт и отправьте его ИИ-агенту вместе с учебным материалом.')}
${wt('im.k424', '2. Скопируйте ответ ИИ без изменений и вставьте в поле ниже.')}
${wt('im.k573', '3. Нажмите «Распарсить» для предпросмотра карточек.')}`,
                prompt: `Ты — генератор микрокарточек для образовательной платформы.

<task>
Проанализируй предоставленный материал и создай микрокарточки по ключевым тезисам. Каждая карточка должна проверять понимание одного тезиса, факта или связи из материала. Используй разнообразные формулировки вопросов: «Почему…?», «Как…?», «В чём отличие…?», «Каков механизм…?», «Назовите…».
</task>

<calibration>
Ориентиры количества карточек:
- ~300 слов → 3–6 карточек
- ~1000 слов → 10–20 карточек
- ~3000+ слов → 25–50 карточек
Лучше меньше качественных, чем много тривиальных.
</calibration>

<quality_criteria>
- Разнообразие формулировок: не только «Что такое…?», но и «Почему…?», «Каков механизм…?», «В чём разница между…?».
- Проверяется понимание, а не только запоминание.
- Карточки независимы друг от друга.
- Фактологическая точность — строго по материалу.
- Ответ краткий: 1–3 предложения максимум.
</quality_criteria>

<output_format>
@MICROCARD
@ tags: <тема>
@ difficulty: <1|2|3>
# <вопрос>
= <ответ>

Между блоками — одна пустая строка. Без Markdown, без пояснений, только блоки @MICROCARD.
</output_format>

<example>
@MICROCARD
@ tags: пульмонология
@ difficulty: 2
# Почему при пневмонии возникает одышка?
= Воспаление в лёгочной ткани нарушает газообмен в альвеолах, снижая оксигенацию крови, что компенсаторно увеличивает частоту дыхания.

@MICROCARD
@ tags: пульмонология
@ difficulty: 3
# В чём различие между крупозной и очаговой пневмонией?
= Крупозная поражает целую долю лёгкого и имеет стадийное течение, очаговая — захватывает отдельные дольки и часто развивается как осложнение бронхита.
</example>`
            },
        };
    }

    renderMicrocardsTextImport() {
        const parsed = this.mcImportParsedResult;
        const executed = this.mcImportExecuteResult;
        const templates = this.getMcImportPromptTemplates();
        const activeTemplate = templates[this.mcImportTemplateType] || templates.qa_short;
        const decks = Array.isArray(this.microcardsDecks) ? this.microcardsDecks : [];

        // Step 1: Input + prompt template (no parsed result yet)
        // Step 2: Preview parsed items + mode/deck selection + execute
        // Step 3: Execute result summary

        if (executed) {
            return this._renderMcImportExecuteResult(executed);
        }

        if (parsed && parsed.ok) {
            return this._renderMcImportPreview(parsed, decks);
        }

        // Default: input step
        const parsingErrors = parsed?.parsing_errors || [];
        const hasErrors = parsingErrors.length > 0;

        return `
            <div class="grid grid-cols-1 xl:grid-cols-[1fr_1fr] gap-5">
                <div class="space-y-4">
                    <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                        <div class="flex items-start justify-between gap-3 mb-3">
                            <div>
                                <h4 class="text-sm font-bold text-text-main">${wt('im.k869', 'Шаблон промпта для ИИ-агента')}</h4>
                                <p class="text-xs text-text-secondary mt-1">${wt('im.k946', 'Скопируйте этот шаблон, передайте его внешнему ИИ (например, ChatGPT) и вставьте полученный результат справа.')}</p>
                            </div>
                            <button onclick="dashboard.importManager.mcImportCopyPrompt()"
                                class="px-3 py-1.5 text-xs font-semibold text-primary border border-primary rounded hover:bg-primary hover:text-primary-fg transition-colors shrink-0">
                                ${wt('im.k425', 'Скопировать')}
                            </button>
                        </div>
                        <div class="mb-3">
                            <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k947', 'Тип карточек')}</label>
                            <select id="mcImportTemplateType"
                                onchange="dashboard.importManager.mcImportChangeTemplate(this.value)"
                                class="block w-full rounded-lg border border-border-strong bg-surface-1 py-2 px-3 text-sm text-text-main focus:ring-2 focus:ring-primary">
                                ${Object.entries(templates).map(([key, t]) => `
                                    <option value="${key}" ${this.mcImportTemplateType === key ? 'selected' : ''}>${this.escapeHtml(t.title)}</option>
                                `).join('')}
                            </select>
                        </div>
                        <div class="mb-3 p-3 bg-info-lighter border border-info-light rounded-lg">
                            <div class="flex items-start gap-2">
                                <span class="material-symbols-outlined text-info text-[18px] mt-0.5">lightbulb</span>
                                <div class="text-xs text-info-text whitespace-pre-line">${this.escapeHtml(activeTemplate.instructions)}</div>
                            </div>
                        </div>
                        <textarea id="mcImportPromptTextarea" rows="10" readonly
                            class="block w-full rounded-lg border border-border-strong bg-surface-2 p-3 text-xs text-text-main font-mono">${this.escapeHtml(activeTemplate.prompt)}</textarea>
                    </div>
                </div>

                <div class="space-y-4">
                    <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                        <h4 class="text-sm font-bold text-text-main mb-2">${wt('im.k700', 'Вставьте текст с микрокарточками')}</h4>
                        ${hasErrors ? `
                            <div class="mb-3 p-3 bg-error-lighter border border-error-light rounded-lg">
                                <div class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-error text-[18px]">error</span>
                                    <div class="text-xs text-error-text space-y-1">
                                        ${parsingErrors.map(e => `<p>${this.escapeHtml(e)}</p>`).join('')}
                                    </div>
                                </div>
                            </div>
                        ` : ''}
                        <div class="flex justify-end mb-2">
                            <button onclick="dashboard.importManager.mcImportPasteClipboard()"
                                class="px-3 py-1.5 text-xs font-bold text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-all">
                                <span class="material-symbols-outlined text-[14px] align-middle mr-1">content_paste</span> ${wt('im.k701', 'Вставить из буфера')}
                            </button>
                        </div>
                        <textarea id="mcImportTextArea"
                            class="block w-full rounded-lg border ${hasErrors ? 'border-error' : 'border-border-strong'} bg-surface-2 p-3 text-sm text-text-main font-mono placeholder:text-text-disabled focus:ring-2 focus:ring-primary resize-y"
                            rows="14"
                            ${wt('im.k426', 'placeholder="@MICROCARD&#10;@ tags: кардиология&#10;# Что такое синусовый ритм?&#10;= Ритм сердца, при котором импульсы исходят из синусового узла.&#10;&#10;@MICROCARD&#10;# Норма ЧСС у взрослого&#10;= 60–100 уд/мин."')}
                            oninput="dashboard.importManager.mcImportText = this.value">${this.escapeHtml(this.mcImportText)}</textarea>
                        <div id="mcImportLiveCounter" class="mt-2 flex flex-wrap gap-2 text-xs min-h-[20px]"></div>
                        <div class="mt-3 flex items-center gap-3">
                            <button onclick="dashboard.importManager.mcImportParseText()"
                                class="px-5 py-2.5 text-sm font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors disabled:opacity-50 shadow-sm"
                                ${this.mcImportParsing ? 'disabled' : ''}>
                                ${this.mcImportParsing ? wt('im.k702', 'Парсинг...') : wt('im.k703', 'Распарсить')}
                            </button>
                        </div>
                        <div class="mt-3 flex items-start gap-2 p-3 bg-info-lighter border border-info-light rounded-lg">
                            <span class="material-symbols-outlined text-info text-[18px]">info</span>
                            <div class="text-xs text-info-text">
                                <p class="font-medium mb-1">${wt('im.k948', 'Формат:')}</p>
                                <p>${wt('im.k949', '@MICROCARD — простая карточка (вопрос/ответ)')}</p>
                                <p class="mt-1 text-text-muted">${wt('im.k950', '@PAIR_MATCH — сопоставления (v1.1, запланировано)')}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    _renderMcImportPreview(parsed, decks) {
        const summary = parsed.summary || {};
        const items = parsed.items || [];
        const notes = Array.isArray(parsed.notes) ? parsed.notes.filter(n => typeof n === 'string' && n.trim()) : [];
        const targetDeck = this.mcImportMode === 'append_to_deck'
            ? decks.find((deck) => String(deck?.id || '') === String(this.mcImportTargetDeckId || ''))
            : null;

        return `
            <div class="space-y-4 animate-slide-up-fade">
                <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                    <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <h4 class="text-sm font-bold text-text-main">${wt('im.k427', 'Предпросмотр:')}${summary.total || 0} ${wt('im.k428', 'карточек</h4>')}
                        <div class="flex items-center gap-2 text-xs">
                            <span class="px-2 py-1 rounded-md bg-success-lighter text-success-text border border-success-light font-bold">${summary.valid || 0} ${wt('im.k429', 'ок</span>')}
                            ${summary.warnings ? `<span class="px-2 py-1 rounded-md bg-warning-lighter text-warning-text border border-warning-light font-bold">${summary.warnings} ${wt('im.k951', 'предупр.')}</span>` : ''}
                            ${summary.errors ? `<span class="px-2 py-1 rounded-md bg-error-lighter text-error-text border border-error-light font-bold">${summary.errors} ${wt('im.k952', 'ошибок')}</span>` : ''}
                        </div>
                    </div>
                    ${notes.length ? `
                        <div class="mb-3 p-2.5 bg-info-lighter border border-info-light rounded-lg">
                            <div class="text-xs text-info-text space-y-0.5">
                                ${notes.map(n => `<p>${this.escapeHtml(n)}</p>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div class="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                        ${items.map((item, idx) => {
                            const cp = item.card_preview || {};
                            const meta = item.metadata || {};
                            const issues = item.validation_issues || [];
                            const st = item.status || 'valid';
                            const borderCls = st === 'error' ? 'border-error-light bg-error-lighter/20' : (st === 'warning' ? 'border-warning-light bg-warning-lighter/20' : 'border-border-strong bg-surface-2');
                            return `
                                <div class="rounded-lg border ${borderCls} p-3">
                                    <div class="flex items-center gap-2 mb-1.5">
                                        <span class="text-[10px] font-bold text-text-muted">#${idx + 1}</span>
                                        <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-border-strong bg-surface-1 text-text-muted uppercase tracking-tight">${this.escapeHtml(cp.card_type === 'pair_match' ? wt('im.k953', 'сопост.') : wt('im.k954', 'вопр/отв'))}</span>
                                        ${meta.tags?.length ? `<span class="text-[10px] text-text-secondary">${meta.tags.map(t => this.escapeHtml(t)).join(', ')}</span>` : ''}
                                        ${st !== 'valid' ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold ${st === 'error' ? 'bg-error-lighter text-error-text border border-error-light' : 'bg-warning-lighter text-warning-text border border-warning-light'} uppercase tracking-tight">${this.escapeHtml(st === 'warning' ? wt('im.k955', 'предупреждение') : (st === 'error' ? wt('im.k956', 'ошибка') : st))}</span>` : ''}
                                    </div>
                                    <div class="text-xs font-semibold text-text-main mb-0.5">${this.escapeHtml(String(cp.front || '').slice(0, 120))}</div>
                                    <div class="text-[11px] text-text-secondary">${this.escapeHtml(String(cp.back || '').slice(0, 150))}</div>
                                    ${issues.length ? `<div class="mt-1.5 space-y-0.5">${issues.map(i => `<div class="text-[10px] ${i.severity === 'error' ? 'text-error-text' : 'text-warning-text'}">${this.escapeHtml(i.message || '')}</div>`).join('')}</div>` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                <div class="rounded-xl border border-primary-light bg-primary-lighter/10 p-4">
                    <h4 class="text-sm font-bold text-text-main mb-3">${wt('im.k704', 'Импорт карточек')}</h4>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                        <div>
                            <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k872', 'Режим')}</label>
                            <select id="mcImportModeSelect"
                                onchange="dashboard.importManager.mcImportMode = this.value; dashboard.importManager.renderTheoryAnalysisMode()"
                                class="w-full px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary">
                                <option value="create_deck" ${this.mcImportMode === 'create_deck' ? 'selected' : ''}>${wt('im.k957', 'Создать новую колоду')}</option>
                                <option value="append_to_deck" ${this.mcImportMode === 'append_to_deck' ? 'selected' : ''}>${wt('im.k958', 'Добавить в существующую')}</option>
                            </select>
                        </div>
                        ${this.mcImportMode === 'create_deck' ? `
                            <div>
                                <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k959', 'Название колоды')}</label>
                                <input id="mcImportDeckName" type="text"
                                    value="${this.escapeHtmlAttr(this.mcImportDeckName || (items[0]?.metadata?.deck || ''))}"
                                    oninput="dashboard.importManager.mcImportDeckName = this.value"
                                    placeholder=wt('im.k430', "Из метаданных или укажите вручную")
                                    class="w-full px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary" />
                            </div>
                        ` : `
                            <div>
                                <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k960', 'Целевая колода')}</label>
                                <select id="mcImportTargetDeck"
                                    onchange="dashboard.importManager.mcImportTargetDeckId = this.value; dashboard.importManager.renderTheoryAnalysisMode()"
                                    class="w-full px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary">
                                    <option value="">${wt('im.k961', '— выберите колоду —')}</option>
                                    ${decks.filter(d => !d?.meta?.archived).map(d => `
                                        <option value="${this.escapeHtmlAttr(String(d?.id || ''))}" ${this.mcImportTargetDeckId === String(d?.id) ? 'selected' : ''}>${this.escapeHtml(String(d?.name || d?.id || 'Колода'))} (${d?.stats?.cards_total ?? 0} карт.)</option>
                                    `).join('')}
                                </select>
                            </div>
                        `}
                    </div>
                    ${targetDeck ? `
                        <div id="mcImportTargetDeckNote" class="mt-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                            <div class="flex flex-wrap gap-1 mb-1.5">${this.renderMicrocardsDeckOwnershipBadges(targetDeck)}</div>
                            <p class="text-[11px] text-text-secondary">Карточки будут добавлены в общую колоду <span class="font-semibold text-text-main">${this.escapeHtml(String(targetDeck.name || targetDeck.id || wt('im.k431', 'Колода')))}</span>. Прогресс повторения по ним останется персональным.</p>
                        </div>
                    ` : ''}
                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="dashboard.importManager.mcImportExecute()"
                            class="px-5 py-2.5 text-sm font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors disabled:opacity-50 shadow-sm"
                            ${this.mcImportExecuting || !(summary.valid > 0) ? 'disabled' : ''}>
                            ${this.mcImportExecuting ? wt('im.k432', 'Импорт...') : `${wt('im.k705', 'Импортировать')} ${summary.valid || 0} ${wt('im.k706', 'карточек')}`}
                        </button>
                        <button onclick="dashboard.importManager.mcImportReset()"
                            class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k433', 'Назад к вводу')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    _renderMcImportExecuteResult(result) {
        const ok = result.ok;
        return `
            <div class="space-y-4 animate-slide-up-fade">
                <div class="rounded-xl border ${ok ? 'border-success-light bg-success-lighter/20' : 'border-error-light bg-error-lighter/20'} p-6 text-center">
                    <span class="material-symbols-outlined ${ok ? 'text-success' : 'text-error'} text-[40px] mb-2">${ok ? 'check_circle' : 'error'}</span>
                    <h4 class="text-base font-bold ${ok ? 'text-success-text' : 'text-error-text'} mb-2">
                        ${ok ? wt('im.k707', 'Импорт завершён') : wt('im.k708', 'Ошибка импорта')}
                    </h4>
                    ${ok ? `
                        <div class="flex flex-wrap justify-center gap-4 text-sm mb-3">
                            <div><span class="font-bold text-text-main">${result.added_cards || 0}</span> <span class="text-text-secondary">${wt('im.k962', 'добавлено')}</span></div>
                            ${result.skipped_duplicates ? `<div><span class="font-bold text-warning-text">${result.skipped_duplicates}</span> <span class="text-text-secondary">${wt('im.k963', 'дубликатов')}</span></div>` : ''}
                            ${result.skipped_errors ? `<div><span class="font-bold text-error-text">${result.skipped_errors}</span> <span class="text-text-secondary">${wt('im.k952', 'ошибок')}</span></div>` : ''}
                        </div>
                        <p class="text-xs text-text-secondary mb-1">${wt('im.k964', 'Колода:')} <span class="font-semibold text-text-main">${this.escapeHtml(result.deck_name || result.deck_id || '')}</span></p>
                    ` : `
                        <p class="text-sm text-error-text">${this.escapeHtml(result.error || wt('im.k434', 'Неизвестная ошибка'))}</p>
                    `}
                </div>
                <div class="flex flex-wrap justify-center gap-3">
                    <button onclick="dashboard.importManager.mcImportReset()"
                        class="px-5 py-2.5 text-sm font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors shadow-sm">
                        ${wt('im.k435', 'Новый импорт')}
                    </button>
                    ${ok && result.deck_id ? `
                        <button onclick="dashboard.importManager.manualEditorOpenDeck('${this.escapeInlineJsString(String(result.deck_id))}'); dashboard.importManager.enterTheorySubMode('manual_editor')"
                            class="px-4 py-2 text-sm font-semibold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k594', 'Открыть в редакторе')}
                        </button>
                        <button onclick="dashboard.importManager.openTheoryMicrocardsMode('${this.escapeInlineJsString(String(result.deck_id))}')"
                            class="px-4 py-2 text-sm font-semibold rounded-lg border border-primary text-primary hover:bg-primary hover:text-primary-fg transition-colors">
                            ${wt('im.k595', 'Начать повторение')}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    mcImportChangeTemplate(key) {
        const templates = this.getMcImportPromptTemplates();
        if (templates[key]) {
            this.mcImportTemplateType = key;
        }
        const textarea = document.getElementById('mcImportPromptTextarea');
        if (textarea) {
            const active = templates[this.mcImportTemplateType] || templates.qa_short;
            textarea.value = active.prompt;
        }
        const instrEl = document.getElementById('mcImportPromptTextarea')?.closest('.rounded-xl')?.querySelector('.bg-info-lighter .text-info-text');
        if (instrEl) {
            const active = templates[this.mcImportTemplateType] || templates.qa_short;
            instrEl.textContent = active.instructions;
        }
    }

    async mcImportCopyPrompt() {
        try {
            const templates = this.getMcImportPromptTemplates();
            const active = templates[this.mcImportTemplateType] || templates.qa_short;
            await this.writeToClipboard(active.prompt);
            this.showToast(wt('im.k436', 'Промпт скопирован в буфер обмена.'), 'success');
        } catch (e) {
            this.showToast(wt('im.k437', 'Не удалось скопировать промпт.'), 'error');
        }
    }

    async mcImportPasteClipboard() {
        try {
            const text = await navigator.clipboard.readText();
            const textarea = document.getElementById('mcImportTextArea');
            if (textarea && text) {
                textarea.value = text;
                this.mcImportText = text;
            }
        } catch (e) {
            this.showToast(wt('im.k438', 'Не удалось прочитать буфер обмена.'), 'warning');
        }
    }

    async mcImportParseText() {
        const textarea = document.getElementById('mcImportTextArea');
        if (textarea) this.mcImportText = textarea.value;
        if (!this.mcImportText.trim()) {
            this.showToast(wt('im.k439', 'Вставьте текст с микрокарточками.'), 'warning');
            return;
        }
        this.mcImportParsing = true;
        this.mcImportParsedResult = null;
        this.mcImportExecuteResult = null;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            const resp = await fetch('/api/v2/microcards/import/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ format: 'auto', content: this.mcImportText }),
            });
            const raw = await resp.json();
            // V2 analyze rows → the {items, summary} shape this panel renders.
            const okRows = Array.isArray(raw.rows) ? raw.rows.filter(r => r && r.status === 'ok') : [];
            const data = {
                ok: !!raw.ok,
                error: raw.error,
                items: okRows.map(r => ({
                    card_type: 'fact_recall',
                    front: { text: String(r.front || '') },
                    back: { text: String(r.back || '') },
                    hint: r.hint || null,
                })),
                summary: {
                    total: raw.counts?.total ?? 0,
                    ok: raw.counts?.ok ?? 0,
                    errors: raw.counts?.errors ?? 0,
                },
            };
            this.mcImportParsedResult = data;
            if (!data.ok && !data.items?.length) {
                this.showToast(data.error || wt('im.k440', 'Ошибка парсинга'), 'error');
            } else if (data.summary?.total === 0) {
                this.showToast(wt('im.k441', 'Не найдено блоков @MICROCARD в тексте.'), 'warning');
            }
        } catch (e) {
            console.error('[M12] parse failed:', e);
            this.showToast(wt('im.k442', 'Ошибка сети при парсинге.'), 'error');
        } finally {
            this.mcImportParsing = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    async mcImportExecute() {
        const parsed = this.mcImportParsedResult;
        if (!parsed?.items?.length) return;
        if (this.mcImportMode === 'append_to_deck' && !this.mcImportTargetDeckId) {
            this.showToast(wt('im.k443', 'Выберите целевую колоду.'), 'warning');
            return;
        }
        const deckNameEl = document.getElementById('mcImportDeckName');
        if (deckNameEl) this.mcImportDeckName = deckNameEl.value;
        this.mcImportExecuting = true;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        try {
            let deckId = this.mcImportTargetDeckId;
            if (this.mcImportMode === 'create_deck') {
                const created = await fetch('/api/v2/microcards/decks', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: this.mcImportDeckName || wt('im.k950', 'Импортированная колода') }),
                });
                const createdData = await created.json();
                if (!createdData.ok || !createdData.deck?.id) {
                    this.mcImportExecuteResult = createdData;
                    this.showToast(createdData.error || wt('im.k444', 'Ошибка импорта'), 'error');
                    return createdData;
                }
                deckId = createdData.deck.id;
            }
            const resp = await fetch(`/api/v2/microcards/decks/${encodeURIComponent(deckId)}/import/auto`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: this.mcImportText }),
            });
            const raw = await resp.json();
            const data = { ...raw, added_cards: raw.added_count || 0 };
            this.mcImportExecuteResult = data;
            if (data.ok) {
                this.showToast(`${wt('im.k709', 'Импортировано')} ${data.added_cards || 0} ${wt('im.k706', 'карточек')}.`, 'success');
                this.loadMicrocardsDecks();
            } else {
                this.showToast(data.error || wt('im.k444', 'Ошибка импорта'), 'error');
            }
        } catch (e) {
            console.error('[M12] execute failed:', e);
            this.mcImportExecuteResult = { ok: false, error: 'network_error' };
            this.showToast(wt('im.k445', 'Ошибка сети при импорте.'), 'error');
        } finally {
            this.mcImportExecuting = false;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    mcImportReset() {
        this.mcImportParsedResult = null;
        this.mcImportExecuteResult = null;
        this.mcImportExecuting = false;
        this.mcImportDeckName = '';
        this.mcImportTargetDeckId = '';
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
    }

    renderManualMicrocardsEditor() {
        const decks = Array.isArray(this.microcardsDecks) ? this.microcardsDecks : [];
        const deck = this.manualEditorDeck;
        const cards = (deck && Array.isArray(deck.cards)) ? deck.cards : [];
        const form = this.manualEditorCardForm;
        const preview = this.manualEditorPreviewCard;
        const isArchived = deck?.meta?.archived === true;

        const deckListHtml = this.microcardsDecksLoading
            ? wt('im.k446', '<div class="text-sm text-text-secondary py-4 text-center">Загрузка колод...</div>')
            : (decks.length ? decks.map(d => {
                const isActive = deck && String(d?.id) === String(deck?.id);
                const archived = d?.meta?.archived === true;
                const stats = d?.stats || {};
                const ownershipBadges = this.renderMicrocardsDeckOwnershipBadges(d);
                return `
                    <div data-m11-deck-row="${this.escapeHtmlAttr(String(d?.id || ''))}" class="flex items-center gap-2 px-3 py-2 rounded-lg border ${isActive ? 'border-primary bg-primary-lighter/20 shadow-sm' : 'border-border-strong bg-surface-2 opacity-80 hover:opacity-100'} ${archived ? 'grayscale opacity-50' : ''} cursor-pointer hover:bg-bg-hover transition-all"
                         onclick="dashboard.importManager.manualEditorOpenDeck('${this.escapeInlineJsString(String(d?.id || ''))}')">
                        <div class="min-w-0 flex-1">
                            <div class="text-xs font-bold text-text-main truncate">${this.escapeHtml(String(d?.name || d?.id || wt('im.k431', 'Колода')))}${archived ? ` <span class="text-text-muted">${wt('im.k965', '(архив)')}</span>` : ''}</div>
                            ${ownershipBadges ? `<div class="mt-1 flex flex-wrap gap-1">${ownershipBadges}</div>` : ''}
                            <div class="text-[10px] text-text-secondary mt-1">${stats.cards_total ?? 0} ${wt('im.k447', 'карт.</div>')}
                        </div>
                        ${this.manualEditorRenamingDeckId === String(d?.id) ? '' : `
                            <button onclick="event.stopPropagation(); dashboard.importManager.manualEditorRenamingDeckId='${this.escapeInlineJsString(String(d?.id))}'; dashboard.importManager.renderTheoryAnalysisMode();"
                                class="p-1 rounded text-text-muted hover:text-primary transition-colors" title=wt('im.k448', "Переименовать")>
                                <span class="material-symbols-outlined text-[14px]">edit</span>
                            </button>
                        `}
                    </div>
                    ${this.manualEditorRenamingDeckId === String(d?.id) ? `
                        <div class="flex gap-1 mt-1 mb-1" onclick="event.stopPropagation()">
                            <input id="m11RenameInput" type="text" value="${this.escapeHtmlAttr(String(d?.name || ''))}"
                                class="flex-1 min-w-0 px-2 py-1.5 text-xs rounded-md border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary" />
                            <button onclick="dashboard.importManager.manualEditorRenameDeck('${this.escapeInlineJsString(String(d?.id))}')"
                                class="px-2 py-1 text-[10px] font-bold rounded-md bg-primary text-primary-fg hover:bg-primary-hover" ${this.manualEditorSaving ? 'disabled' : ''}>OK</button>
                            <button onclick="dashboard.importManager.manualEditorRenamingDeckId=null; dashboard.importManager.renderTheoryAnalysisMode();"
                                class="px-2 py-1 text-[10px] font-bold rounded-md border border-border-strong text-text-secondary hover:bg-bg-hover">✕</button>
                        </div>
                    ` : ''}
                `;
            }).join('') : `<div class="text-sm text-text-secondary py-4 text-center">${wt('im.k966', 'Нет колод. Создайте новую.')}</div>`);

        const isPairMatch = form && form.card_type === 'pair_match';
        const formPairs = (form && Array.isArray(form.pairs)) ? form.pairs : [{ left: '', right: '' }, { left: '', right: '' }];

        const cardFormHtml = form ? `
            <div class="rounded-xl border border-primary-light bg-primary-lighter/10 p-4 space-y-3">
                <div class="flex items-center justify-between gap-2">
                    <div class="text-xs font-bold text-text-main">${form.mode === 'edit' ? wt('im.k967', 'Редактирование карточки') : wt('im.k968', 'Новая карточка')}</div>
                    ${''/* D2: pair_match card type is retired — pairs live as plain Q/A cards */}
                </div>
                <div>
                    <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${isPairMatch ? wt('im.k969', 'Инструкция (лицевая сторона)') : wt('im.k970', 'Лицевая сторона (вопрос)')}</label>
                    <textarea id="m11CardFront" rows="2"
                        class="w-full px-3 py-2 text-sm rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                        placeholder="${isPairMatch ? wt('im.k598', 'Сопоставьте термин и определение') : wt('im.k599', 'Что такое синусовый ритм?')}">${this.escapeHtml(form.front_text)}</textarea>
                </div>
                ${isPairMatch ? `
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k971', 'Пары (2–5)')}</label>
                        <div class="space-y-2" id="m15PairsContainer">
                            ${formPairs.map((p, i) => `
                                <div class="flex items-center gap-2">
                                    <span class="text-[10px] text-text-muted font-mono w-4 text-right shrink-0">${i + 1}.</span>
                                    <input id="m15PairLeft_${i}" type="text" value="${this.escapeHtmlAttr(String(p.left || ''))}"
                                        class="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
                                        placeholder=wt('im.k600', "Левый элемент") />
                                    <span class="text-text-muted text-xs shrink-0">\u2192</span>
                                    <input id="m15PairRight_${i}" type="text" value="${this.escapeHtmlAttr(String(p.right || ''))}"
                                        class="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
                                        placeholder=wt('im.k601', "Правый элемент") />
                                    ${formPairs.length > 2 ? `
                                        <button onclick="dashboard.importManager._m15RemovePair(${i})"
                                            class="p-1 rounded text-text-muted hover:text-error transition-colors shrink-0" title=wt('im.k449', "Удалить пару")>
                                            <span class="material-symbols-outlined text-[14px]">close</span>
                                        </button>
                                    ` : '<div class="w-6 shrink-0"></div>'}
                                </div>
                            `).join('')}
                        </div>
                        ${formPairs.length < 5 ? `
                            <button onclick="dashboard.importManager._m15AddPair()"
                                class="mt-2 flex items-center gap-1 px-3 py-1.5 text-[10px] font-bold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                                <span class="material-symbols-outlined text-[14px]">add</span> ${wt('im.k972', 'Добавить пару')}
                            </button>
                        ` : ''}
                        <div class="text-[10px] text-text-muted mt-1">${wt('im.k973', 'Каждый левый и правый элемент должен быть уникальным. Минимум 2, максимум 5 пар.')}</div>
                    </div>
                ` : `
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k974', 'Обратная сторона (ответ)')}</label>
                        <textarea id="m11CardBack" rows="2"
                            class="w-full px-3 py-2 text-sm rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                            placeholder=wt('im.k450', "Ритм сердца, при котором импульсы исходят из синусового узла.")>${this.escapeHtml(form.back_text)}</textarea>
                    </div>
                `}
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k975', 'Теги (через запятую)')}</label>
                        <input id="m11CardTags" type="text" value="${this.escapeHtmlAttr(form.tags)}"
                            class="w-full px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary"
                            placeholder=wt('im.k602', "кардиология, ритм") />
                    </div>
                    <div>
                        <label class="block text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">${wt('im.k976', 'Сложность')}</label>
                        <select id="m11CardDifficulty"
                            class="w-full px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary">
                            <option value="low" ${form.difficulty_hint === 'low' ? 'selected' : ''}>${wt('im.k977', 'Низкая')}</option>
                            <option value="medium" ${form.difficulty_hint === 'medium' ? 'selected' : ''}>${wt('im.k978', 'Средняя')}</option>
                            <option value="high" ${form.difficulty_hint === 'high' ? 'selected' : ''}>${wt('im.k979', 'Высокая')}</option>
                        </select>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 pt-1">
                    <button onclick="dashboard.importManager.manualEditorSaveCard()"
                        class="px-4 py-2 text-xs font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors disabled:opacity-50"
                        ${this.manualEditorSaving ? 'disabled' : ''}>
                        ${this.manualEditorSaving ? 'disabled' : ''}>
                        ${this.manualEditorSaving ? wt('im.k710', 'Сохранение...') : (form.mode === 'edit' ? wt('im.k711', 'Сохранить изменения') : wt('im.k712', 'Создать карточку'))}
                    </button>
                    <button onclick="dashboard.importManager.manualEditorPreviewCurrentCard()"
                        class="px-4 py-2 text-xs font-bold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                        ${wt('im.k451', 'Предпросмотр')}
                    </button>
                    <button onclick="dashboard.importManager.manualEditorCancelCardForm()"
                        class="px-4 py-2 text-xs font-bold rounded-lg border border-border-strong text-text-muted hover:bg-bg-hover transition-colors">
                        ${wt('im.k452', 'Отмена')}
                    </button>
                </div>
            </div>
            ${preview ? `
                <div class="rounded-xl border border-info-light bg-info-lighter/30 p-4">
                    <div class="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-2">${wt('im.k980', 'Предпросмотр карточки')}</div>
                    <div class="rounded-lg border border-border-strong bg-surface-1 p-3 mb-2 shadow-sm">
                        <div class="text-[10px] uppercase font-bold tracking-wider text-text-secondary mb-1">${wt('im.k981', 'Лицевая сторона')}</div>
                        <div class="text-sm text-text-main whitespace-pre-line leading-relaxed">${this.escapeHtml(String(preview.front?.text || ''))}</div>
                    </div>
                    ${preview.card_type === 'pair_match' && preview.front?.payload?.left_items ? `
                        <div class="rounded-lg border border-border-strong bg-surface-1 p-3 mb-2 shadow-sm">
                            <div class="text-[10px] uppercase font-bold tracking-wider text-text-secondary mb-2">${wt('im.k982', 'Пары сопоставления')}</div>
                            <div class="space-y-1.5">
                                ${(Array.isArray(preview.back?.payload?.pairs) ? preview.back.payload.pairs : []).map(pl => {
                                    const li = (preview.front.payload.left_items || []).find(x => x.id === pl.left_id);
                                    const ri = (preview.front.payload.right_items || []).find(x => x.id === pl.right_id);
                                    return `<div class="flex items-center gap-2 text-xs">
                                        <span class="flex-1 px-2.5 py-1.5 rounded-lg border border-border-strong bg-surface-2 text-text-main">${this.escapeHtml(String(li?.text || ''))}</span>
                                        <span class="text-text-muted font-bold">\u2192</span>
                                        <span class="flex-1 px-2.5 py-1.5 rounded-lg border border-border-strong bg-surface-2 text-text-main">${this.escapeHtml(String(ri?.text || ''))}</span>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>
                    ` : `
                        <div class="rounded-lg border border-border-strong bg-surface-1 p-3 shadow-sm">
                            <div class="text-[10px] uppercase font-bold tracking-wider text-text-secondary mb-1">${wt('im.k983', 'Обратная сторона')}</div>
                            <div class="text-sm text-text-main whitespace-pre-line leading-relaxed">${this.escapeHtml(String(preview.back?.text || ''))}</div>
                        </div>
                    `}
                </div>
            ` : ''}
        ` : '';

        const cardListHtml = deck ? (cards.length ? `
            <div class="space-y-2">
                ${cards.map((card, idx) => {
                    const cid = String(card?.id || '');
                    const ft = String(card?.front?.text || '').slice(0, 80);
                    const bt = String(card?.back?.text || '').slice(0, 80);
                    const ctype = String(card?.card_type || 'fact_recall');
                    const isManual = card?.created_by === 'manual_editor';
                    const cstatus = String(card?.status || 'active');
                    return `
                        <div class="flex items-start gap-2 px-3 py-2.5 rounded-lg border border-border-strong bg-surface-2 group hover:border-primary-light transition-all ${cstatus !== 'active' ? 'opacity-60 grayscale' : ''}">
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-1.5 mb-1.5">
                                    <span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-border-strong bg-surface-1 text-text-muted uppercase tracking-tight">${this.escapeHtml(ctype === 'pair_match' ? wt('im.k953', 'сопост.') : wt('im.k954', 'вопр/отв'))}</span>
                                    ${isManual ? wt('im.k453', '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-info-light bg-info-lighter text-info-text uppercase tracking-tight">ручная</span>') : ''}
                                    ${cstatus !== 'active' ? `<span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-warning-light bg-warning-lighter text-warning-text uppercase tracking-tight">${this.escapeHtml(cstatus === 'archived' ? wt('im.k984', 'в архиве') : cstatus)}</span>` : ''}
                                </div>
                                <div class="text-xs font-bold text-text-main truncate">${this.escapeHtml(ft || wt('im.k454', 'Без текста'))}</div>
                                <div class="text-[11px] text-text-secondary truncate mt-0.5 italic">${this.escapeHtml(bt || '')}</div>
                            </div>
                            <div class="flex items-center gap-0.5 shrink-0 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                ${idx > 0 ? `<button onclick="event.stopPropagation(); dashboard.importManager.manualEditorMoveCard('${this.escapeInlineJsString(cid)}', -1)"
                                    class="p-1 rounded-md bg-surface-1 border border-border-subtle text-text-muted hover:text-primary hover:border-primary transition-all" title=wt('im.k603', "Сдвинуть выше")>
                                    <span class="material-symbols-outlined text-[16px]">expand_less</span>
                                </button>` : ''}
                                ${idx < cards.length - 1 ? `<button onclick="event.stopPropagation(); dashboard.importManager.manualEditorMoveCard('${this.escapeInlineJsString(cid)}', 1)"
                                    class="p-1 rounded-md bg-surface-1 border border-border-subtle text-text-muted hover:text-primary hover:border-primary transition-all" title=wt('im.k604', "Сдвинуть ниже")>
                                    <span class="material-symbols-outlined text-[16px]">expand_more</span>
                                </button>` : ''}
                                <div class="w-1"></div>
                                <button onclick="event.stopPropagation(); dashboard.importManager.manualEditorEditCardFromEncoded('${this.serializeInlineJson(card)}')"
                                    class="p-1 rounded-md bg-surface-1 border border-border-subtle text-text-muted hover:text-primary hover:border-primary transition-all" title=wt('im.k455', "Редактировать")>
                                    <span class="material-symbols-outlined text-[16px]">edit</span>
                                </button>
                                <button onclick="event.stopPropagation(); dashboard.importManager.manualEditorDeleteCard('${this.escapeInlineJsString(cid)}')"
                                    class="p-1 rounded-md bg-surface-1 border border-border-subtle text-text-muted hover:text-error hover:border-error transition-all" title=wt('im.k456', "Удалить")>
                                    <span class="material-symbols-outlined text-[16px]">delete</span>
                                </button>
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        ` : wt('im.k457', '<div class="text-sm text-text-secondary py-6 text-center">Карточек пока нет. Добавьте первую.</div>')) : '';

        return `
            <div class="grid grid-cols-1 xl:grid-cols-[0.85fr_1.35fr] gap-5">
                <div class="space-y-3">
                    <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                        <div class="text-xs font-bold text-text-main mb-3">${wt('im.k985', 'Колоды')}</div>
                        <div id="m11WorkspaceNote" class="mb-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                            <p class="text-[11px] text-text-secondary">${wt('im.k986', 'Колоды живут в общей библиотеке устройства. Прогресс повторения и будущие review остаются персональными.')}</p>
                        </div>
                        <div class="flex gap-2 mb-3">
                            <input id="m11DeckNameInput" type="text" placeholder=wt('im.k605', "Название новой колоды")
                                class="flex-1 min-w-0 px-3 py-2 text-xs rounded-lg border border-border-strong bg-surface-1 text-text-main focus:outline-none focus:ring-1 focus:ring-primary" />
                            <button onclick="dashboard.importManager.manualEditorCreateDeck()"
                                class="px-3 py-2 text-xs font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors disabled:opacity-50 shrink-0"
                                ${this.manualEditorSaving ? 'disabled' : ''}>
                                <span class="material-symbols-outlined text-[14px] align-middle">add</span> ${wt('im.k987', 'Создать')}
                            </button>
                        </div>
                        <div class="space-y-1 max-h-[340px] overflow-y-auto">${deckListHtml}</div>
                    </div>
                </div>

                <div class="space-y-3">
                    ${deck ? `
                        <div class="rounded-xl border border-border-strong bg-surface-1 p-4">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div class="min-w-0">
                                    <div class="text-sm font-bold text-text-main truncate">${this.escapeHtml(String(deck.name || deck.id || wt('im.k458', 'Колода')))}</div>
                                    <div class="text-[10px] text-text-secondary font-mono mt-0.5">${this.escapeHtml(String(deck.id || ''))}</div>
                                    <div class="mt-2 flex flex-wrap gap-1">${this.renderMicrocardsDeckOwnershipBadges(deck)}</div>
                                </div>
                                <div class="flex gap-1.5 shrink-0">
                                    ${!isArchived ? `
                                        <button onclick="dashboard.importManager.manualEditorShowCardForm('create')"
                                            class="flex items-center gap-1 px-3 py-1.5 text-[11px] font-bold rounded-lg bg-primary text-primary-fg hover:bg-primary-hover transition-colors">
                                            <span class="material-symbols-outlined text-[14px]">add</span> ${wt('im.k988', 'Карточка')}
                                        </button>
                                    ` : ''}
                                    <button onclick="dashboard.importManager.openMicrocardsDeckQueue('${this.escapeInlineJsString(String(deck.id))}')"
                                        class="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors"
                                        title="${wt('im.k946', 'Открыть в Микрокарточках')}">
                                        <span class="material-symbols-outlined text-[14px]">open_in_new</span>
                                    </button>
                                    <button onclick="dashboard.importManager.manualEditorDeleteDeck('${this.escapeInlineJsString(String(deck.id))}')"
                                        class="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-error-light text-error-text hover:bg-error-lighter transition-colors"
                                        title=wt('im.k462', "Удалить колоду")>
                                        <span class="material-symbols-outlined text-[14px]">delete</span>
                                    </button>
                                </div>
                            </div>
                            <div class="flex items-center gap-3 text-[11px] text-text-secondary mb-3">
                                <span>${cards.length} ${wt('im.k989', 'карт.')}</span>
                                ${deck.meta?.source === 'manual_editor' ? '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-info-light bg-info-lighter text-info-text">manual</span>' : ''}
                                ${isArchived ? wt('im.k463', '<span class="px-1.5 py-0.5 rounded text-[9px] font-bold border border-warning-light bg-warning-lighter text-warning-text">архив</span>') : ''}
                            </div>
                            <div class="mb-3 rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2">
                                <p class="text-[11px] text-text-secondary">${wt('im.k990', 'Изменения в этой колоде увидят все профили устройства, а история повторения останется только у текущего пользователя.')}</p>
                            </div>
                            ${cardFormHtml}
                            ${this.manualEditorDeckLoading ? wt('im.k464', '<div class="text-sm text-text-secondary py-4 text-center">Загрузка карточек...</div>') : cardListHtml}
                        </div>
                    ` : `
                        <div class="rounded-xl border border-border-strong bg-surface-1 p-8 text-center">
                            <span class="material-symbols-outlined text-border-strong text-[40px] mb-2">style</span>
                            <p class="text-sm font-semibold text-text-main">${wt('im.k991', 'Выберите колоду')}</p>
                            <p class="text-xs text-text-secondary mt-1">${wt('im.k992', 'Выберите колоду слева для просмотра и редактирования карточек, или создайте новую.')}</p>
                        </div>
                    `}
                </div>
            </div>
        `;
    }

    renderTheoryAnalysisReportBody(a, vm = {}) {
        let structuredHtml = '';
        let rendererError = null;
        try {
            structuredHtml = this.renderTheoryAnalysisStructuredReport(a);
        } catch (e) {
            rendererError = e;
            console.error('[TheoryReport][renderer] report_blocks render failed, using fallback:', e);
        }

        if (structuredHtml) {
            return structuredHtml;
        }

        const blocks = Array.isArray(a?.report_blocks) ? a.report_blocks : [];
        const lint = (a && typeof a === 'object' && a.report_lint && typeof a.report_lint === 'object') ? a.report_lint : {};
        let reasonText = '';
        if (rendererError) {
            reasonText = this.aiUxMessage('theory_report.fallback.renderer_error', wt('im.k465', 'Структурный renderer отчёта завершился ошибкой. Показан fallback-отчёт из analysis_json.'));
        } else if (!blocks.length) {
            reasonText = this.aiUxMessage('theory_report.fallback.missing_blocks', wt('im.k466', 'Структурные report_blocks отсутствуют. Показан fallback-отчёт из analysis_json.'));
        } else if (lint.fallback_renderer_recommended) {
            reasonText = this.aiUxMessage('theory_report.fallback.lint_recommended', wt('im.k467', 'Backend пометил layout как рискованный/частично невалидный. Показан fallback-отчёт из analysis_json.'));
        }

        const noteHtml = reasonText ? `
            <div class="mb-3 p-3 rounded-lg bg-surface-2 shadow-sm">
                <div class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-[18px] text-text-secondary mt-0.5">info</span>
                    <div class="min-w-0">
                        <p class="text-xs font-semibold text-text-main">${wt('im.k993', 'Резервный рендерер')}</p>
                        <p class="text-xs text-text-secondary mt-1">${this.escapeHtml(reasonText)}</p>
                    </div>
                </div>
            </div>
        ` : '';
        return `${noteHtml}${this.renderTheoryAnalysisFallbackReportGrid(a, vm)}`;
    }

    renderTheoryAnalysisStructuredReport(a) {
        if (!this.isTheoryFeatureEnabled('analysis_report_renderer_v1')) return '';
        const rawBlocks = Array.isArray(a?.report_blocks) ? a.report_blocks.filter(b => b && typeof b === 'object') : [];
        if (!rawBlocks.length) return '';
        if (a?.report_lint?.fallback_renderer_recommended) return '';

        const blocks = this.sortTheoryReportBlocks(rawBlocks);
        const nonTocBlocks = blocks.filter(block => (block.type || '').toLowerCase() !== 'toc');
        if (!nonTocBlocks.length) return '';

        const compactMode = (a?.report_lint?.verbosity_risk || '').toLowerCase() === 'high';
        const ctx = this.buildTheoryReportRenderContext(a, blocks);
        const tocBlocks = blocks.filter(block => (block.type || '').toLowerCase() === 'toc');
        const fixedProgressionsSectionHtml = this.renderTheoryReportFixedProgressionsSection(ctx, blocks);

        const metaCards = [
            this.renderTheoryReportMetaCard(a, compactMode),
            this.renderTheoryReportWarningsCard(a),
        ].filter(Boolean).join('');

        const sidebarHtml = tocBlocks.length ? `
            <aside class="2xl:sticky 2xl:top-0 self-start space-y-3">
                ${metaCards}
                ${tocBlocks.map(block => this.renderTheoryReportBlock(block, ctx)).join('')}
            </aside>
        ` : '';

        const technicalBlockTypes = ['coverage_plan', 'progression_matrix'];
        const technicalBlocks = nonTocBlocks.filter(b => technicalBlockTypes.includes(String(b?.type || '').toLowerCase()));
        const standardBlocks = nonTocBlocks.filter(b => !technicalBlockTypes.includes(String(b?.type || '').toLowerCase()));

        const technicalAccordionHtml = (fixedProgressionsSectionHtml || technicalBlocks.length) ? `
            <details class="group rounded-xl border border-border-strong bg-surface-2 mt-4">
                <summary class="flex items-center justify-between p-3 cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xl">
                    <div class="flex items-center gap-2">
                        <span class="material-symbols-outlined text-[20px] text-text-secondary group-open:rotate-180 transition-transform">expand_more</span>
                        <span class="text-sm font-semibold text-text-main">${wt('im.k994', 'Технические детали')}</span>
                        <span class="text-[11px] text-text-secondary hidden sm:inline">(coverage, progressions, config)</span>
                    </div>
                </summary>
                <div class="p-3 pt-0 space-y-3 border-t border-border-subtle mt-1 opacity-0 group-open:opacity-100 transition-opacity">
                    ${fixedProgressionsSectionHtml}
                    ${technicalBlocks.map(block => this.renderTheoryReportBlock(block, ctx)).join('')}
                </div>
            </details>
        ` : '';

        const mainHtml = `
            <div class="min-w-0 space-y-3">
                ${!tocBlocks.length ? metaCards : ''}
                ${compactMode ? `
                    <div class="p-3 rounded-lg border border-warning-light bg-warning-lighter">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-[18px] text-warning-text mt-0.5">compress</span>
                            <div class="min-w-0">
                                <p class="text-xs font-semibold text-text-main">${wt('im.k995', 'Компактный режим')}</p>
                                <p class="text-xs text-text-secondary mt-1">
                                    report_lint: verbosity_risk=${this.escapeHtml(String(a?.report_lint?.verbosity_risk || 'unknown'))},
                                    duplicates=${this.escapeHtml(String(a?.report_lint?.duplicate_content_signals ?? 0))}.
                                </p>
                            </div>
                        </div>
                    </div>
                ` : ''}
                ${standardBlocks.map(block => this.renderTheoryReportBlock(block, ctx)).join('')}
                ${technicalAccordionHtml}
            </div>
        `;

        if (!tocBlocks.length) {
            return mainHtml;
        }

        return `
            <div class="grid grid-cols-1 2xl:grid-cols-[18rem_minmax(0,1fr)] gap-4">
                ${sidebarHtml}
                ${mainHtml}
            </div>
        `;
    }

    sortTheoryReportBlocks(blocks) {
        return [...(Array.isArray(blocks) ? blocks : [])]
            .map((block, index) => ({ block, index }))
            .sort((a, b) => {
                const pa = Number.isFinite(Number(a.block?.priority)) ? Number(a.block.priority) : 0;
                const pb = Number.isFinite(Number(b.block?.priority)) ? Number(b.block.priority) : 0;
                if (pb !== pa) return pb - pa;
                const ta = (a.block?.type || '').toLowerCase();
                const tb = (b.block?.type || '').toLowerCase();
                if (ta === 'toc' && tb !== 'toc') return -1;
                if (tb === 'toc' && ta !== 'toc') return 1;
                return a.index - b.index;
            })
            .map(item => item.block);
    }

    buildTheoryReportRenderContext(a, blocks) {
        const units = Array.isArray(a?.educational_units) ? a.educational_units : [];
        const chunks = Array.isArray(a?.learning_chunks) ? a.learning_chunks : [];
        const routes = Array.isArray(a?.authoring_routes) ? a.authoring_routes : [];
        const typeEntries = Array.isArray(a?.type_progression_suitability) ? a.type_progression_suitability : [];
        const microcards = Array.isArray(a?.microcards_candidates) ? a.microcards_candidates : [];
        const futureCaps = Array.isArray(a?.future_capabilities) ? a.future_capabilities : [];
        const coveragePlan = (a && typeof a === 'object' && a.coverage_plan && typeof a.coverage_plan === 'object') ? a.coverage_plan : {};

        const unitById = new Map(units.map(unit => [String(unit?.id ?? ''), unit]));
        const chunkById = new Map(chunks.map(chunk => [String(chunk?.id ?? ''), chunk]));
        const routeById = new Map(routes.map(route => [String(route?.id ?? ''), route]));
        const typeEntriesByTaskType = new Map();
        typeEntries.forEach((entry) => {
            const key = String(entry?.task_type || '').toUpperCase();
            if (!key) return;
            const list = typeEntriesByTaskType.get(key) || [];
            list.push(entry);
            typeEntriesByTaskType.set(key, list);
        });

        const routeBlockAnchorById = new Map();
        const chunkBlockAnchorById = new Map();
        (Array.isArray(blocks) ? blocks : []).forEach((block) => {
            if (!block || typeof block !== 'object' || !block.anchor || !block.body || typeof block.body !== 'object') return;
            if (String(block.type || '').toLowerCase() === 'route_card' && block.body.route_id) {
                routeBlockAnchorById.set(String(block.body.route_id), String(block.anchor));
            }
            if (String(block.type || '').toLowerCase() === 'chunk_card' && block.body.chunk_id) {
                chunkBlockAnchorById.set(String(block.body.chunk_id), String(block.anchor));
            }
        });

        return {
            units,
            chunks,
            routes,
            typeEntries,
            microcards,
            futureCaps,
            coveragePlan,
            unitById,
            chunkById,
            routeById,
            typeEntriesByTaskType,
            routeBlockAnchorById,
            chunkBlockAnchorById,
        };
    }

    renderTheoryReportMetaCard(a, compactMode = false) {
        const units = Array.isArray(a?.educational_units) ? a.educational_units.length : 0;
        const chunks = Array.isArray(a?.learning_chunks) ? a.learning_chunks.length : 0;
        const routes = Array.isArray(a?.authoring_routes) ? a.authoring_routes.length : 0;
        const materialLang = a?.material_language || a?.material_stats?.language || a?.target_language || 'unknown';
        const outputLang = a?.effective_output_language || a?.target_language || 'unknown';
        const lint = (a && typeof a === 'object' && a.report_lint && typeof a.report_lint === 'object') ? a.report_lint : {};
        return `
            <section class="rounded-xl border border-border-strong bg-surface-2 p-3">
                <div class="flex items-start justify-between gap-2 mb-3">
                    <div>
                        <div class="text-xs font-semibold uppercase tracking-wide text-text-secondary">${wt('im.k996', 'Метаданные отчёта')}</div>
                        <div class="text-[11px] text-text-secondary mt-1">
                            ${a?.report_blocks_version ? `report_blocks v${this.escapeHtml(String(a.report_blocks_version))}` : wt('im.k468', 'устаревш.')}
                            ${a?.analysis_schema_version ? ` · ${wt('im.k713', 'схема')} ${this.escapeHtml(String(a.analysis_schema_version))}` : ''}
                        </div>
                    </div>
                    ${compactMode ? `<span class="px-2 py-0.5 rounded-full text-[10px] border border-warning-light bg-warning-lighter text-warning-text">${wt('im.k997', 'компактный')}</span>` : ''}
                </div>
                <div class="flex flex-wrap gap-2 text-xs">
                    <div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-1 border border-border-strong text-text-secondary"><span class="material-symbols-outlined text-[14px]">school</span> ${wt('im.k469', 'Единиц <span class="font-semibold text-text-main">')}${units}</span></div>
                    <div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-1 border border-border-strong text-text-secondary"><span class="material-symbols-outlined text-[14px]">segment</span> ${wt('im.k470', 'Фрагментов <span class="font-semibold text-text-main">')}${chunks}</span></div>
                    <div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-1 border border-border-strong text-text-secondary"><span class="material-symbols-outlined text-[14px]">route</span> ${wt('im.k471', 'Маршрутов <span class="font-semibold text-text-main">')}${routes}</span></div>
                    ${lint.duplicate_content_signals ? `<div class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-warning-lighter border border-warning-light text-warning-text"><span class="material-symbols-outlined text-[14px]">content_copy</span> ${wt('im.k998', 'Дубли')} <span class="font-semibold">${this.escapeHtml(String(lint.duplicate_content_signals))}</span></div>` : ''}
                </div>
                <div class="mt-3 text-[11px] text-text-secondary flex flex-wrap gap-y-1 gap-x-3">
                    <p>${wt('im.k472', 'Язык контента: <span class="text-text-main">')}${this.escapeHtml(String(materialLang))}</span></p>
                    <p>${wt('im.k473', 'Язык анализа: <span class="text-text-main">')}${this.escapeHtml(String(outputLang))}</span></p>
                    ${a?.provider_used ? `<p>${wt('im.k999', 'ИИ-модель:')} <span class="text-text-main">${this.escapeHtml(String(a.provider_used))}${a?.provider_model ? ` (${this.escapeHtml(String(a.provider_model))})` : ''}</span></p>` : ''}
                </div>
                ${a?.human_summary ? `<p class="text-xs text-text-main mt-3 leading-relaxed border-t border-border-subtle pt-2">${this.escapeHtml(String(a.human_summary))}</p>` : ''}
            </section>
        `;
    }

    renderTheoryReportWarningsCard(a) {
        const warnings = Array.isArray(a?.warnings) ? a.warnings.filter(Boolean) : [];
        if (!warnings.length) return '';
        return `
            <section class="rounded-xl border border-border-strong bg-surface-2 p-3">
                <div class="flex items-center gap-1.5 mb-2">
                    <span class="material-symbols-outlined text-[16px] text-text-secondary">warning</span>
                    <div class="text-xs font-semibold uppercase tracking-wide text-text-main">${wt('im.k887', 'Предупреждения')}</div>
                </div>
                <div class="space-y-1">
                    ${warnings.slice(0, 8).map(w => `<p class="text-xs text-text-main">${this.escapeHtml(String(w))}</p>`).join('')}
                    ${warnings.length > 8 ? `<p class="text-[11px] text-text-secondary">${wt('im.k1000', 'Показаны первые 8 из')} ${warnings.length}</p>` : ''}
                </div>
            </section>
        `;
    }

    theoryReportToneStyles(tone) {
        const t = String(tone || 'neutral').toLowerCase();
        const map = {
            neutral: { wrapper: 'border-border-strong bg-surface-2', badge: 'border-border-strong bg-surface-1 text-text-secondary' },
            info: { wrapper: 'border-info-light bg-info-lighter', badge: 'border-info-light bg-surface-1 text-text-main' },
            success: { wrapper: 'border-success-light bg-success-lighter', badge: 'border-success-light bg-surface-1 text-text-main' },
            warning: { wrapper: 'border-warning-light bg-warning-lighter', badge: 'border-warning-light bg-surface-1 text-text-main' },
            risk: { wrapper: 'border-error-light bg-error-lighter', badge: 'border-error-light bg-surface-1 text-text-main' },
        };
        return map[t] || map.neutral;
    }

    theoryReportSuitabilityBadgeClass(suitability) {
        const value = String(suitability || 'medium').toLowerCase();
        if (value === 'high') return 'border-success-light bg-success-lighter text-text-main';
        if (value === 'medium') return 'border-info-light bg-info-lighter text-text-main';
        if (value === 'low') return 'border-warning-light bg-warning-lighter text-text-main';
        return 'border-error-light bg-error-lighter text-text-main';
    }

    theoryReportPriorityBadgeClass(priority) {
        const value = String(priority || 'medium').toLowerCase();
        if (value === 'high') return 'border-success-light bg-success-lighter text-text-main';
        if (value === 'low') return 'border-border-strong bg-surface-1 text-text-secondary';
        return 'border-info-light bg-info-lighter text-text-main';
    }

    theoryReportSortedTypeEntries(entries) {
        const priorityRank = { high: 2, medium: 1, low: 0 };
        const suitabilityRank = { high: 3, medium: 2, low: 1, not_recommended: 0 };
        return [...(Array.isArray(entries) ? entries : [])].sort((a, b) => {
            const pa = priorityRank[String(a?.priority || 'medium').toLowerCase()] ?? 1;
            const pb = priorityRank[String(b?.priority || 'medium').toLowerCase()] ?? 1;
            if (pb !== pa) return pb - pa;
            const sa = suitabilityRank[String(a?.suitability || 'medium').toLowerCase()] ?? 1;
            const sb = suitabilityRank[String(b?.suitability || 'medium').toLowerCase()] ?? 1;
            if (sb !== sa) return sb - sa;
            return String(a?.task_type || '').localeCompare(String(b?.task_type || ''));
        });
    }

    theoryReportLevelRoleMapToHtml(levelRoleMap, { max = 4, lineClass = 'text-[11px] text-text-secondary', emptyText = wt('im.k474', 'Роли уровней не указаны.') } = {}) {
        const rows = Array.isArray(levelRoleMap)
            ? levelRoleMap
                .filter((row) => row && Number.isFinite(Number(row.level)) && String(row.role || '').trim())
                .sort((a, b) => Number(a.level) - Number(b.level))
                .slice(0, max)
            : [];
        if (!rows.length) return `<div class="${lineClass}">${this.escapeHtml(String(emptyText))}</div>`;
        return `
            <div class="space-y-1">
                ${rows.map((row) => `
                    <div>
                        <div class="${lineClass}"><span class="font-semibold text-text-main">L${this.escapeHtml(String(row.level))}</span>: ${this.escapeHtml(String(row.role || ''))}</div>
                        ${row?.value_for_material ? `<div class="text-[11px] text-text-secondary/90">${this.escapeHtml(String(row.value_for_material))}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderTheoryReportFixedProgressionPolicyNote(typeEntries, { compact = false } = {}) {
        const entries = Array.isArray(typeEntries) ? typeEntries : [];
        const fixedEntries = entries.filter(entry => entry?.progression_is_fixed);
        if (!fixedEntries.length) return '';
        const coreFixedCount = fixedEntries.filter(entry => String(entry?.complex_role || '').toLowerCase() === 'core').length;
        const matrixSuffix = compact ? '' : wt('im.k606', ' Ниже уровни показаны как роли внутри progression каждого типа.');
        return `
            <div class="p-3 rounded-lg border border-border-strong bg-surface-1">
                <div class="flex items-start gap-2">
                    <span class="material-symbols-outlined text-[18px] text-text-secondary mt-0.5">schema</span>
                    <div class="min-w-0">
                        <p class="text-xs font-semibold text-text-main uppercase tracking-wide">${wt('im.k1001', 'Как читать уровни')}</p>
                        <p class="text-xs text-text-main mt-1">
                            ${wt('im.k1002', 'Для типов с')} <strong class="font-semibold">fixed progression</strong> ${wt('im.k1003', 'уровни не выбираются как отдельная ручная опция.')}
                            ${wt('im.k475', 'В комплексах это части одной progression; пользователь выбирает сам тип и приоритетные units/chunks.')}${matrixSuffix}
                        </p>
                        <div class="flex flex-wrap gap-1 mt-2">
                            <span class="px-1.5 py-0.5 rounded-md text-[10px] font-medium text-text-main">fixed types: ${this.escapeHtml(String(fixedEntries.length))}</span>
                            ${coreFixedCount ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] font-medium text-text-secondary">core in complexes: ${this.escapeHtml(String(coreFixedCount))}</span>` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    renderTheoryReportProgressionSummaryCards(ctx, { maxItems = 6 } = {}) {
        const allEntries = Array.isArray(ctx?.typeEntries) ? ctx.typeEntries : [];
        const entries = this.theoryReportSortedTypeEntries(allEntries)
            .filter(entry => entry?.progression_is_fixed)
            .slice(0, Math.max(1, maxItems));
        if (!entries.length) return '';

        return `
            <div class="space-y-2">
                ${entries.map((entry) => {
                    const taskType = String(entry?.task_type || 'UNKNOWN').toUpperCase();
                    const subtypeText = String(entry?.subtype || '').trim();
                    const suitability = String(entry?.suitability || 'medium').toLowerCase();
                    const priority = String(entry?.priority || 'medium').toLowerCase();
                    const role = String(entry?.complex_role || 'none').toLowerCase();
                    const availability = String(entry?.availability || '').trim();
                    const levelRoleMap = Array.isArray(entry?.level_role_map) ? entry.level_role_map : [];
                    const levelLabels = levelRoleMap
                        .map(row => Number(row?.level))
                        .filter(Number.isFinite)
                        .sort((a, b) => a - b)
                        .map(level => `L${level}`);
                    const seqIntents = Array.isArray(entry?.sequence_intents) ? entry.sequence_intents : [];
                    const iterativeNotes = Array.isArray(entry?.iterative_system_notes) ? entry.iterative_system_notes.filter(Boolean) : [];

                    return `
                        <div class="rounded-lg border border-border-strong bg-surface-1 p-2">
                            <div class="flex flex-wrap items-center gap-1.5">
                                <span class="text-xs font-semibold text-text-main">${this.escapeHtml(taskType)}${subtypeText ? ` / ${this.escapeHtml(subtypeText)}` : ''}</span>
                                <span class="px-1 py-0.5 rounded-md text-[10px] font-medium text-text-main">${this.escapeHtml(suitability)}</span>
                                <span class="px-1 py-0.5 rounded-md text-[10px] font-medium text-text-secondary">${this.escapeHtml(priority)}</span>
                                ${availability ? `<span class="px-1 py-0.5 rounded-md text-[10px] text-text-secondary">${this.escapeHtml(availability)}</span>` : ''}
                                ${role && role !== 'none' ? `<span class="px-1 py-0.5 rounded-md text-[10px] text-text-secondary">${this.escapeHtml(role)}</span>` : ''}
                            </div>
                            ${levelLabels.length ? `<div class="text-[11px] text-text-secondary mt-1">${wt('im.k1004', 'Уровни в progression:')} ${this.escapeHtml(levelLabels.join(', '))}</div>` : ''}
                            <div class="mt-2">${this.theoryReportLevelRoleMapToHtml(levelRoleMap, { max: 3, emptyText: wt('im.k476', 'Роли уровней не указаны в анализе.') })}</div>
                            ${iterativeNotes.length ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(String(iterativeNotes[0]))}</p>` : ''}
                            ${entry?.why ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(String(entry.why))}</p>` : ''}
                            ${seqIntents.length ? `<div class="flex flex-wrap gap-1 mt-2">${seqIntents.slice(0, 5).map(intent => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(intent))}</span>`).join('')}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    renderTheoryReportFixedProgressionsSection(ctx, blocks = []) {
        const typeEntries = Array.isArray(ctx?.typeEntries) ? ctx.typeEntries : [];
        if (!typeEntries.some(entry => entry?.progression_is_fixed)) return '';
        const progressionMatrixBlock = (Array.isArray(blocks) ? blocks : []).find(
            block => String(block?.type || '').toLowerCase() === 'progression_matrix'
        );
        const matrixAnchor = String(progressionMatrixBlock?.anchor || '').trim();
        const summaryCardsHtml = this.renderTheoryReportProgressionSummaryCards(ctx, { maxItems: 5 });
        return `
            <section class="rounded-xl border border-border-strong bg-surface-2 p-3">
                <div class="flex flex-wrap items-start justify-between gap-2 mb-3">
                    <div class="min-w-0">
                        <div class="text-xs font-semibold uppercase tracking-wide text-text-main">${wt('im.k1005', 'Типы как progressions')}</div>
                        <div class="text-[11px] text-text-secondary mt-1">${wt('im.k1006', 'Детерминированное объяснение fixed progression уровней (P10), независимо от AI-layout.')}</div>
                    </div>
                    ${matrixAnchor ? this.renderTheoryReportJumpButton(wt('im.k714', 'К матрице уровней'), matrixAnchor) : ''}
                </div>
                ${this.renderTheoryReportFixedProgressionPolicyNote(typeEntries)}
                ${summaryCardsHtml ? `<div class="mt-3">${summaryCardsHtml}</div>` : ''}
            </section>
        `;
    }

    theoryReportListToHtml(items, { max = 8, className = 'text-xs text-text-secondary', bulletClass = 'text-text-muted' } = {}) {
        const values = Array.isArray(items) ? items.filter(Boolean).slice(0, max) : [];
        if (!values.length) return '';
        return `
            <ul class="space-y-1">
                ${values.map(item => `
                    <li class="flex items-start gap-2">
                        <span class="mt-[2px] text-[10px] ${bulletClass}">•</span>
                        <span class="${className}">${this.escapeHtml(String(item))}</span>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    theoryReportRefsMeta(refs) {
        if (!refs || typeof refs !== 'object') return '';
        const parts = [];
        const unitIds = Array.isArray(refs.unit_ids) ? refs.unit_ids : [];
        const chunkIds = Array.isArray(refs.chunk_ids) ? refs.chunk_ids : [];
        const routeIds = Array.isArray(refs.route_ids) ? refs.route_ids : [];
        if (unitIds.length) parts.push(`units ${unitIds.length}`);
        if (chunkIds.length) parts.push(`chunks ${chunkIds.length}`);
        if (routeIds.length) parts.push(`routes ${routeIds.length}`);
        if (!parts.length) return '';
        return `
            <div class="flex flex-wrap gap-1">
                ${parts.map(part => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(part)}</span>`).join('')}
            </div>
        `;
    }

    isTheoryReportBlockCollapsed(block) {
        const id = String(block?.id || '').trim();
        if (!id) return false;
        if (this.theoryReportBlockCollapseState.has(id)) {
            return !!this.theoryReportBlockCollapseState.get(id);
        }
        const btype = String(block?.type || '').toLowerCase();
        if (['coverage_plan', 'progression_matrix'].includes(btype)) return true;
        return !!block?.collapsed_by_default;
    }

    prefersReducedMotion() {
        try {
            return !!(window?.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
        } catch (_) {
            return false;
        }
    }

    toggleTheoryReportBlockCollapse(blockId) {
        const id = String(blockId || '').trim();
        if (!id) return;
        const blocks = Array.isArray(this.analysisResult?.report_blocks) ? this.analysisResult.report_blocks : [];
        const block = blocks.find(item => String(item?.id || '') === id);
        const current = block ? this.isTheoryReportBlockCollapsed(block) : !!this.theoryReportBlockCollapseState.get(id);
        const nextCollapsed = !current;
        this.theoryReportBlockCollapseState.set(id, nextCollapsed);

        const section = Array.from(document.querySelectorAll('[data-report-block-id]'))
            .find(el => String(el?.getAttribute('data-report-block-id') || '') === id);
        const content = section?.querySelector(`[data-role="theory-report-block-content"][data-block-id="${id}"]`);
        const header = section?.querySelector('[data-role="theory-report-block-header"]');
        const toggleBtn = section?.querySelector('[data-role="theory-report-block-toggle-btn"]');
        const toggleIcon = toggleBtn?.querySelector('[data-role="theory-report-block-toggle-icon"]');
        const toggleLabel = toggleBtn?.querySelector('[data-role="theory-report-block-toggle-label"]');

        if (!section || !content || !toggleBtn) {
            if (this.modalPurpose === 'theory_analysis') {
                this.renderTheoryAnalysisMode();
            } else {
                this.renderCurrentStep();
            }
            return;
        }

        const setHeaderCollapsedSpacing = (isCollapsedState) => {
            if (!header) return;
            header.classList.toggle('mb-3', !isCollapsedState);
        };
        toggleBtn.setAttribute('aria-expanded', String(!nextCollapsed));
        if (toggleIcon) toggleIcon.textContent = nextCollapsed ? 'expand_more' : 'expand_less';
        if (toggleLabel) toggleLabel.textContent = nextCollapsed ? wt('im.k477', 'Открыть') : wt('im.k478', 'Свернуть');

        if (content.__rpHideTimer) {
            window.clearTimeout(content.__rpHideTimer);
            content.__rpHideTimer = null;
        }

        const setExpandedClasses = () => {
            content.classList.remove('hidden', 'opacity-0', 'translate-y-1', 'pointer-events-none');
            content.classList.add('opacity-100', 'translate-y-0');
        };
        const setCollapsedClasses = () => {
            content.classList.add('hidden', 'opacity-0', 'translate-y-1', 'pointer-events-none');
            content.classList.remove('opacity-100', 'translate-y-0');
        };
        const raf = (cb) => {
            if (window?.requestAnimationFrame) {
                window.requestAnimationFrame(cb);
            } else {
                window.setTimeout(cb, 0);
            }
        };

        if (this.prefersReducedMotion()) {
            setHeaderCollapsedSpacing(nextCollapsed);
            if (nextCollapsed) setCollapsedClasses();
            else setExpandedClasses();
            return;
        }

        if (nextCollapsed) {
            setHeaderCollapsedSpacing(false);
            content.classList.remove('hidden', 'pointer-events-none');
            content.classList.remove('opacity-0', 'translate-y-1');
            content.classList.add('opacity-100', 'translate-y-0');
            raf(() => {
                content.classList.remove('opacity-100', 'translate-y-0');
                content.classList.add('opacity-0', 'translate-y-1');
                content.__rpHideTimer = window.setTimeout(() => {
                    setCollapsedClasses();
                    setHeaderCollapsedSpacing(true);
                    content.__rpHideTimer = null;
                }, 140);
            });
            return;
        }

        setHeaderCollapsedSpacing(false);
        content.classList.remove('hidden', 'pointer-events-none');
        content.classList.remove('opacity-100', 'translate-y-0');
        content.classList.add('opacity-0', 'translate-y-1');
        raf(() => {
            content.classList.remove('opacity-0', 'translate-y-1');
            content.classList.add('opacity-100', 'translate-y-0');
        });
    }

    scrollTheoryReportToAnchor(anchor) {
        const targetAnchor = String(anchor || '').trim().toLowerCase();
        if (!targetAnchor) return;
        this.theoryReportActiveAnchor = targetAnchor;
        if (this.theoryReportPanelOpen === false) {
            this.toggleTheoryAnalysisReportPanel(true);
        }

        const body = document.querySelector('[data-role="theory-analysis-report-body"]');
        if (!body) return;
        const candidates = body.querySelectorAll('[data-report-anchor]');
        let targetEl = null;
        for (const el of candidates) {
            if ((el.dataset?.reportAnchor || '').toLowerCase() === targetAnchor) {
                targetEl = el;
                break;
            }
        }
        if (!targetEl) return;

        const bodyRect = body.getBoundingClientRect();
        const targetRect = targetEl.getBoundingClientRect();
        const nextTop = Math.max(0, body.scrollTop + (targetRect.top - bodyRect.top) - 10);
        const reduceMotion = this.prefersReducedMotion();
        try {
            body.scrollTo({ top: nextTop, behavior: reduceMotion ? 'auto' : 'smooth' });
        } catch (_) {
            body.scrollTop = nextTop;
        }
        if (reduceMotion) return;

        if (this.theoryReportAnchorHighlightTimer) {
            window.clearTimeout(this.theoryReportAnchorHighlightTimer);
            this.theoryReportAnchorHighlightTimer = null;
        }
        candidates.forEach((el) => el.classList.remove('ring-2', 'ring-primary/30'));
        targetEl.classList.add('ring-2', 'ring-primary/30');
        this.theoryReportAnchorHighlightTimer = window.setTimeout(() => {
            targetEl.classList.remove('ring-2', 'ring-primary/30');
            this.theoryReportAnchorHighlightTimer = null;
        }, 900);
    }

    renderTheoryReportJumpButton(label, anchor, { compact = false } = {}) {
        const anchorText = String(anchor || '').trim();
        if (!anchorText) return `<span class="text-xs text-text-secondary">${this.escapeHtml(String(label || ''))}</span>`;
        const isActive = String(this.theoryReportActiveAnchor || '').toLowerCase() === anchorText.toLowerCase();
        const baseClass = compact
            ? 'w-full text-left px-2 py-1.5 rounded-md text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40'
            : 'inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40';
        const stateClass = isActive
            ? 'border-primary bg-primary-lighter text-primary'
            : 'border-border-strong bg-surface-1 text-text-secondary hover:bg-bg-hover';
        return `
            <button type="button"
                onclick="dashboard.importManager.scrollTheoryReportToAnchor('${this.escapeInlineJsString(anchorText)}')"
                class="${baseClass} ${stateClass}">
                ${!compact ? '<span class="material-symbols-outlined text-[14px]">link</span>' : ''}
                <span class="truncate">${this.escapeHtml(String(label || anchorText))}</span>
            </button>
        `;
    }

    renderTheoryReportBlock(block, ctx) {
        const btype = String(block?.type || '').toLowerCase();
        if (!btype) return '';
        if (btype === 'divider') {
            return this.renderTheoryReportDividerBlock(block);
        }

        let contentHtml = '';
        let toneOverride = null;
        if (btype === 'toc') {
            contentHtml = this.renderTheoryReportTocBlock(block);
            toneOverride = 'info';
        } else if (btype === 'section') {
            contentHtml = this.renderTheoryReportSectionBlock(block);
        } else if (btype === 'callout') {
            const rendered = this.renderTheoryReportCalloutBlock(block);
            contentHtml = rendered.html;
            toneOverride = rendered.tone;
        } else if (btype === 'list') {
            contentHtml = this.renderTheoryReportListBlock(block);
        } else if (btype === 'chunk_card') {
            contentHtml = this.renderTheoryReportChunkCardBlock(block, ctx);
            toneOverride = 'info';
        } else if (btype === 'progression_matrix') {
            contentHtml = this.renderTheoryReportProgressionMatrixBlock(block, ctx);
            toneOverride = 'success';
        } else if (btype === 'route_card') {
            contentHtml = this.renderTheoryReportRouteCardBlock(block, ctx);
            toneOverride = 'success';
        } else if (btype === 'coverage_table') {
            contentHtml = this.renderTheoryReportCoverageTableBlock(block, ctx);
            toneOverride = 'warning';
        } else if (btype === 'microcards_preview') {
            contentHtml = this.renderTheoryReportMicrocardsPreviewBlock(block, ctx);
            toneOverride = 'info';
        } else {
            return '';
        }

        if (!contentHtml) return '';
        return this.renderTheoryReportBlockShell(block, contentHtml, { toneOverride });
    }

    renderTheoryReportBlockShell(block, contentHtml, { toneOverride = null } = {}) {
        const tone = String(toneOverride || block?.tone || 'neutral').toLowerCase();
        const styles = this.theoryReportToneStyles(tone);
        const collapsible = !!block?.collapsible;
        const collapsed = collapsible && this.isTheoryReportBlockCollapsed(block);
        const blockId = String(block?.id || '').trim();
        const title = String(block?.title || '').trim();
        const anchor = String(block?.anchor || '').trim();
        const refsHtml = this.theoryReportRefsMeta(block?.refs);
        const blockRefs = (block && typeof block.refs === 'object') ? block.refs : null;
        const linkableUnitRefs = Array.isArray(blockRefs?.unit_ids) ? blockRefs.unit_ids.filter(v => v != null) : [];
        const linkableChunkRefs = Array.isArray(blockRefs?.chunk_ids) ? blockRefs.chunk_ids.filter(Boolean) : [];
        const canSendToEditor = !!(this.aiRunId && (linkableUnitRefs.length || linkableChunkRefs.length));
        const anchorAttr = anchor ? ` data-report-anchor="${this.escapeHtml(anchor)}"` : '';
        const activeClass = anchor && String(this.theoryReportActiveAnchor || '').toLowerCase() === anchor.toLowerCase()
            ? ' ring-2 ring-primary/25'
            : '';

        return `
            <section class="rounded-xl border ${styles.wrapper} p-3${activeClass}" data-report-block-id="${this.escapeHtml(blockId)}"${anchorAttr}>
                ${(title || collapsible || refsHtml) ? `
                    <div data-role="theory-report-block-header" class="flex items-start justify-between gap-2 ${collapsed ? '' : 'mb-3'}">
                        <div class="min-w-0 flex-1">
                            ${title ? `<h5 class="text-sm font-semibold text-text-main">${this.escapeHtml(title)}</h5>` : ''}
                            <div class="flex flex-wrap items-center gap-1.5 mt-1">
                                ${tone !== 'neutral' ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border ${styles.badge}">${this.escapeHtml(tone)}</span>` : ''}
                                ${anchor ? this.renderTheoryReportJumpButton(anchor, anchor) : ''}
                                ${canSendToEditor ? `
                                    <button type="button"
                                        onclick="dashboard.importManager.pushTheoryReportBlockContextForEditor('${this.escapeInlineJsString(blockId)}')"
                                        class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text hover:bg-info-light transition-colors">
                                        <span class="material-symbols-outlined text-[12px]">open_in_new</span>
                                        <span>${wt('im.k1007', 'В редактор')}</span>
                                    </button>
                                ` : ''}
                                ${refsHtml}
                            </div>
                        </div>
                        ${collapsible ? `
                            <button type="button"
                                data-role="theory-report-block-toggle-btn"
                                aria-expanded="${collapsed ? 'false' : 'true'}"
                                onclick="dashboard.importManager.toggleTheoryReportBlockCollapse('${this.escapeInlineJsString(blockId)}')"
                                class="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md border border-border-strong bg-surface-1 text-text-secondary hover:bg-bg-hover text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                                <span data-role="theory-report-block-toggle-icon" class="material-symbols-outlined text-[15px] transition-transform duration-150 ease-out">${collapsed ? 'expand_more' : 'expand_less'}</span>
                                <span data-role="theory-report-block-toggle-label">${collapsed ? wt('im.k477', 'Открыть') : wt('im.k478', 'Свернуть')}</span>
                            </button>
                        ` : ''}
                    </div>
                ` : ''}
                <div
                    data-role="theory-report-block-content"
                    data-block-id="${this.escapeHtml(blockId)}"
                    class="min-w-0 transition-opacity transition-transform duration-150 ease-out ${collapsed ? 'hidden opacity-0 translate-y-1 pointer-events-none' : 'opacity-100 translate-y-0'}">
                    ${contentHtml}
                </div>
            </section>
        `;
    }

    renderTheoryReportDividerBlock(block) {
        const anchor = String(block?.anchor || '').trim();
        const title = String(block?.title || '').trim();
        const anchorAttr = anchor ? ` data-report-anchor="${this.escapeHtml(anchor)}"` : '';
        return `
            <div class="py-1"${anchorAttr}>
                ${title ? `<div class="text-[11px] uppercase tracking-wide text-text-secondary mb-1">${this.escapeHtml(title)}</div>` : ''}
                <div class="h-px bg-border-strong"></div>
            </div>
        `;
    }

    renderTheoryReportTocBlock(block) {
        const items = Array.isArray(block?.body?.items) ? block.body.items : [];
        if (!items.length) return wt('im.k479', '<div class="text-xs text-text-secondary">Пустое оглавление.</div>');
        return `
            <div class="space-y-1">
                ${items.map(item => this.renderTheoryReportJumpButton(item?.label || item?.anchor || 'section', item?.anchor, { compact: true })).join('')}
            </div>
        `;
    }

    renderTheoryReportSectionBlock(block) {
        const summary = String(block?.body?.summary || '').trim();
        const subanchors = Array.isArray(block?.body?.subanchors) ? block.body.subanchors : [];
        const summaryHtml = summary
            ? `<p class="text-sm text-text-main leading-relaxed whitespace-pre-line">${this.escapeHtml(summary)}</p>`
            : wt('im.k480', '<p class="text-xs text-text-secondary">Раздел без описания.</p>');
        const subanchorsHtml = subanchors.length ? `
            <div class="mt-3">
                <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-2">${wt('im.k1008', 'Подразделы')}</div>
                <div class="flex flex-wrap gap-2">
                    ${subanchors.map(anchor => this.renderTheoryReportJumpButton(anchor, anchor)).join('')}
                </div>
            </div>
        ` : '';
        return `${summaryHtml}${subanchorsHtml}`;
    }

    renderTheoryReportCalloutBlock(block) {
        const variant = String(block?.body?.variant || 'note').toLowerCase();
        const text = String(block?.body?.text || '').trim();
        const bullets = Array.isArray(block?.body?.bullets) ? block.body.bullets : [];
        const toneMap = { tip: 'info', warning: 'warning', risk: 'risk', note: 'neutral' };
        const tone = toneMap[variant] || 'neutral';
        const bodyHtml = `
            ${text ? `<p class="text-sm text-text-main leading-relaxed">${this.escapeHtml(text)}</p>` : ''}
            ${bullets.length ? `<div class="${text ? 'mt-3' : ''}">${this.theoryReportListToHtml(bullets, { max: 3, className: 'text-xs text-text-main' })}</div>` : ''}
            ${!text && !bullets.length ? `<p class="text-xs text-text-secondary">${wt('im.k1009', 'Пустой callout.')}</p>` : ''}
        `;
        return { html: bodyHtml, tone };
    }

    renderTheoryReportListBlock(block) {
        const items = Array.isArray(block?.body?.items) ? block.body.items : [];
        if (!items.length) return wt('im.k481', '<div class="text-xs text-text-secondary">Список пуст.</div>');
        return `
            <ul class="space-y-2">
                ${items.map((item) => {
                    const text = typeof item === 'object' ? String(item?.text || item?.label || '').trim() : String(item || '').trim();
                    const anchor = typeof item === 'object' ? String(item?.anchor || '').trim() : '';
                    if (!text) return '';
                    return `
                        <li class="flex items-start gap-2">
                            <span class="mt-[2px] text-[10px] text-text-muted">•</span>
                            <div class="min-w-0 flex-1">
                                <span class="text-xs text-text-main">${this.escapeHtml(text)}</span>
                                ${anchor ? `<div class="mt-1">${this.renderTheoryReportJumpButton(anchor, anchor)}</div>` : ''}
                            </div>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
    }

    renderTheoryReportChunkCardBlock(block, ctx) {
        const body = (block && typeof block.body === 'object') ? block.body : {};
        const chunkId = String(body.chunk_id || '').trim();
        const chunk = ctx?.chunkById?.get(chunkId);
        if (!chunk) return wt('im.k482', '<div class="text-xs text-text-secondary">Chunk не найден.</div>');

        const unitIds = Array.isArray(chunk.unit_ids) ? chunk.unit_ids : [];
        const routeIds = Array.isArray(chunk.route_ids) ? chunk.route_ids : [];
        const anchors = Array.isArray(chunk.factual_anchors) ? chunk.factual_anchors : [];
        const confusions = Array.isArray(chunk.common_confusions) ? chunk.common_confusions : [];
        const notes = Array.isArray(chunk.notes_for_author) ? chunk.notes_for_author : [];

        return `
            <div class="space-y-3">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="text-sm font-semibold text-text-main">${this.escapeHtml(chunk.title || chunkId)}</div>
                        ${chunk.chunk_type ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(chunk.chunk_type)}</span>` : ''}
                        <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${unitIds.length} ${wt('im.k483', 'ед.</span>')}
                        <button type="button"
                            onclick="dashboard.importManager.createTheoryMicrocardsDeckForChunk('${this.escapeInlineJsString(chunkId)}')"
                            class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-primary text-primary hover:bg-primary hover:text-primary-fg transition-colors">
                            ${wt('im.k484', 'Колода по chunk')}
                        </button>
                        <button type="button"
                            onclick="dashboard.importManager.appendTheoryMicrocardsDeckForChunk('${this.escapeInlineJsString(chunkId)}')"
                            class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k617', '+ в колоду...')}
                        </button>
                    </div>
                    ${chunk.goal ? `<p class="text-xs text-text-secondary mt-1 leading-relaxed">${this.escapeHtml(chunk.goal)}</p>` : ''}
                </div>

                ${body.show_units !== false ? `
                    <div class="pt-2 border-t border-border-subtle">
                        <div class="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-2">${wt('im.k1010', 'Охватываемые единицы')}</div>
                        ${unitIds.length ? `
                            <div class="space-y-1">
                                ${unitIds.slice(0, 10).map((unitId) => {
                                    const unit = ctx?.unitById?.get(String(unitId));
                                    return `
                                        <div class="flex flex-wrap items-center gap-2">
                                            <div class="text-xs text-text-main">#${this.escapeHtml(String(unitId))} ${this.escapeHtml(unit?.title || 'Unit')}</div>
                                            <button type="button"
                                                onclick="dashboard.importManager.createTheoryMicrocardsDeckForUnit('${this.escapeInlineJsString(String(unitId))}','${this.escapeInlineJsString(chunkId)}')"
                                                class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-info-light text-info-text bg-info-lighter hover:bg-info-light transition-colors">
                                                ${wt('im.k607', 'Колода по unit')}
                                            </button>
                                            <button type="button"
                                                onclick="dashboard.importManager.appendTheoryMicrocardsDeckForUnit('${this.escapeInlineJsString(String(unitId))}','${this.escapeInlineJsString(chunkId)}')"
                                                class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                                                ${wt('im.k617', '+ в колоду...')}
                                            </button>
                                        </div>
                                    `;
                                }).join('')}
                                ${unitIds.length > 10 ? `<div class="text-[11px] text-text-secondary">${wt('im.k1011', 'Показаны первые 10 из')} ${unitIds.length}</div>` : ''}
                            </div>
                        ` : `<div class="text-xs text-text-secondary">${wt('im.k1012', 'Нет связанных units.')}</div>`}
                    </div>
                ` : ''}

                ${body.show_confusions !== false && confusions.length ? `
                    <div class="pt-2 border-t border-border-subtle">
                        <div class="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-2">${wt('im.k1013', 'Частые ошибки')}</div>
                        ${this.theoryReportListToHtml(confusions, { max: 6, className: 'text-xs text-text-main' })}
                    </div>
                ` : ''}

                ${anchors.length ? `
                    <div class="pt-2 border-t border-border-subtle">
                        <div class="text-[10px] font-bold uppercase tracking-wider text-text-secondary mb-2">${wt('im.k1014', 'Фактологические якоря')}</div>
                        <div class="flex flex-wrap gap-1">
                            ${anchors.slice(0, 8).map((anchorItem) => {
                                const kind = typeof anchorItem === 'object' ? String(anchorItem?.kind || '') : '';
                                const value = typeof anchorItem === 'object' ? String(anchorItem?.value || '') : String(anchorItem || '');
                                if (!value) return '';
                                return `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${kind ? `${this.escapeHtml(kind)}: ` : ''}${this.escapeHtml(value)}</span>`;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}

                ${body.show_route_links !== false && routeIds.length ? `
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">${wt('im.k1015', 'Маршруты')}</div>
                        <div class="flex flex-wrap gap-2">
                            ${routeIds.map((routeId) => {
                                const route = ctx?.routeById?.get(String(routeId));
                                const anchor = ctx?.routeBlockAnchorById?.get(String(routeId)) || '';
                                const label = route?.title || routeId;
                                return anchor
                                    ? this.renderTheoryReportJumpButton(label, anchor)
                                    : `<span class="px-2 py-1 rounded-md text-xs border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(label))}</span>`;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}

                ${notes.length ? `
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">${wt('im.k1016', 'Заметки для автора')}</div>
                        ${this.theoryReportListToHtml(notes, { max: 8, className: 'text-xs text-text-main' })}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderTheoryReportProgressionMatrixBlock(block, ctx) {
        const rows = Array.isArray(block?.body?.rows) ? block.body.rows : [];
        if (!rows.length) return wt('im.k486', '<div class="text-xs text-text-secondary">Матрица пустая.</div>');
        const typeEntries = Array.isArray(ctx?.typeEntries) ? ctx.typeEntries : [];
        const policyNoteHtml = this.renderTheoryReportFixedProgressionPolicyNote(typeEntries, { compact: true });

        const tableRows = rows.map((row) => {
            const taskType = String(row?.task_type || '').toUpperCase();
            const entryCandidates = ctx?.typeEntriesByTaskType?.get(taskType) || [];
            const entry = entryCandidates[0] || null;
            const suitability = String(row?.suitability || entry?.suitability || 'medium').toLowerCase();
            const levelRoles = (row?.show_level_roles !== false && Array.isArray(entry?.level_role_map)) ? entry.level_role_map : [];
            const iterativeNotes = (row?.show_iterative_notes !== false && Array.isArray(entry?.iterative_system_notes)) ? entry.iterative_system_notes : [];
            const seqIntents = Array.isArray(entry?.sequence_intents) ? entry.sequence_intents : [];
            const levelList = levelRoles
                .map(item => Number(item?.level))
                .filter(Number.isFinite)
                .sort((a, b) => a - b);

            const levelsHtml = levelRoles.length
                ? `
                    ${levelList.length ? `<div class="text-[11px] text-text-secondary mb-1">${wt('im.k1004', 'Уровни в progression:')} ${this.escapeHtml(levelList.map(level => `L${level}`).join(', '))}</div>` : ''}
                    ${this.theoryReportLevelRoleMapToHtml(levelRoles, { max: 4, emptyText: wt('im.k715', 'Роли уровней не указаны.') })}
                `
                : (entry?.progression_is_fixed
                    ? wt('im.k487', '<div class="text-[11px] text-text-secondary">Уровни у этого типа трактуются как fixed progression; отдельный выбор уровня не предлагается.</div>')
                    : '<span class="text-[11px] text-text-secondary">—</span>');
            const notesHtml = iterativeNotes.length
                ? `<div class="space-y-1">${iterativeNotes.slice(0, 3).map(note => `<div class="text-[11px] text-text-secondary">${this.escapeHtml(String(note))}</div>`).join('')}</div>`
                : '<span class="text-[11px] text-text-secondary">—</span>';

            return `
                <tr class="align-top border-t border-border-subtle">
                    <td class="px-2 py-2">
                        <div class="text-xs font-semibold text-text-main">${this.escapeHtml(taskType || 'UNKNOWN')}${entry?.subtype ? ` / ${this.escapeHtml(String(entry.subtype))}` : ''}</div>
                        <div class="flex flex-wrap gap-1 mt-1">
                            <span class="px-1.5 py-0.5 rounded-md text-[10px] border ${this.theoryReportSuitabilityBadgeClass(suitability)}">${this.escapeHtml(suitability)}</span>
                            ${entry?.availability ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(entry.availability))}</span>` : ''}
                            ${entry?.progression_is_fixed ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-text-main">fixed progression</span>` : ''}
                            ${entry?.complex_role ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(entry.complex_role))}</span>` : ''}
                        </div>
                        ${seqIntents.length ? `<div class="flex flex-wrap gap-1 mt-1">${seqIntents.slice(0, 5).map(intent => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(intent))}</span>`).join('')}</div>` : ''}
                        ${entry?.why ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(String(entry.why))}</p>` : ''}
                    </td>
                    <td class="px-2 py-2 min-w-[220px]">${levelsHtml}</td>
                    <td class="px-2 py-2 min-w-[180px]">${notesHtml}</td>
                </tr>
            `;
        }).join('');

        return `
            <div class="space-y-3">
                ${policyNoteHtml}
                <div class="overflow-x-auto rounded-lg border border-border-strong bg-surface-1">
                    <table class="min-w-full text-xs">
                        <thead class="bg-surface-2">
                            <tr>
                                <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1017', 'Тип / роль')}</th>
                                <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1018', 'Уровни в progression')}</th>
                                <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">Iterative notes</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                </div>
            </div>
        `;
    }

    renderTheoryRouteQuickActions(route, { compact = false } = {}) {
        const r = route && typeof route === 'object' ? route : null;
        if (!r) return '';
        const reportLinkEnabled = this.isTheoryFeatureEnabled('editor_analysis_report_link');
        const microcardsModeEnabled = this.isTheoryFeatureEnabled('microcards_mode');
        const pairMatchEnabled = this.isTheoryFeatureEnabled('microcards_pair_match');
        const routeId = String(r.id || '').trim();
        const targetSurface = String(r.target_surface || '').toLowerCase();
        const chunkIds = Array.isArray(r.chunk_ids) ? r.chunk_ids.filter(Boolean).map((id) => String(id)) : [];
        const unitIds = Array.isArray(r.unit_ids) ? r.unit_ids.filter((id) => Number.isFinite(Number(id))) : [];
        const steps = Array.isArray(r.steps) ? r.steps : [];
        const hasPairMatchStep = steps.some((step) => String(step?.action_type || '').toLowerCase() === 'add_microcards'
            && String(step?.microcard_mode || '').toLowerCase() === 'pair_match');
        const canPushEditorContext = reportLinkEnabled && !!(routeId && (chunkIds.length || unitIds.length));
        const showMicrocardsActions = microcardsModeEnabled && (
            (hasPairMatchStep && pairMatchEnabled) || (!hasPairMatchStep && (targetSurface === 'microcards' || targetSurface === 'mixed'))
        );
        const showMicrocardsOpen = microcardsModeEnabled && (targetSurface === 'microcards' || targetSurface === 'mixed');
        const small = compact ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs';

        const createAction = hasPairMatchStep
            ? "dashboard.importManager.createTheoryMicrocardsPairMatchDeck()"
            : (chunkIds.length === 1
                ? `dashboard.importManager.createTheoryMicrocardsDeckForChunk('${this.escapeInlineJsString(chunkIds[0])}')`
                : (unitIds.length === 1
                    ? `dashboard.importManager.createTheoryMicrocardsDeckForUnit('${this.escapeInlineJsString(String(unitIds[0]))}','${this.escapeInlineJsString(String(chunkIds[0] || ''))}')`
                    : "dashboard.importManager.createTheoryMicrocardsDeckAll()"));
        const appendAction = hasPairMatchStep
            ? "dashboard.importManager.appendTheoryMicrocardsPairMatchDeck()"
            : (chunkIds.length === 1
                ? `dashboard.importManager.appendTheoryMicrocardsDeckForChunk('${this.escapeInlineJsString(chunkIds[0])}')`
                : (unitIds.length === 1
                    ? `dashboard.importManager.appendTheoryMicrocardsDeckForUnit('${this.escapeInlineJsString(String(unitIds[0]))}','${this.escapeInlineJsString(String(chunkIds[0] || ''))}')`
                    : "dashboard.importManager.appendTheoryMicrocardsDeckAll()"));

        const buttons = [
            canPushEditorContext ? `
                <button type="button"
                    onclick="dashboard.importManager.pushTheoryAuthoringRouteContextForEditor('${this.escapeInlineJsString(routeId)}')"
                    class="${small} rounded-md font-medium border border-info-light bg-info-lighter text-info-text hover:bg-info-light transition-colors">
                    ${wt('im.k488', 'В редактор (маршрут)')}
                </button>
            ` : '',
            showMicrocardsActions ? `
                <button type="button"
                    onclick="${createAction}"
                    ${this.microcardsCreateLoading ? 'disabled' : ''}
                    class="${small} rounded-md font-medium border border-primary text-primary hover:bg-primary hover:text-primary-fg transition-colors disabled:opacity-60">
                    ${hasPairMatchStep ? wt('im.k716', 'pair_match колода') : wt('im.k717', 'Колода по маршруту')}
                </button>
            ` : '',
            showMicrocardsActions ? `
                <button type="button"
                    onclick="${appendAction}"
                    ${this.microcardsCreateLoading ? 'disabled' : ''}
                    class="${small} rounded-md font-medium border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors disabled:opacity-60">
                    ${compact ? wt('im.k718', '+ в колоду...') : wt('im.k719', 'Добавить в колоду...')}
                </button>
            ` : '',
            showMicrocardsOpen ? `
                <button type="button"
                    onclick="dashboard.importManager.openTheoryMicrocardsMode()"
                    class="${small} rounded-md font-medium border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                    ${wt('im.k489', 'Открыть микрокарточки')}
                </button>
            ` : '',
        ].filter(Boolean).join('');

        if (!buttons) return '';
        return `
            <div class="flex flex-wrap gap-1.5">
                ${buttons}
            </div>
        `;
    }

    renderTheoryReportRouteCardBlock(block, ctx) {
        const body = (block && typeof block.body === 'object') ? block.body : {};
        const routeId = String(body.route_id || '').trim();
        const route = ctx?.routeById?.get(routeId);
        if (!route) return wt('im.k490', '<div class="text-xs text-text-secondary">Route не найден.</div>');

        const steps = Array.isArray(route.steps) ? route.steps : [];
        const chunkIds = Array.isArray(route.chunk_ids) ? route.chunk_ids : [];
        const unitIds = Array.isArray(route.unit_ids) ? route.unit_ids : [];

        return `
            <div class="space-y-3">
                <div>
                    <div class="text-sm font-semibold text-text-main">${this.escapeHtml(route.title || routeId)}</div>
                    <div class="flex flex-wrap gap-1 mt-1">
                        ${route.route_kind ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(route.route_kind))}</span>` : ''}
                        ${route.target_surface ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(route.target_surface))}</span>` : ''}
                        ${route.effort_estimate ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border ${this.theoryReportPriorityBadgeClass(route.effort_estimate)}">${this.escapeHtml(String(route.effort_estimate))} effort</span>` : ''}
                        <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${steps.length} ${wt('im.k491', 'шагов</span>')}
                    </div>
                    ${route.expected_effect ? `<p class="text-xs text-text-secondary mt-2 leading-relaxed">${this.escapeHtml(String(route.expected_effect))}</p>` : ''}
                    <div class="mt-2">${this.renderTheoryRouteQuickActions(route)}</div>
                </div>

                ${chunkIds.length ? `
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">${wt('im.k1019', 'Фрагменты')}</div>
                        <div class="flex flex-wrap gap-2">
                            ${chunkIds.map((chunkId) => {
                                const chunk = ctx?.chunkById?.get(String(chunkId));
                                const anchor = ctx?.chunkBlockAnchorById?.get(String(chunkId)) || '';
                                const label = chunk?.title || chunkId;
                                return anchor
                                    ? this.renderTheoryReportJumpButton(label, anchor)
                                    : `<span class="px-2 py-1 rounded-md text-xs border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(label))}</span>`;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}

                ${unitIds.length ? `
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">${wt('im.k1020', 'Единицы')}</div>
                        <div class="text-xs text-text-secondary">${unitIds.slice(0, 12).map((unitId) => {
                            const unit = ctx?.unitById?.get(String(unitId));
                            return `#${this.escapeHtml(String(unitId))} ${this.escapeHtml(unit?.title || 'Unit')}`;
                        }).join(' · ')}</div>
                        ${unitIds.length > 12 ? `<div class="text-[11px] text-text-secondary mt-1">${wt('im.k1021', 'Показаны первые 12 из')} ${unitIds.length}</div>` : ''}
                    </div>
                ` : ''}

                <div>
                    <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-2">${wt('im.k1022', 'Шаги')}</div>
                    <div class="space-y-2">
                        ${steps.map((step, idx) => {
                            const checklist = Array.isArray(step?.authoring_checklist) ? step.authoring_checklist : [];
                            return `
                                <div class="rounded-lg border border-border-strong bg-surface-1 p-2">
                                    <div class="flex flex-wrap items-center gap-1">
                                        <span class="text-xs font-semibold text-text-main">${idx + 1}. ${this.escapeHtml(String(step?.action_type || 'step'))}</span>
                                        ${step?.task_type ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">${this.escapeHtml(String(step.task_type))}</span>` : ''}
                                        ${step?.microcard_mode ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">${this.escapeHtml(String(step.microcard_mode))}</span>` : ''}
                                        ${step?.progression_policy ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(step.progression_policy))}</span>` : ''}
                                        ${step?.sequence_intent ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(step.sequence_intent))}</span>` : ''}
                                    </div>
                                    ${step?.purpose ? `<p class="text-xs text-text-secondary mt-1">${this.escapeHtml(String(step.purpose))}</p>` : ''}
                                    ${(body.show_checklists !== false && checklist.length) ? `
                                        <div class="mt-2">
                                            <div class="text-[11px] font-semibold text-text-secondary mb-1">${wt('im.k1023', 'Чеклист')}</div>
                                            ${this.theoryReportListToHtml(checklist, { max: 8, className: 'text-xs text-text-main' })}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                ${(body.show_anti_patterns !== false && Array.isArray(route.anti_patterns) && route.anti_patterns.length) ? `
                    <div>
                        <div class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary mb-1">${wt('im.k1024', 'Антипаттерны')}</div>
                        ${this.theoryReportListToHtml(route.anti_patterns, { max: 8, className: 'text-xs text-text-main', bulletClass: 'text-warning-text' })}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderTheoryReportCoverageTableBlock(block, ctx) {
        const body = (block && typeof block.body === 'object') ? block.body : {};
        const mode = String(body.mode || 'mixed').toLowerCase();
        const coverage = (ctx && typeof ctx.coveragePlan === 'object' && ctx.coveragePlan) ? ctx.coveragePlan : {};
        const targetCoverage = (coverage.target_coverage && typeof coverage.target_coverage === 'object') ? coverage.target_coverage : {};
        const unitTargets = Array.isArray(coverage.unit_targets) ? coverage.unit_targets : [];
        const chunkTargets = Array.isArray(coverage.chunk_targets) ? coverage.chunk_targets : [];
        const showUnits = mode !== 'chunks';
        const showChunks = mode !== 'units';

        const unitTable = showUnits ? `
            <div class="rounded-lg border border-border-strong bg-surface-1 overflow-x-auto">
                <table class="min-w-full text-xs">
                    <thead class="bg-surface-2">
                        <tr>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1025', 'Unit (Единица)')}</th>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1026', 'Поверхность / Типы')}</th>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1027', 'Сигналы')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${unitTargets.slice(0, 20).map((target) => {
                            const unit = ctx?.unitById?.get(String(target?.unit_id));
                            const surfaces = Array.isArray(target?.recommended_surfaces) ? target.recommended_surfaces : [];
                            const preferredTypes = Array.isArray(target?.preferred_task_types) ? target.preferred_task_types : [];
                            const avoidTypes = Array.isArray(target?.avoid_overtesting_with) ? target.avoid_overtesting_with : [];
                            const isGap = body.highlight_gaps !== false && !!target?.must_cover && surfaces.length === 0 && preferredTypes.length === 0;
                            return `
                                <tr class="align-top border-t border-border-subtle ${isGap ? 'bg-warning-lighter' : ''}">
                                    <td class="px-2 py-2">
                                        <div class="text-xs font-semibold text-text-main">#${this.escapeHtml(String(target?.unit_id ?? '?'))} ${this.escapeHtml(unit?.title || 'Unit')}</div>
                                        <div class="text-[11px] text-text-secondary mt-1">
                                            ${target?.must_cover ? 'must_cover' : 'optional'}
                                            ${unit?.assessment_risk ? ` · risk=${this.escapeHtml(String(unit.assessment_risk))}` : ''}
                                        </div>
                                    </td>
                                    <td class="px-2 py-2">
                                        ${surfaces.length ? `<div class="flex flex-wrap gap-1 mb-1">${surfaces.map(s => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(s))}</span>`).join('')}</div>` : '<div class="text-[11px] text-text-secondary">surfaces: —</div>'}
                                        ${preferredTypes.length ? `<div class="flex flex-wrap gap-1">${preferredTypes.map(t => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">${this.escapeHtml(String(t))}</span>`).join('')}</div>` : '<div class="text-[11px] text-text-secondary">preferred types: —</div>'}
                                    </td>
                                    <td class="px-2 py-2">
                                        ${avoidTypes.length ? `<div class="text-[11px] text-text-secondary">avoid: ${avoidTypes.map(t => this.escapeHtml(String(t))).join(', ')}</div>` : '<div class="text-[11px] text-text-secondary">avoid: —</div>'}
                                        ${isGap ? `<div class="text-[11px] text-warning-text mt-1">gap: must_cover без surface/type подсказок</div>` : ''}
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                ${unitTargets.length > 20 ? `<div class="px-2 py-2 text-[11px] text-text-secondary border-t border-border-subtle">${wt('im.k1028', 'Показаны первые 20 unit_targets из')} ${unitTargets.length}</div>` : ''}
            </div>
        ` : '';

        const chunkTable = showChunks ? `
            <div class="rounded-lg border border-border-strong bg-surface-1 overflow-x-auto">
                <table class="min-w-full text-xs">
                    <thead class="bg-surface-2">
                        <tr>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1029', 'Chunk (Фрагмент)')}</th>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1015', 'Маршруты')}</th>
                            <th class="text-left px-2 py-2 font-semibold text-text-secondary uppercase tracking-wide">${wt('im.k1030', 'Лимиты')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${chunkTargets.slice(0, 20).map((target) => {
                            const chunk = ctx?.chunkById?.get(String(target?.chunk_id));
                            const routeIds = Array.isArray(target?.route_ids) ? target.route_ids : [];
                            const hasGap = body.highlight_gaps !== false && routeIds.length === 0;
                            const hasOverlap = body.highlight_overlaps !== false && routeIds.length > 1;
                            return `
                                <tr class="align-top border-t border-border-subtle ${hasGap ? 'bg-warning-lighter' : (hasOverlap ? 'bg-info-lighter' : '')}">
                                    <td class="px-2 py-2">
                                        <div class="text-xs font-semibold text-text-main">${this.escapeHtml(chunk?.title || String(target?.chunk_id || 'chunk'))}</div>
                                        <div class="text-[11px] text-text-secondary mt-1">${chunk?.chunk_type ? this.escapeHtml(String(chunk.chunk_type)) : ''}</div>
                                    </td>
                                    <td class="px-2 py-2">
                                        ${routeIds.length ? `
                                            <div class="flex flex-wrap gap-1">
                                                ${routeIds.map((routeId) => {
                                                    const route = ctx?.routeById?.get(String(routeId));
                                                    const anchor = ctx?.routeBlockAnchorById?.get(String(routeId)) || '';
                                                    const label = route?.title || routeId;
                                                    return anchor
                                                        ? this.renderTheoryReportJumpButton(label, anchor)
                                                        : `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(label))}</span>`;
                                                }).join('')}
                                            </div>
                                        ` : `<div class="text-[11px] text-text-secondary">${wt('im.k1031', 'Нет route_ids')}</div>`}
                                        ${hasGap ? `<div class="text-[11px] text-warning-text mt-1">gap: chunk без маршрута</div>` : ''}
                                        ${hasOverlap ? `<div class="text-[11px] text-info-text mt-1">overlap: ${routeIds.length} маршрута(ов)</div>` : ''}
                                    </td>
                                    <td class="px-2 py-2">
                                        <div class="text-[11px] text-text-secondary">max_primary_tasks: ${this.escapeHtml(String(target?.max_primary_tasks_recommended ?? '—'))}</div>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
                ${chunkTargets.length > 20 ? `<div class="px-2 py-2 text-[11px] text-text-secondary border-t border-border-subtle">${wt('im.k1032', 'Показаны первые 20 chunk_targets из')} ${chunkTargets.length}</div>` : ''}
            </div>
        ` : '';

        return `
            <div class="space-y-3">
                <div class="flex flex-wrap gap-2">
                    ${targetCoverage.all_units_min_once ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">all_units_min_once</span>` : ''}
                    ${targetCoverage.high_risk_units_priority ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-warning-light bg-warning-lighter text-warning-text">high_risk_units_priority</span>` : ''}
                    <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">mode: ${this.escapeHtml(mode)}</span>
                </div>
                <div class="grid grid-cols-1 ${showUnits && showChunks ? 'xl:grid-cols-2' : ''} gap-3">
                    ${unitTable}
                    ${chunkTable}
                </div>
                ${!unitTable && !chunkTable ? `<div class="text-xs text-text-secondary">${wt('im.k1033', 'Нет данных coverage_plan.')}</div>` : ''}
            </div>
        `;
    }

    renderTheoryReportMicrocardsPreviewBlock(block, ctx) {
        if (!this.isTheoryFeatureEnabled('microcards_mode')) {
            return wt('im.k492', '<div class="text-xs text-text-secondary">Режим микрокарточек отключён (feature flag).</div>');
        }
        const body = (block && typeof block.body === 'object') ? block.body : {};
        const maxItems = Math.max(1, Math.min(20, Number(body.max_items) || 8));
        const groupBy = String(body.group_by || 'card_type').toLowerCase() === 'chunk' ? 'chunk' : 'card_type';
        const allowPairMatch = this.isTheoryFeatureEnabled('microcards_pair_match') && body.show_pair_match_candidates !== false;
        let candidates = Array.isArray(ctx?.microcards) ? [...ctx.microcards] : [];
        if (!allowPairMatch) {
            candidates = candidates.filter(item => String(item?.card_type || '').toLowerCase() !== 'pair_match');
        }
        const totalBeforeLimit = candidates.length;
        candidates = candidates.slice(0, maxItems);
        if (!candidates.length) {
            return wt('im.k493', '<div class="text-xs text-text-secondary">Нет кандидатов микрокарточек для текущего фильтра.</div>');
        }

        const groups = new Map();
        candidates.forEach((item) => {
            const key = groupBy === 'chunk'
                ? String(ctx?.chunkById?.get(String(item?.chunk_id))?.title || item?.chunk_id || 'chunk')
                : String(item?.card_type || 'card');
            const list = groups.get(key) || [];
            list.push(item);
            groups.set(key, list);
        });

        return `
            <div class="space-y-3">
                <div class="flex flex-wrap gap-2">
                    <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">group_by: ${this.escapeHtml(groupBy)}</span>
                    <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">shown: ${candidates.length}/${totalBeforeLimit}</span>
                    ${allowPairMatch ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">pair_match on</span>` : `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">pair_match hidden</span>`}
                    ${allowPairMatch ? `
                        <button type="button"
                            onclick="dashboard.importManager.createTheoryMicrocardsPairMatchDeck()"
                            class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-primary text-primary hover:bg-primary hover:text-primary-fg transition-colors">
                            ${wt('im.k609', 'Создать pair_match колоду')}
                        </button>
                        <button type="button"
                            onclick="dashboard.importManager.appendTheoryMicrocardsPairMatchDeck()"
                            class="px-2 py-0.5 rounded-md text-[10px] font-medium border border-border-strong text-text-secondary hover:bg-bg-hover transition-colors">
                            ${wt('im.k610', 'pair_match + в колоду...')}
                        </button>
                    ` : ''}
                </div>
                ${[...groups.entries()].map(([groupKey, items]) => `
                    <div class="rounded-lg border border-border-strong bg-surface-1 p-2">
                        <div class="flex items-center justify-between gap-2 mb-2">
                            <div class="text-xs font-semibold text-text-main">${this.escapeHtml(groupKey)}</div>
                            <span class="text-[10px] px-1.5 py-0.5 rounded-md border border-border-strong bg-surface-2 text-text-secondary">${items.length}</span>
                        </div>
                        <div class="space-y-2">
                            ${items.map((item) => {
                                const unit = ctx?.unitById?.get(String(item?.unit_id));
                                const chunk = ctx?.chunkById?.get(String(item?.chunk_id));
                                const anchors = Array.isArray(item?.anchors) ? item.anchors : [];
                                return `
                                    <div class="rounded-md border border-border-strong bg-surface-2 p-2">
                                        <div class="flex flex-wrap items-center gap-1">
                                            <span class="text-xs font-semibold text-text-main">${this.escapeHtml(String(item?.card_type || 'card'))}</span>
                                            ${item?.priority ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border ${this.theoryReportPriorityBadgeClass(item.priority)}">${this.escapeHtml(String(item.priority))}</span>` : ''}
                                            ${item?.card_type === 'pair_match' ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">MATCH</span>` : ''}
                                        </div>
                                        <div class="text-[11px] text-text-secondary mt-1">
                                            ${unit ? `#${this.escapeHtml(String(unit.id))} ${this.escapeHtml(unit.title || 'Unit')}` : `unit ${this.escapeHtml(String(item?.unit_id || '?'))}`}
                                            ${chunk ? ` · ${this.escapeHtml(chunk.title || String(item?.chunk_id || 'chunk'))}` : ''}
                                        </div>
                                        ${item?.prompt_seed ? `<p class="text-xs text-text-main mt-1">${this.escapeHtml(String(item.prompt_seed))}</p>` : ''}
                                        ${item?.answer_seed ? `<p class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(String(item.answer_seed))}</p>` : ''}
                                        ${anchors.length ? `<div class="flex flex-wrap gap-1 mt-1">${anchors.slice(0, 4).map(a => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(a))}</span>`).join('')}</div>` : ''}
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    renderTheoryAnalysisFallbackReportGrid(a, vm = {}) {
        const units = Array.isArray(vm.units) ? vm.units : [];
        const recs = Array.isArray(vm.recs) ? vm.recs : [];
        const warnings = Array.isArray(vm.warnings) ? vm.warnings : [];
        const futureCaps = Array.isArray(vm.futureCaps) ? vm.futureCaps : [];
        const microcards = Array.isArray(vm.microcards) ? vm.microcards : [];
        const notRec = Array.isArray(vm.notRec) ? vm.notRec : [];
        const materialLang = vm.materialLang || 'unknown';
        const outputLang = vm.outputLang || 'unknown';
        const suitabilityRows = vm.suitabilityRows || '';
        const routeRows = vm.routeRows || '';
        const futureRows = vm.futureRows || '';
        const progressionPolicyHtml = vm.progressionPolicyHtml || '';

        return `
            <div class="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-4">
                <div class="space-y-4">
                    <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                        <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k1034', 'Сводка')}</div>
                        <div class="text-xs text-text-secondary space-y-1">
                            <p><strong class="text-text-main">${wt('im.k494', 'Язык материала:</strong>')}${this.escapeHtml(materialLang)}</p>
                            <p><strong class="text-text-main">${wt('im.k495', 'Язык анализа:</strong>')}${this.escapeHtml(outputLang)}</p>
                            ${a.provider_used ? `<p><strong class="text-text-main">${wt('im.k1035', 'Провайдер:')}</strong> ${this.escapeHtml(a.provider_used)}${a.provider_model ? ` (${this.escapeHtml(a.provider_model)})` : ''}</p>` : ''}
                            ${a.analysis_schema_version ? `<p><strong class="text-text-main">Schema:</strong> ${this.escapeHtml(a.analysis_schema_version)}</p>` : ''}
                            ${a.report_blocks_version ? `<p><strong class="text-text-main">Report blocks:</strong> ${this.escapeHtml(a.report_blocks_version)}</p>` : ''}
                        </div>
                        ${a.human_summary ? `<p class="text-sm text-text-main mt-3 leading-relaxed">${this.escapeHtml(a.human_summary)}</p>` : ''}
                    </div>

                    ${warnings.length ? `
                        <div class="p-3 bg-surface-2 border border-border-strong rounded-lg">
                            <div class="text-xs font-semibold text-text-main uppercase tracking-wide mb-2">Warnings</div>
                            <div class="space-y-1">
                                ${warnings.slice(0, 8).map(w => `<p class="text-xs text-text-main">${this.escapeHtml(w)}</p>`).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${suitabilityRows ? `
                        <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                            <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k1005', 'Типы как progressions')}</div>
                            ${progressionPolicyHtml ? `<div class="mb-2">${progressionPolicyHtml}</div>` : ''}
                            <div class="space-y-2">${suitabilityRows}</div>
                        </div>
                    ` : ''}

                    ${routeRows ? `
                        <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                            <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k1036', 'Маршруты автора')}</div>
                            <div class="space-y-2">${routeRows}</div>
                        </div>
                    ` : ''}
                </div>

                <div class="space-y-4">
                    <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                        <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k1037', 'Образовательные единицы')}</div>
                        ${units.length ? `
                            <div class="space-y-2">
                                ${units.slice(0, 12).map(unit => `
                                    <div class="p-2 rounded-md bg-surface-1 border border-border-strong">
                                        <div class="flex items-start justify-between gap-2">
                                            <div class="text-xs font-semibold text-text-main">#${this.escapeHtml(String(unit.id ?? '?'))} ${this.escapeHtml(unit.title || 'Unit')}</div>
                                            ${unit.type ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-2 text-text-secondary">${this.escapeHtml(unit.type)}</span>` : ''}
                                        </div>
                                        ${unit.description ? `<p class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(unit.description)}</p>` : ''}
                                    </div>
                                `).join('')}
                                ${units.length > 12 ? `<div class="text-[11px] text-text-secondary">${wt('im.k1021', 'Показаны первые 12 из')} ${units.length}</div>` : ''}
                            </div>
                        ` : `<div class="text-xs text-text-secondary">${wt('im.k1038', 'Нет данных по educational_units.')}</div>`}
                    </div>

                    ${recs.length ? `
                        <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                            <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Recommendations</div>
                            <div class="space-y-2">
                                ${recs.slice(0, 10).map(rec => `
                                    <div class="p-2 rounded-md bg-surface-1 border border-border-strong">
                                        <div class="flex items-center justify-between gap-2">
                                            <div class="text-xs font-semibold text-text-main">${this.escapeHtml(rec.task_type || 'UNKNOWN')}</div>
                                            <div class="text-[10px] text-text-secondary">count: ${this.escapeHtml(String(rec.count ?? 0))}${rec.priority ? ` · ${this.escapeHtml(rec.priority)}` : ''}</div>
                                        </div>
                                        ${rec.rationale ? `<p class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(rec.rationale)}</p>` : ''}
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    ` : ''}

                    ${(futureRows || microcards.length || notRec.length) ? `
                        <div class="p-3 bg-surface-2 rounded-lg border border-border-strong">
                            <div class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">${wt('im.k1039', 'Дополнительно')}</div>
                            ${futureRows ? `
                                <div class="mb-3">
                                    <div class="text-[11px] font-semibold text-text-main mb-1">Future capabilities (${futureCaps.length})</div>
                                    <div class="space-y-2">${futureRows}</div>
                                </div>
                            ` : ''}
                            ${microcards.length ? `
                                <div class="mb-3">
                                    <div class="text-[11px] font-semibold text-text-main mb-1">Microcards candidates (${microcards.length})</div>
                                    <div class="space-y-1">
                                        ${microcards.slice(0, 6).map(mc => `<p class="text-[11px] text-text-secondary">${this.escapeHtml(mc.card_type || 'card')} · ${this.escapeHtml(mc.priority || 'priority')}${mc.prompt_seed ? ` · ${this.escapeHtml(mc.prompt_seed)}` : ''}</p>`).join('')}
                                    </div>
                                </div>
                            ` : ''}
                            ${notRec.length ? `
                                <div>
                                    <div class="text-[11px] font-semibold text-text-main mb-1">Not recommended</div>
                                    <div class="space-y-1">
                                        ${notRec.slice(0, 8).map(nr => `<p class="text-[11px] text-text-secondary"><strong>${this.escapeHtml(nr.task_type || 'UNKNOWN')}:</strong> ${this.escapeHtml(nr.reason || '')}</p>`).join('')}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    switchAiComposerTab(tab) {
        this.aiComposerTab = tab;
        this.renderTheoryAnalysisMode();
    }

    onAiMaterialInput(event) {
        this.materialText = event.target.value;
        const wordCount = (this.materialText || '').split(/\s+/).filter(Boolean).length;
        const countSpan = document.getElementById('ai-word-count');
        const countText = document.getElementById('ai-word-count-text');
        const submitBtn = document.getElementById('ai-submit-btn');

        if (countSpan && countText) {
            countSpan.textContent = wordCount ? `${wordCount} ${wt('im.k675', 'слов')}` : '';
            if (wordCount > 0 && wordCount < 50) {
                countText.classList.add('text-error-text');
                countSpan.classList.add('text-error-text');
                countSpan.classList.remove('text-text-secondary');
            } else {
                countText.classList.remove('text-error-text');
                countSpan.classList.remove('text-error-text');
                countSpan.classList.add('text-text-secondary');
            }
        }

        if (submitBtn) {
            const hasFile = !!this.aiUploadedFile;
            const validText = wordCount >= 50;
            submitBtn.disabled = this.aiAnalyzing || (!hasFile && !validText);
        }
    }

    renderTheoryAnalysisComposer() {
        if (!this.aiComposerTab) this.aiComposerTab = 'text';
        const limitInfo = this.dailyLimit;
        const aiUnavailable = this.aiStatus && this.aiStatus.ai_available === false;
        const wordCount = (this.materialText || '').split(/\s+/).filter(Boolean).length;
        const isTextValid = wordCount >= 50;
        const hasFile = !!this.aiUploadedFile;
        const isSubmitDisabled = this.aiAnalyzing || aiUnavailable || (!hasFile && !isTextValid);

        const limitHtml = limitInfo ? `
            <div class="flex items-center gap-2 text-xs text-text-muted mt-2">
                <span class="material-symbols-outlined text-[16px]">cloud_upload</span>
                <span>${wt('im.k1040', 'Загрузок файлов сегодня:')} <strong class="${limitInfo.files_remaining === 0 ? 'text-error' : 'text-text-main'}">${limitInfo.max_files_per_day - limitInfo.files_remaining}</strong> ${wt('im.k1041', 'из')} ${limitInfo.max_files_per_day}</span>
            </div>` : '';

        return `
            <div class="border border-border-strong rounded-xl bg-surface-1 p-4">
                <div class="flex items-start gap-3 mb-4">
                    <div class="w-9 h-9 rounded-lg bg-surface-2 border border-border-strong text-primary flex items-center justify-center shrink-0">
                        <span class="material-symbols-outlined text-[20px]">analytics</span>
                    </div>
                    <div class="min-w-0">
                        <div class="text-sm font-bold text-text-main">${wt('im.k1042', 'Новый анализ')}</div>
                        <div class="text-xs text-text-secondary mt-1">${wt('im.k1043', 'Добавьте материал. Анализ сохранится и будет доступен в истории справа.')}</div>
                    </div>
                </div>

                ${aiUnavailable ? `
                    <div class="mb-4 p-4 bg-warning-lighter border border-warning-light rounded-lg">
                        <div class="flex items-start gap-3">
                            <span class="material-symbols-outlined text-warning text-[20px] mt-0.5">key_off</span>
                            <div>
                                <p class="text-sm font-semibold text-text-main mb-1">${wt('im.k1044', 'ИИ-генерация не настроена')}</p>
                                <p class="text-xs text-text-secondary">${wt('im.k1045', 'Для запуска анализа необходимо указать API-ключ. Ранее сохранённые анализы остаются доступны.')}</p>
                                <a href="/settings" class="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-primary hover:underline">
                                    <span class="material-symbols-outlined text-[14px]">settings</span>
                                    ${wt('im.k611', 'Настроить API-ключи')}
                                </a>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <div class="p-4 border border-border-strong rounded-lg bg-surface-2 mb-4">
                    <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div class="flex items-center gap-2 flex-1">
                            <span class="material-symbols-outlined text-[18px] text-primary">translate</span>
                            <span class="text-sm font-semibold text-text-main">${wt('im.k1046', 'Язык результатов:')}</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="ai-output-language-mode" value="same_as_material"
                                    class="text-primary border-border-strong bg-surface-1 focus:ring-primary"
                                    ${this.aiOutputLanguageMode !== 'custom' ? 'checked' : ''}
                                    onchange="document.getElementById('ai-output-language-select').disabled = true">
                                <span class="text-sm text-text-main">${wt('im.k1047', 'Как в материале')}</span>
                            </label>
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="ai-output-language-mode" value="custom"
                                    class="text-primary border-border-strong bg-surface-1 focus:ring-primary"
                                    ${this.aiOutputLanguageMode === 'custom' ? 'checked' : ''}
                                    onchange="document.getElementById('ai-output-language-select').disabled = false; document.getElementById('ai-output-language-select').focus()">
                                <select id="ai-output-language-select"
                                    class="rounded-md border-border-subtle bg-surface-1 py-1 px-2 text-sm text-text-main focus:ring-1 focus:ring-primary disabled:opacity-50"
                                    ${this.aiOutputLanguageMode !== 'custom' ? 'disabled' : ''}>
                                    <option value="ru" ${this.aiOutputLanguage === 'ru' ? 'selected' : ''}>Русский</option>
                                    <option value="en" ${this.aiOutputLanguage === 'en' ? 'selected' : ''}>English</option>
                                </select>
                            </label>
                        </div>
                    </div>
                </div>

                <div class="flex gap-4 mb-4 border-b border-border-subtle">
                    <button onclick="dashboard.importManager.switchAiComposerTab('text')" 
                        class="px-2 py-2 text-sm font-semibold border-b-2 transition-colors focus:outline-none ${this.aiComposerTab === 'text' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-main'}">
                        ${wt('im.k496', 'Вставить текст')}
                    </button>
                    <button onclick="dashboard.importManager.switchAiComposerTab('file')" 
                        class="px-2 py-2 text-sm font-semibold border-b-2 transition-colors focus:outline-none ${this.aiComposerTab === 'file' ? 'border-primary text-primary' : 'border-transparent text-text-secondary hover:text-text-main'}">
                        ${wt('im.k497', 'Загрузить файл')}
                    </button>
                </div>

                ${this.aiComposerTab === 'file' ? `
                    <div class="mb-4">
                        <div id="ai-drop-zone" class="border-2 border-dashed border-border-subtle rounded-lg p-6 text-center bg-surface-2 hover:bg-bg-hover hover:border-primary transition-all cursor-pointer relative">
                            <input type="file" id="ai-file-input" accept=".pdf,.docx,.txt" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                            <div class="pointer-events-none">
                                ${this.aiUploadedFile ? `
                                    <span class="material-symbols-outlined text-3xl text-success-text mb-1">check_circle</span>
                                    <p class="text-sm font-bold text-success-text" id="ai-file-name">${this.escapeHtml(this.aiUploadedFile.name)}</p>
                                    <p class="text-xs text-text-muted mt-1">${this.aiFileInfo ? `${this.aiFileInfo.word_count} слов` : wt('im.k498', 'Загружено')}</p>
                                ` : `
                                    <span class="material-symbols-outlined text-3xl text-text-disabled mb-1">upload_file</span>
                                    <p class="text-sm font-medium text-text-secondary" id="ai-file-name">${wt('im.k1048', 'Перетащите PDF, DOCX или TXT')}</p>
                                    <p class="text-xs text-text-secondary mt-1">${wt('im.k1049', 'Максимум 18 МБ')}</p>
                                `}
                            </div>
                        </div>
                        ${limitHtml}
                    </div>
                ` : ''}

                ${this.aiComposerTab === 'text' ? `
                    <div class="mb-4">
                        <textarea id="ai-material-textarea" rows="8"
                            class="block w-full rounded-lg border-border-subtle bg-surface-2 p-3 text-sm text-text-main placeholder:text-text-secondary focus:ring-2 focus:ring-primary resize-y"
                            placeholder=wt('im.k499', "Вставьте учебный материал сюда...") oninput="dashboard.importManager.onAiMaterialInput(event)">${this.escapeHtml(this.materialText)}</textarea>
                        <div class="flex justify-between mt-1">
                            <span class="text-xs ${wordCount > 0 && wordCount < 50 ? 'text-error-text' : 'text-text-secondary'}" id="ai-word-count">${wordCount ? `${wordCount} ${wt('im.k675', 'слов')}` : ''}</span>
                            <span class="text-xs ${wordCount > 0 && wordCount < 50 ? 'text-error-text' : 'text-text-secondary'}" id="ai-word-count-text">${wt('im.k1050', 'Минимум 50 слов')}</span>
                        </div>
                    </div>
                ` : ''}

                <div class="flex flex-wrap items-center gap-2">
                    <button id="ai-submit-btn" onclick="dashboard.importManager.theoryAnalyze()" ${isSubmitDisabled ? 'disabled' : ''}
                        class="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-contrast rounded-lg hover:bg-primary-dark font-semibold transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed">
                        ${this.aiAnalyzing ? '<span class="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>' : ''}
                        <span>${this.aiAnalyzing ? wt('im.k1051', 'Анализ...') : wt('im.k1052', 'Запустить анализ')}</span>
                    </button>
                    ${!isSubmitDisabled ? `<span class="editor-flow-wrap text-xs text-text-secondary ml-2">${this.aiRunId ? `Последний ai_run_id: ${this.escapeHtml(this.aiRunId)}` : wt('im.k500', 'Результат будет сохранён в истории анализов')}</span>` : ''}
                </div>
            </div>
        `;
    }

    renderTheoryAnalysisRunsPanel() {
        const rows = Array.isArray(this.theoryRuns) ? this.theoryRuns : [];
        return `
            <div class="border border-border-strong rounded-xl bg-surface-1 p-4 xl:sticky xl:top-0">
                <div class="flex items-start justify-between gap-3 mb-3">
                    <div class="min-w-0">
                        <div class="text-sm font-bold text-text-main">${wt('im.k1053', 'Сохранённые анализы')}</div>
                        <div class="editor-flow-wrap text-xs text-text-secondary">${wt('im.k1054', 'Повторное открытие по')} <code class="font-mono">ai_run_id</code></div>
                    </div>
                    <span class="shrink-0 px-2 py-0.5 rounded-full text-xs bg-surface-2 text-text-secondary">${rows.length}</span>
                </div>

                ${this.theoryRunsLoading ? `
                    <div class="py-6 text-center text-sm text-text-muted">
                        <span class="material-symbols-outlined animate-spin text-[18px] align-middle mr-1">progress_activity</span>
                        ${wt('im.k612', 'Загрузка списка...')}
                    </div>
                ` : ''}

                ${!this.theoryRunsLoading && this.theoryRunsError ? `
                    <div class="p-3 bg-error-lighter border border-error-light rounded-lg text-xs text-error-text">
                        ${this.escapeHtml(this.theoryRunsError)}
                    </div>
                ` : ''}

                ${!this.theoryRunsLoading && !this.theoryRunsError && rows.length === 0 ? `
                    <div class="flex flex-col items-center justify-center p-6 bg-surface-2 border border-border-strong border-dashed rounded-lg text-center mt-2">
                        <span class="material-symbols-outlined text-[32px] text-border-strong mb-2">history</span>
                        <p class="text-xs font-semibold text-text-main">${wt('im.k1055', 'Нет сохранённых анализов')}</p>
                        <p class="text-[11px] text-text-secondary mt-1">${wt('im.k1056', 'Здесь появится история ваших анализов после первого запуска.')}</p>
                    </div>
                ` : ''}

                ${!this.theoryRunsLoading && !this.theoryRunsError && rows.length > 0 ? `
                    <div class="space-y-2 max-h-[70vh] overflow-y-auto pr-1">
                        ${rows.map((row) => {
            const isActive = row.ai_run_id === this.aiRunId;
            const isOpening = row.ai_run_id === this.theoryOpeningRunId;
            const updatedAt = row.updated_at || row.created_at || '';
            const stats = [
                row.material_word_count ? `${row.material_word_count} ${wt('im.k675', 'слов')}` : null,
                row.material_language ? `${wt('im.k720', 'язык:')} ${row.material_language}` : null,
                row.effective_output_language ? `${wt('im.k721', 'вывод:')} ${row.effective_output_language}` : null,
            ].filter(Boolean).join(' · ');
            const counts = [
                Number.isFinite(row.units_count) ? `units ${row.units_count}` : null,
                Number.isFinite(row.recommendations_count) ? `recs ${row.recommendations_count}` : null,
            ].filter(Boolean).join(' · ');
            return `
                                <div class="rounded-lg border ${isActive ? 'border-primary bg-primary-lighter/20' : 'border-border-strong bg-surface-2'} p-3">
                                    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                                        <div class="min-w-0 flex-1">
                                            <div class="editor-flow-wrap text-xs font-semibold text-text-main">${this.escapeHtml(row.source_file_name || row.human_summary || wt('im.k1057', 'Анализ без имени'))}</div>
                                            ${updatedAt ? `<div class="editor-flow-wrap text-[10px] text-text-secondary mt-1">${this.escapeHtml(updatedAt)}</div>` : ''}
                                            ${counts ? `<div class="editor-flow-wrap text-[10px] text-text-secondary mt-0.5">${this.escapeHtml(counts)}</div>` : ''}
                                        </div>
                                        <button onclick="dashboard.importManager.openTheoryAnalysisRun('${this.escapeInlineJsString(row.ai_run_id)}')" ${isOpening ? 'disabled' : ''}
                                            class="editor-flow-button-wrap shrink-0 px-2.5 py-1.5 text-xs font-medium rounded-md border ${isActive ? 'border-primary text-primary bg-primary-lighter' : 'border-border-strong text-text-secondary hover:bg-bg-hover'} disabled:opacity-60 disabled:cursor-not-allowed">
                                            ${isOpening ? wt('im.k722', 'Открытие...') : (isActive ? wt('im.k723', 'Открыт') : wt('im.k724', 'Открыть'))}
                                        </button>
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderTheoryAnalysisResultPanel() {
        if (this.aiAnalyzing) {
            return `
                <div class="border border-border-subtle rounded-xl bg-surface-1 p-8 flex flex-col items-center justify-center text-center">
                    <img src="/assets/logo_animated.svg" alt="AI Analyzing" class="w-14 h-14 mb-4 drop-shadow-md" />
                    <h4 class="text-lg font-bold text-text-main">${wt('im.k725', 'Анализ материала...')}</h4>
                    <p class="text-sm text-text-muted mt-2">${wt('im.k1058', 'ИИ разбирает структуру материала и формирует рекомендации.')}</p>
                </div>
            `;
        }

        const a = this.analysisResult;
        if (!a) {
            return `
                <div class="border border-border-subtle rounded-xl bg-surface-1 p-6">
                    <div class="text-sm font-semibold text-text-main mb-1">${wt('im.k726', 'Результат анализа')}</div>
                    <div class="text-xs text-text-muted">${wt('im.k1059', 'После запуска или открытия анализа здесь появится структурированный результат.')}</div>
                </div>
            `;
        }

        const units = Array.isArray(a.educational_units) ? a.educational_units : [];
        const recs = Array.isArray(a.recommendations) ? a.recommendations : [];
        const warnings = Array.isArray(a.warnings) ? a.warnings : [];
        const chunks = Array.isArray(a.learning_chunks) ? a.learning_chunks : [];
        const routes = Array.isArray(a.authoring_routes) ? a.authoring_routes : [];
        const suitability = Array.isArray(a.type_progression_suitability) ? a.type_progression_suitability : [];
        const futureCaps = Array.isArray(a.future_capabilities) ? a.future_capabilities : [];
        const microcards = Array.isArray(a.microcards_candidates) ? a.microcards_candidates : [];
        const notRec = Array.isArray(a.not_recommended) ? a.not_recommended : [];
        const createdAt = a.analysis_created_at || a.run_manifest?.updated_at || a.run_manifest?.created_at || '';
        const materialLang = a.material_language || a.material_stats?.language || a.target_language || 'unknown';
        const outputLang = a.effective_output_language || a.target_language || 'unknown';
        const reportOpen = this.theoryReportPanelOpen !== false;
        const progressionPolicyHtml = this.renderTheoryReportFixedProgressionPolicyNote(suitability, { compact: true });

        const suitabilityRows = this.theoryReportSortedTypeEntries(suitability).slice(0, 8).map((item) => {
            const levelRoleMap = Array.isArray(item?.level_role_map) ? item.level_role_map : [];
            const iterativeNotes = Array.isArray(item?.iterative_system_notes) ? item.iterative_system_notes.filter(Boolean) : [];
            const seqIntents = Array.isArray(item?.sequence_intents) ? item.sequence_intents : [];
            const levelLabels = levelRoleMap
                .map(row => Number(row?.level))
                .filter(Number.isFinite)
                .sort((a, b) => a - b)
                .map(level => `L${level}`);
            return `
                <div class="p-2 rounded-md bg-surface-1 border border-border-strong">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">${this.escapeHtml(item.task_type || 'UNKNOWN')}${item.subtype ? ` / ${this.escapeHtml(item.subtype)}` : ''}</div>
                        <div class="flex flex-wrap gap-1">
                            <span class="text-[10px] px-1 py-0.5 rounded font-medium text-text-main">${this.escapeHtml(item.suitability || 'н/д')}</span>
                            ${item?.progression_is_fixed ? `<span class="text-[10px] px-1 py-0.5 rounded text-text-secondary">${wt('im.k1060', 'фиксированная посл.')}</span>` : ''}
                            ${item?.complex_role && item.complex_role !== 'none' ? `<span class="text-[10px] px-1 py-0.5 rounded text-text-secondary">${this.escapeHtml(String(item.complex_role))}</span>` : ''}
                        </div>
                    </div>
                    ${item?.progression_is_fixed ? `<p class="text-[11px] text-text-secondary mt-2">${wt('im.k1061', 'Уровни показываются как роли внутри последовательности (progression), а не как произвольный выбор.')}</p>` : ''}
                    ${levelLabels.length ? `<p class="text-[11px] text-text-secondary mt-1">${wt('im.k1062', 'Уровни в последовательности:')} ${this.escapeHtml(levelLabels.join(', '))}</p>` : ''}
                    ${levelRoleMap.length ? `<div class="mt-2">${this.theoryReportLevelRoleMapToHtml(levelRoleMap, { max: 3, emptyText: wt('im.k501', 'Роли уровней не указаны.') })}</div>` : ''}
                    ${iterativeNotes.length ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(String(iterativeNotes[0]))}</p>` : ''}
                    ${item.why ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(item.why)}</p>` : ''}
                    ${seqIntents.length ? `<div class="flex flex-wrap gap-1 mt-2">${seqIntents.slice(0, 5).map(intent => `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${this.escapeHtml(String(intent))}</span>`).join('')}</div>` : ''}
                </div>
            `;
        }).join('');

        const routeRows = routes.slice(0, 6).map((route) => {
            const steps = Array.isArray(route?.steps) ? route.steps : [];
            const antiPatterns = Array.isArray(route?.anti_patterns) ? route.anti_patterns.filter(Boolean) : [];
            const chunkIds = Array.isArray(route?.chunk_ids) ? route.chunk_ids.filter(Boolean) : [];
            const unitIds = Array.isArray(route?.unit_ids) ? route.unit_ids.filter((v) => v != null) : [];
            return `
                <div class="p-2 rounded-md bg-surface-1 border border-border-strong">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-xs font-semibold text-text-main">${this.escapeHtml(route.title || route.id || 'Route')}</div>
                            <div class="text-[10px] text-text-muted mt-1">
                                ${this.escapeHtml([route.route_kind, route.target_surface, route.effort_estimate].filter(Boolean).join(' · ') || wt('im.k727', 'Без метаданных'))}
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-1">
                            <span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${steps.length} ${wt('im.k502', 'шагов</span>')}
                            ${chunkIds.length ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${chunkIds.length} ${wt('im.k1063', 'фрагментов')}</span>` : ''}
                            ${unitIds.length ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-2 text-text-secondary">${unitIds.length} ${wt('im.k1064', 'единиц')}</span>` : ''}
                        </div>
                    </div>
                    ${route?.expected_effect ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(String(route.expected_effect))}</p>` : ''}
                    <div class="mt-2 space-y-2">
                        ${steps.slice(0, 3).map((step, idx) => {
                            const checklist = Array.isArray(step?.authoring_checklist) ? step.authoring_checklist.filter(Boolean) : [];
                            return `
                                <div class="rounded-md border border-border-strong bg-surface-2 p-2">
                                    <div class="flex flex-wrap items-center gap-1">
                                        <span class="text-[11px] font-semibold text-text-main">${idx + 1}. ${this.escapeHtml(String(step?.action_type || wt('im.k503', 'шаг')))}</span>
                                        ${step?.task_type ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">${this.escapeHtml(String(step.task_type))}</span>` : ''}
                                        ${step?.microcard_mode ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-info-light bg-info-lighter text-info-text">${this.escapeHtml(String(step.microcard_mode))}</span>` : ''}
                                        ${step?.progression_policy ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(step.progression_policy))}</span>` : ''}
                                        ${step?.sequence_intent ? `<span class="px-1.5 py-0.5 rounded-md text-[10px] border border-border-strong bg-surface-1 text-text-secondary">${this.escapeHtml(String(step.sequence_intent))}</span>` : ''}
                                    </div>
                                    ${step?.purpose ? `<p class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(String(step.purpose))}</p>` : ''}
                                    ${checklist.length ? `
                                        <div class="mt-1.5 pt-1.5 border-t border-border-subtle">
                                            <div class="text-[10px] font-semibold text-text-secondary mb-1 uppercase tracking-tight">${wt('im.k1023', 'Чеклист')}</div>
                                            ${this.theoryReportListToHtml(checklist, { max: 4, className: 'text-[11px] text-text-main' })}
                                        </div>
                                    ` : ''}
                                </div>
                            `;
                        }).join('')}
                        ${steps.length > 3 ? `<div class="text-[10px] text-text-secondary">${wt('im.k1065', 'Показаны первые 3 шага из')} ${steps.length}</div>` : ''}
                    </div>
                    ${antiPatterns.length ? `
                        <div class="mt-2">
                            <div class="text-[10px] font-semibold text-text-secondary mb-1 uppercase tracking-wide">${wt('im.k1024', 'Антипаттерны')}</div>
                            ${this.theoryReportListToHtml(antiPatterns, { max: 4, className: 'text-[11px] text-text-main', bulletClass: 'text-warning-text' })}
                        </div>
                    ` : ''}
                    <div class="mt-2">${this.renderTheoryRouteQuickActions(route, { compact: true })}</div>
                </div>
            `;
        }).join('');

        const futureRows = futureCaps.slice(0, 6).map((fc) => `
            <div class="p-2 rounded-md bg-surface-1 border border-border-strong">
                <div class="text-xs font-semibold text-text-main">${this.escapeHtml(fc.display_name || fc.capability_id || 'Capability')}</div>
                <div class="text-[10px] text-text-muted mt-1">${this.escapeHtml([fc.status, fc.suitability].filter(Boolean).join(' · '))}</div>
                ${fc.why ? `<p class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(fc.why)}</p>` : ''}
            </div>
        `).join('');
        const reportBodyHtml = this.renderTheoryAnalysisReportBody(a, {
            units,
            recs,
            warnings,
            chunks,
            routes,
            futureCaps,
            microcards,
            notRec,
            materialLang,
            outputLang,
            suitabilityRows,
            progressionPolicyHtml,
            routeRows,
            futureRows,
        });

        return `
            <div class="border border-border-strong rounded-xl bg-surface-1 p-4" data-role="theory-analysis-report-panel">
                <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-3 mb-4">
                    <div class="min-w-0">
                        <h4 class="text-lg font-bold text-text-main">${wt('im.k726', 'Результат анализа')}</h4>
                        <div class="text-xs text-text-secondary mt-1">
                            ${this.aiRunId ? `<span class="font-mono">${this.escapeHtml(this.aiRunId)}</span>` : ''}
                            ${createdAt ? ` · ${this.escapeHtml(createdAt)}` : ''}
                        </div>
                    </div>
                    <div class="flex flex-col gap-2 xl:items-end">
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            <div class="px-3 py-2 rounded-lg bg-surface-2 text-text-secondary">${wt('im.k504', 'Единицы: <span class="font-bold text-text-main">')}${units.length}</span></div>
                            <div class="px-3 py-2 rounded-lg bg-surface-2 text-text-secondary">${wt('im.k505', 'Рекомендации: <span class="font-bold text-text-main">')}${recs.length}</span></div>
                            <div class="px-3 py-2 rounded-lg bg-surface-2 text-text-secondary">${wt('im.k506', 'Фрагменты: <span class="font-bold text-text-main">')}${chunks.length}</span></div>
                            <div class="px-3 py-2 rounded-lg bg-surface-2 text-text-secondary">${wt('im.k507', 'Маршруты: <span class="font-bold text-text-main">')}${routes.length}</span></div>
                        </div>
                        <button type="button"
                            onclick="dashboard.importManager.pushTheoryAnalysisContextForEditor()"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-primary-fg bg-primary hover:bg-primary-dark transition-colors shadow-sm self-start xl:self-auto">
                            <span class="material-symbols-outlined text-[16px]">open_in_new</span>
                            <span>${wt('im.k1066', 'В редактор (P8)')}</span>
                        </button>
                        <button type="button"
                            onclick="dashboard.importManager.createTheoryMicrocardsDeckAll()"
                            ${this.microcardsCreateLoading ? 'disabled' : ''}
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-primary text-primary bg-primary-lighter hover:bg-primary hover:text-primary-fg transition-colors self-start xl:self-auto disabled:opacity-60">
                            <span class="material-symbols-outlined text-[16px]">style</span>
                            <span>${this.microcardsCreateLoading ? wt('im.k1067', 'Создание колоды...') : wt('im.k1068', 'Колода из анализа (P9)')}</span>
                        </button>
                        <button type="button"
                            onclick="dashboard.importManager.appendTheoryMicrocardsDeckAll()"
                            ${this.microcardsCreateLoading ? 'disabled' : ''}
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border-strong text-text-secondary bg-surface-2 hover:bg-bg-hover transition-colors self-start xl:self-auto disabled:opacity-60">
                            <span class="material-symbols-outlined text-[16px]">playlist_add</span>
                            <span>${wt('im.k1069', 'Добавить в колоду...')}</span>
                        </button>
                        <button type="button"
                            onclick="dashboard.importManager.openTheoryMicrocardsMode()"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border-strong text-text-secondary bg-surface-2 hover:bg-bg-hover transition-colors self-start xl:self-auto">
                            <span class="material-symbols-outlined text-[16px]">school</span>
                            <span>${wt('im.k1070', 'Открыть микрокарточки')}</span>
                        </button>
                        <button type="button"
                            data-role="theory-report-toggle-btn"
                            aria-expanded="${reportOpen ? 'true' : 'false'}"
                            onclick="dashboard.importManager.toggleTheoryAnalysisReportPanel()"
                            class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border-strong text-text-secondary bg-surface-2 hover:bg-bg-hover transition-colors self-start xl:self-auto">
                            <span class="material-symbols-outlined text-[16px]" data-role="theory-report-toggle-icon">${reportOpen ? 'expand_less' : 'expand_more'}</span>
                            <span data-role="theory-report-toggle-label">${reportOpen ? wt('im.k1071', 'Свернуть отчёт') : wt('im.k1072', 'Открыть отчёт')}</span>
                        </button>
                    </div>
                </div>

                <div data-role="theory-analysis-report-collapsed" class="${reportOpen ? 'hidden ' : ''}mb-2 p-3 rounded-lg border border-border-strong bg-surface-2">
                    <div class="flex items-start gap-2">
                        <span class="material-symbols-outlined text-[18px] text-text-muted mt-0.5">article</span>
                        <div class="min-w-0">
                            <p class="text-xs font-semibold text-text-main">${wt('im.k1073', 'Отчёт свёрнут')}</p>
                            <p class="text-xs text-text-secondary mt-1">${wt('im.k1074', 'Быстро откройте его кнопкой выше. Позиция прокрутки отчёта сохраняется.')}</p>
                            ${a.human_summary ? `<p class="text-[11px] text-text-secondary mt-2">${this.escapeHtml(a.human_summary)}</p>` : ''}
                        </div>
                    </div>
                </div>

                <div data-role="theory-analysis-report-body" class="${reportOpen ? '' : 'hidden '}max-h-[70vh] overflow-y-auto pr-1">
                ${reportBodyHtml}
                </div>
            </div>
        `;
    }

    async theoryAnalyze() {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.openTheoryAiInProgressPlaceholder();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        const textarea = document.getElementById('ai-material-textarea');
        if (textarea) this.materialText = textarea.value;

        if (!this.materialText || this.materialText.split(/\s+/).filter(Boolean).length < 50) {
            this.showToast(wt('im.k508', 'Загрузите файл или вставьте текст (минимум 50 слов)'), 'warning');
            return { ok: false, error: 'material_too_short' };
        }
        if (this.aiOutputLanguageMode === 'custom' && !this.aiOutputLanguage) {
            this.showToast(wt('im.k509', 'Выберите язык анализа'), 'warning');
            return { ok: false, error: 'output_language_required' };
        }
        if (this.aiStatus && this.aiStatus.ai_available === false) {
            this.showToast(wt('im.k510', 'AI-сервис недоступен. Можно открыть сохранённые анализы из списка.'), 'warning');
            return { ok: false, error: 'ai_unavailable' };
        }

        const result = await this.aiAnalyze();
        if (result?.ok) {
            this.loadTheoryAnalysisRuns().catch(() => {});
        }
        return result;
    }

    theoryResetDraft() {
        this.materialText = '';
        this.aiUploadedFile = null;
        this.aiFileInfo = null;
        this.analysisResult = null;
        this.generationResult = null;
        this.aiProvider = null;
        this.aiProviderModel = null;
        this.aiRunId = null;
        this.aiSelectedRecs.clear();
        this.aiAnalyzing = false;
        this.aiGenerating = false;
        this.theoryOpeningRunId = null;
        this.importRequestKey = null;
        this.theoryReportPanelOpen = true;
        this.theoryReportScrollTop = 0;
        this.theoryReportBlockCollapseState.clear();
        this.theoryReportActiveAnchor = null;
        this.theorySubMode = 'analysis';
        this.microcardsActiveDeck = null;
        this.microcardsSession = null;
        this.microcardsQueue = [];
        this.microcardsQueueIndex = 0;
        this.microcardsReviewReveal = false;
        this.microcardsReviewEvaluation = null;
        if (this.theoryReportAnchorHighlightTimer) {
            window.clearTimeout(this.theoryReportAnchorHighlightTimer);
            this.theoryReportAnchorHighlightTimer = null;
        }
        this.skipTheoryViewStateCaptureOnce = true;
        this.renderTheoryAnalysisMode();
    }

    async loadTheoryAnalysisRuns() {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.theoryRuns = [];
            this.theoryRunsLoading = false;
            this.theoryRunsError = '';
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        const requestToken = ++this.theoryRunsRequestToken;
        this.theoryRunsLoading = true;
        this.theoryRunsError = '';
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();

        try {
            const resp = await fetch('/api/editor/ai/analyses?limit=15');
            const data = await resp.json();
            if (requestToken !== this.theoryRunsRequestToken) return data;

            if (data.ok) {
                this.theoryRuns = Array.isArray(data.items) ? data.items : [];
                this.theoryRunsError = '';
            } else {
                this.theoryRuns = [];
                this.theoryRunsError = data.message || data.error || wt('im.k511', 'Не удалось загрузить список анализов');
            }
            return data;
        } catch (e) {
            console.error('[AI] theory analyses list failed:', e);
            if (requestToken === this.theoryRunsRequestToken) {
                this.theoryRuns = [];
                this.theoryRunsError = wt('im.k512', 'Ошибка сети при загрузке списка анализов');
            }
            return { ok: false, error: 'network_error' };
        } finally {
            if (requestToken === this.theoryRunsRequestToken) {
                this.theoryRunsLoading = false;
                if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
            }
        }
    }

    async openTheoryAnalysisRun(aiRunId) {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.openTheoryAiInProgressPlaceholder();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        const runId = (aiRunId || '').trim();
        if (!runId) return { ok: false, error: 'ai_run_id_required' };

        this.theoryOpeningRunId = runId;
        if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();

        try {
            const resp = await fetch(`/api/editor/ai/analyses/${encodeURIComponent(runId)}`);
            const data = await resp.json();
            if (data.ok) {
                this.updateTheoryFeatureFlagsFromPayload(data);
                this.analysisResult = data;
                this.aiRunId = data.ai_run_id || runId;
                this.aiProvider = data.provider_used || null;
                this.aiProviderModel = data.provider_model || null;
                this.theoryReportPanelOpen = true;
                this.theoryReportScrollTop = 0;
                this.theoryReportBlockCollapseState.clear();
                this.theoryReportActiveAnchor = null;
                if (this.theoryReportAnchorHighlightTimer) {
                    window.clearTimeout(this.theoryReportAnchorHighlightTimer);
                    this.theoryReportAnchorHighlightTimer = null;
                }
                this.skipTheoryViewStateCaptureOnce = true;
                this.generationResult = null;
                this.aiSelectedRecs.clear();
                this.importRequestKey = null;
            } else {
                this.showToast(data.message || data.error || wt('im.k513', 'Не удалось открыть анализ'), 'error');
            }
            return data;
        } catch (e) {
            console.error('[AI] theory analysis open failed:', e);
            this.showToast(wt('im.k514', 'Ошибка сети при открытии анализа'), 'error');
            return { ok: false, error: 'network_error' };
        } finally {
            this.theoryOpeningRunId = null;
            if (this.modalPurpose === 'theory_analysis') this.renderTheoryAnalysisMode();
        }
    }

    renderStep1AI(modules) {
        const savedSession = this.normalizeManualAnalysisSession(this.manualAnalysisSession);
        const sessionLooksRelevant = !!savedSession && (
            !this.selectedModule
            || !savedSession.module_id
            || String(this.selectedModule) === String(savedSession.module_id)
        ) && (
            !this.selectedTopic
            || !savedSession.topic_id
            || String(this.selectedTopic) === String(savedSession.topic_id)
        );
        const sessionSnapshot = sessionLooksRelevant ? this.getManualAnalysisCoverageSnapshot(savedSession) : null;
        const savedDraftsCount = sessionLooksRelevant
            ? Object.values(savedSession?.recommendation_state || {}).filter((state) => !!String(state?.draft_source_text || '').trim() || !!state?.draft_parsed_result).length
            : 0;

        const limitInfo = this.dailyLimit;
        const limitHtml = limitInfo ? `
            <div class="flex items-center gap-2 text-xs text-text-muted mt-2">
                <span class="material-symbols-outlined text-[16px]">cloud_upload</span>
                <span>${wt('im.k1040', 'Загрузок файлов сегодня:')} <strong class="${limitInfo.files_remaining === 0 ? 'text-error' : 'text-text-main'}">${limitInfo.max_files_per_day - limitInfo.files_remaining}</strong> ${wt('im.k1041', 'из')} ${limitInfo.max_files_per_day}</span>
            </div>` : '';

        if (this.isInternalAiGenerationInDevelopment()) {
            return `
                <div class="space-y-5 animate-fade-in">
                    <div class="p-4 bg-primary-lighter border border-primary-light rounded-lg">
                        <div class="flex items-start gap-3">
                            <span class="material-symbols-outlined text-primary text-[22px] mt-0.5">auto_awesome</span>
                            <div>
                                <h4 class="text-sm font-bold text-text-main mb-1">${wt('im.k728', 'Единственный путь: через внешний ИИ')}</h4>
                                <ol class="text-xs text-text-secondary space-y-1 list-decimal list-inside">
                                    <li>${wt('im.k1075', 'Выберите модуль и тему, куда пойдут задания')}</li>
                                    <li>${wt('im.k1076', 'На следующем шаге получите готовый промпт для внешней нейросети')}</li>
                                    <li>${wt('im.k1077', 'Сгенерируйте задания вне платформы и вставьте ответ сюда')}</li>
                                    <li>${wt('im.k1078', 'Проверьте парсинг и импортируйте результат')}</li>
                                </ol>
                            </div>
                        </div>
                    </div>

                    <div class="p-4 border border-border-subtle rounded-lg bg-surface-1">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-[18px] text-primary mt-0.5">tips_and_updates</span>
                            <div class="text-sm text-text-secondary leading-relaxed">
                                ${wt('im.k516', 'Встроенная автоматическая генерация в этом разделе больше не используется.')}
                                ${wt('im.k517', 'Здесь остаётся только сценарий с выдачей промптов для самостоятельной работы')}
                                ${wt('im.k518', 'с нейросетями "на стороне".')}
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k854', 'Целевой модуль')}</label>
                            <select id="import-module-select" 
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                                ${this.renderModuleOptions(modules, wt('im.k653', 'Выберите модуль...'))}
                            </select>
                        </div>
                        <div>
                            <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k855', 'Целевая тема')}</label>
                            <select id="import-topic-select"
                                class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                                disabled>
                                <option value="">${wt('im.k856', 'Сначала выберите модуль...')}</option>
                            </select>
                        </div>
                    </div>
                </div>
            `;
        }

        return `
            <div class="space-y-4 animate-fade-in">
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k854', 'Целевой модуль')}</label>
                        <select id="import-module-select" 
                            class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm">
                            ${this.renderModuleOptions(modules, wt('im.k653', 'Выберите модуль...'))}
                        </select>
                    </div>
                    <div>
                        <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k855', 'Целевая тема')}</label>
                        <select id="import-topic-select"
                            class="block w-full rounded-lg border-border-subtle bg-surface-2 py-2.5 text-text-main focus:ring-2 focus:ring-primary sm:text-sm"
                            disabled>
                            <option value="">${wt('im.k856', 'Сначала выберите модуль...')}</option>
                        </select>
                    </div>
                </div>

                <div class="p-4 border border-border-strong rounded-lg bg-surface-2">
                    <div class="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div class="flex items-center gap-2 flex-1">
                            <span class="material-symbols-outlined text-[18px] text-primary">translate</span>
                            <span class="text-sm font-semibold text-text-main">${wt('im.k1046', 'Язык результатов:')}</span>
                        </div>
                        <div class="flex items-center gap-3">
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="ai-output-language-mode" value="same_as_material"
                                    class="text-primary border-border-strong bg-surface-1 focus:ring-primary"
                                    ${this.aiOutputLanguageMode !== 'custom' ? 'checked' : ''}
                                    onchange="document.getElementById('ai-output-language-select').disabled = true">
                                <span class="text-sm text-text-main">${wt('im.k1047', 'Как в материале')}</span>
                            </label>
                            <label class="flex items-center gap-1.5 cursor-pointer">
                                <input type="radio" name="ai-output-language-mode" value="custom"
                                    class="text-primary border-border-strong bg-surface-1 focus:ring-primary"
                                    ${this.aiOutputLanguageMode === 'custom' ? 'checked' : ''}
                                    onchange="document.getElementById('ai-output-language-select').disabled = false; document.getElementById('ai-output-language-select').focus()">
                                <select id="ai-output-language-select"
                                    class="rounded-md border-border-subtle bg-surface-1 py-1 px-2 text-sm text-text-main focus:ring-1 focus:ring-primary disabled:opacity-50"
                                    ${this.aiOutputLanguageMode !== 'custom' ? 'disabled' : ''}>
                                    <option value="ru" ${this.aiOutputLanguage === 'ru' ? 'selected' : ''}>Русский</option>
                                    <option value="en" ${this.aiOutputLanguage === 'en' ? 'selected' : ''}>English</option>
                                </select>
                            </label>
                        </div>
                    </div>
                </div>

                <div>
                    <label class="block text-sm font-semibold text-text-secondary mb-2">${wt('im.k861', 'Загрузка материала')}</label>
                    <div id="ai-drop-zone" class="border-2 border-dashed border-border-subtle rounded-lg p-6 text-center bg-surface-2 hover:bg-bg-hover hover:border-primary transition-all cursor-pointer relative">
                        <input type="file" id="ai-file-input" accept=".pdf,.docx,.txt" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer">
                        <div class="pointer-events-none">
                            ${this.aiUploadedFile ? `
                                <span class="material-symbols-outlined text-3xl text-success-text mb-1">check_circle</span>
                                <p class="text-sm font-bold text-primary" id="ai-file-name">${this.escapeHtml(this.aiUploadedFile.name)}</p>
                                <p class="text-xs text-text-muted mt-1">${this.aiFileInfo ? `${this.aiFileInfo.word_count} слов` : wt('im.k498', 'Загружено')}</p>
                            ` : `
                                <span class="material-symbols-outlined text-3xl text-text-disabled mb-1">upload_file</span>
                                <p class="text-sm font-medium text-text-secondary" id="ai-file-name">${wt('im.k1048', 'Перетащите PDF, DOCX или TXT')}</p>
                                <p class="text-xs text-text-secondary mt-1">${wt('im.k1049', 'Максимум 18 МБ')}</p>
                            `}
                        </div>
                    </div>
                    ${limitHtml}
                </div>

                <div>
                    <div class="flex items-center gap-3 mb-2">
                        <div class="flex-1 h-px bg-border-subtle"></div>
                        <span class="text-xs text-text-disabled font-medium">${wt('im.k1050_or', 'или вставьте текст')}</span>
                        <div class="flex-1 h-px bg-border-subtle"></div>
                    </div>
                    <textarea id="ai-material-textarea" rows="6" 
                        class="block w-full rounded-lg border-border-subtle bg-surface-2 p-3 text-sm text-text-main focus:ring-2 focus:ring-primary resize-y"
                        placeholder="${wt('im.k499', 'Вставьте учебный материал сюда...')}">${this.escapeHtml(this.materialText)}</textarea>
                    <div class="flex justify-between mt-1">
                        <span class="text-xs text-text-disabled" id="ai-word-count">${this.materialText ? this.materialText.split(/\s+/).filter(Boolean).length + ' слов' : ''}</span>
                        <span class="text-xs text-text-disabled">${wt('im.k1050', 'Минимум 50 слов')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    renderStep2AI() {
        if (this.aiAnalyzing) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="AI Analyzing" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k725', 'Анализ материала...')}</h3>
                    <p class="text-text-muted text-sm mt-2">${wt('im.k1079', 'ИИ изучает ваш материал и подбирает типы заданий')}</p>
                </div>
            `;
        }

        if (!this.analysisResult) {
            return this._renderAIError(wt('im.k519', 'Не удалось получить результат анализа.'), true);
        }

        const a = this.analysisResult;
        const recs = a.recommendations || [];
        const units = a.educational_units || [];
        const notRec = a.not_recommended || [];
        const warnings = (a.warnings || []).filter(w => w !== a.output_language_warning);
        const materialLang = a.material_language || a.target_language || 'unknown';
        const outputLang = a.effective_output_language || a.target_language || 'unknown';
        const outputLangMode = a.output_language_mode || 'same_as_material';

        // Initialize selections if empty
        if (this.aiSelectedRecs.size === 0) {
            recs.forEach(r => {
                const manualOnly = r?.manual_only === true || r?.auto_generation_supported === false;
                this.aiSelectedRecs.set(r.task_type, {
                    enabled: manualOnly ? false : (r.priority === 'high' || r.priority === 'medium'),
                    count: r.count,
                });
            });
        }

        const _TYPE_LABELS = {
            'TEST': { icon: 'quiz', label: wt('im.k520', 'Тест'), color: 'bg-warning-light text-warning-dark' },
            'OPEN_ANSWER': { icon: 'edit_note', label: wt('im.k521', 'Открытый ответ'), color: 'bg-info-light text-info-dark' },
            'SEQUENCE': { icon: 'sort', label: wt('im.k522', 'Последовательность'), color: 'bg-accent-light text-accent-dark' },
            'CLICK_TEXT': { icon: 'touch_app', label: wt('im.k523', 'Выбор утверждений'), color: 'bg-secondary-light text-secondary-dark' },
            'CLICK_WORDS': { icon: 'spellcheck', label: wt('im.k524', 'Поиск ошибок'), color: 'bg-error-light text-error-dark' },
            'CLICK': { icon: 'image_search', label: wt('im.k525', 'Клик по изображению'), color: 'bg-primary-lighter text-primary' },
            'DRAW': { icon: 'gesture', label: wt('im.k526', 'Обводка на изображении'), color: 'bg-success-light text-success-dark' },
        };
        const _PRIORITY_BADGES = {
            'high': wt('im.k527', '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-error-light text-error-dark">Высокий</span>'),
            'medium': wt('im.k528', '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-warning-light text-warning-dark">Средний</span>'),
            'low': wt('im.k529', '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface-2 text-text-muted">Низкий</span>'),
        };
        const _SEQUENCE_INTENT_LABELS = {
            ordering: wt('im.k530', 'порядок'),
            classification: wt('im.k531', 'классификация'),
            hierarchy: wt('im.k532', 'иерархия'),
            ranking: wt('im.k533', 'ранжирование'),
            grouping: wt('im.k534', 'группировка'),
        };
        const futureCapabilities = Array.isArray(a.future_capabilities) ? a.future_capabilities : [];
        const pairMatchingFuture = futureCapabilities.find(fc => fc?.capability_id === 'pair_matching') || null;

        let totalSelected = 0;
        this.aiSelectedRecs.forEach(v => { if (v.enabled) totalSelected += v.count; });

        return `
            <div class="w-full animate-slide-up-fade">
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h3 class="text-lg font-bold text-text-main mb-1">${wt('im.k726', 'Результат анализа')}</h3>
                        <p class="text-sm text-text-muted">${wt('im.k1080', 'Выберите типы заданий и количество для генерации')}</p>
                    </div>
                    <!-- Total -->
                    <div class="text-right">
                        <span class="text-sm text-text-secondary mr-2">${wt('im.k1081', 'Будет сгенерировано заданий:')}</span>
                        <span class="text-2xl font-bold text-primary align-middle" id="ai-total-count">${totalSelected}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 md:grid-cols-[1fr_2fr] gap-6 items-start">
                    <!-- Left Column: Summary and Warnings -->
                    <div class="space-y-4">
                        ${a.human_summary ? `
                            <div class="p-4 bg-surface-2 rounded-lg">
                                <div class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-primary text-[20px] mt-0.5">summarize</span>
                                    <p class="text-sm text-text-secondary leading-relaxed">${this.escapeHtml(a.human_summary)}</p>
                                </div>
                            </div>
                        ` : ''}

                        <div class="p-3 bg-surface-1 border border-border-subtle rounded-lg">
                            <div class="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">${wt('im.k1082', 'Язык генерации')}</div>
                            <div class="text-xs text-text-secondary space-y-1">
                                <p><strong class="text-text-main">${wt('im.k535', 'Язык материала:</strong>')}${this.escapeHtml(materialLang)}</p>
                                <p><strong class="text-text-main">${wt('im.k1083', 'Язык заданий:')}</strong> ${this.escapeHtml(outputLang)} ${outputLangMode === 'custom' ? wt('im.k1084', '(выбран вручную)') : wt('im.k1085', '(как в материале)')}</p>
                                ${a.output_language_warning ? `<p class="text-warning-text">${this.escapeHtml(a.output_language_warning)}</p>` : ''}
                            </div>
                        </div>

                        ${warnings.length ? `
                            <div class="p-3 bg-warning-lighter border border-warning-light rounded-lg">
                                <div class="flex items-start gap-2">
                                    <span class="material-symbols-outlined text-warning-text text-[18px]">warning</span>
                                    <div class="text-xs text-warning-text space-y-1">
                                        ${warnings.map(w => `<p>${this.escapeHtml(w)}</p>`).join('')}
                                    </div>
                                </div>
                            </div>
                        ` : ''}

                        ${pairMatchingFuture ? `
                            <div class="p-3 bg-info-lighter border border-info-light rounded-lg">
                                <div class="text-xs font-semibold text-info-text uppercase tracking-wide mb-2">Planned capability</div>
                                <div class="text-xs text-info-text space-y-1">
                                    <p><strong class="text-text-main">${this.escapeHtml(pairMatchingFuture.display_name || wt('im.k536', 'MATCH (сопоставление пар)'))}</strong> · статус: ${this.escapeHtml(pairMatchingFuture.status || 'planned')}</p>
                                    ${pairMatchingFuture.suitability ? `<p>${wt('im.k1086', 'Пригодность:')} ${this.escapeHtml(pairMatchingFuture.suitability)}</p>` : ''}
                                    ${pairMatchingFuture.why ? `<p>${this.escapeHtml(pairMatchingFuture.why)}</p>` : ''}
                                </div>
                            </div>
                        ` : ''}

                        ${notRec.length ? `
                            <div>
                                <p class="text-xs font-semibold text-text-muted mb-2 uppercase tracking-wide">${wt('im.k1087', 'Не рекомендуется:')}</p>
                                <div class="text-xs text-text-disabled space-y-2">
                                    ${notRec.map(nr => {
            const typeInfo = _TYPE_LABELS[nr.task_type] || { label: nr.task_type };
            return `<p><strong class="text-text-secondary">${typeInfo.label}:</strong> ${this.escapeHtml(nr.reason || '')}</p>`;
        }).join('')}
                                </div>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Right Column: Recommendation Cards -->
                    <div class="space-y-3">
                        ${recs.map(rec => {
            const sel = this.aiSelectedRecs.get(rec.task_type) || { enabled: false, count: rec.count };
            const typeInfo = _TYPE_LABELS[rec.task_type] || { icon: 'help', label: rec.task_type, color: 'bg-surface-2 text-text-muted' };
            const manualOnly = rec?.manual_only === true || rec?.auto_generation_supported === false;
            const coveredUnits = (rec.covers_units || []).map(id => {
                const u = units.find(u => u.id === id);
                return u ? u.title : `#${id}`;
            });
            const levelRoleMap = Array.isArray(rec.level_role_map) ? rec.level_role_map : [];
            const supportedLevels = Array.isArray(rec.supported_levels) ? rec.supported_levels : [];
            const sequenceIntentOptions = Array.isArray(rec.sequence_intent_options) ? rec.sequence_intent_options : [];
            const sequenceIntentLabels = sequenceIntentOptions.map(i => _SEQUENCE_INTENT_LABELS[i] || i);
            const coverageRole = String(rec.coverage_role || '').trim();
            const countRationale = String(rec.count_rationale || '').trim();
            const progressionMetaHtml = rec.progression_is_fixed ? `
                <div class="mt-2 p-2 rounded-md bg-surface-2 border border-border-subtle">
                    <p class="text-[10px] font-semibold uppercase tracking-wide text-text-muted">${wt('im.k1088', 'Фиксированная прогрессия')}</p>
                    <p class="text-[11px] text-text-secondary leading-relaxed mt-1">${this.escapeHtml(rec.fixed_progression_note || wt('im.k537', 'Уровни этого типа рассматриваются как часть progression.'))}</p>
                    ${supportedLevels.length ? `<p class="text-[10px] text-text-disabled mt-1">${wt('im.k1089', 'Поддерживаемые уровни:')} ${supportedLevels.map(l => `L${l}`).join(', ')}</p>` : ''}
                    ${levelRoleMap.length ? `
                        <div class="mt-2 space-y-1">
                            ${levelRoleMap.map(item => `<p class="text-[10px] text-text-secondary"><strong class="text-text-main">L${item.level}:</strong> ${this.escapeHtml(item.role || '')}</p>`).join('')}
                        </div>
                    ` : ''}
                </div>
            ` : '';
            const sequenceIntentsHtml = sequenceIntentLabels.length ? `<p class="text-[10px] text-text-disabled mt-2">${wt('im.k1090', 'SEQUENCE-интенты:')} ${this.escapeHtml(sequenceIntentLabels.join(', '))}</p>` : '';
            const specialRoleHtml = rec.complex_role === 'finisher_special'
                ? `<p class="text-[10px] text-text-disabled mt-2">${wt('im.k1091', 'Роль в системе: специальный финализатор')} (${this.escapeHtml(rec.error_detection_mode || 'error_detection')})</p>`
                : '';
            const manualOnlyHtml = manualOnly
                ? `<p class=\"text-[10px] text-info-text mt-2\">${wt('im.k1092', 'Создаётся вручную в редакторе. В этом потоке автогенерация недоступна.')}</p>`
                : '';

            return `
                                <div class="border-2 rounded-lg overflow-hidden transition-all ${(sel.enabled && !manualOnly) ? 'border-primary bg-primary-lighter/30' : 'border-border-subtle opacity-70'}">
                                    <div class="p-3 flex items-start gap-3">
                                        <input type="checkbox" 
                                            class="w-4 h-4 mt-1 text-primary rounded focus:ring-primary flex-shrink-0"
                                            data-ai-rec-type="${rec.task_type}"
                                            data-testid="ai-rec-toggle-${rec.task_type}"
                                            ${sel.enabled ? 'checked' : ''}
                                            ${manualOnly ? 'disabled' : ''}
                                            onchange="dashboard.importManager.toggleAIRec('${rec.task_type}', this.checked)">
                                        <span class="material-symbols-outlined ${typeInfo.color} rounded-lg p-1.5 text-[18px] mt-0.5">${typeInfo.icon}</span>
                                        <div class="flex-1 min-w-0">
                                            <div class="flex items-center gap-2 mb-1">
                                                <span class="font-bold text-sm text-text-main">${typeInfo.label}</span>
                                                ${_PRIORITY_BADGES[rec.priority] || ''}
                                                ${manualOnly ? wt('im.k538', '<span class="px-1.5 py-0.5 rounded text-[10px] font-bold bg-info-lighter text-info-text">Вручную</span>') : ''}
                                            </div>
                                            <!-- Truncate class removed below for full visibility -->
                                            <p class="text-xs text-text-muted leading-relaxed">${this.escapeHtml(rec.rationale || '')}</p>
                                            ${coverageRole ? `<p class="text-[11px] text-text-secondary mt-2"><strong class="text-text-main">${wt('im.k1093', 'Что проверяет:')}</strong> ${this.escapeHtml(coverageRole)}</p>` : ''}
                                            ${countRationale ? `<p class="text-[11px] text-text-secondary mt-1"><strong class="text-text-main">${wt('im.k1094', 'Почему именно столько:')}</strong> ${this.escapeHtml(countRationale)}</p>` : ''}
                                            ${progressionMetaHtml}
                                            ${sequenceIntentsHtml}
                                            ${specialRoleHtml}
                                            ${coveredUnits.length ? `<p class="text-[10px] text-text-disabled mt-2">${wt('im.k1095', 'Единицы:')} ${coveredUnits.join(', ')}</p>` : ''}
                                        </div>
                                        <div class="flex items-center gap-1 flex-shrink-0 mt-0.5 ml-2">
                                            <button onclick="dashboard.importManager.adjustAIRecCount('${rec.task_type}', -1)" 
                                                class="w-7 h-7 rounded-full bg-surface-2 hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors ${(!sel.enabled || manualOnly) ? 'pointer-events-none opacity-50' : ''}">−</button>
                                            <span class="w-8 text-center font-bold text-sm text-text-main" data-ai-rec-count="${rec.task_type}">${sel.count}</span>
                                            <button onclick="dashboard.importManager.adjustAIRecCount('${rec.task_type}', 1)" 
                                                class="w-7 h-7 rounded-full bg-surface-2 hover:bg-bg-hover flex items-center justify-center text-text-secondary transition-colors ${(!sel.enabled || manualOnly) ? 'pointer-events-none opacity-50' : ''}">+</button>
                                        </div>
                                    </div>
                                </div>
                            `;
        }).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    renderStep3AI() {
        if (this.aiGenerating) {
            return `
                <div class="flex flex-col items-center justify-center py-12 animate-slide-up-fade">
                    <img src="/assets/logo_animated.svg" alt="AI Generating" class="w-16 h-16 mb-4 drop-shadow-md" />
                    <h3 class="text-lg font-bold text-text-main">${wt('im.k729', 'Генерация заданий...')}</h3>
                    <p class="text-text-muted text-sm mt-2" id="ai-gen-progress">${wt('im.k1096', 'ИИ создаёт задания по вашему материалу')}</p>
                </div>
            `;
        }

        if (!this.generationResult) {
            return this._renderAIError(wt('im.k539', 'Не удалось сгенерировать задания.'), true);
        }

        const gen = this.generationResult;
        const summary = gen.summary || {};
        const results = gen.results || [];
        const outputLangWarning = gen.output_language_warning || this.analysisResult?.output_language_warning || '';

        // Build flat task list grouped by type
        const allTasks = [];
        results.forEach(r => {
            (r.tasks || []).forEach(t => {
                allTasks.push({
                    ...t,
                    _taskType: r.task_type,
                    _provider: r.provider_used,
                    ai_meta: {
                        run_id: this.aiRunId || gen.ai_run_id || null,
                        provider_used: r.provider_used || this.aiProvider || null,
                        educational_unit_ids: Array.isArray(r.educational_unit_ids) ? [...r.educational_unit_ids] : [],
                    },
                });
            });
        });

        // Store for import
        this.parsedResult = {
            tasks: allTasks,
            summary: summary,
            notes: [],
        };
        this.importRequestKey = null;

        const _TYPE_LABELS = {
            'TEST': wt('im.k540', 'Тест'), 'OPEN_ANSWER': wt('im.k541', 'Открытый ответ'), 'SEQUENCE': wt('im.k542', 'Последовательность'),
            'CLICK_TEXT': wt('im.k543', 'Выбор утверждений'), 'CLICK_WORDS': wt('im.k544', 'Поиск ошибок'),
        };

        // Group by type
        const grouped = {};
        results.forEach(r => {
            if (r.tasks && r.tasks.length > 0) {
                grouped[r.task_type] = r;
            }
        });

        const allUnits = Array.isArray(this.analysisResult?.educational_units) ? this.analysisResult.educational_units : [];
        const coverageByUnit = new Map();
        allUnits.forEach(u => {
            if (u && u.id != null) coverageByUnit.set(u.id, { unit: u, count: 0, byType: {} });
        });
        results.forEach(r => {
            const taskCount = Array.isArray(r.tasks) ? r.tasks.length : 0;
            const unitIds = Array.isArray(r.educational_unit_ids) ? r.educational_unit_ids : [];
            unitIds.forEach(unitId => {
                const bucket = coverageByUnit.get(unitId);
                if (!bucket) return;
                bucket.count += taskCount;
                bucket.byType[r.task_type] = (bucket.byType[r.task_type] || 0) + taskCount;
            });
        });
        const uncoveredUnits = [...coverageByUnit.values()].filter(x => x.count === 0);
        const overcoveredUnits = [...coverageByUnit.values()].filter(x => x.count >= 3);
        const coverageRows = [...coverageByUnit.values()].sort((a, b) => Number(a.unit.id) - Number(b.unit.id)).map(bucket => {
            const typeBreakdown = Object.entries(bucket.byType).map(([k, v]) => `${_TYPE_LABELS[k] || k}: ${v}`).join(' · ');
            const tone = bucket.count === 0
                ? 'bg-error-lighter text-error-text border-error-light'
                : (bucket.count >= 3 ? 'bg-warning-lighter text-warning-text border-warning-light' : 'bg-success-lighter text-success-text border-success-light');
            return `
                <div class="p-2 rounded-lg border ${tone}">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="text-xs font-semibold">#${bucket.unit.id} ${this.escapeHtml(bucket.unit.title || 'Unit')}</div>
                            <div class="text-[10px] opacity-80 mt-0.5">${this.escapeHtml(String(bucket.unit.type || 'unit'))}</div>
                        </div>
                        <div class="text-xs font-bold">${bucket.count}</div>
                    </div>
                    ${typeBreakdown ? `<div class="text-[10px] mt-1 opacity-90">${this.escapeHtml(typeBreakdown)}</div>` : ''}
                </div>
            `;
        }).join('');

        return `
            <div>
                <h3 class="text-lg font-bold text-text-main mb-1">${wt('im.k730', 'Сгенерированные задания')}</h3>
                <p class="text-sm text-text-muted mb-4">${wt('im.k1097', 'Просмотрите задания и выберите для импорта')}</p>

                <!-- Summary -->
                <div class="mb-4 p-4 bg-surface-2 rounded-lg">
                    <div class="flex gap-6">
                        <div class="text-center">
                            <div class="text-2xl font-bold text-text-main">${summary.total_generated || 0}</div>
                            <div class="text-xs text-text-secondary">${wt('im.k905', 'Всего')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-success-text">${summary.total_valid || 0}</div>
                            <div class="text-xs text-text-secondary">${wt('im.k1098', 'Готовы')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-warning-text">${summary.total_warnings || 0}</div>
                            <div class="text-xs text-text-secondary">${wt('im.k1099', 'Предупр.')}</div>
                        </div>
                        <div class="text-center">
                            <div class="text-2xl font-bold text-error-text">${summary.total_errors || 0}</div>
                            <div class="text-xs text-text-secondary">${wt('im.k1100', 'Ошибки')}</div>
                        </div>
                    </div>
                </div>

                ${summary.quality ? `
                    <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg">
                        <div class="text-sm font-bold text-text-main mb-2">${wt('im.k1101', 'Проверки качества')}</div>
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">${wt('im.k1102', 'Дубликаты:')} <span class="font-bold">${summary.quality.duplicate_groups || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">${wt('im.k1103', 'Алерты языка:')} <span class="font-bold">${summary.quality.language_mismatch_warnings || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">${wt('im.k1104', 'SEQ-привязка:')} <span class="font-bold">${summary.quality.sequence_grounding_warnings || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-2">${wt('im.k1105', 'Язык материала:')} <span class="font-bold">${this.escapeHtml(summary.quality.material_language || 'unknown')}</span></div>
                        </div>
                        <div class="mt-2 text-xs text-text-secondary">
                            ${wt('im.k1106', 'Ожидаемый язык вывода:')} <span class="font-bold text-text-main">${this.escapeHtml(summary.quality.expected_output_language || gen.effective_output_language || 'unknown')}</span>
                        </div>
                    </div>
                ` : ''}

                ${outputLangWarning ? `
                    <div class="mb-4 p-3 bg-warning-lighter border border-warning-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-warning-text text-[18px]">warning</span>
                            <div class="text-xs text-warning-text">${this.escapeHtml(outputLangWarning)}</div>
                        </div>
                    </div>
                ` : ''}

                ${allUnits.length ? `
                    <div class="mb-4 p-4 bg-surface-1 border border-border-subtle rounded-lg">
                        <div class="flex items-center justify-between gap-3 mb-3">
                            <div>
                                <div class="text-sm font-bold text-text-main">${wt('im.k1107', 'Покрытие')}</div>
                                <div class="text-xs text-text-secondary">${wt('im.k1108', 'Покрытие учебных единиц перед импортом')}</div>
                            </div>
                            <div class="text-xs text-text-secondary text-right">
                                <div>${wt('im.k1109', 'Не покрыто:')} <span class="font-bold text-error-text">${uncoveredUnits.length}</span></div>
                                <div>${wt('im.k1110', 'Избыточно покрыто (3+):')} <span class="font-bold text-warning-text">${overcoveredUnits.length}</span></div>
                            </div>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                            ${coverageRows || wt('im.k545', '<div class="text-xs text-text-secondary">Нет данных о покрытии</div>')}
                        </div>
                    </div>
                ` : ''}

                <!-- Error results -->
                ${results.filter(r => r.status === 'error' && r.parsing_errors?.length).map(r => `
                    <div class="mb-3 p-3 bg-error-lighter border border-error-light rounded-lg">
                        <div class="flex items-start gap-2">
                            <span class="material-symbols-outlined text-error-text text-[18px]">error</span>
                            <div class="text-xs text-error-text">
                                <strong>${_TYPE_LABELS[r.task_type] || r.task_type}:</strong> ${r.parsing_errors.map(e => this.escapeHtml(e)).join('; ')}
                            </div>
                        </div>
                    </div>
                `).join('')}

                <!-- Grouped tasks -->
                ${Object.entries(grouped).map(([taskType, r]) => {
            const label = _TYPE_LABELS[taskType] || taskType;
            const tasks = r.tasks || [];
            const genTime = r.generation_time_ms ? ` (${(r.generation_time_ms / 1000).toFixed(1)}${wt('im.k731', 'с')})` : '';

            return `
                        <div class="mb-4 border border-border-subtle rounded-lg overflow-hidden">
                            <div class="px-4 py-2.5 bg-surface-2 flex items-center justify-between cursor-pointer"
                                onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('[data-chevron]').classList.toggle('rotate-180')">
                                <div class="flex items-center gap-2">
                                    <span class="font-bold text-sm text-text-main">${label}</span>
                                    <span class="px-2 py-0.5 rounded-full text-xs font-bold bg-primary-lighter text-primary">${tasks.length}</span>
                                    <span class="text-[10px] text-text-disabled">${genTime}</span>
                                </div>
                                <span class="material-symbols-outlined text-text-muted text-[18px] transition-transform" data-chevron>expand_more</span>
                            </div>
                            <div class="divide-y divide-border-subtle">
                                ${tasks.map((task, i) => {
                const globalIdx = allTasks.findIndex(t => t === task || (t.index === task.index && t._taskType === taskType));
                const isExcluded = this.excludedTasks.has(globalIdx);
                const statusIcon = task.status === 'error' ? '<span class="text-error-text font-bold">✗</span>' :
                    task.status === 'warning' ? '<span class="text-warning-text font-bold">⚠</span>' :
                        '<span class="text-success-text font-bold">✓</span>';

                return `
                                        <div class="px-4 py-2.5 flex items-center gap-3 ${isExcluded ? 'opacity-40' : ''} hover:bg-bg-hover transition-colors">
                                            <input type="checkbox" class="w-4 h-4 text-primary rounded focus:ring-primary flex-shrink-0"
                                                ${!isExcluded ? 'checked' : ''}
                                                onchange="dashboard.importManager.toggleExclude(${globalIdx}); this.closest('.divide-y').parentElement.querySelector('[data-chevron]').click(); dashboard.importManager.renderCurrentStep();">
                                            <div class="flex-1 min-w-0">
                                                <p class="text-sm text-text-main truncate">${this.escapeHtml(task.name || task.prompt || `${wt('im.k1111', 'Задание')} #${i + 1}`)}</p>
                                                ${task.validation_issues?.length ? `
                                                    <p class="text-[10px] text-warning-text mt-0.5">${task.validation_issues.map(v => v.message).join('; ')}</p>
                                                ` : ''}
                                            </div>
                                            ${statusIcon}
                                        </div>
                                    `;
            }).join('')}
                            </div>
                        </div>
                    `;
        }).join('')}
            </div>
        `;
    }

    _renderAIError(message, showManualBtn = false) {
        return `
            <div class="max-w-md mx-auto text-center py-12">
                <div class="w-16 h-16 bg-error-light rounded-full flex items-center justify-center mx-auto mb-4">
                    <span class="material-symbols-outlined text-error text-[32px]">error_outline</span>
                </div>
                <h3 class="text-lg font-bold text-text-main mb-2">${wt('im.k732', 'Что-то пошло не так')}</h3>
                <p class="text-sm text-text-muted mb-6">${this.escapeHtml(message)}</p>
                <div class="flex gap-3 justify-center">
                    <button onclick="dashboard.importManager.prevStep()" 
                        class="px-4 py-2 text-sm font-medium text-text-secondary border border-border-subtle rounded-lg hover:bg-bg-hover transition-colors">
                        ${wt('im.k546', 'Назад')}
                    </button>
                    ${showManualBtn ? `
                        <button onclick="dashboard.importManager.setImportMode('text'); dashboard.importManager.goToStep(1)" 
                            class="px-4 py-2 text-sm font-medium text-primary border border-primary rounded-lg hover:bg-primary hover:text-primary-fg transition-colors">
                            ${wt('im.k615', 'Ручной режим')}
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }

    // =========================================================================
    // AI API Calls
    // =========================================================================

    async aiCheckStatus() {
        if (this.isInternalAiGenerationInDevelopment()) {
            const data = {
                ok: false,
                error: 'ai_mode_in_progress',
                ai_available: false,
                status_check_failed: true,
            };
            this.aiStatus = data;
            return data;
        }
        try {
            const resp = await fetch('/api/editor/ai/status');
            const data = await resp.json();
            this.aiStatus = data;
            this.updateTheoryFeatureFlagsFromPayload(data);
            this.dailyLimit = data.daily_limit || null;
            return data;
        } catch (e) {
            console.error('[AI] status check failed:', e);
            this.aiStatus = { ai_available: false, status_check_failed: true };
            return this.aiStatus;
        }
    }

    async aiUploadFile(file) {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.openTheoryAiInProgressPlaceholder();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        const formData = new FormData();
        formData.append('file', file);
        try {
            const resp = await fetch('/api/editor/ai/upload', { method: 'POST', body: formData });
            const data = await resp.json();
            if (data.ok) {
                this.materialText = data.extracted_text;
                this.aiFileInfo = data.file_info;
                this.dailyLimit = { ...(this.dailyLimit || {}), files_remaining: (this.dailyLimit?.files_remaining ?? 3) - 1 };
                if (data.warnings?.length) {
                    this.showToast(data.warnings[0], 'warning');
                }
            } else {
                this.showToast(data.message || data.error || wt('im.k547', 'Ошибка загрузки файла'), 'error');
            }
            return data;
        } catch (e) {
            console.error('[AI] upload failed:', e);
            this.showToast(wt('im.k548', 'Ошибка сети при загрузке файла'), 'error');
            return { ok: false, error: 'network_error' };
        }
    }

    async aiAnalyze() {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.aiAnalyzing = false;
            this.openTheoryAiInProgressPlaceholder();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        this.aiAnalyzing = true;
        this.analysisResult = null;
        this.aiRunId = null;
        this.importRequestKey = null;
        this.theoryReportBlockCollapseState.clear();
        this.theoryReportActiveAnchor = null;
        if (this.theoryReportAnchorHighlightTimer) {
            window.clearTimeout(this.theoryReportAnchorHighlightTimer);
            this.theoryReportAnchorHighlightTimer = null;
        }
        this.renderCurrentStep();

        try {
            const resp = await fetch('/api/editor/ai/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: this.materialText,
                    ai_run_id: this.aiRunId,
                    source_file_info: this.aiFileInfo || (this.aiUploadedFile ? { name: this.aiUploadedFile.name } : null),
                    ...this.getAIOutputLanguagePayload(),
                }),
            });
            const data = await resp.json();

            this.aiAnalyzing = false;

            if (data.ok) {
                this.updateTheoryFeatureFlagsFromPayload(data);
                this.analysisResult = data;
                this.aiProvider = data.provider_used;
                this.aiProviderModel = data.provider_model || null;
                this.aiRunId = data.ai_run_id || this.aiRunId;
                this.theoryReportPanelOpen = true;
                this.theoryReportScrollTop = 0;
                this.theoryReportBlockCollapseState.clear();
                this.theoryReportActiveAnchor = null;
                if (this.theoryReportAnchorHighlightTimer) {
                    window.clearTimeout(this.theoryReportAnchorHighlightTimer);
                    this.theoryReportAnchorHighlightTimer = null;
                }
                this.aiSelectedRecs.clear();
                this.importRequestKey = null;
            } else {
                if (data.fallback === 'manual') {
                    this.showToast(data.message || wt('im.k549', 'ИИ-сервис недоступен'), 'error');
                } else {
                    this.showToast(data.message || data.error || wt('im.k550', 'Ошибка анализа'), 'error');
                }
            }
            this.renderCurrentStep();
            return data;
        } catch (e) {
            console.error('[AI] analyze failed:', e);
            this.aiAnalyzing = false;
            this.showToast(wt('im.k551', 'Ошибка сети при анализе материала'), 'error');
            this.renderCurrentStep();
            return { ok: false, error: 'network_error' };
        }
    }

    async aiGenerate() {
        if (this.isInternalAiGenerationInDevelopment()) {
            this.aiGenerating = false;
            this.openTheoryAiInProgressPlaceholder();
            return { ok: false, error: 'ai_mode_in_progress' };
        }
        const tasksToGenerate = [];
        this.aiSelectedRecs.forEach((val, key) => {
            if (val.enabled && val.count > 0) {
                const rec = (this.analysisResult?.recommendations || []).find(r => r.task_type === key);
                if (rec?.manual_only === true || rec?.auto_generation_supported === false) {
                    return;
                }
                tasksToGenerate.push({
                    task_type: key,
                    count: val.count,
                    educational_units: rec?.covers_units ?
                        (this.analysisResult?.educational_units || []).filter(u => rec.covers_units.includes(u.id)) : [],
                });
            }
        });

        if (tasksToGenerate.length === 0) {
            this.showToast(wt('im.k552', 'Выберите хотя бы один тип заданий'), 'warning');
            return { ok: false };
        }

        this.aiGenerating = true;
        this.generationResult = null;
        this.importRequestKey = null;
        this.renderCurrentStep();

        try {
            const resp = await fetch('/api/editor/ai/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    material: this.materialText,
                    ai_run_id: this.aiRunId,
                    tasks_to_generate: tasksToGenerate,
                    ...this.getAIOutputLanguagePayload(),
                }),
            });
            const data = await resp.json();

            this.aiGenerating = false;

            if (data.ok) {
                this.generationResult = data;
                this.aiRunId = data.ai_run_id || this.aiRunId;
                this.excludedTasks.clear();
                this.importRequestKey = null;
            } else {
                this.showToast(data.message || data.error || wt('im.k553', 'Ошибка генерации'), 'error');
            }
            this.renderCurrentStep();
            return data;
        } catch (e) {
            console.error('[AI] generate failed:', e);
            this.aiGenerating = false;
            this.showToast(wt('im.k554', 'Ошибка сети при генерации заданий'), 'error');
            this.renderCurrentStep();
            return { ok: false, error: 'network_error' };
        }
    }

    // =========================================================================
    // AI UI Helpers
    // =========================================================================

    getAIOutputLanguagePayload() {
        return {
            output_language_mode: this.aiOutputLanguageMode === 'custom' ? 'custom' : 'same_as_material',
            output_language: this.aiOutputLanguageMode === 'custom' ? (this.aiOutputLanguage || null) : null,
        };
    }

    setAIOutputLanguageMode(mode) {
        this.aiOutputLanguageMode = mode === 'custom' ? 'custom' : 'same_as_material';
        this.renderCurrentStep();
    }

    setAIOutputLanguage(lang) {
        this.aiOutputLanguage = (lang || '').trim().toLowerCase() || 'ru';
    }

    toggleAIRec(taskType, enabled) {
        const current = this.aiSelectedRecs.get(taskType) || { enabled: false, count: 0 };
        this.aiSelectedRecs.set(taskType, { ...current, enabled });
        this.renderCurrentStep();
    }

    adjustAIRecCount(taskType, delta) {
        const current = this.aiSelectedRecs.get(taskType);
        if (!current) return;
        const newCount = Math.max(1, Math.min(20, current.count + delta));
        this.aiSelectedRecs.set(taskType, { ...current, count: newCount });
        const el = document.querySelector(`[data-ai-rec-count="${taskType}"]`);
        if (el) el.textContent = newCount;
        // Update total
        let total = 0;
        this.aiSelectedRecs.forEach(v => { if (v.enabled) total += v.count; });
        const totalEl = document.getElementById('ai-total-count');
        if (totalEl) totalEl.textContent = total;
    }

    async _handleAIFileSelected(file) {
        if (!file) return;
        const ext = file.name.split('.').pop().toLowerCase();
        const allowedExts = ['pdf', 'docx', 'txt'];
        if (!allowedExts.includes(ext)) {
            this.showToast(`${wt('im.k733', 'Формат')} .${ext} ${wt('im.k734', 'не поддерживается. Используйте PDF, DOCX или TXT.')}`, 'error');
            return;
        }
        if (file.size > 18 * 1024 * 1024) {
            this.showToast(wt('im.k555', 'Файл слишком большой (максимум 18 МБ).'), 'error');
            return;
        }
        this.aiUploadedFile = file;

        // Update UI
        const nameEl = document.getElementById('ai-file-name');
        if (nameEl) {
            nameEl.textContent = file.name;
            nameEl.className = 'text-sm font-bold text-primary';
        }

        // Upload to server
        const result = await this.aiUploadFile(file);
        if (result.ok) {
            this.showToast(`${wt('im.k735', 'Файл загружен:')} ${result.word_count} ${wt('im.k675', 'слов')}`, 'success');
            // Update word count display
            const wordCountEl = document.getElementById('ai-word-count');
            if (wordCountEl) wordCountEl.textContent = `${result.word_count} ${wt('im.k675', 'слов')} ${wt('im.k736', '(из файла)')}`;
            // Update textarea
            const textarea = document.getElementById('ai-material-textarea');
            if (textarea) textarea.value = this.materialText;
        } else {
            this.aiUploadedFile = null;
            this.renderCurrentStep();
        }
    }
}
