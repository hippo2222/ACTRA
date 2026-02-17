// Sidebar rendering for TestUI: Question Panel grid and legend-compatible styles.
// Exposes TestUISidebar global used by TestUI.web.js.

(function (global) {
  function renderSidebar(config) {
    const { state, listElement, onSelectQuestion } = config || {};
    if (!state || !listElement || typeof onSelectQuestion !== "function") {
      return;
    }

    const list = listElement;
    list.innerHTML = "";

    if (!Array.isArray(state.questions) || state.questions.length === 0) {
      const empty = document.createElement("li");
      empty.className =
        "col-span-4 rounded-md px-2 py-2 text-center text-xs text-text-muted dark:text-text-muted border border-dashed border-border-subtle dark:border-border-strong";
      empty.textContent = "No questions";
      list.appendChild(empty);
      return;
    }

    state.questions.forEach((q, idx) => {
      const item = document.createElement("li");
      const questionId = q.id;

      const isCurrent = idx === state.currentIndex;
      const hasAnswer = Object.prototype.hasOwnProperty.call(
        state.answers || {},
        questionId
      );
      const isFlagged = !!(state.flags && state.flags[questionId]);
      const qr = state.questionResults && state.questionResults[questionId];
      const status = qr && qr.status; // correct | incorrect | unanswered

      // Visited: используем явный флаг из состояния, который помечается при переходах
      const isVisited = !!(
        state.visitedIndices && state.visitedIndices[idx]
      );

      let baseClass =
        "relative flex items-center justify-center size-10 rounded-lg text-xs font-semibold cursor-pointer select-none transition-colors ";

      if (state.mode === "review" && status) {
        // Режим проверки: используем палитру Correct/Incorrect/Unanswered
        if (status === "correct") {
          baseClass +=
            "border-2 border-success bg-success-light text-success-text dark:border-success dark:bg-success-light dark:text-success-light";
        } else if (status === "incorrect") {
          baseClass +=
            "border-2 border-error bg-error-light text-error-text dark:border-error dark:bg-error-light dark:text-error-light";
        } else if (status === "unanswered") {
          baseClass +=
            "border border-border-subtle bg-surface-2 text-text-secondary dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
        }
      } else if (hasAnswer) {
        // Отвеченный, но ещё не проверенный — синий (Answered)
        baseClass +=
          "bg-primary text-primary-fg border border-primary shadow-sm hover:brightness-110";
      } else if (isCurrent) {
        // Текущий вопрос — как кружок 7 в L1-M1: синяя рамка, голубой фон, небольшой ring
        baseClass +=
          "border-2 border-primary bg-primary-light text-primary shadow-sm ring-2 ring-offset-2 ring-offset-surface-1 ring-primary dark:ring-offset-surface-2";
      } else if (isVisited) {
        // Просто посещённый (Visited)
        baseClass +=
          "border border-border-subtle bg-surface-1 text-text-main hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
      } else {
        // Not visited — пунктирная рамка
        baseClass +=
          "border border-dashed border-border-normal text-text-muted bg-transparent hover:bg-bg-hover dark:border-border-strong dark:text-text-muted";
      }

      item.className = baseClass.trim();

      const label = document.createElement("span");
      label.className = "inline-flex h-5 w-5 items-center justify-center text-[11px]";
      label.textContent = String(idx + 1);
      item.appendChild(label);

      if (isFlagged) {
        const flag = document.createElement("span");
        flag.className =
          "absolute -top-1 -right-1 text-[14px] text-warning dark:text-warning-light";
        flag.textContent = "⚑";
        item.appendChild(flag);
      }

      item.addEventListener("click", () => {
        onSelectQuestion(idx);
      });

      list.appendChild(item);
    });
  }

  global.TestUISidebar = {
    renderSidebar,
  };
})(typeof window !== "undefined" ? window : globalThis);
