// TestUIQuestion: responsible for rendering question body for test tasks
// This module plugs into TestUI.web.js via TestUIQuestion.createQuestionRenderer(state, main)

(function (global) {
  // Inject TestUI animation styles once
  (function _injectTestUIStyles() {
    if (document.getElementById("testui-anim-style")) return;
    const s = document.createElement("style");
    s.id = "testui-anim-style";
    s.textContent =
      "@keyframes tuiSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }" +
      ".tui-question-enter { animation: tuiSlideUp 220ms ease-out forwards; }" +
      ".tui-option-enter { animation: tuiSlideUp 180ms ease-out both; }";
    document.head.appendChild(s);
  })();

  const CLASSMAP = {
    l1: {
      textOption: {
        neutral:
          "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-border-strong bg-surface-1 px-5 py-4 text-[15px] text-text-main dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark shadow-sm transition-all hover:-translate-y-[1px] hover:bg-bg-hover dark:hover:bg-bg-hover active:scale-[.99]",
        selected:
          "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-primary-dark bg-primary px-5 py-4 text-[15px] text-primary-fg ring-2 ring-primary-light shadow-sm transition-all active:scale-[.99]",
        reviewCorrectChosen:
          "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-success bg-success-light px-5 py-4 text-[15px] text-success-text shadow-sm transition-colors dark:border-success dark:bg-success-light dark:text-success-lighter",
        reviewCorrectMissed:
          "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-dashed border-success bg-surface-1 px-5 py-4 text-[15px] text-success-text shadow-sm transition-colors dark:border-success dark:bg-surface-1 dark:text-success-lighter",
        reviewWrongChosen:
          "flex cursor-pointer items-start gap-3 rounded-2xl border-2 border-error bg-error-light px-5 py-4 text-[15px] text-error-dark shadow-sm transition-colors dark:border-error dark:bg-error-light dark:text-error-lighter",
      },
    },
    l2: {
      open: {
        textareaAnswering:
          "w-full rounded-xl border-2 border-border-strong dark:border-border-strong bg-surface-1 dark:bg-bg-hover p-4 text-text-main dark:text-text-on-dark placeholder:text-text-secondary dark:placeholder:text-text-secondary focus:ring-2 focus:ring-primary focus:border-primary transition-colors min-h-[132px] leading-relaxed",
        textareaReviewCorrect:
          "w-full rounded-2xl border-2 border-success bg-surface-1 dark:bg-surface-1 p-4 text-text-main dark:text-text-on-dark min-h-[132px] cursor-not-allowed leading-relaxed shadow-sm",
        textareaReviewIncorrect:
          "w-full rounded-2xl border-2 border-error bg-surface-1 dark:bg-surface-1 p-4 text-text-main dark:text-text-on-dark min-h-[132px] cursor-not-allowed leading-relaxed shadow-sm",
      },
    },
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hasMeaningfulAnswerValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value != null;
  }

  function createQuestionRenderer(state, main) {
    const rerenderSidebar =
      typeof state._rerenderSidebar === "function"
        ? state._rerenderSidebar
        : null;
    const syncSidebarQuestion =
      typeof state._syncSidebarQuestion === "function"
        ? state._syncSidebarQuestion
        : null;
    const rerenderQuestion =
      typeof state._rerenderQuestion === "function"
        ? state._rerenderQuestion
        : null;

    function toOptionIndexSet(ids) {
      const out = new Set();
      if (!Array.isArray(ids)) return out;
      ids.forEach((value) => {
        if (typeof value === "number" && Number.isInteger(value)) {
          out.add(value);
          return;
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (/^-?\d+$/.test(trimmed)) {
            out.add(Number(trimmed));
          }
        }
      });
      return out;
    }

    function getNormalizedFeedbackStatus(feedback) {
      if (!feedback || typeof feedback !== "object") return null;

      const rawStatus = String(feedback.status || "").trim().toLowerCase();
      if (
        rawStatus === "correct" ||
        rawStatus === "incorrect" ||
        rawStatus === "unanswered"
      ) {
        return rawStatus;
      }

      const details =
        feedback.details && typeof feedback.details === "object"
          ? feedback.details
          : {};
      const correctIds = toOptionIndexSet(
        Array.isArray(feedback.correct_option_ids)
          ? feedback.correct_option_ids
          : details.correct_option_ids
      );
      const userIds = toOptionIndexSet(
        Array.isArray(feedback.user_option_ids)
          ? feedback.user_option_ids
          : details.user_option_ids
      );
      const hasUserAnswer =
        userIds.size > 0 ||
        hasMeaningfulAnswerValue(feedback.user_answer) ||
        hasMeaningfulAnswerValue(details.user_answer);

      if (feedback.correct === true || feedback.is_correct === true) {
        return "correct";
      }
      if (feedback.correct === false || feedback.is_correct === false) {
        return hasUserAnswer ? "incorrect" : "unanswered";
      }

      const reason = String(feedback.reason || details.reason || "")
        .trim()
        .toLowerCase();
      if (reason === "not_answered" || reason === "no_answers") {
        return "unanswered";
      }

      if (correctIds.size > 0 || userIds.size > 0) {
        if (userIds.size === 0) return "unanswered";
        const isCorrect =
          correctIds.size === userIds.size &&
          Array.from(userIds).every((id) => correctIds.has(id));
        return isCorrect ? "correct" : "incorrect";
      }

      if (hasUserAnswer) {
        return "incorrect";
      }

      return null;
    }

    function hasToleranceAcceptance(feedback) {
      if (!feedback || typeof feedback !== "object") return false;
      const details =
        feedback.details && typeof feedback.details === "object"
          ? feedback.details
          : {};
      const toleranceType = String(
        feedback.tolerance_type || details.tolerance_type || ""
      )
        .trim()
        .toLowerCase();
      const toleranceExplanation = String(
        feedback.tolerance_explanation || details.tolerance_explanation || ""
      ).trim();
      return Boolean(toleranceType || toleranceExplanation);
    }

    function buildReferenceAnswerDiff(referenceAnswer, userAnswer) {
      const referenceChars = Array.from(String(referenceAnswer || ""));
      const userChars = Array.from(String(userAnswer || ""));
      if (referenceChars.length === 0) {
        return { html: "", hasHighlights: false };
      }
      if (userChars.length === 0) {
        return { html: escapeHtml(referenceChars.join("")), hasHighlights: false };
      }

      const normalizedReference = referenceChars.map((char) => char.toLowerCase());
      const normalizedUser = userChars.map((char) => char.toLowerCase());
      const dp = Array.from({ length: referenceChars.length + 1 }, () =>
        Array(userChars.length + 1).fill(0)
      );

      for (let i = referenceChars.length - 1; i >= 0; i -= 1) {
        for (let j = userChars.length - 1; j >= 0; j -= 1) {
          if (normalizedReference[i] === normalizedUser[j]) {
            dp[i][j] = dp[i + 1][j + 1] + 1;
          } else {
            dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
      }

      const matchedReference = Array(referenceChars.length).fill(false);
      let refIndex = 0;
      let userIndex = 0;
      while (refIndex < referenceChars.length && userIndex < userChars.length) {
        if (normalizedReference[refIndex] === normalizedUser[userIndex]) {
          matchedReference[refIndex] =
            referenceChars[refIndex] === userChars[userIndex];
          refIndex += 1;
          userIndex += 1;
        } else if (dp[refIndex + 1][userIndex] >= dp[refIndex][userIndex + 1]) {
          refIndex += 1;
        } else {
          userIndex += 1;
        }
      }

      let html = "";
      let hasHighlights = false;
      let chunk = "";
      let currentChanged = null;

      function flushChunk() {
        if (!chunk) return;
        const escapedChunk = escapeHtml(chunk);
        if (currentChanged) {
          hasHighlights = true;
          html += `<mark data-testui="l2-reference-diff" class="rounded-md border border-warning-light bg-warning-lighter px-1 py-0.5 font-semibold text-warning-darker dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter">${escapedChunk}</mark>`;
        } else {
          html += escapedChunk;
        }
        chunk = "";
      }

      referenceChars.forEach((char, index) => {
        const isChanged = !matchedReference[index];
        if (currentChanged === null) {
          currentChanged = isChanged;
          chunk = char;
          return;
        }
        if (currentChanged === isChanged) {
          chunk += char;
          return;
        }
        flushChunk();
        currentChanged = isChanged;
        chunk = char;
      });
      flushChunk();

      return { html, hasHighlights };
    }

    function appendReferenceAnswerCard(body, options = {}) {
      const title = String(options.title || "Эталонный ответ");
      const html = String(options.html || "");
      const hintText = String(options.hintText || "").trim();
      const dataTestUi = String(options.dataTestUi || "l2-reference-answer");

      const referenceWrapper = document.createElement("div");
      referenceWrapper.dataset.testui = dataTestUi;
      referenceWrapper.className =
        "mt-4 overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-sm dark:border-border-strong dark:bg-surface-1";

      const referenceHeader = document.createElement("div");
      referenceHeader.className =
        "flex items-center gap-2 border-b border-border-strong bg-success-light px-4 py-3 dark:border-border-strong dark:bg-success-light";

      const referenceIcon = document.createElement("span");
      referenceIcon.className =
        "material-symbols-outlined text-[18px] text-success-text dark:text-success-lighter";
      referenceIcon.textContent = "check_circle";

      const referenceLabel = document.createElement("div");
      referenceLabel.className =
        "text-[12px] font-semibold uppercase tracking-[0.08em] text-success-text dark:text-success-lighter";
      referenceLabel.textContent = title;

      referenceHeader.appendChild(referenceIcon);
      referenceHeader.appendChild(referenceLabel);
      referenceWrapper.appendChild(referenceHeader);

      if (hintText) {
        const hint = document.createElement("div");
        hint.dataset.testui = `${dataTestUi}-hint`;
        hint.className =
          "border-b border-warning-light bg-warning-lighter px-4 py-3 text-[13px] leading-5 text-warning-darker dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter";
        hint.textContent = hintText;
        referenceWrapper.appendChild(hint);
      }

      const referenceText = document.createElement("div");
      referenceText.className =
        "px-4 py-4 text-sm leading-relaxed text-text-main dark:text-text-on-dark whitespace-pre-wrap";
      referenceText.innerHTML = html;
      referenceWrapper.appendChild(referenceText);

      body.appendChild(referenceWrapper);
      return { wrapper: referenceWrapper, content: referenceText };
    }

    function createCompactStatusBadge(label, tone = "neutral") {
      const badge = document.createElement("span");
      let badgeClass =
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ";

      if (tone === "success") {
        badgeClass +=
          "border-success bg-success-light text-success-text dark:border-success dark:bg-success-light dark:text-success-lighter";
      } else if (tone === "error") {
        badgeClass +=
          "border-error bg-error-light text-error-dark dark:border-error dark:bg-error-light dark:text-error-lighter";
      } else if (tone === "warning") {
        badgeClass +=
          "border-warning-light bg-warning-lighter text-warning-darker dark:border-warning-light dark:bg-warning-light dark:text-warning-lighter";
      } else {
        badgeClass +=
          "border-border-strong bg-surface-2 text-text-secondary dark:border-border-strong dark:bg-surface-2 dark:text-text-secondary";
      }

      badge.className = badgeClass;
      badge.textContent = label;
      return badge;
    }

    function appendSectionShell(body, options = {}) {
      const wrapper = document.createElement("section");
      wrapper.className = (
        "mt-5 overflow-hidden rounded-[24px] border border-border-strong bg-surface-1 shadow-sm dark:border-border-strong dark:bg-surface-1 " +
        String(options.wrapperClass || "")
      ).trim();

      const title = String(options.title || "").trim();
      const description = String(options.description || "").trim();
      const headerClass = String(options.headerClass || "").trim();
      const badge = options.badge || null;

      if (title || description || badge) {
        const header = document.createElement("div");
        header.className = (
          "flex items-start justify-between gap-3 border-b border-border-strong px-4 py-4 dark:border-border-strong " +
          (headerClass || "bg-surface-2 dark:bg-surface-2")
        ).trim();

        const textBlock = document.createElement("div");
        textBlock.className = "min-w-0 space-y-1";

        if (title) {
          const titleEl = document.createElement("div");
          titleEl.className =
            "text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary dark:text-text-secondary";
          titleEl.textContent = title;
          textBlock.appendChild(titleEl);
        }

        if (description) {
          const descriptionEl = document.createElement("p");
          descriptionEl.className =
            "text-sm leading-relaxed text-text-main dark:text-text-on-dark";
          descriptionEl.textContent = description;
          textBlock.appendChild(descriptionEl);
        }

        header.appendChild(textBlock);
        if (badge) {
          header.appendChild(badge);
        }
        wrapper.appendChild(header);
      }

      const content = document.createElement("div");
      content.className = String(options.contentClass || "px-4 py-4");
      wrapper.appendChild(content);
      body.appendChild(wrapper);
      return { wrapper, content };
    }

    function getChoiceReviewMeta(questionFeedback, isMultiple) {
      const status = getNormalizedFeedbackStatus(questionFeedback) || "unknown";

      if (status === "correct") {
        return {
          title: "Разбор ответа",
          description: isMultiple
            ? "Вы выбрали все правильные варианты."
            : "Вы выбрали правильный вариант.",
          badge: createCompactStatusBadge("Верно", "success"),
          headerClass: "bg-success-light dark:bg-success-light",
        };
      }

      if (status === "incorrect") {
        return {
          title: "Разбор ответа",
          description: isMultiple
            ? "Зеленым отмечены правильные варианты, красным отмечены лишние выбранные."
            : "Зеленым отмечен правильный вариант, красным отмечен ваш неверный выбор.",
          badge: createCompactStatusBadge("Есть ошибка", "error"),
          headerClass: "bg-error-light dark:bg-error-light",
        };
      }

      if (status === "unanswered") {
        return {
          title: "Разбор ответа",
          description: "Ответ на этот вопрос не был выбран.",
          badge: createCompactStatusBadge("Без ответа"),
          headerClass: "bg-surface-2 dark:bg-surface-2",
        };
      }

      return {
        title: "Разбор ответа",
        description: "",
        badge: null,
        headerClass: "bg-surface-2 dark:bg-surface-2",
      };
    }

    function renderQuestionView() {
      main.innerHTML = "";
      const currentMeta =
        state.questions[state.currentIndex] || state.questions[0] || null;
      const body = renderQuestionBody(currentMeta);
      main.appendChild(body);
    }

    function renderQuestionBody(currentMeta) {
      const body = document.createElement("div");
      body.className =
        "space-y-6 rounded-[28px] border-2 border-border-strong bg-surface-2 px-5 py-5 text-sm text-text-main shadow-md dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark tui-question-enter lg:px-7 lg:py-6";

      if (!currentMeta || !state.questions.length) {
        const empty = document.createElement("p");
        empty.textContent = "В задании нет вопросов";
        body.appendChild(empty);
        // Навигация между вопросами (стрелки под вариантами / полем ответа)
        renderQuestionNavigation(body);
        return body;
      }

      const raw =
        (state.rawQuestions &&
          state.rawQuestions[currentMeta.index ?? state.currentIndex]) ||
        null;

      // Question text
      const qText = document.createElement("p");
      qText.className =
        "mb-1 max-w-3xl text-[1.05rem] font-semibold leading-7 text-text-main dark:text-text-on-dark";
      qText.textContent = currentMeta.text || "Вопрос теста";
      body.appendChild(qText);

      // Optional question images (L1.C / L2)
      if (raw) {
        const questionImages = collectQuestionImageRefs(raw);

        if (questionImages.length) {
          const imgWrapper = document.createElement("div");
          imgWrapper.className = questionImages.length === 1
            ? "mt-3 mb-3 flex justify-center"
            : "mt-3 mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3";

          questionImages.forEach((questionImagePath, index) => {
            const img = document.createElement("img");
            img.src = questionImagePath;
            img.alt = `Изображение вопроса ${index + 1}`;
            img.className = questionImages.length === 1
              ? "max-h-[260px] w-auto object-contain rounded-lg border border-border-strong dark:border-border-strong shadow-sm cursor-pointer"
              : "max-h-[260px] w-full object-contain rounded-lg border border-border-strong dark:border-border-strong shadow-sm cursor-pointer";

            img.addEventListener("click", (ev) => {
              ev.preventDefault();
              openImageLightbox(questionImagePath, currentMeta.text || "Изображение вопроса");
            });

            imgWrapper.appendChild(img);
          });
          body.appendChild(imgWrapper);
        }
      }

      // Open-mode (L2) vs options (L1)
      const hasOptions = raw && Array.isArray(raw.answers) && raw.answers.length > 0;
      let hasImageOptions = false;
      let allImageOptions = false;
      if (hasOptions) {
        hasImageOptions = raw.answers.some(
          (a) => Boolean(resolveImageUrlForWeb(a))
        );
        allImageOptions = hasImageOptions && raw.answers.every(
          (a) => Boolean(resolveImageUrlForWeb(a))
        );
      }

      // Специальное правило для чисто картинных вопросов: если ВСЕ варианты имеют
      // изображение, то даже на 2 уровне сложности отображаем как L1 (варианты-картинки),
      // а не как open-text.
      const forceClosedForImageOnly = hasOptions && allImageOptions;

      if (state.isOpenMode && !forceClosedForImageOnly) {
        renderOpenQuestion(body, currentMeta);
      } else if (hasOptions) {
        if (hasImageOptions) {
          renderImageOptions(body, currentMeta, raw);
        } else {
          renderTextOptions(body, currentMeta, raw);
        }
      }

      // Навигация между вопросами (стрелки под вариантами / полем ответа)
      renderQuestionNavigation(body);

      return body;
    }

    function renderOpenQuestion(body, currentMeta) {
      const qId = currentMeta.id;
      const existing =
        typeof state.answers[qId] === "string" ? state.answers[qId] : "";

      const feedback = state.questionResults && state.questionResults[qId];

      // В review-режиме используем отдельный L2 open-review рендер
      if (state.mode === "review" && feedback) {
        renderOpenReviewL2(body, currentMeta, feedback, existing);
        return;
      }

      const textWrapper = document.createElement("div");
      textWrapper.className =
        "mt-5 space-y-3 rounded-2xl border border-border-strong bg-surface-1 px-4 py-4 shadow-sm dark:border-border-strong dark:bg-surface-1";

      const label = document.createElement("label");
      label.className =
        "flex items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary dark:text-text-secondary";
      label.textContent = "Ваш ответ:";

      textWrapper.appendChild(label);

      const textarea = document.createElement("textarea");
      textarea.className = CLASSMAP.l2.open.textareaAnswering;
      textarea.value = existing;
      textarea.placeholder = "Введите точный ответ";

      textarea.addEventListener("input", () => {
        const val = textarea.value || "";
        if (val.trim()) {
          state.answers[qId] = val;
          state.selections[qId] = true;
        } else {
          delete state.answers[qId];
          delete state.selections[qId];
        }

        if (typeof syncSidebarQuestion === "function") {
          syncSidebarQuestion(state.currentIndex);
        } else if (typeof rerenderSidebar === "function") {
          rerenderSidebar();
        }
        if (typeof state._notifyAnswerStateChanged === "function") {
          state._notifyAnswerStateChanged();
        }
      });

      textWrapper.appendChild(textarea);
      body.appendChild(textWrapper);
    }

    function renderOpenReviewL2(body, currentMeta, feedback, existingText) {
      const qId = currentMeta.id;
      const referenceAnswer = getOpenQuestionReferenceAnswer(currentMeta, feedback);

      const textWrapper = document.createElement("div");
      textWrapper.className =
        "mt-4 space-y-3 rounded-2xl border border-border-strong bg-surface-1 px-4 py-4 shadow-sm dark:border-border-strong dark:bg-surface-1";

      const labelRow = document.createElement("div");
      labelRow.className =
        "flex items-center justify-between gap-3";

      const label = document.createElement("span");
      label.className =
        "text-[12px] font-semibold uppercase tracking-[0.08em] text-text-secondary dark:text-text-secondary";
      label.textContent = "Ваш ответ:";

      const badge = document.createElement("div");
      badge.id = "l2-status-badge";

      // Определяем базовый статус и толерантность
      const status = getNormalizedFeedbackStatus(feedback) || "unknown"; // correct / incorrect / unanswered
      const tolType = feedback.tolerance_type || feedback.tolerance || null; // typo / ending / both / normalized
      const tolKinds = Array.isArray(feedback.normalization_kinds)
        ? feedback.normalization_kinds
        : Array.isArray(feedback.details && feedback.details.normalization_kinds)
          ? feedback.details.normalization_kinds
          : [];

      function describeNormalizationKinds(kinds) {
        const labelMap = { layout: 'раскладки', yo: 'е/ё', y_i: 'ы/і' };
        const labels = [];
        (Array.isArray(kinds) ? kinds : []).forEach((kind) => {
          const key = String(kind || '').trim().toLowerCase();
          const label = labelMap[key];
          if (label && !labels.includes(label)) labels.push(label);
        });
        if (!labels.length) return 'текста';
        if (labels.length === 1) return labels[0];
        if (labels.length === 2) return `${labels[0]} и ${labels[1]}`;
        return `${labels.slice(0, -1).join(', ')} и ${labels[labels.length - 1]}`;
      }

      let badgeClass =
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ";
      let badgeDotClass = "w-1.5 h-1.5 rounded-full ";
      let badgeText = "";

      if (status === "correct") {
        badgeClass +=
          "bg-success-light text-success-text border-success dark:bg-success-light dark:text-success-light dark:border-success";
        badgeDotClass += "bg-success";
        if (tolType === "typo") {
          badgeText = "Верно (опечатка)";
        } else if (tolType === "ending") {
          badgeText = "Верно (окончание)";
        } else if (tolType === "both") {
          badgeText = "Верно (опечатка + окончание)";
        } else if (tolType === "normalized") {
          badgeText = "Верно (нормализация)";
        } else {
          badgeText = "Верно";
        }
      } else if (status === "incorrect") {
        badgeClass +=
          "bg-error-light text-error-text border-error-light dark:bg-error-light dark:text-error-light dark:border-error";
        badgeDotClass += "bg-error";
        badgeText = "Неверно";
      } else {
        badgeClass +=
          "bg-surface-2 text-text-secondary border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:border-border-strong";
        badgeDotClass += "bg-bg-hover";
        badgeText = "Без ответа";
      }

      badge.className = badgeClass;
      const dot = document.createElement("span");
      dot.className = badgeDotClass;
      const badgeLabel = document.createElement("span");
      badgeLabel.textContent = badgeText;
      badge.appendChild(dot);
      badge.appendChild(badgeLabel);

      labelRow.appendChild(label);
      labelRow.appendChild(badge);
      textWrapper.appendChild(labelRow);

      const textarea = document.createElement("textarea");
      const textValue =
        existingText ||
        (typeof state.answers[qId] === "string" ? state.answers[qId] : "") ||
        "";
      textarea.value = textValue;
      textarea.readOnly = true;
      textarea.className =
        status === "incorrect"
          ? CLASSMAP.l2.open.textareaReviewIncorrect
          : CLASSMAP.l2.open.textareaReviewCorrect;

      textWrapper.appendChild(textarea);
      body.appendChild(textWrapper);

      let statusLineText = "";
      let statusLineClass = "";
      const hasTolerance = status === "correct" && hasToleranceAcceptance(feedback);

      if (status === "correct") {
        statusLineClass = "text-success-text dark:text-success";
        if (tolType === "typo") {
          statusLineText = "Ответ засчитан как верный с учетом опечатки.";
        } else if (tolType === "ending") {
          statusLineText = "Ответ засчитан как верный с учетом окончания слова.";
        } else if (tolType === "both") {
          statusLineText = "Ответ засчитан как верный с учетом опечатки и окончания слова.";
        } else if (tolType === "normalized") {
          statusLineText = `Ответ засчитан после нормализации ${describeNormalizationKinds(tolKinds)}.`;
        } else {
          statusLineText = "Ответ на этот вопрос засчитан как верный.";
        }
      } else if (status === "unanswered") {
        statusLineClass = "text-text-muted dark:text-text-muted";
        statusLineText = "Ответ на этот вопрос отсутствует.";
      }

      if (statusLineText) {
        const statusLineWrapper = document.createElement("div");
        statusLineWrapper.id = "l2-status-line";
        statusLineWrapper.className =
          hasTolerance
            ? "mt-3 flex items-start gap-3 rounded-2xl border border-warning-light bg-warning-lighter px-4 py-3 shadow-sm dark:border-warning-light dark:bg-warning-light"
            : "mt-3 flex items-start gap-3 rounded-2xl border border-border-subtle bg-surface-1 px-4 py-3 shadow-sm dark:border-border-strong dark:bg-surface-1";

        const statusIcon = document.createElement("span");
        statusIcon.className =
          hasTolerance
            ? "material-symbols-outlined mt-0.5 text-base text-warning-darker dark:text-warning-lighter"
            : "material-symbols-outlined mt-0.5 text-base text-success-text dark:text-success";
        statusIcon.textContent = hasTolerance ? "info" : "check_circle";

        const p = document.createElement("p");
        p.className = `flex-1 text-sm font-medium leading-relaxed ${statusLineClass}`.trim();
        p.textContent = statusLineText;

        statusLineWrapper.appendChild(statusIcon);
        statusLineWrapper.appendChild(p);
        body.appendChild(statusLineWrapper);
      }

      if (status === "incorrect" && referenceAnswer) {
        const referenceWrapper = document.createElement("div");
        referenceWrapper.dataset.testui = "l2-reference-answer";
        referenceWrapper.className =
          "mt-4 overflow-hidden rounded-2xl border border-border-strong bg-surface-1 shadow-sm dark:border-border-strong dark:bg-surface-1";

        const referenceHeader = document.createElement("div");
        referenceHeader.className =
          "flex items-center gap-2 border-b border-border-strong bg-success-light px-4 py-3 dark:border-border-strong dark:bg-success-light";

        const referenceIcon = document.createElement("span");
        referenceIcon.className =
          "material-symbols-outlined text-[18px] text-success-text dark:text-success-lighter";
        referenceIcon.textContent = "check_circle";

        const referenceLabel = document.createElement("div");
        referenceLabel.className =
          "text-[12px] font-semibold uppercase tracking-[0.08em] text-success-text dark:text-success-lighter";
        referenceLabel.textContent = "Эталонный ответ";

        const referenceText = document.createElement("div");
        referenceText.className =
          "px-4 py-4 text-sm leading-relaxed text-text-main dark:text-text-on-dark whitespace-pre-wrap";
        referenceText.textContent = referenceAnswer;

        referenceHeader.appendChild(referenceIcon);
        referenceHeader.appendChild(referenceLabel);
        referenceWrapper.appendChild(referenceHeader);
        referenceWrapper.appendChild(referenceText);
        body.appendChild(referenceWrapper);
      }

      if (
        status === "correct" &&
        referenceAnswer &&
        hasToleranceAcceptance(feedback)
      ) {
        const diffResult = buildReferenceAnswerDiff(referenceAnswer, textValue);
        appendReferenceAnswerCard(body, {
          dataTestUi: "l2-reference-answer",
          title: "Эталонный ответ",
          html: diffResult.html || escapeHtml(referenceAnswer),
          hintText: diffResult.hasHighlights
            ? "Подсвечены отличия между вашим ответом и эталоном."
            : "",
        });
      }
    }

    function getOpenQuestionReferenceAnswer(currentMeta, feedback) {
      function collectCorrectAnswerTexts(questionLike, fallbackIds = []) {
        if (!questionLike || typeof questionLike !== "object") return [];
        const sources = [
          questionLike.answers,
          questionLike.content && questionLike.content.answers,
        ];
        const normalizedFallbackIds = Array.isArray(fallbackIds)
          ? fallbackIds
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value))
          : [];
        const collected = [];

        sources.forEach((answers) => {
          if (!Array.isArray(answers)) return;
          answers.forEach((answer, index) => {
            if (!answer || typeof answer !== "object") return;
            const isCorrect =
              answer.correct === true ||
              normalizedFallbackIds.includes(index);
            if (!isCorrect) return;
            const text = String(answer.text || answer.label || "").trim();
            if (text && !collected.includes(text)) {
              collected.push(text);
            }
          });
        });

        return collected;
      }

      const detailReference =
        feedback &&
        feedback.reference_answer != null
          ? String(feedback.reference_answer).trim()
          : "";
      if (detailReference) {
        return detailReference;
      }

      const nestedReference =
        feedback &&
        feedback.details &&
        feedback.details.reference_answer != null
          ? String(feedback.details.reference_answer).trim()
          : "";
      if (nestedReference) {
        return nestedReference;
      }

      const raw =
        (state.rawQuestions &&
          state.rawQuestions[currentMeta.index ?? state.currentIndex]) ||
        null;
      const fallbackOptionIds =
        feedback && Array.isArray(feedback.correct_option_ids)
          ? feedback.correct_option_ids
          : feedback &&
              feedback.details &&
              Array.isArray(feedback.details.correct_option_ids)
            ? feedback.details.correct_option_ids
            : [];
      const fallbackSources = [
        raw && raw.reference_answer,
        raw && raw.content && raw.content.reference_answer,
        currentMeta && currentMeta.reference_answer,
        currentMeta && currentMeta.content && currentMeta.content.reference_answer,
      ];

      for (const candidate of fallbackSources) {
        if (candidate == null) continue;
        const normalized = String(candidate).trim();
        if (normalized) {
          return normalized;
        }
      }

      const fallbackAnswers = [
        ...collectCorrectAnswerTexts(raw, fallbackOptionIds),
        ...collectCorrectAnswerTexts(currentMeta, fallbackOptionIds),
      ].filter((value, index, self) => value && self.indexOf(value) === index);

      if (fallbackAnswers.length === 1) {
        return fallbackAnswers[0];
      }
      if (fallbackAnswers.length > 1) {
        return fallbackAnswers.join("; ");
      }

      return "";
    }

    function getChoiceReferenceOptions(currentMeta, feedback) {
      function collectOptionsByIds(questionLike, optionIds = [], mode = "correct") {
        if (!questionLike || typeof questionLike !== "object") return [];
        const sources = [
          questionLike.answers,
          questionLike.content && questionLike.content.answers,
        ];
        const normalizedOptionIds = Array.isArray(optionIds)
          ? optionIds
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value))
          : [];
        const seen = new Set();
        const collected = [];

        sources.forEach((answers) => {
          if (!Array.isArray(answers)) return;
          answers.forEach((answer, index) => {
            if (!answer || typeof answer !== "object") return;
            const isCorrect =
              mode === "selected"
                ? normalizedOptionIds.includes(index)
                : answer.correct === true || normalizedOptionIds.includes(index);
            if (!isCorrect) return;

            const imageSource = resolveImageUrlForWeb(answer);
            const rawText = String(
              answer.text || answer.label || answer.title || ""
            ).trim();
            const text =
              imageSource && /^вариант\s+\d+$/i.test(rawText) ? "" : rawText;
            const dedupeKey = `${rawText}::${imageSource || ""}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            collected.push({ text, rawText, imageSource });
          });
        });

        return collected;
      }

      const fallbackOptionIds =
        feedback && Array.isArray(feedback.correct_option_ids)
          ? feedback.correct_option_ids
          : feedback &&
              feedback.details &&
              Array.isArray(feedback.details.correct_option_ids)
            ? feedback.details.correct_option_ids
            : [];
      const raw =
        (state.rawQuestions &&
          state.rawQuestions[currentMeta.index ?? state.currentIndex]) ||
        null;
      return [
        ...collectOptionsByIds(raw, fallbackOptionIds, "correct"),
        ...collectOptionsByIds(currentMeta, fallbackOptionIds, "correct"),
      ].filter((option, index, self) => {
        const dedupeKey = `${option.rawText || option.text}::${option.imageSource || ""}`;
        return (
          option.imageSource ||
          option.text
        ) && self.findIndex((candidate) => `${candidate.rawText || candidate.text}::${candidate.imageSource || ""}` === dedupeKey) === index;
      });
    }

    function getChoiceUserOptions(currentMeta, feedback) {
      function collectOptionsByIds(questionLike, optionIds = []) {
        if (!questionLike || typeof questionLike !== "object") return [];
        const sources = [
          questionLike.answers,
          questionLike.content && questionLike.content.answers,
        ];
        const normalizedOptionIds = Array.isArray(optionIds)
          ? optionIds
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value))
          : [];
        const seen = new Set();
        const collected = [];

        sources.forEach((answers) => {
          if (!Array.isArray(answers)) return;
          answers.forEach((answer, index) => {
            if (!answer || typeof answer !== "object") return;
            if (!normalizedOptionIds.includes(index)) return;

            const imageSource = resolveImageUrlForWeb(answer);
            const rawText = String(
              answer.text || answer.label || answer.title || ""
            ).trim();
            const text =
              imageSource && /^вариант\s+\d+$/i.test(rawText) ? "" : rawText;
            const dedupeKey = `${rawText}::${imageSource || ""}`;
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            collected.push({ text, rawText, imageSource });
          });
        });

        return collected;
      }

      const selectedOptionIds =
        feedback && Array.isArray(feedback.user_option_ids)
          ? feedback.user_option_ids
          : feedback &&
              feedback.details &&
              Array.isArray(feedback.details.user_option_ids)
            ? feedback.details.user_option_ids
            : [];
      const raw =
        (state.rawQuestions &&
          state.rawQuestions[currentMeta.index ?? state.currentIndex]) ||
        null;
      return [
        ...collectOptionsByIds(raw, selectedOptionIds),
        ...collectOptionsByIds(currentMeta, selectedOptionIds),
      ].filter((option, index, self) => {
        const dedupeKey = `${option.rawText || option.text}::${option.imageSource || ""}`;
        return (
          option.imageSource ||
          option.text
        ) && self.findIndex((candidate) => `${candidate.rawText || candidate.text}::${candidate.imageSource || ""}` === dedupeKey) === index;
      });
    }

    function appendChoiceOptionCollectionCard(body, options = {}) {
      const tone = String(options.tone || "neutral");
      const items = Array.isArray(options.options) ? options.options : [];
      const title = String(options.title || "Варианты").trim();
      const dataTestUi = String(options.dataTestUi || "choice-option-collection");

      const toneConfig =
        tone === "error"
          ? {
              badge: createCompactStatusBadge("Ваш выбор", "error"),
              headerClass: "bg-error-light dark:bg-error-light",
              cardClass:
                "overflow-hidden rounded-2xl border border-error-light bg-surface-2 shadow-sm dark:border-error dark:bg-surface-2",
              mediaClass:
                "relative aspect-[4/3] overflow-hidden border-b border-error-light bg-surface-1 dark:border-error dark:bg-surface-1",
            }
          : tone === "success"
            ? {
                badge: createCompactStatusBadge("Эталон", "success"),
                headerClass: "bg-success-light dark:bg-success-light",
                cardClass:
                  "overflow-hidden rounded-2xl border border-success-light bg-surface-2 shadow-sm dark:border-success dark:bg-surface-2",
                mediaClass:
                  "relative aspect-[4/3] overflow-hidden border-b border-success-light bg-surface-1 dark:border-success dark:bg-surface-1",
              }
            : {
                badge: null,
                headerClass: "bg-surface-2 dark:bg-surface-2",
                cardClass:
                  "overflow-hidden rounded-2xl border border-border-strong bg-surface-2 shadow-sm dark:border-border-strong dark:bg-surface-2",
                mediaClass:
                  "relative aspect-[4/3] overflow-hidden border-b border-border-strong bg-surface-1 dark:border-border-strong dark:bg-surface-1",
              };

      const shell = appendSectionShell(body, {
        title,
        badge: toneConfig.badge,
        headerClass: toneConfig.headerClass,
        contentClass: "px-4 py-4",
      });
      shell.wrapper.dataset.testui = dataTestUi;

      if (!items.length) {
        const empty = document.createElement("p");
        empty.className =
          "text-sm leading-relaxed text-text-secondary dark:text-text-muted";
        empty.textContent = String(options.emptyText || "Нет данных для отображения.");
        shell.content.appendChild(empty);
        return shell;
      }

      const grid = document.createElement("div");
      grid.className = "grid gap-3 sm:grid-cols-2";

      items.forEach((option) => {
        const optionCard = document.createElement("div");
        optionCard.className = toneConfig.cardClass;
        optionCard.dataset.testui = `${dataTestUi}-option`;

        if (option.imageSource) {
          const media = document.createElement("div");
          media.className = toneConfig.mediaClass;

          const finalSrc = resolveImageUrlForWeb(option.imageSource);
          const img = document.createElement("img");
          img.src = finalSrc;
          img.alt = option.text || option.rawText || title;
          img.className = "h-full w-full object-contain";
          media.appendChild(img);

          const zoomBtn = createImageZoomButton(() => {
            openSharedImageLightbox(
              finalSrc,
              option.text || option.rawText || title
            );
          });
          media.appendChild(zoomBtn);

          optionCard.appendChild(media);
        }

        if (option.text || option.rawText) {
          const caption = document.createElement("div");
          caption.className =
            "px-4 py-3 text-sm font-medium leading-relaxed text-text-main dark:text-text-on-dark";
          caption.textContent = option.text || option.rawText;
          optionCard.appendChild(caption);
        }

        grid.appendChild(optionCard);
      });

      shell.content.appendChild(grid);
      return shell;
    }

    function openImageLightbox(imgSrc, caption) {
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
      title.textContent = String(caption || "").trim();

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
        "Подогнать",
        "",
        "Fit to screen"
      );

      const closeBtn = makeToolbarButton("Закрыть", "", "Close image viewer");
      closeBtn.className =
        "inline-flex items-center justify-center rounded-lg border border-border-subtle bg-surface-1 px-3 py-1.5 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-bg-hover";

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
      img.alt = caption || "Вариант ответа";
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

      function syncImageMetrics() {
        naturalWidth = img.naturalWidth || 0;
        naturalHeight = img.naturalHeight || 0;
        if (!naturalWidth || !naturalHeight) return;
        fitToViewport();
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

    function openSharedImageLightbox(imgSrc, caption) {
      if (!imgSrc) return;

      const sharedLightbox =
        typeof window !== "undefined" &&
        window.OpenAnswerUIImageLightbox &&
        typeof window.OpenAnswerUIImageLightbox.open === "function"
          ? window.OpenAnswerUIImageLightbox
          : null;

      if (sharedLightbox) {
        sharedLightbox.open(imgSrc, caption);
        return;
      }

      openImageLightbox(imgSrc, caption);
    }

    function createImageZoomButton(onClick) {
      const zoomBtn = document.createElement("button");
      zoomBtn.type = "button";
      zoomBtn.className =
        "absolute bottom-3 right-3 z-10 inline-flex h-11 w-11 items-center justify-center rounded-xl p-2 text-text-on-dark shadow-sm transition-transform hover:scale-[1.03]";
      zoomBtn.style.background = "rgba(15, 23, 42, 0.48)";
      zoomBtn.style.border = "1px solid rgba(255, 255, 255, 0.28)";
      zoomBtn.style.outline = "1px solid rgba(255, 255, 255, 0.1)";
      zoomBtn.style.outlineOffset = "0";
      zoomBtn.style.backdropFilter = "blur(6px)";
      zoomBtn.style.WebkitBackdropFilter = "blur(6px)";
      zoomBtn.style.boxShadow = "0 8px 18px rgba(15, 23, 42, 0.2)";
      zoomBtn.setAttribute("aria-label", "Open image viewer");
      zoomBtn.title = "Open image viewer";

      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.style.display = "inline-flex";
      icon.style.width = "22px";
      icon.style.height = "22px";
      icon.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M11 5a6 6 0 1 0 0 12a6 6 0 0 0 0-12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 20l-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M11 8.5v5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M8.5 11h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      zoomBtn.appendChild(icon);

      zoomBtn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (typeof onClick === "function") {
          onClick();
        }
      });

      return zoomBtn;
    }

    function collectQuestionImageRefs(raw) {
      const images = [];
      const seen = new Set();

      const push = (candidate) => {
        if (images.length >= 3) return;
        const src = resolveImageUrlForWeb(candidate);
        if (!src || seen.has(src)) return;
        seen.add(src);
        images.push(src);
      };

      if (raw && Array.isArray(raw.images)) {
        raw.images.forEach(push);
      }

      if (raw && images.length === 0) {
        push(raw);
      }

      return images;
    }

    function resolveImageUrlForWeb(imgSrc) {
      if (!imgSrc) return null;
      if (typeof imgSrc === "object") {
        const nestedImage =
          imgSrc.image && typeof imgSrc.image === "object" ? imgSrc.image : null;
        const directUrl =
          imgSrc.asset_url ||
          imgSrc.image_asset_url ||
          imgSrc.image_url ||
          imgSrc.url ||
          imgSrc.src ||
          null;
        if (directUrl) return resolveImageUrlForWeb(directUrl);
        const directAssetId =
          imgSrc.asset_id ||
          imgSrc.image_asset_id ||
          (nestedImage && (nestedImage.asset_id || nestedImage.image_asset_id)) ||
          null;
        if (directAssetId) {
          return `/api/assets/${encodeURIComponent(String(directAssetId))}/content`;
        }
        const legacyPath =
          imgSrc.image_path ||
          imgSrc.path ||
          (nestedImage && (nestedImage.image_path || nestedImage.path)) ||
          null;
        if (legacyPath) return resolveImageUrlForWeb(legacyPath);
        if (nestedImage) return resolveImageUrlForWeb(nestedImage);
        return null;
      }
      if (typeof imgSrc !== "string") return null;
      imgSrc = String(imgSrc || "").trim();
      if (!imgSrc) return null;

      // Уже HTTP/HTTPS или абсолютный web-путь — не трогаем
      if (/^https?:\/\//i.test(imgSrc)) return imgSrc;
      if (imgSrc.startsWith("/")) return imgSrc;

      // Всё остальное считаем локальным путём (относительным или абсолютным)
      // и пробрасываем через backend-эндпоинт, который отдаёт файл из data_dir.
      return "/api/local-image?path=" + encodeURIComponent(imgSrc);
    }

    function renderTextOptions(body, currentMeta, raw) {
      const correctCount = raw.answers.filter((a) => a && a.correct).length;
      const isMultiple = correctCount > 1;

      const currentAnswer = state.answers[currentMeta.id];
      const questionFeedback =
        state.questionResults && state.questionResults[currentMeta.id];
      const reviewShell =
        state.mode === "review" && questionFeedback
          ? appendSectionShell(body, {
              ...getChoiceReviewMeta(questionFeedback, isMultiple),
              contentClass: "px-4 py-4",
            })
          : null;

      const optionsWrapper = document.createElement("div");
      optionsWrapper.className = reviewShell ? "space-y-3" : "mt-5 space-y-3";
      const optionRows = [];

      function syncTextOptionSelectionState() {
        const liveAnswer = state.answers[currentMeta.id];
        optionRows.forEach(({ idx, input, optionRow }) => {
          const isSelected = isMultiple
            ? Array.isArray(liveAnswer) && liveAnswer.includes(idx)
            : typeof liveAnswer === "number" && liveAnswer === idx;
          input.checked = isSelected;
          optionRow.className = isSelected
            ? CLASSMAP.l1.textOption.selected
            : CLASSMAP.l1.textOption.neutral;
        });
      }

      raw.answers.forEach((ans, idx) => {
        const optionRow = document.createElement("label");

        const isSelected = isMultiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(idx)
          : typeof currentAnswer === "number" && currentAnswer === idx;

        let optionClass = CLASSMAP.l1.textOption.neutral;
        let reviewTagText = "";
        let reviewTagTone = "neutral";

        if (state.mode === "answering" && isSelected) {
          optionClass = CLASSMAP.l1.textOption.selected;
        }

        if (state.mode === "review" && questionFeedback) {
          const correctIds = toOptionIndexSet(questionFeedback.correct_option_ids);
          const userIds = toOptionIndexSet(questionFeedback.user_option_ids);
          const isCorrect = correctIds.has(idx);
          const isChosen = userIds.has(idx);

          if (isCorrect && isChosen) {
            optionClass = CLASSMAP.l1.textOption.reviewCorrectChosen;
            reviewTagText = "Выбрано верно";
            reviewTagTone = "success";
          } else if (isCorrect && !isChosen) {
            optionClass = CLASSMAP.l1.textOption.reviewCorrectMissed;
            reviewTagText = "Правильный";
            reviewTagTone = "success";
          } else if (!isCorrect && isChosen) {
            optionClass = CLASSMAP.l1.textOption.reviewWrongChosen;
            reviewTagText = "Ваш выбор";
            reviewTagTone = "error";
          }
        }

        optionRow.className = optionClass + " tui-option-enter";
        optionRow.style.animationDelay = `${idx * 0.04}s`;

        const input = document.createElement("input");
        input.type = isMultiple ? "checkbox" : "radio";
        input.name = `q_${currentMeta.id}`;
        // Прячем нативный radio/checkbox, оставляя только визуальное выделение строки.
        input.className = "hidden";

        if (isMultiple) {
          if (Array.isArray(currentAnswer) && currentAnswer.includes(idx)) {
            input.checked = true;
          }
        } else if (typeof currentAnswer === "number" && currentAnswer === idx) {
          input.checked = true;
        }

        const applySelection = (checked) => {
          let updated = state.answers[currentMeta.id];
          if (isMultiple) {
            if (!Array.isArray(updated)) {
              updated = [];
            }
            if (checked) {
              if (!updated.includes(idx)) updated.push(idx);
            } else {
              updated = updated.filter((v) => v !== idx);
            }
            if (updated.length === 0) {
              delete state.answers[currentMeta.id];
            } else {
              state.answers[currentMeta.id] = updated;
            }
          } else {
            if (checked) {
              state.answers[currentMeta.id] = idx;
            } else {
              delete state.answers[currentMeta.id];
            }
          }

          const hasAnswer =
            (isMultiple &&
              Array.isArray(state.answers[currentMeta.id]) &&
              state.answers[currentMeta.id].length > 0) ||
            (!isMultiple && typeof state.answers[currentMeta.id] === "number");

          if (hasAnswer) {
            state.selections[currentMeta.id] = true;
          } else {
            delete state.selections[currentMeta.id];
          }

          syncTextOptionSelectionState();
          if (typeof syncSidebarQuestion === "function") {
            syncSidebarQuestion(state.currentIndex);
          } else if (typeof rerenderSidebar === "function") {
            rerenderSidebar();
          }
          if (typeof state._notifyAnswerStateChanged === "function") {
            state._notifyAnswerStateChanged();
          }
        };

        input.addEventListener("change", () => {
          if (state.mode !== "answering") return;
          applySelection(!!input.checked);
        });

        // Single-choice: second click on selected option clears it.
        optionRow.addEventListener("click", (ev) => {
          if (state.mode !== "answering") return;
          ev.preventDefault();
          const isCurrentlySelected =
            !isMultiple &&
            typeof state.answers[currentMeta.id] === "number" &&
            state.answers[currentMeta.id] === idx;
          if (isMultiple) {
            applySelection(!(Array.isArray(state.answers[currentMeta.id]) && state.answers[currentMeta.id].includes(idx)));
          } else {
            applySelection(!isCurrentlySelected);
          }
        });


        const textWrapper = document.createElement("div");
        textWrapper.className = "flex min-w-0 flex-1 items-start justify-between gap-3";
        const txt = document.createElement("span");
        txt.className = "min-w-0 flex-1 text-[14px] leading-relaxed md:text-[15px]";
        txt.textContent = ans.text || "Option";
        textWrapper.appendChild(txt);

        if (reviewTagText) {
          textWrapper.appendChild(createCompactStatusBadge(reviewTagText, reviewTagTone));
        }

        optionRow.appendChild(input);
        optionRow.appendChild(textWrapper);
        optionsWrapper.appendChild(optionRow);
        optionRows.push({ idx, input, optionRow });
      });

      if (reviewShell) {
        reviewShell.content.appendChild(optionsWrapper);
      } else {
        body.appendChild(optionsWrapper);
      }
    }

    function renderImageOptions(body, currentMeta, raw) {
      // Используем компактную адаптивную сетку для вариантов с изображениями.
      const correctCount = raw.answers.filter((a) => a && a.correct).length;
      const isMultiple = correctCount > 1;
      const currentAnswer = state.answers[currentMeta.id];
      const questionFeedback =
        state.questionResults && state.questionResults[currentMeta.id];
      const reviewShell =
        state.mode === "review" && questionFeedback
          ? appendSectionShell(body, {
              ...getChoiceReviewMeta(questionFeedback, isMultiple),
              contentClass: "px-4 py-4",
            })
          : null;

      const grid = document.createElement("div");
      grid.className =
        (reviewShell ? "" : "mt-3 ") +
        "grid grid-cols-2 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4";
      const optionCards = [];

      function syncImageOptionSelectionState() {
        const liveAnswer = state.answers[currentMeta.id];
        optionCards.forEach(({ idx, input, card, captionEl }) => {
          const isSelected = isMultiple
            ? Array.isArray(liveAnswer) && liveAnswer.includes(idx)
            : typeof liveAnswer === "number" && liveAnswer === idx;
          input.checked = isSelected;
          card.className = isSelected
            ? "flex flex-col gap-3 rounded-2xl border-2 border-primary-dark bg-primary p-3 ring-2 ring-primary-light shadow-sm transition-colors transition-transform active:scale-[.99] cursor-pointer group"
            : "flex flex-col gap-3 rounded-2xl border-2 border-border-strong bg-surface-1 p-3 shadow-sm transition-colors transition-transform active:scale-[.99] cursor-pointer group hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-1 dark:hover:bg-bg-hover";
          captionEl.className = isSelected
            ? "text-sm text-primary-fg text-center font-bold leading-relaxed"
            : "text-sm text-text-secondary dark:text-text-muted text-center font-medium leading-relaxed";
        });
      }

      raw.answers.forEach((ans, idx) => {
        const imgSrc = resolveImageUrlForWeb(ans);
        const caption = ans && ans.text ? ans.text : "";

        // Оборачиваем карточку в отдельный контейнер, чтобы лупа могла жить
        // вне label и не триггерить выбор ответа.
        const wrapper = document.createElement("div");
        wrapper.className = "relative group";

        const card = document.createElement("label");
        let cardClass =
          "flex flex-col gap-3 rounded-2xl border-2 border-border-strong bg-surface-1 p-3 shadow-sm transition-colors transition-transform active:scale-[.99] cursor-pointer group hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-1 dark:hover:bg-bg-hover";
        let reviewTagText = "";
        let reviewTagTone = "neutral";

        const isSelected = isMultiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(idx)
          : typeof currentAnswer === "number" && currentAnswer === idx;

        if (state.mode === "answering" && isSelected) {
          cardClass =
            "flex flex-col gap-3 rounded-2xl border-2 border-primary-dark bg-primary p-3 ring-2 ring-primary-light shadow-sm transition-colors transition-transform active:scale-[.99] cursor-pointer group";
        }

        if (state.mode === "review" && questionFeedback) {
          const correctIds = toOptionIndexSet(questionFeedback.correct_option_ids);
          const userIds = toOptionIndexSet(questionFeedback.user_option_ids);
          const isCorrect = correctIds.has(idx);
          const isChosen = userIds.has(idx);

          if (isCorrect && isChosen) {
            cardClass =
              "flex flex-col gap-3 rounded-2xl border-2 border-success bg-success-light p-3 shadow-sm text-success-text dark:border-success dark:bg-success-light dark:text-success-lighter transition-colors cursor-pointer group";
            reviewTagText = "Выбрано верно";
            reviewTagTone = "success";
          } else if (isCorrect && !isChosen) {
            cardClass =
              "flex flex-col gap-3 rounded-2xl border-2 border-dashed border-success bg-surface-1 p-3 shadow-sm text-success-text dark:border-success dark:bg-surface-1 dark:text-success-lighter transition-colors cursor-pointer group";
            reviewTagText = "Правильный";
            reviewTagTone = "success";
          } else if (!isCorrect && isChosen) {
            cardClass =
              "flex flex-col gap-3 rounded-2xl border-2 border-error bg-error-light p-3 shadow-sm text-error-dark dark:border-error dark:bg-error-light dark:text-error-lighter transition-colors cursor-pointer group";
            reviewTagText = "Ваш выбор";
            reviewTagTone = "error";
          }
        }

        card.className = cardClass + " tui-option-enter";
        card.style.animationDelay = `${idx * 0.04}s`;

        const imgBox = document.createElement("div");
        imgBox.className =
          "relative w-full aspect-[4/3] overflow-hidden rounded-xl border border-border-strong bg-surface-2 dark:border-border-strong dark:bg-surface-2";
        if (imgSrc) {
          const finalSrc = resolveImageUrlForWeb(imgSrc);
          const img = document.createElement("img");
          img.src = finalSrc;
          img.alt = caption || "Вариант ответа";
          img.className = "w-full h-full object-contain";
          // ВАЖНО: не вешаем обработчик click на img, чтобы он не запускал зум,
          // выбор варианта обрабатывается через label/input.
          imgBox.appendChild(img);

        }

        if (reviewTagText) {
          const reviewTag = createCompactStatusBadge(reviewTagText, reviewTagTone);
          reviewTag.className += " absolute left-2 top-2 shadow-sm";
          imgBox.appendChild(reviewTag);
        }

        const captionEl = document.createElement("p");
        // Стиль подписи как в макете IMG-A1: выбранный вариант — синий и жирный,
        // остальные — серые и обычные.
        if (state.mode === "answering" && isSelected) {
          captionEl.className =
            "text-sm text-primary-fg text-center font-bold leading-relaxed";
        } else {
          captionEl.className =
            "text-sm text-text-secondary dark:text-text-muted text-center font-medium leading-relaxed";
        }
        captionEl.textContent = caption || "";

        const input = document.createElement("input");
        input.type = isMultiple ? "checkbox" : "radio";
        input.name = `q_${currentMeta.id}`;
        input.className = "hidden";
        if (isSelected) input.checked = true;

        const applySelection = (checked) => {
          let updated = state.answers[currentMeta.id];
          if (isMultiple) {
            if (!Array.isArray(updated)) updated = [];
            if (checked) {
              if (!updated.includes(idx)) updated.push(idx);
            } else {
              updated = updated.filter((v) => v !== idx);
            }
            if (updated.length === 0) {
              delete state.answers[currentMeta.id];
            } else {
              state.answers[currentMeta.id] = updated;
            }
          } else {
            if (checked) {
              state.answers[currentMeta.id] = idx;
            } else {
              delete state.answers[currentMeta.id];
            }
          }

          const hasAnswer =
            (isMultiple &&
              Array.isArray(state.answers[currentMeta.id]) &&
              state.answers[currentMeta.id].length > 0) ||
            (!isMultiple && typeof state.answers[currentMeta.id] === "number");

          if (hasAnswer) {
            state.selections[currentMeta.id] = true;
          } else {
            delete state.selections[currentMeta.id];
          }

          syncImageOptionSelectionState();
          if (typeof syncSidebarQuestion === "function") {
            syncSidebarQuestion(state.currentIndex);
          } else if (typeof rerenderSidebar === "function") {
            rerenderSidebar();
          }
          if (typeof state._notifyAnswerStateChanged === "function") {
            state._notifyAnswerStateChanged();
          }
        };

        input.addEventListener("change", () => {
          if (state.mode !== "answering") return;
          applySelection(!!input.checked);
        });

        // Явно используем label+input: клик по карточке выбирает вариант.
        // Обработчик на card НЕ вызывает зум и не мешает лупе (которая стопорит всплытие).
        card.addEventListener("click", (ev) => {
          if (ev.defaultPrevented) return;
          if (state.mode !== "answering") return;
          if (ev.target === input) return;
          ev.preventDefault();
          const isCurrentlySelected =
            !isMultiple &&
            typeof state.answers[currentMeta.id] === "number" &&
            state.answers[currentMeta.id] === idx;
          if (isMultiple) {
            applySelection(!(Array.isArray(state.answers[currentMeta.id]) && state.answers[currentMeta.id].includes(idx)));
          } else {
            applySelection(!isCurrentlySelected);
          }
        });

        card.appendChild(imgBox);
        card.appendChild(captionEl);
        card.appendChild(input);
        optionCards.push({ idx, input, card, captionEl });

        wrapper.appendChild(card);

        // Кнопка-лупа живёт внутри image-box, чтобы оставаться на самой картинке,
        // но останавливает всплытие и не выбирает ответ.
        if (imgSrc) {
          const finalSrc = resolveImageUrlForWeb(imgSrc);
          const zoomBtn = createImageZoomButton(() => {
            openSharedImageLightbox(finalSrc, caption);
          });
          imgBox.appendChild(zoomBtn);
        }

        grid.appendChild(wrapper);
      });

      if (reviewShell) {
        reviewShell.content.appendChild(grid);
      } else {
        body.appendChild(grid);
      }

    }

    function renderQuestionNavigation(body) {
      if (!state.questions || state.questions.length <= 1) {
        return;
      }

      const total = state.questions.length;
      const currentIndex = state.currentIndex || 0;

      const nav = document.createElement("div");
      nav.className =
        "mt-6 flex w-full items-center justify-between border-t border-border-strong pt-3 dark:border-border-strong";

      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className =
        "flex items-center justify-center rounded-full size-10 border-2 border-border-strong bg-surface-1 text-text-main shadow-sm transition-all hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover disabled:cursor-default disabled:border-border-strong disabled:bg-bg-disabled disabled:text-text-main";
      prevBtn.disabled = currentIndex <= 0;

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className =
        "flex items-center justify-center rounded-full size-10 border-2 border-border-strong bg-surface-1 text-text-main shadow-sm transition-all hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-1 dark:text-text-on-dark dark:hover:bg-bg-hover disabled:cursor-default disabled:border-border-strong disabled:bg-bg-disabled disabled:text-text-main";
      nextBtn.disabled = currentIndex >= total - 1;

      const prevIcon = document.createElement("span");
      prevIcon.className = "material-symbols-outlined text-xl";
      prevIcon.textContent = "chevron_left";
      prevBtn.appendChild(prevIcon);

      const nextIcon = document.createElement("span");
      nextIcon.className = "material-symbols-outlined text-xl";
      nextIcon.textContent = "chevron_right";
      nextBtn.appendChild(nextIcon);

      prevBtn.addEventListener("click", () => {
        if (state.currentIndex > 0) {
          state.currentIndex -= 1;
          state.visitedIndices = state.visitedIndices || {};
          state.visitedIndices[state.currentIndex] = true;

          if (typeof rerenderSidebar === "function") {
            rerenderSidebar();
          }
          if (typeof rerenderQuestion === "function") {
            rerenderQuestion();
          } else {
            renderQuestionView();
          }
        }
      });

      nextBtn.addEventListener("click", () => {
        if (state.currentIndex < total - 1) {
          state.currentIndex += 1;
          state.visitedIndices = state.visitedIndices || {};
          state.visitedIndices[state.currentIndex] = true;

          if (typeof rerenderSidebar === "function") {
            rerenderSidebar();
          }
          if (typeof rerenderQuestion === "function") {
            rerenderQuestion();
          } else {
            renderQuestionView();
          }
        }
      });

      nav.appendChild(prevBtn);
      nav.appendChild(nextBtn);
      body.appendChild(nav);
    }

    return { renderQuestionView };
  }

  global.TestUIQuestion = { createQuestionRenderer };
})(typeof window !== "undefined" ? window : globalThis);
