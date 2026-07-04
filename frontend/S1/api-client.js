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

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

    const FETCH_TIMEOUT_MS = 30000;
    const CURRENT_USER_ENDPOINT = "/api/users/current";
    let cachedCurrentUserId = null;
    let currentUserIdPromise = null;

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
                error: wt('s1.err_read_response', 'Не удалось прочитать ответ сервера')
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
                error: res.ok ? wt('s1.err_server_bad_response', 'Сервер вернул некорректный ответ') : wt('s1.err_server_error', 'Сервер вернул ошибку ({status})').replace('{status}', res.status)
            };
        }
    }

    async function requestJson(url, opts = {}) {
        ensureRoutes();
        const res = await fetchWithTimeout(url, opts);
        const data = await parseResponseData(res);
        return { status: res.status, data };
    }

    function inferUserIdFromSessionId(sessionId) {
        const normalized = String(sessionId || "").trim();
        if (!normalized.startsWith("session_")) {
            return null;
        }

        const remainder = normalized.slice("session_".length);
        const splitIndex = remainder.lastIndexOf("_");
        if (splitIndex <= 0) {
            return null;
        }

        const userId = remainder.slice(0, splitIndex).trim();
        const timestampPart = remainder.slice(splitIndex + 1).trim();
        if (!userId || !timestampPart || Number.isNaN(Number(timestampPart))) {
            return null;
        }

        return userId;
    }

    async function resolveCurrentUserId(sessionId = null) {
        if (cachedCurrentUserId) {
            return cachedCurrentUserId;
        }

        if (!currentUserIdPromise) {
            currentUserIdPromise = (async () => {
                try {
                    const { status, data } = await requestJson(CURRENT_USER_ENDPOINT, {
                        method: "GET",
                    });
                    if (
                        status === 200 &&
                        data &&
                        data.ok === true &&
                        data.user &&
                        typeof data.user.user_id === "string" &&
                        data.user.user_id.trim()
                    ) {
                        cachedCurrentUserId = data.user.user_id.trim();
                        return cachedCurrentUserId;
                    }
                } catch (e) {
                    // Fallback below handles failed lookups.
                } finally {
                    currentUserIdPromise = null;
                }
                return null;
            })();
        }

        const resolvedUserId = await currentUserIdPromise;
        if (resolvedUserId) {
            return resolvedUserId;
        }

        return inferUserIdFromSessionId(sessionId);
    }

    async function withResolvedUserId(sessionId, payload = null) {
        const basePayload =
            payload && typeof payload === "object"
                ? { ...payload }
                : {};
        if (basePayload.user_id) {
            return basePayload;
        }

        const userId = await resolveCurrentUserId(sessionId);
        if (userId) {
            basePayload.user_id = userId;
        }
        return basePayload;
    }

    return {
        async getCurrentTask(sessionId) {
            return requestJson(SessionRoutes.API.GET_TASK(sessionId), {
                method: "GET",
            });
        },

        async saveTaskUiState(sessionId, uiStatePayload = null) {
            const payload =
                uiStatePayload && typeof uiStatePayload === "object"
                    ? uiStatePayload
                    : {};
            return requestJson(SessionRoutes.API.SAVE_UI_STATE(sessionId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        },

        async pauseSession(sessionId, pausePayload = null) {
            const payload = await withResolvedUserId(sessionId, pausePayload);
            return requestJson(SessionRoutes.API.PAUSE(sessionId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        },

        async resumeSession(sessionId, resumePayload = null) {
            const payload = await withResolvedUserId(sessionId, resumePayload);
            return requestJson(SessionRoutes.API.RESUME(sessionId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        },

        async submitAnswer(sessionId, taskId, userInput, options = null) {
            const payload = { task_id: taskId, user_input: userInput };
            if (options && options.auditControl && typeof options.auditControl === "object") {
                payload.audit_control = options.auditControl;
            }
            return requestJson(
                SessionRoutes.API.SUBMIT_ANSWER(sessionId),
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload),
                }
            );
        },

        async nextTask(sessionId) {
            return requestJson(
                SessionRoutes.API.NEXT_TASK(sessionId),
                { method: "POST" }
            );
        },

        async getIterationResults(sessionId, iterationNumber) {
            const baseUrl = SessionRoutes.API.ITERATION_RESULTS(sessionId);
            const url = iterationNumber != null
                ? `${baseUrl}?iteration=${encodeURIComponent(iterationNumber)}`
                : baseUrl;
            return requestJson(url, { method: "GET" });
        },

        async getFinalResults(sessionId) {
            return requestJson(
                SessionRoutes.API.FINAL_RESULTS(sessionId),
                { method: "GET" }
            );
        },

        async cancelSession(sessionId) {
            const payload = await withResolvedUserId(sessionId);
            return requestJson(SessionRoutes.API.CANCEL(sessionId), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
        }
    };
}));
