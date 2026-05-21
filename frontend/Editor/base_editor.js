/**
 * BaseEditor - Base class for all task editors
 * Provides common functionality for loading, saving, validation, and UI updates
 */

function isReferencePreviewMode() {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('reference_embed') === '1' || params.get('reference_preview') === '1';
}

class BaseEditor {
    constructor() {
        this.task = null;
        this.moduleId = null;
        this.topicId = null;
        this.taskId = null;
        this.isNewTaskParam = false;
        this.taskTypeParam = '';
        this.taskNameParam = '';
        this.restoreDraftIntent = false;
        this.hasPersistedTask = false;
        this.hasUnsavedChanges = false;
        this.validationFeedbackState = {
            lastBlockingToastKey: '',
        };
        this._navigationGuardsSetup = false;
        this._beforeUnloadHandler = null;
        this._historyGuardHandler = null;
        this._historyGuardToken = '';
        this._historyGuardPromptOpen = false;
        this._historyGuardDisabled = false;

        // Undo/Redo support
        this.undoManager = new UndoManager(50);
        this.setupUndoRedoHandlers();

        // P8 bridge state (theory report <-> manual editor)
        this.editorTheoryBridgeStorageKey = 'rp_editor_theory_bridge_v1';
        this.editorTheoryGroundingPrefsStorageKey = 'rp_editor_theory_grounding_p8_prefs_v1';
        this.manualAnalysisArchiveStorageKey = 'editor_manual_analysis_archive_v1';
        this.theoryGrounding = {
            panelOpen: false,
            bridgeContext: null,
            analyses: [],
            analysesLoading: false,
            analysesError: '',
            selectedRunId: null,
            analysisData: null,
            analysisLoading: false,
            analysisError: '',
            coverageData: null,
            coverageLoading: false,
            coverageError: '',
            coverageIgnored: false,
            trustLevel: 'normal',
            selectedUnitIds: new Set(),
            selectedChunkIds: new Set(),
            items: [],
            itemsLoading: false,
            itemsError: '',
            selectedAnalysisId: '',
            selectedAnalysisData: null,
            showAll: false,
            currentTaskType: '',
        };
        this.difficultyAuthoring = {
            metaCache: new Map(),
            activeMeta: null,
            activeKey: '',
            state: {
                mode: 'all',
                selectedLevels: [],
                lastCustomSelectedLevels: [],
            },
            ui: {
                expanded: false,
            },
        };

        this.setupNavigationGuards();
    }

    // ===== TASK CONTEXT =====

    /**
     * Get task context from URL parameters
     * @returns {Object} Object with moduleId, topicId, taskId
     */
    getTaskContext() {
        const params = new URLSearchParams(window.location.search);
        return {
            moduleId: params.get('module'),
            topicId: params.get('topic'),
            taskId: params.get('task'),
            isNewTask: params.get('new') === '1' || params.get('is_new') === '1',
            restoreDraft: params.get('restore_draft') === '1',
            taskType: params.get('task_type') || '',
            taskName: params.get('task_name') || '',
        };
    }

    getDraftTaskIds() {
        return [...new Set([
            this.taskId,
            this.task?.task_data?.id,
            this.task?.task_data?.meta?.id,
            this.task?.metadata?.id,
        ].map((value) => String(value || '').trim()).filter(Boolean))];
    }

    getTaskBootstrapStorageKey(moduleId, topicId, taskId) {
        if (!moduleId || !topicId || !taskId) return '';
        return `editor_task_bootstrap_${moduleId}_${topicId}_${taskId}`;
    }

    readTaskBootstrap(moduleId, topicId, taskId) {
        const key = this.getTaskBootstrapStorageKey(moduleId, topicId, taskId);
        if (!key || typeof sessionStorage === 'undefined') return null;
        try {
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            console.warn('[BaseEditor] Failed to read task bootstrap', error);
            return null;
        }
    }

    clearTaskBootstrap(moduleId = this.moduleId, topicId = this.topicId, taskId = this.taskId) {
        const key = this.getTaskBootstrapStorageKey(moduleId, topicId, taskId);
        if (!key || typeof sessionStorage === 'undefined') return;
        try {
            sessionStorage.removeItem(key);
        } catch (error) {
            console.warn('[BaseEditor] Failed to clear task bootstrap', error);
        }
    }

    async fetchTaskBootstrap(moduleId, topicId, taskId, taskType, taskName) {
        if (!moduleId || !topicId || !taskId || !taskType || !taskName) return null;
        try {
            const response = await fetch('/api/editor/task/bootstrap', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    module_id: moduleId,
                    topic_id: topicId,
                    task_id: taskId,
                    task_type: taskType,
                    task_name: taskName,
                }),
            });
            const data = await response.json();
            return data?.ok ? data.task || null : null;
        } catch (error) {
            console.warn('[BaseEditor] Failed to fetch task bootstrap', error);
            return null;
        }
    }

    ensureAutoSaveManager() {
        if (!this.autoSaveManager) {
            this.autoSaveManager = new AutoSaveManager(this, { interval: 30000 });
        }
        return this.autoSaveManager;
    }

    buildDraftBootstrapFromLocalState(moduleId, topicId, taskId, draft) {
        if (!draft?.data || !moduleId || !topicId || !taskId) return null;

        const taskType = String(draft.taskType || this.taskTypeParam || '').trim();
        const taskName = String(draft.taskName || this.taskNameParam || taskId || '').trim();
        const moduleName = String(draft.moduleName || '').trim();
        const topicName = String(draft.topicName || '').trim();

        return {
            task_data: {
                id: taskId,
                type: taskType,
                name: taskName,
                content: {},
                settings: {},
                meta: {
                    id: taskId,
                    module: moduleId,
                    topic: topicId,
                    name: taskName,
                    module_name: moduleName,
                    topic_name: topicName,
                },
            },
            metadata: {
                id: taskId,
                module: moduleId,
                topic: topicId,
                name: taskName,
                type: taskType,
                module_name: moduleName,
                topic_name: topicName,
            },
        };
    }

    resolveLocalTaskFallback(moduleId, topicId, taskId) {
        const bootstrap = this.readTaskBootstrap(moduleId, topicId, taskId);
        if (bootstrap) {
            return bootstrap;
        }

        const draft = this.ensureAutoSaveManager().loadDraft();
        return this.buildDraftBootstrapFromLocalState(moduleId, topicId, taskId, draft);
    }

    applyLoadedTask(task, options = {}) {
        const { persisted = true } = options;
        this.task = task;
        this.hasPersistedTask = Boolean(persisted);

        this.ensureAutoSaveManager();

        const lastSaved = persisted ? (this.task?.task_data?.meta?.modified || 0) : 0;
        let restoredDraftSilently = false;
        if (this.autoSaveManager.hasFresherDraft(lastSaved)) {
            const draft = this.autoSaveManager.loadDraft();
            if (this.shouldAutoRestoreDraft(draft)) {
                this.restoreState(draft.data);
                this.refreshDifficultyAuthoringControls().catch((error) => {
                    console.warn('[BaseEditor] difficulty authoring bootstrap failed', error);
                });
                this.initTheoryGroundingPanel();
                this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                this.showToast(this.getAutoRestoreDraftToastMessage(), 'info');
                this.autoSaveManager.start();
                restoredDraftSilently = true;
                if (this.restoreDraftIntent) {
                    this.restoreDraftIntent = false;
                    this.cleanupPersistedTaskRoute();
                }
            } else {
                this.promptDraftRecovery(lastSaved);
            }
        } else {
            this.onTaskLoaded();
            this.refreshDifficultyAuthoringControls().catch((error) => {
                console.warn('[BaseEditor] difficulty authoring bootstrap failed', error);
            });
            this.initTheoryGroundingPanel();
            this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
            this.autoSaveManager.start();
            if (this.restoreDraftIntent) {
                this.restoreDraftIntent = false;
                this.cleanupPersistedTaskRoute();
            }
        }

        if (!restoredDraftSilently) {
            this.markSaved();
        }
    }

    async initTaskFromUrlContext() {
        const context = this.getTaskContext();
        this.moduleId = context.moduleId;
        this.topicId = context.topicId;
        this.taskId = context.taskId;
        this.isNewTaskParam = Boolean(context.isNewTask);
        this.restoreDraftIntent = Boolean(context.restoreDraft);
        this.taskTypeParam = String(context.taskType || '').trim();
        this.taskNameParam = String(context.taskName || '').trim();

        if (!this.moduleId || !this.topicId || !this.taskId) {
            console.error('Missing task parameters in URL');
            this.showFatalError(wt('editor_base.error_invalid_link', 'Неверная ссылка: отсутствуют параметры задания (module, topic, task)'));
            return false;
        }

        if (!this.isNewTaskParam) {
            await this.loadTask(this.moduleId, this.topicId, this.taskId);
            return true;
        }

        const localBootstrap = this.resolveLocalTaskFallback(this.moduleId, this.topicId, this.taskId);
        if (localBootstrap) {
            this.applyLoadedTask(localBootstrap, { persisted: false });
            return true;
        }

        try {
            const response = await fetch(`/api/editor/task/${this.moduleId}/${this.topicId}/${this.taskId}`);
            const data = await response.json();
            if (response.ok && data?.ok && data.task) {
                this.applyLoadedTask(data.task, { persisted: true });
                this.cleanupPersistedTaskRoute();
                return true;
            }
            if (response.status && response.status !== 404) {
                this.showFatalError(data?.error || wt('editor_base.error_load_task', 'Не удалось загрузить задание'));
                return false;
            }
        } catch (error) {
            console.warn('[BaseEditor] Existing task load failed, trying bootstrap', error);
        }

        const bootstrap = await this.fetchTaskBootstrap(
            this.moduleId,
            this.topicId,
            this.taskId,
            this.taskTypeParam,
            this.taskNameParam
        );

        if (!bootstrap) {
            this.showFatalError(wt('editor_base.error_draft_not_found', 'Черновик не найден. Откройте создание задания заново.'));
            return false;
        }

        this.applyLoadedTask(bootstrap, { persisted: false });
        return true;
    }

    // ===== LOADING =====

    /**
     * Load task from backend
     * @param {string} moduleId - Module ID
     * @param {string} topicId - Topic ID
     * @param {string} taskId - Task ID
     */
    async loadTask(moduleId, topicId, taskId) {
        this.moduleId = moduleId;
        this.topicId = topicId;
        this.taskId = taskId;

        try {
            const response = await fetch(`/api/editor/task/${moduleId}/${topicId}/${taskId}`);
            const data = await response.json();

            if (
                !data.ok
                && (
                    response.status === 404
                    || String(data?.error || '').trim().toLowerCase() === 'task_not_found'
                )
            ) {
                const localTask = this.resolveLocalTaskFallback(moduleId, topicId, taskId);
                if (localTask) {
                    this.applyLoadedTask(localTask, { persisted: false });
                    return;
                }
            }

            if (data.ok) {
                this.applyLoadedTask(data.task, { persisted: true });
            } else {
                this.showFatalError(data.error || wt('editor_base.error_load_task_failed', 'Ошибка загрузки задания'));
            }
        } catch (error) {
            console.error("Error loading task:", error);
            this.showFatalError(wt('editor_base.error_network_prefix', 'Ошибка сети:') + ' ' + error.message);
        }
    }

    /**
     * Prompt user to recover draft
     * Called when a fresher draft is detected in localStorage
     */
    promptDraftRecovery(lastSavedTimestamp = null) {
        const draft = this.autoSaveManager.loadDraft();
        if (!draft) {
            this.onTaskLoaded();
            this.refreshDifficultyAuthoringControls().catch((error) => {
                console.warn('[BaseEditor] difficulty authoring bootstrap failed', error);
            });
            this.initTheoryGroundingPanel();
            this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
            this.autoSaveManager.start();
            return;
        }

        const recoveryCopy = this.buildDraftRecoveryCopy(draft, lastSavedTimestamp);

        this.showConfirmModal({
            title: recoveryCopy.title,
            message: recoveryCopy.message,
            confirmText: recoveryCopy.confirmText,
            cancelText: recoveryCopy.cancelText,
            variant: 'primary',
            onConfirm: () => {
                this.restoreState(draft.data);
                this.refreshDifficultyAuthoringControls().catch((error) => {
                    console.warn('[BaseEditor] difficulty authoring bootstrap failed', error);
                });
                this.initTheoryGroundingPanel();
                this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                this.showToast(wt('editor_base.toast_changes_restored', 'Несохранённые изменения восстановлены'), 'success');
                this.autoSaveManager.start();
            },
            onCancel: () => {
                this.onTaskLoaded();
                this.refreshDifficultyAuthoringControls().catch((error) => {
                    console.warn('[BaseEditor] difficulty authoring bootstrap failed', error);
                });
                this.initTheoryGroundingPanel();
                this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                this.autoSaveManager.start();
            }
        });
    }

    // ===== DIFFICULTY AUTHORING =====

    _cloneSerializable(value) {
        if (value == null) return value;
        return JSON.parse(JSON.stringify(value));
    }

    _normalizeDifficultyLevels(values) {
        if (!Array.isArray(values)) return [];
        const seen = new Set();
        const out = [];
        values.forEach((raw) => {
            const level = Number.parseInt(raw, 10);
            if (!Number.isFinite(level) || level < 1 || seen.has(level)) return;
            seen.add(level);
            out.push(level);
        });
        out.sort((a, b) => a - b);
        return out;
    }

    getDifficultyAuthoringMountPoint() {
        return null;
    }

    getDifficultyAuthoringContainerId() {
        return 'editor-difficulty-authoring';
    }

    getDifficultyAuthoringLayoutVariant() {
        return 'default';
    }

    getDifficultyAuthoringInsertMode() {
        return 'prepend';
    }

    _getDifficultyAuthoringTaskType(taskData = this.task?.task_data) {
        return String(
            taskData?.type
            || this.taskTypeParam
            || this.task?.metadata?.type
            || ''
        ).trim().toLowerCase();
    }

    _getDifficultyAuthoringSubtype(taskData = this.task?.task_data) {
        const subtype = String(
            taskData?.subtype
            || taskData?.content?.subtype
            || this.task?.metadata?.subtype
            || ''
        ).trim().toLowerCase();
        return subtype || null;
    }

    _getDifficultyAuthoringCacheKey(taskType, subtype) {
        return `${String(taskType || '').trim().toLowerCase()}::${String(subtype || '').trim().toLowerCase()}`;
    }

    _extractTaskAuthoredDifficultyLevels(taskData = this.task?.task_data) {
        const settings = (taskData?.settings && typeof taskData.settings === 'object')
            ? taskData.settings
            : {};
        return this._normalizeDifficultyLevels(
            settings.allowed_difficulties || settings.available_difficulties || []
        );
    }

    _getDifficultyAuthoringLocalSettings(taskData = this.task?.task_data) {
        const settings = (taskData?.settings && typeof taskData.settings === 'object')
            ? taskData.settings
            : {};
        const rawMode = String(settings.__difficulty_authoring_mode || '').trim().toLowerCase();
        return {
            mode: rawMode === 'custom' ? 'custom' : 'all',
            selectedLevels: this._normalizeDifficultyLevels(settings.__difficulty_authoring_selected_levels || []),
        };
    }

    async loadDifficultyAuthoringMeta(taskData = this.task?.task_data, options = {}) {
        const { force = false } = options;
        const taskType = this._getDifficultyAuthoringTaskType(taskData);
        const subtype = this._getDifficultyAuthoringSubtype(taskData);
        if (!taskType) return null;

        const cacheKey = this._getDifficultyAuthoringCacheKey(taskType, subtype);
        if (!force && this.difficultyAuthoring.metaCache.has(cacheKey)) {
            const cached = this.difficultyAuthoring.metaCache.get(cacheKey);
            this.difficultyAuthoring.activeMeta = cached;
            this.difficultyAuthoring.activeKey = cacheKey;
            return cached;
        }

        if (typeof fetch !== 'function') return null;

        const params = new URLSearchParams({ task_type: taskType });
        if (subtype) params.set('subtype', subtype);
        const response = await fetch(`/api/editor/difficulty-meta?${params.toString()}`);
        const data = await response.json();
        if (!response.ok || !data?.ok || !data?.meta) {
            throw new Error(data?.error || 'difficulty_meta_failed');
        }

        const meta = {
            ...data.meta,
            supported_levels: this._normalizeDifficultyLevels(data.meta.supported_levels || []),
            level_role_map: Array.isArray(data.meta.level_role_map) ? data.meta.level_role_map : [],
            authoring_enabled: Boolean(data.meta.authoring_enabled),
            subtype,
        };

        this.difficultyAuthoring.metaCache.set(cacheKey, meta);
        this.difficultyAuthoring.activeMeta = meta;
        this.difficultyAuthoring.activeKey = cacheKey;
        return meta;
    }

    syncDifficultyAuthoringStateFromTask(taskData = this.task?.task_data, meta = this.difficultyAuthoring.activeMeta) {
        const state = this.difficultyAuthoring.state;
        const supportedLevels = this._normalizeDifficultyLevels(meta?.supported_levels || []);
        if (!meta?.authoring_enabled || supportedLevels.length <= 1) {
            state.mode = 'all';
            state.selectedLevels = [...supportedLevels];
            state.lastCustomSelectedLevels = [...supportedLevels];
            return;
        }

        const localState = this._getDifficultyAuthoringLocalSettings(taskData);
        if (localState.mode === 'custom') {
            const localSelected = localState.selectedLevels.filter((level) => supportedLevels.includes(level));
            state.mode = 'custom';
            state.selectedLevels = [...localSelected];
            state.lastCustomSelectedLevels = localSelected.length
                ? [...localSelected]
                : this._normalizeDifficultyLevels(state.lastCustomSelectedLevels || []).filter((level) => supportedLevels.includes(level));
            return;
        }

        const authored = this._extractTaskAuthoredDifficultyLevels(taskData)
            .filter((level) => supportedLevels.includes(level));

        if (!authored.length || authored.length === supportedLevels.length) {
            state.mode = 'all';
            state.selectedLevels = [...supportedLevels];
            state.lastCustomSelectedLevels = [...supportedLevels];
            return;
        }

        state.mode = 'custom';
        state.selectedLevels = [...authored];
        state.lastCustomSelectedLevels = [...authored];
    }

    captureTaskSettingsState() {
        return this._cloneSerializable(this.task?.task_data?.settings || {});
    }

    restoreTaskSettingsState(settings) {
        if (!this.task?.task_data) return;
        if (settings && typeof settings === 'object') {
            this.task.task_data.settings = this._cloneSerializable(settings);
        } else if (!this.task.task_data.settings || typeof this.task.task_data.settings !== 'object') {
            this.task.task_data.settings = {};
        }
        this.syncDifficultyAuthoringStateFromTask();
    }

    _resolveDifficultyAuthoringSelection(meta = this.difficultyAuthoring.activeMeta) {
        const supportedLevels = this._normalizeDifficultyLevels(meta?.supported_levels || []);
        if (!meta?.authoring_enabled || supportedLevels.length <= 1) {
            return {
                mode: 'all',
                selectedLevels: [...supportedLevels],
                supportedLevels,
            };
        }

        const state = this.difficultyAuthoring.state || {};
        const mode = state.mode === 'custom' ? 'custom' : 'all';
        const selectedLevels = this._normalizeDifficultyLevels(
            mode === 'custom' ? state.selectedLevels : supportedLevels
        ).filter((level) => supportedLevels.includes(level));

        return { mode, selectedLevels, supportedLevels };
    }

    applyDifficultyAuthoringStateToTaskData(taskData = this.task?.task_data, meta = this.difficultyAuthoring.activeMeta) {
        if (!taskData || typeof taskData !== 'object') return;
        const settings = (taskData.settings && typeof taskData.settings === 'object')
            ? taskData.settings
            : (taskData.settings = {});

        if (!meta?.authoring_enabled) {
            delete settings.allowed_difficulties;
            delete settings.available_difficulties;
            return;
        }

        const { mode, selectedLevels, supportedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        settings.__difficulty_authoring_mode = mode;
        settings.__difficulty_authoring_selected_levels = [...selectedLevels];

        if (mode !== 'custom' || !selectedLevels.length || selectedLevels.length === supportedLevels.length) {
            delete settings.allowed_difficulties;
            delete settings.available_difficulties;
            return;
        }

        settings.allowed_difficulties = [...selectedLevels];
        delete settings.available_difficulties;
    }

    sanitizeDifficultyAuthoringPayload(taskData = this.task?.task_data, meta = this.difficultyAuthoring.activeMeta) {
        if (!taskData || typeof taskData !== 'object') return;
        const settings = (taskData.settings && typeof taskData.settings === 'object')
            ? taskData.settings
            : null;
        if (!settings) return;

        delete settings.__difficulty_authoring_mode;
        delete settings.__difficulty_authoring_selected_levels;

        if (!meta?.authoring_enabled) {
            delete settings.allowed_difficulties;
            delete settings.available_difficulties;
            return;
        }

        const { mode, selectedLevels, supportedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        if (mode !== 'custom' || !selectedLevels.length || selectedLevels.length === supportedLevels.length) {
            delete settings.allowed_difficulties;
            delete settings.available_difficulties;
            return;
        }

        settings.allowed_difficulties = [...selectedLevels];
        delete settings.available_difficulties;
    }

    async applyDifficultyAuthoringSettings(taskData = this.task?.task_data, options = {}) {
        const { showValidationToast = false } = options;
        let meta = this.difficultyAuthoring.activeMeta;
        const taskType = this._getDifficultyAuthoringTaskType(taskData);
        const subtype = this._getDifficultyAuthoringSubtype(taskData);
        const cacheKey = this._getDifficultyAuthoringCacheKey(taskType, subtype);

        if (!meta || this.difficultyAuthoring.activeKey !== cacheKey) {
            try {
                meta = await this.loadDifficultyAuthoringMeta(taskData);
            } catch (error) {
                if (showValidationToast) {
                    this.showToast(wt('editor_base.toast_levels_load_failed', 'Не удалось загрузить параметры уровней сложности. Повторите попытку сохранения.'), 'error');
                }
                return false;
            }
        }

        this.syncDifficultyAuthoringStateFromTask(taskData, meta);
        const { mode, selectedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        if (meta?.authoring_enabled && mode === 'custom' && !selectedLevels.length) {
            if (showValidationToast) {
                this.showToast(wt('editor_base.toast_select_at_least_one_level', 'Выберите хотя бы один доступный уровень сложности.'), 'warning');
            }
            return false;
        }

        this.applyDifficultyAuthoringStateToTaskData(taskData, meta);
        return true;
    }

    getDifficultyAuthoringBlockingState(taskData = this.task?.task_data, meta = this.difficultyAuthoring.activeMeta) {
        if (!meta?.authoring_enabled) return null;

        this.syncDifficultyAuthoringStateFromTask(taskData, meta);
        const { mode, selectedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        if (mode !== 'custom' || selectedLevels.length) {
            return null;
        }

        return {
            code: 'difficulty_levels_required',
            message: wt('editor_base.msg_needs_editing', '! Требуется правка'),
            detail: wt('editor_base.msg_select_level_detail', 'Выберите хотя бы один уровень сложности. Пока набор пустой, задание нельзя сохранить и использовать.'),
            draftDetail: wt('editor_base.msg_select_level_draft_detail', 'Черновик сохранён локально, но задание нельзя сохранить и использовать, пока не выбран хотя бы один уровень сложности.'),
        };
    }

    getBlockingEditorState(taskData = this.task?.task_data) {
        return this.getDifficultyAuthoringBlockingState(taskData);
    }

    getBlockingSaveStatusOptions(blockingState = this.getBlockingEditorState()) {
        if (!blockingState) {
            return { type: this.hasUnsavedChanges ? 'dirty' : 'saved' };
        }
        return {
            type: 'blocking',
            message: blockingState.message || wt('editor_base.status.needs_editing', '! Требуется правка'),
            detail: blockingState.detail || '',
        };
    }

    updateDifficultyAuthoringBlockingUi(blockingState = this.getBlockingEditorState()) {
        const container = document.getElementById(this.getDifficultyAuthoringContainerId());
        if (!container) return;

        const code = String(blockingState?.code || '').trim();
        const isDifficultyBlocking = code === 'difficulty_levels_required';

        container.dataset.blocking = isDifficultyBlocking ? 'true' : 'false';
        if (isDifficultyBlocking) {
            container.dataset.blockingCode = code;
        } else {
            delete container.dataset.blockingCode;
        }
        container.classList.toggle('difficulty-authoring--blocking', isDifficultyBlocking);
        container.setAttribute('aria-invalid', isDifficultyBlocking ? 'true' : 'false');
    }

    isDifficultyAuthoringExpanded(blockingState = this.getBlockingEditorState()) {
        if (blockingState) {
            return true;
        }
        return Boolean(this.difficultyAuthoring?.ui?.expanded);
    }

    setDifficultyAuthoringExpanded(expanded) {
        if (!this.difficultyAuthoring?.ui) {
            this.difficultyAuthoring.ui = { expanded: false };
        }
        this.difficultyAuthoring.ui.expanded = Boolean(expanded);
        this.renderDifficultyAuthoringControls();
    }

    toggleDifficultyAuthoringExpanded(forceExpanded) {
        const nextExpanded = typeof forceExpanded === 'boolean'
            ? forceExpanded
            : !this.isDifficultyAuthoringExpanded();
        this.setDifficultyAuthoringExpanded(nextExpanded);
    }

    getDifficultyAuthoringSummaryText(meta = this.difficultyAuthoring.activeMeta) {
        const supportedLevels = this._normalizeDifficultyLevels(meta?.supported_levels || []);
        const { mode, selectedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        if (mode !== 'custom') {
            return supportedLevels.length ? wt('editor_base.lbl_all_levels_of_type', 'Все уровни типа') : wt('editor_base.lbl_by_default', 'По умолчанию');
        }
        if (!selectedLevels.length) {
            return wt('editor_base.lbl_need_to_select_levels', 'Нужно выбрать уровни');
        }
        return selectedLevels.map((level) => `L${level}`).join(', ');
    }

    notifyBlockingDraftSaved(blockingState = this.getBlockingEditorState()) {
        if (!blockingState) {
            this.validationFeedbackState.lastBlockingToastKey = '';
            return;
        }

        const key = String(blockingState.code || 'blocking');
        if (this.validationFeedbackState.lastBlockingToastKey === key) {
            return;
        }

        this.validationFeedbackState.lastBlockingToastKey = key;
        this.showToast(
            blockingState.draftDetail || blockingState.detail || wt('editor_base.lbl_draft_needs_editing', 'Черновик требует правки.'),
            'warning',
            5200
        );
    }

    ensureDifficultyAuthoringContainer() {
        const mountPoint = this.getDifficultyAuthoringMountPoint();
        if (!mountPoint) return null;

        const containerId = this.getDifficultyAuthoringContainerId();
        let container = document.getElementById(containerId);
        if (!container) {
            container = document.createElement('section');
            container.id = containerId;
        }
        container.setAttribute('data-onboarding-target', 'editor-difficulty-authoring');
        container.setAttribute('data-onboarding-spotlight', 'frame');

        if (container.parentElement !== mountPoint) {
            if (this.getDifficultyAuthoringInsertMode() === 'append') {
                mountPoint.append(container);
            } else {
                mountPoint.prepend(container);
            }
        }

        return container;
    }

    removeDifficultyAuthoringContainer() {
        const container = document.getElementById(this.getDifficultyAuthoringContainerId());
        if (container) container.remove();
    }

    setDifficultyAuthoringMode(mode) {
        const meta = this.difficultyAuthoring.activeMeta;
        const supportedLevels = this._normalizeDifficultyLevels(meta?.supported_levels || []);
        const state = this.difficultyAuthoring.state;
        if (!meta?.authoring_enabled || supportedLevels.length <= 1) return;

        state.mode = mode === 'custom' ? 'custom' : 'all';
        if (state.mode === 'custom') {
            const nextLevels = this._normalizeDifficultyLevels(state.lastCustomSelectedLevels || [])
                .filter((level) => supportedLevels.includes(level));
            state.selectedLevels = nextLevels.length ? nextLevels : [supportedLevels[0]];
            state.lastCustomSelectedLevels = [...state.selectedLevels];
        } else {
            state.selectedLevels = [...supportedLevels];
        }

        if (state.mode === 'custom') {
            this.difficultyAuthoring.ui.expanded = true;
        }

        this.applyDifficultyAuthoringStateToTaskData();
        this.renderDifficultyAuthoringControls();
        this.markUnsaved();
    }

    toggleDifficultyAuthoringLevel(level, checked) {
        const meta = this.difficultyAuthoring.activeMeta;
        const supportedLevels = this._normalizeDifficultyLevels(meta?.supported_levels || []);
        const state = this.difficultyAuthoring.state;
        const numericLevel = Number.parseInt(level, 10);
        if (!meta?.authoring_enabled || !supportedLevels.includes(numericLevel)) return;

        const next = new Set(this._normalizeDifficultyLevels(state.selectedLevels || []));
        if (checked) next.add(numericLevel);
        else next.delete(numericLevel);

        state.mode = 'custom';
        state.selectedLevels = [...next].sort((a, b) => a - b);
        state.lastCustomSelectedLevels = [...state.selectedLevels];
        this.difficultyAuthoring.ui.expanded = true;

        this.applyDifficultyAuthoringStateToTaskData();
        this.renderDifficultyAuthoringControls();
        this.markUnsaved();
    }

    getDifficultyAuthoringUiCopy() {
        return {
            title: wt('editor_base.difficulty.title', 'Доступные уровни сложности'),
            intro: wt('editor_base.difficulty.intro', 'В стандартном комплексе 3 итерации. Выберите, на каких из них появится это Click-задание.'),
            allTitle: wt('editor_base.difficulty.all_title', 'Все уровни типа'),
            allDescription: wt('editor_base.difficulty.all_description', 'Показывать задание на всех 3 итерациях Click.'),
            customTitle: wt('editor_base.difficulty.custom_title', 'Только выбранные уровни'),
            customDescription: wt('editor_base.difficulty.custom_description', 'Показывать задание только на выбранных итерациях.'),
            warning: wt('editor_base.difficulty.warning', 'Нужно оставить хотя бы один уровень, иначе задание нельзя будет сохранить.'),
        };
    }

    getDifficultyAuthoringLevelDescription(level, meta = this.difficultyAuthoring.activeMeta) {
        const normalizedLevel = Number.parseInt(level, 10);
        if (!Number.isFinite(normalizedLevel)) return '';

        const taskType = this._getDifficultyAuthoringTaskType(this.task?.task_data);
        const subtype = this._getDifficultyAuthoringSubtype(this.task?.task_data);
        const descriptions = {
            test: {
                1: wt('editor_base.difficulty.test.1', 'Пользователь выбирает правильный вариант из готовых ответов.'),
                2: wt('editor_base.difficulty.test.2', 'Пользователь сам вводит короткий текстовый ответ.'),
            },
            click: {
                default: {
                    1: wt('editor_base.difficulty.click.1', 'Итерация 1: пользователь видит изображение и нажимает нужную область. Это проверка узнавания.'),
                    2: wt('editor_base.difficulty.click.2', 'Итерация 2: пользователь находит область и выбирает её название. Это проверка связи места и термина.'),
                    3: wt('editor_base.difficulty.click.3', 'Итерация 3: пользователь сам обводит область и вводит название. Это самостоятельная разметка.'),
                },
            },
            draw: {
                1: wt('editor_base.difficulty.draw.1', 'Итерация 1: пользователь обводит нужную область. Это проверка формы и границ.'),
                2: wt('editor_base.difficulty.draw.2', 'Итерация 2: пользователь обводит область и подписывает её. Это проверка формы и названия.'),
            },
            sequence: {
                1: wt('editor_base.difficulty.sequence.1', 'Пользователь раскладывает элементы по уровням или группам.'),
                2: wt('editor_base.difficulty.sequence.2', 'Пользователь раскладывает элементы и подписывает уровни.'),
                3: wt('editor_base.difficulty.sequence.3', 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.'),
            },
            sequence_assembly: {
                1: wt('editor_base.difficulty.sequence.1', 'Пользователь раскладывает элементы по уровням или группам.'),
                2: wt('editor_base.difficulty.sequence.2', 'Пользователь раскладывает элементы и подписывает уровни.'),
                3: wt('editor_base.difficulty.sequence.3', 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.'),
            },
        };

        let taskDescriptions = descriptions[taskType];
        if (taskType === 'click') {
            taskDescriptions = taskDescriptions?.[subtype] || taskDescriptions?.default || null;
        }
        const directDescription = taskDescriptions?.[normalizedLevel];
        if (directDescription) return directDescription;

        const roleMap = Array.isArray(meta?.level_role_map) ? meta.level_role_map : [];
        const roleEntry = roleMap.find((item) => Number.parseInt(item?.level, 10) === normalizedLevel);
        const fallbackRole = String(roleEntry?.role || '').trim();
        if (fallbackRole) return fallbackRole;

        return wt('editor_base.difficulty.fallback', 'Что делает пользователь на уровне {level}').replace('{level}', normalizedLevel);
    }

    applyDifficultyAuthoringUiCopy(container, meta = this.difficultyAuthoring.activeMeta) {
        if (!container) return;
        const copy = this.getDifficultyAuthoringUiCopy();

        const headerTitle = container.querySelector('h3');
        if (headerTitle) headerTitle.textContent = copy.title;

        const intro = container.querySelector('.space-y-1 p');
        if (intro) intro.textContent = copy.intro;

        const allModeInput = container.querySelector('input[name="difficulty-authoring-mode"][value="all"]');
        const allModeLabel = allModeInput?.closest('label') || null;
        if (allModeLabel) {
            const textBlocks = allModeLabel.querySelectorAll('span.block');
            if (textBlocks[0]) textBlocks[0].textContent = copy.allTitle;
            if (textBlocks[1]) textBlocks[1].textContent = copy.allDescription;
        }

        const customModeInput = container.querySelector('input[name="difficulty-authoring-mode"][value="custom"]');
        const customModeLabel = customModeInput?.closest('label') || null;
        if (customModeLabel) {
            const textBlocks = customModeLabel.querySelectorAll('span.block');
            if (textBlocks[0]) textBlocks[0].textContent = copy.customTitle;
            if (textBlocks[1]) textBlocks[1].textContent = copy.customDescription;
        }

        container.querySelectorAll('[data-difficulty-level]').forEach((input) => {
            const level = Number.parseInt(input.dataset.difficultyLevel, 10);
            const label = input.closest('label');
            if (!label || !Number.isFinite(level)) return;

            const title = label.querySelector('span.text-sm.font-semibold.text-text-main');
            if (title) {
                title.textContent = wt('editor_base.difficulty.level_title', 'Уровень {level}').replace('{level}', level);
            }

            const description = label.querySelector('span.block.mt-1.text-xs.text-text-secondary.leading-relaxed');
            if (description) {
                description.textContent = this.getDifficultyAuthoringLevelDescription(level, meta);
            }
        });

        const warning = container.querySelector('.text-warning-text');
        if (warning) warning.textContent = copy.warning;
    }

    renderDifficultyAuthoringControls() {
        const meta = this.difficultyAuthoring.activeMeta;
        const container = this.ensureDifficultyAuthoringContainer();
        if (!container || !meta) return;

        const supportedLevels = this._normalizeDifficultyLevels(meta.supported_levels || []);
        if (!meta.authoring_enabled || supportedLevels.length <= 1) {
            this.removeDifficultyAuthoringContainer();
            return;
        }

        const state = this.difficultyAuthoring.state;
        const roles = new Map(
            (Array.isArray(meta.level_role_map) ? meta.level_role_map : [])
                .map((item) => [Number.parseInt(item?.level, 10), String(item?.role || '').trim()])
                .filter(([level]) => Number.isFinite(level))
        );
        const customMode = state.mode === 'custom';
        const selectedLevels = this._normalizeDifficultyLevels(
            customMode ? state.selectedLevels : supportedLevels
        );
        const layoutVariant = this.getDifficultyAuthoringLayoutVariant();
        const copy = this.getDifficultyAuthoringUiCopy();
        const blockingState = this.getDifficultyAuthoringBlockingState();

        if (layoutVariant === 'sidebar-compact') {
            const isExpanded = this.isDifficultyAuthoringExpanded(blockingState);
            const summaryText = this.escapeHtml(this.getDifficultyAuthoringSummaryText(meta));
            container.className = `difficulty-authoring space-y-3 ${isExpanded ? 'is-expanded' : ''}`;
            container.innerHTML = `
                <section class="space-y-2">
                    <button type="button" class="difficulty-authoring__toggle" data-difficulty-toggle aria-expanded="${isExpanded ? 'true' : 'false'}">
                        <span class="difficulty-authoring__toggle-copy">
                            <span class="difficulty-authoring__toggle-title">
                                <span class="material-symbols-outlined text-[18px] text-text-disabled">stairs</span>
                                <span>${this.escapeHtml(copy.title)}</span>
                            </span>
                            <span class="difficulty-authoring__toggle-summary">${summaryText}</span>
                        </span>
                        <span class="difficulty-authoring__toggle-icon material-symbols-outlined text-[18px]">expand_more</span>
                    </button>
                </section>
                <div class="difficulty-authoring__panel ${isExpanded ? '' : 'hidden'}">
                    <p class="text-[11px] leading-relaxed text-text-secondary">
                        ${this.escapeHtml(copy.intro)}
                    </p>
                    <div class="space-y-2">
                        <label class="difficulty-authoring__mode-card flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2.5 cursor-pointer">
                            <input type="radio" name="difficulty-authoring-mode" value="all" ${customMode ? '' : 'checked'} class="mt-1 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                            <span class="min-w-0">
                                <span class="block text-sm font-semibold text-text-main">${this.escapeHtml(copy.allTitle)}</span>
                                <span class="block mt-0.5 text-[11px] leading-snug text-text-secondary">${this.escapeHtml(copy.allDescription)}</span>
                            </span>
                        </label>
                        <label class="difficulty-authoring__mode-card flex items-start gap-2 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2.5 cursor-pointer">
                            <input type="radio" name="difficulty-authoring-mode" value="custom" ${customMode ? 'checked' : ''} class="mt-1 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                            <span class="min-w-0">
                                <span class="block text-sm font-semibold text-text-main">${this.escapeHtml(copy.customTitle)}</span>
                                <span class="block mt-0.5 text-[11px] leading-snug text-text-secondary">${this.escapeHtml(copy.customDescription)}</span>
                            </span>
                        </label>
                    </div>
                    <div class="space-y-2">
                        ${supportedLevels.map((level) => {
                            const checked = selectedLevels.includes(level);
                            return `
                                <label class="difficulty-authoring__level-card flex items-start gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-3 ${customMode ? 'cursor-pointer' : 'opacity-70'}">
                                    <input type="checkbox" data-difficulty-level="${level}" ${checked ? 'checked' : ''} ${customMode ? '' : 'disabled'} class="mt-1 h-4 w-4 rounded border-border-subtle text-primary focus:ring-primary">
                                    <span class="min-w-0">
                                        <span class="flex items-center gap-2">
                                            <span class="difficulty-authoring__level-pill inline-flex items-center rounded-full bg-primary-lighter px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">L${level}</span>
                                            <span class="text-sm font-semibold text-text-main">${wt('editor_base.difficulty.level_title', 'Уровень {level}').replace('{level}', level)}</span>
                                        </span>
                                        <span class="block mt-1 text-[11px] leading-relaxed text-text-secondary">${this.escapeHtml(this.getDifficultyAuthoringLevelDescription(level, meta) || (roles.get(level) || wt('editor_base.difficulty.level_title', 'Уровень {level}').replace('{level}', level)))}</span>
                                    </span>
                                </label>
                            `;
                        }).join('')}
                    </div>
                    ${customMode && !selectedLevels.length ? `
                        <div class="difficulty-authoring__warning rounded-lg border border-warning-light bg-warning-lighter px-3 py-2 text-[11px] leading-relaxed text-warning-text">
                            ${this.escapeHtml(copy.warning)}
                        </div>
                    ` : ''}
                </div>
            `;

            const toggleBtn = container.querySelector('[data-difficulty-toggle]');
            if (toggleBtn) {
                toggleBtn.addEventListener('click', () => {
                    this.toggleDifficultyAuthoringExpanded(!isExpanded);
                });
            }

            container.querySelectorAll('input[name="difficulty-authoring-mode"]').forEach((input) => {
                input.addEventListener('change', (event) => {
                    this.setDifficultyAuthoringMode(event.target.value);
                });
            });

            container.querySelectorAll('[data-difficulty-level]').forEach((input) => {
                input.addEventListener('change', (event) => {
                    this.toggleDifficultyAuthoringLevel(event.target.dataset.difficultyLevel, event.target.checked);
                });
            });

            this.updateDifficultyAuthoringBlockingUi();
            return;
        }

        container.className = 'difficulty-authoring rounded-2xl border border-border-subtle bg-surface-2 p-4 shadow-sm space-y-4';
        container.innerHTML = `
            <div class="space-y-1">
                <div class="flex items-center gap-2">
                    <span class="material-symbols-outlined text-[18px] text-text-disabled">stairs</span>
                    <h3 class="text-sm font-bold text-text-main">${wt('editor_base.difficulty.title_short', 'Уровни сложности')}</h3>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">
                    ${wt('editor_base.difficulty.subtitle', 'Определите, какие уровни будут доступны именно в этом задании.')}
                </p>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="difficulty-authoring__mode-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 cursor-pointer">
                    <input type="radio" name="difficulty-authoring-mode" value="all" ${customMode ? '' : 'checked'} class="mt-0.5 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold text-text-main">${wt('editor_base.difficulty.all_supported', 'Все поддерживаемые уровни')}</span>
                        <span class="block mt-1 text-xs text-text-secondary">${wt('editor_base.difficulty.all_supported_desc', 'Пользователь проходит полную лестницу этого типа задания.')}</span>
                    </span>
                </label>
                <label class="difficulty-authoring__mode-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 cursor-pointer">
                    <input type="radio" name="difficulty-authoring-mode" value="custom" ${customMode ? 'checked' : ''} class="mt-0.5 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold text-text-main">${wt('editor_base.difficulty.select_specific', 'Выбрать конкретные уровни')}</span>
                        <span class="block mt-1 text-xs text-text-secondary">${wt('editor_base.difficulty.select_specific_desc', 'Оставьте только те шаги сложности, которые подходят этой формулировке.')}</span>
                    </span>
                </label>
            </div>
            <div class="space-y-2">
                ${supportedLevels.map((level) => {
                    const checked = selectedLevels.includes(level);
                    const role = roles.get(level) || wt('editor_base.difficulty.level_title', 'Уровень {level}').replace('{level}', level);
                    return `
                        <label class="difficulty-authoring__level-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 ${customMode ? 'cursor-pointer' : 'opacity-70'}">
                            <input type="checkbox" data-difficulty-level="${level}" ${checked ? 'checked' : ''} ${customMode ? '' : 'disabled'} class="mt-0.5 h-4 w-4 rounded border-border-subtle text-primary focus:ring-primary">
                            <span class="min-w-0">
                                <span class="inline-flex items-center gap-2">
                                    <span class="difficulty-authoring__level-pill inline-flex items-center rounded-full bg-primary-lighter px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">L${level}</span>
                                    <span class="text-sm font-semibold text-text-main">${wt('editor_base.difficulty.level_title', 'Уровень {level}').replace('{level}', level)}</span>
                                </span>
                                <span class="block mt-1 text-xs text-text-secondary leading-relaxed">${this.escapeHtml(role)}</span>
                            </span>
                        </label>
                    `;
                }).join('')}
            </div>
            ${customMode && !selectedLevels.length ? `
                <div class="difficulty-authoring__warning rounded-xl border border-warning-light bg-warning-lighter px-3 py-2 text-xs text-warning-text">
                    ${wt('editor_base.difficulty.warning', 'Нужно оставить хотя бы один уровень, иначе задание нельзя будет сохранить.')}
                </div>
            ` : ''}
        `;

        container.querySelectorAll('input[name="difficulty-authoring-mode"]').forEach((input) => {
            input.addEventListener('change', (event) => {
                this.setDifficultyAuthoringMode(event.target.value);
            });
        });

        container.querySelectorAll('[data-difficulty-level]').forEach((input) => {
            input.addEventListener('change', (event) => {
                this.toggleDifficultyAuthoringLevel(event.target.dataset.difficultyLevel, event.target.checked);
            });
        });

        this.applyDifficultyAuthoringUiCopy(container, meta);
        this.updateDifficultyAuthoringBlockingUi();
    }

    async refreshDifficultyAuthoringControls(options = {}) {
        const mountPoint = this.getDifficultyAuthoringMountPoint();
        if (!mountPoint) {
            this.removeDifficultyAuthoringContainer();
            return false;
        }

        let meta = null;
        try {
            meta = await this.loadDifficultyAuthoringMeta(this.task?.task_data, options);
        } catch (error) {
            console.warn('[BaseEditor] failed to load difficulty authoring meta', error);
            this.removeDifficultyAuthoringContainer();
            return false;
        }

        this.syncDifficultyAuthoringStateFromTask(this.task?.task_data, meta);
        this.applyDifficultyAuthoringStateToTaskData(this.task?.task_data, meta);
        this.renderDifficultyAuthoringControls();
        return true;
    }

    // ===== SAVING =====

    /**
     * Save task to backend
     * Child classes should implement validateTask() and buildTaskData()
     */
    async saveTask() {
        this.updateSaveStatus({ type: 'saving' });

        if (!this.task) {
            this.showToast(wt('editor_base.toast_task_not_loaded', 'Задание не загружено'), 'error');
            return;
        }

        // Validate (implemented by child class)
        const validationError = this.validateTask();
        if (validationError) {
            this.showToast(validationError, 'warning');
            return;
        }

        // Build task data (implemented by child class)
        const taskData = this.buildTaskData();
        if (taskData && typeof taskData === 'object') {
            const meta = (taskData.meta && typeof taskData.meta === 'object') ? taskData.meta : {};
            taskData.meta = meta;
            taskData.id = this.taskId;
            meta.id = this.taskId;
            meta.module = this.moduleId;
            meta.topic = this.topicId;
            meta.name = this.taskNameParam || this.task?.metadata?.name || this.task?.task_data?.meta?.name || this.taskId;
            taskData.name = meta.name;
            if (!taskData.type) {
                taskData.type = this.taskTypeParam || this.task?.task_data?.type || '';
            }
        }

        const difficultySettingsOk = await this.applyDifficultyAuthoringSettings(taskData, { showValidationToast: true });
        if (!difficultySettingsOk) {
            const blockingState = this.getBlockingEditorState(taskData);
            if (blockingState) {
                this.updateSaveStatus(this.getBlockingSaveStatusOptions(blockingState));
            } else {
                this.updateSaveStatus();
            }
            return;
        }

        try {
            const payload = this._cloneSerializable(taskData);
            this.sanitizeDifficultyAuthoringPayload(payload, this.difficultyAuthoring.activeMeta);
            const response = await fetch(
                `/api/editor/task/${this.moduleId}/${this.topicId}/${this.taskId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }
            );

            const result = await response.json();

            if (response.status === 409 && result?.error === 'workspace_limit_reached') {
                this.updateSaveStatus({
                    type: 'warning',
                    message: wt('editor_base.status.limit_reached_title', 'Лимит заданий достигнут'),
                    detail: wt('editor_base.status.limit_reached_detail', 'Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.'),
                });
                this.showToast(wt('editor_base.toast_limit_reached', 'Лимит заданий достигнут. Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.'), 'warning');
            } else if (result.ok) {
                const semanticWarnings = this.getSemanticWarnings();
                if (!semanticWarnings.length) {
                    this.showToast(wt('editor_base.toast_task_saved', 'Задание сохранено'), 'success');
                }
                this.hasPersistedTask = true;
                this.isNewTaskParam = false;
                this.markSaved();
                this.refreshTheoryGroundingCoverage().catch(() => {});
                this.renderTheoryGroundingPanel();

                // Clear draft after successful save
                if (this.autoSaveManager) {
                    this.autoSaveManager.clearDraft();
                }
                this.clearTaskBootstrap();
                this.cleanupPersistedTaskRoute();

                this.onTaskSaved(); // Hook for child classes
                if (semanticWarnings.length) {
                    this.updateSaveStatus({
                        type: 'warning',
                        message: wt('editor_base.status.saved_with_warnings', 'Сохранено с предупреждениями'),
                        detail: this.buildSemanticWarningsDetail(semanticWarnings)
                    });
                    this.showToast(this.buildSemanticWarningsToast(semanticWarnings), 'warning', 5200);
                }
            } else {
                this.showToast(result.error || wt('editor_base.toast_save_error', 'Ошибка сохранения'), 'error');
            }
        } catch (error) {
            console.error("Error saving task:", error);
            this.showToast(wt('editor_base.toast_network_error', 'Ошибка сети:') + ' ' + error.message, 'error');
        }
    }

    // ===== UNSAVED CHANGES TRACKING =====

    /**
     * Mark task as having unsaved changes
     */
    markUnsaved() {
        this.hasUnsavedChanges = true;
        this.updateSaveStatus();
    }

    /**
     * Mark task as saved
     */
    markSaved() {
        this.hasUnsavedChanges = false;
        this.updateSaveStatus();
    }

    /**
     * Update save status indicator in UI
     * Handles multiple states: saving, saved, dirty, draft, error, warning
     * @param {Object} options - Status options { type, message, detail }
     */
    updateSaveStatus(options = {}) {
        const normalizedOptions = (options && typeof options === 'object') ? options : {};
        const blockingState = normalizedOptions.ignoreBlockingState ? null : this.getBlockingEditorState();
        const type = normalizedOptions.type || (blockingState ? 'blocking' : (this.hasUnsavedChanges ? 'dirty' : 'saved'));
        const container = document.getElementById('save-status-container') || document.getElementById('save-status');
        const dot = document.getElementById('save-status-indicator') || (container ? container.querySelector('.w-2.h-2') : null);
        const text = document.getElementById('save-status-text') || (container ? container.querySelector('[data-save-status-text]') : null);
        const detail = document.getElementById('save-status-detail');
        const resolvedOptions = (type === 'blocking' && blockingState)
            ? { ...this.getBlockingSaveStatusOptions(blockingState), ...normalizedOptions, type }
            : normalizedOptions;

        if (!blockingState) {
            this.validationFeedbackState.lastBlockingToastKey = '';
        }

        if (!container || !dot || !text) {
            // Fallback for older layouts or if elements not found
            const legacyIndicator = document.querySelector('.save-status');            if (legacyIndicator && !container) {
                if (type === 'blocking') {
                    legacyIndicator.textContent = resolvedOptions.message || wt('editor_base.status.needs_editing', '! Требуется правка');
                    legacyIndicator.className = 'save-status unsaved text-xs font-bold text-error-dark';
                } else if (this.hasUnsavedChanges) {
                    legacyIndicator.textContent = wt('editor_base.status.unsaved', 'Не сохранено');
                    legacyIndicator.className = 'save-status unsaved text-xs font-bold text-warning-dark';
                } else {
                    legacyIndicator.textContent = wt('editor_base.status.saved', 'Сохранено');
                    legacyIndicator.className = 'save-status saved text-xs font-bold text-success-dark';
                }
            }
            return;
        }

        container.classList.add('status-cluster');
        container.dataset.tone = this.getSaveStatusTone(type);
        container.dataset.busy = type === 'saving' || type === 'blocking' ? 'true' : 'false';
        this.updateDifficultyAuthoringBlockingUi(blockingState);

        dot.classList.add('status-cluster__dot');
        text.classList.add('status-cluster__label');
        if (detail) detail.classList.add('status-cluster__detail');

        text.textContent = this.getSaveStatusMessage(type, resolvedOptions);

        if (detail) {
            const detailText = this.getSaveStatusDetail(type, resolvedOptions);
            detail.textContent = detailText;
            detail.classList.toggle('hidden', !detailText);
        }

        if (false) switch (type) {
            case 'saving':
                dot.classList.add('bg-info', 'animate-pulse');
                text.textContent = options.message || 'Сохранение...';
                text.className = 'text-[11px] font-bold text-info-dark leading-none';
                if (detail) detail.classList.add('hidden');
                break;
            case 'dirty':
                dot.classList.add('bg-warning');
                text.textContent = options.message || 'Изменения не сохранены';
                text.className = 'text-[11px] font-bold text-warning-dark leading-none';
                if (detail) detail.classList.add('hidden');
                break;
            case 'saved':
                dot.classList.add('bg-success');
                text.textContent = options.message || 'Сохранено';
                text.className = 'text-[11px] font-bold text-success-dark leading-none';
                if (detail) detail.classList.add('hidden');
                break;
            case 'draft':
                dot.classList.add('bg-success');
                text.textContent = options.message || 'Черновик сохранён';
                text.className = 'text-[11px] font-bold text-success-dark leading-none';
                if (detail && options.time) {
                    detail.textContent = `Локально: ${options.time}`;
                    detail.classList.remove('hidden');
                }
                break;
            case 'error':
                dot.classList.add('bg-error');
                text.textContent = options.message || 'Ошибка сохранения';
                text.className = 'text-[11px] font-bold text-error-dark leading-none';
                if (detail) detail.classList.add('hidden');
                break;
            case 'blocking':
                dot.classList.add('bg-error', 'animate-pulse');
                text.textContent = options.message || 'Действие заблокировано';
                text.className = 'text-[11px] font-bold text-error-dark leading-none';
                if (detail && options.detail) {
                    detail.textContent = options.detail;
                    detail.classList.remove('hidden');
                } else if (detail) {
                    detail.classList.add('hidden');
                }
                break;
            case 'warning':
                dot.classList.add('bg-warning');
                text.textContent = options.message || 'Сохранено с предупреждениями';
                text.className = 'text-[11px] font-bold text-warning-dark leading-none';
                if (detail && options.detail) {
                    detail.textContent = options.detail;
                    detail.classList.remove('hidden');
                } else if (detail) {
                    detail.classList.add('hidden');
                }
                break;
        }
    }

    getSaveStatusTone(type = 'saved') {
        const toneMap = {
            saving: 'info',
            dirty: 'warning',
            saved: 'success',
            draft: 'success',
            error: 'error',
            blocking: 'error',
            warning: 'warning',
        };
        return toneMap[type] || 'muted';
    }

    getSaveStatusMessage(type = 'saved', options = {}) {
        if (options.message) {
            return options.message;
        }
        const messageMap = {
            saving: wt('editor_base.status.saving', 'Сохранение...'),
            dirty: wt('editor_base.status.unsaved_changes', 'Изменения не сохранены'),
            saved: wt('editor_base.status.saved', 'Сохранено'),
            draft: wt('editor_base.status.draft_saved', 'Черновик сохранён'),
            error: wt('editor_base.status.save_error', 'Ошибка сохранения'),
            blocking: wt('editor_base.status.action_blocked', 'Действие заблокировано'),
            warning: wt('editor_base.status.saved_with_warnings', 'Сохранено с предупреждениями'),
        };
        return messageMap[type] || wt('editor_base.status.state_updated', 'Состояние обновлено');
    }

    getSaveStatusDetail(type = 'saved', options = {}) {
        if (type === 'draft' && options.time) {
            return wt('editor_base.status.local_time', 'Локально: {time}').replace('{time}', options.time);
        }
        if ((type === 'warning' || type === 'blocking') && options.detail) {
            return options.detail;
        }
        return '';
    }

    // ===== UI NOTIFICATIONS =====

    normalizeFeedbackVariant(variant = 'info') {
        const key = String(variant || '').trim().toLowerCase();
        if (key === 'success' || key === 'warning' || key === 'error' || key === 'info') {
            return key;
        }
        if (key === 'blocking') {
            return 'error';
        }
        return 'info';
    }

    composeFeedbackMessage({ what = '', impact = '', next = '' } = {}) {
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.voiceMessage === 'function') {
            return NotificationUI.voiceMessage({ what, impact, next });
        }
        return [what, impact, next].filter(Boolean).join(' ');
    }

    showVoiceToast({ severity = 'info', what = '', impact = '', next = '', timeout = 4200 } = {}) {
        const message = this.composeFeedbackMessage({ what, impact, next });
        if (!message) return;
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toastVoice === 'function') {
            NotificationUI.toastVoice({ what, impact, next, severity, timeout });
            return;
        }
        this.showToast(message, severity, timeout);
    }

    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} variant - Variant: 'success', 'error', 'warning', 'info'
     * @param {number} timeout - Timeout in milliseconds (default: 4000)
     */
    showToast(message, variant = 'info', timeout = 4000) {
        const normalized = this.normalizeFeedbackVariant(variant);
        if (typeof NotificationUI !== 'undefined' && typeof NotificationUI.toast === 'function') {
            NotificationUI.toast(message, normalized, timeout);
            return;
        }

        const toast = document.createElement('div');
        toast.className = `toast toast-${normalized}`;
        toast.textContent = message;

        // Add to body
        document.body.appendChild(toast);

        // Trigger animation
        setTimeout(() => toast.classList.add('show'), 10);

        // Remove after timeout
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, timeout);
    }

    getSemanticWarnings() {
        return [];
    }

    buildSemanticWarningsToast(warnings = []) {
        if (!Array.isArray(warnings) || !warnings.length) {
            return wt('editor_base.warning.saved_success', 'Сохранено.');
        }
        const first = String(warnings[0] || '').trim();
        if (warnings.length === 1) {
            return wt('editor_base.warning.saved_with_single_warning', 'Сохранено, но проверьте: {warning}').replace('{warning}', first);
        }
        const count = warnings.length;
        return wt('editor_base.warning.saved_with_multiple_warnings', 'Сохранено, но есть {count} замечания. Сначала проверьте: {warning}').replace('{count}', count).replace('{warning}', first);
    }

    buildSemanticWarningsDetail(warnings = []) {
        if (!Array.isArray(warnings) || !warnings.length) {
            return '';
        }
        const first = String(warnings[0] || '').trim();
        if (warnings.length === 1) {
            return first;
        }
        const count = warnings.length;
        return wt('editor_base.warning.multiple_warnings_detail', '{count} замечания. Первое: {warning}').replace('{count}', count).replace('{warning}', first);
    }

    /**
     * Toggle loading overlay
     * @param {boolean} show - Show or hide loading
     * @param {string} message - Loading message
     */
    toggleLoading(show, message = wt('editor_base.lbl_loading', 'Загрузка...')) {
        let overlay = document.getElementById('loading-overlay');

        if (show) {
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'loading-overlay';
                overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-6 animate-fade-in';
                overlay.style.background = 'rgba(15, 23, 42, 0.22)';
                overlay.style.backdropFilter = 'blur(6px)';
                const safeMessage = this.escapeHtml(message);
                overlay.innerHTML = `
                    <div class="card-elevated empty-state-card empty-state-card--compact w-full max-w-sm">
                        <div class="spinner h-10 w-10 border-[3px]"></div>
                        <div class="empty-state-card__title loading-message">${safeMessage}</div>
                    </div>
                `;
                document.body.appendChild(overlay);
            } else {
                const messageNode = overlay.querySelector('.loading-message')
                    || overlay.querySelector('#loading-text')
                    || overlay.querySelector('[data-loading-message]')
                    || overlay.querySelector('p');
                if (messageNode) {
                    messageNode.textContent = message;
                }
                overlay.classList.remove('hidden');
                overlay.style.display = 'flex';
            }
        } else {
            if (overlay) {
                overlay.classList.add('hidden');
                overlay.style.display = 'none';
            }
        }
    }

    /**
     * Execute callback with loading indicator
     * @param {string} message - Loading message
     * @param {Function} callback - Async callback to execute
     */
    async withLoading(message, callback) {
        this.toggleLoading(true, message);
        try {
            await callback();
        } finally {
            this.toggleLoading(false);
        }
    }

    /**
     * Show fatal error with navigation options
     * @param {string} message - Error message
     */
    showFatalError(message) {
        this.toggleLoading(false); // Ensure loading is hidden
        const safeMessage = this.escapeHtml(message);

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-50 flex flex-col items-center justify-center p-6 text-center animate-fade-in';
        overlay.style.background = 'rgba(15, 23, 42, 0.34)';
        overlay.style.backdropFilter = 'blur(10px)';
        overlay.innerHTML = `
            <div class="card-elevated empty-state-card w-full max-w-md p-8">
                <span class="empty-state-card__icon h-16 w-16 border border-error-light bg-error-lighter text-error-text"><span class="material-symbols-outlined text-4xl">error</span></span>
                <h3 class="text-xl font-bold text-text-main mb-2">${wt('editor_base.error_load_title', 'Ошибка загрузки')}</h3>
                <p class="text-text-secondary mb-6">${safeMessage}</p>
                <button id="fatal-error-back-btn" class="btn-secondary inline-flex w-full items-center justify-center gap-2">
                    <span class="material-symbols-outlined">arrow_back</span>
                    ${wt('editor_base.btn_back_to_menu', 'Вернуться в меню')}
                </button>
            </div>
        `;
        document.body.appendChild(overlay);
        const backBtn = overlay.querySelector('#fatal-error-back-btn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                if (typeof window.navigateWithTransition === 'function') {
                    window.navigateWithTransition('/editor');
                    return;
                }
                window.location.href = '/editor';
            });
        }
    }

    /**
     * Show custom confirmation modal
     * Designed to match showFatalError style
     * @param {Object} options - Configuration object
     */
    showConfirmModal({ title, message, confirmText, cancelText, onConfirm, onCancel, variant = 'primary' }) {
        this.toggleLoading(false);

        const overlay = document.createElement('div');
        overlay.id = 'custom-confirm-modal';
        // Reuse exact backdrop style from showFatalError
        overlay.className = 'fixed inset-0 z-50 bg-bg-main backdrop-blur flex flex-col items-center justify-center p-6 text-center animate-fade-in text-text-main';

        const icon = 'history';
        const colorClass = 'text-primary';
        title = this.escapeHtml(title || wt('editor_base.modal.confirm_title', 'Подтверждение'));
        message = this.escapeHtml(message || wt('editor_base.modal.confirm_message', 'Вы уверены?'));
        confirmText = this.escapeHtml(confirmText || wt('editor_base.modal.confirm_btn', 'Подтвердить'));
        cancelText = this.escapeHtml(cancelText || wt('editor_base.modal.cancel_btn', 'Отмена'));

        overlay.innerHTML = `
            <div class="bg-surface-1 rounded-2xl p-8 max-w-md w-full border border-border-subtle shadow-xl transform transition-all scale-100 animate-slide-up">
                <div class="mb-5 flex justify-center">
                    <span class="material-symbols-outlined text-4xl ${colorClass} p-4 bg-primary-lighter rounded-full">${icon}</span>
                </div>
                <h3 class="text-xl font-bold mb-3 text-text-main">${title || wt('editor_base.modal.confirm_title', 'Подтверждение')}</h3>
                <p class="text-text-secondary mb-8 leading-relaxed">${message || wt('editor_base.modal.confirm_message', 'Вы уверены?')}</p>
                <div class="flex flex-col gap-3">
                    <button id="confirm-modal-btn" class="w-full py-3 px-4 bg-primary text-primary-fg rounded-lg shadow-md font-semibold hover:bg-primary-dark transition-all flex items-center justify-center gap-2 active:scale-[0.98]">
                        ${confirmText || 'Подтвердить'}
                    </button>
                    <button id="cancel-modal-btn" class="w-full py-3 px-4 bg-transparent border border-transparent text-text-secondary rounded-lg font-medium hover:text-text-main hover:bg-surface-2 transition-all">
                        ${cancelText || 'Отмена'}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('#confirm-modal-btn');
        const cancelBtn = overlay.querySelector('#cancel-modal-btn');
        let settled = false;

        const handleCancel = () => {
            if (settled) return;
            cleanup();
            if (onCancel) onCancel();
        };

        const handleConfirm = () => {
            if (settled) return;
            cleanup();
            if (onConfirm) onConfirm();
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                handleCancel();
            }
        };

        const cleanup = () => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', handleKeyDown);
            overlay.classList.add('opacity-0');
            // Allow animation to finish
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 300);
        };

        document.addEventListener('keydown', handleKeyDown);
        const scheduleFocus = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame.bind(window)
            : (callback) => setTimeout(callback, 0);
        scheduleFocus(() => confirmBtn && confirmBtn.focus({ preventScroll: true }));
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                handleCancel();
            }
        });
    }

    isReloadNavigation() {
        try {
            const perf = typeof window !== 'undefined' ? window.performance : null;
            const entries = perf && typeof perf.getEntriesByType === 'function'
                ? perf.getEntriesByType('navigation')
                : [];
            const navigationEntry = Array.isArray(entries) ? entries[0] : null;
            if (navigationEntry && typeof navigationEntry.type === 'string') {
                return navigationEntry.type === 'reload';
            }
            return perf?.navigation?.type === 1;
        } catch (_) {
            return false;
        }
    }

    shouldAutoRestoreDraft(draft) {
        return Boolean(draft?.data) && (this.restoreDraftIntent || this.isReloadNavigation());
    }

    getAutoRestoreDraftToastMessage() {
        return this.restoreDraftIntent
            ? wt('editor_base.draft.opened_unsaved_changes', 'Открыты несохранённые изменения')
            : wt('editor_base.draft.restored_unsaved_changes', 'Восстановлены несохранённые изменения');
    }

    formatDraftTimestamp(value) {
        const timestamp = this.normalizeDraftTimestamp(value);
        if (!timestamp) return '';

        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return '';

        const now = new Date();
        const sameDay = date.toDateString() === now.toDateString();
        return sameDay
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : date.toLocaleString([], {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            });
    }

    normalizeDraftTimestamp(value) {
        if (typeof this.autoSaveManager?.normalizeTimestamp === 'function') {
            return this.autoSaveManager.normalizeTimestamp(value);
        }

        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string' && value.trim()) {
            const asNumber = Number(value);
            if (Number.isFinite(asNumber)) return asNumber;
            const parsed = Date.parse(value);
            if (!Number.isNaN(parsed)) return parsed;
        }

        return 0;
    }

    buildDraftRecoveryCopy(draft, lastSavedTimestamp = null) {
        const draftTime = this.formatDraftTimestamp(draft?.timestamp);
        const savedTime = this.formatDraftTimestamp(lastSavedTimestamp);
        const hasSavedVersion = Boolean(this.normalizeDraftTimestamp(lastSavedTimestamp));

        if (hasSavedVersion) {
            return {
                title: wt('editor_base.draft.recover_title', 'Вернуть несохранённые изменения?'),
                message: draftTime
                    ? wt('editor_base.draft.recover_message_newer_with_time', 'На этом устройстве есть несохранённые изменения этой задачи от {draftTime}. Они новее последней сохранённой версии{savedTime}. Что открыть?').replace('{draftTime}', draftTime).replace('{savedTime}', savedTime ? ` от ${savedTime}` : '')
                    : wt('editor_base.draft.recover_message_newer', 'На этом устройстве есть несохранённые изменения этой задачи. Они новее последней сохранённой версии{savedTime}. Что открыть?').replace('{savedTime}', savedTime ? ` от ${savedTime}` : ''),
                confirmText: wt('editor_base.draft.recover_confirm', 'Вернуть изменения'),
                cancelText: wt('editor_base.draft.recover_cancel', 'Открыть сохранённую версию'),
            };
        }

        return {
            title: wt('editor_base.draft.recover_title', 'Вернуть несохранённые изменения?'),
            message: draftTime
                ? wt('editor_base.draft.recover_message_with_time', 'На этом устройстве есть несохранённые изменения этой задачи от {draftTime}. Вернуть их и продолжить работу?').replace('{draftTime}', draftTime)
                : wt('editor_base.draft.recover_message', 'На этом устройстве есть несохранённые изменения этой задачи. Вернуть их и продолжить работу?'),
            confirmText: wt('editor_base.draft.recover_confirm', 'Вернуть изменения'),
            cancelText: wt('editor_base.draft.recover_cancel_new', 'Не возвращать'),
        };
    }

    showConfirmModal({ title, message, confirmText, cancelText, onConfirm, onCancel, variant = 'primary' }) {
        this.toggleLoading(false);

        const themeByVariant = {
            primary: {
                icon: 'help',
                iconText: 'text-primary',
                iconBg: 'bg-primary-lighter',
                confirmBtn: 'btn-primary',
            },
            info: {
                icon: 'info',
                iconText: 'text-primary',
                iconBg: 'bg-primary-lighter',
                confirmBtn: 'btn-primary',
            },
            warning: {
                icon: 'warning',
                iconText: 'text-warning-dark',
                iconBg: 'bg-warning-lighter',
                confirmBtn: 'btn-primary',
            },
            error: {
                icon: 'delete_forever',
                iconText: 'text-error',
                iconBg: 'bg-error-lighter',
                confirmBtn: 'btn-secondary border-error-light bg-error-lighter text-error-text hover:border-error hover:bg-error-lighter hover:text-error',
            },
        };
        const theme = themeByVariant[variant] || themeByVariant.primary;
        const overlay = document.createElement('div');
        overlay.id = 'custom-confirm-modal';
        overlay.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-in text-text-main';
        overlay.style.background = 'rgba(15, 23, 42, 0.34)';
        overlay.style.backdropFilter = 'blur(10px)';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');

        title = this.escapeHtml(title || wt('editor_base.modal.confirm_title', 'Подтверждение'));
        message = this.escapeHtml(message || wt('editor_base.modal.confirm_message', 'Вы уверены?'));
        confirmText = this.escapeHtml(confirmText || wt('editor_base.modal.confirm_btn', 'Подтвердить'));
        cancelText = this.escapeHtml(cancelText || wt('editor_base.modal.cancel_btn', 'Отмена'));

        overlay.innerHTML = `
            <div class="card-elevated rounded-[24px] p-6 sm:p-7 max-w-lg w-full shadow-2xl transform transition-all scale-100 animate-slide-up" style="background: var(--color-surface-1);">
                <div class="mb-5 flex items-center gap-4 text-left">
                    <span class="material-symbols-outlined text-3xl sm:text-4xl ${theme.iconText} p-3 ${theme.iconBg} rounded-2xl">${theme.icon}</span>
                    <div class="min-w-0">
                        <h3 class="text-lg sm:text-xl font-bold text-text-main">${title || wt('editor_base.modal.confirm_title', 'Подтверждение')}</h3>
                        <p class="mt-1 text-sm leading-relaxed text-text-main opacity-90">${message || 'Вы уверены?'}</p>
                    </div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button id="confirm-modal-btn" class="w-full rounded-xl font-semibold transition-all inline-flex items-center justify-center gap-2 active:scale-[0.98] ${theme.confirmBtn}">
                        ${confirmText || 'Подтвердить'}
                    </button>
                    <button id="cancel-modal-btn" class="w-full rounded-xl font-medium transition-all inline-flex items-center justify-center gap-2 border border-border-strong bg-surface-1 text-text-main hover:bg-surface-2 hover:border-primary">
                        ${cancelText || 'Отмена'}
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('#confirm-modal-btn');
        const cancelBtn = overlay.querySelector('#cancel-modal-btn');
        let settled = false;

        const handleCancel = () => {
            if (settled) return;
            cleanup();
            if (onCancel) onCancel();
        };

        const handleConfirm = () => {
            if (settled) return;
            cleanup();
            if (onConfirm) onConfirm();
        };

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                handleCancel();
            }
        };

        const cleanup = () => {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', handleKeyDown);
            overlay.classList.add('opacity-0');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 300);
        };

        document.addEventListener('keydown', handleKeyDown);
        const scheduleFocus = typeof requestAnimationFrame === 'function'
            ? requestAnimationFrame.bind(window)
            : (callback) => setTimeout(callback, 0);
        scheduleFocus(() => confirmBtn && confirmBtn.focus({ preventScroll: true }));
        confirmBtn.onclick = handleConfirm;
        cancelBtn.onclick = handleCancel;
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                handleCancel();
            }
        });
    }

    // ===== UTILITY METHODS =====

    /**
     * Generate unique ID with prefix
     * @param {string} prefix - ID prefix
     * @returns {string} Unique ID
     */
    generateId(prefix = 'item') {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Auto-resize textarea to fit content
     * @param {HTMLTextAreaElement} textarea - Textarea element
     */
    autoResizeTextarea(textarea) {
        if (!textarea) return;

        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    /**
     * Build image URL from relative path
     * @param {string} path - Relative image path
     * @returns {string} Full image URL
     */
    buildImageUrl(path) {
        if (!path) return '';
        if (path.startsWith('http://') || path.startsWith('https://')) {
            return path;
        }
        return `/api/editor/task/${this.moduleId}/${this.topicId}/${this.taskId}/image/${path}`;
    }

    // ===== P8: THEORY REPORT <-> MANUAL EDITOR LINK (COVERAGE / GROUNDING) =====

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text == null ? '' : String(text);
        return div.innerHTML;
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

    _theoryGroundingContainerId() {
        return 'editor-theory-grounding-p8-panel';
    }

    _theoryGroundingBeaconId() {
        return 'editor-theory-grounding-beacon';
    }

    _theoryGroundingHeaderHost() {
        const header = document.querySelector('header');
        return {
            header: header instanceof HTMLElement ? header : null,
            host: header instanceof HTMLElement ? (header.parentElement || null) : null,
        };
    }

    _hasTheoryGroundingContext(taskMeta = null, bridge = null) {
        const meta = taskMeta || this._getTaskTheoryLinkMeta();
        const bridgeContext = bridge !== null ? bridge : this._readEditorTheoryBridgeContext();
        const bridgeRunId = String(bridgeContext?.ai_run_id || '').trim();
        const selectedRunId = String(this.theoryGrounding?.selectedRunId || '').trim();
        return Boolean(
            bridgeRunId ||
            selectedRunId ||
            String(meta?.aiRunId || '').trim() ||
            (Array.isArray(meta?.unitIds) && meta.unitIds.length) ||
            (Array.isArray(meta?.chunkIds) && meta.chunkIds.length) ||
            meta?.sourceGrounding
        );
    }

    _theoryGroundingSummaryText(taskMeta = null, bridge = null, warnings = []) {
        const meta = taskMeta || this._getTaskTheoryLinkMeta();
        const bridgeContext = bridge !== null ? bridge : this._readEditorTheoryBridgeContext();
        if (bridgeContext?.ai_run_id) {
            return wt('editor_base.theory.has_report_context', 'Есть контекст отчёта');
        }
        if (String(meta?.aiRunId || '').trim() || meta?.sourceGrounding) {
            return wt('editor_base.theory.has_analysis_link', 'Есть привязка к анализу');
        }
        if ((meta?.unitIds?.length || 0) || (meta?.chunkIds?.length || 0)) {
            return wt('editor_base.theory.has_selected_links', 'Есть выбранные привязки');
        }
        if (Array.isArray(warnings) && warnings.length) {
            return wt('editor_base.theory.has_remarks', 'Есть замечания');
        }
        return wt('editor_base.theory.analysis_not_connected', 'Анализ не подключён');
    }

    _theoryGroundingBeaconCopy(taskMeta = null, bridge = null, warnings = []) {
        const meta = taskMeta || this._getTaskTheoryLinkMeta();
        const bridgeContext = bridge !== null ? bridge : this._readEditorTheoryBridgeContext();
        const hasSavedLink = Boolean(
            String(meta?.aiRunId || '').trim() ||
            (Array.isArray(meta?.unitIds) && meta.unitIds.length) ||
            (Array.isArray(meta?.chunkIds) && meta.chunkIds.length) ||
            meta?.sourceGrounding
        );
        const hasBridge = Boolean(String(bridgeContext?.ai_run_id || '').trim());
        const hasWarnings = Array.isArray(warnings) && warnings.length > 0;

        if (hasBridge && !hasSavedLink) {
            return {
                label: wt('editor_base.theory.has_analysis_context', 'Есть контекст анализа'),
                hint: wt('editor_base.theory.analysis_context_hint', 'Для этого редактора найден временный контекст анализа. Его можно посмотреть и при необходимости применить к задаче.'),
            };
        }
        if (hasSavedLink) {
            return {
                label: wt('editor_base.theory.has_analysis_connection', 'Есть связь с анализом'),
                hint: wt('editor_base.theory.analysis_connection_hint', 'У этой задачи уже есть сохранённая связь с анализом теории. Можно открыть детали и проверить привязки.'),
            };
        }
        if (hasWarnings) {
            return {
                label: wt('editor_base.theory.has_analysis_remarks', 'Есть замечания анализа'),
                hint: wt('editor_base.theory.analysis_remarks_hint', 'Для этой задачи есть замечания по связи с анализом. Откройте панель, чтобы посмотреть подробности.'),
            };
        }
        return {
            label: wt('editor_base.theory.analysis_connection', 'Связь с анализом'),
            hint: wt('editor_base.theory.open_panel_hint', 'Открыть панель связи задания с анализом теории.'),
        };
    }

    renderTheoryGroundingBeacon(taskMeta = null, bridge = null, warnings = []) {
        const meta = taskMeta || this._getTaskTheoryLinkMeta();
        const bridgeContext = bridge !== null ? bridge : this._readEditorTheoryBridgeContext();
        let beacon = document.getElementById(this._theoryGroundingBeaconId());

        const saveStatus = document.getElementById('save-status-container');
        const saveButton = document.getElementById('save-task-btn');
        const host = saveStatus?.parentElement || saveButton?.parentElement || document.querySelector('header');
        if (!host || !this._hasTheoryGroundingContext(meta, bridgeContext)) {
            if (beacon) beacon.remove();
            return;
        }

        if (!beacon) {
            beacon = document.createElement('button');
            beacon.type = 'button';
            beacon.id = this._theoryGroundingBeaconId();
        }

        const copy = this._theoryGroundingBeaconCopy(meta, bridgeContext, warnings);
        const isOpen = Boolean(this.theoryGrounding?.panelOpen);
        beacon.className = `flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all shadow-sm ${isOpen
            ? 'border-primary bg-primary-lighter text-primary'
            : 'border-border-subtle bg-surface-1 text-text-secondary hover:text-text-main hover:bg-bg-hover hover:border-primary-light'
            }`;
        beacon.title = copy.hint;
        beacon.setAttribute('aria-label', copy.hint);
        beacon.innerHTML = `
            <span class="material-symbols-outlined text-[18px]">${isOpen ? 'dock_to_right' : 'hub'}</span>
            <span class="hidden xl:inline">${this.escapeHtml(copy.label)}</span>
        `;
        beacon.onclick = () => this.toggleTheoryGroundingPanel(true);

        if (saveButton && saveButton.parentElement === host) {
            host.insertBefore(beacon, saveButton);
        } else if (!host.contains(beacon)) {
            host.appendChild(beacon);
        }
    }

    _ensureTheoryGroundingSets() {
        if (!this.theoryGrounding || typeof this.theoryGrounding !== 'object') {
            this.theoryGrounding = {};
        }
        if (!(this.theoryGrounding.selectedUnitIds instanceof Set)) {
            this.theoryGrounding.selectedUnitIds = new Set();
        }
        if (!(this.theoryGrounding.selectedChunkIds instanceof Set)) {
            this.theoryGrounding.selectedChunkIds = new Set();
        }
        if (!Array.isArray(this.theoryGrounding.items)) {
            this.theoryGrounding.items = [];
        }
        if (typeof this.theoryGrounding.selectedAnalysisId !== 'string') {
            this.theoryGrounding.selectedAnalysisId = '';
        }
        if (typeof this.theoryGrounding.selectedAnalysisData === 'undefined') {
            this.theoryGrounding.selectedAnalysisData = null;
        }
    }

    _sanitizeTheoryAnalysisText(value, fallback = '') {
        const text = String(value == null ? '' : value).trim();
        if (!text) return String(fallback || '').trim();
        const blockedMarkers = new Set([
            'ai_mode_in_progress',
            'analysis_pending',
            'network_error',
            'parse_failed',
            'generation_failed',
            'material_analysis',
        ]);
        const normalized = text.toLowerCase();
        const containsBlockedMarker = [...blockedMarkers].some((marker) => normalized.includes(marker));
        return containsBlockedMarker
            ? String(fallback || '').trim()
            : text;
    }

    _theoryGroundingCompositeId(source, id) {
        return `${String(source || '').trim()}:${String(id || '').trim()}`;
    }

    _normalizeTheoryAnalysisItem(payload, source, id, extra = {}) {
        const analysisPayload = (payload && typeof payload === 'object') ? payload : null;
        const recommendations = Array.isArray(analysisPayload?.recommendations) ? analysisPayload.recommendations : [];
        const rawTitle = String(
            extra.title
            || analysisPayload?.source_file_name
            || analysisPayload?.human_summary
            || analysisPayload?.ai_run_id
            || id
            || wt('editor_base.theory.untitled_analysis', 'Анализ без названия')
        );
        const rawSummary = String(
            extra.summary
            || analysisPayload?.human_summary
            || ''
        );
        return {
            source,
            id: String(id || '').trim(),
            composite_id: this._theoryGroundingCompositeId(source, id),
            title: this._sanitizeTheoryAnalysisText(rawTitle, wt('editor_base.theory.untitled_analysis', 'Анализ без названия')),
            summary: this._sanitizeTheoryAnalysisText(rawSummary, ''),
            updated_at: String(
                extra.updated_at
                || analysisPayload?.updated_at
                || analysisPayload?.created_at
                || ''
            ),
            analysis_payload: analysisPayload,
            available_task_types: [...new Set(recommendations.map((rec) => String(rec?.task_type || '').trim().toUpperCase()).filter(Boolean))],
        };
    }

    _readManualTheoryAnalysisArchive() {
        try {
            const raw = window.localStorage.getItem(this.manualAnalysisArchiveStorageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (_) {
            return [];
        }
    }

    _normalizeManualTheoryArchiveItem(entry) {
        const session = (entry?.session && typeof entry.session === 'object') ? entry.session : null;
        const payload = (session?.analysis && typeof session.analysis === 'object') ? session.analysis : null;
        if (!payload?.ok) return null;
        const id = String(entry?.id || session?.id || '').trim();
        if (!id) return null;
        return this._normalizeTheoryAnalysisItem(payload, 'manual_archive', id, {
            title: [session?.module_name || session?.module_id || '', session?.topic_name || session?.topic_id || '']
                .filter(Boolean)
                .join(' / ') || payload?.source_file_name || id,
            updated_at: entry?.archived_at || session?.updated_at || session?.created_at || '',
        });
    }

    _normalizeServerTheoryAnalysisItem(row) {
        const rid = String(row?.ai_run_id || '').trim();
        if (!rid) return null;
        return this._normalizeTheoryAnalysisItem(row?.analysis_json || null, 'server_analysis', rid, {
            title: row?.source_file_name || row?.human_summary || rid,
            summary: row?.human_summary || '',
            updated_at: row?.updated_at || row?.created_at || '',
        });
    }

    _getTheoryGroundingSelectedItem() {
        const items = Array.isArray(this.theoryGrounding?.items) ? this.theoryGrounding.items : [];
        const selectedId = String(this.theoryGrounding?.selectedAnalysisId || '').trim();
        if (selectedId) {
            return items.find((item) => String(item?.composite_id || '') === selectedId) || null;
        }
        const selectedRunId = String(this.theoryGrounding?.selectedRunId || '').trim();
        if (selectedRunId) {
            return items.find((item) => String(item?.id || '') === selectedRunId) || null;
        }
        return null;
    }

    _theoryGroundingCurrentTaskType() {
        const taskType = String(this.taskType || this.taskTypeParam || this.task?.task_data?.type || '').trim().toLowerCase();
        if (taskType === 'open_answer') return 'OPEN_ANSWER';
        if (taskType === 'sequence') return 'SEQUENCE';
        if (taskType === 'test') return 'TEST';
        if (taskType === 'draw' || this.isDrawTask) return 'DRAW';
        if (taskType === 'click') {
            if (typeof this.isErrorDetectionTask === 'function' && this.isErrorDetectionTask()) {
                const mode = String(this.errorDetection?.mode || this.task?.task_data?.content?.mode || 'text_errors').trim();
                return mode === 'text_choice' ? 'CLICK_TEXT' : 'CLICK_WORDS';
            }
            return 'CLICK';
        }
        return String(taskType || '').trim().toUpperCase();
    }

    _theoryGroundingTaskTypeLabel(taskType) {
        const normalized = String(taskType || '').trim().toUpperCase();
        const labels = {
            OPEN_ANSWER: wt('editor_base.task_type.open_answer', 'Открытый ответ'),
            SEQUENCE: wt('editor_base.task_type.sequence', 'Последовательность'),
            TEST: wt('editor_base.task_type.test', 'Тест'),
            CLICK: wt('editor_base.task_type.click', 'Клик'),
            CLICK_TEXT: wt('editor_base.task_type.click_text', 'Клик/Ошибки (тексты)'),
            CLICK_WORDS: wt('editor_base.task_type.click_words', 'Клик/Ошибки (слова)'),
            DRAW: wt('editor_base.task_type.draw', 'Рисование по изображению'),
        };
        return labels[normalized] || normalized || wt('editor_base.task_type.undefined', 'Тип не определён');
    }

    _theoryGroundingTypeRecommendation(payload, taskType) {
        const normalized = String(taskType || '').trim().toUpperCase();
        const recommendations = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
        return recommendations.find((rec) => String(rec?.task_type || '').trim().toUpperCase() === normalized) || null;
    }

    _theoryGroundingRelatedUnits(payload, recommendation) {
        const units = Array.isArray(payload?.educational_units) ? payload.educational_units : [];
        const covers = new Set(Array.isArray(recommendation?.covers_units) ? recommendation.covers_units.map((id) => Number(id)) : []);
        if (!covers.size) return [];
        return units.filter((unit) => covers.has(Number(unit?.id)));
    }

    cleanupPersistedTaskRoute() {
        if (!this.moduleId || !this.topicId || !this.taskId || typeof window === 'undefined') return;
        const url = new URL(window.location.href);
        url.searchParams.set('module', this.moduleId);
        url.searchParams.set('topic', this.topicId);
        url.searchParams.set('task', this.taskId);
        url.searchParams.delete('new');
        url.searchParams.delete('is_new');
        url.searchParams.delete('restore_draft');
        url.searchParams.delete('task_type');
        url.searchParams.delete('task_name');
        window.history.replaceState({}, '', url.toString());
    }

    discardLocalTaskDraft({ successMessage = '', navigate = true } = {}) {
        if (this.autoSaveManager) {
            if (typeof this.autoSaveManager.stop === 'function') {
                this.autoSaveManager.stop();
            }
            if (typeof this.autoSaveManager.clearDraft === 'function') {
                this.autoSaveManager.clearDraft();
            }
        }

        this.clearTaskBootstrap();
        this.hasPersistedTask = false;
        this.markSaved();

        if (successMessage) {
            this.showToast(successMessage, 'success');
        }

        if (!navigate || typeof window === 'undefined') {
            return;
        }

        if (typeof window.navigateWithTransition === 'function') {
            window.navigateWithTransition('/editor');
            return;
        }

        window.location.href = '/editor';
    }

    _normalizeIntIdList(values) {
        if (!Array.isArray(values)) return [];
        const seen = new Set();
        const out = [];
        values.forEach((raw) => {
            const v = Number.parseInt(raw, 10);
            if (!Number.isFinite(v) || seen.has(v)) return;
            seen.add(v);
            out.push(v);
        });
        return out;
    }

    _normalizeStrIdList(values) {
        if (!Array.isArray(values)) return [];
        const seen = new Set();
        const out = [];
        values.forEach((raw) => {
            const v = String(raw || '').trim();
            if (!v || seen.has(v)) return;
            seen.add(v);
            out.push(v);
        });
        return out;
    }

    _readEditorTheoryBridgeContext() {
        try {
            const raw = window.localStorage.getItem(this.editorTheoryBridgeStorageKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return null;
            const intent = String(parsed.intent || '').trim();
            const hasRefs = parsed.refs && typeof parsed.refs === 'object';
            const hasSourceBlock = parsed.source_block && typeof parsed.source_block === 'object';
            if (!intent && !hasRefs && !hasSourceBlock) {
                return null;
            }
            return parsed;
        } catch (_) {
            return null;
        }
    }

    _theoryGroundingTopicRunPrefsKey(runId = null) {
        const rid = String(runId || this.theoryGrounding?.selectedRunId || '').trim();
        const moduleId = String(this.moduleId || '').trim();
        const topicId = String(this.topicId || '').trim();
        if (!rid || !moduleId || !topicId) return null;
        return `${moduleId}::${topicId}::${rid}`;
    }

    _readTheoryGroundingPrefsStore() {
        try {
            const raw = window.localStorage.getItem(this.editorTheoryGroundingPrefsStorageKey);
            if (!raw) return {};
            const parsed = JSON.parse(raw);
            return (parsed && typeof parsed === 'object') ? parsed : {};
        } catch (_) {
            return {};
        }
    }

    _writeTheoryGroundingPrefsStore(store) {
        try {
            if (!store || typeof store !== 'object') return false;
            window.localStorage.setItem(this.editorTheoryGroundingPrefsStorageKey, JSON.stringify(store));
            return true;
        } catch (_) {
            return false;
        }
    }

    _sanitizeTheoryGroundingPrefs(value) {
        const raw = (value && typeof value === 'object') ? value : {};
        return {
            ignoreCoverage: raw.ignoreCoverage === true,
            trustLevel: raw.trustLevel === 'low_trust' ? 'low_trust' : 'normal',
        };
    }

    _getTheoryGroundingTopicRunPrefs(runId = null) {
        const key = this._theoryGroundingTopicRunPrefsKey(runId);
        if (!key) return this._sanitizeTheoryGroundingPrefs(null);
        const store = this._readTheoryGroundingPrefsStore();
        return this._sanitizeTheoryGroundingPrefs(store[key]);
    }

    _setTheoryGroundingTopicRunPrefs(patch, runId = null) {
        const key = this._theoryGroundingTopicRunPrefsKey(runId);
        if (!key || !patch || typeof patch !== 'object') return this._sanitizeTheoryGroundingPrefs(null);
        const store = this._readTheoryGroundingPrefsStore();
        const current = this._sanitizeTheoryGroundingPrefs(store[key]);
        const next = this._sanitizeTheoryGroundingPrefs({ ...current, ...patch });
        store[key] = next;
        this._writeTheoryGroundingPrefsStore(store);
        return next;
    }

    _syncTheoryGroundingRunPrefsState(runId = null) {
        const prefs = this._getTheoryGroundingTopicRunPrefs(runId);
        this.theoryGrounding.coverageIgnored = prefs.ignoreCoverage;
        this.theoryGrounding.trustLevel = prefs.trustLevel;
        return prefs;
    }

    _getTaskMetaObject() {
        if (!this.task || !this.task.task_data || typeof this.task.task_data !== 'object') return null;
        if (!this.task.task_data.meta || typeof this.task.task_data.meta !== 'object') {
            this.task.task_data.meta = {};
        }
        return this.task.task_data.meta;
    }

    _getTaskTheoryLinkMeta() {
        const meta = this._getTaskMetaObject() || {};
        return {
            aiRunId: String(meta.ai_run_id || '').trim() || null,
            unitIds: this._normalizeIntIdList(meta.educational_unit_ids),
            chunkIds: this._normalizeStrIdList(meta.analysis_chunk_ids || meta.chunk_ids),
            sourceGrounding: (meta.source_grounding && typeof meta.source_grounding === 'object') ? meta.source_grounding : null,
        };
    }

    _setTaskTheoryLinkMeta({ aiRunId = null, unitIds = null, chunkIds = null, clearSourceGrounding = false } = {}) {
        const meta = this._getTaskMetaObject();
        if (!meta) return;
        if (aiRunId != null) {
            const rid = String(aiRunId || '').trim();
            if (rid) meta.ai_run_id = rid;
            else delete meta.ai_run_id;
        }
        if (unitIds != null) {
            const ids = this._normalizeIntIdList(unitIds);
            if (ids.length) meta.educational_unit_ids = ids;
            else delete meta.educational_unit_ids;
        }
        if (chunkIds != null) {
            const ids = this._normalizeStrIdList(chunkIds);
            if (ids.length) meta.analysis_chunk_ids = ids;
            else delete meta.analysis_chunk_ids;
        }
        if (clearSourceGrounding) delete meta.source_grounding;
    }

    initTheoryGroundingPanel() {
        this._ensureTheoryGroundingSets();
        if (typeof this.theoryGrounding.panelOpen !== 'boolean') this.theoryGrounding.panelOpen = false;
        this._syncTheoryGroundingRunPrefsState();
        this.renderTheoryGroundingPanel();
    }

    async bootstrapTheoryGroundingPanel() {
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.bridgeContext = this._readEditorTheoryBridgeContext();
        const taskMeta = this._getTaskTheoryLinkMeta();
        this.theoryGrounding.selectedUnitIds = new Set(taskMeta.unitIds);
        this.theoryGrounding.selectedChunkIds = new Set(taskMeta.chunkIds);
        this.theoryGrounding.selectedRunId = taskMeta.aiRunId
            || String(this.theoryGrounding.bridgeContext?.ai_run_id || '').trim()
            || this.theoryGrounding.selectedRunId
            || null;
        this._syncTheoryGroundingRunPrefsState(this.theoryGrounding.selectedRunId);
        this.renderTheoryGroundingPanel();
        await this.loadTheoryGroundingAnalyses();
        if (this.theoryGrounding.selectedRunId) {
            await this.openTheoryGroundingAnalysis(this.theoryGrounding.selectedRunId, { silent: true });
        }
    }

    async loadTheoryGroundingAnalyses() {
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.analysesLoading = true;
        this.theoryGrounding.itemsLoading = true;
        this.theoryGrounding.analysesError = '';
        this.theoryGrounding.itemsError = '';
        this.renderTheoryGroundingPanel();
        try {
            const resp = await fetch('/api/editor/ai/analyses?limit=15');
            const data = await resp.json();
            const manualItems = this._readManualTheoryAnalysisArchive()
                .map((entry) => this._normalizeManualTheoryArchiveItem(entry))
                .filter(Boolean);
            if (data?.ok) {
                this.theoryGrounding.analyses = Array.isArray(data.items) ? data.items : [];
                const serverItems = this.theoryGrounding.analyses
                    .map((row) => this._normalizeServerTheoryAnalysisItem(row))
                    .filter(Boolean);
                this.theoryGrounding.items = [...manualItems, ...serverItems];
            } else {
                this.theoryGrounding.analyses = [];
                this.theoryGrounding.items = [...manualItems];
                this.theoryGrounding.analysesError = data?.error || data?.message || this.aiUxMessage('p8.analysis.list_load_failed', 'Не удалось загрузить список анализов. Можно повторить позже.');
                this.theoryGrounding.itemsError = this.theoryGrounding.analysesError;
            }
        } catch (_) {
            this.theoryGrounding.analyses = [];
            this.theoryGrounding.items = this._readManualTheoryAnalysisArchive()
                .map((entry) => this._normalizeManualTheoryArchiveItem(entry))
                .filter(Boolean);
            this.theoryGrounding.analysesError = this.aiUxMessage('p8.analysis.list_load_failed', 'Не удалось загрузить список анализов. Можно повторить позже.');
            this.theoryGrounding.itemsError = this.theoryGrounding.analysesError;
        } finally {
            this.theoryGrounding.analysesLoading = false;
            this.theoryGrounding.itemsLoading = false;
            if (!this.theoryGrounding.selectedAnalysisId) {
                const selectedRunId = String(this.theoryGrounding.selectedRunId || '').trim();
                const matched = (Array.isArray(this.theoryGrounding.items) ? this.theoryGrounding.items : [])
                    .find((item) => String(item?.id || '') === selectedRunId);
                if (matched) {
                    this.theoryGrounding.selectedAnalysisId = String(matched.composite_id || '');
                    this.theoryGrounding.selectedAnalysisData = matched;
                }
            }
            this.renderTheoryGroundingPanel();
        }
    }

    _hydrateTheorySelectionsFromTaskMetaAndBridge() {
        this._ensureTheoryGroundingSets();
        const taskMeta = this._getTaskTheoryLinkMeta();
        this.theoryGrounding.selectedUnitIds = new Set(taskMeta.unitIds);
        this.theoryGrounding.selectedChunkIds = new Set(taskMeta.chunkIds);
        const bridge = this._readEditorTheoryBridgeContext();
        this.theoryGrounding.bridgeContext = bridge;
        const sameRun = String(bridge?.ai_run_id || '').trim() && String(bridge?.ai_run_id || '').trim() === String(this.theoryGrounding.selectedRunId || '');
        if (sameRun && !taskMeta.unitIds.length && !taskMeta.chunkIds.length && bridge?.refs) {
            this.theoryGrounding.selectedUnitIds = new Set(this._normalizeIntIdList(bridge.refs.unit_ids));
            this.theoryGrounding.selectedChunkIds = new Set(this._normalizeStrIdList(bridge.refs.chunk_ids));
        }
        this._syncTheoryGroundingRunPrefsState(this.theoryGrounding.selectedRunId);
    }

    async openTheoryGroundingAnalysis(runId, { silent = false } = {}) {
        const rid = String(runId || '').trim();
        if (!rid) return;
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.selectedRunId = rid;
        this._syncTheoryGroundingRunPrefsState(rid);
        this.theoryGrounding.analysisLoading = true;
        this.theoryGrounding.analysisError = '';
        this.renderTheoryGroundingPanel();
        try {
            const resp = await fetch(`/api/editor/ai/analyses/${encodeURIComponent(rid)}`);
            const data = await resp.json();
            if (data?.ok) {
                this.theoryGrounding.analysisData = data;
                const matchedItem = (Array.isArray(this.theoryGrounding.items) ? this.theoryGrounding.items : [])
                    .find((item) => String(item?.id || '') === rid) || null;
                this.theoryGrounding.selectedAnalysisId = matchedItem?.composite_id || this._theoryGroundingCompositeId('server_analysis', rid);
                this.theoryGrounding.selectedAnalysisData = this._normalizeTheoryAnalysisItem(data, matchedItem?.source || 'server_analysis', rid, {
                    title: matchedItem?.title || data?.source_file_name || data?.human_summary || rid,
                    summary: matchedItem?.summary || data?.human_summary || '',
                    updated_at: matchedItem?.updated_at || data?.updated_at || data?.created_at || '',
                });
                this.theoryGrounding.analysisError = '';
                this._hydrateTheorySelectionsFromTaskMetaAndBridge();
                await this.refreshTheoryGroundingCoverage();
                if (!silent) this.showToast(this.aiUxMessage('p8.analysis.loaded', 'Анализ открыт для ручной привязки.'), 'success');
            } else {
                this.theoryGrounding.analysisData = null;
                this.theoryGrounding.selectedAnalysisData = null;
                this.theoryGrounding.coverageData = null;
                this.theoryGrounding.analysisError = data?.error || data?.message || this.aiUxMessage('p8.analysis.open_failed', 'Не удалось открыть анализ. Можно выбрать другой или продолжить без него.');
                if (!silent) this.showToast(this.theoryGrounding.analysisError, 'warning');
            }
        } catch (_) {
            this.theoryGrounding.analysisData = null;
            this.theoryGrounding.selectedAnalysisData = null;
            this.theoryGrounding.coverageData = null;
            this.theoryGrounding.analysisError = this.aiUxMessage('p8.analysis.open_failed', 'Не удалось открыть анализ. Можно выбрать другой или продолжить без него.');
            if (!silent) this.showToast(this.theoryGrounding.analysisError, 'warning');
        } finally {
            this.theoryGrounding.analysisLoading = false;
            this.renderTheoryGroundingPanel();
        }
    }

    async refreshTheoryGroundingCoverage() {
        this._ensureTheoryGroundingSets();
        const rid = String(this.theoryGrounding.selectedRunId || '').trim();
        if (!rid || !this.moduleId || !this.topicId) {
            this.theoryGrounding.coverageData = null;
            this.theoryGrounding.coverageError = '';
            this.renderTheoryGroundingPanel();
            return;
        }
        const prefs = this._syncTheoryGroundingRunPrefsState(rid);
        if (prefs.ignoreCoverage) {
            this.theoryGrounding.coverageLoading = false;
            this.theoryGrounding.coverageData = null;
            this.theoryGrounding.coverageError = '';
            this.renderTheoryGroundingPanel();
            return;
        }
        this.theoryGrounding.coverageLoading = true;
        this.theoryGrounding.coverageError = '';
        this.renderTheoryGroundingPanel();
        try {
            const url = `/api/editor/ai/analyses/${encodeURIComponent(rid)}/coverage?module_id=${encodeURIComponent(this.moduleId)}&topic_id=${encodeURIComponent(this.topicId)}`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (data?.ok) {
                this.theoryGrounding.coverageData = data;
            } else {
                this.theoryGrounding.coverageData = null;
                this.theoryGrounding.coverageError = data?.error || data?.message || this.aiUxMessage('ai_common.network_error', 'Не удалось выполнить действие из-за сетевой ошибки. Попробуйте ещё раз.');
            }
        } catch (_) {
            this.theoryGrounding.coverageData = null;
            this.theoryGrounding.coverageError = this.aiUxMessage('ai_common.network_error', 'Не удалось выполнить действие из-за сетевой ошибки. Попробуйте ещё раз.');
        } finally {
            this.theoryGrounding.coverageLoading = false;
            this.renderTheoryGroundingPanel();
        }
    }

    toggleTheoryGroundingPanel(forceOpen = null) {
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.panelOpen = typeof forceOpen === 'boolean'
            ? forceOpen
            : !this.theoryGrounding.panelOpen;
        this.renderTheoryGroundingPanel();
    }

    setTheoryGroundingSelectedRun(runId) {
        const rid = String(runId || '').trim();
        this.theoryGrounding.selectedAnalysisId = rid || '';
        const selectedItem = (Array.isArray(this.theoryGrounding.items) ? this.theoryGrounding.items : [])
            .find((item) => String(item?.composite_id || '') === rid) || null;
        this.theoryGrounding.selectedAnalysisData = selectedItem;
        this.theoryGrounding.selectedRunId = selectedItem?.id || rid || null;
        this._syncTheoryGroundingRunPrefsState(this.theoryGrounding.selectedRunId);
        this.theoryGrounding.analysisData = null;
        this.theoryGrounding.coverageData = null;
        this.theoryGrounding.analysisError = '';
        this.theoryGrounding.coverageError = '';
        this.renderTheoryGroundingPanel();
        if (selectedItem?.source === 'manual_archive' && selectedItem?.analysis_payload) {
            this.theoryGrounding.analysisData = selectedItem.analysis_payload;
            this.theoryGrounding.selectedAnalysisData = selectedItem;
            this.renderTheoryGroundingPanel();
            return;
        }
        if (this.theoryGrounding.selectedRunId) this.openTheoryGroundingAnalysis(this.theoryGrounding.selectedRunId).catch(() => {});
    }

    toggleTheoryGroundingUnit(unitId, checked) {
        this._ensureTheoryGroundingSets();
        const uid = Number.parseInt(unitId, 10);
        if (!Number.isFinite(uid)) return;
        if (checked) this.theoryGrounding.selectedUnitIds.add(uid);
        else this.theoryGrounding.selectedUnitIds.delete(uid);
        this.renderTheoryGroundingPanel();
    }

    toggleTheoryGroundingChunk(chunkId, checked) {
        this._ensureTheoryGroundingSets();
        const cid = String(chunkId || '').trim();
        if (!cid) return;
        if (checked) this.theoryGrounding.selectedChunkIds.add(cid);
        else this.theoryGrounding.selectedChunkIds.delete(cid);
        this.renderTheoryGroundingPanel();
    }

    clearTheoryGroundingSelections() {
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.selectedUnitIds.clear();
        this.theoryGrounding.selectedChunkIds.clear();
        this.renderTheoryGroundingPanel();
    }

    toggleTheoryGroundingCoverageIgnored(checked) {
        const rid = String(this.theoryGrounding?.selectedRunId || '').trim();
        if (!rid) return;
        const next = this._setTheoryGroundingTopicRunPrefs({ ignoreCoverage: !!checked }, rid);
        this.theoryGrounding.coverageIgnored = next.ignoreCoverage;
        if (next.ignoreCoverage) {
            this.theoryGrounding.coverageData = null;
            this.theoryGrounding.coverageError = '';
            this.showToast(this.aiUxMessage('p8.coverage.ignored_toggle_on', 'Покрытие для выбранного анализа скрыто в этой теме.'), 'info');
            this.renderTheoryGroundingPanel();
            return;
        }
        this.showToast(this.aiUxMessage('p8.coverage.ignored_toggle_off', 'Покрытие для выбранного анализа снова включено в этой теме.'), 'info');
        this.renderTheoryGroundingPanel();
        this.refreshTheoryGroundingCoverage().catch(() => {});
    }

    setTheoryGroundingTrustLevel(level) {
        const rid = String(this.theoryGrounding?.selectedRunId || '').trim();
        if (!rid) return;
        const normalized = String(level || '').trim() === 'low_trust' ? 'low_trust' : 'normal';
        const next = this._setTheoryGroundingTopicRunPrefs({ trustLevel: normalized }, rid);
        this.theoryGrounding.trustLevel = next.trustLevel;
        this.renderTheoryGroundingPanel();
        const msgKey = next.trustLevel === 'low_trust' ? 'p8.trust.saved_low_trust' : 'p8.trust.saved_normal';
        const fallback = next.trustLevel === 'low_trust'
            ? wt('editor_base.theory.low_trust_toast', 'Анализ помечен как низкое доверие. Подсказки будут подаваться мягче.')
            : wt('editor_base.theory.normal_trust_toast', 'Для анализа установлен обычный уровень доверия.');
        this.showToast(this.aiUxMessage(msgKey, fallback), 'info');
    }

    applyTheoryGroundingSelectionsToTask() {
        this._ensureTheoryGroundingSets();
        this._setTaskTheoryLinkMeta({
            aiRunId: this.theoryGrounding.selectedRunId || null,
            unitIds: [...this.theoryGrounding.selectedUnitIds],
            chunkIds: [...this.theoryGrounding.selectedChunkIds],
            clearSourceGrounding: true,
        });
        this.markUnsaved();
        this.renderTheoryGroundingPanel();
        this.refreshTheoryGroundingCoverage().catch(() => {});
        this.showToast(this.aiUxMessage('p8.link.apply_success', 'Привязка к разделам и фрагментам обновлена. Сохраните задачу, когда будете готовы.'), 'success');
    }

    applyTheoryBridgeContextToTask() {
        const bridge = this._readEditorTheoryBridgeContext();
        this.theoryGrounding.bridgeContext = bridge;
        if (!bridge || typeof bridge !== 'object') {
            this.showToast(this.aiUxMessage('p8.bridge.context_not_found', wt('p8.bridge.context_not_found', 'Контекст из отчёта не найден. Можно выбрать анализ вручную.')), 'warning');
            return;
        }
        const rid = String(bridge.ai_run_id || '').trim();
        const refs = (bridge.refs && typeof bridge.refs === 'object') ? bridge.refs : {};
        this.theoryGrounding.selectedUnitIds = new Set(this._normalizeIntIdList(refs.unit_ids));
        this.theoryGrounding.selectedChunkIds = new Set(this._normalizeStrIdList(refs.chunk_ids));
        if (rid) this.theoryGrounding.selectedRunId = rid;
        this._syncTheoryGroundingRunPrefsState(rid);
        this.renderTheoryGroundingPanel();
        this.showToast(this.aiUxMessage('p8.bridge.context_loaded', wt('p8.bridge.context_loaded', 'Контекст отчёта загружен в панель связи с анализом.')), 'info');
        if (rid && (!this.theoryGrounding.analysisData || String(this.theoryGrounding.analysisData.ai_run_id || '') !== rid)) {
            this.openTheoryGroundingAnalysis(rid).catch(() => {});
        }
    }

    _theoryGroundingCurrentTaskCoverageRow() {
        const rows = Array.isArray(this.theoryGrounding?.coverageData?.tasks) ? this.theoryGrounding.coverageData.tasks : [];
        return rows.find((row) => String(row?.task_id || '') === String(this.taskId || '')) || null;
    }

    _computeTheoryGroundingWarnings() {
        const warnings = [];
        const taskMeta = this._getTaskTheoryLinkMeta();
        const bridge = this._readEditorTheoryBridgeContext();
        const selectedRun = String(this.theoryGrounding?.selectedRunId || '').trim();
        const trustLevel = String(this.theoryGrounding?.trustLevel || 'normal').trim() === 'low_trust' ? 'low_trust' : 'normal';
        const currentCoverageRow = this._theoryGroundingCurrentTaskCoverageRow();
        if (!taskMeta.unitIds.length && !taskMeta.chunkIds.length) {
            warnings.push(this.aiUxMessage('p8.soft.no_links_ok', 'У задачи пока нет привязки к разделам и фрагментам текущего анализа — это допустимо.'));
        }
        if (taskMeta.sourceGrounding && taskMeta.sourceGrounding.weak === true) {
            warnings.push(this.aiUxMessage('p8.soft.saved_weak_grounding', 'Сохранённая привязка выглядит слабой; при необходимости уточните разделы и фрагменты вручную.'));
        }
        if (currentCoverageRow && currentCoverageRow.weak_grounding && trustLevel !== 'low_trust') {
            warnings.push(this.aiUxMessage('p8.soft.coverage_weak_grounding', 'Покрытие для этой задачи указывает на слабую привязку к материалу. Проверьте вручную.'));
        }
        if (selectedRun && taskMeta.aiRunId && taskMeta.aiRunId !== selectedRun) {
            warnings.push(this.aiUxMessage('p8.soft.run_mismatch', 'Задача связана с другим анализом; в текущем coverage она может учитываться отдельно.'));
        }
        const bridgeRefs = bridge?.refs && typeof bridge.refs === 'object'
            ? (this._normalizeIntIdList(bridge.refs.unit_ids).length || this._normalizeStrIdList(bridge.refs.chunk_ids).length)
            : 0;
        if (bridgeRefs && !taskMeta.unitIds.length && !taskMeta.chunkIds.length) {
            warnings.push(this.aiUxMessage('p8.soft.bridge_refs_available', wt('p8.soft.bridge_refs_available', 'В контексте отчёта уже есть готовые привязки. Их можно применить в один клик.')));
        }
        return warnings;
    }
    _positionTheoryGroundingPanel(panel) {
        if (!(panel instanceof HTMLElement)) return;
        const card = panel.querySelector('[data-role="theory-grounding-card"]');
        if (!(card instanceof HTMLElement)) return;

        const { header } = this._theoryGroundingHeaderHost();
        const headerRect = header instanceof HTMLElement ? header.getBoundingClientRect() : null;
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1280;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
        const margin = 16;
        const headerLeft = Math.max(margin, headerRect?.left || margin);
        const headerRight = Math.min(viewportWidth - margin, headerRect?.right || (viewportWidth - margin));
        const cardWidth = Math.max(320, headerRight - headerLeft);
        const left = headerLeft;
        const top = Math.max(margin, (headerRect?.bottom || 0) + 10);
        const maxHeight = Math.max(220, viewportHeight - top - margin);

        card.style.position = 'fixed';
        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
        card.style.width = `${cardWidth}px`;
        card.style.maxHeight = `${maxHeight}px`;
    }
    renderTheoryGroundingPanel() {
        this._ensureTheoryGroundingSets();
        this.theoryGrounding.currentTaskType = this._theoryGroundingCurrentTaskType();
        this.renderTheoryGroundingBeacon();

        const state = this.theoryGrounding;
        const bridge = state.bridgeContext || this._readEditorTheoryBridgeContext();
        state.bridgeContext = bridge;
        const warnings = this._computeTheoryGroundingWarnings();
        const { header } = this._theoryGroundingHeaderHost();
        let panel = document.getElementById(this._theoryGroundingContainerId());

        if (!state.panelOpen) {
            if (panel) panel.remove();
            return;
        }
        if (!header) {
            if (panel) panel.remove();
            return;
        }

        if (!panel) {
            panel = document.createElement('section');
            panel.id = this._theoryGroundingContainerId();
        }
        panel.className = 'fixed inset-0 z-[140]';
        panel.style.pointerEvents = 'none';
        if (panel.parentElement !== document.body) {
            document.body.appendChild(panel);
        }

        const items = Array.isArray(state.items) ? state.items : [];
        const selectedItem = state.selectedAnalysisData || this._getTheoryGroundingSelectedItem();
        const payload = selectedItem?.analysis_payload || null;
        const currentType = String(state.currentTaskType || '').trim().toUpperCase();
        const currentTypeLabel = this._theoryGroundingTaskTypeLabel(currentType);
        const currentRec = payload ? this._theoryGroundingTypeRecommendation(payload, currentType) : null;
        const shownUnits = payload ? this._theoryGroundingRelatedUnits(payload, currentRec) : [];
        const sourceLabel = selectedItem?.source === 'manual_archive' ? wt('editor_base.theory.source_manual_archive', 'Локальный архив') : wt('editor_base.theory.source_ai_analysis', 'AI-анализ');
        const formattedDate = selectedItem?.updated_at ? new Date(selectedItem.updated_at).toLocaleString('ru-RU') : '';
        const sanitizeLabel = (value, fallback = '') => this._sanitizeTheoryAnalysisText(value, fallback || '');

        const renderTextList = (values = [], emptyText = '', maxItems = Infinity) => {
            const list = Array.isArray(values) ? values.filter(Boolean) : [];
            if (!list.length) {
                return emptyText ? `<div class="text-[11px] text-text-secondary">${this.escapeHtml(emptyText)}</div>` : '';
            }
            return `
                <div class="space-y-1">
                    ${list.slice(0, Math.max(0, maxItems)).map((item) => `<div class="text-[11px] text-text-secondary bg-surface-1 border border-border-subtle rounded-lg px-2 py-1.5">${this.escapeHtml(String(item))}</div>`).join('')}
                </div>
            `;
        };

        const renderManualAuthoring = (manualAuthoring) => {
            if (!manualAuthoring || typeof manualAuthoring !== 'object') return '';
            return `
                <div class="rounded-lg border border-warning-light bg-surface-2 p-3 space-y-1">
                    <div class="text-[11px] font-semibold text-text-main">${wt('editor_base.theory.visual_anchor', 'Визуальный ориентир')}</div>
                    ${Array.isArray(manualAuthoring.figure_refs) && manualAuthoring.figure_refs.length ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('editor_base.theory.figures', 'Рисунки')}:</span> ${this.escapeHtml(manualAuthoring.figure_refs.slice(0, 3).join(', '))}</div>` : ''}
                    ${Array.isArray(manualAuthoring.target_objects) && manualAuthoring.target_objects.length ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('editor_base.theory.what_to_recognize', 'Что распознать')}:</span> ${this.escapeHtml(manualAuthoring.target_objects.slice(0, 3).join('; '))}</div>` : ''}
                    ${manualAuthoring.task_stem_example ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('editor_base.theory.task_stem_example', 'Пример формулировки')}:</span> ${this.escapeHtml(String(manualAuthoring.task_stem_example))}</div>` : ''}
                </div>
            `;
        };

        const renderRecommendationCard = (rec) => {
            const anchors = Array.isArray(rec?.assessable_anchors) ? rec.assessable_anchors.filter(Boolean) : [];
            const candidates = Array.isArray(rec?.design_candidates) ? rec.design_candidates.filter(Boolean) : [];
            const editorLabel = String(rec?.editor_label || this._theoryGroundingTaskTypeLabel(rec?.task_type || ''));
            return `
                <div class="rounded-xl border border-border-subtle bg-surface-2 p-3 space-y-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="text-sm font-semibold text-text-main">${this.escapeHtml(editorLabel)}</div>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-surface-1 text-text-main border border-primary-light">${wt('editor_base.theory.current_type', 'текущий тип')}</span>
                    </div>
                    ${rec?.coverage_role ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('editor_base.theory.what_we_check', 'Что проверяем')}:</span> ${this.escapeHtml(String(rec.coverage_role))}</div>` : ''}
                    ${rec?.generation_focus ? `<div class="text-[11px] text-text-secondary"><span class="font-semibold text-text-main">${wt('editor_base.theory.focus', 'Фокус')}:</span> ${this.escapeHtml(String(rec.generation_focus))}</div>` : ''}
                    ${anchors.length ? `<div><div class="text-[11px] font-semibold text-text-main mb-1">${wt('editor_base.theory.anchors', 'Опоры')}</div>${renderTextList(anchors, '', 4)}</div>` : ''}
                    ${candidates.length ? `<div><div class="text-[11px] font-semibold text-text-main mb-1">${wt('editor_base.theory.candidates', 'Идеи заданий')}</div>${renderTextList(candidates, '', 2)}</div>` : ''}
                    ${renderManualAuthoring(rec?.manual_authoring)}
                </div>
            `;
        };

        panel.innerHTML = `
            <button type="button" data-role="theory-grounding-backdrop" onclick="window.editor && window.editor.toggleTheoryGroundingPanel(false)" class="absolute inset-0 bg-scrim/35 backdrop-blur-[1px]" style="pointer-events:auto;" aria-label="${wt('editor_base.theory.close_recommendations', 'Закрыть рекомендации')}"></button>
            <div data-role="theory-grounding-card" class="rounded-2xl border border-border-subtle bg-surface-1 shadow-2xl" style="pointer-events:auto; overflow:hidden;">
                <div class="px-5 py-4">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div class="min-w-0 flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] text-primary">hub</span>
                            <h3 class="text-sm font-bold text-text-main">${wt('editor_base.theory.analysis_connection', 'Связь с анализом')}</h3>
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border border-border-subtle bg-surface-2 text-text-secondary">${this.escapeHtml(currentTypeLabel || wt('editor_base.task_type.undefined', 'Тип не определён'))}</span>
                            ${selectedItem ? `<span class="hidden md:inline text-[11px] text-text-secondary truncate">${this.escapeHtml(sourceLabel)}${formattedDate ? ` · ${this.escapeHtml(formattedDate)}` : ''}</span>` : ''}
                        </div>
                        <div class="flex items-center gap-2 max-w-full">
                            <label class="min-w-[18rem] max-w-[38rem] w-[min(100%,38rem)]">
                                <span class="sr-only">${wt('editor_base.theory.selected_analysis', 'Выбранный анализ')}</span>
                                <select onchange="window.editor && window.editor.setTheoryGroundingSelectedRun(this.value)" class="w-full rounded-lg border-border-subtle bg-surface-2 py-2 pl-3 pr-10 text-xs text-text-main focus:ring-2 focus:ring-primary appearance-none" style="text-overflow:ellipsis;">
                                    <option value="">${wt('editor_base.theory.select_analysis', 'Выберите анализ...')}</option>
                                    ${items.map((item) => {
                                        const itemSourceLabel = item.source === 'manual_archive' ? wt('editor_base.theory.source_local', 'Локальный') : wt('editor_base.theory.source_server', 'Сервер');
                                        const selectedAttr = item.composite_id === String(state.selectedAnalysisId || '') ? 'selected' : '';
                                        const label = `${itemSourceLabel} · ${sanitizeLabel(item.title, wt('editor_base.theory.untitled_analysis', 'Анализ без названия'))}`;
                                        return `<option value="${this.escapeHtml(item.composite_id)}" ${selectedAttr}>${this.escapeHtml(label)}</option>`;
                                    }).join('')}
                                </select>
                            </label>
                            <button type="button" onclick="window.editor && window.editor.loadTheoryGroundingAnalyses()" class="px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-1 text-xs font-medium text-text-secondary hover:bg-bg-hover">
                                ${state.itemsLoading ? '...' : wt('editor_base.theory.refresh_btn', 'Обновить')}
                            </button>
                            <button type="button" onclick="window.editor && window.editor.toggleTheoryGroundingPanel(false)" class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-surface-1 text-text-secondary hover:bg-bg-hover" aria-label="${wt('editor_base.theory.close_panel_aria', 'Закрыть рекомендации')}">
                                <span class="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>
                    </div>
                    ${bridge?.ai_run_id ? `
                        <div class="mt-2 p-2 rounded-lg border border-info-light bg-info-lighter" style="pointer-events:auto;">
                            <div class="text-[11px] text-info-text">${wt('editor_base.theory.bridge_report_context', 'Контекст из отчёта')}: <span class="font-mono">${this.escapeHtml(String(bridge.ai_run_id))}</span>${bridge?.source_block?.title ? ` · ${this.escapeHtml(bridge.source_block.title)}` : ''}</div>
                            <button type="button" onclick="window.editor && window.editor.applyTheoryBridgeContextToTask()" class="mt-1 px-2 py-1 rounded-md border border-info-light bg-info-light text-info-text text-[11px] hover:opacity-90">${wt('editor_base.theory.apply_bridge_refs', 'Применить привязки из отчёта')}</button>
                        </div>
                    ` : ''}

                    <div class="mt-3 rounded-xl border border-border-subtle bg-surface-1 p-3" style="max-height:min(36vh, 22rem); overflow-y:auto; overscroll-behavior:contain;">
                        <div class="space-y-3">
                            ${warnings.length ? `
                                <div class="rounded-lg border border-warning-light bg-surface-2 p-3 space-y-1">
                                    <div class="text-[11px] font-semibold text-text-main">${wt('editor_base.theory.remarks', 'Замечания')}</div>
                                    ${warnings.map((warning) => `<div class="text-[11px] text-text-secondary">${this.escapeHtml(String(warning))}</div>`).join('')}
                                </div>
                            ` : ''}
                            ${state.itemsError ? `<div class="text-[11px] text-error-text">${this.escapeHtml(state.itemsError)}</div>` : ''}
                            ${state.analysisError ? `<div class="text-[11px] text-error-text">${this.escapeHtml(state.analysisError)}</div>` : ''}
                            ${items.length === 0 && !state.itemsLoading ? `<div class="rounded-lg border border-border-subtle bg-surface-2 p-4 text-sm text-text-secondary">${wt('editor_base.theory.archive_empty', 'Архив пока пуст. Сохранить анализ можно через раздел «Анализ теории».')}</div>` : ''}
                            ${state.analysisLoading ? `<div class="rounded-lg border border-border-subtle bg-surface-2 p-4 text-sm text-text-secondary">${wt('editor_base.theory.loading_analysis', 'Загрузка анализа...')}</div>` : ''}
                            ${!selectedItem && !state.analysisLoading ? `<div class="rounded-lg border border-border-subtle bg-surface-2 p-4 text-sm text-text-secondary">${wt('editor_base.theory.select_analysis_hint', 'Выберите анализ в выпадающем списке, чтобы увидеть рекомендации для текущего типа задания.')}</div>` : ''}
                            ${selectedItem && !payload && !state.analysisLoading ? `<div class="rounded-lg border border-border-subtle bg-surface-2 p-4 text-sm text-text-secondary">${wt('editor_base.theory.no_full_content', 'Для этой записи пока недоступно полное содержимое анализа.')}</div>` : ''}
                            ${payload ? `
                                <div class="space-y-3">
                                    ${currentRec ? renderRecommendationCard(currentRec) : `
                                        <div class="rounded-lg border border-border-subtle bg-surface-2 p-4">
                                            <div class="text-sm font-semibold text-text-main">${wt('editor_base.theory.no_specific_rec', 'Для этого типа нет отдельной рекомендации')}</div>
                                            <div class="text-[11px] text-text-secondary mt-1">${wt('editor_base.theory.select_other_rec_hint', 'Выберите другой анализ из архива или откройте полный разбор в разделе «Анализ теории».')}</div>
                                        </div>
                                    `}
                                    <div class="rounded-lg border border-border-subtle bg-surface-2 p-3">
                                        <div class="text-[11px] font-semibold text-text-main mb-2">${wt('editor_base.theory.related_units', 'Связанные единицы')}</div>
                                        ${shownUnits.length ? `
                                            <div class="space-y-1">
                                                ${shownUnits.slice(0, 3).map((unit) => `
                                                    <div class="text-[11px] text-text-secondary bg-surface-1 border border-border-subtle rounded-lg px-2 py-1.5">
                                                        <span class="font-semibold text-text-main">#${Number(unit?.id || 0)} ${this.escapeHtml(String(unit?.title || 'Единица'))}</span>
                                                        ${unit?.description ? `<div class="mt-1">${this.escapeHtml(String(unit.description))}</div>` : ''}
                                                    </div>
                                                `).join('')}
                                            </div>
                                        ` : `<div class="text-[11px] text-text-secondary">${wt('editor_base.theory.no_units_for_type', 'Для текущего типа нет отдельного списка единиц.')}</div>`}
                                    </div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
            </div>
        `;
        this._positionTheoryGroundingPanel(panel);
    }

    // ===== NAVIGATION =====

    /**
     * Navigate back to dashboard
     */
    goBack() {
        if (this.hasUnsavedChanges) {
            this.showConfirmModal({
                title: wt('editor_base.modal.unsaved_changes_title', 'Несохранённые изменения'),
                message: wt('editor_base.modal.unsaved_changes_message', 'У вас есть несохранённые изменения. Вы уверены, что хотите выйти без сохранения?'),
                confirmText: wt('editor_base.modal.exit_btn', 'Выйти'),
                cancelText: wt('editor_base.modal.stay_btn', 'Остаться'),
                onConfirm: () => {
                    this.hasUnsavedChanges = false;
                    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
                    window.navigateWithTransition('/editor');
                }
            });
            return;
        }
        window.navigateWithTransition('/editor');
    }

    /**
     * Setup beforeunload warning for unsaved changes
     */
    setupBeforeUnloadWarning() {
        if (isReferencePreviewMode()) return;
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = '';
                return '';
            }
        });
    }

    // ===== UNDO/REDO SYSTEM =====

    /**
     * Setup keyboard shortcuts for Undo/Redo
     */
    setupUndoRedoHandlers() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+Z - Undo
            if (e.ctrlKey && e.key === 'z' && !e.shiftKey) {
                e.preventDefault();
                this.performUndo();
            }

            // Ctrl+Y or Ctrl+Shift+Z - Redo
            if ((e.ctrlKey && e.key === 'y') ||
                (e.ctrlKey && e.shiftKey && e.key === 'z')) {
                e.preventDefault();
                this.performRedo();
            }
        });

        document.addEventListener('click', (e) => {
            const undoBtn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('#undo-btn')
                : null;
            if (undoBtn) {
                e.preventDefault();
                if (!undoBtn.disabled) {
                    this.performUndo();
                }
                return;
            }

            const redoBtn = e.target && typeof e.target.closest === 'function'
                ? e.target.closest('#redo-btn')
                : null;
            if (redoBtn) {
                e.preventDefault();
                if (!redoBtn.disabled) {
                    this.performRedo();
                }
            }
        });
    }

    /**
     * Perform undo operation
     */
    performUndo() {
        const state = this.undoManager.undo();
        if (state) {
            this.restoreState(state);
            this.updateUndoRedoButtons();
            console.log('Undo performed');
        }
    }

    /**
     * Perform redo operation
     */
    performRedo() {
        const state = this.undoManager.redo();
        if (state) {
            this.restoreState(state);
            this.updateUndoRedoButtons();
            console.log('Redo performed');
        }
    }

    /**
     * Save current state to undo history
     * Call this after every user action that modifies data
     */
    saveStateToHistory() {
        const state = this.captureState();
        this.undoManager.pushState(state);
        this.updateUndoRedoButtons();
    }

    /**
     * Update Undo/Redo button states
     */
    updateUndoRedoButtons() {
        const undoBtn = document.getElementById('undo-btn');
        const redoBtn = document.getElementById('redo-btn');

        if (undoBtn) {
            undoBtn.disabled = !this.undoManager.canUndo();
            undoBtn.title = this.undoManager.canUndo()
                ? wt('editor_base.undo.can_undo', 'Отменить (Ctrl+Z)')
                : wt('editor_base.undo.nothing_to_undo', 'Нет действий для отмены');
        }

        if (redoBtn) {
            redoBtn.disabled = !this.undoManager.canRedo();
            redoBtn.title = this.undoManager.canRedo()
                ? wt('editor_base.undo.can_redo', 'Повторить (Ctrl+Y)')
                : wt('editor_base.undo.nothing_to_redo', 'Нет действий для повтора');
        }
    }

    // ===== ABSTRACT METHODS (must be implemented by child classes) =====

    /**
     * Called after task is loaded from backend
     * Child classes should implement this to populate their UI
     */
    onTaskLoaded() {
        throw new Error('onTaskLoaded() must be implemented by child class');
    }

    /**
     * Validate task before saving
     * @returns {string|null} Error message if validation fails, null if valid
     */
    validateTask() {
        throw new Error('validateTask() must be implemented by child class');
    }

    /**
     * Build task data object for saving to backend
     * @returns {Object} Task data object
     */
    buildTaskData() {
        throw new Error('buildTaskData() must be implemented by child class');
    }

    /**
     * Called after task is successfully saved
     * Optional hook for child classes
     */
    onTaskSaved() {
        // Optional - child classes can override if needed
    }

    /**
     * Capture current editor state for undo/redo
     * @returns {Object} State snapshot
     */
    captureState() {
        throw new Error('captureState() must be implemented by child class');
    }

    /**
     * Restore editor state from snapshot
     * @param {Object} state - State to restore
     */
    restoreState(state) {
        throw new Error('restoreState() must be implemented by child class');
    }

    // ===== LATE NAVIGATION GUARDS OVERRIDES =====

    goBack() {
        if (this.hasUnsavedChanges) {
            this.showConfirmModal({
                title: wt('editor_base.modal.unsaved_changes_title', 'Несохранённые изменения'),
                message: wt('editor_base.modal.unsaved_changes_message', 'У вас есть несохранённые изменения. Вы уверены, что хотите выйти без сохранения?'),
                confirmText: wt('editor_base.modal.exit_btn', 'Выйти'),
                cancelText: wt('editor_base.modal.stay_btn', 'Остаться'),
                onConfirm: () => {
                    this.hasUnsavedChanges = false;
                    this.teardownNavigationGuards();
                    window.navigateWithTransition('/editor');
                }
            });
            return;
        }
        this.teardownNavigationGuards();
        window.navigateWithTransition('/editor');
    }

    setupBeforeUnloadWarning() {
        this.setupNavigationGuards();
    }

    setupNavigationGuards() {
        if (this._navigationGuardsSetup || typeof window === 'undefined') {
            return;
        }
        if (isReferencePreviewMode()) {
            this._navigationGuardsSetup = true;
            this._historyGuardDisabled = true;
            return;
        }

        this._navigationGuardsSetup = true;
        this._historyGuardToken = `editor-guard:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

        this._beforeUnloadHandler = (event) => {
            if (!this.hasUnsavedChanges || this._historyGuardDisabled) return;
            event.preventDefault();
            event.returnValue = '';
            return '';
        };

        this._historyGuardHandler = (event) => {
            if (this._historyGuardDisabled) return;
            const state = (event && event.state && typeof event.state === 'object') ? event.state : null;
            if (!state || state.__editorGuardToken !== this._historyGuardToken || state.__editorGuardRole !== 'base') {
                return;
            }

            if (this._historyGuardPromptOpen) {
                this._restoreHistoryGuardEntry();
                return;
            }

            if (this.hasUnsavedChanges) {
                this._historyGuardPromptOpen = true;
                this.showConfirmModal({
                    title: wt('editor_base.modal.unsaved_changes_title', 'Несохранённые изменения'),
                    message: wt('editor_base.modal.unsaved_changes_message', 'У вас есть несохранённые изменения. Вы уверены, что хотите выйти без сохранения?'),
                    confirmText: wt('editor_base.modal.exit_btn', 'Выйти'),
                    cancelText: wt('editor_base.modal.stay_btn', 'Остаться'),
                    onConfirm: () => {
                        this._historyGuardPromptOpen = false;
                        this.hasUnsavedChanges = false;
                        this.teardownNavigationGuards();
                        window.history.back();
                    },
                    onCancel: () => {
                        this._historyGuardPromptOpen = false;
                        this._restoreHistoryGuardEntry();
                    }
                });
                return;
            }

            this.teardownNavigationGuards();
            window.history.back();
        };

        window.addEventListener('beforeunload', this._beforeUnloadHandler);
        window.addEventListener('popstate', this._historyGuardHandler);
        this._installHistoryGuardEntry();
    }

    _installHistoryGuardEntry() {
        if (typeof window === 'undefined' || !window.history || !this._historyGuardToken) return;
        const currentState = (window.history.state && typeof window.history.state === 'object')
            ? { ...window.history.state }
            : {};

        if (currentState.__editorGuardToken === this._historyGuardToken && currentState.__editorGuardRole === 'guard') {
            return;
        }

        const baseState = {
            ...currentState,
            __editorGuardToken: this._historyGuardToken,
            __editorGuardRole: 'base',
        };
        const guardState = {
            ...baseState,
            __editorGuardRole: 'guard',
        };

        window.history.replaceState(baseState, '', window.location.href);
        window.history.pushState(guardState, '', window.location.href);
    }

    _restoreHistoryGuardEntry() {
        if (typeof window === 'undefined' || !window.history || !this._historyGuardToken || this._historyGuardDisabled) return;
        const currentState = (window.history.state && typeof window.history.state === 'object')
            ? window.history.state
            : null;

        if (!currentState || currentState.__editorGuardToken !== this._historyGuardToken || currentState.__editorGuardRole !== 'base') {
            return;
        }

        const guardState = {
            ...currentState,
            __editorGuardRole: 'guard',
        };
        window.history.pushState(guardState, '', window.location.href);
    }

    teardownNavigationGuards() {
        if (this._historyGuardDisabled) return;
        this._historyGuardDisabled = true;
        if (typeof window !== 'undefined') {
            if (this._beforeUnloadHandler) {
                window.removeEventListener('beforeunload', this._beforeUnloadHandler);
            }
            if (this._historyGuardHandler) {
                window.removeEventListener('popstate', this._historyGuardHandler);
            }
        }
    }
}



