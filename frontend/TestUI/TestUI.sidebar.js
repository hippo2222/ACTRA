// TestUISidebar: renders the question panel in the right column
// Plugs into TestUI.web.js via TestUISidebar.renderSidebar({ state, listElement, onSelectQuestion })

(function (global) {
  function hasMeaningfulAnswerValue(value) {
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "string") return value.trim().length > 0;
    return value != null;
  }

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

  function getPendingUnansweredIdSet(state) {
    const out = new Set();
    const ids =
      state && Array.isArray(state.pendingUnansweredQuestionIds)
        ? state.pendingUnansweredQuestionIds
        : [];
    ids.forEach((value) => {
      if (value == null) return;
      out.add(String(value));
    });
    return out;
  }

  function getNormalizedQuestionStatus(questionResult) {
    if (!questionResult || typeof questionResult !== "object") return null;

    const rawStatus = String(questionResult.status || "").trim().toLowerCase();
    if (
      rawStatus === "correct" ||
      rawStatus === "incorrect" ||
      rawStatus === "unanswered"
    ) {
      return rawStatus;
    }

    const details =
      questionResult.details && typeof questionResult.details === "object"
        ? questionResult.details
        : {};
    const correctIds = toOptionIndexSet(
      Array.isArray(questionResult.correct_option_ids)
        ? questionResult.correct_option_ids
        : details.correct_option_ids
    );
    const userIds = toOptionIndexSet(
      Array.isArray(questionResult.user_option_ids)
        ? questionResult.user_option_ids
        : details.user_option_ids
    );
    const hasUserAnswer =
      userIds.size > 0 ||
      hasMeaningfulAnswerValue(questionResult.user_answer) ||
      hasMeaningfulAnswerValue(details.user_answer);

    if (questionResult.correct === true || questionResult.is_correct === true) {
      return "correct";
    }
    if (questionResult.correct === false || questionResult.is_correct === false) {
      return hasUserAnswer ? "incorrect" : "unanswered";
    }

    const reason = String(questionResult.reason || details.reason || "")
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

  function getSidebarItemClass(state, idx) {
    const q = state.questions[idx];
    const isCurrent = idx === state.currentIndex;
    const isAnswered = !!(q && state.selections[q.id]);
    const pendingUnansweredIds = getPendingUnansweredIdSet(state);
    const isPendingUnanswered = !!(
      q &&
      !isAnswered &&
      pendingUnansweredIds.has(String(q.id))
    );
    const qr = q && state.questionResults && state.questionResults[q.id];
    const status = getNormalizedQuestionStatus(qr); // correct / incorrect / unanswered

    let cls =
      "relative flex items-center justify-center size-10 rounded-xl border-2 border-border-strong bg-surface-2 text-text-main shadow-sm hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover font-bold text-sm transition-all";

    if (!status) {
      if (isPendingUnanswered && isCurrent) {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-warning-light bg-warning-lighter text-warning-darker font-bold text-sm ring-2 ring-offset-2 ring-offset-surface-1 dark:ring-offset-surface-2 ring-warning shadow-sm";
      } else if (isPendingUnanswered) {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-warning-light bg-warning-lighter text-warning-darker font-bold text-sm shadow-sm hover:-translate-y-[1px] hover:bg-warning-light transition-all";
      } else if (isCurrent) {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-primary bg-primary text-primary-fg font-bold text-sm ring-2 ring-offset-2 ring-offset-surface-1 dark:ring-offset-surface-2 ring-primary shadow-sm";
      } else if (isAnswered) {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl bg-primary text-primary-fg font-bold text-sm shadow-sm";
      } else if (state.visitedIndices && state.visitedIndices[idx]) {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-border-strong bg-surface-2 text-text-main shadow-sm hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark dark:hover:bg-bg-hover font-bold text-sm transition-all";
      } else {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-dashed border-border-strong bg-transparent text-text-muted shadow-sm hover:-translate-y-[1px] hover:bg-bg-hover dark:border-border-strong dark:bg-transparent dark:text-text-muted dark:hover:bg-bg-hover font-bold text-sm transition-all";
      }
    }

    if (state.mode === "review" && status) {
      if (status === "correct") {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-border-strong bg-success-light text-text-main font-bold text-sm shadow-sm dark:bg-success-light dark:text-text-main";
      } else if (status === "incorrect") {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-border-strong bg-error-light text-text-main font-bold text-sm shadow-sm dark:bg-error-light dark:text-text-main";
      } else if (status === "unanswered") {
        cls =
          "relative flex items-center justify-center size-10 rounded-xl border-2 border-border-strong bg-surface-2 text-text-main font-bold text-sm shadow-sm dark:border-border-strong dark:bg-surface-2 dark:text-text-on-dark";
      }
    }

    return cls;
  }

  function renderSidebarItem(item, state, q, idx) {
    item.type = "button";
    item.className = getSidebarItemClass(state, idx);
    item.dataset.questionIndex = String(idx);
    item.textContent = "";

    const label = document.createElement("span");
    label.textContent = String(idx + 1);
    item.appendChild(label);

    if (state.flags && state.flags[q.id]) {
      const flagIcon = document.createElement("span");
      flagIcon.className =
        "material-symbols-outlined fill absolute -top-1.5 -right-1.5 text-warning dark:text-warning text-lg";
      flagIcon.textContent = "flag";
      item.appendChild(flagIcon);
    }
  }

  function renderSidebar(ctx) {
    const { state, listElement, onSelectQuestion } = ctx;

    listElement.innerHTML = "";

    if (!state.questions || state.questions.length === 0) {
      const empty = document.createElement("li");
      empty.className =
        "col-span-5 rounded-xl border-2 border-dashed border-border-strong bg-surface-2 px-3 py-3 text-center text-xs text-text-muted dark:border-border-strong dark:bg-surface-2 dark:text-text-muted";
      empty.textContent = "Нет вопросов";
      listElement.appendChild(empty);
      return;
    }

    state.questions.forEach((q, idx) => {
      const item = document.createElement("button");
      renderSidebarItem(item, state, q, idx);
      item.addEventListener("click", () => {
        if (typeof onSelectQuestion === "function") {
          onSelectQuestion(idx);
        }
      });
      listElement.appendChild(item);
    });
  }

  function syncSidebarQuestion(ctx) {
    const { state, listElement, questionIndex } = ctx;
    if (!listElement || !state || !Array.isArray(state.questions)) return;
    const q = state.questions[questionIndex];
    if (!q) return;
    const item = listElement.querySelector(
      `[data-question-index="${String(questionIndex)}"]`
    );
    if (!item) return;
    renderSidebarItem(item, state, q, questionIndex);
  }

  global.TestUISidebar = { renderSidebar, syncSidebarQuestion };
})(typeof window !== "undefined" ? window : globalThis);
