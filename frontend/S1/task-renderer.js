/**
 * Task Renderer Module
 * Handles task rendering, type determination, and result display.
 */
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        define(['./session-state', './ui-helpers', './draft-storage'], factory);
    } else if (typeof module === 'object' && module.exports) {
        module.exports = factory(require('./session-state'), require('./ui-helpers'), require('./draft-storage'));
    } else {
        root.TaskRenderer = factory(root.SessionState, root.UIHelpers, root.DraftStorage);
    }
}(typeof self !== 'undefined' ? self : this, function (SessionState, UIHelpers, DraftStorage) {
    'use strict';

    // Constants
    const VALID_TASK_TYPES = new Set([
        "click",
        "draw",
        "test",
        "sequence_assembly",
        "open_answer"
    ]);

    // Helper Functions regarding Task Type

    /**
     * Utility function to find a field in a task object by searching multiple paths
     * @param {Object} task - Task object to search in
     * @param {string[]} paths - Array of dot-notation paths to search (e.g., ['task_type', 'task_data.type'])
     * @returns {*} First non-null/undefined value found, or null
     */
    function findFieldInTask(task, paths) {
        if (!task) return null;

        for (const path of paths) {
            const value = path.split('.').reduce((obj, key) => {
                return (obj && obj[key] !== undefined) ? obj[key] : null;
            }, task);

            if (value !== null && value !== undefined) {
                return value;
            }
        }

        return null;
    }

    function getTaskSubtype(task) {
        if (!task) return null;
        const td = task.task_data || task.taskData || {};
        const content = td.content || task.content || {};
        const metadata = task.metadata || td.metadata || {};

        // 1. Check for direct subtype specification (highest priority)
        const direct = findFieldInTask(task, [
            'subtype',
            'task_data.subtype',
            'taskData.subtype',
            'task_data.content.subtype',
            'content.subtype',
            'metadata.subtype',
            'task_data.metadata.subtype'
        ]);
        if (direct) return direct;

        // 2. Get task type for type-specific inference
        const taskType = getRawTaskType(task);

        // 3. Inference for Click tasks (error_detection)
        if (taskType === "click") {
            const mode = content.mode || td.mode || task.mode;
            if (mode === "text_errors" || mode === "text_choice") return "error_detection";

            if (Array.isArray(content.error_spans) || Array.isArray(content.errorSpans)) {
                return "error_detection";
            }
        }

        // 4. Inference for Test tasks (single_choice / multiple_choice)
        if (taskType === "test") {
            // Check explicit test_type field
            const testType = content.test_type || td.test_type || content.testType;
            if (testType === "single_choice" || testType === "multiple_choice") {
                return testType;
            }

            // Fallback: infer from correct_answers count in first question
            const questions = content.questions || [];
            if (questions.length > 0) {
                const firstQ = questions[0];
                const correctAnswers = firstQ.correct_answers || firstQ.correctAnswers || [];
                if (correctAnswers.length > 1) {
                    return "multiple_choice";
                } else if (correctAnswers.length === 1) {
                    return "single_choice";
                }
            }
        }

        // 5. Inference for Draw tasks (region_segmentation)
        if (taskType === "draw") {
            const regions = content.regions || [];
            if (regions.length > 1) {
                return "region_segmentation";
            }
        }

        return null;
    }

    function getRawTaskType(task) {
        if (!task) return null;

        const type = findFieldInTask(task, [
            'task_type',
            'type',
            'task_data.task_type',
            'task_data.type'
        ]);

        // Validate task type
        if (type && !VALID_TASK_TYPES.has(type)) {
            console.warn(
                `[TaskRecognition] Unknown task type: "${type}"`,
                {
                    task_id: task.task_id,
                    module_id: task.module_id,
                    topic_id: task.topic_id,
                    validTypes: Array.from(VALID_TASK_TYPES)
                }
            );
        }

        return type;
    }

    function isValidTaskType(type) {
        return VALID_TASK_TYPES.has(type);
    }

    function pickEffectiveTaskType(task) {
        const rawType = getRawTaskType(task);
        if (
            typeof TaskRendererSelector !== "undefined" &&
            TaskRendererSelector &&
            typeof TaskRendererSelector.pickTaskType === "function"
        ) {
            try {
                // Use FeatureConfig if available, fallback to window.RP_FEATURES for backward compatibility
                const features = (typeof FeatureConfig !== 'undefined' && FeatureConfig)
                    ? FeatureConfig.getFeatureFlags()
                    : (window.RP_FEATURES || {});
                return TaskRendererSelector.pickTaskType(rawType, features);
            } catch (e) {
                return rawType;
            }
        }
        return rawType;
    }

    function getCurrentEffectiveTaskType() {
        if (!SessionState || !SessionState.currentTask) return null;
        return pickEffectiveTaskType(SessionState.currentTask);
    }

    // Restore Draft Helper

    function restoreDraftToUI(taskType, draft) {
        try {
            if (taskType === "test" && typeof TestUI !== "undefined" && typeof TestUI.restoreInput === "function") {
                TestUI.restoreInput(draft);
            } else if (taskType === "sequence_assembly" && typeof SequenceUI !== "undefined" && typeof SequenceUI.restoreInput === "function") {
                SequenceUI.restoreInput(draft);
            } else if (taskType === "click" && typeof ClickUI !== "undefined" && typeof ClickUI.restoreInput === "function") {
                ClickUI.restoreInput(draft);
            } else if (taskType === "open_answer" && typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.restoreInput === "function") {
                OpenAnswerUI.restoreInput(draft);
            }
        } catch (e) {
            console.error("Failed to restore draft:", e);
        }
    }

    // Result Display Helper

    function showEvaluationResult(result) {
        const box = document.getElementById("result-box");
        const inner = document.getElementById("result-inner");
        const header = document.getElementById("result-header");
        const iconWrap = document.getElementById("result-icon-wrap");
        const icon = document.getElementById("result-icon");
        const title = document.getElementById("result-title");
        const msg = document.getElementById("result-message");
        const details = document.getElementById("result-details");
        const keywordsBox = document.getElementById("result-keywords");
        const userAnswerBox = document.getElementById("result-user-answer");
        const referenceWrap = document.getElementById("result-reference");
        const referenceText = document.getElementById("result-reference-text");
        const referenceTitle = document.getElementById("result-reference-title");
        const referenceCard = document.getElementById("result-reference-card");

        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            const subtype = SessionState ? getTaskSubtype(SessionState.currentTask) : null;
            if (currentTaskType === "click" && subtype === "error_detection") {
                if (box) {
                    box.classList.add("hidden");
                    box.style.minHeight = "0";
                }
                if (title) title.textContent = "";
                if (icon) icon.textContent = "";
                if (msg) msg.textContent = "";
                if (details) details.textContent = "";
                if (keywordsBox) {
                    keywordsBox.innerHTML = "";
                    keywordsBox.classList.add("hidden");
                }
                if (userAnswerBox) {
                    userAnswerBox.innerHTML = "";
                    userAnswerBox.classList.add("hidden");
                }
                if (referenceText) referenceText.textContent = "";
                if (referenceWrap) referenceWrap.classList.add("hidden");
                if (inner) inner.className = "flex flex-col rounded-lg border border-border-strong bg-surface-2 dark:bg-surface-2 overflow-hidden";
                return;
            }
        } catch (e) {
            // ignore
        }

        if (!result) {
            if (box) box.classList.add("hidden");
            if (title) title.textContent = "";
            if (icon) icon.textContent = "";
            if (msg) msg.textContent = "";
            if (details) details.textContent = "";
            if (keywordsBox) {
                keywordsBox.innerHTML = "";
                keywordsBox.classList.add("hidden");
            }
            if (userAnswerBox) {
                userAnswerBox.innerHTML = "";
                userAnswerBox.classList.add("hidden");
            }
            if (referenceText) referenceText.textContent = "";
            if (referenceWrap) referenceWrap.classList.add("hidden");
            if (inner) inner.className = "flex flex-col rounded-lg border border-border-strong bg-surface-2 dark:bg-surface-2 overflow-hidden";
            return;
        }

        if (box) {
            box.classList.add("result-entering");
            box.classList.remove("hidden");
            requestAnimationFrame(() => box.classList.remove("result-entering"));
        }

        const success = result.success === true;
        if (inner) {
            inner.className =
                "flex flex-col rounded-xl border-l-4 border overflow-hidden shadow-sm " +
                (success
                    ? "border-l-success border-border-strong bg-surface-2"
                    : "border-l-error border-border-strong bg-surface-2");
        }

        if (header) {
            header.className =
                "flex items-center gap-3 px-5 py-3.5 border-b border-border-subtle " +
                (success
                    ? "bg-success-light/30"
                    : "bg-error-light/30");
        }

        if (iconWrap) {
            iconWrap.className =
                "flex items-center justify-center size-9 rounded-full shrink-0 border border-border-strong " +
                (success
                    ? "bg-surface-1 text-success-dark"
                    : "bg-surface-1 text-error-dark");
        }

        // Animated SVG icons via SuccessEffects
        if (typeof SuccessEffects !== 'undefined' && iconWrap) {
            if (success) {
                SuccessEffects.renderAnimatedCheckmark(iconWrap);
            } else {
                SuccessEffects.renderAnimatedCross(iconWrap);
            }
        } else if (icon) {
            icon.textContent = success ? "check" : "close";
        }

        if (title) {
            title.textContent = success ? "\u041e\u0442\u0432\u0435\u0442 \u043f\u0440\u0438\u043d\u044f\u0442" : "\u041e\u0442\u0432\u0435\u0442 \u043d\u0435\u0432\u0435\u0440\u043d\u044b\u0439";
            title.className =
                "text-sm font-bold leading-tight " +
                "text-text-main dark:text-text-on-dark";
        }

        // Streak badge (only on success)
        if (typeof SuccessEffects !== 'undefined' && header) {
            SuccessEffects.renderStreakBadge(header, success ? SuccessEffects.getStreak() : 0);
        }

        let messageText = result && result.message ? String(result.message) : "";
        const detailsObj = result && result.details && typeof result.details === "object" ? result.details : null;

        // Logic for Sequence Assembly Hints
        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            const difficulty = Number(
                (SessionState && SessionState.currentTask && SessionState.currentTask.difficulty) || 1
                // simplified lookup
            );
            if (currentTaskType === "sequence_assembly" && difficulty === 2) {
                if (messageText && messageText.toLowerCase().includes("\u043d\u0435\u0432\u0435\u0440\u043d\u043e\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u0443\u0440\u043e\u0432\u043d\u0435\u0439")) {
                    messageText = "\u0421\u0442\u0440\u0443\u043a\u0442\u0443\u0440\u0430 \u0443\u0440\u043e\u0432\u043d\u0435\u0439 \u043f\u043e\u043a\u0430 \u043d\u0435 \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u0435\u0442. \u041f\u0440\u043e\u0434\u043e\u043b\u0436\u0430\u0439\u0442\u0435 \u0433\u0440\u0443\u043f\u043f\u0438\u0440\u043e\u0432\u0430\u0442\u044c \u044d\u043b\u0435\u043c\u0435\u043d\u0442\u044b \u043f\u043e \u0443\u0440\u043e\u0432\u043d\u044f\u043c \u0438 \u043f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0441\u043d\u043e\u0432\u0430.";
                }
            }
        } catch (e) {
            // ignore
        }
        if (msg) msg.textContent = messageText;

        const extra =
            (detailsObj && (detailsObj.explanation != null ? String(detailsObj.explanation) : "")) ||
            (detailsObj && (detailsObj.raw != null ? String(detailsObj.raw) : "")) ||
            "";
        if (details) details.textContent = extra;

        // D-4 fix: Render Keywords, UserAnswer, Reference for open_answer
        try {
            const currentTaskType = getCurrentEffectiveTaskType();
            if (currentTaskType === "open_answer" && detailsObj) {
                const allKw = Array.isArray(detailsObj.keywords) ? detailsObj.keywords : [];
                const foundSet = new Set((detailsObj.found_keywords || []).map(k => String(k).toLowerCase()));
                const missingSet = new Set((detailsObj.missing_keywords || []).map(k => String(k).toLowerCase()));

                if (keywordsBox && allKw.length > 0) {
                    keywordsBox.innerHTML = "";
                    keywordsBox.classList.remove("hidden");

                    const kwTitle = document.createElement("h4");
                    kwTitle.className = "text-xs font-bold uppercase tracking-wider text-text-secondary";
                    kwTitle.textContent = "\u041a\u043b\u044e\u0447\u0435\u0432\u044b\u0435 \u0441\u043b\u043e\u0432\u0430";
                    keywordsBox.appendChild(kwTitle);

                    const kwRow = document.createElement("div");
                    kwRow.className = "flex flex-wrap gap-1.5";

                    for (const kw of allKw) {
                        const tag = document.createElement("span");
                        const kwLower = String(kw).toLowerCase();
                        const isFound = foundSet.has(kwLower);
                        tag.className = isFound
                            ? "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-success-light text-success-darker border border-success"
                            : "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-error-light text-error-darker border border-error";
                        tag.textContent = (isFound ? "\u2713 " : "\u2717 ") + kw;
                        kwRow.appendChild(tag);
                    }
                    keywordsBox.appendChild(kwRow);
                }

                if (userAnswerBox && detailsObj.user_answer) {
                    userAnswerBox.innerHTML = "";
                    userAnswerBox.classList.remove("hidden");

                    const uaTitle = document.createElement("h4");
                    uaTitle.className = "text-xs font-bold uppercase tracking-wider text-text-secondary";
                    uaTitle.textContent = "\u0412\u0430\u0448 \u043e\u0442\u0432\u0435\u0442";
                    userAnswerBox.appendChild(uaTitle);

                    const uaCard = document.createElement("div");
                    uaCard.className = "rounded-lg border border-border-strong bg-surface-1 p-3 text-sm text-text-main leading-relaxed";
                    uaCard.textContent = detailsObj.user_answer;
                    userAnswerBox.appendChild(uaCard);
                }

                if (referenceWrap && detailsObj.reference_answer) {
                    referenceWrap.classList.remove("hidden");
                    if (referenceTitle) referenceTitle.textContent = "\u042d\u0442\u0430\u043b\u043e\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442";
                    if (referenceText) referenceText.textContent = detailsObj.reference_answer;
                }
            }
        } catch (e) {
            console.warn("[TaskRenderer] Keywords/reference render error:", e);
        }
    }

    // Main Render Function

    function renderTask(task) {
        // Phase 2: Cleanup previous task to prevent memory leaks
        try {
            if (SessionState && SessionState.currentTask) {
                const prevTask = SessionState.currentTask;
                const prevType = pickEffectiveTaskType(prevTask);
                const prevSubtype = getTaskSubtype(prevTask);

                if (prevType === "click" && prevSubtype === "error_detection") {
                    if (typeof MistakesUI !== "undefined" && typeof MistakesUI.cleanup === "function") {
                        MistakesUI.cleanup();
                    }
                } else if (prevType === "test") {
                    if (typeof TestUI !== "undefined" && typeof TestUI.cleanup === "function") {
                        TestUI.cleanup();
                    }
                } else if (prevType === "sequence_assembly") {
                    if (typeof SequenceUI !== "undefined" && typeof SequenceUI.cleanup === "function") {
                        SequenceUI.cleanup();
                    }
                } else if (prevType === "click") {
                    if (typeof ClickUI !== "undefined" && typeof ClickUI.cleanup === "function") {
                        ClickUI.cleanup();
                    }
                } else if (prevType === "draw") {
                    if (typeof DrawUI !== "undefined" && typeof DrawUI.cleanup === "function") {
                        DrawUI.cleanup();
                    }
                } else if (prevType === "open_answer") {
                    if (typeof OpenAnswerUI !== "undefined" && typeof OpenAnswerUI.cleanup === "function") {
                        OpenAnswerUI.cleanup();
                    }
                }
            }
        } catch (e) {
            console.warn("[TaskRenderer] Cleanup error:", e);
        }

        if (SessionState) SessionState.currentTask = task;

        const titleEl = document.getElementById("task-title");
        const metaEl = document.getElementById("task-meta");
        const refEl = document.getElementById("task-ref-label");
        const descEl = document.getElementById("task-description");
        const imgEl = document.getElementById("task-image");
        const progressLabel = document.getElementById("progress-label");
        const difficultyLabel = document.getElementById("difficulty-label");
        const progressBar = document.getElementById("progress-bar");

        if (!task) {
            UIHelpers.setCanGoNext(false);
            if (titleEl) titleEl.textContent = "\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u0437\u0430\u0434\u0430\u043d\u0438\u0439";
            if (metaEl) metaEl.textContent = "";
            if (refEl) refEl.textContent = "";
            if (descEl) descEl.textContent = "";
            if (imgEl) {
                imgEl.style.backgroundImage = "none";
            }
            if (progressLabel) progressLabel.textContent = "\u0417\u0430\u0434\u0430\u043d\u0438\u0435: -";
            if (difficultyLabel) difficultyLabel.textContent = "\u0421\u043b\u043e\u0436\u043d\u043e\u0441\u0442\u044c: -";
            if (progressBar) progressBar.style.width = "0%";
            return;
        }

        const titleFromData =
            (task.task_data &&
                (task.task_data.meta?.name ||
                    task.task_data.name ||
                    task.task_data.content?.task_name)) ||
            task.task_id;

        const descriptionFromData =
            (task.task_data &&
                (task.task_data.description ||
                    task.task_data.content?.description ||
                    task.task_data.content?.prompt ||
                    "")) || "";

        const imageUrlFromData =
            (task.task_data &&
                (task.task_data.image_url || task.task_data.content?.image_url)) ||
            "";

        if (titleEl) titleEl.textContent = titleFromData;
        if (descEl) descEl.textContent = descriptionFromData;
        if (refEl)
            refEl.textContent = `${task.module_id}/${task.topic_id}/${task.task_id}`;
        if (metaEl) metaEl.textContent = `\u0418\u0442\u0435\u0440\u0430\u0446\u0438\u044f ${task.iteration ?? "?"}`;

        if (imgEl) {
            if (imageUrlFromData) {
                imgEl.style.backgroundImage = `url("${imageUrlFromData}")`;
                imgEl.style.display = "block";
            } else {
                imgEl.style.backgroundImage = "none";
                imgEl.style.display = "none";
            }
        }

        const index = task.queue?.index ?? 0;
        const total = task.queue?.total ?? 0;
        if (progressLabel) {
            progressLabel.textContent =
                total && index != null
                    ? `\u0417\u0430\u0434\u0430\u043d\u0438\u0435 ${index + 1} \u0438\u0437 ${total}`
                    : "\u0417\u0430\u0434\u0430\u043d\u0438\u0435: -";
        }

        const difficulty = task.difficulty ?? null;
        if (difficultyLabel) {
            difficultyLabel.textContent =
                difficulty != null ? `\u0421\u043b\u043e\u0436\u043d\u043e\u0441\u0442\u044c: ${difficulty}` : "\u0421\u043b\u043e\u0436\u043d\u043e\u0441\u0442\u044c: -";
        }

        const taskHeaderMeta = document.getElementById("task-header-meta");
        if (taskHeaderMeta) {
            const qInfo =
                total && index != null
                    ? `\u0412\u043e\u043f\u0440\u043e\u0441 ${index + 1} \u0438\u0437 ${total}`
                    : "\u0412\u043e\u043f\u0440\u043e\u0441";
            const iterInfo = `\u0418\u0442\u0435\u0440\u0430\u0446\u0438\u044f ${task.iteration ?? "?"}`;
            taskHeaderMeta.textContent = `${qInfo} - ${iterInfo}`;
            taskHeaderMeta.classList.remove("hidden");
        }

        const currentTaskType = pickEffectiveTaskType(task);
        const taskHeaderBlock = document.getElementById("task-header-block");
        if (
            taskHeaderBlock &&
            (currentTaskType === "test" ||
                currentTaskType === "sequence_assembly" ||
                currentTaskType === "click")
        ) {
            taskHeaderBlock.classList.add("hidden");
        } else if (taskHeaderBlock) {
            taskHeaderBlock.classList.remove("hidden");
        }

        if (taskHeaderMeta && currentTaskType === "click") {
            taskHeaderMeta.classList.add("hidden");
        }

        const percent = total > 0 ? Math.min(100, ((index + 1) / total) * 100) : 0;
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }

        const taskContent = document.getElementById("task-content");
        if (taskContent) {
            taskContent.classList.add("task-entering");
            taskContent.innerHTML = "";
            taskContent.classList.remove("opacity-50", "pointer-events-none"); // Ensure interactable

            const taskType = pickEffectiveTaskType(task);
            const subtype = getTaskSubtype(task);

            const resultBox = document.getElementById("result-box");
            if (taskType === "click" && subtype === "error_detection" && resultBox) {
                resultBox.classList.add("hidden");
                resultBox.style.minHeight = "0";
                const bannerEl = document.getElementById("status-banner");
                if (bannerEl) {
                    bannerEl.classList.add("hidden");
                    bannerEl.textContent = "";
                }
            }

            const checkBtn = document.getElementById("check-answer-btn");
            if (checkBtn && taskType !== "open_answer") {
                checkBtn.disabled = false;
                checkBtn.classList.remove("hidden");
            } else if (checkBtn && taskType === "open_answer") {
                // D-10 fix: ensure button is visible for open_answer
                // (OpenAnswerUI._syncCheckButtonState will manage disabled state)
                checkBtn.classList.remove("hidden");
            }

            let handled = false;
            if (taskType === "click" && subtype === "error_detection" && typeof MistakesUI !== "undefined") {
                handled = true;
                if (checkBtn) {
                    checkBtn.classList.add("hidden");
                    checkBtn.disabled = true;
                }
                MistakesUI.render(taskContent, task, {
                    onStateChange: (detail) => {
                        if (detail && detail.completed && SessionState && !SessionState.autoSubmitting) {
                            SessionState.autoSubmitting = true;
                            UIHelpers.setCanGoNext(false);
                            // Assuming handleSubmitAnswer is global or we dispatch event
                            if (typeof window.handleSubmitAnswer === 'function') {
                                window.handleSubmitAnswer().finally(() => {
                                    SessionState.autoSubmitting = false;
                                });
                            } else {
                                console.warn("handleSubmitAnswer not found");
                                SessionState.autoSubmitting = false;
                            }
                        } else {
                            UIHelpers.setCanGoNext(false);
                        }
                    },
                });
            }

            if (!handled && taskType === "test" && typeof TestUI !== "undefined") {
                handled = true;
                TestUI.render(taskContent, task);
            } else if (!handled && taskType === "sequence_assembly" && typeof SequenceUI !== "undefined") {
                handled = true;
                SequenceUI.render(taskContent, task);
            } else if (!handled && taskType === "click" && typeof ClickUI !== "undefined") {
                handled = true;
                ClickUI.render(taskContent, task, { runtimeMode: true });
            } else if (!handled && taskType === "draw" && typeof DrawUI !== "undefined") {
                handled = true;
                DrawUI.render(taskContent, task);
            } else if (!handled && taskType === "open_answer" && typeof OpenAnswerUI !== "undefined") {
                handled = true;
                OpenAnswerUI.render(taskContent, task);
            }

            // Error telemetry - log and display when no UI component found
            if (!handled) {
                const errorInfo = {
                    taskType: taskType,
                    subtype: subtype,
                    task_id: task.task_id,
                    module_id: task.module_id,
                    topic_id: task.topic_id,
                    availableUIs: {
                        TestUI: typeof TestUI !== "undefined",
                        SequenceUI: typeof SequenceUI !== "undefined",
                        ClickUI: typeof ClickUI !== "undefined",
                        DrawUI: typeof DrawUI !== "undefined",
                        OpenAnswerUI: typeof OpenAnswerUI !== "undefined",
                        MistakesUI: typeof MistakesUI !== "undefined"
                    }
                };

                console.error(
                    `[TaskRecognition] No UI component found for task`,
                    errorInfo
                );

                // Show user-friendly error message
                if (UIHelpers && typeof UIHelpers.showStatus === 'function') {
                    UIHelpers.showStatus(`\u041d\u0435\u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u043c\u044b\u0439 \u0442\u0438\u043f \u0437\u0430\u0434\u0430\u043d\u0438\u044f: ${taskType || 'unknown'}. \u041e\u0431\u0440\u0430\u0442\u0438\u0442\u0435\u0441\u044c \u043a \u0430\u0434\u043c\u0438\u043d\u0438\u0441\u0442\u0440\u0430\u0442\u043e\u0440\u0443.`, "error");
                }

                // Display fallback error UI
                taskContent.innerHTML =
                    `
                    <div class="rounded-lg border-2 border-error bg-error-light p-6 text-center dark:border-error-dark dark:bg-error-light">
                        <span class="material-symbols-outlined text-4xl text-error dark:text-error">error</span>
                        <h3 class="mt-3 text-lg font-semibold text-error-darker dark:text-error-lighter">
                            \u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u044f \u0437\u0430\u0434\u0430\u043d\u0438\u044f
                        </h3>
                        <p class="mt-2 text-sm text-error-text dark:text-error">
                            \u0422\u0438\u043f \u0437\u0430\u0434\u0430\u043d\u0438\u044f "${taskType || 'unknown'}" \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0438\u043b\u0438 UI-\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442 \u043d\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043d.
                        </p>
                        <p class="mt-1 text-xs text-error dark:text-error">
                            ID: ${task.task_id || 'unknown'}
                        </p>
                    </div>
                `;
            }

            const subtypeForResult = subtype;
            if (taskType === "click" && subtypeForResult === "error_detection") {
                if (resultBox) {
                    resultBox.classList.add("hidden");
                    resultBox.style.minHeight = "0";
                }
            } else {
                showEvaluationResult(null);
            }
        } else {
            showEvaluationResult(null);
        }

        // UX-17: Fade task content in after render
        requestAnimationFrame(() => {
            if (taskContent) taskContent.classList.remove("task-entering");
        });

        // Restore draft
        try {
            if (task && DraftStorage) {
                const draft = DraftStorage.loadDraft(SessionState.sessionId, task.task_id);
                if (draft) {
                    setTimeout(() => {
                        const type = pickEffectiveTaskType(task);
                        restoreDraftToUI(type, draft);
                        UIHelpers.showStatus("\u0412\u043e\u0441\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d \u043d\u0435\u0441\u043e\u0445\u0440\u0430\u043d\u0435\u043d\u043d\u044b\u0439 \u043e\u0442\u0432\u0435\u0442", "info");
                    }, 100);
                }
            }
        } catch (e) {
            console.error("Draft restore error", e);
        }
    }

    function isHandledByClickUI(task) {
        const raw = getRawTaskType(task);
        const effective = pickEffectiveTaskType(task);
        return effective === "click" && raw === "draw";
    }

    function currentTaskHandledByClickUI() {
        if (!SessionState) return false;
        return isHandledByClickUI(SessionState.currentTask);
    }

    return {
        renderTask: renderTask,
        getTaskSubtype: getTaskSubtype,
        getRawTaskType: getRawTaskType,
        isValidTaskType: isValidTaskType,
        pickEffectiveTaskType: pickEffectiveTaskType,
        showEvaluationResult: showEvaluationResult,
        restoreDraftToUI: restoreDraftToUI,
        getCurrentEffectiveTaskType: getCurrentEffectiveTaskType,
        isHandledByClickUI: isHandledByClickUI,
        currentTaskHandledByClickUI: currentTaskHandledByClickUI
    };
}));
