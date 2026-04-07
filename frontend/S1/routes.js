/**
 * Centralized Route Management for S1 Session Page
 * Defines all API endpoints and UI routes
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SessionRoutes = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function encode(str) {
        return encodeURIComponent(str);
    }

    const ROUTES = {
        // UI Routes
        MAIN: '/ui/main',
        COMPLEXES: '/ui/complexes',
        SESSION_RESULTS: (sessionId) => `/ui/session/${encode(sessionId)}/results`,
        SESSION_TASK: (sessionId) => `/ui/session/${encode(sessionId)}`,

        // API Endpoints
        API: {
            GET_TASK: (sessionId) => `/api/session/${encode(sessionId)}/task`,
            SAVE_UI_STATE: (sessionId) => `/api/session/${encode(sessionId)}/ui-state`,
            PAUSE: (sessionId) => `/api/session/${encode(sessionId)}/pause`,
            RESUME: (sessionId) => `/api/session/${encode(sessionId)}/resume`,
            SUBMIT_ANSWER: (sessionId) => `/api/session/${encode(sessionId)}/task/submit`,
            NEXT_TASK: (sessionId) => `/api/session/${encode(sessionId)}/task/next`,
            ITERATION_RESULTS: (sessionId) => `/api/session/${encode(sessionId)}/iteration-results`,
            FINAL_RESULTS: (sessionId) => `/api/session/${encode(sessionId)}/final-results`,
            CANCEL: (sessionId) => `/api/session/${encode(sessionId)}/cancel`
        }
    };

    return ROUTES;
}));
