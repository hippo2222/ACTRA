// Core logic for TestUI: task parsing and state initialization
// Exposes TestUICore global used by TestUI.web.js and potentially Trainer.

(function (global) {
  function extractQuestions(task) {
    if (!task || !task.task_data) {
      return { questions: [], rawQuestions: [], testType: null };
    }
    const td = task.task_data;

    let raw = [];
    if (td.content && Array.isArray(td.content.questions)) {
      raw = td.content.questions;
    } else if (Array.isArray(td.questions)) {
      raw = td.questions;
    }

    const mapped = raw.map((q, idx) => {
      return {
        id: q.id != null ? String(q.id) : `q_${idx + 1}`,
        index: idx,
        text: q.text || q.title || "Question",
      };
    });

    const testType = (td.content && td.content.test_type) || td.test_type || null;

    return { questions: mapped, rawQuestions: raw, testType };
  }

  function createInitialState(task) {
    const extracted = extractQuestions(task);
    const questions = extracted.questions;
    const rawQuestions = extracted.rawQuestions;
    const testType = extracted.testType || "single_choice";

    const td = task && task.task_data;
    const content = td && td.content;
    const requiresTextInput = !!(content && content.requires_text_input);
    const showOptions =
      content && Object.prototype.hasOwnProperty.call(content, "show_options")
        ? !!content.show_options
        : true;
    const isOpenMode = requiresTextInput || !showOptions;

    const difficultyFromTask =
      (task && (task.difficulty || (task.task_data && task.task_data.difficulty))) ||
      null;

    return {
      questions,
      rawQuestions,
      testType,
      currentIndex: 0,
      selections: {},
      answers: {}, // questionId -> index | index[] | string (для open)
      isOpenMode,
      flags: {}, // questionId -> boolean (flagged for review)
      mode: "answering", // or "review"
      difficulty: difficultyFromTask,
      questionResults: {}, // per_question review data from backend
    };
  }

  global.TestUICore = {
    extractQuestions,
    createInitialState,
  };
})(typeof window !== "undefined" ? window : globalThis);
