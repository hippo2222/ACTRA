(function (root) {
  "use strict";

  function wt(key, fallback) {
    if (!window.i18n || typeof window.i18n.t !== 'function') return fallback;
    var v = window.i18n.t(key);
    return v !== key ? v : fallback;
  }

  const state = {
    initialized: false,
    sessionId: null,
    iteration: null,
    hasNextIteration: false,
    latestSummary: null,
    currentUserId: null,
    currentUserPromise: null,
    menuOpen: false,
    detailsOpen: false,
    reviewOpen: false,
    reviewExpanded: false,
    imagePreviewOpen: false,
    toggledProblems: {},
    failedCount: 0,
    problemOpen: false,
  };

  function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
  }

  function getById(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    const el = typeof id === "string" ? getById(id) : id;
    if (!el) return;
    el.textContent = value == null || value === "" ? "—" : String(value);
  }

  function setHidden(id, hidden) {
    const el = typeof id === "string" ? getById(id) : id;
    if (!el) return;
    el.classList.toggle("hidden", !!hidden);
    el.setAttribute("aria-hidden", hidden ? "true" : "false");
  }

  function toNumberOrNull(value) {
    if (value == null || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function safeDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function computeDurationSecondsFromTimestamps(startTime, endTime) {
    const start = safeDate(startTime);
    const end = safeDate(endTime);
    if (!start || !end) return null;
    const diffMs = end.getTime() - start.getTime();
    if (!Number.isFinite(diffMs) || diffMs < 0) return null;
    return Math.round(diffMs / 1000);
  }

  function formatDuration(seconds) {
    const totalSeconds = toNumberOrNull(seconds);
    if (totalSeconds == null || totalSeconds < 0) return "—";

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const remainderSeconds = Math.floor(totalSeconds % 60);
    const pad = (value) => String(value).padStart(2, "0");

    if (hours > 0) {
      return `${hours}:${pad(minutes)}:${pad(remainderSeconds)}`;
    }
    return `${minutes}:${pad(remainderSeconds)}`;
  }

  function formatPlural(count, one, few, many) {
    const value = Math.abs(Number(count) || 0) % 100;
    const last = value % 10;

    if (value > 10 && value < 20) return many;
    if (last > 1 && last < 5) return few;
    if (last === 1) return one;
    return many;
  }

  function formatErrorCount(count) {
    const value = Math.max(0, Number(count) || 0);
    return `${value} ${formatPlural(value, wt('s2.error_one', 'ошибка'), wt('s2.error_few', 'ошибки'), wt('s2.error_many', 'ошибок'))}`;
  }

  function compactText(value, maxLength) {
    const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
    const limit = Math.max(12, Number(maxLength) || 80);
    if (!text) return "";
    if (text.length <= limit) return text;
    return `${text.slice(0, limit - 1).trim()}…`;
  }

  function looksTechnical(value) {
    const text = String(value == null ? "" : value).trim();
    if (!text) return true;
    return (
      /(^|[\s/_-])(task|complex|module|topic|session|iteration|level|l[1-9])([\s/_-]|$)/i.test(text) ||
      /[a-f0-9]{8,}/i.test(text) ||
      text.split(/[/_-]/).length >= 4
    );
  }

  function humanLabel(value, fallback, maxLength) {
    const text = compactText(value, maxLength || 72);
    if (!text) return fallback;
    return looksTechnical(text) ? fallback : text;
  }

  function normalizeAnswer(value) {
    if (value == null) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
      return value.map(normalizeAnswer).filter(Boolean).join(", ");
    }
    if (isObject(value)) {
      const candidate = [
        value.text,
        value.label,
        value.value,
        value.answer,
        value.correct_answer,
        value.user_answer,
      ].find(function (item) {
        return String(item || "").trim();
      });
      return candidate ? String(candidate).trim() : "";
    }
    return "";
  }

  function normalizeReviewLines(value) {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value
        .map(function (item) {
          return normalizeAnswer(item);
        })
        .map(function (item) {
          return item.replace(/\s+/g, " ").trim();
        })
        .filter(Boolean);
    }

    const text = normalizeAnswer(value);
    if (!text) return [];
    return text
      .split(/\r?\n/)
      .map(function (line) {
        return line.replace(/\s+/g, " ").trim();
      })
      .filter(Boolean);
  }

  function resolveReviewImageUrl(value) {
    if (!value && value !== 0) return "";

    if (isObject(value)) {
      const nested = isObject(value.image) ? value.image : null;
      const directUrl =
        value.asset_url ||
        value.image_asset_url ||
        value.image_url ||
        value.imageUrl ||
        value.url ||
        value.image_path ||
        value.imagePath ||
        value.path ||
        value.src ||
        (nested &&
          (nested.asset_url ||
            nested.image_asset_url ||
            nested.image_url ||
            nested.url ||
            nested.image_path ||
            nested.path ||
            nested.src)) ||
        "";
      if (directUrl) return resolveReviewImageUrl(directUrl);

      const assetId =
        value.asset_id ||
        value.image_asset_id ||
        (nested && (nested.asset_id || nested.image_asset_id)) ||
        "";
      if (assetId) {
        return `/api/assets/${encodeURIComponent(String(assetId))}/content`;
      }
      return "";
    }

    const raw = String(value == null ? "" : value).trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/")) return raw;
    return `/api/local-image?path=${encodeURIComponent(raw)}`;
  }

  function isGenericOptionLabel(value) {
    return /^вариант\s+\d+$/i.test(String(value == null ? "" : value).trim());
  }

  function normalizeReviewItems(value) {
    if (!Array.isArray(value)) return [];
    return value
      .map(function (item) {
        if (!isObject(item)) {
          const textValue = normalizeAnswer(item);
          return textValue ? { type: "text", text: textValue, imageUrl: "", fallbackLabel: "" } : null;
        }

        const textValue = normalizeAnswer(
          item.text ||
            item.label ||
            item.value ||
            item.title
        );
        const hasHostedAssetRef =
          item.image_asset_url != null ||
          item.image_asset_id != null ||
          item.asset_url != null ||
          item.asset_id != null;
        const imageRaw = hasHostedAssetRef
          ? item
          : (
            item.image_url ||
            item.imageUrl ||
            item.image_path ||
            item.imagePath ||
            item.image ||
            item.src ||
            ""
          );
        const optionIndex = toNumberOrNull(item.option_index ?? item.optionIndex);
        const fallbackLabel = normalizeAnswer(item.fallback_label || item.fallbackLabel);
        const imageUrl = imageRaw ? resolveReviewImageUrl(imageRaw) : "";
        if (!textValue && !imageUrl) return null;
        return {
          type: item.type || item.kind || (imageUrl ? "choice_option" : "text"),
          text: textValue,
          imageUrl,
          imagePath: imageRaw,
          optionIndex,
          fallbackLabel,
        };
      })
      .filter(Boolean);
  }

  function normalizeReviewEntry(value, taskName, prompt, fallbackUserAnswer, fallbackCorrectAnswer, explanation) {
    const source = isObject(value) ? value : {};
    const reviewPrompt = compactText(
      source.prompt ||
        source.question ||
        prompt,
      320
    );
    const userLines = normalizeReviewLines(
      source.user_lines ||
        source.userLines ||
        source.user_answer ||
        source.userAnswer ||
        fallbackUserAnswer
    );
    const referenceLines = normalizeReviewLines(
      source.reference_lines ||
        source.referenceLines ||
        source.correct_answer ||
        source.correctAnswer ||
        fallbackCorrectAnswer
    );
    const userItems = normalizeReviewItems(
      source.user_items ||
        source.userItems
    );
    const referenceItems = normalizeReviewItems(
      source.reference_items ||
        source.referenceItems
    );
    const note = compactText(source.note || source.explanation || explanation, 220);

    return {
      title: humanLabel(source.title || taskName, taskName || wt('s2.task_fallback_label', 'Задание'), 96),
      prompt: reviewPrompt,
      userLabel: compactText(source.user_label || source.userLabel, 48) || wt('s2.user_label', 'Твоё решение'),
      referenceLabel: compactText(source.reference_label || source.referenceLabel, 48) || wt('s2.reference_label', 'Референс'),
      userLines,
      referenceLines,
      userItems,
      referenceItems,
      note,
      kind: compactText(source.kind || source.type, 48),
      status: compactText(source.status, 32),
    };
  }

  function hasNormalizedReviewContent(review) {
    if (!review || typeof review !== "object") return false;
    return Boolean(
      String(review.prompt || "").trim() ||
      (Array.isArray(review.userLines) && review.userLines.length) ||
      (Array.isArray(review.referenceLines) && review.referenceLines.length) ||
      (Array.isArray(review.userItems) && review.userItems.length) ||
      (Array.isArray(review.referenceItems) && review.referenceItems.length)
    );
  }

  function normalizeReview(value, taskName, prompt, fallbackUserAnswer, fallbackCorrectAnswer, explanation) {
    const source = isObject(value) ? value : {};
    const review = normalizeReviewEntry(
      source,
      taskName,
      prompt,
      fallbackUserAnswer,
      fallbackCorrectAnswer,
      explanation
    );

    review.entries = Array.isArray(source.entries)
      ? source.entries
          .map(function (entry) {
            return normalizeReviewEntry(
              entry,
              review.title || taskName,
              review.prompt || prompt,
              "",
              "",
              explanation
            );
          })
          .filter(hasNormalizedReviewContent)
      : [];

    return review;
  }

  function normalizeTask(task, index) {
    const source = isObject(task) ? task : {};
    const details = isObject(source.details) ? source.details : {};
    const meta = isObject(source.meta) ? source.meta : {};
    const nestedTask = isObject(source.task) ? source.task : {};
    const taskData = isObject(source.task_data)
      ? source.task_data
      : isObject(nestedTask.task_data)
        ? nestedTask.task_data
        : {};
    const content = isObject(taskData.content) ? taskData.content : {};
    const name = humanLabel(
      source.task_name ||
        source.taskName ||
        meta.name ||
        meta.title ||
        source.name ||
        source.title ||
        details.name ||
        details.title ||
        taskData.name ||
        taskData.title,
      wt('s2.task_number', 'Задание {n}').replace('{n}', Number(index) + 1),
      84
    );
    const prompt = compactText(
      source.question ||
        source.prompt ||
        source.task_text ||
        source.text ||
        details.question ||
        details.prompt ||
        details.task_text ||
        taskData.question ||
        taskData.prompt ||
        content.question ||
        content.prompt ||
        content.text ||
        content.task_text,
      260
    );
    const difficulty = clamp(toNumberOrNull(source.difficulty || details.difficulty) || 2, 1, 3);
    const explicitSuccess =
      source.success === true || details.success === true
        ? true
        : source.success === false || details.success === false
          ? false
          : false;
    const errors = Math.max(
      explicitSuccess ? 0 : 1,
      toNumberOrNull(source.errors) || toNumberOrNull(details.errors) || 0
    );
    const userAnswer = normalizeAnswer(
      source.user_answer ||
        source.userAnswer ||
        details.user_answer ||
        details.userAnswer ||
        details.answer
    );
    const correctAnswer = normalizeAnswer(
      source.correct_answer ||
        source.correctAnswer ||
        details.correct_answer ||
        details.correctAnswer
    );
    const explanation = normalizeAnswer(
      source.feedback ||
        source.message ||
        source.result_note ||
        details.feedback ||
        details.message ||
        details.explanation ||
        details.result_note
    );
    const review = normalizeReview(
      source.review || details.review,
      name,
      prompt,
      userAnswer,
      correctAnswer,
      explanation
    );

    return {
      key: source.key || source.id || `task-${index}`,
      name,
      prompt,
      difficulty,
      success: explicitSuccess,
      errors,
      userAnswer,
      correctAnswer,
      explanation,
      review,
    };
  }

  function hasReviewData(task) {
    if (!task || typeof task !== "object") return false;
    return Boolean(
      hasNormalizedReviewContent(task.review) ||
      (Array.isArray(task.review && task.review.entries) && task.review.entries.some(hasNormalizedReviewContent)) ||
      String(task.userAnswer || "").trim() ||
      String(task.correctAnswer || "").trim()
    );
  }

  function expandReviewTasks(tasks) {
    if (!Array.isArray(tasks)) return [];

    const expanded = [];
    tasks.forEach(function (task, taskIndex) {
      const review = task && isObject(task.review) ? task.review : null;
      const entries =
        review && Array.isArray(review.entries)
          ? review.entries.filter(hasNormalizedReviewContent)
          : [];

      if (entries.length && review.kind !== "full_test") {
        entries.forEach(function (entry, entryIndex) {
          expanded.push({
            ...task,
            key: `${task.key || `task-${taskIndex}`}-review-${entryIndex}`,
            review: entry,
          });
        });
        return;
      }

      expanded.push(task);
    });

    return expanded.filter(hasReviewData);
  }

  function appendInlineReviewContent(target, review) {
    if (!target || !review) return;

    const question = document.createElement("p");
    question.className = "s2-review-question";
    question.textContent = review.prompt || review.title || "";
    target.appendChild(question);

    if (review.note) {
      const note = document.createElement("p");
      note.className = "s2-review-note";
      note.textContent = review.note;
      target.appendChild(note);
    }

    appendReviewAnswerContent(
      target,
      review.userLabel || wt('s2.user_label', 'Твоё решение'),
      Array.isArray(review.userLines) ? review.userLines : [],
      Array.isArray(review.userItems) ? review.userItems : [],
      review.status === "correct" ? "s2-review-answer--success" : "s2-review-answer--error"
    );

    appendReviewAnswerContent(
      target,
      review.referenceLabel || wt('s2.reference_label', 'Референс'),
      Array.isArray(review.referenceLines) ? review.referenceLines : [],
      Array.isArray(review.referenceItems) ? review.referenceItems : [],
      "s2-review-answer--success"
    );
  }

  function extractLegacyFailedTaskNames(data) {
    return (Array.isArray(data && data.iteration_results) ? data.iteration_results : [])
      .filter(function (task) {
        return !(task && task.success);
      })
      .map(function (task, index) {
        const source = isObject(task) ? task : {};
        const review = isObject(source.review) ? source.review : {};
        const details = isObject(source.details) ? source.details : {};
        const meta = isObject(source.meta) ? source.meta : {};
        return compactText(
          source.task_name ||
            source.taskName ||
            review.title ||
            meta.name ||
            meta.title ||
            source.name ||
            source.title ||
            details.name ||
            details.title,
          96
        ) || wt('s2.task_number', 'Задание {n}').replace('{n}', index + 1);
      })
      .filter(Boolean)
      .join(", ");
  }

  function normalizeIterationResults(data) {
    const source = isObject(data) ? data : {};
    const tasksSource = Array.isArray(source.iteration_results)
      ? source.iteration_results
      : Array.isArray(source.tasks)
        ? source.tasks
        : Array.isArray(source.task_results)
          ? source.task_results
          : [];

    const tasks = tasksSource.map(normalizeTask).filter(Boolean);
    let total = toNumberOrNull(source.total_tasks ?? source.tasks_total ?? source.unique_tasks);
    let success = toNumberOrNull(source.successful_tasks ?? source.successes ?? source.completed_tasks);
    let failed = toNumberOrNull(source.failed_tasks ?? source.errors ?? source.tasks_failed);

    if ((total == null || total <= 0) && tasks.length) {
      total = tasks.length;
    }
    if (success == null && tasks.length) {
      success = tasks.filter(function (task) {
        return task.success;
      }).length;
    }
    if (failed == null && tasks.length) {
      failed = tasks.filter(function (task) {
        return !task.success;
      }).length;
    }

    total = Math.max(0, total || 0);
    success = Math.max(0, success || 0);
    failed = Math.max(0, failed != null ? failed : Math.max(0, total - success));

    const ratePercent = total ? Math.round((success / total) * 100) : clamp(toNumberOrNull(source.success_rate) || 0, 0, 100);
    const durationSeconds =
      toNumberOrNull(source.duration_seconds) ??
      computeDurationSecondsFromTimestamps(source.start_time, source.end_time);
    const difficulty =
      clamp(
        toNumberOrNull(
          source.current_difficulty ||
            source.difficulty ||
            source.iteration_difficulty ||
            source.difficulty_level
        ) || (
          tasks.length
            ? tasks.reduce(function (sum, task) {
                return sum + (task.difficulty || 2);
              }, 0) / tasks.length
            : 2
        ),
        1,
        3
      );

    return {
      sessionId: String(source.session_id || state.sessionId || ""),
      iteration: toNumberOrNull(source.iteration ?? source.iteration_index ?? state.iteration) || 1,
      complexName: humanLabel(source.complex_name || source.complex_title, wt('s2.complex_fallback', 'Комплекс'), 40),
      total,
      success,
      failed,
      ratePercent,
      durationSeconds,
      difficulty,
      hasNextIteration:
        source.has_next_iteration != null ? Boolean(source.has_next_iteration) : Boolean(state.hasNextIteration),
      tasks,
      failedTasks: tasks.filter(function (task) {
        return !task.success;
      }),
    };
  }

  function deriveOutcome(summary) {
    const failed = summary.failed;
    const rate = summary.ratePercent;
    const firstFailed = summary.failedTasks[0] || null;

    if (summary.total === 0) {
      return {
        tone: "neutral",
        status: wt('s2.outcome_neutral_status', 'результат готов'),
        summary: wt('s2.outcome_neutral_summary', 'Сводка загрузилась не полностью. Можно открыть итоги и проверить детали.'),
        focusLabel: wt('s2.outcome_neutral_focus_label', 'Внимание'),
        focusTitle: wt('s2.outcome_neutral_focus_title', 'Проверь сводку'),
        focusCopy: wt('s2.outcome_neutral_focus_copy', 'Данных по этой итерации меньше, чем обычно.'),
        recommendationTitle: wt('s2.outcome_neutral_rec_title', 'Открой итоги'),
        recommendationCopy: wt('s2.outcome_neutral_rec_copy', 'Если всё на месте, переходи дальше.'),
      };
    }

    if (failed === 0 && rate >= 95) {
      return {
        tone: "success",
        status: wt('s2.outcome_clean_status', 'без ошибок'),
        summary: wt('s2.outcome_clean_summary_perfect', 'Все задания этой итерации решены верно.'),
        focusLabel: wt('s2.outcome_clean_focus_label', 'Чисто'),
        focusTitle: wt('s2.outcome_clean_focus_title', 'Ошибок нет'),
        focusCopy: wt('s2.outcome_clean_focus_copy', 'Ничего критичного учитывать не нужно.'),
        recommendationTitle: wt('s2.outcome_clean_rec_title_perfect', 'Следующая итерация готова'),
        recommendationCopy: wt('s2.outcome_clean_rec_copy_perfect', 'Можно сразу переходить дальше.'),
      };
    }

    if (failed === 0) {
      return {
        tone: "success",
        status: wt('s2.outcome_clean_status', 'без ошибок'),
        summary: wt('s2.outcome_clean_summary', 'Итерация пройдена без ошибок.'),
        focusLabel: wt('s2.outcome_clean_focus_label', 'Чисто'),
        focusTitle: wt('s2.outcome_clean_focus_title', 'Ошибок нет'),
        focusCopy: wt('s2.outcome_clean_focus_copy', 'Ничего критичного учитывать не нужно.'),
        recommendationTitle: wt('s2.outcome_clean_rec_title', 'Можно идти дальше'),
        recommendationCopy: wt('s2.outcome_clean_rec_copy', 'Ничего дополнительно разбирать не нужно.'),
      };
    }

    if (failed === 1 && rate >= 80) {
      return {
        tone: "error",
        status: wt('s2.outcome_one_error_status', '1 ошибка'),
        summary: wt('s2.outcome_one_error_summary', 'В целом хорошо, осталась одна точная правка.'),
        focusLabel: wt('s2.outcome_error_focus_label', 'Критично'),
        focusTitle: wt('s2.outcome_one_error_focus_title', 'Есть 1 ошибка'),
        focusCopy: firstFailed
          ? wt('s2.outcome_one_error_focus_copy_named', 'Перед следующим раундом вернись к заданию «{name}».').replace('{name}', firstFailed.name)
          : wt('s2.outcome_one_error_focus_copy', 'Перед следующим раундом стоит коротко разобрать ошибку.'),
        recommendationTitle: wt('s2.outcome_one_error_rec_title', 'Разбери ошибку и переходи дальше'),
        recommendationCopy: wt('s2.outcome_one_error_rec_copy', 'Сначала посмотри ошибку выше, затем запускай следующую итерацию.'),
      };
    }

    if (rate >= 70) {
      return {
        tone: "error",
        status: formatErrorCount(failed),
        summary: wt('s2.outcome_few_errors_summary', 'Есть несколько ошибок, их стоит разобрать перед следующей попыткой.'),
        focusLabel: wt('s2.outcome_error_focus_label', 'Критично'),
        focusTitle: `${wt('s2.outcome_errors_focus_prefix', 'Есть')} ${formatErrorCount(failed)}`,
        focusCopy: wt('s2.outcome_few_errors_focus_copy', 'Лучше учесть ошибки до следующей итерации.'),
        recommendationTitle: wt('s2.outcome_few_errors_rec_title', 'Короткий разбор перед продолжением'),
        recommendationCopy: wt('s2.outcome_few_errors_rec_copy', 'Посмотри, где сбился ответ, и переходи дальше увереннее.'),
      };
    }

    return {
      tone: "error",
      status: formatErrorCount(failed),
      summary: wt('s2.outcome_many_errors_summary', 'Много ошибок: сначала лучше восстановить слабые места.'),
      focusLabel: wt('s2.outcome_error_focus_label', 'Критично'),
      focusTitle: `${wt('s2.outcome_errors_focus_prefix', 'Есть')} ${formatErrorCount(failed)}`,
      focusCopy: wt('s2.outcome_many_errors_focus_copy', 'Сейчас важнее понять ошибки, чем ускоряться.'),
      recommendationTitle: wt('s2.outcome_many_errors_rec_title', 'Начни с разбора'),
      recommendationCopy: wt('s2.outcome_many_errors_rec_copy', 'Разбери ошибки выше, затем запускай следующую попытку.'),
    };
  }

  function animateNumber(el, target, options) {
    if (!el) return;

    const numericTarget = Number(target) || 0;
    const duration = (options && options.duration) || 720;
    const prefix = (options && options.prefix) || "";
    const suffix = (options && options.suffix) || "";
    const formatter = options && typeof options.formatter === "function" ? options.formatter : null;
    const reducedMotion =
      typeof root.matchMedia === "function" &&
      root.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reducedMotion) {
      el.textContent = formatter ? formatter(numericTarget) : `${prefix}${numericTarget}${suffix}`;
      return;
    }

    const start = performance.now();

    function tick(now) {
      const progress = clamp((now - start) / duration, 0, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(numericTarget * eased);
      el.textContent = formatter ? formatter(current) : `${prefix}${current}${suffix}`;
      if (progress < 1) {
        root.requestAnimationFrame(tick);
      }
    }

    root.requestAnimationFrame(tick);
  }

  function createSvgNode(name) {
    return document.createElementNS("http://www.w3.org/2000/svg", name);
  }

  function polarToCartesian(centerX, centerY, radius, angleInDegrees) {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  }

  function describeArc(x, y, radius, startAngle, endAngle) {
    const start = polarToCartesian(x, y, radius, endAngle);
    const end = polarToCartesian(x, y, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
  }

  function arcColor(tone) {
    return "var(--color-success)";
  }

  function syncArc(percent, tone) {
    const container = getById("hero-arc");
    if (!container) return;

    const size = 84;
    const stroke = 12;
    const radius = 31;
    const startAngle = -220;
    const endAngle = 40;
    const totalAngle = endAngle - startAngle;
    const clampedPercent = clamp(Number(percent) || 0, 0, 100);
    const progressAngle = startAngle + (totalAngle * clampedPercent) / 100;
    const reducedMotion =
      typeof root.matchMedia === "function" &&
      root.matchMedia("(prefers-reduced-motion: reduce)").matches;

    container.innerHTML = "";
    container.style.setProperty("--s2-arc-color", arcColor(tone));

    const svg = createSvgNode("svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);

    const track = createSvgNode("path");
    track.setAttribute("d", describeArc(size / 2, size / 2, radius, startAngle, endAngle));
    track.classList.add("s2-hero-arc-track");

    const value = createSvgNode("path");
    value.setAttribute("d", describeArc(size / 2, size / 2, radius, startAngle, endAngle));
    value.classList.add("s2-hero-arc-value");
    const length = value.getTotalLength();
    const offset = length - (clampedPercent / 100) * length;
    value.style.strokeDasharray = String(length);
    value.style.strokeDashoffset = String(length);
    if (reducedMotion) {
      value.style.transition = "none";
    }

    svg.appendChild(track);
    svg.appendChild(value);

    const marker = createSvgNode("circle");
    const markerPoint = polarToCartesian(size / 2, size / 2, radius, progressAngle);
    marker.setAttribute("cx", String(markerPoint.x));
    marker.setAttribute("cy", String(markerPoint.y));
    marker.setAttribute("r", "4");
    marker.setAttribute("fill", "var(--s2-arc-color)");
    marker.style.opacity = clampedPercent > 0 ? "1" : "0";
    svg.appendChild(marker);

    container.appendChild(svg);

    root.requestAnimationFrame(function () {
      value.style.strokeDashoffset = String(offset);
    });
  }

  function updateProgressBars(summary) {
    const total = Math.max(1, summary.total || 0);
    const successWidth = `${(summary.success / total) * 100}%`;
    const failedWidth = `${(summary.failed / total) * 100}%`;

    const successBar = getById("progress-success-bar");
    const failedBar = getById("progress-failed-bar");
    const detailsSuccessBar = getById("details-success-bar");
    const detailsFailedBar = getById("details-failed-bar");

    if (successBar) successBar.style.width = successWidth;
    if (failedBar) failedBar.style.width = failedWidth;
    if (detailsSuccessBar) detailsSuccessBar.style.width = successWidth;
    if (detailsFailedBar) detailsFailedBar.style.width = failedWidth;
  }

  function syncLayoutState(summary) {
    const shell = document.querySelector(".s2-page-shell");
    const main = getById("s2-main");
    const hasErrors = !!(summary && summary.failed > 0);
    const reviewExpanded = hasErrors && state.reviewExpanded;
    const balancedLayout = !!(summary && summary.failed === 0);

    if (shell) {
      shell.classList.toggle("is-review-open", reviewExpanded);
    }
    if (main) {
      main.classList.toggle("s2-main--balanced", balancedLayout);
    }
  }

  function ensureLegacyDifficultyStat() {
    const metaStrip = document.querySelector(".s2-meta-strip");
    if (!metaStrip || typeof document === "undefined") return null;

    let statEl = getById("stat-difficulty");
    let wrapper = statEl ? statEl.closest(".s2-meta-inline") : null;

    if (!statEl) {
      wrapper = document.createElement("span");
      wrapper.className = "s2-meta-inline";
      const label = document.createElement("span");
      label.className = "s2-meta-pill-label";
      label.textContent = wt('s2.meta_difficulty', 'Сложность');
      statEl = document.createElement("strong");
      statEl.id = "stat-difficulty";
      statEl.textContent = "—";
      wrapper.appendChild(label);
      wrapper.appendChild(statEl);
    }

    if (wrapper && !metaStrip.contains(wrapper)) {
      const timeEl = getById("stat-iteration-time");
      const timeWrapper = timeEl ? timeEl.closest(".s2-meta-inline") : null;
      if (timeWrapper && timeWrapper.parentElement === metaStrip) {
        metaStrip.insertBefore(wrapper, timeWrapper);
      } else {
        metaStrip.appendChild(wrapper);
      }
    }

    return statEl;
  }

  function renderSummary(summary) {
    const outcome = deriveOutcome(summary);
    const failedChip = getById("hero-failed-chip");
    const reviewPanel = getById("result-review-panel");
    const showReviewPanel = true;

    setText("complex-name", summary.complexName);
    setText("iteration-number-label", summary.iteration);
    setText("hero-summary", outcome.summary);
    setText("stat-total-tasks", summary.total);
    setText("stat-total-tasks-main", summary.total);
    setText("stat-failed-tasks", summary.failed);
    ensureLegacyDifficultyStat();
    setText("stat-difficulty", Math.round(summary.difficulty || 0) || 0);
    setText("stat-iteration-time", formatDuration(summary.durationSeconds));
    const triggerTasksEl = getById("trigger-tasks-list");
    if (triggerTasksEl && !String(triggerTasksEl.textContent || "").trim()) {
      setText(
        "trigger-tasks-list",
        expandReviewTasks(summary.failedTasks || [])
          .map(function (task) {
            return task && task.name ? task.name : "";
          })
          .filter(Boolean)
          .join(", ")
      );
    }

    animateNumber(getById("stat-success-rate"), summary.ratePercent, { suffix: "%" });
    animateNumber(getById("hero-success-count"), summary.success);
    if (failedChip) {
      failedChip.classList.toggle("s2-count-chip--error", summary.failed > 0);
      failedChip.classList.toggle("s2-count-chip--calm", summary.failed === 0);
      failedChip.innerHTML = `<strong id="hero-failed-count">${summary.failed}</strong> ${formatPlural(summary.failed, wt('s2.error_one', 'ошибка'), wt('s2.error_few', 'ошибки'), wt('s2.error_many', 'ошибок'))}`;
      animateNumber(getById("hero-failed-count"), summary.failed);
    }
    syncArc(summary.ratePercent, outcome.tone);
    updateProgressBars(summary);

    if (!showReviewPanel) {
      state.reviewExpanded = false;
    }
    if (reviewPanel) {
      reviewPanel.setAttribute("data-tone", summary.failed > 0 ? outcome.tone : "success");
    }
    setHidden("result-review-panel", !showReviewPanel);
    setHidden("result-review-copy", summary.failed === 0);
    const reviewEyebrow = document.querySelector("#result-review-panel .s2-eyebrow");
    if (reviewEyebrow) {
      reviewEyebrow.textContent = summary.failed === 0 ? wt('s2.eyebrow_iteration_result', 'Итог итерации') : wt('s2.eyebrow_review', 'Разбор ошибок');
    }
    setText(
      "result-review-title",
      summary.failed === 0
        ? wt('s2.review_title_clean', 'Чистая итерация')
        : summary.failed === 1
          ? wt('s2.review_title_one_error', '1 ошибка требует короткого разбора')
          : `${formatErrorCount(summary.failed)} ${wt('s2.review_title_n_errors_suffix', 'требуют короткого разбора')}`
    );
    setText(
      "result-review-copy",
      summary.failed > 0
        ? wt('s2.review_copy', 'Показываем твое решение рядом с референсом, чтобы быстро понять, что поправить перед следующей итерацией.')
        : ""
    );
    setText("recommendation-title", outcome.recommendationTitle);
    setText("recommendation-copy", outcome.recommendationCopy);
    renderReviewInline(summary);
    syncLayoutState(summary);
  }

  function renderDetailsDialog(summary) {
    const outcome = deriveOutcome(summary);
    const errorsContainer = getById("details-errors");
    const reviewTasks = expandReviewTasks(summary.failedTasks || []);

    setText("details-dialog-subtitle", `${summary.ratePercent}% — ${outcome.status}`);
    setText("details-rate", `${summary.ratePercent}%`);
    setText("details-success", `${summary.success}`);
    setText("details-failed", `${summary.failed}`);
    setText("details-time", formatDuration(summary.durationSeconds));

    if (!errorsContainer) return;
    errorsContainer.innerHTML = "";

    if (!reviewTasks.length) {
      const card = document.createElement("div");
      card.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = wt('s2.all_tasks_accepted', 'Все задания приняты');

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = wt('s2.no_errors_in_iteration', 'В этой итерации ошибок не было.');

      card.appendChild(title);
      card.appendChild(copy);
      errorsContainer.appendChild(card);
      return;
    }

    reviewTasks.forEach(function (task) {
      const card = document.createElement("div");
      card.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = task.name;

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = task.explanation
        ? compactText(task.explanation, 180)
        : wt('s2.task_error_hint', 'Есть ошибка, к которой стоит вернуться перед следующим раундом.');

      card.appendChild(title);
      card.appendChild(copy);
      errorsContainer.appendChild(card);
    });
  }

  function filterReviewLinesForDisplay(lines, items) {
    const safeLines = Array.isArray(lines) ? lines.filter(Boolean) : [];
    const hasImageItems = Array.isArray(items) && items.some(function (item) {
      return item && item.imageUrl;
    });
    if (!hasImageItems) return safeLines;
    return safeLines.filter(function (line) {
      return !isGenericOptionLabel(line);
    });
  }

  function openSharedReviewImageLightbox(imgSrc, caption) {
    if (!imgSrc) return;

    const sharedLightbox =
      root.OpenAnswerUIImageLightbox &&
      typeof root.OpenAnswerUIImageLightbox.open === "function"
        ? root.OpenAnswerUIImageLightbox
        : null;

    if (sharedLightbox) {
      sharedLightbox.open(imgSrc, caption);
      return;
    }

    openImagePreview(imgSrc, caption);
  }

  function createReviewImageZoomButton(onClick) {
    const zoomBtn = document.createElement("button");
    zoomBtn.type = "button";
    zoomBtn.className = "s2-review-media-zoom";
    zoomBtn.style.position = "absolute";
    zoomBtn.style.right = "10px";
    zoomBtn.style.bottom = "10px";
    zoomBtn.style.zIndex = "1";
    zoomBtn.style.display = "inline-flex";
    zoomBtn.style.height = "42px";
    zoomBtn.style.width = "42px";
    zoomBtn.style.alignItems = "center";
    zoomBtn.style.justifyContent = "center";
    zoomBtn.style.padding = "8px";
    zoomBtn.style.borderRadius = "14px";
    zoomBtn.style.background = "rgba(15, 23, 42, 0.38)";
    zoomBtn.style.border = "1px solid rgba(255, 255, 255, 0.22)";
    zoomBtn.style.outline = "1px solid rgba(255, 255, 255, 0.08)";
    zoomBtn.style.outlineOffset = "0";
    zoomBtn.style.backdropFilter = "blur(6px)";
    zoomBtn.style.WebkitBackdropFilter = "blur(6px)";
    zoomBtn.style.boxShadow = "0 8px 18px rgba(15, 23, 42, 0.16)";
    zoomBtn.style.color = "var(--color-text-on-dark, #f8fafc)";
    zoomBtn.style.cursor = "pointer";
    zoomBtn.style.transition = "transform 0.16s ease";
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

    zoomBtn.addEventListener("mouseenter", function () {
      zoomBtn.style.transform = "scale(1.03)";
    });
    zoomBtn.addEventListener("mouseleave", function () {
      zoomBtn.style.transform = "";
    });
    zoomBtn.addEventListener("focus", function () {
      zoomBtn.style.transform = "scale(1.03)";
    });
    zoomBtn.addEventListener("blur", function () {
      zoomBtn.style.transform = "";
    });
    zoomBtn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (typeof onClick === "function") {
        onClick();
      }
    });

    return zoomBtn;
  }

  function createReviewMediaItem(item) {
    const card = document.createElement("article");
    card.className = item && item.imageUrl
      ? "s2-review-media-card s2-review-media-card--image"
      : "s2-review-media-card s2-review-media-card--text";

    const titleTextRaw = item && item.text ? String(item.text).trim() : "";
    const fallbackText = item && item.fallbackLabel ? String(item.fallbackLabel).trim() : "";
    const titleText = item && item.imageUrl && isGenericOptionLabel(titleTextRaw)
      ? ""
      : titleTextRaw || (!item || item.imageUrl ? "" : fallbackText);

    if (item && item.imageUrl) {
      const thumb = document.createElement("div");
      thumb.className = "s2-review-media-thumb";
      thumb.setAttribute("role", "button");
      thumb.tabIndex = 0;
      thumb.setAttribute("aria-label", titleText || fallbackText || wt('s2.image_open_label', 'Open image'));

      const image = document.createElement("img");
      image.className = "s2-review-media-image";
      image.src = item.imageUrl;
      image.alt = titleText || fallbackText || wt('s2.image_answer_alt', 'Answer option');
      thumb.appendChild(image);

      const openPreview = function () {
        openSharedReviewImageLightbox(item.imageUrl, image.alt);
      };

      thumb.addEventListener("click", function () {
        openPreview();
      });
      thumb.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        openPreview();
      });
      thumb.appendChild(createReviewImageZoomButton(openPreview));

      card.appendChild(thumb);
    }

    if (titleText) {
      const caption = document.createElement("p");
      caption.className = "s2-review-media-caption";
      caption.textContent = titleText;
      card.appendChild(caption);
    }

    return card;
  }

  function ensureImagePreview() {
    let backdrop = getById("image-preview-backdrop");
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = "image-preview-backdrop";
    backdrop.className = "s2-dialog-backdrop s2-image-preview hidden";
    backdrop.setAttribute("aria-hidden", "true");

    const panel = document.createElement("section");
    panel.className = "s2-image-preview-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "image-preview-title");

    const head = document.createElement("div");
    head.className = "s2-image-preview-head";

    const title = document.createElement("p");
    title.id = "image-preview-title";
    title.className = "s2-image-preview-title";
    title.textContent = wt('s2.image_preview_title', 'Image preview');

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.id = "image-preview-close-btn";
    closeBtn.className = "s2-dialog-close";
    closeBtn.setAttribute("aria-label", wt('s2.image_preview_close', 'Close preview'));
    closeBtn.textContent = "\u00D7";

    const body = document.createElement("div");
    body.className = "s2-image-preview-body";

    const image = document.createElement("img");
    image.id = "image-preview-image";
    image.className = "s2-image-preview-image";
    image.alt = "";

    body.appendChild(image);
    head.appendChild(title);
    head.appendChild(closeBtn);
    panel.appendChild(head);
    panel.appendChild(body);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);

    backdrop.addEventListener("click", function (event) {
      if (event.target === backdrop) {
        closeImagePreview();
      }
    });

    closeBtn.addEventListener("click", function () {
      closeImagePreview();
    });

    return backdrop;
  }

  function openImagePreview(src, alt) {
    if (!src) return;
    ensureImagePreview();
    const image = getById("image-preview-image");
    const title = getById("image-preview-title");
    if (image) {
      image.src = src;
      image.alt = alt || wt('s2.image_alt_fallback', 'Answer image');
    }
    if (title) {
      title.textContent = alt || wt('s2.image_preview_title', 'Image preview');
    }
    state.imagePreviewOpen = true;
    setHidden("image-preview-backdrop", false);
  }

  function closeImagePreview() {
    const backdrop = getById("image-preview-backdrop");
    const image = getById("image-preview-image");
    state.imagePreviewOpen = false;
    if (!backdrop) return;
    setHidden(backdrop, true);
    if (image) {
      image.removeAttribute("src");
    }
  }

  function appendReviewAnswerContent(card, label, lines, items, toneClass) {
    const answerCard = document.createElement("div");
    answerCard.className = `s2-review-answer ${toneClass}`;

    const answerLabel = document.createElement("p");
    answerLabel.className = "s2-review-answer-label";
    answerLabel.textContent = label;
    answerCard.appendChild(answerLabel);

    const safeItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (safeItems.length) {
      const mediaGrid = document.createElement("div");
      mediaGrid.className = "s2-review-media-grid";
      safeItems.forEach(function (item) {
        mediaGrid.appendChild(createReviewMediaItem(item));
      });
      answerCard.appendChild(mediaGrid);
    }

    filterReviewLinesForDisplay(lines, safeItems).forEach(function (line) {
      const answerCopy = document.createElement("p");
      answerCopy.className = "s2-review-answer-copy";
      answerCopy.textContent = line;
      answerCard.appendChild(answerCopy);
    });

    card.appendChild(answerCard);
  }

  function createReviewEmptyState() {
    const empty = document.createElement("div");
    empty.className = "s2-review-empty";

    const hero = document.createElement("div");
    hero.className = "s2-review-empty-hero";

    const icon = document.createElement("span");
    icon.className = "material-symbols-outlined s2-review-empty-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "task_alt";

    const badge = document.createElement("div");
    badge.className = "s2-review-empty-badge";
    badge.textContent = wt('s2.no_errors_badge', 'Без ошибок');

    const title = document.createElement("p");
    title.className = "s2-review-empty-title";
    title.textContent = wt('s2.all_answers_accepted', 'Все ответы приняты');

    const rail = document.createElement("div");
    rail.className = "s2-review-empty-rail";

    const railFill = document.createElement("span");
    railFill.className = "s2-review-empty-rail-fill";
    rail.appendChild(railFill);

    const copy = document.createElement("p");
    copy.className = "s2-review-empty-copy";
    copy.textContent = wt('s2.clean_pass_copy', 'Точный проход без замечаний. Разбор ошибок не нужен.');

    hero.appendChild(icon);
    hero.appendChild(badge);
    empty.appendChild(hero);
    empty.appendChild(title);
    empty.appendChild(rail);
    empty.appendChild(copy);
    return empty;
  }

  function renderReviewInline(summary) {
    const container = getById("review-inline");
    const reviewBtn = getById("review-btn");
    if (!container) return;

    const reviewTasks = expandReviewTasks(summary.failedTasks || []);

    if (reviewBtn) {
      reviewBtn.textContent = state.reviewExpanded
        ? wt('s2.review_btn_collapse', 'Свернуть разбор')
        : reviewTasks.length > 1
          ? wt('s2.review_btn_show_n', 'Показать {n} ошибки').replace('{n}', reviewTasks.length)
          : reviewTasks.length === 1
            ? wt('s2.review_btn_show_one', 'Показать 1 ошибку')
            : wt('s2.review_btn_none', 'Разбор не нужен');
      reviewBtn.setAttribute("aria-expanded", state.reviewExpanded && summary.failed > 0 ? "true" : "false");
      setHidden(reviewBtn, summary.failed === 0);
    }

    setHidden(container, false);
    container.classList.toggle("is-open", summary.failed === 0 || state.reviewExpanded);
    container.setAttribute("aria-hidden", summary.failed > 0 && !state.reviewExpanded ? "true" : "false");

    if (summary.failed > 0 && !state.reviewExpanded && container.childElementCount > 0) {
      syncLayoutState(summary);
      return;
    }

    container.innerHTML = "";
    if (summary.failed === 0) {
      container.appendChild(createReviewEmptyState());
      syncLayoutState(summary);
      return;
    }

    reviewTasks.forEach(function (task) {
      const card = document.createElement("div");
      card.className = "s2-inline-review-card";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = task.review && task.review.title ? task.review.title : task.name;
      card.appendChild(title);

      const fullTestEntries = task.review && task.review.kind === "full_test" && Array.isArray(task.review.entries)
        ? task.review.entries.filter(hasNormalizedReviewContent)
        : [];
      if (fullTestEntries.length) {
        fullTestEntries.forEach(function (entry) {
          const section = document.createElement("section");
          section.className = "s2-review-full-test-entry";
          appendInlineReviewContent(section, entry);
          card.appendChild(section);
        });
        container.appendChild(card);
        return;
      }

      const question = document.createElement("p");
      question.className = "s2-review-question";
      question.textContent = task.review && task.review.prompt ? task.review.prompt : task.prompt || task.name;
      card.appendChild(question);

      if (task.review && task.review.note) {
        const note = document.createElement("p");
        note.className = "s2-review-note";
        note.textContent = task.review.note;
        card.appendChild(note);
      }

      appendReviewAnswerContent(
        card,
        task.review && task.review.userLabel ? task.review.userLabel : wt('s2.user_label', 'Твоё решение'),
        task.review && Array.isArray(task.review.userLines) ? task.review.userLines : [],
        task.review && Array.isArray(task.review.userItems) ? task.review.userItems : [],
        "s2-review-answer--error"
      );

      appendReviewAnswerContent(
        card,
        task.review && task.review.referenceLabel ? task.review.referenceLabel : wt('s2.reference_label', 'Референс'),
        task.review && Array.isArray(task.review.referenceLines) ? task.review.referenceLines : [],
        task.review && Array.isArray(task.review.referenceItems) ? task.review.referenceItems : [],
        "s2-review-answer--success"
      );

      container.appendChild(card);
    });

    syncLayoutState(summary);
  }

  function renderReviewDialog(summary) {
    const dialogTitle = getById("review-dialog-title");
    const subtitle = getById("review-dialog-subtitle");
    const body = getById("review-dialog-body");
    const reviewTasks = expandReviewTasks(summary.failedTasks || []);
    if (!subtitle || !body) return;
    if (dialogTitle) {
      dialogTitle.textContent = reviewTasks.length === 1
        ? reviewTasks[0].name
        : wt('s2.review_dialog_title', 'Что учесть перед следующим раундом');
    }
    subtitle.textContent = summary.failed
      ? wt('s2.review_subtitle_errors', 'Короткий снимок ошибки перед следующей итерацией.')
      : wt('s2.review_subtitle_no_errors', 'Критичных замечаний нет.');
    body.innerHTML = "";

    if (!summary.failedTasks.length) {
      const item = document.createElement("div");
      item.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = wt('s2.all_tasks_accepted', 'Все задания приняты');

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = wt('s2.can_continue', 'Можно переходить дальше.');

      item.appendChild(title);
      item.appendChild(copy);
      body.appendChild(item);
      return;
    }

    summary.failedTasks.forEach(function (task) {
      const item = document.createElement("div");
      item.className = "s2-dialog-item s2-review-card";

      if (reviewTasks.length > 1) {
        const title = document.createElement("p");
        title.className = "s2-dialog-item-title";
        title.textContent = task.name;
        item.appendChild(title);
      }

      const question = document.createElement("p");
      question.className = "s2-review-question";
      question.textContent = task.prompt || wt('s2.prompt_not_available', 'Формулировка задания появится в полном разборе.');
      item.appendChild(question);

      const note = document.createElement("p");
      note.className = "s2-review-note";
      note.textContent = task.explanation
        ? compactText(task.explanation, 220)
        : wt('s2.error_note_fallback', 'Ошибка точечная: достаточно быстро свериться с ответом и идти дальше.');
      item.appendChild(note);

      const answers = document.createElement("div");
      answers.className = "s2-review-answers";

      const userAnswerCard = document.createElement("div");
      userAnswerCard.className = "s2-review-answer s2-review-answer--error";

      const userAnswerLabel = document.createElement("p");
      userAnswerLabel.className = "s2-review-answer-label";
      userAnswerLabel.textContent = wt('s2.your_answer_label', 'Твой ответ');

      const userAnswerCopy = document.createElement("p");
      userAnswerCopy.className = "s2-review-answer-copy";
      userAnswerCopy.textContent = task.userAnswer || wt('s2.answer_not_recorded', 'Ответ не был зафиксирован.');

      userAnswerCard.appendChild(userAnswerLabel);
      userAnswerCard.appendChild(userAnswerCopy);
      answers.appendChild(userAnswerCard);

      const correctAnswerCard = document.createElement("div");
      correctAnswerCard.className = "s2-review-answer s2-review-answer--success";

      const correctAnswerLabel = document.createElement("p");
      correctAnswerLabel.className = "s2-review-answer-label";
      correctAnswerLabel.textContent = wt('s2.correct_answer_label', 'Правильный ответ');

      const correctAnswerCopy = document.createElement("p");
      correctAnswerCopy.className = "s2-review-answer-copy";
      correctAnswerCopy.textContent = task.correctAnswer || wt('s2.correct_answer_not_available', 'Появится в полном разборе.');

      correctAnswerCard.appendChild(correctAnswerLabel);
      correctAnswerCard.appendChild(correctAnswerCopy);
      answers.appendChild(correctAnswerCard);

      item.appendChild(answers);
      body.appendChild(item);
    });
    return;

    subtitle.textContent = summary.failed
      ? `Ниже только то, что стоит учесть перед продолжением.`
      : "Критичных замечаний нет.";
    body.innerHTML = "";

    if (!summary.failedTasks.length) {
      const item = document.createElement("div");
      item.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = "Все задания приняты";

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = "Можно переходить дальше.";

      item.appendChild(title);
      item.appendChild(copy);
      body.appendChild(item);
      return;
    }

    summary.failedTasks.forEach(function (task) {
      const item = document.createElement("div");
      item.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = task.name;

      if (task.explanation) {
        const copy = document.createElement("p");
        copy.className = "s2-dialog-item-copy";
        copy.textContent = compactText(task.explanation, 220);
        item.appendChild(copy);
      }

      if (task.userAnswer) {
        const copy = document.createElement("p");
        copy.className = "s2-dialog-item-copy";
        const label = document.createElement("strong");
        label.textContent = "Твой ответ: ";
        copy.appendChild(label);
        copy.appendChild(document.createTextNode(compactText(task.userAnswer, 140)));
        item.appendChild(copy);
      }

      if (task.correctAnswer) {
        const copy = document.createElement("p");
        copy.className = "s2-dialog-item-copy";
        const label = document.createElement("strong");
        label.textContent = "Верный ответ: ";
        copy.appendChild(label);
        copy.appendChild(document.createTextNode(compactText(task.correctAnswer, 140)));
        item.appendChild(copy);
      }

      item.prepend(title);
      body.appendChild(item);
    });
  }

  function openDialog(kind) {
    if (kind === "details") {
      state.detailsOpen = true;
      setHidden("details-dialog-backdrop", false);
      return;
    }
    if (kind === "review") {
      state.reviewOpen = true;
      setHidden("review-dialog-backdrop", false);
      return;
    }
    if (kind === "problem") {
      state.problemOpen = true;
      setHidden("problem-dialog-backdrop", false);
    }
  }

  function closeDialog(kind) {
    if (kind === "details") {
      state.detailsOpen = false;
      setHidden("details-dialog-backdrop", true);
      return;
    }
    if (kind === "review") {
      state.reviewOpen = false;
      setHidden("review-dialog-backdrop", true);
      return;
    }
    if (kind === "problem") {
      state.problemOpen = false;
      setHidden("problem-dialog-backdrop", true);
    }
  }

  function closeMenu() {
    state.menuOpen = false;
    setHidden("toolbar-menu-panel", true);
    const btn = getById("toolbar-menu-btn");
    if (btn) btn.setAttribute("aria-expanded", "false");
  }

  function toggleMenu() {
    state.menuOpen = !state.menuOpen;
    setHidden("toolbar-menu-panel", !state.menuOpen);
    const btn = getById("toolbar-menu-btn");
    if (btn) btn.setAttribute("aria-expanded", state.menuOpen ? "true" : "false");
  }

  function handleContinue() {
    if (!state.sessionId) return;

    if (state.hasNextIteration) {
      navigateTo(`/session/${encodeURIComponent(state.sessionId)}`);
      return;
    }

    navigateTo(`/session/${encodeURIComponent(state.sessionId)}/results`);
  }

  function navigateTo(url) {
    if (!url) return;
    if (typeof root.navigateWithTransition === "function") {
      root.navigateWithTransition(url);
      return;
    }
    root.location.href = url;
  }

  function showToast(message, variant, duration) {
    if (root.NotificationUI && typeof root.NotificationUI.toast === "function") {
      root.NotificationUI.toast(message, variant || "info", duration || 3200);
    }
  }

  function showConfirm(options) {
    if (root.NotificationUI && typeof root.NotificationUI.confirm === "function") {
      return root.NotificationUI.confirm(options || {});
    }
    return Promise.resolve(root.confirm(String((options && options.message) || "")));
  }

  async function resolveCurrentUserId(forceRefresh) {
    if (!forceRefresh && state.currentUserId) {
      return state.currentUserId;
    }
    if (!forceRefresh && state.currentUserPromise) {
      return state.currentUserPromise;
    }

    state.currentUserPromise = (async function () {
      try {
        const response = await root.fetch("/api/users/current", { credentials: "same-origin" });
        const payload = await response.json().catch(function () {
          return {};
        });
        const userId = String((payload && payload.user && payload.user.user_id) || "").trim();
        state.currentUserId = userId || null;
        return state.currentUserId;
      } catch (_) {
        return state.currentUserId;
      } finally {
        state.currentUserPromise = null;
      }
    })();

    return state.currentUserPromise;
  }

  async function pauseAndReturnToComplexes() {
    if (!state.sessionId) {
      navigateTo("/complexes");
      return;
    }

    try {
      const userId = await resolveCurrentUserId(false);
      const resumeTarget =
        state.sessionId && state.iteration != null
          ? {
              screen_type: "iteration_results",
              iteration_number: state.iteration,
              url: `/session/${encodeURIComponent(state.sessionId)}/iteration/${encodeURIComponent(String(state.iteration))}`,
            }
          : null;
      const response = await root.fetch(`/api/session/${encodeURIComponent(state.sessionId)}/pause`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          userId
            ? (resumeTarget ? { user_id: userId, resume_target: resumeTarget } : { user_id: userId })
            : (resumeTarget ? { resume_target: resumeTarget } : {})
        ),
      });

      if (!response.ok) {
        showToast(wt('s2.pause_failed', 'Не удалось поставить сессию на паузу.'), "error");
        return;
      }

      navigateTo("/complexes");
    } catch (_) {
      showToast(wt('s2.pause_failed', 'Не удалось поставить сессию на паузу.'), "error");
    }
  }

  async function cancelComplex() {
    if (!state.sessionId) return;

    const confirmed = await showConfirm({
      title: wt('s2.cancel_title', 'Завершить комплекс?'),
      message: wt('s2.cancel_message', 'Сессия закроется, а комплекс завершится досрочно. Продолжить?'),
      confirmText: wt('s2.cancel_confirm', 'Завершить'),
      cancelText: wt('s2.cancel_cancel', 'Отмена'),
      variant: "error",
    });

    if (!confirmed) return;

    try {
      const userId = await resolveCurrentUserId(false);
      const response = await root.fetch(`/api/session/${encodeURIComponent(state.sessionId)}/cancel`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(userId ? { user_id: userId } : {}),
      });

      const payload = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || (payload && payload.ok === false)) {
        showToast(wt('s2.cancel_failed', 'Не удалось завершить комплекс.'), "error");
        return;
      }

      navigateTo("/complexes");
    } catch (_) {
      showToast(wt('s2.cancel_failed', 'Не удалось завершить комплекс.'), "error");
    }
  }

  function renderIterationResults(data) {
    const rawFailedTaskNames = (Array.isArray(data && data.iteration_results) ? data.iteration_results : [])
      .filter(function (task) {
        return !(task && task.success);
      })
      .map(function (task, index) {
        const source = isObject(task) ? task : {};
        const review = isObject(source.review) ? source.review : {};
        const details = isObject(source.details) ? source.details : {};
        const meta = isObject(source.meta) ? source.meta : {};
        return humanLabel(
          source.task_name ||
            source.taskName ||
            review.title ||
            meta.name ||
            meta.title ||
            source.name ||
            source.title ||
            details.name ||
            details.title,
          wt('s2.task_number', 'Задание {n}').replace('{n}', index + 1),
          96
        );
      })
      .filter(Boolean)
      .join(", ");
    if (rawFailedTaskNames) {
      setText("trigger-tasks-list", rawFailedTaskNames);
    }

    const summary = normalizeIterationResults(data);
    state.sessionId = summary.sessionId || state.sessionId;
    state.iteration = summary.iteration;
    state.hasNextIteration = summary.hasNextIteration;
    state.reviewExpanded = false;
    state.latestSummary = summary;

    renderSummary(summary);
    renderDetailsDialog(summary);
    renderReviewDialog(summary);
    renderProblemPreview(summary);
    updateIterationNextStepGuidance();
    if (
      state.sessionId &&
      (!rawFailedTaskNames || /^Задание \d+(,\s*Задание \d+)*$/.test(rawFailedTaskNames))
    ) {
      const query = new URLSearchParams();
      if (summary.iteration) {
        query.set("iteration", String(summary.iteration));
      }
      const requestUrl = `/api/session/${encodeURIComponent(state.sessionId)}/iteration-results${query.toString() ? `?${query.toString()}` : ""}`;
      root.fetch(requestUrl, { credentials: "same-origin" })
        .then(function (response) {
          return response.json().catch(function () {
            return null;
          });
        })
        .then(function (payload) {
          if (payload && payload.ok) {
            const enrichedSummary = normalizeIterationResults(payload.results || payload);
            state.latestSummary = enrichedSummary;
            renderProblemPreview(enrichedSummary);
          }
        })
        .catch(function () {});
    }

    const continueLabel = summary.hasNextIteration ? wt('s2.continue_btn_label', 'К следующей итерации') : wt('s2.finish_btn_label', 'К итогам комплекса');
    if (state.sessionId) {
      const legacyQuery = new URLSearchParams();
      if (summary.iteration) {
        legacyQuery.set("iteration", String(summary.iteration));
      }
      const legacyRequestUrl = `/api/session/${encodeURIComponent(state.sessionId)}/iteration-results${legacyQuery.toString() ? `?${legacyQuery.toString()}` : ""}`;
      root.fetch(legacyRequestUrl, { credentials: "same-origin" })
        .then(function (response) {
          return response.json().catch(function () {
            return null;
          });
        })
        .then(function (payload) {
          if (payload && payload.ok) {
            const enrichedSummary = normalizeIterationResults(payload.results || payload);
            state.latestSummary = enrichedSummary;
            renderProblemPreview(enrichedSummary);
          }
        })
        .catch(function () {});
    }
    setText("continue-btn-label", continueLabel);
    const continueCard = getById("continue-btn");
    if (continueCard) {
      continueCard.setAttribute("aria-label", continueLabel);
    }
    setHidden("toolbar-menu-wrap", !summary.hasNextIteration);
    if (!summary.hasNextIteration) {
      closeMenu();
    }
  }

  async function loadIterationResults() {
    if (!state.sessionId) {
      return null;
    }

    try {
      const query = new URLSearchParams();
      if (state.iteration != null) {
        query.set("iteration", String(state.iteration));
      }
      const requestUrl = `/api/session/${encodeURIComponent(state.sessionId)}/iteration-results${query.toString() ? `?${query.toString()}` : ""}`;
      const response = await root.fetch(requestUrl, { credentials: "same-origin" });
      const payload = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || !payload || payload.ok === false || !isObject(payload.results)) {
        showToast(wt('s2.load_failed', 'Не удалось загрузить результаты итерации.'), "error");
        return null;
      }

      renderIterationResults(payload.results);
      return payload.results;
    } catch (_) {
      showToast(wt('s2.load_failed', 'Не удалось загрузить результаты итерации.'), "error");
      return null;
    }
  }

  function getSessionAndIterationFromLocation() {
    const pathname = String((root.location && root.location.pathname) || "");
    const match = pathname.match(/\/(?:ui\/)?session\/([^/]+)\/iteration\/([^/?#]+)/i);
    if (!match) {
      return { sessionId: null, iteration: null };
    }
    return {
      sessionId: decodeURIComponent(match[1]),
      iteration: toNumberOrNull(decodeURIComponent(match[2])),
    };
  }

  function bindStaticEventHandlers() {
    const detailsBtn = getById("details-btn");
    const continueBtn = getById("continue-btn");
    const reviewBtn = getById("review-btn");
    const pauseInlineBtn = getById("pause-btn-inline");
    const finishInlineBtn = getById("finish-complex-btn-inline");
    const menuBtn = getById("toolbar-menu-btn");
    const menuWrap = getById("toolbar-menu-wrap");
    const pauseBtn = getById("pause-btn");
    const finishBtn = getById("finish-complex-btn");
    const reviewConfirmBtn = getById("review-dialog-confirm-btn");

    if (detailsBtn) {
      detailsBtn.addEventListener("click", function () {
        closeMenu();
        openDialog("details");
      });
    }

    if (continueBtn) {
      continueBtn.addEventListener("click", function () {
        closeMenu();
        document.body.classList.remove("review-open");
        handleContinue();
      });
      continueBtn.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          closeMenu();
          document.body.classList.remove("review-open");
          handleContinue();
        }
      });
    }

    if (reviewBtn) {
      reviewBtn.addEventListener("click", function () {
        closeMenu();
        state.reviewExpanded = !state.reviewExpanded;
        document.body.classList.toggle("review-open", state.reviewExpanded);
        if (state.latestSummary) {
          renderReviewInline(state.latestSummary);
        }
        if (state.reviewExpanded) {
          setTimeout(function () {
            var inlineReview = getById("review-inline");
            if (inlineReview) {
              inlineReview.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }, 60);
        }
      });
    }

    if (menuBtn) {
      menuBtn.addEventListener("click", function (event) {
        event.stopPropagation();
        toggleMenu();
      });
    }

    if (pauseBtn) {
      pauseBtn.addEventListener("click", function () {
        closeMenu();
        pauseAndReturnToComplexes();
      });
    }

    if (pauseInlineBtn) {
      pauseInlineBtn.addEventListener("click", function () {
        closeMenu();
        pauseAndReturnToComplexes();
      });
    }

    if (finishBtn) {
      finishBtn.addEventListener("click", function () {
        closeMenu();
        cancelComplex();
      });
    }

    if (finishInlineBtn) {
      finishInlineBtn.addEventListener("click", function () {
        closeMenu();
        cancelComplex();
      });
    }

    const toComplexListBtn = getById("to-complex-list-btn");
    const openProblemDialogBtn = getById("open-problem-dialog-btn");

    if (toComplexListBtn) {
      toComplexListBtn.addEventListener("click", function () {
        closeMenu();
        pauseAndReturnToComplexes();
      });
    }

    if (openProblemDialogBtn) {
      openProblemDialogBtn.addEventListener("click", function () {
        closeMenu();
        if (state.latestSummary) {
          renderProblemDialog(state.latestSummary);
        }
        openDialog("problem");
      });
    }

    ["details", "problem"].forEach(function (kind) {
      const backdrop = getById(`${kind}-dialog-backdrop`);
      const closeBtn = getById(`${kind}-dialog-close-btn`);
      if (backdrop) {
        backdrop.addEventListener("click", function (event) {
          if (event.target === backdrop) {
            closeDialog(kind);
          }
        });
      }
      if (closeBtn) {
        closeBtn.addEventListener("click", function () {
          closeDialog(kind);
        });
      }
    });

    if (reviewConfirmBtn) {
      reviewConfirmBtn.addEventListener("click", function () {
        closeDialog("review");
      });
    }

    document.addEventListener("click", function (event) {
      if (state.menuOpen && menuWrap && !menuWrap.contains(event.target)) {
        closeMenu();
      }
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (state.imagePreviewOpen) {
          closeImagePreview();
          return;
        }
        if (state.menuOpen) {
          closeMenu();
          return;
        }
        if (state.reviewOpen) {
          closeDialog("review");
          return;
        }
        if (state.detailsOpen) {
          closeDialog("details");
          return;
        }
        if (state.problemOpen) {
          closeDialog("problem");
        }
      }
    });

  }

  function updateIterationNextStepGuidance() {
    const continueLabel = state.hasNextIteration
      ? wt('s2.continue_btn_label', 'К следующей итерации')
      : wt('s2.finish_btn_label', 'К итогам комплекса');

    const continueBtnLabel = getById("continue-btn-label");
    if (continueBtnLabel) {
      continueBtnLabel.textContent = continueLabel;
    }
    const continueBtn = getById("continue-btn");
    if (continueBtn) {
      continueBtn.setAttribute("aria-label", continueLabel);
    }

    const pauseBtnLabel = document.querySelector("#to-complex-list-btn .truncate");
    if (pauseBtnLabel) {
      pauseBtnLabel.textContent = wt('s2.pause_btn_label', 'Сделать паузу');
    }

    const hint = getById("next-step-hint");
    if (hint) {
      hint.textContent = state.hasNextIteration
        ? wt('s2.next_step_hint_iteration', 'Следующий шаг — новая итерация в этой же сессии.')
        : wt('s2.next_step_hint_finish', 'Следующий шаг — просмотр итогов комплекса.');
    }

    const pauseCard = getById("to-complex-list-btn");
    if (pauseCard) {
      setHidden("to-complex-list-btn", !state.hasNextIteration);
    }
  }

  function renderProblemPreview(summary) {
    const listEl = getById("trigger-tasks-list");
    const previewNoteEl = getById("problem-preview-note");
    const emptyStateEl = getById("problem-empty-state");
    const failedStateEl = getById("problem-failed-state");
    const openBtnEl = getById("open-problem-dialog-btn");

    if (!listEl) return;
    listEl.innerHTML = "";

    const failedTasks = summary.failedTasks || [];
    const N = failedTasks.length;

    if (N === 0) {
      if (emptyStateEl) emptyStateEl.classList.remove("hidden");
      if (failedStateEl) failedStateEl.classList.add("hidden");
      if (openBtnEl) openBtnEl.classList.add("hidden");
      if (previewNoteEl) previewNoteEl.textContent = "";
      return;
    }

    if (emptyStateEl) emptyStateEl.classList.add("hidden");
    if (failedStateEl) failedStateEl.classList.remove("hidden");
    if (openBtnEl) openBtnEl.classList.remove("hidden");

    const previewCount = Math.min(3, N);
    for (let i = 0; i < previewCount; i++) {
      const task = failedTasks[i];
      const li = document.createElement("li");
      li.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = task.name;

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = task.explanation
        ? compactText(task.explanation, 180)
        : wt('s2.task_error_hint', 'Есть ошибка, к которой стоит вернуться перед следующим раундом.');

      li.appendChild(title);
      li.appendChild(copy);
      listEl.appendChild(li);
    }

    if (previewNoteEl) {
      if (N > 3) {
        previewNoteEl.textContent = wt('s2.errors_shown_of', 'Показаны 3 из {n} ошибок').replace('{n}', N);
      } else {
        previewNoteEl.textContent = "";
      }
    }
  }

  function renderProblemDialog(summary) {
    const listEl = getById("problem-dialog-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    const failedTasks = summary.failedTasks || [];
    failedTasks.forEach(function (task) {
      const li = document.createElement("li");
      li.className = "s2-dialog-item";

      const title = document.createElement("p");
      title.className = "s2-dialog-item-title";
      title.textContent = task.name;

      const copy = document.createElement("p");
      copy.className = "s2-dialog-item-copy";
      copy.textContent = task.explanation
        ? compactText(task.explanation, 180)
        : wt('s2.task_error_hint', 'Есть ошибка, к которой стоит вернуться перед следующим раундом.');

      li.appendChild(title);
      li.appendChild(copy);

      const isToggled = Boolean(state.toggledProblems[task.key]);
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "s2-answer-toggle s2-btn s2-ghost-btn mt-2";
      toggleBtn.type = "button";
      toggleBtn.textContent = isToggled
        ? wt('s2.hide_answer', 'Скрыть')
        : wt('s2.show_answer', 'Показать');

      toggleBtn.addEventListener("click", function () {
        state.toggledProblems[task.key] = !isToggled;
        renderProblemDialog(summary);
      });
      li.appendChild(toggleBtn);

      if (isToggled) {
        const detailDiv = document.createElement("div");
        detailDiv.className = "s2-answer-detail mt-2 p-3 bg-bg-surface-neutral-subtle rounded-md border border-border-subtle";

        const correctLabel = document.createElement("strong");
        correctLabel.textContent = wt('s2.correct_answer_label', 'Правильный ответ: ');

        const correctVal = document.createElement("span");
        correctVal.textContent = task.correctAnswer || "—";

        detailDiv.appendChild(correctLabel);
        detailDiv.appendChild(correctVal);

        if (task.userAnswer) {
          const userBlock = document.createElement("div");
          userBlock.className = "mt-1 text-sm text-text-secondary";

          const userLabel = document.createElement("strong");
          userLabel.textContent = wt('s2.user_answer_label', 'Ваш ответ: ');

          const userVal = document.createElement("span");
          userVal.textContent = task.userAnswer;

          userBlock.appendChild(userLabel);
          userBlock.appendChild(userVal);
          detailDiv.appendChild(userBlock);
        }

        li.appendChild(detailDiv);
      }

      listEl.appendChild(li);
    });
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;

    const sessionInfo = getSessionAndIterationFromLocation();
    state.sessionId = sessionInfo.sessionId;
    state.iteration = sessionInfo.iteration;

    bindStaticEventHandlers();
    loadIterationResults();
  }

  root.S2Page = {
    state,
    formatDuration,
    computeDurationSecondsFromTimestamps,
    normalizeIterationResults,
    renderIterationResults,
    loadIterationResults,
    updateIterationNextStepGuidance,
    init,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}(typeof self !== "undefined" ? self : this));
