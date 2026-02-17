/**
 * Feature Configuration Module
 * Centralized management of feature flags for the S1 session system.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FeatureConfig = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    // Default feature flags
    const DEFAULT_FEATURES = {
        drawViaClickUI: true
    };

    /**
     * Get current feature flags
     * @returns {Object} Feature flags object
     */
    function getFeatureFlags() {
        // Check for global override first
        if (typeof window !== 'undefined' && window.RP_FEATURES) {
            return window.RP_FEATURES;
        }
        return DEFAULT_FEATURES;
    }

    /**
     * Set feature flags (useful for testing)
     * @param {Object} flags - Feature flags to set
     */
    function setFeatureFlags(flags) {
        if (typeof window !== 'undefined') {
            window.RP_FEATURES = { ...DEFAULT_FEATURES, ...flags };
        }
    }

    /**
     * Reset feature flags to defaults
     */
    function resetFeatureFlags() {
        if (typeof window !== 'undefined') {
            window.RP_FEATURES = { ...DEFAULT_FEATURES };
        }
    }

    // Public API
    return {
        getFeatureFlags: getFeatureFlags,
        setFeatureFlags: setFeatureFlags,
        resetFeatureFlags: resetFeatureFlags,
        DEFAULT_FEATURES: DEFAULT_FEATURES
    };
}));
