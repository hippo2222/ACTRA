(function (global) {
    var existing = global.ACTRA_CONFIG || {};
    var ui = existing.ui || {};

    global.ACTRA_CONFIG = Object.assign({}, existing, {
        ui: Object.assign({}, ui, {
            // Delay before showing loading overlays/skeletons to avoid quick flicker.
            loadingRevealDelayMs: 280
        })
    });
})(typeof window !== "undefined" ? window : globalThis);
