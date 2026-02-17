/**
 * Draft Storage Module
 * Manages answer drafts in localStorage to prevent data loss on network failures
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.DraftStorage = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const STORAGE_KEY_PREFIX = 'session_draft_';
    const DRAFT_EXPIRATION_MS = 24 * 60 * 60 * 1000; // 24 hours

    // Unique tab identifier to avoid localStorage conflicts between tabs
    const TAB_ID = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    /**
     * Generate storage key for a draft
     * @param {string} sessionId - Session ID
     * @param {string} taskId - Task ID
     * @returns {string} Storage key
     */
    function getDraftKey(sessionId, taskId) {
        return `${STORAGE_KEY_PREFIX}${sessionId}_${taskId}_${TAB_ID}`;
    }

    /**
     * Generate legacy key (without tab ID) for backward-compatible reads
     */
    function getLegacyDraftKey(sessionId, taskId) {
        return `${STORAGE_KEY_PREFIX}${sessionId}_${taskId}`;
    }

    return {
        /**
         * Save a draft answer to localStorage
         * @param {string} sessionId - Session ID
         * @param {string} taskId - Task ID
         * @param {Object} userInput - User's answer data
         * @returns {boolean} Success status
         */
        saveDraft(sessionId, taskId, userInput) {
            if (!sessionId || !taskId) {
                console.warn('DraftStorage.saveDraft: missing sessionId or taskId');
                return false;
            }

            try {
                const key = getDraftKey(sessionId, taskId);
                const draft = {
                    userInput,
                    timestamp: Date.now(),
                    sessionId,
                    taskId
                };
                localStorage.setItem(key, JSON.stringify(draft));
                return true;
            } catch (e) {
                console.error('Failed to save draft:', e);
                // Handle quota exceeded or other localStorage errors
                return false;
            }
        },

        /**
         * Load a draft answer from localStorage
         * @param {string} sessionId - Session ID
         * @param {string} taskId - Task ID
         * @returns {Object|null} User input or null if not found/expired
         */
        loadDraft(sessionId, taskId) {
            if (!sessionId || !taskId) {
                return null;
            }

            try {
                // Try tab-specific key first, then legacy key
                const key = getDraftKey(sessionId, taskId);
                let raw = localStorage.getItem(key);
                if (!raw) {
                    raw = localStorage.getItem(getLegacyDraftKey(sessionId, taskId));
                }
                if (!raw) return null;

                const draft = JSON.parse(raw);

                // Check if draft is expired (older than 24 hours)
                const age = Date.now() - draft.timestamp;
                if (age > DRAFT_EXPIRATION_MS) {
                    // Auto-cleanup expired draft
                    this.clearDraft(sessionId, taskId);
                    return null;
                }

                return draft.userInput;
            } catch (e) {
                console.error('Failed to load draft:', e);
                return null;
            }
        },

        /**
         * Clear a specific draft after successful submission
         * @param {string} sessionId - Session ID
         * @param {string} taskId - Task ID
         * @returns {boolean} Success status
         */
        clearDraft(sessionId, taskId) {
            if (!sessionId || !taskId) {
                return false;
            }

            try {
                const key = getDraftKey(sessionId, taskId);
                localStorage.removeItem(key);
                return true;
            } catch (e) {
                console.error('Failed to clear draft:', e);
                return false;
            }
        },

        /**
         * Clear all drafts for a specific session
         * Useful when session is completed or cancelled
         * @param {string} sessionId - Session ID
         * @returns {boolean} Success status
         */
        clearSessionDrafts(sessionId) {
            if (!sessionId) {
                return false;
            }

            try {
                const prefix = `${STORAGE_KEY_PREFIX}${sessionId}_`;
                const keysToRemove = [];

                // Collect all keys for this session
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(prefix)) {
                        keysToRemove.push(key);
                    }
                }

                // Remove all collected keys
                keysToRemove.forEach(key => localStorage.removeItem(key));
                return true;
            } catch (e) {
                console.error('Failed to clear session drafts:', e);
                return false;
            }
        }
    };
}));
