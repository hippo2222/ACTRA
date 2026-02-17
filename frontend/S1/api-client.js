/**
 * Session API Client
 * Handles all server communication using SessionRoutes
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./routes'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./routes'));
    } else {
        root.SessionAPI = factory(root.SessionRoutes);
    }
}(typeof self !== 'undefined' ? self : this, function (SessionRoutes) {
    'use strict';

    const FETCH_TIMEOUT_MS = 30000;

    function ensureRoutes() {
        if (!SessionRoutes || !SessionRoutes.API) {
            throw new Error("SessionRoutes not loaded or invalid");
        }
    }

    function fetchWithTimeout(url, opts = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        return fetch(url, { ...opts, signal: controller.signal }).finally(() => clearTimeout(timer));
    }

    return {
        async getCurrentTask(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(SessionRoutes.API.GET_TASK(sessionId), {
                method: "GET",
            });
            const data = await res.json();
            return { status: res.status, data };
        },

        async pauseSession(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(SessionRoutes.API.PAUSE(sessionId), {
                method: "POST",
            });
            const data = await res.json();
            return { status: res.status, data };
        },

        async resumeSession(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(SessionRoutes.API.RESUME(sessionId), {
                method: "POST",
            });
            const data = await res.json();
            return { status: res.status, data };
        },

        async submitAnswer(sessionId, taskId, userInput) {
            ensureRoutes();
            const res = await fetchWithTimeout(
                SessionRoutes.API.SUBMIT_ANSWER(sessionId),
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ task_id: taskId, user_input: userInput }),
                }
            );
            const data = await res.json();
            return { status: res.status, data };
        },

        async nextTask(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(
                SessionRoutes.API.NEXT_TASK(sessionId),
                { method: "POST" }
            );
            const data = await res.json();
            return { status: res.status, data };
        },

        async getIterationResults(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(
                SessionRoutes.API.ITERATION_RESULTS(sessionId),
                { method: "GET" }
            );
            const data = await res.json();
            return { status: res.status, data };
        },

        async getFinalResults(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(
                SessionRoutes.API.FINAL_RESULTS(sessionId),
                { method: "GET" }
            );
            const data = await res.json();
            return { status: res.status, data };
        },

        async cancelSession(sessionId) {
            ensureRoutes();
            const res = await fetchWithTimeout(SessionRoutes.API.CANCEL(sessionId), {
                method: "POST",
            });
            const data = await res.json();
            return { status: res.status, data };
        }
    };
}));
