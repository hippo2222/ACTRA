(function (global) {
  const OpenAnswerUI = {};

  const state = {
    taskDto: null,
    container: null,
    root: null,
    textarea: null,
    maxLength: null,
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
    if (td.image_url || content.image_url || td.image_path || content.image_path) {
      return td.image_url || content.image_url || td.image_path || content.image_path || "";
    }

    if (content && typeof content.image === "object" && content.image) {
      return content.image.url || content.image.path || "";
    }
    if (td && typeof td.image === "object" && td.image) {
      return td.image.url || td.image.path || "";
    }

    if (Array.isArray(content.images) && content.images.length > 0) {
      const img0 = content.images[0];
      if (typeof img0 === "string") return img0;
      if (img0 && typeof img0 === "object") {
        return img0.url || img0.path || "";
      }
    }

    return td.image || content.image || "";
  }

  function _resolveImageUrl(imgSrc) {
    const raw = imgSrc != null ? String(imgSrc) : "";
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
      if (!btn) return;
      btn.disabled = !_isNonEmptyAnswer();
    } catch (e) {
      // ignore
    }
  }

  function _openImageLightbox(imgSrc, caption) {
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
    resetBtn.textContent = "Сброс";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className =
      "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-2 py-1 text-xs font-semibold text-text-secondary shadow-sm hover:bg-bg-hover";
    closeBtn.textContent = "Закрыть";

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
        .oa-answer-input::placeholder { color: var(--color-text-secondary); opacity: 1; }
      `;
      document.head.appendChild(style);
    }

    const title = _getTitle(taskDto);
    const question = _getQuestion(taskDto);

    if (title) {
      const titleEl = _createEl(
        "div",
        "text-sm font-semibold text-text-main dark:text-text-on-dark",
        title
      );
      root.appendChild(titleEl);
    }

    const imgRaw = _getImagePath(taskDto);
    const imgUrl = _resolveImageUrl(imgRaw);

    const card = _createEl(
      "div",
      "w-full rounded-xl border-2 border-border-strong bg-surface-2 p-4 shadow-sm dark:border-border-strong dark:bg-surface-2 oa-card-entry",
      ""
    );

    if (imgUrl) {
      const wrapper = _createEl(
        "div",
      "group relative w-full overflow-hidden rounded-xl bg-surface-2 border border-border-strong shadow-inner cursor-zoom-in",
        ""
      );
      wrapper.style.aspectRatio = "4 / 3";

      const img = document.createElement("img");
      img.src = imgUrl;
      img.alt = title || "Task image";
      img.className = "h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.02]";
      img.draggable = false;

      const shade = _createEl("div", "absolute inset-0 bg-scrim group-hover:bg-transparent transition-colors", "");

      const zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className =
        "absolute bottom-3 right-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-surface-1 backdrop-blur-sm p-2 text-text-main shadow-sm opacity-0 group-hover:opacity-100 transition-opacity";
      const zoomIcon = _createEl("span", "material-symbols-outlined text-[22px]", "zoom_in");
      zoomBtn.appendChild(zoomIcon);

      const caption = question || title || "Image";
      const open = (ev) => {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        _openImageLightbox(imgUrl, caption);
      };

      img.addEventListener("click", open);
      wrapper.addEventListener("click", open);
      zoomBtn.addEventListener("click", open);

      wrapper.appendChild(img);
      wrapper.appendChild(shade);
      wrapper.appendChild(zoomBtn);
      card.appendChild(wrapper);
    }

    if (question) {
      const q = _createEl(
        "div",
        "text-sm leading-relaxed text-text-main",
        question
      );
      card.appendChild(q);
    }

    const textarea = document.createElement("textarea");
    textarea.className =
      "oa-answer-input mt-3 w-full min-h-[160px] resize-y rounded-lg border-2 border-border-strong bg-surface-1 px-3 py-2 text-sm text-text-main placeholder:text-text-secondary dark:placeholder:text-text-secondary shadow-sm focus:border-primary focus:ring-primary";
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

    const footerRow = _createEl("div", "mt-2 flex items-center justify-between gap-3", "");

    const hint = _createEl(
      "div",
      "text-xs text-text-secondary dark:text-text-secondary",
      "Пустой ответ отправить нельзя"
    );
    footerRow.appendChild(hint);

    const counter = _createEl("div", "text-xs text-text-secondary dark:text-text-secondary", "");

    function updateCounter() {
      if (!counter) return;
      if (!state.maxLength) {
        counter.textContent = "";
        return;
      }
      const used = _getTextareaValue().length;
      counter.textContent = `${used}/${state.maxLength}`;
    }

    textarea.addEventListener("input", updateCounter);
    updateCounter();

    footerRow.appendChild(counter);

    card.appendChild(footerRow);

    root.appendChild(card);

    container.appendChild(root);

    state.root = root;
    state.textarea = textarea;

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
      const answer = draft.answer || "";
      if (state.textarea && answer) {
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
    state.maxLength = null;
    // Note: Event listeners are attached to DOM elements that will be removed,
    // so they will be garbage collected automatically.
    // The lightbox cleanup is handled by handleClose() when the lightbox is closed.
  };

  global.OpenAnswerUI = OpenAnswerUI;
})(typeof window !== "undefined" ? window : this);
