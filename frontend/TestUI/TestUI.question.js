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
          "flex cursor-pointer items-start gap-3 rounded-lg border-2 border-border-strong bg-surface-2 px-4 py-3 text-sm text-text-main dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark shadow-sm transition-colors transition-transform hover:bg-bg-hover dark:hover:bg-bg-hover active:scale-[.99]",
        selected:
          "flex cursor-pointer items-start gap-3 rounded-lg border-2 border-primary-dark bg-primary px-4 py-3 text-sm text-primary-fg ring-2 ring-primary-light shadow-sm transition-colors transition-transform active:scale-[.99]",
        reviewCorrectChosen:
          "flex cursor-pointer items-start gap-3 rounded-lg border-2 border-success bg-success-light px-4 py-3 text-sm text-success-text shadow-sm transition-colors dark:border-success dark:bg-success-light dark:text-success-lighter",
        reviewCorrectMissed:
          "flex cursor-pointer items-start gap-3 rounded-lg border-2 border-success bg-success-light px-4 py-3 text-sm text-success-text shadow-sm transition-colors dark:border-success dark:bg-success-light dark:text-success-lighter",
        reviewWrongChosen:
          "flex cursor-pointer items-start gap-3 rounded-lg border-2 border-error bg-error-light px-4 py-3 text-sm text-error-dark shadow-sm transition-colors dark:border-error dark:bg-error-light dark:text-error-lighter",
      },
    },
    l2: {
      open: {
        textareaAnswering:
          "w-full rounded-lg border-2 border-border-strong dark:border-border-strong bg-surface-1 dark:bg-bg-hover p-4 text-text-main dark:text-text-on-dark placeholder:text-text-secondary dark:placeholder:text-text-secondary focus:ring-2 focus:ring-primary focus:border-primary transition-colors min-h-[120px]",
        textareaReviewCorrect:
          "w-full rounded-lg border-2 border-success bg-success-light dark:bg-success-light p-4 text-text-main dark:text-text-on-dark min-h-[120px] cursor-not-allowed",
        textareaReviewIncorrect:
          "w-full rounded-lg border-2 border-error bg-error-light dark:bg-error-light p-4 text-text-main dark:text-text-on-dark min-h-[120px] cursor-not-allowed",
      },
    },
  };

  function createQuestionRenderer(state, main) {
    const rerenderSidebar =
      typeof state._rerenderSidebar === "function"
        ? state._rerenderSidebar
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
        "space-y-4 rounded-xl border-2 border-border-strong bg-surface-2 px-4 py-4 text-sm text-text-muted shadow-md dark:border-border-strong dark:bg-surface-2 dark:text-text-muted tui-question-enter";

      if (!currentMeta || !state.questions.length) {
        const empty = document.createElement("p");
        empty.textContent = "No questions data in task";
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
        "text-base font-semibold leading-snug text-text-main dark:text-text-on-dark mb-1";
      qText.textContent = currentMeta.text || "Test question";
      body.appendChild(qText);

      // Optional question image (L1.C / L2)
      if (raw) {
        let questionImagePath = null;

        if (raw.image_url) {
          questionImagePath = raw.image_url;
        } else if (raw.image_path) {
          questionImagePath = resolveImageUrlForWeb(raw.image_path);
        } else if (Array.isArray(raw.images) && raw.images.length > 0) {
          const img0 = raw.images[0];
          if (img0 && typeof img0 === "object") {
            if (img0.url) {
              questionImagePath = img0.url;
            } else if (img0.path) {
              questionImagePath = resolveImageUrlForWeb(img0.path);
            }
          } else if (typeof img0 === "string") {
            questionImagePath = resolveImageUrlForWeb(img0);
          }
        } else if (raw.image && typeof raw.image === "object") {
          if (raw.image.url) {
            questionImagePath = raw.image.url;
          } else if (raw.image.path) {
            questionImagePath = resolveImageUrlForWeb(raw.image.path);
          }
        } else if (typeof raw.image === "string") {
          questionImagePath = resolveImageUrlForWeb(raw.image);
        }

        if (questionImagePath) {
          const imgWrapper = document.createElement("div");
          imgWrapper.className = "mt-3 mb-3 flex justify-center";

          const img = document.createElement("img");
          img.src = questionImagePath;
          img.alt = "Question image";
          img.className =
            "max-h-[260px] w-auto object-contain rounded-lg border border-border-strong dark:border-border-strong shadow-sm cursor-pointer";

          img.addEventListener("click", (ev) => {
            ev.preventDefault();
            openImageLightbox(questionImagePath, currentMeta.text || "Question image");
          });

          imgWrapper.appendChild(img);
          body.appendChild(imgWrapper);
        }
      }

      // Open-mode (L2) vs options (L1)
      const hasOptions = raw && Array.isArray(raw.answers) && raw.answers.length > 0;
      let hasImageOptions = false;
      let allImageOptions = false;
      if (hasOptions) {
        hasImageOptions = raw.answers.some(
          (a) => a && (a.image_path || a.image_url || (a.image && a.image.url))
        );
        allImageOptions = hasImageOptions && raw.answers.every(
          (a) => a && (a.image_path || a.image_url || (a.image && a.image.url))
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
      textWrapper.className = "mt-3 space-y-2";

      const label = document.createElement("label");
      label.className =
        "text-[13px] font-medium text-text-main dark:text-text-on-dark flex items-center justify-between gap-2";
      label.textContent = "Ваш ответ:";

      textWrapper.appendChild(label);

      const textarea = document.createElement("textarea");
      textarea.className = CLASSMAP.l2.open.textareaAnswering;
      textarea.value = existing;

      textarea.addEventListener("input", () => {
        const val = textarea.value || "";
        if (val.trim()) {
          state.answers[qId] = val;
          state.selections[qId] = true;
        } else {
          delete state.answers[qId];
          delete state.selections[qId];
        }

        if (typeof rerenderSidebar === "function") {
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

      const textWrapper = document.createElement("div");
      textWrapper.className = "mt-3 space-y-2";

      const labelRow = document.createElement("div");
      labelRow.className =
        "flex items-center justify-between gap-2 text-[13px] font-medium";

      const label = document.createElement("span");
      label.className = "text-text-main dark:text-text-on-dark";
      label.textContent = "Ваш ответ:";

      const badge = document.createElement("div");
      badge.id = "l2-status-badge";

      // Определяем базовый статус и толерантность
      const status = feedback.status || "unknown"; // correct / incorrect / unanswered
      const tolType = feedback.tolerance_type || feedback.tolerance || null; // typo / ending / both

      let badgeClass =
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ";
      let badgeDotClass = "w-1.5 h-1.5 rounded-full ";
      let badgeText = "";

      if (status === "correct") {
        badgeClass +=
          "bg-success-light text-success-text border-success dark:bg-success-light dark:text-success-light dark:border-success";
        badgeDotClass += "bg-success";
        if (tolType === "typo") {
          badgeText = "Correct (typo)";
        } else if (tolType === "ending") {
          badgeText = "Correct (ending)";
        } else if (tolType === "both") {
          badgeText = "Correct (typo + ending)";
        } else {
          badgeText = "Correct";
        }
      } else if (status === "incorrect") {
        badgeClass +=
          "bg-error-light text-error-text border-error-light dark:bg-error-light dark:text-error-light dark:border-error";
        badgeDotClass += "bg-error";
        badgeText = "Incorrect";
      } else {
        badgeClass +=
          "bg-surface-2 text-text-secondary border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:border-border-strong";
        badgeDotClass += "bg-bg-hover";
        badgeText = "Unanswered";
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

      // Строка статуса под textarea
      const statusLineWrapper = document.createElement("div");
      statusLineWrapper.id = "l2-status-line";
      statusLineWrapper.className = "mt-2 min-h-[20px]";

      const p = document.createElement("p");
      p.className = "text-sm font-medium ";

      if (status === "correct") {
        p.className += "text-success-text dark:text-success";
        if (tolType === "typo") {
          p.textContent = "Ответ засчитан как верный с учетом опечатки.";
        } else if (tolType === "ending") {
          p.textContent =
            "Ответ засчитан как верный с учетом окончания слова.";
        } else if (tolType === "both") {
          p.textContent =
            "Ответ засчитан как верный с учетом опечатки и окончания слова.";
        } else {
          p.textContent = "Ответ на этот вопрос засчитан как верный.";
        }
      } else if (status === "incorrect") {
        // Неправильный, но данный ответ
        p.className += "text-error-text dark:text-error";
        p.textContent = "Ответ на этот вопрос не засчитан как верный.";
      } else if (status === "unanswered") {
        // Нет ответа
        p.className += "text-text-muted dark:text-text-muted";
        p.textContent = "Ответ на этот вопрос отсутствует.";
      }

      statusLineWrapper.appendChild(p);
      body.appendChild(statusLineWrapper);
    }

    function openImageLightbox(imgSrc, caption) {
      if (!imgSrc) return;

      const overlay = document.createElement("div");
      overlay.className =
        "fixed inset-0 z-[60] bg-scrim-strong flex items-center justify-center px-4";

      const container = document.createElement("div");
      container.className =
        "relative max-w-5xl max-h-[90vh] w-full flex items-center justify-center";

      const img = document.createElement("img");
      img.src = imgSrc;
      img.alt = caption || "Answer option";
      img.className =
        "max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl cursor-grab";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className =
        "absolute -top-3 -right-3 h-8 w-8 rounded-full bg-scrim-heavy text-text-on-dark flex items-center justify-center text-lg hover:bg-scrim-intense";
      closeBtn.innerText = "?";

      const handleClose = () => {
        overlay.remove();
      };

      closeBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        handleClose();
      });

      overlay.addEventListener("click", handleClose);
      container.addEventListener("click", (ev) => ev.stopPropagation());

      // ------------------------------
      // Zoom & pan logic
      // ------------------------------
      let scale = 1;
      let translateX = 0;
      let translateY = 0;

      // Масштабируем и двигаем относительно левого верхнего угла
      img.style.transformOrigin = "0 0";

      function applyTransform() {
        img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
      }

      // Масштабирование колесом мыши "в курсор"
      img.addEventListener("wheel", (ev) => {
        ev.preventDefault();

        const rect = img.getBoundingClientRect();
        const offsetX = ev.clientX - rect.left;
        const offsetY = ev.clientY - rect.top;

        const zoomFactor = ev.deltaY < 0 ? 1.1 : 0.9;
        const newScale = Math.min(8, Math.max(0.25, scale * zoomFactor));
        if (newScale === scale) return;

        const oldScale = scale;

        // Коррекция смещения так, чтобы точка под курсором оставалась на месте
        translateX += offsetX * (1 / newScale - 1 / oldScale);
        translateY += offsetY * (1 / newScale - 1 / oldScale);

        scale = newScale;
        applyTransform();
      });

      // Панорамирование зажатой ЛКМ
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let startTranslateX = 0;
      let startTranslateY = 0;

      img.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        isDragging = true;
        img.style.cursor = "grabbing";
        dragStartX = ev.clientX;
        dragStartY = ev.clientY;
        startTranslateX = translateX;
        startTranslateY = translateY;
      });

      window.addEventListener("mousemove", onDragMove);
      window.addEventListener("mouseup", onDragEnd);

      function onDragMove(ev) {
        if (!isDragging) return;
        translateX = startTranslateX + (ev.clientX - dragStartX);
        translateY = startTranslateY + (ev.clientY - dragStartY);
        applyTransform();
      }

      function onDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        img.style.cursor = "grab";
      }

      // Двойной клик по изображению — сброс зума и позиции
      img.addEventListener("dblclick", (ev) => {
        ev.preventDefault();
        scale = 1;
        translateX = 0;
        translateY = 0;
        applyTransform();
      });

      // Начальное состояние трансформации
      applyTransform();

      container.appendChild(img);
      container.appendChild(closeBtn);
      overlay.appendChild(container);
      document.body.appendChild(overlay);
    }

    function resolveImageUrlForWeb(imgSrc) {
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

      const optionsWrapper = document.createElement("div");
      optionsWrapper.className = "mt-3 space-y-2";

      raw.answers.forEach((ans, idx) => {
        const optionRow = document.createElement("label");

        const isSelected = isMultiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(idx)
          : typeof currentAnswer === "number" && currentAnswer === idx;

        let optionClass = CLASSMAP.l1.textOption.neutral;

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
          } else if (isCorrect && !isChosen) {
            optionClass = CLASSMAP.l1.textOption.reviewCorrectMissed;
          } else if (!isCorrect && isChosen) {
            optionClass = CLASSMAP.l1.textOption.reviewWrongChosen;
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

          if (typeof rerenderQuestion === "function") {
            rerenderQuestion();
          } else {
            renderQuestionView();
          }

          if (typeof rerenderSidebar === "function") {
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
        const txt = document.createElement("span");
        txt.className = "text-[13px] leading-snug";
        txt.textContent = ans.text || "Option";
        textWrapper.appendChild(txt);

        optionRow.appendChild(input);
        optionRow.appendChild(textWrapper);
        optionsWrapper.appendChild(optionRow);
      });

      body.appendChild(optionsWrapper);
    }

    function renderImageOptions(body, currentMeta, raw) {
      // Используем компактную адаптивную сетку для вариантов с изображениями.
      const correctCount = raw.answers.filter((a) => a && a.correct).length;
      const isMultiple = correctCount > 1;
      const currentAnswer = state.answers[currentMeta.id];
      const questionFeedback =
        state.questionResults && state.questionResults[currentMeta.id];

      const grid = document.createElement("div");
      grid.className =
        "mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3";

      raw.answers.forEach((ans, idx) => {
        const imgSrc =
          (ans && (ans.image_url || ans.image_path)) ||
          (ans && ans.image && ans.image.url) ||
          null;
        const caption = ans && ans.text ? ans.text : "";

        // Оборачиваем карточку в отдельный контейнер, чтобы лупа могла жить
        // вне label и не триггерить выбор ответа.
        const wrapper = document.createElement("div");
        wrapper.className = "relative group";

        const card = document.createElement("label");
        let cardClass =
          "flex flex-col gap-2 rounded-lg p-2 border-2 border-border-strong bg-surface-2 hover:bg-bg-hover transition-colors transition-transform active:scale-[.99] cursor-pointer group dark:border-border-strong dark:bg-surface-2 dark:hover:bg-bg-hover";

        const isSelected = isMultiple
          ? Array.isArray(currentAnswer) && currentAnswer.includes(idx)
          : typeof currentAnswer === "number" && currentAnswer === idx;

        if (state.mode === "answering" && isSelected) {
          cardClass =
            "flex flex-col gap-2 rounded-lg p-2 border-2 border-primary-dark bg-primary ring-2 ring-primary-light transition-colors transition-transform active:scale-[.99] cursor-pointer group";
        }

        if (state.mode === "review" && questionFeedback) {
          const correctIds = toOptionIndexSet(questionFeedback.correct_option_ids);
          const userIds = toOptionIndexSet(questionFeedback.user_option_ids);
          const isCorrect = correctIds.has(idx);
          const isChosen = userIds.has(idx);

          if (isCorrect && isChosen) {
            cardClass =
              "flex flex-col gap-2 rounded-lg p-2 border-2 border-success bg-success-light dark:bg-success-light text-success-text dark:text-success-lighter transition-colors cursor-pointer group";
          } else if (isCorrect && !isChosen) {
            cardClass =
              "flex flex-col gap-2 rounded-lg p-2 border border-success bg-success-light dark:border-success dark:bg-success-light text-success-text dark:text-success-lighter transition-colors cursor-pointer group";
          } else if (!isCorrect && isChosen) {
            cardClass =
              "flex flex-col gap-2 rounded-lg p-2 border-2 border-error bg-error-light dark:bg-error-light text-error-dark dark:text-error-lighter transition-colors cursor-pointer group";
          }
        }

        card.className = cardClass + " tui-option-enter";
        card.style.animationDelay = `${idx * 0.04}s`;

        const imgBox = document.createElement("div");
        imgBox.className =
          "relative w-full aspect-[4/3] overflow-hidden rounded-md border border-border-strong bg-surface-2 dark:bg-surface-2";
        if (imgSrc) {
          const finalSrc = resolveImageUrlForWeb(imgSrc);
          const img = document.createElement("img");
          img.src = finalSrc;
          img.alt = caption || "Answer option";
          img.className = "w-full h-full object-contain";
          // ВАЖНО: не вешаем обработчик click на img, чтобы он не запускал зум,
          // выбор варианта обрабатывается через label/input.
          imgBox.appendChild(img);

        }

        const captionEl = document.createElement("p");
        // Стиль подписи как в макете IMG-A1: выбранный вариант — синий и жирный,
        // остальные — серые и обычные.
        if (state.mode === "answering" && isSelected) {
          captionEl.className =
            "text-sm text-primary-fg text-center font-bold";
        } else {
          captionEl.className =
            "text-sm text-text-secondary dark:text-text-muted text-center font-medium";
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

          if (typeof rerenderQuestion === "function") {
            rerenderQuestion();
          } else {
            renderQuestionView();
          }

          if (typeof rerenderSidebar === "function") {
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

        wrapper.appendChild(card);

        // Кнопка-лупа теперь живёт снаружи label, чтобы её клик не выбирал ответ
        if (imgSrc) {
          const finalSrc = resolveImageUrlForWeb(imgSrc);
          const zoomBtn = document.createElement("button");
          zoomBtn.type = "button";
          zoomBtn.className =
            "absolute bottom-1 right-1 inline-flex h-8 w-8 items-center justify-center rounded-full bg-scrim-strong text-text-on-dark opacity-0 group-hover:opacity-100 transition-opacity";
          const icon = document.createElement("span");
          icon.className = "material-symbols-outlined text-xl";
          icon.textContent = "zoom_in";
          zoomBtn.appendChild(icon);

          zoomBtn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            openImageLightbox(finalSrc, caption);
          });

          wrapper.appendChild(zoomBtn);
        }

        grid.appendChild(wrapper);
      });

      body.appendChild(grid);
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
        "flex items-center justify-center rounded-full size-9 border-2 border-border-strong bg-surface-2 text-text-main transition-colors hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover disabled:cursor-default disabled:border-border-strong disabled:bg-bg-disabled disabled:text-text-main";
      prevBtn.disabled = currentIndex <= 0;

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className =
        "flex items-center justify-center rounded-full size-9 border-2 border-border-strong bg-surface-2 text-text-main transition-colors hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover disabled:cursor-default disabled:border-border-strong disabled:bg-bg-disabled disabled:text-text-main";
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
