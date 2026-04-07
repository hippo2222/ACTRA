/**
 * Session State Management
 * Shared state object for the session page
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SessionState = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Initial state structure matching index.html
    const state = {
        sessionId: null,
        currentTask: null, // TaskDTO: task from /task endpoint
        theoryContext: null,
        isLoading: false,
        canGoNext: false,
        currentTaskChecked: false,
        currentEvaluationResult: null,
        pendingManualJudgement: false,
        autoSubmitting: false,
        pauseModalOpen: false,
        pauseInFlight: false,
        paused: false,
        skipBeforeUnloadPrompt: false,

        // Helpers to reset state between tasks if needed
        resetForNewTask() {
            this.canGoNext = false;
            this.currentTaskChecked = false;
            this.currentEvaluationResult = null;
            this.pendingManualJudgement = false;
            this.isLoading = false;
            this.autoSubmitting = false;
            this.skipBeforeUnloadPrompt = false;
            // Keep sessionId and paused state
        }
    };

    return state;
}));
