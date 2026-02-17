// Question view rendering for TestUI: header (C2), body (C3), options, images, open answers, and review block (C4).
// Exposes TestUIQuestion global used by TestUI.web.js.

(function (global) {
  function createQuestionRenderer(state, main) {
    function getCurrentMeta() {
      if (!state.questions || state.questions.length === 0) {
        return { meta: null, raw: null };
      }
      const meta = state.questions[state.currentIndex] || state.questions[0];
      const raw =
        (state.rawQuestions &&
          state.rawQuestions[meta.index ?? state.currentIndex]) ||
        null;
      return { meta, raw };
    }

    function handleAnswerChange(questionId, idx, isMultiple) {
      let current = state.answers[questionId];
      if (isMultiple) {
        if (!Array.isArray(current)) current = [];
        if (current.includes(idx)) {
          current = current.filter((v) => v !== idx);
        } else {
          current = [...current, idx];
        }
        if (current.length === 0) {
          delete state.answers[questionId];
        } else {
          state.answers[questionId] = current;
        }
      } else {
        state.answers[questionId] = idx;
      }
    }

    function createOptionButton(ans, idx, questionId, isMultiple, currentAnswer, feedback) {
      const btn = document.createElement("button");
      btn.type = "button";

      const isSelected = isMultiple
        ? Array.isArray(currentAnswer) && currentAnswer.includes(idx)
        : typeof currentAnswer === "number" && currentAnswer === idx;

      let baseClass =
        "flex w-full min-w-0 cursor-pointer items-center justify-start overflow-hidden rounded-lg h-12 px-5 text-left border border-border-subtle dark:border-border-strong bg-surface-1 dark:bg-surface-2 hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors text-text-main dark:text-text-on-dark text-lg font-medium";

      if (isSelected) {
        baseClass =
          "flex w-full min-w-0 cursor-pointer items-center justify-start overflow-hidden rounded-lg h-12 px-5 text-left border-2 border-primary bg-primary-lighter dark:bg-primary-lighter transition-colors ring-2 ring-primary-light text-primary dark:text-primary-light text-lg font-semibold";
      }

      // Центральная карточка не перекрашивает варианты по результату проверки –
      // для этого используем только боковую панель. Здесь показываем только выбор пользователя.

      btn.className = baseClass;
      btn.textContent = ans.text || "Option";

      // Разрешаем менять выбор как в answering, так и в review, чтобы можно было перепробовать варианты
      btn.addEventListener("click", () => {
        handleAnswerChange(questionId, idx, isMultiple);
        // Перерисовываем весь вопрос с обновлённым состоянием
        renderQuestionView();
      });

      return btn;
    }

    function renderQuestionView() {
      if (!main) return;
      main.innerHTML = "";

      const { meta, raw } = getCurrentMeta();

      const container = document.createElement("div");
      container.className = "w-full max-w-2xl text-center";

      if (!meta) {
        const empty = document.createElement("p");
        empty.className = "text-sm text-text-muted";
        empty.textContent = "No questions";
        container.appendChild(empty);
        main.appendChild(container);
        return;
      }

      const header = document.createElement("div");
      header.className = "mb-90";

      const title = document.createElement("h2");
      title.className =
        "text-text-main dark:text-text-on-dark text-2xl font-bold leading-tight tracking-[-0.015em] mb-1";
      title.textContent = meta.text || "[Question]";

      const descr = document.createElement("p");
      descr.className =
        "text-text-muted dark:text-text-muted text-base font-normal leading-relaxed mb-8";
      // Пока берём описание из raw.description, если есть
      descr.textContent =
        (raw && (raw.description || raw.explanation)) ||
        "";

      header.appendChild(title);
      if (descr.textContent) header.appendChild(descr);
      container.appendChild(header);

      const answers = (raw && Array.isArray(raw.answers) && raw.answers) || [];

      if (state.isOpenMode) {
        // Для open-режима пока оставляем простой textarea по центру
        const textWrapper = document.createElement("div");
        textWrapper.className = "mt-3 space-y-2 text-left";

        const label = document.createElement("label");
        label.className =
          "text-[13px] font-medium text-text-main dark:text-text-on-dark";
        label.textContent = "Your answer:";

        const textarea = document.createElement("textarea");
        const qId = meta.id;
        const existing =
          typeof state.answers[qId] === "string" ? state.answers[qId] : "";

        textarea.className =
          "w-full rounded-lg border-2 border-border-strong dark:border-border-strong bg-surface-1 dark:bg-bg-hover p-4 text-sm text-text-main dark:text-text-on-dark placeholder:text-text-secondary dark:placeholder:text-text-secondary focus:ring-2 focus:ring-primary focus:border-primary transition-colors min-h-[120px]";
        textarea.value = existing;

        if (state.mode === "review") {
          textarea.readOnly = true;
          textarea.className =
            "w-full rounded-lg border-2 border-border-strong dark:border-border-strong bg-surface-2 dark:bg-surface-2 p-4 text-sm text-text-main dark:text-text-on-dark min-h-[120px] cursor-not-allowed";
        } else {
          textarea.addEventListener("input", () => {
            const val = textarea.value || "";
            if (val.trim()) {
              state.answers[qId] = val;
            } else {
              delete state.answers[qId];
            }
          });
        }

        textWrapper.appendChild(label);
        textWrapper.appendChild(textarea);
        container.appendChild(textWrapper);
      } else if (answers.length > 0) {
        const isMultipleGlobal = state.testType === "multiple_choice";
        const correctCount = answers.filter((a) => a && a.correct).length;
        const isMultiple = isMultipleGlobal || correctCount > 1;

        const currentAnswer = state.answers[meta.id];
        const questionFeedback =
          state.questionResults && state.questionResults[meta.id];

        const grid = document.createElement("div");
        // Большой вертикальный отступ сверху и увеличенный gap между вариантами
        grid.className = "mt-16 grid grid-cols-1 sm:grid-cols-2 gap-6 mb-10";

        answers.forEach((ans, idx) => {
          const btn = createOptionButton(
            ans,
            idx,
            meta.id,
            isMultiple,
            currentAnswer,
            questionFeedback
          );
          grid.appendChild(btn);
        });

        container.appendChild(grid);
      }

      // Блок кнопок навигации, как в L1-M1 (Next Question / Check Answer)
      const actions = document.createElement("div");
      actions.className = "mt-6 flex items-center justify-center gap-4";

      const prevBtn = document.createElement("button");
      prevBtn.type = "button";
      prevBtn.className =
        "flex items-center justify-center rounded-full size-12 bg-surface-2 dark:bg-surface-2 text-text-muted dark:text-text-muted hover:bg-bg-hover dark:hover:bg-bg-hover transition-colors";
      const prevIcon = document.createElement("span");
      prevIcon.className = "material-symbols-outlined text-2xl";
      prevIcon.textContent = "chevron_left";
      prevBtn.appendChild(prevIcon);

      prevBtn.addEventListener("click", () => {
        if (state.currentIndex > 0) {
          state.currentIndex -= 1;
          state.visitedIndices = state.visitedIndices || {};
          state.visitedIndices[state.currentIndex] = true;
          renderQuestionView();
        }
      });

      const nextBtn = document.createElement("button");
      nextBtn.type = "button";
      nextBtn.className =
        "flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-xl h-12 px-6 bg-primary text-primary-fg text-base font-bold leading-normal tracking-[0.015em] grow";
      nextBtn.textContent = "Next Question";

      nextBtn.addEventListener("click", () => {
        if (state.currentIndex < state.questions.length - 1) {
          state.currentIndex += 1;
          state.visitedIndices = state.visitedIndices || {};
          state.visitedIndices[state.currentIndex] = true;
          renderQuestionView();
        }
      });

      const checkBtn = document.createElement("button");
      checkBtn.type = "button";
      checkBtn.className =
        "flex min-w-[84px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-xl h-12 px-6 bg-bg-tertiary dark:bg-surface-2 text-text-main dark:text-text-on-dark text-base font-bold leading-normal tracking-[0.015em] grow";
      checkBtn.textContent = "Check Answer";

      checkBtn.addEventListener("click", () => {
        // Если TestInterfaceBridge доступен (mock/webview), дергаем его onCheckRequested
        if (
          typeof window !== "undefined" &&
          window.TestInterfaceBridge &&
          typeof window.TestInterfaceBridge.onCheckRequested === "function"
        ) {
          window.TestInterfaceBridge.onCheckRequested();
        }
      });

      actions.appendChild(prevBtn);
      actions.appendChild(nextBtn);
      actions.appendChild(checkBtn);

      container.appendChild(actions);

      main.appendChild(container);
    }

    return { renderQuestionView };
  }

  global.TestUIQuestion = {
    createQuestionRenderer,
  };
})(typeof window !== "undefined" ? window : globalThis);
