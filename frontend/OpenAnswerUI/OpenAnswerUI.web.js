(function (global) {
  const OpenAnswerUI = {};

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== "function") return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

  const state = {
    taskDto: null,
    container: null,
    root: null,
    textarea: null,
    counter: null,
    maxLength: null,
    isLocked: false,
    isMultiQuestion: false,
    displayMode: "simultaneous",
    questions: [],
    currentStepIndex: 0,
    textareas: {},
    counters: {},
    feedbackContainers: {},
    stepCards: {},
    stepAnswers: {},
  };

  function _safeText(v) {
    return v == null ? "" : String(v);
  }

  function _getTaskData(taskDto) {
    if (!taskDto || typeof taskDto !== "object") return {};
    const td = taskDto.task_data && typeof taskDto.task_data === "object" ? taskDto.task_data : {};
    const content = td.content && typeof td.content === "object" ? td.content : {};
    return { td, content };
  }

  function _getQuestion(taskDto) {
    const { td, content } = _getTaskData(taskDto);
    return (
      _safeText(content.question) ||
      _safeText(content.prompt) ||
      _safeText(td.question) ||
      _safeText(td.prompt) ||
      _safeText(td.description) ||
      ""
    );
  }

  function _getTitle(taskDto) {
    const { td, content } = _getTaskData(taskDto);
    return (
      _safeText(td.meta && td.meta.title) ||
      _safeText(td.meta && td.meta.name) ||
      _safeText(td.title) ||
      _safeText(td.name) ||
      _safeText(content.task_name) ||
      ""
    );
  }

  function _getSettings(taskDto) {
    const { td, content } = _getTaskData(taskDto);
    const settings =
      (content.settings && typeof content.settings === "object" && content.settings) ||
      (td.settings && typeof td.settings === "object" && td.settings) ||
      {};
    return settings;
  }

  function _getImagePath(taskDto) {
    const { td, content } = _getTaskData(taskDto);
    const directUrl =
      td.image_asset_url ||
      content.image_asset_url ||
      td.image_url ||
      content.image_url ||
      "";
    if (directUrl) return directUrl;

    const directAssetId =
      td.image_asset_id ||
      content.image_asset_id ||
      td.asset_id ||
      content.asset_id ||
      "";
    if (directAssetId) {
      return { asset_id: directAssetId };
    }

    if (td.image_path || content.image_path) {
      return td.image_path || content.image_path || "";
    }

    if (content && typeof content.image === "object" && content.image) {
      return content.image;
    }
    if (td && typeof td.image === "object" && td.image) {
      return td.image;
    }

    if (Array.isArray(content.images) && content.images.length > 0) {
      const img0 = content.images[0];
      if (typeof img0 === "string") return img0;
      if (img0 && typeof img0 === "object") return img0;
    }

    return td.image || content.image || "";
  }

  function _resolveImageUrl(imgSrc) {
    if (!imgSrc && imgSrc !== 0) return "";

    if (imgSrc && typeof imgSrc === "object") {
      const nested = imgSrc.image && typeof imgSrc.image === "object" ? imgSrc.image : null;
      const directUrl =
        imgSrc.asset_url ||
        imgSrc.image_asset_url ||
        imgSrc.image_url ||
        imgSrc.url ||
        imgSrc.src ||
        (nested &&
          (nested.asset_url ||
            nested.image_asset_url ||
            nested.url ||
            nested.image_url ||
            nested.src)) ||
        "";
      if (directUrl) return _resolveImageUrl(directUrl);

      const assetId =
        imgSrc.asset_id ||
        imgSrc.image_asset_id ||
        (nested && (nested.asset_id || nested.image_asset_id)) ||
        "";
      if (assetId) {
        return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
      }
      const legacyPath =
        imgSrc.image_path ||
        imgSrc.path ||
        (nested && (nested.path || nested.image_path)) ||
        "";
      if (legacyPath) return _resolveImageUrl(legacyPath);
      return "";
    }

    const raw = String(imgSrc != null ? imgSrc : "").trim();
    if (!raw) return "";
    if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
    if (raw.startsWith("/")) return raw;
    return `/api/local-image?path=${encodeURIComponent(raw)}`;
  }

  function _createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function _getTextareaValue(qid) {
    if (qid != null && state.textareas && state.textareas[qid]) {
      return String(state.textareas[qid].value || "");
    }
    const v = state.textarea ? state.textarea.value : "";
    return String(v || "");
  }

  function _isNonEmptyAnswer(qid) {
    return _getTextareaValue(qid).trim().length > 0;
  }

  function _syncCheckButtonState() {
    try {
      const btn = document.getElementById("check-answer-btn");
      if (btn) {
        if (state.isMultiQuestion && state.questions.length > 0) {
          if (state.displayMode === "sequential") {
            const allAnswered = state.questions.every((q) => _getTextareaValue(q.id).trim().length > 0);
            btn.disabled = state.isLocked || !allAnswered;
          } else {
            const allValid = state.questions.every((q) => _isNonEmptyAnswer(q.id));
            btn.disabled = state.isLocked || !allValid;
          }
        } else {
          btn.disabled = state.isLocked || !_isNonEmptyAnswer();
        }
      }

      if (state.isMultiQuestion && state.questions.length > 0) {
        state.questions.forEach((q) => {
          const counter = state.counters && state.counters[q.id];
          const maxLen = Number(q.max_length || state.maxLength || 0);
          if (counter) {
            if (!maxLen) {
              counter.textContent = "";
            } else {
              counter.textContent = `${_getTextareaValue(q.id).length}/${maxLen}`;
            }
          }
        });
      } else if (state.counter) {
        if (!state.maxLength) {
          state.counter.textContent = "";
        } else {
          state.counter.textContent = `${_getTextareaValue().length}/${state.maxLength}`;
        }
      }
    } catch (e) {
      // ignore
    }
  }

  function _setInputLocked(isLocked, qid) {
    if (qid != null && state.textareas && state.textareas[qid]) {
      const ta = state.textareas[qid];
      ta.readOnly = !!isLocked;
      ta.disabled = !!isLocked;
      ta.classList.toggle("opacity-80", !!isLocked);
      ta.classList.toggle("cursor-not-allowed", !!isLocked);
      ta.classList.toggle("bg-bg-secondary", !!isLocked);
      return;
    }

    state.isLocked = !!isLocked;
    if (state.textarea) {
      state.textarea.readOnly = state.isLocked;
      state.textarea.disabled = state.isLocked;
      state.textarea.classList.toggle("opacity-80", state.isLocked);
      state.textarea.classList.toggle("cursor-not-allowed", state.isLocked);
      state.textarea.classList.toggle("bg-bg-secondary", state.isLocked);
    }
    if (state.textareas) {
      Object.values(state.textareas).forEach((ta) => {
        if (!ta) return;
        ta.readOnly = state.isLocked;
        ta.disabled = state.isLocked;
        ta.classList.toggle("opacity-80", state.isLocked);
        ta.classList.toggle("cursor-not-allowed", state.isLocked);
        ta.classList.toggle("bg-bg-secondary", state.isLocked);
      });
    }
  }

  function _openImageLightboxLegacy(imgSrc, caption) {
    if (!imgSrc) return;

    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[60] bg-scrim-strong flex items-center justify-center px-4";

    const container = document.createElement("div");
    container.className =
      "relative max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-xl bg-surface-1 shadow-2xl";

    const topBar = document.createElement("div");
    topBar.className =
      "flex items-center justify-between gap-3 border-b border-border-subtle bg-surface-1 px-3 py-2 backdrop-blur";

    const title = document.createElement("div");
    title.className = "text-xs font-semibold text-text-secondary truncate";
    title.textContent = _safeText(caption) || "";

    const btnRow = document.createElement("div");
    btnRow.className = "flex items-center gap-2";

    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className =
      "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-2 py-1 text-xs font-semibold text-text-secondary shadow-sm hover:bg-bg-hover";
    resetBtn.textContent = wt("openanswerui.reset_btn", "Сброс");

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className =
      "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-2 py-1 text-xs font-semibold text-text-secondary shadow-sm hover:bg-bg-hover";
    closeBtn.textContent = wt("openanswerui.close_btn", "Закрыть");

    btnRow.appendChild(resetBtn);
    btnRow.appendChild(closeBtn);
    topBar.appendChild(title);
    topBar.appendChild(btnRow);

    const viewport = document.createElement("div");
    viewport.className = "relative h-[80vh] w-full overflow-hidden bg-bg-ink";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = _safeText(caption) || "image";
    img.draggable = false;
    img.className = "absolute left-0 top-0 select-none";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.transformOrigin = "0 0";
    img.style.cursor = "grab";

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startTranslateX = 0;
    let startTranslateY = 0;

    function applyTransform() {
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
    }

    img.addEventListener("wheel", (ev) => {
      ev.preventDefault();

      const rect = img.getBoundingClientRect();
      const offsetX = ev.clientX - rect.left;
      const offsetY = ev.clientY - rect.top;

      const zoomFactor = ev.deltaY < 0 ? 1.1 : 0.9;
      const newScale = Math.min(8, Math.max(0.25, scale * zoomFactor));
      if (newScale === scale) return;

      const oldScale = scale;

      translateX += offsetX * (1 / newScale - 1 / oldScale);
      translateY += offsetY * (1 / newScale - 1 / oldScale);

      scale = newScale;
      applyTransform();
    }, { passive: false });

    function onDragStart(ev) {
      isDragging = true;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      startTranslateX = translateX;
      startTranslateY = translateY;
      img.style.cursor = "grabbing";
    }

    function onDragMove(ev) {
      if (!isDragging) return;
      translateX = startTranslateX + (ev.clientX - dragStartX);
      translateY = startTranslateY + (ev.clientY - dragStartY);
      applyTransform();
    }

    function onDragEnd() {
      isDragging = false;
      img.style.cursor = "grab";
    }

    img.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      onDragStart(ev);
    });

    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);

    resetBtn.addEventListener("click", () => {
      scale = 1;
      translateX = 0;
      translateY = 0;
      applyTransform();
    });

    const handleClose = () => {
      try {
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onDragEnd);
      } catch (e) {
        // ignore
      }
      overlay.remove();
    };

    closeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      handleClose();
    });

    overlay.addEventListener("click", handleClose);
    container.addEventListener("click", (ev) => ev.stopPropagation());

    viewport.appendChild(img);
    container.appendChild(topBar);
    container.appendChild(viewport);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    applyTransform();
  }

  function _openImageLightboxSmart(imgSrc, caption) {
    if (!imgSrc) return;

    const overlay = document.createElement("div");
    overlay.className =
      "fixed inset-0 z-[60] bg-scrim-strong flex items-center justify-center px-4";
    overlay.tabIndex = -1;

    const container = document.createElement("div");
    container.className =
      "relative flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-surface-1 shadow-2xl";

    const topBar = document.createElement("div");
    topBar.className =
      "flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-1 px-3 py-2 backdrop-blur";

    const title = document.createElement("div");
    title.className =
      "min-w-0 flex-1 truncate text-xs font-semibold text-text-secondary";
    title.textContent = _safeText(caption) || "";

    const btnRow = document.createElement("div");
    btnRow.className = "flex flex-wrap items-center justify-end gap-2";

    function makeToolbarButton(label, className, ariaLabel) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        className ||
        "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-bg-hover";
      btn.textContent = label;
      btn.setAttribute("aria-label", ariaLabel || label);
      btn.title = ariaLabel || label;
      return btn;
    }

    const zoomOutBtn = makeToolbarButton(
      "\u2212",
      "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface-1 text-lg font-semibold leading-none text-text-secondary shadow-sm transition-colors hover:bg-bg-hover",
      "Zoom out"
    );

    const scaleBadge = document.createElement("div");
    scaleBadge.className =
      "inline-flex min-w-[68px] items-center justify-center rounded-lg border border-border-subtle bg-surface-2 px-3 py-1.5 text-xs font-semibold text-text-main";
    scaleBadge.textContent = "100%";

    const zoomInBtn = makeToolbarButton(
      "+",
      "inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border-subtle bg-surface-1 text-lg font-semibold leading-none text-text-secondary shadow-sm transition-colors hover:bg-bg-hover",
      "Zoom in"
    );

    const fitBtn = makeToolbarButton(
      wt("openanswerui.fit_btn", "Подогнать"),
      "",
      "Fit to screen"
    );

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className =
      "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-bg-hover";
    closeBtn.textContent = wt("openanswerui.close_btn", "Закрыть");
    closeBtn.setAttribute("aria-label", "Close image viewer");
    closeBtn.title = "Close image viewer";

    btnRow.appendChild(zoomOutBtn);
    btnRow.appendChild(scaleBadge);
    btnRow.appendChild(zoomInBtn);
    btnRow.appendChild(fitBtn);
    btnRow.appendChild(closeBtn);
    topBar.appendChild(title);
    topBar.appendChild(btnRow);

    const viewport = document.createElement("div");
    viewport.className =
      "relative h-[min(82vh,720px)] min-h-[320px] w-full overflow-hidden bg-surface-2";
    viewport.style.backgroundImage =
      "radial-gradient(circle at top, color-mix(in srgb, var(--color-primary-light) 12%, transparent), transparent 42%), linear-gradient(180deg, color-mix(in srgb, var(--color-surface-1) 92%, var(--color-bg-secondary, #e5e7eb) 8%), color-mix(in srgb, var(--color-surface-2) 88%, var(--color-bg-secondary, #d1d5db) 12%))";

    const img = document.createElement("img");
    img.src = imgSrc;
    img.alt = _safeText(caption) || "image";
    img.draggable = false;
    img.className = "absolute left-0 top-0 select-none rounded-lg shadow-2xl";
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    img.style.transformOrigin = "0 0";
    img.style.cursor = "grab";

    let naturalWidth = 0;
    let naturalHeight = 0;
    let scale = 1;
    let fittedScale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let startTranslateX = 0;
    let startTranslateY = 0;

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function getViewportRect() {
      return viewport.getBoundingClientRect();
    }

    function computeFittedScale() {
      const rect = getViewportRect();
      if (!rect.width || !rect.height || !naturalWidth || !naturalHeight) {
        return 1;
      }
      return Math.min(rect.width / naturalWidth, rect.height / naturalHeight, 1);
    }

    function clampTranslation() {
      const rect = getViewportRect();
      const renderedWidth = naturalWidth * scale;
      const renderedHeight = naturalHeight * scale;

      if (!rect.width || !rect.height || !renderedWidth || !renderedHeight) {
        return;
      }

      if (renderedWidth <= rect.width) {
        translateX = (rect.width - renderedWidth) / 2;
      } else {
        translateX = clamp(translateX, rect.width - renderedWidth, 0);
      }

      if (renderedHeight <= rect.height) {
        translateY = (rect.height - renderedHeight) / 2;
      } else {
        translateY = clamp(translateY, rect.height - renderedHeight, 0);
      }
    }

    function updateToolbarState() {
      scaleBadge.textContent = `${Math.round(scale * 100)}%`;
      zoomOutBtn.disabled = scale <= 0.2;
      zoomInBtn.disabled = scale >= 8;
    }

    function applyTransform() {
      clampTranslation();
      img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      updateToolbarState();
    }

    function fitToViewport() {
      if (!naturalWidth || !naturalHeight) return;
      fittedScale = computeFittedScale();
      scale = fittedScale;
      translateX = 0;
      translateY = 0;
      applyTransform();
    }

    function setScaleAroundPoint(nextScale, pointX, pointY) {
      if (!naturalWidth || !naturalHeight) return;

      const rect = getViewportRect();
      const localX = pointX - rect.left;
      const localY = pointY - rect.top;
      const clampedScale = clamp(nextScale, 0.2, 8);

      if (clampedScale === scale) return;

      const imageLocalX = (localX - translateX) / scale;
      const imageLocalY = (localY - translateY) / scale;

      scale = clampedScale;
      fittedScale = computeFittedScale();
      translateX = localX - imageLocalX * scale;
      translateY = localY - imageLocalY * scale;
      applyTransform();
    }

    function stepZoom(multiplier) {
      const rect = getViewportRect();
      setScaleAroundPoint(
        scale * multiplier,
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
    }

    function onDragStart(ev) {
      if (ev.button !== 0) return;
      isDragging = true;
      dragStartX = ev.clientX;
      dragStartY = ev.clientY;
      startTranslateX = translateX;
      startTranslateY = translateY;
      img.style.cursor = "grabbing";
    }

    function onDragMove(ev) {
      if (!isDragging) return;
      translateX = startTranslateX + (ev.clientX - dragStartX);
      translateY = startTranslateY + (ev.clientY - dragStartY);
      applyTransform();
    }

    function onDragEnd() {
      isDragging = false;
      img.style.cursor = "grab";
    }

    function onResize() {
      const wasNearFit = Math.abs(scale - fittedScale) < 0.05;
      fittedScale = computeFittedScale();
      if (wasNearFit) {
        fitToViewport();
        return;
      }
      scale = Math.max(scale, fittedScale);
      applyTransform();
    }

    function onKeyDown(ev) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        handleClose();
        return;
      }
      if (ev.key === "0") {
        ev.preventDefault();
        fitToViewport();
        return;
      }
      if (ev.key === "+" || ev.key === "=") {
        ev.preventDefault();
        stepZoom(1.15);
        return;
      }
      if (ev.key === "-" || ev.key === "_") {
        ev.preventDefault();
        stepZoom(0.85);
      }
    }

    function syncImageMetrics() {
      naturalWidth = img.naturalWidth || 0;
      naturalHeight = img.naturalHeight || 0;
      if (!naturalWidth || !naturalHeight) return;
      fitToViewport();
    }

    const handleClose = () => {
      try {
        window.removeEventListener("mousemove", onDragMove);
        window.removeEventListener("mouseup", onDragEnd);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("keydown", onKeyDown);
      } catch (e) {
        // ignore
      }
      overlay.remove();
    };

    viewport.addEventListener(
      "wheel",
      (ev) => {
        ev.preventDefault();
        const zoomFactor = ev.deltaY < 0 ? 1.1 : 0.9;
        setScaleAroundPoint(scale * zoomFactor, ev.clientX, ev.clientY);
      },
      { passive: false }
    );

    viewport.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      onDragStart(ev);
    });

    viewport.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      if (Math.abs(scale - fittedScale) < 0.05) {
        setScaleAroundPoint(
          Math.max(fittedScale * 2, 1.75),
          ev.clientX,
          ev.clientY
        );
        return;
      }
      fitToViewport();
    });

    zoomOutBtn.addEventListener("click", () => stepZoom(0.85));
    zoomInBtn.addEventListener("click", () => stepZoom(1.15));
    fitBtn.addEventListener("click", fitToViewport);
    closeBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      handleClose();
    });

    overlay.addEventListener("click", handleClose);
    container.addEventListener("click", (ev) => ev.stopPropagation());
    img.addEventListener("load", syncImageMetrics);
    window.addEventListener("mousemove", onDragMove);
    window.addEventListener("mouseup", onDragEnd);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKeyDown);

    viewport.appendChild(img);
    container.appendChild(topBar);
    container.appendChild(viewport);
    overlay.appendChild(container);
    document.body.appendChild(overlay);

    if (img.complete) {
      syncImageMetrics();
    } else {
      applyTransform();
    }

    overlay.focus();
  }

  OpenAnswerUI.render = function render(container, taskDto) {
    state.taskDto = taskDto;
    state.container = container;
    state.root = null;
    state.textarea = null;
    state.counter = null;
    state.maxLength = null;
    state.isLocked = false;
    state.isMultiQuestion = false;
    state.displayMode = "simultaneous";
    state.questions = [];
    state.currentStepIndex = 0;
    state.textareas = {};
    state.counters = {};
    state.feedbackContainers = {};
    state.stepCards = {};
    state.stepAnswers = {};

    if (!container) return;

    const root = _createEl("div", "flex flex-col gap-3", "");

    if (!document.getElementById("openanswerui-style")) {
      const style = document.createElement("style");
      style.id = "openanswerui-style";
      style.textContent = `
        @keyframes oaSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .oa-card-entry { animation: oaSlideUp 250ms ease-out forwards; }
        @media (prefers-reduced-motion: reduce) {
          .oa-card-entry { animation: none !important; transition: none !important; }
        }
        .oa-task-prompt {
          border-color: color-mix(in srgb, var(--color-primary) 34%, var(--color-border-strong) 66%);
          background:
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--color-primary-light) 18%, var(--color-surface-1) 82%),
              color-mix(in srgb, var(--color-info-light) 28%, var(--color-surface-1) 72%)
            );
          box-shadow:
            inset 0 1px 0 color-mix(in srgb, var(--color-surface-1) 78%, transparent),
            0 8px 18px color-mix(in srgb, var(--color-primary) 8%, transparent);
        }
        .oa-case-prompt {
          border-color: color-mix(in srgb, var(--color-primary, #2563eb) 28%, var(--color-border-strong) 72%);
          background:
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--color-primary-light, #dbeafe) 15%, var(--color-surface-1) 85%),
              color-mix(in srgb, var(--color-surface-2) 30%, var(--color-surface-1) 70%)
            );
          box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 5%, transparent);
        }
        .oa-task-prompt-icon {
          border-color: color-mix(in srgb, var(--color-primary) 28%, var(--color-border-strong) 72%);
          background: color-mix(in srgb, var(--color-surface-1) 88%, var(--color-primary-light) 12%);
          color: var(--color-primary);
        }
        .oa-task-prompt-label {
          color: color-mix(in srgb, var(--color-primary) 82%, var(--color-text-main) 18%);
        }
        .oa-answer-input::placeholder { color: var(--color-text-secondary); opacity: 1; }
        .oa-answer-input { line-height: 1.6; }
        .oa-answer-input:focus { box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary-light) 50%, transparent); }
        .oa-step-pill {
          transition: all 180ms ease;
        }
        .oa-step-pill.active {
          background-color: var(--color-primary);
          color: #fff;
          box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 35%, transparent);
        }
        .oa-step-pill.passed {
          background-color: var(--color-success, #10b981);
          color: #fff;
        }
        .oa-step-pill.pending {
          background-color: var(--color-surface-2);
          color: var(--color-text-secondary);
          border: 1px solid var(--color-border-subtle);
        }
      `;
      document.head.appendChild(style);
    }

    const title = _getTitle(taskDto);
    const { td, content } = _getTaskData(taskDto);
    const question = _getQuestion(taskDto);
    const isRuntimeSession = !!document.getElementById("check-answer-btn");

    if (title && !isRuntimeSession) {
      const titleEl = _createEl(
        "div",
        "text-sm font-semibold tracking-tight text-text-main dark:text-text-on-dark",
        title
      );
      root.appendChild(titleEl);
    }

    const rawQuestions = Array.isArray(content.questions) && content.questions.length > 0
      ? content.questions
      : [];
    const hasMultipleQuestions = rawQuestions.length > 1 || (rawQuestions.length === 1 && !!content.case_text);

    const imgRaw = _getImagePath(taskDto);
    const imgUrl = _resolveImageUrl(imgRaw);

    function createThumbnailPreview(url, caption) {
      const wrapper = _createEl(
        "div",
        "group relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border-strong bg-surface-2 shadow-inner cursor-zoom-in",
        ""
      );
      wrapper.style.height = "clamp(220px, 34vh, 360px)";

      const img = document.createElement("img");
      img.src = url;
      img.alt = caption || title || "Task image";
      img.className = "h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-[1.02]";
      img.draggable = false;

      const zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className =
        "absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border-subtle bg-surface-1/95 p-2 text-text-main shadow-sm transition-transform hover:scale-[1.03]";
      zoomBtn.setAttribute("aria-label", "Open image viewer");
      zoomBtn.title = "Open image viewer";
      const zoomIcon = _createEl("span", "material-symbols-outlined text-[22px]", "zoom_in");
      zoomBtn.appendChild(zoomIcon);

      const open = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        _openImageLightboxSmart(url, caption || question || title || "Image");
      };

      img.addEventListener("click", open);
      wrapper.addEventListener("click", open);
      zoomBtn.addEventListener("click", open);

      wrapper.appendChild(img);
      wrapper.appendChild(zoomBtn);
      return wrapper;
    }

    // =========================================================================
    // LEGACY / SINGLE QUESTION BRANCH
    // =========================================================================
    if (!hasMultipleQuestions) {
      const card = _createEl(
        "div",
        "w-full rounded-2xl border-2 border-border-strong bg-surface-2 p-5 shadow-sm dark:border-border-strong dark:bg-surface-2 oa-card-entry",
        ""
      );

      if (question) {
        const promptBlock = _createEl(
          "div",
          "oa-task-prompt mb-4 rounded-2xl border-2 px-4 py-3 shadow-sm",
          ""
        );
        promptBlock.setAttribute("data-openanswerui", "task-prompt");

        const promptInner = _createEl("div", "flex items-start gap-3", "");
        const promptIconWrap = _createEl(
          "div",
          "oa-task-prompt-icon mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm",
          ""
        );
        promptIconWrap.appendChild(
          _createEl("span", "material-symbols-outlined text-[19px]", "assignment")
        );
        const promptBody = _createEl("div", "min-w-0 flex-1", "");
        const promptLabel = _createEl(
          "div",
          "oa-task-prompt-label mb-1 text-[11px] font-bold uppercase tracking-[0.09em]",
          wt("openanswerui.task_text_label", "Текст задания")
        );
        const q = _createEl(
          "div",
          "text-[15px] leading-7 text-text-main dark:text-text-on-dark",
          question
        );
        promptBody.appendChild(promptLabel);
        promptBody.appendChild(q);
        promptInner.appendChild(promptIconWrap);
        promptInner.appendChild(promptBody);
        promptBlock.appendChild(promptInner);
        card.appendChild(promptBlock);
      }

      if (imgUrl) {
        card.appendChild(createThumbnailPreview(imgUrl, question || title || "Task image"));
      }

      const textarea = document.createElement("textarea");
      textarea.className =
        "oa-answer-input mt-4 w-full min-h-[176px] resize-y rounded-xl border-2 border-border-strong bg-surface-1 px-4 py-3 text-sm text-text-main placeholder:text-text-secondary dark:placeholder:text-text-secondary shadow-sm focus:border-primary focus:ring-primary";
      textarea.placeholder = wt("openanswerui.enter_answer_placeholder", "Введите ответ...");

      const settings = _getSettings(taskDto);
      const maxLen = Number(content.max_length || content.maxLength || settings.max_length || settings.maxLength || 0);
      if (Number.isFinite(maxLen) && maxLen > 0) {
        textarea.maxLength = maxLen;
        state.maxLength = maxLen;
      } else {
        state.maxLength = null;
      }

      textarea.addEventListener("input", () => {
        _syncCheckButtonState();
      });

      card.appendChild(textarea);

      let counter = null;
      if (state.maxLength) {
        const footerRow = _createEl("div", "mt-3 flex items-center justify-end gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-2", "");
        counter = _createEl("div", "shrink-0 rounded-full border border-border-subtle bg-surface-2 px-2.5 py-1 text-xs font-semibold text-text-secondary dark:text-text-secondary", "");
        footerRow.appendChild(counter);
        card.appendChild(footerRow);
      }

      root.appendChild(card);
      container.appendChild(root);

      state.root = root;
      state.textarea = textarea;
      state.counter = counter;
      state.isLocked = false;
      if (rawQuestions.length === 1) {
        state.textareas[rawQuestions[0].id] = textarea;
        state.questions = rawQuestions;
      }
      _setInputLocked(false);

      try {
        textarea.focus();
      } catch (e) {
        // ignore
      }

      _syncCheckButtonState();
      return;
    }

    // =========================================================================
    // MULTI-QUESTION BRANCH (simultaneous or sequential)
    // =========================================================================
    state.isMultiQuestion = true;
    state.questions = rawQuestions;
    state.displayMode = String(content.display_mode || "simultaneous").toLowerCase();

    // 1. Case Text Context Block (if present)
    if (content.case_text) {
      const caseCard = _createEl(
        "div",
        "oa-case-prompt mb-1 rounded-2xl border-2 px-4 py-3.5 shadow-sm oa-card-entry",
        ""
      );
      caseCard.setAttribute("data-openanswerui", "case-context");

      const caseInner = _createEl("div", "flex items-start gap-3", "");
      const caseIconWrap = _createEl(
        "div",
        "oa-task-prompt-icon mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm",
        ""
      );
      caseIconWrap.appendChild(
        _createEl("span", "material-symbols-outlined text-[19px]", "medical_information")
      );
      const caseBody = _createEl("div", "min-w-0 flex-1", "");
      const caseLabel = _createEl(
        "div",
        "oa-task-prompt-label mb-1 text-[11px] font-bold uppercase tracking-[0.09em]",
        wt("openanswerui.case_text_label", "Описание случая")
      );
      const caseP = _createEl(
        "div",
        "text-[14px] leading-relaxed text-text-main dark:text-text-on-dark whitespace-pre-line",
        content.case_text
      );
      caseBody.appendChild(caseLabel);
      caseBody.appendChild(caseP);
      caseInner.appendChild(caseIconWrap);
      caseInner.appendChild(caseBody);
      caseCard.appendChild(caseInner);
      root.appendChild(caseCard);
    }

    // 2. Global task images preview
    if (imgUrl) {
      root.appendChild(createThumbnailPreview(imgUrl, content.case_text || title || "Case image"));
    }

    // 3. Questions display depending on mode
    if (state.displayMode === "sequential") {
      // -----------------------------------------------------------------------
      // SEQUENTIAL MODE (step-by-step reasoning)
      // -----------------------------------------------------------------------
      const seqMount = _createEl("div", "flex flex-col gap-4 w-full", "");
      root.appendChild(seqMount);

      function renderSequentialStep() {
        seqMount.innerHTML = "";
        const total = state.questions.length;
        const currentIdx = Math.min(state.currentStepIndex, total - 1);
        const currentQ = state.questions[currentIdx];

        // Step Indicator Header
        const indicatorCard = _createEl(
          "div",
          "flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-surface-1 px-4 py-2.5 text-xs font-semibold text-text-secondary shadow-sm",
          ""
        );
        const pillsWrap = _createEl("div", "flex items-center gap-1.5", "");
        for (let i = 0; i < total; i++) {
          const pill = _createEl(
            "span",
            `oa-step-pill inline-flex size-6 items-center justify-center rounded-full text-[11px] font-bold ${
              i < currentIdx
                ? "passed"
                : i === currentIdx
                ? "active"
                : "pending"
            }`,
            i < currentIdx ? "✓" : String(i + 1)
          );
          pillsWrap.appendChild(pill);
        }

        const stepText = _createEl(
          "div",
          "text-xs font-medium text-text-secondary",
          wt("openanswerui.step_counter", "Вопрос {current} из {total}")
            .replace("{current}", currentIdx + 1)
            .replace("{total}", total)
        );
        indicatorCard.appendChild(pillsWrap);
        indicatorCard.appendChild(stepText);
        seqMount.appendChild(indicatorCard);

        // Previous Completed Steps (read-only context with revealed reference)
        for (let i = 0; i < currentIdx; i++) {
          const pastQ = state.questions[i];
          const pastQid = String(pastQ.id);
          const pastAnswer = state.stepAnswers[pastQid] || _getTextareaValue(pastQid);

          const pastCard = _createEl(
            "div",
            "w-full rounded-2xl border border-border-subtle bg-surface-1/70 p-4 shadow-sm text-xs oa-card-entry opacity-90",
            ""
          );
          const pastHeader = _createEl("div", "flex items-center justify-between gap-2 mb-2");
          const pastBadge = _createEl(
            "span",
            "inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-bold text-text-secondary",
            `${wt("openanswerui.question_num", "Вопрос {n}").replace("{n}", i + 1)}`
          );
          const lockedBadge = _createEl(
            "span",
            "inline-flex items-center gap-1 text-[11px] font-medium text-color-success",
            `✓ ${wt("openanswerui.step_locked_notice", "Ответ зафиксирован")}`
          );
          pastHeader.appendChild(pastBadge);
          pastHeader.appendChild(lockedBadge);
          pastCard.appendChild(pastHeader);

          const pastPrompt = _createEl("div", "font-medium text-text-main mb-2", _safeText(pastQ.question));
          pastCard.appendChild(pastPrompt);

          const pastAnsBox = _createEl(
            "div",
            "rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 text-text-secondary leading-relaxed",
            ""
          );
          pastAnsBox.innerHTML = `<strong>${wt("openanswerui.your_answer", "Ваш ответ:")}</strong> ${_safeText(pastAnswer)}`;
          pastCard.appendChild(pastAnsBox);

          if (pastQ.reference_answer) {
            const pastRef = _createEl(
              "div",
              "mt-2 text-[11px] text-text-secondary/90 italic",
              ""
            );
            pastRef.innerHTML = `<strong>${wt("openanswerui.reference_revealed", "Эталонный ответ:")}</strong> ${_safeText(pastQ.reference_answer)}`;
            pastCard.appendChild(pastRef);
          }

          seqMount.appendChild(pastCard);
        }

        // Active Step Card
        const activeCard = _createEl(
          "div",
          "w-full rounded-2xl border-2 border-border-strong bg-surface-2 p-5 shadow-sm oa-card-entry",
          ""
        );
        const activePromptBlock = _createEl(
          "div",
          "oa-task-prompt mb-4 rounded-2xl border-2 px-4 py-3 shadow-sm",
          ""
        );
        const promptInner = _createEl("div", "flex items-start gap-3", "");
        const promptIconWrap = _createEl(
          "div",
          "oa-task-prompt-icon mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm",
          ""
        );
        promptIconWrap.appendChild(
          _createEl("span", "material-symbols-outlined text-[19px]", "quiz")
        );
        const promptBody = _createEl("div", "min-w-0 flex-1", "");
        const promptLabel = _createEl(
          "div",
          "oa-task-prompt-label mb-1 text-[11px] font-bold uppercase tracking-[0.09em]",
          wt("openanswerui.question_num", "Вопрос {n}").replace("{n}", currentIdx + 1)
        );
        const qText = _createEl(
          "div",
          "text-[15px] leading-7 text-text-main dark:text-text-on-dark font-medium",
          _safeText(currentQ.question)
        );
        promptBody.appendChild(promptLabel);
        promptBody.appendChild(qText);
        promptInner.appendChild(promptIconWrap);
        promptInner.appendChild(promptBody);
        activePromptBlock.appendChild(promptInner);
        activeCard.appendChild(activePromptBlock);

        // Optional question image
        const qImgUrl = _resolveImageUrl(currentQ.image_url || currentQ.image_path);
        if (qImgUrl) {
          activeCard.appendChild(createThumbnailPreview(qImgUrl, currentQ.question));
        }

        // Active textarea
        const currentQid = String(currentQ.id);
        const textarea = document.createElement("textarea");
        textarea.name = `open_answer_q_${currentQid}`;
        textarea.setAttribute("data-qid", currentQid);
        textarea.className =
          "oa-answer-input mt-3 w-full min-h-[140px] resize-y rounded-xl border-2 border-border-strong bg-surface-1 px-4 py-3 text-sm text-text-main placeholder:text-text-secondary dark:placeholder:text-text-secondary shadow-sm focus:border-primary focus:ring-primary";
        textarea.placeholder = wt("openanswerui.enter_answer_placeholder", "Введите ответ...");
        textarea.setAttribute(
          "aria-label",
          `${wt("openanswerui.answer_for_question", "Ответ на вопрос")} ${currentIdx + 1}: ${_safeText(currentQ.question)}`
        );

        if (state.stepAnswers[currentQid]) {
          textarea.value = state.stepAnswers[currentQid];
        }

        const maxLen = Number(currentQ.max_length || content.max_length || 0);
        if (Number.isFinite(maxLen) && maxLen > 0) {
          textarea.maxLength = maxLen;
        }

        state.textareas[currentQid] = textarea;
        state.textarea = textarea;

        activeCard.appendChild(textarea);

        // Counter
        let counter = null;
        if (maxLen > 0) {
          const footerRow = _createEl(
            "div",
            "mt-2 flex items-center justify-end gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-1.5",
            ""
          );
          counter = _createEl(
            "div",
            "shrink-0 rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-secondary",
            `${textarea.value.length}/${maxLen}`
          );
          footerRow.appendChild(counter);
          activeCard.appendChild(footerRow);
        }
        state.counters[currentQid] = counter;

        // Feedback box for this question
        const fbBox = _createEl("div", "oa-feedback-container hidden mt-2", "");
        fbBox.setAttribute("data-feedback-qid", currentQid);
        state.feedbackContainers[currentQid] = fbBox;
        activeCard.appendChild(fbBox);

        // Step action button row
        const actionsRow = _createEl("div", "mt-4 flex items-center justify-end gap-3", "");
        const isLastStep = currentIdx >= total - 1;

        if (!isLastStep) {
          const nextBtn = _createEl(
            "button",
            "oa-next-step-btn inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
            ""
          );
          nextBtn.type = "button";
          nextBtn.setAttribute(
            "aria-label",
            wt("openanswerui.next_step_btn", "Ответить и перейти далее")
          );
          const nextText = _createEl(
            "span",
            "",
            wt("openanswerui.next_step_btn", "Ответить и перейти далее")
          );
          const nextIcon = _createEl("span", "material-symbols-outlined text-[18px]", "arrow_forward");
          nextBtn.appendChild(nextText);
          nextBtn.appendChild(nextIcon);

          nextBtn.disabled = textarea.value.trim().length === 0;

          textarea.addEventListener("input", () => {
            nextBtn.disabled = textarea.value.trim().length === 0;
            _syncCheckButtonState();
          });

          nextBtn.addEventListener("click", () => {
            const val = textarea.value.trim();
            if (!val) {
              textarea.focus();
              return;
            }
            state.stepAnswers[currentQid] = textarea.value;
            state.currentStepIndex = currentIdx + 1;
            renderSequentialStep();
            _syncCheckButtonState();
          });

          actionsRow.appendChild(nextBtn);
        } else {
          textarea.addEventListener("input", () => {
            _syncCheckButtonState();
          });
        }

        activeCard.appendChild(actionsRow);
        seqMount.appendChild(activeCard);

        try {
          textarea.focus();
        } catch (e) {
          // ignore
        }
      }

      renderSequentialStep();
    } else {
      // -----------------------------------------------------------------------
      // SIMULTANEOUS MODE (all questions displayed on one screen)
      // -----------------------------------------------------------------------
      const listContainer = _createEl("div", "flex flex-col gap-4 w-full", "");

      state.questions.forEach((q, idx) => {
        const qid = String(q.id);
        const card = _createEl(
          "div",
          "w-full rounded-2xl border-2 border-border-strong bg-surface-2 p-5 shadow-sm oa-card-entry",
          ""
        );

        const promptBlock = _createEl(
          "div",
          "oa-task-prompt mb-3 rounded-2xl border-2 px-4 py-3 shadow-sm",
          ""
        );
        const promptInner = _createEl("div", "flex items-start gap-3", "");
        const promptIconWrap = _createEl(
          "div",
          "oa-task-prompt-icon mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl border shadow-sm",
          ""
        );
        promptIconWrap.appendChild(
          _createEl("span", "material-symbols-outlined text-[19px]", "quiz")
        );
        const promptBody = _createEl("div", "min-w-0 flex-1", "");
        const promptLabel = _createEl(
          "div",
          "oa-task-prompt-label mb-1 text-[11px] font-bold uppercase tracking-[0.09em]",
          wt("openanswerui.question_num", "Вопрос {n}").replace("{n}", idx + 1)
        );
        const qText = _createEl(
          "div",
          "text-[15px] leading-7 text-text-main dark:text-text-on-dark font-medium",
          _safeText(q.question)
        );
        promptBody.appendChild(promptLabel);
        promptBody.appendChild(qText);
        promptInner.appendChild(promptIconWrap);
        promptInner.appendChild(promptBody);
        promptBlock.appendChild(promptInner);
        card.appendChild(promptBlock);

        // Optional question image
        const qImgUrl = _resolveImageUrl(q.image_url || q.image_path);
        if (qImgUrl) {
          card.appendChild(createThumbnailPreview(qImgUrl, q.question));
        }

        // Textarea
        const textarea = document.createElement("textarea");
        textarea.name = `open_answer_q_${qid}`;
        textarea.setAttribute("data-qid", qid);
        textarea.className =
          "oa-answer-input mt-3 w-full min-h-[140px] resize-y rounded-xl border-2 border-border-strong bg-surface-1 px-4 py-3 text-sm text-text-main placeholder:text-text-secondary dark:placeholder:text-text-secondary shadow-sm focus:border-primary focus:ring-primary";
        textarea.placeholder = wt("openanswerui.enter_answer_placeholder", "Введите ответ...");
        textarea.setAttribute(
          "aria-label",
          `${wt("openanswerui.answer_for_question", "Ответ на вопрос")} ${idx + 1}: ${_safeText(q.question)}`
        );

        const maxLen = Number(q.max_length || content.max_length || 0);
        if (Number.isFinite(maxLen) && maxLen > 0) {
          textarea.maxLength = maxLen;
        }

        textarea.addEventListener("input", () => {
          _syncCheckButtonState();
        });

        card.appendChild(textarea);
        state.textareas[qid] = textarea;
        if (idx === 0) state.textarea = textarea;

        // Counter
        let counter = null;
        if (maxLen > 0) {
          const footerRow = _createEl(
            "div",
            "mt-2 flex items-center justify-end gap-3 rounded-xl border border-border-subtle bg-surface-1 px-3 py-1.5",
            ""
          );
          counter = _createEl(
            "div",
            "shrink-0 rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-text-secondary",
            `0/${maxLen}`
          );
          footerRow.appendChild(counter);
          card.appendChild(footerRow);
        }
        state.counters[qid] = counter;

        // Feedback box
        const fbBox = _createEl("div", "oa-feedback-container hidden mt-2", "");
        fbBox.setAttribute("data-feedback-qid", qid);
        state.feedbackContainers[qid] = fbBox;
        card.appendChild(fbBox);

        listContainer.appendChild(card);
      });

      root.appendChild(listContainer);
    }

    container.appendChild(root);
    state.root = root;
    state.isLocked = false;
    _setInputLocked(false);

    try {
      const firstTa = state.questions.length > 0 ? state.textareas[state.questions[0].id] : null;
      if (firstTa) firstTa.focus();
    } catch (e) {
      // ignore
    }

    _syncCheckButtonState();
  };

  OpenAnswerUI.getUserAnswerPayload = function getUserAnswerPayload() {
    if (state.isMultiQuestion && state.questions.length > 0) {
      const answers = {};
      state.questions.forEach((q) => {
        const qid = String(q.id);
        answers[qid] = _getTextareaValue(qid) || state.stepAnswers[qid] || "";
      });
      const firstQid = String(state.questions[0].id);
      return {
        answers,
        answer: answers[firstQid] || "",
      };
    }
    return { answer: _getTextareaValue() };
  };

  OpenAnswerUI.applyCheckFeedback = function applyCheckFeedback(result) {
    if (!result || typeof result !== "object") {
      _setInputLocked(true);
      _syncCheckButtonState();
      return;
    }

    const details = result.details || {};
    const questionsFeedback = details.questions || {};

    if (state.isMultiQuestion && state.questions.length > 0) {
      let anyFailed = false;

      state.questions.forEach((q) => {
        const qid = String(q.id);
        const fb = questionsFeedback[qid];
        const container = state.feedbackContainers[qid];

        if (!container) return;
        container.innerHTML = "";
        container.classList.remove("hidden");

        const isSuccess = fb ? !!fb.success : !!result.success;
        if (!isSuccess) anyFailed = true;

        const box = _createEl(
          "div",
          `mt-3 rounded-xl border p-3 text-xs leading-relaxed oa-card-entry ${
            isSuccess
              ? "border-color-success/40 bg-color-success-light/10 text-text-main"
              : "border-color-error-text/40 bg-color-error-light/10 text-text-main"
          }`
        );

        const statusRow = _createEl("div", "flex items-center gap-2 font-semibold mb-1.5");
        const icon = _createEl(
          "span",
          `material-symbols-outlined text-[18px] ${
            isSuccess ? "text-color-success" : "text-color-error-text"
          }`,
          isSuccess ? "check_circle" : "cancel"
        );
        const label = _createEl(
          "span",
          "",
          isSuccess
            ? wt("openanswerui.step_passed", "Ответ принят")
            : wt("openanswerui.step_retry_hint", "В ответе отсутствуют необходимые ключевые слова")
        );
        statusRow.appendChild(icon);
        statusRow.appendChild(label);
        box.appendChild(statusRow);

        // Keywords display
        if (fb) {
          const found = Array.isArray(fb.found_keywords) ? fb.found_keywords : [];
          const missing = Array.isArray(fb.missing_keywords) ? fb.missing_keywords : [];

          if (found.length > 0 || missing.length > 0) {
            const chipsRow = _createEl("div", "flex flex-wrap items-center gap-1.5 mt-2");
            found.forEach((kw) => {
              const chip = _createEl(
                "span",
                "inline-flex items-center gap-1 rounded-md bg-color-success-light/20 border border-color-success/30 px-2 py-0.5 text-[11px] font-medium text-color-success",
                `✓ ${kw}`
              );
              chipsRow.appendChild(chip);
            });
            missing.forEach((kw) => {
              const chip = _createEl(
                "span",
                "inline-flex items-center gap-1 rounded-md bg-color-error-light/20 border border-color-error-text/30 px-2 py-0.5 text-[11px] font-medium text-color-error-text",
                `✗ ${kw}`
              );
              chipsRow.appendChild(chip);
            });
            box.appendChild(chipsRow);
          }

          if (fb.reference_answer) {
            const refEl = _createEl(
              "div",
              "mt-2 pt-2 border-t border-border-subtle/50 text-[11px] text-text-secondary"
            );
            refEl.innerHTML = `<strong>${wt("openanswerui.reference_revealed", "Эталонный ответ:")}</strong> ${_safeText(fb.reference_answer)}`;
            box.appendChild(refEl);
          }
        }

        container.appendChild(box);

        // Smart Partial Retry: lock passed questions, keep failed editable
        if (isSuccess) {
          _setInputLocked(true, qid);
        } else {
          _setInputLocked(false, qid);
        }
      });

      if (!anyFailed || result.success) {
        _setInputLocked(true);
      }
    } else {
      _setInputLocked(true);
    }
    _syncCheckButtonState();
  };

  OpenAnswerUI.isAnswerValid = function isAnswerValid() {
    if (state.isMultiQuestion && state.questions.length > 0) {
      if (state.displayMode === "sequential") {
        const currentQ = state.questions[state.currentStepIndex];
        if (!currentQ) return true;
        const ans = _getTextareaValue(currentQ.id) || state.stepAnswers[currentQ.id] || "";
        return ans.trim().length > 0;
      }
      return state.questions.every((q) => _isNonEmptyAnswer(q.id));
    }
    return _isNonEmptyAnswer();
  };

  OpenAnswerUI.restoreInput = function restoreInput(draft) {
    try {
      if (!draft || typeof draft !== "object") return;

      if (state.isMultiQuestion && state.questions.length > 0) {
        _setInputLocked(false);
        const answers = (draft.answers && typeof draft.answers === "object") ? draft.answers : null;
        const singleAnswer = draft.answer != null ? String(draft.answer) : "";

        state.questions.forEach((q, idx) => {
          const qid = String(q.id);
          let val = "";
          if (answers && answers[qid] != null) {
            val = String(answers[qid]);
          } else if (idx === 0 && singleAnswer) {
            val = singleAnswer;
          }
          if (val) {
            state.stepAnswers[qid] = val;
            if (state.textareas[qid]) {
              state.textareas[qid].value = val;
            }
          }
        });

        if (state.textarea) {
          const firstQid = String(state.questions[0].id);
          state.textarea.value = _getTextareaValue(firstQid) || singleAnswer;
        }

        _syncCheckButtonState();
        return;
      }

      const answer = draft.answer != null ? String(draft.answer) : "";
      if (state.textarea) {
        _setInputLocked(false);
        state.textarea.value = answer;
        _syncCheckButtonState();
      }
    } catch (e) {
      console.warn("[OpenAnswerUI] restoreInput error:", e);
    }
  };

  OpenAnswerUI.cleanup = function cleanup() {
    state.taskDto = null;
    state.container = null;
    state.root = null;
    state.textarea = null;
    state.counter = null;
    state.maxLength = null;
    state.isLocked = false;
    state.isMultiQuestion = false;
    state.displayMode = "simultaneous";
    state.questions = [];
    state.currentStepIndex = 0;
    state.textareas = {};
    state.counters = {};
    state.feedbackContainers = {};
    state.stepCards = {};
    state.stepAnswers = {};
  };

  global.OpenAnswerUI = OpenAnswerUI;
  global.OpenAnswerUIImageLightbox = {
    open: _openImageLightboxSmart,
  };
})(typeof window !== "undefined" ? window : this);
