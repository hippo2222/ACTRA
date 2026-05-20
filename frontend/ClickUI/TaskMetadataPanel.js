(function (global) {
  const TaskMetadataPanel = {};

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== "function") return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

  function _createEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  function _getTaskContent(taskDto) {
    if (!taskDto) return {};
    const taskData = taskDto.task_data || {};
    const content = taskData.content || {};
    return content;
  }

  function _getPrompt(taskDto) {
    const content = _getTaskContent(taskDto);
    return content.prompt || "";
  }

  function _getSuccessThreshold(taskDto) {
    const content = _getTaskContent(taskDto);
    const settings = content.settings || {};
    const raw =
      settings.success_threshold != null
        ? settings.success_threshold
        : settings.successThreshold;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;
  }

  function _ensureContentPath(taskDto) {
    if (!taskDto.task_data) taskDto.task_data = {};
    if (!taskDto.task_data.content) taskDto.task_data.content = {};
    const content = taskDto.task_data.content;
    if (!content.settings || typeof content.settings !== "object") {
      content.settings = {};
    }
    return content;
  }

  function _resolveAssetUrl(rawPath) {
    if (!rawPath && rawPath !== 0) return "";

    if (rawPath && typeof rawPath === "object") {
      const nested = rawPath.image && typeof rawPath.image === "object" ? rawPath.image : null;
      const directUrl =
        rawPath.asset_url ||
        rawPath.image_asset_url ||
        rawPath.image_url ||
        rawPath.url ||
        rawPath.src ||
        (nested &&
          (nested.asset_url ||
            nested.image_asset_url ||
            nested.url ||
            nested.image_url ||
            nested.src)) ||
        "";
      if (directUrl) return _resolveAssetUrl(directUrl);

      const assetId =
        rawPath.asset_id ||
        rawPath.image_asset_id ||
        (nested && (nested.asset_id || nested.image_asset_id)) ||
        "";
      if (assetId) {
        return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
      }
      const legacyPath =
        rawPath.image_path ||
        rawPath.path ||
        (nested && (nested.path || nested.image_path)) ||
        "";
      if (legacyPath) return _resolveAssetUrl(legacyPath);
      return "";
    }

    const raw = String(rawPath).trim();
    if (!raw) return "";
    if (/^(https?:|data:)/i.test(raw)) return raw;
    if (raw.startsWith("/")) return raw;
    return `/api/local-image?path=${encodeURIComponent(raw)}`;
  }

  function _normalizeAdditionalInfo(raw) {
    if (!raw || typeof raw !== "object") return null;

    let type = typeof raw.type === "string" ? raw.type.toLowerCase() : "";
    const textCandidates = [];
    if (typeof raw.text === "string") textCandidates.push(raw.text);
    if (typeof raw.content === "string") textCandidates.push(raw.content);

    const imageCandidates = [];
    const pushImage = (value) => {
      const resolved = _resolveAssetUrl(value);
      if (!resolved) return;
      imageCandidates.push(resolved);
    };

    if (Array.isArray(raw.images)) raw.images.forEach(pushImage);
    if (typeof raw.image === "string") pushImage(raw.image);
    if (
      typeof raw.content === "string" &&
      (!raw.type || raw.type === "image" || raw.type === "combined")
    ) {
      pushImage(raw.content);
    }

    const hasText = textCandidates.some((t) => t && t.trim().length);
    const hasImages = imageCandidates.length > 0;

    if (!type) {
      if (hasText && hasImages) type = "combined";
      else if (hasImages) type = "image";
      else if (hasText) type = "text";
      else type = "none";
    }

    if (type === "none") return null;

    const info = { type, text: "", images: [] };

    const uniqueImages = [];
    const seenImages = new Set();
    imageCandidates.forEach((img) => {
      if (seenImages.has(img)) return;
      seenImages.add(img);
      uniqueImages.push(img);
    });

    if (type === "text") {
      info.text =
        (textCandidates.find((t) => t && t.trim().length) || "").trim();
      if (!info.text) return null;
    } else if (type === "image") {
      info.images = uniqueImages.slice(0, 3);
      if (!info.images.length) return null;
    } else if (type === "combined") {
      info.text =
        (textCandidates.find((t) => t && t.trim().length) || "").trim();
      info.images = uniqueImages.slice(0, 3);
      if (!info.text && !info.images.length) return null;
    }

    return info;
  }

  function _createAdditionalInfoCard(info) {
    if (!info) return null;
    const card = _createEl(
      "div",
      "flex-1 rounded-lg border border-border-subtle bg-surface-1 px-4 py-3 text-sm text-text-main shadow-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark",
      ""
    );
    card.setAttribute("data-taskmeta", "additional-info");

    const header = _createEl(
      "div",
      "text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted",
      wt("metadata.extra_materials", "Доп. материалы")
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
        img.alt = info.text
          ? wt("metadata.extra_img_n", "Доп. изображение {n}").replace("{n}", idx + 1)
          : wt("metadata.extra_img_default", "Дополнительное изображение");
        img.className =
          "h-full w-full object-cover transition duration-200 group-hover:scale-105";

        button.appendChild(img);
        button.addEventListener("click", () => {
          if (
            typeof global.TaskMetadataPanel !== "undefined" &&
            typeof global.TaskMetadataPanel.openImageModal === "function"
          ) {
            global.TaskMetadataPanel.openImageModal(url, img.alt);
          }
        });
        gallery.appendChild(button);
      });
      card.appendChild(gallery);
    }

    return card;
  }

  function _sanitizeAdditional(additionalState) {
    if (!additionalState || additionalState.type === "none") return null;
    const payload = { type: additionalState.type };
    if (additionalState.type === "text") {
      const text = String(additionalState.text || "").trim();
      if (!text) return null;
      payload.text = text;
    } else if (additionalState.type === "image") {
      const images = (additionalState.images || []).filter(
        (img) => typeof img === "string" && img.trim().length
      );
      if (!images.length) return null;
      payload.images = images.slice(0, 3);
    } else if (additionalState.type === "combined") {
      const text = String(additionalState.text || "").trim();
      const images = (additionalState.images || []).filter(
        (img) => typeof img === "string" && img.trim().length
      );
      if (!text && !images.length) return null;
      if (text) payload.text = text;
      if (images.length) payload.images = images.slice(0, 3);
    }
    return payload;
  }

  function createTaskMetadataPanel(options = {}) {
    const {
      taskDto,
      mode = "click",
      onChange,
      locked = false,
      uploadImage,
      annotationTotals,
    } = options;

    const promptInitial = _getPrompt(taskDto);
    const thresholdInitial = _getSuccessThreshold(taskDto);
    const additionalInitial =
      _normalizeAdditionalInfo(
        taskDto &&
          taskDto.task_data &&
          taskDto.task_data.content &&
          taskDto.task_data.content.additionalInfo
      ) || {
        type: "none",
        text: "",
        images: [],
      };

    const state = {
      prompt: promptInitial,
      successThreshold: thresholdInitial,
      locked: !!locked,
      additional: { ...additionalInitial },
      annotationTotals: annotationTotals || null,
    };

    const root = _createEl("div", "flex flex-col gap-4", "");

    function emitChange() {
      if (typeof onChange === "function") {
        onChange({
          prompt: state.prompt,
          successThreshold: state.successThreshold,
          additionalInfo: _sanitizeAdditional(state.additional),
        });
      }
    }

    // Prompt Card ------------------------------------------------------------
    const promptCard = _createEl(
      "div",
      "rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    const promptLabel = _createEl(
      "label",
      "text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted",
      wt("metadata.question_instruction", "Вопрос / инструкция")
    );
    promptLabel.setAttribute("for", "taskmeta-prompt");
    const promptTextarea = document.createElement("textarea");
    promptTextarea.id = "taskmeta-prompt";
    promptTextarea.className =
      "mt-3 w-full rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-main shadow-inner focus:border-primary focus:ring-2 focus:ring-primary dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
    promptTextarea.rows = 4;
    promptTextarea.placeholder = wt("metadata.prompt_placeholder", "Опишите, что нужно сделать пользователю…");
    promptTextarea.value = state.prompt || "";
    promptTextarea.disabled = state.locked;

    const promptMeta = _createEl(
      "div",
      "mt-2 flex items-center justify-between text-[11px] text-text-muted dark:text-text-muted",
      ""
    );
    const promptHint = _createEl(
      "span",
      "",
      wt("metadata.markdown_hint", "Можно использовать Markdown и переносы строк.")
    );
    const promptCounter = _createEl("span", "font-semibold", "");

    function updatePromptCounter() {
      const length = (promptTextarea.value || "").length;
      promptCounter.textContent = wt("metadata.symbols_count", "{length} символов").replace("{length}", length);
    }
    updatePromptCounter();

    promptTextarea.addEventListener("input", () => {
      state.prompt = promptTextarea.value;
      updatePromptCounter();
      emitChange();
    });

    promptCard.appendChild(promptLabel);
    promptCard.appendChild(promptTextarea);
    promptMeta.appendChild(promptHint);
    promptMeta.appendChild(promptCounter);
    promptCard.appendChild(promptMeta);

    // Threshold Card --------------------------------------------------------
    const thresholdCard = _createEl(
      "div",
      "rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );
    const thresholdHead = _createEl(
      "div",
      "flex flex-col gap-1 text-xs uppercase tracking-wide text-text-muted dark:text-text-muted",
      ""
    );
    thresholdHead.appendChild(
      _createEl("div", "font-semibold", wt("metadata.success_threshold", "Порог успеха"))
    );
    thresholdHead.appendChild(
      _createEl(
        "div",
        "text-[11px] normal-case text-text-muted dark:text-text-muted",
        wt("metadata.success_threshold_desc", "Сколько аннотаций нужно найти/нарисовать для зачёта. Оставьте пустым, если нужны все.")
      )
    );

    const thresholdRow = _createEl(
      "div",
      "mt-3 flex flex-col gap-2 sm:flex-row sm:items-center",
      ""
    );
    const thresholdInput = document.createElement("input");
    thresholdInput.type = "number";
    thresholdInput.min = "1";
    thresholdInput.inputMode = "numeric";
    thresholdInput.className =
      "w-full rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-sm font-semibold text-text-main shadow-inner focus:border-primary focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark sm:max-w-[180px]";
    thresholdInput.placeholder = wt("metadata.threshold_placeholder", "Напр. 3");
    thresholdInput.value =
      state.successThreshold != null ? state.successThreshold : "";
    thresholdInput.disabled = state.locked;

    const thresholdInfo = _createEl(
      "div",
      "text-xs text-text-muted dark:text-text-muted",
      wt("metadata.of_unknown_annotations", "из ? аннотаций")
    );

    function computeTotalAnnotations() {
      const totals = state.annotationTotals || {};
      if (typeof totals.total === "number" && totals.total >= 0) {
        return totals.total;
      }
      if (mode === "draw") {
        const polygons = Number(totals.polygons || 0);
        const lines =
          totals.freehand != null
            ? Number(totals.freehand)
            : Number(totals.lines || 0);
        const total = Math.max(0, polygons) + Math.max(0, lines);
        return total > 0 ? total : null;
      }
      if (mode === "click") {
        if (typeof totals.clicks === "number" && totals.clicks > 0) {
          return totals.clicks;
        }
        if (typeof totals.polygons === "number" && totals.polygons > 0) {
          const strokes =
            totals.freehand != null
              ? Number(totals.freehand)
              : Number(totals.lines || 0);
          return Math.max(0, totals.polygons) + Math.max(0, strokes);
        }
      }
      const fallback = ["clicks", "polygons", "lines", "freehand"]
        .map((key) => Number(totals[key] || 0))
        .reduce((sum, n) => sum + (n > 0 ? n : 0), 0);
      return fallback > 0 ? fallback : null;
    }

    function updateThresholdInfo() {
      const total = computeTotalAnnotations();
      thresholdInfo.textContent = total
        ? wt("metadata.of_n_annotations", "из {total} аннотаций").replace("{total}", total)
        : wt("metadata.of_unknown_annotations", "из ? аннотаций");
    }
    updateThresholdInfo();

    thresholdInput.addEventListener("input", () => {
      const raw = thresholdInput.value;
      const num = Number(raw);
      if (raw === "") {
        state.successThreshold = null;
      } else if (Number.isFinite(num) && num >= 1) {
        state.successThreshold = Math.trunc(num);
      }
      emitChange();
    });

    thresholdRow.appendChild(thresholdInput);
    thresholdRow.appendChild(thresholdInfo);
    thresholdCard.appendChild(thresholdHead);
    thresholdCard.appendChild(thresholdRow);

    // Additional Info Card --------------------------------------------------
    const additionalCard = _createEl(
      "div",
      "rounded-2xl border border-border-subtle bg-surface-1 p-5 shadow-sm dark:border-border-strong dark:bg-surface-2",
      ""
    );

    const additionalHeader = _createEl(
      "div",
      "flex flex-col gap-1 text-xs uppercase tracking-wide text-text-muted dark:text-text-muted",
      ""
    );
    additionalHeader.appendChild(
      _createEl("div", "font-semibold", wt("metadata.extra_materials_title", "Дополнительные материалы"))
    );
    additionalHeader.appendChild(
      _createEl(
        "div",
        "text-[11px] normal-case text-text-muted dark:text-text-muted",
        wt("metadata.extra_materials_desc", "Покажите пользователю подсказки в виде текста, изображений или их сочетания.")
      )
    );

    const typeRow = _createEl(
      "div",
      "mt-3 flex flex-col gap-2 sm:flex-row sm:items-center",
      ""
    );
    const typeLabel = _createEl(
      "div",
      "text-xs font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted",
      wt("metadata.format", "Формат")
    );

    const typeSelect = document.createElement("select");
    typeSelect.className =
      "w-full rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-main shadow-sm focus:border-primary focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark sm=max-w-[240px]";
    [
      { value: "none", label: wt("metadata.format_none", "Нет") },
      { value: "text", label: wt("metadata.format_text", "Только текст") },
      { value: "image", label: wt("metadata.format_image", "Только изображения") },
      { value: "combined", label: wt("metadata.format_combined", "Текст + изображения") },
    ].forEach((opt) => {
      const option = document.createElement("option");
      option.value = opt.value;
      option.textContent = opt.label;
      typeSelect.appendChild(option);
    });
    typeSelect.value = state.additional.type || "none";
    typeSelect.disabled = state.locked;

    const textArea = document.createElement("textarea");
    textArea.className =
      "mt-4 w-full rounded-xl border border-border-subtle bg-surface-1 px-3 py-2 text-sm text-text-main shadow-inner focus:border-primary focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
    textArea.rows = 3;
    textArea.placeholder = wt("metadata.enter_extra_text_placeholder", "Введите дополнительный текст…");
    textArea.value = state.additional.text || "";
    textArea.disabled = state.locked;

    const gallery = _createEl(
      "div",
      "mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2",
      ""
    );

    const addImageBtn = document.createElement("button");
    addImageBtn.type = "button";
    addImageBtn.className =
      "mt-3 inline-flex items-center justify-center rounded-xl border border-dashed border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition hover:border-primary hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary-light dark:border-border-strong dark:text-text-muted dark:hover:border-primary dark:hover:text-primary";
    addImageBtn.textContent = wt("metadata.add_image", "Добавить изображение");
    addImageBtn.disabled =
      state.locked || (state.additional.images || []).length >= 3;

    const hiddenFileInput = document.createElement("input");
    hiddenFileInput.type = "file";
    hiddenFileInput.accept = "image/*";
    hiddenFileInput.className = "hidden";

    function refreshVisibility() {
      const type = state.additional.type || "none";
      if (type === "text" || type === "combined") {
        textArea.parentElement?.classList.remove("hidden");
        textArea.disabled = state.locked;
      } else {
        textArea.parentElement?.classList.add("hidden");
      }
      if (type === "image" || type === "combined") {
        gallery.classList.remove("hidden");
        addImageBtn.classList.remove("hidden");
        addImageBtn.disabled =
          state.locked || (state.additional.images || []).length >= 3;
      } else if (type === "none" || type === "text") {
        gallery.classList.add("hidden");
        addImageBtn.classList.add("hidden");
      }
    }

    function updateImagesPreview() {
      gallery.innerHTML = "";
      const images = Array.isArray(state.additional.images)
        ? state.additional.images
        : [];
      images.forEach((imgPath, idx) => {
        const card = _createEl(
          "div",
          "relative overflow-hidden rounded-xl border border-border-subtle bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2",
          ""
        );
        const url = _resolveAssetUrl(imgPath);
        const figure = _createEl(
          "div",
          "relative flex h-40 w-full items-center justify-center overflow-hidden bg-scrim-faint dark:bg-scrim",
          ""
        );
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = wt("metadata.extra_img_n", "Доп. изображение {n}").replace("{n}", idx + 1);
          img.className = "h-full w-full object-cover";
          figure.appendChild(img);
        } else {
          figure.appendChild(
            _createEl(
              "div",
              "text-xs text-text-muted dark:text-text-muted",
              wt("metadata.path_not_set", "Путь не задан")
            )
          );
        }

        const tools = _createEl(
          "div",
          "absolute inset-x-0 bottom-0 flex justify-between gap-2 bg-gradient-to-t from-black/60 to-transparent px-2 py-2",
          ""
        );
        const replaceBtn = document.createElement("button");
        replaceBtn.type = "button";
        replaceBtn.className =
          "rounded-lg bg-surface-1 px-2 py-1 text-[11px] font-semibold text-text-main shadow hover:bg-surface-1";
        replaceBtn.textContent = wt("metadata.replace", "Заменить");
        replaceBtn.disabled = state.locked;
        replaceBtn.addEventListener("click", () => {
          if (state.locked) return;
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.addEventListener("change", () => {
            if (!input.files || !input.files.length) return;
            handleImageSelection(input.files[0], idx);
          });
          input.click();
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className =
          "rounded-lg bg-surface-1 px-2 py-1 text-[11px] font-semibold text-text-main shadow hover:bg-surface-1";
        removeBtn.textContent = wt("metadata.remove", "Удалить");
        removeBtn.disabled = state.locked;
        removeBtn.addEventListener("click", () => {
          if (state.locked) return;
          state.additional.images.splice(idx, 1);
          updateImagesPreview();
          refreshVisibility();
          emitChange();
        });

        tools.appendChild(replaceBtn);
        tools.appendChild(removeBtn);

        const pathLabel = _createEl(
          "div",
          "px-2 py-1 text-[11px] text-text-muted dark:text-text-muted",
          imgPath || ""
        );

        card.appendChild(figure);
        card.appendChild(tools);
        card.appendChild(pathLabel);
        gallery.appendChild(card);
      });
      addImageBtn.disabled =
        state.locked || images.length >= 3 || state.additional.type === "none";
    }

    function handleImageSelection(file, replaceIndex = null) {
      if (!file) return;
      const resolver = typeof uploadImage === "function" ? uploadImage : null;
      const applyPath = (path) => {
        if (!state.additional.images) state.additional.images = [];
        const sanitized = typeof path === "string" ? path : file.name;
        if (replaceIndex != null) {
          state.additional.images[replaceIndex] = sanitized;
        } else if (state.additional.images.length < 3) {
          state.additional.images.push(sanitized);
        }
        updateImagesPreview();
        emitChange();
      };

      if (resolver) {
        const maybePromise = resolver(file);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(applyPath).catch(() => {});
        } else if (typeof maybePromise === "string") {
          applyPath(maybePromise);
        } else {
          applyPath(file.name);
        }
      } else {
        applyPath(file.name);
      }
    }

    hiddenFileInput.addEventListener("change", () => {
      if (!hiddenFileInput.files || !hiddenFileInput.files.length) return;
      const file = hiddenFileInput.files[0];
      handleImageSelection(file, null);
      hiddenFileInput.value = "";
    });

    addImageBtn.addEventListener("click", () => {
      if (state.locked) return;
      hiddenFileInput.click();
    });

    typeSelect.addEventListener("change", () => {
      state.additional.type = typeSelect.value;
      if (state.additional.type === "text") {
        state.additional.images = [];
      } else if (state.additional.type === "image") {
        state.additional.text = "";
      }
      refreshVisibility();
      updateImagesPreview();
      emitChange();
    });

    textArea.addEventListener("input", () => {
      state.additional.text = textArea.value;
      emitChange();
    });

    updateImagesPreview();
    refreshVisibility();

    typeRow.appendChild(typeLabel);
    typeRow.appendChild(typeSelect);
    additionalCard.appendChild(additionalHeader);
    additionalCard.appendChild(typeRow);
    const textWrapper = _createEl("div", "", "");
    textWrapper.appendChild(textArea);
    additionalCard.appendChild(textWrapper);
    additionalCard.appendChild(gallery);
    additionalCard.appendChild(addImageBtn);
    additionalCard.appendChild(hiddenFileInput);

    root.appendChild(promptCard);
    root.appendChild(thresholdCard);
    root.appendChild(additionalCard);

    const api = {
      rootEl: root,
      collect() {
        return {
          prompt: state.prompt || "",
          successThreshold: state.successThreshold,
          additionalInfo: _sanitizeAdditional(state.additional),
        };
      },
      applyToTaskDto(targetTaskDto) {
        if (!targetTaskDto || typeof targetTaskDto !== "object") return;
        const content = _ensureContentPath(targetTaskDto);
        content.prompt = state.prompt || "";
        const settings = content.settings || {};
        if (state.successThreshold != null) {
          settings.success_threshold = state.successThreshold;
        } else {
          delete settings.success_threshold;
        }
        content.settings = settings;
        const normalized = _sanitizeAdditional(state.additional);
        if (normalized) {
          content.additionalInfo = normalized;
        } else {
          delete content.additionalInfo;
        }
      },
      setLocked(nextLocked) {
        state.locked = !!nextLocked;
        promptTextarea.disabled = state.locked;
        thresholdInput.disabled = state.locked;
        typeSelect.disabled = state.locked;
        textArea.disabled = state.locked;
        addImageBtn.disabled =
          state.locked ||
          (state.additional.images || []).length >= 3 ||
          state.additional.type === "none";
        updateImagesPreview();
      },
      updateAnnotationTotals(totals) {
        state.annotationTotals = totals || null;
        updateThresholdInfo();
      },
      setPrompt(value) {
        state.prompt = value || "";
        promptTextarea.value = state.prompt;
        updatePromptCounter();
      },
      addImageForTest(path) {
        if (typeof path !== "string") return;
        const trimmed = path.trim();
        if (!trimmed) return;
        if (!Array.isArray(state.additional.images)) {
          state.additional.images = [];
        }
        if (state.additional.images.length >= 3) return;
        state.additional.images.push(trimmed);
        updateImagesPreview();
        emitChange();
      },
    };

    return { rootEl: root, api };
  }

  TaskMetadataPanel.create = createTaskMetadataPanel;
  TaskMetadataPanel.normalizeAdditionalInfo = _normalizeAdditionalInfo;
  TaskMetadataPanel.createAdditionalInfoCard = _createAdditionalInfoCard;
  TaskMetadataPanel.resolveAssetUrl = _resolveAssetUrl;
  TaskMetadataPanel.openImageModal = null;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = TaskMetadataPanel;
  }
  global.TaskMetadataPanel = TaskMetadataPanel;
})(typeof window !== "undefined" ? window : this);
