// TestUISidebar: renders the question panel in the right column
// Plugs into TestUI.web.js via TestUISidebar.renderSidebar({ state, listElement, onSelectQuestion })

(function (global) {
  function renderSidebar(ctx) {
    const { state, listElement, onSelectQuestion } = ctx;

    listElement.innerHTML = "";

    if (!state.questions || state.questions.length === 0) {
      const empty = document.createElement("li");
      empty.className =
        "col-span-5 rounded-md border-2 border-dashed border-border-strong bg-surface-2 px-2 py-2 text-center text-xs text-text-muted dark:border-border-strong dark:bg-surface-2 dark:text-text-muted";
      empty.textContent = "No questions";
      listElement.appendChild(empty);
      return;
    }

    const total = state.questions.length;

    state.questions.forEach((q, idx) => {
      const item = document.createElement("button");
      item.type = "button";

      const isCurrent = idx === state.currentIndex;
      const isAnswered = !!state.selections[q.id];
      const isFlagged = !!state.flags[q.id];
      const qr = state.questionResults && state.questionResults[q.id];
      const status = qr && qr.status; // correct / incorrect / unanswered

      // Базовый neutral-вид как "Not Visited" (кнопки 5,8-20 в sidebar-panel-l1m1)
      let cls =
        "relative flex items-center justify-center size-10 rounded-lg border-2 border-border-strong bg-surface-2 text-text-main hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover font-bold text-sm";

      // Визит / ответ до review
      if (!status) {
        if (isCurrent) {
          // Текущий вопрос (как кнопка 7 в макете): голубой фон, рамка и ring
          cls =
            "relative flex items-center justify-center size-10 rounded-lg border-2 border-primary bg-primary text-primary-fg font-bold text-sm ring-2 ring-offset-2 ring-offset-surface-1 dark:ring-offset-surface-2 ring-primary";
        } else if (isAnswered) {
          // Answered (кнопки 3 и 6): сплошной primary без ring
          cls =
            "relative flex items-center justify-center size-10 rounded-lg bg-primary text-primary-fg font-bold text-sm";
        } else if (state.visitedIndices && state.visitedIndices[idx]) {
          // Visited (кнопка 4)
          cls =
            "relative flex items-center justify-center size-10 rounded-lg border-2 border-border-strong bg-surface-2 text-text-main hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover font-bold text-sm";
        }
      }

      // Review-режим: перекрашиваем по статусу
      if (state.mode === "review" && status) {
        if (status === "correct") {
          // как кнопка 1 (Correct)
          cls =
            "relative flex items-center justify-center size-10 rounded-lg border-2 border-border-strong bg-success-light text-text-main font-bold text-sm dark:bg-success-light dark:text-text-main";
        } else if (status === "incorrect") {
          // как кнопка 2 (Incorrect)
          cls =
            "relative flex items-center justify-center size-10 rounded-lg border-2 border-border-strong bg-error-light text-text-main font-bold text-sm dark:bg-error-light dark:text-text-main";
        } else if (status === "unanswered") {
          // близко к Visited, но можно оставить отдельным стилем, если нужно
          cls =
            "relative flex items-center justify-center size-10 rounded-lg border-2 border-border-strong bg-surface-2 text-text-main font-bold text-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
        }
      }

      item.className = cls;

      const label = document.createElement("span");
      label.textContent = String(idx + 1);
      item.appendChild(label);

      // Флажок
      if (isFlagged) {
        const flagIcon = document.createElement("span");
        flagIcon.className =
          "material-symbols-outlined fill absolute -top-1.5 -right-1.5 text-warning dark:text-warning text-lg";
        flagIcon.textContent = "flag";
        item.appendChild(flagIcon);
      }

      item.addEventListener("click", () => {
        if (typeof onSelectQuestion === "function") {
          onSelectQuestion(idx);
        }
      });

      listElement.appendChild(item);
    });
  }

  global.TestUISidebar = { renderSidebar };
})(typeof window !== "undefined" ? window : globalThis);
