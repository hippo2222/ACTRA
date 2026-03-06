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

    async function parseResponseData(res) {
        let raw = '';
        try {
            raw = await res.text();
        } catch (e) {
            return {
                ok: false,
                error: 'Не удалось прочитать ответ сервера'
            };
        }

        if (!raw) {
            return { ok: !!res.ok };
        }

        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                return parsed;
            }
            return {
                ok: !!res.ok,
                value: parsed
            };
        } catch (e) {
            return {
                ok: false,
                error: res.ok ? 'Сервер вернул некорректный ответ' : `Сервер вернул ошибку (${res.status})`
            };
        }
    }

    async function requestJson(url, opts = {}) {
        ensureRoutes();
        const res = await fetchWithTimeout(url, opts);
        const data = await parseResponseData(res);
        return { status: res.status, data };
    }

    return {
        async getCurrentTask(sessionId) {
            return requestJson(SessionRoutes.API.GET_TASK(sessionId), {
                method: "GET",
            });
        },

        async pauseSession(sessionId) {
            return requestJson(SessionRoutes.API.PAUSE(sessionId), {
                method: "POST",
            });
        },

        async resumeSession(sessionId) {
            return requestJson(SessionRoutes.API.RESUME(sessionId), {
                method: "POST",
            });
        },

        async submitAnswer(sessionId, taskId, userInput) {
            return requestJson(
                SessionRoutes.API.SUBMIT_ANSWER(sessionId),
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ task_id: taskId, user_input: userInput }),
                }
            );
        },

        async nextTask(sessionId) {
            return requestJson(
                SessionRoutes.API.NEXT_TASK(sessionId),
                { method: "POST" }
            );
        },

        async getIterationResults(sessionId) {
            return requestJson(
                SessionRoutes.API.ITERATION_RESULTS(sessionId),
                { method: "GET" }
            );
        },

        async getFinalResults(sessionId) {
            return requestJson(
                SessionRoutes.API.FINAL_RESULTS(sessionId),
                { method: "GET" }
            );
        },

        async cancelSession(sessionId) {
            return requestJson(SessionRoutes.API.CANCEL(sessionId), {
                method: "POST",
            });
        }
    };
}));
