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
        this.hasUnsavedChanges = false;

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
            taskId: params.get('task')
        };
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
                this.task = data.task;

                // Initialize autosave manager
                if (!this.autoSaveManager) {
                    this.autoSaveManager = new AutoSaveManager(this, { interval: 30000 });
                }

                // Check for fresher draft
                const lastSaved = this.task.task_data?.meta?.modified || 0;
                if (this.autoSaveManager.hasFresherDraft(lastSaved)) {
                    this.promptDraftRecovery();
                } else {
                    this.onTaskLoaded();
                    this.initTheoryGroundingPanel();
                    this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                    this.autoSaveManager.start(); // Start autosave
                }

                this.markSaved();
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
    promptDraftRecovery() {
        const draft = this.autoSaveManager.loadDraft();
        if (!draft) {
            this.onTaskLoaded();
            this.initTheoryGroundingPanel();
            this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
            this.autoSaveManager.start();
            return;
        }

        // Format date for display
        const date = new Date(draft.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        this.showConfirmModal({
            title: 'Найдена несохраненная копия',
            message: `Обнаружен автосохраненный черновик от ${date}. Хотите восстановить проделанную работу?`,
            confirmText: 'Да, восстановить',
            cancelText: 'Нет, загрузить заново',
            variant: 'primary',
            onConfirm: () => {
                this.restoreState(draft.data);
                this.initTheoryGroundingPanel();
                this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                this.showToast('Черновик успешно восстановлен', 'success');
                this.autoSaveManager.start();
            },
            onCancel: () => {
                this.autoSaveManager.clearDraft();
                this.onTaskLoaded();
                this.initTheoryGroundingPanel();
                this.bootstrapTheoryGroundingPanel().catch((e) => console.warn('[P8] bootstrap failed', e));
                this.autoSaveManager.start();
            }
        });
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

        try {
            const response = await fetch(
                `/api/editor/task/${this.moduleId}/${this.topicId}/${this.taskId}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(taskData)
                }
            );

            const result = await response.json();

            if (result.ok) {
                const semanticWarnings = this.getSemanticWarnings();
                if (!semanticWarnings.length) {
                    this.showToast("Задание сохранено", 'success');
                }
                this.markSaved();
                this.refreshTheoryGroundingCoverage().catch(() => {});
                this.renderTheoryGroundingPanel();

                // Clear draft after successful save
                if (this.autoSaveManager) {
                    this.autoSaveManager.clearDraft();
                }

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
        const type = options.type || (this.hasUnsavedChanges ? 'dirty' : 'saved');
        const container = document.getElementById('save-status-container') || document.getElementById('save-status');
        const dot = document.getElementById('save-status-indicator') || (container ? container.querySelector('.w-2.h-2') : null);
        const text = document.getElementById('save-status-text') || (container ? container.querySelector('[data-save-status-text]') : null);
        const detail = document.getElementById('save-status-detail');

        if (!container || !dot || !text) {
            // Fallback for older layouts or if elements not found
            const legacyIndicator = document.querySelector('.save-status');
            if (legacyIndicator && !container) {
                if (this.hasUnsavedChanges) {
                    legacyIndicator.textContent = 'Несохранено';
                    legacyIndicator.className = 'save-status unsaved text-xs font-bold text-warning-dark';
                } else {
                    legacyIndicator.textContent = 'Сохранено';
                    legacyIndicator.className = 'save-status saved text-xs font-bold text-success-dark';
                }
            }
            return;
        }

        // Reset classes
        dot.classList.remove('bg-success', 'bg-warning', 'bg-info', 'bg-error', 'animate-pulse');
        container.classList.remove('bg-success-light', 'bg-warning-light', 'bg-info-light', 'bg-error-light', 'border-success-light', 'border-warning-light', 'border-info-light', 'border-error-light');

        switch (type) {
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
                text.textContent = options.message || 'Сохранено в облаке';
                text.className = 'text-[11px] font-bold text-success-dark leading-none';
                if (detail) detail.classList.add('hidden');
                break;
            case 'draft':
                dot.classList.add('bg-success');
                text.textContent = options.message || 'Черновик сохранен';
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
                overlay.className = 'loading-overlay';
                const safeMessage = this.escapeHtml(message);
                overlay.innerHTML = `
                    <div class="loading-spinner"></div>
                    <div class="loading-message">${safeMessage}</div>
                `;
                document.body.appendChild(overlay);
            } else {
                overlay.querySelector('.loading-message').textContent = message;
                overlay.style.display = 'flex';
            }
        } else {
            if (overlay) {
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
        overlay.className = 'fixed inset-0 z-50 bg-bg-main backdrop-blur flex flex-col items-center justify-center p-6 text-center animate-fade-in';
        overlay.innerHTML = `
            <div class="bg-error-light rounded-2xl p-8 max-w-md w-full border border-error-light shadow-xl">
                <span class="material-symbols-outlined text-4xl text-error mb-4">error</span>
                <h3 class="text-xl font-bold text-text-main mb-2">Ошибка загрузки</h3>
                <p class="text-text-secondary mb-6">${safeMessage}</p>
                <button onclick="window.navigateWithTransition('/ui/editor')" class="w-full py-3 px-4 bg-surface-1 border border-border-subtle rounded-lg shadow-sm font-semibold text-text-main hover:bg-bg-hover transition-all flex items-center justify-center gap-2">
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
        title = this.escapeHtml(title || 'РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ');
        message = this.escapeHtml(message || 'Р’С‹ СѓРІРµСЂРµРЅС‹?');
        confirmText = this.escapeHtml(confirmText || 'РџРѕРґС‚РІРµСЂРґРёС‚СЊ');
        cancelText = this.escapeHtml(cancelText || 'РћС‚РјРµРЅР°');

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
        requestAnimationFrame(() => confirmBtn && confirmBtn.focus({ preventScroll: true }));
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
            return parsed && typeof parsed === 'object' ? parsed : null;
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
        let panel = document.getElementById(this._theoryGroundingContainerId());
        if (!panel) {
            panel = document.createElement('section');
            panel.id = this._theoryGroundingContainerId();
            panel.className = 'fixed z-40 bottom-4 right-4 w-[min(28rem,calc(100vw-1rem))] max-h-[72vh] overflow-hidden rounded-xl border border-border-subtle bg-surface-1 shadow-2xl';
            document.body.appendChild(panel);
        }
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
            const resp = await fetch('/api/editor/ai/analyses?limit=20');
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
            this.showToast(this.aiUxMessage('p8.coverage.ignored_toggle_on', 'Coverage для выбранного анализа скрыт в этой теме.'), 'info');
            this.renderTheoryGroundingPanel();
            return;
        }
        this.showToast(this.aiUxMessage('p8.coverage.ignored_toggle_off', 'Coverage для выбранного анализа снова включён в этой теме.'), 'info');
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
        this.showToast(this.aiUxMessage('p8.link.apply_success', 'Привязка unit/chunk обновлена. Сохраните задачу, когда будете готовы.'), 'success');
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
        this.showToast(this.aiUxMessage('p8.bridge.context_loaded', 'Контекст отчёта загружен в панель P8.'), 'info');
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
            warnings.push(this.aiUxMessage('p8.soft.no_links_ok', 'У задачи нет привязки к unit/chunk текущего анализа — это допустимо.'));
        }
        if (taskMeta.sourceGrounding && taskMeta.sourceGrounding.weak === true) {
            warnings.push(this.aiUxMessage('p8.soft.saved_weak_grounding', 'Сохранённая привязка выглядит слабой; при необходимости уточните unit/chunk вручную.'));
        }
        if (currentCoverageRow && currentCoverageRow.weak_grounding && trustLevel !== 'low_trust') {
            warnings.push(this.aiUxMessage('p8.soft.coverage_weak_grounding', 'Coverage для этой задачи указывает на слабую привязку к материалу. Проверьте вручную.'));
        }
        if (selectedRun && taskMeta.aiRunId && taskMeta.aiRunId !== selectedRun) {
            warnings.push(this.aiUxMessage('p8.soft.run_mismatch', 'Задача связана с другим анализом; в текущем coverage она может учитываться отдельно.'));
        }
        const bridgeRefs = bridge?.refs && typeof bridge.refs === 'object'
            ? (this._normalizeIntIdList(bridge.refs.unit_ids).length || this._normalizeStrIdList(bridge.refs.chunk_ids).length)
            : 0;
        if (bridgeRefs && !taskMeta.unitIds.length && !taskMeta.chunkIds.length) {
            warnings.push(this.aiUxMessage('p8.soft.bridge_refs_available', 'В контексте отчёта есть готовые refs. Их можно применить в один клик.'));
        }
        return warnings;
    }

    renderTheoryGroundingPanel() {
        const panel = document.getElementById(this._theoryGroundingContainerId());
        if (!panel) return;
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

        const analysisOptions = (Array.isArray(state.analyses) ? state.analyses : []).map((row) => {
            const rid = String(row?.ai_run_id || '').trim();
            if (!rid) return '';
            const selected = rid === selectedRunId ? 'selected' : '';
            const label = `${rid} · ${row?.units_count || 0}u/${row?.learning_chunks_count || 0}c`;
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
                            <span><span class="font-semibold">#${uid}</span> ${this.escapeHtml(u?.title || 'Unit')}</span>
                        </label>
                    `;
                }).join('')}
                ${units.length > 24 ? `<div class="text-[10px] text-text-secondary">Показаны первые 24/${units.length}</div>` : ''}
            </div>` : '<div class="text-[11px] text-text-secondary">Выберите анализ для списка units.</div>';

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
            </div>` : '<div class="text-[11px] text-text-secondary">Chunks недоступны (или анализ не выбран).</div>';

        panel.className = `fixed z-40 bottom-4 right-4 w-[min(28rem,calc(100vw-1rem))] max-h-[72vh] overflow-hidden rounded-xl border shadow-2xl ${hasWarning ? 'border-warning-light bg-warning-lighter' : 'border-border-subtle bg-surface-1'}`;
        panel.innerHTML = `
            <div class="p-3 border-b border-border-subtle bg-surface-1">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <div class="flex items-center gap-2">
                            <span class="material-symbols-outlined text-[18px] ${hasWarning ? 'text-warning-text' : 'text-primary'}">hub</span>
                            <div class="text-sm font-bold text-text-main">P8: Coverage / Grounding</div>
                            <span class="px-1.5 py-0.5 rounded-md border text-[10px] ${hasWarning ? 'border-warning-light bg-warning-light text-warning-text' : 'border-success-light bg-success-light text-success-text'}">
                                ${hasWarning ? 'warnings' : 'ok'}
                            </span>
                        </div>
                        <div class="text-[11px] text-text-secondary mt-1">${this.escapeHtml(this.moduleId || '?')}/${this.escapeHtml(this.topicId || '?')}/${this.escapeHtml(this.taskId || '?')}</div>
                    </div>
                    <button type="button" onclick="window.editor && window.editor.toggleTheoryGroundingPanel()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-2 text-xs text-text-secondary hover:bg-bg-hover">
                        ${state.panelOpen ? 'Свернуть' : 'P8'}
                    </button>
                </div>
                <div class="mt-2 flex flex-wrap gap-1">
                    ${taskMeta.aiRunId ? `<span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">task ai_run: ${this.escapeHtml(taskMeta.aiRunId)}</span>` : ''}
                    <span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">units: ${taskMeta.unitIds.length}</span>
                    <span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">chunks: ${taskMeta.chunkIds.length}</span>
                    ${taskMeta.sourceGrounding?.score != null ? `<span class="px-1.5 py-0.5 rounded border border-border-subtle bg-surface-2 text-[10px] text-text-secondary">grounding: ${(Number(taskMeta.sourceGrounding.score) || 0).toFixed(2)}</span>` : ''}
                </div>
                ${bridge?.ai_run_id ? `
                    <div class="mt-2 p-2 rounded-lg border border-info-light bg-info-lighter">
                        <div class="text-[11px] text-info-text">Контекст отчёта: <span class="font-mono">${this.escapeHtml(String(bridge.ai_run_id))}</span>${bridge?.source_block?.title ? ` · ${this.escapeHtml(bridge.source_block.title)}` : ''}</div>
                        <button type="button" onclick="window.editor && window.editor.applyTheoryBridgeContextToTask()" class="mt-1 px-2 py-1 rounded-md border border-info-light bg-info-light text-info-text text-[11px] hover:opacity-90">Применить refs из отчёта</button>
                    </div>
                ` : ''}
            </div>

            <div class="${state.panelOpen ? '' : 'hidden '}max-h-[58vh] overflow-y-auto p-3 space-y-3 bg-surface-1">
                ${warnings.length ? `<div class="rounded-lg border border-warning-light bg-warning-lighter p-2"><div class="text-[11px] font-semibold text-warning-text mb-1">Soft warnings</div>${warnings.slice(0, 4).map(w => `<div class="text-[11px] text-warning-text">• ${this.escapeHtml(w)}</div>`).join('')}</div>` : ''}

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
                        <div class="text-[11px] text-text-secondary">${this.escapeHtml(this.aiUxMessage(trustLevel === 'low_trust' ? 'p8.trust.low_trust_hint' : 'p8.trust.normal_hint', trustLevel === 'low_trust' ? 'Используйте этот анализ выборочно: coverage и warnings могут быть особенно неточными.' : 'Используйте coverage и warnings как рабочие подсказки.'))}</div>
                    </div>
                </div>

                <div class="rounded-lg border border-border-subtle bg-surface-2 p-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">Привязка unit/chunk</div>
                        <div class="flex gap-1">
                            <button type="button" onclick="window.editor && window.editor.clearTheoryGroundingSelections()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:bg-bg-hover">Сброс</button>
                            <button type="button" onclick="window.editor && window.editor.applyTheoryGroundingSelectionsToTask()" class="px-2 py-1 rounded-md border border-primary bg-primary text-primary-fg text-[11px] hover:bg-primary-dark">Применить</button>
                        </div>
                    </div>
                    <div>
                        <div class="text-[11px] font-semibold text-text-secondary mb-1">Units (${state.selectedUnitIds.size})</div>
                        ${unitSelector}
                    </div>
                    <div>
                        <div class="text-[11px] font-semibold text-text-secondary mb-1">Chunks (${state.selectedChunkIds.size})</div>
                        ${chunkSelector}
                    </div>
                </div>

                <div class="rounded-lg border border-border-subtle bg-surface-2 p-2 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-xs font-semibold text-text-main">Coverage по теме</div>
                        <button type="button" onclick="window.editor && window.editor.refreshTheoryGroundingCoverage()" class="px-2 py-1 rounded-md border border-border-subtle bg-surface-1 text-[11px] text-text-secondary hover:bg-bg-hover">${state.coverageLoading ? '...' : 'Refresh'}</button>
                    </div>
                    <label class="flex items-start gap-2 text-[11px] text-text-secondary">
                        <input type="checkbox" ${coverageIgnored ? 'checked' : ''} ${selectedRunId ? '' : 'disabled'} onchange="window.editor && window.editor.toggleTheoryGroundingCoverageIgnored(this.checked)" class="mt-0.5 text-primary focus:ring-primary disabled:opacity-50">
                        <span>Не использовать этот анализ для coverage в этой теме</span>
                    </label>
                    ${coverageIgnored ? `<div class="rounded-lg border border-info-light bg-info-lighter p-2 text-[11px] text-info-text">${this.escapeHtml(this.aiUxMessage('p8.coverage.ignored_for_topic', 'Coverage для этого анализа скрыт в этой теме. Это не влияет на работу редактора.'))}</div>` : ''}
                    ${state.coverageError ? `<div class="text-[11px] text-warning-text">${this.escapeHtml(state.coverageError)}</div>` : ''}
                    ${!coverageIgnored && coverage ? `
                        <div class="grid grid-cols-2 gap-2 text-[11px]">
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Linked: <span class="font-semibold text-text-main">${summary.tasks_linked_in_scope || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">No links: <span class="font-semibold ${summary.tasks_without_links ? 'text-warning-text' : 'text-text-main'}">${summary.tasks_without_links || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Unit gaps: <span class="font-semibold ${summary.units_uncovered ? 'text-warning-text' : 'text-text-main'}">${summary.units_uncovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Unit dupes: <span class="font-semibold ${summary.units_overcovered ? 'text-warning-text' : 'text-text-main'}">${summary.units_overcovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Chunk gaps: <span class="font-semibold ${summary.chunks_uncovered ? 'text-warning-text' : 'text-text-main'}">${summary.chunks_uncovered || 0}</span></div>
                            <div class="p-2 rounded border border-border-subtle bg-surface-1">Weak grounding: <span class="font-semibold ${summary.weak_grounding_tasks ? 'text-warning-text' : 'text-text-main'}">${summary.weak_grounding_tasks || 0}</span></div>
                        </div>
                        ${currentRow ? `<div class="text-[11px] text-text-secondary">Текущая задача: scope=${this.escapeHtml(currentRow.analysis_scope || 'n/a')} · units=${(currentRow.educational_unit_ids || []).length} · chunks=${(currentRow.analysis_chunk_ids || []).length}${currentRow.weak_grounding ? ' · weak' : ''}</div>` : ''}
                    ` : (!coverageIgnored ? `<div class="text-[11px] text-text-secondary">${this.escapeHtml(this.aiUxMessage('p8.coverage.not_loaded_yet', 'Coverage появится после выбора анализа.'))}</div>` : '')}
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
