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
                this.showToast('Черновик успешно восстановлен', 'success');
                this.autoSaveManager.start();
            },
            onCancel: () => {
                this.autoSaveManager.clearDraft();
                this.onTaskLoaded();
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
                this.showToast("Задание сохранено", 'success');
                this.markSaved();

                // Clear draft after successful save
                if (this.autoSaveManager) {
                    this.autoSaveManager.clearDraft();
                }

                this.onTaskSaved(); // Hook for child classes
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
     * Handles multiple states: saving, saved, dirty, draft, error
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
        }
    }

    // ===== UI NOTIFICATIONS =====

    /**
     * Show toast notification
     * @param {string} message - Message to display
     * @param {string} variant - Variant: 'success', 'error', 'warning', 'info'
     * @param {number} timeout - Timeout in milliseconds (default: 4000)
     */
    showToast(message, variant = 'info', timeout = 4000) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${variant}`;
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
                overlay.innerHTML = `
                    <div class="loading-spinner"></div>
                    <div class="loading-message">${message}</div>
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

        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-50 bg-bg-main backdrop-blur flex flex-col items-center justify-center p-6 text-center animate-fade-in';
        overlay.innerHTML = `
            <div class="bg-error-light rounded-2xl p-8 max-w-md w-full border border-error-light shadow-xl">
                <span class="material-symbols-outlined text-4xl text-error mb-4">error</span>
                <h3 class="text-xl font-bold text-text-main mb-2">Ошибка загрузки</h3>
                <p class="text-text-secondary mb-6">${message}</p>
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

        const cleanup = () => {
            overlay.classList.add('opacity-0');
            // Allow animation to finish
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            }, 300);
        };

        confirmBtn.onclick = () => {
            cleanup();
            if (onConfirm) onConfirm();
        };

        cancelBtn.onclick = () => {
            cleanup();
            if (onCancel) onCancel();
        };
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
