(function (global) {
  const MistakesUI = {};

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== "function") return fallback;
    const v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

  const STYLE_ID = "mistakes-ui-styles";
  const getDEFAULT_CHOICE_PROMPT = () => wt("mistakesui.default_choice_prompt", "Выберите правильный вариант текста");

  const state = {
    taskDto: null,
    selections: new Set(),
    correctSet: new Set(),
    totalErrors: 0,
    container: null,
    callbacks: [],
    showReference: false,
    selectedOptionId: null,
    selectedOptionIndex: null,
    originalMode: null,
  };

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
.word-btn { display:inline-flex; align-items:center; gap:0.25rem; padding:0 0.25rem; border-radius:0.25rem; transition:color 150ms, background-color 150ms; cursor:pointer; user-select:none; border:1px solid transparent; }
.word-neutral { color: var(--color-text-main); }
.word-neutral:hover { background-color: var(--color-bg-hover); }
.word-correct { background-color: var(--color-success-lighter); color: var(--color-success-text); border-color: var(--color-success-light); pointer-events:none; }
.word-incorrect { background-color: var(--color-error-lighter); color: var(--color-error-text); border-color: var(--color-error-light); pointer-events:none; }
.mistakes-fade { animation: mistakesFade 220ms ease-out forwards; opacity:0; transform: translateY(6px); }
.mistakes-fade-slow { animation: mistakesFade 320ms ease-out forwards; opacity:0; transform: translateY(8px); }
@keyframes mistakesFade { to { opacity:1; transform: translateY(0); } }
.mistakes-ref { overflow:hidden; opacity:0; max-height:0; transition: opacity 220ms ease, max-height 220ms ease, transform 220ms ease; transform: translateY(6px); }
.mistakes-ref.visible { opacity:1; max-height:800px; transform: translateY(0); }
.choice-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:16px; margin-top:16px; }
.choice-card { position:relative; padding:18px; border:1px solid var(--color-border-subtle); border-radius:16px; background: color-mix(in srgb, var(--color-surface-1) 92%, var(--color-bg-secondary)); box-shadow: 0 8px 18px rgba(15, 23, 42, 0.05); transition: border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease; display:flex; flex-direction:column; gap:10px; }
.choice-card:hover { border-color: var(--color-primary); box-shadow: var(--shadow-md); transform: translateY(-1px); }
.choice-card.selected { border-color: var(--color-primary); box-shadow: var(--shadow-lg); }
.choice-card .choice-check { position:absolute; top:10px; right:10px; height:32px; width:32px; border-radius:50%; display:flex; align-items:center; justify-content:center; background: var(--color-success-lighter); color: var(--color-success-text); border:1px solid var(--color-success-light); opacity:0; transform: scale(0.9); transition: opacity 150ms ease, transform 150ms ease; }
.choice-card.selected .choice-check { opacity:1; transform: scale(1); }
.choice-card.success { border-color: var(--color-success); background: var(--color-success-lighter); box-shadow: var(--shadow-md); }
.choice-card.fail { border-color: var(--color-error-light); background: var(--color-error-lighter); box-shadow: var(--shadow-md); }
.choice-pill { display:inline-flex; align-items:center; gap:6px; padding:6px 10px; border-radius:9999px; font-weight:600; font-size:12px; background: color-mix(in srgb, var(--color-surface-1) 70%, var(--color-bg-secondary)); color: var(--color-text-main); border: 1px solid var(--color-border-subtle); }
.choice-pill.success { background: var(--color-success-lighter); color: var(--color-success-text); border:1px solid var(--color-success-light); }
.choice-btn { align-self:flex-start; padding:10px 12px; border-radius:12px; border:1px solid var(--color-border-subtle); font-weight:600; font-size:14px; color: var(--color-text-main); background: var(--color-surface-1); cursor:pointer; transition: all 150ms ease; }
.choice-btn:hover { border-color: var(--color-primary); color: var(--color-primary); box-shadow: var(--shadow-sm); }
.choice-btn.selected { background: var(--color-primary); color: var(--color-primary-fg); border-color: var(--color-primary-dark); }
.choice-status { display:flex; align-items:center; gap:8px; padding:10px 12px; border-radius:12px; background: var(--color-success-lighter); color: var(--color-success-text); border:1px solid var(--color-success-light); font-weight:600; font-size:13px; margin-top:12px; }
.choice-status .material-symbols-outlined { font-size:18px; }
`;
    document.head.appendChild(style);
  }

  function showToast(message, duration = 2000) {
    if (typeof document === "undefined") return;
    const existing = document.getElementById("mistakes-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "mistakes-toast";
    toast.className =
      "fixed top-20 left-1/2 -translate-x-1/2 z-[3000] px-4 py-3 rounded-lg shadow-lg text-text-on-dark bg-success border border-success-dark flex items-center gap-2 transition-opacity duration-300";
    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined text-[20px]";
    icon.textContent = "check_circle";
    const text = document.createElement("span");
    text.className = "text-sm font-medium";
    text.textContent = message;
    toast.appendChild(icon);
    toast.appendChild(text);
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.classList.add("opacity-0");
      setTimeout(() => toast.remove(), 320);
    }, duration);
  }

  function getContent(taskDto) {
    const td = (taskDto && taskDto.task_data) || {};
    const content = td.content || {};
    return content;
  }

  function normalizeMode(content) {
    const raw = content?.mode;
    if (raw === "text_choice" || raw === "text_errors") return raw;
    if (Array.isArray(content?.options) && content.options.length >= 2) {
      return "text_choice";
    }
    return "text_errors";
  }

  function normalizeErrorSpans(content) {
    const spans = Array.isArray(content.error_spans)
      ? content.error_spans
      : Array.isArray(content.errorSpans)
        ? content.errorSpans
        : [];
    return spans
      .map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        is_correct: s.is_correct !== false ? s.is_correct : false,
      }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start);
  }

  function resolveErrorRequirement(content, totalErrors) {
    const requireAll = content?.require_all_errors === true || content?.requireAllErrors === true;
    const rawRequired = Number(content?.required_correct ?? content?.requiredCorrect ?? NaN);
    let required = Number.isFinite(rawRequired) ? Math.trunc(rawRequired) : 0;
    if (requireAll && totalErrors > 0) required = totalErrors;
    if (!Number.isFinite(required) || required < 1) required = 1;
    if (totalErrors > 0 && required > totalErrors) required = totalErrors;
    return { requireAll, required };
  }

  function splitWords(text) {
    const words = [];
    let cursor = 0;
    const tokens = text.split(/(\s+)/);
    tokens.forEach((tok) => {
      const start = cursor;
      const end = start + tok.length;
      if (tok.trim().length > 0) {
        words.push({ text: tok, start, end });
      }
      cursor = end;
    });
    return words;
  }

  function isErrorWord(word, spans) {
    return spans.some((s) => word.start < s.end && word.end > s.start && s.is_correct === false);
  }

  function renderWordSpan(word, idx, spans, onClick) {
    const el = document.createElement("span");
    el.className = "word-btn word-neutral";
    el.dataset.index = String(idx);
    el.textContent = word.text;
    el.addEventListener("click", () => onClick(el, idx));
    if (isErrorWord(word, spans)) {
      el.dataset.target = "true";
    }
    return el;
  }

  function renderStatusSidebar(foundCount, totalKnown, completed) {
    const wrap = document.createElement("div");
    wrap.className = "sticky top-4 flex flex-col gap-4 p-5 rounded-2xl border border-border-subtle dark:border-border-strong bg-surface-1 dark:bg-surface-2 shadow-sm";

    const title = document.createElement("h3");
    title.className = "text-xs font-bold uppercase tracking-wider text-text-muted dark:text-text-muted";
    title.textContent = wt("mistakesui.analysis_status_title", "Статус анализа");
    wrap.appendChild(title);

    const stack = document.createElement("div");
    stack.className = "flex flex-col gap-4";

    const pulseRow = document.createElement("div");
    pulseRow.className = "flex items-start gap-3";
    const dotWrap = document.createElement("div");
    dotWrap.className = "mt-1 flex-shrink-0";
    const dot = document.createElement("div");
    dot.className = "h-2 w-2 rounded-full bg-primary animate-pulse";
    dotWrap.appendChild(dot);
    const pulseText = document.createElement("p");
    pulseText.className = "text-sm leading-relaxed text-text-secondary dark:text-text-muted";
    pulseText.textContent = completed ? wt("mistakesui.status_errors_marked", "Ошибки отмечены") : wt("mistakesui.status_continue_reading", "Продолжайте изучение текста...");
    pulseRow.appendChild(dotWrap);
    pulseRow.appendChild(pulseText);
    stack.appendChild(pulseRow);

    const statBlock = document.createElement("div");
    statBlock.className = "flex flex-col gap-2 pt-2 border-t border-border-subtle dark:border-border-strong";
    const statRow = document.createElement("div");
    statRow.className = "flex justify-between text-xs text-text-muted";
    const label = document.createElement("span");
    label.textContent = wt("mistakesui.errors_found_label", "Ошибок найдено");
    const value = document.createElement("span");
    value.className = "font-bold text-text-secondary dark:text-text-on-dark";
    const showTotal = completed && totalKnown;
    value.textContent = showTotal ? `${foundCount} / ${totalKnown}` : `${foundCount} / ?`;
    statRow.appendChild(label);
    statRow.appendChild(value);

    const barTrack = document.createElement("div");
    barTrack.className = "w-full bg-surface-2 dark:bg-surface-2 h-1.5 rounded-full overflow-hidden";
    const barFill = document.createElement("div");
    barFill.className = "bg-primary h-full rounded-full transition-all duration-200";
    const percent = totalKnown ? Math.min(100, Math.round((foundCount / totalKnown) * 100)) : 0;
    barFill.style.width = `${percent}%`;
    barTrack.appendChild(barFill);

    statBlock.appendChild(statRow);
    statBlock.appendChild(barTrack);
    stack.appendChild(statBlock);

    const hint = document.createElement("div");
    hint.className = "p-3.5 rounded-xl bg-info-lighter dark:bg-info-light border border-info-light dark:border-info-light shadow-sm";
    const hintText = document.createElement("p");
    hintText.className = "text-xs text-info-dark dark:text-info-light leading-normal";
    const hintPrefix = document.createElement("span");
    hintPrefix.className = "font-bold";
    hintPrefix.textContent = wt("mistakesui.hint_label", "Подсказка:");
    hintText.appendChild(hintPrefix);
    hintText.appendChild(
      document.createTextNode(
        wt("mistakesui.hint_text_errors", " Кликайте на слова, которые кажутся вам клинически неверными в данном контексте.")
      )
    );
    hint.appendChild(hintText);

    stack.appendChild(hint);
    wrap.appendChild(stack);

    return wrap;
  }

  function notifyState() {
    const found = [...state.selections].filter((idx) => state.correctSet.has(idx));
    const content = getContent(state.taskDto);
    const requirement = resolveErrorRequirement(content, state.totalErrors);
    const completedErrors = found.length >= requirement.required;
    const detail = {
      foundCount: found.length,
      totalKnown: state.totalErrors || null,
      completed: completedErrors || state.selectedOptionId !== null,
      selections: [...state.selections],
      mode: content?.mode || "text_errors",
      requiredCorrect: requirement.required,
      requireAllErrors: requirement.requireAll,
      selectedOptionId: state.selectedOptionId,
      selectedOptionIndex: state.selectedOptionIndex,
    };
    state.callbacks.forEach((cb) => {
      try {
        cb(detail);
      } catch (e) {
        // ignore
      }
    });
    if (state.container) {
      const evt = new CustomEvent("mistakes:state", { detail });
      state.container.dispatchEvent(evt);
    }
  }

  function render(container, taskDto, options = {}) {
    ensureStyles();
    state.taskDto = taskDto;
    state.container = container;
    state.callbacks = Array.isArray(options.onStateChange) ? options.onStateChange : options.onStateChange ? [options.onStateChange] : [];
    state.selections = new Set();
    state.correctSet = new Set();
    state.showReference = false;
    state.selectedOptionId = null;
    state.selectedOptionIndex = null;
    state.originalMode = null;

    const content = getContent(taskDto);
    const rawMode = content.mode;
    const mode = normalizeMode(content);
    state.originalMode = rawMode;
    content.mode = mode; // normalize for downstream consumers
    if (mode === "text_choice") {
      renderChoiceMode(container, content);
      return;
    }
    renderTextErrorsMode(container, content);
  }

  function renderTextErrorsMode(container, content) {
    const text = content.text || content.prompt || "";
    const referenceText = content.reference_text || content.referenceText || "";
    const referenceSpans = Array.isArray(content.reference_spans)
      ? content.reference_spans
      : Array.isArray(content.referenceSpans)
        ? content.referenceSpans
        : [];
    const errorSpans = normalizeErrorSpans(content);
    const words = splitWords(text);
    words.forEach((w, idx) => {
      if (isErrorWord(w, errorSpans)) state.correctSet.add(idx);
    });
    state.totalErrors = state.correctSet.size;
    const requirement = resolveErrorRequirement(content, state.totalErrors);
    try {
      console.info("[MistakesUI] init", {
        referenceTextLength: referenceText.length,
        referenceSpans: referenceSpans.length,
        requiredCorrect: requirement.required,
        requireAll: requirement.requireAll,
        totalErrors: state.totalErrors,
      });
    } catch (e) {
      // ignore
    }

    container.innerHTML = "";

    const grid = document.createElement("div");
    grid.className = "p-4 grid grid-cols-1 lg:grid-cols-4 gap-6";

    const mainCol = document.createElement("div");
    mainCol.className = "lg:col-span-3 flex flex-col rounded-2xl shadow-lg bg-surface-1 dark:bg-surface-2 p-6 sm:p-8 border border-border-subtle dark:border-border-strong mistakes-fade";

    const headerBlock = document.createElement("div");
    headerBlock.className = "mb-6";
    const title = document.createElement("h2");
    title.className = "text-text-main dark:text-text-on-dark text-xl font-bold leading-tight tracking-[-0.015em]";
    title.textContent = wt("mistakesui.mark_errors_title", "Отметьте ошибки в тексте");
    headerBlock.appendChild(title);

    const divider = document.createElement("div");
    divider.className = "mt-4 mb-2 h-px bg-bg-tertiary dark:bg-surface-2";
    headerBlock.appendChild(divider);

    const wordsWrap = document.createElement("div");
    wordsWrap.className = "pt-2 text-lg leading-loose tracking-wide font-normal flex flex-wrap gap-1.5";

    function handleWordClick(el, idx) {
      if (state.selections.has(idx)) return;
      state.selections.add(idx);
      const isCorrect = state.correctSet.has(idx);
      el.classList.remove("word-neutral");
      el.classList.add(isCorrect ? "word-correct" : "word-incorrect");
      try {
        const rect = el.getBoundingClientRect();
        console.info("[MistakesUI] word click", {
          idx,
          isCorrect,
          classes: el.className,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        });
      } catch (e) {
        // ignore
      }

      const icon = document.createElement("span");
      icon.className = "material-symbols-outlined text-[16px] " + (isCorrect ? "text-success" : "text-error");
      icon.textContent = isCorrect ? "check_circle" : "cancel";
      el.appendChild(icon);

      logUiSnapshot("before-updateStatus", { clickedIdx: idx, isCorrect });
      notifyState();
      updateStatus();
    }

    words.forEach((w, idx) => {
      const wordEl = renderWordSpan(w, idx, errorSpans, handleWordClick);
      wordsWrap.appendChild(wordEl);
    });

    headerBlock.appendChild(wordsWrap);
    mainCol.appendChild(headerBlock);

    const badges = document.createElement("div");
    badges.className = "mt-8 flex flex-wrap gap-2";
    badges.id = "mistakes-status-badges";
    mainCol.appendChild(badges);

    const referenceCard = document.createElement("div");
    referenceCard.id = "mistakes-reference";
    referenceCard.className =
      "mistakes-ref mt-6 rounded-xl border border-success-light bg-success-lighter p-4 dark:border-success-dark dark:bg-success-light";
    const refTitle = document.createElement("div");
    refTitle.className = "text-sm font-bold text-success-text dark:text-success-light mb-2";
    refTitle.textContent = wt("mistakesui.reference_text_title", "Референсный текст");
    const refBody = document.createElement("div");
    refBody.className = "text-base leading-loose tracking-wide text-text-main dark:text-text-on-dark";
    referenceCard.appendChild(refTitle);
    referenceCard.appendChild(refBody);

    function renderReferenceText() {
      refBody.innerHTML = "";
      const spans = Array.isArray(referenceSpans)
        ? referenceSpans
          .map((s) => ({
            start: Number(s.start),
            end: Number(s.end),
          }))
          .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
          .sort((a, b) => a.start - b.start)
        : [];
      let cursor = 0;
      for (const s of spans) {
        if (cursor < s.start) {
          refBody.appendChild(document.createTextNode(referenceText.slice(cursor, s.start)));
        }
        const mark = document.createElement("span");
        mark.className =
          "px-1 rounded bg-success-light text-success-darker dark:bg-success-light dark:text-success-lighter";
        mark.textContent = referenceText.slice(s.start, s.end);
        refBody.appendChild(mark);
        cursor = s.end;
      }
      if (cursor < referenceText.length) {
        refBody.appendChild(document.createTextNode(referenceText.slice(cursor)));
      }
    }

    const referenceControls = document.createElement("div");
    referenceControls.className = "mt-4 flex items-start gap-3";
    const refButton = document.createElement("button");
    refButton.type = "button";
    refButton.className =
      "hidden px-4 py-2 rounded-xl border border-success text-success-text font-semibold text-sm bg-success-lighter hover:bg-success-light dark:border-success-dark dark:text-success-light dark:bg-success-light dark:hover:bg-success-light shadow-sm transition";
    refButton.textContent = wt("mistakesui.show_reference_btn", "Показать референсный текст");
    const refHint = document.createElement("p");
    refHint.className = "hidden text-sm text-text-muted dark:text-text-muted leading-relaxed";
    refHint.textContent = wt("mistakesui.min_errors_found_hint", "Вы нашли минимально необходимое число ошибок. Можно открыть референс или продолжить поиск.");
    referenceControls.appendChild(refButton);
    referenceControls.appendChild(refHint);

    refButton.addEventListener("click", () => {
      state.showReference = true;
      renderReferenceText();
      referenceCard.classList.add("visible");
      referenceCard.classList.add("mistakes-fade-slow");
      refButton.classList.add("hidden");
      refHint.classList.add("hidden");
      try {
        console.info("[MistakesUI] reference shown (button)");
      } catch (e) {
        // ignore
      }
    });

    grid.appendChild(mainCol);

    const sidebarCol = document.createElement("div");
    sidebarCol.className = "lg:col-span-1";
    const sidebar = renderStatusSidebar(0, state.totalErrors, false);
    sidebar.id = "mistakes-sidebar";
    sidebarCol.appendChild(sidebar);
    grid.appendChild(sidebarCol);
    mainCol.appendChild(referenceControls);
    mainCol.appendChild(referenceCard);

    container.appendChild(grid);

    function logUiSnapshot(stage, extra = {}) {
      try {
        const refVisible = !referenceCard.classList.contains("hidden");
        const refRect = refVisible ? referenceCard.getBoundingClientRect() : null;
        const btnVisible = !refButton.classList.contains("hidden");
        const hintVisible = !refHint.classList.contains("hidden");
        console.info("[MistakesUI] snapshot", {
          stage,
          selections: [...state.selections],
          totalErrors: state.totalErrors,
          showReference: state.showReference,
          refVisible,
          refRect: refRect
            ? {
              x: Math.round(refRect.x),
              y: Math.round(refRect.y),
              w: Math.round(refRect.width),
              h: Math.round(refRect.height),
            }
            : null,
          btnVisible,
          hintVisible,
          extra,
        });
      } catch (e) {
        // ignore
      }
    }

    function updateStatus() {
      const found = [...state.selections].filter((idx) => state.correctSet.has(idx));
      const runtimeRequirement = resolveErrorRequirement(content, state.totalErrors);
      const completed = found.length >= runtimeRequirement.required;
      const badgesBox = badges;
      badgesBox.innerHTML = "";
      if (completed) {
        const chip = document.createElement("div");
        chip.className = "flex items-center gap-2 px-3 py-1.5 bg-success-lighter dark:bg-success-light border border-success-light dark:border-success-dark rounded-lg";
        const icon = document.createElement("span");
        icon.className = "material-symbols-outlined text-success";
        icon.textContent = "task_alt";
        const text = document.createElement("span");
        text.className = "text-sm font-medium text-success-text dark:text-success";
        text.textContent = wt("mistakesui.task_completed", "Задание выполнено");
        chip.appendChild(icon);
        chip.appendChild(text);
        badgesBox.appendChild(chip);
        if (referenceText) {
          state.showReference = true;
          renderReferenceText();
          referenceCard.classList.add("visible");
          referenceCard.classList.add("mistakes-fade-slow");
          refButton.classList.add("hidden");
          refHint.classList.add("hidden");
          try {
            console.info("[MistakesUI] auto-show reference (all found)");
          } catch (e) {
            // ignore
          }
          logUiSnapshot("auto-show-reference", { found: found.length, completed });
        }
      }

      const hasReference = Boolean(referenceText);
      const thresholdMet =
        found.length >= runtimeRequirement.required;
      const canShowButton =
        hasReference &&
        !state.showReference &&
        !completed &&
        !runtimeRequirement.requireAll &&
        thresholdMet;
      if (canShowButton) {
        refButton.classList.remove("hidden");
        refHint.classList.remove("hidden");
        try {
          console.info("[MistakesUI] show reference button", {
            found: found.length,
            requiredCorrect: runtimeRequirement.required,
          });
        } catch (e) {
          // ignore
        }
        logUiSnapshot("show-ref-button", { found: found.length, completed, thresholdMet });
      } else {
        refButton.classList.add("hidden");
        refHint.classList.add("hidden");
      }
      const oldSidebar = document.getElementById("mistakes-sidebar");
      if (oldSidebar && oldSidebar.parentElement) {
        const replacement = renderStatusSidebar(found.length, state.totalErrors, completed);
        replacement.id = "mistakes-sidebar";
        replacement.classList.add("mistakes-fade");
        oldSidebar.parentElement.replaceChild(replacement, oldSidebar);
      }
      logUiSnapshot("after-updateStatus", { found: found.length, completed, thresholdMet: canShowButton || completed });
    }

    notifyState();
    updateStatus();
  }

  function renderChoiceMode(container, content) {
    const options = Array.isArray(content.options) ? content.options.map((opt, idx) => ({ ...opt, _idx: idx })) : [];
    const prompt = content.choice_prompt || content.prompt || getDEFAULT_CHOICE_PROMPT();
    const referenceText = content.reference_text || content.referenceText || "";
    const correctCount = options.filter((o) => o.is_correct).length;
    const isInvalid =
      options.length < 2 ||
      correctCount !== 1 ||
      options.some((o) => typeof o.text !== "string" || o.text.trim().length === 0);

    container.innerHTML = "";

    const wrap = document.createElement("div");
    wrap.className = "p-4 flex flex-col gap-4";

    const header = document.createElement("div");
    header.className = "flex items-center justify-between gap-3";
    const title = document.createElement("h2");
    title.className = "text-text-main text-xl font-bold leading-tight tracking-[-0.015em]";
    title.textContent = prompt;
    header.appendChild(title);
    wrap.appendChild(header);

    const grid = document.createElement("div");
    grid.className = "choice-grid";

    if (isInvalid) {
      const warning = document.createElement("div");
      warning.className =
        "rounded-lg border border-error-light bg-error-lighter text-error-text px-4 py-3 text-sm";
      warning.textContent = wt("mistakesui.settings_warning", "Проверьте настройки задания: минимум 2 варианта, один отмечен как правильный, у всех есть текст.");
      wrap.appendChild(warning);
      container.appendChild(wrap);
      notifyState();
      return;
    }

    function updateSelection(option) {
      const prevId = state.selectedOptionId;
      const prevIdx = state.selectedOptionIndex;
      state.selectedOptionId = option?.id ?? null;
      state.selectedOptionIndex = option?._idx ?? null;
      const correctId = options.find((o) => o.is_correct)?.id ?? null;
      grid.querySelectorAll(".choice-card").forEach((card) => {
        const cardId = card.dataset.optionId;
        const cardIdx = Number(card.dataset.optionIndex);
        const isSelected =
          (option?.id !== undefined && String(option.id) === cardId) ||
          (option?.id === undefined && cardIdx === option?._idx);
        const isCorrect = cardId ? cardId === String(correctId) : options[cardIdx]?.is_correct;
        card.classList.toggle("selected", isSelected);
        card.classList.toggle("success", isCorrect);
        card.classList.toggle("fail", isSelected && !isCorrect);
        const btn = card.querySelector(".choice-btn");
        const pill = card.querySelector(".choice-pill");
        if (btn) {
          btn.classList.toggle("selected", isSelected);
          btn.textContent = isSelected ? wt("mistakesui.option_selected", "Выбрано") : wt("mistakesui.option_select", "Выбрать");
        }
        if (pill) {
          pill.classList.toggle("success", isSelected);
          const baseLabel = card.dataset.optionLabel || pill.dataset.optionLabel || "";
          pill.textContent = baseLabel;
        }
        const check = card.querySelector(".choice-check");
        if (check) {
          check.classList.toggle("opacity-0", !isSelected);
          check.classList.toggle("scale-90", !isSelected);
          const ico = check.querySelector(".material-symbols-outlined");
          if (ico) {
            ico.textContent = isCorrect ? "check_circle" : isSelected ? "cancel" : "check_circle";
            ico.className = "material-symbols-outlined text-[18px] " + (isCorrect ? "text-success" : isSelected ? "text-error" : "");
          }
        }
      });
      const changed = prevId !== state.selectedOptionId || prevIdx !== state.selectedOptionIndex;
      if (changed) {
        const isCorrect = option?.is_correct === true;
        showToast(isCorrect ? wt("mistakesui.toast_correct", "Верно") : wt("mistakesui.toast_incorrect", "Неверно"));
      }
      notifyState();
    }

    options.forEach((opt, idx) => {
      const card = document.createElement("div");
      card.className = "choice-card";
      card.dataset.optionIndex = String(idx);
      if (opt.id !== undefined) {
        card.dataset.optionId = String(opt.id);
      }
      card.addEventListener("click", (evt) => {
        // избегаем двойного срабатывания на кнопке
        if (evt.target.closest("button")) return;
        updateSelection(opt);
      });

      const checkMark = document.createElement("div");
      checkMark.className = "choice-check opacity-0 scale-90";
      const checkIcon = document.createElement("span");
      checkIcon.className = "material-symbols-outlined text-[18px]";
      checkIcon.textContent = "check";
      checkMark.appendChild(checkIcon);
      card.appendChild(checkMark);

      const pill = document.createElement("div");
      pill.className = "choice-pill";
      const pillIcon = document.createElement("span");
      pillIcon.className = "material-symbols-outlined text-[16px]";
      pillIcon.textContent = "article";
      const pillText = document.createElement("span");
      const alphaLabels = wt("mistakesui.alpha_labels", "АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЭЮЯ");
      const label = alphaLabels[idx] || String(idx + 1);
      const baseLabel = wt("mistakesui.option_label", "Вариант {label}").replace("{label}", label);
      pillText.textContent = baseLabel;
      card.dataset.optionLabel = baseLabel;
      pill.dataset.optionLabel = baseLabel;
      pill.appendChild(pillIcon);
      pill.appendChild(pillText);
      pill.classList.add("choice-pill");
      card.appendChild(pill);

      const body = document.createElement("div");
      body.className = "text-sm leading-relaxed text-text-main whitespace-pre-wrap";
      body.textContent = (opt.text || "").toString();
      card.appendChild(body);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "choice-btn";
      btn.textContent = wt("mistakesui.option_select", "Выбрать");
      btn.addEventListener("click", () => updateSelection(opt));
      card.appendChild(btn);

      grid.appendChild(card);
    });

    wrap.appendChild(grid);

    if (referenceText) {
      const refBox = document.createElement("div");
      refBox.className = "rounded-lg border border-border-subtle bg-surface-2 p-4 flex flex-col gap-2";
      const refHeader = document.createElement("div");
      refHeader.className = "flex items-center gap-2 text-sm font-semibold text-text-secondary";
      const refIcon = document.createElement("span");
      refIcon.className = "material-symbols-outlined text-[18px]";
      refIcon.textContent = "menu_book";
      const refTitle = document.createElement("span");
      refTitle.textContent = wt("mistakesui.hint_title", "Подсказка");
      refHeader.appendChild(refIcon);
      refHeader.appendChild(refTitle);
      const refBody = document.createElement("div");
      refBody.className = "text-sm leading-relaxed text-text-secondary whitespace-pre-wrap";
      refBody.textContent = referenceText;
      refBox.appendChild(refHeader);
      refBox.appendChild(refBody);
      wrap.appendChild(refBox);
    }

    container.appendChild(wrap);

    // initial
    notifyState();
  }

  function getUserAnswerPayload() {
    const content = state.taskDto?.task_data?.content || {};
    const normalizedMode = content.mode || "text_errors";
    // Для сервера схема ожидает text_choice/text_errors, поэтому отправляем нормализованный режим
    const effectiveMode = normalizedMode;
    if (normalizedMode === "text_choice") {
      const optionId = state.selectedOptionId;
      return {
        mode: effectiveMode,
        selected_option_id: optionId,
        selected_option: optionId, // alias на случай другого названия
        selected_option_ids: optionId ? [optionId] : [],
        selected_option_index: state.selectedOptionIndex,
      };
    }
    return {
      mode: "text_errors",
      selected_indices: [...state.selections],
      total_errors: state.totalErrors,
    };
  }

  MistakesUI.render = render;
  MistakesUI.getUserAnswerPayload = getUserAnswerPayload;

  // Phase 2: Cleanup method to prevent memory leaks
  MistakesUI.cleanup = function cleanup() {
    // Reset state
    state.taskDto = null;
    state.selections = new Set();
    state.correctSet = new Set();
    state.totalErrors = 0;
    state.container = null;
    state.callbacks = [];
    state.showReference = false;
    state.selectedOptionId = null;
    state.selectedOptionIndex = null;
    state.originalMode = null;
    // Note: Event listeners are attached to DOM elements that will be removed,
    // so they will be garbage collected automatically.
    // Toast elements are removed after timeout.
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = MistakesUI;
  }
  global.MistakesUI = MistakesUI;
})(typeof window !== "undefined" ? window : globalThis);
