/**
 * Automatic Draft Saving Manager
 * Saves editor state to localStorage periodically
 */
class AutoSaveManager {
    constructor(editor, options = {}) {
        this.editor = editor;
        this.interval = options.interval || 30000; // 30 seconds
        this.storageKey = 'task_draft';
        this.timer = null;
        this.enabled = true;
        this.lastSaveTime = null;
    }

    /**
     * Start autosave timer
     */
    start() {
        if (this.timer) return; // Already running

        this.timer = setInterval(() => {
            if (this.enabled && this.editor.hasUnsavedChanges) {
                this.saveDraft();
            }
        }, this.interval);

        console.log(`AutoSave started (interval: ${this.interval}ms)`);
    }

    /**
     * Stop autosave timer
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('AutoSave stopped');
        }
    }

    /**
     * Save draft to localStorage
     */
    saveDraft() {
        if (typeof this.editor.captureState !== 'function') {
            console.warn('AutoSaveManager: editor does not implement captureState(), skipping save.');
            return;
        }
        try {
            const draft = {
                taskId: this.editor.taskId,
                moduleId: this.editor.moduleId,
                topicId: this.editor.topicId,
                timestamp: Date.now(),
                data: this.editor.captureState()
            };

            const key = this.getDraftKey();
            localStorage.setItem(key, JSON.stringify(draft));

            this.lastSaveTime = draft.timestamp;
            this.updateAutosaveIndicator();

            console.log(`Draft saved at ${new Date(draft.timestamp).toLocaleTimeString()}`);
        } catch (error) {
            console.error('Failed to save draft:', error);

            // Handle quota exceeded
            if (error.name === 'QuotaExceededError') {
                console.warn('localStorage quota exceeded, clearing old drafts');
                this.clearOldDrafts();
                // Try one more time after cleanup
                try {
                    const draft = {
                        taskId: this.editor.taskId,
                        moduleId: this.editor.moduleId,
                        topicId: this.editor.topicId,
                        timestamp: Date.now(),
                        data: this.editor.captureState()
                    };
                    localStorage.setItem(this.getDraftKey(), JSON.stringify(draft));
                    this.lastSaveTime = draft.timestamp;
                    this.updateAutosaveIndicator();
                } catch (retryError) {
                    console.error('Failed to save draft after cleanup:', retryError);
                    this.reportSaveFailure('Draft save failed');
                }
            } else {
                this.reportSaveFailure('Draft save failed');
            }
        }
    }

    /**
     * Load draft from localStorage
     * @returns {Object|null} Draft or null
     */
    loadDraft() {
        try {
            const key = this.getDraftKey();
            const draftJson = localStorage.getItem(key);

            if (draftJson) {
                return JSON.parse(draftJson);
            }
        } catch (error) {
            console.error('Failed to load draft:', error);
        }
        return null;
    }

    /**
     * Clear current draft
     */
    clearDraft() {
        try {
            const key = this.getDraftKey();
            localStorage.removeItem(key);
            this.lastSaveTime = null;
            this.updateAutosaveIndicator();
            console.log('Draft cleared');
        } catch (error) {
            console.error('Failed to clear draft:', error);
        }
    }

    /**
     * Check if draft is fresher than server version
     * @param {number} lastSavedTimestamp - Server save time
     * @returns {boolean}
     */
    hasFresherDraft(lastSavedTimestamp) {
        const draft = this.loadDraft();
        return draft && draft.timestamp > lastSavedTimestamp;
    }

    /**
     * Clear old drafts (>7 days)
     */
    clearOldDrafts() {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && key.startsWith('task_draft_')) {
                    try {
                        const draft = JSON.parse(localStorage.getItem(key));
                        if (draft.timestamp < sevenDaysAgo) {
                            localStorage.removeItem(key);
                            console.log(`Cleared old draft: ${key}`);
                        }
                    } catch (e) {
                        // Invalid draft, remove it
                        localStorage.removeItem(key);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to clear old drafts:', error);
        }
    }

    /**
     * Update autosave indicator UI
     */
    updateAutosaveIndicator() {
        if (this.lastSaveTime) {
            const time = new Date(this.lastSaveTime).toLocaleTimeString();
            this.editor.updateSaveStatus({
                type: 'draft',
                message: 'Черновик сохранен',
                time: time
            });
        }
    }

    reportSaveFailure(message = 'Draft save failed') {
        if (typeof this.editor?.updateSaveStatus === 'function') {
            this.editor.updateSaveStatus({
                type: 'error',
                message
            });
        }
    }

    getDraftKey() {
        return `${this.storageKey}_${this.editor.moduleId}_${this.editor.topicId}_${this.editor.taskId}`;
    }
}
