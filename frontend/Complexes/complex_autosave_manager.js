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
        }
    }

    loadDraft() {
        try {
            const json = localStorage.getItem(this.getDraftKey());
            return json ? JSON.parse(json) : null;
        } catch (error) {
            console.error('Failed to load draft:', error);
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
                message: 'Черновик сохранен'
            });
        }
    }
}
