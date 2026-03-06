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

    // Stable per-tab identifier (persists across reloads via sessionStorage)
    const TAB_ID_STORAGE_KEY = 'session_draft_tab_id';
    const TAB_ID = (function resolveTabId() {
        const fallback = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
            if (typeof sessionStorage === 'undefined') return fallback;
            const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
            if (existing) return existing;
            sessionStorage.setItem(TAB_ID_STORAGE_KEY, fallback);
            return fallback;
        } catch (e) {
            return fallback;
        }
    }());

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

    function getDraftKeys(sessionId, taskId) {
        const keys = [
            getDraftKey(sessionId, taskId),
            getLegacyDraftKey(sessionId, taskId)
        ];
        return [...new Set(keys)];
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
                const legacyKey = getLegacyDraftKey(sessionId, taskId);
                const draft = {
                    userInput,
                    timestamp: Date.now(),
                    sessionId,
                    taskId
                };
                const raw = JSON.stringify(draft);
                localStorage.setItem(key, raw);
                // Keep legacy key in sync so older readers and cross-version restores still work.
                localStorage.setItem(legacyKey, raw);
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
                for (const key of getDraftKeys(sessionId, taskId)) {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;

                    try {
                        const draft = JSON.parse(raw);
                        const age = Date.now() - draft.timestamp;
                        if (age > DRAFT_EXPIRATION_MS) {
                            localStorage.removeItem(key);
                            continue;
                        }
                        return draft.userInput;
                    } catch (parseError) {
                        // Remove corrupted entries so they do not keep breaking every load.
                        localStorage.removeItem(key);
                    }
                }

                return null;
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
                getDraftKeys(sessionId, taskId).forEach((key) => {
                    localStorage.removeItem(key);
                });
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
