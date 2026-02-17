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

    return {
        /**
         * Validate session ID format and security
         * @param {string} rawId - Raw session ID from URL
         * @returns {Object} Validation result with valid flag and error message
         */
        validateSessionId(rawId) {
            if (!rawId || typeof rawId !== 'string') {
                return { valid: false, error: 'Session ID отсутствует' };
            }

            // Check length (UUID is typically 36 chars, but allow range for flexibility)
            if (rawId.length < 8 || rawId.length > 64) {
                return { valid: false, error: 'Неверная длина Session ID' };
            }

            // Check format: only alphanumeric, hyphens, underscores, and dots
            // Session IDs may include a timestamp with fractional seconds.
            const validFormat = /^[a-zA-Z0-9_.-]+$/;
            if (!validFormat.test(rawId)) {
                return { valid: false, error: 'Недопустимые символы в Session ID' };
            }

            // Check for path traversal attempts
            if (rawId.includes('..') || rawId.includes('/') || rawId.includes('\\')) {
                return { valid: false, error: 'Недопустимый формат Session ID' };
            }

            return { valid: true };
        }
    };
}));
