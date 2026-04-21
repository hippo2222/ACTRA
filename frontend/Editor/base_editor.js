/**
 * BaseEditor - Base class for all task editors
 * Provides common functionality for loading, saving, validation, and UI updates
 */

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

        // Undo/Redo support
        this.undoManager = new UndoManager(50);
        this.setupUndoRedoHandlers();

        // P8 bridge state (theory report <-> manual editor)
        this.editorTheoryBridgeStorageKey = 'rp_editor_theory_bridge_v1';
        this.editorTheoryGroundingPrefsStorageKey = 'rp_editor_theory_grounding_p8_prefs_v1';
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

    applyLoadedTask(task, options = {}) {
        const { persisted = true } = options;
        this.task = task;
        this.hasPersistedTask = Boolean(persisted);

        if (!this.autoSaveManager) {
            this.autoSaveManager = new AutoSaveManager(this, { interval: 30000 });
        }

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
            this.showFatalError('Неверная ссылка: отсутствуют параметры задания (module, topic, task)');
            return false;
        }

        if (!this.isNewTaskParam) {
            await this.loadTask(this.moduleId, this.topicId, this.taskId);
            return true;
        }

        const localBootstrap = this.readTaskBootstrap(this.moduleId, this.topicId, this.taskId);
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
                this.showFatalError(data?.error || 'Не удалось загрузить задание');
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
            this.showFatalError('Черновик не найден. Откройте создание задания заново.');
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

            if (data.ok) {
                this.applyLoadedTask(data.task, { persisted: true });
            } else {
                this.showFatalError(data.error || "Ошибка загрузки задания");
            }
        } catch (error) {
            console.error("Error loading task:", error);
            this.showFatalError("Ошибка сети: " + error.message);
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
                this.showToast('Несохранённые изменения восстановлены', 'success');
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
                    this.showToast('Не удалось загрузить параметры уровней сложности. Повторите попытку сохранения.', 'error');
                }
                return false;
            }
        }

        this.syncDifficultyAuthoringStateFromTask(taskData, meta);
        const { mode, selectedLevels } = this._resolveDifficultyAuthoringSelection(meta);
        if (meta?.authoring_enabled && mode === 'custom' && !selectedLevels.length) {
            if (showValidationToast) {
                this.showToast('Выберите хотя бы один доступный уровень сложности.', 'warning');
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
            message: '! Требуется правка',
            detail: 'Выберите хотя бы один уровень сложности. Пока набор пустой, задание нельзя сохранить и использовать.',
            draftDetail: 'Черновик сохранён локально, но задание нельзя сохранить и использовать, пока не выбран хотя бы один уровень сложности.',
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
            message: blockingState.message || '! Требуется правка',
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
            return supportedLevels.length ? 'Все уровни типа' : 'По умолчанию';
        }
        if (!selectedLevels.length) {
            return 'Нужно выбрать уровни';
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
            blockingState.draftDetail || blockingState.detail || 'Черновик требует правки.',
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
            title: 'Доступные уровни сложности',
            intro: 'Выберите, на каких уровнях сложности это задание может появляться в комплексе.',
            allTitle: 'Все уровни типа',
            allDescription: 'Задание может появляться на каждом поддерживаемом уровне.',
            customTitle: 'Только выбранные уровни',
            customDescription: 'Оставьте только те уровни, на которых это задание уместно.',
            warning: 'Нужно оставить хотя бы один уровень, иначе задание нельзя будет сохранить.',
        };
    }

    getDifficultyAuthoringLevelDescription(level, meta = this.difficultyAuthoring.activeMeta) {
        const normalizedLevel = Number.parseInt(level, 10);
        if (!Number.isFinite(normalizedLevel)) return '';

        const taskType = this._getDifficultyAuthoringTaskType(this.task?.task_data);
        const subtype = this._getDifficultyAuthoringSubtype(this.task?.task_data);
        const descriptions = {
            test: {
                1: 'Пользователь выбирает правильный вариант из готовых ответов.',
                2: 'Пользователь сам вводит короткий текстовый ответ.',
            },
            click: {
                default: {
                    1: 'Пользователь просто нажимает на нужную область.',
                    2: 'Пользователь находит область и выбирает её с названием.',
                    3: 'Пользователь выделяет область и называет её.',
                },
            },
            draw: {
                1: 'Пользователь обводит нужную область.',
                2: 'Пользователь обводит область и подписывает её.',
            },
            sequence: {
                1: 'Пользователь раскладывает элементы по уровням или группам.',
                2: 'Пользователь раскладывает элементы и подписывает уровни.',
                3: 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.',
            },
            sequence_assembly: {
                1: 'Пользователь раскладывает элементы по уровням или группам.',
                2: 'Пользователь раскладывает элементы и подписывает уровни.',
                3: 'Пользователь раскладывает элементы и подписывает и уровни, и элементы.',
            },
        };

        let taskDescriptions = descriptions[taskType];
        if (taskType === 'click' && subtype) {
            taskDescriptions = taskDescriptions?.[subtype] || taskDescriptions?.default || null;
        }
        const directDescription = taskDescriptions?.[normalizedLevel];
        if (directDescription) return directDescription;

        const roleMap = Array.isArray(meta?.level_role_map) ? meta.level_role_map : [];
        const roleEntry = roleMap.find((item) => Number.parseInt(item?.level, 10) === normalizedLevel);
        const fallbackRole = String(roleEntry?.role || '').trim();
        if (fallbackRole) return fallbackRole;

        return `Что делает пользователь на уровне ${normalizedLevel}`;
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
                title.textContent = `Уровень ${level}`;
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
                                            <span class="text-sm font-semibold text-text-main">Уровень ${level}</span>
                                        </span>
                                        <span class="block mt-1 text-[11px] leading-relaxed text-text-secondary">${this.escapeHtml(this.getDifficultyAuthoringLevelDescription(level, meta) || (roles.get(level) || `Уровень ${level}`))}</span>
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
                    <h3 class="text-sm font-bold text-text-main">Уровни сложности</h3>
                </div>
                <p class="text-xs text-text-secondary leading-relaxed">
                    Определите, какие уровни будут доступны именно в этом задании.
                </p>
            </div>
            <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label class="difficulty-authoring__mode-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 cursor-pointer">
                    <input type="radio" name="difficulty-authoring-mode" value="all" ${customMode ? '' : 'checked'} class="mt-0.5 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold text-text-main">Все поддерживаемые уровни</span>
                        <span class="block mt-1 text-xs text-text-secondary">Пользователь проходит полную лестницу этого типа задания.</span>
                    </span>
                </label>
                <label class="difficulty-authoring__mode-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 cursor-pointer">
                    <input type="radio" name="difficulty-authoring-mode" value="custom" ${customMode ? 'checked' : ''} class="mt-0.5 h-4 w-4 border-border-subtle text-primary focus:ring-primary">
                    <span class="min-w-0">
                        <span class="block text-sm font-semibold text-text-main">Выбрать конкретные уровни</span>
                        <span class="block mt-1 text-xs text-text-secondary">Оставьте только те шаги сложности, которые подходят этой формулировке.</span>
                    </span>
                </label>
            </div>
            <div class="space-y-2">
                ${supportedLevels.map((level) => {
                    const checked = selectedLevels.includes(level);
                    const role = roles.get(level) || `Уровень ${level}`;
                    return `
                        <label class="difficulty-authoring__level-card flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-3 ${customMode ? 'cursor-pointer' : 'opacity-70'}">
                            <input type="checkbox" data-difficulty-level="${level}" ${checked ? 'checked' : ''} ${customMode ? '' : 'disabled'} class="mt-0.5 h-4 w-4 rounded border-border-subtle text-primary focus:ring-primary">
                            <span class="min-w-0">
                                <span class="inline-flex items-center gap-2">
                                    <span class="difficulty-authoring__level-pill inline-flex items-center rounded-full bg-primary-lighter px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">L${level}</span>
                                    <span class="text-sm font-semibold text-text-main">Уровень ${level}</span>
                                </span>
                                <span class="block mt-1 text-xs text-text-secondary leading-relaxed">${this.escapeHtml(role)}</span>
                            </span>
                        </label>
                    `;
                }).join('')}
            </div>
            ${customMode && !selectedLevels.length ? `
                <div class="difficulty-authoring__warning rounded-xl border border-warning-light bg-warning-lighter px-3 py-2 text-xs text-warning-text">
                    Нужно оставить хотя бы один уровень, иначе задание нельзя будет сохранить.
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
            return;
        }

        let meta = null;
        try {
            meta = await this.loadDifficultyAuthoringMeta(this.task?.task_data, options);
        } catch (error) {
            console.warn('[BaseEditor] failed to load difficulty authoring meta', error);
            this.removeDifficultyAuthoringContainer();
            return;
        }

        this.syncDifficultyAuthoringStateFromTask(this.task?.task_data, meta);
        this.applyDifficultyAuthoringStateToTaskData(this.task?.task_data, meta);
        this.renderDifficultyAuthoringControls();
    }

    // ===== SAVING =====

    /**
     * Save task to backend
     * Child classes should implement validateTask() and buildTaskData()
     */
    async saveTask() {
        this.updateSaveStatus({ type: 'saving' });

        if (!this.task) {
            this.showToast("Задание не загружено", 'error');
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
                    message: 'Лимит заданий достигнут',
                    detail: 'Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.',
                });
                this.showToast('Лимит заданий достигнут. Черновик можно продолжать редактировать, но сохранить новый task.json пока нельзя.', 'warning');
            } else if (result.ok) {
                const semanticWarnings = this.getSemanticWarnings();
                if (!semanticWarnings.length) {
                    this.showToast("Задание сохранено", 'success');
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
                        message: 'Сохранено с предупреждениями',
                        detail: this.buildSemanticWarningsDetail(semanticWarnings)
                    });
                    this.showToast(this.buildSemanticWarningsToast(semanticWarnings), 'warning', 5200);
                }
            } else {
                this.showToast(result.error || "Ошибка сохранения", 'error');
            }
        } catch (error) {
            console.error("Error saving task:", error);
            this.showToast("Ошибка сети: " + error.message, 'error');
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
            const legacyIndicator = document.querySelector('.save-status');
            if (legacyIndicator && !container) {
                if (type === 'blocking') {
                    legacyIndicator.textContent = resolvedOptions.message || '! Требуется правка';
                    legacyIndicator.className = 'save-status unsaved text-xs font-bold text-error-dark';
                } else if (this.hasUnsavedChanges) {
                    legacyIndicator.textContent = 'Несохранено';
                    legacyIndicator.className = 'save-status unsaved text-xs font-bold text-warning-dark';
                } else {
                    legacyIndicator.textContent = 'Сохранено';
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
            saving: 'Сохранение...',
            dirty: 'Изменения не сохранены',
            saved: 'Сохранено',
            draft: 'Черновик сохранён',
            error: 'Ошибка сохранения',
            blocking: 'Действие заблокировано',
            warning: 'Сохранено с предупреждениями',
        };
        return messageMap[type] || 'Состояние обновлено';
    }

    getSaveStatusDetail(type = 'saved', options = {}) {
        if (type === 'draft' && options.time) {
            return `Локально: ${options.time}`;
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
            return 'Сохранено.';
        }
        const first = String(warnings[0] || '').trim();
        if (warnings.length === 1) {
            return `Сохранено, но проверьте: ${first}`;
        }
        return `Сохранено, но есть ${warnings.length} замечания. Сначала проверьте: ${first}`;
    }

    buildSemanticWarningsDetail(warnings = []) {
        if (!Array.isArray(warnings) || !warnings.length) {
            return '';
        }
        const first = String(warnings[0] || '').trim();
        if (warnings.length === 1) {
            return first;
        }
        return `${warnings.length} замечания. Первое: ${first}`;
    }

    /**
     * Toggle loading overlay
     * @param {boolean} show - Show or hide loading
     * @param {string} message - Loading message
     */
    toggleLoading(show, message = 'Загрузка...') {
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
                <h3 class="text-xl font-bold text-text-main mb-2">Ошибка загрузки</h3>
                <p class="text-text-secondary mb-6">${safeMessage}</p>
                <button onclick="window.navigateWithTransition ? window.navigateWithTransition('/ui/editor') : (window.location.href = '/ui/editor')" class="btn-secondary inline-flex w-full items-center justify-center gap-2">
                    <span class="material-symbols-outlined">arrow_back</span>
                    Вернуться в меню
                </button>
            </div>
        `;
        document.body.appendChild(overlay);
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
        title = this.escapeHtml(title || 'Подтверждение');
        message = this.escapeHtml(message || 'Вы уверены?');
        confirmText = this.escapeHtml(confirmText || 'Подтвердить');
        cancelText = this.escapeHtml(cancelText || 'Отмена');

        overlay.innerHTML = `
            <div class="bg-surface-1 rounded-2xl p-8 max-w-md w-full border border-border-subtle shadow-xl transform transition-all scale-100 animate-slide-up">
                <div class="mb-5 flex justify-center">
                    <span class="material-symbols-outlined text-4xl ${colorClass} p-4 bg-primary-lighter rounded-full">${icon}</span>
                </div>
                <h3 class="text-xl font-bold mb-3 text-text-main">${title || 'Подтверждение'}</h3>
                <p class="text-text-secondary mb-8 leading-relaxed">${message || 'Вы уверены?'}</p>
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
            ? 'Открыты несохранённые изменения'
            : 'Восстановлены несохранённые изменения';
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
                title: 'Вернуть несохранённые изменения?',
                message: draftTime
                    ? `На этом устройстве есть несохранённые изменения этой задачи от ${draftTime}. Они новее последней сохранённой версии${savedTime ? ` от ${savedTime}` : ''}. Что открыть?`
                    : `На этом устройстве есть несохранённые изменения этой задачи. Они новее последней сохранённой версии${savedTime ? ` от ${savedTime}` : ''}. Что открыть?`,
                confirmText: 'Вернуть изменения',
                cancelText: 'Открыть сохранённую версию',
            };
        }

        return {
            title: 'Вернуть несохранённые изменения?',
            message: draftTime
                ? `На этом устройстве есть несохранённые изменения этой задачи от ${draftTime}. Вернуть их и продолжить работу?`
                : 'На этом устройстве есть несохранённые изменения этой задачи. Вернуть их и продолжить работу?',
            confirmText: 'Вернуть изменения',
            cancelText: 'Не возвращать',
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

        title = this.escapeHtml(title || 'Подтверждение');
        message = this.escapeHtml(message || 'Вы уверены?');
        confirmText = this.escapeHtml(confirmText || 'Подтвердить');
        cancelText = this.escapeHtml(cancelText || 'Отмена');

        overlay.innerHTML = `
            <div class="card-elevated rounded-[24px] p-6 sm:p-7 max-w-lg w-full shadow-2xl transform transition-all scale-100 animate-slide-up" style="background: var(--color-surface-1);">
                <div class="mb-5 flex items-center gap-4 text-left">
                    <span class="material-symbols-outlined text-3xl sm:text-4xl ${theme.iconText} p-3 ${theme.iconBg} rounded-2xl">${theme.icon}</span>
                    <div class="min-w-0">
                        <h3 class="text-lg sm:text-xl font-bold text-text-main">${title || 'Подтверждение'}</h3>
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
            return 'Есть контекст отчёта';
        }
        if (String(meta?.aiRunId || '').trim() || meta?.sourceGrounding) {
            return 'Есть привязка к анализу';
        }
        if ((meta?.unitIds?.length || 0) || (meta?.chunkIds?.length || 0)) {
            return 'Есть выбранные привязки';
        }
        if (Array.isArray(warnings) && warnings.length) {
            return 'Есть замечания';
        }
        return 'Анализ не подключён';
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
                label: 'Есть контекст анализа',
                hint: 'Для этого редактора найден временный контекст анализа. Его можно посмотреть и при необходимости применить к задаче.',
            };
        }
        if (hasSavedLink) {
            return {
                label: 'Есть связь с анализом',
                hint: 'У этой задачи уже есть сохранённая связь с анализом теории. Можно открыть детали и проверить привязки.',
            };
        }
        if (hasWarnings) {
            return {
                label: 'Есть замечания анализа',
                hint: 'Для этой задачи есть замечания по связи с анализом. Откройте панель, чтобы посмотреть подробности.',
            };
        }
        return {
            label: 'Связь с анализом',
            hint: 'Открыть панель связи задания с анализом теории.',
        };
    }

    renderTheoryGroundingBeacon(taskMeta = null, bridge = null, warnings = []) {
        const meta = taskMeta || this._getTaskTheoryLinkMeta();
        const bridgeContext = bridge !== null ? bridge : this._readEditorTheoryBridgeContext();
        const shouldShow = this._hasTheoryGroundingContext(meta, bridgeContext) || Boolean(this.theoryGrounding?.panelOpen);
        let beacon = document.getElementById(this._theoryGroundingBeaconId());

        if (!shouldShow) {
            if (beacon) beacon.remove();
            return;
        }

        const saveStatus = document.getElementById('save-status-container');
        const saveButton = document.getElementById('save-task-btn');
        const host = saveStatus?.parentElement || saveButton?.parentElement || document.querySelector('header');
        if (!host) {
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
            window.navigateWithTransition('/ui/editor');
            return;
        }

        window.location.href = '/ui/editor';
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
        this.theoryGrounding.analysesError = '';
        this.renderTheoryGroundingPanel();
        try {
            const resp = await fetch('/api/editor/ai/analyses?limit=15');
            const data = await resp.json();
            if (data?.ok) {
                this.theoryGrounding.analyses = Array.isArray(data.items) ? data.items : [];
            } else {
                this.theoryGrounding.analyses = [];
                this.theoryGrounding.analysesError = data?.error || data?.message || this.aiUxMessage('p8.analysis.list_load_failed', 'Не удалось загрузить список анализов. Можно повторить позже.');
            }
        } catch (_) {
            this.theoryGrounding.analyses = [];
            this.theoryGrounding.analysesError = this.aiUxMessage('p8.analysis.list_load_failed', 'Не удалось загрузить список анализов. Можно повторить позже.');
        } finally {
            this.theoryGrounding.analysesLoading = false;
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
                this.theoryGrounding.analysisError = '';
                this._hydrateTheorySelectionsFromTaskMetaAndBridge();
                await this.refreshTheoryGroundingCoverage();
                if (!silent) this.showToast(this.aiUxMessage('p8.analysis.loaded', 'Анализ открыт для ручной привязки.'), 'success');
            } else {
                this.theoryGrounding.analysisData = null;
                this.theoryGrounding.coverageData = null;
                this.theoryGrounding.analysisError = data?.error || data?.message || this.aiUxMessage('p8.analysis.open_failed', 'Не удалось открыть анализ. Можно выбрать другой или продолжить без него.');
                if (!silent) this.showToast(this.theoryGrounding.analysisError, 'warning');
            }
        } catch (_) {
            this.theoryGrounding.analysisData = null;
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
        this.theoryGrounding.selectedRunId = rid || null;
        this._syncTheoryGroundingRunPrefsState(rid);
        this.theoryGrounding.analysisData = null;
        this.theoryGrounding.coverageData = null;
        this.theoryGrounding.analysisError = '';
        this.theoryGrounding.coverageError = '';
        this.renderTheoryGroundingPanel();
        if (rid) this.openTheoryGroundingAnalysis(rid).catch(() => {});
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
            ? 'Анализ помечен как низкое доверие. Подсказки будут подаваться мягче.'
            : 'Для анализа установлен обычный уровень доверия.';
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
            this.showToast(this.aiUxMessage('p8.bridge.context_not_found', 'Контекст из отчёта не найден. Можно выбрать анализ вручную.'), 'warning');
            return;
        }
        const rid = String(bridge.ai_run_id || '').trim();
        const refs = (bridge.refs && typeof bridge.refs === 'object') ? bridge.refs : {};
        this.theoryGrounding.selectedUnitIds = new Set(this._normalizeIntIdList(refs.unit_ids));
        this.theoryGrounding.selectedChunkIds = new Set(this._normalizeStrIdList(refs.chunk_ids));
        if (rid) this.theoryGrounding.selectedRunId = rid;
        this._syncTheoryGroundingRunPrefsState(rid);
        this.renderTheoryGroundingPanel();
        this.showToast(this.aiUxMessage('p8.bridge.context_loaded', 'Контекст отчёта загружен в панель связи с анализом.'), 'info');
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
            warnings.push(this.aiUxMessage('p8.soft.bridge_refs_available', 'В контексте отчёта уже есть готовые привязки. Их можно применить в один клик.'));
        }
        return warnings;
    }

    renderTheoryGroundingPanel() {
        this._ensureTheoryGroundingSets();

        const state = this.theoryGrounding;
        const bridge = this._readEditorTheoryBridgeContext();
        state.bridgeContext = bridge;
        const taskMeta = this._getTaskTheoryLinkMeta();
        const selectedRunId = String(state.selectedRunId || '').trim();
        const analysis = state.analysisData && typeof state.analysisData === 'object' ? state.analysisData : null;
        const units = Array.isArray(analysis?.educational_units) ? analysis.educational_units : [];
        const chunks = Array.isArray(analysis?.learning_chunks) ? analysis.learning_chunks : [];
        const coverage = state.coverageData && typeof state.coverageData === 'object' ? state.coverageData : null;
        const summary = coverage?.summary || {};
        const currentRow = this._theoryGroundingCurrentTaskCoverageRow();
        const prefs = this._syncTheoryGroundingRunPrefsState(selectedRunId);
        const coverageIgnored = prefs.ignoreCoverage;
        const trustLevel = prefs.trustLevel;
        const warnings = this._computeTheoryGroundingWarnings();
        const hasWarning = warnings.length > 0;
        const hasContext = this._hasTheoryGroundingContext(taskMeta, bridge);
        let panel = document.getElementById(this._theoryGroundingContainerId());

        this.renderTheoryGroundingBeacon(taskMeta, bridge, warnings);

        if (!hasContext && !state.panelOpen) {
            if (panel) panel.remove();
            return;
        }

        const analysisOptions = (Array.isArray(state.analyses) ? state.analyses : []).map((row) => {
            const rid = String(row?.ai_run_id || '').trim();
            if (!rid) return '';
            const selected = rid === selectedRunId ? 'selected' : '';
            const label = `${row?.source_file_name || row?.human_summary || rid} (${row?.units_count || 0} разделов / ${row?.learning_chunks_count || 0} фрагментов)`;
            return `<option value="${this.escapeHtml(rid)}" ${selected}>${this.escapeHtml(label)}</option>`;
        }).join('');

        const unitSelector = units.length ? `
            <div class="max-h-28 overflow-y-auto rounded-lg border border-border-subtle bg-surface-1 p-2 space-y-1">
                ${units.slice(0, 24).map((u) => {
                    const uid = Number.parseInt(u?.id, 10);
                    if (!Number.isFinite(uid)) return '';
                    const checked = state.selectedUnitIds.has(uid) ? 'checked' : '';
                    return `
                        <label class="flex items-start gap-2 text-[11px] text-text-main">
                            <input type="checkbox" ${checked} onchange="window.editor && window.editor.toggleTheoryGroundingUnit(${uid}, this.checked)" class="mt-0.5 text-primary focus:ring-primary">
                            <span><span class="font-semibold">#${uid}</span> ${this.escapeHtml(u?.title || 'Раздел')}</span>
                        </label>
                    `;
                }).join('')}
                ${units.length > 24 ? `<div class="text-[10px] text-text-secondary">Показаны первые 24/${units.length}</div>` : ''}
            </div>` : '<div class="text-[11px] text-text-secondary">Выберите анализ, чтобы увидеть список разделов.</div>';

        const chunkSelector = chunks.length ? `
            <div class="max-h-24 overflow-y-auto rounded-lg border border-border-subtle bg-surface-1 p-2 space-y-1">
                ${chunks.slice(0, 20).map((c) => {
                    const cid = String(c?.id || '').trim();
                    if (!cid) return '';
                    const checked = state.selectedChunkIds.has(cid) ? 'checked' : '';
                    return `
                        <label class="flex items-start gap-2 text-[11px] text-text-main">
                            <input type="checkbox" ${checked} onchange="window.editor && window.editor.toggleTheoryGroundingChunk('${this.escapeHtml(cid)}', this.checked)" class="mt-0.5 text-primary focus:ring-primary">
                            <span><span class="font-semibold">${this.escapeHtml(cid)}</span> ${this.escapeHtml(c?.title || '')}</span>
                        </label>
                    `;
                }).join('')}
                ${chunks.length > 20 ? `<div class="text-[10px] text-text-secondary">Показаны первые 20/${chunks.length}</div>` : ''}
            </div>` : '<div class="text-[11px] text-text-secondary">Фрагменты пока недоступны или анализ ещё не выбран.</div>';

        if (!state.panelOpen) {
            if (panel) panel.remove();
            return;
        }

        if (!panel) {
            panel = document.createElement('section');
            panel.id = this._theoryGroundingContainerId();
            document.body.appendChild(panel);
        }

        panel.className = `fixed z-40 bottom-4 right-4 w-[min(28rem,calc(100vw-1rem))] max-h-[72vh] overflow-hidden rounded-xl border shadow-2xl ${hasWarning ? 'border-warning-light bg-warning-lighter' : 'border-border-subtle bg-surface-1'}`;
        panel.innerHTML = `
            <div class="p-3 border-b border-border-subtle bg-surface-1">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] ${hasWarning ? 'text-warning-text' : 'text-primary'}">hub</span>
                            <div class="text-sm font-bold text-text-main">Связь с анализом</div>
                            <span class="px-1.5 py-0.5 rounded-md border text-[10px] ${hasWarning ? 'border-warning-light bg-warning-light text-warning-text' : 'border-success-light bg-success-light text-success-text'}">
                                ${hasWarning ? 'есть замечания' : 'активно'}
                            </span>
                        </div>
                        <div class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(this.moduleId || '?')}/${this.escapeHtml(this.topicId || '?')}/${this.escapeHtml(this.taskId || '?')}</div>
                    </div>
                    <button type="button" onclick="window.editor && window.editor.toggleTheoryGroundingPanel(false)" class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-subtle bg-surface-2 text-text-secondary hover:bg-bg-hover" aria-label="Закрыть панель связи с анализом">
                        <span class="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    ${taskMeta.aiRunId ? `<span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">анализ задачи: ${this.escapeHtml(taskMeta.aiRunId)}</span>` : ''}
                    <span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">разделы: ${taskMeta.unitIds.length}</span>
                    <span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">фрагменты: ${taskMeta.chunkIds.length}</span>
                    ${taskMeta.sourceGrounding?.score != null ? `<span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">оценка привязки: ${(Number(taskMeta.sourceGrounding.score) || 0).toFixed(2)}</span>` : ''}
                </div>
                ${bridge?.ai_run_id ? `
                    <div class="mt-2 p-2 rounded-lg border border-info-light bg-info-lighter">
                        <div class="text-[11px] text-info-text">Контекст из отчёта: <span class="font-mono">${this.escapeHtml(String(bridge.ai_run_id))}</span>${bridge?.source_block?.title ? ` · ${this.escapeHtml(bridge.source_block.title)}` : ''}</div>
                        <button type="button" onclick="window.editor && window.editor.applyTheoryBridgeContextToTask()" class="mt-1 px-2 py-1 rounded-md border border-info-light bg-info-light text-info-text text-[11px] hover:opacity-90">Применить привязки из отчёта</button>
                    </div>
                ` : ''}
            </div>

            <div class="max-h-[58vh] overflow-y-auto p-3 space-y-3 bg-surface-1">
                ${warnings.length ? `<div class="rounded-lg border border-warning-light bg-warning-lighter p-2"><div class="text-[11px] font-semibold text-warning-text mb-1">Подсказки анализа</div>${warnings.slice(0, 4).map(w => `<div class="text-[11px] text-warning-text">• ${this.escapeHtml(w)}</div>`).join('')}</div>` : ''}

                <div class="rounded-lg border border-border-subtle bg-surface-2 p-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">Выбор анализа</div>
                        <button type="button" onclick="window.editor && window.editor.loadTheoryGroundingAnalyses()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:bg-bg-hover">${state.analysesLoading ? '...' : 'Обновить'}</button>
                    </div>
                    <select onchange="window.editor && window.editor.setTheoryGroundingSelectedRun(this.value)" class="w-full rounded-lg border-border-subtle bg-surface-1 py-2 px-2 text-xs text-text-main focus:ring-2 focus:ring-primary">
                        <option value="">Выберите анализ...</option>
                        ${analysisOptions}
                    </select>
                    ${state.analysisLoading ? `<div class="text-[11px] text-text-secondary">Загрузка анализа...</div>` : ''}
                    ${state.analysesError ? `<div class="text-[11px] text-warning-text">${this.escapeHtml(state.analysesError)}</div>` : ''}
                    ${state.analysisError ? `<div class="text-[11px] text-warning-text">${this.escapeHtml(state.analysisError)}</div>` : ''}
                    <div class="rounded-lg border border-border-subtle bg-surface-1 p-2 space-y-2">
                        <div class="text-[11px] font-semibold text-text-secondary">Уровень доверия к анализу</div>
                        <select onchange="window.editor && window.editor.setTheoryGroundingTrustLevel(this.value)" ${selectedRunId ? '' : 'disabled'} class="w-full rounded-lg border-border-subtle bg-surface-2 py-1.5 px-2 text-[11px] text-text-main focus:ring-2 focus:ring-primary disabled:opacity-50">
                            <option value="normal" ${trustLevel === 'normal' ? 'selected' : ''}>${this.escapeHtml(this.aiUxMessage('p8.trust.normal_label', 'Обычное доверие'))}</option>
                            <option value="low_trust" ${trustLevel === 'low_trust' ? 'selected' : ''}>${this.escapeHtml(this.aiUxMessage('p8.trust.low_trust_label', 'Низкое доверие'))}</option>
                        </select>
                        <div class="text-[11px] text-text-secondary">${this.escapeHtml(this.aiUxMessage(trustLevel === 'low_trust' ? 'p8.trust.low_trust_hint' : 'p8.trust.normal_hint', trustLevel === 'low_trust' ? 'Используйте этот анализ выборочно: данные о покрытии и замечания могут быть особенно неточными.' : 'Используйте данные о покрытии и замечания как рабочие подсказки.'))}</div>
                    </div>
                </div>

                <div class="rounded-lg border border-border-subtle bg-surface-2 p-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">Привязка разделов и фрагментов</div>
                        <div class="flex gap-1">
                            <button type="button" onclick="window.editor && window.editor.clearTheoryGroundingSelections()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:bg-bg-hover">Сброс</button>
                            <button type="button" onclick="window.editor && window.editor.applyTheoryGroundingSelectionsToTask()" class="px-2 py-1 rounded-md border border-primary bg-primary text-primary-fg text-[11px] hover:bg-primary-dark">Применить</button>
                        </div>
                    </div>
                    <div>
                        <div class="text-[11px] font-semibold text-text-secondary mb-1">Разделы (${state.selectedUnitIds.size})</div>
                        ${unitSelector}
                    </div>
                    <div>
                        <div class="text-[11px] font-semibold text-text-secondary mb-1">Фрагменты (${state.selectedChunkIds.size})</div>
                        ${chunkSelector}
                    </div>
                </div>

                <div class="rounded-lg border border-border-subtle bg-surface-2 p-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">Покрытие по теме</div>
                        <button type="button" onclick="window.editor && window.editor.refreshTheoryGroundingCoverage()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:bg-bg-hover">${state.coverageLoading ? '...' : 'Обновить'}</button>
                    </div>
                    <label class="flex items-start gap-2 text-[11px] text-text-secondary">
                        <input type="checkbox" ${coverageIgnored ? 'checked' : ''} ${selectedRunId ? '' : 'disabled'} onchange="window.editor && window.editor.toggleTheoryGroundingCoverageIgnored(this.checked)" class="mt-0.5 text-primary focus:ring-primary disabled:opacity-50">
                        <span>Не учитывать этот анализ в покрытии темы</span>
                    </label>
                    ${coverageIgnored ? `<div class="rounded-lg border border-info-light bg-info-lighter p-2 text-[11px] text-info-text">${this.escapeHtml(this.aiUxMessage('p8.coverage.ignored_for_topic', 'Покрытие для этого анализа скрыто в этой теме. Это не влияет на работу редактора.'))}</div>` : ''}
                    ${state.coverageError ? `<div class="text-[11px] text-warning-text">${this.escapeHtml(state.coverageError)}</div>` : ''}
                    ${!coverageIgnored && coverage ? `
                        <div class="grid grid-cols-2 gap-2 text-[11px]">
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">С привязкой: <span class="font-semibold text-text-main">${summary.tasks_linked_in_scope || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Без привязки: <span class="font-semibold ${summary.tasks_without_links ? 'text-warning-text' : 'text-text-main'}">${summary.tasks_without_links || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Пропуски разделов: <span class="font-semibold ${summary.units_uncovered ? 'text-warning-text' : 'text-text-main'}">${summary.units_uncovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Повторы разделов: <span class="font-semibold ${summary.units_overcovered ? 'text-warning-text' : 'text-text-main'}">${summary.units_overcovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Пропуски фрагментов: <span class="font-semibold ${summary.chunks_uncovered ? 'text-warning-text' : 'text-text-main'}">${summary.chunks_uncovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Слабая привязка: <span class="font-semibold ${summary.weak_grounding_tasks ? 'text-warning-text' : 'text-text-main'}">${summary.weak_grounding_tasks || 0}</span></div>
                        </div>
                        ${currentRow ? `<div class="text-[11px] text-text-secondary">Текущая задача: область=${this.escapeHtml(currentRow.analysis_scope || 'не указана')} · разделов=${(currentRow.educational_unit_ids || []).length} · фрагментов=${(currentRow.analysis_chunk_ids || []).length}${currentRow.weak_grounding ? ' · привязка требует проверки' : ''}</div>` : ''}
                    ` : (!coverageIgnored ? `<div class="text-[11px] text-text-secondary">${this.escapeHtml(this.aiUxMessage('p8.coverage.not_loaded_yet', 'Данные о покрытии появятся после выбора анализа.'))}</div>` : '')}
                </div>
            </div>
        `;
    }

    // ===== NAVIGATION =====

    /**
     * Navigate back to dashboard
     */
    goBack() {
        if (this.hasUnsavedChanges) {
            this.showConfirmModal({
                title: 'Несохранённые изменения',
                message: 'У вас есть несохранённые изменения. Вы уверены, что хотите выйти без сохранения?',
                confirmText: 'Выйти',
                cancelText: 'Остаться',
                onConfirm: () => {
                    this.hasUnsavedChanges = false;
                    window.removeEventListener('beforeunload', this._beforeUnloadHandler);
                    window.navigateWithTransition('/ui/editor');
                }
            });
            return;
        }
        window.navigateWithTransition('/ui/editor');
    }

    /**
     * Setup beforeunload warning for unsaved changes
     */
    setupBeforeUnloadWarning() {
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
                ? 'Отменить (Ctrl+Z)'
                : 'Нет действий для отмены';
        }

        if (redoBtn) {
            redoBtn.disabled = !this.undoManager.canRedo();
            redoBtn.title = this.undoManager.canRedo()
                ? 'Повторить (Ctrl+Y)'
                : 'Нет действий для повтора';
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
}
