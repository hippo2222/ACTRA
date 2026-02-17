(function (global) {
  function normalizeFeatureSource(source) {
    const raw = source || {};
    if (typeof raw === "function") {
      try {
        return normalizeFeatureSource(raw());
      } catch (e) {
        return {};
      }
    }
    return {
      drawViaClickUI:
        raw.drawViaClickUI ?? raw.draw_via_clickui ?? raw.draw_via_click_ui ?? true,
    };
  }

  function pickTaskType(taskType, features) {
    const normalized = normalizeFeatureSource(features);
    if (taskType === "draw" && normalized.drawViaClickUI) {
      return "click";
    }
    return taskType;
  }

  const api = {
    normalizeFeatureSource,
    pickTaskType,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  global.TaskRendererSelector = api;
})(typeof window !== "undefined" ? window : globalThis);
