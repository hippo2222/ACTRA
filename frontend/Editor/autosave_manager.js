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
            const taskMeta = this.editor.task?.metadata || {};
            const taskDataMeta = this.editor.task?.task_data?.meta || {};
            const ownerUserId = this.getDraftOwnerUserId();
            const draft = {
                taskId: this.editor.taskId,
                moduleId: this.editor.moduleId,
                topicId: this.editor.topicId,
                taskName: taskMeta.name || this.editor.taskId || '',
                moduleName: taskDataMeta.module_name || taskMeta.module_name || '',
                topicName: taskDataMeta.topic_name || taskMeta.topic_name || '',
                taskType: this.editor.task?.task_data?.type || this.editor.taskTypeParam || '',
                timestamp: Date.now(),
                data: this.editor.captureState()
            };
            if (ownerUserId) {
                draft.ownerUserId = ownerUserId;
            }

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
                    const taskMeta = this.editor.task?.metadata || {};
                    const taskDataMeta = this.editor.task?.task_data?.meta || {};
                    const ownerUserId = this.getDraftOwnerUserId();
                    const draft = {
                        taskId: this.editor.taskId,
                        moduleId: this.editor.moduleId,
                        topicId: this.editor.topicId,
                        taskName: taskMeta.name || this.editor.taskId || '',
                        moduleName: taskDataMeta.module_name || taskMeta.module_name || '',
                        topicName: taskDataMeta.topic_name || taskMeta.topic_name || '',
                        taskType: this.editor.task?.task_data?.type || this.editor.taskTypeParam || '',
                        timestamp: Date.now(),
                        data: this.editor.captureState()
                    };
                    if (ownerUserId) {
                        draft.ownerUserId = ownerUserId;
                    }
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
            const draft = this.findLatestDraft();
            if (draft) return draft;
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
            this.getDraftKeys().forEach((key) => {
                localStorage.removeItem(key);
            });
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
        if (!draft || !draft.timestamp) return false;

        const draftTs = this.normalizeTimestamp(draft.timestamp);
        const savedTs = this.normalizeTimestamp(lastSavedTimestamp);

        return draftTs > savedTs;
    }

    normalizeTimestamp(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value;
        }

        if (typeof value === 'string' && value.trim()) {
            const asNumber = Number(value);
            if (Number.isFinite(asNumber)) {
                return asNumber;
            }

            const parsed = Date.parse(value);
            if (!Number.isNaN(parsed)) {
                return parsed;
            }
        }

        return 0;
    }

    /**
     * Clear old drafts (>7 days)
     */
    clearOldDrafts() {
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const ownerUserId = this.getDraftOwnerUserId();
        const scopedPrefix = ownerUserId
            ? `${this.storageKey}_v2_${encodeURIComponent(ownerUserId)}_`
            : null;

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const isScopedKey = Boolean(scopedPrefix && key && key.startsWith(scopedPrefix));
                const isLegacyKey = Boolean(
                    !ownerUserId && key && key.startsWith('task_draft_') && !key.startsWith('task_draft_v2_')
                );
                if (isScopedKey || isLegacyKey) {
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
            const blockingState = typeof this.editor?.getBlockingEditorState === 'function'
                ? this.editor.getBlockingEditorState()
                : null;
            if (blockingState) {
                this.editor.updateSaveStatus({
                    type: 'blocking',
                    message: blockingState.message || '! Требуется правка',
                    detail: blockingState.draftDetail || blockingState.detail || '',
                });
                if (typeof this.editor?.notifyBlockingDraftSaved === 'function') {
                    this.editor.notifyBlockingDraftSaved(blockingState);
                }
                return;
            }
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
        return this.getDraftKeyForTaskId(this.editor.taskId, this.getDraftOwnerUserId());
    }

    getDraftTaskIds() {
        if (typeof this.editor?.getDraftTaskIds === 'function') {
            const ids = this.editor.getDraftTaskIds();
            if (Array.isArray(ids) && ids.length) {
                return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
            }
        }

        return [String(this.editor?.taskId || '').trim()].filter(Boolean);
    }

    getDraftOwnerUserId() {
        const metadata = this.editor?.task?.metadata || {};
        const taskDataMeta = this.editor?.task?.task_data?.meta || {};
        return String(
            metadata.created_by_user_id
            || metadata.createdByUserId
            || taskDataMeta.created_by_user_id
            || taskDataMeta.createdByUserId
            || ''
        ).trim();
    }

    getLegacyDraftKeyForTaskId(taskId) {
        return `${this.storageKey}_${this.editor.moduleId}_${this.editor.topicId}_${taskId}`;
    }

    getDraftKeyForTaskId(taskId, ownerUserId = '') {
        const normalizedOwnerUserId = String(ownerUserId || '').trim();
        if (!normalizedOwnerUserId) {
            return this.getLegacyDraftKeyForTaskId(taskId);
        }
        return `${this.storageKey}_v2_${encodeURIComponent(normalizedOwnerUserId)}_${this.editor.moduleId}_${this.editor.topicId}_${taskId}`;
    }

    getDraftKeys() {
        const moduleId = String(this.editor?.moduleId || '').trim();
        const topicId = String(this.editor?.topicId || '').trim();
        if (!moduleId || !topicId) return [];

        const ownerUserId = this.getDraftOwnerUserId();
        return this.getDraftTaskIds().map((taskId) => this.getDraftKeyForTaskId(taskId, ownerUserId));
    }

    findLatestDraft() {
        const candidates = [];

        this.getDraftKeys().forEach((key) => {
            const draftJson = localStorage.getItem(key);
            if (!draftJson) return;

            try {
                const parsed = JSON.parse(draftJson);
                if (parsed) {
                    candidates.push(parsed);
                }
            } catch (error) {
                console.warn('Failed to parse draft candidate:', error);
            }
        });

        candidates.sort((left, right) => this.normalizeTimestamp(right?.timestamp) - this.normalizeTimestamp(left?.timestamp));
        return candidates[0] || null;
    }
}
