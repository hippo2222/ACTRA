(function (global) {
  const ClickUI = {};

  const CLICKUI_BUILD_ID = "2025-12-18T20:52:00Z";
  try {
    if (global && global.console && typeof global.console.log === "function") {
      global.console.log("[ClickUI] build", CLICKUI_BUILD_ID);
    }
  } catch (e) {
    // ignore
  }

  const state = {
    taskDto: null,
    container: null,
    root: null,
    img: null,
    imageWrapper: null,
    viewport: null,
    contentLayer: null,
    markerLayer: null,
    drawLayer: null,
    refLayer: null,
    clicks: [],
    polygons: [],
    lines: [],
    actionHistory: [],
    autoBrushFromClicks: false,
    maxClicks: 0,
    maxPolygons: 0,
    maxStrokes: 0,
    foundClickTargets: null,
    tempHintTimer: null,
    locked: false,
    mode: "click",
    zoom: 1,
    panX: 0,
    panY: 0,
    isPointerDown: false,
    panStart: null,
    activeStroke: null,
    showRef: false,
    showRefContours: true,
    showRefPolygons: true,
    showRefLines: true,
    showRefLabels: true,
    showUserMarks: true,
    userLinesCheckedStyle: false,
    userMarksCheckedStyle: false,
    badRefTargets: null,
    labelsContainer: null,
    labelsInputs: [],
    labelsClicks: [],
    labelsPolygons: [],
    labelsLines: [],
    highlightLabelErrors: false,
    labelEval: null,
    soloDuringDraw: false,
    additionalModal: null,
    additionalModalKeyHandler: null,
    targetColors: [],
    targetRows: [],
    targetsProgress: null,
  };

  function _getThemeColor(varName, fallback) {
    try {
      if (typeof document === "undefined" || !document.documentElement) return fallback;
      const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
      return value || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function _parseRgb(color) {
    if (!color) return null;
    const value = String(color).trim();
    if (!value) return null;
    if (value.startsWith("#")) {
      const raw = value.slice(1);
      const normalized =
        raw.length === 3
          ? raw
              .split("")
              .map((c) => c + c)
              .join("")
          : raw;
      if (normalized.length < 6) return null;
      const int = parseInt(normalized.slice(0, 6), 16);
      if (Number.isNaN(int)) return null;
      return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
    }
    const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    return {
      r: Math.round(parseFloat(match[1])),
      g: Math.round(parseFloat(match[2])),
      b: Math.round(parseFloat(match[3])),
    };
  }

  const TARGET_COLOR_PALETTE = [
    { varName: "--color-primary", fallback: "#2563eb" },
    { varName: "--color-error", fallback: "#dc2626" },
    { varName: "--color-success", fallback: "#16a34a" },
    { varName: "--color-accent", fallback: "#9333ea" },
    { varName: "--color-warning", fallback: "#ea580c" },
    { varName: "--color-info", fallback: "#0d9488" },
    { varName: "--color-secondary", fallback: "#c026d3" },
  ];

  function _assignTargetColors(taskDto) {
    const targets = _getTargets(taskDto);
    if (!Array.isArray(targets) || !targets.length) {
      state.targetColors = [];
      return;
    }
    const palette = TARGET_COLOR_PALETTE.map((entry) =>
      _getThemeColor(entry.varName, entry.fallback)
    );
    state.targetColors = targets.map((_, idx) => palette[idx % palette.length]);
  }

  function _getTargetColor(idx) {
    if (!Array.isArray(state.targetColors) || !state.targetColors.length) {
      const entry = TARGET_COLOR_PALETTE[idx % TARGET_COLOR_PALETTE.length];
      return _getThemeColor(entry.varName, entry.fallback);
    }
    return state.targetColors[idx % state.targetColors.length];
  }

  function _withAlpha(color, alpha) {
    const rgb = _parseRgb(color);
    const clamped = Math.max(0, Math.min(1, alpha));
    if (!rgb) return `rgba(0,0,0,${clamped})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
  }

  function _updateTargetsProgressUI() {
    if (!state.targetsProgress) return;
    const total = state.targetsProgress.total || 0;
    const found =
      state.foundClickTargets instanceof Set ? state.foundClickTargets.size : 0;
    if (state.targetsProgress.labelEl) {
      state.targetsProgress.labelEl.textContent = total
        ? `Найдено ${found} из ${total}`
        : "Цели отсутствуют";
    }
    if (state.targetsProgress.barEl) {
      const percent = total ? Math.min(100, Math.round((found / total) * 100)) : 0;
      state.targetsProgress.barEl.style.width = `${percent}%`;
    }
  }

  function _refreshTargetRowsState() {
    if (!Array.isArray(state.targetRows)) return;
    const foundSet =
      state.foundClickTargets instanceof Set ? state.foundClickTargets : new Set();
    const badSet = state.badRefTargets instanceof Set ? state.badRefTargets : new Set();
    state.targetRows.forEach((entry) => {
      if (!entry || !entry.el) return;
      const { idx, el, badge } = entry;
      el.classList.remove(
        "ring-2",
        "ring-success-light",
        "bg-success-lighter",
        "ring-error-light",
        "bg-error-lighter"
      );
      if (foundSet.has(idx)) {
        el.classList.add("ring-2", "ring-success-light", "bg-success-lighter");
        if (badge) badge.textContent = "✓";
      } else {
        if (badge) badge.textContent = String(idx + 1);
        if (badSet.has(idx)) {
          el.classList.add("ring-2", "ring-error-light", "bg-error-lighter");
        }
      }
    });
  }

  function _refreshTargetRowColors() {
    if (!Array.isArray(state.targetRows)) return;
    state.targetRows.forEach((entry) => {
      if (!entry) return;
      const color = _getTargetColor(entry.idx || 0);
      if (entry.badge) {
        entry.badge.style.backgroundColor = "";
        entry.badge.style.color = "";
        entry.badge.style.borderColor = "";
      }
      if (entry.icon) {
        entry.icon.style.color = color;
      }
      if (entry.dot) {
        entry.dot.style.backgroundColor = color;
      }
    });
  }

  function _debugEnabled() {
    return !!global.CLICKUI_DEBUG;
  }

  function _clientLog(tag, payload) {
    try {
      if (!_debugEnabled()) return;
      const body = JSON.stringify({ tag, payload });
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "application/json" });
        navigator.sendBeacon("/api/client-log", blob);
        return;
      }
      if (typeof fetch === "function") {
        fetch("/api/client-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        }).catch(() => { });
      }
    } catch (e) {
      // ignore
    }
  }

  function _getTaskType(taskDto) {
    if (!taskDto) return null;
    return (
      taskDto.task_type ||
      taskDto.type ||
      (taskDto.task_data && (taskDto.task_data.task_type || taskDto.task_data.type)) ||
      null
    );
  }

  function _allLabelFieldsFilled() {
    _ensureLabelsLengths();
    const clicksOk = (state.labelsClicks || []).every((s) => String(s || "").trim().length > 0);
    const polygonsOk = (state.labelsPolygons || []).every((s) => String(s || "").trim().length > 0);
    const linesOk = (state.labelsLines || []).every((s) => String(s || "").trim().length > 0);
    return clicksOk && polygonsOk && linesOk;
  }

  function _getTargets(taskDto) {
    const answerKey = (taskDto && taskDto.answer_key) || {};
    return Array.isArray(answerKey.targets) ? answerKey.targets : [];
  }

  function _isFreehandTarget(t) {
    if (!t || typeof t !== "object") return false;
    const shape = t.shape || t.type;
    return shape === "freehand";
  }

  function _recalcLimitsFromTask(taskDto) {
    const targets = _getTargets(taskDto);
    let clickCount = 0;
    let polygonCount = 0;
    let strokeCount = 0;
    for (const t of targets) {
      if (_isFreehandTarget(t)) strokeCount += 1;
      else {
        clickCount += 1;
        polygonCount += 1;
      }
    }
    state.maxClicks = clickCount;
    state.maxPolygons = polygonCount;
    state.maxStrokes = strokeCount;
  }

  function _requiresDrawing() {
    const taskDto = state.taskDto;
    const taskType = _getTaskType(taskDto);
    if (taskType === "draw") return true;
    const v =
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.requires_drawing) ||
      (taskDto && taskDto.task_data && taskDto.task_data.requires_drawing) ||
      (taskDto && taskDto.content && taskDto.content.requires_drawing);
    return Boolean(v);
  }

  function _pointInPolygon(x, y, points) {
    // Ray casting algorithm
    if (!Array.isArray(points) || points.length < 3) return false;
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const xi = Number(points[i][0]);
      const yi = Number(points[i][1]);
      const xj = Number(points[j][0]);
      const yj = Number(points[j][1]);

      const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function _checkClickHit(x, y) {
    const targets = _getTargets(state.taskDto);
    for (let idx = 0; idx < targets.length; idx += 1) {
      const t = targets[idx];
      if (_isFreehandTarget(t)) continue;
      const shape = (t && (t.shape || t.type)) || null;
      if (shape === "polygon" && Array.isArray(t.points)) {
        if (_pointInPolygon(x, y, t.points)) return { hit: true, targetIndex: idx };
      } else if (shape === "point") {
        const pt = Array.isArray(t.point) ? t.point : null;
        if (pt && pt.length >= 2) {
          const dx = x - (Number(pt[0]) || 0);
          const dy = y - (Number(pt[1]) || 0);
          const r = 12;
          if (dx * dx + dy * dy <= r * r) return { hit: true, targetIndex: idx };
        }
      }
    }
    return { hit: false, targetIndex: null };
  }

  function _getPrompt(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    return content.prompt || td.prompt || "";
  }

  function _renderTargetsPanel(taskDto) {
    const targets = _getTargets(taskDto);
    if (!Array.isArray(targets) || !targets.length) {
      state.targetsProgress = null;
      state.targetRows = [];
      return null;
    }

    const panel = _createEl(
      "div",
      "task-chip flex flex-col rounded-2xl border-2 border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );

    const header = _createEl(
      "div",
      "px-4 pt-4 pb-3 border-b border-border-strong dark:border-border-strong",
      ""
    );
    const title = _createEl(
      "h3",
      "text-sm font-semibold text-text-main dark:text-text-on-dark",
      "Цели для поиска"
    );
    const subtitle = _createEl(
      "p",
      "mt-1 text-xs text-text-secondary dark:text-text-secondary",
      "Цвет цели совпадает с отметками на изображении"
    );
    header.appendChild(title);
    header.appendChild(subtitle);
    panel.appendChild(header);

    const progressSection = _createEl("div", "task-chip px-4 py-3 border-b border-border-strong dark:border-border-strong", "");
    const progressLabel = _createEl(
      "div",
      "text-xs font-medium text-text-secondary dark:text-text-on-dark",
      ""
    );
    const progressTrack = _createEl(
      "div",
      "task-chip mt-2 h-2 rounded-full bg-bg-secondary dark:bg-bg-secondary",
      ""
    );
    const progressFill = _createEl(
      "div",
      "task-chip h-2 rounded-full bg-primary transition-all duration-200",
      ""
    );
    progressTrack.appendChild(progressFill);
    progressSection.appendChild(progressLabel);
    progressSection.appendChild(progressTrack);
    panel.appendChild(progressSection);

    state.targetsProgress = {
      total: targets.length,
      labelEl: progressLabel,
      barEl: progressFill,
    };

    const list = _createEl("div", "flex flex-col divide-y divide-border-subtle dark:divide-border-strong", "");
    state.targetRows = [];

    const typeMeta = {
      point: { icon: "gps_fixed", label: "Точка" },
      line: { icon: "show_chart", label: "Линия" },
      freehand: { icon: "gesture", label: "Свободная линия" },
      polygon: { icon: "interests", label: "Область" },
      default: { icon: "location_searching", label: "Цель" },
    };

    targets.forEach((t, idx) => {
      const shape = String((t && (t.shape || t.type)) || "").toLowerCase();
      const meta = typeMeta[shape] || typeMeta.default;
      const color = _getTargetColor(idx);
      const item = _createEl(
        "div",
        "task-chip flex items-center gap-3 px-4 py-3 transition-colors",
        ""
      );

      const badge = _createEl(
        "div",
        "task-chip flex size-8 items-center justify-center rounded-full border-2 border-border-strong bg-surface-2 text-text-main dark:bg-surface-2 dark:text-text-on-dark text-xs font-bold",
        String(idx + 1)
      );

      const info = _createEl("div", "flex-1 min-w-0", "");
      const label = _createEl(
        "div",
        "text-sm font-semibold text-text-main truncate dark:text-text-on-dark",
        t.label || `Цель ${idx + 1}`
      );
      const metaRow = _createEl("div", "mt-0.5 flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary", "");
      const iconEl = _createEl(
        "span",
        "material-symbols-outlined text-base",
        meta.icon
      );
      iconEl.style.color = color;
      const metaText = _createEl("span", "", meta.label);
      metaRow.appendChild(iconEl);
      metaRow.appendChild(metaText);
      info.appendChild(label);
      info.appendChild(metaRow);

      const colorDot = _createEl(
        "div",
        "task-chip size-3 rounded-full shadow-sm",
        ""
      );
      colorDot.style.backgroundColor = color;

      item.appendChild(badge);
      item.appendChild(info);
      item.appendChild(colorDot);
      list.appendChild(item);

      state.targetRows.push({ idx, el: item, badge, icon: iconEl, dot: colorDot });
    });

    const sideColumn = _createEl("div", "flex flex-col gap-4", "");
    const labelsControls = _createEl("div", "flex flex-col gap-2", "");
    const labelsTitle = _createEl(
      "div",
      "text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary",
      "Подписи"
    );
    labelsControls.appendChild(labelsTitle);

    const labelsButtons = _createEl("div", "flex gap-2", "");
    const labelModes = [
      { key: "off", label: "Скрыть" },
      { key: "compact", label: "Компактно" },
    ];
    labelModes.forEach((mode) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = mode.label;
      btn.className =
        "task-chip flex-1 rounded-lg border border-border-strong bg-surface-2 px-3 py-1 text-xs font-semibold text-text-main transition-colors focus:outline-none focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
      btn.addEventListener("click", () => {
        state.labelMode = mode.key;
        _updateLabelModeButtons(labelsButtons);
        _renderTargetSidebar();
        _renderLabelsInputs(null);
      });
      btn.dataset.mode = mode.key;
      labelsButtons.appendChild(btn);
    });
    labelsControls.appendChild(labelsButtons);
    sideColumn.appendChild(labelsControls);

    panel.appendChild(list);
    _updateTargetsProgressUI();
    _refreshTargetRowsState();

    return panel;
  }

  function _getDifficultyLevel(taskDto) {
    try {
      const td = (taskDto && taskDto.task_data) || {};
      const dl = td._difficulty_level != null ? td._difficulty_level : taskDto && taskDto.difficulty;
      const n = Number(dl);
      return Number.isFinite(n) ? n : null;
    } catch (e) {
      return null;
    }
  }

  function _getImagePath(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    return td.image_url || content.image_url || td.image || content.image || "";
  }

  function _resolveImageUrl(taskDto) {
    const raw = _getImagePath(taskDto);
    if (!raw) return "";

    if (typeof raw === "string") {
      if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
      if (raw.startsWith("/")) return raw;
      return `/api/local-image?path=${encodeURIComponent(raw)}`;
    }

    return "";
  }

  const Metadata = (function () {
    if (typeof global !== "undefined" && global.TaskMetadataPanel) {
      return global.TaskMetadataPanel;
    }
    if (typeof require === "function") {
      try {
        return require("./TaskMetadataPanel.js");
      } catch (e) {
        // ignore
      }
    }
    return null;
  })();

  const _resolveAssetUrl =
    Metadata && typeof Metadata.resolveAssetUrl === "function"
      ? Metadata.resolveAssetUrl
      : function (rawPath) {
        if (!rawPath && rawPath !== 0) return "";
        const raw = String(rawPath).trim();
        if (!raw) return "";
        if (/^(https?:|data:)/i.test(raw)) return raw;
        if (raw.startsWith("/")) return raw;
        return `/api/local-image?path=${encodeURIComponent(raw)}`;
      };

  const _normalizeAdditionalInfo =
    Metadata && typeof Metadata.normalizeAdditionalInfo === "function"
      ? Metadata.normalizeAdditionalInfo
      : function (raw) {
        if (!raw || typeof raw !== "object") return null;
        const fallback = { type: "none" };
        try {
          let type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
          const text = typeof raw.text === "string" ? raw.text.trim() : "";
          const images = Array.isArray(raw.images) ? raw.images.filter(Boolean) : [];
          if (!type) {
            if (text && images.length) type = "combined";
            else if (images.length) type = "image";
            else if (text) type = "text";
            else type = "none";
          }
          if (type === "none") return null;
          const info = { type, text: "", images: [] };
          if (type === "text") {
            if (!text) return null;
            info.text = text;
          } else if (type === "image") {
            if (!images.length) return null;
            info.images = images.slice(0, 3);
          } else if (type === "combined") {
            if (!text && !images.length) return null;
            info.text = text || "";
            info.images = images.slice(0, 3);
          }
          return info;
        } catch (e) {
          return fallback;
        }
      };

  function _getAdditionalInfo(taskDto) {
    if (!taskDto || !_normalizeAdditionalInfo) return null;
    const sources = [
      taskDto.additionalInfo,
      taskDto.task_data && taskDto.task_data.additionalInfo,
      taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.additionalInfo,
      taskDto.content && taskDto.content.additionalInfo,
    ];
    for (const src of sources) {
      const normalized = _normalizeAdditionalInfo(src);
      if (normalized) return normalized;
    }
    return null;
  }

  function _teardownAdditionalModal() {
    try {
      if (state.additionalModal && state.additionalModal.overlay) {
        const parent = state.additionalModal.overlay.parentNode;
        if (parent) parent.removeChild(state.additionalModal.overlay);
      }
      if (state.additionalModalKeyHandler && typeof document !== "undefined") {
        document.removeEventListener("keydown", state.additionalModalKeyHandler);
      }
    } catch (e) {
      // ignore
    } finally {
      state.additionalModal = null;
      state.additionalModalKeyHandler = null;
    }
  }

  function _ensureAdditionalModal() {
    if (state.additionalModal && state.additionalModal.overlay) return state.additionalModal;
    if (typeof document === "undefined") return null;

    const overlay = _createEl(
      "div",
      "fixed inset-0 z-[999] hidden bg-scrim-intense backdrop-blur-sm px-4 py-8",
      ""
    );
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-hidden", "true");

    const inner = _createEl(
      "div",
      "relative mx-auto flex h-full max-w-5xl flex-col items-center justify-center gap-4",
      ""
    );
    const figure = _createEl("figure", "flex w-full flex-col items-center gap-3", "");
    const viewport = _createEl(
      "div",
      "relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-2xl bg-scrim-weak shadow-2xl",
      ""
    );
    viewport.style.maxHeight = "80vh";
    viewport.style.touchAction = "none";
    const zoomLayer = _createEl("div", "select-none transition-none will-change-transform", "");
    zoomLayer.style.transformOrigin = "0 0";
    zoomLayer.style.cursor = "zoom-in";
    const img = document.createElement("img");
    img.className = "max-h-[80vh] w-auto max-w-full object-contain select-none pointer-events-none";
    img.alt = "";
    const caption = _createEl("figcaption", "text-center text-sm text-text-on-dark opacity-80", "");

    zoomLayer.appendChild(img);
    viewport.appendChild(zoomLayer);
    figure.appendChild(viewport);
    figure.appendChild(caption);

    const closeBtn = _createEl(
      "button",
      "absolute right-4 top-4 rounded-full bg-glass-light p-2 text-text-on-dark hover:bg-glass-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-text-on-dark",
      ""
    );
    closeBtn.setAttribute("type", "button");
    closeBtn.setAttribute("aria-label", "Закрыть полноэкранное изображение");
    const closeIcon = _createEl("span", "material-symbols-outlined text-2xl", "close");
    closeBtn.appendChild(closeIcon);

    inner.appendChild(figure);
    inner.appendChild(closeBtn);
    overlay.appendChild(inner);

    const handleOverlayClick = (ev) => {
      if (ev.target === overlay || closeBtn.contains(ev.target)) {
        _closeAdditionalModal();
      }
    };

    overlay.addEventListener("click", handleOverlayClick);
    closeBtn.addEventListener("click", handleOverlayClick);

    const handleWheel = (ev) => {
      const modal = state.additionalModal;
      if (!modal || !modal.viewport || modal.viewport !== viewport) return;
      ev.preventDefault();
      const delta = ev.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;
      const factor = delta < 0 ? 1.1 : 0.9;
      const nextScale = Math.min(
        modal.maxScale,
        Math.max(modal.minScale, modal.scale * factor)
      );
      if (nextScale === modal.scale) return;

      const viewportRect = modal.viewport.getBoundingClientRect();
      const originX = ev.clientX - viewportRect.left;
      const originY = ev.clientY - viewportRect.top;
      const relX = (originX - modal.translateX) / modal.scale;
      const relY = (originY - modal.translateY) / modal.scale;

      modal.scale = nextScale;
      if (nextScale === modal.minScale) {
        modal.translateX = 0;
        modal.translateY = 0;
      } else {
        modal.translateX = originX - relX * nextScale;
        modal.translateY = originY - relY * nextScale;
      }
      _applyAdditionalModalTransform(modal);
      _updateAdditionalModalCursor(modal);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    let panPointerId = null;
    let lastX = 0;
    let lastY = 0;

    const handlePointerDown = (ev) => {
      const modal = state.additionalModal;
      if (!modal || modal.viewport !== viewport || modal.scale <= modal.minScale) return;
      panPointerId = ev.pointerId;
      viewport.setPointerCapture(ev.pointerId);
      modal.isPanning = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _updateAdditionalModalCursor(modal);
      ev.preventDefault();
    };

    const handlePointerMove = (ev) => {
      const modal = state.additionalModal;
      if (
        !modal ||
        modal.viewport !== viewport ||
        !modal.isPanning ||
        panPointerId !== ev.pointerId
      )
        return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      modal.translateX += dx;
      modal.translateY += dy;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _applyAdditionalModalTransform(modal);
    };

    const endPan = (ev) => {
      const modal = state.additionalModal;
      if (!modal || modal.viewport !== viewport || panPointerId !== ev.pointerId) return;
      try {
        viewport.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // ignore
      }
      modal.isPanning = false;
      panPointerId = null;
      _updateAdditionalModalCursor(modal);
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", endPan);
    viewport.addEventListener("pointercancel", endPan);

    img.addEventListener("load", () => {
      const modal = state.additionalModal;
      if (!modal || modal.img !== img) return;
      _resetAdditionalModalTransform(modal);
    });

    const keyHandler = (ev) => {
      if (ev.key === "Escape") _closeAdditionalModal();
    };
    document.addEventListener("keydown", keyHandler);

    document.body.appendChild(overlay);
    state.additionalModal = {
      overlay,
      viewport,
      zoomLayer,
      img,
      caption,
      scale: 1,
      translateX: 0,
      translateY: 0,
      minScale: 1,
      maxScale: 6,
      isPanning: false
    };
    _applyAdditionalModalTransform(state.additionalModal);
    _updateAdditionalModalCursor(state.additionalModal);
    state.additionalModalKeyHandler = keyHandler;
    return state.additionalModal;
  }

  function _openAdditionalModal(url, captionText) {
    const modal = _ensureAdditionalModal();
    if (!modal || !url) return;
    _resetAdditionalModalTransform(modal);
    modal.img.src = url;
    modal.img.alt = captionText || "";
    modal.caption.textContent = captionText || "";
    modal.overlay.classList.remove("hidden");
    modal.overlay.setAttribute("aria-hidden", "false");
  }

  function _closeAdditionalModal() {
    if (!state.additionalModal || !state.additionalModal.overlay) return;
    state.additionalModal.overlay.classList.add("hidden");
    state.additionalModal.overlay.setAttribute("aria-hidden", "true");
    if (state.additionalModal.img) state.additionalModal.img.src = "";
    _resetAdditionalModalTransform(state.additionalModal);
  }

  function _resetAdditionalModalTransform(modal) {
    if (!modal) return;
    modal.scale = modal.minScale || 1;
    modal.translateX = 0;
    modal.translateY = 0;
    modal.isPanning = false;
    _applyAdditionalModalTransform(modal);
    _updateAdditionalModalCursor(modal);
  }

  function _applyAdditionalModalTransform(modal) {
    if (!modal || !modal.zoomLayer) return;
    modal.zoomLayer.style.transform = `translate(${modal.translateX}px, ${modal.translateY}px) scale(${modal.scale})`;
  }

  function _updateAdditionalModalCursor(modal) {
    if (!modal || !modal.zoomLayer) return;
    const cursor =
      modal.scale && modal.scale > (modal.minScale || 1) && modal.isPanning ? "grabbing" :
        modal.scale && modal.scale > (modal.minScale || 1) ? "grab" :
          "zoom-in";
    modal.zoomLayer.style.cursor = cursor;
  }

  function _createAdditionalInfoCard(info) {
    if (!info) return null;
    const card = _createEl(
      "div",
      "task-chip flex-1 rounded-lg border-2 border-border-strong bg-surface-2 px-4 py-3 text-sm text-text-main shadow-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
      ""
    );
    card.setAttribute("data-clickui", "additional-info");

    const header = _createEl(
      "div",
      "text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary",
      "Доп. материалы"
    );
    card.appendChild(header);

    if (info.text) {
      const textEl = _createEl(
        "div",
        "text-sm leading-relaxed text-text-secondary dark:text-text-on-dark whitespace-pre-wrap",
        info.text
      );
      card.appendChild(textEl);
    }

    if (info.images && info.images.length) {
      const gallery = _createEl("div", "mt-3 flex flex-wrap gap-2", "");
      info.images.slice(0, 3).forEach((imgPath, idx) => {
        const url = _resolveAssetUrl(imgPath);
        if (!url) return;
        const button = document.createElement("button");
        button.type = "button";
        button.className =
          "group relative h-24 w-32 overflow-hidden rounded-lg border border-border-subtle bg-surface-2 text-left shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-border-strong dark:bg-surface-2";

        const img = document.createElement("img");
        img.src = url;
        img.alt = info.text ? `Доп. изображение ${idx + 1}` : "Дополнительное изображение";
        img.className = "h-full w-full object-cover transition duration-200 group-hover:scale-105";

        const overlay = _createEl(
          "div",
          "pointer-events-none absolute inset-0 flex items-center justify-center bg-scrim opacity-0 transition group-hover:opacity-100",
          ""
        );
        const icon = _createEl("span", "material-symbols-outlined text-text-on-dark", "open_in_full");
        overlay.appendChild(icon);

        button.appendChild(img);
        button.appendChild(overlay);
        button.addEventListener("click", () => _openAdditionalModal(url, img.alt));
        gallery.appendChild(button);
      });
      card.appendChild(gallery);
    }

    if (!info.text && (!info.images || !info.images.length)) {
      card.appendChild(
        _createEl(
          "div",
          "text-sm text-text-muted dark:text-text-muted",
          "Дополнительные материалы отсутствуют"
        )
      );
    }

    return card;
  }

  function _createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function _clearMarkers() {
    if (!state.markerLayer) return;
    state.markerLayer.innerHTML = "";
  }

  function _applyTransform() {
    if (!state.contentLayer) return;
    state.contentLayer.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    state.contentLayer.style.transformOrigin = "0 0";
  }

  function _clearDrawing() {
    if (!state.drawLayer) return;
    state.drawLayer.innerHTML = "";
  }

  function _requiresLabels() {
    const taskDto = state.taskDto;
    const v =
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.requires_labels) ||
      (taskDto && taskDto.task_data && taskDto.task_data.requires_labels) ||
      (taskDto && taskDto.content && taskDto.content.requires_labels);
    return Boolean(v);
  }

  function _hasAnyUserMarks() {
    return Boolean(
      (state.clicks && state.clicks.length) ||
      (state.polygons && state.polygons.length) ||
      (state.lines && state.lines.length)
    );
  }

  function _ensureLabelsLengths() {
    if (!Array.isArray(state.labelsClicks)) state.labelsClicks = [];
    if (!Array.isArray(state.labelsPolygons)) state.labelsPolygons = [];
    if (!Array.isArray(state.labelsLines)) state.labelsLines = [];
    if (Array.isArray(state.clicks) && state.labelsClicks.length !== state.clicks.length) {
      state.labelsClicks = state.clicks.map((_, i) => state.labelsClicks[i] || "");
    }
    if (Array.isArray(state.polygons) && state.labelsPolygons.length !== state.polygons.length) {
      state.labelsPolygons = state.polygons.map((_, i) => state.labelsPolygons[i] || "");
    }
    if (Array.isArray(state.lines) && state.labelsLines.length !== state.lines.length) {
      state.labelsLines = state.lines.map((_, i) => state.labelsLines[i] || "");
    }
  }

  function _clearReference() {
    if (!state.refLayer) return;
    state.refLayer.innerHTML = "";
  }

  function _centroid(points) {
    if (!Array.isArray(points) || points.length < 1) return null;
    let x = 0;
    let y = 0;
    let n = 0;
    for (const p of points) {
      const xy = _normalizeXY(p);
      if (!xy) continue;
      x += xy[0];
      y += xy[1];
      n += 1;
    }
    if (!n) return null;
    return { x: x / n, y: y / n };
  }

  function _normalizeXY(p) {
    if (Array.isArray(p) && p.length >= 2) {
      const x = Number(p[0]);
      const y = Number(p[1]);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
      return null;
    }
    if (p && typeof p === "object") {
      const x = Number(p.x);
      const y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) return [x, y];
    }
    return null;
  }

  function _renderReference() {
    if (!state.refLayer || !state.img) return;
    _clearReference();

    if (!state.showRef) return;

    const taskDto = state.taskDto;
    const answerKey = (taskDto && taskDto.answer_key) || {};
    const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];
    if (!targets.length) return;

    if (_debugEnabled()) {
      try {
        let polyCount = 0;
        let lineCount = 0;
        let pointCount = 0;
        let unknownCount = 0;

        for (const t of targets) {
          if (!t || typeof t !== "object") {
            unknownCount += 1;
            continue;
          }
          const shape = (t.shape || t.type) != null ? String(t.shape || t.type).toLowerCase() : "";
          if (shape === "polygon") polyCount += 1;
          else if (shape === "freehand") lineCount += 1;
          else if (shape === "point") pointCount += 1;
          else if (Array.isArray(t.points)) {
            if (t.points.length >= 3) polyCount += 1;
            else if (t.points.length >= 2) lineCount += 1;
            else unknownCount += 1;
          } else if (Array.isArray(t.point) || t.coordinates) {
            pointCount += 1;
          } else {
            unknownCount += 1;
          }
        }

        const sample = targets.slice(0, 2).map((t) => {
          const shape = t && (t.shape || t.type);
          const ptsN = Array.isArray(t && t.points) ? t.points.length : null;
          return { shape, points: ptsN, label: t && t.label };
        });

        console.log("[ClickUI][ref] flags", {
          showRef: state.showRef,
          showRefContours: state.showRefContours,
          showRefPolygons: state.showRefPolygons,
          showRefLines: state.showRefLines,
          showRefLabels: state.showRefLabels,
          targets: targets.length,
          polyCount,
          lineCount,
          pointCount,
          unknownCount,
          sample,
        });
      } catch (e) {
        // ignore
      }
    }

    const naturalW = state.img.naturalWidth || 1;
    const naturalH = state.img.naturalHeight || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full pointer-events-none z-10");
    // Do not rely only on Tailwind classes for sizing; make overlay sizing explicit.
    svg.setAttribute("width", String(naturalW));
    svg.setAttribute("height", String(naturalH));
    svg.style.width = "100%";
    svg.style.height = "100%";
    svg.style.display = "block";
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.zIndex = "10";
    svg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const strokePoly = _getThemeColor("--color-accent", "#a855f7");
    const fillPoly = _withAlpha(strokePoly, 0.18);
    const strokeLine = _getThemeColor("--color-warning", "#f59e0b");
    const errorStroke = _getThemeColor("--color-error", "#f43f5e");
    const errorFill = _withAlpha(errorStroke, 0.1);
    const labelFill = _getThemeColor("--color-text-main", "#0f172a");
    const labelStroke = _getThemeColor("--color-text-on-dark", "#ffffff");

    const bad = state.badRefTargets instanceof Set ? state.badRefTargets : null;

    let appendedPolygons = 0;
    let appendedLines = 0;
    let appendedPoints = 0;

    const normalEls = [];
    const badEls = [];

    function _isLikelyNormalized(pointsXY) {
      // If coordinates are in [0..1] (or a bit above due to rounding), treat as normalized.
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const xy of pointsXY) {
        if (!xy) continue;
        if (xy[0] > maxX) maxX = xy[0];
        if (xy[1] > maxY) maxY = xy[1];
      }
      return maxX <= 1.5 && maxY <= 1.5;
    }

    targets.forEach((t, idx) => {
      if (!t || typeof t !== "object") return;
      const shape = (t && (t.shape || t.type)) || null;
      let shapeLower = String(shape || "").toLowerCase();
      // Fallback: infer shape from points ONLY if shape/type is missing.
      if (!shapeLower && Array.isArray(t.points)) {
        if (t.points.length >= 3) shapeLower = "polygon";
        else if (t.points.length >= 2) shapeLower = "freehand";
      }
      const label = (t.label != null ? String(t.label) : "").trim();

      let labelPos = null;

      if (state.showRefContours) {
        if (
          state.showRefPolygons &&
          shapeLower === "polygon" &&
          Array.isArray(t.points) &&
          t.points.length >= 3
        ) {
          const isBad = bad ? bad.has(idx) : false;
          const norm = t.points.map((p) => _normalizeXY(p)).filter(Boolean);
          const isNorm = _isLikelyNormalized(norm);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          const pts = norm
            .map((xy) => {
              const x = isNorm ? xy[0] * naturalW : xy[0];
              const y = isNorm ? xy[1] * naturalH : xy[1];
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
              return `${x},${y}`;
            })
            .join(" ");

          if (_debugEnabled()) {
            try {
              console.log("[ClickUI][ref] polygon target", {
                idx,
                isNorm,
                bbox: { minX, minY, maxX, maxY },
                pointsN: norm.length,
              });
            } catch (e) {
              // ignore
            }
          }

          if (pts) {
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            poly.setAttribute("data-clickui-ref", "polygon");
            poly.setAttribute("points", pts);
            poly.setAttribute("fill", isBad ? errorFill : fillPoly);
            poly.setAttribute("stroke", isBad ? errorStroke : strokePoly);
            poly.setAttribute("stroke-width", isBad ? "6" : "4");
            poly.setAttribute("stroke-opacity", "0.75");

            // Also set inline styles to prevent any external CSS from overriding SVG attributes.
            poly.style.stroke = isBad ? errorStroke : strokePoly;
            poly.style.strokeWidth = isBad ? "6" : "4";
            poly.style.strokeOpacity = "0.75";
            poly.style.fill = isBad ? errorFill : fillPoly;

            if (isBad) {
              poly.classList.add("clickui-bad-target");
            }
            (isBad ? badEls : normalEls).push(poly);
            appendedPolygons += 1;
            labelPos = _centroid(t.points);
          }
        } else if (
          state.showRefLines &&
          shapeLower === "freehand" &&
          Array.isArray(t.points) &&
          t.points.length >= 2
        ) {
          const isBad = bad ? bad.has(idx) : false;
          const norm = t.points.map((p) => _normalizeXY(p)).filter(Boolean);
          const isNorm = _isLikelyNormalized(norm);
          const d = norm
            .map((xy, i) => {
              const x = isNorm ? xy[0] * naturalW : xy[0];
              const y = isNorm ? xy[1] * naturalH : xy[1];
              return `${i === 0 ? "M" : "L"} ${x} ${y}`;
            })
            .join(" ");
          if (d) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("data-clickui-ref", "freehand");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", isBad ? errorStroke : strokeLine);
            path.setAttribute("stroke-width", isBad ? "6" : "4");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("stroke-opacity", "0.85");
            path.setAttribute("stroke-dasharray", "10 6");

            // Inline styles as well.
            path.style.stroke = isBad ? errorStroke : strokeLine;
            path.style.strokeWidth = isBad ? "6" : "4";
            path.style.strokeOpacity = "0.85";
            path.style.strokeDasharray = "10 6";

            if (isBad) {
              path.classList.add("clickui-bad-target");
            }
            (isBad ? badEls : normalEls).push(path);
            appendedLines += 1;
            labelPos = _centroid(t.points);
          }
        } else if (shapeLower === "point") {
          const pt = _normalizeXY(t.point);
          if (pt) {
            const isNorm = pt[0] <= 1.5 && pt[1] <= 1.5;
            const x = isNorm ? pt[0] * naturalW : pt[0];
            const y = isNorm ? pt[1] * naturalH : pt[1];
            const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            circle.setAttribute("cx", String(x));
            circle.setAttribute("cy", String(y));
            circle.setAttribute("r", "10");
            circle.setAttribute("fill", fillPoly);
            circle.setAttribute("stroke", strokePoly);
            circle.setAttribute("stroke-width", "2");
            (bad && bad.has(idx) ? badEls : normalEls).push(circle);
            appendedPoints += 1;
            labelPos = { x, y };
          }
        }
      } else {
        // If contours are hidden but labels are on, we still need a label position.
        if (shapeLower === "point") {
          const pt = _normalizeXY(t.point);
          if (pt) labelPos = { x: Number(pt[0]) || 0, y: Number(pt[1]) || 0 };
        } else if (Array.isArray(t.points)) {
          labelPos = _centroid(t.points);
        }
      }

      if (state.showRefLabels) {
        const textValue = label || `#${idx + 1}`;
        if (labelPos && typeof labelPos.x === "number" && typeof labelPos.y === "number") {
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(labelPos.x));
          text.setAttribute("y", String(labelPos.y));
          // High-contrast label: dark fill with light stroke, readable on any background.
          text.setAttribute("fill", labelFill);
          text.setAttribute("stroke", labelStroke);
          text.setAttribute("stroke-width", "4");
          text.setAttribute("paint-order", "stroke fill");
          text.setAttribute("stroke-linejoin", "round");
          text.setAttribute("font-size", "14");
          text.setAttribute("font-family", "Inter, system-ui, sans-serif");
          text.setAttribute("text-anchor", "middle");
          text.setAttribute("dominant-baseline", "middle");

          text.textContent = textValue;
          (bad && bad.has(idx) ? badEls : normalEls).push(text);
        }
      }
    });

    for (const el of normalEls) svg.appendChild(el);
    for (const el of badEls) svg.appendChild(el);

    state.refLayer.appendChild(svg);

    if (_debugEnabled()) {
      try {
        const csSvg = window.getComputedStyle ? window.getComputedStyle(svg) : null;
        const csRef = window.getComputedStyle ? window.getComputedStyle(state.refLayer) : null;
        const refPolys = svg.querySelectorAll('[data-clickui-ref="polygon"]').length;
        const refLines = svg.querySelectorAll('[data-clickui-ref="freehand"]').length;

        const firstPoly = svg.querySelector('[data-clickui-ref="polygon"]');
        const firstLine = svg.querySelector('[data-clickui-ref="freehand"]');
        const csPoly = firstPoly && window.getComputedStyle ? window.getComputedStyle(firstPoly) : null;
        const csLine = firstLine && window.getComputedStyle ? window.getComputedStyle(firstLine) : null;

        const polyAttrs = firstPoly
          ? {
            stroke: firstPoly.getAttribute("stroke"),
            strokeOpacity: firstPoly.getAttribute("stroke-opacity"),
            fill: firstPoly.getAttribute("fill"),
            strokeWidth: firstPoly.getAttribute("stroke-width"),
          }
          : null;
        const lineAttrs = firstLine
          ? {
            stroke: firstLine.getAttribute("stroke"),
            strokeOpacity: firstLine.getAttribute("stroke-opacity"),
            strokeDasharray: firstLine.getAttribute("stroke-dasharray"),
            strokeWidth: firstLine.getAttribute("stroke-width"),
          }
          : null;

        const dbg = {
          svgChildren: svg.childNodes ? svg.childNodes.length : null,
          refLayerChildren: state.refLayer.childNodes ? state.refLayer.childNodes.length : null,
          appendedPolygons,
          appendedLines,
          appendedPoints,
          refPolys,
          refLines,
          naturalW,
          naturalH,
          svgViewBox: svg.getAttribute("viewBox"),
          imgRect: state.img ? state.img.getBoundingClientRect() : null,
          contentRect: state.contentLayer ? state.contentLayer.getBoundingClientRect() : null,
          refRect: state.refLayer ? state.refLayer.getBoundingClientRect() : null,
          svgRect: svg.getBoundingClientRect ? svg.getBoundingClientRect() : null,
          refStyle: csRef
            ? { display: csRef.display, visibility: csRef.visibility, opacity: csRef.opacity, zIndex: csRef.zIndex }
            : null,
          svgStyle: csSvg
            ? { display: csSvg.display, visibility: csSvg.visibility, opacity: csSvg.opacity, position: csSvg.position }
            : null,
          polyAttrs,
          polyStyle: csPoly
            ? {
              stroke: csPoly.stroke,
              strokeOpacity: csPoly.strokeOpacity,
              fill: csPoly.fill,
              fillOpacity: csPoly.fillOpacity,
            }
            : null,
          lineAttrs,
          lineStyle: csLine
            ? {
              stroke: csLine.stroke,
              strokeOpacity: csLine.strokeOpacity,
              strokeDasharray: csLine.strokeDasharray,
            }
            : null,
        };
        // Save + print full JSON so you can just copy it from the console.
        try {
          window.__CLICKUI_LAST_REF_RENDERED = dbg;
        } catch (e) {
          // ignore
        }
        console.log("[ClickUI][ref] rendered", dbg);
        try {
          console.log("[ClickUI][ref] rendered JSON\n" + JSON.stringify(dbg, null, 2));
        } catch (e) {
          // ignore
        }

        _clientLog("ref_rendered", dbg);
      } catch (e) {
        // ignore
      }
    }
  }

  function _renderDrawing() {
    if (!state.drawLayer || !state.img) return;
    _clearDrawing();

    const naturalW = state.img.naturalWidth || 1;
    const naturalH = state.img.naturalHeight || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full pointer-events-none z-20");
    svg.setAttribute("viewBox", `0 0 ${naturalW} ${naturalH}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const primaryStroke = _getThemeColor("--color-primary", "#1349ec");
    const errorStroke = _getThemeColor("--color-error", "#ef4444");
    const successStroke = _getThemeColor("--color-success", "#22c55e");
    const textOnDark = _getThemeColor("--color-text-on-dark", "#ffffff");
    const strokeColor = state.userLinesCheckedStyle ? errorStroke : primaryStroke;
    const strokeOpacity = state.userLinesCheckedStyle ? "0.5" : "0.9";

    // Live preview of the active stroke while drawing (so the user sees it in real time)
    if (Array.isArray(state.activeStroke) && state.activeStroke.length >= 2) {
      const pts = state.activeStroke.filter(Boolean);
      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");

      if (d) {
        const preview = document.createElementNS("http://www.w3.org/2000/svg", "path");
        preview.setAttribute("d", d);
        preview.setAttribute("fill", "none");
        preview.setAttribute("stroke", _requiresDrawing() ? successStroke : strokeColor);
        preview.setAttribute("stroke-width", "4");
        preview.setAttribute("stroke-linecap", "round");
        preview.setAttribute("stroke-linejoin", "round");
        preview.setAttribute("stroke-opacity", "0.55");
        svg.appendChild(preview);
      }
    }

    const allPolygons = state.soloDuringDraw ? [] : Array.isArray(state.polygons) ? state.polygons : [];
    allPolygons.forEach((poly, idx) => {
      const pts = (poly && Array.isArray(poly.points) ? poly.points : []).filter(Boolean);
      if (pts.length < 3) return;

      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");
      if (!d) return;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `${d} Z`);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", successStroke);
      path.setAttribute("stroke-width", "4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-opacity", state.userLinesCheckedStyle ? "0.55" : "0.9");
      svg.appendChild(path);

      const first = pts[0];
      const x0 = Array.isArray(first) ? first[0] : first.x;
      const y0 = Array.isArray(first) ? first[1] : first.y;
      if (typeof x0 === "number" && typeof y0 === "number") {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${x0} ${y0})`);
        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "10");
        circle.setAttribute("fill", successStroke);
        circle.setAttribute("stroke", textOnDark);
        circle.setAttribute("stroke-width", "2");
        circle.setAttribute("opacity", state.userLinesCheckedStyle ? "0.6" : "0.95");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "0");
        text.setAttribute("y", "1");
        text.setAttribute("fill", textOnDark);
        text.setAttribute("font-size", "12");
        text.setAttribute("font-family", "Inter, system-ui, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = String(idx + 1);

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
      }
    });

    const allLines = state.soloDuringDraw ? [] : Array.isArray(state.lines) ? state.lines : [];
    allLines.forEach((line, idx) => {
      const pts = (line && Array.isArray(line.points) ? line.points : []).filter(Boolean);
      if (pts.length < 2) return;

      const d = pts
        .map((p, i) => {
          const x = Array.isArray(p) ? p[0] : p.x;
          const y = Array.isArray(p) ? p[1] : p.y;
          if (typeof x !== "number" || typeof y !== "number") return null;
          return `${i === 0 ? "M" : "L"} ${x} ${y}`;
        })
        .filter(Boolean)
        .join(" ");

      if (!d) return;

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", strokeColor);
      path.setAttribute("stroke-width", "4");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");
      path.setAttribute("stroke-opacity", strokeOpacity);
      svg.appendChild(path);

      // Stroke numbering (separate from click markers): show near the first point
      const first = pts[0];
      const x0 = Array.isArray(first) ? first[0] : first.x;
      const y0 = Array.isArray(first) ? first[1] : first.y;
      if (typeof x0 === "number" && typeof y0 === "number") {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("transform", `translate(${x0} ${y0})`);

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("r", "10");
        circle.setAttribute("fill", primaryStroke);
        circle.setAttribute("stroke", textOnDark);
        circle.setAttribute("stroke-width", "2");
        circle.setAttribute("opacity", state.userLinesCheckedStyle ? "0.6" : "0.95");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", "0");
        text.setAttribute("y", "1");
        text.setAttribute("fill", textOnDark);
        text.setAttribute("font-size", "12");
        text.setAttribute("font-family", "Inter, system-ui, sans-serif");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "middle");
        text.textContent = String(idx + 1);

        g.appendChild(circle);
        g.appendChild(text);
        svg.appendChild(g);
      }
    });

    state.drawLayer.appendChild(svg);
  }

  function _renderMarkers() {
    _clearMarkers();
    if (!state.markerLayer || !state.img) return;

    if (state.soloDuringDraw) return;

    const textOnDark = _getThemeColor("--color-text-on-dark", "#ffffff");

    const rect = state.img.getBoundingClientRect();
    const naturalW = state.img.naturalWidth || rect.width || 1;
    const naturalH = state.img.naturalHeight || rect.height || 1;

    state.clicks.forEach((c, idx) => {
      const color = _getTargetColor(idx);
      const dot = _createEl(
        "div",
        "absolute flex items-center justify-center size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 text-sm font-bold shadow-lg cursor-pointer hover:scale-110 transition-transform clickui-marker-entry",
        ""
      );

      dot.textContent = String(idx + 1);
      dot.style.left = `${c.x}px`;
      dot.style.top = `${c.y}px`;
      dot.title = `Клик ${idx + 1}: (${Math.round(c.x)}, ${Math.round(c.y)})`;
      dot.style.backgroundColor = color;
      dot.style.borderColor = textOnDark;
      dot.style.color = textOnDark;
      if (state.userMarksCheckedStyle) {
        dot.style.opacity = "0.8";
      } else {
        dot.style.opacity = "1";
      }
      state.markerLayer.appendChild(dot);
    });
  }

  function _getClickFromEvent(ev) {
    if (!state.img) return null;
    const rect = state.img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const naturalW = state.img.naturalWidth || rect.width;
    const naturalH = state.img.naturalHeight || rect.height;

    const x = (ev.clientX - rect.left) * (naturalW / rect.width);
    const y = (ev.clientY - rect.top) * (naturalH / rect.height);

    return {
      x,
      y,
      scale_factor: 1.0,
      offset_x: 0.0,
      offset_y: 0.0,
    };
  }

  function _setMode(mode) {
    state.mode = mode;
    if (mode === "click") {
      state.autoBrushFromClicks = false;
    }
    if (state.imageWrapper) {
      if (mode === "pan") {
        state.imageWrapper.style.cursor = "grab";
      } else if (mode === "brush") {
        state.imageWrapper.style.cursor = "crosshair";
      } else {
        state.imageWrapper.style.cursor = "crosshair";
      }
    }

    if (typeof state._updateToolbar === "function") {
      state._updateToolbar();
    }
  }

  function _setZoom(nextZoom) {
    const z = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
    state.zoom = z;
    _applyTransform();
  }

  function _zoomAtClientPoint(nextZoom, clientX, clientY) {
    if (!state.viewport) {
      _setZoom(nextZoom);
      return;
    }

    const z = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
    const rect = state.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      _setZoom(z);
      return;
    }

    const anchorX = clientX != null ? clientX - rect.left : rect.width / 2;
    const anchorY = clientY != null ? clientY - rect.top : rect.height / 2;

    const worldX = (anchorX - state.panX) / (state.zoom || 1);
    const worldY = (anchorY - state.panY) / (state.zoom || 1);

    state.zoom = z;
    state.panX = anchorX - worldX * state.zoom;
    state.panY = anchorY - worldY * state.zoom;
    _applyTransform();
  }

  function _resetView() {
    state.panX = 0;
    state.panY = 0;
    state.zoom = 1;
    _applyTransform();
  }

  function _undoLastAction() {
    if (state.locked) return;

    const _dbgSnap = (stage) => {
      try {
        const hist = Array.isArray(state.actionHistory) ? state.actionHistory : [];
        return {
          stage,
          mode: state.mode,
          maxClicks: state.maxClicks,
          maxStrokes: state.maxStrokes,
          maxPolygons: state.maxPolygons,
          clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
          lines: Array.isArray(state.lines) ? state.lines.length : null,
          polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
          activeStroke: Array.isArray(state.activeStroke) ? state.activeStroke.length : null,
          histLen: hist.length,
          histTail: hist.slice(Math.max(0, hist.length - 8)).map((a) => (a ? a.kind : null)),
          autoBrushFromClicks: !!state.autoBrushFromClicks,
          ignoreClicksUntil: state.ignoreClicksUntil || 0,
          now: Date.now(),
        };
      } catch (e) {
        return { stage, error: String(e && e.message ? e.message : e) };
      }
    };

    _clientLog("undo", _dbgSnap("before"));

    if (Array.isArray(state.activeStroke) && state.activeStroke.length > 0) {
      state.activeStroke = null;
      _renderDrawing();
      _renderLabelsInputs(null);
      if (typeof state._updateToolbar === "function") state._updateToolbar();
      if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
      _clientLog("undo", _dbgSnap("after_cancel_active_stroke"));
      return;
    }

    const hist = Array.isArray(state.actionHistory) ? state.actionHistory : [];

    // If history got out of sync (e.g. older sessions / edge cases), prefer undoing
    // actual existing marks in the UI over trusting history.
    try {
      const histClicks = hist.reduce((n, a) => n + (a && a.kind === "click" ? 1 : 0), 0);
      const histLines = hist.reduce((n, a) => n + (a && a.kind === "line" ? 1 : 0), 0);
      const histPolys = hist.reduce((n, a) => n + (a && a.kind === "polygon" ? 1 : 0), 0);
      const clicksNow = Array.isArray(state.clicks) ? state.clicks.length : 0;
      const linesNow = Array.isArray(state.lines) ? state.lines.length : 0;
      const polysNow = Array.isArray(state.polygons) ? state.polygons.length : 0;

      if (linesNow > histLines) {
        state.lines.pop();
        if (Array.isArray(state.labelsLines) && state.labelsLines.length) state.labelsLines.pop();
        _renderDrawing();
        _renderLabelsInputs(null);
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        _clientLog("undo", _dbgSnap("after_force_line"));
        return;
      }
      if (polysNow > histPolys) {
        state.polygons.pop();
        if (Array.isArray(state.labelsPolygons) && state.labelsPolygons.length) state.labelsPolygons.pop();
        _renderDrawing();
        _renderLabelsInputs(null);
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        _clientLog("undo", _dbgSnap("after_force_polygon"));
        return;
      }
      if (clicksNow > histClicks) {
        state.clicks.pop();
        if (Array.isArray(state.labelsClicks) && state.labelsClicks.length) state.labelsClicks.pop();
        state.foundClickTargets = new Set();
        try {
          for (const c of state.clicks) {
            const hit = _checkClickHit(c.x, c.y);
            if (hit && hit.hit && state.foundClickTargets) state.foundClickTargets.add(hit.targetIndex);
          }
        } catch (e) {
          // ignore
        }
        _renderMarkers();
        _renderLabelsInputs(null);
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        _clientLog("undo", _dbgSnap("after_force_click"));
        return;
      }
    } catch (e) {
      // ignore
    }

    const last = hist.length ? hist[hist.length - 1] : null;
    if (!last) return;
    hist.pop();
    state.actionHistory = hist;

    if (last.kind === "click") {
      if (Array.isArray(state.clicks) && state.clicks.length) state.clicks.pop();
      if (Array.isArray(state.labelsClicks) && state.labelsClicks.length) state.labelsClicks.pop();
      state.foundClickTargets = new Set();
      try {
        for (const c of state.clicks) {
          const hit = _checkClickHit(c.x, c.y);
          if (hit && hit.hit && state.foundClickTargets) state.foundClickTargets.add(hit.targetIndex);
        }
      } catch (e) {
        // ignore
      }
      _renderMarkers();

      if (
        state.autoBrushFromClicks &&
        !_requiresDrawing() &&
        state.mode === "brush" &&
        state.maxClicks > 0 &&
        Array.isArray(state.clicks) &&
        state.clicks.length < state.maxClicks
      ) {
        _setMode("click");
        state.autoBrushFromClicks = false;
      }
    } else if (last.kind === "polygon") {
      if (Array.isArray(state.polygons) && state.polygons.length) state.polygons.pop();
      if (Array.isArray(state.labelsPolygons) && state.labelsPolygons.length) state.labelsPolygons.pop();
      _renderDrawing();
    } else if (last.kind === "line") {
      if (Array.isArray(state.lines) && state.lines.length) state.lines.pop();
      if (Array.isArray(state.labelsLines) && state.labelsLines.length) state.labelsLines.pop();
      _renderDrawing();
    }

    _renderLabelsInputs(null);
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
    _clientLog("undo", _dbgSnap("after"));
  }

  function _applyUserMarksVisibility() {
    const isOn = state.showUserMarks !== false;
    if (state.markerLayer) {
      state.markerLayer.style.display = isOn ? "" : "none";
    }
    if (state.drawLayer) {
      state.drawLayer.style.display = isOn ? "" : "none";
    }
  }

  function _clearClicks() {
    if (state.locked) return;
    state.clicks = [];
    state.foundClickTargets = new Set();
    state.labelsClicks = [];
    state.actionHistory = [];
    state.autoBrushFromClicks = false;
    _renderMarkers();
    _renderDrawing();
    _renderReference();
    _renderLabelsInputs(null);
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
  }

  function _clearLines() {
    if (state.locked) return;
    state.polygons = [];
    state.lines = [];
    state.activeStroke = null;
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.actionHistory = [];
    state.autoBrushFromClicks = false;
    _renderDrawing();
    _renderLabelsInputs(null);
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
  }

  function _renderLabelsInputs(foundTargets) {
    if (!state.labelsContainer) return;

    state.labelsInputs = [];
    state.labelsCardEl = null;
    state.labelsContainer.innerHTML = "";

    const requiresLabels = _requiresLabels();
    if (!requiresLabels) return;

    _ensureLabelsLengths();

    // For L2: show labels UI only after user has at least one click/stroke.
    if (!_hasAnyUserMarks()) return;

    const card = _createEl(
      "div",
      "mt-4 bg-surface-1 dark:bg-surface-2 rounded-lg border border-border-subtle dark:border-border-strong p-4 shadow-sm",
      ""
    );

    const grid = _createEl("div", "grid grid-cols-1 sm:grid-cols-3 gap-4", "");
    card.appendChild(grid);

    function _makeRow(kind, idx1based, value, onChange) {
      const id = `clickui-${kind}-${idx1based}`;

      const wrap = _createEl("div", "flex flex-col gap-1.5", "");
      const top = _createEl("div", "flex items-center justify-between", "");
      const labelText =
        kind === "click"
          ? `Клик ${idx1based}`
          : kind === "polygon"
            ? `Контур ${idx1based}`
            : `Штрих ${idx1based}`;

      const lbl = document.createElement("label");
      lbl.setAttribute("for", id);
      lbl.className =
        "text-xs font-semibold text-text-muted dark:text-text-muted uppercase tracking-wide";
      lbl.textContent = labelText;

      const badge = _createEl(
        "span",
        "flex items-center justify-center w-5 h-5 rounded-full bg-primary text-primary-fg text-[10px] font-bold",
        String(idx1based)
      );

      const statusIcon = document.createElement("span");
      statusIcon.className = "material-symbols-outlined text-[16px]";
      statusIcon.style.visibility = "hidden";

      try {
        if (state.locked && state.labelEval) {
          const le = state.labelEval;
          const lineBase = _requiresDrawing() ? (state.polygons.length || 0) : (state.clicks.length || 0);
          let flatIndex = null;
          if (_requiresDrawing()) {
            if (kind === "polygon") flatIndex = idx1based - 1;
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          } else {
            if (kind === "click") flatIndex = idx1based - 1;
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          }

          if (flatIndex != null) {
            if (le.matched && le.matched.has(flatIndex)) {
              statusIcon.textContent = "check";
              statusIcon.classList.add("text-success", "dark:text-success");
              statusIcon.style.visibility = "visible";
            } else if (le.unmatched && le.unmatched.has(flatIndex)) {
              statusIcon.textContent = "close";
              statusIcon.classList.add("text-error", "dark:text-error");
              statusIcon.style.visibility = "visible";
            }
          }
        }
      } catch (e) {
        // ignore
      }

      top.appendChild(lbl);
      const right = _createEl("div", "flex items-center gap-2", "");
      right.appendChild(statusIcon);
      right.appendChild(badge);
      top.appendChild(right);

      const input = document.createElement("input");
      input.id = id;
      input.type = "text";
      input.placeholder = "Введите название...";
      input.disabled = state.locked;
      const baseInputClass =
        "form-input block w-full rounded-md border-border-subtle dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark shadow-sm focus:border-primary focus:ring-primary sm:text-sm";
      input.className = baseInputClass;
      input.value = value || "";

      function _applyInputHighlight() {
        const hasText = String(input.value || "").trim().length > 0;
        // Reset to base each time to avoid class accumulation.
        input.className = baseInputClass;

        // After check: if backend returned per-label correctness, highlight accordingly.
        // Mapping: payload order is
        //  - L2: labels_clicks then labels_lines
        //  - L3: labels_polygons then labels_lines
        if (state.locked && state.labelEval && hasText) {
          const le = state.labelEval;
          const clickBase = 0;
          const polyBase = 0;
          const lineBase = _requiresDrawing() ? (state.polygons.length || 0) : (state.clicks.length || 0);
          let flatIndex = null;
          if (_requiresDrawing()) {
            if (kind === "polygon") flatIndex = polyBase + (idx1based - 1);
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          } else {
            if (kind === "click") flatIndex = clickBase + (idx1based - 1);
            else if (kind === "line") flatIndex = lineBase + (idx1based - 1);
          }

          if (flatIndex != null) {
            if (le.matched && le.matched.has(flatIndex)) {
              input.className +=
                " border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
              return;
            }
            if (le.unmatched && le.unmatched.has(flatIndex)) {
              input.className +=
                " border-error-light dark:border-error-dark bg-error-lighter dark:bg-error-light";
              return;
            }
          }
        }

        if (state.highlightLabelErrors && !hasText) {
          input.className +=
            " border-error focus:border-error focus:ring-error dark:border-error bg-error-lighter dark:bg-error-light";
          return;
        }

        if (hasText) {
          input.className += " border-success-light dark:border-success-dark bg-success-lighter dark:bg-success-light";
        }
      }

      _applyInputHighlight();
      input.addEventListener("input", () => {
        onChange(input.value);

        _applyInputHighlight();

        if (state.highlightLabelErrors && _allLabelFieldsFilled()) {
          state.highlightLabelErrors = false;
          _renderLabelsInputs(null);
        }
      });

      wrap.appendChild(top);
      wrap.appendChild(input);
      return { wrap, input };
    }

    if (_requiresDrawing()) {
      // L3: contours first
      for (let i = 0; i < state.polygons.length; i += 1) {
        const row = _makeRow("polygon", i + 1, state.labelsPolygons[i], (v) => {
          state.labelsPolygons[i] = String(v || "");
        });
        grid.appendChild(row.wrap);
        state.labelsInputs.push({ kind: "polygon", index: i, input: row.input });
      }
    } else {
      // L2: clicks first
      for (let i = 0; i < state.clicks.length; i += 1) {
        const row = _makeRow("click", i + 1, state.labelsClicks[i], (v) => {
          state.labelsClicks[i] = String(v || "");
        });
        grid.appendChild(row.wrap);
        state.labelsInputs.push({ kind: "click", index: i, input: row.input });
      }
    }

    // Then strokes (always)
    for (let i = 0; i < state.lines.length; i += 1) {
      const row = _makeRow("line", i + 1, state.labelsLines[i], (v) => {
        state.labelsLines[i] = String(v || "");
      });
      grid.appendChild(row.wrap);
      state.labelsInputs.push({ kind: "line", index: i, input: row.input });
    }

    card.classList.add("clickui-card-entry");
    state.labelsContainer.appendChild(card);
    state.labelsCardEl = card;
    if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
  }

  ClickUI.createRoot = function createRoot(container, taskDto, options) {
    const runtimeMode = !!(options && options.runtimeMode);
    _teardownAdditionalModal();
    state.taskDto = taskDto;
    state.container = container;
    state.clicks = [];
    state.polygons = [];
    state.lines = [];
    state.foundClickTargets = new Set();
    _recalcLimitsFromTask(taskDto);
    state.activeStroke = null;
    state.locked = false;
    state.mode = "click";
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    state.isPointerDown = false;
    state.panStart = null;
    state.showRef = false;
    state.showRefContours = true;
    state.showRefLabels = true;
    state.showUserMarks = true;
    state.badRefTargets = null;
    state.labelsClicks = [];
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.highlightLabelErrors = false;
    state.labelEval = null;
    _assignTargetColors(taskDto);
    state.targetRows = [];
    state.targetsProgress = null;

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }
    state._themeListener = () => {
      _assignTargetColors(state.taskDto);
      _refreshTargetRowColors();
      _renderMarkers();
      _renderDrawing();
      _renderReference();
    };
    window.addEventListener("themechanged", state._themeListener);

    // Inject ClickUI entrance animation styles once
    if (!document.getElementById("clickui-anim-style")) {
      const _s = document.createElement("style");
      _s.id = "clickui-anim-style";
      _s.textContent =
        "@keyframes cuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }" +
        ".cui-layout-enter { animation: cuiSlideUp 250ms ease-out forwards; }";
      document.head.appendChild(_s);
    }

    const root = _createEl("div", "flex flex-col gap-3 cui-layout-enter", "");

    // Prevent horizontal layout shift when vertical scrollbar appears (e.g., after label inputs are rendered).
    try {
      const de = document && document.documentElement;
      const body = document && document.body;
      if (de && de.style) {
        if ("scrollbarGutter" in de.style) {
          de.style.scrollbarGutter = "stable";
          if (body && body.style && "scrollbarGutter" in body.style) body.style.scrollbarGutter = "stable";
        } else {
          // Fallback for older engines: always reserve scrollbar space.
          de.style.overflowY = "scroll";
        }
      }
    } catch (e) {
      // ignore
    }

    const layout = _createEl(
      "div",
      "flex flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-6 min-h-[70vh]",
      ""
    );
    const mainColumn = _createEl(
      "div",
      "flex-1 flex flex-col gap-4 min-h-[70vh]",
      ""
    );
    const sideColumn = _createEl(
      "div",
      "w-full lg:w-80 xl:w-96 2xl:w-[420px] flex flex-col gap-4 lg:sticky lg:top-0 lg:self-start max-h-[calc(100vh-120px)] overflow-y-auto",
      ""
    );
    let sideHasContent = false;

    state.metadataApi = null;
    if (!runtimeMode) {
      if (!Metadata || typeof Metadata.create !== "function") {
        throw new Error("TaskMetadataPanel is required but not available");
      }

      Metadata.openImageModal = (url, caption) => {
        _openAdditionalModal(url, caption);
      };

      const metadata = Metadata.create({
        taskDto,
        mode: "click",
        annotationTotals: {
          total: state.maxClicks || 0,
          clicks: state.maxClicks || 0,
          polygons: state.maxPolygons || 0,
          freehand: state.maxStrokes || 0,
        },
        onChange: () => {},
      });
      state.metadataApi = metadata.api;
      mainColumn.appendChild(metadata.rootEl);
    }

    const imgUrl = _resolveImageUrl(taskDto);

    const wrapperRow = _createEl(
      "div",
      "flex flex-col flex-1 gap-4 lg:flex-row lg:items-stretch",
      ""
    );

    const wrapper = _createEl(
      "div",
      "relative flex-1 min-h-[520px] lg:min-h-[600px] overflow-hidden rounded-2xl border-2 border-border-strong bg-surface-2 shadow-inner dark:border-border-strong dark:bg-surface-2 group select-none",
      ""
    );

    const viewport = _createEl(
      "div",
      "relative w-full h-full min-h-[520px] overflow-hidden flex items-center justify-center bg-surface-2 dark:bg-surface-2",
      ""
    );
    const contentLayer = _createEl("div", "absolute left-0 top-0", "");

    const img = document.createElement("img");
    img.className = "block select-none";
    img.alt = "task image";
    img.draggable = false;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.width = "1px";
    img.style.height = "1px";
    if (imgUrl) {
      img.src = imgUrl;
    }

    const imgError = _createEl(
      "div",
      "hidden absolute inset-0 flex items-center justify-center text-sm text-text-muted dark:text-text-muted",
      "Не удалось загрузить изображение"
    );

    const refLayer = _createEl("div", "pointer-events-none absolute inset-0 z-10", "");
    const drawLayer = _createEl("div", "pointer-events-none absolute inset-0 z-20", "");
    const markerLayer = _createEl("div", "pointer-events-none absolute inset-0 z-30", "");

    // Fallback styles (do not rely only on Tailwind classes for positioning/z-index).
    refLayer.style.position = "absolute";
    refLayer.style.left = "0";
    refLayer.style.top = "0";
    refLayer.style.right = "0";
    refLayer.style.bottom = "0";
    refLayer.style.zIndex = "10";

    drawLayer.style.position = "absolute";
    drawLayer.style.left = "0";
    drawLayer.style.top = "0";
    drawLayer.style.right = "0";
    drawLayer.style.bottom = "0";
    drawLayer.style.zIndex = "20";

    markerLayer.style.position = "absolute";
    markerLayer.style.left = "0";
    markerLayer.style.top = "0";
    markerLayer.style.right = "0";
    markerLayer.style.bottom = "0";
    markerLayer.style.zIndex = "30";

    contentLayer.appendChild(img);
    contentLayer.appendChild(imgError);
    contentLayer.appendChild(refLayer);
    contentLayer.appendChild(drawLayer);
    contentLayer.appendChild(markerLayer);
    viewport.appendChild(contentLayer);
    wrapper.appendChild(viewport);

    const toolbar = _createEl(
      "div",
      "pointer-events-auto absolute left-4 top-4 flex flex-col gap-3 z-30 w-12 sm:w-14",
      ""
    );

    const toolGroup = _createEl(
      "div",
      "flex flex-col bg-surface-1 dark:bg-surface-2 rounded-lg shadow-sm border border-border-strong dark:border-border-strong overflow-hidden divide-y divide-border-strong dark:divide-border-strong",
      ""
    );

    const zoomGroup = _createEl(
      "div",
      "flex flex-col bg-surface-1 dark:bg-surface-2 rounded-lg shadow-sm border border-border-strong dark:border-border-strong overflow-hidden divide-y divide-border-strong dark:divide-border-strong",
      ""
    );

    function _iconBtn({ title, icon, sizeClass, kind, onClick }) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = title;
      if (kind === "zoom") {
        b.className =
          "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover hover:text-primary transition-colors focus:outline-none focus:bg-surface-2";
      } else {
        b.className =
          "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors focus:outline-none";
      }
      b.addEventListener("click", onClick);

      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${sizeClass || "text-[22px]"}`;
      s.textContent = icon;
      b.appendChild(s);
      return b;
    }

    function _activeBtn(btn, iconSize) {
      btn.className =
        "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-primary-lighter dark:border-border-strong dark:bg-primary-dark text-primary dark:text-primary-light font-medium transition-colors focus:outline-none";
      btn.innerHTML = "";
      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${iconSize || "text-[22px]"}`;
      s.textContent = btn.dataset.icon || "";
      btn.appendChild(s);
    }

    function _inactiveBtn(btn, iconSize) {
      btn.className =
        "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors focus:outline-none";
      btn.innerHTML = "";
      const s = document.createElement("span");
      s.className = `material-symbols-outlined ${iconSize || "text-[22px]"}`;
      s.textContent = btn.dataset.icon || "";
      btn.appendChild(s);
    }

    const selectBtn = _iconBtn({
      title: "Режим клика",
      icon: "arrow_selector_tool",
      sizeClass: "text-[20px]",
      kind: "tool",
      onClick: () => _setMode("click"),
    });
    selectBtn.dataset.icon = "arrow_selector_tool";

    const brushBtn = _iconBtn({
      title: "Режим рисования",
      icon: "edit",
      sizeClass: "text-[22px]",
      kind: "tool",
      onClick: () => {
        state.autoBrushFromClicks = false;
        _setMode("brush");
      },
    });
    brushBtn.dataset.icon = "edit";

    const panBtn = _iconBtn({
      title: "Перемещение",
      icon: "pan_tool",
      sizeClass: "text-[22px]",
      kind: "tool",
      onClick: () => {
        state.autoBrushFromClicks = false;
        _setMode("pan");
      },
    });
    panBtn.dataset.icon = "pan_tool";

    const undoBtn = _iconBtn({
      title: "Отменить",
      icon: "undo",
      sizeClass: "text-[22px]",
      kind: "tool",
      onClick: _undoLastAction,
    });
    undoBtn.dataset.icon = "undo";

    toolGroup.appendChild(selectBtn);
    toolGroup.appendChild(brushBtn);
    toolGroup.appendChild(panBtn);
    toolGroup.appendChild(undoBtn);

    const zoomInBtn = _iconBtn({
      title: "Увеличить",
      icon: "add",
      sizeClass: "text-[24px]",
      kind: "zoom",
      onClick: () => _zoomAtClientPoint(state.zoom * 1.15, null, null),
    });
    const zoomOutBtn = _iconBtn({
      title: "Уменьшить",
      icon: "remove",
      sizeClass: "text-[24px]",
      kind: "zoom",
      onClick: () => _zoomAtClientPoint(state.zoom / 1.15, null, null),
    });
    zoomGroup.appendChild(zoomInBtn);
    zoomGroup.appendChild(zoomOutBtn);

    const clearWrap = _createEl("div", "mt-auto", "");
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.title = "Очистить";
    clearBtn.className =
      "flex flex-col items-center justify-center w-full h-14 bg-error-light dark:bg-error-light rounded-lg border-2 border-border-strong dark:border-border-strong text-error-text dark:text-error-lighter hover:bg-error-light dark:hover:bg-error-light transition-colors";
    const clearIcon = document.createElement("span");
    clearIcon.className = "material-symbols-outlined text-[22px]";
    clearBtn.appendChild(clearIcon);
    clearBtn.addEventListener("click", () => {
      if (state.mode === "brush") _clearLines();
      else _clearClicks();
      if (typeof state._updateToolbar === "function") state._updateToolbar();
    });
    clearWrap.appendChild(clearBtn);

    toolbar.appendChild(toolGroup);
    toolbar.appendChild(zoomGroup);
    toolbar.appendChild(clearWrap);

    const difficultyLevel = _getDifficultyLevel(taskDto);
    let hasTargetsPanel = false;
    let runtimeAdditionalCard = null;
    if (difficultyLevel === 1) {
      const targetsPanel = _renderTargetsPanel(taskDto);
      if (targetsPanel) {
        targetsPanel.className += " w-full";
        sideColumn.appendChild(targetsPanel);
        sideHasContent = true;
        hasTargetsPanel = true;
      }
    }

    if (runtimeMode) {
      const additionalInfo = _getAdditionalInfo(taskDto);
      runtimeAdditionalCard = _createAdditionalInfoCard(additionalInfo);
      if (runtimeAdditionalCard) {
        runtimeAdditionalCard.classList.add("w-full");
      }
    }

    wrapperRow.appendChild(wrapper);
    wrapper.appendChild(toolbar);

    const controls = _createEl("div", "mt-3 flex flex-col gap-2", "");

    const refToggles = _createEl(
      "div",
      "hidden flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-secondary dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
      ""
    );
    refToggles.setAttribute("data-clickui", "ref-toggles");

    const chkShowRef = document.createElement("input");
    chkShowRef.type = "checkbox";
    chkShowRef.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkShowRef.checked = state.showRef;
    chkShowRef.setAttribute("data-clickui", "ref-show");
    chkShowRef.addEventListener("change", () => {
      state.showRef = chkShowRef.checked;
      _renderReference();
    });
    const lblShowRef = _createEl("label", "flex items-center gap-2", "");
    lblShowRef.appendChild(chkShowRef);
    lblShowRef.appendChild(_createEl("span", "", "Референс"));

    const chkUserMarks = document.createElement("input");
    chkUserMarks.type = "checkbox";
    chkUserMarks.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkUserMarks.checked = state.showUserMarks;
    chkUserMarks.setAttribute("data-clickui", "user-marks");
    chkUserMarks.addEventListener("change", () => {
      state.showUserMarks = chkUserMarks.checked;
      _applyUserMarksVisibility();
    });
    const lblUserMarks = _createEl("label", "flex items-center gap-2", "");
    lblUserMarks.appendChild(chkUserMarks);
    lblUserMarks.appendChild(_createEl("span", "", "Мои отметки"));
    const chkContours = document.createElement("input");
    chkContours.type = "checkbox";
    chkContours.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkContours.checked = state.showRefPolygons;
    chkContours.setAttribute("data-clickui", "ref-polygons");
    chkContours.addEventListener("change", () => {
      state.showRefPolygons = chkContours.checked;
      _renderReference();
    });
    const lblContours = _createEl("label", "flex items-center gap-2", "");
    lblContours.appendChild(chkContours);
    lblContours.appendChild(_createEl("span", "", "Полигоны"));

    const chkLines = document.createElement("input");
    chkLines.type = "checkbox";
    chkLines.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkLines.checked = state.showRefLines;
    chkLines.setAttribute("data-clickui", "ref-lines");
    chkLines.addEventListener("change", () => {
      state.showRefLines = chkLines.checked;
      _renderReference();
    });
    const lblLines = _createEl("label", "flex items-center gap-2", "");
    lblLines.appendChild(chkLines);
    lblLines.appendChild(_createEl("span", "", "Линии"));

    const chkLabels = document.createElement("input");
    chkLabels.type = "checkbox";
    chkLabels.className = "rounded border-border-subtle text-primary focus:ring-0";
    chkLabels.checked = state.showRefLabels;
    chkLabels.addEventListener("change", () => {
      state.showRefLabels = chkLabels.checked;
      _renderReference();
    });
    const lblLabels = _createEl("label", "flex items-center gap-2", "");
    lblLabels.appendChild(chkLabels);
    lblLabels.appendChild(_createEl("span", "", "Названия"));

    refToggles.appendChild(lblShowRef);
    refToggles.appendChild(lblUserMarks);
    refToggles.appendChild(lblContours);
    refToggles.appendChild(lblLines);
    refToggles.appendChild(lblLabels);
    const hint = _createEl(
      "div",
      "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-surface-1 dark:bg-surface-1 border border-border-strong dark:border-border-strong rounded-lg text-sm text-text-secondary dark:text-text-on-dark",
      ""
    );
    hint.style.transition = "opacity 160ms ease-out, background-color 150ms ease-out, border-color 150ms ease-out, color 150ms ease-out";
    hint.style.opacity = "1";
    hint.setAttribute("data-clickui", "hint");
    const hintIcon = _createEl(
      "span",
      "material-symbols-outlined text-text-secondary dark:text-text-on-dark",
      "info"
    );
    hintIcon.style.transition = "color 150ms ease-out";
    let hintIconLastText = hintIcon.textContent;
    let hintIconLastClass = hintIcon.className;
    const hintText = _createEl("div", "", "");
    hintText.innerHTML = "";
    hintText.style.transition = "opacity 220ms ease-out, transform 220ms ease-out";
    hintText.style.opacity = "1";
    hintText.style.transform = "translateY(0)";
    let hintHtmlLast = "";
    let hintHtmlAnimSeq = 0;

    function _setHintHtml(nextHtml) {
      try {
        const html = String(nextHtml || "");
        if (html === hintHtmlLast) return;
        hintHtmlLast = html;
        hintHtmlAnimSeq += 1;
        const seq = hintHtmlAnimSeq;
        hintText.style.opacity = "0";
        hintText.style.transform = "translateY(2px)";

        // Swap content after fade-out starts so the transition is perceptible.
        setTimeout(() => {
          try {
            if (seq !== hintHtmlAnimSeq) return;
            hintText.innerHTML = html;
            requestAnimationFrame(() => {
              try {
                if (seq !== hintHtmlAnimSeq) return;
                hintText.style.opacity = "1";
                hintText.style.transform = "translateY(0)";
              } catch (e) {
                // ignore
              }
            });
          } catch (e) {
            // ignore
          }
        }, 90);
      } catch (e) {
        // ignore
      }
    }

    function _setHintIcon(nextText, nextClassName) {
      try {
        const nextT = nextText != null ? String(nextText) : "";
        const nextC = nextClassName ? String(nextClassName) : "";
        if (nextT === String(hintIconLastText || "") && nextC === String(hintIconLastClass || "")) return;
        hintIconLastText = nextT;
        hintIconLastClass = nextC;

        if (nextC) hintIcon.className = nextC;
        if (nextT != null) hintIcon.textContent = nextT;
      } catch (e) {
        // ignore
      }
    }
    hint.appendChild(hintIcon);
    hint.appendChild(hintText);

    const liveStatus = _createEl(
      "div",
      "text-xs font-medium text-text-secondary dark:text-text-on-dark",
      ""
    );
    liveStatus.setAttribute("data-clickui", "live-status");

    const checkStatus = _createEl(
      "div",
      "text-xs font-semibold text-text-secondary dark:text-text-on-dark text-right",
      ""
    );
    checkStatus.setAttribute("data-clickui", "check-status");
    state.checkStatusEl = checkStatus;

    hint.className += " w-full";
    checkStatus.className =
      "text-xs font-semibold text-text-secondary dark:text-text-on-dark text-right xl:text-left";
    const statusCard = _createEl(
      "div",
      "rounded-lg border border-border-strong bg-surface-2 p-4 shadow-sm dark:border-border-strong dark:bg-surface-2 flex flex-col gap-3",
      ""
    );
    const statusMeta = _createEl("div", "flex flex-col gap-1", "");
    statusMeta.appendChild(liveStatus);
    statusMeta.appendChild(checkStatus);
    statusCard.appendChild(hint);
    statusCard.appendChild(statusMeta);
    // In L1 runtime flow, targets panel already shows progress/state better.
    // Avoid duplicating the same information in a separate status card.
    if (!(runtimeMode && hasTargetsPanel)) {
      sideColumn.appendChild(statusCard);
      sideHasContent = true;
    }
    if (runtimeAdditionalCard) {
      sideColumn.appendChild(runtimeAdditionalCard);
      sideHasContent = true;
    }

    const labelsIndicator = document.createElement("button");
    labelsIndicator.type = "button";
    labelsIndicator.className =
      "fixed right-3 bottom-24 z-50 rounded-full bg-primary text-primary-fg text-xs font-semibold px-3 py-2 shadow-lg hover:bg-primary-hover transition-colors opacity-0 pointer-events-none";
    labelsIndicator.style.opacity = "0";
    labelsIndicator.style.transition = "opacity 160ms ease-out";
    labelsIndicator.textContent = "Названия ↓";
    labelsIndicator.addEventListener("click", () => {
      try {
        if (state.labelsCardEl && typeof state.labelsCardEl.scrollIntoView === "function") {
          state.labelsCardEl.scrollIntoView({ behavior: "smooth", block: "start" });
          state.labelsCardEl.classList.add("ring-2", "ring-info");
          setTimeout(() => {
            try {
              if (state.labelsCardEl) state.labelsCardEl.classList.remove("ring-2", "ring-info");
            } catch (e) {
              // ignore
            }
          }, 900);
        }
      } catch (e) {
        // ignore
      }
    });
    state.labelsIndicatorEl = labelsIndicator;

    function _getViewportMetrics() {
      try {
        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        const vw = window.innerWidth || document.documentElement.clientWidth || 0;
        return { vh, vw };
      } catch (e) {
        return { vh: 0, vw: 0 };
      }
    }

    function _isBelowFold(el, marginPx) {
      try {
        if (!el || typeof el.getBoundingClientRect !== "function") return false;
        const r = el.getBoundingClientRect();
        const { vh } = _getViewportMetrics();
        if (vh <= 0) return false;
        const m = typeof marginPx === "number" ? marginPx : 24;
        // If the top of the labels card is below the visible area, we need an indicator.
        return r.top > vh - m;
      } catch (e) {
        return false;
      }
    }

    state._updateLabelsIndicator = function updateLabelsIndicator() {
      try {
        const scrollTop =
          (typeof window !== "undefined" && typeof window.scrollY === "number" ? window.scrollY : 0) ||
          (document.documentElement && typeof document.documentElement.scrollTop === "number"
            ? document.documentElement.scrollTop
            : 0) ||
          0;
        const atTop = scrollTop <= 1;
        const hasAnyInputs = Array.isArray(state.labelsInputs) && state.labelsInputs.length > 0;
        const should = atTop && hasAnyInputs;
        if (!state.labelsIndicatorEl) return;
        if (should) {
          state.labelsIndicatorEl.classList.remove("pointer-events-none");
          state.labelsIndicatorEl.classList.add("pointer-events-auto");
          state.labelsIndicatorEl.style.opacity = "0.75";
        } else {
          state.labelsIndicatorEl.classList.remove("pointer-events-auto");
          state.labelsIndicatorEl.classList.add("pointer-events-none");
          state.labelsIndicatorEl.style.opacity = "0";
        }
      } catch (e) {
        // ignore
      }
    };

    window.addEventListener(
      "scroll",
      () => {
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
      },
      { passive: true }
    );
    window.addEventListener(
      "resize",
      () => {
        if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
      },
      { passive: true }
    );

    if (!document.getElementById("clickui-style")) {
      const style = document.createElement("style");
      style.id = "clickui-style";
      style.textContent = `
        @keyframes clickuiPulse { 0%, 100% { opacity: 1 } 50% { opacity: .35 } }
        @keyframes clickuiFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes clickuiScaleIn { from { opacity: 0; transform: translate(-50%, -50%) scale(0.6); } to { opacity: 1; transform: translate(-50%, -50%) scale(1); } }
        @keyframes clickuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .clickui-bad-target { animation: clickuiPulse 1.8s ease-in-out infinite }
        .clickui-marker-entry { animation: clickuiScaleIn 250ms ease-out forwards; }
        .clickui-card-entry { animation: clickuiSlideUp 250ms ease-out forwards; }
      `;
      document.head.appendChild(style);
    }

    function _setLiveStatus(kind, text) {
      if (!liveStatus) return;
      if (kind === "ok") {
        liveStatus.className = "text-xs font-semibold text-success-text dark:text-success";
      } else if (kind === "bad") {
        liveStatus.className = "text-xs font-semibold text-error-text dark:text-error";
      } else {
        liveStatus.className = "text-xs font-medium text-text-secondary dark:text-text-on-dark";
      }
      liveStatus.textContent = text || "";
    }

    function _updateLiveProgress() {
      if (!liveStatus) return;
      if (state.mode === "brush") {
        const hasActive = Array.isArray(state.activeStroke) && state.activeStroke.length >= 1;
        const doneLines = state.lines.length + (hasActive && !_requiresDrawing() ? 1 : 0);
        const totalLines = state.maxStrokes;
        if (_requiresDrawing()) {
          const willBePoly =
            hasActive &&
            Array.isArray(state.activeStroke) &&
            state.activeStroke.length >= 3 &&
            (function () {
              const pts = state.activeStroke;
              const a = pts[0];
              const b = pts[pts.length - 1];
              const dx = (a[0] || 0) - (b[0] || 0);
              const dy = (a[1] || 0) - (b[1] || 0);
              return dx * dx + dy * dy <= 14 * 14;
            })();

          const donePoly = state.polygons.length + (hasActive && willBePoly ? 1 : 0);
          const totalPoly = state.maxPolygons;
          const left =
            totalPoly > 0
              ? `Контуры: ${donePoly}/${totalPoly}. `
              : `Контуры: ${donePoly}. `;
          const right =
            totalLines > 0
              ? `Штрихи: ${doneLines}/${totalLines}. `
              : `Штрихи: ${doneLines}. `;
          _setLiveStatus("neutral", `${left}${right}Зажми и веди мышью по границе.`);
        } else {
          _setLiveStatus(
            "neutral",
            totalLines > 0
              ? `Нарисовано ${doneLines} штрихов из ${totalLines}. Зажми и веди мышью по границе.`
              : `Нарисовано ${doneLines} штрихов. Зажми и веди мышью по границе.`
          );
        }
        return;
      }

      const found = state.foundClickTargets ? state.foundClickTargets.size : 0;
      const total = state.maxClicks;
      _setLiveStatus(
        "neutral",
        total > 0 ? `Найдено целей: ${found}/${total}` : `Найдено целей: ${found}`
      );
    }

    state._updateLiveProgress = _updateLiveProgress;

    function _flashHint(message) {
      if (!hintText) return;
      if (state.tempHintTimer) {
        clearTimeout(state.tempHintTimer);
        state.tempHintTimer = null;
      }

      hint.className =
        "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-warning-lighter dark:bg-warning-light border border-warning-light dark:border-warning-light rounded-lg text-sm text-warning-darker dark:text-warning-lighter";
      _setHintIcon("warning", "material-symbols-outlined text-warning dark:text-warning-light");
      _setHintHtml(`<span class="font-semibold text-text-main dark:text-text-on-dark">${message}</span>`);

      state.tempHintTimer = setTimeout(() => {
        state.tempHintTimer = null;
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }, 3000);
    }

    controls.appendChild(refToggles);

    const labelsContainer = _createEl("div", "", "");

    mainColumn.appendChild(wrapperRow);
    mainColumn.appendChild(controls);
    mainColumn.appendChild(labelsContainer);

    layout.appendChild(mainColumn);
    if (sideHasContent) {
      layout.appendChild(sideColumn);
    }
    root.appendChild(layout);
    root.appendChild(labelsIndicator);

    img.addEventListener("load", () => {
      const naturalW = img.naturalWidth || 1;
      const naturalH = img.naturalHeight || 1;

      img.style.width = `${naturalW}px`;
      img.style.height = `${naturalH}px`;
      contentLayer.style.width = `${naturalW}px`;
      contentLayer.style.height = `${naturalH}px`;

      const viewportRect = viewport.getBoundingClientRect();
      const fitX = viewportRect.width > 0 ? viewportRect.width / naturalW : 1;
      const fitY = viewportRect.height > 0 ? viewportRect.height / naturalH : 1;
      state.zoom = Math.max(0.25, Math.min(6, Math.min(fitX, fitY)));
      state.panX = (viewportRect.width - naturalW * state.zoom) / 2;
      state.panY = (viewportRect.height - naturalH * state.zoom) / 2;

      _applyTransform();
      _renderMarkers();
      _renderDrawing();
      _renderReference();
      if (typeof state._updateLabelsIndicator === "function") state._updateLabelsIndicator();
    });

    img.addEventListener("error", () => {
      imgError.classList.remove("hidden");
    });

    viewport.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const dir = ev.deltaY > 0 ? -1 : 1;
        const factor = dir > 0 ? 1.15 : 1 / 1.15;
        _zoomAtClientPoint(state.zoom * factor, ev.clientX, ev.clientY);
      },
      { passive: false }
    );

    function _onPointerDown(ev) {
      if (state.locked) return;
      if (!state.img) return;
      if (ev.button != null && ev.button !== 0) return;

      state.isPointerDown = true;
      if (state.mode === "pan") {
        state.panStart = {
          x: ev.clientX,
          y: ev.clientY,
          panX: state.panX,
          panY: state.panY,
        };
        if (state.imageWrapper) state.imageWrapper.style.cursor = "grabbing";
        return;
      }

      if (state.mode === "brush") {
        state.ignoreClicksUntil = Date.now() + 350;
        if (state.maxStrokes > 0 && state.lines.length >= state.maxStrokes) {
          _flashHint("Достигнут лимит штрихов. Нажми «Проверить» для завершения.");
          _setLiveStatus("bad", "Лимит штрихов");
          return;
        }
        const pt = _getClickFromEvent(ev);
        if (!pt) return;
        state.soloDuringDraw = true;
        _renderMarkers();
        state.activeStroke = [[pt.x, pt.y]];
        _renderDrawing();
        _updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
        return;
      }
    }

    function _onPointerMove(ev) {
      if (!state.isPointerDown) return;
      if (state.locked) return;

      if (state.mode === "pan") {
        if (!state.panStart) return;
        const dx = ev.clientX - state.panStart.x;
        const dy = ev.clientY - state.panStart.y;
        state.panX = state.panStart.panX + dx;
        state.panY = state.panStart.panY + dy;
        _applyTransform();
        return;
      }

      if (state.mode === "brush") {
        const pt = _getClickFromEvent(ev);
        if (!pt || !state.activeStroke) return;

        const last = state.activeStroke[state.activeStroke.length - 1];
        const dx = pt.x - last[0];
        const dy = pt.y - last[1];
        if (dx * dx + dy * dy < 4) return;

        state.activeStroke.push([pt.x, pt.y]);
        _renderDrawing();
        _updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }
    }

    function _distanceSq(a, b) {
      const dx = (a[0] || 0) - (b[0] || 0);
      const dy = (a[1] || 0) - (b[1] || 0);
      return dx * dx + dy * dy;
    }

    function _onPointerUp() {
      if (!state.isPointerDown) return;
      state.isPointerDown = false;

      if (state.mode === "pan") {
        state.panStart = null;
        if (state.imageWrapper) state.imageWrapper.style.cursor = "grab";
      }

      if (state.mode === "brush") {
        state.ignoreClicksUntil = Date.now() + 350;
        // Finalize active stroke: classify as contour (polygon) vs freehand stroke
        try {
          let pts = Array.isArray(state.activeStroke) ? state.activeStroke : [];
          // If user just clicked (no movement), we still want it to count as a stroke.
          // Convert single-point stroke into a minimal 2-point stroke.
          if (pts.length === 1) {
            const p0 = pts[0];
            pts = [p0, [p0[0], p0[1]]];
          }
          if (pts.length >= 2) {
            const isClosed =
              _requiresDrawing() &&
              pts.length >= 3 &&
              _distanceSq(pts[0], pts[pts.length - 1]) <= 14 * 14;

            if (isClosed) {
              if (_requiresDrawing() && state.maxPolygons > 0 && state.polygons.length >= state.maxPolygons) {
                _flashHint("Достигнут лимит контуров. Нарисуй штрихи (фрихенд) или нажми «Проверить». ");
                _setLiveStatus("bad", "Лимит контуров");
              } else {
                state.polygons = Array.isArray(state.polygons) ? state.polygons : [];
                state.polygons.push({ points: pts });
                state.labelsPolygons = Array.isArray(state.labelsPolygons) ? state.labelsPolygons : [];
                state.labelsPolygons.push("");
                state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
                state.actionHistory.push({ kind: "polygon" });
                _clientLog("finalize_stroke", {
                  kind: "polygon",
                  now: Date.now(),
                  mode: state.mode,
                  pts: Array.isArray(pts) ? pts.length : null,
                  clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
                  lines: Array.isArray(state.lines) ? state.lines.length : null,
                  polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
                  histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
                    .slice(-8)
                    .map((a) => (a ? a.kind : null)),
                });
              }
            } else {
              state.lines = Array.isArray(state.lines) ? state.lines : [];
              state.lines.push({ points: pts });
              state.labelsLines = Array.isArray(state.labelsLines) ? state.labelsLines : [];
              state.labelsLines.push("");
              state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
              state.actionHistory.push({ kind: "line" });
              _clientLog("finalize_stroke", {
                kind: "line",
                now: Date.now(),
                mode: state.mode,
                pts: Array.isArray(pts) ? pts.length : null,
                clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
                lines: Array.isArray(state.lines) ? state.lines.length : null,
                polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
                histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
                  .slice(-8)
                  .map((a) => (a ? a.kind : null)),
              });
            }
          }
        } catch (e) {
          // ignore
        }

        if (_debugEnabled()) {
          try {
            console.log("[ClickUI][stroke] end", {
              requiresDrawing: _requiresDrawing(),
              polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
              lines: Array.isArray(state.lines) ? state.lines.length : null,
              maxPolygons: state.maxPolygons,
              maxStrokes: state.maxStrokes,
            });
          } catch (e) {
            // ignore
          }
        }

        state.soloDuringDraw = false;
        state.activeStroke = null;
        _renderDrawing();
        _renderMarkers();
        _renderLabelsInputs(null);
        if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }
    }

    viewport.addEventListener("pointerdown", _onPointerDown);
    window.addEventListener("pointermove", _onPointerMove);
    window.addEventListener("pointerup", _onPointerUp);
    window.addEventListener("pointercancel", _onPointerUp);

    viewport.addEventListener("click", (ev) => {
      _clientLog("evt_click", {
        now: Date.now(),
        mode: state.mode,
        ignored: Date.now() < (state.ignoreClicksUntil || 0),
        ignoreClicksUntil: state.ignoreClicksUntil || 0,
        clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
        lines: Array.isArray(state.lines) ? state.lines.length : null,
        polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
        histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
          .slice(-6)
          .map((a) => (a ? a.kind : null)),
      });
      if (Date.now() < (state.ignoreClicksUntil || 0)) return;
      if (state.locked) return;
      if (_requiresDrawing()) return;
      if (state.mode !== "click") return;
      if (state.maxClicks > 0 && state.clicks.length >= state.maxClicks) {
        if (state.maxStrokes > 0) {
          state.autoBrushFromClicks = true;
          _setMode("brush");
        }
        _flashHint("Достигнут лимит кликов. Нажми «Проверить» для завершения.");
        _setLiveStatus("bad", "Лимит кликов");
        return;
      }
      const click = _getClickFromEvent(ev);
      if (!click) return;

      const hit = _checkClickHit(click.x, click.y);
      if (hit.hit) {
        if (state.foundClickTargets && state.foundClickTargets.has(hit.targetIndex)) {
          _flashHint("Эта цель уже была найдена.");
          _setLiveStatus("bad", `Уже найдено (цель #${hit.targetIndex + 1})`);
          return;
        }
        if (state.foundClickTargets) state.foundClickTargets.add(hit.targetIndex);
        _setLiveStatus("ok", `Попадание (цель #${hit.targetIndex + 1})`);
      } else {
        _setLiveStatus("bad", "Мимо");
      }

      state.clicks.push(click);
      state.labelsClicks = Array.isArray(state.labelsClicks) ? state.labelsClicks : [];
      state.labelsClicks.push("");
      state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
      state.actionHistory.push({ kind: "click" });
      _clientLog("add_click", {
        now: Date.now(),
        mode: state.mode,
        clicks: Array.isArray(state.clicks) ? state.clicks.length : null,
        lines: Array.isArray(state.lines) ? state.lines.length : null,
        polygons: Array.isArray(state.polygons) ? state.polygons.length : null,
        histTail: (Array.isArray(state.actionHistory) ? state.actionHistory : [])
          .slice(-8)
          .map((a) => (a ? a.kind : null)),
      });
      _renderMarkers();
      _renderLabelsInputs(null);
      _updateLiveProgress();
      if (state.maxClicks > 0 && state.clicks.length >= state.maxClicks && state.maxStrokes > 0) {
        state.autoBrushFromClicks = true;
        _setMode("brush");
      }
      if (typeof state._updateToolbar === "function") state._updateToolbar();
    });

    state.root = root;
    state.img = img;
    state.imageWrapper = wrapper;
    state.viewport = viewport;
    state.contentLayer = contentLayer;
    state.markerLayer = markerLayer;
    state.drawLayer = drawLayer;
    state.refLayer = refLayer;
    state.labelsContainer = labelsContainer;
    state.labelsInputs = [];
    if (state.checkStatusEl) state.checkStatusEl.textContent = "";

    state._updateToolbar = function updateToolbar() {
      const modeNow = state.mode;
      const modeChanged = modeNow !== state._lastHintMode;
      state._lastHintMode = modeNow;
      void modeChanged;

      if (_requiresDrawing() && selectBtn) {
        // Keep click tool hidden in L3 even if className is overwritten.
        selectBtn.style.display = "none";
      } else if (selectBtn) {
        selectBtn.style.display = "";
      }

      if (state.mode === "click") {
        _activeBtn(selectBtn, "text-[20px]");
        _inactiveBtn(brushBtn, "text-[22px]");
        _inactiveBtn(panBtn, "text-[22px]");
        if (undoBtn) {
          const canUndo =
            (Array.isArray(state.actionHistory) && state.actionHistory.length > 0) ||
            (Array.isArray(state.activeStroke) && state.activeStroke.length > 0);
          undoBtn.style.opacity = canUndo ? "1" : "0.4";
          undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
        }
        clearBtn.title = "Очистить все клики";
        clearIcon.textContent = "delete";

        hint.className =
          "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-surface-1 dark:bg-surface-1 border border-border-strong dark:border-border-strong rounded-lg text-sm text-text-secondary dark:text-text-on-dark";
        _setHintIcon("info", "material-symbols-outlined text-text-secondary dark:text-text-on-dark");

        if (hintText) {
          const done = state.clicks.length;
          const total = state.maxClicks;
          const baseHtml =
            total > 0
              ? `<span class="font-semibold text-text-main dark:text-text-on-dark">Сделано ${done} кликов из ${total} доступных.</span>`
              : `<span class="font-semibold text-text-main dark:text-text-on-dark">Сделано ${done} кликов.</span>`;
          const extraHtml =
            _requiresLabels() && _hasAnyUserMarks()
              ? "<div class=\"mt-0.5 leading-snug\">Введи названия для отмеченных целей и нажми «Проверить ответ».</div>"
              : "";
          _setHintHtml(baseHtml + extraHtml);
        }
      } else if (state.mode === "brush") {
        _inactiveBtn(selectBtn, "text-[20px]");
        _activeBtn(brushBtn, "text-[22px]");
        _inactiveBtn(panBtn, "text-[22px]");
        if (undoBtn) {
          const canUndo =
            (Array.isArray(state.actionHistory) && state.actionHistory.length > 0) ||
            (Array.isArray(state.activeStroke) && state.activeStroke.length > 0);
          undoBtn.style.opacity = canUndo ? "1" : "0.4";
          undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
        }
        clearBtn.title = "Очистить штрихи";
        clearIcon.textContent = "ink_eraser";

        hint.className =
          "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-surface-1 dark:bg-surface-1 border border-border-strong dark:border-border-strong rounded-lg text-sm text-text-secondary dark:text-text-on-dark";
        _setHintIcon("gesture", "material-symbols-outlined text-text-secondary dark:text-text-on-dark");

        if (hintText) {
          const hasActive = Array.isArray(state.activeStroke) && state.activeStroke.length >= 1;
          const doneLines = state.lines.length + (hasActive && !_requiresDrawing() ? 1 : 0);
          const totalLines = state.maxStrokes;
          let baseHtml = "";
          if (_requiresDrawing()) {
            const willBePoly =
              hasActive &&
              Array.isArray(state.activeStroke) &&
              state.activeStroke.length >= 3 &&
              _distanceSq(state.activeStroke[0], state.activeStroke[state.activeStroke.length - 1]) <= 14 * 14;
            const donePoly = state.polygons.length + (hasActive && willBePoly ? 1 : 0);
            const totalPoly = state.maxPolygons;
            const polyText = totalPoly > 0 ? `Контуры ${donePoly} из ${totalPoly}.` : `Контуры ${donePoly}.`;
            const lineText = totalLines > 0 ? `Штрихи ${doneLines} из ${totalLines}.` : `Штрихи ${doneLines}.`;
            baseHtml = `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">${polyText} ${lineText}</span> Зажми и веди мышью по границе.`;
          } else {
            if (totalLines > 0) {
              baseHtml = `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Нарисовано ${doneLines} штрихов из ${totalLines}.</span> Зажми и веди мышью по границе.`;
            } else {
              baseHtml = `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">Нарисовано ${doneLines} штрихов.</span> Зажми и веди мышью по границе.`;
            }
          }

          const extraHtml =
            _requiresLabels() && _hasAnyUserMarks()
              ? "<div class=\"mt-0.5 leading-snug\">Введи названия для отмеченных целей и нажми «Проверить ответ».</div>"
              : "";
          _setHintHtml(baseHtml + extraHtml);
        }
      } else {
        _inactiveBtn(selectBtn, "text-[20px]");
        _inactiveBtn(brushBtn, "text-[22px]");
        _activeBtn(panBtn, "text-[22px]");
        if (undoBtn) {
          const canUndo =
            (Array.isArray(state.actionHistory) && state.actionHistory.length > 0) ||
            (Array.isArray(state.activeStroke) && state.activeStroke.length > 0);
          undoBtn.style.opacity = canUndo ? "1" : "0.4";
          undoBtn.style.pointerEvents = canUndo ? "auto" : "none";
        }
        clearBtn.title = "Очистить всё";
        clearIcon.textContent = "delete";

        hint.className =
          "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-surface-1 dark:bg-surface-1 border border-border-strong dark:border-border-strong rounded-lg text-sm text-text-secondary dark:text-text-on-dark";
        _setHintIcon("info", "material-symbols-outlined text-text-secondary dark:text-text-on-dark");
      }

    };

    if (_requiresDrawing()) {
      // Level 3: contour drawing only (no click tool)
      selectBtn.classList.add("hidden");
      _setMode("brush");
    } else {
      _setMode("click");
    }
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    _applyUserMarksVisibility();
    _updateLiveProgress();
    _renderLabelsInputs(null);

    return root;
  };

  ClickUI.render = function render(container, taskDto, options) {
    const taskType = _getTaskType(taskDto);
    if (taskType !== "click" && taskType !== "draw") return;

    const root = ClickUI.createRoot(container, taskDto, options);
    container.appendChild(root);
  };

  ClickUI.getUserAnswerPayload = function getUserAnswerPayload() {
    const taskDto = state.taskDto;
    const answerKey = (taskDto && taskDto.answer_key) || {};
    const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];

    const clicks = state.clicks.map((c) => ({
      x: c.x,
      y: c.y,
      scale_factor: 1.0,
      offset_x: 0.0,
      offset_y: 0.0,
    }));

    const payload = {
      clicks,
      found_targets: [],
      total_targets: targets.length,
    };

    if (_requiresDrawing()) {
      if (state.img) {
        payload.image_width = state.img.naturalWidth || null;
        payload.image_height = state.img.naturalHeight || null;
      }
      payload.brush_radius = state.brushRadius != null ? state.brushRadius : 8;

      if (Array.isArray(state.polygons) && state.polygons.length) {
        payload.polygons = state.polygons
          .map((p) => ({ points: (p && Array.isArray(p.points) ? p.points : []).filter(Boolean) }))
          .filter((p) => Array.isArray(p.points) && p.points.length >= 3);
      }
    }

    if (Array.isArray(state.lines) && state.lines.length) {
      payload.lines = state.lines
        .map((l) => {
          const pts = (l && Array.isArray(l.points) ? l.points : []).filter(Boolean);
          return { points: pts };
        })
        .filter((l) => Array.isArray(l.points) && l.points.length >= 2);
    }

    if (_requiresLabels() && _hasAnyUserMarks()) {
      _ensureLabelsLengths();
      if (_requiresDrawing()) {
        payload.labels_polygons = (state.labelsPolygons || []).map((s) => String(s || "").trim());
        payload.labels_lines = (state.labelsLines || []).map((s) => String(s || "").trim());
      } else {
        payload.labels_clicks = (state.labelsClicks || []).map((s) => String(s || "").trim());
        payload.labels_lines = (state.labelsLines || []).map((s) => String(s || "").trim());
      }
    }

    if (
      !payload.clicks.length &&
      !(payload.polygons && payload.polygons.length) &&
      !(payload.lines && payload.lines.length)
    ) {
      return {};
    }

    return payload;
  };

  ClickUI.applyCheckFeedback = function applyCheckFeedback(result) {
    state.locked = true;

    if (!result || !result.details || typeof result.details !== "object") {
      return;
    }

    const details = result.details;

    const foundTargets =
      (Array.isArray(details.found_targets) && details.found_targets) ||
      (Array.isArray(details.foundTargets) && details.foundTargets) ||
      null;

    const error = details.error || null;

    const stage = details.stage || null;

    const bad = new Set();
    try {
      const clickResults = Array.isArray(details.click_results) ? details.click_results : [];
      const lineResults = Array.isArray(details.line_results) ? details.line_results : [];

      const taskDto = state.taskDto;
      const answerKey = (taskDto && taskDto.answer_key) || {};
      const targets = Array.isArray(answerKey.targets) ? answerKey.targets : [];

      function _inferShapeLower(t) {
        const s = (t && (t.shape || t.type)) || "";
        let sl = String(s).toLowerCase();
        if (!sl && t && Array.isArray(t.points)) {
          if (t.points.length >= 3) sl = "polygon";
          else if (t.points.length >= 2) sl = "freehand";
        }
        return sl;
      }

      clickResults.forEach((r) => {
        if (!r || typeof r !== "object") return;
        const idx = typeof r.target_index === "number" ? r.target_index : null;
        const ok = r.click_success === true;
        if (idx == null || ok) return;
        const shape = _inferShapeLower(targets[idx]);
        if (shape === "polygon") bad.add(idx);
      });

      lineResults.forEach((r) => {
        if (!r || typeof r !== "object") return;
        const idx = typeof r.target_index === "number" ? r.target_index : null;
        const ok = r.line_success === true;
        if (idx == null || ok) return;
        const shape = _inferShapeLower(targets[idx]);
        if (shape === "freehand") bad.add(idx);
      });
    } catch (e) {
      // ignore
    }

    state.badRefTargets = bad.size ? bad : null;
    if (stage === "lines" || error === "lines_missing") {
      state.locked = false;
      _setMode("brush");
    }

    if (stage === "clicks") {
      state.locked = false;
      _setMode("click");
    }

    if (state.checkStatusEl) {
      const isFinal = stage !== "lines" && error !== "lines_missing";
      if (isFinal && typeof result.message === "string" && result.message.trim()) {
        state.checkStatusEl.textContent = result.message;
        state.checkStatusEl.className =
          result.success === true
            ? "text-xs font-semibold text-success-text dark:text-success"
            : "text-xs font-semibold text-error-text dark:text-error";
      } else {
        state.checkStatusEl.textContent = "";
      }
    }

    if (stage !== "lines" && error !== "lines_missing") {
      const hintEl = state.root ? state.root.querySelector('[data-clickui="hint"]') : null;
      if (hintEl) {
        hintEl.classList.add("hidden");
      }
    }

    // После любой проверки показываем референсные цели с возможностью выключить.
    state.showRef = true;
    state.showRefContours = true;
    state.showRefPolygons = true;
    state.showRefLines = true;
    state.userLinesCheckedStyle = true;
    state.userMarksCheckedStyle = true;
    // For L3 we keep user contours/strokes visible after check.
    state.showUserMarks = _requiresDrawing();
    if (state.root) {
      const toggles = state.root.querySelector('[data-clickui="ref-toggles"]');
      if (toggles) {
        toggles.classList.remove("hidden");
      }

      const chk = state.root.querySelector('[data-clickui="ref-show"]');
      if (chk && chk instanceof HTMLInputElement) {
        chk.checked = true;
      }

      const chkUser = state.root.querySelector('[data-clickui="user-marks"]');
      if (chkUser && chkUser instanceof HTMLInputElement) {
        chkUser.checked = false;
      }

      const chkPolys = state.root.querySelector('[data-clickui="ref-polygons"]');
      if (chkPolys && chkPolys instanceof HTMLInputElement) {
        chkPolys.checked = state.showRefPolygons;
      }

      const chkLines = state.root.querySelector('[data-clickui="ref-lines"]');
      if (chkLines && chkLines instanceof HTMLInputElement) {
        chkLines.checked = state.showRefLines;
      }
    }

    if (_debugEnabled()) {
      try {
        const flags = {
          showRef: state.showRef,
          showRefContours: state.showRefContours,
          showRefPolygons: state.showRefPolygons,
          showRefLines: state.showRefLines,
          showRefLabels: state.showRefLabels,
          badRefTargets: state.badRefTargets instanceof Set ? Array.from(state.badRefTargets) : null,
        };
        try {
          window.__CLICKUI_LAST_REF_FLAGS = flags;
        } catch (e) {
          // ignore
        }
        console.log("[ClickUI][applyCheckFeedback] ref flags", flags);
        try {
          console.log("[ClickUI][applyCheckFeedback] ref flags JSON\n" + JSON.stringify(flags, null, 2));
        } catch (e) {
          // ignore
        }

        _clientLog("ref_flags", flags);
      } catch (e) {
        // ignore
      }
    }

    _applyUserMarksVisibility();

    if (error === "labels_missing") {
      state.locked = false;
      state.highlightLabelErrors = true;
    } else {
      state.highlightLabelErrors = false;
    }

    // Capture label correctness from evaluator (if provided) for green/red highlighting.
    state.labelEval = null;
    try {
      const labelsBlock = details.labels && typeof details.labels === "object" ? details.labels : null;
      const matched = labelsBlock && Array.isArray(labelsBlock.matched_labels) ? labelsBlock.matched_labels : [];
      const unmatched = labelsBlock && Array.isArray(labelsBlock.unmatched_labels) ? labelsBlock.unmatched_labels : [];
      if (matched.length || unmatched.length) {
        state.labelEval = {
          matched: new Set(matched.map((t) => (Array.isArray(t) ? t[0] : null)).filter((x) => typeof x === "number")),
          unmatched: new Set(
            unmatched.map((t) => (Array.isArray(t) ? t[0] : null)).filter((x) => typeof x === "number")
          ),
          success: labelsBlock.success === true,
        };
      }
    } catch (e) {
      // ignore
    }
    _renderLabelsInputs(null);

    const success = result.success === true;
    if (state.markerLayer) {
      if (success) {
        state.markerLayer.classList.add("opacity-100");
      } else {
        state.markerLayer.classList.add("opacity-100");
      }
    }

    _renderMarkers();
    _renderDrawing();
    _renderReference();

    if (_debugEnabled()) {
      try {
        console.log("[ClickUI][applyCheckFeedback] after _renderReference", {
          refLayerChildren: state.refLayer && state.refLayer.childNodes ? state.refLayer.childNodes.length : null,
        });
      } catch (e) {
        // ignore
      }
    }
  };

  // Phase 2: Cleanup method to prevent memory leaks
  ClickUI.cleanup = function cleanup() {
    // Teardown additional modal if exists
    _teardownAdditionalModal();

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }

    // Reset state object to initial values
    Object.assign(state, {
      taskDto: null,
      container: null,
      canvas: null,
      ctx: null,
      image: null,
      clicks: [],
      labels: {},
      targets: [],
      foundClickTargets: new Set(),
      maxClicks: 0,
      locked: false,
      mode: "click",
      zoom: 1,
      panX: 0,
      panY: 0,
      isPointerDown: false,
      panStart: null,
      showRef: false,
      showRefContours: true,
      showRefLabels: true,
      showUserMarks: true,
      badRefTargets: null,
      polygons: [],
      lines: [],
      actionHistory: [],
      activeStroke: null,
      labelsPolygons: [],
      labelsLines: [],
      labelsClicks: [],
      labelsInputs: [],
      highlightLabelErrors: false,
      labelEval: null,
      soloDuringDraw: false,
      brushRadius: 8,
      maxPolygons: 0,
      maxStrokes: 0,
      targetColors: [],
      targetRows: [],
      targetsProgress: null,
      additionalModal: null,
      additionalModalKeyHandler: null,
      _themeListener: null,
    });

    // Note: Window event listeners (pointermove, pointerup, pointercancel) are attached
    // in createRoot (lines 2869-2871) as anonymous functions, so we cannot remove them.
    // This is a known limitation. For a complete fix, we would need to store references.
    // However, these listeners check state.isPointerDown and state.locked, so they won't
    // do much work when not actively interacting. The memory leak is minimal.
    // Event listeners on DOM elements will be garbage collected when elements are removed.
  };

  global.ClickUI = ClickUI;
})(window);

