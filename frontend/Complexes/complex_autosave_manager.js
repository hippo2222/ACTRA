/**
 * AutoSave Manager for Create/Edit Complex Page
 * Maintains draft state in localStorage
 */

class ComplexAutoSaveManager {
    constructor(callbacks, options = {}) {
        this.callbacks = callbacks; // { captureState, restoreState, updateStatus }
        this.interval = options.interval || 30000; // 30 seconds
        this.timer = null;
        this.enabled = true;
        this.lastSaveTime = null;
        this.currentComplexId = options.complexId || 'new';
    }

    start() {
        if (this.timer) return;

        // Initial save capability check
        if (typeof this.callbacks.captureState !== 'function') {
            console.error('ComplexAutoSaveManager: captureState callback missing');
            return;
        }

        this.timer = setInterval(() => {
            if (this.enabled) {
                this.saveDraft();
            }
        }, this.interval);

        console.log(`AutoSave started (interval: ${this.interval}ms)`);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('AutoSave stopped');
        }
    }

    getDraftKey() {
        return `complex_draft_${this.currentComplexId}`;
    }

    parseDraft(rawDraft, fallbackId = 'new') {
        if (!rawDraft || typeof rawDraft !== 'object') return null;
        const id = String(rawDraft.id || fallbackId || 'new');
        const timestamp = Number(rawDraft.timestamp || 0);
        return {
            id,
            timestamp: Number.isFinite(timestamp) ? timestamp : 0,
            data: rawDraft.data || null,
        };
    }

    saveDraft() {
        try {
            const state = this.callbacks.captureState();
            if (!state) return; // Nothing to save

            const draft = {
                id: this.currentComplexId,
                timestamp: Date.now(),
                data: state
            };

            localStorage.setItem(this.getDraftKey(), JSON.stringify(draft));
            this.lastSaveTime = draft.timestamp;

            this.updateStatus();
            console.log(`Draft saved for ${this.currentComplexId} at ${new Date(draft.timestamp).toLocaleTimeString()}`);
        } catch (error) {
            console.error('Failed to save complex draft:', error);
            if (this.callbacks.updateStatus) {
                this.callbacks.updateStatus({
                    error: true,
                    message: 'Автосохранение не выполнено'
                });
            }
        }
    }

    loadDraft() {
        try {
            const json = localStorage.getItem(this.getDraftKey());
            if (!json) return null;
            const parsed = this.parseDraft(JSON.parse(json), this.currentComplexId);
            return parsed ? { ...parsed, key: this.getDraftKey() } : null;
        } catch (error) {
            console.error('Failed to load draft:', error);
            return null;
        }
    }

    loadDraftByKey(storageKey) {
        if (!storageKey || typeof storageKey !== 'string') return null;
        try {
            const json = localStorage.getItem(storageKey);
            if (!json) return null;
            const fallbackId = storageKey.replace(/^complex_draft_/, '') || 'new';
            const parsed = this.parseDraft(JSON.parse(json), fallbackId);
            return parsed ? { ...parsed, key: storageKey } : null;
        } catch (error) {
            console.error('Failed to load draft by key:', error);
            return null;
        }
    }

    clearDraft() {
        try {
            localStorage.removeItem(this.getDraftKey());
            this.lastSaveTime = null;
            if (this.callbacks.updateStatus) {
                this.callbacks.updateStatus(null);
            }
            console.log(`Draft cleared for ${this.currentComplexId}`);
        } catch (error) {
            console.error('Failed to clear draft:', error);
        }
    }

    clearDraftByKey(storageKey) {
        if (!storageKey || typeof storageKey !== 'string') return;
        try {
            localStorage.removeItem(storageKey);
            if (storageKey === this.getDraftKey()) {
                this.lastSaveTime = null;
                if (this.callbacks.updateStatus) {
                    this.callbacks.updateStatus(null);
                }
            }
            console.log(`Draft cleared by key: ${storageKey}`);
        } catch (error) {
            console.error('Failed to clear draft by key:', error);
        }
    }

    listDrafts() {
        const result = [];
        try {
            for (let i = 0; i < localStorage.length; i += 1) {
                const key = localStorage.key(i);
                if (!key || !key.startsWith('complex_draft_')) continue;
                const draft = this.loadDraftByKey(key);
                if (!draft || !draft.data) continue;
                result.push(draft);
            }
        } catch (error) {
            console.error('Failed to list drafts:', error);
        }

        result.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return result;
    }

    hasFresherDraft(serverTimestamp) {
        const draft = this.loadDraft();
        if (!draft) return false;
        // If no server timestamp provided (e.g. creating new), existence of draft is enough
        if (!serverTimestamp) return true;
        return draft.timestamp > serverTimestamp;
    }

    updateStatus() {
        if (this.callbacks.updateStatus && this.lastSaveTime) {
            this.callbacks.updateStatus({
                time: new Date(this.lastSaveTime).toLocaleTimeString(),
                message: 'Черновик сохранён'
            });
        }
    }
}
