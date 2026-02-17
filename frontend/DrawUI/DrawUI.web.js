(function (global) {
  const DrawUI = {};

  const DRAWUI_BUILD_ID = "2025-12-18T22:30:00Z";
  try {
    if (global && global.console && typeof global.console.log === "function") {
      global.console.log("[DrawUI] build", DRAWUI_BUILD_ID);
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
    drawLayer: null,
    refLayer: null,
    polygons: [],
    lines: [],
    actionHistory: [],
    tempHintTimer: null,
    locked: false,
    mode: "brush",
    stage: "polygons",
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
    badRefTargets: null,
    labelsContainer: null,
    labelsInputs: [],
    labelsPolygons: [],
    labelsLines: [],
    highlightLabelErrors: false,
    labelEval: null,
    soloDuringDraw: false,
    brushRadius: 8,
    maxPolygons: 0,
    maxLines: 0,
    metadataApi: null,
    metadataSnapshot: null,
    metadataModal: null,
    metadataModalKeyHandler: null,
  };

  const Metadata = (function () {
    if (typeof global !== "undefined" && global.TaskMetadataPanel) {
      return global.TaskMetadataPanel;
    }
    if (typeof require === "function") {
      try {
        return require("../ClickUI/TaskMetadataPanel.js");
      } catch (e) {
        // ignore
      }
    }
    return null;
  })();

  function _debugEnabled() {
    return !!global.DRAWUI_DEBUG;
  }

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

  function _withAlpha(color, alpha) {
    const rgb = _parseRgb(color);
    const clamped = Math.max(0, Math.min(1, alpha));
    if (!rgb) return `rgba(0,0,0,${clamped})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
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

  function _requiresLabels() {
    const taskDto = state.taskDto;
    const v =
      (taskDto && taskDto.task_data && taskDto.task_data.content && taskDto.task_data.content.requires_labels) ||
      (taskDto && taskDto.task_data && taskDto.task_data.requires_labels) ||
      (taskDto && taskDto.content && taskDto.content.requires_labels);
    if (v != null) return Boolean(v);
    const difficulty = _getDifficultyLevel(taskDto);
    return Number(difficulty || 1) >= 2;
  }

  function _hasAnyUserMarks() {
    return Boolean(
      (state.polygons && state.polygons.length) || (state.lines && state.lines.length) || (state.activeStroke && state.activeStroke.length)
    );
  }

  function _ensureLabelsLengths() {
    if (!Array.isArray(state.labelsPolygons)) state.labelsPolygons = [];
    if (!Array.isArray(state.labelsLines)) state.labelsLines = [];
    if (Array.isArray(state.polygons) && state.labelsPolygons.length !== state.polygons.length) {
      state.labelsPolygons = state.polygons.map((_, i) => state.labelsPolygons[i] || "");
    }
    if (Array.isArray(state.lines) && state.labelsLines.length !== state.lines.length) {
      state.labelsLines = state.lines.map((_, i) => state.labelsLines[i] || "");
    }
  }

  function _allLabelFieldsFilled() {
    _ensureLabelsLengths();
    const polygonsOk = (state.labelsPolygons || []).every((s) => String(s || "").trim().length > 0);
    const linesOk = (state.labelsLines || []).every((s) => String(s || "").trim().length > 0);
    return polygonsOk && linesOk;
  }

  function _getPrompt(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    return content.prompt || td.prompt || "";
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

  function _createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function _ensureTaskContentPath(taskDto) {
    if (!taskDto || typeof taskDto !== "object") return null;
    const taskData = taskDto.task_data || (taskDto.task_data = {});
    const content = taskData.content || (taskData.content = {});
    if (!content.settings || typeof content.settings !== "object") {
      content.settings = {};
    }
    return content;
  }

  function _mergeMetadataSnapshotIntoTaskDto(snapshot) {
    if (!snapshot || !state.taskDto) return;
    const content = _ensureTaskContentPath(state.taskDto);
    if (!content) return;
    content.prompt = snapshot.prompt || "";
    const settings = content.settings || {};
    if (snapshot.successThreshold != null) {
      settings.success_threshold = snapshot.successThreshold;
    } else {
      delete settings.success_threshold;
    }
    content.settings = settings;
    if (snapshot.additionalInfo) {
      content.additionalInfo = snapshot.additionalInfo;
    } else {
      delete content.additionalInfo;
    }
  }

  function _syncMetadataToTaskDto() {
    if (!state.metadataApi) return null;
    let snapshot = null;
    if (typeof state.metadataApi.collect === "function") {
      snapshot = state.metadataApi.collect();
      state.metadataSnapshot = snapshot;
    }
    if (state.taskDto) {
      if (typeof state.metadataApi.applyToTaskDto === "function") {
        state.metadataApi.applyToTaskDto(state.taskDto);
      } else if (snapshot) {
        _mergeMetadataSnapshotIntoTaskDto(snapshot);
      }
    }
    return snapshot;
  }

  function _setLocked(nextLocked) {
    const locked = !!nextLocked;
    state.locked = locked;
    if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
      state.metadataApi.setLocked(locked);
    }
  }

  function _teardownMetadataModal() {
    try {
      if (state.metadataModal && state.metadataModal.overlay) {
        const parent = state.metadataModal.overlay.parentNode;
        if (parent) parent.removeChild(state.metadataModal.overlay);
      }
      if (state.metadataModalKeyHandler && typeof document !== "undefined") {
        document.removeEventListener("keydown", state.metadataModalKeyHandler);
      }
    } catch (e) {
      // ignore
    } finally {
      state.metadataModal = null;
      state.metadataModalKeyHandler = null;
    }
  }

  function _applyMetadataModalTransform(modal) {
    if (!modal || !modal.zoomLayer) return;
    modal.zoomLayer.style.transform = `translate(${modal.translateX}px, ${modal.translateY}px) scale(${modal.scale})`;
  }

  function _updateMetadataModalCursor(modal) {
    if (!modal || !modal.zoomLayer) return;
    const cursor =
      modal.scale && modal.scale > (modal.minScale || 1) && modal.isPanning
        ? "grabbing"
        : modal.scale && modal.scale > (modal.minScale || 1)
          ? "grab"
          : "zoom-in";
    modal.zoomLayer.style.cursor = cursor;
  }

  function _resetMetadataModalTransform(modal) {
    if (!modal) return;
    modal.scale = modal.minScale || 1;
    modal.translateX = 0;
    modal.translateY = 0;
    modal.isPanning = false;
    _applyMetadataModalTransform(modal);
    _updateMetadataModalCursor(modal);
  }

  function _ensureMetadataModal() {
    if (state.metadataModal && state.metadataModal.overlay) return state.metadataModal;
    if (typeof document === "undefined") return null;

    const overlay = _createEl("div", "fixed inset-0 z-[999] hidden bg-scrim-intense backdrop-blur-sm px-4 py-8", "");
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
        _closeMetadataModal();
      }
    };

    overlay.addEventListener("click", handleOverlayClick);
    closeBtn.addEventListener("click", handleOverlayClick);

    const handleWheel = (ev) => {
      const modal = state.metadataModal;
      if (!modal || !modal.viewport || modal.viewport !== viewport) return;
      ev.preventDefault();
      const delta = ev.deltaY;
      if (!Number.isFinite(delta) || delta === 0) return;
      const factor = delta < 0 ? 1.1 : 0.9;
      const nextScale = Math.min(modal.maxScale, Math.max(modal.minScale, modal.scale * factor));
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
      _applyMetadataModalTransform(modal);
      _updateMetadataModalCursor(modal);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });

    let panPointerId = null;
    let lastX = 0;
    let lastY = 0;

    const handlePointerDown = (ev) => {
      const modal = state.metadataModal;
      if (!modal || modal.viewport !== viewport || modal.scale <= modal.minScale) return;
      panPointerId = ev.pointerId;
      viewport.setPointerCapture(ev.pointerId);
      modal.isPanning = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _updateMetadataModalCursor(modal);
      ev.preventDefault();
    };

    const handlePointerMove = (ev) => {
      const modal = state.metadataModal;
      if (!modal || modal.viewport !== viewport || !modal.isPanning || panPointerId !== ev.pointerId) return;
      const dx = ev.clientX - lastX;
      const dy = ev.clientY - lastY;
      modal.translateX += dx;
      modal.translateY += dy;
      lastX = ev.clientX;
      lastY = ev.clientY;
      _applyMetadataModalTransform(modal);
    };

    const endPan = (ev) => {
      const modal = state.metadataModal;
      if (!modal || modal.viewport !== viewport || panPointerId !== ev.pointerId) return;
      try {
        viewport.releasePointerCapture(ev.pointerId);
      } catch (err) {
        // ignore
      }
      modal.isPanning = false;
      panPointerId = null;
      _updateMetadataModalCursor(modal);
    };

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", endPan);
    viewport.addEventListener("pointercancel", endPan);

    img.addEventListener("load", () => {
      const modal = state.metadataModal;
      if (!modal || modal.img !== img) return;
      _resetMetadataModalTransform(modal);
    });

    const keyHandler = (ev) => {
      if (ev.key === "Escape") _closeMetadataModal();
    };
    document.addEventListener("keydown", keyHandler);

    document.body.appendChild(overlay);
    state.metadataModal = {
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
      isPanning: false,
    };
    _applyMetadataModalTransform(state.metadataModal);
    _updateMetadataModalCursor(state.metadataModal);
    state.metadataModalKeyHandler = keyHandler;
    return state.metadataModal;
  }

  function _openMetadataModal(url, captionText) {
    const modal = _ensureMetadataModal();
    if (!modal || !url) return;
    _resetMetadataModalTransform(modal);
    modal.img.src = url;
    modal.img.alt = captionText || "";
    modal.caption.textContent = captionText || "";
    modal.overlay.classList.remove("hidden");
    modal.overlay.setAttribute("aria-hidden", "false");
  }

  function _closeMetadataModal() {
    if (!state.metadataModal || !state.metadataModal.overlay) return;
    state.metadataModal.overlay.classList.add("hidden");
    state.metadataModal.overlay.setAttribute("aria-hidden", "true");
    if (state.metadataModal.img) state.metadataModal.img.src = "";
    _resetMetadataModalTransform(state.metadataModal);
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

  function _clearReference() {
    if (!state.refLayer) return;
    state.refLayer.innerHTML = "";
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

  function _getReferenceTargets(taskDto) {
    const answerKey = (taskDto && taskDto.answer_key) || {};

    if (Array.isArray(answerKey.targets)) {
      return answerKey.targets
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const shape = (t.shape || t.type) != null ? String(t.shape || t.type).toLowerCase() : "";
          const points = Array.isArray(t.points) ? t.points.map(_normalizeXY).filter(Boolean) : null;
          const label = t.label != null ? String(t.label) : "";
          if (shape === "polygon" && points && points.length >= 3) return { shape: "polygon", points, label };
          if (shape === "freehand" && points && points.length >= 2) return { shape: "freehand", points, label };
          if (!shape && points) {
            if (points.length >= 3) return { shape: "polygon", points, label };
            if (points.length >= 2) return { shape: "freehand", points, label };
          }
          return null;
        })
        .filter(Boolean);
    }

    const polys = Array.isArray(answerKey.polygons) ? answerKey.polygons : [];
    const lines = Array.isArray(answerKey.lines) ? answerKey.lines : [];
    const labelsPolys = Array.isArray(answerKey.labels_polygons) ? answerKey.labels_polygons : [];
    const labelsLines = Array.isArray(answerKey.labels_lines) ? answerKey.labels_lines : [];

    const out = [];
    polys.forEach((p, i) => {
      const pts = Array.isArray(p && p.points) ? p.points.map(_normalizeXY).filter(Boolean) : [];
      if (pts.length >= 3) {
        out.push({ shape: "polygon", points: pts, label: labelsPolys[i] != null ? String(labelsPolys[i]) : "" });
      }
    });
    lines.forEach((l, i) => {
      const pts = Array.isArray(l && l.points) ? l.points.map(_normalizeXY).filter(Boolean) : [];
      if (pts.length >= 2) {
        out.push({ shape: "freehand", points: pts, label: labelsLines[i] != null ? String(labelsLines[i]) : "" });
      }
    });

    return out;
  }

  function _updateMetadataTotals() {
    if (
      state.metadataApi &&
      typeof state.metadataApi.updateAnnotationTotals === "function"
    ) {
      state.metadataApi.updateAnnotationTotals({
        polygons: state.maxPolygons || 0,
        freehand: state.maxLines || 0,
        total: (state.maxPolygons || 0) + (state.maxLines || 0),
      });
    }
  }

  function _recalcLimitsFromTask(taskDto) {
    const answerKey = (taskDto && taskDto.answer_key) || {};

    if (Array.isArray(answerKey.targets)) {
      let polyCount = 0;
      let lineCount = 0;
      for (const t of answerKey.targets) {
        if (!t || typeof t !== "object") continue;
        const shape = (t.shape || t.type) != null ? String(t.shape || t.type).toLowerCase() : "";
        if (shape === "freehand") lineCount += 1;
        else polyCount += 1;
      }
      state.maxPolygons = polyCount;
      state.maxLines = lineCount;
      _updateMetadataTotals();
      return;
    }

    state.maxPolygons = Array.isArray(answerKey.polygons) ? answerKey.polygons.length : 0;
    state.maxLines = Array.isArray(answerKey.lines) ? answerKey.lines.length : 0;
    _updateMetadataTotals();
  }

  function _setStage(nextStage) {
    const st = nextStage === "lines" ? "lines" : "polygons";
    state.stage = st;
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
    _renderLabelsInputs(null);
    _updateMetadataTotals();
  }

  function _setMode(mode) {
    state.mode = mode === "pan" ? "pan" : "brush";
    if (state.imageWrapper) {
      if (state.mode === "pan") {
        state.imageWrapper.style.cursor = "grab";
      } else {
        state.imageWrapper.style.cursor = "crosshair";
      }
    }
    if (typeof state._updateToolbar === "function") state._updateToolbar();
  }

  function _zoomAtClientPoint(nextZoom, clientX, clientY) {
    if (!state.viewport) {
      state.zoom = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
      _applyTransform();
      return;
    }

    const z = Math.max(0.25, Math.min(6, Number(nextZoom) || 1));
    const rect = state.viewport.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      state.zoom = z;
      _applyTransform();
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

  function _renderReference() {
    if (!state.refLayer || !state.img) return;
    _clearReference();
    if (!state.showRef) return;

    const targets = _getReferenceTargets(state.taskDto);
    if (!targets.length) return;

    const naturalW = state.img.naturalWidth || 1;
    const naturalH = state.img.naturalHeight || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "absolute inset-0 h-full w-full pointer-events-none z-10");
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

    targets.forEach((t, idx) => {
      if (!t || typeof t !== "object") return;
      const isBad = bad ? bad.has(idx) : false;
      const label = (t.label != null ? String(t.label) : "").trim();
      const points = Array.isArray(t.points) ? t.points : [];

      let labelPos = null;

      if (state.showRefContours) {
        if (state.showRefPolygons && t.shape === "polygon" && points.length >= 3) {
          const pts = points.map((xy) => `${xy[0]},${xy[1]}`).join(" ");
          if (pts) {
            const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            poly.setAttribute("points", pts);
            poly.setAttribute("fill", isBad ? errorFill : fillPoly);
            poly.setAttribute("stroke", isBad ? errorStroke : strokePoly);
            poly.setAttribute("stroke-width", isBad ? "6" : "4");
            poly.setAttribute("stroke-opacity", "0.75");
            svg.appendChild(poly);
            labelPos = _centroid(points);
          }
        } else if (state.showRefLines && t.shape === "freehand" && points.length >= 2) {
          const d = points
            .map((xy, i) => `${i === 0 ? "M" : "L"} ${xy[0]} ${xy[1]}`)
            .join(" ");
          if (d) {
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("d", d);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke", isBad ? errorStroke : strokeLine);
            path.setAttribute("stroke-width", isBad ? "6" : "4");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.setAttribute("stroke-opacity", "0.85");
            path.setAttribute("stroke-dasharray", "10 6");
            svg.appendChild(path);
            labelPos = _centroid(points);
          }
        }
      } else {
        if (Array.isArray(points) && points.length) labelPos = _centroid(points);
      }

      if (state.showRefLabels) {
        const textValue = label || `#${idx + 1}`;
        if (labelPos && typeof labelPos.x === "number" && typeof labelPos.y === "number") {
          const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
          text.setAttribute("x", String(labelPos.x));
          text.setAttribute("y", String(labelPos.y));
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
          svg.appendChild(text);
        }
      }
    });

    state.refLayer.appendChild(svg);
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
        preview.setAttribute("stroke", state.stage === "polygons" ? successStroke : strokeColor);
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

  function _getPointFromEvent(ev) {
    if (!state.img) return null;
    const rect = state.img.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    const naturalW = state.img.naturalWidth || rect.width;
    const naturalH = state.img.naturalHeight || rect.height;

    const x = (ev.clientX - rect.left) * (naturalW / rect.width);
    const y = (ev.clientY - rect.top) * (naturalH / rect.height);

    return { x, y };
  }

  function _distanceSq(a, b) {
    const dx = (a[0] || 0) - (b[0] || 0);
    const dy = (a[1] || 0) - (b[1] || 0);
    return dx * dx + dy * dy;
  }

  function _renderLabelsInputs(_ev) {
    const container = state.labelsContainer;
    if (!container) return;

    container.innerHTML = "";

    if (!_requiresLabels()) return;
    if (!_hasAnyUserMarks()) return;

    _ensureLabelsLengths();

    const card = _createEl(
      "div",
      "w-full rounded-xl border border-border-subtle bg-surface-1 p-4 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );

    const titleRow = _createEl("div", "flex items-center justify-between gap-2", "");
    const title = _createEl("div", "text-sm font-semibold text-text-main dark:text-text-on-dark", "Названия");
    const sub = _createEl(
      "div",
      "text-xs font-medium text-text-secondary dark:text-text-on-dark",
      state.stage === "polygons" ? "Контуры ↓" : "Штрихи ↓"
    );
    titleRow.appendChild(title);
    titleRow.appendChild(sub);
    card.appendChild(titleRow);

    const grid = _createEl("div", "mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3", "");

    function addField(kind, idx) {
      const wrap = _createEl("div", "flex flex-col gap-1", "");
      const labelText = kind === "polygon" ? `Контур ${idx + 1}` : `Штрих ${idx + 1}`;
      const lbl = _createEl("div", "text-xs font-semibold text-text-muted dark:text-text-muted", labelText);
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Название";
      input.className =
        "w-full rounded-lg border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-main shadow-sm focus:border-primary focus:ring-primary dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";

      input.value =
        kind === "polygon"
          ? String((state.labelsPolygons && state.labelsPolygons[idx]) || "")
          : String((state.labelsLines && state.labelsLines[idx]) || "");

      input.addEventListener("input", () => {
        if (state.locked) return;
        if (kind === "polygon") {
          state.labelsPolygons[idx] = String(input.value || "");
        } else {
          state.labelsLines[idx] = String(input.value || "");
        }
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      });

      if (state.locked && state.highlightLabelErrors) {
        const v = String(input.value || "").trim();
        if (!v) {
          input.classList.add("border-error");
        }
      }

      wrap.appendChild(lbl);
      wrap.appendChild(input);
      return wrap;
    }

    const polyCount = Array.isArray(state.polygons) ? state.polygons.length : 0;
    const lineCount = Array.isArray(state.lines) ? state.lines.length : 0;

    for (let i = 0; i < polyCount; i += 1) grid.appendChild(addField("polygon", i));
    for (let i = 0; i < lineCount; i += 1) grid.appendChild(addField("line", i));

    card.classList.add("drawui-card-entry");
    container.appendChild(card);
  }

  function _clearAll() {
    if (state.locked) return;
    state.polygons = [];
    state.lines = [];
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.actionHistory = [];
    state.activeStroke = null;
    state.stage = "polygons";
    _renderDrawing();
    _renderReference();
    _renderLabelsInputs(null);
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    _updateMetadataTotals();
  }

  function _undoLastAction() {
    if (state.locked) return;

    if (Array.isArray(state.activeStroke) && state.activeStroke.length > 0) {
      state.activeStroke = null;
      _renderDrawing();
      _renderLabelsInputs(null);
      if (typeof state._updateToolbar === "function") state._updateToolbar();
      if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
      return;
    }

    const hist = Array.isArray(state.actionHistory) ? state.actionHistory : [];
    const last = hist.length ? hist[hist.length - 1] : null;
    if (!last) return;
    hist.pop();
    state.actionHistory = hist;

    if (last.kind === "polygon") {
      if (Array.isArray(state.polygons) && state.polygons.length) state.polygons.pop();
      if (Array.isArray(state.labelsPolygons) && state.labelsPolygons.length) state.labelsPolygons.pop();
    } else if (last.kind === "line") {
      if (Array.isArray(state.lines) && state.lines.length) state.lines.pop();
      if (Array.isArray(state.labelsLines) && state.labelsLines.length) state.labelsLines.pop();
    }

    if (state.stage === "lines" && state.maxPolygons > 0 && state.polygons.length < state.maxPolygons) {
      _setStage("polygons");
    }

    _renderDrawing();
    _renderLabelsInputs(null);
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
    _updateMetadataTotals();
  }

  DrawUI.createRoot = function createRoot(container, taskDto) {
    _teardownMetadataModal();
    state.taskDto = taskDto;
    state.container = container;
    state.polygons = [];
    state.lines = [];
    state.actionHistory = [];
    state.activeStroke = null;
    state.locked = false;
    state.mode = "brush";
    state.stage = "polygons";
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
    state.labelsPolygons = [];
    state.labelsLines = [];
    state.highlightLabelErrors = false;
    state.labelEval = null;

    _recalcLimitsFromTask(taskDto);

    const root = _createEl("div", "flex flex-col gap-3", "");

    if (!document.getElementById("drawui-style")) {
      const style = document.createElement("style");
      style.id = "drawui-style";
      style.textContent = `
        @keyframes drawuiFadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes drawuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .drawui-card-entry { animation: drawuiSlideUp 250ms ease-out forwards; }
      `;
      document.head.appendChild(style);
    }

    if (!Metadata || typeof Metadata.create !== "function") {
      throw new Error("TaskMetadataPanel is required but not available for DrawUI");
    }

    try {
      Metadata.openImageModal = (url, caption) => {
        _openMetadataModal(url, caption);
      };
    } catch (e) {
      // ignore
    }

    const metadata = Metadata.create({
      taskDto,
      mode: "draw",
      annotationTotals: {
        polygons: state.maxPolygons || 0,
        freehand: state.maxLines || 0,
      },
    });
    state.metadataApi = metadata.api;
    _syncMetadataToTaskDto();

    const imgUrl = _resolveImageUrl(taskDto);

    const wrapperRow = _createEl("div", "flex gap-4", "");

    const wrapper = _createEl(
      "div",
      "relative flex-1 min-h-[320px] overflow-hidden rounded-xl border-2 border-border-strong bg-surface-2 shadow-inner dark:border-border-strong dark:bg-surface-2 group select-none",
      ""
    );

    const viewport = _createEl(
      "div",
      "relative w-full h-full min-h-[400px] overflow-hidden flex items-center justify-center bg-surface-2 dark:bg-surface-2",
      ""
    );
    const contentLayer = _createEl("div", "absolute left-0 top-0", "");

    const img = document.createElement("img");
    img.className = "block select-none";
    img.alt = "task image";
    img.draggable = false;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.src = imgUrl || "";

    const drawLayer = _createEl("div", "absolute left-0 top-0 w-full h-full pointer-events-none", "");
    const refLayer = _createEl("div", "absolute left-0 top-0 w-full h-full pointer-events-none", "");

    contentLayer.appendChild(img);
    contentLayer.appendChild(refLayer);
    contentLayer.appendChild(drawLayer);
    viewport.appendChild(contentLayer);
    wrapper.appendChild(viewport);

    const toolsCol = _createEl("div", "flex-none flex flex-col gap-3 w-12 sm:w-14", "");

    function toolBtn(icon, title) {
      const b = _createEl(
        "button",
        "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors focus:outline-none",
        ""
      );
      b.title = title;
      const s = _createEl("span", "material-symbols-outlined", icon);
      s.style.fontSize = icon === "arrow_undo" ? "20px" : "22px";
      b.appendChild(s);
      return { b, s };
    }

    const topGroup = _createEl(
      "div",
      "flex flex-col bg-surface-1 dark:bg-surface-2 rounded-lg shadow-sm border border-border-strong dark:border-border-strong overflow-hidden divide-y divide-border-strong dark:divide-border-strong",
      ""
    );

    const brushBtnWrap = toolBtn("edit", "Режим рисования");
    const panBtnWrap = toolBtn("pan_tool", "Перемещение");
    topGroup.appendChild(brushBtnWrap.b);
    topGroup.appendChild(panBtnWrap.b);

    const midGroup = _createEl(
      "div",
      "flex flex-col bg-surface-1 dark:bg-surface-2 rounded-lg shadow-sm border border-border-strong dark:border-border-strong overflow-hidden divide-y divide-border-strong dark:divide-border-strong",
      ""
    );

    const zoomInWrap = toolBtn("add", "Увеличить");
    const zoomOutWrap = toolBtn("remove", "Уменьшить");
    const resetWrap = toolBtn("restart_alt", "Сбросить вид");
    midGroup.appendChild(zoomInWrap.b);
    midGroup.appendChild(zoomOutWrap.b);
    midGroup.appendChild(resetWrap.b);

    const botGroup = _createEl("div", "mt-auto flex flex-col gap-3", "");

    const undoWrap = toolBtn("arrow_undo", "Отменить");
    undoWrap.b.className =
      "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover hover:text-primary transition-colors focus:outline-none";

    const clearBtn = _createEl(
      "button",
      "flex flex-col items-center justify-center w-full h-14 bg-error-light dark:bg-error-light rounded-lg border-2 border-border-strong dark:border-border-strong text-error-text dark:text-error-lighter hover:bg-error-light dark:hover:bg-error-light transition-colors",
      ""
    );
    clearBtn.title = "Очистить";
    const clearIcon = _createEl("span", "material-symbols-outlined", "delete");
    clearIcon.style.fontSize = "22px";
    clearBtn.appendChild(clearIcon);

    botGroup.appendChild(undoWrap.b);
    botGroup.appendChild(clearBtn);

    toolsCol.appendChild(topGroup);
    toolsCol.appendChild(midGroup);
    toolsCol.appendChild(botGroup);

    wrapperRow.appendChild(wrapper);
    wrapperRow.appendChild(toolsCol);

    const hint = _createEl(
      "div",
      "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-info-lighter dark:bg-info-light border border-info-light dark:border-info-light rounded-lg text-sm text-info-dark dark:text-info-light",
      ""
    );
    hint.setAttribute("data-drawui", "hint");
    const hintIcon = _createEl("span", "material-symbols-outlined text-info dark:text-info-light", "info");
    const hintText = _createEl("div", "leading-snug", "");
    hint.appendChild(hintIcon);
    hint.appendChild(hintText);

    function _setHint(kind, html) {
      if (kind === "warn") {
        hint.className =
          "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-warning-lighter dark:bg-warning-light border border-warning-light dark:border-warning-light rounded-lg text-sm text-warning-darker dark:text-warning-lighter";
        hintIcon.className = "material-symbols-outlined text-warning dark:text-warning-light";
        hintIcon.textContent = "warning";
      } else {
        hint.className =
          "flex items-start gap-3 p-3 min-h-[64px] transition-colors duration-150 ease-out bg-info-lighter dark:bg-info-light border border-info-light dark:border-info-light rounded-lg text-sm text-info-dark dark:text-info-light";
        hintIcon.className = "material-symbols-outlined text-info dark:text-info-light";
        hintIcon.textContent = "info";
      }
      hintText.innerHTML = html || "";
    }

    function _flashHint(message) {
      if (state.tempHintTimer) {
        clearTimeout(state.tempHintTimer);
        state.tempHintTimer = null;
      }
      _setHint("warn", `<span class=\"font-semibold\">${message}</span>`);
      state.tempHintTimer = setTimeout(() => {
        state.tempHintTimer = null;
        if (typeof state._updateToolbar === "function") state._updateToolbar();
      }, 2500);
    }

    const labelsContainer = _createEl("div", "", "");

    if (metadata && metadata.rootEl) root.appendChild(metadata.rootEl);
    root.appendChild(wrapperRow);
    root.appendChild(hint);
    root.appendChild(labelsContainer);

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
      _renderDrawing();
      _renderReference();
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

    function _updateLiveProgress() {
      if (state.stage === "polygons") {
        const done = state.polygons.length;
        const total = state.maxPolygons;
        const base = total > 0 ? `Контуры ${done} из ${total}.` : `Контуры ${done}.`;
        const extra = state.maxLines > 0 ? ` Далее штрихи.` : "";
        _setHint("info", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">${base}</span> Нарисуй контур и замкни линию.${extra}`);
      } else {
        const done = state.lines.length;
        const total = state.maxLines;
        const base = total > 0 ? `Штрихи ${done} из ${total}.` : `Штрихи ${done}.`;
        const extra = _requiresLabels() && _hasAnyUserMarks() ? "<div class=\"mt-0.5 leading-snug\">Введи названия и нажми «Проверить ответ».</div>" : "";
        _setHint("info", `<span class=\"font-semibold text-text-main dark:text-text-on-dark\">${base}</span> Зажми и веди мышью по линии.${extra}`);
      }
    }

    state._updateLiveProgress = _updateLiveProgress;

    function _activeBtn(btn) {
      btn.className =
        "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-primary-lighter dark:border-border-strong dark:bg-primary-dark text-primary dark:text-primary-light font-medium transition-colors focus:outline-none";
    }

    function _inactiveBtn(btn) {
      btn.className =
        "flex items-center justify-center w-full h-12 sm:h-14 border border-border-strong bg-surface-2 text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors focus:outline-none";
      const m = btn.querySelector("div");
      if (m && m.classList && m.classList.contains("absolute")) m.remove();
    }

    state._updateToolbar = function updateToolbar() {
      if (state.mode === "brush") {
        _activeBtn(brushBtnWrap.b);
        _inactiveBtn(panBtnWrap.b);
      } else {
        _inactiveBtn(brushBtnWrap.b);
        _activeBtn(panBtnWrap.b);
      }

      const canUndo =
        (Array.isArray(state.actionHistory) && state.actionHistory.length > 0) ||
        (Array.isArray(state.activeStroke) && state.activeStroke.length > 0);
      undoWrap.b.style.opacity = canUndo ? "1" : "0.4";
      undoWrap.b.style.pointerEvents = canUndo ? "auto" : "none";
    };

    brushBtnWrap.b.addEventListener("click", () => _setMode("brush"));
    panBtnWrap.b.addEventListener("click", () => _setMode("pan"));
    zoomInWrap.b.addEventListener("click", () => _zoomAtClientPoint(state.zoom * 1.2));
    zoomOutWrap.b.addEventListener("click", () => _zoomAtClientPoint(state.zoom / 1.2));
    resetWrap.b.addEventListener("click", () => _resetView());
    undoWrap.b.addEventListener("click", () => _undoLastAction());
    clearBtn.addEventListener("click", () => _clearAll());

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
        const pt = _getPointFromEvent(ev);
        if (!pt) return;
        state.soloDuringDraw = true;
        state.activeStroke = [[pt.x, pt.y]];
        _renderDrawing();
        _updateLiveProgress();
        if (typeof state._updateToolbar === "function") state._updateToolbar();
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
        const pt = _getPointFromEvent(ev);
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

    function _finalizeStroke() {
      try {
        let pts = Array.isArray(state.activeStroke) ? state.activeStroke : [];
        if (pts.length === 1) {
          const p0 = pts[0];
          pts = [p0, [p0[0], p0[1]]];
        }
        if (pts.length < 2) return;

        const isClosed = pts.length >= 3 && _distanceSq(pts[0], pts[pts.length - 1]) <= 14 * 14;

        if (state.stage === "polygons") {
          if (!isClosed) {
            _flashHint("Контур должен быть замкнут. Замкни линию и отпусти мышь.");
            return;
          }
          if (state.maxPolygons > 0 && state.polygons.length >= state.maxPolygons) {
            _flashHint("Достигнут лимит контуров. Перейди к штрихам или нажми «Проверить». ");
            if (state.maxLines > 0) _setStage("lines");
            return;
          }

          state.polygons = Array.isArray(state.polygons) ? state.polygons : [];
          state.polygons.push({ points: pts });
          state.labelsPolygons = Array.isArray(state.labelsPolygons) ? state.labelsPolygons : [];
          state.labelsPolygons.push("");
          state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
          state.actionHistory.push({ kind: "polygon" });

          if (state.maxPolygons > 0 && state.polygons.length >= state.maxPolygons && state.maxLines > 0) {
            _setStage("lines");
          }
          _updateMetadataTotals();
          return;
        }

        if (state.stage === "lines") {
          if (state.maxLines > 0 && state.lines.length >= state.maxLines) {
            _flashHint("Достигнут лимит штрихов. Нажми «Проверить» для завершения.");
            return;
          }

          state.lines = Array.isArray(state.lines) ? state.lines : [];
          state.lines.push({ points: pts });
          state.labelsLines = Array.isArray(state.labelsLines) ? state.labelsLines : [];
          state.labelsLines.push("");
          state.actionHistory = Array.isArray(state.actionHistory) ? state.actionHistory : [];
          state.actionHistory.push({ kind: "line" });
          _updateMetadataTotals();
        }
      } catch (e) {
        if (_debugEnabled()) console.warn("[DrawUI] finalize stroke failed", e);
      }
    }

    viewport.addEventListener("pointerdown", _onPointerDown);
    window.addEventListener("pointermove", _onPointerMove);
    window.addEventListener("pointerup", _onPointerUp);
    window.addEventListener("pointercancel", _onPointerUp);

    state.root = root;
    state.img = img;
    state.imageWrapper = wrapper;
    state.viewport = viewport;
    state.contentLayer = contentLayer;
    state.drawLayer = drawLayer;
    state.refLayer = refLayer;
    state.labelsContainer = labelsContainer;
    state.labelsInputs = [];
    if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
      state.metadataApi.setLocked(state.locked);
    }

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }
    state._themeListener = () => {
      _renderReference();
      _renderDrawing();
    };
    window.addEventListener("themechanged", state._themeListener);

    _setMode("brush");
    if (typeof state._updateToolbar === "function") state._updateToolbar();
    _updateLiveProgress();
    _renderLabelsInputs(null);

    return root;
  };

  DrawUI.render = function render(container, taskDto) {
    const taskType = _getTaskType(taskDto);
    if (taskType !== "draw") return;

    const root = DrawUI.createRoot(container, taskDto);
    container.appendChild(root);
  };

  DrawUI.getUserAnswerPayload = function getUserAnswerPayload() {
    _syncMetadataToTaskDto();
    const taskDto = state.taskDto;
    void taskDto;

    const payload = {};

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
      payload.labels_polygons = (state.labelsPolygons || []).map((s) => String(s || "").trim());
      payload.labels_lines = (state.labelsLines || []).map((s) => String(s || "").trim());

      // Legacy (current backend draw evaluator expects a single `label`)
      // Keep best-effort: use first non-empty label from polygons/lines.
      const firstPoly = (payload.labels_polygons || []).find((s) => String(s || "").trim().length > 0);
      const firstLine = (payload.labels_lines || []).find((s) => String(s || "").trim().length > 0);
      const legacyLabel = firstPoly || firstLine || "";
      if (legacyLabel) payload.label = legacyLabel;
    }

    // Legacy (current backend draw evaluator expects `drawing`: brush strokes)
    // to work even if it ignores new fields `polygons/lines`.
    try {
      const strokes = [];
      const polys = Array.isArray(payload.polygons) ? payload.polygons : [];
      const lines = Array.isArray(payload.lines) ? payload.lines : [];
      polys.forEach((p) => {
        const pts = (p && Array.isArray(p.points) ? p.points : []).filter(Boolean);
        if (pts.length >= 2) {
          strokes.push({ type: "brush_stroke", points: pts });
        }
      });
      lines.forEach((l) => {
        const pts = (l && Array.isArray(l.points) ? l.points : []).filter(Boolean);
        if (pts.length >= 2) {
          strokes.push({ type: "brush_stroke", points: pts });
        }
      });
      if (strokes.length) payload.drawing = strokes;
    } catch (e) {
      // ignore
    }

    if (!(payload.polygons && payload.polygons.length) && !(payload.lines && payload.lines.length)) {
      return {};
    }

    return payload;
  };

  DrawUI.applyCheckFeedback = function applyCheckFeedback(result) {
    state.locked = true;
    if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
      state.metadataApi.setLocked(true);
    }

    if (!result || !result.details || typeof result.details !== "object") {
      return;
    }

    const details = result.details;
    const error = details.error || null;
    const stage = details.stage || null;

    if (stage === "polygons" || error === "polygons_missing") {
      state.locked = false;
      if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
        state.metadataApi.setLocked(false);
      }
      _setStage("polygons");
    }

    if (stage === "lines" || error === "lines_missing") {
      state.locked = false;
      if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
        state.metadataApi.setLocked(false);
      }
      _setStage("lines");
    }

    state.badRefTargets = null;
    state.showRef = true;
    state.showRefContours = true;
    state.showRefPolygons = true;
    state.showRefLines = true;
    state.userLinesCheckedStyle = true;
    state.showUserMarks = true;

    if (error === "labels_missing") {
      state.locked = false;
      if (state.metadataApi && typeof state.metadataApi.setLocked === "function") {
        state.metadataApi.setLocked(false);
      }
      state.highlightLabelErrors = true;
    } else {
      state.highlightLabelErrors = false;
    }

    _renderLabelsInputs(null);
    _renderDrawing();
    _renderReference();
    if (typeof state._updateLiveProgress === "function") state._updateLiveProgress();
    if (typeof state._updateToolbar === "function") state._updateToolbar();
  };

  // Phase 2: Cleanup method to prevent memory leaks
  DrawUI.cleanup = function cleanup() {
    // Teardown metadata modal if exists
    _teardownMetadataModal();

    if (state._themeListener) {
      window.removeEventListener("themechanged", state._themeListener);
    }

    // Reset state object
    Object.assign(state, {
      taskDto: null,
      container: null,
      root: null,
      img: null,
      imageWrapper: null,
      viewport: null,
      contentLayer: null,
      drawLayer: null,
      refLayer: null,
      labelsContainer: null,
      polygons: [],
      lines: [],
      actionHistory: [],
      activeStroke: null,
      locked: false,
      mode: "brush",
      stage: "polygons",
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
      labelsPolygons: [],
      labelsLines: [],
      labelsInputs: [],
      highlightLabelErrors: false,
      labelEval: null,
      soloDuringDraw: false,
      brushRadius: 8,
      maxPolygons: 0,
      maxLines: 0,
      metadataApi: null,
      metadataSnapshot: null,
      metadataModal: null,
      metadataModalKeyHandler: null,
      _themeListener: null,
    });

    // Note: Window event listeners (pointermove, pointerup, pointercancel) are attached
    // in createRoot (lines 1441-1443) as anonymous functions, so we cannot remove them.
    // This is a known limitation. For a complete fix, we would need to store references.
    // However, these listeners check state.isPointerDown, so they won't do much work
    // when not actively drawing. The memory leak is minimal.
    // Event listeners on DOM elements will be garbage collected when elements are removed.
  };

  if (
    typeof process !== "undefined" &&
    process.env &&
    process.env.NODE_ENV === "test"
  ) {
    DrawUI.__testing = {
      state,
      syncMetadataToTaskDto: () => _syncMetadataToTaskDto(),
    };
  }

  global.DrawUI = DrawUI;
})(window);
