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

  function _getTextareaValue() {
    const v = state.textarea ? state.textarea.value : "";
    return String(v || "");
  }

  function _isNonEmptyAnswer() {
    return _getTextareaValue().trim().length > 0;
  }

  function _syncCheckButtonState() {
    try {
      const btn = document.getElementById("check-answer-btn");
      if (btn) {
        btn.disabled = state.isLocked || !_isNonEmptyAnswer();
      }
      if (state.counter) {
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

  function _setInputLocked(isLocked) {
    state.isLocked = !!isLocked;
    if (!state.textarea) return;
    state.textarea.readOnly = state.isLocked;
    state.textarea.disabled = state.isLocked;
    state.textarea.classList.toggle("opacity-80", state.isLocked);
    state.textarea.classList.toggle("cursor-not-allowed", state.isLocked);
    state.textarea.classList.toggle("bg-bg-secondary", state.isLocked);
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

    if (!container) return;

    const root = _createEl("div", "flex flex-col gap-3", "");

    if (!document.getElementById("openanswerui-style")) {
      const style = document.createElement("style");
      style.id = "openanswerui-style";
      style.textContent = `
        @keyframes oaSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .oa-card-entry { animation: oaSlideUp 250ms ease-out forwards; }
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
      `;
      document.head.appendChild(style);
    }

    const title = _getTitle(taskDto);
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

    const imgRaw = _getImagePath(taskDto);
    const imgUrl = _resolveImageUrl(imgRaw);

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
      const wrapper = _createEl(
        "div",
        "group relative mx-auto w-full max-w-3xl overflow-hidden rounded-xl border border-border-strong bg-surface-2 shadow-inner cursor-zoom-in",
        ""
      );
      wrapper.style.height = "clamp(220px, 34vh, 360px)";

      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = title || "Task image";
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

      const caption = question || title || "Image";
      const open = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        _openImageLightboxSmart(imgUrl, caption);
      };

      img.addEventListener("click", open);
      wrapper.addEventListener("click", open);
      zoomBtn.addEventListener("click", open);

      wrapper.appendChild(img);
      wrapper.appendChild(zoomBtn);
      card.appendChild(wrapper);
    }

    const textarea = document.createElement("textarea");
    textarea.className =
      "oa-answer-input mt-4 w-full min-h-[176px] resize-y rounded-xl border-2 border-border-strong bg-surface-1 px-4 py-3 text-sm text-text-main placeholder:text-text-secondary dark:placeholder:text-text-secondary shadow-sm focus:border-primary focus:ring-primary";
    textarea.placeholder = "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043e\u0442\u0432\u0435\u0442...";

    // D-6 fix: max_length lives in content, not settings
    const { content: _cnt } = _getTaskData(taskDto);
    const settings = _getSettings(taskDto);
    const maxLen = Number(_cnt.max_length || _cnt.maxLength || settings.max_length || settings.maxLength || 0);
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

    textarea.addEventListener("input", _syncCheckButtonState);
    _syncCheckButtonState();

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
    _setInputLocked(false);

    try {
      textarea.focus();
    } catch (e) {
      // ignore
    }

    _syncCheckButtonState();
  };

  OpenAnswerUI.getUserAnswerPayload = function getUserAnswerPayload() {
    return { answer: _getTextareaValue() };
  };

  OpenAnswerUI.applyCheckFeedback = function applyCheckFeedback(_result) {
    _setInputLocked(true);
    _syncCheckButtonState();
  };

  OpenAnswerUI.isAnswerValid = function isAnswerValid() {
    return _isNonEmptyAnswer();
  };

  // Phase 2: Cleanup method to prevent memory leaks
  // D-3 fix: restore draft answer into textarea
  OpenAnswerUI.restoreInput = function restoreInput(draft) {
    try {
      if (!draft || typeof draft !== "object") return;
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
    // Reset state
    state.taskDto = null;
    state.container = null;
    state.root = null;
    state.textarea = null;
    state.counter = null;
    state.maxLength = null;
    state.isLocked = false;
    // Note: Event listeners are attached to DOM elements that will be removed,
    // so they will be garbage collected automatically.
    // The lightbox cleanup is handled by handleClose() when the lightbox is closed.
  };

  global.OpenAnswerUI = OpenAnswerUI;
  global.OpenAnswerUIImageLightbox = {
    open: _openImageLightboxSmart,
  };
})(typeof window !== "undefined" ? window : this);
