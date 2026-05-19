/**
 * Session Validation Module
 * Shared logic for validating session IDs
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.SessionValidation = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function wt(key, fallback) {
        if (typeof window !== 'undefined' && window.i18n && typeof window.i18n.t === 'function') {
            const result = window.i18n.t(key);
            return result !== key ? result : fallback;
        }
        return fallback;
    }

    return {
        /**
         * Validate session ID format and security
         * @param {string} rawId - Raw session ID from URL
         * @returns {Object} Validation result with valid flag and error message
         */
        validateSessionId(rawId) {
            if (!rawId || typeof rawId !== 'string') {
                return { valid: false, error: wt('s1.session_id_missing', 'Session ID отсутствует') };
            }

            // Check length (UUID is typically 36 chars, but allow range for flexibility)
            if (rawId.length < 8 || rawId.length > 64) {
                return { valid: false, error: wt('s1.session_id_bad_length', 'Неверная длина Session ID') };
            }

            // Check format: only alphanumeric, hyphens, underscores, and dots
            // Session IDs may include a timestamp with fractional seconds.
            const validFormat = /^[a-zA-Z0-9_.-]+$/;
            if (!validFormat.test(rawId)) {
                return { valid: false, error: wt('s1.session_id_bad_chars', 'Недопустимые символы в Session ID') };
            }

            // Check for path traversal attempts
            if (rawId.includes('..') || rawId.includes('/') || rawId.includes('\\')) {
                return { valid: false, error: wt('s1.session_id_bad_format', 'Недопустимый формат Session ID') };
            }

            return { valid: true };
        }
    };
}));
