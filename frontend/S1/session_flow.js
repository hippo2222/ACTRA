(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require('./routes'));
  } else {
    root.SessionFlow = factory(root.SessionRoutes);
  }
})(typeof self !== "undefined" ? self : this, function (SessionRoutes) {
  "use strict";

  function buildSessionResultsUrl(sessionId) {
    if (SessionRoutes && SessionRoutes.SESSION_RESULTS) {
      return SessionRoutes.SESSION_RESULTS(sessionId);
    }
    // Fallback if routes not loaded (should not happen if set up correctly)
    return `/ui/session/${encodeURIComponent(sessionId)}/results`;
  }

  function shouldRedirectToFinalResults(nextStatus, nextResponse) {
    if (nextStatus === 410) return true;
    if (!nextResponse || typeof nextResponse !== "object") return false;
    return nextResponse.error === "session_completed";
  }

  function handleNextTaskCompletion({
    sessionId,
    status,
    response,
    redirect,
  }) {
    if (!sessionId) {
      return { handled: false, reason: "missing_session_id" };
    }

    if (shouldRedirectToFinalResults(status, response)) {
      const url = buildSessionResultsUrl(sessionId);
      if (typeof redirect === "function") {
        redirect(url);
      }
      return { handled: true, action: "redirect_final_results", url };
    }

    return { handled: false };
  }

  return {
    buildSessionResultsUrl,
    shouldRedirectToFinalResults,
    handleNextTaskCompletion,
  };
});
